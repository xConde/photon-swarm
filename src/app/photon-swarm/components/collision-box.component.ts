import { Component } from '../core/ecs/ecs.model';

/**
 * CollisionBox component - defines entity's collision bounds
 */
export class CollisionBoxComponent implements Component {
  public radius: number;
  public collisionGroup: 'player' | 'enemy' | 'projectile' | 'shard' | 'asteroid' | 'powerup';
  public collidesWith: string[];

  constructor(...args: unknown[]) {
    this.radius = (args[0] as number) ?? 0;
    this.collisionGroup = (args[1] as 'player' | 'enemy' | 'projectile' | 'shard' | 'asteroid' | 'powerup') ?? 'enemy';
    this.collidesWith = (args[2] as string[]) ?? ['all'];
  }
}
