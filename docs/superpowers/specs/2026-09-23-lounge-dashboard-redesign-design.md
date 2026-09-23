# Study Lounge Dashboard Redesign — Design Spec

**Status:** Approved by user in conversation 2026-09-23. Applies to the existing `index.html` (single-file vanilla HTML/CSS/JS Pomodoro app, no build step). This is the first of four sub-projects decomposed from a larger request (Lounge redesign → Friends/DM enhancements → Profile modal + avatar upload → Auth/login system); the other three are explicitly out of scope here. This spec is additive/restructuring only to the existing Study Lounge feature (built across the previous session's spec/plan) — it does not touch Timer, Missions, Music, AI Assistant, Reports, or Leaderboard.

**Explicit scope decisions from brainstorming:**
- The request's right panel ("Room chat / real-time activity log") is built as an **activity log only** — no message composer. Real friend-to-friend chat is deferred to the Friends sub-project, so it isn't built twice.
- Each member's progress ring represents their **current focus/rest phase elapsed fraction**, not mission progress — derived from data already tracked (`remainingMs` + `state.settings`), no new per-member fields needed.
- The 3-column dashboard layout applies **only to the active-room state**. The Lobby (Friends + Create/Join, no room yet) keeps its existing 2-column structure, just inside the same wider outer container.

**Deviation from the literal request, with rationale (flagging for spec review):** the request's own layout only lists Room/Sprint (left), Members (center), and Activity (right) — it doesn't mention Friends for the active-room state at all. But the previous session's Critical review finding was that "Invite to Room" must stay reachable while a room is active; hiding the whole Friends section whenever `#lounge-active` is shown would silently reintroduce that exact bug. This spec keeps Friends reachable during an active room by rendering a second, compact friends-with-Invite-button list inside the **Left panel**, below the room header (see §4). The Lobby's "Add Friend" form is not duplicated there — adding a *new* friend still happens from the Lobby; only inviting an *existing* friend is exposed from inside an active room, which is all last session's fix actually guaranteed.

## 1. Layout: breaking out of the 1040px column

Every other view (`#view-dashboard`, `#view-reports`, `#view-leaderboard`) lives inside `<main>`, which is hard-capped at `max-width: 1040px; margin: 0 auto;`. `#view-lounge` moves to be a **sibling of `<main>`** (same nesting level as `header`/`nav.top-nav`/`main`, placed immediately after `</main>`), with its own cap:

```css
#view-lounge { max-width: 1440px; margin: 0 auto; padding: 16px clamp(16px, 4vw, 32px) 120px; }
```

`UI.selectView`/`UI.selectView`'s nav-wiring in `UI.init()` both look up views by `document.getElementById('view-${v}')` and only ever toggle `.hidden` — neither depends on DOM position, so this move has zero logic risk.

**Card unification:** `#view-lounge` itself drops its current `class="glass"` (it becomes a plain layout wrapper, like `<main>` already is). Every visual card inside it — the Lobby's two `<section>`s and the three new active-room panels — gets `class="glass"` individually instead. This matches how every other card in the app already works (`#timer`, `#missions`, `#tasks`, `#ai-chat` are each their own `.glass` element, never nested inside another `.glass` ancestor) and avoids stacking two `backdrop-filter: blur()` layers, which would look muddier than either alone.

## 2. New HTML structure

```html
<!-- moved to be a sibling of <main>, immediately after </main> -->
<div id="view-lounge" aria-label="Study Lounge" hidden>
  <div class="lounge-heading">
    <h2>Study Lounge</h2>
    <p class="field-hint">Demo Mode — friends and group members here are simulated locally; nothing is sent over the network.</p>
  </div>
  <div class="lounge-lobby-grid">
    <section class="glass" aria-label="Friends">
      <h3>Friends</h3>
      <ul class="lounge-friends-list" id="lounge-friends-list"></ul>
      <form id="lounge-add-friend-form" class="lounge-inline-form">
        <input type="text" id="lounge-friend-name-input" maxlength="24" placeholder="Friend's name" aria-label="Friend's name" required>
        <select id="lounge-friend-avatar-select" aria-label="Friend's avatar"></select>
        <button type="submit" class="btn btn-secondary">Add Friend</button>
      </form>
    </section>
    <section class="glass" aria-label="Room">
      <div id="lounge-lobby">
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
      </div>
    </section>
  </div>

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
</div>
```

Note `#lounge-lobby-grid`'s two `<section>`s and `#lounge-lobby`/`#lounge-active` keep their existing ids/toggle semantics (`renderLoungeView()`'s `lobby.hidden = inRoom; active.hidden = !inRoom;` is unchanged). `#lounge-members-list` (the old `<ul>`) is removed; `#lounge-member-grid` replaces it structurally but is rendered by different code (§4).

## 3. CSS

```css
.lounge-heading { max-width: 1440px; margin: 0 auto 8px; }
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
.lounge-panel h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 18px 0 10px; font-weight: 700; }
.lounge-panel--left h3:first-of-type { margin-top: 20px; }

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

.lounge-activity-log { list-style: none; margin: 12px 0 0; padding: 0; max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.lounge-activity-item { font-size: 0.82rem; color: var(--text-muted); padding: 8px 10px; border-radius: var(--radius-sm); background: rgba(36, 31, 28, 0.04); }
```

(`--accent-shortBreak` and `--border`/`--radius-lg`/`--radius-md`/`--radius-sm`/`--shadow-md`/`--text-muted` all already exist and are reused verbatim — no new CSS variables.)

## 4. Rendering changes

**`renderLoungeRoom()`** — rewritten to target `#lounge-member-grid` and build `.lounge-grid-card` elements instead of `.lounge-member-item` list rows:

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
    const avatar = document.createElement('span');
    avatar.className = 'lounge-ring__avatar';
    avatar.textContent = m.avatar;
    ring.append(svg, avatar);

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
  UI.renderLoungeActivityLog();
},
```

This still does a full `replaceChildren()` every tick — same as before this redesign (already ledgered last session as a deferred Minor, since member cards have no interactive children, only the friends-invite buttons and mission-panel buttons do, and neither lives in this grid).

**`Lounge.phaseFraction(member)`** (new, pure function, no state changes):

```js
phaseFraction(m) {
  if (m.status === 'idle') return 0;
  const totalMs = (m.status === 'focusing' ? state.settings.pomodoro : state.settings.shortBreak) * 60000;
  return totalMs > 0 ? Math.min(1, Math.max(0, 1 - m.remainingMs / totalMs)) : 0;
},
```

**`renderLoungeFriends()`** — extended to populate *both* possible friend-list containers (only one is ever visible at a time, but keeping both in sync costs nothing and avoids branching on room state inside the render function):

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
        inviteBtn.addEventListener('click', () => { Lounge.inviteFriendToRoom(f.id); UI.renderLoungeView(); });
        li.append(avatar, name, status, inviteBtn);
        list.appendChild(li);
      }
      li.querySelector('.lounge-friend-item__avatar').textContent = f.avatar;
      li.querySelector('.lounge-friend-item__name').textContent = f.name;
      li.querySelector('.lounge-friend-item__status').textContent = Lounge.statusLabel(f);
      li.querySelector('button').disabled = !state.lounge.room;
    }
    for (const li of [...list.children]) { if (!seen.has(li.dataset.friendId)) li.remove(); }
  }
},
```

(Identical body to the current function, just wrapped in a loop over two container ids instead of one hardcoded id.)

## 5. Activity log

**Data:** `room.activityLog` — a plain array of `{ id, ts, text }`, initialized to `[]` in both `createRoom` and `joinRoom`. Not persisted (the whole room already isn't). A generous safety-valve cap (500 entries, `splice`d from the front) prevents unbounded growth in an extremely long session — this is *not* meant to be the active UI-facing limit (30-ish entries is what a session will realistically ever show); it exists purely so the array can never grow without bound.

```js
_logActivity(room, text) {
  if (!room) return;
  room.activityLog.push({ id: makeId(), ts: Date.now(), text });
  if (room.activityLog.length > 500) room.activityLog.splice(0, room.activityLog.length - 500);
},
```

**Call sites** (each a one-line addition at an existing point in the code):
- `createRoom`: `Lounge._logActivity(state.lounge.room, 'You created the room.')`
- `joinRoom`: `Lounge._logActivity(state.lounge.room, 'You joined the room.')`
- `inviteFriendToRoom`: `Lounge._logActivity(state.lounge.room, \`${friend.name} was invited to the room.\`)`
- `startMission` (on success): `Lounge._logActivity(room, \`Sprint started: ${target} pomodoro${target > 1 ? 's' : ''}.\`)`
- `cancelMission`: `Lounge._logActivity(room, 'Sprint cancelled.')`
- `onOwnPomodoroCompleted` (when self's `missionState` becomes `'checked-in'`): `Lounge._logActivity(room, 'You checked in.')`
- `giveUpOwnMission` (on success): `Lounge._logActivity(room, 'You gave up on the sprint.')`
- `_tickBot`'s focus-finish branch: `Lounge._logActivity(room, \`${m.name} completed a pomodoro.\`)` — called unconditionally; safe because `_logActivity` itself no-ops on a `null` room, which is what `_tickBot` passes for friends outside any room
- `_tickBot`'s mission-resolve branch (inside the existing `if (room && room.mission ...)` block, so `room` is never null here): `Lounge._logActivity(room, \`${m.name} ${m.missionState === 'checked-in' ? 'checked in' : 'abandoned the sprint'}.\`)`
- `_checkMissionCompletion` (on success, before resetting `room.mission = null`): `Lounge._logActivity(room, '🎉 Everyone finished! Sprint complete.')`

**Rendering (append-only, scroll-preserving):**

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

Only ever appends new `<li>`s (or does one full rebuild if the log somehow shrank below what was already rendered — the 500-cap safety valve makes this practically unreachable, but the guard keeps it correct rather than silently wrong). Auto-scrolls to the newest entry only when the user was already at (or near) the bottom, so scrolling up to read history is never fought by the tick-driven re-render — this directly reuses the "never disrupt an in-progress user interaction from a recurring re-render" lesson from last session's review (there it was about dropped clicks; here it's about scroll position).

`renderLoungeRoom()` calls `UI.renderLoungeActivityLog()` at its end (§4), so it updates on the same cadence as the rest of the room dashboard — once per engine tick while the Lounge view is open, plus immediately after any explicit action (create/join/invite/start/cancel/give-up).

## 6. Non-goals

- No message composer or real chat in the activity log panel (deferred to the Friends sub-project).
- No new `localStorage` persistence — the activity log lives and dies with `state.lounge.room`, exactly like everything else in it.
- The Lobby's internal structure (Friends + Create/Join, 2 columns) is unchanged beyond gaining `class="glass"` on its two `<section>`s and living in the wider outer container.
- "Add Friend" is not duplicated into the active-room Left panel — only inviting an *existing* friend is exposed there (see the Deviation note above).

## 7. Regression guarantees

- `renderLoungeMission()`'s internal logic (idle/active skeleton-once pattern, solo-mission guard, Give-Up-disabled-after-checkin) is untouched — only its container moves from directly inside `#lounge-active` to inside the new Left panel `<section>`.
- The header chip (`renderLoungeChip()`), the mission completion reward/confetti/sound path, the bot simulation engine (`_tick`/`_tickBot`/`_syncEngine`), and every Review Focus item from the previous session's plan remain byte-for-byte unchanged in logic — this spec only adds `_logActivity` calls alongside existing logic, never replaces it.
- "Invite to Room" stays reachable at all times a room is active (via the new compact friends list in the Left panel), preserving the previous session's Critical fix.
- No existing `Storage.*` key changes; the only new field (`room.activityLog`) lives on the already-non-persisted `state.lounge.room` object.

## 8. Testing plan (manual — Playwright against the app served over http://, per the existing convention in this repo)

1. Load the app; confirm Dashboard/Reports/Leaderboard/Timer/Missions/Music/AI Assistant are all unaffected.
2. Open Study Lounge with no room active: confirm the Lobby still shows Friends + Create/Join as two `.glass` cards, now inside the wider `#view-lounge` container, with no horizontal overflow at 1440px, 1024px, and 375px.
3. Create a room: confirm the 3-column dashboard appears (Left: room header + friends-invite + sprint controls; Center: member grid with rings; Right: activity log), and that the activity log shows "You created the room."
4. Resize below 1100px: confirm the 3 panels stack to a single column in order (Left, Center, Right) with no overflow.
5. Add a friend from the Lobby, return to the active room, confirm the friend appears in the Left panel's compact list with a working Invite button (this is the regression check for the previous session's Critical fix).
6. Join a room with bots; watch the member grid over several seconds — confirm each ring's fill animates smoothly as `remainingMs` counts down, an idle bot's ring goes empty/muted, and the activity log gains a line the instant a bot completes a pomodoro, without the log's own scroll position jumping if the user has scrolled up.
7. Start a sprint, complete it (or force it), cancel one, and abandon one — confirm the activity log records each transition and the mission panel (now inside the Left panel) behaves exactly as before (progress text, chips, Give Up disabled after checking in, solo-room guard).
8. Confirm dark mode reflows the new panels correctly (all colors via existing CSS variables, no hardcoded hex introduced here).
