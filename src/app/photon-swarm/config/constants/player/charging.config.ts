/**
 * Player Charging & Animation Configuration
 *
 * Defines charging mechanics, visual effects, and animation parameters:
 * - CHARGING: Charge accumulation rates and visual properties
 * - ANIMATION: Beam rotation speeds and charged rotation effects
 * - COOLDOWN_ACCELERATION: Idle multipliers for faster ability recovery
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ChargingConfig {
  readonly MOVEMENT_DECAY_RATE: number;
  readonly FOCUS_DECAY_RATE: number;
  readonly VISUAL_CONVERSION_FACTOR: number;
  readonly VISUAL: {
    readonly MIN_RADIUS: number;
    readonly MAX_RADIUS: number;
    readonly PULSE_AMOUNT: number;
    readonly GLOW_MULTIPLIER: number;
    readonly MAX_SAFETY_RADIUS: number;
  };
}

export interface AnimationConfig {
  readonly PASSIVE_BEAM_ROTATION_SPEED: number;
  readonly IDLE_ROTATION_MULTIPLIER: number;
  readonly MOVING_ROTATION_MULTIPLIER: number;
  readonly IDLE_RAMP_TIME_MS: number;
  readonly MIN_IDLE_MULTIPLIER: number;
  readonly MAX_IDLE_MULTIPLIER: number;
  readonly CHARGED_ROTATION: {
    readonly MIN_MULTIPLIER: number;
    readonly MID_MULTIPLIER: number;
    readonly MAX_MULTIPLIER: number;
    readonly CHARGE_THRESHOLD: number;
    readonly VISUAL_BLUR_THRESHOLD: number;
    readonly MAX_BLUR_TRAILS: number;
    readonly INDICATOR: {
      readonly ACTIVATION_THRESHOLD: number;
      readonly MIN_RADIUS: number;
      readonly MAX_RADIUS: number;
      readonly MIN_OPACITY: number;
      readonly MAX_OPACITY: number;
      readonly LINE_WIDTH_MIN: number;
      readonly LINE_WIDTH_MAX: number;
      readonly DASH_PATTERN: readonly number[];
    };
  };
}

export interface CooldownAccelerationConfig {
  readonly DISCHARGE_IDLE_MULTIPLIER: number;
  readonly MOVEMENT_THRESHOLD: number;
}

export interface DischargeChargingConfig {
  readonly MAX_CHARGE_DURATION_MS: number;
}

export interface TouchAimConfig {
  /** After the aim stick is released, idle spin stays OFF for this many ms before resuming. */
  readonly AIM_IDLE_SPIN_GRACE_MS: number;
}

// =============================================================================
// CHARGING CONFIGURATION
// =============================================================================

export const CHARGING_CONFIG = {
  /**
   * Charge accumulation rates
   */
  CHARGING: {
    /** Charge decay rate when stationary (units per frame: ~90 units/second at 60fps) */
    MOVEMENT_DECAY_RATE: 1.5,
    /** Charge decay rate when moving (units per frame: ~90 units/second at 60fps) */
    FOCUS_DECAY_RATE: 1.5,
    /** Convert 0-100 charge value to 0-1 for visual rendering */
    VISUAL_CONVERSION_FACTOR: 100,

    /**
     * Visual effects for charging orb
     */
    VISUAL: {
      /** Starting radius for charging orb in pixels (smaller than player) */
      MIN_RADIUS: 5,
      /** Maximum radius for charging orb in pixels (still smaller than player) */
      MAX_RADIUS: 12,
      /** Amount of pulsing animation */
      PULSE_AMOUNT: 0.05,
      /** How much larger the glow is than the orb */
      GLOW_MULTIPLIER: 1.2,
      /** Emergency cap to prevent screen-sized orbs */
      MAX_SAFETY_RADIUS: 30,
    },
  } as ChargingConfig,

  /**
   * Beam rotation and visual effects
   */
  ANIMATION: {
    /** Base passive beam rotation speed in radians per frame */
    PASSIVE_BEAM_ROTATION_SPEED: 0.002,
    /** Rotation speed multiplier when idle (normal speed) */
    IDLE_ROTATION_MULTIPLIER: 1.0,
    /** Rotation speed multiplier when moving */
    MOVING_ROTATION_MULTIPLIER: 1.0,
    /** Time to reach max blade speed boost in milliseconds (45% slower than previous) */
    IDLE_RAMP_TIME_MS: 2250,
    /** Starting multiplier for idle rotation (normal speed) */
    MIN_IDLE_MULTIPLIER: 1.0,
    /** Maximum multiplier for idle rotation (180% speed, reduced from 245%) */
    MAX_IDLE_MULTIPLIER: 1.8,

    /**
     * Enhanced rotation for charged melee
     */
    CHARGED_ROTATION: {
      /** Rotation speed at 0% charge (normal speed) */
      MIN_MULTIPLIER: 1.0,
      /** Rotation speed at 50% charge (3x speed) */
      MID_MULTIPLIER: 3.0,
      /** Rotation speed at 100% charge (6x speed - hyperdrive blender mode) */
      MAX_MULTIPLIER: 6.0,
      /** Start speed boost at 5% charge (earlier feedback) */
      CHARGE_THRESHOLD: 0.05,
      /** Start blur effects at 30% charge for better feedback */
      VISUAL_BLUR_THRESHOLD: 0.3,
      /** Number of trail segments for motion blur (slightly more for dramatic effect) */
      MAX_BLUR_TRAILS: 4,

      /**
       * Rotation indicator ring
       */
      INDICATOR: {
        /** Show indicator above this speed multiplier */
        ACTIVATION_THRESHOLD: 1.2,
        /** Starting radius in pixels */
        MIN_RADIUS: 25,
        /** Maximum radius in pixels */
        MAX_RADIUS: 40,
        /** Minimum ring opacity */
        MIN_OPACITY: 0.15,
        /** Maximum ring opacity */
        MAX_OPACITY: 0.4,
        /** Minimum line thickness in pixels */
        LINE_WIDTH_MIN: 1,
        /** Maximum line thickness in pixels */
        LINE_WIDTH_MAX: 3,
        /** Dashed line pattern [dash length, gap length] */
        DASH_PATTERN: [5, 10],
      },
    },
  } as AnimationConfig,

  /**
   * Cooldown acceleration when idle
   */
  COOLDOWN_ACCELERATION: {
    /** Discharge cooldown multiplier when idle (3x faster) */
    DISCHARGE_IDLE_MULTIPLIER: 3,
    /** Movement threshold in pixels for significant movement detection */
    MOVEMENT_THRESHOLD: 5,
  } as CooldownAccelerationConfig,

  /**
   * Discharge charging mechanics
   */
  DISCHARGE_CHARGING: {
    /** Maximum charge duration in milliseconds (1.5 seconds to full charge) */
    MAX_CHARGE_DURATION_MS: 1500,
  } as DischargeChargingConfig,

  /**
   * Touch aim grace window
   */
  TOUCH_AIM: {
    /**
     * Grace window after the aim stick is released before idle spin resumes (ms).
     * Touch: player-controlled aim wins; idle sweep resumes only after this delay.
     * Desktop: cursor owns the angle — this config is irrelevant on desktop.
     */
    AIM_IDLE_SPIN_GRACE_MS: 4000,
  } as TouchAimConfig,
} as const;
