# Visual Redesign — Design Spec

Date: 2026-09-24
Branch: `auth-login-system`
Status: approved (conversational design), pending spec review

## 1. Goal

Redesign how the existing Pomodoro app *looks*, not what it *does*. Every
feature, page, flow, piece of content, and interaction present today must
still be present after this work: Dashboard (stats, timer, missions,
tasks, AI chat), Reports, Leaderboard, Study Lounge (lobby + active-room
3-column dashboard), Settings (Timer/Background/Music/Appearance/AI
tabs), Friends drawer + direct chat, invite toasts, Profile modal
(view/edit), and the local Auth modal (login/signup/guest + account
switching) just committed in `1385df6`.

Visual quality benchmark: `https://framebloxpages.framer.website/landing/06`
(a Framer productivity-app landing page — "Enblox"). This is a style
reference only; nothing from it is cloned (no copy, no imagery, no exact
layout).

## 2. What the reference actually does (extracted principles)

Confirmed by rendering the page:

- Cream/white background, near-black text, muted gray body copy — already
  close to this app's existing `--bg: #faf7f5` / `--text: #241f1c`.
- Huge, bold, tight-tracking sans headlines, paired with a small **italic
  serif accent line** above the headline ("Your Day, in Perfect
  Rhythm.") and occasionally *inside* a headline as an emphasis word
  ("Do More *With Less*"). The serif is used sparingly, never for body
  text or dense UI.
- Very generous vertical whitespace between sections; each section reads
  as its own breath, not packed against its neighbor.
- Pill-shaped outlined buttons (already this app's button shape).
- Plain, flat 3-column feature grids: icon-free or icon-light, a heading,
  a short paragraph — no card chrome, no shadow, just spacing and a thin
  rule.
- One vivid full-bleed purple→pink→orange gradient photo section used
  exactly twice on the whole page (hero backdrop, closing CTA) — reserved
  for the two highest-impact moments, not decoration.
- Flat "trusted by" logo tiles: solid light-gray fill, no border, no
  shadow.

Explicitly **not** adopted: the literal purple/pink/orange gradient
(this app's accent identity is coral/teal/indigo tied to timer modes —
see §4.2), marketing-page structures that don't apply to a logged-in tool
(logo wall, pricing), and any glassmorphism/blur (this app currently has
it; the reference doesn't, and Phase 12 of the brief explicitly asks to
move away from it).

## 3. Hard constraints (must not break)

1. **Single-file architecture.** Everything lives in `index.html`
   (~5000 lines: inline `<style>` 11–983, HTML 987–1537, inline
   `<script>` 1538–5016). Redesign work happens in this file.
2. **CSS-custom-property theming is the product, not implementation
   detail.** `state.themeSettings` writes `--bg`, `--surface`, `--text`,
   `--text-muted`, `--border`, `--primary`, `--accent-pomodoro`,
   `--accent-shortBreak`, `--accent-longBreak`, etc. directly onto
   `:root` at runtime (`Theme.apply`/`Theme.applyPreset`,
   `index.html:3008-3044`). There are **fifteen** presets users can pick
   in Settings → Appearance (`Theme.PRESETS`, `index.html:2990-3005`):
   `default`, `midnight` (dark mode), `ocean`, `forest`, `sunset`,
   `lavender`, `minimal`, `cyberpunk`, `warm`, `monochrome`, `apex`,
   `lofi`, `coastal`, `terminal`, `deepmesh` — seven of them (`midnight`,
   `sunset`, `cyberpunk`, `apex`, `lofi`, `terminal`, `deepmesh`) are
   dark backgrounds, `monochrome` is a light preset despite the name
   (white bg, black text) — plus per-channel color pickers that let a user override any of those
   variables individually, live. **Every visual change in this redesign
   must be expressed in terms of these variables (or new variables added
   the same way), never hardcoded colors**, so all fifteen presets and
   any user override keep working. Dark mode is not a separate code
   path — it's the `midnight` preset — so there is no
   `prefers-color-scheme`/`[data-theme=dark]` branch to maintain
   separately.
3. **Existing hardcoded neutral overlays assume a light background and
   are visibly broken on the eight dark presets today** — e.g.
   `.nav-link:not([aria-current="page"]):hover { background: rgba(36,
   31, 28, 0.06); }` (`index.html:506`) puts a near-invisible dark-brown
   tint on an already-dark surface. About 20 such literal
   `rgba(36, 31, 28, *)` / `rgba(255,255,255, *)` overlays exist across
   hover states, chips, chat bubbles, and the track list — all in
   components this redesign touches directly. Each one is replaced with
   `color-mix(in srgb, var(--text) N%, transparent)` (or `var(--surface)`
   for the track list, which sits on `var(--surface)` not `var(--bg)`),
   preserving the same opacity feel while making it theme-correct.
   Dialog/drawer backdrop scrims (`rgba(20, 16, 14, 0.45)`, used behind
   modals) and the Apex preset's decorative carbon-fibre texture
   (`index.html:90-91`) are intentionally excluded — both are meant to
   stay a fixed dark tone regardless of the active theme.
4. **No feature, route, or flow removal.** Nav items (Dashboard, Reports,
   Leaderboard, Study Lounge), all modals/dialogs, the friends drawer,
   chat, toasts, and account switching all stay.
5. **No JS behavior changes** except where a markup change requires
   updating a selector/class the JS queries (e.g. renaming `.glass` →
   a new surface class touched in multiple places) — those are
   mechanical, not behavioral.

## 4. Design system

### 4.1 Typography

- **UI/body face stays Inter** (already loaded). No change to weight
  availability (400/500/600/700/800 already imported).
- **Add Fraunces** (italic, variable, Google Fonts) as a second,
  deliberately sparing display face:
  ```
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,500;1,9..144,600&display=swap" rel="stylesheet">
  ```
  `--font-serif: 'Fraunces', Georgia, serif;` italic only. Used for: the
  `.eyebrow` label pattern (small italic line above a section/card
  heading), modal welcome headings (auth modal "Welcome"), empty-state
  copy, and milestone/celebration callouts (mission complete, streak
  hit). **Never** for the countdown digits, body copy, buttons, form
  labels, or dense data (task rows, chat messages, leaderboard) — those
  stay Inter for scannability.
- Type scale (new custom properties, replacing today's scattered
  one-off `font-size` values):
  | token | size | typical weight | use |
  |---|---|---|---|
  | `--text-2xs` | 0.75rem | 600 | tiny meta (timestamps, counts) |
  | `--text-xs` | 0.8125rem | 500–600 | field labels, badges |
  | `--text-sm` | 0.875rem | 400–600 | secondary body, buttons |
  | `--text-base` | 1rem | 400 | body |
  | `--text-md` | 1.0625rem | 600–700 | card titles (`h2` inside cards) |
  | `--text-lg` | 1.25rem | 700 | modal/section titles |
  | `--text-xl` | 1.5rem | 700–800 | page-level headings (Lounge, Reports) |
  | `--text-display` | `clamp(2.25rem, 5vw, 3rem)` | 800 | auth welcome, big empty states |
  | `--text-timer` | `clamp(3.6rem, 14vw, 6rem)` | 800 | timer digits (up from current `clamp(3.4rem,13vw,5.4rem)`) |
  Headings get `letter-spacing: -0.02em` to `-0.01em` (tightened from
  today's mostly-default tracking). Eyebrows get `letter-spacing: 0.02em`,
  italic, `color: var(--text-muted)`.

### 4.2 Color & theming

No new palette — the existing per-preset token set is kept exactly as-is
(all fifteen presets' hex values unchanged) so nothing about the
theming *feature* changes. What changes is how those tokens get used:

- Push text contrast slightly: no token value changes needed for
  `default` (`--text: #241f1c` already reads near-black); component
  CSS stops using low-contrast overlays for things like secondary button
  backgrounds (see §4.4).
- **New token**: `--accent-gradient: linear-gradient(135deg,
  var(--accent-pomodoro), var(--accent-longBreak))`, declared once as a
  plain CSS rule (alongside the other cross-preset derived rules at
  `index.html:43-45`). No JS or per-preset changes needed — because
  `--accent-pomodoro`/`--accent-longBreak` are already set per-preset by
  `Theme.apply` (and directly overridable via the Appearance color
  pickers), this token is automatically correct for all fifteen presets
  and any live user override, with zero additional plumbing. This is the
  one "vivid gradient" moment from the reference, kept on-brand and
  theme-safe. Reserved for exactly four spots: the profile modal's title
  badge, a mission-complete / streak-milestone celebration accent, the
  Lounge active-room mission banner, and a thin accent bar behind the
  auth modal's welcome heading. Never used as a background wash or
  decoration.

### 4.3 Spacing

New 8px-based scale as custom properties: `--space-1: 4px` through
`--space-9: 64px` (1/2/3/4/6/8/12/16/24 × 4px, i.e. 4/8/12/16/24/32/48/
64px — skipping straight from 16→24→32 to match the existing 16/24
rhythm already in the CSS). Applied so that:
- **Within** a card (e.g. between a task row and the next), spacing stays
  tight — unchanged from today.
- **Between** major regions (header→nav, nav→main, between the three
  Lounge panels, between Settings tab-panel groups) spacing opens up to
  `--space-7`/`--space-8` (32–48px), which is the actual mechanism behind
  the reference's "generous whitespace" — it's a gap between blocks, not
  bigger padding inside every element.

### 4.4 Surfaces, radius, elevation

- **Drop `.glass` (blur) everywhere.** Replace with a flat `.surface`
  treatment: `background: var(--surface)` (fully opaque, not the
  translucent `--surface-glass` token — that variable and its consumers
  go away), `border: 1px solid var(--border)`, `border-radius:
  var(--radius-lg)`. This is a net legibility win over any custom
  background image/video/YouTube a user has set, since opaque cards
  don't need blur-tuning to stay readable.
- Cards are **border-only at rest** — no shadow. Shadow (`--shadow-md`)
  appears only on hover/focus and on genuinely elevated surfaces
  (dialogs, the friends drawer, dropdown-like popovers, toasts). This
  replaces the current always-on `box-shadow: var(--shadow-md)` on
  `#timer`/`#tasks`/etc.
- Shadow tokens get softer/tighter (less spread, lower opacity) to read
  as "premium," not "floating card":
  `--shadow-xs: 0 1px 2px rgba(20,16,14,.06)` (new — inputs, chips),
  `--shadow-md: 0 10px 28px rgba(20,16,14,.08)` (hover elevation),
  `--shadow-lg: 0 20px 48px rgba(20,16,14,.14)` (modals/drawer).
- Radius tokens unchanged (`--radius-lg: 22px`, `--radius-md: 14px`,
  `--radius-sm: 9px`), plus a formal `--radius-pill: 999px` naming what
  buttons/tabs already use.
- Icon buttons (`.icon-btn`: avatar, dark-mode/mute/friends/settings
  toggles) go from blurred translucent circles to flat bordered circles
  matching `.surface`.

### 4.5 Motion

Keep `--transition-fast` (0.16s) and `--transition-theme` (0.5s)
unchanged. Add one new pattern: dashboard cards fade+rise in on initial
load (8px translateY, ~250ms, ~40ms stagger per card) — subtle, one-time,
not on every re-render. All new motion is added inside the existing
`@media (prefers-reduced-motion: reduce)` block (`index.html:975`) as a
"disable" rule, matching how reduced-motion is already handled.

## 5. Component-level redesign notes

Only calling out changes; anything not mentioned keeps its current
structure/behavior and just inherits the new tokens.

- **Header** (`header`, `#app-title`, `.user-profile`, icon buttons):
  `#app-title` moves to `--text-lg`, tighter tracking. Icon buttons flat
  (see §4.4). Layout/order unchanged.
- **Top nav** (`.top-nav`, `.nav-link`): active state moves from a
  filled pill (`background: var(--accent)`) to an underline/text-weight
  treatment (`color: var(--text)`, `font-weight: 700`, a 2px accent
  underline) so it doesn't visually compete with the timer's pill tabs
  one section down. Hover stays a light background tint.
- **Stats dashboard** (`#stats-dashboard`, `.stat-tile`): less "4 boxed
  mini-cards," more typographic — bigger number (`--text-xl`+,
  tabular-nums), small-caps-style label below, thin vertical dividers
  between tiles instead of individual tile backgrounds. Still one
  `.surface` card overall.
- **Timer** (`#timer`, `.mode-tabs`, `#timer-display`): the hero moment
  of the app — gets the most size/confidence. Digits move to
  `--text-timer`. `#active-task-display` above it becomes an `.eyebrow`
  (italic serif, muted). Mode tabs keep their current filled-pill
  selected state (already matches the button language; no change other
  than token updates).
- **Missions** (`#missions`, `.missions-list`): adopt the reference's
  numbered-list pattern — each mission gets a small index number or thin
  left accent bar instead of being a plain stacked list, echoing the
  "Get More Done / Stay Clear & Focused / Take Control" treatment from
  the reference's feature list.
- **Tasks** (`#tasks`, `#task-form`, `#task-list`): form inputs get the
  new flat surface + `--shadow-xs` treatment on focus; task rows get
  clearer priority/estimate typography using the new scale. No structural
  change.
- **AI chat** (`#ai-chat`): status pill and empty/disabled states
  restyled with the new tokens; disconnected-state copy can use the
  `.eyebrow` treatment for its explanatory line.
- **Reports** (`#view-reports`, `.bar-chart`): stat trio restyled like
  the dashboard stat tiles; bar chart gets `--accent` bars on a flatter
  track (no change to the underlying per-day data or chart logic).
- **Leaderboard** (`#view-leaderboard`): list rows get clearer rank
  typography (rank number in serif italic as a subtle "trophy" touch,
  since this is exactly the kind of milestone moment §4.2's gradient
  accent is reserved for — top-3 rows only).
- **Study Lounge** (`#view-lounge`, lobby grid, `#lounge-active` 3-column
  dashboard): wider gutters between the three panels (`--space-8`),
  each panel gets an `.eyebrow` + heading pair instead of a plain `h2`,
  member grid cards flattened to match §4.4. The mission banner
  (`#lounge-mission`) is one of the four approved spots for
  `--accent-gradient`.
- **Settings dialog** (`#settings`, five tabs): tab bar restyled to
  match the nav's underline treatment for consistency; color-picker rows
  in the Appearance tab keep their exact current functionality, just
  laid out with the new spacing scale. This tab is the one place the
  redesign must visibly *not* fight the user's own customization — it
  stays the most neutral/utilitarian panel in the app.
- **Friends drawer + chat dialog** (`#friends-drawer`, `#chat-dialog`):
  drawer becomes a flat elevated surface (`--shadow-lg`, no blur backdrop
  change needed — the dark scrim behind it is unrelated to `.glass`).
  Chat bubbles restyled with the new radius/spacing tokens.
- **Invite toast** (`#invite-toast`): flat surface, `--shadow-lg`, same
  position/behavior.
- **Profile modal** (`#profile-modal`): avatar/pfp area gets more
  breathing room; the title badge is one of the four `--accent-gradient`
  spots; stats row (XP/Friends/Followers/Hours) restyled like the
  dashboard stat tiles for visual consistency across the app.
- **Auth modal** (`#auth-modal`): gets the strongest "reference" treatment
  since it's the one place a welcome/hero moment makes sense —
  `.eyebrow` + `--text-display` "Welcome" heading, thin `--accent-gradient`
  accent bar, tabs restyled to match Settings' tab treatment. The
  existing "this app runs entirely on your device" disclosure copy stays
  verbatim (it's product content, not presentation).

## 6. Cross-cutting requirements

- **All fifteen theme presets** (`default`, `midnight`, `ocean`, `forest`,
  `sunset`, `lavender`, `minimal`, `cyberpunk`, `warm`, `monochrome`,
  `apex`, `lofi`, `coastal`, `terminal`, `deepmesh`) must be spot-checked
  after the redesign — every new style rule is written against custom
  properties, never a literal preset color, so this should hold
  automatically, but `terminal`'s existing `.glass` override
  (`index.html:112`, currently disabling blur and forcing flat already)
  needs to be reconciled since `.glass` itself is going away, and the
  ~20 hardcoded `rgba(36, 31, 28, *)` / `rgba(255,255,255, *)` overlays
  from §3 constraint 3 must all be converted for the seven dark presets
  to read correctly.
- **Responsive**: existing breakpoints (`860px` main grid collapse,
  `700px` lounge grid, `600px`/`560px`/`480px`/`460px` component-level)
  stay as the structural breakpoints; typography/spacing scale must not
  introduce horizontal overflow at any of them. No breakpoint removed.
- **Accessibility**: existing `:focus-visible` outline treatment stays;
  new flat surfaces must keep ≥ the current border contrast; the
  underline nav active-state must remain distinguishable without relying
  on color alone (weight + underline, not color-only).
- **`prefers-reduced-motion`**: all new motion (card fade-in stagger)
  added under the existing reduced-motion block.

## 7. Non-goals

- No new features, pages, or data fields.
- No changes to storage schema, account/auth logic, Lounge simulation
  engine, AI chat integration, or any other JS *behavior*.
- No new theme presets and no changes to existing presets' color values.
- No dependency additions beyond the one Google Fonts family (Fraunces).

## 8. Execution phases (for the implementation plan)

0. Tokens + shared component classes (typography scale, spacing scale,
   `.surface`, `.eyebrow`, shadow/radius tokens, `--accent-gradient` per
   preset, Fraunces import) — no visible page change yet beyond fonts
   loading.
1. Header + top nav.
2. Dashboard: stats, timer, missions, tasks, AI chat.
3. Reports + Leaderboard.
4. Study Lounge (lobby + active-room dashboard).
5. Settings dialog (all five tabs).
6. Friends drawer + chat dialog + invite toast.
7. Profile modal + Auth modal.
8. Full pass: all fifteen presets, all breakpoints, reduced-motion,
   console-error check, regression click-through of every flow listed
   in §1.

Each phase lands as its own commit and gets a quick regression pass
before moving to the next, per §6.

## 9. Verification checklist (final phase)

- [ ] Every nav destination (Dashboard/Reports/Leaderboard/Lounge) opens
      and renders correctly.
- [ ] Timer start/pause/reset/skip and mode switching still work.
- [ ] Task create/complete/delete still works.
- [ ] Settings: every tab's controls (including live color pickers and
      background/music upload) still function and visibly apply.
- [ ] All fifteen theme presets produce a coherent, legible result.
- [ ] Dark mode toggle (`midnight` preset) checked explicitly.
- [ ] Friends drawer, direct chat, invite toast still function.
- [ ] Profile modal view/edit (including photo upload) still functions.
- [ ] Auth modal login/signup/guest/account-switch still functions.
- [ ] Study Lounge lobby create/join and active-room dashboard
      (members, activity log, mission) still function.
- [ ] No horizontal scrolling at any breakpoint.
- [ ] No new console errors.
- [ ] `prefers-reduced-motion: reduce` disables the new entrance motion.
