// carry.ts — pure carried-asset anchor and rotation-lock math.

export type Vec3 = [number, number, number];
export interface CarryAxisLocks { x?: boolean; y?: boolean; z?: boolean }
export interface CarryBoneTransform { position: Vec3; scale: Vec3 }
export const DEFAULT_CARRY_BONE = 'mixamorigRightHand';

/** Canonical bone key across Mixamo exports (`mixamorigRightHand`, `mixamorig:RightHand`,
 * `mixamorig2:RightHand`) and plain rig names (`RightHand`). */
export function normalizeCarryBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig\d*/, '');
}

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

/**
 * Local transform for a prop parented below a scaled character rig.
 *
 * Character GLBs are normalized by scaling their root. Without inverse compensation a prop added
 * to a descendant bone inherits that small scale, then keeps the tiny world size when detached to
 * a table. Offsets are authored in game metres, so they need the same compensation as prop size.
 */
export function carryBoneTransform(
  handle: readonly number[] | undefined,
  offset: readonly number[] | undefined,
  rotationDeg: readonly number[] | undefined,
  desiredScale = 1,
  parentWorldScale: readonly number[] = [1, 1, 1],
): CarryBoneTransform {
  const safeParentScale: Vec3 = [0, 1, 2].map((axis) => {
    const value = Math.abs(parentWorldScale[axis] ?? 1);
    return value > 1e-8 ? value : 1;
  }) as Vec3;
  const localScale: Vec3 = [
    desiredScale / safeParentScale[0],
    desiredScale / safeParentScale[1],
    desiredScale / safeParentScale[2],
  ];
  const scaledHandle: Vec3 = [
    (handle?.[0] ?? 0) * localScale[0],
    (handle?.[1] ?? 0) * localScale[1],
    (handle?.[2] ?? 0) * localScale[2],
  ];
  const rotatedHandle = rotateVec3XYZ(scaledHandle, rotationDeg ?? [0, 0, 0]);
  return {
    scale: localScale,
    position: [
      (offset?.[0] ?? 0) / safeParentScale[0] - rotatedHandle[0],
      (offset?.[1] ?? 0) / safeParentScale[1] - rotatedHandle[1],
      (offset?.[2] ?? 0) / safeParentScale[2] - rotatedHandle[2],
    ],
  };
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
