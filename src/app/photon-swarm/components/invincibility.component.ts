import { Component } from '../core/ecs/ecs.model';

/**
 * Component for entities that are temporarily invincible
 */
export class InvincibilityComponent implements Component {
  public readonly name = 'InvincibilityComponent';
  public duration: number = 1000;
  public startTime: number = window.performance.now();

  constructor(..._args: unknown[]) {
    // Duration and startTime should be set after construction
    // ECS-compatible constructor
  }

  isActive(): boolean {
    return window.performance.now() < this.startTime + this.duration;
  }

  getRemainingTime(): number {
    const remaining = this.startTime + this.duration - window.performance.now();
    return Math.max(0, remaining);
  }
}
