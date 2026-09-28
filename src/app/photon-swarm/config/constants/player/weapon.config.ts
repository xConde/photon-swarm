/**
 * Player Weapon Configuration
 *
 * Defines all player weapon systems:
 * - BEAM: Rotating melee beam weapon
 * - DISCHARGE: Area-of-effect explosion ability
 * - CHARGED_PROJECTILE: Charged shot with visual effects
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface WeaponConfig {
  readonly DAMAGE: number;
  readonly FIRE_RATE: number;
  readonly PROJECTILE_SPEED: number;
  readonly LENGTH: number;
  readonly WIDTH: number;
}

export interface DischargeWeaponConfig {
  readonly RADIUS: number;
  readonly DAMAGE: number;
  readonly COOLDOWN_MS: number;
  readonly KNOCKBACK_FORCE: number;
  readonly DAMAGE_FALLOFF: boolean;
}

export interface ChargedProjectileConfig {
  readonly BASE_DAMAGE_MULTIPLIER: number;
  readonly CHARGE_THRESHOLD: number;
  readonly MAX_SIZE_MULTIPLIER: number;
  readonly PULSE_FREQUENCY: number;
  readonly TRAIL_THRESHOLD: number;
  readonly VISUALS: {
    readonly TRAIL: {
      readonly SPAWN_CHANCE: number;
      readonly INTENSITY_SCALE: number;
      readonly POSITION_OFFSET: number;
    };
    readonly IMPACT: {
      readonly MIN_INTENSITY: number;
      readonly MAX_INTENSITY: number;
      readonly SHAKE_THRESHOLD: number;
      readonly SHAKE_INTENSITY_MULTIPLIER: number;
      readonly SHAKE_BASE_DURATION: number;
      readonly SHAKE_DURATION_MULTIPLIER: number;
      readonly SHAKE_FREQUENCY: number;
      readonly CHROMATIC_THRESHOLD: number;
      readonly CHROMATIC_INTENSITY: number;
      readonly CHROMATIC_DURATION: number;
    };
    readonly RING: {
      readonly MIN_ALPHA: number;
      readonly MAX_ALPHA: number;
      readonly ALPHA_SCALE: number;
      readonly MIN_RADIUS_MULTIPLIER: number;
      readonly MAX_RADIUS_MULTIPLIER: number;
      readonly RADIUS_SCALE: number;
      readonly LINE_WIDTH: number;
    };
    readonly HIT_FLASH: {
      readonly PROJECTILE_DURATION: number;
      readonly BEAM_DURATION: number;
      readonly DAMAGE_SCALE_DIVISOR: number;
      readonly MAX_INTENSITY: number;
      readonly BEAM_INTENSITY_MULTIPLIER: number;
      readonly PROJECTILE_COLOR: string;
      readonly BEAM_COLOR: string;
    };
  };
}

// =============================================================================
// WEAPON CONFIGURATION
// =============================================================================

export const WEAPON_CONFIG = {
  /**
   * Rotating beam (primary weapon)
   * TUNED: Increased damage for faster kills (one-shot basic enemies)
   */
  BEAM: {
    /** Damage per hit - buffed to reward riskier projectile play over passive beam */
    DAMAGE: 70,
    /** Time between shots in milliseconds - 2 shots/sec for snappier projectile combat */
    FIRE_RATE: 500,
    /** Player projectile travel speed in pixels/second */
    PROJECTILE_SPEED: 750,
    /** Beam length in pixels */
    LENGTH: 1000,
    /** Beam width in pixels */
    WIDTH: 30,
  } as WeaponConfig,

  /**
   * Area-of-effect discharge explosion
   * TUNED: Stronger screen-clear ability for VS-like power fantasy
   */
  DISCHARGE: {
    /** Explosion radius in pixels */
    RADIUS: 250,
    /** Base damage per enemy hit (charge scales 0.5x–1.5x) */
    DAMAGE: 120,
    /** Cooldown between uses in milliseconds */
    COOLDOWN_MS: 8000,
    /** Force applied to push enemies away */
    KNOCKBACK_FORCE: 500,
    /** Whether damage decreases with distance from center */
    DAMAGE_FALLOFF: true,
  } as DischargeWeaponConfig,

  /**
   * Charged projectile shot (secondary weapon)
   */
  CHARGED_PROJECTILE: {
    /** Damage multiplier when fully charged (150% boost at full charge) */
    BASE_DAMAGE_MULTIPLIER: 2.5,
    /** Minimum charge percentage to be considered "charged" (40%) */
    CHARGE_THRESHOLD: 0.4,
    /** Maximum size increase when fully charged (20% larger, reduced from 1.6 to prevent giant orbs) */
    MAX_SIZE_MULTIPLIER: 1.2,
    /** Pulse animation speed */
    PULSE_FREQUENCY: 8,
    /** Charge percentage needed for particle trails (70%) */
    TRAIL_THRESHOLD: 0.7,

    /**
     * Visual effect configuration
     */
    VISUALS: {
      /**
       * Particle trail effects
       */
      TRAIL: {
        /** Probability per frame to spawn a trail particle (30%) */
        SPAWN_CHANCE: 0.3,
        /** Scale factor for trail particle intensity */
        INTENSITY_SCALE: 0.3,
        /** Multiplier for velocity-based trail offset */
        POSITION_OFFSET: 0.1,
      },

      /**
       * Impact explosion effects
       */
      IMPACT: {
        /** Minimum explosion intensity */
        MIN_INTENSITY: 0.5,
        /** Maximum explosion intensity */
        MAX_INTENSITY: 1.0,
        /** Charge level required for screen shake (70%) */
        SHAKE_THRESHOLD: 0.7,
        /** Multiplier for shake intensity (5.6-8 range) */
        SHAKE_INTENSITY_MULTIPLIER: 8,
        /** Base shake duration in milliseconds */
        SHAKE_BASE_DURATION: 200,
        /** Additional duration based on charge level in milliseconds */
        SHAKE_DURATION_MULTIPLIER: 100,
        /** Shake frequency */
        SHAKE_FREQUENCY: 10,
        /** Charge level required for chromatic aberration effect (90%) */
        CHROMATIC_THRESHOLD: 0.9,
        /** Chromatic aberration effect intensity */
        CHROMATIC_INTENSITY: 0.8,
        /** Chromatic aberration effect duration in milliseconds */
        CHROMATIC_DURATION: 150,
      },

      /**
       * Charging ring visual indicator
       */
      RING: {
        /** Minimum ring transparency */
        MIN_ALPHA: 0.5,
        /** Maximum ring transparency */
        MAX_ALPHA: 0.8,
        /** Scale factor for alpha based on charge level */
        ALPHA_SCALE: 0.3,
        /** Minimum ring radius multiplier */
        MIN_RADIUS_MULTIPLIER: 1.5,
        /** Maximum ring radius multiplier */
        MAX_RADIUS_MULTIPLIER: 2.0,
        /** Scale factor for radius based on charge level */
        RADIUS_SCALE: 0.5,
        /** Ring stroke width in pixels */
        LINE_WIDTH: 2,
      },

      /**
       * Hit flash effect when damaging enemies
       */
      HIT_FLASH: {
        /** Flash duration for projectile hits in milliseconds */
        PROJECTILE_DURATION: 150,
        /** Flash duration for beam hits in milliseconds (shorter for continuous damage) */
        BEAM_DURATION: 100,
        /** Divisor for converting damage to intensity (50 damage = 1.0 intensity) */
        DAMAGE_SCALE_DIVISOR: 50,
        /** Maximum flash intensity */
        MAX_INTENSITY: 1.0,
        /** Beam max intensity multiplier to reduce visual noise */
        BEAM_INTENSITY_MULTIPLIER: 0.6,
        /** White flash color for projectiles */
        PROJECTILE_COLOR: '#ffffff',
        /** Purple tint color for beam */
        BEAM_COLOR: '#ffccff',
      },
    },
  } as ChargedProjectileConfig,
} as const;
