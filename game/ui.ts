// ui.ts — HTML/CSS HUD (roadmap §4: UI lives in HTML, not in-canvas).
// Self-contained: builds its own DOM and injects its own styles, so index.html
// needs no changes. Portrait-first, collapsible panels for small screens.
// Bar colors/names come from stats.json; action names from interactions.json.

import type { ActionDef, AssetDef } from './data';
import type { SimStats } from './stats';

const CSS = `
#hud { position: fixed; inset: 0; pointer-events: none; font-family: system-ui, sans-serif; z-index: 10; }
#hud * { box-sizing: border-box; }
#hud, #hud * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
.hud-panel { position: absolute; left: calc(8px + env(safe-area-inset-left, 0px));
  background: rgba(20,26,40,.82); border-radius: 10px;
  padding: 8px 10px; width: 168px; pointer-events: auto; color: #dfe6f2; backdrop-filter: blur(4px); }
#needs-panel { top: calc(8px + env(safe-area-inset-top, 0px)); }
#skills-panel { top: calc(8px + env(safe-area-inset-top, 0px)); left: auto; right: calc(8px + env(safe-area-inset-right, 0px)); }
.hud-panel h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  color: #93a3c0; cursor: pointer; user-select: none; }
.hud-panel h3::after { content: ' ▾'; }
.hud-panel.collapsed h3::after { content: ' ▸'; }
.hud-panel.collapsed .bars { display: none; }
.bar-row { display: grid; grid-template-columns: 58px 1fr; gap: 6px; align-items: center; margin: 3px 0; }
.bar-row label { font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { height: 8px; border-radius: 4px; background: rgba(255,255,255,.12); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width .3s; }
.bar-fill.low { animation: hud-blink 1s infinite; }
@keyframes hud-blink { 50% { filter: brightness(1.7); } }

#time-bar { position: absolute; top: calc(8px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%);
  background: rgba(20,26,40,.82); border-radius: 999px; padding: 5px 8px; pointer-events: auto;
  display: flex; align-items: center; gap: 4px; color: #dfe6f2; backdrop-filter: blur(4px); }
#time-bar .clock { font-size: 14px; font-variant-numeric: tabular-nums; padding: 0 6px; min-width: 46px; text-align: center; }
#time-bar.paused .clock { color: #e0b05f; }
#time-bar button { border: 0; border-radius: 999px; width: 30px; height: 30px; font-size: 12px;
  background: transparent; color: #93a3c0; cursor: pointer; touch-action: manipulation; }
#time-bar button.active { background: rgba(90,120,190,.4); color: #eaf0fb; }

#action-menu { position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  background: rgba(20,26,40,.92); border-radius: 14px; padding: 10px 12px; pointer-events: auto;
  display: none; flex-direction: column; gap: 6px; min-width: 220px; max-width: 92vw;
  color: #dfe6f2; backdrop-filter: blur(6px); }
#action-menu.open { display: flex; }
#action-menu .am-title { font-size: 12px; color: #93a3c0; text-align: center; margin-bottom: 2px; }
#action-menu button { pointer-events: auto; border: 0; border-radius: 9px; padding: 10px 14px;
  font-size: 14px; background: #33406040; background: rgba(90,120,190,.28); color: #eaf0fb; cursor: pointer;
  touch-action: manipulation; }
#action-menu button:active { background: rgba(90,120,190,.55); }
#action-menu button.am-cancel { background: transparent; color: #93a3c0; padding: 6px; font-size: 12px; }

#activity-chip { position: absolute; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  background: rgba(20,26,40,.92); border-radius: 999px; padding: 8px 14px; color: #dfe6f2;
  font-size: 13px; display: none; align-items: center; gap: 10px; pointer-events: auto; }
#activity-chip.open { display: flex; }
#activity-chip button { border: 0; background: rgba(220,90,90,.35); color: #fbdada; border-radius: 999px;
  padding: 4px 10px; font-size: 12px; cursor: pointer; touch-action: manipulation; }

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
.quest-toast { background: rgba(20,26,40,.92); color: #eaf0fb; border-radius: 10px; padding: 8px 14px;
  font-size: 12px; box-shadow: 0 2px 10px rgba(0,0,0,.35); opacity: 0; transform: translateY(-6px);
  transition: opacity .25s, transform .25s; border-left: 3px solid #5a9fd6; max-width: 80vw; text-align: center; }
.quest-toast.show { opacity: 1; transform: translateY(0); }
.quest-toast.completed { border-left-color: #6fce7a; }

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
  #time-bar { top: calc(46px + env(safe-area-inset-top, 0px)); padding: 4px 6px; gap: 3px; }
  #time-bar button { width: 26px; height: 26px; }
  #time-bar .clock { min-width: 38px; font-size: 12px; padding: 0 4px; }
  #quest-toasts { top: calc(90px + env(safe-area-inset-top, 0px)); }
}

/* --- Buy/Sell mode (PROJECT_CONTEXT.md §7.6) ---------------------------------------------
   Layout budget on the bottom-right (§8 constraints): #devbar is a full-width strip at the very
   bottom; tools/nav.js's corner gear sits at right:8px, bottom:40px (~36px tall). #funds-chip and
   #buy-button stack ABOVE that, clear of both; #action-menu/#activity-chip stay bottom-center so
   there's no conflict there either. */
#funds-chip { position: absolute; right: calc(8px + env(safe-area-inset-right, 0px));
  bottom: calc(128px + env(safe-area-inset-bottom, 0px)); background: rgba(20,26,40,.82);
  border-radius: 999px; padding: 6px 12px; font-size: 12px; font-variant-numeric: tabular-nums;
  color: #e0c26f; pointer-events: none; }
#buy-button { position: absolute; right: calc(8px + env(safe-area-inset-right, 0px));
  bottom: calc(84px + env(safe-area-inset-bottom, 0px)); border: 0; border-radius: 999px;
  padding: 10px 16px; font-size: 13px; background: rgba(90,120,190,.55); color: #eaf0fb;
  cursor: pointer; pointer-events: auto; touch-action: manipulation; }
#funds-chip.hidden, #buy-button.hidden { display: none; }
.hud-panel.buy-mode-hidden { display: none; }

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

@media (max-width: 500px) {
  #funds-chip { bottom: calc(118px + env(safe-area-inset-bottom, 0px)); font-size: 11px; padding: 5px 10px; }
  #buy-button { bottom: calc(78px + env(safe-area-inset-bottom, 0px)); font-size: 12px; padding: 8px 12px; }
  .buy-card { width: 78px; }
}
`;

export class Hud {
  private needsPanel: HTMLElement;
  private skillsPanel: HTMLElement;
  private menu: HTMLElement;
  private chip: HTMLElement;
  private chipLabel: HTMLElement;
  private questPanel: HTMLElement;
  private questBody: HTMLElement;
  private questToasts: HTMLElement;
  private fills = new Map<string, HTMLElement>();

  // --- Buy/Sell mode (§7.6) ---
  private fundsChip: HTMLElement;
  private buyButton: HTMLElement;
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

  onCancelAction: (() => void) | null = null;
  /** fires whenever the action menu closes (pick, cancel, or tap-away) */
  onMenuHidden: (() => void) | null = null;

  /** Simulation speed multiplier: 0 (paused), 1, 2, or 3. */
  speed = 1;
  private lastRunningSpeed = 1;
  private timeBar!: HTMLElement;
  private clockEl!: HTMLElement;

  constructor(private stats: SimStats) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="hud-panel" id="needs-panel"><h3>Needs</h3><div class="bars"></div></div>
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
      <div id="quest-toasts"></div>
      <div id="funds-chip">§ 0</div>
      <button id="buy-button">🛒 Buy</button>
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
    this.skillsPanel = root.querySelector('#skills-panel')!;
    this.menu = root.querySelector('#action-menu')!;
    this.chip = root.querySelector('#activity-chip')!;
    this.chipLabel = root.querySelector('#activity-label')!;
    this.questPanel = root.querySelector('#quest-panel')!;
    this.questBody = root.querySelector('#quest-body')!;
    this.questToasts = root.querySelector('#quest-toasts')!;
    this.chip.querySelector('button')!.addEventListener('click', () => this.onCancelAction?.());

    // --- Buy/Sell mode wiring (§7.6) ---
    this.fundsChip = root.querySelector('#funds-chip')!;
    this.buyButton = root.querySelector('#buy-button')!;
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
    const build = (panel: HTMLElement, rows: { id: string; name: string; color: string }[], prefix: string) => {
      const bars = panel.querySelector('.bars')!;
      bars.innerHTML = '';
      for (const row of rows) {
        const el = document.createElement('div');
        el.className = 'bar-row';
        el.innerHTML = `<label>${row.name}</label><div class="bar-track"><div class="bar-fill" style="background:${row.color}"></div></div>`;
        bars.appendChild(el);
        this.fills.set(`${prefix}:${row.id}`, el.querySelector('.bar-fill')!);
      }
    };
    build(this.needsPanel, this.stats.needDefs, 'need');
    build(this.skillsPanel, this.stats.skillDefs, 'skill');
    this.refresh();
  }

  /** Update bar widths from current values. Call once per HUD tick (not per frame). */
  refresh() {
    for (const def of this.stats.needDefs) {
      const fill = this.fills.get(`need:${def.id}`);
      if (!fill) continue;
      const v = this.stats.needs.get(def.id) ?? 0;
      fill.style.width = `${v}%`;
      fill.classList.toggle('low', v < 20);
    }
    for (const def of this.stats.skillDefs) {
      const fill = this.fills.get(`skill:${def.id}`);
      if (!fill) continue;
      const v = this.stats.skills.get(def.id) ?? 0;
      fill.style.width = `${(v / (def.max || 100)) * 100}%`;
    }
  }

  setSpeed(s: number) {
    this.speed = s;
    if (s > 0) this.lastRunningSpeed = s;
    this.timeBar.classList.toggle('paused', s === 0);
    this.timeBar.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', Number(b.dataset.speed) === s),
    );
  }

  togglePause() { this.setSpeed(this.speed === 0 ? this.lastRunningSpeed : 0); }

  setClock(hours: number, minutes: number) {
    this.clockEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  /** Bottom-sheet contextual menu for a tapped object. */
  showActionMenu(asset: AssetDef, actions: ActionDef[], onPick: (a: ActionDef) => void) {
    this.hideActivity();
    this.menu.innerHTML = `<div class="am-title">${asset.name}</div>`;
    for (const action of actions) {
      const b = document.createElement('button');
      b.textContent = action.name;
      b.addEventListener('click', () => { this.hideActionMenu(); onPick(action); });
      this.menu.appendChild(b);
    }
    const cancel = document.createElement('button');
    cancel.className = 'am-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.hideActionMenu());
    this.menu.appendChild(cancel);
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
  showQuestToast(text: string, kind: 'started' | 'completed', durationMs: number) {
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
    this.buyBar.classList.toggle('open', active);
    if (active) {
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
