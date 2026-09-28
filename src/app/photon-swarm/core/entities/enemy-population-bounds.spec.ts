/**
 * Bounded-population regression test — guard against the May 2026 ghost-bug.
 *
 * Root cause: createEnemy() gave Swarm entities BOTH a SpawnerComponent AND a
 * SplitOnDeathComponent, causing exponential population growth ("wall of
 * jellyfish") and ghost death-flashes as split children died instantly in the
 * beam.  The multiplication code is now commented out; this suite asserts it
 * stays disabled and that repeated spawn/pool cycles do not grow the live enemy
 * population.
 */
import { TestBed } from '@angular/core/testing';
import { EntityFactoryECSService } from './entity-factory-ecs.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { RandomService } from '../utils/random.service';
import { ObjectPoolService } from '../utils/object-pool.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { PlayerService } from '../player/player.service';
import { ThemeService } from '@services/theme.service';
import { EnemyType } from '../models/enemy.model';
import { PoolType } from '@photon/config/game-constants';
import { EnemyTypeComponent, SpawnerComponent, SplitOnDeathComponent } from '@photon/components';

describe('enemy-population-bounds (regression: May 2026 swarm ghost-bug)', () => {
  let factory: EntityFactoryECSService;
  let entityManager: EntityManagerService;

  beforeEach(() => {
    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['getLevelModifier'], {
      level: 1,
    });
    progressionSpy.getLevelModifier.and.returnValue(1);

    const playerSpy = jasmine.createSpyObj('PlayerService', [
      'activateSpawnProtection',
      'deactivateInvincibility',
      'isParryAvailable',
    ]);
    playerSpy.isParryAvailable.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        EntityFactoryECSService,
        EntityManagerService,
        RandomService,
        ObjectPoolService,
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: ThemeService, useValue: { isDayMode: false } },
      ],
    });

    factory = TestBed.inject(EntityFactoryECSService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  // ---------------------------------------------------------------------------
  // Component-composition invariant — the direct cause of the May 2026 bug
  // ---------------------------------------------------------------------------

  describe('Swarm enemy component composition', () => {
    it('does not attach SpawnerComponent to a freshly spawned Swarm enemy', () => {
      const enemy = factory.createEnemy(0, 0, EnemyType.Swarm);
      expect(entityManager.hasComponent(enemy, SpawnerComponent)).toBeFalse();
    });

    it('does not attach SplitOnDeathComponent to a freshly spawned Swarm enemy', () => {
      const enemy = factory.createEnemy(0, 0, EnemyType.Swarm);
      expect(entityManager.hasComponent(enemy, SplitOnDeathComponent)).toBeFalse();
    });

    it('no Swarm enemy simultaneously holds SpawnerComponent AND SplitOnDeathComponent', () => {
      // Spawn a batch that would be representative of a swarm wave (15-20 enemies)
      const enemies: number[] = [];
      for (let i = 0; i < 20; i++) {
        enemies.push(factory.createEnemy(i * 10, 0, EnemyType.Swarm));
      }

      for (const enemy of enemies) {
        const hasSpawner = entityManager.hasComponent(enemy, SpawnerComponent);
        const hasSplit = entityManager.hasComponent(enemy, SplitOnDeathComponent);
        // The fatal combination that caused population explosion must never appear
        expect(hasSpawner && hasSplit)
          .withContext(`Entity ${enemy} should not carry both SpawnerComponent and SplitOnDeathComponent`)
          .toBeFalse();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Population-bounds invariant — repeated spawn/kill cycles must not grow
  // ---------------------------------------------------------------------------

  describe('population does not grow across spawn/pool cycles', () => {
    /** Count live enemy entities (have EnemyTypeComponent, exist in manager). */
    function liveEnemyCount(): number {
      return entityManager.getEntitiesWithComponents(EnemyTypeComponent).filter((id) => entityManager.hasEntity(id))
        .length;
    }

    it('live enemy count equals the number of spawned enemies that have not been pooled', () => {
      const batch = [
        factory.createEnemy(100, 100, EnemyType.Swarm),
        factory.createEnemy(200, 100, EnemyType.Swarm),
        factory.createEnemy(300, 100, EnemyType.Swarm),
      ];

      expect(liveEnemyCount()).toBe(3);

      // "Kill" the first two — return them to the pool (component strip happens here)
      factory.returnToPool(PoolType.ENEMY, batch[0]);
      factory.returnToPool(PoolType.ENEMY, batch[1]);

      // Only one should remain live
      expect(liveEnemyCount()).toBe(1);
    });

    it('repeated spawn-then-pool cycles keep population flat (no ghost accumulation)', () => {
      const BATCH_SIZE = 10;
      const ITERATIONS = 5;

      for (let iteration = 0; iteration < ITERATIONS; iteration++) {
        const spawned: number[] = [];

        // Spawn a fresh batch
        for (let i = 0; i < BATCH_SIZE; i++) {
          spawned.push(factory.createEnemy(i * 20, iteration * 20, EnemyType.Swarm));
        }

        // After spawning: exactly BATCH_SIZE enemies should be live
        expect(liveEnemyCount())
          .withContext(`iteration ${iteration}: expected exactly ${BATCH_SIZE} live enemies after spawn`)
          .toBe(BATCH_SIZE);

        // "Kill" all — simulate the enemy pool reclaim path
        for (const id of spawned) {
          factory.returnToPool(PoolType.ENEMY, id);
        }

        // After pooling: no enemies carry EnemyTypeComponent (they are stripped on pool return)
        expect(liveEnemyCount())
          .withContext(`iteration ${iteration}: expected 0 live enemies after pool return`)
          .toBe(0);
      }
    });

    it('after 10 kill cycles starting from 5 enemies, population is ≤ 5 (not exponential)', () => {
      const INITIAL = 5;
      // Seed pool with the initial set
      const firstBatch: number[] = [];
      for (let i = 0; i < INITIAL; i++) {
        firstBatch.push(factory.createEnemy(i * 30, 0, EnemyType.Swarm));
      }

      // Kill them to seed the pool
      for (const id of firstBatch) {
        factory.returnToPool(PoolType.ENEMY, id);
      }

      // Simulate 10 more spawn/kill cycles (equivalent to 10 death events)
      for (let cycle = 0; cycle < 10; cycle++) {
        const spawned: number[] = [];
        for (let i = 0; i < INITIAL; i++) {
          spawned.push(factory.createEnemy(i * 30, cycle * 30, EnemyType.Swarm));
        }

        // Population must not exceed the batch size (no multiplication occurred)
        expect(liveEnemyCount())
          .withContext(`cycle ${cycle}: population must not exceed ${INITIAL} (no exponential growth)`)
          .toBeLessThanOrEqual(INITIAL);

        for (const id of spawned) {
          factory.returnToPool(PoolType.ENEMY, id);
        }
      }

      // Final state: pool is loaded, no live enemies
      expect(liveEnemyCount()).toBe(0);
    });

    it('pooled enemy has SpawnerComponent and SplitOnDeathComponent stripped (no stale state bleed)', () => {
      // Manually attach the dangerous combination to simulate a hypothetical
      // regression where the code is re-enabled without the strip guard.
      // Then verify pool return clears them.
      const enemy = factory.createEnemy(0, 0, EnemyType.Swarm);

      // Simulate the re-enabled mutation (the commented-out code block)
      entityManager.addComponent(enemy, new SpawnerComponent('swarm', 5000, 0, 3));
      entityManager.addComponent(enemy, new SplitOnDeathComponent());

      expect(entityManager.hasComponent(enemy, SpawnerComponent)).toBeTrue();
      expect(entityManager.hasComponent(enemy, SplitOnDeathComponent)).toBeTrue();

      // Return to pool — removeAllComponents must strip both
      factory.returnToPool(PoolType.ENEMY, enemy);

      // After pool reclaim the entity has no components (all stripped by removeAllComponentsFromEntity)
      expect(entityManager.hasComponent(enemy, SpawnerComponent)).toBeFalse();
      expect(entityManager.hasComponent(enemy, SplitOnDeathComponent)).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-type guard — other enemy types must also never carry the pair
  // ---------------------------------------------------------------------------

  describe('other enemy types do not carry spawner+split combination', () => {
    const allTypes = [
      EnemyType.Basic,
      EnemyType.Spitter,
      EnemyType.Tank,
      EnemyType.Thug,
      EnemyType.Sniper,
      EnemyType.Disruptor,
      EnemyType.Sentinel,
    ] as const;

    for (const type of allTypes) {
      it(`${type} enemy does not have SpawnerComponent + SplitOnDeathComponent simultaneously`, () => {
        const enemy = factory.createEnemy(0, 0, type);
        const hasSpawner = entityManager.hasComponent(enemy, SpawnerComponent);
        const hasSplit = entityManager.hasComponent(enemy, SplitOnDeathComponent);
        expect(hasSpawner && hasSplit)
          .withContext(`${type}: fatal multiplier combination must not be present`)
          .toBeFalse();
      });
    }
  });
});
