import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { GuardianSpawnerSystemService } from './guardian-spawner-system.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PlayerService } from '../../player/player.service';
import { ZoneStateService } from './zone-state.service';
import { GUARDIAN_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { HealthComponent } from '@photon/components';
import { EntityManager } from '../../ecs/ecs.model';

// ---------------------------------------------------------------------------
// Constants derived from GUARDIAN_DEFINITIONS
// ---------------------------------------------------------------------------

/** IDs of all Zone 1 guardians */
const ZONE_1_IDS = GUARDIAN_DEFINITIONS.filter((d) => d.zoneId === 1).map((d) => d.guardianId);
/** IDs of all Zone 2 guardians */
const ZONE_2_IDS = GUARDIAN_DEFINITIONS.filter((d) => d.zoneId === 2).map((d) => d.guardianId);
/** IDs of all Zone 4 guardians */
const ZONE_4_IDS = GUARDIAN_DEFINITIONS.filter((d) => d.zoneId === 4).map((d) => d.guardianId);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake EntityManager backed by a health Map so we can control
 * liveness per-entity without touching ECS internals.
 */
function buildMockEntityManager(): {
  manager: jasmine.SpyObj<EntityManager>;
  entityHealth: Map<number, number>;
  markAlive(entityId: number, health?: number): void;
  markDead(entityId: number): void;
} {
  const entityHealth = new Map<number, number>();

  const manager = jasmine.createSpyObj<EntityManager>('EntityManager', [
    'hasEntity',
    'getComponent',
    'createEntity',
    'destroyEntity',
    'addComponent',
    'removeComponent',
    'hasComponent',
    'getEntitiesWithComponents',
    'getComponents',
  ]);

  manager.hasEntity.and.callFake((id: number) => entityHealth.has(id));
  (manager.getComponent as jasmine.Spy).and.callFake((id: number, type: unknown) => {
    if (type === HealthComponent && entityHealth.has(id)) {
      const hp = entityHealth.get(id)!;
      return { health: hp, maxHealth: 1200, isDead: hp <= 0 } as HealthComponent;
    }
    return undefined;
  });

  return {
    manager,
    entityHealth,
    markAlive(entityId: number, health = 1200) {
      entityHealth.set(entityId, health);
    },
    markDead(entityId: number) {
      entityHealth.set(entityId, 0);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuardianSpawnerSystemService', () => {
  let service: GuardianSpawnerSystemService;
  let entityFactorySpy: jasmine.SpyObj<EntityFactoryECSService>;
  let playerSpy: jasmine.SpyObj<PlayerService>;
  let zoneStateSpy: jasmine.SpyObj<ZoneStateService>;

  // Mutable player position BehaviorSubjects so tests can reposition the player
  let playerX$: BehaviorSubject<number>;
  let playerY$: BehaviorSubject<number>;

  // Entity-id counter — each createGuardian call returns a unique id
  let nextEntityId: number;

  // Shared entity manager mock — rebuilt per test via beforeEach
  let mockEntityManager: ReturnType<typeof buildMockEntityManager>;

  /** Unlock only the specified zone(s). */
  function unlockZones(...zones: number[]): void {
    zoneStateSpy.isZoneUnlocked.and.callFake((id: number) => zones.includes(id));
  }

  /** Enough delta to always trigger the 2-second accumulator threshold. */
  const TICK = 2.1;

  beforeEach(() => {
    nextEntityId = 1000;

    // Player starts far from all guardian home positions
    playerX$ = new BehaviorSubject<number>(6000);
    playerY$ = new BehaviorSubject<number>(4500);

    entityFactorySpy = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', ['createGuardian']);
    entityFactorySpy.createGuardian.and.callFake(() => nextEntityId++);

    zoneStateSpy = jasmine.createSpyObj<ZoneStateService>('ZoneStateService', [
      'isZoneUnlocked',
      'getZoneState',
      'unlockZone',
    ]);

    playerSpy = jasmine.createSpyObj<PlayerService>('PlayerService', [], {
      x$: playerX$,
      y$: playerY$,
    });

    TestBed.configureTestingModule({
      providers: [
        GuardianSpawnerSystemService,
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: ZoneStateService, useValue: zoneStateSpy },
      ],
    });

    service = TestBed.inject(GuardianSpawnerSystemService);

    mockEntityManager = buildMockEntityManager();
    service.init(mockEntityManager.manager);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // spawnAllGuardians
  // ---------------------------------------------------------------------------

  describe('spawnAllGuardians', () => {
    it('only spawns guardians in unlocked zones at init', () => {
      unlockZones(1);
      service.spawnAllGuardians();

      const calledIds = entityFactorySpy.createGuardian.calls
        .all()
        .map((c) => (c.args[0] as { guardianId: number }).guardianId);

      expect(calledIds.sort((a, b) => a - b)).toEqual(ZONE_1_IDS.slice().sort((a, b) => a - b));

      // Zone 2 guardians must NOT have been spawned
      for (const id of ZONE_2_IDS) {
        expect(calledIds).not.toContain(id);
      }
    });

    it('is idempotent — calling spawnAllGuardians() twice spawns only once', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      service.spawnAllGuardians();

      expect(entityFactorySpy.createGuardian).toHaveBeenCalledTimes(ZONE_1_IDS.length);
    });

    it('spawns all guardians when all zones are unlocked at init', () => {
      unlockZones(1, 2, 3, 4);
      service.spawnAllGuardians();

      expect(entityFactorySpy.createGuardian).toHaveBeenCalledTimes(GUARDIAN_DEFINITIONS.length);
    });
  });

  // ---------------------------------------------------------------------------
  // update() — liveness and respawn
  // ---------------------------------------------------------------------------

  describe('update() - liveness and respawn', () => {
    let nowMs: number;

    beforeEach(() => {
      nowMs = 1_000_000;
      spyOn(Date, 'now').and.callFake(() => nowMs);
    });

    it('schedules a respawn timer when a guardian dies', () => {
      unlockZones(1);
      service.spawnAllGuardians();

      // Record entity ids that were spawned for zone 1
      const spawnedEntityIds: number[] = entityFactorySpy.createGuardian.calls
        .all()
        .map(() => undefined)
        .map((_, i) => 1000 + i);

      // Mark all zone 1 entities alive first, then kill guardian 1 (entity 1000)
      for (const eid of spawnedEntityIds) {
        mockEntityManager.markAlive(eid);
      }
      // Kill the first spawned guardian
      mockEntityManager.markDead(1000);

      // Tick update — liveness check fires
      service.update(TICK, mockEntityManager.manager);

      // Respawn should be queued — verify by checking that createGuardian is called
      // again after the respawn delay elapses and player is far enough away
      const countAfterFirstTick = entityFactorySpy.createGuardian.calls.count();

      // Guardian 1 has respawnDelayMs = 45000
      nowMs += 46000;

      // Reposition player far from guardian 1's home (2000, 1500)
      playerX$.next(10000);
      playerY$.next(8000);

      service.update(TICK, mockEntityManager.manager);

      // createGuardian should have been called one more time for the respawn
      expect(entityFactorySpy.createGuardian.calls.count()).toBeGreaterThan(countAfterFirstTick);
    });

    it('defers respawn when player is within 3000px of guardian home', () => {
      unlockZones(1);
      service.spawnAllGuardians();

      const spawnedEntityIds = [1000, 1001, 1002];
      for (const eid of spawnedEntityIds) {
        mockEntityManager.markAlive(eid);
      }
      // Kill guardian 1 (entity 1000, homeX=2000, homeY=1500)
      mockEntityManager.markDead(1000);

      // First tick — marks guardian dead and sets respawn timer
      service.update(TICK, mockEntityManager.manager);

      // Advance past respawn delay (45000ms) for guardian 1
      nowMs += 46000;

      // Position player CLOSE to guardian 1's home (within 3000px)
      playerX$.next(2100);
      playerY$.next(1600);

      const countBeforeProximityCheck = entityFactorySpy.createGuardian.calls.count();

      // Second tick — respawn ready but player too close
      service.update(TICK, mockEntityManager.manager);

      // Respawn must NOT have happened
      expect(entityFactorySpy.createGuardian.calls.count()).toBe(countBeforeProximityCheck);
    });

    it('respawn succeeds when player is far from guardian home', () => {
      unlockZones(1);
      service.spawnAllGuardians();

      const spawnedEntityIds = [1000, 1001, 1002];
      for (const eid of spawnedEntityIds) {
        mockEntityManager.markAlive(eid);
      }
      // Kill guardian 1 (entity 1000, homeX=2000, homeY=1500)
      mockEntityManager.markDead(1000);

      // First tick — starts respawn timer
      service.update(TICK, mockEntityManager.manager);

      // Advance past respawn delay for guardian 1 (45000ms)
      nowMs += 46000;

      // Player far from guardian 1's home
      playerX$.next(10000);
      playerY$.next(8000);

      const countBefore = entityFactorySpy.createGuardian.calls.count();

      service.update(TICK, mockEntityManager.manager);

      expect(entityFactorySpy.createGuardian.calls.count()).toBe(countBefore + 1);
    });

    it('respawned guardian is tracked under a new entity id', () => {
      unlockZones(1);
      service.spawnAllGuardians();

      const spawnedEntityIds = [1000, 1001, 1002];
      for (const eid of spawnedEntityIds) {
        mockEntityManager.markAlive(eid);
      }
      // Kill guardian 1 (entity 1000)
      mockEntityManager.markDead(1000);

      service.update(TICK, mockEntityManager.manager);

      nowMs += 46000;
      playerX$.next(10000);
      playerY$.next(8000);

      service.update(TICK, mockEntityManager.manager);

      // Mark the new entity as alive so isGuardianAlive returns true
      const newEntityId = nextEntityId - 1;
      mockEntityManager.markAlive(newEntityId);

      expect(service.isGuardianAlive(1)).toBeTrue();
      expect(service.getActiveGuardianEntityId(1)).toBe(newEntityId);
    });
  });

  // ---------------------------------------------------------------------------
  // update() — lazy spawn for unlocked zones
  // ---------------------------------------------------------------------------

  describe('update() - lazy spawn for unlocked zones', () => {
    it('lazy spawns guardians when a previously locked zone is unlocked', () => {
      // Init with only zone 1 unlocked
      unlockZones(1);
      service.spawnAllGuardians();
      expect(entityFactorySpy.createGuardian).toHaveBeenCalledTimes(ZONE_1_IDS.length);

      // Mark zone 1 entities alive so they don't trigger respawn
      for (let i = 0; i < ZONE_1_IDS.length; i++) {
        mockEntityManager.markAlive(1000 + i);
      }

      // Now unlock zone 2 as well
      unlockZones(1, 2);

      service.update(TICK, mockEntityManager.manager);

      const allCalledIds = entityFactorySpy.createGuardian.calls
        .all()
        .map((c) => (c.args[0] as { guardianId: number }).guardianId);

      // At least some zone 2 guardians should have been spawned
      const zone2SpawnedIds = allCalledIds.filter((id) => ZONE_2_IDS.includes(id));
      expect(zone2SpawnedIds.length).toBeGreaterThan(0);
    });

    it('lazy spawn respects the MAX_SPAWNS_PER_TICK budget of 2', () => {
      // All zones locked at init — no initial spawns
      unlockZones(); // lock all
      service.spawnAllGuardians();
      expect(entityFactorySpy.createGuardian).toHaveBeenCalledTimes(0);

      // Unlock ALL zones — up to 2 spawns per tick
      unlockZones(1, 2, 3, 4);

      // First update — at most 2 spawns
      service.update(TICK, mockEntityManager.manager);
      const countAfterTick1 = entityFactorySpy.createGuardian.calls.count();
      expect(countAfterTick1).toBeLessThanOrEqual(2);

      // Mark entities just spawned as alive
      for (let i = 0; i < countAfterTick1; i++) {
        mockEntityManager.markAlive(1000 + i);
      }

      // Second update — at most 2 more spawns (not exceeding tick budget)
      service.update(TICK, mockEntityManager.manager);
      const countAfterTick2 = entityFactorySpy.createGuardian.calls.count();
      expect(countAfterTick2 - countAfterTick1).toBeLessThanOrEqual(2);
    });

    describe('with controlled time', () => {
      let nowMs: number;

      beforeEach(() => {
        nowMs = 1_000_000;
        spyOn(Date, 'now').and.callFake(() => nowMs);
      });

      it('spawn budget is shared between respawn queue and lazy spawn', () => {
        // Zone 1 unlocked — spawns guardians 1, 2, 13 (entities 1000, 1001, 1002)
        unlockZones(1);
        service.spawnAllGuardians();

        // Mark zone 1 entities alive initially
        mockEntityManager.markAlive(1000);
        mockEntityManager.markAlive(1001);
        mockEntityManager.markAlive(1002);

        // Kill two zone 1 guardians so they enter the respawn queue
        mockEntityManager.markDead(1000);
        mockEntityManager.markDead(1001);

        // First tick — both dead guardians queued for respawn
        service.update(TICK, mockEntityManager.manager);

        // Advance past respawn delays (guardian 1: 45s, guardian 2: 60s)
        nowMs += 65000;

        // Player far from all guardian homes
        playerX$.next(10000);
        playerY$.next(8000);

        // Also unlock zone 2 — lazy spawn would normally add more
        unlockZones(1, 2);

        const countBefore = entityFactorySpy.createGuardian.calls.count();

        // Second tick — budget of 2 is shared between respawn + lazy spawn
        service.update(TICK, mockEntityManager.manager);

        const spawnsThisTick = entityFactorySpy.createGuardian.calls.count() - countBefore;
        expect(spawnsThisTick).toBeLessThanOrEqual(2);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // isGuardianAlive / getActiveGuardianEntityId
  // ---------------------------------------------------------------------------

  describe('isGuardianAlive / getActiveGuardianEntityId', () => {
    it('returns false for a guardian that was never spawned', () => {
      unlockZones(); // lock all — nothing spawned
      service.spawnAllGuardians();
      expect(service.isGuardianAlive(1)).toBeFalse();
    });

    it('returns true for a spawned, healthy guardian', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      mockEntityManager.markAlive(1000); // entity for guardian 1
      expect(service.isGuardianAlive(1)).toBeTrue();
    });

    it('returns false for a spawned guardian whose health is 0', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      mockEntityManager.markDead(1000); // entity for guardian 1
      expect(service.isGuardianAlive(1)).toBeFalse();
    });

    it('getActiveGuardianEntityId returns entity id for alive guardian', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      mockEntityManager.markAlive(1000);
      expect(service.getActiveGuardianEntityId(1)).toBe(1000);
    });

    it('getActiveGuardianEntityId returns undefined when guardian entity is dead', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      mockEntityManager.markDead(1000);
      expect(service.getActiveGuardianEntityId(1)).toBeUndefined();
    });

    it('getActiveGuardianEntityId returns undefined for unspawned guardian', () => {
      unlockZones(); // nothing spawned
      service.spawnAllGuardians();
      expect(service.getActiveGuardianEntityId(1)).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // destroy() / reset()
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('clears activeGuardians — isGuardianAlive returns false after destroy', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      mockEntityManager.markAlive(1000);

      expect(service.isGuardianAlive(1)).toBeTrue();

      service.destroy();

      expect(service.isGuardianAlive(1)).toBeFalse();
    });

    it('does not throw', () => {
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('reset()', () => {
    it('clears state so isGuardianAlive returns false for previously-alive guardian', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      mockEntityManager.markAlive(1000);

      expect(service.isGuardianAlive(1)).toBeTrue();

      service.reset();

      expect(service.isGuardianAlive(1)).toBeFalse();
    });

    it('resets the initialized flag so spawnAllGuardians can run again', () => {
      unlockZones(1);
      service.spawnAllGuardians();
      expect(entityFactorySpy.createGuardian).toHaveBeenCalledTimes(ZONE_1_IDS.length);

      service.reset();
      entityFactorySpy.createGuardian.calls.reset();

      // spawnAllGuardians should work a second time
      service.spawnAllGuardians();
      expect(entityFactorySpy.createGuardian).toHaveBeenCalledTimes(ZONE_1_IDS.length);
    });

    it('does not throw on an empty service', () => {
      expect(() => service.reset()).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Zone 1 guardian IDs sanity check (documents expected config values)
  // ---------------------------------------------------------------------------

  describe('GUARDIAN_DEFINITIONS contract', () => {
    it('zone 1 contains exactly guardians 1, 2, 13', () => {
      expect(ZONE_1_IDS.slice().sort((a, b) => a - b)).toEqual([1, 2, 13]);
    });

    it('zone 2 contains exactly guardians 3, 4, 5', () => {
      expect(ZONE_2_IDS.slice().sort((a, b) => a - b)).toEqual([3, 4, 5]);
    });

    it('zone 4 contains exactly guardians 9, 10, 11, 12', () => {
      expect(ZONE_4_IDS.slice().sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
    });

    it('total guardian count is 13', () => {
      expect(GUARDIAN_DEFINITIONS.length).toBe(13);
    });
  });
});
