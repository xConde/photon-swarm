import { Component } from '../core/ecs/ecs.model';

/**
 * BurnEffect component - tracks burn damage over time
 */
export class BurnEffectComponent implements Component {
  public burnDamage: number;
  public burnDuration: number;
  public burnStartTime: number;
  public lastBurnTick: number;
  public burnVisualIntensity: number;
  // When true, this burn can spread to nearby enemies (spread burns have canSpread=false)
  public canSpread: boolean;

  /**
   * CRITICAL: Must use (...args: unknown[]) for ECS ComponentType<T> compatibility
   * The ECS factory requires this signature.
   */
  constructor(...args: unknown[]) {
    this.burnDamage = (args[0] as number) ?? 0;
    this.burnDuration = (args[1] as number) ?? 500;
    this.burnStartTime = (args[2] as number) ?? Date.now();
    this.lastBurnTick = (args[3] as number) ?? 0;
    this.burnVisualIntensity = (args[4] as number) ?? 1;
    this.canSpread = (args[5] as boolean) ?? false;
  }

  /**
   * Check if burn effect has expired
   */
  isExpired(currentTime: number): boolean {
    return currentTime - this.burnStartTime > this.burnDuration;
  }
}
