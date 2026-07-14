// data.ts — single entry point for the "databases" (design pillar #2: data-driven everything).
// Loads data/*.json and, in dev, polls for changes so tuning edits hot-reload into a running game.

export interface NeedDef { id: string; name: string; color: string; default: number; decayPerTick: number; autonomy: boolean; computed?: string; }
export interface SkillDef { id: string; name: string; color: string; default: number; max: number; enabled?: boolean; }
export interface StatsData { needs: NeedDef[]; skills: SkillDef[]; }

export interface ActionDef {
  id: string; name: string;
  needGains: Record<string, number>;
  skillGains: Record<string, number>;
  animation: string;
  autonomyEligible: boolean;
  primaryNeed: string | null;
  seatAware?: boolean;
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
  door?: { hingeOffset: [number, number]; openAngleDeg?: number; openSeconds?: number; closeSeconds?: number; triggerDistance?: number };
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
}
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
export type Reward = RewardFunds | RewardSetVar | RewardUnlockAsset;

export interface QuestDef {
  id: string; name: string; description: string;
  trigger: Condition;
  completion: Condition;
  rewards: Reward[];
  onceOnly: boolean;
}
export interface QuestsData { quests: QuestDef[]; }

export interface MapData {
  id: string; name: string; gridSize: number;
  bounds: { w: number; h: number };
  floors: { id: string; polygon: [number, number][]; material: string }[];
  walls: { from: [number, number]; to: [number, number] }[];
  doors: { at: [number, number]; orientation: 'vertical' | 'horizontal'; width?: number; assetId?: string }[];
  spawn: { pos: [number, number]; facingDeg: number };
  placedObjects: { asset: string; pos: [number, number]; rotDeg: number }[];
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
}

export interface TuningData {
  simulation: { needsDecayTickSeconds: number; activityGainTickSeconds: number };
  autonomy: { seekBelowThreshold: number; stopAtThreshold: number; postPlayerCommandCooldownSeconds: number };
  time: { secondsPerGameDay: number; nightStartHour: number; nightEndHour: number };
  economy: { startingFunds: number; currencyName: string };
  movement: { walkSpeed: number; arrivalRadius: number };
  /** Optional so pre-existing tuning fixtures/tests stay valid (mirrors the `character?` precedent
   *  below) — game code falls back with `?? <value>` where used (see game/facing.ts). §7.2 as-built:
   *  useSpotClearance = gap beyond the footprint edge for a front-approach stand point;
   *  seatViewDistance = how far in front of a seat-aware target (e.g. the TV) the "viewing point"
   *  sits when ranking candidate seats — ports the Unreal prototype's RightVector·400 constant. */
  interaction?: { useSpotClearance?: number; seatViewDistance?: number };
  /** Optional so pre-existing tuning fixtures/tests stay valid (same precedent as `interaction?`
   *  above). Defaults for AssetDef.door fields when a door instance doesn't override them (§7.1).
   *  triggerDistance is in meters (map gridSize=1 → 1 grid unit = 1 meter). */
  doors?: { openSeconds?: number; closeSeconds?: number; openAngleDeg?: number; triggerDistance?: number };
  camera: { minZoom: number; maxZoom: number; minPitchDeg: number; maxPitchDeg: number; panBoundsPadding: number };
  /** quest log HUD tuning (§3 quest system) — no magic numbers in game/quests.ts or ui.ts */
  quests: { toastDurationSeconds: number; completedLogLimit: number };
  /** which map the game plays: data/maps/<active>.json (set from the Map Editor's "Play this map") */
  map?: { active: string };
  /** optional so pre-rig data files & test fixtures stay valid; game falls back to the capsule */
  character?: CharacterTuning;
}

export interface GameData {
  stats: StatsData;
  interactions: InteractionsData;
  assets: AssetsData;
  map: MapData;
  tuning: TuningData;
  simstate: SimStateData;
  quests: QuestsData;
}

const FILES = {
  stats: '/data/stats.json',
  interactions: '/data/interactions.json',
  assets: '/data/assets.json',
  tuning: '/data/tuning.json',
  simstate: '/data/simstate.json',
  quests: '/data/quests.json',
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
  const [stats, interactions, assets, map, simstate, quests] = await Promise.all([
    fetchJson<StatsData>(FILES.stats),
    fetchJson<InteractionsData>(FILES.interactions),
    fetchJson<AssetsData>(FILES.assets),
    fetchJson<MapData>(mapFile),
    fetchJson<SimStateData>(FILES.simstate),
    fetchJson<QuestsData>(FILES.quests),
  ]);
  return { stats, interactions, assets, map, tuning, simstate, quests };
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
