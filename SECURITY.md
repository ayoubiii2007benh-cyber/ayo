# Security

This document describes how this app protects user data today, what it
deliberately doesn't do yet, and what to check before you deploy it. It's
written to be read alongside the code, not instead of it — `server/*.js`
is short enough to read in full, and you should before trusting anything
below blindly.

## Architecture

One Express process serves everything: the static frontend (`index.html`),
the JSON API, and the WebSocket connection, all on the same origin. Data
lives in a single SQLite file (`server/data.db` by default, or `DB_PATH`),
accessed directly through Node's built-in `node:sqlite` — no ORM, no
separate database server, no separate frontend host in the default setup.

## Authentication

Passwords are hashed with bcrypt at cost factor 10 (`server/auth.js`) —
plaintext passwords are never stored and never logged. A successful
login or registration returns a JWT with a 7-day expiry. The token
carries the user's id and a `token_version` number pulled from the
`users` table at signing time.

That `token_version` column is what makes logout mean something
server-side: every authenticated request re-checks the token's version
against the current value in the database (`requireAuth`, `server/auth.js`).
Calling `POST /api/auth/logout` increments the column, which instantly
invalidates every outstanding token for that account, on every device —
there's no per-device session tracking, so this is "log out everywhere,"
not "log out this browser." See Known limitations below.

## Authorization

Every route that touches user-specific data goes through the `requireAuth`
middleware, which derives `req.userId` from the verified JWT — nothing
ever trusts a user id supplied in a request body, query string, or URL
param as the acting identity. Every one of those routes' SQL is scoped
to that id (`WHERE user_id = ?`, friendship/ownership checks on requests
before mutating them, `areFriends()` checks before conversations or
messages are readable). There is no route where one user can read or
write another user's private data by guessing an id.

## Database security

- Every query goes through parameterized statements
  (`db.prepare(...).run/get/all`) — no string-concatenated SQL anywhere
  in the codebase.
- Foreign keys are declared with `ON DELETE CASCADE` (`server/db.js`),
  so deleting a user cleans up their friendships, requests, conversations,
  messages, and notifications instead of leaving orphaned rows.
- No ORM — just `node:sqlite`, so there's no ORM-layer injection surface
  to worry about either.

## Realtime security (WebSocket)

The WebSocket connection authenticates using the same JWT as the REST
API, passed as a `?token=` query parameter (`server/server.js`) — the
standard approach for browser WebSockets, which can't set custom headers
on the upgrade request. This does mean the token can end up in places
that log full URLs (see Known limitations); the mitigation is that tokens
are short-lived (7 days, and revocable via logout) rather than replacing
the mechanism.

Once `ALLOWED_ORIGIN` is configured, the WebSocket upgrade handler
(`server/server.js`) runs:

```js
if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
  socket.destroy();
  return;
}
```

This only rejects a connection when an `Origin` header is **both present
and mismatched**. Browsers always send `Origin` on a WebSocket handshake,
so this does stop a malicious website from opening a WS connection against
this server using a victim's browser (the attack it was added for). It
does **not** gate a client that sends no `Origin` header at all — curl, a
script, or any non-browser WebSocket client is free to omit it, and the
condition above is simply false, so the connection proceeds regardless of
`ALLOWED_ORIGIN`. In other words, this check protects against
browser-based cross-site WS attacks; it provides no protection against a
scripted attacker who has obtained a valid token (stolen, leaked, or
phished) and connects directly with a WS client of their own. Locally,
with `ALLOWED_ORIGIN` unset, the check is skipped entirely (`allowedOrigins.length`
is `0`) so same-origin dev traffic isn't affected.

## CAPTCHA (Cloudflare Turnstile)

`POST /api/auth/register` and `POST /api/auth/login` verify a Turnstile
token server-side (`verifyCaptcha()` in `server/server.js`) against
Cloudflare's `siteverify` endpoint before touching the database or bcrypt.
The secret key (`TURNSTILE_SECRET_KEY`) is a backend-only environment
variable, never sent to the client; only the public site key
(`TURNSTILE_SITE_KEY`) is exposed, via `GET /api/config`.

Also gates `POST /api/auth/forgot` and `POST /api/auth/forgot-username`
(always) and `POST /api/auth/login` specifically once an identifier has 2+
recent failed attempts — enforced server-side regardless of what the
frontend shows, so a client that never sends a token past that point is
simply rejected.

Three explicit behaviors worth knowing:

- **Unconfigured (no `TURNSTILE_SECRET_KEY`/`TURNSTILE_SITE_KEY`) → falls
  back to Cloudflare's own published test keys** (site
  `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`),
  so local dev and CI never need a Cloudflare account *and* still exercise
  the real widget and the real `siteverify` call. These test keys always
  pass verification — **this is a real gap, not an oversight**: a
  deployment that never sets its own real keys shows a working-looking
  CAPTCHA that provides zero actual bot protection. See Deployment
  security requirements.
- **A network failure reaching Cloudflare fails closed** (the attempt is
  rejected), not open. A Cloudflare outage means login/signup are
  unavailable rather than silently unprotected.
- The frontend (`Captcha` in `index.html`) only loads Turnstile's script
  and renders a widget if `GET /api/config` reports CAPTCHA enabled, which
  it now always does (real keys or the test-key fallback above). The
  login widget specifically renders lazily — only once the failed-attempt
  threshold is crossed — so a user who gets their password right the
  first time never sees or loads it.

## OAuth ("Continue with Google" / "Continue with Microsoft")

`server/oauth.js` implements standard authorization-code + PKCE (RFC 7636)
against each provider directly — no SDK, no dependency, two `fetch` calls
per sign-in (token exchange, then the provider's OIDC `userinfo` endpoint).
PKCE is used even though these are confidential (secret-holding) clients:
it costs nothing and stops an intercepted `code` from being redeemed by
anyone but the browser that started that exact flow.

- **CSRF/state**: `GET /api/auth/:provider/start` generates a random
  `state` and a PKCE verifier, stored server-side in memory keyed by
  `state` (`oauthStates`), and never trusts the client to round-trip
  anything but that opaque value. `state` is deleted the moment the
  callback looks it up — replay of a callback URL fails immediately.
- **No JWT signature verification needed**: profile data comes from calling
  the provider's own `userinfo` endpoint with the access token we just
  received, not from decoding the `id_token` ourselves — that endpoint is
  only reachable with a token the provider itself issued to us over this
  exact request, so there's no JWKS/signature-verification code to get
  wrong.
- **The real session JWT never appears in a URL.** The OAuth callback
  redirects to `/?oauth=<one-time code>`; the frontend immediately calls
  `POST /api/auth/oauth/exchange` to trade that code for the actual token
  (`oauthExchangeCodes`, single-use, 60s expiry) and strips the query
  param via `history.replaceState`. The alternative — putting the JWT
  itself in the redirect URL — would leave it in browser history and any
  access log that captures full URLs.
- **Account linking trust assumption**: a new OAuth sign-in is linked to an
  existing password-based account by email match only when the provider
  asserts the email is verified. Google's `userinfo` response has an
  explicit `email_verified` claim, honored directly. Microsoft's does not
  expose that claim, so an email returned there is treated as verified on
  the assumption that Microsoft only returns a mailbox it authenticated
  the sign-in against — the same assumption most production apps make,
  but a real one, stated here rather than left implicit.
- **No client secret ever reaches the browser.** `GOOGLE_CLIENT_SECRET` /
  `MICROSOFT_CLIENT_SECRET` are read only from environment variables on
  the server; the frontend only ever navigates to `/api/auth/:provider/start`
  (a same-origin link) and never sees a provider's credentials.
- **Provider buttons are hidden, not just disabled, when unconfigured.**
  `GET /api/config` reports `oauth.google`/`oauth.microsoft` as `false`
  unless both that provider's client id and secret are set; the frontend
  hides the corresponding button, and `/api/auth/:provider/start` 404s
  regardless of what the frontend shows.
- **An OAuth-created account gets no usable password.** Its
  `password_hash` is a bcrypt hash of random bytes nobody knows; signing in
  again means going through the same provider, the only identity actually
  verified for that account.

Known gap: there is no UI yet for a *logged-in* user to link a second
provider (or a password) to their existing account — only the automatic
email-match linking described above. Explicitly out of scope for this pass.

## Password reset (email code)

`POST /api/auth/forgot` → `POST /api/auth/verify-code` → `POST
/api/auth/reset-password`, backed by the `password_resets` table
(`server/db.js`). Notable properties:

- **Never reveals whether an account exists.** `/forgot` and
  `/forgot-username` return the identical generic response regardless of
  whether the identifier matched a real account with an email on file —
  checked before any rate-limit or lookup work that could otherwise leak
  timing, and rate-limited *before* the account lookup so a 429 doesn't
  leak existence either.
- **The 6-digit code is never stored in plaintext.** Only
  `hashWithPepper(code)` (SHA-256 salted with `JWT_SECRET`, see
  `server/auth.js`) is persisted, generated with `crypto.randomInt` (a CSPRNG,
  not `Math.random`). Comparison uses `crypto.timingSafeEqual`
  (`safeEqual()`), not `===`.
- **Max 5 wrong code attempts**, then the code is invalidated
  server-side (`code_hash` cleared) and a fresh `/forgot` request is
  required — a brute force of a 6-digit space (1,000,000 possibilities)
  never gets more than 5 guesses per requested code.
- **The reset token returned by `/verify-code` is single-use and
  short-lived** (15 min, `crypto.randomBytes(32)`, hashed the same way as
  the code before storage) — `reset-password` clears it the moment it's
  redeemed, so a captured token can't be replayed.
- **Resetting a password logs out every other session** for that
  account: `reset-password` bumps `token_version`, the same mechanism
  `POST /api/auth/logout` uses, invalidating every JWT issued before that
  moment.
- **Rate-limited two ways**: 3 code requests per identifier per hour and
  10 per IP per hour (`/forgot`, `/forgot-username` independently);
  `/verify-code` and `/reset-password` are separately capped per IP too.

## Rate limiting

An in-memory limiter (`rateLimited()` in `server/server.js`) throttles:

| Route | Limit | Keyed by |
|---|---|---|
| `POST /api/auth/register` | 10/15min | IP |
| `POST /api/auth/login` | 10/15min | IP |
| `POST /api/auth/forgot` | 3/hour + 10/hour | identifier + IP |
| `POST /api/auth/forgot-username` | 3/hour + 10/hour | identifier + IP |
| `POST /api/auth/verify-code` | 20/hour | IP |
| `POST /api/auth/reset-password` | 20/hour | IP |
| `GET /api/auth/:provider/start` | 20/min | IP |
| `GET /api/users/search` | 30/min | user id |
| `POST /api/friends/requests` | 20/min | user id |
| `POST /api/conversations/:friendId/messages` | 60/min | user id |

Register and login key on IP because there's no authenticated identity
yet at that point. Every other limited route is behind `requireAuth`, so
it keys on the verified user id instead — a precise, un-spoofable key
that sidesteps IP/proxy ambiguity entirely for those routes.

Login also tracks failed attempts per identifier (separately from the
IP-keyed limit above, never expiring early, reset on a successful login)
to decide when to require a CAPTCHA — see CAPTCHA above.

IP-based limiting is only as good as `req.ip`, which depends on
`TRUST_PROXY`. **Only set `TRUST_PROXY=1` if this server is genuinely
running behind a reverse proxy** (Render, or similar). Enabling it
without one lets any client set `X-Forwarded-For` themselves and claim
any IP, bypassing the register/login limits entirely.

The limiter's internal map is swept every 15 minutes to drop stale
entries (long enough to never wipe a still-active 1-hour window early)
so it doesn't grow unbounded over the server's lifetime.

## Input validation

Every write endpoint validates its input server-side, regardless of what
the client already checked:

- Usernames: 3-20 characters, letters/numbers/underscore only.
- Passwords: 6-200 characters.
- Email (optional): basic format check, capped at 200 characters.
- Display name, bio, avatar, message text, search query: all explicitly
  length-capped (`.slice(...)`) before they touch the database.

## Cross-site scripting (XSS)

All user-controlled content the frontend renders (usernames, display
names, bios, chat messages, notification text) is set via `textContent`,
never `innerHTML` — `innerHTML` is only ever used with the app's own
static icon markup, never with anything a user typed.

On top of that, `index.html` is served with a per-request nonce-based
Content-Security-Policy (`server/server.js`, the `GET /` handler):

```
default-src 'self'
script-src 'self' 'nonce-<random per request>' https://www.youtube.com https://challenges.cloudflare.com
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
font-src https://fonts.gstatic.com
img-src 'self' data: blob: https:
media-src 'self' data: blob: https:
frame-src https://www.youtube.com https://challenges.cloudflare.com
connect-src 'self' https://generativelanguage.googleapis.com
frame-ancestors 'none'
```

The app's entire frontend is one inline `<script>` tag; the CSP allows
it to run only because each response injects a fresh, unguessable nonce
into that exact tag and scopes `script-src` to it — `'unsafe-inline'` is
never used for scripts. `frame-ancestors 'none'` blocks this app from
being framed by anyone (clickjacking).

Two directives are intentionally loose, so they don't read as
oversights:

- `img-src`/`media-src` allow any `https:` source because the Settings
  page lets a user paste an arbitrary background image/video URL — there
  is no fixed set of hosts to allowlist without breaking that feature.
- `style-src` keeps `'unsafe-inline'` because the app uses inline
  `style="…"` attributes throughout; nonce-per-attribute isn't practical.
  This is a real, accepted gap, but it's scoped to styles only —
  `script-src`, the actual XSS vector, stays strict.

`https://www.youtube.com` is allowlisted for `script-src`/`frame-src`
because the background-video feature loads the YouTube IFrame API.
`https://challenges.cloudflare.com` is allowlisted the same way for the
Turnstile CAPTCHA widget (see CAPTCHA below) — its script and the iframe
it renders both need it, and neither is loaded at all unless CAPTCHA is
actually configured. `connect-src` allows
`https://generativelanguage.googleapis.com` because the AI chat feature
calls Google's Gemini API directly from the browser with a user-supplied
key (the app's own Settings UI already tells the user that key is sent
directly to Google, never to this app's server).

Baseline headers (`X-Content-Type-Options: nosniff`, `Referrer-Policy:
no-referrer`, `X-Frame-Options: DENY`, HSTS) come from `helmet`, configured
with its own CSP disabled (the CSP above replaces it) and frameguard set to
`deny` to match `frame-ancestors 'none'`. The server's helmet config
(`server/server.js`) only overrides `contentSecurityPolicy` and
`frameguard`; every other header — including `Referrer-Policy` — is
whatever the installed `helmet` version defaults to (currently `no-referrer`
in helmet 8.x, verified by running the server and inspecting the response
headers directly). If `helmet` is ever upgraded, re-check that default
rather than assuming it stays `no-referrer`.

## Secrets

`JWT_SECRET` is required at startup (the server refuses to boot without
it) and is read only from environment variables / `server/.env`, which
is gitignored and has never been committed (checked against full git
history, not just the current working tree). No secret — the JWT
signing key, a user's password hash, or anything else — is ever sent to
the client. `publicUser()` (the function that shapes every user object
the API returns) never includes `email` or `password_hash`.

## Dependency security

`npm audit` reports 0 vulnerabilities (across all severities) for this
server's dependencies as of this writing. That's a snapshot, not a
guarantee — re-run `npm audit` periodically (e.g. before a release),
rather than assuming it stays clean forever.

## Logging

Failed logins and `requireAuth` rejections are logged (`console.warn`,
so they show up in stdout/any host's log capture) with the identifier
or route involved and the requesting IP — enough to spot brute-forcing
or probing. Passwords, tokens, and API keys are never logged, on success
or failure.

## Known limitations

These are accepted gaps, not oversights — listed explicitly so nobody
mistakes silence for "solved":

- **No per-device session revocation.** Logout invalidates every token
  for that user, everywhere, because there's no per-device session
  table. If you only meant to sign out one browser, you'll need to log
  back in on the others too.
- **No email verification for password-based signup.** An email address
  attached via `POST /api/auth/register` is never confirmed to belong to
  the account owner. (An email attached via Google/Microsoft sign-in *is*
  provider-verified — see OAuth above — but that only covers accounts
  created that way.)
- **No two-factor authentication.**
- **The WebSocket Origin check does not gate non-browser clients.** As
  described in Realtime security above, `ALLOWED_ORIGIN` only rejects
  connections that send a mismatched `Origin` header. It does not require
  an `Origin` header to be present, so a scripted client with a valid
  token — stolen, leaked, or otherwise obtained — connects successfully
  regardless of this setting. The real backstop against token compromise
  is the token's short lifetime and revocability via logout, not the
  Origin check.
- **Real CAPTCHA protection requires setting real keys (see CAPTCHA
  above).** A deployment that never sets `TURNSTILE_SITE_KEY`/
  `TURNSTILE_SECRET_KEY` falls back to Cloudflare's public always-pass
  test keys — a widget renders, but it provides no bot protection beyond
  the rate limits described below.
- **The WebSocket token is passed in the URL query string.** This is the
  standard pattern for authenticating browser WebSockets (they can't set
  custom headers on the upgrade request), but it does mean the token can
  appear in access logs or proxy logs that capture full request URLs.
  Short-lived, revocable tokens (7 days, killable via logout) are the
  mitigation in place rather than a different transport.

## Explicitly out of scope, and why

- **XP, leaderboard, and study-session validation.** These systems don't
  have a server-side implementation yet — everything currently runs
  client-side only. There's nothing to harden server-side until they're
  built; this document will need a follow-up section once they are.
- **File-upload security.** There is no file-upload endpoint on this
  server. Avatars are short emoji strings, and profile "photos" live
  entirely in the browser's IndexedDB — they never reach the server.
- **SSRF (server-side request forgery).** No server-side code fetches a
  user-supplied URL. Background image/video URLs a user pastes into
  Settings are loaded directly by the *browser*, never by the server.

## Deployment security requirements

Before deploying this anywhere real:

- Set a genuine, randomly generated `JWT_SECRET` in the production
  environment. Never reuse the value from a local/dev `.env` file.
  (`server/.env.example` has a one-liner to generate one.)
- Set `ALLOWED_ORIGIN` to the actual production origin if the frontend
  is ever split onto a different domain/host than this API. If it's
  served same-origin (the default), you can leave it unset.
- Set `TRUST_PROXY=1` **only if** this server is actually running behind
  a real reverse proxy that sets `X-Forwarded-For` (Render, etc.).
  Setting it without one breaks IP-based rate limiting, as noted above.
- Serve everything over HTTPS. This is required for HSTS to have any
  effect, and it's what keeps the WebSocket's query-string token from
  ever crossing the network in plaintext.
- Set `BASE_URL` to the real production origin (e.g.
  `https://your-app.example.com`, no trailing slash) before enabling
  either OAuth provider — it's used to build the redirect URI sent to
  Google/Microsoft, which must exactly match what's registered in their
  consoles. A stale `localhost` value here breaks OAuth silently in
  production (their consent screen will report a redirect_uri mismatch).
- Set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (Cloudflare
  dashboard) to turn on *real* bot protection for signup/login/forgot-password.
  Without both, the app still shows a working-looking CAPTCHA (Cloudflare's
  public test keys, see CAPTCHA above) that always passes — those endpoints
  are then protected only by the rate limits above, same as before this
  fallback existed.
- Set `RESEND_API_KEY` and `EMAIL_FROM` (an address on a domain verified in
  your Resend account) to actually deliver password-reset and
  forgot-username emails. Without `RESEND_API_KEY`, those emails are only
  ever written to the server's own logs (see `server/email.js`) — the
  flow still works end-to-end for testing, but no real user ever receives
  the email.
- Set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and/or
  `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET` to enable "Continue
  with Google/Microsoft" — each pair is independent, and a provider stays
  hidden until both its values are set. Register the redirect URI
  `<BASE_URL>/api/auth/<provider>/callback` in that provider's console
  first, or the callback will fail.
- Use separate OAuth client registrations (and separate Turnstile
  widgets, if you want per-environment analytics) for development and
  production — `server/.env.example` documents this per variable.
