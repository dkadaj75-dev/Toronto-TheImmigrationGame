import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TitleScreen } from '../game/title-screen';
import { DEFAULT_TITLE_CONFIG, PreferencesStore } from '../game/title';

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
console.log('title screen: data menu, disabled Load, New dispatch, and live options passed');
