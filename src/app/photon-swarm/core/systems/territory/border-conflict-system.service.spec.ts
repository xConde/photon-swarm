import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import {
  BorderConflictSystemService,
  FourKingsTerritoryService,
  TerritoryStrengthSystemService,
  TileStrengthChange,
} from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
// Import the actual TerritoryTile interface
import { GeneratedWorld, TerritoryTile } from '../../models/territory.model';

// Test helper functions
const createMockTile = (x: number, y: number, kingId: number, strength: number, contested = false): TerritoryTile => ({
  x,
  y,
  kingId,
  strength,
  age: 0,
  contested,
});

/**
 * Creates a mock world with a 2D territories array.
 * The service expects worldData.territories[y][x] to access tiles.
 * @param gridWidth Width of the grid
 * @param gridHeight Height of the grid
 * @param tiles Array of tiles to place in the 2D grid
 */
const createMockWorldWithBorders = (
  gridWidth: number = 10,
  gridHeight: number = 10,
  tiles: TerritoryTile[] = []
): GeneratedWorld => {
  // Create a 2D array initialized with nulls
  const territories: (TerritoryTile | null)[][] = [];
  for (let y = 0; y < gridHeight; y++) {
    territories[y] = [];
    for (let x = 0; x < gridWidth; x++) {
      territories[y][x] = null;
    }
  }

  // Place provided tiles into the 2D grid
  for (const tile of tiles) {
    if (tile.y >= 0 && tile.y < gridHeight && tile.x >= 0 && tile.x < gridWidth) {
      territories[tile.y][tile.x] = tile;
    }
  }

  return {
    seed: 'test-seed',
    hash: 'test-hash',
    territories,
    kingStartPositions: [],
    kingConfigs: [],
    generationMetadata: {
      timestamp: Date.now(),
      version: '1.0',
      gridSize: { width: gridWidth, height: gridHeight },
      totalTiles: tiles.length,
      generationTime: 100,
    },
  };
};

describe('BorderConflictSystemService', () => {
  let service: BorderConflictSystemService;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockTerritoryStrength: jasmine.SpyObj<TerritoryStrengthSystemService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let strengthChangesSubject: BehaviorSubject<TileStrengthChange[]>;

  beforeEach(() => {
    // Create mock services
    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getIsInitialized',
      'getWorldData',
      'worldToGrid',
      'getTile',
    ]);

    strengthChangesSubject = new BehaviorSubject<TileStrengthChange[]>([]);
    mockTerritoryStrength = jasmine.createSpyObj(
      'TerritoryStrengthSystemService',
      ['getIsInitialized', 'getTileStrength', 'getTileNeighbors'],
      {
        strengthChanges$: strengthChangesSubject.asObservable(),
      }
    );

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Setup default mock behaviors
    mockFourKingsTerritory.getIsInitialized.and.returnValue(true);
    mockTerritoryStrength.getIsInitialized.and.returnValue(true);

    // Create mock world with empty borders (default)
    mockFourKingsTerritory.getWorldData.and.returnValue(createMockWorldWithBorders(10, 10, []));

    TestBed.configureTestingModule({
      providers: [
        BorderConflictSystemService,
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: TerritoryStrengthSystemService, useValue: mockTerritoryStrength },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    jasmine.clock().install();
    service = TestBed.inject(BorderConflictSystemService);
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    jasmine.clock().uninstall();
  });

  describe('Initialization', () => {
    it('should wait for required services to initialize', () => {
      mockFourKingsTerritory.getIsInitialized.and.returnValue(false);
      mockTerritoryStrength.getIsInitialized.and.returnValue(false);

      const newService = TestBed.inject(BorderConflictSystemService);

      jasmine.clock().tick(50);

      // Now initialize dependencies
      mockFourKingsTerritory.getIsInitialized.and.returnValue(true);
      mockTerritoryStrength.getIsInitialized.and.returnValue(true);

      jasmine.clock().tick(100);

      expect(mockDebugLog.log).toHaveBeenCalledWith('Border Conflict System Initialized', 'info', jasmine.any(Object));

      newService.destroy();
    });

    it('should detect border tiles on initialization', () => {
      jasmine.clock().tick(150);

      // Should have logged border detection
      expect(mockDebugLog.log).toHaveBeenCalledWith(
        'Border tiles detected',
        'info',
        jasmine.objectContaining({
          totalBorderTiles: jasmine.any(Number),
        })
      );
    });
  });

  describe('Border Detection', () => {
    beforeEach(() => {
      jasmine.clock().tick(150); // Wait for initialization
    });

    it('should identify tiles adjacent to different factions', () => {
      // Setup mock for a border scenario
      mockFourKingsTerritory.getTile.and.callFake((x, y) => {
        if (x === 4 && y === 5) return createMockTile(x, y, 1, 75);
        if (x === 5 && y === 5) return createMockTile(x, y, 2, 75);
        return null;
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(75);
      mockTerritoryStrength.getTileNeighbors.and.callFake((x, y) => {
        if (x === 4 && y === 5) {
          return {
            east: { gridX: 5, gridY: 5, strength: 75 },
          };
        }
        return {};
      });

      // Force detection
      service.reset();

      // Check if border was detected
      const zone = service.getConflictZone(200, 250); // World coords for grid 4,5
      expect(zone).toBeDefined();
    });

    it('should not mark tiles surrounded by same faction as borders', () => {
      // Setup mock for non-border tile (surrounded by same faction)
      mockFourKingsTerritory.getTile.and.returnValue(createMockTile(5, 5, 1, 75));
      mockTerritoryStrength.getTileStrength.and.returnValue(75);
      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 75 },
        south: { gridX: 5, gridY: 6, strength: 75 },
        east: { gridX: 6, gridY: 5, strength: 75 },
        west: { gridX: 4, gridY: 5, strength: 75 },
      });

      service.reset();

      // This tile should not be a conflict zone
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 5, gridY: 5 });
      const zone = service.getConflictZone(250, 250);
      expect(zone).toBeNull();
    });
  });

  describe('Conflict Intensity', () => {
    // Helper to set up the 2D territories grid for intensity tests
    function setupIntensityScenario(): void {
      // Create adjacent tiles with different factions in 2D grid
      const tile1 = createMockTile(4, 5, 1, 80, true);
      const tile2 = createMockTile(5, 5, 2, 40, true);

      mockFourKingsTerritory.getWorldData.and.returnValue(createMockWorldWithBorders(10, 10, [tile1, tile2]));

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) return createMockTile(x, y, 1, 80, true);
        if (x === 5 && y === 5) return createMockTile(x, y, 2, 40, true);
        return null;
      });

      mockFourKingsTerritory.worldToGrid.and.callFake((worldX: number, worldY: number) => {
        return { gridX: Math.floor(worldX / 50), gridY: Math.floor(worldY / 50) };
      });
    }

    beforeEach(() => {
      jasmine.clock().tick(150);
    });

    it('should calculate intensity based on strength difference', () => {
      setupIntensityScenario();

      mockTerritoryStrength.getTileStrength.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) return 80;
        if (x === 5 && y === 5) return 40;
        return 0;
      });

      mockTerritoryStrength.getTileNeighbors.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) {
          return { east: { gridX: 5, gridY: 5, strength: 40 } };
        }
        if (x === 5 && y === 5) {
          return { west: { gridX: 4, gridY: 5, strength: 80 } };
        }
        return {};
      });

      service.reset();
      jasmine.clock().tick(100);

      const zone = service.getConflictZone(200, 250);

      expect(zone).not.toBeNull();
      // Lower intensity due to strength difference (80 vs 40)
      expect(zone!.intensity).toBeLessThan(0.7);
    });

    it('should have high intensity when strengths are similar', () => {
      // Create tiles with same strength
      const tile1 = createMockTile(4, 5, 1, 75, true);
      const tile2 = createMockTile(5, 5, 2, 75, true);

      mockFourKingsTerritory.getWorldData.and.returnValue(createMockWorldWithBorders(10, 10, [tile1, tile2]));

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) return createMockTile(x, y, 1, 75, true);
        if (x === 5 && y === 5) return createMockTile(x, y, 2, 75, true);
        return null;
      });

      mockFourKingsTerritory.worldToGrid.and.callFake((worldX: number, worldY: number) => {
        return { gridX: Math.floor(worldX / 50), gridY: Math.floor(worldY / 50) };
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(75);

      mockTerritoryStrength.getTileNeighbors.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) {
          return { east: { gridX: 5, gridY: 5, strength: 75 } };
        }
        if (x === 5 && y === 5) {
          return { west: { gridX: 4, gridY: 5, strength: 75 } };
        }
        return {};
      });

      service.reset();
      jasmine.clock().tick(100);

      const zone = service.getConflictZone(200, 250);

      expect(zone).not.toBeNull();
      // High intensity due to similar strengths
      expect(zone!.intensity).toBeGreaterThan(0.7);
    });

    it('should decay intensity over time', () => {
      // Create tiles with same strength for high initial intensity
      const tile1 = createMockTile(4, 5, 1, 75, true);
      const tile2 = createMockTile(5, 5, 2, 75, true);

      mockFourKingsTerritory.getWorldData.and.returnValue(createMockWorldWithBorders(10, 10, [tile1, tile2]));

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) return createMockTile(x, y, 1, 75, true);
        if (x === 5 && y === 5) return createMockTile(x, y, 2, 75, true);
        return null;
      });

      mockFourKingsTerritory.worldToGrid.and.callFake((worldX: number, worldY: number) => {
        return { gridX: Math.floor(worldX / 50), gridY: Math.floor(worldY / 50) };
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(75);

      mockTerritoryStrength.getTileNeighbors.and.callFake((x: number, y: number) => {
        if (x === 4 && y === 5) {
          return { east: { gridX: 5, gridY: 5, strength: 75 } };
        }
        if (x === 5 && y === 5) {
          return { west: { gridX: 4, gridY: 5, strength: 75 } };
        }
        return {};
      });

      service.reset();
      jasmine.clock().tick(100);

      const initialZone = service.getConflictZone(200, 250);
      expect(initialZone).not.toBeNull();
      const initialIntensity = initialZone!.intensity;

      // Wait for decay (5.5 seconds triggers multiple update cycles)
      jasmine.clock().tick(5500);

      const decayedZone = service.getConflictZone(200, 250);
      expect(decayedZone).not.toBeNull();
      const decayedIntensity = decayedZone!.intensity;

      expect(decayedIntensity).toBeLessThan(initialIntensity);
    });
  });

  describe('Conflict Zone Management', () => {
    beforeEach(() => {
      jasmine.clock().tick(150);
      setupConflictScenario();
    });

    it('should track active conflict zones', () => {
      const activeZones = service.getActiveConflictZones();
      expect(activeZones.length).toBeGreaterThan(0);
    });

    it('should boost intensity when combat occurs', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 4, gridY: 5 });

      // Wait for update interval to trigger decay (5500ms is the update interval)
      // This reduces intensity from 1.0 to 0.95, giving room to boost
      jasmine.clock().tick(5500);

      const initialZone = service.getConflictZone(200, 250);
      expect(initialZone).not.toBeNull();
      const initialIntensity = initialZone!.intensity;
      expect(initialIntensity).toBeLessThan(1); // Verify decay happened

      // Boost intensity at grid position (4, 5)
      service.boostConflictIntensity(4, 5, 0.2);

      const boostedZone = service.getConflictZone(200, 250);
      expect(boostedZone).not.toBeNull();
      const boostedIntensity = boostedZone!.intensity;

      expect(boostedIntensity).toBeGreaterThan(initialIntensity);
    });

    it('should identify if position is in conflict zone', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 4, gridY: 5 });

      const isInConflict = service.isInConflictZone(200, 250);
      expect(isInConflict).toBe(true);

      // Check non-conflict position
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 0, gridY: 0 });
      const isNotInConflict = service.isInConflictZone(0, 0);
      expect(isNotInConflict).toBe(false);
    });

    it('should get factions involved in conflict', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 4, gridY: 5 });

      const factions = service.getConflictingFactions(200, 250);
      expect(factions.length).toBe(2);
      expect(factions).toContain(1);
      expect(factions).toContain(2);
    });
  });

  describe('Spawn System Integration', () => {
    beforeEach(() => {
      jasmine.clock().tick(150);
      setupConflictScenario();
    });

    it('should provide spawn multiplier for conflict zones', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 4, gridY: 5 });

      const multiplier = service.getSpawnMultiplier(200, 250);
      expect(multiplier).toBeGreaterThan(1.0);
      expect(multiplier).toBeLessThanOrEqual(3.0);
    });

    it('should return 1.0 multiplier for non-conflict zones', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 0, gridY: 0 });

      const multiplier = service.getSpawnMultiplier(0, 0);
      expect(multiplier).toBe(1.0);
    });

    it('should determine mixed faction spawning', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 4, gridY: 5 });

      // Set high intensity for mixed spawning
      service.boostConflictIntensity(4, 5, 0.5);

      const shouldMix = service.shouldSpawnMixedFactions(200, 250);
      expect(shouldMix).toBe(true);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      jasmine.clock().tick(150);
      setupConflictScenario();
    });

    it('should provide conflict statistics', () => {
      const stats = service.getConflictStats();

      expect(stats.totalConflictZones).toBeDefined();
      expect(stats.activeConflicts).toBeDefined();
      expect(stats.conflictsByIntensity).toBeDefined();
      expect(stats.conflictsByIntensity.low).toBeDefined();
      expect(stats.conflictsByIntensity.medium).toBeDefined();
      expect(stats.conflictsByIntensity.high).toBeDefined();
    });

    it('should identify hottest conflict zone', () => {
      // Boost one zone to make it hottest
      service.boostConflictIntensity(4, 5, 0.8);

      const hottestZone = service.getHottestZone();
      expect(hottestZone).toBeDefined();
      expect(hottestZone?.intensity).toBeGreaterThan(0.5);
    });

    it('should get conflicts for specific faction', () => {
      const faction1Conflicts = service.getFactionsConflictZones(1);
      expect(faction1Conflicts.length).toBeGreaterThan(0);

      faction1Conflicts.forEach((zone) => {
        expect(zone.faction1 === 1 || zone.faction2 === 1).toBe(true);
      });
    });
  });

  describe('Observable Updates', () => {
    it('should emit conflict zone updates', () => {
      jasmine.clock().tick(150);

      let receivedZones: {
        gridX: number;
        gridY: number;
        faction1: number;
        faction2: number;
        intensity: number;
        isActive: boolean;
      }[] = [];
      service.conflictZones$.subscribe((zones) => {
        receivedZones = zones;
      });

      setupConflictScenario();
      service.reset();
      jasmine.clock().tick(100);

      // Verify received zones have expected shape
      expect(receivedZones.length).toBeGreaterThan(0);
      expect(receivedZones[0]).toEqual(
        jasmine.objectContaining({
          gridX: jasmine.any(Number),
          gridY: jasmine.any(Number),
          faction1: jasmine.any(Number),
          faction2: jasmine.any(Number),
          intensity: jasmine.any(Number),
          isActive: jasmine.any(Boolean),
        })
      );
    });

    it('should update on territory strength changes', () => {
      jasmine.clock().tick(150);
      setupConflictScenario();

      // Trigger strength change
      strengthChangesSubject.next([
        {
          gridX: 4,
          gridY: 5,
          oldStrength: 75,
          newStrength: 50,
          reason: 'test',
          timestamp: Date.now(),
        },
      ]);

      // Wait for debounced update
      jasmine.clock().tick(1100);

      // Should have processed the update
      expect(mockTerritoryStrength.getTileStrength).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      jasmine.clock().tick(150);
      setupConflictScenario();

      service.destroy();

      const zones = service.getActiveConflictZones();
      expect(zones.length).toBe(0);
    });

    it('should reset conflict zones', () => {
      jasmine.clock().tick(150);
      setupConflictScenario();

      const initialZones = service.getActiveConflictZones();
      expect(initialZones.length).toBeGreaterThan(0);

      service.reset();
      jasmine.clock().tick(100);

      // Should re-detect zones
      expect(mockFourKingsTerritory.getWorldData).toHaveBeenCalled();
    });
  });

  // Helper function to setup conflict scenario
  function setupConflictScenario(): void {
    // Create border tiles at positions (4,5) and (5,5) with different factions
    // The service detects borders by iterating worldData.territories[y][x]
    // and checking if any neighbor belongs to a different faction
    const borderTile1 = createMockTile(4, 5, 1, 75, true); // Faction 1 at (4,5)
    const borderTile2 = createMockTile(5, 5, 2, 75, true); // Faction 2 at (5,5) - adjacent to faction 1

    // Update world data with actual border tiles in 2D grid
    mockFourKingsTerritory.getWorldData.and.returnValue(createMockWorldWithBorders(10, 10, [borderTile1, borderTile2]));

    mockFourKingsTerritory.getTile.and.callFake((x: number, y: number) => {
      if (x === 4 && y === 5) return createMockTile(x, y, 1, 75, true);
      if (x === 5 && y === 5) return createMockTile(x, y, 2, 75, true);
      return null;
    });

    mockTerritoryStrength.getTileStrength.and.returnValue(75);
    mockTerritoryStrength.getTileNeighbors.and.callFake((x: number, y: number) => {
      if (x === 4 && y === 5) {
        return {
          east: { gridX: 5, gridY: 5, strength: 75 },
        };
      }
      if (x === 5 && y === 5) {
        return {
          west: { gridX: 4, gridY: 5, strength: 75 },
        };
      }
      return {};
    });

    mockFourKingsTerritory.worldToGrid.and.callFake((worldX: number, worldY: number) => {
      return { gridX: Math.floor(worldX / 50), gridY: Math.floor(worldY / 50) };
    });

    service.reset();
    jasmine.clock().tick(100);
  }
});

// Test helpers are imported from shared file
