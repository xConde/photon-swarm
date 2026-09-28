// src/app/sections/pages/projects/lazy-projects/photon-swarm/components/controls-display/controls-display.component.ts

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  input,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ControlMapping,
  CooldownState,
  GameControlsService,
  PlayerActionState,
} from '../../core/controls/game-controls.service';

// Simplified control hint for modal/menu displays
export interface SimpleControl {
  key: string;
  action: string;
}

// Descriptive display modes that match actual usage
export type ControlsDisplayMode =
  | 'gameplay' // In-game with cooldowns, mouse controls, active states
  | 'pause-menu' // Pause menu controls
  | 'modal-hint' // Simple ESC hints for modals (shop, settings, etc.)
  | 'tutorial'; // Tutorial/intro controls (future)

export type DisplayPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Pre-computed per-key state for template binding (avoids function calls in change detection). */
export interface CachedControlState {
  isActive: boolean;
  isCooldown: boolean;
  pct: number;
}

/** Session-level flag: once controls have faded once, skip the 10s delay on subsequent games. */
const CONTROLS_SEEN_KEY = 'photon-swarm-controls-seen';

@Component({
  selector: 'app-controls-display',
  standalone: true,
  imports: [],
  templateUrl: './controls-display.component.html',
  styleUrls: ['./controls-display.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.faded]': 'isFaded()',
  },
})
export class ControlsDisplayComponent implements OnInit, OnDestroy {
  readonly controls = input<ControlMapping[] | SimpleControl[]>([]);
  readonly displayMode = input<ControlsDisplayMode>('gameplay');
  readonly position = input<DisplayPosition>('bottom-right');

  // Deprecated - will be removed, use displayMode instead
  readonly gameState = input<'game' | 'pause' | 'shop'>('game');

  /** Resolved display mode — reactive computed from signal inputs. */
  readonly resolvedDisplayMode = computed<ControlsDisplayMode>(() => {
    const mode = this.displayMode();
    return this.gameState() === 'pause' && mode === 'gameplay' ? 'pause-menu' : mode;
  });

  /** Resolved controls list — reactive computed from signal inputs + service fallback. */
  readonly resolvedControls = computed<ControlMapping[] | SimpleControl[]>(() => {
    const inputControls = this.controls();
    if (inputControls && inputControls.length > 0) {
      return inputControls;
    }
    const mode = this.resolvedDisplayMode();
    const state = mode === 'pause-menu' ? 'pause' : mode === 'gameplay' ? 'game' : this.gameState();
    return this.gameControls.getControlsForState(state);
  });

  /**
   * Cached per-key states (isActive, isCooldown, pct) for every resolved control key.
   * Eliminates repeated function calls in the template during each change detection cycle;
   * the template reads the Map once instead of calling methods per control per CD tick.
   */
  readonly cachedStates = signal<Map<string, CachedControlState>>(new Map());

  /** True when the controls panel should render at reduced (30%) opacity. */
  readonly isFaded = signal(false);

  /**
   * Display-keys currently mid press-flash. Layered on top of the sustained `.active` states so
   * EVERY control (including one-shot toggles like LMB that have no sustained state) visibly pops
   * the moment its key/button is pressed. Self-contained: driven by document key/mouse events, no
   * change to the game input pipeline.
   */
  readonly flashedKeys = signal<ReadonlySet<string>>(new Set());
  private readonly flashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly FLASH_MS = 260;

  private cooldowns: Map<string, CooldownState> = new Map();
  private playerState: PlayerActionState = {
    isMoving: false,
    isDashing: false,
    isTargeting: false,
    isCombat: false,
    mapOpened: false,
    dashCooldownPercent: 0,
  };

  private readonly destroyRef = inject(DestroyRef);
  private readonly gameControls = inject(GameControlsService);
  private fadeTimerId: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    // Subscribe to game state only for gameplay mode (needs live updates)
    if (this.resolvedDisplayMode() === 'gameplay') {
      this.gameControls
        .getCooldowns()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((cooldowns) => {
          this.cooldowns = cooldowns;
          this.rebuildCache();
        });

      this.gameControls
        .getPlayerActionState()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((state) => {
          this.playerState = state;
          this.rebuildCache();
        });

      // Auto-fade controls after 10 seconds of gameplay.
      // If controls were already seen this session, fade immediately (no delay).
      const alreadySeen = !!window.sessionStorage.getItem(CONTROLS_SEEN_KEY);
      if (alreadySeen) {
        this.isFaded.set(true);
      } else {
        this.fadeTimerId = setTimeout(() => {
          this.isFaded.set(true);
          try {
            window.sessionStorage.setItem(CONTROLS_SEEN_KEY, '1');
          } catch {
            // sessionStorage unavailable in private browsing — silently ignore
          }
        }, 10_000);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.fadeTimerId !== null) {
      clearTimeout(this.fadeTimerId);
    }
    for (const timer of this.flashTimers.values()) {
      clearTimeout(timer);
    }
    this.flashTimers.clear();
  }

  trackByControl(_index: number, control: ControlMapping | SimpleControl): string {
    return control.key;
  }

  // Helper to check if control has category (type guard)
  hasCategory(control: ControlMapping | SimpleControl): control is ControlMapping {
    return 'category' in control;
  }

  // ---------------------------------------------------------------------------
  // Press-flash — immediate "you pressed this" feedback on every control chip
  // ---------------------------------------------------------------------------

  /** True while the given display-key is mid press-flash (read by the template). */
  isFlashing(key: string): boolean {
    return this.flashedKeys().has(key);
  }

  @HostListener('document:keydown', ['$event'])
  onAnyKeyDown(event: KeyboardEvent): void {
    if (this.resolvedDisplayMode() !== 'gameplay') return;
    const pressed = this.normalizeKey(event);
    for (const ctl of this.resolvedControls()) {
      // ctl.key is the displayed key ("E", "SPACE", "W/A/S/D", …); split handles the combo row.
      if (ctl.key.split('/').includes(pressed)) {
        this.flash(ctl.key);
      }
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onAnyMouseDown(event: MouseEvent): void {
    if (this.resolvedDisplayMode() !== 'gameplay') return;
    if (event.button === 0) this.flash('LMB');
    else if (event.button === 2) this.flash('RMB');
  }

  /** Maps a physical key event to the legend's displayed key token. */
  private normalizeKey(event: KeyboardEvent): string {
    switch (event.key) {
      case ' ':
        return 'SPACE';
      case 'Shift':
        return 'SHIFT';
      case 'Escape':
        return 'ESC';
      default:
        return event.key.length === 1 ? event.key.toUpperCase() : event.key;
    }
  }

  private flash(key: string): void {
    const next = new Set(this.flashedKeys());
    next.add(key);
    this.flashedKeys.set(next);

    const existing = this.flashTimers.get(key);
    if (existing) clearTimeout(existing);
    this.flashTimers.set(
      key,
      setTimeout(() => {
        const cleared = new Set(this.flashedKeys());
        cleared.delete(key);
        this.flashedKeys.set(cleared);
        this.flashTimers.delete(key);
      }, ControlsDisplayComponent.FLASH_MS)
    );
  }

  // ---------------------------------------------------------------------------
  // Cache rebuild -- runs on every cooldown / player-state emission
  // ---------------------------------------------------------------------------

  /**
   * Recomputes `cachedStates` from the current cooldowns and player action state.
   * Iterates over `resolvedControls()` so newly-added controls are automatically included.
   * Called on every cooldown or player-state Observable emission.
   */
  private rebuildCache(): void {
    const next = new Map<string, CachedControlState>();

    // Derive keys from actual resolved controls — never hardcode.
    // This ensures any future control added to GameControlsService
    // automatically gets cached state in the template.
    for (const ctl of this.resolvedControls()) {
      next.set(ctl.key, {
        isActive: this.computeIsActive(ctl.key),
        isCooldown: this.computeIsCooldown(ctl.key),
        pct: this.computePct(ctl.key),
      });
    }

    this.cachedStates.set(next);
  }

  private computeIsCooldown(key: string): boolean {
    const cooldown = this.cooldowns.get(this.getCooldownKey(key));
    return cooldown ? !cooldown.isReady : false;
  }

  private computeIsActive(key: string): boolean {
    switch (key) {
      case 'W/A/S/D':
        return this.playerState.isMoving;
      case 'L-CLICK':
        // Left-click toggles weapon mode; isTargeting tracks that state. (Was wrongly reading
        // isFlightMode — the SHIFT focus-fire flag — so LMB lit on the wrong action.)
        return this.playerState.isTargeting;
      case 'R-CLICK':
        return this.playerState.isChargingDischarge || false;
      case 'SPACE':
        return this.playerState.isDashing;
      case 'SHIFT':
        // Focus Fire is a toggle; isFlightMode mirrors it (the chip stays lit while it's on).
        return this.playerState.isFlightMode || false;
      case 'E':
        return this.playerState.isParrying || false;
      case 'M':
        return this.playerState.mapOpened;
      default:
        return false;
    }
  }

  private computePct(key: string): number {
    const cooldownKey = this.getCooldownKey(key);
    const cooldown = this.cooldowns.get(cooldownKey);
    return cooldown?.percent || 0;
  }

  private getCooldownKey(key: string): string {
    switch (key) {
      case 'L-CLICK':
        return 'TARGET';
      case 'R-CLICK':
        return 'DISCHARGE';
      case 'SPACE':
        return 'DASH';
      case 'SHIFT':
        return 'FLIGHT_MODE';
      case 'E':
        return 'PARRY';
      default:
        return key;
    }
  }
}
