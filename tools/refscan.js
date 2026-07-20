// refscan.js — AUDIT bugs 4-13: shared cross-file dangling-reference scanner for the editors.
// Full auto-cleanup across files a tool doesn't own would mean silently PUTting files behind the
// designer's back; instead every delete fires a scan and the tool SHOWS which files still
// reference the deleted id, so nothing dangles silently. Exact-string matching (value === id, or
// object key === id), so short generic ids can rarely over-report — the warning names file +
// hit count, never auto-edits. Loaded via <script src="/tools/refscan.js"> (condition-builder.js
// precedent); consumers guard with window.RefScan?. so jsdom suites run without it.
(function (global) {
  'use strict';

  const DEFAULT_FILES = [
    'assets.json', 'interactions.json', 'stats.json', 'tuning.json', 'behavior.json',
    'quests.json', 'jobs.json', 'visas.json', 'happiness.json', 'social.json', 'npcs.json',
    'notifications.json', 'finance.json', 'bills.json', 'simstate.json',
  ];

  function scanValue(node, ids, path, hits) {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') { if (ids.includes(node)) hits.push(path || '(root)'); return; }
    if (Array.isArray(node)) { node.forEach((v, i) => scanValue(v, ids, `${path}[${i}]`, hits)); return; }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (ids.includes(k)) hits.push(`${path ? path + '.' : ''}${k} (key)`);
        scanValue(v, ids, path ? `${path}.${k}` : k, hits);
      }
    }
  }

  /** Scan every data file (minus the tool's own, already-reconciled ones) for `ids` (a string or
   *  array — pass e.g. ['study', 'quests.study.state'] for a quest). Resolves to
   *  [{ file, hits: [jsonPath, …] }]. Network/parse failures skip the file silently. */
  async function scanDanglingRefs(ids, opts = {}) {
    const idList = Array.isArray(ids) ? ids : [ids];
    const skip = new Set(opts.skipFiles || []);
    const results = [];
    for (const file of opts.files || DEFAULT_FILES) {
      if (skip.has(file)) continue;
      try {
        const res = await fetch('/api/data/' + file);
        if (!res.ok) continue;
        const hits = [];
        scanValue(await res.json(), idList, '', hits);
        if (hits.length) results.push({ file, hits });
      } catch { /* unreachable file → nothing to report */ }
    }
    return results;
  }

  function formatDanglingWarning(id, results) {
    if (!results.length) return '';
    const where = results.map((r) => `${r.file} (${r.hits.length}× e.g. ${r.hits[0]})`).join(' · ');
    return `⚠ deleted "${id}" is still referenced on disk: ${where} — clean those up (or re-add the id)`;
  }

  /** One-call convenience: scan and push the warning into a status callback if anything dangles. */
  function warnAfterDelete(id, ids, opts, setStatus) {
    scanDanglingRefs(ids, opts).then((results) => {
      const warning = formatDanglingWarning(id, results);
      if (warning) setStatus(warning);
    }).catch(() => {});
  }

  global.RefScan = { scanDanglingRefs, formatDanglingWarning, warnAfterDelete, scanValue };
})(typeof window !== 'undefined' ? window : globalThis);
