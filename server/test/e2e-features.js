'use strict';
/* Functional + adversarial coverage for this session's new backend surface:
   Study Lounge rooms (create/join/leave/status/mission/invites), the friends
   leaderboard, and avatar URL validation. Run with the server already started:
     node test/e2e-features.js */

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
    ws.addEventListener('open', () => resolve({ ws, events }));
    ws.addEventListener('error', reject);
  });
}
function waitFor(events, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout: ' + JSON.stringify(events)));
      setTimeout(check, 50);
    };
    check();
  });
}

async function main() {
  const suffix = Date.now().toString(36);
  const aReg = await api(null, 'POST', '/api/auth/register', { username: `RoomA_${suffix}`, password: 'hunter22' });
  const bReg = await api(null, 'POST', '/api/auth/register', { username: `RoomB_${suffix}`, password: 'hunter22' });
  const cReg = await api(null, 'POST', '/api/auth/register', { username: `RoomC_${suffix}`, password: 'hunter22' }); // stranger, not friends with A/B
  const aToken = aReg.json.token, aId = aReg.json.user.id;
  const bToken = bReg.json.token, bId = bReg.json.user.id;
  const cToken = cReg.json.token, cId = cReg.json.user.id;

  console.log('setup: A and B become friends (C stays a stranger)');
  const req1 = await api(aToken, 'POST', '/api/friends/requests', { toUserId: bId });
  await api(bToken, 'POST', `/api/friends/requests/${req1.json.requestId}/accept`);

  console.log('1. avatar URL validation');
  const badScheme = await api(aToken, 'PATCH', '/api/auth/me', { avatarUrl: 'http://insecure.example.com/a.png' });
  assert(badScheme.status === 400, 'http:// (not https://) avatar URL rejected');
  const dataUri = await api(aToken, 'PATCH', '/api/auth/me', { avatarUrl: 'data:image/png;base64,AAAA' });
  assert(dataUri.status === 400, 'data: URI avatar rejected');
  const goodUrl = await api(aToken, 'PATCH', '/api/auth/me', { avatarUrl: 'https://example.com/avatar.png' });
  assert(goodUrl.status === 200 && goodUrl.json.user.avatarUrl === 'https://example.com/avatar.png', 'valid https:// avatar URL accepted and echoed back');
  const cleared = await api(aToken, 'PATCH', '/api/auth/me', { avatarUrl: '' });
  assert(cleared.status === 200 && cleared.json.user.avatarUrl === null, 'empty string clears avatarUrl');

  console.log('2. room lifecycle: create, real-time join broadcast, status, leave/host reassignment');
  const aSock = await connectSocket(aToken);
  const bSock = await connectSocket(bToken);
  const create = await api(aToken, 'POST', '/api/lounge/rooms', { goal: 'Deep work' });
  assert(create.status === 201 && create.json.room.hostId === aId, 'A creates a room and is host');
  const code = create.json.room.code;

  const join = await api(bToken, 'POST', `/api/lounge/rooms/${code}/join`);
  assert(join.status === 200 && join.json.room.members.length === 2, 'B joins by code');
  const pushedToA = await waitFor(aSock.events, (e) => e.type === 'lounge-room' && e.room.members.length === 2);
  assert(pushedToA.room.members.some((m) => m.id === bId), "A's socket is live-pushed B's join");

  const statusRes = await api(bToken, 'POST', `/api/lounge/rooms/${code}/status`, { status: 'focusing', remainingMs: 900000 });
  assert(statusRes.status === 200, 'B reports a status update');
  const pushedStatus = await waitFor(aSock.events, (e) => e.type === 'lounge-room' && e.room.members.find((m) => m.id === bId)?.status === 'focusing');
  assert(!!pushedStatus, "A's socket sees B's live status change");

  const leaveA = await api(aToken, 'POST', `/api/lounge/rooms/${code}/leave`);
  assert(leaveA.status === 200, 'A (the host) leaves');
  const afterLeave = await api(bToken, 'GET', `/api/lounge/rooms/${code}`);
  assert(afterLeave.json.room.hostId === bId, 'host reassigned to B, the only remaining member');

  console.log('3. IDOR: a non-member cannot touch the room');
  const cStatus = await api(cToken, 'POST', `/api/lounge/rooms/${code}/status`, { status: 'focusing', remainingMs: 1000 });
  assert(cStatus.status === 404, 'stranger C cannot post a status update to a room they never joined');
  const cMissionStart = await api(cToken, 'POST', `/api/lounge/rooms/${code}/mission/start`, { targetPomodoros: 1 });
  assert(cMissionStart.status === 404, 'stranger C cannot start a mission in a room they never joined');

  console.log('4. mission: host-only start/cancel, real member can check in, solo cannot start');
  await api(bToken, 'POST', `/api/lounge/rooms/${code}/leave`); // empty the room, rejoin fresh with both
  const create2 = await api(bToken, 'POST', '/api/lounge/rooms', { goal: '' });
  const code2 = create2.json.room.code;
  await api(aToken, 'POST', `/api/lounge/rooms/${code2}/join`);
  const nonHostStart = await api(aToken, 'POST', `/api/lounge/rooms/${code2}/mission/start`, { targetPomodoros: 1 });
  assert(nonHostStart.status === 403, 'non-host A cannot start a sprint in B\'s room');
  const hostStart = await api(bToken, 'POST', `/api/lounge/rooms/${code2}/mission/start`, { targetPomodoros: 2 });
  assert(hostStart.status === 200, 'host B starts a 2-pomodoro sprint (target is per-member: each needs 2 checkins)');
  const aCheckin1 = await api(aToken, 'POST', `/api/lounge/rooms/${code2}/mission/checkin`);
  assert(aCheckin1.status === 200, 'A checks in once (1/2)');
  const nonHostCancel = await api(aToken, 'POST', `/api/lounge/rooms/${code2}/mission/cancel`);
  assert(nonHostCancel.status === 403, 'non-host A cannot cancel the sprint');

  const aSock2 = await connectSocket(aToken);
  const bSock2 = await connectSocket(bToken);
  const aCheckin2 = await api(aToken, 'POST', `/api/lounge/rooms/${code2}/mission/checkin`); // A: 2/2 -> checked-in
  const bCheckin1 = await api(bToken, 'POST', `/api/lounge/rooms/${code2}/mission/checkin`); // B: 1/2
  const bCheckin2 = await api(bToken, 'POST', `/api/lounge/rooms/${code2}/mission/checkin`); // B: 2/2 -> checked-in, completes it
  assert(aCheckin2.status === 200 && bCheckin1.status === 200 && bCheckin2.status === 200, 'both members reach their per-member target');
  const completeMsg = await waitFor(aSock2.events, (e) => e.type === 'lounge-mission-complete');
  assert(!!completeMsg, 'a lounge-mission-complete event fires once everyone has checked in');
  const roomAfter = await api(aToken, 'GET', `/api/lounge/rooms/${code2}`);
  assert(roomAfter.json.room.mission === null, 'the mission resets to null after completion');

  console.log('5. room invites: friends-only, real-time push, accept joins, decline does not');
  const inviteToStranger = await api(bToken, 'POST', '/api/lounge/invites', { toUserId: cId });
  assert(inviteToStranger.status === 403, 'B cannot invite stranger C (not friends) to the room');
  const invite = await api(bToken, 'POST', '/api/lounge/invites', { toUserId: aId });
  assert(invite.status === 201, 'B invites friend A (A is already in the room, but the call itself is valid)');

  await api(aToken, 'POST', `/api/lounge/rooms/${code2}/leave`);
  const invite2 = await api(bToken, 'POST', '/api/lounge/invites', { toUserId: aId });
  const pushedInvite = await waitFor(aSock2.events, (e) => e.type === 'lounge-invite' && e.invite.id === invite2.json.invite.id);
  assert(!!pushedInvite, "A's socket receives the room invite live");
  const aInvitesList = await api(aToken, 'GET', '/api/lounge/invites');
  assert(aInvitesList.json.invites.some((i) => i.id === invite2.json.invite.id), 'A also sees it via the REST fallback list');

  const cDeclineOthers = await api(cToken, 'POST', `/api/lounge/invites/${invite2.json.invite.id}/decline`);
  assert(cDeclineOthers.status === 404, "stranger C cannot decline an invite that isn't theirs");
  const accept = await api(aToken, 'POST', `/api/lounge/invites/${invite2.json.invite.id}/accept`);
  assert(accept.status === 200 && accept.json.room.members.some((m) => m.id === aId), 'A accepts and is now a member');

  console.log('6. leaderboard: friends-only scoping, range filtering, minute validation');
  const badMinutes = await api(aToken, 'POST', '/api/stats/sessions', { minutes: 999 });
  assert(badMinutes.status === 400, 'an absurd session length (999 min) is rejected');
  await api(aToken, 'POST', '/api/stats/sessions', { minutes: 25 });
  await api(bToken, 'POST', '/api/stats/sessions', { minutes: 50 });
  await api(cToken, 'POST', '/api/stats/sessions', { minutes: 1000000 % 180 || 30 }); // C is a stranger to A; irrelevant here anyway

  const aBoard = await api(aToken, 'GET', '/api/leaderboard?range=alltime');
  const ids = aBoard.json.entries.map((e) => e.user.id);
  assert(ids.includes(aId) && ids.includes(bId), "A's leaderboard includes both A and friend B");
  assert(!ids.includes(cId), "A's leaderboard never includes stranger C, even though C also logged a session");
  const bEntry = aBoard.json.entries.find((e) => e.user.id === bId);
  assert(bEntry.totalMinutes >= 50, "B's total reflects the logged session");

  const dailyBoard = await api(aToken, 'GET', '/api/leaderboard?range=daily');
  assert(dailyBoard.status === 200 && dailyBoard.json.range === 'daily', 'daily range is accepted and echoed');
  const bogusRange = await api(aToken, 'GET', '/api/leaderboard?range=bogus');
  assert(bogusRange.json.range === 'weekly', 'an unrecognized range falls back to weekly rather than erroring');

  aSock.ws.close(); bSock.ws.close(); aSock2.ws.close(); bSock2.ws.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('CRASHED:', err); process.exit(1); });
