/* Applies the visitor's saved colour theme BEFORE the first paint.

   The theme (a CSS-variable palette plus data-theme / data-theme-preset) is normally applied by the app's own
   script, which loads with `defer` so it can be cached and doesn't block HTML parsing. Without this tiny script
   a browser that paints before that script runs would flash the default (light) colours at someone who chose
   a dark theme. It is deliberately small and synchronous.

   KEEP IN SYNC with Theme.apply / Storage.loadThemeSettings / DEFAULT_THEME_COLORS in assets/app.js: this
   produces the same variables, and the app re-applies the very same values once it has loaded. */
(function () {
  'use strict';
  var DEFAULTS = { bg: '#fdfbf8', surface: '#ffffff', text: '#14100c', textMuted: '#6b625c', border: '#14100c', primary: '#ff5533', accentPomodoro: '#ff5533', accentShortBreak: '#0eb8a0', accentLongBreak: '#7c3aed', success: '#2f9e57', warning: '#c98a1f', danger: '#c0392b' };
  var PRESETS = ['default', 'midnight', 'ocean', 'forest', 'sunset', 'lavender', 'minimal', 'cyberpunk', 'warm', 'monochrome', 'apex', 'lofi', 'coastal', 'terminal', 'deepmesh', 'custom'];

  function hexToRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
  }
  function rgbToHex(c) {
    return '#' + [c.r, c.g, c.b].map(function (x) { return Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0'); }).join('');
  }
  function mix(hexA, hexB, t) {
    var a = hexToRgb(hexA), b = hexToRgb(hexB);
    if (!a || !b) return hexA;
    return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
  }
  function relLuminance(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return 0;
    function chan(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
  }

  var raw = {};
  try { raw = JSON.parse(localStorage.getItem('themeSettings')) || {}; } catch (e) { raw = {}; }
  if (typeof raw !== 'object') raw = {};
  var stored = raw.colors && typeof raw.colors === 'object' ? raw.colors : {};
  var colors = {};
  Object.keys(DEFAULTS).forEach(function (k) { colors[k] = hexToRgb(stored[k]) ? stored[k] : DEFAULTS[k]; });
  var preset = PRESETS.indexOf(raw.preset) >= 0 ? raw.preset : 'default';

  var root = document.documentElement;
  var s = root.style;
  s.setProperty('--bg', colors.bg);
  s.setProperty('--surface', colors.surface);
  s.setProperty('--text', colors.text);
  s.setProperty('--text-muted', colors.textMuted);
  s.setProperty('--border', mix(colors.border, colors.bg, 0.91));
  s.setProperty('--success', colors.success);
  s.setProperty('--warning', colors.warning);
  s.setProperty('--danger', colors.danger);
  s.setProperty('--primary', colors.primary);
  s.setProperty('--primary-hover', mix(colors.primary, '#000000', 0.12));
  s.setProperty('--primary-soft', mix(colors.primary, '#ffffff', 0.85));
  s.setProperty('--accent-pomodoro', colors.accentPomodoro);
  s.setProperty('--accent-shortBreak', colors.accentShortBreak);
  s.setProperty('--accent-longBreak', colors.accentLongBreak);
  s.setProperty('--accent-soft-pomodoro', mix(colors.accentPomodoro, colors.bg, 0.85));
  s.setProperty('--accent-soft-shortBreak', mix(colors.accentShortBreak, colors.bg, 0.85));
  s.setProperty('--accent-soft-longBreak', mix(colors.accentLongBreak, colors.bg, 0.85));
  s.setProperty('--mesh-1', mix(colors.accentPomodoro, colors.bg, 0.3));
  s.setProperty('--mesh-2', mix(colors.accentShortBreak, colors.bg, 0.3));
  s.setProperty('--mesh-3', mix(colors.accentLongBreak, colors.bg, 0.3));
  s.setProperty('--mesh-4', mix(colors.primary, colors.bg, 0.3));
  root.setAttribute('data-theme-preset', preset);
  root.setAttribute('data-theme', relLuminance(colors.bg) < 0.5 ? 'dark' : 'light');
})();
