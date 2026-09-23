# Media / Music / Appearance Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** Same as the original build plan — one evolving file (`index.html`), no test framework, no build step. "Tests" are concrete Playwright browser interactions/assertions run against the file over `http://` (Playwright blocks `file://`), or `node -e` static checks. Prefer inline execution by one agent holding the whole file in context over parallel per-task subagents, since every task edits the same file and several tasks (Theme/CSS var renames, `--primary` extraction) touch shared selectors.

**Goal:** Upgrade the existing single-file Pomodoro app with: (1) a real media-loading fix for the Background URL bug, (2) local image/video upload with IndexedDB persistence, (3) a background music system (procedurally-generated built-in library + URL + local upload), (4) full Appearance/color theming with presets, and (5) a tabbed settings dialog to host it all — without breaking any existing timer/planner/background/persistence functionality.

**Architecture:** Purely additive to the existing `index.html`. New namespaces: `MediaService`, `LocalMediaDB`, `ObjectURLRegistry`, `MusicPlayer`, `Theme`. New state slices: `musicSettings`, `themeSettings` (new `localStorage` keys `musicSettings`, `themeSettings`, alongside the existing `appSettings`/`tasks`/`stats`/`mediaSettings`). `Media.applyBackground()` is modified in place to call `MediaService` instead of extension-sniffing. The settings `<dialog>` gains an ARIA tablist splitting its content into Timer / Background / Music / Appearance panels — same dialog element, no new dialog.

**Tech Stack:** Same as existing — vanilla ES6+, Web Audio API (extended for procedural music + reused pattern from `SoundFX`), IndexedDB (new), `<input type="file">` + `URL.createObjectURL`, YouTube IFrame API (unchanged). No new external dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-media-music-appearance-upgrade-design.md`

## Global Constraints

- Still exactly one file: `index.html`. No build step, no new external dependencies beyond what's already loaded (Google Fonts, lazy YouTube IFrame API).
- Never use `innerHTML`/`insertAdjacentHTML` for any user-controlled value (filenames, track names, URLs, hex input echoes) — `textContent`/DOM APIs only, per the existing codebase's pattern.
- URL scheme allowlist for all user-supplied media URLs: `http:` and `https:` only (this loosens the current `https:`-only check, which was part of the original bug — never `javascript:`/`data:`/`file:`/`blob:` from user input).
- Local file size caps: image 15MB, video 50MB, audio 30MB. Reject over-cap files with a clear message; never crash.
- Every new `localStorage`/IndexedDB read path must degrade to safe defaults on corrupted/missing data, matching the existing `Storage.load*` pattern — never throw to the caller.
- No feature may call `Timer.reset()`, mutate `state.timer`, or otherwise disrupt a running Pomodoro — background, music, and theme changes are fully decoupled from timer state (per spec §10, existing behavior already verified in the original build).
- Exact user-facing error strings are given in spec §7 — use them verbatim, don't rephrase.
- No "Website Skill Tracker" exists in this environment — do not reference or fake its use.

---

## Shared additions (referenced by multiple tasks below)

```js
// New mediaSettings fields (existing key "mediaSettings", extended — see Task 4/5)
// type gains 'localImage' | 'localVideo'; new fields localImageId, localVideoId (number|null)

// New localStorage key "musicSettings" (Task 8)
// { enabled, source: 'builtin'|'url'|'upload', builtinTrackId, audioUrl, localAudioId, volume, muted, loop }

// New localStorage key "themeSettings" (Task 10)
// { preset: 'default'|...|'custom', colors: { bg, surface, text, textMuted, border, primary,
//   accentPomodoro, accentShortBreak, accentLongBreak, success, warning, danger } }
```

---

### Task 1: MediaService — real-load verification (fixes the root-cause bug)

**Files:**
- Modify: `index.html` (add `MediaService` namespace to `<script>`, before `Media`)

**Interfaces:**
- Consumes: nothing new (pure utility namespace).
- Produces:
  - `MediaService.ALLOWED_SCHEMES = ['http:', 'https:']`
  - `MediaService.isAllowedUrl(url): boolean`
  - `MediaService.loadImageFromUrl(url, timeoutMs=12000): Promise<{ok:true}|{ok:false, reason}>`
  - `MediaService.loadVideoFromUrl(url, timeoutMs=12000): Promise<{ok:true}|{ok:false, reason}>`
  - `MediaService.loadAudioFromUrl(url, timeoutMs=12000): Promise<{ok:true, duration}|{ok:false, reason}>`
  - `MediaService.SIZE_CAPS = { image: 15*1024*1024, video: 50*1024*1024, audio: 30*1024*1024 }`
  - `MediaService.validateLocalFile(file, kind): Promise<{ok:true}|{ok:false, reason}>` (`kind`: `'image'|'video'|'audio'`)
  - `reason` strings are always exactly one of the spec §7 strings.

- [ ] **Step 1: Implement `MediaService`.**

  ```js
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
        function cleanup() { video.removeAttribute('src'); try { video.load(); } catch {} }
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
  ```

- [ ] **Step 2: Verify real-load behavior via Playwright `browser_evaluate`.**

  Test matrix: a known-good `https://` image URL → `{ok:true}`; a 404 image URL → `{ok:false}` with the exact image reason string; a `javascript:alert(1)` URL → `{ok:false, reason:'Please enter a valid URL.'}`; a known-good `http://` (non-https) direct image URL → `{ok:true}` (proves the https-only bug is fixed); a video URL with no `.mp4` extension but that is a real direct video resource → `{ok:true}` (proves extension-sniffing is gone — use a real direct-video test URL such as the MDN cc0 flower video with a `?x=1` query appended, or any accessible direct-video URL without a recognizable extension if available).

---

### Task 2: LocalMediaDB (IndexedDB) + ObjectURLRegistry

**Files:**
- Modify: `index.html` (add `LocalMediaDB` and `ObjectURLRegistry` namespaces, after `MediaService`)

**Interfaces:**
- Produces:
  - `LocalMediaDB.open(): Promise<IDBDatabase>` (memoized)
  - `LocalMediaDB.save(kind, file): Promise<id>`
  - `LocalMediaDB.get(id): Promise<record|null>` — record: `{id, kind, name, mimeType, size, blob, createdAt}`
  - `LocalMediaDB.delete(id): Promise<void>`
  - `ObjectURLRegistry.set(slot, blob): string` — revokes any previous URL for that slot first
  - `ObjectURLRegistry.revoke(slot): void`

- [ ] **Step 1: Implement both namespaces.**

  ```js
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
  ```

- [ ] **Step 2: Verify save/get/delete round-trip and object URL revocation via Playwright.**

  `browser_evaluate` (async): create a small `Blob(['test'], {type:'image/png'})` wrapped as a fake `File`, `LocalMediaDB.save('image', file)` → id; `LocalMediaDB.get(id)` → record with matching `name`/`kind`; `ObjectURLRegistry.set('bg-image', record.blob)` → a `blob:` URL string; calling `ObjectURLRegistry.set('bg-image', otherBlob)` again and confirming the previous URL is revoked (fetching the old URL rejects); `LocalMediaDB.delete(id)` then `LocalMediaDB.get(id)` → `null`.

---

### Task 3: Settings dialog → tabbed structure

**Files:**
- Modify: `index.html` (restructure `dialog#settings` markup; add tab CSS; add `UI.selectSettingsTab`)

**Interfaces:**
- Consumes: existing `dialog#settings` fieldsets (Timer, Auto-start, Background) from the current build.
- Produces:
  - Tab bar `div.settings-tabs[role=tablist]` with 4 `button[role=tab]`: `#tab-timer`, `#tab-background`, `#tab-music`, `#tab-appearance`.
  - 4 panels `div[role=tabpanel]`: `#panel-timer`, `#panel-background`, `#panel-music`, `#panel-appearance`.
  - `UI.selectSettingsTab(id)` — sets `aria-selected`/`tabIndex`/`hidden` across all 4 tabs/panels.
  - `#panel-timer` contains today's existing "Timer (minutes)" + "Auto-start" fieldsets, unchanged.
  - `#panel-background` contains today's existing "Background" fieldset content, unchanged (Task 4/5 extend it).
  - `#panel-music` and `#panel-appearance` exist but are empty placeholders (`<p>Coming soon.</p>`) until Tasks 8/10 fill them in — this keeps Task 3 independently testable without forward references.

- [ ] **Step 1: Add tab CSS.**

  ```css
  .settings-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  .settings-tabs [role="tab"] {
    border: none; background: transparent; padding: 10px 14px; font-weight: 600; font-size: 0.86rem;
    color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
    min-height: 40px;
  }
  .settings-tabs [role="tab"][aria-selected="true"] { color: var(--text); border-bottom-color: var(--primary, var(--accent)); }
  [role="tabpanel"] { min-height: 120px; }
  ```

- [ ] **Step 2: Restructure the `dialog#settings` markup** — insert the tab bar as the first child inside `<form id="settings-form">` (right after the `<h2 id="settings-title">`), wrap the existing "Timer (minutes)" + "Auto-start" fieldsets in `<div role="tabpanel" id="panel-timer" aria-labelledby="tab-timer">`, wrap the existing "Background" fieldset in `<div role="tabpanel" id="panel-background" aria-labelledby="tab-background" hidden>`, and add two new empty panels:

  ```html
  <div class="settings-tabs" role="tablist" aria-label="Settings sections">
    <button type="button" role="tab" id="tab-timer" aria-controls="panel-timer" aria-selected="true" tabindex="0">Timer</button>
    <button type="button" role="tab" id="tab-background" aria-controls="panel-background" aria-selected="false" tabindex="-1">Background</button>
    <button type="button" role="tab" id="tab-music" aria-controls="panel-music" aria-selected="false" tabindex="-1">Music</button>
    <button type="button" role="tab" id="tab-appearance" aria-controls="panel-appearance" aria-selected="false" tabindex="-1">Appearance</button>
  </div>
  ```
  ```html
  <div role="tabpanel" id="panel-music" aria-labelledby="tab-music" hidden><p>Coming soon.</p></div>
  <div role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance" hidden><p>Coming soon.</p></div>
  ```

- [ ] **Step 3: Implement `UI.selectSettingsTab` and wire tab clicks + arrow-key navigation.**

  ```js
  const SETTINGS_TABS = ['timer', 'background', 'music', 'appearance'];
  UI.selectSettingsTab = function selectSettingsTab(id) {
    SETTINGS_TABS.forEach((t) => {
      const tabBtn = document.getElementById(`tab-${t}`);
      const panel = document.getElementById(`panel-${t}`);
      const active = t === id;
      tabBtn.setAttribute('aria-selected', String(active));
      tabBtn.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
    });
  };
  ```
  In `UI.init()`, add:
  ```js
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
  ```
  Also update `UI.openSettings()` to call `UI.selectSettingsTab('timer')` first, so the dialog always opens on the Timer tab.

- [ ] **Step 4: Regression-verify the Timer tab still works exactly as before** (Playwright): open settings, confirm Timer tab is selected and shows duration fields with correct values, submit invalid then valid durations exactly as the original settings test did, confirm save/close/Escape all still work.

- [ ] **Step 5: Verify tab switching and keyboard navigation.** Click Background tab → panel-background visible, panel-timer hidden, `aria-selected` correct. Focus `#tab-timer`, press `ArrowRight` three times, confirm focus and selection land on Appearance; press `Home`, confirm it jumps back to Timer.

---

### Task 4: Background tab — URL fields wired to MediaService (fixes the bug end-to-end)

**Files:**
- Modify: `index.html` (`Media.applyBackground` image/video branches; Background panel markup gets Preview buttons + status text; `UI.saveSettingsFromForm` background section)

**Interfaces:**
- Consumes: `MediaService` (Task 1), existing `Media`/`UI` background code.
- Produces:
  - `Media.applyBackground()` image/video branches now call `MediaService.loadImageFromUrl`/`loadVideoFromUrl` before committing (async), replacing the extension/https-only gate.
  - New elements per URL row: `<span class="media-status" id="status-bg-image-url" aria-live="polite"></span>` (and `-video-url`), and `<button type="button" id="preview-bg-image-url">Preview</button>` (and `-video-url`).
  - `UI.previewBackgroundUrl(kind)` (`kind`: `'image'|'video'`) — reads the relevant input, sets status text to `Loading…`, calls the matching `MediaService.load*FromUrl`, sets status to `Looks good ✓` or the returned `reason`; on success also renders a small inline preview (`<img>`/`<video>` at ~120px height) in a `<div id="preview-box-bg-image-url">` (and `-video-url`) below the row.

- [ ] **Step 1: Rewrite `Media.applyBackground()`'s image and video branches to use `MediaService`.**

  ```js
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

    const m = state.mediaSettings;
    const requestId = ++Media._requestSeq; // guards against a slower earlier request clobbering a faster later one

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
      return;
    }

    // ... 'youtube' / 'localImage' / 'localVideo' (Task 5) / default branches unchanged / added below
  }
  ```
  Add `Media._requestSeq = 0;` near the top of the `Media` object. This guards the pre-existing "switch away mid-load" race (same family of bug fixed in the original build for the `onerror` handler) now that background application is async end-to-end.

- [ ] **Step 2: Add Preview buttons + status/preview elements to the `#row-bg-image`/`#row-bg-video` markup**, and implement `UI.previewBackgroundUrl`:

  ```js
  UI.previewBackgroundUrl = async function previewBackgroundUrl(kind) {
    const inputId = kind === 'image' ? 'setting-bg-image-url' : 'setting-bg-video-url';
    const statusId = kind === 'image' ? 'status-bg-image-url' : 'status-bg-video-url';
    const boxId = kind === 'image' ? 'preview-box-bg-image-url' : 'preview-box-bg-video-url';
    const url = document.getElementById(inputId).value.trim();
    const status = document.getElementById(statusId);
    const box = document.getElementById(boxId);
    box.replaceChildren();
    if (!url) { status.textContent = 'Please enter a valid URL.'; return; }
    status.textContent = 'Loading…';
    const result = kind === 'image' ? await MediaService.loadImageFromUrl(url) : await MediaService.loadVideoFromUrl(url);
    if (!result.ok) { status.textContent = result.reason; return; }
    status.textContent = 'Looks good ✓';
    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.style.cssText = 'max-height:120px;border-radius:8px;';
      box.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = url; video.controls = true; video.muted = true; video.style.cssText = 'max-height:120px;border-radius:8px;';
      box.appendChild(video);
    }
  };
  ```
  Wire `#preview-bg-image-url`/`#preview-bg-video-url` click listeners in `UI.init()` to call `UI.previewBackgroundUrl('image')`/`('video')`.

- [ ] **Step 3: Verify the original bug is fixed via Playwright.**

  Set an `http://` (non-https) direct image URL via `#setting-bg-image-url`, click Preview, confirm status becomes `Looks good ✓` and a preview `<img>` appears. Set a real direct-video URL that has no `.mp4`/`.webm` extension in its path (append a harmless query string to a known-good test video URL), click Preview on the video row, confirm it loads successfully — proving both parts of the original root cause are fixed.

- [ ] **Step 4: Verify error paths show real messages, not silence.**

  Enter a clearly broken URL (`https://example.invalid/nope.jpg`), click Preview, confirm the status text becomes the exact image error string from spec §7 (not blank, not silently reverting).

- [ ] **Step 5: Regression-verify Save still works and applies correctly**, and that switching quickly between two different image URLs before the first finishes loading doesn't leave the slower/stale one displayed (the `_requestSeq` guard from Step 1).

---

### Task 5: Background tab — local image/video upload

**Files:**
- Modify: `index.html` (`#setting-bg-type` gains 2 options; new `#row-bg-local-image`/`#row-bg-local-video` markup; `Media.applyBackground` gains `localImage`/`localVideo` branches; `UI.saveSettingsFromForm` extended)

**Interfaces:**
- Consumes: `MediaService.validateLocalFile`, `LocalMediaDB`, `ObjectURLRegistry` (Tasks 1–2).
- Produces:
  - `<select id="setting-bg-type">` gains `<option value="localImage">Upload Image</option>` and `<option value="localVideo">Upload Video</option>`.
  - New rows `#row-bg-local-image`/`#row-bg-local-video`, each: hidden `<input type="file" accept="image/*">` (or `video/*`) triggered by a visible `[Choose Image]`/`[Choose Video]` button, a filename display `<span>`, `[Replace]`/`[Remove]` buttons, and an inline preview.
  - `UI.handleLocalMediaChoice(kind)` (`kind`: `'image'|'video'`) — opens the file input.
  - `UI.handleLocalMediaFile(kind, file)` — validates via `MediaService.validateLocalFile`, on success saves via `LocalMediaDB.save`, creates a preview object URL via `ObjectURLRegistry.set('bg-image-preview'|'bg-video-preview', file)`, shows filename + preview + Replace/Remove; on failure shows the error string inline.
  - `UI.removeLocalMedia(kind)` — clears the pending selection/preview (does not touch `state.mediaSettings` or the DB until Save, consistent with the existing "Save commits" pattern) unless the currently-applied background IS that local media, in which case Remove also calls `LocalMediaDB.delete` + `Media.applyDefaultBackground()` immediately (removing an *active* background should take effect right away, matching spec Step 10's "Remove" affordance).
  - `Media.applyBackground()` gains `localImage`/`localVideo` branches that resolve the blob via `LocalMediaDB.get(state.mediaSettings.localImageId|localVideoId)`, create an object URL via `ObjectURLRegistry.set('bg-image'|'bg-video', record.blob)`, and render exactly like the URL-based image/video branches.

- [ ] **Step 1: Add the 2 new `<select>` options and the 2 new row blocks.** Add to `#setting-bg-type`: `<option value="localImage">Upload Image</option>` and `<option value="localVideo">Upload Video</option>`. Add these two rows after `#row-bg-youtube` (exact IDs, referenced by Steps 2–4 below):

  ```html
  <div id="row-bg-local-image" hidden>
    <span class="field-label">Upload Image</span>
    <input type="file" id="local-bg-image-input" accept="image/*" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">
    <button type="button" id="choose-local-bg-image" class="btn-secondary">Choose Image</button>
    <span id="name-local-bg-image"></span>
    <span class="field-error" id="status-local-bg-image"></span>
    <div id="preview-box-local-bg-image"></div>
    <button type="button" id="replace-local-bg-image" class="btn-secondary">Replace</button>
    <button type="button" id="remove-local-bg-image" class="btn-secondary">Remove</button>
  </div>

  <div id="row-bg-local-video" hidden>
    <span class="field-label">Upload Video</span>
    <input type="file" id="local-bg-video-input" accept="video/*" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">
    <button type="button" id="choose-local-bg-video" class="btn-secondary">Choose Video</button>
    <span id="name-local-bg-video"></span>
    <span class="field-error" id="status-local-bg-video"></span>
    <div id="preview-box-local-bg-video"></div>
    <button type="button" id="replace-local-bg-video" class="btn-secondary">Replace</button>
    <button type="button" id="remove-local-bg-video" class="btn-secondary">Remove</button>
  </div>
  ```
  Wire in `UI.init()`: `#choose-local-bg-image`/`#replace-local-bg-image` clicks call `UI.handleLocalMediaChoice('image')` (Replace re-opens the same file picker); `#remove-local-bg-image` calls `UI.removeLocalMedia('image')`; `#local-bg-image-input` `change` event calls `UI.handleLocalMediaFile('image', e.target.files[0])` (guard: return early if `!e.target.files[0]`); all 4 repeated for `video`. Extend `UI.toggleBgFields`'s `rows` map with `localImage: document.getElementById('row-bg-local-image')` and `localVideo: document.getElementById('row-bg-local-video')`.

- [ ] **Step 2: Implement the local-media handlers.**

  ```js
  UI._pendingLocalMedia = { image: null, video: null }; // { file } until Save commits

  UI.handleLocalMediaChoice = function handleLocalMediaChoice(kind) {
    document.getElementById(kind === 'image' ? 'local-bg-image-input' : 'local-bg-video-input').click();
  };

  UI.handleLocalMediaFile = async function handleLocalMediaFile(kind, file) {
    const statusId = kind === 'image' ? 'status-local-bg-image' : 'status-local-bg-video';
    const status = document.getElementById(statusId);
    status.textContent = 'Loading…';
    const result = await MediaService.validateLocalFile(file, kind);
    if (!result.ok) { status.textContent = result.reason; return; }
    status.textContent = 'Looks good ✓';
    UI._pendingLocalMedia[kind] = file;
    document.getElementById(kind === 'image' ? 'name-local-bg-image' : 'name-local-bg-video').textContent = file.name;
    const previewBox = document.getElementById(kind === 'image' ? 'preview-box-local-bg-image' : 'preview-box-local-bg-video');
    previewBox.replaceChildren();
    const url = ObjectURLRegistry.set(kind === 'image' ? 'bg-image-preview' : 'bg-video-preview', file);
    const el = document.createElement(kind === 'image' ? 'img' : 'video');
    el.src = url; el.style.cssText = 'max-height:120px;border-radius:8px;';
    if (kind === 'video') { el.controls = true; el.muted = true; }
    previewBox.appendChild(el);
  };

  UI.removeLocalMedia = async function removeLocalMedia(kind) {
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
  };
  ```

- [ ] **Step 3: Extend `UI.saveSettingsFromForm` to commit a pending local upload**: if `bgType === 'localImage'` and `UI._pendingLocalMedia.image` is set, `await LocalMediaDB.save('image', UI._pendingLocalMedia.image)`, store the returned id as `mediaSettings.localImageId`, clear the pending slot; symmetric for video. If the type changed to `localImage`/`localVideo` without a pending file and no existing `localImageId`/`localVideoId`, fall back to `'default'` (nothing to apply).

- [ ] **Step 4: Extend `Media.applyBackground()` with the `localImage`/`localVideo` branches**, mirroring the URL branches but sourcing from `LocalMediaDB`:

  ```js
  if (m.type === 'localImage') {
    const record = await LocalMediaDB.get(m.localImageId);
    if (!record) { Media.applyDefaultBackground(); return; }
    const url = ObjectURLRegistry.set('bg-image', record.blob);
    layer.replaceChildren();
    const img = document.createElement('img');
    img.alt = ''; img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    img.src = url;
    layer.appendChild(img);
    document.documentElement.style.setProperty('--overlay-color', 'rgba(0,0,0,0.35)');
    UI.hideMediaPanel();
    return;
  }
  if (m.type === 'localVideo') {
    const record = await LocalMediaDB.get(m.localVideoId);
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
    return;
  }
  ```

- [ ] **Step 5: Verify upload → apply → refresh persistence via Playwright.**

  Use `browser_evaluate` to construct a small fake image `File` (`new File([new Uint8Array([...pngBytes])], 'test.png', {type:'image/png'})` with real minimal PNG bytes so `Image()` decode succeeds), invoke `UI.handleLocalMediaFile('image', file)`, confirm status/preview/filename appear; select `localImage` in the type select and Save; confirm `#background-layer img` appears with a `blob:` src. Reload the page; confirm the background re-applies from IndexedDB (a fresh object URL is created on boot) without needing re-upload.

- [ ] **Step 6: Verify Remove cleans up IndexedDB and revokes the object URL**, and that choosing a different background type afterward doesn't error.

---

### Task 6: MusicPlayer engine core (URL + upload sources)

**Files:**
- Modify: `index.html` (add `MusicPlayer` namespace; add `Storage.loadMusicSettings`/`saveMusicSettings`; add `state.musicSettings`)

**Interfaces:**
- Consumes: `MediaService.loadAudioFromUrl`/`validateLocalFile`, `LocalMediaDB`, `ObjectURLRegistry`.
- Produces:
  - `DEFAULT_MUSIC = { enabled: false, source: 'builtin', builtinTrackId: '', audioUrl: '', localAudioId: null, volume: 0.5, muted: false, loop: true }`
  - `Storage.loadMusicSettings()`/`saveMusicSettings(m)` — same validate-with-fallback pattern as `loadMediaSettings`.
  - `MusicPlayer.selectUrl(url): Promise<{ok, reason?}>`
  - `MusicPlayer.selectUpload(file): Promise<{ok, reason?, id?}>`
  - `MusicPlayer.play() / pause() / setVolume(pct) / setMuted(bool) / setLoop(bool)`
  - `MusicPlayer.getProgress(): {currentSec, durationSec}`
  - `MusicPlayer._mode: 'url'|'upload'|'builtin'|null` (builtin wired in Task 7)
  - Backed by one module-level `const musicAudioEl = new Audio();` created once — `selectUrl`/`selectUpload` only ever change `.src`, never recreate the element.

- [ ] **Step 1: Add `DEFAULT_MUSIC`, `state.musicSettings`, and the `Storage` functions.**

  ```js
  const DEFAULT_MUSIC = { enabled: false, source: 'builtin', builtinTrackId: '', audioUrl: '', localAudioId: null, volume: 0.5, muted: false, loop: true };
  // add `musicSettings: { ...DEFAULT_MUSIC }` to the top-level `state` object literal

  // in Storage:
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
  ```

- [ ] **Step 2: Implement `MusicPlayer` (URL/upload modes only — builtin mode added in Task 7, method bodies below are the full final versions so Task 7 only adds to them, not replaces them).**

  ```js
  const musicAudioEl = new Audio();
  musicAudioEl.addEventListener('ended', () => {
    if (!musicAudioEl.loop) { MusicPlayer._playing = false; if (MusicPlayer._mode === 'builtin') MusicPlayer.next(); }
  });

  const MusicPlayer = {
    _mode: null,
    _playing: false,
    _localAudioId: null,

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

    // stubs overwritten in Task 7:
    _teardownBuiltin() {},
    _playBuiltin() {},
    _pauseBuiltin() {},
    _setBuiltinGain() {},
    _builtinProgress() { return { currentSec: 0, durationSec: 0 }; },
    next() {},
    prev() {},
  };
  ```

- [ ] **Step 3: Verify URL and upload playback via Playwright.**

  `MusicPlayer.selectUrl(<a real direct audio test URL>)` → `{ok:true}`; `MusicPlayer.play()`; wait briefly; `MusicPlayer.isPlaying()` → true (after a real click-triggered call — same autoplay-gesture caveat as the original YouTube testing, so drive this via a real `browser_click` on a temporary test button or accept the same graceful-non-throw verification used for YouTube). `MusicPlayer.getProgress().durationSec > 0`. `MusicPlayer.setVolume(30)` → `musicAudioEl.volume === 0.3`. Invalid URL → `selectUrl` resolves `{ok:false, reason: <audio error string>}` without throwing.

---

### Task 7: Built-in procedural music library

**Files:**
- Modify: `index.html` (add `BUILTIN_TRACKS`, generator functions, `renderTrackBuffer`, and overwrite the Task 6 `MusicPlayer` builtin stubs)

**Interfaces:**
- Produces:
  - `BUILTIN_TRACKS: Array<{id, name, category, durationSec, gen}>` — 6 tracks: Rain (Nature), White Noise (Noise), Deep Focus (Noise), Ambient Pad (Ambient), Soft Tones (Calm), Warm Focus (Ambient).
  - `renderTrackBuffer(durationSec, genFn): Promise<AudioBuffer>` — via `OfflineAudioContext`.
  - `MusicPlayer.selectBuiltin(trackId): Promise<{ok, reason?}>`
  - `MusicPlayer._teardownBuiltin/_playBuiltin/_pauseBuiltin/_setBuiltinGain/_builtinProgress/next/prev` — real implementations replacing Task 6's stubs.

- [ ] **Step 1: Implement the 6 generator functions and `renderTrackBuffer`.**

  ```js
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
  ```

- [ ] **Step 2: Overwrite the `MusicPlayer` builtin stubs with real implementations** (edit the `MusicPlayer` object literal from Task 6 in place — same file, same object):

  ```js
  // replace the 6 stub methods at the bottom of MusicPlayer with:
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

  async selectBuiltin(trackId) {
    const track = BUILTIN_TRACKS.find(t => t.id === trackId);
    if (!track) return { ok: false, reason: 'This file could not be loaded. Please choose another file.' };
    MusicPlayer._teardownBuiltin();
    musicAudioEl.pause();
    MusicPlayer._ensureLiveCtx();
    let buffer = MusicPlayer._bufferCache[trackId];
    if (!buffer) { buffer = await renderTrackBuffer(track.durationSec, track.gen); MusicPlayer._bufferCache[trackId] = buffer; }
    MusicPlayer._mode = 'builtin';
    MusicPlayer._pendingBuffer = buffer;
    MusicPlayer._bufferDuration = buffer.duration;
    MusicPlayer._pauseOffset = 0;
    return { ok: true };
  },

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
    try { MusicPlayer._sourceNode.stop(); } catch {}
    MusicPlayer._sourceNode = null;
    MusicPlayer._playing = false;
  },
  _teardownBuiltin() {
    if (MusicPlayer._sourceNode) { try { MusicPlayer._sourceNode.onended = null; MusicPlayer._sourceNode.stop(); } catch {} MusicPlayer._sourceNode = null; }
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
  ```

- [ ] **Step 3: Verify each of the 6 tracks renders without error and has a sane duration.**

  Playwright `browser_evaluate` (async): for each `BUILTIN_TRACKS` entry, `await renderTrackBuffer(track.durationSec, track.gen)` → an `AudioBuffer` with `.duration` within 0.1s of `track.durationSec` and `.numberOfChannels === 2`, no thrown error.

- [ ] **Step 4: Verify play/pause/next/prev/loop cycle correctly via a real click** (same real-gesture requirement as background video/YouTube testing): `MusicPlayer.selectBuiltin('rain')`, real click a temporary bound test button calling `MusicPlayer.play()`, confirm `MusicPlayer.isPlaying()` true and `getProgress().durationSec` ≈ 45; call `MusicPlayer.next()`, confirm `state.musicSettings.builtinTrackId === 'white-noise'` and playback continues (`wasPlaying` carried over); call `MusicPlayer.pause()`, confirm `isPlaying()` false and `getProgress().currentSec` holds steady (doesn't reset to 0).

---

### Task 8: Music tab UI + persistence wiring

**Files:**
- Modify: `index.html` (`#panel-music` markup; `UI.renderMusicUI`; music control event listeners; `State.init` restores `musicSettings`)

**Interfaces:**
- Consumes: `MusicPlayer`, `BUILTIN_TRACKS`, `Storage.loadMusicSettings`/`saveMusicSettings`.
- Produces:
  - `#panel-music` markup: source `<select id="setting-music-source">` (Built-in Library / Audio URL / Upload Audio), a built-in track list `<ul id="music-track-list">` (one row per `BUILTIN_TRACKS` entry: name, category, a select/highlight state), a URL row (`#row-music-url` with input + Preview + status), an upload row (`#row-music-upload`, same Choose/filename/Replace/Remove pattern as Task 5), and a persistent player bar: `#music-play`, `#music-prev`, `#music-next`, `#music-progress` (`<input type="range">` acting as a seek-look progress display, read-only visual — no seeking support in this pass, explicitly noted as such), `#music-time` (`0:00 / 0:00`), `#music-volume`, `#music-mute`, `#music-loop`.
  - `UI.renderMusicUI()` — re-renders the track list's selected/playing state, updates play/pause icon, mute icon, loop toggle state, and volume slider from `state.musicSettings`.
  - A `requestAnimationFrame` loop (`UI._musicProgressLoop`) that updates `#music-progress`/`#music-time` while `MusicPlayer.isPlaying()`, self-terminating when paused (not a perpetual RAF — only scheduled while playing, restarted on `play()`).
  - `State.init()` extended: `state.musicSettings = Storage.loadMusicSettings();` then, if `source === 'upload'` and `localAudioId` is set, `await MusicPlayer.restoreUpload(id)`; if `source === 'builtin'` and `builtinTrackId` is set, `await MusicPlayer.selectBuiltin(id)`; if `source === 'url'` and `audioUrl` is set, attempt `await MusicPlayer.selectUrl(url)` silently (no error toast on boot — if it now fails, just leave unselected; user can reopen Music tab to see the empty state). Playback itself never auto-starts on boot (respects autoplay policy; user presses Play).

- [ ] **Step 1: Build `#panel-music` markup** (exact IDs, referenced by Steps 2–3 below):

  ```html
  <label for="setting-music-source">Music source
    <select id="setting-music-source">
      <option value="builtin">Built-in Library</option>
      <option value="url">Audio URL</option>
      <option value="upload">Upload Audio</option>
    </select>
  </label>

  <div id="row-music-builtin">
    <ul id="music-track-list"></ul>
  </div>

  <div id="row-music-url" hidden>
    <label for="setting-music-url">Audio URL
      <input type="url" id="setting-music-url" placeholder="https://example.com/track.mp3">
    </label>
    <button type="button" id="preview-music-url">Preview</button>
    <span class="field-error" id="status-music-url"></span>
  </div>

  <div id="row-music-upload" hidden>
    <input type="file" id="local-music-input" accept="audio/*" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);">
    <button type="button" id="choose-local-music" class="btn-secondary">Choose Audio</button>
    <span id="name-local-music"></span>
    <span class="field-error" id="status-local-music"></span>
    <button type="button" id="remove-local-music" class="btn-secondary">Remove</button>
  </div>

  <div class="music-player-bar">
    <button type="button" id="music-prev" aria-label="Previous track">⏮</button>
    <button type="button" id="music-play" aria-label="Play or pause music" aria-pressed="false">▶</button>
    <button type="button" id="music-next" aria-label="Next track">⏭</button>
    <input type="range" id="music-progress" min="0" max="1000" value="0" disabled aria-label="Playback progress">
    <span id="music-time">0:00 / 0:00</span>
    <input type="range" id="music-volume" min="0" max="100" value="50" aria-label="Music volume">
    <button type="button" id="music-mute" aria-label="Mute or unmute music" aria-pressed="false">🔊</button>
    <button type="button" id="music-loop" aria-label="Toggle loop" aria-pressed="true">🔁</button>
  </div>
  ```
  `#music-track-list` is populated once in `UI.init()` by iterating `BUILTIN_TRACKS` and creating one `<li data-id="{track.id}" tabindex="0" role="button">{track.name} — {track.category}</li>` per track via `createElement`/`textContent` (never `innerHTML`), matching the existing task-list rendering pattern. Add a `toggleMusicSourceFields(source)` helper (same shape as `UI.toggleBgFields`) showing exactly one of `#row-music-builtin`/`#row-music-url`/`#row-music-upload` based on `#setting-music-source`'s value, wired on its `change` event.

- [ ] **Step 2: Implement `UI.renderMusicUI()` and the RAF progress loop.**

  ```js
  UI.renderMusicUI = function renderMusicUI() {
    document.querySelectorAll('#music-track-list li').forEach((li) => {
      const active = li.dataset.id === state.musicSettings.builtinTrackId && state.musicSettings.source === 'builtin';
      li.classList.toggle('track--active', active);
    });
    const playing = MusicPlayer.isPlaying();
    document.getElementById('music-play').textContent = playing ? '⏸' : '▶';
    document.getElementById('music-mute').textContent = state.musicSettings.muted ? '🔇' : '🔊';
    document.getElementById('music-loop').setAttribute('aria-pressed', String(state.musicSettings.loop));
    document.getElementById('music-volume').value = Math.round(state.musicSettings.volume * 100);
    const canSkip = state.musicSettings.source === 'builtin';
    document.getElementById('music-prev').disabled = !canSkip;
    document.getElementById('music-next').disabled = !canSkip;
  };

  UI._musicRAF = null;
  UI._musicProgressTick = function musicProgressTick() {
    const { currentSec, durationSec } = MusicPlayer.getProgress();
    const bar = document.getElementById('music-progress');
    const time = document.getElementById('music-time');
    if (durationSec > 0) bar.value = Math.round((currentSec / durationSec) * 1000);
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    time.textContent = `${fmt(currentSec)} / ${fmt(durationSec)}`;
    if (MusicPlayer.isPlaying()) UI._musicRAF = requestAnimationFrame(UI._musicProgressTick);
    else UI._musicRAF = null;
  };
  ```
  `#music-progress` gets `min="0" max="1000"` in markup (a normalized scale, since duration varies per source) and `disabled` (visual only, not draggable, per the explicit "no seeking in this pass" scope note above).

- [ ] **Step 3: Wire all Music tab listeners in `UI.init()`**: source select change toggles rows via a `toggleMusicSourceFields` helper (same pattern as `toggleBgFields`); track list item click → `MusicPlayer.selectBuiltin(id)` then `state.musicSettings.source='builtin'; state.musicSettings.builtinTrackId=id;` save + `UI.renderMusicUI()`; URL Preview button → `MediaService.loadAudioFromUrl` inline status (same pattern as Task 4 Step 2) and on success stages the URL for Save; upload Choose/file-change → same pattern as Task 5 Step 2 but audio; Save (extend `UI.saveSettingsFromForm`) commits whichever source is selected into `state.musicSettings`, persists, and calls the matching `MusicPlayer.select*`; `#music-play` click → `MusicPlayer.isPlaying() ? MusicPlayer.pause() : MusicPlayer.play()` then `UI.renderMusicUI()` and, if now playing, kick off `UI._musicProgressTick()`; `#music-prev`/`#music-next` → `MusicPlayer.prev()`/`next()`; `#music-volume` input → `MusicPlayer.setVolume(Number(e.target.value))`; `#music-mute` click → toggle `MusicPlayer.setMuted`; `#music-loop` click → toggle `MusicPlayer.setLoop`.

- [ ] **Step 4: Extend `State.init()`** as described in the Interfaces section above (restore music source on boot without auto-playing).

- [ ] **Step 5: Verify the full music flow via Playwright**, including: selecting a built-in track and playing it (real click) while a background video is also playing, confirming both continue independently; changing background type while music plays, confirming music keeps playing (`MusicPlayer.isPlaying()` stays true, `Timer` state untouched); reload after selecting a built-in track, confirming `state.musicSettings.builtinTrackId` and the selected-track UI state restore (without auto-playing).

---

### Task 9: Theme namespace + new CSS tokens

**Files:**
- Modify: `index.html` (CSS: add `--success`/`--warning`/`--danger`, convert `--accent`/`--accent-soft` and the 3 non-timer consumers to the `--primary`/`--primary-soft` split described in the spec; add `Theme` namespace)

**Interfaces:**
- Produces:
  - CSS: `:root` gains `--success: #2f9e57; --warning: #c98a1f; --danger: #c0392b; --primary: #e0654f;` (fallback pre-JS value = current default accent) and `--accent-pomodoro: #e0654f; --accent-shortBreak: #2f9e8f; --accent-longBreak: #5b53a6;` (fallback values matching today's literals). The existing `html[data-mode="shortBreak"]`/`["longBreak"]` rules become `{ --accent: var(--accent-shortBreak); --accent-soft: var(--accent-soft-shortBreak); }` (and longBreak equivalent); `html[data-mode="pomodoro"]` (new rule, doesn't exist today since pomodoro was the implicit `:root` default) gets `{ --accent: var(--accent-pomodoro); --accent-soft: var(--accent-soft-pomodoro); }`. `#task-form button`, `#settings-save` switch from `var(--accent)` to `var(--primary)`; `.task--active` switches to `border-color: var(--primary); background: var(--primary-soft);`.
  - `Theme.PRESETS` — 10 full concrete color maps (default = today's exact palette; the other 9 defined per spec §5 categories, concrete hex values chosen for each to be visually distinct and internally reasonably contrasting).
  - `Theme.apply(colors)`, `Theme.applyPreset(id)`, `Theme.setColor(key, hex)`, `Theme.resetToDefault()`, `Theme.contrastRatio(hexA, hexB)`, `Theme.checkContrastWarnings()`.
  - Color-math helpers: `hexToRgb`, `rgbToHex`, `mix(hexA, hexB, t)`, `relLuminance(hex)`.

- [ ] **Step 1: Update `:root` and the `[data-mode]` rules as described.** Add `--primary-soft` and the 3 `--accent-soft-*` custom properties to `:root` with fallback values (`--primary-soft: #f9e1dc; --accent-soft-pomodoro: #f9e1dc; --accent-soft-shortBreak: #d9f2ee; --accent-soft-longBreak: #e6e2f7;`, matching today's literals). Update `#task-form button`, `#settings-save`, `.task--active` selectors to reference `--primary`/`--primary-soft`. Leave the existing static `--surface-glass: rgba(255, 255, 255, 0.66);` entry in `:root` as-is (do not delete it) — it stays as the pre-JS/no-JS fallback; `Theme.apply()`'s `element.style.setProperty(...)` call (an inline style) always wins over the `:root` rule once it runs, so no fallback/flash handling is needed beyond leaving the literal in place.

- [ ] **Step 2: Implement the color-math helpers and `Theme`.**

  ```js
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

  const Theme = {
    PRESETS: {
      default:   { bg:'#faf7f5', surface:'#ffffff', text:'#241f1c', textMuted:'#7a716c', border:'#241f1c', primary:'#e0654f', accentPomodoro:'#e0654f', accentShortBreak:'#2f9e8f', accentLongBreak:'#5b53a6', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
      midnight:  { bg:'#12141c', surface:'#1c2030', text:'#eef0f8', textMuted:'#9aa0b8', border:'#eef0f8', primary:'#7c9dfc', accentPomodoro:'#e0654f', accentShortBreak:'#2f9e8f', accentLongBreak:'#8b7cf6', success:'#4ade80', warning:'#facc15', danger:'#f87171' },
      ocean:     { bg:'#eaf6f8', surface:'#ffffff', text:'#0b2a33', textMuted:'#4d7480', border:'#0b2a33', primary:'#0e7f92', accentPomodoro:'#d9634b', accentShortBreak:'#1aa6b3', accentLongBreak:'#245e8c', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
      forest:    { bg:'#f1f6ee', surface:'#ffffff', text:'#1e2b1a', textMuted:'#5c6e54', border:'#1e2b1a', primary:'#3f7d47', accentPomodoro:'#c9622f', accentShortBreak:'#4c9a5b', accentLongBreak:'#5a7a3f', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
      sunset:    { bg:'#1c1420', surface:'#2a1f30', text:'#fbeee6', textMuted:'#c9a9b6', border:'#fbeee6', primary:'#ff7a59', accentPomodoro:'#ff7a59', accentShortBreak:'#f3a24c', accentLongBreak:'#c65b9e', success:'#4ade80', warning:'#facc15', danger:'#f87171' },
      lavender:  { bg:'#f6f2fb', surface:'#ffffff', text:'#2f2540', textMuted:'#7c6f92', border:'#2f2540', primary:'#8b6fd6', accentPomodoro:'#d67ba0', accentShortBreak:'#7bb7c9', accentLongBreak:'#8b6fd6', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
      minimal:   { bg:'#fafafa', surface:'#ffffff', text:'#1a1a1a', textMuted:'#7a7a7a', border:'#1a1a1a', primary:'#1a1a1a', accentPomodoro:'#4a4a4a', accentShortBreak:'#6b6b6b', accentLongBreak:'#2e2e2e', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
      cyberpunk: { bg:'#0a0a12', surface:'#15121f', text:'#f2f0ff', textMuted:'#9d94c9', border:'#f2f0ff', primary:'#ff2e9a', accentPomodoro:'#ff2e9a', accentShortBreak:'#00f0ff', accentLongBreak:'#a742ff', success:'#39ff8f', warning:'#ffe157', danger:'#ff4d6a' },
      warm:      { bg:'#fbf1e6', surface:'#ffffff', text:'#3a2a1c', textMuted:'#8a7360', border:'#3a2a1c', primary:'#c9793a', accentPomodoro:'#c9793a', accentShortBreak:'#a68a4c', accentLongBreak:'#8c5a3c', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
      monochrome:{ bg:'#ffffff', surface:'#f2f2f2', text:'#000000', textMuted:'#666666', border:'#000000', primary:'#000000', accentPomodoro:'#333333', accentShortBreak:'#555555', accentLongBreak:'#111111', success:'#2f9e57', warning:'#c98a1f', danger:'#c0392b' },
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
      root.setProperty('--accent-soft-pomodoro', mix(colors.accentPomodoro, '#ffffff', 0.85));
      root.setProperty('--accent-soft-shortBreak', mix(colors.accentShortBreak, '#ffffff', 0.85));
      root.setProperty('--accent-soft-longBreak', mix(colors.accentLongBreak, '#ffffff', 0.85));
      root.setProperty('--surface-glass', (() => {
        const rgb = hexToRgb(colors.surface);
        return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.66)` : null;
      })());
    },
    applyPreset(id) {
      const colors = Theme.PRESETS[id] || Theme.PRESETS.default;
      state.themeSettings = { preset: id, colors };
      Storage.saveThemeSettings(state.themeSettings);
      Theme.apply(colors);
    },
    setColor(key, hex) {
      const colors = { ...state.themeSettings.colors, [key]: hex };
      state.themeSettings = { preset: 'custom', colors };
      Storage.saveThemeSettings(state.themeSettings);
      Theme.apply(colors);
    },
    resetToDefault() { Theme.applyPreset('default'); },
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
  ```
  Note: `--border` is applied as a low-alpha mix rather than the raw picked color directly, to preserve the existing subtle-hairline look (today's literal `--border: rgba(36, 31, 28, 0.09)` is a 9%-opacity tint of the text color) — `mix(colors.border, colors.bg, 0.91)` approximates that same subtlety against the new background for any preset.

- [ ] **Step 3: Add `Storage.loadThemeSettings`/`saveThemeSettings`** (same validate-with-fallback pattern; `preset` must be a key of `Theme.PRESETS` or `'custom'`; `colors` must be an object where every required key is a valid `#rrggbb` string via `hexToRgb`, else fall back to `Theme.PRESETS.default`).

- [ ] **Step 4: Verify preset application and contrast math via Playwright.**

  `Theme.applyPreset('midnight')`, confirm `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() === '#12141c'`. `Theme.contrastRatio('#000000', '#ffffff')` → `21` (exact max WCAG ratio, sanity check the formula). `Theme.contrastRatio('#777777', '#888888')` → a low value, confirm `Theme.checkContrastWarnings()` flags it when set as text/bg. `Theme.resetToDefault()` then confirm every CSS var matches the literal values the original build shipped with (regression check against the pre-upgrade screenshots' colors).

---

### Task 10: Appearance tab UI + boot wiring

**Files:**
- Modify: `index.html` (`#panel-appearance` markup; `UI.renderAppearanceUI`; color input listeners; `State.init` applies theme on boot)

**Interfaces:**
- Produces:
  - `#panel-appearance` markup: preset `<select id="setting-theme-preset">` (10 options), then one row per color key — each row a `<label>` wrapping `<input type="color" id="color-<key>">` + `<input type="text" id="hex-<key>" maxlength="7" placeholder="#rrggbb">`, for keys: `primary, bg, surface, text, textMuted, border, accentPomodoro, accentShortBreak, accentLongBreak` (success/warning/danger are not exposed as pickers per spec's example list — they exist as tokens for potential future use but aren't part of the Appearance UI in this pass, keeping the panel to the same set the spec's mockup shows). A `<div id="contrast-warnings" aria-live="polite">` list. A `[Reset to Default]` button.
  - `UI.renderAppearanceUI()` — sets the preset select and every color/hex input pair from `state.themeSettings.colors`, re-renders `#contrast-warnings`.
  - Color input (`input` event) and paired hex text input (`change` event, validated via `hexToRgb`) both call `Theme.setColor(key, hex)` then `UI.renderAppearanceUI()` — changes are live, no Save button needed for Appearance (matches spec Step 19 "must happen LIVE, no page refresh"); note this makes Appearance the one panel that doesn't route through `UI.saveSettingsFromForm` — call this out explicitly in-code with a one-line comment since it's a deliberate exception to the rest of the dialog's Save-to-commit pattern.
  - Preset select `change` → `Theme.applyPreset(value)` then `UI.renderAppearanceUI()`.
  - Reset button click → `Theme.resetToDefault()` then `UI.renderAppearanceUI()`.
  - `State.init()` extended: `state.themeSettings = Storage.loadThemeSettings(); Theme.apply(state.themeSettings.colors);` — called early, before any rendering, so there's no flash of unstyled/default colors.

- [ ] **Step 1: Build `#panel-appearance` markup** with the preset select, 9 color rows, contrast warnings container, and Reset button, following the visual pattern already established (`.field-error`-style inline text for warnings).

- [ ] **Step 2: Implement `UI.renderAppearanceUI()` and wire listeners.**

  ```js
  const APPEARANCE_KEYS = ['primary', 'bg', 'surface', 'text', 'textMuted', 'border', 'accentPomodoro', 'accentShortBreak', 'accentLongBreak'];

  UI.renderAppearanceUI = function renderAppearanceUI() {
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
  };
  ```
  In `UI.init()`:
  ```js
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
      if (!hexToRgb(v)) { UI.renderAppearanceUI(); return; } // invalid: silently revert to last-good value, no crash
      Theme.setColor(key, v);
      UI.renderAppearanceUI();
    });
  });
  ```

- [ ] **Step 3: Extend `State.init()`** to load and apply `themeSettings` first, as described.

- [ ] **Step 4: Verify live updates and persistence via Playwright.**

  Change `#color-primary` via `browser_evaluate` (set `.value` + dispatch `input`), confirm `#task-form button`'s computed `background-color` updates immediately with no reload. Type an invalid hex into `#hex-bg` (`"nothex"`), confirm it's ignored (previous valid value stays, no crash, no console error). Apply the `cyberpunk` preset, reload the page, confirm the preset and all colors persist and re-apply before first paint (check computed `--bg` immediately after `DOMContentLoaded`). Click Reset, confirm every color returns to exactly the Task 9 `default` preset values and `localStorage.themeSettings` reflects `preset:'default'`.

---

### Task 11: Regression, security, accessibility, performance — final pass

**Files:**
- Modify: `index.html` (fix whatever this pass finds)

**Interfaces:**
- Consumes: the complete upgraded file.
- Produces: a verified-clean file; no new public interfaces.

- [ ] **Step 1: Full regression sweep of every pre-existing behavior** verified in the original build (re-run the equivalent of the original plan's Task 13 Step 2 checklist): timer accuracy/drift, single-interval guard, double-completion guard, 4-cycle + auto-start, task CRUD + XSS-safety, stats integration + daily rollover, settings save not disrupting a running timer, YouTube background + audio/video modes, existing media persistence, keyboard nav, `prefers-reduced-motion`, no horizontal overflow at 320–1440px. All of this must still pass unchanged. Throughout this step and Steps 2–5, check `browser_console_messages` after every exercised flow (new and existing) and confirm zero unexplained errors/warnings (the pre-existing harmless favicon 404 is the only expected entry).

- [ ] **Step 2: New-feature regression/security sweep**: grep for `innerHTML`/`insertAdjacentHTML`/`document.write`/`eval(` — confirm still zero matches anywhere in the file (including all new code from Tasks 1–10). Confirm every new URL-accepting field rejects `javascript:`/`data:` schemes via `MediaService.isAllowedUrl`. Confirm uploading a `.svg` as a local background image renders via `<img>` only (verify `layer.querySelector('object, iframe, svg')` is null after an SVG upload) — proves no inline-SVG script execution vector was introduced.

- [ ] **Step 3: Performance/cleanup sweep**: switch background type 5 times in a row across url/local/youtube/default, confirm at most one `<video>`/one YouTube player/one set of object URLs is ever alive at a time (no orphans — extend the existing cleanup-verification technique from the original build to also check `ObjectURLRegistry._urls` never accumulates stale entries for the same slot). Confirm `musicAudioEl` is never recreated across track switches (capture a reference and confirm `===` after several `selectUrl`/`selectUpload`/`selectBuiltin` calls). Confirm the music progress `requestAnimationFrame` loop actually stops (no dangling `UI._musicRAF`) when paused.

- [ ] **Step 4: Accessibility sweep on new UI**: tab order through the full 4-tab dialog is logical; every new icon-only button (`#music-play`, `#music-prev`, `#music-next`, `#music-mute`, `#music-loop`, Choose/Replace/Remove buttons) has an `aria-label`; color `<input type="color">`/hex pairs have associated `<label>`s; `role=tablist` keyboard pattern (Task 3 Step 5) still works after all subsequent tasks added content to the panels; contrast-warning text is announced via `aria-live="polite"` (already set in Task 10) without being intrusive (not `assertive`).

- [ ] **Step 5: Responsive sweep**: re-check no horizontal overflow at 320/375/768/1024/1440px with the now-much-larger settings dialog open on each tab (this is the highest-risk area for new overflow, given color-picker rows and the track list); confirm the tab bar itself doesn't overflow/wrap awkwardly at 320px (scroll horizontally within the tab bar only, if needed, rather than breaking dialog width).

- [ ] **Step 6: Final read-through for dead code/unused variables introduced across Tasks 1–10; remove any. Confirm the file is still a single `index.html` with no other files required.**
