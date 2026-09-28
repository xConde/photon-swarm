import { Component } from '../core/ecs/ecs.model';

// Default values for discharge ability
const DISCHARGE_DEFAULTS = {
  RADIUS: 200,
  DAMAGE: 50,
  COOLDOWN: 5000,
  LAST_USE_TIME: 0,
  MAX_CHARGES: 1,
  CURRENT_CHARGES: 1,
} as const;

/**
 * Discharge component - AOE blast ability
 */
export class DischargeComponent implements Component {
  public radius: number;
  public damage: number;
  public cooldown: number;
  public lastUseTime: number;
  public maxCharges: number;
  public currentCharges: number;

  constructor(...args: unknown[]) {
    // Use type narrowing instead of casting
    this.radius = typeof args[0] === 'number' ? args[0] : DISCHARGE_DEFAULTS.RADIUS;
    this.damage = typeof args[1] === 'number' ? args[1] : DISCHARGE_DEFAULTS.DAMAGE;
    this.cooldown = typeof args[2] === 'number' ? args[2] : DISCHARGE_DEFAULTS.COOLDOWN;
    this.lastUseTime = typeof args[3] === 'number' ? args[3] : DISCHARGE_DEFAULTS.LAST_USE_TIME;
    this.maxCharges = typeof args[4] === 'number' ? args[4] : DISCHARGE_DEFAULTS.MAX_CHARGES;
    this.currentCharges = typeof args[5] === 'number' ? args[5] : DISCHARGE_DEFAULTS.CURRENT_CHARGES;
  }

  /**
   * Check if discharge is ready
   */
  canDischarge(currentTime: number): boolean {
    return this.currentCharges > 0 || currentTime - this.lastUseTime >= this.cooldown;
  }
}
