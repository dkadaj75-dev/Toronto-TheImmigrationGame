// scripts/generate-icons.mjs — regenerates the PWA placeholder icons.
//
// One-time-ish utility (PROJECT_CONTEXT.md §8): the designer should replace
// public/icons/icon-192.png and icon-512.png with real art whenever it's
// ready — this script just needs to exist so "regenerate the placeholders"
// is a documented, repeatable command rather than a one-off Claude session.
// Run with: node scripts/generate-icons.mjs
//
// Uses the `canvas` devDependency (already installed for test/sprites.test.ts's
// hand-made test PNG, PROJECT_CONTEXT §7.5) — no new dependency added.

import { createCanvas } from 'canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

// Matches the game's own palette: #1b2230 body/boot background (index.html),
// #5a9fd6 accent (quest-toast border-left / hover-box blue in main.ts).
const BG = '#1b2230';
const ACCENT = '#5a9fd6';
const GLYPH = 'CL';

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);

  // rounded accent square (a placeholder "room/condo" motif — simple geometry only)
  const pad = size * 0.16;
  const r = size * 0.14;
  const w = size - pad * 2;
  roundRect(ctx, pad, pad, w, w, r);
  ctx.fillStyle = ACCENT;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;

  // glyph
  ctx.fillStyle = '#0f1420';
  ctx.font = `700 ${Math.round(size * 0.34)}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(GLYPH, size / 2, size / 2 + size * 0.02);

  return canvas;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const size of [192, 512]) {
    const canvas = drawIcon(size);
    const buf = canvas.toBuffer('image/png');
    const file = path.join(OUT_DIR, `icon-${size}.png`);
    await writeFile(file, buf);
    console.log(`wrote ${file} (${buf.length} bytes)`);
  }
}

main();
