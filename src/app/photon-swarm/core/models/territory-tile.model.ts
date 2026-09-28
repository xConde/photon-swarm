/**
 * Territory Tile Model
 *
 * Core data structure for the faction territory system.
 * Each tile represents a 60x60 pixel area of the game world.
 *
 * IMPORTANT: This is separate from enemy types - factions control territories
 * but ALL enemy types spawn in ALL territories.
 */
import { WORLD_CONFIG } from '../../config/constants/world/world.config';
import { FACTION_IDENTITIES, KING_FACTION_IDS } from '../../config/faction-identity.config';

/**
 * Represents a single tile in the territory grid
 */
export interface FactionTerritoryTile {
  // Grid position (not pixel position)
  gridX: number;
  gridY: number;

  // Faction ownership
  factionId: number; // 0 = neutral, 1-4 = faction IDs
  ownershipStrength: number; // 0.0 to 1.0, how strongly held

  // Tile states
  isContested: boolean; // True if on border between factions
  isBase: boolean; // True if part of faction's base region
  isTransitioning: boolean; // True if changing ownership

  // Visual data for smooth transitions
  previousFactionId: number;
  transitionProgress: number; // 0.0 to 1.0

  // Gameplay effects
  buffMultiplier: number; // 1.0 normal, 2.0 in bases
  lastUpdate: number; // Timestamp of last state change
}

/**
 * Faction definition for the territory system
 */
export interface TerritoryFaction {
  id: number; // 1-4
  name: string;
  color: string; // Primary color
  baseColor: string; // Base region color
  glowColor: string; // Border glow color

  // Territory stats
  totalTiles: number;
  baseTiles: number;
  contestedTiles: number;

  // Base region center (in grid coordinates)
  baseGridX: number;
  baseGridY: number;

  // Faction personality (affects territory behavior)
  aggressiveness: number; // 0.0 to 1.0
  expansionRate: number; // Tiles per minute
  defensiveness: number; // 0.0 to 1.0
}

/**
 * Constants for the territory grid system
 */
export const TERRITORY_GRID_CONFIG = {
  // Tile dimensions
  TILE_SIZE: 60, // 60x60 pixels per tile

  // World dimensions (single-sourced from WORLD_CONFIG)
  WORLD_WIDTH: WORLD_CONFIG.BOUNDS.WIDTH,
  WORLD_HEIGHT: WORLD_CONFIG.BOUNDS.HEIGHT,

  // Grid dimensions (calculated from world/tile size)
  GRID_WIDTH: 200, // 12000 / 60
  GRID_HEIGHT: 150, // 9000 / 60
  TOTAL_TILES: 30000, // 200 * 150

  // Faction requirements
  MIN_BASE_TILES: 4500, // 15% of 30000
  MIN_TERRITORY_TILES: 3000, // 10% minimum
  MAX_TERRITORY_TILES: 12000, // 40% maximum

  // Connectivity requirements
  MIN_CLUSTER_WIDTH: 2, // Minimum 2 tiles wide
  MIN_CLUSTER_HEIGHT: 1, // or 1 tile tall (1x2 or 2x1)
  MIN_CLUSTER_SIZE: 2, // Absolute minimum tiles in a group

  // Visual settings
  TRANSITION_DURATION: 2000, // ms for ownership change
  CONTEST_PULSE_RATE: 1000, // ms for contested border pulse
  BASE_GLOW_INTENSITY: 1.5, // Multiplier for base region glow

  // Gameplay settings
  BASE_BUFF_MULTIPLIER: 2.0, // Double buffs in base regions
  CONTESTED_BUFF_MULTIPLIER: 0.5, // Half buffs on contested borders
  NEUTRAL_BUFF_MULTIPLIER: 0.0, // No buffs in neutral territory
} as const;

/**
 * Territory-specific gameplay tuning that isn't part of faction identity
 * (base location on the grid, aggressiveness/expansion/defensiveness).
 * Identity fields (name/color/baseColor/glowColor) are derived from
 * FACTION_IDENTITIES below — this table only carries what's unique to the
 * territory simulation.
 */
const TERRITORY_GAMEPLAY_BY_FACTION: Readonly<
  Record<
    number,
    Pick<TerritoryFaction, 'baseGridX' | 'baseGridY' | 'aggressiveness' | 'expansionRate' | 'defensiveness'>
  >
> = {
  1: { baseGridX: 50, baseGridY: 37, aggressiveness: 0.9, expansionRate: 2.5, defensiveness: 0.3 }, // Northwest quadrant
  2: { baseGridX: 150, baseGridY: 37, aggressiveness: 0.3, expansionRate: 2.0, defensiveness: 0.9 }, // Northeast quadrant
  3: { baseGridX: 50, baseGridY: 112, aggressiveness: 0.5, expansionRate: 3.0, defensiveness: 0.5 }, // Southwest quadrant
  4: { baseGridX: 150, baseGridY: 112, aggressiveness: 0.7, expansionRate: 2.2, defensiveness: 0.6 }, // Southeast quadrant
};

/**
 * The four factions with their unique identities
 * IMPORTANT: These are NOT enemy types - they're territorial powers
 *
 * Identity (name/color/baseColor/glowColor) is derived from FACTION_IDENTITIES
 * (config/faction-identity.config.ts) — see TERRITORY_GAMEPLAY_BY_FACTION above
 * for the territory-only fields.
 */
export const TERRITORY_FACTIONS: Readonly<TerritoryFaction[]> = KING_FACTION_IDS.map((id) => {
  const identity = FACTION_IDENTITIES[id];
  return {
    id: identity.id,
    name: identity.name,
    color: identity.dark.territory.color,
    baseColor: identity.dark.territory.baseColor,
    glowColor: identity.dark.territory.glowColor,
    totalTiles: 0,
    baseTiles: 0,
    contestedTiles: 0,
    ...TERRITORY_GAMEPLAY_BY_FACTION[id],
  };
});

/**
 * Helper type for tile coordinates
 */
export interface TileCoordinate {
  gridX: number;
  gridY: number;
}

/**
 * Helper type for world coordinates
 */
export interface WorldCoordinate {
  x: number;
  y: number;
}

/**
 * Utility functions for coordinate conversion
 */
export class TerritoryCoordinateUtils {
  /**
   * Convert world coordinates to grid coordinates
   * Clamps to valid grid bounds for edge cases
   */
  static worldToGrid(worldX: number, worldY: number): TileCoordinate {
    return {
      gridX: Math.max(
        0,
        Math.min(Math.floor(worldX / TERRITORY_GRID_CONFIG.TILE_SIZE), TERRITORY_GRID_CONFIG.GRID_WIDTH - 1)
      ),
      gridY: Math.max(
        0,
        Math.min(Math.floor(worldY / TERRITORY_GRID_CONFIG.TILE_SIZE), TERRITORY_GRID_CONFIG.GRID_HEIGHT - 1)
      ),
    };
  }

  /**
   * Convert grid coordinates to world coordinates (center of tile)
   */
  static gridToWorld(gridX: number, gridY: number): WorldCoordinate {
    return {
      x: (gridX + 0.5) * TERRITORY_GRID_CONFIG.TILE_SIZE,
      y: (gridY + 0.5) * TERRITORY_GRID_CONFIG.TILE_SIZE,
    };
  }

  /**
   * Get world bounds of a tile
   */
  static getTileBounds(
    gridX: number,
    gridY: number
  ): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    return {
      minX: gridX * TERRITORY_GRID_CONFIG.TILE_SIZE,
      minY: gridY * TERRITORY_GRID_CONFIG.TILE_SIZE,
      maxX: (gridX + 1) * TERRITORY_GRID_CONFIG.TILE_SIZE,
      maxY: (gridY + 1) * TERRITORY_GRID_CONFIG.TILE_SIZE,
    };
  }

  /**
   * Check if grid coordinates are valid
   */
  static isValidGridCoordinate(gridX: number, gridY: number): boolean {
    return (
      gridX >= 0 && gridX < TERRITORY_GRID_CONFIG.GRID_WIDTH && gridY >= 0 && gridY < TERRITORY_GRID_CONFIG.GRID_HEIGHT
    );
  }

  /**
   * Get neighboring tiles (4-connected)
   */
  static getNeighbors(gridX: number, gridY: number): TileCoordinate[] {
    const neighbors: TileCoordinate[] = [];
    const offsets = [
      { dx: 0, dy: -1 }, // North
      { dx: 1, dy: 0 }, // East
      { dx: 0, dy: 1 }, // South
      { dx: -1, dy: 0 }, // West
    ];

    for (const { dx, dy } of offsets) {
      const newX = gridX + dx;
      const newY = gridY + dy;
      if (this.isValidGridCoordinate(newX, newY)) {
        neighbors.push({ gridX: newX, gridY: newY });
      }
    }

    return neighbors;
  }

  /**
   * Get all neighbors including diagonals (8-connected)
   */
  static getAllNeighbors(gridX: number, gridY: number): TileCoordinate[] {
    const neighbors: TileCoordinate[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const newX = gridX + dx;
        const newY = gridY + dy;
        if (this.isValidGridCoordinate(newX, newY)) {
          neighbors.push({ gridX: newX, gridY: newY });
        }
      }
    }

    return neighbors;
  }

  /**
   * Calculate Manhattan distance between two tiles
   */
  static manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
  }

  /**
   * Calculate Euclidean distance between two tiles
   */
  static euclideanDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  }
}
