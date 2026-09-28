import { Component } from '../core/ecs/ecs.model';

export class AccelerationComponent implements Component {
  public currentSpeed: number;
  public targetSpeed: number;
  public accelerationRate: number;
  public decelerationRate: number;

  constructor(...args: unknown[]) {
    this.currentSpeed = (args[0] as number) ?? 0;
    this.targetSpeed = (args[1] as number) ?? 0;
    this.accelerationRate = (args[2] as number) ?? 0.1;
    this.decelerationRate = (args[3] as number) ?? 0.15;
  }

  /**
   * Smoothly interpolate current speed toward target
   * @param target - Target speed to reach
   * @param deltaSeconds - Time delta to scale interpolation (frame-rate independent)
   */
  lerp(target: number, deltaSeconds: number): void {
    const baseRate = this.currentSpeed > target ? this.decelerationRate : this.accelerationRate;
    // Scale by deltaSeconds for frame-rate independent interpolation
    const scaledRate = Math.min(1, baseRate * deltaSeconds * 60); // 60 = target FPS baseline
    this.currentSpeed += (target - this.currentSpeed) * scaledRate;

    if (Math.abs(this.currentSpeed - target) < 0.01) {
      this.currentSpeed = target;
    }
  }
}
