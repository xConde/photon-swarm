import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ControlsDisplayComponent } from '@photon/components/controls-display/controls-display.component';
import { COLORBLIND_MODES, ColorblindMode, GameSettings, SettingsService } from '../../core/utils/settings.service';
import { AudioService } from '../../core/audio/audio.service';
import { ThemeService } from '@services/theme.service';
import {
  ACTION_LABELS,
  BindableAction,
  KeyBindingService,
  KeyBindingsMap,
} from '../../core/controls/key-binding.service';

interface KeyBindingRow {
  action: BindableAction;
  label: string;
  key: string;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, ControlsDisplayComponent],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly isVisible = input(false);
  readonly close = output<void>();
  @ViewChild('firstControl') firstControl?: ElementRef<HTMLElement>;

  readonly settings = signal<GameSettings>(this.settingsService.getSettings());
  private readonly destroyRef = inject(DestroyRef);
  private readonly themeService = inject(ThemeService);

  readonly audioMuted = signal(false);
  readonly isDayMode = signal(this.themeService.isDayMode);

  // Key binding state
  readonly keyBindingRows = signal<KeyBindingRow[]>([]);
  readonly rebindingAction = signal<BindableAction | null>(null);
  readonly conflictWarning = signal<string>('');

  // Focus management (mirrors upgrade-modal pattern)
  private previouslyFocusedElement: HTMLElement | null = null;
  private tabTrapHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(
    private elementRef: ElementRef<HTMLElement>,
    private settingsService: SettingsService,
    private audioService: AudioService,
    private keyBindingService: KeyBindingService
  ) {
    this.audioMuted.set(this.audioService.isMuted());
    // Auto-focus first visible control when modal becomes visible.
    // Falls back to the container when the primary control is hidden (e.g. on mobile,
    // the mouse-sensitivity slider is display:none via @media (pointer: coarse)).
    effect((onCleanup) => {
      if (this.isVisible()) {
        const timeoutId = setTimeout(() => {
          const element = this.firstControl?.nativeElement;
          if (element && typeof element.focus === 'function' && element.offsetParent !== null) {
            element.focus();
          } else {
            // First control is hidden (mobile) — focus the container so screen readers
            // announce the dialog role, and focus is contained within the overlay.
            const container = this.elementRef.nativeElement.querySelector<HTMLElement>('.settings-container');
            if (container) {
              container.setAttribute('tabindex', '-1');
              container.focus();
            }
          }
        }, 100);
        onCleanup(() => clearTimeout(timeoutId));
      }
    });
  }

  ngAfterViewInit(): void {
    // Save element to restore focus to when settings close
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    // Tab focus trap — keeps keyboard navigation inside the settings dialog
    this.tabTrapHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !this.isVisible()) return;

      const container = this.elementRef.nativeElement;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', this.tabTrapHandler);
  }

  ngOnDestroy(): void {
    if (this.tabTrapHandler) {
      document.removeEventListener('keydown', this.tabTrapHandler);
      this.tabTrapHandler = null;
    }
    if (this.previouslyFocusedElement?.isConnected && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }

  ngOnInit(): void {
    this.themeService.isDayMode$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((dayMode) => {
      this.isDayMode.set(dayMode);
    });
    this.settingsService.settings$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      this.settings.set(s);
      this.audioMuted.set(s.muted ?? this.audioService.isMuted());
    });

    // Sync key binding rows from service
    this.keyBindingService.bindings$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((bindings) => {
      this.keyBindingRows.set(this.buildBindingRows(bindings));
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // If we are in rebind mode, capture the key
    const action = this.rebindingAction();
    if (action) {
      event.preventDefault();
      event.stopPropagation();

      const key = event.key;

      // ESC cancels rebind mode
      if (key === 'Escape') {
        this.rebindingAction.set(null);
        this.conflictWarning.set('');
        return;
      }

      const result = this.keyBindingService.setKey(action, key);
      if (result.success) {
        this.rebindingAction.set(null);
        this.conflictWarning.set('');
      } else if (result.conflictAction) {
        const conflictLabel = ACTION_LABELS[result.conflictAction];
        this.conflictWarning.set(`"${KeyBindingService.getKeyDisplayName(key)}" is already bound to ${conflictLabel}`);
      }
      return;
    }

    // Normal escape handling (not rebinding)
    if (event.key === 'Escape' && this.isVisible()) {
      event.preventDefault();
      event.stopPropagation();
      this.closeModal();
    }
  }

  startRebind(action: BindableAction): void {
    this.rebindingAction.set(action);
    this.conflictWarning.set('');
  }

  getKeyDisplayName(key: string): string {
    return KeyBindingService.getKeyDisplayName(key);
  }

  resetKeyBindings(): void {
    this.keyBindingService.resetDefaults();
    this.conflictWarning.set('');
    this.rebindingAction.set(null);
  }

  updateVolume(volume: number): void {
    this.updateAndPersist((settings) => ({ ...settings, volume: Math.round(volume) }));
  }

  updateSensitivity(sensitivity: number): void {
    this.updateAndPersist((settings) => ({ ...settings, sensitivity: Math.round(sensitivity) }));
  }

  toggleScreenShake(): void {
    this.updateAndPersist((settings) => ({ ...settings, screenShake: !settings.screenShake }));
  }

  toggleShowDamageNumbers(): void {
    this.updateAndPersist((settings) => ({ ...settings, showDamageNumbers: !settings.showDamageNumbers }));
  }

  toggleChromaticAberration(): void {
    this.updateAndPersist((settings) => ({ ...settings, chromaticAberration: !settings.chromaticAberration }));
  }

  toggleLowHealthVignette(): void {
    this.updateAndPersist((settings) => ({ ...settings, lowHealthVignette: !settings.lowHealthVignette }));
  }

  toggleInvertAimY(): void {
    this.updateAndPersist((settings) => ({ ...settings, invertAimY: !settings.invertAimY }));
  }

  /**
   * Set the active colorblind palette mode. Validated against the
   * canonical enum in SettingsService — unknown values are dropped at
   * the service layer, so the component never has to defend against
   * stray DOM events.
   */
  updateColorblindMode(mode: ColorblindMode): void {
    this.updateAndPersist((settings) => ({ ...settings, colorblindMode: mode }));
  }

  onVolumeInput(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.updateVolume(input.valueAsNumber);
  }

  onSensitivityInput(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.updateSensitivity(input.valueAsNumber);
  }

  onThemeChange(event: Event): void {
    const select = event.target;
    if (select instanceof HTMLSelectElement) this.themeService.setDayMode(select.value === 'light');
  }

  onColorblindModeChange(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const mode = COLORBLIND_MODES.find((candidate) => candidate === select.value);
    if (mode) this.updateColorblindMode(mode);
  }

  toggleAudioMute(): void {
    this.audioService.toggleMute();
    const muted = this.audioService.isMuted();
    this.audioMuted.set(muted);
    this.updateAndPersist((settings) => ({ ...settings, muted }));
  }

  resetToDefaults(): void {
    this.settingsService.resetToDefaults();
    this.keyBindingService.resetDefaults();
    this.themeService.setDayMode(false);
  }

  closeModal(): void {
    this.rebindingAction.set(null);
    this.conflictWarning.set('');
    this.close.emit();
  }

  closeSettings(): void {
    this.closeModal();
  }

  private buildBindingRows(bindings: KeyBindingsMap): KeyBindingRow[] {
    return (Object.keys(bindings) as BindableAction[]).map((action) => ({
      action,
      label: ACTION_LABELS[action],
      key: bindings[action],
    }));
  }

  private updateAndPersist(update: (settings: GameSettings) => GameSettings): void {
    const updated = update(this.settings());
    this.settings.set(updated);
    this.settingsService.updateSettings(updated);
  }
}
