import { TestBed } from '@angular/core/testing';
import { BerserkerSystemService } from './berserker-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameStateService } from '../../state/game-state.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { BuffComponent } from '@photon/components';

describe('BerserkerSystemService', () => {
  let service: BerserkerSystemService;
  let mockEntityManager: jasmine.SpyObj<EntityManagerService>;
  let mockGameState: jasmine.SpyObj<GameStateService>;
  let mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;

  let playerId: number;
  let testBuff: BuffComponent;

  beforeEach(() => {
    // Create mocks
    mockEntityManager = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'addComponent',
      'hasComponent',
    ]);

    mockGameState = jasmine.createSpyObj('GameStateService', ['getHealth', 'getMaxHealth']);

    mockPlayerUpgrades = jasmine.createSpyObj('PlayerUpgradesService', [
      'hasBerserkerProtocol',
      'getBerserkerMaxBonus',
    ]);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Set default return values
    playerId = 1;
    mockEntityManager.getEntitiesWithComponents.and.returnValue([playerId]);
    mockGameState.getMaxHealth.and.returnValue(100);
    mockGameState.getHealth.and.returnValue(100);
    mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(false);
    mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);

    // Create a test buff component
    testBuff = new BuffComponent();
    mockEntityManager.getComponent.and.returnValue(testBuff);

    TestBed.configureTestingModule({
      providers: [
        BerserkerSystemService,
        { provide: EntityManagerService, useValue: mockEntityManager },
        { provide: GameStateService, useValue: mockGameState },
        { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    service = TestBed.inject(BerserkerSystemService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('update', () => {
    it('should not update when Berserker Protocol is not active', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(false);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(mockEntityManager.getEntitiesWithComponents).not.toHaveBeenCalled();
    });

    it('should not update when no player entity exists', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockEntityManager.getEntitiesWithComponents.and.returnValue([]);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(mockEntityManager.getComponent).not.toHaveBeenCalled();
    });

    it('should create buff component if it does not exist', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockEntityManager.getComponent.and.returnValue(undefined);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(mockEntityManager.addComponent).toHaveBeenCalledWith(playerId, jasmine.any(BuffComponent));
    });

    it('should apply no damage bonus at full health', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);
      mockGameState.getHealth.and.returnValue(100); // Full health
      mockGameState.getMaxHealth.and.returnValue(100);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(testBuff.damageMultiplier).toBe(1.0); // No bonus
    });

    it('should apply 50% damage bonus at 50% health', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0); // 100% max bonus
      mockGameState.getHealth.and.returnValue(50); // 50% health
      mockGameState.getMaxHealth.and.returnValue(100);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(testBuff.damageMultiplier).toBeCloseTo(1.5, 2); // 50% bonus
    });

    it('should apply maximum damage bonus at 1 HP', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0); // 100% max bonus
      mockGameState.getHealth.and.returnValue(1); // 1 HP
      mockGameState.getMaxHealth.and.returnValue(100);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(testBuff.damageMultiplier).toBeCloseTo(1.99, 2); // ~100% bonus
    });

    it('should support multiple stack levels', () => {
      // Test stack level 1
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0); // 100% max
      mockGameState.getHealth.and.returnValue(25); // 25% health
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBeCloseTo(1.75, 2); // 75% bonus

      // Test stack level 2
      testBuff.damageMultiplier = 1.0; // Reset
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(2.0); // 200% max
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBeCloseTo(2.5, 2); // 150% bonus

      // Test stack level 3
      testBuff.damageMultiplier = 1.0; // Reset
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(3.0); // 300% max
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBeCloseTo(3.25, 2); // 225% bonus
    });

    it('should add berserker_protocol buff flag', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockGameState.getHealth.and.returnValue(50);

      // Act
      service.update(16, mockEntityManager);

      // Assert
      expect(testBuff.hasBuff('berserker_protocol')).toBe(true);
    });

    it('should update damage multiplier when health changes', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);

      // Act - First update at 75% health
      mockGameState.getHealth.and.returnValue(75);
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBeCloseTo(1.25, 2);

      // Act - Second update at 25% health
      mockGameState.getHealth.and.returnValue(25);
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBeCloseTo(1.75, 2);

      // Act - Third update at 10% health
      mockGameState.getHealth.and.returnValue(10);
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBeCloseTo(1.9, 2);
    });

    it('should handle invalid health values gracefully', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);

      // Test negative health
      mockGameState.getHealth.and.returnValue(-10);
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBe(2.0); // Max bonus

      // Test health exceeding max
      mockGameState.getHealth.and.returnValue(150);
      mockGameState.getMaxHealth.and.returnValue(100);
      service.update(16, mockEntityManager);
      expect(testBuff.damageMultiplier).toBe(1.0); // No bonus

      // Test zero max health
      mockGameState.getHealth.and.returnValue(50);
      mockGameState.getMaxHealth.and.returnValue(0);
      service.update(16, mockEntityManager);
      // Should not crash, damage multiplier should be reasonable
      expect(testBuff.damageMultiplier).toBeGreaterThan(0);
    });

    it('should only update when damage multiplier changes significantly', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockGameState.getHealth.and.returnValue(50);
      testBuff.damageMultiplier = 1.5; // Already set

      // Act - Small health change
      mockGameState.getHealth.and.returnValue(49.5); // Tiny change
      service.update(16, mockEntityManager);

      // Assert - Should not log because change is insignificant
      expect(mockDebugLog.log).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentBonus', () => {
    it('should return 0 when Berserker Protocol is not active', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(false);

      // Act
      const bonus = service.getCurrentBonus();

      // Assert
      expect(bonus).toBe(0);
    });

    it('should return correct bonus at various health levels', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);

      // Test at 100% health
      mockGameState.getHealth.and.returnValue(100);
      mockGameState.getMaxHealth.and.returnValue(100);
      expect(service.getCurrentBonus()).toBe(0);

      // Test at 50% health
      mockGameState.getHealth.and.returnValue(50);
      expect(service.getCurrentBonus()).toBeCloseTo(0.5, 2);

      // Test at 25% health
      mockGameState.getHealth.and.returnValue(25);
      expect(service.getCurrentBonus()).toBeCloseTo(0.75, 2);

      // Test at 1% health
      mockGameState.getHealth.and.returnValue(1);
      expect(service.getCurrentBonus()).toBeCloseTo(0.99, 2);
    });

    it('should scale with max bonus setting', () => {
      // Arrange
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockGameState.getHealth.and.returnValue(50); // 50% health
      mockGameState.getMaxHealth.and.returnValue(100);

      // Test with 1x max bonus
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);
      expect(service.getCurrentBonus()).toBeCloseTo(0.5, 2);

      // Test with 2x max bonus
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(2.0);
      expect(service.getCurrentBonus()).toBeCloseTo(1.0, 2);

      // Test with 3x max bonus
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(3.0);
      expect(service.getCurrentBonus()).toBeCloseTo(1.5, 2);
    });

    it('should return 0 when maxHealth is zero', () => {
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);
      mockGameState.getHealth.and.returnValue(0);
      mockGameState.getMaxHealth.and.returnValue(0);

      expect(service.getCurrentBonus()).toBe(0);
    });
  });

  describe('Division-by-zero safety', () => {
    it('should not modify damageMultiplier when maxHealth is zero', () => {
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);
      mockGameState.getHealth.and.returnValue(0);
      mockGameState.getMaxHealth.and.returnValue(0);

      testBuff.damageMultiplier = 1.0;
      service.update(16, mockEntityManager);

      // Should early-return without modifying the buff
      expect(testBuff.damageMultiplier).toBe(1.0);
    });

    it('should not modify damageMultiplier when maxHealth is negative', () => {
      mockPlayerUpgrades.hasBerserkerProtocol.and.returnValue(true);
      mockPlayerUpgrades.getBerserkerMaxBonus.and.returnValue(1.0);
      mockGameState.getHealth.and.returnValue(50);
      mockGameState.getMaxHealth.and.returnValue(-100);

      testBuff.damageMultiplier = 1.0;
      service.update(16, mockEntityManager);

      expect(testBuff.damageMultiplier).toBe(1.0);
    });
  });
});
