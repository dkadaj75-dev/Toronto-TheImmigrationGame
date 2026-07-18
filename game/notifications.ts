// Pure notification queue/stack state. Rendering, sounds, actions and pause wiring belong to G2.

export type NotificationTier = 'modal' | 'card' | 'passive';

export interface NotificationTierConfig {
  pausesGame?: boolean;
  requiresOk?: boolean;
  autoExpireSeconds?: number;
  sound?: string;
}

export interface NotificationAction {
  type: string;
  label: string;
  [key: string]: unknown;
}

export interface NotificationEventConfig {
  tier: NotificationTier;
  icon?: string;
  sound?: string;
  action?: NotificationAction;
}

export interface NotificationsData {
  tiers: Record<NotificationTier, NotificationTierConfig>;
  stackCap: number;
  events: Record<string, NotificationEventConfig>;
}

export interface NotificationContent<TActionPayload = unknown> {
  title: string;
  body?: string;
  actionPayload?: TActionPayload;
}

export interface ResolvedNotification<TActionPayload = unknown> extends NotificationContent<TActionPayload> {
  id: string;
  eventId: string;
  tier: NotificationTier;
  tierConfig: NotificationTierConfig;
  icon?: string;
  sound?: string;
  action?: NotificationAction;
  createdAtRealMs: number;
}

/**
 * Notifications are deliberately transient and have no serialize/restore surface. A save/load or
 * reload starts with an empty notification center; durable facts remain owned by their source
 * systems (quests, bills, work, etc.) and can be rendered from those systems where appropriate.
 *
 * Expiry and age use caller-supplied REAL time. They only control cosmetic presentation, matching
 * familiar Sims-style "minutes ago" cards, so they are intentionally exempt from the rule that
 * gameplay timers advance on simulation time.
 */
export class NotificationCenter {
  currentModal: ResolvedNotification | null = null;
  readonly pendingModals: ResolvedNotification[] = [];
  readonly stack: ResolvedNotification[] = [];
  private sequence = 0;

  constructor(private readonly data: NotificationsData) {}

  post<TActionPayload>(eventId: string, content: NotificationContent<TActionPayload>, nowRealMs: number): ResolvedNotification<TActionPayload> {
    const event = this.data.events[eventId];
    const tier = isTier(event?.tier) ? event.tier : 'passive';
    const tierConfig = this.data.tiers[tier] ?? this.data.tiers.passive ?? {};
    const inheritedSound = event?.sound ?? tierConfig.sound;
    const notification: ResolvedNotification<TActionPayload> = {
      id: `notification-${++this.sequence}`,
      eventId,
      tier,
      tierConfig,
      title: content.title,
      createdAtRealMs: finiteOr(nowRealMs, 0),
      ...(content.body === undefined ? {} : { body: content.body }),
      ...(content.actionPayload === undefined ? {} : { actionPayload: content.actionPayload }),
      ...(event?.icon === undefined ? {} : { icon: event.icon }),
      ...(event?.action === undefined ? {} : { action: event.action }),
      ...(inheritedSound === undefined ? {} : { sound: inheritedSound }),
    };

    if (tier === 'modal') {
      if (this.currentModal) this.pendingModals.push(notification);
      else this.currentModal = notification;
    } else {
      this.stack.push(notification);
      const cap = Math.max(0, Math.floor(finiteOr(this.data.stackCap, 0)));
      if (this.stack.length > cap) this.stack.splice(0, this.stack.length - cap);
    }
    return notification;
  }

  dismiss(id: string): void {
    if (this.currentModal?.id === id) {
      this.acknowledgeModal();
      return;
    }
    const pendingIndex = this.pendingModals.findIndex((item) => item.id === id);
    if (pendingIndex >= 0) {
      this.pendingModals.splice(pendingIndex, 1);
      return;
    }
    const stackIndex = this.stack.findIndex((item) => item.id === id);
    if (stackIndex >= 0) this.stack.splice(stackIndex, 1);
  }

  /** Acknowledge the visible modal and immediately promote the next FIFO item, if any. */
  acknowledgeModal(): ResolvedNotification | null {
    if (!this.currentModal) return null;
    this.currentModal = this.pendingModals.shift() ?? null;
    return this.currentModal;
  }

  expireTick(nowRealMs: number): void {
    const now = finiteOr(nowRealMs, 0);
    for (let index = this.stack.length - 1; index >= 0; index--) {
      const item = this.stack[index];
      const seconds = item.tierConfig.autoExpireSeconds;
      if (Number.isFinite(seconds) && seconds! >= 0 && now - item.createdAtRealMs >= seconds! * 1000) {
        this.stack.splice(index, 1);
      }
    }
  }
}

/**
 * Whole elapsed real minutes. UI maps 0 to "Just now", 1..59 to minutes, and 60+ to
 * `Math.floor(minutes / 60)` hours, keeping localized strings out of this pure core.
 */
export function relativeAge(notification: Pick<ResolvedNotification, 'createdAtRealMs'>, nowRealMs: number): { minutes: number } {
  const elapsedMs = Math.max(0, finiteOr(nowRealMs, 0) - finiteOr(notification.createdAtRealMs, 0));
  return { minutes: Math.floor(elapsedMs / 60_000) };
}

function isTier(value: unknown): value is NotificationTier {
  return value === 'modal' || value === 'card' || value === 'passive';
}
function finiteOr(value: number, fallback: number): number { return Number.isFinite(value) ? value : fallback; }
