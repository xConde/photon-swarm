import { Component } from '../core/ecs/ecs.model';

/**
 * Asteroid Component
 * Marks an entity as an asteroid with specific properties
 */
export class AsteroidComponent implements Component {
  public size: number;
  public health: number;
  public rotationSpeed: number;
  public damage: number;

  constructor(...args: unknown[]) {
    this.size = (args[0] as number) ?? 30;
    this.health = (args[1] as number) ?? 100;
    this.rotationSpeed = (args[2] as number) ?? 0.5;
    this.damage = (args[3] as number) ?? 20;
  }

  static readonly type = 'AsteroidComponent';
}
