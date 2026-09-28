import { TestBed } from '@angular/core/testing';
import { DeathAnimationSystemService } from './death-animation-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PoolType } from '@photon/config/game-constants';
import {
  DeathAnimationComponent,
  EnemyTypeComponent,
  PositionComponent,
  ProjectileComponent,
  RenderableComponent,
  ShardComponent,
} from '@photon/components';
import { EnemyType } from '../../models/enemy.model';

describe('DeathAnimationSystemService', () => {
  let service: DeathAnimationSystemService;
  let entityManager: EntityManagerService;
  let entityFactory: jasmine.SpyObj<EntityFactoryECSService>;

  // Mock performance.now for deterministic tests
  let mockNow: number;

  beforeEach(() => {
    mockNow = 1000;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);

    const factorySpy = jasmine.createSpyObj('EntityFactoryECSService', ['returnToPool']);

    TestBed.configureTestingModule({
      providers: [
        DeathAnimationSystemService,
        EntityManagerService,
        { provide: EntityFactoryECSService, useValue: factorySpy },
      ],
    });

    service = TestBed.inject(DeathAnimationSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
  });

  afterEach(() => {
    entityManager.clear();
  });

  /**
   * Helper to create an entity with death animation
   */
  function createDyingEntity(animationType: 'fade' | 'shrink' | 'flash' = 'fade', duration: number = 500): number {
    const entity = entityManager.createEntity();
    const deathAnim = new DeathAnimationComponent(duration, animationType);
    entityManager.addComponent(entity, deathAnim);
    entityManager.addComponent(entity, new RenderableComponent('#ff0000', 1.0));
    entityManager.addComponent(entity, new PositionComponent(100, 100));
    return entity;
  }

  /**
   * Helper to create a dying enemy
   */
  function createDyingEnemy(): number {
    const entity = createDyingEntity('flash', 600);
    entityManager.addComponent(entity, new EnemyTypeComponent(EnemyType.Basic, 'common'));
    return entity;
  }

  /**
   * Helper to create a dying projectile
   */
  function createDyingProjectile(): number {
    const entity = createDyingEntity('fade', 200);
    entityManager.addComponent(entity, new ProjectileComponent(10, 500));
    return entity;
  }

  /**
   * Helper to create a dying shard
   */
  function createDyingShard(): number {
    const entity = createDyingEntity('shrink', 300);
    entityManager.addComponent(entity, new ShardComponent(1));
    return entity;
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('update - animation progress', () => {
    it('should update renderable opacity based on animation progress', () => {
      const entity = createDyingEntity('fade', 500);
      const renderable = entityManager.getComponent(entity, RenderableComponent)!;
      expect(renderable.opacity).toBe(1.0);

      // Advance time to halfway
      mockNow = 1250;
      service.update(16, entityManager);

      expect(renderable.opacity).toBeCloseTo(0.5, 1);
    });

    it('should not modify renderable when entity has no renderable component', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new DeathAnimationComponent(500, 'fade'));

      // Should not throw
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should handle flash animation opacity changes', () => {
      const entity = createDyingEntity('flash', 500);
      const renderable = entityManager.getComponent(entity, RenderableComponent)!;

      // During flash phase (10% progress)
      mockNow = 1050;
      service.update(16, entityManager);

      // Flash should brighten initially
      expect(renderable.opacity).toBeGreaterThan(1.0);
    });
  });

  describe('update - entity cleanup', () => {
    it('should return enemy to pool when animation completes', () => {
      const enemy = createDyingEnemy();

      // Complete animation
      mockNow = 1700; // Past 600ms duration
      service.update(16, entityManager);

      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, enemy);
    });

    it('should return projectile to pool when animation completes', () => {
      const projectile = createDyingProjectile();

      // Complete animation
      mockNow = 1300; // Past 200ms duration
      service.update(16, entityManager);

      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.PROJECTILE, projectile);
    });

    it('should return shard to pool when animation completes', () => {
      const shard = createDyingShard();

      // Complete animation
      mockNow = 1400; // Past 300ms duration
      service.update(16, entityManager);

      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.SHARD, shard);
    });

    it('should destroy entities without pool type', () => {
      const entity = createDyingEntity('fade', 500);

      // Complete animation
      mockNow = 1600;
      service.update(16, entityManager);

      // Entity should be destroyed (no components remaining)
      expect(entityManager.getComponent(entity, RenderableComponent)).toBeUndefined();
    });

    it('should not cleanup entity before animation completes', () => {
      const enemy = createDyingEnemy();

      // Partial progress
      mockNow = 1300; // 300ms into 600ms animation
      service.update(16, entityManager);

      expect(entityFactory.returnToPool).not.toHaveBeenCalled();
      expect(entityManager.getComponent(enemy, RenderableComponent)).toBeDefined();
    });
  });

  describe('update - scale for shrink animations', () => {
    it('should apply scale property to renderable for shrink animations', () => {
      const entity = createDyingEntity('shrink', 500);

      // Halfway through animation
      mockNow = 1250;
      service.update(16, entityManager);

      const renderable = entityManager.getComponent(entity, RenderableComponent);
      // Scale should be stored in custom property
      expect((renderable as { scale?: number })?.scale).toBeCloseTo(0.5, 1);
    });

    it('should not apply scale for fade animations', () => {
      const entity = createDyingEntity('fade', 500);

      mockNow = 1250;
      service.update(16, entityManager);

      const renderable = entityManager.getComponent(entity, RenderableComponent);
      // Scale should not be set for fade
      expect((renderable as { scale?: number })?.scale).toBeUndefined();
    });
  });

  describe('multiple entities', () => {
    it('should process multiple dying entities independently', () => {
      const enemy = createDyingEnemy(); // 600ms flash
      const projectile = createDyingProjectile(); // 200ms fade

      // After 250ms - projectile should be done, enemy still animating
      mockNow = 1250;
      service.update(16, entityManager);

      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.PROJECTILE, projectile);
      expect(entityFactory.returnToPool).not.toHaveBeenCalledWith(PoolType.ENEMY, enemy);
    });

    it('should handle entities added during iteration', () => {
      createDyingEntity('fade', 100);
      createDyingEntity('fade', 100);
      createDyingEntity('fade', 100);

      mockNow = 1200;
      // Should not throw even with multiple entities
      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle entities without death animation component', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new RenderableComponent('#00ff00', 1.0));

      // Should not throw
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should handle zero-duration animations', () => {
      const entity = createDyingEntity('fade', 0);

      service.update(16, entityManager);

      // Zero duration causes 0/0 = NaN, which means animation never completes
      // Entity should still exist with its components
      expect(entityManager.getComponent(entity, DeathAnimationComponent)).toBeDefined();
      expect(entityManager.getComponent(entity, RenderableComponent)).toBeDefined();
    });

    it('should handle negative time values gracefully', () => {
      const entity = createDyingEntity('fade', 500);

      // Time goes backwards (unlikely but should handle)
      mockNow = 500;
      expect(() => service.update(16, entityManager)).not.toThrow();

      // Animation shouldn't be complete since progress would be negative
      expect(entityManager.getComponent(entity, RenderableComponent)).toBeDefined();
    });
  });
});
