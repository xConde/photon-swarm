import { TestBed } from '@angular/core/testing';
import { MinionTrackerService } from './minion-tracker.service';

describe('MinionTrackerService', () => {
  let service: MinionTrackerService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MinionTrackerService] });
    service = TestBed.inject(MinionTrackerService);
  });

  afterEach(() => {
    service.reset();
  });

  describe('recordSpawn / getAliveCount', () => {
    it('should return 0 when no minions are tracked for an owner', () => {
      expect(service.getAliveCount(1)).toBe(0);
    });

    it('should return 1 after recording a single spawn', () => {
      service.recordSpawn(1, 101);
      expect(service.getAliveCount(1)).toBe(1);
    });

    it('should count each distinct minion independently', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);
      service.recordSpawn(1, 103);
      expect(service.getAliveCount(1)).toBe(3);
    });

    it('should not mix counts between owners', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);
      service.recordSpawn(2, 201);
      expect(service.getAliveCount(1)).toBe(2);
      expect(service.getAliveCount(2)).toBe(1);
    });

    it('should treat duplicate minionId for same owner as one slot', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 101);
      expect(service.getAliveCount(1)).toBe(1);
    });
  });

  describe('cap incrementation', () => {
    it('should correctly reflect cap when spawning up to MAX_ALIVE', () => {
      const ownerId = 5;
      for (let i = 0; i < 3; i++) {
        service.recordSpawn(ownerId, 200 + i);
      }
      expect(service.getAliveCount(ownerId)).toBe(3);

      // Caller is responsible for capping; tracker just counts
      service.recordSpawn(ownerId, 203);
      expect(service.getAliveCount(ownerId)).toBe(4);
    });
  });

  describe('recordMinionDeath', () => {
    it('should decrement the alive count when a minion dies', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);
      service.recordMinionDeath(101, 1);
      expect(service.getAliveCount(1)).toBe(1);
    });

    it('should remove the map entry when the last minion dies', () => {
      service.recordSpawn(1, 101);
      service.recordMinionDeath(101, 1);
      expect(service.getAliveCount(1)).toBe(0);
    });

    it('should be a no-op when ownerId has no tracked minions', () => {
      expect(() => service.recordMinionDeath(999, 1)).not.toThrow();
      expect(service.getAliveCount(1)).toBe(0);
    });

    it('should be a no-op when minionId is unknown for that owner', () => {
      service.recordSpawn(1, 101);
      service.recordMinionDeath(999, 1); // unknown minion
      expect(service.getAliveCount(1)).toBe(1);
    });

    it('should not affect other owners when one minion dies', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(2, 201);
      service.recordMinionDeath(101, 1);
      expect(service.getAliveCount(1)).toBe(0);
      expect(service.getAliveCount(2)).toBe(1);
    });
  });

  describe('cleanupOwner', () => {
    it('should clear all slots for the specified owner', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);
      service.cleanupOwner(1);
      expect(service.getAliveCount(1)).toBe(0);
    });

    it('should not affect other owners', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(2, 201);
      service.recordSpawn(2, 202);
      service.cleanupOwner(1);
      expect(service.getAliveCount(1)).toBe(0);
      expect(service.getAliveCount(2)).toBe(2);
    });

    it('should be safe to call on an owner with no tracked minions', () => {
      expect(() => service.cleanupOwner(999)).not.toThrow();
      expect(service.getAliveCount(999)).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all owner data', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(2, 201);
      service.reset();
      expect(service.getAliveCount(1)).toBe(0);
      expect(service.getAliveCount(2)).toBe(0);
    });

    it('should be safe to call on empty tracker', () => {
      expect(() => service.reset()).not.toThrow();
    });

    it('prevents recycled summoner IDs from inheriting previous-run minion counts (T1 regression guard)', () => {
      // Run 1: ownerId=1 spawns 3 minions
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);
      service.recordSpawn(1, 103);
      expect(service.getAliveCount(1)).toBe(3);

      // Game restart — entityManager.clear() recycles IDs back to 1
      service.reset();

      // Run 2: ownerId=1 is now a completely different summoner — should start at 0
      expect(service.getAliveCount(1)).toBe(0);
    });
  });

  describe('prune (Sprint B5 — Finding 2)', () => {
    /**
     * Sweeps minion IDs whose entities no longer exist. Catches ghost IDs
     * left behind by non-death despawn paths (zone transitions, end-of-run
     * cleanup, direct pool reclaim) that bypass `recordMinionDeath`.
     */
    function makeFakeEntityManager(aliveIds: Set<number>): { hasEntity: (id: number) => boolean } {
      return { hasEntity: (id: number) => aliveIds.has(id) };
    }

    it('removes minions whose entityId is no longer in the ECS', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);
      service.recordSpawn(1, 103);

      const em = makeFakeEntityManager(new Set([101, 103])) as unknown as Parameters<typeof service.prune>[0];
      service.prune(em);

      expect(service.getAliveCount(1)).toBe(2);
    });

    it('drops the owner entry when every tracked minion is gone', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(2, 201);

      const em = makeFakeEntityManager(new Set([201])) as unknown as Parameters<typeof service.prune>[0];
      service.prune(em);

      expect(service.getAliveCount(1)).toBe(0);
      expect(service.getAliveCount(2)).toBe(1);
    });

    it('is a no-op when every tracked entity still exists', () => {
      service.recordSpawn(1, 101);
      service.recordSpawn(1, 102);

      const em = makeFakeEntityManager(new Set([101, 102])) as unknown as Parameters<typeof service.prune>[0];
      service.prune(em);

      expect(service.getAliveCount(1)).toBe(2);
    });

    it('is safe on an empty tracker', () => {
      const em = makeFakeEntityManager(new Set<number>()) as unknown as Parameters<typeof service.prune>[0];
      expect(() => service.prune(em)).not.toThrow();
    });
  });
});
