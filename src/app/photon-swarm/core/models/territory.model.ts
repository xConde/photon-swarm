/**
 * Territory Tile Model
 *
 * Represents a single tile in the Four Kings territory system.
 * Used for deterministic world generation and save/load functionality.
 */
export interface TerritoryTile {
  // Position
  x: number;
  y: number;

  // Ownership
  kingId: number; // 0 = neutral, 1-4 = king IDs
  strength: number; // 0-100, how strongly this tile belongs to a king (100 = base/unbreakable, 10 = minimum)
  age: number; // How long this tile has belonged to current king
  contested: boolean; // True if near border with another kingdom

  // Infrastructure
  isRoad?: boolean; // True if this tile is part of a road network
  roadConnections?: number; // Bitmask of road connections (N=1, E=2, S=4, W=8)
  distanceFromCapital?: number; // Distance from the king's capital/center

  // Visual properties (optional, for rendering optimization)
  colorVariant?: number; // 0-1, for color tone variation within faction
  hasStructure?: boolean; // True if has buildings/fortifications

  // Metadata (for optimization)
  lastUpdated?: number; // Timestamp of last territory change
  hash?: string; // Quick hash for change detection
}

/**
 * King Configuration
 *
 * Defines the behavior and appearance of each of the Four Kings
 */
export interface KingConfig {
  id: number;
  name: string;
  color: string;
  baseColor: string;
  glowColor: string;
  expansionStyle: 'aggressive' | 'defensive' | 'organic' | 'opportunistic';
  expansionRate: number; // Base tiles per expansion round
  clusterTendency: number; // 0-1, how much they prefer to expand near existing tiles
  warlikeness: number; // 0-1, how likely to expand into contested areas
}

/**
 * Territory Generation Configuration
 *
 * Parameters for world generation
 */
export interface TerritoryGenerationConfig {
  worldSeed: string;
  kingCount: number;
  worldBounds: { width: number; height: number };
  tileSize: number;
  gridWidth: number;
  gridHeight: number;
}

/**
 * Generated World Data
 *
 * Complete world state that can be serialized for save/load
 */
export interface GeneratedWorld {
  seed: string;
  hash: string; // SHA-256 of the generated world
  territories: (TerritoryTile | null)[][];
  kingStartPositions: Array<{ x: number; y: number; kingId: number }>;
  kingConfigs: KingConfig[];
  generationMetadata: {
    timestamp: number;
    version: string;
    gridSize: { width: number; height: number };
    totalTiles: number;
    generationTime: number; // milliseconds
  };
}

/**
 * Chunk Data for Performance Optimization
 *
 * Represents a square chunk of territory tiles for lazy loading
 */
export interface TerritoryChunk {
  chunkX: number;
  chunkY: number;
  chunkSize: number;
  tiles: (TerritoryTile | null)[][];
  isGenerated: boolean;
  isVisible: boolean;
  lastAccessed: number;
  hash: string;
}
