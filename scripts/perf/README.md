# Performance & regression checks

Throw-away tooling used for the performance pass (nothing here ships to users). Install once:

    cd scripts/perf && npm init -y && npm i puppeteer-core pixelmatch pngjs

You need Chrome (set `CHROME_PATH` if it isn't in the default Windows location) and two copies of the site running,
e.g. the previous build and the new one (`node server/test/run-local.js` serves the real app against an in-memory
database on `PORT`, default 3100 -- it never touches a real database).

| script | what it checks |
|---|---|
| `node shots.js http://localhost:3101 old && node shots.js http://localhost:3100 new && node diff.js old new` | pixel-compares 21 screens (dashboard desktop/mobile, every view, settings tabs, dialogs, themes, cookie banner, legal page); animations are frozen with `prefers-reduced-motion` |
| `node diffui.js <base> out.json` (run for old and new, then diff the JSON) | a 58-step scripted tour (tasks, timer, all themes, settings, views, profile, sign-up, friends, room, chat, logout) recording page text, title, theme attributes, localStorage, open dialogs |
| `node themeparity.js <base>` | `assets/boot.js` produces exactly the same CSS variables as `Theme.apply` for every preset |
| `node scroll.js <base> mobile|desktop label` | main-thread cost per second while a timer runs, and frame times while scrolling (Chrome, CPU throttled 4x for mobile) |
| `bash lighthouse.sh <url> <label> 3` then `node lighthouse-summary.js <label>` | Lighthouse (mobile + desktop), median of N runs |
