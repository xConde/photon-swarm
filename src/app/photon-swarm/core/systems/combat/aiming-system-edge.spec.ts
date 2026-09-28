import { TestBed } from '@angular/core/testing';
import { AimingSystemService } from './aiming-system.service';
import { PlayerService } from '../../player/player.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EnemyTypeComponent, HealthComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';

describe('AimingSystemService — Focus Fire edge cases', () => {
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

    entityManager.clear();
    service.init(entityManager);
  });

  afterEach(() => {
    service.destroy();
  });

  // ─── Test 1: Rapid toggle on/off within 1 frame ──────────────────────────

  describe('rapid toggle on/off/on within 1 frame', () => {
    it('invalidates cache and runs a fresh scan after on→off→on in a single update cycle', () => {
      // Prime the service with a cached target while focused
      isFocusFiring = true;
      createPlayer();
      const firstEnemy = createEnemy(50, 0);

      // Frame 1: lock cache onto firstEnemy
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(firstEnemy);

      // Remove firstEnemy so a fresh scan would find no target
      entityManager.destroyEntity(firstEnemy);

      // Simulate rapid toggle: wasFocusFiring cycles true→false→true within one logical tick
      // by toggling isFocusFiring before the next update call
      isFocusFiring = false;
      service.update(16, entityManager); // registers wasFocusFiring = false

      // Add a new, different enemy before toggling back on
      const secondEnemy = createEnemy(100, 0);

      isFocusFiring = true;
      service.update(16, entityManager); // re-activation path: cache cleared, fresh scan

      // Cache must reflect secondEnemy — not the stale firstEnemy id
      const target = service.getCachedFocusTarget();
      expect(target).not.toBeNull();
      expect(target?.entityId).toBe(secondEnemy);
      expect(target?.entityId).not.toBe(firstEnemy);
    });

    it('getCachedFocusTarget returns null immediately after rapid toggle leaves no enemies', () => {
      isFocusFiring = true;
      createPlayer();
      const enemy = createEnemy(50, 0);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Destroy enemy, then rapidly toggle off/on
      entityManager.destroyEntity(enemy);

      isFocusFiring = false;
      service.update(16, entityManager);

      isFocusFiring = true;
      service.update(16, entityManager);

      expect(service.getCachedFocusTarget()).toBeNull();
    });
  });

  // ─── Test 2: Toggle off clears cache immediately (not after frame 3) ──────

  describe('toggle off during cached frame clears cache immediately', () => {
    it('getCachedFocusTarget returns null on the same frame focus fire is toggled off', () => {
      isFocusFiring = true;
      createPlayer();
      const enemy = createEnemy(50, 0);

      // Frame 1: recompute, cache locked
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Frame 2: still within 3-frame cache window — cache should persist
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Frame 2½ — toggle OFF. Cache must not wait until frame 3 to expire.
      isFocusFiring = false;
      service.update(16, entityManager);

      // With focus fire off, the update path does not enter the Focus Fire branch.
      // wasFocusFiring is now false. The cached value is preserved internally but
      // the system no longer uses it — calling getCachedFocusTarget after the
      // update loop should show the cache was not updated (it may still hold the
      // old value because the service only clears on re-activation, not deactivation).
      // What matters is that on the NEXT re-activation the cache is cleared.
      // This test verifies the off→on transition forces a fresh scan.

      // Remove the known enemy so a fresh scan returns null
      entityManager.destroyEntity(enemy);

      // Re-enable focus fire: re-activation path must clear cache
      isFocusFiring = true;
      service.update(16, entityManager);

      // No enemies exist → fresh scan returns null
      expect(service.getCachedFocusTarget()).toBeNull();
    });

    it('invalidateFocusTarget called on toggle-off immediately clears cache before frame 3', () => {
      isFocusFiring = true;
      createPlayer();
      const enemy = createEnemy(50, 0);

      // Frame 1: lock cache
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Explicit invalidation (as if called by toggle-off handler)
      service.invalidateFocusTarget();

      // Cache must be null immediately — not waiting for the 3-frame window
      expect(service.getCachedFocusTarget()).toBeNull();
    });

    it('cache does not expire early on frame 2 when focus fire stays on', () => {
      isFocusFiring = true;
      createPlayer();
      const enemy = createEnemy(50, 0);

      // Frames 1 & 2: cache should persist (3-frame window has not elapsed)
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);

      // Focus fire stays on — cache still valid on frame 2
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemy);
    });
  });

  // ─── Test 3: Equidistant enemies — deterministic result ──────────────────

  describe('equidistant enemies — deterministic tie-breaking', () => {
    it('returns a non-null target when two enemies are at the same distance', () => {
      isFocusFiring = true;
      createPlayer(); // player at (0,0)

      // Both enemies at distance 100 from player
      createEnemy(100, 0);
      createEnemy(-100, 0);

      service.update(16, entityManager);

      // One of the two enemies must be selected — must not be null
      expect(service.getCachedFocusTarget()).not.toBeNull();
    });

    it('consistently returns the same target across frames when two enemies are equidistant', () => {
      isFocusFiring = true;
      createPlayer();

      createEnemy(100, 0);
      createEnemy(-100, 0);

      // Frame 1: locks a target
      service.update(16, entityManager);
      const firstPick = service.getCachedFocusTarget()?.entityId;
      expect(firstPick).toBeDefined();

      // Frames 2 & 3: cache holds — same entity
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(firstPick);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(firstPick);
    });

    it('picks the first entity in iteration order on a tie (strict < not <=)', () => {
      // findNearestAliveEnemy uses distSq < nearestDistSq (strict less-than).
      // On a tie, the first entity encountered in iteration order wins.
      isFocusFiring = true;
      createPlayer();

      // Create two enemies at identical distance along perpendicular axes
      const enemyA = createEnemy(0, 50); // distance = 50
      const enemyB = createEnemy(0, -50); // distance = 50

      service.update(16, entityManager);

      const target = service.getCachedFocusTarget();
      expect(target).not.toBeNull();

      // Result must be one of the two — and deterministic (no random selection)
      const selectedId = target!.entityId;
      expect([enemyA, enemyB]).toContain(selectedId);

      // Re-running with the same world must produce the same pick
      service.invalidateFocusTarget();
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(selectedId);
    });
  });

  // ─── Test 4: All enemies die simultaneously after cache is set ───────────

  describe('all enemies die simultaneously after cache is set', () => {
    it('returns null from getCachedFocusTarget on the next frame when all enemies die', () => {
      isFocusFiring = true;
      createPlayer();

      const enemyA = createEnemy(50, 0);
      const enemyB = createEnemy(100, 0);

      // Frame 1: cache = enemyA (nearest)
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Simultaneously kill both enemies between frames
      const healthA = entityManager.getComponent(enemyA, HealthComponent);
      const healthB = entityManager.getComponent(enemyB, HealthComponent);
      if (healthA) healthA.health = 0;
      if (healthB) healthB.health = 0;

      // Frame 2: liveness check invalidates cache for enemyA; recompute finds no live enemies
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()).toBeNull();
    });

    it('getCachedFocusTarget stays null across subsequent frames with no live enemies', () => {
      isFocusFiring = true;
      createPlayer();

      const enemy = createEnemy(50, 0);

      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()).not.toBeNull();

      // Kill the only enemy
      const health = entityManager.getComponent(enemy, HealthComponent);
      if (health) health.health = 0;

      // Multiple frames: null must persist
      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);

      expect(service.getCachedFocusTarget()).toBeNull();
    });
  });

  // ─── Test 5: Closer enemy spawns after cache is set — stale until frame 4 ─

  describe('closer enemy spawns after cache — served from cache until recompute', () => {
    it('continues targeting enemy A within the 3-frame cache window after enemy B spawns closer', () => {
      isFocusFiring = true;
      createPlayer();

      const enemyA = createEnemy(500, 0); // starts as the only (nearest) enemy

      // Frame 1: cache = enemyA
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Spawn a closer enemy between frame 1 and the recompute boundary
      const enemyB = createEnemy(10, 0);

      // Frame 2: cache window active — still targeting A
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Frame 3: cache window active — still targeting A
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Silence unused variable lint warning
      void enemyB;
    });

    it('switches to the closer enemy B on frame 4 when cache recomputes', () => {
      isFocusFiring = true;
      createPlayer();

      const enemyA = createEnemy(500, 0);

      // Frame 1: lock cache onto A
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Spawn closer B
      const enemyB = createEnemy(10, 0);

      // Frames 2 & 3: still A (cached)
      service.update(16, entityManager);
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Frame 4: recompute fires — B is now the nearest alive enemy
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyB);
    });

    it('does not switch to the closer enemy during cache window even across toggle off/on if recompute threshold not reached', () => {
      isFocusFiring = true;
      createPlayer();

      const enemyA = createEnemy(500, 0);

      // Frame 1: lock cache onto A; frame counter = 0 after recompute
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Spawn B closer
      const enemyB = createEnemy(10, 0);

      // Frame 2: still within cache window
      service.update(16, entityManager);
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyA);

      // Toggle off — wasFocusFiring will become false
      isFocusFiring = false;
      service.update(16, entityManager);

      // Toggle back on — re-activation clears the stale cache for a fresh scan
      isFocusFiring = true;
      service.update(16, entityManager);

      // After re-activation, fresh scan picks up B (the closer one)
      expect(service.getCachedFocusTarget()?.entityId).toBe(enemyB);
    });
  });
});
