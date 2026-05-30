/*
 * Placeholder analytics entrypoint.
 * Keep this file lightweight to avoid 404s for legacy /analytics.js includes.
 */
window.AuditProAnalytics = window.AuditProAnalytics || {
  track: function track(eventName, payload) {
    if (window.console && typeof window.console.debug === 'function') {
      window.console.debug('[AuditProAnalytics]', eventName, payload || {});
    }
  }
};
