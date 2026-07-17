// rental.test.ts — headless tests for game/rental.ts (ROADMAP_APT R2). Run: npx tsx test/rental.test.ts

import { DEFAULT_RENTAL_LABELS, listRentals } from '../game/rental';
import type { EvalContext } from '../game/quests';
import type { AssetsData, FinanceData, MapData } from '../game/data';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    needs: {},
    skills: {},
    funds: 500,
    creditScore: 650,
    time: { hour: 12, day: 10 },
    vars: { visaStatus: 'tourist', job: 'cashier', income: 200 },
    quests: { studio_intro: 'done' },
    ...overrides,
  };
}

const finance: FinanceData = {
  rent: { base: 100, perFloorTile: 5, byPropertyType: { condo: 20, basement: -10, townhouse: 50, house: 100, penthouse: 250 } },
  bills: [{ id: 'phone', name: 'Phone', base: 10, perAssetValue: 0.1 }],
  overdueDays: 3, tooLateDays: 7, negativeGraceDays: 2,
};

const assets: AssetsData = { categories: [], assets: [
  { id: 'chair', name: 'Chair', category: 'seat', mesh: '', buyPrice: 100, sellPrice: 50, environmentScore: 0, footprint: [1, 1], interactions: [] },
] };

function makeMap(overrides: Partial<MapData> = {}): MapData {
  return {
    id: 'studio', name: 'Studio', propertyType: 'condo', gridSize: 1, bounds: { w: 4, h: 3 },
    floors: [{ id: 'a', material: 'wood', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] }],
    walls: [], doors: [], spawn: { pos: [0.5, 0.5], facingDeg: 0 },
    placedObjects: [{ asset: 'chair', pos: [0.5, 0.5], rotDeg: 0 }],
    ...overrides,
  };
}

console.log('rental.test — unlisted / absent-rental exclusion');
{
  const noRental = makeMap({ id: 'no_rental' }); // no `rental` block at all
  const unlisted = makeMap({ id: 'unlisted', rental: { listed: false, adTitle: 'Hidden' } });
  const listed = makeMap({ id: 'listed', rental: { listed: true, adTitle: 'Cozy studio' } });
  const listings = listRentals({ maps: [noRental, unlisted, listed], evalContext: ctx(), finance, assets });
  check('map with no rental block is excluded', !listings.some((l) => l.mapId === 'no_rental'));
  check('rental.listed === false is excluded', !listings.some((l) => l.mapId === 'unlisted'));
  check('listed:true map is included', listings.some((l) => l.mapId === 'listed'));
  check('exactly one listing produced', listings.length === 1);
}

console.log('rental.test — availability gating drives through the real quest evaluator');
{
  const questGated = makeMap({
    id: 'quest_gated',
    rental: { listed: true, adTitle: 'Quest gated', availability: { var: 'quests.studio_intro.state', eq: 'done' } },
  });
  const availableCtx = ctx({ quests: { studio_intro: 'done' } });
  const lockedCtx = ctx({ quests: { studio_intro: 'active' } });
  const availableListing = listRentals({ maps: [questGated], evalContext: availableCtx, finance, assets })[0];
  const lockedListing = listRentals({ maps: [questGated], evalContext: lockedCtx, finance, assets })[0];
  check('quest done -> available', availableListing.available === true);
  check('quest not done -> unavailable', lockedListing.available === false);

  const simstateGated = makeMap({
    id: 'simstate_gated',
    rental: { listed: true, availability: { var: 'vars.income', gte: 300 } },
  });
  const lowIncome = listRentals({ maps: [simstateGated], evalContext: ctx({ vars: { visaStatus: 'tourist', job: 'cashier', income: 100 } }), finance, assets })[0];
  const highIncome = listRentals({ maps: [simstateGated], evalContext: ctx({ vars: { visaStatus: 'tourist', job: 'cashier', income: 400 } }), finance, assets })[0];
  check('simstate var gate: below threshold -> unavailable', lowIncome.available === false);
  check('simstate var gate: at/above threshold -> available', highIncome.available === true);

  const creditGated = makeMap({
    id: 'credit_gated',
    rental: { listed: true, availability: { var: 'creditScore', gte: 700 } },
  });
  const lowCredit = listRentals({ maps: [creditGated], evalContext: ctx({ creditScore: 600 }), finance, assets })[0];
  const highCredit = listRentals({ maps: [creditGated], evalContext: ctx({ creditScore: 750 }), finance, assets })[0];
  check('credit score gate: below -> unavailable', lowCredit.available === false);
  check('credit score gate: above -> available', highCredit.available === true);

  const visaGated = makeMap({
    id: 'visa_gated',
    rental: { listed: true, availability: { var: 'vars.visaStatus', eq: 'permanent_resident' } },
  });
  const wrongVisa = listRentals({ maps: [visaGated], evalContext: ctx({ vars: { visaStatus: 'tourist', job: null, income: 0 } }), finance, assets })[0];
  const rightVisa = listRentals({ maps: [visaGated], evalContext: ctx({ vars: { visaStatus: 'permanent_resident', job: null, income: 0 } }), finance, assets })[0];
  check('visa status gate: mismatch -> unavailable', wrongVisa.available === false);
  check('visa status gate: match -> available', rightVisa.available === true);

  const noCondition = makeMap({ id: 'no_condition', rental: { listed: true } });
  const listing = listRentals({ maps: [noCondition], evalContext: ctx(), finance, assets })[0];
  check('absent availability condition = always available', listing.available === true);

  const combinedGated = makeMap({
    id: 'combined_gated',
    rental: {
      listed: true,
      availability: { all: [{ var: 'creditScore', gte: 600 }, { var: 'vars.job', neq: null }] },
    },
  });
  const bothMet = listRentals({ maps: [combinedGated], evalContext: ctx({ creditScore: 650, vars: { visaStatus: 'tourist', job: 'cashier', income: 0 } }), finance, assets })[0];
  const oneMissing = listRentals({ maps: [combinedGated], evalContext: ctx({ creditScore: 650, vars: { visaStatus: 'tourist', job: null, income: 0 } }), finance, assets })[0];
  check('combined all[] condition: both met -> available', bothMet.available === true);
  check('combined all[] condition: one missing -> unavailable', oneMissing.available === false);
}

console.log('rental.test — price visibility rules');
{
  const gated = makeMap({
    id: 'priced_gated',
    rental: { listed: true, availability: { var: 'creditScore', gte: 700 } },
  });
  const unavailable = listRentals({ maps: [gated], evalContext: ctx({ creditScore: 500 }), finance, assets })[0];
  const available = listRentals({ maps: [gated], evalContext: ctx({ creditScore: 800 }), finance, assets })[0];
  check('price omitted when unavailable', unavailable.rentPrice === undefined);
  check('price present when available', typeof available.rentPrice === 'number');
  check('unavailable statusLabel uses the "not available" default', unavailable.statusLabel === DEFAULT_RENTAL_LABELS.notAvailable);
  check('available statusLabel uses the "available" default', available.statusLabel === DEFAULT_RENTAL_LABELS.available);

  const customLabels = listRentals({ maps: [gated], evalContext: ctx({ creditScore: 500 }), finance, assets, labels: { notAvailable: 'Coming soon' } })[0];
  check('label override is themeable per call, not hardcoded', customLabels.statusLabel === 'Coming soon');
}

console.log('rental.test — rent override vs formula fallback (never duplicates the finance formula)');
{
  const formulaMap = makeMap({ id: 'formula_rent', propertyType: 'condo', rental: { listed: true } });
  const listing = listRentals({ maps: [formulaMap], evalContext: ctx(), finance, assets })[0];
  // gridSize 1, bounds 4x3 -> 6 tiles inside the 2x2 floor polygon (matches bills.test.ts's countFloorTiles fixture logic)
  const expectedTiles = 4; // (0,0)-(2,2) polygon over a 1m grid covers 4 cell centers
  const expectedRent = finance.rent.base + finance.rent.perFloorTile * expectedTiles + finance.rent.byPropertyType.condo;
  check('rent falls back to computeFinancePreview (the real formula, not a duplicate)', listing.rentPrice === expectedRent, `${listing.rentPrice} vs ${expectedRent}`);

  const overrideMap = makeMap({ id: 'override_rent', rental: { listed: true, rentPriceOverride: 999 } });
  const overrideListing = listRentals({ maps: [overrideMap], evalContext: ctx(), finance, assets })[0];
  check('rentPriceOverride wins over the formula', overrideListing.rentPrice === 999);
}

console.log('rental.test — area m2 override vs computed fallback');
{
  const computedMap = makeMap({ id: 'computed_area', rental: { listed: true } }); // 2x2 polygon = 4 m2, no override
  const computedListing = listRentals({ maps: [computedMap], evalContext: ctx(), finance, assets, labels: {} })[0];
  check('areaM2 computed from floor polygons via floorsAreaM2 when no override', computedListing.areaM2 === 4, String(computedListing.areaM2));

  const overrideAreaMap = makeMap({ id: 'override_area', rental: { listed: true, areaM2Override: 55.5 } });
  const overrideAreaListing = listRentals({ maps: [overrideAreaMap], evalContext: ctx(), finance, assets })[0];
  check('areaM2Override wins over the computed value', overrideAreaListing.areaM2 === 55.5);
}

console.log('rental.test — current-home flag');
{
  const home = makeMap({ id: 'home_map', rental: { listed: true } });
  const other = makeMap({ id: 'other_map', rental: { listed: true } });
  const listings = listRentals({ maps: [home, other], evalContext: ctx(), finance, assets, homeMapId: 'home_map' });
  check('home map flagged isCurrentHome', listings.find((l) => l.mapId === 'home_map')?.isCurrentHome === true);
  check('non-home map not flagged', listings.find((l) => l.mapId === 'other_map')?.isCurrentHome === false);

  const noHomeGiven = listRentals({ maps: [home, other], evalContext: ctx(), finance, assets })[0];
  check('no homeMapId input -> nothing flagged', noHomeGiven.isCurrentHome === false);
}

console.log('rental.test — ad copy + moveInHours pass-through');
{
  const fullAd = makeMap({
    id: 'full_ad',
    rental: {
      listed: true, adTitle: 'Cozy studio near the docks', adText: 'Great view.', adImage: 'ads/studio.jpg',
      moveInHours: 48,
    },
  });
  const listing = listRentals({ maps: [fullAd], evalContext: ctx(), finance, assets })[0];
  check('title passes through', listing.title === 'Cozy studio near the docks');
  check('text passes through', listing.text === 'Great view.');
  check('image passes through', listing.image === 'ads/studio.jpg');
  check('moveInHours passes through', listing.moveInHours === 48);

  const sparseAd = makeMap({ id: 'sparse_ad', rental: { listed: true } });
  const sparseListing = listRentals({ maps: [sparseAd], evalContext: ctx(), finance, assets })[0];
  check('absent adTitle/adText default to empty string', sparseListing.title === '' && sparseListing.text === '');
  check('absent adImage stays undefined', sparseListing.image === undefined);
  check('absent moveInHours defaults to 0', sparseListing.moveInHours === 0);
}

console.log(failures === 0 ? 'rental.test — ALL PASSED' : `rental.test — ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
