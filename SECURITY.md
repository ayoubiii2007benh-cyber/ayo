# Security & privacy

What protects user data today, what is deliberately not done, and what to check when deploying.
Read it next to the code: `server/*.js` is short enough to read in full.

Last reviewed: 2026-09-30 (privacy/legal + security hardening pass).

## Architecture

One Express process serves the static frontend (`index.html`, `assets/`, `legal/`), the JSON API and the
WebSocket, all on one origin. **All user data lives in an external Postgres database (`DATABASE_URL`)** --
never on the server's disk (Render's disk is wiped on every deploy; see CLAUDE.md, Rule #1). Schema changes
are additive only (`server/db.js`).

## Authentication and sessions

- **Passwords:** bcrypt, cost 12 (`server/auth.js`). Older cost-10 hashes are re-hashed transparently at the
  next successful login. New passwords: 8-72 bytes (bcrypt ignores anything past 72), a short common-password
  deny-list, not equal to the username/email.
- **Session = HttpOnly cookie.** A signed JWT (HS256, 7 days) in `__Host-pomo_session` (`Secure`, `HttpOnly`,
  `SameSite=Lax`, `Path=/`; plain `pomo_session` on http://localhost). Scripts on the page can never read it
  and it never appears in a URL or JSON body. A fresh session is minted at every login/registration/reset.
- **Revocation:** every request re-checks the JWT's `token_version` against the database. Logout and a
  password reset bump it (log out everywhere) and clear the cookie.
- **CSRF, two layers:** (1) any state-changing `/api` request carrying a cross-site `Origin` or
  `Sec-Fetch-Site: cross-site` is refused; (2) `requireAuth` demands an `X-CSRF-Token` header equal to an HMAC of
  the session token (returned by login / `GET /api/auth/me`, held in page memory only).
- **Brute force:** per-IP limits on login/register (10 / 15 min); per-account exponential backoff (from the
  6th failure: 1, 2, 4 ... 15 minutes); Cloudflare Turnstile required after 2 failures; "user not found" does a
  dummy bcrypt compare so response time doesn't reveal which usernames exist.
- **Migration:** people who were signed in under the old design (token in `localStorage`) are upgraded once via
  `POST /api/auth/session/upgrade` -- the only place a bearer token is still accepted -- and the stored token is
  deleted by the page.
- **Password reset** (email code): unchanged design -- 6-digit code stored only as a peppered hash, max 5 tries,
  10-minute expiry, single-use 15-minute reset token, no account enumeration, sessions revoked on reset.

## Consent and privacy features

- Registration requires `acceptTerms === true` **on the server**; the timestamp and policy version
  (`POLICY_VERSION` in `server/server.js`) are stored in `users.consent_version / consent_at`. Accounts that
  predate the policies (or accepted an older version) must accept at next login or via a blocking dialog
  (`POST /api/account/consent`). New OAuth accounts need the box ticked too (`?consent=1` on the start URL).
  **When you change `legal/*.html` materially, bump `POLICY_VERSION` and the dates in those files.**
- Cookie banner (`assets/consent.js`): Google Consent Mode v2 defaults to denied; `gtag.js` is not even
  downloaded until analytics is accepted; withdrawing deletes the `_ga*` cookies. The choice lives in
  `localStorage` (`pomoCookieConsent`) and is re-asked after 12 months.
- `GET /api/account/export` -- JSON copy of everything stored about the user (no password hash / tokens).
- `POST /api/account/delete` -- re-authenticates (password, or the username for OAuth-only accounts), hands a
  hosted room to another member, deletes other users' notifications that embed this user's profile, then deletes
  the user row (everything else cascades). Open sockets are closed and friends are told.
- Data minimisation: the app never stores IP addresses (only in-memory rate-limit counters, <= ~1 hour, never
  logged); no IP is sent to Turnstile; no location of any kind; emails are never logged on a deployed server;
  Google Fonts replaced by a self-hosted copy (no IP disclosure to Google); Turnstile's script loads only when the
  sign-in window opens; non-friends no longer see a user's online status / last-seen time.
- Retention (`purgeStaleRecords`, every 6 h): password-reset rows > 1 day, resolved friend requests / room invites
  and stale pending invites > 30 days, notifications > 90 days. **Messages, profile, friends and focus history are
  never auto-deleted.**

## Authorization

`requireAuth` derives `req.userId` from the verified session; no route trusts a user id from the body, query or
URL as the acting identity. Every query is scoped (`WHERE user_id = ?`, ownership/friendship checks before
reads or mutations). Room data, room chat, images and voice signalling all require current membership of that
exact room. WebSocket: the handshake must come from this site's own origin (cross-site WebSocket hijacking is
refused), the session is read from the cookie (never a URL token), sockets are capped (10 per user, 10k total),
frames are capped at 32 KB and rate-limited. Room codes are drawn from a CSPRNG with ~8 million combinations.

## Injection / XSS

All SQL is parameterised (`?` -> `$n`); `LIKE` wildcards in user search are escaped. All user-controlled text is
rendered with `textContent`; `innerHTML` only ever receives the app's own static icon markup. Avatar URLs must
be `https://` with no quotes/brackets/backslashes. Room-chat images are sniffed by magic bytes (no SVG).
Async route errors are caught (they used to crash the process): a bad request yields a 4xx/5xx, not an outage.

## Headers

Set on every response: a per-request-nonce **Content-Security-Policy** (`script-src 'self' 'nonce-...'` plus only
YouTube, Cloudflare Turnstile and Google Tag Manager; `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` on HTTPS), HSTS (1 year,
includeSubDomains), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Permissions-Policy` (camera/microphone/screen-share same-origin only; geolocation, payment, USB etc. off),
`Cache-Control: no-store` on `/api`. `X-Powered-By` is removed. Plain-HTTP requests (as reported by
`X-Forwarded-Proto`) are redirected to HTTPS.

Two CSP directives stay loose on purpose: `img-src`/`media-src` allow any `https:` (the Settings page lets users
paste their own background image/video/audio URL) and `style-src` keeps `'unsafe-inline'` (inline `style`
attributes are used throughout). `script-src`, the XSS vector that matters, is strict.

## Rate limits (in memory, per process)

Global API flood limit (900/min per signed-in account, else per IP); register/login 10 per 15 min per IP;
forgot-password/username 3 per hour per identifier + 10 per IP; verify-code/reset-password 20/h per IP;
OAuth start 20/min; search 30/min; friend requests 20/min; DMs 60/min; room create 10/min, join 20/min, chat
30/min, status 60/min; invites 20/min; focus-session log 30/min (+ 16 h/day cap); export 5/h; delete 5/h.
Limits are per process and reset on restart -- fine for one instance; use a shared store if you ever scale out.
**`req.ip` is only meaningful if `TRUST_PROXY` (number of proxy hops) is right** -- see `.env.example`.

## Secrets

`JWT_SECRET` and `DATABASE_URL` are required environment variables; the server refuses to start without them.
`.env` is gitignored and was never committed (checked against the full git history, together with common API-key
patterns). Nothing secret is sent to the client; `publicUser()` never includes email or password hash.
`npm audit`: 0 vulnerabilities. Unused dev dependency `sharp` removed.

## Testing

`server/test/run-local.js` starts the real server against an in-memory Postgres (pg-mem) -- it never touches a real
database. Then `TEST_BASE_URL=http://localhost:3100 node test/e2e-privacy-security.js` (80 checks: cookies, CSRF,
consent, backoff, export, deletion, WebSocket rules, headers). The older `e2e*.js` scripts predate Turnstile and
bearer-token removal and need updating before they can run again.

## Known limitations (accepted, listed so silence isn't read as "solved")

- **No email verification** at sign-up: an address is never confirmed to belong to the person who typed it, so
  reset codes can go to the wrong inbox, and "email already registered" reveals that an address is in use.
- **No 2FA.** No per-device session list (logout = everywhere).
- **Lockout can be abused** to keep a specific account locked for up to 15 minutes (a deliberate trade-off).
- **Turnstile must have real keys** (`TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`). With the built-in Cloudflare
  *test* keys the CAPTCHA always passes and protects nothing.
- **Avatar image URLs are fetched by other users' browsers** from whatever host the owner chose, which exposes
  those viewers' IP addresses to that host. Consider removing the feature or proxying images.
- `DATABASE_SSL_VERIFY` is off by default (connection encrypted, certificate not verified).
- Voice/video are peer-to-peer WebRTC: participants can see each other's IP addresses (inherent to WebRTC).
- The Gemini API key a user pastes lives in their browser's localStorage and is sent (as a query parameter) to Google.

## Deployment checklist

- Real random `JWT_SECRET` (never the dev value); `DATABASE_URL`; `BASE_URL=https://pomodorofocus.site`.
- `TRUST_PROXY` = number of proxies in front of the app (Render alone: `1`; Cloudflare -> Render: `2`).
- Real `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
- `RESEND_API_KEY` + `EMAIL_FROM` if password-reset email should actually be delivered.
- Optionally `DATABASE_SSL_VERIFY=1` after confirming it connects.
- In Google Analytics: set data retention to 14 months (the Privacy Policy says so), and keep Google signals off.
