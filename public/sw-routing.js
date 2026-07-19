// public/sw-routing.js — pure routing-decision logic for the service worker,
// split into its own module so it's headless-testable (test/sw-routing.test.mjs)
// without needing a ServiceWorker/fetch-event test harness — same "pure logic
// module + thin runtime layer" split as game/doors.ts, game/accidents.ts, etc.
//
// Plain ES module: sw.js imports it with `{ type: 'module' }` registration,
// and test/sw-routing.test.mjs imports it directly under plain Node.

/**
 * True for any request the service worker must NEVER answer from its cache:
 * - /data/*.json — the game polls this every 2s for hot-reload (game/data.ts's
 *   watchData()); serving a stale cached copy would silently break live tuning.
 * - /api/* — the tool constellation GETs and PUTs data through this; a cached
 *   GET response here could show a designer stale data after their own save,
 *   and PUT requests must always reach the real dev server anyway (this
 *   function is also used to decide whether to intercept at all).
 */
export function isDataOrApiPath(pathname, scopePathname = '/') {
  const scope = ('/' + scopePathname.replace(/^\/+|\/+$/g, '') + '/').replace(/^\/\/$/, '/');
  const scopedPath = scope !== '/' && pathname.startsWith(scope)
    ? '/' + pathname.slice(scope.length)
    : pathname;
  return scopedPath.startsWith('/data/') || scopedPath.startsWith('/api/');
}
