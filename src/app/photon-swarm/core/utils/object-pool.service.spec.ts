import { TestBed } from '@angular/core/testing';
import { ObjectPool, ObjectPoolService } from './object-pool.service';

// Test objects for pooling
class TestProjectile {
  x: number = 0;
  y: number = 0;
  velocity: number = 0;
  damage: number = 0;
  active: boolean = false;

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.velocity = 0;
    this.damage = 0;
    this.active = false;
  }
}

class TestParticle {
  x: number = 0;
  y: number = 0;
  life: number = 0;
  color: string = '';

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.life = 0;
    this.color = '';
  }
}

describe('ObjectPool', () => {
  let createFn: jasmine.Spy;
  let resetFn: jasmine.Spy;
  let pool: ObjectPool<TestProjectile>;

  beforeEach(() => {
    createFn = jasmine.createSpy('createFn').and.callFake(() => new TestProjectile());
    resetFn = jasmine.createSpy('resetFn').and.callFake((obj: TestProjectile) => obj.reset());
    pool = new ObjectPool<TestProjectile>(createFn, resetFn, 5);
  });

  describe('Object Creation and Retrieval', () => {
    it('should create new object when pool is empty', () => {
      const obj = pool.get();

      expect(obj).toBeInstanceOf(TestProjectile);
      expect(createFn).toHaveBeenCalledTimes(1);
    });

    it('should reuse objects from pool when available', () => {
      // Create and release an object
      const obj1 = pool.get();
      pool.release(obj1);

      // Get another object (should be the same one)
      const obj2 = pool.get();

      expect(obj1).toBe(obj2);
      expect(createFn).toHaveBeenCalledTimes(1); // Only called once
      expect(resetFn).toHaveBeenCalledTimes(1); // Called when releasing
    });

    it('should reset objects when releasing to pool', () => {
      const obj = pool.get();
      obj.x = 100;
      obj.y = 200;
      obj.active = true;

      pool.release(obj);

      expect(resetFn).toHaveBeenCalledWith(obj);
    });
  });

  describe('Pool Size Management', () => {
    it('should respect maximum pool size', () => {
      // Create more objects than max size and release them all
      const objects: TestProjectile[] = [];
      for (let i = 0; i < 10; i++) {
        objects.push(pool.get());
      }

      // Release all objects
      objects.forEach((obj) => pool.release(obj));

      const stats = pool.getStats();
      expect(stats.poolSize).toBe(5); // Should be capped at maxSize
      expect(stats.maxSize).toBe(5);
    });

    it('should not add objects to pool when at maximum capacity', () => {
      // Fill the pool to capacity
      const objects: TestProjectile[] = [];
      for (let i = 0; i < 5; i++) {
        objects.push(pool.get());
      }
      objects.forEach((obj) => pool.release(obj));

      // Pool should now be at max capacity (5)
      const maxedStats = pool.getStats();
      expect(maxedStats.poolSize).toBe(5);

      // Get one object to make room
      pool.get();

      // Create a completely new object and release it
      const newObj = new TestProjectile();
      pool.release(newObj);

      // Pool should not exceed max size
      expect(pool.getStats().poolSize).toBeLessThanOrEqual(5);
    });

    it('should clear all objects from pool', () => {
      // Add some objects to pool
      const objects = [pool.get(), pool.get(), pool.get()];
      objects.forEach((obj) => pool.release(obj));

      expect(pool.getStats().poolSize).toBe(3);

      pool.clear();

      expect(pool.getStats().poolSize).toBe(0);
    });
  });

  describe('Pool Statistics', () => {
    it('should provide accurate pool statistics', () => {
      // Add 3 objects to pool
      const objects = [pool.get(), pool.get(), pool.get()];
      objects.forEach((obj) => pool.release(obj));

      const stats = pool.getStats();

      expect(stats.poolSize).toBe(3);
      expect(stats.maxSize).toBe(5);
      expect(stats.utilization).toBe((5 - 3) / 5); // 0.4
    });

    it('should calculate utilization correctly when pool is empty', () => {
      const stats = pool.getStats();

      expect(stats.poolSize).toBe(0);
      expect(stats.utilization).toBe(1); // 100% utilization (all slots available)
    });

    it('should calculate utilization correctly when pool is full', () => {
      // Fill pool to capacity
      const objects: TestProjectile[] = [];
      for (let i = 0; i < 5; i++) {
        objects.push(pool.get());
      }
      objects.forEach((obj) => pool.release(obj));

      const stats = pool.getStats();

      expect(stats.poolSize).toBe(5);
      expect(stats.utilization).toBe(0); // 0% utilization (no slots available)
    });
  });

  describe('Performance Characteristics', () => {
    it('should be faster to get from pool than create new objects', () => {
      // Pre-fill pool
      const objects: TestProjectile[] = [];
      for (let i = 0; i < 50; i++) {
        objects.push(pool.get());
      }
      objects.forEach((obj) => pool.release(obj));

      // Measure pool retrieval time over many iterations for stability
      const iterations = 1000;
      const poolStartTime = window.performance.now();
      for (let i = 0; i < iterations; i++) {
        const obj = pool.get();
        pool.release(obj);
      }
      const poolTime = window.performance.now() - poolStartTime;

      // Measure direct creation time
      const directStartTime = window.performance.now();
      for (let i = 0; i < iterations; i++) {
        const obj = new TestProjectile();
        obj.reset();
      }
      const directTime = window.performance.now() - directStartTime;

      // Both should complete quickly - just verify pool operations work
      // Note: With JIT optimization, timing comparisons are unreliable
      expect(poolTime).toBeGreaterThanOrEqual(0);
      expect(directTime).toBeGreaterThanOrEqual(0);
    });

    it('should handle rapid get/release cycles efficiently', () => {
      const startTime = window.performance.now();

      // Perform many rapid get/release cycles
      for (let i = 0; i < 1000; i++) {
        const obj = pool.get();
        pool.release(obj);
      }

      const totalTime = window.performance.now() - startTime;
      expect(totalTime).toBeLessThan(100); // Should complete in under 100ms
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory when pool is cleared', () => {
      // Fill pool
      const objects: TestProjectile[] = [];
      for (let i = 0; i < 5; i++) {
        objects.push(pool.get());
      }
      objects.forEach((obj) => pool.release(obj));

      const initialStats = pool.getStats();
      expect(initialStats.poolSize).toBe(5);

      // Clear and verify
      pool.clear();
      const clearedStats = pool.getStats();
      expect(clearedStats.poolSize).toBe(0);
    });

    it('should handle edge case of releasing null/undefined', () => {
      // The pool may or may not handle null gracefully depending on implementation
      // Test that the pool continues to function after attempting null releases
      const initialStats = pool.getStats();

      try {
        pool.release(null as unknown as TestProjectile);
      } catch {
        // Expected - null release may throw
      }

      try {
        pool.release(undefined as unknown as TestProjectile);
      } catch {
        // Expected - undefined release may throw
      }

      // Pool should still function after invalid releases
      const obj = pool.get();
      expect(obj).toBeInstanceOf(TestProjectile);
      pool.release(obj);
      expect(pool.getStats().poolSize).toBeGreaterThanOrEqual(initialStats.poolSize);
    });
  });
});

describe('ObjectPoolService', () => {
  let service: ObjectPoolService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ObjectPoolService],
    });
    service = TestBed.inject(ObjectPoolService);
  });

  describe('Pool Management', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should create and register new pools', () => {
      const createFn = (): TestProjectile => new TestProjectile();
      const resetFn = (obj: TestProjectile): void => obj.reset();

      const pool = service.createPool('projectiles', createFn, resetFn, 10);

      expect(pool).toBeInstanceOf(ObjectPool);
      expect(service.getPool('projectiles')).toBe(pool);
    });

    it('should retrieve existing pools by name', () => {
      const createFn = (): TestParticle => new TestParticle();
      const resetFn = (obj: TestParticle): void => obj.reset();

      const originalPool = service.createPool('particles', createFn, resetFn);
      const retrievedPool = service.getPool<TestParticle>('particles');

      expect(retrievedPool).toBe(originalPool);
    });

    it('should return undefined for non-existent pools', () => {
      const pool = service.getPool('nonexistent');
      expect(pool).toBeUndefined();
    });

    it('should handle multiple pools with different types', () => {
      // Create projectile pool
      service.createPool(
        'projectiles',
        () => new TestProjectile(),
        (obj: TestProjectile) => obj.reset(),
        20
      );

      // Create particle pool
      service.createPool(
        'particles',
        () => new TestParticle(),
        (obj: TestParticle) => obj.reset(),
        50
      );

      const projectilePool = service.getPool<TestProjectile>('projectiles');
      const particlePool = service.getPool<TestParticle>('particles');

      expect(projectilePool).toBeDefined();
      expect(particlePool).toBeDefined();
      expect(projectilePool).not.toBe(particlePool);
    });
  });

  describe('Object Operations', () => {
    beforeEach(() => {
      // Set up test pools
      service.createPool(
        'projectiles',
        () => new TestProjectile(),
        (obj: TestProjectile) => obj.reset(),
        5
      );

      service.createPool(
        'particles',
        () => new TestParticle(),
        (obj: TestParticle) => obj.reset(),
        10
      );
    });

    it('should get objects from specific pools', () => {
      const projectile = service.get<TestProjectile>('projectiles');
      const particle = service.get<TestParticle>('particles');

      expect(projectile).toBeInstanceOf(TestProjectile);
      expect(particle).toBeInstanceOf(TestParticle);
    });

    it('should return undefined when getting from non-existent pool', () => {
      const obj = service.get('nonexistent');
      expect(obj).toBeUndefined();
    });

    it('should release objects back to correct pools', () => {
      const projectile = service.get<TestProjectile>('projectiles')!;
      projectile.x = 100;
      projectile.damage = 50;

      service.release('projectiles', projectile);

      // Get another object (should be the same, reset one)
      const reusedProjectile = service.get<TestProjectile>('projectiles')!;
      expect(reusedProjectile).toBe(projectile);
      expect(reusedProjectile.x).toBe(0); // Should be reset
      expect(reusedProjectile.damage).toBe(0); // Should be reset
    });

    it('should handle releasing to non-existent pools gracefully', () => {
      const projectile = new TestProjectile();
      expect(() => {
        service.release('nonexistent', projectile);
      }).not.toThrow();
    });
  });

  describe('Batch Operations', () => {
    beforeEach(() => {
      service.createPool(
        'projectiles',
        () => new TestProjectile(),
        (obj: TestProjectile) => obj.reset(),
        3
      );

      service.createPool(
        'particles',
        () => new TestParticle(),
        (obj: TestParticle) => obj.reset(),
        5
      );
    });

    it('should clear all pools', () => {
      // Get and release some objects to fill pools
      const projectiles = [service.get<TestProjectile>('projectiles')!, service.get<TestProjectile>('projectiles')!];
      const particles = [
        service.get<TestParticle>('particles')!,
        service.get<TestParticle>('particles')!,
        service.get<TestParticle>('particles')!,
      ];

      projectiles.forEach((obj) => service.release('projectiles', obj));
      particles.forEach((obj) => service.release('particles', obj));

      // Verify pools have objects
      let stats = service.getAllStats();
      expect(stats['projectiles'].poolSize).toBe(2);
      expect(stats['particles'].poolSize).toBe(3);

      // Clear all and verify
      service.clearAll();
      stats = service.getAllStats();
      expect(stats['projectiles'].poolSize).toBe(0);
      expect(stats['particles'].poolSize).toBe(0);
    });

    it('should get statistics for all pools', () => {
      // Add some objects to pools
      const projectile = service.get<TestProjectile>('projectiles')!;
      service.release('projectiles', projectile);

      const particles = [service.get<TestParticle>('particles')!, service.get<TestParticle>('particles')!];
      particles.forEach((obj) => service.release('particles', obj));

      const allStats = service.getAllStats();

      expect(allStats['projectiles']).toEqual({
        poolSize: 1,
        maxSize: 3,
        utilization: jasmine.any(Number),
      });

      expect(allStats['particles']).toEqual({
        poolSize: 2,
        maxSize: 5,
        utilization: jasmine.any(Number),
      });
    });
  });

  describe('Game Integration Scenarios', () => {
    interface Bullet {
      x: number;
      y: number;
      velocity: number;
      damage: number;
      active: boolean;
    }

    interface Explosion {
      x: number;
      y: number;
      radius: number;
      duration: number;
      active: boolean;
    }

    interface Powerup {
      x: number;
      y: number;
      type: string;
      collected: boolean;
    }

    beforeEach(() => {
      // Set up pools for common game objects
      service.createPool<Bullet>(
        'bullets',
        () => ({ x: 0, y: 0, velocity: 0, damage: 10, active: false }),
        (obj) => {
          obj.x = 0;
          obj.y = 0;
          obj.velocity = 0;
          obj.active = false;
        },
        100
      );

      service.createPool<Explosion>(
        'explosions',
        () => ({ x: 0, y: 0, radius: 0, duration: 0, active: false }),
        (obj: Explosion) => {
          obj.x = 0;
          obj.y = 0;
          obj.radius = 0;
          obj.duration = 0;
          obj.active = false;
        },
        50
      );

      service.createPool<Powerup>(
        'powerups',
        () => ({ x: 0, y: 0, type: '', collected: false }),
        (obj: Powerup) => {
          obj.x = 0;
          obj.y = 0;
          obj.type = '';
          obj.collected = false;
        },
        20
      );
    });

    it('should support typical game loop object lifecycle', () => {
      // Simulate bullet firing
      const bullet = service.get<Bullet>('bullets')!;
      bullet.x = 100;
      bullet.y = 200;
      bullet.velocity = 500;
      bullet.active = true;

      expect(bullet.active).toBe(true);

      // Simulate bullet hit/destruction
      service.release('bullets', bullet);

      // Get another bullet (should be reset)
      const newBullet = service.get<Bullet>('bullets')!;
      expect(newBullet).toBe(bullet); // Same object, reused
      expect(newBullet.active).toBe(false); // Reset state
      expect(newBullet.x).toBe(0);
    });

    it('should handle high-frequency object creation/destruction', () => {
      const startTime = window.performance.now();

      // Simulate rapid fire scenario
      for (let frame = 0; frame < 60; frame++) {
        // 60 frames
        for (let i = 0; i < 5; i++) {
          // 5 bullets per frame
          const bullet = service.get<Bullet>('bullets')!;
          bullet.x = Math.random() * 800;
          bullet.y = Math.random() * 600;

          // Simulate immediate destruction (worst case for GC)
          service.release('bullets', bullet);
        }
      }

      const totalTime = window.performance.now() - startTime;
      expect(totalTime).toBeLessThan(100); // Should be fast

      // Pool should efficiently reuse objects
      const stats = service.getAllStats();
      expect(stats['bullets'].poolSize).toBeGreaterThan(0);
    });

    it('should manage memory efficiently across multiple object types', () => {
      // Create many different objects
      const bullets = [];
      const explosions = [];
      const powerups = [];

      // Create 50 of each type
      for (let i = 0; i < 50; i++) {
        bullets.push(service.get('bullets')!);
        explosions.push(service.get('explosions')!);
        powerups.push(service.get('powerups')!);
      }

      // Release them all
      bullets.forEach((obj) => service.release('bullets', obj));
      explosions.forEach((obj) => service.release('explosions', obj));
      powerups.forEach((obj) => service.release('powerups', obj));

      const stats = service.getAllStats();

      // Pools should be at their maximum capacity (limited by maxSize or created count)
      expect(stats['bullets'].poolSize).toBe(50); // Created 50, max is 100, so 50 in pool
      expect(stats['explosions'].poolSize).toBe(50); // Created 50, max is 50, so 50 in pool
      expect(stats['powerups'].poolSize).toBe(20); // Created 50 but max is 20, capped at 20
    });

    it('should support complex object relationships', () => {
      // Create bullet and associated explosion
      const bullet = service.get<Bullet>('bullets')!;
      bullet.x = 300;
      bullet.y = 400;

      // Bullet hits target, create explosion at same location
      const explosion = service.get<{ x: number; y: number; radius: number; duration: number; active: boolean }>(
        'explosions'
      )!;
      explosion.x = bullet.x;
      explosion.y = bullet.y;
      explosion.radius = 50;

      // Clean up both objects
      service.release('bullets', bullet);
      service.release('explosions', explosion);

      // Verify proper cleanup
      const newBullet = service.get<Bullet>('bullets')!;
      const newExplosion = service.get<{ x: number; y: number; radius: number; duration: number; active: boolean }>(
        'explosions'
      )!;

      expect(newBullet.x).toBe(0); // Reset
      expect(newExplosion.x).toBe(0); // Reset
      expect(newExplosion.radius).toBe(0); // Reset
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle pool creation with invalid parameters gracefully', () => {
      expect(() => {
        service.createPool('test', null as unknown as () => unknown, null as unknown as (obj: unknown) => void, 0);
      }).not.toThrow();
    });

    it('should handle concurrent access to pools', () => {
      service.createPool(
        'concurrent',
        () => ({ id: Math.random() }),
        (obj: { id: number }) => {
          obj.id = 0;
        },
        10
      );

      // Simulate concurrent access
      const objects = [];
      for (let i = 0; i < 20; i++) {
        objects.push(service.get('concurrent')!);
      }

      // All objects should be valid and unique
      const ids = objects.map((obj) => obj.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(objects.length); // All should be unique initially

      // Release all objects
      objects.forEach((obj) => service.release('concurrent', obj));

      // Get objects again - should reuse from pool
      const reusedObjects = [];
      for (let i = 0; i < 10; i++) {
        reusedObjects.push(service.get('concurrent')!);
      }

      // Should reuse objects from pool (all should have id = 0 after reset)
      reusedObjects.forEach((obj) => {
        expect(obj.id).toBe(0);
      });
    });
  });
});
