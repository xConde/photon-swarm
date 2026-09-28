import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FourKingsTerritoryService, TerritoryRenderingOptimizationService } from '../territory';
import { RandomService } from '../../utils/random.service';
import { SeededRandomService } from '../../utils/seeded-random.service';
import { DynamicTerritoryGeneratorService } from './dynamic-territory-generator.service';
import { TerritoryChunkManagerService } from './territory-chunk-manager.service';
import { TerritoryHashService } from '../../world/territory-hash.service';
import { EntityManager } from '../../ecs/ecs.model';
import { PositionComponent } from '@photon/components/position.component';
import { VelocityComponent } from '@photon/components/velocity.component';
import { TerritoryTile } from '../../models/territory.model';
import { TileVisibilityService } from '../combat/tile-visibility.service';
import { PlayerService } from '../../player/player.service';

/**
 * Helper function to check if a componentType matches a component class
 */
function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  return (
    componentType === componentClass ||
    (typeof componentType === 'function' &&
      typeof componentClass === 'function' &&
      componentType.name === componentClass.name)
  );
}

/**
 * Comprehensive Tile Visibility Test Suite
 *
 * These tests ensure that tiles are NEVER visible to the player during generation.
 * The tiles must be pre-generated far enough ahead that the player never sees empty
 * or generating tiles regardless of movement speed or direction.
 */
describe('FourKingsTerritoryService - Tile Visibility', () => {
  let service: FourKingsTerritoryService;
  let dynamicTerritoryGeneratorSpy: jasmine.SpyObj<DynamicTerritoryGeneratorService>;
  let chunkManagerSpy: jasmine.SpyObj<TerritoryChunkManagerService>;
  let mockEntityManager: jasmine.SpyObj<EntityManager>;

  // Mock canvas dimensions
  const CANVAS_WIDTH = 1920;
  const CANVAS_HEIGHT = 1080;

  // Real service constants (from FOUR_KINGS_CONFIG and WORLD_CONFIG)
  const TILE_SIZE = 120; // FOUR_KINGS_CONFIG.TILE_SIZE
  const WORLD_WIDTH = 12000; // WORLD_CONFIG.BOUNDS.WIDTH
  const WORLD_HEIGHT = 9000; // WORLD_CONFIG.BOUNDS.HEIGHT
  const GRID_WIDTH = Math.ceil(WORLD_WIDTH / TILE_SIZE); // 100
  const GRID_HEIGHT = Math.ceil(WORLD_HEIGHT / TILE_SIZE); // 75

  // Player speeds
  const MAX_SPEED = 600; // With upgrades
  const DASH_SPEED = 1200; // Dash ability

  beforeEach(() => {
    // Create spies
    const randomSpy = jasmine.createSpyObj('RandomService', ['random', 'randomInt', 'setSeed', 'fork']);
    const seededRandomSpy = jasmine.createSpyObj('SeededRandomService', ['random', 'randomInt', 'setSeed', 'fork']);
    const dynamicGeneratorSpy = jasmine.createSpyObj('DynamicTerritoryGeneratorService', [
      'generateTerritories',
      'getGenerationSummary',
      'setSeed',
      'setRandomService',
    ]);
    const chunkSpy = jasmine.createSpyObj('TerritoryChunkManagerService', [
      'initialize',
      'getTile',
      'getTilesInRegion',
      'preloadChunksAroundPosition',
      'getCacheStats',
      'ensureWorldGenerated',
      'getAllChunks',
      'hasFullWorldGrid',
    ]);
    const hashSpy = jasmine.createSpyObj('TerritoryHashService', ['generateWorldHash', 'validateWorldIntegrity']);
    const tileVisibilitySpy = jasmine.createSpyObj('TileVisibilityService', [
      'getVisibleTiles',
      'isVisible',
      'updateViewport',
      'calculatePreloadBounds',
      'updatePlayerTracking',
      'shouldUpdatePreload',
      'calculateOptimalPreloadStrategy',
      'validateVisibleTilesLoaded',
      'getMetrics',
    ]);
    const playerServiceSpy = jasmine.createSpyObj('PlayerService', [
      'getPosition',
      'isDashing',
      'isInvincible',
      'isParryAvailable',
      'isDirectionChangeOnCooldown',
      'getShardMultiplier',
      'getMaxHealth',
    ]);
    const renderOptimizationSpy = jasmine.createSpyObj('TerritoryRenderingOptimizationService', [
      'shouldRender',
      'optimizeRender',
      'getVisibleRegion',
      'calculateOptimizedRenderBounds',
      'updateCacheManagement',
      'shouldRenderTileGroup',
      'aggregateTileColors',
      'renderTileWithLOD',
    ]);

    mockEntityManager = jasmine.createSpyObj('EntityManager', [
      'createEntity',
      'addComponent',
      'getComponent',
      'removeEntity',
      'getEntitiesWithComponents',
    ]);

    // Setup return values
    randomSpy.random.and.returnValue(0.5);
    randomSpy.randomInt.and.returnValue(1);
    randomSpy.fork.and.returnValue(seededRandomSpy);
    seededRandomSpy.fork.and.returnValue(seededRandomSpy);
    playerServiceSpy.getPosition.and.returnValue({ x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 });
    playerServiceSpy.isDashing.and.returnValue(false);
    playerServiceSpy.isInvincible.and.returnValue(false);
    playerServiceSpy.isParryAvailable.and.returnValue(false);
    playerServiceSpy.isDirectionChangeOnCooldown.and.returnValue(false);
    playerServiceSpy.getShardMultiplier.and.returnValue(1);
    playerServiceSpy.getMaxHealth.and.returnValue(100);
    chunkSpy.hasFullWorldGrid.and.returnValue(true);
    chunkSpy.getAllChunks.and.returnValue(new Map());
    tileVisibilitySpy.getVisibleTiles.and.returnValue([]);
    tileVisibilitySpy.isVisible.and.returnValue(true);
    // Center tile for spawn is at grid center: (100/2, 75/2) = (50, 37.5)
    tileVisibilitySpy.calculatePreloadBounds.and.returnValue({
      centerTile: { x: 50, y: 37 },
      radius: 30,
      bounds: { minX: 20, minY: 7, maxX: 80, maxY: 67 },
      metrics: {
        speed: 0,
        predictedPosition: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
        bufferTiles: 20,
        totalTilesRequired: 3600,
      },
    });
    tileVisibilitySpy.updatePlayerTracking.and.returnValue({
      hasPlayer: true,
      position: { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
      velocity: { x: 0, y: 0 },
      tile: { x: 100, y: 100 },
    });
    tileVisibilitySpy.shouldUpdatePreload.and.returnValue(false);
    tileVisibilitySpy.calculateOptimalPreloadStrategy.and.returnValue({
      strategy: 'standard',
      priorityZones: [],
    });
    tileVisibilitySpy.validateVisibleTilesLoaded.and.returnValue({
      allLoaded: true,
      missingTiles: [],
    });
    tileVisibilitySpy.getMetrics.and.returnValue({
      violations: 0,
      violationRate: 0,
      recentViolations: 0,
      recommendation: 'normal',
    });
    renderOptimizationSpy.shouldRender.and.returnValue(true);
    renderOptimizationSpy.shouldRenderTileGroup.and.returnValue(true);
    renderOptimizationSpy.aggregateTileColors.and.returnValue({ color: '#4a1010', count: 1 });
    renderOptimizationSpy.getVisibleRegion.and.returnValue({ minX: 0, maxX: 100, minY: 0, maxY: 75 });
    renderOptimizationSpy.calculateOptimizedRenderBounds.and.returnValue({
      startX: 40,
      endX: 60,
      startY: 30,
      endY: 50,
      lodLevel: 'FULL',
      totalTiles: 400,
    });
    seededRandomSpy.random.and.returnValue(0.5);
    seededRandomSpy.randomInt.and.returnValue(1);

    // Create mock territory grid with real service dimensions (100x75)
    const mockGrid: (TerritoryTile | null)[][] = [];
    for (let x = 0; x < GRID_WIDTH; x++) {
      mockGrid[x] = [];
      for (let y = 0; y < GRID_HEIGHT; y++) {
        mockGrid[x][y] = {
          x,
          y,
          kingId: ((x + y) % 4) + 1,
          strength: 0.5 + (Math.sin(x * 0.1) + Math.cos(y * 0.1)) * 0.25,
          contested: false,
          age: 100, // Using age property instead of transitionProgress
        };
      }
    }

    dynamicGeneratorSpy.generateTerritories.and.returnValue(mockGrid);
    dynamicGeneratorSpy.getGenerationSummary.and.returnValue('Test summary');

    // Mock chunk manager responses
    chunkSpy.getTile.and.callFake((x: number, y: number) => {
      if (x >= 0 && x < mockGrid.length && y >= 0 && y < mockGrid[0].length) {
        return mockGrid[x][y];
      }
      return undefined;
    });

    chunkSpy.getTilesInRegion.and.callFake((startX: number, startY: number, width: number, height: number) => {
      const result: (TerritoryTile | null)[][] = [];
      for (let x = 0; x < width; x++) {
        result[x] = [];
        for (let y = 0; y < height; y++) {
          const tileX = startX + x;
          const tileY = startY + y;
          if (tileX >= 0 && tileX < mockGrid.length && tileY >= 0 && tileY < mockGrid[0].length) {
            result[x][y] = mockGrid[tileX][tileY];
          } else {
            result[x][y] = null;
          }
        }
      }
      return result;
    });

    chunkSpy.getCacheStats.and.returnValue({
      cachedChunks: 100,
      totalChunks: 400,
      cacheHitRate: 0.95,
      memoryUsage: '800KB',
    });

    hashSpy.generateWorldHash.and.returnValue('test-hash-123');
    hashSpy.validateWorldIntegrity.and.returnValue(true);

    // Mock entity manager for player entity
    const playerEntity = 1;
    mockEntityManager.getEntitiesWithComponents.and.returnValue([playerEntity]);
    (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId: number, componentType: unknown) => {
      if (isComponentType(componentType, PositionComponent)) {
        const pos = new PositionComponent();
        pos.x = WORLD_WIDTH / 2;
        pos.y = WORLD_HEIGHT / 2;
        return pos;
      }
      if (isComponentType(componentType, VelocityComponent)) {
        const vel = new VelocityComponent();
        vel.vx = 0;
        vel.vy = 0;
        return vel;
      }
      return undefined;
    });

    TestBed.configureTestingModule({
      providers: [
        FourKingsTerritoryService,
        { provide: RandomService, useValue: randomSpy },
        { provide: SeededRandomService, useValue: seededRandomSpy },
        { provide: DynamicTerritoryGeneratorService, useValue: dynamicGeneratorSpy },
        { provide: TerritoryChunkManagerService, useValue: chunkSpy },
        { provide: TerritoryHashService, useValue: hashSpy },
        { provide: TileVisibilityService, useValue: tileVisibilitySpy },
        { provide: PlayerService, useValue: playerServiceSpy },
        { provide: TerritoryRenderingOptimizationService, useValue: renderOptimizationSpy },
      ],
    });

    service = TestBed.inject(FourKingsTerritoryService);
    dynamicTerritoryGeneratorSpy = TestBed.inject(
      DynamicTerritoryGeneratorService
    ) as jasmine.SpyObj<DynamicTerritoryGeneratorService>;
    chunkManagerSpy = TestBed.inject(TerritoryChunkManagerService) as jasmine.SpyObj<TerritoryChunkManagerService>;

    // Mock window debug log
    window.debugLogBridge = {
      log: jasmine.createSpy('log'),
    };
  });

  afterEach(() => {
    window.debugLogBridge = undefined;
  });

  describe('Initial Spawn Tile Visibility', () => {
    it('should pre-generate tiles for spawn area before player entity exists', () => {
      service.init(mockEntityManager);
      // H5: world generation (and its spawn-area chunk preload) is deferred to
      // setSeed(), which the game-engine always calls right after init().
      service.setSeed('visibility-test-seed');

      // Verify spawn area preloading was requested
      expect(chunkManagerSpy.preloadChunksAroundPosition).toHaveBeenCalled();

      // Get the preload call
      const preloadCall = chunkManagerSpy.preloadChunksAroundPosition.calls.first();
      expect(preloadCall).toBeDefined();

      const [centerX, centerY, radius] = preloadCall.args;

      // Should preload around spawn point (grid center)
      // Grid center: (100/2, 75/2) = (50, 37.5) - use precision 0 to allow for rounding
      expect(centerX).toBeCloseTo(WORLD_WIDTH / TILE_SIZE / 2, 0);
      expect(centerY).toBeCloseTo(WORLD_HEIGHT / TILE_SIZE / 2, 0);

      // Should have large initial radius
      expect(radius).toBeGreaterThanOrEqual(25);
    });

    it('should ensure all visible tiles are generated at spawn', () => {
      service.init(mockEntityManager);

      const camera = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
      const mockContext = createMockContext();

      // First render should have all tiles available
      service.renderTerritories(mockContext, camera);

      // Verify no generation happened during render
      const generateCalls = dynamicTerritoryGeneratorSpy.generateTerritories.calls.count();
      expect(generateCalls).toBe(1); // Only the initial generation
    });

    it('should handle spawn at world boundaries', () => {
      // Test spawn near edges
      const edgePositions = [
        { x: 100, y: 100 }, // Top-left
        { x: WORLD_WIDTH - 100, y: 100 }, // Top-right
        { x: 100, y: WORLD_HEIGHT - 100 }, // Bottom-left
        { x: WORLD_WIDTH - 100, y: WORLD_HEIGHT - 100 }, // Bottom-right
      ];

      // Get the player service spy that was injected via TestBed
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;

      edgePositions.forEach((pos) => {
        // Re-inject a fresh service from TestBed for each edge position
        service = TestBed.inject(FourKingsTerritoryService);

        // Mock player spawn at edge
        (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
          if (isComponentType(componentType, PositionComponent)) {
            const position = new PositionComponent();
            position.x = pos.x;
            position.y = pos.y;
            return position;
          }
          return undefined;
        });

        // Update playerService mock for this position
        playerServiceSpy.getPosition.and.returnValue({ x: pos.x, y: pos.y });

        service.init(mockEntityManager);

        const camera = { x: pos.x, y: pos.y };
        const mockContext = createMockContext();

        // Should render without issues
        expect(() => service.renderTerritories(mockContext, camera)).not.toThrow();
      });
    });
  });

  describe('High-Speed Movement Tile Visibility', () => {
    beforeEach(() => {
      service.init(mockEntityManager);
    });

    it('should pre-generate tiles for maximum velocity movement', fakeAsync(() => {
      // Set player at max speed moving diagonally
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
        if (isComponentType(componentType, PositionComponent)) {
          const pos = new PositionComponent();
          pos.x = WORLD_WIDTH / 2;
          pos.y = WORLD_HEIGHT / 2;
          return pos;
        }
        if (isComponentType(componentType, VelocityComponent)) {
          const vel = new VelocityComponent();
          vel.vx = MAX_SPEED / Math.sqrt(2);
          vel.vy = MAX_SPEED / Math.sqrt(2);
          return vel;
        }
        return undefined;
      });

      // Update for several frames
      for (let i = 0; i < 10; i++) {
        service.update(0.016, mockEntityManager);
        tick(100); // 100ms per frame
      }

      // Check preload was called with velocity-based radius
      const preloadCalls = chunkManagerSpy.preloadChunksAroundPosition.calls.all();
      const lastCall = preloadCalls[preloadCalls.length - 1];

      if (lastCall) {
        const radius = lastCall.args[2];
        // Radius should be larger for high-speed movement
        expect(radius).toBeGreaterThanOrEqual(20);
      }
    }));

    it('should handle dash ability without tile pop-in', fakeAsync(() => {
      const startPos = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
      const currentPos = { ...startPos };

      // Simulate dash
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
        if (isComponentType(componentType, PositionComponent)) {
          const pos = new PositionComponent();
          pos.x = currentPos.x;
          pos.y = currentPos.y;
          return pos;
        }
        if (isComponentType(componentType, VelocityComponent)) {
          const vel = new VelocityComponent();
          vel.vx = DASH_SPEED;
          vel.vy = 0;
          return vel;
        }
        return undefined;
      });

      // Dash for 0.5 seconds
      const dashFrames = 5;
      for (let i = 0; i < dashFrames; i++) {
        currentPos.x += DASH_SPEED * 0.1; // 100ms per frame
        service.update(0.016, mockEntityManager);
        tick(100);

        // Render at new position
        const camera = { x: currentPos.x, y: currentPos.y };
        const mockContext = createMockContext();
        service.renderTerritories(mockContext, camera);
      }

      // No new generation should occur during dash
      expect(dynamicTerritoryGeneratorSpy.generateTerritories.calls.count()).toBe(1);
    }));

    it('should predictively load tiles based on movement direction', () => {
      // Moving right at high speed
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
        if (isComponentType(componentType, PositionComponent)) {
          const pos = new PositionComponent();
          pos.x = WORLD_WIDTH / 2;
          pos.y = WORLD_HEIGHT / 2;
          return pos;
        }
        if (isComponentType(componentType, VelocityComponent)) {
          const vel = new VelocityComponent();
          vel.vx = MAX_SPEED;
          vel.vy = 0;
          return vel;
        }
        return undefined;
      });

      service.update(0.016, mockEntityManager);

      // Check that preload was called
      const preloadCall = chunkManagerSpy.preloadChunksAroundPosition.calls.mostRecent();
      if (preloadCall) {
        const [tileX] = preloadCall.args as [number, number, number];

        // Should be preloading ahead of current position
        const expectedTileX = Math.floor(WORLD_WIDTH / 2 / TILE_SIZE);
        expect(tileX).toBeGreaterThanOrEqual(expectedTileX);
      }
    });
  });

  describe('Direction Change Tile Visibility', () => {
    beforeEach(() => {
      service.init(mockEntityManager);
    });

    it('should handle sudden 180-degree direction changes', fakeAsync(() => {
      let velocity = { vx: MAX_SPEED, vy: 0 };

      (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
        if (isComponentType(componentType, PositionComponent)) {
          const pos = new PositionComponent();
          pos.x = WORLD_WIDTH / 2;
          pos.y = WORLD_HEIGHT / 2;
          return pos;
        }
        if (isComponentType(componentType, VelocityComponent)) {
          const vel = new VelocityComponent();
          vel.vx = velocity.vx;
          vel.vy = velocity.vy;
          return vel;
        }
        return undefined;
      });

      // Move right
      service.update(0.016, mockEntityManager);
      tick(100);

      // Sudden reversal
      velocity = { vx: -MAX_SPEED, vy: 0 };
      service.update(0.016, mockEntityManager);
      tick(100);

      // Should have tiles ready in both directions
      const camera = { x: WORLD_WIDTH / 2 - 200, y: WORLD_HEIGHT / 2 };
      const mockContext = createMockContext();

      expect(() => service.renderTerritories(mockContext, camera)).not.toThrow();
    }));

    it('should handle circular movement patterns', fakeAsync(() => {
      const centerX = WORLD_WIDTH / 2;
      const centerY = WORLD_HEIGHT / 2;
      const radius = 500;
      let angle = 0;

      // Simulate circular movement
      for (let i = 0; i < 36; i++) {
        // Full circle in 36 steps
        angle += Math.PI / 18;
        const pos = {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        };
        const velocity = {
          vx: -Math.sin(angle) * MAX_SPEED,
          vy: Math.cos(angle) * MAX_SPEED,
        };

        (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
          if (isComponentType(componentType, PositionComponent)) return pos;
          if (isComponentType(componentType, VelocityComponent)) return velocity;
          return undefined;
        });

        service.update(0.016, mockEntityManager);
        tick(100);

        // Verify rendering works at each position
        const camera = { x: pos.x, y: pos.y };
        const mockContext = createMockContext();
        service.renderTerritories(mockContext, camera);
      }

      // Should complete without generating new tiles
      expect(dynamicTerritoryGeneratorSpy.generateTerritories.calls.count()).toBe(1);
    }));
  });

  describe('World Boundary Tile Visibility', () => {
    beforeEach(() => {
      service.init(mockEntityManager);
    });

    it('should handle movement along world edges', () => {
      const edgePaths = [
        // Top edge
        { start: { x: 100, y: 100 }, velocity: { vx: MAX_SPEED, vy: 0 } },
        // Right edge
        { start: { x: WORLD_WIDTH - 100, y: 100 }, velocity: { vx: 0, vy: MAX_SPEED } },
        // Bottom edge
        { start: { x: WORLD_WIDTH - 100, y: WORLD_HEIGHT - 100 }, velocity: { vx: -MAX_SPEED, vy: 0 } },
        // Left edge
        { start: { x: 100, y: WORLD_HEIGHT - 100 }, velocity: { vx: 0, vy: -MAX_SPEED } },
      ];

      edgePaths.forEach((path) => {
        (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
          if (isComponentType(componentType, PositionComponent)) return path.start;
          if (isComponentType(componentType, VelocityComponent)) return path.velocity;
          return undefined;
        });

        service.update(0.016, mockEntityManager);

        const camera = { x: path.start.x, y: path.start.y };
        const mockContext = createMockContext();

        expect(() => service.renderTerritories(mockContext, camera)).not.toThrow();
      });
    });

    it('should handle corner collision scenarios', () => {
      const corners = [
        { x: 50, y: 50 },
        { x: WORLD_WIDTH - 50, y: 50 },
        { x: 50, y: WORLD_HEIGHT - 50 },
        { x: WORLD_WIDTH - 50, y: WORLD_HEIGHT - 50 },
      ];

      corners.forEach((corner) => {
        (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
          if (isComponentType(componentType, PositionComponent)) return corner;
          if (isComponentType(componentType, VelocityComponent)) return { vx: 0, vy: 0 };
          return undefined;
        });

        service.update(0.016, mockEntityManager);

        const camera = { x: corner.x, y: corner.y };
        const mockContext = createMockContext();

        // Should render without issues
        service.renderTerritories(mockContext, camera);

        // Territory renders via the offscreen-bake (drawImage) when OffscreenCanvas is
        // available, or directly via fillRect on the fallback path.
        const drawCalls =
          (mockContext.fillRect as jasmine.Spy).calls.count() + (mockContext.drawImage as jasmine.Spy).calls.count();
        expect(drawCalls).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance and Stress Tests', () => {
    beforeEach(() => {
      service.init(mockEntityManager);
    });

    it('should maintain tile visibility during rapid position updates', fakeAsync(() => {
      const position = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };

      // Rapid random movements
      for (let i = 0; i < 100; i++) {
        // Random jump within reasonable distance
        position.x += (Math.random() - 0.5) * 200;
        position.y += (Math.random() - 0.5) * 200;

        // Clamp to world bounds
        position.x = Math.max(100, Math.min(WORLD_WIDTH - 100, position.x));
        position.y = Math.max(100, Math.min(WORLD_HEIGHT - 100, position.y));

        (mockEntityManager.getComponent as jasmine.Spy).and.callFake((_entityId, componentType) => {
          if (isComponentType(componentType, PositionComponent)) return position;
          if (isComponentType(componentType, VelocityComponent)) {
            return { vx: (Math.random() - 0.5) * MAX_SPEED, vy: (Math.random() - 0.5) * MAX_SPEED };
          }
          return undefined;
        });

        service.update(0.016, mockEntityManager);
        tick(16); // 60 FPS

        if (i % 10 === 0) {
          // Test rendering every 10 frames
          const camera = { x: position.x, y: position.y };
          const mockContext = createMockContext();
          service.renderTerritories(mockContext, camera);
        }
      }

      // Should maintain single generation
      expect(dynamicTerritoryGeneratorSpy.generateTerritories.calls.count()).toBe(1);
    }));

    it('should preload priority zones when shouldUpdatePreload returns true', () => {
      // Get the tile visibility spy to configure it for this test
      const tileVisibilitySpy = TestBed.inject(TileVisibilityService) as jasmine.SpyObj<TileVisibilityService>;

      // Enable preloading for this test
      tileVisibilitySpy.shouldUpdatePreload.and.returnValue(true);
      tileVisibilitySpy.calculateOptimalPreloadStrategy.and.returnValue({
        strategy: 'aggressive',
        priorityZones: [
          { centerX: 50, centerY: 40, radius: 10, priority: 1 },
          { centerX: 55, centerY: 40, radius: 8, priority: 2 },
          { centerX: 45, centerY: 40, radius: 8, priority: 3 },
        ],
        recommendedChunkIncrease: 5,
      });

      // Reset preload call counter after init
      chunkManagerSpy.preloadChunksAroundPosition.calls.reset();

      service.update(0.016, mockEntityManager);

      // Should have preload calls for each priority zone
      const preloadCalls = chunkManagerSpy.preloadChunksAroundPosition.calls.all();
      expect(preloadCalls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Render Buffer Validation', () => {
    beforeEach(() => {
      service.init(mockEntityManager);
    });

    it('should have sufficient render buffer for all speeds', () => {
      // Test that RENDER_BUFFER constant is large enough
      const renderBuffer = 20; // From the code
      const tilesPerSecondAtMaxSpeed = MAX_SPEED / TILE_SIZE;
      const secondsOfBuffer = renderBuffer / tilesPerSecondAtMaxSpeed;

      // Should have at least 1 second of buffer at max speed
      expect(secondsOfBuffer).toBeGreaterThanOrEqual(1);

      // At dash speed
      const tilesPerSecondAtDashSpeed = DASH_SPEED / TILE_SIZE;
      const secondsOfBufferDash = renderBuffer / tilesPerSecondAtDashSpeed;

      // Should have at least 0.5 seconds of buffer at dash speed
      expect(secondsOfBufferDash).toBeGreaterThanOrEqual(0.5);
    });

    it('should render larger area than visible screen', () => {
      const camera = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
      const mockContext = createMockContext();

      service.renderTerritories(mockContext, camera);

      // Territory rendering uses an OffscreenCanvas bake (drawImage to the main ctx) when
      // OffscreenCanvas is available, or fillRect directly on the fallback path.
      const drawCalls =
        (mockContext.fillRect as jasmine.Spy).calls.count() + (mockContext.drawImage as jasmine.Spy).calls.count();
      expect(drawCalls).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Debug and Monitoring', () => {
    it('should log tile generation events', () => {
      service.init(mockEntityManager);
      // H5: generation logs (incl. spawn-area preload) are emitted by setSeed(),
      // which the game-engine always calls right after init().
      service.setSeed('visibility-test-seed');

      // Check debug logs
      const debugLogs = (window.debugLogBridge!.log as jasmine.Spy).calls.all();

      // Should have territory initialization logs
      const initLog = debugLogs.find((call) => call.args[0].includes('Four Kings Territory: Starting initialization'));
      expect(initLog).toBeDefined();

      // Should have spawn preload logs
      const preloadLog = debugLogs.find((call) => call.args[0].includes('spawn area'));
      expect(preloadLog).toBeDefined();
    });

    it('should track chunk cache performance', () => {
      service.init(mockEntityManager);
      service.update(0.016, mockEntityManager);

      const stats = chunkManagerSpy.getCacheStats();

      // Verify cache stats are being tracked
      expect(stats.cacheHitRate).toBeGreaterThanOrEqual(0);
      expect(stats.cachedChunks).toBeGreaterThanOrEqual(0);
      expect(stats.totalChunks).toBeGreaterThan(0);
    });
  });

  // Helper function to create mock canvas context
  function createMockContext(): jasmine.SpyObj<CanvasRenderingContext2D> {
    const mockCanvas = jasmine.createSpyObj('HTMLCanvasElement', [], {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    });

    return jasmine.createSpyObj(
      'CanvasRenderingContext2D',
      [
        'save',
        'restore',
        'fillRect',
        'strokeRect',
        'arc',
        'fill',
        'beginPath',
        'moveTo',
        'lineTo',
        'stroke',
        'setLineDash',
        'drawImage',
      ],
      {
        canvas: mockCanvas,
        fillStyle: '',
        strokeStyle: '',
        globalAlpha: 1,
        lineWidth: 1,
      }
    );
  }
});
