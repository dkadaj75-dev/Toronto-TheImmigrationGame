// data.ts — single entry point for the "databases" (design pillar #2: data-driven everything).
// Loads data/*.json and, in dev, polls for changes so tuning edits hot-reload into a running game.

export interface NeedDef { id: string; name: string; color: string; default: number; decayPerTick: number; autonomy: boolean; computed?: string; }
export interface SkillDef { id: string; name: string; color: string; default: number; max: number; enabled?: boolean; }
/** ROADMAP_NEXT item 10: a new designer-editable stat family alongside needs/skills — static
 *  personality TRAITS (no decay, no gains; §2c's Tuning Editor add/remove pattern extends to this
 *  family the same way it already covers needs/skills). `color` is optional since the HUD has no
 *  personality bars yet (traits are static, nothing to visualize live today — see stats.ts). */
export interface PersonalityDef { id: string; name: string; color?: string; default: number; max: number; }
/** `personality` is optional so pre-existing StatsData fixtures/tests (several construct a literal
 *  `{needs, skills}` with no third family) stay valid — same precedent as `TuningData.interaction?`
 *  etc. Absent = no personality traits defined; game code treats it as `[]`. */
export interface StatsData { needs: NeedDef[]; skills: SkillDef[]; personality?: PersonalityDef[]; }

export interface ActionDef {
  id: string; name: string;
  needGains: Record<string, number>;
  skillGains: Record<string, number>;
  animation: string;
  autonomyEligible: boolean;
  primaryNeed: string | null;
  seatAware?: boolean;
  /** B4-2: sparse action-start charge. The tap menu shows and disables this action against the
   *  live QuestRunner funds balance; QuestRunner.spend performs the authoritative deduction. */
  cost?: number;
  /** ROADMAP_NEXT item 5: optional completion timer, sim-time seconds (same clock as
   *  needsDecayTickSeconds/activityGainTickSeconds — pause/2x/3x affect it identically, see
   *  game/main.ts's `sdt`). Absent = current behavior (runs until primaryNeed satisfied or
   *  cancelled). When present, the action ALSO auto-completes after this many seconds even if
   *  primaryNeed never fills (e.g. "cook", whose primaryNeed is null and therefore never
   *  auto-stopped on its own before this field existed). `skillVar` ("skills.<id>", the same
   *  namespace as game/quests.ts's resolveVar) + `atMaxSeconds` together lerp the duration from
   *  `baseSeconds` (skill at 0) to `atMaxSeconds` (skill at its own `max`) via the skill's current
   *  value; either one absent falls back to a fixed `baseSeconds`. See game/duration.ts.
   *
   *  `modifiers` (ROADMAP_NEXT B2-5): sparse array of ADDITIONAL multipliers stacked onto the
   *  base/lerped seconds above — each entry lerps a MULTIPLIER (not seconds) from `atMin` (the
   *  named var at 0) to `atMax` (the var at its own max — a skill's `max` from stats.json, or 100
   *  for any `needs.<id>`, since needs are always clamped 0..100, see game/stats.ts), then
   *  multiplies it onto the running total. `var` reuses the exact same "skills.<id>"/"needs.<id>"
   *  namespace as `skillVar`/quest conditions. An unresolvable var (unknown id, missing value)
   *  contributes a no-op ×1, same "unknown id → safe no-op" convention as skillVar/quests. See
   *  game/duration.ts's computeDurationSeconds. Ships on extinguish (intelligence + energy) and
   *  clean_up/sweep/mop (energy only) — see data/interactions.json. */
  duration?: { baseSeconds: number; skillVar?: string; atMaxSeconds?: number; modifiers?: { var: string; atMin: number; atMax: number }[] };
  /** ROADMAP_NEXT item 7 (audio): path under public/sounds/ (or any /public path) that loops for
   *  as long as the SIM is performing this action, regardless of which asset it targets — see
   *  game/audio.ts's module doc comment for why this is a separate semantic from AssetDef.sound
   *  (asset sound wins if both are set on the same activity). Absent = no action-driven loop. */
  sound?: string;
  /** ROADMAP_NEXT item 10 (garbage/tidying): a transient asset id (e.g. "dirty_dishes") spawned
   *  when this action stops, UNLESS the waste-handling decision (game/garbage.ts's
   *  decideWasteHandling) auto-tidies it into a nearby garbage can instead. Absent = this action
   *  produces no waste. See game/garbage.ts's module doc comment for the full decision flow. */
  producesWaste?: string;
  /** ROADMAP_NEXT B2-1: optional availability gate, reusing the EXACT quest condition tree/
   *  namespace/evaluator (game/quests.ts's `Condition`/`evaluate` — needs.<id>, skills.<id>, funds,
   *  time.hour/day, vars.<name>, quests.<id>.state). Absent = always available (sparse, same
   *  convention as `duration`/`seatAware`). Unmet → the action is hidden from the tap action menu
   *  (game/main.ts's tap handler) and skipped as an autonomy candidate (game/autonomy.ts's
   *  `maybeAct`) — both evaluated against a freshly-built EvalContext at decision time (menu-open /
   *  each autonomy scan), never cached, so a condition becoming true mid-game is picked up
   *  immediately. Ships on `leave_for_work`: `{ all: [{ var: "vars.job", neq: null }] }` — hidden
   *  until a future job system sets `vars.job` away from its `simstate.json` default of `null`. */
  conditions?: Condition;
  /** ROADMAP_NEXT B2-3: Sims-style censor pixelation over the sim while this action is the
   *  active one — game/censor.ts's live camera-facing quad, shown/hidden purely by polling
   *  `agent.current?.action.censor` each render frame (no onActionStart/Stop event needed; that
   *  also means EVERY stop path — natural, cancel, override — hides it uniformly for free, same
   *  precedent as accidents.ts's "onActionStop fires for every stop reason" doc comment). Sparse,
   *  absent = false = never censored. Ships true on `shower`/`use_toilet` only. */
  censor?: boolean;
}
export interface InteractionsData { actions: ActionDef[]; }

export interface AssetDef {
  id: string; name: string; category: string; mesh: string;
  buyPrice: number; sellPrice: number; environmentScore: number;
  footprint: [number, number]; seats?: number;
  interactions: string[]; seatTarget?: boolean;
  /** Model-local facing yaw in degrees; absent = 0. PROJECT_CONTEXT.md §7.2 as-built:
   *  world facing = instance.rotDeg + facingDeg, using the SAME "rotation.y=0 → local +Z is
   *  forward" convention world.ts already applies to every placed object and game/sim.ts
   *  applies to the sim's own travel-facing. See game/facing.ts for the consumers. */
  facingDeg?: number;
  /** Whether the future Buy/Sell catalog offers this asset. Absent = true (§7.1). */
  buyable?: boolean;
  /** Catalog thumbnail (§7.6): image path under public/, same drop-in convention as `mesh`.
   *  Absent → the catalog renders a category-colored fallback tile with the asset's initials,
   *  never a broken image. See game/buymode.ts's `iconFallback`. */
  icon?: string;
  /** §7.6 Buy/Sell catalog gate, ties into the §3.3 quest `unlockAsset` reward: when true, the
   *  asset is only purchasable once `QuestRunner.isAssetUnlocked(id)` is true (absent/false =
   *  no quest gate, purchasable as normal subject to `buyable`). See game/buymode.ts. */
  requiresQuestUnlock?: boolean;
  /** F2 repossession priority. Sparse/absent = 0; higher values are seized later. */
  survivalImportance?: number;
  /** Mesh authoring corrections applied by world.ts AFTER normalizeModelToFootprint (§7.1/§7.2).
   *  scale multiplies on top of the automatic footprint-fit scale (uniform or per-axis);
   *  yawOffsetDeg rotates the loaded model in place (fixes a mesh not authored facing the
   *  game's local +Z convention — see facingDeg's doc comment above, which is defined in
   *  terms of the model's orientation AFTER this correction); yOffset nudges the model
   *  vertically post-grounding (e.g. a door needing to sit flush in its frame). */
  meshFit?: { scale?: number | [number, number, number]; yawOffsetDeg?: number; yOffset?: number };
  /** Door-specific block on door-category assets (§7.1). hingeOffset is the rotation-axis
   *  position in the door's CANONICAL model-local frame (local +X = the door's long/swing
   *  axis, local +Z = its thickness axis — the SAME frame regardless of the door's orientation
   *  in the map; game/doors.ts rotates that frame into place per-instance). The other fields
   *  are sparse overrides of tuning.doors (absent = tuning default). See game/doors.ts. */
  /** ROADMAP_NEXT item 9: sparse, absent = false (a normal interior door). An exterior door
   *  never participates in the path-crossing open/close tick (game/doors.ts's DoorInstance.update
   *  skips it entirely, so it stays visually shut) and is instead a tappable INTERACTABLE like any
   *  other asset — its own `interactions` (AssetDef.interactions, e.g. a future "go to work")
   *  surface in the tap menu via the SAME userData.assetId mechanism world.ts uses for furniture;
   *  doors.ts sets that userData on the door's hinge pivot only when exterior is true, so interior
   *  doors stay non-tappable exactly as before this field existed. */
  door?: { hingeOffset: [number, number]; openAngleDeg?: number; openSeconds?: number; closeSeconds?: number; triggerDistance?: number; exterior?: boolean };
  /** Accident-category assets ONLY (§7.3): action ids whose completion on the accident
   *  instance despawns it (e.g. fire's clearedBy: ["extinguish"]). See game/accidents.ts. */
  clearedBy?: string[];
  /** Normal (non-accident) assets ONLY (§7.3): which accidents can spawn from using this
   *  asset, and how likely. See game/accidents.ts for the roll/placement/hierarchy logic. */
  accidents?: AccidentRisk[];
  /** Only meaningful when `mesh` points at an image (`.png`/`.jpg`/`.jpeg`/`.webp`/`.gif`) rather
   *  than a GLB — game/sprites.ts's classifyMeshPath detects this by extension, no separate flag
   *  needed (§7.5). orientation: "billboard" (default, always faces the camera — fire, smoke) or
   *  "flat" (lies on the floor — puddles, debris, scorch marks). fps overrides an animated GIF's
   *  own per-frame delays if set. See game/sprites.ts. */
  sprite?: { orientation?: 'billboard' | 'flat'; fps?: number };
  /** Designer-editable sit/lie perch override (§7.8, roadmap item 1 fix). Sparse per-pose: any
   *  field left unset falls back to the computed default (see game/facing.ts's usePoseFor).
   *  `offset` is MODEL-LOCAL [x,z] meters from the footprint center, rotated by the placed
   *  instance's rotDeg (the same "rotation.y=0 → local +Z is forward" convention facingDeg
   *  uses elsewhere in this file) — NOT worldFacingDeg, since an offset is a placement nudge,
   *  not a direction. `y` overrides the perch height (absent = tuning.character.sitHeight/
   *  lieHeight, same constants used before this field existed). `facingDeg` is model-local like
   *  AssetDef.facingDeg (world facing = instance.rotDeg + this) and overrides the default facing
   *  (worldFacingDeg(instance, def) — for a bed this already points along its long axis, since
   *  footprint depth is local Z, the same axis facingVector treats as "forward").
   *
   *  `use` (ROADMAP_NEXT B2-3, "stand INSIDE the shower"): same UsePoseEntry shape, for STANDING
   *  actions (animation prefix neither "sit" nor "lie", e.g. "stand_use") on this asset. Unlike
   *  sit/lie, there is NO computed default when `use` is absent — a generic standing action
   *  (cooking at a stove, using a sink) keeps its existing walk-up-and-face-it approach spot
   *  (useSpotFor, just outside the footprint edge), which already makes sense for furniture the
   *  sim stands IN FRONT OF. Only assets that explicitly define `usePose.use` (the shower, so the
   *  sim stands INSIDE its footprint instead of in front of it) opt into the snap — see
   *  game/sim.ts's applyPose and game/facing.ts's usePoseFor. */
  usePose?: { sit?: UsePoseEntry; lie?: UsePoseEntry; use?: UsePoseEntry };
  /** ROADMAP_NEXT item 6 (fire spreading): sparse, normal assets only. `chancePercent` is rolled
   *  ONCE per (fire instance, this object) pair, `delaySeconds` after the fire's own spawn time,
   *  provided this object is within `tuning.fire.spreadRadius` of it — see game/accidents.ts's
   *  `spreadShouldRoll`. Absent = never catches fire from a nearby blaze. */
  combustibility?: { chancePercent: number; delaySeconds: number };
  /** ROADMAP_NEXT item 7 (audio): path under public/sounds/ (or any /public path) that loops for
   *  as long as an action targets THIS PLACED INSTANCE (e.g. a TV's hum, a shower's running-water
   *  noise) — keyed per-instance in game/audio.ts so two placed TVs each get their own independent
   *  loop. Wins over the target action's own `sound` if both are set (see game/audio.ts). Absent =
   *  no asset-driven loop. */
  sound?: string;
  /** ROADMAP_NEXT item 10 (garbage/tidying): sparse, ships on the garbage-can asset only. Real
   *  capacity — once `capacity` waste units have been deposited (game/garbage.ts's GarbageRegistry
   *  fill count, keyed per placed instance), the can counts as full and is excluded from
   *  findNearestNonFullCan until emptied (the exterior door's `empty_garbage` interaction resets
   *  every can to 0 — see game/garbage.ts). */
  garbage?: { capacity: number };
  /** B4-2: transient food payload. hungerGain is applied once, only when eating completes;
   *  perishHours uses the monotonic in-game-hour clock after interrupted food is dropped. */
  food?: { hungerGain: number; perishHours: number };
}
export interface UsePoseEntry { offset?: [number, number]; y?: number; facingDeg?: number; }
export interface AssetsData { categories: string[]; assets: AssetDef[]; }

/** One risk modifier: linear interpolation of a percentage-point contribution from `pctAt0`
 *  (the referenced stat at 0) to `pctAtMax` (the stat at its max) — §7.3. `var` uses the SAME
 *  condition namespace as quests (`needs.<id>`, `skills.<id>` — game/quests.ts's resolveVar). */
export interface AccidentRiskModifier { var: string; pctAt0: number; pctAtMax: number; }

/** Per-asset accident risk config (§7.3). `trigger` is a union of one today ("onUse", rolled
 *  once when a sim finishes using the asset) — the union shape leaves room for future triggers
 *  (time-based, idle) per the locked spec without a schema break. */
export interface AccidentRisk {
  accidentId: string;
  trigger: 'onUse';
  baseChancePercent: number;
  placement: 'on' | 'adjacent';
  /** grid-cell distance range for "adjacent" placement, e.g. [1,2] = 1–2 squares away. */
  adjacentRange?: [number, number];
  modifiers?: AccidentRiskModifier[];
}

/** Designer-defined sim-state variable (PROJECT_CONTEXT.md §3.1). `funds` is a separate built-in
 *  namespace (seeded from tuning.economy.startingFunds) and is NOT one of these. */
export interface VarDef { id: string; name: string; type: 'string' | 'number' | 'boolean'; default: string | number | boolean | null; }
export interface SimStateData { variables: VarDef[]; }

/** Quest condition tree (§3.2). Operators are mutually exclusive per leaf; combinators nest. */
export interface ConditionLeaf {
  var: string;
  gte?: number;
  lte?: number;
  eq?: string | number | boolean | null;
  neq?: string | number | boolean | null;
}
export interface ConditionAll { all: Condition[]; }
export interface ConditionAny { any: Condition[]; }
export type Condition = ConditionLeaf | ConditionAll | ConditionAny;

export type QuestState = 'locked' | 'active' | 'done';

export interface RewardFunds { type: 'funds'; amount: number; }
export interface RewardSetVar { type: 'setVar'; var: string; value: string | number | boolean; }
export interface RewardUnlockAsset { type: 'unlockAsset'; asset: string; }
/** PROJECT_CONTEXT.md §7.20 B3-6: goes through the visa state machine (game/visas.ts) instead of
 *  a raw setVar — bookkeeping (expiry reset, grace clear) happens, not just the mirrored var. The
 *  existing `setVar visaStatus` reward still works (per §7.20: "KEEPS working but bypasses expiry
 *  bookkeeping") for quick/legacy authoring; this is the one that should be used going forward. */
export interface RewardGrantVisa { type: 'grantVisa'; statusId: string; }
export type Reward = RewardFunds | RewardSetVar | RewardUnlockAsset | RewardGrantVisa;

export interface QuestDef {
  id: string; name: string; description: string;
  trigger: Condition;
  completion: Condition;
  rewards: Reward[];
  onceOnly: boolean;
}
export interface QuestsData { quests: QuestDef[]; }

/** Visa/status definition (PROJECT_CONTEXT.md §7.20 V1, data/visas.json). `durationDays: null` =
 *  permanent (never expires — permanent_resident/citizen). `losable`+`graceDays` = on expiry the
 *  runtime VisaMachine (game/visas.ts) opens a grace window instead of an immediate game over.
 *  `obtainedVia`/`requirements`/`applicationDays` only matter for non-start statuses granted by a
 *  quest reward (`grantVisa`) or a V2 phone application; the start status (tuning.visa.startStatus)
 *  has none of them, so all three are optional (spec's own schema line marks obtainedVia
 *  non-optional, but the start status has no "via" — deliberate deviation, documented here). */
export interface VisaDef {
  id: string; name: string;
  durationDays: number | null;
  losable?: boolean;
  graceDays?: number;
  obtainedVia?: 'quest' | 'application';
  requirements?: Condition;
  applicationDays?: number;
}
export interface VisasData { visas: VisaDef[]; }

/** Smartphone job listings (PROJECT_CONTEXT.md §7.20 V2, data/jobs.json). Requirements reuse the
 * quest condition namespace/evaluator; `grantsVisa`, when present, must go through VisaMachine. */
export interface JobDef {
  id: string;
  name: string;
  requirements?: Condition;
  grantsVisa?: string;
  hours: { startHour: number; endHour: number };
  payPerShift: number;
  maxSkips: number;
  /** F3 sparse credit gate. Absent means the job has no credit-score requirement. */
  minCreditScore?: number;
  /** Positive amounts subtracted from matching needs when the sim returns from a completed shift. */
  needsCost?: Record<string, number>;
}
export interface JobsData { jobs: JobDef[]; }

/** Recurring household bill identity/display list (PROJECT_CONTEXT.md §7.24 F1, data/bills.json).
 *  Amounts are snapshotted from FinanceData formulas when a bill cycle arrives. */
export interface BillDef { id: string; name: string; }
export interface BillsData { bills: BillDef[]; }

export type PropertyType = 'condo' | 'basement' | 'townhouse' | 'house' | 'penthouse';
export interface FinanceData {
  rent: {
    base: number;
    perFloorTile: number;
    byPropertyType: Record<PropertyType, number>;
  };
  bills: { id: string; name: string; base: number; perAssetValue: number }[];
  overdueDays: number;
  tooLateDays: number;
  negativeGraceDays: number;
}

/** F3 credit-score tuning. Deltas are signed designer-authored score changes. */
export interface CreditTuning {
  min: number;
  max: number;
  startingScore: number;
  onTimePaymentDelta: number;
  overdueDelta: number;
  debtEntryDelta: number;
  debtDailyDelta: number;
  repoDelta: number;
  lowScoreDebtWindowFactor: number;
  highScoreDebtWindowFactor: number;
  historyLimit: number;
}

export interface MapData {
  id: string; name: string; gridSize: number;
  /** Designer placement increment in meters. Independent from nav/tile cell size; absent maps
   *  default to 0.25m so changing gridSize never silently changes object placement precision. */
  snapStep?: number;
  /** Finance rent category; old/hand-authored maps without it are treated as condos. */
  propertyType?: PropertyType;
  bounds: { w: number; h: number };
  floors: { id: string; polygon: [number, number][]; material: string }[];
  walls: { from: [number, number]; to: [number, number] }[];
  doors: { at: [number, number]; orientation: 'vertical' | 'horizontal'; width?: number; assetId?: string }[];
  /** ROADMAP_NEXT item 9: wall openings that are purely visual — a window never affects the nav
   *  grid or wall collision (the wall segment it sits on stays a single unbroken box, unlike a
   *  door which needs its own gap encoded as separate wall segments in `walls[]`; "the opening is
   *  visual, above walk height" — see game/windows.ts). Optional so pre-existing maps without a
   *  `windows` key stay valid (mirrors `music?`'s precedent above). `at`/`orientation`/`width` use
   *  the SAME convention as a door entry (a point on a wall + which way the wall runs); `assetId`
   *  optionally names a window-category asset for a future real mesh (§ shipped `window_basic`
   *  carries no consumed mesh yet — see game/windows.ts's doc comment). */
  windows?: { at: [number, number]; orientation: 'vertical' | 'horizontal'; width?: number; assetId?: string }[];
  spawn: { pos: [number, number]; facingDeg: number };
  placedObjects: { asset: string; pos: [number, number]; rotDeg: number }[];
  /** ROADMAP_NEXT item 7 (audio): playlist of paths under public/sounds/ (or any /public path) that
   *  this map's music context cycles through (advances to the next entry when one finishes — see
   *  game/audio.ts's module doc comment). Absent/empty = silence while this map is active. */
  music?: string[];
}

/** Rigged character setup — all of it data, so a different GLB export is a JSON edit. */
export interface CharacterTuning {
  /** GLB with skinned mesh + animation clips (leading-slash path under public/) */
  meshPath: string;
  /** model is uniformly scaled so its bounding height equals this (meters) */
  heightMeters: number;
  /** extra yaw if the model doesn't face +Z (the game's travel-facing convention) */
  yawOffsetDeg?: number;
  /** cross-fade duration between clips, seconds */
  crossFadeSeconds: number;
  /** ground speed (units/s) the walk clip was authored at; playback rate = walkSpeed / this */
  walkClipSpeedReference: number;
  /** root height while sitting on a seat / lying on a bed (replaces the old hardcoded 0.25/0.55) */
  sitHeight: number;
  lieHeight: number;
  /** logical state → clip name in the GLB ("idle", "walk", "sit", "lie", any action.animation) */
  clipMap: Record<string, string>;
  /** extra GLBs whose clips are merged in (Mixamo-style one-clip-per-file exports; must share the model's skeleton) */
  animationPaths?: string[];
  /** Sims-style overhead marker (§7.7). All fields sparse/optional — see game/marker.ts's
   *  MARKER_DEFAULTS for the fallback values applied when absent. */
  marker?: MarkerTuning;
}

/** Overhead marker config (PROJECT_CONTEXT.md §7.7). `mesh` goes through the SAME §7.5 extension
 *  detection as any asset (empty/absent → the built-in green octahedron; image → billboard sprite,
 *  GIFs animate on sim time; `.glb` → mesh). See game/marker.ts for defaults/resolution/rendering. */
export interface MarkerTuning {
  mesh?: string;
  yOffset?: number;
  scale?: number;
  spinDegPerSec?: number;
  bobAmplitude?: number;
  bobHz?: number;
}

export interface TuningData {
  simulation: { needsDecayTickSeconds: number; activityGainTickSeconds: number };
  /** B5-1 global positive skill-gain taper. 0 preserves linear gains; larger values make gains
   *  progressively harder near each skill's max. Optional for old fixtures; stats.ts defaults 1.5. */
  skills?: { growthCurveExp?: number };
  autonomy: { seekBelowThreshold: number; stopAtThreshold: number; postPlayerCommandCooldownSeconds: number };
  time: { secondsPerGameDay: number; nightStartHour: number; nightEndHour: number };
  economy: { startingFunds: number; currencyName: string };
  /** F3 credit score, consequences, debt-window scaling, and phone history length. */
  credit?: CreditTuning;
  movement: { walkSpeed: number; arrivalRadius: number };
  /** Optional so pre-existing tuning fixtures/tests stay valid (mirrors the `character?` precedent
   *  below) — game code falls back with `?? <value>` where used (see game/facing.ts). §7.2 as-built:
   *  useSpotClearance = gap beyond the footprint edge for a front-approach stand point;
   *  seatViewDistance = how far in front of a seat-aware target (e.g. the TV) the "viewing point"
   *  sits when ranking candidate seats — ports the Unreal prototype's RightVector·400 constant. */
  interaction?: { useSpotClearance?: number; seatViewDistance?: number; seatSearchRadius?: number };
  /** Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `interaction?`
   *  above). Defaults for AssetDef.door fields when a door instance doesn't override them (§7.1).
   *  triggerDistance is in meters, independent from the map's nav tile size. */
  doors?: { openSeconds?: number; closeSeconds?: number; openAngleDeg?: number; triggerDistance?: number };
  /** ROADMAP_NEXT item 9: defaults for a window's glass-pane stand-in when a map.windows[] entry
   *  doesn't override `width` itself (a per-window sparse field, same convention as a door's
   *  `width`). Optional so pre-existing tuning fixtures/tests stay valid (same precedent as
   *  `interaction?`/`doors?` above). See game/windows.ts's resolveWindowConfig for the hardcoded
   *  fallbacks applied when this whole block is absent. */
  windows?: { width?: number; height?: number; sillHeight?: number };
  /** B6-9 player wall-cut view. Height is meters above the floor; optional for old fixtures. */
  view?: { wallCutHeight?: number };
  /** rotate* fields optional so pre-existing tuning fixtures/tests stay valid (same precedent as
   *  `interaction?`/`doors?` above) — camera.ts falls back to sane defaults when absent.
   *  rotateSpeedDegPerPx: desktop right-drag mouse sensitivity (yaw degrees per pixel of drag).
   *  twistDeadzoneDeg: minimum per-move-event two-finger angle change (degrees) before it's treated
   *  as an intentional twist rather than pinch jitter — must coexist with pinch-zoom in one gesture.
   *  twistSpeed: multiplier applied to the raw two-finger angle delta once past the deadzone. */
  camera: {
    minZoom: number; maxZoom: number; minPitchDeg: number; maxPitchDeg: number; panBoundsPadding: number;
    rotateSpeedDegPerPx?: number; twistDeadzoneDeg?: number; twistSpeed?: number;
  };
  /** quest log HUD tuning (§3 quest system) — no magic numbers in game/quests.ts or ui.ts */
  quests: { toastDurationSeconds: number; completedLogLimit: number };
  /** PROJECT_CONTEXT.md §7.20 B3-6: which data/visas.json id the visa state machine starts on.
   *  Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `interaction?`/
   *  `doors?` above); game/main.ts falls back to "visitor" when absent. */
  visa?: { startStatus: string };
  /** B3-7 phone job-search result count. Optional for old fixtures; game/phone.ts defaults to 3. */
  phone?: { jobListSize?: number; icon?: string };
  /** B3-8 going-to-work speed override. Optional for old fixtures; main.ts defaults to 5. This is
   *  an effective simulation multiplier while away, not a mutation of the player's HUD selection. */
  work?: { autoSpeed?: number };
  /** B4-1 recurring bill arrival cadence in in-game days. */
  bills?: { intervalDays?: number };
  /** Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `interaction?`
   *  above). ROADMAP_NEXT item 6: burnSeconds = how long an unextinguished fire instance burns
   *  before destroying its base object; spreadRadius (meters) = how far a live fire scans for
   *  combustible neighbors each tick. game/accidents.ts falls back to `{30, 2}` when absent. */
  /** ROADMAP_NEXT B2-5: how long (sim-time seconds) the sim plays the 'panic' animation state
   *  whenever a fire spawns (initial risk roll OR spread — see game/accidents.ts's onFireSpawned
   *  hook) before control returns to autonomy — same shape/precedent as `bladderFailure.
   *  durationSeconds` below. game/main.ts falls back to 3 when absent. */
  fire?: { burnSeconds: number; spreadRadius: number; panicSeconds?: number };
  /** Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `fire?` above).
   *  ROADMAP_NEXT item 10 (garbage/tidying): autoTidyRadius (meters) = how close a non-full garbage
   *  can must be to the sim for the sim to walk over and deposit waste itself rather than dropping
   *  a transient; cleanlinessThreshold = the minimum value of the sim's `cleanlinessVar` personality
   *  stat (default id "cleanliness", stats.json's `personality[]` family — see PersonalityDef)
   *  required to bother auto-tidying at all. game/garbage.ts falls back to `{4, 5, "cleanliness"}`
   *  when this whole block (or an individual field) is absent. */
  garbage?: { autoTidyRadius?: number; cleanlinessThreshold?: number; cleanlinessVar?: string };
  /** which map the game plays: data/maps/<active>.json (set from the Map Editor's "Play this map") */
  map?: { active: string };
  /** optional so pre-rig data files & test fixtures stay valid; game falls back to the capsule */
  character?: CharacterTuning;
  /** Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `interaction?`/
   *  `doors?`/`fire?` above). ROADMAP_NEXT item 7 (audio): master/music/sfx volumes (0..1, each
   *  independently clamped) multiply together for a channel's effective gain; musicCrossfadeSeconds
   *  is how long a music CONTEXT switch (map ↔ buy mode) takes to cross-fade; buyModeMusic is the
   *  fixed track for buy mode (absent = silence in buy mode). See game/audio.ts's
   *  resolveAudioTuning for the exact defaults applied when this whole block is absent. */
  audio?: { masterVolume?: number; musicVolume?: number; sfxVolume?: number; musicCrossfadeSeconds?: number; buyModeMusic?: string };
  /** Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `fire?`/
   *  `garbage?` above). ROADMAP_NEXT B2-4 (bladder failure): durationSeconds = how long the sim
   *  plays the 'pee' animation before control returns to autonomy; reliefAmount (0..100) = the
   *  bladder need's value immediately after the accident (a minimal top-up, not a full refill —
   *  the sim likely still wants a real bathroom trip). game/bladder.ts falls back to `{4, 30}`
   *  when this whole block (or an individual field) is absent. ROADMAP_NEXT B3-2: hygieneAfter
   *  (0..100) is the hygiene need's value set (absolute, like reliefAmount is for bladder — not a
   *  delta) immediately after the accident too — "pees itself" should also make the sim dirty.
   *  Defaults to 0 (fully soiled) when absent. */
  bladderFailure?: { durationSeconds?: number; reliefAmount?: number; hygieneAfter?: number };
}

export interface GameData {
  stats: StatsData;
  interactions: InteractionsData;
  assets: AssetsData;
  map: MapData;
  tuning: TuningData;
  simstate: SimStateData;
  quests: QuestsData;
  visas: VisasData;
  jobs: JobsData;
  bills: BillsData;
  finance: FinanceData;
}

const FILES = {
  stats: '/data/stats.json',
  interactions: '/data/interactions.json',
  assets: '/data/assets.json',
  tuning: '/data/tuning.json',
  simstate: '/data/simstate.json',
  quests: '/data/quests.json',
  visas: '/data/visas.json',
  jobs: '/data/jobs.json',
  bills: '/data/bills.json',
  finance: '/data/finance.json',
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadAll(): Promise<GameData> {
  // tuning first — it names the active map (tuning.map.active, default "condo")
  const tuning = await fetchJson<TuningData>(FILES.tuning);
  const mapFile = `/data/maps/${tuning.map?.active ?? 'condo'}.json`;
  const [stats, interactions, assets, map, simstate, quests, visas, jobs, bills, finance] = await Promise.all([
    fetchJson<StatsData>(FILES.stats),
    fetchJson<InteractionsData>(FILES.interactions),
    fetchJson<AssetsData>(FILES.assets),
    fetchJson<MapData>(mapFile),
    fetchJson<SimStateData>(FILES.simstate),
    fetchJson<QuestsData>(FILES.quests),
    fetchJson<VisasData>(FILES.visas),
    fetchJson<JobsData>(FILES.jobs),
    fetchJson<BillsData>(FILES.bills),
    fetchJson<FinanceData>(FILES.finance),
  ]);
  return { stats, interactions, assets, map, tuning, simstate, quests, visas, jobs, bills, finance };
}

/** Dev hot-reload: polls the data files and invokes callbacks when content changes. */
export function watchData(onChange: (data: GameData) => void, intervalMs = 2000): () => void {
  let last = '';
  const tick = async () => {
    try {
      const data = await loadAll();
      const sig = JSON.stringify(data);
      if (last && sig !== last) onChange(data);
      last = sig;
    } catch { /* server briefly unavailable — ignore */ }
  };
  const handle = window.setInterval(tick, intervalMs);
  void tick();
  return () => window.clearInterval(handle);
}
