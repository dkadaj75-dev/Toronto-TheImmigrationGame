// main.ts — Condo Life Web, Phase 0 skeleton.
// Proves the full pipeline: data/*.json → three.js scene → phone screen, with live data hot-reload.
// Simulation (needs/autonomy/pathfinding) arrives in Phase 1 and will read the same data objects.

import * as THREE from 'three';
import { loadAll, loadAllMaps, setRuntimeHomeMap, watchData, type ActionDef, type AssetDef, type GameData, type MapData } from './data';
import { TouchCamera } from './camera';
import { applyWallCutView, buildWorld, makeSimStandIn, makeLights, applyDayNight, applyExteriorScene, loadRiggedCharacter, normalizeMeshUrl, setAssetObjectOn } from './world';
import { buildDoors, ExteriorDoorTransit, type ExteriorDoorTransitRequest } from './doors';
import { AnimController } from './anim';
import { bakeNavGrid } from './nav';
import { TapInput, type TapResult } from './input';
import { SimAgent, ClickCue, findSeatFor, type ActiveAction } from './sim';
import { computeEnvironmentScore, SimStats, skillPointProgress, primarySkillGain } from './stats';
import { Hud } from './ui';
import { Autonomy } from './autonomy';
import { QuestRunner, isActionAvailable, type EvalContext } from './quests';
import { VisaMachine } from './visas';
import { PhoneJobSearch, applyForJob, applyForVisa, jobListingViews, jobSwitchPrompt, pendingDaysRemaining, rentalCardViews, visaApplicationViews } from './phone';
import { listRentals, PendingMoveTracker } from './rental';
import { FinanceState, decideRepoSeizure } from './bills';
import { WorkTracker, applyNeedsCost, decideAutoDepart, isLeaveForWorkAvailable, isScheduledWorkWindow, isWithinDepartureWindow, jobLevelPay, jobLevelTitle, shouldStartVisaGrace, weekdayName, type WorkReturnPoint, type WorkTickEvent } from './work';
import { computeHappiness } from './happiness';
import { AccidentsController, resolveTapAssetId, shouldDespawnOnCleanup, shouldRemovePlacedOnCleanup } from './accidents';
import { GarbageController, wasteItemCount } from './garbage';
import { BuyModeController, catalogCategories, filterCatalog, isAffordable, iconFallbackColor, iconFallbackInitials, isSelectableForSell } from './buymode';
import { createMarkerInstance, type MarkerInstance } from './marker';
import { createCensorInstance, type CensorInstance } from './censor';
import { createProgressBarInstance, createSkillBarInstance, resolveSkillBarConfig, type ProgressBarInstance, type SkillBarInstance } from './progressbar';
import { computeDurationSeconds, isDurationComplete } from './duration';
import { AudioManager, loopSoundFor } from './audio';
import { initBladderFailureState, checkBladderFailure, rearmBladderFailure } from './bladder';
import { FoodRegistry, foodAssetForActionEvent, firstLegSeatAware, actionAfterSourceFetch, cookedMealHungerGain, resolveFoodConfig, wasteAssetForDroppedFood } from './food';
import { initEnergyCollapseState, StarvationTracker, tickEnergyCollapse } from './survival';
import { formatMoneyChange, formatSkillUp, skillLevelUps } from './feedback';
import { AssetStateRegistry, isAssetStateActionAvailable, isStatefulAsset, powerStateForAction } from './assetstate';
import { HydroMeter, resolveAssetPower, HYDRO_BILL_ID } from './hydro';
import { InitialLoadTracker, phraseAt } from './loading';
import { applyTheme } from './theme';
import { compatibility, visitOutcome, type InteractionDef } from './social';
import { SocialRuntime } from './socialruntime';
import { availableSocialInteractions, matchesSocialTarget, pairedAssetPositions, SocialInteractionSession, socialActionDef, socialAnimationFor, socialAutonomyCandidates, socialNpcActionDef, socialRoutingDecision, socialScoringTarget } from './social-interactions';
import { isNpcAvailable, NpcVisitorController, type NpcDef } from './npc';
import { mutualFacingDeg, usePoseFor } from './facing';
import { contactViews, PhoneContactSession, phoneAutonomyCandidates } from './contacts';
import { visitGate, VisitAwayTracker, type VisitReturnEvent } from './visit';
import { crossedNightWindowBoundary, inspectAmbience, nightEnvironmentBonus, sleepBlockDecision, type AmbienceAssetInstance } from './ambience';

/** The logical animation state for an in-progress action: `groundSit` (ROADMAP_NEXT item 2 —
 *  a seat-aware action with no eligible seat in range) plays the dedicated 'sit_ground' state
 *  instead of the action's own `animation` field, which would otherwise imply sitting/lying ON
 *  the target object itself. */
function animStateFor(a: ActiveAction): string {
  return a.groundSit ? 'sit_ground' : a.action.animation || 'idle';
}

/** ROADMAP_NEXT B3-5: actions whose completed cleanup "carries" the cleared transient to a garbage
 *  can instead of despawning it in place — dirty_dishes (clean_up) and ash (sweep). `mop` (water_
 *  puddle/pee_puddle) is deliberately excluded per the brief ("puddles just vanish"). */
const CARRY_TO_GARBAGE_ACTIONS = new Set(['clean_up', 'sweep']);

const app = document.getElementById('app')!;
const boot = document.getElementById('boot')!;
const loadingPhrase = document.getElementById('loading-phrase')!;
const loadingTrack = document.getElementById('loading-track')!;
const loadingFill = document.getElementById('loading-fill')!;
const loadingCount = document.getElementById('loading-count')!;
const loadingTap = document.getElementById('loading-tap') as HTMLButtonElement;

async function start() {
  let data: GameData;
  try {
    data = await loadAll();
  } catch (err) {
    boot.textContent = `data failed to load — is server.js running? (${(err as Error).message})`;
    return;
  }

  // B7-7 presentation starts once boot data is available. The initial data fetch still uses the
  // same dark overlay; loading.json itself is boot-only and intentionally has no live retune path.
  const loading = data.loading;
  const phrases = loading.phrases.filter((phrase) => typeof phrase === 'string' && phrase.trim());
  const phraseStarted = performance.now();
  const updateLoadingPhrase = () => {
    loadingPhrase.textContent = phraseAt(phrases, (performance.now() - phraseStarted) / 1000, loading.phraseIntervalSeconds);
  };
  updateLoadingPhrase();
  const phraseTimer = window.setInterval(updateLoadingPhrase, 250);
  if (loading.background) boot.style.backgroundImage = `url("${normalizeMeshUrl(loading.background).replace(/"/g, '%22')}")`;
  boot.style.setProperty('--loading-fill', loading.bar?.fillColor ?? '#9fd08c');
  boot.style.setProperty('--loading-track', loading.bar?.trackColor ?? '#313b50');
  boot.style.setProperty('--loading-height', `${Math.max(2, loading.bar?.height ?? 14)}px`);
  loadingTap.hidden = !loading.music;
  loadingTap.addEventListener('click', () => { loadingTap.hidden = true; }, { once: true });

  const initialLoads = new InitialLoadTracker();
  let initialLoadingActive = true;
  let initialLoadRegistrationOpen = true;
  function trackInitialLoad<T>(promise: Promise<T>): Promise<T> { return initialLoads.track(promise); }
  initialLoads.subscribe((progress) => {
    const percent = Math.round(progress.ratio * 100);
    loadingFill.style.width = `${percent}%`;
    loadingTrack.setAttribute('aria-valuenow', String(percent));
    loadingCount.textContent = progress.started > 0
      ? `${progress.settled} / ${progress.started} arrivals cleared`
      : 'Preparing paperwork…';
  });

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // mobile perf budget
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3346);

  const assetStates = new AssetStateRegistry();
  // Hydro usage meter (2026-07-17): accumulates ON-hours x per-asset power rate across a billing
  // period; folded onto the Hydro bill each cycle (see the day-boundary bill tick). syncAssetStates
  // recomputes the combined rate of ON metered assets each frame into currentHydroRate.
  const hydro = new HydroMeter();
  let currentHydroRate = 0;
  let wallCutActive = false; // in-page preference only; deliberately not serialized
  let world = buildWorld(data, trackInitialLoad);
  let doors = buildDoors(data, trackInitialLoad);
  const exteriorDoorTransit = new ExteriorDoorTransit();
  world.add(doors.group);
  applyWallCutView(world, wallCutActive, data.tuning.view?.wallCutHeight ?? 1);
  const lights = makeLights();
  scene.add(world, lights);
  applyExteriorScene(scene, world, data.map); // D4: sky/ground/backdrop/fog for this map (sparse — no-op on a void map)

  const sim = makeSimStandIn();
  sim.position.set(data.map.spawn.pos[0], 0, data.map.spawn.pos[1]);
  sim.rotation.y = THREE.MathUtils.degToRad(data.map.spawn.facingDeg);
  scene.add(sim);

  const cam = new TouchCamera(window.innerWidth / window.innerHeight, data.tuning.camera, data.map);
  cam.attach(renderer.domElement);

  // --- Phase 1: tap-to-go + needs/skills simulation + actions ---
  // id → AssetDef lookup for SimAgent's sit/lie perch resolution (usePoseFor, §7.8) — rebuilt
  // wherever `data` is reassigned (rebakeNav, below) so an Asset Editor usePose edit applies live.
  const assetsById = (d: GameData) => new Map(d.assets.assets.map((a) => [a.id, a]));
  let grid = bakeNavGrid(data.map, data.assets);
  const agent = new SimAgent(sim, grid, data.tuning, assetsById(data));
  const cue = new ClickCue();
  scene.add(cue.object);

  // --- Buy/Sell mode (§7.6): overlay of player purchases/moves/sells layered over
  // data.map.placedObjects (never written back to the map file — see buymode.ts's module doc
  // comment). `rebakeNav` is the single place that feeds the overlay's EFFECTIVE placed-object
  // list (designer objects with overrides applied, minus sold, plus player additions) into
  // bakeNavGrid — used by both buy-mode actions and the ordinary hot-reload rebake below, so
  // overlay changes always survive a tuning/map/asset edit landing mid-session.
  const buyMode = new BuyModeController(() => data, () => world);
  const rebakeNav = () => {
    grid = bakeNavGrid({ ...data.map, placedObjects: buyMode.effectivePlacedObjectsList() }, data.assets);
    agent.retune(data.tuning, grid, assetsById(data));
  };

  // --- ROADMAP_NEXT B2-5: fire panic — interrupts whatever the sim is doing and plays 'panic' for
  // tuning.fire.panicSeconds whenever ANY fire spawns (initial risk roll OR spread — see
  // accidents.ts's onFireSpawned hook, wired below). Mirrors triggerBladderFailure's shape exactly
  // (own tiny elapsed/total timer alongside durationState/peeState, forceCooldown so autonomy can't
  // immediately walk the sim toward/away from the fire mid-panic) — declared here, ahead of
  // `accidents`/`autonomy`, so it can be passed as the controller's onFireSpawned callback; the
  // `autonomy`/`anim` references inside are safe despite being declared later in this function
  // (same "closures over `let`/`const` bindings assigned later are fine, since this only ever runs
  // on a later tick" precedent as `buildEvalContext` below). Only fires for a fire on THIS map
  // (currently the only map that exists, so always true — no extra gating needed).
  let panicState: { elapsed: number; totalSeconds: number } | null = null;
  const triggerPanic = () => {
    exteriorDoorTransit.cancel();
    if (playerAway()) return; // the sim is off-lot (work OR visiting) and cannot react to a home fire while away
    agent.stopAction(); // fires onActionStop → animation reset to idle, activity chip hidden, etc.
    cancelCarry(); // ROADMAP_NEXT B3-5: panic interrupts an in-progress carry-to-garbage walk too
    const panicSeconds = data.tuning.fire?.panicSeconds ?? 3;
    autonomy.forceCooldown(panicSeconds);
    anim?.play('panic');
    panicState = { elapsed: 0, totalSeconds: panicSeconds };
  };

  // --- accidents (PROJECT_CONTEXT.md §7.3 + ROADMAP_NEXT item 6 fire destruction/spread):
  // closures over the live `let world`/`grid` so a hot-reload rebake/rebuild is picked up
  // automatically, same pattern as Autonomy below. `destroyBase` is how a burned-out fire removes
  // its base object from the world WITHOUT accidents.ts importing buymode.ts (that would be a
  // circular import — buymode.ts already imports accidents.ts's footprintRect/rectsOverlap):
  // resolve the live Object3D to a buy-mode EffectiveInstance and destroy it outright (no refund),
  // then rebake nav since a destroyed object frees up floor space.
  const accidents = new AccidentsController(() => data, () => world, () => grid, (obj) => {
    const inst = buyMode.instanceForObject(obj);
    if (inst) { buyMode.destroyInstance(inst); rebakeNav(); applyEnvironment(); garbage.syncFillBars(); }
  }, () => triggerPanic());

  // --- garbage cans + autonomous tidying (ROADMAP_NEXT item 10): scans the live world for placed
  // garbage-can instances (closures over the same `let world` as accidents, so a hot-reload
  // rebuild is picked up automatically) and reuses `accidents.spawnTransient` for the "drop it on
  // the ground" case (dirty_dishes is a transient asset) — see game/garbage.ts's module doc comment.
  const garbage = new GarbageController(() => data, () => world, scene);
  garbage.syncFillBars(); // designer request (2026-07-16): draw any can's fill bar visible at boot (showWhenEmpty)

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
    loadRiggedCharacter(c, initialLoadRegistrationOpen ? trackInitialLoad : undefined)
      .then(({ model, clips }) => {
        if (!data.tuning.character || sigOf(data.tuning.character) !== sig) return; // changed again mid-flight
        disposeGroup(sim); // free the capsule (or a previous rig)
        sim.clear();
        sim.add(model);
        anim = new AnimController(model, clips, data.tuning.character!);
        console.info(`character clips available: ${clips.map((k) => k.name).join(', ')} — map them in tuning.character.clipMap`);
        agent.hasRig = true;
        // enter the correct state immediately (mid-walk / mid-action hot-swaps included)
        anim.play(agent.current ? animStateFor(agent.current) : agent.isMoving ? 'walk' : 'idle');
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
  let marker: MarkerInstance | null = data.tuning.character ? createMarkerInstance(scene, sim, data.tuning.character, trackInitialLoad) : null;
  initialLoadRegistrationOpen = false;
  initialLoads.seal(); // every initial world/door/character/marker promise has now been registered

  // --- censor pixelation (ROADMAP_NEXT B2-3): always created (no character-block gate — it's a
  // pure overlay quad, not part of the rig), visibility polled from agent.current every render
  // frame below rather than event-driven — see game/censor.ts's module doc comment.
  const censor: CensorInstance = createCensorInstance(scene);

  // --- ROADMAP_NEXT B2-5: progress bar above the sim's head, visible only while the active action
  // has a `duration` (§7.11 + this slice's modifiers) — always created (no character-block gate,
  // same convention as censor above; it's a procedural overlay, not part of the rig) and shown
  // purely by polling `durationState` every render frame below.
  const progressBar: ProgressBarInstance = createProgressBarInstance(scene);
  // ITEM 2 (2026-07-17): the second, always-visible bar shown while the current action has skillGains
  // (primary skill = largest gain), tracking that skill's fraction toward its next point.
  const skillBar: SkillBarInstance = createSkillBarInstance(scene);

  agent.onLocomotionChange = (moving) => {
    if (anim) {
      if (moving) {
        anim.play('walk');
        anim.setWalkSpeed(data.tuning.movement.walkSpeed);
      } else if (!agent.current) {
        anim.play('idle'); // arrival into an action is handled by onActionStart instead
      }
    }
    // The sparse night-light contribution is sim-relative (radius + room), so finishing a route
    // is an Environment event even though ordinary furniture moves/rotations do not change score.
    if (!moving) applyEnvironment();
  };

  const stats = new SimStats(data.stats, data.tuning.skills?.growthCurveExp ?? 1.5);
  const hud = new Hud(stats);
  applyTheme(data.theme);
  hud.setPhoneIcon(data.tuning.phone?.icon ?? '/icons/Smartphone.png');
  hud.onWallCutToggle = () => {
    wallCutActive = !wallCutActive;
    applyWallCutView(world, wallCutActive, data.tuning.view?.wallCutHeight ?? 1);
    hud.setWallCutActive(wallCutActive);
  };

  // Environment need (Sims "Room" score) = Σ environment scores of placed objects + any
  // currently-live accident instances (§7.3: fire/puddles ship negative environmentScore and
  // should drag the room score down while present — accidents.registry.all is the live list).
  // B10-11: reads buyMode's EFFECTIVE placed-object list (purchases included, sold/destroyed
  // instances excluded), not the raw designer-authored map.placedObjects — so environment is a
  // pure aggregate of what's actually present and never drifts (a mopped puddle or a
  // fire-destroyed asset drops out immediately instead of scoring forever).
  const environmentScore = () => {
    const byId = new Map(data.assets.assets.map((a) => [a.id, a]));
    const environmentScoreFor = (assetId: string) => byId.get(assetId)?.environmentScore ?? 0;
    return computeEnvironmentScore(
      buyMode.effectivePlacedObjectsList().map((p) => p.asset),
      accidents.registry.all.map((inst) => inst.accidentId),
      environmentScoreFor,
      ambientEnvironmentBonus(),
    );
  };
  const envNeedId = () => data.stats.needs.find((n) => n.computed)?.id;
  const applyEnvironment = () => { const id = envNeedId(); if (id) stats.setComputed(id, environmentScore()); };

  const sleepAction = (action: Pick<ActionDef, 'id'>) => action.id === 'sleep' || action.id === 'nap';
  /** Live placed light/sound roots. Sold/destroyed objects are detached by BuyModeController, and
   * stable assetStateKey de-duplicates any nested meshes during this traversal. */
  const ambienceInstances = (): AmbienceAssetInstance[] => {
    const byId = assetsById(data);
    const seen = new Set<string>();
    const result: AmbienceAssetInstance[] = [];
    world.traverse((obj) => {
      const key = obj.userData.assetStateKey as string | undefined;
      const assetId = obj.userData.assetId as string | undefined;
      if (!key || !assetId || seen.has(key) || !obj.visible) return;
      const def = byId.get(assetId);
      if (!def || (!def.light && !def.sound)) return;
      seen.add(key);
      const p = obj.getWorldPosition(new THREE.Vector3());
      result.push({ key, def, position: [p.x, p.z] });
    });
    return result;
  };
  const ambienceMatchesAt = (position: [number, number]) => {
    const byId = assetsById(data);
    const room = {
      walls: data.map.walls,
      doors: data.map.doors,
      assetForDoor: (assetId: string | undefined) => assetId ? byId.get(assetId) : undefined,
      // A map doorway with no animated panel is a permanent aperture. An actual panel connects
      // rooms as soon as it has begun opening and blocks again when fully closed.
      isDoorOpen: (door: MapData['doors'][number]) =>
        doors.instances.find((instance) => instance.entry === door)?.isOpen() ?? true,
    };
    const radius = data.tuning.ambience?.radiusMeters ?? 5;
    return ambienceInstances().map((instance) => inspectAmbience(position, instance, assetStates, room, radius));
  };
  const sleepDecisionAt = (position: [number, number]) => sleepBlockDecision(
    ambienceMatchesAt(position), data.tuning.ambience?.sleepBlockingEnabled ?? true,
  );
  const ambientEnvironmentBonus = () => {
    if (data.tuning.ambience?.nightEnvironmentEnabled === false) return 0;
    return nightEnvironmentBonus(
      gameSeconds / 3600,
      data.tuning.time.nightStartHour,
      data.tuning.time.nightEndHour,
      ambienceMatchesAt([sim.position.x, sim.position.z]),
    );
  };

  if (!data.social) throw new Error('social.json failed to load');
  // Shared SOCIAL S4 state owner. S5 reuses this same instance for phone cooldowns/contacts;
  // serialize/restore stay exposed without coupling persistence to main.ts.
  const socialRuntime = new SocialRuntime(data.social);
  let autonomy: Autonomy;

  /** One transit entry point for visitors, work/visit departures and returns, and trash removal. */
  const requestExteriorTransit = (request: ExteriorDoorTransitRequest) =>
    exteriorDoorTransit.begin(doors.instances.find((door) => door.config.exterior), request);

  // --- SOCIAL S3: exactly one pending/active visitor. NpcVisitorController is the thin scene
  // adapter; its VisitLifecycle owns all timing/gating and exposes invite/canInvite/state for S5
  // plus endVisit/engage/autonomy-pause for S4. Unknown/missing social need ids are safe no-ops.
  const visitors = new NpcVisitorController({
    scene,
    getData: () => data,
    getWorld: () => world,
    getGrid: () => grid,
    getHour: () => gameSeconds / 3600,
    getEvalContext: buildEvalContext,
    getCompatibilityMultiplier: (npc) => data.social
      ? compatibility(Object.fromEntries(stats.personality), npc.personality, data.social).multiplier
      : 1,
    getRelationshipLevel: (npcId) => socialRuntime.relationships.levelFor(npcId),
    exteriorDoorUsable: (doorObject, doorDef) => !accidents.isBlocked(doorObject, doorDef),
    requestExteriorTransit,
    onCallFallback: (npc, outcome) => {
      socialRuntime.relationships.set(npc.id, socialRuntime.relationships.get(npc.id) + outcome.relationshipDelta);
      for (const [needId, delta] of Object.entries(outcome.needGains)) {
        const current = stats.needs.get(needId);
        if (current !== undefined) stats.needs.set(needId, Math.max(0, Math.min(100, current + delta)));
      }
    },
    feedback: (message) => hud.showQuestToast(
      message, 'started', data.tuning.quests.toastDurationSeconds * 1000,
    ),
  });

  let pairedSocial: {
    playerAction: ActiveAction['action']; npcAction: ActiveAction['action'];
    target: THREE.Object3D; targetDef: AssetDef; started: boolean;
  } | null = null;
  const socialSession = new SocialInteractionSession(
    socialRuntime.relationships,
    () => data.social!,
    {
      setNpcAutonomyPaused: (paused) => visitors.setAutonomyPaused(paused),
      stopNpcAction: () => { visitors.stopInteraction(); pairedSocial = null; },
      applyPlayerNeed: (needId, delta) => {
        const current = stats.needs.get(needId);
        if (current !== undefined) stats.needs.set(needId, Math.max(0, Math.min(100, current + delta)));
      },
      adjustNpcMeter: (delta) => visitors.adjustSocialMeter(delta),
      endVisit: (completed) => visitors.endVisit(completed),
    },
  );

  const phoneContactSession = new PhoneContactSession(
    socialRuntime.relationships,
    socialRuntime.phone,
    () => data.social!,
    {
      applyPlayerNeed: (needId, delta) => {
        const current = stats.needs.get(needId);
        if (current !== undefined) stats.needs.set(needId, Math.max(0, Math.min(100, current + delta)));
      },
    },
  );

  const currentVisitor = (): NpcDef | null => {
    const id = visitors.state.npcId;
    return id ? data.npcs?.npcs.find((npc) => npc.id === id) ?? null : null;
  };

  const orderSocialInteraction = (npc: NpcDef, interaction: InteractionDef): boolean => {
    const visitor = visitors.visitorObject;
    if (!visitor || visitors.state.phase !== 'visiting' || currentVisitor()?.id !== npc.id) return false;
    let target: THREE.Object3D = visitor;
    let targetDef: AssetDef | undefined;
    if (interaction.targetAsset?.trim()) {
      const candidates = world.children.flatMap((object) => {
        if (!object.visible || !object.parent) return [];
        const def = data.assets.assets.find((asset) => asset.id === object.userData.assetId);
        return def && matchesSocialTarget(interaction, def) ? [{ object, def }] : [];
      });
      candidates.sort((a, b) => sim.position.distanceToSquared(a.object.position) - sim.position.distanceToSquared(b.object.position));
      const chosen = candidates[0];
      if (!chosen) {
        hud.showQuestToast(`No ${interaction.targetAsset} is available`, 'started', 2500);
        return false;
      }
      target = chosen.object;
      targetDef = chosen.def;
    }
    socialSession.finish(false);
    const order = socialSession.begin(npc, interaction, Object.fromEntries(stats.personality));
    if (targetDef) {
      const decision = socialRoutingDecision(interaction, targetDef);
      const npcAction = socialNpcActionDef(interaction);
      if (!visitors.orderInteraction(npcAction, target, targetDef, decision.pose ?? undefined)) {
        socialSession.finish(false);
        return false;
      }
      pairedSocial = { playerAction: order.action, npcAction, target, targetDef, started: false };
    }
    const pose = targetDef ? socialRoutingDecision(interaction, targetDef).pose ?? undefined : undefined;
    if (!agent.orderAction(order.action, target, null, targetDef, false, pose)) {
      socialSession.finish(false);
      return false;
    }
    cue.showAt(target.position.x, target.position.z);
    return true;
  };

  autonomy = new Autonomy(
    () => data, () => world, agent, stats, accidents, buildEvalContext,
    {
      candidateAvailable: (action, object) => !sleepAction(action)
        || !sleepDecisionAt([object.position.x, object.position.z]).blocked,
      extraCandidates: () => {
        if (!data.social || socialSession.active || phoneContactSession.active) return [];
        if (visitors.state.phase === 'visiting') {
          const npc = currentVisitor();
          const object = visitors.visitorObject;
          if (!npc || !object) return [];
          return socialAutonomyCandidates(npc, socialRuntime.relationships, data.social).map((candidate) => ({
            object,
            action: candidate.action,
            scoringAsset: candidate.target,
            order: () => orderSocialInteraction(npc, candidate.interaction),
          }));
        }
        const evalContext = buildEvalContext();
        return phoneAutonomyCandidates(data.npcs?.npcs ?? [], {
          phone: socialRuntime.phone,
          data: data.social,
          behavior: data.behavior,
          eval: evalContext,
          nowMinutes: gameHourNow() * 60,
          hourNow: gameSeconds / 3600,
          visitorBusy: visitors.state.phase !== 'idle',
          canInvite: visitors.canInvite(),
          actionBusy: false,
        }).map((candidate) => ({
          object: sim,
          action: candidate.action,
          scoringAsset: candidate.target,
          order: () => candidate.kind === 'invite'
            ? visitors.invite(candidate.npcId)
            : startPhoneContact(candidate.npcId, candidate.kind),
        }));
      },
    },
  );

  // --- quest system (PROJECT_CONTEXT.md §3): runtime-only state, see quests.ts's persistence doc comment ---
  const quests = new QuestRunner(data.quests, data.simstate, data.tuning.economy.startingFunds);
  // --- going to work (PROJECT_CONTEXT.md §7.20 V3, ROADMAP_NEXT B3-8) ---
  // Pure/serializable attendance state lives in game/work.ts. main.ts owns only scene/UI/economy
  // effects. The current game-time/job helpers close over clock variables declared below, like the
  // existing buildEvalContext callback; they are only invoked after initialization is complete.
  const work = new WorkTracker();
  // --- SOCIAL S6: visiting an NPC's place (ROADMAP_SOCIAL.md §3 S6). Direct clone of the going-to-
  // work away-state: game/visit.ts's VisitAwayTracker is the pure/serializable clock (mirrors
  // WorkTracker), main.ts owns the same scene-hide/return effects. `playerAway()` folds work AND
  // visiting into the one "off-lot, cannot act" predicate every work.isAtWork call site already
  // gated on, so a visit is exactly as exclusive as a work shift.
  const visitAway = new VisitAwayTracker();
  let returnTransitPending = false;
  const playerAway = () => work.isAtWork || visitAway.isAway || returnTransitPending;
  // Remembers which NPC the in-flight 'visit_their_place' walk-to-door action is for; read only at
  // that action's own completion (see handleActionCompleted below) — a cancelled/interrupted walk
  // never reaches it, so nothing needs to be undone (side_effect_rule).
  let pendingVisitNpcId: string | null = null;
  let happiness = 0;
  const currentJob = () => data.jobs.jobs.find((job) => job.id === quests.vars.job) ?? null;
  const completedQuestLog: { name: string }[] = [];
  const refreshQuestLog = () => {
    const active = data.quests.quests
      .filter((q) => quests.quests[q.id] === 'active')
      .map((q) => ({ name: q.name, description: q.description }));
    hud.setQuestLog(active, completedQuestLog, data.tuning.quests.completedLogLimit);
  };
  quests.onQuestStarted = (q) => {
    hud.showQuestToast(`Quest started: ${q.name}`, 'started', data.tuning.quests.toastDurationSeconds * 1000, 'questStarted');
    refreshQuestLog();
  };
  quests.onQuestCompleted = (q) => {
    hud.showQuestToast(`Quest completed: ${q.name}`, 'completed', data.tuning.quests.toastDurationSeconds * 1000, 'questCompleted');
    completedQuestLog.push({ name: q.name });
    refreshQuestLog();
  };
  refreshQuestLog();

  // --- visa state machine (PROJECT_CONTEXT.md §7.20 V1, ROADMAP_NEXT B3-6) ---
  // Constructed with literal day 1 (not the `gameDay` variable, which is declared further below in
  // this same function and would be a TDZ error to read this early) — matches gameDay's own initial
  // value, so the visa's day-1 expiry math lines up with the clock the render loop later drives.
  let gameOverActive = false; // read by the render loop's sdt freeze (same pattern as buyMode.active)
  let repoOverlayActive = false;
  let debtGameOverPending = false;
  const visaMachine = new VisaMachine(data.visas, data.tuning.visa?.startStatus ?? 'visitor', 1);
  // §7.20: "vars.visaStatus mirrors statusId so quests/conditions keep working" — mirrored once up
  // front (simstate.json's own default may not match tuning.visa.startStatus) and again on every
  // transition via onStatusChanged below.
  quests.vars.visaStatus = visaMachine.statusId;
  quests.onGrantVisa = (statusId) => visaMachine.grantVisa(statusId, gameDay);
  visaMachine.onStatusChanged = (def) => {
    quests.vars.visaStatus = def.id;
    refreshVisaChip();
  };
  visaMachine.onGameOver = (reason, def) => {
    exteriorDoorTransit.cancel(true);
    gameOverActive = true;
    const name = def?.name ?? visaMachine.statusId;
    hud.showGameOver(reason === 'grace_expired'
      ? `Your ${name} status' grace period ended — you had to leave the country.`
      : `Your ${name} status expired — you had to leave the country.`);
  };
  const refreshVisaChip = () => {
    const def = visaMachine.currentDef();
    const inGrace = visaMachine.inGrace();
    hud.setVisaChip(
      def?.name ?? visaMachine.statusId,
      inGrace ? visaMachine.graceDaysLeft(gameDay) : visaMachine.daysLeft(gameDay),
      inGrace,
    );
  };

  const handleWorkEvent = (event: WorkTickEvent) => {
    if (event.type === 'due') {
      // B7-5: the meaningful deadline is now the DEPARTURE window close, not the shift end — leave
      // after it and the shift is missed.
      const depart = event.departByHour;
      const totalMinutes = Math.round(depart * 60) % (24 * 60);
      const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
      const mm = String(totalMinutes % 60).padStart(2, '0');
      hud.showQuestToast(
        `Time for work! Leave through the suite door before ${hh}:${mm} or you'll miss the shift`,
        'started',
        data.tuning.quests.toastDurationSeconds * 1000,
      );
      return;
    }
    if (event.type === 'returned') {
      let applied = false;
      returnTransitPending = true;
      const completeReturn = () => {
        if (applied) return;
        applied = true;
        returnTransitPending = false;
        agent.teleportTo(event.returnPoint.pos[0], event.returnPoint.pos[1], event.returnPoint.facingDeg);
        sim.visible = true;
        if (marker) marker.pivot.visible = true;
        hud.setAtWork(false);
        // B13-7: fresh return from work — give the player a beat before free will kicks in.
        autonomy.forceCooldown(data.tuning.autonomy.decisionGraceSeconds ?? 5);
        quests.funds += event.pay; // QuestRunner is the single runtime economy owner (§3 / buy mode)
        const nextNeeds = applyNeedsCost(Object.fromEntries(stats.needs), event.needsCost);
        for (const [needId, value] of Object.entries(nextNeeds)) stats.needs.set(needId, value);
        hud.setFunds(quests.funds, data.tuning.economy.currencyName);
        hud.showQuestToast(
          `+${data.tuning.economy.currencyName}${event.pay.toLocaleString()}`,
          'completed',
          data.tuning.quests.toastDurationSeconds * 1000,
        );
        const job = data.jobs.jobs.find((entry) => entry.id === event.jobId);
        if (job) {
          const promotion = work.rollPromotion(job, happiness, data.tuning.work?.promotionHappinessFactor ?? 1);
          if (promotion.promoted) {
            const pay = `${promotion.payIncrease >= 0 ? '+' : ''}${data.tuning.economy.currencyName}${promotion.payIncrease}`;
            hud.showQuestToast(`Promoted to ${promotion.title}! ${pay}`, 'completed', data.tuning.quests.toastDurationSeconds * 1000);
            // Keep the income quest var current with the new level's pay (see phone.ts applyForJob).
            quests.vars.income = jobLevelPay(job, work.getJobLevel(job.id));
          }
        }
        refreshPhone();
      };
      const transit = requestExteriorTransit({
        passThrough: completeReturn,
        passComplete: () => true,
        onClosed: completeReturn,
      });
      if (!transit) completeReturn();
      return;
    }

    const job = data.jobs.jobs.find((entry) => entry.id === event.jobId);
    if (event.type === 'skipped') {
      // A walk/action ordered before the deadline cannot remain actionable after the tracker has
      // closed the window. Same-position teleport is the existing normal cancel+clear-path seam.
      if (agent.pendingActionId === 'leave_for_work') {
        agent.teleportTo(sim.position.x, sim.position.z, THREE.MathUtils.radToDeg(sim.rotation.y));
      }
      hud.showQuestToast(
        'You missed your shift',
        'started',
        data.tuning.quests.toastDurationSeconds * 1000,
      );
      return;
    }

    quests.vars.job = null;
    quests.vars.income = 0; // no employer → no income (mirrors the applyForJob write)
    if (job && shouldStartVisaGrace(job, visaMachine.statusId, visaMachine.currentDef())) {
      visaMachine.startGrace(gameDay);
    }
    hud.showQuestToast(
      `Job lost: ${job?.name ?? event.jobId}`,
      'started',
      data.tuning.quests.toastDurationSeconds * 1000,
    );
    refreshVisaChip();
    refreshPhone();
  };

  // SOCIAL S6: completion-only application of S1's visitOutcome — the ONE place a visit's needs/
  // relationship effects ever land (mirrors handleWorkEvent's 'returned' branch above, and the
  // existing onCallFallback/socialSession pattern for applying a compat-scaled outcome onto live
  // player needs). An npc deleted mid-hot-reload degrades gracefully: the sim still reappears, it
  // just carries no outcome (nothing to compute it against).
  const handleVisitReturn = (event: VisitReturnEvent) => {
    let applied = false;
    returnTransitPending = true;
    const completeReturn = () => {
      if (applied) return;
      applied = true;
      returnTransitPending = false;
      agent.teleportTo(event.returnPoint.pos[0], event.returnPoint.pos[1], event.returnPoint.facingDeg);
      sim.visible = true;
      if (marker) marker.pivot.visible = true;
      hud.setAtWork(false);
      // B13-7: fresh return from a visit — give the player a beat before free will kicks in.
      autonomy.forceCooldown(data.tuning.autonomy.decisionGraceSeconds ?? 5);
      const npc = data.npcs?.npcs.find((entry) => entry.id === event.npcId);
      if (npc && data.social) {
        const compat = compatibility(Object.fromEntries(stats.personality), npc.personality, data.social);
        const outcome = visitOutcome(event.npcId, socialRuntime.relationships, compat, data.social);
        socialRuntime.relationships.set(npc.id, socialRuntime.relationships.get(npc.id) + outcome.relationshipDelta);
        for (const [needId, delta] of Object.entries(outcome.needsRestored)) {
          const current = stats.needs.get(needId);
          if (current !== undefined) stats.needs.set(needId, Math.max(0, Math.min(100, current + delta)));
        }
        hud.showQuestToast(`Back from visiting ${npc.name}`, 'completed', data.tuning.quests.toastDurationSeconds * 1000);
      }
      refreshPhone();
    };
    const transit = requestExteriorTransit({ passThrough: completeReturn, passComplete: () => true, onClosed: completeReturn });
    if (!transit) completeReturn();
  };

  // --- smartphone jobs + visa applications (PROJECT_CONTEXT.md §7.20 V2, B3-7) ---
  const phoneJobs = new PhoneJobSearch(data.jobs, data.tuning.phone?.jobListSize);
  const bills = new FinanceState(data.bills, data.finance, data.tuning.bills?.intervalDays, 1, data.tuning.credit);
  let phoneTab: 'jobs' | 'visas' | 'bills' | 'credit' | 'rentals' | 'contacts' = 'jobs';
  // ROADMAP_APT R3 (Kijiji): the phone tab needs EVERY map, not just the active one. Loaded
  // network-only (data.ts loadAllMaps, via GET /api/maps) and refreshed each time the tab is shown
  // so live designer map/rental edits appear. Empty until the first load resolves — the tab renders
  // its empty state meanwhile.
  let allMaps: MapData[] = [];
  // ROADMAP_APT R4: at most one pending move at a time (rentalCardViews gates every other Rent
  // button on it). Pure countdown state (game/rental.ts); the actual switch happens ONLY when the
  // render loop below observes takeCompleted() — cancellation applies nothing (side_effect_rule).
  const pendingMove = new PendingMoveTracker();
  const reloadRentalMaps = () => {
    void loadAllMaps().then((maps) => { allMaps = maps; if (phoneTab === 'rentals') refreshPhone(); }).catch(() => { /* server briefly unavailable — keep last */ });
  };
  const refreshPhone = () => {
    const ctx = buildEvalContext();
    const pendingDays = pendingDaysRemaining(visaMachine.pending, gameDay);
    const pendingState = pendingMove.pending;
    const rentals = rentalCardViews(
      listRentals({
        maps: allMaps,
        evalContext: ctx,
        finance: data.finance,
        assets: data.assets,
        // Current home = the map the sim actually lives on right now (data.map — kept in lockstep
        // with simstate.homeMap by the R4 move flow). Flags the ad "Current".
        homeMapId: data.map.id,
      }),
      {
        currencyName: data.tuning.economy.currencyName,
        // R4: a pending move disables every Rent button and puts the countdown + Cancel control
        // on the destination card (rentalCardViews/ui.ts render it; the decision lives in phone.ts).
        pendingMove: pendingState
          ? { mapId: pendingState.mapId, remainingHours: pendingMove.remainingHours(gameHourNow()) ?? 0 }
          : null,
      },
    );
    hud.renderPhone({
      tab: phoneTab,
      currentStatusName: visaMachine.currentDef()?.name ?? visaMachine.statusId,
      searchedJobs: phoneJobs.lastRolledHour !== null,
      jobs: jobListingViews(phoneJobs.current().filter((job) => job.id !== currentJob()?.id), ctx, bills.creditScore),
      currentJob: currentJob() ? (() => {
        const job = currentJob()!;
        const levelIndex = work.getJobLevel(job.id);
        return {
          job: { ...job, name: jobLevelTitle(job, levelIndex), payPerShift: jobLevelPay(job, levelIndex), levels: undefined },
          skips: work.skips,
          levelIndex,
        };
      })() : null,
      visas: visaApplicationViews(data.visas, ctx),
      pending: visaMachine.pending && pendingDays !== null
        ? { statusId: visaMachine.pending.statusId, daysRemaining: pendingDays }
        : null,
      currencyName: data.tuning.economy.currencyName,
      bills: bills.outstanding,
      billsTotal: bills.total,
      creditScore: bills.creditScore,
      creditHistory: bills.creditHistory,
      rentalTabName: data.tuning.phone?.rentalTabName ?? 'Kijiji',
      contactsTabName: data.tuning.phone?.contactsTabName ?? 'Contacts',
      rentals,
      contacts: contactViews(data.npcs?.npcs ?? [], {
        relationships: socialRuntime.relationships,
        phone: socialRuntime.phone,
        data: data.social!,
        nowMinutes: gameHourNow() * 60,
        hourNow: gameSeconds / 3600,
        canInvite: visitors.canInvite(),
        activeAction: phoneContactSession.active
          ? { npcId: phoneContactSession.active.npc.id, channel: phoneContactSession.active.channel }
          : null,
        playerAway: playerAway(),
      }),
      rentDisabledTitle: 'Not rentable right now',
    });
    hud.setPhoneBadge(bills.outstanding.length);
  };
  const phoneToast = (text: string, completed = false) => hud.showQuestToast(
    text,
    completed ? 'completed' : 'started',
    data.tuning.quests.toastDurationSeconds * 1000,
  );
  function startPhoneContact(npcId: string, channel: 'text' | 'call'): boolean {
    const npc = data.npcs?.npcs.find((entry) => entry.id === npcId);
    if (!npc || !data.social) return false;
    const order = phoneContactSession.begin(
      npc,
      channel,
      Object.fromEntries(stats.personality),
      gameSeconds / 3600,
      gameHourNow() * 60,
    );
    if (!order) return false;
    if (!agent.orderAction(order.action, sim)) {
      phoneContactSession.finish(false, gameHourNow() * 60);
      return false;
    }
    refreshPhone();
    return true;
  }
  hud.onPhoneClose = () => {
    if (phoneContactSession.active || agent.current?.action.id === 'use_phone') agent.stopAction();
  };
  hud.onPhoneOpen = () => {
    if (buyMode.active || repoOverlayActive || gameOverActive) return;
    phoneTab = 'jobs';
    refreshPhone();
    hud.openPhone();
  };
  hud.onPhoneTabPick = (tab) => {
    phoneTab = tab;
    if (tab === 'rentals') reloadRentalMaps(); // pull fresh maps/rental edits each time the tab opens
    refreshPhone();
  };
  hud.onPhoneContactInvite = (npcId) => {
    const npc = data.npcs?.npcs.find((entry) => entry.id === npcId);
    if (!npc || !isNpcAvailable(gameSeconds / 3600, npc.availableHours) || !visitors.canInvite()) return;
    if (visitors.invite(npcId)) phoneToast(`${npc.name} is on the way`, true);
    refreshPhone();
  };
  hud.onPhoneContactAction = (npcId, channel) => { startPhoneContact(npcId, channel); };
  hud.onPhoneContactCancel = () => { if (phoneContactSession.active) agent.stopAction(false); };
  // SOCIAL S6: "Visit" — re-checks the SAME visitGate the Contacts-tab view used to enable the
  // button (never trust a possibly-stale card), then walks the sim to the exterior door exactly
  // like tryAutoDepartForWork does for leave_for_work. The away-state itself only begins once that
  // walk-and-short-duration action actually COMPLETES (see the 'visit_their_place' branch in the
  // action-completion handler below) — ordering it here is not itself a side effect, so cancelling
  // mid-walk (a fresh tap/order) applies nothing, matching leave_for_work's own cancel behavior.
  hud.onPhoneContactVisit = (npcId) => {
    const npc = data.npcs?.npcs.find((entry) => entry.id === npcId);
    if (!npc || !data.social) return;
    const gate = visitGate(npc, {
      hourNow: gameSeconds / 3600,
      relationships: socialRuntime.relationships,
      data: data.social,
      visitorBusy: !visitors.canInvite(),
      playerAway: playerAway(),
    });
    if (gate) return;
    const doorTarget = findExteriorDoorObject();
    const doorDef = doorTarget ? assetById(doorTarget.userData.assetId as string) : undefined;
    const action = data.interactions.actions.find((entry) => entry.id === 'visit_their_place');
    if (!doorTarget || !doorDef || !action) return;
    autonomy.notePlayerCommand();
    cancelCarry();
    if (!agent.orderAction(action, doorTarget, null, doorDef)) return;
    pendingVisitNpcId = npcId;
    hud.hideActionMenu();
    phoneToast(`Heading over to ${npc.name}'s place`);
    refreshPhone();
  };
  // ROADMAP_APT R4: renting starts a PENDING MOVE (sim-time countdown of the map's
  // rental.moveInHours). Re-validated here against a fresh listing (not the possibly-stale card
  // the click came from): must be available, not the current home, and no move already pending.
  hud.onPhoneRentRequested = (mapId) => {
    if (pendingMove.pending) return; // one move at a time (the buttons are disabled anyway)
    const listing = listRentals({
      maps: allMaps,
      evalContext: buildEvalContext(),
      finance: data.finance,
      assets: data.assets,
      homeMapId: data.map.id,
    }).find((entry) => entry.mapId === mapId);
    if (!listing || !listing.available || listing.isCurrentHome) return;
    if (!pendingMove.start(mapId, listing.moveInHours, gameHourNow())) return;
    const hours = Math.max(0, Math.ceil(listing.moveInHours));
    phoneToast(`Rented: ${listing.title || mapId} — moving in ${hours}h`, true);
    refreshPhone();
  };
  // R4: cancel applies NOTHING beyond clearing the pending move (side_effect_rule — completion is
  // the only thing that ever switches maps). No refund because renting charged nothing up front.
  hud.onPhoneMoveCancelRequested = () => {
    if (!pendingMove.cancel()) return;
    phoneToast('Move cancelled');
    refreshPhone();
  };
  reloadRentalMaps(); // warm the Kijiji listing in the background so the first open isn't empty
  hud.onPhoneSearchJobs = () => {
    phoneJobs.search(buildEvalContext().time);
    refreshPhone();
  };
  hud.onPhoneJobApply = (jobId) => {
    const job = data.jobs.jobs.find((entry) => entry.id === jobId);
    if (!job) return;
    const prompt = jobSwitchPrompt(currentJob(), job);
    if (prompt && !confirm(prompt)) return;
    const result = applyForJob(
      jobId,
      data.jobs,
      buildEvalContext(),
      quests.vars,
      (statusId, day) => visaMachine.grantVisa(statusId, day),
      bills.creditScore,
    );
    if (result.ok) {
      work.syncJob(currentJob(), currentWorkTime(), data.tuning.calendar);
      phoneToast(`Job accepted: ${job?.name ?? jobId}`, true);
    }
    else if (result.reason === 'requirements_unmet') phoneToast('Job requirements are not met');
    refreshVisaChip();
    refreshPhone();
  };
  hud.onPhoneVisaApply = (statusId) => {
    const result = applyForVisa(statusId, data.visas, buildEvalContext(), (id, day) => visaMachine.apply(id, day));
    const visa = data.visas.visas.find((entry) => entry.id === statusId);
    if (result.ok) phoneToast(`Application submitted: ${visa?.name ?? statusId}`, true);
    else if (result.reason === 'requirements_unmet') phoneToast('Visa requirements are not met');
    else if (result.reason === 'application_rejected') phoneToast('Another visa application is already pending');
    refreshPhone();
  };
  const applyBillPayment = (result: ReturnType<FinanceState['pay']>) => {
    if (!result.ok) return;
    quests.funds = result.remainingFunds;
    hud.setFunds(quests.funds, data.tuning.economy.currencyName);
    phoneToast(`Bills paid: §${result.paid.toLocaleString()}`, true);
    refreshPhone();
  };
  hud.onPhoneBillPay = (key) => applyBillPayment(bills.pay(key, quests.funds, gameDay));
  hud.onPhoneBillsPayAll = () => applyBillPayment(bills.payAll(quests.funds, gameDay));

  hud.onRepoClose = () => {
    repoOverlayActive = false;
    if (!debtGameOverPending) return;
    debtGameOverPending = false;
    exteriorDoorTransit.cancel(true);
    gameOverActive = true;
    hud.showGameOver('Your debt remained unpaid after everything seizable was repossessed.');
  };

  const handleRepoIfDue = () => {
    if (repoOverlayActive || gameOverActive || !bills.isRepoDue(gameDay)) return;
    if (bills.outstanding.length > 0) {
      const collection = bills.payAll(quests.funds, gameDay, false);
      if (collection.ok) quests.funds = collection.remainingFunds;
    }
    bills.observeFunds(gameDay, quests.funds);
    if (quests.funds >= 0) {
      hud.setFunds(quests.funds, currencyName());
      refreshPhone();
      return;
    }

    const byId = new Map(data.assets.assets.map((asset) => [asset.id, asset]));
    const instances = buyMode.instances();
    const instanceByKey = new Map(instances.map((instance) => [instance.key, instance]));
    const decision = decideRepoSeizure(quests.funds, instances.flatMap((instance) => {
      const def = byId.get(instance.asset);
      return def && isSelectableForSell(def) ? [{
        key: instance.key,
        name: def.name,
        sellPrice: def.sellPrice,
        survivalImportance: def.survivalImportance,
      }] : [];
    }));
    bills.applyRepoPenalty(gameDay);
    for (const seized of decision.seized) {
      const instance = instanceByKey.get(seized.key);
      const def = instance ? byId.get(instance.asset) : undefined;
      if (instance && def) buyMode.sellInstance(instance, def);
    }
    quests.funds = decision.remainingFunds;
    bills.observeFunds(gameDay, quests.funds);
    if (decision.seized.length > 0) { rebakeNav(); applyEnvironment(); }
    hud.setFunds(quests.funds, currencyName());
    refreshPhone();
    exteriorDoorTransit.cancel(true);
    repoOverlayActive = true;
    debtGameOverPending = decision.gameOver;
    hud.showRepoNotice(decision.seized, currencyName());
  };

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

  // --- ROADMAP_NEXT item 7: audio (data-driven sfx/asset loops + per-context music) ------------
  // Thin HTMLAudioElement layer (game/audio.ts) — construction is safe pre-gesture (it only queues
  // playback attempts behind the module's own pointerdown/keydown unlock listener), so it can be
  // built here unconditionally like every other subsystem.
  const audio = new AudioManager(data.tuning);
  let stateSoundKeys = new Set<string>();
  /** B6-12: one traversal synchronizes pure per-instance state into PointLights and persistent
   * asset loops. Stable designer/player keys survive hot-reload world rebuilds and are save-ready. */
  const syncAssetStates = () => {
    const desiredSounds = new Set<string>();
    const byId = assetsById(data);
    // Combined hydro draw of the ON metered assets this frame, summed per UNIQUE instance key so a
    // multi-mesh asset can't be counted twice (accrual is independent of visibility — a TV left on
    // while the sim is away at work still costs hydro).
    let hydroRate = 0;
    const meteredSeen = new Set<string>();
    world.traverse((obj) => {
      const key = obj.userData.assetStateKey as string | undefined;
      const assetId = obj.userData.assetId as string | undefined;
      if (!key || !assetId) return;
      const def = byId.get(assetId);
      if (!def) return;
      const on = assetStates.isOn(key, def);
      setAssetObjectOn(obj, on);
      if (on && !meteredSeen.has(key)) {
        const power = resolveAssetPower(def);
        if (power) { hydroRate += power.ratePerHour; meteredSeen.add(key); }
      }
      if (obj.visible && on && isStatefulAsset(def) && def.sound) {
        const soundKey = `asset-state:${key}`;
        audio.startLoop(soundKey, def.sound);
        desiredSounds.add(soundKey);
      }
    });
    currentHydroRate = hydroRate;
    for (const key of stateSoundKeys) if (!desiredSounds.has(key)) audio.stopLoop(key);
    stateSoundKeys = desiredSounds;
  };
  syncAssetStates();
  audio.setMusicContext('loading', data.map, loading.music, () => { loadingTap.hidden = true; });
  const playTunedSfx = (key: 'moveOrder' | 'actionSelect' | 'questStarted' | 'questCompleted' | 'notification' | 'skillUp' | 'moneyUp' | 'moneyDown') => {
    const path = data.tuning.audio?.[key];
    if (path) audio.playSfx(path);
  };
  hud.onActionSelected = () => playTunedSfx('actionSelect');
  hud.onToast = (cue) => playTunedSfx(cue);
  let observedFunds = quests.funds;
  const feedbackAnchor = new THREE.Vector3();
  const observeFundsFeedback = () => {
    const delta = quests.funds - observedFunds;
    if (delta === 0) return;
    observedFunds = quests.funds;
    hud.showFloatingFeedback(formatMoneyChange(delta, data.tuning.economy.currencyName), delta > 0 ? 'money-up' : 'money-down');
    playTunedSfx(delta > 0 ? 'moneyUp' : 'moneyDown');
  };

  // --- ROADMAP_NEXT item 5: per-action duration timer (§7.11) ---------------------------------
  // Computed once when an action starts (skill snapshot at that moment — matches "how long THIS
  // attempt takes", not a moving target as the skill grows mid-action). Ticked every render frame
  // on the same sim-time `sdt` as agent.update/doors/anim (pause freezes it, 2x/3x speeds it up).
  // `action` identity (not just id) is the guard against a stale timer surviving a stop+restart of
  // the very same action.
  let durationState: { action: ActiveAction; totalSeconds: number; elapsed: number } | null = null;
  // ROADMAP_NEXT B3-5: "carry to garbage" — set right after a clean_up/sweep action completes on
  // a non-puddle transient (dirty_dishes/ash) whose nearest non-full can is reachable; the actual
  // despawn/deposit is deferred until the render loop below observes the sim has arrived (or the
  // walk gets cancelled by any other order, in which case the transient simply stays put, still
  // dirty — see cancelCarry). `target` is the transient's own Object3D (still valid/undespawned
  // while carrying) so accidents.maybeCleanup can be called normally on arrival; deposit itself is
  // re-resolved at arrival time (not the can chosen at carry-start) via depositAtNearestCan, same
  // "recompute, don't assume" convention garbage.ts's own doc comment already uses for the no-carry
  // clean_up path this replaces.
  let carryState: { target: THREE.Object3D; actionId: string } | null = null;
  // ITEM 3 (put-trash-out routing, 2026-07-17): set when the take-out-trash flow is walking the sim
  // to the FIRST stop (the fullest can, or a specific can the action was ordered on) BEFORE the
  // exterior door. On arrival (render loop) the actual `empty_garbage` action is ordered on
  // `doorTarget`, which walks to the door and — on completion — empties every can as today. Same
  // main.ts-owned extra-leg pattern as carryState (sim.ts has no multi-leg chaining).
  let trashOutState: { doorTarget: THREE.Object3D; action: ActionDef } | null = null;
  const food = new FoodRegistry();
  const FOOD_EATING_ACTION_ID = '__eat_carried_food';
  let foodTransitioning = false;
  const gameHourNow = () => (gameDay - 1) * 24 + gameSeconds / 3600;
  const handleProducedWaste = (assetId: string) => {
    const count = wasteItemCount(data.tuning.waste, buildEvalContext(), data.stats);
    const cleanliness = stats.personality.get(garbage.cleanlinessVarId());
    for (let i = 0; i < count; i++) {
      garbage.handleWaste(assetId, [sim.position.x, sim.position.z], cleanliness, accidents);
    }
  };

  const dropActiveFood = () => {
    const dropped = food.interruptActive([sim.position.x, sim.position.z], gameHourNow());
    if (!dropped) return;
    // ROADMAP item 1 fix: an abandoned carried-food item becomes clearable WASTE at the drop spot
    // (the Eat action's producesWaste, e.g. dirty_dishes) instead of being left as an uncleanable,
    // self-perishing food transient. ROOT CAUSE of the designer bug: a dropped snack/meal is a
    // `snack`/`meal` transient whose AssetDef.interactions is EMPTY, so the tap menu (which reads
    // the asset's own interactions) offered no cleanup action; and FoodRegistry.tick silently
    // despawned it at perishHours (snack = 3 in-game hours ≈ 22.5s at secondsPerGameDay=180 — the
    // "vanishes on its own" symptom). Routing it through handleProducedWaste gives it the ordinary
    // garbage pipeline: auto-tidy into a nearby non-full can if the sim is clean enough, else a
    // clearable `dirty_dishes` transient that persists until a COMPLETED clean_up — identical to a
    // finished Eat's own waste. `discard` removes it from the food registry so tick never touches it.
    accidents.despawnTransient(dropped.key);
    food.discard(dropped.key);
    const wasteId = wasteAssetForDroppedFood(dropped);
    if (wasteId) handleProducedWaste(wasteId);
  };
  /** Any order that redirects the sim away from an in-progress "carry to garbage" walk cancels it —
   *  the transient stays exactly where it was (still dirty), the can's fill is untouched. Call this
   *  from every place that can send the sim somewhere else: a fresh ground-tap/action order, the
   *  buy-mode "stop in place" safety net, and the panic/bladder-failure interrupts (both of which
   *  otherwise leave the sim mid-walk toward the can while "reacting" to something else). */
  const cancelCarry = () => { carryState = null; trashOutState = null; dropActiveFood(); };

  const assetById = (id?: string) => (id ? data.assets.assets.find((a) => a.id === id) : undefined);
  /** The live exterior-door Object3D (the one carrying `empty_garbage`/`leave_for_work`), or
   *  undefined if the map has none. Same lookup autoDepart uses for the work door. */
  const findExteriorDoorObject = (): THREE.Object3D | undefined =>
    doors.group.children.find((entry) => assetById(entry.userData.assetId as string)?.door?.exterior === true);

  /** ITEM 3 (put-trash-out routing, 2026-07-17): the take-out-trash flow. `empty_garbage` may be
   *  ordered on the exterior door (as today) OR on a garbage can (the designer attaches the action
   *  to the can asset in the tools). Either way the sim FIRST walks to a collection stop — the
   *  ordered-on can if it has any fill, otherwise the FULLEST can (tie-break nearest, garbage.ts's
   *  chooseFullestCan) — and only then (render-loop arrival) walks to the exterior door and runs the
   *  action, whose completion empties every can exactly as before. If no can has any fill (nothing
   *  to collect) or the collection stop is unreachable, the sim goes straight to the door as today. */
  const startTrashOut = (action: ActionDef, target: THREE.Object3D) => {
    const targetDef = assetById(target.userData.assetId as string);
    const doorTarget = targetDef?.door?.exterior ? target : findExteriorDoorObject();
    if (!doorTarget) { console.log('empty_garbage: no exterior door on this map'); return; }
    const doorDef = assetById(doorTarget.userData.assetId as string);
    const simPos: [number, number] = [sim.position.x, sim.position.z];
    const firstStop: [number, number] | null =
      targetDef?.garbage && garbage.fillOfObject(target) > 0
        ? [target.position.x, target.position.z]
        : garbage.fullestCanPos(simPos);
    if (firstStop && agent.goTo(firstStop[0], firstStop[1])) {
      trashOutState = { doorTarget, action };
      cue.showAt(firstStop[0], firstStop[1]);
    } else if (agent.orderAction(action, doorTarget, null, doorDef)) {
      cue.showAt(doorTarget.position.x, doorTarget.position.z); // nothing to collect / unreachable can → straight to door
    } else {
      console.log('empty_garbage: no path to exterior door');
    }
  };

  const nearestFoodSeat = (): THREE.Object3D | null => {
    const byId = new Map(data.assets.assets.map((a) => [a.id, a]));
    let best: THREE.Object3D | null = null;
    let bestDist = Infinity;
    for (const obj of world.children) {
      if (obj.visible === false) continue;
      const def = byId.get(obj.userData?.assetId as string);
      if (!def?.seatTarget) continue;
      const dist = Math.hypot(obj.position.x - sim.position.x, obj.position.z - sim.position.z);
      if (dist < bestDist) { best = obj; bestDist = dist; }
    }
    return best;
  };

  /** Starts B4-2's second leg using the same bare main.ts orchestration as B3-5 carry-to-garbage.
   *  The source action has already arrived at the fridge/stove; the transient is hidden while
   *  carried, then an internal duration action reuses SimAgent's seat pose / sit_ground fallback. */
  const startCarriedFood = (assetId: string, cooked = false, sourceAction?: ActionDef) => {
    const def = data.assets.assets.find((a) => a.id === assetId && a.category === 'transient');
    if (!def?.food) return;
    const eatDef = data.interactions.actions.find((a) => a.id === 'eat');
    if (!eatDef) return;
    const pos: [number, number] = [sim.position.x, sim.position.z];
    const rec = accidents.spawnTransient(assetId, pos, THREE.MathUtils.radToDeg(sim.rotation.y), simClockSeconds);
    if (!rec) return;
    // ROADMAP item 2 (meal tiers): the SOURCE action (fridge Eat / stove cook_light_meal /
    // cook_large_meal) may sparsely override the spawned transient's own food block; present fields
    // win, absent fields fall back to def.food. ROADMAP_NEXT B7-2: a COOKED meal's hunger fill then
    // scales with cooking skill ON TOP of the resolved base (snacks unaffected — cooked=false).
    let foodConfig = resolveFoodConfig(def.food, sourceAction?.food);
    if (cooked) {
      const ft = data.tuning.food;
      const cookingSkill = stats.skills.get('cooking') ?? 0;
      const skillMax = data.stats.skills.find((s) => s.id === 'cooking')?.max ?? 100;
      const gain = cookedMealHungerGain(foodConfig.hungerGain, cookingSkill, skillMax, {
        cookHungerAtSkill0: ft?.cookHungerAtSkill0 ?? 0.6,
        cookHungerAtSkillMax: ft?.cookHungerAtSkillMax ?? 1.5,
      });
      foodConfig = { ...foodConfig, hungerGain: gain };
    }
    // ROADMAP item 1 fix: record the clearable waste this food becomes if abandoned (dropActiveFood)
    // — the Eat action's producesWaste, matching a finished Eat's own waste (dirty_dishes).
    food.startCarrying(rec.key, assetId, foodConfig, pos, eatDef.producesWaste);
    accidents.setTransientPlacement(rec.key, pos, false);
    const target = accidents.groupFor(rec.key);
    if (!target) { dropActiveFood(); return; }
    const eatingAction = {
      ...eatDef,
      id: FOOD_EATING_ACTION_ID,
      name: `Eating ${def.name.toLowerCase()}`,
      needGains: {}, skillGains: {}, primaryNeed: null, autonomyEligible: false,
      cost: undefined,
      duration: eatDef.duration ?? { baseSeconds: 5 },
    };
    const seat = nearestFoodSeat();
    // Keep the hidden target at the eating destination so SimAgent's final face-target step does
    // not turn a seated sim back toward the distant fridge/stove after applying the seat pose.
    if (seat) accidents.setTransientPlacement(rec.key, [seat.position.x, seat.position.z], false);
    foodTransitioning = true;
    const ordered = agent.orderAction(eatingAction, target, seat, undefined, true);
    foodTransitioning = false;
    if (!ordered) dropActiveFood();
  };

  // --- ROADMAP_NEXT B2-4: bladder failure ("pees itself" at 0) ---------------------------------
  // Trigger/cooldown decision is pure logic (game/bladder.ts, headless-tested in test/bladder.test.ts)
  // — this closure only owns the actual event: interrupt whatever the sim was doing, play the
  // 'pee' animation for tuning.bladderFailure.durationSeconds (own tiny elapsed/total timer,
  // mirroring durationState's shape but NOT tied to an ActiveAction — this event isn't an
  // interaction with any target asset, so sim.ts's action system doesn't apply), spawn a
  // pee_puddle transient at the sim's exact current position/facing (reuses accidents.ts's
  // spawnTransient exactly like garbage.ts's "drop" case does), then refill bladder to
  // reliefAmount once the animation completes. autonomy.forceCooldown keeps free will from
  // immediately walking the sim off toward the toilet mid-animation (agent.isBusy goes false the
  // instant stopAction() runs below, since there's no queued/current action for this event) —
  // after the cooldown lapses, the normal autonomy loop resumes on its own (per the roadmap note:
  // "bladder at 30 may immediately seek the toilet — fine, that's Sims behavior").
  const bladderFailureState = initBladderFailureState();
  let peeState: { elapsed: number; totalSeconds: number } | null = null;
  const triggerBladderFailure = () => {
    exteriorDoorTransit.cancel();
    agent.stopAction(); // fires onActionStop → animation reset to idle, activity chip hidden, etc.
    cancelCarry(); // ROADMAP_NEXT B3-5: bladder failure interrupts an in-progress carry walk too
    const cfg = data.tuning.bladderFailure;
    const durationSeconds = cfg?.durationSeconds ?? 4;
    autonomy.forceCooldown(durationSeconds);
    anim?.play('pee');
    const rotDeg = THREE.MathUtils.radToDeg(sim.rotation.y);
    accidents.spawnTransient('pee_puddle', [sim.position.x, sim.position.z], rotDeg, simClockSeconds);
    peeState = { elapsed: 0, totalSeconds: durationSeconds };
  };

  agent.onActionStart = (a) => {
    // B10-6: generic source-first seated action. This callback fires only after the first route
    // reaches the source's use spot. Replace that just-started action with a flag-cleared second
    // leg to the resolved seat; ordinary start effects (cost, duration, gains/audio) therefore
    // begin once, at the seat, not briefly at the source and not twice.
    if (a.action.fetchBeforeSeat) {
      const sourceAssetId = a.target.userData?.assetId as string | undefined;
      const sourceDef = sourceAssetId ? data.assets.assets.find((x) => x.id === sourceAssetId) : undefined;
      const seat = findSeatFor(world, data, a.target);
      const secondLeg = actionAfterSourceFetch(a.action);
      if (!agent.orderAction(secondLeg, a.target, seat, sourceDef, true)) {
        console.log('no path from source to seat', sourceAssetId ?? a.action.id);
      }
      return;
    }
    if (sleepAction(a.action)) {
      const decision = sleepDecisionAt([sim.position.x, sim.position.z]);
      if (decision.blocked) {
        agent.stopAction(false);
        hud.showQuestToast(decision.reason!, 'started', data.tuning.quests.toastDurationSeconds * 1000);
        return;
      }
    }
    const socialOrder = socialSession.active;
    if (socialOrder?.action === a.action) {
      const visitor = visitors.visitorObject;
      if (!visitor) { agent.stopAction(false); return; }
      // A target-asset pair begins only once BOTH ordinary SimAgents have reached and posed on
      // the asset. The render-loop rendezvous below owns its shared timer/audio start.
      if (pairedSocial?.playerAction === a.action) {
        hud.showActivity(a.action.name);
        anim?.play('idle');
        durationState = null;
        return;
      }
      const [playerDeg, visitorDeg] = mutualFacingDeg(
        [sim.position.x, sim.position.z],
        [visitor.position.x, visitor.position.z],
      );
      sim.rotation.y = THREE.MathUtils.degToRad(playerDeg);
      visitor.rotation.y = THREE.MathUtils.degToRad(visitorDeg);
      visitors.playInteraction(socialAnimationFor(socialOrder.interaction, 'npc'));
    }
    if (a.action.id !== FOOD_EATING_ACTION_ID && !quests.spend(a.action.cost ?? 0)) {
      hud.showQuestToast('Not enough funds for that action', 'started', 2500);
      agent.stopAction();
      return;
    }
    if (a.action.id !== FOOD_EATING_ACTION_ID && (a.action.cost ?? 0) > 0) {
      hud.setFunds(quests.funds, currencyName());
    }
    hud.showActivity(a.action.name);
    anim?.play(animStateFor(a)); // unmapped states fall back to idle inside AnimController
    const totalSeconds = computeDurationSeconds(a.action.duration, Object.fromEntries(stats.skills), data.stats.skills, Object.fromEntries(stats.needs));
    durationState = totalSeconds !== null ? { action: a, totalSeconds, elapsed: 0 } : null;
    if (a.action.id === FOOD_EATING_ACTION_ID) {
      const active = food.active;
      if (active) food.beginEating(active.key);
    }
    // ROADMAP_NEXT item 7: start whichever of the target asset's own `sound` (wins, per-instance
    // key so two placed instances of the same asset loop independently) or the action's `sound`
    // (shared key — this single-sim game only ever has one action in flight at a time) applies.
    const startAssetId = a.target.userData?.assetId as string | undefined;
    const startAssetDef = startAssetId ? data.assets.assets.find((x) => x.id === startAssetId) : undefined;
    const stateKey = a.target.userData?.assetStateKey as string | undefined;
    const power = powerStateForAction(a.action.id, a.action);
    if (stateKey && startAssetDef && isStatefulAsset(startAssetDef) && power !== null) {
      const powerChanged = assetStates.setOn(stateKey, power);
      syncAssetStates();
      if (powerChanged) applyEnvironment();
    }
    const loopPath = loopSoundFor(a.action, startAssetDef);
    if (loopPath) audio.startLoop(startAssetDef?.sound ? `asset:${a.target.uuid}` : `action:${a.action.id}`, loopPath);
    // ROADMAP_NEXT B3-1(a): a `duration`-timed action (e.g. "cook") rolls its accident risk RIGHT
    // NOW, at the start of the attempt, instead of waiting for onActionStop — the designer's
    // complaint was literally "the stove should be able to catch fire WHILE cooking," and rolling
    // at stop can't do that (the sim isn't even done cooking yet). This is the simplest honest
    // reading of "appears instantly": one roll per attempt, made as early as possible, with the
    // fire spawning immediately if it hits. Non-duration actions are UNCHANGED — they still roll
    // at onActionStop (see below), which for them is the only "the sim is done with this" moment
    // that exists at all. onActionStop's own roll call is skipped for duration actions so this
    // never double-rolls the same attempt.
    if (a.action.duration && startAssetDef) {
      accidents.rollFor(a.target, startAssetDef, buildEvalContext(), simClockSeconds);
    }
    if (a.action.id === 'use_phone') {
      phoneTab = 'jobs';
      refreshPhone();
      hud.openPhone();
    }
    const foodAssetId = foodAssetForActionEvent(a.action.id, 'arrival');
    if (foodAssetId) startCarriedFood(foodAssetId, false, a.action);
  };

  // B6-14/B6-15: pure state lives in survival.ts; this layer owns interruption and presentation.
  const energyCollapseState = initEnergyCollapseState();
  const starvation = new StarvationTracker();
  const survivalEventActive = () => energyCollapseState.phase !== 'ready' || starvation.state.phase === 'collapse';
  const handleEnergyCollapse = (event: ReturnType<typeof tickEnergyCollapse>) => {
    if (event === 'collapse') {
      exteriorDoorTransit.cancel();
      agent.stopAction(); cancelCarry();
      const cfg = data.tuning.energyCollapse;
      autonomy.forceCooldown((cfg?.collapseSeconds ?? 2) + (cfg?.sleepSeconds ?? 20));
      anim?.play('collapse');
    } else if (event === 'sleep') {
      agent.setGroundLie(true);
      anim?.play('lie_sleep');
    } else if (event === 'complete') {
      agent.setGroundLie(false);
      stats.refillNeed('energy', data.tuning.energyCollapse?.energyAfter ?? 40);
      anim?.play('idle');
    }
  };
  const tickStarvation = (sdt: number) => {
    const cfg = data.tuning.starvation;
    const event = starvation.tick(sdt, stats.needs.get('hunger') ?? 100, {
      countdownSeconds: cfg?.countdownSeconds ?? 120,
      collapseSeconds: cfg?.collapseSeconds ?? 4,
      recoveryThreshold: cfg?.recoveryThreshold ?? 0,
    });
    if (event === 'warning') {
      hud.showQuestToast('Starving! Eat before the countdown expires.', 'started', data.tuning.quests.toastDurationSeconds * 1000);
    } else if (event === 'collapse') {
      // Starvation is terminal and takes precedence if its countdown expires during energy sleep.
      exteriorDoorTransit.cancel();
      energyCollapseState.phase = 'ready'; energyCollapseState.elapsed = 0; energyCollapseState.armed = true;
      agent.stopAction(); cancelCarry(); agent.setGroundLie(true);
      autonomy.forceCooldown(cfg?.collapseSeconds ?? 4);
      anim?.play('starve');
    } else if (event === 'gameOver') {
      exteriorDoorTransit.cancel(true);
      gameOverActive = true;
      hud.showGameOver(cfg?.message ?? 'Your Sim starved after going too long without food.');
    }
  };
  agent.onActionStop = (a, completed) => {
    const socialStop = socialSession.active?.action === a.action;
    const phoneContactStop = phoneContactSession.active?.action === a.action;
    hud.hideActivity();
    anim?.play('idle');
    durationState = null;
    // ROADMAP_NEXT item 7: stop whichever loop onActionStart may have started for this activity —
    // both keys are harmless no-ops to stop if they weren't the one actually playing.
    audio.stopLoop(`asset:${a.target.uuid}`);
    audio.stopLoop(`action:${a.action.id}`);
    if (socialStop) {
      socialSession.finish(completed);
      if (!completed) agent.halt();
      return;
    }
    if (phoneContactStop) {
      const name = phoneContactSession.active!.npc.name;
      const channel = phoneContactSession.active!.channel;
      const applied = phoneContactSession.finish(completed, gameHourNow() * 60);
      if (applied) phoneToast(`${channel === 'text' ? 'Texted' : 'Called'} ${name}`, true);
      refreshPhone();
      return;
    }
    if (a.action.id === 'use_phone') hud.closePhone();
    if (a.action.id === FOOD_EATING_ACTION_ID) {
      const active = food.active;
      if (!completed) {
        if (!foodTransitioning) dropActiveFood();
        return;
      }
      if (active) {
        const eaten = food.completeEating(active.key, stats.needs.get('hunger') ?? 0);
        if (eaten) stats.refillNeed('hunger', eaten.hunger);
        accidents.despawnTransient(active.key);
      }
      if (a.action.producesWaste) {
        handleProducedWaste(a.action.producesWaste);
      }
      return;
    }
    // ROADMAP_NEXT B3-4: every side effect below represents "the sim actually finished doing
    // this" (clearedBy despawn, an onUse accident roll, waste production, resetting every garbage
    // can) — none of them should fire on a CANCELLED action (player override, a fresh order, a
    // hot-reload teleport, an interrupt like bladder-failure/panic). `completed` is only ever true
    // for main.ts's own two natural-finish call sites (primaryNeed threshold below, and the
    // `duration` timer running out in the render loop) — see sim.ts's stopAction doc comment.
    if (!completed) return;
    const completedFoodAssetId = foodAssetForActionEvent(a.action.id, 'completion');
    if (completedFoodAssetId) { startCarriedFood(completedFoodAssetId, true, a.action); return; }
    // §7.20 V3: the short duration on leave_for_work finishes through the ordinary completed-only
    // action path. Re-check the live job/time here because the shift may have ended during the walk
    // from menu-open to the exterior door.
    if (a.action.id === 'leave_for_work') {
      const job = currentJob();
      if (!job) return;
      const depart = () => {
        const started = work.beginShift(job, currentWorkTime(), {
          pos: [a.target.position.x, a.target.position.z],
          facingDeg: THREE.MathUtils.radToDeg(a.target.rotation.y),
        }, data.tuning.work?.departureWindowHours ?? 2, data.tuning.calendar); // B13-11: off-days reject too
        if (!started.ok) {
          hud.showQuestToast('Too late — you missed your shift', 'started', 2500);
          return;
        }
        cancelCarry();
        // Clearing at the current point is the SimAgent equivalent of "nav idle" and preserves the
        // departure facing before the character is hidden.
        agent.teleportTo(sim.position.x, sim.position.z, THREE.MathUtils.radToDeg(sim.rotation.y));
        sim.visible = false;
        if (marker) marker.pivot.visible = false;
        hud.setAtWork(true);
      };
      const transit = requestExteriorTransit({ passThrough: depart, passComplete: () => true });
      if (!transit) depart();
      return;
    }
    // SOCIAL S6: direct clone of the leave_for_work branch above — same hide/teleport effects, a
    // different away tracker. `pendingVisitNpcId` was stamped by onPhoneContactVisit when this walk
    // was ordered; re-resolve the NPC fresh here (not trusted from closure) in case a hot-reload
    // removed it mid-walk, degrading to "no visit starts, nothing hidden" rather than a crash.
    if (a.action.id === 'visit_their_place') {
      const npcId = pendingVisitNpcId;
      pendingVisitNpcId = null;
      const npc = npcId ? data.npcs?.npcs.find((entry) => entry.id === npcId) : undefined;
      if (!npc || !data.social) return;
      const returnPoint: WorkReturnPoint = {
        pos: [a.target.position.x, a.target.position.z],
        facingDeg: THREE.MathUtils.radToDeg(a.target.rotation.y),
      };
      const depart = () => {
        if (!visitAway.begin(npc.id, currentWorkTime(), data.social!.visitTheirPlace.awayHours, returnPoint)) return;
        cancelCarry();
        agent.teleportTo(sim.position.x, sim.position.z, THREE.MathUtils.radToDeg(sim.rotation.y));
        sim.visible = false;
        if (marker) marker.pivot.visible = false;
        hud.setAtWork(true, `Visiting ${npc.name}`);
      };
      const transit = requestExteriorTransit({ passThrough: depart, passComplete: () => true });
      if (!transit) depart();
      return;
    }
    // §7.3: roll for a new accident (normal asset finishing a use) or despawn one (a cleanup
    // action just completed on an accident instance). Non-duration actions still roll HERE (their
    // only "the sim is done with this" moment — see accidents.ts's module doc comment); duration
    // actions already rolled at onActionStart (B3-1a above) and must NOT roll again here.
    const assetId = a.target.userData?.assetId as string | undefined;
    const def = assetId ? data.assets.assets.find((x) => x.id === assetId) : undefined;
    if (def?.category === 'transient') {
      // ROADMAP_NEXT B3-5: clean_up (dirty_dishes) / sweep (ash) no longer despawn the transient
      // instantly — the sim carries it to a garbage can first (see carryState above + the render
      // loop's arrival check below). mop (water_puddle/pee_puddle) is NOT in this set and keeps the
      // old immediate in-place despawn — puddles have nothing to carry anywhere.
      if (CARRY_TO_GARBAGE_ACTIONS.has(a.action.id) && shouldDespawnOnCleanup(a.action.id, def.clearedBy)) {
        const canPos = garbage.nearestNonFullCanPos([sim.position.x, sim.position.z]);
        if (canPos && agent.goTo(canPos[0], canPos[1])) {
          carryState = { target: a.target, actionId: a.action.id };
        } else {
          // No reachable non-full can right now — reuse the existing "reuse quest toast" refusal
          // pattern (garbage.ts's own module doc comment / the clean_up order-time pre-check
          // below). The transient is untouched: still there, still dirty, can fill unchanged.
          hud.showQuestToast('No empty garbage can available', 'started', 2500);
        }
      } else if (!accidents.maybeCleanup(a.target, a.action.id)) {
        // ROADMAP_NEXT item 2: the mop completed but the target was NOT a runtime AccidentRegistry
        // instance (maybeCleanup returned false) — it's a DESIGNER-PLACED puddle (a map placedObject).
        // Those never enter the registry, so remove the live instance through the buy-mode overlay's
        // `destroyed` path (hides the group + drops it from the nav feed), then rebake nav if this
        // asset actually blocked it. `completed` is already true here (guarded above); the pure
        // helper re-checks it so the side_effect_rule stays enforced in one unit-tested place — an
        // interrupted mop leaves the puddle untouched. We deliberately DON'T write to the map file:
        // the puddle is the designer's authored source, so a data hot-reload/session rebuild that
        // resets the runtime overlay legitimately brings it back.
        if (shouldRemovePlacedOnCleanup(completed, a.action.id, def.clearedBy)) {
          const inst = buyMode.instanceForObject(a.target);
          if (inst) {
            buyMode.destroyInstance(inst);
            if (def.blocksNav !== false) rebakeNav();
            applyEnvironment();
            garbage.syncFillBars(); // designer request (2026-07-16): drop any bar for a destroyed garbage can
          }
        }
      }
    } else if (def && !a.action.duration) {
      accidents.rollFor(a.target, def, buildEvalContext(), simClockSeconds);
    }
    // ROADMAP_NEXT item 10: waste production lives on the ACTION (not the asset) — independent of
    // the def.category branch above so it applies no matter what the action's target turned out to
    // be. Reads the sim's current cleanliness personality stat (undefined if that stat was deleted
    // or predates this slice — garbage.ts's decideWasteHandling treats that as "not clean enough").
    if (a.action.producesWaste) {
      handleProducedWaste(a.action.producesWaste);
    }
    // ROADMAP_NEXT item 4/10: the exterior door's `empty_garbage` interaction resets every can —
    // ships with a fixed `duration` (see interactions.json) so it auto-completes and lands here
    // exactly like any other duration-timed action, no new instant-action plumbing needed.
    if (a.action.id === 'empty_garbage') {
      const transit = requestExteriorTransit({ passThrough: () => garbage.emptyAll(), passComplete: () => true });
      if (!transit) garbage.emptyAll();
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
    if (repoOverlayActive || gameOverActive || playerAway() || survivalEventActive()) return; // no orders during terminal/away/collapse events
    if (buyMode.active) { handleBuyModeTap(hit); return; }
    if (hit.object) {
      const tappedNpcId = hit.object.userData.npcId as string | undefined;
      const npc = tappedNpcId && visitors.state.phase === 'visiting'
        ? data.npcs?.npcs.find((entry) => entry.id === tappedNpcId)
        : undefined;
      if (npc && data.social) {
        const interactions = availableSocialInteractions(npc.id, socialRuntime.relationships, data.social);
        const actions = interactions.map(socialActionDef);
        if (actions.length > 0) {
          setSelected(hit.object);
          hud.showActionMenu(socialScoringTarget(npc), actions, (action) => {
            const interaction = interactions.find((entry) => entry.id === action.id);
            if (!interaction) return;
            autonomy.notePlayerCommand();
            cancelCarry();
            orderSocialInteraction(npc, interaction);
          }, quests.funds, currencyName(), hit.screen);
          return;
        }
      }
      const assetId = hit.object.userData.assetId as string;
      let asset = data.assets.assets.find((a) => a.id === assetId);
      let target = hit.object;
      // §7.3 hierarchy: tapping a base asset that's currently blocked by an overlapping
      // accident redirects the whole interaction (menu + walk/action target) onto the
      // accident instance itself — "impossible to cook while the kitchen is on fire".
      if (asset && asset.category !== 'transient') {
        const blocking = accidents.blockingFor(hit.object, asset);
        const effectiveId = resolveTapAssetId(asset.id, blocking);
        if (blocking && effectiveId === blocking.accidentId) {
          const blockingDef = data.assets.assets.find((a) => a.id === effectiveId);
          const blockingObj = accidents.groupFor(blocking.key);
          if (blockingDef && blockingObj) { asset = blockingDef; target = blockingObj; }
        }
      }
      if (asset) {
        // ROADMAP_NEXT B2-1: an action with unmet `conditions` is hidden from the tap menu
        // entirely (not shown-disabled) — evaluated fresh against the live EvalContext at
        // menu-open time, same evaluator/namespace as quests (game/quests.ts's `evaluate`).
        const evalCtx = buildEvalContext();
        const actions = asset.interactions
          .map((id) => data.interactions.actions.find((x) => x.id === id))
          .filter((x): x is NonNullable<typeof x> => !!x)
          .filter((x) => isActionAvailable(x.conditions, evalCtx))
          // B6-12 adds a second, orthogonal availability dimension: generic power actions read
          // this placed instance's live state (Turn On only while OFF; Turn Off only while ON).
          .filter((x) => {
            const key = target.userData.assetStateKey as string | undefined;
            return !key || isAssetStateActionAvailable(x.id, assetStates.isOn(key, asset));
          })
          // leave_for_work keeps its data-side vars.job condition (§7.16) and adds this code-side
          // live departure-window gate, including cross-midnight windows (pure math in work.ts).
          .filter((x) => x.id !== 'leave_for_work'
            || isLeaveForWorkAvailable(
              quests.vars.job,
              data.jobs.jobs,
              currentWorkTime(),
              data.tuning.work?.departureWindowHours ?? 2,
              data.tuning.calendar,
            ));
        if (actions.length > 0) {
          const resolvedAsset = asset;
          setSelected(target);
          hud.showActionMenu(resolvedAsset, actions, (action) => {
            // ROADMAP_NEXT item 10/B3-5 (item 3's "if ALL cans full/none, action refuses with a HUD
            // toast"): checked BEFORE ordering the walk so the sim never sets off toward a
            // dirty_dishes/ash pile it can't actually finish carrying anywhere. Reuses the quest
            // toast surface per the brief ("reuse quest toast") rather than a new UI component.
            // (A can can still go full between now and completion — the render-loop carry check
            // re-verifies and shows the same toast then, transient left untouched either way.)
            if (CARRY_TO_GARBAGE_ACTIONS.has(action.id) && !garbage.hasNonFullCan()) {
              hud.showQuestToast('No empty garbage can available', 'started', 2500);
              return;
            }
            autonomy.notePlayerCommand();
            cancelCarry(); // ROADMAP_NEXT B3-5: a fresh order interrupts any in-progress carry walk
            // ITEM 3 (2026-07-17): take-out-trash routes to the fullest can first, THEN the exterior
            // door — whether the action was ordered on the door or directly on a can (see startTrashOut).
            if (action.id === 'empty_garbage') { startTrashOut(action, target); return; }
            // ROADMAP_NEXT B7-4: a food-source action (fridge Eat / stove Cook) is seatAware but its
            // FIRST leg must reach the source — seat routing is deferred to the carry/eat second leg
            // (startCarriedFood). firstLegSeatAware encodes that so the sim never skips the fridge.
            const legSeatAware = firstLegSeatAware(action);
            const seat = legSeatAware ? findSeatFor(world, data, target) : null;
            if (agent.orderAction(action, target, seat, resolvedAsset, legSeatAware)) cue.showAt(target.position.x, target.position.z);
            else console.log('no path to object', resolvedAsset.id);
          }, quests.funds, currencyName(), hit.screen, (action) => {
            if (!sleepAction(action)) return null;
            return sleepDecisionAt([target.position.x, target.position.z]).reason;
          });
          return; // object tap opens the menu; don't also walk to the tap point
        }
      }
    }
    hud.hideActionMenu();
    if (hit.ground) {
      autonomy.notePlayerCommand();
      cancelCarry(); // ROADMAP_NEXT B3-5: a fresh move order interrupts any in-progress carry walk
      const ok = agent.goTo(hit.ground.x, hit.ground.z);
      if (ok) { cue.showAt(hit.ground.x, hit.ground.z); playTunedSfx('moveOrder'); }
    }
  }, () => visitors.visitorObject ? [visitors.visitorObject] : []);
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
    exteriorDoorTransit.cancel(true);
    if (repoOverlayActive || gameOverActive || playerAway()) return;
    if (agent.current?.action.id === 'use_phone') agent.stopAction();
    buyMode.enter();
    hud.setBuyModeActive(true);
    audio.setMusicContext('buymode', data.map); // ROADMAP_NEXT item 7: crossfade to the buy-mode track
    buyActiveCategory = '';
    buySearchQuery = '';
    buyModeChangedSomething = false;
    hud.setBuySearchValue('');
    refreshBuyCatalog();
  };
  hud.onBuyClose = () => {
    buyMode.exit();
    hud.setBuyModeActive(false);
    audio.setMusicContext('map', data.map); // ROADMAP_NEXT item 7: crossfade back to the map's music
    // Safety net: sim-time freeze means the agent never advances while shopping, but it may have
    // been mid-route when buy mode opened, and a rebake during shopping can invalidate that stale
    // path (moved/sold/bought furniture). Cancelling in place is simpler and safer than trying to
    // resume a path computed against a nav grid that may no longer match.
    if (buyModeChangedSomething && agent.isMoving) { cancelCarry(); agent.goTo(sim.position.x, sim.position.z); }
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
      applyEnvironment();
      refreshBuyCatalog();
      garbage.syncFillBars(); // designer request (2026-07-16): a newly bought garbage can joins the live can set
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
      applyEnvironment();
      refreshBuyCatalog();
      garbage.syncFillBars(); // designer request (2026-07-16): a sold garbage can's bar (if any) must disappear
    }
    hud.hideSelectionChips();
  };
  hud.onSelectionCancel = () => {
    buyMode.deselect();
    hud.hideSelectionChips();
  };

  // --- simulation ticks (all intervals & thresholds from tuning.json / stats.json) ---
  let decayAcc = 0, gainAcc = 0;
  /** B7-6: work departure is higher priority than ordinary free will and deliberately may replace
   *  an in-progress activity (including bed sleep). `orderAction` performs the normal cancel path;
   *  a recent explicit player order suppresses this until its ordinary autonomy cooldown expires. */
  const tryAutoDepartForWork = () => {
    const job = currentJob();
    const workTuning = data.tuning.work;
    const departureWindowHours = workTuning?.departureWindowHours ?? 2;
    if (!job || playerAway() || agent.pendingActionId === 'leave_for_work' || autonomy.playerCommandActive) return false;
    if (!decideAutoDepart({
      withinDepartureWindow: isScheduledWorkWindow(job, currentWorkTime(), data.tuning.calendar)
        && isWithinDepartureWindow(currentWorkTime(), job.hours, departureWindowHours),
      happiness,
      energy: stats.needs.get('energy') ?? 0,
      happinessMin: workTuning?.autoDepartHappinessMin ?? 40,
      energyMin: workTuning?.autoDepartEnergyMin ?? 25,
    })) return false;

    const action = data.interactions.actions.find((entry): entry is ActionDef => entry.id === 'leave_for_work');
    const target = doors.group.children.find((entry) => {
      const def = data.assets.assets.find((asset) => asset.id === entry.userData.assetId);
      return def?.door?.exterior === true && def.interactions.includes('leave_for_work');
    });
    if (!action || !target) return false;
    const targetDef = data.assets.assets.find((asset) => asset.id === target.userData.assetId);
    cancelCarry();
    if (!agent.orderAction(action, target, null, targetDef)) return false;
    hud.hideActionMenu();
    hud.showQuestToast('Your Sim is leaving for work', 'started', data.tuning.quests.toastDurationSeconds * 1000);
    return true;
  };
  const simTick = (dt: number) => {
    decayAcc += dt;
    const decayEvery = data.tuning.simulation.needsDecayTickSeconds;
    while (decayAcc >= decayEvery) {
      decayAcc -= decayEvery;
      stats.decayTick();
      happiness = computeHappiness(data.happiness, buildEvalContext());
      hud.setHappiness(happiness);
      // ROADMAP_NEXT B2-4: zero-crossing check happens right after decay, on the same tick bladder
      // could have just hit 0 — BEFORE autonomy.maybeAct() below, so a fresh failure preempts
      // whatever free will would otherwise have picked this tick (matches "the event preempts
      // everything").
      const bladderNow = stats.needs.get('bladder');
      // ROADMAP_NEXT B3-3: checkBladderFailure only decides the zero-crossing fire now — re-arming
      // happens explicitly once the event completes (see peeState's completion below), not from a
      // later bladder reading (bladder-only decay can never climb back above reliefAmount on its
      // own, which made the old re-arm condition unreachable in practice).
      if (starvation.state.phase !== 'collapse' && starvation.state.phase !== 'gameOver') {
        handleEnergyCollapse(tickEnergyCollapse(
          energyCollapseState, 0, stats.needs.get('energy') ?? 100,
          { collapseSeconds: data.tuning.energyCollapse?.collapseSeconds ?? 2, sleepSeconds: data.tuning.energyCollapse?.sleepSeconds ?? 20 },
        ));
      }
      if (!survivalEventActive() && bladderNow !== undefined && checkBladderFailure(bladderFailureState, bladderNow)) {
        triggerBladderFailure();
      }
      // Work gets first refusal and may interrupt an activity; ordinary free will remains idle-only.
      if (!tryAutoDepartForWork()) autonomy.maybeAct();
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
        const skillsBefore = Object.fromEntries(stats.skills);
        // Per-asset need multipliers (B11-x): credit the gain to the asset the sim is actually
        // PERCHED on for seat-aware actions (active.seat — e.g. the couch you sit on to watch TV,
        // which is what makes a comfy sofa feel better), falling back to the action's target asset
        // for everything else. Same effectiveNeedGain helper as the autonomy scorer (stats.ts).
        const gainAsset = active.seat ?? active.target;
        const gainAssetId = gainAsset.userData?.assetId as string | undefined;
        const gainMultipliers = gainAssetId
          ? data.assets.assets.find((d) => d.id === gainAssetId)?.needMultipliers
          : undefined;
        // Social interaction gains are atomic completion effects (SOCIAL S4), never per-tick.
        // Their needGains remain on ActionDef solely so the ordinary behavior scorer can rank them.
        if (socialSession.active?.action !== active.action) stats.applyGains(active.action, gainMultipliers);
        const skillsAfter = Object.fromEntries(stats.skills);
        for (const up of skillLevelUps(skillsBefore, skillsAfter)) {
          const name = data.stats.skills.find((def) => def.id === up.id)?.name ?? up.id;
          hud.showFloatingFeedback(formatSkillUp(name, up.levels), 'skill');
          playTunedSfx('skillUp');
        }
        // auto-stop when the action's primary need is satisfied
        const pn = active.action.primaryNeed;
        if (socialSession.active?.action !== active.action
          && pn && (stats.needs.get(pn) ?? 0) >= data.tuning.autonomy.stopAtThreshold) {
          agent.stopAction(true); // ROADMAP_NEXT B3-4: natural finish, not a cancel
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
  // ROADMAP_APT R4: the whole rebuild body is a named closure so the move-in map switch reuses
  // the EXACT hot-reload rebuild path (world/doors/lights/nav/audio/finance/quests retunes + the
  // map-id-change respawn branch) instead of a second parallel rebuild. watchData still calls it
  // on every data edit; completePendingMove (below) calls it once with freshly-loaded data after
  // wiping map-bound runtime state.
  const applyFreshData = (fresh: GameData) => {
    data = fresh;
    applyTheme(data.theme);
    exteriorDoorTransit.cancel(true);
    // A pending Buy Mode ghost belongs to the old asset/map snapshot. Detach and dispose its
    // cached translucent visual before disposeGroup(world) tears down the old scene graph.
    buyMode.prepareForWorldRebuild();
    scene.remove(world);
    disposeGroup(world);
    world = buildWorld(data);
    doors = buildDoors(data);
    world.add(doors.group);
    applyWallCutView(world, wallCutActive, data.tuning.view?.wallCutHeight ?? 1);
    scene.add(world);
    // D4: re-apply the scene-level exterior (sky/fog + ground handle) for the freshly-built world —
    // this is also what swaps the exterior on an R4 runtime map switch (the ground/backdrop meshes
    // were already rebuilt inside buildWorld above; a void map clears sky/fog back to the default).
    applyExteriorScene(scene, world, data.map);
    // §7.3: buildWorld() has no notion of runtime accident instances (never in map data) —
    // re-parent every LIVE fire/puddle into the freshly-built world so hot-reload never wipes them.
    accidents.reattach(world);
    // §7.6: same reasoning — buildWorld() rebuilds designer objects fresh (undoing any buy-mode
    // sold/moved override) and knows nothing about player-purchased additions; reattach patches
    // both back onto the new world. rebakeNav() (not a raw bakeNavGrid call) so the overlay keeps
    // feeding the nav grid across hot-reloads too.
    buyMode.reattach(world);
    garbage.syncFillBars(); // designer request (2026-07-16): the live can set/positions can change across a hot-reload
    syncAssetStates();
    cam.retune(data.tuning.camera, data.map);
    rebakeNav();
    audio.retune(data.tuning); // ROADMAP_NEXT item 7: volumes/crossfade/buyModeMusic may have changed
    if (data.map.id !== currentMapId) {
      // map switch (tuning.map.active changed) — respawn the sim on the new map
      currentMapId = data.map.id;
      agent.teleportTo(data.map.spawn.pos[0], data.map.spawn.pos[1], data.map.spawn.facingDeg);
      hud.hideActionMenu();
      audio.mapChanged(); // restart the new map's playlist from the top rather than resuming the old cycle position
      // B13-7: fresh map means a fresh sim — give the player a beat before free will kicks in.
      autonomy.forceCooldown(data.tuning.autonomy.decisionGraceSeconds ?? 5);
    }
    // keep the music channel pointed at the right context (its own track/playlist content may
    // have changed even without a context switch — setMusicContext no-ops when nothing changed)
    audio.setMusicContext(buyMode.active ? 'buymode' : 'map', data.map);
    stats.retune(data.stats, data.tuning.skills?.growthCurveExp ?? 1.5);
    if (data.social) socialRuntime.retune(data.social);
    visitors.retune();
    hud.rebuildBars();
    applyEnvironment();
    quests.retune(data.quests, data.simstate); // definitions only — runtime quest/var state is untouched
    visaMachine.retune(data.visas); // definitions only — runtime visa state is untouched (§7.20 B3-6)
    phoneJobs.retune(data.jobs, data.tuning.phone?.jobListSize); // defs/tuning only; hourly cadence survives
    bills.retune(data.bills, data.finance, data.tuning.bills?.intervalDays, data.tuning.credit); // formulas/defs/cadence/credit tuning only; runtime state survives
    happiness = computeHappiness(data.happiness, buildEvalContext());
    hud.setHappiness(happiness);
    hud.setPhoneIcon(data.tuning.phone?.icon ?? '/icons/Smartphone.png');
    refreshVisaChip();
    refreshPhone();
    refreshQuestLog();
    if (data.tuning.character) {
      anim?.retune(data.tuning.character);
      anim?.setWalkSpeed(data.tuning.movement.walkSpeed);
      loadCharacter(); // no-op unless meshPath changed
      if (!marker) {
        marker = createMarkerInstance(scene, sim, data.tuning.character);
        marker.pivot.visible = !playerAway();
      }
    } else if (marker) {
      marker.dispose();
      marker = null;
    }
    hud.setFunds(quests.funds, currencyName());
    if (buyMode.active) refreshBuyCatalog(); // asset prices/icons/gates may have changed mid-shop
  };
  watchData(applyFreshData);

  // --- ROADMAP_APT R4: move-in completion → runtime map switch ---------------------------------
  /** Home-map PERSISTENCE is intentionally NOT implemented yet. R4 originally wrote the new home to
   *  data/simstate.json via a runtime PUT, but the designer does NOT want any persistence before the
   *  save system exists — a browser refresh must always boot the authored map (tuning.map.active via
   *  resolveHomeMapId), never the rented apartment. So the move is applied IN MEMORY only
   *  (quests.vars.homeMap, below) and nothing is written to disk. Boot still reads resolveHomeMapId
   *  (game/data.ts) so the future save system can restore a home by seeding that var, but no code
   *  path writes it. */

  /** The move-in countdown completed (the ONLY path that switches maps — side_effect_rule).
   *  Per-system KEEP/DROP decisions for the runtime switch, each chosen against that system's
   *  serialize()/restore() surface:
   *  - KEEP needs/skills/personality: SimStats is untouched (the sim is the same person).
   *  - KEEP funds/vars/quest state/unlocks: QuestRunner is untouched (economy + progression are
   *    not map-bound); the homeMap var is UPDATED through the same runtime surface a quest
   *    setVar reward writes (quests.vars).
   *  - KEEP visa/job/work skips/levels: VisaMachine/WorkTracker untouched (immigration status and
   *    employment follow the sim). The switch is deferred while work.isAtWork so the return
   *    teleport can never land on a stale map (see the render-loop gate).
   *  - KEEP credit/outstanding bills: FinanceState untouched — already-issued bills keep their
   *    snapshot amounts (they were incurred at the old home); the NEXT cycle recomputes from the
   *    new map because main.ts passes the live data.map/effective objects into bills.tick.
   *  - KEEP phone job-search roll + hourly cadence, camera prefs, wall-cut preference (view-only).
   *  - DROP accident instances (fires/puddles/dirty dishes/ash burn with the old address —
   *    restore({}) also disposes every live THREE group) and their destroyed-base/spread history.
   *  - DROP buy-mode overlay: destroyed/sold/moved overrides index the OLD map's placedObjects
   *    (designer indices) and player purchases sit at old-map coordinates — both meaningless on
   *    the new map, so the overlay resets and furniture purchases are LEFT BEHIND (deliberate:
   *    no auto-refund, matching "moving is a fresh start"; flagged in ROADMAP_APT R4 notes).
   *  - DROP carried food + pending waste: the food registry is discarded outright (no waste is
   *    spawned — that would litter the NEW map with the OLD map's leftovers) and waste transients
   *    die with the accident registry above.
   *  - DROP garbage fill: fills are keyed per old-map can instance; the new home starts clean.
   *  - DROP asset ON/OFF state: assetStateKeys are per-map placed indices ("designer:<i>") and
   *    would silently leak onto the new map's same-index instances if kept.
   *  Nav rebake, environment score, music restart, and door re-registration all ride the shared
   *  applyFreshData rebuild (its map-id-change branch also teleports the sim to the new spawn). */
  let mapSwitchInFlight = false;
  const completePendingMove = async (mapId: string) => {
    mapSwitchInFlight = true;
    try {
      // Runtime home var only — the same mechanism a quest setVar reward uses (§6.1). No PUT: the
      // home is NOT persisted (see the note above completePendingMove); a refresh returns to the
      // authored map until the save system lands.
      quests.vars.homeMap = mapId;
      // B13-5: register the runtime destination with data.ts so EVERY loadAll() — this one and
      // the 2s hot-reload poll — resolves the new home (B10-22 removed the simstate PUT, so the
      // on-disk homeMap stays null and disk resolution alone would abort/revert the move).
      setRuntimeHomeMap(mapId);
      // Fresh full bundle: loadAll() re-reads live data (the switched map is applied below).
      // If the server hiccups, fall back to the already-fetched Kijiji copy of the map.
      let fresh: GameData | null = null;
      try {
        fresh = await loadAll();
      } catch {
        const known = allMaps.find((m) => m.id === mapId);
        if (known) fresh = { ...data, map: known };
      }
      if (!fresh || fresh.map.id !== mapId) {
        // Neither source produced the destination map (deleted mid-countdown?) — abort without
        // switching; the pending state was already consumed, nothing else was applied.
        console.warn(`move-in aborted: map "${mapId}" could not be loaded`);
        setRuntimeHomeMap(null); // don't leave the poll chasing a missing map
        return;
      }
      // Cancel whatever the sim was doing (a cancel, never a completion — no side effects) and
      // drop every map-bound runtime system per the KEEP/DROP table above.
      agent.stopAction();
      carryState = null;
      durationState = null;
      panicState = null;
      peeState = null;
      for (const item of [...food.all]) food.discard(item.key);
      accidents.restore({ instances: [], seq: accidents.serialize().seq, destroyedBase: [], spreadRolled: [] });
      buyMode.restore({ additions: [], overrides: [], seq: 0 });
      garbage.emptyAll();
      assetStates.restore({ on: {} });
      // DROP accrued Hydro usage: it was metered against the OLD home's assets; the new home starts
      // a fresh period (the Hydro bill's base formula still rides applyFreshData's finance retune).
      hydro.reset();
      currentHydroRate = 0;
      // One shared rebuild: world/doors/lights/nav/audio/finance retunes + the map-id-change
      // branch (spawn teleport, action-menu close, music restart). The empty registries make the
      // reattach calls inside it harmless no-ops. The next watchData poll will see the changed
      // simstate/map signature and run applyFreshData once more — a routine, idempotent rebuild.
      applyFreshData(fresh);
      hud.showQuestToast(
        `Moved in: ${fresh.map.name || mapId}`,
        'completed',
        data.tuning.quests.toastDurationSeconds * 1000,
        'questCompleted',
      );
      refreshPhone();
    } finally {
      mapSwitchInFlight = false;
    }
  };

  // --- game clock (display only in Phase 0; drives day/night in Phase 1; day count feeds quests' time.day) ---
  let gameSeconds = 8 * 3600; // start the day at 08:00
  let gameDay = 1;
  applyEnvironment();
  refreshVisaChip(); // now that gameDay exists, show the starting visa chip immediately
  happiness = computeHappiness(data.happiness, buildEvalContext());
  hud.setHappiness(happiness);
  // ROADMAP_NEXT B2-1: single builder for the EvalContext the quest evaluator (`evaluate` from
  // game/quests.ts) runs against — reused by the accident-roll call below (was already inlined
  // here), the tap-menu action-visibility filter, and Autonomy's condition check (passed in as a
  // callback at construction time; `let` bindings closed over here are fine to reference from a
  // callback invoked later, since by the time anything actually calls this, gameSeconds/gameDay/
  // stats/quests are all initialized — function declarations hoist within `start()`'s scope).
  function buildEvalContext(): EvalContext {
    return {
      needs: Object.fromEntries(stats.needs),
      skills: Object.fromEntries(stats.skills),
      personality: Object.fromEntries(stats.personality),
      funds: quests.funds,
      creditScore: bills.creditScore,
      time: { hour: Math.floor(gameSeconds / 3600), day: gameDay },
      vars: quests.vars,
      quests: quests.quests,
    };
  }
  function currentWorkTime() { return { hour: gameSeconds / 3600, day: gameDay }; }
  const clockScale = () => 86400 / data.tuning.time.secondsPerGameDay;
  // ROADMAP_NEXT item 6: monotonic sim-time seconds elapsed since the game started, on the SAME
  // sdt as everything else (pause/2x/3x affect it identically) but — unlike gameSeconds — never
  // wraps at midnight, so a fire's burn timer never sees its elapsed time jump backward across a
  // day boundary. Fire is the only current consumer; kept general in case anything else ever
  // wants an unwrapping sim clock.
  let simClockSeconds = 0;
  // ROADMAP_APT R4: last in-game hour the Kijiji tab was refreshed for the pending-move countdown.
  let lastPendingRefreshHour = -1;

  // --- render loop ---
  let last = performance.now();
  // ITEM 1 (2026-07-17): garbage fill-bar occlusion is recomputed only when the camera actually
  // moved/rotated OR on a ~0.25s tick (never every frame) — occlusion can only change with camera
  // motion or a rare world rebuild, and the fill-bar set is small. Camera motion is detected by
  // comparing the live camera transform to the last one we tested against (real-time, cosmetic).
  let occAcc = 0;
  const lastCamPos = new THREE.Vector3(Infinity, Infinity, Infinity);
  const lastCamQuat = new THREE.Quaternion();
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
    // §7.20 B3-6: game over freezes sim time the SAME way buy mode does (reuse, not a new mechanism)
    // — the overlay's Restart button (location.reload()) is the only way out in V1 (no save system).
    // V3 parallels buy mode's one-line effective-speed override without mutating hud.speed: buy
    // mode multiplies by 0 (freeze), work multiplies by tuning.work.autoSpeed (default 5). The HUD
    // selection is locked/preserved while away and becomes effective again on return.
    const selectedSpeed = playerAway() ? (data.tuning.work?.autoSpeed ?? 5) : hud.speed;
    const effectiveSpeed = Number.isFinite(selectedSpeed) ? Math.max(0, selectedSpeed) : 0;
    const sdt = (initialLoadingActive || buyMode.active || repoOverlayActive || gameOverActive) ? 0 : dt * effectiveSpeed;
    simClockSeconds += sdt;
    // ROADMAP_NEXT item 7: sfx/action/asset loops pause whenever sim time isn't advancing (the
    // pause button OR buy mode's own freeze); music is deliberately NOT touched here (see
    // audio.ts's module doc comment on the PAUSE decision).
    audio.setPaused(initialLoadingActive || effectiveSpeed === 0 || buyMode.active || repoOverlayActive || gameOverActive);
    syncAssetStates(); // picks up newly purchased/sold stateful instances; idempotent for steady state

    const previousGameHour = gameSeconds / 3600;
    const gameSecondsDelta = sdt * clockScale();
    gameSeconds += gameSecondsDelta;
    // Hydro: accrue this frame's ON metered draw over the sim-hours elapsed. Paused/loading frames
    // have sdt = 0, so nothing accrues; the charge is folded onto the Hydro bill at each cycle below.
    hydro.accrue(gameSecondsDelta / 3600, currentHydroRate);
    while (gameSeconds >= 86400) {
      gameSeconds -= 86400;
      gameDay++;
      // §7.20 B3-6: the visa machine ticks once per day BOUNDARY crossed (not per frame/second) —
      // ticking inside this while loop (rather than once after it) means a multi-day skip (e.g.
      // a long pause + fast-forward) still evaluates each day in order, same as quests' time.day.
      visaMachine.tick(gameDay);
      const billArrival = bills.tick(gameDay, {
        map: data.map,
        assets: data.assets,
        placedObjects: buyMode.effectivePlacedObjectsList(),
      }, { [HYDRO_BILL_ID]: hydro.accruedCharge });
      // A bill arrived => the accrued Hydro usage was folded onto it; reset for the next period.
      // (tick returns null on non-billing days, leaving the accumulator to keep growing.)
      if (billArrival) hydro.reset();
      if (billArrival?.arrived.length) {
        hud.showQuestToast(
          `Bills arrived: §${billArrival.total.toLocaleString()}`,
          'started',
          data.tuning.quests.toastDurationSeconds * 1000,
        );
      }
      bills.observeFunds(gameDay, quests.funds);
      handleRepoIfDue();
      refreshVisaChip();
      refreshPhone();
    }
    // Environment is event-recomputed, never tick-fed. The clock is already advanced here for
    // the day/night sky, so compare the old/new window state and recompute only at its boundaries.
    if (crossedNightWindowBoundary(
      previousGameHour,
      gameSeconds / 3600,
      data.tuning.time.nightStartHour,
      data.tuning.time.nightEndHour,
    )) applyEnvironment();
    const h = Math.floor(gameSeconds / 3600), m = Math.floor((gameSeconds % 3600) / 60);
    hud.setClock(h, m, weekdayName(currentWorkTime(), data.tuning.calendar));
    applyDayNight(lights, scene, gameSeconds / 3600, data.tuning.time.nightStartHour, data.tuning.time.nightEndHour);

    // Pure attendance clock: returns/pay and fully-ended missed windows are decided here after the
    // clock advances. The cursor in WorkTracker makes each work window process exactly once.
    for (const event of work.tick(
      currentJob(),
      currentWorkTime(),
      data.tuning.work?.departureWindowHours ?? 2,
      data.tuning.calendar,
    )) handleWorkEvent(event);

    // SOCIAL S6: same "pure clock decides, main.ts applies" split as the work tick above.
    const visitReturned = visitAway.tick(currentWorkTime());
    if (visitReturned) handleVisitReturn(visitReturned);

    // ROADMAP_APT R4: move-in completion check. The countdown runs on the same sim-time clock as
    // food perishing (gameHourNow — pause freezes it, 2x/3x and the work auto-speed advance it).
    // The actual switch is DEFERRED while the sim is away at work (the shift's return teleport
    // must land on the map it left from), while buy mode/repo/game-over overlays are up, and
    // while a previous switch is still in flight — the pending state simply waits, takeCompleted
    // is only called when the switch can really happen (side_effect_rule: completion is the one
    // and only trigger; cancel applies nothing).
    if (!mapSwitchInFlight && !playerAway() && !buyMode.active && !repoOverlayActive && !gameOverActive
      && pendingMove.isReady(gameHourNow())) {
      const moveMapId = pendingMove.takeCompleted(gameHourNow());
      if (moveMapId) void completePendingMove(moveMapId);
    }
    // Keep the Kijiji countdown label fresh (once per crossed in-game hour, only while pending —
    // refreshPhone is cheap but not free, and the label is hour-granular anyway).
    if (pendingMove.pending) {
      const hourNow = Math.floor(gameHourNow());
      if (hourNow !== lastPendingRefreshHour) { lastPendingRefreshHour = hourNow; refreshPhone(); }
    }

    agent.update(sdt);
    // Re-evaluate during sleep so a newly switched-on device, hot-reloaded default, or door that
    // closes between rooms interrupts through the ordinary CANCEL path (completed=false).
    if (agent.current && sleepAction(agent.current.action)) {
      const decision = sleepDecisionAt([sim.position.x, sim.position.z]);
      if (decision.blocked) {
        agent.stopAction(false);
        hud.showQuestToast(decision.reason!, 'started', data.tuning.quests.toastDurationSeconds * 1000);
      }
    }
    visitors.update(sdt, clockScale());
    // Paired social rendezvous: both agents used their normal orderAction/usePose route. Only now
    // do the authored role clips, one shared sim-time duration, and interaction sound begin.
    if (pairedSocial && !pairedSocial.started && agent.current?.action === pairedSocial.playerAction
      && visitors.isInteractionReady(pairedSocial.npcAction)) {
      pairedSocial.started = true;
      if (pairedSocial.targetDef.category === 'beds') {
        const rotationDeg = THREE.MathUtils.radToDeg(pairedSocial.target.rotation.y);
        const lie = usePoseFor('lie', {
          pos: [pairedSocial.target.position.x, pairedSocial.target.position.z], rotDeg: rotationDeg,
        }, pairedSocial.targetDef, data.tuning);
        const positions = pairedAssetPositions(
          lie.pos,
          rotationDeg,
          pairedSocial.targetDef.footprint,
        );
        sim.position.x = positions.player[0]; sim.position.z = positions.player[1];
        const visitor = visitors.visitorObject;
        if (visitor) { visitor.position.x = positions.npc[0]; visitor.position.z = positions.npc[1]; }
      }
      const socialOrder = socialSession.active;
      if (socialOrder) {
        anim?.play(socialAnimationFor(socialOrder.interaction, 'player') || 'idle');
        visitors.playInteraction(socialAnimationFor(socialOrder.interaction, 'npc'));
        const active = agent.current;
        const total = active ? computeDurationSeconds(active.action.duration, Object.fromEntries(stats.skills), data.stats.skills, Object.fromEntries(stats.needs)) : null;
        durationState = active && total !== null ? { action: active, totalSeconds: total, elapsed: 0 } : null;
        if (active?.action.sound) audio.startLoop(`action:${active.action.id}`, active.action.sound);
      }
    }
    // A timed/availability departure can preempt an approach or active conversation. Route that
    // through the ordinary completed=false stop so no social effects land and both Sims clean up.
    if (socialSession.active && visitors.state.phase !== 'visiting') agent.stopAction(false);
    // Relationship drift follows the same authored in-world clock as visits (sim-time, not real-time).
    socialRuntime.decay((sdt * clockScale()) / (24 * 60 * 60));
    // ROADMAP_NEXT B3-5: "carry to garbage" arrival check — carryState is only ever set right after
    // agent.goTo() successfully routed the sim to a can (see onActionStop above), and only ever
    // cleared early by cancelCarry() when some other order redirects the sim mid-walk. So observing
    // `!agent.isMoving` here means one of exactly two things: the sim genuinely reached the can (the
    // common case), or goTo's arrivalRadius snapped it onto a cell it was already standing on this
    // same frame (astronomically rare, harmless — same "deposit, then despawn" happens either way).
    // Deposit is re-resolved at arrival (not the can picked at carry-start) via depositAtNearestCan,
    // matching that method's own "recompute, don't assume" doc comment; despawn reuses the ordinary
    // clearedBy/maybeCleanup path exactly like the pre-B3-5 instant-despawn code did.
    if (carryState && !agent.isMoving) {
      const cs = carryState;
      carryState = null;
      garbage.depositAtNearestCan([sim.position.x, sim.position.z]);
      accidents.maybeCleanup(cs.target, cs.actionId);
    }
    // ITEM 3 (2026-07-17): take-out-trash arrival at the collection can (fullest can / the ordered-on
    // can) — now order the real `empty_garbage` action on the exterior door. Its completion empties
    // every can (existing onActionStop). Mutually exclusive with carryState (only one is ever set).
    if (trashOutState && !agent.isMoving) {
      const ts = trashOutState;
      trashOutState = null;
      const doorDef = assetById(ts.doorTarget.userData.assetId as string);
      if (!agent.orderAction(ts.action, ts.doorTarget, null, doorDef)) {
        hud.showQuestToast('No path to the door', 'started', 2500);
      }
    }
    // B4-2: dropped food ages in monotonic in-game hours; pause freezes it and crossing midnight
    // stays monotonic through gameDay. The pure registry returns keys for the transient layer.
    for (const key of food.tick(gameHourNow())) accidents.despawnTransient(key);
    // ROADMAP_NEXT item 5 (§7.11): duration-timed actions auto-complete on the same sim time as
    // everything else here — a normal stop (triggers onActionStop → accident roll, animation
    // reset, etc.), just driven by elapsed time instead of a filled primaryNeed.
    if (durationState && agent.current === durationState.action) {
      durationState.elapsed += sdt;
      if (isDurationComplete(durationState.elapsed, durationState.totalSeconds)) agent.stopAction(true); // ROADMAP_NEXT B3-4: natural finish, not a cancel
    }
    // ROADMAP_NEXT B2-4: bladder-failure's own tiny timer — same isDurationComplete helper as the
    // §7.11 duration system, ticked on the same sim time (pause freezes the 'pee' animation,
    // 2x/3x speeds it up). Not gated on agent.current (this event has no ActiveAction) — cleared
    // to null the moment it completes so it can never double-fire.
    if (peeState) {
      peeState.elapsed += sdt;
      if (isDurationComplete(peeState.elapsed, peeState.totalSeconds)) {
        peeState = null;
        if (!survivalEventActive()) anim?.play('idle');
        stats.refillNeed('bladder', data.tuning.bladderFailure?.reliefAmount ?? 30);
        // ROADMAP_NEXT B3-2: pees itself → hygiene takes a hit too (absolute set, same convention
        // as the bladder relief top-up above — not a delta).
        stats.refillNeed('hygiene', data.tuning.bladderFailure?.hygieneAfter ?? 0);
        // ROADMAP_NEXT B3-3: the event has now fully completed (relief applied) — re-arm the latch
        // so a second failure can fire once bladder decays back to 0 again.
        rearmBladderFailure(bladderFailureState);
      }
    }
    // ROADMAP_NEXT B2-5: panic's own tiny timer — same isDurationComplete helper, same sim time.
    // Not gated on agent.current (this event has no ActiveAction either, like bladder failure);
    // cleared to null the moment it completes so it can never double-fire. Resuming behavior after
    // this is simply "autonomy.forceCooldown's window lapses" — no explicit action needed here,
    // same as bladder failure's own doc comment.
    if (panicState) {
      panicState.elapsed += sdt;
      if (isDurationComplete(panicState.elapsed, panicState.totalSeconds)) {
        panicState = null;
        if (!survivalEventActive()) anim?.play('idle');
      }
    }
    // doors advance on the same sim time as the animation mixer (pause freezes them mid-swing,
    // 2×/3× speeds them up) — reuses this per-frame loop, no dedicated door timer (§7.1).
    const simPos: [number, number] = [sim.position.x, sim.position.z];
    const simPath = agent.getPathPoints();
    for (const d of doors.instances) d.update(sdt, simPos, simPath);
    exteriorDoorTransit.update();
    // ROADMAP_NEXT item 6: fire burn timers + spread rolls advance on the same sim time as doors —
    // pause freezes a burning fire mid-blaze, 2x/3x speeds it toward destruction/spreading.
    accidents.tick(simClockSeconds);
    // §7.5: animated-GIF sprites (furniture AND accidents — anything attached via world.ts's
    // shared attachMesh) advance on the SAME sim time as doors/the animation mixer. One traversal
    // covers every group in the current world (accidents' live groups and doors.group are both
    // parented under it), so a sprite gets its frames ticked with no extra per-caller wiring.
    world.traverse((o) => { o.userData.spriteUpdate?.(sdt); });
    anim?.update(sdt); // sim time: pause freezes the character, 2×/3× speed it up
    if (marker && data.tuning.character) marker.update(sdt, data.tuning.character); // §7.7: same sim time as the mixer/doors/sprites
    // ROADMAP_NEXT B2-5: progress bar tracks durationState directly (elapsed/total, both already
    // sim-time) — visible for ANY duration-timed action, cook included (free consistency win).
    const durationProgress = durationState ? (durationState.totalSeconds > 0 ? durationState.elapsed / durationState.totalSeconds : 1) : 0;
    progressBar.update(sim, !!durationState, durationProgress, data.tuning.character?.heightMeters ?? 1.55);
    // ITEM 2 (2026-07-17): skill bar — visible whenever the current action grants a skill, showing
    // ONLY the primary (largest-gain) skill's progress toward its next point (game/stats.ts's pure
    // skillPointProgress). Hidden at max level and when the action has no skillGains. Stacked above
    // the action bar (never overlapping) — see game/progressbar.ts createSkillBarInstance.
    const curAction = agent.current?.action;
    const primarySkill = curAction ? primarySkillGain(curAction.skillGains) : null;
    let skillActive = false, skillFraction = 0, skillLabel = '';
    if (primarySkill) {
      const sdef = stats.skillDefs.find((s) => s.id === primarySkill.id);
      if (sdef) {
        const level = stats.skills.get(sdef.id) ?? sdef.default;
        const max = sdef.max ?? 100;
        const prog = skillPointProgress(level, max);
        // ITEM 4: include the real level/max in the in-world label ("<Skill> 3/10:") — same numeric
        // readout the HUD skill bars now carry, using each skill's real max from stats.json.
        if (!prog.atMax) { skillActive = true; skillFraction = prog.fraction; skillLabel = `${sdef.name} ${Math.round(level)}/${max}:`; }
      }
    }
    skillBar.update(sim, skillActive, skillFraction, skillLabel, data.tuning.character?.heightMeters ?? 1.55, resolveSkillBarConfig(data.tuning.feedback?.skillBar));
    cue.update(dt); // UI feedback stays real-time
    // ROADMAP_NEXT B2-3: censor quad — real-time dt (see game/censor.ts's module doc comment),
    // active purely from the current action's own `censor` flag (covers autonomy-driven AND
    // player-tapped shower/WC use identically, no extra plumbing at either call site).
    censor.update(dt, sim, !!agent.current?.action.censor, data.tuning.character?.heightMeters ?? 1.55);
    // Explicit V3 simplification: while off-lot the sim gets neither autonomy nor needs decay (and
    // the decay/gain accumulators do not advance, so there is no catch-up burst on return). The
    // world clock/doors/fires still advance at the work auto-speed above.
    if (!playerAway()) {
      autonomy.update(sdt);
      simTick(sdt);
      if (starvation.state.phase !== 'collapse' && starvation.state.phase !== 'gameOver') {
        handleEnergyCollapse(tickEnergyCollapse(
          energyCollapseState,
          sdt,
          stats.needs.get('energy') ?? 100,
          {
            collapseSeconds: data.tuning.energyCollapse?.collapseSeconds ?? 2,
            sleepSeconds: data.tuning.energyCollapse?.sleepSeconds ?? 20,
          },
        ));
      }
      tickStarvation(sdt);
    }
    observeFundsFeedback();
    const feedbackCfg = data.tuning.feedback;
    feedbackAnchor.set(
      sim.position.x,
      sim.position.y + (data.tuning.character?.heightMeters ?? 1.55) + (feedbackCfg?.yOffsetMeters ?? 0.25),
      sim.position.z,
    ).project(cam.camera);
    const canvasRect = renderer.domElement.getBoundingClientRect();
    hud.updateFloatingFeedback(
      sdt,
      canvasRect.left + (feedbackAnchor.x + 1) * canvasRect.width / 2,
      canvasRect.top + (1 - feedbackAnchor.y) * canvasRect.height / 2,
      feedbackCfg?.durationSeconds ?? 1.6,
      feedbackCfg?.risePixels ?? 48,
    );
    hudAcc += dt;
    if (hudAcc >= 0.25) { hudAcc = 0; hud.refresh(); hud.setFunds(quests.funds, currencyName()); } // 4 Hz is plenty for bars/funds

    // ITEM 1: throttled garbage fill-bar occlusion — recompute on camera move/rotate or every 0.25s.
    occAcc += dt;
    const camMoved = !lastCamPos.equals(cam.camera.position) || !lastCamQuat.equals(cam.camera.quaternion);
    if (camMoved || occAcc >= 0.25) {
      occAcc = 0;
      lastCamPos.copy(cam.camera.position);
      lastCamQuat.copy(cam.camera.quaternion);
      garbage.updateFillBarOcclusion(cam.camera, world.children);
    }

    renderer.render(scene, cam.camera);
  });

  await initialLoads.done; // success and stand-in fallback both settle the real boot gate
  initialLoadingActive = false;
  window.clearInterval(phraseTimer);
  audio.setMusicContext('map', data.map);
  boot.classList.add('done');
  // B13-7: don't let the Sim take an autonomous decision the instant the game becomes playable.
  autonomy.forceCooldown(data.tuning.autonomy.decisionGraceSeconds ?? 5);
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

void start();
