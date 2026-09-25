'use strict';
/* Simulates two independent real users (Alice and Bob) talking to the running
   server over plain HTTP + WebSocket -- the same protocol a real browser tab
   uses. Run with the server already started (see server/README.md):
     node test/e2e.js
   Exits non-zero and prints which assertion failed if anything is wrong. */

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
function waitFor(events, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for event: ' + JSON.stringify(events)));
      setTimeout(check, 50);
    };
    check();
  });
}

async function main() {
  const suffix = Date.now().toString(36);
  const aliceName = `alice_${suffix}`;
  const bobName = `bob_${suffix}`;

  console.log('1. register two accounts');
  const aliceReg = await api(null, 'POST', '/api/auth/register', { username: aliceName, password: 'hunter22', displayName: 'Alice' });
  assert(aliceReg.status === 201, 'Alice registers');
  const bobReg = await api(null, 'POST', '/api/auth/register', { username: bobName, password: 'hunter22', displayName: 'Bob' });
  assert(bobReg.status === 201, 'Bob registers');
  const aliceToken = aliceReg.json.token, bobToken = bobReg.json.token;
  const aliceId = aliceReg.json.user.id, bobId = bobReg.json.user.id;

  const dupe = await api(null, 'POST', '/api/auth/register', { username: aliceName, password: 'whatever1' });
  assert(dupe.status === 409, 'duplicate username rejected');

  console.log('2. login with password');
  const login = await api(null, 'POST', '/api/auth/login', { identifier: aliceName, password: 'hunter22' });
  assert(login.status === 200 && login.json.token, 'Alice logs in');
  const badLogin = await api(null, 'POST', '/api/auth/login', { identifier: aliceName, password: 'wrongpass' });
  assert(badLogin.status === 401, 'wrong password rejected');

  console.log('3. unauthenticated request rejected');
  const noAuth = await api(null, 'GET', '/api/friends');
  assert(noAuth.status === 401, 'friends list requires auth');

  console.log('4. connect both to the realtime websocket');
  const alice = await connectSocket(aliceToken);
  const bob = await connectSocket(bobToken);
  const countMsg = await waitFor(alice.events, (e) => e.type === 'online-count' && e.count >= 2);
  assert(countMsg.count >= 2, `online count reflects both connections (got ${countMsg.count})`);

  console.log('5. Alice searches for Bob');
  const search = await api(aliceToken, 'GET', `/api/users/search?q=${bobName}`);
  assert(search.status === 200 && search.json.users.some((u) => u.id === bobId), 'Alice finds Bob by search');

  console.log('6. Alice sends Bob a friend request, Bob receives it in real time');
  const reqRes = await api(aliceToken, 'POST', '/api/friends/requests', { toUserId: bobId });
  assert(reqRes.status === 201, 'friend request created');
  const pushedReq = await waitFor(bob.events, (e) => e.type === 'friend-request');
  assert(pushedReq.request.user.id === aliceId, 'Bob got a live push naming Alice as the requester');

  const dupeReq = await api(aliceToken, 'POST', '/api/friends/requests', { toUserId: bobId });
  assert(dupeReq.status === 409, 'duplicate pending request rejected');

  console.log('7. Bob sees it via REST too, then accepts');
  const bobReqs = await api(bobToken, 'GET', '/api/friends/requests');
  assert(bobReqs.json.incoming.length === 1 && bobReqs.json.incoming[0].user.id === aliceId, 'Bob sees incoming request via REST');
  const restRequestId = bobReqs.json.incoming[0].id;
  // Regression guard for the column-collision bug this branch fixed: the REST
  // response's request id must be its own id, not silently overwritten by the
  // joined user's id (which is what `SELECT r.id, ..., u.*` used to produce).
  assert(restRequestId !== aliceId, 'REST request id is not the requester\'s user id (column-collision regression)');
  assert(restRequestId === pushedReq.request.id, 'REST and WebSocket-pushed request ids agree');
  const acceptRes = await api(bobToken, 'POST', `/api/friends/requests/${restRequestId}/accept`);
  assert(acceptRes.status === 200, 'Bob accepts the request using the REST-sourced id');
  const pushedAccept = await waitFor(alice.events, (e) => e.type === 'friend-accept');
  assert(pushedAccept.friend.id === bobId, 'Alice got a live push that Bob accepted');

  console.log('8. both now list each other as friends, with live presence');
  const aliceFriends = await api(aliceToken, 'GET', '/api/friends');
  const bobFriends = await api(bobToken, 'GET', '/api/friends');
  assert(aliceFriends.json.friends.some((f) => f.id === bobId && f.online === true), 'Alice sees Bob as a friend, online');
  assert(bobFriends.json.friends.some((f) => f.id === aliceId && f.online === true), 'Bob sees Alice as a friend, online');

  console.log('9. Alice sends Bob a real-time message');
  const sendRes = await api(aliceToken, 'POST', `/api/conversations/${bobId}/messages`, { text: 'Hey!' });
  assert(sendRes.status === 201, 'message sent');
  const pushedMsg = await waitFor(bob.events, (e) => e.type === 'message' && e.message.text === 'Hey!');
  assert(pushedMsg.message.senderId === aliceId, 'Bob received the message live, correct sender');
  const msgNotif = await waitFor(bob.events, (e) => e.type === 'notification' && e.notification.type === 'message');
  assert(msgNotif.notification.data.preview === 'Hey!', 'Bob got a message notification pushed live');

  console.log('10. message persists and is fetchable as history');
  const history = await api(bobToken, 'GET', `/api/conversations/${aliceId}/messages`);
  assert(history.json.messages.length === 1 && history.json.messages[0].text === 'Hey!', 'message shows up in history');

  console.log('11. notification mark-read and mark-all-read');
  const secondMsg = await api(aliceToken, 'POST', `/api/conversations/${bobId}/messages`, { text: 'ping again' });
  assert(secondMsg.status === 201, 'second message sent');
  await waitFor(bob.events, (e) => e.type === 'notification' && e.notification.data.preview === 'ping again');
  const notifsBeforeRead = await api(bobToken, 'GET', '/api/notifications');
  assert(notifsBeforeRead.json.unreadCount >= 2, `Bob has at least 2 unread notifications (got ${notifsBeforeRead.json.unreadCount})`);
  const firstUnread = notifsBeforeRead.json.notifications.find((n) => !n.readAt);
  const readRes = await api(bobToken, 'POST', `/api/notifications/${firstUnread.id}/read`);
  assert(readRes.status === 200, 'marking a single notification read succeeds');
  const notifsAfterOne = await api(bobToken, 'GET', '/api/notifications');
  assert(notifsAfterOne.json.unreadCount === notifsBeforeRead.json.unreadCount - 1, 'unread count decrements after marking one read');
  const markAllRes = await api(bobToken, 'POST', '/api/notifications/read-all');
  assert(markAllRes.status === 200, 'mark-all-read succeeds');
  const notifsFinal = await api(bobToken, 'GET', '/api/notifications');
  assert(notifsFinal.json.unreadCount === 0, 'unread count is zero after mark-all-read');

  console.log('12. strangers cannot message each other');
  const carolReg = await api(null, 'POST', '/api/auth/register', { username: `carol_${suffix}`, password: 'hunter22' });
  const strangerMsg = await api(carolReg.json.token, 'POST', `/api/conversations/${aliceId}/messages`, { text: 'hi' });
  assert(strangerMsg.status === 403, 'non-friend cannot send a message (server-side authz enforced)');
  const strangerRead = await api(carolReg.json.token, 'GET', `/api/conversations/${aliceId}/messages`);
  assert(strangerRead.status === 403, 'non-friend cannot read a conversation');

  console.log('13. Bob disconnects -- Alice sees him go offline in real time');
  bob.ws.close();
  const offlinePush = await waitFor(alice.events, (e) => e.type === 'presence' && e.userId === bobId && e.online === false);
  assert(offlinePush.online === false, 'Alice got a live presence push when Bob disconnected');
  const countAfter = await api(null, 'GET', '/api/presence/online-count');
  assert(countAfter.json.count === 1, `global online count dropped to 1 after Bob left (got ${countAfter.json.count})`);

  console.log('14. remove friend, then message is rejected again');
  await api(aliceToken, 'DELETE', `/api/friends/${bobId}`);
  const afterRemove = await api(bobToken, 'GET', '/api/friends');
  assert(!afterRemove.json.friends.some((f) => f.id === aliceId), 'friendship removed both directions');
  const blockedAfterRemove = await api(aliceToken, 'POST', `/api/conversations/${bobId}/messages`, { text: 'should fail now' });
  assert(blockedAfterRemove.status === 403, 'messaging a former friend is rejected after removal');

  console.log('15. cancel and reject friend requests');
  const daveReg = await api(null, 'POST', '/api/auth/register', { username: `dave_${suffix}`, password: 'hunter22' });
  const eveReg = await api(null, 'POST', '/api/auth/register', { username: `eve_${suffix}`, password: 'hunter22' });
  const daveToken = daveReg.json.token, daveId = daveReg.json.user.id;
  const eveToken = eveReg.json.token, eveId = eveReg.json.user.id;

  const daveToEve1 = await api(daveToken, 'POST', '/api/friends/requests', { toUserId: eveId });
  const cancelRes = await api(daveToken, 'DELETE', `/api/friends/requests/${daveToEve1.json.requestId}`);
  assert(cancelRes.status === 200, 'Dave cancels his own outgoing request');
  const eveReqsAfterCancel = await api(eveToken, 'GET', '/api/friends/requests');
  assert(eveReqsAfterCancel.json.incoming.length === 0, 'Eve sees no incoming request after Dave cancelled it');

  const daveToEve2 = await api(daveToken, 'POST', '/api/friends/requests', { toUserId: eveId });
  const rejectRes = await api(eveToken, 'POST', `/api/friends/requests/${daveToEve2.json.requestId}/reject`);
  assert(rejectRes.status === 200, 'Eve rejects the second request');
  const daveEveFriends = await api(daveToken, 'GET', '/api/friends');
  assert(!daveEveFriends.json.friends.some((f) => f.id === eveId), 'Dave and Eve are not friends after rejection');
  const cancelSomeoneElses = await api(eveToken, 'DELETE', `/api/friends/requests/${daveToEve1.json.requestId}`);
  assert(cancelSomeoneElses.status === 404, 'Eve cannot cancel a request that was not hers to cancel');

  console.log('16. mutual simultaneous friend requests both resolve to a single friendship');
  const frankReg = await api(null, 'POST', '/api/auth/register', { username: `frank_${suffix}`, password: 'hunter22' });
  const graceReg = await api(null, 'POST', '/api/auth/register', { username: `grace_${suffix}`, password: 'hunter22' });
  const frankToken = frankReg.json.token, frankId = frankReg.json.user.id;
  const graceToken = graceReg.json.token, graceId = graceReg.json.user.id;
  const [frankToGrace, graceToFrank] = await Promise.all([
    api(frankToken, 'POST', '/api/friends/requests', { toUserId: graceId }),
    api(graceToken, 'POST', '/api/friends/requests', { toUserId: frankId }),
  ]);
  assert(
    [frankToGrace.status, graceToFrank.status].every((s) => s === 200 || s === 201),
    `both simultaneous requests succeeded (got ${frankToGrace.status}, ${graceToFrank.status})`
  );
  const frankFriends = await api(frankToken, 'GET', '/api/friends');
  const graceFriends = await api(graceToken, 'GET', '/api/friends');
  assert(frankFriends.json.friends.some((f) => f.id === graceId), 'Frank sees Grace as a friend');
  assert(graceFriends.json.friends.some((f) => f.id === frankId), 'Grace sees Frank as a friend');
  const frankReqsFinal = await api(frankToken, 'GET', '/api/friends/requests');
  const graceReqsFinal = await api(graceToken, 'GET', '/api/friends/requests');
  assert(
    frankReqsFinal.json.incoming.length === 0 && frankReqsFinal.json.outgoing.length === 0,
    'Frank has no stray pending requests'
  );
  assert(
    graceReqsFinal.json.incoming.length === 0 && graceReqsFinal.json.outgoing.length === 0,
    'Grace has no stray pending requests'
  );

  console.log('17. rate limiting on search kicks in after 30 requests/minute');
  let lastSearchStatus = 200;
  for (let i = 0; i < 31; i++) {
    const r = await api(aliceToken, 'GET', '/api/users/search?q=te');
    lastSearchStatus = r.status;
  }
  assert(lastSearchStatus === 429, `31st search in a minute is rate-limited (got ${lastSearchStatus})`);

  console.log('18. logout invalidates the old token everywhere');
  const preLogoutCheck = await api(aliceToken, 'GET', '/api/auth/me');
  assert(preLogoutCheck.status === 200, 'token works before logout');
  const logoutRes = await api(aliceToken, 'POST', '/api/auth/logout');
  assert(logoutRes.status === 200, 'logout succeeds');
  const postLogoutCheck = await api(aliceToken, 'GET', '/api/auth/me');
  assert(postLogoutCheck.status === 401, 'the same token is rejected after logout');

  alice.ws.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('E2E CRASHED:', err); process.exit(1); });
