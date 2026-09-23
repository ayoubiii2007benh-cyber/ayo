# Study Lounge (Social Study Room & Group Accountability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** One evolving file (`index.html`), no test framework, no build step, not a git repo yet. "Tests" are concrete Playwright browser interactions/assertions run against the file over `http://` (Playwright blocks `file://` for some APIs used here — clipboard, AudioContext autoplay — so serve it, e.g. `npx --yes serve -l 8080 .` or `python -m http.server 8080`, then navigate Playwright to `http://localhost:8080/`). Prefer inline execution by one agent holding the whole file in context over parallel per-task subagents — every task edits the same file, several tasks touch the same `UI`/`Lounge` object literals, and Task 2's engine is read directly by Tasks 4 and 5.

**Goal:** Add a fully client-side-simulated "Study Lounge" — user profile avatar, friends list, room create/join with codes, a live group member dashboard, and an "all must finish" co-op mission — to the existing single-file Pomodoro app, without any real networking and without touching the existing Timer/Missions/Music/AI/Leaderboard features.

**Architecture:** Purely additive to `index.html`. One new namespace, `Lounge` (built up across Tasks 1, 2 and 5, same object literal), plus a tiny `Confetti` helper (Task 5). One new state slice `state.lounge` (`{ friends, room }`, only `.friends` persisted). Two extended existing pieces of state: `state.profile` (+`avatar`) and `state.stats` (+`restMinutesToday`). A new top-level view `#view-lounge` follows the exact `nav-link`/`view-*` pattern `#view-reports`/`#view-leaderboard` already use. The bot/friend simulation runs on its own `setInterval(1000ms)`, modeled directly on the existing `LiveUsers` object — fully decoupled from `Timer`'s own 250ms interval.

**Tech Stack:** Same as existing — vanilla ES6+, `localStorage`, Web Audio (reuses existing `SoundFX`), no new external dependencies, no build step.

**Spec:** `docs/superpowers/specs/2026-09-23-study-lounge-design.md`

## Global Constraints

- Still exactly one file: `index.html`. No build step, no new external dependencies.
- No real networking of any kind (no PeerJS/WebRTC/Firebase/Supabase/signaling/API keys) — friends and group members are entirely a local simulation. This is final scope, not a fallback.
- Never use `innerHTML`/`insertAdjacentHTML` for any user-controlled value (friend names, room codes, goal text) — `textContent`/DOM `createElement` only, per the existing codebase's pattern.
- `state.lounge.room` is **never** persisted to `localStorage`; only `profile` (extended) and the new `loungeFriends` key persist. Reloading the page always exits any active room.
- No Lounge lifecycle action (create/join/leave/switch room, start/cancel mission) may ever call `Timer.pause()/reset()/start()` or mutate `state.stats`/`state.settings` — Timer and stats are completely independent of group state.
- A co-op mission completes only when **every** member's `missionState === 'checked-in'`. An `'abandoned'` member blocks completion until `Lounge.cancelMission()` is called — there is no separate "abandoned mission" status.
- Group mission completion reward is exactly `state.stats.disciplineXP += 50` (same magnitude as the existing daily-mission bonus), once per completed mission.
- Room/join codes accept any non-empty trimmed string (demo mode, no real backend to validate against), capped to 20 characters, always rendered via `textContent`.
- The Lounge lobby must always show the verbatim disclosure: *"Demo Mode — friends and group members here are simulated locally; nothing is sent over the network."*

## Review Focus

- **Re-creating/switching rooms leaks a duplicate simulation interval.** Calling `createRoom`/`joinRoom` while already in a room, or leaving and creating repeatedly, must never end up with two `setInterval` loops running at once — covered in Task 2.
- **Mission state doesn't reset between consecutive sprints.** Starting a second sprint right after one completes (or after a cancel) must zero every member's `missionProgress`/`missionState` — a stale `'checked-in'`/`'abandoned'` from the previous sprint must not silently auto-complete or block the new one — covered in Task 5.
- **"Give Up" stays clickable after self already checked in.** A user who already finished their pomodoros for the sprint must not be able to retroactively abandon it — covered in Task 5.
- **Escape while editing the profile only hides the name input, not the new emoji picker row**, leaving a dangling open picker behind the re-shown name display — covered in Task 1.
- **Day rollover while a room/mission is active.** `state.stats` resetting `pomodorosCompletedToday`/`focusMinutesToday`/`restMinutesToday` at midnight must not throw, corrupt `state.lounge.room`, or reset mission progress (mission progress is sprint-scoped, not day-scoped) — covered in Task 5.

---

## Shared additions (referenced by multiple tasks below)

```js
// state.profile (existing key "profile", extended) — Task 1
{ username: 'You', avatar: '' }   // avatar: emoji string or '' (falls back to first-letter avatar)

// state.stats (existing key "stats", extended) — Task 1
{ ...existing fields..., restMinutesToday: 0 }

// NEW localStorage key "loungeFriends" — Task 1/2
[ { id, name, avatar } ]   // status is never persisted, always simulated live

// state.lounge — Task 1 (shape) / Task 2 (room lifecycle) / Task 5 (mission fields)
{
  friends: [ { id, name, avatar, status: 'idle'|'focusing'|'resting'|'offline', remainingMs, simXP } ],
  room: null | {
    code, goal, hostId,
    members: [ {
      id, isSelf, name, avatar,
      status: 'focusing'|'resting'|'idle',
      remainingMs, studyMinutesToday, restMinutesToday, pomodorosToday,
      simXP,                       // bots only; self reads Skills.progress(state.stats.focusXP) directly
      missionProgress, missionState: 'pending'|'checked-in'|'abandoned',
    } ],
    mission: null | { targetPomodoros, state: 'active'|'completed' },
  },
}
```

---

### Task 1: Profile avatar + `restMinutesToday` + friends persistence (data layer)

**Files:**
- Modify: `index.html` — `Storage.loadProfile`/`saveProfile` (~line 1340), `Storage.loadStats` (~line 1256), `Storage` end (add `loadLoungeFriends`/`saveLoungeFriends`, after `saveDailyHistory`, ~line 1363), `state` literal (~line 1192-1206), `State.rolloverStatsIfNewDay` (~line 1688), `State.init` (~line 1712), header HTML profile widget (~line 794-798), CSS near `.user-profile__*` (~line 475-495), `UI.renderProfile()` (~line 2693), `UI.init()` name-edit wiring (~line 3331-3356), new `Lounge` namespace (introduced here with just `PROFILE_EMOJI`, grown in later tasks).

**Interfaces:**
- Consumes: nothing new — `safeParse`/`safeSet`, `clampInt`, existing `Storage.loadProfile` call sites.
- Produces: `Lounge.PROFILE_EMOJI` (array of 12 emoji strings), `Storage.loadLoungeFriends()/saveLoungeFriends(friends)`, `state.profile.avatar`, `state.stats.restMinutesToday`, `state.lounge = { friends: [], room: null }`.

- [ ] **Step 1: Add the `Lounge` namespace with just the shared emoji constant.** Insert immediately after the `LiveUsers` object's closing `};` (right before `/* ============================== AIChat (Google Gemini) ============================== */`):

  ```js
  /* ============================== Lounge (Study Lounge, simulated) ============================== */
  // No backend exists — friends and group members are entirely a local simulation. Honest, not a stopgap.
  const Lounge = {
    PROFILE_EMOJI: ['🎯', '🔥', '🌙', '⚡', '📚', '🌱', '☁️', '🚀', '🧠', '☕', '🎧', '🏆'],

    init() {
      state.lounge.friends = Storage.loadLoungeFriends();
    },
  };
  ```

- [ ] **Step 2: Extend `state.profile`/`state.stats`/`state.lounge` shapes and their `Storage` load/save.**

  Replace:
  ```js
    loadProfile() {
    const raw = safeParse('profile') || {};
    const name = typeof raw.username === 'string' ? raw.username.trim().slice(0, 24) : '';
    return { username: name || 'You' };
  },
  saveProfile(p) { safeSet('profile', p); },
  ```
  With:
  ```js
    loadProfile() {
    const raw = safeParse('profile') || {};
    const name = typeof raw.username === 'string' ? raw.username.trim().slice(0, 24) : '';
    const avatar = typeof raw.avatar === 'string' ? raw.avatar.trim().slice(0, 4) : '';
    return { username: name || 'You', avatar };
  },
  saveProfile(p) { safeSet('profile', p); },

  loadLoungeFriends() {
    const raw = safeParse('loungeFriends');
    const arr = Array.isArray(raw) ? raw : [];
    return arr
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string' && f.name.trim())
      .map((f) => ({
        id: f.id,
        name: f.name.trim().slice(0, 24),
        avatar: typeof f.avatar === 'string' && f.avatar.trim() ? f.avatar.trim().slice(0, 4) : '🙂',
      }))
      .slice(0, 50);
  },
  saveLoungeFriends(friends) { safeSet('loungeFriends', friends); },
  ```

  In `Storage.loadStats()`, add a new field right after `focusMinutesToday`:
  ```js
      focusMinutesToday: clampInt(raw.focusMinutesToday, 0, 999999, 0),
      restMinutesToday: clampInt(raw.restMinutesToday, 0, 999999, 0),
  ```

  In the top-level `const state = {...}` literal, add after `currentView: 'dashboard',`:
  ```js
    lounge: { friends: [], room: null },
  ```

  In `State.rolloverStatsIfNewDay()`, inside the "new day" branch, add `restMinutesToday: 0,` next to the other daily resets:
  ```js
        pomodorosCompletedToday: 0,
        tasksCompletedToday: 0,
        focusMinutesToday: 0,
        restMinutesToday: 0,
        disciplineBonusAwardedToday: false,
  ```

  In `State.init()`, add right after `state.profile = Storage.loadProfile();`:
  ```js
      Lounge.init();
  ```

- [ ] **Step 3: Add the avatar picker to the header profile widget (HTML).** Replace:
  ```html
      <div class="user-profile" id="user-profile">
        <button type="button" class="user-profile__avatar" id="user-avatar" aria-label="Edit your name">Y</button>
        <button type="button" class="user-profile__name" id="user-name-display" aria-label="Edit your name">You</button>
        <input type="text" class="user-profile__name-input" id="user-name-input" maxlength="24" aria-label="Your name" hidden>
      </div>
  ```
  With:
  ```html
      <div class="user-profile" id="user-profile">
        <button type="button" class="user-profile__avatar" id="user-avatar" aria-label="Edit your name">Y</button>
        <button type="button" class="user-profile__name" id="user-name-display" aria-label="Edit your name">You</button>
        <input type="text" class="user-profile__name-input" id="user-name-input" maxlength="24" aria-label="Your name" hidden>
        <div class="user-profile__emoji-picker" id="user-profile-emoji-picker" role="group" aria-label="Choose an avatar" hidden></div>
      </div>
  ```

- [ ] **Step 4: Add CSS for the emoji picker and the emoji-sized avatar variant.** Add after the existing `@media (max-width: 560px) { .user-profile__name, .user-profile__name-input { display: none; } }` block:

  ```css
  .user-profile__avatar--emoji { font-size: 1.05rem; background: rgba(36, 31, 28, 0.06); color: inherit; }
  .user-profile__emoji-picker {
    position: absolute; top: 100%; right: 0; margin-top: 6px; z-index: 20;
    display: flex; flex-wrap: wrap; gap: 4px; width: 168px; padding: 8px;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
  }
  .user-profile__emoji-picker button {
    border: none; background: transparent; font-size: 1.1rem; width: 32px; height: 32px;
    border-radius: var(--radius-sm); cursor: pointer;
  }
  .user-profile__emoji-picker button:hover { background: rgba(36, 31, 28, 0.08); }
  ```
  `.user-profile` also needs `position: relative;` for the picker to anchor correctly — add it to the existing rule:
  ```css
  .user-profile { display: flex; align-items: center; gap: 8px; position: relative; }
  ```

- [ ] **Step 5: Render the avatar (emoji or first-letter fallback).** Replace `UI.renderProfile()`:
  ```js
    renderProfile() {
      const avatar = document.getElementById('user-avatar');
      const nameDisplay = document.getElementById('user-name-display');
      const name = state.profile.username;
      if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || 'Y';
      if (nameDisplay) nameDisplay.textContent = name;
    },
  ```
  With:
  ```js
    renderProfile() {
      const avatar = document.getElementById('user-avatar');
      const nameDisplay = document.getElementById('user-name-display');
      const name = state.profile.username;
      if (avatar) {
        const emoji = state.profile.avatar;
        avatar.textContent = emoji || (name.trim().charAt(0).toUpperCase() || 'Y');
        avatar.classList.toggle('user-profile__avatar--emoji', !!emoji);
      }
      if (nameDisplay) nameDisplay.textContent = name;
    },
  ```

- [ ] **Step 6: Wire the picker into the existing edit flow, fix the avatar-wiping bug, and fix Escape.** Replace the whole name-edit block in `UI.init()`:
  ```js
      const startEditingName = () => {
        const nameInput = document.getElementById('user-name-input');
        const nameDisplay = document.getElementById('user-name-display');
        nameInput.value = state.profile.username;
        nameDisplay.hidden = true;
        nameInput.hidden = false;
        nameInput.focus();
        nameInput.select();
      };
      const commitName = () => {
        const nameInput = document.getElementById('user-name-input');
        const nameDisplay = document.getElementById('user-name-display');
        const name = nameInput.value.trim().slice(0, 24) || 'You';
        state.profile = { username: name };
        Storage.saveProfile(state.profile);
        UI.renderProfile();
        nameInput.hidden = true;
        nameDisplay.hidden = false;
      };
      document.getElementById('user-avatar').addEventListener('click', startEditingName);
      document.getElementById('user-name-display').addEventListener('click', startEditingName);
      document.getElementById('user-name-input').addEventListener('blur', commitName);
      document.getElementById('user-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitName(); }
        if (e.key === 'Escape') { e.preventDefault(); document.getElementById('user-name-input').hidden = true; document.getElementById('user-name-display').hidden = false; }
      });
  ```
  With:
  ```js
      const emojiPicker = document.getElementById('user-profile-emoji-picker');
      Lounge.PROFILE_EMOJI.forEach((emoji) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = emoji;
        btn.setAttribute('aria-label', `Use ${emoji} as your avatar`);
        btn.addEventListener('click', () => {
          state.profile = { ...state.profile, avatar: emoji };
          Storage.saveProfile(state.profile);
          UI.renderProfile();
        });
        emojiPicker.appendChild(btn);
      });

      const startEditingName = () => {
        const nameInput = document.getElementById('user-name-input');
        const nameDisplay = document.getElementById('user-name-display');
        nameInput.value = state.profile.username;
        nameDisplay.hidden = true;
        nameInput.hidden = false;
        emojiPicker.hidden = false;
        nameInput.focus();
        nameInput.select();
      };
      const closeNameEditor = () => {
        document.getElementById('user-name-input').hidden = true;
        document.getElementById('user-name-display').hidden = false;
        emojiPicker.hidden = true;
      };
      const commitName = () => {
        const nameInput = document.getElementById('user-name-input');
        const name = nameInput.value.trim().slice(0, 24) || 'You';
        state.profile = { ...state.profile, username: name };
        Storage.saveProfile(state.profile);
        UI.renderProfile();
        closeNameEditor();
      };
      document.getElementById('user-avatar').addEventListener('click', startEditingName);
      document.getElementById('user-name-display').addEventListener('click', startEditingName);
      document.getElementById('user-name-input').addEventListener('blur', commitName);
      document.getElementById('user-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitName(); }
        if (e.key === 'Escape') { e.preventDefault(); closeNameEditor(); }
      });
  ```
  Note `commitName` now spreads `...state.profile` so editing the name never wipes a previously chosen `avatar` (this was the bug: the original replaced the whole object with `{ username: name }`).

- [ ] **Step 7: Verify via Playwright** (serve the directory first, per the Execution note).
  - `browser_navigate` to the served URL. `browser_evaluate`: `() => Storage.loadStats().restMinutesToday === 0` → `true`. `browser_evaluate`: `() => { Storage.saveLoungeFriends([{id:'f1',name:'Sam',avatar:'🌙'}]); return Storage.loadLoungeFriends(); }` → `[{id:'f1',name:'Sam',avatar:'🌙'}]`.
  - Click `#user-avatar` → confirm `#user-name-input` and `#user-profile-emoji-picker` both become visible. Click one emoji button (e.g. `🔥`) → confirm `#user-avatar` immediately shows `🔥`. Press `Enter` → confirm both the input and the picker hide again (Review Focus: Escape/close fully hides both, not just the input — repeat this check pressing `Escape` instead of `Enter` after reopening).
  - Reload the page → confirm `#user-avatar` still shows `🔥` (persistence) and `browser_evaluate(() => state.profile.avatar)` → `'🔥'`.
  - Edit the name only (don't touch emoji) → confirm the avatar emoji is *not* wiped (`state.profile.avatar` unchanged) — this is the regression the old `commitName` had.
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 8: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add profile avatar picker and lounge data-layer scaffolding"
  ```

---

### Task 2: `Lounge` core — friends/room CRUD + bot simulation engine

**Files:**
- Modify: `index.html` — grow the `Lounge` object literal from Task 1 (same object, insert more methods before its closing `};`).

**Interfaces:**
- Consumes: `Lounge.PROFILE_EMOJI` (Task 1), `state.lounge` (Task 1), `state.timer`/`state.stats`/`state.settings` (existing), `makeId()`, `clampInt()`, `Skills.progress()`, `Timer.formatTime()` (existing).
- Produces: `Lounge.TITLES`, `Lounge.titleForLevel(level)`, `Lounge.DEMO_BOT_POOL`, `Lounge.CODE_WORDS`, `Lounge.generateRoomCode()`, `Lounge.statusLabel(member)`, `Lounge.addFriend(name, avatar)`, `Lounge.removeFriend(id)`, `Lounge.inviteFriendToRoom(friendId)`, `Lounge.createRoom(goalText)`, `Lounge.joinRoom(codeText)`, `Lounge.leaveRoom()`, `Lounge._startEngine()`, `Lounge._stopEngine()`, `Lounge._tick()` — all consumed by Tasks 3/4/5.

- [ ] **Step 1: Add friend list management.** Insert into the `Lounge` object, after `init()`:

  ```js
    addFriend(name, avatar) {
      const trimmed = (name || '').trim().slice(0, 24);
      if (!trimmed) return false;
      const emoji = Lounge.PROFILE_EMOJI.includes(avatar) ? avatar : Lounge.PROFILE_EMOJI[0];
      state.lounge.friends.push({ id: makeId(), name: trimmed, avatar: emoji });
      Storage.saveLoungeFriends(state.lounge.friends);
      return true;
    },
    removeFriend(id) {
      state.lounge.friends = state.lounge.friends.filter((f) => f.id !== id);
      Storage.saveLoungeFriends(state.lounge.friends);
    },
  ```

- [ ] **Step 2: Add room-code generation, titles, and the bot pool.** Insert after `removeFriend`:

  ```js
    CODE_WORDS: ['FOCUS', 'FLOW', 'GRIND', 'DEEP', 'CALM', 'ZEN', 'LOCK', 'PUSH'],
    generateRoomCode() {
      const word = Lounge.CODE_WORDS[Math.floor(Math.random() * Lounge.CODE_WORDS.length)];
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const suffix = chars[Math.floor(Math.random() * chars.length)] + chars[Math.floor(Math.random() * chars.length)];
      return `${word}-${suffix}`;
    },

    TITLES: [
      { min: 1, title: 'Novice' },
      { min: 4, title: 'Apprentice' },
      { min: 7, title: 'Focused' },
      { min: 11, title: 'Disciplined' },
      { min: 16, title: 'Master' },
      { min: 21, title: 'Grandmaster' },
    ],
    titleForLevel(level) {
      let best = Lounge.TITLES[0].title;
      for (const t of Lounge.TITLES) { if (level >= t.min) best = t.title; }
      return best;
    },

    DEMO_BOT_POOL: [
      { name: 'Sam', avatar: '🌙' }, { name: 'Alex', avatar: '⚡' }, { name: 'Robin', avatar: '🌱' },
      { name: 'Jordan', avatar: '📚' }, { name: 'Casey', avatar: '🔥' }, { name: 'Riley', avatar: '☁️' },
    ],

    statusLabel(member) {
      if (member.status === 'focusing') return `🟢 Focusing (${Timer.formatTime(member.remainingMs)})`;
      if (member.status === 'resting') return '☕ Resting (Break)';
      return '⚪ Idle / Ready';
    },
  ```

- [ ] **Step 3: Add member factories and room lifecycle.** Insert after `titleForLevel`/`statusLabel`:

  ```js
    _makeSelfMember() {
      return {
        id: 'self', isSelf: true, name: state.profile.username, avatar: state.profile.avatar || '🙂',
        status: state.timer.running ? (state.timer.mode === 'pomodoro' ? 'focusing' : 'resting') : 'idle',
        remainingMs: state.timer.remainingMs,
        studyMinutesToday: state.stats.focusMinutesToday,
        restMinutesToday: state.stats.restMinutesToday,
        pomodorosToday: state.stats.pomodorosCompletedToday,
        missionProgress: 0, missionState: 'pending',
      };
    },
    _makeBotMember(name, avatar) {
      const focusMs = state.settings.pomodoro * 60000;
      return {
        id: `bot_${makeId()}`, isSelf: false, name, avatar,
        status: 'focusing',
        remainingMs: Math.round(focusMs * (0.1 + Math.random() * 0.8)),
        studyMinutesToday: 0, restMinutesToday: 0, pomodorosToday: 0,
        simXP: Math.floor(Math.random() * 300),
        missionProgress: 0, missionState: 'pending',
      };
    },
    _randomBotRoster(count) {
      const pool = [...Lounge.DEMO_BOT_POOL];
      const picked = [];
      while (picked.length < count && pool.length) {
        picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      return picked.map((p) => Lounge._makeBotMember(p.name, p.avatar));
    },

    createRoom(goalText) {
      if (state.lounge.room) Lounge.leaveRoom();
      state.lounge.room = {
        code: Lounge.generateRoomCode(),
        goal: (goalText || '').trim().slice(0, 80),
        hostId: 'self',
        members: [Lounge._makeSelfMember()],
        mission: null,
      };
      Lounge._startEngine();
      return state.lounge.room.code;
    },
    joinRoom(codeText) {
      const code = (codeText || '').trim().slice(0, 20);
      if (!code) return false;
      if (state.lounge.room) Lounge.leaveRoom();
      const botCount = 2 + Math.floor(Math.random() * 3); // 2-4
      state.lounge.room = {
        code, goal: '', hostId: `bot_${makeId()}`,
        members: [Lounge._makeSelfMember(), ...Lounge._randomBotRoster(botCount)],
        mission: null,
      };
      Lounge._startEngine();
      return true;
    },
    inviteFriendToRoom(friendId) {
      if (!state.lounge.room) return false;
      const friend = state.lounge.friends.find((f) => f.id === friendId);
      if (!friend) return false;
      state.lounge.room.members.push(Lounge._makeBotMember(friend.name, friend.avatar));
      return true;
    },
    leaveRoom() {
      Lounge._stopEngine();
      state.lounge.room = null;
    },
  ```

- [ ] **Step 4: Add the independent 1-second simulation engine.** Insert after `leaveRoom`:

  ```js
    _engineTimer: null,
    _startEngine() {
      if (Lounge._engineTimer !== null) return;
      Lounge._engineTimer = setInterval(Lounge._tick, 1000);
    },
    _stopEngine() {
      clearInterval(Lounge._engineTimer);
      Lounge._engineTimer = null;
    },
    _tick() {
      const room = state.lounge.room;
      if (!room) return;
      for (const m of room.members) {
        if (m.isSelf) {
          m.status = state.timer.running ? (state.timer.mode === 'pomodoro' ? 'focusing' : 'resting') : 'idle';
          m.remainingMs = state.timer.remainingMs;
          m.studyMinutesToday = state.stats.focusMinutesToday;
          m.restMinutesToday = state.stats.restMinutesToday;
          m.pomodorosToday = state.stats.pomodorosCompletedToday;
          continue;
        }
        Lounge._tickBot(m, room);
      }
    },
    _tickBot(m, room) {
      if (m.status === 'idle') {
        m._idleTicksLeft -= 1;
        if (m._idleTicksLeft <= 0) Lounge._resumeBot(m);
        return;
      }
      if (Math.random() < 0.05) {
        m._resumeStatus = m.status;
        m._idleTicksLeft = 3 + Math.floor(Math.random() * 6); // 3-8 seconds (ticks are 1s)
        m.status = 'idle';
        return;
      }
      m.remainingMs -= 1000;
      if (m.remainingMs > 0) return;
      if (m.status === 'focusing') {
        m.pomodorosToday += 1;
        m.studyMinutesToday += state.settings.pomodoro;
        m.simXP = (m.simXP || 0) + 20;
        m.status = 'resting';
        m.remainingMs = state.settings.shortBreak * 60000;
      } else {
        m.restMinutesToday += state.settings.shortBreak;
        m.status = 'focusing';
        m.remainingMs = state.settings.pomodoro * 60000;
      }
    },
    _resumeBot(m) {
      m.status = m._resumeStatus || 'focusing';
      m._resumeStatus = null;
    },
  ```

  (`remainingMs` is left untouched while idle, exactly as specified — only `_idleTicksLeft` counts down.)

- [ ] **Step 5: Verify via Playwright.**
  - `browser_evaluate`: `Lounge.addFriend('Sam', '🌙')` then `Lounge.addFriend('', '🌙')` (rejected, empty name) → `state.lounge.friends.length === 1`.
  - `browser_evaluate`: `Lounge.createRoom('Deep Work')` → returns a string matching `/^[A-Z]+-[A-Z0-9]{2}$/`; `state.lounge.room.members.length === 1` and `state.lounge.room.members[0].isSelf === true`.
  - `browser_evaluate`: `Lounge.joinRoom('ANYCODE')` → `state.lounge.room.members.length` is between 3 and 5 (self + 2-4 bots), `state.lounge.room.code === 'ANYCODE'`.
  - **Review Focus (no interval leak on switch):** `browser_evaluate`: capture `Lounge._engineTimer`, call `Lounge.createRoom('a')`, capture the new timer id, call `Lounge.createRoom('b')` again, confirm the timer id changed and `clearInterval` was effectively called on the old one — verify indirectly by asserting `Lounge._engineTimer` is a single non-null value each time and calling `Lounge.leaveRoom()` sets it back to `null`. Then call `Lounge.leaveRoom()` when no room exists — confirm no throw.
  - **Review Focus (switching rooms leaves Timer/stats alone):** start the real Timer (`Timer.start()`), note `state.timer.remainingMs`, call `Lounge.createRoom('x')` then `Lounge.leaveRoom()`, confirm `state.timer.running === true` and `state.timer.remainingMs` only changed by real elapsed time (not reset).
  - Wait ~2.5 real seconds (Playwright `browser_wait_for` on a short time), then `browser_evaluate(() => state.lounge.room.members.find(m => !m.isSelf).remainingMs)` twice a second apart — confirm the bot's `remainingMs` is decreasing (engine tick is actually running).
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 6: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add Lounge friends/room CRUD and bot simulation engine"
  ```

---

### Task 3: Lobby UI (nav, view scaffold, friends card, create/join room)

**Files:**
- Modify: `index.html` — `<nav class="top-nav">` (~line 810-814), insert `#view-lounge` before `</main>` (~line 929-930), CSS (new block near `#view-reports, #view-leaderboard`, ~line 510-532), `UI` object (add `renderLoungeLobby`, `renderLoungeFriends`, `selectView` update, ~line 2693-2728), `UI.init()` (nav wiring ~line 3320, new Lounge lobby wiring appended near the end before `UI.renderAppearanceUI();` ~line 3590).

**Interfaces:**
- Consumes: `Lounge.addFriend/removeFriend/inviteFriendToRoom/createRoom/joinRoom/leaveRoom/statusLabel/titleForLevel/PROFILE_EMOJI` (Task 2), `setFieldStatus` (existing).
- Produces: `UI.renderLoungeView()` (dispatches to lobby or active-room render — active-room body added in Task 4), `UI.renderLoungeLobby()`, `UI.renderLoungeFriends()`.

- [ ] **Step 1: Add the nav link and `#view-lounge` scaffold (HTML).** Replace:
  ```html
  <nav class="top-nav" aria-label="Main navigation">
    <button type="button" class="nav-link" id="nav-dashboard" aria-current="page">Dashboard</button>
    <button type="button" class="nav-link" id="nav-reports">Reports</button>
    <button type="button" class="nav-link" id="nav-leaderboard">Leaderboard</button>
  </nav>
  ```
  With:
  ```html
  <nav class="top-nav" aria-label="Main navigation">
    <button type="button" class="nav-link" id="nav-dashboard" aria-current="page">Dashboard</button>
    <button type="button" class="nav-link" id="nav-reports">Reports</button>
    <button type="button" class="nav-link" id="nav-leaderboard">Leaderboard</button>
    <button type="button" class="nav-link" id="nav-lounge">Study Lounge</button>
  </nav>
  ```
  Then insert, right after `#view-leaderboard`'s closing `</div>` and before `</main>`:
  ```html
  <div id="view-lounge" class="glass" aria-label="Study Lounge" hidden>
    <div id="lounge-lobby">
      <h2>Study Lounge</h2>
      <p class="field-hint">Demo Mode — friends and group members here are simulated locally; nothing is sent over the network.</p>
      <div class="lounge-lobby-grid">
        <section aria-label="Friends">
          <h3>Friends</h3>
          <ul class="lounge-friends-list" id="lounge-friends-list"></ul>
          <form id="lounge-add-friend-form" class="lounge-inline-form">
            <input type="text" id="lounge-friend-name-input" maxlength="24" placeholder="Friend's name" aria-label="Friend's name" required>
            <select id="lounge-friend-avatar-select" aria-label="Friend's avatar"></select>
            <button type="submit" class="btn btn-secondary">Add Friend</button>
          </form>
        </section>
        <section aria-label="Room">
          <h3>Create a Room</h3>
          <form id="lounge-create-room-form" class="lounge-inline-form">
            <input type="text" id="lounge-goal-input" maxlength="80" placeholder="Room goal (optional)" aria-label="Room goal">
            <button type="submit" class="btn btn-primary">Create Room</button>
          </form>
          <h3>Join a Room</h3>
          <form id="lounge-join-room-form" class="lounge-inline-form">
            <input type="text" id="lounge-join-code-input" maxlength="20" placeholder="Room code" aria-label="Room code" required>
            <button type="submit" class="btn btn-secondary">Join Room</button>
          </form>
          <span class="field-status" id="status-lounge-join"></span>
        </section>
      </div>
    </div>
    <div id="lounge-active" hidden></div>
  </div>
  ```
  (`#lounge-active`'s inner content is built entirely in Task 4/5; leaving it as an empty container here keeps this task's markup diff focused on the lobby.)

- [ ] **Step 2: Add CSS for the lobby grid and friend rows.** Add after the existing `.live-users`/`@media (max-width: 460px)` block, before `/* ---------- AI chat ---------- */`:
  ```css
  /* ---------- study lounge ---------- */
  #view-lounge {
    max-width: 1040px; margin: 0 auto; border-radius: var(--radius-lg);
    padding: clamp(22px, 4vw, 30px); box-shadow: var(--shadow-md);
  }
  #view-lounge h2 { font-size: 1.1rem; margin-bottom: 4px; }
  #view-lounge h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 18px 0 10px; font-weight: 700; }
  .lounge-lobby-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px; }
  @media (max-width: 700px) { .lounge-lobby-grid { grid-template-columns: 1fr; } }
  .lounge-friends-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .lounge-friend-item {
    display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: var(--radius-md);
    background: rgba(36, 31, 28, 0.04); font-size: 0.88rem;
  }
  .lounge-friend-item__avatar { font-size: 1.1rem; }
  .lounge-friend-item__name { flex: 1; font-weight: 600; }
  .lounge-friend-item__status { font-size: 0.76rem; color: var(--text-muted); white-space: nowrap; }
  .lounge-inline-form { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .lounge-inline-form input[type="text"] {
    flex: 1 1 140px; min-width: 0; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: var(--radius-sm); background: var(--surface); color: var(--text); font-size: 0.88rem;
  }
  .lounge-inline-form select {
    padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface); color: var(--text); font-size: 1rem;
  }
  ```

- [ ] **Step 3: Add `UI.renderLoungeFriends()`, `UI.renderLoungeLobby()`, `UI.renderLoungeView()`, and populate the avatar `<select>`.** Add these methods to the `UI` object, right after `renderProfile()`:

  ```js
    renderLoungeFriends() {
      const list = document.getElementById('lounge-friends-list');
      if (!list) return;
      list.replaceChildren();
      for (const f of state.lounge.friends) {
        const li = document.createElement('li');
        li.className = 'lounge-friend-item';
        const avatar = document.createElement('span');
        avatar.className = 'lounge-friend-item__avatar';
        avatar.textContent = f.avatar;
        const name = document.createElement('span');
        name.className = 'lounge-friend-item__name';
        name.textContent = f.name;
        const status = document.createElement('span');
        status.className = 'lounge-friend-item__status';
        status.textContent = f.status ? Lounge.statusLabel(f) : '⚪ Idle / Ready';
        const inviteBtn = document.createElement('button');
        inviteBtn.type = 'button';
        inviteBtn.className = 'btn btn-secondary';
        inviteBtn.textContent = 'Invite to Room';
        inviteBtn.disabled = !state.lounge.room;
        inviteBtn.addEventListener('click', () => {
          Lounge.inviteFriendToRoom(f.id);
          UI.renderLoungeView();
        });
        li.append(avatar, name, status, inviteBtn);
        list.appendChild(li);
      }
    },

    renderLoungeLobby() {
      UI.renderLoungeFriends();
      const select = document.getElementById('lounge-friend-avatar-select');
      if (select && !select.childElementCount) {
        for (const emoji of Lounge.PROFILE_EMOJI) {
          const opt = document.createElement('option');
          opt.value = emoji;
          opt.textContent = emoji;
          select.appendChild(opt);
        }
      }
    },

    renderLoungeView() {
      const lobby = document.getElementById('lounge-lobby');
      const active = document.getElementById('lounge-active');
      if (!lobby || !active) return;
      const inRoom = !!state.lounge.room;
      lobby.hidden = inRoom;
      active.hidden = !inRoom;
      if (inRoom) UI.renderLoungeRoom(); else UI.renderLoungeLobby();
    },
  ```

  Note: `UI.renderLoungeRoom()` doesn't exist yet — it's added in Task 4. Since `renderLoungeView()` only calls it when `state.lounge.room` is truthy, and no room can exist until Task 4/UI wiring lets a user create one through the UI, this doesn't break anything yet, but to keep every task's Playwright pass green **add a temporary one-line stub right before `renderLoungeView`** in this task:
  ```js
    renderLoungeRoom() { /* replaced in Task 4 */ },
  ```

- [ ] **Step 4: Wire `selectView` and nav-link click handlers.** In `UI.selectView(view)`, change the array literal from:
  ```js
      ['dashboard', 'reports', 'leaderboard'].forEach((v) => {
  ```
  to:
  ```js
      ['dashboard', 'reports', 'leaderboard', 'lounge'].forEach((v) => {
  ```
  and add a matching render call right after the existing `if (view === 'leaderboard') UI.renderLeaderboard();`:
  ```js
      if (view === 'lounge') UI.renderLoungeView();
  ```
  In `UI.init()`, change the nav-wiring array the same way:
  ```js
      ['dashboard', 'reports', 'leaderboard', 'lounge'].forEach((v) => {
        document.getElementById(`nav-${v}`).addEventListener('click', () => UI.selectView(v));
      });
  ```

- [ ] **Step 5: Wire the Add Friend / Create Room / Join Room forms.** Add this block in `UI.init()`, right after the Appearance-tab listeners and before the final `UI.renderAppearanceUI();` call:

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
      document.getElementById('lounge-create-room-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const goalInput = document.getElementById('lounge-goal-input');
        Lounge.createRoom(goalInput.value);
        goalInput.value = '';
        UI.renderLoungeView();
      });
      document.getElementById('lounge-join-room-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const codeInput = document.getElementById('lounge-join-code-input');
        const status = document.getElementById('status-lounge-join');
        if (Lounge.joinRoom(codeInput.value)) {
          codeInput.value = '';
          setFieldStatus(status, '', '');
          UI.renderLoungeView();
        } else {
          setFieldStatus(status, 'Please enter a room code.', 'error');
        }
      });
      UI.renderLoungeLobby();
  ```

- [ ] **Step 6: Verify via Playwright.**
  - Navigate to the served URL. Confirm `#nav-lounge` exists and clicking it shows `#view-lounge` (not `hidden`) while `#view-dashboard` becomes hidden, and `#nav-lounge` gets `aria-current="page"`.
  - Confirm the Demo Mode sentence is present verbatim (`browser_evaluate` reading `textContent`).
  - Fill the Add Friend form (name "Sam", pick an emoji) and submit → confirm a new `.lounge-friend-item` row appears with that name/emoji and an "Invite to Room" button that is `disabled` (no room yet).
  - Submit Create Room with a goal → confirm `#lounge-lobby` becomes hidden and `#lounge-active` becomes visible (it will render empty/mostly-empty until Task 4, that's expected).
  - Regression: click `#nav-dashboard`, `#nav-reports`, `#nav-leaderboard` — confirm all three still work exactly as before, and the existing 2×2 dashboard grid (Timer/Missions/Today's Plan/AI Assistant) is unaffected.
  - Resize the viewport to 375px width — confirm `.lounge-lobby-grid` stacks to one column and there is no horizontal scrollbar.
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 7: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add Study Lounge nav tab, friends list, and create/join room UI"
  ```

---

### Task 4: Active-room member dashboard + header chip (live rendering)

**Files:**
- Modify: `index.html` — header HTML (`.header-right`, ~line 793-807), CSS (near `.live-users`, ~line 550), `UI` object (replace the `renderLoungeRoom` stub from Task 3, add `renderLoungeChip`, ~line 2693 area), `UI.init()` (append chip-refresh + Leave Room wiring near the Lounge block from Task 3).

**Interfaces:**
- Consumes: `state.lounge.room.members`, `Lounge.statusLabel`, `Lounge.titleForLevel`, `Lounge.leaveRoom` (Task 2), `Skills.progress` (existing).
- Produces: `UI.renderLoungeRoom()` (real implementation), `UI.renderLoungeChip()`.

- [ ] **Step 1: Add the header chip markup and CSS.** Replace:
  ```html
      <div id="live-users" class="live-users" aria-hidden="true">
        <span class="live-users__dot"></span>
        <span id="live-users-count" class="live-users__count">—</span>
        <span class="live-users__label">online</span>
      </div>
      <button id="settings-btn" type="button" class="icon-btn" aria-label="Open settings" aria-haspopup="dialog">&#9881;</button>
  ```
  With:
  ```html
      <div id="live-users" class="live-users" aria-hidden="true">
        <span class="live-users__dot"></span>
        <span id="live-users-count" class="live-users__count">—</span>
        <span class="live-users__label">online</span>
      </div>
      <button type="button" id="lounge-chip" class="live-users lounge-chip" hidden></button>
      <button id="settings-btn" type="button" class="icon-btn" aria-label="Open settings" aria-haspopup="dialog">&#9881;</button>
  ```
  Add CSS right after the `.live-users` block's `@media (max-width: 460px)` rule:
  ```css
  .lounge-chip { border: 1px solid var(--border); cursor: pointer; font-weight: 700; color: var(--text); }
  .lounge-chip:hover { background: rgba(36, 31, 28, 0.08); }
  ```

- [ ] **Step 2: Add the room header, member list, and mission-panel container to `#lounge-active`.** Replace the empty `<div id="lounge-active" hidden></div>` from Task 3 with:
  ```html
  <div id="lounge-active" hidden>
    <div class="lounge-active-header">
      <div>
        <span class="lounge-room-code" id="lounge-room-code"></span>
        <button type="button" class="btn btn-secondary" id="lounge-copy-code">Copy</button>
        <p class="field-hint" id="lounge-room-goal"></p>
      </div>
      <button type="button" class="btn btn-secondary" id="lounge-leave-room">Leave Room</button>
    </div>
    <ul class="lounge-members-list" id="lounge-members-list"></ul>
    <div id="lounge-mission"></div>
  </div>
  ```
  Add CSS after the friend-item rules from Task 3:
  ```css
  .lounge-active-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .lounge-room-code { font-family: ui-monospace, monospace; font-size: 1.1rem; font-weight: 800; letter-spacing: 0.04em; margin-right: 8px; }
  .lounge-members-list { list-style: none; margin: 0 0 20px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .lounge-member-item {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: var(--radius-md);
    background: rgba(36, 31, 28, 0.04); font-size: 0.86rem; flex-wrap: wrap;
  }
  .lounge-member-item__avatar { font-size: 1.2rem; }
  .lounge-member-item__name { font-weight: 700; min-width: 70px; }
  .lounge-member-item__level { color: var(--text-muted); font-size: 0.76rem; white-space: nowrap; }
  .lounge-member-item__status { white-space: nowrap; }
  .lounge-member-item__metrics { margin-left: auto; color: var(--text-muted); font-size: 0.78rem; white-space: nowrap; }
  @media (max-width: 600px) {
    .lounge-member-item { font-size: 0.8rem; }
    .lounge-member-item__metrics { margin-left: 0; flex-basis: 100%; }
  }
  ```

- [ ] **Step 3: Implement the real `renderLoungeRoom` and `renderLoungeChip`.** Replace the Task 3 stub:
  ```js
    renderLoungeRoom() { /* replaced in Task 4 */ },
  ```
  With:
  ```js
    renderLoungeRoom() {
      const room = state.lounge.room;
      if (!room) return;
      document.getElementById('lounge-room-code').textContent = room.code;
      document.getElementById('lounge-room-goal').textContent = room.goal || 'No goal set.';

      const list = document.getElementById('lounge-members-list');
      list.replaceChildren();
      for (const m of room.members) {
        const li = document.createElement('li');
        li.className = 'lounge-member-item';

        const avatar = document.createElement('span');
        avatar.className = 'lounge-member-item__avatar';
        avatar.textContent = m.avatar;

        const name = document.createElement('span');
        name.className = 'lounge-member-item__name';
        name.textContent = m.name;

        const level = m.isSelf ? Skills.progress(state.stats.focusXP).level : Skills.progress(m.simXP || 0).level;
        const levelEl = document.createElement('span');
        levelEl.className = 'lounge-member-item__level';
        levelEl.textContent = `Lv. ${level} · ${Lounge.titleForLevel(level)}`;

        const status = document.createElement('span');
        status.className = 'lounge-member-item__status';
        status.textContent = Lounge.statusLabel(m);

        const metrics = document.createElement('span');
        metrics.className = 'lounge-member-item__metrics';
        const h = Math.floor(m.studyMinutesToday / 60), min = m.studyMinutesToday % 60;
        metrics.textContent = `${h > 0 ? `${h}h ${min}m` : `${min}m`} study · ${m.restMinutesToday}m rest · ${m.pomodorosToday} 🍅`;

        li.append(avatar, name, levelEl, status, metrics);
        list.appendChild(li);
      }
    },

    renderLoungeChip() {
      const chip = document.getElementById('lounge-chip');
      if (!chip) return;
      const room = state.lounge.room;
      if (!room) { chip.hidden = true; return; }
      chip.hidden = false;
      const activeCount = room.members.filter((m) => m.status !== 'idle').length;
      chip.replaceChildren();
      const dot = document.createElement('span');
      dot.className = 'live-users__dot';
      const text = document.createElement('span');
      text.className = 'live-users__count';
      text.textContent = `Group: ${room.code} · ${activeCount} active`;
      chip.append(dot, text);
    },
  ```

- [ ] **Step 4: Refresh the chip/room view on every engine tick, and wire Copy/Leave.** `Lounge._tick()` currently only mutates `state.lounge.room`; it has no rendering responsibility (matching the existing `LiveUsers._tick()`/`_render()` split). Add a thin render hook instead: change the end of `Lounge._tick()` (Task 2) from just updating members to also calling the UI refresh, by adding one line at the very end of the method body:
  ```js
    _tick() {
      const room = state.lounge.room;
      if (!room) return;
      for (const m of room.members) {
        if (m.isSelf) {
          m.status = state.timer.running ? (state.timer.mode === 'pomodoro' ? 'focusing' : 'resting') : 'idle';
          m.remainingMs = state.timer.remainingMs;
          m.studyMinutesToday = state.stats.focusMinutesToday;
          m.restMinutesToday = state.stats.restMinutesToday;
          m.pomodorosToday = state.stats.pomodorosCompletedToday;
          continue;
        }
        Lounge._tickBot(m, room);
      }
      if (typeof UI !== 'undefined') { UI.renderLoungeChip(); if (state.currentView === 'lounge') UI.renderLoungeRoom(); }
    },
  ```
  Then in `UI.init()`, extend the Lounge wiring block added in Task 3 (right after the Join Room form listener, before `UI.renderLoungeLobby();`):
  ```js
      document.getElementById('lounge-copy-code').addEventListener('click', () => {
        const code = state.lounge.room ? state.lounge.room.code : '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).catch(() => {});
        }
      });
      document.getElementById('lounge-leave-room').addEventListener('click', () => {
        Lounge.leaveRoom();
        UI.renderLoungeView();
        UI.renderLoungeChip();
      });
      document.getElementById('lounge-chip').addEventListener('click', () => UI.selectView('lounge'));
  ```
  Also update the Create Room and Join Room submit handlers from Task 3 to call `UI.renderLoungeChip();` right after `UI.renderLoungeView();` in both (the chip must appear immediately on creation/join, not wait a full second for the next tick).

- [ ] **Step 5: Verify via Playwright.**
  - Create a room → confirm `#lounge-room-code` shows the generated code, the member list has exactly one `.lounge-member-item` (self), and `#lounge-chip` is visible showing `Group: <code> · 1 active`.
  - Join a room from a fresh reload (`Lounge.joinRoom` via a real form submit) → confirm 3-5 member rows render with avatar/name/level/status/metrics, and the level badge for a bot renders `Lv. N · <Title>` using `Lounge.titleForLevel`.
  - Wait ~3 real seconds, re-snapshot the member list → confirm at least one bot's status text or remaining-time changed (the engine is live and the DOM reflects it without any user action).
  - Click a member row is not required, but click `#lounge-chip` → confirm it navigates to the Lounge view. Click "Leave Room" → confirm `#lounge-chip` hides and the lobby reappears.
  - Regression: while in an active room, go to Dashboard and start/pause the real Timer — confirm Timer controls work exactly as before and are not affected by the chip/engine.
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 6: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: render live Study Lounge member dashboard and header chip"
  ```

---

### Task 5: Co-op mission (data + UI + rewards)

**Files:**
- Modify: `index.html` — grow `Lounge` object (mission methods + bot mission participation in `_tickBot`), `Timer.complete()` (~line 1473-1486), `UI` object (mission panel rendering), CSS (mission panel), `UI.init()` (mission button wiring), new `Confetti` helper (insert right after the `Lounge` object's closing `};`).

**Interfaces:**
- Consumes: `state.lounge.room` (Task 2/4), `SoundFX.playCompletionSound()` (existing), `Storage.saveStats` (existing), `UI.renderMissions/renderSkills equivalents` — actually `UI.renderMissions()` (existing, covers both missions and skills lists) and `UI.renderStatsDashboard()` (existing).
- Produces: `Lounge.startMission(targetPomodoros)`, `Lounge.cancelMission()`, `Lounge.onOwnPomodoroCompleted()`, `Lounge.onOwnBreakCompleted(minutes)`, `Lounge._checkMissionCompletion()`, `Confetti.burst()`.

- [ ] **Step 1: Add mission lifecycle methods to `Lounge`.** Insert after `_stopEngine()` (or anywhere before `_tick`, as a cohesive group):

  ```js
    startMission(targetPomodoros) {
      const room = state.lounge.room;
      if (!room || (room.mission && room.mission.state === 'active')) return false;
      const target = clampInt(targetPomodoros, 1, 4, 1);
      room.mission = { targetPomodoros: target, state: 'active' };
      for (const m of room.members) { m.missionProgress = 0; m.missionState = 'pending'; }
      return true;
    },
    cancelMission() {
      const room = state.lounge.room;
      if (!room) return;
      room.mission = null;
      for (const m of room.members) { m.missionProgress = 0; m.missionState = 'pending'; }
    },
    onOwnPomodoroCompleted() {
      const room = state.lounge.room;
      if (!room || !room.mission || room.mission.state !== 'active') return;
      const self = room.members.find((m) => m.isSelf);
      if (!self || self.missionState !== 'pending') return;
      self.missionProgress += 1;
      if (self.missionProgress >= room.mission.targetPomodoros) self.missionState = 'checked-in';
      Lounge._checkMissionCompletion();
    },
    onOwnBreakCompleted(minutes) {
      state.stats.restMinutesToday += clampInt(minutes, 0, 999, 0);
      Storage.saveStats(state.stats);
    },
    giveUpOwnMission() {
      const room = state.lounge.room;
      if (!room || !room.mission || room.mission.state !== 'active') return;
      const self = room.members.find((m) => m.isSelf);
      if (!self || self.missionState !== 'pending') return; // Review Focus: can't abandon after already checked in
      self.missionState = 'abandoned';
    },
    _checkMissionCompletion() {
      const room = state.lounge.room;
      if (!room || !room.mission || room.mission.state !== 'active') return;
      if (!room.members.every((m) => m.missionState === 'checked-in')) return;
      room.mission.state = 'completed';
      state.stats.disciplineXP += 50;
      Storage.saveStats(state.stats);
      if (typeof UI !== 'undefined') { UI.renderMissions(); UI.renderStatsDashboard(); }
      if (typeof SoundFX !== 'undefined') SoundFX.playCompletionSound();
      if (typeof Confetti !== 'undefined') Confetti.burst();
      room.mission = null;
      for (const m of room.members) { m.missionProgress = 0; m.missionState = 'pending'; }
    },
  ```

- [ ] **Step 2: Add bot mission participation to `_tickBot`.** In the existing `_tickBot(m, room)` method (Task 2), the phase-flip branch for finishing a focus phase currently reads:
  ```js
      if (m.status === 'focusing') {
        m.pomodorosToday += 1;
        m.studyMinutesToday += state.settings.pomodoro;
        m.simXP = (m.simXP || 0) + 20;
        m.status = 'resting';
        m.remainingMs = state.settings.shortBreak * 60000;
      } else {
  ```
  Replace it with:
  ```js
      if (m.status === 'focusing') {
        m.pomodorosToday += 1;
        m.studyMinutesToday += state.settings.pomodoro;
        m.simXP = (m.simXP || 0) + 20;
        m.status = 'resting';
        m.remainingMs = state.settings.shortBreak * 60000;
        if (room.mission && room.mission.state === 'active' && m.missionState === 'pending') {
          m.missionProgress += 1;
          if (m.missionProgress >= room.mission.targetPomodoros) {
            m.missionState = Math.random() < 0.85 ? 'checked-in' : 'abandoned';
            Lounge._checkMissionCompletion();
          }
        }
      } else {
  ```

- [ ] **Step 3: Hook `Timer.complete()`.** Replace:
  ```js
    complete() {
      if (state.timer._completing) return;
      state.timer._completing = true;
      state.timer.running = false;
      state.timer.endAt = null;
      state.timer.remainingMs = 0;
      Timer.updateTimerDisplay();
      SoundFX.playCompletionSound();
      if (state.timer.mode === 'pomodoro') {
        Planner.onPomodoroCompleted();
      }
      Timer._advanceMode(true);
      state.timer._completing = false;
    },
  ```
  With:
  ```js
    complete() {
      if (state.timer._completing) return;
      state.timer._completing = true;
      state.timer.running = false;
      state.timer.endAt = null;
      state.timer.remainingMs = 0;
      Timer.updateTimerDisplay();
      SoundFX.playCompletionSound();
      if (state.timer.mode === 'pomodoro') {
        Planner.onPomodoroCompleted();
        Lounge.onOwnPomodoroCompleted();
      } else {
        Lounge.onOwnBreakCompleted(state.settings[state.timer.mode]);
      }
      Timer._advanceMode(true);
      state.timer._completing = false;
    },
  ```

- [ ] **Step 4: Add the `Confetti` helper.** Insert right after the `Lounge` object's closing `};`, before `/* ============================== AIChat (Google Gemini) ============================== */`:

  ```js
  /* ============================== Confetti (tiny, no library) ============================== */
  const Confetti = {
    COLORS: ['#e0654f', '#2f9e8f', '#5b53a6', '#c98a1f', '#2f9e57'],
    burst() {
      const overlay = document.createElement('div');
      overlay.className = 'confetti-overlay';
      for (let i = 0; i < 24; i++) {
        const piece = document.createElement('span');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = Confetti.COLORS[i % Confetti.COLORS.length];
        piece.style.animationDelay = `${Math.random() * 0.3}s`;
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        overlay.appendChild(piece);
      }
      document.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), 1600);
    },
  };
  ```

  CSS — add near the end of the stylesheet, before the `@media (prefers-reduced-motion: reduce)` block:
  ```css
  .confetti-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 999; overflow: hidden; }
  .confetti-piece {
    position: absolute; top: -10px; width: 8px; height: 14px; opacity: 0.9;
    animation: confetti-fall 1.4s ease-in forwards;
  }
  @keyframes confetti-fall {
    to { top: 105%; opacity: 0; }
  }
  ```
  (`prefers-reduced-motion` already forces all `animation-duration` to `0.001ms` globally per the existing rule at the end of the stylesheet, so confetti already respects it with no extra work.)

- [ ] **Step 5: Add the mission panel markup/CSS and rendering.** Replace the empty `<div id="lounge-mission"></div>` from Task 4 with the same element (no static children — it's fully rendered by JS since its shape depends on mission state):
  ```html
  <div id="lounge-mission" aria-label="Group mission"></div>
  ```
  Add CSS after the member-item rules from Task 4:
  ```css
  #lounge-mission { border-top: 1px solid var(--border); padding-top: 16px; }
  .lounge-mission-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .lounge-mission-progress { font-weight: 700; margin-bottom: 10px; }
  .lounge-mission-chips { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .lounge-mission-chip {
    padding: 4px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 700;
    background: rgba(36, 31, 28, 0.08); color: var(--text-muted);
  }
  .lounge-mission-chip--checked-in { background: var(--success); color: #fff; }
  .lounge-mission-chip--abandoned { background: var(--danger); color: #fff; }
  .lounge-mission-alert {
    background: rgba(192, 57, 43, 0.1); color: var(--danger); padding: 10px 14px;
    border-radius: var(--radius-md); font-size: 0.85rem; margin-bottom: 12px;
  }
  ```

  Add `UI.renderLoungeMission()` right after `renderLoungeRoom()`, and call it at the end of `renderLoungeRoom()`:
  ```js
    renderLoungeMission() {
      const container = document.getElementById('lounge-mission');
      if (!container) return;
      const room = state.lounge.room;
      container.replaceChildren();
      if (!room) return;

      if (!room.mission) {
        const form = document.createElement('form');
        form.className = 'lounge-mission-form';
        form.id = 'lounge-mission-start-form';
        const select = document.createElement('select');
        select.id = 'lounge-mission-target';
        [1, 2, 3, 4].forEach((n) => {
          const opt = document.createElement('option');
          opt.value = String(n);
          opt.textContent = `${n} Pomodoro${n > 1 ? 's' : ''}`;
          select.appendChild(opt);
        });
        const btn = document.createElement('button');
        btn.type = 'submit';
        btn.className = 'btn btn-primary';
        btn.textContent = 'Start Sprint';
        form.append(select, btn);
        container.appendChild(form);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          Lounge.startMission(select.value);
          UI.renderLoungeMission();
        });
        return;
      }

      const abandoned = room.members.filter((m) => m.missionState === 'abandoned');
      if (abandoned.length) {
        const alert = document.createElement('p');
        alert.className = 'lounge-mission-alert';
        alert.textContent = `${abandoned.map((m) => m.name).join(', ')} abandoned the sprint — waiting is impossible until you cancel.`;
        container.appendChild(alert);
      }

      const checkedInCount = room.members.filter((m) => m.missionState === 'checked-in').length;
      const progress = document.createElement('p');
      progress.className = 'lounge-mission-progress';
      progress.textContent = `${checkedInCount}/${room.members.length} checked in`;
      container.appendChild(progress);

      const chips = document.createElement('ul');
      chips.className = 'lounge-mission-chips';
      for (const m of room.members) {
        const chip = document.createElement('li');
        const label = m.missionState === 'checked-in' ? 'Checked In' : m.missionState === 'abandoned' ? 'Abandoned' : 'In Progress';
        chip.className = `lounge-mission-chip lounge-mission-chip--${m.missionState}`;
        chip.textContent = `${m.name}: ${label}`;
        chips.appendChild(chip);
      }
      container.appendChild(chips);

      const self = room.members.find((m) => m.isSelf);
      const giveUpBtn = document.createElement('button');
      giveUpBtn.type = 'button';
      giveUpBtn.className = 'btn btn-secondary';
      giveUpBtn.textContent = 'Give Up';
      giveUpBtn.disabled = !self || self.missionState !== 'pending';
      giveUpBtn.addEventListener('click', () => { Lounge.giveUpOwnMission(); UI.renderLoungeMission(); });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel Sprint';
      cancelBtn.addEventListener('click', () => { Lounge.cancelMission(); UI.renderLoungeMission(); });

      container.append(giveUpBtn, cancelBtn);
    },
  ```
  In `renderLoungeRoom()`, add a call at the very end of the method body: `UI.renderLoungeMission();`. No further change is needed to `Lounge._tick()`'s render hook from Task 4 — it already calls `UI.renderLoungeRoom()` once per tick while the Lounge view is active, and that now transitively renders the mission panel too, so mission chips/progress update live as bots check in/abandon without rendering the panel twice.

- [ ] **Step 6: Verify via Playwright.**
  - Create a room, start a 1-Pomodoro sprint (`#lounge-mission-start-form` submit with target `1`) → confirm the progress line shows `0/N checked in` and every member shows an "In Progress" chip.
  - Shorten the Pomodoro duration in Settings (Timer tab) to `1` minute for a fast test, start and let the real Timer complete (or call `Timer.complete()` directly via `browser_evaluate` to avoid waiting) → confirm self's chip flips to "Checked In" and the Timer's own display/controls are unaffected.
  - **Review Focus (Give Up disabled after checked in):** after self is "Checked In", confirm the "Give Up" button is `disabled`.
  - Poll (`browser_evaluate`, short waits) until all bots resolve for this mission → confirm one of two outcomes occurs and is handled correctly: (a) all check in → confirm `Confetti.burst()` ran (a `.confetti-overlay` element briefly appears in the DOM), `state.stats.disciplineXP` increased by exactly 50, `room.mission === null` afterward, and the Missions & Skills card's Discipline level/XP text updated; or (b) at least one bot abandoned → confirm the alert banner renders with that bot's name and the mission never auto-completes even once every other member is "Checked In" (leave it running a few more ticks to confirm), then click "Cancel Sprint" → confirm the panel returns to the idle "Start Sprint" form.
  - **Review Focus (mission resets between sprints):** immediately start a second 1-Pomodoro sprint after the first completes or is cancelled → confirm every member's chip starts as "In Progress" again (no stale "Checked In"/"Abandoned" carried over).
  - **Review Focus (day rollover doesn't corrupt an active room):** with a room and an active mission in place, call `browser_evaluate(() => { state.stats.date = '2000-01-01'; State.rolloverStatsIfNewDay(); return { pomodorosCompletedToday: state.stats.pomodorosCompletedToday, roomAlive: !!state.lounge.room, missionAlive: !!state.lounge.room.mission }; })` → confirm no throw, `pomodorosCompletedToday === 0`, `roomAlive === true`, and `missionAlive` unchanged (mission is sprint-scoped, unaffected by the day rollover).
  - `browser_console_messages`: confirm no new errors throughout.

- [ ] **Step 7: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add co-op group mission flow with confetti and Discipline XP reward"
  ```

---

### Task 6: Full regression sweep, responsiveness, and disclosure check

**Files:**
- No new code expected; this task only edits `index.html` if the sweep finds something to fix.

- [ ] **Step 1: Full regression sweep of every pre-existing behavior.** Via Playwright against the served app: Timer start/pause/reset/skip and mode tabs; 4-cycle auto-advance to long break; Planner task add/complete/delete; Missions & Skills card updates on pomodoro completion; Settings dialog (all 5 tabs: Timer/Background/Music/Appearance/AI) open/save/close still work; Reports and Leaderboard views still render; dark mode and mute toggles; background media and music playback continue independently of the Lounge. Check `browser_console_messages` after every exercised flow (new and existing) and confirm zero unexplained errors/warnings.

- [ ] **Step 2: New-feature security/regression sweep.** Grep the file for `innerHTML`/`insertAdjacentHTML`/`document.write`/`eval(` — confirm the count is unchanged from before this feature (no new matches introduced by any Lounge/Confetti code). Confirm a friend name or room-goal/join-code containing `<img src=x onerror=alert(1)>` renders as inert literal text (via `textContent`) in the friends list / room header — never executes.

- [ ] **Step 3: Cross-feature independence checks (spec §11, items 4 and 9).** With a room active and a mission in progress: switch to Dashboard, Reports, Leaderboard and back — confirm the Timer keeps counting down accurately and mission/member state is unaffected by view switches. Reload the page while in an active room — confirm the room is gone (expected, by design) but Timer state, `state.stats`, `state.profile` (including avatar), and the friends list are all intact after reload.

- [ ] **Step 4: Responsiveness sweep.** At 1440px, 768px, and 375px widths: confirm `#view-lounge` (lobby and active-room states), the header chip, and the emoji picker all reflow with no horizontal scrollbar and no overlapping text, and the existing dashboard grid/reports/leaderboard layouts are unaffected at every width.

- [ ] **Step 5: Fix anything the sweep finds, re-run the affected checks, then commit.**
  ```bash
  git add index.html
  git commit -m "test: full regression and responsiveness sweep for Study Lounge"
  ```
  (Skip this commit if Step 1-4 found nothing to change.)

---

## Self-Review

**Spec coverage:** §1 data shapes → Task 1 (profile/stats) + Task 2 (lounge/room/mission shapes). §2 room codes → Task 2 Step 2. §3 Lounge API → Tasks 2/3/4/5 collectively implement every listed method. §4 bot simulation & mission rules → Task 2 Step 4 (bots) + Task 5 (mission participation/completion rule). §5 UI/UX → Task 3 (lobby/nav), Task 4 (dashboard/chip), Task 5 (mission panel/confetti/sound/rewards), Task 1 (avatar picker). §6 responsiveness → Task 3/6. §7 hooks → Task 1 (`State.init`), Task 5 (`Timer.complete`), Task 3 (`selectView` arrays). §8 security → Task 6 Step 2 (also inherent throughout via `textContent`-only rendering in every task). §9 non-goals → respected by construction (no networking code written anywhere). §10 regression guarantees → Task 6. §11 testing plan → mapped 1:1 into each task's own verification step, consolidated in Task 6.

**Placeholder scan:** no TBD/TODO; every step has runnable code or a fully specified Playwright check.

**Type consistency:** `member.status` values (`'focusing'|'resting'|'idle'`) and `missionState` values (`'pending'|'checked-in'|'abandoned'`) are used identically across Tasks 2, 4, and 5. `Lounge.statusLabel`, `Lounge.titleForLevel`, `Lounge._makeSelfMember`/`_makeBotMember` are defined once in Task 2 and only ever called (never redefined) in later tasks. `Confetti.burst()` is defined in Task 5 and called only there.

**Review Focus:** all five items above have their test folded into the owning task's own verification step (Task 2 for the interval-leak/room-switch items, Task 1 for Escape/picker, Task 5 for Give-Up-after-checked-in, mission-reset-between-sprints, and day-rollover-while-active).
