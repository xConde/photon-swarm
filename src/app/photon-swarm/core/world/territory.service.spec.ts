import { TestBed } from '@angular/core/testing';
import { TerritoryService } from './territory.service';

describe('TerritoryService', () => {
  let service: TerritoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TerritoryService] });
    service = TestBed.inject(TerritoryService);
    // world size arbitrary for init
    service.init(1200, 900, 0);
  });

  it('randomDuration should fall between 40-75 seconds', () => {
    const durations: number[] = [];
    for (let i = 0; i < 50; i++) {
      durations.push(service['randomDuration']());
    }
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(40000);
    expect(Math.max(...durations)).toBeLessThanOrEqual(75000);
  });

  it('resetVisited clears visited grid', () => {
    // mark a tile visited then reset and verify
    service.markVisited(10, 10);
    expect(service.isVisited(0, 0)).toBeTrue();
    service.resetVisited();
    expect(service.isVisited(0, 0)).toBeFalse();
  });

  /** Utility to iterate through tile grid indices */
  function forEachTile(cols: number, rows: number, cb: (r: number, c: number) => void): void {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) cb(r, c);
    }
  }

  it('ensures every tile belongs to a territory that touches at least one neighbour', () => {
    const WORLD_W = 1200; // ensures non-square grid (4 cols)
    const WORLD_H = 1050; // produces 4x4 grid with tileSize 300
    const TILE = 300;
    const COLS = Math.ceil(WORLD_W / TILE);
    const ROWS = Math.ceil(WORLD_H / TILE);

    service.init(WORLD_W, WORLD_H);
    // Use deterministic seed for repeatability
    service.regenerate(42);

    // helper to map world coordinate centre of tile
    const idAt = (r: number, c: number): number | null => {
      const x = c * TILE + TILE / 2;
      const y = r * TILE + TILE / 2;
      return service.getTerritoryId(x, y);
    };

    forEachTile(COLS, ROWS, (r, c) => {
      const id = idAt(r, c);
      expect(id).not.toBeNull();
      // find at least one 4-neighbour tile of same id (if any exist within bounds)
      const neighbours = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const;
      const hasNeighbour = neighbours.some(([dr, dc]) => {
        const nr = r + dr,
          nc = c + dc;
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) return false;
        return idAt(nr, nc) === id;
      });
      expect(hasNeighbour).toBeTrue();
    });
  });
});
