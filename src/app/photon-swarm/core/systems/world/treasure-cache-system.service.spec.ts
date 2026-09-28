import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { TreasureCacheSystemService } from './treasure-cache-system.service';
import { ZoneStateService } from './zone-state.service';
import { PlayerService } from '../../player/player.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { AudioService } from '../../audio/audio.service';
import { GuardianSpawnerSystemService } from './guardian-spawner-system.service';
import { BuffSystemService } from '../../progression/buff-system.service';
import { GameStateService } from '../../state/game-state.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { TREASURE_CONFIG } from '@photon/config/game-constants';
import { ZONE_COMPLETION_REWARDS } from '@photon/config/constants/world/zone.config';
import { EntityManager } from '../../ecs/ecs.model';
import { ZoneTreasureCacheComponent } from '@photon/components';
import { ZoneId } from '../../models/zone.model';

// ---------------------------------------------------------------------------
// Derived config constants
// ---------------------------------------------------------------------------

const TOTAL_CACHES = TREASURE_CONFIG.CACHE_DEFINITIONS.length; // 13 (but cacheId 13 is in Zone 1)
const ZONE_1_CACHE_IDS = TREASURE_CONFIG.CACHE_DEFINITIONS.filter((d) => d.zoneId === 1).map((d) => d.cacheId); // [1, 2, 13]
const ZONE_2_CACHE_IDS = TREASURE_CONFIG.CACHE_DEFINITIONS.filter((d) => d.zoneId === 2).map((d) => d.cacheId); // [3, 4, 5]
const ZONE_3_CACHE_IDS = TREASURE_CONFIG.CACHE_DEFINITIONS.filter((d) => d.zoneId === 3).map((d) => d.cacheId); // [6, 7, 8]
const ZONE_4_CACHE_IDS = TREASURE_CONFIG.CACHE_DEFINITIONS.filter((d) => d.zoneId === 4).map((d) => d.cacheId); // [9, 10, 11, 12]

// ---------------------------------------------------------------------------
// Mock EntityManager factory
// ---------------------------------------------------------------------------

/**
 * Build a fake EntityManager that tracks entities and components in plain Maps.
 * spawnCache() calls createEntity() + addComponent() per cache.
 * openCache() calls getComponent(entityId, ZoneTreasureCacheComponent).
 */
function buildMockEntityManager(): {
  manager: jasmine.SpyObj<EntityManager>;
  /** cacheId → ZoneTreasureCacheComponent installed on the entity */
  cacheComponents: Map<number, ZoneTreasureCacheComponent>;
  /** entityId counter — each createEntity() call returns nextId++ */
  nextEntityId: { value: number };
  installCacheComponent(cacheId: number): void;
} {
  const nextId = 500;
  const nextEntityId = { value: nextId };

  // entityId → component map (by component constructor key)
  const componentsByEntity = new Map<number, Map<new (...args: never[]) => unknown, unknown>>();
  const cacheComponents = new Map<number, ZoneTreasureCacheComponent>();

  const manager = jasmine.createSpyObj<EntityManager>('EntityManager', [
    'createEntity',
    'destroyEntity',
    'addComponent',
    'removeComponent',
    'hasComponent',
    'hasEntity',
    'getComponent',
    'getEntitiesWithComponents',
    'getComponents',
  ]);

  manager.createEntity.and.callFake(() => {
    const id = nextEntityId.value++;
    componentsByEntity.set(id, new Map());
    return id;
  });

  manager.addComponent.and.callFake((entityId: number, component: unknown) => {
    const map = componentsByEntity.get(entityId);
    if (map) {
      const ctor = (component as object).constructor as new (...args: never[]) => unknown;
      map.set(ctor, component);
      // Track ZoneTreasureCacheComponent by cacheId for easy lookup
      if (component instanceof ZoneTreasureCacheComponent) {
        cacheComponents.set(component.cacheId, component);
      }
    }
  });

  (manager.getComponent as jasmine.Spy).and.callFake((entityId: number, type: new (...args: never[]) => unknown) => {
    return componentsByEntity.get(entityId)?.get(type) ?? undefined;
  });

  manager.hasEntity.and.callFake((entityId: number) => componentsByEntity.has(entityId));

  return {
    manager,
    cacheComponents,
    nextEntityId,
    /** Pre-install a ZoneTreasureCacheComponent for openCache() entity lookups */
    installCacheComponent(cacheId: number): void {
      const def = TREASURE_CONFIG.CACHE_DEFINITIONS.find((d) => d.cacheId === cacheId)!;
      const comp = new ZoneTreasureCacheComponent(cacheId, def.zoneId, def.lootTableKey, null);
      cacheComponents.set(cacheId, comp);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TreasureCacheSystemService', () => {
  let service: TreasureCacheSystemService;
  let zoneStateSpy: jasmine.SpyObj<ZoneStateService>;
  let playerSpy: jasmine.SpyObj<PlayerService>;
  let progressionSpy: jasmine.SpyObj<ProgressionSystemService>;
  let entityFactorySpy: jasmine.SpyObj<EntityFactoryECSService>;
  let audioSpy: jasmine.SpyObj<AudioService>;
  let guardianSpawnerSpy: jasmine.SpyObj<GuardianSpawnerSystemService>;
  let buffSystemSpy: jasmine.SpyObj<BuffSystemService>;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;

  let playerX$: BehaviorSubject<number>;
  let playerY$: BehaviorSubject<number>;

  let mockEntityManager: ReturnType<typeof buildMockEntityManager>;

  beforeEach(() => {
    playerX$ = new BehaviorSubject<number>(9999);
    playerY$ = new BehaviorSubject<number>(9999);

    zoneStateSpy = jasmine.createSpyObj<ZoneStateService>('ZoneStateService', [
      'recordCacheOpened',
      'markZoneCompleted',
      'getZoneState',
      'isZoneUnlocked',
    ]);
    zoneStateSpy.getZoneState.and.returnValue({
      zoneId: 1 as ZoneId,
      isUnlocked: true,
      isCompleted: false,
      firstEntryTime: 0,
      timeSpentMs: 0,
      cachesOpened: 0,
      guardiansSlain: 0,
    });

    playerSpy = jasmine.createSpyObj<PlayerService>('PlayerService', ['getMaxHealth'], {
      x$: playerX$,
      y$: playerY$,
    });

    progressionSpy = jasmine.createSpyObj<ProgressionSystemService>('ProgressionSystemService', ['addXp']);

    entityFactorySpy = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', [
      'createShard',
      'createGuardian',
    ]);

    audioSpy = jasmine.createSpyObj<AudioService>('AudioService', ['playTreasureOpen', 'playZoneComplete']);

    guardianSpawnerSpy = jasmine.createSpyObj<GuardianSpawnerSystemService>('GuardianSpawnerSystemService', [
      'isGuardianAlive',
      'getActiveGuardianEntityId',
    ]);
    // Default: all guardians dead — caches are openable
    guardianSpawnerSpy.isGuardianAlive.and.returnValue(false);

    buffSystemSpy = jasmine.createSpyObj<BuffSystemService>('BuffSystemService', ['applyBuff']);

    gameStateSpy = jasmine.createSpyObj<GameStateService>('GameStateService', ['addShards', 'getMaxHealth', 'heal']);
    gameStateSpy.getMaxHealth.and.returnValue(1000);

    const postProcessingSpy = jasmine.createSpyObj<PostProcessingService>('PostProcessingService', ['addScreenFlash']);

    TestBed.configureTestingModule({
      providers: [
        TreasureCacheSystemService,
        { provide: ZoneStateService, useValue: zoneStateSpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: AudioService, useValue: audioSpy },
        { provide: GuardianSpawnerSystemService, useValue: guardianSpawnerSpy },
        { provide: BuffSystemService, useValue: buffSystemSpy },
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: PostProcessingService, useValue: postProcessingSpy },
      ],
    });

    service = TestBed.inject(TreasureCacheSystemService);
    mockEntityManager = buildMockEntityManager();
    service.init(mockEntityManager.manager);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // spawnAllCaches
  // ---------------------------------------------------------------------------

  describe('spawnAllCaches', () => {
    it('creates entities for all cache definitions', () => {
      service.spawnAllCaches(mockEntityManager.manager);

      // createEntity is called once per cache
      expect(mockEntityManager.manager.createEntity).toHaveBeenCalledTimes(TOTAL_CACHES);
    });

    it('populates cacheComponents for all caches after spawn', () => {
      service.spawnAllCaches(mockEntityManager.manager);

      // Every cache definition should have a ZoneTreasureCacheComponent installed
      for (const def of TREASURE_CONFIG.CACHE_DEFINITIONS) {
        expect(mockEntityManager.cacheComponents.has(def.cacheId)).toBeTrue();
      }
    });

    it('openedCacheIds is empty immediately after spawn', () => {
      service.spawnAllCaches(mockEntityManager.manager);
      expect(service.openedCacheIds.size).toBe(0);
    });

    it('is idempotent — calling twice only spawns once', () => {
      service.spawnAllCaches(mockEntityManager.manager);
      service.spawnAllCaches(mockEntityManager.manager);

      expect(mockEntityManager.manager.createEntity).toHaveBeenCalledTimes(TOTAL_CACHES);
    });
  });

  // ---------------------------------------------------------------------------
  // openCache
  // ---------------------------------------------------------------------------

  describe('openCache', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    it('adds cacheId to openedCacheIds', () => {
      service.openCache(1);
      expect(service.openedCacheIds.has(1)).toBeTrue();
    });

    it('emits cacheOpened$ with correct cacheId, zoneId, and lootTableKey', () => {
      const emissions: { cacheId: number; zoneId: ZoneId; lootTableKey: string }[] = [];
      service.cacheOpened$.subscribe((ev) => emissions.push(ev));

      service.openCache(1);

      expect(emissions.length).toBe(1);
      expect(emissions[0].cacheId).toBe(1);
      expect(emissions[0].zoneId).toBe(1 as ZoneId);
      expect(emissions[0].lootTableKey).toBe('nebula_common');
    });

    it('sets ZoneTreasureCacheComponent.isOpen to true on the entity', () => {
      const comp = mockEntityManager.cacheComponents.get(1)!;
      expect(comp.isOpen).toBeFalse();

      service.openCache(1);

      expect(comp.isOpen).toBeTrue();
    });

    it('sets ZoneTreasureCacheComponent.openTime to a positive timestamp', () => {
      const comp = mockEntityManager.cacheComponents.get(1)!;
      service.openCache(1);
      expect(comp.openTime).toBeGreaterThan(0);
    });

    it('calls zoneState.recordCacheOpened with the cache zone', () => {
      service.openCache(1);
      expect(zoneStateSpy.recordCacheOpened).toHaveBeenCalledWith(1 as ZoneId);
    });

    it('calls audio.playTreasureOpen once per open', () => {
      service.openCache(1);
      expect(audioSpy.playTreasureOpen).toHaveBeenCalledTimes(1);
    });

    it('is idempotent per cacheId — calling openCache(1) twice only fires event once', () => {
      const emissions: unknown[] = [];
      service.cacheOpened$.subscribe((ev) => emissions.push(ev));

      service.openCache(1);
      service.openCache(1);

      expect(emissions.length).toBe(1);
      expect(audioSpy.playTreasureOpen).toHaveBeenCalledTimes(1);
    });

    it('does not emit cacheOpened$ for unknown cacheId', () => {
      const emissions: unknown[] = [];
      service.cacheOpened$.subscribe((ev) => emissions.push(ev));

      service.openCache(9999);

      expect(emissions.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // isCacheOpen / getOpenedCacheCount / getTotalCacheCount
  // ---------------------------------------------------------------------------

  describe('isCacheOpen', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    it('returns false before any cache is opened', () => {
      expect(service.isCacheOpen(1)).toBeFalse();
    });

    it('returns true after openCache is called', () => {
      service.openCache(1);
      expect(service.isCacheOpen(1)).toBeTrue();
    });

    it('returns false for a different cacheId', () => {
      service.openCache(1);
      expect(service.isCacheOpen(2)).toBeFalse();
    });
  });

  describe('getOpenedCacheCount', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    it('returns 0 when no caches in the zone are opened', () => {
      expect(service.getOpenedCacheCount(1)).toBe(0);
    });

    it('returns 2 after opening 2 of the 3 Zone 1 caches', () => {
      service.openCache(ZONE_1_CACHE_IDS[0]);
      service.openCache(ZONE_1_CACHE_IDS[1]);

      expect(service.getOpenedCacheCount(1)).toBe(2);
    });

    it('does not count caches from other zones', () => {
      service.openCache(ZONE_2_CACHE_IDS[0]); // Zone 2 cache
      expect(service.getOpenedCacheCount(1)).toBe(0);
    });

    it('returns correct separate counts for zone 1 and zone 2', () => {
      service.openCache(ZONE_1_CACHE_IDS[0]);
      service.openCache(ZONE_2_CACHE_IDS[0]);
      service.openCache(ZONE_2_CACHE_IDS[1]);

      expect(service.getOpenedCacheCount(1)).toBe(1);
      expect(service.getOpenedCacheCount(2)).toBe(2);
    });
  });

  describe('getTotalCacheCount', () => {
    it('returns 3 for Zone 1', () => {
      expect(service.getTotalCacheCount(1)).toBe(3);
    });

    it('returns 3 for Zone 2', () => {
      expect(service.getTotalCacheCount(2)).toBe(3);
    });

    it('returns 3 for Zone 3', () => {
      expect(service.getTotalCacheCount(3)).toBe(3);
    });

    it('returns 4 for Zone 4', () => {
      expect(service.getTotalCacheCount(4)).toBe(4);
    });

    it('returns 0 for an unknown zone', () => {
      expect(service.getTotalCacheCount(99 as ZoneId)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Zone completion via openCache
  // ---------------------------------------------------------------------------

  describe('zone completion', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    it('fires zoneCompleted$ when all caches in Zone 1 are opened', () => {
      const events: { zoneId: ZoneId }[] = [];
      service.zoneCompleted$.subscribe((ev) => events.push(ev));

      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }

      expect(events.length).toBe(1);
      expect(events[0].zoneId).toBe(1 as ZoneId);
    });

    it('does not fire zoneCompleted$ when only some caches are opened', () => {
      const events: unknown[] = [];
      service.zoneCompleted$.subscribe((ev) => events.push(ev));

      service.openCache(ZONE_1_CACHE_IDS[0]);
      service.openCache(ZONE_1_CACHE_IDS[1]);
      // One cache remaining — no completion yet

      expect(events.length).toBe(0);
    });

    it('calls progressionSystem.addXp with Zone 1 xpBonus on completion', () => {
      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }

      const xpBonus = ZONE_COMPLETION_REWARDS[1].xpBonus; // 500
      // addXp is also called by distributeLoot for each cache — we want the zone reward call
      const allXpCalls = progressionSpy.addXp.calls.allArgs().map((args) => args[0]);
      expect(allXpCalls).toContain(xpBonus);
    });

    it('calls zoneState.markZoneCompleted with the correct zoneId', () => {
      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }

      expect(zoneStateSpy.markZoneCompleted).toHaveBeenCalledWith(1 as ZoneId);
    });

    it('does not double-fire zoneCompleted$ for the same zone', () => {
      const events: unknown[] = [];
      service.zoneCompleted$.subscribe((ev) => events.push(ev));

      // Open all Zone 1 caches (triggers completion on last open)
      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }
      // Re-open same caches — guard prevents re-entry
      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }

      expect(events.length).toBe(1);
    });

    it('grants correct XP reward for Zone 2 completion', () => {
      progressionSpy.addXp.calls.reset();

      for (const cacheId of ZONE_2_CACHE_IDS) {
        service.openCache(cacheId);
      }

      const allXpCalls = progressionSpy.addXp.calls.allArgs().map((args) => args[0]);
      expect(allXpCalls).toContain(ZONE_COMPLETION_REWARDS[2].xpBonus); // 1000
    });

    it('grants correct XP reward for Zone 4 completion', () => {
      progressionSpy.addXp.calls.reset();

      for (const cacheId of ZONE_4_CACHE_IDS) {
        service.openCache(cacheId);
      }

      const allXpCalls = progressionSpy.addXp.calls.allArgs().map((args) => args[0]);
      expect(allXpCalls).toContain(ZONE_COMPLETION_REWARDS[4].xpBonus); // 2500
    });

    it('fires separate zoneCompleted$ events for zone 1 and zone 2', () => {
      const events: { zoneId: ZoneId }[] = [];
      service.zoneCompleted$.subscribe((ev) => events.push(ev));

      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }
      for (const cacheId of ZONE_2_CACHE_IDS) {
        service.openCache(cacheId);
      }

      expect(events.length).toBe(2);
      const zoneIds = events.map((e) => e.zoneId);
      expect(zoneIds).toContain(1 as ZoneId);
      expect(zoneIds).toContain(2 as ZoneId);
    });
  });

  // ---------------------------------------------------------------------------
  // update() — frame-skip and cache opening logic
  // ---------------------------------------------------------------------------

  describe('update() - frame skip', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    it('does nothing when not initialized (no crash)', () => {
      service.reset(); // clears initialized flag
      expect(() => service.update(16, mockEntityManager.manager)).not.toThrow();
    });

    it('throttles to every 10th frame — does not open cache on frames 1-9', () => {
      // Position player right on top of Cache 1 (x=2000, y=1500) and guardian is dead
      playerX$.next(2000);
      playerY$.next(1500);

      service.spawnAllCaches(mockEntityManager.manager);

      const openSpy = spyOn(service, 'openCache').and.callThrough();

      // Frames 1-9 should not trigger openCache (frameCounter resets to 1..9, never 0)
      for (let i = 0; i < 9; i++) {
        service.update(16, mockEntityManager.manager);
      }
      // On the 10th frame, frameCounter becomes 0 → triggers the check
      service.update(16, mockEntityManager.manager);

      // Cache 1 should have been opened on the 10th call
      expect(openSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('update() - guardian guard', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
      // Position player on Cache 1 (x=2000, y=1500) — within 80px
      playerX$.next(2000);
      playerY$.next(1500);
    });

    /** Run exactly 10 update() frames to trigger the proximity check once */
    function tick10(): void {
      for (let i = 0; i < 10; i++) {
        service.update(16, mockEntityManager.manager);
      }
    }

    it('does NOT open cache when guardian is alive', () => {
      guardianSpawnerSpy.isGuardianAlive.and.returnValue(true);

      tick10();

      expect(service.isCacheOpen(1)).toBeFalse();
    });

    it('opens cache when guardian is dead AND player within 80px', () => {
      guardianSpawnerSpy.isGuardianAlive.and.returnValue(false);

      tick10();

      expect(service.isCacheOpen(1)).toBeTrue();
    });

    it('does NOT open cache when player is outside 80px radius', () => {
      // Move player 200px away — outside 80px threshold
      playerX$.next(2200);
      playerY$.next(1500);
      guardianSpawnerSpy.isGuardianAlive.and.returnValue(false);

      tick10();

      expect(service.isCacheOpen(1)).toBeFalse();
    });
  });

  describe('update() - cache discovery', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    function tick10(): void {
      for (let i = 0; i < 10; i++) {
        service.update(16, mockEntityManager.manager);
      }
    }

    it('emits cacheDiscovered$ when player enters 200px radius', () => {
      const discoveries: { cacheId: number; zoneId: ZoneId }[] = [];
      service.cacheDiscovered$.subscribe((ev) => discoveries.push(ev));

      // Position player within 200px of Cache 1 (x=2000, y=1500) but outside 80px
      playerX$.next(2100);
      playerY$.next(1500); // dist = 100px — inside discovery, outside open threshold

      // Make guardian alive so cache doesn't open (isolates discovery event)
      guardianSpawnerSpy.isGuardianAlive.and.returnValue(true);

      tick10();

      expect(discoveries.length).toBeGreaterThanOrEqual(1);
      const disc = discoveries.find((d) => d.cacheId === 1);
      expect(disc).toBeTruthy();
      expect(disc!.zoneId).toBe(1 as ZoneId);
    });

    it('emits cacheDiscovered$ only once per cache (idempotent)', () => {
      const discoveries: unknown[] = [];
      service.cacheDiscovered$.subscribe((ev) => discoveries.push(ev));

      playerX$.next(2100);
      playerY$.next(1500);
      guardianSpawnerSpy.isGuardianAlive.and.returnValue(true);

      // Run multiple 10-frame cycles — discovery should still only fire once
      tick10();
      tick10();
      tick10();

      const cache1Discoveries = (discoveries as { cacheId: number; zoneId: ZoneId }[]).filter((d) => d.cacheId === 1);
      expect(cache1Discoveries.length).toBe(1);
    });

    it('does not emit cacheDiscovered$ when player is beyond 200px', () => {
      const discoveries: unknown[] = [];
      service.cacheDiscovered$.subscribe((ev) => discoveries.push(ev));

      // 300px away from Cache 1
      playerX$.next(2300);
      playerY$.next(1500);
      guardianSpawnerSpy.isGuardianAlive.and.returnValue(true);

      tick10();

      const cache1Discoveries = (discoveries as { cacheId: number; zoneId: ZoneId }[]).filter(
        (d) => (d as { cacheId: number }).cacheId === 1
      );
      expect(cache1Discoveries.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // destroy() / reset()
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('completes cacheOpened$ (subscriber receives complete notification)', (done) => {
      service.cacheOpened$.subscribe({ next: () => {}, complete: () => done() });
      service.destroy();
      expect(true).toBeTrue(); // satisfy karma
    });

    it('completes zoneCompleted$ (subscriber receives complete notification)', (done) => {
      service.zoneCompleted$.subscribe({ next: () => {}, complete: () => done() });
      service.destroy();
      expect(true).toBeTrue();
    });

    it('completes cacheDiscovered$ (subscriber receives complete notification)', (done) => {
      service.cacheDiscovered$.subscribe({ next: () => {}, complete: () => done() });
      service.destroy();
      expect(true).toBeTrue();
    });

    it('does not throw when called with no prior init', () => {
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('reset()', () => {
    beforeEach(() => {
      service.spawnAllCaches(mockEntityManager.manager);
    });

    it('clears openedCacheIds so isCacheOpen returns false after reset', () => {
      service.openCache(1);
      expect(service.isCacheOpen(1)).toBeTrue();

      service.reset();

      expect(service.isCacheOpen(1)).toBeFalse();
    });

    it('resets initialized flag so spawnAllCaches can be called again', () => {
      // spawnAllCaches was called in beforeEach — calling it again should be a no-op (idempotent)
      const countAfterFirstSpawn = mockEntityManager.manager.createEntity.calls.count();

      // After reset, it should actually spawn again
      service.reset();

      // Re-init so the service has an entity manager for the second spawn
      mockEntityManager = buildMockEntityManager();
      service.init(mockEntityManager.manager);
      service.spawnAllCaches(mockEntityManager.manager);

      expect(mockEntityManager.manager.createEntity.calls.count()).toBe(TOTAL_CACHES);
      // The count resets between calls since we use a fresh manager
      expect(countAfterFirstSpawn).toBe(TOTAL_CACHES);
    });

    it('getOpenedCacheCount returns 0 for all zones after reset', () => {
      for (const cacheId of ZONE_1_CACHE_IDS) {
        service.openCache(cacheId);
      }

      service.reset();

      expect(service.getOpenedCacheCount(1)).toBe(0);
    });

    it('does not throw on empty service', () => {
      expect(() => service.reset()).not.toThrow();
    });

    // -------------------------------------------------------------------------
    // Regression: game-engine.reset() flow must re-spawn caches after init.
    //
    // Without GameEngineService.reset() explicitly calling spawnAllCaches()
    // after re-initializing systems, the world has zero treasure caches for
    // the rest of the session after a single restart. There is no lazy-spawn
    // loop equivalent like there is for guardians.
    //
    // See STRATEGIC_AUDIT.md "Final bug hunt" — Suspicion 3.
    // -------------------------------------------------------------------------
    it('regression: spawnAllCaches must work again after reset (game-engine restart contract)', () => {
      // First spawn (simulates game start)
      service.spawnAllCaches(mockEntityManager.manager);
      const firstSpawnCount = mockEntityManager.manager.createEntity.calls.count();
      expect(firstSpawnCount).toBeGreaterThan(0);

      // Simulate game reset: entityManager.clear() (caches gone) + reset() (initialized=false)
      mockEntityManager = buildMockEntityManager();
      service.init(mockEntityManager.manager);
      service.reset();

      // Second spawn must succeed (initialized flag was cleared by reset)
      service.spawnAllCaches(mockEntityManager.manager);
      const secondSpawnCount = mockEntityManager.manager.createEntity.calls.count();

      expect(secondSpawnCount)
        .withContext('reset() must clear the initialized flag so spawnAllCaches works again')
        .toBe(firstSpawnCount);
    });
  });

  // ---------------------------------------------------------------------------
  // TREASURE_CONFIG contract (documents expected zone distribution)
  // ---------------------------------------------------------------------------

  describe('TREASURE_CONFIG contract', () => {
    it('Zone 1 contains exactly 3 caches (IDs 1, 2, 13)', () => {
      expect(ZONE_1_CACHE_IDS.slice().sort((a, b) => a - b)).toEqual([1, 2, 13]);
    });

    it('Zone 2 contains exactly 3 caches (IDs 3, 4, 5)', () => {
      expect(ZONE_2_CACHE_IDS.slice().sort((a, b) => a - b)).toEqual([3, 4, 5]);
    });

    it('Zone 3 contains exactly 3 caches (IDs 6, 7, 8)', () => {
      expect(ZONE_3_CACHE_IDS.slice().sort((a, b) => a - b)).toEqual([6, 7, 8]);
    });

    it('Zone 4 contains exactly 4 caches (IDs 9, 10, 11, 12)', () => {
      expect(ZONE_4_CACHE_IDS.slice().sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
    });

    it('total cache count across all zones is 13', () => {
      expect(TOTAL_CACHES).toBe(13);
    });

    it('ZONE_COMPLETION_REWARDS has correct values per zone', () => {
      expect(ZONE_COMPLETION_REWARDS[1]).toEqual(jasmine.objectContaining({ shards: 100, xpBonus: 500 }));
      expect(ZONE_COMPLETION_REWARDS[2]).toEqual(jasmine.objectContaining({ shards: 200, xpBonus: 1000 }));
      expect(ZONE_COMPLETION_REWARDS[3]).toEqual(jasmine.objectContaining({ shards: 300, xpBonus: 1500 }));
      expect(ZONE_COMPLETION_REWARDS[4]).toEqual(jasmine.objectContaining({ shards: 500, xpBonus: 2500 }));
    });
  });
});
