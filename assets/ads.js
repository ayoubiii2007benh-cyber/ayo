/* AdSense placements (Social left/right, Progress, Study, Timer).

   - SLOTS below is the one place ad-unit IDs are configured. An empty ID means: no ad request, ever. On localhost the
     space shows a non-clickable "Advertisement" placeholder so the layout can be reviewed; on the live site it stays hidden.
   - The AdSense library (the type="text/plain" tag in index.html's <head>) is only switched on, once, when at least one
     slot is configured AND the visitor has agreed to advertising in the cookie choices (PomoConsent, assets/consent.js).
     Withdrawing that consent later pauses ad requests and removes the units on screen (no reload: it would stop a running timer).
   - Each configured unit is initialised once (Google's responsive pattern), the first time its box has a width: AdSense
     can't fill a unit that is display:none (another page, or a rail that only shows on wide screens).
   - Social ads are switched off inside a room, on the Friends tab and while a private chat is open. */
(function () {
  'use strict';

  var SLOTS = {
    socialLeft: '2163861345', // Also the one ad below Social on smaller screens.
    socialRight: '9774933063',
    progress: '9248144448',
    study: '1822834581',
    timer: '7603890281',
  };

  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var VALID_SLOT = /^\d{6,20}$/;

  function slotId(name) { var id = SLOTS[name]; return typeof id === 'string' && VALID_SLOT.test(id) ? id : ''; }
  function adsConsent() {
    var c = window.PomoConsent && window.PomoConsent.get();
    return !!(c && c.ads === true); // set only by an explicit "yes" to advertising
  }

  var libraryLoaded = false;
  function loadLibrary() {
    if (libraryLoaded) return true;
    var tag = document.getElementById('adsense-lib');
    if (!tag) return false;
    libraryLoaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = tag.getAttribute('src');
    s.crossOrigin = 'anonymous';
    document.head.appendChild(s);
    return true;
  }
  function clientId() {
    var tag = document.getElementById('adsense-lib');
    var m = tag && /[?&]client=([^&]+)/.exec(tag.getAttribute('src'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* One placement: decides between a real unit, the local placeholder, or nothing. */
  var resizeObserver = null;
  var pending = new Map(); // body element -> function that initialises it once it has a width
  function setUp(slot) {
    if (slot.dataset.adState === 'live') return;
    var name = slot.dataset.adPlacement;
    var body = slot.querySelector('.ad-slot__body');
    var id = slotId(name);
    if (id && adsConsent() && loadLibrary()) {
      slot.dataset.adState = 'live';
      body.removeAttribute('aria-hidden');
      var ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', clientId());
      ins.setAttribute('data-ad-slot', id);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      body.appendChild(ins);
      pending.set(body, function () { (window.adsbygoogle = window.adsbygoogle || []).push({}); });
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(function (entries) {
          entries.forEach(function (e) {
            var init = pending.get(e.target);
            if (!init || e.contentRect.width === 0) return;
            pending.delete(e.target);
            resizeObserver.unobserve(e.target);
            try { init(); } catch (err) { /* blocked by an extension or offline: leave the box empty */ }
          });
        });
      }
      resizeObserver.observe(body);
    } else if (LOCAL) {
      slot.dataset.adState = 'placeholder';
      body.setAttribute('aria-hidden', 'true');
    } else {
      // live site without an ID or without consent: nothing shown, nothing requested
      delete slot.dataset.adState;
      slot.hidden = true;
      if (slot.parentElement) slot.parentElement.classList.remove('has-ad');
      return;
    }
    slot.hidden = false;
    if (slot.parentElement) slot.parentElement.classList.add('has-ad');
  }
  /* Consent withdrawn: no further ad requests, and the units already on screen go. */
  function tearDownLive() {
    if (libraryLoaded) (window.adsbygoogle = window.adsbygoogle || []).pauseAdRequests = 1;
    document.querySelectorAll('.ad-slot[data-ad-state="live"]').forEach(function (slot) {
      var body = slot.querySelector('.ad-slot__body');
      pending.delete(body);
      if (resizeObserver) resizeObserver.unobserve(body);
      body.replaceChildren();
      delete slot.dataset.adState;
    });
  }
  function setUpAll() { document.querySelectorAll('.ad-slot[data-ad-placement]').forEach(setUp); }

  /* Ads stay out of private communication: rooms, the Friends tab and the private chat dialog. */
  function watchPrivateScreens() {
    var lounge = document.getElementById('view-lounge');
    var room = document.getElementById('lounge-active');
    var friends = document.getElementById('social-friends');
    var chat = document.getElementById('chat-dialog');
    var methods = document.getElementById('view-methods');
    var methodsRoot = document.getElementById('methods-root');
    function update() {
      if (lounge) lounge.classList.toggle('ads-off', !!((room && !room.hidden) || (friends && !friends.hidden)));
      document.body.classList.toggle('ads-paused', !!(chat && chat.open));
      // Study: only on the page with the four method cards, not inside a tool.
      if (methods) methods.classList.toggle('ads-off', !(methodsRoot && methodsRoot.querySelector('.sm-hub')));
    }
    var mo = new MutationObserver(update);
    [room, friends].forEach(function (el) { if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] }); });
    if (chat) mo.observe(chat, { attributes: true, attributeFilter: ['open'] });
    if (methodsRoot) mo.observe(methodsRoot, { childList: true });
    update();
  }

  function init() {
    watchPrivateScreens();
    setUpAll();
    // A choice made (or changed) later in the cookie banner applies without a reload.
    document.addEventListener('pomo:consentchange', function (e) {
      if (e.detail && e.detail.ads) {
        if (libraryLoaded && window.adsbygoogle) window.adsbygoogle.pauseAdRequests = 0;
      } else tearDownLive();
      setUpAll();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
