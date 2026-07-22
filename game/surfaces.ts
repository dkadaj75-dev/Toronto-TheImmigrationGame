// surfaces.ts — pure elevated-socket placement shared by transient drops and Buy Mode.

export interface SurfaceSocketDef {
  /** Model-local horizontal offset from the host asset anchor. */
  offset: [number, number];
  /** Height above the host asset's ground anchor, in metres. */
  y: number;
  /** Optional local yaw for an object snapped into this socket. */
  rotationDeg?: number;
}

export interface SurfaceHost {
  key: string;
  pos: [number, number];
  rotDeg: number;
  sockets: readonly SurfaceSocketDef[];
}

export interface SurfaceSocketCandidate {
  hostKey: string;
  index: number;
  pos: [number, number, number];
  rotDeg: number;
  distance: number;
}

export interface SurfaceSocketRef { hostKey: string; index: number; }

/** Model-local +Z follows the project's placed-object facing convention. */
export function surfaceSocketWorld(
  host: Pick<SurfaceHost, 'pos' | 'rotDeg'>,
  socket: SurfaceSocketDef,
): { pos: [number, number, number]; rotDeg: number } {
  const r = host.rotDeg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const [x, z] = socket.offset;
  return {
    pos: [host.pos[0] + x * c + z * s, socket.y, host.pos[1] - x * s + z * c],
    rotDeg: ((host.rotDeg + (socket.rotationDeg ?? 0)) % 360 + 360) % 360,
  };
}

/** Nearest free socket inside radius; distance ties are stable by host order then socket index. */
export function nearestFreeSurfaceSocket(
  hosts: readonly SurfaceHost[],
  from: readonly [number, number],
  radiusMeters: number,
  isOccupied: (hostKey: string, index: number) => boolean,
): SurfaceSocketCandidate | null {
  const radius = radiusMeters === Infinity ? Infinity : Number.isFinite(radiusMeters) ? Math.max(0, radiusMeters) : 0;
  let best: SurfaceSocketCandidate | null = null;
  for (const host of hosts) {
    host.sockets.forEach((socket, index) => {
      if (isOccupied(host.key, index)) return;
      const resolved = surfaceSocketWorld(host, socket);
      const distance = Math.hypot(resolved.pos[0] - from[0], resolved.pos[2] - from[1]);
      if (distance > radius + 1e-9) return;
      if (!best || distance < best.distance - 1e-9) {
        best = { hostKey: host.key, index, pos: resolved.pos, rotDeg: resolved.rotDeg, distance };
      }
    });
  }
  return best;
}

/** Resolve an item's existing socket only when that exact item still owns it. This lets an
 * interrupted table action keep the plate where it already is instead of releasing the claim and
 * selecting the table's other socket from the sim's current position. */
export function retainedSurfaceSocket(
  hosts: readonly SurfaceHost[],
  ref: SurfaceSocketRef | undefined,
  occupantId: string,
  occupantAt: (hostKey: string, index: number) => string | undefined,
): SurfaceSocketCandidate | null {
  if (!ref || occupantAt(ref.hostKey, ref.index) !== occupantId) return null;
  const host = hosts.find((entry) => entry.key === ref.hostKey);
  const socket = host?.sockets[ref.index];
  if (!host || !socket) return null;
  const resolved = surfaceSocketWorld(host, socket);
  return { hostKey: ref.hostKey, index: ref.index, pos: resolved.pos, rotDeg: resolved.rotDeg, distance: 0 };
}

/** Stable token used as the occupant id for a purchased or transient object. */
export function surfaceOccupantId(kind: 'buy' | 'transient', key: string): string {
  return `${kind}:${key}`;
}
