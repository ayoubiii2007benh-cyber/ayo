# Pomodoro Timer + Daily Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** This plan targets a *single evolving file* (`index.html`), not a multi-file codebase, and there is no unit-test framework (no build step, no package.json, per the spec's constraints). "Tests" in this plan are concrete Playwright browser interactions/assertions or `node -e` static checks, run against the file directly via `file://`. Because every task edits the same file, prefer inline execution by one agent that holds the whole file in context over parallel per-task subagents.

**Goal:** Build a single-file (`index.html`) Pomodoro Timer + Daily Planner web app: accurate drift-free timer, task planner with Pomodoro tracking, custom image/video/YouTube backgrounds with a floating media player, settings with persistence, all vanilla HTML/CSS/ES6+, no frameworks, no build step.

**Architecture:** One HTML file with a `<style>` block (CSS custom properties driving a 3-theme system), semantic HTML (`header`, `main > #timer, #tasks`, `dialog#settings`, a floating media-control panel), and one `<script>` block organized into plain namespaced objects (`Storage`, `State`, `Timer`, `Planner`, `Media`, `YouTube`, `Audio`, `UI`) communicating through a single in-memory `state` object. No modules/bundler — everything loads via one `<script>` tag.

**Tech Stack:** HTML5, CSS3 (custom properties, `backdrop-filter`, `@supports`), vanilla ES6+ JavaScript, Web Audio API, YouTube IFrame API (loaded lazily from `https://www.youtube.com/iframe_api`), Google Fonts (`<link>`). Testing via Playwright MCP browser tools against the local `file://` path.

**Spec:** The user's master prompt (pasted in-conversation, sections 1–53) is the authoritative product spec — no separate spec file was written since it was already exhaustive and this is a single-deliverable, non-git project.

## Global Constraints

- Everything must live in one file: `index.html`. No other files, no build system.
- No frameworks/libraries beyond: Google Fonts (stylesheet only), YouTube IFrame API (script, loaded lazily).
- Never use `innerHTML`/`insertAdjacentHTML` for user-controlled text (task text, URLs). Use `textContent`/DOM APIs only.
- localStorage keys are exactly: `appSettings`, `tasks`, `stats`, `mediaSettings`. All four load through validating wrappers that fall back to defaults on any corruption and never throw.
- Timer defaults: Pomodoro 25min, Short Break 5min, Long Break 15min. `autoStartBreaks`/`autoStartPomodoros` default `false`.
- Timer must be timestamp-based (`Date.now()` deltas), never a naive per-second decrement, and must guard against duplicate intervals and duplicate completion firing.
- No GitHub use of any kind. No personal/user information anywhere in the app or code.
- Support `prefers-reduced-motion`. No horizontal overflow at any viewport width down to 320px.

---

## Shared Data Shapes (referenced by every task below)

```js
// In-memory state (State namespace owns this)
const state = {
  settings: {            // localStorage key "appSettings"
    pomodoro: 25,           // minutes, int 1-180
    shortBreak: 5,           // minutes, int 1-90
    longBreak: 15,          // minutes, int 1-180
    autoStartBreaks: false,
    autoStartPomodoros: false,
  },
  tasks: [],              // localStorage key "tasks" -> { tasks, activeTaskId }
  activeTaskId: null,
  stats: {                // localStorage key "stats"
    date: '2026-09-22',     // YYYY-MM-DD, local date
    pomodorosCompletedToday: 0,
  },
  mediaSettings: {        // localStorage key "mediaSettings"
    type: 'default',        // 'default' | 'image' | 'video' | 'youtube'
    imageUrl: '',
    videoUrl: '',
    youtubeId: '',
    playbackMode: 'background', // 'audio' | 'background' (youtube only)
    volume: 0.5,             // 0-1
    muted: false,
  },
  timer: {                // NOT persisted
    mode: 'pomodoro',        // 'pomodoro' | 'shortBreak' | 'longBreak'
    running: false,
    endAt: null,             // ms epoch, when running
    remainingMs: 25 * 60000,
    cyclesCompleted: 0,       // pomodoros completed since last long break, 0-3
  },
};

// Task shape
// { id: string, text: string, completed: boolean, estimatedPomodoros: number, completedPomodoros: number }
```

---

### Task 1: HTML skeleton, CSS theme system, boot script

**Files:**
- Create: `index.html`

**Interfaces:**
- Produces: DOM structure with IDs every later task depends on:
  - `<html data-mode="pomodoro">` (mode drives theme via CSS `[data-mode]` selectors)
  - `header` containing `h1#app-title` ("Pomodoro") and `button#settings-btn`
  - `main` containing `section#timer` and `section#tasks`
  - Inside `#timer`: `#active-task-display`, `#timer-mode-label`, `#timer-display`, `button#timer-toggle`, `button#timer-reset`, `button#timer-skip`, `#pomodoro-count`
  - Inside `#tasks`: `h2` "Today's Plan", `form#task-form` with `input#task-input` and `input#task-estimate`, `ul#task-list`, `#task-empty-state`
  - `dialog#settings` with form fields `#setting-pomodoro`, `#setting-short-break`, `#setting-long-break`, `#setting-auto-break`, `#setting-auto-pomodoro`, `button#settings-save`, `button#settings-close`
  - `div#background-layer` (fixed, full-viewport, behind everything, `z-index: -1`) and `div#background-overlay`
  - `div#media-panel` (floating player, initially hidden) with `button#media-play`, `button#media-mute`, `input#media-volume`
  - `<script>` block with an empty boot sequence: `document.addEventListener('DOMContentLoaded', () => UI.init())` where `UI` is a stub object with `init(){}` plus two fully-working helpers other tasks rely on from the start: `showMediaPanel(){}`/`hideMediaPanel(){}` that toggle `#media-panel`'s `hidden` attribute (defined in full below, not as no-ops, so later tasks can call them without forward-reference guards)
- Consumes: nothing (first task)

- [ ] **Step 1: Write `index.html` with `<!DOCTYPE html>`, `<head>` (charset, viewport meta, title "Pomodoro App", Google Fonts link e.g. Inter/Manrope, empty `<style>` block) and `<body>` containing the structure listed above.**

  Boot script for this task (later tasks add to `UI` and add the `DOMContentLoaded` body, but `showMediaPanel`/`hideMediaPanel` are complete now so any later task can call them safely):
  ```js
  const UI = {
    init() {},
    showMediaPanel() { const el = document.getElementById('media-panel'); if (el) el.hidden = false; },
    hideMediaPanel() { const el = document.getElementById('media-panel'); if (el) el.hidden = true; },
  };
  document.addEventListener('DOMContentLoaded', () => UI.init());
  ```

  Key CSS to include in this task (theme tokens + base layout, in the `<style>` block):
  ```css
  :root {
    --bg: #faf8f6;
    --surface: #ffffff;
    --text: #1c1917;
    --text-muted: #78716c;
    --accent: #e0654f;       /* pomodoro default */
    --accent-soft: #f9e1dc;
    --radius: 16px;
    --shadow: 0 10px 30px rgba(0,0,0,0.08);
    --transition-fast: 0.2s ease;
    --transition-theme: 0.5s ease;
  }
  html[data-mode="shortBreak"] { --accent: #2f9e8f; --accent-soft: #d9f2ee; }
  html[data-mode="longBreak"]  { --accent: #5b4b9e; --accent-soft: #e6e1f7; }
  body {
    margin: 0; min-height: 100vh; color: var(--text); background: var(--bg);
    font-family: 'Inter', system-ui, sans-serif;
    transition: background-color var(--transition-theme);
  }
  * { box-sizing: border-box; }
  #background-layer { position: fixed; inset: 0; z-index: -2; overflow: hidden; pointer-events: none; }
  #background-overlay { position: fixed; inset: 0; z-index: -1; background: rgba(0,0,0,0); pointer-events: none; transition: background-color var(--transition-theme); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
  }
  ```

- [ ] **Step 2: Open the file directly in a browser (via Playwright `browser_navigate` to the `file://` path) and take a snapshot/screenshot.**

  Expected: page renders header/timer/tasks/settings sections with placeholder text, no console errors, no horizontal scrollbar at 375px and 1440px widths (`browser_resize`).

- [ ] **Step 3: Verify no console errors.**

  Use `browser_console_messages` — expected: empty or no `error` level entries.

---

### Task 2: Storage layer with validation

**Files:**
- Modify: `index.html` (add to `<script>` block, above `UI`)

**Interfaces:**
- Produces:
  - `Storage.loadSettings(): SettingsObject` — reads `localStorage.appSettings`, validates each field (int, in range: pomodoro 1-180, shortBreak 1-90, longBreak 1-180, booleans for auto-start), merges valid fields over defaults, ignores/repairs invalid ones field-by-field (not all-or-nothing).
  - `Storage.saveSettings(settings)`
  - `Storage.loadTasksAndActive(): { tasks: Task[], activeTaskId: string|null }` — reads `localStorage.tasks`, validates it's `{tasks: Array, activeTaskId}`, filters out malformed task entries (missing `id`/`text`, wrong types), coerces `estimatedPomodoros`/`completedPomodoros` to non-negative integers, verifies `activeTaskId` still references a surviving task else `null`.
  - `Storage.saveTasksAndActive(tasks, activeTaskId)`
  - `Storage.loadStats(): {date, pomodorosCompletedToday}` — reads `localStorage.stats`, validates `date` is `YYYY-MM-DD` string and count is a non-negative integer, else defaults to today/0.
  - `Storage.saveStats(stats)`
  - `Storage.loadMediaSettings(): MediaSettings` — validates `type` is one of the 4 enum values, URLs are strings, `volume` is 0-1 number, `muted` boolean; falls back per-field to defaults.
  - `Storage.saveMediaSettings(mediaSettings)`
  - Every `load*` function is wrapped so a thrown `JSON.parse` error, a non-object value, `null`, or missing key all resolve to the default value — never throws to the caller.
- Consumes: the shared data shapes above (default values live in this task).

- [ ] **Step 1: Implement the `Storage` namespace.**

  ```js
  const DEFAULT_SETTINGS = { pomodoro: 25, shortBreak: 5, longBreak: 15, autoStartBreaks: false, autoStartPomodoros: false };
  const DEFAULT_MEDIA = { type: 'default', imageUrl: '', videoUrl: '', youtubeId: '', playbackMode: 'background', volume: 0.5, muted: false };

  function safeParse(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : null;
    } catch { return null; }
  }
  function clampInt(v, min, max, fallback) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }

  const Storage = {
    loadSettings() {
      const raw = safeParse('appSettings') || {};
      return {
        pomodoro: clampInt(raw.pomodoro, 1, 180, DEFAULT_SETTINGS.pomodoro),
        shortBreak: clampInt(raw.shortBreak, 1, 90, DEFAULT_SETTINGS.shortBreak),
        longBreak: clampInt(raw.longBreak, 1, 180, DEFAULT_SETTINGS.longBreak),
        autoStartBreaks: typeof raw.autoStartBreaks === 'boolean' ? raw.autoStartBreaks : DEFAULT_SETTINGS.autoStartBreaks,
        autoStartPomodoros: typeof raw.autoStartPomodoros === 'boolean' ? raw.autoStartPomodoros : DEFAULT_SETTINGS.autoStartPomodoros,
      };
    },
    saveSettings(settings) { localStorage.setItem('appSettings', JSON.stringify(settings)); },

    loadTasksAndActive() {
      const raw = safeParse('tasks') || {};
      const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
      const tasks = tasksRaw.filter(t => t && typeof t.id === 'string' && typeof t.text === 'string').map(t => ({
        id: t.id,
        text: t.text.slice(0, 500),
        completed: !!t.completed,
        estimatedPomodoros: clampInt(t.estimatedPomodoros, 1, 99, 1),
        completedPomodoros: clampInt(t.completedPomodoros, 0, 999, 0),
      }));
      const activeTaskId = tasks.some(t => t.id === raw.activeTaskId) ? raw.activeTaskId : null;
      return { tasks, activeTaskId };
    },
    saveTasksAndActive(tasks, activeTaskId) { localStorage.setItem('tasks', JSON.stringify({ tasks, activeTaskId })); },

    loadStats() {
      const raw = safeParse('stats') || {};
      const dateOk = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date);
      return {
        date: dateOk ? raw.date : todayStr(),
        pomodorosCompletedToday: clampInt(raw.pomodorosCompletedToday, 0, 999, 0),
      };
    },
    saveStats(stats) { localStorage.setItem('stats', JSON.stringify(stats)); },

    loadMediaSettings() {
      const raw = safeParse('mediaSettings') || {};
      const types = ['default', 'image', 'video', 'youtube'];
      return {
        type: types.includes(raw.type) ? raw.type : DEFAULT_MEDIA.type,
        imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : DEFAULT_MEDIA.imageUrl,
        videoUrl: typeof raw.videoUrl === 'string' ? raw.videoUrl : DEFAULT_MEDIA.videoUrl,
        youtubeId: typeof raw.youtubeId === 'string' ? raw.youtubeId : DEFAULT_MEDIA.youtubeId,
        playbackMode: ['audio', 'background'].includes(raw.playbackMode) ? raw.playbackMode : DEFAULT_MEDIA.playbackMode,
        volume: (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) ? raw.volume : DEFAULT_MEDIA.volume,
        muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_MEDIA.muted,
      };
    },
    saveMediaSettings(m) { localStorage.setItem('mediaSettings', JSON.stringify(m)); },
  };

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  ```

- [ ] **Step 2: Verify with Playwright `browser_evaluate`.**

  Run in-page: `localStorage.setItem('appSettings','not json'); localStorage.setItem('stats', JSON.stringify({date:'bad', pomodorosCompletedToday:-5})); location.reload();`
  Then evaluate `Storage.loadSettings()` and `Storage.loadStats()`.
  Expected: settings equal `DEFAULT_SETTINGS`; stats has today's date and `pomodorosCompletedToday === 0`; no thrown exception, no console error.

- [ ] **Step 3: Verify malformed tasks payload is filtered, not fatal.**

  `localStorage.setItem('tasks', JSON.stringify({tasks: [{id:'a',text:'ok'}, {id:1,text:2}, null], activeTaskId:'ghost'}))`, reload, evaluate `Storage.loadTasksAndActive()`.
  Expected: only the `{id:'a',text:'ok'}` entry survives (with defaulted numeric fields), `activeTaskId` is `null`.

---

### Task 3: Timer engine (accurate, drift-free, single-interval)

**Files:**
- Modify: `index.html` (add `Timer` namespace to `<script>`)

**Interfaces:**
- Consumes: `state.settings`, `state.timer` (Shared Data Shapes above), DOM IDs from Task 1 (`#timer-display`, `#timer-mode-label`, `#timer-toggle`, `#timer-reset`, `#timer-skip`, `#pomodoro-count`), `html[data-mode]` attribute.
- Produces:
  - `Timer.formatTime(ms): string` → `"MM:SS"`, floor-rounded.
  - `Timer.durationMs(mode): number` → `state.settings[mode] * 60000`.
  - `Timer.start()` — no-op if already running or already has an interval; sets `state.timer.endAt = Date.now() + state.timer.remainingMs`, `running = true`, starts the single interval if not already started.
  - `Timer.pause()` — freezes `remainingMs = endAt - Date.now()`, `running = false`, clears nothing (interval keeps running globally but `tick()` is a no-op when `!running`; simplest correct option — see Step 1).
  - `Timer.reset()` — sets `remainingMs = Timer.durationMs(mode)`, `running = false`, `endAt = null`.
  - `Timer.skip()` — calls `Timer._advanceMode(false)` (advance without counting a completion).
  - `Timer.tick()` — interval callback; if `running`, recompute `remaining = endAt - Date.now()`; if `remaining <= 0` call `Timer.complete()` exactly once; else update display.
  - `Timer.complete()` — guarded by `state.timer._completing` flag set/cleared around the call so re-entrant/duplicate calls in the same event loop turn are no-ops; plays sound, updates stats/task via `Planner.onPomodoroCompleted()` (Task 6 defines this; Task 3 calls it if it exists, else skips — see Step 4), then calls `Timer._advanceMode(true)`.
  - `Timer._advanceMode(wasCompleted)` — implements section 14 cycle logic (Task 4 extends this with the 4-cycle rule; Task 3 implements the basic pomodoro↔break alternation only).
  - `Timer.updateTimerDisplay()` — writes formatted time, mode label, and document title (Task 3 also owns `document.title`).
  - Module-private: a single `let intervalId = null;` — `start()` only calls `setInterval` if `intervalId === null`; nothing else ever creates an interval.
- Produces (module-private helper reused by Task 4): `Timer.MODE_LABELS = { pomodoro: 'Focus!', shortBreak: 'Short Break', longBreak: 'Long Break' }` and `Timer.MODE_DISPLAY = { pomodoro: 'Pomodoro', shortBreak: 'Short Break', longBreak: 'Long Break' }` (title uses `MODE_LABELS`; on-screen mode heading uses `MODE_DISPLAY`).

- [ ] **Step 1: Implement `Timer` with the interval guard and timestamp math.**

  ```js
  const Timer = {
    MODE_LABELS: { pomodoro: 'Focus!', shortBreak: 'Short Break', longBreak: 'Long Break' },
    MODE_DISPLAY: { pomodoro: 'Pomodoro', shortBreak: 'Short Break', longBreak: 'Long Break' },
    _intervalId: null,

    formatTime(ms) {
      const totalSec = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    },
    durationMs(mode) { return state.settings[mode] * 60000; },

    start() {
      if (state.timer.running) return;
      state.timer.endAt = Date.now() + state.timer.remainingMs;
      state.timer.running = true;
      if (Timer._intervalId === null) {
        Timer._intervalId = setInterval(Timer.tick, 250);
      }
      Timer.updateTimerDisplay();
      UI.renderTimerControls();
    },
    pause() {
      if (!state.timer.running) return;
      state.timer.remainingMs = Math.max(0, state.timer.endAt - Date.now());
      state.timer.running = false;
      state.timer.endAt = null;
      Timer.updateTimerDisplay();
      UI.renderTimerControls();
    },
    reset() {
      state.timer.running = false;
      state.timer.endAt = null;
      state.timer.remainingMs = Timer.durationMs(state.timer.mode);
      Timer.updateTimerDisplay();
      UI.renderTimerControls();
    },
    skip() { Timer._advanceMode(false); },

    tick() {
      if (!state.timer.running) return;
      const remaining = state.timer.endAt - Date.now();
      if (remaining <= 0) { Timer.complete(); return; }
      state.timer.remainingMs = remaining;
      Timer.updateTimerDisplay();
    },

    complete() {
      if (state.timer._completing) return;
      state.timer._completing = true;
      state.timer.running = false;
      state.timer.remainingMs = 0;
      Timer.updateTimerDisplay();
      Audio.playCompletionSound();
      if (state.timer.mode === 'pomodoro' && typeof Planner !== 'undefined' && Planner.onPomodoroCompleted) {
        Planner.onPomodoroCompleted();
      }
      Timer._advanceMode(true);
      state.timer._completing = false;
    },

    _advanceMode(wasCompleted) {
      const next = state.timer.mode === 'pomodoro' ? 'shortBreak' : 'pomodoro';
      state.timer.mode = next;
      document.documentElement.setAttribute('data-mode', next);
      state.timer.remainingMs = Timer.durationMs(next);
      state.timer.endAt = null;
      const shouldAutoStart = next === 'pomodoro' ? state.settings.autoStartPomodoros : state.settings.autoStartBreaks;
      state.timer.running = false;
      Timer.updateTimerDisplay();
      UI.renderTimerControls();
      if (shouldAutoStart) Timer.start();
    },

    updateTimerDisplay() {
      const el = document.getElementById('timer-display');
      if (el) el.textContent = Timer.formatTime(state.timer.remainingMs);
      const label = document.getElementById('timer-mode-label');
      if (label) label.textContent = Timer.MODE_DISPLAY[state.timer.mode];
      document.title = state.timer.running
        ? `(${Timer.formatTime(state.timer.remainingMs)}) ${Timer.MODE_LABELS[state.timer.mode]} - Pomodoro App`
        : 'Pomodoro App';
    },
  };
  ```

  Note: Task 4 will replace `_advanceMode` with the full 4-cycle version — this step's simpler alternation exists only so Task 3 is independently testable.

- [ ] **Step 2: Wire `#timer-toggle`/`#timer-reset`/`#timer-skip` click listeners (in `UI.init`, stubbed if `UI` doesn't fully exist yet — add a minimal `UI.renderTimerControls` that sets the toggle button's label to "Pause"/"Play" based on `state.timer.running`).**

- [ ] **Step 3: Verify no duplicate intervals via Playwright.**

  `browser_evaluate`: monkey-patch — before starting, `let calls = 0; const orig = setInterval; window.setInterval = (...a) => { calls++; return orig(...a); };` then click start twice (`browser_click` on `#timer-toggle` — note: toggle should call `start()` only when not running; clicking again should call `pause()`, so instead directly call `Timer.start()` twice via `browser_evaluate`). Expected: `calls === 1`.

- [ ] **Step 4: Verify drift-free behavior under simulated delay.**

  `browser_evaluate`: `Timer.reset(); Timer.start(); state.timer.endAt -= 5000;` (simulate 5s having passed) then read `state.timer.remainingMs` after the next tick (wait ~300ms via the harness or call `Timer.tick()` directly). Expected: `remainingMs` reflects the full 5000ms jump, not a 1-unit decrement — proving the calculation is timestamp-based, not a counter.

- [ ] **Step 5: Verify the browser tab title updates and resets.**

  Start the timer, evaluate `document.title` matches `/^\(\d{2}:\d{2}\) Focus! - Pomodoro App$/`. Call `Timer.pause()`, expect `document.title === 'Pomodoro App'`.

---

### Task 4: Full Pomodoro cycle (4-cycle long break) + theme transitions

**Files:**
- Modify: `index.html` (`Timer._advanceMode`, add cycle counting; extend CSS)

**Interfaces:**
- Consumes: `Timer` from Task 3, `state.timer.cyclesCompleted`.
- Produces: `Timer._advanceMode` replaced with cycle-aware version; `#pomodoro-count` reflects `state.stats.pomodorosCompletedToday` (wired fully in Task 6, but the element update call is added here as a no-op-safe `UI.renderPomodoroCount()` stub).

- [ ] **Step 1: Replace `_advanceMode` to implement the standard cycle from spec section 14: Pomodoro → Short Break ×3, then Pomodoro → Long Break, repeat.**

  ```js
  _advanceMode(wasCompleted) {
    let next;
    if (state.timer.mode === 'pomodoro') {
      if (wasCompleted) state.timer.cyclesCompleted++;
      next = (state.timer.cyclesCompleted > 0 && state.timer.cyclesCompleted % 4 === 0) ? 'longBreak' : 'shortBreak';
    } else {
      next = 'pomodoro';
    }
    state.timer.mode = next;
    document.documentElement.setAttribute('data-mode', next);
    state.timer.remainingMs = Timer.durationMs(next);
    state.timer.endAt = null;
    state.timer.running = false;
    const shouldAutoStart = next === 'pomodoro' ? state.settings.autoStartPomodoros : state.settings.autoStartBreaks;
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    if (shouldAutoStart) Timer.start();
  },
  ```

  `skip()` calling `_advanceMode(false)` means skipping a pomodoro does NOT count toward the 4-cycle — only genuine completions do (matches "completed Pomodoros" framing in the spec).

- [ ] **Step 2: Add theme transition CSS confirmation — ensure `html[data-mode]` selectors from Task 1 cover all three modes and `body`/`#timer` background-color transitions use `var(--transition-theme)`.**

- [ ] **Step 3: Verify the 4th pomodoro triggers Long Break.**

  Playwright `browser_evaluate`: loop — for `i` in 1..4: `Timer.reset(); state.timer.remainingMs = 1; Timer.start(); Timer.tick();` (forces immediate completion) and record `state.timer.mode` after each pomodoro's completion resolves. Expected sequence of modes after each pomodoro completion: `shortBreak, shortBreak, shortBreak, longBreak` (after completions 1,2,3,4), and after the 4th break completes, mode returns to `pomodoro` with `cyclesCompleted` still `4` (next long break at cycle 8).

- [ ] **Step 4: Verify auto-start settings behavior both ways.**

  Set `state.settings.autoStartBreaks = true`, force a pomodoro completion, expect `state.timer.running === true` afterward. Set `false`, force completion again, expect `state.timer.running === false` and timer sits paused on the new mode.

---

### Task 5: Daily Planner — task CRUD, active task, safe rendering

**Files:**
- Modify: `index.html` (add `Planner` namespace + `UI` task-list rendering)

**Interfaces:**
- Consumes: `state.tasks`, `state.activeTaskId`, DOM IDs `#task-form`, `#task-input`, `#task-estimate`, `#task-list`, `#task-empty-state`, `#active-task-display`, `Storage.saveTasksAndActive`.
- Produces:
  - `Planner.addTask(text, estimate)` — trims text, rejects empty/whitespace-only, clamps `estimate` to 1-99 (default 1 if invalid/omitted), generates id via `crypto.randomUUID()`, pushes task, saves, re-renders.
  - `Planner.deleteTask(id)` — removes task; if it was `activeTaskId`, clears `state.activeTaskId = null`; saves, re-renders.
  - `Planner.toggleComplete(id)` — flips `completed`; saves, re-renders.
  - `Planner.setActiveTask(id)` — sets `state.activeTaskId = id`; saves, re-renders (updates `#active-task-display` and list highlight).
  - `UI.renderTasks()` — clears `#task-list` via `replaceChildren()` and rebuilds each `<li>` using `document.createElement` + `textContent` only (never `innerHTML`) for the task text; shows `#task-empty-state` when `state.tasks.length === 0`; updates `#active-task-display` to `"Currently focusing on\n" + text` or `"Choose a task to focus on"`.

- [ ] **Step 1: Implement `Planner` and `UI.renderTasks()`.**

  ```js
  const Planner = {
    addTask(text, estimate) {
      const trimmed = (text || '').trim();
      if (!trimmed) return false;
      const est = Number.parseInt(estimate, 10);
      const clean = Number.isFinite(est) && est > 0 && est <= 99 ? est : 1;
      state.tasks.push({ id: crypto.randomUUID(), text: trimmed.slice(0, 500), completed: false, estimatedPomodoros: clean, completedPomodoros: 0 });
      Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
      UI.renderTasks();
      return true;
    },
    deleteTask(id) {
      state.tasks = state.tasks.filter(t => t.id !== id);
      if (state.activeTaskId === id) state.activeTaskId = null;
      Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
      UI.renderTasks();
    },
    toggleComplete(id) {
      const t = state.tasks.find(t => t.id === id);
      if (!t) return;
      t.completed = !t.completed;
      Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
      UI.renderTasks();
    },
    setActiveTask(id) {
      state.activeTaskId = id;
      Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
      UI.renderTasks();
    },
  };

  UI.renderTasks = function renderTasks() {
    const list = document.getElementById('task-list');
    const empty = document.getElementById('task-empty-state');
    list.replaceChildren();
    empty.hidden = state.tasks.length > 0;
    for (const task of state.tasks) {
      const li = document.createElement('li');
      li.className = 'task' + (task.id === state.activeTaskId ? ' task--active' : '') + (task.completed ? ' task--done' : '');
      li.dataset.id = task.id;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', `Mark "${task.text}" complete`);
      checkbox.addEventListener('change', () => Planner.toggleComplete(task.id));

      const textSpan = document.createElement('span');
      textSpan.className = 'task__text';
      textSpan.textContent = task.text; // never innerHTML
      textSpan.addEventListener('click', () => Planner.setActiveTask(task.id));

      const progress = document.createElement('span');
      progress.className = 'task__progress';
      progress.textContent = `${task.completedPomodoros}/${task.estimatedPomodoros}`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'task__delete';
      del.setAttribute('aria-label', `Delete "${task.text}"`);
      del.textContent = '\u{1F5D1}';
      del.addEventListener('click', (e) => { e.stopPropagation(); Planner.deleteTask(task.id); });

      li.append(checkbox, textSpan, progress, del);
      list.appendChild(li);
    }
    const activeDisplay = document.getElementById('active-task-display');
    const active = state.tasks.find(t => t.id === state.activeTaskId);
    activeDisplay.textContent = active ? `Currently focusing on: ${active.text}` : 'Choose a task to focus on';
  };
  ```

- [ ] **Step 2: Wire `#task-form` submit (also fires on Enter in `#task-input` natively since it's a `<form>`) to call `Planner.addTask(...)` and reset the form on success.**

- [ ] **Step 3: Verify XSS-safe rendering via Playwright.**

  `browser_evaluate`: `Planner.addTask('<img src=x onerror="window.__xss=true">', 1)`. Reload nothing needed. Expected: `document.getElementById('task-list').textContent` contains the literal string `<img src=x...>`, `window.__xss` is `undefined`, and `document.querySelector('#task-list img')` is `null` (proving it was never parsed as HTML).

- [ ] **Step 4: Verify CRUD flow end-to-end via Playwright `browser_snapshot`/`browser_click`/`browser_type`.**

  Type a task, submit via Enter key (`browser_press_key 'Enter'`), confirm it appears; click its text, confirm `#active-task-display` updates and it gets the active highlight class; check its checkbox, confirm strikethrough style applies (`task--done` class present); delete it, confirm it's gone and empty-state reappears when list is empty.

- [ ] **Step 5: Verify deleting the active task clears active state.**

  Add task, set active, delete it, evaluate `state.activeTaskId === null` and `#active-task-display` textContent is the empty-state message.

---

### Task 6: Pomodoro ↔ Task integration + daily stats

**Files:**
- Modify: `index.html` (`Planner.onPomodoroCompleted`, stats rollover on boot)

**Interfaces:**
- Consumes: `Timer.complete()` (already calls `Planner.onPomodoroCompleted()` per Task 3 Step 1), `state.stats`, `Storage.loadStats`/`saveStats`, `#pomodoro-count`.
- Produces:
  - `Planner.onPomodoroCompleted()` — increments `state.stats.pomodorosCompletedToday`; if an active task exists, increments its `completedPomodoros`; saves both stats and tasks; calls `UI.renderPomodoroCount()` and `UI.renderTasks()`.
  - `UI.renderPomodoroCount()` — sets `#pomodoro-count` textContent to `` `Today's Pomodoros: ${state.stats.pomodorosCompletedToday}` ``.
  - `State.rolloverStatsIfNewDay()` — called once at boot (Task 12 wires full boot order, but this function is implemented here): compares `Storage.loadStats().date` to `todayStr()`; if different, resets count to 0 and updates date, saves; else keeps loaded stats.

- [ ] **Step 1: Implement the functions above.**

  ```js
  Planner.onPomodoroCompleted = function onPomodoroCompleted() {
    state.stats.pomodorosCompletedToday++;
    Storage.saveStats(state.stats);
    const active = state.tasks.find(t => t.id === state.activeTaskId);
    if (active) {
      active.completedPomodoros++;
      Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
    }
    UI.renderPomodoroCount();
    UI.renderTasks();
  };

  UI.renderPomodoroCount = function renderPomodoroCount() {
    const el = document.getElementById('pomodoro-count');
    if (el) el.textContent = `Today's Pomodoros: ${state.stats.pomodorosCompletedToday}`;
  };

  const State = {
    rolloverStatsIfNewDay() {
      const loaded = Storage.loadStats();
      const today = todayStr();
      if (loaded.date !== today) {
        state.stats = { date: today, pomodorosCompletedToday: 0 };
      } else {
        state.stats = loaded;
      }
      Storage.saveStats(state.stats);
    },
  };
  ```

- [ ] **Step 2: Verify completion increments both counters and persists.**

  Playwright: add a task, set active, force a pomodoro completion (as in Task 4 Step 3's technique), evaluate `state.stats.pomodorosCompletedToday === 1` and the active task's `completedPomodoros === 1`, and `#pomodoro-count` textContent reflects it. Reload the page, confirm both values survive.

- [ ] **Step 3: Verify daily rollover.**

  `browser_evaluate`: `localStorage.setItem('stats', JSON.stringify({date: '2020-01-01', pomodorosCompletedToday: 7}))`, reload, evaluate `State.rolloverStatsIfNewDay(); state.stats.pomodorosCompletedToday === 0` and `state.stats.date === todayStr()`.

---

### Task 7: Settings dialog

**Files:**
- Modify: `index.html` (`UI.openSettings`/`UI.closeSettings`/`UI.saveSettingsFromForm`, wire `#settings-btn`)

**Interfaces:**
- Consumes: `dialog#settings` and its fields from Task 1, `Storage.loadSettings`/`saveSettings`, `state.settings`, `Timer.reset`/`updateTimerDisplay`.
- Produces:
  - `UI.openSettings()` — populates form fields from `state.settings`, calls `dialogEl.showModal()`.
  - `UI.closeSettings()` — calls `dialogEl.close()` (native `Escape` handling and focus trap come free from `showModal`; no extra JS needed for those).
  - `UI.saveSettingsFromForm(event)` — `event.preventDefault()`; reads and validates each numeric field (integer, `1 <= pomodoro <= 180`, `1 <= shortBreak <= 90`, `1 <= longBreak <= 180`); on any invalid field, sets `aria-invalid="true"` + a visible inline error on that field and does NOT save or close; on all valid, updates `state.settings`, calls `Storage.saveSettings`, closes the dialog; if the timer is currently NOT running, also calls `Timer.reset()` so the new duration takes effect immediately for the current mode — if it IS running, leaves the active countdown untouched (per spec section 32: "Do not unexpectedly destroy active timer state").

- [ ] **Step 1: Implement the three functions and wire listeners (`#settings-btn` → open, `#settings-close` → close, form `submit` → save).**

  ```js
  UI.openSettings = function openSettings() {
    document.getElementById('setting-pomodoro').value = state.settings.pomodoro;
    document.getElementById('setting-short-break').value = state.settings.shortBreak;
    document.getElementById('setting-long-break').value = state.settings.longBreak;
    document.getElementById('setting-auto-break').checked = state.settings.autoStartBreaks;
    document.getElementById('setting-auto-pomodoro').checked = state.settings.autoStartPomodoros;
    document.getElementById('settings').showModal();
  };
  UI.closeSettings = function closeSettings() { document.getElementById('settings').close(); };

  function validateDuration(inputEl, min, max) {
    const n = Number.parseInt(inputEl.value, 10);
    const ok = Number.isFinite(n) && n >= min && n <= max && String(n) === inputEl.value.trim();
    inputEl.setAttribute('aria-invalid', String(!ok));
    return ok ? n : null;
  }

  UI.saveSettingsFromForm = function saveSettingsFromForm(event) {
    event.preventDefault();
    const pomo = validateDuration(document.getElementById('setting-pomodoro'), 1, 180);
    const short = validateDuration(document.getElementById('setting-short-break'), 1, 90);
    const long = validateDuration(document.getElementById('setting-long-break'), 1, 180);
    if (pomo === null || short === null || long === null) return; // inline aria-invalid shows the error, dialog stays open
    state.settings = {
      pomodoro: pomo, shortBreak: short, longBreak: long,
      autoStartBreaks: document.getElementById('setting-auto-break').checked,
      autoStartPomodoros: document.getElementById('setting-auto-pomodoro').checked,
    };
    Storage.saveSettings(state.settings);
    if (!state.timer.running) Timer.reset();
    UI.closeSettings();
  };
  ```

  Add matching CSS: `input[aria-invalid="true"] { border-color: #c0392b; }` plus a visible `.field-error` text node pattern — for brevity/robustness, drive the error text via a `<span class="field-error">` per field that this function also toggles `hidden` on (add these spans to Task 1's dialog markup retroactively in this task, since they're settings-specific).

- [ ] **Step 2: Verify open/close/Escape via Playwright.**

  Click `#settings-btn`, snapshot confirms dialog open with fields matching `state.settings`. Press `Escape`, confirm dialog closed (native behavior — just assert `dialog.open === false`).

- [ ] **Step 3: Verify validation rejects bad input.**

  Open dialog, set pomodoro field to `0`, submit. Expected: dialog stays open, `aria-invalid="true"` on that field, `state.settings.pomodoro` unchanged. Repeat for negative and non-numeric (`"abc"`) values.

- [ ] **Step 4: Verify save persists and does not kill a running timer.**

  Start the timer, open settings, change pomodoro duration, save. Expected: `state.timer.running` still `true` and `state.timer.remainingMs` unchanged by the save (only future resets use the new duration); `localStorage.appSettings` reflects the new value.

---

### Task 8: Media/background core (default, image, video)

**Files:**
- Modify: `index.html` (add `Media` namespace, extend `dialog#settings` with a background section, extend CSS for glassmorphism)

**Interfaces:**
- Consumes: `state.mediaSettings`, `#background-layer`, `#background-overlay`, `Storage.saveMediaSettings`.
- Produces:
  - `Media.isSafeHttpsUrl(url): boolean` — `try { const u = new URL(url); return u.protocol === 'https:'; } catch { return false; }`.
  - `Media.applyBackground()` — reads `state.mediaSettings.type`, clears `#background-layer` (`replaceChildren()`), and:
    - `'default'`: leaves it empty (CSS gradient on `#background-layer` itself handles the look).
    - `'image'`: if `isSafeHttpsUrl(imageUrl)`, creates `<img>` with `src`, `alt=""`, `style="width:100%;height:100%;object-fit:cover"`; else falls back to default.
    - `'video'`: if `isSafeHttpsUrl(videoUrl)` AND the URL ends in `.mp4` or `.webm` (case-insensitive), creates `<video autoplay muted loop playsinline>` with a `<source>` child; else falls back to default.
    - `'youtube'`: delegates to `YouTube.applyBackground()` (Task 9).
    Also sets `#background-overlay` background-color alpha based on `type !== 'default'` (e.g. `rgba(0,0,0,0.35)` when a custom background is active, transparent for default) so UI stays readable.
  - New settings dialog fields (added to `dialog#settings` in this task): `select#setting-bg-type` (default/image/video/youtube), `input#setting-bg-image-url`, `input#setting-bg-video-url`, wired into `UI.saveSettingsFromForm` (extended) to also validate/save `mediaSettings` and call `Media.applyBackground()`.

- [ ] **Step 1: Implement `Media.isSafeHttpsUrl`, `Media.applyDefaultBackground`, and `Media.applyBackground` for the default/image/video cases (the youtube case delegates to `YouTube.applyBackground`, defined in Task 9; guarded here with `typeof YouTube !== 'undefined'` so this task is independently testable before Task 9 exists).**

  ```js
  const Media = {
    isSafeHttpsUrl(url) {
      try {
        const u = new URL(url);
        return u.protocol === 'https:';
      } catch { return false; }
    },
    applyDefaultBackground() {
      const layer = document.getElementById('background-layer');
      layer.replaceChildren();
      layer.setAttribute('data-empty', '');
      document.getElementById('background-overlay').style.backgroundColor = 'transparent';
      UI.hideMediaPanel();
    },
    applyBackground() {
      const layer = document.getElementById('background-layer');
      layer.removeAttribute('data-empty');
      const m = state.mediaSettings;

      if (m.type === 'image') {
        if (!Media.isSafeHttpsUrl(m.imageUrl)) { Media.applyDefaultBackground(); return; }
        layer.replaceChildren();
        const img = document.createElement('img');
        img.src = m.imageUrl;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        layer.appendChild(img);
        document.getElementById('background-overlay').style.backgroundColor = 'rgba(0,0,0,0.35)';
        UI.hideMediaPanel();
        return;
      }
      if (m.type === 'video') {
        let isVideoFile = false;
        if (Media.isSafeHttpsUrl(m.videoUrl)) {
          isVideoFile = /\.(mp4|webm)$/i.test(new URL(m.videoUrl).pathname);
        }
        if (!isVideoFile) { Media.applyDefaultBackground(); return; }
        layer.replaceChildren();
        const video = document.createElement('video');
        video.autoplay = true; video.muted = true; video.loop = true; video.playsInline = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        const source = document.createElement('source');
        source.src = m.videoUrl;
        video.appendChild(source);
        layer.appendChild(video);
        document.getElementById('background-overlay').style.backgroundColor = 'rgba(0,0,0,0.35)';
        UI.showMediaPanel();
        return;
      }
      if (m.type === 'youtube') {
        if (typeof YouTube !== 'undefined' && YouTube.applyBackground) {
          YouTube.applyBackground();
          document.getElementById('background-overlay').style.backgroundColor = 'rgba(0,0,0,0.35)';
        } else {
          Media.applyDefaultBackground();
        }
        return;
      }
      Media.applyDefaultBackground();
    },
  };
  ```

  ```css
  #background-layer[data-empty] { background: radial-gradient(circle at 20% 20%, var(--accent-soft), var(--bg) 70%); }
  .glass { background: rgba(255,255,255,0.65); backdrop-filter: blur(16px) saturate(160%); }
  @supports not (backdrop-filter: blur(1px)) {
    .glass { background: rgba(255,255,255,0.92); }
  }
  ```

  Apply the `.glass` class to `#timer`, `#tasks`, and `#media-panel` container elements in Task 1's markup (retroactive small HTML tweak, done in this task).

- [ ] **Step 2: Extend the settings form/save logic to include background type + URLs, persisted via `Storage.saveMediaSettings` and applied via `Media.applyBackground()` on save.**

- [ ] **Step 3: Verify URL validation rejects unsafe schemes.**

  Playwright `browser_evaluate`: `Media.isSafeHttpsUrl('javascript:alert(1)') === false`, `Media.isSafeHttpsUrl('http://example.com/a.png') === false` (https-only), `Media.isSafeHttpsUrl('https://example.com/a.png') === true`.

- [ ] **Step 4: Verify image/video background switching visually.**

  Set `state.mediaSettings = {type:'image', imageUrl:'https://picsum.photos/1200/800', ...defaults}`, call `Media.applyBackground()`, screenshot, confirm `#background-layer img` exists and covers viewport. Switch to `type:'video'` with a `.mp4` https URL, confirm a `<video>` element exists with `autoplay muted loop playsinline`.

- [ ] **Step 5: Verify malformed/non-matching URLs fall back to default without crashing.**

  Set `videoUrl: 'https://example.com/not-a-video.txt'`, call `Media.applyBackground()`, confirm `#background-layer` ends up empty/default (no `<video>` created) and no console error.

---

### Task 9: YouTube background + audio-only mode

**Files:**
- Modify: `index.html` (add `YouTube` namespace)

**Interfaces:**
- Consumes: `state.mediaSettings.youtubeId`/`playbackMode`, `Media.applyBackground` (Task 8, extended here to actually call into `YouTube`), `#background-layer`, `#media-panel`.
- Produces:
  - `YouTube.extractId(input): string|null` — accepts a raw 11-char ID or a URL matching `youtube.com/watch?v=`, `youtu.be/`, or `youtube.com/embed/`; returns the ID only if it matches `^[A-Za-z0-9_-]{11}$`, else `null`. Implemented with `URL`/`URLSearchParams` parsing, not regex scraping of arbitrary page content.
  - `YouTube.ensureApiLoaded(): Promise<void>` — lazily injects `<script src="https://www.youtube.com/iframe_api">` at most once (guarded by a module flag), resolves when `window.YT.Player` is available (`window.onYouTubeIframeAPIReady` callback), with a 10s timeout that resolves anyway (so a network failure doesn't hang the app — later calls into a null player are guarded).
  - `YouTube.applyBackground()` — called from `Media.applyBackground()` when `type === 'youtube'`; validates `youtubeId` via `extractId`; if invalid, falls back to default background; else awaits `ensureApiLoaded()`, creates a hidden or visible `<div id="youtube-player-target">` inside `#background-layer` (visible/fullscreen-cover when `playbackMode === 'background'`, visually hidden off-screen when `playbackMode === 'audio'` so only sound plays while the normal background stays visible), and constructs `new YT.Player('youtube-player-target', { videoId, playerVars: {autoplay: 1, mute: 1, controls: 0, ...}, events: { onReady, onError } })`. `onReady` attempts `player.playVideo()`; if blocked by autoplay policy, `UI` shows a visible `#media-play` button state that calls `player.playVideo()` on click instead of retrying automatically. `onError` falls back to default background and logs (not throws).
  - Module-private `YouTube._player` reference reused by the floating controls (Task 10).

- [ ] **Step 1: Implement `extractId`.**

  ```js
  const YouTube = {
    extractId(input) {
      if (!input) return null;
      const trimmed = input.trim();
      if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
      try {
        const u = new URL(trimmed);
        if (u.hostname.includes('youtu.be')) {
          const id = u.pathname.slice(1);
          return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
        if (u.hostname.includes('youtube.com')) {
          if (u.pathname === '/watch') {
            const id = u.searchParams.get('v');
            return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
          }
          if (u.pathname.startsWith('/embed/')) {
            const id = u.pathname.split('/')[2];
            return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
          }
        }
        return null;
      } catch { return null; }
    },
    _apiPromise: null,
    ensureApiLoaded() {
      if (YouTube._apiPromise) return YouTube._apiPromise;
      YouTube._apiPromise = new Promise((resolve) => {
        if (window.YT && window.YT.Player) return resolve();
        const timeout = setTimeout(resolve, 10000);
        window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(); };
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      });
      return YouTube._apiPromise;
    },
    _player: null,
    async applyBackground() {
      const id = YouTube.extractId(state.mediaSettings.youtubeId);
      if (!id) { Media.applyDefaultBackground(); return; }
      await YouTube.ensureApiLoaded();
      if (!window.YT || !window.YT.Player) { Media.applyDefaultBackground(); return; }
      const layer = document.getElementById('background-layer');
      const target = document.createElement('div');
      target.id = 'youtube-player-target';
      target.className = state.mediaSettings.playbackMode === 'background' ? 'yt-target-visible' : 'yt-target-hidden';
      layer.appendChild(target);
      YouTube._player = new YT.Player('youtube-player-target', {
        videoId: id,
        playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1 },
        events: {
          onReady: (e) => { e.target.playVideo(); UI.showMediaPanel(); },
          onError: () => { Media.applyDefaultBackground(); },
        },
      });
    },
  };
  ```

  `Media.applyDefaultBackground()` (defined in Task 8) is reused here as-is for the fallback cases — no changes to Task 8 needed.

  Add CSS: `.yt-target-visible { position:absolute; inset:-2px; width:calc(100% + 4px); height:calc(100% + 4px); } .yt-target-hidden { position:absolute; width:1px; height:1px; overflow:hidden; opacity:0; pointer-events:none; }`.

- [ ] **Step 2: Verify `extractId` against all three accepted URL shapes plus rejection cases.**

  Playwright `browser_evaluate` a table: `watch?v=dQw4w9WgXcQ` → id; `youtu.be/dQw4w9WgXcQ` → id; `youtube.com/embed/dQw4w9WgXcQ` → id; bare `dQw4w9WgXcQ` → id; `dQw4w9WgXc` (10 chars) → `null`; `javascript:alert(1)` → `null`; `https://evil.com/dQw4w9WgXcQ` → `null`.

- [ ] **Step 3: Verify API is loaded at most once.**

  `browser_evaluate`: call `YouTube.ensureApiLoaded()` twice concurrently, then `document.querySelectorAll('script[src*="iframe_api"]').length === 1`.

- [ ] **Step 4: Verify autoplay-block handling doesn't crash the app.**

  This is best verified by code inspection plus a manual run (real YouTube autoplay behavior isn't reliably forceable in headless testing): confirm `onReady`/`onError` never throw uncaught, and that the rest of the app (`Timer`, `Planner`) remains interactive after `applyBackground()` runs regardless of network conditions. Playwright: with `youtubeId` set to a valid-looking but non-existent ID (`AAAAAAAAAAA`), call `applyBackground()`, wait, then confirm `Timer.start` still works (click `#timer-toggle`, confirm timer counts down) — proves a YouTube failure doesn't break the core app.

---

### Task 10: Floating media player controls

**Files:**
- Modify: `index.html` (wire `#media-panel` buttons)

**Interfaces:**
- Consumes: `#media-play`, `#media-mute`, `#media-volume`, `YouTube._player`, the active `<video>` element in `#background-layer` (for local video mode), `state.mediaSettings`, `UI.showMediaPanel`/`UI.hideMediaPanel` (defined in Task 1, already wired into `Media.applyBackground`/`applyDefaultBackground` from Task 8 and `YouTube.applyBackground` from Task 9 — panel visibility itself needs no new code here).
- Produces:
  - `Media.getActiveController(): {play, pause, setMuted, setVolume, isPlaying}` — returns a small adapter object: for `'youtube'` wraps `YouTube._player` methods (`playVideo/pauseVideo/mute/unMute/setVolume`); for `'video'` wraps the `<video>` element's native API (`.play()/.pause()/.muted/.volume`); returns `null` if neither applies (buttons no-op safely).
  - Click handlers on `#media-play` (toggles play/pause via the adapter, swaps button icon/label), `#media-mute` (toggles mute), and `input` handler on `#media-volume` (range `0-100`) calling `setVolume`.

- [ ] **Step 1: Implement `Media.getActiveController` and wire the three controls.**

  ```js
  Media.getActiveController = function getActiveController() {
    if (state.mediaSettings.type === 'youtube' && YouTube._player && YouTube._player.playVideo) {
      const p = YouTube._player;
      return {
        play: () => p.playVideo(), pause: () => p.pauseVideo(),
        setMuted: (m) => m ? p.mute() : p.unMute(),
        setVolume: (v) => p.setVolume(v),
        isPlaying: () => p.getPlayerState && p.getPlayerState() === 1,
      };
    }
    if (state.mediaSettings.type === 'video') {
      const v = document.querySelector('#background-layer video');
      if (!v) return null;
      return {
        play: () => v.play(), pause: () => v.pause(),
        setMuted: (m) => { v.muted = m; }, setVolume: (vol) => { v.volume = vol / 100; },
        isPlaying: () => !v.paused,
      };
    }
    return null;
  };

  // UI.showMediaPanel/hideMediaPanel already exist (defined in Task 1) and are already
  // called by Media.applyBackground/applyDefaultBackground (Task 8) and YouTube.applyBackground
  // (Task 9) — this task only adds the controls that act once the panel is visible.

  document.getElementById('media-play').addEventListener('click', () => {
    const c = Media.getActiveController();
    if (!c) return;
    if (c.isPlaying()) { c.pause(); } else { c.play(); }
    document.getElementById('media-play').textContent = c.isPlaying() ? '⏸' : '▶';
  });
  document.getElementById('media-mute').addEventListener('click', () => {
    const c = Media.getActiveController();
    if (!c) return;
    state.mediaSettings.muted = !state.mediaSettings.muted;
    c.setMuted(state.mediaSettings.muted);
    Storage.saveMediaSettings(state.mediaSettings);
    document.getElementById('media-mute').textContent = state.mediaSettings.muted ? '🔇' : '🔊';
  });
  document.getElementById('media-volume').addEventListener('input', (e) => {
    const c = Media.getActiveController();
    state.mediaSettings.volume = Number(e.target.value) / 100;
    if (c) c.setVolume(Number(e.target.value));
    Storage.saveMediaSettings(state.mediaSettings);
  });
  ```

- [ ] **Step 2: Verify panel visibility rules.**

  Set `type: 'image'`, call `Media.applyBackground()`, expect `#media-panel` hidden. Set `type: 'video'` with a valid URL, expect panel visible.

- [ ] **Step 3: Verify controls affect the real `<video>` element for local video mode.**

  With a video background active, click `#media-mute`, confirm `document.querySelector('#background-layer video').muted === true`. Move `#media-volume` slider, confirm `.volume` updates proportionally.

---

### Task 11: Media settings persistence + startup load

**Files:**
- Modify: `index.html` (`State.init` / boot sequence)

**Interfaces:**
- Consumes: all `Storage.load*` from Task 2, `Media.applyBackground`, `Timer.updateTimerDisplay`, `UI.renderTasks`, `UI.renderPomodoroCount`.
- Produces: `State.init()` — the single boot function called from `UI.init()`:
  ```js
  State.init = function init() {
    state.settings = Storage.loadSettings();
    const { tasks, activeTaskId } = Storage.loadTasksAndActive();
    state.tasks = tasks;
    state.activeTaskId = activeTaskId;
    State.rolloverStatsIfNewDay();
    state.mediaSettings = Storage.loadMediaSettings();
    state.timer.remainingMs = Timer.durationMs(state.timer.mode);
  };
  ```
  `UI.init()` (finalized) calls `State.init()`, then `UI.renderTasks()`, `UI.renderPomodoroCount()`, `Timer.updateTimerDisplay()`, `Media.applyBackground()`, then attaches all event listeners from Tasks 3/5/7/10 (consolidate any listener-attachment left inline in earlier tasks into this single init if not already done there — earlier tasks may attach listeners at top-level `<script>` scope directly, which is acceptable since the script runs after the DOM per `defer`/end-of-body placement; this task's job is to make sure state loading happens exactly once, in this order, before any render).

- [ ] **Step 1: Implement `State.init()` and finalize `UI.init()` to call it before any rendering.**

- [ ] **Step 2: Verify full reload persistence of media settings.**

  Set a video background via the settings UI (not just `state` directly — actually fill the form and submit), reload the page, confirm `#background-layer` still shows the video and `#media-volume`/mute state match what was set.

- [ ] **Step 3: Verify corrupted `mediaSettings` doesn't crash boot.**

  `localStorage.setItem('mediaSettings', '{not valid json')`, reload. Expected: page loads fully (timer/planner functional, no console error), background falls back to default.

---

### Task 12: Accessibility + responsive pass

**Files:**
- Modify: `index.html` (CSS breakpoints, ARIA attributes, focus styles)

**Interfaces:**
- Consumes: the full markup from all prior tasks.
- Produces: no new JS interfaces — CSS/markup refinements only:
  - `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }` applied globally.
  - `button`, checkbox, and range inputs sized ≥44px touch target on screens `≤600px`.
  - `@media (max-width: 600px)` rules: `#timer`/`#tasks` stack full-width, `#timer-display` font-size scales down (e.g. `clamp(2.5rem, 12vw, 4.5rem)`), `#media-panel` repositions to a bottom-safe fixed bar instead of a floating corner box.
  - `aria-label`s confirmed present on all icon-only buttons (`#settings-btn`, delete buttons, play/mute) — icon buttons must have discernible text via `aria-label`, not just an emoji.
  - `dialog#settings` labelled via `aria-labelledby` pointing at its heading.
  - Already-present `@media (prefers-reduced-motion: reduce)` block from Task 1 double-checked against every `transition`/`animation` added since.

- [ ] **Step 1: Add the CSS/ARIA refinements listed above.**

- [ ] **Step 2: Verify no horizontal overflow at 320px, 375px, 768px, 1024px, 1440px via `browser_resize` + `browser_evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')`.**

- [ ] **Step 3: Verify keyboard-only flow: Tab from the top of the page reaches every interactive control in a logical order, `Enter`/`Space` activate buttons, focus is visible at each stop (`browser_snapshot` after each `browser_press_key 'Tab'`).**

- [ ] **Step 4: Verify reduced-motion emulation removes transitions.**

  `browser_emulate_media` (or equivalent `prefers-reduced-motion: reduce`), confirm computed `transitionDuration` on `body` and `#background-overlay` is effectively `0.001ms`.

---

### Task 13: Security sweep + final Ralph-loop audit

**Files:**
- Modify: `index.html` (fix anything the sweep finds)

**Interfaces:**
- Consumes: the complete file.
- Produces: a verified-clean file; no new public interfaces.

- [ ] **Step 1: Grep the file for `innerHTML`/`insertAdjacentHTML`/`document.write`/`eval(` — confirm zero occurrences (or, if any remain for trusted static markup only, confirm no user-controlled variable is interpolated into them).**

  Run: search the file for those four strings.
  Expected: no matches, or matches only in comments.

- [ ] **Step 2: Run the full acceptance checklist (spec section 52) end-to-end in one Playwright session**, covering: Pomodoro/Short/Long Break switching, Play/Pause/Reset/Skip, accurate timing, title updates, completion sound fires (check `AudioContext` was resumed/used, not an actual audio assertion), 4-cycle, auto-start both ways; task add/complete/uncomplete/delete/active/estimate/progress/empty-state; stats increment + persist + daily reset; settings persist; default/image/video/YouTube backgrounds; YouTube audio vs background mode; media play/pause/volume/mute; media persistence; autoplay-failure non-crash; no console errors across the whole run.

  Record pass/fail for each line item; fix any failures found (this may loop back into earlier tasks' files — that's expected Ralph-loop behavior per spec section 50/51: after any fix, re-run the specific check that failed plus a quick smoke pass on timer+planner to confirm no regression).

- [ ] **Step 3: Performance check — confirm exactly one `setInterval` exists app-wide during normal timer operation, confirm switching media types away from `'video'`/`'youtube'` actually removes/pauses the previous `<video>`/`YT.Player` (no orphaned playing media after a switch) — add cleanup in `Media.applyBackground()`/`YouTube.applyBackground()` if missing (call `YouTube._player.destroy()` and null it out, and `.pause()`+`.removeAttribute('src')` any outgoing `<video>` before replacing `#background-layer`'s children).**

- [ ] **Step 4: Final read-through for dead code / unused variables introduced across tasks; remove any.**

- [ ] **Step 5: Done — the deliverable is the single `index.html` file at the project root, openable directly via `file://`.**
