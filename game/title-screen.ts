// title-screen.ts — reusable DOM title/options surface; all decisions stay in title.ts.
import type { TitleConfig, TitleOptionDef } from './data';
import { deleteDecision, loadDecision, type SlotCardView } from './saveslots';
import { applyVolumes, PreferencesStore, resolveMenu, resolveOptions, type TitlePreferences, type VolumeAudioTarget } from './title';

export interface TitleScreenActions {
  onNew(): void;
  onLoad(slotId: string): void;
  onDelete?(slotId: string): void;
  onExport?(slotId: string): void;
  onImport?(slotId: string, jsonText: string): void;
}

export interface TitleSlotSource { views(): SlotCardView[]; }

export class OptionsPanel {
  private prefs: TitlePreferences;
  constructor(
    private readonly root: HTMLElement,
    private readonly definitions: readonly TitleOptionDef[],
    private readonly store: PreferencesStore,
    private readonly audio: VolumeAudioTarget,
    private readonly onBack: () => void,
  ) { this.prefs = store.read(definitions); }

  render(): void {
    this.root.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = 'Options';
    const fields = document.createElement('div'); fields.className = 'title-options-fields';
    for (const option of resolveOptions(this.definitions, this.prefs)) {
      const row = document.createElement('label'); row.className = 'title-option';
      const label = document.createElement('span'); label.textContent = option.label;
      const input = document.createElement('input'); input.id = `title-option-${option.id}`;
      if (option.type === 'slider') {
        input.type = 'range'; input.min = String(option.min ?? 0); input.max = String(option.max ?? 1);
        input.step = String(option.step ?? 0.05); input.value = String(option.value);
      } else { input.type = 'checkbox'; input.checked = Boolean(option.value); }
      input.addEventListener('input', () => {
        this.prefs[option.id] = option.type === 'toggle' ? input.checked : input.valueAsNumber;
        this.prefs = this.store.write(this.definitions, this.prefs);
        applyVolumes(this.prefs, this.audio);
      });
      row.append(label, input); fields.appendChild(row);
    }
    const back = document.createElement('button'); back.type = 'button'; back.className = 'title-menu-button';
    back.textContent = 'Back'; back.addEventListener('click', this.onBack);
    this.root.append(heading, fields, back);
  }
}

export class TitleScreen {
  private readonly menu: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly optionsPanel: OptionsPanel;
  private hasSaves: boolean;

  constructor(
    private readonly root: HTMLElement,
    private readonly config: TitleConfig,
    hasSaves: boolean,
    store: PreferencesStore,
    audio: VolumeAudioTarget,
    private readonly actions: TitleScreenActions,
    private readonly slots?: TitleSlotSource,
  ) {
    this.menu = root.querySelector<HTMLElement>('#title-menu')!;
    this.panel = root.querySelector<HTMLElement>('#title-panel')!;
    this.hint = root.querySelector<HTMLElement>('#title-hint')!;
    this.optionsPanel = new OptionsPanel(this.panel, config.options, store, audio, () => this.showMenu());
    // T3 keeps Load available when slots are empty so file import is still reachable.
    this.hasSaves = slots ? true : hasSaves;
    this.paintIdentity();
    this.renderMenu(this.hasSaves);
  }

  private paintIdentity(): void {
    const text = this.root.querySelector<HTMLElement>('#title-logo-text')!;
    const image = this.root.querySelector<HTMLImageElement>('#title-logo-image')!;
    text.textContent = this.config.logoText?.trim() || 'Condo Life';
    image.hidden = !this.config.logoImage;
    if (this.config.logoImage) image.src = this.config.logoImage;
    this.root.style.backgroundImage = this.config.background ? `url(${JSON.stringify(this.config.background)})` : '';
    const credits = this.root.querySelector<HTMLElement>('#title-credits')!;
    credits.textContent = this.config.credits?.trim() || 'A life simulation';
  }

  private renderMenu(hasSaves: boolean): void {
    this.menu.replaceChildren();
    for (const entry of resolveMenu(this.config, { hasSaves })) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'title-menu-button';
      button.dataset.menuId = entry.id; button.textContent = entry.label; button.disabled = !entry.enabled;
      if (entry.disabledReason) { button.title = entry.disabledReason; button.setAttribute('aria-describedby', 'title-hint'); }
      button.addEventListener('click', () => {
        if (entry.id === 'new') this.actions.onNew();
        else if (entry.id === 'load') this.slots ? this.showLoadSlots() : this.actions.onLoad('');
        else if (entry.id === 'options') this.showOptions();
      });
      button.addEventListener('focus', () => { this.hint.textContent = entry.disabledReason ?? ''; });
      this.menu.appendChild(button);
    }
  }

  showOptions(): void { this.menu.hidden = true; this.hint.textContent = ''; this.panel.hidden = false; this.optionsPanel.render(); }
  private showConfirm(message: string, confirmLabel: string, action: () => void): void {
    this.panel.querySelector('.save-confirm')?.remove();
    const dialog = document.createElement('div'); dialog.className = 'save-confirm title-save-confirm'; dialog.setAttribute('role', 'alertdialog');
    const text = document.createElement('div'); text.textContent = message;
    const row = document.createElement('div'); row.className = 'save-confirm-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.className = 'title-menu-button';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = confirmLabel; confirm.className = 'title-menu-button';
    cancel.addEventListener('click', () => dialog.remove()); confirm.addEventListener('click', () => { dialog.remove(); action(); });
    row.append(cancel, confirm); dialog.append(text, row); this.panel.appendChild(dialog); confirm.focus();
  }

  showLoadSlots(): void {
    if (!this.slots) return;
    this.menu.hidden = true; this.hint.textContent = ''; this.panel.hidden = false; this.panel.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = 'Load Game'; this.panel.appendChild(heading);
    const cards = this.slots.views();
    const list = document.createElement('div'); list.className = 'title-save-list';
    for (const view of cards) {
      const card = document.createElement('article'); card.className = 'title-save-card'; card.dataset.slotId = view.slotId;
      const top = document.createElement('div'); top.className = 'title-save-head';
      const name = document.createElement('strong'); name.textContent = view.name;
      const state = document.createElement('span'); state.textContent = view.kind === 'autosave' ? 'Autosave' : view.status;
      top.append(name, state);
      const meta = document.createElement('div'); meta.className = 'title-save-meta';
      meta.textContent = view.status === 'ok'
        ? `${view.savedAtLabel} · ${view.mapName} · ${view.funds === null ? '—' : `§${view.funds.toLocaleString()}`} · ${view.gameClockLabel}`
        : view.status === 'corrupt' ? `Corrupt save${view.error ? ` · ${view.error}` : ''}` : 'Empty slot';
      const actions = document.createElement('div'); actions.className = 'title-save-actions';
      const button = (label: string, enabled: boolean, run: () => void) => {
        const control = document.createElement('button'); control.type = 'button'; control.className = 'title-menu-button'; control.textContent = label; control.disabled = !enabled; control.addEventListener('click', run); actions.appendChild(control);
      };
      button('Load', loadDecision(view, false) === 'proceed', () => this.actions.onLoad(view.slotId));
      button('Delete', deleteDecision(view) !== 'blocked', () => this.showConfirm(`Delete “${view.name}”?`, 'Delete', () => { this.actions.onDelete?.(view.slotId); this.showLoadSlots(); }));
      button('Export', view.status === 'ok', () => this.actions.onExport?.(view.slotId));
      card.append(top, meta, actions); list.appendChild(card);
    }
    this.panel.appendChild(list);
    const manual = cards.filter((card) => card.kind === 'manual');
    if (manual.length > 0) {
      const importRow = document.createElement('div'); importRow.className = 'title-save-import';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Import target slot');
      for (const view of manual) { const option = document.createElement('option'); option.value = view.slotId; option.textContent = view.name; select.appendChild(option); }
      const label = document.createElement('label'); label.className = 'title-menu-button'; label.textContent = 'Import file';
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        const file = input.files?.[0]; if (!file) return;
        void file.text().then((json) => {
          const target = manual.find((view) => view.slotId === select.value)!;
          const proceed = () => { this.actions.onImport?.(target.slotId, json); this.showLoadSlots(); };
          if (target.status === 'empty') proceed(); else this.showConfirm(`Replace “${target.name}” with the imported save?`, 'Import', proceed);
        });
      });
      label.appendChild(input); importRow.append(select, label); this.panel.appendChild(importRow);
    }
    const back = document.createElement('button'); back.type = 'button'; back.className = 'title-menu-button'; back.textContent = 'Back to menu'; back.addEventListener('click', () => this.showMenu()); this.panel.appendChild(back);
  }

  showMenu(): void {
    if (this.slots) {
      this.hasSaves = true;
      this.renderMenu(this.hasSaves);
    }
    this.panel.hidden = true; this.menu.hidden = false; this.menu.querySelector<HTMLButtonElement>('button')?.focus();
  }
  show(): void { this.root.hidden = false; this.showMenu(); }
  hide(): void { this.root.hidden = true; }
}
