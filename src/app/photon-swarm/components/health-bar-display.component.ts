import { Component } from '../core/ecs/ecs.model';

/**
 * Component to track health bar display timing
 * Health bars should remain visible for several seconds after damage
 */
export class HealthBarDisplayComponent implements Component {
  // When the health bar should be shown until (timestamp)
  public displayUntil: number;

  // Last known health percentage for smooth transitions
  public lastHealthPercent: number = 1.0;

  // Whether healing is occurring (for green number display)
  public isHealing: boolean = false;

  // Last heal amount for display
  public lastHealAmount: number = 0;

  // Duration to show health bar after damage (ms)
  private static readonly DISPLAY_DURATION = 5000; // 5 seconds

  constructor(...args: unknown[]) {
    // Use type narrowing for constructor arguments
    this.displayUntil = typeof args[0] === 'number' ? args[0] : Date.now() + HealthBarDisplayComponent.DISPLAY_DURATION;
  }

  /**
   * Extend the display time when damaged
   */
  public extendDisplay(): void {
    this.displayUntil = Date.now() + HealthBarDisplayComponent.DISPLAY_DURATION;
  }

  /**
   * Check if the health bar should still be displayed
   */
  public shouldDisplay(): boolean {
    return Date.now() < this.displayUntil;
  }

  /**
   * Mark that healing occurred
   */
  public markHealing(amount: number): void {
    this.isHealing = true;
    this.lastHealAmount = amount;
    this.extendDisplay(); // Show health bar when healing too
  }
}
