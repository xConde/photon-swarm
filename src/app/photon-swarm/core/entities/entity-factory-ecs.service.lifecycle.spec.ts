import { TestBed } from '@angular/core/testing';
import { EntityFactoryECSService } from './entity-factory-ecs.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { RandomService } from '../utils/random.service';
import { ObjectPoolService } from '../utils/object-pool.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { PlayerService } from '../player/player.service';
import { EnemyType } from '../models/enemy.model';
import { EnemyTypeComponent, PositionComponent, ProjectileComponent, VelocityComponent } from '@photon/components';
import { PoolType } from '@photon/config/game-constants';

describe('EntityFactoryECSService - Object Pool Lifecycle', () => {
  let service: EntityFactoryECSService;
  let entityManager: EntityManagerService;

  beforeEach(() => {
    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['getLevelModifier']);
    const playerSpy = jasmine.createSpyObj('PlayerService', [
      'activateSpawnProtection',
      'deactivateInvincibility',
      'isParryAvailable',
    ]);
    playerSpy.isParryAvailable.and.returnValue(false);

    progressionSpy.getLevelModifier.and.returnValue(1);
    progressionSpy.level = 1;

    TestBed.configureTestingModule({
      providers: [
        EntityFactoryECSService,
        EntityManagerService,
        RandomService,
        ObjectPoolService,
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: PlayerService, useValue: playerSpy },
      ],
    });

    service = TestBed.inject(EntityFactoryECSService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('Entity Lifecycle Management', () => {
    it('should track pooled entities as inactive', () => {
      const projectile = service.createProjectile(0, 0, 1, 0, 10, 'player');

      // Entity should be active after creation
      expect(service.isEntityActive(projectile)).toBeTruthy();

      // Return to pool
      service.returnToPool(PoolType.PROJECTILE, projectile);

      // Entity should now be inactive
      expect(service.isEntityActive(projectile)).toBeFalsy();
    });

    it('should reactivate entities when retrieved from pool', () => {
      const projectile1 = service.createProjectile(0, 0, 1, 0, 10, 'player');
      service.returnToPool(PoolType.PROJECTILE, projectile1);

      // Entity is inactive in pool
      expect(service.isEntityActive(projectile1)).toBeFalsy();

      // Create new projectile (should reuse from pool)
      const projectile2 = service.createProjectile(10, 10, 1, 0, 10, 'player');
      expect(projectile2).toBe(projectile1);

      // Entity should now be active again
      expect(service.isEntityActive(projectile2)).toBeTruthy();
    });

    it('should discard pooled IDs before the entity store restarts allocation', () => {
      const staleProjectileId = service.createProjectile(0, 0, 1, 0, 10, 'player');
      service.returnToPool(PoolType.PROJECTILE, staleProjectileId);

      service.resetSession();
      entityManager.clear();

      const newlyReservedEntity = entityManager.createEntity();
      const newProjectile = service.createProjectile(10, 10, 1, 0, 10, 'player');

      expect(newlyReservedEntity).toBe(staleProjectileId);
      expect(newProjectile).not.toBe(newlyReservedEntity);
      expect(entityManager.hasComponent(newlyReservedEntity, ProjectileComponent)).toBeFalse();
      expect(entityManager.hasComponent(newProjectile, ProjectileComponent)).toBeTrue();
    });

    it('should prevent double-pooling of entities', () => {
      const enemy = service.createEnemy(0, 0, EnemyType.Basic);

      // First return should succeed
      service.returnToPool(PoolType.ENEMY, enemy);
      expect(service.isEntityActive(enemy)).toBeFalsy();

      // Second return should be ignored (no error)
      service.returnToPool(PoolType.ENEMY, enemy);
    });

    it('should handle concurrent pool operations safely', () => {
      const entities: number[] = [];

      // Create multiple entities
      for (let i = 0; i < 10; i++) {
        entities.push(service.createProjectile(i, i, 1, 0, 10, 'player'));
      }

      // Return them all to pool
      entities.forEach((e) => service.returnToPool(PoolType.PROJECTILE, e));

      // All should be inactive
      entities.forEach((e) => {
        expect(service.isEntityActive(e)).toBeFalsy();
      });

      // Create new entities - should reuse from pool
      const newEntities: number[] = [];
      for (let i = 0; i < 10; i++) {
        newEntities.push(service.createProjectile(i + 10, i + 10, 1, 0, 10, 'player'));
      }

      // All reused entities should be active
      newEntities.forEach((e) => {
        expect(service.isEntityActive(e)).toBeTruthy();
      });
    });

    it('should track pool statistics correctly', () => {
      // Create and pool some entities
      const projectiles: number[] = [];
      for (let i = 0; i < 5; i++) {
        projectiles.push(service.createProjectile(i, i, 1, 0, 10, 'player'));
      }

      const enemies: number[] = [];
      for (let i = 0; i < 3; i++) {
        enemies.push(service.createEnemy(i, i, EnemyType.Basic));
      }

      // Return some to pools
      projectiles.slice(0, 3).forEach((p) => service.returnToPool(PoolType.PROJECTILE, p));
      enemies.slice(0, 2).forEach((e) => service.returnToPool(PoolType.ENEMY, e));

      const stats = service.getPoolStats();

      // Check pool counts
      expect(stats.projectile.pooled).toBe(3);
      expect(stats.enemy.pooled).toBe(2);
      expect(stats.totalPooled).toBe(5);
    });

    it('should handle entity destruction vs pooling correctly', () => {
      const projectile = service.createProjectile(0, 0, 1, 0, 10, 'player');
      const enemy = service.createEnemy(0, 0, EnemyType.Basic);

      // Return projectile to pool
      service.returnToPool(PoolType.PROJECTILE, projectile);
      expect(entityManager.hasEntity(projectile)).toBeTruthy(); // Still exists
      expect(service.isEntityActive(projectile)).toBeFalsy(); // But inactive

      // Destroy enemy normally
      entityManager.destroyEntity(enemy);
      expect(entityManager.hasEntity(enemy)).toBeFalsy(); // Doesn't exist
      expect(service.isEntityActive(enemy)).toBeFalsy(); // And inactive
    });

    it('should clean components completely when pooling', () => {
      const enemy = service.createEnemy(100, 200, EnemyType.Spitter, 'rare', true);

      // Verify it has many components
      expect(entityManager.hasComponent(enemy, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(enemy, EnemyTypeComponent)).toBeTruthy();

      // Return to pool
      service.returnToPool(PoolType.ENEMY, enemy);

      // Should have no components
      expect(entityManager.hasComponent(enemy, PositionComponent)).toBeFalsy();
      expect(entityManager.hasComponent(enemy, VelocityComponent)).toBeFalsy();
      expect(entityManager.hasComponent(enemy, EnemyTypeComponent)).toBeFalsy();

      // Entity should still exist in manager
      expect(entityManager.hasEntity(enemy)).toBeTruthy();
    });

    it('should handle pool overflow gracefully', () => {
      const projectiles: number[] = [];

      // Create more than pool limit (500)
      for (let i = 0; i < 600; i++) {
        const p = service.createProjectile(i, i, 1, 0, 10, 'player');
        projectiles.push(p);
        service.returnToPool(PoolType.PROJECTILE, p);
      }

      // Pool should only contain 500
      const stats = service.getPoolStats();
      expect(stats.projectile.pooled).toBeLessThanOrEqual(500);

      // Extra entities should still be tracked as pooled
      const totalPooled = projectiles.filter((p) => !service.isEntityActive(p)).length;
      expect(totalPooled).toBe(600);
    });

    it('should handle missing entity gracefully', () => {
      const nonExistentId = 99999;

      // Should not throw when returning non-existent entity
      expect(() => service.returnToPool(PoolType.PROJECTILE, nonExistentId)).not.toThrow();

      // Should report as inactive
      expect(service.isEntityActive(nonExistentId)).toBeFalsy();
    });

    it('should efficiently remove components using getComponents', () => {
      const projectile = service.createProjectile(0, 0, 1, 0, 10, 'player');

      // Spy on the more efficient path
      spyOn(entityManager, 'getComponents').and.callThrough();

      // Return to pool
      service.returnToPool(PoolType.PROJECTILE, projectile);

      // Should have used the efficient method
      expect(entityManager.getComponents).toHaveBeenCalledWith(projectile);
    });
  });

  describe('System Integration', () => {
    it('should prevent processing of pooled entities in systems', () => {
      const allCreatedProjectiles: number[] = [];
      const activeProjectiles: number[] = [];
      const pooledProjectiles: number[] = [];

      // Create all projectiles first (to avoid entity reuse during creation)
      for (let i = 0; i < 10; i++) {
        const p = service.createProjectile(i, i, 1, 0, 10, 'player');
        allCreatedProjectiles.push(p);
      }

      // Then pool some of them
      for (let i = 0; i < allCreatedProjectiles.length; i++) {
        const p = allCreatedProjectiles[i];
        if (i % 2 === 0) {
          activeProjectiles.push(p);
        } else {
          pooledProjectiles.push(p);
          service.returnToPool(PoolType.PROJECTILE, p);
        }
      }

      // Get all projectile entities (should only return those with components)
      const allProjectiles = entityManager.getEntitiesWithComponents(
        PositionComponent,
        VelocityComponent,
        ProjectileComponent
      );

      // Filter by active status (as systems should do)
      const processableProjectiles = allProjectiles.filter((p) => service.isEntityActive(p));

      // Should only include active ones
      expect(processableProjectiles.length).toBe(activeProjectiles.length);
      expect(processableProjectiles.every((p) => activeProjectiles.includes(p))).toBeTruthy();
      expect(processableProjectiles.some((p) => pooledProjectiles.includes(p))).toBeFalsy();
    });
  });
});
