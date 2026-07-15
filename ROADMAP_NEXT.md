# Roadmap — designer batch 2026-07-15 (recorded verbatim, build later)

Fixes/features requested by the designer, in their priority order ("things to fix before going forward with the roadmap"). Each item = one future slice; lock design details into PROJECT_CONTEXT.md §7-style sections as each is picked up. Conventions: PROJECT_CONTEXT.md §5 (agents read that + this).

## 1. Sit/lie alignment on furniture (BUG, screenshots on record) — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.8 as-built
Character lies/sits completely OUTSIDE the asset (bed: lies across/beyond it; sofa/chair: sits on the floor beside it). Fix via designer-editable **per-asset use-position offset** in the Asset Editor (e.g. `AssetDef.usePose: { offset: [x,z], yOffset?, facingDeg? }` per pose or per interaction) — designer wants to set position/location in the Asset Editor. Likely root cause: sit/lie perch uses instance pivot + tuning perch heights, ignores real mesh geometry of new Fab-style GLBs. Marker sit/lie height limit (§7.7) relates.

Actual root cause turned out to be simpler than the pivot-math guess above: `sim.ts`'s `applyPose` compared `action.animation` against the exact strings `'sit'`/`'lie'`, but shipped actions use clip names like `"sit_idle"`/`"lie_sleep"` — the comparison never matched, so the perch-snap silently never ran and the sim was left standing at its walk-up approach point (outside the footprint). Fixed via prefix matching + `perch` defaulting to the target itself (not just seat-aware resolved seats), plus the requested `AssetDef.usePose?: { sit?, lie? }` schema (sparse offset/y/facingDeg) with sensible footprint-center + tuning-height + long-axis-facing defaults when absent. Shipped `y` overrides for sofa/armchair/dining_chair/bed. See PROJECT_CONTEXT.md §7.8 for full details.

## 2. Sit-on-ground fallback for Watch TV — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.10 as-built
No seat within N meters of the TV (tunable, ~5m default, `tuning.interaction.seatSearchRadius` or similar) → sim sits on the ground where it stands (needs a dedicated `sit_ground` animation state; designer will map a clip in the Animation Mapper).

Implemented: `game/sim.ts`'s `findSeatFor` rejects candidate seats beyond `tuning.interaction.seatSearchRadius` (new, default 5) from the target; `ActiveAction.groundSit` flags the fallback (no eligible seat, or a resolved seat that's unreachable) so `applyPose` leaves the sim at its walked-to spot at ground height instead of snapping onto the target itself, and `game/main.ts`'s new `animStateFor()` helper plays the dedicated `'sit_ground'` state instead of the action's own `animation`. `sit_ground` added to the Animation Mapper's core-states list so it's listed even though no action references it directly. See §7.10 for full details.

## 3. Camera rotation — ✅ DONE 2026-07-15
Orbit/rotate camera — desktop (mouse, e.g. right-drag or modifier+drag) AND mobile (two-finger twist). Extends game/camera.ts TouchCamera (currently pan+pinch only).

Implemented in `game/camera.ts`: right-mouse drag (button 2) rotates yaw (`rotateSpeedDegPerPx`), two-finger twist (angle delta between touches) rotates yaw on mobile and coexists with pinch-zoom in the same gesture (independent distance vs. angle measurements each pointermove) — a `twistDeadzoneDeg` dead zone drops small angle jitter so pinching alone never spins the camera, then `twistSpeed` scales the rest. New tunables live in `tuning.json`'s `camera` block (`rotateSpeedDegPerPx`, `twistDeadzoneDeg`, `twistSpeed`, all optional with in-code fallbacks so old fixtures/tests stay valid) and surface automatically in the schema-driven Tuning Editor. `game/input.ts`'s tap detector now ignores non-left-button pointerdowns so a right-click doesn't also fire a move-order tap. Pan already computed its right/forward axes from `yawDeg`, so screen-relative pan-after-rotate came for free — verified by `test/camera.test.ts` (pure `twoTouchAngleDeg`/`shortestAngleDeltaDeg` math + a `TouchCamera` instance check that an identical screen-space drag rotates ~90° in world space after a 90° yaw rotate, same magnitude). Canvas `contextmenu` is suppressed so right-drag doesn't pop the browser menu. Not manually verified: real touch twist and real right-mouse drag in a live browser (headless test env has no pointer-gesture simulation) — logic verified by the pure math + type gate + full suite green.

## 4. Rename "accident" category → "transient" assets — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.3 as-built
Broaden concept: accidents, food, plates, carried objects the sim puts down anywhere. Rename category + all references (assets.json, buymode exclusion, accidents.ts docs, Asset Editor). Transient = runtime-spawned, not designer-placed, not buyable. Sim carrying/transporting objects is part of this vision (carry system = its own future slice).

## 5. Cooking duration by skill — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.11 as-built
Actions can have a **duration** driven by skill (tunable per interaction — e.g. what dish is cooked): `ActionDef.duration?: { base, skillVar, atSkillMax }`-style. Cooking finishes after that time (currently actions run until needs full/cancel). Interaction Editor fields.

Implemented as `ActionDef.duration?: { baseSeconds, skillVar?, atMaxSeconds? }` (new pure `game/duration.ts`, wired into `game/main.ts`'s `onActionStart`/render-loop/`onActionStop`, tracked outside `SimAgent` so sim.ts stays skill-agnostic). Shipped on `cook`: base 60s → 20s at max cooking skill, sim-time seconds (same clock as needs decay/gain, decoupled from the day/night clock) — also gives `cook` (whose `primaryNeed` is `null`) its first natural auto-stop. Interaction Editor gained a sparse Duration card (base/skill-dropdown/at-max). See §7.11 for full details.

## 6. Fire spreading + destruction — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.12 as-built
Unextinguished fire after T seconds (tunable) DESTROYS the burning object → leaves "pile of ash" (transient asset). Nearby objects within radius: per-asset **combustibility** setting = % chance to catch fire when in radius + time for fire to spread to it. Fields on AssetDef (combustibility %, ignition delay), fire behavior in accidents/transients module, ash asset shipped.

Implemented in `game/accidents.ts`: fire instances track `bornAt` (a new monotonic `simClockSeconds` clock in `game/main.ts`, immune to the day/night clock's midnight wrap); `AccidentsController.tick(now)` (called once per render frame) destroys any fire past `tuning.fire.burnSeconds` — reusing the buy-mode overlay's designer-object-removal mechanism (`game/buymode.ts`'s new `destroyed` override + `destroyDesigner`/`attemptDestroy`/`destroyInstance`, wired via an injected callback to avoid a circular import) — and replaces it with an `ash` transient at the same spot; the burned baseKey is permanently blacklisted (`AccidentRegistry.destroyedBase`) so it can never re-ignite. Spread: `AssetDef.combustibility?: { chancePercent, delaySeconds }` on sofa/armchair/bed/bookshelf/counter; each live fire scans nearby combustible objects and gives each ONE roll (tracked per fire in `AccidentRegistry.spreadRolled`) once its own `delaySeconds` has elapsed. `tuning.fire: { burnSeconds: 30, spreadRadius: 2 }`; `ash`/`sweep` shipped in assets.json/interactions.json. See §7.12 for full details.

## 7. Sound effects + music placeholders — DONE 2026-07-15 (see PROJECT_CONTEXT §7.13; TV-light = stretch, not done)
Audio system, data-driven: sounds for ACTIONS, EVENTS, ASSETS (e.g. TV ON = noise; shower = noise), music per UI context (buy menu music, per-map music(s); later main menu + loading screen). Placeholder files fine. (TV should also emit LIGHT — designer unsure how; treat as stretch/separate.) Suggest `sound` fields on assets/actions + `tuning.audio` + a small game/audio.ts; drop-in files under public/sounds/.

## 8. Buy mode: floor-only placement (BUG-ish) — DONE 2026-07-15
Placement validity must ALSO require every footprint cell to be on a floor rect — currently assets can be placed outside the apartment. Implemented in `game/buymode.ts`: `footprintOnFloor()` discretizes the footprint rect into nav-grid cells (same `gridSize`/cell-center convention as `nav.ts`'s `bakeNavGrid`) and requires every cell center to fall inside some `MapData.floors[].polygon` (point-in-polygon, mirroring nav.ts's own walkability test); `isValidPlacement` now rejects any placement failing that check, on top of the existing bounds/wall/overlap tests. Rotation's width/depth swap (via the existing `footprintRect`) is honored for free. Covered by new tests in `test/buymode.test.ts`.

## 9. Windows + exterior/suite door — DONE 2026-07-15, see PROJECT_CONTEXT.md §7.14 as-built
New map/wall elements: **windows**; and an **exterior door** asset type — does NOT open/close like interior doors; instead carries interactions (set later: e.g. "go to work", "empty garbage" — see item 10). Map Editor support for windows + marking a door as exterior.

Implemented: `MapData.windows?` (new pure module `game/windows.ts`, purely visual pane stand-in — walls stay unbroken, zero nav effect, unlike a door's real gap). `AssetDef.door.exterior?: boolean` — `game/doors.ts`'s `doorShouldBeOpenExt` forces an exterior door permanently closed (skips the open/close tick), and its hinge pivot carries `userData.assetId`/`interactions` so it surfaces in the tap menu via the SAME generic raycast-to-userData mechanism every other asset uses (zero `main.ts` changes needed). Shipped `window_basic` (category `window`) + `door_exterior` (placeholder `leave_for_work` interaction) + 3 windows and 1 exterior door on `condo.json`'s outer walls. Map Editor Windows mode mirrors Doors mode exactly (place/drag/R-flip/delete + inspector); Asset Editor's Door card gained an exterior checkbox. See §7.14 for full details.

## 10. Garbage can + autonomous tidying — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.15 as-built
Garbage can asset with FULL state (capacity). Emptying garbage = an exterior-door interaction (item 9). Sim autonomy: if garbage not full and within radius (tunable) and sim's cleanliness PERSONALITY parameter high enough (introduces **personality parameters** — new stat family), sim puts waste in it by itself; if too far/full, sim drops detritus/dirty dishes (transient assets) on the ground — player taps them to force cleanup, or empties garbage first.

Implemented: new static `personality` stat family (`stats.json`, ships `cleanliness`) with a Tuning Editor section mirroring §2c's needs/skills add/remove. `AssetDef.garbage?: { capacity }` shipped on a new `garbage_can` asset; runtime fill state lives in a new pure `GarbageRegistry` (`game/garbage.ts`), keyed per placed instance. `ActionDef.producesWaste?: string` shipped on `eat` → `dirty_dishes` (new transient asset). Decision flow (`game/garbage.ts`'s `decideWasteHandling`, pure/tested): nearest non-full can within `tuning.garbage.autoTidyRadius` AND sim cleanliness >= `tuning.garbage.cleanlinessThreshold` → auto-tidy (instant deposit, no transient); else → drop the transient via `AccidentsController.spawnTransient` (new method, reuses the accidents-registry spawn machinery). `clean_up` action (player taps the dropped transient) refuses via a HUD toast if every can is full/none exist; on completion deposits into the nearest non-full can. `empty_garbage` shipped on `door_exterior` resets every can to 0. Both "walk to the can"/"carry garbage out" legs are documented simplifications (instant/teleport-free), per the brief's own escape hatch. Full details, including what's NOT wired (no HUD for personality, no real walk-then-deposit chain) in PROJECT_CONTEXT.md §7.15.

## Notes
- Item 4 (rename) should land BEFORE 6/10 (they build on transients).
- Item 1 is the top user-facing bug; 8 is quick.
- Personality parameters (item 10) = new designer-editable stat family → Tuning Editor extension like needs/skills.

---

# Batch 2 — designer requests 2026-07-15 (evening)

## B2-1. Interaction conditions — ✅ DONE 2026-07-15, see PROJECT_CONTEXT.md §7.16 as-built
Actions get availability CONDITIONS (reuse quest condition evaluator/namespace from game/quests.ts — vars.job etc.): `ActionDef.conditions?: Condition`. Unmet → hidden from tap menu + skipped by autonomy. Ship: `leave_for_work` requires `vars.job neq null` (job system later). Interaction Editor: condition builder (reuse Quest Editor's dropdown-driven builder pattern).

## B2-2. BUG: negative usePose offset rotates wrong — ✅ DONE 2026-07-15 (no math bug found)
Root cause: NOT a math bug — `game/facing.ts`'s `rotateLocalOffset` was already correct (re-derived by hand and cross-checked against a live `THREE.Object3D` parent/child transform: matches to float precision at rotDeg 0/90/180/270). The real gap was that the Asset Editor's "Sit / lie pose" hint text never stated the sign convention, so a designer typing a negative z had no way to predict which way it would move — any result looked "wrong" without a documented expectation to check it against. Fixed by stating the convention plainly in the hint ("+z = toward the asset's facing direction, −z = behind it") and locking it down with `test/usepose.test.ts`'s new B2-2 regression block (offset `[0,-0.5]` at all 4 instance rotations, asserted against `-0.5 * facingVector(worldFacingDeg)`). No code behavior changed.

## B2-3. Shower positioning + censor blur
Sim must stand INSIDE the shower (usePose needs a stand/use entry, not just sit/lie). Plus Sims-style censor blur/pixelation over the sim while showering / using WC (flag per action, e.g. `censor: true` on shower/use_toilet).

## B2-4. Bladder failure (pee self) — ✅ DONE 2026-07-15
Bladder hits 0 → sim pees itself: plays animation (new state, e.g. `pee`), spawns puddle transient at exact sim location, bladder relief minimal + tunable (default 30/100, tuning). See PROJECT_CONTEXT.md §7.17 as-built.

## B2-5. Panic + timed extinguish/clean with progress bar — DONE 2026-07-15 (panic state + tuning.fire.panicSeconds; duration modifiers [{var,atMin,atMax}] multiply onto base — extinguish 10s w/ intelligence+energy, clean_up/sweep/mop 6s w/ energy; world-anchored progress bar (game/progressbar.ts) above sim for ANY duration action incl. cook)
- Fire spawns → sims plays `panic` animation state (mappable in Animation Mapper).
- Extinguish = timed action: baseline 10s (tunable), FASTER with intelligence skill (designer will add the skill), SLOWER with low energy → duration system needs multi-variable modifiers (extend §7.11 duration schema). Progress bar ABOVE the sim (world-anchored, like marker) showing extinguish progress; flame disappears on completion; `extinguishing_fire` animation state.
- Cleaning/tidying (clean_up, sweep, mop): same treatment — progress bar, timed, auto-stop + transient removal on completion, `cleaning` animation state.

## B2-6. Every action has an animation — DONE 2026-07-15 (only gap was `leave_for_work`, filled with `stand_use`, same vocabulary as `empty_garbage`; Interaction Editor now shows an inline ⚠ hint when the animation field is blank; Animation Mapper's state list already auto-derives from `interactions.json` so it needed no change — confirmed live, `stand_use` lists all 8 actions incl. Leave for work)
Audit all shipped actions have an `animation` state; Interaction Editor warns when blank; Animation Mapper already lists action states (verify coverage).

---

# Batch 3 — designer requests 2026-07-15 (night)

## B3-1. BUG: fire should appear instantly — ✅ DONE 2026-07-15
When cooking sets the stove on fire: (a) evaluate whether the roll should fire DURING cooking (not only at action stop) so the fire appears while cooking; (b) the fire sprite/GIF does not show immediately when a fire starts (likely async decode → preload/cache the fire visual so it pops instantly). See PROJECT_CONTEXT.md §7.21 as-built.

## B3-2. BUG: pee → hygiene 0 — ✅ DONE 2026-07-15
Bladder failure must also set hygiene to 0. See PROJECT_CONTEXT.md §7.21 as-built.

## B3-3. BUG: second bladder failure never triggers — ✅ DONE 2026-07-15
Latch re-arms only when bladder rises STRICTLY ABOVE reliefAmount — but decay only goes down, so after relief to 30 it can never re-arm without a toilet trip. Re-arm as soon as the failure event completes. See PROJECT_CONTEXT.md §7.21 as-built.

## B3-4. BUG: interrupted clean/extinguish counts as completed — ✅ DONE 2026-07-15
Interrupting a duration action (e.g. via reload/hot-reload or new order) still despawns the fire/transient. clearedBy despawn must only fire on COMPLETED durations (distinguish completed vs cancelled in the stop path). See PROJECT_CONTEXT.md §7.21 as-built.

## B3-5. Carry cleaned items to garbage
clean_up on non-puddle transients (dirty_dishes, ash…): after the timed clean, the sim automatically walks to a non-full garbage can and deposits (fill+1) before the item despawns; puddles (mop) just vanish. If no can available: HUD toast refusal (existing behavior).

## B3-6. Visa status system (game core loop!)
`visaStatus` variable becomes a real system: start "visitor" with 15 in-game days (tunable). Statuses have expiry; failing to hold a valid status = GAME OVER screen. Upgrades via quests (quest rewards already setVar visaStatus) and/or applications (B3-7). Losable statuses (LMIA, temp worker) trigger a grace period (3 days, tunable) to find a new job/status. Status state machine data-driven (data/visas.json + editor or Tuning/Quest integration — design to lock in PROJECT_CONTEXT §7.20).

## B3-7. Smartphone + jobs
Phone = UI overlay (modifiable icon) with actions incl. "Search a job": refreshes a random job list every in-game hour (tunable). data/jobs.json: each job has requirements (visa status, skills), grants access to statuses (e.g. cook job → LMIA, time-limited/tunable), work hours, pay. Apply-for-status takes in-game time (pending period — must keep current status valid meanwhile). Permanent residence = application requiring skills, not quests. Lose job if skipped too many times (tunable). Jobs Editor tool (or JSON + editor section).

## B3-8. Going to work
Leave via suite door during job hours → sim disappears, game speed auto-set (5x tunable) until return; each job has its own hours; pay on completion (funds). leave_for_work conditions already gate on vars.job.
