/**
 * Core ECS (Entity-Component-System) interfaces for Photon Swarm
 * These form the foundation of the game's architecture
 */

/**
 * Entity - A unique identifier for a game object
 * Entities are just IDs that components attach to
 */
export type Entity = number;

/**
 * Component - A container for data only, no logic
 * Components are plain data holders that get attached to entities
 */
// Intentionally structural: every ECS data-holder class implements this marker.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Component {}

/**
 * System - Contains game logic that operates on entities with specific components
 * Systems query for entities with certain component combinations and update them
 */
export interface System {
  /**
   * Called once when the system is initialized
   * @param entityManager The entity manager instance for querying/modifying entities
   */
  init?(entityManager: EntityManager): void;

  /**
   * Called every frame to update the system
   * @param deltaTime Time elapsed since last frame in milliseconds
   * @param entityManager The entity manager instance for querying/modifying entities
   */
  update(deltaTime: number, entityManager: EntityManager): void;

  /**
   * Optional reusable-state cleanup between game sessions.
   * Unlike destroy(), reset() must leave observables and subscriptions usable.
   */
  reset?(): void;

  /**
   * Optional per-run entity reconstruction after the engine clears the ECS world.
   * Use this for systems that own entities which must exist at the start of every
   * run. Unlike init(), this hook may be called repeatedly on the same service.
   */
  initializeRun?(entityManager: EntityManager): void;

  /**
   * Optional cleanup when the system is destroyed
   */
  destroy?(): void;
}

/**
 * EntityManager interface - Core API for managing entities and components
 * This will be implemented by the entity-manager.service.ts
 */
export interface EntityManager {
  createEntity(): Entity;
  destroyEntity(entity: Entity): void;
  addComponent<T extends Component>(entity: Entity, component: T): void;
  removeComponent<T extends Component>(entity: Entity, componentType: ComponentType<T>): void;
  getComponent<T extends Component>(entity: Entity, componentType: ComponentType<T>): T | undefined;
  hasComponent<T extends Component>(entity: Entity, componentType: ComponentType<T>): boolean;
  getEntitiesWithComponents(...componentTypes: Array<ComponentType>): Entity[];
  hasEntity(entity: Entity): boolean;
  getComponents(entity: Entity): Map<ComponentType, Component> | undefined;
}

/**
 * ComponentType - Type helper for component constructors
 */
export type ComponentType<T extends Component = Component> = new (...args: unknown[]) => T;

/**
 * SystemType - Type helper for system constructors
 */
export type SystemType<T extends System = System> = new (...args: unknown[]) => T;
