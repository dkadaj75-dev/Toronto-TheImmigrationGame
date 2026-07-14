// main.ts — Condo Life Web, Phase 0 skeleton.
// Proves the full pipeline: data/*.json → three.js scene → phone screen, with live data hot-reload.
// Simulation (needs/autonomy/pathfinding) arrives in Phase 1 and will read the same data objects.

import * as THREE from 'three';
import { loadAll, watchData, type GameData } from './data';
import { TouchCamera } from './camera';
import { buildWorld, makeSimStandIn, makeLights, applyDayNight, loadRiggedCharacter } from './world';
import { buildDoors } from './doors';
import { AnimController } from './anim';
import { bakeNavGrid } from './nav';
import { TapInput } from './input';
import { SimAgent, ClickCue, findSeatFor } from './sim';
import { SimStats } from './stats';
import { Hud } from './ui';
import { Autonomy } from './autonomy';
import { QuestRunner } from './quests';

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
  let doors = buildDoors(data);
  world.add(doors.group);
  const lights = makeLights();
  scene.add(world, lights);

  const sim = makeSimStandIn();
  sim.position.set(data.map.spawn.pos[0], 0, data.map.spawn.pos[1]);
  sim.rotation.y = THREE.MathUtils.degToRad(data.map.spawn.facingDeg);
  scene.add(sim);

  const cam = new TouchCamera(window.innerWidth / window.innerHeight, data.tuning.camera, data.map);
  cam.attach(renderer.domElement);

  // --- Phase 1: tap-to-go + needs/skills simulation + actions ---
  let grid = bakeNavGrid(data.map, data.assets);
  const agent = new SimAgent(sim, grid, data.tuning);
  const cue = new ClickCue();
  scene.add(cue.object);

  // --- rigged character: swap the capsule's contents for the GLB when it loads.
  // The `sim` group stays the agent's object, so position/rotation/pose logic is untouched.
  let anim: AnimController | null = null;
  // signature of the last load — changing the mesh OR the animation sources re-loads the rig
  let charSig = '';
  const sigOf = (c: { meshPath: string; animationPaths?: string[] }) => JSON.stringify([c.meshPath, c.animationPaths ?? []]);
  const loadCharacter = () => {
    const c = data.tuning.character;
    if (!c?.meshPath) return;
    const sig = sigOf(c);
    if (sig === charSig) return;
    charSig = sig;
    loadRiggedCharacter(c)
      .then(({ model, clips }) => {
        if (!data.tuning.character || sigOf(data.tuning.character) !== sig) return; // changed again mid-flight
        disposeGroup(sim); // free the capsule (or a previous rig)
        sim.clear();
        sim.add(model);
        anim = new AnimController(model, clips, data.tuning.character!);
        console.info(`character clips available: ${clips.map((k) => k.name).join(', ')} — map them in tuning.character.clipMap`);
        agent.hasRig = true;
        // enter the correct state immediately (mid-walk / mid-action hot-swaps included)
        anim.play(agent.current ? agent.current.action.animation : agent.isMoving ? 'walk' : 'idle');
        anim.setWalkSpeed(data.tuning.movement.walkSpeed);
      })
      .catch((err) => console.warn(`rigged character failed to load (${c.meshPath}) — keeping the capsule stand-in.`, err));
  };
  loadCharacter();

  agent.onLocomotionChange = (moving) => {
    if (!anim) return;
    if (moving) {
      anim.play('walk');
      anim.setWalkSpeed(data.tuning.movement.walkSpeed);
    } else if (!agent.current) {
      anim.play('idle'); // arrival into an action is handled by onActionStart instead
    }
  };

  const stats = new SimStats(data.stats);
  const hud = new Hud(stats);

  // Environment need (Sims "Room" score) = Σ environment scores of placed objects
  const environmentScore = () => {
    const byId = new Map(data.assets.assets.map((a) => [a.id, a]));
    return data.map.placedObjects.reduce((sum, p) => sum + (byId.get(p.asset)?.environmentScore ?? 0), 0);
  };
  const envNeedId = () => data.stats.needs.find((n) => n.computed)?.id;
  const applyEnvironment = () => { const id = envNeedId(); if (id) stats.setComputed(id, environmentScore()); };
  applyEnvironment();

  const autonomy = new Autonomy(() => data, () => world, agent, stats);

  // --- quest system (PROJECT_CONTEXT.md §3): runtime-only state, see quests.ts's persistence doc comment ---
  const quests = new QuestRunner(data.quests, data.simstate, data.tuning.economy.startingFunds);
  const completedQuestLog: { name: string }[] = [];
  const refreshQuestLog = () => {
    const active = data.quests.quests
      .filter((q) => quests.quests[q.id] === 'active')
      .map((q) => ({ name: q.name, description: q.description }));
    hud.setQuestLog(active, completedQuestLog, data.tuning.quests.completedLogLimit);
  };
  quests.onQuestStarted = (q) => {
    hud.showQuestToast(`Quest started: ${q.name}`, 'started', data.tuning.quests.toastDurationSeconds * 1000);
    refreshQuestLog();
  };
  quests.onQuestCompleted = (q) => {
    hud.showQuestToast(`Quest completed: ${q.name}`, 'completed', data.tuning.quests.toastDurationSeconds * 1000);
    completedQuestLog.push({ name: q.name });
    refreshQuestLog();
  };
  refreshQuestLog();

  // --- object highlight: subtle box on hover (mouse), bright box while the menu is open ---
  const hoverBox = new THREE.BoxHelper(new THREE.Object3D(), 0x6fa0ff);
  const selectBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffd166);
  hoverBox.visible = false;
  selectBox.visible = false;
  scene.add(hoverBox, selectBox);
  const setHover = (obj: THREE.Object3D | null) => {
    if (obj) hoverBox.setFromObject(obj);
    hoverBox.visible = !!obj;
    renderer.domElement.style.cursor = obj ? 'pointer' : 'default';
  };
  const setSelected = (obj: THREE.Object3D | null) => {
    if (obj) selectBox.setFromObject(obj);
    selectBox.visible = !!obj;
    if (obj) setHover(null); // the bright box replaces the hover box on the same object
  };
  hud.onMenuHidden = () => setSelected(null);

  agent.onActionStart = (a) => {
    hud.showActivity(a.action.name);
    anim?.play(a.action.animation || 'idle'); // unmapped states fall back to idle inside AnimController
  };
  agent.onActionStop = () => {
    hud.hideActivity();
    anim?.play('idle');
  };
  hud.onCancelAction = () => { autonomy.notePlayerCommand(); agent.stopAction(); };

  const tapInput = new TapInput(renderer.domElement, cam.camera, () => world, (hit) => {
    if (hit.object) {
      const assetId = hit.object.userData.assetId as string;
      const asset = data.assets.assets.find((a) => a.id === assetId);
      if (asset) {
        const actions = asset.interactions
          .map((id) => data.interactions.actions.find((x) => x.id === id))
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (actions.length > 0) {
          const target = hit.object;
          setSelected(target);
          hud.showActionMenu(asset, actions, (action) => {
            autonomy.notePlayerCommand();
            const seat = action.seatAware ? findSeatFor(world, data, target) : null;
            if (agent.orderAction(action, target, seat, asset)) cue.showAt(target.position.x, target.position.z);
            else console.log('no path to object', assetId);
          });
          return; // object tap opens the menu; don't also walk to the tap point
        }
      }
    }
    hud.hideActionMenu();
    if (hit.ground) {
      autonomy.notePlayerCommand();
      const ok = agent.goTo(hit.ground.x, hit.ground.z);
      if (ok) cue.showAt(hit.ground.x, hit.ground.z);
    }
  });
  tapInput.onHover = setHover;

  // --- simulation ticks (all intervals & thresholds from tuning.json / stats.json) ---
  let decayAcc = 0, gainAcc = 0;
  const simTick = (dt: number) => {
    decayAcc += dt;
    const decayEvery = data.tuning.simulation.needsDecayTickSeconds;
    while (decayAcc >= decayEvery) {
      decayAcc -= decayEvery;
      stats.decayTick();
      applyEnvironment();
      autonomy.maybeAct(); // free will evaluates on the decay tick
      // quest triggers/completions evaluate on the same tick (§3.2: "same reuse-an-existing-interval convention")
      quests.tick(
        Object.fromEntries(stats.needs),
        Object.fromEntries(stats.skills),
        { hour: Math.floor(gameSeconds / 3600), day: gameDay },
      );
    }

    gainAcc += dt;
    const gainEvery = data.tuning.simulation.activityGainTickSeconds;
    while (gainAcc >= gainEvery) {
      gainAcc -= gainEvery;
      const active = agent.current;
      if (active) {
        stats.applyGains(active.action);
        // auto-stop when the action's primary need is satisfied
        const pn = active.action.primaryNeed;
        if (pn && (stats.needs.get(pn) ?? 0) >= data.tuning.autonomy.stopAtThreshold) {
          agent.stopAction();
        }
      }
    }
  };

  let hudAcc = 0;

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.resize(window.innerWidth / window.innerHeight);
  });

  // --- data hot-reload (design pillar: tuning is play-test-live) ---
  let currentMapId = data.map.id;
  watchData((fresh) => {
    data = fresh;
    scene.remove(world);
    disposeGroup(world);
    world = buildWorld(data);
    doors = buildDoors(data);
    world.add(doors.group);
    scene.add(world);
    cam.retune(data.tuning.camera, data.map);
    grid = bakeNavGrid(data.map, data.assets);
    agent.retune(data.tuning, grid);
    if (data.map.id !== currentMapId) {
      // map switch (tuning.map.active changed) — respawn the sim on the new map
      currentMapId = data.map.id;
      agent.teleportTo(data.map.spawn.pos[0], data.map.spawn.pos[1], data.map.spawn.facingDeg);
      hud.hideActionMenu();
    }
    stats.retune(data.stats);
    hud.rebuildBars();
    applyEnvironment();
    quests.retune(data.quests, data.simstate); // definitions only — runtime quest/var state is untouched
    refreshQuestLog();
    if (data.tuning.character) {
      anim?.retune(data.tuning.character);
      anim?.setWalkSpeed(data.tuning.movement.walkSpeed);
      loadCharacter(); // no-op unless meshPath changed
    }
    flashDevbar();
  });

  devData.innerHTML = `data: <b>${data.assets.assets.length} assets</b> · <b>${data.stats.needs.length} needs</b> · <b>${data.stats.skills.filter(s => s.enabled !== false).length} skills</b> · <b>${data.interactions.actions.length} actions</b> · <b>${data.quests.quests.length} quests</b>`;

  // --- game clock (display only in Phase 0; drives day/night in Phase 1; day count feeds quests' time.day) ---
  let gameSeconds = 8 * 3600; // start the day at 08:00
  let gameDay = 1;
  const clockScale = () => 86400 / data.tuning.time.secondsPerGameDay;

  // --- render loop ---
  let frames = 0, fpsTimer = 0, last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const sdt = dt * hud.speed; // simulation time: pause/1×/2×/3× scales everything below

    gameSeconds += sdt * clockScale();
    while (gameSeconds >= 86400) { gameSeconds -= 86400; gameDay++; }
    const h = Math.floor(gameSeconds / 3600), m = Math.floor((gameSeconds % 3600) / 60);
    devClock.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    hud.setClock(h, m);
    applyDayNight(lights, scene, gameSeconds / 3600, data.tuning.time.nightStartHour, data.tuning.time.nightEndHour);

    agent.update(sdt);
    // doors advance on the same sim time as the animation mixer (pause freezes them mid-swing,
    // 2×/3× speeds them up) — reuses this per-frame loop, no dedicated door timer (§7.1).
    const simPos: [number, number] = [sim.position.x, sim.position.z];
    const simPath = agent.getPathPoints();
    for (const d of doors.instances) d.update(sdt, simPos, simPath);
    anim?.update(sdt); // sim time: pause freezes the character, 2×/3× speed it up
    cue.update(dt); // UI feedback stays real-time
    autonomy.update(sdt);
    simTick(sdt);
    hudAcc += dt;
    if (hudAcc >= 0.25) { hudAcc = 0; hud.refresh(); } // 4 Hz is plenty for bars

    frames++; fpsTimer += dt;
    if (fpsTimer >= 1) { devFps.textContent = `${frames} fps`; frames = 0; fpsTimer = 0; }

    renderer.render(scene, cam.camera);
  });

  boot.classList.add('done');
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && !o.userData.sharedResource) { // GLB clones share the cached template's buffers
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
