import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TitleScreen } from '../game/title-screen';
import { DEFAULT_TITLE_CONFIG, PreferencesStore } from '../game/title';
import type { SaveConfig } from '../game/data';
import { SaveStore } from '../game/savestore';
import { slotCardViews } from '../game/saveslots';

const dom = new JSDOM(`<!doctype html><body><section id="title-screen"><h1 id="title-logo-text"></h1><img id="title-logo-image"><nav id="title-menu"></nav><div id="title-hint"></div><section id="title-panel" hidden></section><footer id="title-credits"></footer></section></body>`);
Object.assign(globalThis, { document: dom.window.document, window: dom.window });
const values = new Map<string, string>();
const store = new PreferencesStore({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
const applied = { master: 0, music: 0, feedback: 0 };
const audio = {
  setMasterVolume: (value: number) => { applied.master = value; },
  setMusicVolume: (value: number) => { applied.music = value; },
  setFeedbackVolume: (value: number) => { applied.feedback = value; },
};
let newCalls = 0; let loadCalls = 0;
const root = dom.window.document.getElementById('title-screen') as HTMLElement;
const screen = new TitleScreen(root, DEFAULT_TITLE_CONFIG, false, store, audio, { onNew: () => newCalls++, onLoad: () => loadCalls++ });
assert.equal(root.querySelectorAll('#title-menu button').length, 3, 'menu comes from title data');
assert.equal((root.querySelector('[data-menu-id="load"]') as HTMLButtonElement).disabled, true, 'Load is disabled without saves');
(root.querySelector('[data-menu-id="new"]') as HTMLButtonElement).click();
assert.equal(newCalls, 1, 'New dispatches the boot callback');
(root.querySelector('[data-menu-id="options"]') as HTMLButtonElement).click();
assert.equal((root.querySelector('#title-panel') as HTMLElement).hidden, false, 'Options opens reusable panel');
const master = root.querySelector('#title-option-masterVolume') as HTMLInputElement;
master.value = '.35'; master.dispatchEvent(new dom.window.Event('input'));
assert.equal(applied.master, .35, 'option applies live to fake audio');
assert.equal(JSON.parse(values.get('condo-life-prefs')!).masterVolume, .35, 'option persists outside saves');
assert.equal(loadCalls, 0);

const saveConfig: SaveConfig = { slots: 2, autosaveSlotId: 'autosave', autosaveIntervalHours: 12, autosaveOnEvents: [], storageKeyPrefix: 'title-test' };
const saveValues = new Map<string, string>();
const saveStorage = {
  get length() { return saveValues.size; }, getItem: (key: string) => saveValues.get(key) ?? null,
  setItem: (key: string, value: string) => { saveValues.set(key, value); }, removeItem: (key: string) => { saveValues.delete(key); },
  key: (index: number) => [...saveValues.keys()][index] ?? null,
};
const saveStore = new SaveStore(saveStorage);
saveStore.writeSlot(saveConfig, 'slot-1', { version: 1, savedAt: '2026-07-18T12:00:00Z', name: 'Playable', mapId: 'condo', gameHour: 8, playSeconds: 3600, systems: { quests: { funds: 250 } } });
saveValues.set('title-test:slot-2', '{broken');
let loadedSlot = ''; let deletedSlot = '';
const slotScreen = new TitleScreen(root, DEFAULT_TITLE_CONFIG, true, store, audio, {
  onNew: () => {}, onLoad: (slotId) => { loadedSlot = slotId; }, onDelete: (slotId) => { deletedSlot = slotId; saveStore.deleteSlot(saveConfig, slotId); },
}, { views: () => slotCardViews(saveStore, saveConfig) });
(root.querySelector('[data-menu-id="load"]') as HTMLButtonElement).click();
assert.equal(root.querySelectorAll('.title-save-card').length, 3, 'Load opens every configured slot card');
const titleCards = [...root.querySelectorAll<HTMLElement>('.title-save-card')];
assert.equal((titleCards[0].querySelector('button') as HTMLButtonElement).disabled, false, 'valid slot is loadable');
assert.equal((titleCards[1].querySelector('button') as HTMLButtonElement).disabled, true, 'corrupt slot is visible but not loadable');
assert.equal((titleCards[2].querySelector('button') as HTMLButtonElement).disabled, true, 'empty autosave is visible but not loadable');
(titleCards[0].querySelector('button') as HTMLButtonElement).click();
assert.equal(loadedSlot, 'slot-1', 'slot choice dispatches the selected id to the loading gate');
(titleCards[1].querySelectorAll('button')[1] as HTMLButtonElement).click();
assert.ok(root.querySelector('.title-save-confirm[role="alertdialog"]'), 'delete uses a themed inline confirmation');
(root.querySelector('.title-save-confirm .save-confirm-actions button:last-child') as HTMLButtonElement).click();
assert.equal(deletedSlot, 'slot-2', 'confirmed delete routes the corrupt manual slot');
(root.querySelector('#title-panel > .title-menu-button:last-child') as HTMLButtonElement).click();
assert.equal((root.querySelector('#title-panel') as HTMLElement).hidden, true, 'Back returns to the menu');

console.log('title screen: menu, options, and shared slot Load screen passed');
