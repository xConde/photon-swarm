/**
 * Player Configuration - Unified Export
 *
 * This file provides a unified PLAYER_CONFIG object that combines all player-related
 * configurations from the player domain. It maintains backwards compatibility with
 * existing code that expects PLAYER_CONFIG.WEAPONS, PLAYER_CONFIG.ABILITIES, etc.
 *
 * The actual configurations are defined in separate focused files:
 * - weapon.config.ts: Weapon definitions
 * - ability.config.ts: Ability definitions
 * - charging.config.ts: Charging, animation, and cooldown acceleration
 */

import { WEAPON_CONFIG } from './weapon.config';
import { ABILITY_CONFIG, FOCUS_FIRE_CONFIG } from './ability.config';
import { CHARGING_CONFIG } from './charging.config';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface PlayerPhysics {
  readonly RADIUS: number;
  readonly BASE_SPEED: number;
  readonly DIAGONAL_SPEED_FACTOR: number;
}

export interface SpawnProtection {
  readonly DURATION_MS: number;
}

// =============================================================================
// PLAYER CONFIGURATION (UNIFIED)
// =============================================================================

export const PLAYER_CONFIG = {
  /**
   * Player physics and movement
   */
  PHYSICS: {
    /** Player collision radius in pixels */
    RADIUS: 12,
    /** Base movement speed (pixels per millisecond) */
    BASE_SPEED: 0.2,
    /** Speed reduction factor for diagonal movement to prevent faster diagonal speed */
    DIAGONAL_SPEED_FACTOR: 1 / Math.sqrt(2),
  } as PlayerPhysics,

  /**
   * Spawn protection (initial invincibility)
   */
  SPAWN_PROTECTION: {
    /** Duration of invincibility after spawning in milliseconds */
    DURATION_MS: 3000,
  } as SpawnProtection,

  /**
   * Weapon configurations (from weapon.config.ts)
   */
  WEAPONS: WEAPON_CONFIG,

  /**
   * Ability configurations (from ability.config.ts)
   */
  ABILITIES: ABILITY_CONFIG,

  /**
   * Focus Fire configuration (from ability.config.ts)
   */
  FOCUS_FIRE: FOCUS_FIRE_CONFIG,

  /**
   * Charging mechanics (from charging.config.ts)
   */
  CHARGING: CHARGING_CONFIG.CHARGING,

  /**
   * Animation and rotation (from charging.config.ts)
   */
  ANIMATION: CHARGING_CONFIG.ANIMATION,

  /**
   * Cooldown acceleration (from charging.config.ts)
   */
  COOLDOWN_ACCELERATION: CHARGING_CONFIG.COOLDOWN_ACCELERATION,

  /**
   * Discharge charging mechanics (from charging.config.ts)
   */
  DISCHARGE_CHARGING: CHARGING_CONFIG.DISCHARGE_CHARGING,

  /**
   * Touch aim grace window (from charging.config.ts)
   */
  TOUCH_AIM: CHARGING_CONFIG.TOUCH_AIM,
} as const;
