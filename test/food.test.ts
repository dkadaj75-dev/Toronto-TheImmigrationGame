import { FoodRegistry, foodAssetForActionEvent, actionSpawnsCarriedFood, defersSeatToSecondLeg, firstLegSeatAware, actionAfterSourceFetch, cookedMealHungerGain } from '../game/food';

let passed = 0;
function check(name: string, ok: boolean) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  passed++;
}

console.log('food.test — spawn timing');
check('eat spawns snack only on source-asset arrival', foodAssetForActionEvent('eat', 'arrival') === 'snack');
check('eat does not spawn again on completion', foodAssetForActionEvent('eat', 'completion') === null);
check('cook does not spawn on source-asset arrival', foodAssetForActionEvent('cook', 'arrival') === null);
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

console.log('food.test — B7-4 two-leg order decision (walk to fridge BEFORE carrying to a seat)');
// The regression: `eat` is seatAware, so the old order sites resolved a seat up front and routed the
// sim straight to a chair near the fridge — skipping the fridge, spawning the snack at the seat.
check('eat is a carried-food source action', actionSpawnsCarriedFood('eat') === true);
check('cook is a carried-food source action', actionSpawnsCarriedFood('cook') === true);
check('non-food actions do not carry food', actionSpawnsCarriedFood('watch_tv') === false && actionSpawnsCarriedFood('sit') === false);
// The two-leg decision: a food-source action's FIRST leg is NOT seat-aware even though the action is
// seatAware — the seat is chosen only for the carry/eat second leg. This is what stops the fridge skip.
check('fridge Eat first leg walks to the source, not a seat', firstLegSeatAware({ id: 'eat', seatAware: true }) === false);
check('stove Cook first leg walks to the source, not a seat', firstLegSeatAware({ id: 'cook', seatAware: true }) === false);
// Ordinary seat-aware actions still sit in front of their target on the first (only) leg.
check('watch TV first leg stays seat-aware', firstLegSeatAware({ id: 'watch_tv', seatAware: true }) === true);
check('sit first leg stays seat-aware', firstLegSeatAware({ id: 'sit', seatAware: true }) === true);
check('a non-seat-aware action never becomes seat-aware', firstLegSeatAware({ id: 'shower', seatAware: false }) === false);

console.log('food.test — B10-6 generic source-first seated actions');
const readBook = { id: 'read_book', seatAware: true, fetchBeforeSeat: true, faceTarget: false };
check('data-driven fetch action defers its seat like carried food', defersSeatToSecondLeg(readBook));
check('read_book first leg walks to its bookshelf source', firstLegSeatAware(readBook) === false);
const fetchedReadBook = actionAfterSourceFetch(readBook);
check('post-fetch clone clears only the recursion flag', !('fetchBeforeSeat' in fetchedReadBook)
  && fetchedReadBook.id === 'read_book' && fetchedReadBook.seatAware === true && fetchedReadBook.faceTarget === false);
check('post-fetch read_book leg is seat-aware', firstLegSeatAware(fetchedReadBook) === true);

console.log('food.test — B7-2 cooked-meal hunger scales with cooking skill');
const ct = { cookHungerAtSkill0: 0.6, cookHungerAtSkillMax: 1.5 };
check('novice (skill 0) fills 60% of the base meal', Math.abs(cookedMealHungerGain(45, 0, 100, ct) - 27) < 1e-9);
check('master (skill at max) fills 150% of the base meal', Math.abs(cookedMealHungerGain(45, 100, 100, ct) - 67.5) < 1e-9);
check('mid skill lerps linearly (skill 50/100 → factor 1.05)', Math.abs(cookedMealHungerGain(45, 50, 100, ct) - 45 * 1.05) < 1e-9);
check('skill above max clamps to the max factor', Math.abs(cookedMealHungerGain(45, 250, 100, ct) - 67.5) < 1e-9);
check('zero skillMax degrades to the skill-0 factor (no divide-by-zero)', Math.abs(cookedMealHungerGain(45, 5, 0, ct) - 27) < 1e-9);

console.log(`food.test: ${passed} passed`);
