/**
 * coach-mode.js — included on all client screens.
 * When the URL contains ?clientId=X, this script:
 *   1. Monkey-patches fetch() to append clientId to every /api/ call
 *   2. Injects a thin coaching indicator banner at the top
 *   3. Injects a "← Coach Home" button inside the top-right user menu
 *   4. Sets window._coachMode = true so auth guards skip the login redirect
 */
(function () {
  var params  = new URLSearchParams(window.location.search);
  var cid     = params.get('clientId');
  var cname   = decodeURIComponent(params.get('clientName') || 'Client');

  if (!cid) return;

  window._coachMode       = true;
  window._coachClientId   = cid;
  window._coachClientName = cname;

  /* ── Fetch monkey-patch ─────────────────────────────────────────────────── */
  var _orig = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.startsWith('/api/') &&
        !url.startsWith('/api/me') && !url.startsWith('/api/logout')) {
      url += (url.includes('?') ? '&' : '?') + 'clientId=' + encodeURIComponent(cid);
    }
    return _orig(url, opts);
  };

  /* ── Inject UI ──────────────────────────────────────────────────────────── */
  function injectUI() {
    if (document.getElementById('_coachBanner')) return;

    /* ── Thin top banner (coaching indicator only) ── */
    var b = document.createElement('div');
    b.id = '_coachBanner';
    b.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:rgba(8,8,8,0.96)',
      'border-bottom:1px solid rgba(201,168,76,0.25)',
      'padding:8px 16px',
      'display:flex', 'align-items:center', 'gap:8px',
      'font-family:Inter,sans-serif',
      'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)'
    ].join(';');
    b.innerHTML =
      '<span style="font-size:12px">👁</span>' +
      '<span style="font-size:9px;color:rgba(201,168,76,0.6);letter-spacing:0.16em;text-transform:uppercase;font-weight:600">Coaching:</span>' +
      '<span style="font-size:12px;font-weight:600;color:#F0EDE8">' + cname + '</span>';

    document.body.insertBefore(b, document.body.firstChild);

    /* Push .app down so content isn't hidden under the banner (~36px) */
    var app = document.querySelector('.app');
    if (app) {
      var cur = parseInt(app.style.paddingTop) || 0;
      app.style.paddingTop = (cur + 36) + 'px';
    }

    /* ── Inject "← Coach Home" button into the user menu overlay ── */
    injectMenuButton();
  }

  function injectMenuButton() {
    var overlay = document.getElementById('umOverlay');
    if (!overlay) {
      /* Retry once after a short delay in case the menu renders late */
      setTimeout(injectMenuButton, 300);
      return;
    }

    /* Find the Sign Out button to insert before it */
    var signOutBtn = overlay.querySelector('button[onclick*="doLogout"]');
    if (!signOutBtn) return;

    var btn = document.createElement('button');
    btn.onclick = function () { window.location.href = '/gg-coach-dashboard.html'; };
    btn.style.cssText = [
      'width:100%',
      'padding:13px',
      'background:rgba(201,168,76,0.1)',
      'border:1px solid rgba(201,168,76,0.3)',
      'border-radius:10px',
      'color:#C9A84C',
      'font-family:Inter,sans-serif',
      'font-size:13px',
      'font-weight:600',
      'cursor:pointer',
      'letter-spacing:0.04em',
      'margin-bottom:8px',
      'display:block'
    ].join(';');
    btn.textContent = '🏠  Coach Dashboard';

    signOutBtn.parentNode.insertBefore(btn, signOutBtn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectUI);
  } else {
    injectUI();
  }
})();
