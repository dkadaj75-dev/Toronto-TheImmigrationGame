// Pure SOCIAL S5 Contacts-tab decisions and phone-action coordination.
// DOM rendering stays in ui.ts; the runtime supplies the one shared SocialRuntime stores.

import type { ActionDef, AssetDef, BehaviorData } from './data';
import { isNpcAvailable, type NpcDef } from './npc';
import { evaluate, type EvalContext } from './quests';
import {
  compatibility,
  levelFor,
  type PhoneChannel,
  type PhoneState,
  type RelationshipState,
  type SocialData,
} from './social';
import { visitGate, visitGateReasonLabel } from './visit';

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export interface ContactChannelView {
  ready: boolean;
  remainingCooldownMinutes: number;
  enabled: boolean;
  disabledReason: string | null;
  active: boolean;
}

export interface ContactView {
  npcId: string;
  name: string;
  portrait: string;
  levelId: string | null;
  levelLabel: string;
  score: number;
  scoreFraction: number;
  inviteEnabled: boolean;
  inviteDisabledReason: string | null;
  visitEnabled: boolean;
  visitDisabledReason: string | null;
  text: ContactChannelView;
  call: ContactChannelView;
}

export interface ContactListContext {
  relationships: RelationshipState;
  phone: PhoneState;
  data: SocialData;
  nowMinutes: number;
  hourNow: number;
  canInvite: boolean;
  activeAction: { npcId: string; channel: PhoneChannel } | null;
  /** SOCIAL S6: true while the player sim is already away (at work or already visiting someone) —
   *  gates the new "Visit" action the same way `canInvite` gates "Invite". */
  playerAway: boolean;
}

export function formatCooldown(minutes: number): string {
  const total = Math.max(0, minutes);
  if (total > 0 && total < 1) return '<1m';
  const whole = Math.ceil(total);
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  return hours > 0 ? `${hours}h ${String(mins).padStart(2, '0')}m` : `${mins}m`;
}

export function relationshipLevelLabel(levelId: string | null): string {
  if (!levelId) return 'Unknown';
  return levelId.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function channelView(npc: NpcDef, channel: PhoneChannel, ctx: ContactListContext): ContactChannelView {
  const remaining = ctx.phone.remainingCooldown(npc.id, channel, ctx.nowMinutes);
  const ready = remaining <= 0;
  const available = isNpcAvailable(ctx.hourNow, npc.availableHours);
  const active = ctx.activeAction?.npcId === npc.id && ctx.activeAction.channel === channel;
  const busy = ctx.activeAction !== null;
  const enabled = available && ready && !busy;
  let disabledReason: string | null = null;
  if (!enabled) {
    if (!available) disabledReason = 'Outside available hours';
    else if (active) disabledReason = 'In progress';
    else if (busy) disabledReason = 'Another phone action is in progress';
    else disabledReason = `Ready in ${formatCooldown(remaining)}`;
  }
  return { ready, remainingCooldownMinutes: remaining, enabled, disabledReason, active };
}

/** One row per authored NPC; scores/cooldowns are read from the shared runtime stores. */
export function contactViews(npcs: readonly NpcDef[], ctx: ContactListContext): ContactView[] {
  const { min, max } = ctx.data.relationship;
  const span = max - min;
  return npcs.map((npc) => {
    const score = ctx.relationships.get(npc.id);
    const levelId = levelFor(score, ctx.data);
    const available = isNpcAvailable(ctx.hourNow, npc.availableHours);
    const inviteEnabled = available && ctx.canInvite;
    // SOCIAL S6: same gate the accept handler re-checks (visitGate), so the disabled reason shown
    // here can never disagree with what actually happens on click.
    const visitReason = visitGate(npc, {
      hourNow: ctx.hourNow,
      relationships: ctx.relationships,
      data: ctx.data,
      visitorBusy: !ctx.canInvite,
      playerAway: ctx.playerAway,
    });
    return {
      npcId: npc.id,
      name: npc.name,
      portrait: npc.portrait ?? '',
      levelId,
      levelLabel: relationshipLevelLabel(levelId),
      score,
      scoreFraction: span > 0 ? clamp((score - min) / span, 0, 1) : 0,
      inviteEnabled,
      inviteDisabledReason: inviteEnabled
        ? null
        : available ? 'Visitor already present' : 'Outside available hours',
      visitEnabled: visitReason === null,
      visitDisabledReason: visitReason ? visitGateReasonLabel(visitReason) : null,
      text: channelView(npc, 'text', ctx),
      call: channelView(npc, 'call', ctx),
    };
  });
}

export interface PhoneContactOrder {
  npc: NpcDef;
  channel: PhoneChannel;
  action: ActionDef;
  compatibilityMultiplier: number;
}

export interface PhoneContactHooks {
  applyPlayerNeed(needId: string, delta: number): void;
}

/** Adapts social.json phone definitions to the ordinary duration/stopAction pipeline. */
export class PhoneContactSession {
  private order: PhoneContactOrder | null = null;

  constructor(
    private relationships: RelationshipState,
    private phone: PhoneState,
    private getData: () => SocialData,
    private hooks: PhoneContactHooks,
  ) {}

  get active(): Readonly<PhoneContactOrder> | null { return this.order; }

  begin(
    npc: NpcDef,
    channel: PhoneChannel,
    playerPersonality: Record<string, number>,
    hourNow: number,
    nowMinutes: number,
  ): PhoneContactOrder | null {
    if (this.order || !isNpcAvailable(hourNow, npc.availableHours)
      || !this.phone.isReady(npc.id, channel, nowMinutes)) return null;
    const data = this.getData();
    const def = data.phone[channel];
    this.order = {
      npc,
      channel,
      compatibilityMultiplier: compatibility(playerPersonality, npc.personality, data).multiplier,
      action: {
        id: `phone_${channel}`,
        name: `${channel === 'text' ? 'Texting' : 'Calling'} ${npc.name}`,
        needGains: {},
        skillGains: {},
        animation: '',
        autonomyEligible: true,
        primaryNeed: null,
        censor: false,
        duration: { baseSeconds: Math.max(0, Number.isFinite(def.durationSeconds) ? def.durationSeconds : 0) },
      },
    };
    return this.order;
  }

  /** Effects and cooldown are behind the completed branch; cancel only clears the session. */
  finish(completed: boolean, nowMinutes: number): boolean {
    const order = this.order;
    if (!order) return false;
    this.order = null;
    if (!completed) return false;
    const def = this.getData().phone[order.channel];
    for (const [needId, delta] of Object.entries(def.needGains ?? {})) {
      if (Number.isFinite(delta)) this.hooks.applyPlayerNeed(needId, delta);
    }
    this.relationships.applyGain(order.npc.id, def.relationshipGain, order.compatibilityMultiplier);
    this.phone.markUsed(order.npc.id, order.channel, nowMinutes);
    return true;
  }
}

export type PhoneAutonomyKind = PhoneChannel | 'invite';
export interface PhoneAutonomyCandidate {
  npcId: string;
  kind: PhoneAutonomyKind;
  action: ActionDef;
  target: AssetDef;
}

function autonomyAction(kind: PhoneAutonomyKind): ActionDef {
  return {
    id: `phone_${kind}`,
    name: kind === 'invite' ? 'Invite Home' : kind === 'call' ? 'Call' : 'Text',
    needGains: {},
    skillGains: {},
    animation: '',
    autonomyEligible: true,
    primaryNeed: null,
    censor: false,
    duration: { baseSeconds: 0 },
  };
}

function scoringTarget(npc: NpcDef): AssetDef {
  return {
    id: `phone:${npc.id}`, name: npc.name, category: 'phone', mesh: '',
    buyPrice: 0, sellPrice: 0, environmentScore: 0, footprint: [0, 0],
    interactions: [], blocksNav: false, buyable: false,
  };
}

function hasEnabledRule(action: ActionDef, target: AssetDef, behavior: BehaviorData, ctx: EvalContext): boolean {
  return behavior.rules.some((rule) => rule.enabled !== false
    // Phone autonomy is explicit opt-in: unrelated wildcard rules must not accidentally enable it.
    && rule.action === action.id
    && (!rule.assetId || rule.assetId === target.id)
    && (!rule.assetCategory || rule.assetCategory === target.category)
    && (!rule.conditions || evaluate(rule.conditions, ctx)));
}

export interface PhoneAutonomyContext {
  phone: PhoneState;
  data: SocialData;
  behavior?: BehaviorData;
  eval: EvalContext;
  nowMinutes: number;
  hourNow: number;
  visitorBusy: boolean;
  canInvite: boolean;
  actionBusy: boolean;
}

/**
 * Produces only rule-opted-in candidates while social phone use is possible. The existing
 * Autonomy -> behavior.pickBest path remains authoritative for score/threshold/competition.
 */
export function phoneAutonomyCandidates(
  npcs: readonly NpcDef[],
  ctx: PhoneAutonomyContext,
): PhoneAutonomyCandidate[] {
  if (!ctx.behavior || ctx.visitorBusy || ctx.actionBusy) return [];
  const result: PhoneAutonomyCandidate[] = [];
  for (const npc of npcs) {
    if (!isNpcAvailable(ctx.hourNow, npc.availableHours)) continue;
    const target = scoringTarget(npc);
    const kinds: PhoneAutonomyKind[] = ctx.canInvite ? ['invite', 'text', 'call'] : ['text', 'call'];
    for (const kind of kinds) {
      if (kind !== 'invite' && !ctx.phone.isReady(npc.id, kind, ctx.nowMinutes)) continue;
      const action = autonomyAction(kind);
      if (hasEnabledRule(action, target, ctx.behavior, ctx.eval)) {
        result.push({ npcId: npc.id, kind, action, target });
      }
    }
  }
  return result;
}
