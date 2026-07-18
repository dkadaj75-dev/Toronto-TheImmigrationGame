// ui.ts — HTML/CSS HUD (roadmap §4: UI lives in HTML, not in-canvas).
// Self-contained: builds its own DOM and injects its own styles, so index.html
// needs no changes. Portrait-first, collapsible panels for small screens.
// Bar colors/names come from stats.json; action names from interactions.json.

import type { ActionDef, AssetDef, JobDef, VisaDef } from './data';
import type { RentalCardView, RequirementView } from './phone';
import type { SimStats } from './stats';
import { jobLevelPay, jobLevelTitle } from './work';

/** Phone overlay tabs. ROADMAP_APT R3 adds 'rentals' (the Kijiji tab; its visible label comes
 *  from tuning.phone.rentalTabName, never hardcoded). */
export type PhoneTab = 'jobs' | 'visas' | 'bills' | 'credit' | 'rentals';

export interface ScreenPoint { x: number; y: number }
export interface ScreenInsets { top: number; right: number; bottom: number; left: number }
export interface ContextMenuItemLayout extends ScreenPoint { width: number; height: number }
export interface ContextMenuLayout {
  mode: 'radial' | 'list';
  center: ScreenPoint;
  title: ContextMenuItemLayout;
  items: ContextMenuItemLayout[];
}

const MENU_EDGE_GAP = 8;
const MENU_BUTTON_HEIGHT = 48;

/** ITEM 4: needs are a 0-100 scale (NeedDef carries no per-need max, unlike SkillDef.max), so the
 *  in-bar readout denominator for every need is 100 (e.g. "54/100"). */
export const NEED_MAX = 100;

/** Pure screen-space layout for B6-11's contextual action bubbles. */
export function layoutContextMenu(
  point: ScreenPoint,
  itemCount: number,
  viewport: { width: number; height: number },
  insets: Partial<ScreenInsets> = {},
): ContextMenuLayout {
  const safe: ScreenInsets = {
    top: Math.max(0, insets.top ?? 0), right: Math.max(0, insets.right ?? 0),
    bottom: Math.max(0, insets.bottom ?? 0), left: Math.max(0, insets.left ?? 0),
  };
  const minX = safe.left + MENU_EDGE_GAP;
  const maxX = Math.max(minX, viewport.width - safe.right - MENU_EDGE_GAP);
  const minY = safe.top + MENU_EDGE_GAP;
  const maxY = Math.max(minY, viewport.height - safe.bottom - MENU_EDGE_GAP);
  const usableWidth = Math.max(1, maxX - minX);
  const usableHeight = Math.max(1, maxY - minY);
  const mode: 'radial' | 'list' = itemCount <= 5 ? 'radial' : 'list';
  const buttonWidth = Math.min(mode === 'radial' ? 116 : 160, usableWidth);
  const buttonHeight = Math.min(MENU_BUTTON_HEIGHT, usableHeight);
  const titleWidth = Math.min(120, usableWidth);
  const titleHeight = Math.min(34, usableHeight);
  const desired: ScreenPoint[] = [];

  if (mode === 'radial') {
    const radius = Math.min(106, Math.max(52, Math.min(usableWidth - buttonWidth, usableHeight - buttonHeight) / 2));
    for (let i = 0; i < itemCount; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / Math.max(1, itemCount);
      desired.push({ x: point.x + Math.cos(angle) * radius, y: point.y + Math.sin(angle) * radius });
    }
  } else {
    const gap = itemCount <= 1 ? 0 : Math.min(54, Math.max(0, (usableHeight - buttonHeight) / (itemCount - 1)));
    const side = point.x < viewport.width / 2 ? 1 : -1;
    // Clear the central asset-title bubble before adding the slight outward arc.
    const baseX = point.x + side * (buttonWidth / 2 + titleWidth / 2 + 12);
    const startY = point.y - gap * (itemCount - 1) / 2;
    for (let i = 0; i < itemCount; i++) {
      const t = itemCount <= 1 ? 0 : i / (itemCount - 1);
      desired.push({ x: baseX + side * Math.sin(Math.PI * t) * 14, y: startY + i * gap });
    }
  }

  const halfW = buttonWidth / 2;
  const halfH = buttonHeight / 2;
  const boundsPoints = [...desired, point];
  let left = Math.min(...boundsPoints.map((p, i) => p.x - (i < desired.length ? halfW : titleWidth / 2)));
  let right = Math.max(...boundsPoints.map((p, i) => p.x + (i < desired.length ? halfW : titleWidth / 2)));
  let top = Math.min(...boundsPoints.map((p, i) => p.y - (i < desired.length ? halfH : titleHeight / 2)));
  let bottom = Math.max(...boundsPoints.map((p, i) => p.y + (i < desired.length ? halfH : titleHeight / 2)));
  const shiftAxis = (lo: number, hi: number, safeLo: number, safeHi: number) =>
    lo < safeLo ? safeLo - lo : hi > safeHi ? safeHi - hi : 0;
  const dx = shiftAxis(left, right, minX, maxX);
  const dy = shiftAxis(top, bottom, minY, maxY);
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const center = {
    x: clamp(point.x + dx, minX + titleWidth / 2, maxX - titleWidth / 2),
    y: clamp(point.y + dy, minY + titleHeight / 2, maxY - titleHeight / 2),
  };
  const items = desired.map((p) => ({
    x: clamp(p.x + dx, minX + halfW, maxX - halfW),
    y: clamp(p.y + dy, minY + halfH, maxY - halfH),
    width: buttonWidth, height: buttonHeight,
  }));
  return { mode, center, title: { ...center, width: titleWidth, height: titleHeight }, items };
}

function readSafeAreaInsets(): ScreenInsets {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const result = { top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0, bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0 };
  probe.remove();
  return result;
}

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none;
  font-family: var(--theme-font-family, system-ui, sans-serif); font-size: var(--theme-font-size, 16px); z-index: 10; }
#hud * { box-sizing: border-box; }
#hud, #hud * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.hud-panel { position: absolute; left: calc(8px + env(safe-area-inset-left, 0px));
  background: var(--theme-panel-bg, rgba(20,26,40,.82)); border-radius: var(--theme-panel-radius, 10px);
  box-shadow: var(--theme-panel-shadow, none); font-family: var(--theme-panel-font-family, system-ui, sans-serif);
  padding: 8px 10px; width: 168px; pointer-events: auto; color: var(--theme-panel-fg, #dfe6f2); backdrop-filter: blur(4px); }
#needs-panel { top: calc(8px + env(safe-area-inset-top, 0px)); }
#skills-panel { top: calc(8px + env(safe-area-inset-top, 0px)); left: auto; right: calc(8px + env(safe-area-inset-right, 0px)); }
.hud-panel h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  color: #93a3c0; cursor: pointer; user-select: none; }
.hud-panel h3::after { content: ' ▾'; }
.hud-panel.collapsed h3::after { content: ' ▸'; }
.hud-panel.collapsed .bars, .hud-panel.collapsed .happiness-gauge { display: none; }
.happiness-gauge { display:grid; grid-template-columns:58px 1fr 24px; gap:6px; align-items:center; margin:0 0 5px; }
.happiness-gauge label, .happiness-gauge output { font-size:10px; }
.happiness-gauge output { text-align:right; color:#f0b9e7; font-variant-numeric:tabular-nums; }
.happiness-gauge .bar-fill { background:linear-gradient(90deg,#8e62cf,#e475b9); }
.bar-row { display: grid; grid-template-columns: 58px 1fr; gap: 6px; align-items: center; margin: 3px 0; }
.bar-row label { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { position: relative; height: 14px; border-radius: 4px; background: rgba(255,255,255,.12); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.bar-fill.low { animation: hud-blink 1s infinite; }
/* ITEM 4: the live level shown INSIDE the bar (e.g. "54/100" for a need, "3/10" for a skill).
   Overlaid, right-aligned, theme-aware panel text with a dark halo so it stays readable over any
   fill color. pointer-events:none so it never blocks bar interaction. */
.bar-value { position: absolute; top: 0; right: 5px; height: 100%; display: flex; align-items: center;
  font-size: 9px; line-height: 1; font-variant-numeric: tabular-nums; pointer-events: none;
  color: var(--theme-panel-fg, #eaf0fb); text-shadow: 0 0 2px rgba(0,0,0,.9), 0 0 1px rgba(0,0,0,.9); }
@keyframes hud-blink { 50% { filter: brightness(1.7); } }

#time-bar { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
  background: var(--theme-panel-bg, rgba(20,26,40,.82)); border-radius: var(--theme-button-radius, 999px); padding: 5px 8px; pointer-events: auto;
  display: flex; align-items: center; gap: 4px; color: var(--theme-panel-fg, #dfe6f2); backdrop-filter: blur(4px); }
#time-bar .clock { font-size: 14px; font-variant-numeric: tabular-nums; padding: 0 6px; min-width: 46px; text-align: center; }
#time-bar.paused .clock { color: var(--theme-warn, #e0b05f); }
#time-bar button { border: 0; border-radius: 999px; width: 30px; height: 30px; font-size: 12px;
  background: transparent; color: #93a3c0; cursor: pointer; touch-action: manipulation; }
#time-bar button.active { background: var(--theme-button-accent, rgba(90,120,190,.4)); color: var(--theme-button-fg, #eaf0fb); }
#time-bar.work-override button { opacity: .45; cursor: default; }

#action-menu { position: fixed; inset: 0; display: none; pointer-events: none; color: var(--theme-action-menu-fg, #dfe6f2); z-index: 14; }
#action-menu.open { display: block; }
#action-menu .am-title, #action-menu button { position: absolute; transform: translate(-50%, -50%); }
#action-menu .am-title { display: grid; place-items: center; padding: 5px 9px; border-radius: 999px;
  background: rgba(20,26,40,.88); box-shadow: 0 3px 14px rgba(0,0,0,.35); backdrop-filter: blur(6px);
  font-size: 11px; color: #b8c4da; text-align: center; overflow: hidden; }
#action-menu button { pointer-events: auto; border: var(--theme-action-menu-outline-width, 1px) solid var(--theme-action-menu-outline, rgba(130,158,210,.35));
  border-radius: var(--theme-action-menu-radius, 999px); padding: 7px 10px;
  font-family: var(--theme-action-menu-font-family, system-ui, sans-serif); font-size: var(--theme-action-menu-font-size, 13px);
  line-height: 1.15; font-weight: 650; background: var(--theme-action-menu-bg, rgba(43,57,86,.96));
  color: var(--theme-action-menu-fg, #eaf0fb); cursor: pointer;
  box-shadow: var(--theme-action-menu-shadow, 0 4px 16px rgba(0,0,0,.4)); backdrop-filter: blur(6px); touch-action: manipulation; }
#action-menu button:active { background: var(--theme-action-menu-accent, rgba(90,120,190,.55)); }
#action-menu button:disabled { opacity: .42; cursor: not-allowed; background: rgba(45,55,75,.5); }
#action-menu button.am-cancel { background: rgba(55,45,58,.96); color: #c5b6c8; }

#activity-chip { position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  background: rgba(20,26,40,.92); border-radius: 999px; padding: 8px 14px; color: #dfe6f2;
  font-size: 13px; display: none; align-items: center; gap: 10px; pointer-events: auto; }
#activity-chip.open { display: flex; }
#activity-chip button { border: 0; background: rgba(220,90,90,.35); color: #fbdada; border-radius: var(--theme-button-radius, 999px);
  padding: 4px 10px; font-size: 12px; cursor: pointer; touch-action: manipulation; }

#work-chip { position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%); display: none; align-items: center; border-radius: 999px;
  padding: 9px 16px; background: rgba(41,91,139,.94); color: #f0f7ff; font-size: 13px;
  font-weight: 700; letter-spacing: .02em; box-shadow: 0 3px 14px rgba(0,0,0,.35); }
#work-chip.open { display: flex; }

#quest-panel { bottom: calc(40px + env(safe-area-inset-bottom, 0px)); max-height: 38vh; overflow-y: auto; }
#quest-panel .quest-section-title { font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: #93a3c0; margin: 8px 0 4px; }
#quest-panel .quest-section-title:first-child { margin-top: 0; }
.quest-item { margin: 4px 0; }
.quest-item .qname { font-size: 12px; font-weight: 600; }
.quest-item .qdesc { font-size: 10px; color: #b7c1d6; }
.quest-empty { font-size: 10px; color: #6d7996; font-style: italic; }

#quest-toasts { position: absolute; top: calc(56px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px; align-items: center; pointer-events: none; z-index: 11; }
.quest-toast { background: var(--theme-toast-bg, rgba(20,26,40,.92)); color: var(--theme-toast-fg, #eaf0fb);
  border-radius: var(--theme-toast-radius, 10px); padding: 8px 14px;
  font-family: var(--theme-toast-font-family, system-ui, sans-serif); font-size: var(--theme-toast-font-size, 12px);
  box-shadow: var(--theme-toast-shadow, 0 2px 10px rgba(0,0,0,.35)); opacity: 0; transform: translateY(-6px);
  transition: opacity .25s, transform .25s;
  border-left: var(--theme-toast-outline-width, 3px) solid var(--theme-toast-accent, #5a9fd6); max-width: 80vw; text-align: center; }
.quest-toast.show { opacity: 1; transform: translateY(0); }
.quest-toast.completed { border-left-color: #6fce7a; }

#floating-feedback { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 12; }
.floating-feedback-item { position: absolute; transform: translate(-50%, -100%); white-space: nowrap;
  font-size: 16px; font-weight: 800; color: #f2f5ff; text-shadow: 0 1px 3px #000, 0 0 5px #000;
  will-change: transform, opacity; }
.floating-feedback-item.money-up { color: #74dc83; }
.floating-feedback-item.money-down { color: #ff7777; }

/* Mobile-polish audit (PROJECT_CONTEXT.md §8): at narrow portrait widths (~375-414px) the
   top-center #time-bar (~210px wide) collides with the top-left/top-right needs/skills
   panels (168px each) — three top:8px elements can't fit side by side under ~546px of
   combined width. Fix: both side panels default to collapsed (header-only, like skills
   already did) below the breakpoint, shrunk a bit further, and #time-bar/#quest-toasts
   drop below the now-short collapsed header row instead of sharing it. Panels remain
   tap-to-expand; a designer/player who expands one on a narrow screen may see it extend
   under the time bar, which is an accepted tradeoff of an explicit user action rather than
   the default collided-on-load state this fix targets. */
@media (max-width: 500px) {
  .hud-panel { width: 136px; padding: 6px 8px; }
  .hud-panel h3 { font-size: 10px; }
  .bar-row { grid-template-columns: 44px 1fr; gap: 4px; margin: 2px 0; }
  .bar-row label { font-size: 9px; }
  #time-bar { top: calc(46px + env(safe-area-inset-top, 0px)) !important; padding: 4px 6px; gap: 3px; }
  #time-bar button { width: 26px; height: 26px; }
  #time-bar .clock { min-width: 38px; font-size: 12px; padding: 0 4px; }
  #quest-toasts { top: calc(90px + env(safe-area-inset-top, 0px)) !important; }
}

/* --- Buy/Sell mode (PROJECT_CONTEXT.md §7.6) ---------------------------------------------
   Layout budget on the bottom-right (§8 constraints): #devbar is a full-width strip at the very
   bottom; tools/nav.js's corner gear sits at right:8px, bottom:40px (~36px tall). #funds-chip and
   #buy-button stack ABOVE that, clear of both; #action-menu/#activity-chip stay bottom-center so
   there's no conflict there either. */
#funds-chip { position: absolute; right: calc(8px + env(safe-area-inset-right, 0px));
  bottom: calc(128px + env(safe-area-inset-bottom, 0px)); background: var(--theme-panel-bg, rgba(20,26,40,.82));
  border-radius: 999px; padding: 6px 12px; font-size: 12px; font-variant-numeric: tabular-nums;
  color: #e0c26f; pointer-events: none; }
#buy-button { position: absolute; right: calc(8px + env(safe-area-inset-right, 0px));
  bottom: calc(84px + env(safe-area-inset-bottom, 0px)); border: 0; border-radius: var(--theme-button-radius, 999px);
  padding: 10px 16px; font-family: var(--theme-button-font-family, system-ui, sans-serif); font-size: 13px;
  background: var(--theme-button-bg, rgba(90,120,190,.55)); color: var(--theme-button-fg, #eaf0fb);
  cursor: pointer; pointer-events: auto; touch-action: manipulation; }
#wall-cut-button { position: absolute; right: calc(92px + env(safe-area-inset-right, 0px));
  bottom: calc(84px + env(safe-area-inset-bottom, 0px)); border: var(--theme-outline-width, 1px) solid var(--theme-outline, rgba(130,158,210,.45));
  border-radius: var(--theme-button-radius, 999px); padding: 9px 12px; font-size: 13px; background: rgba(20,26,40,.88);
  color: #b8c4da; cursor: pointer; pointer-events: auto; touch-action: manipulation; }
#wall-cut-button.active { background: rgba(90,120,190,.7); color: #fff; }
#funds-chip.hidden, #buy-button.hidden, #buy-button.work-hidden, #wall-cut-button.hidden { display: none; }
.hud-panel.buy-mode-hidden { display: none; }

/* --- Visa chip + game-over overlay (PROJECT_CONTEXT.md §7.20 B3-6) ---------------------------
   Chip sits directly above #funds-chip (same right-edge stack, same pill language) — "persistent
   small chip near funds chip" per the brief. Amber at <=3 days left OR while in grace; red once
   actually in grace (a stronger warning than the plain low-days amber). */
#visa-chip { position: absolute; right: calc(8px + env(safe-area-inset-right, 0px));
  bottom: calc(168px + env(safe-area-inset-bottom, 0px)); background: var(--theme-panel-bg, rgba(20,26,40,.82));
  border-radius: 999px; padding: 6px 12px; font-size: 12px; color: #9fb0cc; pointer-events: none;
  white-space: nowrap; }
#visa-chip.warn { color: var(--theme-warn, #e0b05f); }
#visa-chip.grace { color: var(--theme-error, #e57a7a); }
#visa-chip.hidden { display: none; }

#phone-button { position: absolute; right: calc(8px + env(safe-area-inset-right, 0px));
  bottom: calc(208px + env(safe-area-inset-bottom, 0px)); width: 48px; height: 48px; padding: 5px;
  border: var(--theme-outline-width, 1px) solid var(--theme-button-outline, rgba(130,158,210,.55)); border-radius: 14px;
  background: rgba(20,26,40,.9); box-shadow: var(--theme-shadow, 0 3px 14px rgba(0,0,0,.35));
  cursor: pointer; pointer-events: auto; touch-action: manipulation; }
#phone-button img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
#phone-button.hidden { display: none; }
.phone-badge { position: absolute; top: -5px; right: -5px; min-width: 20px; height: 20px; padding: 0 5px;
  display: none; align-items: center; justify-content: center; border-radius: 999px; background: #d9364f;
  color: #fff; border: 2px solid #111827; font-size: 11px; font-weight: 800; line-height: 1; }
.phone-badge.show { display: flex; }

#game-over { position: fixed; inset: 0; z-index: 20; display: none; align-items: center;
  justify-content: center; flex-direction: column; gap: 18px; background: rgba(8,10,16,.92);
  color: #eaf0fb; text-align: center; padding: 24px; pointer-events: none; }
#game-over.open { display: flex; pointer-events: auto; }
#game-over h2 { margin: 0; font-size: 20px; letter-spacing: .04em; color: var(--theme-error, #e57a7a); }
#game-over p { margin: 0; font-size: 15px; max-width: 420px; color: #c3cde3; }
#game-over button { border: 0; border-radius: var(--theme-button-radius, 999px); padding: 12px 26px; font-size: 14px;
  background: var(--theme-button-bg, rgba(90,120,190,.55)); color: var(--theme-button-fg, #eaf0fb); cursor: pointer; touch-action: manipulation; }

/* F2 repo notice deliberately shares the visa game-over visual language, but is non-terminal. */
#repo-overlay { position: fixed; inset: 0; z-index: 19; display: none; align-items: center;
  justify-content: center; flex-direction: column; gap: 16px; background: rgba(8,10,16,.88);
  color: #eaf0fb; text-align: center; padding: 24px; pointer-events: none; }
#repo-overlay.open { display: flex; pointer-events: auto; }
#repo-overlay h2 { margin: 0; font-size: 20px; letter-spacing: .04em; color: var(--theme-warn, #e0b05f); }
#repo-overlay p { margin: 0; font-size: 15px; max-width: 460px; color: #c3cde3; }
#repo-overlay ul { margin: 0; padding-left: 22px; max-height: 42vh; overflow: auto; text-align: left; color: #eaf0fb; }
#repo-overlay button { border: 0; border-radius: var(--theme-button-radius, 999px); padding: 12px 26px; font-size: 14px;
  background: var(--theme-button-bg, rgba(90,120,190,.55)); color: var(--theme-button-fg, #eaf0fb); cursor: pointer; touch-action: manipulation; }

/* --- Smartphone overlay (PROJECT_CONTEXT.md §7.20 V2) -------------------------------------- */
#phone-overlay { position: fixed; inset: 0; z-index: 18; display: none; align-items: center;
  justify-content: center; padding: max(14px, env(safe-area-inset-top, 0px)) max(14px, env(safe-area-inset-right, 0px))
  max(14px, env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px));
  background: rgba(8,11,18,.58); pointer-events: none; }
#phone-overlay.open { display: flex; pointer-events: auto; }
.phone-shell { width: min(430px, 100%); max-height: min(760px, 92vh); overflow: hidden;
  display: flex; flex-direction: column; border-radius: 24px; background: rgba(15,20,32,.98);
  border: 1px solid #33415f; box-shadow: 0 22px 70px rgba(0,0,0,.55); color: #eaf0fb; }
.phone-header { display: flex; align-items: center; gap: 10px; padding: 14px 16px 10px; }
.phone-header .phone-title { font-size: 16px; font-weight: 700; flex: 1; }
.phone-header .phone-status { font-size: 11px; color: #93a3c0; }
.phone-close { width: 34px; height: 34px; border: 0; border-radius: 50%; background: #263149;
  color: #dfe6f2; font-size: 18px; cursor: pointer; touch-action: manipulation; }
.phone-tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 0 14px 12px; }
.phone-tabs button { border: 0; border-radius: 10px; padding: 10px; background: #1c2436;
  color: #93a3c0; font-size: 13px; cursor: pointer; touch-action: manipulation; }
.phone-tabs button.active { background: rgba(90,120,190,.55); color: #fff; }
#phone-body { overflow-y: auto; padding: 0 14px 16px; overscroll-behavior: contain; }
.phone-search { width: 100%; border: 0; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
  background: #4466a5; color: white; font-size: 14px; font-weight: 650; cursor: pointer; touch-action: manipulation; }
.phone-card { background: #1a2234; border: 1px solid #2a3853; border-radius: 14px; padding: 12px;
  margin: 9px 0; }
.phone-card-head { display: flex; align-items: flex-start; gap: 10px; }
.phone-card-name { flex: 1; font-size: 14px; font-weight: 700; }
.phone-card-pay { color: #e0c26f; font-size: 13px; white-space: nowrap; }
.phone-meta { color: #9eabc2; font-size: 11px; margin: 5px 0 8px; }
.phone-requirement { font-size: 11px; line-height: 1.35; margin: 3px 0; color: #e2a1a1; }
.phone-requirement.met { color: #8ed19a; }
.phone-card button.apply { width: 100%; margin-top: 10px; border: 0; border-radius: 10px; padding: 10px;
  background: rgba(90,150,220,.5); color: #f2f6ff; font-size: 13px; cursor: pointer; touch-action: manipulation; }
.phone-card button.apply:disabled { opacity: .4; cursor: default; }
.phone-pending { display: inline-block; border-radius: 999px; padding: 4px 8px; background: rgba(224,176,95,.2);
  color: #e0b05f; font-size: 10px; white-space: nowrap; }
.phone-empty { color: #7886a1; font-size: 12px; text-align: center; padding: 28px 10px; }
.phone-bills-summary { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 10px 12px;
  border-radius: 12px; background: #1c2436; color: #eaf0fb; font-size: 13px; font-weight: 700; }
.phone-bills-summary span { flex: 1; }
.phone-bills-summary button, .phone-bill-pay { border: 0; border-radius: 9px; padding: 8px 11px;
  background: #5277be; color: #fff; font-weight: 700; cursor: pointer; }

@media (max-width: 500px) {
  #phone-overlay { padding: 0; align-items: flex-end; }
  .phone-shell { width: 100%; max-height: 88vh; border-radius: 22px 22px 0 0; border-bottom: 0; }
  .phone-header { padding-top: 12px; }
}
.phone-credit-score { font-size: 42px; font-weight: 750; text-align: center; color: #b9d2ff; margin: 10px 0 4px; }
.phone-credit-trend { list-style: none; padding: 0; margin: 14px 0 0; display: grid; gap: 8px; }
.phone-credit-trend li { display: grid; grid-template-columns: 32px 1fr auto; gap: 8px; font-size: 12px; color: #aebbd1; }
.phone-credit-trend .positive { color: #76d394; } .phone-credit-trend .negative { color: #ff8b8b; }
.phone-rental-img { display: block; width: 100%; height: 128px; object-fit: cover; border-radius: 10px;
  margin: 8px 0 4px; background: #10182a; }
.phone-rental-meta { display: flex; align-items: center; gap: 8px; }
.phone-rental-area { font-variant-numeric: tabular-nums; }

#buy-bar { position: absolute; left: 0; right: 0; bottom: 0; pointer-events: none;
  display: none; flex-direction: column; }
#buy-bar.open { display: flex; }
#buy-bar .buy-inner { pointer-events: auto; background: rgba(15,20,32,.95); backdrop-filter: blur(8px);
  padding: 10px calc(10px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) calc(10px + env(safe-area-inset-left, 0px));
  border-top: 1px solid #2c3a58; max-height: 46vh; display: flex; flex-direction: column; gap: 8px; }
.buy-header { display: flex; align-items: center; gap: 8px; }
.buy-header #buy-funds { font-size: 15px; font-weight: 600; color: #e0c26f; white-space: nowrap; }
.buy-header .grow { flex: 1; }
#buy-search { flex: 1; max-width: 220px; background: #1c2436; border: 1px solid #2c3a58; color: #dfe6f2;
  border-radius: 8px; padding: 7px 10px; font-size: 13px; }
#buy-exit { border: 0; border-radius: 999px; background: rgba(220,90,90,.35); color: #fbdada;
  padding: 7px 12px; font-size: 12px; cursor: pointer; touch-action: manipulation; }
.buy-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.buy-tabs button { flex: none; border: 0; border-radius: 999px; padding: 6px 12px; font-size: 12px;
  background: #1c2436; color: #93a3c0; cursor: pointer; touch-action: manipulation; white-space: nowrap; }
.buy-tabs button.active { background: rgba(90,120,190,.5); color: #eaf0fb; }
.buy-cards { display: flex; gap: 8px; overflow-x: auto; padding: 2px; }
.buy-card { flex: none; width: 92px; border: 0; border-radius: 10px; background: #1a2133;
  color: #dfe6f2; padding: 8px; cursor: pointer; text-align: left; touch-action: manipulation; }
.buy-card:disabled { opacity: .4; cursor: default; }
.buy-card .thumb { width: 100%; height: 56px; border-radius: 6px; object-fit: cover; display: block; margin-bottom: 6px; }
.buy-card .thumb-fallback { width: 100%; height: 56px; border-radius: 6px; margin-bottom: 6px;
  display: grid; place-items: center; font-size: 16px; font-weight: 700; color: rgba(0,0,0,.55); }
.buy-card .name { font-size: 11px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.buy-card .price { font-size: 11px; color: #e0c26f; display: block; }
.buy-empty { font-size: 12px; color: #6d7996; font-style: italic; padding: 8px; }

#buy-ghost-controls, #buy-selection-chips { position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%); background: rgba(20,26,40,.92); border-radius: 999px; padding: 8px 10px;
  display: none; align-items: center; gap: 8px; pointer-events: auto; }
#buy-ghost-controls.open, #buy-selection-chips.open { display: flex; }
#buy-ghost-controls button, #buy-selection-chips button { border: 0; border-radius: 999px; padding: 8px 14px;
  font-size: 13px; background: rgba(90,120,190,.28); color: #eaf0fb; cursor: pointer; touch-action: manipulation; }
#buy-ghost-controls button.gc-confirm, #buy-selection-chips button.sc-sell { background: rgba(90,190,110,.35); }
#buy-ghost-controls button.gc-cancel, #buy-selection-chips button.sc-cancel { background: transparent; color: #93a3c0; }
#buy-selection-chips .sel-name { font-size: 12px; color: #93a3c0; padding: 0 4px; white-space: nowrap; }

.theme-accordion { pointer-events: auto; display: grid; gap: 6px; min-width: 136px; }
.theme-accordion-toggle { border: var(--theme-button-outline-width, 0px) solid var(--theme-button-outline, transparent);
  border-radius: var(--theme-button-radius, 999px); padding: 7px 11px;
  background: var(--theme-button-bg, rgba(90,120,190,.55)); color: var(--theme-button-fg, #eaf0fb);
  font-family: var(--theme-button-font-family, system-ui, sans-serif); cursor: pointer; touch-action: manipulation; }
.theme-accordion-body { display: grid; gap: 8px; }
.theme-accordion.collapsed .theme-accordion-body { display: none; }

@media (max-width: 500px) {
  #funds-chip { bottom: calc(118px + env(safe-area-inset-bottom, 0px)) !important; font-size: 11px; padding: 5px 10px; }
  #visa-chip { bottom: calc(154px + env(safe-area-inset-bottom, 0px)) !important; font-size: 11px; padding: 5px 10px; }
  #buy-button { bottom: calc(78px + env(safe-area-inset-bottom, 0px)) !important; font-size: 12px; padding: 8px 12px; }
  #phone-button { bottom: calc(190px + env(safe-area-inset-bottom, 0px)) !important; }
  .buy-card { width: 78px; }
}
`;

export class Hud {
  private needsPanel: HTMLElement;
  private skillsPanel: HTMLElement;
  private menu: HTMLElement;
  private chip: HTMLElement;
  private chipLabel: HTMLElement;
  private workChip: HTMLElement;
  private questPanel: HTMLElement;
  private questBody: HTMLElement;
  private questToasts: HTMLElement;
  private feedbackRoot: HTMLElement;
  private feedbackItems: { el: HTMLElement; elapsed: number }[] = [];
  private fills = new Map<string, HTMLElement>();
  private barValues = new Map<string, HTMLElement>(); // ITEM 4: in-bar "value/max" text elements
  private happinessFill: HTMLElement;
  private happinessValue: HTMLOutputElement;

  // --- Visa chip + game over (§7.20 B3-6) ---
  private visaChip: HTMLElement;
  private gameOverEl: HTMLElement;
  private gameOverText: HTMLElement;
  private repoOverlay: HTMLElement;
  private repoList: HTMLElement;

  // --- Smartphone/jobs/visas (§7.20 V2) ---
  private phoneOverlay: HTMLElement;
  private phoneButton: HTMLButtonElement;
  private phoneIcon: HTMLImageElement;
  private phoneBadge: HTMLElement;
  private phoneBody: HTMLElement;
  private phoneStatus: HTMLElement;
  private phoneTabs: NodeListOf<HTMLButtonElement>;

  // --- Buy/Sell mode (§7.6) ---
  private fundsChip: HTMLElement;
  private buyButton: HTMLElement;
  private wallCutButton: HTMLButtonElement;
  private buyBar: HTMLElement;
  private buyFundsEl: HTMLElement;
  private buySearchEl: HTMLInputElement;
  private buyTabsEl: HTMLElement;
  private buyCardsEl: HTMLElement;
  private ghostControls: HTMLElement;
  private selectionChips: HTMLElement;
  private selNameEl: HTMLElement;
  private selSellPriceEl: HTMLElement;

  /** fires when the player taps the Buy button (game HUD, not the tool) */
  onBuyOpen: (() => void) | null = null;
  /** fires when the player toggles the in-page Sims-style wall cut */
  onWallCutToggle: (() => void) | null = null;
  /** fires when the player exits buy mode (the bar's own Exit button) */
  onBuyClose: (() => void) | null = null;
  onBuyCategoryPick: ((category: string) => void) | null = null;
  onBuySearch: ((query: string) => void) | null = null;
  onBuyItemPick: ((assetId: string) => void) | null = null;
  onGhostRotate: (() => void) | null = null;
  onGhostConfirm: (() => void) | null = null;
  onGhostCancel: (() => void) | null = null;
  onSelectionMove: (() => void) | null = null;
  onSelectionRotate: (() => void) | null = null;
  onSelectionSell: (() => void) | null = null;
  onSelectionCancel: (() => void) | null = null;

  onPhoneClose: (() => void) | null = null;
  onPhoneOpen: (() => void) | null = null;
  onPhoneTabPick: ((tab: PhoneTab) => void) | null = null;
  onPhoneSearchJobs: (() => void) | null = null;
  onPhoneJobApply: ((jobId: string) => void) | null = null;
  onPhoneVisaApply: ((statusId: string) => void) | null = null;
  onPhoneBillPay: ((key: string) => void) | null = null;
  onPhoneBillsPayAll: (() => void) | null = null;
  /** ROADMAP_APT R3 hook seam: fired when the Kijiji "Rent" button is activated. R4 wires the
   *  real rent → move-in flow here (the button is enabled per RentalCardView.rentEnabled). */
  onPhoneRentRequested: ((mapId: string) => void) | null = null;
  /** ROADMAP_APT R4: fired by the pending-move card's Cancel control. Cancellation applies
   *  NOTHING beyond clearing the pending move (side_effect_rule — see game/rental.ts). */
  onPhoneMoveCancelRequested: ((mapId: string) => void) | null = null;
  onRepoClose: (() => void) | null = null;

  onCancelAction: (() => void) | null = null;
  /** fires whenever the action menu closes (pick, cancel, or tap-away) */
  onMenuHidden: (() => void) | null = null;
  onActionSelected: (() => void) | null = null;
  onToast: ((cue: 'questStarted' | 'questCompleted' | 'notification') => void) | null = null;

  /** Simulation speed multiplier: 0 (paused), 1, 2, or 3. */
  speed = 1;
  private lastRunningSpeed = 1;
  private workSpeedLocked = false;
  private timeBar!: HTMLElement;
  private clockEl!: HTMLElement;

  constructor(private stats: SimStats) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-panel" id="needs-panel"><h3>Needs</h3><div class="happiness-gauge"><label>Happy</label><div class="bar-track"><div class="bar-fill"></div></div><output>0</output></div><div class="bars"></div></div>
      <div class="hud-panel" id="skills-panel"><h3>Skills</h3><div class="bars"></div></div>
      <div class="hud-panel" id="quest-panel"><h3>Quests</h3><div class="bars" id="quest-body"></div></div>
      <div id="time-bar">
        <button data-speed="0" title="Pause (space)">⏸</button>
        <span class="clock">--:--</span>
        <button data-speed="1" class="active" title="Normal (1)">1×</button>
        <button data-speed="2" title="Fast (2)">2×</button>
        <button data-speed="3" title="Ultra (3)">3×</button>
      </div>
      <div id="action-menu"></div>
      <div id="activity-chip"><span id="activity-label"></span><button>Stop</button></div>
      <div id="work-chip">At work</div>
      <div id="quest-toasts"></div>
      <div id="floating-feedback"></div>
      <div id="visa-chip"></div>
      <div id="funds-chip">§ 0</div>
      <button id="buy-button">🛒 Buy</button>
      <button id="wall-cut-button" aria-pressed="false" title="Cut walls down">⌂ Cut</button>
      <button id="phone-button" aria-label="Open smartphone" title="Smartphone"><img alt="" /><span class="phone-badge" aria-label="0 unpaid bills"></span></button>
      <div id="game-over">
        <h2>Game Over</h2>
        <p id="game-over-text"></p>
        <button id="game-over-restart">Restart</button>
      </div>
      <div id="repo-overlay">
        <h2>Repossession notice</h2>
        <p>The repo company seized these assets and credited their resale value against your debt:</p>
        <ul id="repo-list"></ul>
        <button id="repo-close">Continue</button>
      </div>
      <div id="phone-overlay">
        <div class="phone-shell" role="dialog" aria-modal="true" aria-label="Phone">
          <div class="phone-header">
            <span class="phone-title">Phone</span>
            <span class="phone-status"></span>
            <button class="phone-close" aria-label="Close phone">×</button>
          </div>
          <div class="phone-tabs">
            <button data-phone-tab="jobs" class="active">Jobs</button>
            <button data-phone-tab="visas">Visas</button>
            <button data-phone-tab="bills">Bills</button>
            <button data-phone-tab="credit">Credit</button>
            <button data-phone-tab="rentals">Rentals</button>
          </div>
          <div id="phone-body"></div>
        </div>
      </div>
      <div id="buy-bar">
        <div class="buy-inner">
          <div class="buy-header">
            <span id="buy-funds">§ 0</span>
            <span class="grow"></span>
            <input id="buy-search" type="search" placeholder="Search…" />
            <button id="buy-exit">✕ Exit</button>
          </div>
          <div class="buy-tabs" id="buy-tabs"></div>
          <div class="buy-cards" id="buy-cards"></div>
        </div>
      </div>
      <div id="buy-ghost-controls">
        <button data-gc="rotate">⟳ Rotate</button>
        <button data-gc="confirm" class="gc-confirm">✓ Confirm</button>
        <button data-gc="cancel" class="gc-cancel">✗ Cancel</button>
      </div>
      <div id="buy-selection-chips">
        <span class="sel-name" id="buy-sel-name"></span>
        <button data-sc="move">Move</button>
        <button data-sc="rotate">Rotate</button>
        <button data-sc="sell" class="sc-sell">Sell <span id="buy-sell-price"></span></button>
        <button data-sc="cancel" class="sc-cancel">Close</button>
      </div>`;
    document.body.appendChild(root);

    this.needsPanel = root.querySelector('#needs-panel')!;
    this.happinessFill = root.querySelector('.happiness-gauge .bar-fill')!;
    this.happinessValue = root.querySelector('.happiness-gauge output')!;
    this.skillsPanel = root.querySelector('#skills-panel')!;
    this.menu = root.querySelector('#action-menu')!;
    this.chip = root.querySelector('#activity-chip')!;
    this.chipLabel = root.querySelector('#activity-label')!;
    this.workChip = root.querySelector('#work-chip')!;
    this.questPanel = root.querySelector('#quest-panel')!;
    this.questBody = root.querySelector('#quest-body')!;
    this.questToasts = root.querySelector('#quest-toasts')!;
    this.feedbackRoot = root.querySelector('#floating-feedback')!;
    this.chip.querySelector('button')!.addEventListener('click', () => this.onCancelAction?.());

    // --- Visa status + terminal game-over UI (§7.20 B3-6) ---
    this.visaChip = root.querySelector('#visa-chip')!;
    this.gameOverEl = root.querySelector('#game-over')!;
    this.gameOverText = root.querySelector('#game-over-text')!;
    root.querySelector('#game-over-restart')!.addEventListener('click', () => location.reload());
    this.repoOverlay = root.querySelector('#repo-overlay')!;
    this.repoList = root.querySelector('#repo-list')!;
    root.querySelector('#repo-close')!.addEventListener('click', () => {
      this.repoOverlay.classList.remove('open');
      this.onRepoClose?.();
    });

    // --- Smartphone/jobs/visas wiring (§7.20 V2) ---
    this.phoneOverlay = root.querySelector('#phone-overlay')!;
    this.phoneButton = root.querySelector('#phone-button')!;
    this.phoneIcon = this.phoneButton.querySelector('img')!;
    this.phoneBadge = this.phoneButton.querySelector('.phone-badge')!;
    this.phoneBody = root.querySelector('#phone-body')!;
    this.phoneStatus = root.querySelector('.phone-status')!;
    this.phoneTabs = root.querySelectorAll<HTMLButtonElement>('[data-phone-tab]');
    this.phoneButton.addEventListener('click', () => this.onPhoneOpen?.());
    this.setPhoneIcon('/icons/Smartphone.png');
    root.querySelector('.phone-close')!.addEventListener('click', () => {
      this.closePhone();
      this.onPhoneClose?.();
    });
    this.phoneTabs.forEach((button) => button.addEventListener('click', () => {
      const tab = button.dataset.phoneTab as PhoneTab;
      this.onPhoneTabPick?.(tab);
    }));

    // --- Buy/Sell mode wiring (§7.6) ---
    this.fundsChip = root.querySelector('#funds-chip')!;
    this.buyButton = root.querySelector('#buy-button')!;
    this.wallCutButton = root.querySelector('#wall-cut-button')!;
    this.buyBar = root.querySelector('#buy-bar')!;
    this.buyFundsEl = root.querySelector('#buy-funds')!;
    this.buySearchEl = root.querySelector('#buy-search')!;
    this.buyTabsEl = root.querySelector('#buy-tabs')!;
    this.buyCardsEl = root.querySelector('#buy-cards')!;
    this.ghostControls = root.querySelector('#buy-ghost-controls')!;
    this.selectionChips = root.querySelector('#buy-selection-chips')!;
    this.selNameEl = root.querySelector('#buy-sel-name')!;
    this.selSellPriceEl = root.querySelector('#buy-sell-price')!;

    this.buyButton.addEventListener('click', () => this.onBuyOpen?.());
    this.wallCutButton.addEventListener('click', () => this.onWallCutToggle?.());
    root.querySelector('#buy-exit')!.addEventListener('click', () => this.onBuyClose?.());
    this.buySearchEl.addEventListener('input', () => this.onBuySearch?.(this.buySearchEl.value));
    root.querySelector('[data-gc="rotate"]')!.addEventListener('click', () => this.onGhostRotate?.());
    root.querySelector('[data-gc="confirm"]')!.addEventListener('click', () => this.onGhostConfirm?.());
    root.querySelector('[data-gc="cancel"]')!.addEventListener('click', () => this.onGhostCancel?.());
    root.querySelector('[data-sc="move"]')!.addEventListener('click', () => this.onSelectionMove?.());
    root.querySelector('[data-sc="rotate"]')!.addEventListener('click', () => this.onSelectionRotate?.());
    root.querySelector('[data-sc="sell"]')!.addEventListener('click', () => this.onSelectionSell?.());
    root.querySelector('[data-sc="cancel"]')!.addEventListener('click', () => this.onSelectionCancel?.());

    // --- time controls ---
    this.timeBar = root.querySelector('#time-bar')!;
    this.clockEl = this.timeBar.querySelector('.clock')!;
    this.timeBar.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => this.setSpeed(Number(b.dataset.speed))),
    );
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Space') { e.preventDefault(); this.togglePause(); }
      else if (e.key === '1' || e.key === '2' || e.key === '3') this.setSpeed(Number(e.key));
    });

    for (const panel of [this.needsPanel, this.skillsPanel, this.questPanel]) {
      panel.querySelector('h3')!.addEventListener('click', () => panel.classList.toggle('collapsed'));
    }
    // Narrow portrait phones (~375-414px): both side panels start collapsed to save
    // horizontal space so the top-center time-bar (and quest toasts below it) don't collide
    // with them (PROJECT_CONTEXT.md §8 mobile-polish audit) — tap either header to expand.
    if (window.innerWidth < 500) {
      this.skillsPanel.classList.add('collapsed');
      this.needsPanel.classList.add('collapsed');
    }

    this.rebuildBars();
  }

  /** (Re)build bar rows from the stat definitions — called at start and on data hot-reload. */
  rebuildBars() {
    this.fills.clear();
    this.barValues.clear();
    const build = (panel: HTMLElement, rows: { id: string; name: string; color: string }[], prefix: string) => {
      const bars = panel.querySelector('.bars')!;
      bars.innerHTML = '';
      for (const row of rows) {
        const el = document.createElement('div');
        el.className = 'bar-row';
        // ITEM 4: a .bar-value span rides inside the track (over the fill) showing the live level.
        el.innerHTML = `<label>${row.name}</label><div class="bar-track"><div class="bar-fill" style="background:${row.color}"></div><span class="bar-value"></span></div>`;
        bars.appendChild(el);
        this.fills.set(`${prefix}:${row.id}`, el.querySelector('.bar-fill')!);
        this.barValues.set(`${prefix}:${row.id}`, el.querySelector('.bar-value')!);
      }
    };
    build(this.needsPanel, this.stats.needDefs, 'need');
    build(this.skillsPanel, this.stats.skillDefs, 'skill');
    this.refresh();
  }

  /** Update bar widths + in-bar value text from current values. Call once per HUD tick (not per frame). */
  refresh() {
    // Needs are a 0-100 scale (no per-need max in stats.json) → shown as "value/100".
    for (const def of this.stats.needDefs) {
      const fill = this.fills.get(`need:${def.id}`);
      if (!fill) continue;
      const v = this.stats.needs.get(def.id) ?? 0;
      fill.style.width = `${v}%`;
      fill.classList.toggle('low', v < 20);
      const text = this.barValues.get(`need:${def.id}`);
      if (text) text.textContent = `${Math.round(v)}/${NEED_MAX}`;
    }
    // Skills use each stat's real max from stats.json (e.g. charisma 10, cooking 100) → "value/max".
    for (const def of this.stats.skillDefs) {
      const fill = this.fills.get(`skill:${def.id}`);
      if (!fill) continue;
      const max = def.max || 100;
      const v = this.stats.skills.get(def.id) ?? 0;
      fill.style.width = `${(v / max) * 100}%`;
      const text = this.barValues.get(`skill:${def.id}`);
      if (text) text.textContent = `${Math.round(v)}/${max}`;
    }
  }

  setHappiness(value: number) {
    const safe = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
    this.happinessFill.style.width = `${safe}%`;
    this.happinessValue.value = String(Math.round(safe));
    this.happinessValue.textContent = String(Math.round(safe));
  }

  setSpeed(s: number) {
    if (this.workSpeedLocked) return;
    this.speed = s;
    if (s > 0) this.lastRunningSpeed = s;
    this.timeBar.classList.toggle('paused', s === 0);
    this.timeBar.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.speed) === s),
    );
  }

  togglePause() { this.setSpeed(this.speed === 0 ? this.lastRunningSpeed : 0); }

  setWallCutActive(active: boolean) {
    this.wallCutButton.classList.toggle('active', active);
    this.wallCutButton.setAttribute('aria-pressed', String(active));
    this.wallCutButton.title = active ? 'Show full walls' : 'Cut walls down';
  }

  setClock(hours: number, minutes: number) {
    this.clockEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  /** Screen-space contextual menu around a tapped object. `screen` is optional for old callers. */
  showActionMenu(asset: Pick<AssetDef, 'name'>, actions: ActionDef[], onPick: (a: ActionDef) => void, funds = Infinity, currencyName = '§', screen?: ScreenPoint) {
    this.hideActivity();
    this.menu.innerHTML = `<div class="am-title">${asset.name}</div>`;
    for (const action of actions) {
      const b = document.createElement('button');
      const cost = Math.max(0, action.cost ?? 0);
      b.textContent = cost > 0 ? `${action.name} (${currencyName}${cost})` : action.name;
      b.disabled = funds < cost;
      b.addEventListener('click', () => { this.onActionSelected?.(); this.hideActionMenu(); onPick(action); });
      this.menu.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'am-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.hideActionMenu());
    this.menu.appendChild(cancel);
    const layout = layoutContextMenu(
      screen ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      actions.length + 1,
      { width: window.innerWidth, height: window.innerHeight },
      readSafeAreaInsets(),
    );
    const title = this.menu.querySelector<HTMLElement>('.am-title')!;
    Object.assign(title.style, {
      left: `${layout.title.x}px`, top: `${layout.title.y}px`,
      width: `${layout.title.width}px`, height: `${layout.title.height}px`,
    });
    this.menu.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => {
      const item = layout.items[i];
      Object.assign(button.style, {
        left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`,
      });
    });
    this.menu.dataset.layout = layout.mode;
    this.menu.classList.add('open');
  }

  hideActionMenu() {
    if (this.menu.classList.contains('open')) {
      this.menu.classList.remove('open');
      this.onMenuHidden?.();
    }
  }

  /** Chip shown while an action runs ("Watching TV · Stop"). */
  showActivity(label: string) {
    this.hideActionMenu();
    this.chipLabel.textContent = label;
    this.chip.classList.add('open');
  }

  hideActivity() { this.chip.classList.remove('open'); }

  /** V3 away-state banner + speed-control lock. The selected speed itself is never mutated. */
  setAtWork(active: boolean) {
    this.workSpeedLocked = active;
    this.workChip.classList.toggle('open', active);
    this.timeBar.classList.toggle('work-override', active);
    this.buyButton.classList.toggle('work-hidden', active);
    if (active) {
      this.hideActionMenu();
      this.hideActivity();
    }
  }

  /** Rebuild the quest log panel. `completed` is the full completion log; only the last `completedLimit` show. */
  setQuestLog(active: { name: string; description: string }[], completed: { name: string }[], completedLimit: number) {
    const body = this.questBody;
    body.innerHTML = '';

    const activeTitle = document.createElement('div');
    activeTitle.className = 'quest-section-title';
    activeTitle.textContent = 'Active';
    body.appendChild(activeTitle);
    if (active.length === 0) {
      body.appendChild(makeEmptyRow('No active quests'));
    } else {
      for (const q of active) {
        const item = document.createElement('div');
        item.className = 'quest-item';
        item.innerHTML = `<div class="qname">${q.name}</div><div class="qdesc">${q.description}</div>`;
        body.appendChild(item);
      }
    }

    const doneTitle = document.createElement('div');
    doneTitle.className = 'quest-section-title';
    doneTitle.textContent = 'Completed';
    body.appendChild(doneTitle);
    const recent = completed.slice(-completedLimit).reverse();
    if (recent.length === 0) {
      body.appendChild(makeEmptyRow('None yet'));
    } else {
      for (const q of recent) {
        const item = document.createElement('div');
        item.className = 'quest-item';
        item.innerHTML = `<div class="qname">✓ ${q.name}</div>`;
        body.appendChild(item);
      }
    }
  }

  /** Transient toast for a quest trigger/completion. Duration comes from tuning.quests.toastDurationSeconds. */
  showQuestToast(text: string, kind: 'started' | 'completed', durationMs: number, cue: 'questStarted' | 'questCompleted' | 'notification' = 'notification') {
    this.onToast?.(cue);
    const el = document.createElement('div');
    el.className = kind === 'completed' ? 'quest-toast completed' : 'quest-toast';
    el.textContent = text;
    this.questToasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, durationMs);
  }

  showFloatingFeedback(text: string, kind: 'skill' | 'money-up' | 'money-down'): void {
    const el = document.createElement('div');
    el.className = `floating-feedback-item ${kind}`;
    el.textContent = text;
    this.feedbackRoot.appendChild(el);
    this.feedbackItems.push({ el, elapsed: 0 });
  }

  /** Sim-time animation, anchored each frame to main.ts's projected point for crisp HTML text. */
  updateFloatingFeedback(dt: number, x: number, y: number, durationSeconds: number, risePixels: number): void {
    const duration = Math.max(0.01, durationSeconds);
    for (let i = this.feedbackItems.length - 1; i >= 0; i--) {
      const item = this.feedbackItems[i];
      item.elapsed += Math.max(0, dt);
      const t = Math.min(1, item.elapsed / duration);
      item.el.style.left = `${x}px`;
      item.el.style.top = `${y - risePixels * t - i * 20}px`;
      item.el.style.opacity = String(1 - t);
      if (t >= 1) { item.el.remove(); this.feedbackItems.splice(i, 1); }
    }
  }

  /** Persistent legal-status readout. Grace is terminal-warning red; an expiring status turns
   * amber for its final three days. `daysLeft === null` outside grace means permanent. */
  setVisaChip(statusName: string, daysLeft: number | null, inGrace: boolean) {
    const remaining = daysLeft === null ? null : Math.max(0, Math.ceil(daysLeft));
    this.visaChip.textContent = inGrace
      ? `${statusName} · Grace${remaining === null ? '' : ` ${remaining}d`}`
      : `${statusName} · ${remaining === null ? 'Permanent' : `${remaining}d`}`;
    this.visaChip.classList.toggle('warn', !inGrace && remaining !== null && remaining <= 3);
    this.visaChip.classList.toggle('grace', inGrace);
  }

  /** Terminal V1 overlay. It intentionally has no close path; Restart reloads the page. */
  showGameOver(description: string) {
    this.closePhone();
    this.phoneButton.classList.add('hidden');
    this.gameOverText.textContent = description;
    this.gameOverEl.classList.add('open');
  }

  /** F2 non-terminal notice. The caller decides whether closing it resumes or reveals game over. */
  showRepoNotice(seized: { name: string; sellPrice: number }[], currencyName: string) {
    this.closePhone();
    this.repoList.innerHTML = '';
    if (seized.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'Nothing remained to seize.';
      this.repoList.appendChild(item);
    } else {
      for (const asset of seized) {
        const item = document.createElement('li');
        item.textContent = `${asset.name} (${currencyName}${asset.sellPrice.toLocaleString()})`;
        this.repoList.appendChild(item);
      }
    }
    this.repoOverlay.classList.add('open');
  }

  // ================================================================ Smartphone/jobs/visas (§7.20 V2)

  openPhone() {
    this.hideActionMenu();
    this.phoneOverlay.classList.add('open');
  }

  closePhone() { this.phoneOverlay.classList.remove('open'); }

  setPhoneIcon(path: string) { this.phoneIcon.src = path || '/icons/Smartphone.png'; }

  setPhoneBadge(count: number) {
    const safeCount = Math.max(0, Math.floor(count));
    this.phoneBadge.textContent = safeCount > 99 ? '99+' : String(safeCount);
    this.phoneBadge.setAttribute('aria-label', `${safeCount} unpaid bill${safeCount === 1 ? '' : 's'}`);
    this.phoneBadge.classList.toggle('show', safeCount > 0);
  }

  renderPhone(args: {
    tab: PhoneTab;
    currentStatusName: string;
    searchedJobs: boolean;
    jobs: { job: JobDef; requirementsMet: boolean; requirements: RequirementView[] }[];
    currentJob: { job: JobDef; skips: number; levelIndex: number } | null;
    visas: { visa: VisaDef; requirementsMet: boolean; requirements: RequirementView[] }[];
    pending: { statusId: string; daysRemaining: number } | null;
    currencyName: string;
    bills: { key: string; name: string; amount: number }[];
    billsTotal: number;
    creditScore: number;
    creditHistory: { day: number; delta: number; reason: string; score: number }[];
    /** ROADMAP_APT R3 (Kijiji): the tab's visible label (tuning.phone.rentalTabName). */
    rentalTabName: string;
    /** ROADMAP_APT R3: pre-massaged rent-card view-models (game/phone.ts rentalCardViews). */
    rentals: RentalCardView[];
    /** Tooltip shown only on a DISABLED Rent button (gated/current/move-pending ads). */
    rentDisabledTitle?: string;
  }) {
    this.phoneStatus.textContent = args.currentStatusName;
    // The Kijiji tab's label is data-driven (tuning.phone.rentalTabName), never hardcoded.
    this.phoneTabs.forEach((button) => {
      if (button.dataset.phoneTab === 'rentals') button.textContent = args.rentalTabName;
    });
    this.phoneTabs.forEach((button) => button.classList.toggle('active', button.dataset.phoneTab === args.tab));
    this.phoneBody.innerHTML = '';

    if (args.tab === 'rentals') {
      if (args.rentals.length === 0) {
        this.phoneBody.appendChild(phoneEmpty('No rentals listed yet.'));
        return;
      }
      for (const ad of args.rentals) {
        const card = phoneCard(ad.title || 'Untitled listing');
        if (ad.priceLabel !== null) {
          const price = document.createElement('span');
          price.className = 'phone-card-pay';
          price.textContent = ad.priceLabel;
          card.head.appendChild(price);
        }
        if (ad.image) {
          const img = document.createElement('img');
          img.className = 'phone-rental-img';
          img.alt = '';
          img.src = ad.image;
          card.el.appendChild(img);
        }
        // m² is shown on EVERY ad; the not-available chip / current flag sits beside it.
        const meta = document.createElement('div');
        meta.className = 'phone-meta phone-rental-meta';
        const area = document.createElement('span');
        area.className = 'phone-rental-area';
        area.textContent = ad.areaLabel;
        meta.appendChild(area);
        const chip = document.createElement('span');
        chip.className = 'phone-pending';
        chip.textContent = ad.isCurrentHome ? 'Current' : ad.statusLabel;
        meta.appendChild(chip);
        card.el.appendChild(meta);
        if (ad.text) {
          const text = document.createElement('div');
          text.className = 'phone-meta';
          text.textContent = ad.text;
          card.el.appendChild(text);
        }
        if (ad.pendingHere) {
          // R4: this ad is the destination of the pending move — the Rent button is replaced by
          // the sim-time countdown ("Moving in Xh...") and a Cancel control. Cancelling applies
          // nothing beyond clearing the pending move (side_effect_rule); completion — never this
          // card — is what switches maps.
          const row = document.createElement('div');
          row.className = 'phone-meta phone-rental-meta';
          const label = document.createElement('span');
          label.className = 'phone-pending phone-rental-countdown';
          label.textContent = ad.pendingLabel ?? '';
          row.appendChild(label);
          const cancel = document.createElement('button');
          cancel.className = 'apply phone-rental-cancel';
          cancel.textContent = 'Cancel move';
          cancel.addEventListener('click', () => this.onPhoneMoveCancelRequested?.(ad.mapId));
          row.appendChild(cancel);
          card.el.appendChild(row);
        } else {
          const rent = document.createElement('button');
          rent.className = 'apply';
          rent.textContent = 'Rent';
          // R4: enabled per the view-model's gating (available AND not current AND no pending
          // move) — the pure decision lives in game/phone.ts's rentalCardViews, never here.
          rent.disabled = !ad.rentEnabled;
          if (rent.disabled && args.rentDisabledTitle) rent.title = args.rentDisabledTitle;
          rent.addEventListener('click', () => this.onPhoneRentRequested?.(ad.mapId));
          card.el.appendChild(rent);
        }
        this.phoneBody.appendChild(card.el);
      }
      return;
    }

    if (args.tab === 'credit') {
      const score = document.createElement('div');
      score.className = 'phone-credit-score';
      score.textContent = String(args.creditScore);
      this.phoneBody.appendChild(score);
      const label = document.createElement('div');
      label.className = 'phone-meta';
      label.textContent = 'Current credit score';
      this.phoneBody.appendChild(label);
      if (args.creditHistory.length === 0) {
        this.phoneBody.appendChild(phoneEmpty('No credit changes yet.'));
      } else {
        const history = document.createElement('ul');
        history.className = 'phone-credit-trend';
        for (const change of args.creditHistory) {
          const item = document.createElement('li');
          const day = document.createElement('span'); day.textContent = `D${change.day}`;
          const reason = document.createElement('span'); reason.textContent = change.reason;
          const delta = document.createElement('strong');
          delta.className = change.delta >= 0 ? 'positive' : 'negative';
          delta.textContent = `${change.delta >= 0 ? '+' : ''}${change.delta}`;
          item.append(day, reason, delta); history.appendChild(item);
        }
        this.phoneBody.appendChild(history);
      }
      return;
    }

    if (args.tab === 'jobs') {
      if (args.currentJob) {
        const current = phoneCard(jobLevelTitle(args.currentJob.job, args.currentJob.levelIndex));
        const badge = document.createElement('span');
        badge.className = 'phone-pending';
        badge.textContent = 'Current job';
        current.head.appendChild(badge);
        const details = document.createElement('div');
        details.className = 'phone-meta';
        const level = args.currentJob.job.level === undefined ? '' : ` · Level ${args.currentJob.job.level}`;
        details.textContent = `${formatHour(args.currentJob.job.hours.startHour)}–${formatHour(args.currentJob.job.hours.endHour)} · ${args.currencyName}${args.currentJob.job.payPerShift}/shift${level} · ${args.currentJob.skips} skip${args.currentJob.skips === 1 ? '' : 's'} so far`;
        current.el.appendChild(details);
        this.phoneBody.appendChild(current.el);
      }
      const search = document.createElement('button');
      search.className = 'phone-search';
      search.textContent = 'Search a job';
      search.addEventListener('click', () => this.onPhoneSearchJobs?.());
      this.phoneBody.appendChild(search);
      if (!args.searchedJobs) {
        this.phoneBody.appendChild(phoneEmpty('Search to see jobs available this hour.'));
      } else if (args.jobs.length === 0) {
        this.phoneBody.appendChild(phoneEmpty('No jobs are available.'));
      } else {
        for (const listing of args.jobs) {
          const card = phoneCard(jobLevelTitle(listing.job, 0));
          const pay = document.createElement('span');
          pay.className = 'phone-card-pay';
          pay.textContent = `${args.currencyName}${jobLevelPay(listing.job, 0)}/shift`;
          card.head.appendChild(pay);
          const meta = document.createElement('div');
          meta.className = 'phone-meta';
          meta.textContent = `${formatHour(listing.job.hours.startHour)}–${formatHour(listing.job.hours.endHour)}`;
          card.el.appendChild(meta);
          appendRequirements(card.el, listing.requirements);
          const apply = document.createElement('button');
          apply.className = 'apply';
          apply.textContent = 'Apply';
          apply.disabled = !listing.requirementsMet;
          apply.addEventListener('click', () => this.onPhoneJobApply?.(listing.job.id));
          card.el.appendChild(apply);
          this.phoneBody.appendChild(card.el);
        }
      }
      return;
    }

    if (args.tab === 'bills') {
      if (args.bills.length === 0) {
        this.phoneBody.appendChild(phoneEmpty('No outstanding bills.'));
        return;
      }
      const summary = document.createElement('div');
      summary.className = 'phone-bills-summary';
      const total = document.createElement('span');
      total.textContent = `Total · §${args.billsTotal.toLocaleString()}`;
      const payAll = document.createElement('button');
      payAll.textContent = 'Pay all';
      payAll.addEventListener('click', () => this.onPhoneBillsPayAll?.());
      summary.append(total, payAll);
      this.phoneBody.appendChild(summary);
      for (const bill of args.bills) {
        const card = phoneCard(bill.name);
        const amount = document.createElement('span');
        amount.className = 'phone-card-pay';
        amount.textContent = `§${bill.amount.toLocaleString()}`;
        card.head.appendChild(amount);
        const pay = document.createElement('button');
        pay.className = 'phone-bill-pay';
        pay.textContent = 'Pay';
        pay.addEventListener('click', () => this.onPhoneBillPay?.(bill.key));
        card.el.appendChild(pay);
        this.phoneBody.appendChild(card.el);
      }
      return;
    }

    if (args.visas.length === 0) {
      this.phoneBody.appendChild(phoneEmpty('No statuses accept applications.'));
      return;
    }
    for (const listing of args.visas) {
      const card = phoneCard(listing.visa.name);
      if (args.pending?.statusId === listing.visa.id) {
        const pending = document.createElement('span');
        pending.className = 'phone-pending';
        pending.textContent = `Pending · ${args.pending.daysRemaining}d`;
        card.head.appendChild(pending);
      }
      const meta = document.createElement('div');
      meta.className = 'phone-meta';
      const duration = listing.visa.durationDays === null ? 'Permanent status' : `${listing.visa.durationDays} day status`;
      const wait = listing.visa.applicationDays ?? 0;
      meta.textContent = `${duration} · Decision in ${wait}d`;
      card.el.appendChild(meta);
      appendRequirements(card.el, listing.requirements);
      const apply = document.createElement('button');
      apply.className = 'apply';
      apply.textContent = args.pending?.statusId === listing.visa.id ? 'Pending' : 'Apply';
      apply.disabled = !listing.requirementsMet || args.pending !== null;
      apply.addEventListener('click', () => this.onPhoneVisaApply?.(listing.visa.id));
      card.el.appendChild(apply);
      this.phoneBody.appendChild(card.el);
    }
  }

  // ================================================================ Buy/Sell mode (§7.6)

  /** Persistent funds readout: always kept current so it's correct the instant buy mode opens
   *  or the small outside-of-buy-mode chip is shown. `currencyName` comes from
   *  tuning.economy.currencyName (design pillar: no hardcoded "§"). */
  setFunds(amount: number, currencyName: string) {
    const text = `${currencyName}${Math.floor(amount).toLocaleString()}`;
    this.fundsChip.textContent = text;
    this.buyFundsEl.textContent = text;
  }

  /** Toggles the whole buy-mode chrome: hides the normal needs/skills panels + any open action
   *  menu/activity chip (§7.6: "normal needs/skills panels hide"), shows/hides the catalog bar and
   *  the persistent funds chip/Buy button (redundant once the bar's own funds readout is up). */
  setBuyModeActive(active: boolean) {
    this.needsPanel.classList.toggle('buy-mode-hidden', active);
    this.skillsPanel.classList.toggle('buy-mode-hidden', active);
    this.fundsChip.classList.toggle('hidden', active);
    this.buyButton.classList.toggle('hidden', active);
    this.wallCutButton.classList.toggle('hidden', active);
    this.phoneButton.classList.toggle('hidden', active);
    this.buyBar.classList.toggle('open', active);
    if (active) {
      this.closePhone();
      this.hideActionMenu();
      this.hideActivity();
    } else {
      this.hideGhostControls();
      this.hideSelectionChips();
    }
  }

  /** One catalog card's view-model — pure data the caller (main.ts/BuyModeController) computes
   *  from game/buymode.ts's pure catalog helpers; ui.ts only renders it. */
  renderCatalog(
    categories: { id: string; label: string }[],
    activeCategory: string,
    items: { id: string; name: string; price: number; affordable: boolean; icon?: string; fallbackColor: string; fallbackInitials: string }[],
    currencyName: string,
  ) {
    this.buyTabsEl.innerHTML = '';
    for (const cat of categories) {
      const b = document.createElement('button');
      b.textContent = cat.label;
      b.className = cat.id === activeCategory ? 'active' : '';
      b.addEventListener('click', () => this.onBuyCategoryPick?.(cat.id));
      this.buyTabsEl.appendChild(b);
    }

    this.buyCardsEl.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'buy-empty';
      empty.textContent = 'No items here.';
      this.buyCardsEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const card = document.createElement('button');
      card.className = 'buy-card';
      card.disabled = !item.affordable;
      card.dataset.assetId = item.id;
      if (item.icon) {
        card.innerHTML = `<img class="thumb" src="${item.icon}" loading="lazy" />`;
        const img = card.querySelector('img')!;
        img.addEventListener('error', () => { img.replaceWith(fallbackTile(item.fallbackColor, item.fallbackInitials)); }, { once: true });
      } else {
        card.appendChild(fallbackTile(item.fallbackColor, item.fallbackInitials));
      }
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      const price = document.createElement('span');
      price.className = 'price';
      price.textContent = `${currencyName}${item.price.toLocaleString()}`;
      card.append(name, price);
      card.addEventListener('click', () => { if (item.affordable) this.onBuyItemPick?.(item.id); });
      this.buyCardsEl.appendChild(card);
    }
  }

  setBuySearchValue(q: string) { this.buySearchEl.value = q; }

  showGhostControls() { this.ghostControls.classList.add('open'); }
  hideGhostControls() { this.ghostControls.classList.remove('open'); }

  showSelectionChips(name: string, sellPrice: number, currencyName: string) {
    this.selNameEl.textContent = name;
    this.selSellPriceEl.textContent = `${currencyName}${sellPrice.toLocaleString()}`;
    this.selectionChips.classList.add('open');
  }
  hideSelectionChips() { this.selectionChips.classList.remove('open'); }
}

function fallbackTile(color: string, initials: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'thumb-fallback';
  el.style.background = color;
  el.textContent = initials;
  return el;
}

function makeEmptyRow(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'quest-empty';
  el.textContent = text;
  return el;
}

function phoneEmpty(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'phone-empty';
  el.textContent = text;
  return el;
}

function phoneCard(name: string): { el: HTMLElement; head: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'phone-card';
  const head = document.createElement('div');
  head.className = 'phone-card-head';
  const title = document.createElement('span');
  title.className = 'phone-card-name';
  title.textContent = name;
  head.appendChild(title);
  el.appendChild(head);
  return { el, head };
}

function appendRequirements(parent: HTMLElement, requirements: RequirementView[]) {
  for (const requirement of requirements) {
    const row = document.createElement('div');
    row.className = `phone-requirement${requirement.met ? ' met' : ''}`;
    row.textContent = `${requirement.met ? '✓' : '✕'} ${requirement.text}`;
    parent.appendChild(row);
  }
}

function formatHour(hour: number): string {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const display = normalized % 12 || 12;
  return `${display} ${suffix}`;
}
