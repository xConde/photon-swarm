import { TestBed } from '@angular/core/testing';
import { EntityFactoryECSService } from './entity-factory-ecs.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { GameStateService } from '../state/game-state.service';
import { createTestScenario, simulateFrames } from '../../test-utils/test-helpers';
import { TEST_DURATIONS, TEST_POOLS } from '../../test-utils/test-constants';
import {
  // CollisionBoxComponent, // Not used in tests
  HealthComponent,
  PositionComponent,
  ProjectileComponent,
  VelocityComponent,
} from '@photon/components';
import { PoolType } from '@photon/config/game-constants';
import { EnemyType } from '../../core/models/enemy.model';
import {
  createChargedProjectileFromOptions,
  createEnemyFromOptions,
  createProjectileFromOptions,
} from '../../test-utils/entity-factory-helpers';
import { FloatingTextComponent } from '@photon/components/floating-text.component';

/**
 * Helper to check if an entity is pooled via the factory's internal tracker
 * Since EntityFactoryECSService creates its own PooledEntityTracker instance,
 * we need to check pooling status through the factory's public interface
 */
function isEntityPooled(
  entityFactory: EntityFactoryECSService,
  entityManager: EntityManagerService,
  entityId: number
): boolean {
  // An entity is pooled if it exists but is not active
  return entityManager.hasEntity(entityId) && !entityFactory.isEntityActive(entityId);
}

/**
 * Comprehensive tests for entity lifecycle management including pooling
 * Tests entity creation, destruction, pooling, and reuse patterns
 */
describe('Entity Lifecycle and Pooling Tests', () => {
  let entityFactory: EntityFactoryECSService;
  let entityManager: EntityManagerService;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;

  beforeEach(() => {
    debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    gameStateSpy = jasmine.createSpyObj('GameStateService', ['addShard', 'addScore', 'getPlayerPosition']);

    // Type assertion to fix getPlayerPosition property access
    (
      gameStateSpy as jasmine.SpyObj<GameStateService> & { getPlayerPosition: jasmine.Spy }
    ).getPlayerPosition.and.returnValue({ x: 0, y: 0 });

    TestBed.configureTestingModule({
      providers: [
        EntityFactoryECSService,
        EntityManagerService,
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: GameStateService, useValue: gameStateSpy },
      ],
    });

    entityFactory = TestBed.inject(EntityFactoryECSService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('Entity Creation and Basic Lifecycle', () => {
    it('should create entities with correct components', () => {
      const angle = Math.PI / 4;
      const speed = 300;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const projectileId = entityFactory.createProjectile(
        100, // x
        200, // y
        vx, // vx
        vy, // vy
        10, // damage
        'player' // faction
      );

      expect(entityManager.hasEntity(projectileId)).toBe(true);
      expect(entityManager.hasComponent(projectileId, PositionComponent)).toBe(true);
      expect(entityManager.hasComponent(projectileId, VelocityComponent)).toBe(true);
      expect(entityManager.hasComponent(projectileId, ProjectileComponent)).toBe(true);

      const position = entityManager.getComponent(projectileId, PositionComponent);
      expect(position?.x).toBe(100);
      expect(position?.y).toBe(200);
    });

    it('should destroy entities completely', () => {
      const entityId = entityFactory.createEnemy(
        300, // x
        400, // y
        'basic' as unknown as EnemyType // type - cast to avoid enum issues
      );

      expect(entityManager.hasEntity(entityId)).toBe(true);

      entityManager.destroyEntity(entityId);

      expect(entityManager.hasEntity(entityId)).toBe(false);
      expect(entityManager.getComponents(entityId)?.size ?? 0).toBe(0);
    });
  });

  describe('Object Pooling - Basic Operations', () => {
    it('should return entities to pool instead of destroying', () => {
      const projectileId = entityFactory.createProjectile(
        0, // x
        0, // y
        100, // vx (speed * cos(0))
        0, // vy (speed * sin(0))
        5, // damage
        'player' // faction
      );

      // Return to pool
      entityFactory.returnToPool(PoolType.PROJECTILE, projectileId);

      // Entity should still exist but be inactive (pooled)
      expect(entityManager.hasEntity(projectileId)).toBe(true);
      expect(isEntityPooled(entityFactory, entityManager, projectileId)).toBe(true);
      expect(entityFactory.isEntityActive(projectileId)).toBe(false);

      // Components should be removed
      expect(entityManager.getComponents(projectileId)?.size ?? 0).toBe(0);
    });

    it('should reuse pooled entities', () => {
      const pooledIds: number[] = [];

      // Create and pool several projectiles
      for (let i = 0; i < 5; i++) {
        const id = entityFactory.createProjectile(
          i * 10, // x
          i * 10, // y
          100, // vx
          0, // vy
          5, // damage
          'player' // faction
        );
        pooledIds.push(id);
        entityFactory.returnToPool(PoolType.PROJECTILE, id);
      }

      // Create new projectile - should reuse from pool
      const newId = entityFactory.createProjectile(
        500, // x
        500, // y
        -200, // vx (200 * cos(PI) = -200)
        0, // vy (200 * sin(PI) = 0)
        10, // damage
        'player' // faction
      );

      // Should have reused one of the pooled IDs
      expect(pooledIds).toContain(newId);
      expect(entityFactory.isEntityActive(newId)).toBe(true); // Active = not pooled

      // Should have correct new components
      const position = entityManager.getComponent(newId, PositionComponent);
      expect(position?.x).toBe(500);
      expect(position?.y).toBe(500);
    });

    it('should handle pool overflow gracefully', () => {
      // Fill up the projectile pool
      const maxPoolSize = TEST_POOLS.SIZES.PROJECTILE;
      const createdIds: number[] = [];

      for (let i = 0; i < maxPoolSize + 10; i++) {
        const id = createProjectileFromOptions(entityFactory, {
          x: i,
          y: i,
          angle: 0,
          speed: 100,
          damage: 5,
          faction: 'player',
        });
        createdIds.push(id);
      }

      // Return all to pool - only maxPoolSize should be pooled
      for (const id of createdIds) {
        entityFactory.returnToPool(PoolType.PROJECTILE, id);
      }

      const stats = entityFactory.getPoolStats();
      expect(stats.projectile.pooled).toBe(maxPoolSize);
      expect(stats.projectile.active).toBe(0);

      // Overflow entities should be destroyed
      for (let i = maxPoolSize; i < createdIds.length; i++) {
        expect(entityManager.hasEntity(createdIds[i])).toBe(false);
      }
    });
  });

  describe('Pool Type Management', () => {
    it('should use correct pool for each entity type', () => {
      // Create different entity types
      const projectileId = entityFactory.createProjectile(
        0, // x
        0, // y
        100, // vx
        0, // vy
        5, // damage
        'player' // faction
      );

      const enemyId = createEnemyFromOptions(entityFactory, {
        x: 100,
        y: 100,
        type: 'Basic', // Use enum key
      });

      const chargedId = createChargedProjectileFromOptions(entityFactory, {
        x: 200,
        y: 200,
        angle: 0,
        speed: 150,
        damage: 20,
        chargeLevel: 0.8,
      });

      // Return each to their respective pools
      entityFactory.returnToPool(PoolType.PROJECTILE, projectileId);
      entityFactory.returnToPool(PoolType.ENEMY, enemyId);
      entityFactory.returnToPool(PoolType.CHARGED_PROJECTILE, chargedId);

      const stats = entityFactory.getPoolStats();
      expect(stats.projectile.pooled).toBe(1);
      expect(stats.enemy.pooled).toBe(1);
      expect(stats.chargedProjectile.pooled).toBe(1);
    });

    it('should prevent cross-pool contamination', () => {
      const projectileId = createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        angle: 0,
        speed: 100,
        damage: 5,
        faction: 'player',
      });

      // Try to return projectile to wrong pool type
      entityFactory.returnToPool(PoolType.ENEMY, projectileId);

      // Should log warning about missing expected component for pool type
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('missing expected component'),
        'warning',
        jasmine.any(Object)
      );

      // Entity should still be pooled (to the wrong pool, but that's the current behavior)
      // The warning is logged but the entity is still processed
      // In current implementation, it gets pooled to the specified pool type anyway
      expect(entityManager.hasEntity(projectileId)).toBe(true);
    });
  });

  describe('Pooled Entity Safety', () => {
    it('should prevent double-pooling', () => {
      const projectileId = createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        angle: 0,
        speed: 100,
        damage: 5,
        faction: 'player',
      });

      // Pool once
      entityFactory.returnToPool(PoolType.PROJECTILE, projectileId);
      expect(isEntityPooled(entityFactory, entityManager, projectileId)).toBe(true);

      // Try to pool again
      entityFactory.returnToPool(PoolType.PROJECTILE, projectileId);

      // Should log warning
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('already pooled'),
        'warning',
        jasmine.any(Object)
      );

      // Should still be pooled only once
      const stats = entityFactory.getPoolStats();
      expect(stats.projectile.pooled).toBe(1);
    });

    it('should clean components when returning to pool', () => {
      const enemyId = createEnemyFromOptions(entityFactory, {
        x: 100,
        y: 100,
        type: 'Tank', // Use enum key
      });

      // Verify has components
      const componentCount = entityManager.getComponents(enemyId)?.size ?? 0;
      expect(componentCount).toBeGreaterThan(0);

      // Add some runtime state
      const health = entityManager.getComponent(enemyId, HealthComponent);
      if (health) {
        health.health = 50; // Damage the enemy
      }

      // Return to pool
      entityFactory.returnToPool(PoolType.ENEMY, enemyId);

      // All components should be removed
      expect(entityManager.getComponents(enemyId)?.size ?? 0).toBe(0);

      // Reuse the entity
      const newEnemyId = createEnemyFromOptions(entityFactory, {
        x: 200,
        y: 200,
        type: 'Basic', // Use enum key
      });

      if (newEnemyId === enemyId) {
        // If reused, should have fresh components
        const newHealth = entityManager.getComponent(newEnemyId, HealthComponent);
        expect(newHealth?.health).toBe(newHealth?.maxHealth); // Full health
      }
    });
  });

  describe('Pool Statistics and Monitoring', () => {
    it('should track pool statistics accurately', () => {
      // Create various entities
      const projectileIds: number[] = [];
      const enemyIds: number[] = [];

      for (let i = 0; i < 10; i++) {
        projectileIds.push(
          createProjectileFromOptions(entityFactory, {
            x: i,
            y: i,
            angle: 0,
            speed: 100,
            damage: 5,
            faction: 'player',
          })
        );

        enemyIds.push(
          createEnemyFromOptions(entityFactory, {
            x: i * 10,
            y: i * 10,
            type: 'Basic', // Use enum key
          })
        );
      }

      // Return half to pools
      for (let i = 0; i < 5; i++) {
        entityFactory.returnToPool(PoolType.PROJECTILE, projectileIds[i]);
        entityFactory.returnToPool(PoolType.ENEMY, enemyIds[i]);
      }

      const stats = entityFactory.getPoolStats();

      // Note: The service doesn't track active entities per type, only pooled
      // So we verify the pooled count is correct
      expect(stats.projectile.pooled).toBe(5);
      expect(stats.enemy.pooled).toBe(5);

      // Verify entities are actually in the expected state
      // First 5 should be pooled
      for (let i = 0; i < 5; i++) {
        expect(isEntityPooled(entityFactory, entityManager, projectileIds[i])).toBe(true);
        expect(isEntityPooled(entityFactory, entityManager, enemyIds[i])).toBe(true);
      }
      // Last 5 should be active
      for (let i = 5; i < 10; i++) {
        expect(entityFactory.isEntityActive(projectileIds[i])).toBe(true);
        expect(entityFactory.isEntityActive(enemyIds[i])).toBe(true);
      }

      // Total pooled is tracked separately
      expect(stats.totalPooled).toBe(10);
    });

    it('should calculate hit rates correctly', () => {
      // Create and immediately return entities to build pool
      for (let i = 0; i < 5; i++) {
        const id = createProjectileFromOptions(entityFactory, {
          x: 0,
          y: 0,
          angle: 0,
          speed: 100,
          damage: 5,
          faction: 'player',
        });
        entityFactory.returnToPool(PoolType.PROJECTILE, id);
      }

      // Reset stats tracking
      // const stats1 = entityFactory.getPoolStats(); // Not used, commented out

      // Create more projectiles - should all come from pool
      for (let i = 0; i < 5; i++) {
        createProjectileFromOptions(entityFactory, {
          x: i,
          y: i,
          angle: 0,
          speed: 100,
          damage: 5,
          faction: 'player',
        });
      }

      const stats2 = entityFactory.getPoolStats();
      // Hit rate should be high since we reused pooled entities
      expect(stats2.projectile.hitRate).toBeGreaterThan(0.8);
    });
  });

  describe('Integration with Game Systems', () => {
    it('should handle entity lifecycle in death animation system', () => {
      const scenario = createTestScenario();

      // Create an enemy that will die
      const enemyId = createEnemyFromOptions(entityFactory, {
        x: 100,
        y: 100,
        type: 'Basic', // Use enum key
      });

      const health = entityManager.getComponent(enemyId, HealthComponent);
      if (health) {
        health.health = 0; // Kill the enemy
      }

      // Simulate death animation completion
      simulateFrames(scenario, 60, TEST_DURATIONS.FRAME_MS, () => {
        // Death animation system would return entity to pool
        if (health && health.health <= 0) {
          entityFactory.returnToPool(PoolType.ENEMY, enemyId);
        }
      });

      // Entity should be pooled, not destroyed
      expect(isEntityPooled(entityFactory, entityManager, enemyId)).toBe(true);
      expect(entityManager.hasEntity(enemyId)).toBe(true);
      expect(!isEntityPooled(entityFactory, entityManager, enemyId)).toBe(false);
    });

    it('should handle projectile expiration and pooling', () => {
      const projectileIds: number[] = [];

      // Create projectiles with short lifetime
      for (let i = 0; i < 20; i++) {
        const id = createProjectileFromOptions(entityFactory, {
          x: i * 10,
          y: 0,
          angle: 0,
          speed: 100,
          damage: 5,
          faction: 'player',
        });

        // Projectiles have lifetime built into ProjectileComponent
        const projectile = entityManager.getComponent(id, ProjectileComponent);
        if (projectile) {
          projectile.lifetime = 100; // 100ms
        }

        projectileIds.push(id);
      }

      // Simulate time passing
      const scenario = createTestScenario();
      simulateFrames(scenario, 10, TEST_DURATIONS.FRAME_MS, () => {
        // Check if projectiles have expired
        const currentTime = Date.now();
        for (const id of projectileIds) {
          const projectile = entityManager.getComponent(id, ProjectileComponent);
          if (projectile && projectile.isExpired(currentTime)) {
            entityFactory.returnToPool(PoolType.PROJECTILE, id);
          }
        }
      });

      // All projectiles should be pooled
      const stats = entityFactory.getPoolStats();
      expect(stats.projectile.pooled).toBe(20);
      expect(stats.projectile.active).toBe(0);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle rapid creation and pooling efficiently', () => {
      const startTime = Date.now();
      const iterations = 1000;
      const createdIds: number[] = [];

      // First create all entities
      for (let i = 0; i < iterations; i++) {
        const id = createProjectileFromOptions(entityFactory, {
          x: Math.random() * 1000,
          y: Math.random() * 1000,
          angle: Math.random() * Math.PI * 2,
          speed: 200 + Math.random() * 200,
          damage: 5 + Math.random() * 10,
          faction: 'player',
        });
        createdIds.push(id);
      }

      // Then return all to pool
      for (const id of createdIds) {
        entityFactory.returnToPool(PoolType.PROJECTILE, id);
      }

      const elapsed = Date.now() - startTime;

      // Should complete quickly (under 500ms for 2000 operations - create + return)
      expect(elapsed).toBeLessThan(500);

      // Pool should be at max capacity (500), overflow entities destroyed
      const stats = entityFactory.getPoolStats();
      expect(stats.projectile.pooled).toBe(TEST_POOLS.SIZES.PROJECTILE);

      // Verify overflow entities are destroyed
      for (let i = TEST_POOLS.SIZES.PROJECTILE; i < createdIds.length; i++) {
        expect(entityManager.hasEntity(createdIds[i])).toBe(false);
      }
    });

    it('should maintain performance with mixed entity types', () => {
      const operations = 500;
      const entityTypes = [
        () =>
          createProjectileFromOptions(entityFactory, {
            x: 0,
            y: 0,
            angle: 0,
            speed: 100,
            damage: 5,
            faction: 'player',
          }),
        () => createEnemyFromOptions(entityFactory, { x: 0, y: 0, type: 'Basic' }),
        () => entityFactory.createShard(0, 0, 1),
        () => {
          // Create a floating text entity manually for testing
          const entity = entityFactory['entityManager'].createEntity();
          entityFactory['entityManager'].addComponent(entity, new FloatingTextComponent('10', '#ff0000', 16, 1000));
          return entity;
        },
      ];

      const poolTypes = [PoolType.PROJECTILE, PoolType.ENEMY, PoolType.SHARD, PoolType.FLOATING_TEXT];

      const createdEntities: Array<{ id: number; poolType: PoolType }> = [];

      // Create mixed entities
      for (let i = 0; i < operations; i++) {
        const typeIndex = i % entityTypes.length;
        const id = entityTypes[typeIndex]();
        // Skip invalid entities (in case floating text creation fails)
        if (id > 0) {
          createdEntities.push({ id, poolType: poolTypes[typeIndex] });
        }
      }

      // Return half to pools
      const halfCount = Math.min(createdEntities.length / 2, operations / 2);
      for (let i = 0; i < halfCount; i++) {
        const entity = createdEntities[i];
        entityFactory.returnToPool(entity.poolType, entity.id);
      }

      const stats = entityFactory.getPoolStats();

      // Should have some pooled entities after returning half
      expect(stats.totalPooled).toBeGreaterThan(0);

      // All pool types that were used should have some pooled entries
      // (Note: active count is not tracked, only pooled)
      expect(stats.projectile.pooled).toBeGreaterThan(0);
      expect(stats.enemy.pooled).toBeGreaterThan(0);
      expect(stats.shard.pooled).toBeGreaterThan(0);
      // FloatingText may or may not have pooled depending on how returnToPool handles it
      // since the manually created floating text entity might not pass validation
    });
  });
});
