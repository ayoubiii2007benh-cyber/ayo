# Security Hardening — Design Spec

**Status:** Sub-project 6 of the roadmap agreed 2026-09-25 (after sub-project
1, real auth/friends/presence, shipped and merged to `main`). Scoped against
what actually exists today — real auth, friends, presence, DM chat,
notifications, and the local-only guest timer/tasks. XP, leaderboard, and
study-session server-side validation are explicitly **not** in scope: those
systems don't exist server-side yet (sub-projects 3/4), so "harden the XP
endpoint" has nothing to harden yet. File-upload security and SSRF are also
not in scope — verified below that neither attack surface exists in this
app at all.

## 0. Reconnaissance findings

Read `server/{server,auth,db}.js` in full, re-verified every route's
authorization by hand, ran `npm audit`, and traced every external resource
the frontend loads. Findings:

**Already solid — no changes:**
- Every SQL query is parameterized (`db.prepare(...).run/get/all`); zero
  string-concatenated SQL anywhere.
- Every user-controlled value the frontend renders (names, bios, messages,
  notification text) is set via `textContent`; `innerHTML` only ever
  receives the static internal `Icons` table.
- Every user-scoped route's SQL is `WHERE ... = req.userId` (derived from
  the verified JWT) — friend accept/reject/cancel check ownership of the
  request row, conversations/messages check `areFriends()`, notifications
  are scoped to `user_id = req.userId`. No IDOR found.
- `JWT_SECRET` was never committed to git history (confirmed via
  `git log --all -p` on the path — empty). `publicUser()` never returns
  `email` or `password_hash`.
- `npm audit`: 0 vulnerabilities, all severities, all 5 dependencies.
- Avatar "photos" never reach the server — stored entirely in the
  browser's IndexedDB (`LocalMediaDB`); the server only ever receives an
  8-character emoji string for `avatar`. There is no file-upload endpoint
  to secure.
- No server-side code fetches a user-supplied URL (background image/video
  URLs are rendered directly by the *browser*, never fetched by the
  server) — no SSRF surface.

**Real gaps this spec addresses:**
1. Rate limiting covers only register/login, is IP-keyed with no
   `trust proxy` awareness, and its `attempts` Map never evicts entries.
2. No security headers are set at all today.
3. CORS reflects any origin when `ALLOWED_ORIGIN` is unset.
4. 30-day JWTs with no server-side revocation; WebSocket upgrade has no
   `Origin` check.
5. No security-relevant logging (failed logins, authz failures).

**External resources the frontend actually loads** (this matters for §3):
`fonts.googleapis.com`/`fonts.gstatic.com` (Google Fonts, in the static
`<head>`), `https://www.youtube.com/iframe_api` (a script tag the YouTube
background feature injects, which in turn creates a `youtube.com` iframe),
and `https://generativelanguage.googleapis.com` (the AI chat feature's
Gemini endpoint, called directly from the browser with a user-supplied
key — confirmed already documented in the app's own UI copy as "sent
directly to Google's API").

## 1. Rate limiting

Extend the existing `rateLimited(key, max, windowMs)` helper
(`server/server.js`) — already used for register (10/min/IP) and login
(20/min/IP) — to three more routes, keyed by `req.userId` (these are all
`requireAuth`'d, so the authenticated identity is a precise, un-spoofable
key — no IP/proxy concerns for these three):

- `GET /api/users/search`: 30/min per user.
- `POST /api/friends/requests`: 20/min per user.
- `POST /api/conversations/:friendId/messages`: 60/min per user.

Two bugs in the helper itself, fixed for all callers (existing and new):

```js
// Before: keys on req.ip unconditionally. Behind a reverse proxy (Render,
// any host) every request arrives from the proxy's IP unless the app is
// told to trust X-Forwarded-For -- but trusting it when there is NO real
// proxy in front lets an attacker set that header and claim any IP,
// bypassing the limit entirely. Gate it behind an explicit env var so it's
// only ever on when actually deployed behind a real proxy.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
```

```js
// Before: attempts Map never shrinks -- every distinct key (IP or userId)
// that ever hits a limited route stays in memory forever.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000; // 5x the longest window in use
  for (const [key, record] of attempts) {
    if (record.start < cutoff) attempts.delete(key);
  }
}, 5 * 60_000).unref();
```

(`.unref()` so this interval doesn't keep the process alive on its own —
matches the existing heartbeat interval's behavior in spirit, though that
one is intentionally kept ref'd since the server should stay up for it;
this cleanup timer has no such requirement.)

## 2. Baseline security headers

Add `helmet` (one dependency; `server/package.json`) with its default CSP
module disabled (configured separately in §3) and its frame-options
tightened to match the CSP's `frame-ancestors 'none'` in §3 (helmet's own
default is `SAMEORIGIN`, which would otherwise quietly disagree with it):

```js
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
}));
```

This sets `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (a legacy
fallback for browsers that don't honor CSP's `frame-ancestors`, kept
consistent with it), and HSTS (a no-op locally over plain HTTP; takes
effect once deployed behind real TLS).

## 3. Content-Security-Policy

The whole frontend is one inline `<script>` tag — no separate JS file. A
CSP that allows `'unsafe-inline'` for scripts provides essentially no XSS
protection (the exact vector it exists to close). The fix: serve
`index.html` with a per-request nonce injected into that one script tag,
and scope `script-src` to that nonce instead of `'unsafe-inline'`.

Replace the static `app.get('/', ...)` (currently `res.sendFile`) with:

```js
const fs = require('node:fs');
const INDEX_HTML_PATH = path.join(__dirname, '..', 'index.html');

app.get('/', (req, res) => {
  const nonce = crypto.randomBytes(16).toString('base64');
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8')
    .replace('<script>', `<script nonce="${nonce}">`);
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.youtube.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "frame-src https://www.youtube.com",
    "connect-src 'self' https://generativelanguage.googleapis.com",
    "frame-ancestors 'none'",
  ].join('; '));
  res.type('html').send(html);
});
```

Notes on the looser directives, so a future reader doesn't mistake them
for oversights: `img-src`/`media-src` allow any `https:` source because
Settings lets a user paste an arbitrary background image/video URL —
there is no fixed allowlist to build here without breaking that feature.
`style-src` keeps `'unsafe-inline'` because the app uses inline `style="…"`
attributes throughout (nonce-per-attribute isn't practical); this is a
real, accepted gap in the policy's strictness, scoped to styles only —
`script-src` (the actual XSS vector) stays strict.

`.replace('<script>', ...)` targets the file's one and only inline
`<script>` tag (confirmed: `grep -c '<script' index.html` returns 1 for
the opening tag before this change).

## 4. CORS default

Current: `cors({ origin: allowedOrigins.length ? allowedOrigins : true })`
— reflects any origin when `ALLOWED_ORIGIN` is unset. Since the frontend
is served same-origin by this same Express app, cross-origin access isn't
needed for normal operation. Flip the default to same-origin-only:

```js
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
```

`.env.example`'s existing comment already documents `ALLOWED_ORIGIN` as
something you only set when splitting the frontend onto a different
domain — this change makes the code match that documented intent.

## 5. Session hardening

**Schema.** `server/db.js`, after the `users` table's `CREATE TABLE IF NOT
EXISTS` (which can't add a column to an already-existing table on disk):

```js
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some((c) => c.name === 'token_version')) {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}
```

**Tokens.** `server/auth.js`: TTL `30d` → `7d`. `signToken` embeds the
version; `verifyToken` returns the full payload instead of just the user
id (both its callers need updating — see below):

```js
const TOKEN_TTL = '7d';

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
```

**`requireAuth`** (`server/auth.js`, now needs `db` — no import cycle,
`db.js` has no dependency on `auth.js`):

```js
const { db } = require('./db');
...
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Not authenticated.' });
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.userId);
  if (!row || row.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.userId = payload.userId;
  next();
}
```

One extra indexed-PK SQLite read per authenticated request — the accepted
cost of real revocation without introducing a session store.

**Call sites.** `server/server.js`: `signToken(id)` → `signToken(id, 0)` in
register; `signToken(user.id)` → `signToken(user.id, user.token_version)`
in login. The WebSocket handler's `verifyToken(token)` call now returns a
payload object, not a bare id — update it to also check the version,
falling back to anonymous (not rejecting the upgrade) on mismatch, matching
the existing graceful-degradation pattern for any other invalid token:

```js
const payload = token ? verifyToken(token) : null;
const user = payload ? getUserById(payload.userId) : null;
const validSession = !!user && user.token_version === payload.tokenVersion;
ws.userId = validSession ? user.id : null;
```

**New endpoint:**

```js
app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});
```

There's no per-device session tracking, so bumping the version invalidates
every outstanding token for that user, everywhere — the simplest correct
behavior given the current architecture (logout-everywhere, not
per-device logout).

**Frontend.** `index.html`'s `Auth.logout()` calls the new endpoint,
best-effort (a network failure must not block local logout — matches the
already-established tolerance pattern from sub-project 1's `Auth.init()`
fix):

```js
logout() {
  Api.post('/api/auth/logout').catch(() => {});
  Api.setToken(null);
  Auth.currentUser = null;
  Socket.connect();
  if (typeof UI !== 'undefined') UI.syncAuthUI();
},
```

## 6. WebSocket Origin check

`server.on('upgrade', ...)` currently only checks the URL path. Add an
Origin check, reusing the same `allowedOrigins` list CORS already builds:

```js
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const origin = req.headers.origin;
  if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
```

Guarded on `allowedOrigins.length` so local dev (no `ALLOWED_ORIGIN` set,
same-origin) is unaffected; this only bites once a production origin is
actually configured.

Non-goal: replacing the query-string token with a short-lived one-time
"ws ticket" exchanged via a prior authenticated call. That's a real
additional hardening step, but meaningful added complexity for a
narrower gain now that tokens are already short-lived (§5) — not worth it
in this pass.

## 7. Minimal security logging

`console.warn` (stdout — captured as logs by any host, including Render)
on: a failed login (`identifier` + `req.ip`, never the password), and a
`requireAuth` rejection (route + `req.ip`). Never logs a token or password.

## 8. Dependency audit

Already run: `npm audit` reports 0 vulnerabilities across info/low/
moderate/high/critical for all 5 dependencies (`bcryptjs`, `cors`,
`express`, `jsonwebtoken`, `ws`). No updates needed — documented as
checked in `SECURITY.md` rather than churning version numbers with
nothing to fix. `helmet` (§2) is the one new dependency this spec adds.

## 9. Non-goals

- XP/leaderboard/study-session server-side validation (systems don't
  exist yet — sub-projects 3/4).
- File-upload security (no server-side upload endpoint exists).
- SSRF protection (no server-side URL-fetching exists).
- Per-device session/token tracking (logout-everywhere is the accepted
  behavior for now).
- A one-time WebSocket ticket mechanism (§6).
- Email verification, password complexity rules beyond the existing
  6-200 character check, CAPTCHA — none requested, no evidence of abuse
  yet.

## 10. Testing plan

1. `server/test/e2e.js`: a new block that calls the search endpoint (or
   whichever limited route is cheapest to trigger 31+ times) past its
   limit and asserts a `429`; a block that logs in, calls the new
   `/api/auth/logout`, and asserts the *old* token is now rejected with
   401 on a subsequent authenticated call.
2. Manual/Playwright pass covering every external-resource feature the
   CSP touches, checking the console for CSP violation reports (which
   modern browsers log as console errors — already how this codebase's
   testing catches this class of bug): YouTube background video, the AI
   chat send/receive round trip, a custom background image URL, and
   normal app load (fonts render, inline styles apply).
3. Confirm `helmet`'s headers are present on a response
   (`X-Content-Type-Options`, etc.) and CORS/WS-Origin behave correctly
   both with and without `ALLOWED_ORIGIN` set.
4. Full regression: sign up, log in, log out (confirm re-login required,
   old token rejected), friends/presence/chat/notifications all still
   work — mirroring sub-project 1's Task 11 pass.
