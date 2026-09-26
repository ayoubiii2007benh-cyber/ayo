'use strict';
/* Adversarial social/authorization checks for two "real" test accounts (A, B)
   plus an uninvolved stranger (C), covering IDOR/forgery/presence-leak paths
   not already exercised by test/e2e.js. Run with the server already started:
     node test/e2e-social-authz.js
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
function waitFor(events, predicate, timeoutMs = 3000) {
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
function didNotReceive(events, predicate, waitMs = 1500) {
  return new Promise((resolve) => setTimeout(() => resolve(!events.some(predicate)), waitMs));
}

async function main() {
  const suffix = Date.now().toString(36);
  const aName = `AccountA_${suffix}`, bName = `AccountB_${suffix}`, cName = `Stranger_${suffix}`;

  console.log('setup: register A, B, and uninvolved stranger C');
  const aReg = await api(null, 'POST', '/api/auth/register', { username: aName, password: 'correcthorse1', displayName: 'Account A' });
  const bReg = await api(null, 'POST', '/api/auth/register', { username: bName, password: 'correcthorse1', displayName: 'Account B' });
  const cReg = await api(null, 'POST', '/api/auth/register', { username: cName, password: 'correcthorse1', displayName: 'Stranger C' });
  assert(aReg.status === 201 && bReg.status === 201 && cReg.status === 201, 'A, B, C all register');
  const aId = aReg.json.user.id, bId = bReg.json.user.id, cId = cReg.json.user.id;

  console.log('1. login functional (fresh token, independent of register token)');
  const aLogin = await api(null, 'POST', '/api/auth/login', { identifier: aName, password: 'correcthorse1' });
  const aToken = aLogin.json.token;
  const bLogin = await api(null, 'POST', '/api/auth/login', { identifier: bName, password: 'correcthorse1' });
  const bToken = bLogin.json.token;
  const cToken = cReg.json.token;
  assert(aLogin.status === 200 && bLogin.status === 200, 'A and B log in with password');

  console.log('2. user search finds each other');
  const search = await api(aToken, 'GET', `/api/users/search?q=${bName}`);
  assert(search.json.users.some((u) => u.id === bId), 'A finds B via search');

  console.log('3. friend request forgery: client-supplied identity/id fields are ignored');
  const forged = await api(aToken, 'POST', '/api/friends/requests', { toUserId: bId, fromUserId: cId, id: 'forged-id' });
  assert(forged.status === 201, 'request created despite extra spoofed fields');
  const bIncoming1 = await api(bToken, 'GET', '/api/friends/requests');
  const req1 = bIncoming1.json.incoming.find((r) => r.user.id === aId);
  assert(!!req1, 'B sees the request as genuinely from A, not the spoofed fromUserId (C)');
  assert(req1.id !== 'forged-id', "server assigned its own request id, ignoring the client-supplied one");

  console.log('4. IDOR: the requester cannot accept their own outgoing request');
  const selfAccept = await api(aToken, 'POST', `/api/friends/requests/${req1.id}/accept`);
  assert(selfAccept.status === 404, 'A (the sender, not the recipient) cannot accept it');

  console.log('5. accept for real, both sides see the friendship');
  const accept = await api(bToken, 'POST', `/api/friends/requests/${req1.id}/accept`);
  assert(accept.status === 200, "B accepts A's request");
  const aFriends1 = await api(aToken, 'GET', '/api/friends');
  const bFriends1 = await api(bToken, 'GET', '/api/friends');
  assert(aFriends1.json.friends.some((f) => f.id === bId), 'A lists B as a friend');
  assert(bFriends1.json.friends.some((f) => f.id === aId), 'B lists A as a friend');

  console.log('6. presence: B (a friend) is notified A is online; stranger C is not identified');
  const bSock = await connectSocket(bToken);
  const cSock = await connectSocket(cToken); // listening BEFORE A connects, so a leak would be observable
  const aSock = await connectSocket(aToken);
  await waitFor(bSock.events, (e) => e.type === 'presence' && e.userId === aId && e.online === true);
  const noLeak = await didNotReceive(cSock.events, (e) => e.type === 'presence' && e.userId === aId);
  assert(noLeak, 'stranger C never receives an identified presence event for A');
  assert(cSock.events.some((e) => e.type === 'online-count'), 'C still gets the anonymous aggregate online-count (not a leak)');

  console.log('7. IDOR: A cannot mark B\'s notifications read');
  await api(aToken, 'POST', `/api/conversations/${bId}/messages`, { text: 'hi B' }); // generates a notification for B
  await waitFor(bSock.events, (e) => e.type === 'notification' && e.notification.type === 'message');
  const bNotifsBefore = await api(bToken, 'GET', '/api/notifications');
  const bNotifId = bNotifsBefore.json.notifications[0].id;
  const crossRead = await api(aToken, 'POST', `/api/notifications/${bNotifId}/read`);
  assert(crossRead.status === 200, "endpoint responds ok (no existence leak either way)");
  const bNotifsAfter = await api(bToken, 'GET', '/api/notifications');
  const stillUnread = bNotifsAfter.json.notifications.find((n) => n.id === bNotifId);
  assert(stillUnread && !stillUnread.readAt, "...but B's notification was NOT actually marked read by A's request");
  await api(aToken, 'POST', '/api/notifications/read-all');
  const bNotifsAfter2 = await api(bToken, 'GET', '/api/notifications');
  assert(bNotifsAfter2.json.unreadCount > 0, "A calling read-all does not touch B's notifications either");

  console.log('8. IDOR: A cannot read or write a conversation between B and C');
  const bcReq = await api(bToken, 'POST', '/api/friends/requests', { toUserId: cId });
  const cIncoming = await api(cToken, 'GET', '/api/friends/requests');
  const bcReqId = cIncoming.json.incoming.find((r) => r.user.id === bId).id;
  await api(cToken, 'POST', `/api/friends/requests/${bcReqId}/accept`);
  await api(bToken, 'POST', `/api/conversations/${cId}/messages`, { text: 'secret between B and C' });
  const aReadBC = await api(aToken, 'GET', `/api/conversations/${cId}/messages`);
  assert(aReadBC.status === 403, 'A (not friends with C) cannot read the B<->C conversation');
  const aWriteBC = await api(aToken, 'POST', `/api/conversations/${cId}/messages`, { text: 'injected by A' });
  assert(aWriteBC.status === 403, 'A cannot write into the B<->C conversation either');

  console.log('9. IDOR: removing a friendship is scoped to the caller, not guessable');
  const aRemoveUnrelated = await api(aToken, 'DELETE', `/api/friends/${cId}`); // A has no edge with C at all
  assert(aRemoveUnrelated.status === 200, "delete is idempotent/no-op safe even for a nonexistent edge");
  const bStillFriendsWithC = await api(bToken, 'GET', '/api/friends');
  assert(bStillFriendsWithC.json.friends.some((f) => f.id === cId), "B's real friendship with C is untouched by A's unrelated call");

  console.log('10. IDOR: only the recipient/sender of a request can act on it');
  const cToA = await api(cToken, 'POST', '/api/friends/requests', { toUserId: aId });
  const cToAId = cToA.json.requestId;
  const bAcceptsOthers = await api(bToken, 'POST', `/api/friends/requests/${cToAId}/accept`);
  assert(bAcceptsOthers.status === 404, 'B (uninvolved) cannot accept a request between A and C');
  const bRejectsOthers = await api(bToken, 'POST', `/api/friends/requests/${cToAId}/reject`);
  assert(bRejectsOthers.status === 404, 'B (uninvolved) cannot reject it either');
  const bCancelsOthers = await api(bToken, 'DELETE', `/api/friends/requests/${cToAId}`);
  assert(bCancelsOthers.status === 404, 'B (uninvolved) cannot cancel it either');
  const aAcceptsReal = await api(aToken, 'POST', `/api/friends/requests/${cToAId}/accept`);
  assert(aAcceptsReal.status === 200, 'A, the real recipient, accepts it normally afterward');

  console.log('11. no admin surface exists for a normal user to reach');
  const adminProbe = await api(aToken, 'GET', '/api/admin/users');
  assert(adminProbe.status === 404, 'no admin route is defined at all (404, not a 401/403 that would confirm it exists)');

  console.log('12. public profile lookup never leaks email or password hash');
  const bProfile = await api(aToken, 'GET', `/api/users/${bId}`);
  assert(bProfile.status === 200 && !('email' in bProfile.json.user) && !('password_hash' in bProfile.json.user), "B's public profile (as seen by A) has no email/password hash");

  console.log('13. remove friend updates both sides');
  await api(aToken, 'DELETE', `/api/friends/${bId}`);
  const bFriendsAfterRemove = await api(bToken, 'GET', '/api/friends');
  assert(!bFriendsAfterRemove.json.friends.some((f) => f.id === aId), "removing from A's side also removes from B's side");

  console.log('14. every tested protected route rejects a direct unauthenticated request');
  const noAuthChecks = await Promise.all([
    api(null, 'GET', '/api/friends'),
    api(null, 'GET', '/api/notifications'),
    api(null, 'GET', `/api/conversations/${bId}/messages`),
    api(null, 'DELETE', `/api/friends/${bId}`),
  ]);
  assert(noAuthChecks.every((r) => r.status === 401), 'unauthenticated direct API calls are rejected identically to what the frontend would enforce');

  aSock.ws.close(); bSock.ws.close(); cSock.ws.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('CRASHED:', err); process.exit(1); });
