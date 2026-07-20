// pathnorm.js — AUDIT overlap 36: the ONE Windows-path → public/-URL reduction algorithm, shared
// by every tool (Social/Theme/Finance/Map/Animations/Tuning/Assets/System had drifted copies with
// incompatible failure behavior). Classic script like nav.js/condition-builder.js/refscan.js.
//
// Core contract — reduce(raw):
//   { ok: true,  path }  path is public/-RELATIVE with NO leading slash ('' for blank input);
//   { ok: false, path }  the input looked like a Windows path but carried no /public/ segment —
//                        `path` is the best-effort reduction (drive letter stripped). Callers
//                        decide their own failure policy (warn / throw / accept best-effort),
//                        which is exactly where the old copies disagreed.
// Convenience wrappers cover the two storage conventions in use:
//   publicRelative(raw) → 'textures/x.jpg'   (assets/system style)
//   publicUrl(raw)      → '/textures/x.jpg'  (social/map/theme/finance/animations/tuning style;
//                         keeps http(s) URLs untouched, '' for blank)
(function (global) {
  'use strict';

  function reduce(raw) {
    let path = String(raw ?? '').trim().replace(/\\/g, '/');
    if (!path) return { ok: true, path: '' };
    const looksWindows = /^\/?[a-zA-Z]:\//.test(path) || String(raw).includes('\\');
    const match = /\/public(\/.+)$/i.exec(path);
    if (match) return { ok: true, path: match[1].replace(/^\/+/, '') };
    if (looksWindows) return { ok: false, path: path.replace(/^\/?[a-zA-Z]:\//, '') };
    return { ok: true, path: path.replace(/^\/+/, '') };
  }

  function publicRelative(raw) { return reduce(raw).path; }

  function publicUrl(raw) {
    const { path } = reduce(raw);
    if (!path) return '';
    if (/^https?:/i.test(String(raw ?? '').trim())) return String(raw).trim();
    return '/' + path;
  }

  global.PathNorm = { reduce, publicRelative, publicUrl };
})(typeof window !== 'undefined' ? window : globalThis);
