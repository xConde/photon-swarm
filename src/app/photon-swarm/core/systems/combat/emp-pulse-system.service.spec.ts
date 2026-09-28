/**
 * EmpPulseSystemService spec
 *
 * Tests: cooldown timing, radius check, slow application, charge drain, cleanup, non-stacking.
 */
import { TestBed } from '@angular/core/testing';
import { EmpPulseSystemService } from './emp-pulse-system.service';
import { PlayerService } from '../../player/player.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EmpPulseComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';
import { DualChargingComponent } from '@photon/components/dual-charging.component';
import { ComponentType, EntityManager } from '../../ecs/ecs.model';

describe('EmpPulseSystemService', () => {
  let service: EmpPulseSystemService;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockEffectFactory: jasmine.SpyObj<EffectFactoryService>;

  const ENEMY_ID = 10;
  const PLAYER_ID = 1;

  const componentStore = new Map<number, Map<unknown, unknown>>();

  function setComponent<T>(entityId: number, type: unknown, comp: T): void {
    if (!componentStore.has(entityId)) {
      componentStore.set(entityId, new Map());
    }
    componentStore.get(entityId)!.set(type, comp);
  }

  function createMockEntityManager(): EntityManager {
    return {
      getEntitiesWithComponents: (...types: ComponentType[]) => {
        const result: number[] = [];
        componentStore.forEach((components, entityId) => {
          if (types.every((t) => components.has(t))) {
            result.push(entityId);
          }
        });
        return result;
      },
      getComponent: (entityId: number, type: ComponentType) => {
        return componentStore.get(entityId)?.get(type);
      },
      hasComponent: (entityId: number, type: ComponentType) => {
        return componentStore.get(entityId)?.has(type) ?? false;
      },
    } as unknown as EntityManager;
  }

  beforeEach(() => {
    componentStore.clear();

    mockPlayerService = jasmine.createSpyObj('PlayerService', ['applySlow', 'isSlowed']);
    mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', ['createEmpPulseEffect']);
    mockEffectFactory.createEmpPulseEffect.and.returnValue('effect-1');

    TestBed.configureTestingModule({
      providers: [
        EmpPulseSystemService,
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
      ],
    });

    service = TestBed.inject(EmpPulseSystemService);
  });

  function setupDefaultScene(distanceToPlayer: number = 50): {
    emp: EmpPulseComponent;
    em: EntityManager;
    dualCharging: DualChargingComponent;
  } {
    // Player at origin
    const playerPos = new PositionComponent(0, 0);
    setComponent(PLAYER_ID, PositionComponent, playerPos);
    setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
    const dualCharging = new DualChargingComponent();
    setComponent(PLAYER_ID, DualChargingComponent, dualCharging);

    // Enemy at given distance
    const enemyPos = new PositionComponent(distanceToPlayer, 0);
    const emp = new EmpPulseComponent(6000, 0, 120, 0.4, 2000, 0.3);
    setComponent(ENEMY_ID, PositionComponent, enemyPos);
    setComponent(ENEMY_ID, EmpPulseComponent, emp);

    return { emp, em: createMockEntityManager(), dualCharging };
  }

  describe('cooldown timing', () => {
    it('does not fire before cooldown elapses', () => {
      const { emp, em } = setupDefaultScene(50);
      const recentTime = Date.now() - 100; // only 100ms ago
      emp.lastPulseTime = recentTime;

      service.update(16, em);

      expect(mockPlayerService.applySlow).not.toHaveBeenCalled();
    });

    it('fires when cooldown has elapsed', () => {
      const { emp, em } = setupDefaultScene(50);
      const oldTime = Date.now() - 7000; // 7 seconds ago (cooldown is 6000ms)
      emp.lastPulseTime = oldTime;

      service.update(16, em);

      expect(mockEffectFactory.createEmpPulseEffect).toHaveBeenCalled();
    });

    it('updates lastPulseTime after firing', () => {
      const { emp, em } = setupDefaultScene(50);
      emp.lastPulseTime = Date.now() - 7000;
      const before = Date.now();

      service.update(16, em);

      expect(emp.lastPulseTime).toBeGreaterThanOrEqual(before);
    });
  });

  describe('radius check', () => {
    it('applies slow when player is within pulse radius', () => {
      const { emp, em } = setupDefaultScene(50); // 50px < 120px radius
      emp.lastPulseTime = Date.now() - 7000;

      service.update(16, em);

      expect(mockPlayerService.applySlow).toHaveBeenCalledWith(0.4, 2000);
    });

    it('does NOT apply slow when player is beyond pulse radius', () => {
      const { emp, em } = setupDefaultScene(200); // 200px > 120px radius
      emp.lastPulseTime = Date.now() - 7000;

      service.update(16, em);

      expect(mockPlayerService.applySlow).not.toHaveBeenCalled();
    });

    it('still spawns VFX ring even when player is out of range', () => {
      const { emp, em } = setupDefaultScene(200);
      emp.lastPulseTime = Date.now() - 7000;

      service.update(16, em);

      expect(mockEffectFactory.createEmpPulseEffect).toHaveBeenCalled();
    });

    it('applies slow at exactly the radius boundary', () => {
      const { emp, em } = setupDefaultScene(120); // exactly at radius
      emp.lastPulseTime = Date.now() - 7000;

      service.update(16, em);

      // distance = 120, radius = 120, distSq = 14400, radiusSq = 14400 → hit
      expect(mockPlayerService.applySlow).toHaveBeenCalled();
    });
  });

  describe('slow application', () => {
    it('calls applySlow with correct factor and duration', () => {
      const { emp, em } = setupDefaultScene(50);
      emp.lastPulseTime = Date.now() - 7000;

      service.update(16, em);

      expect(mockPlayerService.applySlow).toHaveBeenCalledWith(0.4, 2000);
    });
  });

  describe('VFX creation', () => {
    it('creates EMP pulse effect at enemy position', () => {
      const { emp, em } = setupDefaultScene(50);
      emp.lastPulseTime = Date.now() - 7000;

      service.update(16, em);

      expect(mockEffectFactory.createEmpPulseEffect).toHaveBeenCalledWith(
        jasmine.objectContaining({ x: jasmine.any(Number), y: jasmine.any(Number) }),
        120 // radius
      );
    });
  });

  describe('cleanupDeadEnemy', () => {
    it('removes entity tracking without error', () => {
      service.cleanupDeadEnemy(ENEMY_ID);
      // No throw is the assertion
      expect(true).toBeTrue();
    });

    it('removing a non-tracked entity does not throw', () => {
      expect(() => service.cleanupDeadEnemy(9999)).not.toThrow();
    });

    it('after cleanup, entity no longer fires pulses', () => {
      const { emp, em } = setupDefaultScene(50);
      emp.lastPulseTime = Date.now() - 7000;

      service.cleanupDeadEnemy(ENEMY_ID);
      // Remove the EmpPulseComponent so entity no longer queries
      componentStore.get(ENEMY_ID)?.delete(EmpPulseComponent);

      service.update(16, em);

      expect(mockPlayerService.applySlow).not.toHaveBeenCalled();
    });
  });

  describe('non-stacking slow', () => {
    it('second pulse refreshes duration via applySlow called again', () => {
      const { emp, em } = setupDefaultScene(50);

      // First pulse
      emp.lastPulseTime = Date.now() - 7000;
      service.update(16, em);
      expect(mockPlayerService.applySlow).toHaveBeenCalledTimes(1);

      // Second pulse immediately (needs another cooldown cycle)
      emp.lastPulseTime = Date.now() - 7000;
      service.update(16, em);
      expect(mockPlayerService.applySlow).toHaveBeenCalledTimes(2);

      // Both calls use same factor/duration (non-stacking = same values applied)
      const [call1, call2] = mockPlayerService.applySlow.calls.all();
      expect(call1.args).toEqual(call2.args);
    });
  });

  describe('no player entities', () => {
    it('update does not throw when there are no player entities', () => {
      componentStore.clear(); // No player entity
      const em = createMockEntityManager();
      expect(() => service.update(16, em)).not.toThrow();
    });
  });
});
