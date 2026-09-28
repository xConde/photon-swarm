import { TestBed } from '@angular/core/testing';
import { HealAuraSystemService } from './heal-aura-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { Component, ComponentType } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import {
  EnemyTypeComponent,
  FactionComponent,
  HealAuraComponent,
  HealthComponent,
  PositionComponent,
} from '@photon/components';

function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  if (componentType === componentClass) return true;
  if (typeof componentType !== 'function' || typeof componentClass !== 'function') return false;
  return componentType.name === componentClass.name;
}

/**
 * HealAuraSystemService spec.
 *
 * The ally lookup is a same-faction enemy scan via
 * getEntitiesWithComponents(EnemyTypeComponent, HealthComponent, PositionComponent).
 * (Campaign E gate note: an attempt to route this through
 * SpatialPartitioningService.queryRadius was reverted — the engine never
 * populates that grid, so it silently healed nobody. These tests pin the
 * full-scan behavior.)
 */
describe('HealAuraSystemService', () => {
  let service: HealAuraSystemService;
  let entityManager: jasmine.SpyObj<EntityManagerService>;
  let effectFactory: jasmine.SpyObj<EffectFactoryService>;

  beforeEach(() => {
    const entityManagerSpy = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
    ]);
    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', ['createHealEffect']);
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [
        HealAuraSystemService,
        { provide: EntityManagerService, useValue: entityManagerSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });

    service = TestBed.inject(HealAuraSystemService);
    entityManager = TestBed.inject(EntityManagerService) as jasmine.SpyObj<EntityManagerService>;
    effectFactory = TestBed.inject(EffectFactoryService) as jasmine.SpyObj<EffectFactoryService>;
  });

  function makeHost(
    overrides: Partial<{
      health: number;
      maxHealth: number;
      isDead: boolean;
      lastPulseAt: number;
      intervalMs: number;
      radius: number;
      healPercent: number;
      factionId: number;
    }> = {}
  ): {
    aura: HealAuraComponent;
    hostPos: PositionComponent;
    hostHealth: HealthComponent;
    hostFaction: FactionComponent;
  } {
    const intervalMs = overrides.intervalMs ?? 1500;
    const lastPulseAt = overrides.lastPulseAt ?? 0;
    const aura = new HealAuraComponent(overrides.radius ?? 180, overrides.healPercent ?? 0.03, intervalMs, lastPulseAt);
    const hostPos = new PositionComponent(100, 100);
    const hostHealth = new HealthComponent(overrides.health ?? 100, overrides.maxHealth ?? 100);
    hostHealth.isDead = overrides.isDead ?? false;
    const hostFaction = new FactionComponent(overrides.factionId ?? 1);
    return { aura, hostPos, hostHealth, hostFaction };
  }

  function makeAlly(
    overrides: Partial<{
      x: number;
      y: number;
      health: number;
      maxHealth: number;
      isDead: boolean;
      factionId: number;
    }> = {}
  ): { allyPos: PositionComponent; allyHealth: HealthComponent; allyFaction: FactionComponent } {
    const allyPos = new PositionComponent(overrides.x ?? 120, overrides.y ?? 100);
    const allyHealth = new HealthComponent(overrides.health ?? 80, overrides.maxHealth ?? 100);
    allyHealth.isDead = overrides.isDead ?? false;
    const allyFaction = new FactionComponent(overrides.factionId ?? 1);
    return { allyPos, allyHealth, allyFaction };
  }

  /**
   * Wire the entity manager: HealAuraComponent query → [hostId]; EnemyTypeComponent
   * query → the provided ally ids. getComponent resolves host + allies by id.
   */
  function wire(
    hostId: number,
    host: ReturnType<typeof makeHost>,
    allies: Array<{ id: number; data: ReturnType<typeof makeAlly> }>
  ): void {
    entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
      if (isComponentType(types[0], HealAuraComponent)) return [hostId];
      if (isComponentType(types[0], EnemyTypeComponent)) return allies.map((a) => a.id);
      return [];
    });
    entityManager.getComponent.and.callFake(
      <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
        if (id === hostId) {
          if (isComponentType(type, HealAuraComponent)) return host.aura as unknown as T;
          if (isComponentType(type, PositionComponent)) return host.hostPos as unknown as T;
          if (isComponentType(type, HealthComponent)) return host.hostHealth as unknown as T;
          if (isComponentType(type, FactionComponent)) return host.hostFaction as unknown as T;
        }
        const ally = allies.find((a) => a.id === id);
        if (ally) {
          if (isComponentType(type, HealthComponent)) return ally.data.allyHealth as unknown as T;
          if (isComponentType(type, PositionComponent)) return ally.data.allyPos as unknown as T;
          if (isComponentType(type, FactionComponent)) return ally.data.allyFaction as unknown as T;
        }
        return undefined;
      }
    );
  }

  describe('pulse gating', () => {
    it('does not pulse if interval has not elapsed', () => {
      const host = makeHost({ lastPulseAt: Date.now() });
      wire(1, host, []);
      service.update(16, entityManager);
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });

    it('pulses and marks lastPulseAt after interval elapses', () => {
      const host = makeHost({ lastPulseAt: Date.now() - 2000 });
      wire(1, host, []);
      const prePulse = Date.now();
      service.update(16, entityManager);
      expect(host.aura.lastPulseAt).toBeGreaterThanOrEqual(prePulse);
    });
  });

  describe('dead host', () => {
    it('does not pulse when host isDead is true', () => {
      const host = makeHost({ isDead: true, lastPulseAt: 0 });
      host.hostHealth.health = 0;
      wire(1, host, []);
      service.update(16, entityManager);
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });
  });

  describe('heal in-radius same-faction ally', () => {
    it('heals an in-radius ally of the same faction', () => {
      const host = makeHost({ lastPulseAt: 0 });
      const ally = makeAlly({ x: 200, y: 100, health: 80, maxHealth: 100, factionId: 1 });
      wire(1, host, [{ id: 2, data: ally }]);
      service.update(16, entityManager);
      expect(ally.allyHealth.health).toBeGreaterThan(80);
      expect(effectFactory.createHealEffect).toHaveBeenCalledOnceWith(ally.allyPos);
    });
  });

  describe('out-of-radius ally', () => {
    it('skips allies outside the aura radius', () => {
      const host = makeHost({ lastPulseAt: 0, radius: 180 });
      const ally = makeAlly({ x: 400, y: 100, health: 80, factionId: 1 }); // 300px away
      wire(1, host, [{ id: 2, data: ally }]);
      service.update(16, entityManager);
      expect(ally.allyHealth.health).toBe(80);
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });
  });

  describe('opposite-faction enemy', () => {
    it('skips enemies of a different faction', () => {
      const host = makeHost({ lastPulseAt: 0, factionId: 1 });
      const ally = makeAlly({ x: 120, y: 100, health: 80, factionId: 2 });
      wire(1, host, [{ id: 2, data: ally }]);
      service.update(16, entityManager);
      expect(ally.allyHealth.health).toBe(80);
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });
  });

  describe('dead ally', () => {
    it('does not heal a dead ally', () => {
      const host = makeHost({ lastPulseAt: 0 });
      const ally = makeAlly({ x: 120, y: 100, health: 0, isDead: true, factionId: 1 });
      wire(1, host, [{ id: 2, data: ally }]);
      service.update(16, entityManager);
      expect(ally.allyHealth.health).toBe(0);
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });
  });

  describe('full-HP ally', () => {
    it('skips allies already at maxHealth', () => {
      const host = makeHost({ lastPulseAt: 0 });
      const ally = makeAlly({ x: 120, y: 100, health: 100, maxHealth: 100, factionId: 1 });
      wire(1, host, [{ id: 2, data: ally }]);
      service.update(16, entityManager);
      expect(ally.allyHealth.health).toBe(100);
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });
  });

  describe('self-heal skip', () => {
    it('does not heal the host entity itself even if the scan returns it', () => {
      const HOST_ID = 1;
      const host = makeHost({ lastPulseAt: 0, health: 80, maxHealth: 100 });
      // The EnemyTypeComponent scan returns the host id too (Sentinels are enemies).
      entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
        if (isComponentType(types[0], HealAuraComponent)) return [HOST_ID];
        if (isComponentType(types[0], EnemyTypeComponent)) return [HOST_ID];
        return [];
      });
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === HOST_ID) {
            if (isComponentType(type, HealAuraComponent)) return host.aura as unknown as T;
            if (isComponentType(type, PositionComponent)) return host.hostPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return host.hostHealth as unknown as T;
            if (isComponentType(type, FactionComponent)) return host.hostFaction as unknown as T;
          }
          return undefined;
        }
      );
      service.update(16, entityManager);
      expect(host.hostHealth.health).toBe(80); // unchanged — host skipped
      expect(effectFactory.createHealEffect).not.toHaveBeenCalled();
    });
  });

  describe('heal cap at maxHealth', () => {
    it('caps ally health at maxHealth even when healPercent overshoots', () => {
      const host = makeHost({ lastPulseAt: 0, healPercent: 0.5 });
      const ally = makeAlly({ x: 120, y: 100, health: 90, maxHealth: 100, factionId: 1 });
      wire(1, host, [{ id: 2, data: ally }]);
      service.update(16, entityManager);
      expect(ally.allyHealth.health).toBe(100); // 90 + 50 capped at 100
    });
  });

  describe('multiple allies', () => {
    it('heals every eligible same-faction in-radius ally in one pulse', () => {
      const host = makeHost({ lastPulseAt: 0 });
      const a1 = makeAlly({ x: 120, y: 100, health: 50, factionId: 1 });
      const a2 = makeAlly({ x: 100, y: 140, health: 60, factionId: 1 });
      wire(1, host, [
        { id: 2, data: a1 },
        { id: 3, data: a2 },
      ]);
      service.update(16, entityManager);
      expect(a1.allyHealth.health).toBeGreaterThan(50);
      expect(a2.allyHealth.health).toBeGreaterThan(60);
      expect(effectFactory.createHealEffect).toHaveBeenCalledTimes(2);
    });
  });
});
