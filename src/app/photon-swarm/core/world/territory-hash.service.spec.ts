import { TestBed } from '@angular/core/testing';
import { TerritoryHashService } from './territory-hash.service';
import { KingConfig, TerritoryTile } from '../models/territory.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTile(kingId: number, x: number, y: number): TerritoryTile {
  return {
    x,
    y,
    kingId,
    strength: 50,
    age: 0,
    contested: false,
    isRoad: false,
    roadConnections: 0,
    distanceFromCapital: 1,
  };
}

function makeGrid(rows: number, cols: number, kingId = 1): (TerritoryTile | null)[][] {
  const grid: (TerritoryTile | null)[][] = [];
  for (let x = 0; x < rows; x++) {
    grid[x] = [];
    for (let y = 0; y < cols; y++) {
      grid[x][y] = makeTile(kingId, x, y);
    }
  }
  return grid;
}

function makeKings(): Array<{
  id: number;
  name: string;
  color: string;
  expansionStyle: string;
  expansionRate: number;
}> {
  return [
    { id: 1, name: 'Red King', color: '#f00', expansionStyle: 'aggressive', expansionRate: 1.0 },
    { id: 2, name: 'Blue King', color: '#00f', expansionStyle: 'defensive', expansionRate: 0.8 },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerritoryHashService', () => {
  let service: TerritoryHashService;

  beforeEach(() => {
    // Suppress debugLogBridge calls
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;

    TestBed.configureTestingModule({});
    service = TestBed.inject(TerritoryHashService);
  });

  afterEach(() => {
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // generateTerritoryHash
  // -------------------------------------------------------------------------

  describe('generateTerritoryHash()', () => {
    it('should return a hex string', () => {
      const grid = makeGrid(3, 3);
      const hash = service.generateTerritoryHash(grid);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('should be deterministic — same grid produces same hash', () => {
      const grid = makeGrid(5, 5);
      const h1 = service.generateTerritoryHash(grid);
      const h2 = service.generateTerritoryHash(grid);
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different kingId distributions', () => {
      const gridA = makeGrid(3, 3, 1);
      const gridB = makeGrid(3, 3, 2);
      const hA = service.generateTerritoryHash(gridA);
      const hB = service.generateTerritoryHash(gridB);
      expect(hA).not.toBe(hB);
    });

    it('should produce different hashes when a tile is changed', () => {
      const grid = makeGrid(3, 3, 1);
      const original = service.generateTerritoryHash(grid);

      grid[1][1]!.kingId = 2; // mutate a tile
      const modified = service.generateTerritoryHash(grid);
      expect(original).not.toBe(modified);
    });

    it('should handle grids with null tiles', () => {
      const grid: (TerritoryTile | null)[][] = [
        [null, makeTile(1, 0, 1)],
        [makeTile(2, 1, 0), null],
      ];
      expect(() => service.generateTerritoryHash(grid)).not.toThrow();
    });

    it('should produce different hashes for different grid sizes with same data', () => {
      const small = makeGrid(2, 2);
      const large = makeGrid(4, 4);
      const hSmall = service.generateTerritoryHash(small);
      const hLarge = service.generateTerritoryHash(large);
      expect(hSmall).not.toBe(hLarge);
    });
  });

  // -------------------------------------------------------------------------
  // generateKingConfigHash
  // -------------------------------------------------------------------------

  describe('generateKingConfigHash()', () => {
    it('should return an 8-character hex string', () => {
      const hash = service.generateKingConfigHash(makeKings());
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('should be deterministic', () => {
      const kings = makeKings();
      const h1 = service.generateKingConfigHash(kings);
      const h2 = service.generateKingConfigHash(kings);
      expect(h1).toBe(h2);
    });

    it('should differ when king name changes', () => {
      const kings = makeKings();
      const original = service.generateKingConfigHash(kings);

      kings[0].name = 'Shadow King';
      const modified = service.generateKingConfigHash(kings);
      expect(original).not.toBe(modified);
    });

    it('should differ when expansion rate changes', () => {
      const kings = makeKings();
      const original = service.generateKingConfigHash(kings);

      kings[0].expansionRate = 2.5;
      const modified = service.generateKingConfigHash(kings);
      expect(original).not.toBe(modified);
    });
  });

  // -------------------------------------------------------------------------
  // generateWorldHash
  // -------------------------------------------------------------------------

  describe('generateWorldHash()', () => {
    it('should return a 16-character hex string', () => {
      const grid = makeGrid(3, 3);
      const kingConfigs: KingConfig[] = [
        {
          id: 1,
          name: 'Red',
          color: '#f00',
          baseColor: '#900',
          glowColor: '#f44',
          expansionStyle: 'aggressive',
          expansionRate: 1.0,
          clusterTendency: 0.5,
          warlikeness: 0.8,
        },
      ];
      const hash = service.generateWorldHash('seed-abc', grid, kingConfigs);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should be deterministic for the same inputs', () => {
      const grid = makeGrid(3, 3);
      const kingConfigs: KingConfig[] = [
        {
          id: 1,
          name: 'Red',
          color: '#f00',
          baseColor: '#900',
          glowColor: '#f44',
          expansionStyle: 'aggressive',
          expansionRate: 1.0,
          clusterTendency: 0.5,
          warlikeness: 0.8,
        },
      ];
      const h1 = service.generateWorldHash('seed-abc', grid, kingConfigs);
      const h2 = service.generateWorldHash('seed-abc', grid, kingConfigs);
      expect(h1).toBe(h2);
    });

    it('should differ for different seeds', () => {
      const grid = makeGrid(2, 2);
      const kingConfigs: KingConfig[] = [];
      const h1 = service.generateWorldHash('seed-1', grid, kingConfigs);
      const h2 = service.generateWorldHash('seed-2', grid, kingConfigs);
      expect(h1).not.toBe(h2);
    });
  });

  // -------------------------------------------------------------------------
  // validateWorld
  // -------------------------------------------------------------------------

  describe('validateWorld()', () => {
    it('should return true when hash matches', () => {
      const grid = makeGrid(3, 3);
      const kingConfigs: KingConfig[] = [];
      const hash = service.generateWorldHash('seed', grid, kingConfigs);
      expect(service.validateWorld('seed', grid, kingConfigs, hash)).toBeTrue();
    });

    it('should return false when hash does not match', () => {
      const grid = makeGrid(3, 3);
      const kingConfigs: KingConfig[] = [];
      expect(service.validateWorld('seed', grid, kingConfigs, 'deadbeefdeadbeef')).toBeFalse();
    });

    it('should detect grid corruption (modified tile)', () => {
      const grid = makeGrid(3, 3);
      const kingConfigs: KingConfig[] = [];
      const hash = service.generateWorldHash('seed', grid, kingConfigs);

      // Corrupt the grid
      grid[0][0]!.kingId = 99;
      expect(service.validateWorld('seed', grid, kingConfigs, hash)).toBeFalse();
    });
  });
});
