import { TestBed } from '@angular/core/testing';
import { TeleportSystemService } from './teleport-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { Component, ComponentType } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import {
  InvincibilityComponent,
  PositionComponent,
  RenderableComponent,
  TeleportEffectComponent,
} from '@photon/components';

function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  if (componentType === componentClass) return true;
  if (typeof componentType !== 'function' || typeof componentClass !== 'function') return false;
  return componentType.name === componentClass.name;
}

describe('TeleportSystemService', () => {
  let service: TeleportSystemService;
  let entityManager: jasmine.SpyObj<EntityManagerService>;

  beforeEach(() => {
    const entityManagerSpy = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'removeComponent',
      'addComponent',
    ]);
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', ['createBeamImpact']);

    TestBed.configureTestingModule({
      providers: [
        TeleportSystemService,
        { provide: EntityManagerService, useValue: entityManagerSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
      ],
    });

    service = TestBed.inject(TeleportSystemService);
    entityManager = TestBed.inject(EntityManagerService) as jasmine.SpyObj<EntityManagerService>;
  });

  describe('entity with completed TeleportEffectComponent', () => {
    const ENTITY_ID = 42;

    function buildComponents(overrides: {
      startOffset?: number; // ms in the past relative to now
      durationMs?: number;
      arrived?: boolean;
    }): {
      tp: TeleportEffectComponent;
      pos: PositionComponent;
      renderable: RenderableComponent;
      invincibility: InvincibilityComponent;
    } {
      const durationMs = overrides.durationMs ?? 250;
      const startOffset = overrides.startOffset ?? durationMs + 50; // default: already complete
      const tp = new TeleportEffectComponent(
        500, // targetX
        300, // targetY
        Date.now() - startOffset,
        durationMs,
        0.9, // originalOpacity
        overrides.arrived ?? false
      );
      const pos = new PositionComponent(0, 0);
      const renderable = new RenderableComponent('enemy');
      renderable.opacity = 0;
      const invincibility = new InvincibilityComponent();
      return { tp, pos, renderable, invincibility };
    }

    it('snaps position to targetX / targetY after duration elapses', () => {
      const { tp, pos, renderable, invincibility } = buildComponents({});

      entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
        if (isComponentType(types[0], TeleportEffectComponent)) return [ENTITY_ID];
        return [];
      });
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, TeleportEffectComponent)) return tp as unknown as T;
          if (isComponentType(type, PositionComponent)) return pos as unknown as T;
          if (isComponentType(type, RenderableComponent)) return renderable as unknown as T;
          if (isComponentType(type, InvincibilityComponent)) return invincibility as unknown as T;
          return undefined;
        }
      );

      service.update(16, entityManager);

      expect(pos.x).toBe(500);
      expect(pos.y).toBe(300);
    });

    it('restores RenderableComponent opacity to originalOpacity', () => {
      const { tp, pos, renderable, invincibility } = buildComponents({});

      entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
        if (isComponentType(types[0], TeleportEffectComponent)) return [ENTITY_ID];
        return [];
      });
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, TeleportEffectComponent)) return tp as unknown as T;
          if (isComponentType(type, PositionComponent)) return pos as unknown as T;
          if (isComponentType(type, RenderableComponent)) return renderable as unknown as T;
          if (isComponentType(type, InvincibilityComponent)) return invincibility as unknown as T;
          return undefined;
        }
      );

      service.update(16, entityManager);

      expect(renderable.opacity).toBe(0.9);
    });

    it('removes InvincibilityComponent after arrival', () => {
      const { tp, pos, renderable, invincibility } = buildComponents({});

      entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
        if (isComponentType(types[0], TeleportEffectComponent)) return [ENTITY_ID];
        return [];
      });
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, TeleportEffectComponent)) return tp as unknown as T;
          if (isComponentType(type, PositionComponent)) return pos as unknown as T;
          if (isComponentType(type, RenderableComponent)) return renderable as unknown as T;
          if (isComponentType(type, InvincibilityComponent)) return invincibility as unknown as T;
          return undefined;
        }
      );

      service.update(16, entityManager);

      const removeCallArgs = entityManager.removeComponent.calls.allArgs();
      const removedInvincibility = removeCallArgs.some(
        ([id, type]) => id === ENTITY_ID && isComponentType(type, InvincibilityComponent)
      );
      expect(removedInvincibility).toBeTrue();
    });

    it('removes TeleportEffectComponent after arrival (no double-snap)', () => {
      const { tp, pos, renderable, invincibility } = buildComponents({});

      entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
        if (isComponentType(types[0], TeleportEffectComponent)) return [ENTITY_ID];
        return [];
      });
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, TeleportEffectComponent)) return tp as unknown as T;
          if (isComponentType(type, PositionComponent)) return pos as unknown as T;
          if (isComponentType(type, RenderableComponent)) return renderable as unknown as T;
          if (isComponentType(type, InvincibilityComponent)) return invincibility as unknown as T;
          return undefined;
        }
      );

      service.update(16, entityManager);

      const removeCallArgs = entityManager.removeComponent.calls.allArgs();
      const removedTeleport = removeCallArgs.some(
        ([id, type]) => id === ENTITY_ID && isComponentType(type, TeleportEffectComponent)
      );
      expect(removedTeleport).toBeTrue();
      expect(tp.arrived).toBeTrue();
    });
  });

  describe('entity without TeleportEffectComponent', () => {
    it('is untouched when no teleport entities exist', () => {
      entityManager.getEntitiesWithComponents.and.returnValue([]);

      service.update(16, entityManager);

      expect(entityManager.getComponent).not.toHaveBeenCalled();
      expect(entityManager.removeComponent).not.toHaveBeenCalled();
    });
  });

  describe('blink still in progress', () => {
    it('does not snap position before duration elapses', () => {
      const ENTITY_ID = 7;
      // startTime = now → not complete
      const tp = new TeleportEffectComponent(500, 300, Date.now(), 250, 1.0, false);
      const pos = new PositionComponent(10, 20);
      const renderable = new RenderableComponent('enemy');
      renderable.opacity = 0;

      entityManager.getEntitiesWithComponents.and.callFake((...types: Array<ComponentType>) => {
        if (isComponentType(types[0], TeleportEffectComponent)) return [ENTITY_ID];
        return [];
      });
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, TeleportEffectComponent)) return tp as unknown as T;
          if (isComponentType(type, PositionComponent)) return pos as unknown as T;
          if (isComponentType(type, RenderableComponent)) return renderable as unknown as T;
          return undefined;
        }
      );

      service.update(16, entityManager);

      // Position should be unchanged
      expect(pos.x).toBe(10);
      expect(pos.y).toBe(20);
      expect(entityManager.removeComponent).not.toHaveBeenCalled();
    });
  });
});
