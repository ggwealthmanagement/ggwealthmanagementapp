/**
 * theme.js — light / dark mode for G&G app.
 * Include in <head> of every screen.
 * Uses data-theme="light" on <html> to override CSS variables.
 * toggleTheme() is called by the user-menu button on each screen.
 */
(function () {
  var STYLE_ID = '_ggTheme';

  var LIGHT_CSS = [
    'html[data-theme="light"] {',
    '  --black:     #F5F1EB;',
    '  --card:      #FFFFFF;',
    '  --card2:     #EDE9E2;',
    '  --white:     #1C1810;',
    '  --muted:     #6B6560;',
    '  --border:    rgba(120,90,30,0.20);',
    '  --gold:      #B8923E;',
    '  --gold-light:#9A7830;',
    '  --gold-dim:  #C9A84C;',
    '  --over:      #CC2200;',
    '}',
    'html[data-theme="light"] body { background: #F5F1EB; }',
    'html[data-theme="light"] #sparkle-canvas { opacity: 0 !important; }',
    /* Nav bar */
    'html[data-theme="light"] nav, html[data-theme="light"] .bottom-nav {',
    '  background: rgba(245,241,235,0.92) !important;',
    '  border-top-color: rgba(120,90,30,0.2) !important;',
    '}',
    /* User-menu overlay card */
    'html[data-theme="light"] #umOverlay > div {',
    '  background: #FFFFFF !important;',
    '  border-color: rgba(120,90,30,0.25) !important;',
    '}',
    'html[data-theme="light"] #umName { color: #1C1810 !important; }',
    /* Generic cards that use hardcoded dark values */
    'html[data-theme="light"] .card, html[data-theme="light"] [class*="card"] {',
    '  background: #FFFFFF;',
    '  border-color: rgba(120,90,30,0.18);',
    '}',
  ].join('\n');

  function applyTheme(mode) {
    var html = document.documentElement;
    /* Inject / remove the light-mode style block */
    var existing = document.getElementById(STYLE_ID);
    if (mode === 'light') {
      if (!existing) {
        var s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = LIGHT_CSS;
        document.head.appendChild(s);
      }
      html.setAttribute('data-theme', 'light');
    } else {
      if (existing) existing.remove();
      html.removeAttribute('data-theme');
    }
    /* Update toggle button label if it exists yet */
    var btn = document.getElementById('umThemeBtn');
    if (btn) btn.textContent = mode === 'light' ? '🌙  Dark Mode' : '☀️  Light Mode';
  }

  /* Apply saved theme immediately (before DOMContentLoaded avoids a flash) */
  var saved = localStorage.getItem('gg-theme') || 'dark';
  /* Can't inject style before <head> exists; use a tiny inline-safe guard */
  if (document.head) {
    applyTheme(saved);
  } else {
    document.addEventListener('DOMContentLoaded', function () { applyTheme(saved); });
  }

  /* Public API */
  window.toggleTheme = function () {
    var cur  = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var next = cur === 'light' ? 'dark' : 'light';
    localStorage.setItem('gg-theme', next);
    applyTheme(next);
  };

  /* Make sure button label is correct after DOM is ready */
  document.addEventListener('DOMContentLoaded', function () {
    var mode = localStorage.getItem('gg-theme') || 'dark';
    var btn  = document.getElementById('umThemeBtn');
    if (btn) btn.textContent = mode === 'light' ? '🌙  Dark Mode' : '☀️  Light Mode';
  });
})();
