import { TestBed } from '@angular/core/testing';
import { TerritoryExpansionSystemService } from './territory-expansion-system.service';
import { FourKingsTerritoryService, TerritoryStrengthSystemService } from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { GeneratedWorld, TerritoryTile as RealTerritoryTile } from '../../models/territory.model';

// Test helper functions - MockTile is a simplified test interface
interface MockTile {
  gridX: number;
  gridY: number;
  kingId: number; // Changed from factionId to match TerritoryTile interface
  ownershipStrength: number;
  isContested: boolean;
  isBase: boolean;
  isTransitioning: boolean;
  previousFactionId: number;
  transitionProgress: number;
  buffMultiplier: number;
  lastUpdate: number;
  age?: number;
  contested?: boolean;
}

const createMockTile = (
  gridX: number,
  gridY: number,
  kingId: number, // Changed param name to match interface
  ownershipStrength: number,
  isContested: boolean = false
): MockTile => ({
  gridX,
  gridY,
  kingId, // Changed from factionId
  ownershipStrength,
  isContested,
  isBase: false,
  isTransitioning: false,
  previousFactionId: 0,
  transitionProgress: 0,
  buffMultiplier: 1.0,
  lastUpdate: Date.now(),
});

// Create mock world data with 2D territories array
const createMockWorldData = (tiles: MockTile[] = []): { tiles: MockTile[]; territories: (MockTile | null)[][] } => {
  // Create a sparse 2D array for territories (10x10 for tests)
  const territories: (MockTile | null)[][] = Array.from({ length: 10 }, () => Array(10).fill(null));

  // Populate territories from tiles array
  for (const tile of tiles) {
    if (tile.gridY < 10 && tile.gridX < 10) {
      territories[tile.gridY][tile.gridX] = tile;
    }
  }

  return { tiles, territories };
};

describe('TerritoryExpansionSystemService', () => {
  let service: TerritoryExpansionSystemService;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockTerritoryStrength: jasmine.SpyObj<TerritoryStrengthSystemService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    // Create mock services
    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getIsInitialized',
      'getWorldData',
      'getTile',
      'markTileForUpdate',
    ]);

    mockTerritoryStrength = jasmine.createSpyObj('TerritoryStrengthSystemService', [
      'getIsInitialized',
      'getWeakTiles',
      'getTileStrength',
      'getTileNeighbors',
      'setTileStrength',
    ]);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Setup default mock behaviors
    mockFourKingsTerritory.getIsInitialized.and.returnValue(true);
    mockTerritoryStrength.getIsInitialized.and.returnValue(true);
    mockTerritoryStrength.getWeakTiles.and.returnValue([]); // Required for initialization

    // Create mock world data - use unknown cast since mock structure differs from real GeneratedWorld
    const mockWorldData = createMockWorldData([]);
    mockFourKingsTerritory.getWorldData.and.returnValue(mockWorldData as unknown as GeneratedWorld);

    TestBed.configureTestingModule({
      providers: [
        TerritoryExpansionSystemService,
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: TerritoryStrengthSystemService, useValue: mockTerritoryStrength },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    // Clear any existing intervals - uninstall first in case previous test left clock installed
    try {
      jasmine.clock().uninstall();
    } catch {
      // Clock wasn't installed, which is fine
    }
    jasmine.clock().install();
    // Mock Date so jasmine.clock().tick() affects Date.now()
    jasmine.clock().mockDate(new Date(1000000));

    service = TestBed.inject(TerritoryExpansionSystemService);
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    jasmine.clock().uninstall();
  });

  describe('Initialization', () => {
    it('should wait for required services to initialize', () => {
      // Create a new service with uninitialized dependencies
      mockFourKingsTerritory.getIsInitialized.and.returnValue(false);
      mockTerritoryStrength.getIsInitialized.and.returnValue(false);

      const newService = TestBed.inject(TerritoryExpansionSystemService);

      // Should not be initialized immediately
      jasmine.clock().tick(50);

      // Now initialize dependencies
      mockFourKingsTerritory.getIsInitialized.and.returnValue(true);
      mockTerritoryStrength.getIsInitialized.and.returnValue(true);

      // Wait for retry
      jasmine.clock().tick(100);

      // Should log initialization
      expect(mockDebugLog.log).toHaveBeenCalledWith(
        'Territory Expansion System Initialized',
        'info',
        jasmine.any(Object)
      );

      newService.destroy();
    });

    it('should start expansion checks after initialization', () => {
      jasmine.clock().tick(150); // Wait for initialization

      // Mock weak tiles
      mockTerritoryStrength.getWeakTiles.and.returnValue([]);

      // Should perform immediate check
      expect(mockTerritoryStrength.getWeakTiles).toHaveBeenCalled();
    });
  });

  describe('Expansion Detection', () => {
    beforeEach(() => {
      jasmine.clock().tick(150); // Wait for initialization
    });

    it('should identify weak tiles as expansion candidates', () => {
      // Setup weak tiles
      const weakTiles = [
        { gridX: 5, gridY: 5, strength: 25 },
        { gridX: 6, gridY: 6, strength: 20 },
      ];
      mockTerritoryStrength.getWeakTiles.and.returnValue(weakTiles);

      // Setup tile ownership - use unknown cast since mock structure differs from RealTerritoryTile
      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return createMockTile(x, y, 1, 25) as unknown as RealTerritoryTile;
        if (x === 6 && y === 6) return createMockTile(x, y, 2, 20) as unknown as RealTerritoryTile;
        return null;
      });

      // Setup strong neighbors
      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(70);

      // Force expansion check
      service.forceExpansionCheck();

      expect(mockTerritoryStrength.getWeakTiles).toHaveBeenCalled();
    });

    it('should only allow strong tiles to expand', () => {
      // Setup a weak tile with neighbors of varying strength
      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      // Use unknown cast since mock structure differs from RealTerritoryTile
      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return createMockTile(x, y, 1, 25) as unknown as RealTerritoryTile;
        if (x === 5 && y === 4) return createMockTile(x, y, 2, 70) as unknown as RealTerritoryTile; // Strong
        if (x === 5 && y === 6) return createMockTile(x, y, 3, 50) as unknown as RealTerritoryTile; // Not strong enough
        return null;
      });

      // Setup neighbors
      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 }, // Strong enough
        south: { gridX: 5, gridY: 6, strength: 50 }, // Too weak
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.callFake((x, y) => {
        if (x === 5 && y === 4) return 70;
        if (x === 5 && y === 6) return 50;
        return 0;
      });

      service.forceExpansionCheck();

      // Should only consider the strong neighbor for expansion
      expect(mockTerritoryStrength.getTileStrength).toHaveBeenCalledWith(5, 4);
    });

    it('should not expand into tiles of the same faction', () => {
      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      // All tiles belong to the same faction - use unknown cast since mock differs
      mockFourKingsTerritory.getTile.and.returnValue(createMockTile(5, 5, 1, 25) as unknown as RealTerritoryTile);

      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 80 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(80);

      service.forceExpansionCheck();

      // Should not perform any expansions
      expect(mockTerritoryStrength.setTileStrength).not.toHaveBeenCalled();
    });
  });

  describe('Expansion Execution', () => {
    let testTile55: MockTile;

    beforeEach(() => {
      jasmine.clock().tick(150); // Wait for initialization

      // Create test tile that can be modified
      testTile55 = createMockTile(5, 5, 1, 25);

      // Setup world data for expansion with actual tile in territories
      const worldData = createMockWorldData([testTile55]);
      mockFourKingsTerritory.getWorldData.and.returnValue(worldData as unknown as GeneratedWorld);
    });

    it('should change tile ownership during expansion', () => {
      // Setup expansion scenario
      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return testTile55 as unknown as RealTerritoryTile;
        if (x === 5 && y === 4) return createMockTile(x, y, 2, 70) as unknown as RealTerritoryTile;
        return null;
      });

      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(70);

      service.forceExpansionCheck();

      // Tile should change ownership (if kingId is used by the system)
      expect(mockFourKingsTerritory.markTileForUpdate).toHaveBeenCalledWith(5, 5);
    });

    it('should update strength system when expanding', () => {
      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return testTile55 as unknown as RealTerritoryTile;
        if (x === 5 && y === 4) return createMockTile(x, y, 2, 70) as unknown as RealTerritoryTile;
        return null;
      });

      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(70);

      service.forceExpansionCheck();

      expect(mockTerritoryStrength.setTileStrength).toHaveBeenCalled();
      expect(mockFourKingsTerritory.markTileForUpdate).toHaveBeenCalledWith(5, 5);
    });

    it('should track expansion history', () => {
      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return testTile55 as unknown as RealTerritoryTile;
        if (x === 5 && y === 4) return createMockTile(x, y, 2, 70) as unknown as RealTerritoryTile;
        return null;
      });

      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(70);

      service.forceExpansionCheck();

      const stats = service.getExpansionStats();
      expect(stats.totalExpansions).toBe(1);
      expect(stats.recentExpansions.length).toBe(1);
      expect(stats.recentExpansions[0].fromKingId).toBe(1);
      expect(stats.recentExpansions[0].toKingId).toBe(2);
    });
  });

  describe('Periodic Checks', () => {
    beforeEach(() => {
      jasmine.clock().tick(150); // Wait for initialization
    });

    it('should perform expansion checks periodically', () => {
      mockTerritoryStrength.getWeakTiles.and.returnValue([]);

      // Initial check
      expect(mockTerritoryStrength.getWeakTiles).toHaveBeenCalledTimes(1);

      // Wait for next periodic check (10.3 seconds)
      jasmine.clock().tick(10300);

      expect(mockTerritoryStrength.getWeakTiles).toHaveBeenCalledTimes(2);

      // Wait for another check
      jasmine.clock().tick(10300);

      expect(mockTerritoryStrength.getWeakTiles).toHaveBeenCalledTimes(3);
    });

    it('should track last check time', () => {
      const statsBefore = service.getExpansionStats();
      const timeBefore = statsBefore.lastCheckTime;

      jasmine.clock().tick(10300);

      const statsAfter = service.getExpansionStats();
      expect(statsAfter.lastCheckTime).toBeGreaterThan(timeBefore);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      jasmine.clock().tick(150); // Wait for initialization
    });

    it('should provide expansion statistics', () => {
      const stats = service.getExpansionStats();

      expect(stats.totalExpansions).toBeDefined();
      expect(stats.recentExpansions).toBeDefined();
      expect(stats.lastCheckTime).toBeDefined();
      expect(stats.nextCheckTime).toBeDefined();

      expect(stats.nextCheckTime).toBeGreaterThan(stats.lastCheckTime);
    });

    it('should filter recent expansions by time window', () => {
      // Setup world data with test tile in territories array
      const tile55 = createMockTile(5, 5, 1, 25);
      const worldData = createMockWorldData([tile55]);
      mockFourKingsTerritory.getWorldData.and.returnValue(worldData as unknown as GeneratedWorld);

      // Mock some expansions
      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return tile55 as unknown as RealTerritoryTile;
        if (x === 5 && y === 4) return createMockTile(x, y, 2, 70) as unknown as RealTerritoryTile;
        return null;
      });

      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(70);

      // Perform expansion
      service.forceExpansionCheck();

      const stats = service.getExpansionStats();
      expect(stats.recentExpansions.length).toBe(1);

      // Advance time past the recent window (1 minute)
      jasmine.clock().tick(61000);

      const laterStats = service.getExpansionStats();
      expect(laterStats.recentExpansions.length).toBe(0);
      expect(laterStats.totalExpansions).toBe(1); // Total still counts it
    });
  });

  describe('Cleanup', () => {
    it('should stop expansion checks on destroy', () => {
      jasmine.clock().tick(150); // Initialize

      mockTerritoryStrength.getWeakTiles.and.returnValue([]);
      mockTerritoryStrength.getWeakTiles.calls.reset();

      service.destroy();

      // Wait for what would be next check
      jasmine.clock().tick(10300);

      // Should not have performed any checks after destroy
      expect(mockTerritoryStrength.getWeakTiles).not.toHaveBeenCalled();
    });

    it('should reset state on reset()', () => {
      // Add some expansion history
      jasmine.clock().tick(150);

      // Setup world data with test tile in territories array
      const tile55 = createMockTile(5, 5, 1, 25);
      const worldData = createMockWorldData([tile55]);
      mockFourKingsTerritory.getWorldData.and.returnValue(worldData as unknown as GeneratedWorld);

      mockTerritoryStrength.getWeakTiles.and.returnValue([{ gridX: 5, gridY: 5, strength: 25 }]);

      mockFourKingsTerritory.getTile.and.callFake((x: number, y: number): RealTerritoryTile | null => {
        if (x === 5 && y === 5) return tile55 as unknown as RealTerritoryTile;
        if (x === 5 && y === 4) return createMockTile(x, y, 2, 70) as unknown as RealTerritoryTile;
        return null;
      });

      mockTerritoryStrength.getTileNeighbors.and.returnValue({
        north: { gridX: 5, gridY: 4, strength: 70 },
        south: undefined,
        east: undefined,
        west: undefined,
      });

      mockTerritoryStrength.getTileStrength.and.returnValue(70);

      service.forceExpansionCheck();

      expect(service.getExpansionStats().totalExpansions).toBe(1);

      service.reset();

      expect(service.getExpansionStats().totalExpansions).toBe(0);
      // Note: reset() calls startExpansionChecks() which immediately sets lastCheckTime
      // So lastCheckTime will be the current mocked time, not 0
      expect(service.getExpansionStats().lastCheckTime).toBeGreaterThan(0);
    });
  });
});

// Test helpers are imported from shared file
