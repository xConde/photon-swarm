import { Component } from '../core/ecs/ecs.model';

/**
 * HealAuraComponent - Passive heal aura for the Sentinel enemy.
 *
 * Pulses every intervalMs, healing nearby same-faction allies for
 * healPercent of their maxHealth within radius pixels.
 *
 * Unlike AREA_HEAL (one-shot telegraphed boss ability), this is continuous
 * and untelegraphed — the player must prioritize the Sentinel to break the
 * regen loop.
 */
export class HealAuraComponent implements Component {
  public radius: number;
  public healPercent: number; // 0.03 = 3% of target maxHealth per pulse
  public intervalMs: number; // pulse interval in ms
  public lastPulseAt: number; // timestamp of last pulse (0 fires immediately)

  constructor(...args: unknown[]) {
    this.radius = (args[0] as number) ?? 180;
    this.healPercent = (args[1] as number) ?? 0.03;
    this.intervalMs = (args[2] as number) ?? 1500;
    this.lastPulseAt = (args[3] as number) ?? 0;
  }

  /**
   * Returns true if enough time has elapsed since the last pulse.
   */
  isReadyToPulse(now: number): boolean {
    return now - this.lastPulseAt >= this.intervalMs;
  }

  /**
   * Records the current time as the latest pulse timestamp.
   */
  markPulsed(now: number): void {
    this.lastPulseAt = now;
  }
}
