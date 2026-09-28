import { Component } from '../core/ecs/ecs.model';

/**
 * Projectile component - marks entity as a projectile with properties
 */
export class ProjectileComponent implements Component {
  public damage: number;
  public lifetime: number;
  public spawnTime: number;
  public health: number;
  public penetrating: boolean;
  public homing: boolean;
  public isCritical: boolean;
  public isPlayerOwned: boolean; // For parry reflection - reflected projectiles damage enemies

  constructor(...args: unknown[]) {
    this.damage = (args[0] as number) ?? 0;
    this.lifetime = (args[1] as number) ?? 0;
    this.spawnTime = (args[2] as number) ?? 0;
    this.health = (args[3] as number) ?? 1;
    this.penetrating = (args[4] as boolean) ?? false;
    this.homing = (args[5] as boolean) ?? false;
    this.isCritical = (args[6] as boolean) ?? false;
    this.isPlayerOwned = (args[7] as boolean) ?? false; // Default: enemy projectiles
  }

  /**
   * Check if projectile has expired
   */
  isExpired(currentTime: number): boolean {
    return currentTime - this.spawnTime > this.lifetime;
  }
}
