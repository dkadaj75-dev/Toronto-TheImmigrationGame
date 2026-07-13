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
| **Add / remove needs and skills** (not just edit existing ones) | Tuning Editor extension (or small Stats Editor) | ⬜ planned |
| **Add / remove actions** and per-action gains, animation state, autonomy eligibility | Interaction Editor | ⬜ planned (Phase 4, may pull forward) |
| **Quest system**: author quests with trigger & completion conditions + rewards | Quest Editor (replaces roadmap's "Story Editor") | ⬜ planned — design locked below |
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

## 4. Updated build priorities (supersedes roadmap §7 ordering)

1. ~~Animation Mapper + multi-file clips~~ ✅ shipped 2026-07-13
2. ~~Map Editor slice 2~~ ✅ shipped 2026-07-13
3. **Needs & skills add/remove** in the Tuning Editor (designer goal: add/remove needs/skills — game logic is already fully data-driven, so this is mostly tool UI + sane defaults for new entries)
4. **Interaction Editor** — add/remove actions, per-action gains, animation state, autonomy flags (unlocks the full animation vocabulary: cook, read, scream…)
5. **Quest system** per §3 (variables → runner → editor)
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
