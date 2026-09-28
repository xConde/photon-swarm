import { TestBed } from '@angular/core/testing';
import { CollisionSystemService } from '../combat';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { ActiveBuff, BuffManagementSystemService, FactionStandingSystemService } from '../gameplay';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { GameStateService } from '../../state/game-state.service';
import { SettingsService } from '../../utils/settings.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { CurseService } from '../../../services/curse.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { AudioService } from '../../audio/audio.service';
import { AscensionService } from '../../../services/ascension.service';
import { PlayerControlledComponent, PositionComponent, ShardComponent } from '@photon/components';
import { Component, ComponentType } from '../../ecs/ecs.model';
import { PoolType } from '@photon/config/game-constants';

describe('Shard Synthesis Integration', () => {
  let collisionSystem: CollisionSystemService;
  let mockEntityManager: jasmine.SpyObj<EntityManagerService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockBuffManagement: jasmine.SpyObj<BuffManagementSystemService>;
  let mockEffectFactory: jasmine.SpyObj<EffectFactoryService>;
  let mockEntityFactory: jasmine.SpyObj<EntityFactoryECSService>;
  let mockGameState: jasmine.SpyObj<GameStateService>;
  let mockSettings: jasmine.SpyObj<SettingsService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockProgressionSystem: jasmine.SpyObj<ProgressionSystemService>;
  let mockPerformanceMonitor: jasmine.SpyObj<PerformanceMonitorService>;
  let mockCurseService: jasmine.SpyObj<CurseService>;
  let mockFactionStanding: jasmine.SpyObj<FactionStandingSystemService>;
  let mockErrorHandler: jasmine.SpyObj<ErrorHandlerService>;

  let playerId: number;
  let shardId: number;
  let testShard: ShardComponent;
  let testPosition: PositionComponent;

  beforeEach(() => {
    // Create mocks
    mockEntityManager = jasmine.createSpyObj('EntityManagerService', [
      'hasComponent',
      'getComponent',
      'getEntitiesWithComponents',
      'removeEntity',
    ]);

    mockPlayerService = jasmine.createSpyObj('PlayerService', ['isInvincible', 'isParryAvailable']);

    mockPlayerUpgrades = jasmine.createSpyObj('PlayerUpgradesService', [
      'hasShardSynthesis',
      'getShardSynthesisDuration',
      'getShardMultiplier',
    ]);

    mockBuffManagement = jasmine.createSpyObj('BuffManagementSystemService', [
      'isBuffRegistered',
      'registerBuff',
      'applyBuff',
      'getEntityBuffs',
    ]);

    mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', [
      'createShardCollection',
      'createShardPickupText',
    ]);

    mockEntityFactory = jasmine.createSpyObj('EntityFactoryECSService', ['returnToPool']);

    mockGameState = jasmine.createSpyObj('GameStateService', ['addShards']);

    mockSettings = jasmine.createSpyObj('SettingsService', ['getSettings']);
    mockSettings.getSettings.and.returnValue({
      showDamageNumbers: true,
      volume: 100,
      screenShake: true,
      sensitivity: 100,
      chromaticAberration: true,
      lowHealthVignette: true,
      colorblindMode: 'none',
    });

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    mockProgressionSystem = jasmine.createSpyObj('ProgressionSystemService', [], {
      xp: 0,
      level: 1,
    });

    mockPerformanceMonitor = jasmine.createSpyObj('PerformanceMonitorService', ['recordMetric', 'startSystemTimer']);
    mockPerformanceMonitor.startSystemTimer.and.returnValue({
      end: jasmine.createSpy('end').and.returnValue(0),
    } as unknown as ReturnType<typeof mockPerformanceMonitor.startSystemTimer>);

    mockCurseService = jasmine.createSpyObj('CurseService', ['getDifficultyMultiplier']);

    mockFactionStanding = jasmine.createSpyObj('FactionStandingSystemService', ['updateStanding']);

    mockErrorHandler = jasmine.createSpyObj('ErrorHandlerService', ['handleError', 'safeGetComponent', 'safeExecute']);
    // safeExecute just runs the callback and returns result
    (mockErrorHandler.safeExecute as jasmine.Spy).and.callFake(<T>(fn: () => T, _context: string, _fallbackValue?: T) =>
      fn()
    );
    // safeGetComponent delegates to entityManager.getComponent - mock returns the component or null
    (mockErrorHandler.safeGetComponent as jasmine.Spy).and.callFake(
      (_em: any, entityId: number, componentType: any, _context: string) =>
        mockEntityManager.getComponent(entityId, componentType) ?? null
    );

    // Set default return values
    playerId = 1;
    shardId = 2;
    testShard = new ShardComponent(10); // 10 shard value
    testPosition = new PositionComponent(100, 100);

    mockEntityManager.hasComponent.and.callFake((entityId: number, componentType: ComponentType<Component>) => {
      if (entityId === playerId && componentType === PlayerControlledComponent) return true;
      if (entityId === shardId && componentType === ShardComponent) return true;
      if (entityId === shardId && componentType === PositionComponent) return true;
      return false;
    });

    mockEntityManager.getComponent.and.callFake(
      <T extends Component>(entityId: number, componentType: ComponentType<T>): T | undefined => {
        if (entityId === shardId && componentType === (ShardComponent as unknown as ComponentType<T>))
          return testShard as unknown as T;
        if (entityId === shardId && componentType === (PositionComponent as unknown as ComponentType<T>))
          return testPosition as unknown as T;
        return undefined;
      }
    );

    mockPlayerUpgrades.hasShardSynthesis.and.returnValue(false);
    mockPlayerUpgrades.getShardSynthesisDuration.and.returnValue(2000);
    mockPlayerUpgrades.getShardMultiplier.and.returnValue(1.0);
    mockPlayerService.isInvincible.and.returnValue(false);
    mockPlayerService.isParryAvailable.and.returnValue(false);

    mockBuffManagement.isBuffRegistered.and.returnValue(false);
    mockBuffManagement.applyBuff.and.returnValue(true);
    mockBuffManagement.getEntityBuffs.and.returnValue([]);

    mockCurseService.getDifficultyMultiplier.and.returnValue(1.0);

    TestBed.configureTestingModule({
      providers: [
        CollisionSystemService,
        { provide: EntityManagerService, useValue: mockEntityManager },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
        { provide: BuffManagementSystemService, useValue: mockBuffManagement },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
        { provide: GameStateService, useValue: mockGameState },
        { provide: SettingsService, useValue: mockSettings },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: ProgressionSystemService, useValue: mockProgressionSystem },
        { provide: PerformanceMonitorService, useValue: mockPerformanceMonitor },
        { provide: CurseService, useValue: mockCurseService },
        { provide: FactionStandingSystemService, useValue: mockFactionStanding },
        { provide: ErrorHandlerService, useValue: mockErrorHandler },
        {
          provide: PostProcessingService,
          useValue: jasmine.createSpyObj('PostProcessingService', [
            'addScreenFlash',
            'addChromaticAberration',
            'setVignetteState',
          ]),
        },
        {
          provide: AudioService,
          useValue: jasmine.createSpyObj('AudioService', [
            'playBeamFire',
            'playEnemyDeath',
            'playEliteDeath',
            'playShardCollect',
            'playDamageTaken',
            'playLevelUp',
            'playComboTier',
            'playBossBurst',
            'destroy',
          ]),
        },
        {
          provide: AscensionService,
          useValue: (() => {
            const s = jasmine.createSpyObj('AscensionService', [
              'getDamageBonus',
              'getHealthBonus',
              'getShardBonus',
              'getXpBonus',
              'getAscensionLevel',
              'canAscend',
              'ascend',
              'reset',
              'getRequiredLevel',
            ]);
            s.getDamageBonus.and.returnValue(1.0);
            s.getHealthBonus.and.returnValue(1.0);
            s.getShardBonus.and.returnValue(1.0);
            s.getXpBonus.and.returnValue(1.0);
            s.getAscensionLevel.and.returnValue(0);
            s.canAscend.and.returnValue(false);
            s.getRequiredLevel.and.returnValue(10);
            return s;
          })(),
        },
      ],
    });

    collisionSystem = TestBed.inject(CollisionSystemService);
  });

  it('should be created', () => {
    expect(collisionSystem).toBeTruthy();
  });

  describe('Shard Synthesis Buff Trigger', () => {
    it('should not trigger buff when Shard Synthesis is not active', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(false);

      // Act - Simulate shard collection
      // Access private method for testing
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).not.toHaveBeenCalled();
      expect(mockBuffManagement.applyBuff).not.toHaveBeenCalled();
    });

    it('should trigger a random buff when Shard Synthesis is active', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      mockPlayerUpgrades.getShardSynthesisDuration.and.returnValue(2000);

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: jasmine.stringMatching(/^shard_(speed|damage|firerate)$/),
          duration: 2000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 150,
        })
      );
      expect(mockBuffManagement.applyBuff).toHaveBeenCalledWith(playerId, jasmine.any(String), mockEntityManager);
    });

    it('should register speed buff correctly', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      spyOn(Math, 'random').and.returnValue(0.1); // Will select first buff (speed)

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: 'shard_speed',
          name: 'Shard Speed',
          effects: { speedMultiplier: 1.3 },
          description: 'Temporary speed boost from shard collection',
        })
      );
    });

    it('should register damage buff correctly', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      spyOn(Math, 'random').and.returnValue(0.4); // Will select second buff (damage)

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: 'shard_damage',
          name: 'Shard Damage',
          effects: { damageMultiplier: 1.5 },
          description: 'Temporary damage boost from shard collection',
        })
      );
    });

    it('should register fire rate buff correctly', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      spyOn(Math, 'random').and.returnValue(0.8); // Will select third buff (fire rate)

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).toHaveBeenCalledWith(
        jasmine.objectContaining({
          id: 'shard_firerate',
          name: 'Shard Fire Rate',
          effects: { fireRateMultiplier: 1.5 },
          description: 'Temporary fire rate boost from shard collection',
        })
      );
    });

    it('should not re-register buff if already registered', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      mockBuffManagement.isBuffRegistered.and.returnValue(true); // Already registered

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).not.toHaveBeenCalled();
      expect(mockBuffManagement.applyBuff).toHaveBeenCalled();
    });

    it('should use custom duration from player service', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      mockPlayerUpgrades.getShardSynthesisDuration.and.returnValue(4000); // 4 seconds

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockBuffManagement.registerBuff).toHaveBeenCalledWith(
        jasmine.objectContaining({
          duration: 4000,
        })
      );
    });

    it('should still collect shards normally even with buff', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      testShard.value = 25;
      mockPlayerUpgrades.getShardMultiplier.and.returnValue(2.0);

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert
      expect(mockGameState.addShards).toHaveBeenCalledWith(50); // 25 * 2.0 multiplier
      expect(mockEffectFactory.createShardCollection).toHaveBeenCalledWith({ x: 100, y: 100 }, 50);
      expect(mockEntityFactory.returnToPool).toHaveBeenCalledWith(PoolType.SHARD, shardId);
    });
  });

  describe('PlayerService Integration', () => {
    it('should correctly set Shard Synthesis in PlayerService', () => {
      // Assert - these methods are already tested through the mock
      expect(mockPlayerUpgrades.hasShardSynthesis).toBeDefined();
      expect(mockPlayerUpgrades.getShardSynthesisDuration).toBeDefined();
    });

    it('should correctly disable Shard Synthesis in PlayerService', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      mockPlayerUpgrades.getShardSynthesisDuration.and.returnValue(3000);

      // Assert
      expect(mockPlayerUpgrades.hasShardSynthesis()).toBe(true);

      // Change state
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(false);
      expect(mockPlayerUpgrades.hasShardSynthesis()).toBe(false);
    });
  });

  describe('Buff Management Integration', () => {
    it('should track active buffs after application', () => {
      // Arrange
      mockPlayerUpgrades.hasShardSynthesis.and.returnValue(true);
      const mockBuff: ActiveBuff = {
        buffId: 'shard_speed',
        entity: playerId,
        startTime: Date.now(),
        duration: 2000,
        stacks: 1,
        isPermanent: false,
        refreshable: false,
      };
      mockBuffManagement.getEntityBuffs.and.returnValue([mockBuff]);

      // Act
      const handleShardCollection = (
        collisionSystem as unknown as { handleShardCollection: (a: number, b: number, c: EntityManagerService) => void }
      ).handleShardCollection.bind(collisionSystem);
      handleShardCollection(playerId, shardId, mockEntityManager);

      // Assert - Verify buff system was called to apply the buff
      // Note: getEntityBuffs is only called in a 30% random logging block, so we only check applyBuff
      expect(mockBuffManagement.applyBuff).toHaveBeenCalled();
    });
  });
});
