# Roadmap — designer batch 2026-07-15 (recorded verbatim, build later)

Fixes/features requested by the designer, in their priority order ("things to fix before going forward with the roadmap"). Each item = one future slice; lock design details into PROJECT_CONTEXT.md §7-style sections as each is picked up. Conventions: PROJECT_CONTEXT.md §5 (agents read that + this).

## 1. Sit/lie alignment on furniture (BUG, screenshots on record) — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.8 as-built
Character lies/sits completely OUTSIDE the asset (bed: lies across/beyond it; sofa/chair: sits on the floor beside it). Fix via designer-editable **per-asset use-position offset** in the Asset Editor (e.g. `AssetDef.usePose: { offset: [x,z], yOffset?, facingDeg? }` per pose or per interaction) — designer wants to set position/location in the Asset Editor. Likely root cause: sit/lie perch uses instance pivot + tuning perch heights, ignores real mesh geometry of new Fab-style GLBs. Marker sit/lie height limit (§7.7) relates.

Actual root cause turned out to be simpler than the pivot-math guess above: `sim.ts`'s `applyPose` compared `action.animation` against the exact strings `'sit'`/`'lie'`, but shipped actions use clip names like `"sit_idle"`/`"lie_sleep"` — the comparison never matched, so the perch-snap silently never ran and the sim was left standing at its walk-up approach point (outside the footprint). Fixed via prefix matching + `perch` defaulting to the target itself (not just seat-aware resolved seats), plus the requested `AssetDef.usePose?: { sit?, lie? }` schema (sparse offset/y/facingDeg) with sensible footprint-center + tuning-height + long-axis-facing defaults when absent. Shipped `y` overrides for sofa/armchair/dining_chair/bed. See PROJECT_CONTEXT.md §7.8 for full details.

## 2. Sit-on-ground fallback for Watch TV
No seat within N meters of the TV (tunable, ~5m default, `tuning.interaction.seatSearchRadius` or similar) → sim sits on the ground where it stands (needs a dedicated `sit_ground` animation state; designer will map a clip in the Animation Mapper).

## 3. Camera rotation
Orbit/rotate camera — desktop (mouse, e.g. right-drag or modifier+drag) AND mobile (two-finger twist). Extends game/camera.ts TouchCamera (currently pan+pinch only).

## 4. Rename "accident" category → "transient" assets — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.3 as-built
Broaden concept: accidents, food, plates, carried objects the sim puts down anywhere. Rename category + all references (assets.json, buymode exclusion, accidents.ts docs, Asset Editor). Transient = runtime-spawned, not designer-placed, not buyable. Sim carrying/transporting objects is part of this vision (carry system = its own future slice).

## 5. Cooking duration by skill
Actions can have a **duration** driven by skill (tunable per interaction — e.g. what dish is cooked): `ActionDef.duration?: { base, skillVar, atSkillMax }`-style. Cooking finishes after that time (currently actions run until needs full/cancel). Interaction Editor fields.

## 6. Fire spreading + destruction
Unextinguished fire after T seconds (tunable) DESTROYS the burning object → leaves "pile of ash" (transient asset). Nearby objects within radius: per-asset **combustibility** setting = % chance to catch fire when in radius + time for fire to spread to it. Fields on AssetDef (combustibility %, ignition delay), fire behavior in accidents/transients module, ash asset shipped.

## 7. Sound effects + music placeholders
Audio system, data-driven: sounds for ACTIONS, EVENTS, ASSETS (e.g. TV ON = noise; shower = noise), music per UI context (buy menu music, per-map music(s); later main menu + loading screen). Placeholder files fine. (TV should also emit LIGHT — designer unsure how; treat as stretch/separate.) Suggest `sound` fields on assets/actions + `tuning.audio` + a small game/audio.ts; drop-in files under public/sounds/.

## 8. Buy mode: floor-only placement (BUG-ish) — DONE 2026-07-15
Placement validity must ALSO require every footprint cell to be on a floor rect — currently assets can be placed outside the apartment. Implemented in `game/buymode.ts`: `footprintOnFloor()` discretizes the footprint rect into nav-grid cells (same `gridSize`/cell-center convention as `nav.ts`'s `bakeNavGrid`) and requires every cell center to fall inside some `MapData.floors[].polygon` (point-in-polygon, mirroring nav.ts's own walkability test); `isValidPlacement` now rejects any placement failing that check, on top of the existing bounds/wall/overlap tests. Rotation's width/depth swap (via the existing `footprintRect`) is honored for free. Covered by new tests in `test/buymode.test.ts`.

## 9. Windows + exterior/suite door
New map/wall elements: **windows**; and an **exterior door** asset type — does NOT open/close like interior doors; instead carries interactions (set later: e.g. "go to work", "empty garbage" — see item 10). Map Editor support for windows + marking a door as exterior.

## 10. Garbage can + autonomous tidying
Garbage can asset with FULL state (capacity). Emptying garbage = an exterior-door interaction (item 9). Sim autonomy: if garbage not full and within radius (tunable) and sim's cleanliness PERSONALITY parameter high enough (introduces **personality parameters** — new stat family), sim puts waste in it by itself; if too far/full, sim drops detritus/dirty dishes (transient assets) on the ground — player taps them to force cleanup, or empties garbage first.

## Notes
- Item 4 (rename) should land BEFORE 6/10 (they build on transients).
- Item 1 is the top user-facing bug; 8 is quick.
- Personality parameters (item 10) = new designer-editable stat family → Tuning Editor extension like needs/skills.
