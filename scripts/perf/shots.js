// usage: node shots.js <baseUrl> <outDir>
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const [base, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDE_DYNAMIC = '#captcha-login,#captcha-signup,#captcha-forgot{visibility:hidden!important} video{visibility:hidden!important} .live-users__count{visibility:hidden!important}';

async function newPage(browser, { mobile = false, theme = null, consent = true, guest = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 800 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((o) => {
    try {
      // localStorage is shared by every page of this browser, so each state sets OR clears each key
      if (o.consent) localStorage.setItem('pomoCookieConsent', JSON.stringify({ analytics: false, at: Date.now(), v: 1 })); else localStorage.removeItem('pomoCookieConsent');
      if (o.guest) localStorage.setItem('pomodoroGuestChoice', 'true'); else localStorage.removeItem('pomodoroGuestChoice');
      if (o.theme) localStorage.setItem('themeSettings', JSON.stringify({ preset: o.theme, colors: undefined })); else localStorage.removeItem('themeSettings');
    } catch (e) {}
  }, { consent, guest, theme });
  return page;
}
async function settle(page, ms = 900) { await page.evaluate(() => document.fonts.ready); await sleep(ms); }
async function shot(page, name) { await page.addStyleTag({ content: HIDE_DYNAMIC }); await sleep(150); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); }

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox', '--font-render-hinting=none'] });
  let page;

  page = await newPage(browser); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await settle(page); await shot(page, '01-dashboard-desktop');
  await page.evaluate(() => { state.timer.remainingMs = 14 * 60000 + 7000; Timer.updateTimerDisplay(); }); await sleep(1500); await shot(page, '02-timer-midway');
  await page.evaluate(() => UI.selectView('reports')); await settle(page, 400); await shot(page, '03-reports');
  await page.evaluate(() => UI.selectView('leaderboard')); await settle(page, 600); await shot(page, '04-leaderboard');
  await page.evaluate(() => UI.selectView('lounge')); await settle(page, 600); await shot(page, '05-lounge');
  await page.evaluate(() => UI.selectView('guides')); await settle(page, 1200); await shot(page, '06-guides');
  await page.evaluate(() => UI.selectView('dashboard'));
  for (const tab of ['timer', 'background', 'music', 'appearance', 'ai']) {
    await page.evaluate((t) => { UI.openSettings(); UI.selectSettingsTab(t); }, tab); await settle(page, 500); await shot(page, `07-settings-${tab}`);
    await page.evaluate(() => document.querySelector('dialog[open]') && document.querySelector('dialog[open]').close());
  }
  await page.evaluate(() => UI.openProfileModal()); await settle(page, 400); await shot(page, '08-profile');
  await page.evaluate(() => document.getElementById('profile-modal').close());
  await page.close();

  page = await newPage(browser, { theme: 'midnight' }); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await settle(page); await shot(page, '09-dark-desktop');
  await page.close();
  page = await newPage(browser, { theme: 'cyberpunk' }); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await settle(page); await shot(page, '10-cyberpunk');
  await page.close();

  page = await newPage(browser, { mobile: true }); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await settle(page); await shot(page, '11-dashboard-mobile');
  await page.evaluate(() => window.scrollTo(0, 99999)); await sleep(400); await shot(page, '12-mobile-bottom-footer');
  await page.close();

  page = await newPage(browser, { consent: false }); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await settle(page); await shot(page, '13-cookie-banner');
  await page.click('#cookie-banner button[aria-controls="cookie-manage"]'); await sleep(300); await shot(page, '14-cookie-manage');
  await page.close();

  page = await newPage(browser, { guest: false }); await page.goto(base + '/', { waitUntil: 'networkidle0' }); await settle(page, 1500); await shot(page, '15-auth-modal');
  await page.click('#auth-tab-signup'); await sleep(300); await shot(page, '16-auth-signup');
  await page.close();

  page = await newPage(browser); await page.goto(base + '/privacy', { waitUntil: 'networkidle0' }); await settle(page); await shot(page, '17-privacy-page');
  await page.close();
  await browser.close();
})();
