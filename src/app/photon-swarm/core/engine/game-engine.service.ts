import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import type { System, SystemType } from '../ecs/ecs.model';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { LoopSystemService } from './loop-system.service';
import { GameStateService } from '../state/game-state.service';
import { GameStats } from '../models/game-state.model';
import { UIStateService } from '../state/ui-state.service';
import { PerformanceMonitorService } from '../utils/performance-monitor.service';
import { SaveGameAdapter } from '../state/save-game.adapter';
import { Enemy, LegacyEnemy, LegacyPlayer, Projectile } from '../models/game-types.model';
import {
  EnemyTypeComponent,
  FactionComponent,
  FloatingTextComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  ShardComponent,
  TerritorialGuardianComponent,
  VelocityComponent,
} from '@photon/components';
import { BerserkerSystemService, BurnSystemService, VelocityMatrixSystemService } from '../systems/combat';
import { PlayerService } from '../player/player.service';
import { PlayerUpgradesService, PlayerUpgradeTransactionSnapshot } from '../player/player-upgrades.service';
import { FourKingsTerritoryService } from '../systems/territory';
import {
  GuardianSpawnerSystemService,
  TreasureCacheSystemService,
  ZoneGateSystemService,
  ZoneStateService,
} from '../systems/world';
import { BuffManagementSystemService, FactionStandingSystemService } from '../systems/gameplay';
import { MinionTrackerService } from '../systems/enemy-ai/minion-tracker.service';
import { RenderingSystemService } from '../systems/rendering';
import { MONITORING_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { BuffSystemService, BuffUpgradeTransactionSnapshot } from '../progression/buff-system.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { UpgradeService } from '../../services/upgrade.service';
import { CurseService, CurseUpgradeTransactionSnapshot } from '../../services/curse.service';
import { FrameSkipManagerService } from '../utils/frame-skip-manager.service';
import { PostProcessingService } from '../effects/post-processing.service';
import { GameRenderingService } from './game-rendering.service';
import { TimeScaleService } from './time-scale.service';
import { ShopUpgradeInitService } from '../../services/shop-upgrade-init.service';
import { EntityFactoryECSService } from '../entities/entity-factory-ecs.service';
import { BurnUpgradeTransactionSnapshot } from '../systems/combat/burn-system.service';
import type { EnemySnapshot, FactionSnapshot } from '../models/save-game.model';
import { Rarity } from '../models/enemy.model';
import type {
  BeamCoreId,
  BeamMutationId,
  RunPressureChange,
  RunPressureTransactionSnapshot,
  RunRouteTransactionSnapshot,
  RunRouteZoneId,
} from '../models/run-build.model';
import { RunRouteService } from '../../services/run-route.service';
import { RunPressureService } from '../../services/run-pressure.service';
import { RunDraftService } from '../../services/run-draft.service';
import { CameraStateService } from './camera-state.service';
import { LegacyEcsBridgeService } from './legacy-ecs-bridge.service';

export interface UpgradeTransactionSnapshot {
  playerUpgrades: PlayerUpgradeTransactionSnapshot;
  health: number;
  buffs: BuffUpgradeTransactionSnapshot;
  burn: BurnUpgradeTransactionSnapshot;
  curses: CurseUpgradeTransactionSnapshot;
  runRoute: RunRouteTransactionSnapshot;
  runPressure: RunPressureTransactionSnapshot;
  factions: FactionSnapshot[] | null;
}

/**
 * GameEngineService - Core game engine implementing Entity-Component-System architecture
 *
 * The GameEngineService serves as the central orchestrator for the entire game, managing:
 * - System registration and execution order
 * - Game loop lifecycle (start, pause, resume, stop)
 * - Canvas and rendering context management
 * - Legacy compatibility layer during ECS migration
 *
 * ## Architecture Overview
 * The engine follows the ECS pattern where:
 * - **Entities** are unique identifiers for game objects
 * - **Components** store data (position, health, velocity, etc.)
 * - **Systems** contain logic that operates on entities with specific components
 *
 * ## System Execution Order
 * Systems are executed in the order they are registered. Typical order:
 * 1. Input systems (process user input)
 * 2. Logic systems (AI, physics, collision)
 * 3. Rendering systems (draw to canvas)
 * 4. UI systems (update interface)
 *
 * ## Legacy Compatibility
 * During migration to ECS, this service provides compatibility methods for:
 * - Direct entity queries (getEnemies, etc.)
 * - Game state management (health, shards, level)
 * - Upgrade system integration
 *
 * @example
 * ```typescript
 * // Register systems in execution order
 * gameEngine.registerSystems(
 *   InputSystem,
 *   MovementSystem,
 *   CollisionSystem,
 *   RenderingSystem
 * );
 *
 * // Initialize with canvas and start game loop
 * gameEngine.initialize(canvasElement);
 * gameEngine.start();
 * ```
 *
 * @see {@link EntityManagerService} For entity and component management
 * @see {@link LoopSystemService} For game loop implementation
 * @see {@link System} For system interface definition
 *
 * @version 2.0.0
 * @since 1.0.0
 */
@Injectable({
  providedIn: 'root',
})
export class GameEngineService {
  private readonly WORLD_WIDTH = WORLD_CONFIG.BOUNDS.WIDTH;
  private readonly WORLD_HEIGHT = WORLD_CONFIG.BOUNDS.HEIGHT;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private systems: System[] = [];
  private hasLoggedFirstUpdate = false;
  private systemsInitialized = false;
  private frameCount = 0;
  private readonly systemErrorCounts = new Map<string, number>();
  private readonly systemSkipKeys = new Map<string, string>();
  // Reused per-frame object to avoid per-frame allocation of systemTimings
  private readonly systemTimings: Record<string, number> = {};

  // Hit stop effect for combat impact
  private hitStopRemaining = 0;

  private running$ = new BehaviorSubject<boolean>(false);
  private saveAdapter: SaveGameAdapter;
  private factionStandingSystem: FactionStandingSystemService | null = null;
  private curseRemovedSubscription?: Subscription;

  /** Health-regen tick (500ms interval handle). */
  private healthRegenInterval: number | null = null;

  constructor(
    private entityManager: EntityManagerService,
    private entityFactory: EntityFactoryECSService,
    private loopSystem: LoopSystemService,
    private gameState: GameStateService,
    private uiState: UIStateService,
    private performanceMonitor: PerformanceMonitorService,
    saveAdapter: SaveGameAdapter,
    private debugLog: DebugLogBridgeService,
    private buffSystem: BuffSystemService,
    private playerService: PlayerService,
    private playerUpgrades: PlayerUpgradesService,
    private progressionSystem: ProgressionSystemService,
    private upgradeService: UpgradeService,
    private curseService: CurseService,
    private frameSkipManager: FrameSkipManagerService,
    private berserkerSystem: BerserkerSystemService,
    private velocityMatrixSystem: VelocityMatrixSystemService,
    private burnSystem: BurnSystemService,
    private postProcessing: PostProcessingService,
    private gameRendering: GameRenderingService,
    private timeScaleService: TimeScaleService,
    private zoneStateService: ZoneStateService,
    private shopUpgradeInit: ShopUpgradeInitService,
    private minionTracker: MinionTrackerService,
    private runRoute: RunRouteService,
    private runPressure: RunPressureService,
    private runDraft: RunDraftService,
    private cameraState: CameraStateService,
    private legacyEcsBridge: LegacyEcsBridgeService,
    private ngZone: NgZone
  ) {
    this.saveAdapter = saveAdapter;
  }

  private initCurseRemovalSubscription(): void {
    // Subscribe to curse removal events to clean up associated buffs
    this.curseRemovedSubscription = this.curseService.curseRemoved$.subscribe((curseId) => {
      // Map curse IDs to their corresponding buff IDs
      const curseBuffMap: Record<string, string> = {
        vulnerability: 'vulnerability_curse',
      };

      const buffId = curseBuffMap[curseId];
      if (buffId) {
        // Remove the associated buff
        const removed = this.buffSystem.removeBuffById(buffId);
        if (removed) {
          this.debugLog.log(`🧹 Removed buff for purified curse: ${curseId}`, 'info', {
            source: 'game_engine',
            operation: 'curse_purified',
            curseId,
            buffId,
          });
        }
      }
    });
  }

  /**
   * Set faction standing system (called from photon-swarm component to avoid circular dependency)
   */
  setFactionStandingSystem(factionSystem: FactionStandingSystemService): void {
    this.factionStandingSystem = factionSystem;
  }

  /**
   * Register a system to be executed in the game loop
   *
   * Systems are executed in the order they are registered, so registration order matters.
   * For example, input systems should be registered before movement systems,
   * and movement systems before rendering systems.
   *
   * @param systemType - The constructor function for the system class
   *
   * @example
   * ```typescript
   * gameEngine.registerSystem(MovementSystem);
   * gameEngine.registerSystem(CollisionSystem);
   * ```
   *
   * @throws {Error} If the system constructor is invalid
   * @see {@link registerSystems} For registering multiple systems at once
   * @see {@link registerSystemInstance} For registering pre-instantiated systems
   */
  public registerSystem(systemType: SystemType): void {
    const system = new systemType();
    this.systems.push(system);

    // Initialize immediately if engine is already initialized
    if (this.systemsInitialized && system.init) {
      system.init(this.entityManager);
    }
  }

  /**
   * Register multiple systems at once in the specified order
   *
   * This is a convenience method equivalent to calling registerSystem()
   * multiple times. Systems will be executed in the order provided.
   *
   * @param systemTypes - Variable number of system constructor functions
   *
   * @example
   * ```typescript
   * gameEngine.registerSystems(
   *   InputSystem,
   *   MovementSystem,
   *   CollisionSystem,
   *   RenderingSystem
   * );
   * ```
   *
   * @see {@link registerSystem} For registering a single system
   */
  public registerSystems(...systemTypes: SystemType[]): void {
    systemTypes.forEach((type) => this.registerSystem(type));
  }

  /**
   * Register a system instance (for Angular DI compatibility)
   * Use this when systems require dependency injection
   */
  public registerSystemInstance(system: System): void {
    // Angular services are singleton instances. Guard against a repeated registry
    // call adding the same instance twice and executing it multiple times per frame.
    if (this.systems.includes(system)) return;

    this.systems.push(system);

    // Initialize immediately if engine is already initialized
    if (this.systemsInitialized && system.init) {
      system.init(this.entityManager);
    }
  }

  /**
   * Register multiple system instances at once
   */
  public registerSystemInstances(...systems: System[]): void {
    systems.forEach((system) => this.registerSystemInstance(system));
  }

  /** Whether this exact DI-owned system instance is already registered. */
  public hasSystemInstance(system: System): boolean {
    return this.systems.includes(system);
  }

  /**
   * Remove a system from the engine
   */
  public removeSystem(systemType: SystemType): void {
    const index = this.systems.findIndex((s) => s.constructor === systemType);
    if (index !== -1) {
      const system = this.systems[index];
      if (system.destroy) {
        system.destroy();
      }
      this.systems.splice(index, 1);
    }
  }

  /**
   * Clear all systems
   */
  public clearSystems(): void {
    this.systems.forEach((system) => {
      if (system.destroy) {
        system.destroy();
      }
    });
    this.systems = [];
  }

  /**
   * Initialize the game engine with a canvas element
   *
   * Sets up the rendering context and initializes all registered systems.
   * This must be called before starting the game loop.
   *
   * @param canvas - The HTML canvas element to render to
   *
   * @example
   * ```typescript
   * const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
   * gameEngine.initialize(canvas);
   * ```
   *
   * @throws {Error} If canvas is null or context creation fails
   * @see {@link start} To begin the game loop after initialization
   */
  public initialize(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
    });
    if (!ctx) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = ctx;

    // Initialize all registered systems
    this.initializeSystems();

    // Register berserker system for dynamic damage scaling
    this.registerSystemInstance(this.berserkerSystem);

    // Register velocity matrix system for speed/damage feedback loop
    this.registerSystemInstance(this.velocityMatrixSystem);
  }

  private initializeSystems(): void {
    if (this.systemsInitialized) return;

    this.systems.forEach((system) => {
      if (system.init) {
        system.init(this.entityManager);
      }
    });

    this.systemsInitialized = true;
  }

  /**
   * Start the main game loop
   *
   * Begins the game execution cycle, calling update() on all registered systems
   * each frame. Also resets game state and initializes timing.
   *
   * @example
   * ```typescript
   * gameEngine.initialize(canvas);
   * gameEngine.start(); // Game loop begins
   * ```
   *
   * @throws {Error} If engine is not initialized or already running
   * @see {@link pause} To temporarily halt execution
   * @see {@link stop} To completely stop the game
   * @see {@link resume} To continue after pausing
   */
  public start(): void {
    this.debugLog.log('🔍 GameEngine: start() called', 'info', {
      source: 'game_engine',
      operation: 'start_entry',
      alreadyRunning: this.running$.value,
    });

    if (this.running$.value) return;

    this.reset();

    // CRITICAL FIX: Generate and set world seed for new games
    // This was missing and causing the Four Kings Territory system to never initialize
    if (!this.currentWorldSeed) {
      this.currentWorldSeed = this.generateNewWorldSeed();
      this.debugLog.log('🆕 Generated new world seed for start()', 'info', {
        source: 'game_engine',
        operation: 'start_new_seed',
        seed: this.currentWorldSeed,
      });
    }

    this.debugLog.log('🌍 About to call setWorldSeed() from start()', 'info', {
      source: 'game_engine',
      operation: 'start_set_seed',
      seed: this.currentWorldSeed,
    });

    this.setWorldSeed(this.currentWorldSeed);

    this.running$.next(true);
    this.gameState.setPaused(false);
    this.gameState.setStartTime(window.performance.now());
    this.gameState.setLastTime(window.performance.now());

    this.loopSystem.start((deltaTime, currentTime) => {
      this.update(deltaTime, currentTime);
    });
  }

  /**
   * Start the game loop without calling reset() - for respawn scenarios
   */
  public startWithoutReset(): void {
    if (this.running$.value) return;

    this.running$.next(true);
    this.gameState.setPaused(false);
    if (this.gameState.getStartTime() <= 0) {
      this.gameState.setStartTime(window.performance.now());
    }
    this.gameState.setLastTime(window.performance.now());

    this.loopSystem.start((deltaTime, currentTime) => {
      this.update(deltaTime, currentTime);
    });
  }

  /**
   * Pause the game
   */
  public pause(): void {
    if (!this.running$.value || this.gameState.isPaused()) return;

    this.gameState.setPaused(true);
    this.loopSystem.pause();
  }

  /**
   * Resume the game
   */
  public resume(): void {
    if (!this.running$.value || !this.gameState.isPaused()) return;

    this.gameState.setPaused(false);
    this.gameState.setLastTime(window.performance.now());
    this.loopSystem.resume();
  }

  /**
   * Stop the game
   */
  public stop(): void {
    if (!this.running$.value) return;

    this.running$.next(false);
    this.loopSystem.stop();
    this.gameState.setPaused(true);
  }

  public destroy(): void {
    this.stop();

    // The health-regen tick is created per-run in reset(); without this clear the
    // root-scoped service leaks one no-op 500ms interval past component teardown.
    if (this.healthRegenInterval !== null) {
      clearInterval(this.healthRegenInterval);
      this.healthRegenInterval = null;
    }

    // Iterate all registered ECS systems and call destroy() on any that implement it.
    // The System interface declares `destroy?(): void` as optional, so systems opt in
    // by implementing the method. This avoids the maintenance trap of hardcoding a
    // list of "systems that need cleanup" — any new system added later is covered
    // automatically as long as it implements destroy().
    for (const system of this.systems) {
      try {
        system.destroy?.();
      } catch (err) {
        this.debugLog.log('⚠️ System destroy() threw', 'error', {
          source: 'game_engine',
          operation: 'destroy',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ZoneStateService is not a registered ECS system (it's a bare Injectable that
    // the update loop calls externally). Destroy it here so its Subjects complete.
    this.zoneStateService.destroy();

    this.loopSystem.destroy();
    this.running$.complete();
  }

  /**
   * Stop and clear one routed game session without irreversibly disposing the
   * root-scoped engine and system services. The same DI instances can then be
   * registered and initialized when the route is mounted again.
   */
  public deactivateSession(): void {
    this.stop();

    if (this.healthRegenInterval !== null) {
      clearInterval(this.healthRegenInterval);
      this.healthRegenInterval = null;
    }

    if (this.curseRemovedSubscription) {
      this.curseRemovedSubscription.unsubscribe();
      this.curseRemovedSubscription = undefined;
    }

    // reset() is deliberately reusable. Do not call destroy() here: many root
    // systems complete their public Subjects in destroy() and cannot be revived.
    this.resetRegisteredSystems('deactivate_session');

    this.entityFactory.resetSession();
    this.entityManager.clear();
    this.zoneStateService.reset();
    this.runRoute.reset();
    this.runPressure.reset();
    this.runDraft.reset();
    this.postProcessing.clear();
    this.gameRendering.clearRenderCaches();
    this.canvas = null;
    this.ctx = null;
    this.performanceMonitor.resetMetrics();
    this.systemErrorCounts.clear();
    this.systemSkipKeys.clear();
    for (const key in this.systemTimings) {
      delete this.systemTimings[key];
    }

    this.systems = [];
    this.systemsInitialized = false;
    this.hasLoggedFirstUpdate = false;
    this.frameCount = 0;
    this.loopSystem.destroy();
  }

  /** Reset every registered system that opts into reusable run cleanup. */
  private resetRegisteredSystems(operation: 'game_reset' | 'deactivate_session'): void {
    for (const system of this.systems) {
      try {
        system.reset?.();
      } catch (error) {
        this.debugLog.log('⚠️ System reset() threw', 'error', {
          source: 'game_engine',
          operation,
          system: system.constructor.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Recreate entities owned by reusable systems after the ECS world is cleared. */
  private initializeRegisteredRunSystems(): void {
    for (const system of this.systems) {
      try {
        system.initializeRun?.(this.entityManager);
      } catch (error) {
        this.debugLog.log('⚠️ System initializeRun() threw', 'error', {
          source: 'game_engine',
          operation: 'initialize_run',
          system: system.constructor.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Reset the game state
   */
  public reset(): void {
    // Unsubscribe from curse removal subscription to prevent memory leak
    if (this.curseRemovedSubscription) {
      this.curseRemovedSubscription.unsubscribe();
      this.curseRemovedSubscription = undefined;
    }

    // Player state owns transient timers and run-scoped upgrade flags. Reset it
    // before GameState so starting health is derived from a clean baseline.
    this.playerService.reset();

    // The registry is the ownership boundary for ECS run state. Any new system
    // that implements reset() is covered automatically without another allowlist.
    this.resetRegisteredSystems('game_reset');

    // Clear pooled IDs before EntityManager resets ID allocation back to 1.
    this.entityFactory.resetSession();
    this.entityManager.clear();
    this.initializeRegisteredRunSystems();

    // Reset game state
    this.gameState.reset();
    this.uiState.reset();

    // CRITICAL: Reset progression system to prevent constant upgrade popups
    this.progressionSystem.reset();

    // Reset upgrades and curses for roguelike gameplay
    // This ensures clean slate on respawn/restart
    this.upgradeService.resetAllUpgrades();
    this.curseService.resetAllCurses();

    // Reset BuffSystemService to clear powerup gameplay multipliers
    this.buffSystem.reset();
    // Reset MinionTrackerService so recycled summoner IDs start with a clean cap
    // count instead of inheriting the previous run's minion set.
    // Not a registered ECS system — injected directly.
    this.minionTracker.reset();
    // Clear post-processing effects (chromatic aberration, etc.)
    this.postProcessing.clear();

    // Reset time scale to prevent slow-motion persisting across games
    this.timeScaleService.reset();

    // Reset zone state so the next run starts fresh from Zone 1
    this.zoneStateService.reset();
    this.runRoute.reset();
    this.runPressure.reset();
    this.runDraft.reset();

    // Evict render caches to prevent unbounded memory growth across games
    this.gameRendering.clearRenderCaches();

    // Reset engine-owned run telemetry and transient presentation state.
    this.frameCount = 0;
    this.hitStopRemaining = 0;
    this.hasLoggedFirstUpdate = false;
    this.performanceMonitor.resetMetrics();
    this.frameSkipManager.reset();
    this.systemErrorCounts.clear();
    this.systemSkipKeys.clear();
    for (const key in this.systemTimings) {
      delete this.systemTimings[key];
    }

    this.debugLog.log('♾️ Roguelike reset: Upgrades, curses, and faction standings cleared on respawn', 'info', {
      source: 'game_engine',
      operation: 'reset',
      reason: 'game_restart',
    });

    // Game state is reset by GameStateService

    // Restart health-regen interval (new run, may have different regen rate after restore)
    this.startHealthRegenTick();

    // Restore persisted shop upgrades for this run (after player stats are reset)
    this.shopUpgradeInit.resetSession();
    this.shopUpgradeInit.applyPersistedShopUpgrades(this, this.playerService);
    // Persistent max-HP upgrades are applied after GameState.reset(), so bring
    // current health up to the final run-start maximum once restoration ends.
    this.gameState.setHealth(this.playerService.getMaxHealth(), 'run_start_shop_restore');

    const zoneGateSystem = this.getSystem(ZoneGateSystemService as SystemType<ZoneGateSystemService>);
    const treasureCacheSystem = this.getSystem(TreasureCacheSystemService as SystemType<TreasureCacheSystemService>);
    const guardianSpawnerSystem = this.getSystem(
      GuardianSpawnerSystemService as SystemType<GuardianSpawnerSystemService>
    );

    // Re-spawn world entities that were destroyed by entityManager.clear() above.
    // Mirrors the original spawn order from SystemRegistryService.registerSystems().
    // Without this, treasure caches stay deleted for the rest of the session — there
    // is no lazy-spawn loop equivalent for caches like there is for guardians.
    if (treasureCacheSystem) {
      treasureCacheSystem.spawnAllCaches(this.entityManager);
    }
    if (guardianSpawnerSystem) {
      guardianSpawnerSystem.spawnAllGuardians();
    }
    if (zoneGateSystem) {
      zoneGateSystem.spawnAllGates();
    }

    this.initCurseRemovalSubscription();
  }

  // Store the current world seed
  private currentWorldSeed: string | null = null;

  /**
   * Respawn with new world seed - resets player stats but preserves cosmetics
   */
  public respawnWithNewSeed(): void {
    // Generate new world seed
    const newSeed = this.generateNewWorldSeed();
    this.currentWorldSeed = newSeed;

    // Clear save data to prevent loading old state
    this.clearSaveData();

    // Reset game state completely
    this.reset();

    // Set new world seed for territory systems
    this.setWorldSeed(newSeed);

    this.debugLog.log('🌍 Respawning with new world seed', 'info', {
      newSeed,
      resetStats: true,
      preserveCosmetics: true,
    });
  }

  /**
   * Respawn with same world seed - resets player stats but keeps world
   */
  public respawnSameWorld(): void {
    // Use existing seed or generate new one if none exists
    if (!this.currentWorldSeed) {
      this.currentWorldSeed = this.generateNewWorldSeed();
    }

    // Clear only player data, not world data
    this.clearPlayerData();

    // Reset game state
    this.reset();

    // Reuse same world seed
    this.setWorldSeed(this.currentWorldSeed);

    this.debugLog.log('🌍 Respawning in same world', 'info', {
      seed: this.currentWorldSeed,
      resetStats: true,
      preserveWorld: true,
    });
  }

  /**
   * Generate a new world seed based on current timestamp
   */
  private generateNewWorldSeed(): string {
    const timestamp = Date.now();
    const kingCount = 4; // Four Kings mode
    const version = '1.0';
    return `${timestamp}-k${kingCount}-v${version}`;
  }

  /**
   * Set world seed for territory systems
   */
  private setWorldSeed(seed: string): void {
    this.debugLog.log('🔍 setWorldSeed: Starting system lookup', 'info', {
      source: 'game_engine',
      operation: 'setWorldSeed_start',
      seed,
      systemsCount: this.systems.length,
    });

    // Find territory systems and set their seed
    const fourKingsSystem = this.getSystem(FourKingsTerritoryService as SystemType<FourKingsTerritoryService>);

    this.debugLog.log('🔍 setWorldSeed: System lookup result', 'info', {
      source: 'game_engine',
      operation: 'system_lookup',
      found: !!fourKingsSystem,
      hasSeedMethod: fourKingsSystem && typeof fourKingsSystem.setSeed === 'function',
    });

    if (fourKingsSystem && typeof fourKingsSystem.setSeed === 'function') {
      this.debugLog.log('🔍 setWorldSeed: About to call setSeed', 'info', {
        source: 'game_engine',
        operation: 'calling_setSeed',
        seed,
      });
      fourKingsSystem.setSeed(seed);
    }

    // Send to debug bridge
    this.debugLog.log('🎯 World seed applied to territory systems', 'info', {
      seed,
      systemsFound: fourKingsSystem ? 1 : 0,
    });
  }

  /**
   * Clear only player data, preserving world state
   */
  private clearPlayerData(): void {
    // Reset player stats through GameStateService
    this.gameState.reset();

    this.debugLog.log('🧹 Cleared player data only', 'info', { preservedWorldSeed: this.currentWorldSeed });
  }

  private getSystemSkipKey(systemName: string): string {
    let key = this.systemSkipKeys.get(systemName);
    if (!key) {
      key = systemName
        .replace(/System(Service)?$/, '')
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
      this.systemSkipKeys.set(systemName, key);
    }
    return key;
  }

  private syncPlayerPositionToECS(): void {
    // Get player entity from ECS
    const playerEntities = this.entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (playerEntities.length === 0) {
      return; // No player entity yet
    }

    const playerEntityId = playerEntities[0];
    const ecsPosition = this.entityManager.getComponent(playerEntityId, PositionComponent);

    if (!ecsPosition) {
      return;
    }

    // Get current position from PlayerService (authoritative source)
    const serviceX = this.playerService.x$.value;
    const serviceY = this.playerService.y$.value;

    // Update ECS position to match PlayerService
    ecsPosition.x = serviceX;
    ecsPosition.y = serviceY;
  }

  /**
   * Clear save data to prevent loading old state
   */
  private clearSaveData(): void {
    // Note: This clears the save but preserves cosmetics (shop data)
    // Cosmetics are stored with separate keys in localStorage:
    // - 'photon-swarm:photon-swarm-cosmetics' (cosmetic unlocks)
    // - 'photon-swarm:photon-swarm-active-cosmetics' (active selections)
    // Game save data is stored with key 'photon-swarm:save-v2'
    try {
      // Clear game save data only
      window.localStorage.removeItem('photon-swarm:save-v2');

      this.debugLog.log('🗑️ Cleared save data for fresh respawn', 'info', {
        clearedKeys: ['save-v2'],
        preservedKeys: ['photon-swarm-cosmetics', 'photon-swarm-active-cosmetics'],
        preservedCosmetics: true,
      });
    } catch (error) {
      this.debugLog.log('Failed to clear save data', 'warning', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Trigger hit stop effect for combat impact
   * @param duration Duration in milliseconds
   */
  public triggerHitStop(_duration: number): void {
    this.hitStopRemaining = _duration;
  }

  /**
   * Main update loop — runs all systems.
   *
   * PERFORMANCE NOTES (see rendering comments below):
   * - deltaTime is wall-clock time between RAF callbacks, NOT processing time.
   *   The gap between _totalUpdateTime and deltaTime is browser overhead.
   * - All setInterval/setTimeout in game services MUST use runOutsideAngular
   *   to avoid triggering Angular change detection (~215 CD cycles/sec before fix).
   * - Per-system timings are recorded in this.systemTimings (reused object).
   *   _totalUpdateTime and _PlayerService are synthetic entries for the untimed sections.
   */
  private update(deltaTime: number, currentTime: number): void {
    if (!this.hasLoggedFirstUpdate) {
      this.hasLoggedFirstUpdate = true;
      this.debugLog.log('🔍 TEST7: First game loop update() call', 'info', {
        source: 'test_suite',
        test: 'first_update',
        hasWorldSeed: !!this.currentWorldSeed,
        systemsInitialized: this.systemsInitialized,
        systemCount: this.systems.length,
      });
    }

    if (this.gameState.isPaused() || !this.canvas) return;

    // Handle hit stop effect
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining -= deltaTime;
      if (this.hitStopRemaining <= 0) {
        this.hitStopRemaining = 0;
      } else {
        // During hit stop, reduce deltaTime to create freeze frame effect
        deltaTime = deltaTime * 0.1; // 10% speed during hit stop
      }
    }

    // Apply global time scale (slow-motion on dramatic moments)
    deltaTime = deltaTime * this.timeScaleService.getTimeScale();

    // Increment frame counter
    this.frameCount++;

    // Detailed per-system timing is sampled in development and disabled in production.
    // FPS/entity history remains active every frame without ~100 performance.now() calls.
    const measureSystemTimings = this.performanceMonitor.beginFrame(this.frameCount, MONITORING_CONFIG.ENABLED);
    const systemTimings = this.systemTimings;
    if (measureSystemTimings) {
      for (const key in systemTimings) {
        systemTimings[key] = 0;
      }
    }

    const updateStart = measureSystemTimings ? window.performance.now() : 0;

    // Update player first (handles movement, charging, etc)
    const playerStart = measureSystemTimings ? window.performance.now() : 0;
    this.playerService.update(deltaTime);
    if (measureSystemTimings) {
      systemTimings['_PlayerService'] = window.performance.now() - playerStart;
    }

    // Sync player position from PlayerService to ECS before systems run
    this.syncPlayerPositionToECS();

    // Update zone state early — before AI and spawn systems read the current zone.
    // Uses PlayerService as the authoritative position source (same as syncPlayerPositionToECS).
    this.zoneStateService.update(this.playerService.x$.value, this.playerService.y$.value);

    // Update all systems in order with frame skipping for performance
    for (const system of this.systems) {
      const systemName = system.constructor.name;

      // Convert system name to lowercase kebab-case for frame skip lookup (cached)
      const skipKey = this.getSystemSkipKey(systemName);

      // Check if this system should run this frame
      if (!this.frameSkipManager.shouldRun(skipKey)) {
        continue; // Skip this system this frame
      }

      const startTime = measureSystemTimings ? window.performance.now() : 0;
      const errorCount = this.systemErrorCounts.get(systemName) ?? 0;
      if (errorCount >= 5) {
        continue; // System disabled after 5 consecutive failures
      }
      try {
        system.update(deltaTime, this.entityManager);
        // Reset error count on success
        if (errorCount > 0) {
          this.systemErrorCounts.delete(systemName);
        }
      } catch (error) {
        const newCount = errorCount + 1;
        this.systemErrorCounts.set(systemName, newCount);
        if (newCount >= 5) {
          this.debugLog.log(`System ${systemName} disabled after 5 consecutive errors`, 'error', {
            source: 'game_engine',
            operation: 'circuit_breaker',
            system: systemName,
            lastError: error instanceof Error ? error.message : String(error),
          });
        } else {
          this.debugLog.log(`System ${systemName} threw an error (${newCount}/5)`, 'error', {
            source: 'game_engine',
            operation: 'system_update',
            system: systemName,
            errorCount: newCount,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (measureSystemTimings) {
        systemTimings[systemName] = window.performance.now() - startTime;
      }

      // A terminal event subscriber stops/pauses synchronously. Do not let later
      // systems or post-system updates mutate a run after its end screen opened.
      if (!this.running$.value || this.gameState.isPaused()) return;
    }

    // Update game state (handles health regen)
    this.gameState.update(deltaTime);

    // Update buff system (handles buff expiration)
    this.buffSystem.update();

    // Only adjust frame skipping every 60 frames (~1 second) to prevent oscillation
    if (this.frameCount % 60 === 0) {
      const summary = this.performanceMonitor.getPerformanceSummary();
      if (summary && summary.averageFps) {
        this.frameSkipManager.adjustForPerformance(summary.averageFps, 60);
      }
    }

    if (measureSystemTimings) {
      // The gap between this and deltaTime is browser overhead.
      systemTimings['_totalUpdateTime'] = window.performance.now() - updateStart;
    }

    // Record frame metrics for FPS tracking
    this.performanceMonitor.recordFrameMetrics(
      deltaTime,
      measureSystemTimings ? systemTimings : null,
      this.entityManager.getEntityCount(),
      currentTime
    );

    // Update UI state
    this.uiState.updateNotifications(currentTime);
    this.uiState.updateDamageFlash();
  }

  /**
   * Toggle pause state
   */
  public togglePause(): void {
    if (this.gameState.isPaused()) {
      this.resume();
    } else {
      this.pause();
    }
  }

  // === GETTERS ===

  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  public getContext(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  public getWorldWidth(): number {
    return this.WORLD_WIDTH;
  }

  public getWorldHeight(): number {
    return this.WORLD_HEIGHT;
  }

  public isRunning(): boolean {
    return this.running$.value;
  }

  public isPaused(): boolean {
    return this.gameState.isPaused();
  }

  public get running(): Observable<boolean> {
    return this.running$.asObservable();
  }

  /**
   * Get the entity manager instance
   */
  public getEntityManager(): EntityManagerService {
    return this.entityManager;
  }

  /**
   * Get all registered systems
   */
  public getSystems(): ReadonlyArray<System> {
    return this.systems;
  }

  /**
   * Get a specific system by type
   */
  public getSystem<T extends System>(systemType: SystemType<T>): T | undefined {
    if (systemType.name === 'FourKingsTerritoryService') {
      this.debugLog.log('🔍 TEST5: getSystem() called for FourKingsTerritoryService', 'info', {
        source: 'test_suite',
        test: 'system_lookup',
        totalSystems: this.systems.length,
      });
    }

    return this.systems.find((s) => s.constructor === systemType) as T | undefined;
  }

  // ========================================================================
  // TEMPORARY COMPATIBILITY LAYER - TO BE REMOVED DURING MIGRATION
  // ========================================================================

  /**
   * Signal accessor for GameState. The legacy `state$` observable was
   * retired in Sprint A8d once the three remaining consumers (HUD,
   * Shop, PhotonSwarmComponent) all migrated to effect()-based reads.
   */
  public get state(): typeof this.gameState.state {
    return this.gameState.state;
  }
  public get levelUpRequest$(): Observable<void> {
    return this.gameState.levelUpRequest$;
  }
  public get gameOver$(): Observable<GameStats> {
    return this.gameState.gameOver$;
  }

  // Multipliers and flags
  public get movementSpeedMultiplier(): number {
    return this.buffSystem.movementSpeedMultiplier;
  }
  public get beamDamageMultiplier(): number {
    return this.buffSystem.beamDamageMultiplier;
  }
  public get damageTakenMultiplier(): number {
    return this.buffSystem.damageTakenMultiplier;
  }
  public get effectChanceMultiplier(): number {
    return this.buffSystem.effectChanceMultiplier;
  }
  public get burnDamageMultiplier(): number {
    return this.buffSystem.burnDamageMultiplier;
  }
  public get experienceGainMultiplier(): number {
    return this.buffSystem.experienceGainMultiplier;
  }
  public get isFocusFiring(): boolean {
    return this.playerService.getIsFocusFiring();
  }
  /** Returns the Focus Fire speed penalty as a percentage (e.g. 20 for 20% slower). */
  public get focusFireSpeedPenalty(): number {
    return Math.round((1 - this.playerUpgrades.getFocusFireSpeedMultiplier()) * 100);
  }
  public enemySpawnMultiplier = 1;

  // Player reference for compatibility
  public get player(): LegacyPlayer {
    return {
      getMaxHealth: () => this.playerService.getMaxHealth(),
      increaseMaxHealth: (amount: number) => this.playerUpgrades.increaseMaxHealth(amount),
      getHealthRegenRate: () => this.playerUpgrades.getHealthRegenRate(),
      setHealthRegeneration: (rate: number) => this.playerUpgrades.setHealthRegeneration(rate),
    };
  }

  // Entity queries - Bridge to ECS during migration
  getEnemies(): LegacyEnemy[] {
    return this.legacyEcsBridge.getEnemies();
  }

  // Game state methods
  getShards(): number {
    return this.gameState.getShards();
  }
  spendShards(amount: number): boolean {
    return this.gameState.spendShards(amount);
  }
  addShards(amount: number): void {
    this.gameState.addShards(amount);
  }
  refundShards(amount: number): void {
    this.gameState.refundShards(amount);
  }

  getPlayerHealth(): number {
    return this.gameState.getHealth();
  }
  getPlayerMaxHealth(): number {
    // Try to get max health from ECS player entity first
    const playerEntities = this.entityManager.getEntitiesWithComponents(PlayerControlledComponent, HealthComponent);
    if (playerEntities.length > 0) {
      const healthComp = this.entityManager.getComponent(playerEntities[0], HealthComponent);
      if (healthComp) {
        return healthComp.maxHealth;
      }
    }
    // Fallback to player service
    return this.playerService.getMaxHealth();
  }

  heal(amount: number, source: string = 'unknown'): void {
    // GameState.heal() already logs the heal event, no need for duplicate logging
    this.gameState.heal(amount, source); // Pass source parameter through
    this.emitState();
  }

  takeDamage(amount: number, source: string = 'unknown'): void {
    // Forward to GameStateService (single source of truth)
    this.gameState.takeDamage(amount, source);
  }

  // Player methods
  getPlayerName(): string {
    return this.gameState.getPlayerName();
  }
  setPlayerName(name: string): void {
    this.gameState.setPlayerName(name);
  }
  /** Pure Pilot-<id> generator — see GameStateService.generatePilotName(). */
  generatePilotName(): string {
    return this.gameState.generatePilotName();
  }

  // Get PlayerService for upgrade system
  getPlayerService(): PlayerService {
    return this.playerService;
  }

  // Upgrade methods
  increaseMaxHealth(amount: number): void {
    // Implement max health increase through PlayerUpgradesService
    this.playerUpgrades.increaseMaxHealth(amount);
    // Also heal the amount to make the upgrade feel impactful
    this.gameState.heal(amount, 'max_health_upgrade');

    this.debugLog.log(`💪 Max health increased by ${amount}`, 'success', {
      source: 'game_engine',
      operation: 'increase_max_health',
      amount,
      newMaxHealth: this.playerService.getMaxHealth(),
    });
  }
  increaseBeamDamage(amount: number): void {
    // Direct increase through PlayerService (BuffSystem integration needs fixing)
    this.playerService.increaseBeamDamage(amount);
  }
  increaseMovementSpeed(amount: number): void {
    this.playerService.increaseSpeed(amount);
    this.debugLog.log(`Movement speed upgrade applied: ${(amount * 100).toFixed(0)}%`, 'info', {
      source: 'game_engine',
      operation: 'increase_movement_speed',
      amount,
    });
  }
  increaseBeamRotationSpeed(amount: number): void {
    this.playerService.increaseBeamRotationSpeed(amount);
  }
  increaseTargetingHoldDuration(count: number): void {
    this.playerService.increaseTargetingHoldDuration(count);
  }
  increaseBeamSpeed(amount: number): void {
    this.playerService.increaseBeamSpeed(amount);
  }
  increaseEffectChance(amount: number): void {
    this.playerService.increaseEffectChance(amount);
  }
  increaseDashEfficiency(amount: number): void {
    this.playerService.increaseDashEfficiency(amount);
  }
  increaseFireRate(amount: number): void {
    this.playerService.increaseFireRate(amount);
  }
  enhanceShardMagnetism(amount: number): void {
    this.playerService.enhanceShardMagnetism(amount);
  }
  addBurnChance(amount: number): void {
    this.playerService.addBurnChance(amount);
  }
  addRecoilDamage(amount: number): void {
    this.playerService.addRecoilDamage(amount);
  }
  increaseBurnDamage(amount: number): void {
    this.playerService.increaseBurnDamage(amount);
  }

  // Unlock methods
  unlockShardMagnetism(): void {
    this.playerService.unlockShardMagnetism();
  }
  unlockDoubleBeam(): void {
    this.playerService.unlockDoubleBeam();
  }
  unlockDischarge(): void {
    this.playerService.unlockDischarge();
  }
  unlockVoidBeam(): void {
    this.playerService.unlockVoidBeam();
  }
  unlockShieldBreaker(): void {
    this.playerService.unlockShieldBreaker();
  }

  /**
   * Apply the Emergency Barrier (shop: shield_generator) at the given level.
   * Delegates to PlayerUpgradesService where state lives.
   */
  applyEmergencyBarrierLevel(level: number): void {
    this.playerUpgrades.applyBarrierLevel(level);
  }

  /**
   * Start (or restart) the 500ms health-regen interval.
   * The shop description says "8% HP regen / 10s" per level, which is
   * getHealthRegenRate() HP per second — applied as rate × 0.5 every 500ms.
   * Ticks are skipped when the game is paused or not running.
   */
  private startHealthRegenTick(): void {
    if (this.healthRegenInterval !== null) {
      clearInterval(this.healthRegenInterval);
    }
    this.ngZone.runOutsideAngular(() => {
      this.healthRegenInterval = window.setInterval(() => {
        if (this.gameState.isPaused() || !this.running$.value) return;
        const regenRate = this.playerUpgrades.getHealthRegenRate(); // HP per second
        if (regenRate <= 0) return;
        // Apply half-second worth of regen; clamp to max HP inside heal()
        const healAmount = regenRate * 0.5;
        this.gameState.heal(healAmount, 'health_regen_tick');
      }, 500);
    });
  }
  enableBurnSpread(): void {
    this.burnSystem.enableBurnSpread();
  }

  selectBeamCore(coreId: BeamCoreId): void {
    this.playerUpgrades.selectBeamCore(coreId);
  }

  evolveBeamCore(mutationId: BeamMutationId): void {
    this.playerUpgrades.evolveBeamCore(mutationId);
  }

  chooseRunRoute(zoneId: RunRouteZoneId, factionId: number, grantAlliance: boolean): void {
    this.runRoute.chooseRoute(zoneId, factionId, grantAlliance);
  }

  applyRunPressure(change: RunPressureChange, sourceId: string): void {
    this.runPressure.apply(change, sourceId);
  }

  increaseExperienceGain(sourceId: string, multiplier: number): void {
    this.buffSystem.applyBuff(sourceId, 'experienceGain', multiplier, Infinity);
  }

  // Curse methods
  applyVulnerabilityCurse(): void {
    // Apply damage taken multiplier via buff system
    this.buffSystem.applyBuff('vulnerability_curse', 'damageTaken', 1.5, Infinity);
  }
  setBurnSpreadChance(chance: number): void {
    this.burnSystem.setBurnSpreadChance(chance);
  }
  /** Capture every mutable domain used by current run-card effects. */
  captureUpgradeTransaction(): UpgradeTransactionSnapshot {
    return {
      playerUpgrades: this.playerUpgrades.captureUpgradeTransaction(),
      health: this.gameState.getHealth(),
      buffs: this.buffSystem.captureUpgradeTransaction(),
      burn: this.burnSystem.captureUpgradeTransaction(),
      curses: this.curseService.captureUpgradeTransaction(),
      runRoute: this.runRoute.captureUpgradeTransaction(),
      runPressure: this.runPressure.captureUpgradeTransaction(),
      factions: this.factionStandingSystem?.serialize() ?? null,
    };
  }

  /** Restore a failed card atomically, including health and auxiliary combat systems. */
  restoreUpgradeTransaction(snapshot: UpgradeTransactionSnapshot): void {
    this.playerUpgrades.restoreUpgradeTransaction(snapshot.playerUpgrades);
    this.buffSystem.restoreUpgradeTransaction(snapshot.buffs);
    this.burnSystem.restoreUpgradeTransaction(snapshot.burn);
    this.curseService.restoreUpgradeTransaction(snapshot.curses);
    this.runRoute.restoreUpgradeTransaction(snapshot.runRoute);
    this.runPressure.restoreUpgradeTransaction(snapshot.runPressure);
    if (snapshot.factions && this.factionStandingSystem) this.factionStandingSystem.deserialize(snapshot.factions);
    this.gameState.setHealth(snapshot.health, 'upgrade_transaction_rollback');
  }

  // UI methods
  toggleFullMap(): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🗺️ GameEngine.toggleFullMap() called', 'info', {
        source: 'game_engine',
        beforeState: this.uiState.fullMapEnabled(),
      });
    }
    this.uiState.toggleFullMap();
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🗺️ GameEngine.toggleFullMap() completed', 'info', {
        source: 'game_engine',
        afterState: this.uiState.fullMapEnabled(),
      });
    }
  }
  isFullMapEnabled(): boolean {
    return this.uiState.fullMapEnabled();
  }
  getCameraZoomScale(): number {
    return this.cameraState.getCameraZoomScale();
  }

  // Camera setters for rendering system
  setCameraZoomScale(scale: number): void {
    this.cameraState.setCameraZoomScale(scale);
  }

  // Save/Load methods
  saveGameState(): boolean {
    try {
      // Get current player position
      const playerEntities = this.entityManager.getEntitiesWithComponents(
        PlayerControlledComponent,
        PositionComponent,
        HealthComponent
      );

      if (playerEntities.length === 0) {
        this.debugLog.log('Cannot save: No player entity found', 'error', { source: 'game_engine', operation: 'save' });
        return false;
      }

      const playerEntity = playerEntities[0];
      const position = this.entityManager.getComponent(playerEntity, PositionComponent);
      const health = this.entityManager.getComponent(playerEntity, HealthComponent);

      if (!position || !health) return false;

      // Get enemy snapshots
      const enemySnapshots: EnemySnapshot[] = [];
      const enemyEntities = this.entityManager.getEntitiesWithComponents(
        EnemyTypeComponent,
        PositionComponent,
        HealthComponent
      );

      for (const enemyId of enemyEntities) {
        // Guardians are deterministic world fixtures and are regenerated by reset().
        // Persisting them as ordinary enemies would duplicate them on continue.
        if (this.entityManager.hasComponent(enemyId, TerritorialGuardianComponent)) continue;

        const enemyPos = this.entityManager.getComponent(enemyId, PositionComponent);
        const enemyHealth = this.entityManager.getComponent(enemyId, HealthComponent);
        const enemyType = this.entityManager.getComponent(enemyId, EnemyTypeComponent);
        const enemyVel = this.entityManager.getComponent(enemyId, VelocityComponent);
        const enemyFaction = this.entityManager.getComponent(enemyId, FactionComponent);

        if (enemyPos && enemyHealth && enemyType) {
          enemySnapshots.push({
            id: enemyId.toString(),
            type: enemyType.type,
            rarity:
              enemyType.rarity === Rarity.Rare
                ? 'rare'
                : enemyType.rarity === Rarity.Legendary
                  ? 'legendary'
                  : 'common',
            isElite: enemyType.isElite,
            isChampion: enemyType.isChampion,
            factionId: enemyFaction?.kingId,
            x: enemyPos.x,
            y: enemyPos.y,
            health: enemyHealth.health,
            maxHealth: enemyHealth.maxHealth,
            vx: enemyVel?.vx || 0,
            vy: enemyVel?.vy || 0,
          });
        }
      }

      // Get world hash from Four Kings system
      let worldHash: string | undefined;
      const fourKingsSystem = this.getSystem(FourKingsTerritoryService as SystemType<FourKingsTerritoryService>);
      if (fourKingsSystem) {
        const worldData = fourKingsSystem.getWorldData();
        worldHash = worldData?.hash;
      }

      // Create save data with world seed
      const saveData = {
        version: 1,
        seed: this.currentWorldSeed || this.generateNewWorldSeed(),
        worldHash,
        timestamp: Date.now(),
        player: {
          name: this.getPlayerName(),
          x: position.x,
          y: position.y,
          health: health.health,
          maxHealth: health.maxHealth,
          shards: this.gameState.getShards(),
          xp: this.progressionSystem.xp,
          level: this.progressionSystem.level,
          // Save current run upgrades and curses (cleared on death, not on save/load)
          currentRunUpgrades: this.upgradeService.getUpgradesForSave(),
          currentRunCurses: this.curseService.getCursesForSave(),
        },
        enemies: enemySnapshots,
        meta: {
          // FIX: Use performance.now() since startTime is set with performance.now()
          survivalTime: window.performance.now() - this.gameState.getStartTime(),
          survivalPhase: 'active',
          currentStage: 1,
          stageProgress: 0,
          unlockedStages: [1],
          kills: this.gameState.getKills(),
          maxKillStreak: this.gameState.getMaxKillStreak(),
          resinCurrency: 0,
          gameStartTime: this.gameState.getStartTime(),
          factionStandings: this.factionStandingSystem ? this.factionStandingSystem.serialize() : undefined,
        },
      };

      // Get save adapter through class property
      const saveAdapter = this.saveAdapter;
      if (saveAdapter) {
        if (!saveAdapter.save(saveData)) {
          this.debugLog.log('Save adapter rejected game state', 'error', {
            source: 'game_engine',
            operation: 'save',
          });
          return false;
        }

        this.debugLog.log('💾 Game saved successfully', 'info', {
          source: 'game_engine',
          seed: saveData.seed,
          playerPos: [position.x, position.y],
          enemyCount: enemySnapshots.length,
          upgrades: Object.keys(saveData.player.currentRunUpgrades || {}).length,
          curses: (saveData.player.currentRunCurses || []).length,
        });
      }
      return true;
    } catch (error) {
      this.debugLog.log('Failed to save game', 'error', {
        source: 'game_engine',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  loadGameState(): boolean {
    this.debugLog.log('🔍 GameEngine: loadGameState() called', 'info', {
      source: 'game_engine',
      operation: 'loadGameState_entry',
    });

    try {
      // Get save adapter through class property
      const saveAdapter = this.saveAdapter;
      if (!saveAdapter) {
        this.debugLog.log('🔍 GameEngine: No save adapter found', 'info', {
          source: 'game_engine',
          operation: 'loadGameState_no_adapter',
        });
        return false;
      }

      const saveData = saveAdapter.load();
      if (!saveData) {
        this.debugLog.log('🔍 GameEngine: No save data found', 'info', {
          source: 'game_engine',
          operation: 'loadGameState_no_data',
        });
        return false;
      }

      this.debugLog.log('🔍 GameEngine: Save data loaded, applying world seed', 'info', {
        source: 'game_engine',
        operation: 'loadGameState_applying_seed',
        seed: saveData.seed,
      });

      // Store the loaded world seed
      this.currentWorldSeed = saveData.seed;

      // Reset and apply world seed
      // IMPORTANT: reset() clears upgrades, so we need to restore them after
      this.reset();
      // Ensure engine is not left in paused state after reset — the calling
      // code (startExistingRun) will manage the pause/resume lifecycle.
      this.gameState.setPaused(false);
      this.setWorldSeed(saveData.seed);

      // Restore counts and replay effects after reset cleared every run modifier.
      // Curse registration is owned by the effect replay so the count registry and
      // gameplay mutations cannot drift apart.
      const savedUpgrades = saveData.player.currentRunUpgrades ?? {};
      this.upgradeService.loadUpgradesFromSave(savedUpgrades);
      if (!this.upgradeService.reapplySavedUpgradeEffects(this, savedUpgrades)) {
        this.debugLog.log('Saved upgrade effects could not be restored', 'error', {
          source: 'game_engine',
          operation: 'load_upgrade_effects',
        });
        return false;
      }

      // Load the world with hash validation if available
      const fourKingsSystem = this.getSystem(FourKingsTerritoryService as SystemType<FourKingsTerritoryService>);
      if (fourKingsSystem && saveData.worldHash) {
        const worldLoaded = fourKingsSystem.loadWorld(saveData.seed, saveData.worldHash);
        if (!worldLoaded) {
          this.debugLog.log('World hash mismatch - regenerating world', 'warning', {
            seed: saveData.seed,
            expectedHash: saveData.worldHash,
          });
        }
      }

      // Restore player state
      // Priority order for player name:
      // 1. Separately persisted name (most recent)
      // 2. Name from save data
      // 3. Auto-generate if neither exists
      const persistedName = this.saveAdapter.loadPlayerName();
      if (persistedName?.trim()) {
        this.debugLog.log('👤 Using persisted player name', 'info', {
          source: 'game_engine',
          name: persistedName,
        });
        this.gameState.setPlayerName(persistedName);
      } else if (saveData.player.name?.trim()) {
        this.debugLog.log('👤 Using save data player name', 'info', {
          source: 'game_engine',
          name: saveData.player.name,
        });
        this.gameState.setPlayerName(saveData.player.name);
      } else {
        // Will auto-generate a Pilot- name
        const generatedName = this.gameState.getPlayerName();
        this.debugLog.log('👤 Generated new player name', 'info', {
          source: 'game_engine',
          name: generatedName,
        });
      }
      this.gameState.setHealth(saveData.player.health, 'spawn_sync');
      this.gameState.addShards(saveData.player.shards - this.gameState.getShards());

      // Restore XP and level from save (reset() cleared them)
      if (saveData.player.xp !== undefined) {
        this.progressionSystem.setXp(saveData.player.xp);
      }
      if (saveData.player.level !== undefined) {
        this.progressionSystem.setLevel(saveData.player.level);
      }

      // Restore kill tracking and faction standings
      if (saveData.meta) {
        this.gameState.restoreSavedRunMetrics(
          saveData.meta.kills,
          saveData.meta.maxKillStreak,
          saveData.meta.survivalTime
        );

        // Restore faction standings
        if (saveData.meta.factionStandings && this.factionStandingSystem) {
          this.factionStandingSystem.deserialize(saveData.meta.factionStandings);
          this.debugLog.log('Faction standings restored from save', 'info', {
            source: 'game_engine',
            factionCount: saveData.meta.factionStandings.length,
          });
        }
      }

      // EntityFactory is the single source of truth for required ECS components.
      // Keep PlayerService in sync because it is authoritative during each frame.
      this.playerService.restorePosition(saveData.player.x, saveData.player.y);
      const playerEntity = this.entityFactory.createPlayer(saveData.player.x, saveData.player.y);
      const playerHealth = this.entityManager.getComponent(playerEntity, HealthComponent);
      if (!playerHealth) throw new Error('Player factory did not create HealthComponent');
      const restoredMaxHealth = this.playerService.getMaxHealth();
      playerHealth.maxHealth = restoredMaxHealth;
      playerHealth.health = Math.min(Math.round(saveData.player.health * 100) / 100, restoredMaxHealth);

      // Recreate enemies
      for (const enemy of saveData.enemies) {
        const enemyEntity = this.entityFactory.createEnemy(
          enemy.x,
          enemy.y,
          enemy.type,
          enemy.rarity,
          enemy.isElite,
          enemy.factionId,
          enemy.isChampion
        );
        const enemyHealth = this.entityManager.getComponent(enemyEntity, HealthComponent);
        const enemyVelocity = this.entityManager.getComponent(enemyEntity, VelocityComponent);
        if (!enemyHealth || !enemyVelocity) throw new Error('Enemy factory returned an incomplete entity');
        enemyHealth.maxHealth = Math.round(enemy.maxHealth * 100) / 100;
        enemyHealth.health = Math.min(Math.round(enemy.health * 100) / 100, enemyHealth.maxHealth);
        enemyVelocity.vx = enemy.vx ?? 0;
        enemyVelocity.vy = enemy.vy ?? 0;
      }

      // Emit state to update UI
      this.emitState();

      this.debugLog.log('📂 Game loaded successfully', 'info', {
        source: 'game_engine',
        seed: saveData.seed,
        playerPos: [saveData.player.x, saveData.player.y],
        enemyCount: saveData.enemies.length,
        savedTime: new Date(saveData.timestamp).toLocaleString(),
        upgrades: Object.keys(saveData.player.currentRunUpgrades || {}).length,
        curses: (saveData.player.currentRunCurses || []).length,
      });

      return true;
    } catch (error) {
      this.debugLog.log('Failed to load game', 'error', {
        source: 'game_engine',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // State emission
  emitState(): void {
    // Deprecated - GameStateService handles state emission
  }

  // Collision handlers
  handlePlayerEnemyCollision(_enemy: Enemy, _time: number): void {}
  handlePlayerProjectileCollision(_projectile: Projectile, _index: number, _time: number): void {}
  handlePlayerProjectileDodge(_projectile: Projectile, _index: number, _time: number): void {}
  handleBeamEnemyCollision(_enemy: Enemy, _index: number, _time: number): void {}
  handleBeamProjectileCollision(_projectile: Projectile, _index: number, _time: number): void {}

  // Misc
  clampCurrentHealth(): void {
    // Delegate to GameStateService, which holds the canonical current/max
    // values. Before this wire-up the method was a no-op comment, so curses
    // and -max-HP upgrades silently left current health floating above the
    // new ceiling until the next damage/heal coincidentally re-clamped.
    this.gameState.clampCurrentHealth();
  }

  // Kill tracking
  incrementKills(): void {
    this.gameState.incrementKills();
  }

  /**
   * Clear all floating text entities (damage numbers, kill streaks, etc.)
   */
  clearFloatingTextEntities(): void {
    // Get all entities with floating text component
    const floatingTextEntities = this.entityManager.getEntitiesWithComponents(FloatingTextComponent);

    // Destroy each entity
    for (const entity of floatingTextEntities) {
      this.entityManager.destroyEntity(entity);
    }
  }

  /**
   * Force a clean render frame - useful after modal interactions
   */
  forceRenderFrame(): void {
    if (this.ctx && this.canvas) {
      // Clear the FULL backing store. Only when rendering sub-native (touch resolution scaling,
      // renderScale < 1) reset the transform so clearRect covers the whole backing store rather
      // than under-clearing. On desktop the original behavior is preserved (byte-identical).
      const subNative = this.canvas.width < (parseFloat(this.canvas.style.width) || this.canvas.width);
      this.ctx.save();
      if (subNative) {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();

      // Trigger an immediate render
      const renderingSystem = this.getSystem(RenderingSystemService as SystemType<RenderingSystemService>);
      if (renderingSystem) {
        renderingSystem.update(0, this.entityManager);
      }
    }
  }

  /**
   * Get the player entity ID
   */
  getPlayerEntity(): number | null {
    const playerEntities = this.entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    return playerEntities.length > 0 ? playerEntities[0] : null;
  }

  /**
   * Grant temporary immunity to the player
   */
  grantPlayerImmunity(duration: number): void {
    const playerEntity = this.getPlayerEntity();
    if (playerEntity !== null) {
      // Grant immunity through player controlled component
      const playerComp = this.entityManager.getComponent(playerEntity, PlayerControlledComponent);
      if (playerComp) {
        playerComp.isInvincible = true;
        playerComp.invincibilityEndTime = Date.now() + duration * 1000;

        // Log immunity grant
        if (window.debugLogBridge) {
          window.debugLogBridge.log(`🛡️ Player immunity granted for ${duration} seconds`, 'info', {
            source: 'game_engine',
            operation: 'grant_immunity',
            duration,
            endTime: playerComp.invincibilityEndTime,
          });
        }
        // For now, this would need to be handled by a system that tracks invincibility timers
      }
    }
  }

  /**
   * Apply a permanent buff to the player
   */
  applyBuff(buffId: string, duration: number = -1): void {
    const playerEntity = this.getPlayerEntity();
    if (!playerEntity) {
      this.debugLog.log('Cannot apply buff - no player entity', 'warning', { buffId });
      return;
    }

    // Get buff management system
    const buffSystem = this.getSystem(BuffManagementSystemService as SystemType<BuffManagementSystemService>);
    if (buffSystem) {
      const result = buffSystem.applyBuff(playerEntity, buffId, this.entityManager);
      if (result) {
        this.debugLog.log('Buff applied', 'info', { buffId, duration });
      } else {
        this.debugLog.log('Failed to apply buff', 'warning', { buffId });
      }
    }
  }

  /**
   * Apply a consumable buff to the player using the buff management system
   */
  applyConsumableBuff(
    buffId: string,
    effects: {
      duration?: number;
      damageMultiplier?: number;
      damageReduction?: number;
      criticalChance?: number;
      criticalMultiplier?: number;
      speedMultiplier?: number;
      fireRateMultiplier?: number;
      healingMultiplier?: number;
      experienceMultiplier?: number;
    }
  ): boolean {
    const playerEntity = this.getPlayerEntity();
    if (!playerEntity) {
      this.debugLog.log('Cannot apply buff - no player entity', 'warning', { buffId });
      return false;
    }

    // Get buff management system
    const buffSystem = this.getSystem(BuffManagementSystemService as SystemType<BuffManagementSystemService>);
    if (buffSystem) {
      try {
        // Create buff definition with validation
        const buffDef = {
          id: buffId,
          name: buffId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          description: `Temporary buff: ${buffId}`,
          duration: effects.duration || 30000,
          stackable: false,
          maxStacks: 1,
          category: 'utility' as const,
          priority: 100,
          effects: {
            damageMultiplier: effects.damageMultiplier || 1,
            damageReduction: Math.min(effects.damageReduction || 0, 0.9), // Cap at 90% reduction
            criticalChance: Math.min(effects.criticalChance || 0, 1.0), // Cap at 100%
            criticalMultiplier: effects.criticalMultiplier || 1,
            speedMultiplier: Math.max(0.1, Math.min(effects.speedMultiplier || 1, 5.0)), // Clamp between 0.1 and 5
            fireRateMultiplier: Math.max(0.1, Math.min(effects.fireRateMultiplier || 1, 10.0)), // Clamp fire rate
            healingMultiplier: effects.healingMultiplier || 1,
            experienceMultiplier: Math.max(1, effects.experienceMultiplier || 1), // Min 1x XP
          },
        };

        // Register and apply the buff
        buffSystem.registerBuff(buffDef);
        const result = buffSystem.applyBuff(playerEntity, buffId, this.entityManager);

        if (result) {
          this.debugLog.log('Consumable buff applied', 'info', { buffId, duration: buffDef.duration });
          return true;
        } else {
          this.debugLog.log('Failed to apply buff', 'warning', { buffId });
          return false;
        }
      } catch (error) {
        this.debugLog.log('Error applying consumable buff', 'error', { buffId, error });
        return false;
      }
    } else {
      this.debugLog.log('Buff management system not available', 'warning', { buffId });
      return false;
    }
  }

  /**
   * Magnet all shards on screen to the player
   */
  magnetAllShards(): boolean {
    const playerEntity = this.getPlayerEntity();
    if (!playerEntity) return false;

    const playerPos = this.entityManager.getComponent(playerEntity, PositionComponent);
    if (!playerPos) return false;

    // Get all shard entities
    const shardEntities = this.entityManager.getEntitiesWithComponents(ShardComponent, PositionComponent);

    // Apply strong velocity towards player
    shardEntities.forEach((shard) => {
      const shardPos = this.entityManager.getComponent(shard, PositionComponent);
      if (!shardPos) return;

      // Calculate direction to player
      const dx = playerPos.x - shardPos.x;
      const dy = playerPos.y - shardPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance > 0) {
        // Strong magnetic force
        const speed = 800;
        const vx = (dx / distance) * speed;
        const vy = (dy / distance) * speed;

        // Add or update velocity component
        let velocity = this.entityManager.getComponent(shard, VelocityComponent);
        if (!velocity) {
          velocity = new VelocityComponent(vx, vy);
          this.entityManager.addComponent(shard, velocity);
        } else {
          velocity.vx = vx;
          velocity.vy = vy;
        }
      }
    });
    return true;
  }

  /**
   * Check if the game is currently active (not paused, not in menu)
   */
  isGameActive(): boolean {
    return this.running$.value && !this.isPaused();
  }
}
