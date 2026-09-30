'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { db } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required (see server/.env.example).');
}
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const BCRYPT_COST = 12;

/* Hashes a short-lived, low-entropy value (a 6-digit reset code, a reset token)
   with a pepper so the database alone never holds anything usable -- reuses
   JWT_SECRET rather than requiring a whole separate secret just for this. Not
   for passwords (bcrypt already owns those via hashPassword/verifyPassword). */
function hashWithPepper(value) {
  return crypto.createHash('sha256').update(`${value}:${JWT_SECRET}`).digest('hex');
}
/* Constant-time string compare, for checking a caller-supplied code/token
   hash against the stored one without leaking timing information. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ============================== passwords ============================== */

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}
function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}
/** True when a stored hash was made with a cheaper cost than we use today (upgrade it after a successful login). */
function needsRehash(hash) {
  try { return bcrypt.getRounds(hash) < BCRYPT_COST; } catch { return false; }
}
/* A real bcrypt hash of a random value, compared against when a login names an account that doesn't
   exist, so "no such user" takes as long as "wrong password" and response time can't be used to tell
   which usernames are registered. */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);
function verifyAgainstDummy(password) {
  return bcrypt.compare(password, DUMMY_HASH);
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890', '11111111',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'letmein1', 'admin123', 'welcome1', 'abc12345',
  'abcd1234', '1q2w3e4r', '1qaz2wsx', 'football', 'baseball', 'monkey123', 'dragon123', 'sunshine',
  'princess', 'trustno1', 'pomodoro', 'pomodoro1', 'pomodoro123', 'hunter22', 'changeme', 'passw0rd',
]);
/** Returns an error message for an unacceptable NEW password, or null if it is fine. */
function passwordProblem(password, { username, email } = {}) {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  // bcrypt only reads the first 72 bytes; refusing longer input is safer than silently ignoring the tail.
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be at most 72 characters.';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Choose something harder to guess.';
  if (username && lower === String(username).toLowerCase()) return 'Password must not be the same as your username.';
  if (email && lower === String(email).toLowerCase()) return 'Password must not be the same as your email.';
  if (/^(.)\1+$/.test(password)) return 'Password is too repetitive.';
  return null;
}

/* ============================== sessions ==============================
   A session is a signed JWT (id + token_version) held ONLY in an HttpOnly cookie, so page scripts
   (and therefore any XSS) can never read it. A fresh one is minted at every login/registration.
   Every request re-checks token_version against the database, so logout / password reset revoke it
   immediately. Because the browser attaches the cookie automatically, every state-changing request
   must also carry a CSRF token (see requireAuth). */

function signToken(userId, tokenVersion) {
  return jwt.sign({ sub: userId, ver: tokenVersion }, JWT_SECRET, { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS });
}
function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return { userId: payload.sub, tokenVersion: payload.ver };
  } catch {
    return null;
  }
}

const COOKIE_HOST = '__Host-pomo_session'; // __Host- prefix: browser enforces Secure + Path=/ + no Domain
const COOKIE_PLAIN = 'pomo_session'; // only used on plain-http local development
function isSecureRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}
function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}
function sessionTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_HOST] || cookies[COOKIE_PLAIN] || null;
}
function setSessionCookie(req, res, token) {
  const secure = isSecureRequest(req);
  res.cookie(secure ? COOKIE_HOST : COOKIE_PLAIN, token, {
    httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: TOKEN_TTL_SECONDS * 1000,
  });
}
function clearSessionCookie(req, res) {
  const secure = isSecureRequest(req);
  res.clearCookie(secure ? COOKIE_HOST : COOKIE_PLAIN, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
}
/** The CSRF token for a given session: an HMAC of the session token itself, so it needs no storage
    and dies with the session. The page keeps it in memory and sends it in the X-CSRF-Token header. */
function csrfTokenFor(sessionToken) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`csrf:${sessionToken}`).digest('base64url');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/* Express middleware: requires a valid session cookie whose token_version still matches the user's
   current row, plus (for anything that changes state) a matching CSRF token. Attaches req.userId.
   Every route that touches user-specific data uses this -- nothing trusts a client-supplied user id
   from the request body. */
async function requireAuth(req, res, next) {
  const token = sessionTokenFromRequest(req);
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated.' });
  if (!SAFE_METHODS.has(req.method)) {
    const sent = req.headers['x-csrf-token'];
    if (typeof sent !== 'string' || !safeEqual(sent, csrfTokenFor(token))) {
      return res.status(403).json({ error: 'Security check failed. Reload the page and try again.' });
    }
  }
  try {
    const row = await db.get('SELECT token_version FROM users WHERE id = ?', [payload.userId]);
    if (!row || row.token_version !== payload.tokenVersion) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.userId = payload.userId;
    req.sessionToken = token;
    next();
  } catch (err) {
    console.error('[auth] database error while checking session:', err.code || err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

module.exports = {
  hashPassword, verifyPassword, verifyAgainstDummy, needsRehash, passwordProblem,
  signToken, verifyToken, requireAuth, hashWithPepper, safeEqual,
  parseCookies, sessionTokenFromRequest, setSessionCookie, clearSessionCookie, csrfTokenFor, isSecureRequest,
};
