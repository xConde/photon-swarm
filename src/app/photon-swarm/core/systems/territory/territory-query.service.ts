// Extracted from FourKingsTerritoryService (decomposition plan, Phase B — read-only
// facade). Pure tile/world QUERIES only — never mutates territoryGrid, visualGrid,
// kingTerritoryCount, territoryGeneration, or any other warfare/conquest state. Those
// stay on FourKingsTerritoryService (the world-gen/expansion/conquest core is deferred,
// not extracted).
//
// Single-writer note: this service holds NO copy of FourKingsTerritoryService's mutable
// state. FourKingsTerritoryService passes in its current territoryGrid / isInitialized /
// currentWorldSeed / kings on every call, and this service never stores what it's given.
// That keeps FourKingsTerritoryService the single owner/writer of that state; this service
// only ever reads a reference it was handed for the duration of one call.
//
// Two documented exceptions to "pure read", both carried over unchanged from the
// un-extracted code — do NOT read the methods below as side-effect-free:
//   1. `loggedErrors` (see below) is appended to by getTerritoryAtPosition().
//   2. getTile()/getTileAtWorld()/getTerritoryAtPosition() consult
//      TerritoryChunkManagerService.getTile(), which on a cache miss runs
//      getOrGenerateChunk() -> generateChunk() and mutates the chunk cache. That is a
//      generate-on-read path inside the chunk manager, not something this facade
//      introduced, and it is why extracting these bodies does not by itself satisfy the
//      plan's "never generate-on-read" rule. The rule is satisfied for
//      FourKingsTerritoryService's OWN grid state, which is only ever read here.
//
// TILE_SIZE / GRID_WIDTH / GRID_HEIGHT are NOT passed in as parameters even though
// FourKingsTerritoryService also holds copies of them: both are pure derivations of the
// same immutable, `as const` FOUR_KINGS_CONFIG.TILE_SIZE / WORLD_CONFIG.BOUNDS (never
// reassigned at runtime by either class), so computing them independently here is
// guaranteed byte-identical to FourKingsTerritoryService's copies — there is no second
// piece of *state* to keep in sync, just the same constant re-derived.
//
// The one field that is genuinely shared is `loggedErrors`: getTerritoryAtPosition()
// below adds entries to the exact Set instance FourKingsTerritoryService passes in.
// FourKingsTerritoryService still exclusively OWNS that Set (it creates it and is the
// only place that clears it, in setSeed()/reset()/destroy()) — this service only ever
// appends to the same object reference, identical to how the un-extracted code behaved
// when both operations lived in one class.
//
// TerritoryChunkManagerService is injected directly (providedIn: 'root' singleton) rather
// than passed as a parameter, since FourKingsTerritoryService and this service always
// resolve to the same instance.

import { Injectable } from '@angular/core';
import { FOUR_KINGS_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { GeneratedWorld, KingConfig, TerritoryTile } from '../../models/territory.model';
import { TerritoryChunkManagerService } from './territory-chunk-manager.service';

@Injectable({ providedIn: 'root' })
export class TerritoryQueryService {
  private readonly TILE_SIZE = FOUR_KINGS_CONFIG.TILE_SIZE;
  private readonly GRID_WIDTH = Math.ceil(WORLD_CONFIG.BOUNDS.WIDTH / this.TILE_SIZE);
  private readonly GRID_HEIGHT = Math.ceil(WORLD_CONFIG.BOUNDS.HEIGHT / this.TILE_SIZE);

  constructor(private chunkManager: TerritoryChunkManagerService) {}

  /**
   * Convert world coordinates to grid coordinates
   */
  worldToGrid(worldX: number, worldY: number): { gridX: number; gridY: number } | null {
    const gridX = Math.floor(worldX / this.TILE_SIZE);
    const gridY = Math.floor(worldY / this.TILE_SIZE);

    if (gridX < 0 || gridX >= this.GRID_WIDTH || gridY < 0 || gridY >= this.GRID_HEIGHT) {
      return null;
    }

    return { gridX, gridY };
  }

  /**
   * Get tile size for calculations
   */
  getTileSize(): number {
    return this.TILE_SIZE;
  }

  /**
   * Helper: Check if tile coordinates are valid
   */
  isValidTile(x: number, y: number): boolean {
    return x >= 0 && x < this.GRID_WIDTH && y >= 0 && y < this.GRID_HEIGHT;
  }

  /**
   * Get territory info at world position
   */
  getTerritoryAtPosition(
    worldX: number,
    worldY: number,
    territoryGrid: (TerritoryTile | null)[][],
    kings: KingConfig[],
    loggedErrors: Set<string>
  ): { kingId: number; kingName: string; strength: number } | null {
    const x = Math.floor(worldX / this.TILE_SIZE);
    const y = Math.floor(worldY / this.TILE_SIZE);

    if (!this.isValidTile(x, y)) return null;

    // CRITICAL FIX: Use chunk manager to get tile data instead of main grid
    // This ensures that preloaded chunks are actually used for rendering
    let tile = this.chunkManager.getTile(x, y);

    // Fallback to main grid if chunk manager doesn't have the tile
    if (!tile) {
      tile = territoryGrid[x]?.[y] || null;
    }

    if (!tile) return null;

    // Handle unowned territory (kingId: 0)
    if (tile.kingId === 0) {
      return null; // No king owns this territory
    }

    // Validate kingId and ensure king exists
    if (tile.kingId < 1 || tile.kingId > kings.length) {
      // Only log once per invalid kingId
      const errorKey = `invalid_king_${tile.kingId}`;
      if (!loggedErrors.has(errorKey)) {
        loggedErrors.add(errorKey);
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Invalid kingId in territory tile (suppressing further logs)', 'error', {
            source: 'four_kings_territory',
            operation: 'getTerritoryAtPosition',
            position: [worldX, worldY],
            tilePos: [x, y],
            kingId: tile.kingId,
            availableKings: kings.length,
            validRange: '1-4',
          });
        }
      }
      return null;
    }

    const king = kings[tile.kingId - 1];
    if (!king) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('King not found in kings array', 'error', {
          source: 'four_kings_territory',
          operation: 'getTerritoryAtPosition',
          kingId: tile.kingId,
          kingIndex: tile.kingId - 1,
          kingsLength: kings.length,
        });
      }
      return null;
    }

    return {
      kingId: tile.kingId,
      kingName: king.name,
      strength: tile.strength,
    };
  }

  /**
   * Get tile at grid coordinates
   */
  getTile(gridX: number, gridY: number, territoryGrid: (TerritoryTile | null)[][]): TerritoryTile | null {
    if (!this.isValidTile(gridX, gridY)) return null;

    // Use chunk manager first, then fallback to grid
    let tile = this.chunkManager.getTile(gridX, gridY);
    if (!tile) {
      tile = territoryGrid[gridX]?.[gridY] || null;
    }

    return tile;
  }

  /**
   * Get tile at world coordinates (public method for bridge)
   */
  getTileAtWorld(worldX: number, worldY: number, territoryGrid: (TerritoryTile | null)[][]): TerritoryTile | null {
    const x = Math.floor(worldX / this.TILE_SIZE);
    const y = Math.floor(worldY / this.TILE_SIZE);

    if (!this.isValidTile(x, y)) return null;

    // Use chunk manager first, then fallback to grid
    let tile = this.chunkManager.getTile(x, y);
    if (!tile) {
      tile = territoryGrid[x]?.[y] || null;
    }

    return tile;
  }

  /**
   * Get territory at grid coordinates (for territory warfare)
   */
  getTerritoryAt(gridX: number, gridY: number, territoryGrid: (TerritoryTile | null)[][]): number {
    const tile = this.getTile(gridX, gridY, territoryGrid);
    return tile ? tile.kingId : 0;
  }

  /**
   * Get the generated world (for territory warfare system)
   */
  getGeneratedWorld(
    isInitialized: boolean,
    currentWorldSeed: string,
    territoryGrid: (TerritoryTile | null)[][],
    kings: KingConfig[]
  ): GeneratedWorld | null {
    if (!isInitialized) return null;

    return {
      seed: currentWorldSeed,
      hash: '', // Would need to compute if needed
      territories: territoryGrid,
      kingStartPositions: [], // Not needed for warfare system
      kingConfigs: kings,
      generationMetadata: {
        timestamp: Date.now(),
        version: '1.0.0',
        gridSize: { width: this.GRID_WIDTH, height: this.GRID_HEIGHT },
        totalTiles: this.GRID_WIDTH * this.GRID_HEIGHT,
        generationTime: 0,
      },
    };
  }
}
