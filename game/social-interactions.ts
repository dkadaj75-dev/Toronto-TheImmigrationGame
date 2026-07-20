// social-interactions.ts — pure SOCIAL S4 menu/action/effect decisions.
// The three.js choreography stays in main.ts; completion and cancellation share this coordinator
// so no need, visitor-meter, relationship, or end-visit side effect can leak onto an interrupt.

import type { ActionDef, AssetDef } from './data';
import type { NpcDef } from './npc';
import {
  compatibility,
  levelAllows,
  type InteractionDef,
  type RelationshipState,
  type SocialData,
} from './social';

/** Context menu contents at the score's CURRENT level. endVisit is an engine escape hatch and is
 * always offered even if a stale/mistaken authored level gate says otherwise. */
export function availableSocialInteractions(
  npcId: string,
  relationships: RelationshipState,
  data: SocialData,
): InteractionDef[] {
  const level = relationships.levelFor(npcId);
  return data.interactions.filter((interaction) =>
    interaction.special === 'endVisit' || levelAllows(interaction, level, data));
}

/** Adapt social.json's deliberately small schema into the ordinary SimAgent action pipeline. */
export function socialActionDef(interaction: InteractionDef): ActionDef {
  return {
    id: interaction.id,
    name: interaction.name ?? interaction.id,
    needGains: { ...(interaction.needGains ?? {}) },
    skillGains: {},
    animation: socialAnimationFor(interaction, 'player'),
    sound: interaction.sound || undefined,
    autonomyEligible: interaction.autonomyEligible === true,
    primaryNeed: null,
    censor: interaction.censor === true,
    duration: { baseSeconds: Math.max(0, finite(interaction.durationSeconds)) },
  };
}

export type SocialRole = 'player' | 'npc';

/** A blank/missing role override deliberately falls back to the existing shared animation. */
export function socialAnimationFor(interaction: InteractionDef, role: SocialRole): string {
  const override = role === 'player' ? interaction.playerAnimation : interaction.npcAnimation;
  return override?.trim() || interaction.animation?.trim() || '';
}

/** Merged, trimmed, deduplicated target list: legacy single `targetAsset` + the `targetAssets`
 *  array (2026-07-19 designer request: as many acceptable assets as wanted). */
export function socialTargetList(interaction: Pick<InteractionDef, 'targetAsset' | 'targetAssets'>): string[] {
  const merged = [interaction.targetAsset, ...(interaction.targetAssets ?? [])]
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => !!entry);
  return [...new Set(merged)];
}

/** Each entry accepts either an exact asset id or a category, with no separate schema branch. */
export function matchesSocialTarget(interaction: InteractionDef, asset: Pick<AssetDef, 'id' | 'category'>): boolean {
  return socialTargetList(interaction).some((target) => asset.id === target || asset.category === target);
}

/** Pure routing decision shared by runtime/tests. Beds always request the existing lie pose,
 * independently of the authored clip name; other paired assets use their ordinary pose rules. */
export function socialRoutingDecision(
  interaction: InteractionDef,
  asset?: Pick<AssetDef, 'id' | 'category'>,
): { paired: boolean; matches: boolean; pose: 'lie' | null } {
  const paired = socialTargetList(interaction).length > 0;
  return { paired, matches: paired && !!asset && matchesSocialTarget(interaction, asset), pose: asset?.category === 'beds' ? 'lie' : null };
}

/** Opposite double-bed halves: quarter-footprint offsets along the placed asset's local X axis.
 * This intentionally stays simple: no occupancy registry, just stable player/NPC sides. */
export function pairedAssetPositions(
  center: [number, number], rotationDeg: number, footprint: [number, number],
): { player: [number, number]; npc: [number, number] } {
  const halfSeparation = Math.max(0, footprint[0]) / 4;
  const rad = rotationDeg * Math.PI / 180;
  const dx = Math.cos(rad) * halfSeparation;
  const dz = -Math.sin(rad) * halfSeparation;
  return {
    player: [center[0] - dx, center[1] - dz],
    npc: [center[0] + dx, center[1] + dz],
  };
}

/** Decision-only audio seam: the runtime maps start to AudioManager.startLoop and every terminal
 * path maps stop to stopLoop. Absent/blank sound is a no-op. */
export function socialSoundDecision(
  interaction: InteractionDef, phase: 'start' | 'stop',
): { startPath?: string; stop: boolean } {
  const sound = interaction.sound?.trim();
  return phase === 'start' && sound ? { startPath: sound, stop: false } : { stop: phase === 'stop' && !!sound };
}

/** NPC action adapter uses the same duration/censor/gain-free action shape as the player. */
export function socialNpcActionDef(interaction: InteractionDef): ActionDef {
  return { ...socialActionDef(interaction), animation: socialAnimationFor(interaction, 'npc'), sound: undefined };
}

/** Asset-shaped scoring descriptor: it carries no authored gain multiplier, so social actions feed
 * the exact same behavior score formula as ordinary candidates using their raw needGains. */
export function socialScoringTarget(npc: NpcDef): AssetDef {
  return {
    id: `npc:${npc.id}`,
    name: npc.name,
    category: 'sim',
    mesh: npc.mesh ?? '',
    buyPrice: 0,
    sellPrice: 0,
    environmentScore: 0,
    footprint: [0, 0],
    interactions: [],
    blocksNav: false,
    buyable: false,
  };
}

/** Pure autonomy generation. Presence, level gating, and authored eligibility are decided here;
 * the returned actions are subsequently ranked together with asset candidates by behavior.ts. */
export function socialAutonomyCandidates(
  visitor: NpcDef | null,
  relationships: RelationshipState,
  data: SocialData,
): { interaction: InteractionDef; action: ActionDef; target: AssetDef }[] {
  if (!visitor) return [];
  const target = socialScoringTarget(visitor);
  return availableSocialInteractions(visitor.id, relationships, data)
    .filter((interaction) => interaction.autonomyEligible === true)
    .map((interaction) => ({ interaction, action: socialActionDef(interaction), target }));
}

export interface SocialInteractionHooks {
  setNpcAutonomyPaused(paused: boolean): void;
  stopNpcAction(): void;
  applyPlayerNeed(needId: string, delta: number): void;
  adjustNpcMeter(delta: number): void;
  endVisit(completed: boolean): void;
}

export interface SocialInteractionOrder {
  npc: NpcDef;
  interaction: InteractionDef;
  action: ActionDef;
  compatibilityMultiplier: number;
}

/** Exactly one engagement at a time. begin() pauses the visitor before the player walks, while
 * finish(false) performs cleanup only. All authored effects are behind the completed branch. */
export class SocialInteractionSession {
  private order: SocialInteractionOrder | null = null;

  constructor(
    private relationships: RelationshipState,
    private getData: () => SocialData,
    private hooks: SocialInteractionHooks,
  ) {}

  get active(): Readonly<SocialInteractionOrder> | null { return this.order; }

  begin(npc: NpcDef, interaction: InteractionDef, playerPersonality: Record<string, number>): SocialInteractionOrder {
    if (this.order) this.finish(false);
    const data = this.getData();
    const order = {
      npc,
      interaction,
      action: socialActionDef(interaction),
      compatibilityMultiplier: compatibility(playerPersonality, npc.personality, data).multiplier,
    };
    this.order = order;
    this.hooks.setNpcAutonomyPaused(true);
    return order;
  }

  /** Returns true only for a real completion. Cleanup is unconditional and idempotent. */
  finish(completed: boolean): boolean {
    const order = this.order;
    if (!order) return false;
    this.order = null;
    try {
      if (!completed) return false;
      for (const [needId, delta] of Object.entries(order.interaction.needGains ?? {})) {
        if (Number.isFinite(delta)) this.hooks.applyPlayerNeed(needId, delta);
      }
      // The visitor owns one normalized social meter; mirror the authored social fill from the
      // player's fixed 0..100 need scale. Missing social is a safe no-op.
      const socialGain = order.interaction.needGains?.social;
      if (Number.isFinite(socialGain)) this.hooks.adjustNpcMeter(socialGain! / 100);
      this.relationships.applyGain(
        order.npc.id,
        finite(order.interaction.relationshipGain),
        order.compatibilityMultiplier,
      );
      if (order.interaction.special === 'endVisit') this.hooks.endVisit(true);
      return true;
    } finally {
      this.hooks.stopNpcAction();
      this.hooks.setNpcAutonomyPaused(false);
    }
  }
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
