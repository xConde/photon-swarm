import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { EnemyTypeComponent, HealthComponent, PositionComponent } from '@photon/components';
import { findNearestAliveEnemy } from './targeting';

describe('findNearestAliveEnemy', () => {
  let entityManager: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  it('should return null when no enemies exist', () => {
    const result = findNearestAliveEnemy(0, 0, entityManager);
    expect(result).toBeNull();
  });

  it('should return the nearest alive enemy', () => {
    // Enemy at (100, 0) — distance 100
    const far = entityManager.createEntity();
    entityManager.addComponent(far, new PositionComponent(100, 0));
    entityManager.addComponent(far, new EnemyTypeComponent());
    entityManager.addComponent(far, new HealthComponent(50, 50));

    // Enemy at (30, 0) — distance 30
    const near = entityManager.createEntity();
    entityManager.addComponent(near, new PositionComponent(30, 0));
    entityManager.addComponent(near, new EnemyTypeComponent());
    entityManager.addComponent(near, new HealthComponent(50, 50));

    const result = findNearestAliveEnemy(0, 0, entityManager);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(30);
    expect(result!.y).toBe(0);
    expect(result!.entityId).toBe(near);
  });

  it('should skip dead enemies (health <= 0)', () => {
    // Dead enemy at (10, 0) — closest but dead
    const dead = entityManager.createEntity();
    entityManager.addComponent(dead, new PositionComponent(10, 0));
    entityManager.addComponent(dead, new EnemyTypeComponent());
    entityManager.addComponent(dead, new HealthComponent(0, 50));

    // Alive enemy at (100, 0)
    const alive = entityManager.createEntity();
    entityManager.addComponent(alive, new PositionComponent(100, 0));
    entityManager.addComponent(alive, new EnemyTypeComponent());
    entityManager.addComponent(alive, new HealthComponent(25, 50));

    const result = findNearestAliveEnemy(0, 0, entityManager);
    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(alive);
  });

  it('should return null when all enemies are dead', () => {
    const dead1 = entityManager.createEntity();
    entityManager.addComponent(dead1, new PositionComponent(10, 0));
    entityManager.addComponent(dead1, new EnemyTypeComponent());
    entityManager.addComponent(dead1, new HealthComponent(0, 50));

    const dead2 = entityManager.createEntity();
    entityManager.addComponent(dead2, new PositionComponent(20, 0));
    entityManager.addComponent(dead2, new EnemyTypeComponent());
    entityManager.addComponent(dead2, new HealthComponent(-5, 50));

    const result = findNearestAliveEnemy(0, 0, entityManager);
    expect(result).toBeNull();
  });

  it('should measure distance from origin, not from (0,0)', () => {
    // Enemy at (100, 100) — 14.14 from origin (90, 90)
    const close = entityManager.createEntity();
    entityManager.addComponent(close, new PositionComponent(100, 100));
    entityManager.addComponent(close, new EnemyTypeComponent());
    entityManager.addComponent(close, new HealthComponent(50, 50));

    // Enemy at (0, 0) — 127.28 from origin (90, 90)
    const far = entityManager.createEntity();
    entityManager.addComponent(far, new PositionComponent(0, 0));
    entityManager.addComponent(far, new EnemyTypeComponent());
    entityManager.addComponent(far, new HealthComponent(50, 50));

    const result = findNearestAliveEnemy(90, 90, entityManager);
    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(close);
  });
});
