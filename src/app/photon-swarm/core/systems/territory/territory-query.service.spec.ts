import { TestBed } from '@angular/core/testing';
import { TerritoryQueryService } from './territory-query.service';
import { TerritoryChunkManagerService } from './territory-chunk-manager.service';
import { KingConfig, TerritoryTile } from '../../models/territory.model';

describe('TerritoryQueryService', () => {
  let service: TerritoryQueryService;
  let chunkManagerSpy: jasmine.SpyObj<TerritoryChunkManagerService>;

  // Real service constants (from FOUR_KINGS_CONFIG.TILE_SIZE and WORLD_CONFIG.BOUNDS)
  const TILE_SIZE = 120;
  const GRID_WIDTH = Math.ceil(12000 / TILE_SIZE); // 100
  const GRID_HEIGHT = Math.ceil(9000 / TILE_SIZE); // 75

  const makeKing = (id: number, name: string): KingConfig => ({
    id,
    name,
    color: '#000000',
    baseColor: '#000000',
    glowColor: '#000000',
    expansionStyle: 'aggressive',
    expansionRate: 1,
    clusterTendency: 0.5,
    warlikeness: 0.5,
  });

  const kings: KingConfig[] = [makeKing(1, 'Crimson King'), makeKing(2, 'Azure King')];

  function makeGrid(): (TerritoryTile | null)[][] {
    const grid: (TerritoryTile | null)[][] = [];
    for (let x = 0; x < 3; x++) {
      grid[x] = [];
      for (let y = 0; y < 3; y++) {
        grid[x][y] = null;
      }
    }
    grid[1][1] = { x: 1, y: 1, kingId: 1, strength: 0.7, contested: false, age: 5 };
    return grid;
  }

  beforeEach(() => {
    const chunkSpy = jasmine.createSpyObj('TerritoryChunkManagerService', ['getTile']);
    chunkSpy.getTile.and.returnValue(null); // default: fall through to the passed-in territoryGrid

    TestBed.configureTestingModule({
      providers: [TerritoryQueryService, { provide: TerritoryChunkManagerService, useValue: chunkSpy }],
    });

    service = TestBed.inject(TerritoryQueryService);
    chunkManagerSpy = TestBed.inject(TerritoryChunkManagerService) as jasmine.SpyObj<TerritoryChunkManagerService>;
  });

  afterEach(() => {
    window.debugLogBridge = undefined;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTileSize', () => {
    it('returns FOUR_KINGS_CONFIG.TILE_SIZE', () => {
      expect(service.getTileSize()).toBe(TILE_SIZE);
    });
  });

  describe('isValidTile', () => {
    it('returns true for in-bounds coordinates, including the grid edges', () => {
      expect(service.isValidTile(0, 0)).toBe(true);
      expect(service.isValidTile(GRID_WIDTH - 1, GRID_HEIGHT - 1)).toBe(true);
    });

    it('returns false for negative or out-of-range coordinates', () => {
      expect(service.isValidTile(-1, 0)).toBe(false);
      expect(service.isValidTile(0, -1)).toBe(false);
      expect(service.isValidTile(GRID_WIDTH, 0)).toBe(false);
      expect(service.isValidTile(0, GRID_HEIGHT)).toBe(false);
    });
  });

  describe('worldToGrid', () => {
    it('converts an in-bounds world position to grid coordinates', () => {
      expect(service.worldToGrid(125, 245)).toEqual({ gridX: 1, gridY: 2 });
    });

    it('returns null when the resulting grid coordinates are out of bounds', () => {
      expect(service.worldToGrid(-10, 0)).toBeNull();
      expect(service.worldToGrid(0, -10)).toBeNull();
      expect(service.worldToGrid(TILE_SIZE * GRID_WIDTH + 10, 0)).toBeNull();
    });
  });

  describe('getTile', () => {
    it('returns null for out-of-bounds coordinates without consulting the chunk manager', () => {
      const grid = makeGrid();
      expect(service.getTile(-1, 0, grid)).toBeNull();
      expect(chunkManagerSpy.getTile).not.toHaveBeenCalled();
    });

    it('prefers the chunk manager tile when present', () => {
      const grid = makeGrid();
      const chunkTile: TerritoryTile = { x: 0, y: 0, kingId: 2, strength: 0.3, contested: false, age: 0 };
      chunkManagerSpy.getTile.and.returnValue(chunkTile);
      expect(service.getTile(0, 0, grid)).toBe(chunkTile);
    });

    it('falls back to the territory grid when the chunk manager has no tile', () => {
      const grid = makeGrid();
      expect(service.getTile(1, 1, grid)).toBe(grid[1][1]);
    });

    it('returns null when neither the chunk manager nor the grid has a tile', () => {
      const grid = makeGrid();
      expect(service.getTile(0, 0, grid)).toBeNull();
    });
  });

  describe('getTileAtWorld', () => {
    it('converts world coordinates and resolves the same way getTile does', () => {
      const grid = makeGrid();
      const worldX = 1 * TILE_SIZE + 10;
      const worldY = 1 * TILE_SIZE + 10;
      expect(service.getTileAtWorld(worldX, worldY, grid)).toBe(grid[1][1]);
    });

    it('returns null for out-of-bounds world coordinates', () => {
      const grid = makeGrid();
      expect(service.getTileAtWorld(-100, -100, grid)).toBeNull();
    });
  });

  describe('getTerritoryAt', () => {
    it('returns the kingId of the tile at the given grid coordinates', () => {
      const grid = makeGrid();
      expect(service.getTerritoryAt(1, 1, grid)).toBe(1);
    });

    it('returns 0 when there is no tile at the given coordinates', () => {
      const grid = makeGrid();
      expect(service.getTerritoryAt(0, 0, grid)).toBe(0);
    });

    it('returns 0 for out-of-bounds coordinates', () => {
      const grid = makeGrid();
      expect(service.getTerritoryAt(-1, -1, grid)).toBe(0);
    });
  });

  describe('getGeneratedWorld', () => {
    it('returns null when not initialized', () => {
      const grid = makeGrid();
      expect(service.getGeneratedWorld(false, 'seed-1', grid, kings)).toBeNull();
    });

    it('builds a GeneratedWorld snapshot from the given state when initialized', () => {
      const grid = makeGrid();
      const result = service.getGeneratedWorld(true, 'seed-1', grid, kings);

      expect(result).not.toBeNull();
      expect(result!.seed).toBe('seed-1');
      expect(result!.hash).toBe('');
      expect(result!.territories).toBe(grid);
      expect(result!.kingStartPositions).toEqual([]);
      expect(result!.kingConfigs).toBe(kings);
      expect(result!.generationMetadata.gridSize).toEqual({ width: GRID_WIDTH, height: GRID_HEIGHT });
      expect(result!.generationMetadata.totalTiles).toBe(GRID_WIDTH * GRID_HEIGHT);
    });
  });

  describe('getTerritoryAtPosition', () => {
    it('returns null for out-of-bounds world coordinates', () => {
      const grid = makeGrid();
      expect(service.getTerritoryAtPosition(-100, -100, grid, kings, new Set())).toBeNull();
    });

    it('returns null for unowned territory (kingId 0)', () => {
      const grid = makeGrid();
      grid[0][0] = { x: 0, y: 0, kingId: 0, strength: 0, contested: false, age: 0 };
      expect(service.getTerritoryAtPosition(10, 10, grid, kings, new Set())).toBeNull();
    });

    it('returns king info for an owned tile', () => {
      const grid = makeGrid();
      const worldX = 1 * TILE_SIZE + 10;
      const worldY = 1 * TILE_SIZE + 10;

      const result = service.getTerritoryAtPosition(worldX, worldY, grid, kings, new Set());

      expect(result).toEqual({ kingId: 1, kingName: 'Crimson King', strength: 0.7 });
    });

    it('logs once and returns null for an invalid kingId, suppressing repeat logs via the shared loggedErrors Set', () => {
      const grid = makeGrid();
      grid[1][1] = { x: 1, y: 1, kingId: 99, strength: 0.7, contested: false, age: 0 };
      window.debugLogBridge = { log: jasmine.createSpy('log') };
      const loggedErrors = new Set<string>();

      const worldX = 1 * TILE_SIZE + 10;
      const worldY = 1 * TILE_SIZE + 10;

      expect(service.getTerritoryAtPosition(worldX, worldY, grid, kings, loggedErrors)).toBeNull();
      expect((window.debugLogBridge!.log as jasmine.Spy).calls.count()).toBe(1);

      // Same loggedErrors instance passed again — dedup must suppress the repeat log.
      expect(service.getTerritoryAtPosition(worldX, worldY, grid, kings, loggedErrors)).toBeNull();
      expect((window.debugLogBridge!.log as jasmine.Spy).calls.count()).toBe(1);
    });
  });
});
