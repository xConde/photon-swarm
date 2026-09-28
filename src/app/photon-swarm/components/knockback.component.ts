import { Component } from '../core/ecs/ecs.model';

/**
 * Component to track knockback state for entities
 * Prevents enemy AI from overriding knockback velocity during active knockback period
 */
export class KnockbackComponent implements Component {
  public knockbackVelocityX: number;
  public knockbackVelocityY: number;
  public knockbackTimer: number;
  public maxKnockbackTime: number;
  public isActive: boolean;

  constructor(...args: unknown[]) {
    this.knockbackVelocityX = (args[0] as number) ?? 0;
    this.knockbackVelocityY = (args[1] as number) ?? 0;
    const duration = (args[2] as number) ?? 300; // milliseconds
    this.knockbackTimer = duration;
    this.maxKnockbackTime = duration;
    this.isActive = duration > 0;
  }

  /**
   * Update the knockback timer and state
   * @param deltaTime Time elapsed in milliseconds
   * @returns true if knockback is still active
   */
  update(deltaTime: number): boolean {
    if (!this.isActive) return false;

    this.knockbackTimer -= deltaTime;

    if (this.knockbackTimer <= 0) {
      this.isActive = false;
      this.knockbackVelocityX = 0;
      this.knockbackVelocityY = 0;
      return false;
    }

    return true;
  }

  /**
   * Get the current knockback velocity with decay over time
   */
  getCurrentVelocity(): { vx: number; vy: number } {
    if (!this.isActive) return { vx: 0, vy: 0 };

    // More immediate, front-loaded decay for snappier response
    const progress = 1 - this.knockbackTimer / this.maxKnockbackTime;
    // Use quadratic decay for more immediate effect
    const decayFactor = Math.max(0, (1 - progress) * (1 - progress));

    return {
      vx: this.knockbackVelocityX * decayFactor,
      vy: this.knockbackVelocityY * decayFactor,
    };
  }

  /**
   * Add additional knockback force
   */
  addKnockback(vx: number, vy: number, duration: number = 300): void {
    this.knockbackVelocityX += vx;
    this.knockbackVelocityY += vy;
    this.knockbackTimer = Math.max(this.knockbackTimer, duration);
    this.maxKnockbackTime = Math.max(this.maxKnockbackTime, duration);
    this.isActive = true;
  }
}
