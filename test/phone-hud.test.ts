// phone-hud.test.ts — ROADMAP_APT R3 jsdom smoke for the Kijiji rental tab's DOM rendering
// (game/ui.ts Hud.renderPhone). Runs under tsx (`npx tsx test/phone-hud.test.ts`) with a jsdom
// window so the real Hud builds its real DOM. Covers: tab label from tuning name, m2 shown on
// every ad, price only on available ads, the not-available chip, and the disabled Rent button +
// its hook seam. Pure card massaging lives in game/phone.ts (test/phone.test.ts covers it).

import { JSDOM } from 'jsdom';
import type { RentalCardView } from '../game/phone';
import type { SlotCardView } from '../game/saveslots';
import { PauseStack, type PauseToken } from '../game/interruptions';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
});
const { window } = dom;
const g = globalThis as unknown as Record<string, unknown>;
g.window = window;
g.document = window.document;
g.HTMLElement = window.HTMLElement;
g.HTMLButtonElement = window.HTMLButtonElement;
g.Node = window.Node;
g.Event = window.Event;
g.location = window.location;

const { Hud } = await import('../game/ui');
const { SimStats } = await import('../game/stats');

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

const stats = new SimStats({ needs: [], skills: [], personality: [] });
const hud = new Hud(stats);

const rentals: RentalCardView[] = [
  { mapId: 'available_apt', title: 'Sunny 1BR', text: 'Great light', image: 'ads/a.jpg', areaLabel: '45 m2', priceLabel: '§812', statusLabel: 'Available', isCurrentHome: false, rentEnabled: true },
  { mapId: 'gated_apt', title: 'Loft', text: 'Downtown', areaLabel: '60 m2', priceLabel: null, statusLabel: 'Not available yet', isCurrentHome: false, rentEnabled: false },
  { mapId: 'home_apt', title: 'My place', text: 'Home', areaLabel: '30 m2', priceLabel: '§500', statusLabel: 'Available', isCurrentHome: true, rentEnabled: false },
];

function renderRentals(tabName = 'Kijiji') {
  hud.renderPhone({
    tab: 'rentals',
    currentStatusName: 'Visitor',
    searchedJobs: false,
    jobs: [],
    currentJob: null,
    visas: [],
    pending: null,
    currencyName: '§',
    bills: [],
    billsTotal: 0,
    creditScore: 700,
    creditHistory: [],
    rentalTabName: tabName,
    contactsTabName: 'People',
    rentals,
    rentDisabledTitle: 'Renting is coming soon',
  });
}

renderRentals('Kijiji');
const doc = window.document;

const rentalsTab = doc.querySelector('[data-phone-tab="rentals"]') as HTMLButtonElement;
check('rentals tab label comes from the tuning name', rentalsTab.textContent === 'Kijiji');
check('picking the rentals tab marks it active', rentalsTab.classList.contains('active'));
check('smartphone frame has a status bar and home indicator', !!doc.querySelector('.phone-shell .phone-status-bar') && !!doc.querySelector('.phone-shell .phone-home-indicator'));
check('content sits before bottom-tab navigation', !!doc.querySelector('.phone-header + #phone-body + .phone-tabs'));
check('contacts tab label comes from tuning', doc.querySelector('[data-phone-tab="contacts"]')?.textContent === 'People');
hud.setClock(9, 5, 'Wed');
check('weekday and game clock share the smartphone status bar', doc.querySelector('.phone-status')?.textContent === 'Wed 09:05');

const cards = [...doc.querySelectorAll('#phone-body .phone-card')];
check('every listed ad renders a card', cards.length === 3);

// m2 is shown on EVERY ad (available, gated, current alike).
const areaTexts = cards.map((c) => c.querySelector('.phone-rental-area')?.textContent);
check('m2 is shown on every ad', areaTexts.join('|') === '45 m2|60 m2|30 m2');

// Price appears ONLY on the available, non-current ad.
const availableCard = cards[0], gatedCard = cards[1], homeCard = cards[2];
check('available ad shows its rent price', availableCard.querySelector('.phone-card-pay')?.textContent === '§812');
check('unavailable ad shows NO price', gatedCard.querySelector('.phone-card-pay') === null);

// The not-available chip (themeable label) sits on the gated ad; the current home is flagged.
check('unavailable ad renders the not-available chip', gatedCard.querySelector('.phone-pending')?.textContent === 'Not available yet');
check('current home ad is flagged "Current"', homeCard.querySelector('.phone-pending')?.textContent === 'Current');

// R4: the Rent button is ENABLED per RentalCardView.rentEnabled (available + not current + no
// pending move); gated/current ads stay disabled and carry the tooltip.
const rentButtons = cards.map((c) => c.querySelector('button.apply') as HTMLButtonElement);
check('every ad has a Rent button', rentButtons.every((b) => b && b.textContent === 'Rent'));
check('the available ad Rent button is enabled', rentButtons[0].disabled === false);
check('the gated + current-home Rent buttons stay disabled', rentButtons[1].disabled === true && rentButtons[2].disabled === true);
check('an enabled Rent button carries no disabled tooltip', !rentButtons[0].title);
check('a disabled Rent button carries the tooltip', rentButtons[1].title === 'Renting is coming soon');

// The hook seam is wired: an enabled Rent button click routes its map id.
let requested: string | null = null;
hud.onPhoneRentRequested = (id) => { requested = id; };
rentButtons[0].dispatchEvent(new window.Event('click', { bubbles: true }));
check('Rent button routes its map id to the onPhoneRentRequested hook', requested === 'available_apt');

// R4: the pending-move destination card replaces the Rent button with a countdown + Cancel move
// control; every other Rent button is disabled while a move is pending.
const pendingRentals: RentalCardView[] = [
  { mapId: 'available_apt', title: 'Sunny 1BR', text: 'Great light', areaLabel: '45 m2', priceLabel: '§812', statusLabel: 'Available', isCurrentHome: false, rentEnabled: false },
  { mapId: 'moving_apt', title: 'Loft', text: 'Downtown', areaLabel: '60 m2', priceLabel: '§900', statusLabel: 'Available', isCurrentHome: false, rentEnabled: false, pendingHere: true, pendingLabel: 'Moving in 3h...' },
];
hud.renderPhone({
  tab: 'rentals', currentStatusName: 'Visitor', searchedJobs: false, jobs: [], currentJob: null,
  visas: [], pending: null, currencyName: '§', bills: [], billsTotal: 0, creditScore: 700,
  creditHistory: [], rentalTabName: 'Kijiji', rentals: pendingRentals, rentDisabledTitle: 'Not rentable right now',
  contactsTabName: 'Contacts',
});
const pCards = [...doc.querySelectorAll('#phone-body .phone-card')];
const movingCard = pCards[1];
check('pending card shows the move-in countdown', movingCard.querySelector('.phone-rental-countdown')?.textContent === 'Moving in 3h...');
check('pending card shows no Rent button', movingCard.querySelector('button.apply.phone-rental-cancel') !== null && movingCard.querySelector('button.apply:not(.phone-rental-cancel)') === null);
check('other ad Rent button is disabled while a move is pending', (pCards[0].querySelector('button.apply') as HTMLButtonElement).disabled === true);
let cancelledId: string | null = null;
hud.onPhoneMoveCancelRequested = (id) => { cancelledId = id; };
const cancelBtn = movingCard.querySelector('button.phone-rental-cancel') as HTMLButtonElement;
cancelBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
check('Cancel move routes its map id to onPhoneMoveCancelRequested', cancelledId === 'moving_apt');

// Empty-state smoke: no listings renders the empty message, not a crash.
rentals.length = 0;
renderRentals('Kijiji');
check('empty rentals renders an empty-state message', !!doc.querySelector('#phone-body .phone-empty'));

const saveCards: SlotCardView[] = [
  { slotId: 'slot-1', kind: 'manual', status: 'ok', name: 'Home', savedAtLabel: 'Today', mapName: 'Condo', funds: 400, gameClockLabel: '2h 10m' },
  { slotId: 'slot-2', kind: 'manual', status: 'empty', name: 'Slot 2', savedAtLabel: 'Empty', mapName: '—', funds: null, gameClockLabel: '0h 00m' },
  { slotId: 'autosave', kind: 'autosave', status: 'ok', name: 'Autosave', savedAtLabel: 'Today', mapName: 'Condo', funds: 350, gameClockLabel: '1h 55m' },
];
hud.renderPhone({
  tab: 'save', currentStatusName: 'Visitor', searchedJobs: false, jobs: [], currentJob: null,
  visas: [], pending: null, currencyName: '§', bills: [], billsTotal: 0, creditScore: 700,
  creditHistory: [], rentalTabName: 'Kijiji', contactsTabName: 'Contacts', saveTabName: 'Archive',
  rentals: [], contacts: [], saveSlots: saveCards,
});
check('save tab label comes from tuning', doc.querySelector('[data-phone-tab="save"]')?.textContent === 'Archive');
check('save tab lists every configured slot', doc.querySelectorAll('#phone-body [data-slot-id]').length === 3);
check('temporary V3 HUD picker is gone', doc.querySelector('#save-controls') === null);
const phoneSaveCards = [...doc.querySelectorAll<HTMLElement>('#phone-body [data-slot-id]')];
const autoButtons = phoneSaveCards[2].querySelectorAll<HTMLButtonElement>('.save-slot-actions button');
check('autosave cannot be manually saved or deleted', autoButtons[0].disabled && autoButtons[2].disabled);
check('autosave remains loadable and exportable', !autoButtons[1].disabled && !autoButtons[3].disabled);
let phoneLoaded = '';
hud.onPhoneLoadRequested = (slotId) => { phoneLoaded = slotId; };
(phoneSaveCards[0].querySelectorAll('.save-slot-actions button')[1] as HTMLButtonElement).click();
check('in-game load asks to discard the active run', !!doc.querySelector('.save-confirm[role="alertdialog"]'));
(doc.querySelector('.save-confirm-actions button:last-child') as HTMLButtonElement).click();
check('confirmed phone Load routes the slot id', phoneLoaded === 'slot-1');
check('one import control targets manual slots', doc.querySelectorAll('.save-import-row select option').length === 2);

hud.renderPhone({
  tab: 'rentals', currentStatusName: 'Visitor', searchedJobs: false, jobs: [], currentJob: null,
  visas: [], pending: null, currencyName: '§', bills: [], billsTotal: 0, creditScore: 700,
  creditHistory: [], rentalTabName: 'Kijiji', contactsTabName: 'Contacts', rentals: pendingRentals,
  rentDisabledTitle: 'Not rentable right now',
});
const frozenCountdown = doc.querySelector('.phone-rental-countdown')?.textContent;

// G3 wiring smoke: the real HUD open/close hooks own independent PauseStack tokens. A nested
// system menu releases only itself, and closing the phone restores the player's selected 2x.
const pauses = new PauseStack(); pauses.rememberSpeed(2);
let phonePause: PauseToken | null = null;
let menuPause: PauseToken | null = null;
hud.onPhoneOpen = () => { if (!phonePause) phonePause = pauses.push('phone'); hud.openPhone(); };
hud.onPhoneClose = () => { if (phonePause) pauses.pop(phonePause); phonePause = null; };
hud.onSystemMenuOpen = () => { if (!menuPause) menuPause = pauses.push('system-menu'); hud.showSystemMenu(); };
hud.onSystemMenuResume = () => { hud.hideSystemMenu(); if (menuPause) pauses.pop(menuPause); menuPause = null; };
(doc.querySelector('#phone-button') as HTMLButtonElement).click();
check('opening the phone pushes a pause and opens its shell', pauses.isPaused() && !!doc.querySelector('#phone-overlay.open'));
check('Kijiji countdown remains rendered while phone pause is active', frozenCountdown === 'Moving in 3h...' && doc.querySelector('.phone-rental-countdown')?.textContent === frozenCountdown);
(doc.querySelector('#system-menu-button') as HTMLButtonElement).click();
check('system menu nests over the phone as a second pause reason', pauses.pausedBy().join('|') === 'phone|system-menu');
hud.onSystemMenuResume();
check('resuming the system menu leaves the phone pause active', pauses.pausedBy().join('|') === 'phone');
(doc.querySelector('.phone-close') as HTMLButtonElement).click();
check('closing the phone releases its hook exactly once', !pauses.isPaused() && !doc.querySelector('#phone-overlay.open'));
check('final phone close restores the selected 2x speed', pauses.speedToRestore() === 2);

if (failures > 0) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll phone-hud.test checks passed.');
