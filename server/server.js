'use strict';

const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');

const { db, id: newId, pairKey } = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken, requireAuth } = require('./auth');

const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(helmet({
  contentSecurityPolicy: false, // configured separately in a later pass
  frameguard: { action: 'deny' }, // matches that pass's frame-ancestors 'none'
}));
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '100kb' }));

/* ============================== validation ============================== */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function isValidUsername(u) { return typeof u === 'string' && USERNAME_RE.test(u); }
function isValidPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 200; }
function isValidEmail(e) { return typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

/* Minimal in-memory throttle on auth endpoints: N attempts per key per window.
   No new dependency, resets on restart -- adequate for this app's scale. */
const attempts = new Map();
function rateLimited(key, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || now - record.start > windowMs) {
    attempts.set(key, { start: now, count: 1 });
    return false;
  }
  record.count += 1;
  return record.count > max;
}

/* ============================== db helpers ============================== */

function publicUser(row, extra) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    bio: row.bio,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    online: isOnline(row.id),
    ...extra,
  };
}
function getUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function getUserByUsername(u) { return db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(u); }
function getUserByEmail(e) { return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(e); }
function areFriends(a, b) { return !!db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(a, b); }
function touchLastSeen(userId) { db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId); }

function getOrCreateConversation(u1, u2) {
  const [a, b] = pairKey(u1, u2);
  let row = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!row) {
    const id = newId();
    const created_at = Date.now();
    db.prepare('INSERT INTO conversations (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)').run(id, a, b, created_at);
    row = { id, user_a: a, user_b: b, created_at };
  }
  return row;
}

function createNotification(userId, type, data) {
  const id = newId();
  const created_at = Date.now();
  db.prepare('INSERT INTO notifications (id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, userId, type, JSON.stringify(data), created_at);
  const notification = { id, type, data, createdAt: created_at, readAt: null };
  sendToUser(userId, { type: 'notification', notification });
  return notification;
}

/* ============================== auth routes ============================== */

app.post('/api/auth/register', (req, res) => {
  if (rateLimited(`register:${req.ip}`, 10, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const { username, password, email, displayName, avatar } = req.body || {};
  if (!isValidUsername(username)) return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore.' });
  if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (email !== undefined && email !== '' && !isValidEmail(email)) return res.status(400).json({ error: 'That email address looks invalid.' });
  if (getUserByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
  if (email && getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

  const id = newId();
  const now = Date.now();
  hashPassword(password).then((hash) => {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, display_name, avatar, bio, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, username, email || null, hash, (displayName || username).slice(0, 40), (avatar || '').slice(0, 8), '', now, now);
    const user = getUserById(id);
    res.status(201).json({ token: signToken(id), user: publicUser(user) });
  }).catch(() => res.status(500).json({ error: 'Could not create the account. Try again.' }));
});

app.post('/api/auth/login', (req, res) => {
  if (rateLimited(`login:${req.ip}`, 20, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const { identifier, password } = req.body || {};
  if (typeof identifier !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username/email and password are required.' });
  const user = identifier.includes('@') ? getUserByEmail(identifier) : getUserByUsername(identifier);
  if (!user) return res.status(401).json({ error: 'Incorrect username/email or password.' });
  verifyPassword(password, user.password_hash).then((ok) => {
    if (!ok) return res.status(401).json({ error: 'Incorrect username/email or password.' });
    res.json({ token: signToken(user.id), user: publicUser(user) });
  }).catch(() => res.status(500).json({ error: 'Login failed. Try again.' }));
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Account no longer exists.' });
  res.json({ user: publicUser(user) });
});

app.patch('/api/auth/me', requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Account no longer exists.' });
  const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.slice(0, 40).trim() : user.display_name;
  const bio = typeof req.body.bio === 'string' ? req.body.bio.slice(0, 160) : user.bio;
  const avatar = typeof req.body.avatar === 'string' ? req.body.avatar.slice(0, 8) : user.avatar;
  db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar = ? WHERE id = ?').run(displayName || user.username, bio, avatar, req.userId);
  res.json({ user: publicUser(getUserById(req.userId)) });
});

/* ============================== users ============================== */

app.get('/api/users/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
  if (q.length < 2) return res.json({ users: [] });
  const rows = db.prepare(
    `SELECT * FROM users WHERE id != ? AND (username LIKE ? OR display_name LIKE ?) ORDER BY username LIMIT 20`
  ).all(req.userId, `%${q}%`, `%${q}%`);
  const results = rows.map((row) => publicUser(row, { relationship: relationshipBetween(req.userId, row.id) }));
  res.json({ users: results });
});

function relationshipBetween(me, other) {
  if (areFriends(me, other)) return 'friends';
  const out = db.prepare(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`).get(me, other);
  if (out) return 'pending_out';
  const inc = db.prepare(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`).get(other, me);
  if (inc) return 'pending_in';
  return 'none';
}

app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user: publicUser(user, { relationship: relationshipBetween(req.userId, user.id) }) });
});

/* ============================== friends ============================== */

app.get('/api/friends', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.display_name COLLATE NOCASE`
  ).all(req.userId);
  res.json({ friends: rows.map((r) => publicUser(r)) });
});

app.get('/api/friends/requests', requireAuth, (req, res) => {
  /* r.id is aliased because `u.*` also expands to a column named `id`
     (the joined user's id), which would otherwise silently overwrite the
     friend_requests row's own id in the result object. */
  const incoming = db.prepare(
    `SELECT r.id AS request_id, r.created_at, u.* FROM friend_requests r JOIN users u ON u.id = r.from_user_id
     WHERE r.to_user_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`
  ).all(req.userId).map((r) => ({ id: r.request_id, createdAt: r.created_at, user: publicUser(r) }));
  const outgoing = db.prepare(
    `SELECT r.id AS request_id, r.created_at, u.* FROM friend_requests r JOIN users u ON u.id = r.to_user_id
     WHERE r.from_user_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`
  ).all(req.userId).map((r) => ({ id: r.request_id, createdAt: r.created_at, user: publicUser(r) }));
  res.json({ incoming, outgoing });
});

app.post('/api/friends/requests', requireAuth, (req, res) => {
  const toUserId = req.body && req.body.toUserId;
  if (!toUserId || typeof toUserId !== 'string') return res.status(400).json({ error: 'toUserId is required.' });
  if (toUserId === req.userId) return res.status(400).json({ error: "You can't friend yourself." });
  const target = getUserById(toUserId);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (areFriends(req.userId, toUserId)) return res.status(409).json({ error: 'You are already friends.' });

  const mine = db.prepare(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`).get(req.userId, toUserId);
  if (mine) return res.status(409).json({ error: 'Friend request already sent.' });

  /* They already asked us -- accept theirs instead of creating a duplicate. */
  const theirs = db.prepare(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`).get(toUserId, req.userId);
  if (theirs) {
    acceptRequest(theirs.id, req.userId);
    return res.status(200).json({ status: 'friends', user: publicUser(getUserById(toUserId)) });
  }

  const id = newId();
  const created_at = Date.now();
  db.prepare(`INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`)
    .run(id, req.userId, toUserId, created_at);
  const me = getUserById(req.userId);
  const notification = createNotification(toUserId, 'friend_request', { requestId: id, from: publicUser(me) });
  sendToUser(toUserId, { type: 'friend-request', request: { id, createdAt: created_at, user: publicUser(me) } });
  res.status(201).json({ status: 'pending_out', requestId: id, notification });
});

function acceptRequest(requestId, byUserId) {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId);
  if (!request || request.to_user_id !== byUserId || request.status !== 'pending') return null;
  const now = Date.now();
  db.prepare(`UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?`).run(now, requestId);
  db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(request.from_user_id, request.to_user_id, now);
  db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(request.to_user_id, request.from_user_id, now);

  const accepter = getUserById(byUserId);
  const requester = getUserById(request.from_user_id);
  createNotification(request.from_user_id, 'friend_accept', { by: publicUser(accepter) });
  sendToUser(request.from_user_id, { type: 'friend-accept', friend: publicUser(accepter) });
  broadcastPresenceToFriends(byUserId);
  broadcastPresenceToFriends(request.from_user_id);
  return { requester: publicUser(requester), accepter: publicUser(accepter) };
}

app.post('/api/friends/requests/:id/accept', requireAuth, (req, res) => {
  const result = acceptRequest(req.params.id, req.userId);
  if (!result) return res.status(404).json({ error: 'Request not found or already handled.' });
  res.json({ friend: result.requester });
});

app.post('/api/friends/requests/:id/reject', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!request || request.to_user_id !== req.userId || request.status !== 'pending') return res.status(404).json({ error: 'Request not found or already handled.' });
  db.prepare(`UPDATE friend_requests SET status = 'rejected', responded_at = ? WHERE id = ?`).run(Date.now(), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/friends/requests/:id', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!request || request.from_user_id !== req.userId || request.status !== 'pending') return res.status(404).json({ error: 'Request not found.' });
  db.prepare(`UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE id = ?`).run(Date.now(), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/friends/:friendId', requireAuth, (req, res) => {
  db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(req.userId, req.params.friendId);
  db.prepare('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?').run(req.params.friendId, req.userId);
  res.json({ ok: true });
});

/* ============================== conversations / messages ============================== */

app.get('/api/conversations', requireAuth, (req, res) => {
  const friends = db.prepare(
    `SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?`
  ).all(req.userId);
  const list = friends.map((friend) => {
    const [a, b] = pairKey(req.userId, friend.id);
    const conv = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
    let lastMessage = null, unreadCount = 0;
    if (conv) {
      lastMessage = db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conv.id);
      unreadCount = db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL`).get(conv.id, friend.id).c;
    }
    return {
      friend: publicUser(friend),
      lastMessage: lastMessage ? { text: lastMessage.text, senderId: lastMessage.sender_id, createdAt: lastMessage.created_at } : null,
      unreadCount,
    };
  });
  list.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  res.json({ conversations: list });
});

app.get('/api/conversations/:friendId/messages', requireAuth, (req, res) => {
  const friendId = req.params.friendId;
  if (!areFriends(req.userId, friendId)) return res.status(403).json({ error: 'You can only view conversations with friends.' });
  const conv = getOrCreateConversation(req.userId, friendId);
  const before = req.query.before ? Number(req.query.before) : Date.now() + 1;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const rows = db.prepare(
    `SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`
  ).all(conv.id, before, limit);
  rows.reverse();
  res.json({ messages: rows.map((m) => ({ id: m.id, text: m.text, senderId: m.sender_id, createdAt: m.created_at, readAt: m.read_at })) });
});

app.post('/api/conversations/:friendId/messages', requireAuth, (req, res) => {
  const friendId = req.params.friendId;
  if (!areFriends(req.userId, friendId)) return res.status(403).json({ error: 'You can only message friends.' });
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
  if (!text) return res.status(400).json({ error: 'Message text is required.' });
  const conv = getOrCreateConversation(req.userId, friendId);
  const id = newId();
  const created_at = Date.now();
  db.prepare('INSERT INTO messages (id, conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, conv.id, req.userId, text, created_at);
  const message = { id, conversationId: conv.id, text, senderId: req.userId, createdAt: created_at, readAt: null };
  sendToUser(friendId, { type: 'message', message });
  sendToUser(req.userId, { type: 'message', message });
  createNotification(friendId, 'message', { from: publicUser(getUserById(req.userId)), preview: text.slice(0, 120), conversationId: conv.id });
  res.status(201).json({ message });
});

app.post('/api/conversations/:friendId/read', requireAuth, (req, res) => {
  const friendId = req.params.friendId;
  if (!areFriends(req.userId, friendId)) return res.status(403).json({ error: 'Not friends.' });
  const [a, b] = pairKey(req.userId, friendId);
  const conv = db.prepare('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?').get(a, b);
  if (conv) {
    db.prepare(`UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL`)
      .run(Date.now(), conv.id, friendId);
  }
  res.json({ ok: true });
});

/* ============================== notifications ============================== */

app.get('/api/notifications', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.userId);
  const unreadCount = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.userId).c;
  res.json({
    notifications: rows.map((n) => ({ id: n.id, type: n.type, data: JSON.parse(n.data), createdAt: n.created_at, readAt: n.read_at })),
    unreadCount,
  });
});

app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(Date.now(), req.params.id, req.userId);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), req.userId);
  res.json({ ok: true });
});

/* ============================== presence ============================== */

app.get('/api/presence/online-count', (req, res) => res.json({ count: onlineUserCount() }));

/* ============================== static frontend ============================== */

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

/* ============================== realtime: presence + push ============================== */

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

/** userId -> Set<ws> (a user can have several tabs/devices open at once) */
const connections = new Map();
/** every open socket, authenticated or anonymous, for the public online-count broadcast */
const allSockets = new Set();

function isOnline(userId) {
  const set = connections.get(userId);
  return !!set && set.size > 0;
}
function onlineUserCount() { return connections.size; }

function sendToUser(userId, payload) {
  const set = connections.get(userId);
  if (!set) return;
  const json = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(json);
}
function broadcastAll(payload) {
  const json = JSON.stringify(payload);
  for (const ws of allSockets) if (ws.readyState === ws.OPEN) ws.send(json);
}
function broadcastPresenceToFriends(userId) {
  const friends = db.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').all(userId);
  const payload = { type: 'presence', userId, online: isOnline(userId), lastSeenAt: getUserById(userId)?.last_seen_at };
  for (const { friend_id } of friends) sendToUser(friend_id, payload);
}
function broadcastOnlineCount() { broadcastAll({ type: 'online-count', count: onlineUserCount() }); }

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://internal');
  const token = url.searchParams.get('token');
  const userId = token ? verifyToken(token) : null;
  const user = userId ? getUserById(userId) : null;

  ws.isAlive = true;
  ws.userId = user ? user.id : null;
  allSockets.add(ws);

  if (ws.userId) {
    if (!connections.has(ws.userId)) connections.set(ws.userId, new Set());
    const firstConnection = connections.get(ws.userId).size === 0;
    connections.get(ws.userId).add(ws);
    touchLastSeen(ws.userId);
    if (firstConnection) { broadcastPresenceToFriends(ws.userId); broadcastOnlineCount(); }
  }

  ws.send(JSON.stringify({ type: 'online-count', count: onlineUserCount() }));
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', () => {
    allSockets.delete(ws);
    if (!ws.userId) return;
    const set = connections.get(ws.userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      connections.delete(ws.userId);
      touchLastSeen(ws.userId);
      broadcastPresenceToFriends(ws.userId);
      broadcastOnlineCount();
    }
  });
});

/* Heartbeat: terminate sockets that stop responding (network loss, crashed tab) so
   presence/online-count reflect reality instead of a connection that silently died. */
const heartbeat = setInterval(() => {
  for (const ws of allSockets) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`Pomodoro server listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => { clearInterval(heartbeat); server.close(() => process.exit(0)); });
