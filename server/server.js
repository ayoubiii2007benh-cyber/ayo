'use strict';

const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { WebSocketServer } = require('ws');

const { db, initSchema, id: newId, pairKey } = require('./db');
const {
  hashPassword, verifyPassword, verifyAgainstDummy, needsRehash, passwordProblem,
  signToken, verifyToken, requireAuth, hashWithPepper, safeEqual,
  parseCookies, sessionTokenFromRequest, setSessionCookie, clearSessionCookie, csrfTokenFor, isSecureRequest,
} = require('./auth');
const OAuth = require('./oauth');
const Assets = require('./assets');
const Email = require('./email');

const PORT = Number(process.env.PORT) || 3000;
/* Version of the Terms of Service + Privacy Policy users agree to. Bump this (to the new "last updated"
   date) whenever either document changes in a way users must re-accept; every account whose stored
   consent_version differs is asked to accept again. Keep in sync with legal/*.html. */
const POLICY_VERSION = '2026-09-30';
const CONTACT_EMAIL = 'help.pomodorofocus@gmail.com';
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
// Must exactly match the redirect URI registered with each OAuth provider's
// console -- that's their defense against a code being redeemed against the
// wrong deployment. Defaults to localhost so OAuth "just works" in dev once
// a developer sets client id/secret; production must set this explicitly.
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

const app = express();
app.disable('x-powered-by');
// Only ever enable this when actually deployed behind a real reverse
// proxy (e.g. Render). Trusting X-Forwarded-For without one lets a
// client set that header itself and claim any IP, bypassing every
// IP-keyed rate limit below. TRUST_PROXY is the number of proxy hops (1 = Render alone,
// 2 = e.g. Cloudflare in front of Render).
if (/^[1-9]$/.test(process.env.TRUST_PROXY || '')) app.set('trust proxy', Number(process.env.TRUST_PROXY));

/* Express 4 does not catch a rejected promise from an async route handler: the request would hang and,
   on modern Node, the unhandled rejection would crash the whole process (one malformed request = outage).
   Wrap every handler registered below so a failure becomes a clean 500 instead. */
for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
  const original = app[method].bind(app);
  app[method] = (routePath, ...handlers) => {
    if (!handlers.length) return original(routePath); // app.get('setting') form
    return original(routePath, ...handlers.map((h) => (typeof h !== 'function' || h.length >= 4 ? h : (req, res, next) => {
      let result;
      try { result = h(req, res, next); } catch (err) { return next(err); }
      if (result && typeof result.catch === 'function') result.catch(next);
      return undefined;
    })));
  };
}
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', (reason && (reason.code || reason.message)) || 'unknown');
});

/* Send people who reach us over plain HTTP (only visible when a proxy/CDN terminates TLS and says so via
   X-Forwarded-Proto) to HTTPS. Combined with HSTS below this keeps every cookie and token off the wire in clear. */
app.use((req, res, next) => {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto === 'http' && req.headers.host) return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  next();
});

app.use(helmet({
  contentSecurityPolicy: false, // set below (it depends on whether the request arrived over HTTPS)
  frameguard: { action: 'deny' }, // matches frame-ancestors 'none'
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'no-referrer' },
}));
/* Camera/microphone/screen-share are needed by Study Lounge rooms (same origin only); the rest of the
   powerful browser features are switched off for this site and anything it embeds. */
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=(), interest-cohort=()');
  next();
});

/* Content-Security-Policy: no page has an inline <script> any more (the app's JavaScript is a separate,
   cacheable file), so script-src needs no nonce and no 'unsafe-inline' -- only our own files plus the few
   listed hosts may run script, which is what stops injected markup from executing. Applied to every response. */
function buildCsp(secure) {
  const directives = [
    "default-src 'self'",
    "script-src 'self' https://www.youtube.com https://challenges.cloudflare.com https://www.googletagmanager.com",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    'frame-src https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com',
    "connect-src 'self' https://generativelanguage.googleapis.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
app.use((req, res, next) => {
  res.set('Content-Security-Policy', buildCsp(isSecureRequest(req)));
  next();
});

/* API responses carry personal data: never let a browser or proxy cache them. */
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/* CSRF layer 1: a state-changing request from a browser must come from this site. (Layer 2 is the
   per-session X-CSRF-Token that requireAuth demands.) The Host header is compared rather than a configured
   URL so this keeps working however the site is reached (custom domain, preview URL, local dev). */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** True when a browser-supplied Origin is this site: the same host the request was addressed to (also as seen
    by a fronting proxy, X-Forwarded-Host), the configured BASE_URL, or an explicitly allowed origin. */
function originIsOurs(origin, req) {
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  return parsed.host === req.headers.host
    || (forwardedHost !== '' && parsed.host === forwardedHost)
    || parsed.origin === new URL(BASE_URL).origin
    || allowedOrigins.includes(origin);
}
app.use('/api', (req, res, next) => {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  const crossSite = site === 'cross-site' || origin === 'null' || (origin && !originIsOurs(origin, req));
  if (crossSite) return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  next();
});

/* Coarse flood limit over the whole API (routes add their own tighter limits). Deliberately generous: a
   normal session makes a handful of requests a minute. Signed-in callers are counted per account, so
   people who share an IP address (an office, a school, a proxy) never throttle one another; anonymous
   callers are counted per IP. */
app.use('/api', (req, res, next) => {
  const token = sessionTokenFromRequest(req);
  const session = token ? verifyToken(token) : null;
  const key = session ? `api-user:${session.userId}` : `api-ip:${req.ip}`;
  if (rateLimited(key, 900, 60_000)) return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' });
  next();
});

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: true }));
const jsonSmall = express.json({ limit: '100kb' });
const jsonWithImage = express.json({ limit: '8mb' });
// Only the room-chat send route may carry an image (base64 of up to 5 MB); everything else
// keeps the 100kb cap. The larger parser is only used for requests that present a validly signed
// session, so anonymous callers can never make the server buffer megabytes.
const ROOM_MESSAGES_PATH_RE = /^\/api\/lounge\/rooms\/[^/]+\/messages$/;
app.use((req, res, next) => {
  if (req.method === 'POST' && ROOM_MESSAGES_PATH_RE.test(req.path) && verifyToken(sessionTokenFromRequest(req) || '')) return jsonWithImage(req, res, next);
  return jsonSmall(req, res, next);
});

/* ============================== validation ============================== */

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function isValidUsername(u) { return typeof u === 'string' && USERNAME_RE.test(u); }
function isValidEmail(e) { return typeof e === 'string' && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
/* https:// only (no data:/blob:/http:) -- this URL is stored and handed to every
   other user's browser as an <img src>, so it must be something any client can
   actually fetch, not a same-origin-only blob: URL or an unbounded inline data: URI.
   Quotes, brackets and backslashes are refused so it can never break out of the CSS url(...) it is placed in. */
function isValidAvatarUrl(u) { return typeof u === 'string' && u.length <= 500 && /^https:\/\/[^\s"'()<>\\]+$/.test(u); }
/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally instead of as a pattern. */
function escapeLike(s) { return s.replace(/[\\%_]/g, '\\$&'); }

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
const LOGIN_FAILURE_WINDOW_MS = 60 * 60_000;
const LOGIN_CAPTCHA_THRESHOLD = 2;
const LOGIN_LOCK_AFTER = 6; // failures before the account starts locking for a while
const LOGIN_LOCK_BASE_MS = 60_000; // 1 min, doubling with every further failure, capped below
const LOGIN_LOCK_MAX_MS = 15 * 60_000;
function loginFailureCount(key) {
  const record = loginFailures.get(key);
  if (!record || Date.now() - record.start > LOGIN_FAILURE_WINDOW_MS) return 0;
  return record.count;
}
/** Milliseconds this identifier must wait before another attempt is even looked at (0 = not locked). */
function loginLockRemaining(key) {
  const record = loginFailures.get(key);
  if (!record || Date.now() - record.start > LOGIN_FAILURE_WINDOW_MS) return 0;
  return Math.max(0, (record.lockedUntil || 0) - Date.now());
}
function recordLoginFailure(key) {
  const now = Date.now();
  let record = loginFailures.get(key);
  if (!record || now - record.start > LOGIN_FAILURE_WINDOW_MS) { record = { start: now, count: 0, lockedUntil: 0 }; loginFailures.set(key, record); }
  record.count += 1;
  // Exponential backoff against password guessing: from the 6th failure on, wait 1, 2, 4, ... up to 15 minutes.
  if (record.count >= LOGIN_LOCK_AFTER) {
    record.lockedUntil = now + Math.min(LOGIN_LOCK_MAX_MS, LOGIN_LOCK_BASE_MS * 2 ** (record.count - LOGIN_LOCK_AFTER));
  }
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
async function verifyCaptcha(token) {
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  try {
    // remoteip is optional and deliberately not sent: it would hand visitors' IP addresses to Cloudflare for nothing.
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = await res.json();
    return data.success === true;
  } catch {
    return false;
  }
}

/* ============================== oauth (Google / Microsoft) ============================== */

/** state -> { verifier, provider, consent, expiresAt }: created by /start, consumed once by /callback.
    `consent` records whether the person ticked "I agree to the Terms and Privacy Policy" before leaving for the provider. */
const oauthStates = new Map();
/** one-time code -> { token, userId, expiresAt }: bridges the server-side OAuth
    redirect back to a normal JSON response the frontend can consume, without
    ever putting the real session JWT in a URL (query strings end up in
    browser history and server access logs). */
const oauthExchangeCodes = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, v] of oauthStates) if (v.expiresAt < now) oauthStates.delete(key);
  for (const [key, v] of oauthExchangeCodes) if (v.expiresAt < now) oauthExchangeCodes.delete(key);
}, 60_000).unref();

async function usernameFromEmail(email) {
  const base = (email.split('@')[0] || 'user').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16).padEnd(3, '0') || 'user';
  let candidate = base;
  let i = 1;
  while (await getUserByUsername(candidate)) {
    candidate = `${base}${i}`.slice(0, 20);
    i += 1;
  }
  return candidate;
}

/* Thrown when an OAuth email collides with an existing account that was
   never proven to belong to that address. See findOrCreateOAuthUser. */
class OAuthEmailInUseError extends Error {}
/* Thrown when someone would create a brand-new account through a provider without having agreed to the
   Terms of Service and Privacy Policy. */
class OAuthConsentRequiredError extends Error {}

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
async function findOrCreateOAuthUser(provider, profile, consent) {
  const link = await db.get('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?', [provider, profile.sub]);
  if (link) return getUserById(link.user_id);

  if (await getUserByEmail(profile.email)) throw new OAuthEmailInUseError();
  if (!consent) throw new OAuthConsentRequiredError();

  const id = newId();
  const now = Date.now();
  const unusablePassword = await hashPassword(crypto.randomBytes(32).toString('hex'));
  await db.run(
    `INSERT INTO users (id, username, email, password_hash, display_name, avatar, bio, created_at, last_seen_at, consent_version, consent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, await usernameFromEmail(profile.email), profile.email, unusablePassword, (profile.name || profile.email.split('@')[0]).slice(0, 40), '', '', now, now, POLICY_VERSION, now]
  );
  const user = await getUserById(id);
  await db.run(
    'INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    [provider, profile.sub, user.id, profile.email, now]
  );
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
/** Profile of someone the viewer is NOT friends with: same shape, but no presence or last-seen time. */
function strangerUser(row, extra) {
  const user = publicUser(row, extra);
  if (!user) return null;
  return { ...user, online: false, lastSeenAt: null };
}
function getUserById(id) { return db.get('SELECT * FROM users WHERE id = ?', [id]); }
// COLLATE NOCASE (SQLite) has no Postgres equivalent; case-insensitive lookup instead compares
// LOWER() of both sides, backed by the LOWER(username)/LOWER(email) unique indexes in db.js.
function getUserByUsername(u) { return db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [u]); }
function getUserByEmail(e) { return db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [e]); }
async function areFriends(a, b) { return !!(await db.get('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?', [a, b])); }
function touchLastSeen(userId) { return db.run('UPDATE users SET last_seen_at = ? WHERE id = ?', [Date.now(), userId]); }

async function getOrCreateConversation(u1, u2) {
  const [a, b] = pairKey(u1, u2);
  let row = await db.get('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?', [a, b]);
  if (!row) {
    const id = newId();
    const created_at = Date.now();
    await db.run('INSERT INTO conversations (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)', [id, a, b, created_at]);
    row = { id, user_a: a, user_b: b, created_at };
  }
  return row;
}

async function createNotification(userId, type, data) {
  const id = newId();
  const created_at = Date.now();
  await db.run(
    'INSERT INTO notifications (id, user_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, type, JSON.stringify(data), created_at]
  );
  const notification = { id, type, data, createdAt: created_at, readAt: null };
  sendToUser(userId, { type: 'notification', notification });
  return notification;
}

/* ============================== auth routes ============================== */

/* A session is issued by setting the HttpOnly cookie; the body carries only what the page needs to
   know (who it is, the CSRF token for this session, and whether it must accept updated terms) and
   NEVER the session token itself, so no script on the page can read or leak it. */
async function sessionBody(user, token) {
  const oauth = await db.get('SELECT 1 AS linked FROM oauth_accounts WHERE user_id = ? LIMIT 1', [user.id]);
  return {
    user: publicUser(user),
    csrfToken: csrfTokenFor(token),
    consentRequired: user.consent_version !== POLICY_VERSION,
    policyVersion: POLICY_VERSION,
    account: { passwordLogin: !oauth },
  };
}
async function startSession(req, res, user, status = 200) {
  const token = signToken(user.id, user.token_version);
  setSessionCookie(req, res, token);
  res.status(status).json(await sessionBody(user, token));
}

app.post('/api/auth/register', async (req, res) => {
  if (rateLimited(`register:${req.ip}`, 10, 15 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { username, password, email, displayName, avatar, captchaToken, acceptTerms } = req.body || {};
  // Enforced here, not just in the browser: no account can exist without a recorded agreement.
  if (acceptTerms !== true) return res.status(400).json({ error: 'You must agree to the Terms of Service and Privacy Policy to create an account.', consentRequired: true });
  if (!(await verifyCaptcha(captchaToken))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  if (!isValidUsername(username)) return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore.' });
  if (email !== undefined && email !== '' && !isValidEmail(email)) return res.status(400).json({ error: 'That email address looks invalid.' });
  const pwProblem = passwordProblem(password, { username, email });
  if (pwProblem) return res.status(400).json({ error: pwProblem });
  if (displayName !== undefined && typeof displayName !== 'string') return res.status(400).json({ error: 'Invalid display name.' });
  if (await getUserByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
  if (email && (await getUserByEmail(email))) return res.status(409).json({ error: 'An account with that email already exists.' });

  const id = newId();
  const now = Date.now();
  try {
    const hash = await hashPassword(password);
    await db.run(
      `INSERT INTO users (id, username, email, password_hash, display_name, avatar, bio, created_at, last_seen_at, consent_version, consent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, username, email || null, hash, ((displayName || username).trim() || username).slice(0, 40), (typeof avatar === 'string' ? avatar : '').slice(0, 8), '', now, now, POLICY_VERSION, now]
    );
    await startSession(req, res, await getUserById(id), 201);
  } catch (err) {
    console.error('[auth] registration failed:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Could not create the account. Try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (rateLimited(`login:${req.ip}`, 10, 15 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { identifier, password, captchaToken, acceptTerms } = req.body || {};
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier || !password) return res.status(400).json({ error: 'Username/email and password are required.' });
  if (identifier.length > 200 || password.length > 1000) return res.status(400).json({ error: 'Incorrect username/email or password.' });
  const failKey = identifier.trim().toLowerCase();
  // Brute-force backoff: after repeated failures this identifier is paused for a growing amount of time.
  const lockedFor = loginLockRemaining(failKey);
  if (lockedFor > 0) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(lockedFor / 60_000)} minute(s).`, captchaRequired: true });
  }
  // Captcha is only required once this identifier has racked up a couple of failures,
  // so a normal user typing their password correctly the first time is never bothered
  // by it -- but it's enforced here server-side regardless of what the client shows.
  if (loginFailureCount(failKey) >= LOGIN_CAPTCHA_THRESHOLD) {
    if (!(await verifyCaptcha(captchaToken))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.', captchaRequired: true });
  }
  const user = identifier.includes('@') ? await getUserByEmail(identifier.trim()) : await getUserByUsername(identifier.trim());
  const fail = () => {
    const count = recordLoginFailure(failKey);
    return res.status(401).json({ error: 'Incorrect username/email or password.', captchaRequired: count >= LOGIN_CAPTCHA_THRESHOLD });
  };
  if (!user) {
    await verifyAgainstDummy(password); // same work as a real check, so timing doesn't reveal which usernames exist
    return fail();
  }
  try {
    if (!(await verifyPassword(password, user.password_hash))) return fail();
    clearLoginFailures(failKey);
    // Accounts that predate the policy, or that accepted an older version, must agree again before a session is issued.
    if (user.consent_version !== POLICY_VERSION) {
      if (acceptTerms !== true) return res.status(400).json({ error: 'Please agree to the Terms of Service and Privacy Policy to continue.', consentRequired: true });
      await db.run('UPDATE users SET consent_version = ?, consent_at = ? WHERE id = ?', [POLICY_VERSION, Date.now(), user.id]);
    }
    // Quietly upgrade hashes made with an older, cheaper bcrypt cost.
    if (needsRehash(user.password_hash)) {
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id]).catch(() => {});
    }
    await startSession(req, res, await getUserById(user.id));
  } catch (err) {
    console.error('[auth] login failed:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Login failed. Try again.' });
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
  if (!(await verifyCaptcha(captchaToken))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  const GENERIC = { message: 'If an account exists, we sent a code to its email address.' };
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 200) return res.json(GENERIC);
  const normalized = identifier.trim();
  // Rate-limited before lookup, and identically regardless of outcome below, so
  // neither the 429 nor the 200 ever reveals whether the account exists. (Keys are hashed so
  // the limiter's memory never holds a raw email address.)
  if (rateLimited(`forgot-id:${hashWithPepper(normalized.toLowerCase())}`, 3, 60 * 60_000) || rateLimited(`forgot-ip:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  const user = normalized.includes('@') ? await getUserByEmail(normalized) : await getUserByUsername(normalized);
  if (user && user.email) {
    await db.run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [user.id]);
    const code = generateResetCode();
    const now = Date.now();
    await db.run(
      'INSERT INTO password_resets (id, user_id, code_hash, code_expires_at, attempts, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      [newId(), user.id, hashWithPepper(code), now + RESET_CODE_TTL_MS, now]
    );
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
  if (!(await verifyCaptcha(captchaToken))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  const GENERIC = { message: 'If an account exists with that email, we sent its username.' };
  if (typeof email !== 'string' || !isValidEmail(email)) return res.json(GENERIC);
  if (rateLimited(`forgot-uname-id:${hashWithPepper(email.toLowerCase())}`, 3, 60 * 60_000) || rateLimited(`forgot-uname-ip:${req.ip}`, 10, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  const user = await getUserByEmail(email);
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
  if (typeof identifier !== 'string' || typeof code !== 'string' || !identifier.trim() || !code.trim() || identifier.length > 200 || code.length > 20) return res.status(400).json(BAD);
  const user = identifier.includes('@') ? await getUserByEmail(identifier.trim()) : await getUserByUsername(identifier.trim());
  if (!user) return res.status(400).json(BAD);
  const row = await db.get(
    'SELECT * FROM password_resets WHERE user_id = ? AND code_hash IS NOT NULL AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );
  if (!row || !row.code_expires_at || row.code_expires_at < Date.now()) return res.status(400).json(BAD);
  if (row.attempts >= RESET_MAX_CODE_ATTEMPTS) return res.status(400).json({ error: 'Too many attempts, try again in a few minutes.' });
  if (!safeEqual(hashWithPepper(code.trim()), row.code_hash)) {
    const nextAttempts = row.attempts + 1;
    if (nextAttempts >= RESET_MAX_CODE_ATTEMPTS) {
      await db.run('UPDATE password_resets SET attempts = ?, code_hash = NULL WHERE id = ?', [nextAttempts, row.id]);
      return res.status(400).json({ error: 'Too many attempts, try again in a few minutes.' });
    }
    await db.run('UPDATE password_resets SET attempts = ? WHERE id = ?', [nextAttempts, row.id]);
    return res.status(400).json({ error: `That code isn't right. ${RESET_MAX_CODE_ATTEMPTS - nextAttempts} tries left.` });
  }
  const resetToken = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  await db.run(
    'UPDATE password_resets SET verified_at = ?, reset_token_hash = ?, reset_token_expires_at = ?, code_hash = NULL WHERE id = ?',
    [now, hashWithPepper(resetToken), now + RESET_TOKEN_TTL_MS, row.id]
  );
  res.json({ resetToken });
});

app.post('/api/auth/reset-password', async (req, res) => {
  if (rateLimited(`reset-password:${req.ip}`, 20, 60 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const { resetToken, password } = req.body || {};
  const INVALID = { error: 'That reset link is invalid or expired. Start over.' };
  if (typeof resetToken !== 'string' || !resetToken) return res.status(400).json(INVALID);
  const row = await db.get('SELECT * FROM password_resets WHERE reset_token_hash = ? AND used_at IS NULL', [hashWithPepper(resetToken)]);
  if (!row || !row.reset_token_expires_at || row.reset_token_expires_at < Date.now()) return res.status(400).json(INVALID);
  const owner = await getUserById(row.user_id);
  const pwProblem = passwordProblem(password, { username: owner && owner.username, email: owner && owner.email });
  if (pwProblem) return res.status(400).json({ error: pwProblem });
  try {
    const hash = await hashPassword(password);
    const now = Date.now();
    // Bumping token_version invalidates every session token issued before this
    // moment -- the same "log out everywhere" mechanism POST /api/auth/logout uses.
    await db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, row.user_id]);
    await db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', [now, row.id]);
    const user = await getUserById(row.user_id);
    clearLoginFailures(user.username.toLowerCase());
    if (user.email) clearLoginFailures(user.email.toLowerCase());
    await startSession(req, res, user);
  } catch (err) {
    console.error('[auth] password reset failed:', err.code || err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Could not reset the password. Try again.' });
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
  // consent=1 is only sent by the page once the "I agree to the Terms and Privacy Policy" box is ticked.
  oauthStates.set(state, { verifier, provider, consent: req.query.consent === '1', expiresAt: Date.now() + 5 * 60_000 });
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
    const user = await findOrCreateOAuthUser(provider, profile, entry.consent);
    const exchangeCode = crypto.randomBytes(24).toString('base64url');
    oauthExchangeCodes.set(exchangeCode, { userId: user.id, expiresAt: Date.now() + 60_000 });
    res.redirect(`/?oauth=${exchangeCode}`);
  } catch (err) {
    if (err instanceof OAuthEmailInUseError) return res.redirect('/?oauthError=email_in_use');
    if (err instanceof OAuthConsentRequiredError) return res.redirect('/?oauthError=consent');
    console.error(`[oauth] ${provider} sign-in failed:`, err.message);
    res.redirect('/?oauthError=1');
  }
});

/* One-time code -> session cookie, so the session itself never appears in a
   URL (server access logs, browser history, Referer headers). */
app.post('/api/auth/oauth/exchange', async (req, res) => {
  const code = req.body && req.body.code;
  const entry = typeof code === 'string' ? oauthExchangeCodes.get(code) : null;
  if (entry) oauthExchangeCodes.delete(code);
  if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: 'Invalid or expired sign-in code.' });
  const user = await getUserById(entry.userId);
  if (!user) return res.status(400).json({ error: 'Invalid or expired sign-in code.' });
  await startSession(req, res, user);
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'Account no longer exists.' });
  res.json(await sessionBody(user, req.sessionToken));
});

/* One-time migration for people who were already signed in when sessions moved from a token kept in the
   page's localStorage (readable by scripts) to an HttpOnly cookie. The old token is accepted here, and only
   here, to mint the cookie; the page then deletes its stored copy. Nothing else accepts a bearer token. */
app.post('/api/auth/session/upgrade', async (req, res) => {
  if (rateLimited(`upgrade:${req.ip}`, 30, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const header = req.headers.authorization || '';
  const payload = header.startsWith('Bearer ') ? verifyToken(header.slice(7)) : null;
  const user = payload && (await getUserById(payload.userId));
  if (!user || user.token_version !== payload.tokenVersion) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  await startSession(req, res, user);
});

/* Records acceptance of the current Terms of Service + Privacy Policy (shown to people who signed up
   before they existed, or when they change). */
app.post('/api/account/consent', requireAuth, async (req, res) => {
  if (!req.body || req.body.accept !== true) return res.status(400).json({ error: 'You must agree to the Terms of Service and Privacy Policy to keep using your account.' });
  await db.run('UPDATE users SET consent_version = ?, consent_at = ? WHERE id = ?', [POLICY_VERSION, Date.now(), req.userId]);
  res.json({ ok: true, policyVersion: POLICY_VERSION });
});

app.patch('/api/auth/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
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
  await db.run(
    'UPDATE users SET display_name = ?, bio = ?, avatar = ?, avatar_url = ? WHERE id = ?',
    [displayName || user.username, bio, avatar, avatarUrl, req.userId]
  );
  res.json({ user: publicUser(await getUserById(req.userId)) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await db.run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.userId]);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/* ============================== users ============================== */

app.get('/api/users/search', requireAuth, async (req, res) => {
  if (rateLimited(`search:${req.userId}`, 30, 60_000)) return res.status(429).json({ error: 'Too many searches. Try again shortly.' });
  const q = String(req.query.q || '').trim().slice(0, 40);
  if (q.length < 2) return res.json({ users: [] });
  const pattern = `%${escapeLike(q)}%`;
  const rows = await db.all(
    `SELECT * FROM users WHERE id != ? AND (username LIKE ? OR display_name LIKE ?) ORDER BY username LIMIT 20`,
    [req.userId, pattern, pattern]
  );
  const results = await Promise.all(rows.map(async (row) => {
    const relationship = await relationshipBetween(req.userId, row.id);
    return relationship === 'friends' ? publicUser(row, { relationship }) : strangerUser(row, { relationship });
  }));
  res.json({ users: results });
});

async function relationshipBetween(me, other) {
  if (await areFriends(me, other)) return 'friends';
  const out = await db.get(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`, [me, other]);
  if (out) return 'pending_out';
  const inc = await db.get(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`, [other, me]);
  if (inc) return 'pending_in';
  return 'none';
}

app.get('/api/users/:id', requireAuth, async (req, res) => {
  const user = await getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const relationship = await relationshipBetween(req.userId, user.id);
  res.json({ user: relationship === 'friends' || user.id === req.userId ? publicUser(user, { relationship }) : strangerUser(user, { relationship }) });
});

/* ============================== friends ============================== */

app.get('/api/friends', requireAuth, async (req, res) => {
  const rows = await db.all(
    `SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY LOWER(u.display_name)`,
    [req.userId]
  );
  res.json({ friends: rows.map((r) => publicUser(r)) });
});

app.get('/api/friends/requests', requireAuth, async (req, res) => {
  /* r.id is aliased because `u.*` also expands to a column named `id`
     (the joined user's id), which would otherwise silently overwrite the
     friend_requests row's own id in the result object. */
  const incomingRows = await db.all(
    `SELECT r.id AS request_id, r.created_at, u.* FROM friend_requests r JOIN users u ON u.id = r.from_user_id
     WHERE r.to_user_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`,
    [req.userId]
  );
  const outgoingRows = await db.all(
    `SELECT r.id AS request_id, r.created_at, u.* FROM friend_requests r JOIN users u ON u.id = r.to_user_id
     WHERE r.from_user_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`,
    [req.userId]
  );
  const incoming = incomingRows.map((r) => ({ id: r.request_id, createdAt: r.created_at, user: publicUser(r) }));
  const outgoing = outgoingRows.map((r) => ({ id: r.request_id, createdAt: r.created_at, user: publicUser(r) }));
  res.json({ incoming, outgoing });
});

app.post('/api/friends/requests', requireAuth, async (req, res) => {
  if (rateLimited(`friend-req:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many friend requests. Try again shortly.' });
  const toUserId = req.body && req.body.toUserId;
  if (!toUserId || typeof toUserId !== 'string') return res.status(400).json({ error: 'toUserId is required.' });
  if (toUserId === req.userId) return res.status(400).json({ error: "You can't friend yourself." });
  const target = await getUserById(toUserId);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (await areFriends(req.userId, toUserId)) return res.status(409).json({ error: 'You are already friends.' });

  const mine = await db.get(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`, [req.userId, toUserId]);
  if (mine) return res.status(409).json({ error: 'Friend request already sent.' });

  /* They already asked us -- accept theirs instead of creating a duplicate. */
  const theirs = await db.get(`SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`, [toUserId, req.userId]);
  if (theirs) {
    await acceptRequest(theirs.id, req.userId);
    return res.status(200).json({ status: 'friends', user: publicUser(await getUserById(toUserId)) });
  }

  const id = newId();
  const created_at = Date.now();
  await db.run(
    `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
    [id, req.userId, toUserId, created_at]
  );
  const me = await getUserById(req.userId);
  const notification = await createNotification(toUserId, 'friend_request', { requestId: id, from: publicUser(me) });
  sendToUser(toUserId, { type: 'friend-request', request: { id, createdAt: created_at, user: publicUser(me) } });
  res.status(201).json({ status: 'pending_out', requestId: id, notification });
});

async function acceptRequest(requestId, byUserId) {
  const request = await db.get('SELECT * FROM friend_requests WHERE id = ?', [requestId]);
  if (!request || request.to_user_id !== byUserId || request.status !== 'pending') return null;
  const now = Date.now();
  await db.run(`UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE id = ?`, [now, requestId]);
  await db.run('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [request.from_user_id, request.to_user_id, now]);
  await db.run('INSERT INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', [request.to_user_id, request.from_user_id, now]);

  const accepter = await getUserById(byUserId);
  const requester = await getUserById(request.from_user_id);
  await createNotification(request.from_user_id, 'friend_accept', { by: publicUser(accepter) });
  sendToUser(request.from_user_id, { type: 'friend-accept', friend: publicUser(accepter) });
  await broadcastPresenceToFriends(byUserId);
  await broadcastPresenceToFriends(request.from_user_id);
  return { requester: publicUser(requester), accepter: publicUser(accepter) };
}

app.post('/api/friends/requests/:id/accept', requireAuth, async (req, res) => {
  const result = await acceptRequest(req.params.id, req.userId);
  if (!result) return res.status(404).json({ error: 'Request not found or already handled.' });
  res.json({ friend: result.requester });
});

app.post('/api/friends/requests/:id/reject', requireAuth, async (req, res) => {
  const request = await db.get('SELECT * FROM friend_requests WHERE id = ?', [req.params.id]);
  if (!request || request.to_user_id !== req.userId || request.status !== 'pending') return res.status(404).json({ error: 'Request not found or already handled.' });
  await db.run(`UPDATE friend_requests SET status = 'rejected', responded_at = ? WHERE id = ?`, [Date.now(), req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/friends/requests/:id', requireAuth, async (req, res) => {
  const request = await db.get('SELECT * FROM friend_requests WHERE id = ?', [req.params.id]);
  if (!request || request.from_user_id !== req.userId || request.status !== 'pending') return res.status(404).json({ error: 'Request not found.' });
  await db.run(`UPDATE friend_requests SET status = 'cancelled', responded_at = ? WHERE id = ?`, [Date.now(), req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/friends/:friendId', requireAuth, async (req, res) => {
  await db.run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', [req.userId, req.params.friendId]);
  await db.run('DELETE FROM friendships WHERE user_id = ? AND friend_id = ?', [req.params.friendId, req.userId]);
  res.json({ ok: true });
});

/* ============================== conversations / messages ============================== */

app.get('/api/conversations', requireAuth, async (req, res) => {
  const friends = await db.all(
    `SELECT u.* FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?`,
    [req.userId]
  );
  const list = await Promise.all(friends.map(async (friend) => {
    const [a, b] = pairKey(req.userId, friend.id);
    const conv = await db.get('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?', [a, b]);
    let lastMessage = null, unreadCount = 0;
    if (conv) {
      lastMessage = await db.get('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1', [conv.id]);
      const unreadRow = await db.get(`SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL`, [conv.id, friend.id]);
      unreadCount = unreadRow.c;
    }
    return {
      friend: publicUser(friend),
      lastMessage: lastMessage ? { text: lastMessage.text, senderId: lastMessage.sender_id, createdAt: lastMessage.created_at } : null,
      unreadCount,
    };
  }));
  list.sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  res.json({ conversations: list });
});

app.get('/api/conversations/:friendId/messages', requireAuth, async (req, res) => {
  const friendId = req.params.friendId;
  if (!(await areFriends(req.userId, friendId))) return res.status(403).json({ error: 'You can only view conversations with friends.' });
  const conv = await getOrCreateConversation(req.userId, friendId);
  const beforeNum = Number(req.query.before);
  const before = req.query.before && Number.isFinite(beforeNum) ? Math.trunc(beforeNum) : Date.now() + 1;
  const limit = Math.max(1, Math.min(Math.trunc(Number(req.query.limit)) || 50, 100));
  const rows = await db.all(
    `SELECT * FROM messages WHERE conversation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
    [conv.id, before, limit]
  );
  rows.reverse();
  res.json({ messages: rows.map((m) => ({ id: m.id, text: m.text, senderId: m.sender_id, createdAt: m.created_at, readAt: m.read_at })) });
});

app.post('/api/conversations/:friendId/messages', requireAuth, async (req, res) => {
  if (rateLimited(`message:${req.userId}`, 60, 60_000)) return res.status(429).json({ error: 'Sending too fast. Try again shortly.' });
  const friendId = req.params.friendId;
  if (!(await areFriends(req.userId, friendId))) return res.status(403).json({ error: 'You can only message friends.' });
  const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
  if (!text) return res.status(400).json({ error: 'Message text is required.' });
  const conv = await getOrCreateConversation(req.userId, friendId);
  const id = newId();
  const created_at = Date.now();
  await db.run('INSERT INTO messages (id, conversation_id, sender_id, text, created_at) VALUES (?, ?, ?, ?, ?)', [id, conv.id, req.userId, text, created_at]);
  const message = { id, conversationId: conv.id, text, senderId: req.userId, createdAt: created_at, readAt: null };
  sendToUser(friendId, { type: 'message', message });
  sendToUser(req.userId, { type: 'message', message });
  await createNotification(friendId, 'message', { from: publicUser(await getUserById(req.userId)), preview: text.slice(0, 120), conversationId: conv.id });
  res.status(201).json({ message });
});

app.post('/api/conversations/:friendId/read', requireAuth, async (req, res) => {
  const friendId = req.params.friendId;
  if (!(await areFriends(req.userId, friendId))) return res.status(403).json({ error: 'Not friends.' });
  const [a, b] = pairKey(req.userId, friendId);
  const conv = await db.get('SELECT * FROM conversations WHERE user_a = ? AND user_b = ?', [a, b]);
  if (conv) {
    await db.run(`UPDATE messages SET read_at = ? WHERE conversation_id = ? AND sender_id = ? AND read_at IS NULL`, [Date.now(), conv.id, friendId]);
  }
  res.json({ ok: true });
});

/* ============================== notifications ============================== */

app.get('/api/notifications', requireAuth, async (req, res) => {
  const rows = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.userId]);
  const unreadRow = await db.get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', [req.userId]);
  res.json({
    notifications: rows.map((n) => ({ id: n.id, type: n.type, data: JSON.parse(n.data), createdAt: n.created_at, readAt: n.read_at })),
    unreadCount: unreadRow.c,
  });
});

app.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', [Date.now(), req.params.id, req.userId]);
  res.json({ ok: true });
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [Date.now(), req.userId]);
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
/* The code IS the access control for a room (anyone holding it can join), so it is drawn from a CSPRNG and is long
   enough (8 words x 32^4 = ~8 million) that guessing one is hopeless under the join rate limit. Rooms created
   before this change keep their shorter codes until they empty out. */
function generateRoomCode() {
  const word = ROOM_CODE_WORDS[crypto.randomInt(ROOM_CODE_WORDS.length)];
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)];
  return `${word}-${suffix}`;
}
const ROOM_STATUSES = ['idle', 'focusing', 'resting'];
const MIN_SPRINT_POMODOROS = 1;
const MAX_SPRINT_POMODOROS = 12;
const SPRINT_FOCUS_RANGE = [5, 120];
const SPRINT_BREAK_RANGE = [1, 60];

function getRoomByCode(code) { return db.get('SELECT * FROM rooms WHERE LOWER(code) = LOWER(?)', [code]); }
function getRoomById(id) { return db.get('SELECT * FROM rooms WHERE id = ?', [id]); }
function getMembership(roomId, userId) { return db.get('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]); }
/** A user can only ever be seated in one room; this is how callers find "their" room. */
function getCurrentRoomMembership(userId) {
  return db.get(
    `SELECT room_members.*, rooms.code AS room_code FROM room_members JOIN rooms ON rooms.id = room_members.room_id WHERE room_members.user_id = ?`,
    [userId]
  );
}

async function publicRoom(room) {
  const memberRows = await db.all(
    `SELECT rm.*, u.display_name, u.username, u.avatar, u.avatar_url FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ? ORDER BY rm.joined_at ASC`,
    [room.id]
  );
  return {
    code: room.code,
    goal: room.goal,
    hostId: room.host_user_id,
    createdAt: room.created_at,
    mission: room.mission_state
      ? { targetPomodoros: room.mission_target, state: room.mission_state, focusMinutes: room.mission_focus_min || 25, breakMinutes: room.mission_break_min || 5 }
      : null,
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

async function broadcastRoom(roomId) {
  const room = await getRoomById(roomId);
  if (!room) return;
  const payload = { type: 'lounge-room', room: await publicRoom(room) };
  const memberRows = await db.all('SELECT user_id FROM room_members WHERE room_id = ?', [roomId]);
  for (const { user_id } of memberRows) sendToUser(user_id, payload);
}

/* Removes a user from whichever room they're currently in (a no-op if none),
   promoting the longest-seated remaining member to host, or deleting the room
   if it's now empty. Called both by an explicit leave and at the start of
   every join, since a user can only be in one room at a time. */
async function leaveCurrentRoom(userId) {
  const membership = await getCurrentRoomMembership(userId);
  if (!membership) return;
  const roomId = membership.room_id;
  removeFromVoice(userId, roomId);
  await db.run('DELETE FROM room_members WHERE room_id = ? AND user_id = ?', [roomId, userId]);
  const remaining = await db.all('SELECT * FROM room_members WHERE room_id = ? ORDER BY joined_at ASC', [roomId]);
  if (remaining.length === 0) {
    await db.run('DELETE FROM rooms WHERE id = ?', [roomId]);
    return;
  }
  const room = await getRoomById(roomId);
  if (room.host_user_id === userId) {
    await db.run('UPDATE rooms SET host_user_id = ? WHERE id = ?', [remaining[0].user_id, roomId]);
  }
  await broadcastRoom(roomId);
}

async function joinRoomByCode(userId, code) {
  const room = await getRoomByCode(code);
  if (!room) return { error: 'not_found' };
  if (await getMembership(room.id, userId)) return { room }; // already seated here -- idempotent, not an error
  await leaveCurrentRoom(userId);
  const now = Date.now();
  await db.run(
    `INSERT INTO room_members (room_id, user_id, joined_at, status, remaining_ms, status_updated_at, mission_progress, mission_state)
     VALUES (?, ?, ?, 'idle', 0, ?, 0, 'pending')`,
    [room.id, userId, now, now]
  );
  await broadcastRoom(room.id);
  return { room };
}

/** Returns true if a sprint just completed (every seated member checked in). Resets it either way once done. */
async function checkMissionCompletion(roomId) {
  const room = await getRoomById(roomId);
  if (!room || room.mission_state !== 'active') return false;
  const members = await db.all('SELECT mission_state FROM room_members WHERE room_id = ?', [roomId]);
  if (members.length === 0 || !members.every((m) => m.mission_state === 'checked-in')) return false;
  await db.run('UPDATE rooms SET mission_target = NULL, mission_state = NULL WHERE id = ?', [roomId]);
  await db.run(`UPDATE room_members SET mission_progress = 0, mission_state = 'pending' WHERE room_id = ?`, [roomId]);
  return true;
}

app.post('/api/lounge/rooms', requireAuth, async (req, res) => {
  if (rateLimited(`room-create:${req.userId}`, 10, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const goal = typeof req.body.goal === 'string' ? req.body.goal.trim().slice(0, 80) : '';
  await leaveCurrentRoom(req.userId);
  const id = newId();
  const now = Date.now();
  let code = generateRoomCode();
  for (let i = 0; i < 10 && (await getRoomByCode(code)); i += 1) code = generateRoomCode();
  await db.run('INSERT INTO rooms (id, code, host_user_id, goal, created_at) VALUES (?, ?, ?, ?, ?)', [id, code, req.userId, goal, now]);
  await db.run(
    `INSERT INTO room_members (room_id, user_id, joined_at, status, remaining_ms, status_updated_at, mission_progress, mission_state)
     VALUES (?, ?, ?, 'idle', 0, ?, 0, 'pending')`,
    [id, req.userId, now, now]
  );
  res.status(201).json({ room: await publicRoom(await getRoomById(id)) });
});

// Registered before /:code so the literal path "mine" can never be swallowed as a room code param.
app.get('/api/lounge/rooms/mine', requireAuth, async (req, res) => {
  const membership = await getCurrentRoomMembership(req.userId);
  res.json({ room: membership ? await publicRoom(await getRoomById(membership.room_id)) : null });
});

app.get('/api/lounge/rooms/:code', requireAuth, async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room || !(await getMembership(room.id, req.userId))) return res.status(404).json({ error: 'Room not found.' });
  res.json({ room: await publicRoom(room) });
});

app.post('/api/lounge/rooms/:code/join', requireAuth, async (req, res) => {
  if (rateLimited(`room-join:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  const result = await joinRoomByCode(req.userId, req.params.code);
  if (result.error) return res.status(404).json({ error: 'No room with that code.' });
  res.json({ room: await publicRoom(await getRoomById(result.room.id)) });
});

app.post('/api/lounge/rooms/:code/leave', requireAuth, async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room || !(await getMembership(room.id, req.userId))) return res.status(404).json({ error: 'You are not in that room.' });
  await leaveCurrentRoom(req.userId);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/status', requireAuth, async (req, res) => {
  if (rateLimited(`room-status:${req.userId}`, 60, 60_000)) return res.status(429).json({ error: 'Too many updates. Try again shortly.' });
  const room = await getRoomByCode(req.params.code);
  if (!room || !(await getMembership(room.id, req.userId))) return res.status(404).json({ error: 'You are not in that room.' });
  const status = ROOM_STATUSES.includes(req.body.status) ? req.body.status : 'idle';
  const remainingMs = Number.isFinite(req.body.remainingMs) ? Math.max(0, Math.min(req.body.remainingMs, 4 * 60 * 60_000)) : 0;
  await db.run(
    'UPDATE room_members SET status = ?, remaining_ms = ?, status_updated_at = ? WHERE room_id = ? AND user_id = ?',
    [status, remainingMs, Date.now(), room.id, req.userId]
  );
  await broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/start', requireAuth, async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room || !(await getMembership(room.id, req.userId))) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.host_user_id !== req.userId) return res.status(403).json({ error: 'Only the host can start a sprint.' });
  const memberCountRow = await db.get('SELECT COUNT(*) AS c FROM room_members WHERE room_id = ?', [room.id]);
  if (memberCountRow.c < 2) return res.status(400).json({ error: 'Need at least 2 members to start a sprint.' });
  if (room.mission_state === 'active') return res.status(409).json({ error: 'A sprint is already active.' });
  const target = Number(req.body.targetPomodoros);
  if (!Number.isInteger(target) || target < MIN_SPRINT_POMODOROS || target > MAX_SPRINT_POMODOROS) {
    return res.status(400).json({ error: `Sprint length must be a whole number from ${MIN_SPRINT_POMODOROS} to ${MAX_SPRINT_POMODOROS} pomodoros.` });
  }
  // Older clients send no durations; fall back to the classic 25/5.
  const focus = req.body.focusMinutes === undefined ? 25 : Number(req.body.focusMinutes);
  const brk = req.body.breakMinutes === undefined ? 5 : Number(req.body.breakMinutes);
  if (!Number.isInteger(focus) || focus < SPRINT_FOCUS_RANGE[0] || focus > SPRINT_FOCUS_RANGE[1]) {
    return res.status(400).json({ error: `Focus length must be a whole number from ${SPRINT_FOCUS_RANGE[0]} to ${SPRINT_FOCUS_RANGE[1]} minutes.` });
  }
  if (!Number.isInteger(brk) || brk < SPRINT_BREAK_RANGE[0] || brk > SPRINT_BREAK_RANGE[1]) {
    return res.status(400).json({ error: `Break length must be a whole number from ${SPRINT_BREAK_RANGE[0]} to ${SPRINT_BREAK_RANGE[1]} minutes.` });
  }
  await db.run('UPDATE rooms SET mission_target = ?, mission_state = ?, mission_focus_min = ?, mission_break_min = ? WHERE id = ?', [target, 'active', focus, brk, room.id]);
  await db.run(`UPDATE room_members SET mission_progress = 0, mission_state = 'pending' WHERE room_id = ?`, [room.id]);
  await broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/cancel', requireAuth, async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  if (!room || !(await getMembership(room.id, req.userId))) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.host_user_id !== req.userId) return res.status(403).json({ error: 'Only the host can cancel a sprint.' });
  await db.run('UPDATE rooms SET mission_target = NULL, mission_state = NULL WHERE id = ?', [room.id]);
  await db.run(`UPDATE room_members SET mission_progress = 0, mission_state = 'pending' WHERE room_id = ?`, [room.id]);
  await broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/checkin', requireAuth, async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  const membership = room && (await getMembership(room.id, req.userId));
  if (!membership) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.mission_state !== 'active' || membership.mission_state !== 'pending') return res.status(400).json({ error: 'No active sprint to check in to.' });
  const progress = membership.mission_progress + 1;
  const done = progress >= room.mission_target;
  await db.run(
    'UPDATE room_members SET mission_progress = ?, mission_state = ? WHERE room_id = ? AND user_id = ?',
    [progress, done ? 'checked-in' : 'pending', room.id, req.userId]
  );
  if (done && (await checkMissionCompletion(room.id))) {
    const memberRows = await db.all('SELECT user_id FROM room_members WHERE room_id = ?', [room.id]);
    for (const { user_id } of memberRows) sendToUser(user_id, { type: 'lounge-mission-complete', roomCode: room.code });
  }
  await broadcastRoom(room.id);
  res.json({ ok: true });
});

app.post('/api/lounge/rooms/:code/mission/giveup', requireAuth, async (req, res) => {
  const room = await getRoomByCode(req.params.code);
  const membership = room && (await getMembership(room.id, req.userId));
  if (!membership) return res.status(404).json({ error: 'You are not in that room.' });
  if (room.mission_state !== 'active' || membership.mission_state !== 'pending') return res.status(400).json({ error: 'No active sprint to give up on.' });
  await db.run(`UPDATE room_members SET mission_state = 'abandoned' WHERE room_id = ? AND user_id = ?`, [room.id, req.userId]);
  await broadcastRoom(room.id);
  res.json({ ok: true });
});

/* -------- shared room chat --------
   Text + optional image, readable by every current member. History is served on join;
   new messages are pushed over the WebSocket like every other room event. Everything is
   in Postgres and cascades away with the room (see room_messages in db.js). */

const CHAT_MAX_TEXT = 1000;
const CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const CHAT_HISTORY_LIMIT = 200;

/** Identifies an image by its file signature (never trusting the client-declared type). SVG is
    deliberately unsupported: it can carry script. Returns the canonical mime or null. */
function sniffImageMime(buf) {
  if (buf.length < 12) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = buf.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const CHAT_SELECT = `SELECT rm.id, rm.sender_id, rm.text, rm.image_mime, rm.created_at, (rm.image IS NOT NULL) AS has_image,
  u.display_name, u.username, u.avatar, u.avatar_url
  FROM room_messages rm JOIN users u ON u.id = rm.sender_id`;
function publicChatMessage(row) {
  return {
    id: row.id,
    text: row.text,
    hasImage: !!row.has_image,
    imageMime: row.has_image ? row.image_mime : null,
    createdAt: row.created_at,
    sender: { id: row.sender_id, displayName: row.display_name, username: row.username, avatar: row.avatar, avatarUrl: row.avatar_url || null },
  };
}

async function requireRoomMember(req, res) {
  const room = await getRoomByCode(req.params.code);
  if (!room || !(await getMembership(room.id, req.userId))) { res.status(404).json({ error: 'You are not in that room.' }); return null; }
  return room;
}

app.get('/api/lounge/rooms/:code/messages', requireAuth, async (req, res) => {
  const room = await requireRoomMember(req, res);
  if (!room) return;
  const rows = await db.all(`${CHAT_SELECT} WHERE rm.room_id = ? ORDER BY rm.created_at DESC LIMIT ${CHAT_HISTORY_LIMIT}`, [room.id]);
  res.json({ messages: rows.reverse().map(publicChatMessage) });
});

app.post('/api/lounge/rooms/:code/messages', requireAuth, async (req, res) => {
  if (rateLimited(`room-chat:${req.userId}`, 30, 60_000)) return res.status(429).json({ error: 'You are sending messages too fast. Try again shortly.' });
  const room = await requireRoomMember(req, res);
  if (!room) return;
  const body = req.body || {};
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > CHAT_MAX_TEXT) return res.status(400).json({ error: `Messages can be at most ${CHAT_MAX_TEXT} characters.` });

  let imageBuf = null;
  let imageMime = null;
  if (body.image !== undefined && body.image !== null) {
    const dataUrl = body.image;
    const comma = typeof dataUrl === 'string' && dataUrl.startsWith('data:') ? dataUrl.indexOf(',') : -1;
    if (comma < 0 || !/^data:image\/(png|jpeg|webp|gif);base64$/.test(dataUrl.slice(0, comma))) {
      return res.status(400).json({ error: 'Only png, jpg, webp or gif images can be sent.' });
    }
    // Buffer.from(…, 'base64') silently skips invalid characters, so check the length bound first.
    if (dataUrl.length - comma > Math.ceil(CHAT_MAX_IMAGE_BYTES * 4 / 3) + 8) return res.status(413).json({ error: 'That image is too large (max 5 MB).' });
    imageBuf = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    if (imageBuf.length > CHAT_MAX_IMAGE_BYTES) return res.status(413).json({ error: 'That image is too large (max 5 MB).' });
    imageMime = sniffImageMime(imageBuf);
    if (!imageMime) return res.status(400).json({ error: 'Only png, jpg, webp or gif images can be sent.' });
  }
  if (!text && !imageBuf) return res.status(400).json({ error: 'Write a message or attach an image.' });

  const id = newId();
  const created_at = Date.now();
  await db.run(
    'INSERT INTO room_messages (id, room_id, sender_id, text, image, image_mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, room.id, req.userId, text, imageBuf, imageMime, created_at]
  );
  const row = await db.get(`${CHAT_SELECT} WHERE rm.id = ?`, [id]);
  const message = publicChatMessage(row);
  const memberRows = await db.all('SELECT user_id FROM room_members WHERE room_id = ?', [room.id]);
  for (const { user_id } of memberRows) sendToUser(user_id, { type: 'room-message', roomCode: room.code, message });
  res.status(201).json({ message });
});

app.get('/api/lounge/rooms/:code/messages/:messageId/image', requireAuth, async (req, res) => {
  const room = await requireRoomMember(req, res);
  if (!room) return;
  const row = await db.get('SELECT image, image_mime FROM room_messages WHERE id = ? AND room_id = ? AND image IS NOT NULL', [req.params.messageId, room.id]);
  if (!row) return res.status(404).json({ error: 'Image not found.' });
  res.set('Content-Type', row.image_mime);
  res.set('Cache-Control', 'private, max-age=86400');
  res.send(row.image);
});

/* -------- voice chat signaling --------
   Audio itself is peer-to-peer WebRTC; the server only relays the SDP/ICE handshake between
   members of the SAME room and tracks who is in voice and their mute/deafen flags. All of
   it is in-memory on purpose: it describes live sockets, so it must vanish with them. */

const VIDEO_KINDS = ['none', 'camera', 'screen'];
/** roomId -> Map<userId, { ws, muted, deafened, video }> ('video' says what, if anything, they are showing) */
const voiceRooms = new Map();

function iceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turnUrls.length) {
    servers.push({ urls: turnUrls, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  }
  return servers;
}
app.get('/api/lounge/voice/ice', requireAuth, (req, res) => res.json({ iceServers: iceServers() }));

function sendVoice(entry, payload) {
  if (entry && entry.ws.readyState === entry.ws.OPEN) entry.ws.send(JSON.stringify(payload));
}
function broadcastVoice(roomId, payload, exceptUserId) {
  const peers = voiceRooms.get(roomId);
  if (!peers) return;
  for (const [uid, entry] of peers) if (uid !== exceptUserId) sendVoice(entry, payload);
}
function removeFromVoice(userId, roomId, onlyWs) {
  const peers = voiceRooms.get(roomId);
  const entry = peers && peers.get(userId);
  if (!entry || (onlyWs && entry.ws !== onlyWs)) return;
  peers.delete(userId);
  if (peers.size === 0) voiceRooms.delete(roomId);
  broadcastVoice(roomId, { type: 'voice-peer-left', userId }, userId);
}
function findVoiceRoomId(userId, onlyWs) {
  for (const [roomId, peers] of voiceRooms) {
    const entry = peers.get(userId);
    if (entry && (!onlyWs || entry.ws === onlyWs)) return roomId;
  }
  return null;
}

async function handleVoiceMessage(ws, msg) {
  const userId = ws.userId;
  if (msg.type === 'voice-leave') {
    const roomId = findVoiceRoomId(userId, ws);
    if (roomId) removeFromVoice(userId, roomId, ws);
    return;
  }
  const membership = await getCurrentRoomMembership(userId);
  if (!membership) return;
  const roomId = membership.room_id;

  if (msg.type === 'voice-join') {
    const peers = voiceRooms.get(roomId) || new Map();
    voiceRooms.set(roomId, peers);
    const previous = peers.get(userId);
    if (previous && previous.ws !== ws) sendVoice(previous, { type: 'voice-replaced' }); // same user, second tab
    const muted = !!msg.muted;
    const deafened = !!msg.deafened;
    const video = VIDEO_KINDS.includes(msg.video) ? msg.video : 'none';
    // Tell everyone else first, so a peer that saw the old session drops it before the fresh offer arrives.
    if (previous) broadcastVoice(roomId, { type: 'voice-peer-left', userId }, userId);
    peers.set(userId, { ws, muted, deafened, video });
    const others = [...peers.entries()].filter(([uid]) => uid !== userId).map(([uid, e]) => ({ userId: uid, muted: e.muted, deafened: e.deafened, video: e.video }));
    ws.send(JSON.stringify({ type: 'voice-peers', peers: others }));
    broadcastVoice(roomId, { type: 'voice-peer-joined', userId, muted, deafened, video }, userId);
    return;
  }

  const peers = voiceRooms.get(roomId);
  const self = peers && peers.get(userId);
  if (!self || self.ws !== ws) return; // not in voice from this socket

  if (msg.type === 'voice-state') {
    self.muted = !!msg.muted;
    self.deafened = !!msg.deafened;
    if (VIDEO_KINDS.includes(msg.video)) self.video = msg.video;
    broadcastVoice(roomId, { type: 'voice-state', userId, muted: self.muted, deafened: self.deafened, video: self.video }, userId);
  } else if (msg.type === 'voice-signal') {
    const target = typeof msg.to === 'string' ? peers.get(msg.to) : null;
    if (!target || msg.to === userId) return; // target must be in voice in this same room
    if (msg.data === null || typeof msg.data !== 'object') return;
    sendVoice(target, { type: 'voice-signal', from: userId, data: msg.data });
  }
}

/* -------- room invites: friends only, direct one-click join -------- */

app.post('/api/lounge/invites', requireAuth, async (req, res) => {
  if (rateLimited(`room-invite:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many invites. Try again shortly.' });
  const toUserId = req.body && req.body.toUserId;
  if (!toUserId || typeof toUserId !== 'string') return res.status(400).json({ error: 'toUserId is required.' });
  if (!(await areFriends(req.userId, toUserId))) return res.status(403).json({ error: 'You can only invite friends to your room.' });
  const membership = await getCurrentRoomMembership(req.userId);
  if (!membership) return res.status(400).json({ error: 'Join or create a room before inviting someone.' });
  if (!(await getUserById(toUserId))) return res.status(404).json({ error: 'User not found.' });

  const id = newId();
  const created_at = Date.now();
  await db.run(
    'INSERT INTO room_invites (id, room_id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, membership.room_id, req.userId, toUserId, 'pending', created_at]
  );
  const room = await getRoomById(membership.room_id);
  const inviter = await getUserById(req.userId);
  const invite = { id, roomCode: room.code, goal: room.goal, createdAt: created_at, from: publicUser(inviter) };
  const notification = await createNotification(toUserId, 'lounge_invite', { requestId: id, roomCode: room.code, from: publicUser(inviter) });
  sendToUser(toUserId, { type: 'lounge-invite', invite });
  res.status(201).json({ invite, notification });
});

app.get('/api/lounge/invites', requireAuth, async (req, res) => {
  const rows = await db.all(
    `SELECT ri.*, r.code AS room_code, r.goal AS room_goal FROM room_invites ri JOIN rooms r ON r.id = ri.room_id
     WHERE ri.to_user_id = ? AND ri.status = 'pending' ORDER BY ri.created_at DESC`,
    [req.userId]
  );
  const invites = await Promise.all(rows.map(async (r) => ({
    id: r.id, roomCode: r.room_code, goal: r.room_goal, createdAt: r.created_at, from: publicUser(await getUserById(r.from_user_id)),
  })));
  res.json({ invites });
});

app.post('/api/lounge/invites/:id/accept', requireAuth, async (req, res) => {
  const invite = await db.get('SELECT * FROM room_invites WHERE id = ?', [req.params.id]);
  if (!invite || invite.to_user_id !== req.userId || invite.status !== 'pending') return res.status(404).json({ error: 'Invite not found or already handled.' });
  await db.run(`UPDATE room_invites SET status = 'accepted', responded_at = ? WHERE id = ?`, [Date.now(), req.params.id]);
  const room = await getRoomById(invite.room_id);
  if (!room) return res.status(410).json({ error: 'That room no longer exists.' });
  await joinRoomByCode(req.userId, room.code);
  res.json({ room: await publicRoom(await getRoomById(room.id)) });
});

app.post('/api/lounge/invites/:id/decline', requireAuth, async (req, res) => {
  const invite = await db.get('SELECT * FROM room_invites WHERE id = ?', [req.params.id]);
  if (!invite || invite.to_user_id !== req.userId || invite.status !== 'pending') return res.status(404).json({ error: 'Invite not found or already handled.' });
  await db.run(`UPDATE room_invites SET status = 'declined', responded_at = ? WHERE id = ?`, [Date.now(), req.params.id]);
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

app.post('/api/stats/sessions', requireAuth, async (req, res) => {
  if (rateLimited(`session-log:${req.userId}`, 30, 60_000)) return res.status(429).json({ error: 'Too many session logs. Try again shortly.' });
  const minutes = Math.trunc(Number(req.body && req.body.minutes));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) return res.status(400).json({ error: 'minutes must be between 1 and 180.' });
  const since = Date.now() - 24 * 60 * 60_000;
  const { total } = await db.get('SELECT COALESCE(SUM(minutes), 0) AS total FROM focus_sessions WHERE user_id = ? AND completed_at >= ?', [req.userId, since]);
  if (total + minutes > MAX_DAILY_FOCUS_MINUTES) return res.status(429).json({ error: 'Daily focus limit reached.' });
  await db.run('INSERT INTO focus_sessions (id, user_id, minutes, completed_at) VALUES (?, ?, ?, ?)', [newId(), req.userId, minutes, Date.now()]);
  res.status(201).json({ ok: true });
});

const LEADERBOARD_RANGES = { daily: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000, alltime: null };

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  const range = Object.prototype.hasOwnProperty.call(LEADERBOARD_RANGES, req.query.range) ? req.query.range : 'weekly';
  const since = LEADERBOARD_RANGES[range] === null ? 0 : Date.now() - LEADERBOARD_RANGES[range];
  const friendRows = await db.all('SELECT friend_id FROM friendships WHERE user_id = ?', [req.userId]);
  const ids = [req.userId, ...friendRows.map((r) => r.friend_id)];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT user_id, COALESCE(SUM(minutes), 0) AS "totalMinutes", COUNT(*) AS pomodoros
     FROM focus_sessions WHERE user_id IN (${placeholders}) AND completed_at >= ?
     GROUP BY user_id`,
    [...ids, since]
  );
  const rowByUser = new Map(rows.map((r) => [r.user_id, r]));
  const entries = await Promise.all(ids.map(async (uid) => {
    const row = rowByUser.get(uid);
    return { user: publicUser(await getUserById(uid)), totalMinutes: row ? row.totalMinutes : 0, pomodoros: row ? row.pomodoros : 0 };
  }));
  entries.sort((a, b) => b.totalMinutes - a.totalMinutes || b.pomodoros - a.pomodoros);
  res.json({ range, entries });
});

/* ============================== account: data export & deletion ==============================
   GDPR/UK GDPR rights of access, portability and erasure, available to every signed-in user. */

const iso = (ms) => (Number.isFinite(Number(ms)) && ms !== null ? new Date(Number(ms)).toISOString() : null);
const EXPORT_IMAGE_BUDGET_BYTES = 20 * 1024 * 1024;

app.get('/api/account/export', requireAuth, async (req, res) => {
  if (rateLimited(`export:${req.userId}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'You can download your data a few times per hour. Try again later.' });
  const uid = req.userId;
  const user = await getUserById(uid);
  if (!user) return res.status(404).json({ error: 'Account no longer exists.' });

  const oauth = await db.all('SELECT provider, email, created_at FROM oauth_accounts WHERE user_id = ?', [uid]);
  const friends = await db.all('SELECT u.username, u.display_name, f.created_at FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY f.created_at', [uid]);
  const sent = await db.all('SELECT r.status, r.created_at, r.responded_at, u.username AS other FROM friend_requests r JOIN users u ON u.id = r.to_user_id WHERE r.from_user_id = ? ORDER BY r.created_at', [uid]);
  const received = await db.all('SELECT r.status, r.created_at, r.responded_at, u.username AS other FROM friend_requests r JOIN users u ON u.id = r.from_user_id WHERE r.to_user_id = ? ORDER BY r.created_at', [uid]);

  const convRows = await db.all('SELECT id, user_a, user_b, created_at FROM conversations WHERE user_a = ? OR user_b = ?', [uid, uid]);
  const conversations = [];
  for (const c of convRows) {
    const other = await getUserById(c.user_a === uid ? c.user_b : c.user_a);
    const msgs = await db.all('SELECT sender_id, text, created_at, read_at FROM messages WHERE conversation_id = ? ORDER BY created_at', [c.id]);
    conversations.push({
      with: other ? other.username : null,
      startedAt: iso(c.created_at),
      messages: msgs.map((m) => ({ from: m.sender_id === uid ? 'me' : 'them', text: m.text, sentAt: iso(m.created_at), readAt: iso(m.read_at) })),
    });
  }

  const notifications = await db.all('SELECT type, data, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at', [uid]);
  const membership = await getCurrentRoomMembership(uid);
  const room = membership ? await getRoomById(membership.room_id) : null;
  const roomMessages = await db.all('SELECT text, image, image_mime, created_at FROM room_messages WHERE sender_id = ? ORDER BY created_at', [uid]);
  let imageBytes = 0;
  const invitesSent = await db.all('SELECT status, created_at FROM room_invites WHERE from_user_id = ? ORDER BY created_at', [uid]);
  const invitesReceived = await db.all('SELECT status, created_at FROM room_invites WHERE to_user_id = ? ORDER BY created_at', [uid]);
  const sessions = await db.all('SELECT minutes, completed_at FROM focus_sessions WHERE user_id = ? ORDER BY completed_at', [uid]);

  const payload = {
    about: 'A copy of the personal data Pomodoro Focus (pomodorofocus.site) holds about you on its servers. Your timer, tasks, stats and settings live only in your browser and are not included here. Password hashes and security tokens are deliberately left out.',
    exportedAt: new Date().toISOString(),
    account: {
      id: user.id, username: user.username, email: user.email, displayName: user.display_name, avatarEmoji: user.avatar,
      avatarUrl: user.avatar_url, bio: user.bio, createdAt: iso(user.created_at), lastSeenAt: iso(user.last_seen_at),
      agreedToTermsAndPrivacyVersion: user.consent_version, agreedAt: iso(user.consent_at),
    },
    linkedSignIns: oauth.map((o) => ({ provider: o.provider, email: o.email, linkedAt: iso(o.created_at) })),
    friends: friends.map((f) => ({ username: f.username, displayName: f.display_name, friendsSince: iso(f.created_at) })),
    friendRequestsSent: sent.map((r) => ({ to: r.other, status: r.status, sentAt: iso(r.created_at), respondedAt: iso(r.responded_at) })),
    friendRequestsReceived: received.map((r) => ({ from: r.other, status: r.status, sentAt: iso(r.created_at), respondedAt: iso(r.responded_at) })),
    directMessages: conversations,
    notifications: notifications.map((n) => { let data = null; try { data = JSON.parse(n.data); } catch { /* keep null */ } return { type: n.type, data, createdAt: iso(n.created_at), readAt: iso(n.read_at) }; }),
    currentStudyRoom: room ? { code: room.code, goal: room.goal, joinedAt: iso(membership.joined_at), isHost: room.host_user_id === uid } : null,
    roomChatMessagesYouSent: roomMessages.map((m) => {
      const entry = { text: m.text, sentAt: iso(m.created_at) };
      if (m.image) {
        entry.imageMime = m.image_mime;
        if (imageBytes + m.image.length <= EXPORT_IMAGE_BUDGET_BYTES) { imageBytes += m.image.length; entry.imageBase64 = m.image.toString('base64'); }
        else entry.imageOmitted = 'too large to include in this download; contact us to receive it';
      }
      return entry;
    }),
    roomInvitesSent: invitesSent.map((i) => ({ status: i.status, at: iso(i.created_at) })),
    roomInvitesReceived: invitesReceived.map((i) => ({ status: i.status, at: iso(i.created_at) })),
    completedFocusSessions: sessions.map((x) => ({ minutes: x.minutes, completedAt: iso(x.completed_at) })),
  };
  res.set('Content-Disposition', 'attachment; filename="pomodoro-focus-my-data.json"');
  res.type('application/json').send(JSON.stringify(payload, null, 2));
});

/* Permanently deletes the signed-in user's account and everything tied to it (friendships, requests, direct
   messages in both directions, notifications, room memberships and chat messages, invites, focus sessions,
   linked sign-ins, reset records). Requires re-entering the password (or, for accounts created through
   Google/Microsoft/Facebook, typing the username) so a stolen session alone cannot do it. */
app.post('/api/account/delete', requireAuth, async (req, res) => {
  if (rateLimited(`acct-delete:${req.userId}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  const uid = req.userId;
  const user = await getUserById(uid);
  if (!user) return res.status(404).json({ error: 'Account no longer exists.' });
  const body = req.body || {};
  const oauthLinked = await db.get('SELECT 1 AS linked FROM oauth_accounts WHERE user_id = ? LIMIT 1', [uid]);
  if (oauthLinked) {
    if (typeof body.confirmUsername !== 'string' || body.confirmUsername.trim().toLowerCase() !== user.username.toLowerCase()) {
      return res.status(400).json({ error: 'Type your username exactly to confirm.' });
    }
  } else if (typeof body.password !== 'string' || !body.password || body.password.length > 1000 || !(await verifyPassword(body.password, user.password_hash))) {
    return res.status(400).json({ error: 'That password is incorrect.' });
  }

  const friendIds = (await db.all('SELECT friend_id FROM friendships WHERE user_id = ?', [uid])).map((r) => r.friend_id);
  // Leaving first hands a room the user hosts to its longest-seated member (or removes it if empty) instead of
  // letting the account deletion tear a shared room down around everyone else in it.
  await leaveCurrentRoom(uid);
  for (const hosted of await db.all('SELECT id FROM rooms WHERE host_user_id = ?', [uid])) {
    const next = await db.get('SELECT user_id FROM room_members WHERE room_id = ? AND user_id <> ? ORDER BY joined_at ASC LIMIT 1', [hosted.id, uid]);
    if (next) await db.run('UPDATE rooms SET host_user_id = ? WHERE id = ?', [next.user_id, hosted.id]);
  }
  await db.withTransaction(async (tx) => {
    // Other people's notifications embed a copy of this user's profile (name, avatar, bio) and message previews.
    await tx.run('DELETE FROM notifications WHERE user_id <> ? AND data LIKE ?', [uid, `%"id":"${uid}"%`]);
    await tx.run('DELETE FROM users WHERE id = ?', [uid]); // everything else cascades (see db.js)
  });

  for (const ws of [...(connections.get(uid) || [])]) { try { ws.close(4000, 'account deleted'); } catch { /* already closed */ } }
  for (const friendId of friendIds) sendToUser(friendId, { type: 'friend-removed', userId: uid });
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/* ============================== data retention ==============================
   Short-lived operational records are removed automatically so they don't pile up. Nothing a person wrote
   (messages, profile, friends, focus history) is ever touched here -- that stays until they delete it or
   their account. Kept in step with the retention section of legal/privacy.html. */
async function purgeStaleRecords() {
  const now = Date.now();
  const DAY = 24 * 60 * 60_000;
  try {
    await db.run('DELETE FROM password_resets WHERE created_at < ?', [now - DAY]);
    await db.run(`DELETE FROM friend_requests WHERE status <> 'pending' AND COALESCE(responded_at, created_at) < ?`, [now - 30 * DAY]);
    await db.run(`DELETE FROM room_invites WHERE (status <> 'pending' AND COALESCE(responded_at, created_at) < ?) OR created_at < ?`, [now - 30 * DAY, now - 30 * DAY]);
    await db.run('DELETE FROM notifications WHERE created_at < ?', [now - 90 * DAY]);
  } catch (err) {
    console.error('[retention] purge failed:', err.code || err.message);
  }
}

/* ============================== presence ============================== */

app.get('/api/presence/online-count', (req, res) => res.json({ count: onlineUserCount() }));

/* ============================== static frontend ============================== */

const ROOT_DIR = path.join(__dirname, '..');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');

app.use('/favicon', express.static(path.join(ROOT_DIR, 'favicon'), { maxAge: '1d' }));
// The app's own CSS/JS/JSON: brotli/gzip, content-hashed URLs, long-lived caching (see assets.js) ...
app.use('/assets', Assets.textAssets(path.join(ROOT_DIR, 'assets')));
// ... and the binary font files, which never change under the same name.
app.use('/assets/fonts', express.static(path.join(ROOT_DIR, 'assets', 'fonts'), { maxAge: '365d', immutable: true }));
// Guide videos + guides.json (the list the Guides page reads). Static files only, no user data.
app.use('/guides', express.static(path.join(__dirname, '..', 'guides'), { maxAge: '1d' }));
app.get('/site.webmanifest', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'site.webmanifest'), { maxAge: '1d' });
});

app.get('/', (req, res) => Assets.sendPage(req, res, INDEX_HTML_PATH, ROOT_DIR));

// Legal pages -- a fixed whitelist, never a path taken from the request.
for (const page of ['privacy', 'terms', 'cookies']) {
  const file = path.join(ROOT_DIR, 'legal', `${page}.html`);
  app.get([`/${page}`, `/${page}/`, `/${page}.html`], (req, res) => Assets.sendPage(req, res, file, ROOT_DIR));
}

app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send(`Contact: mailto:${CONTACT_EMAIL}\nPreferred-Languages: en\nCanonical: ${BASE_URL}/.well-known/security.txt\n`);
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
  console.error('[server] unhandled error:', err && (err.code || err.message) || 'unknown');
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' });
});

/* ============================== realtime: presence + push ============================== */

const server = http.createServer(app);
// Clients only ever send small voice-signaling JSON; cap frames so a socket can't push megabytes at us.
const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

const MAX_SOCKETS_TOTAL = 10_000;
const MAX_SOCKETS_PER_USER = 10;
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
async function broadcastPresenceToFriends(userId) {
  const friends = await db.all('SELECT friend_id FROM friendships WHERE user_id = ?', [userId]);
  const user = await getUserById(userId);
  const payload = { type: 'presence', userId, online: isOnline(userId), lastSeenAt: user?.last_seen_at };
  for (const { friend_id } of friends) sendToUser(friend_id, payload);
}
function broadcastOnlineCount() { broadcastAll({ type: 'online-count', count: onlineUserCount() }); }

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  // Browsers always send Origin on a WebSocket handshake. Refuse any page that isn't this site, so another
  // website can't open a socket that rides on a visitor's session cookie (cross-site WebSocket hijacking).
  const origin = req.headers.origin;
  if (origin && !originIsOurs(origin, req)) {
    socket.destroy();
    return;
  }
  req.hasSameSiteOrigin = !!origin; // connections without an Origin (non-browser clients) never get a session
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', async (ws, req) => {
  // The only client->server messages are voice signaling (see handleVoiceMessage); everything else
  // the app does still goes REST -> WS broadcast. Registered before any await below: a client may send
  // its first voice message the instant its socket opens, and ws drops messages that arrive while no
  // listener is attached. Handling is serialized per socket (and waits for auth to resolve) so a
  // join / state / signal sequence is always processed in the order it was sent.
  let authResolved;
  const authReady = new Promise((resolve) => { authResolved = resolve; });
  let queue = Promise.resolve();
  let windowStart = Date.now();
  let windowCount = 0;
  ws.on('message', (data) => {
    const now = Date.now();
    if (now - windowStart > 10_000) { windowStart = now; windowCount = 0; }
    if (++windowCount > 400) return; // flood guard; a full mesh handshake needs far fewer
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('voice-')) return;
    queue = queue
      .then(() => authReady)
      .then(() => (ws.userId ? handleVoiceMessage(ws, msg) : undefined))
      .catch((err) => console.error('[voice] signaling error:', err.message));
  });

  const token = req.hasSameSiteOrigin ? sessionTokenFromRequest(req) : null;
  const payload = token ? verifyToken(token) : null;
  const user = payload ? await getUserById(payload.userId) : null;
  const validSession = !!user && user.token_version === payload.tokenVersion;

  // Connection caps so one person (or a script) can't exhaust the server's memory with sockets.
  if (allSockets.size >= MAX_SOCKETS_TOTAL || (validSession && (connections.get(user.id) || new Set()).size >= MAX_SOCKETS_PER_USER)) {
    authResolved();
    ws.close(1013, 'too many connections');
    return;
  }

  ws.isAlive = true;
  ws.userId = validSession ? user.id : null;
  allSockets.add(ws);

  if (ws.userId) {
    if (!connections.has(ws.userId)) connections.set(ws.userId, new Set());
    const firstConnection = connections.get(ws.userId).size === 0;
    connections.get(ws.userId).add(ws);
    await touchLastSeen(ws.userId);
    if (firstConnection) { await broadcastPresenceToFriends(ws.userId); broadcastOnlineCount(); }
  }

  authResolved();
  ws.send(JSON.stringify({ type: 'online-count', count: onlineUserCount() }));
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('close', async () => {
    allSockets.delete(ws);
    if (!ws.userId) return;
    const voiceRoomId = findVoiceRoomId(ws.userId, ws);
    if (voiceRoomId) removeFromVoice(ws.userId, voiceRoomId, ws);
    const set = connections.get(ws.userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) {
      connections.delete(ws.userId);
      await touchLastSeen(ws.userId);
      await broadcastPresenceToFriends(ws.userId);
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

initSchema()
  .then(() => {
    Assets.preheat(ROOT_DIR, [INDEX_HTML_PATH, ...['privacy', 'terms', 'cookies'].map((p) => path.join(ROOT_DIR, 'legal', `${p}.html`))]);
    setTimeout(purgeStaleRecords, 60_000).unref();
    setInterval(purgeStaleRecords, 6 * 60 * 60_000).unref();
    server.listen(PORT, () => {
      console.log(`Pomodoro server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[db] failed to initialize schema -- refusing to start:', err);
    process.exit(1);
  });

process.on('SIGTERM', () => { clearInterval(heartbeat); server.close(() => process.exit(0)); });
