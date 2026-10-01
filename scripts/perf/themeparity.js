const puppeteer = require('puppeteer-core');
const base = process.argv[2];
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  let page = await browser.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle0' });
  const presets = await page.evaluate(() => Theme.PRESETS);
  await page.close();
  const snapshot = async (themeSettings, blockApp) => {
    const p = await browser.newPage();
    await p.setRequestInterception(true);
    p.on('request', (r) => { if (blockApp && /\/assets\/app\.js/.test(r.url())) r.abort(); else r.continue(); });
    await p.evaluateOnNewDocument((t) => { try { if (t) localStorage.setItem('themeSettings', JSON.stringify(t)); else localStorage.removeItem('themeSettings'); localStorage.setItem('pomoCookieConsent', JSON.stringify({ analytics: false, at: Date.now(), v: 1 })); localStorage.setItem('pomodoroGuestChoice', 'true'); } catch (e) {} }, themeSettings);
    await p.goto(base + '/', { waitUntil: blockApp ? 'load' : 'networkidle0' });
    await new Promise((r) => setTimeout(r, 400));
    const snap = await p.evaluate(() => { const s = document.documentElement.style; const vars = {}; for (let i = 0; i < s.length; i++) { const k = s[i]; if (k.startsWith('--') && k !== '--overlay-color') vars[k] = s.getPropertyValue(k).trim(); } return { vars, theme: document.documentElement.getAttribute('data-theme'), preset: document.documentElement.getAttribute('data-theme-preset'), bg: getComputedStyle(document.body).backgroundColor }; });
    await p.close();
    return snap;
  };
  let bad = 0;
  const cases = [['(nothing stored)', null], ...Object.entries(presets).map(([name, colors]) => [name, { preset: name, colors }]), ['custom', { preset: 'custom', colors: { ...presets.default, bg: '#102030', text: '#e0f0ff' } }], ['garbage', { preset: 'nope', colors: { bg: 'red', primary: '#12' } }]];
  for (const [name, ts] of cases) {
    const a = await snapshot(ts, true), b = await snapshot(ts, false);
    const keys = new Set([...Object.keys(a.vars), ...Object.keys(b.vars)]);
    const diffs = [...keys].filter((k) => a.vars[k] !== b.vars[k]).map((k) => `${k}: boot=${a.vars[k]} app=${b.vars[k]}`);
    if (a.theme !== b.theme) diffs.push(`data-theme boot=${a.theme} app=${b.theme}`);
    if (a.preset !== b.preset) diffs.push(`data-theme-preset boot=${a.preset} app=${b.preset}`);
    console.log((diffs.length ? 'DIFF ' : 'same ') + name.padEnd(18), diffs.length ? diffs.join(' | ') : `(${keys.size} variables, data-theme=${a.theme})`);
    if (diffs.length) bad++;
  }
  console.log(bad ? `${bad} cases differ` : 'boot.js matches the app for every preset');
  await browser.close();
})();
