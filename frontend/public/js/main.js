/*
 * Shared frontend bootstrap file.
 * Referenced by legacy pages as /main.js.
 */
(function bootstrap() {
  document.documentElement.classList.add('js-ready');

  var THEME_STORAGE_KEY = 'theme';

  function getSystemTheme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) {
      return 'light';
    }
  }

  function getStoredTheme() {
    try {
      var theme = localStorage.getItem(THEME_STORAGE_KEY);
      return theme === 'dark' || theme === 'light' ? theme : null;
    } catch (e) {
      return null;
    }
  }

  function getActiveTheme() {
    return document.documentElement.getAttribute('data-theme') || getStoredTheme() || getSystemTheme();
  }

  function setActiveTheme(theme) {
    var normalized = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', normalized);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch (e) {
      // ignore
    }
    syncThemeToggles(normalized);
  }

  function syncThemeToggles(theme) {
    var toggles = document.querySelectorAll('[data-theme-toggle]');
    if (!toggles || toggles.length === 0) return;

    toggles.forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');

      var moon = btn.querySelector('[data-theme-icon="moon"]');
      var sun = btn.querySelector('[data-theme-icon="sun"]');

      // If current theme is dark, show the sun icon (meaning: click to go light)
      if (moon) moon.classList.toggle('hidden', theme === 'dark');
      if (sun) sun.classList.toggle('hidden', theme !== 'dark');
    });
  }

  function attachThemeToggleHandlers() {
    var toggles = document.querySelectorAll('[data-theme-toggle]');
    if (!toggles || toggles.length === 0) return;

    toggles.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var current = getActiveTheme();
        setActiveTheme(current === 'dark' ? 'light' : 'dark');
      });
    });
  }

  // Keep UI in sync on load
  syncThemeToggles(getActiveTheme());
  attachThemeToggleHandlers();
})();
