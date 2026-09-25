'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required (see server/.env.example).');
}
const TOKEN_TTL = '30d';

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}
function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.sub;
  } catch {
    return null;
  }
}

/* Express middleware: requires a valid `Authorization: Bearer <token>` header,
   attaches req.userId. Every route that touches user-specific data uses this —
   nothing trusts a client-supplied user id from the request body. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const userId = token && verifyToken(token);
  if (!userId) return res.status(401).json({ error: 'Not authenticated.' });
  req.userId = userId;
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAuth };
