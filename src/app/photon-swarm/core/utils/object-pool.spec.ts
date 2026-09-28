/**
 * Specs for the generic ObjectPool<T> class in object-pool.ts.
 * NOTE: object-pool.service.ts is a separate file with its own spec.
 * This file targets the lower-level ObjectPool<T> + factory functions.
 */
import {
  createEffectPool,
  createEnemyPool,
  createProjectilePool,
  ObjectPool,
  PooledEffect,
  PooledEnemy,
  PooledProjectile,
} from './object-pool';

// ─── helpers ────────────────────────────────────────────────────────────────

interface SimpleObj {
  value: number;
  tag: string;
}

function makeSimplePool(initialSize = 0, maxSize = 10): ObjectPool<SimpleObj> {
  return new ObjectPool<SimpleObj>(
    () => ({ value: 0, tag: '' }),
    (obj) => {
      obj.value = 0;
      obj.tag = '';
    },
    initialSize,
    maxSize
  );
}

// ─── ObjectPool<T> ──────────────────────────────────────────────────────────

describe('ObjectPool', () => {
  beforeEach(() => {
    // Silence debugLogBridge warnings during release tests
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
  });

  afterEach(() => {
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
  });

  // ── construction / pre-population ─────────────────────────────────────────

  describe('constructor', () => {
    it('pre-populates the pool with initialSize objects', () => {
      const pool = makeSimplePool(5, 20);
      const stats = pool.getStats();
      // 5 pre-created, none active
      expect(stats.poolSize).toBe(5);
      expect(stats.activeCount).toBe(0);
      expect(stats.totalCreated).toBe(5);
    });

    it('respects maxSize during pre-population', () => {
      const pool = makeSimplePool(50, 5);
      const stats = pool.getStats();
      expect(stats.poolSize).toBe(5);
    });

    it('initializes with zero reuse', () => {
      const pool = makeSimplePool(3, 10);
      const stats = pool.getStats();
      expect(stats.reused).toBe(0);
      expect(stats.returned).toBe(0);
    });
  });

  // ── acquire ───────────────────────────────────────────────────────────────

  describe('acquire', () => {
    it('returns an object and tracks it as active', () => {
      const pool = makeSimplePool(0, 5);
      const obj = pool.acquire();
      expect(obj).toBeDefined();
      expect(pool.getStats().activeCount).toBe(1);
    });

    it('reuses a pooled object after it has been released', () => {
      const pool = makeSimplePool(1, 5); // 1 pre-created
      const first = pool.acquire();
      pool.release(first);
      const second = pool.acquire();
      expect(second).toBe(first); // same reference
      expect(pool.getStats().reused).toBeGreaterThan(0);
    });

    it('creates a new object when pool is empty', () => {
      const pool = makeSimplePool(0, 5);
      const obj = pool.acquire();
      expect(obj).toBeDefined();
      expect(pool.getStats().created).toBe(1);
    });

    it('tracking increments created for new objects', () => {
      const pool = makeSimplePool(0, 2);
      pool.acquire();
      pool.acquire();
      expect(pool.getStats().created).toBe(2);
    });
  });

  // ── release ───────────────────────────────────────────────────────────────

  describe('release', () => {
    it('calls resetFn with the object on release', () => {
      const resetFn = jasmine.createSpy('resetFn');
      const pool = new ObjectPool<SimpleObj>(() => ({ value: 42, tag: 'hello' }), resetFn, 0, 10);
      const obj = pool.acquire();
      pool.release(obj);
      expect(resetFn).toHaveBeenCalledWith(obj);
    });

    it('decrements activeCount after release', () => {
      const pool = makeSimplePool(0, 5);
      const obj = pool.acquire();
      expect(pool.getStats().activeCount).toBe(1);
      pool.release(obj);
      expect(pool.getStats().activeCount).toBe(0);
    });

    it('does not add to pool if at maxSize', () => {
      const pool = makeSimplePool(5, 5); // already full
      const obj = pool.acquire(); // removes one from pool
      pool.release(obj); // should put it back (pool now 5 again)
      // acquire another to make room, then fill again
      const obj2 = pool.acquire();
      pool.release(obj2);
      expect(pool.getStats().poolSize).toBeLessThanOrEqual(5);
    });

    it('increments returned count', () => {
      const pool = makeSimplePool(0, 5);
      const obj = pool.acquire();
      pool.release(obj);
      expect(pool.getStats().returned).toBe(1);
    });

    it('ignores objects not from this pool (no throw)', () => {
      const pool = makeSimplePool(0, 5);
      const foreign: SimpleObj = { value: 99, tag: 'foreign' };
      expect(() => pool.release(foreign)).not.toThrow();
      // activeCount should not change
      expect(pool.getStats().activeCount).toBe(0);
    });
  });

  // ── releaseAll ────────────────────────────────────────────────────────────

  describe('releaseAll', () => {
    it('returns all active objects to pool', () => {
      const pool = makeSimplePool(0, 10);
      const a = pool.acquire();
      const b = pool.acquire();
      const c = pool.acquire();
      expect(pool.getStats().activeCount).toBe(3);
      pool.releaseAll();
      expect(pool.getStats().activeCount).toBe(0);
      // All three should be back in the pool
      expect(pool.getStats().poolSize).toBe(3);
      // Suppress unused-var lint for explicit acquire test
      void a;
      void b;
      void c;
    });

    it('is a no-op when nothing is active', () => {
      const pool = makeSimplePool(2, 10);
      const before = pool.getStats();
      pool.releaseAll();
      const after = pool.getStats();
      expect(after.activeCount).toBe(before.activeCount);
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('empties pool and active set', () => {
      const pool = makeSimplePool(3, 10);
      const obj = pool.acquire();
      pool.clear();
      expect(pool.getStats().poolSize).toBe(0);
      expect(pool.getStats().activeCount).toBe(0);
      void obj;
    });

    it('allows acquiring new objects after clear', () => {
      const pool = makeSimplePool(3, 10);
      pool.clear();
      const obj = pool.acquire();
      expect(obj).toBeDefined();
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    it('returns correct reuseRate after acquire/release cycle', () => {
      const pool = makeSimplePool(1, 5);
      const obj = pool.acquire(); // reused (was pre-populated)
      pool.release(obj);
      const again = pool.acquire(); // reused
      void again;
      const stats = pool.getStats();
      // created = 1 (pre-pop), reused = 2 (two acquires from pool)
      expect(stats.reused).toBe(2);
      expect(stats.reuseRate).toBeGreaterThan(0);
    });

    it('reuseRate is 0 when nothing has been reused', () => {
      const pool = makeSimplePool(0, 5);
      pool.acquire(); // creates new, not reused
      const stats = pool.getStats();
      // created=1, reused=0 → reuseRate = 0/(1+0) = 0
      expect(stats.reuseRate).toBe(0);
    });

    it('exposes resized count from constructor grow', () => {
      const pool = makeSimplePool(5, 10);
      // grow is called once in constructor
      expect(pool.getStats().resized).toBe(1);
    });
  });
});

// ─── Factory functions ────────────────────────────────────────────────────────

describe('createEnemyPool', () => {
  let pool: ObjectPool<PooledEnemy>;

  beforeEach(() => {
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
    pool = createEnemyPool();
  });

  it('returns a pool with 50 pre-created enemies', () => {
    expect(pool.getStats().poolSize).toBe(50);
  });

  it('acquired enemy has expected default values', () => {
    const enemy = pool.acquire();
    expect(enemy.id).toBe(0);
    expect(enemy.health).toBe(0);
    expect(enemy.maxHealth).toBe(100);
    expect(enemy.isChampion).toBe(false);
    expect(enemy.isDancing).toBe(false);
  });

  it('resetFn zeros out mutable fields on release', () => {
    const enemy = pool.acquire();
    enemy.id = 42;
    enemy.health = 80;
    enemy.isChampion = true;
    enemy.factionId = 3;
    pool.release(enemy);
    const reused = pool.acquire();
    expect(reused.id).toBe(0);
    expect(reused.health).toBe(0);
    expect(reused.isChampion).toBe(false);
    expect(reused.factionId).toBe(0);
  });
});

describe('createProjectilePool', () => {
  let pool: ObjectPool<PooledProjectile>;

  beforeEach(() => {
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
    pool = createProjectilePool();
  });

  it('returns a pool with 100 pre-created projectiles', () => {
    expect(pool.getStats().poolSize).toBe(100);
  });

  it('acquired projectile has expected default values', () => {
    const proj = pool.acquire();
    expect(proj.id).toBe(0);
    expect(proj.isCharged).toBe(false);
    expect(proj.shouldEmitTrail).toBe(false);
    expect(proj.trailData.points.length).toBe(0);
  });

  it('resetFn clears trail points and resets flags', () => {
    const proj = pool.acquire();
    proj.isCharged = true;
    proj.shouldEmitTrail = true;
    proj.trailData.points.push({ x: 1, y: 2, timestamp: Date.now() });
    pool.release(proj);
    const reused = pool.acquire();
    expect(reused.isCharged).toBe(false);
    expect(reused.shouldEmitTrail).toBe(false);
    expect(reused.trailData.points.length).toBe(0);
  });
});

describe('createEffectPool', () => {
  let pool: ObjectPool<PooledEffect>;

  beforeEach(() => {
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
    pool = createEffectPool();
  });

  it('returns a pool with 20 pre-created effects', () => {
    expect(pool.getStats().poolSize).toBe(20);
  });

  it('acquired effect has expected default values', () => {
    const effect = pool.acquire();
    expect(effect.x).toBe(0);
    expect(effect.y).toBe(0);
    expect(effect.currentRadius).toBe(0);
    expect(effect.maxRadius).toBe(100);
    expect(effect.opacity).toBe(1);
  });

  it('resetFn resets all fields on release', () => {
    const effect = pool.acquire();
    effect.x = 50;
    effect.y = 75;
    effect.currentRadius = 30;
    effect.opacity = 0.5;
    pool.release(effect);
    const reused = pool.acquire();
    expect(reused.x).toBe(0);
    expect(reused.y).toBe(0);
    expect(reused.currentRadius).toBe(0);
    expect(reused.opacity).toBe(1);
  });
});
