// Swipe-lock: prevent left/right swipe from navigating to prev/next page.
// Uses history buffer so iOS Safari edge-swipe pops our dummy state instead.
(function () {
  // Push a buffer state on top of the real entry
  if (!window.history.state || !window.history.state._gg) {
    window.history.replaceState({ _gg: true }, '');
    window.history.pushState({ _gg: true }, '');
  }
  // When browser pops (swipe-back or swipe-forward), immediately re-push so
  // we stay on this page — buttons are the only navigation allowed.
  window.addEventListener('popstate', function () {
    window.history.pushState({ _gg: true }, '');
  });
  // Belt-and-suspenders: also preventDefault horizontal touch drags
  var sx = 0, sy = 0;
  document.addEventListener('touchstart', function (e) {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    var dx = Math.abs(e.touches[0].clientX - sx);
    var dy = Math.abs(e.touches[0].clientY - sy);
    if (dx > dy && dx > 10) e.preventDefault();
  }, { passive: false });
})();
