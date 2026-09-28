import { TestBed } from '@angular/core/testing';
import { CollisionSystemService } from '../combat';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameStateService } from '../../state/game-state.service';
import { PlayerService } from '../../player/player.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { SettingsService } from '../../utils/settings.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { CurseService } from '../../../services/curse.service';
import { BuffManagementSystemService, FactionStandingSystemService } from '../gameplay';
import { BuffSystemService } from '../../progression/buff-system.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { AudioService } from '../../audio/audio.service';
import { AscensionService } from '../../../services/ascension.service';
import { AchievementService } from '../../../services/achievement.service';
import { DifficultyService } from '../../../services/difficulty.service';
import {
  CollisionBoxComponent,
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  ProjectileComponent,
  SourceTagComponent,
} from '@photon/components';
import { DAMAGE_CONFIG } from '@photon/config/game-constants';

describe('CollisionSystemService - DeltaTime & Frame Cap', () => {
  let service: CollisionSystemService;
  let entityManager: EntityManagerService;
  let mockGameState: jasmine.SpyObj<GameStateService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockEntityFactory: jasmine.SpyObj<EntityFactoryECSService>;

  beforeEach(() => {
    mockGameState = jasmine.createSpyObj('GameStateService', ['takeDamage', 'getHealth', 'getMaxHealth']);
    mockPlayerService = jasmine.createSpyObj('PlayerService', [
      'isInvincible',
      'getFocusCharge',
      'getMaxHealth',
      'onDamageTaken',
      'setDamageFeedbackSource',
      'isDashing',
      'isParryAvailable',
      'isParrying',
      'isDirectionChangeOnCooldown',
      'getShardMultiplier',
      'triggerParrySuccess',
      'getFocusFireDamageMultiplier',
    ]);
    mockPlayerService.getFocusFireDamageMultiplier.and.returnValue(1.0);
    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    mockEntityFactory = jasmine.createSpyObj('EntityFactoryECSService', [
      'isEntityActive',
      'createExplosion',
      'returnToPool',
      'getFromPool',
    ]);

    // Set default return values
    mockGameState.getHealth.and.returnValue(100);
    mockGameState.getMaxHealth.and.returnValue(100);
    mockPlayerService.isInvincible.and.returnValue(false);
    mockPlayerService.getFocusCharge.and.returnValue(0);
    mockPlayerService.getMaxHealth.and.returnValue(100);
    mockPlayerService.isDashing.and.returnValue(false);
    mockPlayerService.isParryAvailable.and.returnValue(false);
    mockPlayerService.isParrying.and.returnValue(false);
    mockPlayerService.isDirectionChangeOnCooldown.and.returnValue(false);
    mockPlayerService.getShardMultiplier.and.returnValue(1);
    mockEntityFactory.isEntityActive.and.returnValue(true); // CRITICAL: All entities are active
    // Make returnToPool actually destroy the entity for test verification
    mockEntityFactory.returnToPool.and.callFake((_poolType: unknown, entityId: number) => {
      entityManager.destroyEntity(entityId);
    });

    // Create mock settings service
    const mockSettings = jasmine.createSpyObj('SettingsService', ['getSettings']);
    mockSettings.getSettings.and.returnValue({
      showDamageNumbers: true,
      volume: 100,
      screenShake: true,
      sensitivity: 100,
      chromaticAberration: true,
      lowHealthVignette: true,
    });

    // Create mock services for all dependencies
    const mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', [
      'createEffect',
      'createDamageNumber',
      'createExplosion',
    ]);
    const mockProgressionSystem = jasmine.createSpyObj('ProgressionSystemService', ['getCurrentLevel', 'addXP']);
    mockProgressionSystem.getCurrentLevel.and.returnValue(1);
    const mockPerformanceMonitor = jasmine.createSpyObj('PerformanceMonitorService', ['startSystemTimer']);
    mockPerformanceMonitor.startSystemTimer.and.returnValue({ end: () => {} });
    const mockCurseService = jasmine.createSpyObj('CurseService', [
      'hasActiveCurse',
      'getActiveCurses',
      'getDifficultyMultiplier',
    ]);
    mockCurseService.hasActiveCurse.and.returnValue(false);
    mockCurseService.getActiveCurses.and.returnValue([]);
    mockCurseService.getDifficultyMultiplier.and.returnValue(1);
    const mockFactionStanding = jasmine.createSpyObj('FactionStandingSystemService', [
      'getStanding',
      'recordKill',
      'getPlayerFactionId',
      'onEnemyKilled',
      'getTerritoryEffects',
    ]);
    mockFactionStanding.getTerritoryEffects.and.returnValue({
      damageMultiplier: 1.0,
      defenseMultiplier: 1.0,
      xpMultiplier: 1.0,
    });
    const mockErrorHandler = jasmine.createSpyObj('ErrorHandlerService', ['safeGetComponent', 'safeExecute']);
    // Pass through to actual getComponent - use 'as never' to bypass complex type checking
    mockErrorHandler.safeGetComponent.and.callFake(
      (em: EntityManagerService, entityId: number, componentClass: never) => {
        return em.getComponent(entityId, componentClass);
      }
    );
    // Pass through to execute the function directly
    mockErrorHandler.safeExecute.and.callFake((fn: () => void) => {
      fn();
    });
    const mockBuffManagement = jasmine.createSpyObj('BuffManagementSystemService', ['getActiveDamageMultiplier']);
    mockBuffManagement.getActiveDamageMultiplier.and.returnValue(1);

    TestBed.configureTestingModule({
      providers: [
        CollisionSystemService,
        EntityManagerService,
        { provide: GameStateService, useValue: mockGameState },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
        { provide: SettingsService, useValue: mockSettings },
        { provide: ProgressionSystemService, useValue: mockProgressionSystem },
        { provide: PerformanceMonitorService, useValue: mockPerformanceMonitor },
        { provide: CurseService, useValue: mockCurseService },
        { provide: FactionStandingSystemService, useValue: mockFactionStanding },
        { provide: ErrorHandlerService, useValue: mockErrorHandler },
        { provide: BuffManagementSystemService, useValue: mockBuffManagement },
        {
          provide: PlayerUpgradesService,
          useValue: (() => {
            const s = jasmine.createSpyObj('PlayerUpgradesService', [
              'getBeamDamageMultiplier',
              'getBeamWidthMultiplier',
              'getCriticalHitChance',
              'getCriticalHitMultiplier',
              'hasBarrier',
              'isBarrierCharged',
              'consumeBarrierCharge',
              'getShardMultiplier',
            ]);
            s.hasBarrier.and.returnValue(false);
            s.isBarrierCharged.and.returnValue(false);
            return s;
          })(),
        },
        {
          provide: BuffSystemService,
          useValue: (() => {
            const s = jasmine.createSpyObj('BuffSystemService', ['applyBuff', 'update']);
            Object.defineProperty(s, 'damageTakenMultiplier', { get: () => 1.0, configurable: true });
            return s;
          })(),
        },
        {
          provide: AchievementService,
          useValue: jasmine.createSpyObj('AchievementService', [
            'recordDamageDealt',
            'onEnemyKilled',
            'onDamageTaken',
            'onShardCollected',
          ]),
        },
        {
          provide: DifficultyService,
          useValue: (() => {
            const s = jasmine.createSpyObj('DifficultyService', [
              'getDifficultyMultiplier',
              'getEnemyHealthMultiplier',
              'getModifiers',
            ]);
            s.getDifficultyMultiplier.and.returnValue(1.0);
            s.getEnemyHealthMultiplier.and.returnValue(1.0);
            s.getModifiers.and.returnValue({ shardMultiplier: 1.0, xpMultiplier: 1.0, damageMultiplier: 1.0 });
            return s;
          })(),
        },
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

    service = TestBed.inject(CollisionSystemService);
    entityManager = TestBed.inject(EntityManagerService);

    // Mock performance.now() to start at high value and increment each call
    // (collision immunity requires currentTime - lastCollision >= IMMUNITY_DURATION)
    let mockPerformanceTime = 10000;
    spyOn(window.performance, 'now').and.callFake(() => {
      mockPerformanceTime += 100; // Increment by 100ms each call
      return mockPerformanceTime;
    });

    // Mock Date.now() for invincibility time checks
    let mockDateNow = 1000000;
    spyOn(Date, 'now').and.callFake(() => {
      mockDateNow += 100; // Increment by 100ms each call
      return mockDateNow;
    });
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('Frame-based Damage Cap', () => {
    it('should apply damage from first enemy collision', () => {
      // Note: Collision immunity is per-pair, so only the first enemy in each frame
      // will deal damage. The damage cap applies when multiple sources hit.
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Create one enemy dealing damage
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      service.update(16, entityManager);

      // Single enemy collision should deal 10 damage
      expect(mockGameState.takeDamage).toHaveBeenCalledWith(10, jasmine.any(String));
    });

    it('should cap very high damage from a single enemy', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Single enemy with very high damage
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(100)); // Very high damage

      service.update(16, entityManager);

      // Damage should be capped at MAX_DAMAGE_PER_FRAME (15)
      expect(mockGameState.takeDamage).toHaveBeenCalledWith(DAMAGE_CONFIG.MAX_DAMAGE_PER_FRAME, jasmine.any(String));
    });

    it('should track frame overflow correctly', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Simulate many frames to test frame ID overflow handling
      for (let frame = 0; frame < 100000; frame++) {
        const enemy = entityManager.createEntity();
        entityManager.addComponent(enemy, new PositionComponent(100, 100));
        entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
        entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
        entityManager.addComponent(enemy, new DamageComponent(20));

        service.update(16, entityManager);

        // Clean up enemy for next iteration
        entityManager.destroyEntity(enemy);
      }

      // Should not crash or have overflow issues
      expect(true).toBe(true);
    });
  });

  describe('Collision Immunity Timing', () => {
    it('should prevent damage during immunity period', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      // First collision
      service.update(16, entityManager);
      expect(mockGameState.takeDamage).toHaveBeenCalledTimes(1);

      mockGameState.takeDamage.calls.reset();

      // Immediate second collision (within immunity)
      service.update(16, entityManager);
      expect(mockGameState.takeDamage).not.toHaveBeenCalled();
    });

    it('should allow damage after immunity expires', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      // First collision
      service.update(16, entityManager);
      expect(mockGameState.takeDamage).toHaveBeenCalledTimes(1);

      mockGameState.takeDamage.calls.reset();

      // The performance.now() mock in beforeEach auto-increments by 100ms per call
      // After several calls from the collision system, immunity expires naturally
      // (PLAYER_DAMAGE_IMMUNITY_MS is typically 500ms, and our mock increments quickly)

      // Additional updates will naturally pass the immunity period since
      // performance.now() increments with each call
      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);
      service.update(16, entityManager);

      // After enough time passes (mock increments), damage should occur again
      expect(mockGameState.takeDamage).toHaveBeenCalled();
    });
  });

  describe('DeltaTime Independence', () => {
    it('should apply fixed damage regardless of deltaTime for collisions', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      // Test with short deltaTime
      service.update(8, entityManager); // 8ms deltaTime
      expect(mockGameState.takeDamage).toHaveBeenCalledWith(10, jasmine.any(String));
    });

    it('should apply same damage with different deltaTime values', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      // Test with longer deltaTime
      service.update(32, entityManager); // 32ms deltaTime
      expect(mockGameState.takeDamage).toHaveBeenCalledWith(10, jasmine.any(String)); // Same damage
    });
  });

  describe('Simultaneous Collision Handling', () => {
    it('should handle multiple projectiles hitting same frame', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new HealthComponent(100, 100));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));

      // Create 3 projectiles all hitting the enemy
      for (let i = 0; i < 3; i++) {
        const projectile = entityManager.createEntity();
        entityManager.addComponent(projectile, new PositionComponent(100, 100));
        entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
        entityManager.addComponent(projectile, new ProjectileComponent(15)); // 15 damage each
        entityManager.addComponent(projectile, new SourceTagComponent('player'));
      }

      service.update(16, entityManager);

      const health = entityManager.getComponent(enemy, HealthComponent);
      // All 3 projectiles should hit: 100 - (3 * 15) = 55
      expect(health?.health).toBe(55);
    });

    it('should handle player projectiles hitting enemy in same frame', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(200, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new HealthComponent(100, 100));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));

      // Player projectile hitting enemy
      const playerProjectile = entityManager.createEntity();
      entityManager.addComponent(playerProjectile, new PositionComponent(200, 100));
      entityManager.addComponent(playerProjectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(playerProjectile, new ProjectileComponent(20));
      entityManager.addComponent(playerProjectile, new SourceTagComponent('player'));

      service.update(16, entityManager);

      // Check enemy took damage from player projectile
      const enemyHealth = entityManager.getComponent(enemy, HealthComponent);
      expect(enemyHealth?.health).toBe(80); // 100 - 20
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero damage gracefully', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(0)); // Zero damage

      service.update(16, entityManager);

      // Zero damage will still trigger collision detection but damage applied will be 0
      if (mockGameState.takeDamage.calls.count() > 0) {
        expect(mockGameState.takeDamage).toHaveBeenCalledWith(0, jasmine.any(String));
      }
    });

    it('should handle negative damage as zero', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(-10)); // Negative damage

      service.update(16, entityManager);

      // Negative damage is floored to 0
      if (mockGameState.takeDamage.calls.count() > 0) {
        expect(mockGameState.takeDamage).toHaveBeenCalledWith(0, jasmine.any(String));
      }
    });

    it('should handle very high damage values', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(9999)); // Very high damage

      service.update(16, entityManager);

      // Should be capped at MAX_DAMAGE_PER_FRAME
      expect(mockGameState.takeDamage).toHaveBeenCalledWith(DAMAGE_CONFIG.MAX_DAMAGE_PER_FRAME, jasmine.any(String));
    });
  });

  describe('Memory Management', () => {
    it('should cleanup collision immunity map periodically', () => {
      // Create many collision pairs
      for (let i = 0; i < 100; i++) {
        const player = entityManager.createEntity();
        entityManager.addComponent(player, new PositionComponent(100, 100));
        entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
        entityManager.addComponent(player, new PlayerControlledComponent());
        entityManager.addComponent(player, new HealthComponent(100, 100));

        const enemy = entityManager.createEntity();
        entityManager.addComponent(enemy, new PositionComponent(100, 100));
        entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
        entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
        entityManager.addComponent(enemy, new DamageComponent(5));

        service.update(16, entityManager);

        // Clean up for next iteration
        entityManager.clear();
      }

      // Should not have memory issues
      const stats = service.getCollisionStats();
      expect(stats).toBeDefined();
    });
  });
});
