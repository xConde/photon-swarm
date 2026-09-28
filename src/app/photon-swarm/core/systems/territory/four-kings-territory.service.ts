import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { RandomService } from '../../utils/random.service';
import { SeededRandomService } from '../../utils/seeded-random.service';
import { FOUR_KINGS_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { DynamicTerritoryGeneratorService } from './dynamic-territory-generator.service';
import { TerritoryChunkManagerService } from './territory-chunk-manager.service';
import { TerritoryHashService } from '../../world/territory-hash.service';
import { GeneratedWorld, KingConfig, TerritoryTile } from '../../models/territory.model';
import { TileVisibilityService } from '../combat/tile-visibility.service';
import { PlayerService } from '../../player/player.service';
import { TerritoryRenderingOptimizationService } from '../territory';
import { ThemeService } from '@services/theme.service';
import { TerritoryColorService } from './territory-color.service';
import { TerritoryQueryService } from './territory-query.service';
import { isCoarseTouchDevice } from '../../utils/touch-device.util';

/**
 * Four Kings Territory System
 *
 * Creates a dynamic, living background where four kingdoms constantly
 * expand, contract, and war with each other through tile-based territories.
 */
@Injectable({ providedIn: 'root' })
export class FourKingsTerritoryService implements System {
  // Grid configuration
  private readonly TILE_SIZE = FOUR_KINGS_CONFIG.TILE_SIZE;
  private readonly GRID_WIDTH = Math.ceil(WORLD_CONFIG.BOUNDS.WIDTH / this.TILE_SIZE);
  private readonly GRID_HEIGHT = Math.ceil(WORLD_CONFIG.BOUNDS.HEIGHT / this.TILE_SIZE);

  // Territory grid - stores which king owns each tile
  private territoryGrid: (TerritoryTile | null)[][] = [];

  // Visual grid - for smooth transitions
  private visualGrid: {
    currentKing: number;
    targetKing: number;
    transitionProgress: number;
    strength: number;
  }[][] = [];

  // The Four Kings (using config colors)
  private readonly kings: KingConfig[] = [
    {
      id: FOUR_KINGS_CONFIG.KINGS.CRIMSON.ID,
      name: FOUR_KINGS_CONFIG.KINGS.CRIMSON.NAME,
      color: FOUR_KINGS_CONFIG.KINGS.CRIMSON.COLOR,
      baseColor: FOUR_KINGS_CONFIG.KINGS.CRIMSON.BASE_COLOR,
      glowColor: FOUR_KINGS_CONFIG.KINGS.CRIMSON.GLOW_COLOR,
      expansionStyle: 'aggressive',
      expansionRate: 3.5,
      clusterTendency: 0.6,
      warlikeness: 0.9,
    },
    {
      id: FOUR_KINGS_CONFIG.KINGS.AZURE.ID,
      name: FOUR_KINGS_CONFIG.KINGS.AZURE.NAME,
      color: FOUR_KINGS_CONFIG.KINGS.AZURE.COLOR,
      baseColor: FOUR_KINGS_CONFIG.KINGS.AZURE.BASE_COLOR,
      glowColor: FOUR_KINGS_CONFIG.KINGS.AZURE.GLOW_COLOR,
      expansionStyle: 'defensive',
      expansionRate: 2.8,
      clusterTendency: 0.85,
      warlikeness: 0.3,
    },
    {
      id: FOUR_KINGS_CONFIG.KINGS.VERDANT.ID,
      name: FOUR_KINGS_CONFIG.KINGS.VERDANT.NAME,
      color: FOUR_KINGS_CONFIG.KINGS.VERDANT.COLOR,
      baseColor: FOUR_KINGS_CONFIG.KINGS.VERDANT.BASE_COLOR,
      glowColor: FOUR_KINGS_CONFIG.KINGS.VERDANT.GLOW_COLOR,
      expansionStyle: 'organic',
      expansionRate: 3.2,
      clusterTendency: 0.7,
      warlikeness: 0.5,
    },
    {
      id: FOUR_KINGS_CONFIG.KINGS.SHADOW.ID,
      name: FOUR_KINGS_CONFIG.KINGS.SHADOW.NAME,
      color: FOUR_KINGS_CONFIG.KINGS.SHADOW.COLOR,
      baseColor: FOUR_KINGS_CONFIG.KINGS.SHADOW.BASE_COLOR,
      glowColor: FOUR_KINGS_CONFIG.KINGS.SHADOW.GLOW_COLOR,
      expansionStyle: 'opportunistic',
      expansionRate: 3.0,
      clusterTendency: 0.4,
      warlikeness: 0.7,
    },
  ];

  // System state
  private updateTimer = 0;
  private readonly UPDATE_INTERVAL = Math.max(1.0, FOUR_KINGS_CONFIG.UPDATE_INTERVAL); // Ensure minimum 1 second interval
  private readonly TRANSITION_SPEED = FOUR_KINGS_CONFIG.TRANSITION_SPEED;
  private territoryGeneration = 0; // Incremented when territories change

  // Battle front tracking
  private battleFronts: Set<number> = new Set(); // numeric key = y * GRID_WIDTH + x

  // Performance optimization: Track only tiles that need transition updates
  private transitioningTiles: Set<number> = new Set(); // numeric key = y * GRID_WIDTH + x

  // Conquest state
  private activeKings: Set<number> = new Set([1, 2, 3, 4]); // Which kings are still alive
  private conqueredKings: number[] = []; // Kings that have been conquered
  private kingTerritoryCount: Map<number, number> = new Map(); // How many tiles each king controls
  private conquestPhase: number = 1; // 1=4 kings, 2=3 kings, 3=2 kings, 4=1 king (boss), 5=next wave
  private powerMultiplier: number = 1.0; // Multiplier for remaining kings when others are conquered

  // Conquest tracking
  private conquestUpdateTimer = 0;
  private readonly CONQUEST_CHECK_INTERVAL = 5.0; // Check for conquest every 5 seconds (reduced frequency)

  // Error logging control
  private loggedErrors = new Set<string>();
  private readonly MIN_TILES_TO_SURVIVE = 15; // Minimum tiles a king needs to survive
  private readonly CONQUEST_GRACE_PERIOD = 10; // Seconds before a king with low tiles is conquered
  private kingLowTileTimers: Map<number, number> = new Map(); // Track how long kings have been below threshold

  // Deterministic generation support
  private currentWorldSeed: string = '';
  private generatedWorld: GeneratedWorld | null = null;

  // Player tracking for chunk preloading
  private playerVelocity: { vx: number; vy: number } = { vx: 0, vy: 0 }; // Track velocity for predictive loading

  // Canvas dimensions for viewport-aware tile loading (updated by component on resize)
  private canvasWidth = 1920;
  private canvasHeight = 1080;

  // Region-based generation to avoid greedy behavior

  // Render validation flag
  private hasValidatedRenderBounds = false;
  private isInitialized = false;

  // Territory cache fields removed — direct rendering used instead

  // Sprint 7: Pre-computed border tile sets per king (king ID → Set of flat tile indices)
  private borderTilesPerKing = new Map<number, Set<number>>();
  // Sprint 8: Pre-computed core tile sets per king (king ID → Set of flat tile indices)
  private coreTilesPerKing = new Map<number, Set<number>>();

  // Offscreen bake: one OffscreenCanvas per king, rebuilt only when territoryGeneration changes.
  private readonly territoryOffscreenCanvases = new Map<number, OffscreenCanvas>();
  private lastBakedGeneration = -1;
  // Throttle the (expensive) offscreen rebake. territoryGeneration changes nearly every frame
  // during active warfare, and each rebake runs 4 blur(24px) passes over ~3M-pixel surfaces —
  // catastrophic on mobile GPUs (a prime cause of the ~13 FPS). The territory is a slow-moving
  // background, so baking at most ~3x/sec instead of per-frame is visually imperceptible.
  private lastBakeTimeMs = 0;
  // Detect touch once. Mobile GPUs cannot afford the blur(24px) bake pass or a fast rebake cadence.
  private readonly isTouch = isCoarseTouchDevice();
  // Throttle window for the rebake. Touch bakes at 1/sec (the territory is a slow background, so a
  // 1s lag in colour transitions is imperceptible) vs ~3/sec on desktop — cuts the most expensive
  // background operation by ~67% on phones.
  private static readonly BAKE_MIN_INTERVAL_MS = isCoarseTouchDevice() ? 1000 : 350;
  // Reused scratch canvases for the rebake (hoisted out of the per-bake loop so we don't
  // allocate four ~12MB OffscreenCanvas surfaces on every bake).
  private readonly bakeScratchCanvases: OffscreenCanvas[] = [];
  // All four kings composited into ONE canvas at bake time, so the per-frame render is a SINGLE
  // drawImage instead of 4 full-world blits (the dominant mobile-FPS cost / regression).
  private compositeOffscreenCanvas: OffscreenCanvas | null = null;

  // Pre-allocated LOD tile accumulator — cleared via .length = 0, never re-allocated.
  private readonly tilesInGroupBuffer: Array<{ king: number; strength: number; color: string }> = [];

  constructor(
    private random: RandomService,
    private territoryGenerator: DynamicTerritoryGeneratorService,
    private chunkManager: TerritoryChunkManagerService,
    private hashService: TerritoryHashService,
    private seededRandomService: SeededRandomService,
    private tileVisibility: TileVisibilityService,
    private playerService: PlayerService,
    private renderOptimization: TerritoryRenderingOptimizationService,
    private themeService: ThemeService,
    private territoryColor: TerritoryColorService,
    private territoryQuery: TerritoryQueryService
  ) {}

  /**
   * Update canvas dimensions for viewport-aware tile loading.
   * Called by PhotonSwarmComponent on resize.
   */
  setCanvasDimensions(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  /**
   * Set a new world seed and regenerate the territory system
   */
  setSeed(seed: string): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 FourKingsTerritory: setSeed() called', 'info', {
        source: 'four_kings_territory',
        operation: 'setSeed_entry',
        seed,
        oldSeed: this.currentWorldSeed,
      });
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🎯 Four Kings Territory: Setting new world seed', 'info', {
        oldSeed: this.currentWorldSeed,
        newSeed: seed,
      });
    }

    // Clear current world state
    this.generatedWorld = null;
    this.territoryGrid = [];
    this.visualGrid = [];
    this.battleFronts.clear();
    this.transitioningTiles.clear();
    this.loggedErrors.clear();
    this.activeKings = new Set([1, 2, 3, 4]);
    this.conqueredKings = [];
    this.kingTerritoryCount.clear();
    this.conquestPhase = 1;
    this.powerMultiplier = 1.0;
    // Sprint 7: clear stale border sets; Sprint 6: force cache rebuild
    this.borderTilesPerKing.clear();
    // Invalidate offscreen bake — new world requires fresh tiles
    this.territoryOffscreenCanvases.clear();
    this.lastBakedGeneration = -1;
    this.territoryGeneration = 0;

    // Reset player tracking to spawn position when generating new world

    // Generate new world with the new seed
    this.generateWorld(seed);

    if (window.debugLogBridge) {
      window.debugLogBridge.log('✅ Four Kings Territory: World regenerated with new seed', 'info', {
        seed,
        gridSize: `${this.GRID_WIDTH}x${this.GRID_HEIGHT}`,
      });
    }
  }

  init(entityManager: EntityManager): void {
    try {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🎯 Four Kings Territory: Starting initialization...', 'info', {
          source: 'four_kings_territory',
          operation: 'init_start',
          gridSize: [this.GRID_WIDTH, this.GRID_HEIGHT],
          entityManagerExists: !!entityManager,
          timestamp: Date.now(),
        });
      }

      // Reset player tracking to spawn position for chunk preloading

      this.initializeGrids();

      if (window.debugLogBridge) {
        window.debugLogBridge.log('🗺️ Four Kings Territory: Grids initialized', 'info', {
          source: 'four_kings_territory',
          operation: 'grids_init',
        });
      }

      // H5 FIX: Do NOT generate the world during init(). World generation is
      // the sole responsibility of setSeed(), which game-engine ALWAYS calls
      // immediately after init() in every flow (start / reset / load).
      //
      // Rationale: the old code ran generateWorld() here with no seed (random
      // seed → expensive gen #1), then game-engine called setSeed(realSeed) →
      // generateWorld(realSeed) (gen #2). Gen #1 was thrown away every time.
      //
      // Lazy safety-net: public read/render entry points call
      // this.ensureWorldGenerated() which triggers one generateWorld() if
      // generatedWorld is still null — so the system is safe even if setSeed()
      // were somehow skipped.

      // Validate color distinguishability in development
      this.territoryColor.validateColorDistinguishability();

      // Mark as initialized — world will be generated by setSeed() (or lazily
      // on first access if setSeed() is never called, via ensureWorldGenerated).
      this.isInitialized = true;

      if (window.debugLogBridge) {
        window.debugLogBridge.log(
          '✅ Four Kings Territory: Initialization complete (world deferred to setSeed)',
          'info',
          {
            source: 'four_kings_territory',
            operation: 'init_complete',
            gridSize: [this.GRID_WIDTH, this.GRID_HEIGHT],
            isInitialized: true,
            worldDeferredToSetSeed: true,
          }
        );
      }
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('❌ Four Kings Territory: Initialization FAILED', 'error', {
          source: 'four_kings_territory',
          operation: 'init_failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      // Don't re-throw - mark as initialized anyway to prevent render crashes
      this.isInitialized = true;
    }
  }

  /**
   * H5 SAFETY NET: Ensure the world is generated before any read access.
   * In the normal flow, setSeed() populates generatedWorld before any render
   * or data read occurs, so this is a no-op. It only fires if setSeed() was
   * somehow skipped (e.g. in tests that call init() without setSeed()).
   */
  private ensureWorldGenerated(): void {
    if (!this.generatedWorld) {
      this.generateWorld(this.currentWorldSeed || undefined);
    }
  }

  /**
   * Generate a new world with deterministic seed
   */
  generateWorld(seed?: string): GeneratedWorld {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔍 FourKingsTerritory: generateWorld() called', 'info', {
        source: 'four_kings_territory',
        operation: 'generateWorld_entry',
        seedProvided: !!seed,
        seed,
      });
    }

    const startTime = window.performance.now();

    // Generate seed if not provided
    if (!seed) {
      seed = SeededRandomService.generateWorldSeed(Date.now(), this.kings.length, '1.0');

      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔍 FourKingsTerritory: Generated new seed', 'info', {
          source: 'four_kings_territory',
          operation: 'seed_generation',
          generatedSeed: seed,
        });
      }
    }

    this.currentWorldSeed = seed;

    // Initialize all services with the seed
    this.seededRandomService.setSeed(seed);
    this.random.setSeed(seed);
    this.territoryGenerator.setSeed(seed);

    // Generate the complete territory grid FIRST
    this.territoryGrid = this.territoryGenerator.generateTerritories(this.GRID_WIDTH, this.GRID_HEIGHT, this.kings);

    // CRITICAL FIX: Initialize chunk manager with complete pre-generated grid
    // This prevents any on-demand generation during gameplay
    if (!this.territoryGrid || Object.keys(this.territoryGrid).length === 0) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('❌ Territory grid generation failed!', 'error', {
          source: 'four_kings_territory',
          operation: 'generate_world',
          gridExists: !!this.territoryGrid,
          gridKeys: this.territoryGrid ? Object.keys(this.territoryGrid).length : 0,
        });
      }
      // Don't throw - create empty grid to prevent crash
      this.territoryGrid = [];
      for (let x = 0; x < this.GRID_WIDTH; x++) {
        this.territoryGrid[x] = [];
        for (let y = 0; y < this.GRID_HEIGHT; y++) {
          this.territoryGrid[x][y] = {
            x,
            y,
            kingId: 0,
            strength: 0,
            contested: false,
            age: 0,
          };
        }
      }
    }

    // Verify grid is complete
    let missingTiles = 0;
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      if (!this.territoryGrid[x]) {
        missingTiles += this.GRID_HEIGHT;
        continue;
      }
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        if (!this.territoryGrid[x][y]) {
          missingTiles++;
        }
      }
    }

    if (missingTiles > 0) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`⚠️ Territory grid incomplete: ${missingTiles} tiles missing`, 'error', {
          source: 'four_kings_territory',
          operation: 'generate_world',
          missingTiles,
          totalTiles: this.GRID_WIDTH * this.GRID_HEIGHT,
        });
      }
    }

    // Now initialize chunk manager with verified complete grid
    this.chunkManager.initialize(seed, this.kings, this.GRID_WIDTH, this.GRID_HEIGHT, this.territoryGrid);

    // CRITICAL FIX: Use TileVisibilityService to calculate proper preload bounds
    // Default spawn is at center of world (6000, 4500)
    const spawnWorldX = WORLD_CONFIG.BOUNDS.WIDTH / 2;
    const spawnWorldY = WORLD_CONFIG.BOUNDS.HEIGHT / 2;
    const spawnPosition = { x: spawnWorldX, y: spawnWorldY };
    const spawnVelocity = { x: 0, y: 0 };

    // Calculate required preload bounds for spawn area
    const spawnPreload = this.tileVisibility.calculatePreloadBounds(
      spawnPosition,
      spawnVelocity,
      this.canvasWidth,
      this.canvasHeight
    );

    // Preload with calculated radius
    this.chunkManager.preloadChunksAroundPosition(
      spawnPreload.centerTile.x,
      spawnPreload.centerTile.y,
      spawnPreload.radius
    );

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🌍 Preloaded spawn area using TileVisibilityService', 'info', {
        source: 'four_kings_territory',
        operation: 'initial_preload',
        spawnWorldPos: [spawnWorldX, spawnWorldY],
        spawnTilePos: [spawnPreload.centerTile.x, spawnPreload.centerTile.y],
        preloadRadius: spawnPreload.radius,
        preloadBounds: spawnPreload.bounds,
        bufferTiles: spawnPreload.metrics.bufferTiles,
        totalTilesRequired: spawnPreload.metrics.totalTilesRequired,
      });
    }

    // Verify full coverage
    let emptyTiles = 0;
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x]?.[y];
        if (!tile || tile.kingId === 0) {
          emptyTiles++;
        }
      }
    }

    if (emptyTiles > 0 && window.debugLogBridge) {
      window.debugLogBridge.log(`WARNING: ${emptyTiles} empty tiles after generation!`, 'error', {
        source: 'four_kings_territory',
        operation: 'generate_world',
        emptyTiles,
        totalTiles: this.GRID_WIDTH * this.GRID_HEIGHT,
        coverage:
          (((this.GRID_WIDTH * this.GRID_HEIGHT - emptyTiles) / (this.GRID_WIDTH * this.GRID_HEIGHT)) * 100).toFixed(
            2
          ) + '%',
      });
    }

    // Generate world hash for integrity checking
    const worldHash = this.hashService.generateWorldHash(seed, this.territoryGrid, this.kings);

    // Find king start positions (capitals)
    const kingStartPositions = this.findKingCapitals();

    const generationTime = window.performance.now() - startTime;

    this.generatedWorld = {
      seed,
      hash: worldHash,
      territories: this.territoryGrid,
      kingStartPositions,
      kingConfigs: [...this.kings],
      generationMetadata: {
        timestamp: Date.now(),
        version: '1.0',
        gridSize: { width: this.GRID_WIDTH, height: this.GRID_HEIGHT },
        totalTiles: this.countTotalTiles(),
        generationTime,
      },
    };

    // Initialize visual grid based on territory grid
    this.syncVisualGrid();

    // Sprint 7: build initial border tile sets from the freshly generated grid
    this.rebuildBorderTileSets();

    // H5 FIX: validation moved here from init() (which no longer generates).
    // Runs once per generated world; non-fatal so render never crashes on it.
    try {
      this.validateVisualGridComplete();
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('⚠️ Visual grid validation failed', 'error', {
          source: 'four_kings_territory',
          operation: 'visual_grid_validation',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Four Kings: World Generated', 'info', {
        seed,
        hash: worldHash,
        generationTime: `${generationTime.toFixed(2)}ms`,
        totalTiles: this.generatedWorld.generationMetadata.totalTiles,
        kingStartPositions,
      });
    }

    return this.generatedWorld;
  }

  /**
   * Load a world from a seed (for save/load functionality)
   */
  loadWorld(seed: string, expectedHash?: string): boolean {
    try {
      const world = this.generateWorld(seed);

      // Validate hash if provided
      if (expectedHash && world.hash !== expectedHash) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Four Kings: World hash mismatch', 'error', {
            seed,
            expectedHash,
            actualHash: world.hash,
          });
        }
        return false;
      }

      if (window.debugLogBridge) {
        window.debugLogBridge.log('Four Kings: World Loaded', 'info', {
          seed,
          hash: world.hash,
          validated: !!expectedHash,
        });
      }

      return true;
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Four Kings: World load failed', 'error', {
          seed,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      return false;
    }
  }

  /**
   * Get current world data for saving
   */
  getWorldData(): GeneratedWorld | null {
    // Returns null until the world is generated (by setSeed(), which every
    // game flow calls right after init()). Do NOT lazily generate here:
    // getWorldData() is called frequently (e.g. per momentum tick) and a
    // generate-on-read would run a full synchronous world-gen in hot paths.
    // The lazy safety-net lives in renderTerritories() (the original
    // force-init location) for the case where a frame renders with no world.
    return this.generatedWorld;
  }

  /**
   * Convert world coordinates to grid coordinates
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  worldToGrid(worldX: number, worldY: number): { gridX: number; gridY: number } | null {
    return this.territoryQuery.worldToGrid(worldX, worldY);
  }

  /**
   * Get tile size for calculations
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  getTileSize(): number {
    return this.territoryQuery.getTileSize();
  }

  /**
   * Find the capital/starting position for each king
   */
  private findKingCapitals(): Array<{ x: number; y: number; kingId: number }> {
    const capitals: Array<{ x: number; y: number; kingId: number }> = [];

    // For each king, find their largest cluster center
    for (const king of this.kings) {
      const kingTiles = this.getKingTiles(king.id);
      if (kingTiles.length === 0) continue;

      // Find center of mass for this king's territory
      let centerX = 0;
      let centerY = 0;
      let totalStrength = 0;

      for (const tile of kingTiles) {
        const weight = tile.strength || 1;
        centerX += tile.x * weight;
        centerY += tile.y * weight;
        totalStrength += weight;
      }

      if (totalStrength > 0) {
        centerX = Math.round(centerX / totalStrength);
        centerY = Math.round(centerY / totalStrength);

        // Convert grid coordinates to world coordinates
        const worldX = centerX * this.TILE_SIZE + this.TILE_SIZE / 2;
        const worldY = centerY * this.TILE_SIZE + this.TILE_SIZE / 2;

        capitals.push({
          x: worldX,
          y: worldY,
          kingId: king.id,
        });
      }
    }

    return capitals;
  }

  /**
   * Count total tiles in the territory grid
   */
  private countTotalTiles(): number {
    let count = 0;
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        if (this.territoryGrid[x]?.[y]) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Synchronize visual grid with territory grid
   */
  private syncVisualGrid(): void {
    const startTime = window.performance.now();
    let syncedTiles = 0;
    let territoryTiles = 0;

    // CRITICAL FIX: Ensure full world coverage even where no territory exists
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        // Ensure visual grid entry exists for every position
        if (!this.visualGrid[x]) this.visualGrid[x] = [];
        if (!this.visualGrid[x][y]) {
          this.visualGrid[x][y] = {
            currentKing: 0, // Default to neutral
            targetKing: 0,
            transitionProgress: 1,
            strength: 0.1, // Minimal strength for background
          };
        }

        // Sync with territory data if it exists
        const tile = this.territoryGrid[x]?.[y];
        if (tile && tile.kingId > 0) {
          this.visualGrid[x][y].currentKing = tile.kingId;
          this.visualGrid[x][y].targetKing = tile.kingId;
          this.visualGrid[x][y].transitionProgress = 1;
          this.visualGrid[x][y].strength = tile.strength;
          territoryTiles++;
        } else {
          // Keep neutral background for unowned tiles
          this.visualGrid[x][y].currentKing = 0;
          this.visualGrid[x][y].targetKing = 0;
          this.visualGrid[x][y].strength = 0.1;
        }
        syncedTiles++;
      }
    }

    const syncTime = window.performance.now() - startTime;

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🔄 Visual Grid Synchronized', 'info', {
        source: 'four_kings_territory',
        operation: 'sync_visual_grid',
        gridSize: [this.GRID_WIDTH, this.GRID_HEIGHT],
        totalTiles: this.GRID_WIDTH * this.GRID_HEIGHT,
        syncedTiles,
        territoryTiles,
        neutralTiles: syncedTiles - territoryTiles,
        syncTime: `${syncTime.toFixed(2)}ms`,
        visualGridComplete: syncedTiles === this.GRID_WIDTH * this.GRID_HEIGHT,
      });
    }
  }

  /**
   * Get tiles owned by a specific king
   */
  private getKingTiles(kingId: number): TerritoryTile[] {
    const tiles: TerritoryTile[] = [];
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x]?.[y];
        if (tile && tile.kingId === kingId) {
          tiles.push(tile);
        }
      }
    }
    return tiles;
  }

  /**
   * Initialize the territory and visual grids
   */
  private initializeGrids(): void {
    this.territoryGrid = [];
    this.visualGrid = [];

    // CRITICAL FIX: Pre-allocate the entire visual grid for the full world
    // This ensures tiles render everywhere, not just where territory data exists
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      this.territoryGrid[x] = [];
      this.visualGrid[x] = [];

      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        this.territoryGrid[x][y] = null;
        // Initialize with neutral background tile (king 0)
        this.visualGrid[x][y] = {
          currentKing: 0, // 0 = neutral/background
          targetKing: 0,
          transitionProgress: 1,
          strength: 0.1, // Minimal strength for background visibility
        };
      }
    }
  }

  /**
   * Seed initial territories for each king - ensuring full map coverage
   * Now uses deterministic world generation system
   */
  private seedInitialTerritories(): void {
    // If no world has been generated yet, generate one with a random seed
    if (!this.generatedWorld) {
      this.generateWorld();
      return;
    }

    // Use the already generated world
    this.territoryGrid = this.generatedWorld.territories;
    this.syncVisualGrid();

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Four Kings: Territories seeded', 'info', {
        seed: this.currentWorldSeed,
        totalTiles: this.countTotalTiles(),
        kingCounts: this.kings.map((k) => ({
          kingId: k.id,
          tileCount: this.getKingTiles(k.id).length,
        })),
      });
    }
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    // Update player tracking with TileVisibilityService
    const playerTracking = this.tileVisibility.updatePlayerTracking(entityManager);

    if (playerTracking.hasPlayer && playerTracking.position) {
      // Update player velocity for predictive loading in render
      this.playerVelocity = { vx: playerTracking.velocity.x, vy: playerTracking.velocity.y };
      // Calculate optimal preload bounds using visibility service
      const preloadInfo = this.tileVisibility.calculatePreloadBounds(
        playerTracking.position,
        playerTracking.velocity,
        this.canvasWidth,
        this.canvasHeight
      );

      // Check if we need to update preload area
      if (this.tileVisibility.shouldUpdatePreload(preloadInfo.bounds)) {
        // Calculate optimal preload strategy
        const chunkStats = this.chunkManager.getCacheStats();
        const strategy = this.tileVisibility.calculateOptimalPreloadStrategy(
          playerTracking.position,
          playerTracking.velocity,
          chunkStats.cachedChunks,
          400 // MAX_CACHED_CHUNKS from chunk manager
        );

        // Preload priority zones
        for (const zone of strategy.priorityZones) {
          this.chunkManager.preloadChunksAroundPosition(zone.centerX, zone.centerY, zone.radius);
        }

        // Update last known position
      }
    }

    // Update visual transitions
    this.updateVisualTransitions(deltaTime / 1000);
    // Update territory expansion
    this.updateTimer += deltaTime / 1000;
    if (this.updateTimer >= this.UPDATE_INTERVAL) {
      this.updateTimer = 0;
      this.expandTerritories();
      this.updateBattleFronts();
      // Only bump the generation (which drives the expensive offscreen rebake: 4 tmp canvases
      // + 4 blur(24px) passes) while tiles are actually transitioning. Ownership changes enqueue
      // transitions, so this covers every real change AND its fade-in animation, then goes quiet
      // when territories are stable. An unconditional bump rebaked every 0.5s forever — even at
      // rest with nothing changing. Conquest / external-ownership bumps stay event-driven elsewhere.
      if (this.transitioningTiles.size > 0) {
        this.territoryGeneration++;
      }
    }

    // Update conquest tracking
    this.conquestUpdateTimer += deltaTime / 1000;
    if (this.conquestUpdateTimer >= this.CONQUEST_CHECK_INTERVAL) {
      this.conquestUpdateTimer = 0;
      this.updateConquestState();
    }
  }

  /**
   * Update visual transitions between territory changes
   * OPTIMIZED: Only processes tiles that are actively transitioning (O(n) where n = transitioning tiles)
   * instead of iterating through the entire grid (was O(7500) every frame)
   */
  private updateVisualTransitions(deltaSeconds: number): void {
    // Process only tiles that are transitioning
    const tilesToRemove: number[] = [];

    for (const key of this.transitioningTiles) {
      const x = key % this.GRID_WIDTH;
      const y = Math.floor(key / this.GRID_WIDTH);

      // Bounds check
      if (x < 0 || x >= this.GRID_WIDTH || y < 0 || y >= this.GRID_HEIGHT) {
        tilesToRemove.push(key);
        continue;
      }

      const visual = this.visualGrid[x]?.[y];
      if (!visual) {
        tilesToRemove.push(key);
        continue;
      }

      const territory = this.territoryGrid[x]?.[y];
      const targetKing = territory ? territory.kingId : 0;
      const targetStrength = territory ? territory.strength : 0;

      // Check if target changed
      if (visual.targetKing !== targetKing) {
        visual.targetKing = targetKing;
        visual.transitionProgress = 0;
      }

      // Smooth transition
      if (visual.transitionProgress < 1) {
        visual.transitionProgress = Math.min(1, visual.transitionProgress + deltaSeconds * this.TRANSITION_SPEED);

        // Fade out then in for smooth color transitions
        if (visual.transitionProgress < 0.5) {
          visual.strength = targetStrength * (1 - visual.transitionProgress * 2);
        } else {
          visual.currentKing = visual.targetKing;
          visual.strength = targetStrength * ((visual.transitionProgress - 0.5) * 2);
        }
      } else {
        visual.strength = targetStrength;
        // Tile finished transitioning, remove from set
        tilesToRemove.push(key);
      }
    }

    // Remove finished transitions
    for (const key of tilesToRemove) {
      this.transitioningTiles.delete(key);
    }
  }

  /**
   * Mark a tile for visual transition (called when territory ownership changes)
   */
  private markTileForTransition(x: number, y: number): void {
    this.transitioningTiles.add(y * this.GRID_WIDTH + x);
  }

  /**
   * Expand territories for all kings
   */
  private expandTerritories(): void {
    // Randomize expansion order to prevent bias
    const kingOrder = this.shuffleArray([...this.kings]);

    kingOrder.forEach((king) => {
      const expansionsThisTurn = Math.floor(king.expansionRate * this.UPDATE_INTERVAL);

      for (let i = 0; i < expansionsThisTurn; i++) {
        this.expandKingTerritory(king);
      }
    });
  }

  /**
   * Expand territory for a specific king
   */
  private expandKingTerritory(king: KingConfig): void {
    // Sprint 7: Use pre-computed border sets instead of O(GRID_WIDTH × GRID_HEIGHT) scan.
    // Fall back to full scan only if border set is missing (e.g. after reset before first rebuild).
    const borderSet = this.borderTilesPerKing.get(king.id);

    const ownedTiles: TerritoryTile[] = [];
    const borderTiles: TerritoryTile[] = [];

    if (borderSet && borderSet.size > 0) {
      // Fast path: border tiles directly from pre-computed set.
      for (const idx of borderSet) {
        const bx = idx % this.GRID_WIDTH;
        const by = Math.floor(idx / this.GRID_WIDTH);
        const tile = this.territoryGrid[bx]?.[by];
        if (tile && tile.kingId === king.id) {
          borderTiles.push(tile);
        }
      }
      // T5 NOTE: Defensive/organic strategies need all owned tiles.
      // A per-king owned-tile Set was considered but rejected:
      // Set iteration order differs from the row-major scan, changing the
      // insertion order of candidates passed to getDefensiveExpansionCandidates/
      // getOrganicExpansionCandidates, which in turn changes equal-score tie-
      // breaking in the sort+top-5+RNG selection → world generation changes.
      // Preserving identical world output is the #1 constraint, so the full
      // grid scan is retained here.
      if (king.expansionStyle === 'defensive' || king.expansionStyle === 'organic') {
        for (let x = 0; x < this.GRID_WIDTH; x++) {
          for (let y = 0; y < this.GRID_HEIGHT; y++) {
            const tile = this.territoryGrid[x][y];
            if (tile && tile.kingId === king.id) {
              ownedTiles.push(tile);
            }
          }
        }
      } else {
        // Aggressive and opportunistic only need borderTiles; ownedTiles just needs to be non-empty.
        Array.prototype.push.apply(ownedTiles, borderTiles);
      }
    } else {
      // Fallback: full grid scan (used only when border set is empty/uninitialized)
      for (let x = 0; x < this.GRID_WIDTH; x++) {
        for (let y = 0; y < this.GRID_HEIGHT; y++) {
          const tile = this.territoryGrid[x][y];
          if (tile && tile.kingId === king.id) {
            ownedTiles.push(tile);
            if (this.isBorderTile(x, y, king.id)) {
              borderTiles.push(tile);
            }
          }
        }
      }
    }

    if (ownedTiles.length === 0) return;

    // Choose expansion strategy based on king's style
    let candidateTiles: { x: number; y: number; score: number }[] = [];

    switch (king.expansionStyle) {
      case 'aggressive':
        candidateTiles = this.getAggressiveExpansionCandidates(king, borderTiles);
        break;
      case 'defensive':
        candidateTiles = this.getDefensiveExpansionCandidates(king, ownedTiles);
        break;
      case 'organic':
        candidateTiles = this.getOrganicExpansionCandidates(king, ownedTiles);
        break;
      case 'opportunistic':
        candidateTiles = this.getOpportunisticExpansionCandidates(king, borderTiles);
        break;
    }

    if (candidateTiles.length > 0) {
      // Sort by score and pick from top candidates with some randomness
      candidateTiles.sort((a, b) => b.score - a.score);
      const topCandidates = candidateTiles.slice(0, Math.min(5, candidateTiles.length));
      const chosen = topCandidates[Math.floor(this.random.random() * topCandidates.length)];

      // Claim the tile
      const strength = 0.3 + this.random.random() * 0.7;
      this.claimTile(chosen.x, chosen.y, king.id, strength);
    }
  }

  /**
   * Get aggressive expansion candidates (prefer enemy borders)
   */
  private getAggressiveExpansionCandidates(
    king: KingConfig,
    borderTiles: TerritoryTile[]
  ): { x: number; y: number; score: number }[] {
    const candidates: { x: number; y: number; score: number }[] = [];

    borderTiles.forEach((tile) => {
      const neighbors = this.getNeighbors(tile.x, tile.y);

      neighbors.forEach(([nx, ny]) => {
        if (!this.isValidTile(nx, ny)) return;

        const targetTile = this.territoryGrid[nx][ny];
        let score = 0;

        if (!targetTile) {
          // Empty tile
          score = 0.5;
        } else if (targetTile.kingId !== king.id) {
          // Enemy tile - high priority
          score = 1.0 * king.warlikeness;

          // Prefer weaker enemy tiles
          score *= 1.5 - targetTile.strength;
        }

        // Add clustering bonus
        const friendlyNeighbors = this.countFriendlyNeighbors(nx, ny, king.id);
        score += friendlyNeighbors * 0.1 * king.clusterTendency;

        if (score > 0) {
          candidates.push({ x: nx, y: ny, score });
        }
      });
    });

    return candidates;
  }

  /**
   * Get defensive expansion candidates (prefer safe expansion)
   */
  private getDefensiveExpansionCandidates(
    king: KingConfig,
    ownedTiles: TerritoryTile[]
  ): { x: number; y: number; score: number }[] {
    const candidates: { x: number; y: number; score: number }[] = [];
    const checked = new Set<string>();

    ownedTiles.forEach((tile) => {
      const neighbors = this.getNeighbors(tile.x, tile.y);

      neighbors.forEach(([nx, ny]) => {
        const key = `${nx},${ny}`;
        if (!this.isValidTile(nx, ny) || checked.has(key)) return;
        checked.add(key);

        const targetTile = this.territoryGrid[nx][ny];

        if (!targetTile || targetTile.kingId === king.id) {
          // Prefer tiles with more friendly neighbors
          const friendlyNeighbors = this.countFriendlyNeighbors(nx, ny, king.id);
          let score = friendlyNeighbors * 0.3 * king.clusterTendency;

          // Avoid tiles near enemies
          const enemyNeighbors = this.countEnemyNeighbors(nx, ny, king.id);
          score -= enemyNeighbors * 0.2 * (1 - king.warlikeness);

          if (score > 0) {
            candidates.push({ x: nx, y: ny, score });
          }
        }
      });
    });

    return candidates;
  }

  /**
   * Get organic expansion candidates (natural growth patterns)
   */
  private getOrganicExpansionCandidates(
    king: KingConfig,
    ownedTiles: TerritoryTile[]
  ): { x: number; y: number; score: number }[] {
    const candidates: { x: number; y: number; score: number }[] = [];
    const checked = new Set<string>();

    // Find tiles with the right "age" for expansion
    const matureTiles = ownedTiles.filter((tile) => tile.age > 2 && tile.age < 10);
    const tilesToCheck = matureTiles.length > 0 ? matureTiles : ownedTiles;

    tilesToCheck.forEach((tile) => {
      const neighbors = this.getNeighbors(tile.x, tile.y);

      neighbors.forEach(([nx, ny]) => {
        const key = `${nx},${ny}`;
        if (!this.isValidTile(nx, ny) || checked.has(key)) return;
        checked.add(key);

        const targetTile = this.territoryGrid[nx][ny];

        if (!targetTile) {
          let score = 0.5;

          // Organic growth prefers certain patterns
          const pattern = (nx + ny) % 3;
          score += pattern === 0 ? 0.2 : 0;

          // Slight clustering preference
          const friendlyNeighbors = this.countFriendlyNeighbors(nx, ny, king.id);
          score += friendlyNeighbors * 0.15 * king.clusterTendency;

          // Add some randomness for organic feel
          score += this.random.random() * 0.3;

          candidates.push({ x: nx, y: ny, score });
        }
      });
    });

    return candidates;
  }

  /**
   * Get opportunistic expansion candidates (weak spots and gaps)
   *
   * T5 OPTIMIZATION: Instead of scanning the full O(N) grid, we iterate the
   * king's border set (the frontier tiles) and check their NEIGHBORS. The
   * original scan checked every tile for `friendlyNeighbors > 0` — which is
   * exactly the set of tiles reachable from the border in one step. Iterating
   * the border set and checking its neighbors gives the IDENTICAL candidate set
   * because:
   *   - A non-king tile with friendlyNeighbors > 0 ⟺ it is a neighbor of at
   *     least one border tile.
   * Order within the candidate array may differ from the original scan (border
   * iteration vs. row-major grid scan), but score-based sorting in
   * expandKingTerritory() makes the final selection order-independent for any
   * fixed random state.
   *
   * If the border set is empty or missing (cold start before rebuildBorderTileSets),
   * fall back to the original full-grid scan to preserve correctness.
   */
  /**
   * Get opportunistic expansion candidates (weak spots and gaps)
   *
   * T5 NOTE: This method retains the original O(N) full-grid scan intentionally.
   * The candidate SET could be derived from borderTilesPerKing,
   * but the ITERATION ORDER matters for determinism: the sort in expandKingTerritory
   * uses score as the primary key, but within equal scores the array insertion order
   * affects which candidates fall in the top-5 window. A different iteration order
   * (Set vs. row-major grid scan) would produce a different generated world.
   * Preserving identical output is the #1 constraint, so this scan is left as-is.
   */
  private getOpportunisticExpansionCandidates(
    king: KingConfig,
    _borderTiles: TerritoryTile[]
  ): { x: number; y: number; score: number }[] {
    const candidates: { x: number; y: number; score: number }[] = [];

    // Look for weak enemy tiles and gaps between enemies
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];

        if (!tile || tile.kingId === king.id) {
          // Check if this tile is adjacent to our territory
          const friendlyNeighbors = this.countFriendlyNeighbors(x, y, king.id);
          if (friendlyNeighbors === 0) continue;

          let score = 0;

          if (!tile) {
            // Empty tile between enemies is high value
            const uniqueEnemyNeighbors = this.getUniqueEnemyNeighbors(x, y, king.id);
            if (uniqueEnemyNeighbors.size > 1) {
              score = 0.8 + uniqueEnemyNeighbors.size * 0.1;
            } else {
              score = 0.3;
            }
          } else {
            // Weak enemy tile
            if (tile.strength < 0.5) {
              score = 0.6 * (1 - tile.strength);
            }
          }

          if (score > 0) {
            candidates.push({ x, y, score });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Claim a tile for a king
   */
  private claimTile(x: number, y: number, kingId: number, strength: number): void {
    const existingTile = this.territoryGrid[x][y];
    const previousKingId = existingTile?.kingId ?? 0;

    if (existingTile && existingTile.kingId !== kingId) {
      // Contested tile - battle for control
      const attackStrength = strength * this.kings[kingId - 1].warlikeness;

      if (attackStrength > existingTile.strength) {
        // Successful takeover
        this.territoryGrid[x][y] = {
          x,
          y,
          kingId,
          strength: attackStrength * 0.8, // Weakened from battle
          age: 0,
          contested: true,
        };
        // Mark for visual transition since ownership changed
        this.markTileForTransition(x, y);
        // Sprint 7: update border sets for successful takeover
        this.updateBorderSetsAroundTile(x, y);
      } else {
        // Failed takeover - mark as contested
        existingTile.contested = true;
        existingTile.strength *= 0.9; // Slightly weakened
      }
    } else {
      // Claim empty or reinforce own tile
      this.territoryGrid[x][y] = {
        x,
        y,
        kingId,
        strength: Math.min(1, existingTile ? existingTile.strength + strength * 0.3 : strength),
        age: existingTile ? existingTile.age + this.UPDATE_INTERVAL : 0,
        contested: false,
      };
      // Mark for visual transition if this is a new claim (not reinforcement)
      if (previousKingId !== kingId) {
        this.markTileForTransition(x, y);
        // Sprint 7: update border sets when ownership actually changed
        this.updateBorderSetsAroundTile(x, y);
      }
    }
  }

  /**
   * Update battle fronts (contested areas)
   */
  private updateBattleFronts(): void {
    this.battleFronts.clear();

    // SIMPLIFIED: Use main territory grid for battle fronts since it's primarily visual
    // Only check areas that have actual territory data
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      if (!this.territoryGrid[x]) continue;

      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];
        if (!tile) continue;

        // Check if this tile borders enemy territory
        const neighbors = this.getNeighbors(x, y);
        let hasEnemyNeighbor = false;

        for (const [nx, ny] of neighbors) {
          if (!this.isValidTile(nx, ny)) continue;
          const neighbor = this.territoryGrid[nx]?.[ny];

          if (neighbor && neighbor.kingId !== tile.kingId) {
            hasEnemyNeighbor = true;
            break;
          }
        }

        if (hasEnemyNeighbor) {
          this.battleFronts.add(y * this.GRID_WIDTH + x);
          tile.contested = true;
        } else {
          tile.contested = false;
        }
      }
    }
  }

  /**
   * Render the territory background
   */
  renderTerritories(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, _zoom: number = 1): void {
    // H5 safety net: generate lazily if not done yet (covers the case where
    // renderTerritories is reached before setSeed() fires — should not happen
    // in the normal flow but guards against edge cases).
    if (!this.generatedWorld) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory: force-initializing in render (safety net)', 'warning', {
          source: 'four_kings_territory',
        });
      }
      try {
        this.ensureWorldGenerated();
        this.isInitialized = true;
      } catch (error) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Territory: force-init failed', 'error', {
            source: 'four_kings_territory',
            error: error instanceof Error ? error.message : 'Unknown',
          });
        }
      }
    }

    // H5: a present world means the system is ready to render. Generation is now
    // decoupled from init() (it happens in setSeed()/generateWorld()), so keep
    // isInitialized in sync with having a world — otherwise a world produced via
    // setSeed() or a direct generateWorld() before init() would render nothing.
    if (this.generatedWorld) {
      this.isInitialized = true;
    }

    // Reduced logging frequency for performance - moved after variable declarations

    // CRITICAL: Don't render if not initialized
    if (!this.isInitialized) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory: render before init', 'warning', { source: 'four_kings_territory' });
      }
      return;
    }

    // CRITICAL: If no world grid, render neutral background to prevent naked tiles
    const hasWorldGrid = this.chunkManager.hasFullWorldGrid();
    if (!hasWorldGrid) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory: no world grid, neutral bg', 'warning', {
          source: 'four_kings_territory',
        });
      }
      // Render neutral background tiles to prevent naked tiles
      this.territoryColor.renderNeutralBackground(ctx, camera, this.TILE_SIZE);
      return;
    }

    // Get actual player position from PlayerService for accurate centering
    const playerPos = this.playerService.getPosition();
    const playerWorldX = playerPos.x;
    const playerWorldY = playerPos.y;

    // Use TileVisibilityService to calculate proper render bounds centered on player
    const playerVelocity = this.playerVelocity || { vx: 0, vy: 0 };
    // CSS (logical) viewport size from setCanvasDimensions — NOT ctx.canvas.width, which on
    // touch is the smaller sub-native backing store (renderScale < 1) and would under-count the
    // visible tile bounds, leaving a band of un-rendered territory on the right/bottom edges.
    const renderBounds = this.tileVisibility.calculatePreloadBounds(
      { x: playerWorldX, y: playerWorldY }, // Use actual player world position
      { x: playerVelocity.vx, y: playerVelocity.vy },
      this.canvasWidth,
      this.canvasHeight
    );

    // Use optimized render bounds with LOD support
    const optimizedBounds = this.renderOptimization.calculateOptimizedRenderBounds(
      camera,
      this.canvasWidth,
      this.canvasHeight,
      this.GRID_WIDTH,
      this.GRID_HEIGHT
    );

    const { startX, startY, endX, endY, lodLevel } = optimizedBounds;
    const groupSize = lodLevel === 'FULL' ? 1 : lodLevel === 'MEDIUM' ? 2 : lodLevel === 'LOW' ? 4 : 8;

    // Debug render bounds issues - only log once
    if (!this.hasValidatedRenderBounds) {
      this.hasValidatedRenderBounds = true;
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🔍 Render Bounds Check', 'info', {
          source: 'four_kings_territory',
          operation: 'render_bounds_check',
          camera: [camera.x, camera.y],
          playerWorldPos: [playerWorldX, playerWorldY],
          playerTilePos: [Math.floor(playerWorldX / this.TILE_SIZE), Math.floor(playerWorldY / this.TILE_SIZE)],
          renderBoundsRaw: renderBounds.bounds,
          renderBoundsRadius: renderBounds.radius,
          renderBoundsClamped: { startX, startY, endX, endY },
          gridSize: [this.GRID_WIDTH, this.GRID_HEIGHT],
          tileSize: this.TILE_SIZE,
          worldSize: [WORLD_CONFIG.BOUNDS.WIDTH, WORLD_CONFIG.BOUNDS.HEIGHT],
          visualGridSize: [this.visualGrid.length, this.visualGrid[0]?.length || 0],
          tilesInBounds: (endX - startX) * (endY - startY),
          expectedTilesInView:
            Math.ceil(this.canvasWidth / this.TILE_SIZE) * Math.ceil(this.canvasHeight / this.TILE_SIZE),
          isFirstRender: !this.hasValidatedRenderBounds,
        });
      }
    }

    // REMOVED: Chunk preloading from render cycle - this is too late!
    // Preloading now happens in the update loop BEFORE rendering

    // Removed debug logging for performance - this was in the hot path

    // Update cache management for LOD system
    this.renderOptimization.updateCacheManagement();

    // Hoist per-frame timestamp + glow-pulse ONCE — reused for every contested tile.
    const now = Date.now();
    const glowPulse = 0.3 + 0.2 * Math.sin(now * 0.002);

    // Boost opacity in light mode so territories are visible on cream background.
    // Consistent across both the baked path and the direct fallback path.
    const opacityScale = this.themeService.isDayMode ? 1.1 : 1.0;

    // ---------------------------------------------------------------------------
    // OFFSCREEN BAKE PATH (OffscreenCanvas available)
    // Tiles are baked into per-king offscreen canvases with a one-time edge feather
    // (blur filter applied once at bake time, never per frame). Per frame we only
    // call ctx.drawImage once per king — 4 drawImage total instead of N*3 fillRect.
    // ---------------------------------------------------------------------------
    if (typeof OffscreenCanvas !== 'undefined') {
      // Rebuild baked canvases only when ownership changed AND the throttle window has elapsed.
      // (territoryGeneration can change every frame; the rebake is far too heavy to run per-frame.)
      const nowMs = window.performance.now();
      if (
        this.territoryGeneration !== this.lastBakedGeneration &&
        nowMs - this.lastBakeTimeMs >= FourKingsTerritoryService.BAKE_MIN_INTERVAL_MS
      ) {
        this.rebakeOffscreenCanvases();
        this.lastBakedGeneration = this.territoryGeneration;
        this.lastBakeTimeMs = nowMs;
      }

      // Draw the SINGLE pre-composited territory canvas (all 4 kings baked into one at rebake
      // time) instead of 4 full-world blits per frame — the dominant mobile-FPS cost. Tiles never
      // overlap between kings, so compositing at alpha 1 then drawing once at opacityScale is
      // identical to drawing each king at opacityScale. ctx already has the camera transform.
      if (this.compositeOffscreenCanvas) {
        const worldW = this.GRID_WIDTH * this.TILE_SIZE;
        const worldH = this.GRID_HEIGHT * this.TILE_SIZE;
        ctx.globalAlpha = Math.min(1, opacityScale);
        ctx.drawImage(this.compositeOffscreenCanvas, 0, 0, worldW, worldH);
      }
      ctx.globalAlpha = 1;

      // Battle-front contested glow is still drawn per-tile (small set, per-frame animated).
      // CSS dims so the per-tile cull matches the visible viewport at renderScale < 1.
      const canvasW = this.canvasWidth;
      const canvasH = this.canvasHeight;
      for (const key of this.battleFronts) {
        const x = key % this.GRID_WIDTH;
        const y = Math.floor(key / this.GRID_WIDTH);
        if (!this.renderOptimization.shouldRenderTileGroup(x, y, 1, camera, canvasW, canvasH)) continue;
        const visual = this.visualGrid[x]?.[y];
        if (!visual || visual.currentKing === 0) continue;
        const king = this.kings[visual.currentKing - 1];
        if (!king) continue;
        const screenX = x * this.TILE_SIZE;
        const screenY = y * this.TILE_SIZE;
        ctx.fillStyle = king.glowColor;
        ctx.globalAlpha = Math.min(0.2, visual.strength * FOUR_KINGS_CONFIG.GLOW_OPACITY * glowPulse * opacityScale);
        ctx.fillRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
      }
      ctx.globalAlpha = 1;
      return;
    }

    // ---------------------------------------------------------------------------
    // DIRECT FALLBACK PATH — used when OffscreenCanvas is unavailable.
    // Preserved exactly so the game still works in those environments.
    // ---------------------------------------------------------------------------
    const canvasW = this.canvasWidth;
    const canvasH = this.canvasHeight;
    {
      const offCtx = ctx;

      for (let x = startX; x < endX; x += groupSize) {
        for (let y = startY; y < endY; y += groupSize) {
          // Check if this tile group should be rendered
          if (!this.renderOptimization.shouldRenderTileGroup(x, y, groupSize, camera, canvasW, canvasH)) {
            continue;
          }

          // World-space position: tile coords in pixels (camera transform on ctx handles offset)
          const screenX = x * this.TILE_SIZE;
          const screenY = y * this.TILE_SIZE;

          // CRITICAL: Visual grid MUST be fully initialized before rendering
          if (!this.visualGrid[x] || !this.visualGrid[x][y]) {
            if (window.debugLogBridge) {
              window.debugLogBridge.log('❌ CRITICAL: Visual grid not initialized during render!', 'error', {
                source: 'four_kings_territory',
                operation: 'render_missing_visual',
                tilePos: [x, y],
                renderBounds: { startX, startY, endX, endY },
                visualGridExists: !!this.visualGrid[x],
              });
            }
            continue;
          }

          // Verify territory data exists
          let territoryData = this.chunkManager.getTile(x, y);

          // For LOD, aggregate multiple tiles — uses pre-allocated buffer (no heap allocation)
          if (groupSize > 1) {
            this.tilesInGroupBuffer.length = 0;

            for (let gx = x; gx < Math.min(x + groupSize, this.GRID_WIDTH); gx++) {
              for (let gy = y; gy < Math.min(y + groupSize, this.GRID_HEIGHT); gy++) {
                if (this.visualGrid[gx] && this.visualGrid[gx][gy]) {
                  const visual = this.visualGrid[gx][gy];
                  if (visual.currentKing > 0) {
                    const king = this.kings[visual.currentKing - 1];
                    if (king) {
                      this.tilesInGroupBuffer.push({
                        king: visual.currentKing,
                        strength: visual.strength,
                        color: king.color,
                      });
                    }
                  }
                }
              }
            }

            if (this.tilesInGroupBuffer.length > 0) {
              const aggregated = this.renderOptimization.aggregateTileColors(this.tilesInGroupBuffer, lodLevel);
              // Boost opacity in light mode so territories are visible on cream background
              const lodOpacityScale = opacityScale;
              offCtx.globalAlpha = Math.min(0.75, aggregated.strength * 0.5 * lodOpacityScale);
              offCtx.fillStyle = aggregated.color;
              offCtx.fillRect(screenX, screenY, this.TILE_SIZE * groupSize, this.TILE_SIZE * groupSize);
              offCtx.globalAlpha = 1;
            }
            continue;
          }

          // Single-tile rendering for FULL LOD
          const visual = this.visualGrid[x][y];

          if (visual.currentKing === 0) {
            if (lodLevel !== 'FULL') {
              continue;
            }
            offCtx.fillStyle = '#1a1a1a';
            offCtx.globalAlpha = 0.15;
            offCtx.fillRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
            offCtx.strokeStyle = '#2a2a2a';
            offCtx.globalAlpha = 0.05;
            offCtx.lineWidth = 1;
            offCtx.strokeRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
            continue;
          }

          if (visual.strength < 0.01) {
            visual.strength = Math.max(visual.strength, 0.05);
          }

          const king = this.kings[visual.currentKing - 1];
          if (!territoryData) {
            territoryData = this.territoryGrid[x]?.[y] || null;
          }

          if (!king) {
            offCtx.fillStyle = '#333333';
            offCtx.globalAlpha = 0.03;
            offCtx.fillRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
            continue;
          }

          const dynamicColor = this.territoryColor.getDynamicTileColor(
            x,
            y,
            king,
            territoryData,
            this.GRID_WIDTH,
            this.coreTilesPerKing,
            this.borderTilesPerKing
          );

          offCtx.fillStyle = dynamicColor.base;
          offCtx.globalAlpha = Math.min(0.35, visual.strength * FOUR_KINGS_CONFIG.VISUAL_OPACITY * 0.5 * opacityScale);
          offCtx.fillRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);

          if (dynamicColor.secondary) {
            offCtx.fillStyle = dynamicColor.secondary;
            offCtx.globalAlpha = Math.min(0.2, visual.strength * FOUR_KINGS_CONFIG.VISUAL_OPACITY * 0.3 * opacityScale);
            offCtx.fillRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
          }

          if (this.battleFronts.has(y * this.GRID_WIDTH + x)) {
            offCtx.fillStyle = dynamicColor.glow;
            // Use pre-hoisted glowPulse — no per-tile Date.now()
            const glowAlpha = visual.strength * FOUR_KINGS_CONFIG.GLOW_OPACITY * glowPulse * opacityScale;
            offCtx.globalAlpha = Math.min(0.2, glowAlpha);
            offCtx.fillRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
          }

          offCtx.strokeStyle = dynamicColor.accent;
          offCtx.globalAlpha = Math.min(0.15, visual.strength * FOUR_KINGS_CONFIG.GRID_LINE_OPACITY * opacityScale);
          offCtx.lineWidth = 1;
          offCtx.strokeRect(screenX, screenY, this.TILE_SIZE, this.TILE_SIZE);
        }
      }

      offCtx.globalAlpha = 1;
    }
  }

  /**
   * Bake per-king territory tiles onto cached OffscreenCanvases with edge feathering.
   * Called only when territoryGeneration changes (ownership or conquest events).
   * The blur is applied once at bake time; per-frame rendering uses ctx.drawImage only.
   *
   * Canvas is clamped to <=2048px on the long side so GPU memory stays bounded.
   */
  private rebakeOffscreenCanvases(): void {
    // Light mode boosts territory alpha 10% (same scale the direct-draw path uses); it must be
    // baked into the tiles because the draw-time globalAlpha is clamped to 1.
    const opacityScale = this.themeService.isDayMode ? 1.1 : 1.0;

    const worldW = this.GRID_WIDTH * this.TILE_SIZE;
    const worldH = this.GRID_HEIGHT * this.TILE_SIZE;
    const longSide = Math.max(worldW, worldH);
    const scale = Math.min(1, 2048 / longSide);
    const bakedW = Math.round(worldW * scale);
    const bakedH = Math.round(worldH * scale);

    for (let ki = 0; ki < this.kings.length; ki++) {
      const king = this.kings[ki];
      // Step 1: draw tiles onto a REUSED scratch canvas (hoisted out of the loop so we don't
      // allocate four ~12MB OffscreenCanvas surfaces on every bake). Because it's reused it
      // still holds the previous bake, so clear it before redrawing.
      let tmpCanvas = this.bakeScratchCanvases[ki];
      if (!tmpCanvas || tmpCanvas.width !== bakedW || tmpCanvas.height !== bakedH) {
        tmpCanvas = new OffscreenCanvas(bakedW, bakedH);
        this.bakeScratchCanvases[ki] = tmpCanvas;
      }
      const tmpCtx = tmpCanvas.getContext('2d');
      if (!tmpCtx) continue;
      tmpCtx.clearRect(0, 0, bakedW, bakedH);

      for (let x = 0; x < this.GRID_WIDTH; x++) {
        for (let y = 0; y < this.GRID_HEIGHT; y++) {
          const visual = this.visualGrid[x]?.[y];
          if (!visual || visual.currentKing !== king.id) continue;
          if (visual.strength < 0.01) continue;

          const territoryData = this.territoryGrid[x]?.[y] ?? null;
          const dynamicColor = this.territoryColor.getDynamicTileColor(
            x,
            y,
            king,
            territoryData,
            this.GRID_WIDTH,
            this.coreTilesPerKing,
            this.borderTilesPerKing
          );

          const px = Math.round(x * this.TILE_SIZE * scale);
          const py = Math.round(y * this.TILE_SIZE * scale);
          const pw = Math.max(1, Math.round(this.TILE_SIZE * scale));

          // Base fill
          tmpCtx.fillStyle = dynamicColor.base;
          tmpCtx.globalAlpha = Math.min(0.35, visual.strength * FOUR_KINGS_CONFIG.VISUAL_OPACITY * 0.5 * opacityScale);
          tmpCtx.fillRect(px, py, pw, pw);

          // Secondary layer
          if (dynamicColor.secondary) {
            tmpCtx.fillStyle = dynamicColor.secondary;
            tmpCtx.globalAlpha = Math.min(0.2, visual.strength * FOUR_KINGS_CONFIG.VISUAL_OPACITY * 0.3 * opacityScale);
            tmpCtx.fillRect(px, py, pw, pw);
          }
        }
      }
      tmpCtx.globalAlpha = 1;

      // Step 2: apply a one-time blur onto the stored OffscreenCanvas for edge feathering.
      // The blur softens the hard tile-grid cross into a smooth atmospheric tint.
      let storedCanvas = this.territoryOffscreenCanvases.get(king.id);
      if (!storedCanvas || storedCanvas.width !== bakedW || storedCanvas.height !== bakedH) {
        storedCanvas = new OffscreenCanvas(bakedW, bakedH);
        this.territoryOffscreenCanvases.set(king.id, storedCanvas);
      }
      const storedCtx = storedCanvas.getContext('2d');
      if (!storedCtx) continue;

      storedCtx.clearRect(0, 0, bakedW, bakedH);
      // blur(24px) over a ~3M-pixel surface is a catastrophic mobile-GPU cost (separable Gaussian,
      // ~48-px kernel). On touch, skip the feather entirely — the tint is semi-transparent so the
      // un-softened tile edges read fine at phone scale and arm's length. Desktop keeps the feather.
      if (this.isTouch) {
        storedCtx.drawImage(tmpCanvas, 0, 0);
      } else {
        storedCtx.filter = 'blur(24px)';
        storedCtx.drawImage(tmpCanvas, 0, 0);
        storedCtx.filter = 'none';
      }
    }

    // Composite all four kings' blurred canvases into ONE so the per-frame render does a single
    // drawImage instead of 4. Tiles don't overlap between kings, so this is a lossless union.
    let composite = this.compositeOffscreenCanvas;
    if (!composite || composite.width !== bakedW || composite.height !== bakedH) {
      composite = new OffscreenCanvas(bakedW, bakedH);
      this.compositeOffscreenCanvas = composite;
    }
    const cctx = composite.getContext('2d');
    if (cctx) {
      cctx.clearRect(0, 0, bakedW, bakedH);
      for (const king of this.kings) {
        const baked = this.territoryOffscreenCanvases.get(king.id);
        if (baked) cctx.drawImage(baked, 0, 0);
      }
    }
  }

  /**
   * Validate that visual grid is completely initialized
   */
  private validateVisualGridComplete(): void {
    let missingCount = 0;
    const missingTiles: Array<{ x: number; y: number }> = [];

    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        if (!this.visualGrid[x] || !this.visualGrid[x][y]) {
          missingCount++;
          if (missingTiles.length < 10) {
            // Log first 10 missing
            missingTiles.push({ x, y });
          }
        }
      }
    }

    if (missingCount > 0) {
      const error = `Visual grid incomplete! Missing ${missingCount} tiles out of ${this.GRID_WIDTH * this.GRID_HEIGHT}`;
      if (window.debugLogBridge) {
        window.debugLogBridge.log('❌ ' + error, 'error', {
          source: 'four_kings_territory',
          operation: 'validate_visual_grid',
          gridSize: [this.GRID_WIDTH, this.GRID_HEIGHT],
          expectedTiles: this.GRID_WIDTH * this.GRID_HEIGHT,
          missingCount,
          missingTiles,
          visualGridLength: this.visualGrid.length,
        });
      }
      // Don't throw - just log the error
      return;
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('✅ Visual grid validation passed', 'info', {
        source: 'four_kings_territory',
        operation: 'validate_visual_grid',
        gridSize: [this.GRID_WIDTH, this.GRID_HEIGHT],
        totalTiles: this.GRID_WIDTH * this.GRID_HEIGHT,
        allTilesPresent: true,
      });
    }
  }

  /**
   * Helper: Check if tile coordinates are valid
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  private isValidTile(x: number, y: number): boolean {
    return this.territoryQuery.isValidTile(x, y);
  }

  /**
   * Helper: Get neighbor coordinates
   */
  private getNeighbors(x: number, y: number): [number, number][] {
    return [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
      [x - 1, y - 1],
      [x + 1, y - 1],
      [x - 1, y + 1],
      [x + 1, y + 1],
    ];
  }

  /**
   * Helper: Check if a tile is on the border of a kingdom
   */
  private isBorderTile(x: number, y: number, kingId: number): boolean {
    const neighbors = this.getNeighbors(x, y);

    for (const [nx, ny] of neighbors) {
      if (!this.isValidTile(nx, ny)) continue;
      const neighbor = this.territoryGrid[nx][ny];

      if (!neighbor || neighbor.kingId !== kingId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sprint 7: Build border tile sets for all kings from scratch.
   * Called once after world generation and whenever a full rebuild is needed.
   */
  private rebuildBorderTileSets(): void {
    this.borderTilesPerKing.clear();
    // Sprint 8: clear and rebuild core tile sets alongside border tiles
    this.coreTilesPerKing.clear();

    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x]?.[y];
        if (!tile || tile.kingId === 0) continue;

        const idx = y * this.GRID_WIDTH + x;

        if (this.isBorderTile(x, y, tile.kingId)) {
          let set = this.borderTilesPerKing.get(tile.kingId);
          if (!set) {
            set = new Set<number>();
            this.borderTilesPerKing.set(tile.kingId, set);
          }
          set.add(idx);
        }

        // Sprint 8: pre-compute core tiles (>= 6 friendly neighbors)
        if (this.countFriendlyNeighbors(x, y, tile.kingId) >= 6) {
          let coreSet = this.coreTilesPerKing.get(tile.kingId);
          if (!coreSet) {
            coreSet = new Set<number>();
            this.coreTilesPerKing.set(tile.kingId, coreSet);
          }
          coreSet.add(idx);
        }
      }
    }
  }

  /**
   * Sprint 7: Incrementally update border sets after a tile changes ownership.
   * Rechecks the tile itself and all its 8 neighbors.
   */
  private updateBorderSetsAroundTile(x: number, y: number): void {
    const positions: [number, number][] = [[x, y], ...this.getNeighbors(x, y)];

    for (const [px, py] of positions) {
      if (!this.isValidTile(px, py)) continue;

      const tile = this.territoryGrid[px]?.[py];

      // Remove this position from all king border sets first
      const idx = py * this.GRID_WIDTH + px;
      for (const [, set] of this.borderTilesPerKing) {
        set.delete(idx);
      }
      // Sprint 8: remove from all core tile sets
      for (const [, coreSet] of this.coreTilesPerKing) {
        coreSet.delete(idx);
      }

      // Re-add if this position is a border tile for its current owner
      if (tile && tile.kingId > 0 && this.isBorderTile(px, py, tile.kingId)) {
        let set = this.borderTilesPerKing.get(tile.kingId);
        if (!set) {
          set = new Set<number>();
          this.borderTilesPerKing.set(tile.kingId, set);
        }
        set.add(idx);
      }

      // Sprint 8: re-add to core tiles if >= 6 friendly neighbors
      if (tile && tile.kingId > 0 && this.countFriendlyNeighbors(px, py, tile.kingId) >= 6) {
        let coreSet = this.coreTilesPerKing.get(tile.kingId);
        if (!coreSet) {
          coreSet = new Set<number>();
          this.coreTilesPerKing.set(tile.kingId, coreSet);
        }
        coreSet.add(idx);
      }
    }
  }

  /**
   * Helper: Count friendly neighbors
   */
  private countFriendlyNeighbors(x: number, y: number, kingId: number): number {
    const neighbors = this.getNeighbors(x, y);
    let count = 0;

    for (const [nx, ny] of neighbors) {
      if (!this.isValidTile(nx, ny)) continue;
      const neighbor = this.territoryGrid[nx][ny];

      if (neighbor && neighbor.kingId === kingId) {
        count++;
      }
    }

    return count;
  }

  /**
   * Helper: Count enemy neighbors
   */
  private countEnemyNeighbors(x: number, y: number, kingId: number): number {
    const neighbors = this.getNeighbors(x, y);
    let count = 0;

    for (const [nx, ny] of neighbors) {
      if (!this.isValidTile(nx, ny)) continue;
      const neighbor = this.territoryGrid[nx][ny];

      if (neighbor && neighbor.kingId !== kingId) {
        count++;
      }
    }

    return count;
  }

  /**
   * Helper: Get unique enemy neighbors
   */
  private getUniqueEnemyNeighbors(x: number, y: number, kingId: number): Set<number> {
    const neighbors = this.getNeighbors(x, y);
    const uniqueEnemies = new Set<number>();

    for (const [nx, ny] of neighbors) {
      if (!this.isValidTile(nx, ny)) continue;
      const neighbor = this.territoryGrid[nx][ny];

      if (neighbor && neighbor.kingId !== kingId) {
        uniqueEnemies.add(neighbor.kingId);
      }
    }

    return uniqueEnemies;
  }

  /**
   * Helper: Shuffle array
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.random.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Update conquest state - check for conquered kingdoms
   */
  private updateConquestState(): void {
    // Use connectivity-aware conquest checking
    this.updateConquestStateWithConnectivity();
  }

  /**
   * Conquer a king and absorb their power
   */
  private conquerKing(kingId: number): void {
    if (!this.activeKings.has(kingId)) return;

    // Remove from active kings
    this.activeKings.delete(kingId);
    this.conqueredKings.push(kingId);
    this.kingLowTileTimers.delete(kingId);

    // Remove all territories of conquered king
    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];
        if (tile && tile.kingId === kingId) {
          this.territoryGrid[x][y] = null;
        }
      }
    }

    // Sprint 6: invalidate render cache after conquest clears tiles
    // Sprint 7: conquest changes many tiles so rebuild all border sets from scratch
    this.rebuildBorderTileSets();
    // Invalidate offscreen bake — conquest clears many tiles
    this.territoryGeneration++;

    // Distribute power to remaining kings
    this.absorPowerFromConqueredKing(kingId);

    if (window.debugLogBridge) {
      window.debugLogBridge.log(
        `King ${this.kings[kingId - 1].name} has been conquered! ${this.activeKings.size} kings remain.`,
        'info'
      );
    }
  }

  /**
   * Absorb power from conquered king and distribute to remaining kings
   */
  private absorPowerFromConqueredKing(_conqueredKingId: number): void {
    const remainingKings = Array.from(this.activeKings);
    if (remainingKings.length === 0) return;

    // Calculate power absorption
    const powerIncrease = 0.5; // 50% power increase per conquest
    this.powerMultiplier += powerIncrease;

    // Boost expansion rates of remaining kings
    remainingKings.forEach((kingId) => {
      const king = this.kings[kingId - 1];
      if (king) {
        king.expansionRate *= 1 + powerIncrease;
        king.warlikeness = Math.min(1, king.warlikeness * 1.2); // Increase aggression
      }
    });

    if (window.debugLogBridge) {
      window.debugLogBridge.log(
        `Remaining kings absorbed power! Power multiplier: ${this.powerMultiplier.toFixed(2)}`,
        'info'
      );
    }
  }

  /**
   * Update conquest phase based on active kings
   */
  private updateConquestPhase(): void {
    const previousPhase = this.conquestPhase;

    switch (this.activeKings.size) {
      case 4:
        this.conquestPhase = 1;
        break;
      case 3:
        this.conquestPhase = 2;
        break;
      case 2:
        this.conquestPhase = 3;
        break;
      case 1:
        this.conquestPhase = 4; // Boss phase
        break;
      case 0:
        this.conquestPhase = 5; // Next wave
        this.startNextWave();
        break;
    }

    if (previousPhase !== this.conquestPhase) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`Conquest Phase ${this.conquestPhase}: ${this.getPhaseDescription()}`, 'info');
      }
    }
  }

  /**
   * Start next wave after all kings are conquered
   */
  private startNextWave(): void {
    // Reset to initial state with boosted power
    this.activeKings = new Set([1, 2, 3, 4]);
    this.conqueredKings = [];
    this.kingLowTileTimers.clear();

    // Keep power multiplier from previous wave
    if (window.debugLogBridge) {
      window.debugLogBridge.log(`Starting next wave with power multiplier: ${this.powerMultiplier.toFixed(2)}`, 'info');
    }

    // Re-seed territories with increased power
    this.seedInitialTerritories();

    // Reset conquest phase
    this.conquestPhase = 1;
  }

  /**
   * Get description of current conquest phase
   */
  private getPhaseDescription(): string {
    switch (this.conquestPhase) {
      case 1:
        return '4 Kings Battle';
      case 2:
        return '3 Kings Remain';
      case 3:
        return '2 Kings Face Off';
      case 4:
        return 'Final King Boss Phase';
      case 5:
        return 'Next Wave Incoming';
      default:
        return 'Unknown Phase';
    }
  }

  /**
   * Update conquest state with simplified connectivity validation (performance optimized)
   */
  private updateConquestStateWithConnectivity(): void {
    // Count territories for each king (simplified)
    this.kingTerritoryCount.clear();

    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];
        if (tile && this.activeKings.has(tile.kingId)) {
          const current = this.kingTerritoryCount.get(tile.kingId) || 0;
          this.kingTerritoryCount.set(tile.kingId, current + 1);
        }
      }
    }

    // Simplified conquest logic - just use tile count for now
    const kingsToConquer: number[] = [];

    this.activeKings.forEach((kingId) => {
      const tileCount = this.kingTerritoryCount.get(kingId) || 0;

      if (tileCount < this.MIN_TILES_TO_SURVIVE) {
        const currentTimer = this.kingLowTileTimers.get(kingId) || 0;
        const newTimer = currentTimer + this.CONQUEST_CHECK_INTERVAL;
        this.kingLowTileTimers.set(kingId, newTimer);

        if (newTimer >= this.CONQUEST_GRACE_PERIOD) {
          kingsToConquer.push(kingId);
        }
      } else {
        this.kingLowTileTimers.delete(kingId);
      }
    });

    // Process conquests
    kingsToConquer.forEach((kingId) => {
      this.conquerKing(kingId);
    });

    // Update conquest phase
    this.updateConquestPhase();
  }

  /**
   * Get the current territory generation (incremented when territories change)
   */
  getTerritoryGeneration(): number {
    return this.territoryGeneration;
  }

  /**
   * Get territory info at world position
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.
   * `loggedErrors` stays OWNED here — setSeed()/reset()/destroy() clear it — the
   * facade only appends to this same Set instance, exactly as before extraction.)
   */
  getTerritoryAtPosition(
    worldX: number,
    worldY: number
  ): { kingId: number; kingName: string; strength: number } | null {
    return this.territoryQuery.getTerritoryAtPosition(
      worldX,
      worldY,
      this.territoryGrid,
      this.kings,
      this.loggedErrors
    );
  }

  /**
   * Get conquest status for debugging/UI
   */
  getConquestStatus(): {
    phase: number;
    phaseDescription: string;
    activeKings: number[];
    conqueredKings: number[];
    powerMultiplier: number;
    territoryCount: Map<number, number>;
  } {
    return {
      phase: this.conquestPhase,
      phaseDescription: this.getPhaseDescription(),
      activeKings: Array.from(this.activeKings),
      conqueredKings: [...this.conqueredKings],
      powerMultiplier: this.powerMultiplier,
      territoryCount: new Map(this.kingTerritoryCount),
    };
  }

  /**
   * Debug method to check territory coverage
   */
  debugTerritoryCoverage(): {
    totalTiles: number;
    filledTiles: number;
    emptyTiles: number;
    coverage: number;
    tilesByKing: Map<number, number>;
    emptyRegions: Array<{ x: number; y: number }>;
  } {
    let filledTiles = 0;
    let emptyTiles = 0;
    const tilesByKing = new Map<number, number>();
    const emptyRegions: Array<{ x: number; y: number }> = [];

    for (let x = 0; x < this.GRID_WIDTH; x++) {
      for (let y = 0; y < this.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x]?.[y];
        if (tile && tile.kingId > 0) {
          filledTiles++;
          tilesByKing.set(tile.kingId, (tilesByKing.get(tile.kingId) || 0) + 1);
        } else {
          emptyTiles++;
          if (emptyRegions.length < 100) {
            // Limit to first 100 for performance
            emptyRegions.push({ x, y });
          }
        }
      }
    }

    const totalTiles = this.GRID_WIDTH * this.GRID_HEIGHT;
    const coverage = filledTiles / totalTiles;

    const result = {
      totalTiles,
      filledTiles,
      emptyTiles,
      coverage,
      tilesByKing,
      emptyRegions,
    };

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Coverage Debug', 'info', {
        ...result,
        coveragePercent: (coverage * 100).toFixed(2) + '%',
        gridDimensions: [this.GRID_WIDTH, this.GRID_HEIGHT],
        worldDimensions: [this.GRID_WIDTH * this.TILE_SIZE, this.GRID_HEIGHT * this.TILE_SIZE],
      });
    }

    return result;
  }

  /**
   * Get tile at world coordinates (public method for bridge)
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  getTileAtWorld(worldX: number, worldY: number): TerritoryTile | null {
    return this.territoryQuery.getTileAtWorld(worldX, worldY, this.territoryGrid);
  }

  /**
   * Get initialization status (public method for bridge)
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get tile at grid coordinates
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  getTile(gridX: number, gridY: number): TerritoryTile | null {
    return this.territoryQuery.getTile(gridX, gridY, this.territoryGrid);
  }

  /**
   * Mark a tile for visual update
   */
  markTileForUpdate(gridX: number, gridY: number): void {
    if (!this.isValidTile(gridX, gridY)) return;

    // Update visual grid to force re-render by resetting transition
    if (this.visualGrid[gridX] && this.visualGrid[gridX][gridY]) {
      const visual = this.visualGrid[gridX][gridY];
      // Force update by resetting transition progress
      visual.transitionProgress = 0;

      // Add to transitioning tiles set for optimized updates
      this.markTileForTransition(gridX, gridY);

      // Get the actual tile to update visual grid correctly
      const tile = this.getTile(gridX, gridY);
      if (tile) {
        visual.targetKing = tile.kingId;
        visual.strength = tile.strength;
      }

      // Log the update
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory Tile Marked for Update', 'info', {
          gridX,
          gridY,
          targetKing: visual.targetKing,
          strength: visual.strength,
        });
      }
    }
  }

  /**
   * Dynamically change territory ownership
   * Used by TerritoryWarfareSystem for real-time conquest
   */
  setTerritoryOwnership(gridX: number, gridY: number, newKingId: number): void {
    if (!this.isValidTile(gridX, gridY)) return;

    // Get current tile
    const tile = this.getTile(gridX, gridY);
    if (!tile) {
      // Create new tile if doesn't exist
      this.territoryGrid[gridX] = this.territoryGrid[gridX] || [];
      this.territoryGrid[gridX][gridY] = {
        x: gridX,
        y: gridY,
        kingId: newKingId,
        strength: 50,
        age: 0,
        contested: false,
      };
      // Sprint 7: update border sets for newly created tile
      this.updateBorderSetsAroundTile(gridX, gridY);
    } else {
      // Update existing tile
      const oldKingId = tile.kingId;
      tile.kingId = newKingId;
      tile.strength = Math.max(tile.strength, 30); // Ensure minimum strength
      tile.age = 0; // Reset age for new owner

      // Update king territory counts
      if (oldKingId > 0) {
        const oldCount = this.kingTerritoryCount.get(oldKingId) || 0;
        this.kingTerritoryCount.set(oldKingId, Math.max(0, oldCount - 1));
      }
      if (newKingId > 0) {
        const newCount = this.kingTerritoryCount.get(newKingId) || 0;
        this.kingTerritoryCount.set(newKingId, newCount + 1);
      }

      // Chunk manager will pick up the change from the main grid
      // No need to update it directly

      // Check if this creates new battle fronts
      this.updateBattleFrontsAroundTile(gridX, gridY);
      // Sprint 7: update border sets for external ownership change
      this.updateBorderSetsAroundTile(gridX, gridY);
    }

    // Sprint 6: invalidate render cache on external ownership change
    // Invalidate offscreen bake — external ownership change must re-feather
    this.territoryGeneration++;

    // Mark for visual update
    this.markTileForUpdate(gridX, gridY);
  }

  /**
   * Get territory at grid coordinates (for territory warfare)
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  getTerritoryAt(gridX: number, gridY: number): number {
    return this.territoryQuery.getTerritoryAt(gridX, gridY, this.territoryGrid);
  }

  /**
   * Get the generated world (for territory warfare system)
   * (Extracted to TerritoryQueryService — see that file for the read-only facade.)
   */
  getGeneratedWorld(): GeneratedWorld | null {
    return this.territoryQuery.getGeneratedWorld(
      this.isInitialized,
      this.currentWorldSeed,
      this.territoryGrid,
      this.kings
    );
  }

  /**
   * Update battle fronts after ownership change
   */
  private updateBattleFrontsAroundTile(gridX: number, gridY: number): void {
    const neighbors = [
      { x: gridX - 1, y: gridY },
      { x: gridX + 1, y: gridY },
      { x: gridX, y: gridY - 1 },
      { x: gridX, y: gridY + 1 },
    ];

    const centerTile = this.getTile(gridX, gridY);
    if (!centerTile) return;

    let isContested = false;

    for (const neighbor of neighbors) {
      if (this.isValidTile(neighbor.x, neighbor.y)) {
        const neighborTile = this.getTile(neighbor.x, neighbor.y);
        if (neighborTile && neighborTile.kingId !== centerTile.kingId && neighborTile.kingId > 0) {
          isContested = true;
          break;
        }
      }
    }

    centerTile.contested = isContested;

    if (isContested) {
      const key = gridY * this.GRID_WIDTH + gridX;
      if (!this.battleFronts.has(key)) {
        this.battleFronts.add(key);
      }
    }
  }

  /**
   * Reset tracking state for game restart — clears all Maps/Sets without destroying config.
   */
  reset(): void {
    this.battleFronts.clear();
    this.transitioningTiles.clear();
    this.activeKings = new Set([1, 2, 3, 4]);
    this.kingTerritoryCount.clear();
    this.loggedErrors.clear();
    this.kingLowTileTimers.clear();
    this.conqueredKings = [];
    this.conquestPhase = 1;
    this.powerMultiplier = 1.0;
    // Sprint 7: clear border tile caches
    this.borderTilesPerKing.clear();
    // Sprint 8: clear core tile caches
    this.coreTilesPerKing.clear();
    // Sprint 6: force cache rebuild on next render
    // Clear offscreen bake — will be rebuilt after next generateWorld
    this.territoryOffscreenCanvases.clear();
    this.lastBakedGeneration = -1;
    // T3: release GPU bake scratch canvases for symmetry with destroy()
    this.bakeScratchCanvases.length = 0;
    this.compositeOffscreenCanvas = null;
  }

  destroy(): void {
    // Cleanup
    this.territoryGrid = [];
    this.visualGrid = [];
    this.battleFronts.clear();
    this.transitioningTiles.clear();
    this.activeKings.clear();
    this.kingTerritoryCount.clear();
    this.loggedErrors.clear();
    this.kingLowTileTimers.clear();
    // Sprint 7: clear border tile caches
    this.borderTilesPerKing.clear();
    // Sprint 8: clear core tile caches
    this.coreTilesPerKing.clear();
    // Sprint 6: release OffscreenCanvas
    this.territoryOffscreenCanvases.clear();
    this.lastBakedGeneration = -1;
    // T3: release GPU bake scratch and composite canvases to avoid GPU memory leak
    this.bakeScratchCanvases.length = 0;
    this.compositeOffscreenCanvas = null;
    this.isInitialized = false;
  }
}
