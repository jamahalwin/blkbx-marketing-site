/**
 * Consent gate for BLKBX's own tracking.
 *
 * Termly's autoBlock only stops third-party resources it recognizes. It does
 * not know about our first-party /api/event calls, and it can miss scripts we
 * inject ourselves, so every tracker checks consent here explicitly.
 *
 * Fails closed: if Termly is blocked or never initializes, nothing is granted.
 *
 * Exposes window.blkbxConsent:
 *   has(category)            - true only once Termly reports consent
 *   whenGranted(category, fn) - runs fn once, now or when consent is given
 *   onChange(fn)             - called with the new state on every change
 * Categories are Termly's: 'analytics', 'advertising', 'performance', etc.
 */
(function () {
  var state = {};
  var listeners = [];

  function update(next) {
    state = next || {};
    listeners.slice().forEach(function (fn) {
      try { fn(state); } catch (error) { /* a listener must not break others */ }
    });
  }

  function readTermly() {
    var termly = window.Termly;
    if (!termly || typeof termly.getConsentState !== 'function') return;
    try { update(termly.getConsentState()); } catch (error) { /* stay closed */ }
  }

  function has(category) { return state[category] === true; }

  function onChange(fn) { listeners.push(fn); }

  function whenGranted(category, fn) {
    if (has(category)) { fn(); return; }
    var done = false;
    onChange(function () {
      if (done || !has(category)) return;
      done = true;
      fn();
    });
  }

  window.blkbxConsent = { has: has, whenGranted: whenGranted, onChange: onChange };

  var termly = window.Termly;
  if (termly && typeof termly.on === 'function') {
    termly.on('initialized', readTermly);
    termly.on('consent', readTermly);
  }
  readTermly();

  // The footer link points at the Cookie Policy so it still works when Termly
  // is blocked or fails to load; when Termly is available it opens the
  // preference center instead, where visitors can withdraw consent.
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('[data-consent-preferences]');
    if (!link) return;
    var t = window.Termly;
    if (!t || typeof t.displayPreferenceModal !== 'function') return;
    event.preventDefault();
    t.displayPreferenceModal();
  });
})();
