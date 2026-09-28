import { TestBed } from '@angular/core/testing';
import { VelocityMatrixSystemService } from './velocity-matrix-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { CombatEvent, CombatSystemService } from '../combat';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { BuffComponent, PlayerControlledComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { Component, ComponentType } from '../../ecs/ecs.model';
import { Subject } from 'rxjs';

describe('VelocityMatrixSystemService', () => {
  let service: VelocityMatrixSystemService;
  let mockEntityManager: jasmine.SpyObj<EntityManagerService>;
  let mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockCombatSystem: jasmine.SpyObj<CombatSystemService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;

  let combatSubject: Subject<CombatEvent>;
  let playerId: number;
  let testBuff: BuffComponent;
  let testVelocity: VelocityComponent;
  let testPosition: PositionComponent;

  beforeEach(() => {
    // Create mocks
    combatSubject = new Subject();

    mockEntityManager = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'addComponent',
      'hasComponent',
    ]);

    mockPlayerUpgrades = jasmine.createSpyObj('PlayerUpgradesService', ['hasVelocityMatrix']);

    mockCombatSystem = jasmine.createSpyObj('CombatSystemService', [], {
      combat$: combatSubject.asObservable(),
    });

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Set default return values
    playerId = 1;
    mockEntityManager.getEntitiesWithComponents.and.callFake((componentType: ComponentType<Component>) => {
      if (componentType === PlayerControlledComponent) {
        return [playerId];
      }
      return [];
    });
    mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(false);

    // Create test components
    testBuff = new BuffComponent();
    testVelocity = new VelocityComponent(100, 100); // Moving at 100 units/s diagonally
    testPosition = new PositionComponent(500, 500);

    // Use type assertion since mock returns union type but method expects generic T
    (mockEntityManager.getComponent as jasmine.Spy).and.callFake(
      <T extends Component>(_entity: number, componentType: ComponentType<T>): T | undefined => {
        const ct = componentType as any;
        if (ct === BuffComponent) return testBuff as unknown as T;
        if (ct === VelocityComponent) return testVelocity as unknown as T;
        if (ct === PositionComponent) return testPosition as unknown as T;
        return undefined;
      }
    );

    TestBed.configureTestingModule({
      providers: [
        VelocityMatrixSystemService,
        { provide: EntityManagerService, useValue: mockEntityManager },
        { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
        { provide: CombatSystemService, useValue: mockCombatSystem },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    service = TestBed.inject(VelocityMatrixSystemService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('update', () => {
    it('should not update when Velocity Matrix is not active', () => {
      // Arrange
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(false);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(mockEntityManager.getEntitiesWithComponents).not.toHaveBeenCalled();
    });

    it('should not update when no player entity exists', () => {
      // Arrange
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);
      mockEntityManager.getEntitiesWithComponents.and.returnValue([]);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(mockEntityManager.getComponent).not.toHaveBeenCalled();
    });
  });

  describe('Kill-to-Speed bonus', () => {
    beforeEach(() => {
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);
    });

    it('should add speed bonus on player kill', () => {
      // Arrange
      const killEvent: CombatEvent = {
        attackerId: 0, // Player ID
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      };

      // Act - Trigger a kill
      combatSubject.next(killEvent);
      service.update(16, mockEntityManager);

      // Assert - Speed multiplier should be increased
      expect(testBuff.speedMultiplier).toBeGreaterThan(1.0);
    });

    it('should stack speed bonuses up to maximum', () => {
      // Arrange
      const killEvent: CombatEvent = {
        attackerId: 0,
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      };

      // Act - Trigger multiple kills
      for (let i = 0; i < 15; i++) {
        // More than max stacks (10)
        combatSubject.next({ ...killEvent, defenderId: i } as CombatEvent);
      }
      service.update(16, mockEntityManager);

      // Assert - Should be capped at max stacks (10 * 5% = 50% bonus)
      expect(testBuff.speedMultiplier).toBeCloseTo(1.5, 2);
    });

    it('should expire speed bonuses after duration', () => {
      // Arrange
      const startTime = Date.now();
      const dateNowSpy = spyOn(Date, 'now').and.returnValue(startTime);

      const killEvent: CombatEvent = {
        attackerId: 0,
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: startTime,
      };

      // Act - Trigger a kill
      combatSubject.next(killEvent);
      service.update(16, mockEntityManager);
      const initialSpeed = testBuff.speedMultiplier;

      // Fast-forward time (simulate 3+ seconds passing)
      dateNowSpy.and.returnValue(startTime + 3100);

      service.update(16, mockEntityManager);

      // Assert - Speed bonus should expire
      expect(testBuff.speedMultiplier).toBeLessThan(initialSpeed);
    });

    it('should not add speed bonus for non-player kills', () => {
      // Arrange
      const killEvent: CombatEvent = {
        attackerId: 5, // Not the player
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      };

      // Act
      combatSubject.next(killEvent);
      service.update(16, mockEntityManager);

      // Assert - No speed bonus
      expect(testBuff.speedMultiplier).toBe(1.0);
    });
  });

  describe('Movement-to-Damage bonus', () => {
    beforeEach(() => {
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);
    });

    it('should apply damage bonus based on velocity', () => {
      // Arrange
      testVelocity.vx = 200;
      testVelocity.vy = 0; // Moving at 200 units/s

      // Act
      service.update(16, mockEntityManager);

      // Assert - Damage multiplier should increase
      expect(testBuff.damageMultiplier).toBeGreaterThan(1.0);
    });

    it('should apply no damage bonus when stationary', () => {
      // Arrange
      testVelocity.vx = 0;
      testVelocity.vy = 0; // Not moving

      // Act
      service.update(16, mockEntityManager);

      // Assert - No damage bonus
      expect(testBuff.damageMultiplier).toBe(1.0);
    });

    it('should cap damage bonus at maximum', () => {
      // Arrange
      testVelocity.vx = 1000;
      testVelocity.vy = 1000; // Very fast movement

      // Act
      service.update(16, mockEntityManager);

      // Assert - Should be capped at max (100% bonus)
      expect(testBuff.damageMultiplier).toBeLessThanOrEqual(2.0);
    });

    it('should smooth velocity over multiple frames', () => {
      // Arrange - Start moving fast
      testVelocity.vx = 500;
      testVelocity.vy = 0;
      service.update(16, mockEntityManager);
      const firstBonus = testBuff.damageMultiplier;

      // Act - Sudden stop
      testVelocity.vx = 0;
      testVelocity.vy = 0;
      service.update(16, mockEntityManager);

      // Assert - Should not drop immediately (smoothing)
      expect(testBuff.damageMultiplier).toBeGreaterThan(1.0);
      expect(testBuff.damageMultiplier).toBeLessThan(firstBonus);
    });

    it('should add velocity_matrix buff flag', () => {
      // Arrange - Need to trigger a kill to add the buff flag
      // (buff flag is added in updateSpeedBonus, not updateDamageBonus)
      testVelocity.vx = 100;
      testVelocity.vy = 100;

      // First update to cache the player ID in the service
      service.update(16, mockEntityManager);

      // Trigger a kill event to add speed stacks (which also adds the buff flag)
      // Use attackerId: 0 as the service caches player ID from first update
      combatSubject.next({
        attackerId: playerId, // playerId is 1, which matches getPlayerId() after update
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      });

      // Act - Second update to process the kill bonus
      service.update(16, mockEntityManager);

      // Assert
      expect(testBuff.hasBuff('velocity_matrix')).toBe(true);
    });
  });

  describe('Feedback loop synergy', () => {
    beforeEach(() => {
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);
    });

    it('should maintain both bonuses simultaneously', () => {
      // Arrange - Get a kill for speed bonus
      const killEvent: CombatEvent = {
        attackerId: 0,
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      };

      combatSubject.next(killEvent);

      // Set velocity for damage bonus
      testVelocity.vx = 150;
      testVelocity.vy = 150;

      // Act
      service.update(16, mockEntityManager);

      // Assert - Both bonuses should be active
      expect(testBuff.speedMultiplier).toBeGreaterThan(1.0);
      expect(testBuff.damageMultiplier).toBeGreaterThan(1.0);
    });
  });

  describe('getCurrentBonuses', () => {
    it('should return current bonus state', () => {
      // Arrange
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);

      // Add some kills
      const killEvent: CombatEvent = {
        attackerId: 0,
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      };

      combatSubject.next(killEvent);
      combatSubject.next({ ...killEvent, defenderId: 11 } as CombatEvent);

      // Set movement
      testVelocity.vx = 100;
      testVelocity.vy = 100;

      // Act
      service.update(16, mockEntityManager);
      const bonuses = service.getCurrentBonuses();

      // Assert
      expect(bonuses.stacks).toBe(2);
      expect(bonuses.speedBonus).toBeGreaterThan(0);
      expect(bonuses.damageBonus).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should clear all bonuses on reset', () => {
      // Arrange - Build up some bonuses
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);

      const killEvent: CombatEvent = {
        attackerId: 0,
        defenderId: 10,
        damage: 50,
        damageType: 'beam',
        isCritical: false,
        isKill: true,
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      };

      combatSubject.next(killEvent);
      testVelocity.vx = 200;
      testVelocity.vy = 0;
      service.update(16, mockEntityManager);

      // Act
      service.reset();
      const bonuses = service.getCurrentBonuses();

      // Assert
      expect(bonuses.speedBonus).toBe(0);
      expect(bonuses.damageBonus).toBe(0);
      expect(bonuses.stacks).toBe(0);
    });
  });

  describe('Component creation', () => {
    it('should create buff component if it does not exist', () => {
      // Arrange
      mockPlayerUpgrades.hasVelocityMatrix.and.returnValue(true);
      // Use type assertion since mock returns union type but method expects generic T
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake(
        <T extends Component>(_entity: number, componentType: ComponentType<T>): T | undefined => {
          const ct = componentType as any;
          if (ct === BuffComponent) return undefined; // No buff component
          if (ct === VelocityComponent) return testVelocity as unknown as T;
          if (ct === PositionComponent) return testPosition as unknown as T;
          return undefined;
        }
      );

      testVelocity.vx = 100;
      testVelocity.vy = 100;

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(mockEntityManager.addComponent).toHaveBeenCalledWith(playerId, jasmine.any(BuffComponent));
    });
  });
});
