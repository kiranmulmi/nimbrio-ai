// Paint the stored theme before React mounts so there is no flash of the wrong palette.
// A separate file (not an inline script) so the API's Content-Security-Policy allows it.
(function () {
  var stored = null;
  try {
    stored = localStorage.getItem('theme');
  } catch (error) {
    stored = null;
  }
  var resolved =
    stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.setAttribute('data-theme', resolved);
  // In the desktop app (its preload sets nimbrioDesktop) the window has no title bar: the top
  // bars make room for the window buttons and move the window (index.css, data-desktop).
  if (window.nimbrioDesktop && window.nimbrioDesktop.platform) {
    document.documentElement.setAttribute('data-desktop', window.nimbrioDesktop.platform);
  }
})();
