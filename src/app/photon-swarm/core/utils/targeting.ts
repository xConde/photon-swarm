import { EntityManager } from '../ecs/ecs.model';
import { EnemyTypeComponent, HealthComponent, PositionComponent } from '@photon/components';

/**
 * Find the nearest alive enemy to a given position.
 *
 * Shared by weapon-firing-system (projectile aim) and aiming-system (trajectory display)
 * to guarantee both always target the same entity.
 *
 * @returns {x, y, entityId} of the nearest alive enemy, or null if none exist.
 */
export function findNearestAliveEnemy(
  originX: number,
  originY: number,
  entityManager: EntityManager
): { x: number; y: number; entityId: number } | null {
  const enemies = entityManager.getEntitiesWithComponents(PositionComponent, EnemyTypeComponent, HealthComponent);
  let nearestDistSq = Infinity;
  let nearestX = 0;
  let nearestY = 0;
  let nearestId = 0;
  let found = false;

  for (const enemyId of enemies) {
    const health = entityManager.getComponent(enemyId, HealthComponent);
    if (!health || health.health <= 0) continue;

    const pos = entityManager.getComponent(enemyId, PositionComponent);
    if (!pos) continue;

    const dx = pos.x - originX;
    const dy = pos.y - originY;
    const distSq = dx * dx + dy * dy;

    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearestX = pos.x;
      nearestY = pos.y;
      nearestId = enemyId;
      found = true;
    }
  }

  return found ? { x: nearestX, y: nearestY, entityId: nearestId } : null;
}
