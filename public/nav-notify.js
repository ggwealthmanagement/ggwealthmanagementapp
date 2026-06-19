// Adds a red notification dot to the Coach (💬) nav item when the coach has
// sent new messages since the client last viewed the chat.
(function () {
  // Only run on client screens (not coach dashboard)
  if (window._coachMode) return;

  // Inject dot into last .nav-item (always the Coach tab)
  function injectDot() {
    var navItems = document.querySelectorAll('.nav-item');
    var coachTab = navItems[navItems.length - 1];
    if (!coachTab || document.getElementById('coach-nav-dot')) return;
    var icon = coachTab.querySelector('.nav-icon');
    if (!icon) return;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;justify-content:center';
    icon.parentNode.insertBefore(wrap, icon);
    wrap.appendChild(icon);
    var dot = document.createElement('span');
    dot.id = 'coach-nav-dot';
    dot.style.cssText = 'display:none;position:absolute;top:-2px;right:-5px;width:9px;height:9px;' +
      'border-radius:50%;background:#E05555;border:2px solid var(--black);animation:blink 1.6s ease-in-out infinite';
    wrap.appendChild(dot);
  }

  function checkUnread() {
    var lastRead = parseInt(localStorage.getItem('gg_msg_read_ts') || '0');
    fetch('/api/messages')
      .then(function (r) { return r.json(); })
      .then(function (msgs) {
        var hasNew = Array.isArray(msgs) && msgs.some(function (m) {
          return m.sender_role === 'coach' &&
                 new Date(m.created_at).getTime() > lastRead;
        });
        var dot = document.getElementById('coach-nav-dot');
        if (dot) dot.style.display = hasNew ? 'block' : 'none';
      })
      .catch(function () {});
  }

  document.addEventListener('DOMContentLoaded', function () {
    injectDot();
    checkUnread();
    setInterval(checkUnread, 30000);
  });
})();
