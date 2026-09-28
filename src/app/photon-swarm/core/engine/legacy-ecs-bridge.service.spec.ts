import { TestBed } from '@angular/core/testing';
import { LegacyEcsBridgeService } from './legacy-ecs-bridge.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import {
  CollisionBoxComponent,
  EnemyType,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  VelocityComponent,
} from '@photon/components';

describe('LegacyEcsBridgeService', () => {
  let service: LegacyEcsBridgeService;
  let entityManagerSpy: jasmine.SpyObj<EntityManagerService>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('EntityManagerService', ['getEntitiesWithComponents', 'getComponent']);

    TestBed.configureTestingModule({
      providers: [LegacyEcsBridgeService, { provide: EntityManagerService, useValue: spy }],
    });

    service = TestBed.inject(LegacyEcsBridgeService);
    entityManagerSpy = TestBed.inject(EntityManagerService) as jasmine.SpyObj<EntityManagerService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('returns an empty array when there are no enemy entities', () => {
    entityManagerSpy.getEntitiesWithComponents.and.returnValue([]);

    expect(service.getEnemies()).toEqual([]);
  });

  it('maps a full ECS enemy entity to the legacy shape', () => {
    entityManagerSpy.getEntitiesWithComponents.and.returnValue([7]);
    entityManagerSpy.getComponent.and.callFake(<T>(_entityId: number, componentType: unknown): T | undefined => {
      if (componentType === PositionComponent) return new PositionComponent(100, 200) as unknown as T;
      if (componentType === VelocityComponent) return new VelocityComponent(1, -1) as unknown as T;
      if (componentType === EnemyTypeComponent) return new EnemyTypeComponent(EnemyType.Tank) as unknown as T;
      if (componentType === HealthComponent) return new HealthComponent(50, 80) as unknown as T;
      if (componentType === CollisionBoxComponent) return new CollisionBoxComponent(30, 'enemy') as unknown as T;
      return undefined;
    });

    const enemies = service.getEnemies();

    expect(enemies).toEqual([
      {
        id: '7',
        x: 100,
        y: 200,
        vx: 1,
        vy: -1,
        radius: 30,
        type: EnemyType.Tank,
        health: 50,
        maxHealth: 80,
      },
    ]);
  });

  it('defaults velocity to 0, radius to 20, and health to 0/100 when those components are missing', () => {
    entityManagerSpy.getEntitiesWithComponents.and.returnValue([3]);
    entityManagerSpy.getComponent.and.callFake(<T>(_entityId: number, componentType: unknown): T | undefined => {
      if (componentType === PositionComponent) return new PositionComponent(5, 6) as unknown as T;
      if (componentType === EnemyTypeComponent) return new EnemyTypeComponent(EnemyType.Swarm) as unknown as T;
      return undefined;
    });

    const [enemy] = service.getEnemies();

    expect(enemy).toEqual({
      id: '3',
      x: 5,
      y: 6,
      vx: 0,
      vy: 0,
      radius: 20,
      type: EnemyType.Swarm,
      health: 0,
      maxHealth: 100,
    });
  });

  it('skips an entity missing PositionComponent or EnemyTypeComponent', () => {
    entityManagerSpy.getEntitiesWithComponents.and.returnValue([1]);
    entityManagerSpy.getComponent.and.returnValue(undefined);

    expect(service.getEnemies()).toEqual([]);
  });
});
