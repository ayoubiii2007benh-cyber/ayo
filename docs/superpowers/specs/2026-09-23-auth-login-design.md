# Local Auth & Login System — Design Spec

**Status:** Autonomous execution authorized by user ("do all the work dont ask me"). Third and final of the three remaining sub-projects (Lounge redesign → Friends/Chat → Profile+Avatar → **Auth**, per the decomposition agreed earlier). Applies to `index.html`.

## 0. Framing decision (made autonomously, no backend exists)

The original request asks for "Login / Sign Up / Continue as Guest" with "Username, Email, and Password" and "session persistence with clean state separation." There is no server anywhere in this app — everything is `localStorage`/IndexedDB in one browser. A literal "real accounts" framing would be dishonest (passwords aren't verifiable against anything but another localStorage entry on the same device, anyone with devtools access can bypass it).

**Decision:** build this as a **local, device-only profile switcher** that uses the vocabulary the request asked for (Login/Sign Up/Guest, username/email/password fields) but is honest about what it actually is: a way to keep separate people's stats, tasks, profile, and Lounge data apart when they share one browser/computer — not real authentication. This mirrors the app's existing honesty pattern (Leaderboard/Lounge already carry "Demo Mode" disclosures). The Auth modal states this plainly in one line of copy.

This resolves "clean state separation" as the literal architectural requirement: each account's data must not leak into another's.

## 1. Data model

Two **always-global, never-namespaced** localStorage keys (see §2 for why "global" matters):

```js
// "pomodoroAccounts": Account[]
{ id, username, email, passwordHash, createdAt }

// "pomodoroActiveAccount": string | 'guest' | absent
// absent  = never chosen yet (first-ever visit) -> show the Auth modal at boot
// 'guest' = explicitly using the app without an account -> unprefixed keys (today's behavior)
// <id>    = logged into that account -> keys prefixed with that id
```

`passwordHash` is a simple non-cryptographic string hash (`simpleHash`, 31-multiplier rolling hash) used only to gate switching between local profiles on the same device. It is explicitly not a security boundary — documented as a code comment at its definition, matching the app's existing honesty-over-illusion pattern.

`state` gains nothing new — `activeAccountId` is a module-level variable (`let activeAccountId = null`), not part of the serializable `state` object, since it must be resolved before `state` is initialized from storage at all.

## 2. Storage namespacing (the "clean separation" mechanism)

Every existing `Storage.load*`/`save*` function already funnels through two low-level helpers:

```js
function safeParse(key) { ... localStorage.getItem(key) ... }
function safeSet(key, value) { ... localStorage.setItem(key, ...) ... }
```

Namespacing is inserted at this single chokepoint instead of touching each of the ~10 individual load/save functions (settings, tasks, stats, profile, dailyHistory, loungeFriends, loungeChats, musicSettings, themeSettings, chatSettings, chatHistory):

```js
function storageKey(key) {
  return (activeAccountId && activeAccountId !== 'guest') ? `acct:${activeAccountId}:${key}` : key;
}
function safeParse(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    ...
  }
}
function safeSet(key, value) {
  try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch {}
}
```

Two new helpers bypass namespacing entirely, for the two account-registry keys themselves (they must always be readable regardless of who is "logged in"):

```js
function safeParseGlobal(key) { ...localStorage.getItem(key) unprefixed... }
function safeSetGlobal(key, value) { ...localStorage.setItem(key, ...) unprefixed... }
```

`activeAccountId` is read from `pomodoroActiveAccount` at the very first line of the boot sequence, before `State.init()` (which triggers the first `Storage.load*` calls). Guest/never-chosen both resolve to unprefixed keys, so **all of today's existing data for the current user of this app remains exactly where it is and keeps working** — this is the safest possible default and requires no migration step.

## 3. Auth flows

```js
const Auth = {
  loadAccounts() { return Array.isArray(safeParseGlobal('pomodoroAccounts')) ? ... : []; },
  saveAccounts(accounts) { safeSetGlobal('pomodoroAccounts', accounts); },

  signUp(username, email, password) {
    // trims/validates non-empty; rejects duplicate email (case-insensitive)
    // creates account, persists, logs in, seeds new account's profile.username
  },
  logInWithCredentials(identifier, password) {
    // matches username OR email (case-insensitive) + simpleHash(password) check
  },
  logIn(accountId) {
    activeAccountId = accountId;
    safeSetGlobal('pomodoroActiveAccount', accountId);
    location.reload(); // simplest, most robust way to re-init every subsystem under the new namespace
  },
  continueAsGuest() { safeSetGlobal('pomodoroActiveAccount', 'guest'); /* no reload needed: guest = already-running unprefixed keys */ },
  logOut() { localStorage.removeItem('pomodoroActiveAccount'); location.reload(); }, // back to "never chosen" -> modal reappears
};
```

`location.reload()` on login/signup/logout is a deliberate simplicity choice: manually re-running every subsystem's init in place (Timer, Lounge engine, IndexedDB media, music player, AI chat) would be far more error-prone than letting the page's single already-correct boot sequence run again under the new namespace.

Dismissing the Auth modal (Escape/backdrop) without an explicit choice is treated the same as "Continue as Guest" (no reload — the app is already running under the guest/unprefixed keys by default) so a first-time visitor is never functionally blocked, and isn't re-nagged on the next reload once dismissed once.

## 4. UI

**Auth modal** (`dialog#auth-modal`, native `<dialog>`, matches existing settings/chat/profile modal conventions): one-line honesty disclosure, Log In / Sign Up tabs, Continue as Guest button. Shown automatically at boot only when `pomodoroActiveAccount` has never been set.

**Header:** no new element needed — the existing `#user-avatar`/`#user-name-display` (built in the Profile Modal sub-project) already serves as "current user's profile trigger."

**Profile modal:** gains one new button in view mode, "Switch Account," which clears `pomodoroActiveAccount` and reloads — this re-shows the Auth modal, i.e. acts as logout. Placed alongside the existing "Edit Profile" button since the Profile Modal is already the established home for account-related actions.

## 5. Non-goals

- No password reset/recovery flow (no email delivery exists to send one to).
- No cross-device sync — this is explicitly single-device, single-browser.
- No account deletion UI (out of scope, not asked for).
- No migration wizard for moving existing guest data into a newly created account — a first-time user who signs up starts that account with fresh/empty data, and their preexisting guest data remains intact and reachable by choosing Guest again. This is called out in the modal's disclosure copy implicitly by keeping guest data separate, not merged.

## 6. Regression guarantees

- `storageKey()` for the guest/never-chosen case returns the key unchanged — every existing `Storage.*` function's on-disk key is byte-identical to before this change when no account is active, so no migration is needed and no existing data is at risk of appearing lost.
- No existing `Storage.*` function signature changes.
- IndexedDB (`LocalMediaDB`, used for profile/background photos) is NOT namespaced by account in this pass — it is keyed by autoincrement id referenced from the (now-namespaced) profile/settings records, so each account's namespaced profile record simply points to its own IndexedDB row(s). This is sufficient for clean separation without touching `LocalMediaDB` itself.

## 7. Testing plan (manual — Playwright)

1. Fresh boot (no `pomodoroActiveAccount` key) shows the Auth modal automatically.
2. Continue as Guest closes it, no reload, existing data (stats/tasks/profile) is unchanged.
3. Sign Up with a new account reloads and boots into empty/default state (new namespace); creating a task and reloading again shows it persisted under that account.
4. Switch Account (from Profile modal) returns to the Auth modal; choosing Guest again shows the original pre-auth data completely intact.
5. Log back into the created account shows that account's own task, not guest's.
6. Duplicate-email signup is rejected with an inline error; wrong-password login is rejected with an inline error.
7. Full regression: Timer/Lounge/Friends/Profile-photo-upload all still function normally under both guest and an account namespace; no console errors; no layout overflow at 375/1280px with the Auth modal open.
