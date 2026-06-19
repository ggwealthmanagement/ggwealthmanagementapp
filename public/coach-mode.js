/**
 * coach-mode.js — included on all client screens.
 * When the URL contains ?clientId=X, this script:
 *   1. Monkey-patches fetch() to append clientId to every /api/ call
 *   2. Injects a "Coaching [Name] — ← Dashboard" banner
 *   3. Sets window._coachMode = true so auth guards skip the login redirect
 */
(function () {
  var params  = new URLSearchParams(window.location.search);
  var cid     = params.get('clientId');
  var cname   = decodeURIComponent(params.get('clientName') || 'Client');

  if (!cid) return;

  window._coachMode       = true;
  window._coachClientId   = cid;
  window._coachClientName = cname;

  /* ── Fetch monkey-patch ── */
  var _orig = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.startsWith('/api/') &&
        !url.startsWith('/api/me') && !url.startsWith('/api/logout')) {
      url += (url.includes('?') ? '&' : '?') + 'clientId=' + encodeURIComponent(cid);
    }
    return _orig(url, opts);
  };

  /* ── Banner ── */
  function injectBanner() {
    if (document.getElementById('_coachBanner')) return;
    var b = document.createElement('div');
    b.id = '_coachBanner';
    b.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:rgba(201,168,76,0.13)',
      'border-bottom:1px solid rgba(201,168,76,0.28)',
      'padding:7px 16px',
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'font-family:Inter,sans-serif', 'font-size:11px', 'letter-spacing:0.04em',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)'
    ].join(';');
    b.innerHTML =
      '<span style="color:#C9A84C;font-weight:600">👁&nbsp; COACHING: ' + cname + '</span>' +
      '<a href="/gg-coach-dashboard.html" style="color:#C9A84C;font-weight:500;text-decoration:none">← Dashboard</a>';
    document.body.insertBefore(b, document.body.firstChild);
    /* Push the .app container down so content isn't hidden under the banner */
    var app = document.querySelector('.app');
    if (app) app.style.paddingTop = (parseInt(app.style.paddingTop || '0') + 34) + 'px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBanner);
  } else {
    injectBanner();
  }
})();
