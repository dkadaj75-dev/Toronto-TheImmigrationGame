// fullscreen.ts — full-screen mode helpers, PURE-testable half (PROJECT_CONTEXT §7.77).
//
// Everything is duck-typed against the small slice of Document/Element the Fullscreen API needs,
// so jsdom tests can drive fake hosts without a real browser. The standard API and the WebKit
// prefix (older iPadOS/Safari) are both handled; on platforms with neither (notably iPhone
// Safari, which has no element fullscreen at all) `fullscreenSupported` is false and every
// surface hides its control instead of offering a dead switch.
//
// Never-throw: entering fullscreen needs a user gesture and can still be refused by the browser —
// a rejected promise or a throwing call must degrade to "nothing happened" (the resolveVar
// precedent), never block play. Callers keep their UI honest by listening to
// FULLSCREEN_CHANGE_EVENTS rather than assuming a request succeeded.

export interface FullscreenElementLike {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export interface FullscreenDocumentLike {
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
}

/** Both event names a caller must watch to stay in sync (ESC/F11/system exits included). */
export const FULLSCREEN_CHANGE_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

export function fullscreenSupported(element: FullscreenElementLike | null | undefined): boolean {
  return typeof element?.requestFullscreen === 'function'
    || typeof element?.webkitRequestFullscreen === 'function';
}

export function isFullscreen(doc: FullscreenDocumentLike | null | undefined): boolean {
  return !!(doc?.fullscreenElement ?? doc?.webkitFullscreenElement);
}

const swallow = (result: Promise<void> | void): void => {
  if (result && typeof (result as Promise<void>).catch === 'function') {
    void (result as Promise<void>).catch(() => { /* refused request — UI syncs via change events */ });
  }
};

/**
 * Drive the browser toward the requested state. Idempotent: asking for the state it is already
 * in does nothing. Returns whether a request was actually issued (test seam — the real outcome
 * only arrives via FULLSCREEN_CHANGE_EVENTS).
 */
export function setFullscreen(
  on: boolean,
  element: FullscreenElementLike | null | undefined,
  doc: FullscreenDocumentLike | null | undefined,
): boolean {
  try {
    if (on && !isFullscreen(doc)) {
      const request = element?.requestFullscreen ?? element?.webkitRequestFullscreen;
      if (!request || !element) return false;
      swallow(request.call(element));
      return true;
    }
    if (!on && isFullscreen(doc)) {
      const exit = doc?.exitFullscreen ?? doc?.webkitExitFullscreen;
      if (!exit || !doc) return false;
      swallow(exit.call(doc));
      return true;
    }
  } catch { /* never blocks play */ }
  return false;
}
