import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from './entity-manager.service';
import { Component } from './ecs.model';

// Test components
class PositionComponent implements Component {
  x: number;
  y: number;
  constructor(...args: unknown[]) {
    this.x = (args[0] as number) ?? 0;
    this.y = (args[1] as number) ?? 0;
  }
}

class VelocityComponent implements Component {
  dx: number;
  dy: number;
  constructor(...args: unknown[]) {
    this.dx = (args[0] as number) ?? 0;
    this.dy = (args[1] as number) ?? 0;
  }
}

class HealthComponent implements Component {
  health: number;
  maxHealth: number;
  constructor(...args: unknown[]) {
    this.health = (args[0] as number) ?? 0;
    this.maxHealth = (args[1] as number) ?? 0;
  }
}

describe('EntityManagerService', () => {
  let service: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(EntityManagerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Entity Management', () => {
    it('should create entities with unique IDs', () => {
      const entity1 = service.createEntity();
      const entity2 = service.createEntity();
      expect(entity1).not.toEqual(entity2);
      expect(service.getEntityCount()).toBe(2);
    });

    it('should destroy entities', () => {
      const entity = service.createEntity();
      service.destroyEntity(entity);
      expect(service.getEntityCount()).toBe(0);
    });

    it('should handle destroying non-existent entities gracefully', () => {
      expect(() => service.destroyEntity(999)).not.toThrow();
    });
  });

  describe('Component Management', () => {
    let entity: number;

    beforeEach(() => {
      entity = service.createEntity();
    });

    it('should add components to entities', () => {
      const position = new PositionComponent(10, 20);
      service.addComponent(entity, position);

      const retrieved = service.getComponent(entity, PositionComponent);
      expect(retrieved).toBe(position);
      expect(retrieved?.x).toBe(10);
      expect(retrieved?.y).toBe(20);
    });

    it('should handle adding components to non-existent entities', () => {
      const position = new PositionComponent(10, 20);
      expect(() => service.addComponent(999, position)).not.toThrow();
    });

    it('should remove components from entities', () => {
      const position = new PositionComponent(10, 20);
      service.addComponent(entity, position);
      service.removeComponent(entity, PositionComponent);

      expect(service.getComponent(entity, PositionComponent)).toBeUndefined();
    });

    it('should check if entity has component', () => {
      const position = new PositionComponent(10, 20);
      service.addComponent(entity, position);

      expect(service.hasComponent(entity, PositionComponent)).toBe(true);
      expect(service.hasComponent(entity, VelocityComponent)).toBe(false);
    });

    it('should handle multiple components on same entity', () => {
      const position = new PositionComponent(10, 20);
      const velocity = new VelocityComponent(5, -5);
      const health = new HealthComponent(100, 100);

      service.addComponent(entity, position);
      service.addComponent(entity, velocity);
      service.addComponent(entity, health);

      expect(service.getComponent(entity, PositionComponent)).toBe(position);
      expect(service.getComponent(entity, VelocityComponent)).toBe(velocity);
      expect(service.getComponent(entity, HealthComponent)).toBe(health);
    });
  });

  describe('Entity Queries', () => {
    it('should find entities with specific components', () => {
      const entity1 = service.createEntity();
      const entity2 = service.createEntity();
      const entity3 = service.createEntity();

      service.addComponent(entity1, new PositionComponent(0, 0));
      service.addComponent(entity1, new VelocityComponent(1, 1));

      service.addComponent(entity2, new PositionComponent(10, 10));

      service.addComponent(entity3, new PositionComponent(20, 20));
      service.addComponent(entity3, new VelocityComponent(2, 2));

      const movableEntities = service.getEntitiesWithComponents(PositionComponent, VelocityComponent);
      expect(movableEntities).toContain(entity1);
      expect(movableEntities).toContain(entity3);
      expect(movableEntities).not.toContain(entity2);
      expect(movableEntities.length).toBe(2);
    });

    it('should return empty array when no entities match query', () => {
      const entity = service.createEntity();
      service.addComponent(entity, new PositionComponent(0, 0));

      const entities = service.getEntitiesWithComponents(HealthComponent);
      expect(entities).toEqual([]);
    });

    it('should return all entities when queried with no components', () => {
      const entity1 = service.createEntity();
      const entity2 = service.createEntity();

      const allEntities = service.getEntitiesWithComponents();
      expect(allEntities).toContain(entity1);
      expect(allEntities).toContain(entity2);
      expect(allEntities.length).toBe(2);
    });
  });

  describe('Query Cache Isolation', () => {
    it('should return same cached reference for repeated queries (no defensive copy)', () => {
      const entity1 = service.createEntity();
      const entity2 = service.createEntity();
      service.addComponent(entity1, new PositionComponent(0, 0));
      service.addComponent(entity2, new PositionComponent(10, 10));

      const result1 = service.getEntitiesWithComponents(PositionComponent);
      expect(result1.length).toBe(2);

      // PERFORMANCE: Returns cached array directly — callers MUST NOT mutate
      const result2 = service.getEntitiesWithComponents(PositionComponent);
      expect(result2).toBe(result1); // Same reference, no .slice() copy
      expect(result2.length).toBe(2);
      expect(result2).toContain(entity1);
      expect(result2).toContain(entity2);
    });

    it('should return independent arrays for empty results', () => {
      service.createEntity(); // entity with no components

      const result1 = service.getEntitiesWithComponents(PositionComponent);
      expect(result1.length).toBe(0);

      // Mutate the empty array
      result1.push(999 as never);

      // Second query must still return empty
      const result2 = service.getEntitiesWithComponents(PositionComponent);
      expect(result2.length).toBe(0);
    });
  });

  describe('Clear Functionality', () => {
    it('should clear all entities and reset state', () => {
      const entity1 = service.createEntity();
      const entity2 = service.createEntity();
      service.addComponent(entity1, new PositionComponent(0, 0));
      service.addComponent(entity2, new HealthComponent(100, 100));

      service.clear();

      expect(service.getEntityCount()).toBe(0);
      expect(service.getAllEntities()).toEqual([]);

      // Should reset entity ID counter
      const newEntity = service.createEntity();
      expect(newEntity).toBe(1);
    });
  });

  describe('Component Index Performance', () => {
    it('should efficiently query entities with components', () => {
      // Create many entities
      const entities: number[] = [];
      for (let i = 0; i < 100; i++) {
        entities.push(service.createEntity());
      }

      // Add components to some entities
      for (let i = 0; i < 50; i++) {
        service.addComponent(entities[i], new PositionComponent(i, i));
      }

      for (let i = 25; i < 75; i++) {
        service.addComponent(entities[i], new VelocityComponent(i, i));
      }

      const movableEntities = service.getEntitiesWithComponents(PositionComponent, VelocityComponent);
      expect(movableEntities.length).toBe(25); // Entities 25-49 have both components
    });
  });
});
