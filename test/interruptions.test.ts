import assert from 'node:assert/strict';
import { PauseStack } from '../game/interruptions';

let checks = 0;
function check(name: string, run: () => void): void { run(); checks++; console.log(`  ok  ${name}`); }

console.log('interruptions.test');
check('nested phone + modal restores only after the last pop', () => {
  const stack = new PauseStack(); stack.rememberSpeed(2);
  const phone = stack.push('phone'); const modal = stack.push('notification:modal');
  stack.pop(modal); assert.equal(stack.isPaused(), true); assert.equal(stack.speedToRestore(), null);
  stack.pop(phone); assert.equal(stack.isPaused(), false); assert.equal(stack.speedToRestore(), 2); assert.equal(stack.speedToRestore(), null);
});
check('player-selected 2x is remembered rather than a hardcoded 1x', () => {
  const stack = new PauseStack(); stack.rememberSpeed(2); const token = stack.push('system-menu'); stack.pop(token);
  assert.equal(stack.speedToRestore(), 2);
});
check('double-pop and unknown tokens are harmless', () => {
  const stack = new PauseStack(); const token = stack.push('phone'); stack.pop(token); stack.pop(token); stack.pop({ id: 999 });
  assert.equal(stack.isPaused(), false); assert.equal(stack.speedToRestore(), 1); assert.equal(stack.speedToRestore(), null);
});
check('pausedBy lists independent reasons in push order', () => {
  const stack = new PauseStack(); const phone = stack.push('phone'); const modal = stack.push('notification:modal');
  assert.deepEqual(stack.pausedBy(), ['phone', 'notification:modal']);
  stack.pop(phone); assert.deepEqual(stack.pausedBy(), ['notification:modal']);
  stack.pop(modal); assert.deepEqual(stack.pausedBy(), []);
});
check('speed changes attempted during interruption do not replace the snapshot', () => {
  const stack = new PauseStack(); stack.rememberSpeed(3); const token = stack.push('phone'); stack.rememberSpeed(1); stack.pop(token);
  assert.equal(stack.speedToRestore(), 3);
});

console.log(`interruptions.test: ${checks} checks passed`);
