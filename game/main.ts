// main.ts — Condo Life Web, Phase 0 skeleton.
// Proves the full pipeline: data/*.json → three.js scene → phone screen, with live data hot-reload.
// Simulation (needs/autonomy/pathfinding) arrives in Phase 1 and will read the same data objects.

import * as THREE from 'three';
import { loadAll, watchData, type GameData } from './data';
import { TouchCamera } from './camera';
import { buildWorld, makeSimStandIn, makeLights } from './world';

const app = document.getElementById('app')!;
const boot = document.getElementById('boot')!;
const devData = document.getElementById('dev-data')!;
const devClock = document.getElementById('dev-clock')!;
const devFps = document.getElementById('dev-fps')!;

async function start() {
  let data: GameData;
  try {
    data = await loadAll();
  } catch (err) {
    boot.textContent = `data failed to load — is server.js running? (${(err as Error).message})`;
    return;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // mobile perf budget
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3346);

  let world = buildWorld(data);
  scene.add(world, makeLights());

  const sim = makeSimStandIn();
  sim.position.set(data.map.spawn.pos[0], 0, data.map.spawn.pos[1]);
  sim.rotation.y = THREE.MathUtils.degToRad(data.map.spawn.facingDeg);
  scene.add(sim);

  const cam = new TouchCamera(window.innerWidth / window.innerHeight, data.tuning.camera, data.map);
  cam.attach(renderer.domElement);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.resize(window.innerWidth / window.innerHeight);
  });

  // --- data hot-reload (design pillar: tuning is play-test-live) ---
  watchData((fresh) => {
    data = fresh;
    scene.remove(world);
    disposeGroup(world);
    world = buildWorld(data);
    scene.add(world);
    cam.retune(data.tuning.camera, data.map);
    flashDevbar();
  });

  devData.innerHTML = `data: <b>${data.assets.assets.length} assets</b> · <b>${data.stats.needs.length} needs</b> · <b>${data.stats.skills.filter(s => s.enabled !== false).length} skills</b> · <b>${data.interactions.actions.length} actions</b>`;

  // --- game clock (display only in Phase 0; drives day/night in Phase 1) ---
  let gameSeconds = 8 * 3600; // start the day at 08:00
  const clockScale = () => 86400 / data.tuning.time.secondsPerGameDay;

  // --- render loop ---
  let frames = 0, fpsTimer = 0, last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    gameSeconds = (gameSeconds + dt * clockScale()) % 86400;
    const h = Math.floor(gameSeconds / 3600), m = Math.floor((gameSeconds % 3600) / 60);
    devClock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    frames++; fpsTimer += dt;
    if (fpsTimer >= 1) { devFps.textContent = `${frames} fps`; frames = 0; fpsTimer = 0; }

    renderer.render(scene, cam.camera);
  });

  boot.classList.add('done');
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const m = o.material;
      (Array.isArray(m) ? m : [m]).forEach((mm) => mm.dispose());
    }
  });
}

function flashDevbar() {
  devData.style.color = '#9fd08c';
  setTimeout(() => (devData.style.color = ''), 600);
}

void start();
