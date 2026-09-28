/**
 * Player Ability Configuration
 *
 * Defines player special abilities:
 * - DIRECTION_CHANGE: Quick rotation direction reversal
 * - DASH: Short-range teleport with invincibility
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface AbilityConfig {
  readonly COOLDOWN_MS: number;
  readonly DURATION_MS?: number;
  readonly ACTIVE_DURATION_MS?: number;
  readonly MAX_ROTATION_SPEED_RAD_PER_FRAME?: number;
  readonly RADIUS?: number;
  readonly SPEED_MULTIPLIER?: number;
  readonly INVINCIBILITY_DURATION_MS?: number;
  readonly DAMAGE?: number;
}

// =============================================================================
// ABILITY CONFIGURATION
// =============================================================================

export const ABILITY_CONFIG = {
  /**
   * Direction Change - Reverses beam rotation direction
   */
  DIRECTION_CHANGE: {
    /** Cooldown reduced from 1200ms for more responsive direction changes (50% faster) */
    COOLDOWN_MS: 600,
    /** Duration the ability remains active in milliseconds */
    ACTIVE_DURATION_MS: 1000,
    /** Maximum rotation speed in radians per frame (increased from 0.055 for 36% faster rotation: 257°/sec at 60fps) */
    MAX_ROTATION_SPEED_RAD_PER_FRAME: 0.075,
  } as AbilityConfig,

  /**
   * Dash - Short-range teleport with invincibility frames
   * Now deals damage to enemies passed through (Offensive Dash)
   */
  DASH: {
    /** Time between dashes in milliseconds */
    COOLDOWN_MS: 5000,
    /** Duration of the dash movement in milliseconds */
    DURATION_MS: 100,
    /** Movement speed multiplier during dash (nerfed 10% from 5.0) */
    SPEED_MULTIPLIER: 4.5,
    /** Duration of invincibility after dash in milliseconds */
    INVINCIBILITY_DURATION_MS: 1000,
    /** Damage dealt to enemies when dashing through them */
    DAMAGE: 50,
  } as AbilityConfig,

  /**
   * Parry - Reflect enemy projectiles back at them
   * Timing-based skill mechanic - press E to parry
   */
  PARRY: {
    /** Time between parry attempts in milliseconds */
    COOLDOWN_MS: 1500,
    /** Duration of the parry window in milliseconds (must time within this) */
    DURATION_MS: 300,
  } as AbilityConfig,
} as const;

/**
 * Focus Fire Configuration
 *
 * Toggle Shift in shooting mode for precision auto-targeting.
 * Trades mobility for damage output and accuracy.
 */
export const FOCUS_FIRE_CONFIG = {
  /** Damage multiplier applied to projectiles during Focus Fire */
  DAMAGE_MULTIPLIER: 1.5,
  /** Fire rate multiplier (< 1 = slower) */
  FIRE_RATE_MULTIPLIER: 0.6,
  /** Burst spread angle in radians during Focus Fire (normal = 0.1) */
  SPREAD_ANGLE: 0.03,
  /** Normal burst spread angle in radians */
  NORMAL_SPREAD_ANGLE: 0.1,

  /** Speed penalty upgrade config */
  SPEED_PENALTY: {
    /** Base penalty (0.20 = 20% slower) */
    BASE: 0.2,
    /** Penalty reduction per upgrade level */
    REDUCTION_PER_LEVEL: 0.05,
    /** Maximum upgrade levels */
    MAX_LEVEL: 3,
    /** Minimum penalty floor (0.05 = 5% slower) */
    MIN: 0.05,
  },

  /** Visual colors */
  COLORS: {
    PROJECTILE: '#ff8c00',
    AIM_LINE: '#ff8c00',
    AIM_DOT: '#cc6f00',
  },
} as const;
