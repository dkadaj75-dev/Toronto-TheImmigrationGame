# ROADMAP_APT.md — Apartments, Rentals ("Kijiji"), Doors-in-Walls, Façades & Exteriors

> Planning document (2026-07-16). **No code has been written for this yet.** This is the execution
> plan for the designer's apartment/rental batch, including which agent runs each slice.
> Conventions: PROJECT_CONTEXT.md wins on any conflict; every slice follows AGENTS.md gates
> (strict tsc, pure suites one at a time, jsdom tool suites, boot with zero new console errors),
> one commit per slice, designer data never reverted.

---

## 0. Designer request (verbatim intent)

> I will create new maps, I want that each map can potentially be included in a new phone tab:
> "Kijiji", where apartments that are available to us are shown. The availability of apartments
> will depend on: quests done, job (daily pay), credit score and visa status. When non available
> to rent, show just the ad (we can make "fake ads" for each apartment) but show something like
> "non available yet", don't show the conditions in the ad. The m2 should be shown in all ads,
> rent price only for available ones. Now knowing that, I want some small changes in the map
> building, for example my doors are not perfectly 1m (the asset) wide and full height, I want a
> way to make sure that any door fits into the wall; instead of stopping the wall to insert the
> door, we can insert the door in a plain wall, and by a Boolean, this door makes a hole in the
> wall to allow the sim to go through, similar to the original Sims game. Also right now when
> opening a door, the whole door + frame asset pivots; find a way where the frame and the door
> are separate parts combined in one 3D in the viewer, where only the door pane opens.
> Additionally, provisions for curtain wall façade with balcony doors and balcony for future
> maps, and some maps should render a simplified 3D exterior environment (reference: the Sims
> city-backdrop screenshot). When a new apt is rented, the Sim will move in after a set amount
> of hours/days, and this becomes the new base map. No saving system yet — designer is waiting
> for all main features before saving is built.

---

## 1. Big picture

Two independent tracks that only meet at the end:

- **Track R (Rental):** map ad metadata → Kijiji phone tab → move-in/map-switch flow.
- **Track D (Doors & building shell):** door-in-plain-wall holes → frame/pane split →
  curtain-wall façade + balcony provisions → simplified 3D exterior.

Track D ships first where it blocks map authoring (the designer wants to build the new maps with
the improved door system); Track R's schema (R1) can start immediately in parallel since it does
not touch walls/doors.

Everything stays data-driven: every new knob is a JSON field with a tool UI. All new gameplay
timing runs on sim-time `sdt`. Side effects (move-in completion) fire only on completion, never
on cancellation.

---

## 2. Track R — Rental system ("Kijiji")

### R1 — Map rental/ad schema + Map Editor card
**What:** per-map `rental` block in `data/maps/*.json`:
```jsonc
"rental": {
  "listed": true,                  // appears in Kijiji at all
  "adTitle": "Cozy studio near the docks",
  "adText": "Fake-ad flavor text the designer writes freely.",
  "adImage": "ads/studio.jpg",     // optional, under public/ (drop-in like textures/icons)
  "areaM2Override": null,          // optional; DEFAULT = computed from floor polygons (see below)
  "rentPriceOverride": null,       // optional; DEFAULT = finance.json rent formula (propertyType + floor tiles) — single source of truth
  "availability": { /* Condition tree */ },  // REUSES the quest Condition system verbatim
  "moveInHours": 48                // sim-time hours between renting and the actual move
}
```
- **m²** is computed from the map's floor polygons (shoelace area; `game/textures.ts`'s
  `polygonBounds` precedent shows floors are already treated geometrically) with a sparse
  override. Shown on **every** ad.
- **Rent price** comes from the existing `data/finance.json` rent formula so Kijiji and the
  bills system can never disagree; sparse override for special apartments. Shown **only when
  available**.
- **Availability** is a standard Condition tree (quests done, `simstate` vars like `job`/
  `income`, `creditScore`, `visaStatus` — the quest condition vocabulary already covers these
  namespaces; extend the evaluator only if a var is missing). The ad **never displays the
  conditions** — an unavailable listing renders the ad + "Not available yet" instead of the
  price/rent button.
- Map Editor gets a "Rental ad" card: listed toggle, title/text/image, overrides, moveInHours,
  and the same condition-builder UI the Quest Editor uses (import/share, don't reimplement).
- Tests: pure area computation; map-editor jsdom round-trip (fixtures must stay self-deriving).

**Agent: Claude (Opus).** Schema + tool card + condition-builder reuse; well-precedented but
touches the condition builder, so not a Sonnet task.

### R2 — Pure listing/availability logic (`game/rental.ts`)
**What:** headless module: given all maps + EvalContext (quest state, simstate, credit, visa),
produce the listing view-model: `{ mapId, title, text, image, areaM2, available, rentPrice? ,
statusLabel }`. Price omitted when unavailable; "Not available yet" label supplied here so the
UI stays dumb. Full pure test suite (`test/rental.test.ts`): condition gating per input (quest /
job / credit / visa), price visibility, m² fallback vs override.

**Agent: Claude (Sonnet).** Pure logic with clear spec and strong precedents (visas.ts,
work.ts) — ideal Sonnet slice.

### R3 — Kijiji phone tab (UI)
**What:** new tab in the phone (game/phone.ts precedent: jobs/applications/bills tabs). Renders
R2's view-model: ad cards (image, title, text, m² always; price + "Rent" button only when
available; "Not available yet" chip otherwise). Theme-aware (theme.json component vars). The
current home is marked "current"; renting is disabled while a move is already pending.
Tests: phone/hud jsdom smoke extension.

**Agent: Claude (Opus).** UI integration across phone + theme systems.

### R4 — Rent → move-in → map switch
**What:** the cross-cutting slice.
- "Rent" starts a **pending move**: sim-time countdown of `moveInHours` (progress surfaced on
  the Kijiji tab + a quest-style toast on completion). Cancelable until it completes; completion
  is the only thing that switches maps (side-effect rule).
- **Map switch at runtime:** rebuild world/nav/doors/lights from the new map file (boot already
  builds everything from `data.map`; this slice makes that re-entrant): teleport sim to the new
  spawn, keep needs/skills/personality/funds/visa/job/credit, drop map-bound runtime state
  (accidents, placed-transient overrides, carried-food target refs), rebake nav, re-apply
  environment score, restart map music.
- **Which map is "home":** must NOT write `data/maps/*` and must not silently rewrite
  `tuning.map.active` (that is designer configuration). **DECIDED (§6.1):** a `simstate.json`
  designer-visible var (`homeMap`) the engine reads at boot, with `tuning.map.active` as
  fallback — survives reloads today without a save system and degrades cleanly into the future
  save system.
- Rent becomes the bills system's rent basis for the new home (finance formula already reads
  propertyType + floor tiles — verify it re-reads after the switch).
- Tests: pure countdown/completion logic; map-switch smoke (nav rebaked, spawn applied,
  sim stats preserved) headless where possible.

**Agent: Codex.** Runtime world rebuild touches boot wiring, nav, accidents, buy-mode overrides,
finance, music — the highest-risk slice in this plan.

### R5 — Designer authoring pass (no agent)
Fake ads (title/text/photos in `public/ads/`), availability conditions, moveInHours per map,
new maps themselves. Blocked on R1 (schema+tool) only.

---

## 3. Track D — Doors, walls, façades, exteriors

### D1 — Door-in-plain-wall (boolean hole, Sims-style)
**What:** stop splitting walls to fit doors. A door instance is placed ON a continuous wall;
new sparse boolean on the door instance (e.g. `cutsWall: true`, default true for doors):
- **Nav:** door cells become walkable pass-throughs exactly as today's gap-doors (trigger
  distance etc. unchanged — `tuning.doors` still rules).
- **Visual:** the wall mesh is built AROUND the aperture at render time — split into left
  segment / right segment / lintel above the door height (three boxes sharing the wall's
  material set incl. per-side textures + the B10-1 black top). NO CSG library; pure box
  arithmetic in `world.ts`'s wall loop, driven by the doors that reference that wall.
  Aperture = the DOOR ASSET's real width/height (from its footprint/meshFit or explicit
  `door.apertureWidth/Height` fields) so "my door asset is not exactly 1m/full-height" stops
  mattering: the hole matches the asset, the asset always fits.
- **Data migration:** existing maps keep working — gap-encoded walls remain valid; the Map
  Editor's door tool gains "place on wall" mode writing the new form. No auto-rewrite of
  designer maps.
- Tests: pure aperture/segment math (new `game/wallcut.ts`-style pure helper + suite);
  map-editor round-trip; nav pass-through.

**Agent: Codex.** Geometry + nav + editor + migration interplay; subtle and regression-prone
(this quarter's seat saga says: give the nav-adjacent work to Codex with explicit regression
fixtures).

### D2 — Frame/pane split (only the pane swings)
**What:** door AssetDef grows `door.paneNode` (name of the pane node inside the GLB) or a pair
of meshes (`mesh` = frame, `door.paneMesh` = pane) — support BOTH: named-node split for single
GLBs, two-mesh combine for separate assets "combined in one 3D in the viewer". `game/doors.ts`
pivots ONLY the pane object (hinge on the pane's edge, not the asset center); frame stays
static. Asset Editor: fields + the character/preview shows the pane opening (reuse preview
animation loop). Fallback: no pane configured = whole asset pivots (today's behavior, zero
breakage).
Tests: doors pure suite extension (pivot target selection), asset-editor jsdom.

**Agent: Codex** (door pivot math + GLB node handling), with the Asset Editor field UI eligible
to split off to **Claude (Sonnet)** if Codex's diff leaves the tool side thin.

### D3 — Curtain-wall façade + balcony provisions (schema now, visuals simple)
**What:** provisions, not a full façade system:
- Wall schema: `walls[].kind: "solid" (default) | "curtainWall"` — curtain wall renders as
  transparent glazing (windowPane material precedent) with simple mullion boxes at a tunable
  spacing (`tuning.facade.mullionSpacingMeters`); still cuttable by the wall-cut view; black
  top per B10-1.
- Balcony door = a normal D1/D2 door on a curtain wall (no special casing).
- Balcony = ordinary floor polygon OUTSIDE the interior + `floors[].outdoor: true` (nav walkable,
  no rent-tile counting if finance counts interior only — verify) + railing as a regular
  placed asset (designer supplies mesh later).
- Map Editor: wall-kind dropdown, floor outdoor checkbox.
Tests: map-editor round-trips; finance tile-count exclusion pure test.

**Agent: Claude (Opus).** Mostly schema + material work on well-trodden paths; D1 must land
first (balcony doors depend on it).

### D4 — Simplified 3D exterior environment
**What:** per-map `exterior` block (all sparse — absent = today's void):
```jsonc
"exterior": {
  "skyColor": "#87b7e0",           // or gradient pair
  "groundColor": "#4a7c46",        // large ground plane far below/around
  "backdrop": "city_lowpoly.glb",  // optional single mesh OR billboard image ring, under public/
  "backdropDistance": 60,
  "fog": { "color": "#cfd8e3", "near": 40, "far": 120 }   // cheap depth cue, optional
}
```
Rendered outside the apartment (reference screenshot = Sims-style city backdrop, but
simplified: one ground plane + one distant mesh/billboard set + fog; NO simulation, no LOD
system). Never blocks nav; excluded from wall-cut logic; day/night tint hooks into the existing
`applyDayNight`. Tuning Editor/Map Editor exposure for the block.
Tests: pure config-resolution helper; boot smoke with and without the block.

**Agent: Claude (Opus)** for the render layer (visuals on clear precedents: loading background,
day/night, windowPane material). Escalate to **Codex** only if the backdrop/day-night
interaction turns out hairy.

---

### D5 — 3D map builder (designer addition, 2026-07-16)
**What:** the Map Editor gains a real 3D view of the map being built, in two stages so value
lands early and risk stays contained:

- **D5a — live 3D preview pane (read-only).** A second canvas in `tools/map.html` rendering the
  CURRENT map through the game's OWN builders (`buildWorld`, `buildDoors`, wall/floor textures,
  D1 door apertures, D3 curtain walls, D4 exterior when present — imported, never reimplemented,
  same rule as the Asset Editor preview). Orbit/pan/zoom (OrbitControls precedent), wall-cut
  toggle mirroring the in-game view, selection sync: clicking an object/wall/floor in the 2D
  editor highlights it in 3D. Every 2D edit re-renders (schedulePreview debounce precedent).
  This alone removes most of the guess-save-reload loop from map authoring.
- **D5b — 3D editing.** Direct manipulation in the 3D pane: click-select, grid-snapped drag to
  move placed objects (0.5 grid / 0.25 snap via existing snapping logic), rotate hotkey/gizmo,
  wall drawing on the ground plane, door/window placement onto walls (D1's on-wall form),
  floor-rect painting. All edits write through the SAME inline-script editor state and undo
  stack as the 2D tools (`window.MapEditor` remains the single source of truth — the 3D pane is
  another view, never a second data path). jsdom-testable logic stays in the inline script
  (picking math, snap conversions as pure helpers); three.js raycasting lives in the module
  script.
- Keeps the 2D editor fully functional — the designer chooses per task; nothing is removed.

Ships after D1 (door apertures must render truthfully) and ideally after D3/D4 so the preview
shows façades/exteriors; D5a can start as soon as D1 lands.

**Agents: D5a Claude (Opus)** (read-only render pane on strong precedents — Asset Editor
preview did exactly this pattern); **D5b Codex** (3D picking/drag/undo integration across two
views is the same regression-prone territory as the door geometry work).


## 4. Execution order & dependency graph

```
R1 (Opus)  ──►  R2 (Sonnet) ──►  R3 (Opus) ──►  R4 (Codex) ──► R5 (designer)
D1 (Codex) ──►  D2 (Codex[+Sonnet]) ──►  D3 (Opus) ──►  D4 (Opus)
     │          (D1 also unblocks designer map-building for R5)
     └────►  D5a 3D preview pane (Opus) ──►  D5b 3D editing (Codex)
             (D5a best AFTER D3/D4 so façades/exteriors render, but only REQUIRES D1)
```
- Start in parallel: **R1 + D1** (disjoint files: maps-schema/tool card vs walls/doors/nav).
- Never run two agents in the same files concurrently; docs (PROJECT_CONTEXT/ROADMAP/handoff)
  are updated by the coordinator after each slice, per this batch's established workflow.
- R4 is deliberately LAST in Track R: it needs R1-R3 shipped and benefits from D1-D2 being
  stable (map switch rebuilds doors).

## 5. Agent assignment summary

| Slice | Task | Agent | Why |
|---|---|---|---|
| R1 | Rental schema + Map Editor ad card | Claude Opus | Tool + condition-builder reuse |
| R2 | Pure listing/availability logic | Claude Sonnet | Pure, well-specified, strong precedents |
| R3 | Kijiji phone tab UI | Claude Opus | Phone/theme integration |
| R4 | Rent → move-in → runtime map switch | **Codex** | Cross-cutting world/nav/finance rebuild, highest risk |
| R5 | Ads, conditions, new maps | Designer | Authoring |
| D1 | Door hole in plain wall (boolean) | **Codex** | Wall geometry + nav + editor migration |
| D2 | Frame/pane split, pane-only swing | **Codex** (tool UI may split to Sonnet) | GLB node/pivot math |
| D3 | Curtain wall + balcony provisions | Claude Opus | Schema/material on precedents; needs D1 |
| D4 | Simplified 3D exterior | Claude Opus (Codex fallback) | Render-layer visuals |
| D5a | Map Editor 3D preview pane (read-only) | Claude Opus | Asset-Editor-preview pattern on the map |
| D5b | 3D map editing (pick/drag/draw) | **Codex** | Two-view editing + undo integration, regression-prone |

## 6. Decisions — RESOLVED (designer approved the recommendations, 2026-07-16)

1. **R4 home-map persistence:** `simstate.json` designer-visible var (`homeMap`), engine reads it
   at boot with `tuning.map.active` as fallback; folds into the future save system.
2. **D1 aperture source:** explicit `door.apertureWidth/Height` fields with footprint-derived
   defaults — designer can fix a badly-sized GLB without re-exporting.
3. **Finance & balconies (D3):** rent tiles EXCLUDE `outdoor: true` floors.
4. **Kijiji naming:** in-game brand string lives in data (phone config), not code.

## 7. What this plan explicitly does NOT include

- The save system (designer: waiting for main features first). R4's home-map decision is made
  save-compatible but no save/load surface is built here.
- Multi-floor buildings, elevators, neighbors, or any exterior simulation.
- Auto-migration of existing maps to the D1 door form (both forms stay valid).

---

## D1 — SHIPPED (2026-07-16/17)

As-built: pure `game/wallaperture.ts` (aperture sizing: AssetDef.door.apertureWidth/Height > footprint x meshFit x-scale > entry width > 1.0m default; height default 2.1m x meshFit y-scale, shared constant with doors.ts DOOR_HEIGHT). ON-WALL doors are matched GEOMETRICALLY (point-on-wall within 0.2m tolerance, orientation axis match — no wall index reference, mirroring the windows precedent, so wall edits never dangle), legacy gap doors match no wall and render byte-identically. Walls rebuild as solid/lintel box segments (overlapping apertures merged; aperture >= wall height = full-height cut, no lintel); every segment keeps per-side textures with per-segment repeat + shared black top; wall-cut view scales solids, HIDES lintels (window precedent). Nav carve honors cutsWall:false (decorative doors). Map Editor: click-a-wall door placement, cutsWall checkbox, live aperture readout via window.ApertureBridge (real apertureSizeFor); Asset Editor Door card gained apertureWidth/Height. Suites: test/wallaperture.test.ts + extended doors/nav/map-editor/asset-editor.

## R1 — SHIPPED (2026-07-17)

As-built: sparse MapData.rental (RentalConfig: listed, adTitle/adText/adImage, areaM2Override, rentPriceOverride, availability = quest Condition tree, moveInHours). m2 default = pure shoelace polygonArea/floorsAreaM2 in game/textures.ts (test/area.test.ts); rent default stays finance.json via computeFinancePreview (referenced, not duplicated — R2 wires it). Brand string tuning.phone.rentalTabName ("Kijiji"). Quest Editor's condition builder EXTRACTED to shared tools/condition-builder.js (window.ConditionBuilder; quests.html delegates, map.html Rental card reuses — no second builder). Map Editor "Rental ad (Kijiji)" card with live computed-m2 readout via window.AreaBridge.

## R2 — SHIPPED (2026-07-17)

As-built: pure game/rental.ts listRentals(ctx) -> RentalListing[] {mapId,title,text,image,areaM2,available,rentPrice?,statusLabel,moveInHours,isCurrentHome}. Availability via quests.ts isActionAvailable (absent = available); rent via bills.ts computeFinancePreview; m2 via textures.ts floorsAreaM2; overrides win. Price only when available; labels themeable (DEFAULT_RENTAL_LABELS, overridable). Unlisted/absent-rental excluded. test/rental.test.ts (35 checks).
