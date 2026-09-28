import { TestBed } from '@angular/core/testing';
import { TerritoryGridService } from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { TerritoryCoordinateUtils } from '../../models/territory-tile.model';

describe('TerritoryGridService', () => {
  let service: TerritoryGridService;
  let debugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    const debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [TerritoryGridService, { provide: DebugLogBridgeService, useValue: debugSpy }],
    });

    service = TestBed.inject(TerritoryGridService);
    debugLog = TestBed.inject(DebugLogBridgeService) as jasmine.SpyObj<DebugLogBridgeService>;
  });

  describe('Grid Initialization', () => {
    it('should initialize empty grid with correct dimensions', () => {
      service.initializeGrid();

      expect(service.isInitialized()).toBeTruthy();

      const dimensions = service.getGridDimensions();
      expect(dimensions.width).toBe(200);
      expect(dimensions.height).toBe(150);
    });

    it('should create 30,000 neutral tiles', () => {
      service.initializeGrid();

      const stats = service.getGridStatistics();
      expect(stats.totalTiles).toBe(30000);
      expect(stats.neutralTiles).toBe(30000);
      expect(stats.factionTiles.size).toBe(0);
    });

    it('should log initialization', () => {
      service.initializeGrid();

      expect(debugLog.log).toHaveBeenCalledWith(
        'Territory Grid Initialized',
        'info',
        jasmine.objectContaining({
          gridWidth: 200,
          gridHeight: 150,
          totalTiles: 30000,
        })
      );
    });
  });

  describe('Tile Access', () => {
    beforeEach(() => {
      service.initializeGrid();
    });

    it('should get tile at valid grid coordinates', () => {
      const tile = service.getTile(50, 50);

      expect(tile).toBeTruthy();
      expect(tile!.gridX).toBe(50);
      expect(tile!.gridY).toBe(50);
      expect(tile!.factionId).toBe(0); // Neutral
    });

    it('should return null for invalid coordinates', () => {
      expect(service.getTile(-1, 50)).toBeNull();
      expect(service.getTile(50, -1)).toBeNull();
      expect(service.getTile(200, 50)).toBeNull();
      expect(service.getTile(50, 150)).toBeNull();
    });

    it('should get tile at world coordinates', () => {
      // World position 3000, 3000 should be grid 50, 50
      const tile = service.getTileAtWorld(3000, 3000);

      expect(tile).toBeTruthy();
      expect(tile!.gridX).toBe(50);
      expect(tile!.gridY).toBe(50);
    });
  });

  describe('Tile Ownership', () => {
    beforeEach(() => {
      service.initializeGrid();
    });

    it('should set faction ownership', () => {
      const success = service.setTileOwnership(10, 10, 1, 0.8);

      expect(success).toBeTruthy();

      const tile = service.getTile(10, 10);
      expect(tile!.factionId).toBe(1);
      expect(tile!.ownershipStrength).toBe(0.8);
      expect(tile!.isTransitioning).toBeTruthy();
    });

    it('should mark tile as base', () => {
      service.setTileOwnership(20, 20, 2, 1.0, true);

      const tile = service.getTile(20, 20);
      expect(tile!.isBase).toBeTruthy();
      expect(tile!.buffMultiplier).toBe(2.0); // Base buff multiplier
    });

    it('should track dirty tiles', () => {
      service.setTileOwnership(5, 5, 1);
      service.setTileOwnership(6, 5, 1);

      const dirtyTiles = service.getDirtyTiles();
      expect(dirtyTiles.length).toBe(2);

      // Should clear after getting
      expect(service.getDirtyTiles().length).toBe(0);
    });

    it('should update faction statistics', () => {
      // Set up some territory
      for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 10; y++) {
          service.setTileOwnership(x, y, 1, 1.0, x < 5 && y < 5);
        }
      }

      const stats = service.getFactionStats(1);
      expect(stats!.totalTiles).toBe(100);
      expect(stats!.baseTiles).toBe(25); // 5x5 base area
    });
  });

  describe('Contested Borders', () => {
    beforeEach(() => {
      service.initializeGrid();
    });

    it('should identify contested borders between factions', () => {
      // Create two adjacent faction territories
      service.setTileOwnership(10, 10, 1);
      service.setTileOwnership(11, 10, 2);

      const contested = service.findContestedBorders();

      expect(contested.length).toBeGreaterThan(0);

      const tile1 = service.getTile(10, 10);
      const tile2 = service.getTile(11, 10);
      expect(tile1!.isContested).toBeTruthy();
      expect(tile2!.isContested).toBeTruthy();
    });

    it('should apply contested buff multiplier', () => {
      service.setTileOwnership(10, 10, 1);
      service.setTileOwnership(11, 10, 2);
      service.findContestedBorders();

      const tile = service.getTile(10, 10);
      expect(tile!.buffMultiplier).toBe(0.5); // Contested multiplier
    });
  });

  describe('Faction Queries', () => {
    beforeEach(() => {
      service.initializeGrid();

      // Set up territories for each faction
      for (let f = 1; f <= 4; f++) {
        for (let i = 0; i < 10; i++) {
          service.setTileOwnership(f * 10, i, f);
        }
      }
    });

    it('should get all tiles owned by a faction', () => {
      const faction1Tiles = service.getFactionTiles(1);
      expect(faction1Tiles.length).toBe(10);
      expect(faction1Tiles.every((t) => t.factionId === 1)).toBeTruthy();
    });

    it('should get faction statistics', () => {
      const allStats = service.getAllFactionStats();

      expect(allStats.length).toBe(4);
      expect(allStats.every((s) => s.totalTiles === 10)).toBeTruthy();
    });
  });

  describe('Radius Queries', () => {
    beforeEach(() => {
      service.initializeGrid();
    });

    it('should get tiles in radius around world point', () => {
      // Get tiles around center of world (6000, 4500)
      const tiles = service.getTilesInRadius(6000, 4500, 120); // 2 tile radius

      // Should get roughly a circle of tiles
      expect(tiles.length).toBeGreaterThan(4); // At least cross pattern
      expect(tiles.length).toBeLessThan(25); // But not full 5x5 square
    });

    it('should handle edge cases at world boundaries', () => {
      const tilesAtOrigin = service.getTilesInRadius(0, 0, 60);
      const tilesAtMax = service.getTilesInRadius(12000, 9000, 60);

      expect(tilesAtOrigin.length).toBeGreaterThan(0);
      expect(tilesAtMax.length).toBeGreaterThan(0);
    });
  });

  describe('Coordinate Utilities', () => {
    it('should convert world to grid coordinates', () => {
      const grid = TerritoryCoordinateUtils.worldToGrid(3000, 3000);
      expect(grid.gridX).toBe(50);
      expect(grid.gridY).toBe(50);
    });

    it('should convert grid to world coordinates', () => {
      const world = TerritoryCoordinateUtils.gridToWorld(50, 50);
      expect(world.x).toBe(3030); // Center of tile
      expect(world.y).toBe(3030);
    });

    it('should get tile bounds', () => {
      const bounds = TerritoryCoordinateUtils.getTileBounds(10, 10);
      expect(bounds.minX).toBe(600);
      expect(bounds.minY).toBe(600);
      expect(bounds.maxX).toBe(660);
      expect(bounds.maxY).toBe(660);
    });

    it('should validate grid coordinates', () => {
      expect(TerritoryCoordinateUtils.isValidGridCoordinate(0, 0)).toBeTruthy();
      expect(TerritoryCoordinateUtils.isValidGridCoordinate(199, 149)).toBeTruthy();
      expect(TerritoryCoordinateUtils.isValidGridCoordinate(-1, 0)).toBeFalsy();
      expect(TerritoryCoordinateUtils.isValidGridCoordinate(200, 150)).toBeFalsy();
    });

    it('should get neighbors', () => {
      const neighbors = TerritoryCoordinateUtils.getNeighbors(50, 50);
      expect(neighbors.length).toBe(4); // N, E, S, W

      const cornerNeighbors = TerritoryCoordinateUtils.getNeighbors(0, 0);
      expect(cornerNeighbors.length).toBe(2); // Only E, S
    });

    it('should get all neighbors including diagonals', () => {
      const allNeighbors = TerritoryCoordinateUtils.getAllNeighbors(50, 50);
      expect(allNeighbors.length).toBe(8);

      const cornerNeighbors = TerritoryCoordinateUtils.getAllNeighbors(0, 0);
      expect(cornerNeighbors.length).toBe(3); // E, S, SE
    });

    it('should calculate distances', () => {
      const manhattan = TerritoryCoordinateUtils.manhattanDistance(0, 0, 3, 4);
      expect(manhattan).toBe(7);

      const euclidean = TerritoryCoordinateUtils.euclideanDistance(0, 0, 3, 4);
      expect(euclidean).toBe(5);
    });
  });

  describe('Transition Updates', () => {
    beforeEach(() => {
      service.initializeGrid();
    });

    it('should update transition progress', () => {
      service.setTileOwnership(10, 10, 1);
      const tile = service.getTile(10, 10);

      expect(tile!.isTransitioning).toBeTruthy();
      expect(tile!.transitionProgress).toBe(0);

      // Update with 1 second delta
      service.updateTransitions(1000);

      expect(tile!.transitionProgress).toBe(0.5); // 1000ms / 2000ms duration

      // Complete transition
      service.updateTransitions(1000);

      expect(tile!.isTransitioning).toBeFalsy();
      expect(tile!.transitionProgress).toBe(1);
    });
  });

  describe('Grid Reset', () => {
    it('should clear grid and reset to neutral', () => {
      service.initializeGrid();

      // Set some ownership
      service.setTileOwnership(10, 10, 1);
      service.setTileOwnership(20, 20, 2);

      // Clear grid
      service.clearGrid();

      const stats = service.getGridStatistics();
      expect(stats.neutralTiles).toBe(30000);
      expect(stats.factionTiles.size).toBe(0);
    });
  });

  describe('Faction Tile Caching (Phase 2 Optimization)', () => {
    beforeEach(() => {
      service.initializeGrid();
    });

    it('should cache faction tiles to avoid O(30,000) scans', () => {
      // Set up some faction ownership
      for (let i = 0; i < 10; i++) {
        service.setTileOwnership(i, 0, 1); // Faction 1
        service.setTileOwnership(i, 1, 2); // Faction 2
      }

      // First call should build cache
      const faction1Tiles = service.getFactionTiles(1);
      expect(faction1Tiles.length).toBe(10);

      // Second call should use cache (no way to directly test, but should work)
      const faction1TilesAgain = service.getFactionTiles(1);
      expect(faction1TilesAgain.length).toBe(10);

      // Should be same tiles
      expect(faction1Tiles[0]).toBe(faction1TilesAgain[0]);
    });

    it('should invalidate cache on ownership change', () => {
      // Initial setup
      service.setTileOwnership(0, 0, 1);
      service.setTileOwnership(1, 0, 1);

      let faction1Tiles = service.getFactionTiles(1);
      expect(faction1Tiles.length).toBe(2);

      // Change ownership - should invalidate cache
      service.setTileOwnership(2, 0, 1);

      faction1Tiles = service.getFactionTiles(1);
      expect(faction1Tiles.length).toBe(3);
    });

    it('should return empty array for faction with no tiles', () => {
      const faction5Tiles = service.getFactionTiles(5);
      expect(faction5Tiles.length).toBe(0);
      expect(Array.isArray(faction5Tiles)).toBeTruthy();
    });

    it('should handle neutral tiles (faction 0)', () => {
      // All tiles start neutral
      const neutralTiles = service.getFactionTiles(0);
      expect(neutralTiles.length).toBe(30000);

      // Claim one tile
      service.setTileOwnership(0, 0, 1);

      const neutralTilesAfter = service.getFactionTiles(0);
      expect(neutralTilesAfter.length).toBe(29999);
    });

    it('should invalidate cache on grid clear', () => {
      // Set up faction tiles
      service.setTileOwnership(0, 0, 1);
      service.setTileOwnership(1, 0, 1);

      let faction1Tiles = service.getFactionTiles(1);
      expect(faction1Tiles.length).toBe(2);

      // Clear grid
      service.clearGrid();

      faction1Tiles = service.getFactionTiles(1);
      expect(faction1Tiles.length).toBe(0);
    });

    it('should handle multiple factions efficiently', () => {
      // Set up multiple factions
      for (let i = 0; i < 100; i++) {
        const factionId = (i % 4) + 1; // Factions 1-4
        service.setTileOwnership(i % 200, Math.floor(i / 200), factionId);
      }

      // Query all factions - each should be efficient
      const faction1 = service.getFactionTiles(1);
      const faction2 = service.getFactionTiles(2);
      const faction3 = service.getFactionTiles(3);
      const faction4 = service.getFactionTiles(4);

      expect(faction1.length).toBe(25);
      expect(faction2.length).toBe(25);
      expect(faction3.length).toBe(25);
      expect(faction4.length).toBe(25);
    });

    it('should rebuild cache only when invalid', () => {
      // Set up tiles
      service.setTileOwnership(0, 0, 1);

      // First call builds cache
      const tiles1 = service.getFactionTiles(1);

      // Second call without changes should return same cached array reference
      const tiles2 = service.getFactionTiles(1);

      // Same reference means cache was used
      expect(tiles1).toBe(tiles2);
    });
  });
});
