import assert from 'node:assert/strict';
import { NotificationCenter, relativeAge, type NotificationsData } from '../game/notifications';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`  ok  ${name}`); }

const data: NotificationsData = {
  tiers: {
    modal: { pausesGame: true, requiresOk: true },
    card: { autoExpireSeconds: 20, sound: 'notification' },
    passive: { autoExpireSeconds: 8 },
  },
  stackCap: 2,
  events: {
    questReceived: { tier: 'modal', icon: 'quest.svg', sound: 'questStarted' },
    visitorArrived: { tier: 'card', action: { type: 'phoneTab', tab: 'contacts', label: 'Contacts' } },
    chatter: { tier: 'passive' },
  },
};

console.log('notifications.test');
check('resolves authored tier and attaches tier config', () => {
  const item = new NotificationCenter(data).post('questReceived', { title: 'Quest' }, 1000);
  assert.equal(item.tier, 'modal'); assert.equal(item.tierConfig.pausesGame, true); assert.equal(item.sound, 'questStarted');
});
check('unmapped ids safely resolve to passive', () => {
  assert.equal(new NotificationCenter(data).post('newEvent', { title: 'New' }, 0).tier, 'passive');
});
check('modal FIFO keeps one current and promotes on acknowledge', () => {
  const center = new NotificationCenter(data);
  const first = center.post('questReceived', { title: 'One' }, 0);
  const second = center.post('questReceived', { title: 'Two' }, 1);
  assert.equal(center.currentModal?.id, first.id);
  assert.deepEqual(center.pendingModals.map((item) => item.id), [second.id]);
  assert.equal(center.acknowledgeModal()?.id, second.id);
  assert.equal(center.pendingModals.length, 0);
  assert.equal(center.acknowledgeModal(), null);
});
check('card/passive stack cap evicts the oldest', () => {
  const center = new NotificationCenter(data);
  const oldest = center.post('visitorArrived', { title: 'Old' }, 0);
  const middle = center.post('chatter', { title: 'Middle' }, 1);
  const newest = center.post('visitorArrived', { title: 'New' }, 2);
  assert.deepEqual(center.stack.map((item) => item.id), [middle.id, newest.id]);
  assert.ok(!center.stack.some((item) => item.id === oldest.id));
});
check('real-time expiry honors each tier timeout', () => {
  const center = new NotificationCenter(data);
  const card = center.post('visitorArrived', { title: 'Card' }, 1000);
  const passive = center.post('chatter', { title: 'Passive' }, 1000);
  center.expireTick(8999); assert.deepEqual(center.stack.map((item) => item.id), [card.id, passive.id]);
  center.expireTick(9000); assert.deepEqual(center.stack.map((item) => item.id), [card.id]);
  center.expireTick(21000); assert.equal(center.stack.length, 0);
});
check('relative age exposes now/minute/hour bucket inputs without strings', () => {
  const item = new NotificationCenter(data).post('chatter', { title: 'Age' }, 1000);
  assert.deepEqual(relativeAge(item, 60_999), { minutes: 0 });
  assert.deepEqual(relativeAge(item, 6 * 60_000 + 1000), { minutes: 6 });
  assert.deepEqual(relativeAge(item, 2 * 60 * 60_000 + 1000), { minutes: 120 });
});
check('action definition and caller payload pass through unchanged', () => {
  const payload = { npcId: 'alex', source: 7 };
  const item = new NotificationCenter(data).post('visitorArrived', { title: 'Alex arrived', actionPayload: payload }, 0);
  assert.equal(item.action?.type, 'phoneTab'); assert.equal(item.actionPayload, payload);
});

console.log(`notifications.test: ${checks} checks passed`);
