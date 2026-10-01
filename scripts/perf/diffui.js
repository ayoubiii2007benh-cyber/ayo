// usage: node diffui.js <baseUrl> <out.json>  -- drives a long, scripted tour of the app and records what the user would see
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const [base, outFile] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => String(t)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/Ends at \d\d:\d\d/g, 'Ends at <t>')
  .replace(/\d{13}/g, '<ms>')
  .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
  .replace(/[A-Z]+-[A-Z0-9]{2,4}\b/g, '<roomcode>')
  .replace(/\d+ online/g, 'N online')
  .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g, '<day>');
const log = [];
const errors = [];

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log.push({ label: 'NAVIGATED ' + f.url() }); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + norm(e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|net::ERR/.test(m.text())) errors.push('console: ' + norm(m.text())); });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
      localStorage.setItem('pomoCookieConsent', JSON.stringify({ analytics: false, at: Date.now(), v: 1 }));
      localStorage.setItem('pomodoroGuestChoice', 'true');
    } catch (e) { /* ignore */ }
    let seed = 12345;
    Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  });
  const snap = async (label) => {
    await sleep(250);
    const data = await page.evaluate(() => ({
      text: document.body.innerText,
      title: document.title,
      theme: [document.documentElement.getAttribute('data-theme'), document.documentElement.getAttribute('data-theme-preset'), document.documentElement.getAttribute('data-mode')],
      ls: Object.fromEntries(Object.keys(localStorage).filter((k) => !/Consent|pomodoroSignedIn/.test(k)).sort().map((k) => [k, localStorage.getItem(k)])),
      openDialogs: Array.from(document.querySelectorAll('dialog[open]')).map((d) => d.id),
      hiddenViews: ['dashboard', 'reports', 'leaderboard', 'lounge', 'guides'].map((v) => [v, document.getElementById('view-' + v).hidden]),
    }));
    log.push(Object.assign({ label }, JSON.parse(norm(JSON.stringify(data)))));
  };
  const click = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); };
  const type = async (sel, text) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel, { clickCount: 3 }); await page.type(sel, text); };
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const addTask = (name) => ev((n) => { const f = document.getElementById('task-form'); const i = f.querySelector('input[type=text]'); i.value = n; f.requestSubmit(); }, name);

  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  await snap('loaded');

  // --- planner
  await addTask('Write report'); await addTask('Read chapter'); await addTask('Email Sam');
  await snap('3 tasks added');
  await ev(() => { const cb = document.querySelector('#task-list input[type=checkbox]'); if (cb) cb.click(); });
  await snap('first task ticked');
  await ev(() => { const li = document.querySelectorAll('#task-list li')[1]; const b = li && li.querySelector('button'); if (b) b.click(); });
  await snap('second task button clicked');
  await ev(() => { const del = document.querySelector('#task-list li:last-child button[aria-label*="elete"]'); if (del) del.click(); });
  await snap('last task delete (if found)');

  // --- timer
  await click('#timer-toggle'); await sleep(1300); await snap('timer running 1s');
  await click('#timer-toggle'); await snap('timer paused');
  await click('#mode-tab-shortBreak'); await snap('short break');
  await click('#mode-tab-longBreak'); await snap('long break');
  await click('#mode-tab-pomodoro'); await snap('back to focus');
  await ev(() => { state.timer.remainingMs = 800; Timer.start(); }); await sleep(1800);
  await snap('after a pomodoro completes (stats, missions, mode advance)');

  // --- settings
  await click('#settings-btn'); await snap('settings open');
  for (const t of ['timer', 'background', 'music', 'appearance', 'ai']) { await ev((tab) => UI.selectSettingsTab(tab), t); await snap('settings tab ' + t); }
  await ev(() => UI.selectSettingsTab('timer'));
  await ev(() => { const i = document.querySelector('#settings-form input[type=number]'); i.value = '30'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await snap('pomodoro length 30');
  await ev(() => { const c = document.querySelector('#settings-form fieldset label:has(input[type=checkbox]) input'); c.click(); });
  await snap('toggle clicked');
  for (const p of ['midnight', 'ocean', 'forest', 'sunset', 'lavender', 'minimal', 'cyberpunk', 'warm', 'monochrome', 'apex', 'lofi', 'coastal', 'terminal', 'deepmesh', 'default']) {
    await ev((preset) => Theme.applyPreset(preset), p); await snap('theme ' + p);
  }
  await ev(() => Theme.setColor('primary', '#336699')); await snap('custom primary colour');
  await ev(() => Theme.resetToDefault()); await snap('theme reset');
  await ev(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); });
  await ev(() => Theme.toggleDarkMode()); await snap('dark mode toggled');
  await ev(() => Theme.toggleDarkMode()); await snap('dark mode toggled back');

  // --- views
  for (const v of ['reports', 'leaderboard', 'lounge', 'guides', 'dashboard']) { await ev((view) => UI.selectView(view), v); await sleep(500); await snap('view ' + v); }

  // --- profile edit (guest)
  await click('#user-avatar'); await snap('profile open');
  await click('#profile-modal-edit-btn'); await type('#profile-edit-username', 'Tester Tim'); await type('#profile-edit-bio', 'I like focus.');
  await click('#profile-edit-save'); await sleep(400); await snap('profile saved');

  // --- AI assistant with a fake key
  await ev(() => { state.chatSettings = { apiKey: 'fake-key' }; Storage.saveChatSettings(state.chatSettings); UI.renderChat(); }); await snap('ai key set');
  await ev(() => { document.getElementById('ai-chat-input').value = 'hello there'; document.getElementById('ai-chat-form').requestSubmit(); }); await sleep(1800); await snap('ai message sent (error path)');

  // --- real account: register, friends drawer, room, chat
  await ev(() => document.getElementById('auth-modal').showModal());
  await click('#auth-tab-signup');
  await type('#auth-signup-username', 'diff_tester'); await type('#auth-signup-email', 'diff@example.com'); await type('#auth-signup-password', 'correct-horse-battery');
  await click('#auth-signup-consent'); await sleep(3500); await click('#auth-signup-submit'); await sleep(2500); await snap('registered');
  await click('#friends-drawer-toggle'); await snap('friends drawer');
  await type('#friend-search-input', 'zz'); await ev(() => document.getElementById('friend-search-form').requestSubmit()); await sleep(600); await snap('friend search');
  await ev(() => document.getElementById('friends-drawer-close').click());
  await ev(() => UI.selectView('lounge')); await sleep(500);
  const createBtn = await ev(() => { const b = Array.from(document.querySelectorAll('#view-lounge button')).find((x) => /create/i.test(x.textContent)); if (b) { b.click(); return b.textContent.trim(); } return null; });
  log.push({ label: 'clicked create room', createBtn }); await sleep(1200); await snap('room created');
  if (await ev(() => !!document.getElementById('lounge-chat-input'))) { await type('#lounge-chat-input', 'hello room'); await page.keyboard.press('Enter'); await sleep(900); await snap('room chat message'); }
  await ev(() => { const b = Array.from(document.querySelectorAll('#view-lounge button')).find((x) => /leave/i.test(x.textContent)); if (b) b.click(); }); await sleep(800); await snap('left room');
  await ev(() => UI.selectView('leaderboard')); await sleep(800); await snap('leaderboard (signed in)');
  await click('#user-avatar'); await sleep(300); await snap('profile (signed in)');
  await ev(() => document.getElementById('profile-modal').close());
  await ev(() => Auth.logout()); await sleep(600); await snap('logged out');

  fs.writeFileSync(outFile, JSON.stringify({ log, errors }, null, 1));
  console.log('steps', log.length, 'errors', errors.length);
  errors.slice(0, 8).forEach((e) => console.log('  ', e));
  await browser.close();
})().catch((e) => { console.error('HARNESS FAILED:', e.message); process.exit(1); });
