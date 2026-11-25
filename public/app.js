// DealDesk OS — tiny progressive enhancements (no inline scripts; CSP-friendly).
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (b) {
      e.preventDefault();
      var el = document.querySelector(b.getAttribute('data-copy')); if (!el) return;
      var txt = el.value != null ? el.value : el.textContent;
      var done = function () { var o = b.textContent; b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = o; }, 1500); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, function () { el.select && el.select(); document.execCommand('copy'); done(); });
      else { el.select && el.select(); document.execCommand('copy'); done(); }
    }
    if (e.target.closest('[data-print]')) { e.preventDefault(); window.print(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target; var msg = f.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
  // Auto-submit stage selects on kanban cards for one-click moves.
  document.querySelectorAll('.kmove select').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
})();
