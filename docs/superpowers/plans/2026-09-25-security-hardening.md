# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the real security gaps found in the current backend (rate
limiting, missing headers/CSP, permissive CORS, unrevocable sessions, no
WS origin check, no security logging) without touching the systems that
don't exist yet (XP, leaderboard, file upload, SSRF — verified absent) or
breaking any existing feature, including the AI chat and YouTube
background integrations a naive CSP would silently break.

**Architecture:** All changes are backend (`server/`), plus one small
frontend call site (`index.html`'s `Auth.logout()`). No new services, no
new tables beyond one added column. `helmet` is the one new dependency.

**Tech Stack:** Same as sub-project 1 (Express, `ws`, `node:sqlite`,
bcryptjs, jsonwebtoken), plus `helmet`.

**Spec:** `docs/superpowers/specs/2026-09-25-security-hardening-design.md`

## Global Constraints

- No new dependencies beyond `helmet` — everything else uses what's
  already installed or Node built-ins.
- `TRUST_PROXY=1` must only ever be set when actually deployed behind a
  real reverse proxy — enabling it without one lets a client spoof
  `X-Forwarded-For` and bypass every IP-keyed rate limit.
- Every new/changed route keeps the existing error-response shape
  (`{ error: '<message>' }`) and status-code conventions already used
  throughout `server.js`.
- Never log a password, token, or API key — logging additions (§7 of the
  spec) log only identifiers (username/userId) and IP.
- `server/.env.example` gets a comment for every new env var this plan
  introduces (`TRUST_PROXY`), matching its existing style.

## Review Focus

- Deploying the `token_version` migration invalidates every session that
  existed before it (old tokens carry no `ver` claim, which won't match
  the new column's value) — this is a one-time, expected mass-logout, not
  a bug, but it must be verified to behave as a clean "please log in
  again," not a broken or crashed state (Task 2).
- A legitimate user typing a fast back-and-forth chat conversation, or
  quickly accepting several friend requests in a row, must hit the new
  rate limits (if at all) as a clear, visible message — not a silently
  dropped action or a console error (Task 3/Task 4).
- The CSP must not silently break the AI chat round trip or the YouTube
  background feature — both call external origins a strict CSP could
  block without throwing a normal JS error (it shows only as a CSP
  violation in the console) (Task 7).
- Logout must complete locally (clear the token, return to guest/auth-
  modal state) even when the new server-side logout call fails or the
  network is down (Task 2).
- Once `ALLOWED_ORIGIN` is actually configured (not just left unset for
  local dev), the app's own same-origin WebSocket connection must still
  succeed — the Origin check must not accidentally also block the
  legitimate case it's meant to allow (Task 5).

## File Structure

Most tasks below edit `server/server.js` sequentially, so line numbers
drift as earlier tasks land — each task cites the line number as of this
plan's writing; find the actual current location by the code shown, not
the number alone (the same convention sub-project 1's plan used).

- **`server/package.json` / `package-lock.json`**: add `helmet`.
- **`server/db.js`**: `token_version` column migration.
- **`server/auth.js`**: TTL, `signToken`/`verifyToken` signatures,
  `requireAuth`'s DB check.
- **`server/server.js`**: trust-proxy flag, rate-limit cleanup + new
  limited routes, helmet middleware, CSP nonce route, CORS default,
  WebSocket Origin check + payload handling, new logout endpoint,
  minimal security logging.
- **`server/.env.example`**: document `TRUST_PROXY`.
- **`index.html`**: `Auth.logout()` calls the new endpoint.
- **`server/test/e2e.js`**: rate-limit-429 and logout-invalidates-token
  coverage.
- **`SECURITY.md`** (new, repo root): architecture documentation.

---

### Task 1: Baseline security headers

**Files:**
- Modify: `server/package.json`, `server/server.js:16-18`

**Interfaces:**
- Consumes: nothing new.
- Produces: every response carries baseline security headers. No other
  task depends on this directly (Task 7's CSP task adds to the same area
  of `server.js` but is independent).

- [ ] **Step 1: Add the `helmet` dependency**

```bash
cd server && npm install helmet
```

- [ ] **Step 2: Wire it in, with CSP deferred to Task 7 and frame-options tightened**

Current (`server/server.js:16-18`):

```js
const app = express();
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '100kb' }));
```

Add the `helmet` require near the top imports (alongside `cors`), and
insert its middleware:

```js
const helmet = require('helmet');
```

```js
const app = express();
app.use(helmet({
  contentSecurityPolicy: false, // configured separately in Task 7
  frameguard: { action: 'deny' }, // matches Task 7's frame-ancestors 'none'
}));
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '100kb' }));
```

- [ ] **Step 3: Verify**

From `server/`: `npm run dev`

```bash
curl -sI http://localhost:3000/ | grep -i "x-content-type-options\|referrer-policy\|x-frame-options\|strict-transport-security"
```

Expected: `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY` all present.
(`Strict-Transport-Security` may or may not appear over plain HTTP
depending on helmet's version — not required to show locally; it takes
effect once served over real HTTPS.)

Then load the app in a browser and confirm it still works end to end
(login, drawer, chat) — helmet's non-CSP headers should be invisible to
normal operation.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/server.js
git commit -m "feat: add baseline security headers via helmet"
```

---

### Task 2: Session hardening (token revocation)

**Files:**
- Modify: `server/db.js:71` area (after the schema block), `server/auth.js`
  (whole file), `server/server.js:103,115,395-410` (register/login/WS),
  `index.html:2555` (`Auth.logout()`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `signToken(userId, tokenVersion)`, `verifyToken(token)` →
  `{ userId, tokenVersion } | null` (changed return shape — every existing
  caller in this codebase is updated in this task), `POST
  /api/auth/logout`.

- [ ] **Step 1: Add the `token_version` migration**

In `server/db.js`, immediately after the closing `` ` `` of the big
`db.exec(...)` schema block (right before the `function id()` line, i.e.
after line 71 in the current file), insert:

```js
// Added after the initial schema shipped -- ALTER TABLE, not CREATE TABLE
// IF NOT EXISTS, because this column doesn't exist on a database created
// before this change. Guarded so it's also safe to run against a
// database that already has it (a fresh install's CREATE TABLE could be
// updated instead, but this guard means either database layout works).
const userCols = db.prepare('PRAGMA table_info(users)').all();
if (!userCols.some((c) => c.name === 'token_version')) {
  db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
}
```

- [ ] **Step 2: Update `server/auth.js`**

Replace the whole file:

```js
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
  if (!payload) return res.status(401).json({ error: 'Not authenticated.' });
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.userId);
  if (!row || row.token_version !== payload.tokenVersion) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  req.userId = payload.userId;
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAuth };
```

- [ ] **Step 3: Update the register/login call sites in `server/server.js`**

Current (`server/server.js:103`):

```js
    res.status(201).json({ token: signToken(id), user: publicUser(user) });
```

Change to:

```js
    res.status(201).json({ token: signToken(id, 0), user: publicUser(user) });
```

Current (`server/server.js:115`):

```js
    res.json({ token: signToken(user.id), user: publicUser(user) });
```

Change to:

```js
    res.json({ token: signToken(user.id, user.token_version), user: publicUser(user) });
```

- [ ] **Step 4: Update the WebSocket connection handler**

Current (`server/server.js:395-402` area):

```js
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://internal');
  const token = url.searchParams.get('token');
  const userId = token ? verifyToken(token) : null;
  const user = userId ? getUserById(userId) : null;

  ws.isAlive = true;
  ws.userId = user ? user.id : null;
  allSockets.add(ws);
```

Change to:

```js
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://internal');
  const token = url.searchParams.get('token');
  const payload = token ? verifyToken(token) : null;
  const user = payload ? getUserById(payload.userId) : null;
  const validSession = !!user && user.token_version === payload.tokenVersion;

  ws.isAlive = true;
  ws.userId = validSession ? user.id : null;
  allSockets.add(ws);
```

(A revoked/invalid token falls back to an anonymous connection, matching
the existing behavior for any other invalid token — the upgrade itself is
never rejected.)

- [ ] **Step 5: Add the logout endpoint**

Add near the other `/api/auth/*` routes in `server/server.js` (after the
`PATCH /api/auth/me` handler):

```js
app.post('/api/auth/logout', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});
```

- [ ] **Step 6: Wire the frontend**

In `index.html`, find `Auth.logout()` (currently around line 2555):

```js
  logout() {
    Api.setToken(null);
    Auth.currentUser = null;
    Socket.connect();
    if (typeof UI !== 'undefined') UI.syncAuthUI();
  },
```

Change to:

```js
  logout() {
    Api.post('/api/auth/logout').catch(() => {}); // best-effort; the local clear below is what actually logs this device out
    Api.setToken(null);
    Auth.currentUser = null;
    Socket.connect();
    if (typeof UI !== 'undefined') UI.syncAuthUI();
  },
```

- [ ] **Step 7: Verify (Review Focus: pre-existing sessions, offline logout)**

`npm run dev` from `server/` against the **existing** `data.db` (don't
delete it first this time — that's the point of this check):

1. Simulate a pre-existing (pre-this-task) session deterministically:
   register a user normally, then manually sign a token the *old* way
   (no `ver` claim) using the same secret and that user's id —
   `node -e "console.log(require('jsonwebtoken').sign({sub:'<that user's id>'}, require('fs').readFileSync('.env','utf8').match(/JWT_SECRET=(\S+)/)[1]))"`
   run from `server/` — then put that token in the browser's
   `localStorage` under `pomodoroAuthToken` (JSON-stringified) and reload.
   Expected: treated as logged out (falls back to guest/auth-modal state)
   cleanly — no thrown error, no broken UI — since that token's `ver` is
   `undefined`, which never equals the new column's `0`.
2. Fresh signup/login: confirm login/signup still work and the app stays
   logged in across a reload (new tokens carry the real version).
3. Log out, then log back in with the same credentials — confirm this
   still works (proves `token_version` incrementing doesn't lock the
   account out, just invalidates old tokens).
4. Log in again, open devtools, block the specific request to
   `/api/auth/logout` (Playwright `page.route(... , route => route.abort())`
   or devtools "block request URL"), then click Log Out. Expected: the
   app still returns to a logged-out state immediately (local clear is
   synchronous and doesn't wait on the network call).
5. Confirm the previously-issued token (captured before step 4's logout)
   is now rejected: `curl -H "Authorization: Bearer <old token>"
   http://localhost:3000/api/auth/me` → `401`.

- [ ] **Step 8: Commit**

```bash
git add server/db.js server/auth.js server/server.js index.html
git commit -m "feat: add real session revocation via token_version"
```

---

### Task 3: Rate limiting — extend coverage, fix the helper's two bugs

**Files:**
- Modify: `server/server.js:13-39` (setup + helper),
  `server/server.js:137,186,294` (search/friend-requests/messages routes),
  `server/.env.example`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks (Task 4 tests this, but reads
  it via HTTP, not as a code dependency).

- [ ] **Step 1: Add the trust-proxy flag**

In `server/server.js`, right after the existing `const PORT = ...` /
`const allowedOrigins = ...` lines (13-14):

```js
// Only ever enable this when actually deployed behind a real reverse
// proxy (e.g. Render). Trusting X-Forwarded-For without one lets a
// client set that header itself and claim any IP, bypassing every
// IP-keyed rate limit below.
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
```

(Place this after `const app = express();`, i.e. after Task 1's helmet
line — `app` must exist first.)

- [ ] **Step 2: Fix the unbounded `attempts` Map**

Immediately after the existing `rateLimited` function definition
(`server/server.js:30-39`):

```js
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000; // well past the longest window any caller uses
  for (const [key, record] of attempts) {
    if (record.start < cutoff) attempts.delete(key);
  }
}, 5 * 60_000).unref();
```

- [ ] **Step 3: Apply rate limits to search, friend requests, and messages**

Current (`server/server.js:137`):

```js
app.get('/api/users/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 40);
```

Change to:

```js
app.get('/api/users/search', requireAuth, (req, res) => {
  if (rateLimited(`search:${req.userId}`, 30, 60_000)) return res.status(429).json({ error: 'Too many searches. Try again shortly.' });
  const q = String(req.query.q || '').trim().slice(0, 40);
```

Current (`server/server.js:186`):

```js
app.post('/api/friends/requests', requireAuth, (req, res) => {
  const toUserId = req.body && req.body.toUserId;
```

Change to:

```js
app.post('/api/friends/requests', requireAuth, (req, res) => {
  if (rateLimited(`friend-req:${req.userId}`, 20, 60_000)) return res.status(429).json({ error: 'Too many friend requests. Try again shortly.' });
  const toUserId = req.body && req.body.toUserId;
```

Current (`server/server.js:294`):

```js
app.post('/api/conversations/:friendId/messages', requireAuth, (req, res) => {
  const friendId = req.params.friendId;
  if (!areFriends(req.userId, friendId)) return res.status(403).json({ error: 'You can only message friends.' });
```

Change to:

```js
app.post('/api/conversations/:friendId/messages', requireAuth, (req, res) => {
  if (rateLimited(`message:${req.userId}`, 60, 60_000)) return res.status(429).json({ error: 'Sending too fast. Try again shortly.' });
  const friendId = req.params.friendId;
  if (!areFriends(req.userId, friendId)) return res.status(403).json({ error: 'You can only message friends.' });
```

- [ ] **Step 4: Document `TRUST_PROXY` in `.env.example`**

Add to `server/.env.example` (matching its existing comment style):

```
# Set to "1" only when this server actually runs behind a real reverse
# proxy (Render, or any host that terminates TLS/routes traffic to you).
# Enabling it without one lets a client fake their IP via X-Forwarded-For
# and bypass every rate limit below. Leave unset for local development.
TRUST_PROXY=
```

- [ ] **Step 5: Verify**

`npm run dev` from `server/`. Register and log in as a test user, then:

```bash
TOKEN="<paste the token>"
for i in $(seq 1 31); do curl -s -o /dev/null -w "%{http_code} " -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/users/search?q=te"; done; echo
```

Expected: the first 30 print `200`, the 31st prints `429`.

Manually confirm normal use isn't affected: search a few times, send a
couple of friend requests, exchange a few chat messages in the browser —
all should work without hitting the limits under ordinary use.

- [ ] **Step 6: Commit**

```bash
git add server/server.js server/.env.example
git commit -m "feat: extend rate limiting to search/friend-requests/messages, fix trust-proxy and unbounded-Map bugs"
```

---

### Task 4: Regression tests for Tasks 2 and 3

**Files:**
- Modify: `server/test/e2e.js`

**Interfaces:**
- Consumes: `/api/auth/logout`, `/api/users/search` (both from Tasks 2/3).
- Produces: nothing (leaf task).

Both new blocks below go at the very end of `main()`, immediately before
the existing `alice.ws.close();` line (i.e. after step 16, "mutual
simultaneous friend requests..."). This is a deliberate, verified choice,
not just a convenient one: step 14 ("remove friend, then message is
rejected again") still uses `aliceToken` expecting a **403** on
`blockedAfterRemove`. If the logout test ran before that and invalidated
Alice's token, that same call would get a **401** instead and the
existing assertion would fail. Placing both new blocks after every
existing step that still depends on `aliceToken` working avoids this
entirely.

- [ ] **Step 1: Add a rate-limit test**

```js
console.log('17. rate limiting on search kicks in after 30 requests/minute');
let lastSearchStatus = 200;
for (let i = 0; i < 31; i++) {
  const r = await api(aliceToken, 'GET', '/api/users/search?q=te');
  lastSearchStatus = r.status;
}
assert(lastSearchStatus === 429, `31st search in a minute is rate-limited (got ${lastSearchStatus})`);
```

- [ ] **Step 2: Add a logout-invalidates-token test**

Append immediately after:

```js
console.log('18. logout invalidates the old token everywhere');
const preLogoutCheck = await api(aliceToken, 'GET', '/api/auth/me');
assert(preLogoutCheck.status === 200, 'token works before logout');
const logoutRes = await api(aliceToken, 'POST', '/api/auth/logout');
assert(logoutRes.status === 200, 'logout succeeds');
const postLogoutCheck = await api(aliceToken, 'GET', '/api/auth/me');
assert(postLogoutCheck.status === 401, 'the same token is rejected after logout');
```

This is deliberately the last thing `main()` does with `aliceToken` — it
permanently burns that token, which is why both new blocks are placed
here and nothing after them relies on it.

- [ ] **Step 3: Run the full suite**

From `server/`, with a fresh database (`rm -f data.db data.db-shm
data.db-wal`) and the server running (`npm run dev` in one terminal):

```bash
node test/e2e.js
```

Expected: every assertion prints `ok`, script exits `0`.

- [ ] **Step 4: Commit**

```bash
git add server/test/e2e.js
git commit -m "test: add rate-limit and logout-invalidation coverage"
```

---

### Task 5: CORS default tightening

**Files:**
- Modify: `server/server.js:17` (or wherever Task 1 left the `cors(...)`
  line)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Flip the unset-origin default**

Current (after Task 1, still on its own line):

```js
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
```

Change to:

```js
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
```

- [ ] **Step 2: Verify**

`npm run dev` from `server/`. Load the app in a browser normally (same
origin) — confirm everything still works (login, search, chat): this
change only affects *cross*-origin requests, and the frontend is served
same-origin by this same server.

Then confirm cross-origin is actually blocked:

```bash
curl -s -H "Origin: https://evil.example" -H "Access-Control-Request-Method: GET" -X OPTIONS -i http://localhost:3000/api/friends | grep -i "access-control-allow-origin"
```

Expected: no `Access-Control-Allow-Origin` header in the response (or an
empty one) — confirms a browser from a different origin would not be
allowed to read the response.

- [ ] **Step 3: Commit**

```bash
git add server/server.js
git commit -m "fix: default CORS to same-origin-only instead of reflecting any origin"
```

---

### Task 6: WebSocket Origin check

**Files:**
- Modify: `server/server.js:390-393` area

**Interfaces:**
- Consumes: `allowedOrigins` (already defined at the top of the file).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the check**

Current (`server/server.js:390-393`):

```js
server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
```

Change to:

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

- [ ] **Step 2: Verify (Review Focus: must not break the configured-origin case)**

First, the common local-dev case (no `ALLOWED_ORIGIN` set — this check is
a no-op): `npm run dev`, load the app, confirm the online-count and
presence still work (proves the WS still connects normally).

Then the configured case: stop the server, restart with
`ALLOWED_ORIGIN=http://localhost:3000 npm run dev` (or set it in `.env`
temporarily), reload the app at `http://localhost:3000/`. Expected: the
WebSocket still connects successfully (the page's own Origin header is
`http://localhost:3000`, which now matches `allowedOrigins`) — online
count still populates, presence still works. This proves the check
allows the legitimate same-origin case once configured, not just when
unset.

- [ ] **Step 3: Commit**

```bash
git add server/server.js
git commit -m "feat: reject WebSocket upgrades from disallowed origins"
```

---

### Task 7: Content-Security-Policy (nonce-based)

The most involved task — touches the one route serving the entire
frontend, and must not break the AI chat or YouTube background features.

**Files:**
- Modify: `server/server.js:350` (the `/` route) and its imports (`fs`)

**Interfaces:**
- Consumes: `index.html`'s single `<script>` tag (confirmed via `grep -c
  "<script" index.html` → `1`, at line 1879 as of this plan's writing —
  reconfirm before editing, since earlier tasks in this plan don't touch
  `index.html`'s script tag itself, so this should be unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `fs` import**

Near the top of `server/server.js`, alongside the existing `const path =
require('node:path');`:

```js
const fs = require('node:fs');
```

- [ ] **Step 2: Replace the `/` route**

Current (`server/server.js:350`):

```js
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
```

Change to:

```js
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

(`crypto` is already imported at the top of `server.js`, line 5 —
`const crypto = require('node:crypto');` — so `crypto.randomBytes` above
needs no new import beyond `fs` from Step 1.)

- [ ] **Step 3: Verify — full feature pass with console-error checking (Review Focus)**

`npm run dev` from `server/`. For every check below, watch the browser
console for CSP violation reports (they appear as console errors, exactly
like any other JS error this codebase's testing already watches for):

1. Load the app fresh. Expected: zero console errors, fonts render
   (Inter/Fraunces, not a fallback system font — a CSP block on
   `fonts.googleapis.com`/`fonts.gstatic.com` would silently fall back to
   a default font with no thrown error, so visually confirm the actual
   typeface loads), page fully interactive.
2. Open Settings → Background → set type to YouTube, paste a YouTube URL,
   confirm the video actually plays as the background. This exercises
   both `script-src https://www.youtube.com` (the IFrame API loader) and
   `frame-src https://www.youtube.com` (the resulting embed).
3. Open Settings → AI Assistant, paste a real Gemini API key, send a
   message in the AI chat, confirm a real response comes back. This
   exercises `connect-src https://generativelanguage.googleapis.com`.
4. Open Settings → Background → set a custom image URL (any real HTTPS
   image URL), confirm it renders as the background. Exercises `img-src
   https:`.
5. Log in, open the friends drawer, notification bell, and chat dialog —
   confirm all still render and function (exercises inline `style`
   attributes under `style-src 'unsafe-inline'`).
6. View page source (or `curl -s http://localhost:3000/ | grep nonce`) and
   confirm the single `<script>` tag now carries a `nonce="..."`
   attribute, and that reloading produces a *different* nonce each time
   (proving it's per-request, not a fixed value baked into the file).

- [ ] **Step 4: Commit**

```bash
git add server/server.js
git commit -m "feat: add nonce-based Content-Security-Policy scoped to actual external resources"
```

---

### Task 8: Minimal security logging

**Files:**
- Modify: `server/server.js` (login handler, `requireAuth` call sites —
  actually inside `server/auth.js`'s `requireAuth` itself)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Log failed logins**

In `server/server.js`'s login handler, where it currently does:

```js
  verifyPassword(password, user.password_hash).then((ok) => {
    if (!ok) return res.status(401).json({ error: 'Incorrect username/email or password.' });
```

Change to:

```js
  verifyPassword(password, user.password_hash).then((ok) => {
    if (!ok) {
      console.warn(`[auth] failed login for "${identifier}" from ${req.ip}`);
      return res.status(401).json({ error: 'Incorrect username/email or password.' });
    }
```

Also log the "user not found" branch just above it in the same handler
(`if (!user) return res.status(401)...`) the same way, so both failure
modes are visible without revealing to the *client* which one occurred
(the response body stays identical either way — this only changes what's
written to the server's own log):

```js
  if (!user) {
    console.warn(`[auth] failed login for "${identifier}" from ${req.ip}`);
    return res.status(401).json({ error: 'Incorrect username/email or password.' });
  }
```

- [ ] **Step 2: Log authorization failures**

In `server/auth.js`'s `requireAuth`, log both rejection branches:

```js
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
```

- [ ] **Step 3: Verify**

`npm run dev` from `server/`, with server stdout visible in the terminal.
Attempt a login with a wrong password — confirm a `[auth] failed login
for "..."` line appears in the terminal, with no password anywhere in it.
Make an authenticated request with a garbage token (`curl -H
"Authorization: Bearer garbage" http://localhost:3000/api/friends`) —
confirm a `[auth] rejected request...` line appears.

- [ ] **Step 4: Commit**

```bash
git add server/server.js server/auth.js
git commit -m "feat: add minimal security-event logging for failed logins and authz rejections"
```

---

### Task 9: SECURITY.md

**Files:**
- Create: `SECURITY.md` (repo root)

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing.

- [ ] **Step 1: Write the document**

Create `SECURITY.md` at the repo root covering, in plain language matching
this codebase's own documentation style (see the design spec and
`server/.env.example` for tone):

- **Architecture**: one Express process serving both the static frontend
  and the JSON API + WebSocket, backed by a single SQLite file.
- **Authentication**: bcrypt-hashed passwords (cost 10), JWTs (7-day TTL)
  with a `token_version` column enabling real server-side revocation on
  logout (logout-everywhere, since there's no per-device session
  tracking).
- **Authorization**: every user-scoped route derives identity from the
  verified JWT via `requireAuth`, never from a client-supplied id; every
  route's SQL is scoped to that id.
- **Database security**: parameterized queries throughout; foreign keys
  with `ON DELETE CASCADE` keep referential integrity; no ORM, direct
  `node:sqlite`.
- **Realtime security**: WebSocket auth via the same JWT (query string,
  the standard pattern for browser WebSockets — mitigated by short-lived
  tokens); Origin-checked upgrades once `ALLOWED_ORIGIN` is configured.
- **Rate limiting**: in-memory, per-identity (userId once authenticated,
  IP before), covering register/login/search/friend-requests/messages;
  requires `TRUST_PROXY=1` to be IP-accurate behind a real proxy, and
  must never be set without one.
- **Input validation**: username/password/email format checks server-side
  on every write; all lengths capped.
- **XSS**: 100% `textContent` for user-controlled rendering; a nonce-based
  CSP restricts script execution to the app's own inline script plus the
  YouTube IFrame API loader, `connect-src` to self plus the Gemini AI
  endpoint the app's own AI chat feature calls directly.
- **Secrets**: `JWT_SECRET` lives only in `server/.env` (gitignored,
  never committed — verified via full git history search); no secret is
  ever sent to the client.
- **Dependency security**: `npm audit` clean as of this writing (0
  vulnerabilities); re-run periodically, not on every deploy.
- **Logging**: failed logins and authorization failures are logged with
  identifiers and IP, never passwords/tokens/keys.
- **Known limitations** (explicit, not hidden): no per-device session
  revocation (logout invalidates every device at once); no email
  verification; no 2FA; no CAPTCHA/bot protection beyond rate limiting;
  the WebSocket token-in-query-string pattern is standard for browsers
  but does mean it can appear in access/proxy logs that capture full
  URLs.
- **Explicitly out of scope, and why**: XP/leaderboard/study-session
  security (those systems don't exist server-side yet — this document
  will need a follow-up section once they're built), file-upload security
  (there is no server-side upload endpoint — avatars are emoji strings,
  photos stay in browser IndexedDB), SSRF (no server-side code fetches a
  user-supplied URL).
- **Deployment security requirements** (for whoever deploys this): set a
  real `JWT_SECRET` (never the one in a dev `.env`), set `ALLOWED_ORIGIN`
  to the real production origin, set `TRUST_PROXY=1` only if actually
  behind a proxy, serve over HTTPS (required for HSTS and for the
  WebSocket's token-in-URL to not appear in plaintext network traffic).

- [ ] **Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md"
```

---

### Task 10: Final regression pass

**Files:** none (verification only).

- [ ] **Step 1: Backend regression**

From `server/`: `rm -f data.db data.db-shm data.db-wal`, `npm run dev` in
one terminal, `node test/e2e.js` in another.

Expected: all assertions pass against a fresh database (this also proves
the `token_version` migration runs cleanly against a brand-new database,
not just an upgraded one).

- [ ] **Step 2: Full manual pass, two accounts**

With the server running: sign up as two fresh users, search/friend-
request/accept between them, exchange a chat message, confirm
notifications and presence still work exactly as they did at the end of
sub-project 1 — none of this plan's tasks should have changed any of that
behavior, only added protection around it.

- [ ] **Step 3: Re-verify every Review Focus item once more, together**

In one continuous session: log out and confirm the auth modal reappears
and a stale token is rejected; rapid-fire a handful of searches/messages
and confirm normal use doesn't trip the limits while confirming they do
exist (from Task 3/4's own tests); load the YouTube background and use
the AI chat (if a test API key is available) one more time now that every
other task has also landed, to catch any interaction between tasks that
individual task testing might have missed.

- [ ] **Step 4: Console and header check**

Zero uncaught console errors and zero CSP violations throughout Step 2-3.
Spot-check response headers one more time
(`curl -sI http://localhost:3000/`) for the full set: CSP,
X-Content-Type-Options, Referrer-Policy, X-Frame-Options.

- [ ] **Step 5: Final commit (if any fixups were needed)**

If Steps 1-4 surfaced any small fixes, commit them individually with a
`fix:` message describing exactly what broke. If everything passed
as-is, there is nothing to commit for this task.
