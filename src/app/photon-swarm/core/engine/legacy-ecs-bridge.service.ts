import { Injectable } from '@angular/core';
import { EntityManagerService } from '../ecs/entity-manager.service';
import {
  CollisionBoxComponent,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  VelocityComponent,
} from '@photon/components';
import { LegacyEnemy } from '../models/game-types.model';

/**
 * ECS → legacy-DTO query facade, extracted from GameEngineService
 * (Photon-Swarm decomposition plan, Phase B).
 *
 * Pure read: maps ECS entities/components to the pre-ECS legacy shape still
 * consumed by DebugConsoleComponent. Never mutates entity state.
 *
 * getProjectiles() was NOT moved here: a repo-wide grep found zero callers of
 * GameEngineService.getProjectiles() (it is unrelated to
 * RenderingSystemService's own private getProjectiles(), which has real
 * callers), so it was deleted as dead code rather than relocated.
 */
@Injectable({ providedIn: 'root' })
export class LegacyEcsBridgeService {
  constructor(private entityManager: EntityManagerService) {}

  getEnemies(): LegacyEnemy[] {
    // Bridge to ECS entities with enemy components
    const enemies: LegacyEnemy[] = [];
    const enemyEntities = this.entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);

    for (const entityId of enemyEntities) {
      const position = this.entityManager.getComponent(entityId, PositionComponent);
      const velocity = this.entityManager.getComponent(entityId, VelocityComponent);
      const enemyType = this.entityManager.getComponent(entityId, EnemyTypeComponent);
      const health = this.entityManager.getComponent(entityId, HealthComponent);
      const collisionBox = this.entityManager.getComponent(entityId, CollisionBoxComponent);

      if (position && enemyType) {
        // Convert to legacy format for compatibility
        enemies.push({
          id: entityId.toString(),
          x: position.x,
          y: position.y,
          vx: velocity?.vx || 0,
          vy: velocity?.vy || 0,
          radius: collisionBox?.radius ?? 20,
          type: enemyType.type,
          health: health?.health || 0,
          maxHealth: health?.maxHealth || 100,
        });
      }
    }

    return enemies;
  }
}
