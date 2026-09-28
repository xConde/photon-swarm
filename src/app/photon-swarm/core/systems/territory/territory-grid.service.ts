import { Injectable } from '@angular/core';
import {
  FactionTerritoryTile,
  TERRITORY_FACTIONS,
  TERRITORY_GRID_CONFIG,
  TerritoryCoordinateUtils,
  TerritoryFaction,
  TileCoordinate,
} from '../../models/territory-tile.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Territory Grid Service
 *
 * Manages the 200x150 grid of territory tiles that cover the entire game world.
 * This is the foundation of the faction territory system.
 *
 * IMPORTANT: This service manages territory ownership, NOT enemy spawning.
 * All enemy types spawn in all territories regardless of faction.
 */
@Injectable({ providedIn: 'root' })
export class TerritoryGridService {
  // The main grid - 2D array indexed by [gridX][gridY]
  private territoryGrid: FactionTerritoryTile[][] = [];

  // Faction data cache
  private factions: Map<number, TerritoryFaction> = new Map();

  // Performance optimization: track dirty tiles
  private dirtyTiles: Set<string> = new Set(); // "x,y" format

  // Faction tile cache - avoids O(30,000) iterations
  private factionTileCache: Map<number, FactionTerritoryTile[]> = new Map();
  private factionTileCacheValid = false;

  // Stats tracking
  private totalTilesGenerated = 0;

  constructor(private debugLog: DebugLogBridgeService) {
    this.initializeFactions();
  }

  /**
   * Initialize the faction data
   */
  private initializeFactions(): void {
    for (const faction of TERRITORY_FACTIONS) {
      this.factions.set(faction.id, { ...faction });
    }
  }

  /**
   * Initialize the territory grid with empty tiles
   * This should be called once at game start
   */
  initializeGrid(): void {
    const startTime = Date.now();

    // Create empty grid
    this.territoryGrid = [];

    for (let x = 0; x < TERRITORY_GRID_CONFIG.GRID_WIDTH; x++) {
      this.territoryGrid[x] = [];

      for (let y = 0; y < TERRITORY_GRID_CONFIG.GRID_HEIGHT; y++) {
        this.territoryGrid[x][y] = this.createEmptyTile(x, y);
        this.totalTilesGenerated++;
      }
    }

    // Invalidate faction tile cache
    this.factionTileCacheValid = false;

    const duration = Date.now() - startTime;

    this.debugLog.log('Territory Grid Initialized', 'info', {
      gridWidth: TERRITORY_GRID_CONFIG.GRID_WIDTH,
      gridHeight: TERRITORY_GRID_CONFIG.GRID_HEIGHT,
      totalTiles: this.totalTilesGenerated,
      duration: `${duration.toFixed(2)}ms`,
    });
  }

  /**
   * Create an empty/neutral tile
   */
  private createEmptyTile(gridX: number, gridY: number): FactionTerritoryTile {
    return {
      gridX,
      gridY,
      factionId: 0, // Neutral
      ownershipStrength: 0,
      isContested: false,
      isBase: false,
      isTransitioning: false,
      previousFactionId: 0,
      transitionProgress: 0,
      buffMultiplier: TERRITORY_GRID_CONFIG.NEUTRAL_BUFF_MULTIPLIER,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Get a tile at grid coordinates
   */
  getTile(gridX: number, gridY: number): FactionTerritoryTile | null {
    if (!TerritoryCoordinateUtils.isValidGridCoordinate(gridX, gridY)) {
      return null;
    }

    return this.territoryGrid[gridX]?.[gridY] || null;
  }

  /**
   * Get a tile at world coordinates
   */
  getTileAtWorld(worldX: number, worldY: number): FactionTerritoryTile | null {
    const { gridX, gridY } = TerritoryCoordinateUtils.worldToGrid(worldX, worldY);
    return this.getTile(gridX, gridY);
  }

  /**
   * Set faction ownership of a tile
   */
  setTileOwnership(
    gridX: number,
    gridY: number,
    factionId: number,
    strength: number = 1.0,
    isBase: boolean = false
  ): boolean {
    const tile = this.getTile(gridX, gridY);
    if (!tile) return false;

    // Store previous state for transitions
    if (tile.factionId !== factionId) {
      tile.previousFactionId = tile.factionId;
      tile.isTransitioning = true;
      tile.transitionProgress = 0;
      // Invalidate faction tile cache on ownership change
      this.factionTileCacheValid = false;
    }

    // Update ownership
    tile.factionId = factionId;
    tile.ownershipStrength = Math.max(0, Math.min(1, strength));
    tile.isBase = isBase;

    // Update buff multiplier based on tile type
    if (isBase) {
      tile.buffMultiplier = TERRITORY_GRID_CONFIG.BASE_BUFF_MULTIPLIER;
    } else if (tile.isContested) {
      tile.buffMultiplier = TERRITORY_GRID_CONFIG.CONTESTED_BUFF_MULTIPLIER;
    } else if (factionId > 0) {
      tile.buffMultiplier = 1.0; // Normal faction territory
    } else {
      tile.buffMultiplier = TERRITORY_GRID_CONFIG.NEUTRAL_BUFF_MULTIPLIER;
    }

    tile.lastUpdate = Date.now();

    // Mark as dirty for rendering updates
    this.markTileDirty(gridX, gridY);

    // Update faction stats
    this.updateFactionStats();

    return true;
  }

  /**
   * Mark a tile as contested (border between factions)
   */
  setTileContested(gridX: number, gridY: number, contested: boolean): void {
    const tile = this.getTile(gridX, gridY);
    if (!tile) return;

    tile.isContested = contested;
    tile.buffMultiplier = contested
      ? TERRITORY_GRID_CONFIG.CONTESTED_BUFF_MULTIPLIER
      : tile.isBase
        ? TERRITORY_GRID_CONFIG.BASE_BUFF_MULTIPLIER
        : 1.0;

    this.markTileDirty(gridX, gridY);
  }

  /**
   * Update transition progress for animating tile changes
   */
  updateTransitions(deltaTime: number): void {
    const progress = deltaTime / TERRITORY_GRID_CONFIG.TRANSITION_DURATION;

    for (const key of this.dirtyTiles) {
      const [x, y] = key.split(',').map(Number);
      const tile = this.getTile(x, y);

      if (tile?.isTransitioning) {
        tile.transitionProgress = Math.min(1, tile.transitionProgress + progress);

        if (tile.transitionProgress >= 1) {
          tile.isTransitioning = false;
          tile.previousFactionId = tile.factionId;
        }
      }
    }
  }

  /**
   * Get all tiles owned by a faction
   * Optimized: Uses caching to avoid O(30,000) iteration per call
   */
  getFactionTiles(factionId: number): FactionTerritoryTile[] {
    // Rebuild cache if invalid
    if (!this.factionTileCacheValid) {
      this.rebuildFactionTileCache();
    }

    return this.factionTileCache.get(factionId) || [];
  }

  /**
   * Rebuild the faction tile cache
   * Called when tile ownership changes
   */
  private rebuildFactionTileCache(): void {
    this.factionTileCache.clear();

    // Initialize empty arrays for all factions
    for (const factionId of this.factions.keys()) {
      this.factionTileCache.set(factionId, []);
    }
    this.factionTileCache.set(0, []); // Neutral

    // Single O(n) pass to populate all faction tile lists
    for (let x = 0; x < TERRITORY_GRID_CONFIG.GRID_WIDTH; x++) {
      for (let y = 0; y < TERRITORY_GRID_CONFIG.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];
        const factionTiles = this.factionTileCache.get(tile.factionId);
        if (factionTiles) {
          factionTiles.push(tile);
        }
      }
    }

    this.factionTileCacheValid = true;
  }

  /**
   * Get tiles in a radius around a world point
   */
  getTilesInRadius(worldX: number, worldY: number, radius: number): FactionTerritoryTile[] {
    const center = TerritoryCoordinateUtils.worldToGrid(worldX, worldY);
    const gridRadius = Math.ceil(radius / TERRITORY_GRID_CONFIG.TILE_SIZE);
    const tiles: FactionTerritoryTile[] = [];

    for (let dx = -gridRadius; dx <= gridRadius; dx++) {
      for (let dy = -gridRadius; dy <= gridRadius; dy++) {
        const gridX = center.gridX + dx;
        const gridY = center.gridY + dy;

        if (TerritoryCoordinateUtils.isValidGridCoordinate(gridX, gridY)) {
          const distance = TerritoryCoordinateUtils.euclideanDistance(center.gridX, center.gridY, gridX, gridY);

          if (distance <= gridRadius) {
            const tile = this.getTile(gridX, gridY);
            if (tile) tiles.push(tile);
          }
        }
      }
    }

    return tiles;
  }

  /**
   * Find contested borders between factions
   */
  findContestedBorders(): TileCoordinate[] {
    const contested: TileCoordinate[] = [];

    for (let x = 0; x < TERRITORY_GRID_CONFIG.GRID_WIDTH; x++) {
      for (let y = 0; y < TERRITORY_GRID_CONFIG.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];
        if (tile.factionId === 0) continue; // Skip neutral

        // Check if any neighbor belongs to a different faction
        const neighbors = TerritoryCoordinateUtils.getNeighbors(x, y);
        const isContested = neighbors.some((n) => {
          const neighbor = this.getTile(n.gridX, n.gridY);
          return neighbor && neighbor.factionId !== tile.factionId && neighbor.factionId !== 0;
        });

        if (isContested) {
          contested.push({ gridX: x, gridY: y });
          this.setTileContested(x, y, true);
        } else if (tile.isContested) {
          this.setTileContested(x, y, false);
        }
      }
    }

    return contested;
  }

  /**
   * Update faction statistics
   */
  private updateFactionStats(): void {
    // Reset all faction stats
    for (const faction of this.factions.values()) {
      faction.totalTiles = 0;
      faction.baseTiles = 0;
      faction.contestedTiles = 0;
    }

    // Count tiles per faction
    for (let x = 0; x < TERRITORY_GRID_CONFIG.GRID_WIDTH; x++) {
      for (let y = 0; y < TERRITORY_GRID_CONFIG.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];
        if (tile.factionId > 0) {
          const faction = this.factions.get(tile.factionId);
          if (faction) {
            faction.totalTiles++;
            if (tile.isBase) faction.baseTiles++;
            if (tile.isContested) faction.contestedTiles++;
          }
        }
      }
    }
  }

  /**
   * Get faction statistics
   */
  getFactionStats(factionId: number): TerritoryFaction | undefined {
    return this.factions.get(factionId);
  }

  /**
   * Get all faction statistics
   */
  getAllFactionStats(): TerritoryFaction[] {
    return Array.from(this.factions.values());
  }

  /**
   * Mark a tile as dirty (needs rendering update)
   */
  private markTileDirty(gridX: number, gridY: number): void {
    this.dirtyTiles.add(`${gridX},${gridY}`);
  }

  /**
   * Get and clear dirty tiles
   */
  getDirtyTiles(): FactionTerritoryTile[] {
    const tiles: FactionTerritoryTile[] = [];

    this.dirtyTiles.forEach((key) => {
      const [gridX, gridY] = key.split(',').map(Number);
      const tile = this.getTile(gridX, gridY);
      if (tile) {
        tiles.push(tile);
      }
    });

    // Clear dirty tiles after retrieving them (as documented)
    this.dirtyTiles.clear();

    return tiles;
  }

  /**
   * Clear dirty tiles tracking
   */
  clearDirtyTiles(): void {
    this.dirtyTiles.clear();
  }

  /**
   * Get tile at grid coordinates (alias for getTile for clarity)
   */
  getTileAtGrid(gridX: number, gridY: number): FactionTerritoryTile | null {
    return this.getTile(gridX, gridY);
  }

  /**
   * Check if grid is initialized
   */
  isInitialized(): boolean {
    return this.territoryGrid.length > 0 && this.totalTilesGenerated > 0;
  }

  /**
   * Get grid dimensions
   */
  getGridDimensions(): { width: number; height: number } {
    return {
      width: TERRITORY_GRID_CONFIG.GRID_WIDTH,
      height: TERRITORY_GRID_CONFIG.GRID_HEIGHT,
    };
  }

  /**
   * Debug: Get grid statistics
   */
  getGridStatistics(): {
    totalTiles: number;
    neutralTiles: number;
    factionTiles: Map<number, number>;
    contestedTiles: number;
    baseTiles: number;
  } {
    const stats = {
      totalTiles: TERRITORY_GRID_CONFIG.TOTAL_TILES,
      neutralTiles: 0,
      factionTiles: new Map<number, number>(),
      contestedTiles: 0,
      baseTiles: 0,
    };

    for (let x = 0; x < TERRITORY_GRID_CONFIG.GRID_WIDTH; x++) {
      for (let y = 0; y < TERRITORY_GRID_CONFIG.GRID_HEIGHT; y++) {
        const tile = this.territoryGrid[x][y];

        if (tile.factionId === 0) {
          stats.neutralTiles++;
        } else {
          const count = stats.factionTiles.get(tile.factionId) || 0;
          stats.factionTiles.set(tile.factionId, count + 1);
        }

        if (tile.isContested) stats.contestedTiles++;
        if (tile.isBase) stats.baseTiles++;
      }
    }

    return stats;
  }

  /**
   * Clear the entire grid (for testing or reset)
   */
  clearGrid(): void {
    this.initializeGrid();
    this.dirtyTiles.clear();
    this.updateFactionStats();

    this.debugLog.log('Territory Grid Cleared', 'info', {
      timestamp: Date.now(),
    });
  }
}
