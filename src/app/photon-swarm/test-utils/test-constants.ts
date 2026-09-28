/**
 * Centralized test constants that reference game constants
 * This ensures tests use the same values as production code
 */
import {
  DAMAGE_CONFIG,
  ENEMY_STATS,
  FOCUS_CHARGING_CONFIG,
  PLAYER_CONFIG,
  POOL_CONFIG,
  WORLD_CONFIG,
} from '@photon/config/game-constants';

// Player speeds with upgrades
export const TEST_PLAYER_SPEEDS = {
  BASE: PLAYER_CONFIG.PHYSICS.BASE_SPEED,
  MAX_UPGRADED: PLAYER_CONFIG.PHYSICS.BASE_SPEED * 3, // Assuming 3x speed upgrades
  DASH: (PLAYER_CONFIG.ABILITIES.DASH.SPEED_MULTIPLIER || 5) * PLAYER_CONFIG.PHYSICS.BASE_SPEED,
} as const;

// World dimensions
export const TEST_WORLD = {
  WIDTH: WORLD_CONFIG.BOUNDS.WIDTH,
  HEIGHT: WORLD_CONFIG.BOUNDS.HEIGHT,
  SPAWN_MARGIN: WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN,
} as const;

// Common canvas sizes for testing
export const TEST_CANVAS_SIZES = {
  DESKTOP: { width: 1920, height: 1080 },
  TABLET: { width: 1024, height: 768 },
  MOBILE: { width: 375, height: 812 },
} as const;

// Enemy configurations for testing
export const TEST_ENEMIES = {
  BASIC: ENEMY_STATS.basic,
  ELITE_TANK: {
    ...ENEMY_STATS.tank,
    HEALTH: ENEMY_STATS.tank.HEALTH * 2, // Elite multiplier
    DAMAGE: ENEMY_STATS.tank.DAMAGE * 1.5,
  },
} as const;

// Charging test values
export const TEST_CHARGING = {
  DAMAGE_REDUCTION: FOCUS_CHARGING_CONFIG.FOCUS_DAMAGE_REDUCTION,
  FULL_CHARGE_TIME_MS: 2500, // ~2.5s to full charge
  DECAY_TIME_MS: 1000, // 1s from full to empty
} as const;

// Damage test values
export const TEST_DAMAGE = {
  MAX_PER_FRAME: DAMAGE_CONFIG.MAX_DAMAGE_PER_FRAME,
  IMMUNITY_MS: DAMAGE_CONFIG.PLAYER_DAMAGE_IMMUNITY_MS,
  COLLISION_IMMUNITY_MS: DAMAGE_CONFIG.COLLISION_IMMUNITY_DURATION_MS,
} as const;

// Pool test values
export const TEST_POOLS = {
  SIZES: POOL_CONFIG.MAX_SIZES,
  INITIAL: POOL_CONFIG.INITIAL_SIZE,
  GROW_BY: POOL_CONFIG.GROW_BY,
} as const;

// Common test durations
export const TEST_DURATIONS = {
  FRAME_MS: 16.67, // 60 FPS
  SECOND_MS: 1000,
  TICK_MS: 50, // Common update interval
  ANIMATION_MS: 300, // Typical animation duration
} as const;

// Helper to create predictable test timestamps
export class TestTimeProvider {
  private currentTime = 0;

  constructor(startTime: number = 0) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): number {
    this.currentTime += ms;
    return this.currentTime;
  }

  reset(time: number = 0): void {
    this.currentTime = time;
  }
}
