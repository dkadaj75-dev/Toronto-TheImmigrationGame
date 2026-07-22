// carry.ts — pure carried-asset anchor and rotation-lock math.

export type Vec3 = [number, number, number];
export interface CarryAxisLocks { x?: boolean; y?: boolean; z?: boolean }

/** Rotate a vector with the same intrinsic XYZ Euler convention used by THREE.Euler.
 * Its matrix is Rx * Ry * Rz, so the vector is transformed Z, then Y, then X. */
export function rotateVec3XYZ(value: readonly number[], rotationDeg: readonly number[]): Vec3 {
  const rx = (rotationDeg[0] ?? 0) * Math.PI / 180;
  const ry = (rotationDeg[1] ?? 0) * Math.PI / 180;
  const rz = (rotationDeg[2] ?? 0) * Math.PI / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const x0 = value[0] ?? 0, y0 = value[1] ?? 0, z0 = value[2] ?? 0;
  const x1 = x0 * cz - y0 * sz, y1 = x0 * sz + y0 * cz, z1 = z0;
  const x2 = x1 * cy + z1 * sy, y2 = y1, z2 = -x1 * sy + z1 * cy;
  return [x2, y2 * cx - z2 * sx, y2 * sx + z2 * cx];
}

/** Local object position that makes `handle` land exactly on `offset` after scale+rotation. */
export function carryAnchorPosition(
  handle: readonly number[] | undefined,
  offset: readonly number[] | undefined,
  rotationDeg: readonly number[] | undefined,
  scale = 1,
): Vec3 {
  const rotated = rotateVec3XYZ((handle ?? [0, 0, 0]).map((v) => v * scale), rotationDeg ?? [0, 0, 0]);
  return [
    (offset?.[0] ?? 0) - rotated[0],
    (offset?.[1] ?? 0) - rotated[1],
    (offset?.[2] ?? 0) - rotated[2],
  ];
}

/** Locked axes retain the stable authored/world orientation; other axes follow the animated bone. */
export function resolveLockedCarryEuler(
  followed: readonly number[],
  stable: readonly number[],
  locks: CarryAxisLocks | undefined,
): Vec3 {
  return [
    locks?.x ? stable[0] : followed[0],
    locks?.y ? stable[1] : followed[1],
    locks?.z ? stable[2] : followed[2],
  ];
}

export function hasCarryRotationLock(locks: CarryAxisLocks | undefined): boolean {
  return locks?.x === true || locks?.y === true || locks?.z === true;
}
