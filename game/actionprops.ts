// actionprops.ts — one runtime owner for generic action-carried transient props.

import * as THREE from 'three';
import type { ActionDef, AssetDef } from './data';
import type { ActiveAction } from './sim';
import { carriesSpawnedProduct } from './actionchain';
import {
  carryBoneTransform, hasCarryRotationLock, normalizeCarryBoneName, resolveLockedCarryEuler,
} from './carry';

export interface TransientPropHost {
  spawnTransient(assetId: string, pos: [number, number], rotDeg?: number, now?: number): { key: string } | null;
  groupFor(key: string): THREE.Object3D | null;
  despawnTransient(key: string): void;
  setTransientPlacement(key: string, pos: [number, number], visible: boolean): boolean;
}

export interface CarriedPropControllerOptions {
  sim: THREE.Object3D;
  getWorld: () => THREE.Group;
  assetById: (id: string) => AssetDef | undefined;
  transients: TransientPropHost;
  nowSeconds: () => number;
}

interface CarriedPropState {
  key: string;
  actionDef: ActionDef;
  active: ActiveAction | null;
  group: THREE.Object3D;
  stableWorldEuler: THREE.Euler;
}

/**
 * Owns the complete lifecycle of a non-food action prop:
 * spawn/adopt → attach → follow bone/locks → despawn on completion or drop on interruption.
 * Food keeps its separate partial-consumption registry but shares the low-level attachment helper.
 */
export class CarriedPropController {
  private state: CarriedPropState | null = null;
  private transitioning = false;

  constructor(private options: CarriedPropControllerOptions) {}

  get activeKey(): string | null { return this.state?.key ?? null; }

  withTransition<T>(operation: () => T): T {
    this.transitioning = true;
    try { return operation(); }
    finally { this.transitioning = false; }
  }

  /** Adopt a completion product before its automatic action walks to a destination. */
  bindExisting(key: string, group: THREE.Object3D, actionDef: ActionDef, active: ActiveAction | null = null): boolean {
    const cfg = actionDef.carriedAsset;
    if (!cfg || this.state) return false;
    const bone = findCharacterBone(this.options.sim, cfg.bone);
    const def = this.options.assetById(cfg.assetId);
    const offset = cfg.offset ?? [0, 0, 0];
    const rotation = cfg.rotationDeg ?? [0, 0, 0];
    const scale = cfg.scale ?? 1;
    attachGroupToBone(this.options.sim, group, bone, def?.carryHandle, offset, rotation, scale);

    this.options.sim.updateWorldMatrix(true, true);
    const stableWorldQuaternion = this.options.sim.getWorldQuaternion(new THREE.Quaternion())
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(rotation[0]),
        THREE.MathUtils.degToRad(rotation[1]),
        THREE.MathUtils.degToRad(rotation[2]),
      )));
    this.state = {
      key, actionDef, active, group,
      stableWorldEuler: new THREE.Euler().setFromQuaternion(stableWorldQuaternion, 'XYZ'),
    };
    return true;
  }

  /** Start-time entry point. Reuses a pre-bound product or matching transient target; otherwise
   * creates the action's disposable visual prop. */
  start(active: ActiveAction): void {
    const cfg = active.action.carriedAsset;
    if (!cfg) return;
    if (this.state?.actionDef.id === active.action.id) {
      this.state.actionDef = active.action;
      this.state.active = active;
      return;
    }
    if (this.state) return;

    const targetKey = active.target.userData?.accidentKey as string | undefined;
    const targetAssetId = active.target.userData?.assetId as string | undefined;
    const targetGroup = targetKey ? this.options.transients.groupFor(targetKey) : null;
    if (targetKey && targetGroup && carriesSpawnedProduct(active.action, targetAssetId ?? '')) {
      this.bindExisting(targetKey, targetGroup, active.action, active);
      return;
    }

    const rec = this.options.transients.spawnTransient(
      cfg.assetId,
      [this.options.sim.position.x, this.options.sim.position.z],
      0,
      this.options.nowSeconds(),
    );
    const group = rec ? this.options.transients.groupFor(rec.key) : null;
    if (rec && group) this.bindExisting(rec.key, group, active.action, active);
  }

  /** Clear ownership before a caller deliberately places a failed-to-route product in-world. */
  releaseBinding(key: string): boolean {
    if (this.state?.key !== key) return false;
    this.state = null;
    return true;
  }

  stop(active: ActiveAction, completed: boolean): void {
    const state = this.state;
    if (!state) return;
    if (state.active ? state.active !== active : state.actionDef.id !== active.action.id) return;
    if (this.transitioning) return;
    this.state = null;
    if (completed || state.actionDef.carriedAsset?.dropOnInterrupt === false) {
      this.options.transients.despawnTransient(state.key);
      return;
    }
    const group = this.options.transients.groupFor(state.key);
    if (group) this.options.getWorld().attach(group);
    this.options.transients.setTransientPlacement(
      state.key,
      [this.options.sim.position.x, this.options.sim.position.z],
      true,
    );
  }

  updateRotationLocks(): void {
    const state = this.state;
    const cfg = state?.actionDef.carriedAsset;
    if (!state || !cfg || !hasCarryRotationLock(cfg.lockRotationAxes)) return;
    const group = state.group;
    const parent = group.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    const rotation = cfg.rotationDeg ?? [0, 0, 0];
    const authoredLocal = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation[0]),
      THREE.MathUtils.degToRad(rotation[1]),
      THREE.MathUtils.degToRad(rotation[2]),
      'XYZ',
    ));
    const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
    const followed = new THREE.Euler().setFromQuaternion(parentWorld.clone().multiply(authoredLocal), 'XYZ');
    const resolved = resolveLockedCarryEuler(
      [followed.x, followed.y, followed.z],
      [state.stableWorldEuler.x, state.stableWorldEuler.y, state.stableWorldEuler.z],
      cfg.lockRotationAxes,
    );
    const desiredWorld = new THREE.Quaternion().setFromEuler(new THREE.Euler(resolved[0], resolved[1], resolved[2], 'XYZ'));
    group.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
    anchorGroup(group, this.options.assetById(cfg.assetId)?.carryHandle, cfg.offset ?? [0, 0, 0]);
    group.updateMatrixWorld(true);
  }

}

export function findCharacterBone(sim: THREE.Object3D, name: string): THREE.Object3D {
  const exact = sim.getObjectByName(name);
  if (exact) return exact;
  const wanted = normalizeCarryBoneName(name);
  let match: THREE.Object3D | null = null;
  sim.traverse((object) => {
    if (!match && normalizeCarryBoneName(object.name) === wanted) match = object;
  });
  return match ?? sim;
}

/** Shared low-level attachment for generic props and the food registry's carried products. */
export function attachGroupToBone(
  sim: THREE.Object3D,
  group: THREE.Object3D,
  bone: THREE.Object3D,
  handle: readonly number[] | undefined,
  offset: readonly number[],
  rotationDeg: readonly number[],
  desiredScale: number,
): void {
  sim.updateWorldMatrix(true, true);
  bone.updateWorldMatrix(true, false);
  const parentWorldScale = bone.getWorldScale(new THREE.Vector3());
  const transform = carryBoneTransform(
    handle, offset, rotationDeg, desiredScale,
    [parentWorldScale.x, parentWorldScale.y, parentWorldScale.z],
  );
  bone.add(group);
  group.rotation.set(
    THREE.MathUtils.degToRad(rotationDeg[0] ?? 0),
    THREE.MathUtils.degToRad(rotationDeg[1] ?? 0),
    THREE.MathUtils.degToRad(rotationDeg[2] ?? 0),
  );
  group.scale.fromArray(transform.scale);
  group.position.fromArray(transform.position);
  group.visible = true;
  group.updateMatrixWorld(true);
}

function anchorGroup(group: THREE.Object3D, handle: readonly number[] | undefined, offset: readonly number[]): void {
  const parentWorldScale = group.parent?.getWorldScale(new THREE.Vector3(1, 1, 1)) ?? new THREE.Vector3(1, 1, 1);
  const safeScale = new THREE.Vector3(
    Math.abs(parentWorldScale.x) > 1e-8 ? Math.abs(parentWorldScale.x) : 1,
    Math.abs(parentWorldScale.y) > 1e-8 ? Math.abs(parentWorldScale.y) : 1,
    Math.abs(parentWorldScale.z) > 1e-8 ? Math.abs(parentWorldScale.z) : 1,
  );
  const transformedHandle = new THREE.Vector3(handle?.[0] ?? 0, handle?.[1] ?? 0, handle?.[2] ?? 0)
    .multiply(group.scale)
    .applyQuaternion(group.quaternion);
  group.position.set(
    (offset[0] ?? 0) / safeScale.x,
    (offset[1] ?? 0) / safeScale.y,
    (offset[2] ?? 0) / safeScale.z,
  ).sub(transformedHandle);
}
