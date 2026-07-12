// server.js — tiny dev server (roadmap §5).
// Serves the game + tools through Vite middleware and exposes save endpoints so the
// browser-based editors (Phase 2+) can write back to data/*.json. Everything stays git-diffable.

import { createServer as createViteServer } from 'vite';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const PORT = process.env.PORT || 5173;

// Only files under data/ may be read/written, and only .json.
function resolveDataPath(rel) {
  const p = path.normalize(path.join(DATA_DIR, rel));
  if (!p.startsWith(DATA_DIR) || !p.endsWith('.json')) return null;
  return p;
}

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: 'spa',
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // --- data API (used by the tool constellation) ---
  if (url.pathname.startsWith('/api/data/')) {
    const rel = decodeURIComponent(url.pathname.slice('/api/data/'.length));
    const file = resolveDataPath(rel);
    if (!file) { res.writeHead(400); res.end('invalid data path'); return; }

    if (req.method === 'GET') {
      try {
        const body = await readFile(file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      } catch { res.writeHead(404); res.end('not found'); }
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        try {
          JSON.parse(body); // validate before touching disk
          await writeFile(file, body, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } catch (err) {
          res.writeHead(400);
          res.end(`invalid JSON: ${err.message}`);
        }
      });
      return;
    }

    res.writeHead(405); res.end();
    return;
  }

  // --- serve raw data files to the game (with no-cache for hot-reload polling) ---
  if (url.pathname.startsWith('/data/')) {
    const file = resolveDataPath(url.pathname.slice('/data/'.length));
    if (file) {
      try {
        const body = await readFile(file, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      } catch { /* fall through to vite 404 */ }
    }
  }

  vite.middlewares(req, res);
});

server.listen(PORT, () => {
  console.log(`Condo Life dev server → http://localhost:${PORT}`);
  console.log('  game:   /');
  console.log('  tools:  /tools/ (Phase 2+)');
  console.log('  data:   GET/PUT /api/data/<file>.json');
});
