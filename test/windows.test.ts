// windows.test.ts — game/windows.ts pure geometry math (ROADMAP_NEXT item 9).
// Run: npx tsx test/windows.test.ts
import { resolveWindowConfig, windowBaseYawDeg, windowPaneRect, type WindowEntry } from '../game/windows';
import type { TuningData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
function approx(a: number, b: number, eps = 1e-6) { return Math.abs(a - b) <= eps; }

const tuning: TuningData = {
  simulation: { needsDecayTickSeconds: 1, activityGainTickSeconds: 2 },
  autonomy: { seekBelowThreshold: 30, stopAtThreshold: 95, postPlayerCommandCooldownSeconds: 10 },
  time: { secondsPerGameDay: 60, nightStartHour: 22, nightEndHour: 6 },
  economy: { startingFunds: 0, currencyName: '§' },
  movement: { walkSpeed: 2, arrivalRadius: 0.35 },
  camera: { minZoom: 4, maxZoom: 18, minPitchDeg: 30, maxPitchDeg: 70, panBoundsPadding: 2 },
  quests: { toastDurationSeconds: 4, completedLogLimit: 5 },
};

console.log('windows.test — resolveWindowConfig (sparse per-window width over tuning.windows)');
{
  const entry: WindowEntry = { at: [2, 0], orientation: 'horizontal' };
  const cfg = resolveWindowConfig(entry, tuning);
  check('width falls back to hardcoded default when both entry and tuning are absent', cfg.width === 1.2);
  check('height falls back to hardcoded default', cfg.height === 1.1);
  check('sillHeight falls back to hardcoded default', cfg.sillHeight === 0.9);

  const withTuning: TuningData = { ...tuning, windows: { width: 1.5, height: 1.2, sillHeight: 1.0 } };
  const cfg2 = resolveWindowConfig(entry, withTuning);
  check('width falls back to tuning.windows.width', cfg2.width === 1.5);
  check('height falls back to tuning.windows.height', cfg2.height === 1.2);
  check('sillHeight falls back to tuning.windows.sillHeight', cfg2.sillHeight === 1.0);

  const withOverride: WindowEntry = { at: [2, 0], orientation: 'horizontal', width: 2 };
  const cfg3 = resolveWindowConfig(withOverride, withTuning);
  check('per-window width overrides tuning.windows.width', cfg3.width === 2);
  check('height/sillHeight are tuning-only (no per-window override) — still from tuning', cfg3.height === 1.2 && cfg3.sillHeight === 1.0);
}

console.log('windows.test — windowBaseYawDeg (mirrors doors.ts doorBaseYawDeg)');
{
  check('horizontal wall → base yaw 0', windowBaseYawDeg('horizontal') === 0);
  check('vertical wall → base yaw 90', windowBaseYawDeg('vertical') === 90);
}

console.log('windows.test — windowPaneRect (world-space box params)');
{
  const cfg = { width: 1.2, height: 1.1, sillHeight: 0.9 };
  const horiz: WindowEntry = { at: [2, 0], orientation: 'horizontal' };
  const rectH = windowPaneRect(horiz, cfg);
  check('horizontal pane centered on entry.at in XZ', approx(rectH.position[0], 2) && approx(rectH.position[2], 0), `${rectH.position}`);
  check('pane vertical center = sillHeight + height/2', approx(rectH.position[1], 0.9 + 0.55), `${rectH.position[1]}`);
  check('pane width matches config.width', approx(rectH.size[0], 1.2));
  check('pane height matches config.height', approx(rectH.size[1], 1.1));
  check('pane has a small fixed thickness', rectH.size[2] > 0 && rectH.size[2] < 0.2, String(rectH.size[2]));
  check('horizontal wall → yaw 0', rectH.yawDeg === 0);

  const vert: WindowEntry = { at: [9, 3.5], orientation: 'vertical' };
  const rectV = windowPaneRect(vert, cfg);
  check('vertical pane centered on entry.at in XZ', approx(rectV.position[0], 9) && approx(rectV.position[2], 3.5), `${rectV.position}`);
  check('vertical wall → yaw 90', rectV.yawDeg === 90);

  const custom = { width: 2, height: 1.5, sillHeight: 1.0 };
  const rectCustom = windowPaneRect(horiz, custom);
  check('a custom config resizes/repositions the pane', approx(rectCustom.size[0], 2) && approx(rectCustom.position[1], 1.0 + 0.75));
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall windows tests passed');
