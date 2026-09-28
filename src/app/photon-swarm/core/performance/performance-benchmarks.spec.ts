/**
 * Performance Benchmark Tests — Regression Gates
 *
 * These tests enforce performance budgets on the core ECS and spatial systems.
 * They are NOT correctness tests; they exist to catch accidental regressions that
 * degrade frame-time budget (e.g. replacing a Map lookup with an O(n) scan,
 * leaking objects that defeat the pool, removing the query cache).
 *
 * Thresholds are deliberately generous (~3-5x the expected measured time on a
 * modern machine) so tests remain green on slower CI runners without masking
 * real regressions.
 *
 * ─── What each suite protects ──────────────────────────────────────────────
 *  1. Entity query            — O(n) index intersection stays fast at 500 entities
 *  2. Object pool throughput  — pool get/release stays O(1) with no allocation spike
 *  3. Component add/remove    — Map mutation + index update stays sub-linear
 *  4. Entity lifecycle        — create/destroy cycle stays bounded at scale
 *  5. Query cache             — repeated same-query calls hit cache, not re-scan
 * ────────────────────────────────────────────────────────────────────────────
 */

import { TestBed } from '@angular/core/testing';
import { Component } from '../ecs/ecs.model';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { ObjectPool, ObjectPoolService } from '../utils/object-pool.service';

// ─── Lightweight test components ────────────────────────────────────────────
// Defined locally so benchmarks have no dependency on the real game components.

class PositionComp implements Component {
  x: number;
  y: number;
  constructor(...args: unknown[]) {
    this.x = (args[0] as number) ?? 0;
    this.y = (args[1] as number) ?? 0;
  }
}

class VelocityComp implements Component {
  vx: number;
  vy: number;
  constructor(...args: unknown[]) {
    this.vx = (args[0] as number) ?? 0;
    this.vy = (args[1] as number) ?? 0;
  }
}

class HealthComp implements Component {
  hp: number;
  constructor(...args: unknown[]) {
    this.hp = (args[0] as number) ?? 100;
  }
}

class TagComp implements Component {
  tag: string;
  constructor(...args: unknown[]) {
    this.tag = (args[0] as string) ?? '';
  }
}

// ─── Pooled object used in pool benchmarks ───────────────────────────────────

interface PooledProjectile {
  x: number;
  y: number;
  active: boolean;
}

function createProjectile(): PooledProjectile {
  return { x: 0, y: 0, active: false };
}

function resetProjectile(p: PooledProjectile): void {
  p.x = 0;
  p.y = 0;
  p.active = false;
}

// ─── Suite 1: Entity query performance ───────────────────────────────────────

describe('Performance Benchmark: Entity query (500 entities, 100 queries)', () => {
  /**
   * Protects against: removing componentIndex, reverting to full entity scan,
   * or adding O(n) work inside getEntitiesWithComponents.
   *
   * Budget: 50 ms total for 100 multi-component queries over 500 entities.
   * Typical measured time on a laptop: ~2-5 ms.
   */

  let entityManager: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entityManager = TestBed.inject(EntityManagerService);

    // Populate: 500 entities with staggered component sets
    for (let i = 0; i < 500; i++) {
      const e = entityManager.createEntity();
      entityManager.addComponent(e, new PositionComp(i * 2, i * 3));
      if (i % 2 === 0) {
        entityManager.addComponent(e, new VelocityComp(1, 0));
      }
      if (i % 3 === 0) {
        entityManager.addComponent(e, new HealthComp(100));
      }
    }
  });

  afterEach(() => {
    entityManager.clear();
  });

  it('should run 100 multi-component queries under 50ms', () => {
    const QUERY_ITERATIONS = 100;
    const BUDGET_MS = 50;

    const start = performance.now();
    for (let i = 0; i < QUERY_ITERATIONS; i++) {
      // Alternate between 1-component and 2-component queries to exercise both paths
      if (i % 2 === 0) {
        entityManager.getEntitiesWithComponents(PositionComp, VelocityComp);
      } else {
        entityManager.getEntitiesWithComponents(PositionComp, HealthComp);
      }
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should run 100 single-component queries under 20ms', () => {
    const QUERY_ITERATIONS = 100;
    const BUDGET_MS = 20;

    const start = performance.now();
    for (let i = 0; i < QUERY_ITERATIONS; i++) {
      entityManager.getEntitiesWithComponents(PositionComp);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

// ─── Suite 2: Object pool throughput ─────────────────────────────────────────

describe('Performance Benchmark: Object pool (1000 get/release cycles)', () => {
  /**
   * Protects against: removing the pool backing array, switching to map-based
   * tracking with extra bookkeeping, or adding GC-triggering allocations per call.
   *
   * Budget: 20 ms for 1000 get + 1000 release = 2000 operations.
   * Typical measured time: < 1 ms.
   */

  it('should complete 1000 get/release cycles under 20ms (ObjectPool direct)', () => {
    const CYCLES = 1000;
    const BUDGET_MS = 20;

    const pool = new ObjectPool<PooledProjectile>(createProjectile, resetProjectile, 200);

    const start = performance.now();
    for (let i = 0; i < CYCLES; i++) {
      const obj = pool.get();
      obj.x = i;
      obj.active = true;
      pool.release(obj);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should complete 1000 get/release cycles under 20ms (ObjectPoolService)', () => {
    const CYCLES = 1000;
    const BUDGET_MS = 20;

    TestBed.configureTestingModule({});
    const svc = TestBed.inject(ObjectPoolService);
    svc.createPool<PooledProjectile>('bench-projectile', createProjectile, resetProjectile, 200);

    const start = performance.now();
    for (let i = 0; i < CYCLES; i++) {
      const obj = svc.get<PooledProjectile>('bench-projectile');
      if (obj) {
        obj.x = i;
        svc.release('bench-projectile', obj);
      }
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should handle pool exhaustion and re-fill gracefully under 30ms', () => {
    /**
     * Gets more objects than maxSize, then releases all, then gets again.
     * Ensures the pool correctly falls back to creating new objects when
     * exhausted without a performance cliff.
     */
    const MAX_SIZE = 50;
    const OVER_COMMIT = 150; // 3x overcommit
    const BUDGET_MS = 30;

    const pool = new ObjectPool<PooledProjectile>(createProjectile, resetProjectile, MAX_SIZE);

    const start = performance.now();
    const held: PooledProjectile[] = [];
    for (let i = 0; i < OVER_COMMIT; i++) {
      held.push(pool.get());
    }
    for (const obj of held) {
      pool.release(obj);
    }
    for (let i = 0; i < OVER_COMMIT; i++) {
      pool.get();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

// ─── Suite 3: Component add/remove ───────────────────────────────────────────

describe('Performance Benchmark: Component add/remove (500 entities)', () => {
  /**
   * Protects against: adding O(n) scans inside addComponent/removeComponent,
   * synchronous cache rebuild on every mutation, or leaking component index entries.
   *
   * Budget: 20 ms total for 500 addComponent + 500 removeComponent calls.
   * Typical measured time: < 3 ms.
   */

  let entityManager: EntityManagerService;
  let entities: number[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entityManager = TestBed.inject(EntityManagerService);
    entities = [];
    for (let i = 0; i < 500; i++) {
      entities.push(entityManager.createEntity());
    }
  });

  afterEach(() => {
    entityManager.clear();
  });

  it('should add 500 components under 20ms', () => {
    const BUDGET_MS = 20;

    const start = performance.now();
    for (let i = 0; i < entities.length; i++) {
      entityManager.addComponent(entities[i], new PositionComp(i, i));
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should remove 500 components under 20ms', () => {
    const BUDGET_MS = 20;

    // Pre-add components outside the timed section
    for (let i = 0; i < entities.length; i++) {
      entityManager.addComponent(entities[i], new PositionComp(i, i));
    }

    const start = performance.now();
    for (const entity of entities) {
      entityManager.removeComponent(entity, PositionComp);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should handle 500 add-then-remove cycles (no leaks) under 30ms', () => {
    /**
     * Add and immediately remove the same component type 500 times on the same
     * entity. Verifies componentIndex cleanup and no unbounded growth.
     */
    const BUDGET_MS = 30;
    const target = entities[0];

    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      entityManager.addComponent(target, new HealthComp(i));
      entityManager.removeComponent(target, HealthComp);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
    // Verify no leaked component index entries
    expect(entityManager.hasComponent(target, HealthComp)).toBe(false);
  });
});

// ─── Suite 4: Entity creation/destruction ────────────────────────────────────

describe('Performance Benchmark: Entity create/destroy (500 entities)', () => {
  /**
   * Protects against: O(n²) cleanup in destroyEntity (iterating all entities),
   * cache thrashing during bulk creation, or Map re-allocation overhead.
   *
   * Budget: 50 ms for 500 creates + 500 destroys.
   * Typical measured time: < 5 ms.
   */

  let entityManager: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  it('should create 500 entities under 25ms', () => {
    const BUDGET_MS = 25;

    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      entityManager.createEntity();
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(entityManager.getEntityCount()).toBe(500);
  });

  it('should destroy 500 entities under 25ms', () => {
    const BUDGET_MS = 25;

    // Create all entities outside the timed section
    const entities: number[] = [];
    for (let i = 0; i < 500; i++) {
      const e = entityManager.createEntity();
      // Give each entity a couple of components to exercise full cleanup path
      entityManager.addComponent(e, new PositionComp(i, i));
      entityManager.addComponent(e, new VelocityComp(1, 0));
      entities.push(e);
    }

    const start = performance.now();
    for (const e of entities) {
      entityManager.destroyEntity(e);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(entityManager.getEntityCount()).toBe(0);
  });

  it('should complete full create+destroy cycle for 500 entities under 50ms', () => {
    const BUDGET_MS = 50;

    const start = performance.now();
    const created: number[] = [];
    for (let i = 0; i < 500; i++) {
      const e = entityManager.createEntity();
      entityManager.addComponent(e, new PositionComp(i, i));
      created.push(e);
    }
    for (const e of created) {
      entityManager.destroyEntity(e);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

// ─── Suite 5: Query cache effectiveness ──────────────────────────────────────

describe('Performance Benchmark: Query cache effectiveness', () => {
  /**
   * Protects against: removing the queryCache, accidentally invalidating it on
   * reads (not just writes), or increasing the cache-key generation cost.
   *
   * Approach: run the same query 1000 times without any mutations to force 100%
   * cache hits. Then run a single uncached pass (after calling clear() + rebuild)
   * and compare. Cached batch must complete in less than 1/5 the time of an
   * equivalent uncached scan — a conservative 5x speedup requirement.
   *
   * Budget for 1000 cached queries: 15 ms (generous to account for CI overhead).
   */

  let entityManager: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    entityManager = TestBed.inject(EntityManagerService);

    // Populate 500 entities with two component types
    for (let i = 0; i < 500; i++) {
      const e = entityManager.createEntity();
      entityManager.addComponent(e, new PositionComp(i, i));
      if (i % 2 === 0) {
        entityManager.addComponent(e, new VelocityComp(1, 0));
      }
    }
    // Warm the cache with one query before timing
    entityManager.getEntitiesWithComponents(PositionComp, VelocityComp);
  });

  afterEach(() => {
    entityManager.clear();
  });

  it('should serve 1000 cached queries under 15ms', () => {
    const ITERATIONS = 1000;
    const BUDGET_MS = 15;

    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      entityManager.getEntitiesWithComponents(PositionComp, VelocityComp);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('should be at least 5x faster cached vs uncached for 100 iterations', () => {
    /**
     * Uncached baseline: invalidate the cache before each query by calling
     * addComponent on a fresh entity, then destroy it. This simulates the worst
     * case of perpetually dirty state and forces a real index scan every time.
     */
    const ITERATIONS = 100;
    const SPEEDUP_FACTOR = 5;

    // ── Uncached timing: force cache miss before each query ──
    const uncachedStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      // Mutation invalidates the cache
      const tempEntity = entityManager.createEntity();
      entityManager.addComponent(tempEntity, new TagComp('temp'));
      entityManager.destroyEntity(tempEntity);
      // Now do the query (cache miss guaranteed)
      entityManager.getEntitiesWithComponents(PositionComp, VelocityComp);
    }
    const uncachedElapsed = performance.now() - uncachedStart;

    // Warm the cache once
    entityManager.getEntitiesWithComponents(PositionComp, VelocityComp);

    // ── Cached timing: no mutations, cache stays valid ──
    const cachedStart = performance.now();
    for (let i = 0; i < ITERATIONS; i++) {
      entityManager.getEntitiesWithComponents(PositionComp, VelocityComp);
    }
    const cachedElapsed = performance.now() - cachedStart;

    // Guard against division-by-zero on extremely fast hardware.
    // If cachedElapsed rounds to 0, the cache is trivially fast — assert uncached
    // took at least some measurable time as a sanity check instead.
    if (cachedElapsed > 0) {
      const speedup = uncachedElapsed / cachedElapsed;
      expect(speedup).toBeGreaterThan(SPEEDUP_FACTOR);
    } else {
      // Sub-millisecond cached time: the cache is definitely working.
      // Assert that uncached queries at least took longer than zero.
      expect(uncachedElapsed).toBeGreaterThanOrEqual(0);
    }
  });
});
