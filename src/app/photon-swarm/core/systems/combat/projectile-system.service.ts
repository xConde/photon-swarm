import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { Subject } from 'rxjs';
import {
  ChargedProjectileComponent,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  ProjectileComponent,
  SourceTagComponent,
  VelocityComponent,
} from '@photon/components';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PoolType } from '@photon/config/game-constants';
import { MathUtilsService } from '../../utils/math-utils.service';

/**
 * Projectile event data
 */
export interface ProjectileEvent {
  entityId: number;
  type: 'spawn' | 'destroy' | 'hit' | 'expire' | 'bounds';
  position: { x: number; y: number };
  reason?: string;
  timestamp: number;
}

/**
 * Projectile system configuration
 */
interface ProjectileConfig {
  worldBounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  cullMargin: number; // Extra margin outside bounds before culling
  enableHoming: boolean;
  homingStrength: number;
  homingRange: number;
}

/**
 * ECS ProjectileSystem - manages projectile movement, lifetime, and behaviors
 *
 * Features:
 * - Physics-based movement with velocity integration
 * - Lifetime management and automatic cleanup
 * - World bounds culling with margin
 * - Homing projectile behavior
 * - Health-based projectile durability
 * - Performance-optimized ECS queries
 *
 * This system replaces the legacy ProjectileSystemService with proper ECS architecture
 */
@Injectable({
  providedIn: 'root',
})
export class ProjectileSystemService implements System {
  constructor(
    private debugLog: DebugLogBridgeService,
    private entityFactory: EntityFactoryECSService
  ) {}

  private config: ProjectileConfig = {
    worldBounds: {
      minX: -100,
      maxX: 12100,
      minY: -100,
      maxY: 9100,
    },
    cullMargin: 100,
    enableHoming: true,
    homingStrength: 2.5,
    homingRange: 300,
  };

  // Event streams
  private projectileSubject = new Subject<ProjectileEvent>();
  public projectile$ = this.projectileSubject.asObservable();

  // Performance tracking
  private activeProjectiles = 0;
  private projectilesCreated = 0;
  private projectilesDestroyed = 0;

  /**
   * Initialize the projectile system
   */
  init(_entityManager: EntityManager): void {
    this.resetStatistics();
  }

  /**
   * Main system update - handles projectile movement and lifecycle
   */
  update(deltaTime: number, entityManager: EntityManager): void {
    // Get all projectile entities
    const projectileEntities = this.getProjectileEntities(entityManager);
    this.activeProjectiles = projectileEntities.length;

    for (const entityId of projectileEntities) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(entityId)) {
        continue;
      }

      // Update projectile movement
      this.updateProjectileMovement(entityId, deltaTime, entityManager);

      // Update homing behavior
      if (this.config.enableHoming) {
        this.updateHomingBehavior(entityId, deltaTime, entityManager);
      }

      // Check lifetime expiration
      if (this.checkLifetimeExpired(entityId, entityManager)) {
        this.destroyProjectile(entityId, 'expired', entityManager);
        continue;
      }

      // Check world bounds
      if (this.checkOutOfBounds(entityId, entityManager)) {
        this.destroyProjectile(entityId, 'bounds', entityManager);
        continue;
      }
    }
  }

  /**
   * Get all entities with projectile components
   */
  private getProjectileEntities(entityManager: EntityManager): number[] {
    return entityManager
      .getEntitiesWithComponents(PositionComponent, VelocityComponent, ProjectileComponent)
      .filter((entityId) => this.entityFactory.isEntityActive(entityId));
  }

  /**
   * Update projectile position based on velocity
   */
  private updateProjectileMovement(entityId: number, deltaTime: number, entityManager: EntityManager): void {
    const position = entityManager.getComponent(entityId, PositionComponent);
    const velocity = entityManager.getComponent(entityId, VelocityComponent);

    if (!position || !velocity) return;

    // Convert deltaTime from milliseconds to seconds
    const deltaSeconds = deltaTime / 1000;

    // Update position with velocity integration
    position.x += velocity.vx * deltaSeconds;
    position.y += velocity.vy * deltaSeconds;
  }

  /**
   * Update homing behavior for projectiles
   */
  private updateHomingBehavior(entityId: number, deltaTime: number, entityManager: EntityManager): void {
    const projectile = entityManager.getComponent(entityId, ProjectileComponent);
    const position = entityManager.getComponent(entityId, PositionComponent);
    const velocity = entityManager.getComponent(entityId, VelocityComponent);

    if (!projectile || !position || !velocity || !projectile.homing) return;

    // Find nearest enemy within homing range
    const target = this.findNearestEnemy(position, entityManager);
    if (!target) return;

    const targetPos = entityManager.getComponent(target, PositionComponent);
    if (!targetPos) return;

    // Calculate distance to target
    const dx = targetPos.x - position.x;
    const dy = targetPos.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Only home if within range; skip if overlapping target to avoid division by zero
    if (distance > this.config.homingRange || distance < 0.01) return;

    // Calculate normalized direction to target
    const dirX = dx / distance;
    const dirY = dy / distance;

    // Current speed magnitude
    const currentSpeed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);

    // Apply homing strength (gradually turn towards target)
    const homingForce = this.config.homingStrength * (deltaTime / 1000);
    velocity.vx += dirX * homingForce * currentSpeed;
    velocity.vy += dirY * homingForce * currentSpeed;

    // Maintain original speed
    const newSpeed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
    if (newSpeed > 0) {
      velocity.vx = (velocity.vx / newSpeed) * currentSpeed;
      velocity.vy = (velocity.vy / newSpeed) * currentSpeed;
    }
  }

  /**
   * Find nearest enemy within range for homing
   */
  private findNearestEnemy(position: PositionComponent, entityManager: EntityManager): number | null {
    const enemies = entityManager.getEntitiesWithComponents(PositionComponent, EnemyTypeComponent);
    let nearestEnemy: number | null = null;
    let nearestDistance = Infinity;

    for (const enemyId of enemies) {
      if (!this.entityFactory.isEntityActive(enemyId)) continue;
      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      if (!enemyPos) continue;

      const distance = MathUtilsService.distance(position.x, position.y, enemyPos.x, enemyPos.y);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = enemyId;
      }
    }

    return nearestEnemy;
  }

  /**
   * Check if projectile lifetime has expired
   */
  private checkLifetimeExpired(entityId: number, entityManager: EntityManager): boolean {
    const projectile = entityManager.getComponent(entityId, ProjectileComponent);
    if (!projectile) return false;

    const currentTime = window.performance.now();
    return currentTime - projectile.spawnTime >= projectile.lifetime;
  }

  /**
   * Check if projectile is outside world bounds
   */
  private checkOutOfBounds(entityId: number, entityManager: EntityManager): boolean {
    const position = entityManager.getComponent(entityId, PositionComponent);
    if (!position) return false;

    const bounds = this.config.worldBounds;
    return position.x < bounds.minX || position.x > bounds.maxX || position.y < bounds.minY || position.y > bounds.maxY;
  }

  /**
   * Destroy a projectile and emit event
   */
  destroyProjectile(entityId: number, reason: string, entityManager: EntityManager): void {
    const position = entityManager.getComponent(entityId, PositionComponent);

    // Emit destruction event
    const event: ProjectileEvent = {
      entityId,
      type: 'destroy',
      position: position ? { x: position.x, y: position.y } : { x: 0, y: 0 },
      reason,
      timestamp: window.performance.now(),
    };

    this.projectileSubject.next(event);

    // Return projectile to pool - check if it's a charged projectile first
    if (entityManager.hasComponent(entityId, ChargedProjectileComponent)) {
      this.entityFactory.returnToPool(PoolType.CHARGED_PROJECTILE, entityId);
    } else {
      this.entityFactory.returnToPool(PoolType.PROJECTILE, entityId);
    }
    this.projectilesDestroyed++;
  }

  /**
   * Handle projectile damage (called by collision system)
   */
  damageProjectile(entityId: number, damage: number, entityManager: EntityManager): boolean {
    const projectile = entityManager.getComponent(entityId, ProjectileComponent);
    const health = entityManager.getComponent(entityId, HealthComponent);

    if (!projectile || !health) return false;

    const previousHealth = health.health;
    // Apply damage
    health.health = Math.max(0, health.health - damage);

    // Log projectile damage
    if (damage > 0) {
      this.debugLog.log(`🎯 Projectile damaged`, 'info', {
        source: 'projectile_system',
        operation: 'damage_projectile',
        entityId,
        damage,
        healthBefore: previousHealth,
        healthAfter: health.health,
        destroyed: health.health <= 0,
      });
    }

    // Check if projectile is destroyed
    if (health.health <= 0) {
      this.destroyProjectile(entityId, 'damaged', entityManager);
      return true; // Projectile destroyed
    }

    return false; // Projectile survived
  }

  /**
   * Create projectile spawn event
   */
  notifyProjectileSpawned(entityId: number, position: { x: number; y: number }): void {
    const event: ProjectileEvent = {
      entityId,
      type: 'spawn',
      position,
      timestamp: window.performance.now(),
    };

    this.projectileSubject.next(event);
    this.projectilesCreated++;
  }

  /**
   * Get projectiles by source (player/enemy)
   */
  getProjectilesBySource(source: 'player' | 'enemy', entityManager: EntityManager): number[] {
    return this.getProjectileEntities(entityManager).filter((entityId) => {
      const sourceTag = entityManager.getComponent(entityId, SourceTagComponent);
      return sourceTag && sourceTag.source === source;
    });
  }

  /**
   * Get projectiles within radius of position
   */
  getProjectilesInRadius(position: { x: number; y: number }, radius: number, entityManager: EntityManager): number[] {
    return this.getProjectileEntities(entityManager).filter((entityId) => {
      const projectilePos = entityManager.getComponent(entityId, PositionComponent);
      if (!projectilePos) return false;

      const distance = MathUtilsService.distance(position.x, position.y, projectilePos.x, projectilePos.y);

      return distance <= radius;
    });
  }

  /**
   * Update world bounds for projectile culling
   */
  setWorldBounds(minX: number, maxX: number, minY: number, maxY: number): void {
    this.config.worldBounds = {
      minX: minX - this.config.cullMargin,
      maxX: maxX + this.config.cullMargin,
      minY: minY - this.config.cullMargin,
      maxY: maxY + this.config.cullMargin,
    };
  }

  /**
   * Update homing configuration
   */
  setHomingConfig(enabled: boolean, strength: number = 2.5, range: number = 300): void {
    this.config.enableHoming = enabled;
    this.config.homingStrength = strength;
    this.config.homingRange = range;
  }

  /**
   * Get projectile system statistics
   */
  getProjectileStats(): {
    active: number;
    created: number;
    destroyed: number;
    cullMargin: number;
    homingEnabled: boolean;
  } {
    return {
      active: this.activeProjectiles,
      created: this.projectilesCreated,
      destroyed: this.projectilesDestroyed,
      cullMargin: this.config.cullMargin,
      homingEnabled: this.config.enableHoming,
    };
  }

  /**
   * Clear all projectiles
   */
  clearAllProjectiles(entityManager: EntityManager): void {
    const projectiles = this.getProjectileEntities(entityManager);
    const count = projectiles.length;

    for (const entityId of projectiles) {
      this.destroyProjectile(entityId, 'cleared', entityManager);
    }

    // Log projectile clear
    if (count > 0) {
      this.debugLog.log(`🧹 Cleared all ${count} projectiles`, 'info', {
        source: 'projectile_system',
        operation: 'clear_all',
        clearedCount: count,
        totalCreated: this.projectilesCreated,
        totalDestroyed: this.projectilesDestroyed,
      });
    }
  }

  /**
   * Reset statistics
   */
  private resetStatistics(): void {
    this.activeProjectiles = 0;
    this.projectilesCreated = 0;
    this.projectilesDestroyed = 0;
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    this.projectileSubject.complete();
    this.resetStatistics();
  }
}
