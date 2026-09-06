/**
 * Meta Pixel bootstrap.
 *
 * The pixel ID arrives from the server in /config.js rather than being baked
 * into the static HTML, so the same build can run against a test pixel locally
 * and the real one in production.
 *
 * Exposes window.metaTrack / window.metaTrackCustom. Both are installed even
 * when no pixel is configured, so callers never have to guard.
 */
(function () {
  var pixelId = (window.BLKBX_CONFIG || {}).metaPixelId;

  if (!pixelId) {
    // No META_PIXEL_ID in the environment - normal for local development.
    window.metaTrack = function () {};
    window.metaTrackCustom = function () {};
    return;
  }

  // Meta Pixel base code, verbatim.
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window,document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', pixelId);
  fbq('track', 'PageView');

  // Analytics must never break the page: a blocked fbevents.js, an ad blocker,
  // or a malformed parameter should cost a signal, not a conversion.
  function send(method, name, params, options) {
    if (typeof fbq !== 'function') return;
    try {
      if (options) fbq(method, name, params || {}, options);
      else fbq(method, name, params || {});
    } catch (error) {
      /* ignore */
    }
  }

  window.metaTrack = function (name, params, options) { send('track', name, params, options); };
  window.metaTrackCustom = function (name, params) { send('trackCustom', name, params); };
})();
