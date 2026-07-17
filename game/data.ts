// data.ts — single entry point for the "databases" (design pillar #2: data-driven everything).
// Loads data/*.json and, in dev, polls for changes so tuning edits hot-reload into a running game.

export type ThemeAnchor = 'tl' | 'tr' | 'bl' | 'br' | 'tc' | 'bc';
export interface ThemeComponentOverrides {
  fontFamily?: string;
  fontSizePx?: number;
  background?: string;
  foreground?: string;
  accent?: string;
  outline?: string;
  radiusPx?: number;
  outlineWidthPx?: number;
  shadow?: string;
}
export interface ThemeLayoutItem {
  anchor: ThemeAnchor;
  offsetX: number;
  offsetY: number;
  hidden?: boolean;
  accordion?: string;
}
export interface ThemeData {
  fonts: { family: string; sizePx: number };
  colors: {
    panelBg: string; panelFg: string; accent: string; warn: string; error: string;
    buttonBg: string; buttonFg: string; outline: string;
  };
  shapes: { radiusPx: number; outlineWidthPx: number; shadow: string };
  components?: {
    toast?: ThemeComponentOverrides;
    button?: ThemeComponentOverrides;
    panel?: ThemeComponentOverrides;
    actionMenu?: ThemeComponentOverrides;
  };
  layout: Record<string, ThemeLayoutItem>;
  accordions?: { name: string; collapsedByDefault?: boolean }[];
}

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
  /** B10-6: sparse source-first flag for seat-aware fetch actions. The first leg walks to the
   *  action's target/source; only after arrival does main.ts resolve and route to a seat for the
   *  actual activity. This generalizes the carried-food fridge/stove two-leg precedent to
   *  non-food sources such as a bookshelf. Absent = ordinary one-leg seat-aware behavior. */
  fetchBeforeSeat?: boolean;
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
  /** ROADMAP item 2 (meal tiers): sparse per-ACTION override of the food transient this action
   *  spawns (fridge Eat → snack, stove Cook → meal — see game/food.ts foodAssetForActionEvent).
   *  Present fields win over the spawned transient's own AssetDef.food block (the default); absent
   *  fields fall back to it. The B7-2 cooking-skill proportionality (tuning.food) still applies on
   *  top of whichever hungerGain this resolves to. Lets a designer author cook_light_meal /
   *  cook_large_meal (different hungerGain, same `meal` visual) entirely in the Interaction Editor.
   *  See game/food.ts resolveFoodConfig. */
  food?: { hungerGain?: number; perishHours?: number };
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
  /** Designer follow-up (B9-1): sparse, absent/true = current behavior — after a seat-aware
   *  action perches the sim on a seat (or any locomotion arrival), sim.ts's update() rotates the
   *  sim to face this action's TARGET object, overriding whatever facing the seat's own usePose
   *  gave it (right for `watch_tv`: face the TV). Set false to SKIP that rotation and keep the
   *  perch's own usePose facing instead (right for `read_book`: sit on the sofa facing however
   *  the sofa's pose says, not spun around to stare at the bookshelf). See game/sim.ts's
   *  update() arrival block. */
  faceTarget?: boolean;
}
export interface InteractionsData { actions: ActionDef[]; }

export interface AssetDef {
  id: string; name: string; category: string; mesh: string;
  buyPrice: number; sellPrice: number; environmentScore: number;
  footprint: [number, number]; seats?: number;
  /** Whether this asset's placed footprint bakes as UNWALKABLE into the nav grid (game/nav.ts
   *  bakeNavGrid). Sparse: absent = true (blocks — correct for furniture and fire). `false` keeps
   *  the cells walkable, for flat floor sprites a sim should be able to stand on/walk over: puddles,
   *  scorch marks, debris. Only affects map-placed objects; runtime accident instances aren't in the
   *  nav grid at all (they block via accidents.ts's geometric hierarchy, unaffected by this flag). */
  blocksNav?: boolean;
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
   *  terms of the model's orientation AFTER this correction); xOffset/yOffset/zOffset nudge the
   *  model along each world axis post-grounding (e.g. a door needing to sit flush in its frame).
   *  All three offsets are sparse: an absent axis means 0 (no nudge). yOffset predates
   *  xOffset/zOffset (single-axis vertical nudge) and keeps its exact old meaning — the two new
   *  axes are a backward-compatible superset, so old data with only yOffset is unchanged. */
  meshFit?: { scale?: number | [number, number, number]; yawOffsetDeg?: number; xOffset?: number; yOffset?: number; zOffset?: number };
  /** B11-x per-asset need multipliers (sparse, absent = {}): scales the effective per-tick gain of
   *  selected needs while an action is performed ON this asset. effective gain for need N =
   *  action.needGains[N] * (needMultipliers[N] ?? 1). A value >1 makes this asset better than
   *  average for that need, <1 worse, and NEGATIVE values invert it (an awful chair that DRAINS
   *  comfort while sitting). Absent keys default to 1 (no change). Applied identically by the sim
   *  tick (game/stats.ts applyGains) and the autonomy scorer (game/behavior.ts) via the shared
   *  effectiveNeedGain helper, so a luxury sofa genuinely outranks a bad one. */
  needMultipliers?: { [needId: string]: number };
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
  /** apertureWidth/apertureHeight (ROADMAP_APT D1, resolved decision §6.2): the hole an ON-WALL
   *  door cuts through a continuous wall, in meters. Sparse EXPLICIT overrides — absent falls
   *  back to footprint/meshFit-derived defaults (width: footprint[0] x meshFit x-scale; height:
   *  the 2.1m stand-in panel height x meshFit y-scale — see game/wallaperture.ts's
   *  apertureSizeFor), so the designer can fix a badly-sized GLB without re-exporting. */
  /** paneNode/paneMesh (ROADMAP_APT D2, frame/pane split): make ONLY the door PANE swing while the
   *  frame stays static (game/doors.ts). BOTH sparse, both optional — absent = today's behavior
   *  (the whole asset pivots on the authored hingeOffset, zero breakage):
   *   - paneNode: the NAME of the pane node INSIDE this asset's single `mesh` GLB. After the GLB
   *     loads (on the cached-template CLONE — never the cached template itself), the game finds that
   *     node by name, leaves the rest of the model as the static frame, and swings only the pane. If
   *     the name isn't found it warns once and swings the whole asset (today's behavior).
   *   - paneMesh: a SEPARATE GLB (path under public/, drop-in like `mesh`) combined with the frame
   *     `mesh` in one 3D at runtime ("two assets combined in one viewer") — frame + pane are fitted
   *     to the footprint TOGETHER (shared authored coordinate space), then the pane swings. On load
   *     failure the frame stays + a stand-in pane box swings (documented fallback, warns once).
   *  When a pane is configured the hinge is derived from the PANE's own bounds (its swing-side edge,
   *  chosen by the sign of hingeOffset[0]), not the whole asset's center — so the pane pivots about
   *  its real edge regardless of the pane's size/placement inside the model. */
  door?: { hingeOffset: [number, number]; openAngleDeg?: number; openSeconds?: number; closeSeconds?: number; triggerDistance?: number; exterior?: boolean; apertureWidth?: number; apertureHeight?: number; paneNode?: string; paneMesh?: string };
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
  /** Asset loop path. B6-12 assets offering Turn On/Off loop per-instance while ON; legacy assets
   *  without power actions loop while targeted by an action. See audio.ts/assetstate.ts. */
  sound?: string;
  /** B6-12: sparse point-light + per-instance power defaults. Presence emits a THREE.PointLight;
   *  every subfield is optional so the Asset Editor can opt into useful defaults with an empty
   *  object. `defaultOn` seeds AssetStateRegistry the first time an instance is seen. */
  light?: { color?: string | number; intensity?: number; distance?: number; yOffset?: number; defaultOn?: boolean };
  /** B6-13: presence makes placement wall-only. Buy Mode/Map Editor share buymode.ts's pure wall
   *  snap, which faces the asset into the room. heightY is the visual anchor height (default 1.5m). */
  wallMounted?: { heightY?: number };
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

/** B8-1-E utility-autonomy configuration. Rules reuse the quest condition tree verbatim. */
export interface BehaviorRule {
  id: string; name: string;
  action?: string;
  assetCategory?: string;
  assetId?: string;
  conditions?: Condition;
  scoreBonus: number;
  enabled: boolean;
}
export interface BehaviorData {
  weights: { needDeficit: number; distance: number; personalityAffinity: number };
  decisionThreshold: number;
  needWeights?: Record<string, number>;
  rules: BehaviorRule[];
}

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
  /** B6-5 ordered career ladder. Index 0 is the base level; each row's promotion chance advances
   *  to the following row and its pay is snapshotted when a shift starts. */
  levels?: JobLevelDef[];
  /** Deprecated display-only compatibility for old fixtures; runtime progression uses levels[]. */
  level?: string | number;
  /** F3 sparse credit gate. Absent means the job has no credit-score requirement. */
  minCreditScore?: number;
  /** Positive amounts subtracted from matching needs when the sim returns from a completed shift. */
  needsCost?: Record<string, number>;
}
export interface JobLevelDef { suffix: string; payPerShift: number; promoteChancePercent: number; }
export interface JobsData { jobs: JobDef[]; }

/** B6-5 happiness formula. Every component resolves through quests.ts's namespace, is normalized
 *  between its optional min/max (numeric defaults are 0/100), then contributes to a weighted mean. */
export interface HappinessComponent { var: string; weight: number; min?: number; max?: number; }
export interface HappinessData {
  components: HappinessComponent[];
  /** Numeric mapping used only when a component resolves vars.visaStatus's string id. */
  visaStatusRanks?: Record<string, number>;
}

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

/** ROADMAP_APT R1 — per-map rental/ad metadata for the future "Kijiji" phone tab (Track R). The
 *  WHOLE block is sparse (absent = this map is not a rental listing at all), and every field inside
 *  it is sparse too, so pre-existing maps stay valid untouched.
 *
 *  Consumed later by R2's pure listing/availability logic (game/rental.ts) + R3's phone tab; R1
 *  only defines the schema and the Map Editor "Rental ad" card that authors it.
 *
 *  - `listed`: whether this map shows up in Kijiji at all.
 *  - `adTitle`/`adText`: designer-authored fake-ad copy, shown verbatim.
 *  - `adImage`: optional path under public/ (drop-in like textures/icons — the Map Editor
 *     normalizes pasted Windows paths to a leading-slash URL, same convention as every other tool).
 *  - `areaM2Override`: sparse m² override. DEFAULT (absent/null) = computed from the map's floor
 *     polygons via the pure shoelace helper game/textures.ts's `floorsAreaM2`. Shown on EVERY ad.
 *  - `rentPriceOverride`: sparse rent override. DEFAULT (absent/null) = the existing finance rent
 *     formula (game/bills.ts's computeFinancePreview → `rent`, driven by data/finance.json's
 *     rent.base + perFloorTile*tiles + byPropertyType) — R2 calls that single source of truth so
 *     Kijiji and the bills system can never disagree; do NOT duplicate the formula. Shown ONLY when
 *     the listing is available.
 *  - `availability`: a standard quest Condition tree (the SAME schema/evaluator the Quest Editor
 *     builds and game/quests.ts evaluates — needs/skills/funds/time/vars/quests namespaces, which
 *     already cover the designer's job/income/creditScore/visaStatus vars). The ad NEVER displays
 *     these conditions; an unavailable listing renders the ad + a "Not available yet" label instead
 *     of the price/Rent button (R2/R3 supply that label). Absent = always available.
 *  - `moveInHours`: sim-time hours between renting and the actual move-in (R4 consumes it). */
export interface RentalConfig {
  listed: boolean;
  adTitle?: string;
  adText?: string;
  adImage?: string;
  areaM2Override?: number | null;
  rentPriceOverride?: number | null;
  availability?: Condition;
  moveInHours?: number;
}

export interface MapData {
  id: string; name: string; gridSize: number;
  /** Designer placement increment in meters. Independent from nav/tile cell size; absent maps
   *  default to 0.25m so changing gridSize never silently changes object placement precision. */
  snapStep?: number;
  /** Finance rent category; old/hand-authored maps without it are treated as condos. */
  propertyType?: PropertyType;
  bounds: { w: number; h: number };
  /** ROADMAP_NEXT B9-1: optional image texture (path under public/, e.g. "textures/oak.jpg";
   *  normalizeMeshUrl adds the leading slash). Absent → the material's flat `material` color
   *  (FLOOR_COLORS in world.ts). On load the texture swaps in tiled at
   *  tuning.textures.metersPerTile; a load failure keeps the color (keep-stand-in philosophy). */
  /** Follow-up to B9-1 (PROJECT_CONTEXT §7.32): optional per-surface tiling multiplier on top of
   *  tuning.textures.metersPerTile (2 = texture twice as big / fewer repeats). Absent/1 → default
   *  size; only meaningful alongside `texture`. See game/textures.ts effectiveMetersPerTile. */
  floors: { id: string; polygon: [number, number][]; material: string; texture?: string; textureScale?: number }[];
  /** ROADMAP_NEXT B9-1: optional image texture on the wall material (both faces unless `textureB`
   *  is set — see below), same drop-in convention + color fallback as a floor's `texture`. */
  /** Follow-up to B9-1 (PROJECT_CONTEXT §7.32): optional texture for the wall's OTHER large face,
   *  when it should differ from `texture`. Absent → both faces use `texture` (unchanged behavior).
   *  A/B convention (geometric, computed at render time from the wall's actual from→to placement,
   *  so it does NOT depend on which endpoint is `from` vs `to`): a wall running mostly along the
   *  X axis ("horizontal") has its two big faces pointing +Z/-Z — side A (`texture`) is whichever
   *  face's outward normal points WORLD +Z ("south"), side B (`textureB`) is the -Z ("north")
   *  face. A wall running mostly along the Z axis ("vertical") has faces pointing +X/-X — side A
   *  is whichever faces WORLD +X ("east"), side B is -X ("west"). See world.ts buildWorld()'s wall
   *  loop for the face-assignment math. `textureScale` applies to both sides equally. */
  walls: { from: [number, number]; to: [number, number]; texture?: string; textureB?: string | null; textureScale?: number }[];
  /** TWO placement forms coexist (ROADMAP_APT D1 — both stay valid forever, no auto-migration):
   *  - GAP-ENCODED (legacy): the doorway is a real gap between two separate `walls[]` segments;
   *    the door's `at` sits in that gap, on no wall. Rendering/nav are exactly pre-D1.
   *  - ON-WALL (D1): the SAME entry shape placed with `at` ON a continuous wall segment (same
   *    orientation as the wall's axis). The wall is derived GEOMETRICALLY at render/bake time —
   *    no wall index/reference field, mirroring `windows[]`'s "point on a wall" precedent, so
   *    wall edits never dangle a reference. Unless `cutsWall: false`, world.ts builds that wall
   *    AROUND the door's aperture (left/right solid segments + lintel — game/wallaperture.ts)
   *    and nav.ts's door carve opens the pass-through exactly like a gap door.
   *  `cutsWall` is sparse: absent = true (doors cut by default). `false` = decorative door that
   *  neither cuts the wall nor carves nav (nav.ts skips its carve). Aperture size comes from the
   *  door ASSET (AssetDef.door.apertureWidth/apertureHeight, defaults derived from footprint/
   *  meshFit — see game/wallaperture.ts's apertureSizeFor); `width` here stays what it always
   *  was: the NAV opening / doorway span (default 1.0m), independent of the visual aperture. */
  doors: { at: [number, number]; orientation: 'vertical' | 'horizontal'; width?: number; assetId?: string; cutsWall?: boolean }[];
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
  /** ROADMAP_APT R1: sparse per-map rental/ad metadata for the future Kijiji phone tab. Absent =
   *  this map is not a rental listing. See RentalConfig's doc comment above for every field. */
  rental?: RentalConfig;
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
  /** B6-9 player wall-cut view. Height is meters above the floor; optional for old fixtures.
   *  wallTopColor (B9-1 follow-up): flat unlit hex color for every wall's top face (architecture-
   *  plan look), independent of that wall's per-side texture/textureB. Optional for old fixtures;
   *  world.ts falls back to '#000000'. */
  view?: { wallCutHeight?: number; wallTopColor?: string };
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
  /** B3-7 phone job-search result count. Optional for old fixtures; game/phone.ts defaults to 3.
   *  ROADMAP_APT R1 (§6.4 RESOLVED): `rentalTabName` is the in-game brand string for the future
   *  Kijiji rental tab — kept in DATA (phone config), not hardcoded, so the designer can rename the
   *  tab. Sparse; R3 (the phone tab UI) consumes it and falls back to "Kijiji" when absent. R1 only
   *  adds the field + typing + the data/tuning.json default. */
  phone?: { jobListSize?: number; icon?: string; rentalTabName?: string };
  /** B3-8/B7-5/B7-6 work tuning. Optional for old fixtures. `departureWindowHours` limits how
   *  long after startHour the sim may leave; the two auto-depart floors are inclusive and must
   *  both pass. Runtime fallbacks live in main.ts (5 / 2 / 40 / 25 respectively). */
  work?: {
    autoSpeed?: number;
    promotionHappinessFactor?: number;
    departureWindowHours?: number;
    autoDepartHappinessMin?: number;
    autoDepartEnergyMin?: number;
  };
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
  garbage?: {
    autoTidyRadius?: number; cleanlinessThreshold?: number; cleanlinessVar?: string;
    /** Designer request (2026-07-16): a small in-world fill indicator over each placed garbage
     *  can, mirroring game/progressbar.ts's camera-space sprite bar. Every field optional/sparse —
     *  game/garbage.ts's DEFAULT_GARBAGE_FILLBAR fills in whatever's absent so old fixtures/tests
     *  that predate this field stay valid untouched. widthMeters/heightMeters/yOffsetMeters mirror
     *  ProgressBarConfig's fields (yOffsetMeters is above the can's own placed position, not a
     *  character height like the progress bar's anchor); fillColor/trackColor are CSS hex strings
     *  (same convention as view.wallTopColor/loading.json's bar, not progressbar.ts's numeric hex —
     *  THREE.SpriteMaterial accepts either); showWhenEmpty defaults false (bar hidden at fill 0). */
    fillBar?: {
      widthMeters?: number; heightMeters?: number; yOffsetMeters?: number;
      fillColor?: string; trackColor?: string; showWhenEmpty?: boolean;
      /** Designer request (2026-07-17): hide a can's fill bar while the can is OCCLUDED (behind a
       *  wall or another placed asset) from the current camera, via a cheap throttled raycast
       *  (game/garbage.ts GarbageFillBarController.updateOcclusion). Only these garbage fill bars
       *  are occlusion-tested — the sim's action/skill progress bars stay always-visible. Defaults
       *  true (game/garbage.ts's DEFAULT_GARBAGE_FILLBAR). */
      hideWhenOccluded?: boolean;
    };
  };
  /** B6-4: chance of one extra waste item, lerped by a quest-namespace numeric stat. */
  waste?: { extraChanceVar?: string; extraAtMin?: number; extraAtMax?: number };
  /** ROADMAP_NEXT B9-1: floor/wall image-texture tiling. `metersPerTile` = how many meters of
   *  surface one texture repeat spans (physical sizing) — absent/non-positive → 1m. Optional so
   *  pre-existing tuning fixtures/tests stay valid (same precedent as `interaction?`/`doors?`).
   *  See game/textures.ts (pure repeat math) + world.ts (loader/UV wiring). */
  textures?: { metersPerTile?: number };
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
  audio?: {
    masterVolume?: number; musicVolume?: number; sfxVolume?: number; musicCrossfadeSeconds?: number; buyModeMusic?: string;
    moveOrder?: string; actionSelect?: string; questStarted?: string; questCompleted?: string; notification?: string;
    skillUp?: string; moneyUp?: string; moneyDown?: string;
  };
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
  /** B6-14/B6-15 survival events. All durations use simulation seconds. */
  energyCollapse?: { collapseSeconds?: number; sleepSeconds?: number; energyAfter?: number };
  starvation?: { countdownSeconds?: number; collapseSeconds?: number; recoveryThreshold?: number; message?: string };
  /** B6-16 projected HTML feedback above the sim. `skillBar` (designer request 2026-07-17): the
   *  second, always-visible world bar shown near the sim whenever the current action has skillGains,
   *  stacked above the action progress bar (game/progressbar.ts createSkillBarInstance). All fields
   *  optional/sparse — SKILL_BAR_DEFAULTS fills in whatever's absent so old fixtures stay valid.
   *  fillColor/trackColor are CSS hex strings (deliberately a different fillColor from the action
   *  bar so the two read as distinct HUD elements); gapMeters is the vertical world offset above the
   *  action bar's anchor. */
  feedback?: {
    durationSeconds?: number; risePixels?: number; yOffsetMeters?: number;
    skillBar?: { fillColor?: string; trackColor?: string; heightMeters?: number; widthMeters?: number; gapMeters?: number };
  };
  /** ROADMAP_NEXT B7-2: a COOKED meal's hunger fulfillment scales with cooking skill (snacks
   *  unaffected). effectiveHungerGain = base * lerp(cookHungerAtSkill0, cookHungerAtSkillMax,
   *  skills.cooking/max). Optional so old fixtures stay valid; game/food.ts + main.ts default to
   *  {0.6, 1.5} when absent (novice fills 60% of the meal's base, master 150%). */
  food?: { cookHungerAtSkill0?: number; cookHungerAtSkillMax?: number };
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
  happiness: HappinessData;
  loading: LoadingConfig;
  /** B8-1-E: missing behavior.json deliberately preserves the original lowest-need picker. */
  behavior?: BehaviorData;
  /** B8-2-E: optional for compatibility; absence applies game/theme.ts's exact legacy defaults. */
  theme?: ThemeData;
}

/** B7-7 boot-only presentation. Unlike tuning.json this file is intentionally not hot-reloaded. */
export interface LoadingConfig {
  phrases: string[];
  phraseIntervalSeconds: number;
  music?: string;
  background?: string;
  bar?: { fillColor?: string; trackColor?: string; height?: number };
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
  happiness: '/data/happiness.json',
  loading: '/data/loading.json',
  behavior: '/data/behavior.json',
  theme: '/data/theme.json',
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** ROADMAP_APT R4 (§6.1 RESOLVED): which map the engine plays. The `homeMap` simstate variable —
 *  a designer-visible var whose DEFAULT is rewritten by the one sanctioned runtime data write
 *  (main.ts's move-in completion PUT) — wins when it names a map; `tuning.map.active` remains the
 *  fallback for data that predates the rental system (default "condo", as always). Pure/headless
 *  (test/pendingmove.test.ts). NOTE the deliberate consequence, flagged in ROADMAP_APT: once
 *  homeMap is set, the Map Editor's "Play this map" (a tuning.map.active PUT) no longer changes
 *  the played map until homeMap itself is updated/cleared. */
export function resolveHomeMapId(simstate: SimStateData, tuning: TuningData): string {
  const home = simstate.variables?.find((v) => v.id === 'homeMap')?.default;
  if (typeof home === 'string' && home.trim()) return home;
  return tuning.map?.active ?? 'condo';
}

export async function loadAll(): Promise<GameData> {
  // tuning + simstate first — together they name the played map (R4 §6.1: simstate.homeMap wins,
  // tuning.map.active is the fallback — see resolveHomeMapId).
  const [tuning, simstate] = await Promise.all([
    fetchJson<TuningData>(FILES.tuning),
    fetchJson<SimStateData>(FILES.simstate),
  ]);
  const homeId = resolveHomeMapId(simstate, tuning);
  let map: MapData;
  try {
    map = await fetchJson<MapData>(`/data/maps/${homeId}.json`);
  } catch (err) {
    // keep-going philosophy: a stale homeMap (map renamed/deleted since the move) must not brick
    // boot — fall back to the designer's tuning.map.active before giving up.
    const fallbackId = tuning.map?.active ?? 'condo';
    if (fallbackId === homeId) throw err;
    map = await fetchJson<MapData>(`/data/maps/${fallbackId}.json`);
  }
  const [stats, interactions, assets, quests, visas, jobs, bills, finance, happiness, loading, behavior, theme] = await Promise.all([
    fetchJson<StatsData>(FILES.stats),
    fetchJson<InteractionsData>(FILES.interactions),
    fetchJson<AssetsData>(FILES.assets),
    fetchJson<QuestsData>(FILES.quests),
    fetchJson<VisasData>(FILES.visas),
    fetchJson<JobsData>(FILES.jobs),
    fetchJson<BillsData>(FILES.bills),
    fetchJson<FinanceData>(FILES.finance),
    fetchJson<HappinessData>(FILES.happiness),
    fetchJson<LoadingConfig>(FILES.loading),
    fetchOptionalJson<BehaviorData>(FILES.behavior),
    fetchOptionalJson<ThemeData>(FILES.theme),
  ]);
  return { stats, interactions, assets, map, tuning, simstate, quests, visas, jobs, bills, finance, happiness, loading, behavior, theme };
}

async function fetchOptionalJson<T>(url: string): Promise<T | undefined> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** ROADMAP_APT R3 (Kijiji phone tab): enumerate + load EVERY map, not just the active one.
 *  Uses the existing read-only `GET /api/maps` listing (server.js, the same endpoint the Map
 *  Editor uses) — no new server endpoint needed — then fetches each `/data/maps/<id>.json`.
 *  Network-only (`cache: 'no-store'`, PWA rule: never cache /data or /api), so a designer's live
 *  map/rental edits are always reflected on the next call. A map that fails to parse is skipped
 *  rather than failing the whole listing (keep-going philosophy). */
export async function loadAllMaps(): Promise<MapData[]> {
  const listRes = await fetch('/api/maps', { cache: 'no-store' });
  if (!listRes.ok) throw new Error(`Failed to list maps: ${listRes.status}`);
  const { maps } = (await listRes.json()) as { maps: string[] };
  const loaded = await Promise.all(
    maps.map(async (id) => {
      try {
        return await fetchJson<MapData>(`/data/maps/${id}.json`);
      } catch {
        return undefined;
      }
    }),
  );
  return loaded.filter((m): m is MapData => !!m);
}

/** Dev hot-reload: polls the data files and invokes callbacks when content changes. */
export function watchData(onChange: (data: GameData) => void, intervalMs = 2000): () => void {
  let last = '';
  const tick = async () => {
    try {
      const data = await loadAll();
      // loading.json is boot-only: editing it prepares the next boot without rebuilding a live
      // world just because a phrase/color changed.
      const { loading: _bootOnlyLoading, ...hotReloadable } = data;
      const sig = JSON.stringify(hotReloadable);
      if (last && sig !== last) onChange(data);
      last = sig;
    } catch { /* server briefly unavailable — ignore */ }
  };
  const handle = window.setInterval(tick, intervalMs);
  void tick();
  return () => window.clearInterval(handle);
}
