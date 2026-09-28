import { Injectable } from '@angular/core';

/**
 * EMP slow debuff (Disruptor mechanic).
 * Extracted from PlayerService (Photon-Swarm decomposition plan, Phase B) — self-contained
 * state with a single external caller (EmpPulseSystemService.applySlow via PlayerService).
 * PlayerService keeps applySlow/isSlowed/getSlowRemainingMs as public delegates with
 * unchanged signatures so no call site needs to change.
 */
@Injectable({ providedIn: 'root' })
export class PlayerSlowDebuffHelper {
  private slowMultiplier = 1.0; // 1.0 = full speed, 0.6 = 40% slow
  private slowEndTime = 0;

  /**
   * Apply a movement slow debuff.
   * Non-stacking: a second call refreshes duration rather than stacking the multiplier.
   * @param factor Fraction of speed to remove (0.4 = 40% slower → 0.6x speed)
   * @param durationMs How long the slow lasts in milliseconds
   */
  applySlow(factor: number, durationMs: number): void {
    this.slowMultiplier = 1.0 - Math.max(0, Math.min(1, factor));
    this.slowEndTime = Date.now() + durationMs;
  }

  /** True while a slow debuff is active. */
  isSlowed(): boolean {
    if (this.slowMultiplier < 1.0 && Date.now() <= this.slowEndTime) {
      return true;
    }
    // Auto-expire
    if (this.slowMultiplier < 1.0) {
      this.slowMultiplier = 1.0;
    }
    return false;
  }

  /** Remaining ms on the current slow, 0 if not slowed. */
  getSlowRemainingMs(): number {
    return this.isSlowed() ? Math.max(0, this.slowEndTime - Date.now()) : 0;
  }

  /** Current speed multiplier (1.0 = full speed) — read by PlayerService's per-frame movement calc. */
  getCurrentMultiplier(): number {
    return this.slowMultiplier;
  }

  /** Reset on death/respawn. */
  reset(): void {
    this.slowMultiplier = 1.0;
    this.slowEndTime = 0;
  }
}
