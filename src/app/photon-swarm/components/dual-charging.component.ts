import { Component } from '../core/ecs/ecs.model';
import { FOCUS_CHARGING_CONFIG } from '../config/game-constants';

/**
 * Dual Charging Component - Supports both movement and focus charging
 *
 * This component properly implements the dual charging system design:
 * - Movement charging (0-1): Accumulates while moving, creates projectiles
 * - Focus charging (0-1): Accumulates while stationary, enhances beam
 *
 * Both charges share the same visual representation (orb and HUD bar)
 */
export class DualChargingComponent implements Component {
  // Charge values (0-1 range for ECS compatibility)
  private movementCharge: number = 0;
  private focusCharge: number = 0;

  // Timing state
  private lastFireTime: number = 0;
  private lastMovementTime: number = 0;
  private isCurrentlyMoving: boolean = false;

  private readonly CHARGE_RATE = 0.4;
  private readonly DECAY_RATE = 1.0;
  static readonly FIRE_COOLDOWN_MS = 1000;
  private readonly MAINTENANCE_WINDOW_MS = 300;

  constructor(..._args: unknown[]) {
    const now = Date.now();
    this.lastFireTime = now;
    this.lastMovementTime = now;
  }

  /**
   * Update both charging states based on movement
   */
  update(deltaTime: number, isMoving: boolean): DualChargeState {
    const currentTime = Date.now();
    const deltaSeconds = deltaTime / 1000;

    if (isMoving !== this.isCurrentlyMoving) {
      // State changed: carry over charge to the new active bucket
      if (isMoving) {
        // Stationary → Moving: carry focus charge into movement charge
        this.movementCharge = Math.max(this.movementCharge, this.focusCharge);
      } else {
        // Moving → Stationary: carry movement charge into focus charge
        this.focusCharge = Math.max(this.focusCharge, this.movementCharge);
        this.lastMovementTime = currentTime;
      }
      this.isCurrentlyMoving = isMoving;
    } else if (isMoving) {
      this.lastMovementTime = currentTime;
    }

    if (isMoving) {
      this.movementCharge = Math.min(1.0, this.movementCharge + this.CHARGE_RATE * deltaSeconds);
      this.focusCharge = Math.max(0, this.focusCharge - this.DECAY_RATE * deltaSeconds);
    } else {
      this.focusCharge = Math.min(1.0, this.focusCharge + this.CHARGE_RATE * deltaSeconds);
      const timeSinceMovement = currentTime - this.lastMovementTime;
      if (timeSinceMovement > this.MAINTENANCE_WINDOW_MS) {
        this.movementCharge = Math.max(0, this.movementCharge - this.DECAY_RATE * deltaSeconds);
      }
    }

    return this.getChargeState(currentTime);
  }

  /**
   * Get the current charge state for both charge types
   */
  getChargeState(currentTime: number = Date.now()): DualChargeState {
    const canFire = currentTime - this.lastFireTime >= DualChargingComponent.FIRE_COOLDOWN_MS;
    const activeCharge = this.isCurrentlyMoving ? this.movementCharge : this.focusCharge;

    // Auto-fire when EITHER charge reaches 100% (so stopping at 100% still fires)
    const shouldAutoFire = (this.movementCharge >= 1.0 || this.focusCharge >= 1.0) && canFire;

    return {
      movementCharge: this.movementCharge,
      focusCharge: this.focusCharge,
      activeCharge: activeCharge,
      isMoving: this.isCurrentlyMoving,
      canFire: canFire,
      shouldAutoFire: shouldAutoFire,
      timeUntilFireReady: Math.max(0, DualChargingComponent.FIRE_COOLDOWN_MS - (currentTime - this.lastFireTime)),
    };
  }

  /**
   * Fire the active charge (creates projectile)
   * Fires whichever charge is at 100%, prioritizing movement charge.
   * Both charge types reset to the same value for consistent fire rhythm.
   */
  fireMovementCharge(): number {
    let chargeToFire: number;

    // Fire whichever charge is at 100% (prioritize movement if both are full)
    // Both reset to same value so damage/rhythm is identical regardless of movement state
    if (this.movementCharge >= 1.0) {
      chargeToFire = this.movementCharge;
      this.movementCharge = FOCUS_CHARGING_CONFIG.AUTO_FIRE_RESET_CHARGE;
    } else if (this.focusCharge >= 1.0) {
      chargeToFire = this.focusCharge;
      this.focusCharge = FOCUS_CHARGING_CONFIG.AUTO_FIRE_RESET_CHARGE;
    } else {
      // Fallback: fire based on current movement state
      if (this.isCurrentlyMoving) {
        chargeToFire = this.movementCharge;
        this.movementCharge = FOCUS_CHARGING_CONFIG.AUTO_FIRE_RESET_CHARGE;
      } else {
        chargeToFire = this.focusCharge;
        this.focusCharge = FOCUS_CHARGING_CONFIG.AUTO_FIRE_RESET_CHARGE;
      }
    }

    this.lastFireTime = Date.now();
    return chargeToFire;
  }

  /**
   * Consume focus charge (for beam enhancement)
   */
  consumeFocusCharge(amount: number): void {
    this.focusCharge = Math.max(0, this.focusCharge - amount);
  }

  /**
   * Get the current charge level for visual display (0-1)
   * Returns whichever charge is currently active
   */
  getCurrentChargeLevel(): number {
    return this.isCurrentlyMoving ? this.movementCharge : this.focusCharge;
  }

  /**
   * Get movement charge (0-1)
   */
  getMovementCharge(): number {
    return this.movementCharge;
  }

  /**
   * Get focus charge (0-1)
   */
  getFocusCharge(): number {
    return this.focusCharge;
  }

  /**
   * Check if player has been stationary long enough for focus charging
   */
  isInFocusMode(): boolean {
    return !this.isCurrentlyMoving && this.focusCharge > 0;
  }

  /**
   * For debugging
   */
  getDebugInfo(): Record<string, unknown> {
    return {
      movementCharge: this.movementCharge.toFixed(3),
      focusCharge: this.focusCharge.toFixed(3),
      isMoving: this.isCurrentlyMoving,
      canFire: this.getChargeState().canFire,
      shouldAutoFire: this.getChargeState().shouldAutoFire,
    };
  }
}

/**
 * State returned by the dual charging component
 */
export interface DualChargeState {
  movementCharge: number; // 0-1 range
  focusCharge: number; // 0-1 range
  activeCharge: number; // Currently active charge (for visuals)
  isMoving: boolean;
  canFire: boolean;
  shouldAutoFire: boolean; // True when movement charge hits 100%
  timeUntilFireReady: number;
}
