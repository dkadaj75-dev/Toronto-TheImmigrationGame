// scripts/generate-placeholder-sounds.mjs — ROADMAP_NEXT item 7 (audio placeholders).
//
// Generates tiny (< 50KB each) mono 16-bit PCM WAV files under public/sounds/ so the data-driven
// audio system (game/audio.ts, ActionDef.sound / AssetDef.sound / MapData.music /
// tuning.audio.buyModeMusic) has something real to point at out of the box — same
// "drop-in-file, regenerate on demand" convention as scripts/generate-icons.mjs for the PWA icons.
// No new dependency: plain sine/noise synthesis written directly into a WAV container.
//
// Run with: node scripts/generate-placeholder-sounds.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'sounds');
const SAMPLE_RATE = 11025; // low but perfectly adequate for short placeholder cues, keeps files well under the 50KB budget

/** Builds a 16-bit PCM mono WAV file (Buffer) from a sample generator fn(t seconds) -> [-1, 1]. */
function synthWav(durationSeconds, sampleFn) {
  const numSamples = Math.round(durationSeconds * SAMPLE_RATE);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes/sample
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const s = Math.max(-1, Math.min(1, sampleFn(t)));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}

/** Short fade in/out envelope (seconds) so a loop doesn't click at the seam. */
function fadeEnvelope(t, duration, fade = 0.03) {
  if (t < fade) return t / fade;
  if (t > duration - fade) return Math.max(0, (duration - t) / fade);
  return 1;
}

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// --- individual placeholder sounds -------------------------------------------------------------
const sounds = [
  ...[
    ['ui_move.wav', 0.12, 420, 620],
    ['ui_action.wav', 0.10, 700, 900],
    ['quest_started.wav', 0.32, 520, 780],
    ['quest_completed.wav', 0.40, 660, 990],
    ['notification.wav', 0.18, 600, 600],
    ['skill_up.wav', 0.35, 740, 1110],
    ['money_up.wav', 0.24, 560, 840],
    ['money_down.wav', 0.24, 420, 280],
  ].map(([file, duration, firstHz, secondHz]) => ({
    file, duration,
    gen: (t) => 0.28 * Math.sin(2 * Math.PI * (t < duration / 2 ? firstHz : secondHz) * t) * fadeEnvelope(t, duration, 0.015),
  })),
  {
    // TV hum: a soft low-frequency drone (AssetDef.sound on "tv") — loops for as long as
    // "Watch TV" targets a TV instance.
    file: 'tv_hum.wav',
    duration: 1.5,
    gen: (t) => 0.15 * Math.sin(2 * Math.PI * 120 * t) * fadeEnvelope(t, 1.5) + 0.03 * Math.sin(2 * Math.PI * 121.5 * t),
  },
  {
    // Shower running: filtered noise-ish trickle (AssetDef.sound on "shower").
    file: 'shower_running.wav',
    duration: 1.2,
    gen: (() => {
      const rnd = seededRandom(42);
      let prev = 0;
      return (t) => {
        const white = rnd() * 2 - 1;
        prev = prev * 0.85 + white * 0.15; // cheap low-pass so it reads as water, not static
        return prev * 0.5 * fadeEnvelope(t, 1.2);
      };
    })(),
  },
  {
    // A brief two-tone "beep" placeholder for a generic action sfx (available for the designer
    // to wire onto any ActionDef.sound, e.g. a UI-ish cue for cooking/cleaning).
    file: 'action_beep.wav',
    duration: 0.35,
    gen: (t) => 0.3 * Math.sin(2 * Math.PI * (t < 0.17 ? 660 : 880) * t) * fadeEnvelope(t, 0.35, 0.02),
  },
  {
    // Condo map music track 1: a slow, gentle two-note pad loop — the map's music[] cycles between
    // this and track 2.
    file: 'music_condo_1.wav',
    duration: 2,
    gen: (t) => 0.12 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t)) * fadeEnvelope(t, 2, 0.15),
  },
  {
    // Condo map music track 2: a different slow pad, distinguishable from track 1 when cycling.
    file: 'music_condo_2.wav',
    duration: 2,
    gen: (t) => 0.12 * (Math.sin(2 * Math.PI * 196 * t) + Math.sin(2 * Math.PI * 246.94 * t)) * fadeEnvelope(t, 2, 0.15),
  },
  {
    // Buy-mode music: a brighter, slightly more upbeat pad (tuning.audio.buyModeMusic) —
    // distinguishable at a glance (well, a listen) from the map tracks.
    file: 'music_buymode.wav',
    duration: 2,
    gen: (t) => 0.12 * (Math.sin(2 * Math.PI * 329.63 * t) + Math.sin(2 * Math.PI * 392 * t)) * fadeEnvelope(t, 2, 0.15),
  },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const s of sounds) {
    const wav = synthWav(s.duration, s.gen);
    const outPath = path.join(OUT_DIR, s.file);
    await writeFile(outPath, wav);
    console.log(`wrote ${path.relative(process.cwd(), outPath)} (${(wav.length / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
