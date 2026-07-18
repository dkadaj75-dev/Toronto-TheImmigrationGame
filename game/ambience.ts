// ambience.ts — pure room-aware light/sound ambience decisions (B13-9/B13-10).
//
// Room membership is deliberately a 2D visibility test over the SAME authored map walls and
// doors used by nav/world. A sim→asset segment is blocked by any wall it crosses, except where
// the crossing falls inside an OPEN door aperture. CLOSED doors are also tested as segments, so
// they block both D1 on-wall apertures and legacy doors authored in a literal gap between walls.

import type { AssetDef, MapData } from './data';
import type { AssetStateRegistry } from './assetstate';
import { apertureSizeFor, doorAlongWall, doorCutsWall } from './wallaperture';

export type AmbiencePoint = [number, number];

export interface AmbienceAssetInstance {
  key: string;
  position: AmbiencePoint;
  def: AssetDef;
}

export interface AmbienceRoomGeometry {
  walls: MapData['walls'];
  doors: MapData['doors'];
  assetForDoor?: (assetId: string | undefined) => AssetDef | undefined;
  isDoorOpen?: (door: MapData['doors'][number], index: number) => boolean;
}

export interface AmbienceMatch {
  instance: AmbienceAssetInstance;
  on: boolean;
  emitsLight: boolean;
  emitsSound: boolean;
  distance: number;
  withinRadius: boolean;
  sameRoom: boolean;
  active: boolean;
}

export interface SleepBlockDecision {
  blocked: boolean;
  blocker: AmbienceAssetInstance | null;
  reason: string | null;
}

const EPS = 1e-7;

interface SegmentHit { t: number; u: number; }

/** Proper/endpoint segment intersection. Collinear wall travel is treated as blocked. */
function segmentHit(a: AmbiencePoint, b: AmbiencePoint, c: AmbiencePoint, d: AmbiencePoint): SegmentHit | null {
  const rx = b[0] - a[0], rz = b[1] - a[1];
  const sx = d[0] - c[0], sz = d[1] - c[1];
  const cross = rx * sz - rz * sx;
  const qx = c[0] - a[0], qz = c[1] - a[1];
  if (Math.abs(cross) <= EPS) {
    const collinear = Math.abs(qx * rz - qz * rx) <= EPS;
    if (!collinear) return null;
    const rr = rx * rx + rz * rz;
    if (rr <= EPS) return null;
    const t0 = (qx * rx + qz * rz) / rr;
    const t1 = t0 + (sx * rx + sz * rz) / rr;
    return Math.max(Math.min(t0, t1), 0) <= Math.min(Math.max(t0, t1), 1) + EPS
      ? { t: Math.max(0, Math.min(1, t0)), u: 0 }
      : null;
  }
  const t = (qx * sz - qz * sx) / cross;
  const u = (qx * rz - qz * rx) / cross;
  return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? { t, u } : null;
}

function doorSegment(door: MapData['doors'][number], width: number): [AmbiencePoint, AmbiencePoint] {
  const half = width / 2;
  return door.orientation === 'vertical'
    ? [[door.at[0], door.at[1] - half], [door.at[0], door.at[1] + half]]
    : [[door.at[0] - half, door.at[1]], [door.at[0] + half, door.at[1]]];
}

/** True when no authored wall/closed-door boundary separates the two positions. */
export function sameRoom(from: AmbiencePoint, to: AmbiencePoint, room: AmbienceRoomGeometry): boolean {
  const defFor = room.assetForDoor ?? (() => undefined);
  const open = (door: MapData['doors'][number], index: number) => room.isDoorOpen?.(door, index) ?? false;

  for (const wall of room.walls) {
    const hit = segmentHit(from, to, wall.from, wall.to);
    if (!hit) continue;
    // A wall-mounted source is anchored on its wall centerline. Reaching the source at the ray's
    // endpoint is not crossing into another room (same for a sim exactly on a boundary).
    if (hit.t <= EPS || hit.t >= 1 - EPS) continue;
    const wallLength = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
    const crossingAlong = hit.u * wallLength;
    const passesOpenAperture = room.doors.some((door, index) => {
      if (!doorCutsWall(door) || !open(door, index)) return false;
      const along = doorAlongWall(wall, door);
      if (along === null) return false;
      const width = apertureSizeFor(defFor(door.assetId), door).width;
      return crossingAlong >= along - width / 2 - EPS && crossingAlong <= along + width / 2 + EPS;
    });
    if (!passesOpenAperture) return false;
  }

  // A closed door blocks a legacy physical wall gap as well as an on-wall aperture.
  for (let i = 0; i < room.doors.length; i++) {
    const door = room.doors[i];
    if (!doorCutsWall(door) || open(door, i)) continue;
    const width = apertureSizeFor(defFor(door.assetId), door).width;
    const [a, b] = doorSegment(door, width);
    const hit = segmentHit(from, to, a, b);
    if (hit && hit.t > EPS && hit.t < 1 - EPS) return false;
  }
  return true;
}

export function inspectAmbience(
  simPosition: AmbiencePoint,
  instance: AmbienceAssetInstance,
  states: Pick<AssetStateRegistry, 'isOn'>,
  room: AmbienceRoomGeometry,
  radiusMeters: number,
): AmbienceMatch {
  const on = states.isOn(instance.key, instance.def);
  const emitsLight = !!instance.def.light;
  const emitsSound = !!instance.def.sound;
  const distance = Math.hypot(instance.position[0] - simPosition[0], instance.position[1] - simPosition[1]);
  const withinRadius = distance <= Math.max(0, radiusMeters);
  const connected = sameRoom(simPosition, instance.position, room);
  return {
    instance, on, emitsLight, emitsSound, distance, withinRadius, sameRoom: connected,
    active: on && withinRadius && connected && (emitsLight || emitsSound),
  };
}

/** Uses the same inclusive-start/exclusive-end wrapped night window as the day/night clock. */
export function isNightHour(hour: number, nightStartHour: number, nightEndHour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  const start = ((nightStartHour % 24) + 24) % 24;
  const end = ((nightEndHour % 24) + 24) % 24;
  if (start === end) return true; // matches daylightFactor: a zero-length day is all night
  return start < end ? h >= start && h < end : h >= start || h < end;
}

/** Sum of sparse per-light comfort contributions at this position; absent field = zero. */
export function nightComfortBonus(
  hour: number,
  nightStartHour: number,
  nightEndHour: number,
  matches: readonly AmbienceMatch[],
): number {
  if (!isNightHour(hour, nightStartHour, nightEndHour)) return 0;
  return matches.reduce((sum, match) => sum + (
    match.active && match.emitsLight ? Math.max(0, match.instance.def.light?.comfortBonus ?? 0) : 0
  ), 0);
}

/** Nearest active light/sound source wins, giving stable and useful blocker feedback. */
export function sleepBlockDecision(matches: readonly AmbienceMatch[], enabled = true): SleepBlockDecision {
  if (!enabled) return { blocked: false, blocker: null, reason: null };
  const match = matches
    .filter((candidate) => candidate.active)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!match) return { blocked: false, blocker: null, reason: null };
  const reason = `Can't sleep - the ${match.instance.def.name} is on`;
  return { blocked: true, blocker: match.instance, reason };
}
