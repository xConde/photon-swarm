import { TestBed } from '@angular/core/testing';
import { AIBehaviorSystemService } from './ai-behavior-system.service';
import { ComponentType, EntityManager } from '../../ecs/ecs.model';
import {
  AIControlledComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  WeaponComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { AI_BEHAVIOR_CONFIG } from '@photon/config/constants/enemy/ai-behavior.config';

// Private access interface for testing internal state
interface AIBehaviorSystemTestAccess {
  playerPosition: { x: number; y: number } | null;
  behaviorUpdateCounter: number;
  BEHAVIOR_UPDATE_INTERVAL: number;
  DIRECTION_SMOOTHING: number;
  updatePlayerPosition(entityManager: EntityManager): void;
  updateTargetBasedBehavior(
    entityId: number,
    ai: AIControlledComponent,
    position: PositionComponent,
    entityManager: EntityManager
  ): void;
  updatePlayerBasedBehavior(
    entityId: number,
    ai: AIControlledComponent,
    position: PositionComponent,
    entityManager: EntityManager
  ): void;
  applyBehaviorPattern(
    entityId: number,
    ai: AIControlledComponent,
    dx: number,
    dy: number,
    distance: number,
    entityManager: EntityManager
  ): void;
  handleWeaponFiring(
    entityId: number,
    ai: AIControlledComponent,
    position: PositionComponent,
    entityManager: EntityManager
  ): void;
  findNearbyAllies(entityId: number, range: number, entityManager: EntityManager): number[];
  smoothUpdateDirection(ai: AIControlledComponent, targetX: number, targetY: number): void;
}

// Helper to create a mock EntityManager with component storage
function createMockEntityManager(): jasmine.SpyObj<EntityManager> & {
  _components: Map<number, Map<ComponentType, unknown>>;
} {
  const componentStore = new Map<number, Map<ComponentType, unknown>>();

  const em = jasmine.createSpyObj('EntityManager', [
    'getEntitiesWithComponents',
    'getComponent',
    'addComponent',
    'createEntity',
    'destroyEntity',
    'removeComponent',
    'hasComponent',
    'hasEntity',
    'getComponents',
  ]) as jasmine.SpyObj<EntityManager> & {
    _components: Map<number, Map<ComponentType, unknown>>;
  };

  em._components = componentStore;

  em.getComponent.and.callFake(((entityId: number, componentType: ComponentType) => {
    const entityComponents = componentStore.get(entityId);
    if (!entityComponents) return undefined;
    return entityComponents.get(componentType);
  }) as (...args: unknown[]) => any);

  em.addComponent.and.callFake((entityId: number, component: unknown) => {
    if (!componentStore.has(entityId)) {
      componentStore.set(entityId, new Map());
    }
    componentStore.get(entityId)!.set(component!.constructor as ComponentType, component);
  });

  em.getEntitiesWithComponents.and.callFake((...componentTypes: ComponentType[]) => {
    const result: number[] = [];
    for (const [entityId, components] of componentStore) {
      if (componentTypes.every((type) => components.has(type))) {
        result.push(entityId);
      }
    }
    return result;
  });

  return em;
}

// Helper to add an AI entity with all required components
function addAIEntity(
  em: ReturnType<typeof createMockEntityManager>,
  entityId: number,
  options: {
    x?: number;
    y?: number;
    behavior?: BehaviorPattern;
    detectionRange?: number;
    movementSeed?: number;
    enemyType?: string;
    withWeapon?: boolean;
    weaponFireRate?: number;
    weaponLastShot?: number;
  } = {}
): { ai: AIControlledComponent; position: PositionComponent; weapon?: WeaponComponent } {
  const position = new PositionComponent(options.x ?? 100, options.y ?? 100);
  const ai = new AIControlledComponent(
    options.behavior ?? BehaviorPattern.Direct,
    undefined,
    options.detectionRange ?? 300,
    undefined,
    0,
    options.movementSeed ?? 0.5
  );
  const enemyType = new EnemyTypeComponent(options.enemyType ?? 'basic');

  em._components.set(
    entityId,
    new Map<ComponentType, unknown>([
      [PositionComponent, position],
      [AIControlledComponent, ai],
      [EnemyTypeComponent, enemyType],
    ])
  );

  let weapon: WeaponComponent | undefined;
  if (options.withWeapon) {
    weapon = new WeaponComponent(
      10, // damage
      options.weaponFireRate ?? 1000, // fireRate
      options.weaponLastShot ?? 0 // lastShotTime
    );
    em._components.get(entityId)!.set(WeaponComponent, weapon);
  }

  return { ai, position, weapon };
}

// Helper to add a player entity
function addPlayerEntity(
  em: ReturnType<typeof createMockEntityManager>,
  entityId: number,
  x: number,
  y: number
): PositionComponent {
  const position = new PositionComponent(x, y);
  const player = new PlayerControlledComponent();
  em._components.set(
    entityId,
    new Map<ComponentType, unknown>([
      [PositionComponent, position],
      [PlayerControlledComponent, player],
    ])
  );
  return position;
}

describe('AIBehaviorSystemService', () => {
  let service: AIBehaviorSystemService;
  let serviceTest: AIBehaviorSystemTestAccess;
  let entityManager: ReturnType<typeof createMockEntityManager>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AIBehaviorSystemService],
    });

    service = TestBed.inject(AIBehaviorSystemService);
    serviceTest = service as unknown as AIBehaviorSystemTestAccess;
    entityManager = createMockEntityManager();

    // Suppress debug logging in tests
    (window as unknown as Record<string, unknown>)['debugLogBridge'] = undefined;
  });

  // =========================================================================
  // Initialization
  // =========================================================================
  describe('initialization', () => {
    it('should create the service', () => {
      expect(service).toBeTruthy();
    });

    it('should initialize with null player position', () => {
      expect(serviceTest.playerPosition).toBeNull();
    });

    it('should use config update interval', () => {
      expect(serviceTest.BEHAVIOR_UPDATE_INTERVAL).toBe(AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL);
    });

    it('should init with entity manager reference', () => {
      service.init(entityManager);
      expect(service._entityManager).toBe(entityManager);
    });
  });

  // =========================================================================
  // Update throttling
  // =========================================================================
  describe('update throttling', () => {
    it('should skip updates until interval is reached', () => {
      addPlayerEntity(entityManager, 1, 500, 500);
      const { ai } = addAIEntity(entityManager, 10, { x: 400, y: 400 });

      // Call update for each interval frame minus 1 — no behavior change expected
      for (let i = 0; i < AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL - 1; i++) {
        service.update(16, entityManager);
      }
      // wanderDirection should still be undefined (no behavior applied yet)
      expect(ai.wanderDirection).toBeUndefined();
    });

    it('should process on the Nth frame', () => {
      addPlayerEntity(entityManager, 1, 500, 500);
      const { ai } = addAIEntity(entityManager, 10, { x: 400, y: 400 });

      for (let i = 0; i < AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL; i++) {
        service.update(16, entityManager);
      }
      // After enough frames, behavior should have set wanderDirection
      expect(ai.wanderDirection).toBeDefined();
    });

    it('should reset counter after processing', () => {
      addPlayerEntity(entityManager, 1, 500, 500);
      addAIEntity(entityManager, 10, { x: 400, y: 400 });

      // Run through two full cycles
      for (let i = 0; i < AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL * 2; i++) {
        service.update(16, entityManager);
      }
      expect(serviceTest.behaviorUpdateCounter).toBe(0);
    });
  });

  // =========================================================================
  // Player position tracking
  // =========================================================================
  describe('updatePlayerPosition', () => {
    it('should find player entity and cache position', () => {
      addPlayerEntity(entityManager, 1, 250, 750);

      serviceTest.updatePlayerPosition(entityManager);

      expect(serviceTest.playerPosition).toEqual({ x: 250, y: 750 });
    });

    it('should keep null when no player exists', () => {
      serviceTest.updatePlayerPosition(entityManager);
      expect(serviceTest.playerPosition).toBeNull();
    });
  });

  // =========================================================================
  // Target-based behavior
  // =========================================================================
  describe('updateTargetBasedBehavior', () => {
    it('should clear targetEntityId when target has no position', () => {
      const { ai, position } = addAIEntity(entityManager, 10, { behavior: BehaviorPattern.Direct });
      ai.targetEntityId = 20; // non-existent entity

      serviceTest.updateTargetBasedBehavior(10, ai, position, entityManager);

      expect(ai.targetEntityId).toBeUndefined();
    });

    it('should clear target when out of double detection range', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Direct,
        detectionRange: 100,
      });
      ai.targetEntityId = 20;
      // Place target very far away (more than 2x detection range = 200)
      const targetPos = new PositionComponent(500, 500);
      entityManager._components.set(20, new Map([[PositionComponent, targetPos]]));

      serviceTest.updateTargetBasedBehavior(10, ai, position, entityManager);

      expect(ai.targetEntityId).toBeUndefined();
    });

    it('should apply behavior pattern when target is within range', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Direct,
        detectionRange: 500,
      });
      ai.targetEntityId = 20;
      const targetPos = new PositionComponent(100, 0);
      entityManager._components.set(20, new Map([[PositionComponent, targetPos]]));

      serviceTest.updateTargetBasedBehavior(10, ai, position, entityManager);

      // Direct behavior should set wanderDirection toward target
      expect(ai.wanderDirection).toBeDefined();
    });
  });

  // =========================================================================
  // Player-based behavior
  // =========================================================================
  describe('updatePlayerBasedBehavior', () => {
    it('should do nothing when player position is null', () => {
      const { ai, position } = addAIEntity(entityManager, 10);
      serviceTest.playerPosition = null;

      serviceTest.updatePlayerBasedBehavior(10, ai, position, entityManager);

      expect(ai.wanderDirection).toBeUndefined();
    });

    it('should switch to wander when player is out of detection range', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Direct,
        detectionRange: 100,
      });
      serviceTest.playerPosition = { x: 500, y: 500 }; // far away

      serviceTest.updatePlayerBasedBehavior(10, ai, position, entityManager);

      expect(ai.behaviorPattern).toBe(BehaviorPattern.Wander);
    });

    it('should not switch idle to wander', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Idle,
        detectionRange: 100,
      });
      serviceTest.playerPosition = { x: 500, y: 500 };

      serviceTest.updatePlayerBasedBehavior(10, ai, position, entityManager);

      expect(ai.behaviorPattern).toBe(BehaviorPattern.Idle);
    });

    it('should not re-assign Wander when already Wander and player out of range', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Wander,
        detectionRange: 100,
      });
      ai.originalBehaviorPattern = BehaviorPattern.Direct; // Was direct, switched to wander
      ai.behaviorPattern = BehaviorPattern.Wander;
      serviceTest.playerPosition = { x: 500, y: 500 }; // far away

      serviceTest.updatePlayerBasedBehavior(10, ai, position, entityManager);

      // Guard at line 126: already Wander, so no redundant re-assignment
      expect(ai.behaviorPattern).toBe(BehaviorPattern.Wander);
    });

    it('should restore original behavior when player returns in range', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Flank,
        detectionRange: 500,
      });
      // Simulate having been switched to wander
      ai.behaviorPattern = BehaviorPattern.Wander;
      ai.originalBehaviorPattern = BehaviorPattern.Flank;
      serviceTest.playerPosition = { x: 50, y: 50 }; // close

      serviceTest.updatePlayerBasedBehavior(10, ai, position, entityManager);

      expect(ai.behaviorPattern).toBe(BehaviorPattern.Flank);
    });

    it('should not restore wander if original was wander', () => {
      const { ai, position } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        behavior: BehaviorPattern.Wander,
        detectionRange: 500,
      });
      ai.originalBehaviorPattern = BehaviorPattern.Wander;
      serviceTest.playerPosition = { x: 50, y: 50 };

      serviceTest.updatePlayerBasedBehavior(10, ai, position, entityManager);

      expect(ai.behaviorPattern).toBe(BehaviorPattern.Wander);
    });
  });

  // =========================================================================
  // Behavior Patterns
  // =========================================================================
  describe('applyBehaviorPattern', () => {
    describe('Idle', () => {
      it('should not set wanderDirection', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Idle);

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeUndefined();
      });
    });

    describe('Direct', () => {
      it('should set direction toward target when far', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Direct, undefined, 300, undefined, 0, 0.5);

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeGreaterThan(0); // toward target (+x)
      });

      it('should add orbit component when close (surrounding behavior)', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Direct, undefined, 300, undefined, 0, 0.3);

        // distance < SURROUND_DISTANCE (80)
        serviceTest.applyBehaviorPattern(10, ai, 30, 0, 30, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Should have tangential component (y ≠ 0) when movementSeed < 0.5 (counter-clockwise)
        expect(Math.abs(ai.wanderDirection!.y)).toBeGreaterThan(0);
      });

      it('should use movementSeed to determine orbit direction', () => {
        const aiClockwise = new AIControlledComponent(BehaviorPattern.Direct, undefined, 300, undefined, 0, 0.7);
        const aiCounter = new AIControlledComponent(BehaviorPattern.Direct, undefined, 300, undefined, 0, 0.3);

        serviceTest.applyBehaviorPattern(10, aiClockwise, 30, 0, 30, entityManager);
        serviceTest.applyBehaviorPattern(11, aiCounter, 30, 0, 30, entityManager);

        // Different seeds should produce different orbit directions
        expect(aiClockwise.wanderDirection!.y).not.toBe(aiCounter.wanderDirection!.y);
      });

      it('should not set direction when distance is 0', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Direct);

        serviceTest.applyBehaviorPattern(10, ai, 0, 0, 0, entityManager);

        expect(ai.wanderDirection).toBeUndefined();
      });
    });

    describe('Aggressive', () => {
      it('should boost speed via aggression factor', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Aggressive, undefined, 300, undefined, 0, 0.5);

        // At distance 200, aggressionBoost = max(1, 1.5 - 200/400) = max(1, 1.0) = 1.0
        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeGreaterThan(0);
      });

      it('should have higher aggression when close', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Aggressive, undefined, 300, undefined, 0, 0.5);

        // At distance 100, aggressionBoost = max(1, 1.5 - 100/400) = 1.25
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // The wanderDirection magnitude reflects aggressionBoost > 1
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeGreaterThan(1.0);
      });

      it('should add orbit when within surround distance', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Aggressive, undefined, 300, undefined, 0, 0.7);

        // distance < 60 (aggressive surround distance)
        serviceTest.applyBehaviorPattern(10, ai, 30, 0, 30, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(Math.abs(ai.wanderDirection!.y)).toBeGreaterThan(0);
      });
    });

    describe('Aggressive — thug enrage one-shot', () => {
      function addHealthComponent(
        em: ReturnType<typeof createMockEntityManager>,
        entityId: number,
        current: number,
        max: number
      ): HealthComponent {
        const health = new HealthComponent(current, max, 0);
        em._components.get(entityId)!.set(HealthComponent, health);
        return health;
      }

      it('triggers enrage when health drops below 40%', () => {
        const { ai } = addAIEntity(entityManager, 10, { behavior: BehaviorPattern.Aggressive });
        addHealthComponent(entityManager, 10, 29, 75); // 29/75 = 38.7% < 40%

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.enrageTriggered).toBeTrue();
        expect(ai.isCharging).toBeTrue(); // charging state gives renderer the red tint
      });

      it('does NOT trigger enrage when health is above 40%', () => {
        const { ai } = addAIEntity(entityManager, 10, { behavior: BehaviorPattern.Aggressive });
        addHealthComponent(entityManager, 10, 40, 75); // 40/75 = 53.3% > 40%

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.enrageTriggered).toBeFalse();
        expect(ai.isCharging).toBeFalse();
      });

      it('never re-triggers once enrageTriggered is true', () => {
        const { ai } = addAIEntity(entityManager, 10, { behavior: BehaviorPattern.Aggressive });
        addHealthComponent(entityManager, 10, 10, 75); // well below threshold
        ai.enrageTriggered = true; // already triggered
        ai.isCharging = false; // burst already ended

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        // Should NOT restart isCharging
        expect(ai.isCharging).toBeFalse();
      });

      it('ends the burst after 2000ms', () => {
        const { ai } = addAIEntity(entityManager, 10, { behavior: BehaviorPattern.Aggressive });
        addHealthComponent(entityManager, 10, 10, 75);
        ai.enrageTriggered = true;
        ai.isCharging = true;
        ai.chargeStartTime = Date.now() - 2500; // 2500ms ago > 2000ms window

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.isCharging).toBeFalse();
      });

      it('aiVisualState is charging during the enrage burst', () => {
        const { ai } = addAIEntity(entityManager, 10, { behavior: BehaviorPattern.Aggressive });
        addHealthComponent(entityManager, 10, 20, 75);

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.aiVisualState).toBe('charging');
      });
    });

    describe('Wander', () => {
      it('should set random direction when none exists', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Wander, undefined, 300, undefined, 0, 0.5);
        ai.wanderDirection = undefined;

        serviceTest.applyBehaviorPattern(10, ai, 0, 0, 0, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.lastMovementChange).toBeGreaterThan(0);
      });

      it('should update direction after wander interval expires', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Wander, undefined, 300, undefined, 0, 0.5);
        ai.wanderDirection = { x: 1, y: 0 };
        // Set lastMovementChange far in the past
        ai.lastMovementChange = Date.now() - 10000;

        serviceTest.applyBehaviorPattern(10, ai, 0, 0, 0, entityManager);

        // Direction should have changed (new random angle)
        expect(ai.lastMovementChange).toBeGreaterThan(Date.now() - 1000);
      });

      it('should use movementSeed for per-entity interval variation', () => {
        // Wander interval = 2500 + movementSeed * 1000
        const ai = new AIControlledComponent(BehaviorPattern.Wander, undefined, 300, undefined, 0, 1.0);
        ai.wanderDirection = { x: 1, y: 0 };
        // 2500 + 1.0 * 1000 = 3500ms interval
        ai.lastMovementChange = Date.now() - 3000; // 3000ms ago — not yet expired for seed=1.0

        serviceTest.applyBehaviorPattern(10, ai, 0, 0, 0, entityManager);

        // Should NOT have changed yet (3000 < 3500)
        expect(ai.wanderDirection).toEqual({ x: 1, y: 0 });
      });
    });

    describe('Retreat', () => {
      it('should retreat quickly when too close', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Retreat);

        // distance=100 < threshold=200: fast retreat
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Retreating means moving in opposite direction (-x)
        expect(ai.wanderDirection!.x).toBeLessThan(0);
      });

      it('should slow retreat at medium distance', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Retreat);

        // distance=250, between threshold (200) and threshold*1.5 (300)
        serviceTest.applyBehaviorPattern(10, ai, 250, 0, 250, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Slow retreat: direction * 0.3
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.3, 1);
      });

      it('should preserve wander direction at safe distance when interval not expired', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Retreat);
        ai.wanderDirection = { x: 0.1, y: -0.15 };
        ai.lastMovementChange = Date.now() - 500; // 500ms ago — within 2000ms interval

        // distance=400 > threshold*1.5 (300): hold position branch
        serviceTest.applyBehaviorPattern(10, ai, 400, 0, 400, entityManager);

        // Should NOT change (wanderDirection exists AND interval not expired)
        expect(ai.wanderDirection).toEqual({ x: 0.1, y: -0.15 });
      });

      it('should hold position at safe distance', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Retreat);
        ai.wanderDirection = undefined;

        // distance=400 > threshold*1.5 (300): hold position with wander
        serviceTest.applyBehaviorPattern(10, ai, 400, 0, 400, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.2, 1);
      });
    });

    describe('Flank', () => {
      it('should change direction after flank interval', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Flank, undefined, 300, undefined, 0, 0.5);
        ai.lastMovementChange = Date.now() - 5000; // Long ago

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.lastMovementChange).toBeGreaterThan(Date.now() - 1000);
      });

      it('should preserve direction when interval has not expired', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Flank, undefined, 300, undefined, 0, 0.5);
        ai.wanderDirection = { x: 0.5, y: 0.8 };
        ai.lastMovementChange = Date.now() - 100; // 100ms ago — well within flank interval

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        // Direction should be unchanged (interval not expired)
        expect(ai.wanderDirection).toEqual({ x: 0.5, y: 0.8 });
      });

      it('should apply perpendicular angle (±90°)', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Flank, undefined, 300, undefined, 0, 0.5);
        ai.lastMovementChange = Date.now() - 5000;

        // Target at +x direction
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Flanking adds ±π/2, so y component should be significant
        expect(Math.abs(ai.wanderDirection!.y)).toBeGreaterThan(0.5);
      });
    });

    describe('Orbit', () => {
      it('should move tangentially at preferred distance', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Orbit);

        // At distance 200 (preferred orbit distance)
        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Tangent to +x direction is ±y
        expect(Math.abs(ai.wanderDirection!.y)).toBeGreaterThan(0.5);
      });

      it('should add radial-out component when too close', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Orbit);

        // distance=100 < 200*0.8=160: too close, should push out
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // radialComponent = -0.3 means moving away (negative dx direction from target)
        // Since target is in +x, moving away means -x component
        expect(ai.wanderDirection!.x).toBeLessThan(0);
      });

      it('should add radial-in component when too far', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Orbit);

        // distance=300 > 200*1.2=240: too far, should approach
        serviceTest.applyBehaviorPattern(10, ai, 300, 0, 300, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // radialComponent = 0.3 means approaching
        expect(ai.wanderDirection!.x).toBeGreaterThan(0);
      });
    });

    describe('Ranged', () => {
      it('should retreat when too close', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Ranged, undefined, 300, undefined, 0, 0.5);

        // distance=100 < 300*0.7=210: retreat
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Retreating from +x target means -x direction
        expect(ai.wanderDirection!.x).toBeLessThan(0);
      });

      it('should approach slowly when too far', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Ranged);

        // distance=500 > 300*1.3=390: approach
        serviceTest.applyBehaviorPattern(10, ai, 500, 0, 500, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeGreaterThan(0);
        // Approach at 0.5 speed
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.5, 1);
      });

      it('should include strafe oscillation in retreat direction', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(2000)); // strafeOffset = sin(2000*0.0008 + 0.5*5) * 0.3 ≈ -0.245
        const ai = new AIControlledComponent(BehaviorPattern.Ranged, undefined, 300, undefined, 0, 0.5);

        // distance=100 < 300*0.7=210: retreat with strafe
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);
        jasmine.clock().uninstall();

        expect(ai.wanderDirection).toBeDefined();
        // Retreat direction is primarily -x, but strafe offset adds y perturbation
        expect(ai.wanderDirection!.x).toBeLessThan(0);
        // strafeOffset ≈ -0.245 → retreat angle ≈ PI-0.245 → sin(2.896) ≈ 0.24
        expect(Math.abs(ai.wanderDirection!.y)).toBeGreaterThan(0.1);
      });

      it('should strafe at preferred distance', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Ranged, undefined, 300, undefined, 0, 0.5);

        // distance=300 is in preferred range [210, 390]
        serviceTest.applyBehaviorPattern(10, ai, 300, 0, 300, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Strafing perpendicular to target
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.4, 1);
      });
    });

    describe('Sniper', () => {
      it('should fast retreat when way too close', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Sniper);

        // distance=200 < 500*0.6=300: fast retreat
        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeLessThan(0);
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(1.2, 1);
      });

      it('should slow retreat at medium-close distance', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Sniper);

        // distance=350, between 500*0.6=300 and 500*0.8=400
        serviceTest.applyBehaviorPattern(10, ai, 350, 0, 350, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeLessThan(0);
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.5, 1);
      });

      it('should approach when too far', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Sniper);

        // distance=700 > 500*1.2=600: approach
        serviceTest.applyBehaviorPattern(10, ai, 700, 0, 700, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeGreaterThan(0);
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.3, 1);
      });

      it('should minimally strafe at optimal range', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Sniper);

        // distance=500, in optimal range [400, 600]
        serviceTest.applyBehaviorPattern(10, ai, 500, 0, 500, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.15, 1);
      });
    });

    describe('Charger', () => {
      it('should start wind-up phase when charge interval expires', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Charger, undefined, 300, undefined, 0, 0.5);
        ai.lastMovementChange = Date.now() - 4000; // 4s ago > 3500ms interval

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.isCharging).toBe(false); // Wind-up, not charging yet
        expect(ai.chargeTargetDirection).toBeDefined();
        expect(ai.wanderDirection).toBeDefined();
        // Wind-up speed is 0.2x of charge direction
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.2, 1);
      });

      it('should continue wind-up phase without re-triggering start', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Charger, undefined, 300, undefined, 0, 0.5);
        // lastMovementChange was 300ms ago (within 600ms wind-up, but NOT past chargeInterval)
        ai.lastMovementChange = Date.now() - 300;
        ai.chargeTargetDirection = { x: 1, y: 0 };
        ai.chargeStartTime = ai.lastMovementChange;

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.isCharging).toBe(false); // Still in wind-up, not charging
        // Wind-up: 0.2x of charge target direction
        expect(ai.wanderDirection!.x).toBeCloseTo(0.2, 1);
        expect(ai.wanderDirection!.y).toBeCloseTo(0, 1);
      });

      it('should charge fast after wind-up phase', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Charger, undefined, 300, undefined, 0, 0.5);
        // Set up mid-charge: lastMovementChange was 700ms ago (past 600ms wind-up)
        ai.lastMovementChange = Date.now() - 700;
        ai.chargeTargetDirection = { x: 1, y: 0 };
        ai.chargeStartTime = ai.lastMovementChange;

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.isCharging).toBe(true);
        expect(ai.wanderDirection).toBeDefined();
        // Charge at 2.5x speed
        expect(ai.wanderDirection!.x).toBeCloseTo(2.5, 1);
      });

      it('should enter recovery after charge', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Charger, undefined, 300, undefined, 0, 0.5);
        // Recovery phase: lastMovementChange was 2500ms ago (past 600+1400=2000ms)
        ai.lastMovementChange = Date.now() - 2500;
        ai.chargeTargetDirection = { x: 1, y: 0 };

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.isCharging).toBe(false);
        expect(ai.chargeTargetDirection).toBeUndefined();
        // Recovery: slow tracking at 0.3x
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.3, 1);
      });
    });

    describe('Swarm', () => {
      it('should move toward target with speed boost', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Swarm, undefined, 300, undefined, 0, 0.5);

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Swarm has 1.2x speed multiplier
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeGreaterThan(1.0);
      });

      it('should add surround behavior when close', () => {
        const ai = new AIControlledComponent(BehaviorPattern.Swarm, undefined, 300, undefined, 0, 0.7);

        // distance < SURROUND_DISTANCE (100 for swarm)
        serviceTest.applyBehaviorPattern(10, ai, 50, 0, 50, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Should have tangential component
        expect(Math.abs(ai.wanderDirection!.y)).toBeGreaterThan(0);
      });
    });

    describe('Grouping', () => {
      // findNearbyAllies always returns [] (group cohesion disabled — no shared
      // spatial index is populated in the game loop). All Grouping enemies therefore
      // fall through to the "no allies nearby" branch and chase the target directly.

      it('should chase target directly (no allies — group cohesion disabled)', () => {
        const { ai } = addAIEntity(entityManager, 10, {
          x: 0,
          y: 0,
          behavior: BehaviorPattern.Grouping,
        });

        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        expect(ai.wanderDirection!.x).toBeGreaterThan(0);
      });

      it('should chase target in positive-x direction when dx is positive', () => {
        const { ai } = addAIEntity(entityManager, 10, {
          x: 0,
          y: 0,
          behavior: BehaviorPattern.Grouping,
        });

        // dx=100, dy=0 → atan2(0,100)=0 → cos=1, sin=0
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection!.x).toBeCloseTo(1, 5);
        expect(ai.wanderDirection!.y).toBeCloseTo(0, 5);
      });

      it('should produce unit-length direction toward target', () => {
        const { ai } = addAIEntity(entityManager, 10, {
          x: 0,
          y: 0,
          behavior: BehaviorPattern.Grouping,
        });

        serviceTest.applyBehaviorPattern(10, ai, 60, 80, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(1, 5);
      });
    });

    describe('Boss', () => {
      // phaseInterval = 9000 + 0.5 * 2000 = 10000 (with movementSeed=0.5)
      // phase = Math.floor(Date.now() / 10000) % 4
      // Phase 0 = Aggressive, 1 = Orbit, 2 = Retreat, 3 = Ranged

      afterEach(() => {
        jasmine.clock().uninstall();
      });

      it('should not change behaviorPattern from Boss regardless of phase', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(5000)); // Phase 0
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.behaviorPattern).toBe(BehaviorPattern.Boss);
      });

      it('should apply Aggressive sub-behavior (phase 0) with 1.5x speed', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(5000)); // 5000/10000=0.5 → floor=0 → Aggressive
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Aggressive: angle = atan2(0, 200) = 0, cos(0) * 1.5 = 1.5
        expect(ai.wanderDirection!.x).toBeCloseTo(1.5, 1);
        expect(ai.wanderDirection!.y).toBeCloseTo(0, 1);
      });

      it('should apply Orbit sub-behavior (phase 1) with tangential movement', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(15000)); // 15000/10000=1.5 → floor=1 → Orbit
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        serviceTest.applyBehaviorPattern(10, ai, 200, 0, 200, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Orbit: tangent = atan2(0,200) + PI/2 = PI/2, cos(PI/2) ≈ 0, sin(PI/2) ≈ 1
        expect(ai.wanderDirection!.x).toBeCloseTo(0, 0);
        expect(ai.wanderDirection!.y).toBeCloseTo(1, 0);
      });

      it('should apply Retreat sub-behavior (phase 2) when close (< 300)', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(25000)); // 25000/10000=2.5 → floor=2 → Retreat
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        // distance=100 < 300: retreat
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Retreat: angle = atan2(0,100) + PI = PI, cos(PI) = -1
        expect(ai.wanderDirection!.x).toBeCloseTo(-1, 0);
      });

      it('should apply Retreat sub-behavior (phase 2) with orbit when far (>= 300)', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(25000)); // Phase 2 → Retreat
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        // distance=400 >= 300: orbit while retreating at 0.5x
        serviceTest.applyBehaviorPattern(10, ai, 400, 0, 400, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.5, 1);
      });

      it('should apply Ranged sub-behavior (phase 3) back-off when too close (< 250)', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(35000)); // 35000/10000=3.5 → floor=3 → Ranged
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        // distance=100 < 250: back off
        serviceTest.applyBehaviorPattern(10, ai, 100, 0, 100, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Back off: angle = atan2(0,100) + PI = PI, cos(PI) * 0.5 = -0.5
        expect(ai.wanderDirection!.x).toBeCloseTo(-0.5, 1);
      });

      it('should apply Ranged sub-behavior (phase 3) approach when too far (> 350)', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(35000)); // Phase 3 → Ranged
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        // distance=500 > 350: approach
        serviceTest.applyBehaviorPattern(10, ai, 500, 0, 500, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        // Approach: cos(atan2(0,500)) * 0.3 = cos(0) * 0.3 = 0.3
        expect(ai.wanderDirection!.x).toBeCloseTo(0.3, 1);
      });

      it('should apply Ranged sub-behavior (phase 3) strafe at optimal range (250-350)', () => {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(35000)); // Phase 3 → Ranged
        const ai = new AIControlledComponent(BehaviorPattern.Boss, undefined, 300, undefined, 0, 0.5);

        // distance=300, in [250, 350]: strafe slowly
        serviceTest.applyBehaviorPattern(10, ai, 300, 0, 300, entityManager);

        expect(ai.wanderDirection).toBeDefined();
        const mag = Math.sqrt(ai.wanderDirection!.x ** 2 + ai.wanderDirection!.y ** 2);
        expect(mag).toBeCloseTo(0.2, 1);
      });
    });
  });

  // =========================================================================
  // Weapon firing
  // =========================================================================
  describe('handleWeaponFiring', () => {
    it('should skip entities without weapon component', () => {
      const { ai, position } = addAIEntity(entityManager, 10);
      serviceTest.playerPosition = { x: 200, y: 100 };

      // Should not throw — verifies early return when no weapon
      serviceTest.handleWeaponFiring(10, ai, position, entityManager);
      expect(true).toBe(true);
    });

    it('should set readyToFire for non-sniper in range and off cooldown', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000, // 2s ago — off cooldown
      });
      serviceTest.playerPosition = { x: 200, y: 100 }; // 100px away, within 500 range

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(true);
      expect(weapon!.isAiming).toBe(false);
    });

    it('should not fire when out of range', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      serviceTest.playerPosition = { x: 1000, y: 1000 }; // Far away

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(false);
    });

    it('should not fire when on cooldown', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 500, // 500ms ago — still on cooldown
      });
      serviceTest.playerPosition = { x: 200, y: 100 };

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(false);
    });

    it('should set targetDirection when in range', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      serviceTest.playerPosition = { x: 200, y: 100 }; // +x direction

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.targetDirection).toBeDefined();
      expect(weapon!.targetDirection!.x).toBeCloseTo(1, 1);
      expect(weapon!.targetDirection!.y).toBeCloseTo(0, 1);
    });

    it('should start aiming telegraph for snipers', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        behavior: BehaviorPattern.Sniper,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      serviceTest.playerPosition = { x: 200, y: 100 };

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.isAiming).toBe(true);
      expect(weapon!.readyToFire).toBe(false);
      expect(weapon!.aimDuration).toBe(800);
    });

    it('should fire sniper after aiming completes', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        behavior: BehaviorPattern.Sniper,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      // Simulate aim already in progress and complete
      weapon!.isAiming = true;
      weapon!.aimStartTime = now - 900; // 900ms > 800ms aim duration
      weapon!.aimDuration = 800;
      serviceTest.playerPosition = { x: 200, y: 100 };

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(true);
      expect(weapon!.isAiming).toBe(false);
    });

    it('should use target entity position when targetEntityId is set', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      ai.targetEntityId = 20;
      const targetPos = new PositionComponent(200, 100);
      entityManager._components.set(20, new Map([[PositionComponent, targetPos]]));

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(true);
      expect(weapon!.targetDirection).toBeDefined();
    });

    it('should not fire when target entity has no position', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      ai.targetEntityId = 20; // non-existent entity
      serviceTest.playerPosition = { x: 200, y: 100 };

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(false);
    });

    it('should return early when no target entity and no player position', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      ai.targetEntityId = undefined;
      serviceTest.playerPosition = null;

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      // Should not set any weapon state (early return at line 615)
      expect(weapon!.readyToFire).toBe(false);
      expect(weapon!.targetDirection).toBeUndefined();
    });

    it('should use sniper telegraph for wandering sniper (originalBehaviorPattern)', () => {
      const now = Date.now();
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        behavior: BehaviorPattern.Wander, // Currently wandering
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });
      ai.originalBehaviorPattern = BehaviorPattern.Sniper; // Originally a sniper
      serviceTest.playerPosition = { x: 200, y: 100 };

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      // Should use sniper aiming telegraph despite current Wander pattern
      expect(weapon!.isAiming).toBe(true);
      expect(weapon!.readyToFire).toBe(false);
      expect(weapon!.aimDuration).toBe(800);
    });

    it('should clear aim/readyToFire when out of range', () => {
      const { ai, position, weapon } = addAIEntity(entityManager, 10, {
        x: 0,
        y: 0,
        withWeapon: true,
      });
      weapon!.readyToFire = true;
      weapon!.isAiming = true;
      serviceTest.playerPosition = { x: 1000, y: 1000 };

      serviceTest.handleWeaponFiring(10, ai, position, entityManager);

      expect(weapon!.readyToFire).toBe(false);
      expect(weapon!.isAiming).toBe(false);
    });
  });

  // =========================================================================
  // Ally finding
  // =========================================================================
  describe('findNearbyAllies', () => {
    // Group cohesion is currently disabled: findNearbyAllies always returns []
    // because no shared spatial index is populated in the game loop.
    // These tests document the current (intentional) behavior.

    it('should always return empty array (group cohesion disabled)', () => {
      addAIEntity(entityManager, 10, { x: 100, y: 100, enemyType: 'basic' });
      addAIEntity(entityManager, 20, { x: 120, y: 100, enemyType: 'basic' });

      const result = serviceTest.findNearbyAllies(10, 150, entityManager);

      expect(result).toEqual([]);
    });

    it('should return empty array regardless of entity setup', () => {
      entityManager._components.set(10, new Map());
      const result = serviceTest.findNearbyAllies(10, 150, entityManager);
      expect(result).toEqual([]);
    });

    it('should return empty array for any range value', () => {
      addAIEntity(entityManager, 10, { x: 0, y: 0, enemyType: 'basic' });
      addAIEntity(entityManager, 20, { x: 1, y: 1, enemyType: 'basic' });

      expect(serviceTest.findNearbyAllies(10, 9999, entityManager)).toEqual([]);
    });
  });

  // =========================================================================
  // Smooth direction updates
  // =========================================================================
  describe('smoothUpdateDirection', () => {
    it('should snap to target when no existing direction', () => {
      const ai = new AIControlledComponent(BehaviorPattern.Direct);
      ai.wanderDirection = undefined;

      serviceTest.smoothUpdateDirection(ai, 1.0, 0.5);

      expect(ai.wanderDirection!.x).toBeCloseTo(1.0, 5);
      expect(ai.wanderDirection!.y).toBeCloseTo(0.5, 5);
    });

    it('should lerp toward target when direction exists', () => {
      const ai = new AIControlledComponent(BehaviorPattern.Direct);
      ai.wanderDirection = { x: 0, y: 0 };

      serviceTest.smoothUpdateDirection(ai, 1.0, 0);

      // Lerp: 0 + (1.0 - 0) * 0.5 = 0.5
      expect(ai.wanderDirection.x).toBeCloseTo(0.5, 2);
      expect(ai.wanderDirection.y).toBeCloseTo(0, 2);
    });

    it('should converge after multiple updates', () => {
      const ai = new AIControlledComponent(BehaviorPattern.Direct);
      ai.wanderDirection = { x: 0, y: 0 };

      // Apply many times to converge
      for (let i = 0; i < 20; i++) {
        serviceTest.smoothUpdateDirection(ai, 1.0, 0);
      }

      expect(ai.wanderDirection.x).toBeCloseTo(1.0, 2);
    });
  });

  // =========================================================================
  // Destroy / cleanup
  // =========================================================================
  describe('destroy', () => {
    it('should null out player position', () => {
      serviceTest.playerPosition = { x: 100, y: 200 };

      service.destroy();

      expect(serviceTest.playerPosition).toBeNull();
    });
  });

  // =========================================================================
  // Integration: full update cycle
  // =========================================================================
  describe('full update cycle', () => {
    it('should process all AI entities in a single cycle', () => {
      addPlayerEntity(entityManager, 1, 500, 500);
      const { ai: ai1 } = addAIEntity(entityManager, 10, { x: 400, y: 400 });
      const { ai: ai2 } = addAIEntity(entityManager, 20, { x: 600, y: 600, behavior: BehaviorPattern.Ranged });
      const { ai: ai3 } = addAIEntity(entityManager, 30, { x: 300, y: 300, behavior: BehaviorPattern.Orbit });

      // Run enough frames to trigger update
      for (let i = 0; i < AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL; i++) {
        service.update(16, entityManager);
      }

      // All enemies should have wanderDirection set
      expect(ai1.wanderDirection).toBeDefined();
      expect(ai2.wanderDirection).toBeDefined();
      expect(ai3.wanderDirection).toBeDefined();
    });

    it('should route target-based entities to target behavior', () => {
      addPlayerEntity(entityManager, 1, 500, 500);
      const { ai } = addAIEntity(entityManager, 10, { x: 400, y: 400 });
      ai.targetEntityId = 20;
      const targetPos = new PositionComponent(450, 450);
      entityManager._components.set(20, new Map([[PositionComponent, targetPos]]));

      for (let i = 0; i < AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL; i++) {
        service.update(16, entityManager);
      }

      // Should have moved toward target entity, not player
      expect(ai.wanderDirection).toBeDefined();
    });

    it('should handle weapon firing during update', () => {
      const now = Date.now();
      addPlayerEntity(entityManager, 1, 200, 100);
      const { weapon } = addAIEntity(entityManager, 10, {
        x: 100,
        y: 100,
        withWeapon: true,
        weaponFireRate: 1000,
        weaponLastShot: now - 2000,
      });

      for (let i = 0; i < AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL; i++) {
        service.update(16, entityManager);
      }

      expect(weapon!.readyToFire).toBe(true);
    });
  });
});
