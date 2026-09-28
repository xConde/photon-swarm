import { TestBed } from '@angular/core/testing';
import { AimingSystemService } from './aiming-system.service';
import { PlayerService } from '../../player/player.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EnemyTypeComponent, HealthComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';

describe('AimingSystemService — Focus Fire cache', () => {
  let service: AimingSystemService;
  let entityManager: EntityManagerService;
  let isFocusFiring: boolean;
  let isShiftFiring: boolean;

  const mockPlayerService = {
    getIsFocusFiring: () => isFocusFiring,
    getIsShiftFiring: () => isShiftFiring,
  };

  const mockErrorHandler = {
    handleECSError: jasmine.createSpy('handleECSError'),
  };

  const mockDebugLog = {
    log: jasmine.createSpy('log'),
  };

  /** Build a player entity with position at (0,0). */
  function createPlayer(): number {
    const id = entityManager.createEntity();
    entityManager.addComponent(id, new PlayerControlledComponent());
    entityManager.addComponent(id, new PositionComponent(0, 0));
    return id;
  }

  /** Build an enemy entity with given position and health. */
  function createEnemy(x: number, y: number, health = 100): number {
    const id = entityManager.createEntity();
    entityManager.addComponent(id, new PositionComponent(x, y));
    entityManager.addComponent(id, new EnemyTypeComponent());
    entityManager.addComponent(id, new HealthComponent(health, 100));
    return id;
  }

  beforeEach(() => {
    isFocusFiring = false;
    isShiftFiring = true;

    TestBed.configureTestingModule({
      providers: [
        AimingSystemService,
        EntityManagerService,
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: ErrorHandlerService, useValue: mockErrorHandler },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    service = TestBed.inject(AimingSystemService);
    entityManager = TestBed.inject(EntityManagerService);

    // Reset the entity manager state for each test
    entityManager.clear();

    service.init(entityManager);
  });

  afterEach(() => {
    service.destroy();
  });

  // ─── Test 1: Dead target invalidation ────────────────────────────────────────

  describe('dead target invalidation', () => {
    it('clears cache and retargets a live enemy when cached target health drops to 0', () => {
      isFocusFiring = true;

      createPlayer();
      const deadEnemy = createEnemy(50, 0);
      const liveEnemy = createEnemy(200, 0);

      // Frame 1: cache gets populated with the nearest enemy (deadEnemy at x=50)
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(deadEnemy);

      // Kill the cached enemy
      const health = entityManager.getComponent(deadEnemy, HealthComponent);
      if (health) {
        health.health = 0;
      }

      // Frame 2: liveness validation should invalidate cache and re-query
      service.update(16, entityManager);

      const target = service.getCachedFocusTarget();
      expect(target).not.toBeNull();
      expect(target?.entityId).toBe(liveEnemy);
    });

    it('returns null when all enemies are dead after cache invalidation', () => {
      isFocusFiring = true;

      createPlayer();
      const enemy = createEnemy(50, 0);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Kill only enemy
      const health = entityManager.getComponent(enemy, HealthComponent);
      if (health) {
        health.health = 0;
      }

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()).toBeNull();
    });
  });

  // ─── Test 2: Re-activation cache invalidation ─────────────────────────────

  describe('re-activation cache invalidation', () => {
    it('does not reuse old cached target after Focus Fire toggles off then back on', () => {
      isFocusFiring = true;

      createPlayer();
      const firstEnemy = createEnemy(50, 0);
      createEnemy(200, 0);

      // Frame 1: cache locks onto firstEnemy
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(firstEnemy);

      // Remove the first enemy from the world so re-query would find secondEnemy instead
      entityManager.destroyEntity(firstEnemy);

      // Toggle Focus Fire off for one frame — wasFocusFiring becomes false
      isFocusFiring = false;
      service.update(16, entityManager);

      // Toggle back on — re-activation should clear the stale cache
      isFocusFiring = true;
      service.update(16, entityManager);

      const target = service.getCachedFocusTarget();
      expect(target).not.toBeNull();
      // firstEnemy is gone; the fresh recompute must NOT reference the stale entityId
      expect(target?.entityId).not.toBe(firstEnemy);
    });

    it('immediately populates cache with live enemy on first frame after re-activation', () => {
      isFocusFiring = true;

      createPlayer();
      // Start with one enemy; destroy it while off, add a different one
      const firstEnemy = createEnemy(50, 0);

      // Warm up cache
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(firstEnemy);

      // Toggle off — cache should have no effect on inactive frames
      isFocusFiring = false;
      service.update(16, entityManager);

      // Replace the enemy world so re-query has a different result
      entityManager.destroyEntity(firstEnemy);
      const secondEnemy = createEnemy(300, 0);

      // Toggle back on — fresh recompute must find secondEnemy on this very frame
      isFocusFiring = true;
      service.update(16, entityManager);

      expect(service.getCachedFocusTarget()?.entityId).toBe(secondEnemy);
    });
  });

  // ─── Test 3: Cache persists for 3 frames ─────────────────────────────────

  describe('cache interval', () => {
    it('retains the same target entityId across 3 consecutive focus-fire frames', () => {
      isFocusFiring = true;

      createPlayer();
      const enemy = createEnemy(50, 0);

      // Frame 1: recompute, cache locked
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Frame 2
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Frame 3
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);
    });

    it('recomputes on the 4th frame and picks up a closer enemy added after frame 1', () => {
      isFocusFiring = true;

      createPlayer();
      const farEnemy = createEnemy(500, 0); // starts as nearest (only enemy)

      // Frame 1: cache = farEnemy
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(farEnemy);

      // Add a closer enemy between frames 1 and 4 — cache prevents early pick-up
      const nearEnemy = createEnemy(10, 0);

      // Frames 2 & 3: still serving cache — NOT nearEnemy yet
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(farEnemy);
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(farEnemy);

      // Frame 4: recompute fires, nearEnemy is now closest
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(nearEnemy);
    });

    it('cache remains null across multiple frames when no enemies exist', () => {
      isFocusFiring = true;

      createPlayer();
      // No enemies created

      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);

      expect(service.getCachedFocusTarget()).toBeNull();
    });

    it('leaves getCachedFocusTarget null when Focus Fire is inactive', () => {
      isFocusFiring = false;

      createPlayer();
      createEnemy(50, 0);

      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);

      expect(service.getCachedFocusTarget()).toBeNull();
    });
  });

  // ─── Test 4: getCachedFocusTarget returns correct value ──────────────────

  describe('getCachedFocusTarget', () => {
    it('returns the same entity the update loop locked onto', () => {
      isFocusFiring = true;

      createPlayer();
      const enemy = createEnemy(100, 50);

      service.update(16, entityManager);

      const cached = service.getCachedFocusTarget();
      expect(cached).not.toBeNull();
      expect(cached?.entityId).toBe(enemy);
      expect(cached?.x).toBe(100);
      expect(cached?.y).toBe(50);
    });

    it('returns null before Focus Fire has ever been activated', () => {
      isFocusFiring = false;

      createPlayer();
      createEnemy(100, 50);

      service.update(16, entityManager);

      expect(service.getCachedFocusTarget()).toBeNull();
    });
  });

  // ─── Test 5: invalidateFocusTarget clears cache ──────────────────────────

  describe('invalidateFocusTarget', () => {
    it('sets getCachedFocusTarget to null immediately', () => {
      isFocusFiring = true;

      createPlayer();
      createEnemy(50, 0);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()).not.toBeNull();

      service.invalidateFocusTarget();
      expect(service.getCachedFocusTarget()).toBeNull();
    });

    it('forces a recompute on the very next update, picking up a new closer enemy', () => {
      isFocusFiring = true;

      createPlayer();
      const farEnemy = createEnemy(500, 0);

      // Frame 1: cache = farEnemy
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(farEnemy);

      // Add a closer enemy — without invalidation this would not be seen until frame 4
      const nearEnemy = createEnemy(10, 0);

      // Frame 2: normally cached, nearEnemy would be invisible
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(farEnemy);

      // Explicitly invalidate — next update MUST recompute
      service.invalidateFocusTarget();

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(nearEnemy);
    });
  });

  // ─── Test 6: destroy resets all state ───────────────────────────────────

  describe('destroy', () => {
    it('getCachedFocusTarget returns null after destroy', () => {
      isFocusFiring = true;

      createPlayer();
      createEnemy(50, 0);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()).not.toBeNull();

      service.destroy();
      expect(service.getCachedFocusTarget()).toBeNull();
    });

    it('does not carry stale cache into a fresh init/update cycle after destroy', () => {
      isFocusFiring = true;

      createPlayer();
      const firstEnemy = createEnemy(50, 0);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(firstEnemy);

      // Simulate game restart: destroy, clear world, re-init
      service.destroy();
      entityManager.clear();

      createPlayer();
      const newEnemy = createEnemy(300, 0);

      service.init(entityManager);
      service.update(16, entityManager);

      // wasFocusFiring was reset by destroy(), so re-activation path runs and
      // the fresh recompute must land on newEnemy (not the stale firstEnemy id)
      const target = service.getCachedFocusTarget();
      expect(target).not.toBeNull();
      expect(target?.entityId).toBe(newEnemy);
      expect(target?.entityId).not.toBe(firstEnemy);
    });
  });
});
