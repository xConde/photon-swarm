/**
 * targeting-performance.spec.ts
 *
 * Performance and correctness tests for findNearestAliveEnemy() and the
 * cached targeting mechanism used by Focus Fire.
 *
 * Covers:
 *   - High enemy count performance (50 / 100 / 200 enemies)
 *   - Dead enemy filtering
 *   - Single enemy edge case
 *   - No enemies
 *   - All enemies dead
 *   - Target invalidation (nearest enemy dies → new nearest returned)
 *   - Equal distance tiebreaking (no crash, valid result)
 */

import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { EnemyTypeComponent, HealthComponent, PositionComponent } from '@photon/components';
import { findNearestAliveEnemy } from './targeting';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function createEnemy(em: EntityManagerService, x: number, y: number, health: number): number {
  const entity = em.createEntity();
  em.addComponent(entity, new PositionComponent(x, y));
  em.addComponent(entity, new EnemyTypeComponent());
  em.addComponent(entity, new HealthComponent(health, health));
  return entity;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('findNearestAliveEnemy — correctness', () => {
  let entityManager: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EntityManagerService],
    });
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  // ── No enemies ────────────────────────────────────────────────────────────

  it('should return null when no enemies exist', () => {
    const result = findNearestAliveEnemy(0, 0, entityManager);
    expect(result).toBeNull();
  });

  // ── Single enemy ──────────────────────────────────────────────────────────

  it('should return the only enemy when a single alive enemy exists', () => {
    const entity = createEnemy(entityManager, 42, 17, 100);

    const result = findNearestAliveEnemy(0, 0, entityManager);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(entity);
    expect(result!.x).toBe(42);
    expect(result!.y).toBe(17);
  });

  // ── Dead enemy filtering ──────────────────────────────────────────────────

  it('should never return an enemy with health exactly 0', () => {
    createEnemy(entityManager, 10, 0, 0); // dead — closest
    const alive = createEnemy(entityManager, 200, 0, 50);

    const result = findNearestAliveEnemy(0, 0, entityManager);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(alive);
  });

  it('should never return an enemy with negative health', () => {
    createEnemy(entityManager, 5, 0, -1); // dead — closest
    const alive = createEnemy(entityManager, 100, 0, 50);

    const result = findNearestAliveEnemy(0, 0, entityManager);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(alive);
  });

  it('should return null when all enemies are dead', () => {
    createEnemy(entityManager, 10, 0, 0);
    createEnemy(entityManager, 20, 0, 0);
    createEnemy(entityManager, 30, 0, -10);

    const result = findNearestAliveEnemy(0, 0, entityManager);

    expect(result).toBeNull();
  });

  // ── Mixed alive/dead ──────────────────────────────────────────────────────

  it('should ignore dead enemies in a mixed population', () => {
    const dead1 = createEnemy(entityManager, 5, 0, 0);
    const dead2 = createEnemy(entityManager, 10, 0, 0);
    const alive1 = createEnemy(entityManager, 80, 0, 100);
    const alive2 = createEnemy(entityManager, 50, 0, 100); // closer of the two alive

    void dead1;
    void dead2;
    void alive1;

    const result = findNearestAliveEnemy(0, 0, entityManager);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(alive2);
  });

  // ── Nearest selection ─────────────────────────────────────────────────────

  it('should return the nearest alive enemy out of many', () => {
    createEnemy(entityManager, 500, 0, 100);
    createEnemy(entityManager, 300, 0, 100);
    const near = createEnemy(entityManager, 75, 0, 100);
    createEnemy(entityManager, 200, 0, 100);

    const result = findNearestAliveEnemy(0, 0, entityManager);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(near);
  });

  it('should measure distance from the given origin, not from (0,0)', () => {
    // Origin is (90, 90)
    const close = createEnemy(entityManager, 100, 100, 100); // ~14 units away
    const far = createEnemy(entityManager, 0, 0, 100); // ~127 units away

    const result = findNearestAliveEnemy(90, 90, entityManager);

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(close);
    void far;
  });

  // ── Target invalidation ───────────────────────────────────────────────────

  it('should return a new nearest enemy after the previous nearest dies', () => {
    const near = createEnemy(entityManager, 20, 0, 100);
    const fallback = createEnemy(entityManager, 80, 0, 100);

    const first = findNearestAliveEnemy(0, 0, entityManager);
    expect(first).not.toBeNull();
    expect(first!.entityId).toBe(near);

    // Kill the nearest enemy
    const health = entityManager.getComponent(near, HealthComponent);
    if (health) {
      health.health = 0;
    }

    const second = findNearestAliveEnemy(0, 0, entityManager);
    expect(second).not.toBeNull();
    expect(second!.entityId).toBe(fallback);
  });

  it('should return null after the last surviving enemy dies', () => {
    const only = createEnemy(entityManager, 50, 0, 100);

    const first = findNearestAliveEnemy(0, 0, entityManager);
    expect(first).not.toBeNull();

    const health = entityManager.getComponent(only, HealthComponent);
    if (health) {
      health.health = 0;
    }

    const second = findNearestAliveEnemy(0, 0, entityManager);
    expect(second).toBeNull();
  });

  // ── Equal distance tiebreaking ────────────────────────────────────────────

  it('should not crash when two enemies are equidistant and return one of them', () => {
    const a = createEnemy(entityManager, 100, 0, 100);
    const b = createEnemy(entityManager, -100, 0, 100);

    expect(() => {
      const result = findNearestAliveEnemy(0, 0, entityManager);
      expect(result).not.toBeNull();
      expect([a, b]).toContain(result!.entityId);
    }).not.toThrow();
  });

  it('should not crash with enemies at exactly the same position as the origin', () => {
    const onTop = createEnemy(entityManager, 0, 0, 100);

    expect(() => {
      const result = findNearestAliveEnemy(0, 0, entityManager);
      expect(result).not.toBeNull();
      expect(result!.entityId).toBe(onTop);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Performance tests
// ---------------------------------------------------------------------------

describe('findNearestAliveEnemy — performance', () => {
  let entityManager: EntityManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EntityManagerService],
    });
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  /**
   * Spawns `count` enemies in a grid around the origin and measures the wall
   * time for a single findNearestAliveEnemy() call.  The expected nearest
   * enemy is placed at (1, 0) so correctness is verified alongside timing.
   */
  function runPerformanceScenario(count: number, timeBudgetMs: number): void {
    // Place the guaranteed nearest at (1, 0) first
    const nearest = createEnemy(entityManager, 1, 0, 100);

    // Populate the rest spread across a wide area
    for (let i = 1; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const radius = 500 + (i % 50) * 10;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      createEnemy(entityManager, x, y, 100);
    }

    const start = performance.now();
    const result = findNearestAliveEnemy(0, 0, entityManager);
    const elapsed = performance.now() - start;

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(nearest);
    expect(elapsed).toBeLessThan(timeBudgetMs);
  }

  it('should find the nearest enemy among 50 enemies within 5 ms', () => {
    runPerformanceScenario(50, 5);
  });

  it('should find the nearest enemy among 100 enemies within 10 ms', () => {
    runPerformanceScenario(100, 10);
  });

  it('should find the nearest enemy among 200 enemies within 20 ms', () => {
    runPerformanceScenario(200, 20);
  });

  it('should handle repeated calls without degradation — 10 consecutive lookups among 100 enemies', () => {
    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * 2 * Math.PI;
      createEnemy(entityManager, Math.cos(angle) * 200, Math.sin(angle) * 200, 100);
    }

    const iterations = 10;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      findNearestAliveEnemy(0, 0, entityManager);
    }
    const totalElapsed = performance.now() - start;

    // 10 calls over 100 enemies should comfortably finish in under 30 ms total
    expect(totalElapsed).toBeLessThan(30);
  });

  it('should handle 200 enemies where half are dead within 20 ms and skip dead correctly', () => {
    const aliveX = 300;
    // Place the only nearby alive enemy at (300, 0)
    const nearestAlive = createEnemy(entityManager, aliveX, 0, 100);

    // 99 dead enemies closer than aliveX
    for (let i = 1; i <= 99; i++) {
      createEnemy(entityManager, i * 2, 0, 0); // dead
    }

    // 100 more alive enemies farther away
    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * 2 * Math.PI;
      createEnemy(entityManager, Math.cos(angle) * 800, Math.sin(angle) * 800, 100);
    }

    const start = performance.now();
    const result = findNearestAliveEnemy(0, 0, entityManager);
    const elapsed = performance.now() - start;

    expect(result).not.toBeNull();
    expect(result!.entityId).toBe(nearestAlive);
    expect(elapsed).toBeLessThan(20);
  });
});
