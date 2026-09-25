# Real Auth, Friends & Presence Migration — Design Spec

**Status:** First of an ordered set of sub-projects turning this app from a local
prototype into a real online app (agreed with the user 2026-09-25):
1. **Real auth, friends & presence migration (this spec)**
2. Real multiplayer Study Lounge
3. Real XP + study-stats backend
4. Real friend leaderboard
5. Local data migration into a new account
6. Security hardening pass
7. Deploy to Render + custom domain

Applies to `index.html` (frontend) and `server/` (backend, already exists,
untracked in git as of this spec).

## 0. Framing decision

`server/` already implements a real backend — Express + WebSocket + Node's
built-in SQLite, bcrypt password hashing, JWT sessions: register/login/me,
username search, friend requests/friendships, DM conversations/messages,
notifications, and real WebSocket presence (online count, per-friend presence,
heartbeat-based disconnect detection). The frontend already has matching
`Api`/`Auth`/`Socket` objects and a fully-styled, unwired UI shell (auth modal
with Login/Sign Up/Guest tabs, a notification bell with badge/menu, a friends
drawer with search/requests/list sections, a chat dialog).

**None of it is turned on.** `Auth.init()` is never called from boot.
`UI.syncAuthUI()` is referenced (by `Auth._onAuthenticated`/`logout`) but never
defined — calling it throws. No auth-modal button has an event listener. The
app currently runs entirely on:

- Leftover **vestigial** scaffolding from an earlier device-only multi-account
  switcher: a module-level `activeAccountId` and a `storageKey()` indirection
  that prefixes every localStorage key with it. The switcher's actual API
  (sign up/log in/account list, the `pomodoroAccounts` registry) has already
  been removed from the code — nothing ever writes a real account id into
  `pomodoroActiveAccount` any more, so `activeAccountId` is always `null` in
  practice today and `storageKey()` is a permanent no-op. It's dead
  complexity, not a live competing system. `#profile-modal-switch-account-btn`
  is likewise inert — it exists in the HTML with no event listener at all.
- A fully simulated friends/presence/chat/online-counter system living in
  `Lounge` (`state.lounge.friends`, bot-driven presence flips, canned
  auto-reply chat, random invite toasts) and `LiveUsers` (random online-count
  ticker), both explicitly documented as demo/simulated. This one is very
  much live — it's what a user sees today.

**Decision:** activate and finish the already-designed real system; delete
the vestigial namespacing scaffolding and the simulated Lounge/LiveUsers
system outright (no feature flag, no dual-run — there are no live users on
this uncommitted branch to protect, so a gradual cutover has nothing to
protect and only adds complexity). This is described section by section
below.

Out of scope for this sub-project (deferred to later ones in the list above):
making Study Lounge *rooms* real, XP, leaderboard, local-data migration,
deployment. Lounge's bot roster that fills a *room* (`DEMO_BOT_POOL`, distinct
from the friends list being removed here) is untouched — it's unrelated to
friends and will be replaced when rooms become real in sub-project 2.

## 1. Boot & session wiring

`UI.init()` gains a call to `Auth.init()` (which itself calls `Socket.connect()`
and, if a token exists, `GET /api/auth/me` to restore the session or clear an
expired token).

Auth-modal visibility at boot:

```js
// "never chosen" = no token AND no explicit guest choice yet -> show the modal.
// Reuses the pomodoroGuestChoice flag Auth.continueAsGuest() already sets;
// no new storage key needed.
if (!Api.token && !safeParseGlobal('pomodoroGuestChoice')) {
  document.getElementById('auth-modal').showModal();
}
```

Dismissing the modal (Escape/backdrop) without a choice is treated as
"Continue as Guest" (same behavior as the old spec) so a first-time visitor is
never blocked.

`UI.syncAuthUI()` (new):

```js
syncAuthUI() {
  const loggedIn = Auth.isLoggedIn();
  document.getElementById('notif-picker').hidden = !loggedIn;
  document.getElementById('user-name-display').textContent =
    loggedIn ? Auth.currentUser.displayName : state.profile.username;
  UI.renderFriendsDrawer(); // shows real content or a "Log in to add friends" placeholder
  if (loggedIn) { Friends.refreshAll(); Notifications.refreshAll(); }
},
```

Auth-modal wiring: tab buttons toggle `#auth-panel-login`/`#auth-panel-signup`
(`aria-selected`/`hidden`, matching the existing settings-tabs pattern already
used elsewhere in the file). Submit buttons call `Auth.login`/`Auth.register`,
catch rejected promises, and show the error in `#status-auth-login` /
`#status-auth-signup` (both elements already exist). On success, close the
dialog. `#auth-guest-btn` calls `Auth.continueAsGuest()` and closes the dialog.

## 2. Removing the vestigial account-namespacing scaffolding

Delete `activeAccountId`, `storageKey()`, and the `pomodoroActiveAccount`
read at boot. Since `storageKey()` is already a permanent no-op in practice
(nothing sets a real account id any more), this is a pure deletion with no
data migration: `safeParse`/`safeSet` go back to using their literal key
directly, byte-identical to what every key already resolves to today.

`#profile-modal-switch-account-btn` is relabeled **"Log Out"** and wired to:

```js
document.getElementById('profile-modal-switch-account-btn').addEventListener('click', () => {
  document.getElementById('profile-modal').close();
  Auth.logout(); // already sets token=null, clears currentUser, reconnects Socket anonymously
  UI.syncAuthUI();
  document.getElementById('auth-modal').showModal();
});
```

It's hidden entirely for guests (nothing to log out of); guests instead get a
**"Log In / Sign Up"** button in its place that just reopens `#auth-modal`.

## 3. Friends module

New top-level object, mirroring the existing `Api`/`Auth` style:

```js
const Friends = {
  list: [], incoming: [], outgoing: [],
  async refreshAll() {
    const [{ friends }, { incoming, outgoing }] = await Promise.all([
      Api.get('/api/friends'), Api.get('/api/friends/requests'),
    ]);
    Friends.list = friends; Friends.incoming = incoming; Friends.outgoing = outgoing;
    UI.renderFriendsDrawer();
  },
  async search(query) {
    const { users } = await Api.get(`/api/users/search?q=${encodeURIComponent(query)}`);
    return users;
  },
  sendRequest(userId) { return Api.post('/api/friends/requests', { toUserId: userId }); },
  accept(requestId) { return Api.post(`/api/friends/requests/${requestId}/accept`); },
  reject(requestId) { return Api.post(`/api/friends/requests/${requestId}/reject`); },
  cancel(requestId) { return Api.del(`/api/friends/requests/${requestId}`); },
  remove(friendId) { return Api.del(`/api/friends/${friendId}`); },
};

Socket.on('friend-request', () => Friends.refreshAll());
Socket.on('friend-accept', () => Friends.refreshAll());
Socket.on('presence', ({ userId, online, lastSeenAt }) => {
  const f = Friends.list.find((x) => x.id === userId);
  if (f) { f.online = online; f.lastSeenAt = lastSeenAt; UI.renderFriendsDrawer(); }
});
```

`refreshAll()` re-fetching on every friend/request event (rather than patching
from the event payload alone) keeps the three lists — friends, incoming,
outgoing — trivially consistent with each other after any transition (a
request becoming a friendship, etc.), at the cost of one extra round trip per
event; acceptable given how infrequent these events are.

Rendering into the **already-existing** `#friend-search-results`,
`#friend-requests-incoming`/`#friend-requests-outgoing`, `#friends-drawer-list`
uses keyed diffing (`li[data-friend-id]`, update text/classes in place rather
than `replaceChildren()`), matching the convention already established for the
Lounge friend lists and documented as necessary to avoid a known "click-drop
while re-rendering" bug class.

`#friend-search-form` submit calls `Friends.search`, renders results with a
context-appropriate action button per row based on the relationship the
backend already returns (`none` → "Add", `pending_out` → "Cancel",
`pending_in` → "Accept", `friends` → "Friends" (disabled)).

## 4. Real presence

Delete the `LiveUsers` module (random-tick simulated counter). Replace with:

```js
Socket.on('online-count', ({ count }) => {
  document.getElementById('live-users-count').textContent = String(count);
});
```

`#live-users` already renders unauthenticated (the backend's online-count is
public), so this works identically for guests and logged-in users — guests
just don't get a friends list or per-friend dots, matching "presence/social
features require signing in" from the app's own auth-modal copy.

## 5. Notifications

New `Notifications` object:

```js
const Notifications = {
  items: [], unreadCount: 0,
  async refreshAll() {
    const { notifications, unreadCount } = await Api.get('/api/notifications');
    Notifications.items = notifications; Notifications.unreadCount = unreadCount;
    UI.renderNotifications();
  },
  markRead(id) { return Api.post(`/api/notifications/${id}/read`); },
  markAllRead() { return Api.post('/api/notifications/read-all'); },
};
Socket.on('notification', ({ notification }) => {
  Notifications.items.unshift(notification);
  Notifications.unreadCount++;
  UI.renderNotifications();
});
```

`UI.renderNotifications()` fills `#notif-list` (one `<li class="notif-item">`
per notification, `data-unread` attribute driving the existing dot CSS),
toggles `#notif-badge`/`#notif-empty`, and formats each notification's `type`
(`friend_request`/`friend_accept`/`message`) into copy via its `data` payload
(already shaped for this by the backend, e.g. `{ from: publicUser }`).
`#notif-trigger` toggles `#notif-menu` open/closed (existing dropdown pattern);
`#notif-mark-all-read` calls `Notifications.markAllRead()` then re-renders.

## 6. Real DM chat

`UI.openChat(friendId)` now fetches history instead of reading
`state.lounge.chats`:

```js
async openChat(friendId) {
  state.activeChatFriendId = friendId; // was state.lounge.activeChatFriendId
  const friend = Friends.list.find((f) => f.id === friendId);
  document.getElementById('chat-dialog-title').textContent = friend ? `Chat with ${friend.displayName}` : 'Chat';
  document.getElementById('chat-dialog').showModal();
  const { messages } = await Api.get(`/api/conversations/${friendId}/messages`);
  UI.renderChatThread(friendId, messages);
  Api.post(`/api/conversations/${friendId}/read`);
},
```

Send button posts `Api.post('/api/conversations/:friendId/messages', { text })`
and appends the returned message optimistically; `Socket.on('message', ...)`
appends to the thread live if it's the currently-open conversation (and marks
read immediately in that case), otherwise just bumps that friend's unread
affordance next time the drawer/notifications render.

Deletes `state.lounge.chats`, `Storage.loadLoungeChats/saveLoungeChats`,
`Lounge.sendMessage`, `Lounge.REPLY_BANK`.

## 7. What else gets deleted

- `state.lounge.friends` and its whole lifecycle: `Lounge.addFriend`,
  `removeFriend` (never wired to a button, per the old spec — clean removal),
  the friend-presence-flip and friend-bot-tick loop inside `Lounge._tick()`.
- `Lounge._maybeSimulateInvite()`, `state.lounge.pendingInvite`,
  `#invite-toast` and its accept/dismiss wiring.
- `Lounge.inviteFriendToRoom` and the "Invite to Lounge" button in the friends
  drawer/lobby/active-room lists — inviting a real friend into a still-fake
  room would misrepresent what's happening; this returns properly in
  sub-project 2 when rooms become real.

Lounge's bot-filled rooms (`DEMO_BOT_POOL`, sprints, missions, activity log)
are untouched by this sub-project.

## 8. Non-goals (this sub-project)

- No password reset flow (no email delivery exists yet).
- No account deletion UI.
- No migration of existing local guest stats/XP into a new account (that's
  sub-project 5).
- No changes to Study Lounge room mechanics.
- No rate-limiting changes beyond what `server/server.js` already has on the
  auth endpoints (covered later in the security-hardening sub-project).

## 9. Regression guarantees

- Guests keep full local timer/tasks/stats with byte-identical storage keys
  to today (removing the namespacing indirection is a no-op for guest data).
- Existing Lounge room mechanics (bots, sprints, missions, activity log,
  progress rings) are untouched other than removing the friend-invite
  affordance noted above.
- No existing `Storage.*` function signature changes except deleting the
  lounge-chat ones.

## 10. Testing plan

1. Extend `server/test/e2e.js`'s two-user (Alice/Bob) pattern to also cover:
   notification delivery + mark-read/mark-all-read, and DM send/receive over
   both HTTP and the `message` WebSocket push.
2. Manual Playwright pass, two separate browser profiles (Alice, Bob):
   - Fresh boot with no prior choice shows the auth modal; Continue as Guest
     dismisses it and the guest's existing local data is unchanged.
   - Sign up as Alice and Bob; search for each other by username; send/accept
     a friend request; confirm both see each other in the friends list and
     the header online-count reflects both being connected.
   - Close Bob's tab; confirm Alice's online-count decrements and Bob's dot
     goes offline within one heartbeat interval (~30s).
   - Send a DM from Alice to Bob; confirm it appears live in Bob's open chat
     dialog, and as a badge/notification if Bob's chat isn't open.
   - Log out and back in as Alice on a fresh profile; confirm friends/messages
     persisted server-side (cross-device proof).
   - Full regression: Timer/Tasks/Settings/dark-mode/Lounge room creation and
     bot sprints all still work; no console errors; no horizontal overflow at
     375/1280px with the auth modal, friends drawer, or notification menu
     open.
