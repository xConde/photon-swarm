import { Component } from '../core/ecs/ecs.model';

/**
 * TeleportEffectComponent — tracks an in-flight teleport blink.
 *
 * When attached, the entity is invisible + invincible for `durationMs`
 * milliseconds (handled externally before attachment).  TeleportSystemService
 * watches for `isComplete()` and then snaps the entity's position to
 * (targetX, targetY), restores opacity, removes InvincibilityComponent, and
 * removes this component.
 *
 * Campaign B — Sprint B4.
 */
export class TeleportEffectComponent implements Component {
  public targetX: number;
  public targetY: number;
  public startTime: number;
  public durationMs: number;
  public originalOpacity: number;
  /** Flips true once the system has snapped position to target (guards against double-snap). */
  public arrived: boolean;

  constructor(...args: unknown[]) {
    this.targetX = (args[0] as number) ?? 0;
    this.targetY = (args[1] as number) ?? 0;
    this.startTime = (args[2] as number) ?? Date.now();
    this.durationMs = (args[3] as number) ?? 250;
    this.originalOpacity = (args[4] as number) ?? 1.0;
    this.arrived = (args[5] as boolean) ?? false;
  }

  /** Progress through the blink: 0 at start, 1 at completion. */
  getProgress(): number {
    return Math.min((Date.now() - this.startTime) / this.durationMs, 1);
  }

  /** Returns true once the blink duration has fully elapsed. */
  isComplete(): boolean {
    return this.getProgress() >= 1;
  }
}
