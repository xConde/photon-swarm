import { Component } from '../core/ecs/ecs.model';

/**
 * Discharge Effect Component
 * Represents a discharge explosion effect
 */
export class DischargeEffectComponent implements Component {
  public radius: number;
  public maxRadius: number;
  public expansionRate: number;
  public duration: number;
  public elapsed: number;

  constructor(...args: unknown[]) {
    // CRITICAL FIX: Start discharge effect small and expand outward
    // Previous default of 100 was causing giant white circles
    this.radius = (args[0] as number) ?? 5; // Start very small!
    this.maxRadius = (args[1] as number) ?? 50; // Much smaller max radius
    this.expansionRate = (args[2] as number) ?? 150; // Much slower expansion
    this.duration = (args[3] as number) ?? 0.3;
    this.elapsed = (args[4] as number) ?? 0;
  }

  static readonly type = 'DischargeEffectComponent';

  clone(): DischargeEffectComponent {
    return new DischargeEffectComponent(this.radius, this.maxRadius, this.expansionRate, this.duration, this.elapsed);
  }

  update(deltaTime: number): void {
    this.elapsed += deltaTime / 1000;
    if (this.elapsed < this.duration) {
      this.radius = Math.min(this.maxRadius, this.radius + this.expansionRate * (deltaTime / 1000));
    }
  }

  isExpired(): boolean {
    return this.elapsed >= this.duration;
  }
}
