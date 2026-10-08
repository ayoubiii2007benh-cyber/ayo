'use strict';

/* ============================== icons ==============================
   Inline SVG markup for every button whose icon changes with state
   (dark/light, muted/unmuted, playing/paused) so JS can swap it via
   innerHTML. Buttons whose icon never changes (settings, close, skip,
   repeat, users) render their SVG directly in the static HTML instead —
   no JS twin needed. Stroke icons share the .icon.icon--stroke look;
   play/pause are conventionally filled shapes, sharing .icon.icon--fill. */
const Icons = {
  moon: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><path d="M15.5 12.3A6.5 6.5 0 1 1 8.2 4.5a5.2 5.2 0 0 0 7.3 7.8Z"/></svg>',
  sun: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><circle cx="10" cy="10" r="3.3"/><path d="M10 2.6v2M10 15.4v2M2.6 10h2M15.4 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M5.7 14.3l-1.4 1.4"/></svg>',
  volumeOn: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><path d="M3 7.4h2.7L10 4v12l-4.3-3.4H3z"/><path d="M13.1 7.3a3.9 3.9 0 0 1 0 5.4M15.2 5.1a6.9 6.9 0 0 1 0 9.8"/></svg>',
  volumeMute: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><path d="M3 7.4h2.7L10 4v12l-4.3-3.4H3z"/><path d="M13 7.6l4 4.8M17 7.6l-4 4.8"/></svg>',
  play: '<svg class="icon icon--fill" viewBox="0 0 20 20"><path d="M6.2 4.3v11.4c0 .6.7 1 1.2.7l9-5.7c.5-.3.5-1 0-1.3l-9-5.7c-.5-.3-1.2 0-1.2.6Z"/></svg>',
  pause: '<svg class="icon icon--fill" viewBox="0 0 20 20"><rect x="5" y="4" width="3.3" height="12" rx="0.8"/><rect x="11.7" y="4" width="3.3" height="12" rx="0.8"/></svg>',
  trash: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><path d="M4 6h12"/><path d="M7.5 6V4.3c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1V6"/><path d="M5.5 6l.6 9.2c0 .7.6 1.3 1.3 1.3h5.2c.7 0 1.3-.6 1.3-1.3L14.5 6"/><path d="M8.3 9v4.5M11.7 9v4.5"/></svg>',
  eye: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><path d="M1.5 10S4.8 4 10 4s8.5 6 8.5 6-3.3 6-8.5 6-8.5-6-8.5-6Z"/><circle cx="10" cy="10" r="2.4"/></svg>',
  eyeOff: '<svg class="icon icon--stroke" viewBox="0 0 20 20"><path d="M1.5 10S4.8 4 10 4s8.5 6 8.5 6-3.3 6-8.5 6-8.5-6-8.5-6Z"/><circle cx="10" cy="10" r="2.4"/><line x1="3" y1="3" x2="17" y2="17"/></svg>',
};

/* ============================== helpers ============================== */

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function makeId() {
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}
function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
}
function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  if (!a || !b) return hexA;
  return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}
function relLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

const DEFAULT_SETTINGS = { pomodoro: 25, shortBreak: 5, longBreak: 15, autoStartBreaks: false, autoStartPomodoros: false };
const DEFAULT_MEDIA = { type: 'default', imageUrl: '', videoUrl: '', youtubeId: '', playbackMode: 'background', volume: 0.5, muted: false, localImageId: null, localVideoId: null };
const DEFAULT_MUSIC = { enabled: false, source: 'builtin', builtinTrackId: '', audioUrl: '', localAudioId: null, volume: 0.5, muted: false, loop: true };
const DEFAULT_THEME_COLORS = { bg:'#fdfbf8', surface:'#ffffff', text:'#14100c', textMuted:'#6b625c', border:'#14100c', primary:'#ff5533', accentPomodoro:'#ff5533', accentShortBreak:'#0eb8a0', accentLongBreak:'#7c3aed', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' };

const state = {
  settings: { ...DEFAULT_SETTINGS },
  tasks: [],
  activeTaskId: null,
  stats: { date: todayStr(), pomodorosCompletedToday: 0 },
  mediaSettings: { ...DEFAULT_MEDIA },
  musicSettings: { ...DEFAULT_MUSIC },
  themeSettings: { preset: 'default', colors: { ...DEFAULT_THEME_COLORS } },
  timer: { mode: 'pomodoro', running: false, endAt: null, remainingMs: DEFAULT_SETTINGS.pomodoro * 60000, cyclesCompleted: 0, _completing: false },
  chatSettings: { apiKey: '' },
  chatHistory: [],
  profile: { username: 'You', avatar: '', bio: '', localAvatarId: null, _avatarUrl: null },
  dailyHistory: [],
  currentView: 'dashboard',
  activeChatFriendId: null,
  lounge: { room: null },
};

const DAILY_HISTORY_MAX = 90;

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
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch { return null; }
}
function safeSetGlobal(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable or full: ignore */ }
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
  saveSettings(settings) { safeSet('appSettings', settings); },

  loadTasksAndActive() {
    const raw = safeParse('tasks') || {};
    const tasksRaw = Array.isArray(raw.tasks) ? raw.tasks : [];
    const tasks = tasksRaw
      .filter(t => t && typeof t.id === 'string' && typeof t.text === 'string' && t.text.trim())
      .map(t => ({
        id: t.id,
        text: t.text.slice(0, 500),
        completed: !!t.completed,
        estimatedPomodoros: clampInt(t.estimatedPomodoros, 1, 99, 1),
        completedPomodoros: clampInt(t.completedPomodoros, 0, 999, 0),
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : null,
        project: (typeof t.project === 'string' && t.project.trim()) ? t.project.trim().slice(0, 40) : null,
      }));
    const activeTaskId = tasks.some(t => t.id === raw.activeTaskId) ? raw.activeTaskId : null;
    return { tasks, activeTaskId };
  },
  saveTasksAndActive(tasks, activeTaskId) { safeSet('tasks', { tasks, activeTaskId }); },

  loadStats() {
    const raw = safeParse('stats') || {};
    const dateOk = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date);
    const lastActiveOk = typeof raw.lastActiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.lastActiveDate);
    return {
      date: dateOk ? raw.date : todayStr(),
      pomodorosCompletedToday: clampInt(raw.pomodorosCompletedToday, 0, 999, 0),
      tasksCompletedToday: clampInt(raw.tasksCompletedToday, 0, 999, 0),
      focusMinutesToday: clampInt(raw.focusMinutesToday, 0, 999999, 0),
      restMinutesToday: clampInt(raw.restMinutesToday, 0, 999999, 0),
      disciplineBonusAwardedToday: raw.disciplineBonusAwardedToday === true,
      totalPomodoros: clampInt(raw.totalPomodoros, 0, 9999999, 0),
      totalFocusMinutes: clampInt(raw.totalFocusMinutes, 0, 9999999, 0),
      currentStreak: clampInt(raw.currentStreak, 0, 999999, 0),
      lastActiveDate: lastActiveOk ? raw.lastActiveDate : '',
      focusXP: clampInt(raw.focusXP, 0, 999999999, 0),
      disciplineXP: clampInt(raw.disciplineXP, 0, 999999999, 0),
    };
  },
  saveStats(stats) { safeSet('stats', stats); },

  loadMediaSettings() {
    const raw = safeParse('mediaSettings') || {};
    const types = ['default', 'image', 'video', 'youtube', 'localImage', 'localVideo'];
    return {
      type: types.includes(raw.type) ? raw.type : DEFAULT_MEDIA.type,
      imageUrl: typeof raw.imageUrl === 'string' ? raw.imageUrl : DEFAULT_MEDIA.imageUrl,
      videoUrl: typeof raw.videoUrl === 'string' ? raw.videoUrl : DEFAULT_MEDIA.videoUrl,
      youtubeId: typeof raw.youtubeId === 'string' ? raw.youtubeId : DEFAULT_MEDIA.youtubeId,
      playbackMode: ['audio', 'background'].includes(raw.playbackMode) ? raw.playbackMode : DEFAULT_MEDIA.playbackMode,
      volume: (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) ? raw.volume : DEFAULT_MEDIA.volume,
      muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_MEDIA.muted,
      localImageId: typeof raw.localImageId === 'number' ? raw.localImageId : DEFAULT_MEDIA.localImageId,
      localVideoId: typeof raw.localVideoId === 'number' ? raw.localVideoId : DEFAULT_MEDIA.localVideoId,
    };
  },
  saveMediaSettings(m) { safeSet('mediaSettings', m); },

  loadMusicSettings() {
    const raw = safeParse('musicSettings') || {};
    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_MUSIC.enabled,
      source: ['builtin', 'url', 'upload'].includes(raw.source) ? raw.source : DEFAULT_MUSIC.source,
      builtinTrackId: typeof raw.builtinTrackId === 'string' ? raw.builtinTrackId : DEFAULT_MUSIC.builtinTrackId,
      audioUrl: typeof raw.audioUrl === 'string' ? raw.audioUrl : DEFAULT_MUSIC.audioUrl,
      localAudioId: typeof raw.localAudioId === 'number' ? raw.localAudioId : DEFAULT_MUSIC.localAudioId,
      volume: (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) ? raw.volume : DEFAULT_MUSIC.volume,
      muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_MUSIC.muted,
      loop: typeof raw.loop === 'boolean' ? raw.loop : DEFAULT_MUSIC.loop,
    };
  },
  saveMusicSettings(m) { safeSet('musicSettings', m); },

  loadThemeSettings() {
    const raw = safeParse('themeSettings') || {};
    const presetKeys = Object.keys(Theme.PRESETS);
    const preset = (presetKeys.includes(raw.preset) || raw.preset === 'custom') ? raw.preset : 'default';
    const rawColors = (raw.colors && typeof raw.colors === 'object') ? raw.colors : {};
    const defaults = Theme.PRESETS.default;
    const colors = {};
    Object.keys(defaults).forEach((key) => {
      colors[key] = hexToRgb(rawColors[key]) ? rawColors[key] : defaults[key];
    });
    return { preset, colors };
  },
  saveThemeSettings(t) { safeSet('themeSettings', t); },

  loadChatSettings() {
    const raw = safeParse('chatSettings') || {};
    return { apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '' };
  },
  saveChatSettings(c) { safeSet('chatSettings', c); },

  loadChatHistory() {
    try {
      const raw = localStorage.getItem('chatHistory');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant'))
        .slice(-AIChat.MAX_HISTORY);
    } catch { return []; }
  },
  saveChatHistory(history) { safeSet('chatHistory', history.slice(-AIChat.MAX_HISTORY)); },

  loadProfile() {
    const raw = safeParse('profile') || {};
    const name = typeof raw.username === 'string' ? raw.username.trim().slice(0, 24) : '';
    const avatar = typeof raw.avatar === 'string' ? raw.avatar.trim().slice(0, 4) : '';
    const bio = typeof raw.bio === 'string' ? raw.bio.trim().slice(0, 160) : '';
    const localAvatarId = typeof raw.localAvatarId === 'number' ? raw.localAvatarId : null;
    return { username: name || 'You', avatar, bio, localAvatarId };
  },
  saveProfile(p) {
    safeSet('profile', { username: p.username, avatar: p.avatar, bio: p.bio || '', localAvatarId: p.localAvatarId ?? null });
  },

  loadDailyHistory() {
    try {
      const raw = localStorage.getItem('dailyHistory');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((d) => d && typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
        .map((d) => ({
          date: d.date,
          pomodoros: clampInt(d.pomodoros, 0, 999, 0),
          focusMinutes: clampInt(d.focusMinutes, 0, 999999, 0),
        }))
        .slice(-DAILY_HISTORY_MAX);
    } catch { return []; }
  },
  saveDailyHistory(history) { safeSet('dailyHistory', history.slice(-DAILY_HISTORY_MAX)); },
};

/* ============================== Sound ============================== */

const SoundFX = {
  _ctx: null,
  _unlock() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!SoundFX._ctx) {
      try { SoundFX._ctx = new Ctx(); } catch { return null; }
    }
    if (SoundFX._ctx.state === 'suspended') SoundFX._ctx.resume().catch(() => {});
    return SoundFX._ctx;
  },
  playCompletionSound() {
    const ctx = SoundFX._unlock();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [880, 1108.73].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.15;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.45);
      });
    } catch { /* best-effort notification sound */ }
  },
  /** A quick, bright two-note "ding" for incoming notifications -- distinct from the
      timer-completion sound above, and gated on the same music mute/volume controls
      since this app has no separate sound-effects volume setting. */
  playNotificationChime() {
    if (state.musicSettings.muted) return;
    const peak = 0.15 * (typeof state.musicSettings.volume === 'number' ? state.musicSettings.volume : 1);
    if (peak <= 0) return;
    const ctx = SoundFX._unlock();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [1046.5, 1567.98].forEach((freq, i) => { // C6 then G6
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = now + i * 0.09;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    } catch { /* best-effort notification sound */ }
  },
};

/* ============================== Timer ============================== */

const Timer = {
  MODE_LABELS: { pomodoro: 'Focus!', shortBreak: 'Short Break', longBreak: 'Long Break' },
  _intervalId: null,

  formatTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  },
  durationMs(mode) {
    // While I'm inside an active group sprint, the host's focus/break lengths replace my own.
    const sprint = Lounge.mySprint();
    if (sprint && mode === 'pomodoro') return sprint.focusMinutes * 60000;
    if (sprint && mode === 'shortBreak') return sprint.breakMinutes * 60000;
    return state.settings[mode] * 60000;
  },

  start() {
    if (state.timer.running) return;
    SoundFX._unlock();
    state.timer.endAt = Date.now() + state.timer.remainingMs;
    state.timer.running = true;
    if (Timer._intervalId === null) {
      Timer._intervalId = setInterval(Timer.tick, 250);
    }
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    Lounge.reportStatus();
  },
  pause() {
    if (!state.timer.running) return;
    state.timer.remainingMs = Math.max(0, state.timer.endAt - Date.now());
    state.timer.running = false;
    state.timer.endAt = null;
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    Lounge.reportStatus();
  },
  reset() {
    state.timer.running = false;
    state.timer.endAt = null;
    state.timer.remainingMs = Timer.durationMs(state.timer.mode);
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    Lounge.reportStatus();
  },
  skip() { Timer._advanceMode(false); },

  // Manual mode switch from the tabs — distinct from _advanceMode, which is the automatic
  // pomodoro/break cycling. Switching manually always stops and resets, never auto-starts.
  switchMode(mode) {
    if (!Timer.MODE_LABELS[mode] || mode === state.timer.mode) return;
    state.timer.mode = mode;
    document.documentElement.setAttribute('data-mode', mode);
    state.timer.running = false;
    state.timer.endAt = null;
    state.timer.remainingMs = Timer.durationMs(mode);
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    Timer.pulseDisplay();
    Lounge.reportStatus();
  },

  pulseDisplay() {
    const el = document.getElementById('timer-display');
    if (!el) return;
    el.classList.remove('timer-display--pulse');
    void el.offsetWidth; // restart the animation even if it's already mid-run
    el.classList.add('timer-display--pulse');
  },

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
    state.timer.endAt = null;
    state.timer.remainingMs = 0;
    Timer.updateTimerDisplay();
    SoundFX.playCompletionSound();
    if (state.timer.mode === 'pomodoro') {
      state.timer._sprintDone = Lounge.isLastSprintPomodoro(); // read before check-in changes the room
      Planner.onPomodoroCompleted();
      Lounge.onOwnPomodoroCompleted();
      if (Auth.isLoggedIn()) Api.post('/api/stats/sessions', { minutes: Math.round(Timer.durationMs('pomodoro') / 60000) }).catch(() => {});
    } else {
      Lounge.onOwnBreakCompleted(state.settings[state.timer.mode]);
    }
    Timer._advanceMode(true);
    state.timer._completing = false;
  },

  _advanceMode(wasCompleted) {
    let next;
    // In a group sprint the phases run back to back (focus -> break -> focus ...) and there is no
    // break after the last pomodoro.
    const sprint = Lounge.mySprint();
    const sprintLast = wasCompleted && state.timer.mode === 'pomodoro' && state.timer._sprintDone;
    state.timer._sprintDone = false;
    if (state.timer.mode === 'pomodoro') {
      if (wasCompleted) state.timer.cyclesCompleted++;
      next = sprint ? (sprintLast ? 'pomodoro' : 'shortBreak')
        : (state.timer.cyclesCompleted > 0 && state.timer.cyclesCompleted % 4 === 0) ? 'longBreak' : 'shortBreak';
    } else {
      next = 'pomodoro';
    }
    state.timer.mode = next;
    document.documentElement.setAttribute('data-mode', next);
    state.timer.remainingMs = Timer.durationMs(next);
    state.timer.endAt = null;
    state.timer.running = false;
    Timer.pulseDisplay();
    const shouldAutoStart = sprint && wasCompleted ? !sprintLast : next === 'pomodoro' ? state.settings.autoStartPomodoros : state.settings.autoStartBreaks;
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    if (shouldAutoStart) Timer.start(); else Lounge.reportStatus();
  },

  RING_CIRCUMFERENCE: 2 * Math.PI * 192,

  /* Runs 4x a second while the timer runs, so every write is skipped when it would change nothing: an
     identical textContent still replaces the text node (and an attribute/title rewrite still notifies the
     browser), which used to re-run style and layout four times a second for no visible difference. */
  _setText(el, text) { if (el && el.textContent !== text) el.textContent = text; },

  updateTimerDisplay() {
    Timer._setText(document.getElementById('timer-display'), Timer.formatTime(state.timer.remainingMs));
    ['pomodoro', 'shortBreak', 'longBreak'].forEach((m) => {
      const tab = document.getElementById(`mode-tab-${m}`);
      if (!tab) return;
      const active = m === state.timer.mode;
      if (tab.getAttribute('aria-selected') !== String(active)) tab.setAttribute('aria-selected', String(active));
      const tabIndex = active ? 0 : -1;
      if (tab.tabIndex !== tabIndex) tab.tabIndex = tabIndex;
    });
    const modeLabel = Timer.MODE_LABELS[state.timer.mode].replace('!', '');
    Timer._setText(document.getElementById('timer-mode-name'), modeLabel);

    const ring = document.getElementById('timer-ring-fill');
    if (ring) {
      const total = Timer.durationMs(state.timer.mode);
      const elapsed = total > 0 ? Math.min(1, Math.max(0, 1 - state.timer.remainingMs / total)) : 0;
      const dash = String(Timer.RING_CIRCUMFERENCE);
      const offsetPx = Timer.RING_CIRCUMFERENCE * (1 - elapsed);
      const offset = String(offsetPx);
      if (Timer._ringDash !== dash) { ring.style.strokeDasharray = dash; Timer._ringDash = dash; }
      if (Timer._ringOffset !== offset) {
        /* The ring has a 1s CSS transition so that big moves (reset, mode switch, skip, a finished session) sweep
           smoothly. But a running timer nudges the ring by well under a pixel every 250ms, and letting each of
           those restart a 1s transition kept the page repainting at 60fps the whole time a timer ran (the
           ring isn't compositor-animated, so every frame re-rastered it and re-blurred the glass panels).
           So: a big jump keeps the transition for the next second; small routine steps apply instantly. The
           colour transition (mode change) is kept either way. */
        const now = performance.now();
        if (Timer._ringOffsetPx === undefined || Math.abs(offsetPx - Timer._ringOffsetPx) > 2) Timer._ringSweepUntil = now + 1000;
        const transition = now >= (Timer._ringSweepUntil || 0) ? 'stroke 0.4s ease' : '';
        if (Timer._ringTransition !== transition) { ring.style.transition = transition; Timer._ringTransition = transition; }
        ring.style.strokeDashoffset = offset;
        Timer._ringOffset = offset;
        Timer._ringOffsetPx = offsetPx;
      }
    }

    const endsAtEl = document.getElementById('timer-ends-at');
    if (endsAtEl) {
      if (state.timer.running) {
        const end = new Date(Date.now() + state.timer.remainingMs);
        Timer._setText(endsAtEl, `Ends at ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`);
      } else {
        Timer._setText(endsAtEl, '');
      }
    }

    const dotsEl = document.getElementById('session-dots');
    const sessionLabel = document.getElementById('session-label');
    if (dotsEl) {
      const posInCycle = state.timer.cyclesCompleted % 4;
      if (Timer._dotsPos !== posInCycle || dotsEl.childElementCount !== 4) {
        dotsEl.replaceChildren();
        for (let i = 0; i < 4; i++) {
          const dot = document.createElement('span');
          dot.className = 'session-dot' + (i < posInCycle ? ' session-dot--done' : '');
          dotsEl.appendChild(dot);
        }
        Timer._dotsPos = posInCycle;
      }
      Timer._setText(sessionLabel, `Session ${posInCycle + 1} · long break after 4`);
    }

    const title = state.timer.running
      ? `${Timer.formatTime(state.timer.remainingMs)} · ${modeLabel} — Pomodoro`
      : 'Pomodoro App';
    if (document.title !== title) document.title = title;
  },
};

/* ============================== Skills ============================== */

const Skills = {
  XP_STEP: 100, // each level requires 100 more XP than the last

  progress(xp) {
    let level = 1;
    let remaining = clampInt(xp, 0, 999999999, 0);
    let need = Skills.XP_STEP;
    while (remaining >= need) {
      remaining -= need;
      level += 1;
      need += Skills.XP_STEP;
    }
    return { level, xpIntoLevel: remaining, xpForLevel: need };
  },
};

/* ============================== Missions ============================== */

const Missions = {
  DEFINITIONS: [
    {
      id: 'pomodoros',
      text: 'Complete 4 Pomodoros',
      target: 4,
      progress: (s) => s.pomodorosCompletedToday,
    },
    {
      id: 'focusTime',
      text: 'Focus for 2 hours',
      target: 120,
      progress: (s) => s.focusMinutesToday,
      formatProgress: (v, t) => `${Math.floor(v / 60)}h ${v % 60}m / ${t / 60}h`,
    },
    {
      id: 'task',
      text: 'Complete 1 task',
      target: 1,
      progress: (s) => s.tasksCompletedToday,
    },
  ],

  status(stats) {
    return Missions.DEFINITIONS.map((m) => {
      const value = Math.min(m.progress(stats), m.target);
      return {
        ...m,
        value,
        done: value >= m.target,
        progressText: m.formatProgress ? m.formatProgress(value, m.target) : `${value}/${m.target}`,
      };
    });
  },

  allDone(stats) {
    return Missions.status(stats).every((m) => m.done);
  },

  // Awards the once-per-day Discipline bonus the moment every daily mission is complete.
  checkAndAwardDaily() {
    if (state.stats.disciplineBonusAwardedToday) return;
    if (!Missions.allDone(state.stats)) return;
    state.stats.disciplineBonusAwardedToday = true;
    state.stats.disciplineXP += 50;
    Storage.saveStats(state.stats);
  },
};

/* ============================== Planner ============================== */

const Planner = {
  addTask(text, estimate, priority, project) {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    const est = Number.parseInt(estimate, 10);
    const clean = Number.isFinite(est) && est > 0 && est <= 99 ? est : 1;
    const p = ['high', 'medium', 'low'].includes(priority) ? priority : null;
    const proj = (project || '').trim().slice(0, 40) || null;
    state.tasks.push({ id: makeId(), text: trimmed.slice(0, 500), completed: false, estimatedPomodoros: clean, completedPomodoros: 0, priority: p, project: proj });
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
    if (t.completed) {
      state.stats.tasksCompletedToday++;
      Storage.saveStats(state.stats);
      Missions.checkAndAwardDaily();
      UI.renderMissions();
    }
    Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
    UI.renderTasks();
    // renderTasks() fully rebuilds the list, so the checkbox's own `:checked` transition
    // never has a from-state to animate from — trigger a one-shot pop on the fresh node instead.
    if (t.completed) {
      const freshCheckbox = document.querySelector(`#task-list li[data-id="${id}"] input[type="checkbox"]`);
      if (freshCheckbox) freshCheckbox.classList.add('checkbox-pop');
    }
  },
  setActiveTask(id) {
    state.activeTaskId = id;
    Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
    UI.renderTasks();
  },
  onPomodoroCompleted() {
    const isFirstToday = state.stats.pomodorosCompletedToday === 0;
    const durationMin = clampInt(state.settings.pomodoro, 1, 180, 25);

    state.stats.pomodorosCompletedToday++;
    state.stats.totalPomodoros++;
    state.stats.focusMinutesToday += durationMin;
    state.stats.totalFocusMinutes += durationMin;
    state.stats.focusXP += 20;
    if (isFirstToday) state.stats.currentStreak++;
    state.stats.lastActiveDate = state.stats.date;
    Storage.saveStats(state.stats);
    Missions.checkAndAwardDaily();

    const todayEntry = state.dailyHistory.find((d) => d.date === state.stats.date);
    if (todayEntry) {
      todayEntry.pomodoros++;
      todayEntry.focusMinutes += durationMin;
    } else {
      state.dailyHistory.push({ date: state.stats.date, pomodoros: 1, focusMinutes: durationMin });
    }
    Storage.saveDailyHistory(state.dailyHistory);

    const active = state.tasks.find(t => t.id === state.activeTaskId);
    if (active) {
      active.completedPomodoros++;
      Storage.saveTasksAndActive(state.tasks, state.activeTaskId);
    }
    UI.renderPomodoroCount();
    UI.renderTasks();
    UI.renderStatsDashboard();
    UI.renderMissions();
    if (state.currentView === 'reports') UI.renderReports();
    if (state.currentView === 'leaderboard') UI.renderLeaderboard();
  },
};

/* ============================== Api ==============================
   Thin fetch wrapper for the real backend (server/). Same-origin by default
   (the server itself serves this file), so no base URL is needed. */
const Api = {
  /* The login session lives in an HttpOnly cookie the browser sends by itself -- page scripts can't read it.
     The only thing kept here is the per-session CSRF token, in memory, sent on every state-changing request. */
  csrf: null,
  /* Older versions kept the session token in localStorage. It is read once so a signed-in person isn't logged out
     by the upgrade: Auth._restoreSession() swaps it for a cookie, then dropLegacyToken() deletes it. */
  legacyToken: safeParseGlobal('pomodoroAuthToken'),
  dropLegacyToken() {
    this.legacyToken = null;
    try { localStorage.removeItem('pomodoroAuthToken'); } catch { /* storage unavailable */ }
  },
  async request(method, path, body, extraHeaders) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    let res;
    try {
      res = await fetch(path, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Can’t reach the server. Check your connection and try again.');
    }
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error((json && json.error) || `Request failed (${res.status}).`);
      err.status = res.status;
      // Some endpoints attach extra fields to an error response (e.g. login's
      // captchaRequired) -- carry them onto the thrown Error so a catch block
      // can react to them without re-parsing the response itself.
      if (json && typeof json === 'object') for (const k of Object.keys(json)) if (k !== 'error') err[k] = json[k];
      throw err;
    }
    return json;
  },
  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  del(path) { return this.request('DELETE', path); },
};

/* ============================== Socket ==============================
   Realtime push from the server: presence, online count, friend requests,
   messages, notifications. Auto-reconnects with backoff; the server itself
   pings every 30s and drops sockets that stop answering (see server/server.js). */
const Socket = {
  ws: null,
  listeners: {},
  reconnectDelay: 1000,
  connect() {
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* already closed */ } }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // No token in the URL: the server reads the session from the cookie the browser sends with the handshake.
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => { this.reconnectDelay = 1000; this.emit('socket-open', {}); });
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.emit(msg.type, msg);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return; // superseded by a newer connect() call (e.g. login/logout)
      setTimeout(() => { if (this.ws === ws) this.connect(); }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 20000);
    });
  },
  /** Client -> server messages exist only for voice signaling; returns false if the socket isn't open. */
  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  },
  on(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  },
  emit(type, msg) { (this.listeners[type] || []).forEach((fn) => fn(msg)); },
};

/* ============================== Captcha (Cloudflare Turnstile) ==============================
   Loaded and rendered only if the server reports it's configured (GET
   /api/config) -- so local dev, with no Turnstile keys, never even fetches
   Cloudflare's script (though by default the server itself falls back to
   Cloudflare's public test keys, so this is normally enabled everywhere; see
   server/server.js). Widgets are single-use: reset() after every submit,
   success or failure, or the next attempt's token() call returns stale data.
   Signup and the forgot-password Step 1 widgets render immediately; the login
   widget renders lazily, the first time showLogin() is called (after 2 failed
   attempts), so a normal user typing their password right the first time
   never sees it. Turnstile has no "track the host page's own theme" mode --
   "auto" only follows the OS prefers-color-scheme, which this app's own
   light/dark toggle doesn't -- so each widget is destroyed and re-rendered
   with an explicit light/dark theme param whenever the app's theme changes. */
const Captcha = {
  enabled: false,
  siteKey: null,
  widgets: {},
  loaded: false,
  _loading: null,
  _loginWanted: false,
  init(config) {
    this.enabled = !!(config.captcha && config.captcha.enabled && config.captcha.siteKey);
    this.siteKey = this.enabled ? config.captcha.siteKey : null;
    if (document.getElementById('auth-modal').open) this.ensureLoaded();
  },
  /* Cloudflare's script is fetched only when the sign-in window is opened, not for every visitor who just
     uses the timer -- otherwise each page view would send their IP address to Cloudflare for nothing. */
  ensureLoaded() {
    if (!this.enabled || this.loaded) return this._loading;
    if (!this._loading) {
      this._loading = this._loadScript().then(() => {
        this.loaded = true;
        this._render('signup', 'captcha-signup');
        this._render('forgot', 'captcha-forgot');
        if (this._loginWanted) this._render('login', 'captcha-login');
      }).catch(() => {
        this.enabled = false; // Cloudflare unreachable: fail visibly rather than silently block submits
      });
    }
    return this._loading;
  },
  _loadScript() {
    return new Promise((resolve, reject) => {
      if (window.turnstile) return resolve();
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('turnstile script failed to load'));
      document.head.appendChild(s);
    });
  },
  _currentTheme() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; },
  _render(key, elId) {
    const el = document.getElementById(elId);
    if (!el || !window.turnstile) return;
    el.hidden = false;
    this.widgets[key] = window.turnstile.render(el, { sitekey: this.siteKey, theme: this._currentTheme() });
  },
  showLogin() {
    if (!this.enabled) return;
    this._loginWanted = true;
    if (!this.loaded) { this.ensureLoaded(); return; }
    if (this.widgets.login !== undefined) return;
    this._render('login', 'captcha-login');
  },
  reRenderForTheme() {
    if (!this.enabled || !this.loaded || !window.turnstile) return;
    for (const key of Object.keys(this.widgets)) {
      window.turnstile.remove(this.widgets[key]);
      delete this.widgets[key];
      this._render(key, `captcha-${key}`);
    }
  },
  token(key) {
    if (!this.enabled || !window.turnstile || this.widgets[key] === undefined) return undefined;
    return window.turnstile.getResponse(this.widgets[key]) || undefined;
  },
  reset(key) {
    if (window.turnstile && this.widgets[key] !== undefined) window.turnstile.reset(this.widgets[key]);
  },
};

/* ============================== OAuthUI ==============================
   Reveals "Continue with Google/Microsoft" only for providers the server
   has real credentials for (GET /api/config) — an unconfigured provider's
   /start route 404s, so showing its button anyway would just be a dead end. */
const OAuthUI = {
  hasAnyProvider: false,
  init(config) {
    const google = !!(config.oauth && config.oauth.google);
    const microsoft = !!(config.oauth && config.oauth.microsoft);
    const facebook = !!(config.oauth && config.oauth.facebook);
    document.getElementById('auth-oauth-google').hidden = !google;
    document.getElementById('auth-oauth-microsoft').hidden = !microsoft;
    document.getElementById('auth-oauth-facebook').hidden = !facebook;
    this.hasAnyProvider = google || microsoft || facebook;
    document.getElementById('auth-oauth-divider').hidden = !this.hasAnyProvider;
  },
};

/* ============================== Auth ==============================
   Real accounts against the backend in server/. Guests (no account) can
   still use the timer/tasks/stats fully — those always stay local to this
   device — but friends/presence/chat/notifications require signing in. */
const Auth = {
  async init() {
    Socket.connect();
    try {
      const config = await Api.get('/api/config');
      Captcha.init(config);
      OAuthUI.init(config);
    } catch { /* config unreachable: OAuth/CAPTCHA UI just stay hidden */ }

    // A completed OAuth redirect lands back here as ?oauth=<one-time code>
    // (or ?oauthError=1 on failure) — never as the real session token, which
    // would otherwise sit in the URL, browser history, and access logs.
    const params = new URLSearchParams(location.search);
    const oauthCode = params.get('oauth');
    const oauthError = params.get('oauthError');
    if (oauthCode || oauthError) history.replaceState(null, '', location.pathname);
    if (oauthCode) {
      try {
        const session = await Api.post('/api/auth/oauth/exchange', { code: oauthCode });
        Auth._onAuthenticated(session);
        return;
      } catch { /* fall through to the normal session check below */ }
    }
    if (oauthError) {
      const message = oauthError === 'email_in_use'
        ? 'An account already exists with that email. Log in with your password to continue.'
        : oauthError === 'consent'
          ? 'To create an account you need to agree to the Terms of Service and Privacy Policy. Tick the box and try again.'
          : 'Sign-in failed. Please try again.';
      Auth._pendingAuthMessage = message;
    }

    await Auth._restoreSession();
  },

  currentUser: null,
  consentRequired: false,
  passwordLogin: true,
  _hadSession() { return safeParseGlobal('pomodoroSignedIn') === true; },
  _applySession(session) {
    Api.csrf = session.csrfToken || null;
    Auth.currentUser = session.user;
    Auth.consentRequired = !!session.consentRequired;
    Auth.passwordLogin = !session.account || session.account.passwordLogin !== false;
    safeSetGlobal('pomodoroSignedIn', true); // just a flag so guests don't ping the server on every visit
  },
  _markSignedOut() {
    Api.csrf = null;
    Auth.currentUser = null;
    Auth.consentRequired = false;
    try { localStorage.removeItem('pomodoroSignedIn'); } catch { /* storage unavailable */ }
  },
  /* Resumes a session from the cookie; and, once, upgrades a session token left in localStorage by an older
     version into a cookie (then deletes it), so nobody is logged out by the change. */
  async _restoreSession() {
    const legacy = Api.legacyToken;
    if (!Auth._hadSession() && !legacy) return;
    try {
      let session = null;
      let migrated = false;
      try {
        session = await Api.get('/api/auth/me');
      } catch (err) {
        if (err.status !== 401 || !legacy) throw err;
      }
      if (!session && legacy) {
        session = await Api.request('POST', '/api/auth/session/upgrade', {}, { Authorization: `Bearer ${legacy}` });
        migrated = true;
      }
      Auth._applySession(session);
      if (migrated) Socket.connect(); // the socket opened before this browser had a cookie
    } catch (err) {
      // Only a real rejection (expired/invalid/account gone) should sign the user out. A network hiccup or a
      // briefly-down/cold-starting server must not log a returning user out from under them.
      if (err.status === 401 || err.status === 404) Auth._markSignedOut();
      else return;
    }
    Api.dropLegacyToken();
  },

  async register(username, password, displayName, email, acceptTerms) {
    const session = await Api.post('/api/auth/register', { username, password, displayName, email, acceptTerms, captchaToken: Captcha.token('signup') });
    Auth._onAuthenticated(session);
  },
  async login(identifier, password, acceptTerms) {
    try {
      const session = await Api.post('/api/auth/login', { identifier, password, acceptTerms, captchaToken: Captcha.token('login') });
      Auth._onAuthenticated(session);
    } catch (err) {
      // The server enforces this regardless; showing the widget here is purely
      // so the *next* attempt's Captcha.token('login') actually has something
      // to send, instead of failing a second time on a widget that was never shown.
      if (err.captchaRequired) Captcha.showLogin();
      throw err;
    }
  },
  _onAuthenticated(session) {
    Auth._applySession(session);
    Api.dropLegacyToken();
    const user = session.user;
    safeSetGlobal('pomodoroGuestChoice', null);
    Socket.connect();
    state.profile.username = user.displayName;
    state.profile.avatar = user.avatar || state.profile.avatar;
    Storage.saveProfile(state.profile);
    if (typeof UI !== 'undefined') { UI.renderProfile(); UI.syncAuthUI(); }
    if (typeof Friends !== 'undefined') Friends.refreshAll();
  },
  continueAsGuest() {
    safeSetGlobal('pomodoroGuestChoice', true);
    if (typeof UI !== 'undefined') UI.syncAuthUI();
  },
  logout() {
    Api.post('/api/auth/logout').catch(() => {}); // revokes the session server-side and clears the cookie; sent before the local clear below
    Auth._markSignedOut();
    Socket.connect();
    if (typeof UI !== 'undefined') UI.syncAuthUI();
  },
  isLoggedIn() { return !!Auth.currentUser; },
};

/* Switches the Welcome modal between its five views: Log In, Sign Up, and the
   three forgot-password/-username steps. The three OAuth-row bits (divider,
   the row itself, and the tabs/hint above it) only belong to Log In/Sign Up --
   the forgot-flow takes over the whole modal, per the design brief. */
function setAuthView(view) {
  const isLogin = view === 'login';
  const isSignup = view === 'signup';
  const isForgot = view === 'forgot1' || view === 'forgot2' || view === 'forgot3';
  document.getElementById('auth-tab-login').classList.toggle('is-active', isLogin);
  document.getElementById('auth-tab-login').setAttribute('aria-selected', String(isLogin));
  document.getElementById('auth-tab-signup').classList.toggle('is-active', isSignup);
  document.getElementById('auth-tab-signup').setAttribute('aria-selected', String(isSignup));
  document.getElementById('auth-panel-login').hidden = !isLogin;
  document.getElementById('auth-panel-signup').hidden = !isSignup;
  document.getElementById('auth-panel-forgot1').hidden = view !== 'forgot1';
  document.getElementById('auth-panel-forgot2').hidden = view !== 'forgot2';
  document.getElementById('auth-panel-forgot3').hidden = view !== 'forgot3';
  document.getElementById('auth-modal-tabs').hidden = isForgot;
  document.getElementById('auth-modal-hint').hidden = isForgot;
  document.getElementById('auth-oauth-row').hidden = isForgot;
  document.getElementById('auth-oauth-divider').hidden = isForgot || !OAuthUI.hasAnyProvider;
  document.getElementById('auth-guest-btn').hidden = isForgot;
  document.getElementById('auth-modal-title').textContent = {
    login: 'Welcome', signup: 'Welcome',
    forgot1: ForgotPassword.mode === 'username' ? 'Forgot your username?' : 'Reset your password',
    forgot2: 'Check your email',
    forgot3: 'New password',
  }[view];
  const firstInput = {
    login: 'auth-login-identifier', signup: 'auth-signup-username', forgot1: 'auth-forgot-identifier',
    forgot2: null, forgot3: 'auth-forgot-new-password',
  }[view];
  if (firstInput) setTimeout(() => document.getElementById(firstInput).focus(), 0);
  else if (view === 'forgot2') setTimeout(() => document.querySelector('.auth-code-box').focus(), 0);
}

/* ============================== ForgotPassword ==============================
   The 3-step "forgot password" flow (request code -> verify code -> set new
   password), plus the sibling 1-step "forgot username" flow that reuses Step
   1's UI in a different mode. State here is just this in-progress attempt --
   nothing persists past a successful reset or the user backing out to Log In. */
const ForgotPassword = {
  mode: 'password', // 'password' | 'username'
  identifier: '',
  resetToken: null,
  resendTimer: null,
  resendSecondsLeft: 0,

  start(mode) {
    this.mode = mode;
    const label = document.getElementById('auth-forgot-identifier-label');
    const input = document.getElementById('auth-forgot-identifier');
    const submitBtn = document.getElementById('auth-forgot1-submit');
    if (mode === 'username') {
      label.childNodes[0].textContent = 'Email ';
      input.type = 'email';
      input.autocomplete = 'email';
      submitBtn.textContent = 'Email my username';
    } else {
      label.childNodes[0].textContent = 'Email or username ';
      input.type = 'text';
      input.autocomplete = 'username';
      submitBtn.textContent = 'Send code';
    }
    input.value = '';
    setFieldStatus(document.getElementById('status-auth-forgot1'), '', '');
    setAuthView('forgot1');
  },

  async submitStep1() {
    const status = document.getElementById('status-auth-forgot1');
    const value = document.getElementById('auth-forgot-identifier').value.trim();
    if (!value) { setFieldStatus(status, this.mode === 'username' ? 'Enter your email.' : 'Enter your email or username.', 'error'); return; }
    setFieldStatus(status, '', '');
    const btn = document.getElementById('auth-forgot1-submit');
    btn.disabled = true;
    try {
      if (this.mode === 'username') {
        const { message } = await Api.post('/api/auth/forgot-username', { email: value, captchaToken: Captcha.token('forgot') });
        showToast(message);
        this.backToLogin();
      } else {
        const { message } = await Api.post('/api/auth/forgot', { identifier: value, captchaToken: Captcha.token('forgot') });
        this.identifier = value;
        setFieldStatus(status, message, 'success');
        this.showStep2();
      }
    } catch (err) {
      setFieldStatus(status, err.message, 'error');
    } finally {
      btn.disabled = false;
      Captcha.reset('forgot');
    }
  },

  showStep2() {
    setAuthView('forgot2');
    setFieldStatus(document.getElementById('status-auth-forgot2'), '', '');
    document.querySelectorAll('.auth-code-box').forEach((b) => { b.value = ''; });
    this.startResendTimer();
  },

  startResendTimer() {
    clearInterval(this.resendTimer);
    this.resendSecondsLeft = 60;
    const link = document.getElementById('auth-forgot2-resend');
    const tick = () => {
      link.disabled = this.resendSecondsLeft > 0;
      link.textContent = this.resendSecondsLeft > 0 ? `Resend code (${this.resendSecondsLeft}s)` : 'Resend code';
      if (this.resendSecondsLeft <= 0) clearInterval(this.resendTimer);
      this.resendSecondsLeft--;
    };
    tick();
    this.resendTimer = setInterval(tick, 1000);
  },

  async resend() {
    const status = document.getElementById('status-auth-forgot2');
    try {
      const { message } = await Api.post('/api/auth/forgot', { identifier: this.identifier, captchaToken: Captcha.token('forgot') });
      setFieldStatus(status, message, 'success');
      this.startResendTimer();
    } catch (err) {
      setFieldStatus(status, err.message, 'error');
    } finally {
      Captcha.reset('forgot');
    }
  },

  getCode() { return Array.from(document.querySelectorAll('.auth-code-box')).map((b) => b.value).join(''); },

  async submitStep2() {
    const status = document.getElementById('status-auth-forgot2');
    const code = this.getCode();
    if (code.length !== 6) { setFieldStatus(status, 'Enter the 6-digit code.', 'error'); return; }
    setFieldStatus(status, '', '');
    const btn = document.getElementById('auth-forgot2-submit');
    btn.disabled = true;
    try {
      const { resetToken } = await Api.post('/api/auth/verify-code', { identifier: this.identifier, code });
      this.resetToken = resetToken;
      clearInterval(this.resendTimer);
      this.showStep3();
    } catch (err) {
      setFieldStatus(status, err.message, 'error');
      document.querySelectorAll('.auth-code-box').forEach((b) => { b.value = ''; });
      document.querySelector('.auth-code-box').focus();
    } finally {
      btn.disabled = false;
    }
  },

  showStep3() {
    setAuthView('forgot3');
    document.getElementById('auth-forgot-new-password').value = '';
    document.getElementById('auth-forgot-confirm-password').value = '';
    setFieldStatus(document.getElementById('status-auth-forgot3'), '', '');
  },

  async submitStep3() {
    const status = document.getElementById('status-auth-forgot3');
    const pw = document.getElementById('auth-forgot-new-password').value;
    const confirm = document.getElementById('auth-forgot-confirm-password').value;
    if (pw.length < 8 || pw.length > 72) { setFieldStatus(status, 'Password must be 8 to 72 characters.', 'error'); return; }
    if (pw !== confirm) { setFieldStatus(status, "Passwords don't match.", 'error'); return; }
    setFieldStatus(status, '', '');
    const btn = document.getElementById('auth-forgot3-submit');
    btn.disabled = true;
    try {
      const session = await Api.post('/api/auth/reset-password', { resetToken: this.resetToken, password: pw });
      Auth._onAuthenticated(session);
      document.getElementById('auth-modal').close();
      this.reset();
      showToast('Password updated');
    } catch (err) {
      setFieldStatus(status, err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  backToLogin() {
    this.reset();
    setAuthView('login');
  },

  reset() {
    this.identifier = '';
    this.resetToken = null;
    clearInterval(this.resendTimer);
    this.resendTimer = null;
  },
};

/* ============================== real-time listeners ==============================
   Global Socket listeners that don't belong to a specific feature module. */
Socket.on('online-count', ({ count }) => {
  const el = document.getElementById('live-users-count');
  if (el) el.textContent = String(count);
});
// A friend deleted their account: drop them from the lists.
Socket.on('friend-removed', () => { if (typeof Friends !== 'undefined') Friends.refreshAll(); });

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
  if (typeof SoundFX !== 'undefined') SoundFX.playNotificationChime();
});
Socket.on('message', ({ message }) => {
  if (state.activeChatFriendId !== message.senderId) Notifications.refreshAll();
});

/* ============================== Leaderboard ==============================
   Real multi-user ranking: server-recorded completed-focus-session minutes,
   scoped to "me + my friends" (GET /api/leaderboard — see server/server.js).
   Guests, or anyone with no friends yet, just see their own personal-best
   list below (UI.renderLeaderboard, entirely local, unaffected). */
const Leaderboard = {
  range: 'weekly',

  async refresh() {
    const guestHint = document.getElementById('leaderboard-guest-hint');
    const tabs = document.getElementById('leaderboard-range-tabs');
    const wrap = document.getElementById('leaderboard-friends-wrap');
    if (!guestHint || !tabs || !wrap) return;
    if (!Auth.isLoggedIn()) {
      guestHint.hidden = false;
      tabs.hidden = true;
      wrap.hidden = true;
      return;
    }
    guestHint.hidden = true;
    tabs.hidden = false;
    wrap.hidden = false;
    try {
      const { entries } = await Api.get(`/api/leaderboard?range=${Leaderboard.range}`);
      Leaderboard._render(entries);
    } catch {
      document.getElementById('leaderboard-podium').replaceChildren();
      document.getElementById('leaderboard-friends-list').replaceChildren();
    }
  },

  // Top 3 entries render as a podium (2nd/1st/3rd, tallest in the middle); rank 4+
  // render as the existing ranked-list rows with a share-of-leader progress bar.
  _render(entries) {
    const podium = document.getElementById('leaderboard-podium');
    const list = document.getElementById('leaderboard-friends-list');
    podium.replaceChildren();
    list.replaceChildren();
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';
      li.textContent = 'No focus sessions logged yet for this range.';
      list.appendChild(li);
      return;
    }

    const top3 = entries.slice(0, 3);
    const displayOrder = [1, 0, 2]; // 2nd, 1st, 3rd — tallest card in the middle
    const podiumClass = ['podium-card--2nd', 'podium-card--1st', 'podium-card--3rd'];
    displayOrder.forEach((entryIdx, posIdx) => {
      const entry = top3[entryIdx];
      if (!entry) return;
      const card = document.createElement('div');
      card.className = `podium-card glass ${podiumClass[posIdx]}`;
      if (Auth.isLoggedIn() && entry.user.id === Auth.currentUser.id) card.classList.add('podium-card--self');
      const avatar = document.createElement('span');
      avatar.className = 'podium-card__avatar';
      Avatars.render(avatar, entry.user);
      const name = document.createElement('div');
      name.className = 'podium-card__name';
      name.textContent = entry.user.displayName;
      const h = Math.floor(entry.totalMinutes / 60), m = entry.totalMinutes % 60;
      const hrs = document.createElement('div');
      hrs.className = 'podium-card__hours';
      hrs.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const rank = document.createElement('div');
      rank.className = 'podium-card__rank';
      rank.textContent = String(entryIdx + 1);
      card.append(avatar, name, hrs, rank);
      podium.appendChild(card);
    });

    const leaderMinutes = Math.max(entries[0] ? entries[0].totalMinutes : 1, 1);
    entries.slice(3).forEach((entry, i) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';
      if (Auth.isLoggedIn() && entry.user.id === Auth.currentUser.id) li.classList.add('leaderboard-item--self');
      const rank = document.createElement('span');
      rank.className = 'leaderboard-item__rank';
      rank.textContent = `#${i + 4}`;
      const avatar = document.createElement('span');
      avatar.className = 'lounge-friend-item__avatar';
      Avatars.render(avatar, entry.user);
      const body = document.createElement('span');
      body.className = 'leaderboard-item__body';
      const name = document.createElement('span');
      name.className = 'leaderboard-item__date';
      name.textContent = entry.user.displayName;
      const bar = document.createElement('span');
      bar.className = 'leaderboard-item__bar';
      const barFill = document.createElement('span');
      barFill.className = 'leaderboard-item__bar-fill';
      barFill.style.width = `${Math.max(4, Math.round((entry.totalMinutes / leaderMinutes) * 100))}%`;
      bar.appendChild(barFill);
      body.append(name, bar);
      const h = Math.floor(entry.totalMinutes / 60), m = entry.totalMinutes % 60;
      const count = document.createElement('span');
      count.className = 'leaderboard-item__count';
      count.textContent = `${h > 0 ? `${h}h ${m}m` : `${m}m`} · ${entry.pomodoros} pomodoro${entry.pomodoros === 1 ? '' : 's'}`;
      li.append(rank, avatar, body, count);
      list.appendChild(li);
    });
  },
};

/* ============================== State (boot) ============================== */

const State = {
  rolloverStatsIfNewDay() {
    const loaded = Storage.loadStats();
    const today = todayStr();
    if (loaded.date === today) {
      state.stats = loaded;
    } else {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      const streakContinues = loaded.date === yesterday && loaded.pomodorosCompletedToday > 0;
      state.stats = {
        ...loaded,
        date: today,
        pomodorosCompletedToday: 0,
        tasksCompletedToday: 0,
        focusMinutesToday: 0,
        restMinutesToday: 0,
        disciplineBonusAwardedToday: false,
        currentStreak: streakContinues ? loaded.currentStreak : 0,
      };
    }
    Storage.saveStats(state.stats);
  },
  init() {
    state.settings = Storage.loadSettings();
    const { tasks, activeTaskId } = Storage.loadTasksAndActive();
    state.tasks = tasks;
    state.activeTaskId = activeTaskId;
    State.rolloverStatsIfNewDay();
    state.mediaSettings = Storage.loadMediaSettings();
    state.musicSettings = Storage.loadMusicSettings();
    state.themeSettings = Storage.loadThemeSettings();
    Theme.apply(state.themeSettings.colors);
    state.chatSettings = Storage.loadChatSettings();
    state.chatHistory = Storage.loadChatHistory();
    state.profile = Storage.loadProfile();
    Lounge.init();
    state.dailyHistory = Storage.loadDailyHistory();
    state.timer.remainingMs = Timer.durationMs(state.timer.mode);
    State.restoreMusic();
    State.restoreProfileAvatar();
  },
  async restoreProfileAvatar() {
    const id = state.profile.localAvatarId;
    if (id == null) return;
    try {
      const record = await LocalMediaDB.get(id);
      if (record) {
        state.profile._avatarUrl = ObjectURLRegistry.set('profile-avatar', record.blob);
        if (typeof UI !== 'undefined') UI.renderProfile();
      }
    } catch { /* IndexedDB unavailable or record missing; fall back to emoji/letter */ }
  },
  async restoreMusic() {
    const m = state.musicSettings;
    if (m.source === 'upload' && m.localAudioId != null) {
      await MusicPlayer.restoreUpload(m.localAudioId);
    } else if (m.source === 'builtin' && m.builtinTrackId) {
      await MusicPlayer.selectBuiltin(m.builtinTrackId);
    } else if (m.source === 'url' && m.audioUrl) {
      await MusicPlayer.selectUrl(m.audioUrl); // best-effort; a failure here just leaves nothing selected
    }
    if (typeof UI.renderMusicUI === 'function') UI.renderMusicUI();
  },
};

/* ============================== MediaService ============================== */

const MediaService = {
  ALLOWED_SCHEMES: ['http:', 'https:'],
  isAllowedUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    try { return MediaService.ALLOWED_SCHEMES.includes(new URL(url).protocol); } catch { return false; }
  },

  loadImageFromUrl(url, timeoutMs = 12000) {
    return new Promise((resolve) => {
      if (!MediaService.isAllowedUrl(url)) { resolve({ ok: false, reason: 'Please enter a valid URL.' }); return; }
      const img = new Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        resolve({ ok: false, reason: 'Unable to load this image. Check the URL or choose another file.' });
      }, timeoutMs);
      img.onload = () => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok: true }); };
      img.onerror = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        resolve({ ok: false, reason: 'Unable to load this image. Check the URL or choose another file.' });
      };
      img.src = url;
    });
  },

  loadVideoFromUrl(url, timeoutMs = 12000) {
    return new Promise((resolve) => {
      if (!MediaService.isAllowedUrl(url)) { resolve({ ok: false, reason: 'Please enter a valid URL.' }); return; }
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      let settled = false;
      function cleanup() { video.removeAttribute('src'); try { video.load(); } catch { /* detached element, ignore */ } }
      const timer = setTimeout(() => {
        if (settled) return; settled = true; cleanup();
        resolve({ ok: false, reason: 'Unable to load this video. Make sure the URL points directly to a supported video file.' });
      }, timeoutMs);
      video.onloadedmetadata = () => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); resolve({ ok: true }); };
      video.onerror = () => {
        if (settled) return; settled = true; clearTimeout(timer); cleanup();
        resolve({ ok: false, reason: 'Unable to load this video. Make sure the URL points directly to a supported video file.' });
      };
      video.src = url;
    });
  },

  loadAudioFromUrl(url, timeoutMs = 12000) {
    return new Promise((resolve) => {
      if (!MediaService.isAllowedUrl(url)) { resolve({ ok: false, reason: 'Please enter a valid URL.' }); return; }
      const audio = new Audio();
      audio.preload = 'metadata';
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        resolve({ ok: false, reason: 'Unable to load this media. The link may be broken, blocked by its source, or not a direct media file. Try a different URL or upload the file instead.' });
      }, timeoutMs);
      audio.onloadedmetadata = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        resolve({ ok: true, duration: audio.duration });
      };
      audio.onerror = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        resolve({ ok: false, reason: 'Unable to load this media. The link may be broken, blocked by its source, or not a direct media file. Try a different URL or upload the file instead.' });
      };
      audio.src = url;
    });
  },

  SIZE_CAPS: { image: 15 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 30 * 1024 * 1024 },

  validateLocalFile(file, kind) {
    return new Promise((resolve) => {
      if (!file) { resolve({ ok: false, reason: 'This file could not be loaded. Please choose another file.' }); return; }
      if (!file.type || !file.type.startsWith(kind + '/')) {
        resolve({ ok: false, reason: 'This file could not be loaded. Please choose another file.' }); return;
      }
      if (file.size > MediaService.SIZE_CAPS[kind]) {
        resolve({ ok: false, reason: 'This file is too large. Please choose a smaller file.' }); return;
      }
      const objectUrl = URL.createObjectURL(file);
      const finish = (result) => { URL.revokeObjectURL(objectUrl); resolve(result); };
      if (kind === 'image') {
        const img = new Image();
        img.onload = () => finish({ ok: true });
        img.onerror = () => finish({ ok: false, reason: 'This file could not be loaded. Please choose another file.' });
        img.src = objectUrl;
      } else if (kind === 'video') {
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true;
        v.onloadedmetadata = () => finish({ ok: true });
        v.onerror = () => finish({ ok: false, reason: 'This file could not be loaded. Please choose another file.' });
        v.src = objectUrl;
      } else {
        const a = new Audio();
        a.preload = 'metadata';
        a.onloadedmetadata = () => finish({ ok: true, duration: a.duration });
        a.onerror = () => finish({ ok: false, reason: 'This file could not be loaded. Please choose another file.' });
        a.src = objectUrl;
      }
    });
  },
};

/* ============================== LocalMediaDB / ObjectURLRegistry ============================== */

const LocalMediaDB = {
  _dbPromise: null,
  open() {
    if (LocalMediaDB._dbPromise) return LocalMediaDB._dbPromise;
    LocalMediaDB._dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open('pomodoroLocalMedia', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return LocalMediaDB._dbPromise;
  },
  async save(kind, file) {
    const db = await LocalMediaDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const record = { kind, name: file.name, mimeType: file.type, size: file.size, blob: file, createdAt: Date.now() };
      const req = tx.objectStore('files').add(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async get(id) {
    if (id == null) return null;
    const db = await LocalMediaDB.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('files', 'readonly').objectStore('files').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async delete(id) {
    if (id == null) return;
    const db = await LocalMediaDB.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

const ObjectURLRegistry = {
  _urls: {},
  set(slot, blob) {
    ObjectURLRegistry.revoke(slot);
    const url = URL.createObjectURL(blob);
    ObjectURLRegistry._urls[slot] = url;
    return url;
  },
  revoke(slot) {
    if (ObjectURLRegistry._urls[slot]) {
      URL.revokeObjectURL(ObjectURLRegistry._urls[slot]);
      delete ObjectURLRegistry._urls[slot];
    }
  },
};

/* ============================== Media ============================== */

const Media = {
  applyDefaultBackground() {
    const layer = document.getElementById('background-layer');
    layer.replaceChildren();
    layer.setAttribute('data-empty', '');
    document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0)');
    UI.hideMediaPanel();
    Media._appliedMediaSettings = { ...DEFAULT_MEDIA };
  },

  /* The last media settings that actually rendered successfully (any type). Used only to recover
     from a YouTube video that turns out to be broken -- see _revertToPrevious. */
  _appliedMediaSettings: null,
  /* A video failed after the user already saved it as their background (embedding disabled,
     invalid id, etc): restore whatever was showing before that attempt instead of leaving a
     broken player on screen, and tell the user why. */
  _revertToPrevious(message) {
    state.mediaSettings = Media._appliedMediaSettings ? { ...Media._appliedMediaSettings } : { ...DEFAULT_MEDIA };
    Storage.saveMediaSettings(state.mediaSettings);
    showToast(message, 'error');
    Media.applyBackground();
  },

  _requestSeq: 0,

  async applyBackground() {
    const layer = document.getElementById('background-layer');
    layer.removeAttribute('data-empty');

    const existingVideo = layer.querySelector('video');
    if (existingVideo) {
      existingVideo.onerror = null;
      existingVideo.pause();
      existingVideo.removeAttribute('src');
      existingVideo.load();
    }
    if (typeof YouTube !== 'undefined' && state.mediaSettings.type !== 'youtube') {
      YouTube._destroyPlayer();
    }
    // release any previously-applied local blob URLs; whichever branch below needs one recreates it immediately
    ObjectURLRegistry.revoke('bg-image');
    ObjectURLRegistry.revoke('bg-video');

    const m = state.mediaSettings;
    const requestId = ++Media._requestSeq; // guards a slower earlier request from clobbering a faster later one

    if (m.type === 'image') {
      const result = await MediaService.loadImageFromUrl(m.imageUrl);
      if (requestId !== Media._requestSeq) return;
      if (!result.ok) { Media.applyDefaultBackground(); return; }
      layer.replaceChildren();
      const img = document.createElement('img');
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.src = m.imageUrl;
      layer.appendChild(img);
      document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0.35)');
      UI.hideMediaPanel();
      Media._appliedMediaSettings = { ...m };
      return;
    }

    if (m.type === 'video') {
      const result = await MediaService.loadVideoFromUrl(m.videoUrl);
      if (requestId !== Media._requestSeq) return;
      if (!result.ok) { Media.applyDefaultBackground(); return; }
      layer.replaceChildren();
      const video = document.createElement('video');
      video.autoplay = true; video.muted = true; video.loop = true; video.playsInline = true;
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      const source = document.createElement('source');
      source.src = m.videoUrl;
      video.appendChild(source);
      layer.appendChild(video);
      video.play().catch(() => { /* autoplay may be blocked; media panel play button covers it */ });
      document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0.35)');
      UI.showMediaPanel();
      UI.syncMediaControls();
      Media._appliedMediaSettings = { ...m };
      return;
    }

    if (m.type === 'youtube') {
      layer.replaceChildren();
      if (typeof YouTube !== 'undefined' && YouTube.applyBackground) {
        document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0.35)');
        YouTube.applyBackground();
        // _appliedMediaSettings is recorded once the player actually reaches PLAYING (see
        // YouTube.applyBackground's onStateChange) -- not here, since we don't yet know the
        // video will actually play.
      } else {
        Media.applyDefaultBackground();
      }
      return;
    }

    if (m.type === 'localImage') {
      const record = await LocalMediaDB.get(m.localImageId);
      if (requestId !== Media._requestSeq) return;
      if (!record) { Media.applyDefaultBackground(); return; }
      const url = ObjectURLRegistry.set('bg-image', record.blob);
      layer.replaceChildren();
      const img = document.createElement('img');
      img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      img.src = url;
      layer.appendChild(img);
      document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0.35)');
      UI.hideMediaPanel();
      Media._appliedMediaSettings = { ...m };
      return;
    }

    if (m.type === 'localVideo') {
      const record = await LocalMediaDB.get(m.localVideoId);
      if (requestId !== Media._requestSeq) return;
      if (!record) { Media.applyDefaultBackground(); return; }
      const url = ObjectURLRegistry.set('bg-video', record.blob);
      layer.replaceChildren();
      const video = document.createElement('video');
      video.autoplay = true; video.muted = true; video.loop = true; video.playsInline = true;
      video.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      video.src = url;
      layer.appendChild(video);
      video.play().catch(() => {});
      document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0.35)');
      UI.showMediaPanel();
      UI.syncMediaControls();
      Media._appliedMediaSettings = { ...m };
      return;
    }

    Media.applyDefaultBackground();
  },

  getActiveController() {
    if (state.mediaSettings.type === 'youtube' && YouTube._player && typeof YouTube._player.playVideo === 'function') {
      const p = YouTube._player;
      return {
        play: () => p.playVideo(),
        pause: () => p.pauseVideo(),
        setMuted: (muted) => { muted ? p.mute() : p.unMute(); },
        setVolume: (v) => p.setVolume(v),
        isPlaying: () => { try { return p.getPlayerState() === 1; } catch { return false; } },
      };
    }
    if (state.mediaSettings.type === 'video') {
      const v = document.querySelector('#background-layer video');
      if (!v) return null;
      return {
        play: () => v.play().catch(() => {}),
        pause: () => v.pause(),
        setMuted: (muted) => { v.muted = muted; },
        setVolume: (vol) => { v.volume = vol / 100; },
        isPlaying: () => !v.paused,
      };
    }
    return null;
  },
};

/* ============================== YouTube ============================== */

const YouTube = {
  extractId(input) {
    if (!input) return null;
    const trimmed = String(input).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
    try {
      const u = new URL(trimmed);
      const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
      if (host === 'youtu.be') {
        const id = u.pathname.slice(1).split('/')[0];
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
      }
      if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (u.pathname === '/watch') {
          const id = u.searchParams.get('v');
          return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
        if (u.pathname.startsWith('/embed/')) {
          const id = u.pathname.split('/')[2];
          return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        }
        if (u.pathname.startsWith('/shorts/')) {
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
      if (window.YT && window.YT.Player) { resolve(); return; }
      const timeout = setTimeout(resolve, 10000);
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        if (typeof prevCallback === 'function') prevCallback();
        resolve();
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const s = document.createElement('script');
        s.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(s);
      }
    });
    return YouTube._apiPromise;
  },

  checkEmbeddable(id, timeoutMs = 12000) {
    return new Promise(async (resolve) => {
      await YouTube.ensureApiLoaded();
      if (!window.YT || !window.YT.Player) { resolve({ ok: false, reason: 'Unable to load this YouTube video. Check the URL.' }); return; }
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
      document.body.appendChild(probe);
      let settled = false;
      let player = null;
      const finish = (result) => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        try { player && player.destroy(); } catch { /* already gone */ }
        probe.remove();
        resolve(result);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: 'Unable to load this YouTube video. Check the URL.' }), timeoutMs);
      try {
        player = new YT.Player(probe, {
          videoId: id,
          playerVars: { autoplay: 0, mute: 1, controls: 0 },
          events: {
            onReady: () => finish({ ok: true }),
            onError: () => finish({ ok: false, reason: 'Unable to load this YouTube video. The owner may not allow it to be embedded, or the video/ID is invalid.' }),
          },
        });
      } catch { finish({ ok: false, reason: 'Unable to load this YouTube video. Check the URL.' }); }
    });
  },

  _player: null,
  _destroyPlayer() {
    if (YouTube._player) {
      try { YouTube._player.destroy(); } catch { /* already gone */ }
      YouTube._player = null;
    }
    YouTube._wasPlayingBeforeHidden = false;
  },

  _CANT_EMBED_MESSAGE: "This video can't be used as a background. Try another one.",

  async applyBackground() {
    const id = YouTube.extractId(state.mediaSettings.youtubeId);
    YouTube._destroyPlayer();
    if (!id) { Media._revertToPrevious(YouTube._CANT_EMBED_MESSAGE); return; }

    const layer = document.getElementById('background-layer');
    const isBackgroundMode = state.mediaSettings.playbackMode === 'background';
    const wrapper = document.createElement('div');
    wrapper.className = isBackgroundMode ? 'yt-wrapper' : 'yt-wrapper yt-wrapper--hidden';

    if (isBackgroundMode) {
      // Shown until the player reports PLAYING, so the user never sees a blank layer, a
      // loading spinner, or YouTube's red play button while the iframe spins up.
      const thumb = document.createElement('img');
      thumb.alt = '';
      thumb.className = 'yt-thumb';
      thumb.src = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
      // Not every video has a maxres thumbnail -- and when it doesn't, i.ytimg.com serves a tiny
      // 120x90 gray placeholder JPEG with a 404 status rather than actually failing to load, so
      // `onerror` alone never fires. Check the decoded size on `load` too and swap to hqdefault.jpg
      // (which always exists) in either case.
      const fallToHqThumb = () => { thumb.onerror = null; thumb.onload = null; thumb.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; };
      thumb.onerror = fallToHqThumb;
      thumb.onload = () => { if (thumb.naturalWidth <= 120) fallToHqThumb(); };
      wrapper.appendChild(thumb);
    }
    const target = document.createElement('div');
    target.id = 'youtube-player-target';
    wrapper.appendChild(target);
    layer.appendChild(wrapper);

    await YouTube.ensureApiLoaded();
    if (!window.YT || !window.YT.Player) { Media._revertToPrevious(YouTube._CANT_EMBED_MESSAGE); return; }
    // Settings may have changed again while the API script was loading.
    if (state.mediaSettings.type !== 'youtube' || YouTube.extractId(state.mediaSettings.youtubeId) !== id) return;

    try {
      YouTube._player = new YT.Player('youtube-player-target', {
        videoId: id,
        // Privacy-enhanced domain -- doesn't set YouTube cookies until/unless the user
        // actually interacts with the video.
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          autoplay: 1,
          mute: 1, // always start muted: browsers block autoplay-with-sound outright, which is
                   // exactly what used to leave the red play button showing instead of playing.
          controls: 0,
          disablekb: 1,
          fs: 0,
          iv_load_policy: 3, // no video annotations
          rel: 0, // no related-video end screen
          playsinline: 1,
          loop: 1,
          playlist: id, // required by YouTube for `loop` to work on a single video
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            try {
              e.target.mute();
              state.mediaSettings.muted = true; // reflect reality in the mute button; user unmutes via our own control
              e.target.setVolume(Math.round(state.mediaSettings.volume * 100));
              e.target.playVideo();
            } catch { /* player may already be gone if media type changed */ }
            UI.showMediaPanel();
            UI.syncMediaControls();
          },
          onStateChange: (e) => {
            if (e.data === YT.PlayerState.PLAYING) {
              const iframe = document.getElementById('youtube-player-target');
              if (iframe) iframe.classList.add('yt-playing');
              Media._appliedMediaSettings = { ...state.mediaSettings };
            } else if (e.data === YT.PlayerState.ENDED) {
              // `loop`+`playlist` above should already loop natively; this is a defensive
              // backstop so YouTube's "suggested videos" end screen can never flash on screen.
              try { e.target.seekTo(0); e.target.playVideo(); } catch { /* player may be gone */ }
            }
          },
          onError: () => {
            // Error codes: 2 = invalid video id, 100 = video not found/removed,
            // 101/150 = the owner has disabled embedding. All are unrecoverable here --
            // whichever it is, there is no broken-player state to show, just fall back.
            YouTube._destroyPlayer();
            Media._revertToPrevious(YouTube._CANT_EMBED_MESSAGE);
          },
        },
      });
    } catch { Media._revertToPrevious(YouTube._CANT_EMBED_MESSAGE); }
  },

  _wasPlayingBeforeHidden: false,
};

// Pause the background video when the tab isn't visible (saves battery/data) and resume it
// when it becomes visible again -- but only if it was actually playing before, so this never
// un-pauses a video the user paused themselves via the media panel.
document.addEventListener('visibilitychange', () => {
  if (state.mediaSettings.type !== 'youtube' || !YouTube._player) return;
  try {
    if (document.hidden) {
      YouTube._wasPlayingBeforeHidden = YouTube._player.getPlayerState() === 1;
      if (YouTube._wasPlayingBeforeHidden) YouTube._player.pauseVideo();
    } else if (YouTube._wasPlayingBeforeHidden) {
      YouTube._player.playVideo();
    }
  } catch { /* player may be mid-teardown */ }
});

/* ============================== Built-in music library (procedural) ============================== */

function renderTrackBuffer(durationSec, genFn) {
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
  genFn(offlineCtx, durationSec);
  return offlineCtx.startRendering();
}

function genWhiteNoise(ctx) {
  const buffer = ctx.createBuffer(2, ctx.length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
  }
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const gain = ctx.createGain(); gain.gain.value = 0.5;
  src.connect(gain).connect(ctx.destination); src.start(0);
}

function genBrownNoise(ctx) {
  const buffer = ctx.createBuffer(2, ctx.length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const gain = ctx.createGain(); gain.gain.value = 0.6;
  src.connect(gain).connect(ctx.destination); src.start(0);
}

function genRain(ctx) {
  const buffer = ctx.createBuffer(2, ctx.length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource(); src.buffer = buffer;
  const bandpass = ctx.createBiquadFilter(); bandpass.type = 'bandpass'; bandpass.frequency.value = 3000; bandpass.Q.value = 0.6;
  const gain = ctx.createGain(); gain.gain.value = 0.35;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.08;
  lfo.connect(lfoGain).connect(gain.gain); lfo.start(0);
  src.connect(bandpass).connect(gain).connect(ctx.destination); src.start(0);
}

function genAmbientPad(ctx, durationSec) {
  [130.81, 164.81, 196.00].forEach((f, i) => {
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, 0);
    gain.gain.linearRampToValueAtTime(0.12, 3);
    gain.gain.setValueAtTime(0.12, Math.max(3, durationSec - 3));
    gain.gain.linearRampToValueAtTime(0, durationSec);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07 + i * 0.02;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 1.5;
    lfo.connect(lfoGain).connect(osc.frequency); lfo.start(0);
    osc.connect(gain).connect(ctx.destination); osc.start(0); osc.stop(durationSec);
  });
}

function genSoftTones(ctx, durationSec) {
  const scale = [261.63, 293.66, 329.63, 392.00, 440.00];
  let t = 1, seed = 42;
  function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  while (t < durationSec - 2) {
    const freq = scale[Math.floor(rand() * scale.length)];
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    osc.connect(gain).connect(ctx.destination); osc.start(t); osc.stop(t + 2);
    t += 1.5 + rand() * 1.5;
  }
}

function genWarmFocus(ctx, durationSec) {
  const master = ctx.createGain(); master.gain.value = 0.18;
  const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 1200;
  lowpass.connect(master).connect(ctx.destination);
  [220.00, 261.63, 329.63].forEach((f) => {
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
    const gain = ctx.createGain(); gain.gain.value = 0.2;
    osc.connect(gain).connect(lowpass); osc.start(0); osc.stop(durationSec);
  });
  const buffer = ctx.createBuffer(1, ctx.length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.05;
  const noiseSrc = ctx.createBufferSource(); noiseSrc.buffer = buffer;
  noiseSrc.connect(lowpass); noiseSrc.start(0);
}

const BUILTIN_TRACKS = [
  { id: 'rain', name: 'Rain', category: 'Nature', durationSec: 45, gen: genRain },
  { id: 'white-noise', name: 'White Noise', category: 'Noise', durationSec: 30, gen: genWhiteNoise },
  { id: 'deep-focus', name: 'Deep Focus', category: 'Noise', durationSec: 30, gen: genBrownNoise },
  { id: 'ambient-pad', name: 'Ambient Pad', category: 'Ambient', durationSec: 60, gen: genAmbientPad },
  { id: 'soft-tones', name: 'Soft Tones', category: 'Calm', durationSec: 50, gen: genSoftTones },
  { id: 'warm-focus', name: 'Warm Focus', category: 'Ambient', durationSec: 55, gen: genWarmFocus },
];

/* ============================== MusicPlayer ============================== */

const musicAudioEl = new Audio();
musicAudioEl.addEventListener('ended', () => {
  if (!musicAudioEl.loop) { MusicPlayer._playing = false; if (MusicPlayer._mode === 'builtin') MusicPlayer.next(); }
});

const MusicPlayer = {
  _mode: null,
  _playing: false,
  _localAudioId: null,

  _liveCtx: null,
  _sourceNode: null,
  _gainNode: null,
  _pendingBuffer: null,
  _bufferDuration: 0,
  _startedAt: 0,
  _pauseOffset: 0,
  _bufferCache: {},

  _ensureLiveCtx() {
    if (!MusicPlayer._liveCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      MusicPlayer._liveCtx = new Ctx();
    }
    if (MusicPlayer._liveCtx.state === 'suspended') MusicPlayer._liveCtx.resume().catch(() => {});
    return MusicPlayer._liveCtx;
  },

  async selectUrl(url) {
    const result = await MediaService.loadAudioFromUrl(url);
    if (!result.ok) return result;
    MusicPlayer._teardownBuiltin();
    musicAudioEl.pause();
    musicAudioEl.src = url;
    musicAudioEl.loop = state.musicSettings.loop;
    musicAudioEl.volume = state.musicSettings.muted ? 0 : state.musicSettings.volume;
    MusicPlayer._mode = 'url';
    MusicPlayer._playing = false;
    return { ok: true };
  },

  async selectUpload(file) {
    const result = await MediaService.validateLocalFile(file, 'audio');
    if (!result.ok) return result;
    const id = await LocalMediaDB.save('audio', file);
    const url = ObjectURLRegistry.set('music-audio', file);
    MusicPlayer._teardownBuiltin();
    musicAudioEl.pause();
    musicAudioEl.src = url;
    musicAudioEl.loop = state.musicSettings.loop;
    musicAudioEl.volume = state.musicSettings.muted ? 0 : state.musicSettings.volume;
    MusicPlayer._mode = 'upload';
    MusicPlayer._localAudioId = id;
    MusicPlayer._playing = false;
    return { ok: true, id };
  },

  async restoreUpload(id) {
    const record = await LocalMediaDB.get(id);
    if (!record) return { ok: false, reason: 'This file could not be loaded. Please choose another file.' };
    const url = ObjectURLRegistry.set('music-audio', record.blob);
    musicAudioEl.src = url;
    musicAudioEl.loop = state.musicSettings.loop;
    musicAudioEl.volume = state.musicSettings.muted ? 0 : state.musicSettings.volume;
    MusicPlayer._mode = 'upload';
    MusicPlayer._localAudioId = id;
    return { ok: true };
  },

  async selectBuiltin(trackId) {
    const track = BUILTIN_TRACKS.find(t => t.id === trackId);
    if (!track) return { ok: false, reason: 'This file could not be loaded. Please choose another file.' };
    MusicPlayer._teardownBuiltin();
    musicAudioEl.pause();
    let buffer = MusicPlayer._bufferCache[trackId];
    if (!buffer) { buffer = await renderTrackBuffer(track.durationSec, track.gen); MusicPlayer._bufferCache[trackId] = buffer; }
    MusicPlayer._mode = 'builtin';
    MusicPlayer._pendingBuffer = buffer;
    MusicPlayer._bufferDuration = buffer.duration;
    MusicPlayer._pauseOffset = 0;
    return { ok: true };
  },

  play() {
    if (MusicPlayer._mode === 'builtin') { MusicPlayer._playBuiltin(); return; }
    if (!MusicPlayer._mode) return;
    musicAudioEl.play().then(() => { MusicPlayer._playing = true; }).catch(() => { MusicPlayer._playing = false; });
  },
  pause() {
    if (MusicPlayer._mode === 'builtin') { MusicPlayer._pauseBuiltin(); return; }
    musicAudioEl.pause();
    MusicPlayer._playing = false;
  },
  setVolume(pct) {
    state.musicSettings.volume = pct / 100;
    musicAudioEl.volume = state.musicSettings.muted ? 0 : state.musicSettings.volume;
    MusicPlayer._setBuiltinGain();
    Storage.saveMusicSettings(state.musicSettings);
  },
  setMuted(muted) {
    state.musicSettings.muted = muted;
    musicAudioEl.volume = muted ? 0 : state.musicSettings.volume;
    MusicPlayer._setBuiltinGain();
    Storage.saveMusicSettings(state.musicSettings);
  },
  setLoop(loop) {
    state.musicSettings.loop = loop;
    musicAudioEl.loop = loop;
    Storage.saveMusicSettings(state.musicSettings);
  },
  getProgress() {
    if (MusicPlayer._mode === 'builtin') return MusicPlayer._builtinProgress();
    if (!MusicPlayer._mode) return { currentSec: 0, durationSec: 0 };
    return { currentSec: musicAudioEl.currentTime || 0, durationSec: musicAudioEl.duration || 0 };
  },
  isPlaying() { return MusicPlayer._playing; },

  _playBuiltin() {
    if (MusicPlayer._playing || !MusicPlayer._pendingBuffer) return;
    const ctx = MusicPlayer._ensureLiveCtx();
    const src = ctx.createBufferSource();
    src.buffer = MusicPlayer._pendingBuffer;
    src.loop = state.musicSettings.loop;
    const gain = ctx.createGain();
    gain.gain.value = state.musicSettings.muted ? 0 : state.musicSettings.volume;
    src.connect(gain).connect(ctx.destination);
    const offset = MusicPlayer._pauseOffset % MusicPlayer._bufferDuration;
    src.start(0, offset);
    src.onended = () => { if (!state.musicSettings.loop) { MusicPlayer._playing = false; MusicPlayer.next(); } };
    MusicPlayer._sourceNode = src;
    MusicPlayer._gainNode = gain;
    MusicPlayer._startedAt = ctx.currentTime - offset;
    MusicPlayer._playing = true;
  },
  _pauseBuiltin() {
    if (!MusicPlayer._sourceNode) return;
    const ctx = MusicPlayer._liveCtx;
    MusicPlayer._pauseOffset = (ctx.currentTime - MusicPlayer._startedAt) % MusicPlayer._bufferDuration;
    MusicPlayer._sourceNode.onended = null;
    try { MusicPlayer._sourceNode.stop(); } catch { /* already stopped */ }
    MusicPlayer._sourceNode = null;
    MusicPlayer._playing = false;
  },
  _teardownBuiltin() {
    if (MusicPlayer._sourceNode) { try { MusicPlayer._sourceNode.onended = null; MusicPlayer._sourceNode.stop(); } catch { /* already stopped */ } MusicPlayer._sourceNode = null; }
    MusicPlayer._playing = false;
    MusicPlayer._pauseOffset = 0;
  },
  _setBuiltinGain() {
    if (MusicPlayer._gainNode) MusicPlayer._gainNode.gain.value = state.musicSettings.muted ? 0 : state.musicSettings.volume;
  },
  _builtinProgress() {
    if (!MusicPlayer._pendingBuffer) return { currentSec: 0, durationSec: 0 };
    if (!MusicPlayer._playing) return { currentSec: MusicPlayer._pauseOffset, durationSec: MusicPlayer._bufferDuration };
    const cur = (MusicPlayer._liveCtx.currentTime - MusicPlayer._startedAt) % MusicPlayer._bufferDuration;
    return { currentSec: cur, durationSec: MusicPlayer._bufferDuration };
  },
  next() {
    if (MusicPlayer._mode !== 'builtin') return;
    const idx = BUILTIN_TRACKS.findIndex(t => t.id === state.musicSettings.builtinTrackId);
    const nextTrack = BUILTIN_TRACKS[(idx + 1 + BUILTIN_TRACKS.length) % BUILTIN_TRACKS.length];
    const wasPlaying = MusicPlayer._playing;
    state.musicSettings.builtinTrackId = nextTrack.id;
    Storage.saveMusicSettings(state.musicSettings);
    MusicPlayer.selectBuiltin(nextTrack.id).then(() => { if (wasPlaying) MusicPlayer.play(); if (typeof UI.renderMusicUI === 'function') UI.renderMusicUI(); });
  },
  prev() {
    if (MusicPlayer._mode !== 'builtin') return;
    const idx = BUILTIN_TRACKS.findIndex(t => t.id === state.musicSettings.builtinTrackId);
    const prevTrack = BUILTIN_TRACKS[(idx - 1 + BUILTIN_TRACKS.length) % BUILTIN_TRACKS.length];
    const wasPlaying = MusicPlayer._playing;
    state.musicSettings.builtinTrackId = prevTrack.id;
    Storage.saveMusicSettings(state.musicSettings);
    MusicPlayer.selectBuiltin(prevTrack.id).then(() => { if (wasPlaying) MusicPlayer.play(); if (typeof UI.renderMusicUI === 'function') UI.renderMusicUI(); });
  },
};

/* ============================== Theme ============================== */

const Theme = {
  PRESETS: {
    default:    DEFAULT_THEME_COLORS,
    midnight:   { bg:'#12141c', surface:'#1c2030', text:'#eef0f8', textMuted:'#9aa0b8', border:'#eef0f8', primary:'#7c9dfc', accentPomodoro:'#e0654f', accentShortBreak:'#2f9e8f', accentLongBreak:'#8b7cf6', success:'#4ade80', warning:'#facc15', danger:'#f87171' },
    ocean:      { bg:'#eaf6f8', surface:'#ffffff', text:'#0b2a33', textMuted:'#4d7480', border:'#0b2a33', primary:'#0e7f92', accentPomodoro:'#d9634b', accentShortBreak:'#1aa6b3', accentLongBreak:'#245e8c', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
    forest:     { bg:'#f1f6ee', surface:'#ffffff', text:'#1e2b1a', textMuted:'#5c6e54', border:'#1e2b1a', primary:'#3f7d47', accentPomodoro:'#c9622f', accentShortBreak:'#4c9a5b', accentLongBreak:'#5a7a3f', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
    sunset:     { bg:'#1c1420', surface:'#2a1f30', text:'#fbeee6', textMuted:'#c9a9b6', border:'#fbeee6', primary:'#ff7a59', accentPomodoro:'#ff7a59', accentShortBreak:'#f3a24c', accentLongBreak:'#c65b9e', success:'#4ade80', warning:'#facc15', danger:'#f87171' },
    lavender:   { bg:'#f6f2fb', surface:'#ffffff', text:'#2f2540', textMuted:'#7c6f92', border:'#2f2540', primary:'#8b6fd6', accentPomodoro:'#d67ba0', accentShortBreak:'#7bb7c9', accentLongBreak:'#8b6fd6', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
    minimal:    { bg:'#fafafa', surface:'#ffffff', text:'#1a1a1a', textMuted:'#7a7a7a', border:'#1a1a1a', primary:'#1a1a1a', accentPomodoro:'#4a4a4a', accentShortBreak:'#6b6b6b', accentLongBreak:'#2e2e2e', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
    cyberpunk:  { bg:'#0a0a12', surface:'#15121f', text:'#f2f0ff', textMuted:'#9d94c9', border:'#f2f0ff', primary:'#ff2e9a', accentPomodoro:'#ff2e9a', accentShortBreak:'#00f0ff', accentLongBreak:'#a742ff', success:'#39ff8f', warning:'#ffe157', danger:'#ff4d6a' },
    warm:       { bg:'#fbf1e6', surface:'#ffffff', text:'#3a2a1c', textMuted:'#8a7360', border:'#3a2a1c', primary:'#c9793a', accentPomodoro:'#c9793a', accentShortBreak:'#a68a4c', accentLongBreak:'#8c5a3c', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
    monochrome: { bg:'#ffffff', surface:'#f2f2f2', text:'#000000', textMuted:'#666666', border:'#000000', primary:'#000000', accentPomodoro:'#333333', accentShortBreak:'#555555', accentLongBreak:'#111111', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
    apex:       { bg:'#0c0c0e', surface:'#17171a', text:'#f5f5f6', textMuted:'#9a9aa0', border:'#f5f5f6', primary:'#e10600', accentPomodoro:'#e10600', accentShortBreak:'#c9cdd6', accentLongBreak:'#7c8592', success:'#3ddc84', warning:'#f5c94d', danger:'#e10600' },
    lofi:       { bg:'#332a3d', surface:'#3f3450', text:'#f7ece8', textMuted:'#cbb6c9', border:'#f7ece8', primary:'#e9a6a0', accentPomodoro:'#e9a6a0', accentShortBreak:'#9fc9c3', accentLongBreak:'#b79bd1', success:'#8fd6b4', warning:'#eecb8f', danger:'#e88f8a' },
    coastal:    { bg:'#eef6f7', surface:'#ffffff', text:'#123044', textMuted:'#5c7d8a', border:'#123044', primary:'#1c6e8c', accentPomodoro:'#d98a5f', accentShortBreak:'#4fb3a9', accentLongBreak:'#2c4a6e', success:'#2f9e78', warning:'#c98a1f', danger:'#c0392b' },
    terminal:   { bg:'#050506', surface:'#0c0e0d', text:'#39ff9c', textMuted:'#4d9d6f', border:'#39ff9c', primary:'#39ff9c', accentPomodoro:'#39ff9c', accentShortBreak:'#22d3ee', accentLongBreak:'#c084fc', success:'#39ff9c', warning:'#f5d90a', danger:'#ff5f56' },
    deepmesh:   { bg:'#0b1026', surface:'#131a33', text:'#eef1ff', textMuted:'#9aa3c9', border:'#eef1ff', primary:'#6c63ff', accentPomodoro:'#6c63ff', accentShortBreak:'#3fd0c9', accentLongBreak:'#a463f2', success:'#3fd0c9', warning:'#f5c94d', danger:'#ff6b81' },
  },

  apply(colors) {
    const root = document.documentElement.style;
    root.setProperty('--bg', colors.bg);
    root.setProperty('--surface', colors.surface);
    root.setProperty('--text', colors.text);
    root.setProperty('--text-muted', colors.textMuted);
    root.setProperty('--border', mix(colors.border, colors.bg, 0.91));
    root.setProperty('--success', colors.success);
    root.setProperty('--warning', colors.warning);
    root.setProperty('--danger', colors.danger);
    root.setProperty('--primary', colors.primary);
    root.setProperty('--primary-hover', mix(colors.primary, '#000000', 0.12));
    root.setProperty('--primary-soft', mix(colors.primary, '#ffffff', 0.85));
    root.setProperty('--accent-pomodoro', colors.accentPomodoro);
    root.setProperty('--accent-shortBreak', colors.accentShortBreak);
    root.setProperty('--accent-longBreak', colors.accentLongBreak);
    // Blend toward the theme's own bg, not literal white (same reasoning as the
    // mesh blobs below): in a light theme bg is already near-white, so this
    // looks the same as before, but in a dark theme it keeps these "soft"
    // tints dark-and-muted instead of rendering as a bright white-pastel patch
    // -- e.g. the #background-layer glow and the decorative overlays that use
    // var(--accent-soft) directly, which is where that patch was visible.
    root.setProperty('--accent-soft-pomodoro', mix(colors.accentPomodoro, colors.bg, 0.85));
    root.setProperty('--accent-soft-shortBreak', mix(colors.accentShortBreak, colors.bg, 0.85));
    root.setProperty('--accent-soft-longBreak', mix(colors.accentLongBreak, colors.bg, 0.85));
    // Mesh-background blobs blend toward the theme's own bg (not toward white), so they
    // read as deep and rich rather than washed-out pastel — used only by the Deep Mesh preset.
    root.setProperty('--mesh-1', mix(colors.accentPomodoro, colors.bg, 0.3));
    root.setProperty('--mesh-2', mix(colors.accentShortBreak, colors.bg, 0.3));
    root.setProperty('--mesh-3', mix(colors.accentLongBreak, colors.bg, 0.3));
    root.setProperty('--mesh-4', mix(colors.primary, colors.bg, 0.3));
    document.documentElement.setAttribute('data-theme-preset', state.themeSettings.preset);
    // Liquid Glass tokens (see <style>) key their light/dark overrides off this attribute,
    // derived the same way the dark-mode toggle itself decides light vs dark. Only
    // re-render Turnstile when this actually flips light<->dark, not on every call
    // here (e.g. tweaking a single Appearance color also runs this function).
    const nextTheme = Theme.isDark() ? 'dark' : 'light';
    if (document.documentElement.getAttribute('data-theme') !== nextTheme) {
      document.documentElement.setAttribute('data-theme', nextTheme);
      Captcha.reRenderForTheme();
    }
    // Every path that changes the visible theme (preset picker, reset button,
    // each custom color swatch, the dark-mode toggle itself) funnels through
    // this one function -- so the toggle's icon is refreshed right here,
    // once, instead of relying on each call site to remember to do it. That
    // was the actual bug: three call sites changed `colors.bg` (which is
    // what isDark() reads) without ever re-rendering the toggle, so it could
    // show light while the page was dark, or vice versa.
    UI.renderDarkModeToggle();
  },
  applyPreset(id) {
    const colors = Theme.PRESETS[id] || Theme.PRESETS.default;
    state.themeSettings = { preset: id, colors };
    Storage.saveThemeSettings(state.themeSettings);
    Theme.apply(colors);
  },
  setColor(key, hex) {
    let colors = { ...state.themeSettings.colors, [key]: hex };
    // Changing the surface a text color sits on is exactly when contrast breaks, so
    // opportunistically fix it here rather than just warning after the fact. A text
    // color the user already set is left alone as long as it still reads fine.
    if (key === 'bg' || key === 'surface') colors = Theme.autoFixTextContrast(colors);
    state.themeSettings = { preset: 'custom', colors };
    Storage.saveThemeSettings(state.themeSettings);
    Theme.apply(colors);
  },
  // Picks whichever of near-black/near-white contrasts more strongly against bgHex.
  idealTextColor(bgHex) {
    const white = '#f5f5f5', black = '#1a1a1a';
    return Theme.contrastRatio(white, bgHex) >= Theme.contrastRatio(black, bgHex) ? white : black;
  },
  autoFixTextContrast(colors) {
    const fixed = { ...colors };
    if (Theme.contrastRatio(fixed.text, fixed.bg) < 4.5) fixed.text = Theme.idealTextColor(fixed.bg);
    if (Theme.contrastRatio(fixed.textMuted, fixed.surface) < 3) fixed.textMuted = Theme.idealTextColor(fixed.surface);
    return fixed;
  },
  resetToDefault() { Theme.applyPreset('default'); },
  isDark() { return relLuminance(state.themeSettings.colors.bg) < 0.5; },
  toggleDarkMode() {
    // applyPreset() -> apply() already refreshes the toggle icon; no need to do it here too.
    Theme.applyPreset(Theme.isDark() ? 'default' : 'midnight');
    if (typeof UI.renderAppearanceUI === 'function') UI.renderAppearanceUI();
  },
  contrastRatio(hexA, hexB) {
    const L1 = relLuminance(hexA), L2 = relLuminance(hexB);
    const lighter = Math.max(L1, L2), darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  },
  checkContrastWarnings() {
    const c = state.themeSettings.colors;
    const warnings = [];
    if (Theme.contrastRatio(c.text, c.bg) < 4.5) warnings.push('Text on Background contrast is low — text may be hard to read.');
    if (Theme.contrastRatio(c.primary, c.bg) < 3) warnings.push('Primary on Background contrast is low — buttons may be hard to see.');
    if (Theme.contrastRatio(c.textMuted, c.surface) < 3) warnings.push('Secondary Text on Surface contrast is low.');
    return warnings;
  },
};

/* ============================== UI ============================== */

const SETTINGS_TABS = ['timer', 'background', 'music', 'appearance', 'ai'];
const APPEARANCE_KEYS = ['primary', 'bg', 'surface', 'text', 'textMuted', 'border', 'accentPomodoro', 'accentShortBreak', 'accentLongBreak'];

function setFieldStatus(el, text, kind) {
  el.textContent = text;
  el.classList.remove('is-error', 'is-success');
  if (kind === 'error') el.classList.add('is-error');
  else if (kind === 'success') el.classList.add('is-success');
}

function showToast(message, kind = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast' + (kind === 'error' ? ' toast--error' : '');
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--show'));
  setTimeout(() => {
    toast.classList.remove('toast--show');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

/* Wraps a native <select> of emoji options with a custom trigger + listbox so it can be
   positioned, sized, and dismissed the way a real dropdown component would be. The select
   itself stays in the DOM (visually hidden) and remains the source of truth for `.value`,
   so nothing that already reads avatarSelect.value needs to change. */
function validateDuration(inputId, errorId, min, max) {
  const inputEl = document.getElementById(inputId);
  const errorEl = document.getElementById(errorId);
  const raw = inputEl.value.trim();
  const n = Number.parseInt(raw, 10);
  const ok = raw !== '' && Number.isFinite(n) && n >= min && n <= max && String(n) === raw;
  inputEl.setAttribute('aria-invalid', String(!ok));
  errorEl.hidden = ok;
  return ok ? n : null;
}

/* ============================== Lounge (Study Lounge) ==============================
   Real multi-user co-working rooms against the backend in server/ -- room membership,
   live status, and sprint ("mission") progress are all server truth, pushed over the
   same WebSocket used for friends/chat (see server/server.js, "study lounge rooms").
   state.lounge.room mirrors the server's room shape plus a client-only activityLog
   synthesized by diffing successive snapshots (the server doesn't keep one). */
const Lounge = {
  PROFILE_EMOJI: ['🎯', '🔥', '🌙', '⚡', '📚', '🌱', '☁️', '🚀', '🧠', '☕', '🎧', '🏆'],
  pendingInvites: [],

  init() {
    Chat.init();
    Guides.init();
    // A single 1s tick just re-renders (interpolating other members' live countdowns
    // between server snapshots -- see displayRemainingMs); it never mutates state.
    setInterval(() => {
      if (typeof UI === 'undefined' || document.hidden) return; // nothing to repaint in a background tab
      UI.renderLoungeChip();
      if (state.currentView === 'lounge' && state.lounge.room) UI.renderLoungeRoom();
    }, 1000);
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

  isSelf(m) { return Auth.isLoggedIn() && m.id === Auth.currentUser.id; },
  /** Self is driven live by the real Timer; every other member's countdown is
      interpolated from their last server-reported snapshot (status pushes happen on
      meaningful transitions only, not every second) so the ring doesn't visibly
      freeze between them. */
  displayRemainingMs(m) {
    if (Lounge.isSelf(m)) return state.timer.remainingMs;
    if (m.status === 'idle') return 0;
    return Math.max(0, m.remainingMs - (Date.now() - m.statusUpdatedAt));
  },
  /** The active sprint's settings while *I* am still in it (not yet checked in / given up), else null. */
  mySprint() {
    const room = state.lounge.room;
    if (!room || !room.mission || room.mission.state !== 'active') return null;
    const self = room.members.find(Lounge.isSelf);
    return self && self.missionState === 'pending' ? room.mission : null;
  },
  isLastSprintPomodoro() {
    const sprint = Lounge.mySprint();
    const self = sprint && state.lounge.room.members.find(Lounge.isSelf);
    return !!sprint && self.missionProgress + 1 >= sprint.targetPomodoros;
  },
  statusLabel(m) {
    if (m.status === 'focusing') return { status: 'focusing', text: `Focusing (${Timer.formatTime(Lounge.displayRemainingMs(m))})` };
    if (m.status === 'resting') return { status: 'resting', text: `On break (${Timer.formatTime(Lounge.displayRemainingMs(m))})` };
    return { status: 'idle', text: 'Idle / Ready' };
  },
  phaseFraction(m) {
    if (m.status === 'idle') return 0;
    const mission = state.lounge.room && state.lounge.room.mission;
    const sprint = mission && mission.state === 'active' && m.missionState === 'pending' ? mission : null;
    const focusMin = sprint ? sprint.focusMinutes : state.settings.pomodoro;
    const breakMin = sprint ? sprint.breakMinutes : state.settings.shortBreak;
    const totalMs = Lounge.isSelf(m)
      ? Timer.durationMs(state.timer.mode)
      : (m.status === 'focusing' ? focusMin : breakMin) * 60000;
    return totalMs > 0 ? Math.min(1, Math.max(0, 1 - Lounge.displayRemainingMs(m) / totalMs)) : 0;
  },

  async refreshAll() {
    if (!Auth.isLoggedIn()) {
      state.lounge.room = null;
      Lounge.pendingInvites = [];
    } else {
      const [{ room }, { invites }] = await Promise.all([
        Api.get('/api/lounge/rooms/mine'),
        Api.get('/api/lounge/invites'),
      ]);
      Lounge._setRoom(room);
      Lounge.pendingInvites = invites;
    }
    Lounge._syncRealtime();
    if (typeof UI !== 'undefined') { UI.renderLoungeView(); UI.renderLoungeChip(); UI.renderRoomInvites(); }
  },

  async createRoom(goalText) {
    const { room } = await Api.post('/api/lounge/rooms', { goal: (goalText || '').trim().slice(0, 80) });
    Lounge._setRoom(room, ['You created the room.']);
    return room.code;
  },
  async joinRoom(codeText) {
    const code = (codeText || '').trim().slice(0, 20);
    if (!code) return false;
    const { room } = await Api.post(`/api/lounge/rooms/${encodeURIComponent(code)}/join`);
    Lounge._setRoom(room, ['You joined the room.']);
    return true;
  },
  async leaveRoom() {
    const room = state.lounge.room;
    state.lounge.room = null;
    Lounge._syncRealtime();
    if (typeof UI !== 'undefined') { UI.renderLoungeView(); UI.renderLoungeChip(); }
    if (room) { try { await Api.post(`/api/lounge/rooms/${encodeURIComponent(room.code)}/leave`); } catch { /* best effort */ } }
  },

  reportStatus() {
    if (!state.lounge.room || !Auth.isLoggedIn()) return;
    const status = state.timer.running ? (state.timer.mode === 'pomodoro' ? 'focusing' : 'resting') : 'idle';
    Api.post(`/api/lounge/rooms/${encodeURIComponent(state.lounge.room.code)}/status`, {
      status, remainingMs: Math.round(state.timer.remainingMs),
    }).catch(() => {});
  },

  startMission(targetPomodoros, focusMinutes, breakMinutes) {
    if (!state.lounge.room) return Promise.resolve();
    return Api.post(`/api/lounge/rooms/${encodeURIComponent(state.lounge.room.code)}/mission/start`, { targetPomodoros: Number(targetPomodoros), focusMinutes, breakMinutes });
  },
  cancelMission() {
    if (!state.lounge.room) return Promise.resolve();
    return Api.post(`/api/lounge/rooms/${encodeURIComponent(state.lounge.room.code)}/mission/cancel`);
  },
  checkIn() {
    if (!state.lounge.room) return Promise.resolve();
    return Api.post(`/api/lounge/rooms/${encodeURIComponent(state.lounge.room.code)}/mission/checkin`);
  },
  giveUpOwnMission() {
    if (!state.lounge.room) return Promise.resolve();
    return Api.post(`/api/lounge/rooms/${encodeURIComponent(state.lounge.room.code)}/mission/giveup`);
  },
  onOwnPomodoroCompleted() {
    const room = state.lounge.room;
    if (!room || !room.mission || room.mission.state !== 'active') return;
    const self = room.members.find(Lounge.isSelf);
    if (!self || self.missionState !== 'pending') return;
    Lounge.checkIn().catch(() => {});
  },
  onOwnBreakCompleted() { /* nothing server-side to report here; reportStatus() already covers status */ },

  async inviteFriend(toUserId) {
    const { invite } = await Api.post('/api/lounge/invites', { toUserId });
    return invite;
  },
  async acceptInvite(inviteId) {
    const { room } = await Api.post(`/api/lounge/invites/${inviteId}/accept`);
    Lounge.pendingInvites = Lounge.pendingInvites.filter((i) => i.id !== inviteId);
    Lounge._setRoom(room, ['You joined the room.']);
    if (typeof UI !== 'undefined') UI.renderRoomInvites();
  },
  async declineInvite(inviteId) {
    await Api.post(`/api/lounge/invites/${inviteId}/decline`);
    Lounge.pendingInvites = Lounge.pendingInvites.filter((i) => i.id !== inviteId);
    if (typeof UI !== 'undefined') UI.renderRoomInvites();
  },

  /* -------- applying a fresh room snapshot (initial fetch or WS push) -------- */

  _setRoom(room, freshLogLines) {
    if (!room) { state.lounge.room = null; Lounge._syncRealtime(); return; }
    const prev = state.lounge.room && state.lounge.room.code === room.code ? state.lounge.room : null;
    room.activityLog = prev ? prev.activityLog : [];
    if (prev) Lounge._diffActivity(prev, room);
    else for (const line of (freshLogLines || [])) Lounge._logActivity(room, line);
    const sprintKey = (r) => { const sp = r && r.mission && r.mission.state === 'active' ? r.mission : null; return sp ? `${sp.focusMinutes}/${sp.breakMinutes}` : ''; };
    const sprintChanged = sprintKey(state.lounge.room) !== sprintKey(room);
    state.lounge.room = room;
    // A sprint starting/ending changes my phase lengths: refresh an idle timer so it shows them.
    if (sprintChanged && !state.timer.running && typeof Timer !== 'undefined') { state.timer.remainingMs = Timer.durationMs(state.timer.mode); Timer.updateTimerDisplay(); }
    Lounge._syncRealtime();
    if (typeof UI !== 'undefined') { UI.renderLoungeView(); UI.renderLoungeChip(); }
  },
  /** Voice and chat follow whichever room I'm seated in: start on entering, tear down on leaving. */
  _syncRealtime() {
    const code = state.lounge.room ? state.lounge.room.code : null;
    if (code !== Voice.roomCode) { if (code) Voice.start(code); else Voice.stop(); }
    if (code !== Chat.roomCode) { if (code) Chat.open(code); else Chat.reset(); }
  },
  _logActivity(room, text) {
    room.activityLog.push({ id: makeId(), ts: Date.now(), text });
    if (room.activityLog.length > 500) room.activityLog.splice(0, room.activityLog.length - 500);
  },
  /** Synthesizes activity-log lines client-side by diffing two successive room
      snapshots -- the server itself keeps no log, just current state. */
  _diffActivity(prev, next) {
    const prevIds = new Set(prev.members.map((m) => m.id));
    const nextIds = new Set(next.members.map((m) => m.id));
    for (const m of next.members) if (!prevIds.has(m.id)) Lounge._logActivity(next, `${m.displayName} joined.`);
    for (const m of prev.members) if (!nextIds.has(m.id)) Lounge._logActivity(next, `${m.displayName} left.`);
    if (!prev.mission && next.mission) Lounge._logActivity(next, `Sprint started: ${next.mission.targetPomodoros} pomodoro${next.mission.targetPomodoros > 1 ? 's' : ''} · ${next.mission.focusMinutes} min focus / ${next.mission.breakMinutes} min break`);
    if (prev.mission && !next.mission) Lounge._logActivity(next, 'Sprint ended.');
    if (prev.mission && next.mission) {
      const prevById = new Map(prev.members.map((m) => [m.id, m]));
      for (const m of next.members) {
        const before = prevById.get(m.id);
        if (before && before.missionState !== m.missionState && m.missionState !== 'pending') {
          Lounge._logActivity(next, `${m.displayName} ${m.missionState === 'checked-in' ? 'checked in' : 'abandoned the sprint'}.`);
        }
      }
    }
    if (prev.hostId !== next.hostId) {
      const newHost = next.members.find((m) => m.id === next.hostId);
      if (newHost) Lounge._logActivity(next, `${newHost.displayName} is now the host.`);
    }
  },
  _onInvite(invite) {
    Lounge.pendingInvites.unshift(invite);
    if (typeof UI !== 'undefined') UI.renderRoomInvites();
  },
  _onMissionComplete() {
    state.stats.disciplineXP += 50;
    Storage.saveStats(state.stats);
    if (typeof UI !== 'undefined') { UI.renderMissions(); UI.renderStatsDashboard(); }
    if (typeof SoundFX !== 'undefined') SoundFX.playCompletionSound();
    if (typeof Confetti !== 'undefined') Confetti.burst();
  },
};

Socket.on('lounge-room', (msg) => Lounge._setRoom(msg.room));
Socket.on('lounge-invite', (msg) => Lounge._onInvite(msg.invite));
Socket.on('lounge-mission-complete', () => Lounge._onMissionComplete());

/* ============================== Icons (line style, same as the music player's) ============================== */
const LineIcons = {
  PATHS: {
    mic: '<rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5"/>',
    'mic-off': '<rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M3 3l14 14"/>',
    headphones: '<path d="M3.5 12V10a6.5 6.5 0 0 1 13 0v2"/><rect x="3" y="11.5" width="3.4" height="5.5" rx="1.4"/><rect x="13.6" y="11.5" width="3.4" height="5.5" rx="1.4"/>',
    'headphones-off': '<path d="M3.5 12V10a6.5 6.5 0 0 1 13 0v2"/><rect x="3" y="11.5" width="3.4" height="5.5" rx="1.4"/><rect x="13.6" y="11.5" width="3.4" height="5.5" rx="1.4"/><path d="M3 3l14 14"/>',
    speaker: '<path d="M3 7.4h2.7L10 4v12l-4.3-3.4H3z"/><path d="M13.1 7.3a3.9 3.9 0 0 1 0 5.4M15.2 5.1a6.9 6.9 0 0 1 0 9.8"/>',
    'speaker-off': '<path d="M3 7.4h2.7L10 4v12l-4.3-3.4H3z"/><path d="M13.5 8l4 4M17.5 8l-4 4"/>',
    chevron: '<path d="M5 8l5 5 5-5"/>',
    image: '<rect x="2.5" y="3.5" width="15" height="13" rx="3"/><circle cx="7" cy="8" r="1.4"/><path d="M3 15l4.5-4.5 3 3L13 11l4 4"/>',
    close: '<path d="M5 5l10 10M15 5L5 15"/>',
    camera: '<rect x="2.5" y="5.5" width="10.5" height="9" rx="2.4"/><path d="M13 9l4.5-2.5v7L13 11z"/>',
    'camera-off': '<rect x="2.5" y="5.5" width="10.5" height="9" rx="2.4"/><path d="M13 9l4.5-2.5v7L13 11zM3 3l14 14"/>',
    screen: '<rect x="2.5" y="3.5" width="15" height="10.5" rx="2.2"/><path d="M7 17h6M10 14v3"/>',
    expand: '<path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5"/>',
    edit: '<path d="M3.5 16.5l.9-3.6L13.6 3.7a1.6 1.6 0 0 1 2.3 0l.4.4a1.6 1.6 0 0 1 0 2.3L7.1 15.6z"/><path d="M12 5.3l2.7 2.7"/>',
    more: '<circle cx="4.5" cy="10" r="1.3"/><circle cx="10" cy="10" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/>',
  },
  /** A fresh <svg class="icon icon--stroke"> element (built via the parser, from the static strings above). */
  el(name) {
    const doc = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" class="icon icon--stroke" viewBox="0 0 20 20" aria-hidden="true">${LineIcons.PATHS[name]}</svg>`, 'image/svg+xml');
    return document.importNode(doc.documentElement, true);
  },
  set(button, name, label) {
    button.replaceChildren(LineIcons.el(name));
    if (label !== undefined) { const span = document.createElement('span'); span.textContent = label; button.appendChild(span); }
  },
};

/* ============================== Voice (WebRTC mesh over the existing WebSocket) ==============================
   Audio is peer-to-peer; the server only relays SDP/ICE between members of the same room
   (server/server.js, "voice chat signaling"). Whoever joins voice offers to everyone already in
   it, so two people never offer to each other at once. Incoming audio goes through Web Audio
   (source -> GainNode -> speakers) so a per-person volume can exceed 100%; the same source also
   feeds an AnalyserNode that drives the speaking glow. Per-person mute/volume only change what
   *I* hear and persist per person in localStorage. */
const Voice = {
  roomCode: null,
  replaced: false,
  localStream: null,
  micDenied: false,
  micMuted: false,
  deafened: false,
  _mutedBeforeDeafen: false,
  /** userId -> { pc, audioEl, source, gain, analyser, pending: RTCIceCandidateInit[], sender } */
  peers: new Map(),
  /** userId -> { muted, deafened } for every OTHER member currently in voice */
  states: {},
  speaking: new Set(),
  /** 'none' | 'camera' | 'screen': what I am showing (only one at a time); videoStream is that capture. */
  video: 'none',
  videoStream: null,
  videoError: '',
  spotlight: null,
  _videoErrTimer: null,
  _speakUntil: {},
  ctx: null,
  _iceServers: null,
  _meter: null,
  _localAnalyser: null,
  _prefs: null,

  /* ---- persisted per-person settings ---- */
  prefs() {
    if (!Voice._prefs) { const raw = safeParseGlobal('pomodoroVoicePrefs'); Voice._prefs = raw && typeof raw === 'object' ? raw : {}; }
    return Voice._prefs;
  },
  pref(uid) {
    const p = Voice.prefs()[uid] || {};
    return { muted: !!p.muted, volume: Number.isFinite(p.volume) ? Math.min(200, Math.max(0, p.volume)) : 100 };
  },
  _savePref(uid, patch) {
    Voice.prefs()[uid] = { ...Voice.pref(uid), ...patch };
    safeSetGlobal('pomodoroVoicePrefs', Voice.prefs());
    Voice._updateGain(uid);
    Voice._refreshUI();
  },
  setPersonMuted(uid, muted) { Voice._savePref(uid, { muted: !!muted }); },
  setPersonVolume(uid, volume) { Voice._savePref(uid, { volume: Math.round(Math.min(200, Math.max(0, Number(volume) || 0))) }); },

  /* ---- lifecycle ---- */
  async start(code) {
    Voice.stop();
    Voice.roomCode = code;
    Voice.replaced = false;
    Voice.micMuted = false;
    Voice.deafened = false;
    Voice._ensureCtx();
    Voice._refreshUI();
    await Voice._acquireMic(); // permission prompt; declining still lets the user join and listen
    if (Voice.roomCode !== code) return; // left while the prompt was open
    Voice._sendJoin();
    Voice._startMeter();
    Voice._refreshUI();
  },
  stop() {
    if (Voice.roomCode) Socket.send({ type: 'voice-leave' });
    Voice.roomCode = null;
    for (const uid of [...Voice.peers.keys()]) Voice._closePeer(uid);
    Voice._stopVideoTracks();
    Voice.states = {};
    Voice.speaking.clear();
    if (Voice.localStream) { Voice.localStream.getTracks().forEach((t) => t.stop()); Voice.localStream = null; }
    Voice._localAnalyser = null;
    clearInterval(Voice._meter);
    Voice._meter = null;
    Voice.micDenied = false;
    Voice._refreshUI();
  },
  _sendJoin() {
    if (!Voice.roomCode || Voice.replaced) return;
    Socket.send({ type: 'voice-join', muted: Voice.micMuted, deafened: Voice.deafened, video: Voice.video });
  },
  _ensureCtx() {
    if (!Voice.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      Voice.ctx = new AC();
    }
    if (Voice.ctx.state === 'suspended') Voice.ctx.resume().catch(() => {});
    return Voice.ctx;
  },
  async _iceConfig() {
    if (!Voice._iceServers) {
      try { Voice._iceServers = (await Api.get('/api/lounge/voice/ice')).iceServers; }
      catch { Voice._iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]; }
    }
    return Voice._iceServers;
  },
  async _acquireMic() {
    if (Voice.localStream) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { Voice.micDenied = true; Voice.micMuted = true; return false; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!Voice.roomCode) { stream.getTracks().forEach((t) => t.stop()); return false; }
      Voice.localStream = stream;
      Voice.micDenied = false;
      const ctx = Voice._ensureCtx();
      if (ctx) { const analyser = ctx.createAnalyser(); analyser.fftSize = 512; ctx.createMediaStreamSource(stream).connect(analyser); Voice._localAnalyser = analyser; }
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.enabled = !Voice.micMuted && !Voice.deafened;
        for (const peer of Voice.peers.values()) if (peer.sender) peer.sender.replaceTrack(track).catch(() => {});
      }
      return true;
    } catch {
      Voice.micDenied = true;
      Voice.micMuted = true; // nothing to send, so show as muted to everyone
      return false;
    }
  },

  /* ---- my controls ---- */
  async toggleMute() {
    if (Voice.deafened) { Voice.deafened = false; Voice.micMuted = false; } // unmuting while deafened undeafens too, like Discord
    else Voice.micMuted = !Voice.micMuted;
    if (!Voice.micMuted && !Voice.localStream) {
      if (!(await Voice._acquireMic())) Voice.micMuted = true; // still blocked: stay listen-only
    }
    Voice._applyLocal();
  },
  toggleDeafen() {
    Voice.deafened = !Voice.deafened;
    if (Voice.deafened) { Voice._mutedBeforeDeafen = Voice.micMuted; Voice.micMuted = true; }
    else Voice.micMuted = Voice._mutedBeforeDeafen;
    Voice._applyLocal();
  },
  _applyLocal() {
    const track = Voice.localStream && Voice.localStream.getAudioTracks()[0];
    if (track) track.enabled = !Voice.micMuted && !Voice.deafened;
    for (const uid of Voice.peers.keys()) Voice._updateGain(uid);
    Voice._sendState();
    Voice._refreshUI();
  },
  _sendState() { Socket.send({ type: 'voice-state', muted: Voice.micMuted, deafened: Voice.deafened, video: Voice.video }); },
  _updateGain(uid) {
    const peer = Voice.peers.get(uid);
    if (!peer || !peer.gain) return;
    const p = Voice.pref(uid);
    const value = Voice.deafened || p.muted ? 0 : p.volume / 100;
    peer.gain.gain.setTargetAtTime(value, Voice.ctx.currentTime, 0.015);
  },

  /* ---- camera / screen share: one video track rides the existing voice connections ---- */
  async _attachLocal(peer, ts) {
    const [tm, tv, ta] = ts;
    if (tm) { tm.direction = 'sendrecv'; peer.sender = tm.sender; }
    if (tv) { tv.direction = 'sendrecv'; peer.vsender = tv.sender; }
    if (ta) { ta.direction = 'sendrecv'; peer.asender = ta.sender; }
    const mic = Voice.localStream && Voice.localStream.getAudioTracks()[0];
    if (mic && tm) await tm.sender.replaceTrack(mic);
    await Voice._sendVideoTracks(peer); // someone joining mid-share gets my video straight away
  },
  async _sendVideoTracks(peer) {
    const vt = (Voice.videoStream && Voice.videoStream.getVideoTracks()[0]) || null;
    const at = (Voice.video === 'screen' && Voice.videoStream && Voice.videoStream.getAudioTracks()[0]) || null;
    if (peer.vsender) { await peer.vsender.replaceTrack(vt).catch(() => {}); if (vt) Voice._capBitrate(peer.vsender); }
    if (peer.asender) await peer.asender.replaceTrack(at).catch(() => {});
  },
  _capBitrate(sender) {
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) return;
      p.encodings[0].maxBitrate = Voice.video === 'screen' ? 2500000 : 700000;
      sender.setParameters(p).catch(() => {});
    } catch { /* not negotiated yet; retried once connected */ }
  },
  _stopVideoTracks() {
    if (Voice.videoStream) Voice.videoStream.getTracks().forEach((t) => t.stop());
    Voice.videoStream = null;
    Voice.video = 'none';
    for (const peer of Voice.peers.values()) {
      if (peer.vsender) peer.vsender.replaceTrack(null).catch(() => {});
      if (peer.asender) peer.asender.replaceTrack(null).catch(() => {});
    }
  },
  _setVideoError(text) {
    Voice.videoError = text;
    clearTimeout(Voice._videoErrTimer);
    if (text) Voice._videoErrTimer = setTimeout(() => { Voice.videoError = ''; Voice.renderBar(); }, 7000);
    Voice.renderBar();
  },
  /** Toggle 'camera' or 'screen'. Turning one on turns the other off; pressing the active one turns it off. */
  async setVideo(kind) {
    if (!Voice.roomCode || Voice.replaced) return;
    if (Voice.video === kind) { Voice._stopVideoTracks(); Voice._sendState(); Voice._refreshUI(); return; }
    Voice._setVideoError('');
    const md = navigator.mediaDevices;
    let stream;
    try {
      if (kind === 'camera') {
        if (!md || !md.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
        stream = await md.getUserMedia({ video: { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { ideal: 24, max: 30 } }, audio: false });
      } else {
        if (!md || !md.getDisplayMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
        // audio: true asks for tab/system sound where the browser offers it; it's simply absent otherwise
        stream = await md.getDisplayMedia({ video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 15 } }, audio: true });
      }
    } catch (err) {
      const blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      Voice._setVideoError(kind === 'camera'
        ? (blocked ? 'Camera access is blocked. Allow it in your browser to turn your camera on.' : err && err.name === 'NotFoundError' ? 'No camera found.' : 'Your camera can’t be started here.')
        : (blocked ? 'Screen sharing was cancelled or blocked.' : 'Your browser can’t share the screen.'));
      return;
    }
    if (!Voice.roomCode) { stream.getTracks().forEach((t) => t.stop()); return; }
    Voice._stopVideoTracks();
    Voice.videoStream = stream;
    Voice.video = kind;
    const vt = stream.getVideoTracks()[0];
    if (kind === 'screen') vt.applyConstraints({ frameRate: { max: 15 }, width: { max: 1920 }, height: { max: 1080 } }).catch(() => {});
    vt.contentHint = kind === 'screen' ? 'detail' : 'motion';
    // The browser's own "Stop sharing" bar ends the track: reflect that immediately.
    vt.addEventListener('ended', () => {
      if (Voice.videoStream !== stream) return;
      Voice._stopVideoTracks();
      Voice._sendState();
      Voice._refreshUI();
    });
    for (const peer of Voice.peers.values()) Voice._sendVideoTracks(peer);
    Voice._sendState();
    Voice._refreshUI();
  },

  /* ---- peer connections ---- */
  async _connectTo(uid) {
    Voice._closePeer(uid);
    const pc = await Voice._newPeer(uid);
    // Fixed order (both ends rely on it, see ontrack): 0 = voice, 1 = camera/screen video, 2 = screen-share audio.
    const ts = [pc.addTransceiver('audio', { direction: 'sendrecv' }), pc.addTransceiver('video', { direction: 'sendrecv' }), pc.addTransceiver('audio', { direction: 'sendrecv' })];
    await Voice._attachLocal(Voice.peers.get(uid), ts);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    Voice._signal(uid, { description: pc.localDescription });
  },
  async _newPeer(uid) {
    const pc = new RTCPeerConnection({ iceServers: await Voice._iceConfig() });
    const peer = { pc, audioEl: null, source: null, gain: null, analyser: null, pending: [], sender: null, vsender: null, asender: null, videoStream: null, screenEl: null, screenSource: null };
    Voice.peers.set(uid, peer);
    pc.onicecandidate = (e) => { if (e.candidate) Voice._signal(uid, { candidate: e.candidate }); };
    pc.ontrack = (e) => {
      const idx = pc.getTransceivers().indexOf(e.transceiver);
      const stream = new MediaStream([e.track]);
      if (idx === 1) Voice._attachRemoteVideo(uid, stream);
      else if (idx === 2) Voice._attachRemoteScreenAudio(uid, stream);
      else Voice._attachRemote(uid, stream);
    };
    pc.onconnectionstatechange = () => {
      const cur = Voice.peers.get(uid);
      if (pc.connectionState === 'connected' && cur && cur.pc === pc && cur.vsender && Voice.video !== 'none') Voice._capBitrate(cur.vsender);
      if (pc.connectionState !== 'failed' || cur?.pc !== pc) return;
      Voice._closePeer(uid);
      // Only the lower id retries, so both ends never offer at once.
      if (Voice.states[uid] && Auth.isLoggedIn() && Auth.currentUser.id < uid) setTimeout(() => { if (Voice.states[uid] && !Voice.peers.has(uid)) Voice._connectTo(uid).catch(() => {}); }, 1000);
    };
    return pc;
  },
  _attachRemote(uid, stream) {
    const peer = Voice.peers.get(uid);
    const ctx = Voice._ensureCtx();
    if (!peer || !ctx) return;
    // Chrome only pumps a remote WebRTC stream into Web Audio if it is also attached to a media
    // element; it is muted because the sound comes out through the GainNode instead.
    peer.audioEl = new Audio();
    peer.audioEl.srcObject = stream;
    peer.audioEl.muted = true;
    peer.audioEl.play().catch(() => {});
    peer.source = ctx.createMediaStreamSource(stream);
    peer.analyser = ctx.createAnalyser();
    peer.analyser.fftSize = 512;
    peer.source.connect(Voice._gainFor(peer));
    peer.source.connect(peer.analyser);
    Voice._updateGain(uid);
  },
  _gainFor(peer) {
    if (!peer.gain) { peer.gain = Voice.ctx.createGain(); peer.gain.connect(Voice.ctx.destination); }
    return peer.gain;
  },
  _attachRemoteScreenAudio(uid, stream) {
    const peer = Voice.peers.get(uid);
    const ctx = Voice._ensureCtx();
    if (!peer || !ctx) return;
    peer.screenEl = new Audio(); // same Chrome quirk as above
    peer.screenEl.srcObject = stream;
    peer.screenEl.muted = true;
    peer.screenEl.play().catch(() => {});
    peer.screenSource = ctx.createMediaStreamSource(stream);
    peer.screenSource.connect(Voice._gainFor(peer));
    Voice._updateGain(uid);
  },
  _attachRemoteVideo(uid, stream) {
    const peer = Voice.peers.get(uid);
    if (!peer) return;
    peer.videoStream = stream;
    Voice._refreshUI();
  },
  _closePeer(uid) {
    const peer = Voice.peers.get(uid);
    if (!peer) return;
    Voice.peers.delete(uid);
    peer.pc.onicecandidate = peer.pc.ontrack = peer.pc.onconnectionstatechange = null;
    try { peer.pc.close(); } catch { /* already closed */ }
    try { if (peer.source) peer.source.disconnect(); if (peer.screenSource) peer.screenSource.disconnect(); if (peer.gain) peer.gain.disconnect(); } catch { /* already disconnected */ }
    if (peer.screenEl) { peer.screenEl.srcObject = null; peer.screenEl = null; }
    peer.videoStream = null;
    if (peer.audioEl) { peer.audioEl.srcObject = null; peer.audioEl = null; }
    Voice.speaking.delete(uid);
  },
  _signal(to, data) { Socket.send({ type: 'voice-signal', to, data }); },

  async _onSignal(from, data) {
    if (!Voice.roomCode || !data) return;
    try {
      if (data.description) {
        const desc = data.description;
        if (desc.type === 'offer') {
          Voice._closePeer(from); // an offer always starts a fresh connection
          const pc = await Voice._newPeer(from);
          await pc.setRemoteDescription(desc);
          await Voice._attachLocal(Voice.peers.get(from), pc.getTransceivers().slice(0, 3));
          await Voice._flushPending(from);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          Voice._signal(from, { description: pc.localDescription });
        } else if (desc.type === 'answer') {
          const peer = Voice.peers.get(from);
          if (!peer) return;
          await peer.pc.setRemoteDescription(desc);
          await Voice._flushPending(from);
        }
      } else if (data.candidate) {
        const peer = Voice.peers.get(from);
        if (!peer) return;
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (err) {
      console.warn('[voice] signaling failed for', from, err);
    }
  },
  async _flushPending(uid) {
    const peer = Voice.peers.get(uid);
    if (!peer) return;
    const queued = peer.pending.splice(0);
    for (const c of queued) await peer.pc.addIceCandidate(c).catch(() => {});
  },

  /* ---- server events ---- */
  _onPeers(peers) {
    if (!Voice.roomCode) return;
    Voice.states = {};
    for (const p of peers) Voice.states[p.userId] = { muted: p.muted, deafened: p.deafened, video: p.video || 'none' };
    for (const p of peers) Voice._connectTo(p.userId).catch((err) => console.warn('[voice] offer failed', err));
    Voice._refreshUI();
  },
  _onPeerJoined(msg) {
    Voice.states[msg.userId] = { muted: msg.muted, deafened: msg.deafened, video: msg.video || 'none' };
    Voice._closePeer(msg.userId); // a stale connection from that user's previous session; their offer is coming
    Voice._refreshUI();
  },
  _onPeerLeft(userId) {
    delete Voice.states[userId];
    Voice._closePeer(userId);
    Voice._refreshUI();
  },
  _onState(msg) {
    if (Voice.states[msg.userId]) Voice.states[msg.userId] = { muted: msg.muted, deafened: msg.deafened, video: msg.video || 'none' };
    Voice._refreshUI();
  },
  _onReplaced() {
    // The same account joined voice from another tab; hand voice over instead of fighting for it.
    Voice.replaced = true;
    const code = Voice.roomCode;
    Voice.stop();
    Voice.roomCode = code;
    Voice._refreshUI();
  },
  _onSocketOpen() {
    if (!Voice.roomCode || Voice.replaced) return;
    // The server forgets voice membership when a socket drops, so rebuild everything from scratch.
    for (const uid of [...Voice.peers.keys()]) Voice._closePeer(uid);
    Voice.states = {};
    if (Voice.localStream || Voice.micDenied) Voice._sendJoin(); // otherwise start() is still waiting on the mic prompt
    Voice._refreshUI();
  },

  /* ---- speaking detection ---- */
  _startMeter() {
    clearInterval(Voice._meter);
    const buf = new Uint8Array(512);
    const level = (analyser) => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      return Math.sqrt(sum / buf.length);
    };
    Voice._meter = setInterval(() => {
      const now = Date.now();
      const active = new Set();
      const consider = (uid, analyser, allowed) => {
        if (analyser && allowed && level(analyser) > 0.025) Voice._speakUntil[uid] = now + 300;
        if ((Voice._speakUntil[uid] || 0) > now) active.add(uid);
      };
      for (const [uid, peer] of Voice.peers) consider(uid, peer.analyser, !(Voice.states[uid] && Voice.states[uid].muted));
      if (Auth.isLoggedIn()) consider(Auth.currentUser.id, Voice._localAnalyser, !Voice.micMuted && !Voice.deafened);
      const changed = active.size !== Voice.speaking.size || [...active].some((u) => !Voice.speaking.has(u));
      Voice.speaking = active;
      if (changed) Voice.paintSpeaking();
    }, 100);
  },
  paintSpeaking() {
    document.querySelectorAll('.lounge-ring[data-uid]').forEach((ring) => {
      ring.classList.toggle('lounge-ring--speaking', Voice.speaking.has(ring.dataset.uid));
    });
    document.querySelectorAll('.lounge-tile[data-uid]').forEach((tile) => {
      tile.classList.toggle('lounge-tile--speaking', Voice.speaking.has(tile.dataset.uid));
    });
  },

  /* ---- UI ---- */
  _refreshUI() {
    Voice.renderBar();
    if (typeof UI !== 'undefined' && state.lounge.room) UI.renderLoungeRoom();
  },
  renderBar() {
    const muteBtn = document.getElementById('voice-mute-btn');
    const deafenBtn = document.getElementById('voice-deafen-btn');
    if (!muteBtn || !deafenBtn) return;
    if (!muteBtn.dataset.built) {
      muteBtn.dataset.built = '1';
      muteBtn.addEventListener('click', () => Voice.toggleMute());
      deafenBtn.addEventListener('click', () => Voice.toggleDeafen());
    }
    const camBtn = document.getElementById('voice-camera-btn');
    const screenBtn = document.getElementById('voice-screen-btn');
    if (!camBtn.dataset.built) {
      camBtn.dataset.built = '1';
      camBtn.addEventListener('click', () => Voice.setVideo('camera'));
      screenBtn.addEventListener('click', () => Voice.setVideo('screen'));
    }
    const vkey = `${Voice.video}`;
    if (camBtn.dataset.key !== vkey) {
      camBtn.dataset.key = vkey;
      LineIcons.set(camBtn, Voice.video === 'camera' ? 'camera' : 'camera-off', 'Camera');
      camBtn.setAttribute('aria-pressed', String(Voice.video === 'camera'));
      camBtn.setAttribute('aria-label', Voice.video === 'camera' ? 'Turn camera off' : 'Turn camera on');
      LineIcons.set(screenBtn, 'screen', 'Share Screen');
      screenBtn.setAttribute('aria-pressed', String(Voice.video === 'screen'));
      screenBtn.setAttribute('aria-label', Voice.video === 'screen' ? 'Stop sharing your screen' : 'Share your screen');
    }
    camBtn.disabled = screenBtn.disabled = Voice.replaced;
    const key = `${Voice.micMuted}|${Voice.deafened}|${Voice.micDenied}`;
    if (muteBtn.dataset.key !== key) {
      muteBtn.dataset.key = key;
      LineIcons.set(muteBtn, Voice.micMuted ? 'mic-off' : 'mic', Voice.micMuted ? 'Unmute' : 'Mute');
      muteBtn.setAttribute('aria-pressed', String(Voice.micMuted));
      muteBtn.setAttribute('aria-label', Voice.micMuted ? 'Unmute microphone' : 'Mute microphone');
      LineIcons.set(deafenBtn, Voice.deafened ? 'headphones-off' : 'headphones', Voice.deafened ? 'Undeafen' : 'Deafen');
      deafenBtn.setAttribute('aria-pressed', String(Voice.deafened));
      deafenBtn.setAttribute('aria-label', Voice.deafened ? 'Undeafen (hear everyone again)' : 'Deafen (stop hearing everyone)');
    }
    const hint = document.getElementById('voice-hint');
    const text = Voice.replaced ? 'Voice is active in another tab of yours.'
      : Voice.videoError ? Voice.videoError
      : Voice.micDenied ? 'Microphone unavailable — you can still listen. Click Unmute to try again.' : '';
    hint.textContent = text;
    hint.hidden = !text;
    muteBtn.disabled = deafenBtn.disabled = Voice.replaced;
  },
  /** A 16:9 video tile inside a member card (hidden until that person shows camera/screen). */
  buildTile(card, m) {
    const el = document.createElement('div');
    el.className = 'lounge-tile';
    el.dataset.uid = m.id;
    el.hidden = true;
    const video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true; // sound comes from the Web Audio path, never from here
    const bar = document.createElement('div');
    bar.className = 'lounge-tile__bar';
    const name = document.createElement('span');
    name.className = 'lounge-tile__name';
    const badges = document.createElement('span');
    badges.className = 'lounge-tile__badges';
    const fs = document.createElement('button');
    fs.type = 'button';
    fs.className = 'icon-btn lounge-tile__fs';
    fs.setAttribute('aria-label', 'Fullscreen');
    fs.appendChild(LineIcons.el('expand'));
    fs.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    });
    bar.append(name, badges, fs);
    el.append(video, bar);
    el.addEventListener('click', () => { Voice.spotlight = Voice.spotlight === m.id ? null : m.id; Voice._refreshUI(); });
    card.prepend(el);
    return { el, video, name, badges };
  },
  /** Spotlight layout: the chosen tile big, everyone else small beside it (see .has-spotlight). */
  layoutGrid(grid) {
    const cards = [...grid.children];
    if (Voice.spotlight && !cards.some((c) => c.dataset.uid === Voice.spotlight && c.classList.contains('lounge-grid-card--video'))) Voice.spotlight = null;
    grid.classList.toggle('has-spotlight', !!Voice.spotlight);
    grid.style.setProperty('--others', String(Math.max(1, cards.length - 1)));
    cards.forEach((c) => c.classList.toggle('lounge-grid-card--spot', c.dataset.uid === Voice.spotlight));
  },
  /** Called by UI.renderLoungeRoom once per member card (built once, then updated in place). */
  buildCardControls(card, m) {
    const ctl = document.createElement('div');
    ctl.className = 'lounge-voice-ctl';
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'icon-btn';
    muteBtn.addEventListener('click', () => Voice.setPersonMuted(m.id, !Voice.pref(m.id).muted));
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '200'; slider.step = '5';
    slider.setAttribute('aria-label', `Volume for ${m.displayName}`);
    slider.addEventListener('input', () => Voice.setPersonVolume(m.id, slider.value));
    slider.addEventListener('dblclick', () => Voice.setPersonVolume(m.id, 100));
    const pct = document.createElement('span');
    pct.className = 'lounge-voice-ctl__pct';
    ctl.append(muteBtn, slider, pct);
    card.appendChild(ctl);
    return { ctl, muteBtn, slider, pct };
  },
  updateCard(refs, m) {
    const isSelf = Lounge.isSelf(m);
    const st = isSelf ? { muted: Voice.micMuted, deafened: Voice.deafened } : Voice.states[m.id];
    const inVoice = !!Voice.roomCode && (isSelf ? !Voice.replaced : !!st);
    const badges = refs.badges;
    const wantKey = inVoice && st ? `${st.muted}|${st.deafened}` : '';
    if (badges.dataset.key !== wantKey) {
      badges.dataset.key = wantKey;
      badges.replaceChildren();
      const add = (name, label) => { const b = document.createElement('span'); b.className = 'lounge-ring__badge'; b.title = label; b.appendChild(LineIcons.el(name)); badges.appendChild(b); };
      if (wantKey && st.muted) add('mic-off', 'Mic muted');
      if (wantKey && st.deafened) add('headphones-off', 'Deafened');
    }
    const kind = isSelf ? Voice.video : (st && st.video) || 'none';
    const showTile = inVoice && kind !== 'none';
    const tile = refs.tile;
    refs.card.classList.toggle('lounge-grid-card--video', showTile);
    tile.el.hidden = !showTile;
    if (showTile) {
      const stream = isSelf ? Voice.videoStream : ((Voice.peers.get(m.id) || {}).videoStream || null);
      if (tile.video.srcObject !== stream) { tile.video.srcObject = stream; if (stream) tile.video.play().catch(() => {}); }
      // my own camera preview is mirrored like a mirror; screens are never mirrored
      tile.el.classList.toggle('lounge-tile--mirror', isSelf && kind === 'camera');
      tile.el.classList.toggle('lounge-tile--screen', kind === 'screen');
      tile.name.textContent = m.displayName;
      if (tile.badges.dataset.key !== wantKey) {
        tile.badges.dataset.key = wantKey;
        tile.badges.replaceChildren();
        const add = (name, label) => { const b = document.createElement('span'); b.className = 'lounge-ring__badge'; b.title = label; b.appendChild(LineIcons.el(name)); tile.badges.appendChild(b); };
        if (wantKey && st.muted) add('mic-off', 'Mic muted');
        if (wantKey && st.deafened) add('headphones-off', 'Deafened');
      }
    } else if (tile.video.srcObject) {
      tile.video.srcObject = null;
    }
    // per-person controls change only what *I* hear: shown for other people who are in voice
    const ctl = refs.voice;
    ctl.ctl.hidden = isSelf || !inVoice;
    if (!ctl.ctl.hidden) {
      const p = Voice.pref(m.id);
      ctl.muteBtn.setAttribute('aria-pressed', String(p.muted));
      ctl.muteBtn.setAttribute('aria-label', `${p.muted ? 'Unmute' : 'Mute'} ${m.displayName} (only for me)`);
      ctl.muteBtn.title = p.muted ? 'Unmute for me' : 'Mute for me';
      if (ctl.muteBtn.dataset.k !== String(p.muted)) { ctl.muteBtn.dataset.k = String(p.muted); ctl.muteBtn.replaceChildren(LineIcons.el(p.muted ? 'speaker-off' : 'speaker')); }
      if (document.activeElement !== ctl.slider && ctl.slider.value !== String(p.volume)) ctl.slider.value = String(p.volume);
      ctl.pct.textContent = `${p.volume}%`;
    }
  },
};
// Browsers keep an AudioContext suspended until the user interacts with the page; resume on first touch.
['pointerdown', 'keydown'].forEach((evt) => document.addEventListener(evt, () => { if (Voice.ctx && Voice.ctx.state === 'suspended') Voice.ctx.resume().catch(() => {}); }, { passive: true }));

Socket.on('socket-open', () => { Voice._onSocketOpen(); Chat._onSocketOpen(); });
Socket.on('voice-peers', (msg) => Voice._onPeers(msg.peers || []));
Socket.on('voice-peer-joined', (msg) => Voice._onPeerJoined(msg));
Socket.on('voice-peer-left', (msg) => Voice._onPeerLeft(msg.userId));
Socket.on('voice-state', (msg) => Voice._onState(msg));
Socket.on('voice-signal', (msg) => Voice._onSignal(msg.from, msg.data));
Socket.on('voice-replaced', () => Voice._onReplaced());

/* ============================== Chat (shared room chat) ==============================
   History comes from GET .../messages when you enter a room; new messages are pushed over the
   WebSocket ('room-message'). Images are stored server-side and fetched with the auth header
   into object URLs (an <img src> can't send a bearer token). */
const Chat = {
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  TYPES: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  roomCode: null,
  messages: [],
  unread: 0,
  pending: null, // { file, url }
  pinned: true,
  inView: false,
  sending: false,
  _imageUrls: new Map(),
  _observer: null,
  _errorTimer: null,

  open(code) {
    Chat.reset();
    Chat.roomCode = code;
    Chat.render();
    Chat.load();
  },
  reset() {
    Chat.roomCode = null;
    Chat.messages = [];
    Chat.unread = 0;
    Chat.pinned = true;
    Chat.clearPending();
    for (const p of Chat._imageUrls.values()) p.then((u) => u && URL.revokeObjectURL(u));
    Chat._imageUrls.clear();
    Chat.render();
  },
  async load() {
    const code = Chat.roomCode;
    if (!code) return;
    try {
      const { messages } = await Api.get(`/api/lounge/rooms/${encodeURIComponent(code)}/messages`);
      if (Chat.roomCode !== code) return;
      Chat.messages = messages;
      Chat.render();
    } catch { /* the next socket-open or reload retries */ }
  },
  _onSocketOpen() { if (Chat.roomCode) Chat.load(); }, // catch up on anything missed while disconnected
  onMessage(msg) {
    if (msg.roomCode !== Chat.roomCode || Chat.messages.some((m) => m.id === msg.message.id)) return;
    Chat._add(msg.message);
  },
  _add(message) {
    const own = Auth.isLoggedIn() && message.sender.id === Auth.currentUser.id;
    const list = document.getElementById('lounge-chat-messages');
    const wasPinned = Chat.pinned;
    Chat.messages.push(message);
    if (list) {
      const empty = list.querySelector('.lounge-chat__empty');
      if (empty) empty.remove();
      list.appendChild(Chat._renderMessage(message));
      // Follow new messages only if I'm already at the bottom (or wrote it); never yank me out of history.
      if (wasPinned || own) list.scrollTop = list.scrollHeight;
    }
    if (!own && !Chat.isRead()) { Chat.unread += 1; Chat.renderBadge(); }
  },
  isRead() { return document.visibilityState === 'visible' && Chat.inView && Chat.pinned; },
  checkRead() { if (Chat.unread && Chat.isRead()) { Chat.unread = 0; Chat.renderBadge(); } },
  renderBadge() {
    const badge = document.getElementById('lounge-chat-badge');
    if (!badge) return;
    badge.hidden = Chat.unread === 0;
    badge.textContent = Chat.unread > 99 ? '99+' : String(Chat.unread);
  },

  /* ---- rendering ---- */
  render() {
    const list = document.getElementById('lounge-chat-messages');
    if (!list) return;
    list.replaceChildren();
    if (!Chat.messages.length && Chat.roomCode) {
      const empty = document.createElement('li');
      empty.className = 'lounge-chat__empty';
      empty.textContent = 'No messages yet — say hi 👋';
      list.appendChild(empty);
    }
    for (const m of Chat.messages) list.appendChild(Chat._renderMessage(m));
    list.scrollTop = list.scrollHeight;
    Chat.pinned = true;
    Chat.renderBadge();
  },
  _renderMessage(m) {
    const li = document.createElement('li');
    li.className = 'lounge-chat__msg';
    const avatar = document.createElement('span');
    avatar.className = 'lounge-friend-item__avatar';
    Avatars.render(avatar, m.sender);
    const body = document.createElement('div');
    body.className = 'lounge-chat__body';
    const meta = document.createElement('div');
    meta.className = 'lounge-chat__meta';
    const name = document.createElement('strong');
    name.textContent = m.sender.displayName;
    const time = document.createElement('time');
    time.dateTime = new Date(m.createdAt).toISOString();
    time.textContent = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.append(name, time);
    body.appendChild(meta);
    if (m.text) {
      const text = document.createElement('div');
      text.className = 'lounge-chat__text';
      text.textContent = m.text;
      body.appendChild(text);
    }
    if (m.hasImage) {
      const img = document.createElement('img');
      img.className = 'lounge-chat__img';
      img.alt = `Image from ${m.sender.displayName}`;
      img.tabIndex = 0;
      img.addEventListener('load', () => { if (Chat.pinned) { const list = document.getElementById('lounge-chat-messages'); list.scrollTop = list.scrollHeight; } });
      img.addEventListener('click', () => Chat.openLightbox(m));
      img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Chat.openLightbox(m); } });
      Chat.imageUrl(m).then((url) => { if (url) img.src = url; else img.alt = 'Image unavailable'; });
      body.appendChild(img);
    }
    li.append(avatar, body);
    return li;
  },
  imageUrl(m) {
    if (!Chat._imageUrls.has(m.id)) {
      const code = Chat.roomCode;
      Chat._imageUrls.set(m.id, fetch(`/api/lounge/rooms/${encodeURIComponent(code)}/messages/${encodeURIComponent(m.id)}/image`, { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => (blob ? URL.createObjectURL(blob) : null))
        .catch(() => null));
    }
    return Chat._imageUrls.get(m.id);
  },
  async openLightbox(m) {
    const url = await Chat.imageUrl(m);
    if (!url) return;
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[m.imageMime] || 'png';
    document.getElementById('image-lightbox-img').src = url;
    const link = document.getElementById('image-lightbox-download');
    link.href = url;
    link.download = `study-lounge-${m.id.slice(0, 8)}.${ext}`;
    document.getElementById('image-lightbox').showModal();
  },

  /* ---- composing ---- */
  showError(text) {
    const el = document.getElementById('lounge-chat-error');
    clearTimeout(Chat._errorTimer);
    if (!text) { el.hidden = true; return; }
    setFieldStatus(el, text, 'error');
    el.hidden = false;
    Chat._errorTimer = setTimeout(() => { el.hidden = true; }, 6000);
  },
  setPending(file) {
    if (!file) return;
    if (!Chat.TYPES.includes(file.type)) { Chat.showError('Only png, jpg, webp or gif images can be sent.'); return; }
    if (file.size > Chat.MAX_IMAGE_BYTES) { Chat.showError(`That image is ${(file.size / 1048576).toFixed(1)} MB — the limit is 5 MB.`); return; }
    Chat.showError('');
    Chat.clearPending();
    Chat.pending = { file, url: URL.createObjectURL(file) };
    document.getElementById('lounge-chat-preview-img').src = Chat.pending.url;
    document.getElementById('lounge-chat-preview-name').textContent = file.name || 'Pasted image';
    document.getElementById('lounge-chat-preview').hidden = false;
  },
  clearPending() {
    if (Chat.pending) URL.revokeObjectURL(Chat.pending.url);
    Chat.pending = null;
    const preview = document.getElementById('lounge-chat-preview');
    if (preview) preview.hidden = true;
    const file = document.getElementById('lounge-chat-file');
    if (file) file.value = '';
  },
  async send() {
    const input = document.getElementById('lounge-chat-input');
    const text = input.value.trim();
    if (Chat.sending || !Chat.roomCode || (!text && !Chat.pending)) return;
    Chat.sending = true;
    document.getElementById('lounge-chat-send').disabled = true;
    try {
      const body = { text };
      if (Chat.pending) {
        const file = Chat.pending.file;
        body.image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read that image.'));
          reader.readAsDataURL(file);
        });
      }
      const { message } = await Api.post(`/api/lounge/rooms/${encodeURIComponent(Chat.roomCode)}/messages`, body);
      input.value = '';
      input.style.height = '';
      Chat.clearPending();
      Chat.showError('');
      if (!Chat.messages.some((m) => m.id === message.id)) Chat._add(message);
    } catch (err) {
      Chat.showError(err.message);
    } finally {
      Chat.sending = false;
      document.getElementById('lounge-chat-send').disabled = false;
    }
  },
  init() {
    const input = document.getElementById('lounge-chat-input');
    const card = document.getElementById('lounge-chat');
    const list = document.getElementById('lounge-chat-messages');
    if (!input || !card) return;
    const attach = document.getElementById('lounge-chat-attach');
    LineIcons.set(attach, 'image');
    LineIcons.set(document.getElementById('lounge-chat-preview-remove'), 'close');
    LineIcons.set(document.getElementById('image-lightbox-close'), 'close');
    attach.addEventListener('click', () => document.getElementById('lounge-chat-file').click());
    document.getElementById('lounge-chat-file').addEventListener('change', (e) => Chat.setPending(e.target.files[0]));
    document.getElementById('lounge-chat-preview-remove').addEventListener('click', () => Chat.clearPending());
    document.getElementById('lounge-chat-send').addEventListener('click', () => Chat.send());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); Chat.send(); }
    });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 110)}px`; });
    input.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (item) { e.preventDefault(); Chat.setPending(item.getAsFile()); }
    });
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    card.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth += 1; card.classList.add('is-dragover'); } });
    card.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    card.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) card.classList.remove('is-dragover'); });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      card.classList.remove('is-dragover');
      Chat.setPending(e.dataTransfer.files[0]);
    });
    list.addEventListener('scroll', () => { if (!list.clientHeight) return; Chat.pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 60; Chat.checkRead(); }, { passive: true });
    document.getElementById('lounge-chat-badge').addEventListener('click', () => { list.scrollTop = list.scrollHeight; Chat.pinned = true; Chat.checkRead(); });
    Chat._observer = new IntersectionObserver((entries) => {
      const was = Chat.inView;
      Chat.inView = entries[entries.length - 1].intersectionRatio >= 0.3;
      // A hidden view forgets its scroll offset; if I was following the conversation, show the newest again.
      if (!was && Chat.inView && Chat.pinned) list.scrollTop = list.scrollHeight;
      Chat.checkRead();
    }, { threshold: [0, 0.3, 1] });
    Chat._observer.observe(card);
    document.addEventListener('visibilitychange', () => Chat.checkRead());
    const box = document.getElementById('image-lightbox');
    document.getElementById('image-lightbox-close').addEventListener('click', () => box.close());
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
  },
};
Socket.on('room-message', (msg) => Chat.onMessage(msg));

/* ============================== Guides (video tutorials) ==============================
   The list lives in /guides/guides.json ({ order, file, title, description } per video) so it can be
   edited without touching this code. Cards only ask for each video's metadata (first frame + duration);
   the full file is fetched when it is played in the dialog. */
const Guides = {
  _loaded: false,
  _formatDuration(sec) {
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  async load() {
    if (Guides._loaded) return;
    Guides._loaded = true;
    let list = [];
    try {
      const res = await fetch('/guides/guides.json');
      if (res.ok) list = await res.json();
    } catch { /* falls through to the empty state */ }
    list = (Array.isArray(list) ? list : []).filter((g) => g && typeof g.file === 'string' && typeof g.title === 'string')
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const grid = document.getElementById('guides-grid');
    grid.replaceChildren(...list.map(Guides._card));
    document.getElementById('guides-empty').hidden = list.length > 0;
  },
  _card(g) {
    const url = `/guides/${encodeURIComponent(g.file)}`;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'glass guide-card';
    const thumb = document.createElement('div');
    thumb.className = 'guide-card__thumb';
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'metadata'; // metadata only: no full download
    video.src = `${url}#t=0.1`; // shows the first frame as the thumbnail
    const play = document.createElement('span');
    play.className = 'guide-card__play';
    play.innerHTML = '<svg class="icon icon--fill" viewBox="0 0 20 20" aria-hidden="true"><path d="M6.2 4.3v11.4c0 .6.7 1 1.2.7l9-5.7c.5-.3.5-1 0-1.3l-9-5.7c-.5-.3-1.2 0-1.2.6Z"/></svg>';
    const time = document.createElement('span');
    time.className = 'guide-card__time';
    video.addEventListener('loadedmetadata', () => {
      time.textContent = Guides._formatDuration(video.duration);
      thumb.classList.toggle('guide-card__thumb--portrait', video.videoHeight > video.videoWidth);
    });
    thumb.append(video, play, time);
    const title = document.createElement('h3');
    title.textContent = g.title;
    card.append(thumb, title);
    if (g.description) { const p = document.createElement('p'); p.textContent = g.description; card.appendChild(p); }
    card.addEventListener('click', () => Guides.open(g, url));
    return card;
  },
  open(g, url) {
    const player = document.getElementById('guide-player');
    document.getElementById('guide-dialog-title').textContent = g.title;
    player.src = url;
    document.getElementById('guide-dialog').showModal();
    player.play().catch(() => {}); // the controls are there if autoplay is blocked
  },
  close() {
    const dialog = document.getElementById('guide-dialog');
    if (dialog.open) dialog.close();
  },
  init() {
    const dialog = document.getElementById('guide-dialog');
    const player = document.getElementById('guide-player');
    LineIcons.set(document.getElementById('guide-dialog-close'), 'close');
    document.getElementById('guide-dialog-close').addEventListener('click', () => Guides.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) Guides.close(); }); // click outside
    // Closing (button, Esc or outside) stops playback and drops the file so nothing keeps downloading.
    dialog.addEventListener('close', () => { player.pause(); player.removeAttribute('src'); player.load(); });
    // The app's own music would talk over the guide.
    player.addEventListener('play', () => {
      if (MusicPlayer._playing) { MusicPlayer.pause(); if (typeof UI.renderMusicUI === 'function') UI.renderMusicUI(); }
    });
  },
};

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

/* ============================== AIChat (Google Gemini) ============================== */
// The API key lives only in this browser's localStorage and is sent only as a query
// param directly to Google's endpoint below — never logged, never sent anywhere else.
const AIChat = {
  MAX_HISTORY: 30,
  MODEL: 'gemini-3.6-flash',
  _pending: false,

  endpoint(apiKey) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${AIChat.MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  },

  hasKey() {
    return typeof state.chatSettings.apiKey === 'string' && state.chatSettings.apiKey.trim().length > 0;
  },

  async sendMessage(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || AIChat._pending || !AIChat.hasKey()) return;

    state.chatHistory.push({ role: 'user', text: trimmed });
    Storage.saveChatHistory(state.chatHistory);
    AIChat._pending = true;
    UI.renderChat();

    const contents = state.chatHistory.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    try {
      const res = await fetch(AIChat.endpoint(state.chatSettings.apiKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const reason = (data && data.error && data.error.message) ? data.error.message : `Request failed (HTTP ${res.status}).`;
        AIChat._pending = false;
        UI.renderChat(reason);
        return;
      }
      const replyText = data && data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
        ? data.candidates[0].content.parts[0].text
        : '';
      AIChat._pending = false;
      if (!replyText) {
        UI.renderChat('The AI returned an empty response. Try rephrasing your message.');
        return;
      }
      state.chatHistory.push({ role: 'assistant', text: replyText });
      Storage.saveChatHistory(state.chatHistory);
      UI.renderChat();
    } catch {
      AIChat._pending = false;
      UI.renderChat('Network error reaching the AI service. Check your connection and try again.');
    }
  },
};

/* ============================== Avatars ==============================
   Shared cross-user avatar rendering for anyone but yourself (Friends list,
   Members grid, search results, notifications): a real photo (avatarUrl,
   synced server-side) when the user has set one, otherwise a colored
   initial -- never the old per-account emoji, which only ever reflected
   what *that* person picked for themselves and carried no real identity. */
const Avatars = {
  _hue(seed) {
    let h = 0;
    for (let i = 0; i < String(seed).length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h % 360;
  },
  initial(user) {
    const source = ((user && (user.displayName || user.username)) || '?').trim();
    return source.charAt(0).toUpperCase() || '?';
  },
  /** Renders into `el`, an element already sized/shaped by its own CSS class. */
  render(el, user) {
    if (!el || !user) return;
    if (user.avatarUrl) {
      el.classList.add('avatar-badge--photo');
      el.style.background = `url(${user.avatarUrl}) center/cover`;
      el.textContent = '';
    } else {
      el.classList.remove('avatar-badge--photo');
      el.style.background = `hsl(${Avatars._hue(user.id || user.username || user.displayName || '?')}, 55%, 45%)`;
      el.textContent = Avatars.initial(user);
    }
  },
};

const UI = {
  showMediaPanel() { const el = document.getElementById('media-panel'); if (el) el.hidden = false; },
  hideMediaPanel() { const el = document.getElementById('media-panel'); if (el) el.hidden = true; },

  // Native <dialog>.showModal() doesn't stop the page behind it from scrolling in every
  // browser, so lock body scroll for as long as any dialog is open, and close the two
  // lightweight header popovers (Notifications, Friends) so a dialog never opens on top
  // of a stale one underneath. Watching the `open` attribute (which showModal()/close()/
  // Escape all keep in sync) means this needs no changes at any of the many existing
  // showModal()/close() call sites. Also wires click-on-backdrop to close, for every
  // dialog uniformly.
  initDialogCoordination() {
    const dialogs = document.querySelectorAll('dialog');
    const sync = () => {
      const anyOpen = Array.from(dialogs).some((d) => d.open);
      // In standards mode the page actually scrolls via <html> (document.documentElement),
      // not <body> -- body-only overflow:hidden looks right but doesn't stop the page
      // scrolling behind the modal. Lock both to be safe across browsers.
      document.documentElement.style.overflow = anyOpen ? 'hidden' : '';
      document.body.style.overflow = anyOpen ? 'hidden' : '';
      if (anyOpen) {
        const notifMenu = document.getElementById('notif-menu');
        const notifTrigger = document.getElementById('notif-trigger');
        if (notifMenu && !notifMenu.hidden) { notifMenu.hidden = true; notifTrigger.setAttribute('aria-expanded', 'false'); }
        const drawer = document.getElementById('friends-drawer');
        const drawerBackdrop = document.getElementById('friends-drawer-backdrop');
        if (drawer && !drawer.hidden) { drawer.hidden = true; drawerBackdrop.hidden = true; }
      }
    };
    dialogs.forEach((d) => {
      new MutationObserver(sync).observe(d, { attributes: true, attributeFilter: ['open'] });
      d.addEventListener('click', (e) => { if (e.target === d && !d.dataset.locked) d.close(); });
      if (d.dataset.locked) d.addEventListener('cancel', (e) => e.preventDefault()); // Escape can't dismiss it either
    });
    sync();
  },

  renderTimerControls() {
    const btn = document.getElementById('timer-toggle');
    if (btn) {
      const running = state.timer.running;
      btn.innerHTML = (running ? Icons.pause : Icons.play) + `<span>${running ? 'Pause' : 'Start'}</span>`;
    }
  },

  renderPomodoroCount() {
    const el = document.getElementById('pomodoro-count');
    if (el) el.textContent = `Today's Pomodoros: ${state.stats.pomodorosCompletedToday}`;
  },

  _applyAvatarVisual(el, photoClass) {
    if (!el) return;
    const name = state.profile.username;
    const emoji = state.profile.avatar;
    // Local device photo (IndexedDB) wins if set; otherwise fall back to the
    // synced avatarUrl so this device shows the same picture friends see.
    const remoteUrl = Auth.isLoggedIn() ? Auth.currentUser.avatarUrl : null;
    const imgUrl = state.profile._avatarUrl || remoteUrl;
    if (imgUrl) {
      el.textContent = '';
      el.style.backgroundImage = `url(${imgUrl})`;
      if (photoClass) el.classList.add(photoClass);
      el.classList.remove('user-profile__avatar--emoji');
    } else {
      el.style.backgroundImage = '';
      if (photoClass) el.classList.remove(photoClass);
      el.textContent = emoji || (name.trim().charAt(0).toUpperCase() || 'Y');
      el.classList.toggle('user-profile__avatar--emoji', !!emoji);
    }
  },

  renderProfile() {
    const avatar = document.getElementById('user-avatar');
    const nameDisplay = document.getElementById('user-name-display');
    UI._applyAvatarVisual(avatar, 'user-profile__avatar--photo');
    if (nameDisplay) nameDisplay.textContent = state.profile.username;
    avatar.title = state.profile.username;
    UI.renderProfileModalView();
  },

  syncAuthUI() {
    const loggedIn = Auth.isLoggedIn();
    document.getElementById('notif-picker').hidden = !loggedIn;
    document.getElementById('user-name-display').textContent =
      loggedIn ? Auth.currentUser.displayName : state.profile.username;
    document.getElementById('user-avatar').title = document.getElementById('user-name-display').textContent;
    document.getElementById('profile-modal-logout-btn').hidden = !loggedIn;
    document.getElementById('profile-modal-login-btn').hidden = loggedIn;
    document.getElementById('profile-privacy').hidden = !loggedIn;
    document.getElementById('friends-drawer-guest').hidden = loggedIn;
    document.getElementById('friends-drawer-content').hidden = !loggedIn;
    Friends.refreshAll();
    Notifications.refreshAll();
    Lounge.refreshAll();
  },

  renderProfileModalView() {
    const pfp = document.getElementById('profile-modal-pfp');
    if (!pfp) return;
    UI._applyAvatarVisual(pfp, null);
    const level = Skills.progress(state.stats.focusXP).level;
    document.getElementById('profile-modal-username').textContent = state.profile.username;
    document.getElementById('profile-modal-bio').textContent = state.profile.bio || 'No bio yet.';
    document.getElementById('profile-modal-title-badge').textContent = `Lv. ${level} · ${Lounge.titleForLevel(level)}`;
    document.getElementById('profile-stat-xp').textContent = String(state.stats.focusXP);
    document.getElementById('profile-stat-friends').textContent = String(Friends.list.length);
    const followers = Math.max(0, level * 4 + state.stats.currentStreak * 2 + Friends.list.length);
    document.getElementById('profile-stat-followers').textContent = String(followers);
    const hours = state.stats.totalFocusMinutes / 60;
    document.getElementById('profile-stat-hours').textContent = hours >= 10 ? String(Math.round(hours)) : hours.toFixed(1);
    document.getElementById('profile-modal-account-hint').textContent = Auth.isLoggedIn()
      ? `Signed in as ${Auth.currentUser.username}. Friends, presence, and chat are saved online.`
      : 'Using this device as a guest — your timer, tasks, and stats stay local. Log in to add friends and sync across devices.';
  },

  openConsentModal() {
    const modal = document.getElementById('consent-modal');
    if (modal.open) return;
    document.getElementById('consent-modal-check').checked = false;
    setFieldStatus(document.getElementById('status-consent-modal'), '', '');
    modal.showModal();
  },

  openProfileModal() {
    UI.renderProfileModalView();
    document.getElementById('profile-modal-view').hidden = false;
    document.getElementById('profile-modal-edit').hidden = true;
    document.getElementById('profile-modal').showModal();
  },

  openProfileEdit() {
    document.getElementById('profile-edit-username').value = state.profile.username;
    document.getElementById('profile-edit-bio').value = state.profile.bio || '';
    const urlLabel = document.getElementById('profile-edit-avatar-url-label');
    urlLabel.hidden = !Auth.isLoggedIn();
    document.getElementById('profile-edit-avatar-url').value = Auth.isLoggedIn() ? (Auth.currentUser.avatarUrl || '') : '';
    UI._applyAvatarVisual(document.getElementById('profile-modal-pfp-edit-preview'), null);
    document.getElementById('profile-modal-view').hidden = true;
    document.getElementById('profile-modal-edit').hidden = false;
    UI._pendingAvatarEmoji = null;
    UI._pendingAvatarPhoto = null;
    setFieldStatus(document.getElementById('status-profile-upload'), '', '');
  },

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
          const inviteBtn = document.createElement('button');
          inviteBtn.type = 'button';
          inviteBtn.className = 'btn btn-secondary lounge-friend-item__invite';
          inviteBtn.textContent = 'Invite to Room';
          inviteBtn.addEventListener('click', async () => {
            inviteBtn.disabled = true;
            try {
              await Lounge.inviteFriend(f.id);
              inviteBtn.textContent = 'Invited';
            } catch (err) {
              inviteBtn.textContent = 'Invite to Room';
              inviteBtn.disabled = false;
              setFieldStatus(document.getElementById('friend-search-status'), err.message, 'error');
            }
          });
          li.append(avatar, name, status, chatBtn, inviteBtn);
          list.appendChild(li);
        }
        Avatars.render(li.querySelector('.lounge-friend-item__avatar'), f);
        li.querySelector('.lounge-friend-item__name').textContent = f.displayName;
        const statusEl = li.querySelector('.lounge-friend-item__status');
        statusEl.textContent = f.online ? 'Online' : 'Offline';
        statusEl.dataset.status = f.online ? 'online' : 'offline';
        const inviteBtn = li.querySelector('.lounge-friend-item__invite');
        const inRoom = !!state.lounge.room;
        inviteBtn.hidden = !inRoom;
        inviteBtn.disabled = !inRoom || !f.online || (state.lounge.room && state.lounge.room.members.some((m) => m.id === f.id));
      }
      const emptyMsgId = { 'lounge-friends-list': 'lounge-friends-empty', 'friends-drawer-list': 'friends-drawer-empty' }[listId];
      const emptyMsg = emptyMsgId && document.getElementById(emptyMsgId);
      if (emptyMsg) emptyMsg.hidden = Friends.list.length > 0;
      for (const li of [...list.children]) {
        if (!seen.has(li.dataset.friendId)) li.remove();
      }
    }
  },

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
      Avatars.render(avatar, u);
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
          if (u.relationship === 'none') {
            await Friends.sendRequest(u.id);
          } else if (u.relationship === 'pending_out') {
            const outgoing = Friends.outgoing.find((r) => r.user.id === u.id);
            if (outgoing) await Friends.cancel(outgoing.id);
          }
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
      acceptBtn.addEventListener('click', () => {
        acceptBtn.disabled = true;
        Friends.accept(r.id).catch((err) => {
          setFieldStatus(document.getElementById('friend-search-status'), err.message, 'error');
          Friends.refreshAll();
        });
      });
      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button'; rejectBtn.className = 'btn btn-secondary'; rejectBtn.textContent = 'Decline';
      rejectBtn.addEventListener('click', () => {
        rejectBtn.disabled = true;
        Friends.reject(r.id).catch((err) => {
          setFieldStatus(document.getElementById('friend-search-status'), err.message, 'error');
          Friends.refreshAll();
        });
      });
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
      cancelBtn.addEventListener('click', () => {
        cancelBtn.disabled = true;
        Friends.cancel(r.id).catch((err) => {
          setFieldStatus(document.getElementById('friend-search-status'), err.message, 'error');
          Friends.refreshAll();
        });
      });
      li.append(name, cancelBtn);
      outgoingList.appendChild(li);
    }
  },

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
        lounge_invite: `${who} invited you to a study room`,
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

  renderLoungeRoom() {
    const room = state.lounge.room;
    if (!room) return;
    document.getElementById('lounge-room-code').textContent = room.code;
    document.getElementById('lounge-room-goal').textContent = room.goal || 'No goal set.';

    const grid = document.getElementById('lounge-member-grid');
    // Cards are built once per member and updated in place: this runs every second (and on every voice
    // event), and a rebuild would tear down a volume slider mid-drag and drop the speaking glow.
    const existing = new Map([...grid.children].map((c) => [c.dataset.uid, c]));
    room.members.forEach((m, i) => {
      const card = existing.get(m.id) || UI._buildMemberCard(m);
      UI._updateMemberCard(card, m, room);
      if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
      existing.delete(m.id);
    });
    for (const stale of existing.values()) stale.remove();
    Voice.layoutGrid(grid);
    Voice.paintSpeaking();
    UI.renderLoungeMission();
    UI.renderLoungeActivityLog();
  },

  _buildMemberCard(m) {
    const card = document.createElement('div');
    card.className = 'lounge-grid-card';
    card.dataset.uid = m.id;
    const ring = document.createElement('div');
    ring.className = 'lounge-ring';
    ring.dataset.uid = m.id;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '40'); track.setAttribute('cy', '40'); track.setAttribute('r', '36');
    track.setAttribute('class', 'lounge-ring__track');
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fill.setAttribute('cx', '40'); fill.setAttribute('cy', '40'); fill.setAttribute('r', '36');
    fill.setAttribute('class', 'lounge-ring__fill');
    fill.setAttribute('stroke-dasharray', String(2 * Math.PI * 36));
    svg.append(track, fill);
    const avatarEl = document.createElement('span');
    avatarEl.className = 'lounge-ring__avatar';
    const badges = document.createElement('span');
    badges.className = 'lounge-ring__badges';
    ring.append(svg, avatarEl, badges);
    const name = document.createElement('span');
    name.className = 'lounge-grid-card__name';
    const status = document.createElement('span');
    status.className = 'lounge-grid-card__status';
    const metrics = document.createElement('span');
    metrics.className = 'lounge-grid-card__metrics';
    card.append(ring, name, status, metrics);
    card._refs = { card, ring, fill, avatarEl, badges, name, status, metrics, avatarKey: null };
    card._refs.tile = Voice.buildTile(card, m);
    card._refs.voice = Voice.buildCardControls(card, m);
    return card;
  },

  _updateMemberCard(card, m, room) {
    const r = card._refs;
    r.ring.dataset.status = m.status;
    r.ring.classList.toggle('lounge-ring--offline', !m.online);
    const circumference = 2 * Math.PI * 36;
    r.fill.setAttribute('stroke-dashoffset', String(circumference * (1 - Lounge.phaseFraction(m))));
    const avatarKey = `${m.avatarUrl || ''}|${m.avatar || ''}|${m.displayName}`;
    if (r.avatarKey !== avatarKey) { r.avatarKey = avatarKey; Avatars.render(r.avatarEl, m); }
    r.name.textContent = m.displayName + (m.isHost ? ' (Host)' : '');
    if (!m.online) {
      r.status.textContent = 'Offline';
      r.status.dataset.status = 'idle';
    } else {
      const memberStatus = Lounge.statusLabel(m);
      r.status.textContent = memberStatus.text;
      r.status.dataset.status = memberStatus.status;
    }
    r.metrics.textContent = room.mission
      ? (m.missionState === 'checked-in' ? 'Checked in' : m.missionState === 'abandoned' ? 'Abandoned sprint' : `Sprint: ${m.missionProgress}/${room.mission.targetPomodoros}`)
      : '';
    Voice.updateCard(r, m);
  },

  /** Sprint settings: a glass dropdown (4 presets + "Custom…"), a "25 min focus · 5 min break" summary
      with an edit icon, and a panel of - / + steppers (focus 5-120, break 1-60; plus the pomodoro count,
      1-12, when "Custom…" is chosen). The dropdown and panel expand IN the layout instead of floating over
      it, so they never cover Start Sprint or the card below. read() returns the values or null after
      showing a friendly message; the server enforces the same ranges. */
  _buildSprintPicker() {
    const RANGES = { count: [1, 12], focus: [5, 120], brk: [1, 60] };
    const clampTo = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
    const saved = safeParseGlobal('pomodoroSprintPrefs') || {};
    const v = {
      count: 1,
      focus: clampTo(Number.isInteger(saved.focus) ? saved.focus : state.settings.pomodoro, RANGES.focus),
      brk: clampTo(Number.isInteger(saved.brk) ? saved.brk : state.settings.shortBreak, RANGES.brk),
    };
    let custom = false;
    const label = (n) => `${n} Pomodoro${n > 1 ? 's' : ''}`;

    const root = document.createElement('div');
    root.className = 'lounge-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'lounge-mission-target';
    trigger.className = 'lounge-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Sprint length');
    const triggerText = document.createElement('span');
    trigger.append(triggerText, LineIcons.el('chevron'));
    root.appendChild(trigger);

    const menu = document.createElement('ul');
    menu.className = 'lounge-select__menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    const options = [1, 2, 3, 4, 'custom'].map((k) => {
      const li = document.createElement('li');
      li.className = 'lounge-select__option';
      li.setAttribute('role', 'option');
      li.dataset.key = String(k);
      li.tabIndex = -1;
      li.textContent = k === 'custom' ? 'Custom…' : label(k);
      menu.appendChild(li);
      return li;
    });

    const summaryRow = document.createElement('div');
    summaryRow.className = 'lounge-sprint-summary';
    const summary = document.createElement('span');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.setAttribute('aria-label', 'Edit sprint settings');
    editBtn.setAttribute('aria-expanded', 'false');
    editBtn.appendChild(LineIcons.el('edit'));
    summaryRow.append(summary, editBtn);

    const panel = document.createElement('div');
    panel.className = 'lounge-sprint-panel';
    panel.hidden = true;
    const error = document.createElement('p');
    error.className = 'field-hint is-error';
    error.hidden = true;
    const setError = (t) => { error.textContent = t; error.hidden = !t; };
    const rows = {};
    const sync = () => {
      triggerText.textContent = custom ? 'Custom…' : label(v.count);
      options.forEach((li) => li.setAttribute('aria-selected', String(li.dataset.key === (custom ? 'custom' : String(v.count)))));
      summary.textContent = `${v.focus} min focus · ${v.brk} min break`;
      rows.count.row.hidden = !custom;
      Object.values(rows).forEach((r) => r.show());
    };
    const makeRow = (key, title, unit) => {
      const [lo, hi] = RANGES[key];
      const row = document.createElement('div');
      row.className = 'lounge-stepper-row';
      const name = document.createElement('span');
      name.textContent = `${title} `;
      const range = document.createElement('small');
      range.textContent = unit ? `${lo}–${hi} ${unit}` : `${lo}–${hi}`;
      name.appendChild(range);
      const stepper = document.createElement('div');
      stepper.className = 'lounge-stepper';
      const minus = document.createElement('button');
      const plus = document.createElement('button');
      [minus, plus].forEach((b, i) => {
        b.type = 'button';
        b.className = 'icon-btn';
        b.textContent = i ? '+' : '–';
        b.setAttribute('aria-label', `${i ? 'Increase' : 'Decrease'} ${title.toLowerCase()}`);
      });
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 3;
      input.setAttribute('aria-label', title);
      stepper.append(minus, input, plus);
      row.append(name, stepper);
      const set = (n) => { v[key] = clampTo(n, RANGES[key]); setError(''); sync(); };
      minus.addEventListener('click', () => set(v[key] - 1));
      plus.addEventListener('click', () => set(v[key] + 1));
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        const n = Number(raw);
        if (!/^\d+$/.test(raw) || n < lo || n > hi) {
          setError(`${title} must be a whole number from ${lo} to ${hi}${unit ? ` ${unit}` : ''}.`);
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        set(n);
      });
      rows[key] = {
        row,
        show() { input.value = String(v[key]); minus.disabled = v[key] <= lo; plus.disabled = v[key] >= hi; input.removeAttribute('aria-invalid'); },
      };
      return row;
    };
    panel.append(makeRow('count', 'Pomodoros', ''), makeRow('focus', 'Focus', 'min'), makeRow('brk', 'Break', 'min'), error);

    const togglePanel = (open) => {
      panel.hidden = !open;
      editBtn.setAttribute('aria-expanded', String(open));
    };
    let active = -1;
    const setActive = (i) => {
      active = (i + options.length) % options.length;
      options.forEach((li, idx) => { li.dataset.active = String(idx === active); });
      options[active].focus();
    };
    const close = (refocus) => {
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (refocus) trigger.focus();
    };
    const open = () => {
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      setActive(options.findIndex((li) => li.getAttribute('aria-selected') === 'true'));
    };
    const choose = (li) => {
      if (li.dataset.key === 'custom') { custom = true; sync(); close(false); togglePanel(true); }
      else { custom = false; v.count = Number(li.dataset.key); sync(); close(true); }
    };
    trigger.addEventListener('click', () => (menu.hidden ? open() : close(false)));
    trigger.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && menu.hidden) { e.preventDefault(); open(); }
    });
    editBtn.addEventListener('click', () => togglePanel(panel.hidden));
    options.forEach((li) => li.addEventListener('click', () => choose(li)));
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
    const outside = (e) => {
      if (!root.isConnected) { document.removeEventListener('click', outside); return; }
      if (!root.contains(e.target) && !menu.contains(e.target)) close(false);
    };
    document.addEventListener('click', outside);

    sync();
    return {
      root, menu, summaryRow, panel,
      read() {
        for (const [key, title] of [['count', 'Pomodoros'], ['focus', 'Focus'], ['brk', 'Break']]) {
          const [lo, hi] = RANGES[key];
          if (!Number.isInteger(v[key]) || v[key] < lo || v[key] > hi) {
            togglePanel(true);
            setError(`${title} must be a whole number from ${lo} to ${hi}.`);
            return null;
          }
        }
        return { target: v.count, focus: v.focus, brk: v.brk };
      },
      /** The host's last used lengths become the next default. */
      remember() { safeSetGlobal('pomodoroSprintPrefs', { focus: v.focus, brk: v.brk }); },
    };
  },

  renderLoungeMission() {
    const container = document.getElementById('lounge-mission');
    if (!container) return;
    const room = state.lounge.room;
    if (!room) { container.replaceChildren(); container.dataset.mode = ''; return; }
    const isHost = Auth.isLoggedIn() && room.hostId === Auth.currentUser.id;

    if (!room.mission) {
      if (container.dataset.mode !== 'idle') {
        container.dataset.mode = 'idle';
        container.replaceChildren();
        const form = document.createElement('form');
        form.className = 'lounge-mission-form';
        form.id = 'lounge-mission-start-form';
        const picker = UI._buildSprintPicker();
        const btn = document.createElement('button');
        btn.type = 'submit';
        btn.id = 'lounge-mission-start-btn';
        btn.className = 'btn btn-primary';
        btn.textContent = 'Start Sprint';
        form.append(picker.root, btn, picker.menu, picker.summaryRow, picker.panel);
        const hint = document.createElement('p');
        hint.className = 'field-hint';
        hint.id = 'lounge-mission-solo-hint';
        container.append(form, hint);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const picked = picker.read(); // null (with an inline message) if a value is invalid
          if (picked === null) return;
          btn.disabled = true;
          Lounge.startMission(picked.target, picked.focus, picked.brk)
            .then(() => picker.remember())
            .catch((err) => setFieldStatus(hint, err.message, 'error'))
            .finally(() => { btn.disabled = false; });
        });
      }
      const solo = room.members.length < 2;
      const startBtn = document.getElementById('lounge-mission-start-btn');
      const hintEl = document.getElementById('lounge-mission-solo-hint');
      startBtn.disabled = solo || !isHost;
      startBtn.hidden = !isHost;
      document.getElementById('lounge-mission-target').disabled = !isHost;
      hintEl.textContent = !isHost ? 'Only the host can start a sprint.' : solo ? 'Invite at least one member to start a group sprint.' : '';
      return;
    }

    // Build the active-mission skeleton only once per mode switch, so a tick-driven re-render
    // (every 1s while a mission is active) never tears down a button mid-click.
    if (container.dataset.mode !== 'active') {
      container.dataset.mode = 'active';
      container.replaceChildren();

      const alert = document.createElement('p');
      alert.className = 'lounge-mission-alert';
      alert.id = 'lounge-mission-alert';
      alert.hidden = true;

      const progress = document.createElement('p');
      progress.className = 'lounge-mission-progress';
      progress.id = 'lounge-mission-progress';

      const chips = document.createElement('ul');
      chips.className = 'lounge-mission-chips';
      chips.id = 'lounge-mission-chips';

      const giveUpBtn = document.createElement('button');
      giveUpBtn.type = 'button';
      giveUpBtn.id = 'lounge-mission-giveup';
      giveUpBtn.className = 'btn btn-secondary';
      giveUpBtn.textContent = 'Give Up';
      giveUpBtn.addEventListener('click', () => { giveUpBtn.disabled = true; Lounge.giveUpOwnMission().catch(() => { giveUpBtn.disabled = false; }); });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.id = 'lounge-mission-cancel';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel Sprint';
      cancelBtn.addEventListener('click', () => { cancelBtn.disabled = true; Lounge.cancelMission().catch(() => { cancelBtn.disabled = false; }); });

      // Sprint settings are fixed once it starts; this read-only line replaces the picker.
      const settingsLine = document.createElement('p');
      settingsLine.className = 'field-hint';
      settingsLine.id = 'lounge-mission-settings';

      container.append(alert, progress, settingsLine, chips, giveUpBtn, cancelBtn);
    }

    const abandoned = room.members.filter((m) => m.missionState === 'abandoned');
    const alertEl = document.getElementById('lounge-mission-alert');
    if (abandoned.length) {
      alertEl.textContent = `${abandoned.map((m) => m.displayName).join(', ')} abandoned the sprint — waiting is impossible until the host cancels.`;
      alertEl.hidden = false;
    } else {
      alertEl.hidden = true;
    }

    const checkedInCount = room.members.filter((m) => m.missionState === 'checked-in').length;
    document.getElementById('lounge-mission-progress').textContent = `${checkedInCount}/${room.members.length} checked in`;

    document.getElementById('lounge-mission-settings').textContent = `${room.mission.targetPomodoros} pomodoro${room.mission.targetPomodoros > 1 ? 's' : ''} · ${room.mission.focusMinutes} min focus · ${room.mission.breakMinutes} min break`;
    const chipsEl = document.getElementById('lounge-mission-chips');
    chipsEl.replaceChildren();
    for (const m of room.members) {
      const chip = document.createElement('li');
      const label = m.missionState === 'checked-in' ? 'Checked In' : m.missionState === 'abandoned' ? 'Abandoned' : 'In Progress';
      chip.className = `lounge-mission-chip lounge-mission-chip--${m.missionState}`;
      chip.textContent = `${m.displayName}: ${label}`;
      chipsEl.appendChild(chip);
    }

    const self = room.members.find(Lounge.isSelf);
    document.getElementById('lounge-mission-giveup').disabled = !self || self.missionState !== 'pending';
    const cancelBtnEl = document.getElementById('lounge-mission-cancel');
    cancelBtnEl.hidden = !isHost;
    cancelBtnEl.disabled = !isHost;
  },

  renderLoungeActivityLog() {
    const list = document.getElementById('lounge-activity-log');
    if (!list) return;
    const room = state.lounge.room;
    if (!room) { list.replaceChildren(); list.dataset.lastId = ''; return; }
    const log = room.activityLog;
    // Track the id of the last-rendered entry, not a raw count: a count can't tell "same
    // room, log grew" apart from "different room" or "same room, but the 500-entry safety
    // cap trimmed past what was already rendered" — both leave the old count still <= the
    // new length, so nothing would ever get appended again. Finding the last-rendered id
    // in the current log handles all three cases uniformly: found -> append what's after
    // it; not found (new room, or trimmed away) -> the old DOM is stale, rebuild fully.
    const lastId = list.dataset.lastId || '';
    let startIndex = 0;
    if (lastId) {
      const idx = log.findIndex((e) => e.id === lastId);
      if (idx === -1) { list.replaceChildren(); startIndex = 0; } else { startIndex = idx + 1; }
    }
    const wasNearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 20;
    for (let i = startIndex; i < log.length; i++) {
      const li = document.createElement('li');
      li.className = 'lounge-activity-item';
      li.textContent = log[i].text;
      list.appendChild(li);
    }
    if (log.length) list.dataset.lastId = log[log.length - 1].id;
    if (wasNearBottom) list.scrollTop = list.scrollHeight;
  },

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


  renderLoungeChip() {
    const chip = document.getElementById('lounge-chip');
    if (!chip) return;
    const room = state.lounge.room;
    document.getElementById('site-header').classList.toggle('site-header--room', !!room);
    if (!room) { chip.hidden = true; return; }
    chip.hidden = false;
    const activeCount = room.members.filter((m) => m.status !== 'idle').length;
    const text = `Group: ${room.code} · ${activeCount} active`;
    const textEl = document.getElementById('lounge-chip-text');
    if (textEl.textContent !== text) textEl.textContent = text;
    const title = `${document.getElementById('live-users-count').textContent} online · ${text}`;
    if (chip.title !== title) chip.title = title;
  },

  renderLoungeView() {
    const lobbyGrid = document.getElementById('lounge-lobby-grid');
    const active = document.getElementById('lounge-active');
    if (!lobbyGrid || !active) return;
    UI.renderLoungeFriends();
    const loggedIn = Auth.isLoggedIn();
    document.getElementById('lounge-guest-hint').hidden = loggedIn;
    document.getElementById('lounge-lobby').hidden = !loggedIn;
    const inRoom = loggedIn && !!state.lounge.room;
    lobbyGrid.hidden = inRoom;
    active.hidden = !inRoom;
    if (inRoom) UI.renderLoungeRoom();
  },

  renderRoomInvites() {
    const section = document.getElementById('room-invites-section');
    const list = document.getElementById('room-invites-list');
    if (!section || !list) return;
    section.hidden = Lounge.pendingInvites.length === 0;
    list.replaceChildren();
    for (const invite of Lounge.pendingInvites) {
      const li = document.createElement('li');
      li.className = 'lounge-friend-item';
      const avatar = document.createElement('span');
      avatar.className = 'lounge-friend-item__avatar';
      Avatars.render(avatar, invite.from);
      const name = document.createElement('span');
      name.className = 'lounge-friend-item__name';
      name.textContent = `${invite.from.displayName} invited you to a room`;
      const joinBtn = document.createElement('button');
      joinBtn.type = 'button'; joinBtn.className = 'btn btn-primary'; joinBtn.textContent = 'Join';
      joinBtn.addEventListener('click', () => {
        joinBtn.disabled = true;
        Lounge.acceptInvite(invite.id).then(() => UI.selectView('lounge')).catch((err) => {
          setFieldStatus(document.getElementById('friend-search-status'), err.message, 'error');
          joinBtn.disabled = false;
        });
      });
      const declineBtn = document.createElement('button');
      declineBtn.type = 'button'; declineBtn.className = 'btn btn-secondary'; declineBtn.textContent = 'Decline';
      declineBtn.addEventListener('click', () => { declineBtn.disabled = true; Lounge.declineInvite(invite.id); });
      li.append(avatar, name, joinBtn, declineBtn);
      list.appendChild(li);
    }
  },

  renderDarkModeToggle() {
    const btn = document.getElementById('darkmode-toggle');
    if (!btn) return;
    const dark = Theme.isDark();
    btn.innerHTML = dark ? Icons.sun : Icons.moon;
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  },

  renderMuteToggle() {
    const btn = document.getElementById('mute-toggle');
    if (!btn) return;
    const muted = state.musicSettings.muted;
    btn.innerHTML = muted ? Icons.volumeMute : Icons.volumeOn;
    btn.setAttribute('aria-pressed', String(muted));
    btn.setAttribute('aria-label', muted ? 'Unmute background music' : 'Mute background music');
  },

  selectView(view) {
    state.currentView = view;
    ['dashboard', 'reports', 'leaderboard', 'lounge', 'guides'].forEach((v) => {
      const panel = document.getElementById(`view-${v}`);
      const link = document.getElementById(`nav-${v}`);
      const bottomLink = document.getElementById(`navbar-${v}`);
      if (panel) panel.hidden = v !== view;
      [link, bottomLink].forEach((el) => {
        if (!el) return;
        if (v === view) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
      });
    });
    if (view === 'reports') UI.renderReports();
    if (view === 'leaderboard') UI.renderLeaderboard();
    if (view === 'lounge') UI.renderLoungeView();
    if (view === 'guides') Guides.load();
  },

  renderReports() {
    const chart = document.getElementById('reports-chart');
    if (!chart) return;
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const entry = state.dailyHistory.find((h) => h.date === key);
      days.push({
        date: key,
        pomodoros: entry ? entry.pomodoros : 0,
        focusMinutes: entry ? entry.focusMinutes : 0,
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      });
    }
    const weekTotal = days.reduce((s, d) => s + d.pomodoros, 0);
    const weekFocusTotal = days.reduce((s, d) => s + d.focusMinutes, 0);
    const best = days.reduce((a, b) => (b.pomodoros > a.pomodoros ? b : a), days[0]);

    document.getElementById('report-week-total').textContent = String(weekTotal);
    document.getElementById('report-week-avg').textContent = `${Math.round(weekFocusTotal / 7)}m`;
    document.getElementById('report-week-best').textContent = best.pomodoros > 0 ? `${best.label} (${best.pomodoros})` : '—';

    chart.replaceChildren();
    const max = Math.max(1, ...days.map((d) => d.pomodoros));
    days.forEach((d, i) => {
      const isToday = i === days.length - 1;
      const col = document.createElement('div');
      col.className = 'bar-chart__col' + (isToday ? ' bar-chart__col--today' : '');
      const minuteLabel = document.createElement('span');
      minuteLabel.className = 'bar-chart__minutes';
      minuteLabel.textContent = `${d.focusMinutes}m`;
      const bar = document.createElement('div');
      bar.className = 'bar-chart__bar';
      bar.style.height = `${Math.max(2, Math.round((d.pomodoros / max) * 100))}%`;
      bar.title = `${d.label}: ${d.pomodoros} pomodoros, ${d.focusMinutes}m focus`;
      const label = document.createElement('span');
      label.className = 'bar-chart__label';
      label.textContent = d.label.slice(0, 1);
      col.append(minuteLabel, bar, label);
      chart.appendChild(col);
    });
  },

  renderLeaderboard() {
    Leaderboard.refresh();
    const list = document.getElementById('leaderboard-list');
    if (!list) return;
    list.replaceChildren();
    const sorted = [...state.dailyHistory].sort((a, b) => b.pomodoros - a.pomodoros).slice(0, 10);
    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';
      li.textContent = 'Complete a pomodoro to start building your ranking.';
      list.appendChild(li);
      return;
    }
    sorted.forEach((d, i) => {
      const li = document.createElement('li');
      li.className = 'leaderboard-item';
      const rank = document.createElement('span');
      rank.className = 'leaderboard-item__rank';
      rank.textContent = `#${i + 1}`;
      const date = document.createElement('span');
      date.className = 'leaderboard-item__date';
      date.textContent = d.date;
      const count = document.createElement('span');
      count.className = 'leaderboard-item__count';
      count.textContent = `${d.pomodoros} pomodoros`;
      li.append(rank, date, count);
      list.appendChild(li);
    });
  },

  renderStatsDashboard() {
    const s = state.stats;
    const focusLevel = Skills.progress(s.focusXP).level;
    const hours = Math.floor(s.totalFocusMinutes / 60);
    const mins = s.totalFocusMinutes % 60;
    const totalPomodorosEl = document.getElementById('stat-total-pomodoros');
    const focusTimeEl = document.getElementById('stat-focus-time');
    const streakEl = document.getElementById('stat-streak');
    const skillLevelEl = document.getElementById('stat-skill-level');
    if (totalPomodorosEl) totalPomodorosEl.textContent = String(s.totalPomodoros);
    if (focusTimeEl) focusTimeEl.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    if (streakEl) streakEl.textContent = String(s.currentStreak);
    if (skillLevelEl) skillLevelEl.textContent = `Lv. ${focusLevel}`;
  },

  renderMissions() {
    const list = document.getElementById('missions-list');
    const skillsList = document.getElementById('skills-list');
    if (!list || !skillsList) return;

    const levelChip = document.getElementById('missions-level-chip');
    if (levelChip) {
      const totalXp = state.stats.focusXP + state.stats.disciplineXP;
      const level = Skills.progress(state.stats.focusXP).level;
      levelChip.textContent = `Level ${level} · ${totalXp} XP`;
    }

    list.replaceChildren();
    const ringColors = ['var(--acc)', 'var(--long)', 'var(--short)'];
    const RING_R = 18, RING_C = 2 * Math.PI * 18;
    Missions.status(state.stats).forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'mission-item' + (m.done ? ' mission-item--done' : '');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', `${m.text}${m.done ? ', complete' : ', in progress'}`);

      const ringWrap = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ringWrap.setAttribute('class', 'mission-ring');
      ringWrap.setAttribute('viewBox', '0 0 44 44');
      ringWrap.setAttribute('width', '44');
      ringWrap.setAttribute('height', '44');
      ringWrap.setAttribute('aria-hidden', 'true');
      const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.setAttribute('class', 'mission-ring__track');
      track.setAttribute('cx', '22'); track.setAttribute('cy', '22'); track.setAttribute('r', String(RING_R));
      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fill.setAttribute('class', 'mission-ring__fill');
      fill.setAttribute('cx', '22'); fill.setAttribute('cy', '22'); fill.setAttribute('r', String(RING_R));
      fill.setAttribute('transform', 'rotate(-90 22 22)');
      fill.style.stroke = ringColors[i % ringColors.length];
      fill.style.strokeDasharray = String(RING_C);
      fill.style.strokeDashoffset = String(RING_C * (1 - (m.target ? m.value / m.target : 0)));
      ringWrap.append(track, fill);

      const body = document.createElement('div');
      body.className = 'mission-item__body';
      const text = document.createElement('span');
      text.className = 'mission-item__text';
      text.textContent = m.text;
      const progress = document.createElement('span');
      progress.className = 'mission-item__progress';
      progress.textContent = m.progressText;
      body.append(text, progress);

      row.append(ringWrap, body);
      list.appendChild(row);
    });

    skillsList.replaceChildren();
    const skills = [
      { name: 'Focus', xp: state.stats.focusXP },
      { name: 'Discipline', xp: state.stats.disciplineXP },
    ];
    for (const skill of skills) {
      const { level, xpIntoLevel, xpForLevel } = Skills.progress(skill.xp);
      const row = document.createElement('div');
      row.className = 'skill-row';

      const head = document.createElement('div');
      head.className = 'skill-row__head';
      const name = document.createElement('span');
      name.className = 'skill-row__name';
      name.textContent = skill.name;
      const levelEl = document.createElement('span');
      levelEl.className = 'skill-row__level';
      levelEl.textContent = `Lv. ${level} · ${xpIntoLevel}/${xpForLevel} XP`;
      head.append(name, levelEl);

      const bar = document.createElement('div');
      bar.className = 'skill-row__bar';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', `${skill.name} level progress`);
      bar.setAttribute('aria-valuenow', String(Math.round((xpIntoLevel / xpForLevel) * 100)));
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      const fill = document.createElement('div');
      fill.className = 'skill-row__fill';
      fill.style.width = `${Math.round((xpIntoLevel / xpForLevel) * 100)}%`;
      bar.appendChild(fill);

      row.append(head, bar);
      skillsList.appendChild(row);
    }
  },

  renderChatStatus() {
    const dot = document.getElementById('ai-chat-status-dot');
    const text = document.getElementById('ai-chat-status-text');
    const form = document.getElementById('ai-chat-form');
    const input = document.getElementById('ai-chat-input');
    const send = document.getElementById('ai-chat-send');
    const gotoBtn = document.getElementById('ai-chat-goto-settings');
    if (!dot) return;
    const connected = AIChat.hasKey();
    dot.className = 'ai-chat__status-dot' + (connected ? ' is-connected' : '');
    text.textContent = connected ? 'Connected' : 'Not connected';
    input.disabled = !connected;
    send.disabled = !connected;
    form.hidden = !connected;
    if (gotoBtn) gotoBtn.hidden = connected;
  },

  renderChat(errorText) {
    UI.renderChatStatus();
    const list = document.getElementById('ai-chat-messages');
    if (!list) return;
    list.replaceChildren();

    if (!AIChat.hasKey() && state.chatHistory.length === 0) {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble--assistant';
      bubble.textContent = 'Hello! Please add your API key in the settings to activate me.';
      list.appendChild(bubble);
      return;
    }

    for (const m of state.chatHistory) {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble ' + (m.role === 'user' ? 'chat-bubble--user' : 'chat-bubble--assistant');
      bubble.textContent = m.text;
      list.appendChild(bubble);
    }
    if (AIChat._pending) {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble--assistant chat-bubble--pending';
      bubble.textContent = 'Thinking…';
      list.appendChild(bubble);
    }
    if (errorText) {
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble chat-bubble--error';
      bubble.textContent = errorText;
      list.appendChild(bubble);
    }
    list.scrollTop = list.scrollHeight;
  },

  renderTasks() {
    const list = document.getElementById('task-list');
    const empty = document.getElementById('task-empty-state');
    list.replaceChildren();
    empty.hidden = state.tasks.length > 0;

    const summaryEl = document.getElementById('plan-summary');
    if (summaryEl) {
      const remaining = state.tasks
        .filter((t) => !t.completed)
        .reduce((sum, t) => sum + Math.max(t.estimatedPomodoros - t.completedPomodoros, 0), 0);
      summaryEl.textContent = `${remaining} pomodoro${remaining === 1 ? '' : 's'} left in your plan`;
    }

    for (const task of state.tasks) {
      const li = document.createElement('li');
      li.className = 'task' + (task.id === state.activeTaskId ? ' task--active' : '') + (task.completed ? ' task--done' : '');
      li.dataset.id = task.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-pressed', String(task.id === state.activeTaskId));

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', `Mark "${task.text}" complete`);
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', () => Planner.toggleComplete(task.id));

      let priorityFlag = null;
      if (task.priority) {
        const label = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' }[task.priority];
        priorityFlag = document.createElement('span');
        priorityFlag.className = `task__priority task__priority--${task.priority}`;
        priorityFlag.setAttribute('aria-label', label);
        priorityFlag.title = label;
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'task__text';
      textSpan.textContent = task.text;

      let projectTag = null;
      if (task.project) {
        projectTag = document.createElement('span');
        projectTag.className = 'task__project';
        projectTag.textContent = task.project;
      }

      const progress = document.createElement('span');
      progress.className = 'task__progress';
      progress.textContent = `${task.completedPomodoros}/${task.estimatedPomodoros}`;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'task__delete';
      del.setAttribute('aria-label', `Delete "${task.text}"`);
      del.innerHTML = Icons.trash;
      del.addEventListener('click', (e) => { e.stopPropagation(); Planner.deleteTask(task.id); });

      li.addEventListener('click', () => Planner.setActiveTask(task.id));
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Planner.setActiveTask(task.id); }
      });

      li.append(checkbox, ...(priorityFlag ? [priorityFlag] : []), textSpan, ...(projectTag ? [projectTag] : []), progress, del);
      list.appendChild(li);
    }

    const activeDisplay = document.getElementById('active-task-display');
    const active = state.tasks.find(t => t.id === state.activeTaskId);
    activeDisplay.textContent = active ? `Currently focusing on: ${active.text}` : 'Choose a task to focus on';
  },

  toggleBgFields(type) {
    const rows = {
      image: document.getElementById('row-bg-image'),
      video: document.getElementById('row-bg-video'),
      youtube: document.getElementById('row-bg-youtube'),
      localImage: document.getElementById('row-bg-local-image'),
      localVideo: document.getElementById('row-bg-local-video'),
    };
    Object.entries(rows).forEach(([key, el]) => { if (el) el.hidden = key !== type; });
  },

  previewBackgroundUrl: async function previewBackgroundUrl(kind) {
    const inputId = kind === 'image' ? 'setting-bg-image-url' : 'setting-bg-video-url';
    const statusId = kind === 'image' ? 'status-bg-image-url' : 'status-bg-video-url';
    const boxId = kind === 'image' ? 'preview-box-bg-image-url' : 'preview-box-bg-video-url';
    const url = document.getElementById(inputId).value.trim();
    const status = document.getElementById(statusId);
    const box = document.getElementById(boxId);
    box.replaceChildren();
    if (!url) { setFieldStatus(status, 'Please enter a valid URL.', 'error'); return; }
    if (kind === 'video' && YouTube.extractId(url)) {
      // A YouTube link was pasted into the direct-video field — preview it as YouTube instead of
      // failing the native <video> load (YouTube pages are never a playable video src).
      await UI._previewYoutubeInto(url, status, box);
      return;
    }
    setFieldStatus(status, 'Loading…', '');
    const result = kind === 'image' ? await MediaService.loadImageFromUrl(url) : await MediaService.loadVideoFromUrl(url);
    if (!result.ok) { setFieldStatus(status, result.reason, 'error'); return; }
    setFieldStatus(status, 'Looks good', 'success');
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.style.cssText = 'max-height:120px;border-radius:8px;';
      box.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = url; video.controls = true; video.muted = true; video.style.cssText = 'max-height:120px;border-radius:8px;';
      box.appendChild(video);
    }
  },

  previewYoutubeUrl: async function previewYoutubeUrl() {
    const url = document.getElementById('setting-bg-youtube-url').value.trim();
    const status = document.getElementById('status-bg-youtube-url');
    const box = document.getElementById('preview-box-bg-youtube-url');
    box.replaceChildren();
    if (!url) { setFieldStatus(status, 'Please enter a valid YouTube URL or video ID.', 'error'); return; }
    await UI._previewYoutubeInto(url, status, box);
  },

  _previewYoutubeInto: async function _previewYoutubeInto(url, status, box) {
    const id = YouTube.extractId(url);
    if (!id) { setFieldStatus(status, 'Please enter a valid YouTube URL or video ID.', 'error'); return; }
    setFieldStatus(status, 'Loading…', '');
    const result = await YouTube.checkEmbeddable(id);
    if (!result.ok) { setFieldStatus(status, result.reason, 'error'); return; }
    setFieldStatus(status, 'Looks good', 'success');
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${id}?controls=1`;
    iframe.style.cssText = 'width:213px;max-width:100%;height:120px;border:0;border-radius:8px;';
    iframe.allow = 'autoplay; encrypted-media';
    box.appendChild(iframe);
  },

  _pendingLocalMedia: { image: null, video: null },
  _pendingLocalAudio: null,

  handleLocalMediaChoice(kind) {
    document.getElementById(kind === 'image' ? 'local-bg-image-input' : 'local-bg-video-input').click();
  },

  handleLocalMediaFile: async function handleLocalMediaFile(kind, file) {
    const status = document.getElementById(kind === 'image' ? 'status-local-bg-image' : 'status-local-bg-video');
    setFieldStatus(status, 'Loading…', '');
    const result = await MediaService.validateLocalFile(file, kind);
    if (!result.ok) { setFieldStatus(status, result.reason, 'error'); return; }
    setFieldStatus(status, 'Looks good', 'success');
    UI._pendingLocalMedia[kind] = file;
    document.getElementById(kind === 'image' ? 'name-local-bg-image' : 'name-local-bg-video').textContent = file.name;
    const previewBox = document.getElementById(kind === 'image' ? 'preview-box-local-bg-image' : 'preview-box-local-bg-video');
    previewBox.replaceChildren();
    const url = ObjectURLRegistry.set(kind === 'image' ? 'bg-image-preview' : 'bg-video-preview', file);
    const el = document.createElement(kind === 'image' ? 'img' : 'video');
    el.src = url; el.style.cssText = 'max-height:120px;border-radius:8px;';
    if (kind === 'video') { el.controls = true; el.muted = true; }
    previewBox.appendChild(el);
  },

  removeLocalMedia: async function removeLocalMedia(kind) {
    UI._pendingLocalMedia[kind] = null;
    document.getElementById(kind === 'image' ? 'name-local-bg-image' : 'name-local-bg-video').textContent = '';
    document.getElementById(kind === 'image' ? 'preview-box-local-bg-image' : 'preview-box-local-bg-video').replaceChildren();
    document.getElementById(kind === 'image' ? 'status-local-bg-image' : 'status-local-bg-video').textContent = '';
    const activeIdKey = kind === 'image' ? 'localImageId' : 'localVideoId';
    if (state.mediaSettings.type === (kind === 'image' ? 'localImage' : 'localVideo') && state.mediaSettings[activeIdKey] != null) {
      await LocalMediaDB.delete(state.mediaSettings[activeIdKey]);
      state.mediaSettings = { ...state.mediaSettings, type: 'default', [activeIdKey]: null };
      Storage.saveMediaSettings(state.mediaSettings);
      Media.applyBackground();
    }
  },

  selectSettingsTab(id) {
    SETTINGS_TABS.forEach((t) => {
      const tabBtn = document.getElementById(`tab-${t}`);
      const panel = document.getElementById(`panel-${t}`);
      const active = t === id;
      tabBtn.setAttribute('aria-selected', String(active));
      tabBtn.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
    });
  },

  openSettings() {
    UI.selectSettingsTab('timer');
    document.getElementById('setting-pomodoro').value = state.settings.pomodoro;
    document.getElementById('setting-short-break').value = state.settings.shortBreak;
    document.getElementById('setting-long-break').value = state.settings.longBreak;
    document.getElementById('setting-auto-break').checked = state.settings.autoStartBreaks;
    document.getElementById('setting-auto-pomodoro').checked = state.settings.autoStartPomodoros;
    document.getElementById('setting-bg-type').value = state.mediaSettings.type;
    document.getElementById('setting-bg-image-url').value = state.mediaSettings.imageUrl;
    document.getElementById('setting-bg-video-url').value = state.mediaSettings.videoUrl;
    document.getElementById('setting-bg-youtube-url').value = state.mediaSettings.youtubeId;
    document.getElementById('setting-bg-youtube-mode').value = state.mediaSettings.playbackMode;
    document.getElementById('setting-ai-api-key').value = state.chatSettings.apiKey;
    document.getElementById('status-ai-api-key').textContent = '';
    UI.toggleBgFields(state.mediaSettings.type);
    ['pomodoro', 'short-break', 'long-break'].forEach((f) => {
      document.getElementById(`setting-${f}`).setAttribute('aria-invalid', 'false');
      document.getElementById(`error-${f}`).hidden = true;
    });
    if (typeof UI.renderAppearanceUI === 'function') UI.renderAppearanceUI();
    if (typeof UI.renderMusicUI === 'function') UI.renderMusicUI();
    document.getElementById('settings').showModal();
  },
  closeSettings() { document.getElementById('settings').close(); },

  async saveSettingsFromForm(event) {
    event.preventDefault();
    const pomo = validateDuration('setting-pomodoro', 'error-pomodoro', 1, 180);
    const short = validateDuration('setting-short-break', 'error-short-break', 1, 90);
    const long = validateDuration('setting-long-break', 'error-long-break', 1, 180);
    if (pomo === null || short === null || long === null) return;

    const oldSettings = state.settings;
    state.settings = {
      pomodoro: pomo, shortBreak: short, longBreak: long,
      autoStartBreaks: document.getElementById('setting-auto-break').checked,
      autoStartPomodoros: document.getElementById('setting-auto-pomodoro').checked,
    };
    Storage.saveSettings(state.settings);
    if (!state.timer.running) {
      Timer.reset();
    } else {
      // "On-the-fly" edit: a running timer keeps its elapsed progress, but the
      // *remaining* time shifts by however much the active mode's duration just
      // changed -- increase it and you get more time now, decrease it and less
      // (clamped at 0, which just completes the session on the next tick).
      const deltaMin = state.settings[state.timer.mode] - oldSettings[state.timer.mode];
      if (deltaMin !== 0) {
        state.timer.remainingMs = Math.max(0, state.timer.remainingMs + deltaMin * 60000);
        // Timer.tick() computes remainingMs from endAt every 250ms, not the other way
        // around -- endAt is the actual authoritative countdown anchor while running, so
        // it has to move too or the very next tick silently overwrites the change above.
        if (state.timer.endAt !== null) state.timer.endAt = Date.now() + state.timer.remainingMs;
        Timer.updateTimerDisplay();
        Lounge.reportStatus();
      }
    }

    let bgType = document.getElementById('setting-bg-type').value;
    const imageUrl = document.getElementById('setting-bg-image-url').value.trim();
    let videoUrl = document.getElementById('setting-bg-video-url').value.trim();
    let youtubeRaw = document.getElementById('setting-bg-youtube-url').value.trim();
    let playbackMode = document.getElementById('setting-bg-youtube-mode').value;

    if (bgType === 'video' && YouTube.extractId(videoUrl)) {
      // A YouTube link in the direct-video field is never a playable <video> src — treat it as
      // a YouTube background instead of saving a type that's guaranteed to fail to load.
      youtubeRaw = videoUrl;
      videoUrl = '';
      playbackMode = 'background';
      bgType = 'youtube';
    }

    let localImageId = state.mediaSettings.localImageId;
    let localVideoId = state.mediaSettings.localVideoId;
    let typeChanged = bgType !== state.mediaSettings.type
      || (bgType === 'image' && imageUrl !== state.mediaSettings.imageUrl)
      || (bgType === 'video' && videoUrl !== state.mediaSettings.videoUrl)
      || (bgType === 'youtube' && (youtubeRaw !== state.mediaSettings.youtubeId || playbackMode !== state.mediaSettings.playbackMode));

    if (bgType === 'localImage' && UI._pendingLocalMedia.image) {
      localImageId = await LocalMediaDB.save('image', UI._pendingLocalMedia.image);
      UI._pendingLocalMedia.image = null;
      typeChanged = true;
    } else if (bgType === 'localImage' && localImageId == null) {
      Media.applyDefaultBackground();
    }
    if (bgType === 'localVideo' && UI._pendingLocalMedia.video) {
      localVideoId = await LocalMediaDB.save('video', UI._pendingLocalMedia.video);
      UI._pendingLocalMedia.video = null;
      typeChanged = true;
    } else if (bgType === 'localVideo' && localVideoId == null) {
      Media.applyDefaultBackground();
    }

    state.mediaSettings = {
      ...state.mediaSettings,
      type: ['default', 'image', 'video', 'youtube', 'localImage', 'localVideo'].includes(bgType) ? bgType : 'default',
      imageUrl, videoUrl,
      youtubeId: youtubeRaw,
      playbackMode: ['audio', 'background'].includes(playbackMode) ? playbackMode : 'background',
      localImageId, localVideoId,
    };
    Storage.saveMediaSettings(state.mediaSettings);
    if (typeChanged) Media.applyBackground();

    const musicSource = document.getElementById('setting-music-source').value;
    if (musicSource === 'url') {
      const audioUrl = document.getElementById('setting-music-url').value.trim();
      if (audioUrl && audioUrl !== state.musicSettings.audioUrl) {
        const wasPlaying = MusicPlayer.isPlaying();
        const result = await MusicPlayer.selectUrl(audioUrl);
        if (result.ok) {
          state.musicSettings = { ...state.musicSettings, source: 'url', audioUrl };
          Storage.saveMusicSettings(state.musicSettings);
          if (wasPlaying) MusicPlayer.play();
        }
      }
    } else if (musicSource === 'upload' && UI._pendingLocalAudio) {
      const result = await MusicPlayer.selectUpload(UI._pendingLocalAudio);
      if (result.ok) {
        state.musicSettings = { ...state.musicSettings, source: 'upload', localAudioId: result.id };
        Storage.saveMusicSettings(state.musicSettings);
        UI._pendingLocalAudio = null;
      }
    }
    UI.renderMusicUI();

    const apiKey = document.getElementById('setting-ai-api-key').value.trim();
    if (apiKey !== state.chatSettings.apiKey) {
      state.chatSettings = { apiKey };
      Storage.saveChatSettings(state.chatSettings);
      UI.renderChat();
    }

    UI.closeSettings();
  },

  syncMediaControls() {
    const playBtn = document.getElementById('media-play');
    const muteBtn = document.getElementById('media-mute');
    const volume = document.getElementById('media-volume');
    const c = Media.getActiveController();
    const playing = c ? c.isPlaying() : false;
    if (playBtn) { playBtn.innerHTML = playing ? Icons.pause : Icons.play; playBtn.setAttribute('aria-pressed', String(playing)); }
    if (muteBtn) { muteBtn.innerHTML = state.mediaSettings.muted ? Icons.volumeMute : Icons.volumeOn; muteBtn.setAttribute('aria-pressed', String(state.mediaSettings.muted)); }
    if (volume) volume.value = Math.round(state.mediaSettings.volume * 100);
  },

  toggleMusicSourceFields(source) {
    const rows = {
      builtin: document.getElementById('row-music-builtin'),
      url: document.getElementById('row-music-url'),
      upload: document.getElementById('row-music-upload'),
    };
    Object.entries(rows).forEach(([key, el]) => { if (el) el.hidden = key !== source; });
  },

  renderMusicUI() {
    document.getElementById('setting-music-source').value = state.musicSettings.source;
    UI.toggleMusicSourceFields(state.musicSettings.source);
    document.querySelectorAll('#music-track-list li').forEach((li) => {
      const active = li.dataset.id === state.musicSettings.builtinTrackId && state.musicSettings.source === 'builtin';
      li.classList.toggle('track--active', active);
    });
    const playing = MusicPlayer.isPlaying();
    const playBtn = document.getElementById('music-play');
    playBtn.innerHTML = playing ? Icons.pause : Icons.play;
    playBtn.setAttribute('aria-pressed', String(playing));
    const muteBtn = document.getElementById('music-mute');
    muteBtn.innerHTML = state.musicSettings.muted ? Icons.volumeMute : Icons.volumeOn;
    muteBtn.setAttribute('aria-pressed', String(state.musicSettings.muted));
    document.getElementById('music-loop').setAttribute('aria-pressed', String(state.musicSettings.loop));
    document.getElementById('music-volume').value = Math.round(state.musicSettings.volume * 100);
    const canSkip = state.musicSettings.source === 'builtin';
    document.getElementById('music-prev').disabled = !canSkip;
    document.getElementById('music-next').disabled = !canSkip;
  },

  _musicRAF: null,
  _musicProgressTick() {
    const { currentSec, durationSec } = MusicPlayer.getProgress();
    const bar = document.getElementById('music-progress');
    const time = document.getElementById('music-time');
    if (durationSec > 0) {
      const pos = String(Math.round((currentSec / durationSec) * 1000));
      if (bar.value !== pos) bar.value = pos;
    }
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const label = `${fmt(currentSec)} / ${fmt(durationSec)}`;
    if (time.textContent !== label) time.textContent = label; // changes once a second, not 60 times
    if (MusicPlayer.isPlaying()) UI._musicRAF = requestAnimationFrame(UI._musicProgressTick);
    else UI._musicRAF = null;
  },

  renderAppearanceUI() {
    document.getElementById('setting-theme-preset').value = state.themeSettings.preset;
    APPEARANCE_KEYS.forEach((key) => {
      const hex = state.themeSettings.colors[key];
      document.getElementById(`color-${key}`).value = hex;
      document.getElementById(`hex-${key}`).value = hex;
    });
    const warnings = Theme.checkContrastWarnings();
    const box = document.getElementById('contrast-warnings');
    box.replaceChildren();
    warnings.forEach((w) => {
      const p = document.createElement('p');
      p.className = 'field-error';
      p.textContent = w;
      box.appendChild(p);
    });
  },

  init() {
    State.init();
    UI.initDialogCoordination();
    // Deliberately not awaited: the timer/tasks/settings below are fully local
    // and must render and become interactive immediately, even if the backend
    // is slow, cold-starting, or briefly unreachable. Auth-dependent UI
    // (header name, friends/notifications, the first-visit auth modal)
    // catches up as soon as the session check resolves.
    Auth.init().then(() => {
      UI.syncAuthUI();
      const pendingMessage = Auth._pendingAuthMessage;
      Auth._pendingAuthMessage = null;
      // An open modal dialog makes everything behind it unclickable -- including the cookie banner -- so the
      // automatic pop-ups wait until the visitor has answered the banner.
      const afterCookieChoice = (fn) => (window.PomoConsent ? window.PomoConsent.whenDecided(fn) : fn());
      if (Auth.isLoggedIn()) {
        if (Auth.consentRequired) afterCookieChoice(() => UI.openConsentModal());
      } else if (pendingMessage || !safeParseGlobal('pomodoroGuestChoice')) {
        afterCookieChoice(() => {
          document.getElementById('auth-modal').showModal();
          if (pendingMessage) setFieldStatus(document.getElementById('status-auth-login'), pendingMessage, 'error');
        });
      }
    });
    // Cloudflare's bot check is fetched only once the sign-in window is opened.
    new MutationObserver(() => { if (document.getElementById('auth-modal').open) Captcha.ensureLoaded(); })
      .observe(document.getElementById('auth-modal'), { attributes: true, attributeFilter: ['open'] });
    UI.renderTasks();
    UI.renderPomodoroCount();
    UI.renderStatsDashboard();
    UI.renderMissions();
    UI.renderChat();
    UI.renderProfile();
    UI.renderDarkModeToggle();
    UI.renderMuteToggle();
    // (Reports and Leaderboard are rendered when their view is opened -- see selectView.)
    Timer.updateTimerDisplay();
    UI.renderTimerControls();
    Media.applyBackground();
    UI.renderMusicUI();

    ['dashboard', 'reports', 'leaderboard', 'lounge', 'guides'].forEach((v) => {
      document.getElementById(`nav-${v}`).addEventListener('click', () => UI.selectView(v));
      const bottomLink = document.getElementById(`navbar-${v}`);
      if (bottomLink) bottomLink.addEventListener('click', () => UI.selectView(v));
    });

    document.getElementById('darkmode-toggle').addEventListener('click', () => Theme.toggleDarkMode());
    document.getElementById('mute-toggle').addEventListener('click', () => {
      MusicPlayer.setMuted(!state.musicSettings.muted);
      UI.renderMuteToggle();
      if (typeof UI.renderMusicUI === 'function') UI.renderMusicUI();
    });

    // ---- Notifications ----
    const notifMenu = document.getElementById('notif-menu');
    const notifTrigger = document.getElementById('notif-trigger');
    const openNotifMenu = () => {
      closeFriendsDrawer();
      notifMenu.hidden = false;
      notifTrigger.setAttribute('aria-expanded', 'true');
    };
    const closeNotifMenu = () => {
      notifMenu.hidden = true;
      notifTrigger.setAttribute('aria-expanded', 'false');
    };
    notifTrigger.addEventListener('click', () => (notifMenu.hidden ? openNotifMenu() : closeNotifMenu()));
    document.getElementById('notif-close').addEventListener('click', closeNotifMenu);
    document.getElementById('notif-mark-all-read').addEventListener('click', () => Notifications.markAllRead());
    document.addEventListener('click', (e) => {
      if (!notifMenu.hidden && !document.getElementById('notif-picker').contains(e.target)) closeNotifMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !notifMenu.hidden) closeNotifMenu();
    });

    // ---- Profile modal ----
    document.getElementById('user-avatar').addEventListener('click', () => UI.openProfileModal());
    document.getElementById('user-name-display').addEventListener('click', () => UI.openProfileModal());
    document.getElementById('profile-modal-close').addEventListener('click', () => document.getElementById('profile-modal').close());
    document.getElementById('profile-modal-edit-btn').addEventListener('click', () => UI.openProfileEdit());
    document.getElementById('profile-modal-logout-btn').addEventListener('click', () => {
      document.getElementById('profile-modal').close();
      Auth.logout();
      clearAuthModalInputs();
      document.getElementById('auth-modal').showModal();
    });
    document.getElementById('profile-modal-login-btn').addEventListener('click', () => {
      document.getElementById('profile-modal').close();
      document.getElementById('auth-modal').showModal();
    });
    document.getElementById('profile-edit-cancel').addEventListener('click', () => {
      if (UI._pendingAvatarPhoto instanceof File) ObjectURLRegistry.revoke('profile-avatar-preview');
      document.getElementById('profile-modal-view').hidden = false;
      document.getElementById('profile-modal-edit').hidden = true;
    });

    // ---- Auth modal ----
    const clearAuthModalInputs = () => {
      document.getElementById('auth-login-identifier').value = '';
      document.getElementById('auth-login-password').value = '';
      document.getElementById('auth-signup-username').value = '';
      document.getElementById('auth-signup-email').value = '';
      document.getElementById('auth-signup-password').value = '';
      document.getElementById('auth-login-consent').checked = false;
      document.getElementById('auth-signup-consent').checked = false;
      setFieldStatus(document.getElementById('status-auth-login'), '', '');
      setFieldStatus(document.getElementById('status-auth-signup'), '', '');
      ForgotPassword.reset();
      setAuthView('login');
    };
    document.getElementById('auth-tab-login').addEventListener('click', () => setAuthView('login'));
    document.getElementById('auth-tab-signup').addEventListener('click', () => setAuthView('signup'));
    document.getElementById('auth-login-submit').addEventListener('click', async () => {
      const status = document.getElementById('status-auth-login');
      const identifier = document.getElementById('auth-login-identifier').value.trim();
      const password = document.getElementById('auth-login-password').value;
      setFieldStatus(status, '', '');
      const consentBox = document.getElementById('auth-login-consent');
      if (!consentBox.checked) { setFieldStatus(status, 'Please tick the box to agree to the Terms of Service and Privacy Policy.', 'error'); consentBox.focus(); return; }
      try {
        await Auth.login(identifier, password, true);
        document.getElementById('auth-modal').close();
        clearAuthModalInputs();
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      } finally {
        Captcha.reset('login');
      }
    });
    document.getElementById('auth-signup-submit').addEventListener('click', async () => {
      const status = document.getElementById('status-auth-signup');
      const username = document.getElementById('auth-signup-username').value.trim();
      const email = document.getElementById('auth-signup-email').value.trim();
      const password = document.getElementById('auth-signup-password').value;
      setFieldStatus(status, '', '');
      const consentBox = document.getElementById('auth-signup-consent');
      if (!consentBox.checked) { setFieldStatus(status, 'Please tick the box to agree to the Terms of Service and Privacy Policy.', 'error'); consentBox.focus(); return; }
      if (password.length < 8 || password.length > 72) { setFieldStatus(status, 'Password must be 8 to 72 characters.', 'error'); return; }
      try {
        await Auth.register(username, password, username, email, true);
        document.getElementById('auth-modal').close();
        clearAuthModalInputs();
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      } finally {
        Captcha.reset('signup');
      }
    });
    document.getElementById('auth-guest-btn').addEventListener('click', () => {
      Auth.continueAsGuest();
      document.getElementById('auth-modal').close();
    });
    // "Continue with Google/Microsoft/Facebook" also needs the agreement box ticked: the choice travels to the
    // server (consent=1), which refuses to create a new account without it.
    document.querySelectorAll('.auth-modal__oauth-btn').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const signup = !document.getElementById('auth-panel-signup').hidden;
        const box = document.getElementById(signup ? 'auth-signup-consent' : 'auth-login-consent');
        const status = document.getElementById(signup ? 'status-auth-signup' : 'status-auth-login');
        if (!box.checked) { setFieldStatus(status, 'Please tick the box to agree to the Terms of Service and Privacy Policy first.', 'error'); box.focus(); return; }
        location.assign(`${link.getAttribute('href')}?consent=1`);
      });
    });

    // ---- Updated terms prompt (accounts created before the policies, or after a policy change) ----
    document.getElementById('consent-modal-accept').addEventListener('click', async () => {
      const status = document.getElementById('status-consent-modal');
      if (!document.getElementById('consent-modal-check').checked) { setFieldStatus(status, 'Please tick the box to agree.', 'error'); return; }
      try {
        await Api.post('/api/account/consent', { accept: true });
        Auth.consentRequired = false;
        document.getElementById('consent-modal').close();
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      }
    });
    document.getElementById('consent-modal-logout').addEventListener('click', () => {
      document.getElementById('consent-modal').close();
      Auth.logout();
      document.getElementById('auth-modal').showModal();
    });

    // ---- Privacy & data: download / delete ----
    const privacyStatus = document.getElementById('status-profile-privacy');
    document.getElementById('profile-download-data').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      setFieldStatus(privacyStatus, '', '');
      try {
        const res = await fetch('/api/account/export', { credentials: 'same-origin' });
        if (!res.ok) {
          let message = 'Could not download your data. Try again.';
          try { message = (await res.json()).error || message; } catch { /* non-JSON error */ }
          throw new Error(message);
        }
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pomodoro-focus-my-data.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setFieldStatus(privacyStatus, 'Downloaded. Your timer, tasks and stats live only in this browser and are not in the file.', 'success');
      } catch (err) {
        setFieldStatus(privacyStatus, err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    const deleteModal = document.getElementById('delete-account-modal');
    const deleteInput = document.getElementById('delete-account-input');
    const deleteStatus = document.getElementById('status-delete-account');
    document.getElementById('profile-delete-account').addEventListener('click', () => {
      const usesPassword = Auth.passwordLogin;
      document.getElementById('delete-account-label').textContent = usesPassword ? 'Enter your password to confirm' : `Type your username (${Auth.currentUser.username}) to confirm`;
      deleteInput.type = usesPassword ? 'password' : 'text';
      deleteInput.autocomplete = usesPassword ? 'current-password' : 'off';
      deleteInput.value = '';
      setFieldStatus(deleteStatus, '', '');
      document.getElementById('profile-modal').close();
      deleteModal.showModal();
      deleteInput.focus();
    });
    document.getElementById('delete-account-cancel').addEventListener('click', () => deleteModal.close());
    deleteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('delete-account-confirm').click(); } });
    document.getElementById('delete-account-confirm').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const value = deleteInput.value;
      if (!value) { setFieldStatus(deleteStatus, Auth.passwordLogin ? 'Enter your password.' : 'Type your username.', 'error'); return; }
      btn.disabled = true;
      setFieldStatus(deleteStatus, '', '');
      try {
        await Api.post('/api/account/delete', Auth.passwordLogin ? { password: value } : { confirmUsername: value });
        Auth._markSignedOut();
        Socket.connect();
        deleteInput.value = '';
        deleteModal.close();
        UI.syncAuthUI();
        showToast('Your account and data were deleted.');
      } catch (err) {
        setFieldStatus(deleteStatus, err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    // Covers every way the dialog can close (Escape, backdrop click, the × equivalents
    // above) -- not just the explicit success paths that already call this directly --
    // so a half-finished forgot-password attempt never lingers into the next open.
    document.getElementById('auth-modal').addEventListener('close', clearAuthModalInputs);

    // ---- Forgot password / username ----
    document.getElementById('auth-forgot-password-link').addEventListener('click', () => ForgotPassword.start('password'));
    document.getElementById('auth-forgot-username-link').addEventListener('click', () => ForgotPassword.start('username'));
    document.getElementById('auth-forgot1-back').addEventListener('click', () => ForgotPassword.backToLogin());
    document.getElementById('auth-forgot2-back').addEventListener('click', () => ForgotPassword.backToLogin());
    document.getElementById('auth-forgot3-back').addEventListener('click', () => ForgotPassword.backToLogin());
    document.getElementById('auth-forgot1-submit').addEventListener('click', () => ForgotPassword.submitStep1());
    document.getElementById('auth-forgot2-submit').addEventListener('click', () => ForgotPassword.submitStep2());
    document.getElementById('auth-forgot2-resend').addEventListener('click', () => ForgotPassword.resend());
    document.getElementById('auth-forgot3-submit').addEventListener('click', () => ForgotPassword.submitStep3());

    // 6-digit code boxes: typing a digit auto-advances to the next box, Backspace on an
    // empty box steps back to the previous one, arrow keys move between boxes, and
    // pasting a full 6-digit code (e.g. from a phone's "copy code" suggestion) fills
    // every box at once and focuses the last one.
    const codeBoxes = Array.from(document.querySelectorAll('.auth-code-box'));
    codeBoxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(-1);
        if (box.value && i < codeBoxes.length - 1) codeBoxes[i + 1].focus();
      });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !box.value && i > 0) { codeBoxes[i - 1].focus(); codeBoxes[i - 1].value = ''; e.preventDefault(); }
        else if (e.key === 'ArrowLeft' && i > 0) { codeBoxes[i - 1].focus(); e.preventDefault(); }
        else if (e.key === 'ArrowRight' && i < codeBoxes.length - 1) { codeBoxes[i + 1].focus(); e.preventDefault(); }
      });
      box.addEventListener('paste', (e) => {
        const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        digits.split('').forEach((d, j) => { if (codeBoxes[j]) codeBoxes[j].value = d; });
        (codeBoxes[digits.length - 1] || codeBoxes[codeBoxes.length - 1]).focus();
      });
    });

    // Show/hide toggles for the two new-password fields in Step 3.
    [['auth-forgot-new-password', 'auth-forgot-new-password-toggle'], ['auth-forgot-confirm-password', 'auth-forgot-confirm-password-toggle']]
      .forEach(([inputId, btnId]) => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(btnId);
        btn.innerHTML = Icons.eye;
        btn.addEventListener('click', () => {
          const showing = input.type === 'text';
          input.type = showing ? 'password' : 'text';
          btn.innerHTML = showing ? Icons.eye : Icons.eyeOff;
          btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
          btn.setAttribute('aria-pressed', String(!showing));
          input.focus();
        });
      });

    // Enter submits whichever of the five auth-modal views is currently visible --
    // the form itself can't do this natively since every one of its buttons is
    // type="button" (so a native implicit submit, which would just close the
    // method="dialog" form without saving anything, never fires) and Escape
    // already closes the dialog natively (see UI.initDialogCoordination).
    document.querySelector('.auth-modal__form').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      e.preventDefault();
      if (!document.getElementById('auth-panel-login').hidden) document.getElementById('auth-login-submit').click();
      else if (!document.getElementById('auth-panel-signup').hidden) document.getElementById('auth-signup-submit').click();
      else if (!document.getElementById('auth-panel-forgot1').hidden) document.getElementById('auth-forgot1-submit').click();
      else if (!document.getElementById('auth-panel-forgot2').hidden) document.getElementById('auth-forgot2-submit').click();
      else if (!document.getElementById('auth-panel-forgot3').hidden) document.getElementById('auth-forgot3-submit').click();
    });

    const emojiPickerEl = document.getElementById('profile-modal-emoji-picker');
    Lounge.PROFILE_EMOJI.forEach((emoji) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = emoji;
      btn.setAttribute('aria-label', `Use ${emoji} as your avatar`);
      btn.addEventListener('click', () => {
        UI._pendingAvatarEmoji = emoji;
        UI._pendingAvatarPhoto = null;
        const preview = document.getElementById('profile-modal-pfp-edit-preview');
        preview.style.backgroundImage = '';
        preview.classList.remove('user-profile__avatar--photo');
        preview.textContent = emoji;
        setFieldStatus(document.getElementById('status-profile-upload'), '', '');
      });
      emojiPickerEl.appendChild(btn);
    });

    document.getElementById('profile-upload-btn').addEventListener('click', () => {
      document.getElementById('profile-upload-input').click();
    });
    document.getElementById('profile-upload-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.getElementById('status-profile-upload');
      setFieldStatus(status, 'Loading…', '');
      const result = await MediaService.validateLocalFile(file, 'image');
      if (!result.ok) { setFieldStatus(status, result.reason, 'error'); return; }
      UI._pendingAvatarPhoto = file;
      UI._pendingAvatarEmoji = null;
      const previewUrl = ObjectURLRegistry.set('profile-avatar-preview', file);
      const preview = document.getElementById('profile-modal-pfp-edit-preview');
      preview.textContent = '';
      preview.style.backgroundImage = `url(${previewUrl})`;
      setFieldStatus(status, 'Looks good', 'success');
    });
    document.getElementById('profile-remove-photo-btn').addEventListener('click', () => {
      UI._pendingAvatarPhoto = 'remove';
      UI._pendingAvatarEmoji = null;
      const preview = document.getElementById('profile-modal-pfp-edit-preview');
      preview.style.backgroundImage = '';
      preview.textContent = (state.profile.username.trim().charAt(0).toUpperCase() || 'Y');
      setFieldStatus(document.getElementById('status-profile-upload'), 'Photo will be removed on Save.', '');
    });

    document.getElementById('profile-edit-save').addEventListener('click', async () => {
      const username = document.getElementById('profile-edit-username').value.trim().slice(0, 24) || 'You';
      const bio = document.getElementById('profile-edit-bio').value.trim().slice(0, 160);
      let { avatar, localAvatarId } = state.profile;

      if (UI._pendingAvatarPhoto === 'remove') {
        if (localAvatarId != null) await LocalMediaDB.delete(localAvatarId);
        localAvatarId = null;
        state.profile._avatarUrl = null;
        ObjectURLRegistry.revoke('profile-avatar');
      } else if (UI._pendingAvatarPhoto instanceof File) {
        if (localAvatarId != null) await LocalMediaDB.delete(localAvatarId);
        localAvatarId = await LocalMediaDB.save('image', UI._pendingAvatarPhoto);
        const record = await LocalMediaDB.get(localAvatarId);
        state.profile._avatarUrl = ObjectURLRegistry.set('profile-avatar', record.blob);
        ObjectURLRegistry.revoke('profile-avatar-preview');
      } else if (UI._pendingAvatarEmoji) {
        avatar = UI._pendingAvatarEmoji;
        if (localAvatarId != null) await LocalMediaDB.delete(localAvatarId);
        localAvatarId = null;
        state.profile._avatarUrl = null;
        ObjectURLRegistry.revoke('profile-avatar');
      }

      state.profile = { ...state.profile, username, bio, avatar, localAvatarId };
      Storage.saveProfile(state.profile);

      if (Auth.isLoggedIn()) {
        const avatarUrl = document.getElementById('profile-edit-avatar-url').value.trim();
        try {
          const { user } = await Api.patch('/api/auth/me', { displayName: username, bio, avatar, avatarUrl });
          Auth.currentUser = user;
        } catch (err) {
          setFieldStatus(document.getElementById('status-profile-upload'), err.message, 'error');
          return; // leave the edit form open so the user can see the error and retry
        }
      }

      UI._pendingAvatarPhoto = null;
      UI._pendingAvatarEmoji = null;
      UI.renderProfile();
      UI.syncAuthUI();
      document.getElementById('profile-modal-view').hidden = false;
      document.getElementById('profile-modal-edit').hidden = true;
      document.getElementById('profile-modal').close();
    });

    document.getElementById('ai-chat-goto-settings').addEventListener('click', () => {
      UI.openSettings();
      UI.selectSettingsTab('ai');
      document.getElementById('setting-ai-api-key').focus();
    });

    document.getElementById('ai-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('ai-chat-input');
      const text = input.value;
      input.value = '';
      AIChat.sendMessage(text);
    });
    document.getElementById('ai-key-clear').addEventListener('click', () => {
      state.chatSettings = { apiKey: '' };
      Storage.saveChatSettings(state.chatSettings);
      document.getElementById('setting-ai-api-key').value = '';
      setFieldStatus(document.getElementById('status-ai-api-key'), 'API key removed.', 'success');
      UI.renderChat();
    });

    document.getElementById('timer-toggle').addEventListener('click', () => {
      state.timer.running ? Timer.pause() : Timer.start();
    });
    document.getElementById('timer-reset').addEventListener('click', () => Timer.reset());
    document.getElementById('timer-skip').addEventListener('click', () => Timer.skip());

    const MODE_TAB_ORDER = ['pomodoro', 'shortBreak', 'longBreak'];
    MODE_TAB_ORDER.forEach((m) => {
      document.getElementById(`mode-tab-${m}`).addEventListener('click', () => Timer.switchMode(m));
    });
    document.querySelector('.mode-tabs').addEventListener('keydown', (e) => {
      const idx = MODE_TAB_ORDER.indexOf(document.activeElement.id.replace('mode-tab-', ''));
      if (idx === -1) return;
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % MODE_TAB_ORDER.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + MODE_TAB_ORDER.length) % MODE_TAB_ORDER.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = MODE_TAB_ORDER.length - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        const mode = MODE_TAB_ORDER[nextIdx];
        Timer.switchMode(mode);
        document.getElementById(`mode-tab-${mode}`).focus();
      }
    });

    document.getElementById('task-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('task-input');
      const estimate = document.getElementById('task-estimate');
      const priority = document.getElementById('task-priority');
      const project = document.getElementById('task-project');
      if (Planner.addTask(input.value, estimate.value, priority.value, project.value)) {
        input.value = '';
        estimate.value = '1';
        priority.value = '';
        project.value = '';
        input.focus();
      }
    });

    document.getElementById('settings-btn').addEventListener('click', () => UI.openSettings());
    document.getElementById('settings-close').addEventListener('click', () => UI.closeSettings());
    document.getElementById('settings-form').addEventListener('submit', (e) => UI.saveSettingsFromForm(e));
    document.getElementById('setting-bg-type').addEventListener('change', (e) => UI.toggleBgFields(e.target.value));

    document.getElementById('preview-bg-image-url').addEventListener('click', () => UI.previewBackgroundUrl('image'));
    document.getElementById('preview-bg-video-url').addEventListener('click', () => UI.previewBackgroundUrl('video'));
    document.getElementById('preview-bg-youtube-url').addEventListener('click', () => UI.previewYoutubeUrl());

    ['image', 'video'].forEach((kind) => {
      const suffix = kind === 'image' ? 'image' : 'video';
      document.getElementById(`choose-local-bg-${suffix}`).addEventListener('click', () => UI.handleLocalMediaChoice(kind));
      document.getElementById(`replace-local-bg-${suffix}`).addEventListener('click', () => UI.handleLocalMediaChoice(kind));
      document.getElementById(`remove-local-bg-${suffix}`).addEventListener('click', () => UI.removeLocalMedia(kind));
      document.getElementById(`local-bg-${suffix}-input`).addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        UI.handleLocalMediaFile(kind, file);
      });
    });

    SETTINGS_TABS.forEach((t) => {
      document.getElementById(`tab-${t}`).addEventListener('click', () => UI.selectSettingsTab(t));
    });
    document.querySelector('.settings-tabs').addEventListener('keydown', (e) => {
      const idx = SETTINGS_TABS.indexOf(document.activeElement.id.replace('tab-', ''));
      if (idx === -1) return;
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % SETTINGS_TABS.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = SETTINGS_TABS.length - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        const id = SETTINGS_TABS[nextIdx];
        UI.selectSettingsTab(id);
        document.getElementById(`tab-${id}`).focus();
      }
    });

    document.getElementById('media-play').addEventListener('click', () => {
      const c = Media.getActiveController();
      if (!c) return;
      if (c.isPlaying()) c.pause(); else c.play();
      setTimeout(UI.syncMediaControls, 60);
    });
    document.getElementById('media-mute').addEventListener('click', () => {
      const c = Media.getActiveController();
      state.mediaSettings.muted = !state.mediaSettings.muted;
      if (c) c.setMuted(state.mediaSettings.muted);
      Storage.saveMediaSettings(state.mediaSettings);
      UI.syncMediaControls();
    });
    document.getElementById('media-volume').addEventListener('input', (e) => {
      const c = Media.getActiveController();
      const vol = Number(e.target.value);
      state.mediaSettings.volume = vol / 100;
      if (c) c.setVolume(vol);
      Storage.saveMediaSettings(state.mediaSettings);
    });

    // ---- Music tab ----
    const trackList = document.getElementById('music-track-list');
    BUILTIN_TRACKS.forEach((track) => {
      const li = document.createElement('li');
      li.dataset.id = track.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const name = document.createElement('span');
      name.textContent = track.name;
      const category = document.createElement('span');
      category.className = 'track__category';
      category.textContent = track.category;
      li.append(name, category);
      const activate = async () => {
        state.musicSettings.source = 'builtin';
        state.musicSettings.builtinTrackId = track.id;
        Storage.saveMusicSettings(state.musicSettings);
        const wasPlaying = MusicPlayer.isPlaying();
        await MusicPlayer.selectBuiltin(track.id);
        if (wasPlaying) MusicPlayer.play();
        UI.renderMusicUI();
      };
      li.addEventListener('click', activate);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
      trackList.appendChild(li);
    });

    document.getElementById('setting-music-source').addEventListener('change', (e) => {
      UI.toggleMusicSourceFields(e.target.value);
    });

    document.getElementById('preview-music-url').addEventListener('click', async () => {
      const url = document.getElementById('setting-music-url').value.trim();
      const status = document.getElementById('status-music-url');
      if (!url) { setFieldStatus(status, 'Please enter a valid URL.', 'error'); return; }
      setFieldStatus(status, 'Loading…', '');
      const result = await MediaService.loadAudioFromUrl(url);
      if (!result.ok) { setFieldStatus(status, result.reason, 'error'); return; }
      setFieldStatus(status, 'Looks good', 'success');
    });

    document.getElementById('choose-local-music').addEventListener('click', () => {
      document.getElementById('local-music-input').click();
    });
    document.getElementById('local-music-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const status = document.getElementById('status-local-music');
      setFieldStatus(status, 'Loading…', '');
      const result = await MediaService.validateLocalFile(file, 'audio');
      if (!result.ok) { setFieldStatus(status, result.reason, 'error'); return; }
      setFieldStatus(status, 'Looks good', 'success');
      document.getElementById('name-local-music').textContent = file.name;
      UI._pendingLocalAudio = file;
    });
    document.getElementById('remove-local-music').addEventListener('click', async () => {
      UI._pendingLocalAudio = null;
      document.getElementById('name-local-music').textContent = '';
      document.getElementById('status-local-music').textContent = '';
      if (state.musicSettings.source === 'upload' && state.musicSettings.localAudioId != null) {
        await LocalMediaDB.delete(state.musicSettings.localAudioId);
        state.musicSettings = { ...state.musicSettings, source: 'builtin', localAudioId: null };
        Storage.saveMusicSettings(state.musicSettings);
        MusicPlayer._teardownBuiltin();
        musicAudioEl.pause();
        MusicPlayer._mode = null;
        UI.renderMusicUI();
      }
    });

    document.getElementById('music-play').addEventListener('click', () => {
      if (MusicPlayer.isPlaying()) { MusicPlayer.pause(); } else { MusicPlayer.play(); UI._musicRAF = requestAnimationFrame(UI._musicProgressTick); }
      setTimeout(UI.renderMusicUI, 60);
    });
    document.getElementById('music-prev').addEventListener('click', () => { MusicPlayer.prev(); });
    document.getElementById('music-next').addEventListener('click', () => { MusicPlayer.next(); });
    document.getElementById('music-volume').addEventListener('input', (e) => {
      MusicPlayer.setVolume(Number(e.target.value));
    });
    document.getElementById('music-mute').addEventListener('click', () => {
      MusicPlayer.setMuted(!state.musicSettings.muted);
      UI.renderMusicUI();
      UI.renderMuteToggle();
    });
    document.getElementById('music-loop').addEventListener('click', () => {
      MusicPlayer.setLoop(!state.musicSettings.loop);
      UI.renderMusicUI();
    });

    // ---- Appearance tab ----
    document.getElementById('setting-theme-preset').addEventListener('change', (e) => {
      Theme.applyPreset(e.target.value);
      UI.renderAppearanceUI();
    });
    document.getElementById('reset-theme').addEventListener('click', () => {
      Theme.resetToDefault();
      UI.renderAppearanceUI();
    });
    APPEARANCE_KEYS.forEach((key) => {
      const colorInput = document.getElementById(`color-${key}`);
      const hexInput = document.getElementById(`hex-${key}`);
      colorInput.addEventListener('input', (e) => { Theme.setColor(key, e.target.value); UI.renderAppearanceUI(); });
      hexInput.addEventListener('change', (e) => {
        const v = e.target.value.trim();
        if (!hexToRgb(v)) { UI.renderAppearanceUI(); return; }
        Theme.setColor(key, v);
        UI.renderAppearanceUI();
      });
    });

    // ---- Study Lounge ----
    document.getElementById('lounge-create-room-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isLoggedIn()) return;
      const goalInput = document.getElementById('lounge-goal-input');
      const status = document.getElementById('status-lounge-join');
      try {
        await Lounge.createRoom(goalInput.value);
        goalInput.value = '';
        setFieldStatus(status, '', '');
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      }
    });
    document.getElementById('lounge-join-room-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!Auth.isLoggedIn()) return;
      const codeInput = document.getElementById('lounge-join-code-input');
      const status = document.getElementById('status-lounge-join');
      try {
        const ok = await Lounge.joinRoom(codeInput.value);
        if (ok) { codeInput.value = ''; setFieldStatus(status, '', ''); }
        else setFieldStatus(status, 'Please enter a room code.', 'error');
      } catch (err) {
        setFieldStatus(status, err.message, 'error');
      }
    });
    document.getElementById('lounge-copy-code').addEventListener('click', () => {
      const code = state.lounge.room ? state.lounge.room.code : '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).catch(() => {});
      }
    });
    document.getElementById('lounge-leave-room').addEventListener('click', () => {
      Lounge.leaveRoom();
    });
    document.getElementById('lounge-chip').addEventListener('click', () => UI.selectView('lounge'));
    const more = document.getElementById('header-more');
    const moreToggle = document.getElementById('header-more-toggle');
    const setMore = (open) => { more.classList.toggle('is-open', open); moreToggle.setAttribute('aria-expanded', String(open)); };
    moreToggle.addEventListener('click', (e) => { e.stopPropagation(); setMore(!more.classList.contains('is-open')); });
    document.addEventListener('click', (e) => { if (!more.contains(e.target)) setMore(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMore(false); });
    document.getElementById('header-more-menu').addEventListener('click', () => setMore(false));

    // ---- Leaderboard range ----
    [['daily', 'leaderboard-tab-daily'], ['weekly', 'leaderboard-tab-weekly'], ['alltime', 'leaderboard-tab-alltime']].forEach(([range, id]) => {
      document.getElementById(id).addEventListener('click', () => {
        Leaderboard.range = range;
        ['leaderboard-tab-daily', 'leaderboard-tab-weekly', 'leaderboard-tab-alltime'].forEach((tid) => {
          const active = tid === id;
          document.getElementById(tid).setAttribute('aria-selected', String(active));
          document.getElementById(tid).tabIndex = active ? 0 : -1;
        });
        Leaderboard.refresh();
      });
    });

    // ---- Friends drawer ----
    const openFriendsDrawer = () => {
      closeNotifMenu();
      document.getElementById('friends-drawer').hidden = false;
      document.getElementById('friends-drawer-backdrop').hidden = false;
    };
    const closeFriendsDrawer = () => {
      document.getElementById('friends-drawer').hidden = true;
      document.getElementById('friends-drawer-backdrop').hidden = true;
    };
    document.getElementById('friends-drawer-toggle').addEventListener('click', openFriendsDrawer);
    document.getElementById('lounge-manage-friends-btn').addEventListener('click', openFriendsDrawer);
    document.getElementById('friends-drawer-close').addEventListener('click', closeFriendsDrawer);
    document.getElementById('friends-drawer-backdrop').addEventListener('click', closeFriendsDrawer);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('friends-drawer').hidden) closeFriendsDrawer();
    });
    document.getElementById('friends-drawer-login-btn').addEventListener('click', () => {
      closeFriendsDrawer();
      document.getElementById('auth-modal').showModal();
    });
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


    UI.renderLoungeFriends();

    UI.renderAppearanceUI();
  },
};

document.addEventListener('DOMContentLoaded', () => UI.init());
