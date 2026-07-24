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

## B3-5. Carry cleaned items to garbage — DONE 2026-07-15 night, see PROJECT_CONTEXT.md §7.15 B3-5 update
clean_up on non-puddle transients (dirty_dishes, ash…): after the timed clean, the sim automatically walks to a non-full garbage can and deposits (fill+1) before the item despawns; puddles (mop) just vanish. If no can available: HUD toast refusal (existing behavior).

Implemented: `game/main.ts`'s `onActionStop` routes the sim (bare `agent.goTo`, no new ActionDef) to `garbage.nearestNonFullCanPos(simPos)` when `clean_up`/`sweep` completes (`CARRY_TO_GARBAGE_ACTIONS` set); `carryState` tracks it, a render-loop check on arrival (`!agent.isMoving`) deposits (`depositAtNearestCan`, re-resolved) then despawns (`accidents.maybeCleanup`). No can reachable → HUD toast, transient untouched. Any other order (`cancelCarry`, wired into the ground-tap/action-menu/panic/bladder-failure/buy-mode-close paths) cancels the walk, leaving the transient dirty in place. Autonomy is suppressed for free via `agent.isBusy`/`isMoving`. No carried-item visual (documented skip). `mop`/puddles unaffected — still vanish in place instantly.

## B3-6. Visa status system (game core loop!) — ✅ DONE 2026-07-15 (V1 runtime + V4 Career Editor; see PROJECT_CONTEXT.md §7.20)
`visaStatus` is a real system: start "visitor" with 15 in-game days (tunable). Statuses have expiry; failing to hold a valid status = GAME OVER screen. Upgrades happen via quests (`grantVisa`; legacy `setVar` remains raw) and/or applications (B3-7). Losable statuses (LMIA, temp worker) trigger a grace period (3 days, tunable) to find a new job/status. The state machine is data-driven through `data/visas.json`, now fully authorable in `tools/career.html` including conditions and application timing.

## B3-7. Smartphone + jobs — ✅ DONE 2026-07-15 (V2 runtime + V4 Career Editor; see PROJECT_CONTEXT.md §7.20 as-built)
Phone = UI overlay (modifiable icon) with actions incl. "Search a job": refreshes a random job list every in-game hour (tunable). `data/jobs.json`: each job has requirements (visa status, skills), grants access to statuses (e.g. cook job → LMIA, time-limited/tunable), work hours, pay. Apply-for-status takes in-game time (pending period — must keep current status valid meanwhile). Permanent residence = application requiring skills, not quests. Lose job if skipped too many times (tunable). Jobs and their visa links are fully authorable in `tools/career.html`.

## B3-8. Going to work — DONE 2026-07-15 (V3, see PROJECT_CONTEXT §7.20 V3 as-built)
Leave via suite door during job hours → sim disappears, game speed auto-set (5x tunable) until return; each job has its own hours; pay on completion (funds). leave_for_work conditions already gate on vars.job.

---

# Batch 4 — 2026-07-16

## B4-1. Bills — ✅ DONE 2026-07-15 (see PROJECT_CONTEXT.md §7.22)

Implemented initially with serializable pure bill state, day-boundary arrival, phone Bills tab, individual/Pay all actions, and an unpaid-count badge. B5-2 F1 later replaced flat amounts with formulas; F2 replaced insufficient-funds refusal with negative balances plus overdue/repo/game-over consequences (PROJECT_CONTEXT §7.24).
Every N days (tunable, default 3): bills arrive (rent, phone, hydro — amounts tunable, data-driven list). Received + paid via the phone (new Bills tab/section). HUD notification when unpaid (toast + badge on the smartphone icon — placeholder badge, designer may supply an icon). Consequences of non-payment: later (record only).

## B4-2. Food as carried transients + action costs — ✅ DONE 2026-07-15 (see PROJECT_CONTEXT.md §7.23)

Implemented: pure carried/dropped/perishing food lifecycle; snack-on-Eat-start and meal-on-Cook-completion routing to the nearest seat with `sit_ground` fallback; completion-only hunger/waste and interrupt-at-sim drop behavior; sparse action costs with disabled labelled menu entries and QuestRunner start deduction; Interaction/Asset Editor fields and headless coverage.
- Eat from fridge: sim takes a snack (food transient) and carries it to a seat/table/wherever, eats there. Interrupt → food left at that spot, perishes after a few hours (tunable) → becomes garbage/vanishes.
- Cook at stove: on cook completion, sim takes the cooked dish (more fulfilling food transient) and eats it same way.
- Both eat/cook actions COST money (per-action cost field), shown in the action menu label before selecting (e.g. "Eat (§5)"); blocked with feedback if unaffordable.

---

# Batch 5 — 2026-07-16

## B5-1. Non-linear skill growth — ✅ DONE 2026-07-16
Skill gains currently ~linear. Make higher levels slower: gain scales down as the skill approaches its max (e.g. effectiveGain = baseGain * (1 - level/max)^curveExp, or a tunable curve). 90→100 much harder than 10→40. Tunable curve param(s) in tuning (global or per-skill). Keep data-driven; find where skill gains apply (game/stats.ts / duration / action gains).

Implemented at the single `SimStats.applyGains` chokepoint with pure/tested `scaleSkillGain`: positive deltas use the global hot-reloadable `tuning.skills.growthCurveExp` (default 1.5), exponent 0 preserves linear gains, max blocks gains, and negative deltas remain untouched.

## B5-2. Finance system + tool + credit score (BIG — ✅ FULLY DONE 2026-07-16; locked design/as-built in PROJECT_CONTEXT §7.24)
Finance Editor tool + formula-driven bills/rent, debt/negative-balance grace, repo-man asset seizure (message-only), game-over on unpayable debt, credit score (phone-checkable, gates jobs/rentals, higher score = longer debt tolerance but decays). See §7.24.

F1 shipped: formula constants and thresholds in `data/finance.json`, arrival-time rent/bill computation against floor tiles + live effective asset value, map property type, shared pure calculator, and Finance Editor with current-map live preview.

F2 done: negative bill payments + serializable overdue/debt timing, pure importance-ordered repo decisions, Buy Mode sold-removal/nav rebake, repo notice, and debt game over. F3 done: serializable tunable credit score/history, on-time/overdue/debt/repo changes, daily debt decay, score-scaled repo windows, phone Credit tab, job credit gates, and Career/Finance Editor authoring.

---

# Batch 6 — 2026-07-16 (16 items)

## B6-1. BUG: progress bar misaligned (fill vs background not visually aligned) — ✅ DONE 2026-07-16 (game/progressbar.ts: symmetric fillMargin inset on both axes, was flush left/right while inset top/bottom)
## B6-2. Job UX: current job excluded from search (or apply blocked); switching prompts "You already work as X, switch to Y?"; job description visible in smartphone while employed — ✅ DONE 2026-07-16
Jobs shows a current-job card (name/hours/pay/optional level/skips), omits it from search, and confirms before switching.
## B6-3. BUG: fridge eat — sim must walk ALL THE WAY to the fridge first, then carry food to seat — ✅ DONE 2026-07-16
Snack creation is explicitly keyed to the fridge use-spot arrival callback before the carry-to-seat leg.
## B6-4. Transient spawn placement: dirty dishes/puddles must not spawn under assets; spawn AMOUNT correlated to need(s)/attribute(s) (tunable mapping) — ✅ DONE 2026-07-16
Floor transients reject furniture/transient footprints with nearest-free fallback; `tuning.waste` adds a personality cleanliness chance for one extra item.
## B6-5. Happiness gauge + job levels/promotions: happiness = complex tunable formula (needs, job, credit score, money, visa status — editable in tools); jobs get levels (Dishwasher I/II/III + % bonus chance); promotion chance scales with happiness — ✅ DONE 2026-07-16
`data/happiness.json` drives the Finance Editor-authored weighted HUD gauge; serializable per-job levels set shift pay and roll completed-shift promotions using happiness and `tuning.work.promotionHappinessFactor`.
## B6-6. Map grid 0.5×0.5 tiles with 0.25 snap (map editor, nav, buymode) — ✅ DONE 2026-07-16
Shipped `map.snapStep` as a placement-only field (0.25 fallback), changed the condo/new-map tile size to 0.5 without rescaling any meter-space geometry, and kept nav/floor validation on `gridSize`; tests cover snap independence, all existing footprints, and real-condo bake timing.
## B6-7. Asset Editor 3D preview grid must match the map grid — ✅ DONE 2026-07-16
The preview GridHelper now derives exact square size from the fetched map's `gridSize` (0.5 fallback), so one preview square equals one map tile.
## B6-8. BUG: windows don't show in-game — ✅ DONE 2026-07-16
Restored the three shipped condo window entries lost from `condo.json`; procedural panes now use visible frame rails and render on both wall faces instead of inside opaque wall depth.
## B6-9. Wall-cut view option (cut walls at ~1m, Sims-style, player toggle, view-only) — ✅ DONE 2026-07-16
HUD `⌂ Cut` toggles ground-up wall/door visual scaling at auto-exposed `tuning.view.wallCutHeight` (1m default); windows hide in cut view, with nav/game state untouched and choice kept only in-page.
## B6-10. UI sound placeholders: click/move-order/action-select; quest events (new/done); notifications in general — ✅ DONE 2026-07-16
Eight tiny generated WAV cues are live through auto-exposed `tuning.audio` paths: successful move orders, action-menu picks, quest start/completion, generic toasts, skill-ups, and money up/down.
## B6-11. Contextual action menu around click location (Sims-style radial, screen-space so walls/assets never hide it; replaces bottom menu; screenshot ref on record) — ✅ DONE 2026-07-16
Canvas taps now carry CSS-pixel coordinates into a fixed HTML bubble menu: up to five options form a clamped radial ring, larger sets use a compact vertical arc, and safe-area-aware touch targets preserve costs/disabled state and Cancel.
## B6-12. Asset light emission + ON/OFF state: assets can generate light; Turn ON/OFF actions flip asset state driving light and/or sound (e.g. TV) — ✅ DONE 2026-07-16
Serializable stable per-instance state now drives sparse asset PointLights and stateful sound; contextual Turn On/Off actions keep normal walk-up flow, and Watch TV auto-powers the TV on.
## B6-13. Wall-mounted assets (stick to wall: wall lights, canvas) — ✅ DONE 2026-07-16
Buy Mode and Map Editor share a pure floor-side wall snap/validity rule; wall assets sit flush, face into the room, render at authored/default 1.5m height, and ship as wall_lamp + canvas.
## B6-14. Energy 0 → collapse animation then sleep on ground (short tunable duration) — ✅ DONE 2026-07-16
An armed survival event interrupts at zero energy, plays `collapse`, changes to ground `lie_sleep`, refills to the tuned value after the tuned sim-time sleep, then re-arms.
## B6-15. Hunger 0 → tunable countdown; if still starving → animation then GAME OVER — ✅ DONE 2026-07-16
Serializable starvation state warns at zero hunger, cancels after food recovery, or plays tuned `starve` collapse before the existing terminal overlay.
## B6-16. Skill-up + money feedback: sound + floating rising text above sim ("English: +1!"); same for money gained/spent (amount, up/down) — ✅ DONE 2026-07-16
Projected crisp HTML text rises above the sim for integer skill-level crossings and every authoritative funds delta, with tuned duration/rise/anchor and distinct sounds/colors.

---

# Batch 7 — 2026-07-16 (evening)

## B7-1. Asset tool viewer: grid at ground level + show IN-GAME size (footprint-fit + meshFit/scale/rotation applied), not raw GLB size
## B7-2. Cooked meal hunger fulfillment proportional to cooking skill
## B7-3. BUG: loading bar still misaligned (screenshot: fill sprite floats detached below the track) — ✅ DONE 2026-07-16 (root cause: fill anchor used world-X while Sprite geometry billboards in camera space; shared origin + camera-space center fixes isometric down-left drift)
## B7-4. BUG: sim STILL does not walk all the way to the fridge before snacking
## B7-5. Work window: ~2h (tunable) after startHour to leave for work, else shift missed (skip) — ✅ DONE 2026-07-16
`tuning.work.departureWindowHours` gates manual/door arrival, reminders name the deadline, and misses register exactly once when the window closes (including overnight shifts).
## B7-6. Autonomy: sim may leave for work by itself (happiness/energy-driven, tunable), even waking from sleep — ✅ DONE 2026-07-16
Deterministic inclusive happiness+energy thresholds auto-order the exterior-door action through the normal cancel path; recent player commands retain priority.
## B7-7. Loading screen: blocks until assets loaded (sim time frozen), customizable funny phrases in tools ("Going through customs"...), own music, customizable bar + background image — ✅ DONE 2026-07-16
Boot now seals and awaits a real started/settled asset tracker (fallbacks count as settled), freezes `sdt`, and presents boot-only `data/loading.json` through a dedicated Tuning Editor card with phrases, music/background paths, and bar styling.

---

# Batch 8 — 2026-07-16 (night): two big features

## B8-1. Behavior/autonomy editor (engine + tool)
Utility-based autonomy the designer can tune: decisions driven by personality attributes, current needs, skills; candidate scoring differentiates assets (nap on sofa vs sleep in bed — per-asset need generation matters). data/behavior.json rules/weights + condition gates (quest namespace incl. personality.*); new tools/behavior.html with condition builders + live candidate-score preview. Design locked PROJECT_CONTEXT §7.30. Slices: engine (E), tool (T).

**FULLY DONE (B8-1-E + B8-1-T, 2026-07-16):** optional hot-reloaded behavior data, pure weighted scorer/rules/threshold, Autonomy integration, and legacy absent-file fallback are shipped with headless coverage; Behavior Editor now provides weights, need priorities, rule/condition CRUD, real-scorer hypothetical-state ranking, whole-file save, nav, and jsdom coverage.

## B8-2. UI theme & layout editor (engine + tool)
Designer-editable UI: fonts, colors, shapes (radius/outline/shadow) of notifications/messages/buttons/panels, screen positions, accordion nesting of HUD groups. data/theme.json -> CSS variables + layout config consumed by game/ui.ts; new tools/theme.html with live preview. Design locked PROJECT_CONTEXT §7.31. Slices: engine (E), tool (T).

**FULLY DONE (B8-2-E + B8-2-T, 2026-07-16):** default legacy-look theme data, CSS-variable application, safe-area anchors/visibility, accordion grouping, and hot-reload are shipped; Theme Editor now provides fonts/colors/shapes, sparse component overrides, engine-known HUD layout and accordion CRUD, real-`applyTheme` mocked-HUD live preview, whole-file save, nav, and jsdom coverage.

---

# Batch 9 — 2026-07-16

## B9-1. Floor + wall textures: designer drops image files in public/textures/, picks per floor rect and per wall in the Map Editor; game renders them tiled (repeat per meter) with color fallback. Server lists /api/textures. Slices: engine (game render + schema), tool (Map Editor pickers + server listing).

**ENGINE DONE (2026-07-16, see PROJECT_CONTEXT §7.32):** `MapData.floors[].texture?`/`walls[].texture?` schema + `tuning.textures.metersPerTile` tunable; `game/textures.ts` pure repeat math (`resolveMetersPerTile`/`textureRepeat`/`polygonBounds`, headless-tested `test/textures.test.ts`); `world.ts` per-URL texture cache + per-surface clone, keep-stand-in color→texture swap with load-failure fallback, physical tiling (walls via BoxGeometry 0..1 UVs, floors via normalized ShapeGeometry UVs), hot-reload-safe, wall-cut still works.

**TOOL DONE (2026-07-16):** `GET /api/textures` in server.js flat-lists `public/textures/*.{png,jpg,jpeg,webp}` as `'textures/<file>'` paths (missing/empty dir → `[]`, read-only); Map Editor (`tools/map.html`) fetches it once at boot (`state.textures`, resilient `.catch(()=>[])`) and the Floors + Walls inspectors gain a shared `textureRow` picker ('(none)'=color material vs. a listed path) writing/deleting `floors[]`/`walls[].texture`, with a live preview swatch (`<img src="/"+path>`). Round-trips covered in `test/map-editor.test.mjs` (floor + wall). **B9-1 FULLY DONE.**

**Follow-up DONE (2026-07-16, see PROJECT_CONTEXT §7.32):** per-surface `textureScale?: number` on `floors[]`/`walls[]` (default 1, multiplies `metersPerTile` via `effectiveMetersPerTile`) threaded through `world.ts`'s floor/wall texture application; Map Editor's `textureRow` gained a sparse scale number input next to the dropdown (visible only with a texture selected); tests extended in `test/textures.test.ts` + `test/map-editor.test.mjs`.

**Follow-up DONE (2026-07-16, per-side wall textures, see PROJECT_CONTEXT §7.32):** `walls[].textureB?: string` (sparse, absent = both faces use `texture`); A/B is geometric not from/to-order-dependent — side A faces world +Z ("south") on a horizontal wall or +X ("east") on a vertical wall, side B is the opposite face (documented in `game/data.ts` + `world.ts` buildWorld()'s wall loop, which now builds a 6-entry BoxGeometry material array — faces 4/5 = local ±z = the two big faces — only when `textureB` is set). Map Editor Walls inspector: existing dropdown relabeled "Texture (side A / both)" + new sparse "Texture side B (optional)" dropdown/swatch with an orientation hint in its title. Tests: `test/map-editor.test.mjs` side-B round-trip; no new pure-math helper needed (material wiring only).

---

# Batch 10 — 2026-07-16

## B10-1. Wall TOPS always flat black — even when walls are visually cut, even with custom face textures — for an "architecture plan" vibe.

**DONE (2026-07-16, see PROJECT_CONTEXT §7.32):** every wall's top face (+y) now renders a shared unlit `THREE.MeshBasicMaterial` — no texture, no lighting shading — independent of `texture`/`textureB`. Color is the new tunable `tuning.view.wallTopColor` (default `#000000`, appears automatically in the Tuning Editor's view group). The wall-cut view only scales geometry, so the black top survives cutting with no extra work.

## B10-2. Easier sit/lie/use setup on assets: see the character posed on the asset, with the proper animation, directly in the Asset Editor's 3D preview (checkbox, off by default).

**DONE (2026-07-16, see PROJECT_CONTEXT §7.33):** Asset Editor preview card gained a view-only "Show character" checkbox (unchecked on every load) + pose selector (sit/lie always; use only when `usePose.use` exists). The rigged character loads through the game's own `loadRiggedCharacter`, is positioned by the real `usePoseFor` (virtual origin instance), and plays the clip resolved through the asset's interactions + `tuning.character.clipMap` via the real `AnimController` — editing usePose offset/y/facing updates the character live. Missing tuning.character disables the checkbox with an explanation; unmapped clips fall back to idle with a message.

## B10-3. BUG: sitting directly on the sofa/chair placed the sim on the floor beside it (Asset Editor preview was right, in-game was wrong; watch TV was right).

**DONE (2026-07-16):** `findSeatFor` excluded the target from its own seat search, so a seat-aware "Sit" on a `seatTarget` resolved no seat and fell into the sit-on-ground fallback at the walk-up spot. A `seatTarget` target is now its own seat; TV/fridge-style searches unchanged. Regression coverage in `test/seatground.test.ts`.

## B10-4. Follow-up: after sitting, the sim faced the bookshelf when reading a book.

**DONE (2026-07-16):** the post-perch "face the target" rotation (right for Watch TV) is now per-action: sparse `ActionDef.faceTarget?: boolean` (absent/true = rotate to the target, `false` = keep the seat's own usePose facing). `read_book` ships with `faceTarget: false`; Interaction Editor gained a sparse "face target after sitting" checkbox (untick for fetch-style actions like eat, if desired). New `tools/interaction-editor.test.mjs` jsdom suite covers the round-trip.

## B10-5. REGRESSION: seat-aware sitting placement disagrees with the Asset Editor preview

Designer report: Watch TV now sits the sim in mid-air at/inside the TV footprint instead of on the facing sofa; direct Sit on the sofa floats just beyond the TV-facing cushion edge, while the Asset Editor character preview shows the intended pose. Find and fix the actual seat-resolution and placement-coordinate causes without retuning designer data. The game must perch Watch TV on the sofa facing the TV, place direct Sit exactly at the sofa's authored `usePose`, and make preview/game transforms identical. Add headless regressions for both paths.

**Design reading:** trace `findSeatFor`, ordered-action leg/seat state, `applyPose`, arrival facing, world instance transforms, and the preview's virtual instance. Share one placement semantic rather than compensating with asset offsets; preserve `data/*.json` unchanged.

**DONE 2026-07-16:** `findSeatFor` was correct; `orderAction` discarded its sofa when pivot routing chose an unreachable cell inside/behind the nav-blocking footprint, then ground-sat at the TV. Seats now route to their reachable front approach before snapping to `usePose`. Direct Sit no longer post-rotates toward its own target pivot, so its complete transform matches the Asset Editor's shared `usePoseFor` preview. Headless regression covers both paths with a blocked-pivot/rotated-offset fixture; designer data untouched. See PROJECT_CONTEXT §7.34 B10-5.

## B10-6. Read book fetches from the bookshelf before sitting

Designer intent: Read book must walk to the bookshelf first, then continue to a seat and read, using the fridge-snack two-leg precedent; Practice English should follow when it uses the same bookshelf source.

**Design reading:** generalize first-leg seat deferral into a sparse action field shared with the existing food decision, orchestrate the second leg only after source arrival, and expose it in the Interaction Editor.

**DONE 2026-07-16:** sparse `ActionDef.fetchBeforeSeat` now defers generic seat routing until source arrival; `read_book` and bookshelf-backed `practice_english` both opt in. Player and autonomy first legs reuse `firstLegSeatAware`; source arrival starts one flag-cleared seat leg, so action effects begin only at the seat. Pure and editor coverage added. See PROJECT_CONTEXT §7.34 B10-6.

## B10-7. Practice English keeps the seat's authored facing

Designer report: Practice English rotated the seated sim toward its bookshelf target, overriding the seat `usePose` facing.

**DONE 2026-07-16:** root cause was the missing sparse B10-4 opt-out. `practice_english` now has `faceTarget: false`, matching `read_book`; existing engine/editor semantics were already correct. See PROJECT_CONTEXT §7.34 B10-7.

## B10-8. Seated actions no longer break later movement/actions

Designer report: after reading/studying, many floor clicks and subsequent actions failed; investigate restoration from furniture-blocked perch positions.

**DONE 2026-07-16:** teardown did restore `savedPose`, but final approach used the arrival-radius position rather than the exact walkable endpoint, so it could save/restore inside the sofa footprint. Final route arrival now snaps to its known-walkable cell center before perching. A blocking-sofa regression proves stop restores walkable ground and a far `goTo` succeeds/completes. See PROJECT_CONTEXT §7.34 B10-8.

## B10-9. Not all transient assets should block navigation — per-asset boolean (puddle walkable, fire blocking).

**DONE (2026-07-16):** sparse `AssetDef.blocksNav?: boolean` — absent = blocks (furniture/fire, unchanged), `false` = footprint stays walkable in the nav bake. `water_puddle` + `pee_puddle` ship with `false`. Asset Editor: "blocks navigation" checkbox (checked by default) under footprint. Runtime-spawned accidents were never nav-baked (registry-only), so this affects map-placed instances only.

## B10-10. BUG: designer-placed puddles never disappear after mopping (runtime-spawned ones did).

**DONE (2026-07-16):** a COMPLETED clearing action now also removes a map-placed instance of a clearedBy-matching asset: main.ts's completed-only onActionStop branch falls back from the AccidentRegistry despawn to buy-mode's destroyInstance runtime override (+ nav rebake if the asset blocked). Interrupted/cancelled mopping leaves the puddle (side_effect_rule); the map file is never written, so a full data rebuild legitimately restores authored puddles. Pure helper `shouldRemovePlacedOnCleanup` covered in test/accidents.test.ts.

## B10-11. Environment must be a pure aggregate of the assets currently present — a cleaned puddle's impact disappears; no drift over time.

**DONE (2026-07-16):** `environmentScore()` (game/main.ts) now sums buy-mode's runtime-aware `effectivePlacedObjectsList()` (destroyed instances excluded, purchases included) instead of the raw authored map list, plus live registry accidents as before — extracted as pure `computeEnvironmentScore` in game/stats.ts. `applyEnvironment()` additionally fires on fire destruction, completed-mop removal (B10-10), repo seizure, buy confirm, and sell. Covered in test/stats.test.ts (destroyed excluded / purchase included / accident included / present puddle still counts).

## B10-12. REGRESSION: precise standing action approach without breaking post-seat navigation

Designer intent: generic standing actions such as cooking must run at `useSpotFor`'s exact footprint-edge approach point, while the saved/restored pre-perch pose and later movement must remain walkable as guaranteed by B10-8.

**Design reading:** decouple the live final standing position from the walkable pose saved for perch restoration. Preserve exact `useSpotFor` placement for the action, but store a safe walkable route endpoint for restoration; cover a stove-like standing action and successful post-action `goTo`.

**DONE 2026-07-16:** action routing now keeps B10-8's walkable cell-center endpoint as the safe restore pose while moving the live action to the exact `useSpotFor` point when its cell is walkable. Generic standing actions remain there; perched/authored-use actions restore to the safe center. Stove-like exact-position and post-action movement regressions pass in `test/seatground.test.ts`.

## B10-13. Asset Editor always previews the default or authored use pose

Designer intent: always offer `use` in the character preview. With no `usePose.use`, show the real computed default standing spot and label it clearly; after any `usePose.use` field is authored, switch to the existing authored `usePoseFor` transform.

**Design reading:** import and use the real `useSpotFor` in the module preview, keep default-vs-authored selection in a pure inline helper for jsdom coverage, and make no data/schema changes.

**DONE 2026-07-16:** `use` is always offered. Sparse assets preview the real `useSpotFor` computed standing spot and label it "computed default"; any authored `usePose.use` field switches to `usePoseFor` and an "authored" label. Pure helper coverage added; no data/schema changes.

---

# Batch 11 — 2026-07-16: apartments / rentals / doors-in-walls / façades / exteriors

## B11-1. PLANNED (no code yet): Kijiji rental tab, door-in-wall rework, frame/pane split, curtain wall + balcony provisions, simplified 3D exteriors, move-in map switch.

**Plan locked in docs/roadmaps/ROADMAP_APT.md** (slices R1-R5 / D1-D4 with per-slice agent assignments: Codex for R4 map switch + D1/D2 door geometry, Claude Opus/Sonnet for the rest, designer authoring pass R5). Read that file before building any slice; open decisions listed in its §6.

# Batch 12 — 2026-07-16: social system (NPCs, relationships, visits, phone contact)

## B12-1. PLANNED (no code yet): NPC Sims with personality/compatibility, Sims-style relationship levels, contextual sim-to-sim interactions, invite home / ask to leave, text/call from phone, visit-their-place away flow, dedicated Social Editor tool page.

**Plan locked in docs/roadmaps/ROADMAP_SOCIAL.md** (slices S1-S7; Codex for NPC runtime + sim-to-sim choreography, Claude Opus/Sonnet elsewhere; builds ONLY after docs/roadmaps/ROADMAP_APT.md ships). docs/roadmaps/ROADMAP_APT.md §6 decisions were approved by the designer and marked RESOLVED.

## B10-14. Trash can fill indicator: small in-world loading bar showing empty -> full status per can.

**DONE (2026-07-16):** camera-space sprite bar over each live garbage can (progressbar.ts geometry helpers reused, scene-parented per the sprite anchoring lesson), synced on deposits/tidy/empty/buy-sell/world rebuild. Tunables: tuning.garbage.fillBar {widthMeters, heightMeters, yOffsetMeters, fillColor, trackColor, showWhenEmpty:false} — Tuning Editor gained one-level nested sub-group rendering to expose it. Pure ratio/visibility/geometry helpers covered in test/garbage.test.ts.

## B10-15. Asset Editor: offset the mesh on all 3 axes (was single-axis).

**DONE (2026-07-16):** meshFit gains sparse xOffset/zOffset alongside the existing yOffset; applyMeshFit nudges position on each set axis, composing with scale/yaw, identically in-game and in the Asset Editor preview. Three sparse inputs on the mesh-fit card. test/meshfit.test.mjs extended (tsx-only quirk unchanged).

## B10-16. Per-asset need multipliers: each asset scales selected needs' action gains (several needs, add/remove, negatives allowed).

**DONE (2026-07-16):** sparse AssetDef.needMultipliers {needId: number}. ONE pure helper (stats.ts effectiveNeedGain) feeds BOTH the sim gain tick (applyGains) and autonomy scoring (behavior.ts scoreCandidate), so a luxury sofa genuinely outranks a bad one and negative multipliers drain. Seat-aware actions credit the multiplier of the seat actually perched on (active.seat ?? target — documented in main.ts). Asset Editor "Need multipliers" card (need dropdown + value, add/remove, sparse). Behavior Editor live preview reflects it automatically (real scorer). Tests: stats/behavior/meshfit/asset-editor suites.

## B10-17. BUG: uncleanable "dirty dish" after a snack, self-vanishing after ~15s.

**DONE (2026-07-16):** the object was an ABANDONED CARRIED-FOOD transient (snack/meal left by an interrupted eat/carry), not dirty_dishes: it had interactions:[] (nothing for the radial menu) and perished on the food clock (perishHours x 7.5 real seconds at current time scale). dropActiveFood() now routes abandoned food through the normal waste pipeline (auto-tidy or clearable dirty_dishes that persists until a COMPLETED clean_up) and discards it from the FoodRegistry so the perish tick can never silently remove it.

## B10-18. Meal tiers: what you cook determines hunger fulfillment (light $12 < large $25), still scaled by cooking skill.

**DONE (2026-07-16):** sparse ActionDef.food {hungerGain, perishHours} overrides the source asset's food block (resolveFoodConfig); B7-2 cooking-skill scaling applies on top of either base. Food spawn mapping generalized to action FAMILIES (cook/cook_*, eat/eat_*) so new cook actions need zero code. Interaction Editor gained a sparse "Food override" card. Designer authors cook_light_meal/cook_large_meal in the tool.

## B10-19. Garbage fill bar hides when occluded (wall/asset between camera and can); sim bars unaffected.

**DONE (2026-07-17):** camera->bar-anchor raycast vs world (own can excluded), pure fillBarOccluded decision, throttled to camera-change + 0.25s. Tunable tuning.garbage.fillBar.hideWhenOccluded (default true).

## B10-20. Skill progress bar: second bar above the action bar, own color, "<Skill>:" label, progress toward the NEXT skill point only.

**DONE (2026-07-17):** createSkillBarInstance (progressbar.ts geometry reuse, world-Y gap so bars never overlap), gold default, canvas-texture label, shown when the action has skillGains (primary = largest gain). Pure skillPointProgress = fractional part toward next integer point (growthCurveExp tapers rate, not thresholds), 0 exactly on a point, hidden at max. Tunables tuning.feedback.skillBar {fillColor,trackColor,heightMeters,widthMeters,gapMeters}.

## B10-21. Put-trash-out visits the fullest can first, then the exterior door; orderable directly on a can.

**DONE (2026-07-17):** pure chooseFullestCan (highest fill, tie nearest, empties ignored); startTrashOut walks to the ordered-on can (if any fill) or the fullest, then orders the real empty_garbage on the exterior door (completion semantics unchanged); cancels clear the leg like the carry precedent. DESIGNER: add interaction id 'empty_garbage' to the garbage_can asset in the Asset Editor to order it on the can; map needs an exterior door.

## B10-22. BUG: job-gated quest conditions never validated; BUG: rented home persisted across refresh (not wanted before the save system).

**DONE (2026-07-17):** (1) simstate declares vars.job as boolean so quests author "job eq true", but hiring writes the employer-id STRING (work system needs it) — strict equality never matched. Evaluator now treats a boolean literal on eq/neq as a truthiness test; vars.income is also written on hire (payPerShift), updated on promotion, reset with vars.job on job loss. (2) R4's runtime PUT of simstate.homeMap removed — move-in stays in-memory only until the save system (boot still reads resolveHomeMapId for forward-compat); leftover homeMap="Apt1" our old code wrote in simstate.json reset to null. ROADMAP_APT 6.1 decision superseded: NO persistence until save system.

## B10-23. Mesh fitting, sold-asset ghosts, door hole height, numeric bar levels (four designer items).

**DONE (2026-07-17):** (1) applyMeshFit re-anchors (recenter XZ + reground Y) AFTER scale/yaw and BEFORE offsets — GLBs with off-center origins no longer drift when scaled/rotated, and offsets are a clean nudge within the footprint, identical in-game and in the Asset Editor preview, which now draws a translucent footprint rectangle at y=0. (2) Sold/destroyed designer-placed objects are DETACHED from the world graph (not just hidden): no raycast/highlight/contextmenu, no seat candidacy; survives hot-reload reattach. (3) Aperture default height decoupled from meshFit y-scale (a per-mesh authoring correction, not a doorway-size statement) — a 2.1m door in a 2.5m wall shows the lintel again; explicit door.apertureHeight still wins. (4) HUD needs/skills bars show 'value/max' inside the bar (needs /100, skills per SkillDef.max), theme-aware; in-world skill bar label gains the fraction. New test/hud-bars.test.ts; meshfit/wallaperture/buymode suites extended.

## B10-24. Skill caption clipping, entrance-door lintel, hydro usage billing.

**DONE (2026-07-17):** (1) in-world skill label canvas now measures text and sizes canvas+sprite to fit with padding (pure skillLabelCanvasSize/skillLabelWorldSize helpers) — no more clipped 'English 15/100'. (2) The entrance door is GAP-ENCODED (sits between two split wall segments — no wall above by construction); new pure gapDoorLintel() derives a header box over the gap from apertureSizeFor height up to the wall top, rendered with plain wall material + black top, hidden under wall-cut like on-wall lintels — both door forms now visually identical. (3) Hydro usage: sparse AssetDef.power {ratePerHour} (Asset Editor 'Power (Hydro)' field; asset needs an ON/OFF state); pure game/hydro.ts HydroMeter accrues ON-hours x rate on sim time (serialize/restore exposed), added ON TOP of the Hydro bill's formula base each cycle then reset; map switch drops accrued usage; Finance Editor labels Hydro 'base — usage added at runtime'. Suites: hydro (new), progressbar/wallaperture/bills extended.

## B10-25. BUG: in-world skill bar always captioned 'English N/100' regardless of the skill being learned.

**DONE (2026-07-18):** root cause was three.js r166 CanvasTexture IMMUTABLE GPU storage (texStorage2D allocates at first-seen canvas size; later needsUpdate uploads via texSubImage2D and silently cannot follow a canvas RESIZE) — the B10-24 fit-to-text resize froze the first label ever drawn. redrawLabel now disposes and recreates the CanvasTexture whenever the canvas dimensions change (pure skillLabelTextureNeedsRecreate helper, tested); same-size redraws keep the cheap needsUpdate path. Designer: run two different skill actions back-to-back to visually confirm.

## B13-1. Theme/UI rework: richer Theme Editor (per-element preview, font/image import, drag layout), collapsible icon-headed needs/skills, contextual-menu button styling.

**Designer request (verbatim, 2026-07-18):** "I want to rework the interface more easily: I want more options in the theme tool, including the fact that I can see each element separately as well (e.g. buttons etc), I can import properly fonts and images / icons and I can move around the elements on the interface preview. Also the needs and skills will be now collapse by default (can be changed) and instead of having 'NEEDS' and 'SKILLS' written, it will be an icon, I should have the choice to add text if I want to. Regarding contextual menu, I want to be able to change the buttons more easily: margins, padding, shape... including radius from the center."

Design reading: (1) Theme Editor gains a per-element gallery preview (each themable component — buttons, cards, bars, tabs, phone, radial menu — shown in isolation with its overrides editable next to it) alongside the existing mocked-HUD preview. (2) Proper asset import: fonts (public/fonts, @font-face registration from theme.json font entries) and images/icons (public/, Windows-path normalization precedent), with server listing endpoints like /api/textures if needed. (3) The mocked-HUD preview becomes drag-arrangeable: dragging an element writes its theme.json layout anchor/offset. (4) Needs/skills HUD accordions: collapsed by default via theme.json (designer-changeable), header = icon (theme-selectable image) with optional text label toggle instead of hardcoded "NEEDS"/"SKILLS". (5) Radial contextual menu styling in theme.json: per-button margins, padding, shape (radius/corner), and distance ("radius from the center") editable in the Theme Editor.

**DONE (2026-07-18):** theme.json gains fonts.faces[] (@font-face registered at runtime and in tools), components.{actionMenu(margin/padding/width/height/centerRadiusPx), card, bar, phoneShell, phoneTab, accordionHeader} sparse styling (absent keys reproduce the prior look exactly), per-accordion icon+showText; needs/skills split into separate accordions, collapsed by default, icon-only headers (public/icons/needs.svg+skills.svg placeholders, ARIA labels kept). Theme Editor: component-key-driven element gallery with isolated live specimens + adjacent overrides, font/icon dropdowns fed by NEW server endpoints GET /api/fonts + /api/icons (RESTART npm run dev to activate), Windows-path normalization, drag-to-arrange HUD preview writing anchor/offsetX/offsetY (nearest-anchor drop). Radial menu geometry fully runtime-themed incl. radius from center. DESIGNER: restart the dev server once; drop fonts in public/fonts, icons in public/icons. PROJECT_CONTEXT §7.49.

## B13-2. BUG: TV only turns on for Watch CBC News, not the other channels.

**DONE (2026-07-18):** root cause — assetstate.ts powerStateForAction hardcoded the exact action id `watch_tv` (which happens to be CBC News's id from B6-12, before the other channels were authored); `watch_tv_radio_canada` / `watch_colombian_telenovelas` never matched. Now data-driven: sparse `ActionDef.powersOnTarget` flag (Interaction Editor "powers on target" checkbox) switches the stateful target ON at action start, Sims-style; `turn_on`/`turn_off` remain the generic toggles and `turn_off` wins over a mistaken flag. Set on all three watch actions in interactions.json. Any future stereo/radio/console action powers its asset with zero code.

## B13-5. BUG: moving in to a new place does not work anymore (tested with 1h moving time).

**DONE (2026-07-18):** regression introduced by B10-22. When the runtime homeMap PUT was removed ("no persistence until the save system"), completePendingMove kept relying on loadAll() returning the DESTINATION map — but loadAll resolves the map from the ON-DISK simstate (homeMap now always null), so it returned the OLD map, `fresh.map.id !== mapId` was always true, and every move-in hit the silent "aborted" branch. Worse, the 2s hot-reload poll had the same disk resolution, so even a successful switch would have reverted on the next designer data edit. Fix: data.ts gains a runtime home override (setRuntimeHomeMap; resolveHomeMapId takes an optional override that outranks both disk sources) set by completePendingMove and consulted by EVERY loadAll() — move-in and hot-reload stay on the new map; the override clears on abort so the poll never chases a deleted map. Still in-memory only by design (ROADMAP_SAVE V3 persists it). pendingmove suite extended (override precedence).

## B13-3. BUG: Theme Editor colors/shapes/element overrides don't apply. B13-4: loading music should autoplay.

**DONE (2026-07-18):** B13-3 root cause was the presentation layer — editor fields DID write the draft and PUT correctly, but applyTheme() only ever ADDED CSS custom properties (clearing a sparse override never removed the stale inline variable, so preview and runtime looked stuck) and several gallery specimens consumed only part of their editable variables (foreground/outline/shadow/font/accent edits changed data invisibly). applyTheme now removes stale variables on reapplication and every specimen consumes all of its editable keys; edit → draft → preview → PUT → runtime is covered end-to-end in the theme suites (90 runtime assertions). B13-4: loading music calls play() immediately; on autoplay-policy rejection it retries once on the first pointerdown/keydown (guarded so it can't fire late over map music); the tap-to-start control hides once playback succeeds. Config stays in data/loading.json. NOTE: the one-line main.ts wiring rode along in the B13-5 commit (concurrent work).

## B13-6. BUG: Theme Editor still broken — Colors, Shapes, and Element gallery cards render EMPTY (headers/hints only, no fields). Screenshot: Capture.PNG (removed after fix).

## B13-7. Autonomy: tunable decision delay after game launch / map change / return from work etc., so the sim doesn't act before the player.

## B13-8. Buy mode: show the actual MESH (with transparency), not just the footprint, when placing new objects.

## B13-9. Lights add some comfort when ON at night (per-asset level).

## B13-10. Sleep blockers: a light or sound-producing device (e.g. TV) that is ON within a radius AND in the same room (walls/doors block it) prevents sleeping.

## B13-11. Work schedule: the sim should not work every day — choose days + times of the week; implement the WEEKDAY feature, weekday shown at the top of the smartphone (no dedicated tab).

## B13-12. Social: visit duration depends on the relationship; PAIRED interactions that move both sims to a target asset (e.g. both go on the bed, then the action starts with per-role animations); interactions can trigger sounds.

**B13-7 DONE (2026-07-18):** tuning.autonomy.decisionGraceSeconds (default 5 sim-seconds, Tuning Editor generic card) arms the existing Autonomy.forceCooldown sim-time primitive at boot complete, runtime map switch, return from work, and return from a visit (game-over restart reloads the page, so boot covers it). Autonomy-only: player orders bypass it structurally. Pause freezes it (sdt). New test/autonomy-grace.test.ts. Also removed the leftover #devbar debug strip (redundant clock + data/fps stats) from index.html/main.ts, with stale layout comments updated in nav.js/ui.ts.

**B13-6 DONE (2026-07-18):** root cause — the designer's dev server predates B13-1's GET /api/fonts and /api/icons, so the old process answered them with the HTML fallback (200 text/html); the editor's .json() parse threw AFTER theme.json loaded but BEFORE Colors/Shapes/Element gallery rendered, blanking exactly those cards (Layout rendered later via the independent theme-engine bridge — matching the screenshot). Fix: font/icon listings are optional (non-JSON degrades to empty lists + console warn) and every card now renders independently; a malformed component value shows an inline error in its own card instead of blanking the rest. Regression tests: real on-disk theme.json rendering, HTTP-200-HTML listing response, sparse/extended data, per-card malformed isolation. RESTARTING npm run dev additionally activates the real font/icon dropdowns.

**B13-9/B13-10 DONE (2026-07-18):** shared pure game/ambience.ts foundation — inspectAmbience() resolves ON state (assetstate), light/sound emission (light block / AssetDef.sound, no duplicate flag: the TV emits both), tunable radius, and SAME-ROOM via a 2D sim→asset ray against authored wall segments (open apertures pass, closed doors block, wall-mounted sources at the endpoint stay in-room; wallaperture + live door state reused). Tuning: ambience.{radiusMeters:5, nightComfortEnabled, comfortNeedId, sleepBlockingEnabled}. B13-9: sparse AssetDef.light.comfortBonus (Asset Editor Light card field; floor lamp 0.08 / wall lamp 0.06 per needs tick) applied continuously at night (isNightHour window) while lit + in range + in room. B13-10: sleepBlockDecision() names the nearest blocker; Sleep/Nap disabled in the radial menu with the reason, autonomy skips blocked beds, arrival re-checks, and ongoing sleep interrupts via stopAction(false) + toast ("Can't sleep — the TV is on") — cancel semantics, no side effects. 28-assertion test/ambience.test.ts; stats/behavior/asset-editor suites extended.

**B13-8 DONE (2026-07-18):** buy mode shows the ACTUAL asset as a translucent ghost alongside (not replacing) the green/red footprint: real GLBs and sprite quads through the SAME world.ts loader cache + normalization/meshFit/reground/offset/wall-mount transforms, materials cloned, tuning.buy.ghostOpacity (default 0.5) + depthWrite:false; valid keeps true colors, invalid gains the red validity tint; snapping/rotation followed; never raycastable, no placed-object metadata; disposed on confirm/cancel/reselect/exit and cache-safe across hot reload/map rebuild. Pure transform/appearance helpers covered in test/buymode.test.ts. NOTE for the designer: the buymode suite's self-deriving placement audit now flags the authored SHOWER as overhanging its floor at 0.5m resolution (pre-existing map data, unrelated to ghosts) — nudge it in the Map Editor.

**B13-11 DONE (2026-07-18):** weekday calendar derived purely from the absolute game clock (no new mutable state to save): tuning.calendar.dayNames (default Mon..Sun) + startDayIndex. Jobs gain sparse workDays (absent/all-checked = daily — saved sparsely; [] = no shifts; dishwasher seeded Mon–Fri as the visible example). Entire work pipeline schedule-aware: manual departure, door-arrival recheck, reminders, auto-depart, missed-shift penalties, attendance cursor — off-days can never create skips. Smartphone status bar shows "Wed 14:05" (no new tab). Career Editor job card gains a Weekly schedule card with seven data-driven checkboxes (all-checked auto-removes the field). Pay/needsCost/promotions/quest vars untouched. work + phone-hud + career-editor suites extended.

**B13-12 DONE (2026-07-18):** (1) visit duration scales with relationship: sparse social.json visitDuration.byLevel multipliers over NpcDef.visitDurationHours (absent = ×1), resolved ONCE at arrival (pure, tested), survives serialize/restore; editable on the Social Editor levels card. (2) Paired target-asset interactions: sparse interaction fields targetAsset (asset id OR category), playerAnimation/npcAnimation (fall back to the base animation), sound. Both SimAgents route to the chosen asset; timer/animations/censor/sound start only once BOTH arrive; beds reuse the authored lie usePose with the pair split across opposite halves (quarter-footprint offsets along the bed's local width). Completion-only effects; cancels/interrupts/NPC departure stop both agents, restore poses, stop sound, apply nothing (S4 guarantees extended, not forked). (3) Interaction sounds ride the existing action loop lifecycle for standing AND paired interactions. Social Editor: targetAsset picker fed from assets.json, per-role animation fields, sound with path normalization, per-level visit multipliers. The designer's own "Put the seal on the bed" entry seeded as the paired beloved-gated censored example. Suites extended: social/social-interactions/npc/social-editor (+usepose/seatground green).

## B13-13. CORRECTION to B13-9: the night light bonus must feed the ENVIRONMENT score (recompute-based), not comfort per tick.

## B13-14. Night darkness penalty: at night the environment score is LOWERED by a tunable amount (which is why lamps turned ON create environment points).

**B13-13 DONE (2026-07-18):** night-light bonus corrected per the designer: sparse field renamed to light.environmentBonus (Asset Editor Light card updated; designer's live lamp values preserved — floor 3, wall 1.5) and applied inside computeEnvironmentScore() alongside the furniture/accident aggregate — NO per-tick semantics anywhere (comfort wiring + tuning.ambience.comfortNeedId removed). Scoping: base environment stays whole-home; the night-light term is sim-relative (ON + night + radius + same-room via ambience.ts). New recompute triggers: light toggles (setOn now reports state changes), locomotion completion, and night-window transitions in the main clock path just before the sky day/night update. tuning.ambience.nightEnvironmentEnabled gates it (only literal false disables). Sleep blockers (B13-10) untouched. Suites: ambience 33, stats/environment 33, assetstate/behavior/asset-editor green.

**B13-14 DONE (2026-07-18):** tuning.ambience.nightEnvironmentPenalty — a signed delta (absent = 0) added to the environment score during the night window, in the SAME gate as the lamp bonuses (nightEnvironmentEnabled false disables both; they are one feature). Live tuning normalized: the designer's "-7" (typed into the enable flag before the field existed) moved to nightEnvironmentPenalty:-7, nightEnvironmentEnabled back to true. Night: penalty + ON-lamp bonuses; day: neither. The B13-13 night-boundary recompute covers the transition. ambience 40 / stats 34 assertions.

## B13-15. Happiness state replaces the heart icon in the Needs accordion header; remove the row inside the accordion.

**B13-15 DONE (2026-07-19):** sparse theme.json accordion flag `happinessHeader: true` (Theme Editor Accordions card gains a "Happiness header" checkbox; set on the shipped Needs accordion). applyTheme renders hidden live slots (`.theme-accordion-happiness-icon/-label`) in the flagged toggle; Hud.setHappiness routes the resolved state (honoring happiness.json stateDisplay icon/text/both) into every flagged header, hides the static accordion icon while a state shows (it remains the fallback when no state resolves), and keeps the in-panel `.happiness-state` row hidden whenever a happiness header exists. Toggles are rebuilt by every applyTheme, so setHappiness re-queries per call — hot theme reloads self-heal on the next happiness recompute. Suites: theme (accordion resolution passthrough + shipped-theme expectation) and hud-bars (header routing, static fallback, in-panel suppression) extended.

## B13-16. State visuals: GIF screen overlay on powered assets (TV picture) + per-state mesh variants (open fridge), designer-positionable per asset.

**B13-16 DONE (2026-07-19):** designer request was "gif texture on the TV screen when ON" + a "state selector" for models; GLB can't carry animated textures, so both live in the engine (PROJECT_CONTEXT §7.50). Sparse `AssetDef.screenOverlay` {image, widthMeters, heightMeters, offset[x,y,z], yawDeg, pitchDeg, fps, doubleSided, when:'on'|'off'} — an upright plane playing an animated GIF (sprites.ts decode cache; static images work) attached per placed instance, shown only while the instance's Turn On/Off state matches, positioned in asset-local meters so every TV shape can be fitted individually. Sparse `AssetDef.stateMeshes` {on?, off?} — per-state model variants through the same loader cache + normalization/meshFit/wall-mount pipeline; states without a variant keep the base mesh. Both toggle in world.ts setAssetObjectOn (same state as light/sound/hydro), overlay GIFs warm at world build, playback rides the sim-time spriteUpdate hook (paused while hidden). Asset Editor: new State visuals card (Windows-path normalization, sparse pruning) + view-only "Preview power state" toggle rendering the overlay/ON-mesh through the game's own resolution. TV seeded from Blender measurements of tv.glb's screen face: placeholder public/textures/tv_screen.gif (static noise, replace at will) at 1.55×0.82m, offset [0,0.5,0.03]. New pure game/stateviz.ts + test/stateviz.test.ts (17 assertions); sprites gains createOverlayInstance; asset-editor jsdom suite extended; meshfit/buymode/assetstate/sprites suites green.

## B13-17. Bugfix batch: all 25 AUDIT_TOOLS bugs + Bugstofix.txt items — ✅ DONE 2026-07-19
Audit bugs 1-25 fixed (see AUDIT_TOOLS.md header for the per-item list; new shared tools/refscan.js warns about cross-file dangling references after ANY editor delete). Bugstofix.txt: (1) door frame+pane in-game — root cause was door_basic carrying BOTH paneNode and paneMesh; the game's precedence (node wins) skipped the pane GLB while the editor preview ignored precedence. Healed the data (stale paneNode removed), the preview now uses the game's own resolvePaneConfig, and the Asset Editor warns when both are set. (2) Career "Needs cost on return" fields un-squeezed (rows span the card, they were stuck in the 210px label column). (3) Long action names widen radial-menu buttons (canvas-measured against the themed font, themed width stays the minimum, capped for phone screens).

## B13-18. Clean/mop radius (Bugstofix.txt) — PENDING
Cleaning/mopping should sweep every matching transient within a tunable radius (tuning.cleanup.radiusMeters?) on completion, not just the tapped one.

## B13-19. Promotion requirements (Bugstofix.txt) — PENDING
Promotions gated on designer-set skill requirements per level + happiness, with a tunable random chance when all criteria are met (extends the existing rollPromotion/happiness factor; Career Editor per-level requirements UI).

## B13-20. Multi-asset social targets + resume sleep after angry shutdown — ✅ DONE 2026-07-19
(1) Sparse `social.json interactions[].targetAssets: string[]` joins the legacy single `targetAsset` (merged/deduped via game/social-interactions.ts socialTargetList; nearest placed match of ANY entry wins; "No bed / sofa is available" lists them all). Social Editor: per-interaction target list — each row edits its slot, blanking removes it, the trailing picker adds another. (2) tuning.ambience.resumeSleepAfterShutdown (default ON): after the angry turn-off chain ends (or the blockers quiet down by themselves), the sim re-orders the interrupted sleep on the same bed — skipped if something is STILL blocking sleep there, cleared on map switch/game-over resets.

**B13-18 DONE (2026-07-19):** tuning.cleanup.radiusMeters (seeded 2, Tuning Editor generic card; 0/blank = old behavior). A COMPLETED clean_up/sweep/mop also clears every other matching mess within the radius: runtime accident instances (new AccidentRegistry.cleanupWithinRadius, same clearedBy rules) AND designer-placed transients (buy-mode destroy path), then rebakes nav / recomputes environment once. Completion-only by construction; the tapped target keeps its own carry-to-garbage semantics.

**B13-19 DONE (2026-07-19):** sparse `JobLevelDef.requirements` (Condition — skills, happiness, anything in the quest namespace) gates promotion INTO that level: work.ts promotionRequirementsFor + a requirementsMet parameter on rollForPromotion/rollPromotion (unmet = chance 0, roll skipped); main.ts evaluates against the live EvalContext at shift end. Career Editor: per-level "Promotion requirements" condition tree under each level row (level 0 = hiring, uses the job's own Requirements card). Chance %, happiness factor unchanged and still tunable.

## AUDIT_TOOLS second pass — ✅ DONE 2026-07-19 (quick wins)
UX 40 (tuning string arrays edit as comma lists), 44 (Behavior action dropdown offers phone_text/call/invite), 45 (Finance happiness picker gains personality/time/quests namespaces), 46 (Animation Mapper lists the code-driven `select` state); NO-TOOL 59 (Social Editor per-NPC "Visitor actions" field). REMAINING (bigger surfaces, need designer priorities): OVERLAP 29-36 (shared condition-builder consolidation, NpcDef type unification, bills duplication), UX 47-50 (rename ids, computed needs, category CRUD, finance bill CRUD), NO-TOOL 54-58/60-61 (save/title/notifications editors, computed needs, category list).

## Newnew.txt batch (2026-07-20)

Designer intent (verbatim):

> Jobs: I should be able to assign a level. For example Dishwasher is level 1. When it gets promoted it is level 2 etc. Exact numbers will depend on carreer and job, tunable.
>
> The asset editor is a mess: a lot of parameters that influence the 3D viewer are far away from it, the characters does not show anymore when we click on show etc. Idea: Put the 3D viewer next to the list of parameters (on the right) and not affected by me scrolling through parameters, see uiassetsexample.JPG.
>
> The sitting and lying locations do not show in 3D either.
>
> Still in the asset, I need an option that allows me to direct how the character will face the asset when using it (not just only the sitting one that already exists), it means that I should be able to spawn a point (like a small ghost cube) in the viewer (not ingame) that says basically: the characters will face towards this point.
>
> Contacts: we do not have the contacts of all NPCs right away, we earn them either by quests, or randomly during the game, for example a certain % of chances during a work shift.
>
> In the quests: We should be able to have the job levels as a condition / requirement to allow me to have a quest where we need to get promoted. For example.
>
> The requirements to be promoted should be clearly shown in the smartphone.
>
> The button to search a job should instead say "refresh jobs".
>
> When our character comes back from work, or a NPC comes, they spawn in the map's spawn point.

Design reading:

1. Career levels become designer-authored numeric values per ladder row (not implicit array indices); progression still advances to the next authored row, and old jobs/saves without numbers retain 1-based index defaults.
2. `job.level` joins the shared condition namespace so quests and every existing condition surface can gate on the current authored career level.
3. The phone's current-job card shows the authored level and the next promotion requirements; the job search button/copy becomes **Refresh jobs**.
4. Contacts become an explicit persisted set. Quest rewards may grant a chosen NPC contact; completed work shifts may discover one unknown NPC via a designer-authored chance.
5. Work return and NPC arrival use the active map's authored spawn point/facing.
6. Asset Editor becomes a two-column workspace with a sticky preview. Character and every sit/lie location render in that preview. A sparse general-use facing target is authored visually with a preview-only ghost cube and resolved into character facing without adding an in-game object.

**DONE (2026-07-20):** Newnew.txt shipped as PROJECT_CONTEXT §7.59. Career ladder rows have designer-authored numeric levels with `job.level` quest conditions and next-promotion requirements on the phone; Search is now Refresh jobs. Contacts are a persisted earned set, grantable by quests or a per-job completed-shift chance. Work returns and NPC arrivals use the active map spawn. Asset Editor now has a sticky right-side 3D preview, visible sit/lie point+direction helpers, a preview ghost-cube `useFacingTarget`, and a capsule fallback so Show character never renders blank.

## Promotion 100% bug (2026-07-20)

Designer intent (verbatim):

> Weirdly I meet all promotion requirements, and put the promotion % at 100% and don't get promoted

Design reading: reproduce the completed-shift promotion path with authored requirements and a 100% setting, identify whether the failure is requirement evaluation, chance semantics, or runtime advancement, then make 100% deterministic once its documented gates are met.

**DONE (2026-07-20):** root cause was Career Editor row ownership, not the happiness formula. Runtime correctly stores/reads the chance on the current/source row, while the editor visually placed a generic `Promotion %` beside that row and placed the matching requirements under the destination row. The editor now groups a clearly labelled `Chance to promote into <level> (%)` with the destination requirements while writing the existing source-row field. Existing jobs/saves and happiness scaling are unchanged.

## Debt-safe action affordability fix (2026-07-20)

Designer intent (verbatim):

> when we are in debt, no action can be performed, even the ones that cost nothing. Also, if an action requires money and the player does not have enough, the character should NOT choose it autonomously.

Design reading: debt must not disable free actions. A strictly positive action cost is affordable only when current funds cover that cost, and the same rule must gate the tap menu, action start, and autonomy candidate selection.

**DONE (2026-07-20):** one pure `game/actioncost.ts` rule now feeds the action menu, authoritative `QuestRunner.spend()`, and every autonomy candidate path. Debt no longer blocks free actions; unaffordable positive-cost actions are never selected manually or autonomously.

## New.txt batch (2026-07-20)
1. **DONE** — radial action menu: adaptive-width buttons no longer overlap. `minRadialRadius` solves the smallest non-overlapping ring in closed form (all pairs, not just neighbours — opposite bubbles collide first), the ring grows past the authored radius when needed, and when even the largest ring cannot hold them the menu falls back to the list layout, which now keeps the adaptive width so long names still fit. test/contextmenu.test.ts 519 assertions.
2. **DONE** (Sonnet) — Social Editor target assets: explicit add/remove rows replace the "-- remove --" dropdown trick; legacy `targetAsset` migrates into `targetAssets` on first edit; duplicates blocked; unknown ids preserved.
3. **RUNTIME DONE** — generalized asset states (PROJECT_CONTEXT §7.55). Tool UI (Asset Editor states card + Interaction Editor `setsState`) in progress.
4. **DONE** — Asset Editor feature-categories show/hide cards (electronics/comfort/plumbing/garbage/kitchen); plumbing leak = existing onUse accident spawning water_puddle. PROJECT_CONTEXT §7.57.
5. **DONE** — multiple sit/lie locations per asset (useLocations) with shared player+NPC occupancy: each character takes the closest AVAILABLE location. game/occupancy.ts + SimAgent onClaimSeat/onReleaseSeat seam; Asset Editor Seat locations card w/ per-location preview. PROJECT_CONTEXT §7.58. (Occupancy transient in v1 — save-wiring is a future slice.)
6. **PLAN ONLY, delivered** — event manager: see ROADMAP_EVENTS.md (verdict: worth building as a thin dispatcher over existing subsystems; 5-phase build order; risk table; 4 open questions).

## New.txt elevated-surfaces / action-carry / wall-view batch (2026-07-21)

Designer intent (verbatim):

> I need, in the asset manager tool, an option to set an elevated plane, the same way the seatings, lying and facing locations are done, i.e. with a visual reference in the viewer. We should be able to check / uncheck next to the 3D viewer (i.e. right pane) all the references to not get lost.
> The elevated pane should work the same way as seatings: we should be able to set a number of "sockets" and a location for each with a propertie when used or available and the character, when wanting to put an asset (generally a transient one like a dirty dish, a meal, a coffee...) should take the nearest available (otherwise putting it on the ground). See elevatedplanexample.jpg.
> This leads to a new asset parameter: objects that can be placed on top of others: for example a coffee machine on top of a counter would be placed at the socket location of the counter, when in buy mode, it basically snaps to the nearest socket when clicking on the table / counter or other similar asset with an elevated plane. This socket becomes obviously unavailable as long as this asset is located here, i.e. the character cannot put a dish or other on top of it.
> When doing an action that requests money (e.g. making a meal), the money is not taken until the action is finished.
> In the case of the character eating a meal (it includes eatin snacks etc, it should be an option in the assets manager tool), if I interrupt the action before it is finished, the character puts the corresponding asset that this action generates (here, a snack or a meal, chosen by designer) on the closest elevated plane in a set radius. If no elevated plane is directly accessible then it is put on the ground. For the example of meals, this is when the "perishable" action plays a role because if the meal is not perished, then we can have different actions set by the designer, typically eat or throw away. The generated asset should have the properties of the generated asset minus what was consumed, for example if the meal was half eaten when the action stopped, then the remaining meal has 50% of the remaining hunger need generation when being eaten. If perished, then we can only throw it away (the meal asset should basically change in another transient asset (rotten food).
> In the actions tools, each action should have the option to attach an asset to one of the character's bones (e.g. with a dropdown menu), for example putting out the trash puts a garbage bag in the hand of the character when the character reaches the trash can, or the character should have a meal in its hand when transporting the meal from the stove to the table (then the meal will be put on the nearest elevated plane socket OR on the ground, in the case of meals for example, the character can enjoy its meal only if a seat is available next to the socket) but also on the closest sitting socket, even with no table or counter, when these ones are not available, and if none are available, the characters its while standing, see eastingexample1.jpg and eastingexample2.jpg.
> If the action of throwing the garbage, for example, is interrupted, the garbage bag transient asset will be put on the ground on the nearest available nav mesh gridsquare. Applies to all actions.
> Also, when a character is doing an action such as watching TV, reading, eating etc, the asset the character chose, if it is one that gives confort, should be taken into account in the way that the comfort need will go up, as if we chose "sit", based on this asset.
> Finally the "cut" option to cut the walls should have now 3 states instead of 2: the two existing, but also one more, similar to the sims game where only the walls in front of other rooms / assets are cut, see planscutoption3example.jpg. When clicking on the cut button, we basically cycle through these 3 ways of showing walls.

Design reading:

1. `AssetDef.surfaceSockets[]` authors local-space elevated placement sockets with x/y/z, and `AssetDef.placeableOnSurface` marks assets that may occupy them. One shared runtime registry resolves nearest free sockets for transient placement and buy-mode stacking; otherwise placement falls back to the nearest legal floor cell.
2. The Asset Editor gets socket CRUD plus right-pane visibility toggles for every helper family (character, sit, lie, general-facing target, and elevated sockets), with occupied/available reference styling in the preview.
3. Action costs stay affordability-gated at menu/order/autonomy time but are deducted only from the completed-only action-stop path.
4. Food is designer-marked by `AssetDef.food` and may author its non-perished interactions plus `rottenAssetId`. Eating applies gain continuously by progress; interruption preserves the remaining fraction and places the same food on the nearest accessible free surface socket within `tuning.surfacePlacement.radiusMeters`, otherwise on a legal floor cell. Perishing transforms the live food into the authored rotten transient rather than silently deleting it.
5. `ActionDef.carriedAsset` authors the visible transient plus target character bone and local transform. It attaches only after source arrival, follows the existing action/carry lifecycle, and drops on every incomplete stop at the nearest legal nav cell. Food and garbage flows use the same carrier seam rather than separate hardcoded hand props.
6. Food routing prefers an accessible surface socket that has an available nearby seat, then an available seat without a surface, then standing. Surface/seat occupancy is released uniformly on completion, interruption, removal, and moves.
7. Comfort contribution is generalized: while an action is running, the selected target/seat asset's authored comfort multiplier participates even when the action id is Watch/Read/Eat rather than Sit.
8. Wall view becomes a three-value in-page mode: full, all-walls cut, and camera-front/room-aware cut. The HUD button cycles these modes; nav/map/save data remain unchanged.

**DONE (2026-07-21):** shipped as PROJECT_CONTEXT §7.60. Elevated sockets are authored and previewed in Asset Editor, shared by interrupted-food placement and Buy Mode stacking with occupancy/save support. Action costs charge only on completion; generic bone-attached carry props drop safely when interrupted. Food keeps its uneaten fraction, can be resumed or discarded, and transforms to authored rotten food on expiry. Eating routes surface+seat → seat → standing, full seat sets no longer overlap, existing comfort attribution was verified and retained, and the wall button now cycles full → cut all → camera-front cutaway.

## Elevated-socket interruption and carried-asset handles follow-up (2026-07-21)

Designer intent (verbatim):

> When the characters puts something on the table (with two slots for elevated planes) and I interrupt the action, the item goes on the other slot, which does not make sense.
> I realized that the assets, when attached to the hand bone, are low on the ground, so let's do 2 options: an option to force the asset to keep its rotation (with checkbox for each axe), which means I can block the rotation so the object always faces up, but I can decide to let it follw the hand rotations).
> Add a new "socket" on the asset: in 3D I should be able to move it, and this will be the exact location the asset anchors to the bone. Meaning it is a "handle".

Design reading:

1. An interrupted food action retains its already-claimed elevated socket. Socket selection treats that item's own claim as available and only searches for another socket when the original reference is invalid or held by somebody else.
2. `AssetDef.carryHandle` is a sparse model-local XYZ point. When a carried asset is attached, that point—not the asset origin—is aligned to the selected character bone plus the action's optional local offset.
3. Asset Editor authors the handle numerically and as a visible/movable 3D helper with its own preview toggle.
4. `ActionDef.carriedAsset.lockRotationAxes` exposes X/Y/Z checkboxes. Each selected world axis retains the asset's authored attachment orientation while unchecked axes continue to follow the animated bone.

**DONE (2026-07-21):** shipped as PROJECT_CONTEXT §7.61. Interrupted food now retains its own already-claimed elevated socket instead of jumping to another slot. Assets can author a model-local carry handle numerically or by dragging its 3D helper, and carried actions can independently lock world X/Y/Z rotation while unlocked axes continue following the animated hand.

## Throw-away actions fill garbage capacity follow-up (2026-07-21)

Designer intent (verbatim):

> Oh and also: throwing something away goes to the garbage capacity :)

Design reading:

1. A completed `ActionDef.discardsFood` action deposits one waste unit into the nearest non-full garbage can before removing the targeted food/rotten-food transient.
2. Ordering is refused when every garbage can is full or none exists. Completion rechecks capacity; if the last slot became unavailable during the action, the item remains in the world and the existing garbage-unavailable notification appears.
3. Cancellation remains side-effect free: no capacity change and no item removal.

**DONE (2026-07-21):** shipped as PROJECT_CONTEXT §7.62. A completed throw-away action now adds exactly one unit to the nearest non-full garbage can before removing the item. Full/no-can states refuse safely at menu, arrival, and completion; cancellations and failed completion rechecks preserve both the item and fill counts.

## Generalized action prerequisites and spawned-action chains (2026-07-22)

Designer intent (verbatim):

> I have now a new job for you: I want to overhaul one part of the action system: Currently, we have actions that spawn transients, like a meal for example. What happens is that when we cook a meal (e.g. Large Meal $25), the character does the action then finds a place to eat and eats it, but this is technically the same action. What I want instead, is that when we Cook a large meal, there is the cooking process (additionally, this requires a fridge nearby, we should add this in the action conditions and generalize it, e.g. : Asset required [SELECT] - Radius Xm - Character goes to this place before performing the action on this asset? [Y/N] - Character goes to this place after performing the action on this asset? [Y/N]), then after the cooking process at the stove, the character pays the price (if any) and this spawns the other asset (Large meal), then the character goes to eat this meal with the specific conditions, automatically, e.g. : finds a table + chair and/or a place to sit and if none available eats standing up), but it will be technically 2 actions: one that the player makes: go cook, one that is performed automatically (and can be stopped, in this case the character puts the meal at the nearest elevated plane socket available or the ground if none). So the order: Players order the character to cook > character goes to the fridge (if none, we should see a notification to say that we do not have a fridge) > then the character goes to the stove and performs the action > if the action is successful: pay the price if any and spawns the new asset + associated action with it (e.g. eat) > performs the actions. This should be generalized like an asset is used then spawns another asset, and in the first asset we should be able to choose the automatic action to perform (if any).

Design reading:

1. `ActionDef.requiredAsset` authors an asset id, search radius, and independent visit-before/visit-after flags. Availability/order resolution finds the nearest live instance inside that radius; absence refuses with a notification naming the required asset. A before visit routes required asset → original target; an after visit routes original target → required asset.
2. `ActionDef.spawnsAsset` authors the completion-created asset id and optional automatic action id. The source action ends and pays its own cost first; only a genuine completion creates the new transient and starts a separate action targeted at that exact spawned instance.
3. The follow-up action uses its own authored duration, gains, conditions, animation, seating, cost, waste, and interruption behavior. If it is interrupted while carrying/eating food, the spawned item is placed on the nearest available elevated socket within the authored surface radius, otherwise on a legal floor cell.
4. Cooking is migrated from action-id inference to authored data: cook actions require a fridge visit before the stove, spawn their chosen meal asset on completion, and automatically run the meal's authored Eat action. Legacy action-family inference remains only as a compatibility fallback for old data until authored links replace it.
5. Interaction Editor exposes both cards with live asset/action dropdowns, sparse fields, understandable sequencing labels, and preserved unknown ids.

**DONE (2026-07-22):** shipped as PROJECT_CONTEXT §7.63. Required assets now gate and optionally route before/after any action; successful completion can create a chosen transient and start a separate authored follow-up. Cooking is migrated to fridge → stove → paid meal spawn → interruptible Eat, with modern/stinky fridge equivalence and editor/test coverage.

## Carry bone names with numbered Mixamo prefixes (2026-07-22)

Designer intent (verbatim):

> When a large meal (same with other assets) spawns, it does not spawn in the hand while I put a handle supposed to go to the hand bone

Design reading:

1. The carry handle is correct; the runtime must resolve the character's real `mixamorig2:RightHand` bone rather than falling back to the character root.
2. Bone matching must tolerate unnumbered, colon-separated, and numbered Mixamo prefixes for spawned food and generic carried assets through one shared normalization rule.

**DONE (2026-07-22):** shipped as PROJECT_CONTEXT §7.64. The shared carry resolver now recognizes Natalia's numbered `mixamorig2:` bone prefix, so spawned meals and all other hand-carried assets anchor their authored handle to the actual hand instead of the character root.

## Per-asset carry-bone selection (2026-07-22)

Designer intent (verbatim):

> let me choose which bone it can be attached with a dropdown as well

Design reading:

1. `AssetDef.carryBone` is authored beside `carryHandle` in the Asset Editor and controls automatically carried/spawned assets.
2. The dropdown is populated from the configured character rig's actual bone names, with useful fallback names for tool/test load failures and preservation of unknown authored values.
3. Absent `carryBone` remains backward-compatible and attaches to the right hand.

**DONE (2026-07-22):** shipped as PROJECT_CONTEXT §7.65. The Asset Editor Carry handle card now offers a rig-populated bone dropdown; spawned/automatic carried assets use the saved `AssetDef.carryBone`, with the right hand retained as the sparse default.

## Bone-attached asset visibility regression (2026-07-22)

Designer intent (verbatim):

> Now I do not see the assets anymore, I do not even see the large meal or snack when she puts it on the table

Design reading:

1. A carried asset must retain its authored world size while parented to a bone inside the character rig, even when the whole imported rig is normalized with a small root scale.
2. Detaching that asset from the bone onto an elevated socket or the floor must preserve that same visible size.
3. The carry-anchor calculation must compensate both the rig's inherited scale and the authored handle so the handle still lands at the chosen bone/offset.

**DONE (2026-07-22):** shipped as PROJECT_CONTEXT §7.66. Bone attachment now cancels the character rig's inherited normalization scale while preserving the authored handle/offset; the item remains full-size when later detached onto a table or the floor.

## Elevated-placement orientation and purchase reload regression (2026-07-22)

Designer intent (verbatim):

> Except that now the asset is rotated when placed on the elevated plane, see screenshot. Also, earlier, I have noted that the assets I buy and put on an elevated plane end up below the plane if I reload the map, see other screenshot, with the arrow.

Design reading:

1. Detaching a carried transient onto an elevated socket (or the floor fallback) must discard the animated bone's pitch/roll and apply only the socket's authored yaw, leaving the asset upright.
2. Every rendering/rebuild path for a purchased surface object—initial purchase, save restore, world/map rebuild, and later overlay refresh—must reapply its saved socket height rather than flattening it to the host's floor coordinates.
3. Regression coverage must exercise both the carried-to-surface orientation reset and a surface purchase across restore/rebuild.

**DONE (2026-07-22):** shipped as PROJECT_CONTEXT §7.67. Placed transients now discard hand-bone pitch/roll and keep only socket yaw; purchased surface objects reapply the current socket height after restore, overlay refresh, and map/world rebuild.

## Spawned non-food follow-up carry regression (2026-07-22)

Designer intent (verbatim):

> When I "Read a book", it spawns the book, but the book is on the ground. The character then goes to read somewhere random while a book was spawned next to the bookshelf.

Design reading:

1. When a completion product's automatic action carries that same asset, the exact spawned instance must attach to the authored bone before the character walks to the action destination.
2. The automatic action must not create a second generic carry transient while leaving the completion product behind at its source.
3. Completion removes the exact carried instance; interruption drops that one instance at the character's current legal floor position.

**DONE (2026-07-22):** shipped as PROJECT_CONTEXT §7.68. The automatic Read action now carries the exact book spawned by Read a book instead of leaving it beside the shelf and manufacturing a second copy; manual resume, completion, and interruption use that same instance lifecycle.

## Action-system architecture and editor clarity overhaul (2026-07-22)

Designer intent (verbatim):

> This is becoming messy and spaguetti like. I want you to rearrange both the core code to ensure it makes sense, no overlap of functions, functions are connected properly between assets, actions etc and in terms of UI to be clear and simple. Basically review the code and fix bugs, optmize for more robustness.
>
> I am thinking out loud... what if every asset has some kind of "event graph" where we connect any interaction to the asset with is own rules, multipliers etc. And this can lead to events, events can call other interactions, assets, notifications etc. I understand that this would be a large redesign so I will "trust your judgement" on whatever is easier, less risky and will allow me to make whatever I want.

Design reading:

1. Audit the recently expanded action → prerequisite → completion product → automatic follow-up → carried instance → surface/floor lifecycle and remove duplicated or competing ownership paths.
2. Move reusable decisions/state transitions out of `main.ts` into cohesive headless-tested modules, leaving runtime orchestration thin and explicit.
3. Validate and clearly surface relationships between asset interactions, spawned products, follow-up actions, carried assets, food semantics, bones/handles, and surface placement.
4. Reorganize Asset and Interaction editors around progressive disclosure and plain-language sequencing, hiding irrelevant controls while preserving all authored/unknown data.
5. Fix concrete bugs found by the audit and verify backward compatibility across the affected suites, strict TypeScript, production build, and live tools/game.
6. Do not introduce a second free-form execution engine. Keep Assets as link owners, Actions as reusable behavior nodes, and Events as reusable side-effect nodes; expose their graph clearly and establish one validated extension seam for future per-asset action overrides.

**DONE (2026-07-22):** consolidated the generic carried-prop lifecycle in `game/actionprops.ts`, removed the dead legacy carry-action implementation, added one shared cross-file action-graph validator/flow description used by runtime and both editors, fixed the inert `learn_cooking` source-first route, made food consume/discard semantics mutually exclusive, added responsive Action-flow and Asset-connections views, and collapsed the global category manager. See PROJECT_CONTEXT §7.69.

## Reading seat placement and book cleanup follow-up (2026-07-22)

Designer intent (verbatim):

> Why does she read, not seated properly on the chair?
>
> And sometimes in the middle of the room
>
> Also, books stay on the ground after being used, they should not, this is not like food.

Design reading:

1. Reading must prefer an available authored seat and must not use the target-facing viewing filter intended for TV-style actions when the carried book is the action target.
2. The visible rig must remain aligned to the selected seat while the Reading clip plays.
3. A completed Read action consumes/removes its temporary book prop. An interrupted Read may place the exact book down so the action remains resumable; books do not persist after successful completion like leftover food.
4. Add regression coverage for seat selection, semantic animation-to-pose mapping, exact prop cleanup, and interruption semantics.

**DONE (2026-07-22):** added per-action nearest/target-facing seat strategy, set Read to nearest-seat routing, added an explicit per-action physical pose so semantic `Reading` snaps to the resolved chair instead of remaining at its approach point, added a data-driven carried-prop interruption policy, and set bookshelf books to disappear on interruption as well as completion. The incorrect global seat-offset experiment was reverted; Sit/Watch authoring remains unchanged. Food's resumable drop behavior is unchanged. See PROJECT_CONTEXT §7.70.

## Generalized containers and designer-authored transfer actions (2026-07-23)

Designer intent (verbatim):

> I suspect that the garbage can asset has its own, hardcoded, logic. I want to change that as I do not like hardcoded stuff: I want you to understand the logic of the garbage can filling up and then getting emptied. The character should go the the garbage can, take out the trash, to the exterior door. This is partially done with the new interactions / props system, however I want to make it work better (as right now it does not go all the way to the trash can and do not go anymore to the exterior door to put it out): generalize by adding an option for all transient assets, which would be off by default, to be able to, via an action (e.g. an action should have an option to perform this specific function), to put it to the trash, then the trash is not just "a trash" it is a container that receives transient assets that point to it through the action, meaning that any other asset can be a "container" with its loading bar depending on the level of filling and the possibility to empty it out somewhere. All of these actions should be editable by the designer to design whatever gameplay loop they want, similar to the system implemented earlier to use an asset that spawns another one and perform the action. The amount of stuff that can be put in a container is editable, the amount of space that an asset takes is also editable.

Design reading:

1. Replace garbage-only authoring with sparse `AssetDef.container` capacity on any non-transient asset and sparse `AssetDef.containerSpace` on transient assets. Both are absent/off by default; retain `garbage.capacity` as a read-compatible migration alias only.
2. Add an action-authored container transfer block with two explicit modes: deposit the targeted transient into a selected container asset type, or empty the targeted container at a selected destination asset type. No action id, asset id, exterior-door flag, or transient kind determines this behavior.
3. Deposit actions perform their normal source interaction, adopt/carry the exact target transient through the shared carried-prop lifecycle, walk all the way to a compatible non-full container, then consume the transient and add its authored space. Cancellation drops/retains the exact target without changing fill.
4. Empty actions are ordered on a specific filled container, walk to that container, show the action's authored carried prop (for example a garbage bag), then walk all the way to the nearest authored destination (for example any exterior door asset selected by id) and clear only that container on genuine completion. Cancellation leaves its load unchanged.
5. Capacity selection uses remaining space rather than item count. Fill bars, save/restore, hot reload, buy/sell rebuilds, and notifications become container-generic while legacy garbage data/saves remain compatible.
6. Asset and Interaction editors expose the container capacity, transient space, transfer mode, compatible container, and emptying destination with live-data dropdowns, progressive disclosure, graph validation, and plain-language flow descriptions.
7. Migrate the shipped dirty-dishes/ash cleanup and garbage-can/empty-garbage loop to authored container transfers, preserving autonomous waste behavior as a compatibility bridge until it receives its own fully authored action chain.

**DONE (2026-07-23):** shipped as PROJECT_CONTEXT §7.71. Containers and transient space are sparse asset settings; Deposit/Empty are reusable action transfers; exact-target carry, destination arrival, cancellation, per-instance emptying, fill bars, legacy saves/data, autonomous waste, food disposal, editors, graph validation, and the garbage-can → exterior-door loop are wired and verified.

## Eating waste chain and default Cut front wall view follow-up (2026-07-23)

Designer intent (verbatim):

> I think that when we eat, the fact that the food fills up the garbage can is hardcoded. Please review and make sure this can be done as the rest with this new logic (explain to me if it is already the case). Unrelated: for the walls, the default view we start with should be "Cut front"

Design reading:

1. Audit `consume_food` completion separately from manual Throw away. The shipped eating loop must not invoke the legacy `producesWaste` auto-tidy/capacity hook.
2. Author eating through the existing generic completion-product graph: Eat creates the `dirty_dishes` transient and automatically starts its ordinary `clean_up` action; Clean up owns the authored `containerTransfer` to `garbage_can`, so capacity changes only after the real second leg reaches that container.
3. Keep `producesWaste` runtime support as a read-compatible legacy field for old/custom data, but remove it from the shipped eating action and clearly label its editor surface as compatibility-only.
4. Initialize the in-page `WallViewMode` as `cutaway` (the HUD label is “Cut front”), while preserving the existing cycle Cut front → Full → Cut all → Cut front from that new starting point.

**DONE (2026-07-23):** shipped as PROJECT_CONTEXT §7.72. Eat now creates Dirty dishes and automatically runs its ordinary Clean up deposit action; the legacy direct-waste hook is no longer selected by shipped eating data. The game now boots in Cut front wall view.

## Duplicate panel above door regression (2026-07-23)

Designer intent (verbatim):

> Bug at a door: there is another panel visible that is on top of the door: this is not in the asset settings

Design reading:

1. Reproduce the visible panel in the shipped condo and identify whether it belongs to procedural wall/aperture geometry or the split frame/pane door renderer.
2. Correct the shared renderer rather than adding a per-door data workaround; the authored frame mesh and pane mesh must each appear exactly once and retain ordinary opening/cutaway behavior.
3. Add focused regression coverage, run the affected door/wall suites and strict TypeScript, then verify the shipped scene live.

**CORRECTION (2026-07-23):** the first wall-cut diagnosis was rejected after a closer designer screenshot showed two copies of the actual pane geometry. That unrelated wall change was fully reverted. This item remains open pending the runtime door-builder fix.

**DONE (2026-07-23):** shipped as PROJECT_CONTEXT §7.73. The actual fault was async two-GLB pane adoption under an already-scaled Cut front root: position/yaw were neutralized but scale was not, so Three.js baked the inverse cut scale into the pane. Full-transform canonical adoption fixes the floating full-height pane; the rejected wall change remains reverted.
