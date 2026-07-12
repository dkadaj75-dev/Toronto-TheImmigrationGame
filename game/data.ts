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
  doors: { at: [number, number]; orientation: 'vertical' | 'horizontal' }[];
  spawn: { pos: [number, number]; facingDeg: number };
  placedObjects: { asset: string; pos: [number, number]; rotDeg: number }[];
}

export interface TuningData {
  simulation: { needsDecayTickSeconds: number; activityGainTickSeconds: number };
  autonomy: { seekBelowThreshold: number; stopAtThreshold: number; postPlayerCommandCooldownSeconds: number };
  time: { secondsPerGameDay: number; nightStartHour: number; nightEndHour: number };
  economy: { startingFunds: number; currencyName: string };
  movement: { walkSpeed: number; arrivalRadius: number };
  camera: { minZoom: number; maxZoom: number; minPitchDeg: number; maxPitchDeg: number; panBoundsPadding: number };
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
  map: '/data/maps/condo.json',
  tuning: '/data/tuning.json',
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function loadAll(): Promise<GameData> {
  const [stats, interactions, assets, map, tuning] = await Promise.all([
    fetchJson<StatsData>(FILES.stats),
    fetchJson<InteractionsData>(FILES.interactions),
    fetchJson<AssetsData>(FILES.assets),
    fetchJson<MapData>(FILES.map),
    fetchJson<TuningData>(FILES.tuning),
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
