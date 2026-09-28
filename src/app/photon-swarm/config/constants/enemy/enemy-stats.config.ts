/**
 * Enemy Stats Configuration
 *
 * Defines all enemy type base statistics including health, damage, speed,
 * aggro ranges, and weapon configurations for ranged enemy types.
 *
 * Enemy Types:
 * - basic: Standard melee enemy
 * - spitter: Ranged projectile attacker
 * - tank: High health, slow, damage reduction
 * - swarm: Fast, low health, low damage
 * - thug: High damage melee
 * - sniper: Long-range, high damage
 * - boss: High stats, burst fire weapon
 */

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface EnemyStats {
  readonly HEALTH: number;
  readonly DAMAGE: number;
  readonly SPEED: number;
  readonly RADIUS: number;
  readonly DAMAGE_REDUCTION: number;
  readonly AGGRO_RANGE: number;
  readonly ATTACK_RANGE: number;
  readonly WEAPON?: {
    readonly DAMAGE: number;
    readonly FIRE_RATE: number;
    readonly RANGE: number;
    readonly SPREAD?: number;
    readonly COOLDOWN?: number;
    readonly BURST_COUNT?: number;
  };
}

export interface EnemyStatsCollection {
  readonly basic: EnemyStats;
  readonly spitter: EnemyStats;
  readonly tank: EnemyStats;
  readonly swarm: EnemyStats;
  readonly thug: EnemyStats;
  readonly sniper: EnemyStats;
  readonly boss: EnemyStats;
  readonly disruptor: EnemyStats;
  readonly sentinel: EnemyStats;
}

// =============================================================================
// ENEMY STATS CONFIGURATION
// =============================================================================

export const ENEMY_STATS = {
  /**
   * Basic - Standard melee enemy
   * Role: Common enemy, balanced stats
   * NOTE: SPEED values should match getBaseSpeed() in enemy-movement-system.service.ts
   * NOTE: AGGRO_RANGE should be >= 600 so enemies visible on screen will pursue player
   */
  basic: {
    HEALTH: 35,
    DAMAGE: 10,
    SPEED: 80, // px/sec - moderate chase speed
    RADIUS: 20,
    DAMAGE_REDUCTION: 0,
    AGGRO_RANGE: 700, // Increased from 400 - enemies visible on screen should pursue
    ATTACK_RANGE: 200,
  },

  /**
   * Spitter - Ranged projectile attacker
   * Role: Mid-range threat, moderate damage
   */
  spitter: {
    HEALTH: 50,
    DAMAGE: 15,
    SPEED: 60, // px/sec - slower, keeps distance
    RADIUS: 25,
    DAMAGE_REDUCTION: 0,
    AGGRO_RANGE: 700, // Increased from 450 - visible enemies should engage
    ATTACK_RANGE: 300,
    WEAPON: {
      DAMAGE: 10,
      FIRE_RATE: 1000,
      RANGE: 300,
    },
  },

  /**
   * Tank - High health, slow, damage reduction
   * Role: Durable enemy, but killable in ~3 hits for VS-like power fantasy
   */
  tank: {
    HEALTH: 80,
    DAMAGE: 20,
    SPEED: 40, // px/sec - very slow, tanky
    RADIUS: 35,
    DAMAGE_REDUCTION: 0.15,
    AGGRO_RANGE: 600, // Increased from 300 - tanks should engage when visible
    ATTACK_RANGE: 150,
  },

  /**
   * Swarm - Fast, low health, low damage
   * Role: Overwhelming numbers, speed threat
   */
  swarm: {
    HEALTH: 35,
    DAMAGE: 5,
    SPEED: 120, // px/sec - fast, overwhelming
    RADIUS: 15,
    DAMAGE_REDUCTION: 0,
    AGGRO_RANGE: 800, // Increased from 350 - swarm should detect player from far away
    ATTACK_RANGE: 120,
  },

  /**
   * Thug - High damage melee
   * Role: Glass cannon, high threat if not avoided
   */
  thug: {
    HEALTH: 75,
    DAMAGE: 25,
    SPEED: 90, // px/sec - aggressive pursuer
    RADIUS: 28,
    DAMAGE_REDUCTION: 0.1,
    AGGRO_RANGE: 750, // Increased from 400 - aggressive pursuer should detect from far
    ATTACK_RANGE: 200,
  },

  /**
   * Sniper - Long-range, high damage
   * Role: Backline threat, requires positioning
   */
  sniper: {
    HEALTH: 55,
    DAMAGE: 30,
    SPEED: 50, // px/sec - slow, maintains distance
    RADIUS: 22,
    DAMAGE_REDUCTION: 0,
    AGGRO_RANGE: 1000, // Longest range - sniper should detect from far away
    ATTACK_RANGE: 500,
    WEAPON: {
      DAMAGE: 30,
      FIRE_RATE: 2000,
      RANGE: 500,
    },
  },

  /**
   * Disruptor - EMP debuffer that slows the player and drains beam charge
   * Role: High-value target, punishes player for ignoring it
   * Mechanic: EMP Pulse every 6s — 120px radius, 40% slow for 2s, 30% charge drain
   */
  disruptor: {
    HEALTH: 45,
    DAMAGE: 8,
    SPEED: 70, // px/sec - moderate, maintains preferred distance
    RADIUS: 22,
    DAMAGE_REDUCTION: 0,
    AGGRO_RANGE: 800,
    ATTACK_RANGE: 150,
  },

  /**
   * Sentinel - Shielded melee enemy with frontal arc damage reduction
   * Role: Forces flanking; forms shield walls with other sentinels
   * Mechanic: 120-degree frontal shield blocks 80% damage, always faces player
   * NOTE: DAMAGE_REDUCTION here is the base passive reduction; the directional
   * shield (ShieldArcComponent) handles the 80% frontal block separately.
   */
  sentinel: {
    HEALTH: 65,
    DAMAGE: 18,
    SPEED: 55, // px/sec - slow, deliberate advance
    RADIUS: 30,
    DAMAGE_REDUCTION: 0, // base passive = 0; directional shield handles it
    AGGRO_RANGE: 650,
    ATTACK_RANGE: 50,
  },

  /**
   * Boss - High stats, burst fire weapon
   * Role: Major threat but killable in ~14 hits for satisfying boss fights
   */
  boss: {
    HEALTH: 350,
    DAMAGE: 40,
    SPEED: 30, // px/sec - slow but menacing
    RADIUS: 50,
    DAMAGE_REDUCTION: 0.35,
    AGGRO_RANGE: 900, // Increased from 600 - bosses should always engage when visible
    ATTACK_RANGE: 250,
    WEAPON: {
      DAMAGE: 20,
      FIRE_RATE: 500,
      RANGE: 250,
      SPREAD: 5,
      COOLDOWN: 3000,
      BURST_COUNT: 3,
    },
  },
} as const;
