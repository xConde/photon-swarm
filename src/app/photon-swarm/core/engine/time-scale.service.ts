import { Injectable } from '@angular/core';

/**
 * TimeScaleService - Controls global time scaling for slow-motion effects.
 *
 * When applied, ALL game systems slow down uniformly (physics, AI, particles)
 * because the game engine multiplies deltaTime by the current time scale.
 */
@Injectable({ providedIn: 'root' })
export class TimeScaleService {
  private timeScale = 1.0;
  private restoreTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** Returns the current time scale (1.0 = normal, < 1.0 = slow-motion). */
  getTimeScale(): number {
    return this.timeScale;
  }

  /** Returns true if slow-motion is currently active. */
  isSlowMotion(): boolean {
    return this.timeScale < 1.0;
  }

  /**
   * Applies a slow-motion effect for the given duration.
   * If already in slow-motion, the previous timer is cancelled and replaced.
   *
   * @param scale Time multiplier, clamped to [0.1, 1.0]
   * @param durationMs How long the slow-motion lasts in real milliseconds
   */
  applySlowMotion(scale: number, durationMs: number): void {
    const clamped = Math.max(0.1, Math.min(1.0, scale));

    // Only replace if new effect is deeper (lower scale) or no slow-mo is active.
    // If current slow-mo is deeper than the incoming one, ignore the new request.
    if (clamped >= this.timeScale && this.timeScale < 1.0) return;

    if (this.restoreTimeoutId !== null) {
      clearTimeout(this.restoreTimeoutId);
      this.restoreTimeoutId = null;
    }

    this.timeScale = clamped;

    this.restoreTimeoutId = setTimeout(() => {
      this.timeScale = 1.0;
      this.restoreTimeoutId = null;
    }, durationMs);
  }

  /** Immediately restores normal time scale and cancels any pending timer. */
  reset(): void {
    if (this.restoreTimeoutId !== null) {
      clearTimeout(this.restoreTimeoutId);
      this.restoreTimeoutId = null;
    }
    this.timeScale = 1.0;
  }
}
