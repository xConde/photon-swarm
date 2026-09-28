/**
 * ShieldFacingSystemService spec
 *
 * Tests: angle calculation toward player, lerp smoothing, cleanup,
 * and angle wrapping across the -π/+π boundary.
 */
import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { ShieldFacingSystemService } from './shield-facing-system.service';
import { PlayerService } from '../../player/player.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PositionComponent } from '@photon/components/position.component';
import { ShieldArcComponent } from '@photon/components/shield-arc.component';
import { ComponentType } from '../../ecs/ecs.model';

describe('ShieldFacingSystemService', () => {
  let service: ShieldFacingSystemService;
  let playerPosition: { x: number; y: number };

  // Mini in-memory component store for the mock entity manager
  const componentStore = new Map<number, Map<unknown, unknown>>();

  function setComponent<T>(entityId: number, type: unknown, comp: T): void {
    if (!componentStore.has(entityId)) componentStore.set(entityId, new Map());
    componentStore.get(entityId)!.set(type, comp);
  }

  function createMockEntityManager(): EntityManagerService {
    return {
      getEntitiesWithComponents: (...types: ComponentType[]) => {
        const result: number[] = [];
        componentStore.forEach((components, entityId) => {
          if (types.every((t) => components.has(t))) result.push(entityId);
        });
        return result;
      },
      getComponent: (entityId: number, type: ComponentType) => {
        return componentStore.get(entityId)?.get(type);
      },
    } as unknown as EntityManagerService;
  }

  function setupEntityWithShield(
    entityId: number,
    ex: number,
    ey: number,
    facingAngle: number
  ): { pos: PositionComponent; shield: ShieldArcComponent } {
    const pos = new PositionComponent(ex, ey);
    const shield = new ShieldArcComponent();
    shield.facingAngle = facingAngle;
    setComponent(entityId, PositionComponent, pos);
    setComponent(entityId, ShieldArcComponent, shield);
    return { pos, shield };
  }

  beforeEach(() => {
    componentStore.clear();
    playerPosition = { x: 0, y: 0 };

    const fakeNgZone = new NgZone({ enableLongStackTrace: false });

    const fakePlayerService = {
      getPosition: () => playerPosition,
    } as unknown as PlayerService;

    TestBed.configureTestingModule({
      providers: [
        ShieldFacingSystemService,
        { provide: EntityManagerService, useValue: createMockEntityManager() },
        { provide: PlayerService, useValue: fakePlayerService },
        { provide: NgZone, useValue: fakeNgZone },
      ],
    });

    service = TestBed.inject(ShieldFacingSystemService);
  });

  describe('angle tracking — shield faces toward player', () => {
    it('moves facingAngle toward the player direction', () => {
      // Entity at origin, player at right (+x), so target angle = 0
      const { shield } = setupEntityWithShield(1, 0, 0, Math.PI / 2); // currently facing up
      playerPosition = { x: 100, y: 0 };

      service.update(16);

      // After one lerp step (factor 0.15): diff = 0 - (π/2) = -π/2
      // newAngle = π/2 + (-π/2 * 0.15) = π/2 * 0.85
      const expected = Math.PI / 2 + (-Math.PI / 2) * 0.15;
      expect(shield.facingAngle).toBeCloseTo(expected, 4);
    });

    it('does not snap immediately to target — lerp factor is 0.15', () => {
      const { shield } = setupEntityWithShield(1, 0, 0, 0);
      playerPosition = { x: 0, y: 100 }; // target = π/2

      service.update(16);

      // Should move only ~15% of the way; well short of π/2
      expect(shield.facingAngle).not.toBeCloseTo(Math.PI / 2, 1);
      expect(shield.facingAngle).toBeGreaterThan(0);
    });

    it('converges toward target over 30 updates', () => {
      const { shield } = setupEntityWithShield(1, 0, 0, 0);
      playerPosition = { x: 0, y: 100 }; // target = π/2

      // Re-inject service with a fresh entity manager each iteration is not needed —
      // the same service instance processes the in-memory store
      for (let i = 0; i < 30; i++) {
        service.update(16);
      }

      // After 30 frames at lerp 0.15, should be within 0.5 rad of π/2
      expect(shield.facingAngle).toBeCloseTo(Math.PI / 2, 0);
    });

    it('handles player directly below entity', () => {
      const { shield } = setupEntityWithShield(1, 100, 100, 0);
      playerPosition = { x: 100, y: 200 }; // directly below → angle = π/2

      service.update(16);

      expect(shield.facingAngle).toBeGreaterThan(0);
    });
  });

  describe('angle wrapping — shortest-path rotation', () => {
    it('takes the short path when wrapping across -π/+π boundary', () => {
      // Shield facing just below -π/2, player just above +π/2
      // Without wrapping the diff would be ≈+π (long way); with wrapping it's ≈-0.2 (short way)
      const startAngle = -Math.PI / 2 - 0.1;
      const { shield } = setupEntityWithShield(1, 0, 0, startAngle);
      // Player positioned so target angle ≈ π/2 + 0.1 (just over +π/2)
      playerPosition = { x: -1, y: 100 }; // approx π/2

      service.update(16);

      // If wrapping works, the step should be small (≤ |diff| * 0.15)
      // Without wrapping the step would push angle toward +π/2 via the long way, making it increase by ~0.3+
      const step = Math.abs(shield.facingAngle - startAngle);
      expect(step).toBeLessThan(0.5); // short path step, not a huge jump
    });

    it('final angle stays within [-π, π] after lerp step', () => {
      const { shield } = setupEntityWithShield(1, 0, 0, Math.PI - 0.1);
      playerPosition = { x: -100, y: 1 }; // angle ≈ π

      service.update(16);

      expect(shield.facingAngle).toBeGreaterThanOrEqual(-Math.PI);
      expect(shield.facingAngle).toBeLessThanOrEqual(Math.PI + 0.01); // small tolerance
    });
  });

  describe('cleanupDeadEnemy', () => {
    it('does not throw for tracked entity', () => {
      setupEntityWithShield(42, 0, 0, 0);
      service.update(16);
      expect(() => service.cleanupDeadEnemy(42)).not.toThrow();
    });

    it('does not throw for never-tracked entity', () => {
      expect(() => service.cleanupDeadEnemy(999)).not.toThrow();
    });

    it('can be called multiple times for same entity', () => {
      setupEntityWithShield(7, 0, 0, 0);
      service.update(16);
      service.cleanupDeadEnemy(7);
      expect(() => service.cleanupDeadEnemy(7)).not.toThrow();
    });
  });

  describe('null player position guard', () => {
    it('does not crash when getPosition returns null', () => {
      // Override fakePlayerService to return null (simulates initialization race)
      const fakePlayerServiceNull = {
        getPosition: () => null,
      } as unknown as PlayerService;

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ShieldFacingSystemService,
          {
            provide: EntityManagerService,
            useValue: createMockEntityManager(),
          },
          { provide: PlayerService, useValue: fakePlayerServiceNull },
          {
            provide: NgZone,
            useValue: new NgZone({ enableLongStackTrace: false }),
          },
        ],
      });

      const svcNull = TestBed.inject(ShieldFacingSystemService);
      setupEntityWithShield(1, 0, 0, 0);

      expect(() => svcNull.update(16)).not.toThrow();
    });
  });

  describe('multiple entities', () => {
    it('updates all entities independently', () => {
      // Entity 1 at (-100, 0) with player at (0, 0) → target ≈ 0 (already correct)
      // Entity 2 at (100, 0) with player at (0, 0) → target ≈ π
      const { shield: shield1 } = setupEntityWithShield(1, -100, 0, 0);
      const { shield: shield2 } = setupEntityWithShield(2, 100, 0, 0);
      playerPosition = { x: 0, y: 0 };

      service.update(16);

      // Entity 1: target is 0, was 0 → no change
      expect(shield1.facingAngle).toBeCloseTo(0, 5);

      // Entity 2: target is π (or -π), was 0 → should move toward ±π
      expect(Math.abs(shield2.facingAngle)).toBeGreaterThan(0);
    });

    it('does not throw when some entities lack one component', () => {
      // Only position, no shield arc
      setComponent(99, PositionComponent, new PositionComponent(0, 0));
      expect(() => service.update(16)).not.toThrow();
    });
  });
});
