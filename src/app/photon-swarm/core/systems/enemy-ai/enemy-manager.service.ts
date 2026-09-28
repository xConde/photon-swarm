import { Injectable } from '@angular/core';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import {
  DeathAnimationComponent,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  RenderableComponent,
} from '@photon/components';
import { PoolType, SPAWN_CONFIG } from '@photon/config/game-constants';
import { MathUtilsService } from '../../utils/math-utils.service';
import { MonitorPerformance, PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Enemy Manager Service - Optimizes enemy lifecycle and performance
 *
 * Responsibilities:
 * - Control maximum enemy count for performance
 * - Clean up distant enemies
 * - Manage enemy distribution across the world
 * - Monitor enemy-related performance metrics
 */
@Injectable({
  providedIn: 'root',
})
export class EnemyManagerService {
  private readonly MAX_ENEMIES = SPAWN_CONFIG.LIMITS.MAX_ENEMIES;
  private readonly CLEANUP_DISTANCE = SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE;
  private readonly CLEANUP_FADE_DISTANCE = SPAWN_CONFIG.LIMITS.CLEANUP_FADE_DISTANCE;
  private readonly PERFORMANCE_CHECK_INTERVAL = 5000; // Check every 5 seconds
  private readonly FADE_ANIMATION_DURATION_MS = 400; // Shorter fade for cleanup (vs 600ms for death)

  private lastPerformanceCheck = 0;
  private lastCleanupCount = 0;
  private entitiesMarkedForFade = new Set<number>(); // Track enemies already fading

  constructor(
    private entityManager: EntityManagerService,
    private entityFactory: EntityFactoryECSService,
    private performanceMonitor: PerformanceMonitorService,
    private debugLog: DebugLogBridgeService
  ) {}

  /**
   * Get all enemy entities with their components
   */
  @MonitorPerformance('EnemyManager.getEnemies')
  getEnemies(): Array<{
    entityId: number;
    position: PositionComponent;
    enemyType: EnemyTypeComponent;
    health: HealthComponent;
  }> {
    const enemyEntities = this.entityManager.getEntitiesWithComponents(
      EnemyTypeComponent,
      PositionComponent,
      HealthComponent
    );

    return enemyEntities
      .map((entityId) => ({
        entityId,
        position: this.entityManager.getComponent(entityId, PositionComponent),
        enemyType: this.entityManager.getComponent(entityId, EnemyTypeComponent),
        health: this.entityManager.getComponent(entityId, HealthComponent),
      }))
      .filter(
        (
          enemy
        ): enemy is {
          entityId: number;
          position: PositionComponent;
          enemyType: EnemyTypeComponent;
          health: HealthComponent;
        } => enemy.position !== undefined && enemy.enemyType !== undefined && enemy.health !== undefined
      );
  }

  /**
   * Get current enemy count
   */
  getEnemyCount(): number {
    return this.entityManager.getEntitiesWithComponents(EnemyTypeComponent).length;
  }

  /**
   * Check if we can spawn a new enemy (respecting performance limits)
   */
  canSpawnEnemy(): boolean {
    const currentCount = this.getEnemyCount();

    // Hard limit for performance
    if (currentCount >= this.MAX_ENEMIES) {
      return false;
    }

    // Dynamic limit based on performance
    const performanceSummary = this.performanceMonitor.getPerformanceSummary();
    if (
      performanceSummary.averageFps < SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_FPS &&
      currentCount > SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_ENEMIES
    ) {
      return false;
    }

    return true;
  }

  /**
   * Clean up distant enemies to maintain performance
   * Uses fade animation for visual polish instead of instant removal
   */
  @MonitorPerformance('EnemyManager.cleanupDistantEnemies')
  cleanupDistantEnemies(playerX: number, playerY: number): number {
    const enemies = this.getEnemies();
    let cleanedUp = 0;
    let markedForFade = 0;

    // Clean up tracking for destroyed entities
    this.cleanupFadeTracking();

    for (const enemy of enemies) {
      const distance = MathUtilsService.distance(playerX, playerY, enemy.position.x, enemy.position.y);

      // Skip enemies already marked for fade
      if (this.entitiesMarkedForFade.has(enemy.entityId)) {
        continue;
      }

      // Spawn immunity: skip enemies that were recently spawned (2 second grace period)
      const currentTime = window.performance.now();
      const renderableForImmunity = this.entityManager.getComponent(enemy.entityId, RenderableComponent);
      if (renderableForImmunity && currentTime - renderableForImmunity.spawnTime < 2000) {
        continue;
      }

      // Engagement check: skip enemies that have taken damage (health < maxHealth)
      // Players shouldn't have enemies they're fighting disappear on them
      const healthForCleanup = this.entityManager.getComponent(enemy.entityId, HealthComponent);
      if (healthForCleanup && healthForCleanup.health < healthForCleanup.maxHealth) {
        continue;
      }

      // Max lifetime safety cap: enemies older than 5 minutes are always cleaned up
      // This prevents unkillable or unreachable enemies from accumulating forever
      const MAX_ENEMY_LIFETIME_MS = 300000; // 5 minutes
      if (renderableForImmunity && currentTime - renderableForImmunity.spawnTime > MAX_ENEMY_LIFETIME_MS) {
        this.entityFactory.returnToPool(PoolType.ENEMY, enemy.entityId);
        this.entitiesMarkedForFade.delete(enemy.entityId);
        cleanedUp++;
        continue;
      }

      // Check if enemy already has a death animation (already dying)
      const existingDeathAnim = this.entityManager.getComponent(enemy.entityId, DeathAnimationComponent);
      if (existingDeathAnim) {
        continue;
      }

      // Hard cleanup at max distance (failsafe) - return to pool for reuse
      if (distance > this.CLEANUP_DISTANCE) {
        this.debugLog.log('Force removing very distant enemy', 'warning', {
          source: 'enemy_manager',
          operation: 'hard_cleanup',
          enemyId: enemy.entityId,
          distance: distance.toFixed(0),
          cleanupDistance: this.CLEANUP_DISTANCE,
        });
        // FIX: Use returnToPool instead of destroyEntity to preserve pool resources
        this.entityFactory.returnToPool(PoolType.ENEMY, enemy.entityId);
        this.entitiesMarkedForFade.delete(enemy.entityId);
        cleanedUp++;
        continue;
      }

      // Start fade animation at soft cleanup distance
      if (distance > this.CLEANUP_FADE_DISTANCE) {
        const renderable = this.entityManager.getComponent(enemy.entityId, RenderableComponent);

        if (renderable) {
          // Create and add death animation component for fade out
          const deathAnim = new DeathAnimationComponent(this.FADE_ANIMATION_DURATION_MS, 'fade');
          this.entityManager.addComponent(enemy.entityId, deathAnim);
          this.entitiesMarkedForFade.add(enemy.entityId);
          markedForFade++;

          this.debugLog.log('Fading distant enemy', 'info', {
            source: 'enemy_manager',
            operation: 'fade_cleanup',
            enemyId: enemy.entityId,
            distance: distance.toFixed(0),
            fadeDistance: this.CLEANUP_FADE_DISTANCE,
            animationDuration: this.FADE_ANIMATION_DURATION_MS,
          });
        } else {
          // No renderable, instant cleanup - still use pool for reuse
          // FIX: Use returnToPool instead of destroyEntity to preserve pool resources
          this.entityFactory.returnToPool(PoolType.ENEMY, enemy.entityId);
          cleanedUp++;
        }
      }
    }

    if (cleanedUp > 0 || markedForFade > 0) {
      this.debugLog.log(`Distance cleanup: ${cleanedUp} removed, ${markedForFade} fading`, 'info', {
        source: 'enemy_manager',
        operation: 'cleanup_distant_enemies',
        hardCleanedUp: cleanedUp,
        fadingOut: markedForFade,
        remainingEnemies: this.getEnemyCount(),
        playerPosition: [playerX.toFixed(0), playerY.toFixed(0)],
        fadeDistance: this.CLEANUP_FADE_DISTANCE,
        cleanupDistance: this.CLEANUP_DISTANCE,
      });
    }

    this.lastCleanupCount = cleanedUp + markedForFade;
    return cleanedUp + markedForFade;
  }

  /**
   * Clean up tracking set by removing entities that no longer exist
   */
  private cleanupFadeTracking(): void {
    const toRemove: number[] = [];
    for (const entityId of this.entitiesMarkedForFade) {
      if (!this.entityManager.getComponent(entityId, EnemyTypeComponent)) {
        toRemove.push(entityId);
      }
    }
    for (const id of toRemove) {
      this.entitiesMarkedForFade.delete(id);
    }
  }

  /**
   * Clean up tracking state for a dead enemy (called by death detection system)
   */
  public cleanupDeadEnemy(entityId: number): void {
    this.entitiesMarkedForFade.delete(entityId);
  }

  /**
   * Get enemies within a certain range of a position
   */
  @MonitorPerformance('EnemyManager.getEnemiesInRange')
  getEnemiesInRange(
    centerX: number,
    centerY: number,
    range: number
  ): Array<{
    entityId: number;
    position: PositionComponent;
    enemyType: EnemyTypeComponent;
    health: HealthComponent;
    distance: number;
  }> {
    const enemies = this.getEnemies();

    return enemies
      .map((enemy) => ({
        ...enemy,
        distance: MathUtilsService.distance(centerX, centerY, enemy.position.x, enemy.position.y),
      }))
      .filter((enemy) => enemy.distance <= range)
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Perform periodic optimization checks
   */
  @MonitorPerformance('EnemyManager.performanceOptimization')
  performanceOptimization(playerX: number, playerY: number): void {
    const now = Date.now();

    if (now - this.lastPerformanceCheck < this.PERFORMANCE_CHECK_INTERVAL) {
      return;
    }

    this.lastPerformanceCheck = now;

    const enemyCount = this.getEnemyCount();
    const performanceSummary = this.performanceMonitor.getPerformanceSummary();

    // Clean up distant enemies if we have too many or performance is poor
    if (enemyCount > 40 || performanceSummary.averageFps < 50) {
      this.cleanupDistantEnemies(playerX, playerY);
    }

    // Log performance metrics
    this.debugLog.log('Enemy performance monitoring', performanceSummary.averageFps < 50 ? 'warning' : 'info', {
      source: 'enemy_manager',
      operation: 'performance_monitor',
      enemyCount,
      maxEnemies: this.MAX_ENEMIES,
      averageFps: performanceSummary.averageFps,
      cleanupDistance: this.CLEANUP_DISTANCE,
      lastCleanup: this.lastCleanupCount,
      performanceScore: performanceSummary.performanceScore,
    });
  }

  /**
   * Get enemy distribution statistics
   */
  getEnemyDistribution(
    playerX: number,
    playerY: number
  ): {
    total: number;
    byType: Record<string, number>;
    byDistance: {
      near: number; // < 500 units
      medium: number; // 500-1000 units
      far: number; // 1000-2000 units
      veryFar: number; // > 2000 units
    };
    averageDistance: number;
  } {
    const enemies = this.getEnemies();
    const distribution = {
      total: enemies.length,
      byType: {} as Record<string, number>,
      byDistance: { near: 0, medium: 0, far: 0, veryFar: 0 },
      averageDistance: 0,
    };

    let totalDistance = 0;

    for (const enemy of enemies) {
      // Count by type
      const type = enemy.enemyType.type;
      distribution.byType[type] = (distribution.byType[type] || 0) + 1;

      // Count by distance
      const distance = MathUtilsService.distance(playerX, playerY, enemy.position.x, enemy.position.y);

      totalDistance += distance;

      if (distance < 500) {
        distribution.byDistance.near++;
      } else if (distance < 1000) {
        distribution.byDistance.medium++;
      } else if (distance < 2000) {
        distribution.byDistance.far++;
      } else {
        distribution.byDistance.veryFar++;
      }
    }

    distribution.averageDistance = enemies.length > 0 ? totalDistance / enemies.length : 0;

    return distribution;
  }

  /**
   * Force cleanup of all enemies (for game reset)
   * FIX: Uses returnToPool to preserve pool resources instead of destroying entities
   */
  clearAllEnemies(): number {
    const enemies = this.getEnemies();

    for (const enemy of enemies) {
      // FIX: Use returnToPool instead of destroyEntity to preserve pool resources
      this.entityFactory.returnToPool(PoolType.ENEMY, enemy.entityId);
    }

    // Clear fade tracking since all enemies are now pooled
    this.entitiesMarkedForFade.clear();

    this.debugLog.log(`Cleared all ${enemies.length} enemies (returned to pool)`, 'info', {
      source: 'enemy_manager',
      operation: 'clear_all_enemies',
      clearedCount: enemies.length,
    });

    return enemies.length;
  }

  /**
   * Get performance-optimized enemy positions for rendering
   */
  @MonitorPerformance('EnemyManager.getEnemyPositions')
  getEnemyPositionsForRendering(
    viewportX: number,
    viewportY: number,
    viewportWidth: number,
    viewportHeight: number
  ): Array<{ x: number; y: number; type: string; health: number }> {
    const enemies = this.getEnemies();

    // Only return enemies that are visible or near the viewport
    const buffer = 200; // Extra buffer around viewport

    return enemies
      .filter((enemy) => {
        const pos = enemy.position;
        return (
          pos.x >= viewportX - buffer &&
          pos.x <= viewportX + viewportWidth + buffer &&
          pos.y >= viewportY - buffer &&
          pos.y <= viewportY + viewportHeight + buffer
        );
      })
      .map((enemy) => ({
        x: enemy.position.x,
        y: enemy.position.y,
        type: enemy.enemyType.type,
        health: enemy.health.health / enemy.health.maxHealth,
      }));
  }
}
