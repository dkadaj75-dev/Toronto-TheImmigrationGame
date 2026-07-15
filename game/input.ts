// input.ts — tap detection on the game canvas.
// Coexists with TouchCamera: the camera consumes drags; a "tap" is a pointerdown→pointerup
// pair that stayed within a small slop radius and a short time. Works identically for
// mouse and touch (Pointer Events). Raycasts objects first, then the ground plane.

import * as THREE from 'three';

export interface TapResult {
  /** world-space point on the ground plane (y = 0) */
  ground: THREE.Vector3 | null;
  /** the asset group hit (world.ts sets userData.assetId on placed objects), if any */
  object: THREE.Object3D | null;
}

const TAP_SLOP_PX = 8;        // moved less than this → tap, not drag
const TAP_MAX_MS = 400;       // held longer → drag/hold, not tap

export class TapInput {
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private down: { id: number; x: number; y: number; t: number } | null = null;
  private hovered: THREE.Object3D | null = null;
  /** fires when the pointer moves onto / off a tappable object (null = none). Mouse only in practice. */
  onHover: ((obj: THREE.Object3D | null) => void) | null = null;

  constructor(
    private el: HTMLElement,
    private camera: THREE.Camera,
    private getWorld: () => THREE.Group,
    private onTap: (hit: TapResult) => void,
  ) {
    el.addEventListener('pointerdown', (e) => {
      // right (and other non-left) buttons drive camera rotation (camera.ts), never a tap
      if (e.button !== 0) return;
      // only track the first pointer — a second finger means pinch, never tap
      if (this.down === null) this.down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      else this.down = { id: -1, x: 0, y: 0, t: 0 }; // poisoned: multi-touch
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || d.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      const held = performance.now() - d.t;
      if (moved > TAP_SLOP_PX || held > TAP_MAX_MS) return; // it was a camera drag
      this.onTap(this.raycast(e.clientX, e.clientY));
    });
    el.addEventListener('pointercancel', () => { this.down = null; });
    el.addEventListener('pointermove', (e) => {
      if (this.down || !this.onHover) return; // dragging → camera's business, skip hover work
      const obj = this.raycast(e.clientX, e.clientY).object;
      if (obj !== this.hovered) {
        this.hovered = obj;
        this.onHover(obj);
      }
    });
    el.addEventListener('pointerleave', () => {
      if (this.hovered) { this.hovered = null; this.onHover?.(null); }
    });
  }

  private raycast(clientX: number, clientY: number): TapResult {
    const rect = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // objects first: walk up from the hit mesh to the group carrying userData.assetId
    let object: THREE.Object3D | null = null;
    const hits = this.raycaster.intersectObjects(this.getWorld().children, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData?.assetId === undefined) o = o.parent;
      if (o) { object = o; break; }
      break; // first hit was a wall/floor/door — nothing tappable in front
    }

    const ground = new THREE.Vector3();
    const hitGround = this.raycaster.ray.intersectPlane(this.groundPlane, ground);
    return { ground: hitGround ? ground : null, object };
  }
}
