// Loaded synchronously in <head> so the saved theme applies before first
// paint (no flash of the wrong theme). Kept as a file rather than an inline
// script so the page can run under script-src 'self'.
(function () {
  var t = null;
  try { t = localStorage.getItem('mcpresence:theme'); } catch (_) {}
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
