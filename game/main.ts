// main.ts — Condo Life Web, Phase 0 skeleton.
// Proves the full pipeline: data/*.json → three.js scene → phone screen, with live data hot-reload.
// Simulation (needs/autonomy/pathfinding) arrives in Phase 1 and will read the same data objects.

import * as THREE from 'three';
import { loadAll, watchData, type GameData } from './data';
import { TouchCamera } from './camera';
import { buildWorld, makeSimStandIn, makeLights, applyDayNight, loadRiggedCharacter, normalizeMeshUrl } from './world';
import { buildDoors } from './doors';
import { AnimController } from './anim';
import { bakeNavGrid } from './nav';
import { TapInput, type TapResult } from './input';
import { SimAgent, ClickCue, findSeatFor } from './sim';
import { SimStats } from './stats';
import { Hud } from './ui';
import { Autonomy } from './autonomy';
import { QuestRunner, type EvalContext } from './quests';
import { AccidentsController, resolveTapAssetId } from './accidents';
import { BuyModeController, catalogCategories, filterCatalog, isAffordable, iconFallbackColor, iconFallbackInitials } from './buymode';
import { createMarkerInstance, type MarkerInstance } from './marker';

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

  // --- accidents (PROJECT_CONTEXT.md §7.3): closures over the live `let world`/`grid` so a
  // hot-reload rebake/rebuild is picked up automatically, same pattern as Autonomy below.
  const accidents = new AccidentsController(() => data, () => world, () => grid);

  // --- Buy/Sell mode (§7.6): overlay of player purchases/moves/sells layered over
  // data.map.placedObjects (never written back to the map file — see buymode.ts's module doc
  // comment). `rebakeNav` is the single place that feeds the overlay's EFFECTIVE placed-object
  // list (designer objects with overrides applied, minus sold, plus player additions) into
  // bakeNavGrid — used by both buy-mode actions and the ordinary hot-reload rebake below, so
  // overlay changes always survive a tuning/map/asset edit landing mid-session.
  const buyMode = new BuyModeController(() => data, () => world);
  const rebakeNav = () => {
    grid = bakeNavGrid({ ...data.map, placedObjects: buyMode.effectivePlacedObjectsList() }, data.assets);
    agent.retune(data.tuning, grid);
  };

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

  // --- overhead marker (§7.7): an INDEPENDENT top-level object tracking `sim`'s position only
  // (never its rotation) — see game/marker.ts's module doc comment for why it isn't literally
  // parented under `sim` (loadCharacter's `sim.clear()` on every rig reload would delete it).
  // No character block → no marker, same precedent as the rig itself (`loadCharacter` no-ops
  // without `meshPath`).
  let marker: MarkerInstance | null = data.tuning.character ? createMarkerInstance(scene, sim, data.tuning.character) : null;

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

  // Environment need (Sims "Room" score) = Σ environment scores of placed objects + any
  // currently-live accident instances (§7.3: fire/puddles ship negative environmentScore and
  // should drag the room score down while present — accidents.registry.all is the live list).
  const environmentScore = () => {
    const byId = new Map(data.assets.assets.map((a) => [a.id, a]));
    const placedSum = data.map.placedObjects.reduce((sum, p) => sum + (byId.get(p.asset)?.environmentScore ?? 0), 0);
    const accidentSum = accidents.registry.all.reduce((sum, inst) => sum + (byId.get(inst.accidentId)?.environmentScore ?? 0), 0);
    return placedSum + accidentSum;
  };
  const envNeedId = () => data.stats.needs.find((n) => n.computed)?.id;
  const applyEnvironment = () => { const id = envNeedId(); if (id) stats.setComputed(id, environmentScore()); };
  applyEnvironment();

  const autonomy = new Autonomy(() => data, () => world, agent, stats, accidents);

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
  agent.onActionStop = (a) => {
    hud.hideActivity();
    anim?.play('idle');
    // §7.3: roll for a new accident (normal asset finishing a use) or despawn one (a cleanup
    // action just completed on an accident instance) — onActionStop fires for every stop
    // reason (natural auto-stop, player cancel, override), which is deliberate: see
    // accidents.ts's module doc comment for why "finishes" can't mean "auto-stopped only".
    const assetId = a.target.userData?.assetId as string | undefined;
    const def = assetId ? data.assets.assets.find((x) => x.id === assetId) : undefined;
    if (def?.category === 'accident') {
      accidents.maybeCleanup(a.target, a.action.id);
    } else if (def) {
      const ctx: EvalContext = {
        needs: Object.fromEntries(stats.needs),
        skills: Object.fromEntries(stats.skills),
        funds: quests.funds,
        time: { hour: Math.floor(gameSeconds / 3600), day: gameDay },
        vars: quests.vars,
        quests: quests.quests,
      };
      accidents.rollFor(a.target, def, ctx);
    }
  };
  hud.onCancelAction = () => { autonomy.notePlayerCommand(); agent.stopAction(); };

  // --- Buy/Sell mode tap handling (§7.6): a tap while `buyMode.active` never reaches the normal
  // gameplay routing below (tap-to-go / open an action menu) — it either repositions the pending
  // placement/move ghost (tap-only, matching this game's existing tap-first interaction model —
  // see buymode.ts's moveGhostTo doc comment), or selects a placed instance to show the
  // Move/Rotate/Sell chips.
  const handleBuyModeTap = (hit: TapResult) => {
    if (buyMode.selection && buyMode.selection.kind !== 'selected') {
      if (hit.ground) buyMode.moveGhostTo(hit.ground.x, hit.ground.z);
      return;
    }
    if (hit.object) {
      const inst = buyMode.instanceForObject(hit.object);
      if (inst && buyMode.select(inst) && buyMode.selection?.kind === 'selected') {
        hud.showSelectionChips(buyMode.selection.def.name, buyMode.selection.def.sellPrice, data.tuning.economy.currencyName);
        return;
      }
    }
    buyMode.deselect();
    hud.hideSelectionChips();
  };

  const tapInput = new TapInput(renderer.domElement, cam.camera, () => world, (hit) => {
    if (buyMode.active) { handleBuyModeTap(hit); return; }
    if (hit.object) {
      const assetId = hit.object.userData.assetId as string;
      let asset = data.assets.assets.find((a) => a.id === assetId);
      let target = hit.object;
      // §7.3 hierarchy: tapping a base asset that's currently blocked by an overlapping
      // accident redirects the whole interaction (menu + walk/action target) onto the
      // accident instance itself — "impossible to cook while the kitchen is on fire".
      if (asset && asset.category !== 'accident') {
        const blocking = accidents.blockingFor(hit.object, asset);
        const effectiveId = resolveTapAssetId(asset.id, blocking);
        if (blocking && effectiveId === blocking.accidentId) {
          const blockingDef = data.assets.assets.find((a) => a.id === effectiveId);
          const blockingObj = accidents.groupFor(blocking.key);
          if (blockingDef && blockingObj) { asset = blockingDef; target = blockingObj; }
        }
      }
      if (asset) {
        const actions = asset.interactions
          .map((id) => data.interactions.actions.find((x) => x.id === id))
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (actions.length > 0) {
          const resolvedAsset = asset;
          setSelected(target);
          hud.showActionMenu(resolvedAsset, actions, (action) => {
            autonomy.notePlayerCommand();
            const seat = action.seatAware ? findSeatFor(world, data, target) : null;
            if (agent.orderAction(action, target, seat, resolvedAsset)) cue.showAt(target.position.x, target.position.z);
            else console.log('no path to object', resolvedAsset.id);
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

  // --- Buy/Sell mode HUD wiring (§7.6) ---
  let buyActiveCategory = '';
  let buySearchQuery = '';
  /** set whenever a buy/sell/move actually lands, so closing buy mode knows whether the nav grid
   *  (and therefore any in-flight sim path) might have changed underneath it — see onBuyClose. */
  let buyModeChangedSomething = false;
  const buyIsUnlocked = (assetId: string) => quests.isAssetUnlocked(assetId);
  const currencyName = () => data.tuning.economy.currencyName;

  const refreshBuyCatalog = () => {
    const categories = catalogCategories(data.assets, buyIsUnlocked);
    if (!categories.includes(buyActiveCategory)) buyActiveCategory = categories[0] ?? '';
    const items = filterCatalog(data.assets.assets, buyIsUnlocked, { category: buyActiveCategory, search: buySearchQuery })
      .map((a) => ({
        id: a.id, name: a.name, price: a.buyPrice, affordable: isAffordable(a, quests.funds),
        icon: a.icon ? normalizeMeshUrl(a.icon) : undefined,
        fallbackColor: iconFallbackColor(a.category), fallbackInitials: iconFallbackInitials(a.name),
      }));
    hud.renderCatalog(
      categories.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })),
      buyActiveCategory, items, currencyName(),
    );
  };

  hud.setFunds(quests.funds, currencyName());

  hud.onBuyOpen = () => {
    buyMode.enter();
    hud.setBuyModeActive(true);
    buyActiveCategory = '';
    buySearchQuery = '';
    buyModeChangedSomething = false;
    hud.setBuySearchValue('');
    refreshBuyCatalog();
  };
  hud.onBuyClose = () => {
    buyMode.exit();
    hud.setBuyModeActive(false);
    // Safety net: sim-time freeze means the agent never advances while shopping, but it may have
    // been mid-route when buy mode opened, and a rebake during shopping can invalidate that stale
    // path (moved/sold/bought furniture). Cancelling in place is simpler and safer than trying to
    // resume a path computed against a nav grid that may no longer match.
    if (buyModeChangedSomething && agent.isMoving) agent.goTo(sim.position.x, sim.position.z);
  };
  hud.onBuyCategoryPick = (cat) => { buyActiveCategory = cat; refreshBuyCatalog(); };
  hud.onBuySearch = (q) => { buySearchQuery = q; refreshBuyCatalog(); };
  hud.onBuyItemPick = (assetId) => {
    const def = data.assets.assets.find((a) => a.id === assetId);
    if (!def) return;
    buyMode.startPlacing(def);
    hud.hideSelectionChips();
    hud.showGhostControls();
  };
  hud.onGhostRotate = () => buyMode.rotateGhost();
  hud.onGhostConfirm = () => {
    const result = buyMode.confirm(quests.funds);
    if (!result) return;
    if (result.kind === 'bought') {
      buyModeChangedSomething = true;
      quests.funds -= result.cost;
      hud.setFunds(quests.funds, currencyName());
      rebakeNav();
      refreshBuyCatalog();
      hud.hideGhostControls();
    } else if (result.kind === 'moved') {
      buyModeChangedSomething = true;
      rebakeNav();
      hud.hideGhostControls();
      if (buyMode.selection?.kind === 'selected') hud.showSelectionChips(buyMode.selection.def.name, buyMode.selection.def.sellPrice, currencyName());
    } else {
      // Placement/funds flipped between the last ghost move and the confirm tap (e.g. another
      // purchase just landed on the same spot) — leave the ghost up so the player can adjust;
      // the card/ghost tint already gave affordability/validity feedback before this point.
      console.warn('buy mode confirm failed:', result.reason);
    }
  };
  hud.onGhostCancel = () => {
    const wasMoving = buyMode.selection?.kind === 'moving';
    buyMode.cancel();
    hud.hideGhostControls();
    if (wasMoving && buyMode.selection?.kind === 'selected') {
      hud.showSelectionChips(buyMode.selection.def.name, buyMode.selection.def.sellPrice, currencyName());
    }
  };
  hud.onSelectionMove = () => {
    buyMode.beginMoveSelected();
    hud.hideSelectionChips();
    hud.showGhostControls();
  };
  hud.onSelectionRotate = () => {
    if (buyMode.rotateSelectedInPlace()) { buyModeChangedSomething = true; rebakeNav(); }
    if (buyMode.selection?.kind === 'selected') hud.showSelectionChips(buyMode.selection.def.name, buyMode.selection.def.sellPrice, currencyName());
  };
  hud.onSelectionSell = () => {
    const refund = buyMode.sellSelected();
    if (refund > 0) {
      buyModeChangedSomething = true;
      quests.funds += refund;
      hud.setFunds(quests.funds, currencyName());
      rebakeNav();
      refreshBuyCatalog();
    }
    hud.hideSelectionChips();
  };
  hud.onSelectionCancel = () => {
    buyMode.deselect();
    hud.hideSelectionChips();
  };

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

  const handleResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.resize(window.innerWidth / window.innerHeight);
  };
  window.addEventListener('resize', handleResize);
  // Mobile polish: 'resize' already fires on orientation change in every modern engine, but
  // some mobile browsers report stale innerWidth/innerHeight for a brief moment during the
  // rotation animation — re-run once more shortly after 'orientationchange' as a safety net
  // (harmless no-op double-call when dimensions already settled).
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));

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
    // §7.3: buildWorld() has no notion of runtime accident instances (never in map data) —
    // re-parent every LIVE fire/puddle into the freshly-built world so hot-reload never wipes them.
    accidents.reattach(world);
    // §7.6: same reasoning — buildWorld() rebuilds designer objects fresh (undoing any buy-mode
    // sold/moved override) and knows nothing about player-purchased additions; reattach patches
    // both back onto the new world. rebakeNav() (not a raw bakeNavGrid call) so the overlay keeps
    // feeding the nav grid across hot-reloads too.
    buyMode.reattach(world);
    cam.retune(data.tuning.camera, data.map);
    rebakeNav();
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
      if (!marker) marker = createMarkerInstance(scene, sim, data.tuning.character);
    } else if (marker) {
      marker.dispose();
      marker = null;
    }
    hud.setFunds(quests.funds, currencyName());
    if (buyMode.active) refreshBuyCatalog(); // asset prices/icons/gates may have changed mid-shop
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
    // §7.6: buy mode forces sim time to a hard 0 regardless of the player's chosen 1×/2×/3×/pause
    // selection — implemented as this one-line override rather than mutating hud.speed, so the
    // player's speed choice is completely undisturbed by entering/exiting buy mode (it simply
    // doesn't advance while shopping, and resumes exactly where it left off afterward). Real-time
    // UI (click cue, camera) below still uses raw `dt`, matching Sims pausing in Buy Mode while
    // the camera stays free — and freezing agent.update() this way also means the sim can never be
    // mid-move when a buy-mode nav rebake happens (see the onBuyClose safety net for the leftover
    // stale-path edge case when it WAS mid-route at the moment buy mode opened).
    const sdt = buyMode.active ? 0 : dt * hud.speed;

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
    // §7.5: animated-GIF sprites (furniture AND accidents — anything attached via world.ts's
    // shared attachMesh) advance on the SAME sim time as doors/the animation mixer. One traversal
    // covers every group in the current world (accidents' live groups and doors.group are both
    // parented under it), so a sprite gets its frames ticked with no extra per-caller wiring.
    world.traverse((o) => { o.userData.spriteUpdate?.(sdt); });
    anim?.update(sdt); // sim time: pause freezes the character, 2×/3× speed it up
    if (marker && data.tuning.character) marker.update(sdt, data.tuning.character); // §7.7: same sim time as the mixer/doors/sprites
    cue.update(dt); // UI feedback stays real-time
    autonomy.update(sdt);
    simTick(sdt);
    hudAcc += dt;
    if (hudAcc >= 0.25) { hudAcc = 0; hud.refresh(); hud.setFunds(quests.funds, currencyName()); } // 4 Hz is plenty for bars/funds

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
