import { TestBed } from '@angular/core/testing';
import { FourKingsTerritoryService, TerritoryStrengthSystemService } from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { GeneratedWorld, TerritoryTile } from '../../models/territory.model';

/**
 * Create a 10x10 mock world with tiles owned by kingId=1
 * Base tiles are near position (2,2) (king start position)
 */
const createMockWorldData = (): GeneratedWorld => {
  const GRID_SIZE = 10;
  const territories: (TerritoryTile | null)[][] = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    const row: (TerritoryTile | null)[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      row.push({
        x,
        y,
        kingId: 1, // All tiles belong to king 1
        strength: 75, // Default strength
        age: 0,
        contested: false,
      });
    }
    territories.push(row);
  }

  return {
    seed: 'test',
    hash: 'test-hash',
    territories,
    kingStartPositions: [{ x: 2, y: 2, kingId: 1 }], // King start position for base tile detection
    kingConfigs: [],
    generationMetadata: {
      timestamp: Date.now(),
      version: '1.0',
      gridSize: { width: GRID_SIZE, height: GRID_SIZE },
      totalTiles: GRID_SIZE * GRID_SIZE,
      generationTime: 0,
    },
  };
};

describe('TerritoryStrengthSystemService', () => {
  let service: TerritoryStrengthSystemService;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    // Create mock services
    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getIsInitialized',
      'getWorldData',
      'worldToGrid',
      'getTileSize',
    ]);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Setup default mock behaviors
    mockFourKingsTerritory.getIsInitialized.and.returnValue(true);
    mockFourKingsTerritory.getTileSize.and.returnValue(50);
    mockFourKingsTerritory.getWorldData.and.returnValue(createMockWorldData());

    TestBed.configureTestingModule({
      providers: [
        TerritoryStrengthSystemService,
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    service = TestBed.inject(TerritoryStrengthSystemService);
  });

  afterEach(() => {
    service.destroy();
  });

  describe('Core Strength Tracking', () => {
    it('should initialize tile strengths to default values', (done) => {
      // Wait for initialization
      setTimeout(() => {
        const strength = service.getTileStrength(5, 5);
        expect(strength).toBe(75); // INITIAL_STRENGTH
        done();
      }, 150);
    });

    it('should identify base tiles near king starting positions', (done) => {
      setTimeout(() => {
        // Tiles near king starting position should be base tiles (strength 100)
        const baseStrength = service.getTileStrength(2, 2);
        expect(baseStrength).toBe(100); // BASE_STRENGTH

        // Tiles far from starting position should have normal strength
        const normalStrength = service.getTileStrength(5, 5);
        expect(normalStrength).toBe(75); // INITIAL_STRENGTH
        done();
      }, 150);
    });

    it('should track strength changes through observable', (done) => {
      let changeEvents = 0;

      service.strengthChanges$.subscribe((changes) => {
        if (changes.length > 0) {
          changeEvents++;
          expect(changes[0].reason).toBeDefined();
          expect(changes[0].oldStrength).toBeDefined();
          expect(changes[0].newStrength).toBeDefined();
        }
      });

      setTimeout(() => {
        // Trigger a strength change
        service.setTileStrength(5, 5, 50, 'test_change');

        setTimeout(() => {
          expect(changeEvents).toBeGreaterThan(0);
          done();
        }, 50);
      }, 150);
    });
  });

  describe('Kill Impact Weakening', () => {
    beforeEach((done) => {
      // Wait for initialization
      setTimeout(done, 150);
    });

    it('should weaken tiles within impact radius of a kill', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 5, gridY: 5 });

      const initialStrength = service.getTileStrength(5, 5);
      service.weakenTilesFromKill(250, 250); // World coordinates
      const newStrength = service.getTileStrength(5, 5);

      expect(newStrength).toBeLessThan(initialStrength);
      expect(newStrength).toBeGreaterThanOrEqual(10); // MIN_STRENGTH
    });

    it('should apply distance-based falloff to weakening', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 5, gridY: 5 });

      // Get initial strengths at different distances
      const centerInitial = service.getTileStrength(5, 5);
      const nearInitial = service.getTileStrength(5, 6);
      const farInitial = service.getTileStrength(5, 7);

      service.weakenTilesFromKill(250, 250);

      // Check weakening decreases with distance
      const centerReduction = centerInitial - service.getTileStrength(5, 5);
      const nearReduction = nearInitial - service.getTileStrength(5, 6);
      const farReduction = farInitial - service.getTileStrength(5, 7);

      expect(centerReduction).toBeGreaterThan(nearReduction);
      expect(nearReduction).toBeGreaterThanOrEqual(farReduction);
    });

    it('should not weaken base tiles', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 2, gridY: 2 });

      const baseStrength = service.getTileStrength(2, 2);
      expect(baseStrength).toBe(100); // Verify it's a base tile

      service.weakenTilesFromKill(100, 100);

      const newStrength = service.getTileStrength(2, 2);
      expect(newStrength).toBe(100); // Should remain unchanged
    });

    it('should respect minimum strength threshold', () => {
      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 5, gridY: 5 });

      // Weaken tile multiple times
      for (let i = 0; i < 10; i++) {
        service.weakenTilesFromKill(250, 250);
      }

      const finalStrength = service.getTileStrength(5, 5);
      expect(finalStrength).toBeGreaterThanOrEqual(10); // MIN_STRENGTH
    });
  });

  describe('Weak Tile Detection', () => {
    beforeEach((done) => {
      setTimeout(done, 150);
    });

    it('should identify tiles below weak threshold', () => {
      // Set some tiles to weak strength (use positions far from king start at 2,2)
      // Tiles within 3 units of (2,2) are base tiles, so use (7,7), (8,8), (9,9)
      service.setTileStrength(7, 7, 25, 'test');
      service.setTileStrength(8, 8, 20, 'test');
      service.setTileStrength(9, 9, 35, 'test'); // Above threshold

      const weakTiles = service.getWeakTiles();

      expect(weakTiles.length).toBe(2);
      expect(weakTiles.some((t) => t.gridX === 7 && t.gridY === 7)).toBe(true);
      expect(weakTiles.some((t) => t.gridX === 8 && t.gridY === 8)).toBe(true);
      expect(weakTiles.some((t) => t.gridX === 9 && t.gridY === 9)).toBe(false);
    });

    it('should check if tile can be captured', () => {
      // Use positions far from king start at (2,2) - tiles within 3 units are base tiles
      service.setTileStrength(7, 7, 25, 'test');
      service.setTileStrength(8, 8, 50, 'test');

      expect(service.canTileBeCaptured(7, 7)).toBe(true);
      expect(service.canTileBeCaptured(8, 8)).toBe(false);
      expect(service.canTileBeCaptured(2, 2)).toBe(false); // Base tile
    });
  });

  describe('Neighbor Detection', () => {
    beforeEach((done) => {
      setTimeout(done, 150);
    });

    it('should get neighboring tiles correctly', () => {
      const neighbors = service.getTileNeighbors(5, 5);

      expect(neighbors.north).toBeDefined();
      expect(neighbors.south).toBeDefined();
      expect(neighbors.east).toBeDefined();
      expect(neighbors.west).toBeDefined();

      expect(neighbors.north?.gridY).toBe(4);
      expect(neighbors.south?.gridY).toBe(6);
      expect(neighbors.east?.gridX).toBe(6);
      expect(neighbors.west?.gridX).toBe(4);
    });

    it('should handle edge tiles correctly', () => {
      const topLeftNeighbors = service.getTileNeighbors(0, 0);

      expect(topLeftNeighbors.north).toBeUndefined(); // Out of bounds
      expect(topLeftNeighbors.west).toBeUndefined(); // Out of bounds
      expect(topLeftNeighbors.south).toBeDefined();
      expect(topLeftNeighbors.east).toBeDefined();
    });
  });

  describe('Persistence', () => {
    beforeEach((done) => {
      setTimeout(done, 150);
    });

    it('should serialize current state', () => {
      service.setTileStrength(3, 3, 50, 'test');

      const snapshot = service.serialize();
      expect(snapshot.tileStrengths).toBeDefined();
      expect(snapshot.lastUpdate).toBeDefined();
      expect(snapshot.tileStrengths.get('3,3')).toBe(50);
    });

    it('should deserialize saved state', () => {
      const savedState = {
        tileStrengths: new Map([
          ['3,3', 45],
          ['4,4', 60],
        ]),
        lastUpdate: Date.now(),
      };

      service.deserialize(savedState);

      expect(service.getTileStrength(3, 3)).toBe(45);
      expect(service.getTileStrength(4, 4)).toBe(60);
    });
  });
});

// Test helpers are imported from shared file
