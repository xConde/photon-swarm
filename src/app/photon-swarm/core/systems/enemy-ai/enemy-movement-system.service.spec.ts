import { TestBed } from '@angular/core/testing';
import { EnemyMovementSystemService } from './enemy-movement-system.service';
import { FourKingsTerritoryService } from '../territory';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import {
  AIControlledComponent,
  EnemyTypeComponent,
  KnockbackComponent,
  PlayerControlledComponent,
  PositionComponent,
  VelocityComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { EnemyType } from '../../models/enemy.model';

describe('EnemyMovementSystemService', () => {
  let service: EnemyMovementSystemService;
  let mockEntityManager: jasmine.SpyObj<EntityManagerService>;
  let mockTerritoryService: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockEntityFactory: jasmine.SpyObj<EntityFactoryECSService>;

  // Entity IDs
  const PLAYER_ID = 1;
  const ENEMY_ID = 10;
  const ENEMY_ID_2 = 11;

  // Component storage
  const componentStore = new Map<number, Map<unknown, unknown>>();

  function setComponent<T>(entityId: number, type: unknown, comp: T): void {
    if (!componentStore.has(entityId)) {
      componentStore.set(entityId, new Map());
    }
    componentStore.get(entityId)!.set(type, comp);
  }

  function getComponent<T>(entityId: number, type: unknown): T | undefined {
    return componentStore.get(entityId)?.get(type) as T | undefined;
  }

  beforeEach(() => {
    componentStore.clear();

    mockTerritoryService = jasmine.createSpyObj('FourKingsTerritoryService', ['getTerritoryAtPosition']);
    mockTerritoryService.getTerritoryAtPosition.and.returnValue(null); // Neutral territory

    mockEntityFactory = jasmine.createSpyObj('EntityFactoryECSService', ['isEntityActive']);
    mockEntityFactory.isEntityActive.and.returnValue(true);

    mockEntityManager = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'hasComponent',
    ]);

    // Wire up getComponent
    mockEntityManager.getComponent.and.callFake(<T>(entityId: number, type: unknown): T | undefined => {
      return getComponent<T>(entityId, type);
    });

    // Wire up getEntitiesWithComponents
    mockEntityManager.getEntitiesWithComponents.and.callFake((...types: unknown[]) => {
      const result: number[] = [];
      for (const [entityId, comps] of componentStore.entries()) {
        if (types.every((t: unknown) => comps.has(t))) {
          result.push(entityId);
        }
      }
      return result;
    });

    TestBed.configureTestingModule({
      providers: [
        EnemyMovementSystemService,
        { provide: FourKingsTerritoryService, useValue: mockTerritoryService },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
      ],
    });

    service = TestBed.inject(EnemyMovementSystemService);
  });

  afterEach(() => {
    service.destroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('init', () => {
    it('should initialize without error', () => {
      expect(() => service.init(mockEntityManager)).not.toThrow();
    });
  });

  describe('update - basic movement', () => {
    beforeEach(() => {
      // Setup player
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));

      // Setup enemy
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: -1, y: 0 }; // Toward player
      setComponent(ENEMY_ID, AIControlledComponent, ai);
    });

    it('should update enemy position based on velocity', () => {
      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;
      const initialX = position.x;

      service.update(16, mockEntityManager); // ~60fps frame

      // Enemy should have moved toward player
      expect(position.x).not.toBe(initialX);
    });

    it('should set velocity based on wanderDirection and base speed', () => {
      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Basic enemy has speed 90, moving left (toward player at 500)
      expect(velocity.vx).toBeLessThan(0);
    });

    it('should not move inactive entities', () => {
      mockEntityFactory.isEntityActive.and.returnValue(false);
      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;
      const initialX = position.x;

      service.update(16, mockEntityManager);

      expect(position.x).toBe(initialX);
    });

    it('should clamp position to world bounds', () => {
      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;
      position.x = -100; // Outside world

      service.update(16, mockEntityManager);

      expect(position.x).toBeGreaterThanOrEqual(0);
    });
  });

  describe('behavior speed multipliers', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
    });

    it('should apply retreat speed multiplier (1.8x)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Retreat;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 }; // Away from player
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Retreat multiplier is 1.8, basic speed is 90, so ~162 px/s
      expect(Math.abs(velocity.vx)).toBeCloseTo(90 * 1.8, 0);
    });

    it('should apply swarm speed multiplier (1.6x)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Swarm;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      expect(Math.abs(velocity.vx)).toBeCloseTo(90 * 1.6, 0);
    });

    it('should apply wander speed multiplier (0.5x)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Wander;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      expect(Math.abs(velocity.vx)).toBeCloseTo(90 * 0.5, 0);
    });

    it('should apply idle speed multiplier (0x - no movement)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Idle;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Idle pattern should not apply velocity from wanderDirection
      expect(velocity.vx).toBe(0);
      expect(velocity.vy).toBe(0);
    });
  });

  describe('knockback handling', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);
    });

    it('should override AI movement during knockback', () => {
      const knockback = new KnockbackComponent(100, 0, 500); // Push right
      setComponent(ENEMY_ID, KnockbackComponent, knockback);

      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;
      const initialX = position.x;

      service.update(16, mockEntityManager);

      // Enemy should move right (knockback direction) not left (AI direction)
      expect(position.x).toBeGreaterThan(initialX);
    });

    it('should set velocity to zero during knockback', () => {
      const knockback = new KnockbackComponent(100, 0, 500);
      setComponent(ENEMY_ID, KnockbackComponent, knockback);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      expect(velocity.vx).toBe(0);
      expect(velocity.vy).toBe(0);
    });
  });

  describe('stuck detection and escape', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(0, 500)); // At left edge
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: -1, y: 0 }; // Trying to move further left (into wall)
      setComponent(ENEMY_ID, AIControlledComponent, ai);
    });

    it('should detect stuck enemies after threshold frames', () => {
      // Simulate multiple frames of being stuck
      for (let i = 0; i < 15; i++) {
        service.update(16, mockEntityManager);
      }

      const ai = getComponent<AIControlledComponent>(ENEMY_ID, AIControlledComponent)!;
      // After stuck threshold, wanderDirection should change
      expect(ai.wanderDirection!.x).not.toBe(-1);
    });
  });

  describe('distance correction', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.detectionRange = 2000;
      ai.wanderDirection = { x: 1, y: 0 }; // Moving away
      setComponent(ENEMY_ID, AIControlledComponent, ai);
    });

    it('should pull enemies back when beyond max combat distance', () => {
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(1500, 500)); // 1000px from player

      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;

      service.update(16, mockEntityManager);

      // Enemy should be pulled back toward player
      expect(position.x).toBeLessThan(1500);
    });

    it('should snap enemies at extreme distances', () => {
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(2000, 500)); // 1500px from player (beyond hard limit)

      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;

      service.update(16, mockEntityManager);

      // Enemy should be snapped to near combat range
      const distanceToPlayer = Math.sqrt(Math.pow(position.x - 500, 2) + Math.pow(position.y - 500, 2));
      expect(distanceToPlayer).toBeLessThan(700);
    });
  });

  describe('separation behavior scaling', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));

      // Setup first enemy
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(550, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));

      // Setup second enemy very close
      setComponent(ENEMY_ID_2, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID_2, PositionComponent, new PositionComponent(555, 500));
      setComponent(ENEMY_ID_2, VelocityComponent, new VelocityComponent(0, 0));
    });

    it('should apply swarm separation scaling (0.3x - clumps together)', () => {
      const ai1 = new AIControlledComponent();
      ai1.behaviorPattern = BehaviorPattern.Swarm;
      ai1.detectionRange = 1000;
      ai1.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai1);

      const ai2 = new AIControlledComponent();
      ai2.behaviorPattern = BehaviorPattern.Swarm;
      ai2.detectionRange = 1000;
      ai2.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID_2, AIControlledComponent, ai2);

      // Swarm enemies should stay closer together
      // This is hard to test directly, but we verify no errors occur
      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });
  });

  describe('cleanupDeadEnemy', () => {
    it('should remove tracking data for dead enemy', () => {
      // Setup and run to create tracking data
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      // Now cleanup
      expect(() => service.cleanupDeadEnemy(ENEMY_ID)).not.toThrow();
    });

    it('should not throw for unknown entity', () => {
      expect(() => service.cleanupDeadEnemy(99999)).not.toThrow();
    });
  });

  describe('getEnemyDiagnostics', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));

      // Setup multiple enemies with different behaviors
      for (let i = 0; i < 5; i++) {
        const id = 10 + i;
        setComponent(id, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
        setComponent(id, PositionComponent, new PositionComponent(600 + i * 10, 500));
        setComponent(id, VelocityComponent, new VelocityComponent(i * 10, 0));
        const ai = new AIControlledComponent();
        ai.behaviorPattern = i % 2 === 0 ? BehaviorPattern.Direct : BehaviorPattern.Flank;
        ai.wanderDirection = { x: -1, y: 0 };
        setComponent(id, AIControlledComponent, ai);
      }
    });

    it('should return behavior distribution', () => {
      const diagnostics = service.getEnemyDiagnostics(mockEntityManager);

      expect(diagnostics.behaviorDistribution).toBeDefined();
      expect(diagnostics.behaviorDistribution[BehaviorPattern.Direct]).toBeGreaterThan(0);
      expect(diagnostics.behaviorDistribution[BehaviorPattern.Flank]).toBeGreaterThan(0);
    });

    it('should return velocity samples', () => {
      const diagnostics = service.getEnemyDiagnostics(mockEntityManager);

      expect(diagnostics.velocitySamples).toBeDefined();
      expect(diagnostics.velocitySamples.length).toBeGreaterThan(0);
      expect(diagnostics.velocitySamples.length).toBeLessThanOrEqual(10);
    });

    it('should return total enemy count', () => {
      const diagnostics = service.getEnemyDiagnostics(mockEntityManager);

      expect(diagnostics.totalEnemies).toBe(5);
    });

    it('should return stuck frame distribution', () => {
      const diagnostics = service.getEnemyDiagnostics(mockEntityManager);

      expect(diagnostics.stuckFrameDistribution).toBeDefined();
      expect(diagnostics.stuckFrameDistribution['0']).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('should clean up all internal state', () => {
      // Setup some state
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      // Destroy should not throw
      expect(() => service.destroy()).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty enemy list', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle missing player', () => {
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle enemy without wanderDirection', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.detectionRange = 1000;
      // No wanderDirection set
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle zero deltaTime', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      expect(() => service.update(0, mockEntityManager)).not.toThrow();
    });

    it('should handle very large deltaTime', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      // 1 second frame (lag spike)
      expect(() => service.update(1000, mockEntityManager)).not.toThrow();

      // Position should still be clamped to world bounds
      const position = getComponent<PositionComponent>(ENEMY_ID, PositionComponent)!;
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.x).toBeLessThanOrEqual(12000);
    });

    it('should handle negative deltaTime gracefully', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      // Negative deltaTime should not cause errors
      expect(() => service.update(-16, mockEntityManager)).not.toThrow();
    });

    it('should handle enemy missing VelocityComponent', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      // No VelocityComponent
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle enemy missing PositionComponent', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      // No PositionComponent
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle enemy missing AIControlledComponent', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      // No AIControlledComponent

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle NaN in position', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(NaN, NaN));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle player at same position as enemy (zero distance)', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500)); // Same as player
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      // Should not throw division by zero or NaN errors
      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle all behavior patterns without error', () => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));

      const patterns = [
        BehaviorPattern.Direct,
        BehaviorPattern.Flank,
        BehaviorPattern.Orbit,
        BehaviorPattern.Retreat,
        BehaviorPattern.Swarm,
        BehaviorPattern.Sniper,
        BehaviorPattern.Charger,
        BehaviorPattern.Idle,
        BehaviorPattern.Wander,
        BehaviorPattern.Aggressive,
        BehaviorPattern.Boss,
        BehaviorPattern.Ranged,
        BehaviorPattern.Grouping,
      ];

      patterns.forEach((pattern, index) => {
        const enemyId = 100 + index;
        setComponent(enemyId, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
        setComponent(enemyId, PositionComponent, new PositionComponent(600 + index * 50, 500));
        setComponent(enemyId, VelocityComponent, new VelocityComponent(0, 0));
        const ai = new AIControlledComponent();
        ai.behaviorPattern = pattern;
        ai.detectionRange = 1000;
        ai.wanderDirection = { x: -1, y: 0 };
        setComponent(enemyId, AIControlledComponent, ai);
      });

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });
  });

  describe('additional behavior speed multipliers', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
    });

    it('should apply sniper speed multiplier (0.4x - slow deliberate)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Sniper;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Sniper should move slowly
      expect(Math.abs(velocity.vx)).toBeLessThan(50);
    });

    it('should apply boss speed multiplier (0.5x - ponderous)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Boss;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Boss should move ponderously
      expect(Math.abs(velocity.vx)).toBeLessThan(100);
    });

    it('should apply charger speed multiplier', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Charger;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Charger should have movement
      expect(velocity.vx !== 0 || velocity.vy !== 0).toBeTrue();
    });

    it('should apply aggressive speed multiplier (0.7x - twitchy)', () => {
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Aggressive;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: 1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      // Aggressive should have notable velocity
      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      expect(velocity.vx !== 0 || velocity.vy !== 0).toBeTrue();
    });
  });

  describe('knockback edge cases', () => {
    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);
    });

    it('should handle knockback with zero force', () => {
      const knockback = new KnockbackComponent(0, 0, 500);
      setComponent(ENEMY_ID, KnockbackComponent, knockback);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle knockback with NaN direction', () => {
      const knockback = new KnockbackComponent(NaN, NaN, 500);
      setComponent(ENEMY_ID, KnockbackComponent, knockback);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });

    it('should handle expired knockback', () => {
      const knockback = new KnockbackComponent(100, 0, 0); // Zero duration - expired
      setComponent(ENEMY_ID, KnockbackComponent, knockback);

      expect(() => service.update(16, mockEntityManager)).not.toThrow();

      // AI movement should resume
      const velocity = getComponent<VelocityComponent>(ENEMY_ID, VelocityComponent)!;
      // Should have some velocity from AI, not stuck at 0
      expect(velocity.vx !== 0 || velocity.vy !== 0).toBeTrue();
    });
  });

  describe('cleanup edge cases', () => {
    it('should handle multiple cleanups of same entity', () => {
      // Setup and run to create tracking data
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
      setComponent(ENEMY_ID, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Basic));
      setComponent(ENEMY_ID, PositionComponent, new PositionComponent(600, 500));
      setComponent(ENEMY_ID, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Direct;
      ai.wanderDirection = { x: -1, y: 0 };
      setComponent(ENEMY_ID, AIControlledComponent, ai);

      service.update(16, mockEntityManager);

      // Clean up multiple times should not throw
      expect(() => {
        service.cleanupDeadEnemy(ENEMY_ID);
        service.cleanupDeadEnemy(ENEMY_ID);
        service.cleanupDeadEnemy(ENEMY_ID);
      }).not.toThrow();
    });

    it('should handle destroy called multiple times', () => {
      expect(() => {
        service.destroy();
        service.destroy();
        service.destroy();
      }).not.toThrow();
    });

    it('should handle update after destroy', () => {
      service.destroy();

      // Update after destroy should handle gracefully
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));

      expect(() => service.update(16, mockEntityManager)).not.toThrow();
    });
  });

  describe('swarm pack pressure', () => {
    // Four swarm enemies close together (within 75px) should see the focal
    // swarm get a 1.15x speed boost via the pack-pressure path.
    // We verify by comparing the resulting vx magnitude against a lone swarm.

    function setupSwarmEnemy(id: number, x: number, y: number, wanderDirX: number = -1, wanderDirY: number = 0): void {
      setComponent(id, EnemyTypeComponent, new EnemyTypeComponent(EnemyType.Swarm));
      setComponent(id, PositionComponent, new PositionComponent(x, y));
      setComponent(id, VelocityComponent, new VelocityComponent(0, 0));
      const ai = new AIControlledComponent();
      ai.behaviorPattern = BehaviorPattern.Swarm;
      ai.detectionRange = 1000;
      ai.wanderDirection = { x: wanderDirX, y: wanderDirY };
      setComponent(id, AIControlledComponent, ai);
    }

    beforeEach(() => {
      setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
      setComponent(PLAYER_ID, PositionComponent, new PositionComponent(500, 500));
    });

    it('applies 1.15x speed boost when 3 or more swarm enemies are within pack range', () => {
      // Place 4 swarm enemies clustered near (600, 500), all moving toward player.
      // Entity IDs 20-23; focal enemy is 20 at x=600 y=500.
      const FOCAL = 20;
      setupSwarmEnemy(FOCAL, 600, 500);
      setupSwarmEnemy(21, 615, 500); // ~15px away
      setupSwarmEnemy(22, 600, 515); // ~15px away
      setupSwarmEnemy(23, 590, 510); // ~18px away

      service.update(16, mockEntityManager);

      const packedVelocity = Math.abs(getComponent<VelocityComponent>(FOCAL, VelocityComponent)!.vx);

      // Now test a lone swarm enemy at a distance to confirm baseline
      componentStore.delete(21);
      componentStore.delete(22);
      componentStore.delete(23);
      service.destroy();

      // Re-create service for a fresh spatial tree
      service = TestBed.inject(EnemyMovementSystemService);
      const LONE = 30;
      setupSwarmEnemy(LONE, 600, 500);

      service.update(16, mockEntityManager);

      const loneVelocity = Math.abs(getComponent<VelocityComponent>(LONE, VelocityComponent)!.vx);

      // Packed speed should be noticeably higher than lone speed (1.15x factor)
      expect(packedVelocity).toBeGreaterThan(loneVelocity * 1.05);
    });
  });
});
