import { Injectable } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PoolType } from '@photon/config/game-constants';
import {
  ChargedProjectileComponent,
  DeathAnimationComponent,
  EnemyTypeComponent,
  FloatingTextComponent,
  ProjectileComponent,
  RenderableComponent,
  ShardComponent,
} from '@photon/components';

// Extend RenderableComponent with scale for death animations
interface ScalableRenderable extends RenderableComponent {
  scale?: number;
}

/**
 * Death Animation System
 *
 * Processes death animations and manages entity cleanup
 * when animations complete. Provides smooth fade/flash effects
 * instead of instant disappearance.
 */
@Injectable({ providedIn: 'root' })
export class DeathAnimationSystemService implements System {
  constructor(private entityFactory: EntityFactoryECSService) {}

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    // Find all entities with death animations
    const animatingEntities = entityManager.getEntitiesWithComponents(DeathAnimationComponent);

    for (const entityId of animatingEntities) {
      const deathAnimation = entityManager.getComponent(entityId, DeathAnimationComponent);
      const renderable = entityManager.getComponent(entityId, RenderableComponent);

      if (!deathAnimation) continue;

      if (deathAnimation.isComplete()) {
        // Animation complete - return to pool based on entity type
        if (entityManager.hasComponent(entityId, ChargedProjectileComponent)) {
          this.entityFactory.returnToPool(PoolType.CHARGED_PROJECTILE, entityId);
        } else if (entityManager.hasComponent(entityId, ProjectileComponent)) {
          this.entityFactory.returnToPool(PoolType.PROJECTILE, entityId);
        } else if (entityManager.hasComponent(entityId, EnemyTypeComponent)) {
          this.entityFactory.returnToPool(PoolType.ENEMY, entityId);
        } else if (entityManager.hasComponent(entityId, ShardComponent)) {
          this.entityFactory.returnToPool(PoolType.SHARD, entityId);
        } else if (entityManager.hasComponent(entityId, FloatingTextComponent)) {
          this.entityFactory.returnToPool(PoolType.FLOATING_TEXT, entityId);
        } else {
          // For other entities, just destroy normally
          entityManager.destroyEntity(entityId);
        }
      } else if (renderable) {
        // Update renderable properties based on animation progress
        renderable.opacity = deathAnimation.getCurrentOpacity();

        // Apply scale for shrink animations (if the rendering system supports it)
        if (deathAnimation.animationType === 'shrink') {
          // Store scale in a custom property - rendering system can use this
          const scalableRenderable = renderable as ScalableRenderable;
          scalableRenderable.scale = deathAnimation.getCurrentScale();
        }
      }
    }
  }
}
