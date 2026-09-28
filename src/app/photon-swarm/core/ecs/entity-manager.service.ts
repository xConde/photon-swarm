import { Injectable, isDevMode } from '@angular/core';
import { Component, ComponentType, Entity, EntityManager as IEntityManager } from './ecs.model';
import { ECSError, ErrorHandlerService } from '../utils/error-handler.service';
import { EnemyTypeComponent, HealthComponent } from '@photon/components';

/**
 * EntityManagerService - Core service for managing entities and their components
 * Implements the ECS pattern for the Photon Swarm game
 */
@Injectable({
  providedIn: 'root',
})
export class EntityManagerService implements IEntityManager {
  private nextEntityId = 1;
  private entities = new Set<Entity>();
  private componentStore = new Map<Entity, Map<ComponentType, Component>>();
  private componentIndex = new Map<ComponentType, Set<Entity>>();
  private queryCache = new Map<string, Entity[]>();
  private queryCacheDirty = false;
  private queryKeyCache = new Map<string, string>();
  private static readonly MAX_QUERY_CACHE_SIZE = 256;

  constructor(private errorHandler: ErrorHandlerService) {}

  /**
   * Marks the query cache as dirty.
   * The cache is cleared lazily on the next call to getEntitiesWithComponents(),
   * coalescing all mutations within a frame into a single clear().
   */
  private invalidateQueryCache(): void {
    this.queryCacheDirty = true;
  }

  /**
   * Returns a stable sorted cache key for the given component types.
   * Uses queryKeyCache to avoid repeated .sort() + .join() allocations on
   * hot paths where systems always query the same component combinations.
   */
  private getQueryKey(componentTypes: ComponentType[]): string {
    let rawKey = '';
    for (let i = 0; i < componentTypes.length; i++) {
      if (i > 0) rawKey += '+';
      rawKey += componentTypes[i].name;
    }

    let sortedKey = this.queryKeyCache.get(rawKey);
    if (!sortedKey) {
      sortedKey = componentTypes
        .map((ct) => ct.name)
        .sort()
        .join('+');
      this.queryKeyCache.set(rawKey, sortedKey);
      // Map sorted key to itself so direct hits skip the sort too
      this.queryKeyCache.set(sortedKey, sortedKey);
    }
    return sortedKey;
  }

  /**
   * Creates a new entity with a unique ID
   */
  createEntity(): Entity {
    const entity = this.nextEntityId++;
    this.entities.add(entity);
    this.componentStore.set(entity, new Map());
    this.invalidateQueryCache();
    return entity;
  }

  /**
   * Destroys an entity and all its components
   */
  destroyEntity(entity: Entity): void {
    if (!this.entities.has(entity)) {
      return;
    }

    // Log enemy entity destruction with health details
    const components = this.componentStore.get(entity);
    if (components && window.debugLogBridge) {
      // Check if this is an enemy entity
      const hasEnemyType = components.has(EnemyTypeComponent);
      if (hasEnemyType) {
        const healthComp = components.get(HealthComponent) as HealthComponent | undefined;
        const enemyTypeComp = components.get(EnemyTypeComponent) as EnemyTypeComponent | undefined;

        if (healthComp) {
          const healthPercent = (healthComp.health / healthComp.maxHealth) * 100;

          // FIXED: Only log critical warnings for suspicious deaths without expensive stack trace
          // This was being called on EVERY enemy death in production
          if (healthPercent > 10 && isDevMode()) {
            window.debugLogBridge.log(`WARNING: Enemy destroyed with ${healthPercent.toFixed(1)}% health!`, 'error', {
              source: 'entity_manager',
              operation: 'destroy_entity',
              entityId: entity,
              health: healthComp.health,
              maxHealth: healthComp.maxHealth,
              healthPercent: healthPercent.toFixed(1),
              enemyType: enemyTypeComp?.type || 'unknown',
              // Removed expensive stack trace generation from hot path
            });
          }
        }
      }
    }

    // Remove entity from all component indices and clean up components
    if (components) {
      for (const [componentType, component] of components) {
        // Call destroy() on components that implement it to clean up Maps/Sets
        if (component && typeof (component as { destroy?: () => void }).destroy === 'function') {
          (component as { destroy: () => void }).destroy();
        }

        const index = this.componentIndex.get(componentType);
        if (index) {
          index.delete(entity);
          if (index.size === 0) {
            this.componentIndex.delete(componentType);
          }
        }
      }
    }

    // Clean up entity data
    this.componentStore.delete(entity);
    this.entities.delete(entity);
    this.invalidateQueryCache();
  }

  /**
   * Adds a component to an entity
   */
  addComponent<T extends Component>(entity: Entity, component: T): void {
    if (!this.entities.has(entity)) {
      const error = new ECSError(`Attempted to add component to non-existent entity ${entity}`, entity);
      this.errorHandler.handleECSError(error, entity, component.constructor.name);
      return;
    }

    try {
      const componentType = component.constructor as ComponentType<T>;
      const entityComponents = this.componentStore.get(entity);
      if (!entityComponents) {
        throw new Error(`Entity ${entity} has no component store`);
      }
      entityComponents.set(componentType, component);

      // Update component index
      if (!this.componentIndex.has(componentType)) {
        this.componentIndex.set(componentType, new Set());
      }
      const index = this.componentIndex.get(componentType);
      if (index) {
        index.add(entity);
      }

      this.invalidateQueryCache();
    } catch (error) {
      this.errorHandler.handleECSError(error as Error, entity, component.constructor.name);
      throw error;
    }
  }

  /**
   * Removes a component from an entity
   */
  removeComponent<T extends Component>(entity: Entity, componentType: ComponentType<T>): void {
    if (!this.entities.has(entity)) {
      return;
    }

    const entityComponents = this.componentStore.get(entity);
    if (entityComponents) {
      entityComponents.delete(componentType);
    }

    // Update component index
    const index = this.componentIndex.get(componentType);
    if (index) {
      index.delete(entity);
      if (index.size === 0) {
        this.componentIndex.delete(componentType);
      }
    }

    this.invalidateQueryCache();
  }

  /**
   * Gets a component from an entity
   */
  getComponent<T extends Component>(entity: Entity, componentType: ComponentType<T>): T | undefined {
    if (!this.entities.has(entity)) {
      return undefined;
    }

    try {
      const entityComponents = this.componentStore.get(entity);
      if (!entityComponents) {
        return undefined;
      }
      return entityComponents.get(componentType) as T | undefined;
    } catch (error) {
      this.errorHandler.handleECSError(error as Error, entity, componentType.name);
      return undefined;
    }
  }

  /**
   * Checks if an entity has a specific component
   */
  hasComponent<T extends Component>(entity: Entity, componentType: ComponentType<T>): boolean {
    if (!this.entities.has(entity)) {
      return false;
    }

    const entityComponents = this.componentStore.get(entity);
    return entityComponents ? entityComponents.has(componentType) : false;
  }

  /**
   * Gets all entities that have all the specified components
   */
  getEntitiesWithComponents(...componentTypes: ComponentType[]): Entity[] {
    if (componentTypes.length === 0) {
      return Array.from(this.entities);
    }

    // Batch invalidation: clear cache once on first query after any mutations
    if (this.queryCacheDirty) {
      this.queryCache.clear();
      this.queryCacheDirty = false;
    }

    // Generate cache key from sorted component type names (cached to avoid repeated allocations)
    const cacheKey = this.getQueryKey(componentTypes);
    const cached = this.queryCache.get(cacheKey);
    if (cached) {
      // PERFORMANCE: Returns cached array directly — callers MUST NOT mutate the result.
      // If mutation is needed, the caller should copy it themselves.
      return cached;
    }

    // Start with entities that have the first component type
    const firstType = componentTypes[0];
    const firstIndex = this.componentIndex.get(firstType);
    if (!firstIndex || firstIndex.size === 0) {
      this.queryCache.set(cacheKey, []);
      return [];
    }

    // Filter entities that have all required components
    const result: Entity[] = [];
    for (const entity of firstIndex) {
      let hasAll = true;
      for (let i = 1; i < componentTypes.length; i++) {
        if (!this.hasComponent(entity, componentTypes[i])) {
          hasAll = false;
          break;
        }
      }
      if (hasAll) {
        result.push(entity);
      }
    }

    if (this.queryCache.size >= EntityManagerService.MAX_QUERY_CACHE_SIZE) {
      this.queryCache.clear();
    }
    this.queryCache.set(cacheKey, result);
    // PERFORMANCE: Returns cached array directly — callers MUST NOT mutate the result.
    // If mutation is needed, the caller should copy it themselves.
    return result;
  }

  /**
   * Clears all entities and components (useful for game reset)
   */
  clear(): void {
    // Call destroy() on components that implement it to clean up internal state
    for (const components of this.componentStore.values()) {
      for (const component of components.values()) {
        if (component && typeof (component as { destroy?: () => void }).destroy === 'function') {
          (component as { destroy: () => void }).destroy();
        }
      }
    }
    this.entities.clear();
    this.componentStore.clear();
    this.componentIndex.clear();
    this.queryCache.clear();
    this.queryCacheDirty = false;
    this.queryKeyCache.clear();
    this.nextEntityId = 1;
  }

  /**
   * Gets the total number of active entities
   */
  getEntityCount(): number {
    return this.entities.size;
  }

  /**
   * Gets all active entities
   */
  getAllEntities(): Entity[] {
    return Array.from(this.entities);
  }

  /**
   * Checks if an entity exists in the manager
   */
  hasEntity(entity: Entity): boolean {
    return this.entities.has(entity);
  }

  /**
   * Gets all components for an entity (used for efficient removal)
   */
  getComponents(entity: Entity): Map<ComponentType, Component> | undefined {
    return this.componentStore.get(entity);
  }
}
