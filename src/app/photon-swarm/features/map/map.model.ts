/**
 * Map Feature Models
 *
 * Shared type definitions for the map and minimap rendering systems.
 */

export interface Territory {
  x: number;
  y: number;
  kingId: number;
  color?: string;
  type?: string;
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}

export interface MapEntities {
  enemies: Array<{
    x: number;
    y: number;
    threat: 'normal' | 'elite' | 'boss';
    health?: number;
  }>;
  items: Array<{
    x: number;
    y: number;
    rarity?: string;
    type?: 'powerup' | 'shard';
  }>;
  asteroids?: Array<{
    x: number;
    y: number;
    state?: string;
  }>;
}

export interface MinimapEntities {
  enemies?: Array<{
    x: number;
    y: number;
    type: 'normal' | 'elite' | 'boss';
  }>;
  items?: Array<{
    x: number;
    y: number;
    rarity: string;
    type?: 'powerup' | 'shard';
  }>;
  /** Spawn warnings - directions where enemies are approaching from */
  spawnWarnings?: Array<{
    direction: 'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest';
    intensity: number; // 0-1, based on number/threat of enemies
    waveType?: 'normal' | 'swarm' | 'elite';
  }>;
}
