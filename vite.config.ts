import { defineConfig } from 'vite';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Relative output runs at an origin root (Netlify) or an arbitrary subpath (GitHub Pages).
export default defineConfig(({ command }) => ({
  base: './',
  define: { __STATIC_PROD__: JSON.stringify(command === 'build') },
  plugins: [{
    name: 'copy-static-game-data',
    apply: 'build',
    async writeBundle(options) {
      const outDir = path.resolve(String(options.dir ?? 'dist'));
      const sourceDir = path.resolve('data');
      const targetDir = path.join(outDir, 'data');
      await cp(sourceDir, targetDir, { recursive: true });
      const mapNames = (await readdir(path.join(sourceDir, 'maps')))
        .filter((name) => name.endsWith('.json') && name !== 'index.json')
        .map((name) => name.slice(0, -5)).sort();
      await mkdir(path.join(targetDir, 'maps'), { recursive: true });
      await writeFile(path.join(targetDir, 'maps', 'index.json'), JSON.stringify({ maps: mapNames }, null, 2) + '\n');
    },
  }],
  build: { target: 'es2022' },
  publicDir: 'public',
}));
