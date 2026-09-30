/* Makes the legal pages follow the visitor's chosen app theme (saved by the app in localStorage) and
   marks dark themes so the glass tokens switch to their dark values. Falls back silently to the default look. */
(function () {
  'use strict';
  try {
    var raw = localStorage.getItem('themeSettings');
    if (!raw) return;
    var colors = (JSON.parse(raw) || {}).colors;
    if (!colors || typeof colors !== 'object') return;
    var hex = /^#[0-9a-fA-F]{6}$/;
    var map = { bg: '--bg', surface: '--surface', text: '--text', textMuted: '--text-muted', primary: '--primary', accentPomodoro: '--accent-pomodoro', accentShortBreak: '--accent-shortBreak', accentLongBreak: '--accent-longBreak' };
    var root = document.documentElement;
    Object.keys(map).forEach(function (k) { if (typeof colors[k] === 'string' && hex.test(colors[k])) root.style.setProperty(map[k], colors[k]); });
    if (typeof colors.bg === 'string' && hex.test(colors.bg)) {
      var n = parseInt(colors.bg.slice(1), 16);
      var lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
      if (lum < 0.5) root.setAttribute('data-theme', 'dark');
    }
  } catch (e) { /* storage unavailable or malformed: keep defaults */ }
})();
