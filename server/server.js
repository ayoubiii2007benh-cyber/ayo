'use strict';

const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');

const { db, id: newId, pairKey } = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken, requireAuth, hashWithPepper, safeEqual } = require('./auth');
const OAuth = require('./oauth');
const Email = require('./email');

const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
// Must exactly match the redirect URI registered with each OAuth provider's
// console -- that's their defense against a code being redeemed against the
// wrong deployment. Defaults to localhost so OAuth "just works" in dev once
// a developer sets client id/secret; production must set this explicitly.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const app = express();
// Only ever enable this when actually deployed behind a real reverse
// proxy (e.g. Render). Trusting X-Forwarded-For without one lets a
// client set that header itself and claim any IP, bypassing every
// IP-keyed rate limit below.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false, // configured separately in a later pass
  frameguard: { action: 'deny' }, // matches that pass's frame-ancestors 'none'
}));
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({ limit: '100kb' }));

/* ============================== validation ============================== */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function isValidUsername(u) { return typeof u === 'string' && USERNAME_RE.test(u); }
function isValidPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 200; }
function isValidEmail(e) { return typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
/* https:// only (no data:/blob:/http:) -- this URL is stored and handed to every
   other user's browser as an <img src>, so it must be something any client can
   actually fetch, not a same-origin-only blob: URL or an unbounded inline data: URI. */
function isValidAvatarUrl(u) { return typeof u === 'string' && u.length <= 500 && /^https:\/\/\S+$/.test(u); }

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
/* Longest window any caller uses is the forgot-password limits below (1h); this
   must stay >= that or a window's tracking record gets wiped mid-window, which
   would silently reset its limit early. */
const RATE_LIMIT_MAX_WINDOW_MS = 60 * 60_000;
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_MAX_WINDOW_MS;
  for (const [key, record] of attempts) {
    if (record.start < cutoff) attempts.delete(key);
  }
}, 15 * 60_000).unref();

/* Failed-login tracking, keyed by the identifier typed (not IP -- an attacker
   spraying one account from many IPs should still trip this). Separate from
   `attempts`/rateLimited above: this needs a live *count* to decide "does the
   next attempt need a captcha", not just a boolean past-the-limit check, and
   it resets to zero on a successful login rather than expiring on a timer. */
const loginFailures = new Map();
const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
const LOGIN_CAPTCHA_THRESHOLD = 2;
function loginFailureCount(key) {
  const record = loginFailures.get(key);
  if (!record || Date.now() - record.start > LOGIN_FAILURE_WINDOW_MS) return 0;
  return record.count;
}
function recordLoginFailure(key) {
  const now = Date.now();
  const record = loginFailures.get(key);
  if (!record || now - record.start > LOGIN_FAILURE_WINDOW_MS) { loginFailures.set(key, { start: now, count: 1 }); return 1; }
  record.count += 1;
  return record.count;
}
function clearLoginFailures(key) { loginFailures.delete(key); }
setInterval(() => {
  const cutoff = Date.now() - LOGIN_FAILURE_WINDOW_MS;
  for (const [key, record] of loginFailures) {
    if (record.start < cutoff) loginFailures.delete(key);
  }
}, 15 * 60_000).unref();

/* ============================== captcha (Cloudflare Turnstile) ============================== */

/* Cloudflare publishes these test keys specifically so a real Turnstile/
   Cloudflare account is never required for development: the test site key
   always renders a widget, and the test secret always verifies as a
   success against Cloudflare's real siteverify endpoint. They provide NO
   actual bot protection -- production must set real TURNSTILE_SITE_KEY /
   TURNSTILE_SECRET_KEY values (from https://dash.cloudflare.com/?to=/:account/turnstile)
   for the widget to mean anything there. See SECURITY.md and the deploy checklist. */
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';
const TURNSTILE_TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || TURNSTILE_TEST_SITE_KEY;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || TURNSTILE_TEST_SECRET_KEY;

/* A missing, invalid, expired, or already-used token is always rejected, and a
   network failure reaching Cloudflare fails closed (rejected), not open. */
async function verifyCaptcha(token, ip) {
  if (typeof token !== 'string' || !token) return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: ip || '' });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

/* ============================== oauth (Google / Microsoft) ============================== */

/** state -> { verifier, provider, expiresAt }: created by /start, consumed once by /callback. */
const oauthStates = new Map();
/** one-time code -> { token, user, expiresAt }: bridges the server-side OAuth
    redirect back to a normal JSON response the frontend can consume, without
    ever putting the real session JWT in a URL (query strings end up in
    browser history and server access logs). */
const oauthExchangeCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, v] of oauthStates) if (v.expiresAt < now) oauthStates.delete(key);
  for (const [key, v] of oauthExchangeCodes) if (v.expiresAt < now) oauthExchangeCodes.delete(key);
}, 60_000).unref();

function usernameFromEmail(email) {
  const base = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16).padEnd(3, '0') || 'user';
  let candidate = base;
  for (let i = 1; getUserByUsername(candidate); i += 1) candidate = `${base}${i}`.slice(0, 20);
  return candidate;
}

/* Thrown when an OAuth email collides with an existing account that was
   never proven to belong to that address. See findOrCreateOAuthUser. */
class OAuthEmailInUseError extends Error {}

/* Links or creates a local account for a verified OAuth identity. Deliberately
   does not create a usable password for a brand-new account -- signing in
   again means going through the same provider, which is the only identity
   this server has actually verified.

   Does NOT auto-link to a pre-existing account by email match, even when the
   provider says the email is verified. That merge is a well-documented
   account **pre-hijacking** pattern (Paverd & Sudhodanan, USENIX Security
   '23; also covered in real-world OAuth bug bounty writeups): registration
   here never confirms a password account's email belongs to whoever typed
   it, so an attacker can squat a victim's address at signup time and simply
   wait -- the victim's later "Continue with Google" would otherwise land
   them in the attacker's pre-created, attacker-controlled account. Refusing
   the merge and telling the user to log in with their password instead
   closes that off; self-service linking from a *logged-in* session is a
   documented known gap (see SECURITY.md), not implemented here. */
async function findOrCreateOAuthUser(provider, profile) {
  const link = db.prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?').get(provider, profile.sub);
  if (link) return getUserById(link.user_id);

  if (getUserByEmail(profile.email)) throw new OAuthEmailInUseError();

  const id = newId();
  const now = Date.now();
  const unusablePassword = await hashPassword(crypto.randomBytes(32).toString('hex'));
  db.prepare(`INSERT INTO users (id, username, email, password_hash, display_name, avatar, bio, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, usernameFromEmail(profile.email), profile.email, unusablePassword, (profile.name || profile.email.split('@')[0]).slice(0, 40), '', '', now, now);
  const user = getUserById(id);
  db.prepare('INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(provider, profile.sub, user.id, profile.email, now);
  return user;
}

/* ============================== db helpers ============================== */

function publicUser(row, extra) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: row.avatar,
    avatarUrl: row.avatar_url || null,
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

app.post('/api/auth/register', async (req, res) => {
  if (rateLimited(`register:${req.ip}`, 10, 15 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { username, password, email, displayName, avatar, captchaToken } = req.body || {};
  if (!(await verifyCaptcha(captchaToken, req.ip))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  if (!isValidUsername(username)) return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore.' });
  if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (email !== undefined && email !== '' && !isValidEmail(email)) return res.status(400).json({ error: 'That email address looks invalid.' });
  if (getUserByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
  if (email && getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

  const id = newId();
  const now = Date.now();
  try {
    const hash = await hashPassword(password);
    db.prepare(`INSERT INTO users (id, username, email, password_hash, display_name, avatar, bio, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, username, email || null, hash, (displayName || username).slice(0, 40), (avatar || '').slice(0, 8), '', now, now);
    const user = getUserById(id);
    res.status(201).json({ token: signToken(id, 0), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: 'Could not create the account. Try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (rateLimited(`login:${req.ip}`, 10, 15 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { identifier, password, captchaToken } = req.body || {};
  if (typeof identifier !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'Username/email and password are required.' });
  // Captcha is only required once this identifier has racked up a couple of failures,
  // so a normal user typing their password correctly the first time is never bothered
  // by it -- but it's enforced here server-side regardless of what the client shows.
  const failKey = identifier.trim().toLowerCase();
  if (loginFailureCount(failKey) >= LOGIN_CAPTCHA_THRESHOLD) {
    if (!(await verifyCaptcha(captchaToken, req.ip))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }
  const user = identifier.includes('@') ? getUserByEmail(identifier) : getUserByUsername(identifier);
  if (!user) {
    console.warn(`[auth] failed login for "${identifier}" from ${req.ip}`);
    const count = recordLoginFailure(failKey);
    return res.status(401).json({ error: 'Incorrect username/email or password.', captchaRequired: count >= LOGIN_CAPTCHA_THRESHOLD });
  }
  try {
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      console.warn(`[auth] failed login for "${identifier}" from ${req.ip}`);
      const count = recordLoginFailure(failKey);
      return res.status(401).json({ error: 'Incorrect username/email or password.', captchaRequired: count >= LOGIN_CAPTCHA_THRESHOLD });
    }
    clearLoginFailures(failKey);
    res.json({ token: signToken(user.id, user.token_version), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: 'Login failed. Try again.' });
  }
});

/* ============================== password reset ============================== */

const RESET_CODE_TTL_MS = 10 * 60_000;
const RESET_TOKEN_TTL_MS = 15 * 60_000;
const RESET_MAX_CODE_ATTEMPTS = 5;

function generateResetCode() {
  return String(crypto.randomInt(100000, 1000000)); // always exactly 6 digits
}

app.post('/api/auth/forgot', async (req, res) => {
  const { identifier, captchaToken } = req.body || {};
  if (!(await verifyCaptcha(captchaToken, req.ip))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  const GENERIC = { message: 'If an account exists, we sent a code to its email address.' };
  if (typeof identifier !== 'string' || !identifier.trim()) return res.json(GENERIC);
  const normalized = identifier.trim();
  // Rate-limited before lookup, and identically regardless of outcome below, so
  // neither the 429 nor the 200 ever reveals whether the account exists.
  if (rateLimited(`forgot-id:${normalized.toLowerCase()}`, 3, 60 * 60_000) || rateLimited(`forgot-ip:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  const user = normalized.includes('@') ? getUserByEmail(normalized) : getUserByUsername(normalized);
  if (user && user.email) {
    db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(user.id);
    const code = generateResetCode();
    const now = Date.now();
    db.prepare('INSERT INTO password_resets (id, user_id, code_hash, code_expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(newId(), user.id, hashWithPepper(code), now + RESET_CODE_TTL_MS, now);
    try {
      const { subject, html, text } = Email.resetCodeEmail(BASE_URL, code);
      await Email.sendEmail({ to: user.email, subject, html, text });
    } catch (err) {
      console.error('[email] failed to send reset code:', err.message);
    }
  }
  res.json(GENERIC);
});

app.post('/api/auth/forgot-username', async (req, res) => {
  const { email, captchaToken } = req.body || {};
  if (!(await verifyCaptcha(captchaToken, req.ip))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  const GENERIC = { message: 'If an account exists with that email, we sent its username.' };
  if (typeof email !== 'string' || !isValidEmail(email)) return res.json(GENERIC);
  if (rateLimited(`forgot-uname-id:${email.toLowerCase()}`, 3, 60 * 60_000) || rateLimited(`forgot-uname-ip:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  const user = getUserByEmail(email);
  if (user) {
    try {
      const { subject, html, text } = Email.usernameEmail(BASE_URL, user.username);
      await Email.sendEmail({ to: user.email, subject, html, text });
    } catch (err) {
      console.error('[email] failed to send username:', err.message);
    }
  }
  res.json(GENERIC);
});

app.post('/api/auth/verify-code', async (req, res) => {
  if (rateLimited(`verify-code:${req.ip}`, 20, 60 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { identifier, code } = req.body || {};
  const BAD = { error: "That code isn't right or has expired." };
  if (typeof identifier !== 'string' || typeof code !== 'string' || !identifier.trim() || !code.trim()) return res.status(400).json(BAD);
  const user = identifier.includes('@') ? getUserByEmail(identifier.trim()) : getUserByUsername(identifier.trim());
  if (!user) return res.status(400).json(BAD);
  const row = db.prepare(
    'SELECT * FROM password_resets WHERE user_id = ? AND code_hash IS NOT NULL AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1'
  ).get(user.id);
  if (!row || !row.code_expires_at || row.code_expires_at < Date.now()) return res.status(400).json(BAD);
  if (row.attempts >= RESET_MAX_CODE_ATTEMPTS) return res.status(400).json({ error: 'Too many attempts, try again in a few minutes.' });
  if (!safeEqual(hashWithPepper(code.trim()), row.code_hash)) {
    const nextAttempts = row.attempts + 1;
    if (nextAttempts >= RESET_MAX_CODE_ATTEMPTS) {
      db.prepare('UPDATE password_resets SET attempts = ?, code_hash = NULL WHERE id = ?').run(nextAttempts, row.id);
      return res.status(400).json({ error: 'Too many attempts, try again in a few minutes.' });
    }
    db.prepare('UPDATE password_resets SET attempts = ? WHERE id = ?').run(nextAttempts, row.id);
    return res.status(400).json({ error: `That code isn't right. ${RESET_MAX_CODE_ATTEMPTS - nextAttempts} tries left.` });
  }
  const resetToken = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('UPDATE password_resets SET verified_at = ?, reset_token_hash = ?, reset_token_expires_at = ?, code_hash = NULL WHERE id = ?')
    .run(now, hashWithPepper(resetToken), now + RESET_TOKEN_TTL_MS, row.id);
  res.json({ resetToken });
});

app.post('/api/auth/reset-password', async (req, res) => {
  if (rateLimited(`reset-password:${req.ip}`, 20, 60 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { resetToken, password } = req.body || {};
  const INVALID = { error: 'That reset link is invalid or expired. Start over.' };
  if (typeof resetToken !== 'string' || !resetToken) return res.status(400).json(INVALID);
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  const row = db.prepare('SELECT * FROM password_resets WHERE reset_token_hash = ? AND used_at IS NULL')
    .get(hashWithPepper(resetToken));
  if (!row || !row.reset_token_expires_at || row.reset_token_expires_at < Date.now()) return res.status(400).json(INVALID);
  try {
    const hash = await hashPassword(password);
    const now = Date.now();
    // Bumping token_version invalidates every session token issued before this
    // moment -- the same "log out everywhere" mechanism POST /api/auth/logout uses.
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(hash, row.user_id);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(now, row.id);
    const user = getUserById(row.user_id);
    clearLoginFailures(user.username.toLowerCase());
    if (user.email) clearLoginFailures(user.email.toLowerCase());
    res.json({ token: signToken(user.id, user.token_version), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: 'Could not reset the password. Try again.' });
  }
});

/* ============================== oauth (Google / Microsoft) ============================== */

app.get('/api/config', (req, res) => {
  res.json({
    captcha: { enabled: true, siteKey: TURNSTILE_SITE_KEY },
    oauth: { google: OAuth.isConfigured('google'), microsoft: OAuth.isConfigured('microsoft'), facebook: OAuth.isConfigured('facebook') },
  });
});

app.get('/api/auth/:provider/start', (req, res) => {
  const provider = req.params.provider;
  if (!OAuth.PROVIDERS[provider] || !OAuth.isConfigured(provider)) {
    return res.status(404).json({ error: 'That sign-in method is not available.' });
  }
  if (rateLimited(`oauth-start:${req.ip}`, 20, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const { verifier, challenge } = OAuth.pkcePair();
  const state = crypto.randomBytes(24).toString('base64url');
  oauthStates.set(state, { verifier, provider, expiresAt: Date.now() + 5 * 60_000 });
  const redirectUri = `${BASE_URL}/api/auth/${provider}/callback`;
  res.redirect(OAuth.authorizeUrl(provider, { state, challenge, redirectUri }));
});

app.get('/api/auth/:provider/callback', async (req, res) => {
  const provider = req.params.provider;
  const { code, state, error } = req.query;
  const entry = typeof state === 'string' ? oauthStates.get(state) : null;
  if (entry) oauthStates.delete(state); // single use regardless of outcome below

  if (error || typeof code !== 'string' || !entry || entry.provider !== provider || entry.expiresAt < Date.now()) {
    return res.redirect('/?oauthError=1');
  }
  try {
    const redirectUri = `${BASE_URL}/api/auth/${provider}/callback`;
    const tokens = await OAuth.exchangeCode(provider, { code, verifier: entry.verifier, redirectUri });
    const profile = await OAuth.fetchProfile(provider, tokens.access_token);
    const user = await findOrCreateOAuthUser(provider, profile);
    const exchangeCode = crypto.randomBytes(24).toString('base64url');
    oauthExchangeCodes.set(exchangeCode, {
      token: signToken(user.id, user.token_version),
      user: publicUser(user),
      expiresAt: Date.now() + 60_000,
    });
    res.redirect(`/?oauth=${exchangeCode}`);
  } catch (err) {
    if (err instanceof OAuthEmailInUseError) return res.redirect('/?oauthError=email_in_use');
    console.error(`[oauth] ${provider} sign-in failed:`, err.message);
    res.redirect('/?oauthError=1');
  }
});

/* One-time code -> real session token, so the JWT itself never appears in a
   URL (server access logs, browser history, Referer headers). */
app.post('/api/auth/oauth/exchange', (req, res) => {
  const code = req.body && req.body.code;
  const entry = typeof code === 'string' ? oauthExchangeCodes.get(code) : null;
  if (entry) oauthExchangeCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: 'Invalid or expired sign-in code.' });
  res.json({ token: entry.token, user: entry.user });
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
  let avatarUrl = user.avatar_url;
  if (req.body.avatarUrl === '' || req.body.avatarUrl === null) avatarUrl = null;
  else if (typeof req.body.avatarUrl === 'string') {
    if (!isValidAvatarUrl(req.body.avatarUrl)) return res.status(400).json({ error: 'Avatar URL must be a valid https:// link, 500 characters or fewer.' });
    avatarUrl = req.body.avatarUrl;
  }
  db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar = ?, avatar_url = ? WHERE id = ?').run(displayName || user.username, bio, avatar, avatarUrl, req.userId);
  res.json({ user: publicUser(getUserById(req.userId)) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

/* ============================== users ============================== */

app.get('/api/users/search', requireAuth, (req, res) => {
  if (rateLimited(`search:${req.userId}`, 30, 60_000)) return res.status(429).json({ error: 'Too many searches. Try again shortly.' });
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
  if (rateLimited(`friend-req:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many friend requests. Try again shortly.' });
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
  if (rateLimited(`message:${req.userId}`, 60, 60_000)) return res.status(429).json({ error: 'Sending too fast. Try again shortly.' });
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

/* ============================== study lounge rooms ==============================
   Real multi-user co-working rooms, replacing the former all-client-side bot
   simulation. A user is seated in at most one room at a time; membership,
   live status (focusing/resting/idle + remaining time) and sprint ("mission")
   progress all live server-side so every member's client renders the same
   truth. Status pushes are REST-triggered + WS-broadcast, the same pattern
   already used for friend requests and messages elsewhere in this file --
   no new client-initiated WebSocket message type was introduced. */

const ROOM_CODE_WORDS = ['FOCUS', 'FLOW', 'GRIND', 'DEEP', 'CALM', 'ZEN', 'LOCK', 'PUSH'];
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode() {
  const word = ROOM_CODE_WORDS[Math.floor(Math.random() * ROOM_CODE_WORDS.length)];
  const suffix = ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)] + ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  return `${word}-${suffix}`;
}
const ROOM_STATUSES = ['idle', 'focusing', 'resting'];

function getRoomByCode(code) { return db.prepare('SELECT * FROM rooms WHERE code = ? COLLATE NOCASE').get(code); }
function getRoomById(id) { return db.prepare('SELECT * FROM rooms WHERE id = ?').get(id); }
function getMembership(roomId, userId) { return db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId); }
/** A user can only ever be seated in one room; this is how callers find "their" room. */
function getCurrentRoomMembership(userId) {
  return db.prepare(
    `SELECT room_members.*, rooms.code AS room_code FROM room_members JOIN rooms ON rooms.id = room_members.room_id WHERE room_members.user_id = ?`
  ).get(userId);
}

function publicRoom(room) {
  const memberRows = db.prepare(
    `SELECT rm.*, u.display_name, u.username, u.avatar, u.avatar_url FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ? ORDER BY rm.joined_at ASC`
  ).all(room.id);
  return {
    code: room.code,
    goal: room.goal,
    hostId: room.host_user_id,
    createdAt: room.created_at,
    mission: room.mission_state ? { targetPomodoros: room.mission_target, state: room.mission_state } : null,
    members: memberRows.map((m) => ({
      id: m.user_id,
      displayName: m.display_name,
      username: m.username,
      avatar: m.avatar,
      avatarUrl: m.avatar_url || null,
      online: isOnline(m.user_id),
      isHost: m.user_id === room.host_user_id,
      status: m.status,
      remainingMs: m.remaining_ms,
      statusUpdatedAt: m.status_updated_at,
      missionProgress: m.mission_progress,
      missionState: m.mission_state,
    })),
  };
}

function broadcastRoom(roomId) {
  const room = getRoomById(roomId);
  if (!room) return;
  const payload = { type: 'lounge-room', room: publicRoom(room) };
  const memberIds = db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId).map((r) => r.user_id);
  for (const uid of memberIds) sendToUser(uid, payload);
}

/* Removes a user from whichever room they're currently in (a no-op if none),
   promoting the longest-seated remaining member to host, or deleting the room
   if it's now empty. Called both by an explicit leave and at the start of
   every join, since a user can only be in one room at a time. */
function leaveCurrentRoom(userId) {
  const membership = getCurrentRoomMembership(userId);
  if (!membership) return;
  const roomId = membership.room_id;
  db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, userId);
  const remaining = db.prepare('SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC').all(roomId);
  if (remaining.length === 0) {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    return;
  }
  const room = getRoomById(roomId);
  if (room.host_user_id === userId) {
    db.prepare('UPDATE rooms SET host_user_id = ? WHERE id = ?').run(remaining[0].user_id, roomId);
  }
  broadcastRoom(roomId);
}

function joinRoomByCode(userId, code) {
  const room = getRoomByCode(code);
  if (!room) return { error: 'not_found' };
  if (getMembership(room.id, userId)) return { room }; // already seated here -- idempotent, not an error
  leaveCurrentRoom(userId);
  const now = Date.now();
  db.prepare(`INSERT INTO room_members (room_id, user_id, joined_at, status, remaining_ms, status_updated_at, mission_progress, mission_state)
              VALUES (?, ?, ?, 'idle', 0, ?, 0, 'pending')`).run(room.id, userId, now, now);
  broadcastRoom(room.id);
  return { room };
}

/** Returns true if a sprint just completed (every seated member checked in). Resets it either way once done. */
function checkMissionCompletion(roomId) {
  const room = getRoomById(roomId);
  if (!room || room.mission_state !== 'active') return false;
  const members = db.prepare('SELECT mission_state FROM room_members WHERE room_id = ?').all(roomId);
  if (members.length === 0 || !members.every((m) => m.mission_state === 'checked-in')) return false;
  db.prepare('UPDATE rooms SET mission_target = NULL, mission_state = NULL WHERE id = ?').run(roomId);
  db.prepare(`UPDATE room_members SET mission_progress = 0, mission_state = 'pending' WHERE room_id = ?`).run(roomId);
  return true;
}

app.post('/api/lounge/rooms', requireAuth, (req, res) => {
  if (rateLimited(`room-create:${req.userId}`, 10, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const goal = typeof req.body.goal === 'string' ? req.body.goal.trim().slice(0, 80) : '';
  leaveCurrentRoom(req.userId);
  const id = newId();
  const now = Date.now();
  let code = generateRoomCode();
  for (let i = 0; i < 10 && getRoomByCode(code); i += 1) code = generateRoomCode();
  db.prepare('INSERT INTO rooms (id, code, host_user_id, goal, created_at) VALUES (?, ?, ?, ?, ?)').run(id, code, req.userId, goal, now);
  db.prepare(`INSERT INTO room_members (room_id, user_id, joined_at, status, remaining_ms, status_updated_at, mission_progress, mission_state)
              VALUES (?, ?, ?, 'idle', 0, ?, 0, 'pending')`).run(id, req.userId, now, now);
  res.status(201).json({ room: publicRoom(getRoomById(id)) });
});

// Registered before /:code so the literal path "mine" can never be swallowed as a room code param.
app.get('/api/lounge/rooms/mine', requireAuth, (req, res) => {
  const membership = getCurrentRoomMembership(req.userId);
  res.json({ room: membership ? publicRoom(getRoomById(membership.room_id)) : null });
});

app.get('/api/lounge/rooms/:code', requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code);
  if (!room || !getMembership(room.id, req.userId)) return res.status(404).json({ error: 'Room not found.' });
  res.json({ room: publicRoom(room) });
});

app.post('/api/lounge/rooms/:code/join', requireAuth, (req, res) => {
  if (rateLimited(`room-join:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const result = joinRoomByCode(req.userId, req.params.code);
  if (result.error) return res.status(404).json({ error: 'No room with that code.' });
  res.json({ room: publicRoom(getRoomById(result.room.id)) });
});

app.post('/api/lounge/rooms/:code/leave', requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code);
  if (!room || !getMembership(room.id, req.userId)) return res.status(404).json({ error: 'You are not in that room.' });
  leaveCurrentRoom(req.userId);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/status', requireAuth, (req, res) => {
  if (rateLimited(`room-status:${req.userId}`, 60, 60_000)) return res.status(429).json({ error: 'Too many updates. Try again shortly.' });
  const room = getRoomByCode(req.params.code);
  if (!room || !getMembership(room.id, req.userId)) return res.status(404).json({ error: 'You are not in that room.' });
  const status = ROOM_STATUSES.includes(req.body.status) ? req.body.status : 'idle';
  const remainingMs = Number.isFinite(req.body.remainingMs) ? Math.max(0, Math.min(req.body.remainingMs, 4 * 60 * 60_000)) : 0;
  db.prepare('UPDATE room_members SET status = ?, remaining_ms = ?, status_updated_at = ? WHERE room_id = ? AND user_id = ?')
    .run(status, remainingMs, Date.now(), room.id, req.userId);
  broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/start', requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code);
  if (!room || !getMembership(room.id, req.userId)) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.host_user_id !== req.userId) return res.status(403).json({ error: 'Only the host can start a sprint.' });
  const memberCount = db.prepare('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?').get(room.id).c;
  if (memberCount < 2) return res.status(400).json({ error: 'Need at least 2 members to start a sprint.' });
  if (room.mission_state === 'active') return res.status(409).json({ error: 'A sprint is already active.' });
  const target = Math.min(4, Math.max(1, Math.trunc(Number(req.body.targetPomodoros)) || 1));
  db.prepare('UPDATE rooms SET mission_target = ?, mission_state = ? WHERE id = ?').run(target, 'active', room.id);
  db.prepare(`UPDATE room_members SET mission_progress = 0, mission_state = 'pending' WHERE room_id = ?`).run(room.id);
  broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/cancel', requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code);
  if (!room || !getMembership(room.id, req.userId)) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.host_user_id !== req.userId) return res.status(403).json({ error: 'Only the host can cancel a sprint.' });
  db.prepare('UPDATE rooms SET mission_target = NULL, mission_state = NULL WHERE id = ?').run(room.id);
  db.prepare(`UPDATE room_members SET mission_progress = 0, mission_state = 'pending' WHERE room_id = ?`).run(room.id);
  broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/checkin', requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code);
  const membership = room && getMembership(room.id, req.userId);
  if (!membership) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.mission_state !== 'active' || membership.mission_state !== 'pending') return res.status(400).json({ error: 'No active sprint to check in to.' });
  const progress = membership.mission_progress + 1;
  const done = progress >= room.mission_target;
  db.prepare('UPDATE room_members SET mission_progress = ?, mission_state = ? WHERE room_id = ? AND user_id = ?')
    .run(progress, done ? 'checked-in' : 'pending', room.id, req.userId);
  if (done && checkMissionCompletion(room.id)) {
    const memberIds = db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(room.id).map((r) => r.user_id);
    for (const uid of memberIds) sendToUser(uid, { type: 'lounge-mission-complete', roomCode: room.code });
  }
  broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/giveup', requireAuth, (req, res) => {
  const room = getRoomByCode(req.params.code);
  const membership = room && getMembership(room.id, req.userId);
  if (!membership) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.mission_state !== 'active' || membership.mission_state !== 'pending') return res.status(400).json({ error: 'No active sprint to give up on.' });
  db.prepare(`UPDATE room_members SET mission_state = 'abandoned' WHERE room_id = ? AND user_id = ?`).run(room.id, req.userId);
  broadcastRoom(room.id);
  res.json({ ok: true });
});

/* -------- room invites: friends only, direct one-click join -------- */

app.post('/api/lounge/invites', requireAuth, (req, res) => {
  if (rateLimited(`room-invite:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many invites. Try again shortly.' });
  const toUserId = req.body && req.body.toUserId;
  if (!toUserId || typeof toUserId !== 'string') return res.status(400).json({ error: 'toUserId is required.' });
  if (!areFriends(req.userId, toUserId)) return res.status(403).json({ error: 'You can only invite friends to your room.' });
  const membership = getCurrentRoomMembership(req.userId);
  if (!membership) return res.status(400).json({ error: 'Join or create a room before inviting someone.' });
  if (!getUserById(toUserId)) return res.status(404).json({ error: 'User not found.' });

  const id = newId();
  const created_at = Date.now();
  db.prepare('INSERT INTO room_invites (id, room_id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, membership.room_id, req.userId, toUserId, 'pending', created_at);
  const room = getRoomById(membership.room_id);
  const inviter = getUserById(req.userId);
  const invite = { id, roomCode: room.code, goal: room.goal, createdAt: created_at, from: publicUser(inviter) };
  const notification = createNotification(toUserId, 'lounge_invite', { requestId: id, roomCode: room.code, from: publicUser(inviter) });
  sendToUser(toUserId, { type: 'lounge-invite', invite });
  res.status(201).json({ invite, notification });
});

app.get('/api/lounge/invites', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT ri.*, r.code AS room_code, r.goal AS room_goal FROM room_invites ri JOIN rooms r ON r.id = ri.room_id
     WHERE ri.to_user_id = ? AND ri.status = 'pending' ORDER BY ri.created_at DESC`
  ).all(req.userId);
  const invites = rows.map((r) => ({ id: r.id, roomCode: r.room_code, goal: r.room_goal, createdAt: r.created_at, from: publicUser(getUserById(r.from_user_id)) }));
  res.json({ invites });
});

app.post('/api/lounge/invites/:id/accept', requireAuth, (req, res) => {
  const invite = db.prepare('SELECT * FROM room_invites WHERE id = ?').get(req.params.id);
  if (!invite || invite.to_user_id !== req.userId || invite.status !== 'pending') return res.status(404).json({ error: 'Invite not found or already handled.' });
  db.prepare(`UPDATE room_invites SET status = 'accepted', responded_at = ? WHERE id = ?`).run(Date.now(), req.params.id);
  const room = getRoomById(invite.room_id);
  if (!room) return res.status(410).json({ error: 'That room no longer exists.' });
  joinRoomByCode(req.userId, room.code);
  res.json({ room: publicRoom(getRoomById(room.id)) });
});

app.post('/api/lounge/invites/:id/decline', requireAuth, (req, res) => {
  const invite = db.prepare('SELECT * FROM room_invites WHERE id = ?').get(req.params.id);
  if (!invite || invite.to_user_id !== req.userId || invite.status !== 'pending') return res.status(404).json({ error: 'Invite not found or already handled.' });
  db.prepare(`UPDATE room_invites SET status = 'declined', responded_at = ? WHERE id = ?`).run(Date.now(), req.params.id);
  res.json({ ok: true });
});

/* ============================== leaderboard ==============================
   Server-recorded completed-focus-session log, the basis for a real
   multi-user leaderboard scoped to "me + my friends" (never arbitrary other
   users). Client-reported, but validated (sane duration, rate-limited) --
   good enough for a small social app; not a substitute for a trusted timer
   if this ever needs to resist a determined cheater. */

// 30 req/min already throttles a single burst, but a script left running could still post
// a fresh 1-180 min session every couple of seconds indefinitely -- cap the rolling 24h
// total too, so the leaderboard can't be inflated past what's physically plausible.
const MAX_DAILY_FOCUS_MINUTES = 960; // 16h -- generous headroom over any real day of focus

app.post('/api/stats/sessions', requireAuth, (req, res) => {
  if (rateLimited(`session-log:${req.userId}`, 30, 60_000)) return res.status(429).json({ error: 'Too many session logs. Try again shortly.' });
  const minutes = Math.trunc(Number(req.body && req.body.minutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) return res.status(400).json({ error: 'minutes must be between 1 and 180.' });
  const since = Date.now() - 24 * 60 * 60_000;
  const { total } = db.prepare('SELECT COALESCE(SUM(minutes), 0) AS total FROM focus_sessions WHERE user_id = ? AND completed_at >= ?').get(req.userId, since);
  if (total + minutes > MAX_DAILY_FOCUS_MINUTES) return res.status(429).json({ error: 'Daily focus limit reached.' });
  db.prepare('INSERT INTO focus_sessions (id, user_id, minutes, completed_at) VALUES (?, ?, ?, ?)').run(newId(), req.userId, minutes, Date.now());
  res.status(201).json({ ok: true });
});

const LEADERBOARD_RANGES = { daily: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000, alltime: null };

app.get('/api/leaderboard', requireAuth, (req, res) => {
  const range = Object.prototype.hasOwnProperty.call(LEADERBOARD_RANGES, req.query.range) ? req.query.range : 'weekly';
  const since = LEADERBOARD_RANGES[range] === null ? 0 : Date.now() - LEADERBOARD_RANGES[range];
  const friendIds = db.prepare('SELECT friend_id FROM friendships WHERE user_id = ?').all(req.userId).map((r) => r.friend_id);
  const ids = [req.userId, ...friendIds];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT user_id, COALESCE(SUM(minutes), 0) AS totalMinutes, COUNT(*) AS pomodoros
     FROM focus_sessions WHERE user_id IN (${placeholders}) AND completed_at >= ?
     GROUP BY user_id`
  ).all(...ids, since);
  const rowByUser = new Map(rows.map((r) => [r.user_id, r]));
  const entries = ids
    .map((uid) => {
      const row = rowByUser.get(uid);
      return { user: publicUser(getUserById(uid)), totalMinutes: row ? row.totalMinutes : 0, pomodoros: row ? row.pomodoros : 0 };
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes || b.pomodoros - a.pomodoros);
  res.json({ range, entries });
});

/* ============================== presence ============================== */

app.get('/api/presence/online-count', (req, res) => res.json({ count: onlineUserCount() }));

/* ============================== static frontend ============================== */

const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');

app.use('/favicon', express.static(path.join(__dirname, '..', 'favicon')));
app.get('/site.webmanifest', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'site.webmanifest'));
});

app.get('/', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8')
    .replace('<script>', `<script nonce="${nonce}">`);
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.youtube.com https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "frame-src https://www.youtube.com https://challenges.cloudflare.com",
    "connect-src 'self' https://generativelanguage.googleapis.com",
    "frame-ancestors 'none'",
  ].join('; '));
  res.type('html').send(html);
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  // body-parser reports malformed/oversized request bodies as errors with a
  // 4xx status attached -- those are client mistakes, not server failures.
  // Reporting them as 500 mislabels them in logs/monitoring and (for
  // malformed JSON) leaks that a JSON parser threw. Anything without a
  // 4xx status is a genuine unexpected error and still gets logged + 500.
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 400 && status < 500) {
    const message = status === 413 ? 'Request body too large.' : 'Malformed request.';
    return res.status(status).json({ error: message });
  }
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
  const origin = req.headers.origin;
  if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://internal');
  const token = url.searchParams.get('token');
  const payload = token ? verifyToken(token) : null;
  const user = payload ? getUserById(payload.userId) : null;
  const validSession = !!user && user.token_version === payload.tokenVersion;

  ws.isAlive = true;
  ws.userId = validSession ? user.id : null;
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
