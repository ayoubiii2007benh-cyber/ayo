# Media / Music / Appearance Upgrade — Design Spec

**Status:** Approved by user in conversation 2026-09-22. Applies to the existing `index.html` (single-file vanilla HTML/CSS/JS Pomodoro + Planner app, no build step, no git repo). This spec is additive — it extends the existing `state`/`Storage`/`Timer`/`Planner`/`Media`/`YouTube`/`UI` architecture; nothing existing is rewritten from scratch.

## 0. Root cause (Step 2 of the request)

Read from the current `index.html`:

- `Media.isSafeHttpsUrl()` (line ~847) requires `protocol === 'https:'` strictly — any `http://` URL is silently rejected.
- The video branch of `Media.applyBackground()` (line ~891) only accepts a URL whose **pathname literally ends in `.mp4` or `.webm`** — it never attempts to load the resource. A signed CDN URL, a URL with query params after the extension, or an extensionless direct-video link is rejected without ever being tried.
- On rejection, both branches silently call `Media.applyDefaultBackground()` — there is **no error state, no message, no feedback** shown to the user anywhere. It just quietly reverts to default.

Fix: stop gatekeeping on extension/scheme alone; actually attempt to load the resource (real `Image`/`<video>` load), and surface loading/success/error states in the UI instead of failing silently.

## 1. New/changed data shapes

```js
// mediaSettings (existing key "mediaSettings", extended)
{
  type: 'default' | 'image' | 'video' | 'youtube' | 'localImage' | 'localVideo',
  imageUrl: '', videoUrl: '', youtubeId: '', playbackMode: 'background' | 'audio',
  volume: 0.5, muted: false,
  localImageId: null,   // IndexedDB record id (number) or null
  localVideoId: null,
}

// musicSettings — NEW localStorage key "musicSettings"
{
  enabled: false,
  source: 'builtin' | 'url' | 'upload',
  builtinTrackId: '',      // one of BUILTIN_TRACKS ids
  audioUrl: '',
  localAudioId: null,      // IndexedDB record id or null
  volume: 0.5,
  muted: false,
  loop: true,
}

// themeSettings — NEW localStorage key "themeSettings"
{
  preset: 'default',       // one of THEME_PRESETS ids, or 'custom' once user edits a color
  colors: {
    bg, surface, text, textMuted, border,
    primary, accentPomodoro, accentShortBreak, accentLongBreak,
    success, warning, danger,
  } // all hex strings; only keys that differ from the active preset need be present,
    // but we always persist the full resolved map for simplicity
    // NOTE: "primary" is the general action color (Add Task / Settings Save / active-task highlight).
    // It is distinct from the 3 accentX timer-mode colors, which keep driving the Timer card's own
    // identity exactly as today (html[data-mode] switches which --accent-* is active).
}
```

IndexedDB (new): database `pomodoroLocalMedia`, version `1`, one object store `files` (`keyPath: 'id', autoIncrement: true`), records:
```js
{ id, kind: 'image' | 'video' | 'audio', name, mimeType, size, blob, createdAt }
```

## 2. MediaService (new namespace, `<script>` addition)

Real-load verification, replacing extension/scheme-only gatekeeping:

```js
MediaService.loadImageFromUrl(url) -> Promise<{ok: true} | {ok: false, reason}>
MediaService.loadVideoFromUrl(url) -> Promise<{ok: true} | {ok: false, reason}>
MediaService.loadAudioFromUrl(url) -> Promise<{ok: true, duration} | {ok: false, reason}>
MediaService.isAllowedUrl(url) -> boolean   // scheme in {http:, https:} only, replaces isSafeHttpsUrl
MediaService.validateLocalFile(file, kind) -> Promise<{ok:true}|{ok:false, reason}>
  // kind: 'image'|'video'|'audio'
  // checks file.type MIME prefix, checks size against caps (image 15MB, video 50MB, audio 30MB),
  // then attempts a real decode: Image() for image, loadedmetadata on a detached <video>/<audio> for video/audio
```

`reason` is always one of the exact user-facing strings from spec Step 25 (see §7).

`Media.applyBackground()` is rewritten to call `MediaService.loadImageFromUrl`/`loadVideoFromUrl` before committing to a new background, and to handle `localImage`/`localVideo` types by resolving the blob via `LocalMediaDB.get()` and creating an object URL through `ObjectURLRegistry`.

## 3. Local file persistence

```js
LocalMediaDB.save(kind, file) -> Promise<id>
LocalMediaDB.get(id) -> Promise<record|null>
LocalMediaDB.delete(id) -> Promise<void>
LocalMediaDB.open() -> Promise<IDBDatabase>   // memoized, opens/upgrades once

ObjectURLRegistry.set(slot, blob) -> string   // revokes previous URL for that slot, creates+returns new one
ObjectURLRegistry.revoke(slot)
// slots used: 'bg-image', 'bg-video', 'music-audio'
```

On boot, `State.init()` additionally resolves any `localImageId`/`localVideoId`/`localAudioId` present in persisted settings into fresh object URLs before `Media.applyBackground()`/music restore runs, since blob URLs never survive a reload.

Settings UI for uploads (Background tab, Music tab): `[Choose Image/Video/Audio]` button triggers a hidden `<input type="file" accept="...">`; on `change`, run `MediaService.validateLocalFile`, show loading → preview/error, and only write to `LocalMediaDB` + state on an explicit action (auto-apply on successful validation, consistent with existing Save flow — see §6). Replace/Remove buttons call `LocalMediaDB.delete` on the old record and `ObjectURLRegistry.revoke`.

## 4. Background music engine

**Built-in library** — procedurally generated via Web Audio, pre-rendered once per track into a loopable `AudioBuffer` using `OfflineAudioContext`, then played through a real-time `AudioBufferSourceNode(loop=true) -> GainNode -> destination`. Honest labels (not claiming genres that can't be genuinely produced without samples):

```js
BUILTIN_TRACKS = [
  { id: 'rain',        name: 'Rain',                category: 'Nature',   durationSec: 45, gen: genRain },
  { id: 'white-noise',  name: 'White Noise',          category: 'Noise',    durationSec: 30, gen: genWhiteNoise },
  { id: 'deep-focus',   name: 'Deep Focus',           category: 'Noise',    durationSec: 30, gen: genBrownNoise },
  { id: 'ambient-pad',  name: 'Ambient Pad',          category: 'Ambient',  durationSec: 60, gen: genAmbientPad },
  { id: 'soft-tones',   name: 'Soft Tones',           category: 'Calm',     durationSec: 50, gen: genSoftTones },
  { id: 'warm-focus',   name: 'Warm Focus',           category: 'Ambient',  durationSec: 55, gen: genWarmFocus },
];
```
Each `gen(offlineCtx)` fills the offline context's destination via oscillators/filtered-noise (same technique family as the existing `SoundFX.playCompletionSound`). Rendering happens once, lazily, on first selection (cached in memory per track id for the session — not persisted, regenerated each load, this is cheap — under ~100ms per track).

**Player engine** (new `MusicPlayer` namespace), fully independent of `Timer`/`Media`:
```js
MusicPlayer.selectBuiltin(trackId)
MusicPlayer.selectUrl(url) -> Promise<{ok, reason?}>     // via MediaService.loadAudioFromUrl
MusicPlayer.selectUpload(file) -> Promise<{ok, reason?}>  // via MediaService.validateLocalFile + LocalMediaDB
MusicPlayer.play() / pause() / next() / prev()   // next/prev only enabled for source:'builtin'
MusicPlayer.setVolume(0-100) / setMuted(bool) / setLoop(bool)
MusicPlayer.getProgress() -> { currentSec, durationSec }
```
Backed by one persistent `<audio>` element (module-level `const musicAudioEl = new Audio();`, created once, `src` swapped for url/upload sources) OR the Web Audio buffer-source graph for builtin tracks — the player UI (`#music-play`, `#music-prev`, `#music-next`, `#music-progress`, `#music-volume`, `#music-mute`, `#music-loop`) talks only to `MusicPlayer`'s public methods, never to the underlying engine directly, so the UI code doesn't care which engine is active.

Progress bar for builtin tracks uses the same timestamp-math pattern as `Timer.tick()` (`audioContext.currentTime` delta since track start, modulo `durationSec`), updated on a `requestAnimationFrame` loop while playing (not `setInterval`, since this is purely visual and RAF is cheaper/auto-pauses when tab is hidden — no drift-sensitivity concern here since it's decorative UI, not a timer).

## 5. Appearance / theming

Existing CSS variable names are kept (`--bg`, `--surface`, `--text`, `--text-muted`, `--border`, `--accent`, `--accent-soft`) — already fully centralized, no hardcoded colors to refactor. New tokens added to `:root`: `--success: #2f9e57`, `--warning: #c98a1f`, `--danger: #c0392b`. `--primary-hover` and `--surface-glass` become **computed** (not static `:root` entries) — `Theme.apply()` sets them via `style.setProperty` derived from the chosen `primary`/`surface` colors (lighten/darken via HSL shift for hover; surface RGB + alpha for glass).

`html[data-mode="shortBreak"]`/`["longBreak"]` accent overrides remain the mechanism for per-mode timer color — `Theme.apply()` writes `--accent-pomodoro`/`--accent-shortBreak`/`--accent-longBreak` custom properties and the existing `[data-mode]` selectors are extended to reference them (`html[data-mode="shortBreak"] { --accent: var(--accent-shortBreak); }` etc.), so mode-switching continues to work exactly as today, just now themeable. `--accent-soft` (today a hardcoded light tint per mode, used for the active-task highlight background) becomes computed the same way as `--surface-glass`/`--primary-hover`: `Theme.apply()` derives it per active mode as the accent color mixed toward white (~85%), so it never needs its own preset entries.

`Theme` namespace:
```js
Theme.PRESETS = { default: {...}, midnight: {...}, ocean: {...}, forest: {...}, sunset: {...},
                   lavender: {...}, minimal: {...}, cyberpunk: {...}, warm: {...}, monochrome: {...} }
  // each preset is a full concrete hex map for all keys in themeSettings.colors
Theme.apply(colors)         // writes every CSS var + derived vars, does NOT touch state/persistence
Theme.applyPreset(id)       // colors = PRESETS[id]; state.themeSettings = {preset:id, colors}; save; apply
Theme.setColor(key, hex)    // state.themeSettings = {preset:'custom', colors:{...prev, [key]:hex}}; save; apply
Theme.resetToDefault()      // same as applyPreset('default')
Theme.contrastRatio(hexA, hexB) -> number   // WCAG relative-luminance formula
Theme.checkContrastWarnings() -> string[]   // human-readable warnings where ratio < 4.5, non-blocking
```

Only 3 existing selectors currently read `--accent` for non-timer-card purposes: `#task-form button` (Add Task), `#settings-save`, and `.task--active` (border + `--accent-soft` background). These 3 move to a new `--primary`/`--primary-soft` pair driven by `themeSettings.colors.primary`, so "Add Task"/"Save" get a stable, independently customizable color while the Timer card keeps its own distinct per-mode identity via the existing `--accent` mechanism (now themeable through the 3 `accentX` keys). `.icon-btn` hover and the global `:focus-visible` outline keep using `--accent` unchanged (existing behavior, still valid since `--accent` still exists and still switches with mode).

`Theme.PRESETS.default` is exactly today's current palette (so "Default" preset and factory Reset are identical and regression-safe): `bg:#faf7f5, surface:#ffffff, text:#241f1c, textMuted:#7a716c, border-base:#241f1c@9%, primary:#e0654f, accentPomodoro:#e0654f, accentShortBreak:#2f9e8f, accentLongBreak:#5b53a6, success:#2f9e57, warning:#c98a1f, danger:#c0392b`.

## 6. Settings dialog restructure

`dialog#settings` gains a tab bar as its first child inside the form:
```html
<div role="tablist" aria-label="Settings sections">
  <button role="tab" id="tab-timer" aria-controls="panel-timer" aria-selected="true">Timer</button>
  <button role="tab" id="tab-background" aria-controls="panel-background" aria-selected="false">Background</button>
  <button role="tab" id="tab-music" aria-controls="panel-music" aria-selected="false">Music</button>
  <button role="tab" id="tab-appearance" aria-controls="panel-appearance" aria-selected="false">Appearance</button>
</div>
```
Each existing fieldset group is wrapped in `<div role="tabpanel" id="panel-timer" aria-labelledby="tab-timer">` (hidden via the existing `[hidden]` CSS rule when not active). `UI.selectSettingsTab(id)` sets `aria-selected`/`hidden`/`tabIndex` per the APG tabs pattern; arrow-key navigation moves focus + selects between tabs; `Home`/`End` jump to first/last. All 4 panels live inside the one `dialog#settings` — no new dialog element, no new top-level persistence key beyond `themeSettings`/`musicSettings` already listed.

Background tab's type `<select>` gains two new options `localImage` ("Upload Image") and `localVideo` ("Upload Video"), each revealing a file-picker row via the existing `UI.toggleBgFields`-style show/hide pattern, extended to 6 rows total.

Preview flow (Background & Music URL/upload rows): a `[Preview]` button next to each URL input (and automatically on file selection) calls the relevant `MediaService`/`MusicPlayer` validation method, showing inline state text (`Loading…` → `Looks good ✓` / the exact error string) beside the field. Save re-validates if the field changed since last successful preview and was never previewed, so Save can never silently apply an untested URL.

## 7. Error messages (verbatim, per spec Step 25)

```
"Please enter a valid URL."
"This media format is not supported by your browser."
"Unable to load this image. Check the URL or choose another file."
"Unable to load this video. Make sure the URL points directly to a supported video file."
"Unable to load this YouTube video. Check the URL."
"This file could not be loaded. Please choose another file."
"Your browser blocked autoplay. Start playback manually."
```
Plus one CORS-specific addition (§8): `"Unable to load this media. The link may be broken, blocked by its source, or not a direct media file. Try a different URL or upload the file instead."`

## 8. Security & CORS

- Scheme allowlist for all URL-based media: `http:`/`https:` only (never `javascript:`, `data:`, `file:`, `blob:` from user input).
- No `innerHTML`/`insertAdjacentHTML` introduced anywhere new; filenames/track names/error text via `textContent`.
- Local SVG uploads render only via `<img src="blob:...">`, never inline-injected or via `<object>`/`<iframe>` — browsers do not execute `<script>` embedded in an SVG loaded this way, so this stays safe without needing to sanitize SVG XML.
- YouTube stays restricted to `youtube.com`/`youtu.be` hostnames for ID extraction, iframe `src` always built as `https://www.youtube.com/embed/<validated-11-char-id>` — never an arbitrary origin.
- No proxy, no API keys, no bypassing CORS — a cross-origin load failure (which JS cannot distinguish from a 404 due to the browser's opaque-failure security model) surfaces the honest generic message above rather than pretending to know the cause.
- Client-side size caps prevent pathological memory use from uploads; `LocalMediaDB` writes are wrapped to catch `QuotaExceededError` and surface it as a normal error state, not a crash.

## 9. Non-goals / known limitations (stated upfront, not discovered later)

- No "Website Skill Tracker" exists in this environment's skill set — not used; noted in the final report instead of pretending.
- Built-in "music" is procedurally generated ambient/noise, not produced/licensed music tracks — labeled honestly (§4), per user's explicit choice.
- CORS failures cannot be distinguished from other load failures by browser-exposed JS APIs — the error message says so rather than guessing.
- IndexedDB-backed uploads persist per-browser-profile only (same as `localStorage` already does for everything else) — not synced across devices; UI will label uploaded media as "stored in this browser."

## 10. Regression guarantees (Step 30)

Every existing exported function/behavior (`Timer.*`, `Planner.*`, `Storage.*` for the 4 existing keys, `Media.applyBackground` public contract, `YouTube.*`, existing settings fields, existing keyboard/task flows) keeps its current signature and behavior. New code is additive: new namespaces (`MediaService`, `LocalMediaDB`, `ObjectURLRegistry`, `MusicPlayer`, `Theme`), new state slices (`musicSettings`, `themeSettings`), new tabs in the same dialog. Background/music/theme changes never call `Timer.reset()` or touch `state.timer`.
