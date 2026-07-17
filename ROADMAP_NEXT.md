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

**Plan locked in ROADMAP_APT.md** (slices R1-R5 / D1-D4 with per-slice agent assignments: Codex for R4 map switch + D1/D2 door geometry, Claude Opus/Sonnet for the rest, designer authoring pass R5). Read that file before building any slice; open decisions listed in its §6.

# Batch 12 — 2026-07-16: social system (NPCs, relationships, visits, phone contact)

## B12-1. PLANNED (no code yet): NPC Sims with personality/compatibility, Sims-style relationship levels, contextual sim-to-sim interactions, invite home / ask to leave, text/call from phone, visit-their-place away flow, dedicated Social Editor tool page.

**Plan locked in ROADMAP_SOCIAL.md** (slices S1-S7; Codex for NPC runtime + sim-to-sim choreography, Claude Opus/Sonnet elsewhere; builds ONLY after ROADMAP_APT.md ships). ROADMAP_APT.md §6 decisions were approved by the designer and marked RESOLVED.

## B10-14. Trash can fill indicator: small in-world loading bar showing empty -> full status per can.

**DONE (2026-07-16):** camera-space sprite bar over each live garbage can (progressbar.ts geometry helpers reused, scene-parented per the sprite anchoring lesson), synced on deposits/tidy/empty/buy-sell/world rebuild. Tunables: tuning.garbage.fillBar {widthMeters, heightMeters, yOffsetMeters, fillColor, trackColor, showWhenEmpty:false} — Tuning Editor gained one-level nested sub-group rendering to expose it. Pure ratio/visibility/geometry helpers covered in test/garbage.test.ts.

## B10-15. Asset Editor: offset the mesh on all 3 axes (was single-axis).

**DONE (2026-07-16):** meshFit gains sparse xOffset/zOffset alongside the existing yOffset; applyMeshFit nudges position on each set axis, composing with scale/yaw, identically in-game and in the Asset Editor preview. Three sparse inputs on the mesh-fit card. test/meshfit.test.mjs extended (tsx-only quirk unchanged).

## B10-16. Per-asset need multipliers: each asset scales selected needs' action gains (several needs, add/remove, negatives allowed).

**DONE (2026-07-16):** sparse AssetDef.needMultipliers {needId: number}. ONE pure helper (stats.ts effectiveNeedGain) feeds BOTH the sim gain tick (applyGains) and autonomy scoring (behavior.ts scoreCandidate), so a luxury sofa genuinely outranks a bad one and negative multipliers drain. Seat-aware actions credit the multiplier of the seat actually perched on (active.seat ?? target — documented in main.ts). Asset Editor "Need multipliers" card (need dropdown + value, add/remove, sparse). Behavior Editor live preview reflects it automatically (real scorer). Tests: stats/behavior/meshfit/asset-editor suites.
