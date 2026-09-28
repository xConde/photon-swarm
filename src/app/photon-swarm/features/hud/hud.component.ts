import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  effect,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FactionStandingBarComponent } from './faction-standing-bar/faction-standing-bar.component';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { UIStateService } from '../../core/state/ui-state.service';
import { SettingsService } from '../../core/utils/settings.service';
import {
  ActiveBuff,
  BuffManagementSystemService,
  PlayerUIData,
  UIQuerySystemService,
} from '../../core/systems/gameplay';
import { GameState } from '../../core/models/game-state.model';
import { EncounterProgress, WaveType } from '../../core/models/encounter.model';
import { PerformanceMonitorService } from '../../core/utils/performance-monitor.service';
import { SpawnSystemService } from '../../core/systems/enemy-ai';
import { PLAYER_CONFIG } from '@photon/config/game-constants';
import { PaletteService } from '../../services/palette.service';
import { BUFF_COLORS, BUFF_DISPLAY_NAMES } from '@photon/config/constants/player/buff-display.config';
import { ConsumableItem, ConsumableService } from '../../services/consumable.service';
import { DifficultyMode, DifficultyService } from '../../services/difficulty.service';
import { AscensionService } from '../../services/ascension.service';
import { AriaAnnouncementService } from '../../services/aria-announcement.service';
import { PlayerService } from '../../core/player/player.service';
import { getControlIcon } from '../../utils/control-icons';

/**
 * HUD Component - Manages game UI overlays and notifications
 * Displays player stats, kill streaks, and various game progression panels
 *
 * PERFORMANCE: Uses OnPush change detection for optimal performance in 60fps game loop
 */
@Component({
  selector: 'app-hud',
  standalone: true,
  imports: [CommonModule, FactionStandingBarComponent],
  templateUrl: './hud.component.html',
  styleUrls: ['./hud.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HudComponent implements OnInit, OnDestroy {
  gameState: GameState | null = null;

  // ECS data
  playerStats: PlayerUIData | null = null;

  private readonly destroyRef = inject(DestroyRef);

  // Power indicator state - now handled by PowerTransitionService

  // Performance metrics
  currentFPS = 0;
  private fpsUpdateInterval: number | null = null;

  // Wave system state
  currentWave = 0;
  currentWaveType: WaveType = 'normal';
  encounterProgress: EncounterProgress | null = null;

  // Consumable hotbar
  quickSlots: ReadonlyArray<Readonly<ConsumableItem>> = [];
  activeBuffs: { name: string; remainingSeconds: number; color: string }[] = [];
  isFocusFiring = false;
  focusFireSpeedPenalty = 20;
  readonly focusFireDmgBonus = Math.round((PLAYER_CONFIG.FOCUS_FIRE.DAMAGE_MULTIPLIER - 1) * 100);
  readonly focusFireRofPenalty = Math.round((1 - PLAYER_CONFIG.FOCUS_FIRE.FIRE_RATE_MULTIPLIER) * 100);
  private buffUpdateInterval: number | null = null;

  private readonly buffDisplayNames = BUFF_DISPLAY_NAMES;
  private readonly buffColors = BUFF_COLORS;

  /** Tracks whether low-health has already been announced to avoid repeated SR noise. */
  private lowHealthAnnounced = false;

  /** Memoized result of getHudClasses(). Invalidated when any input changes. */
  private _hudClassesCache: string | null = null;
  private _hudClassesLastWidth = -1;
  private _hudClassesLastMinimap = '';
  private _hudClassesLastFullMap = false;

  /**
   * Pre-sanitized SVG icons for the desktop ability-cooldown row.
   * Built once (icons are static) so OnPush CD never re-sanitizes per frame.
   */
  readonly abilityIcons: Record<'dash' | 'parry', SafeHtml>;

  /**
   * Mirrors GameSettings.muted (via SettingsService.settings$) — the same flag the
   * pause-menu Settings dialog reads and writes (settings.component.ts
   * toggleAudioMute()). That dialog also calls AudioService.toggleMute() directly
   * before persisting through SettingsService; this HUD control only ever writes
   * through SettingsService. Both paths converge on the same GameSettings.muted
   * value, and AudioService's own settings$ subscription is what actually applies
   * the gain change, so the two controls can't end up showing different states.
   */
  readonly audioMuted = signal(false);

  constructor(
    private gameEngine: GameEngineService,
    private uiState: UIStateService,
    private uiQuery: UIQuerySystemService,
    private performanceMonitor: PerformanceMonitorService,
    private spawnSystem: SpawnSystemService,
    private cdr: ChangeDetectorRef,
    private consumableService: ConsumableService,
    private buffSystem: BuffManagementSystemService,
    private difficultyService: DifficultyService,
    private ascensionService: AscensionService,
    private paletteService: PaletteService,
    private ngZone: NgZone,
    private ariaAnnouncement: AriaAnnouncementService,
    private playerService: PlayerService,
    private sanitizer: DomSanitizer,
    private settingsService: SettingsService
  ) {
    this.abilityIcons = {
      dash: this.sanitizer.bypassSecurityTrustHtml(getControlIcon('dash')),
      parry: this.sanitizer.bypassSecurityTrustHtml(getControlIcon('parry')),
    };
    // Signal-based state read (Sprint A8a) — replaces the legacy
    // gameEngine.state$ subscription. effect() must run in an injection
    // context (constructor / field initializer), not in ngOnInit, so
    // this is intentionally outside the rest of the setup flow.
    effect(() => {
      const state = this.gameEngine.state();
      if (state) {
        this.gameState = state;
        this.cdr.markForCheck();
      }
    });
  }

  /** Player's persistent ascension level. Stays constant during a run. */
  get ascensionLevel(): number {
    return this.ascensionService.getAscensionLevel();
  }

  /**
   * Dash cooldown fraction (1 → just used, 0 → ready).
   * Re-evaluated every CD pass via the state-signal effect (markForCheck each frame).
   */
  get dashCooldownFraction(): number {
    return this.playerService.getDashCooldownFraction();
  }

  /**
   * Parry cooldown fraction (1 → just used, 0 → ready).
   * Re-evaluated every CD pass via the state-signal effect (markForCheck each frame).
   */
  get parryCooldownFraction(): number {
    return this.playerService.getParryCooldownFraction();
  }

  get difficultyMode(): DifficultyMode {
    return this.difficultyService.getDifficulty();
  }

  get difficultyLabel(): string {
    const mode = this.difficultyMode;
    return mode === 'hard' ? 'HARD' : mode === 'extreme' ? 'EXTREME' : '';
  }

  get difficultyColor(): string {
    const mode = this.difficultyMode;
    // Use CSS custom property references so theming is automatic.
    // Literal fallbacks ensure the badge is visible even in shallow Angular scopes
    // where :root tokens may not have propagated.
    if (mode === 'extreme') return 'var(--game-danger, #ff3366)';
    if (mode === 'hard') return 'var(--game-warning, #ffcc00)';
    return '';
  }

  ngOnInit(): void {
    // Mirror the muted flag from SettingsService — the single source of truth also
    // read/written by the pause-menu Settings dialog — so the HUD toggle and the
    // Settings toggle can never drift apart.
    this.settingsService.settings$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      this.audioMuted.set(s.muted ?? false);
    });

    // Start polling for ECS data
    this.uiQuery.startPolling(100);

    // Subscribe to ECS player stats
    this.uiQuery.playerStats$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((stats) => {
      if (stats) {
        this.playerStats = stats;
        this.cdr.markForCheck();
        // Announce low-health warning to SR users once per wave when health drops below 25%.
        // Re-armed on each new wave (see waveStarted$ subscription).
        const pct = stats.healthPercentage ?? 0;
        if (pct < 25 && !this.lowHealthAnnounced) {
          this.lowHealthAnnounced = true;
          this.ariaAnnouncement.announce('Warning: low health.');
        } else if (pct >= 25) {
          // Reset so the warning fires again if health recovers and then drops again.
          this.lowHealthAnnounced = false;
        }
      }
    });

    // Subscribe to wave system
    this.spawnSystem.waveStarted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((waveEvent) => {
      this.currentWave = waveEvent.waveNumber;
      this.currentWaveType = waveEvent.waveType;
      this.cdr.markForCheck();
      // SR announcement — reset low-health flag at wave start so the warning
      // fires again if the player re-enters low health in the new wave.
      this.lowHealthAnnounced = false;
      const typeSuffix = waveEvent.waveType !== 'normal' ? `: ${waveEvent.waveType.replace(/_/g, ' ')}` : '';
      this.ariaAnnouncement.announce(
        `Wave ${waveEvent.waveNumber}${typeSuffix}. ${waveEvent.encounterTitle}. ${waveEvent.objective}`
      );
    });

    const encounterProgress$ = this.spawnSystem.encounterObjectives?.progress$;
    if (encounterProgress$) {
      encounterProgress$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((progress) => {
        this.encounterProgress = progress;
        this.cdr.markForCheck();
      });
    }

    // Subscribe to consumable inventory changes
    this.consumableService.inventory$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.quickSlots = this.consumableService.getQuickSlots();
      this.cdr.markForCheck();
    });

    // Poll active buffs periodically (every 500ms) for the buff indicator display
    // Run outside Angular zone to prevent triggering full change detection tree on every tick
    this.ngZone.runOutsideAngular(() => {
      this.buffUpdateInterval = window.setInterval(() => {
        if (!this.gameEngine || !this.gameEngine.isGameActive()) return;
        this.updateActiveBuffs();
      }, 500);
    });

    // Start FPS updates
    this.startFPSUpdates();
  }

  ngOnDestroy(): void {
    // Clear intervals first to prevent callbacks firing during teardown
    this.stopFPSUpdates();

    if (this.buffUpdateInterval !== null) {
      window.clearInterval(this.buffUpdateInterval);
      this.buffUpdateInterval = null;
    }

    this.uiQuery.stopPolling();
  }

  get encounterProgressPercent(): number {
    if (!this.encounterProgress || this.encounterProgress.target <= 0) return 0;
    return Math.max(0, Math.min(100, (this.encounterProgress.current / this.encounterProgress.target) * 100));
  }

  get encounterCounter(): string {
    if (!this.encounterProgress) return '';
    if (this.encounterProgress.objective === 'survive') {
      return `${Math.ceil(this.encounterProgress.remainingMs / 1000)}s`;
    }
    return `${this.encounterProgress.current}/${this.encounterProgress.target}`;
  }

  /**
   * Get CSS classes for HUD collision detection.
   * Adjusts layout based on minimap position and full map state.
   *
   * Memoized: the array allocation + join happen on every CD pass (~60fps) but
   * the three inputs (innerWidth, minimap position, full-map flag) rarely change.
   * Cache is invalidated when any of the three inputs change; on the next CD pass
   * after a resize or state change the fresh value is picked up automatically.
   */
  getHudClasses(): string {
    const currentWidth = window.innerWidth;
    const currentMinimap = this.uiState.miniMapPosition();
    const currentFullMap = this.uiState.fullMapEnabled();

    if (
      this._hudClassesCache !== null &&
      currentWidth === this._hudClassesLastWidth &&
      currentMinimap === this._hudClassesLastMinimap &&
      currentFullMap === this._hudClassesLastFullMap
    ) {
      return this._hudClassesCache;
    }

    this._hudClassesLastWidth = currentWidth;
    this._hudClassesLastMinimap = currentMinimap;
    this._hudClassesLastFullMap = currentFullMap;

    const classes: string[] = [];

    // Check minimap position
    if (currentMinimap === 'bottom-left') {
      classes.push('minimap-bottom-left');
    }

    // Check if full map is open
    if (currentFullMap) {
      classes.push('full-map-open');
    }

    // Add compact mobile mode for very small screens
    if (currentWidth < 400) {
      // 25rem in pixels
      classes.push('compact-mobile');
    }

    this._hudClassesCache = classes.join(' ');
    return this._hudClassesCache;
  }

  // Getters for template to use ECS data with fallback to legacy
  get health(): number {
    return this.playerStats?.health ?? this.gameState?.health ?? 0;
  }

  get healthPercentage(): number {
    return (
      this.playerStats?.healthPercentage ??
      (this.gameState ? (this.gameState.health / this.gameState.maxHealth) * 100 : 0)
    );
  }

  get shards(): number {
    return this.playerStats?.shards ?? this.gameState?.shards ?? 0;
  }

  /**
   * Start FPS counter updates
   */
  private startFPSUpdates(): void {
    // Update FPS every 500ms
    // Run outside Angular zone to prevent triggering full change detection tree on every tick
    this.ngZone.runOutsideAngular(() => {
      this.fpsUpdateInterval = window.setInterval(() => {
        if (!this.gameEngine || !this.gameEngine.isGameActive()) return;
        const performanceData = this.performanceMonitor.getPerformanceSummary();
        const newFPS = performanceData.averageFps;

        // Only trigger CD when the FPS display visibility changes (crosses 30fps threshold)
        // or when it's already visible (<30) and the value changed. Skips CD on every
        // tick when FPS is healthy (>=30) since the counter is hidden.
        const wasVisible = this.currentFPS > 0 && this.currentFPS < 30;
        const willBeVisible = newFPS > 0 && newFPS < 30;

        this.currentFPS = newFPS;

        if (wasVisible || willBeVisible) {
          this.cdr.detectChanges();
        }
      }, 500);
    });
  }

  /**
   * Stop FPS counter updates
   */
  private stopFPSUpdates(): void {
    if (this.fpsUpdateInterval !== null) {
      window.clearInterval(this.fpsUpdateInterval);
      this.fpsUpdateInterval = null;
    }
  }

  /**
   * Get FPS display color based on performance
   */
  getFPSColor(): string {
    const colors = this.paletteService.getCanvas();
    if (this.currentFPS >= 60) return colors.FPS_GOOD;
    if (this.currentFPS >= 30) return colors.FPS_OK;
    return colors.FPS_BAD;
  }

  /**
   * Writes GameSettings.muted through SettingsService. No direct AudioService call
   * needed: AudioService listens to the same settings$ stream and applies the gain
   * change itself, so this button and the pause-menu Settings toggle converge on
   * the same state regardless of which one the player uses.
   */
  toggleAudioMute(): void {
    const muted = this.settingsService.getSettings().muted ?? false;
    this.settingsService.updateSettings({ muted: !muted });
  }

  // --- Consumable Hotbar ---

  useConsumable(id: string): void {
    this.consumableService.use(id);
    this.quickSlots = this.consumableService.getQuickSlots();
    this.cdr.markForCheck();
  }

  isOnCooldown(slot: Readonly<ConsumableItem>): boolean {
    return this.consumableService.isOnCooldown(slot);
  }

  getCooldownRemaining(slot: ConsumableItem): number {
    return this.consumableService.getCooldownRemaining(slot);
  }

  getSlotQuantity(id: string): number {
    return this.consumableService.getQuantity(id);
  }

  /**
   * Returns the stroke-dasharray first value (0–100.5) for the radial cooldown sweep.
   * 100.5 = full circle coverage (just started cooldown), 0 = no coverage (done).
   * Circle circumference = 2π×16 ≈ 100.5.
   */
  getCooldownProgress(slot: Readonly<ConsumableItem>): number {
    const remaining = this.consumableService.getCooldownRemaining(slot);
    if (remaining <= 0 || !slot.cooldown) return 0;
    return Math.max(0, Math.min(100.5, (remaining / slot.cooldown) * 100.5));
  }

  /**
   * Poll active buffs from the buff management system for the player entity
   * Called from outside Angular zone — must use detectChanges() not markForCheck()
   */
  private updateActiveBuffs(): void {
    if (!this.buffSystem) return;

    const playerEntity = this.gameEngine.getPlayerEntity();
    if (!playerEntity) {
      if (this.activeBuffs.length > 0) {
        this.activeBuffs = [];
        this.cdr.detectChanges();
      }
      return;
    }

    const buffs: ActiveBuff[] = this.buffSystem.getEntityBuffs(playerEntity);
    const buffData = buffs
      .map((b) => {
        const remaining = this.buffSystem.getBuffRemainingTime(playerEntity, b.buffId);
        // remaining === -1 means permanent buff — show with 0 to indicate no expiry
        const remainingSeconds = remaining === -1 ? 0 : Math.ceil(remaining / 1000);
        return {
          name: this.buffDisplayNames[b.buffId] ?? b.buffId.replace(/_/g, ' ').toUpperCase(),
          remainingSeconds,
          color: this.buffColors[b.buffId] ?? '#00ffff',
        };
      })
      .filter((b) => b.remainingSeconds > 0 || b.remainingSeconds === 0); // 0 = permanent, negative would mean expired

    // Only update if changed to avoid unnecessary change detection
    const changed =
      buffData.length !== this.activeBuffs.length ||
      buffData.some(
        (b, i) => b.name !== this.activeBuffs[i].name || b.remainingSeconds !== this.activeBuffs[i].remainingSeconds
      );

    // Track focus fire state
    const focusFiring = this.gameEngine.isFocusFiring;
    const focusChanged = focusFiring !== this.isFocusFiring;

    if (changed || focusChanged) {
      this.activeBuffs = buffData;
      this.isFocusFiring = focusFiring;
      this.focusFireSpeedPenalty = this.gameEngine.focusFireSpeedPenalty;
      this.cdr.detectChanges();
    }
  }
}
