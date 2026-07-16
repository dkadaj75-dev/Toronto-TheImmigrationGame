// theme.ts — B8-2-E data-driven HUD presentation and layout.
// Pure mapping/resolution functions stay DOM-free; applyTheme is the thin browser layer.

import type { ThemeAnchor, ThemeData, ThemeLayoutItem } from './data';

export const KNOWN_THEME_ELEMENT_IDS = [
  'needs-panel', 'skills-panel', 'quest-panel', 'time-bar', 'activity-chip', 'work-chip',
  'quest-toasts', 'visa-chip', 'funds-chip', 'buy-button', 'wall-cut-button', 'phone-button',
  'buy-ghost-controls', 'buy-selection-chips',
] as const;

export const DEFAULT_THEME: ThemeData = {
  fonts: { family: 'system-ui, sans-serif', sizePx: 16 },
  colors: {
    panelBg: 'rgba(20,26,40,.82)', panelFg: '#dfe6f2', accent: 'rgba(90,120,190,.55)',
    warn: '#e0b05f', error: '#e57a7a', buttonBg: 'rgba(90,120,190,.55)',
    buttonFg: '#eaf0fb', outline: 'rgba(130,158,210,.45)',
  },
  shapes: { radiusPx: 10, outlineWidthPx: 1, shadow: '0 3px 14px rgba(0,0,0,.35)' },
  components: {
    panel: { background: 'rgba(20,26,40,.82)', foreground: '#dfe6f2', radiusPx: 10, shadow: 'none' },
    button: { background: 'rgba(90,120,190,.55)', foreground: '#eaf0fb', accent: 'rgba(90,120,190,.4)', outline: 'rgba(130,158,210,.55)', radiusPx: 999, outlineWidthPx: 0, shadow: 'none' },
    toast: { background: 'rgba(20,26,40,.92)', foreground: '#eaf0fb', accent: '#5a9fd6', radiusPx: 10, outlineWidthPx: 3, shadow: '0 2px 10px rgba(0,0,0,.35)', fontSizePx: 12 },
    actionMenu: { background: 'rgba(43,57,86,.96)', foreground: '#eaf0fb', accent: 'rgba(90,120,190,.55)', outline: 'rgba(130,158,210,.35)', radiusPx: 999, outlineWidthPx: 1, shadow: '0 4px 16px rgba(0,0,0,.4)', fontSizePx: 13 },
  },
  layout: {
    'needs-panel': { anchor: 'tl', offsetX: 8, offsetY: 8 },
    'skills-panel': { anchor: 'tr', offsetX: 8, offsetY: 8 },
    'quest-panel': { anchor: 'bl', offsetX: 8, offsetY: 40 },
    'time-bar': { anchor: 'tc', offsetX: 0, offsetY: 8 },
    'activity-chip': { anchor: 'bc', offsetX: 0, offsetY: 14 },
    'work-chip': { anchor: 'bc', offsetX: 0, offsetY: 14 },
    'quest-toasts': { anchor: 'tc', offsetX: 0, offsetY: 56 },
    'visa-chip': { anchor: 'br', offsetX: 8, offsetY: 168 },
    'funds-chip': { anchor: 'br', offsetX: 8, offsetY: 128 },
    'buy-button': { anchor: 'br', offsetX: 8, offsetY: 84 },
    'wall-cut-button': { anchor: 'br', offsetX: 92, offsetY: 84 },
    'phone-button': { anchor: 'br', offsetX: 8, offsetY: 208 },
    'buy-ghost-controls': { anchor: 'bc', offsetX: 0, offsetY: 14 },
    'buy-selection-chips': { anchor: 'bc', offsetX: 0, offsetY: 14 },
  },
  accordions: [],
};

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

/** Pure ThemeData -> CSS custom-property mapping, also used by the Theme Editor preview later. */
export function themeVariableMap(theme?: ThemeData): Record<string, string> {
  const source = theme ?? DEFAULT_THEME;
  const fonts = { ...DEFAULT_THEME.fonts, ...source.fonts };
  const colors = { ...DEFAULT_THEME.colors, ...source.colors };
  const shapes = { ...DEFAULT_THEME.shapes, ...source.shapes };
  const result: Record<string, string> = {
    '--theme-font-family': fonts.family || DEFAULT_THEME.fonts.family,
    '--theme-font-size': `${finite(fonts.sizePx, DEFAULT_THEME.fonts.sizePx)}px`,
    '--theme-panel-bg': colors.panelBg, '--theme-panel-fg': colors.panelFg,
    '--theme-accent': colors.accent, '--theme-warn': colors.warn, '--theme-error': colors.error,
    '--theme-button-bg': colors.buttonBg, '--theme-button-fg': colors.buttonFg,
    '--theme-outline': colors.outline, '--theme-radius': `${finite(shapes.radiusPx, 10)}px`,
    '--theme-outline-width': `${finite(shapes.outlineWidthPx, 1)}px`, '--theme-shadow': shapes.shadow,
  };
  for (const name of ['panel', 'button', 'toast', 'actionMenu'] as const) {
    const override = source.components?.[name] ?? {};
    const prefix = `--theme-${name === 'actionMenu' ? 'action-menu' : name}`;
    result[`${prefix}-font-family`] = override.fontFamily ?? fonts.family;
    result[`${prefix}-font-size`] = `${finite(override.fontSizePx, fonts.sizePx)}px`;
    result[`${prefix}-bg`] = override.background ?? (name === 'button' ? colors.buttonBg : colors.panelBg);
    result[`${prefix}-fg`] = override.foreground ?? (name === 'panel' ? colors.panelFg : colors.buttonFg);
    result[`${prefix}-accent`] = override.accent ?? colors.accent;
    result[`${prefix}-outline`] = override.outline ?? colors.outline;
    result[`${prefix}-radius`] = `${finite(override.radiusPx, shapes.radiusPx)}px`;
    result[`${prefix}-outline-width`] = `${finite(override.outlineWidthPx, shapes.outlineWidthPx)}px`;
    result[`${prefix}-shadow`] = override.shadow ?? shapes.shadow;
  }
  return result;
}

/** Pure anchor -> CSS positioning. Every edge offset includes the corresponding device safe area. */
export function anchorCss(anchor: ThemeAnchor, offsetX = 0, offsetY = 0): Record<string, string> {
  const x = finite(offsetX, 0);
  const y = finite(offsetY, 0);
  const safe = (value: number, edge: 'top' | 'right' | 'bottom' | 'left') =>
    `calc(${value}px + env(safe-area-inset-${edge}, 0px))`;
  const css: Record<string, string> = { position: 'absolute', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', transform: 'none' };
  if (anchor[0] === 't') css.top = safe(y, 'top');
  else if (anchor[0] === 'b') css.bottom = safe(y, 'bottom');
  if (anchor[1] === 'l') css.left = safe(x, 'left');
  else if (anchor[1] === 'r') css.right = safe(x, 'right');
  else {
    css.left = `calc(50% + ${x}px)`;
    css.transform = 'translateX(-50%)';
  }
  return css;
}

export interface AccordionResolution {
  name: string;
  collapsedByDefault: boolean;
  elementIds: string[];
  layout: ThemeLayoutItem;
}

/** Pure accordion membership/order resolution; unknown group names and HUD ids are ignored. */
export function resolveAccordionGroups(theme?: ThemeData): AccordionResolution[] {
  const source = theme ?? DEFAULT_THEME;
  const known = new Set<string>(KNOWN_THEME_ELEMENT_IDS);
  const usedNames = new Set<string>();
  const groups: AccordionResolution[] = [];
  for (const accordion of source.accordions ?? []) {
    const name = accordion.name.trim();
    if (!name || usedNames.has(name)) continue;
    usedNames.add(name);
    const elementIds = Object.entries(source.layout ?? {})
      .filter(([id, item]) => known.has(id) && item.accordion === name)
      .map(([id]) => id);
    if (!elementIds.length) continue;
    groups.push({ name, collapsedByDefault: accordion.collapsedByDefault === true, elementIds, layout: source.layout[elementIds[0]] });
  }
  return groups;
}

function setPosition(element: HTMLElement, layout: ThemeLayoutItem) {
  for (const [property, value] of Object.entries(anchorCss(layout.anchor, layout.offsetX, layout.offsetY))) {
    element.style.setProperty(property, value);
  }
  element.style.display = layout.hidden ? 'none' : '';
}

function unwrapAccordions(hud: HTMLElement): Map<string, boolean> {
  const collapsed = new Map<string, boolean>();
  for (const wrapper of Array.from(hud.querySelectorAll<HTMLElement>(':scope > .theme-accordion'))) {
    if (wrapper.dataset.accordion) collapsed.set(wrapper.dataset.accordion, wrapper.classList.contains('collapsed'));
    const body = wrapper.querySelector<HTMLElement>(':scope > .theme-accordion-body');
    if (body) for (const child of Array.from(body.children)) hud.insertBefore(child, wrapper);
    wrapper.remove();
  }
  return collapsed;
}

/** Apply variables, known-element layout, visibility, and accordion DOM grouping. */
export function applyTheme(theme?: ThemeData, doc: Document = document): void {
  const source = theme ?? DEFAULT_THEME;
  const root = doc.documentElement;
  for (const [property, value] of Object.entries(themeVariableMap(source))) root.style.setProperty(property, value);
  const hud = doc.getElementById('hud');
  if (!hud) return;
  const previousAccordionState = unwrapAccordions(hud);
  for (const id of KNOWN_THEME_ELEMENT_IDS) {
    const element = doc.getElementById(id);
    if (!element) continue;
    setPosition(element, source.layout?.[id] ?? DEFAULT_THEME.layout[id]);
  }
  for (const group of resolveAccordionGroups(source)) {
    const members = group.elementIds.map((id) => doc.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!members.length) continue;
    const wrapper = doc.createElement('section');
    const collapsed = previousAccordionState.get(group.name) ?? group.collapsedByDefault;
    wrapper.className = `theme-accordion${collapsed ? ' collapsed' : ''}`;
    wrapper.dataset.accordion = group.name;
    setPosition(wrapper, { ...group.layout, hidden: false });
    const toggle = doc.createElement('button');
    toggle.type = 'button'; toggle.className = 'theme-accordion-toggle'; toggle.textContent = group.name;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const body = doc.createElement('div'); body.className = 'theme-accordion-body';
    members[0].parentElement!.insertBefore(wrapper, members[0]);
    wrapper.append(toggle, body);
    for (const member of members) {
      body.appendChild(member);
      member.style.position = 'relative'; member.style.inset = 'auto'; member.style.transform = 'none';
    }
    toggle.addEventListener('click', () => {
      const collapsed = wrapper.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }
}
