/**
 * AI Behavior Configuration
 *
 * Defines enemy AI behavior systems including combat AI, separation/flocking,
 * and idle behaviors (patrol, dance, social interactions).
 *
 * Systems:
 * - AI_BEHAVIOR: Core combat AI (chase, attack, patrol)
 * - SEPARATION: Flocking behavior to prevent enemy stacking
 * - IDLE_BEHAVIOR: Non-combat behaviors (dance, socialize, patrol)
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface AIBehaviorConfig {
  readonly BEHAVIOR_UPDATE_INTERVAL: number;
  readonly COMBAT_RANGE: number;
  readonly PATROL_RANGE: number;
  readonly CHASE_RANGE: number;
  readonly ATTACK_COOLDOWN_MS: number;
}

export interface EnemySeparationConfig {
  readonly ENABLED: boolean;
  readonly SEPARATION_RADIUS: number;
  readonly SEPARATION_WEIGHT: number;
  readonly CLEANUP_SAFE_DISTANCE: number;
}

export interface IdleBehaviorConfig {
  readonly IDLE_DISTANCE: number;
  readonly SOCIAL_DISTANCE: number;
  readonly DANCE_DISTANCE: number;
  readonly PATROL_RADIUS: number;
  readonly UPDATE_INTERVAL: number;
  readonly CLEANUP_INTERVAL: number;
  readonly MAX_DANCE_PARTNERS: number;
  readonly MAX_PATROL_ROUTES: number;
  readonly SPATIAL_GRID_CELL_SIZE: number;
  readonly FACTION_PATROL: {
    readonly [factionId: number]: {
      readonly speed: number;
      readonly radius: number;
    };
  };
  readonly FACTION_WANDER_SPEED: {
    readonly zigzag: number;
    readonly circular: number;
    readonly organic: number;
    readonly erratic: number;
    readonly default: number;
  };
  readonly DANCE: {
    readonly MIN_DURATION: number;
    readonly MAX_DURATION: number;
    readonly BOUNCE_FREQUENCY: number;
    readonly SPIN_RADIUS: number;
    readonly CHANCE: number;
  };
  readonly SOCIAL: {
    readonly GROUP_SIZE: number;
    readonly GROUP_DISTANCE: number;
    readonly APPROACH_SPEED: number;
    readonly CHANCE: number;
  };
  readonly PATROL: {
    readonly CHANCE: number;
    readonly ROTATION_SPEED: number;
    readonly MOVEMENT_SPEED: number;
  };
}

// =============================================================================
// AI BEHAVIOR CONFIGURATION
// =============================================================================

/**
 * Core AI Behavior - Combat behaviors
 *
 * TUNED: Update interval reduced from 15 to 5 frames for more responsive AI.
 * At 60fps: 15 frames = 250ms (sluggish), 5 frames = 83ms (responsive).
 */
export const AI_BEHAVIOR_CONFIG: AIBehaviorConfig = {
  /** Update behaviors every N frames for performance (5 = ~83ms at 60fps) */
  BEHAVIOR_UPDATE_INTERVAL: 5,
  /** Distance for combat engagement */
  COMBAT_RANGE: 200,
  /** Distance for patrol behavior */
  PATROL_RANGE: 300,
  /** Distance to start chasing player */
  CHASE_RANGE: 400,
  /** Minimum time between attacks */
  ATTACK_COOLDOWN_MS: 1000,
} as const;

/**
 * Enemy Separation - BALANCED separation to prevent stacking while allowing approach
 *
 * HALLS OF TORMENT STYLE: Enemies should swarm and APPROACH the player,
 * spreading out to surround rather than stacking on one point.
 *
 * - Radius: 50px - only when actually overlapping
 * - Weight: 0.8 (80%) - strong but not overpowering chase behavior
 * - Hard push handles actual overlap, this handles spreading
 */
export const ENEMY_SEPARATION_CONFIG: EnemySeparationConfig = {
  /** Enable separation system */
  ENABLED: true,
  /** Distance at which enemies start separating - small to only affect overlaps */
  SEPARATION_RADIUS: 50,
  /** Weight of separation force (80% - strong but allows chase to dominate) */
  SEPARATION_WEIGHT: 0.8,
  /** Enemies stay within this distance of player */
  CLEANUP_SAFE_DISTANCE: 1500,
} as const;

/**
 * Idle Behavior - Non-combat behaviors (dance, socialize, patrol)
 */
export const IDLE_BEHAVIOR_CONFIG: IdleBehaviorConfig = {
  // Distance thresholds
  /** Distance from player to be considered idle - must be > visible screen area (~600px from center)
   *  to prevent enemies from appearing "stuck" while dancing/socializing on screen.
   *  Set to 1000 so enemies only idle when well off-screen. */
  IDLE_DISTANCE: 1000,
  /** Distance for social interactions */
  SOCIAL_DISTANCE: 100,
  /** Distance to start dancing */
  DANCE_DISTANCE: 80,
  /** Radius for patrol routes */
  PATROL_RADIUS: 300,

  // Update intervals
  /** Update idle behaviors every N milliseconds (250ms = 4x/sec for responsive behavior changes) */
  UPDATE_INTERVAL: 250,
  /** Clean up stale entities every N milliseconds */
  CLEANUP_INTERVAL: 30000,

  // Map size limits
  /** Maximum number of dance partner pairs */
  MAX_DANCE_PARTNERS: 100,
  /** Maximum number of patrol routes */
  MAX_PATROL_ROUTES: 100,

  // Spatial partitioning
  /** Size of each spatial grid cell for optimization */
  SPATIAL_GRID_CELL_SIZE: 200,

  // Faction-specific patrol configurations
  FACTION_PATROL: {
    1: { speed: 0.03, radius: 0.8 }, // Crimson - faster, tighter
    2: { speed: 0.015, radius: 1.2 }, // Azure - slower, wider
    3: { speed: 0.02, radius: 1.0 }, // Verdant - normal
    4: { speed: 0.025, radius: 0.9 }, // Golden - slightly faster
  },

  // Faction-specific wander speeds
  FACTION_WANDER_SPEED: {
    zigzag: 0.7,
    circular: 0.5,
    organic: 0.6,
    erratic: 0.9,
    default: 0.5,
  },

  // Dance configuration
  DANCE: {
    /** Minimum dance duration in seconds */
    MIN_DURATION: 3,
    /** Maximum dance duration in seconds */
    MAX_DURATION: 5,
    /** Bounce animation frequency */
    BOUNCE_FREQUENCY: 4,
    /** Radius for spin dance */
    SPIN_RADIUS: 50,
    /** Probability to dance when near allies (30%) */
    CHANCE: 0.3,
  },

  // Social behavior
  SOCIAL: {
    /** Maximum entities in a social group */
    GROUP_SIZE: 4,
    /** Distance to maintain in group */
    GROUP_DISTANCE: 60,
    /** Speed when approaching group */
    APPROACH_SPEED: 0.5,
    /** Probability to socialize (40%) */
    CHANCE: 0.4,
  },

  // Patrol behavior
  PATROL: {
    /** Probability to patrol (30%) */
    CHANCE: 0.3,
    /** Default patrol angle increment */
    ROTATION_SPEED: 0.02,
    /** Speed when moving to patrol point */
    MOVEMENT_SPEED: 0.8,
  },
} as const;
