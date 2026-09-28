import { Component } from '../core/ecs/ecs.model';

/**
 * Position component - represents an entity's location in 2D space
 */
export class PositionComponent implements Component {
  public x: number;
  public y: number;

  constructor(...args: unknown[]) {
    this.x = (args[0] as number) ?? 0;
    this.y = (args[1] as number) ?? 0;
  }
}
