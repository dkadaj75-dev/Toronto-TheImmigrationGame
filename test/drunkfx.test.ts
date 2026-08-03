// drunkfx.test.ts — pure coverage for game/drunkfx.ts (PROJECT_CONTEXT §7.76).
// Run: npx tsx test/drunkfx.test.ts

import {
  DRUNK_FX_DEFAULTS,
  drunkFilterCss,
  drunkFxFrame,
  drunkIntensity,
  drunkTransformCss,
  type DrunkFxTuning,
} from '../game/drunkfx';

let passed = 0;
function ok(cond: boolean, label: string) {
  if (!cond) { console.error('FAIL', label); process.exit(1); }
  passed++; console.log('  ok ', label);
}
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// The live tuning block must parse and drive the effect end to end (fixture derives from live
// data on purpose — the map-editor "never hardcode what data can provide" lesson).
import { readFileSync } from 'fs';
const liveTuning = JSON.parse(readFileSync(new URL('../data/tuning.json', import.meta.url), 'utf8'));
const liveCfg = liveTuning.drunkFx as DrunkFxTuning;

console.log('drunkfx.test — intensity ramp');
ok(drunkIntensity(100) === 0, 'fully sober => 0');
ok(drunkIntensity(DRUNK_FX_DEFAULTS.startBelowSobriety) === 0, 'exactly at the ramp threshold => 0');
ok(drunkIntensity(0) === 1, 'sobriety 0 => full intensity');
ok(approx(drunkIntensity(35), (70 - 35) / 70), 'linear midpoint');
ok(drunkIntensity(-20) === 1, 'below-zero sobriety clamps to 1');
ok(drunkIntensity(30, { enabled: false }) === 0, 'enabled:false kills the effect');
ok(drunkIntensity(NaN) === 0, 'non-finite sobriety degrades to 0, never throws');
ok(drunkIntensity(30, { startBelowSobriety: NaN }) > 0, 'malformed threshold falls back to default');
ok(drunkIntensity(30, liveCfg) > 0, 'live tuning.json block produces a drunk intensity at 30');

console.log('drunkfx.test — frame resolution');
const sober = drunkFxFrame(100, 12.34, liveCfg);
ok(sober.intensity === 0 && sober.blurPx === 0 && sober.saturate === 1 && sober.vignetteOpacity === 0
  && sober.rollDeg === 0 && sober.shiftXPx === 0 && sober.shiftYPx === 0 && sober.scale === 1,
  'sober frame is exact identity');
const peak = drunkFxFrame(0, 3.7, liveCfg);
ok(approx(peak.blurPx, liveCfg.maxBlurPx!), 'peak blur equals the authored max');
ok(approx(peak.saturate, liveCfg.maxSaturate!), 'peak saturation equals the authored max');
ok(approx(peak.vignetteOpacity, liveCfg.maxVignette!), 'peak vignette equals the authored max');
ok(Math.abs(peak.rollDeg) <= liveCfg.wobbleMaxDeg!, 'roll stays within the authored amplitude');
ok(Math.abs(peak.shiftXPx) <= liveCfg.wobbleMaxShiftPx!, 'x drift stays within the authored amplitude');
ok(peak.scale > 1 && peak.scale <= 1.03 + 1e-9, 'edge-hiding zoom is small and bounded');
const again = drunkFxFrame(0, 3.7, liveCfg);
ok(again.rollDeg === peak.rollDeg && again.shiftXPx === peak.shiftXPx, 'deterministic in (sobriety, t)');
const later = drunkFxFrame(0, 3.9, liveCfg);
ok(later.rollDeg !== peak.rollDeg || later.shiftXPx !== peak.shiftXPx, 'the sway actually moves over time');
const half = drunkFxFrame(35, 3.7, liveCfg);
ok(half.blurPx < peak.blurPx && half.vignetteOpacity < peak.vignetteOpacity,
  'a tipsier sim gets a stronger effect than a half-drunk one');
ok(drunkFxFrame(0, NaN, liveCfg).blurPx > 0, 'non-finite clock still yields a valid frame');
const defaulted = drunkFxFrame(0, 1, undefined);
ok(approx(defaulted.blurPx, DRUNK_FX_DEFAULTS.maxBlurPx), 'absent tuning block uses the defaults');
ok(drunkFxFrame(0, 1, { maxSaturate: 0.2 }).saturate === 1, 'saturate below 1 clamps to identity (never desaturates by accident)');

console.log('drunkfx.test — CSS strings');
ok(drunkFilterCss(sober) === '' && drunkTransformCss(sober) === '', 'sober => empty strings so the caller can unset styles');
const filter = drunkFilterCss(peak);
ok(filter.includes('blur(') && filter.includes('saturate('), 'peak filter carries blur + saturation');
const transform = drunkTransformCss(peak);
ok(transform.includes('translate(') && transform.includes('rotate(') && transform.includes('scale('),
  'peak transform carries drift + roll + zoom');
ok(drunkFilterCss(drunkFxFrame(0, 1, { maxBlurPx: 0, maxSaturate: 1 })) === '',
  'zeroed knobs collapse the filter to empty (vignette-only authoring works)');

console.log(`\nall ${passed} drunkfx tests passed`);
