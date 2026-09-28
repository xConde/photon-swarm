/**
 * Environment Configuration
 *
 * Defines environmental hazards and dangers in the game world:
 * - Hazard Zones: Static dangerous areas that deal damage over time
 * - Void Storm: Periodic world-wide damage events
 * - World Boundary: Damage at the edges of the playable area
 * - Asteroids: Falling space debris
 */

// =============================================================================
// ENVIRONMENT CONFIGURATION
// =============================================================================

export const ENVIRONMENT_CONFIG = {
  HAZARD_ZONES: {
    DEFAULT_COUNT: 3, // Rare ground zones — falling data cores are the primary powerup delivery
    RADIUS: 200,
    DAMAGE_PER_SECOND: 2.5, // Reduced from 5 for better balance (40 seconds to kill)
  },
  VOID_STORM: {
    INTERVAL_MS: 120000, // Increased from 60s to 2 minutes
    DURATION_MS: 8000, // Reduced from 10s to 8s
    DAMAGE_PER_SECOND: 5, // Reduced from 10 for better balance
  },
  WORLD_BOUNDARY: {
    DAMAGE_PER_SECOND: 20,
  },
  ASTEROID: {
    SPAWN_RATE_PER_SECOND: 0.5,
    MAX_CONCURRENT: 12, // Cap ambient asteroids so the field doesn't flood at 0.5/s
    SIZE_RANGE: {
      MIN: 20,
      MAX: 60,
    },
    SPEED_RANGE: {
      MIN: 50,
      MAX: 150,
    },
    DAMAGE: 15,
  },
} as const;
