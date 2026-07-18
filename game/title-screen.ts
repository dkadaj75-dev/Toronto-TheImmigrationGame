// title-screen.ts — reusable DOM title/options surface; all decisions stay in title.ts.
import type { TitleConfig, TitleOptionDef } from './data';
import { applyVolumes, PreferencesStore, resolveMenu, resolveOptions, type TitlePreferences, type VolumeAudioTarget } from './title';

export interface TitleScreenActions { onNew(): void; onLoad(): void; }

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

  constructor(
    private readonly root: HTMLElement,
    private readonly config: TitleConfig,
    hasSaves: boolean,
    store: PreferencesStore,
    audio: VolumeAudioTarget,
    private readonly actions: TitleScreenActions,
  ) {
    this.menu = root.querySelector<HTMLElement>('#title-menu')!;
    this.panel = root.querySelector<HTMLElement>('#title-panel')!;
    this.hint = root.querySelector<HTMLElement>('#title-hint')!;
    this.optionsPanel = new OptionsPanel(this.panel, config.options, store, audio, () => this.showMenu());
    this.paintIdentity();
    this.renderMenu(hasSaves);
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
        else if (entry.id === 'load') this.actions.onLoad();
        else if (entry.id === 'options') this.showOptions();
      });
      button.addEventListener('focus', () => { this.hint.textContent = entry.disabledReason ?? ''; });
      this.menu.appendChild(button);
    }
  }

  showOptions(): void { this.menu.hidden = true; this.hint.textContent = ''; this.panel.hidden = false; this.optionsPanel.render(); }
  showMenu(): void { this.panel.hidden = true; this.menu.hidden = false; this.menu.querySelector<HTMLButtonElement>('button')?.focus(); }
  show(): void { this.root.hidden = false; this.showMenu(); }
  hide(): void { this.root.hidden = true; }
}
