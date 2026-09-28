import { Component } from '../core/ecs/ecs.model';

// Default values for health component
const HEALTH_DEFAULTS = {
  // CRITICAL: Default to 100 health instead of 0 to prevent instant death
  HEALTH: 100,
  MAX_HEALTH: 100,
  DAMAGE_REDUCTION: 0,
  IS_DEAD: false,
} as const;

/** Damage source type for death animation differentiation */
export type DamageSource = 'player' | 'environmental' | 'npc' | 'unknown';

/**
 * Health component - tracks entity health and damage
 */
export class HealthComponent implements Component {
  public health: number;
  public maxHealth: number;
  public damageReduction: number;
  public isDead: boolean;
  public xpAwarded: boolean; // Prevent duplicate XP awards
  public killAwarded: boolean; // Prevent duplicate kill increments
  public deathProcessed: boolean; // Track if death has been processed for territory
  public combatDeathProcessed: boolean; // Track if combat-system death FX/rewards already fired
  public lastDamageSource: DamageSource; // Track what killed the entity for death animation

  constructor(...args: unknown[]) {
    // Use type narrowing instead of casting
    this.health = typeof args[0] === 'number' ? args[0] : HEALTH_DEFAULTS.HEALTH;
    this.maxHealth = typeof args[1] === 'number' ? args[1] : HEALTH_DEFAULTS.MAX_HEALTH;
    this.damageReduction = typeof args[2] === 'number' ? args[2] : HEALTH_DEFAULTS.DAMAGE_REDUCTION;
    this.isDead = typeof args[3] === 'boolean' ? args[3] : HEALTH_DEFAULTS.IS_DEAD;
    this.xpAwarded = false; // Initialize to false
    this.killAwarded = false; // Initialize to false
    this.deathProcessed = false; // Initialize to false
    this.combatDeathProcessed = false; // Initialize to false
    this.lastDamageSource = 'unknown'; // Default to unknown
  }
}
