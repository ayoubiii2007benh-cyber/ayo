// usage: node scroll.js <url> <mobile|desktop> <label> [css]
const puppeteer = require('puppeteer-core');
const [url, form, label, css] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  if (form === 'mobile') await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); else await page.setViewport({ width: 1280, height: 800 });
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: form === 'mobile' ? 4 : 1 });
  await cdp.send('Performance.enable');
  await page.evaluateOnNewDocument(() => { localStorage.setItem('pomoCookieConsent', JSON.stringify({ analytics: false, at: Date.now(), v: 1 })); localStorage.setItem('pomodoroGuestChoice', 'true'); });
  await page.goto(url, { waitUntil: 'load' });
  if (css) await page.addStyleTag({ content: css });
  await sleep(1500);
  const m = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  // 1) timer running, no rAF loop: pure steady-state cost
  await page.click('#timer-toggle').catch(() => {});
  await sleep(800);
  const t0 = await m(); await sleep(6000); const t1 = await m();
  const per = (a, b, k) => +(((b[k] - a[k]) / 6) * 1000).toFixed(1);
  // 2) scroll the whole page in 90 frames, recording frame deltas
  const frames = await page.evaluate(() => new Promise((res) => {
    const max = document.documentElement.scrollHeight - innerHeight; const steps = 90; let i = 0; const d = []; let last = performance.now();
    const tick = (now) => { d.push(now - last); last = now; window.scrollTo(0, (max * (++i)) / steps); if (i < steps) requestAnimationFrame(tick); else res(d.slice(1)); };
    requestAnimationFrame(tick);
  }));
  const s = [...frames].sort((a, b) => a - b);
  const q = (p) => +s[Math.floor(s.length * p)].toFixed(1);
  console.log(label.padEnd(30), `timer-on steady: task ${per(t0, t1, 'TaskDuration')} ms/s, style ${per(t0, t1, 'RecalcStyleDuration')}, layout ${per(t0, t1, 'LayoutDuration')}, script ${per(t0, t1, 'ScriptDuration')} | scroll frames: p50 ${q(0.5)}ms p95 ${q(0.95)}ms max ${q(0.999)}ms, >33ms: ${frames.filter((x) => x > 33).length}/${frames.length}, pageHeight ${await page.evaluate(() => document.documentElement.scrollHeight)}`);
  await browser.close();
})();
