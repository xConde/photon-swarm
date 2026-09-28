/**
 * World Configuration
 *
 * Defines the game world dimensions and spawn margins for entities.
 * These constants determine the playable area and boundaries for collision detection.
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface WorldBounds {
  readonly WIDTH: number;
  readonly HEIGHT: number;
}

export interface SpawnMargins {
  readonly BOUNDARY_DAMAGE_MARGIN: number;
  readonly CLEANUP_MARGIN: number;
  readonly ASTEROID_SPAWN_OFFSET: number;
}

// =============================================================================
// WORLD CONFIGURATION
// =============================================================================

/**
 * Core world configuration
 *
 * BOUNDS: Defines the playable world dimensions (12000x9000 pixels)
 * SPAWN_MARGINS:
 *   - BOUNDARY_DAMAGE_MARGIN: Distance from edge where boundary damage begins (50px)
 *   - CLEANUP_MARGIN: Distance beyond bounds where entities are destroyed (200px)
 *   - ASTEROID_SPAWN_OFFSET: Offset from edge for asteroid spawning (50px)
 */
export const WORLD_CONFIG: {
  readonly BOUNDS: WorldBounds;
  readonly SPAWN_MARGINS: SpawnMargins;
} = {
  BOUNDS: {
    WIDTH: 12000,
    HEIGHT: 9000,
  },
  SPAWN_MARGINS: {
    BOUNDARY_DAMAGE_MARGIN: 50,
    CLEANUP_MARGIN: 200,
    ASTEROID_SPAWN_OFFSET: 50,
  },
} as const;
