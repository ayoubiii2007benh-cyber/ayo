# Study Lounge Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** One evolving file (`index.html`), no test framework. "Tests" are concrete Playwright browser interactions/assertions run against the file served over `http://` (e.g. `npx serve -l 8080 .`), per this repo's established convention. Prefer inline execution by one agent holding the whole file in context over parallel per-task subagents — every task edits the same file, and Task 2's `renderLoungeRoom()` rewrite is read and extended by Tasks 3 and 4.

**Goal:** Redesign the Study Lounge's active-room view into a spacious 3-column dashboard (Room/Sprint left, Member grid with progress rings center, Activity log right), breaking it out of the app's usual 1040px column, without touching Timer/Missions/Music/AI or any of last session's Lounge logic (bot engine, mission rules, XSS-safety, interval-leak fix, mission-panel click-safety fix).

**Architecture:** Purely additive/restructuring within `index.html`. `#view-lounge` moves from inside `<main>` to a sibling of it, gaining its own wider `max-width`. Every visual card becomes its own `.glass` element (the outer `#view-lounge` wrapper stops being `.glass` itself). The old vertical `.lounge-member-item` list is replaced by a `.lounge-grid-card` grid with SVG progress rings. A new room-scoped `activityLog` array feeds an append-only, scroll-preserving activity feed. No new top-level state, no new `localStorage` keys — `activityLog` lives on the already-non-persisted `state.lounge.room`.

**Tech Stack:** Same as existing — vanilla ES6+, inline SVG (new, for progress rings), no external dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-lounge-dashboard-redesign-design.md`

## Global Constraints

- Still exactly one file: `index.html`. No build step, no new dependencies.
- `renderLoungeMission()`'s internal logic (idle/active skeleton-once pattern, solo-mission guard at `room.members.length < 2`, Give-Up-disabled-after-checkin) must not change — only its container's location in the DOM changes.
- The bot simulation engine (`_tick`/`_tickBot`/`_syncEngine`/`_resumeBot`), mission completion/reward logic (`_checkMissionCompletion`, +50 disciplineXP, confetti, sound), and the header chip (`renderLoungeChip`) are untouched except for the new `_logActivity` call sites, which never change existing control flow (only append a side-effecting line).
- Every new user-controlled string (friend names, room goal/code, activity log lines built from names) is rendered via `textContent`/`createElement`, never `innerHTML`, per the existing codebase-wide rule.
- "Invite to Room" must work from inside an active room after this redesign, exactly as it does today (previous session's Critical fix) — this is the plan's single hardest regression risk and gets its own task (Task 3) and its own explicit test.
- The activity log is never persisted to `localStorage` and is capped at 500 entries as a safety valve only (not a UI-facing limit) — it resets whenever `state.lounge.room` resets, exactly like every other room field.
- No existing `Storage.*` key is renamed, removed, or restructured.

## Review Focus

- **Moving `#view-lounge` outside `<main>` breaks nav switching.** `UI.selectView`/the nav click-wiring loop both key off `document.getElementById`, but this is worth an explicit post-move check rather than trusting that reasoning alone — covered in Task 1.
- **Dead CSS/class leftovers after the member-list → member-grid swap.** `.lounge-member-item`/`.lounge-members-list` must be fully removed, not left dangling alongside the new `.lounge-grid-card` rules — covered in Task 2.
- **Duplicate-member risk from the two-container friends render (Task 3).** Clicking Invite from the Left-panel copy must add exactly one member, not one per rendered container — covered in Task 3.
- **The activity log's 500-entry safety cap never actually trims.** An array that only ever grows because the cap logic has an off-by-one or wrong comparison would defeat the point of having it — covered in Task 4 with a direct check.
- **Progress ring fraction escapes `[0,1]` at a phase-flip tick.** `remainingMs` transiently reaching 0 or briefly negative (before `_tickBot` resets it) must never produce a ring stroke-dashoffset outside its valid range — covered in Task 2.

---

## Shared additions (referenced by multiple tasks below)

```js
// room shape (existing key, extended) — Task 2/4
{
  code, goal, hostId, members: [...], mission: null,
  activityLog: [],  // NEW: [{ id, ts, text }], capped at 500, never persisted
}
```

---

### Task 1: Break `#view-lounge` out of the 1040px column; unify card styling

**Files:**
- Modify: `index.html` — move the `#view-lounge` HTML block (currently ending right before `</main>`) to be a sibling immediately after `</main>`; CSS for `#view-lounge` (~line 569-574); the Lobby's two `<section>` elements (add `class="glass"`).

**Interfaces:**
- Consumes: nothing new.
- Produces: no new JS interfaces — this task is HTML/CSS only. `UI.selectView`/`UI.renderLoungeView` are unchanged and confirmed still correct against the new DOM position.

- [ ] **Step 1: Make `#view-lounge` a sibling of `<main>` by moving the `</main>` tag itself, not the content.** `#view-lounge` already sits at the very end of `<main>`, right after `#view-leaderboard`. Since it's the last child, `<main>` can be closed one element earlier and reopened nowhere — `#view-lounge`'s ~40 lines of content never need to move at all, only the single `</main>` tag does.

  First, close `<main>` right after `#view-leaderboard` instead of after `#view-lounge`. Replace:
  ```html
  <div id="view-leaderboard" class="glass" aria-label="Your best days" hidden>
    <h2>Your Best Days</h2>
    <p class="field-hint">Ranked by pomodoros completed. This app has no account system or other real users, so this is a personal ranking of your own history, not a multi-user leaderboard.</p>
    <ol class="leaderboard-list" id="leaderboard-list"></ol>
  </div>

  <div id="view-lounge" class="glass" aria-label="Study Lounge" hidden>
    <h2>Study Lounge</h2>
  ```
  With:
  ```html
  <div id="view-leaderboard" class="glass" aria-label="Your best days" hidden>
    <h2>Your Best Days</h2>
    <p class="field-hint">Ranked by pomodoros completed. This app has no account system or other real users, so this is a personal ranking of your own history, not a multi-user leaderboard.</p>
    <ol class="leaderboard-list" id="leaderboard-list"></ol>
  </div>
  </main>

  <div id="view-lounge" aria-label="Study Lounge" hidden>
    <div class="lounge-heading">
      <h2>Study Lounge</h2>
  ```
  Then re-indent the demo-mode paragraph one level deeper (it's now a child of `.lounge-heading`, not of `#view-lounge` directly) and close that wrapper. Replace:
  ```html
    <p class="field-hint">Demo Mode — friends and group members here are simulated locally; nothing is sent over the network.</p>
    <div class="lounge-lobby-grid">
      <section aria-label="Friends">
  ```
  With:
  ```html
      <p class="field-hint">Demo Mode — friends and group members here are simulated locally; nothing is sent over the network.</p>
    </div>
    <div class="lounge-lobby-grid">
      <section class="glass" aria-label="Friends">
  ```
  Then give the "Room" section its own `.glass` class. Replace:
  ```html
      <section aria-label="Room">
  ```
  With:
  ```html
      <section class="glass" aria-label="Room">
  ```
  Finally, remove the old trailing `</main>` that used to close `<main>` after `#view-lounge` (it's now redundant — `<main>` was already closed earlier in this same step). This step's anchor needs exact indentation to match — use Read on `index.html` right before this edit to find the closing sequence right before `<dialog id="settings"`, which today reads (6/4/2/0/0 spaces respectively): `#lounge-active`'s `</div>`, the "Room" `</section>`, `.lounge-lobby-grid`'s `</div>`, `#view-lounge`'s `</div>`, then `</main>` on its own line, a blank line, then `<dialog id="settings" aria-labelledby="settings-title">`. Remove just the `</main>` line (and nothing else) from that sequence, so `#view-lounge`'s closing `</div>` is immediately followed by a blank line and then the `<dialog>` tag.

- [ ] **Step 2: Update the CSS.** Replace:
  ```css
    /* ---------- study lounge ---------- */
    #view-lounge {
      max-width: 1040px; margin: 0 auto; border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px); box-shadow: var(--shadow-md);
    }
    #view-lounge h2 { font-size: 1.1rem; margin-bottom: 4px; }
  ```
  With:
  ```css
    /* ---------- study lounge ---------- */
    #view-lounge {
      max-width: 1440px; margin: 0 auto;
      padding: 16px clamp(16px, 4vw, 32px) 120px;
    }
    .lounge-heading { max-width: 1440px; margin: 0 auto 8px; }
    .lounge-heading h2 { font-size: 1.1rem; margin-bottom: 4px; }
  ```
  (`#view-lounge h3` on the next line is left completely unchanged — `#view-lounge` is still the id of the outer wrapper, so that selector still correctly matches every `h3` nested anywhere inside it, in the Lobby's sections now and the new dashboard panels added in Task 2.)

- [ ] **Step 3: Verify via Playwright.**
  - Serve the directory (`npx serve -l 8080 .`), navigate, confirm no console errors.
  - Click `#nav-lounge` → confirm `#view-lounge` becomes visible, `#view-dashboard` hides, `#nav-lounge` gets `aria-current="page"` — this is the Review Focus check that moving the element out of `<main>` didn't break view switching.
  - Confirm the Friends `<section>` and Room `<section>` in the Lobby each independently show the `.glass` translucent/blur styling (`getComputedStyle(...).backdropFilter` contains `blur`), and that `#view-lounge` itself does not (no `.glass` class on it anymore).
  - Confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth` (no horizontal overflow) at 1440px, 1024px, and 375px viewport widths.
  - Regression: add a friend and create a room through the real forms exactly as before — confirm both still work (this task doesn't touch any of that JS, but the DOM move could in principle have detached an id if the cut/paste was imprecise).
  - Click `#nav-dashboard`, `#nav-reports`, `#nav-leaderboard` — confirm all three still work.

- [ ] **Step 4: Commit.**
  ```bash
  git add index.html
  git commit -m "refactor: break Study Lounge out of the 1040px column into its own wide container"
  ```

---

### Task 2: Active-room 3-column dashboard shell + member grid with progress rings

**Files:**
- Modify: `index.html` — `#lounge-active`'s inner HTML (restructure into `.lounge-dashboard` with 3 `.lounge-panel` sections); CSS (remove `.lounge-members-list`/`.lounge-member-item*`, add `.lounge-dashboard`/`.lounge-panel*`/`.lounge-member-grid`/`.lounge-grid-card*`/`.lounge-ring*`); `Lounge` object (add `phaseFraction`); `UI.renderLoungeRoom()` (rewrite to build grid cards with rings instead of list rows).

**Interfaces:**
- Consumes: `state.lounge.room.members`, `state.settings.pomodoro`/`shortBreak`, `Skills.progress`, `Lounge.titleForLevel`/`statusLabel` (all existing).
- Produces: `Lounge.phaseFraction(member) -> number` (0-1), consumed by Task 2 itself and available for any future use. `renderLoungeRoom()`'s new DOM structure (`#lounge-member-grid`, `.lounge-grid-card`) is consumed by Task 3 (friends list lives in the same new Left panel markup) and Task 4 (`#lounge-activity-log` lives in the new Right panel, and `renderLoungeRoom()` gains a trailing call to `UI.renderLoungeActivityLog()` — added in Task 4, not here).

- [ ] **Step 1: Restructure `#lounge-active`'s HTML into the 3-panel dashboard.** Replace:
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
          <div id="lounge-mission" aria-label="Group mission"></div>
        </div>
  ```
  With:
  ```html
        <div id="lounge-active" hidden>
          <div class="lounge-dashboard">
            <section class="glass lounge-panel lounge-panel--left" aria-label="Room and sprint">
              <div class="lounge-active-header">
                <div>
                  <span class="lounge-room-code" id="lounge-room-code"></span>
                  <button type="button" class="btn btn-secondary" id="lounge-copy-code">Copy</button>
                  <p class="field-hint" id="lounge-room-goal"></p>
                </div>
                <button type="button" class="btn btn-secondary" id="lounge-leave-room">Leave Room</button>
              </div>
              <h3>Friends</h3>
              <ul class="lounge-friends-list" id="lounge-friends-list-active"></ul>
              <div id="lounge-mission" aria-label="Group mission"></div>
            </section>
            <section class="glass lounge-panel lounge-panel--center" aria-label="Members">
              <h3>Members</h3>
              <div class="lounge-member-grid" id="lounge-member-grid"></div>
            </section>
            <section class="glass lounge-panel lounge-panel--right" aria-label="Activity">
              <h3>Activity</h3>
              <ul class="lounge-activity-log" id="lounge-activity-log"></ul>
            </section>
          </div>
        </div>
  ```
  (`#lounge-friends-list-active` stays empty/unpopulated until Task 3, and `#lounge-activity-log` stays empty until Task 4 — both are inert `<ul>`s with no listeners attached yet, so leaving them empty this task is not a bug, just incomplete until later tasks fill them in.)

- [ ] **Step 2: Replace the CSS.** Delete the now-dead rules:
  ```css
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
  Replace them (same location) with:
  ```css
    .lounge-dashboard {
      display: grid;
      grid-template-columns: minmax(260px, 320px) 1fr minmax(260px, 340px);
      gap: 24px;
      align-items: start;
    }
    @media (max-width: 1100px) {
      .lounge-dashboard { grid-template-columns: 1fr; }
    }
    .lounge-panel { border-radius: var(--radius-lg); padding: clamp(20px, 3vw, 26px); box-shadow: var(--shadow-md); }

    .lounge-member-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; margin-top: 12px; }
    .lounge-grid-card {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
      padding: 16px 10px; border-radius: var(--radius-md); background: rgba(36, 31, 28, 0.04);
    }
    .lounge-ring { position: relative; width: 76px; height: 76px; margin-bottom: 6px; }
    .lounge-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .lounge-ring__track { fill: none; stroke: var(--border); stroke-width: 6; }
    .lounge-ring__fill { fill: none; stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
    .lounge-ring[data-status="focusing"] .lounge-ring__fill { stroke: var(--accent); }
    .lounge-ring[data-status="resting"] .lounge-ring__fill { stroke: var(--accent-shortBreak); }
    .lounge-ring[data-status="idle"] .lounge-ring__fill { stroke: transparent; }
    .lounge-ring__avatar { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 2rem; }
    .lounge-grid-card__name { font-weight: 700; font-size: 0.92rem; }
    .lounge-grid-card__level { color: var(--text-muted); font-size: 0.74rem; }
    .lounge-grid-card__status { font-size: 0.8rem; }
    .lounge-grid-card__metrics { color: var(--text-muted); font-size: 0.72rem; }
  ```
  Leave `.lounge-active-header`/`.lounge-room-code` (just above) and `#lounge-mission`/`.lounge-mission-*` (just below) completely unchanged — both are still used verbatim in their new home.

- [ ] **Step 3: Add `Lounge.phaseFraction`.** Insert into the `Lounge` object, right after `statusLabel(member) { ... }`:
  ```js
    phaseFraction(m) {
      if (m.status === 'idle') return 0;
      const totalMs = (m.status === 'focusing' ? state.settings.pomodoro : state.settings.shortBreak) * 60000;
      return totalMs > 0 ? Math.min(1, Math.max(0, 1 - m.remainingMs / totalMs)) : 0;
    },
  ```

- [ ] **Step 4: Rewrite `renderLoungeRoom()`.** Replace:
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
      UI.renderLoungeMission();
    },
  ```
  With:
  ```js
    renderLoungeRoom() {
      const room = state.lounge.room;
      if (!room) return;
      document.getElementById('lounge-room-code').textContent = room.code;
      document.getElementById('lounge-room-goal').textContent = room.goal || 'No goal set.';

      const grid = document.getElementById('lounge-member-grid');
      grid.replaceChildren();
      for (const m of room.members) {
        const card = document.createElement('div');
        card.className = 'lounge-grid-card';

        const ring = document.createElement('div');
        ring.className = 'lounge-ring';
        ring.dataset.status = m.status;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 80 80');
        const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        track.setAttribute('cx', '40'); track.setAttribute('cy', '40'); track.setAttribute('r', '36');
        track.setAttribute('class', 'lounge-ring__track');
        const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        fill.setAttribute('cx', '40'); fill.setAttribute('cy', '40'); fill.setAttribute('r', '36');
        fill.setAttribute('class', 'lounge-ring__fill');
        const circumference = 2 * Math.PI * 36;
        fill.setAttribute('stroke-dasharray', String(circumference));
        fill.setAttribute('stroke-dashoffset', String(circumference * (1 - Lounge.phaseFraction(m))));
        svg.append(track, fill);
        const avatarEl = document.createElement('span');
        avatarEl.className = 'lounge-ring__avatar';
        avatarEl.textContent = m.avatar;
        ring.append(svg, avatarEl);

        const name = document.createElement('span');
        name.className = 'lounge-grid-card__name';
        name.textContent = m.name;

        const level = m.isSelf ? Skills.progress(state.stats.focusXP).level : Skills.progress(m.simXP || 0).level;
        const levelEl = document.createElement('span');
        levelEl.className = 'lounge-grid-card__level';
        levelEl.textContent = `Lv. ${level} · ${Lounge.titleForLevel(level)}`;

        const status = document.createElement('span');
        status.className = 'lounge-grid-card__status';
        status.textContent = Lounge.statusLabel(m);

        const metrics = document.createElement('span');
        metrics.className = 'lounge-grid-card__metrics';
        const h = Math.floor(m.studyMinutesToday / 60), min = m.studyMinutesToday % 60;
        metrics.textContent = `${h > 0 ? `${h}h ${min}m` : `${min}m`} study · ${m.restMinutesToday}m rest · ${m.pomodorosToday} 🍅`;

        card.append(ring, name, levelEl, status, metrics);
        grid.appendChild(card);
      }
      UI.renderLoungeMission();
    },
  ```
  (The trailing `UI.renderLoungeActivityLog()` call is added in Task 4, not here — the function doesn't exist yet.)

- [ ] **Step 5: Verify via Playwright.**
  - Grep the file for `lounge-member-item` and `lounge-members-list` — confirm zero matches remain anywhere (Review Focus: no dead CSS/class leftovers).
  - Create a room, confirm `#lounge-member-grid` contains one `.lounge-grid-card` with a visible ring (`svg circle.lounge-ring__fill` present, `stroke-dasharray` a positive number).
  - Join a room with bots; inspect a focusing bot's ring: confirm `data-status="focusing"` and `stroke-dashoffset` is between `0` and `circumference` (never `NaN`, never outside range) at several points over ~5 real seconds as its `remainingMs` counts down — this is the Review Focus check that the fraction stays clamped, including across the phase-flip tick where `remainingMs` resets to full duration (confirm the ring visibly resets toward "empty" at that instant rather than jumping to an invalid value).
  - Force a member idle (`Lounge._resumeBot`/set `status='idle'` then re-render) — confirm its ring shows `data-status="idle"` with an empty/transparent fill.
  - Confirm the mission panel (now inside the Left panel) still fully works: start a sprint, confirm progress/chips/Give-Up-disabled/solo-guard all behave exactly as before (no logic changed, just relocated).
  - Resize to 1050px (below the 1100px breakpoint) — confirm the 3 panels stack to a single column, Left/Center/Right in that order, no horizontal overflow.
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 6: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: rebuild active-room Lounge as a 3-column dashboard with member progress rings"
  ```

---

### Task 3: Friends reachable from inside the active-room dashboard

**Files:**
- Modify: `index.html` — `UI.renderLoungeFriends()`.

**Interfaces:**
- Consumes: `state.lounge.friends`, `Lounge.inviteFriendToRoom`, `Lounge.statusLabel` (all existing), the new `#lounge-friends-list-active` container from Task 2.
- Produces: no new interfaces — `renderLoungeFriends()`'s public contract (no arguments, renders from `state.lounge.friends`) is unchanged; it now just writes to two containers instead of one.

- [ ] **Step 1: Extend `renderLoungeFriends()` to populate both friend-list containers.** Replace:
  ```js
    renderLoungeFriends() {
      const list = document.getElementById('lounge-friends-list');
      if (!list) return;
      const seen = new Set();
      for (const f of state.lounge.friends) {
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
          const inviteBtn = document.createElement('button');
          inviteBtn.type = 'button';
          inviteBtn.className = 'btn btn-secondary';
          inviteBtn.textContent = 'Invite to Room';
          inviteBtn.addEventListener('click', () => {
            Lounge.inviteFriendToRoom(f.id);
            UI.renderLoungeView();
          });
          li.append(avatar, name, status, inviteBtn);
          list.appendChild(li);
        }
        li.querySelector('.lounge-friend-item__avatar').textContent = f.avatar;
        li.querySelector('.lounge-friend-item__name').textContent = f.name;
        li.querySelector('.lounge-friend-item__status').textContent = Lounge.statusLabel(f);
        li.querySelector('button').disabled = !state.lounge.room;
      }
      for (const li of [...list.children]) {
        if (!seen.has(li.dataset.friendId)) li.remove();
      }
    },
  ```
  With:
  ```js
    renderLoungeFriends() {
      for (const listId of ['lounge-friends-list', 'lounge-friends-list-active']) {
        const list = document.getElementById(listId);
        if (!list) continue;
        const seen = new Set();
        for (const f of state.lounge.friends) {
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
            const inviteBtn = document.createElement('button');
            inviteBtn.type = 'button';
            inviteBtn.className = 'btn btn-secondary';
            inviteBtn.textContent = 'Invite to Room';
            inviteBtn.addEventListener('click', () => {
              Lounge.inviteFriendToRoom(f.id);
              UI.renderLoungeView();
            });
            li.append(avatar, name, status, inviteBtn);
            list.appendChild(li);
          }
          li.querySelector('.lounge-friend-item__avatar').textContent = f.avatar;
          li.querySelector('.lounge-friend-item__name').textContent = f.name;
          li.querySelector('.lounge-friend-item__status').textContent = Lounge.statusLabel(f);
          li.querySelector('button').disabled = !state.lounge.room;
        }
        for (const li of [...list.children]) {
          if (!seen.has(li.dataset.friendId)) li.remove();
        }
      }
    },
  ```

- [ ] **Step 2: Verify via Playwright.**
  - In the Lobby (no room), add a friend — confirm it appears in `#lounge-friends-list` with a *disabled* Invite button (unchanged behavior).
  - Create a room, navigate to the active-room view — confirm the same friend now also appears inside `#lounge-friends-list-active` (Left panel) with an *enabled* Invite button, and `#lounge-friends-list` (now hidden, since the Lobby is hidden) still holds the same friend row (both containers stay in sync even though only one is visible).
  - Click the Invite button inside `#lounge-friends-list-active` — confirm the friend is added to `state.lounge.room.members` **exactly once** (Review Focus: no duplicate-member bug from the two-container render), and that a new `.lounge-grid-card` for them appears in the Center panel's member grid.
  - Leave the room, confirm `#lounge-friends-list-active`'s rows are unaffected by the leave (the list itself lives on whether the *DOM element* exists, not on room state — leaving the room just hides its parent panel).
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 3: Commit.**
  ```bash
  git add index.html
  git commit -m "fix: keep Invite to Room reachable from the redesigned active-room dashboard"
  ```

---

### Task 4: Room activity log

**Files:**
- Modify: `index.html` — `Lounge` object (`_logActivity`, and one-line additions at 9 existing call sites), `createRoom`/`joinRoom` (init `activityLog: []`), `UI` object (`renderLoungeActivityLog`, and a trailing call added to `renderLoungeRoom()`).

**Interfaces:**
- Consumes: `state.lounge.room` (existing), `makeId()` (existing).
- Produces: `Lounge._logActivity(room, text)`, `room.activityLog` (new field), `UI.renderLoungeActivityLog()`.

- [ ] **Step 1: Add `activityLog: []` to both room constructors.** In `createRoom`, change:
  ```js
      state.lounge.room = {
        code: Lounge.generateRoomCode(),
        goal: (goalText || '').trim().slice(0, 80),
        hostId: 'self',
        members: [Lounge._makeSelfMember()],
        mission: null,
      };
  ```
  to:
  ```js
      state.lounge.room = {
        code: Lounge.generateRoomCode(),
        goal: (goalText || '').trim().slice(0, 80),
        hostId: 'self',
        members: [Lounge._makeSelfMember()],
        mission: null,
        activityLog: [],
      };
      Lounge._logActivity(state.lounge.room, 'You created the room.');
  ```
  In `joinRoom`, change:
  ```js
      state.lounge.room = {
        code, goal: '', hostId: `bot_${makeId()}`,
        members: [Lounge._makeSelfMember(), ...Lounge._randomBotRoster(botCount)],
        mission: null,
      };
  ```
  to:
  ```js
      state.lounge.room = {
        code, goal: '', hostId: `bot_${makeId()}`,
        members: [Lounge._makeSelfMember(), ...Lounge._randomBotRoster(botCount)],
        mission: null,
        activityLog: [],
      };
      Lounge._logActivity(state.lounge.room, 'You joined the room.');
  ```

- [ ] **Step 2: Add `_logActivity` and the remaining call sites.** Insert into the `Lounge` object, right after `titleForLevel(level) { ... }`:
  ```js
    _logActivity(room, text) {
      if (!room) return;
      room.activityLog.push({ id: makeId(), ts: Date.now(), text });
      if (room.activityLog.length > 500) room.activityLog.splice(0, room.activityLog.length - 500);
    },
  ```
  In `inviteFriendToRoom`, after the line `state.lounge.room.members.push(Lounge._makeBotMember(friend.name, friend.avatar));`, add:
  ```js
      Lounge._logActivity(state.lounge.room, `${friend.name} was invited to the room.`);
  ```
  In `startMission`, right before its final `return true;`, add:
  ```js
      Lounge._logActivity(room, `Sprint started: ${target} pomodoro${target > 1 ? 's' : ''}.`);
  ```
  In `cancelMission`, right after `room.mission = null;`, add:
  ```js
      Lounge._logActivity(room, 'Sprint cancelled.');
  ```
  In `onOwnPomodoroCompleted`, right after the line `if (self.missionProgress >= room.mission.targetPomodoros) self.missionState = 'checked-in';`, add:
  ```js
      if (self.missionState === 'checked-in') Lounge._logActivity(room, 'You checked in.');
  ```
  In `giveUpOwnMission`, right after `self.missionState = 'abandoned';`, add:
  ```js
      Lounge._logActivity(room, 'You gave up on the sprint.');
  ```
  In `_checkMissionCompletion`, right after `if (typeof Confetti !== 'undefined') Confetti.burst();` and before `room.mission = null;`, add:
  ```js
      Lounge._logActivity(room, '🎉 Everyone finished! Sprint complete.');
  ```
  In `_tickBot`'s focus-finish branch, right after `m.remainingMs = state.settings.shortBreak * 60000;` (the line that ends the focus-phase-complete block, before the mission-participation `if`), add:
  ```js
      Lounge._logActivity(room, `${m.name} completed a pomodoro.`);
  ```
  In that same branch's mission-participation block, right after `m.missionState = Math.random() < 0.85 ? 'checked-in' : 'abandoned';`, add:
  ```js
        Lounge._logActivity(room, `${m.name} ${m.missionState === 'checked-in' ? 'checked in' : 'abandoned the sprint'}.`);
  ```

- [ ] **Step 3: Add `renderLoungeActivityLog()` and wire it into `renderLoungeRoom()`.** Insert into the `UI` object, right after `renderLoungeMission() { ... }`:
  ```js
    renderLoungeActivityLog() {
      const list = document.getElementById('lounge-activity-log');
      if (!list) return;
      const room = state.lounge.room;
      if (!room) { list.replaceChildren(); list.dataset.rendered = '0'; return; }
      const log = room.activityLog;
      const start = Number(list.dataset.rendered || 0);
      if (start > log.length) list.replaceChildren();
      const wasNearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 20;
      for (let i = (start > log.length ? 0 : start); i < log.length; i++) {
        const li = document.createElement('li');
        li.className = 'lounge-activity-item';
        li.textContent = log[i].text;
        list.appendChild(li);
      }
      list.dataset.rendered = String(log.length);
      if (wasNearBottom) list.scrollTop = list.scrollHeight;
    },
  ```
  In `renderLoungeRoom()`, change its final line from:
  ```js
      UI.renderLoungeMission();
    },
  ```
  to:
  ```js
      UI.renderLoungeMission();
      UI.renderLoungeActivityLog();
    },
  ```

- [ ] **Step 4: Verify via Playwright.**
  - Create a room, confirm `#lounge-activity-log` immediately shows one line: "You created the room."
  - Join a room with bots, invite a friend, start a 1-Pomodoro sprint, complete it (force via `Timer.complete()` / direct mission-state manipulation as in prior sessions), let a bot resolve, cancel/restart — confirm the log accumulates the matching line for each action in order, with no duplicate or missing lines.
  - **Review Focus (cap actually trims):** `browser_evaluate`: push 501 synthetic entries directly (`for (let i=0;i<501;i++) Lounge._logActivity(state.lounge.room, 'x'+i);`) and confirm `state.lounge.room.activityLog.length === 500` and the surviving entries are the most recent ones (`activityLog[0].text === 'x1'`, not `'x0'`).
  - **Scroll preservation:** scroll the log panel to the top (away from the bottom), trigger one more activity event, confirm `list.scrollTop` is unchanged (didn't get yanked to the bottom); then scroll to the bottom, trigger another event, confirm it *does* auto-scroll to show the new line.
  - Leave the room and create/join a new one — confirm the activity log visibly resets (old lines gone, starts fresh with the new room's first "You created/joined the room." line), proving `list.dataset.rendered` and the DOM both reset correctly for a brand-new `room.activityLog`.
  - `browser_console_messages`: confirm no new errors.

- [ ] **Step 5: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add a live activity log to the Study Lounge dashboard"
  ```

---

### Task 5: Full regression sweep

**Files:**
- No new code expected; this task only edits `index.html` if the sweep finds something to fix.

- [ ] **Step 1: Full regression sweep of every pre-existing behavior.** Timer start/pause/reset/skip/mode-tabs and the 4-cycle auto-advance to long break; Planner task add/complete/delete; Missions & Skills card updates; Settings dialog (all 5 tabs) open/save/close; Reports and Leaderboard views; dark mode and mute toggles; background media/music independence. Check `browser_console_messages` after every exercised flow and confirm zero unexplained errors.

- [ ] **Step 2: Re-verify every Lounge Review Focus item from the previous session's plan still holds**, since this redesign touched `renderLoungeRoom`/`renderLoungeFriends`/room construction: no duplicate simulation interval across create/create/leave/double-leave; mission state resets cleanly between consecutive sprints; "Give Up" stays disabled after checking in; the solo-room mission guard (`members.length < 2`) still blocks starting a sprint and the disabled-button/hint still updates immediately on invite; a forced day rollover doesn't throw or corrupt an active room/mission; friends still show live simulated status independent of room state; the header chip and the mission-panel buttons still survive a tick-driven re-render without dropping a click (hold-click or rapid-click test on Start Sprint, Give Up, Cancel Sprint, and the header chip).

- [ ] **Step 3: XSS sweep on every new text-rendering surface.** A friend named `<img src=x onerror=alert(1)>` invited into a room must render as literal escaped text in both the Center panel's member-grid card and the Right panel's activity log line ("`<name> was invited to the room.`") — confirm via `innerHTML` inspection showing `&lt;`, and confirm no `<img>` element is ever created, no alert fires.

- [ ] **Step 4: Responsiveness and theming sweep.** At 1440px, 1100px (the new dashboard breakpoint), 768px, and 375px: confirm the 3-column dashboard, the Lobby's 2-column grid, the member grid's `auto-fill` card wrapping, and the activity log all reflow with no horizontal overflow. Toggle dark mode while in an active room: confirm every new element (panels, rings, grid cards, activity log) re-themes correctly via existing CSS variables with no hardcoded colors newly introduced.

- [ ] **Step 5: Fix anything the sweep finds, re-run the affected checks, then commit.**
  ```bash
  git add index.html
  git commit -m "test: full regression sweep for the Lounge dashboard redesign"
  ```
  (Skip this commit if Steps 1-4 found nothing to change.)

---

## Self-Review

**Spec coverage:** §1 layout breakout → Task 1. §2 new HTML structure → Tasks 1 (heading/lobby) and 2 (active-room dashboard). §3 CSS → Tasks 1/2. §4 rendering changes (`renderLoungeRoom`, `phaseFraction`, `renderLoungeFriends`) → Tasks 2/3. §5 activity log (data, call sites, rendering) → Task 4. §6 non-goals respected by construction (no chat composer, no new persistence, Lobby structure unchanged beyond `.glass`, Add Friend not duplicated). §7 regression guarantees → Task 5, and enforced throughout by never touching `renderLoungeMission`'s internals, the bot engine, or the reward path. §8 testing plan → mapped into each task's own verification step, consolidated in Task 5.

**Placeholder scan:** no TBD/TODO; every step has runnable code or a fully specified Playwright check.

**Type consistency:** `.lounge-grid-card`/`.lounge-ring*` class names introduced in Task 2 are used identically (never redefined) in later tasks. `room.activityLog` is initialized once per room constructor (Task 4 Step 1) and only ever mutated through `_logActivity` (Task 4 Step 2) — no task pushes to it directly. `renderLoungeFriends()`'s signature (no arguments) is unchanged from before this plan; only its body (Task 3) changes.

**Review Focus:** all five items have their test folded into the owning task's own verification step (Task 1 for the nav/view-switching check, Task 2 for dead-CSS grep and ring-fraction clamping, Task 3 for the duplicate-member check, Task 4 for the activity-log cap check).
