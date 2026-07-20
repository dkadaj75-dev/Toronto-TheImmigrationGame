# Condo Life — Web Edition: Roadmap & Design Reference

**Status**: planning document, written 2026-07-11. Nothing built yet.
**What this is**: the canonical plan for recreating "Condo Life" (currently prototyped in Unreal Engine 5.8, see `CLAUDE.md`) as a **three.js / HTML game targeted primarily at smartphones**, plus a **constellation of browser-based creation tools** for assets, maps, interactions, and story content.

The Unreal project remains untouched and serves as the **design reference**: all stat names, decay rates, gain values, autonomy rules, and asset definitions are ported from it 1:1 unless this document says otherwise.

---

## 1. Vision

A Sims-like life simulation played in the browser on a phone. The player watches over a single sim living in a condo (later: basements, houses, other homes — all authored by the **designer** through the tools, not the player). The player doesn't drive the sim directly: they **tap where to go** and **tap objects** to open contextual action menus. Two stat families drive the loop:

- **Needs** — decay over time; the sim's autonomy refills them by seeking out the right furniture.
- **Skills** — start low, grow through practice. The game has a **language-learning angle**: watching TV, reading, and (later) dedicated mini-interactions improve the English skill.

### Design pillars

1. **Smartphone-first.** Portrait-friendly UI, touch pan/pinch/tap as the primary input, mouse as fallback. Small download, instant load, playable offline (PWA).
2. **Data-driven everything.** Furniture, actions, gains, maps, story beats — all plain JSON files edited through the tool suite. Adding a stat or an object never requires touching game code.
   **Corollary — no magic numbers**: *every* gameplay parameter lives in the data files and is editable by the designer through the tools. Need decay rates, per-action need/skill gain rates, autonomy thresholds (seek-below, stop-at), autonomy cooldown after player commands, tick intervals, day/night time scale, starting funds, prices, starting stat values, camera limits — if a number affects gameplay, it is in a database, not in code. The game hot-reloads data changes so tuning is play-test-live.
3. **Player plays, designer builds.** There is **NO build mode** (see §3). Homes are created/imported by the designer via the tools. The player's creative outlet is **Buy/Sell mode**: purchasing, selling, and rearranging furniture within the home they're given.
4. **Watchable sim.** Autonomy should make the sim feel alive even when the player idles — the "fish tank" quality of the original Sims.

---

## 2. References to the real Sims games

The original Sims (Maxis, 2000) and its sequels are the explicit model. Mapping of concepts:

| Sims concept | Condo Life equivalent | Notes |
|---|---|---|
| **Motives** (Hunger, Comfort, Bladder, Energy, Fun, Social, Hygiene, Room) | **Needs**: Hunger, Comfort, Bladder, Energy, Fun, Social, Hygiene, **Environment** | Same 8, same idea. "Environment" = Sims' "Room" score: computed passively from the quality/quantity of objects around (Σ of each placed object's environment score), not refilled by activities. |
| **Free Will** | **Autonomy** | Sim seeks the nearest object whose primary need matches its lowest need when it drops below 30; stops using an object when the primary need reaches 95. Player commands override autonomy (with a cooldown before autonomy resumes). |
| **Skills** (Cooking, Charisma, Mechanical, Logic, Body, Creativity) | **Skills**: English, Charisma, Cooking, Engineering, Finance (French planned) | Gained per-tick while performing mapped actions (Practice English, Cook, Watch TV → English, etc.). The **English skill is the signature mechanic** — the language-learning angle has no Sims equivalent. |
| **Pie-menu interactions on click** | **Tap → contextual action menu** | Bottom-of-screen button list (already proven in the Unreal prototype). Each object exposes its actions from its data row. |
| **Buy Mode** (catalog, §, placing/rotating/selling objects) | **Buy/Sell mode** | Kept, and it's the player's main creative tool. Catalog is generated from the asset database; every asset already has buy/sell prices. Player funds ("§"-like currency) TBD name. |
| **Build Mode** (walls, floors, pools…) | **CUT — replaced by designer tools** | See §3. |
| **Live mode speeds (1/2/3, pause)** | Time controls + day/night clock | The Unreal prototype has a day/night cycle (currently 60 s/day debug speed); the web version gets an on-screen clock and pause/1×/2×/3× from the start. |
| **Career / story progression** | **Story mode** (authored via story tool) | Quests/scenarios tied to skills and needs, especially English-learning milestones and unlocks. Design TBD with user-provided references. |
| **Isometric / ¾ camera** | Orbit-limited 3D camera | Pan + pinch-zoom with height clamps, like the Unreal prototype. Camera style to be tuned against user-provided screenshots. |

**User-provided references**: the user will supply gameplay dynamics descriptions, screenshots, and videos from the real Sims games **as required per feature** (e.g. before building Buy mode: screenshots of the Sims buy catalog and object-move interaction; before story mode: examples of scenario structure). Each roadmap phase below lists the references it needs. When a reference contradicts this document, discuss, then update this document.

---

## 3. Key difference from The Sims: no Build mode

- The player **cannot** build walls, place doors/windows, change floors, or resize rooms.
- **Homes (condos, basements, houses, …) are authored by the designer** (the user) through the Map Editor tool (§6), or imported (floor plans / meshes) into it. The game ships with the basic condo map and basic asset set as defaults.
- What the player **can** do — **Buy/Sell mode**:
  - Open a **catalog** of purchasable assets (from the asset database, using each row's buy price), filtered by category.
  - **Buy** an object and place it anywhere valid in the home (floor-space + collision check, snap-to-grid, rotate in 90° steps — exact feel to be tuned with Sims reference material).
  - **Move** and **rotate** already-placed objects.
  - **Sell** placed objects at the row's sell price (possibly depreciated later — Sims-style depreciation is a candidate, decide when economy lands).
  - Funds gate purchases; earning money comes later via story mode / skills (e.g. Finance skill, work-from-phone) — earning design TBD.
- Placement rules stay simple: objects live on a grid over designer-defined floor polygons; walls/doors are static level data the player never edits.

---

## 4. What it should look like

- **Art direction**: stylized low-poly 3D (Kenney / Quaternius-style furniture packs as the starting set), bright and readable on a small screen. NOT photoreal — the MetaHuman look does not port (Epic license restricts MetaHumans to Unreal) and photoreal is wrong for mobile web anyway.
- **Character**: one rigged low-poly character (Mixamo/Quaternius rig) with **real animation clips** — idle, walk, sit, lie, and a few interaction loops. This immediately surpasses the Unreal prototype's transform-offset "poses".
- **Camera**: ¾ overhead view of the home, one-finger pan, pinch zoom (clamped), optional slow orbit. Interior always readable; walls facing the camera may cut away or fade (Sims-style) — nice-to-have, phase 5.
- **UI (HTML/CSS, not in-canvas)**:
  - Needs panel: 8 colored bars (collapsible on phone).
  - Skills panel: 5+ bars.
  - Bottom-center contextual action menu on object tap (port of the Unreal `WSG_HUD` menu).
  - Clock + speed controls (pause/1×/2×/3×).
  - Buy/Sell mode toggle → catalog drawer + placement controls.
  - Funds display.
- **Orientation**: design for portrait first (one-handed play), support landscape.
- **Performance budget**: 60 fps on a mid-range phone; total initial download target < 15 MB; single condo scene ≤ ~100k triangles.

Screenshots of the current Unreal prototype and of the real Sims UI (user-provided) will calibrate layout and feel per phase.

---

## 5. Architecture

```
condo-life-web/                  (new folder, its own git repo from day one)
├─ data/                         ← the "databases" — single source of truth, shared by game & tools
│  ├─ assets.json                ← port of DT_Assets: id, name, category, mesh ref, buy/sell price,
│  │                               environment score, interactions[], need gains[], skill gains[]
│  ├─ interactions.json          ← port of ENUM_Interations + per-action need/skill gain overrides
│  │                               (fixes the Unreal limitation where all actions share the row's gains)
│  ├─ stats.json                 ← needs & skills definitions: name, color, decay rate, defaults,
│  │                               autonomy threshold/participation (replaces both enums)
│  ├─ tuning.json                ← global gameplay constants: tick intervals, autonomy seek/stop
│  │                               thresholds & post-command cooldown, day/night time scale &
│  │                               night window, starting funds, arrival radius, camera clamps…
│  │                               EVERY tunable number the designer may want to touch
│  ├─ maps/
│  │  └─ condo.json              ← floor polygons, walls, doors, spawn point, placed objects,
│  │                               navigation grid (baked by the map editor)
│  ├─ story/                     ← scenarios, quests, dialogue, vocabulary content
│  └─ save/                      ← player saves (localStorage in-game; exportable)
├─ game/                         ← the three.js game (Vite build)
├─ tools/                        ← the editor constellation (§6), same Vite project, /tools routes
├─ public/models/                ← GLB meshes (furniture, character, props)
├─ server.js                     ← tiny Node dev server: serves everything + save endpoints for tools
└─ WEB_GAME_ROADMAP.md           ← this file moves there and stays the living reference
```

- **Engine**: three.js + vanilla JS/TS (no heavy framework for the game; tools may use a light one).
- **Pathfinding**: grid A* over the map's baked navigation grid (doors = walkable cells with a door animation trigger). Simple, robust, and the map editor bakes the grid automatically.
- **Simulation**: fixed-timestep tick (1 s needs decay, 2 s activity gains, matching the Unreal prototype's numbers exactly at first).
- **Persistence**: game saves in localStorage/IndexedDB; designer data saved to `data/*.json` through `server.js`. Everything is text → git-diffable.

---

## 6. The tool constellation

All browser-based, all reading/writing `data/*.json` via the local server. Built incrementally — each tool ships in the phase that first needs it.

| Tool | Purpose | Replaces (Unreal pain point) |
|---|---|---|
| **Asset Editor** | CRUD on `assets.json`: prices, category, environment score, interactions, per-need/per-skill gains, mesh assignment (pick a GLB, preview it in 3D). Import: drop a GLB → auto-thumbnail, set footprint. | DT_Assets + the enum-sync-by-hand ritual + "MCP can't author enums" |
| **Map Editor** | Draw floor polygons/walls/doors top-down, place designer furniture, set spawn, bake nav grid, **live-preview in the actual game renderer** (edit ↔ play toggle). Import support for floor plan images as tracing underlay; later GLB shells. Multiple maps (condo, basement, house…). | Hand-placing 17 BP_Asset instances via MCP; navmesh crises |
| **Interaction Editor** | Define actions and per-action need/skill gain tables, autonomy eligibility, animation clip mapping, duration/stop rules. | ENUM_Interations + hardcoded ApplyActionSkillGain chains |
| **Story Editor** | Author scenarios: triggers (skill ≥ X, time of day, need state), steps, dialogues, vocabulary popups, rewards (funds, unlocks). Especially serves the language-learning content. | Nothing — this never existed in Unreal |
| **Tuning Editor** | One screen exposing **every gameplay parameter**: per-need decay rates & defaults (`stats.json`), per-action need/skill gain rates (`interactions.json`), and all global constants (`tuning.json` — autonomy thresholds, cooldowns, tick rates, time scale, funds, prices multipliers…). Grouped, searchable, with min/max sanity hints, save + **live hot-reload into a running game** for instant feel-testing. | Hunting CDO defaults and PrintString-debugging decay values through MCP |
| **Balance Dashboard** (nice-to-have) | Headless sim runner: simulate N hours of autonomy, chart need/skill curves, spot death-spirals before playtesting. | Manual PIE-and-watch testing |

---

## 7. Roadmap

### Phase 0 — Project skeleton *(small)*
Scaffold the repo (Vite + three.js + server.js), git init, port the three data enums + all 14 DT_Assets rows into `stats.json` / `interactions.json` / `assets.json` (exact numbers from CLAUDE.md), pick and import a starter furniture GLB set + rigged character.
**References needed from user**: none.

### Phase 1 — Core loop port *(the big one — playable game)*
Condo map hand-authored as `condo.json` (mirroring the Unreal layout), touch/mouse camera, tap-to-go with A* + click cue, tap-object → action menu, needs decay + activity gains + auto-stop at 95, 7-need autonomy, skill gains (incl. Watch TV → English), seat-aware Watch TV, day/night with on-screen clock + speed controls, HUD bars, doors, real sit/lie/walk animations.
All simulation code reads its numbers from `stats.json` / `interactions.json` / `tuning.json` from the very first line — the Unreal prototype's values are just the initial contents of those files, never constants in code.
**Exit criterion**: the full Unreal feature set (Features section of CLAUDE.md) reproduced on a phone browser, with zero gameplay numbers hardcoded (verifiable: change a decay rate in the JSON, reload, behavior changes).
**References needed**: screenshots of the Unreal prototype for layout parity; any Sims UI screenshots the user wants the HUD to lean toward.

### Phase 2 — Tuning Editor + Asset Editor + Map Editor *(designer autonomy)*
The core tools with save-to-JSON and live game preview. The **Tuning Editor comes first within this phase** — it's the smallest tool and immediately gives the designer control over every rate/threshold from Phase 1 without editing JSON by hand. From here on the user authors content and balances gameplay without Claude in the loop.
**References needed**: examples of homes the user wants to build/import (floor plans, sketches), to shape the import workflow.

### Phase 3 — Buy/Sell mode *(player-facing economy)*
Funds, catalog UI from `assets.json`, buy → grid placement with validity checking, move/rotate placed objects, sell. Environment need already reacts to placed objects (Σ env scores), so buying nice furniture visibly improves the sim's life — the core Sims loop.
**References needed**: **Sims Buy Mode screenshots/video** (catalog layout, placement feel, rotate/move gestures) — this phase is explicitly modeled on it.

### Phase 4 — Interaction Editor + Story Editor + language-learning content
Per-action gains, story scenarios, subtitled TV / vocabulary popups / conversation practice, EnglishLevel-gated unlocks, earning money (ties into Phase 3 funds).
**References needed**: user's vision docs for the language-learning dynamics; any Sims career/aspiration references for progression structure.

### Phase 5 — Mobile polish & packaging
PWA (offline, home-screen install), performance pass, wall cutaway/fade, sound, save slots, real-device test matrix. Candidate stretch: multiple sims, character customization.
**References needed**: target device list from the user.

**Sequencing rationale**: Phase 1 before the tools so the tools can embed a *proven* game renderer; Buy/Sell (3) after the Map Editor (2) because placement/validity logic is shared between the player's buy mode and the designer's map editor — build it once in the editor, reuse it constrained in-game.

---

## 8. Open decisions (resolve as their phase starts)

1. Currency name & starting funds; depreciation on resale? *(Phase 3)*
2. Real gameplay time scale (Unreal debug value is 60 s/day — too fast). *(Phase 1)*
3. TypeScript vs plain JS. *(Phase 0 — recommendation: TypeScript, the data schemas benefit.)*
4. Whether Finance/French become real skills with actions, and what "Talk to"/"Play" on the phone should grant. *(Phase 4)*
5. Art style lock: pick the furniture pack early — swapping styles later is cheap (GLB refs in `assets.json`) but jarring. *(Phase 0/1)*
6. Where the web project lives (suggested: `D:\WebCreation\condo-life`). *(Phase 0)*
