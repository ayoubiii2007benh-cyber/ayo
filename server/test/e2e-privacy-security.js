'use strict';
/* End-to-end checks for the privacy + security work: cookie sessions, CSRF, consent, brute-force
   backoff, data export, account deletion, websocket origin rules, headers.
   Run the server against an in-memory database, then this script:
     node test/run-local.js            (shell 1 -- never touches a real database)
     TEST_BASE_URL=http://localhost:3100 node test/e2e-privacy-security.js    (shell 2) */

const jwt = require('jsonwebtoken');
const { WebSocket: WS } = require('ws');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3100';
const WS_BASE = BASE.replace('http', 'ws');
const JWT_SECRET = process.env.JWT_SECRET || 'local-test-secret-' + 'x'.repeat(40);

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ok - ${label}`); } else { failed++; console.error(`  FAIL - ${label}`); }
}

/** Minimal browser: keeps the session cookie and the CSRF token from the last auth response. */
class Client {
  constructor() { this.cookies = {}; this.csrf = null; }
  cookieHeader() { return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
  absorb(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim(); const value = pair.slice(i + 1).trim();
      if (value === '' || /max-age=0/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line)) delete this.cookies[name]; else this.cookies[name] = value;
    }
  }
  async call(method, path, body, { csrf = true, headers = {} } = {}) {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (Object.keys(this.cookies).length) h.Cookie = this.cookieHeader();
    if (csrf && this.csrf) h['X-CSRF-Token'] = this.csrf;
    const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    this.absorb(res);
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (json && json.csrfToken) this.csrf = json.csrfToken;
    return { status: res.status, json, text, headers: res.headers, setCookie: res.headers.getSetCookie() };
  }
}

const CAPTCHA = 'XXXX.DUMMY.TOKEN.XXXX'; // accepted by Cloudflare's published always-pass test secret
const PASSWORD = 'correct-horse-battery';

async function register(client, username, extra = {}) {
  return client.call('POST', '/api/auth/register', { username, password: PASSWORD, displayName: username, captchaToken: CAPTCHA, acceptTerms: true, ...extra });
}

function openSocket(headers) {
  return new Promise((resolve) => {
    const ws = new WS(`${WS_BASE}/ws`, { headers });
    const events = [];
    ws.on('message', (d) => events.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, events, opened: true }));
    ws.on('error', () => resolve({ ws, events, opened: false }));
    ws.on('unexpected-response', () => resolve({ ws, events, opened: false }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const suffix = Date.now().toString(36);
  const aliceName = `alice_${suffix}`;
  const bobName = `bob_${suffix}`;

  console.log('1. security headers + CSP');
  const home = await fetch(BASE + '/');
  const csp = home.headers.get('content-security-policy') || '';
  assert(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/.test(csp), 'CSP carries a per-request nonce');
  assert(!/script-src[^;]*unsafe-inline/.test(csp), "script-src never allows 'unsafe-inline'");
  assert(/frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp), 'frame-ancestors/object-src/base-uri locked down');
  assert(!/fonts\.googleapis/.test(csp), 'no Google Fonts host allowed (font is self-hosted)');
  assert(/googletagmanager\.com/.test(csp) && /google-analytics\.com/.test(csp), 'Google Analytics hosts allowed');
  assert(/max-age=31536000/.test(home.headers.get('strict-transport-security') || ''), 'HSTS set');
  assert(home.headers.get('x-content-type-options') === 'nosniff', 'nosniff set');
  assert(/camera=\(self\)/.test(home.headers.get('permissions-policy') || '') && /geolocation=\(\)/.test(home.headers.get('permissions-policy') || ''), 'Permissions-Policy set');
  assert(home.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy set');
  const html = await home.text();
  const bareScripts = (html.match(/<script>/g) || []).length;
  assert(bareScripts === 0, 'every inline <script> got the nonce');
  const cfg = await fetch(BASE + '/api/config');
  assert(cfg.headers.get('cache-control') === 'no-store', 'API responses are not cacheable');
  for (const page of ['privacy', 'terms', 'cookies']) {
    const r = await fetch(`${BASE}/${page}`);
    assert(r.status === 200 && (r.headers.get('content-type') || '').includes('html'), `/${page} is served`);
  }
  assert((await fetch(BASE + '/assets/consent.js')).status === 200, '/assets/consent.js is served');
  assert((await fetch(BASE + '/assets/fonts/figtree-latin.woff2')).status === 200, 'self-hosted font is served');

  console.log('2. registration requires consent + a decent password');
  const alice = new Client();
  assert((await register(alice, aliceName, { acceptTerms: undefined })).status === 400, 'register without acceptTerms is refused');
  assert((await register(alice, aliceName, { acceptTerms: 'yes' })).status === 400, 'register with acceptTerms="yes" (not boolean true) is refused');
  assert((await register(alice, aliceName, { password: 'short' })).status === 400, 'short password refused');
  assert((await register(alice, aliceName, { password: 'password123' })).status === 400, 'common password refused');
  assert((await register(alice, aliceName, { password: 'x'.repeat(80) + 'Q1' })).status === 400, 'password over 72 bytes refused');
  const aliceReg = await register(alice, aliceName, { email: `${aliceName}@example.com` });
  assert(aliceReg.status === 201, 'Alice registers with consent');
  assert(aliceReg.json && !('token' in aliceReg.json), 'response body never contains the session token');
  const sc = aliceReg.setCookie.join('\n');
  assert(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Path=\//i.test(sc), 'session cookie is HttpOnly + SameSite=Lax');
  assert(/Max-Age=\d+|Expires=/i.test(sc), 'session cookie expires');
  assert(aliceReg.json.consentRequired === false, 'fresh account has no pending consent');
  const aliceId = aliceReg.json.user.id;

  console.log('3. cookie session + CSRF');
  const anon = new Client();
  assert((await anon.call('GET', '/api/auth/me')).status === 401, 'no cookie -> 401');
  assert((await alice.call('GET', '/api/auth/me')).status === 200, 'cookie -> /me works');
  assert((await alice.call('POST', '/api/conversations/nobody/read', {}, { csrf: false })).status === 403, 'state-changing call without CSRF token -> 403');
  assert((await alice.call('POST', '/api/conversations/nobody/read', {}, { headers: { 'X-CSRF-Token': 'wrong' }, csrf: false })).status === 403, 'wrong CSRF token -> 403');
  assert((await alice.call('POST', '/api/conversations/nobody/read', {})).status === 403 /* not friends */, 'correct CSRF token passes (then normal 403 not-friends)');
  const cross = await alice.call('POST', '/api/account/consent', { accept: true }, { headers: { Origin: 'https://evil.example' } });
  assert(cross.status === 403, 'cross-site Origin on a POST is refused');
  assert((await alice.call('POST', '/api/account/consent', { accept: true }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status === 403, 'Sec-Fetch-Site: cross-site refused');
  assert((await alice.call('GET', '/api/auth/me', undefined, { headers: { Authorization: `Bearer ${jwt.sign({ sub: aliceId, ver: 0 }, JWT_SECRET)}` } })).status === 200, 'cookie still works alongside a stray Authorization header');
  const bearerOnly = new Client();
  assert((await bearerOnly.call('GET', '/api/auth/me', undefined, { headers: { Authorization: `Bearer ${jwt.sign({ sub: aliceId, ver: 0 }, JWT_SECRET)}` } })).status === 401, 'a bearer token alone no longer authenticates API routes');

  console.log('4. old localStorage token -> cookie migration');
  const legacy = new Client();
  const up = await legacy.call('POST', '/api/auth/session/upgrade', {}, { headers: { Authorization: `Bearer ${jwt.sign({ sub: aliceId, ver: 0 }, JWT_SECRET)}` } });
  assert(up.status === 200 && Object.keys(legacy.cookies).length === 1, 'valid legacy token is exchanged for a cookie');
  assert((await new Client().call('POST', '/api/auth/session/upgrade', {}, { headers: { Authorization: 'Bearer nope' } })).status === 401, 'garbage legacy token refused');
  assert((await new Client().call('POST', '/api/auth/session/upgrade', {}, { headers: { Authorization: `Bearer ${jwt.sign({ sub: aliceId, ver: 99 }, JWT_SECRET)}` } })).status === 401, 'legacy token with stale version refused');

  console.log('5. login: consent, timing-safe failure, brute-force backoff');
  const fresh = new Client();
  const okLogin = await fresh.call('POST', '/api/auth/login', { identifier: aliceName, password: PASSWORD, acceptTerms: true });
  assert(okLogin.status === 200 && okLogin.json.user.username === aliceName, 'login works');
  const victim = `victim_${suffix}`;
  assert((await register(new Client(), victim)).status === 201, 'victim account created');
  let lastStatus = 0; let sawCaptcha = false;
  for (let i = 1; i <= 7; i += 1) { // (login is also limited to 10 per IP per 15 min, so stay under that)
    const r = await new Client().call('POST', '/api/auth/login', { identifier: victim, password: `wrong-password-${i}`, captchaToken: CAPTCHA });
    lastStatus = r.status; if (r.json && r.json.captchaRequired) sawCaptcha = true;
  }
  assert(sawCaptcha, 'captcha is demanded after repeated failures');
  assert(lastStatus === 429, 'account is temporarily locked after repeated failures (backoff)');
  const locked = await new Client().call('POST', '/api/auth/login', { identifier: victim, password: PASSWORD, captchaToken: CAPTCHA, acceptTerms: true });
  assert(locked.status === 429, 'even the right password is refused while locked');

  console.log('6. search + input hardening');
  assert((await alice.call('GET', '/api/users/search?q=%25%25')).json.users.length === 0, 'a "%%" search does not match everyone');
  const bad = await alice.call('GET', '/api/conversations/whoever/messages?before=abc');
  assert(bad.status === 403, 'garbage ?before= is handled (not a server crash)');
  assert((await fetch(BASE + '/api/config')).status === 200, 'server still alive after the garbage request');
  assert((await alice.call('PATCH', '/api/auth/me', { avatarUrl: 'https://x.example/a.png"),url(https://evil' })).status === 400, 'avatar URL with quotes/parens refused');
  assert((await alice.call('PATCH', '/api/auth/me', { avatarUrl: 'https://x.example/a.png' })).status === 200, 'plain https avatar URL accepted');

  console.log('7. friends, rooms, then export');
  const bob = new Client();
  const bobReg = await register(bob, bobName);
  const bobId = bobReg.json.user.id;
  const fr = await alice.call('POST', '/api/friends/requests', { toUserId: bobId });
  assert(fr.status === 201, 'Alice sends Bob a friend request');
  const incoming = await bob.call('GET', '/api/friends/requests');
  assert((await bob.call('POST', `/api/friends/requests/${incoming.json.incoming[0].id}/accept`, {})).status === 200, 'Bob accepts');
  assert((await alice.call('POST', `/api/conversations/${bobId}/messages`, { text: 'hello bob' })).status === 201, 'Alice DMs Bob');
  const stranger = await new Client();
  await register(stranger, `carol_${suffix}`);
  const carolView = await stranger.call('GET', `/api/users/${aliceId}`);
  assert(carolView.json.user.lastSeenAt === null && carolView.json.user.online === false, 'non-friends see no presence / last-seen');
  const bobView = await bob.call('GET', `/api/users/${aliceId}`);
  assert(bobView.json.user.lastSeenAt !== null, 'friends do see last-seen');

  const room = await alice.call('POST', '/api/lounge/rooms', { goal: 'study' });
  assert(room.status === 201, 'Alice creates a room');
  assert((await bob.call('POST', `/api/lounge/rooms/${room.json.room.code}/join`, {})).status === 200, 'Bob joins it');
  assert((await alice.call('POST', `/api/lounge/rooms/${room.json.room.code}/messages`, { text: 'room hello' })).status === 201, 'Alice posts in the room');

  const exp = await alice.call('GET', '/api/account/export');
  assert(exp.status === 200 && /attachment/.test(exp.headers.get('content-disposition') || ''), 'export downloads as a file');
  const data = exp.json;
  assert(data && data.account.username === aliceName && data.account.email === `${aliceName}@example.com`, 'export has the account');
  assert(data.account.agreedToTermsAndPrivacyVersion === '2026-09-30' && data.account.agreedAt, 'export shows the recorded consent (version + time)');
  assert(data.friends.length === 1 && data.directMessages[0].messages[0].text === 'hello bob', 'export has friends and direct messages');
  assert(!/password|hash|token_version/i.test(exp.text.replace(/"about"[^\n]*\n/, '')), 'export never contains password hashes or tokens');
  assert((await new Client().call('GET', '/api/account/export')).status === 401, 'export needs a session');

  console.log('8. websocket: origin + cookie rules');
  const okWs = await openSocket({ Cookie: alice.cookieHeader(), Origin: BASE });
  await sleep(300);
  assert(okWs.opened, 'same-origin websocket with session cookie connects');
  const evil = await openSocket({ Cookie: alice.cookieHeader(), Origin: 'https://evil.example' });
  assert(!evil.opened, 'websocket from another origin is refused');
  const noOrigin = await openSocket({ Cookie: alice.cookieHeader() });
  await sleep(300);
  const bobSocket = await openSocket({ Cookie: bob.cookieHeader(), Origin: BASE });
  await sleep(300);
  assert(bobSocket.events.some((e) => e.type === 'online-count'), 'bob socket gets online-count');
  const presence = await alice.call('GET', '/api/friends');
  assert(presence.json.friends[0].online === true, 'cookie-authenticated socket marks the user online');
  const queryTok = await openSocket({ Origin: BASE });
  queryTok.ws.close(); noOrigin.ws.close(); evil.ws.close();

  console.log('9. account deletion');
  assert((await alice.call('POST', '/api/account/delete', { password: 'wrong-wrong-wrong' })).status === 400, 'deletion needs the right password');
  assert((await alice.call('POST', '/api/account/delete', {}, { csrf: false })).status === 403, 'deletion needs the CSRF token');
  const bobNotifsBefore = await bob.call('GET', '/api/notifications');
  assert(bobNotifsBefore.json.notifications.some((n) => JSON.stringify(n.data).includes(aliceId)), 'Bob holds notifications that embed Alice (before)');
  const del = await alice.call('POST', '/api/account/delete', { password: PASSWORD });
  assert(del.status === 200, 'Alice deletes her account');
  assert((await alice.call('GET', '/api/auth/me')).status === 401, 'her session is dead');
  assert((await new Client().call('POST', '/api/auth/login', { identifier: aliceName, password: PASSWORD, acceptTerms: true })).status === 401, 'she can no longer log in');
  const bobNotifsAfter = await bob.call('GET', '/api/notifications');
  assert(!JSON.stringify(bobNotifsAfter.json).includes(aliceId), "Bob's notifications no longer hold any copy of Alice");
  assert((await bob.call('GET', '/api/friends')).json.friends.length === 0, 'Alice is gone from Bob\'s friends');
  const bobRoom = await bob.call('GET', '/api/lounge/rooms/mine');
  assert(bobRoom.json.room && bobRoom.json.room.hostId === bobId, 'the room survived for Bob, who became host');
  assert((await bob.call('GET', `/api/lounge/rooms/${room.json.room.code}/messages`)).json.messages.every((m) => m.sender.id !== aliceId), "Alice's room messages were erased");
  await sleep(300);
  assert(okWs.ws.readyState === WS.CLOSED || okWs.ws.readyState === WS.CLOSING, "Alice's open socket was closed");
  okWs.ws.close(); bobSocket.ws.close();

  console.log('10. logout revokes the session + clears the cookie');
  const out = await bob.call('POST', '/api/auth/logout', {});
  assert(out.status === 200 && out.setCookie.some((c) => /pomo_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)), 'logout clears the cookie');
  assert((await bob.call('GET', '/api/auth/me')).status === 401, 'session is gone after logout');

  console.log('11. oauth consent gate');
  const start = await fetch(BASE + '/api/auth/google/start', { redirect: 'manual' });
  assert(start.status === 404, 'unconfigured provider stays hidden');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('E2E CRASHED:', err); process.exit(1); });
