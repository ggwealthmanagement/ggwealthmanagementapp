/**
 * coach-mode.js — included on all client screens.
 * When the URL contains ?clientId=X, this script:
 *   1. Monkey-patches fetch() to append clientId to every /api/ call
 *   2. Injects a prominent top banner showing which client is being viewed
 *   3. Injects a persistent floating "← Dashboard" pill above the bottom nav
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
  function injectBanner() {
    if (document.getElementById('_coachBanner')) return;

    /* ── Top banner ── */
    var b = document.createElement('div');
    b.id = '_coachBanner';
    b.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:rgba(8,8,8,0.96)',
      'border-bottom:1px solid rgba(201,168,76,0.3)',
      'padding:10px 16px',
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'font-family:Inter,sans-serif',
      'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)',
      'gap:12px'
    ].join(';');

    b.innerHTML =
      /* left: eye icon + labels */
      '<div style="display:flex;align-items:center;gap:9px;min-width:0;overflow:hidden">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:rgba(201,168,76,0.12);' +
             'border:1px solid rgba(201,168,76,0.3);display:flex;align-items:center;justify-content:center;' +
             'font-size:13px;flex-shrink:0">👁</div>' +
        '<div style="min-width:0">' +
          '<div style="font-size:9px;color:rgba(201,168,76,0.65);letter-spacing:0.16em;' +
               'text-transform:uppercase;font-weight:600;line-height:1">Coaching</div>' +
          '<div style="font-size:14px;font-weight:700;color:#F0EDE8;white-space:nowrap;' +
               'overflow:hidden;text-overflow:ellipsis;line-height:1.3">' + cname + '</div>' +
        '</div>' +
      '</div>' +
      /* right: back button */
      '<a href="/gg-coach-dashboard.html" style="' + [
        'background:rgba(201,168,76,0.1)',
        'border:1px solid rgba(201,168,76,0.4)',
        'border-radius:9px',
        'color:#C9A84C',
        'font-family:Inter,sans-serif',
        'font-size:12px',
        'font-weight:700',
        'letter-spacing:0.05em',
        'padding:8px 14px',
        'text-decoration:none',
        'white-space:nowrap',
        'flex-shrink:0',
        'display:flex',
        'align-items:center',
        'gap:5px'
      ].join(';') + '">← Dashboard</a>';

    document.body.insertBefore(b, document.body.firstChild);

    /* Push .app down so content isn't hidden under banner (~56px tall) */
    var app = document.querySelector('.app');
    if (app) {
      var cur = parseInt(app.style.paddingTop) || 0;
      app.style.paddingTop = (cur + 56) + 'px';
    }

    /* ── Floating "← Dashboard" pill above bottom nav ── */
    var pill = document.createElement('a');
    pill.id   = '_coachPill';
    pill.href = '/gg-coach-dashboard.html';
    pill.style.cssText = [
      'position:fixed',
      'bottom:88px',
      'left:18px',
      'z-index:9998',
      'background:rgba(10,10,10,0.94)',
      'border:1px solid rgba(201,168,76,0.45)',
      'border-radius:24px',
      'color:#C9A84C',
      'font-family:Inter,sans-serif',
      'font-size:12px',
      'font-weight:700',
      'letter-spacing:0.05em',
      'padding:10px 18px',
      'text-decoration:none',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'backdrop-filter:blur(12px)',
      '-webkit-backdrop-filter:blur(12px)',
      'box-shadow:0 4px 22px rgba(0,0,0,0.55),0 0 0 1px rgba(201,168,76,0.08)',
      'transition:border-color 0.15s,box-shadow 0.15s',
      'user-select:none'
    ].join(';');
    pill.innerHTML =
      '<span style="font-size:14px;line-height:1">←</span>' +
      '<span>Dashboard</span>';

    /* Hover glow */
    pill.addEventListener('mouseenter', function () {
      pill.style.borderColor = 'rgba(201,168,76,0.75)';
      pill.style.boxShadow   = '0 4px 28px rgba(201,168,76,0.18),0 0 0 1px rgba(201,168,76,0.15)';
    });
    pill.addEventListener('mouseleave', function () {
      pill.style.borderColor = 'rgba(201,168,76,0.45)';
      pill.style.boxShadow   = '0 4px 22px rgba(0,0,0,0.55),0 0 0 1px rgba(201,168,76,0.08)';
    });

    document.body.appendChild(pill);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBanner);
  } else {
    injectBanner();
  }
})();
