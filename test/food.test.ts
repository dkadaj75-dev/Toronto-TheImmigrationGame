import { FoodRegistry, foodAssetForActionEvent, actionSpawnsCarriedFood, defersSeatToSecondLeg, firstLegSeatAware, actionAfterSourceFetch, cookedMealHungerGain, resolveFoodConfig, wasteAssetForDroppedFood } from '../game/food';

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

const partial = new FoodRegistry();
partial.startCarrying('meal#partial', 'meal', { hungerGain: 40, perishHours: 4, rottenAssetId: 'rotten_food' }, [0, 0]);
partial.beginEating('meal#partial');
const half = partial.interruptActiveWithProgress([2, 3], 10, 0.5);
check('half-eaten interruption reports the consumed half', half?.consumedGain === 20);
check('half-eaten interruption preserves half the hunger on the same item', half?.item.hungerGain === 20 && half.item.phase === 'dropped');
check('dropped food can be selected and eaten again', partial.activateDropped('meal#partial')?.key === 'meal#partial' && partial.beginEating('meal#partial'));
partial.interruptActiveWithProgress([2, 3], 10, -1);
const perished = partial.tickDetailed(14);
check('perishing reports authored rotten replacement and position', perished[0]?.rottenAssetId === 'rotten_food' && perished[0].pos[0] === 2);

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

console.log('food.test — item 2 meal tiers: action-family spawn mapping');
// The designer authors cook_light_meal / cook_large_meal (both cook-family) — they must all spawn
// the same `meal` transient without any per-action code change; eat-family variants spawn `snack`.
check('cook_light_meal completion spawns a meal (cook family)', foodAssetForActionEvent('cook_light_meal', 'completion') === 'meal');
check('cook_large_meal completion spawns a meal (cook family)', foodAssetForActionEvent('cook_large_meal', 'completion') === 'meal');
check('eat_leftovers arrival spawns a snack (eat family)', foodAssetForActionEvent('eat_leftovers', 'arrival') === 'snack');
check('a cook variant does not spawn on arrival', foodAssetForActionEvent('cook_large_meal', 'arrival') === null);
check('family match needs the base_ prefix, not a substring', foodAssetForActionEvent('cooktop_scrub', 'completion') === null);
check('cook variants are carried-food source actions', actionSpawnsCarriedFood('cook_large_meal') === true);
check('cook variant first leg walks to the stove, not a seat', firstLegSeatAware({ id: 'cook_large_meal', seatAware: true }) === false);

console.log('food.test — item 2 meal tiers: sparse action food override + skill scaling on both paths');
const assetMeal = { hungerGain: 45, perishHours: 6 };
check('absent override falls back to the asset default', resolveFoodConfig(assetMeal, undefined).hungerGain === 45 && resolveFoodConfig(assetMeal).perishHours === 6);
const lightCfg = resolveFoodConfig(assetMeal, { hungerGain: 12 });
check('override hungerGain wins over the asset default', lightCfg.hungerGain === 12);
check('an unset override field falls back to the asset default', lightCfg.perishHours === 6);
const largeCfg = resolveFoodConfig(assetMeal, { hungerGain: 60, perishHours: 8 });
check('an override replaces both fields when both are set', largeCfg.hungerGain === 60 && largeCfg.perishHours === 8);
// B7-2 cooking-skill proportionality applies ON TOP of whichever base (default OR override) is used.
const ct2 = { cookHungerAtSkill0: 0.6, cookHungerAtSkillMax: 1.5 };
check('skill scaling applies to the asset-default base (45 * 0.6 = 27)',
  Math.abs(cookedMealHungerGain(resolveFoodConfig(assetMeal).hungerGain, 0, 100, ct2) - 27) < 1e-9);
check('skill scaling applies to the action-override base (12 * 1.5 = 18)',
  Math.abs(cookedMealHungerGain(lightCfg.hungerGain, 100, 100, ct2) - 18) < 1e-9);

console.log('food.test — legacy waste compatibility and resumable dropped food');
const foodW = new FoodRegistry();
const carried = foodW.startCarrying('snack#w', 'snack', { hungerGain: 18, perishHours: 3 }, [1, 2], 'dirty_dishes');
check('carried food records the waste asset it becomes when abandoned', carried.wasteAssetId === 'dirty_dishes');
check('wasteAssetForDroppedFood returns the recorded clearable waste asset', wasteAssetForDroppedFood(carried) === 'dirty_dishes');
check('a food item with no recorded waste yields null (older items / test doubles)', wasteAssetForDroppedFood({}) === null);
const droppedW = foodW.interruptActive([3, 3], 5);
check('interrupt still reports the drop position for the waste spawn', droppedW?.pos[0] === 3 && droppedW.pos[1] === 3);
check('discard removes the item so tick can never silently self-despawn it',
  foodW.discard('snack#w') === true && foodW.all.length === 0 && foodW.tick(999).length === 0);
check('discarding an unknown key is a no-op', foodW.discard('nope') === false);

const pickedUp = new FoodRegistry();
pickedUp.startCarrying('meal#pickup', 'meal', { hungerGain: 20, perishHours: 4 }, [0, 0]);
pickedUp.interruptActive([1, 2], 8);
check('a dropped spawned food can be picked up for a later automatic action',
  pickedUp.beginCarrying('meal#pickup')?.phase === 'carried' && pickedUp.active?.key === 'meal#pickup');

console.log(`food.test: ${passed} passed`);
