/* Cookie consent + Google Analytics loader, shared by the app and the legal pages.

   - Google Consent Mode v2 is initialised with EVERYTHING denied before anything else happens.
   - Google Analytics (gtag.js) is not even downloaded until the visitor accepts analytics. Reject, or
     doing nothing, means no Google script, no analytics cookies, no analytics requests.
   - The choice is remembered in this browser (localStorage, key "pomoCookieConsent") and re-asked after 12 months.
   - Anything with data-cookie-settings (the footer link) re-opens the choices so they can be changed or withdrawn. */
(function () {
  'use strict';

  var GA_ID = 'G-Y0B0W7YJ78';
  var STORAGE_KEY = 'pomoCookieConsent';
  var MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  // Default: denied. (Consent Mode v2 signals, including the two new advertising ones.)
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500,
  });
  window['ga-disable-' + GA_ID] = true; // Google's own kill-switch, until the visitor accepts

  function readChoice() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || typeof c.analytics !== 'boolean' || typeof c.at !== 'number') return null;
      if (Date.now() - c.at > MAX_AGE_MS) return null;
      return c;
    } catch (e) { return null; }
  }
  function writeChoice(analytics) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: analytics, at: Date.now(), v: 1 })); } catch (e) { /* storage blocked: choice lasts for this page only */ }
  }

  var gaLoaded = false;
  function enableAnalytics() {
    window['ga-disable-' + GA_ID] = false;
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (gaLoaded) return;
    gaLoaded = true;
    gtag('js', new Date());
    // No ad features: no Google signals, no ad personalisation.
    gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }
  function deleteAnalyticsCookies() {
    var host = location.hostname;
    var parts = host.split('.');
    var domains = [undefined, host, '.' + host];
    for (var i = 1; i < parts.length - 1; i += 1) domains.push('.' + parts.slice(i).join('.'));
    var names = document.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); })
      .filter(function (n) { return n === '_ga' || n.indexOf('_ga_') === 0 || n === '_gid' || n.indexOf('_gat') === 0; });
    names.forEach(function (name) {
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
      });
    });
  }
  function disableAnalytics() {
    window['ga-disable-' + GA_ID] = true;
    gtag('consent', 'update', { analytics_storage: 'denied' });
    deleteAnalyticsCookies();
  }
  function apply(analytics) { if (analytics) enableAnalytics(); else disableAnalytics(); }

  // Lets the app hold back its own pop-ups (e.g. the first-visit sign-in window) until a choice exists,
  // because an open modal dialog would make the banner unclickable.
  var decided = false;
  var waiting = [];
  function markDecided() {
    decided = true;
    waiting.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* a listener must not break the others */ } });
  }
  function whenDecided(fn) { if (decided) fn(); else waiting.push(fn); }

  /* ---------------- banner ---------------- */
  var banner = null;
  var lastFocus = null;

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  function close(returnFocus) {
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    if (returnFocus && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* element gone */ } }
  }
  function decide(analytics) {
    writeChoice(analytics);
    apply(analytics);
    close(true);
    markDecided();
  }

  function open(startInManage) {
    if (banner) return;
    lastFocus = document.activeElement;
    var current = readChoice();

    var title = el('h2', { id: 'cookie-banner-title', class: 'cookie-banner__title', text: 'Your privacy choices' });
    var intro = el('p', { class: 'cookie-banner__text' });
    intro.appendChild(document.createTextNode('We use essential storage to keep the app working and you signed in. With your permission we also use Google Analytics to count visits and see which parts of the site are used. No advertising, no selling of data. See our '));
    intro.appendChild(el('a', { href: '/cookies', text: 'Cookie Policy' }));
    intro.appendChild(document.createTextNode(' and '));
    intro.appendChild(el('a', { href: '/privacy', text: 'Privacy Policy' }));
    intro.appendChild(document.createTextNode('.'));

    var accept = el('button', { type: 'button', class: 'cookie-btn cookie-btn--primary', text: 'Accept' });
    var reject = el('button', { type: 'button', class: 'cookie-btn', text: 'Reject' });
    var manage = el('button', { type: 'button', class: 'cookie-btn', 'aria-expanded': 'false', 'aria-controls': 'cookie-manage', text: 'Manage' });
    var actions = el('div', { class: 'cookie-banner__actions' }, [reject, manage, accept]);

    var analyticsBox = el('input', { type: 'checkbox', id: 'cookie-analytics' });
    analyticsBox.checked = !!(current && current.analytics);
    var necessaryBox = el('input', { type: 'checkbox', id: 'cookie-necessary', checked: 'checked', disabled: 'disabled' });
    var save = el('button', { type: 'button', class: 'cookie-btn cookie-btn--primary', text: 'Save choices' });
    var manageBox = el('div', { id: 'cookie-manage', class: 'cookie-banner__manage', hidden: 'hidden' }, [
      el('label', { class: 'cookie-row', for: 'cookie-necessary' }, [
        necessaryBox,
        el('span', {}, [
          el('strong', { text: 'Strictly necessary' }),
          el('span', { class: 'cookie-row__desc', text: 'Keeps you signed in, protects forms against abuse and remembers your settings on this device. Always on.' }),
        ]),
      ]),
      el('label', { class: 'cookie-row', for: 'cookie-analytics' }, [
        analyticsBox,
        el('span', {}, [
          el('strong', { text: 'Analytics (Google Analytics)' }),
          el('span', { class: 'cookie-row__desc', text: 'Anonymous statistics about visits and usage so we can improve the site. Sets the _ga cookies. Off unless you turn it on.' }),
        ]),
      ]),
      el('div', { class: 'cookie-banner__actions' }, [save]),
    ]);

    banner = el('div', { id: 'cookie-banner', class: 'cookie-banner', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'cookie-banner-title' }, [title, intro, actions, manageBox]);

    accept.addEventListener('click', function () { decide(true); });
    reject.addEventListener('click', function () { decide(false); });
    save.addEventListener('click', function () { decide(analyticsBox.checked); });
    manage.addEventListener('click', function () {
      var show = manageBox.hasAttribute('hidden');
      if (show) manageBox.removeAttribute('hidden'); else manageBox.setAttribute('hidden', 'hidden');
      manage.setAttribute('aria-expanded', String(show));
    });
    banner.addEventListener('keydown', function (e) {
      // Escape closes only when a choice already exists (otherwise closing would silently mean "no answer").
      if (e.key === 'Escape' && readChoice()) close(true);
    });

    document.body.appendChild(banner);
    if (startInManage) {
      manageBox.removeAttribute('hidden');
      manage.setAttribute('aria-expanded', 'true');
      analyticsBox.focus();
    }
  }

  function init() {
    var choice = readChoice();
    if (choice) { apply(choice.analytics); markDecided(); } // stays denied unless they said yes
    else open(false);
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
      if (!t) return;
      e.preventDefault();
      if (banner) close(false);
      open(true);
    });
  }

  window.PomoConsent = { open: function () { open(true); }, get: readChoice, whenDecided: whenDecided };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
