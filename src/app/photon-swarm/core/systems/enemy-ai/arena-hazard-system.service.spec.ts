import { TestBed } from '@angular/core/testing';
import { ArenaHazardSystemService } from './arena-hazard-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { Component, ComponentType } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { GameStateService } from '../../state/game-state.service';
import {
  ArenaHazardComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
} from '@photon/components';
import { ARENA_HAZARD } from '@photon/config/game-constants';

function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  if (componentType === componentClass) return true;
  if (typeof componentType !== 'function' || typeof componentClass !== 'function') return false;
  return componentType.name === componentClass.name;
}

describe('ArenaHazardSystemService', () => {
  let service: ArenaHazardSystemService;
  let entityManager: jasmine.SpyObj<EntityManagerService>;
  let effectFactory: jasmine.SpyObj<EffectFactoryService>;
  let gameState: jasmine.SpyObj<GameStateService>;

  const PLAYER_ID = 1;
  const HAZARD_ID = 2;

  beforeEach(() => {
    const entityManagerSpy = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'destroyEntity',
    ]);

    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
      'createEmpPulseEffect',
      'createEnemyExplosion',
    ]);

    const gameStateSpy = jasmine.createSpyObj('GameStateService', ['takeDamage', 'getHealth']);
    gameStateSpy.getHealth.and.returnValue(80);

    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [
        ArenaHazardSystemService,
        { provide: EntityManagerService, useValue: entityManagerSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });

    service = TestBed.inject(ArenaHazardSystemService);
    entityManager = TestBed.inject(EntityManagerService) as jasmine.SpyObj<EntityManagerService>;
    effectFactory = TestBed.inject(EffectFactoryService) as jasmine.SpyObj<EffectFactoryService>;
    gameState = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;
  });

  /**
   * Build a hazard component whose spawnedAt is offset into the past so that
   * isDetonationMoment(Date.now()) and isExpired(Date.now()) behave predictably
   * without relying on Date.now() spies (which are unreliable under Zone.js).
   *
   * pastMs=0  → brand new (telegraph not yet elapsed)
   * pastMs=telegraphMs  → exactly at detonation
   * pastMs=telegraphMs+lingerMs → expired
   */
  function makeHazard(pastMs: number, telegraphMs = 900, lingerMs = 250): ArenaHazardComponent {
    const spawnedAt = Date.now() - pastMs;
    return new ArenaHazardComponent(150, 16, 'standard', spawnedAt, telegraphMs, lingerMs);
  }

  function makePlayer(
    x = 200,
    y = 200,
    isInvincible = false,
    invincibilityEndTime = 0
  ): { playerPos: PositionComponent; playerComp: PlayerControlledComponent; playerHealth: HealthComponent } {
    const playerPos = new PositionComponent(x, y);
    const playerComp = new PlayerControlledComponent();
    playerComp.isInvincible = isInvincible;
    playerComp.invincibilityEndTime = invincibilityEndTime;
    const playerHealth = new HealthComponent(100, 100);
    return { playerPos, playerComp, playerHealth };
  }

  function wireEntityManager(
    hazard: ArenaHazardComponent,
    hazardPos: PositionComponent,
    playerPos: PositionComponent,
    playerComp: PlayerControlledComponent,
    playerHealth: HealthComponent
  ): void {
    entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
      if (isComponentType(types[0], PlayerControlledComponent)) return [PLAYER_ID];
      if (isComponentType(types[0], ArenaHazardComponent)) return [HAZARD_ID];
      return [];
    });
    entityManager.getComponent.and.callFake(
      <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
        if (id === PLAYER_ID) {
          if (isComponentType(type, PlayerControlledComponent)) return playerComp as unknown as T;
          if (isComponentType(type, PositionComponent)) return playerPos as unknown as T;
          if (isComponentType(type, HealthComponent)) return playerHealth as unknown as T;
        }
        if (id === HAZARD_ID) {
          if (isComponentType(type, ArenaHazardComponent)) return hazard as unknown as T;
          if (isComponentType(type, PositionComponent)) return hazardPos as unknown as T;
        }
        return undefined;
      }
    );
  }

  // ── Telegraph VFX ────────────────────────────────────────────────────────

  describe('telegraph VFX', () => {
    it('fires createEmpPulseEffect exactly once across two consecutive updates before detonation', () => {
      // pastMs=0 → brand new hazard, telegraph not yet elapsed
      const hazard = makeHazard(0);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer();
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);
      service.update(16, entityManager);

      // Both updates run within one cadence window (synchronous Date.now()), so
      // the ring fires once — not twice.
      expect(effectFactory.createEmpPulseEffect).toHaveBeenCalledOnceWith({ x: 300, y: 300 }, 150);
    });

    it('re-pulses the ring after the cadence elapses, before detonation (red-team Finding 1)', () => {
      // 200ms into a 900ms telegraph → still well inside the telegraph window.
      const hazard = makeHazard(200);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer();
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);
      expect(effectFactory.createEmpPulseEffect).toHaveBeenCalledTimes(1);

      // Simulate the re-pulse cadence having elapsed since the last ring.
      hazard.lastTelegraphPulseAt = Date.now() - (ARENA_HAZARD.PULSE_CADENCE_MS + 10);
      service.update(16, entityManager);
      expect(effectFactory.createEmpPulseEffect).toHaveBeenCalledTimes(2);
    });
  });

  // ── Detonation — player inside, not invincible ───────────────────────────

  describe('detonation with player inside radius', () => {
    it('calls gameState.takeDamage with arena_hazard source when player is inside radius', () => {
      // Set spawnedAt well in the past so isDetonationMoment returns true
      const hazard = makeHazard(1500); // 1500ms past → well past 900ms telegraphMs
      const hazardPos = new PositionComponent(300, 300);
      // Player at 300,300 — same position, definitely inside radius
      const { playerPos, playerComp, playerHealth } = makePlayer(300, 300);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(gameState.takeDamage).toHaveBeenCalledOnceWith(16, 'arena_hazard');
    });

    it('syncs playerHealth.health from gameState.getHealth() after damage', () => {
      gameState.getHealth.and.returnValue(74);
      const hazard = makeHazard(1500);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer(300, 300);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(playerHealth.health).toBe(74);
    });

    it('calls createEnemyExplosion with scaled intensity', () => {
      const hazard = makeHazard(1500);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer(300, 300);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      // intensity = radius / 100 = 150 / 100 = 1.5
      expect(effectFactory.createEnemyExplosion).toHaveBeenCalledOnceWith({ x: 300, y: 300 }, 1.5);
    });
  });

  // ── Detonation — player outside radius ───────────────────────────────────

  describe('detonation with player outside radius', () => {
    it('does NOT call takeDamage when player is outside the hazard radius', () => {
      const hazard = makeHazard(1500);
      const hazardPos = new PositionComponent(300, 300);
      // Player at 600,300 → 300px away, outside 150px radius
      const { playerPos, playerComp, playerHealth } = makePlayer(600, 300);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(gameState.takeDamage).not.toHaveBeenCalled();
    });
  });

  // ── Detonation — player invincible ───────────────────────────────────────

  describe('detonation with player invincible', () => {
    it('does NOT call takeDamage when player isInvincible is true with no expiry', () => {
      const hazard = makeHazard(1500);
      const hazardPos = new PositionComponent(300, 300);
      // isInvincible=true, invincibilityEndTime=0 → permanent invincibility
      const { playerPos, playerComp, playerHealth } = makePlayer(300, 300, true, 0);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(gameState.takeDamage).not.toHaveBeenCalled();
    });

    it('does NOT call takeDamage when invincibilityEndTime is in the future', () => {
      const hazard = makeHazard(1500);
      const hazardPos = new PositionComponent(300, 300);
      const futureEndTime = Date.now() + 5000;
      const { playerPos, playerComp, playerHealth } = makePlayer(300, 300, true, futureEndTime);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(gameState.takeDamage).not.toHaveBeenCalled();
    });
  });

  // ── Detonation idempotency (detonated flag) ───────────────────────────────

  describe('damage applied exactly once', () => {
    it('does not re-damage on a second update after detonation (detonated flag)', () => {
      const hazard = makeHazard(1500);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer(300, 300);
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);
      // hazard.detonated is now true; isDetonationMoment returns false
      service.update(16, entityManager);

      expect(gameState.takeDamage).toHaveBeenCalledTimes(1);
    });
  });

  // ── Entity expiry ─────────────────────────────────────────────────────────

  describe('entity expiry', () => {
    it('calls entityManager.destroyEntity when isExpired() returns true', () => {
      // 900 + 250 + 100 = 1250ms past → well past the expiry threshold
      const hazard = makeHazard(1250);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer();
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(entityManager.destroyEntity).toHaveBeenCalledWith(HAZARD_ID);
    });

    it('does NOT destroy entity before expiry', () => {
      // brand new hazard → not expired
      const hazard = makeHazard(0);
      const hazardPos = new PositionComponent(300, 300);
      const { playerPos, playerComp, playerHealth } = makePlayer();
      wireEntityManager(hazard, hazardPos, playerPos, playerComp, playerHealth);

      service.update(16, entityManager);

      expect(entityManager.destroyEntity).not.toHaveBeenCalled();
    });
  });
});
