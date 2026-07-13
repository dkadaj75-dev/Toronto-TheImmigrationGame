# Condo Life — Web Edition: Project Context Addendum

**Status date**: 2026-07-13 (updated after Map Editor slice 2). Put this file in Claude's project knowledge alongside `WEB_GAME_ROADMAP.md` and `PROGRESS.md`. Where this file and the roadmap disagree, **this file wins** — it records design decisions made after the roadmap was written.

---

## 1. The overriding goal: full designer autonomy, zero code

The designer (Septentrion) must be able to build and balance the entire game **through the browser tool suite, without AI or coding in the loop**. Concretely, the tools must eventually cover:

| Capability | Tool | Status |
|---|---|---|
| Add / remove / edit **assets** (prices, footprint, mesh, interactions, gains) | Asset Editor | ✅ done |
| Balance **every gameplay parameter** (decay rates, gains, thresholds, time scale…) | Tuning Editor | ✅ done |
| Rearrange furniture on a map, bake nav | Map Editor slice 1 | ✅ done |
| Map **character animation clips to game states** + rig settings | **Animation Mapper** | ✅ done (2026-07-13) |
| **Create / edit maps**: draw floors, walls, doors; multiple maps; floor-plan tracing underlay | Map Editor slice 2 | ✅ done (2026-07-13) |
| **Add / remove needs and skills** (not just edit existing ones) | Tuning Editor extension | ✅ done (2026-07-13) |
| **Add / remove actions** and per-action gains, animation state, autonomy eligibility | Interaction Editor | ✅ done (2026-07-13) |
| **Quest system**: author quests with trigger & completion conditions + rewards | Quest Editor (replaces roadmap's "Story Editor") | 🔶 runtime done (2026-07-13, see §3.3) — Quest Editor tool still pending |
| Simulate balance headlessly, chart curves | Balance Dashboard | ⬜ nice-to-have |

Data-driven rule of thumb for every new feature: *if the designer might want to change it, it's a JSON field with a tool UI, not code.*

---

## 2. Character & animation system (as built)

- `game/anim.ts` — `AnimController` over a `THREE.AnimationMixer`. Logical states (`idle`, `walk`, `sit`, `lie`, or any action's `animation` field value) resolve to clip names through `tuning.character.clipMap` (exact → case-insensitive → substring). Missing clips warn once and fall back to idle. Cross-fade duration, walk-clip playback rate (`walkSpeed / walkClipSpeedReference`), sit/lie perch heights — all in `tuning.character`.
- `game/world.ts` — `loadRiggedCharacter()` loads `tuning.character.meshPath`, **merges clips from every GLB in `tuning.character.animationPaths`** (Mixamo-style one-clip-per-file exports; same skeleton required), normalizes to `heightMeters` (centered, grounded), optional `yawOffsetDeg` wrapper for models not facing +Z. Load failure keeps the capsule stand-in.
- `game/sim.ts` — `onLocomotionChange` callback drives idle↔walk; `hasRig` flag disables the capsule-era tip-over lie hack; perch heights from tuning.
- `game/main.ts` — mixer advances on **sim time** (pause freezes, 2×/3× speeds up). Hot-reload re-tunes the controller and re-loads the rig when `meshPath` or `animationPaths` change.
- **`tools/animations.html` — Animation Mapper**: lists the model's actual clips, previews any clip on the character in 3D, maps clips to states via dropdowns, manages animation source GLBs, and edits all rig numbers. States shown = core (`idle/walk/sit/lie`) + every `animation` value referenced by actions + designer-added custom states. Unmapped states flagged ⚠. Saves the whole `tuning.json` (character block edited, other groups preserved).
- **T-pose diagnosis**: T-pose = no clip resolved. Open the Animation Mapper — if the clip list is empty, the animations are in separate files: add them under *Animation sources*. Otherwise the clipMap names just don't match: remap from the listed clips.
- The user's desired state vocabulary (idle, walking, running, sitting, laughing, talking, screaming, cooking, sleeping, reading…): `idle`/`walk` are automatic; everything else becomes live when an **action**'s `animation` field references it. "Running" would need a game-side locomotion feature (e.g. run-when-far) — not built; treat as a future tuning flag.

## 2b. Maps & the active-map mechanism (as built, Map Editor slice 2)

- **`tools/map.html`** is now the complete Map Editor (slices 1+2 in one file — note: the user's tools folder was missing the slice-1 map.html, so this file is standalone and authoritative). Modes: **Objects** (palette add, drag with ½-cell snap, R rotate with 90° normalization, inspector x/z/rot), **Floors** (drag to draw rectangle floors with a chosen material — compose several rects for L-shaped rooms; click to edit id/material/delete), **Walls** (drag to draw, axis-locked and snapped; click to edit endpoints numerically or delete), **Doors** (click a wall to place — position projects onto the wall and snaps along it, orientation inferred from wall axis; drag to move, R flips orientation), **Spawn** (click to place, facing° in inspector). Plus: **Ctrl+Z undo** (50-step snapshot stack, closes a known gap), floor-plan **underlay** image with opacity/width/offset controls (session-only tracing guide, not saved), nav overlay (game's own `nav.ts` via Vite, rebaked lazily on mutation), map-properties editing (name, gridSize, bounds).
- **Multiple maps**: header select + **New / Duplicate / Delete** (new & duplicated maps are PUT to `data/maps/<id>.json` immediately). `server.js` gained `GET /api/maps` (listing) and `DELETE /api/data/maps/*.json` (deletion is refused for non-map files). Deleting the active map or the last map is blocked in the tool.
- **Active map**: `tuning.map.active` names which `data/maps/<id>.json` the game plays (default `condo`). `data.ts` loads tuning first, then that map. The editor's **"▶ Play this map"** button PUTs tuning with the current map id — the running game hot-reloads into it, and `main.ts` detects the map-id change and teleports the sim to the new spawn (`SimAgent.teleportTo`).

## 2c. Needs & skills add/remove (as built, Tuning Editor extension, 2026-07-13)

- **No new tool file** — `tools/tuning.html`'s existing Needs/Skills sections already render one editable group per entry (`renderNeeds`/`renderSkills`), so add/remove was a natural extension rather than a new Stats Editor page. A dedicated `tools/stats.html` would have duplicated that machinery for no benefit; extending was the cleaner call here (contrast with the Map Editor, which got its own file because it needed a canvas + very different interaction model).
- **Add**: "+ Add need" / "+ Add skill" toolbar buttons (`[data-action="add-need"|"add-skill"]`) at the top of each section. `window.prompt` asks for a display **name only**; the id is derived (`slugify` → lowercase, non-alphanumerics → `_`) and uniquified against the existing list (`thirst`, `thirst_2`, …) — no separate id prompt, no failure path to retry. New-entry defaults are **averaged from existing (non-computed) entries**, not hardcoded: a need copies the mean `default`/`decayPerTick` of current needs and starts `autonomy: true`; a skill starts at `default: 0` (skills grow through practice, never decay — no `decayPerTick` field exists on `SkillDef`) with `max` averaged from existing skills. Bar `color` is randomized (designer edits it via the existing color field same as any entry).
- **Remove**: per-entry "Delete need"/"Delete skill" buttons (`[data-action="delete-need"|"delete-skill"][data-need-id|data-skill-id]`). Referential integrity is checked against `interactions.json`: a need can be referenced by an action's `needGains` key or its `primaryNeed`; a skill only by `skillGains`. **Chosen UX (deliberately different from the Asset Editor's "warn and leave dangling" pattern)**: the confirm dialog lists every referencing action by name and field, and on confirm the tool **strips the dangling references** (deletes the `needGains`/`skillGains` key, nulls a matching `primaryNeed`) in the same save cycle — `interactions.json` is marked dirty alongside `stats.json` so both PUT together. Rationale: `game/stats.ts`/`game/autonomy.ts` already no-op safely on an unknown id (nothing crashes either way), but shipping a `needGains`/`skillGains` key that points at nothing is exactly the kind of orphaned data this data-driven design is supposed to avoid, and stripping is a single confirm click away from being wrong-footed by a docs/CLAUDE.md-style comment describing a field that no longer means anything.
- **Ordering gotcha (documented in code comments)**: `render()` fully rebuilds section DOM (`innerHTML = ''` + re-append), which discards any `.dirty` class applied beforehand — `markDirty(file)` must be called **after** `render()` in the add/remove handlers, not before, or the dirty indicator (and the Save button's enabled state) silently fails to reflect the change. (Plain field edits don't hit this because they mutate in place without re-rendering.)
- **No hardcoded ids found in game code**: audited `game/*.ts` for literal need/skill strings (`hunger`, `energy`, `english`, etc.) — none exist. `game/stats.ts` (`SimStats`), `game/ui.ts` (`Hud.rebuildBars`), and `game/autonomy.ts` all iterate `stats.needDefs`/`skillDefs`/`lowestAutonomyNeed()` purely by whatever ids are in `stats.json`; the Environment "computed" need is found dynamically (`data.stats.needs.find(n => n.computed)` in `game/main.ts`), not by id. Confirmed live: added/removed needs and skills render on the in-game HUD and drive decay/autonomy with zero code changes.
- **Tests**: `tools/tuning-editor.test.mjs` extended (not a new suite) with add/cancel/uniquify coverage for both needs and skills, and both referential-integrity branches (unreferenced → plain message; referenced → lists the action(s), strips the reference on confirm, cancel leaves everything untouched), plus a final PUT assertion proving `stats.json` and `interactions.json` save the fully-reconciled state together.
- **Environment note**: this session also discovered the repo's `node_modules` had never actually been installed (no `jsdom`/`tsx`/`canvas`) — every existing test suite would have failed to even start. Added `jsdom`, `tsx`, and `canvas` as devDependencies so the full suite (tool `.mjs` + game `.ts`) is runnable; this is a one-time environment fix, not a code change.

## 2d. Interaction Editor (as built, 2026-07-13)

- **New tool file `tools/interactions.html`** — sidebar (all actions, "player-only" badge when `autonomyEligible` is false) + editor panel, following the Asset Editor's layout (contrast with §2c's needs/skills, which extended an existing section instead — actions have enough fields and their own referential-integrity direction that a dedicated page was the cleaner call here, same reasoning as why Map Editor got its own file).
- **Autonomy-eligibility flag: pre-existing, not added.** `data/interactions.json`'s `ActionDef` already carried `autonomyEligible: boolean` on every action (`game/data.ts` `ActionDef` interface, line ~13), and `game/autonomy.ts`'s `maybeAct()` already gates candidates on it (`if (!action || !action.autonomyEligible) continue;`) before matching `primaryNeed`. No schema change and no `autonomy.ts` change were needed — the editor just exposes the existing flag as a checkbox, so e.g. "Wash hands" or "Cook" (already `autonomyEligible: false` in the shipped data) stay player-only, and toggling it live-round-trips through the sim's autonomy search on save.
- **Editable per action**: name, free-text `animation` state (datalist + hint line listing every state already in use — the 4 core states `idle`/`walk`/`sit`/`lie` the Animation Mapper always recognizes, plus every other action's current `animation` value — so the designer isn't guessing a name that already drives a mapped clip), `autonomyEligible`, `seatAware` (sparse — key only present when true, mirroring the Asset Editor's `seatTarget` convention), `primaryNeed` (dropdown fed from `stats.json` needs + "(none)", writes `null` not a missing key — matches the schema's `primaryNeed: string | null`), and one numeric row per need/skill in `stats.json` for `needGains`/`skillGains` (blank = no entry in the map) — same "fed from data, no free-typed ids" pattern as the Tuning Editor's per-action gain rows, just given a dedicated full-field page instead of a compact grid.
- **id is fixed** once created (assets reference it by string, like an asset's own id) — editing swaps the display name only.
- **Add**: "+ New action" prompts for a display name only; id = `slugify(name)` uniquified against existing action ids (`do_yoga`, `do_yoga_2`, …) — identical derivation helper to the Tuning Editor's `addNeed`/`addSkill`. Defaults: `needGains: {}`, `skillGains: {}`, `animation: ''`, `autonomyEligible: true`, `primaryNeed: null` (sane no-ops until the designer fills them in).
- **Referential integrity** is checked against `data/assets.json` (an asset's `interactions: string[]` array). Delete follows the same "warn with names, strip on confirm" policy as §2c: unreferenced action → plain confirm; referenced action → confirm dialog lists every referencing asset by name, and on confirm the tool removes the id from those assets' `interactions` arrays and deletes the action, marking **both** `interactions.json` and `assets.json` dirty so they save together in one PUT cycle — `assets.json` never ships pointing at an action id that no longer exists.
- **Hot-reload**: works with zero changes. `game/data.ts`'s `watchData()` already polls and reloads the whole `GameData` bundle (including `interactions.json`) every 2s via `loadAll()`, and `game/main.ts`'s hot-reload callback does `data = fresh` (a `let`, not `const`) — every consumer that reads `data.interactions.actions` at use-time (e.g. building the action menu, `WatchTick`-equivalent gain application, `autonomy.ts`'s `actionsById` map) picks up edited/added/removed actions on the next poll with no extra plumbing.
- **Tests**: new suite `test/interaction-editor.test.mjs` (placed alongside the other newest suites, `test/map-editor.test.mjs` and `test/animation-editor.test.mjs`, rather than `tools/` where the two oldest suites still live) covers render + player-only badge, editing every field including the sparse `seatAware` key and the `primaryNeed` null round-trip, add with slugify+uniquify, both delete branches (unreferenced plain-confirm; referenced confirm-lists-assets-and-strips, asserting the exact stripped `assets.json` PUT payload), and search filtering.

## 3. Quest system — locked design (build in a future slice)

Replaces the roadmap's vaguer "Story Editor". Two parts:

### 3.1 Sim-state variables (`data/simstate.json` or a `variables` block)
Designer-defined variables beyond needs/skills, e.g. `visaStatus` (string), `job` (string|null), `income` (number), plus the built-in `funds`. Defaults live in data; the save system persists current values. Variables are readable by quest conditions and writable by quest rewards. This also finally gives `tuning.economy.startingFunds` a consumer.

### 3.2 Quests (`data/quests.json`) — draft schema
```json
{
  "quests": [{
    "id": "first_words",
    "name": "First Words",
    "description": "Reach English level 10 and save §500.",
    "trigger":    { "all": [ { "var": "skills.english", "gte": 1 } ] },
    "completion": { "all": [ { "var": "skills.english", "gte": 10 },
                             { "var": "funds", "gte": 500 } ] },
    "rewards": [ { "type": "funds", "amount": 200 },
                 { "type": "setVar", "var": "visaStatus", "value": "student" } ],
    "onceOnly": true
  }]
}
```
- **Condition namespace**: `needs.<id>`, `skills.<id>`, `funds`, `time.hour`, `time.day`, `vars.<name>`, `quests.<id>.state` (`locked|active|done`).
- **Operators**: `gte`, `lte`, `eq`, `neq`; combinators `all` / `any`, nestable.
- **Reward types**: `funds`, `setVar`, `unlockAsset` (hides/shows catalog entries — ties into Buy/Sell mode), later `dialogue` / vocabulary popups for the language-learning content.
- **Evaluation**: on the needs-decay tick (same reuse-an-existing-interval convention as autonomy). Quest state persists in the save.
- **Quest Editor tool**: CRUD quests, condition builder with dropdowns fed by `stats.json`/variables (no free-typed ids), live validation, and a quest log HUD panel in-game (trigger → "quest started" toast; completion → rewards applied + toast).

Build order within the quest slice: 1) variables + condition evaluator (headless-tested — this is pure logic, perfect for the test suite), 2) in-game quest runner + HUD log, 3) Quest Editor tool.

## 3.3 Quest system runtime — as built (steps 1–2, 2026-07-13)

Steps 1–2 of §3's build order are shipped (game side only — no Quest Editor tool yet, that's step 3).

- **New data files**: `data/simstate.json` (designer variable defaults — `visaStatus` string, `job` string|null, `income` number, each `{ id, name, type, default }`; `funds` is deliberately NOT in this file, see below) and `data/quests.json` (shipping the exact `first_words` example from §3.2, ids matched to the real `stats.json`: `skills.english` — English's `max` is 10, matching the quest's `gte: 10` completion threshold). Both are generic `data/*.json` files; `server.js`'s `/api/data/<path>` and `/data/<path>` routes already serve/accept any `.json` under `data/` with no code change needed — verified by loading both through the existing `GET/PUT` handlers.
- **New module `game/quests.ts`** (pure, no DOM/three.js — headless-testable):
  - `evaluate(condition, ctx)` — recursive evaluator for the §3.2 condition tree (`all`/`any`, `gte`/`lte`/`eq`/`neq`) against an `EvalContext` snapshot (`needs`, `skills`, `funds`, `time.{hour,day}`, `vars`, `quests` — all plain records, built fresh each tick by the caller).
  - **Unknown-id semantics (decision)**: any `var` path that doesn't resolve (unknown need/skill/var/quest id, or an unrecognized namespace) resolves to `undefined`, and every operator against `undefined` is `false` — never throws. A leaf with none of `gte/lte/eq/neq` set is likewise `false`. `all([])` is vacuously `true`; `any([])` is `false` (nothing to satisfy) — both just `Array.prototype.every`/`some`'s native behavior, called out explicitly in the code comment as intentional.
  - `QuestRunner` — the runtime state machine: `quests: Record<id, 'locked'|'active'|'done'>`, `vars: Record<id, value>`, `funds: number`, `unlockedAssets: Set<string>`, `completedLog: string[]`. `tick(needs, skills, time)` evaluates all `locked` quests' triggers (→ `active`, fires `onQuestStarted`), then all `active` quests' completions (applies rewards, fires `onQuestCompleted`) in the same pass — a quest can in principle trigger and complete in the same tick if its completion condition already holds; documented as intentional rather than special-cased, since §3.2 doesn't require a one-tick delay.
  - **onceOnly semantics**: `onceOnly: true` quests go `active → done` and stay `done` forever (rewards apply exactly once). `onceOnly: false` quests go `active → done` (rewards apply) then **immediately reset to `locked`**, so they can trigger again later — this is the "repeatable quest" reading of §3.2's "onceOnly:true quests never re-trigger" (which implies the `false` case can). Not explicitly speced beyond that phrase; flagged here as a design call for the Quest Editor agent to know about (a repeatable quest's rewards fire every time it completes).
  - **Rewards**: `funds` (add to balance), `setVar` (write `vars[name] = value`), `unlockAsset` (add an asset id to `unlockedAssets`).
  - **unlockAsset / Buy-Sell tie-in**: implemented as an additive `Set<string>` of asset ids a quest has explicitly unlocked (`isAssetUnlocked(id)` helper), not a schema change to `assets.json` — no asset currently opts into being quest-gated. Documented expectation for the future Buy/Sell mode (roadmap §4 item 6): an asset is purchasable if it has no quest-gate flag OR `isAssetUnlocked` is true; that gate flag itself (e.g. a future `AssetDef.requiresQuestUnlock`) is for that slice to add.
  - **Hot-reload (`retune`)**: adopts new/edited quest and variable *definitions* without touching runtime *state* — existing quest states and variable values are preserved; only brand-new quest ids get `locked` and brand-new variable ids get their default. Removed ids leave an orphaned (harmless) runtime entry, mirroring `stats.ts`'s `retune()` convention.
  - **Persistence — deferred**: there is no save system in this repo (`data/save/` is empty and gitignored; no `save.ts` module exists anywhere). Quest/variable/funds state is therefore **runtime-only** (resets on page reload), same as needs/skills today. `QuestRunner.serialize()`/`restore(QuestSaveState)` produce/consume a flat JSON-serializable shape specifically so wiring a future save system is a direct `JSON.stringify(runner.serialize())` / `runner.restore(parsed)` call, no refactor needed.
- **`game/data.ts`** gained `VarDef`/`SimStateData`, `Condition`/`ConditionLeaf`/`ConditionAll`/`ConditionAny`, `QuestState`, `Reward`/`RewardFunds`/`RewardSetVar`/`RewardUnlockAsset`, `QuestDef`/`QuestsData` types; `GameData` gained `simstate`/`quests`; `TuningData` gained `quests: { toastDurationSeconds, completedLogLimit }` (both now in `data/tuning.json`, no hardcoded numbers); `loadAll()` fetches the two new files alongside the rest.
- **`game/main.ts`** wiring: `QuestRunner` constructed after `stats`/`hud`/`autonomy`, seeded with `data.tuning.economy.startingFunds` (giving that field its first real consumer, per §3.1). `quests.tick(...)` is called **inside the existing needs-decay `while` loop** in `simTick` (no new accumulator/timer — reuses `decayAcc`/`needsDecayTickSeconds`, per §3.2's "same reuse-an-existing-interval convention"). Needs/skills are snapshotted per-tick via `Object.fromEntries(stats.needs/.skills)`. `time.day` is new: the render loop's clock advance changed from `gameSeconds = (gameSeconds + …) % 86400` to an explicit `while (gameSeconds >= 86400) { gameSeconds -= 86400; gameDay++; }`, so `time.day` (1-indexed, starts at 1) is now tracked and available to conditions. Quest start/complete callbacks trigger HUD toasts and rebuild the quest log; hot-reload calls `quests.retune(...)` + rebuilds the log.
- **HUD (`game/ui.ts`)**: new collapsible `#quest-panel` (bottom-left, above the devbar, same visual language as the needs/skills panels) listing active quests (name + description) and a "Completed" section (last `tuning.quests.completedLogLimit` entries, newest first). New `#quest-toasts` stack (top-center, non-interactive/`pointer-events:none` so it never blocks taps) shows transient "Quest started: X" / "Quest completed: X" toasts, auto-dismissing after `tuning.quests.toastDurationSeconds`. `Hud.setQuestLog(active, completed, limit)` and `Hud.showQuestToast(text, kind, durationMs)` are the new public methods.
- **Hot-reload semantics (documented behavior)**: `quests.json`/`simstate.json` flow through the existing `watchData()`/`loadAll()` 2s poll exactly like every other data file — editing a quest's name/description/conditions/rewards on disk live-updates the definition, but a quest already `active` or `done` stays that way (only its displayed name/description/conditions change); a brand-new quest in the file starts `locked` and evaluates normally from then on.
- **Tests**: new `test/quests.test.ts` (`npx tsx test/quests.test.ts`) — operators (all 4), every namespace including `quests.<id>.state`, `all`/`any` nesting (incl. empty-array vacuous cases), unknown-id/malformed-leaf → false for every namespace, full runner lifecycle (locked→active→done, onceOnly true and false/repeatable, all 3 reward types, `retune` preserving state while adopting new defs, `serialize`/`restore` round-trip). All existing suites re-run clean: `anim.test.ts`, `charfit.test.ts`, `nav.test.ts`, `locomotion.smoke.ts` (via `npx tsx`), `animation-editor.test.mjs`/`interaction-editor.test.mjs`/`map-editor.test.mjs` (via `node`, under `test/`), `asset-editor.test.mjs`/`tuning-editor.test.mjs` (via `node`, under `tools/`). **Pre-existing quirk noted, not introduced by this slice**: `test/meshfit.test.mjs` fails under plain `node` (`ERR_MODULE_NOT_FOUND` — it imports `../game/world` without an extension, which only Node's ESM-extensionless resolution under `tsx` handles) but passes under `npx tsx test/meshfit.test.mjs`; left as-is since it's unrelated to this slice. Strict type gate (`npx tsc --noEmit --strict --target es2020 --moduleResolution bundler --module esnext --skipLibCheck game/*.ts`) is clean.

## 4. Updated build priorities (supersedes roadmap §7 ordering)

1. ~~Animation Mapper + multi-file clips~~ ✅ shipped 2026-07-13
2. ~~Map Editor slice 2~~ ✅ shipped 2026-07-13
3. ~~Needs & skills add/remove in the Tuning Editor~~ ✅ shipped 2026-07-13 (see §2c below)
4. ~~Interaction Editor~~ ✅ shipped 2026-07-13 (see §2d) — add/remove actions, per-action gains, animation state, autonomy flags (unlocks the full animation vocabulary: cook, read, scream…)
5. **Quest system** per §3 (variables → runner → editor) — 🔶 steps 1–2 (variables + evaluator, runner + HUD log) shipped 2026-07-13, see §3.3; step 3 (Quest Editor tool) remaining
6. **Buy/Sell mode** (Phase 3) — after quests' funds/rewards exist, so money has sources and sinks; needs Sims Buy Mode reference screenshots from the designer
7. Mobile polish / PWA (Phase 5)

## 5. Working conventions with Claude (session bootstrap)

- **Claude's container resets between sessions.** At the start of a coding session, upload: `game.rar` (or zip of `game/`), the current `tools/` files being touched, relevant `data/*.json` (at minimum `tuning.json`), `package.json` if changed — plus keep `PROGRESS.md` and this file in project knowledge.
- **Slice workflow**: user says "Continue" → Claude proposes/builds the next self-contained slice → headless tests + strict type gate (`npx tsc --noEmit --strict --target es2020 --moduleResolution bundler --module esnext --skipLibCheck game/*.ts`) → delivery zip of changed files only → user drops files into `D:\WebCreation\condo-life-web`, confirms in-browser.
- **Tests**: TS suites via `npx tsx test/<name>.test.ts`; tool suites via `node test/<name>.test.mjs` (jsdom). Tool tests load the HTML, run the plain inline script (module scripts are inert in jsdom), and drive the DOM.
- **Tool architecture**: editor logic in a plain inline script exposed as `window.<Tool>` (jsdom-testable); three.js and game-module imports isolated in a `type="module"` script (Vite-processed in the browser). Tools import game logic directly (e.g. Map Editor uses `nav.ts`, Animation Mapper uses `normalizeModelToHeight` from `world.ts`) — never reimplement.
- **API**: `GET/PUT /api/data/<path>` on the dev server; tools PUT whole files with `JSON.stringify(data, null, 2)`.
- **Environment**: Windows, project at `D:\WebCreation\condo-life-web`, Node 24/npm 11, `npm run dev` (never `file://`).

## 6. Still outstanding (carried over)

- `CLAUDE.md` exact Unreal numbers — all data-file values remain placeholders until provided.
- Art style lock (Kenney vs Quaternius) — pipeline ready either way.
- Real `secondsPerGameDay` — live-tunable, pick when it matters.
- Known gaps from PROGRESS.md §7 still apply (no Map Editor undo, seat distance cap, single-sim seat occupancy, animated doors / wall fade cosmetic work).
- The Tuning Editor renders `tuning.json` groups generically — the nested `character.clipMap` object may render awkwardly there; the Animation Mapper is the dedicated surface for that block.
