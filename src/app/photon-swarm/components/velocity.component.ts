import { Component } from '../core/ecs/ecs.model';

/**
 * Velocity component - represents an entity's movement in 2D space
 */
export class VelocityComponent implements Component {
  public vx: number;
  public vy: number;

  constructor(...args: unknown[]) {
    this.vx = (args[0] as number) ?? 0;
    this.vy = (args[1] as number) ?? 0;
  }
}
