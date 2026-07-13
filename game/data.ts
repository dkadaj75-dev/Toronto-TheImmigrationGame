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
}
export interface AssetsData { categories: string[]; assets: AssetDef[]; }

export interface MapData {
  id: string; name: string; gridSize: number;
  bounds: { w: number; h: number };
  floors: { id: string; polygon: [number, number][]; material: string }[];
  walls: { from: [number, number]; to: [number, number] }[];
  doors: { at: [number, number]; orientation: 'vertical' | 'horizontal'; width?: number }[];
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
  camera: { minZoom: number; maxZoom: number; minPitchDeg: number; maxPitchDeg: number; panBoundsPadding: number };
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
}

const FILES = {
  stats: '/data/stats.json',
  interactions: '/data/interactions.json',
  assets: '/data/assets.json',
  tuning: '/data/tuning.json',
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
  const [stats, interactions, assets, map] = await Promise.all([
    fetchJson<StatsData>(FILES.stats),
    fetchJson<InteractionsData>(FILES.interactions),
    fetchJson<AssetsData>(FILES.assets),
    fetchJson<MapData>(mapFile),
  ]);
  return { stats, interactions, assets, map, tuning };
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
