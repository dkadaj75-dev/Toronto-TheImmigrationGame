# ROADMAP_SAVE.md — Save system: persistence, autosave, save slots

> Planning document (2026-07-18). **No code written yet.** Batch 14 track A. The designer has
> been deferring saving until "all main features" landed — with batches 1–13 shipped (full sim
> loop, quests, visas, work, finance, rentals/move-in, social/NPCs, theme rework) that moment is
> now. Same rules as always: PROJECT_CONTEXT.md wins, AGENTS.md gates per slice, one commit per
> slice, everything data-driven, sim-time `sdt`, side effects on completed actions only.
> **ROADMAP_TITLE.md depends on this roadmap** (its Load Game screen consumes V2's slot API);
> build SAVE first or at least V1–V2 first.

---

## 0. Designer request (verbatim intent)

> 2nd roadmap: saving system.

(Long-standing standing context: "No saving system yet — designer is waiting for all main
features before saving is built" — ROADMAP_APT §0; handoff.json has tracked "SAVE SYSTEM
(biggest gap)" in next_steps since batch 6.)

---

## 1. Big picture

The hard part is already done: **every runtime system has exposed `serialize()`/`restore()`
from day one** (repo convention). What's missing is the umbrella: one orchestrator that
collects them, a versioned envelope, a storage surface that works on STATIC HOSTING (see
ROADMAP_TITLE §1 — production has no `PUT /api/data`), boot-time restore wiring, and autosave.

Current serialize/restore inventory (verify against code at build time — this list is from
handoff/PROJECT_CONTEXT as of 2026-07-18):

| System | Where |
|---|---|
| Needs/skills/personality + sim clock | game/stats.ts / main.ts sim state |
| QuestRunner (+ simstate vars) | game/quests.ts |
| VisaState | game/visas.ts |
| Work (job, level, skips, shift state) | game/work.ts |
| FinanceState (funds, debt, credit, bills) | game/bills.ts / finance |
| HydroMeter | game/hydro.ts |
| BuyOverlay / placed+sold objects | game/buymode.ts + world placement |
| AssetStateRegistry (ON/OFF) | game/assetstate.ts |
| Garbage fill / carried food / waste | game/garbage.ts, game/food.ts |
| AccidentRegistry (incl. fire damage) | game/accidents.ts |
| SocialRuntime (relationships + phone cooldowns) | game/socialruntime.ts |
| NPC visit state | game/npc.ts |
| VisitAwayTracker | game/visit.ts |
| PendingMoveTracker + homeMap | game/rental.ts / main.ts (B10-22: in-memory by design UNTIL this system — un-defer it here) |

Design principles:

1. **One envelope, versioned.** `{ version, savedAt, mapId, gameHour, systems: { <id>: <payload> } }`.
   Each system registers under a stable string id. Envelope `version` bumps on breaking shape
   changes; a migration hook table (pure functions old→new) runs at load. Unknown system ids in
   an old save are ignored with a console warn, missing ones restore defaults — loading must
   NEVER hard-fail (never-throw precedent from social.ts).
2. **localStorage is the primary store** (works on Netlify/GitHub Pages/anything; survives PWA
   installs; per-origin). File export/import (download/upload a `.json`) is the designer-grade
   backup and the answer to "browser cleared my data". A `data/save/` dev-server API surface is
   explicitly NOT the plan — it dies on static hosting (ROADMAP_TITLE §1).
3. **Slots, not a single save.** Cheap once the envelope exists (slot id in the storage key),
   and the title screen's Load menu wants a list (name, timestamp, funds, map, play time).
   Default 3 slots + 1 autosave slot; count in `data/save.json` config.
4. **Save timing:** manual save (phone or pause menu + title integration later) plus autosave
   on a sim-time cadence and on key completions (move-in, day rollover) — all completion-point
   hooks, never mid-action. Saving mid-ACTION is out: the active action is deliberately not
   serialized (interrupted-action semantics already exist: cancel applies nothing); a loaded
   game resumes idle at the same clock/needs/world state. This matches the side-effect rule and
   dodges the hardest bugs (two-leg actions, carried transients mid-walk).
5. **Everything tunable in `data/save.json`** (slot count, autosave interval, autosave-on
   events, storage key prefix) with a Tuning-Editor-style card (generic groups pick it up).

---

## 2. Slices

### V1 — Pure save core (`game/save.ts`) — ✅ SHIPPED (2026-07-18, with V2)
Registry (`registerSaveable(id, {serialize, restore, defaults?})`), envelope
assemble/disassemble, version + migration-table runner, validation (never-throw, per-system
isolation: one corrupt payload skips that system, warns, restores its defaults, keeps loading),
slot key naming, save metadata summary extraction (for load menus). Zero DOM/storage — takes
and returns plain objects. `test/save.test.ts`: round-trip with fake systems, unknown/missing
system ids, migration chain old→new, corrupt-payload isolation, metadata summary.
**Agent: Claude (Opus).** The envelope/migration design carries every future batch.

### V2 — Storage surface + slots (`game/savestore.ts`) — ✅ SHIPPED (2026-07-18)
> V1+V2 as-built (Codex): envelope {version, savedAt, name?, mapId, gameHour, playSeconds?,
> systems{id:opaque}}; SaveRegistry + assemble/apply/validateEnvelope + extractSlotMeta;
> migrations advance exactly one version each, future versions refuse with a reason, corrupt
> payloads isolate to per-system defaults + warnings. SaveStore over an injected StorageAdapter:
> list/read/write/delete (result objects, never throws; corrupt slots listable+flagged, quota
> surfaced), buildExportBlob (condo-life-save-<slot>-<date>.json), parseImport via V1
> validation. data/save.json: 3 slots + visible autosave, 12h interval, moveIn/dayRollover
> events, prefix condo-life-save. 19+19 assertions.
localStorage adapter (quota-aware try/catch — a full disk must toast, not crash), slot
list/read/write/delete, export (Blob download `condo-life-save-<slot>-<date>.json`) and import
(file input → validate via V1 → write slot). Storage-key prefix from data/save.json. jsdom-able
pure logic + thin DOM for the file pickers. `test/savestore.test.ts` with a mocked storage.
**Agent: Claude (Sonnet).** Mechanical once V1 defines shapes.

### V3 — Runtime wiring: register everything, boot restore, autosave — ✅ SHIPPED (2026-07-18)
> As-built (Codex): game/savewiring.ts + main.ts. System ids: simStats, clock, quests(+funds
> meta), visa, work, finance, hydro, buyMode, assetStates, garbage, food, accidents, social,
> npcVisit, visitAway, pendingMove, homeMap (weekday derives — not saved). Restore order:
> validate slot → set home map (B13-5 setRuntimeHomeMap) → shared applyFreshData rebuild →
> absolute clock → applyEnvelope (per-system isolation) → reattach accidents/buy/lights/garbage
> → nav+environment rebuild → spawn teleport (actions not serialized). Corrupt slot: toast,
> current game untouched; missing map aborts pre-restore. Autosave: sim-time interval +
> moveIn/dayRollover, skipped during map switch/game over/buy mode, quota failure toasts once.
> NPC rig failure on restore ends the visit silently. Minimal UI: slot picker + Save/Load in
> the right HUD stack (TITLE/G3 replace it). Coordinator-verified live: save → page reload →
> load restores funds/clock with zero console errors. test/save-wiring.test.ts (real system
> classes round-trip).
Register every system in the §1 table from main.ts (find each real serialize/restore, adapt
where signatures drift); boot flow gains a restore path (load slot → applyFreshData-style world
rebuild → restore payloads → resume clock) reusing the R4 map-switch machinery for maps —
**this is where homeMap persistence gets un-deferred** (B10-22 note updated). Autosave on the
data/save.json cadence (sim-time) + on move-in/day-rollover completions; manual Save/Load via a
new phone tab or pause surface (minimal UI — the real front door is ROADMAP_TITLE's menus; keep
this thin and let TITLE replace it). Failure paths: corrupt slot → toast + fresh boot.
`test/save-wiring.test.ts` (headless: register real systems, save, mutate, restore, assert
world-agnostic payloads round-trip) + boot check.
**Agent: Codex.** Touches main.ts boot order + every system — highest integration risk;
same reasoning as S3/S4.

### V4 — Save/Load UX polish + TITLE handoff — ✅ SHIPPED (2026-07-18) in the SMARTPHONE per the designer decision ("Put the save system in the smartphone")
> As-built (Codex, with TITLE T3): shared pure game/saveslots.ts (slotCardViews + overwrite/
> load/delete/rename decisions, export/import glue over SaveStore). Phone Save tab
> (tuning.phone.saveTabName, default "Save"): slot cards w/ rename, Save-here (confirm
> overwrite), Load (confirm discard), Delete (confirm), Export, Import w/ target selection;
> autosave slot loadable/exportable but never manually saved/renamed/deleted/imported-over.
> V3's temporary #save-controls HUD picker fully removed. Title Load = same slot cards
> (T2's load-newest shortcut retired); corrupt/empty visible, not loadable. Coordinator-verified
> live: phone tab lists the saved slot with metadata, HUD picker gone, zero console errors.
Slot cards with metadata (name/rename, timestamp, funds, map, play time), confirm-overwrite and
confirm-load-discards dialogs, export/import buttons per slot. Built wherever ROADMAP_TITLE T2
puts the Load screen — if TITLE ships first this slice merges into it; if not, it lives in the
V3 pause surface and TITLE reuses it. Explicitly coordinate with ROADMAP_TITLE §2 T3.
**Agent: Claude (Sonnet).**

### V5 — Designer pass (no agent)
Tune autosave cadence/slot count in the editor; playtest save/load across: mid-quest, indebted,
mid-visa-grace, NPC visiting (visit state restores or gracefully ends), moved-in apartment,
fire damage, pending move. File a bug list; fixes fold into a follow-up slice.

---

## 3. Execution order & dependencies

```
V1 (Opus) ──► V2 (Sonnet) ──► V3 (Codex) ──► V4 (Sonnet) ──► V5 (designer)
                    └───────────► ROADMAP_TITLE T3 (Load screen consumes V2 slot API)
```

## 4. Open decisions (resolve before the slice that needs them)

1. **Active-action serialization (V1/V3):** recommendation — do NOT serialize in-flight
   actions (resume idle); revisit only if playtest hates it.
2. **NPC visit restore (V3):** restore the visit state machine (npc.ts already
   serializes) but if the rig fails to load on restore, reuse the arrival-failure fallback
   (call outcome conversion is wrong post-hoc — just end the visit silently). Decide exact
   behavior in the slice.
3. **Autosave slot visibility (V2):** recommendation — autosave is a normal, loadable slot
   labeled "Autosave", overwritten silently.
4. **Designer data vs save data:** saves capture RUNTIME state only; `data/*.json` authoring
   stays git/tools territory. A save loaded after the designer rebalances data uses the NEW
   data (hot-reload precedent) — document this as intended in V1.

## 5. Explicitly out of scope (this batch)

Cloud sync/accounts, cross-device saves, save-file encryption/anti-tamper, multiple player
profiles beyond slots, replay/undo history, saving mid-action.
