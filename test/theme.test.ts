// theme.test.ts — headless B8-2-E variable, safe-area anchor, and accordion resolution coverage.
// Run: npx tsx test/theme.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { DEFAULT_THEME, KNOWN_THEME_ELEMENT_IDS, anchorCss, applyTheme, fontFaceCss, resolveAccordionGroups, resolveActionMenuStyle, themeVariableMap } from '../game/theme';
import type { ThemeData } from '../game/data';

let assertions = 0;
function equal(actual: unknown, expected: unknown, message: string) {
  assertions++;
  assert.deepEqual(actual, expected, message);
}

const variables = themeVariableMap(DEFAULT_THEME);
const shippedTheme = JSON.parse(readFileSync(new URL('../data/theme.json', import.meta.url), 'utf8')) as ThemeData;
equal(variables['--theme-font-family'], 'system-ui, sans-serif', 'maps the legacy HUD font');
equal(variables['--theme-panel-bg'], 'rgba(20,26,40,.82)', 'maps the legacy panel background');
equal(variables['--theme-panel-radius'], '10px', 'maps panel component radius override');
equal(variables['--theme-button-radius'], '999px', 'maps pill button component radius override');
equal(variables['--theme-toast-accent'], '#5a9fd6', 'maps toast component accent');
equal(variables['--theme-action-menu-outline-width'], '1px', 'maps action-menu outline width');
equal(variables['--theme-title-screen-bg'], 'rgba(20,26,40,.88)', 'maps title-screen component background');
equal(resolveActionMenuStyle(), { marginPx: 0, paddingXPx: 10, paddingYPx: 7, buttonWidthPx: 116, buttonHeightPx: 48, centerRadiusPx: 106 }, 'missing radial keys reproduce the legacy geometry');
equal(resolveActionMenuStyle({ ...DEFAULT_THEME, components: { actionMenu: { marginPx: 5, paddingXPx: 14, widthPx: 150, centerRadiusPx: 125 } } }), {
  marginPx: 5, paddingXPx: 14, paddingYPx: 7, buttonWidthPx: 150, buttonHeightPx: 48, centerRadiusPx: 125,
}, 'sparse radial metrics resolve over exact defaults');
equal(fontFaceCss(shippedTheme).includes('font-family:"Loucos Lyne"') && fontFaceCss(shippedTheme).includes('/fonts/Loucos Lyne - thesimssansbold.otf'), true, 'shipped local font face is registered from theme data');

const custom: ThemeData = {
  ...DEFAULT_THEME,
  fonts: { family: 'Georgia, serif', sizePx: 18 },
  colors: { ...DEFAULT_THEME.colors, panelBg: '#123456' },
  components: { panel: { radiusPx: 22 } },
};
const customVariables = themeVariableMap(custom);
equal(customVariables['--theme-font-family'], 'Georgia, serif', 'custom font replaces the default');
equal(customVariables['--theme-font-size'], '18px', 'numeric font size receives px');
equal(customVariables['--theme-panel-bg'], '#123456', 'custom global panel color is mapped');
equal(customVariables['--theme-panel-radius'], '22px', 'sparse component override inherits and replaces one field');

const galleryKeys = {
  fontFamily: 'Gallery Face', fontSizePx: 17, background: '#102030', foreground: '#f0e0d0',
  accent: '#abcdef', outline: '#fedcba', radiusPx: 19, outlineWidthPx: 3, shadow: '1px 2px 3px #000',
};
const galleryVariables = themeVariableMap({
  ...DEFAULT_THEME,
  components: {
    card: { ...galleryKeys }, bar: { ...galleryKeys, heightPx: 21 }, phoneShell: { ...galleryKeys },
    phoneTab: { ...galleryKeys, paddingXPx: 8, paddingYPx: 9, heightPx: 51 },
    accordionHeader: { ...galleryKeys, paddingXPx: 12, paddingYPx: 13 },
    actionMenu: { ...galleryKeys, marginPx: 4, paddingXPx: 5, paddingYPx: 6, widthPx: 140, heightPx: 55, centerRadiusPx: 120 },
  },
});
for (const [component, extras] of Object.entries({
  card: {}, bar: { height: '21px' }, phoneShell: {}, phoneTab: { paddingX: '8px', paddingY: '9px', height: '51px' },
  accordionHeader: { paddingX: '12px', paddingY: '13px' },
  actionMenu: { margin: '4px', paddingX: '5px', paddingY: '6px', width: '140px', height: '55px', centerRadius: '120px' },
})) {
  const prefix = `--theme-${component.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}`;
  for (const [suffix, value] of Object.entries({
    'font-family': 'Gallery Face', 'font-size': '17px', bg: '#102030', fg: '#f0e0d0', accent: '#abcdef',
    outline: '#fedcba', radius: '19px', 'outline-width': '3px', shadow: '1px 2px 3px #000',
  })) equal(galleryVariables[`${prefix}-${suffix}`], value, `${component} consumes gallery ${suffix}`);
  for (const [suffix, value] of Object.entries(extras)) {
    const cssSuffix = suffix.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
    equal(galleryVariables[`${prefix}-${cssSuffix}`], value, `${component} consumes gallery ${suffix}`);
  }
}

const previewDom = new JSDOM('<!doctype html><html><head></head><body><div id="hud"></div></body></html>');
const previewTheme: ThemeData = { ...DEFAULT_THEME, components: { card: { background: '#123456', radiusPx: 24 } } };
applyTheme(previewTheme, previewDom.window.document);
equal(previewDom.window.document.documentElement.style.getPropertyValue('--theme-card-bg'), '#123456', 'applyTheme writes a gallery override to the preview root');
applyTheme({ ...previewTheme, components: { card: { radiusPx: 24 } } }, previewDom.window.document);
equal(previewDom.window.document.documentElement.style.getPropertyValue('--theme-card-bg'), '', 'applyTheme removes a cleared sparse override instead of leaving stale preview/runtime CSS');

equal(anchorCss('tl', 8, 12), {
  position: 'absolute', top: 'calc(12px + env(safe-area-inset-top, 0px))', right: 'auto',
  bottom: 'auto', left: 'calc(8px + env(safe-area-inset-left, 0px))', transform: 'none',
}, 'top-left anchor adds top and left safe areas');
equal(anchorCss('br', 5, 9), {
  position: 'absolute', top: 'auto', right: 'calc(5px + env(safe-area-inset-right, 0px))',
  bottom: 'calc(9px + env(safe-area-inset-bottom, 0px))', left: 'auto', transform: 'none',
}, 'bottom-right anchor adds bottom and right safe areas');
equal(anchorCss('tc', -4, 6).left, 'calc(50% + -4px)', 'top-center carries its horizontal offset');
equal(anchorCss('tc', -4, 6).transform, 'translateX(-50%)', 'top-center centers around the offset point');
equal(anchorCss('bc', 0, 14).bottom, 'calc(14px + env(safe-area-inset-bottom, 0px))', 'bottom-center clears the bottom safe area');

const accordionTheme: ThemeData = {
  ...DEFAULT_THEME,
  layout: {
    ...DEFAULT_THEME.layout,
    'needs-panel': { ...DEFAULT_THEME.layout['needs-panel'], accordion: 'Vitals' },
    'skills-panel': { ...DEFAULT_THEME.layout['skills-panel'], accordion: 'Vitals' },
    'not-a-hud-id': { anchor: 'tl', offsetX: 0, offsetY: 0, accordion: 'Vitals' },
    'quest-panel': { ...DEFAULT_THEME.layout['quest-panel'], accordion: 'Missing definition' },
  },
  accordions: [
    { name: 'Vitals', collapsedByDefault: true, icon: '/icons/needs.svg', showText: false },
    { name: 'Vitals', collapsedByDefault: false },
    { name: 'Empty' },
  ],
};
equal(resolveAccordionGroups(accordionTheme), [{
  name: 'Vitals', collapsedByDefault: true, elementIds: ['needs-panel', 'skills-panel'],
  layout: accordionTheme.layout['needs-panel'], icon: '/icons/needs.svg', showText: false,
}], 'accordion resolution is ordered, deduplicated, known-id-only, and definition-gated');
equal(KNOWN_THEME_ELEMENT_IDS.includes('phone-button'), true, 'smartphone is a known layout target');
equal(resolveAccordionGroups(DEFAULT_THEME), [], 'shipped theme leaves the legacy DOM ungrouped');
equal(resolveAccordionGroups(shippedTheme).map((group) => ({ name: group.name, collapsed: group.collapsedByDefault, icon: group.icon, showText: group.showText })), [
  { name: 'Needs', collapsed: true, icon: '/icons/needs.svg', showText: false },
  { name: 'Skills', collapsed: true, icon: '/icons/skills.svg', showText: false },
], 'shipped needs and skills resolve as collapsed icon-only accordions');

console.log(`theme engine: ${assertions} assertions passed`);
