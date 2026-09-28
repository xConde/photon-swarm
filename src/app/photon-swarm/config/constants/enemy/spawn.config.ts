/**
 * Spawn System Configuration
 *
 * Controls enemy spawn mechanics including timing, limits, clustering,
 * rarity distribution, and enemy type weights.
 *
 * Key Systems:
 * - TIMING: Spawn rate progression based on level
 * - LIMITS: Performance and gameplay constraints
 * - CLUSTER: Spatial clustering for varied encounters
 * - RARITY: Elite chance and drop rarity weights
 * - ENEMY_TYPE_WEIGHTS: Relative spawn probabilities per enemy type
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface SpawnTiming {
  readonly BASE_SPAWN_RATE_MS: number;
  readonly RATE_INCREASE_PER_LEVEL_MS: number;
  readonly MIN_SPAWN_RATE_MS: number;
  readonly INITIAL_SPAWN_DELAY_MS: number;
}

export interface SpawnLimits {
  readonly MAX_ENEMIES: number;
  readonly PERFORMANCE_LIMIT_FPS: number;
  readonly PERFORMANCE_LIMIT_ENEMIES: number;
  readonly CLEANUP_DISTANCE: number;
  readonly CLEANUP_FADE_DISTANCE: number;
}

export interface ClusterConfig {
  readonly CHANCE: number;
  readonly RESET_AFTER_SPAWNS: number;
  readonly RESET_AFTER_MS: number;
  readonly MIN_DISTANCE: number;
  readonly MAX_DISTANCE: number;
}

export interface RarityConfig {
  readonly ELITE_CHANCE: number;
  readonly CHAMPION_CHANCE: number;
  readonly CHAMPION_MIN_WAVE: number;
  readonly WEIGHTS: {
    readonly COMMON: number;
    readonly RARE: number;
    readonly LEGENDARY: number;
  };
}

export interface EnemyTypeWeights {
  readonly basic: number;
  readonly spitter: number;
  readonly tank: number;
  readonly swarm: number;
  readonly thug: number;
  readonly sniper: number;
  readonly boss: number;
  readonly disruptor: number;
  readonly sentinel: number;
}

/**
 * Wave configuration for structured enemy spawning
 * TUNED: Supports overlapping waves for VS-like pressure moments
 */
export interface WaveConfig {
  /** Enable wave-based spawning */
  readonly ENABLED: boolean;
  /** Time between waves in milliseconds */
  readonly WAVE_INTERVAL_MS: number;
  /** Base number of enemies per wave */
  readonly BASE_WAVE_SIZE: number;
  /** Additional enemies per player level */
  readonly ENEMIES_PER_LEVEL: number;
  /** Maximum enemies in a single wave */
  readonly MAX_WAVE_SIZE: number;
  /** Time to spawn all wave enemies (staggered) */
  readonly WAVE_SPAWN_DURATION_MS: number;
  /** Chance for a wave to be a "swarm" wave (many small enemies) */
  readonly SWARM_WAVE_CHANCE: number;
  /** Chance for a wave to be an "elite" wave (fewer but stronger) */
  readonly ELITE_WAVE_CHANCE: number;
  /** Minimum level before elite waves can appear */
  readonly ELITE_WAVE_MIN_LEVEL: number;
  /** Allow waves to overlap (start new wave before previous ends) */
  readonly ALLOW_OVERLAP: boolean;
  /** Maximum concurrent active waves */
  readonly MAX_CONCURRENT_WAVES: number;
  /** Minimum time between wave starts when overlapping (prevents spam) */
  readonly MIN_OVERLAP_INTERVAL_MS: number;
  /** Warning time before wave starts in milliseconds */
  readonly WAVE_WARNING_MS: number;
}

// =============================================================================
// SPAWN CONFIGURATION
// =============================================================================

export const SPAWN_CONFIG = {
  /**
   * Timing - Controls spawn rate and progression
   */
  TIMING: {
    /** Base spawn rate in milliseconds (reduced from 1500ms for quicker initial spawns) */
    BASE_SPAWN_RATE_MS: 800,
    /** Rate increase per level in milliseconds (reduced from 50ms for more gradual scaling) */
    RATE_INCREASE_PER_LEVEL_MS: 30,
    /** Minimum spawn rate in milliseconds (reduced from 500ms for more action at higher levels) */
    MIN_SPAWN_RATE_MS: 300,
    /** Initial spawn delay in milliseconds (spawn first wave almost immediately) */
    INITIAL_SPAWN_DELAY_MS: 100,
  } as SpawnTiming,

  /**
   * Limits - Performance and gameplay constraints
   */
  LIMITS: {
    /** Maximum number of concurrent enemies */
    MAX_ENEMIES: 50,
    /** FPS threshold for performance limiting */
    PERFORMANCE_LIMIT_FPS: 45,
    /** Enemy count when performance limiting activates */
    PERFORMANCE_LIMIT_ENEMIES: 30,
    /** Distance from player to cleanup enemies */
    CLEANUP_DISTANCE: 2000,
    /** Distance to start fading enemies before hard cleanup */
    CLEANUP_FADE_DISTANCE: 1600,
  } as SpawnLimits,

  /**
   * Cluster - Spatial clustering for varied encounters
   *
   * FIX: Reduced RESET_AFTER_SPAWNS from 10 to 5 and RESET_AFTER_MS from 30s to 15s
   * to prevent persistent spawn hotspots that cause enemy clumping.
   */
  CLUSTER: {
    /** Probability to spawn near last position (reduced from 30% to prevent visible clumps) */
    CHANCE: 0.15,
    /** Reset cluster position after N spawns (low to keep groups small) */
    RESET_AFTER_SPAWNS: 3,
    /** Reset cluster position after this duration in milliseconds */
    RESET_AFTER_MS: 10000,
    /** Minimum distance from cluster center (increased to spread clumps out) */
    MIN_DISTANCE: 250,
    /** Maximum distance from cluster center */
    MAX_DISTANCE: 500,
  } as ClusterConfig,

  /**
   * Rarity - Elite chance and drop rarity weights
   */
  RARITY: {
    /** Probability for elite enemy spawn (10%) */
    ELITE_CHANCE: 0.1,
    /** Probability for champion (miniboss) spawn replacing an elite slot */
    CHAMPION_CHANCE: 0.05,
    /** Minimum wave number before champions can spawn */
    CHAMPION_MIN_WAVE: 15,
    /** Drop rarity weight distribution */
    WEIGHTS: {
      COMMON: 0.7, // 70%
      RARE: 0.25, // 25%
      LEGENDARY: 0.05, // 5%
    },
  } as RarityConfig,

  /**
   * Enemy Type Weights - Relative spawn probabilities
   *
   * Higher weights = more likely to spawn.
   * Total: 100 (percentages)
   */
  ENEMY_TYPE_WEIGHTS: {
    basic: 28, // Most common
    spitter: 18, // Common
    tank: 15, // Uncommon
    swarm: 15, // Uncommon
    thug: 11, // Rare
    sniper: 9, // Rare
    boss: 0, // Bosses spawn via scheduled boss waves only
    disruptor: 12, // Uncommon — unlocks wave 18
    sentinel: 10, // Uncommon — unlocks wave 22
  } as EnemyTypeWeights,

  /**
   * Wave System - Structured enemy spawning for engaging gameplay
   * TUNED: Faster waves with overlap support for VS-like pressure moments
   */
  WAVES: {
    /** Enable wave-based spawning */
    ENABLED: true,
    /** Time between waves in milliseconds */
    WAVE_INTERVAL_MS: 18000,
    /** Base number of enemies per wave (bigger bursts compensate longer interval) */
    BASE_WAVE_SIZE: 9,
    /** Additional enemies per player level */
    ENEMIES_PER_LEVEL: 1,
    /** Maximum enemies in a single wave (higher peak drama) */
    MAX_WAVE_SIZE: 22,
    /** Time to spawn all wave enemies (staggered spawn over 4 seconds) */
    WAVE_SPAWN_DURATION_MS: 4000,
    /** Chance for a wave to be a "swarm" wave (25% - more chaos) */
    SWARM_WAVE_CHANCE: 0.25,
    /** Chance for a wave to be an "elite" wave (15%) */
    ELITE_WAVE_CHANCE: 0.15,
    /** Minimum level before elite waves can appear */
    ELITE_WAVE_MIN_LEVEL: 5,
    /** Allow waves to overlap for "oh no" pressure moments */
    ALLOW_OVERLAP: true,
    /** Maximum concurrent active waves (fewer overlaps for cleaner rhythm) */
    MAX_CONCURRENT_WAVES: 2,
    /** Minimum time between wave starts when overlapping (12s prevents spam) */
    MIN_OVERLAP_INTERVAL_MS: 12000,
    /** Warning time before wave starts (3s gives time to prepare) */
    WAVE_WARNING_MS: 3000,
  } as WaveConfig,
} as const;

// =============================================================================
// WAVE EVENTS
// =============================================================================

/**
 * Scheduled special wave events that override normal wave type selection.
 * Events take priority over the standard boss/elite/swarm roll.
 */
export interface WaveEvent {
  readonly wave: number;
  readonly event: 'boss_rush' | 'faction_invasion' | 'blackout' | 'guardian_surge';
}

export const WAVE_EVENTS: readonly WaveEvent[] = [
  { wave: 10, event: 'faction_invasion' },
  { wave: 12, event: 'guardian_surge' },
  { wave: 20, event: 'guardian_surge' },
  { wave: 25, event: 'boss_rush' },
  { wave: 28, event: 'guardian_surge' },
  { wave: 30, event: 'faction_invasion' },
  { wave: 35, event: 'blackout' },
  { wave: 40, event: 'boss_rush' },
  { wave: 45, event: 'faction_invasion' },
  { wave: 50, event: 'blackout' },
];

/**
 * Wave number at which each enemy type becomes available for spawning.
 * Types with unlock wave 1 are always available.
 */
export const ENEMY_UNLOCK_WAVES: Record<string, number> = {
  basic: 1,
  spitter: 1,
  swarm: 3,
  tank: 5,
  thug: 8,
  sniper: 12,
  boss: 15,
  disruptor: 18,
  sentinel: 22,
};
