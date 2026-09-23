# Social Study Room & Group Accountability ("Study Lounge") — Design Spec

**Status:** Approved by user in conversation 2026-09-23. Applies to the existing `index.html` (single-file vanilla HTML/CSS/JS Pomodoro + Planner app, no build step, no git repo). This spec is additive — it extends the existing `state`/`Storage`/`Timer`/`Missions`/`Skills`/`UI` architecture; nothing existing is rewritten from scratch.

**Explicit scope decisions from brainstorming (do not relitigate mid-implementation):**
- **No real networking.** No PeerJS/WebRTC, no Firebase/Supabase, no signaling server, no API keys. Friends and group members are entirely a client-side simulation ("bots"). This is the primary deliverable, not a fallback — real cross-device sync is an explicit non-goal (§9), not a later phase implied by this spec.
- **Single-file.** All new code lives in `index.html`, following the exact module style already used by `Timer`/`Planner`/`Missions`/`LiveUsers`/`AIChat` (a plain object namespace with methods, module-scoped `const`s, no imports/build step).
- The existing `LiveUsers` object (a fake presence counter running its own `setTimeout` loop, fully decoupled from `Timer`) is the direct prior-art pattern for the new bot simulation engine — same independence guarantee, same "no real backend, just a believable local simulation" spirit.

## 1. New/changed data shapes

```js
// state.profile (existing key "profile", extended)
{
  username: 'You',
  avatar: '🎯',   // emoji string from a small curated set (see §6); '' falls back to first-letter avatar (today's behavior)
}

// state.stats (existing key "stats", extended — new field only)
{
  ...existing fields unchanged...,
  restMinutesToday: 0,   // NEW: clampInt(raw.restMinutesToday, 0, 999999, 0) in Storage.loadStats, default 0
}

// NEW localStorage key "loungeFriends" — array, persisted
[
  { id: 'f_xxx', name: 'Sam', avatar: '🌙' }   // status is never persisted; simulated live (see §3)
]

// state.lounge — NEW, in-memory only except `.friends` (loaded from "loungeFriends")
{
  friends: [ { id, name, avatar, status: 'idle'|'focusing'|'resting'|'offline', remainingMs } ],
  room: null | {
    code: 'FOCUS-9X',
    goal: '',                 // free text, display-only, set at creation, optional
    hostId: 'self' | memberId,
    members: [
      {
        id: 'self' | 'bot_xxx',
        isSelf: boolean,
        name, avatar,
        status: 'focusing' | 'resting' | 'idle',
        remainingMs: number,          // self: mirrors state.timer.remainingMs; bots: own simulated countdown
        studyMinutesToday: number,    // self: mirrors state.stats.focusMinutesToday; bots: simulated accumulator
        restMinutesToday: number,     // self: mirrors state.stats.restMinutesToday; bots: simulated
        pomodorosToday: number,       // self: mirrors state.stats.pomodorosCompletedToday; bots: simulated
        missionProgress: number,      // pomodoros completed toward the *active* mission's target; reset per mission
        missionState: 'pending' | 'checked-in' | 'abandoned',
      },
    ],
    mission: null | {
      targetPomodoros: number,   // 1-4, chosen when starting the sprint
      state: 'active' | 'completed',  // an abandoned member does not change this; see §4
    },
  },
}
```

**Persistence:** only `profile` (existing key, extended) and `loungeFriends` (new key) are saved to `localStorage`, using the existing `safeParse`/`safeSet` helpers and the existing `Storage.loadProfile`/`saveProfile` pattern (extended to include/validate `avatar`), plus new `Storage.loadLoungeFriends`/`saveLoungeFriends`. **`state.lounge.room` is never persisted** — reloading the page always exits any active room. Timer state and stats are completely unaffected by this (they already persist independently).

Skill Level is **never stored** on the profile or on a member — it is always computed live via `Skills.progress(state.stats.focusXP).level` for the self row, and via a per-bot simulated `focusXP`-equivalent (a small in-memory number, not persisted) for bot rows. A small lookup maps level → title for display:
```js
Lounge.TITLES = [
  { min: 1,  title: 'Novice' },
  { min: 4,  title: 'Apprentice' },
  { min: 7,  title: 'Focused' },
  { min: 11, title: 'Disciplined' },
  { min: 16, title: 'Master' },
  { min: 21, title: 'Grandmaster' },
];
Lounge.titleForLevel(level) // returns the highest-min entry <= level
```

## 2. Room codes

```js
Lounge.CODE_WORDS = ['FOCUS','FLOW','GRIND','DEEP','CALM','ZEN','LOCK','PUSH'];
Lounge.generateRoomCode()  // e.g. "FOCUS-9X": random word + '-' + 2 random uppercase alnum chars
```
No collision checking — there is no shared namespace in demo mode, so collisions are not observable.

**Bot member defaults** (used by both `joinRoom` and `inviteFriendToRoom`, so behavior is identical either way):
```js
Lounge.DEMO_BOT_POOL = [
  { name: 'Sam',  avatar: '🌙' }, { name: 'Alex', avatar: '⚡' }, { name: 'Robin', avatar: '🌱' },
  { name: 'Jordan', avatar: '📚' }, { name: 'Casey', avatar: '🔥' }, { name: 'Riley', avatar: '☁️' },
];
```
`joinRoom` picks 2-4 entries at random (without repeats) from this pool for the mock roster; `inviteFriendToRoom` uses the specific friend's own name/avatar instead. Every new bot member starts with `status: 'focusing'` and `remainingMs` randomized to between 10% and 90% of `state.settings.pomodoro * 60000` (so members are never in visual lockstep with each other or with self); their simulated rest-phase length uses `state.settings.shortBreak * 60000` the same way. `studyMinutesToday`/`restMinutesToday`/`pomodorosToday` all start at 0; `missionProgress: 0`, `missionState: 'pending'` (or `'checked-in'`/inapplicable if no mission is active yet — a member who joins after a mission has already started simply joins as `'pending'` against that mission's existing target).

## 3. `Lounge` module — public API

```js
Lounge.init()                          // called once from State.init(): loads friends, renders lobby
Lounge.addFriend(name, avatar)         // demo: pushes a new mock friend {id: makeId(), name, avatar}; saves
Lounge.removeFriend(id)
Lounge.inviteFriendToRoom(friendId)    // if a room is active: adds that friend as a room member (bot-driven)
Lounge.createRoom(goalText)            // generates code; self becomes host + sole member; starts engine
Lounge.joinRoom(codeText)              // demo: any non-empty, trimmed code is accepted; populates 2-4 random
                                        //  mock bot members alongside self; starts engine
Lounge.leaveRoom()                     // clears state.lounge.room, stops the engine; never touches state.timer/state.stats
Lounge.startMission(targetPomodoros)   // requires an active room and no mission already 'active'
Lounge.cancelMission()                 // clears mission back to null unconditionally (recovers from an abandonment)
Lounge.onOwnPomodoroCompleted()        // called from Timer.complete(); advances self's mission progress/check-in
Lounge.onOwnBreakCompleted(minutes)    // called from Timer.complete(); increments state.stats.restMinutesToday
```

Internal:
```js
Lounge._tick()                  // 1s interval body: advance bot countdowns/status, sync self's row from state.timer/state.stats, evaluate mission
Lounge._startEngine()           // setInterval(Lounge._tick, 1000) if not already running (mirrors LiveUsers._start)
Lounge._stopEngine()            // clearInterval; called from leaveRoom()
Lounge._checkMissionCompletion()// if every member.missionState === 'checked-in' -> mission.state = 'completed'; award + celebrate; reset mission to null
```

**Engine lifecycle:** the interval runs whenever `state.lounge.room !== null` (regardless of which top-level view is currently showing, so the header chip and any member statuses stay live even while the user is on the Dashboard). It is completely separate from `Timer._intervalId` (250ms) — satisfies the "state independence" requirement: network/bot activity can never stall or skip the real countdown, and pausing/leaving the Lounge never touches `state.timer`.

## 4. Bot simulation & mission rules

Each tick, for every **bot** member:
- If `status === 'focusing'` or `'resting'`, decrement `remainingMs` by 1000; on reaching 0, flip phase (focus → rest → focus, mirroring `Timer._advanceMode`'s cadence) and bump the relevant accumulator (`pomodorosToday`/`studyMinutesToday` on finishing a focus phase, `restMinutesToday` on finishing a rest phase).
- Small random chance (~5% per tick, only when not already idle) to drop to `'idle'` for a randomized 3-8 second pause, then resume the phase it was in beforehand with its `remainingMs` unchanged — this is what makes the roster feel alive rather than mechanical.
- **Mission participation:** only evaluated the instant a bot finishes a focus phase while `room.mission?.state === 'active'` and that bot's `missionState === 'pending'`: increment `missionProgress`; if `missionProgress >= mission.targetPomodoros`, resolve the bot as `'checked-in'` (85% chance) or `'abandoned'` (15% chance) — the abandon branch exists specifically so the "member abandoned" UX path is reachable in the demo, not left dead code.

For the **self** member, `status`/`remainingMs`/`studyMinutesToday`/`restMinutesToday`/`pomodorosToday` are pure reads from `state.timer`/`state.stats` every tick — never simulated. Self's mission check-in is **not** tick-driven; it happens exactly once, synchronously, from `Lounge.onOwnPomodoroCompleted()` (called from `Timer.complete()`): if a mission is active and self's `missionState === 'pending'`, increment `missionProgress`, and mark `'checked-in'` once the target is reached. Self can also explicitly click **"Give Up"** in the mission panel, which sets `missionState = 'abandoned'` directly (never automatic/inferred).

**Completion rule:** `_checkMissionCompletion()` runs after any member's `missionState` changes. Mission completes (`state = 'completed'`, then reward + reset to `null`) only if **every** member's `missionState === 'checked-in'`. An `'abandoned'` member makes 100% completion mathematically impossible for that sprint — the mission simply stays `active` forever showing a persistent alert ("Sam abandoned the sprint") until someone calls `Lounge.cancelMission()`, which is the only way out. This directly satisfies the spec's "does not complete until 100% finish" rule without needing a separate abandoned-mission status.

## 5. UI/UX

**Navigation:** add `<button class="nav-link" id="nav-lounge">Study Lounge</button>` to the existing `<nav class="top-nav">`, and add `'lounge'` to the two existing `['dashboard','reports','leaderboard'].forEach(...)` view-switch arrays (view-toggle logic and the nav-link active-state logic) — no new view-switching mechanism.

**New view `#view-lounge`** (same `.glass` card convention as the other views), two mutually-exclusive states:
- **Lobby** (`state.lounge.room === null`): a "Friends" card (list of friends with live-simulated status dot + "Invite to Room" button, disabled when no room is active; an "Add Friend" mini-form: name text input + a small emoji `<select>` reusing the same emoji set as the profile picker) side-by-side with a "Room" card (Create Room: optional goal text input + Create button, showing the generated code + a Copy button afterward; Join Room: code text input + Join button with inline validation text using the existing `.field-hint` styling).
- **Active room** (`state.lounge.room !== null`): header row (code as a monospace pill, Copy button, goal text, "Leave Room" button); member list `<ul>` — each item shows avatar, name, `Lv. N · Title` badge, a colored status tag (🟢 Focusing `MM:SS` / ☕ Resting / ⚪ Idle, per spec), and today's study/rest/pomodoro numbers; a mission panel below — when idle, a target-picker (1-4) + "Start Sprint" button; when active, a `checked-in/total` progress readout, one chip per member (`In Progress` / `Checked In` / `Abandoned`), a "Give Up" button (self only, enabled only while self is `pending`), a "Cancel Sprint" button, and an alert banner slot that appears only while at least one member is `'abandoned'`.

**Header chip:** a new `#lounge-chip` element added into `.header-right` next to the existing `#live-users`, hidden (`[hidden]`) unless `state.lounge.room` is set, showing `Group: FOCUS-9X · 3 active` (`active` = count of members not `'idle'`/`'offline'`); clicking it switches the current view to `'lounge'`. Styled as a sibling rule to `.live-users` (same pill look), not a shared/refactored class, to avoid touching existing CSS behavior.

**Avatar/emoji picker:** a single shared constant, `Lounge.PROFILE_EMOJI = ['🎯','🔥','🌙','⚡','📚','🌱','☁️','🚀','🧠','☕','🎧','🏆']`, backs both pickers so they're visually consistent: it's rendered as a row of buttons extended into the existing name-edit popover in the header (the same interaction that already lets you click the avatar/name to edit `username`) — clicking one sets `state.profile.avatar` immediately, saved via the existing `Storage.saveProfile` call already made when that popover closes — and as the `<select>` options for the "Add Friend" mini-form in the Lounge lobby.

**Demo-mode disclosure:** the Lounge lobby header always shows a small subtitle: *"Demo Mode — friends and group members here are simulated locally; nothing is sent over the network."* This mirrors the existing Leaderboard view's own disclosure that it has no real accounts/multi-user data.

**Confetti (new, tiny, no library):**
```js
Confetti.burst()   // creates a fixed-position overlay div, spawns ~24 absolutely-positioned colored <span>s
                   // with randomized horizontal offset/rotation/color, animated via one shared CSS @keyframes
                   // fall-and-fade rule, removes the overlay via setTimeout after ~1.6s
```
**Sound:** mission completion reuses the existing `SoundFX.playCompletionSound()` — no new audio asset.

**Rewards:** on mission completion, `state.stats.disciplineXP += 50` (same magnitude as the existing daily-mission bonus at the current `Missions.checkAndAwardDaily`), persisted via the existing `Storage.saveStats`, followed by the existing `UI.renderMissions()`/`UI.renderSkills()`/dashboard-stat renders so the new Level/XP is reflected everywhere immediately, including the Lounge member list's own badge for self.

## 6. Responsiveness

`#view-lounge`'s two-card lobby layout and the active-room member list use CSS grid/flexbox with the same breakpoints already established in the file (600px/480px) — stacking to a single column below 600px, matching how `#stats-dashboard` and `.reports-summary` already collapse. The header chip follows `.live-users`' existing mobile behavior (label text hidden below 480px, dot+count retained). No new horizontal-scroll containers are introduced.

## 7. Hooks into existing code (exact integration points)

- `Timer.complete()`: inside the existing `if (state.timer.mode === 'pomodoro') { Planner.onPomodoroCompleted(); }` branch, add `Lounge.onOwnPomodoroCompleted();` right after it. Add `else { Lounge.onOwnBreakCompleted(state.settings[state.timer.mode]); }` for the break case — `state.timer.mode` at this point is still the just-finished mode (`'shortBreak'`/`'longBreak'`), read before `_advanceMode` changes it, exactly mirroring how `Planner.onPomodoroCompleted()` already reads `state.settings.pomodoro` for its own duration. No existing branch's logic changes.
- `State.init()`-equivalent boot sequence: add `state.lounge = { friends: Storage.loadLoungeFriends(), room: null }; Lounge.init();` alongside the existing `state.profile = Storage.loadProfile();` line.
- `UI.renderProfile()`: extended to also render `state.profile.avatar` (emoji) when set, falling back to today's first-letter behavior when empty.
- The two existing `['dashboard','reports','leaderboard'].forEach(...)` view-array call sites both gain `'lounge'`.

## 8. Security

- `Lounge.addFriend`/room goal text/room code inputs are all rendered via `textContent`, never `innerHTML` — consistent with the rest of the file.
- Room "join" accepts any non-empty trimmed string as a code (since there is no real backend to validate against); it is trimmed/length-capped (e.g. 20 chars) and displayed as-is, never executed or interpolated into markup.
- No new network requests, no new third-party scripts, no new permissions requested.

## 9. Non-goals / known limitations (stated upfront)

- No real cross-device networking of any kind — this is the explicit, approved scope, not a stopgap. A future real-sync layer (PeerJS/WebRTC or Firebase/Supabase) is out of scope for this spec entirely.
- Only one active room at a time (matches a single local user with one browser tab).
- No push notifications or background-tab wake-up for lounge/mission events — requires the tab to be open, the same constraint the existing `Timer` already has.
- The active room does not survive a page reload; the friends list and profile do.
- Bot "skill level"/XP is simulated in memory for display purposes only — it is not real progression and is not persisted.

## 10. Regression guarantees

- All new code is additive: new `Lounge`/`Confetti` namespaces, new `state.lounge` slice, one new field on `state.stats` (`restMinutesToday`, safely defaulted for old saved data), one new field on `state.profile` (`avatar`, safely defaulted to `''`), two new small persisted-key helpers (`loadLoungeFriends`/`saveLoungeFriends`).
- No existing `Storage.*` key is renamed, removed, or restructured; no existing function signature changes.
- `Timer.*` gains only the two call-outs described in §7 — no existing branch's control flow is altered.
- Switching views away from `'lounge'`, or `Lounge.leaveRoom()`, never calls anything on `Timer` and never mutates `state.stats`/`state.settings`.
- The existing 2x2 dashboard grid (Timer, Missions, Today's Plan, AI Assistant) is untouched; the Lounge lives entirely in its own top-level view, reached only via the new nav link or the header chip.

## 11. Testing plan (manual — no automated test runner exists in this repo)

1. Load `index.html`; confirm existing header avatar/name, Dashboard/Reports/Leaderboard nav, Timer, Missions & Skills, and AI Assistant all behave exactly as before.
2. Click "Study Lounge" → lobby renders (Friends card + Room card + Demo Mode disclosure), no console errors.
3. Add 1-2 friends; confirm they appear with a live (simulated) status dot that changes over time.
4. Create a room → code appears in the header chip and in the active-room header; self appears as the sole member with correct avatar/name/level.
5. Invite a friend → member list grows; join flow independently verified by entering an arbitrary code in a second scenario and confirming 2-4 mock members populate.
6. Start a 1-Pomodoro sprint; go to Dashboard, start and complete the real Timer (shorten the Pomodoro length in Settings to speed this up); confirm self's mission chip flips to "Checked In" without affecting the Timer's own display/controls.
7. Let the scenario run until a bot completes its sprint too; confirm mission completes with confetti, completion sound, and a `+50` Discipline XP bump visible in the Missions & Skills card and in the Lounge member list's own level badge.
8. Run it again until RNG produces a bot abandonment; confirm the alert banner appears, mission does not complete even after other members check in, and "Cancel Sprint" recovers the room to idle.
9. While in an active room, reload the page: confirm the room is gone (expected) but Timer state, stats, profile, and friends list are all intact.
10. Resize to 375px width: confirm the Lounge view and header chip reflow with no horizontal scroll, and the existing dashboard grid is unaffected.
