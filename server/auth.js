'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required (see server/.env.example).');
}
const TOKEN_TTL = '7d';

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
function signToken(userId, tokenVersion) {
  return jwt.sign({ sub: userId, ver: tokenVersion }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { userId: payload.sub, tokenVersion: payload.ver };
  } catch {
    return null;
  }
}

/* Express middleware: requires a valid `Authorization: Bearer <token>` header
   AND a token_version that still matches the user's current row (logout and
   any future "log out everywhere" action bump that column, invalidating
   every token signed before it). Attaches req.userId. Every route that
   touches user-specific data uses this -- nothing trusts a client-supplied
   user id from the request body. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) {
    console.warn(`[auth] rejected request to ${req.method} ${req.path} from ${req.ip}: no valid token`);
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.userId);
  if (!row || row.token_version !== payload.tokenVersion) {
    console.warn(`[auth] rejected request to ${req.method} ${req.path} from ${req.ip}: stale/revoked token for user ${payload.userId}`);
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.userId = payload.userId;
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAuth };
