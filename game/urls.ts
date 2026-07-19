// Static-host-safe URL resolution. Authored public paths are traditionally stored as either
// `icons/x.svg` or `/icons/x.svg`; both must remain inside the deployed app base.
export function publicUrl(path: string, baseUrl?: string): string {
  if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)) return path;
  const browserBase = baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : undefined);
  if (!browserBase) return '/' + path.replace(/^\/+/, '');
  const resolved = new URL(path.replace(/^\/+/, ''), browserBase);
  return resolved.pathname + resolved.search + resolved.hash;
}
