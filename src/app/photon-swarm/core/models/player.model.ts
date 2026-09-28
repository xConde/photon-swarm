/**
 * Player-specific type definitions
 * Contains all interfaces and types related to player functionality
 */

/**
 * Interface for discharge events
 */
export interface DischargeEvent {
  x: number;
  y: number;
  radius: number;
  chargeLevel?: number; // 0.0 to 1.0 - scales damage (0 = 50% damage, 1 = 150% damage)
}

/**
 * Game engine interface for player service
 * Minimal interface to avoid circular dependencies
 */
export interface PlayerGameEngine {
  getWorldWidth?: () => number;
  getWorldHeight?: () => number;
  movementSpeedMultiplier?: number;
}

/**
 * Player state interface
 * Represents the complete state of the player
 */
export interface PlayerState {
  position: { x: number; y: number };
  angle: number;
  health: number;
  isGameActive: boolean;
  isDashing: boolean;
  isInvincible: boolean;
  speedMultiplier: number;
  cooldowns: {
    discharge: {
      available: boolean;
      remaining: number;
      cooldown: number;
    };
    dash: {
      available: boolean;
    };
    direction: {
      onCooldown: boolean;
      active: boolean;
    };
  };
}

/**
 * Direction tracking for projectile persistence
 */
export interface DirectionInfo {
  x: number;
  y: number;
  source: 'movement' | 'click' | 'none';
}

/**
 * Charging system constants
 */
export interface ChargingConstants {
  MOVEMENT_CHARGE_RATE: number;
  MOVEMENT_SHOT_COST: number;
  FOCUS_CHARGE_RATE: number;
  FOCUS_FIRE_COST: number;
  FOCUS_AUTO_FIRE_COOLDOWN_SECONDS: number;
  FOCUS_DAMAGE_DEBOUNCE_SECONDS: number;
  BASE_FIRE_RATE: number;
}

/**
 * Charging System Types
 */
export type ChargeType = 'focus' | 'movement' | 'none';

export interface ChargingState {
  readonly level: number; // 0-1 scale
  readonly type: ChargeType; // Active charge type
  readonly isCharging: boolean; // Whether actively building charge
  readonly canFire: boolean; // Whether can fire at current level
  readonly color: string; // CSS color for visuals
}

/**
 * Charging configuration with decay rate
 */
export interface ChargingConfig extends ChargingConstants {
  MOVEMENT_CHARGE_DECAY_RATE: number;
}
