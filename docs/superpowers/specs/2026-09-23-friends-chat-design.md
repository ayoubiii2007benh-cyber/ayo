# Friends Drawer & Direct Chat — Design Spec

**Status:** Autonomous execution authorized by user ("do all the work dont ask me"). Second of the three remaining sub-projects (Friends/Chat → Profile+Avatar → Auth last, per the decomposition agreed earlier). Applies to `index.html`, additive to everything built in the two merged Lounge sessions before it.

**Scope decisions made autonomously (documented here since there was no interactive design pass):**
- "Dedicated Friends panel/drawer" is built as a **new, globally-accessible** slide-in drawer (opened from a header icon, usable from any view), separate from the existing Lounge-embedded friends lists (Lobby's and the active-room Left panel's). Those two stay exactly as they are — this is additive, not a replacement, since they already work and serve a narrower in-Lounge purpose (quick invite while managing a room) while the drawer is the general social hub.
- The 4-state presence scheme the request specifies (🟢 Online, ☕ Resting, 🔴 Focusing, ⚪ Offline) is **new and specific to the drawer** — it does not replace `Lounge.statusLabel()`, which room members still use unchanged (Focusing/Resting/Idle, no "Offline" concept, since being a room member implies presence).
- "Offline" is a new simulated dimension: friends gain an `online` boolean that occasionally flips (~1% chance per engine tick, so a friend is offline for a while every few minutes on average), independent of their existing focus/rest simulation. A friend's pomodoro-phase simulation only advances while `online`.
- Chat is simulated: sending a message to a friend gets a canned auto-reply after a short randomized delay. This is honest-by-construction (no claim of real messaging) and consistent with the whole feature's "Demo Mode" framing.
- "Simulated/live notifications when receiving a lounge invitation" is built as an at-most-one-at-a-time toast (bottom-right), generated at low random probability while the user isn't already in a room. Accepting it calls the existing `Lounge.joinRoom()` with a fresh code — there's no real "friend's room" to join since friends aren't real, so accepting simulates joining *a* room, which is the most honest approximation possible without a backend.

## 1. Data model

```js
// friend object — extended in memory only; Storage.saveLoungeFriends already
// whitelists {id,name,avatar} so `online` is naturally excluded from persistence,
// exactly like the existing simulation fields.
{ id, name, avatar, status, remainingMs, studyMinutesToday, restMinutesToday,
  pomodorosToday, simXP,   // existing
  online: true }            // NEW, simulated, never persisted

// NEW localStorage key "loungeChats": { [friendId]: [{ id, from: 'me'|'friend', text, ts }] }
// Capped at 200 messages per friend (safety valve, same pattern as the activity log).

// state.lounge gains (all in-memory, none persisted):
{
  chats: {},              // loaded from Storage.loadLoungeChats() at boot
  activeChatFriendId: null,
  pendingInvite: null,    // { friendId, friendName, code } | null
}
```

`Lounge._simFields()` gains `online: true` in its returned object, so both `addFriend` and `Lounge.init()`'s hydration of stored friends pick it up automatically (no separate change needed at either call site).

## 2. Presence simulation

In `Lounge._tick()`'s existing friends loop, gate the existing `_tickBot(f, null)` call on `online`, and add an independent, low-probability presence flip:

```js
for (const f of state.lounge.friends) {
  if (Math.random() < 0.01) f.online = !f.online;
  if (f.online) Lounge._tickBot(f, null);
}
```

A new label function, kept separate from `statusLabel` since it serves a different UI (see §0):

```js
friendPresenceLabel(f) {
  if (!f.online) return '⚪ Offline';
  if (f.status === 'focusing') return `🔴 Focusing (${Timer.formatTime(f.remainingMs)})`;
  if (f.status === 'resting') return '☕ Resting';
  return '🟢 Online';
}
```

## 3. Chat

```js
REPLY_BANK: [
  'Sounds good! 💪', "Let's do it!", "I'm mid-focus right now, talk soon!",
  '😄 Nice, good luck with your sprint!', 'On it!', 'Haha same here.',
  "Let's start a co-op sprint later?", '👍', 'Just finished a pomodoro, feeling great!',
],

sendMessage(friendId, text) {
  const trimmed = (text || '').trim().slice(0, 500);
  if (!trimmed) return false;
  if (!state.lounge.chats[friendId]) state.lounge.chats[friendId] = [];
  const thread = state.lounge.chats[friendId];
  thread.push({ id: makeId(), from: 'me', text: trimmed, ts: Date.now() });
  if (thread.length > 200) thread.splice(0, thread.length - 200);
  Storage.saveLoungeChats(state.lounge.chats);
  if (typeof UI !== 'undefined') UI.renderChatThread(friendId);
  const friend = state.lounge.friends.find((f) => f.id === friendId);
  if (friend) {
    setTimeout(() => {
      thread.push({ id: makeId(), from: 'friend', text: Lounge.REPLY_BANK[Math.floor(Math.random() * Lounge.REPLY_BANK.length)], ts: Date.now() });
      if (thread.length > 200) thread.splice(0, thread.length - 200);
      Storage.saveLoungeChats(state.lounge.chats);
      if (state.lounge.activeChatFriendId === friendId && typeof UI !== 'undefined') UI.renderChatThread(friendId);
    }, 800 + Math.random() * 1200);
  }
  return true;
},
```

Storage:

```js
loadLoungeChats() {
  const raw = safeParse('loungeChats') || {};
  const out = {};
  for (const [friendId, arr] of Object.entries(raw)) {
    if (!Array.isArray(arr)) continue;
    out[friendId] = arr
      .filter((m) => m && typeof m.text === 'string' && (m.from === 'me' || m.from === 'friend'))
      .map((m) => ({
        id: typeof m.id === 'string' ? m.id : makeId(),
        from: m.from,
        text: m.text.slice(0, 500),
        ts: typeof m.ts === 'number' ? m.ts : Date.now(),
      }))
      .slice(-200);
  }
  return out;
},
saveLoungeChats(chats) { safeSet('loungeChats', chats); },
```

The chat dialog (`#chat-dialog`, a native `<dialog>` matching the existing `#settings` pattern exactly — `showModal()`/`close()`, `::backdrop`) shows one friend's thread at a time; `UI.openChat(friendId)` sets `state.lounge.activeChatFriendId`, renders the thread, and calls `.showModal()`. Messages render via `textContent` only (never `innerHTML`), matching the codebase-wide rule.

## 4. Simulated incoming invites

```js
_maybeSimulateInvite() {
  if (state.lounge.room || state.lounge.pendingInvite || state.lounge.friends.length === 0) return;
  if (Math.random() < 0.003) {
    const friend = state.lounge.friends[Math.floor(Math.random() * state.lounge.friends.length)];
    state.lounge.pendingInvite = { friendId: friend.id, friendName: friend.name, code: Lounge.generateRoomCode() };
    if (typeof UI !== 'undefined') UI.renderInviteToast();
  }
},
acceptInvite() {
  const pending = state.lounge.pendingInvite;
  if (!pending) return;
  state.lounge.pendingInvite = null;
  Lounge.joinRoom(pending.code);
  UI.renderInviteToast();
  UI.selectView('lounge');
},
dismissInvite() {
  state.lounge.pendingInvite = null;
  UI.renderInviteToast();
},
```

`_maybeSimulateInvite()` is called once per tick from `Lounge._tick()` (alongside the existing member/friend loops). At ~0.3%/tick with the engine running once a friend exists, this fires roughly once every 5-6 minutes on average while idle outside a room — rare enough to feel like a genuine event, not spam.

## 5. UI

**Header:** one new icon button, `#friends-drawer-toggle` (👥), inserted into `.header-right` before `#settings-btn`, matching the existing `.icon-btn` styling exactly.

**Drawer** (`#friends-drawer`, plus `#friends-drawer-backdrop`): fixed-position slide-in panel from the right, `width: min(360px, 100vw)`, `height: 100vh`, `var(--surface)` background (not `.glass`, since it sits above a backdrop rather than over app content — matches the settings dialog's solid-surface precedent, not the page's translucent cards). Contains the friends list (avatar, name, `friendPresenceLabel`, an "Invite to Lounge" button reusing `Lounge.inviteFriendToRoom` and disabled under the same `!state.lounge.room` rule as the existing lists, and a "Chat" button calling `UI.openChat(friendId)`), plus its own Add Friend form (reusing `Lounge.addFriend`, populated from the same `Lounge.PROFILE_EMOJI` list as the other two).

**Toast** (`#invite-toast`): fixed bottom-right card, `hidden` unless `state.lounge.pendingInvite` is set, showing `"<name> invited you to their study room!"` with Accept/Dismiss buttons.

All three new friend-row renderers (Lobby, Left panel, Drawer) end up sharing the same underlying friend data and the same keyed-diff-render technique already used for the first two (`li[data-friend-id]`, update in place, never a blind `replaceChildren()` on every tick) — the drawer's list gets the identical treatment for the identical reason (avoid the click-drop bug class already fixed twice in this feature).

## 6. Non-goals

- No read receipts, typing indicators, or message editing/deletion.
- No way to remove a friend from the UI (the `removeFriend` function already exists from the original build but was never wired to a button; still not wired here — out of scope, not asked for).
- The toast handles exactly one pending invite at a time; a second simulated invite while one is already showing is simply skipped that tick (checked via `state.lounge.pendingInvite` in the guard), not queued.

## 7. Regression guarantees

- Existing Lounge lobby/active-room friends lists, the bot engine, mission logic, and progress rings are untouched — this sub-project only adds new call sites inside `_tick()` (the presence flip and `_maybeSimulateInvite()`) and net-new UI.
- No existing `Storage.*` key changes; `loungeChats` is a new, independent key.
- `Lounge.saveLoungeFriends`'s existing whitelist (`{id,name,avatar}`) needs no change — `online` is already excluded by construction.

## 8. Testing plan (manual — Playwright, per this repo's established convention)

1. Open the drawer from the header icon on every existing view (Dashboard, Reports, Leaderboard, Lounge) — confirm it opens/closes correctly everywhere, and closing via backdrop click or the close button both work.
2. Add a friend via the drawer's own form — confirm it appears in all three friend surfaces (drawer, Lobby, and — once in a room — the Left panel) since they all read the same `state.lounge.friends`.
3. Watch a friend's presence label over ~2 minutes of real time — confirm it eventually shows "⚪ Offline" at least once (or accept the randomness and verify by forcing `online=false` directly for a deterministic check), and confirm an offline friend's `remainingMs` does not change while offline.
4. Open a chat with a friend, send a message, confirm it appears immediately as "me", and confirm a canned reply appears after ~1-2 seconds tagged as "friend" — confirm the thread persists across a reload.
5. Force `Lounge._maybeSimulateInvite()`'s condition (or call it directly bypassing the random check) to confirm the toast appears with the correct friend name, Accept correctly joins a room and switches to the Lounge view, and Dismiss clears it without joining.
6. Full regression: confirm nothing in Timer/Missions/Settings/dark-mode/existing Lounge functionality changed, and confirm no horizontal overflow at 1440/768/375px with the drawer open.
