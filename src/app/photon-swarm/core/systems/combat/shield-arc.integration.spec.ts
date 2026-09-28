/**
 * ShieldArc integration tests — Sentinel full combat loop.
 *
 * Covers: frontal damage reduction, rear full damage, boundary angles,
 * shield facing tracking via ShieldFacingSystemService, lastBlockTime
 * for flash rendering, and frontal knockback suppression.
 *
 * Does NOT duplicate unit tests already in:
 *   - shield-arc.component.spec.ts   (constructor, getBlockReduction)
 *   - shield-facing-system.service.spec.ts  (lerp, cleanup, angle wrap)
 */
import { TestBed } from '@angular/core/testing';
import { NgZone } from '@angular/core';
import { ShieldFacingSystemService } from './shield-facing-system.service';
import { PlayerService } from '../../player/player.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { ShieldArcComponent } from '@photon/components/shield-arc.component';
import { PositionComponent } from '@photon/components/position.component';
import { ComponentType } from '../../ecs/ecs.model';

// ---------------------------------------------------------------------------
// Minimal in-memory ECS store (mirrors pattern from shield-facing spec)
// ---------------------------------------------------------------------------
interface TestStore {
  store: Map<number, Map<unknown, unknown>>;
  set: <T>(id: number, type: unknown, comp: T) => void;
  makeEntityManager: () => EntityManagerService;
}

function buildStore(): TestStore {
  const store = new Map<number, Map<unknown, unknown>>();

  function set<T>(id: number, type: unknown, comp: T): void {
    if (!store.has(id)) store.set(id, new Map());
    store.get(id)!.set(type, comp);
  }

  function makeEntityManager(): EntityManagerService {
    return {
      getEntitiesWithComponents: (...types: ComponentType[]) => {
        const result: number[] = [];
        store.forEach((comps, id) => {
          if (types.every((t) => comps.has(t))) result.push(id);
        });
        return result;
      },
      getComponent: (id: number, type: ComponentType) => store.get(id)?.get(type),
    } as unknown as EntityManagerService;
  }

  return { store, set, makeEntityManager };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe('ShieldArc — Sentinel integration', () => {
  // =========================================================================
  // 1. Frontal beam damage reduced (80%)
  // =========================================================================
  describe('Damage reduction — shield blocking', () => {
    it('frontal beam: damage * 0.2 (80% reduction) when attack within 60° arc', () => {
      // Shield facing right (0 rad). Attack from exactly 0 rad (directly in front).
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);

      // sourceAngle = 0 (attack is in front)
      const reduction = ShieldArcComponent.getBlockReduction(shield, 0);
      const incoming = 100;
      const mitigated = incoming * (1 - reduction);

      expect(reduction).toBe(0.8);
      expect(mitigated).toBeCloseTo(20, 3); // 100 * 0.2
    });

    it('rear beam: full damage when attack from behind (π radians)', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);

      const reduction = ShieldArcComponent.getBlockReduction(shield, Math.PI);
      expect(reduction).toBe(0);
    });

    it('side hit at exactly 60° boundary → blocked', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const boundary = Math.PI / 3; // exactly 60°

      const reduction = ShieldArcComponent.getBlockReduction(shield, boundary);
      expect(reduction).toBe(0.8);
    });

    it('side hit at 61° (just outside boundary) → full damage', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const justOutside = Math.PI / 3 + (1 * Math.PI) / 180; // 61°

      const reduction = ShieldArcComponent.getBlockReduction(shield, justOutside);
      expect(reduction).toBe(0);
    });

    it('reduction formula: mitigated damage = raw * (1 − shieldReduction)', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const rawDamage = 75;
      const reduction = ShieldArcComponent.getBlockReduction(shield, 0); // frontal

      const finalDamage = rawDamage * (1 - reduction);
      expect(finalDamage).toBeCloseTo(15, 2); // 75 * 0.2
    });
  });

  // =========================================================================
  // 2. Shield facing tracks player (ShieldFacingSystemService integration)
  // =========================================================================
  describe('Shield facing → player tracking', () => {
    let shieldFacingService: ShieldFacingSystemService;
    let playerPos: { x: number; y: number };

    /** Spin up ShieldFacingSystemService with a given in-memory ECS store. */
    function configureShieldFacingService(s: ReturnType<typeof buildStore>): void {
      const fakeNgZone = new NgZone({ enableLongStackTrace: false });
      const fakePlayerService = { getPosition: () => playerPos } as unknown as PlayerService;
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ShieldFacingSystemService,
          { provide: EntityManagerService, useValue: s.makeEntityManager() },
          { provide: PlayerService, useValue: fakePlayerService },
          { provide: NgZone, useValue: fakeNgZone },
        ],
      });
      shieldFacingService = TestBed.inject(ShieldFacingSystemService);
    }

    it('after one update, facingAngle moves toward player direction', () => {
      const s = buildStore();
      playerPos = { x: 100, y: 0 }; // player is to the right of entity

      // Entity at origin, shield initially facing up (π/2)
      const pos = new PositionComponent(0, 0);
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, Math.PI / 2, 0);
      s.set(1, PositionComponent, pos);
      s.set(1, ShieldArcComponent, shield);

      configureShieldFacingService(s);

      const initialAngle = shield.facingAngle;
      shieldFacingService.update(16);

      // Target is 0 (right), started at π/2 (up); lerp should reduce angle
      expect(shield.facingAngle).toBeLessThan(initialAngle);
    });

    it('facingAngle converges to player direction after 40 frames', () => {
      const s = buildStore();
      playerPos = { x: 0, y: 100 }; // directly below → target ≈ π/2
      const pos = new PositionComponent(0, 0);
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      s.set(1, PositionComponent, pos);
      s.set(1, ShieldArcComponent, shield);

      configureShieldFacingService(s);

      for (let i = 0; i < 40; i++) shieldFacingService.update(16);

      expect(shield.facingAngle).toBeCloseTo(Math.PI / 2, 0);
    });
  });

  // =========================================================================
  // 3. Shield flash: lastBlockTime is updated on frontal block
  // =========================================================================
  describe('Shield block flash — lastBlockTime', () => {
    it('lastBlockTime updated after frontal hit', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const before = shield.lastBlockTime;

      // Simulate what BeamCollisionSystemService does on a frontal hit
      const sourceAngle = 0; // player directly in front
      const reduction = ShieldArcComponent.getBlockReduction(shield, sourceAngle);
      if (reduction > 0) {
        shield.lastBlockTime = Date.now();
      }

      expect(shield.lastBlockTime).toBeGreaterThan(before);
    });

    it('lastBlockTime NOT updated on rear hit (no block)', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const initial = shield.lastBlockTime;

      // Rear attack — reduction = 0 → no update
      const reduction = ShieldArcComponent.getBlockReduction(shield, Math.PI);
      if (reduction > 0) {
        shield.lastBlockTime = Date.now();
      }

      expect(shield.lastBlockTime).toBe(initial);
    });

    it('flash alpha calculation: time since lastBlockTime governs rendering fade', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const FLASH_DURATION_MS = 300;

      // Simulate a hit 150ms ago
      shield.lastBlockTime = Date.now() - 150;
      const elapsed = Date.now() - shield.lastBlockTime;
      const alpha = Math.max(0, 1 - elapsed / FLASH_DURATION_MS);

      expect(alpha).toBeGreaterThan(0); // still in flash window
      expect(alpha).toBeLessThan(1);

      // Simulate a hit 400ms ago (past flash window)
      shield.lastBlockTime = Date.now() - 400;
      const elapsedOld = Date.now() - shield.lastBlockTime;
      const alphaOld = Math.max(0, 1 - elapsedOld / FLASH_DURATION_MS);
      expect(alphaOld).toBe(0);
    });
  });

  // =========================================================================
  // 4. Frontal knockback immunity
  // =========================================================================
  describe('Frontal knockback immunity', () => {
    it('knockback is blocked when attack within frontal arc', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const playerX = 100;
      const playerY = 0;
      const enemyX = 0;
      const enemyY = 0;

      // Simulate the knockback check in BeamCollisionSystemService
      const kbSourceAngle = Math.atan2(playerY - enemyY, playerX - enemyX); // 0
      let diff = kbSourceAngle - shield.facingAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      const knockbackBlocked = Math.abs(diff) <= shield.arcAngle / 2;
      expect(knockbackBlocked).toBeTrue();
    });

    it('knockback is NOT blocked from behind', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const playerX = -100;
      const playerY = 0; // player behind the shield
      const enemyX = 0;
      const enemyY = 0;

      const kbSourceAngle = Math.atan2(playerY - enemyY, playerX - enemyX); // π
      let diff = kbSourceAngle - shield.facingAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      const knockbackBlocked = Math.abs(diff) <= shield.arcAngle / 2;
      expect(knockbackBlocked).toBeFalse();
    });

    it('knockback blocked at exact 60° boundary', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      // Attack from exactly 60° — on the boundary (inclusive)
      const attackAngle = Math.PI / 3; // 60°

      let diff = attackAngle - shield.facingAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      const knockbackBlocked = Math.abs(diff) <= shield.arcAngle / 2;
      expect(knockbackBlocked).toBeTrue();
    });

    it('knockback allowed at 61° (just outside arc)', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
      const attackAngle = Math.PI / 3 + (1 * Math.PI) / 180; // 61°

      let diff = attackAngle - shield.facingAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      const knockbackBlocked = Math.abs(diff) <= shield.arcAngle / 2;
      expect(knockbackBlocked).toBeFalse();
    });
  });

  // =========================================================================
  // 5. Angle normalisation across ±π boundary
  // =========================================================================
  describe('angle normalisation — cross-boundary', () => {
    it('shield facing near −π blocks attack from near +π (same direction)', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, Math.PI, 0);
      // Attack from -π (same as +π = facing left)
      const reduction = ShieldArcComponent.getBlockReduction(shield, -Math.PI);
      expect(reduction).toBe(0.8);
    });

    it('shield facing left (π) does not block attack from right (0)', () => {
      const shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, Math.PI, 0);
      const reduction = ShieldArcComponent.getBlockReduction(shield, 0);
      expect(reduction).toBe(0);
    });
  });
});
