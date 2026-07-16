import { FoodRegistry, foodAssetForActionEvent } from '../game/food';

let passed = 0;
function check(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
}

console.log('food.test — spawn timing');
check('eat spawns snack at action start', foodAssetForActionEvent('eat', 'start') === 'snack');
check('eat does not spawn again on completion', foodAssetForActionEvent('eat', 'completion') === null);
check('cook does not spawn before completion', foodAssetForActionEvent('cook', 'start') === null);
check('cook completion spawns meal', foodAssetForActionEvent('cook', 'completion') === 'meal');

console.log('food.test — carry, interrupt, perish');
const food = new FoodRegistry();
food.startCarrying('snack#1', 'snack', { hungerGain: 18, perishHours: 3 }, [2, 4]);
check('new food is actively carried', food.active?.phase === 'carried');
const dropped = food.interruptActive([6, 7], 10);
check('interrupt drops at exact sim position', dropped?.phase === 'dropped' && dropped.pos[0] === 6 && dropped.pos[1] === 7);
check('interrupt clears active carry', food.active === null);
check('food survives before perish boundary', food.tick(12.99).length === 0 && food.all.length === 1);
check('food perishes at configured in-game-hour boundary', food.tick(13)[0] === 'snack#1' && food.all.length === 0);

console.log('food.test — completion-only hunger');
food.startCarrying('meal#1', 'meal', { hungerGain: 45, perishHours: 5 }, [1, 1]);
check('cannot grant hunger before eating begins', food.completeEating('meal#1', 20) === null);
check('begin eating succeeds from carried phase', food.beginEating('meal#1'));
const eaten = food.completeEating('meal#1', 70);
check('eat completion grants configured hunger with clamp', eaten?.hunger === 100 && eaten.gain === 30);
check('consumed meal is removed', food.all.length === 0 && food.active === null);

food.startCarrying('snack#2', 'snack', { hungerGain: 18, perishHours: 3 }, [0, 0]);
food.beginEating('snack#2');
food.interruptActive([9, 9], 20);
check('interrupted eating grants no hunger', food.completeEating('snack#2', 25) === null);

console.log(`food.test: ${passed} passed`);
