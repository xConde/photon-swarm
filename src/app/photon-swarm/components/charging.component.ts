import { Component } from '../core/ecs/ecs.model';

/**
 * Debug info structure for charging state troubleshooting
 */
export interface ChargingDebugInfo {
  chargeLevel: string;
  isMoving: boolean;
  ballVisible: boolean;
  canFire: boolean;
  timeUntilFire: number;
  timeSinceMovement: number;
  timeSinceFire: number;
  timeAtMaxCharge: number;
  isOvercharging: boolean;
  movementEfficiency: string;
  isCharged: boolean;
  hasMinCharge: boolean;
}

/**
 * Serialized charging state for persistence
 */
export interface ChargingSerializedState {
  chargeLevel: number;
  lastFireTime: number;
  lastMovementTime: number;
  isCurrentlyMoving: boolean;
  timeAtMaxCharge: number;
  maxChargeStartTime: number;
  movementEfficiencyMultiplier: number;
}

/**
 * Charging Component Configuration Constants
 */
export const CHARGING_CONFIG = {
  // Charge progression rates (per second)
  CHARGE_RATE_PER_SECOND: 0.396, // 39.6% charge per second (~2.5s to full, 40% slower)
  DECAY_RATE_PER_SECOND: 1.0, // 100% decay per second (1s from full to empty)

  // Timing windows (milliseconds)
  MAINTENANCE_WINDOW_MS: 300, // Grace period when stopped moving
  POST_FIRE_COOLDOWN_MS: 200, // Brief cooldown after firing before charging can resume
  FIRE_RATE_COOLDOWN_MS: 1000, // Time between allowed shots

  // Firing mechanics
  FIRE_CHARGE_COST: 0.15, // 15% charge consumed per shot (allows ~6-7 shots at full charge)
  MIN_CHARGE_TO_FIRE: 0.1, // Minimum 10% charge required to fire
  CHARGED_SPEED_REDUCTION: 0.2, // 20% speed reduction for charged projectiles
  CHARGED_THRESHOLD: 0.4, // 40% charge needed to be considered "charged"

  // Charge hoarding prevention
  MAX_CHARGE_HOLD_TIME_MS: 3000, // 3 seconds at 100% before decay starts
  OVERCHARGE_DECAY_RATE: 0.3, // 30% per second decay when overcharged
  MOVEMENT_EFFICIENCY_DECAY: 0.95, // Charge rate reduces by 5% each second when at high charge

  // Visual scaling
  MIN_CHARGE_LEVEL: 0.0,
  MAX_CHARGE_LEVEL: 1.0,
  BASE_BALL_SIZE: 1.0,
  MAX_SIZE_MULTIPLIER: 1.6, // Ball grows up to 60% larger when fully charged
  BASE_GLOW_INTENSITY: 0.0,
  MAX_GLOW_INTENSITY: 1.0,

  // Movement detection
  MOVEMENT_THRESHOLD_PIXELS_PER_FRAME: 5.0,
} as const;

/**
 * Ball State Interface - represents the current visual and functional state of the charging ball
 */
export interface BallState {
  readonly isVisible: boolean;
  readonly canFire: boolean;
  readonly chargeLevel: number; // 0.0 to 1.0
  readonly ballSize: number; // Visual size multiplier
  readonly glowIntensity: number; // Visual glow intensity
  readonly timeUntilFireReady: number; // Milliseconds until next fire is allowed
  readonly isCharged: boolean; // True if charge level >= CHARGED_THRESHOLD
  readonly hasMinimumCharge: boolean; // True if charge level >= MIN_CHARGE_TO_FIRE
}

/**
 * Minimal Charging Component - handles all charging logic in a single, unified system
 *
 * This component manages:
 * - Charge level progression and decay
 * - Ball visibility based on movement
 * - Fire timing and cooldowns
 * - Visual feedback calculations
 */
export class ChargingComponent implements Component {
  // Core state
  private chargeLevel: number = CHARGING_CONFIG.MIN_CHARGE_LEVEL;
  private lastFireTime: number = 0;
  private lastMovementTime: number = 0;
  private isCurrentlyMoving: boolean = false;

  // Charge hoarding prevention state
  private timeAtMaxCharge: number = 0;
  private maxChargeStartTime: number = 0;
  private movementEfficiencyMultiplier: number = 1.0;

  constructor(..._args: unknown[]) {
    // Initialize to 0 to indicate "never fired" - this avoids starting in cooldown state
    this.lastFireTime = 0;
    // Initialize lastMovementTime to 0 so we're not in maintenance window initially
    this.lastMovementTime = 0;
    // ECS-compatible constructor - self-contained pattern
  }

  /**
   * Main update method - single source of truth for all charging behavior
   */
  update(deltaTime: number, isMoving: boolean): BallState {
    const currentTime = Date.now();
    const deltaSeconds = deltaTime / 1000;

    // Update movement tracking
    this.updateMovementState(currentTime, isMoving);

    // Update charge level based on movement and timing
    this.updateChargeLevel(deltaSeconds, currentTime);

    // Calculate and return current ball state
    return this.calculateBallState(currentTime);
  }

  /**
   * Attempt to fire the ball - returns true if fire was successful
   */
  attemptFire(currentTime: number): boolean {
    const ballState = this.calculateBallState(currentTime);

    if (ballState.canFire && ballState.isVisible && ballState.hasMinimumCharge) {
      this.executeFireAction(currentTime);
      return true;
    }

    return false;
  }

  /**
   * Get current charge level (for external systems like UI)
   */
  getCurrentChargeLevel(): number {
    return this.chargeLevel;
  }

  /**
   * Get debug information for troubleshooting
   */
  getDebugInfo(currentTime: number): ChargingDebugInfo {
    const ballState = this.calculateBallState(currentTime);
    return {
      chargeLevel: this.chargeLevel.toFixed(3),
      isMoving: this.isCurrentlyMoving,
      ballVisible: ballState.isVisible,
      canFire: ballState.canFire,
      timeUntilFire: ballState.timeUntilFireReady,
      timeSinceMovement: currentTime - this.lastMovementTime,
      timeSinceFire: currentTime - this.lastFireTime,
      // Hoarding prevention debug info
      timeAtMaxCharge: this.timeAtMaxCharge,
      isOvercharging: this.isOverchargeDecayActive(currentTime),
      movementEfficiency: this.movementEfficiencyMultiplier.toFixed(3),
      isCharged: ballState.isCharged,
      hasMinCharge: ballState.hasMinimumCharge,
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Update movement state tracking
   */
  private updateMovementState(currentTime: number, isMoving: boolean): void {
    if (isMoving) {
      this.lastMovementTime = currentTime;
    }
    this.isCurrentlyMoving = isMoving;
  }

  /**
   * Update charge level based on movement and timing rules
   */
  private updateChargeLevel(deltaSeconds: number, currentTime: number): void {
    const isInMaintenanceWindow = this.isInMaintenanceWindow(currentTime);
    const isInPostFireCooldown = this.isInPostFireCooldown(currentTime);

    // Track time at max charge for hoarding prevention
    this.updateMaxChargeTracking(currentTime);

    if (this.shouldChargeIncrease(isInMaintenanceWindow, isInPostFireCooldown)) {
      // Increase charge when moving and not in cooldown
      let chargeRate = CHARGING_CONFIG.CHARGE_RATE_PER_SECOND;

      // Apply movement efficiency decay when at high charge
      if (this.chargeLevel > 0.8) {
        chargeRate *= this.movementEfficiencyMultiplier;
        this.movementEfficiencyMultiplier = Math.max(
          0.5,
          this.movementEfficiencyMultiplier * Math.pow(CHARGING_CONFIG.MOVEMENT_EFFICIENCY_DECAY, deltaSeconds)
        );
      } else {
        // Reset efficiency when not at high charge
        this.movementEfficiencyMultiplier = 1.0;
      }

      const chargeIncrease = chargeRate * deltaSeconds;
      this.chargeLevel = Math.min(CHARGING_CONFIG.MAX_CHARGE_LEVEL, this.chargeLevel + chargeIncrease);
    } else if (this.shouldChargeDecay(isInMaintenanceWindow)) {
      // Decay charge when not moving (outside maintenance window)
      let decayRate: number = CHARGING_CONFIG.DECAY_RATE_PER_SECOND;

      // Apply overcharge decay if held at max too long
      if (this.isOverchargeDecayActive(currentTime)) {
        decayRate = CHARGING_CONFIG.OVERCHARGE_DECAY_RATE;
      }

      const chargeDecay = decayRate * deltaSeconds;
      this.chargeLevel = Math.max(CHARGING_CONFIG.MIN_CHARGE_LEVEL, this.chargeLevel - chargeDecay);

      // Reset efficiency when decaying
      this.movementEfficiencyMultiplier = 1.0;
    }
    // If in maintenance window and not moving, charge level stays constant
  }

  /**
   * Calculate current ball state based on all factors
   */
  private calculateBallState(currentTime: number): BallState {
    const isInMaintenanceWindow = this.isInMaintenanceWindow(currentTime);
    const canFireBasedOnCooldown = this.canFireBasedOnCooldown(currentTime);
    const timeUntilFireReady = this.calculateTimeUntilFireReady(currentTime);

    return {
      isVisible: this.isCurrentlyMoving || isInMaintenanceWindow,
      canFire: canFireBasedOnCooldown,
      chargeLevel: this.chargeLevel,
      ballSize: this.calculateBallSize(),
      glowIntensity: this.calculateGlowIntensity(),
      timeUntilFireReady: timeUntilFireReady,
      isCharged: this.chargeLevel >= CHARGING_CONFIG.CHARGED_THRESHOLD,
      hasMinimumCharge: this.chargeLevel >= CHARGING_CONFIG.MIN_CHARGE_TO_FIRE,
    };
  }

  /**
   * Execute fire action and update state
   */
  private executeFireAction(currentTime: number): void {
    this.lastFireTime = currentTime;

    // Consume charge instead of resetting to zero
    this.chargeLevel = Math.max(CHARGING_CONFIG.MIN_CHARGE_LEVEL, this.chargeLevel - CHARGING_CONFIG.FIRE_CHARGE_COST);
  }

  // ============================================================================
  // CONDITION CHECKING METHODS
  // ============================================================================

  /**
   * Check if player is within the movement maintenance window
   */
  private isInMaintenanceWindow(currentTime: number): boolean {
    const timeSinceMovement = currentTime - this.lastMovementTime;
    return timeSinceMovement <= CHARGING_CONFIG.MAINTENANCE_WINDOW_MS;
  }

  /**
   * Check if player is in post-fire cooldown period
   */
  private isInPostFireCooldown(currentTime: number): boolean {
    const timeSinceFire = currentTime - this.lastFireTime;
    return timeSinceFire < CHARGING_CONFIG.POST_FIRE_COOLDOWN_MS;
  }

  /**
   * Check if charge should increase based on current conditions
   */
  private shouldChargeIncrease(_isInMaintenanceWindow: boolean, isInPostFireCooldown: boolean): boolean {
    return this.isCurrentlyMoving && !isInPostFireCooldown;
  }

  /**
   * Check if charge should decay based on current conditions
   */
  private shouldChargeDecay(isInMaintenanceWindow: boolean): boolean {
    return !this.isCurrentlyMoving && !isInMaintenanceWindow;
  }

  /**
   * Check if firing is allowed based on cooldown
   */
  private canFireBasedOnCooldown(currentTime: number): boolean {
    const timeSinceFire = currentTime - this.lastFireTime;
    return timeSinceFire >= CHARGING_CONFIG.FIRE_RATE_COOLDOWN_MS;
  }

  // ============================================================================
  // VISUAL CALCULATION METHODS
  // ============================================================================

  /**
   * Calculate ball size based on charge level
   */
  private calculateBallSize(): number {
    const sizeMultiplier = 1 + (CHARGING_CONFIG.MAX_SIZE_MULTIPLIER - 1) * this.chargeLevel;
    return CHARGING_CONFIG.BASE_BALL_SIZE * sizeMultiplier;
  }

  /**
   * Calculate glow intensity based on charge level
   */
  private calculateGlowIntensity(): number {
    return (
      CHARGING_CONFIG.BASE_GLOW_INTENSITY +
      (CHARGING_CONFIG.MAX_GLOW_INTENSITY - CHARGING_CONFIG.BASE_GLOW_INTENSITY) * this.chargeLevel
    );
  }

  /**
   * Calculate time until fire is ready (for UI feedback)
   */
  private calculateTimeUntilFireReady(currentTime: number): number {
    const timeSinceFire = currentTime - this.lastFireTime;
    return Math.max(0, CHARGING_CONFIG.FIRE_RATE_COOLDOWN_MS - timeSinceFire);
  }

  // ============================================================================
  // CHARGE HOARDING PREVENTION METHODS
  // ============================================================================

  /**
   * Update tracking of time spent at maximum charge
   */
  private updateMaxChargeTracking(currentTime: number): void {
    if (this.chargeLevel >= CHARGING_CONFIG.MAX_CHARGE_LEVEL) {
      if (this.timeAtMaxCharge === 0) {
        // Just reached max charge
        this.maxChargeStartTime = currentTime;
      }
      this.timeAtMaxCharge = currentTime - this.maxChargeStartTime;
    } else {
      // Reset when not at max charge
      this.timeAtMaxCharge = 0;
      this.maxChargeStartTime = 0;
    }
  }

  /**
   * Check if overcharge decay should be active
   */
  private isOverchargeDecayActive(_currentTime: number): boolean {
    return this.timeAtMaxCharge > CHARGING_CONFIG.MAX_CHARGE_HOLD_TIME_MS;
  }

  /**
   * Serialize charging state for persistence
   */
  serialize(): ChargingSerializedState {
    return {
      chargeLevel: this.chargeLevel,
      lastFireTime: this.lastFireTime,
      lastMovementTime: this.lastMovementTime,
      isCurrentlyMoving: this.isCurrentlyMoving,
      timeAtMaxCharge: this.timeAtMaxCharge,
      maxChargeStartTime: this.maxChargeStartTime,
      movementEfficiencyMultiplier: this.movementEfficiencyMultiplier,
    };
  }

  /**
   * Deserialize charging state from persistence
   */
  static deserialize(data: Partial<ChargingSerializedState>): ChargingComponent {
    const component = new ChargingComponent();

    // Restore state with validation
    component.chargeLevel = Math.max(
      CHARGING_CONFIG.MIN_CHARGE_LEVEL,
      Math.min(CHARGING_CONFIG.MAX_CHARGE_LEVEL, data.chargeLevel ?? 0)
    );
    component.lastFireTime = data.lastFireTime ?? Date.now();
    component.lastMovementTime = data.lastMovementTime ?? Date.now();
    component.isCurrentlyMoving = data.isCurrentlyMoving ?? false;
    component.timeAtMaxCharge = data.timeAtMaxCharge ?? 0;
    component.maxChargeStartTime = data.maxChargeStartTime ?? 0;
    component.movementEfficiencyMultiplier = Math.max(0.5, Math.min(1.0, data.movementEfficiencyMultiplier ?? 1.0));

    return component;
  }
}
