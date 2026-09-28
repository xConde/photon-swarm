import { PoolType } from '@photon/config/game-constants';

/**
 * Tracks the state of pooled entities to prevent processing of inactive entities
 */
export interface PooledEntityState {
  isPooled: boolean;
  poolType?: PoolType;
  pooledAt?: number;
}

/**
 * Service to track which entities are currently pooled
 * This prevents systems from processing entities that are waiting in pools
 */
export class PooledEntityTracker {
  private pooledEntities = new Map<number, PooledEntityState>();

  markAsPooled(entityId: number, poolType: PoolType): void {
    this.pooledEntities.set(entityId, {
      isPooled: true,
      poolType,
      pooledAt: window.performance.now(),
    });
  }

  markAsActive(entityId: number): void {
    this.pooledEntities.delete(entityId);
  }

  isPooled(entityId: number): boolean {
    return this.pooledEntities.get(entityId)?.isPooled ?? false;
  }

  getPooledEntityCount(): number {
    return this.pooledEntities.size;
  }

  getPooledEntitiesByType(poolType: PoolType): number[] {
    const entities: number[] = [];
    this.pooledEntities.forEach((state, entityId) => {
      if (state.poolType === poolType) {
        entities.push(entityId);
      }
    });
    return entities;
  }

  clear(): void {
    this.pooledEntities.clear();
  }
}
