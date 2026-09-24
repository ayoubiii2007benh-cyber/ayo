# Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution note:** One evolving file (`index.html`), no test framework. "Tests" are concrete Playwright browser interactions/assertions run against the file served over `http://` (e.g. `npx serve -l 8080 .`), per this repo's established convention (see `docs/superpowers/plans/2026-09-23-lounge-dashboard-redesign.md`). Every task edits the same `<style>` block and sometimes the same shared selectors, so prefer inline execution by one agent holding the whole file in context over parallel per-task subagents.

**Goal:** Re-skin the entire app (same features, same content, same JS behavior) into the premium/editorial visual system defined in the spec — flat surfaces, a formal type/space/shadow scale, a sparing Fraunces italic accent, and a theme-safe accent gradient — without breaking any of the 15 theme presets, live color customization, or any existing flow.

**Architecture:** Purely a CSS re-skin of `index.html`'s single inline `<style>` block, plus a handful of `Theme.apply()` lines that set now-retired custom properties. No new files, no new JS logic, no HTML structural changes except two that are pure token/class touch-ups (`#app-title`/nav already exist; nothing is added or removed from the DOM tree). Every new visual rule reads from existing or newly-declared CSS custom properties so all 15 presets and any live user color override keep working automatically.

**Tech Stack:** Same as existing — vanilla HTML/CSS/JS, one Google Fonts addition (Fraunces), no build step, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-visual-redesign-design.md`

## Global Constraints

- Still exactly one file: `index.html`. No build step, no new dependencies beyond the Fraunces Google Fonts link.
- Every color-relevant rule must resolve through a CSS custom property (existing or newly added in Task 1) — never a literal hex/rgb color for anything preset-sensitive. Pre-existing literal `danger`/`success` tint rgba values (e.g. `rgba(192, 57, 43, 0.1)`) are out of scope and untouched.
- The `.glass` class name is **not** renamed anywhere in the HTML — only its CSS declaration changes (Task 1). This avoids touching ~15 `class="glass"` occurrences across the file for a purely cosmetic rename.
- No `Storage.*` key is added, removed, or restructured. No change to Timer/Missions/Lounge bot engine/Auth/AI chat/Music JS logic — only CSS, two small `Theme.apply()` deletions (Task 1), and zero other `<script>` edits.
- All ~20 hardcoded `rgba(36, 31, 28, *)` / `rgba(255,255,255, *)` neutral overlays get migrated to `color-mix(in srgb, var(--text) N%, transparent)` (or `var(--surface)`-based equivalents) by the task that owns that component — see each task's file list. Dialog/drawer backdrop scrims (`rgba(20, 16, 14, 0.45)`) and the Apex preset's decorative texture (`index.html:90-91`) are intentionally excluded and stay literal.
- Fraunces (`var(--font-serif)`, italic only) is used **only** for: `#view-lounge h3` section labels, `#active-task-display`, the auth modal's "Welcome" heading, and the leaderboard rank number. Timer digits, all form inputs/buttons, and dense data (task rows, chat messages, leaderboard dates) stay in Inter (`var(--font-sans)`).
- New custom properties/utility rules are declared exactly once, in Task 1, and never redeclared by a later task.

## Review Focus

- **`--accent-gradient` (via `border-image`) must render as a visible two-tone gradient on every preset**, not collapse to what reads as a flat color when a preset's `accentPomodoro`/`accentLongBreak` are close in hue — spot-checked across all 15 presets in Task 10.
- **Removing the always-on `box-shadow` from card components** (Tasks 3–6) must not make cards blend into the background where `--border` is subtle, especially on the 7 dark presets — checked per-task and again in Task 10's full sweep.
- **The stat-tile divider (`.stat-tile:not(:first-child)::before`, Task 3)** is absolutely positioned inside a CSS grid cell — must not overlap adjacent tile text at the 2-column mobile breakpoint (375px), and the `:nth-child(odd)` reset must actually remove the right dividers there — covered in Task 3's own verification.
- **`color-mix(in srgb, ...)` browser support is not a new risk** — the codebase already uses it today (`.task`, `.task__project` at `index.html:361,392`), so Task 1 confirms this is the established pattern rather than re-litigating it.
- **Retiring `--surface-glass`/`--glass-border` must leave zero dangling consumers.** An undefined custom property fails silently (falls back to `initial`, often invisible/transparent) rather than erroring, so Task 1's own step re-greps the whole file for both names after editing and requires zero remaining matches before its commit.

---

## Shared additions (Task 1 output, consumed by every later task)

```css
/* New tokens added to :root in Task 1 */
--radius-pill: 999px;
--shadow-xs: 0 1px 2px rgba(20, 16, 14, 0.06);
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-serif: 'Fraunces', Georgia, serif;
--space-1: 4px;  --space-2: 8px;  --space-3: 12px;  --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-7: 48px;  --space-8: 64px;
--text-2xs: 0.75rem;  --text-xs: 0.8125rem; --text-sm: 0.875rem;
--text-base: 1rem;    --text-md: 1.0625rem; --text-lg: 1.25rem;
--text-xl: 1.5rem;
--text-display: clamp(2.25rem, 5vw, 3rem);
--text-timer: clamp(3.6rem, 14vw, 6rem);
--accent-gradient: linear-gradient(135deg, var(--accent-pomodoro), var(--accent-longBreak));
/* --shadow-md / --shadow-lg keep their names but get new (softer) values */
```
`.glass` and `.icon-btn` keep their names but are redefined to be flat/opaque instead of blurred. The "eyebrow" italic-serif label treatment described in the spec is applied directly on each specific selector that needs it (`#active-task-display`, `#view-lounge h3`, `.leaderboard-item__rank`, `.auth-modal__form h2`) rather than as a shared `.eyebrow` utility class — every one of those elements already exists in HTML with no `class` attribute to hook into, so styling the id/selector directly gets the identical visual result without any HTML edits or dead CSS.

---

### Task 1: Design tokens, Fraunces, and flat-surface foundation (`.glass`/`.icon-btn`/`.btn-secondary`)

**Files:**
- Modify: `index.html:8-10` (font links), `index.html:12-45` (`:root` + mode rules), `index.html:153-165` (`.glass`), `index.html:196-215` (`.icon-btn`), `index.html:258-279` (`.btn`/`.btn-primary`/`.btn-secondary`), `index.html:531-536` (`.live-users`), `index.html:52-59` (`body`), `index.html:3008-3037` (`Theme.apply`).

**Interfaces:**
- Consumes: nothing new.
- Produces: every custom property and class listed in "Shared additions" above — every later task consumes these by name. `.glass`/`.icon-btn` visually change everywhere they're used, but no selector or id changes, so no other task needs to touch HTML for this.

- [ ] **Step 1: Add the Fraunces font link.** In the `<head>`, replace:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ```
  With:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,500;1,9..144,600&display=swap" rel="stylesheet">
  ```

- [ ] **Step 2: Replace the `:root` block with the token-expanded version.** Replace:
  ```css
    :root {
      --bg: #faf7f5;
      --surface: #ffffff;
      --surface-glass: rgba(255, 255, 255, 0.66);
      --text: #241f1c;
      --text-muted: #7a716c;
      --border: rgba(36, 31, 28, 0.09);
      --accent: #e0654f;
      --accent-soft: #f9e1dc;
      --accent-contrast: #ffffff;
      --primary: #e0654f;
      --primary-hover: #c65540;
      --primary-soft: #f9e1dc;
      --accent-pomodoro: #e0654f;
      --accent-shortBreak: #2f9e8f;
      --accent-longBreak: #5b53a6;
      --accent-soft-pomodoro: #f9e1dc;
      --accent-soft-shortBreak: #d9f2ee;
      --accent-soft-longBreak: #e6e2f7;
      --success: #2f9e57;
      --warning: #c98a1f;
      --danger: #c0392b;
      --radius-lg: 22px;
      --radius-md: 14px;
      --radius-sm: 9px;
      --shadow-md: 0 12px 34px rgba(36, 20, 16, 0.10);
      --shadow-lg: 0 24px 60px rgba(36, 20, 16, 0.16);
      --transition-fast: 0.16s ease;
      --transition-theme: 0.5s ease;
      --overlay-color: rgba(0, 0, 0, 0);
    }
  ```
  With:
  ```css
    :root {
      --bg: #faf7f5;
      --surface: #ffffff;
      --text: #241f1c;
      --text-muted: #7a716c;
      --border: rgba(36, 31, 28, 0.09);
      --accent: #e0654f;
      --accent-soft: #f9e1dc;
      --accent-contrast: #ffffff;
      --primary: #e0654f;
      --primary-hover: #c65540;
      --primary-soft: #f9e1dc;
      --accent-pomodoro: #e0654f;
      --accent-shortBreak: #2f9e8f;
      --accent-longBreak: #5b53a6;
      --accent-soft-pomodoro: #f9e1dc;
      --accent-soft-shortBreak: #d9f2ee;
      --accent-soft-longBreak: #e6e2f7;
      --success: #2f9e57;
      --warning: #c98a1f;
      --danger: #c0392b;
      --radius-lg: 22px;
      --radius-md: 14px;
      --radius-sm: 9px;
      --radius-pill: 999px;
      --shadow-xs: 0 1px 2px rgba(20, 16, 14, 0.06);
      --shadow-md: 0 10px 28px rgba(20, 16, 14, 0.08);
      --shadow-lg: 0 20px 48px rgba(20, 16, 14, 0.14);
      --transition-fast: 0.16s ease;
      --transition-theme: 0.5s ease;
      --overlay-color: rgba(0, 0, 0, 0);
      --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
      --font-serif: 'Fraunces', Georgia, serif;
      --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
      --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
      --text-2xs: 0.75rem; --text-xs: 0.8125rem; --text-sm: 0.875rem;
      --text-base: 1rem; --text-md: 1.0625rem; --text-lg: 1.25rem; --text-xl: 1.5rem;
      --text-display: clamp(2.25rem, 5vw, 3rem);
      --text-timer: clamp(3.6rem, 14vw, 6rem);
      --accent-gradient: linear-gradient(135deg, var(--accent-pomodoro), var(--accent-longBreak));
    }
  ```
  (`--shadow-md`/`--shadow-lg` keep their names — every consumer elsewhere in the file is unaffected by this step; only their values got softer and their RGB base moved from `36,20,16` to `20,16,14` to match the new backdrop-scrim tone already used elsewhere in the file.)

- [ ] **Step 3: Point `body` at the new font token.** Replace:
  ```css
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
  ```
  With:
  ```css
    font-family: var(--font-sans);
  ```

- [ ] **Step 4: Flatten `.glass` — drop the blur, go fully opaque.** Replace:
  ```css
    .glass {
      background: var(--surface-glass);
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      border: 1px solid var(--glass-border, rgba(255, 255, 255, 0.5));
      transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-theme), background-color var(--transition-theme);
    }
    @supports not (backdrop-filter: blur(1px)) {
      .glass { background: rgba(255, 255, 255, 0.94); }
    }
  ```
  With:
  ```css
    .glass {
      background: var(--surface);
      border: 1px solid var(--border);
      transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-theme), background-color var(--transition-theme);
    }
  ```

- [ ] **Step 5: Flatten `.icon-btn`.** Replace:
  ```css
    .icon-btn {
      width: 44px;
      height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface-glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: var(--text);
      font-size: 1.15rem;
      cursor: pointer;
      transition: transform var(--transition-fast), background-color var(--transition-fast);
    }
    .icon-btn:hover { transform: translateY(-1px); background-color: var(--surface); }
    .icon-btn:active { transform: translateY(0); }
  ```
  With:
  ```css
    .icon-btn {
      width: 44px;
      height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 1.15rem;
      cursor: pointer;
      transition: transform var(--transition-fast), background-color var(--transition-fast);
    }
    .icon-btn:hover { transform: translateY(-1px); background-color: color-mix(in srgb, var(--surface) 92%, var(--text) 8%); }
    .icon-btn:active { transform: translateY(0); }
  ```

- [ ] **Step 6: Outline `.btn-secondary`, token-ize `.btn`.** Replace:
  ```css
    .btn {
      border: none;
      border-radius: 999px;
      padding: 12px 26px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      min-height: 44px;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast), background-color var(--transition-fast);
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-primary {
      background: var(--accent);
      color: var(--accent-contrast);
      box-shadow: var(--shadow-md);
      padding-inline: 34px;
    }
    .btn-secondary {
      background: rgba(36, 31, 28, 0.06);
      color: var(--text);
    }
  ```
  With:
  ```css
    .btn {
      border: none;
      border-radius: var(--radius-pill);
      padding: 12px 26px;
      font-size: var(--text-sm);
      font-weight: 600;
      cursor: pointer;
      min-height: 44px;
      transition: transform var(--transition-fast), box-shadow var(--transition-fast), background-color var(--transition-fast), border-color var(--transition-fast);
    }
    .btn:hover { transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .btn-primary {
      background: var(--accent);
      color: var(--accent-contrast);
      box-shadow: var(--shadow-md);
      padding-inline: 34px;
    }
    .btn-secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
  ```

- [ ] **Step 7: Flatten `.live-users`** (the only other `--surface-glass` consumer). Replace:
  ```css
    background: var(--surface-glass); padding: 6px 12px; border-radius: 999px;
  ```
  With:
  ```css
    background: var(--surface); padding: 6px 12px; border-radius: var(--radius-pill);
  ```

- [ ] **Step 8: Remove the now-dead `--surface-glass`/`--glass-border` from `Theme.apply`.** Replace:
  ```js
      const rgb = hexToRgb(colors.surface);
      root.setProperty('--surface-glass', rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.66)` : null);
      const textRgb = hexToRgb(colors.text);
      root.setProperty('--glass-border', textRgb ? `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.14)` : null);
      document.documentElement.setAttribute('data-theme-preset', state.themeSettings.preset);
  ```
  With:
  ```js
      document.documentElement.setAttribute('data-theme-preset', state.themeSettings.preset);
  ```

- [ ] **Step 9: Confirm zero dangling references.** Run:
  ```bash
  grep -n "surface-glass\|glass-border" index.html
  ```
  Expected: no output (both names fully removed from CSS and JS).

- [ ] **Step 10: Verify via Playwright.**
  - Serve the directory (`npx serve -l 8080 .`), navigate to `http://localhost:8080`, confirm no console errors.
  - Confirm the page renders (header, nav, dashboard cards all visible) — `.glass` elements should now show a solid, non-blurred background (`getComputedStyle(document.querySelector('#timer')).backdropFilter` is `'none'`).
  - Confirm the Fraunces font actually loaded: `document.fonts.check("italic 16px Fraunces")` returns `true` after `await document.fonts.ready`.
  - Click through Dashboard → Reports → Leaderboard → Study Lounge nav and open Settings, Friends drawer, and Profile modal — everything should look unchanged in *layout* (only the blur/shadow/button styling differs) and every control should still work, since this task touched no ids or JS logic.
  - Toggle dark mode (`#darkmode-toggle`) — confirm the app switches to the `midnight` preset without errors and icon buttons/cards remain visible (flat surface, not invisible).

- [ ] **Step 11: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add editorial design tokens; flatten glass surfaces to opaque cards"
  ```

---

### Task 2: Header + top nav

**Files:**
- Modify: `index.html:176` (`#app-title`), `index.html:488,492` (user-profile overlays), `index.html:500-506` (`.nav-link`), `index.html:551-552` (`.lounge-chip`).

**Interfaces:**
- Consumes: `var(--text-lg)`, `var(--radius-sm)`, `var(--accent)`, `color-mix(...)` pattern from Task 1.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Give the app title more presence.** Replace:
  ```css
    #app-title { font-size: 1.15rem; color: var(--text); }
  ```
  With:
  ```css
    #app-title { font-size: var(--text-lg); font-weight: 800; letter-spacing: -0.02em; color: var(--text); }
  ```

- [ ] **Step 2: Fix the two hardcoded user-profile overlays.** Replace:
  ```css
    .user-profile__name:hover { background: rgba(36, 31, 28, 0.06); }
  ```
  With:
  ```css
    .user-profile__name:hover { background: color-mix(in srgb, var(--text) 6%, transparent); }
  ```
  Then replace:
  ```css
    .user-profile__avatar--emoji { font-size: 1.05rem; background: rgba(36, 31, 28, 0.06); color: inherit; }
  ```
  With:
  ```css
    .user-profile__avatar--emoji { font-size: 1.05rem; background: color-mix(in srgb, var(--text) 6%, transparent); color: inherit; }
  ```

- [ ] **Step 3: Give `.nav-link` an underline active-state instead of a filled pill.** Replace:
  ```css
    .nav-link {
      border: none; background: transparent; color: var(--text-muted); font-weight: 600; font-size: 0.85rem;
      padding: 8px 14px; border-radius: 999px; cursor: pointer; white-space: nowrap; flex-shrink: 0;
      transition: color var(--transition-fast), background-color var(--transition-fast);
    }
    .nav-link[aria-current="page"] { color: var(--accent-contrast); background: var(--accent); }
    .nav-link:not([aria-current="page"]):hover { background: rgba(36, 31, 28, 0.06); }
  ```
  With:
  ```css
    .nav-link {
      border: none; background: transparent; color: var(--text-muted); font-weight: 600; font-size: var(--text-sm);
      padding: 8px 4px; margin: 0 10px; border-radius: var(--radius-sm); cursor: pointer; white-space: nowrap; flex-shrink: 0;
      position: relative;
      transition: color var(--transition-fast), background-color var(--transition-fast);
    }
    .nav-link::after {
      content: ''; position: absolute; left: 4px; right: 4px; bottom: -5px; height: 2px;
      background: var(--accent); transform: scaleX(0); transition: transform var(--transition-fast);
    }
    .nav-link[aria-current="page"] { color: var(--text); font-weight: 700; background: transparent; }
    .nav-link[aria-current="page"]::after { transform: scaleX(1); }
    .nav-link:not([aria-current="page"]):hover { color: var(--text); background: color-mix(in srgb, var(--text) 6%, transparent); }
  ```

- [ ] **Step 4: Fix `.lounge-chip`'s hover overlay.** Replace:
  ```css
    .lounge-chip:hover { background: rgba(36, 31, 28, 0.08); }
  ```
  With:
  ```css
    .lounge-chip:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
  ```

- [ ] **Step 5: Verify via Playwright.**
  - Serve (`npx serve -l 8080 .`), navigate, confirm no console errors.
  - Confirm `#app-title` renders visibly larger/bolder than before.
  - Click `#nav-reports`: confirm `aria-current="page"` moves to it, its text goes bold/dark with a visible underline (`getComputedStyle(el, '::after').transform` is not `matrix(0, 0, 0, 1, 0, 0)` — i.e. not scaleX(0)), and `#nav-dashboard`'s underline disappears. Repeat for `#nav-leaderboard`/`#nav-lounge`.
  - Hover `#nav-dashboard` when it's not current: confirm a visible background tint appears and clears on mouseout.
  - Confirm `#darkmode-toggle`, `#mute-toggle`, `#friends-drawer-toggle`, `#settings-btn` all still open/toggle their targets correctly (unchanged ids/JS, styling only).

- [ ] **Step 6: Commit.**
  ```bash
  git add index.html
  git commit -m "style: give header and top nav an editorial underline treatment"
  ```

---

### Task 3: Dashboard — Stats + Timer (the hero moment)

**Files:**
- Modify: `index.html:415-440` (`#stats-dashboard`/`.stat-tile*`), `index.html:217-248` (`#timer`/`#active-task-display`/`#timer-display`).

**Interfaces:**
- Consumes: Task 1 tokens (`--space-*`, `--text-*`, `--font-serif`).
- Produces: nothing new consumed elsewhere. Note for Task 5: `.stat-tile`'s new rules are reused as-is by the Reports view's `.reports-summary` stat trio — no separate stat-tile styling needed there.

- [ ] **Step 1: Restyle the stats row — typographic, not boxed.** Replace:
  ```css
    #stats-dashboard {
      border-radius: var(--radius-lg);
      padding: clamp(16px, 3vw, 24px) clamp(20px, 4vw, 30px);
      box-shadow: var(--shadow-md);
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }
    .stat-tile { text-align: center; min-width: 0; }
    .stat-tile__value {
      display: block;
      font-size: clamp(1.25rem, 3vw, 1.6rem);
      font-weight: 800;
      color: var(--accent);
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }
    .stat-tile__label {
      display: block;
      font-size: 0.76rem;
      color: var(--text-muted);
      margin-top: 2px;
    }
    @media (max-width: 600px) {
      #stats-dashboard { grid-template-columns: repeat(2, 1fr); row-gap: 18px; }
    }
  ```
  With:
  ```css
    #stats-dashboard {
      border-radius: var(--radius-lg);
      padding: var(--space-5) clamp(20px, 4vw, 30px);
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--space-4);
    }
    .stat-tile { text-align: center; min-width: 0; position: relative; }
    .stat-tile:not(:first-child)::before {
      content: ''; position: absolute; left: calc(-1 * var(--space-4) / 2); top: 15%; bottom: 15%;
      width: 1px; background: var(--border);
    }
    .stat-tile__value {
      display: block;
      font-size: var(--text-xl);
      font-weight: 800;
      letter-spacing: -0.01em;
      color: var(--text);
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }
    .stat-tile__label {
      display: block;
      font-size: var(--text-2xs);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-top: 4px;
    }
    @media (max-width: 600px) {
      #stats-dashboard { grid-template-columns: repeat(2, 1fr); row-gap: 18px; }
      .stat-tile:nth-child(odd)::before { content: none; }
    }
  ```

- [ ] **Step 2: Give the timer its hero treatment.** Replace:
  ```css
    #timer {
      border-radius: var(--radius-lg);
      padding: clamp(24px, 4vw, 36px) clamp(20px, 4vw, 32px) 30px;
      box-shadow: var(--shadow-md);
      text-align: center;
    }

    #active-task-display {
      font-size: 0.92rem;
      color: var(--text-muted);
      min-height: 1.4em;
      margin-bottom: 18px;
      word-break: break-word;
    }
  ```
  With:
  ```css
    #timer {
      border-radius: var(--radius-lg);
      padding: clamp(24px, 4vw, 36px) clamp(20px, 4vw, 32px) 30px;
      text-align: center;
    }

    #active-task-display {
      font-family: var(--font-serif);
      font-style: italic;
      font-weight: 500;
      font-size: var(--text-md);
      letter-spacing: 0.01em;
      color: var(--text-muted);
      min-height: 1.4em;
      margin-bottom: var(--space-4);
      word-break: break-word;
    }
  ```

- [ ] **Step 3: Enlarge the countdown digits.** Replace:
  ```css
    #timer-display {
      font-size: clamp(3.4rem, 13vw, 5.4rem);
      font-weight: 800;
      line-height: 1;
      margin: 14px 0 22px;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
    }
  ```
  With:
  ```css
    #timer-display {
      font-size: var(--text-timer);
      font-weight: 800;
      line-height: 1;
      margin: var(--space-4) 0 var(--space-5);
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
    }
  ```

- [ ] **Step 4: Verify via Playwright.**
  - Serve, navigate, confirm no console errors.
  - Confirm `#timer-display` shows visibly larger text than before (still legible, still centered, no horizontal overflow at 1440px/1024px/375px viewport widths: `document.documentElement.scrollWidth === document.documentElement.clientWidth` at each).
  - At 375px width (mobile 2-column stat grid): confirm no `.stat-tile::before` divider visually overlaps a stat number or label (visually inspect a screenshot).
  - Confirm `#timer-toggle` (Start/Pause), `#timer-reset`, `#timer-skip`, and the three `.mode-tab` buttons still function exactly as before (unchanged ids/JS).
  - Select a task from the planner and confirm `#active-task-display` updates and now renders in the italic serif style.

- [ ] **Step 5: Commit.**
  ```bash
  git add index.html
  git commit -m "style: redesign stats row and timer as the dashboard's hero moment"
  ```

---

### Task 4: Dashboard — Missions, Tasks, AI Chat

**Files:**
- Modify: `index.html:443-473` (`#missions`/`.mission-item`/`.skill-row__bar`), `index.html:287-292` (`#tasks`), `index.html:745-792` (`#ai-chat`/`.chat-bubble--assistant`).

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Missions — drop the shadow, add a left-accent-bar per item, token-ize headings.** Replace:
  ```css
    #missions {
      border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px);
      box-shadow: var(--shadow-md);
    }
    #missions h2 { font-size: 1.05rem; margin-bottom: 4px; }
    #missions h3 {
      font-size: 0.74rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin: 18px 0 10px;
      font-weight: 700;
    }
    .missions-list { display: flex; flex-direction: column; gap: 10px; }
    .mission-item { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
  ```
  With:
  ```css
    #missions {
      border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px);
    }
    #missions h2 { font-size: var(--text-md); font-weight: 700; margin-bottom: 4px; }
    #missions h3 {
      font-size: var(--text-2xs);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin: 18px 0 10px;
      font-weight: 700;
    }
    .missions-list { display: flex; flex-direction: column; gap: var(--space-1); }
    .mission-item {
      display: flex; align-items: center; gap: 10px; font-size: 0.9rem;
      padding: var(--space-2) 0 var(--space-2) var(--space-3);
      border-left: 2px solid var(--border);
    }
    .mission-item--done {
      border-left: 2px solid transparent;
      border-image: var(--accent-gradient) 1;
    }
  ```
  (This is a deliberate simplification of the spec's "small index number or thin left accent bar" — the left accent bar, filled on completion, was chosen over a printed `01/02/03` digit because it doesn't compete visually with the existing checkbox + text row. The completed-state gradient border is also the spec's reserved "mission-complete / streak-milestone celebration accent" — spot #1 of 4 for `--accent-gradient`, reusing the same `border-image` technique Tasks 6 and 9 use for their two spots.)

- [ ] **Step 2: Fix the skill bar's hardcoded overlay.** Replace:
  ```css
    .skill-row__bar { height: 10px; border-radius: 999px; background: rgba(36, 31, 28, 0.08); overflow: hidden; }
  ```
  With:
  ```css
    .skill-row__bar { height: 10px; border-radius: var(--radius-pill); background: color-mix(in srgb, var(--text) 8%, transparent); overflow: hidden; }
  ```

- [ ] **Step 3: Tasks — drop the shadow, token-ize the heading.** Replace:
  ```css
    #tasks {
      border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px);
      box-shadow: var(--shadow-md);
    }
    #tasks h2 { font-size: 1.05rem; margin-bottom: 16px; }
  ```
  With:
  ```css
    #tasks {
      border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px);
    }
    #tasks h2 { font-size: var(--text-md); font-weight: 700; margin-bottom: var(--space-4); }
  ```

- [ ] **Step 4: AI chat — drop the shadow, token-ize the heading, fix the assistant bubble overlay.** Replace:
  ```css
    #ai-chat {
      border-radius: var(--radius-lg);
      padding: clamp(18px, 3vw, 24px);
      box-shadow: var(--shadow-md);
      display: flex;
      flex-direction: column;
      min-height: 360px;
    }
  ```
  With:
  ```css
    #ai-chat {
      border-radius: var(--radius-lg);
      padding: clamp(18px, 3vw, 24px);
      display: flex;
      flex-direction: column;
      min-height: 360px;
    }
  ```
  Then replace:
  ```css
    .ai-chat__header h2 { font-size: 1.05rem; }
  ```
  With:
  ```css
    .ai-chat__header h2 { font-size: var(--text-md); font-weight: 700; }
  ```
  Then replace:
  ```css
    .chat-bubble--assistant {
      align-self: flex-start; background: rgba(36, 31, 28, 0.06); color: var(--text); border-bottom-left-radius: 4px;
    }
  ```
  With:
  ```css
    .chat-bubble--assistant {
      align-self: flex-start; background: color-mix(in srgb, var(--text) 6%, transparent); color: var(--text); border-bottom-left-radius: 4px;
    }
  ```

- [ ] **Step 5: Verify via Playwright.**
  - Serve, navigate, confirm no console errors.
  - Add a task via `#task-form`, confirm it appears in `#task-list`, check its checkbox, confirm it marks done and unmarks correctly — unchanged JS, only surrounding chrome differs.
  - Check/uncheck a mission checkbox in `#missions-list`, confirm the item's left border switches from `var(--border)` to `var(--accent)` when marked done (`.mission-item--done` class already applied by existing JS).
  - If a Gemini key is not configured, confirm the AI chat empty/disabled state still renders and `#ai-chat-goto-settings` still opens Settings on the AI tab.
  - Confirm none of `#stats-dashboard`, `#timer`, `#missions`, `#tasks`, `#ai-chat` show a shadow at rest, but each shows `var(--shadow-lg)` on hover (already handled by the untouched shared hover rule at `index.html:163-165`).

- [ ] **Step 6: Commit.**
  ```bash
  git add index.html
  git commit -m "style: redesign missions, tasks, and AI chat cards"
  ```

---

### Task 5: Reports + Leaderboard

**Files:**
- Modify: `index.html:509-527` (`#view-reports`/`#view-leaderboard`/`.leaderboard-item*`).

**Interfaces:**
- Consumes: Task 1 tokens, Task 3's `.stat-tile` rules (reused unmodified by `.reports-summary`).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Drop the shadow, token-ize headings.** Replace:
  ```css
    #view-reports, #view-leaderboard {
      max-width: 1040px; margin: 0 auto; border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px); box-shadow: var(--shadow-md);
    }
    #view-reports h2, #view-leaderboard h2 { font-size: 1.1rem; margin-bottom: 4px; }
  ```
  With:
  ```css
    #view-reports, #view-leaderboard {
      max-width: 1040px; margin: 0 auto; border-radius: var(--radius-lg);
      padding: clamp(22px, 4vw, 30px);
    }
    #view-reports h2, #view-leaderboard h2 { font-size: var(--text-lg); font-weight: 700; margin-bottom: 4px; }
  ```

- [ ] **Step 2: Fix the leaderboard row overlay, give the rank number an editorial treatment.** Replace:
  ```css
    .leaderboard-item {
      display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--radius-md);
      background: rgba(36, 31, 28, 0.04); font-size: 0.88rem;
    }
    .leaderboard-item__rank { font-weight: 800; color: var(--accent); min-width: 28px; }
  ```
  With:
  ```css
    .leaderboard-item {
      display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--text) 4%, transparent); font-size: 0.88rem;
    }
    .leaderboard-item__rank {
      font-family: var(--font-serif); font-style: italic; font-weight: 600;
      font-size: 1.1rem; color: var(--accent); min-width: 28px;
    }
  ```

- [ ] **Step 3: Verify via Playwright.**
  - Serve, navigate, click `#nav-reports`: confirm the weekly stat trio (`.reports-summary .stat-tile`) renders with the same typographic style as the Dashboard's stat row, and the bar chart still renders per-day bars.
  - Click `#nav-leaderboard`: confirm ranked entries render, each rank number now in italic serif, and the list is still sorted correctly (unchanged JS).
  - Confirm neither view shows a shadow at rest.

- [ ] **Step 4: Commit.**
  ```bash
  git add index.html
  git commit -m "style: redesign Reports and Leaderboard views"
  ```

---

### Task 6: Study Lounge (lobby + active-room dashboard)

**Files:**
- Modify: `index.html:660-742` (`#view-lounge` through `.lounge-activity-item`).

**Interfaces:**
- Consumes: Task 1 tokens, especially `--accent-gradient` and `--space-6`/`--space-7`.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Turn the existing `h3` section labels into the eyebrow treatment (no HTML change — one shared selector already covers Friends/Room/Members/Activity).** Replace:
  ```css
    #view-lounge h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 18px 0 10px; font-weight: 700; }
  ```
  With:
  ```css
    #view-lounge h3 {
      font-family: var(--font-serif); font-style: italic; font-weight: 500; text-transform: none;
      font-size: var(--text-md); letter-spacing: 0.01em; color: var(--text-muted);
      margin: var(--space-5) 0 var(--space-2);
    }
  ```
  (This is the spec's "eyebrow + heading pair" simplified to a single eyebrow-styled label — the existing `h3` text ("Friends"/"Room"/"Members"/"Activity") already *is* the section identity; adding a second, redundant heading above it would just be noise.)

- [ ] **Step 2: Widen the lobby and dashboard gutters.** Replace:
  ```css
    .lounge-lobby-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px; }
  ```
  With:
  ```css
    .lounge-lobby-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6); margin-top: 8px; }
  ```
  Then replace:
  ```css
    .lounge-dashboard {
      display: grid;
      grid-template-columns: minmax(260px, 320px) 1fr minmax(260px, 340px);
      gap: 24px;
      align-items: start;
    }
  ```
  With:
  ```css
    .lounge-dashboard {
      display: grid;
      grid-template-columns: minmax(260px, 320px) 1fr minmax(260px, 340px);
      gap: var(--space-8);
      align-items: start;
    }
  ```

- [ ] **Step 3: Drop the panel shadow.** Replace:
  ```css
    .lounge-panel { border-radius: var(--radius-lg); padding: clamp(20px, 3vw, 26px); box-shadow: var(--shadow-md); }
  ```
  With:
  ```css
    .lounge-panel { border-radius: var(--radius-lg); padding: clamp(20px, 3vw, 26px); }
  ```

- [ ] **Step 4: Fix the three hardcoded overlays in the member grid / mission chips / activity log.** Replace:
  ```css
    .lounge-grid-card {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
      padding: 16px 10px; border-radius: var(--radius-md); background: rgba(36, 31, 28, 0.04);
    }
  ```
  With:
  ```css
    .lounge-grid-card {
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
      padding: 16px 10px; border-radius: var(--radius-md); background: color-mix(in srgb, var(--text) 4%, transparent);
    }
  ```
  Then replace:
  ```css
    .lounge-mission-chip {
      padding: 4px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 700;
      background: rgba(36, 31, 28, 0.08); color: var(--text-muted);
    }
  ```
  With:
  ```css
    .lounge-mission-chip {
      padding: 4px 10px; border-radius: var(--radius-pill); font-size: 0.76rem; font-weight: 700;
      background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text-muted);
    }
  ```
  Then replace:
  ```css
    .lounge-activity-item {
      font-size: 0.82rem; color: var(--text-muted); padding: 8px 10px;
      border-radius: var(--radius-sm); background: rgba(36, 31, 28, 0.04);
    }
  ```
  With:
  ```css
    .lounge-activity-item {
      font-size: 0.82rem; color: var(--text-muted); padding: 8px 10px;
      border-radius: var(--radius-sm); background: color-mix(in srgb, var(--text) 4%, transparent);
    }
  ```
  Then replace:
  ```css
    .lounge-friend-item {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-md);
      background: rgba(36, 31, 28, 0.04); font-size: 0.88rem; flex-wrap: wrap;
    }
  ```
  With:
  ```css
    .lounge-friend-item {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--text) 4%, transparent); font-size: 0.88rem; flex-wrap: wrap;
    }
  ```

- [ ] **Step 5: Give the group mission panel the gradient-accent treatment (reserved spot #2 of 4).** Replace:
  ```css
    #lounge-mission { border-top: 1px solid var(--border); padding-top: 16px; }
  ```
  With:
  ```css
    #lounge-mission {
      border-top: 2px solid transparent; border-image: var(--accent-gradient) 1;
      padding-top: var(--space-4); margin-top: var(--space-4);
    }
  ```

- [ ] **Step 6: Verify via Playwright.**
  - Serve, navigate, click `#nav-lounge`.
  - In the Lobby: confirm the Friends and Room sections' `h3` labels now render italic serif, add a friend via `#lounge-add-friend-form`, confirm it appears in the list.
  - Create a room via `#lounge-create-room-form`, confirm `#lounge-active` becomes visible with its 3-column dashboard, member grid, and activity log all rendering with the new flat card styling.
  - Confirm `#lounge-mission`'s top border renders the two-tone gradient (not a flat single color) — `getComputedStyle(el).borderImageSource` should contain `linear-gradient`.
  - Confirm "Invite to Room" still works from inside an active room (the specific regression the prior Lounge redesign called out as highest-risk) — this task doesn't touch any Lounge JS, but confirm explicitly per that precedent.
  - Confirm no horizontal overflow at 1440px, 1024px, and 375px (the dashboard collapses to 1 column under 1100px per the existing, untouched breakpoint).

- [ ] **Step 7: Commit.**
  ```bash
  git add index.html
  git commit -m "style: redesign Study Lounge lobby and active-room dashboard"
  ```

---

### Task 7: Settings dialog

**Files:**
- Modify: `index.html:815-819` (`.settings-tabs [role="tab"]`), `index.html:881-886` (`.track-list li`).

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Token-ize the tab bar (already uses an underline-on-selected pattern — just formalize sizes).** Replace:
  ```css
    .settings-tabs [role="tab"] {
      border: none; background: transparent; padding: 10px 14px; font-weight: 600; font-size: 0.86rem;
      color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
      min-height: 40px; flex: 0 0 auto; white-space: nowrap;
    }
  ```
  With:
  ```css
    .settings-tabs [role="tab"] {
      border: none; background: transparent; padding: 10px var(--space-3); font-weight: 600; font-size: var(--text-sm);
      color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
      min-height: 40px; flex: 0 0 auto; white-space: nowrap;
    }
  ```

- [ ] **Step 2: Fix the track-list's light-only overlay.** Replace:
  ```css
    .track-list li {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm); background: rgba(255,255,255,0.5);
      border: 1px solid transparent; cursor: pointer; font-size: 0.9rem; font-weight: 500;
    }
    .track-list li:hover { background: rgba(255,255,255,0.85); }
  ```
  With:
  ```css
    .track-list li {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 10px 12px; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--text) 4%, transparent);
      border: 1px solid transparent; cursor: pointer; font-size: 0.9rem; font-weight: 500;
    }
    .track-list li:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
  ```

- [ ] **Step 3: Verify via Playwright.**
  - Serve, navigate, open `#settings-btn`.
  - Click through all 5 tabs (Timer/Background/Music/Appearance/AI Assistant), confirm each panel still shows/hides correctly and the selected tab's underline still tracks the click.
  - On the Music tab, confirm `#music-track-list` rows render with a visible (not washed-out) background in both `default` and `midnight` presets.
  - **This is the one panel that must not visually fight the user's own customization**: open Appearance, change the Primary color picker, confirm the change still applies live and the tab bar / track list still read correctly against an arbitrary user color.
  - Confirm Save/Cancel (`#settings-save`/`#settings-close`) still work.

- [ ] **Step 4: Commit.**
  ```bash
  git add index.html
  git commit -m "style: token-ize Settings tab bar and fix dark-preset track list contrast"
  ```

---

### Task 8: Friends drawer, chat dialog, invite toast, media panel

**Files:**
- Modify: `index.html:579` (`.chat-dialog__message--friend`), `index.html:949,954` (`#media-panel button`).

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Fix the chat bubble overlay.** Replace:
  ```css
    .chat-dialog__message--friend { align-self: flex-start; background: rgba(36, 31, 28, 0.06); }
  ```
  With:
  ```css
    .chat-dialog__message--friend { align-self: flex-start; background: color-mix(in srgb, var(--text) 6%, transparent); }
  ```

- [ ] **Step 2: Fix the two media-panel button overlays.** Replace:
  ```css
    #media-panel button {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: none;
      background: rgba(36, 31, 28, 0.08);
      cursor: pointer;
      font-size: 1rem;
      flex-shrink: 0;
    }
    #media-panel button:hover { background: rgba(36, 31, 28, 0.16); }
  ```
  With:
  ```css
    #media-panel button {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: none;
      background: color-mix(in srgb, var(--text) 8%, transparent);
      cursor: pointer;
      font-size: 1rem;
      flex-shrink: 0;
    }
    #media-panel button:hover { background: color-mix(in srgb, var(--text) 16%, transparent); }
  ```

- [ ] **Step 3: Verify via Playwright.**
  - Serve, navigate, open the Friends drawer (`#friends-drawer-toggle`), confirm it still slides in as a flat elevated surface (unchanged — it already used `var(--surface)`/`var(--shadow-lg)`, no edit needed there).
  - Open a direct chat from a friend, send a message, confirm `.chat-dialog__message--friend`/`--me` bubbles render with correct contrast.
  - Trigger an invite toast (or inspect `#invite-toast` directly) — confirm Accept/Dismiss still work.
  - If a custom background video/image is active, confirm `#media-panel`'s play/mute buttons remain visible and clickable.

- [ ] **Step 4: Commit.**
  ```bash
  git add index.html
  git commit -m "style: fix dark-preset overlays in chat dialog and media panel"
  ```

---

### Task 9: Profile modal + Auth modal

**Files:**
- Modify: `index.html:616-623` (`.profile-modal__title-badge`/`.profile-modal__stat-value`), `index.html:625-629` (`.profile-modal__emoji-picker`), `index.html:646-652` (`.auth-modal__form h2`/`.auth-modal__tabs`).

**Interfaces:**
- Consumes: Task 1 tokens, especially `--accent-gradient` (spot #3 of 4).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Give the profile title badge the gradient-accent treatment (reserved spot #3 of 4).** Replace:
  ```css
    .profile-modal__title-badge {
      background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 0.78rem;
      padding: 4px 12px; border-radius: 999px;
    }
  ```
  With:
  ```css
    .profile-modal__title-badge {
      background: var(--accent-gradient); color: #fff; font-weight: 700; font-size: var(--text-xs);
      padding: 4px 12px; border-radius: var(--radius-pill);
    }
  ```

- [ ] **Step 2: Make the profile stat values match the Dashboard's neutral stat treatment.** Replace:
  ```css
    .profile-modal__stat-value { font-size: 1.1rem; font-weight: 800; color: var(--accent); }
  ```
  With:
  ```css
    .profile-modal__stat-value { font-size: var(--text-md); font-weight: 800; color: var(--text); }
  ```

- [ ] **Step 3: Fix the emoji picker's two hardcoded overlays.** Replace:
  ```css
    .profile-modal__emoji-picker button {
      border: none; background: rgba(36, 31, 28, 0.06); font-size: 1.1rem; width: 34px; height: 34px;
      border-radius: var(--radius-sm); cursor: pointer;
    }
    .profile-modal__emoji-picker button:hover { background: rgba(36, 31, 28, 0.12); }
  ```
  With:
  ```css
    .profile-modal__emoji-picker button {
      border: none; background: color-mix(in srgb, var(--text) 6%, transparent); font-size: 1.1rem; width: 34px; height: 34px;
      border-radius: var(--radius-sm); cursor: pointer;
    }
    .profile-modal__emoji-picker button:hover { background: color-mix(in srgb, var(--text) 12%, transparent); }
  ```

- [ ] **Step 4: Give the auth modal its welcome-hero treatment (reserved gradient spot #4 of 4) and fix its tab-background overlay.** Replace:
  ```css
    .auth-modal__form h2 { font-size: 1.15rem; text-align: center; }
    .auth-modal__tabs { display: flex; gap: 6px; background: rgba(36, 31, 28, 0.06); border-radius: var(--radius-sm); padding: 4px; }
  ```
  With:
  ```css
    .auth-modal__form h2 {
      font-family: var(--font-serif); font-style: italic; font-weight: 500;
      font-size: clamp(1.75rem, 8vw, 2.25rem); text-align: center; color: var(--text);
      padding-top: var(--space-3);
      border-top: 3px solid transparent; border-image: var(--accent-gradient) 1;
    }
    .auth-modal__tabs { display: flex; gap: 6px; background: color-mix(in srgb, var(--text) 6%, transparent); border-radius: var(--radius-sm); padding: 4px; }
  ```

- [ ] **Step 5: Verify via Playwright.**
  - Serve, navigate, open the profile modal (click the avatar or `#user-name-display`).
  - Confirm the title badge renders the two-tone gradient background with legible white text (`getComputedStyle(el).backgroundImage` contains `linear-gradient`).
  - Click `#profile-modal-edit-btn`, confirm the emoji picker renders and each emoji button is clickable with visible hover contrast.
  - Log out / open the auth modal (or inspect `#auth-modal` directly): confirm "Welcome" renders large and italic with a visible gradient rule above it, and does not wrap awkwardly or overflow the 380px-wide dialog at any viewport width.
  - Click between `#auth-tab-login`/`#auth-tab-signup`, confirm panels still switch correctly; confirm login/signup/guest buttons still work (unchanged JS).

- [ ] **Step 6: Commit.**
  ```bash
  git add index.html
  git commit -m "style: redesign profile modal and give the auth modal a welcome-hero treatment"
  ```

---

### Task 10: Entrance motion + full regression/preset/responsive sweep

**Files:**
- Modify: `index.html` (add one new `@keyframes` + 2 rules near the end of the `<style>` block, right before the existing `@media (prefers-reduced-motion: reduce)` block at line ~975).

**Interfaces:**
- Consumes: everything from Tasks 1–9.
- Produces: nothing new — this is the plan's final verification task.

- [ ] **Step 1: Add a one-time dashboard entrance animation.** Insert immediately before the existing reduced-motion block:
  ```css
    @keyframes card-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    #view-dashboard > #stats-dashboard,
    #view-dashboard .col-left > section,
    #view-dashboard .col-right > section {
      animation: card-enter 0.35s ease both;
    }
    #view-dashboard .col-left > section:nth-child(2) { animation-delay: 0.04s; }
    #view-dashboard .col-right > section:nth-child(2) { animation-delay: 0.08s; }
  ```
  No separate reduced-motion rule is needed — the existing block at `index.html:975-982` uses the universal selector `*, *::before, *::after` and already forces `animation-duration: 0.001ms !important` for everything, including this new animation.

- [ ] **Step 2: Verify reduced motion.** In Playwright, emulate `prefers-reduced-motion: reduce` (`page.emulateMedia({ reducedMotion: 'reduce' })`), reload, and confirm the dashboard cards appear immediately with no visible fade/rise (check that `getComputedStyle(el).animationDuration` resolves to a near-zero value).

- [ ] **Step 3: Full console/error sweep.** Serve, navigate, open the browser console, and click through every nav destination, every modal, and every Settings tab listed in Step 4 below. Confirm zero new console errors or warnings at any point.

- [ ] **Step 4: Full functional regression** (this is the spec's §9 checklist, run explicitly):
  - Every nav destination (Dashboard/Reports/Leaderboard/Lounge) opens and renders.
  - Timer start/pause/reset/skip and mode switching work.
  - Task create/complete/delete works.
  - Every Settings tab's controls work, including the live color pickers and background/music upload.
  - Dark mode toggle (`midnight` preset) works.
  - Friends drawer, direct chat, invite toast work.
  - Profile modal view/edit (including photo upload) works.
  - Auth modal login/signup/guest/account-switch works.
  - Study Lounge lobby create/join and active-room dashboard (members, activity log, mission, Invite to Room from inside a room) all work.

- [ ] **Step 5: All-preset spot-check.** In Settings → Appearance, cycle through all 15 presets one at a time (`default`, `midnight`, `ocean`, `forest`, `sunset`, `lavender`, `minimal`, `cyberpunk`, `warm`, `monochrome`, `apex`, `lofi`, `coastal`, `terminal`, `deepmesh`). For each: confirm text is legible against its background, card borders are visible (not blending into the background), and — on the Lounge mission panel and profile title badge — confirm `--accent-gradient` renders as a visible two-tone gradient, not a flat color (this is the plan's #1 Review Focus item; if any preset's `accentPomodoro`/`accentLongBreak` are too close to distinguish, note it, but do not change the spec's palette values to fix it — that's out of scope per Global Constraints).

- [ ] **Step 6: Responsive sweep.** At 1440px, 1024px, 768px, and 375px widths, confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth` (no horizontal overflow) on the Dashboard, Reports, Leaderboard, and Study Lounge views.

- [ ] **Step 7: Commit.**
  ```bash
  git add index.html
  git commit -m "feat: add reduced-motion-safe dashboard entrance animation; final redesign polish pass"
  ```
