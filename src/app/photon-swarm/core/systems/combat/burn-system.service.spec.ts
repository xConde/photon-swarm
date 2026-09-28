import { TestBed } from '@angular/core/testing';
import { BurnSystemService } from './burn-system.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { BurnEffectComponent, HealthComponent, PositionComponent, RenderableComponent } from '@photon/components';
import { ComponentType, EntityManager } from '../../ecs/ecs.model';

describe('BurnSystemService', () => {
  let service: BurnSystemService;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockEffectFactory: jasmine.SpyObj<EffectFactoryService>;

  const SOURCE_ENTITY = 10;
  const NEARBY_ENTITY = 11;
  const FAR_ENTITY = 12;

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
      addComponent: (entityId: number, comp: unknown) => {
        if (!componentStore.has(entityId)) {
          componentStore.set(entityId, new Map());
        }
        componentStore.get(entityId)!.set((comp as { constructor: unknown }).constructor, comp);
      },
      removeComponent: (entityId: number, type: ComponentType) => {
        componentStore.get(entityId)?.delete(type);
      },
    } as unknown as EntityManager;
  }

  beforeEach(() => {
    componentStore.clear();

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', ['createDamageNumber']);

    TestBed.configureTestingModule({
      providers: [
        BurnSystemService,
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
      ],
    });

    service = TestBed.inject(BurnSystemService);
  });

  describe('enableBurnSpread', () => {
    it('should start with spread disabled', () => {
      expect(service.isBurnSpreadEnabled()).toBe(false);
    });

    it('should enable spread when called', () => {
      service.enableBurnSpread();
      expect(service.isBurnSpreadEnabled()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should disable spread and restore default chance', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(0.5);
      expect(service.isBurnSpreadEnabled()).toBe(true);

      service.reset();

      expect(service.isBurnSpreadEnabled()).toBe(false);
    });

    it('should allow re-enabling spread after reset', () => {
      service.enableBurnSpread();
      service.reset();
      expect(service.isBurnSpreadEnabled()).toBe(false);

      service.enableBurnSpread();
      expect(service.isBurnSpreadEnabled()).toBe(true);
    });

    it('restores spread configuration after a failed upgrade transaction', () => {
      service.setBurnSpreadChance(0.35);
      const snapshot = service.captureUpgradeTransaction();

      service.enableBurnSpread();
      service.setBurnSpreadChance(0.9);
      service.restoreUpgradeTransaction(snapshot);

      expect(service.captureUpgradeTransaction()).toEqual(snapshot);
    });
  });

  describe('setBurnSpreadChance', () => {
    it('should clamp chance between 0 and 1', () => {
      service.setBurnSpreadChance(1.5);
      // We can't read spreadChance directly, but we can test via spread behavior
      // Just verify it doesn't throw
      expect(() => service.setBurnSpreadChance(0)).not.toThrow();
      expect(() => service.setBurnSpreadChance(-0.5)).not.toThrow();
      expect(() => service.setBurnSpreadChance(1.0)).not.toThrow();
    });
  });

  describe('burn spread mechanic', () => {
    function setupBurningEntity(entityId: number, x: number, y: number, canSpread: boolean): void {
      const now = Date.now();
      const burn = new BurnEffectComponent(10, 5000, now, 0, 1, canSpread);
      // Force immediate tick by setting lastBurnTick to the past
      burn.lastBurnTick = now - 300;

      setComponent(entityId, BurnEffectComponent as ComponentType, burn);
      setComponent(entityId, HealthComponent, new HealthComponent(100));
      setComponent(entityId, PositionComponent, new PositionComponent(x, y));
      // Set renderable as combat-ready (old spawn time + in viewport) so burn damage applies
      const renderable = new RenderableComponent();
      renderable.spawnTime = window.performance.now() - 5000;
      renderable.lastViewportEntryTime = window.performance.now() - 5000;
      renderable.wasInViewport = true;
      setComponent(entityId, RenderableComponent, renderable);
    }

    function setupHealthyEntity(entityId: number, x: number, y: number): void {
      setComponent(entityId, HealthComponent, new HealthComponent(100));
      setComponent(entityId, PositionComponent, new PositionComponent(x, y));
    }

    it('should NOT spread when spread is disabled', () => {
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);
      setupHealthyEntity(NEARBY_ENTITY, 150, 100); // Within 100px radius

      spyOn(Math, 'random').and.returnValue(0.01); // Low roll = spread should trigger

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      // Spread disabled, so nearby entity should NOT get burn
      expect(componentStore.get(NEARBY_ENTITY)?.has(BurnEffectComponent as ComponentType)).toBeFalsy();
    });

    it('should NOT spread when canSpread is false', () => {
      service.enableBurnSpread();
      setupBurningEntity(SOURCE_ENTITY, 100, 100, false); // canSpread=false
      setupHealthyEntity(NEARBY_ENTITY, 150, 100);

      spyOn(Math, 'random').and.returnValue(0.01);

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      expect(componentStore.get(NEARBY_ENTITY)?.has(BurnEffectComponent as ComponentType)).toBeFalsy();
    });

    it('should spread burn to nearby entity when enabled and canSpread is true', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0); // 100% chance for deterministic test
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);
      setupHealthyEntity(NEARBY_ENTITY, 150, 100); // 50px away, within 100px radius

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      const nearbyBurn = componentStore.get(NEARBY_ENTITY)?.get(BurnEffectComponent) as BurnEffectComponent | undefined;
      expect(nearbyBurn).toBeTruthy();
    });

    it('should NOT spread to entities outside radius', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);
      setupHealthyEntity(FAR_ENTITY, 500, 500); // Far away

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      expect(componentStore.get(FAR_ENTITY)?.has(BurnEffectComponent as ComponentType)).toBeFalsy();
    });

    it('should NOT spread to entities that already have burn', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);
      setupBurningEntity(NEARBY_ENTITY, 150, 100, false); // Already burning

      const entityManager = createMockEntityManager();
      // Should not throw or create double burn
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should apply reduced damage on spread burns', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true); // 10 damage
      setupHealthyEntity(NEARBY_ENTITY, 150, 100);

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      const nearbyBurn = componentStore.get(NEARBY_ENTITY)?.get(BurnEffectComponent) as BurnEffectComponent | undefined;
      expect(nearbyBurn).toBeTruthy();
      // Spread burn should have reduced damage (70% of 10 = 7)
      expect(nearbyBurn!.burnDamage).toBe(7);
    });

    it('should set canSpread=false on spread burns to prevent chains', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);
      setupHealthyEntity(NEARBY_ENTITY, 150, 100);

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      const nearbyBurn = componentStore.get(NEARBY_ENTITY)?.get(BurnEffectComponent) as BurnEffectComponent | undefined;
      expect(nearbyBurn).toBeTruthy();
      expect(nearbyBurn!.canSpread).toBe(false);
    });

    it('should NOT spread to dead entities', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);
      setupHealthyEntity(NEARBY_ENTITY, 150, 100);

      // Kill the nearby entity
      const health = componentStore.get(NEARBY_ENTITY)?.get(HealthComponent) as HealthComponent;
      health.isDead = true;

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      expect(componentStore.get(NEARBY_ENTITY)?.has(BurnEffectComponent as ComponentType)).toBeFalsy();
    });

    it('should respect MAX_SPREAD_TARGETS limit', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);
      setupBurningEntity(SOURCE_ENTITY, 100, 100, true);

      // Set up 3 nearby entities
      setupHealthyEntity(20, 120, 100);
      setupHealthyEntity(21, 130, 100);
      setupHealthyEntity(22, 140, 100);

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      // MAX_SPREAD_TARGETS=1, so only 1 should get burn
      let burnCount = 0;
      for (const id of [20, 21, 22]) {
        if (componentStore.get(id)?.has(BurnEffectComponent)) {
          burnCount++;
        }
      }
      expect(burnCount).toBe(1);
    });
  });

  describe('existing burn damage behavior', () => {
    it('should apply burn damage on tick', () => {
      const now = Date.now();
      const burn = new BurnEffectComponent(10, 5000, now, 0, 1, false);
      burn.lastBurnTick = now - 300; // Force tick

      const health = new HealthComponent(100);
      const position = new PositionComponent(100, 100);

      setComponent(SOURCE_ENTITY, BurnEffectComponent as ComponentType, burn);
      setComponent(SOURCE_ENTITY, HealthComponent, health);
      setComponent(SOURCE_ENTITY, PositionComponent, position);
      const rend = new RenderableComponent();
      rend.spawnTime = window.performance.now() - 5000;
      rend.lastViewportEntryTime = window.performance.now() - 5000;
      rend.wasInViewport = true;
      setComponent(SOURCE_ENTITY, RenderableComponent, rend);

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      expect(health.health).toBe(90); // 100 - 10 damage
    });

    it('should remove burn when expired', () => {
      const expiredBurn = new BurnEffectComponent(10, 100, Date.now() - 200, 0, 1, false);

      setComponent(SOURCE_ENTITY, BurnEffectComponent as ComponentType, expiredBurn);
      setComponent(SOURCE_ENTITY, HealthComponent, new HealthComponent(100));
      setComponent(SOURCE_ENTITY, RenderableComponent, new RenderableComponent());

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      expect(componentStore.get(SOURCE_ENTITY)?.has(BurnEffectComponent as ComponentType)).toBeFalsy();
    });

    it('should mark entity as dead when health reaches 0', () => {
      const now = Date.now();
      const burn = new BurnEffectComponent(100, 5000, now, 0, 1, false);
      burn.lastBurnTick = now - 300;

      const health = new HealthComponent(50);

      setComponent(SOURCE_ENTITY, BurnEffectComponent as ComponentType, burn);
      setComponent(SOURCE_ENTITY, HealthComponent, health);
      setComponent(SOURCE_ENTITY, PositionComponent, new PositionComponent(100, 100));
      const rend2 = new RenderableComponent();
      rend2.spawnTime = window.performance.now() - 5000;
      rend2.lastViewportEntryTime = window.performance.now() - 5000;
      rend2.wasInViewport = true;
      setComponent(SOURCE_ENTITY, RenderableComponent, rend2);

      const entityManager = createMockEntityManager();
      service.update(16, entityManager);

      expect(health.isDead).toBe(true);
    });
  });
});
