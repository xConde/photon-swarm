import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Router } from '@angular/router';
import { GameEngineService } from './core/engine/game-engine.service';
import { GameState, GameStats } from './core/models/game-state.model';
import { PlayerService } from './core/player/player.service';
import { SaveGameAdapter } from './core/state/save-game.adapter';
import { ControlMapping, GameControlsService } from './core/controls/game-controls.service';
import { SettingsService } from './core/utils/settings.service';
import { GameStartEvent } from './core/models/game-types.model';
import type { UpgradeOption } from './core/models/upgrade.model';

import { getEngineProperty } from './core/models/game-engine-extended.model';

import { UIStateService } from './core/state/ui-state.service';
import { GameStateService } from './core/state/game-state.service';
import { UpgradeService } from './services/upgrade.service';
import { SystemRegistryService } from './core/services/system-registry.service';

import { PostProcessingService } from './core/effects/post-processing.service';
import { AudioService } from './core/audio/audio.service';
import { ConsumableService } from './services/consumable.service';
import { VisualFeedbackCoordinatorService } from './core/services/visual-feedback-coordinator.service';
import { HudComponent } from './features/hud/hud.component';
import { XpBarComponent } from './features/hud/xp-bar/xp-bar.component';
import { ChargeBarComponent } from './features/hud/charge-bar/charge-bar.component';
import { UpgradeModalComponent } from './features/upgrade-modal/upgrade-modal.component';
import { IntroScreenComponent } from './features/intro-screen/intro-screen.component';
import { EndScreenComponent } from './features/end-screen/end-screen.component';
import { ShopComponent } from './features/shop/shop.component';
import { SettingsComponent } from './features/settings/settings.component';
import { EnemyGuideComponent } from './features/enemy-guide/enemy-guide.component';
import { ControlsDisplayComponent } from './components/controls-display/controls-display.component';
import { DebugConsoleComponent } from './components/debug-console/debug-console.component';
import { MapComponent } from './features/map/map.component';

// New Visual Feedback Components
import { KillFeedComponent } from './features/kill-feed/kill-feed.component';
import { UpgradeNotificationsComponent } from './features/upgrade-notifications/upgrade-notifications.component';
import { WaveAnnouncementComponent } from './features/wave-announcement/wave-announcement.component';
import { ZoneAnnouncementComponent } from './features/zone-announcement/zone-announcement.component';
import { ZoneCompleteComponent } from './features/zone-announcement/zone-complete.component';
import { ZoneLockedWarningComponent } from './features/zone-announcement/zone-locked-warning.component';
import { CacheDiscoveredComponent } from './features/zone-announcement/cache-discovered.component';
import { ZoneGateTooltipComponent } from './features/hud/zone-gate-tooltip/zone-gate-tooltip.component';
import { ZoneProgressComponent } from './features/hud/zone-progress/zone-progress.component';
import { VirtualJoystickComponent } from './features/mobile-controls/virtual-joystick.component';
import { ActionButtonsComponent, WeaponMode } from './features/mobile-controls/action-buttons.component';
import { TouchDetectionService } from './features/mobile-controls/touch-detection.service';
import { AriaAnnouncementService } from './services/aria-announcement.service';
import { ZoneStateService } from './core/systems/world/zone-state.service';
import { ZoneConfigService } from './core/systems/world/zone-config.service';
import { TreasureCacheSystemService } from './core/systems/world/treasure-cache-system.service';
import { ActionButtonEvent, JoystickEvent } from './features/mobile-controls/mobile-controls.types';
import { PLAYER_CONFIG } from './config';
import { BerserkerSystemService, IntensityService } from './core/systems/combat';
import { IntensityMilestoneComponent } from './features/hud/intensity-milestone/intensity-milestone.component';
import { ParallaxStarfieldService } from './core/engine/parallax-starfield.service';
import { StarfieldSystemService } from './core/systems/rendering/starfield-system.service';
import { ProgressionSystemService } from './core/progression/progression-system.service';
import { TimeScaleService } from './core/engine/time-scale.service';
import { environment } from 'environments/environment';
import { RunRewardQueueService } from './services/run-reward-queue.service';

@Component({
  selector: 'app-photon-swarm',
  standalone: true,
  imports: [
    HudComponent,
    XpBarComponent,
    ChargeBarComponent,
    UpgradeModalComponent,
    IntroScreenComponent,
    EndScreenComponent,
    ShopComponent,
    SettingsComponent,
    EnemyGuideComponent,
    ControlsDisplayComponent,
    DebugConsoleComponent,
    MapComponent,
    KillFeedComponent,
    UpgradeNotificationsComponent,
    WaveAnnouncementComponent,
    VirtualJoystickComponent,
    ActionButtonsComponent,
    IntensityMilestoneComponent,
    ZoneAnnouncementComponent,
    ZoneCompleteComponent,
    ZoneLockedWarningComponent,
    CacheDiscoveredComponent,
    ZoneGateTooltipComponent,
    ZoneProgressComponent,
  ],
  templateUrl: './photon-swarm.component.html',
  styleUrls: ['./photon-swarm.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotonSwarmComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('gameCanvas', { static: true }) gameCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pauseDialog') pauseDialog?: ElementRef<HTMLElement>;
  @ViewChild(HudComponent) hudComponent!: HudComponent;

  // Visual Feedback Components
  @ViewChild(KillFeedComponent) killFeedComponent?: KillFeedComponent;
  @ViewChild(UpgradeNotificationsComponent) upgradeNotificationsComponent?: UpgradeNotificationsComponent;

  // Game state tracking
  gameState: GameState | null = null;
  gameStats: GameStats | null = null;
  gameStarted = false;
  currentLevel = 1;

  // UI state
  showIntro = true;
  showUpgrade = false;
  showEnd = false;
  showEnemyGuideModal = false;
  showShop = false;
  showSettings = false;
  showMap = false;
  shopDisabled = false;
  playerName = '';

  // Developer tools state
  showDebugConsole = false;
  debugModeEnabled = false;

  // Additional modal flags
  isUpgradeModalVisible = false;
  isShopOpen = false;
  isGameOver = false;
  showCurseConfirmation = false;

  // Debug timeout cleanup
  private levelUpModalTimeoutId?: ReturnType<typeof setTimeout>;
  rewardOptions: UpgradeOption[] = [];
  private focusResumeTimeoutId?: ReturnType<typeof setTimeout>;

  // Pause focus trap
  private pauseTabTrapHandler: ((event: KeyboardEvent) => void) | null = null;
  private pauseFocusMoveTimeoutId?: ReturnType<typeof setTimeout>;
  private pausePreviouslyFocusedElement: HTMLElement | null = null;

  // Charged Discharge system (right-click hold to charge, release to fire)
  private isChargingDischarge = false;
  private dischargeChargeStartTime = 0;
  private readonly DISCHARGE_MAX_CHARGE_MS = PLAYER_CONFIG.DISCHARGE_CHARGING.MAX_CHARGE_DURATION_MS;
  private readonly DISCHARGE_MIN_CHARGE_MS = 200; // Minimum charge time to fire

  /** Timeout id from ngAfterViewInit canvas-setup delay; cleared in ngOnDestroy if it races destroy. */
  private viewInitTimeoutId?: ReturnType<typeof setTimeout>;

  /** Scratch object reused by onMouseMove to avoid per-event allocation. */
  private readonly _mouseScratch: { x: number; y: number } = { x: 0, y: 0 };

  /** Cached, bound reference to the resize handler so we can reliably
   *  add and remove it. */
  private readonly boundResizeCanvas = this.resizeCanvas.bind(this);

  /** Bound visibilitychange handler for checkpoint save on tab background */
  private readonly boundVisibilityHandler = this.onVisibilityChange.bind(this);

  // Centralized modal overlay check
  get isModalOpen(): boolean {
    return (
      this.showUpgrade ||
      this.showShop ||
      this.showEnd ||
      this.gameEngine.isPaused() ||
      this.showCurseConfirmation ||
      this.showSettings ||
      this.isUpgradeModalVisible ||
      this.isShopOpen ||
      this.isGameOver
    );
  }

  // Game controls from service
  gameControls: ControlMapping[] = [];
  pauseControls: ControlMapping[] = [];
  shopControls: ControlMapping[] = [];

  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  private resizeObserver: ResizeObserver | null = null;

  // Pause state is authoritative on engine
  get isPaused(): boolean {
    return this.gameEngine.isPaused();
  }

  /**
   * Current weapon mode, read directly from PlayerService on every CD cycle.
   * `isShiftFiring` is the canonical flag: true → projectile/shot, false → beam.
   * The parent template runs markForCheck() each frame via the state signal effect,
   * so this getter is re-evaluated on every CD pass — no extra subscription needed.
   */
  get weaponMode(): WeaponMode {
    return this.player.getIsShiftFiring() ? 'shot' : 'beam';
  }

  /**
   * Real on/off state of the touch FOCUS button's mode-dependent secondary ability:
   * Focus Fire in shot mode, Auto-Beam in beam mode. Re-evaluated every CD pass (like
   * weaponMode) so the button reflects the true player state instead of a naive local toggle.
   */
  get secondaryActionActive(): boolean {
    return this.player.getIsShiftFiring() ? this.player.getIsFocusFiring() : this.player.getIsAutoBeam();
  }

  /**
   * Parry cooldown fraction (1 → just used, 0 → ready) for the touch parry button's
   * recovery ring. Re-evaluated every CD pass like weaponMode (the state-signal effect
   * runs markForCheck each frame).
   */
  get parryCooldownFraction(): number {
    return this.player.getParryCooldownFraction();
  }

  constructor(
    private gameEngine: GameEngineService,
    private player: PlayerService,
    private gameControlsService: GameControlsService,
    private router: Router,
    private saveAdapter: SaveGameAdapter,
    private uiState: UIStateService,
    private postProcessing: PostProcessingService,
    private visualFeedbackCoordinator: VisualFeedbackCoordinatorService,
    private settingsService: SettingsService,
    private systemRegistry: SystemRegistryService,
    private consumableService: ConsumableService,
    private audio: AudioService,
    private gameStateService: GameStateService,
    private upgradeService: UpgradeService,
    private intensity: IntensityService,
    private berserkerSystem: BerserkerSystemService,
    private ngZone: NgZone,
    private parallaxStarfield: ParallaxStarfieldService,
    private starfieldSystem: StarfieldSystemService,
    private progression: ProgressionSystemService,
    private timeScale: TimeScaleService,
    private touchDetection: TouchDetectionService,
    private ariaAnnouncement: AriaAnnouncementService,
    private zoneState: ZoneStateService,
    private zoneConfig: ZoneConfigService,
    private treasureCacheSystem: TreasureCacheSystemService,
    private runRewards: RunRewardQueueService
  ) {
    // Signal-based state reads (Sprint A8c) — replace the three
    // gameEngine/gameStateService.state$ subscriptions that previously
    // lived in setupSubscriptions. effect() must run in an injection
    // context, so the wires live here in the constructor.

    // (1+2) Mirror state into gameState + pluck currentLevel in ONE effect so a
    // single game-state emission schedules ONE markForCheck instead of two
    // (the two effects previously double-triggered Angular CD every frame the
    // state signal changed).
    effect(() => {
      const state = this.gameEngine.state();
      this.gameState = state;
      if (state) {
        this.currentLevel = state.level || 1;
      }
      this.cdr.markForCheck();
    });

    // (3) Berserker halo: canvas-only update, wrap effect's body in
    // ngZone.runOutsideAngular so it doesn't kick CD on every state
    // change (the prior subscription was explicitly outside-zone).
    effect(() => {
      const state = this.gameStateService.state();
      this.ngZone.runOutsideAngular(() => {
        if (!state) {
          this.player.berserkerActive = false;
          return;
        }
        const hasBerserker = this.berserkerSystem.getCurrentBonus() > 0;
        const healthPercent = state.maxHealth > 0 ? state.health / state.maxHealth : 1;
        this.player.berserkerActive = hasBerserker && healthPercent < 0.5;
      });
    });

    // (4) Pause focus trap — install when the pause menu dialog is visible,
    // remove when it is dismissed.  Reading gameEngine.state() ensures this
    // effect re-evaluates whenever the engine emits a new state frame.
    effect(() => {
      // Track the state signal so this effect re-runs on every state change.
      this.gameEngine.state();
      const showPauseMenu = this.gameEngine.isPaused() && !this.showUpgrade && !this.showEnd && !this.showIntro;
      if (showPauseMenu) {
        this.installPauseFocusTrap();
      } else {
        this.removePauseFocusTrap();
      }
    });
  }

  ngOnInit(): void {
    // Reclaim the ~66px the app footer eats below the embed for the WHOLE photon-swarm
    // session (intro + gameplay) — set on mount, not just startGame, so the intro gets
    // full height too (in landscape the footer otherwise overlapped the Launch button).
    // Scoped to a body class so the other projects, which lay out to the footer, are
    // untouched; removed in ngOnDestroy.
    document.body.classList.add('photon-playing');
    // Get controls from service
    this.gameControls = this.gameControlsService.getControlsForState('game');
    this.pauseControls = this.gameControlsService.getControlsForState('pause');
    this.shopControls = this.gameControlsService.getControlsForState('shop');

    // Initialize game engine with canvas
    this.gameEngine.initialize(this.gameCanvas.nativeElement);

    // CRITICAL: Set game engine reference in player service
    this.player.setGameEngine(this.gameEngine);

    // Make game engine available globally for debugging (dev only)
    if (!environment.production && typeof window !== 'undefined') {
      window.gameEngine = this.gameEngine;
    }

    // Register all ECS systems via the SystemRegistryService
    // (also wires circular deps and sets debug globals)
    this.systemRegistry.registerSystems(this.gameEngine, this.player);
    this.systemRegistry.configureWorldBounds(this.gameEngine);

    // Initially set game as inactive since we're in the intro screen
    this.player.setGameActive(false);

    // Set up all the game state subscriptions
    this.setupSubscriptions();

    // Auto-save checkpoint when tab goes to background
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  private setupSubscriptions(): void {
    // State updates moved to signal-based effect() in the constructor
    // (Sprint A8c) — preserves the same gameState + currentLevel +
    // berserker-halo behavior without the @deprecated state$ subscriber.

    // Subscribe to map toggle events from controls
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🗺️ Setting up map toggle subscription', 'warning', {
        source: 'photon_swarm_component',
        operation: 'setup_subscription',
        hasMapToggle$: !!this.gameControlsService.mapToggle$,
        timestamp: Date.now(),
      });
    }
    this.gameControlsService.mapToggle$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🗺️ Map toggle event received in PhotonSwarmComponent', 'success', {
          source: 'photon_swarm_component',
          operation: 'map_toggle_received',
          timestamp: Date.now(),
        });
      }
      this.toggleMap();
      this.cdr.detectChanges();
    });

    // Subscribe to level up events
    this.gameEngine.levelUpRequest$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🎆 LEVEL UP REQUEST RECEIVED! Delaying modal to show animation', 'success', {
          source: 'photon_swarm_component',
          operation: 'level_up_request_received',
        });
      }
      this.runRewards.queueLevelUp();
      this.scheduleNextRewardChoice(800);
    });

    this.treasureCacheSystem.zoneCompleted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ zoneId }) => {
      this.runRewards.queueZoneCompletion(zoneId);
      this.scheduleNextRewardChoice(450);
    });

    // Subscribe to game over events
    this.gameEngine.gameOver$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((stats: GameStats) => {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🎮 PhotonSwarmComponent received gameOver event', 'error', {
          source: 'photon_swarm_component',
          operation: 'game_over_received',
          stats,
        });
      }
      // Debug: Verify the structure of the event
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔍 DEBUG: GameOver event structure', 'info', {
          source: 'photon_swarm_component',
          operation: 'game_over_assignment',
          statsType: typeof stats,
          statsKeys: Object.keys(stats),
        });
      }

      this.gameStats = stats;

      // Debug: Verify what was assigned
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔍 DEBUG: gameStats after assignment', 'info', {
          source: 'photon_swarm_component',
          operation: 'game_stats_assigned',
          gameStatsType: typeof this.gameStats,
          gameStatsKeys: this.gameStats ? Object.keys(this.gameStats) : [],
          hasTimestamp: this.gameStats && 'timestamp' in this.gameStats,
          hasReason: this.gameStats && 'reason' in this.gameStats,
        });
      }

      this.isGameOver = true;
      this.gameStarted = false;
      this.showEnd = true;
      this.isUpgradeModalVisible = false;
      this.showUpgrade = false;
      this.isShopOpen = false;
      this.showShop = false;
      this.closeMapIfOpen();
      this.shopDisabled = true;
      // Cancel pending level-up modal timeout to prevent stale modal after death
      if (this.levelUpModalTimeoutId) {
        clearTimeout(this.levelUpModalTimeoutId);
        this.levelUpModalTimeoutId = undefined;
      }
      this.runRewards.reset();
      this.rewardOptions = [];
      this.cancelDischargeCharge();
      // Clear all visual effects on game over to prevent blur persistence
      this.clearAllVisualEffects();
      this.intensity.stop();
      this.gameEngine.stop();
      this.player.setGameActive(false);
      this.cdr.detectChanges();

      // Mirror the run-end into the aria-live region. End-screen UI tells
      // sighted players what happened — SR users get the same signal here.
      this.ariaAnnouncement.announceRunEnd(stats);
    });

    // Zone transitions — SR-mirror the boundary cross so players using
    // assistive tech know they've entered a new region. Pulls the human
    // zone name from ZoneConfigService rather than the numeric id.
    this.zoneState.zoneChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event.to === null) return; // Off the grid — no announcement
      const config = this.zoneConfig.getZoneById(event.to);
      const name = config?.name ?? `Zone ${event.to}`;
      this.ariaAnnouncement.announceZoneEntry(name);

      if (this.runRewards.queueZoneEntry(event.to)) {
        this.scheduleNextRewardChoice(500);
      }
    });

    // Wire intensity → canvas visual effects (outside Angular zone — no CD needed).
    // Starfield speed: 1.0 at idle → 1.4 at critical.
    // Star brightness: 1.0 at idle → 1.3 at critical.
    this.ngZone.runOutsideAngular(() => {
      this.intensity
        .getState()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((state) => {
          this.parallaxStarfield.setIntensitySpeedMultiplier(1.0 + state.intensity * 0.4);
          this.starfieldSystem.setIntensityBrightnessMultiplier(1.0 + state.intensity * 0.3);
          this.player.intensityLevel = state.intensity;
        });
    });

    // Berserker halo subscription also moved to a signal-based effect()
    // in the constructor (Sprint A8c).

    // S7: Wire Focus Fire → subtle orange vignette (outside Angular zone — canvas-only update).
    this.ngZone.runOutsideAngular(() => {
      this.player.focusFire$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((active) => {
        this.postProcessing.setFocusFireVignette(active);
      });
    });

    // Level-up ceremony — visceral feedback when player levels up (Sprint 13)
    this.progression.levelUp$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((newLevel) => {
      // Golden screen flash — triumphant, not violent
      this.postProcessing.addScreenFlash({
        color: { r: 255, g: 215, b: 0 },
        opacity: 0.2,
        duration: 300,
      });

      // Chromatic aberration pulse — adds kinetic punch to the moment
      this.postProcessing.addChromaticAberration({
        intensity: 0.3,
        duration: 250,
        fadeOut: true,
      });

      // Freeze-frame hit-pause — ~40ms near-freeze makes the level-up feel impactful
      this.timeScale.applySlowMotion(0.05, 40);

      // Mirror the level-up event into the aria-live channel so screen-reader
      // users get the same signal sighted players get from the gold flash.
      this.ariaAnnouncement.announceLevelUp(newLevel);
    });
  }

  /**
   * Live signal for the aria-live region binding. Exposed as the signal
   * itself (not a getter) so Angular's signal-aware change detection
   * tracks the read inside the template and re-renders on `set()`.
   */
  readonly announcement = this.ariaAnnouncement.message;

  @HostListener('window:keydown.escape')
  onEsc(): void {
    // Close topmost modal first
    if (this.showSettings) {
      this.showSettings = false; // Just close, don't toggle
      return;
    }
    if (this.showShop) {
      this.closeShop();
      return;
    }
    if (this.showEnemyGuideModal) {
      this.showEnemyGuideModal = false;
      return;
    }
    if (this.showUpgrade || this.isUpgradeModalVisible) {
      // Level-up rewards are mandatory. The modal owns Escape while its
      // curse/blessing detail is open; otherwise Escape intentionally does nothing.
      return;
    }
    if (this.showMap) {
      // MapComponent's own Escape handler (document:keydown) calls
      // stopPropagation(), but every other modal here ALSO has its own
      // explicit early-return rather than relying on that alone reaching
      // this window-level listener — match that pattern so Escape closes
      // just the map instead of also falling through to togglePause().
      this.toggleMap();
      return;
    }
    // Only allow pause toggling if intro is not shown and not in modal/game over
    if (!this.showIntro && !this.isGameOver) {
      this.gameEngine.togglePause();
      if (this.gameEngine.isPaused()) {
        // Beam stays on (always-on); game pauses so no rendering
        this.player.setGameActive(false);
        // Exit Focus Fire state so vignette/aura don't desync on pause
        this.player.setFocusFire(false);
        // Cancel an in-flight Burst charge (held the touch Burst button into pause)
        this.cancelDischargeCharge();
        // Clear post-processing effects when pausing
        if (this.postProcessing) {
          this.postProcessing.clear();
        }
        // Auto-save checkpoint on pause
        this.gameStateService.saveRunCheckpoint();
      } else {
        this.player.resetKeys();
        this.player.setGameActive(true);
      }
    }
  }

  @HostListener('window:keydown.m')
  onMKey(): void {
    // Ignore keypresses when not in active gameplay
    if (this.showIntro || this.gameEngine.isPaused() || this.showUpgrade || this.showShop || this.showEnd) {
      return;
    }

    // Keep the Angular overlay and canvas renderer on the same explicit path.
    // Toggling only GameEngine/UIState leaves the visible app-map closed.
    this.toggleMap();
  }

  // Debug shortcuts are dev-only: in production F12 must reach the browser's own devtools
  // (hijacking it reads as broken to a visitor), and Shift+L is a free level-up cheat.
  @HostListener('window:keydown.F12', ['$event'])
  onF12Key(event: Event): void {
    if (environment.production) return;
    event.preventDefault(); // Prevent browser dev tools
    this.toggleDebugConsole();
  }

  @HostListener('window:keydown.control.shift.d', ['$event'])
  onDebugShortcut(event: Event): void {
    if (environment.production) return;
    event.preventDefault();
    this.enableDebugMode();
  }

  @HostListener('window:keydown.shift.l', ['$event'])
  onDebugLevelUp(event: Event): void {
    if (environment.production) return;
    event.preventDefault();
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🧪 DEBUG: Manually triggering level up (Shift+L pressed)', 'warning', {
        source: 'photon_swarm_component',
        operation: 'manual_level_up_trigger',
      });
    }

    // Access the progression system through the game engine
    // Note: progressionSystem is not in DynamicGameEngineProperties, so we need to access it directly
    const gameEngineWithProgression = this.gameEngine as unknown as {
      progressionSystem: {
        level: number;
        xp: number;
        getXpForNextLevel: () => number;
        addXp: (amount: number) => void;
      };
    };
    const progression = gameEngineWithProgression.progressionSystem;
    if (progression) {
      const currentLevel = progression.level;
      const currentXp = progression.xp;
      const xpNeeded = progression.getXpForNextLevel();

      if (window.debugLogBridge) {
        window.debugLogBridge.log(`🎆 Adding ${xpNeeded} XP to trigger level up`, 'info', {
          source: 'photon_swarm_component',
          operation: 'adding_xp_for_levelup',
          currentLevel,
          currentXp,
          xpNeeded,
          xpAdding: xpNeeded,
        });
      }

      // Add enough XP to trigger a level up
      progression.addXp(xpNeeded);
    } else {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('⚠️ Could not access progression system', 'error', {
          source: 'photon_swarm_component',
          operation: 'progression_system_not_found',
        });
      }
    }
  }

  @HostListener('window:keydown', ['$event'])
  onConsumableKeydown(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    // Only process 1/2/3 keys during active gameplay
    if (this.showIntro || this.gameEngine.isPaused() || this.showUpgrade || this.showShop || this.showEnd) return;

    const key = event.key;
    if (key === '1' || key === '2' || key === '3') {
      const index = parseInt(key) - 1;
      const slots = this.consumableService.getQuickSlots();
      if (slots[index]) {
        this.consumableService.use(slots[index].id);
      }
    }
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: Event): void {
    if (!(event instanceof MouseEvent)) return;
    // Debug: Log every mouse down event to trace execution
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🖱️ MOUSE DEBUG: onMouseDown called', 'info', {
        source: 'mouse_debug',
        button: event.button,
        showIntro: this.showIntro,
        isUpgradeModalVisible: this.isUpgradeModalVisible,
        isGameOver: this.isGameOver,
        isPaused: this.gameEngine.isPaused(),
      });
    }

    // Don't process clicks if not in active gameplay
    if (this.showIntro || this.isUpgradeModalVisible || this.isGameOver || this.gameEngine.isPaused()) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🖱️ MOUSE DEBUG: Mouse click blocked by game state', 'warning', {
          source: 'mouse_debug',
          reason: 'game_state_blocking',
        });
      }
      return;
    }

    if (event.button === 0) {
      // Left click — toggle between beam and shooting mode
      this.player.toggleShootingMode();
    } else if (event.button === 2) {
      // Right click - Start charging discharge
      if (this.player.isDischargeAvailable()) {
        this.isChargingDischarge = true;
        this.dischargeChargeStartTime = window.performance.now();
        this.player.startChargingDischarge();

        if (window.debugLogBridge) {
          window.debugLogBridge.log('⚡ Discharge charging started', 'info', {
            source: 'charged_discharge',
            startTime: this.dischargeChargeStartTime,
          });
        }
      }
    }
  }

  @HostListener('mouseup', ['$event'])
  onMouseUp(event: Event): void {
    if (!(event instanceof MouseEvent)) return;
    if (event.button === 0) {
      // Left mouse button released — no action needed (toggleShootingMode is a one-shot on mousedown)
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🖱️ MOUSE DEBUG: onMouseUp called', 'info', {
          source: 'mouse_debug',
          button: event.button,
        });
      }
    } else if (event.button === 2) {
      // Right click released - Fire charged discharge
      if (this.isChargingDischarge) {
        const chargeTime = window.performance.now() - this.dischargeChargeStartTime;
        this.isChargingDischarge = false;

        // Only fire if charged long enough
        if (chargeTime >= this.DISCHARGE_MIN_CHARGE_MS) {
          // Calculate charge level (0.0 to 1.0)
          const chargeLevel = Math.min(chargeTime / this.DISCHARGE_MAX_CHARGE_MS, 1.0);
          this.player.releaseChargedDischarge(chargeLevel);

          if (window.debugLogBridge) {
            window.debugLogBridge.log('⚡ Charged discharge released!', 'success', {
              source: 'charged_discharge',
              chargeTime: chargeTime.toFixed(0) + 'ms',
              chargeLevel: (chargeLevel * 100).toFixed(0) + '%',
            });
          }
        } else {
          // Charge cancelled (released too early)
          this.player.cancelChargingDischarge();

          if (window.debugLogBridge) {
            window.debugLogBridge.log('⚡ Discharge cancelled (released too early)', 'warning', {
              source: 'charged_discharge',
              chargeTime: chargeTime.toFixed(0) + 'ms',
              minRequired: this.DISCHARGE_MIN_CHARGE_MS + 'ms',
            });
          }
        }
      }
    }
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: Event): void {
    // Only process movement if we're targeting and in active gameplay
    if (this.showIntro || this.showUpgrade || this.showEnd || this.showShop || this.gameEngine.isPaused()) {
      return;
    }

    if (!(event instanceof MouseEvent)) return;
    // Continuously track mouse position for beam targeting
    const canvas = this.gameCanvas.nativeElement;
    // Read rect once and reuse across both branches — getBoundingClientRect() forces a layout.
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    this.screenToWorldCoordinates(mouseX, mouseY, this._mouseScratch);
    this.player.updateMousePosition(this._mouseScratch.x, this._mouseScratch.y);

    // Check if player service has the isDirectionChangeActive method and if targeting is active
    if (typeof this.player.isDirectionChangeActive === 'function' && this.player.isDirectionChangeActive()) {
      // worldCoords already computed above into _mouseScratch; reuse directly.
      this.player.changeDirection(this._mouseScratch.x, this._mouseScratch.y);
    }
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.player.stopDirectionChange();
    this.cancelDischargeCharge();
  }

  /**
   * Cancel an in-flight Burst/discharge charge. Called on mouse-leave AND on every
   * interruption (pause, window blur, tab background) — otherwise holding the touch
   * Burst button and then pausing before release leaves the charge stuck on.
   */
  private cancelDischargeCharge(): void {
    if (this.isChargingDischarge) {
      this.isChargingDischarge = false;
      this.player.cancelChargingDischarge();
    }
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    // Reset timing when window regains focus to prevent delta time accumulation
    if (this.gameEngine.isRunning() && !this.gameEngine.isPaused()) {
      // Force a timing reset in the loop system by pausing and resuming
      this.gameEngine.pause();
      this.focusResumeTimeoutId = setTimeout(() => {
        if (!this.isModalOpen && !this.showIntro && !this.showEnd) {
          this.gameEngine.resume();
          this.player.setGameActive(true);
        }
      }, 50);
    }
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    // Pause the game when window loses focus to prevent timing issues
    if (this.gameEngine.isRunning() && !this.gameEngine.isPaused() && !this.isModalOpen) {
      this.player.resetKeys();
      this.gameEngine.pause();
      this.player.setGameActive(false);
      this.cancelDischargeCharge();
    }
  }

  /** Auto-save + pause when the tab/app is backgrounded */
  private onVisibilityChange(): void {
    if (document.visibilityState === 'hidden' && this.gameEngine.isRunning() && !this.showIntro && !this.isGameOver) {
      this.gameStateService.saveRunCheckpoint();
      // iOS Safari backgrounds the page via visibilitychange WITHOUT a window:blur, so
      // the blur-pause never fires and the loop keeps running in the background (battery
      // drain + a delta-time spike on return). Pause here too; the pause menu shows and
      // the player resumes manually on return, consistent with the blur behaviour.
      if (!this.gameEngine.isPaused() && !this.isModalOpen) {
        this.player.resetKeys();
        this.gameEngine.pause();
        this.player.setGameActive(false);
        this.cancelDischargeCharge();
      }
    }
  }

  onCanvasClick(): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 TEST4: onCanvasClick() called', 'info', {
        source: 'test_suite',
        test: 'canvas_click',
        showIntro: this.showIntro,
        hasSave: this.saveAdapter?.hasSave(),
      });
    }

    if (!this.showIntro) return;

    if (this.saveAdapter.hasSave()) {
      if (this.gameEngine.loadGameState()) {
        this.startExistingRun();
      } else {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Failed to load save game, starting fresh', 'warning', {
            source: 'photon_swarm_component',
            operation: 'loadSave',
          });
        }
        this.startGame();
      }
    } else {
      this.startGame();
    }
  }

  private startExistingRun(): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 startExistingRun: Ensuring territory initialization', 'info', {
        source: 'photon_swarm_component',
        operation: 'startExistingRun_entry',
        playerName: this.gameEngine.getPlayerName(),
        hasWorldSeed: !!getEngineProperty(this.gameEngine, 'currentWorldSeed'),
      });
    }

    this.showIntro = false;
    this.showEnd = false;
    this.showUpgrade = false;
    this.closeMapIfOpen();
    this.shopDisabled = false;
    this.playerName = this.gameEngine.getPlayerName();

    // CRITICAL FIX: Ensure territory system is initialized
    // The game was calling resume() which only unpauses but doesn't initialize territories
    if (!getEngineProperty(this.gameEngine, 'currentWorldSeed')) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔧 startExistingRun: No world seed - calling start()', 'info', {
          source: 'photon_swarm_component',
          operation: 'force_start',
        });
      }
      this.gameEngine.start(); // Full initialization with territory generation
    } else {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔧 startExistingRun: World seed exists - calling resume()', 'info', {
          source: 'photon_swarm_component',
          operation: 'resume_existing',
          seed: getEngineProperty(this.gameEngine, 'currentWorldSeed'),
        });
      }
      this.gameEngine.startWithoutReset(); // Start game loop with loaded state (resume() fails when engine isn't running yet)
    }
    this.systemRegistry.resetRunState();

    this.intensity.reset();
    this.intensity.start();
    this.player.setGameActive(true);
    this.gameStarted = true;

    // Ensure game is unpaused regardless of the initialization path taken above
    if (this.gameEngine.isPaused()) {
      this.gameEngine.resume();
    }
    this.queueOpeningCoreChoice();
  }

  startGame(name?: string): void {
    if (name) {
      this.playerName = name;
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 PhotonSwarmComponent: startGame() called', 'info', {
        source: 'photon_swarm_component',
        operation: 'startGame_entry',
        playerName: this.playerName,
      });
    }

    this.gameEngine.setPlayerName(this.playerName);
    this.runRewards.reset();
    this.rewardOptions = [];
    this.showIntro = false;
    this.showEnd = false;
    this.showUpgrade = false;
    this.closeMapIfOpen();
    this.shopDisabled = false;
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 PhotonSwarmComponent: About to call gameEngine.start()', 'info', {
        source: 'photon_swarm_component',
        operation: 'calling_start',
      });
    }

    this.gameEngine.start();
    this.systemRegistry.resetRunState();

    // Ensure game is unpaused after start
    if (this.gameEngine.isPaused()) {
      this.gameEngine.resume();
    }

    this.intensity.reset();
    this.intensity.start();
    this.player.setGameActive(true);
    this.gameStarted = true;
    this.queueOpeningCoreChoice();
  }

  loadSavedGame(): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 TEST3: loadSavedGame() called', 'info', {
        source: 'test_suite',
        test: 'load_saved_game',
        hasSaveAdapter: !!this.saveAdapter,
        hasSave: this.saveAdapter?.hasSave(),
      });
    }

    if (this.saveAdapter.hasSave()) {
      if (this.gameEngine.loadGameState()) {
        this.startExistingRun();
      } else {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Failed to load save game, starting fresh', 'warning', {
            source: 'photon_swarm_component',
            operation: 'loadSave',
          });
        }
        this.startGame();
      }
    } else {
      this.startGame();
    }
  }

  resumeFromCheckpoint(): void {
    const checkpoint = this.saveAdapter.loadCheckpoint();
    if (!checkpoint) {
      // No checkpoint found, fall back to fresh start
      this.startGame();
      return;
    }

    // Set up the player name and start the engine fresh
    this.playerName = checkpoint.playerName;
    this.gameEngine.setPlayerName(this.playerName);
    this.runRewards.reset();
    this.rewardOptions = [];
    this.showIntro = false;
    this.showEnd = false;
    this.showUpgrade = false;
    this.closeMapIfOpen();
    this.shopDisabled = false;

    this.gameEngine.start();
    this.systemRegistry.resetRunState();

    // Restore state from checkpoint immediately after engine start
    // CRITICAL: Must happen before the next game loop tick to prevent
    // the engine from checkpointing default state over the saved data
    const restored = this.gameStateService.restoreFromCheckpoint(checkpoint);
    if (!restored) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Checkpoint restore failed, continuing with fresh state', 'warning', {
          source: 'photon_swarm_component',
          operation: 'resumeFromCheckpoint',
        });
      }
    }

    // Re-apply upgrade effects through one transaction. A failed restore cannot
    // continue with saved counts whose gameplay effects were rolled back.
    const upgradesApplied =
      restored && this.upgradeService.reapplySavedUpgradeEffects(this.gameEngine, checkpoint.upgrades);

    if (!restored || !upgradesApplied) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Checkpoint transaction failed; starting a clean run', 'warning', {
          source: 'photon_swarm_component',
          operation: 'checkpoint_transaction_failed',
          stateRestored: restored,
          upgradesApplied,
        });
      }
      this.saveAdapter.clearCheckpoint();
      this.gameEngine.reset();
      this.startGame();
      return;
    }

    this.player.setGameActive(true);
    this.gameStarted = true;
    this.queueOpeningCoreChoice();

    // Only clear checkpoint after successful restoration
    this.saveAdapter.clearCheckpoint();
  }

  onUpgradeChosen(): void {
    this.runRewards.completeActiveOffer();
    this.rewardOptions = [];
    this.isUpgradeModalVisible = false;
    this.showUpgrade = false;

    // Clear all visual effects to prevent blur persistence
    this.clearAllVisualEffects();

    // Upgrade application flash - immediate kinesthetic feedback
    this.postProcessing.addChromaticAberration({ intensity: 0.4, duration: 150, fadeOut: true });

    this.player.resetKeys();

    if (this.runRewards.hasPendingReward()) {
      this.scheduleNextRewardChoice(200);
      return;
    }

    this.gameEngine.resume();
    this.player.setGameActive(true);
  }

  onRestart(): void {
    // Clear all modal/overlay states
    this.showEnd = false;
    this.isGameOver = false;
    this.shopDisabled = false;
    this.showUpgrade = false;
    this.isUpgradeModalVisible = false;
    this.showShop = false;
    this.isShopOpen = false;
    this.showSettings = false;
    this.showEnemyGuideModal = false;
    this.closeMapIfOpen();
    // Cancel any pending level-up modal from previous game
    if (this.levelUpModalTimeoutId) {
      clearTimeout(this.levelUpModalTimeoutId);
      this.levelUpModalTimeoutId = undefined;
    }
    this.runRewards.reset();
    this.rewardOptions = [];

    // Use same world respawn to keep the world consistent
    this.gameEngine.respawnSameWorld();
    this.systemRegistry.resetRunState();

    // Start without calling reset again to avoid duplicate reset and pause issues
    this.gameEngine.startWithoutReset();

    // CRITICAL FIX: Ensure game is not paused after respawn
    // The reset() method doesn't unpause, so we need to explicitly unpause
    if (this.gameEngine.isPaused()) {
      this.gameEngine.resume();
    }

    this.intensity.stop();
    this.intensity.reset();
    this.intensity.start();
    this.player.setGameActive(true);
    this.gameStarted = true;
    this.queueOpeningCoreChoice();
  }

  onAscend(): void {
    // Restart with the newly unlocked mastery option available.
    this.onRestart();
  }

  openEnemyGuideModal(): void {
    this.showEnemyGuideModal = true;
  }

  toggleShop(): void {
    // If shop is open, close it (ESC or X button)
    if (this.showShop) {
      this.showShop = false;
      // Do not resume game here; just return to pause menu
      return;
    }
    // If shop is not open, open it (from pause menu)
    this.showShop = true;
    // Do not change pause/game state; pause menu remains open in background
  }

  setCurseConfirmation(visible: boolean): void {
    this.showCurseConfirmation = visible;
  }

  resumeGame(): void {
    // Resume game and close pause overlay
    if (this.gameEngine.isPaused()) {
      this.gameEngine.resume();
      this.player.setGameActive(true);
    }
  }

  saveAndQuit(): void {
    try {
      if (!this.gameEngine.saveGameState()) {
        return;
      }
      // Navigate to projects page (parent route) without reload
      void this.router.navigate(['/']);
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to save game', 'error', {
          source: 'photon_swarm_component',
          operation: 'saveCurrentGame',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Could add user notification here
    }
  }

  toggleSettings(): void {
    this.showSettings = !this.showSettings;

    if (this.showSettings) {
      // Pause the game while settings are open
      this.gameEngine.pause();
      this.player.setGameActive(false);
    } else if (!this.gameEngine.isPaused()) {
      // Resume the game if we're not in the pause menu
      this.player.resetKeys();
      this.gameEngine.resume();
      this.player.setGameActive(true);
    }
  }

  toggleMap(): void {
    // Don't allow map during intro screen
    if (this.showIntro) {
      return;
    }

    this.showMap = !this.showMap;
    // Synchronize the renderer to the overlay instead of assuming both layers
    // started in the same state.
    this.uiState.toggleFullMap(this.showMap);

    // Update the M key action text dynamically
    this.updateMapControl();

    // Map doesn't pause the game, just overlays
    if (window.debugLogBridge) {
      window.debugLogBridge.log('MAP_TOGGLED', 'info', {
        source: 'photon_swarm_component',
        showMap: this.showMap,
        fullMapEnabled: this.uiState.fullMapEnabled(),
      });
    }
  }

  private updateMapControl(): void {
    // Find the map control and update its action text
    const mapControl = this.gameControls.find((c) => c.key === 'M');
    if (mapControl) {
      mapControl.action = this.showMap ? 'Close Map' : 'Open Map';
      // Trigger change detection by creating a new array
      this.gameControls = [...this.gameControls];
    }
  }

  /**
   * Close both map layers without blindly toggling either one. Run transitions
   * can reset UIState independently of the Angular overlay flag; synchronizing
   * them explicitly prevents a pre-death Automap from returning on respawn.
   */
  private closeMapIfOpen(): void {
    this.showMap = false;
    this.uiState.toggleFullMap(false);
    this.updateMapControl();
  }

  // Pause menu stats (from IntensityService)
  get intensityMaxStreak(): number {
    return this.intensity.getCurrentState().maxKillStreak;
  }

  get intensityPeak(): string {
    return (this.intensity.getCurrentState().peakIntensity * 100).toFixed(0) + '%';
  }

  get healthPercentage(): number {
    const currentHealth = this.gameEngine.getPlayerHealth();
    const maxHealth = this.player.getMaxHealth();
    if (maxHealth <= 0) {
      return 0;
    }
    return (currentHealth / maxHealth) * 100;
  }

  // Method to open shop
  openShop(): void {
    if (!this.gameEngine.isPaused()) {
      this.showShop = true;
      // Beam stays on (always-on); game pauses so no rendering
      this.gameEngine.pause();
      this.player.setGameActive(false);
    }
  }

  // Method to close shop
  closeShop(): void {
    this.showShop = false;
    // Clear any lingering visual effects
    this.clearAllVisualEffects();
    // Do not resume game here; just return to pause menu
  }

  // ── Mobile touch controls ──

  /**
   * Whether the runtime should render virtual joysticks + action buttons.
   * Backed by TouchDetectionService — true on touch-capable non-desktop
   * devices, false everywhere else. Pre-Phase-10, the template's `@if`
   * relied on CSS to hide the joysticks on desktop; if that stylesheet
   * ever failed to load, desktop players would see ghost touch overlays.
   */
  get showVirtualControls(): boolean {
    return this.touchDetection.getDeviceInfoSnapshot().showVirtualControls;
  }

  onJoystickChange(event: JoystickEvent): void {
    if (event.type === 'movement') {
      // Screen Y is inverted: pushing stick UP gives negative Y
      const threshold = 0.25;
      this.player.setKey('w', event.vector.y < -threshold);
      this.player.setKey('s', event.vector.y > threshold);
      this.player.setKey('a', event.vector.x < -threshold);
      this.player.setKey('d', event.vector.x > threshold);
    } else if (event.type === 'aim') {
      if (event.active) {
        // The joystick vector AND the canvas both use screen-convention Y (up = negative),
        // so the default passes Y straight through: push up, aim up. The old code negated
        // here ("to make up aim up") assuming a math-convention stick — that double flip is
        // exactly why the default felt backwards on device. Invert Aim (Y) applies the flip
        // for players who want it.
        const aimY = this.settingsService.getSettings().invertAimY ? -event.vector.y : event.vector.y;
        const angle = Math.atan2(aimY, event.vector.x);
        this.player.setAimAngle(angle);
      } else {
        this.player.stopDirectionChange();
      }
    }
  }

  onActionButton(event: ActionButtonEvent): void {
    // 'discharge' needs both press (start charge) and release (fire/cancel) signals,
    // so we handle it before the early-return guard.
    if (event.action === 'discharge') {
      this.onTouchDischarge(event.pressed);
      return;
    }

    if (!event.pressed) return;

    switch (event.action) {
      case 'dash':
        this.player.triggerDash();
        break;
      case 'parry':
        this.player.triggerParry();
        break;
      case 'toggleShooting':
        this.player.toggleShootingMode();
        break;
      case 'map':
        // Must go through toggleMap() (sets showMap = the app-map overlay's isVisible)
        // — gameEngine.toggleFullMap() only flips the render flag, so the overlay never
        // appeared and the MAP button looked dead on touch.
        this.toggleMap();
        break;
      case 'pause':
        // Reuse the ESC pause path (toggles pause, saves a run checkpoint, resets
        // focus-fire/post-processing). Opening the pause menu is the only way to reach
        // Shop/Settings/Restart on touch; the menu's Resume button un-pauses.
        this.onEsc();
        break;
      case 'focusFire':
        // Mirror the Shift key desktop path: in shooting mode toggle Focus Fire,
        // in beam mode toggle Auto-Beam. Audio feedback matches the keyboard handler
        // in game-controls.service.ts.
        this.onTouchFocusFire();
        break;
    }
  }

  /** Touch path for Charged Burst (mirrors right-mouse hold desktop handler). */
  private onTouchDischarge(pressed: boolean): void {
    if (pressed) {
      // Touch-down: start charging (same guard as desktop mousedown)
      if (this.player.isDischargeAvailable()) {
        this.isChargingDischarge = true;
        this.dischargeChargeStartTime = window.performance.now();
        this.player.startChargingDischarge();

        if (window.debugLogBridge) {
          window.debugLogBridge.log('⚡ [touch] Discharge charging started', 'info', {
            source: 'touch_discharge',
            startTime: this.dischargeChargeStartTime,
          });
        }
      }
    } else {
      // Touch-up: fire or cancel (same logic as desktop mouseup)
      if (this.isChargingDischarge) {
        const chargeTime = window.performance.now() - this.dischargeChargeStartTime;
        this.isChargingDischarge = false;

        if (chargeTime >= this.DISCHARGE_MIN_CHARGE_MS) {
          const chargeLevel = Math.min(chargeTime / this.DISCHARGE_MAX_CHARGE_MS, 1.0);
          this.player.releaseChargedDischarge(chargeLevel);

          if (window.debugLogBridge) {
            window.debugLogBridge.log('⚡ [touch] Charged discharge released!', 'success', {
              source: 'touch_discharge',
              chargeTime: chargeTime.toFixed(0) + 'ms',
              chargeLevel: (chargeLevel * 100).toFixed(0) + '%',
            });
          }
        } else {
          this.player.cancelChargingDischarge();

          if (window.debugLogBridge) {
            window.debugLogBridge.log('⚡ [touch] Discharge cancelled (released too early)', 'warning', {
              source: 'touch_discharge',
              chargeTime: chargeTime.toFixed(0) + 'ms',
              minRequired: this.DISCHARGE_MIN_CHARGE_MS + 'ms',
            });
          }
        }
      }
    }
  }

  /** Touch path for Focus Fire / Auto-Beam toggle (mirrors Shift desktop key handler). */
  private onTouchFocusFire(): void {
    if (this.player.getIsShiftFiring()) {
      // Shooting mode → toggle Focus Fire
      const nowActive = !this.player.getIsFocusFiring();
      this.player.setFocusFire(nowActive);

      if (window.debugLogBridge) {
        window.debugLogBridge.log(nowActive ? '🎯 [touch] Focus Fire ON' : '🎯 [touch] Focus Fire OFF', 'info', {
          source: 'touch_focus_fire',
          mode: nowActive ? 'FOCUS' : 'NORMAL',
        });
      }
    } else {
      // Beam mode → toggle Auto-Beam
      this.player.toggleAutoBeam();

      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔄 [touch] Auto-Beam toggled', 'info', {
          source: 'touch_focus_fire',
          isAutoBeam: this.player.getIsAutoBeam(),
        });
      }
    }
  }

  /** Install a Tab-trap inside the pause dialog and auto-focus the first button. */
  private installPauseFocusTrap(): void {
    // Already installed — avoid double-attaching.
    if (this.pauseTabTrapHandler) return;

    this.pausePreviouslyFocusedElement = document.activeElement as HTMLElement;

    this.pauseTabTrapHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const container = this.pauseDialog?.nativeElement;
      if (!container) return;

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

    document.addEventListener('keydown', this.pauseTabTrapHandler);

    // Move focus into the dialog after the DOM settles (OnPush renders async).
    this.pauseFocusMoveTimeoutId = setTimeout(() => {
      const container = this.pauseDialog?.nativeElement;
      if (!container) return;
      const firstBtn = container.querySelector<HTMLElement>('button');
      if (firstBtn) {
        firstBtn.focus();
      } else {
        container.setAttribute('tabindex', '-1');
        container.focus();
      }
    }, 50);
  }

  /** Remove the Tab-trap and restore focus to the element that was focused before pausing. */
  private removePauseFocusTrap(): void {
    if (!this.pauseTabTrapHandler) return;

    if (this.pauseFocusMoveTimeoutId) {
      clearTimeout(this.pauseFocusMoveTimeoutId);
      this.pauseFocusMoveTimeoutId = undefined;
    }

    document.removeEventListener('keydown', this.pauseTabTrapHandler);
    this.pauseTabTrapHandler = null;

    if (
      this.pausePreviouslyFocusedElement?.isConnected &&
      typeof this.pausePreviouslyFocusedElement.focus === 'function'
    ) {
      this.pausePreviouslyFocusedElement.focus();
    }
    this.pausePreviouslyFocusedElement = null;
  }

  ngOnDestroy(): void {
    // Restore the app footer when leaving the game (Save & Quit navigates away).
    document.body.classList.remove('photon-playing');
    if (this.viewInitTimeoutId) {
      clearTimeout(this.viewInitTimeoutId);
      this.viewInitTimeoutId = undefined;
    }
    if (this.levelUpModalTimeoutId) {
      clearTimeout(this.levelUpModalTimeoutId);
      this.levelUpModalTimeoutId = undefined;
    }
    this.runRewards.reset();
    this.rewardOptions = [];
    if (this.focusResumeTimeoutId) {
      clearTimeout(this.focusResumeTimeoutId);
    }
    if (this.pauseFocusMoveTimeoutId) {
      clearTimeout(this.pauseFocusMoveTimeoutId);
      this.pauseFocusMoveTimeoutId = undefined;
    }

    // Remove pause focus trap before destroying
    this.removePauseFocusTrap();

    // Game services are root-scoped and reused if this lazy route is opened again.
    // Stop this session without completing their long-lived observable streams.
    this.systemRegistry.deactivateSession();
    this.gameEngine.deactivateSession();
    this.intensity.stop();
    this.cancelDischargeCharge();
    if (!environment.production && window.gameEngine === this.gameEngine) {
      delete window.gameEngine;
    }
    this.player.setGameActive(false);

    // Clean up event listeners
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    window.removeEventListener('resize', this.boundResizeCanvas);

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.audio.deactivateSession();

    // Restore scroll behavior
    document.body.style.overflow = '';
  }

  /**
   * Handles canvas resizing to maintain aspect ratio and support high-DPI displays
   */
  private resizeCanvas(): void {
    const canvas = this.gameCanvas.nativeElement;
    const container = canvas.parentElement;

    // Ensure no scrollbars appear
    document.body.style.overflow = 'hidden';

    // Get container dimensions directly – the game should always fill it
    const gameWidth = container?.clientWidth || 800;
    const gameHeight = container?.clientHeight || 600;

    // Set canvas CSS dimensions
    canvas.style.width = `${gameWidth}px`;
    canvas.style.height = `${gameHeight}px`;

    // Resolution scaling. The game is FILL-BOUND on phones (profiling: total frame time far
    // exceeds per-system logic time → the cost is GPU rasterisation of pixels, not the ECS).
    // The single biggest lever is rendering the backing store BELOW the logical size and letting
    // CSS upscale it: 0.7x linear = 0.49x the pixels ≈ 2x fill-rate headroom. The HUD, joysticks
    // and text are DOM overlays so they stay crisp — only the canvas softens, which a fast arcade
    // game in motion easily hides. Desktop keeps a capped DPR for sharpness. The drawing context
    // is scaled by renderScale so all game code keeps drawing in CSS coordinates; full-screen
    // ops and viewport culling read RenderContext.cssWidth/cssHeight (the logical size) so they
    // do not under-cover the screen. 0.8 = 0.64x the pixels (~1.56x fill headroom) and only a
    // 1.25x upscale, so it stays crisp; 0.7 was too soft. Tunable 0.7 (more FPS) .. 0.9 (sharper).
    const RENDER_SCALE_TOUCH = 0.8;
    const MAX_RENDER_DPR_DESKTOP = 2;
    const renderScale = this.showVirtualControls
      ? RENDER_SCALE_TOUCH
      : Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR_DESKTOP);

    // Set canvas drawing buffer size (logical size scaled by renderScale)
    canvas.width = Math.floor(gameWidth * renderScale);
    canvas.height = Math.floor(gameHeight * renderScale);

    // Scale the drawing context so game code draws in CSS pixels. Reset first: assigning
    // canvas.width only resets the context when the integer value CHANGES, so a resize
    // that lands on the same pixel width (e.g. iOS Safari address-bar show/hide) would
    // leave the prior scale in place and accumulate it (scale², scale³…), corrupting render.
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(1, 0, 0, 1, 0, 0);
    ctx?.scale(renderScale, renderScale);

    // Update territory system with actual canvas dimensions for viewport-aware tile loading
    this.systemRegistry.fourKingsTerritorySystem.setCanvasDimensions(gameWidth, gameHeight);
  }

  /**
   * Sets up a ResizeObserver to monitor container size changes
   */
  private setupResizeObserver(): void {
    // Only run if ResizeObserver is available in the browser
    if (typeof ResizeObserver !== 'undefined') {
      const container = this.gameCanvas.nativeElement.parentElement;
      const resizeObserver = new ResizeObserver((_entries): void => {
        this.resizeCanvas();
      });

      if (container) {
        resizeObserver.observe(container);
      }

      // Store observer for cleanup
      this.resizeObserver = resizeObserver;
    }
  }

  ngAfterViewInit(): void {
    // Initialize canvas sizing and responsive behavior
    this.viewInitTimeoutId = setTimeout(() => {
      this.viewInitTimeoutId = undefined;
      this.resizeCanvas();
      this.setupResizeObserver();
      // Keep the canvas responsive when the viewport itself resizes.
      window.addEventListener('resize', this.boundResizeCanvas);

      // Register visual feedback components with coordinator
      this.visualFeedbackCoordinator.registerComponents(this.killFeedComponent, this.upgradeNotificationsComponent);
    }, 50);
  }

  private scheduleNextRewardChoice(delayMs: number): void {
    if (
      !this.runRewards.hasPendingReward() ||
      this.levelUpModalTimeoutId !== undefined ||
      this.showUpgrade ||
      this.isGameOver
    ) {
      return;
    }

    // Keep the world alive during the first level-up celebration, then pause
    // atomically when the queued reward is ready to choose.
    this.gameEngine.grantPlayerImmunity(Math.max(1, delayMs / 1000 + 0.2));
    this.levelUpModalTimeoutId = setTimeout(() => {
      this.levelUpModalTimeoutId = undefined;
      if (!this.runRewards.hasPendingReward() || this.isGameOver) return;
      const offer = this.runRewards.takeNextOffer();
      if (!offer) return;
      this.rewardOptions = offer.options;
      this.isUpgradeModalVisible = true;
      this.showUpgrade = true;
      this.gameEngine.pause();
      this.player.setGameActive(false);
      this.cdr.detectChanges();
    }, delayMs);
  }

  /** Bind a starter weapon before the opening encounter can become the run's identity by accident. */
  private queueOpeningCoreChoice(): void {
    if (!this.runRewards.queueOpeningCoreChoice()) return;
    // Freeze the first simulation tick. Immunity alone still lets the opening
    // formation advance before the player has selected their defining weapon.
    this.gameEngine.pause();
    this.player.setGameActive(false);
    this.scheduleNextRewardChoice(120);
  }

  /**
   * Proxy for <app-intro-screen> `(startGame)` output that forwards to the
   * existing `startGame()` method signature.
   */
  onGameStart(_event?: GameStartEvent): void {
    this.startGame();
  }

  /** Whether the full-screen map overlay is currently visible */
  get isFullMapOpen(): boolean {
    return this.gameEngine.isFullMapEnabled();
  }

  toggleDebugConsole(): void {
    this.showDebugConsole = !this.showDebugConsole;
  }

  enableDebugMode(): void {
    this.debugModeEnabled = true;
    // Enable debug logging and visual indicators
  }

  /**
   * Clear all visual effects that might persist after modal interactions
   */
  private clearAllVisualEffects(): void {
    // Clear post-processing effects
    if (this.postProcessing) {
      this.postProcessing.clear();
    }

    // Clear any floating text entities
    this.gameEngine.clearFloatingTextEntities();

    // Reset modal states
    this.showCurseConfirmation = false;
    this.isUpgradeModalVisible = false;
    this.showUpgrade = false;

    // Force a clean render frame
    this.gameEngine.forceRenderFrame();
  }

  /**
   * Convert screen coordinates to world coordinates relative to player position
   */
  private screenToWorldCoordinates(
    screenX: number,
    screenY: number,
    out: { x: number; y: number } = { x: 0, y: 0 }
  ): { x: number; y: number } {
    const canvas = this.gameCanvas.nativeElement;
    const playerPos = this.player.getPosition();

    if (!playerPos) {
      out.x = screenX;
      out.y = screenY;
      return out;
    }

    // Get actual canvas dimensions (CSS dimensions, not buffer dimensions)
    const actualCanvasWidth = parseFloat(canvas.style.width) || canvas.width;
    const actualCanvasHeight = parseFloat(canvas.style.height) || canvas.height;

    // Get world dimensions from game engine
    const worldWidth = this.gameEngine.getWorldWidth();
    const worldHeight = this.gameEngine.getWorldHeight();

    // Calculate center of screen in screen coordinates
    const centerScreenX = actualCanvasWidth / 2;
    const centerScreenY = actualCanvasHeight / 2;

    // Calculate offset from center in screen coordinates
    let offsetX = screenX - centerScreenX;
    let offsetY = screenY - centerScreenY;

    // Apply mouse sensitivity (50-200 range maps to 0.5x - 2.0x multiplier)
    const settings = this.settingsService.getSettings();
    const sensitivity = settings.sensitivity / 100;
    offsetX *= sensitivity;
    offsetY *= sensitivity;

    // Convert screen offset to world offset (preserving aspect ratio)
    const worldOffsetX = (offsetX / actualCanvasWidth) * worldWidth;
    const worldOffsetY = (offsetY / actualCanvasHeight) * worldHeight;

    // Calculate target world position relative to player
    out.x = playerPos.x + worldOffsetX;
    out.y = playerPos.y + worldOffsetY;
    return out;
  }
}
