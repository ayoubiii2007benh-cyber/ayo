# Real Auth, Friends & Presence Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn on the real backend (`server/`) that already exists but is
currently dead code, and replace the simulated/broken friends, presence,
notifications, and chat systems in `index.html` with real ones backed by it.

**Architecture:** One frontend file (`index.html`, no build step) gains new
top-level JS objects (`Friends`, `Notifications`) alongside the existing
`Api`/`Auth`/`Socket`, wired into HTML that is already built and styled for
this. No backend code changes are needed — `server/server.js` already
implements every endpoint this plan calls. `server/test/e2e.js` gains two
new coverage blocks.

**Tech Stack:** Vanilla JS (frontend, no framework/build), Express + `ws` +
Node's built-in `node:sqlite` + bcryptjs + jsonwebtoken (backend, already
written).

**Spec:** `docs/superpowers/specs/2026-09-25-real-auth-friends-presence-design.md`

## Global Constraints

- No new dependencies, frontend or backend — everything needed already
  exists in `server/package.json` and the browser platform.
- The backend requires `JWT_SECRET` from the environment. `npm start` in
  `server/` does **not** load `.env` (only `npm run dev` does, via
  `--env-file=.env`). Every manual test step in this plan that starts the
  server must use `npm run dev` (or `node --env-file=.env server.js`) from
  `server/`, or it will crash immediately on boot.
- No emoji in new UI copy (error/status text) — match the existing plain
  `field-hint`/`field-status` style used throughout the file.
- Every new top-level object (`Friends`, `Notifications`) follows the
  existing `Api`/`Auth` style: a plain object literal with async methods
  that throw on failure (the caller catches and displays the error), not
  objects that swallow errors internally.
- Friend-list rendering keeps the established keyed-diff pattern
  (`li[data-friend-id]`, update in place, remove only what's no longer
  present) — never `replaceChildren()` on a list a user might be
  interacting with.

## Review Focus

- Reloading with an expired/invalid token must fall back to a clean
  logged-out state, not a broken half-logged-in UI or a thrown error
  (`Auth.init()` already catches this — Task 4 must prove it end to end).
- Searching with fewer than 2 characters returns `{ users: [] }` from the
  backend — the UI must say why the list is empty, not just show nothing
  (Task 6).
- Two users sending each other a friend request at nearly the same time
  must both end up friends, not end up with two pending requests or an
  error (Task 6; the backend already auto-accepts the mirror case — prove
  the UI handles the response correctly).
- Double-clicking "Add" / "Accept" before the first request resolves must
  not throw an unhandled promise rejection or corrupt the list — the
  backend returns 409 on a duplicate, which the UI must display as a
  message, not a console error (Task 6).
- Sending a chat message to someone no longer a friend (e.g. removed in
  another tab) must show an inline error, not throw — the backend returns
  403 (Task 8).

## File Structure

Everything except Task 10 modifies `index.html` in place (no new files —
this codebase is intentionally one file with no build step). Regions
touched, by current line anchor (line numbers drift as earlier tasks land;
each task gives the anchor it should currently be at):

- **State & storage** (~1959–2000): `state.lounge` shape, `activeAccountId`/
  `storageKey()`, `safeParse`/`safeSet`.
- **`Lounge` object** (~3597–3860): loses friend/invite-toast code, keeps
  room/bot/mission code untouched.
- **`LiveUsers` object** (~3558–3595): deleted entirely.
- **`Api`/`Socket`/`Auth`** (~2462–2572): gains `Auth.init()` call site
  elsewhere; Socket listeners for new modules added directly below this
  block.
- **`Friends` / `Notifications`** (new, inserted after `Auth`, ~2573).
- **`UI` object, render functions** (~3950–4360): `renderLoungeFriends`,
  `openChat`/`renderChatThread`, profile-modal stat rendering, new
  `syncAuthUI`/`renderFriendSearch`/`renderFriendRequests`/
  `renderNotifications`.
- **`UI.init()` event-wiring tail** (~4941–5423): where every new listener
  is registered, and where the two crash-causing dead listeners are
  removed.
- **`server/test/e2e.js`**: two new coverage blocks appended.

---

### Task 1: Fix three pre-existing bugs (boot crash, dead bot-roster helper, CSS token)

The app currently throws inside `UI.init()` and never finishes running it.
A recent redesign removed the Lounge's inline "add friend" forms and the
drawer's manual add-friend form from the HTML, but the JS at the bottom of
the file still tries to attach listeners to them, which throws on `null`
and aborts everything after it in `UI.init()` — including the friends
drawer toggle, chat dialog, and settings appearance rendering. Confirmed by
loading the page and reading the console: `TypeError: Cannot read
properties of null (reading 'addEventListener') at Object.init
(:5326:54)`.

Two more pre-existing bugs from the same "incomplete refactor left dead
references behind" pattern, caught by an independent automated review of
this branch and confirmed by grep — fixed here since they're one-line
fixes and Task 11's regression pass needs both working to be a meaningful
test:

- `Lounge._makeBotMember` (`index.html:3680-3686`) spreads
  `Lounge._simFields()`, which is called but never defined anywhere in the
  file (`grep -n "_simFields" index.html` returns only this one call
  site). This is the only thing that gives a bot member its `status`/
  `remainingMs`/etc. fields, and `_randomBotRoster` (used by `joinRoom`) is
  the only remaining caller after Task 6 deletes `inviteFriendToRoom` — so
  right now, and unless fixed here, clicking "Join Room" with any code
  throws immediately.
- `.auth-modal__tab.is-active` (`index.html:840`) sets `box-shadow:
  var(--shadow-sm)`, a token that doesn't exist (`grep -n "shadow-sm"
  index.html` returns only this line; the defined tokens are
  `--shadow-xs`/`--shadow-md`/`--shadow-lg`). The property silently
  resolves to nothing, so the active tab never gets its intended
  elevation.

**Files:**
- Modify: `index.html:5325-5343` (delete), `index.html:5389-5398` (delete),
  `index.html:3680-3686` (`_makeBotMember`, add missing helper),
  `index.html:840` (CSS token fix)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `UI.init()` that runs to completion, and a working "Join
  Room" bot roster. Every later task depends on the former; Task 11's
  regression pass depends on both.

- [ ] **Step 1: Delete the dead Lounge add-friend listeners**

Find and delete this whole block (the two `lounge-add-friend-form*`
submit listeners — their target elements no longer exist in the HTML):

```js
    // ---- Study Lounge ----
    document.getElementById('lounge-add-friend-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('lounge-friend-name-input');
      const avatarSelect = document.getElementById('lounge-friend-avatar-select');
      if (Lounge.addFriend(nameInput.value, avatarSelect.value)) {
        nameInput.value = '';
        UI.renderLoungeView();
      }
    });
    document.getElementById('lounge-add-friend-form-active').addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('lounge-friend-name-input-active');
      const avatarSelect = document.getElementById('lounge-friend-avatar-select-active');
      if (Lounge.addFriend(nameInput.value, avatarSelect.value)) {
        nameInput.value = '';
        UI.renderLoungeView();
      }
    });
```

Replace it with just the section comment, so the room-creation listeners
that follow keep a header:

```js
    // ---- Study Lounge ----
```

- [ ] **Step 2: Delete the dead friends-drawer add-friend listener**

Find and delete this block (its target, `#friends-drawer-add-form`, was
replaced by `#friend-search-form` in the HTML but this listener was never
updated):

```js
    document.getElementById('friends-drawer-add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('friends-drawer-name-input');
      const avatarSelect = document.getElementById('friends-drawer-avatar-select');
      if (Lounge.addFriend(nameInput.value, avatarSelect.value)) {
        nameInput.value = '';
        UI.renderLoungeFriends();
      }
    });
```

Leave the surrounding `// ---- Friends drawer ----` comment and the
toggle/close/backdrop listeners immediately above it untouched.

- [ ] **Step 3: Restore the missing `_simFields()` bot-state helper**

In the `Lounge` object, find `_makeBotMember` (`index.html:3680-3686`):

```js
  _makeBotMember(name, avatar) {
    return {
      id: `bot_${makeId()}`, isSelf: false, name, avatar,
      ...Lounge._simFields(),
      missionProgress: 0, missionState: 'pending',
    };
  },
```

Add the missing method right above it, giving a new bot member the same
shape `_tick()`/`_tickBot()` already expect from `_makeSelfMember()`
(`status`, `remainingMs`, `studyMinutesToday`, `restMinutesToday`,
`pomodorosToday`), started at a plausible random point in a focus/rest
cycle so bots don't all look identical the moment a room is joined:

```js
  _simFields() {
    const focusing = Math.random() < 0.6;
    const totalMs = (focusing ? state.settings.pomodoro : state.settings.shortBreak) * 60000;
    return {
      status: focusing ? 'focusing' : 'resting',
      remainingMs: Math.floor(Math.random() * totalMs),
      studyMinutesToday: Math.floor(Math.random() * 90),
      restMinutesToday: Math.floor(Math.random() * 20),
      pomodorosToday: Math.floor(Math.random() * 4),
      simXP: Math.floor(Math.random() * 200),
    };
  },
```

- [ ] **Step 4: Fix the undefined `--shadow-sm` CSS token**

At `index.html:840`:

```css
  .auth-modal__tab.is-active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
```

Change `var(--shadow-sm)` to `var(--shadow-xs)` (the closest existing
token to the subtle elevation this rule was going for):

```css
  .auth-modal__tab.is-active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs); }
```

- [ ] **Step 5: Verify all three fixes**

From `server/`, run: `npm run dev`

Then load `http://localhost:3000/` in a browser (or via the Playwright MCP
`browser_navigate` tool if available) and check the console
(`browser_console_messages` with `level: "error"`, or the browser devtools
console).

Expected: zero errors. Click the friends icon in the header (👥) — the
drawer should now open and close (it couldn't before, since its listener
was never reached). Go to Study Lounge, use "Join Room" with any code —
2-4 bots should appear with varied Focusing/Resting statuses and no
console error; let it run a few seconds and confirm their remaining-time
countdowns tick down.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "fix: boot-time crash, missing bot-state helper, and auth-tab shadow token"
```

---

### Task 2: Remove vestigial account-namespacing scaffolding

`activeAccountId`/`storageKey()` are leftovers from an already-removed local
multi-account switcher. Nothing writes a real account id into
`pomodoroActiveAccount` any more, so `storageKey()` is a permanent no-op —
pure dead complexity, safe to delete with no data migration.

**Files:**
- Modify: `index.html:1966-2000`, `index.html:2600-2601`

**Interfaces:**
- Consumes: nothing.
- Produces: `safeParse(key)`/`safeSet(key, value)` operating on the literal
  key with no indirection — everything after this task calls them exactly
  as before.

- [ ] **Step 1: Simplify `safeParse`/`safeSet` and remove the namespacing helpers**

Current code (`index.html:1966-1990`):

```js
/* ============================== Storage ============================== */

// Set at boot from the "pomodoroActiveAccount" registry key, before any
// Storage.load* call runs. Guest / never-chosen both resolve to unprefixed
// keys, so existing data is always reachable by default.
let activeAccountId = null;

function storageKey(key) {
  return (activeAccountId && activeAccountId !== 'guest') ? `acct:${activeAccountId}:${key}` : key;
}
function safeParse(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch { /* storage unavailable or full: ignore */ }
}
// Bypasses account namespacing entirely — used only for the account
// registry itself ("pomodoroAccounts"/"pomodoroActiveAccount"), which must
// stay readable no matter who is currently logged in.
function safeParseGlobal(key) {
```

Replace the `activeAccountId`/`storageKey`/`safeParse`/`safeSet` block
(keep `safeParseGlobal`/`safeSetGlobal` below it untouched) with:

```js
/* ============================== Storage ============================== */

function safeParse(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : null;
  } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable or full: ignore */ }
}
// Currently identical to safeParse/safeSet — kept as a distinct name for
// the handful of keys (pomodoroAuthToken, pomodoroGuestChoice) that are
// conceptually account-registry state, not per-user app data.
function safeParseGlobal(key) {
```

- [ ] **Step 2: Remove the boot-time read of the now-deleted variable**

In `State.init()` (`index.html:2600-2601`), delete this line:

```js
    activeAccountId = safeParseGlobal('pomodoroActiveAccount');
```

- [ ] **Step 3: Verify no dangling references**

Run: `grep -n "activeAccountId\|storageKey(" index.html`

Expected: no output.

- [ ] **Step 4: Manual regression check**

`npm run dev` from `server/`, load the app, create a task and a custom
setting, reload the page — both must still be there (proves guest data
survived the refactor byte-identically, since guest keys were always
unprefixed).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "refactor: remove dead account-namespacing scaffolding"
```

---

### Task 3: Activate the backend connection and real online-count

Turns on `Auth.init()` (which connects the WebSocket and restores any
saved session) and replaces the fake `LiveUsers` random-tick counter with
the server's real count.

**Files:**
- Modify: `index.html:3558-3595` (delete `LiveUsers`), `index.html:4941-4957`
  (`UI.init()`), `index.html:2572` (insert after `Auth`)

**Interfaces:**
- Consumes: `Auth.init()`, `Socket.on(type, fn)` (both already defined,
  unused until now).
- Produces: `#live-users-count` reflects the server's real connection
  count. Later tasks (4+) build on `Auth.init()` already having run.

- [ ] **Step 1: Delete the `LiveUsers` module**

Delete this entire block (`index.html:3558-3595`):

```js
/* ============================== LiveUsers (simulated) ============================== */
// No backend exists to source real concurrent-user counts, so this is an honest, purely
// client-side visual simulation — a slowly-drifting number, not real telemetry.
const LiveUsers = {
  MIN: 40,
  MAX: 65,
  _count: 0,
  _timer: null,

  start() {
    LiveUsers._count = LiveUsers.MIN + Math.floor(Math.random() * (LiveUsers.MAX - LiveUsers.MIN + 1));
    LiveUsers._render();
    LiveUsers._schedule();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) LiveUsers._stop();
      else if (!LiveUsers._timer) LiveUsers._schedule();
    });
  },
  _schedule() {
    LiveUsers._timer = setTimeout(() => {
      LiveUsers._tick();
      LiveUsers._schedule();
    }, 3000 + Math.random() * 2000);
  },
  _stop() {
    clearTimeout(LiveUsers._timer);
    LiveUsers._timer = null;
  },
  _tick() {
    const delta = Math.round((Math.random() - 0.5) * 6); // drift by roughly -3..+3
    LiveUsers._count = Math.min(LiveUsers.MAX, Math.max(LiveUsers.MIN, LiveUsers._count + delta));
    LiveUsers._render();
  },
  _render() {
    const el = document.getElementById('live-users-count');
    if (el) el.textContent = String(LiveUsers._count);
  },
};
```

- [ ] **Step 2: Wire the real online-count**

Immediately after the `Auth` object's closing `};` (`index.html:2572`),
insert:

```js

/* ============================== real-time listeners ==============================
   Global Socket listeners that don't belong to a specific feature module. */
Socket.on('online-count', ({ count }) => {
  const el = document.getElementById('live-users-count');
  if (el) el.textContent = String(count);
});
```

- [ ] **Step 3: Call `Auth.init()` from boot and remove the `LiveUsers.start()` call**

In `UI.init()` (`index.html:4941-4957`), change:

```js
  init() {
    State.init();
    UI.renderTasks();
```

to:

```js
  init() {
    State.init();
    Auth.init();
    UI.renderTasks();
```

And delete the line `LiveUsers.start();` further down in the same
function (currently right before the `['dashboard', 'reports', ...]`
nav-wiring block).

- [ ] **Step 4: Verify with two tabs**

`npm run dev` from `server/`. Open `http://localhost:3000/` in two
separate browser tabs (or two Playwright tabs via `browser_tabs`).

Expected: both tabs show `1` briefly then `2` once the second connects
(the count is the number of open sockets, not distinct users, since
neither is logged in yet). Close one tab — the other's count drops to `1`
within a couple seconds (a clean tab close fires the WebSocket `close`
event immediately; it doesn't need to wait for the 30s heartbeat, which
only matters for a network-dead client).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: replace simulated online counter with real presence"
```

---

### Task 4: Auth modal wiring (register, log in, guest)

Wires the already-styled, already-HTML'd auth modal to the real `Auth`
object, and adds the boot-time logic that decides when to show it.

**Files:**
- Modify: `index.html:2572` area (add `syncAuthUI` inside `UI`),
  `index.html:4941-4958` (`UI.init()`), `index.html:5002-5010` area
  (add auth-modal listeners near the existing profile-modal ones)

**Interfaces:**
- Consumes: `Auth.login(identifier, password)`, `Auth.register(username,
  password, displayName)`, `Auth.continueAsGuest()`, `Auth.isLoggedIn()`,
  `Auth.currentUser` (all pre-existing).
- Produces: `UI.syncAuthUI()` — called by every later task that changes
  login state (Task 5, 6, 7). For now it only handles what this task
  needs; Tasks 6/7 extend its body.

- [ ] **Step 1: Add `UI.syncAuthUI()`**

Add this new method to the `UI` object (anywhere among its other
top-level methods — e.g. right after `renderProfile`, whose definition
you can find with `grep -n "renderProfile()" index.html`):

```js
  syncAuthUI() {
    const loggedIn = Auth.isLoggedIn();
    document.getElementById('notif-picker').hidden = !loggedIn;
    document.getElementById('user-name-display').textContent =
      loggedIn ? Auth.currentUser.displayName : state.profile.username;
  },
```

- [ ] **Step 2: Show the auth modal at boot when nobody has chosen yet**

In `UI.init()`, right after the `Auth.init()` call added in Task 3, this
needs to run **after** `Auth.init()`'s async session-restore attempt
settles, so make it wait:

```js
  async init() {
    State.init();
    await Auth.init();
    UI.syncAuthUI();
    if (!Auth.isLoggedIn() && !safeParseGlobal('pomodoroGuestChoice')) {
      document.getElementById('auth-modal').showModal();
    }
    UI.renderTasks();
```

(`UI.init()` becomes `async` here — this is safe: it's only ever called
from the `DOMContentLoaded` listener, which doesn't await it.)

- [ ] **Step 3: Wire the auth-modal tabs**

Add near the other modal-wiring code in `UI.init()` (e.g. right after the
existing `// ---- Profile modal ----` block you can find with `grep -n
"Profile modal ----" index.html`):

```js
    // ---- Auth modal ----
    const selectAuthTab = (tab) => {
      const isLogin = tab === 'login';
      document.getElementById('auth-tab-login').classList.toggle('is-active', isLogin);
      document.getElementById('auth-tab-login').setAttribute('aria-selected', String(isLogin));
      document.getElementById('auth-tab-signup').classList.toggle('is-active', !isLogin);
      document.getElementById('auth-tab-signup').setAttribute('aria-selected', String(!isLogin));
      document.getElementById('auth-panel-login').hidden = !isLogin;
      document.getElementById('auth-panel-signup').hidden = isLogin;
    };
    document.getElementById('auth-tab-login').addEventListener('click', () => selectAuthTab('login'));
    document.getElementById('auth-tab-signup').addEventListener('click', () => selectAuthTab('signup'));
```

- [ ] **Step 4: Wire log in / sign up / guest submit**

Immediately after the tab wiring:

```js
    document.getElementById('auth-login-submit').addEventListener('click', async () => {
      const status = document.getElementById('status-auth-login');
      const identifier = document.getElementById('auth-login-identifier').value.trim();
      const password = document.getElementById('auth-login-password').value;
      setFieldStatus(status, '', '');
      try {
        await Auth.login(identifier, password);
        document.getElementById('auth-modal').close();
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      }
    });
    document.getElementById('auth-signup-submit').addEventListener('click', async () => {
      const status = document.getElementById('status-auth-signup');
      const username = document.getElementById('auth-signup-username').value.trim();
      const email = document.getElementById('auth-signup-email').value.trim();
      const password = document.getElementById('auth-signup-password').value;
      setFieldStatus(status, '', '');
      try {
        await Auth.register(username, password, username, email);
        document.getElementById('auth-modal').close();
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      }
    });
    document.getElementById('auth-guest-btn').addEventListener('click', () => {
      Auth.continueAsGuest();
      document.getElementById('auth-modal').close();
    });
```

`Auth.register`'s current signature is `register(username, password,
displayName)` and ignores email — extend it (in the `Auth` object,
`index.html:2542-2545`) to pass email through to match the backend, which
already accepts it:

```js
  async register(username, password, displayName, email) {
    const { token, user } = await Api.post('/api/auth/register', { username, password, displayName, email });
    Auth._onAuthenticated(token, user);
  },
```

- [ ] **Step 5: Make `_onAuthenticated`/`logout` call `syncAuthUI` (it already tries to, guarded)**

`Auth._onAuthenticated` and `Auth.logout` (`index.html:2550-2570`) already
contain `if (typeof UI !== 'undefined') UI.syncAuthUI();` — no change
needed here, just confirm by reading `index.html:2550-2570` that both call
sites are present (they were written when `Auth` was first added, in
anticipation of this task).

- [ ] **Step 6: Verify — sign up, reload, expired-token fallback (Review Focus)**

`npm run dev` from `server/`. Load the app fresh (clear the site's
localStorage first, or use a private window):

1. The auth modal appears automatically. Fill in the Sign Up tab with a
   new username/password, submit. Expected: modal closes,
   `#user-name-display` in the header shows the new username, no console
   errors.
2. Reload the page. Expected: no modal (session restored silently), same
   username shown.
3. Open devtools, run `localStorage.setItem('pomodoroAuthToken',
   JSON.stringify('garbage'))`, reload. Expected: `Auth.init()`'s existing
   catch clears the bad token and the app falls back to guest state
   (header shows the local guest profile name, no thrown error, no modal
   since `pomodoroGuestChoice` was already set in step 1... to see the
   modal reappear for this case specifically, also clear
   `pomodoroGuestChoice` before reloading).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: wire the real auth modal (register/login/guest)"
```

---

### Task 5: Log Out and Log In/Sign Up entry points

Makes the previously-inert `#profile-modal-switch-account-btn` a real "Log
Out" action, and gives a guest a way to reopen the auth modal later (there
is currently no way to do this once dismissed).

**Files:**
- Modify: `index.html:1815-1818` (profile modal buttons),
  `index.html:5002-5010` area (listeners), `UI.syncAuthUI`

**Interfaces:**
- Consumes: `Auth.logout()`, `Auth.continueAsGuest` state via
  `Auth.isLoggedIn()`.
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Update the profile modal HTML**

Current (`index.html:1815-1818`):

```html
      <div class="profile-modal__edit-actions">
        <button type="button" class="btn btn-secondary" id="profile-modal-edit-btn">Edit Profile</button>
        <button type="button" class="btn btn-secondary" id="profile-modal-switch-account-btn">Switch Account</button>
      </div>
```

Replace with:

```html
      <div class="profile-modal__edit-actions">
        <button type="button" class="btn btn-secondary" id="profile-modal-edit-btn">Edit Profile</button>
        <button type="button" class="btn btn-secondary" id="profile-modal-logout-btn">Log Out</button>
        <button type="button" class="btn btn-secondary" id="profile-modal-login-btn" hidden>Log In / Sign Up</button>
      </div>
```

- [ ] **Step 2: Wire both buttons**

Add near the other profile-modal listeners in `UI.init()`:

```js
    document.getElementById('profile-modal-logout-btn').addEventListener('click', () => {
      document.getElementById('profile-modal').close();
      Auth.logout();
      document.getElementById('auth-modal').showModal();
    });
    document.getElementById('profile-modal-login-btn').addEventListener('click', () => {
      document.getElementById('profile-modal').close();
      document.getElementById('auth-modal').showModal();
    });
```

- [ ] **Step 3: Toggle which button shows, based on login state**

Extend `UI.syncAuthUI()` (added in Task 4):

```js
  syncAuthUI() {
    const loggedIn = Auth.isLoggedIn();
    document.getElementById('notif-picker').hidden = !loggedIn;
    document.getElementById('user-name-display').textContent =
      loggedIn ? Auth.currentUser.displayName : state.profile.username;
    document.getElementById('profile-modal-logout-btn').hidden = !loggedIn;
    document.getElementById('profile-modal-login-btn').hidden = loggedIn;
  },
```

- [ ] **Step 4: Verify the full round trip**

`npm run dev`, fresh browser profile:

1. Continue as Guest. Open the profile modal — "Log In / Sign Up" is
   visible, "Log Out" is not. Click it — the auth modal reopens.
2. Sign up. Open the profile modal again — now "Log Out" is visible
   instead. Click it — you're back to a logged-out state and the auth
   modal reopens automatically.
3. Log back in with the same credentials via the Log In tab — succeeds.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: wire real log out / log in entry points on the profile modal"
```

---

### Task 6: Friends module — search, requests, real friends list, presence

The largest task. Builds the `Friends` object and rewrites the one shared
render function that feeds the Lounge lobby, Lounge active-room panel, and
the global friends drawer, so all three show real friends. Also removes
`Lounge.inviteFriendToRoom` (inviting a real friend into a still-simulated
room would misrepresent what's happening — this returns in the Study
Lounge multiplayer sub-project).

**Files:**
- Modify: `index.html` — new `Friends` object (after the `Socket.on`
  block added in Task 3), `renderLoungeFriends` (~4023-4069, rewritten and
  effectively renamed in role though the identifier stays to avoid
  touching its several call sites), new `UI.renderFriendSearch`/
  `renderFriendRequests`, `Lounge.inviteFriendToRoom` deleted (~3725-3732),
  profile-modal stat rendering (~3998-3999), `UI.init()` wiring for
  `#friend-search-form` and the requests section, `UI.syncAuthUI`.

**Interfaces:**
- Consumes: `Api.get/post/del`, `Socket.on`.
- Produces: `Friends.list` (array of `{id, username, displayName, avatar,
  online, lastSeenAt}`), `Friends.incoming`/`Friends.outgoing` (arrays of
  `{id, createdAt, user}`), `Friends.refreshAll()` — Task 7 and Task 8 both
  call this or read `Friends.list`.

- [ ] **Step 1: Add the `Friends` module**

After the `Socket.on('online-count', ...)` block added in Task 3, insert:

```js

/* ============================== Friends ==============================
   Real friends/requests/search against the backend in server/. */
const Friends = {
  list: [], incoming: [], outgoing: [],

  async refreshAll() {
    if (!Auth.isLoggedIn()) { Friends.list = []; Friends.incoming = []; Friends.outgoing = []; }
    else {
      const [{ friends }, { incoming, outgoing }] = await Promise.all([
        Api.get('/api/friends'),
        Api.get('/api/friends/requests'),
      ]);
      Friends.list = friends; Friends.incoming = incoming; Friends.outgoing = outgoing;
    }
    if (typeof UI !== 'undefined') { UI.renderLoungeFriends(); UI.renderFriendRequests(); }
  },
  search(query) { return Api.get(`/api/users/search?q=${encodeURIComponent(query)}`).then((r) => r.users); },
  sendRequest(userId) { return Api.post('/api/friends/requests', { toUserId: userId }); },
  accept(requestId) { return Api.post(`/api/friends/requests/${requestId}/accept`).then(() => Friends.refreshAll()); },
  reject(requestId) { return Api.post(`/api/friends/requests/${requestId}/reject`).then(() => Friends.refreshAll()); },
  cancel(requestId) { return Api.del(`/api/friends/requests/${requestId}`).then(() => Friends.refreshAll()); },
  remove(friendId) { return Api.del(`/api/friends/${friendId}`).then(() => Friends.refreshAll()); },
};

Socket.on('friend-request', () => Friends.refreshAll());
Socket.on('friend-accept', () => Friends.refreshAll());
Socket.on('presence', ({ userId, online, lastSeenAt }) => {
  const f = Friends.list.find((x) => x.id === userId);
  if (f) { f.online = online; f.lastSeenAt = lastSeenAt; }
  if (typeof UI !== 'undefined') UI.renderLoungeFriends();
});
```

- [ ] **Step 2: Call `Friends.refreshAll()` from `syncAuthUI`**

Extend `UI.syncAuthUI()` (from Tasks 4/5) with one more line at the end:

```js
    Friends.refreshAll();
```

(Safe to call unconditionally — it clears its own lists internally when
logged out, per Step 1's guard.)

- [ ] **Step 3: Delete `Lounge.inviteFriendToRoom`**

Delete this method entirely (`index.html:3725-3732`):

```js
  inviteFriendToRoom(friendId) {
    if (!state.lounge.room) return false;
    const friend = state.lounge.friends.find((f) => f.id === friendId);
    if (!friend) return false;
    state.lounge.room.members.push(Lounge._makeBotMember(friend.name, friend.avatar));
    Lounge._logActivity(state.lounge.room, `${friend.name} was invited to the room.`);
    return true;
  },
```

- [ ] **Step 4: Rewrite `renderLoungeFriends`**

Replace the whole method (`index.html:4023-4069`) with a version that
reads `Friends.list` instead of `state.lounge.friends`, drops the
"Invite to Room" button, and shows online/offline instead of the old
simulated Focusing/Resting labels (the real backend only tracks binary
connection state, not per-friend timer phase):

```js
  renderLoungeFriends() {
    for (const listId of ['lounge-friends-list', 'lounge-friends-list-active', 'friends-drawer-list']) {
      const list = document.getElementById(listId);
      if (!list) continue;
      const seen = new Set();
      for (const f of Friends.list) {
        seen.add(f.id);
        let li = list.querySelector(`li[data-friend-id="${f.id}"]`);
        if (!li) {
          li = document.createElement('li');
          li.className = 'lounge-friend-item';
          li.dataset.friendId = f.id;
          const avatar = document.createElement('span');
          avatar.className = 'lounge-friend-item__avatar';
          const name = document.createElement('span');
          name.className = 'lounge-friend-item__name';
          const status = document.createElement('span');
          status.className = 'lounge-friend-item__status';
          const chatBtn = document.createElement('button');
          chatBtn.type = 'button';
          chatBtn.className = 'btn btn-secondary lounge-friend-item__chat';
          chatBtn.textContent = 'Chat';
          chatBtn.addEventListener('click', () => UI.openChat(f.id));
          li.append(avatar, name, status, chatBtn);
          list.appendChild(li);
        }
        li.querySelector('.lounge-friend-item__avatar').textContent = f.avatar || '🙂';
        li.querySelector('.lounge-friend-item__name').textContent = f.displayName;
        const statusEl = li.querySelector('.lounge-friend-item__status');
        statusEl.textContent = f.online ? 'Online' : 'Offline';
        statusEl.dataset.status = f.online ? 'online' : 'offline';
      }
      const emptyMsg = document.getElementById('friends-drawer-empty');
      if (listId === 'friends-drawer-list' && emptyMsg) emptyMsg.hidden = Friends.list.length > 0;
      for (const li of [...list.children]) {
        if (!seen.has(li.dataset.friendId)) li.remove();
      }
    }
  },
```

- [ ] **Step 5: Add friend search rendering + wiring**

Add a new `UI` method (anywhere among the others):

```js
  renderFriendSearchResults(users) {
    const list = document.getElementById('friend-search-results');
    const status = document.getElementById('friend-search-status');
    list.replaceChildren();
    list.hidden = users.length === 0;
    if (users.length === 0) {
      setFieldStatus(status, 'No matching users. Try at least 2 characters of their username.', '');
      return;
    }
    setFieldStatus(status, '', '');
    for (const u of users) {
      const li = document.createElement('li');
      li.className = 'lounge-friend-item';
      const avatar = document.createElement('span');
      avatar.className = 'lounge-friend-item__avatar';
      avatar.textContent = u.avatar || '🙂';
      const name = document.createElement('span');
      name.className = 'lounge-friend-item__name';
      name.textContent = u.displayName;
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'btn btn-secondary';
      const relationLabels = { none: 'Add', pending_out: 'Cancel', pending_in: 'Respond below', friends: 'Friends' };
      actionBtn.textContent = relationLabels[u.relationship] || 'Add';
      actionBtn.disabled = u.relationship === 'friends' || u.relationship === 'pending_in';
      actionBtn.addEventListener('click', async () => {
        actionBtn.disabled = true;
        try {
          if (u.relationship === 'none') await Friends.sendRequest(u.id);
          await Friends.refreshAll();
          document.getElementById('friend-search-form').requestSubmit();
        } catch (err) {
          setFieldStatus(status, err.message, 'error');
          actionBtn.disabled = false;
        }
      });
      li.append(avatar, name, actionBtn);
      list.appendChild(li);
    }
  },
```

Wire the search form in `UI.init()`, near the friends-drawer listeners
(right where the old, now-deleted `friends-drawer-add-form` listener used
to be):

```js
    document.getElementById('friend-search-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('friend-search-input');
      const status = document.getElementById('friend-search-status');
      const query = input.value.trim();
      if (query.length < 2) {
        setFieldStatus(status, 'Type at least 2 characters.', '');
        document.getElementById('friend-search-results').hidden = true;
        return;
      }
      try {
        const users = await Friends.search(query);
        UI.renderFriendSearchResults(users);
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      }
    });
```

- [ ] **Step 6: Add friend-requests rendering + wiring**

Add a new `UI` method:

```js
  renderFriendRequests() {
    const section = document.getElementById('friend-requests-section');
    const incomingList = document.getElementById('friend-requests-incoming');
    const outgoingList = document.getElementById('friend-requests-outgoing');
    section.hidden = Friends.incoming.length === 0 && Friends.outgoing.length === 0;
    incomingList.replaceChildren();
    for (const r of Friends.incoming) {
      const li = document.createElement('li');
      li.className = 'lounge-friend-item';
      const name = document.createElement('span');
      name.className = 'lounge-friend-item__name';
      name.textContent = `${r.user.displayName} wants to be friends`;
      const acceptBtn = document.createElement('button');
      acceptBtn.type = 'button'; acceptBtn.className = 'btn btn-primary'; acceptBtn.textContent = 'Accept';
      acceptBtn.addEventListener('click', () => { acceptBtn.disabled = true; Friends.accept(r.id); });
      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button'; rejectBtn.className = 'btn btn-secondary'; rejectBtn.textContent = 'Decline';
      rejectBtn.addEventListener('click', () => { rejectBtn.disabled = true; Friends.reject(r.id); });
      li.append(name, acceptBtn, rejectBtn);
      incomingList.appendChild(li);
    }
    outgoingList.replaceChildren();
    for (const r of Friends.outgoing) {
      const li = document.createElement('li');
      li.className = 'lounge-friend-item';
      const name = document.createElement('span');
      name.className = 'lounge-friend-item__name';
      name.textContent = `Request sent to ${r.user.displayName}`;
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button'; cancelBtn.className = 'btn btn-secondary'; cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => { cancelBtn.disabled = true; Friends.cancel(r.id); });
      li.append(name, cancelBtn);
      outgoingList.appendChild(li);
    }
  },
```

(These two lists render unconditionally on their own re-render calls, so
`replaceChildren()` here is fine — unlike the friends list, nobody is
mid-interaction with a request row while `refreshAll()` re-fetches, since
every button click already disables itself and triggers the refresh.)

- [ ] **Step 7: Fix the profile-modal friend count**

In `renderProfileModalView` (`index.html:3998-3999`), change:

```js
    document.getElementById('profile-stat-friends').textContent = String(state.lounge.friends.length);
    const followers = Math.max(0, level * 4 + state.stats.currentStreak * 2 + state.lounge.friends.length);
```

to:

```js
    document.getElementById('profile-stat-friends').textContent = String(Friends.list.length);
    const followers = Math.max(0, level * 4 + state.stats.currentStreak * 2 + Friends.list.length);
```

- [ ] **Step 8: Verify with two accounts (Review Focus: search UX, duplicate/race safety)**

`npm run dev`. Sign up as `alice_test` in one browser profile and
`bob_test` in another (two Playwright tabs, or a normal + private window).

1. As Alice, search for `bo` (2 chars) — Bob appears with an "Add" button.
   Search for `x` (1 char) — results are empty and the status text
   explains why (not just a blank list).
2. Click Add. As Bob, open the drawer — the request appears under Friend
   Requests within a few seconds (via the `friend-request` socket event,
   no manual refresh). Accept it.
3. As Alice, the friends list now shows Bob with "Online". Close Bob's
   tab — Alice's row for Bob flips to "Offline" (via the `presence`
   socket event).
4. Duplicate-request safety: as Alice, with Bob already a friend, search
   for Bob again — the button now reads "Friends" and is disabled (no way
   to fire a duplicate request from the UI; confirms the relationship
   field round-trips correctly).
5. Double-submit safety (Review Focus): create a third test account, Eve.
   As Alice, search for Eve, click "Add" — the button disables immediately
   (before the request resolves). Before `Friends.refreshAll()` finishes,
   quickly re-submit the search form for "Eve" again (a fresh row renders
   with a new, enabled button still showing the stale `none` relationship)
   and click "Add" on it too. Expected: the second click's request gets a
   409 from the backend, and the search status text shows "Friend request
   already sent." — not a console error or a frozen/broken button.
6. Race safety: create two more test accounts, Carol and Dave. Have Carol
   send Dave a request, and in the same few seconds have Dave send Carol
   one too (open both tabs, click Add on both within a couple seconds of
   each other). Expected: both end up friends with each other (the
   backend auto-accepts the mirror case) — check both accounts' friends
   lists show each other, and neither shows a stray pending request.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: real friends module (search, requests, presence)"
```

---

### Task 7: Notifications

Wires the already-styled, currently-unwired notification bell to the
backend.

**Files:**
- Modify: `index.html` — new `Notifications` object (after `Friends`),
  new `UI.renderNotifications`, `UI.init()` wiring, `UI.syncAuthUI`.

**Interfaces:**
- Consumes: `Api.get/post`, `Socket.on`.
- Produces: nothing consumed by later tasks (this is a leaf feature).

- [ ] **Step 1: Add the `Notifications` module**

After the `Friends` object's closing `};` and its `Socket.on` calls,
insert:

```js

/* ============================== Notifications ============================== */
const Notifications = {
  items: [], unreadCount: 0,

  async refreshAll() {
    if (!Auth.isLoggedIn()) { Notifications.items = []; Notifications.unreadCount = 0; }
    else {
      const { notifications, unreadCount } = await Api.get('/api/notifications');
      Notifications.items = notifications; Notifications.unreadCount = unreadCount;
    }
    if (typeof UI !== 'undefined') UI.renderNotifications();
  },
  markRead(id) { return Api.post(`/api/notifications/${id}/read`).then(() => Notifications.refreshAll()); },
  markAllRead() { return Api.post('/api/notifications/read-all').then(() => Notifications.refreshAll()); },
};
Socket.on('notification', ({ notification }) => {
  Notifications.items.unshift(notification);
  Notifications.unreadCount++;
  if (typeof UI !== 'undefined') UI.renderNotifications();
});
Socket.on('message', ({ message }) => {
  if (state.activeChatFriendId !== message.senderId) Notifications.refreshAll();
});
```

(That last listener is a small look-ahead for Task 8: when a DM arrives
from someone whose thread isn't currently open, refresh notifications so
unread state stays right. `state.activeChatFriendId` doesn't exist until
Task 8 adds it — until then this line just never matches, which is
harmless: `undefined !== message.senderId` is always true, so it always
refreshes, which is a no-op today since chat doesn't produce `message`
socket events yet either.)

- [ ] **Step 2: Render notifications**

Add a new `UI` method:

```js
  renderNotifications() {
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    const empty = document.getElementById('notif-empty');
    badge.hidden = Notifications.unreadCount === 0;
    badge.textContent = String(Notifications.unreadCount);
    empty.hidden = Notifications.items.length > 0;
    list.replaceChildren();
    for (const n of Notifications.items) {
      const li = document.createElement('li');
      li.className = 'notif-item';
      li.dataset.unread = String(!n.readAt);
      const dot = document.createElement('span');
      dot.className = 'notif-item__dot';
      const body = document.createElement('div');
      body.className = 'notif-item__body';
      const text = document.createElement('span');
      text.className = 'notif-item__text';
      const who = n.data.from ? n.data.from.displayName : (n.data.by ? n.data.by.displayName : 'Someone');
      const copy = {
        friend_request: `${who} sent you a friend request`,
        friend_accept: `${who} accepted your friend request`,
        message: `${who}: ${n.data.preview || ''}`,
      };
      text.textContent = copy[n.type] || 'New notification';
      const time = document.createElement('span');
      time.className = 'notif-item__time';
      time.textContent = new Date(n.createdAt).toLocaleString();
      body.append(text, time);
      li.append(dot, body);
      li.addEventListener('click', () => { if (!n.readAt) Notifications.markRead(n.id); });
      list.appendChild(li);
    }
  },
```

- [ ] **Step 3: Wire the bell trigger and mark-all-read**

Add to `UI.init()`, near the other header wiring:

```js
    // ---- Notifications ----
    document.getElementById('notif-trigger').addEventListener('click', () => {
      const menu = document.getElementById('notif-menu');
      const trigger = document.getElementById('notif-trigger');
      const opening = menu.hidden;
      menu.hidden = !opening;
      trigger.setAttribute('aria-expanded', String(opening));
    });
    document.getElementById('notif-mark-all-read').addEventListener('click', () => Notifications.markAllRead());
```

- [ ] **Step 4: Call `Notifications.refreshAll()` from `syncAuthUI`**

Extend `UI.syncAuthUI()` again, adding one line:

```js
    Notifications.refreshAll();
```

- [ ] **Step 5: Verify**

`npm run dev`, two accounts (reuse alice_test/bob_test from Task 6, or use
fresh ones). As Alice, send Bob a friend request. As Bob (already
logged in, drawer/bell visible), within a couple seconds:

- The bell badge shows `1` without reloading.
- Opening the bell shows "alice_test sent you a friend request".
- Clicking it marks it read (badge count drops); "Mark all read" clears
  any remaining unread state.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: wire real notifications to the bell menu"
```

---

### Task 8: Real DM chat

Rewrites the chat dialog to use the real conversation endpoints instead of
the (already-broken, never-actually-populated) `state.lounge.chats`.

**Files:**
- Modify: `index.html` — `state.activeChatFriendId` (new top-level state
  field, replacing `state.lounge.activeChatFriendId`), `UI.openChat`/
  `UI.renderChatThread` (~4276-4297, rewritten), `UI.init()`'s chat-dialog
  wiring (~5400-5411), a new `Socket.on('message', ...)` for live append.

**Interfaces:**
- Consumes: `Friends.list` (Task 6), `Api.get/post`, `Socket.on`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Move `activeChatFriendId` to top-level state**

In the `state` object initializer (`index.html:1947-1962`), find:

```js
  lounge: { friends: [], room: null, chats: {}, activeChatFriendId: null, pendingInvite: null },
```

Replace with (this task only touches `activeChatFriendId`; `friends` and
`chats` are removed here since nothing reads them any more after Task 6
and this task; `pendingInvite` is removed in Task 9):

```js
  activeChatFriendId: null,
  lounge: { room: null, pendingInvite: null },
```

- [ ] **Step 2: Rewrite `openChat` and `renderChatThread`**

Replace `index.html:4276-4297`:

```js
  openChat(friendId) {
    state.lounge.activeChatFriendId = friendId;
    const friend = state.lounge.friends.find((f) => f.id === friendId);
    document.getElementById('chat-dialog-title').textContent = friend ? `Chat with ${friend.name}` : 'Chat';
    UI.renderChatThread(friendId);
    document.getElementById('chat-dialog').showModal();
  },

  renderChatThread(friendId) {
    const list = document.getElementById('chat-dialog-messages');
    if (!list) return;
    if (state.lounge.activeChatFriendId !== friendId) return;
    list.replaceChildren();
    const thread = state.lounge.chats[friendId] || [];
    for (const m of thread) {
      const li = document.createElement('li');
      li.className = `chat-dialog__message chat-dialog__message--${m.from === 'me' ? 'me' : 'friend'}`;
      li.textContent = m.text;
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;
  },
```

with:

```js
  async openChat(friendId) {
    state.activeChatFriendId = friendId;
    const friend = Friends.list.find((f) => f.id === friendId);
    document.getElementById('chat-dialog-title').textContent = friend ? `Chat with ${friend.displayName}` : 'Chat';
    document.getElementById('chat-dialog-messages').replaceChildren();
    document.getElementById('chat-dialog').showModal();
    try {
      const { messages } = await Api.get(`/api/conversations/${friendId}/messages`);
      UI.renderChatThread(friendId, messages);
      Api.post(`/api/conversations/${friendId}/read`);
    } catch (err) {
      setFieldStatus(document.getElementById('chat-dialog-messages'), '', '');
      const li = document.createElement('li');
      li.className = 'chat-dialog__message chat-dialog__message--friend';
      li.textContent = `Couldn't load messages: ${err.message}`;
      document.getElementById('chat-dialog-messages').appendChild(li);
    }
  },

  renderChatThread(friendId, messages) {
    const list = document.getElementById('chat-dialog-messages');
    if (!list || state.activeChatFriendId !== friendId) return;
    list.replaceChildren();
    for (const m of messages) {
      const li = document.createElement('li');
      li.className = `chat-dialog__message chat-dialog__message--${m.senderId === friendId ? 'friend' : 'me'}`;
      li.textContent = m.text;
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;
  },
```

- [ ] **Step 3: Rewrite the send/receive wiring**

Replace the chat-dialog block in `UI.init()` (`index.html:5400-5411`):

```js
    // ---- Chat dialog ----
    document.getElementById('chat-dialog-close').addEventListener('click', () => document.getElementById('chat-dialog').close());
    document.getElementById('chat-dialog').addEventListener('close', () => { state.lounge.activeChatFriendId = null; });
    const sendChatMessage = () => {
      const input = document.getElementById('chat-dialog-input');
      const friendId = state.lounge.activeChatFriendId;
      if (friendId && Lounge.sendMessage(friendId, input.value)) input.value = '';
    };
    document.getElementById('chat-dialog-send').addEventListener('click', sendChatMessage);
    document.getElementById('chat-dialog-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
    });
```

with:

```js
    // ---- Chat dialog ----
    document.getElementById('chat-dialog-close').addEventListener('click', () => document.getElementById('chat-dialog').close());
    document.getElementById('chat-dialog').addEventListener('close', () => { state.activeChatFriendId = null; });
    const sendChatMessage = async () => {
      const input = document.getElementById('chat-dialog-input');
      const friendId = state.activeChatFriendId;
      const text = input.value.trim();
      if (!friendId || !text) return;
      const list = document.getElementById('chat-dialog-messages');
      try {
        const { message } = await Api.post(`/api/conversations/${friendId}/messages`, { text });
        input.value = '';
        const li = document.createElement('li');
        li.className = 'chat-dialog__message chat-dialog__message--me';
        li.textContent = message.text;
        list.appendChild(li);
        list.scrollTop = list.scrollHeight;
      } catch (err) {
        const li = document.createElement('li');
        li.className = 'chat-dialog__message chat-dialog__message--friend';
        li.textContent = `Couldn't send: ${err.message}`;
        list.appendChild(li);
      }
    };
    document.getElementById('chat-dialog-send').addEventListener('click', sendChatMessage);
    document.getElementById('chat-dialog-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
    });
    Socket.on('message', ({ message }) => {
      if (state.activeChatFriendId !== message.senderId) return;
      const list = document.getElementById('chat-dialog-messages');
      const li = document.createElement('li');
      li.className = 'chat-dialog__message chat-dialog__message--friend';
      li.textContent = message.text;
      list.appendChild(li);
      list.scrollTop = list.scrollHeight;
      Api.post(`/api/conversations/${message.senderId}/read`);
    });
```

- [ ] **Step 4: Verify (Review Focus: chat with a non-friend after removal)**

`npm run dev`, Alice and Bob already friends (from Task 6/7).

1. Alice opens chat with Bob, sends "hey" — appears immediately as "me".
   Bob's chat dialog (if open on Bob) shows it live as "friend" within a
   second or two; if Bob's dialog isn't open, Bob's notification bell
   badge increments instead (via Task 7's message→notification refresh).
2. Close and reopen the chat from Alice's side — history persisted
   server-side (it's not in localStorage any more), same messages show.
3. Remove-then-message safety: have Bob remove Alice as a friend
   (`Friends.remove` — trigger this via the friends list once a "remove"
   UI exists, or directly via `Friends.remove('<alice-id>')` in the
   console for this check since no remove button exists in the UI yet).
   Alice then tries to send Bob another message. Expected: an inline
   "Couldn't send: You can only message friends." bubble, not a thrown
   error or a silently-dropped message.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: real DM chat backed by the conversations API"
```

---

### Task 9: Remove remaining dead Lounge-simulation leftovers

Cleans up what's left of the old simulated system: the invite-toast (its
trigger, `_maybeSimulateInvite`, never existed in the current code, but
`pendingInvite`/`acceptInvite`/`dismissInvite`/the toast HTML do, and are
now fully dead since nothing ever sets `pendingInvite`).

**Files:**
- Modify: `index.html` — `Lounge.acceptInvite`/`dismissInvite` (~3645-3656),
  `state.lounge.pendingInvite`, `UI.renderInviteToast` (~4299-4307),
  `#invite-toast` HTML (~1788-1794) and its CSS (~769-776), its two
  listeners in `UI.init()` (~5413-5415), the call to `renderInviteToast`
  if any remain.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (pure deletion).

- [ ] **Step 1: Delete `Lounge.acceptInvite`/`dismissInvite`**

Delete (`index.html:3645-3656`):

```js
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

- [ ] **Step 2: Remove `pendingInvite` from state**

In `state.lounge` (updated in Task 8, Step 1 to `{ room: null,
pendingInvite: null }`), remove `pendingInvite` so it reads:

```js
  lounge: { room: null },
```

- [ ] **Step 3: Delete `UI.renderInviteToast`**

Delete (`index.html:4299-4307`):

```js
  renderInviteToast() {
    const toast = document.getElementById('invite-toast');
    if (!toast) return;
    const pending = state.lounge.pendingInvite;
    toast.hidden = !pending;
    if (pending) {
      document.getElementById('invite-toast-text').textContent = `${pending.friendName} invited you to their study room!`;
    }
  },
```

- [ ] **Step 4: Delete the toast's listeners in `UI.init()`**

Delete (`index.html:5413-5415`):

```js
    // ---- Invite toast ----
    document.getElementById('invite-toast-accept').addEventListener('click', () => Lounge.acceptInvite());
    document.getElementById('invite-toast-dismiss').addEventListener('click', () => Lounge.dismissInvite());
```

- [ ] **Step 5: Delete the toast's HTML and CSS**

Delete the HTML block (`index.html:1788-1794`):

```html
<div id="invite-toast" class="invite-toast" hidden role="status">
  <p id="invite-toast-text"></p>
  <div class="invite-toast__actions">
    <button type="button" class="btn btn-primary" id="invite-toast-accept">Accept</button>
    <button type="button" class="btn btn-secondary" id="invite-toast-dismiss">Dismiss</button>
  </div>
</div>
```

Delete its CSS rules (find with `grep -n "\.invite-toast" index.html` —
covers the `.invite-toast`, `.invite-toast__actions`, and its
mobile-breakpoint override, roughly `index.html:769-776`).

- [ ] **Step 6: Verify**

Run: `grep -n "pendingInvite\|invite-toast\|acceptInvite\|dismissInvite\|renderInviteToast" index.html`

Expected: no output.

`npm run dev`, load the app, confirm zero console errors and the Lounge
lobby/room/mission flow (use "Join Room" to get a bot roster, start a
sprint, let it complete) still works exactly as before — this task
touches nothing in the room/bot/mission code path.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "chore: remove dead invite-toast simulation leftovers"
```

---

### Task 10: Extend `server/test/e2e.js` with notification and chat coverage

Locks down the backend contract the frontend now depends on (Tasks 7/8),
using the existing two-user (Alice/Bob) test pattern already in this file.

**Files:**
- Modify: `server/test/e2e.js` (append to the existing `main()` function,
  before its final summary/exit block)

**Interfaces:**
- Consumes: the existing `api(token, method, path, body)`,
  `connectSocket(token)`, `waitFor(events, predicate)`, `assert(cond,
  label)` helpers already defined in this file.
- Produces: nothing (leaf task).

- [ ] **Step 1: Read the existing file to find the insertion point**

Run: `grep -n "^async function main\|passed\|failed\|process.exit" server/test/e2e.js | tail -20`

Find where the Alice/Bob accounts are created and where friendship is
already established in the existing test (if the file's existing scope
doesn't yet cover friend-accept, add that first — reuse the same
`api()`/`connectSocket()` helpers already in the file, following its
existing style exactly).

- [ ] **Step 2: Add notification coverage**

Append, using whatever variable names the existing file already uses for
Alice/Bob's tokens, ids, and sockets (e.g. `aliceToken`, `bobId`,
`bobSocket.events` — match the file's existing naming exactly rather than
introducing new names):

```js
  // ---- notifications ----
  const notifBefore = await api(bobToken, 'GET', '/api/notifications');
  const unreadBefore = notifBefore.json.unreadCount;
  await api(aliceToken, 'POST', '/api/friends/requests', { toUserId: bobId }).catch(() => {});
  await waitFor(bobSocket.events, (e) => e.type === 'notification', 4000);
  const notifAfter = await api(bobToken, 'GET', '/api/notifications');
  assert(notifAfter.json.unreadCount >= unreadBefore, 'notification unread count increases on a new event');
  const firstUnread = notifAfter.json.notifications.find((n) => !n.readAt);
  if (firstUnread) {
    const readRes = await api(bobToken, 'POST', `/api/notifications/${firstUnread.id}/read`);
    assert(readRes.status === 200, 'marking a single notification read succeeds');
  }
  const markAllRes = await api(bobToken, 'POST', '/api/notifications/read-all');
  assert(markAllRes.status === 200, 'mark-all-read succeeds');
  const notifFinal = await api(bobToken, 'GET', '/api/notifications');
  assert(notifFinal.json.unreadCount === 0, 'unread count is zero after mark-all-read');
```

- [ ] **Step 3: Add chat coverage**

Append immediately after (this assumes Alice and Bob are already friends
by this point in the file — if not, accept the pending request first
using the same pattern as the file's existing friend-request test):

```js
  // ---- chat ----
  const sendRes = await api(aliceToken, 'POST', `/api/conversations/${bobId}/messages`, { text: 'hello from e2e' });
  assert(sendRes.status === 201, 'sending a message to a friend succeeds');
  await waitFor(bobSocket.events, (e) => e.type === 'message' && e.message.text === 'hello from e2e', 4000);
  const historyRes = await api(bobToken, 'GET', `/api/conversations/${aliceId}/messages`);
  assert(historyRes.json.messages.some((m) => m.text === 'hello from e2e'), 'message appears in conversation history');
  const readRes2 = await api(bobToken, 'POST', `/api/conversations/${aliceId}/read`);
  assert(readRes2.status === 200, 'marking a conversation read succeeds');

  // ---- chat with a non-friend is rejected ----
  await api(aliceToken, 'DELETE', `/api/friends/${bobId}`);
  const blockedRes = await api(aliceToken, 'POST', `/api/conversations/${bobId}/messages`, { text: 'should fail' });
  assert(blockedRes.status === 403, 'messaging a non-friend is rejected with 403');
```

- [ ] **Step 4: Run the full e2e suite**

From `server/`, with the server running in one terminal (`npm run dev`),
run in another: `node test/e2e.js`

Expected: every assertion prints `ok`, script exits `0`. If the "chat with
a non-friend" block runs before other tests that assume Alice and Bob are
still friends, move it to the very end of `main()` (it deliberately
removes their friendship as its final act).

- [ ] **Step 5: Commit**

```bash
git add server/test/e2e.js
git commit -m "test: add notification and chat coverage to e2e suite"
```

---

### Task 11: Full regression pass

Final task — no new code, just proving the whole migration works together
and nothing else broke.

**Files:** none (verification only).

- [ ] **Step 1: Backend regression**

From `server/`: delete `data.db*` to start from a clean database (`rm -f
data.db data.db-shm data.db-wal`), then `npm run dev` in one terminal and
`node test/e2e.js` in another.

Expected: all assertions pass against a fresh database.

- [ ] **Step 2: Two-profile manual pass**

With the server running, open two browser profiles (or a normal window +
private window), Alice and Bob:

1. Fresh boot with no prior choice shows the auth modal in both. Continue
   as Guest in one — dismisses it, existing local guest data (if any)
   unchanged.
2. Sign up as Alice and Bob. Search for each other by username, send and
   accept a friend request. Both see each other in their friends list;
   the header online-count reflects both connected (at least `2`).
3. Close Bob's tab. Alice's online-count decrements and Bob's row flips
   to "Offline" within a few seconds.
4. Send a DM from Alice to Bob (with Bob reconnected); confirm it arrives
   live in Bob's open chat, and as a notification badge if his chat isn't
   open.
5. Log out and back in as Alice in a fresh private window; confirm her
   friends and message history are still there (cross-device proof — nothing
   about this data lived in that browser's localStorage).

- [ ] **Step 3: Confirm untouched features still work**

In the same session: create/complete a Timer pomodoro, add/complete a
Task, change a Settings value, toggle dark mode. For Study Lounge, use
**"Join Room"** (not "Create Room") with any code — this is the only path
that populates bot members (Task 1 restored the helper it depends on,
`_simFields()`; "Create Room" only ever adds yourself and can never start
a mission, which requires 2+ members) — then start a sprint and let it run
to completion. All of this must behave exactly as it does right after
Task 1's fixes — none of it was touched by Tasks 2 through 10.

- [ ] **Step 4: Console and layout check**

With devtools open throughout steps 2-3, confirm zero uncaught console
errors at any point. Resize to 375px and 1280px widths with the auth
modal, friends drawer, and notification menu each open in turn — no
horizontal overflow.

- [ ] **Step 5: Final commit (if any fixups were needed)**

If step 1-4 surfaced any small fixes, commit them individually with a
`fix:` message describing exactly what broke. If everything passed
as-is, there is nothing to commit for this task.
