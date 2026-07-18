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
    animation: interaction.animation ?? '',
    autonomyEligible: interaction.autonomyEligible === true,
    primaryNeed: null,
    censor: interaction.censor === true,
    duration: { baseSeconds: Math.max(0, finite(interaction.durationSeconds)) },
  };
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
