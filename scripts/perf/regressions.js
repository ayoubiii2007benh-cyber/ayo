// usage: node regressions.js <baseUrl>    (a LOCAL server: it creates throw-away accounts with the Turnstile test keys)
// Browser checks for bugs fixed in the 2026-10-20 audit; exits 1 if any fails.
const puppeteer = require('puppeteer-core');
const [base = 'http://localhost:3100'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(ok, label) { console.log(`${ok ? 'ok  ' : 'FAIL'} - ${label}`); if (!ok) failed += 1; }

async function signedInPage(browser, viewport, lang, displayName) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.goto(base + '/timer', { waitUntil: 'load' });
  await sleep(1500); // let the app's own session check finish: it clears the signed-in flag when it finds none
  await page.evaluate(async (o) => {
    localStorage.setItem('pomoCookieConsent', JSON.stringify({ analytics: false, ads: false, at: Date.now(), v: 2 }));
    localStorage.setItem('uiPrefs', JSON.stringify({ lang: o.lang }));
    const name = 'reg' + Math.random().toString(36).slice(2, 10);
    const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: 'Testpass123!', email: name + '@example.com', displayName: o.displayName, captchaToken: 'XXXX.DUMMY.TOKEN.XXXX', acceptTerms: true }) });
    if (!res.ok) throw new Error('register failed: ' + res.status + ' (restart the local server if it is the sign-up rate limit)');
    localStorage.setItem('pomodoroSignedIn', 'true');
  }, { lang, displayName });
  await page.reload({ waitUntil: 'load' }); // the session now resumes from the cookie
  await sleep(1200);
  return { page, ctx };
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });

  // 1. The notifications menu stays on screen (it used to hang from the bell and run off the right edge, or the left in RTL).
  for (const lang of ['en', 'ar']) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844, isMobile: true, hasTouch: true }, { width: 320, height: 640, isMobile: true, hasTouch: true }]) {
      const { page, ctx } = await signedInPage(browser, viewport, lang, 'Reg');
      await page.click('#notif-trigger');
      await sleep(400);
      const r = await page.evaluate(() => {
        const m = document.getElementById('notif-menu').getBoundingClientRect();
        return { left: m.left, right: m.right, vw: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      check(r.left >= 0 && r.right <= r.vw && r.overflow === 0, `notifications menu on screen (${lang}, ${viewport.width}px): ${Math.round(r.left)}..${Math.round(r.right)} of ${r.vw}`);
      await ctx.close();
    }
  }

  // 2. A session resumed from the cookie shows the account's name, not the device's stale "You".
  {
    const { page, ctx } = await signedInPage(browser, { width: 1280, height: 800 }, 'en', 'Dana');
    const shown = await page.evaluate(() => ({ avatar: document.getElementById('user-avatar').textContent.trim(), modal: document.getElementById('profile-modal-username').textContent }));
    check(shown.avatar === 'D' && shown.modal === 'Dana', `resumed session shows the account name (avatar "${shown.avatar}", profile "${shown.modal}")`);
    await ctx.close();
  }

  // 3. An unknown address is a 404 that still opens the app, rather than a bare "Cannot GET" page.
  {
    const page = await browser.newPage();
    const resp = await page.goto(base + '/study/no-such-tool', { waitUntil: 'load' });
    await sleep(600);
    const timer = await page.evaluate(() => { const v = document.getElementById('view-dashboard'); return !!v && !v.hidden; });
    check(resp.status() === 404 && new URL(page.url()).pathname === '/timer' && timer, `unknown address -> 404 status, app opens /timer (got ${resp.status()} ${new URL(page.url()).pathname})`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${failed ? failed + ' failed' : 'all passed'}`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
