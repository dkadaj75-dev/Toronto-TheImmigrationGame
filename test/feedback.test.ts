import { formatMoneyChange, formatSkillUp, skillLevelUps } from '../game/feedback';
import { initEnergyCollapseState, StarvationTracker, tickEnergyCollapse } from '../game/survival';

let passed = 0;
function check(name: string, ok: boolean) { if (!ok) throw new Error(`FAIL: ${name}`); console.log(`PASS: ${name}`); passed++; }

check('fractional skill gain within one level is silent', skillLevelUps({ english: 1.1 }, { english: 1.9 }).length === 0);
check('integer boundary crossing reports levels gained', skillLevelUps({ english: 1.9 }, { english: 3.1 })[0]?.levels === 2);
check('skill message is named and signed', formatSkillUp('English', 1) === 'English: +1!');
check('money gain formatting', formatMoneyChange(120, '§') === '+§120');
check('money spend formatting', formatMoneyChange(-40, '§') === '-§40');

const energy = initEnergyCollapseState();
check('energy zero starts collapse once', tickEnergyCollapse(energy, 0, 0, { collapseSeconds: 2, sleepSeconds: 20 }) === 'collapse');
check('collapse transitions to ground sleep', tickEnergyCollapse(energy, 2, 0, { collapseSeconds: 2, sleepSeconds: 20 }) === 'sleep');
check('sleep completion rearms latch', tickEnergyCollapse(energy, 20, 0, { collapseSeconds: 2, sleepSeconds: 20 }) === 'complete' && energy.armed);

const starvation = new StarvationTracker();
const scfg = { countdownSeconds: 120, collapseSeconds: 4, recoveryThreshold: 0 };
check('hunger zero begins warning countdown', starvation.tick(0, 0, scfg) === 'warning');
const saved = starvation.serialize();
const restored = new StarvationTracker(); restored.restore(saved);
check('starvation state serializes and restores', restored.state.phase === 'countdown');
check('eating cancels countdown', restored.tick(1, 10, scfg) === 'cancelled');
starvation.tick(120, 0, scfg);
check('countdown expiry starts collapse', starvation.state.phase === 'collapse');
check('collapse expiry produces game over', starvation.tick(4, 0, scfg) === 'gameOver');

console.log(`\n${passed} feedback/survival tests passed.`);
