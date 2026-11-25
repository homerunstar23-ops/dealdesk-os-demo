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
  // v3: loading states. A submitted form's button shows a spinner and the form can't be double-submitted.
  document.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    var f = e.target; if (f.getAttribute('target') === '_blank' || f.method.toLowerCase() === 'get' && f.classList.contains('cmd')) return;
    if (f.dataset.busy) { e.preventDefault(); return; }
    f.dataset.busy = '1';
    var b = e.submitter || f.querySelector('button:not([type=button])'); if (b && b.classList.contains('btn')) b.classList.add('is-loading');
    document.body.classList.add('is-navigating');
  });
  // Restore after back/forward cache.
  window.addEventListener('pageshow', function () { document.body.classList.remove('is-navigating'); document.querySelectorAll('form[data-busy]').forEach(function (f) { delete f.dataset.busy; }); document.querySelectorAll('.is-loading').forEach(function (b) { b.classList.remove('is-loading'); }); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]'); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    var h = a.getAttribute('href'); if (!h || h.charAt(0) === '#' || /^(tel:|mailto:|https?:)/.test(h)) return;
    document.body.classList.add('is-navigating');
  });

  // v3: command bar. "/" or Ctrl/Cmd+K focuses it; live results from /search.json; arrows + Enter to pick.
  var cmd = document.getElementById('cmd'), box = document.getElementById('cmd-results');
  if (cmd && box) {
    var timer = null, sel = -1, items = [];
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var paint = function () {
      if (!items.length) { box.innerHTML = '<div class="none">No matches. Press Enter to search everything.</div>'; return; }
      box.innerHTML = items.map(function (r, i) { return '<a role="option" href="' + esc(r.href) + '" class="' + (i === sel ? 'sel' : '') + '"><span class="rtype">' + esc(r.type) + '</span><strong>' + esc(r.label) + '</strong>' + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</a>'; }).join('');
    };
    var run = function () {
      var q = cmd.value.trim(); if (!q) { box.hidden = true; return; }
      fetch('/search.json?q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : { results: [] }; })
        .then(function (j) { if (cmd.value.trim() !== q) return; items = j.results || []; sel = items.length ? 0 : -1; paint(); box.hidden = false; })
        .catch(function () { box.hidden = true; });
    };
    cmd.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 120); });
    cmd.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!items.length) return; e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); }
      else if (e.key === 'Enter' && !box.hidden && sel >= 0 && items[sel]) { e.preventDefault(); document.body.classList.add('is-navigating'); window.location.href = items[sel].href; }
      else if (e.key === 'Escape') { box.hidden = true; cmd.blur(); }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.cmd')) box.hidden = true; });
    document.addEventListener('keydown', function (e) {
      var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); cmd.focus(); cmd.select(); }
    });
  }
  // Close the "More" menu when clicking elsewhere.
  document.addEventListener('click', function (e) { document.querySelectorAll('details.more-menu[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); }); });

  // Auto-submit stage selects on kanban cards for one-click moves.
  document.querySelectorAll('.kmove select').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
})();
