'use strict';
/* Coverage for Study Lounge shared chat (text + images), voice-chat signaling relay, and the
   custom sprint length. Run with the server already started:
     node test/e2e-room-chat-voice.js
   Signup needs a captcha token; any non-empty string passes against Cloudflare's test keys
   (the server's default when TURNSTILE_* env vars are unset). */

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const WS_BASE = BASE.replace('http', 'ws');

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`  ok - ${label}`); }
  else { failed++; console.error(`  FAIL - ${label}`); }
}
async function api(token, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}
function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?token=${token}`);
    const events = [];
    ws.addEventListener('message', (e) => events.push(JSON.parse(e.data)));
    ws.addEventListener('open', () => resolve({ ws, events, send: (o) => ws.send(JSON.stringify(o)) }));
    ws.addEventListener('error', reject);
  });
}
function waitFor(events, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for event; saw: ' + JSON.stringify(events.map((e) => e.type))));
      setTimeout(check, 30);
    };
    check();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1x1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_B64}`;

async function main() {
  const suffix = Date.now().toString(36);
  const reg = async (name) => (await api(null, 'POST', '/api/auth/register', { username: `${name}_${suffix}`, password: 'hunter22', captchaToken: 'test' })).json;
  const [a, b, c] = [await reg('ChatA'), await reg('ChatB'), await reg('ChatC')];
  const aTok = a.token, bTok = b.token, cTok = c.token;
  const aId = a.user.id, bId = b.user.id, cId = c.user.id;

  const created = await api(aTok, 'POST', '/api/lounge/rooms', { goal: 'chat test' });
  const code = created.json.room.code;
  await api(bTok, 'POST', `/api/lounge/rooms/${code}/join`);
  const aSock = await connectSocket(aTok);
  const bSock = await connectSocket(bTok);
  const cSock = await connectSocket(cTok);

  console.log('1. room chat: text');
  const empty = await api(aTok, 'GET', `/api/lounge/rooms/${code}/messages`);
  assert(empty.status === 200 && empty.json.messages.length === 0, 'new room has empty history');
  const sent = await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { text: '  hello room  ' });
  assert(sent.status === 201 && sent.json.message.text === 'hello room' && sent.json.message.sender.id === aId, 'text message is stored trimmed with its sender');
  const pushed = await waitFor(bSock.events, (e) => e.type === 'room-message');
  assert(pushed.message.text === 'hello room' && pushed.roomCode === code, 'other member receives it live over the WebSocket');
  assert(cSock.events.every((e) => e.type !== 'room-message'), 'a non-member receives nothing');
  const cRead = await api(cTok, 'GET', `/api/lounge/rooms/${code}/messages`);
  const cWrite = await api(cTok, 'POST', `/api/lounge/rooms/${code}/messages`, { text: 'let me in' });
  assert(cRead.status === 404 && cWrite.status === 404, 'a non-member can neither read nor write');
  assert((await api(null, 'GET', `/api/lounge/rooms/${code}/messages`)).status === 401, 'unauthenticated read is rejected');
  assert((await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { text: '   ' })).status === 400, 'blank message rejected');
  assert((await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { text: 'x'.repeat(1001) })).status === 400, 'over-long message rejected');
  const late = await api(bTok, 'GET', `/api/lounge/rooms/${code}/messages`);
  assert(late.json.messages.length === 1 && late.json.messages[0].text === 'hello room', 'history is served to members');

  console.log('2. room chat: images');
  const img = await api(bTok, 'POST', `/api/lounge/rooms/${code}/messages`, { text: 'look', image: PNG_URL });
  assert(img.status === 201 && img.json.message.hasImage && img.json.message.imageMime === 'image/png', 'png accepted');
  const imgRes = await fetch(`${BASE}/api/lounge/rooms/${code}/messages/${img.json.message.id}/image`, { headers: { Authorization: `Bearer ${aTok}` } });
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  assert(imgRes.status === 200 && imgRes.headers.get('content-type') === 'image/png' && bytes.equals(Buffer.from(PNG_B64, 'base64')), 'a member downloads the exact bytes back with the right type');
  const cImg = await fetch(`${BASE}/api/lounge/rooms/${code}/messages/${img.json.message.id}/image`, { headers: { Authorization: `Bearer ${cTok}` } });
  assert(cImg.status === 404, 'a non-member cannot download the image');
  const imgOnly = await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { image: PNG_URL });
  assert(imgOnly.status === 201 && imgOnly.json.message.text === '', 'image without text accepted');
  const listed = await api(aTok, 'GET', `/api/lounge/rooms/${code}/messages`);
  assert(JSON.stringify(listed.json).length < 5000, 'history lists metadata only, never image bytes');
  const fakePng = await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { image: `data:image/png;base64,${Buffer.from('<script>alert(1)</script> not an image').toString('base64')}` });
  assert(fakePng.status === 400, 'content that is not really an image is rejected even if labelled png');
  const svg = await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { image: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}` });
  assert(svg.status === 400, 'svg rejected');
  assert((await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { image: 'https://evil.example/x.png' })).status === 400, 'non-data-URL image rejected');
  const big = Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(5 * 1024 * 1024 + 10)]);
  const bigRes = await api(aTok, 'POST', `/api/lounge/rooms/${code}/messages`, { image: `data:image/png;base64,${big.toString('base64')}` });
  assert(bigRes.status === 413, 'image over 5 MB rejected with 413');

  console.log('3. custom sprint length');
  const start = (n) => api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/start`, { targetPomodoros: n });
  for (const bad of [0, 13, 1.5, -2, 'abc', null]) {
    assert((await start(bad)).status === 400, `targetPomodoros ${JSON.stringify(bad)} rejected`);
  }
  assert((await start(7)).status === 200, 'custom 7 accepted');
  const room7 = await api(aTok, 'GET', `/api/lounge/rooms/${code}`);
  assert(room7.json.room.mission.targetPomodoros === 7, 'room reports the custom target');
  const ci = await api(bTok, 'POST', `/api/lounge/rooms/${code}/mission/checkin`);
  const afterCi = await api(bTok, 'GET', `/api/lounge/rooms/${code}`);
  assert(ci.status === 200 && afterCi.json.room.members.find((m) => m.id === bId).missionProgress === 1, 'check-in counts toward a target above 4');
  assert((await api(bTok, 'POST', `/api/lounge/rooms/${code}/mission/giveup`)).status === 200, 'give up works');
  assert((await api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/cancel`)).status === 200, 'cancel works');
  assert((await start(12)).status === 200, 'upper bound 12 accepted');
  await api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/cancel`);
  assert((await start(1)).status === 200, 'lower bound 1 accepted');
  await api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/cancel`);
  const startWith = (focusMinutes, breakMinutes) => api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/start`, { targetPomodoros: 2, focusMinutes, breakMinutes });
  for (const [f, b] of [[4, 5], [121, 5], [25, 0], [25, 61], [25.5, 5], ['x', 5]]) {
    assert((await startWith(f, b)).status === 400, `focus ${JSON.stringify(f)} / break ${JSON.stringify(b)} rejected`);
  }
  assert((await startWith(50, 10)).status === 200, 'focus 50 / break 10 accepted');
  const room50 = await api(bTok, 'GET', `/api/lounge/rooms/${code}`);
  assert(room50.json.room.mission.focusMinutes === 50 && room50.json.room.mission.breakMinutes === 10, 'every member sees the durations');
  await api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/cancel`);
  assert((await start(2)).status === 200 && (await api(bTok, 'GET', `/api/lounge/rooms/${code}`)).json.room.mission.focusMinutes === 25, 'omitted durations default to 25/5');
  await api(aTok, 'POST', `/api/lounge/rooms/${code}/mission/cancel`);

  console.log('4. voice signaling relay');
  assert((await api(aTok, 'GET', '/api/lounge/voice/ice')).json.iceServers[0].urls.some((u) => u.startsWith('stun:')), 'ICE config includes STUN');
  assert((await api(null, 'GET', '/api/lounge/voice/ice')).status === 401, 'ICE config requires login');
  aSock.send({ type: 'voice-join', muted: false, deafened: false });
  const aPeers = await waitFor(aSock.events, (e) => e.type === 'voice-peers');
  assert(aPeers.peers.length === 0, 'first person into voice sees nobody');
  bSock.send({ type: 'voice-join', muted: true, deafened: false });
  const bPeers = await waitFor(bSock.events, (e) => e.type === 'voice-peers');
  assert(bPeers.peers.length === 1 && bPeers.peers[0].userId === aId, 'second joiner is told who is already in voice');
  const joined = await waitFor(aSock.events, (e) => e.type === 'voice-peer-joined');
  assert(joined.userId === bId && joined.muted === true, 'existing member is told about the joiner and their mute flag');
  bSock.send({ type: 'voice-signal', to: aId, data: { description: { type: 'offer', sdp: 'fake' } } });
  const sig = await waitFor(aSock.events, (e) => e.type === 'voice-signal');
  assert(sig.from === bId && sig.data.description.type === 'offer', 'signal is relayed with the sender id stamped by the server');
  cSock.send({ type: 'voice-signal', to: aId, data: { description: { type: 'offer', sdp: 'evil' } } });
  cSock.send({ type: 'voice-join' });
  await sleep(300);
  assert(aSock.events.filter((e) => e.type === 'voice-signal').length === 1 && aSock.events.every((e) => e.type !== 'voice-peer-joined' || e.userId !== cId), 'a non-member can neither inject signals nor join a room\'s voice');
  aSock.send({ type: 'voice-signal', to: aId, data: { x: 1 } });
  aSock.send({ type: 'voice-signal', to: bId, data: 'not-an-object' });
  await sleep(200);
  assert(!aSock.events.some((e) => e.type === 'voice-signal' && e.from === aId) && !bSock.events.some((e) => e.type === 'voice-signal'), 'self-signals and malformed payloads are dropped');
  aSock.send({ type: 'voice-state', muted: true, deafened: true });
  const st = await waitFor(bSock.events, (e) => e.type === 'voice-state');
  assert(st.userId === aId && st.muted === true && st.deafened === true, 'mute/deafen flags are broadcast');
  const beforeJunk = bSock.events.length;
  aSock.ws.send('not json'); aSock.send({ type: 'lounge-room', room: {} }); aSock.send({ type: 'voice-bogus' });
  await sleep(200);
  assert(bSock.events.length === beforeJunk, 'junk and non-voice client messages are ignored');
  const bSock2 = await connectSocket(bTok);
  bSock2.send({ type: 'voice-join' });
  await waitFor(bSock.events, (e) => e.type === 'voice-replaced');
  assert(true, 'joining voice from a second tab replaces the first');
  await waitFor(aSock.events, (e) => e.type === 'voice-peer-left' && e.userId === bId);
  await waitFor(aSock.events, (e) => e.type === 'voice-peer-joined' && e.userId === bId);
  bSock2.ws.close();
  const left = await waitFor(aSock.events, (e) => e.type === 'voice-peer-left' && e.userId === bId && aSock.events.filter((x) => x.type === 'voice-peer-left').length >= 2);
  assert(!!left, 'closing the socket removes a person from voice');
  bSock.send({ type: 'voice-join' }); // bSock was superseded, but is still a valid socket
  await sleep(100);
  aSock.events.length = 0;
  await api(aTok, 'POST', `/api/lounge/rooms/${code}/leave`);
  await sleep(200);
  const cLate = await api(aTok, 'GET', `/api/lounge/rooms/${code}/messages`);
  assert(cLate.status === 404, 'after leaving, the former member can no longer read the room chat');

  console.log('5. chat lifetime: it disappears with the room');
  await api(bTok, 'POST', `/api/lounge/rooms/${code}/leave`).catch(() => {});
  const roomGone = await api(bTok, 'GET', `/api/lounge/rooms/${code}/messages`);
  assert(roomGone.status === 404, 'once the last member leaves the room (and its chat) is gone');

  for (const s of [aSock, bSock, cSock]) s.ws.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('CRASHED:', err); process.exit(1); });
