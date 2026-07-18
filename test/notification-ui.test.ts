import { JSDOM } from 'jsdom';
import { NotificationCenter, type NotificationsData, type ResolvedNotification } from '../game/notifications';
import { PauseStack, type PauseToken } from '../game/interruptions';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost:5173/', pretendToBeVisual: true });
const { window } = dom;
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = window; globals.document = window.document; globals.HTMLElement = window.HTMLElement;
globals.HTMLButtonElement = window.HTMLButtonElement; globals.Node = window.Node; globals.Event = window.Event;
globals.location = window.location;

const { Hud } = await import('../game/ui');
const { SimStats } = await import('../game/stats');

const data: NotificationsData = {
  tiers: {
    modal: { pausesGame: true, requiresOk: true },
    card: { autoExpireSeconds: 20 },
    passive: { autoExpireSeconds: 8 },
  },
  stackCap: 5,
  events: {
    questStarted: { tier: 'modal', icon: 'icons/quest.svg' },
    questCompleted: { tier: 'modal', icon: 'icons/quest.svg' },
    visitorArrived: { tier: 'card', icon: 'icons/visitor.svg', action: { type: 'phoneTab', tab: 'contacts', label: 'Contacts' } },
    chatter: { tier: 'passive' },
  },
};

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

const hud = new Hud(new SimStats({ needs: [], skills: [], personality: [] }));
const center = new NotificationCenter(data);
const pauses = new PauseStack(); pauses.rememberSpeed(2);
let modalToken: PauseToken | null = null;
let routed: ResolvedNotification | null = null;
const paint = (now = 1_000) => hud.renderNotifications(center.stack, center.currentModal, now);
const post = (eventId: string, title: string, now = 1_000) => {
  const item = center.post(eventId, { title }, now);
  if (item.tier === 'modal' && !modalToken) modalToken = pauses.push('notification:modal');
  paint(now);
};
hud.onNotificationDismiss = (id) => { center.dismiss(id); paint(); };
hud.onNotificationAction = (notification) => { routed = notification; };
hud.onNotificationAcknowledge = () => {
  center.acknowledgeModal();
  if (!center.currentModal && modalToken) { pauses.pop(modalToken); modalToken = null; }
  paint();
};

post('visitorArrived', 'Alex arrived');
check('posted card renders in the HUD stack', window.document.querySelector('.notification-card .notification-title')?.textContent === 'Alex arrived');
check('card renders its relative timestamp', window.document.querySelector('.notification-age')?.textContent === 'Just now');
(window.document.querySelector('.notification-action') as HTMLButtonElement).click();
check('card action routes the resolved data-driven action', routed?.action?.type === 'phoneTab' && routed.action.tab === 'contacts');

post('chatter', 'Thinking aloud');
const passive = window.document.querySelector('.notification-card.passive');
check('passive notification has no controls', !!passive && passive.querySelector('button') === null);

// Quest callback migration contract: questStarted is no longer a one-off toast; it resolves through
// the same center and creates the modal UI/pause owner.
post('questStarted', 'Quest started: First Steps');
post('questCompleted', 'Quest completed: First Steps');
check('quest event posts through the notification pipeline', center.currentModal?.eventId === 'questStarted');
check('modal overlay is visible and hard-pauses', window.document.querySelector('#notification-modal.open') !== null && pauses.isPaused());
check('second modal waits in FIFO order', center.pendingModals[0]?.eventId === 'questCompleted');
(window.document.querySelector('.notification-ok') as HTMLButtonElement).click();
check('OK promotes the next modal without unpausing', center.currentModal?.eventId === 'questCompleted' && pauses.isPaused());
(window.document.querySelector('.notification-ok') as HTMLButtonElement).click();
check('final OK clears the modal and restores the chosen 2x speed', !pauses.isPaused() && pauses.speedToRestore() === 2 && !window.document.querySelector('#notification-modal.open'));

let menuToken: PauseToken | null = null;
hud.onSystemMenuOpen = () => { menuToken = pauses.push('system-menu'); hud.showSystemMenu(); };
hud.onSystemMenuResume = () => { hud.hideSystemMenu(); if (menuToken) pauses.pop(menuToken); menuToken = null; };
(window.document.querySelector('#system-menu-button') as HTMLButtonElement).click();
check('gear opens the four-entry paused system menu', pauses.isPaused() && window.document.querySelectorAll('.system-menu-panel > button').length === 4);
(Array.from(window.document.querySelectorAll<HTMLButtonElement>('.system-menu-panel > button')).find((button) => button.textContent === 'Resume')!).click();
check('Resume closes the menu and releases its pause token', !pauses.isPaused() && !window.document.querySelector('#system-menu-overlay.open'));
let saveRoutes = 0; let optionRoutes = 0; let quitRoutes = 0;
hud.onSystemMenuSave = () => { saveRoutes++; };
hud.onSystemMenuOptions = () => { optionRoutes++; };
hud.onSystemMenuQuit = () => { quitRoutes++; };
hud.showSystemMenu();
(Array.from(window.document.querySelectorAll<HTMLButtonElement>('.system-menu-panel > button')).find((button) => button.textContent === 'Save')!).click();
check('system Save entry routes to the shared phone-save adapter hook', saveRoutes === 1);
hud.showSystemMenu();
(Array.from(window.document.querySelectorAll<HTMLButtonElement>('.system-menu-panel > button')).find((button) => button.textContent === 'Options')!).click();
check('system Options entry routes to the shared OptionsPanel adapter hook', optionRoutes === 1);
hud.showSystemMenu();
(Array.from(window.document.querySelectorAll<HTMLButtonElement>('.system-menu-panel > button')).find((button) => button.textContent === 'Quit to title')!).click();
check('Quit first opens a discard confirmation', window.document.querySelector('.system-quit-confirm') !== null && quitRoutes === 0);
(Array.from(window.document.querySelectorAll<HTMLButtonElement>('.system-quit-actions button')).find((button) => button.textContent === 'Quit')!).click();
check('confirmed Quit routes to the title-return hook', quitRoutes === 1);

if (failures) { console.error(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nAll notification-ui.test checks passed.');
