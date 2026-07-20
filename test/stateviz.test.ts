// stateviz.test.ts — pure state-visuals resolution (game/stateviz.ts): screen-overlay sparse
// parsing/defaults, per-state visibility, and state-mesh path resolution. Run: npx tsx test/stateviz.test.ts

import { resolveScreenOverlay, overlayVisibleWhenOn, meshForState, allStateMeshes } from '../game/stateviz';

let assertions = 0;
function equal(actual: unknown, expected: unknown, label: string) {
  assertions++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${e}`);
    process.exit(1);
  }
}

// --- resolveScreenOverlay
equal(resolveScreenOverlay({}), null, 'no screenOverlay block resolves to null');
equal(resolveScreenOverlay({ screenOverlay: {} }), null, 'block without an image resolves to null');
equal(resolveScreenOverlay({ screenOverlay: { image: '   ' } }), null, 'blank image path resolves to null');
equal(
  resolveScreenOverlay({ screenOverlay: { image: 'textures/tv.gif' } }),
  { image: 'textures/tv.gif', widthMeters: 1, heightMeters: 0.6, offset: [0, 0, 0], yawDeg: 0, pitchDeg: 0, doubleSided: false, when: 'on' },
  'image-only overlay gets full defaults (fps stays undefined)',
);
equal(
  resolveScreenOverlay({ screenOverlay: { image: 'a.gif', widthMeters: 1.55, heightMeters: 0.82, offset: [0, 0.5, 0.03], yawDeg: 180, pitchDeg: -5, fps: 12, doubleSided: true, when: 'off' } }),
  { image: 'a.gif', widthMeters: 1.55, heightMeters: 0.82, offset: [0, 0.5, 0.03], yawDeg: 180, pitchDeg: -5, fps: 12, doubleSided: true, when: 'off' },
  'fully authored overlay passes through',
);
equal(
  resolveScreenOverlay({ screenOverlay: { image: 'a.gif', widthMeters: -2, heightMeters: 0, offset: [1, Number.NaN, 3] as [number, number, number], fps: -1 } }),
  { image: 'a.gif', widthMeters: 1, heightMeters: 0.6, offset: [0, 0, 0], yawDeg: 0, pitchDeg: 0, doubleSided: false, when: 'on' },
  'non-positive sizes/fps and non-finite offsets fall back to defaults',
);

// --- overlayVisibleWhenOn
equal(overlayVisibleWhenOn({ when: 'on' }, true), true, "when:'on' shows while ON");
equal(overlayVisibleWhenOn({ when: 'on' }, false), false, "when:'on' hides while OFF");
equal(overlayVisibleWhenOn({ when: 'off' }, false), true, "when:'off' shows while OFF");
equal(overlayVisibleWhenOn({ when: 'off' }, true), false, "when:'off' hides while ON");

// --- meshForState / allStateMeshes
const fridge = { mesh: 'models/fridge.glb', stateMeshes: { on: 'models/fridge_open.glb' } };
equal(meshForState(fridge, true), 'models/fridge_open.glb', 'ON variant wins while ON');
equal(meshForState(fridge, false), 'models/fridge.glb', 'state without a variant keeps the base mesh');
equal(meshForState({ mesh: 'models/tv.glb' }, true), 'models/tv.glb', 'no stateMeshes → always the base mesh');
equal(meshForState({ mesh: 'models/x.glb', stateMeshes: { on: '   ' } }, true), 'models/x.glb', 'blank variant path is ignored');
equal(allStateMeshes(fridge), ['models/fridge.glb', 'models/fridge_open.glb'], 'all paths, base first');
equal(allStateMeshes({ mesh: 'models/tv.glb' }), ['models/tv.glb'], 'single-mesh asset lists only the base');
equal(
  allStateMeshes({ mesh: 'models/a.glb', stateMeshes: { on: 'models/a.glb', off: 'models/b.glb' } }),
  ['models/a.glb', 'models/b.glb'],
  'duplicate variant paths are deduplicated',
);

console.log(`stateviz: ${assertions} assertions passed`);
