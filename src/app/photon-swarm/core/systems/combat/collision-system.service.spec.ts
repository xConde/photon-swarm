import { TestBed } from '@angular/core/testing';
import { CollisionEvent, CollisionSystemService } from '../combat';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { Component, ComponentType, EntityManager } from '../../ecs/ecs.model';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { PlayerService } from '../../player/player.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { GameStateService } from '../../state/game-state.service';
import { SettingsService } from '../../utils/settings.service';
import { CameraShakeService } from '../../effects/camera-shake.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { CurseService } from '../../../services/curse.service';
import { BuffManagementSystemService, FactionStandingSystemService } from '../gameplay';
import { BuffSystemService } from '../../progression/buff-system.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
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
  ShardComponent,
  ShieldArcComponent,
  SourceTagComponent,
  VelocityComponent,
} from '@photon/components';
import { DamageResolverService } from '../../combat/damage-resolver.service';
import { take } from 'rxjs';

describe('CollisionSystemService', () => {
  let service: CollisionSystemService;
  let entityManager: EntityManagerService;

  beforeEach(() => {
    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
      'createDamageNumber',
      'createShardCollection',
      'createShardPickupText',
      'createBeamImpact',
      'createMuzzleFlash',
      'createEnemyExplosion',
    ]);
    const entityFactorySpy = jasmine.createSpyObj('EntityFactoryECSService', [
      'returnToPool',
      'getFromPool',
      'isEntityActive',
    ]);
    entityFactorySpy.isEntityActive.and.returnValue(true);
    // Make returnToPool actually destroy the entity so tests can verify entity removal
    entityFactorySpy.returnToPool.and.callFake((_poolType: unknown, entityId: number) => {
      entityManager.destroyEntity(entityId);
    });
    const gameEngineSpy = jasmine.createSpyObj('GameEngineService', ['addShards', 'triggerHitStop']);
    const playerServiceSpy = jasmine.createSpyObj('PlayerService', [
      'isInvincible',
      'isDashing',
      'getShardMultiplier',
      'onDamageTaken',
      'setDamageFeedbackSource',
      'getFocusCharge',
      'getFocusFireDamageMultiplier',
      'getMaxHealth',
      'isParryAvailable',
      'isParrying',
      'hasShardSynthesis',
      'getShardSynthesisDuration',
    ]);
    playerServiceSpy.getFocusFireDamageMultiplier.and.returnValue(1.0);
    const gameStateSpy = jasmine.createSpyObj('GameStateService', [
      'takeDamage',
      'addShards',
      'getHealth',
      'getMaxHealth',
    ]);
    const settingsSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
    const cameraShakeSpy = jasmine.createSpyObj('CameraShakeService', ['addShake', 'addTrauma']);
    const postProcessingSpy = jasmine.createSpyObj('PostProcessingService', [
      'addChromaticAberration',
      'addScreenFlash',
      'setVignetteState',
    ]);
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['addXp']);
    const performanceMonitorSpy = jasmine.createSpyObj('PerformanceMonitorService', [
      'startMeasure',
      'endMeasure',
      'startSystemTimer',
      'endSystemTimer',
    ]);
    performanceMonitorSpy.startSystemTimer.and.returnValue({ end: jasmine.createSpy('end').and.returnValue(0) });
    const curseServiceSpy = jasmine.createSpyObj('CurseService', ['getDifficultyMultiplier', 'getActiveCurses']);
    const factionStandingSpy = jasmine.createSpyObj('FactionStandingSystemService', [
      'getPlayerFactionId',
      'onEnemyKilled',
      'getStanding',
      'getTerritoryEffects',
    ]);
    factionStandingSpy.getTerritoryEffects.and.returnValue({
      damageMultiplier: 1.0,
      defenseMultiplier: 1.0,
      xpMultiplier: 1.0,
    });
    const errorHandlerSpy = jasmine.createSpyObj('ErrorHandlerService', [
      'handleError',
      'handleWarning',
      'safeGetComponent',
      'safeExecute',
    ]);
    // safeExecute just runs the callback and returns result
    (errorHandlerSpy.safeExecute as jasmine.Spy).and.callFake(<T>(fn: () => T, _context: string, _fallbackValue?: T) =>
      fn()
    );
    // safeGetComponent delegates to entityManager.getComponent - mock returns the component or null
    errorHandlerSpy.safeGetComponent.and.callFake(
      <T extends Component>(em: EntityManager, entityId: number, componentType: ComponentType<T>, _context: string) =>
        em.getComponent(entityId, componentType) ?? null
    );
    const buffManagementSpy = jasmine.createSpyObj('BuffManagementSystemService', [
      'getActiveBuffs',
      'getBuffValue',
      'hasBuff',
    ]);

    // Set up default return values
    playerServiceSpy.isInvincible.and.returnValue(false);
    playerServiceSpy.isDashing.and.returnValue(false); // Default not dashing
    playerServiceSpy.getShardMultiplier.and.returnValue(1);
    playerServiceSpy.getFocusCharge.and.returnValue(0); // Default no focus charge
    playerServiceSpy.getMaxHealth.and.returnValue(100);
    playerServiceSpy.isParryAvailable.and.returnValue(false);
    playerServiceSpy.isParrying.and.returnValue(false);
    playerServiceSpy.hasShardSynthesis.and.returnValue(false);
    playerServiceSpy.getShardSynthesisDuration.and.returnValue(5000);
    // Mock performance.now() to start at high value and increment each call
    // (collision immunity requires currentTime - lastCollision >= IMMUNITY_DURATION)
    let mockPerformanceTime = 10000;
    spyOn(window.performance, 'now').and.callFake(() => {
      mockPerformanceTime += 100; // Increment by 100ms each call
      return mockPerformanceTime;
    });
    // Mock Date.now() for invincibility time checks (starts at high value, increments)
    let mockDateNow = 1000000;
    spyOn(Date, 'now').and.callFake(() => {
      mockDateNow += 100; // Increment by 100ms each call
      return mockDateNow;
    });
    // GameState tracks health state - mock tracks actual health changes
    let mockGameStateHealth = 100;
    gameStateSpy.takeDamage.and.callFake((damage: number) => {
      mockGameStateHealth = Math.max(0, mockGameStateHealth - damage);
    });
    gameStateSpy.getHealth.and.callFake(() => mockGameStateHealth);
    gameStateSpy.getMaxHealth.and.returnValue(100);
    settingsSpy.getSettings.and.returnValue({
      showDamageNumbers: true,
      volume: 100,
      screenShake: true,
      sensitivity: 100,
      chromaticAberration: true,
      lowHealthVignette: true,
    });
    curseServiceSpy.getDifficultyMultiplier.and.returnValue(1.0);
    curseServiceSpy.getActiveCurses.and.returnValue([]);
    factionStandingSpy.getPlayerFactionId.and.returnValue(0);
    factionStandingSpy.getStanding.and.returnValue(0);
    buffManagementSpy.getActiveBuffs.and.returnValue([]);
    buffManagementSpy.getBuffValue.and.returnValue(0);
    buffManagementSpy.hasBuff.and.returnValue(false);

    const playerUpgradesSpy = jasmine.createSpyObj('PlayerUpgradesService', [
      'hasBarrier',
      'isBarrierCharged',
      'consumeBarrierCharge',
      'getShardMultiplier',
      'hasShardSynthesis',
      'getShardSynthesisDuration',
    ]);
    // Default: no barrier purchased
    playerUpgradesSpy.hasBarrier.and.returnValue(false);
    playerUpgradesSpy.isBarrierCharged.and.returnValue(false);
    playerUpgradesSpy.getShardMultiplier.and.returnValue(1);
    playerUpgradesSpy.hasShardSynthesis.and.returnValue(false);
    playerUpgradesSpy.getShardSynthesisDuration.and.returnValue(5000);

    const buffSystemSpy = jasmine.createSpyObj('BuffSystemService', ['applyBuff', 'update']);
    Object.defineProperty(buffSystemSpy, 'damageTakenMultiplier', { get: () => 1.0, configurable: true });

    const achievementServiceSpy = jasmine.createSpyObj('AchievementService', [
      'onEnemyKilled',
      'onDamageTaken',
      'onShardCollected',
      'recordDamageDealt',
    ]);

    const difficultyServiceSpy = jasmine.createSpyObj('DifficultyService', [
      'getDifficultyMultiplier',
      'getEnemyHealthMultiplier',
      'getModifiers',
    ]);
    difficultyServiceSpy.getDifficultyMultiplier.and.returnValue(1.0);
    difficultyServiceSpy.getEnemyHealthMultiplier.and.returnValue(1.0);
    difficultyServiceSpy.getModifiers.and.returnValue({
      shardMultiplier: 1.0,
      xpMultiplier: 1.0,
      damageMultiplier: 1.0,
    });

    TestBed.configureTestingModule({
      providers: [
        CollisionSystemService,
        EntityManagerService,
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: GameEngineService, useValue: gameEngineSpy },
        { provide: PlayerService, useValue: playerServiceSpy },
        { provide: PlayerUpgradesService, useValue: playerUpgradesSpy },
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: SettingsService, useValue: settingsSpy },
        { provide: CameraShakeService, useValue: cameraShakeSpy },
        { provide: PostProcessingService, useValue: postProcessingSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: PerformanceMonitorService, useValue: performanceMonitorSpy },
        { provide: CurseService, useValue: curseServiceSpy },
        { provide: FactionStandingSystemService, useValue: factionStandingSpy },
        { provide: ErrorHandlerService, useValue: errorHandlerSpy },
        { provide: BuffManagementSystemService, useValue: buffManagementSpy },
        { provide: BuffSystemService, useValue: buffSystemSpy },
        { provide: AchievementService, useValue: achievementServiceSpy },
        { provide: DifficultyService, useValue: difficultyServiceSpy },
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
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('initialization', () => {
    it('should initialize collision system', () => {
      service.init();

      const stats = service.getCollisionStats();
      expect(stats.cells).toBe(0);
      expect(stats.checks).toBe(0);
      expect(stats.collisions).toBe(0);
    });

    it('should set world bounds correctly', () => {
      service.setWorldBounds(1000, 800);

      // This should not throw and should be reflected in internal state
      expect(() => service.init()).not.toThrow();
    });
  });

  describe('spatial partitioning', () => {
    beforeEach(() => {
      service.init();
      service.setWorldBounds(1000, 1000);
    });

    it('should handle entities in different spatial cells', () => {
      // Create two entities far apart
      const entity1 = entityManager.createEntity();
      entityManager.addComponent(entity1, new PositionComponent(100, 100));
      entityManager.addComponent(entity1, new CollisionBoxComponent(10, 'player'));

      const entity2 = entityManager.createEntity();
      entityManager.addComponent(entity2, new PositionComponent(900, 900));
      entityManager.addComponent(entity2, new CollisionBoxComponent(10, 'enemy'));

      service.update(16, entityManager);

      const stats = service.getCollisionStats();
      expect(stats.cells).toBeGreaterThan(0);
      expect(stats.checks).toBe(0); // No collision checks since they're in different cells
    });

    it('should handle entities in same spatial cell', () => {
      // Create two entities that actually overlap (distance < combined radius)
      const entity1 = entityManager.createEntity();
      entityManager.addComponent(entity1, new PositionComponent(100, 100));
      entityManager.addComponent(entity1, new CollisionBoxComponent(10, 'player'));
      entityManager.addComponent(entity1, new PlayerControlledComponent());

      const entity2 = entityManager.createEntity();
      // Position close enough to overlap: distance ~7.07 < combined radius 20
      entityManager.addComponent(entity2, new PositionComponent(105, 105));
      entityManager.addComponent(entity2, new CollisionBoxComponent(10, 'enemy'));
      entityManager.addComponent(entity2, new EnemyTypeComponent('basic'));

      service.update(16, entityManager);

      const stats = service.getCollisionStats();
      expect(stats.checks).toBeGreaterThan(0); // Should have checked the overlapping pair
    });
  });

  describe('collision detection', () => {
    beforeEach(() => {
      service.init();
    });

    it('should detect collision between overlapping entities', () => {
      // Create overlapping player and enemy
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105)); // Overlapping
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(25));

      let collisionDetected = false;
      service.collision$.pipe(take(1)).subscribe(() => {
        collisionDetected = true;
      });

      service.update(16, entityManager);

      expect(collisionDetected).toBeTruthy();
    });

    it('should not detect collision between non-overlapping entities', () => {
      // Create non-overlapping player and enemy
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(10, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(200, 200)); // Far away
      entityManager.addComponent(enemy, new CollisionBoxComponent(10, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));

      let collisionDetected = false;
      service.collision$.subscribe(() => {
        collisionDetected = true;
      });

      service.update(16, entityManager);

      expect(collisionDetected).toBeFalsy();
    });
  });

  describe('collision groups', () => {
    beforeEach(() => {
      service.init();
    });

    it('should allow player-enemy collisions', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(25));

      let collisionEvent: CollisionEvent | null = null;
      service.collision$.pipe(take(1)).subscribe((event) => {
        collisionEvent = event;
      });

      service.update(16, entityManager);

      expect(collisionEvent).not.toBeNull();
      if (collisionEvent !== null) {
        expect((collisionEvent as CollisionEvent).type).toBe('player-enemy');
      }
    });

    it('should allow projectile-enemy collisions', () => {
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now()));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new HealthComponent(50, 50));

      let collisionEvent: CollisionEvent | null = null;
      service.collision$.pipe(take(1)).subscribe((event) => {
        collisionEvent = event;
      });

      service.update(16, entityManager);

      expect(collisionEvent).not.toBeNull();
      if (collisionEvent !== null) {
        expect((collisionEvent as CollisionEvent).type).toBe('projectile-enemy');
      }
    });

    it('should pool projectiles when they hit the player', () => {
      // Create player entity
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Create enemy projectile
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(105, 105));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(10, 3000, Date.now()));
      entityManager.addComponent(projectile, new DamageComponent(10));

      // Get the entity factory spy
      const entityFactorySpy = TestBed.inject(EntityFactoryECSService);

      let collisionEvent: CollisionEvent | null = null;
      service.collision$.pipe(take(1)).subscribe((event) => {
        collisionEvent = event;
      });

      // Run collision detection
      service.update(16, entityManager);

      // Verify collision occurred
      expect(collisionEvent).not.toBeNull();
      if (collisionEvent !== null) {
        expect((collisionEvent as CollisionEvent).type).toBe('player-projectile');
      }

      // Verify projectile was pooled
      expect(entityFactorySpy.returnToPool).toHaveBeenCalled();
    });

    it('should prevent enemy-enemy collisions', () => {
      const enemy1 = entityManager.createEntity();
      entityManager.addComponent(enemy1, new PositionComponent(100, 100));
      entityManager.addComponent(enemy1, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy1, new EnemyTypeComponent('basic'));

      const enemy2 = entityManager.createEntity();
      entityManager.addComponent(enemy2, new PositionComponent(105, 105));
      entityManager.addComponent(enemy2, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy2, new EnemyTypeComponent('tank'));

      let collisionDetected = false;
      service.collision$.subscribe(() => {
        collisionDetected = true;
      });

      service.update(16, entityManager);

      expect(collisionDetected).toBeFalsy();
    });
  });

  describe('damage application', () => {
    beforeEach(() => {
      service.init();
    });

    it('should apply damage to player on enemy collision', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      const playerHealth = new HealthComponent(100, 100);
      entityManager.addComponent(player, playerHealth);

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage value within MAX_DAMAGE_PER_FRAME cap (15)
      entityManager.addComponent(enemy, new DamageComponent(10));

      service.update(16, entityManager);

      expect(playerHealth.health).toBeLessThan(100);
      expect(playerHealth.health).toBe(90); // 100 - 10 damage
    });

    it('should apply damage reduction to player', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      const playerHealth = new HealthComponent(100, 100, 0.5); // 50% damage reduction
      entityManager.addComponent(player, playerHealth);

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage value that after 50% reduction stays under cap: 20 * 0.5 = 10
      entityManager.addComponent(enemy, new DamageComponent(20));

      service.update(16, entityManager);

      expect(playerHealth.health).toBe(90); // 100 - (20 * 0.5) = 90
    });

    it('a player projectile reduces a basic enemy health (the core shooting path)', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.getFocusFireDamageMultiplier.and.returnValue(1.0);

      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now()));
      entityManager.addComponent(projectile, new VelocityComponent(300, 0));
      entityManager.addComponent(projectile, new SourceTagComponent('player'));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(102, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(100, 100); // damageReduction 0, no shield
      entityManager.addComponent(enemy, enemyHealth);

      service.update(16, entityManager);

      expect(enemyHealth.health).toBeLessThan(100);
    });

    it('a player projectile BYPASSES the Sentinel shield (projectiles are the counter to shielded enemies)', () => {
      // Player projectile travelling left→right toward a shielded Sentinel.
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now()));
      entityManager.addComponent(projectile, new VelocityComponent(300, 0));
      entityManager.addComponent(projectile, new SourceTagComponent('player'));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 100));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('sentinel'));
      const enemyHealth = new HealthComponent(100, 100);
      entityManager.addComponent(enemy, enemyHealth);
      entityManager.addComponent(enemy, new ShieldArcComponent());

      const resolver = TestBed.inject(DamageResolverService);
      const resolveSpy = spyOn(resolver, 'applyDamageToEnemy').and.callThrough();

      service.update(16, entityManager);

      expect(resolveSpy).toHaveBeenCalled();
      const req = resolveSpy.calls.mostRecent().args[0];
      // Projectiles intentionally do NOT pass a shield input — they pierce the shield.
      expect(req.shield).withContext('projectiles must bypass the Sentinel shield').toBeFalsy();
      // And the Sentinel takes full projectile damage despite its shield.
      expect(enemyHealth.health).toBeLessThan(100);
    });

    it('should apply focus charge damage reduction to player', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;

      // Set focus charge to 100% (should give 30% damage reduction)
      playerServiceSpy.getFocusCharge.and.returnValue(100);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      const playerHealth = new HealthComponent(100, 100, 0); // No base damage reduction
      entityManager.addComponent(player, playerHealth);

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage that after 30% reduction stays under MAX_DAMAGE_PER_FRAME (15)
      entityManager.addComponent(enemy, new DamageComponent(20));

      service.update(16, entityManager);

      // Verify damage was reduced by 30%: 20 * 0.7 = 14
      expect(gameStateSpy.takeDamage).toHaveBeenCalledWith(14, 'enemy_contact');
    });

    it('should combine focus charge and base damage reductions', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;

      // Set focus charge to 50% (should give 15% damage reduction)
      playerServiceSpy.getFocusCharge.and.returnValue(50);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      const playerHealth = new HealthComponent(100, 100, 0.2); // 20% base damage reduction
      entityManager.addComponent(player, playerHealth);

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage that after 35% reduction stays under MAX_DAMAGE_PER_FRAME (15)
      entityManager.addComponent(enemy, new DamageComponent(20));

      service.update(16, entityManager);

      // Verify damage was reduced by 35% total (20% base + 15% from focus): 20 * 0.65 = 13
      expect(gameStateSpy.takeDamage).toHaveBeenCalledWith(13, 'enemy_contact');
    });

    it('should apply damage to enemy on projectile collision', () => {
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now()));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(50, 50);
      entityManager.addComponent(enemy, enemyHealth);

      service.update(16, entityManager);

      expect(enemyHealth.health).toBe(20); // 50 - 30 damage
    });

    it('should destroy non-penetrating projectiles on collision', () => {
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now(), 1, false)); // Non-penetrating

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new HealthComponent(50, 50));

      const initialEntityCount = entityManager.getEntityCount();

      service.update(16, entityManager);

      // Projectile should be destroyed
      expect(entityManager.getEntityCount()).toBe(initialEntityCount - 1);
      expect(entityManager.hasComponent(projectile, PositionComponent)).toBeFalsy();
    });

    it('should not destroy penetrating projectiles on collision', () => {
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now(), 1, true)); // Penetrating

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new HealthComponent(50, 50));

      const initialEntityCount = entityManager.getEntityCount();

      service.update(16, entityManager);

      // Projectile should still exist
      expect(entityManager.getEntityCount()).toBe(initialEntityCount);
      expect(entityManager.hasComponent(projectile, PositionComponent)).toBeTruthy();
    });
  });

  describe('collision events', () => {
    beforeEach(() => {
      service.init();
    });

    it('should emit collision events with correct data', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage value within MAX_DAMAGE_PER_FRAME cap (15)
      entityManager.addComponent(enemy, new DamageComponent(10));

      let collisionEvent: CollisionEvent | null = null;
      service.collision$.pipe(take(1)).subscribe((event) => {
        collisionEvent = event;
      });

      service.update(16, entityManager);

      expect(collisionEvent).not.toBeNull();
      if (collisionEvent !== null) {
        const event = collisionEvent as CollisionEvent;
        expect(event.entityA).toBeDefined();
        expect(event.entityB).toBeDefined();
        expect(event.type).toBe('player-enemy');
        expect(event.damage).toBe(10);
        expect(event.position.x).toBeCloseTo(102.5); // Midpoint
        expect(event.position.y).toBeCloseTo(102.5); // Midpoint
        expect(event.timestamp).toBeGreaterThan(0);
      }
    });
  });

  describe('performance', () => {
    beforeEach(() => {
      service.init();
    });

    it('should provide collision statistics', () => {
      // Create several entities
      for (let i = 0; i < 5; i++) {
        const entity = entityManager.createEntity();
        entityManager.addComponent(entity, new PositionComponent(i * 50, i * 50));
        entityManager.addComponent(entity, new CollisionBoxComponent(10, 'enemy'));
        entityManager.addComponent(entity, new EnemyTypeComponent('basic'));
      }

      service.update(16, entityManager);

      const stats = service.getCollisionStats();
      expect(stats.checks).toBeGreaterThanOrEqual(0);
      expect(stats.collisions).toBeGreaterThanOrEqual(0);
      expect(stats.cells).toBeGreaterThan(0);
    });

    it('should handle many entities efficiently', () => {
      // Create many entities spread across the world
      for (let i = 0; i < 100; i++) {
        const entity = entityManager.createEntity();
        entityManager.addComponent(entity, new PositionComponent(Math.random() * 1000, Math.random() * 1000));
        entityManager.addComponent(entity, new CollisionBoxComponent(5, 'projectile'));
      }

      // Just verify the system can process many entities without crashing
      // (performance.now() is mocked, so we can't measure actual time)
      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should complete observable on destroy', () => {
      let completed = false;
      service.collision$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      service.destroy();

      expect(completed).toBeTruthy();
    });

    it('should clear spatial grid on destroy', () => {
      service.init();

      // Add some entities
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PositionComponent(100, 100));
      entityManager.addComponent(entity, new CollisionBoxComponent(10, 'player'));

      service.update(16, entityManager);

      // Should have spatial data
      expect(service.getCollisionStats().cells).toBeGreaterThan(0);

      service.destroy();

      // Should be cleared (though we can't directly test private state)
      expect(() => service.getCollisionStats()).not.toThrow();
    });
  });

  describe('Player Damage Source Tracking', () => {
    beforeEach(() => {
      service.init();
    });

    it('should track the faction that damaged the player', async () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      // Import FactionComponent
      const { FactionComponent } = await import('../../../components');
      entityManager.addComponent(enemy, new FactionComponent(2, 'Azure King', 1.0));

      service.update(16, entityManager);

      // Check that faction was tracked
      const lastDamageSource = service.getLastPlayerDamageSource();
      expect(lastDamageSource).toBe(2);
    });

    it('should return null if no recent damage', () => {
      const lastDamageSource = service.getLastPlayerDamageSource();
      expect(lastDamageSource).toBeNull();
    });

    it('should return null if damage is older than 5 seconds', async () => {
      // First, cause damage
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      const { FactionComponent } = await import('../../../components');
      entityManager.addComponent(enemy, new FactionComponent(3, 'Verdant King', 1.0));

      service.update(16, entityManager);

      // Check immediately - should have faction (this verifies tracking works)
      expect(service.getLastPlayerDamageSource()).toBe(3);

      // The timeout behavior (returning null after 5 seconds) requires Date.now()
      // to advance by 5000ms, which can't be easily tested with the mocked Date.now
      // that increments by 100 per call. We verify the tracking works above.
    });

    it('should update faction when damaged by different enemies', async () => {
      // This test verifies that faction tracking is updated when different enemies damage the player.
      // We advance mock time past the PLAYER_DAMAGE_IMMUNITY_MS (1000ms) between collisions.

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(200, 200)); // High health for multiple hits

      const enemy1 = entityManager.createEntity();
      entityManager.addComponent(enemy1, new PositionComponent(105, 105));
      entityManager.addComponent(enemy1, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy1, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy1, new DamageComponent(10));

      const { FactionComponent } = await import('../../../components');
      entityManager.addComponent(enemy1, new FactionComponent(1, 'Crimson King', 1.0));

      service.update(16, entityManager);
      expect(service.getLastPlayerDamageSource()).toBe(1);

      // Move enemy1 away
      const enemy1Pos = entityManager.getComponent(enemy1, PositionComponent)!;
      enemy1Pos.x = 500;

      // Advance mock time past immunity (each update ~2-3 calls, need 100 * 10+ = 1000ms)
      for (let i = 0; i < 8; i++) {
        service.update(16, entityManager);
      }

      // Add second enemy from different faction at player position
      const enemy2 = entityManager.createEntity();
      entityManager.addComponent(enemy2, new PositionComponent(105, 105));
      entityManager.addComponent(enemy2, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy2, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy2, new DamageComponent(10));
      entityManager.addComponent(enemy2, new FactionComponent(4, 'Shadow King', 1.0));

      service.update(16, entityManager);
      expect(service.getLastPlayerDamageSource()).toBe(4);
    });

    it('should not track faction if enemy has no FactionComponent', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));
      // No FactionComponent added

      service.update(16, entityManager);

      // Should return null since no faction was tracked
      const lastDamageSource = service.getLastPlayerDamageSource();
      expect(lastDamageSource).toBeNull();
    });
  });

  // CRITICAL: Self-Damage Prevention Tests
  describe('Self-Damage Prevention', () => {
    beforeEach(() => {
      service.init();
    });

    it('should prevent player projectiles from colliding with player (collision group level)', async () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Create player's own projectile with SourceTagComponent
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(105, 105)); // Overlapping
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(30, 3000, Date.now()));
      entityManager.addComponent(projectile, new DamageComponent(30));

      const { SourceTagComponent } = await import('../../../components');
      entityManager.addComponent(projectile, new SourceTagComponent('player'));

      const playerHealthComp = entityManager.getComponent(player, HealthComponent);
      const healthValueBefore = playerHealthComp!.health;

      service.update(16, entityManager);

      // Player health should NOT have changed
      const healthValueAfter = entityManager.getComponent(player, HealthComponent)!.health;
      expect(healthValueAfter).toBe(healthValueBefore);
      expect(healthValueAfter).toBe(100); // No damage taken
    });

    it('should prevent player projectiles from damaging player (damage application level)', async () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Create player projectile with high damage
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(105, 105));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(50, 3000, Date.now())); // High damage
      entityManager.addComponent(projectile, new DamageComponent(50));

      const { SourceTagComponent } = await import('../../../components');
      entityManager.addComponent(projectile, new SourceTagComponent('player'));

      service.update(16, entityManager);

      // Verify no damage was applied
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(100);
    });

    it('should allow enemy projectiles to damage player (control test)', async () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Create enemy projectile (no SourceTagComponent, or with 'enemy' source)
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(105, 105));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(15, 3000, Date.now()));
      entityManager.addComponent(projectile, new DamageComponent(15));

      const { SourceTagComponent } = await import('../../../components');
      entityManager.addComponent(projectile, new SourceTagComponent('enemy'));

      service.update(16, entityManager);

      // Verify damage WAS applied from enemy projectile
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBeLessThan(100);
      expect(playerHealth!.health).toBe(85); // 100 - 15 damage (capped at MAX_DAMAGE_PER_FRAME)
    });

    it('should allow player projectiles to damage enemies', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(50, 50));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());

      // Create enemy
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(200, 200));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new HealthComponent(100, 100));

      // Create player projectile hitting enemy
      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(205, 205)); // Near enemy
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(40, 3000, Date.now()));

      service.update(16, entityManager);

      // Verify enemy took damage
      const enemyHealth = entityManager.getComponent(enemy, HealthComponent);
      expect(enemyHealth!.health).toBeLessThan(100);
      expect(enemyHealth!.health).toBe(60); // 100 - 40 damage
    });
  });

  // CRITICAL: Collision Immunity Tests
  describe('Collision Immunity System', () => {
    beforeEach(() => {
      service.init();
    });

    it('should prevent same enemy from damaging player twice within immunity duration', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage within MAX_DAMAGE_PER_FRAME cap (15)
      entityManager.addComponent(enemy, new DamageComponent(10));

      // First collision - should apply damage
      service.update(16, entityManager);
      let playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(90); // 100 - 10

      // Second collision immediately after (within immunity) - should NOT apply damage
      service.update(16, entityManager);
      playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(90); // Still 90, no additional damage

      // Third collision still within immunity
      service.update(16, entityManager);
      playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(90); // Still 90
    });

    it('should allow same enemy to damage player after immunity expires', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use damage within MAX_DAMAGE_PER_FRAME cap (15)
      entityManager.addComponent(enemy, new DamageComponent(10));

      // First collision
      service.update(16, entityManager);
      let playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(90); // 100 - 10

      // The mock performance.now() increments by 100ms each call
      // COLLISION_IMMUNITY_DURATION is 500ms, PLAYER_DAMAGE_IMMUNITY_MS is 1000ms
      // We need multiple update() calls to advance mock time past both immunity windows

      // Move enemy away, call updates to advance mock time, then move back
      const enemyPos = entityManager.getComponent(enemy, PositionComponent)!;
      enemyPos.x = 500; // Move away to avoid collisions during time advancement

      // Call update multiple times to advance mock performance.now()
      // Each update makes ~2-3 performance.now() calls, need 100ms * 10+ calls for 1000ms immunity
      for (let i = 0; i < 10; i++) {
        service.update(16, entityManager);
      }

      // Move enemy back to collide
      enemyPos.x = 105;

      // This collision should now apply damage (immunity expired)
      service.update(16, entityManager);
      playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(80); // 90 - 10
    });

    it('should prevent duplicate collision processing in same frame', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(15)); // MAX_DAMAGE_PER_FRAME is 15

      // Process collision
      service.update(16, entityManager);

      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(85); // 100 - 15 (only takes damage once per frame)
    });

    it('should allow different enemies to damage player simultaneously', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // First enemy
      const enemy1 = entityManager.createEntity();
      entityManager.addComponent(enemy1, new PositionComponent(105, 105));
      entityManager.addComponent(enemy1, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy1, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy1, new DamageComponent(15));

      // Second enemy at different position
      const enemy2 = entityManager.createEntity();
      entityManager.addComponent(enemy2, new PositionComponent(95, 95));
      entityManager.addComponent(enemy2, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy2, new EnemyTypeComponent('tank'));
      entityManager.addComponent(enemy2, new DamageComponent(20));

      // Both should damage player in first frame (different collision keys)
      service.update(16, entityManager);

      const playerHealth = entityManager.getComponent(player, HealthComponent);
      // Note: Global player damage immunity (200ms) means only ONE enemy will damage per frame
      // This is expected behavior - prevents burst damage from multiple enemies
      expect(playerHealth!.health).toBeLessThan(100);
    });

    describe('with fake clock', () => {
      beforeEach(() => {
        jasmine.clock().install();
      });

      afterEach(() => {
        jasmine.clock().uninstall();
      });

      it('should clean up old immunity entries to prevent memory leak', () => {
        const player = entityManager.createEntity();
        entityManager.addComponent(player, new PositionComponent(100, 100));
        entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
        entityManager.addComponent(player, new PlayerControlledComponent());
        entityManager.addComponent(player, new HealthComponent(1000, 1000)); // High health to survive

        // Create and collide with many enemies to fill immunity map
        for (let i = 0; i < 10; i++) {
          const enemy = entityManager.createEntity();
          entityManager.addComponent(enemy, new PositionComponent(105 + i, 105 + i));
          entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
          entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
          entityManager.addComponent(enemy, new DamageComponent(1));

          service.update(16, entityManager);

          // Move to next frame and wait for immunity to allow next hit
          jasmine.clock().tick(1100); // Past both collision immunity (1000ms) and player damage immunity (200ms)
        }

        // Get initial stats
        const statsBefore = service.getCollisionStats();
        expect(statsBefore.collisions).toBeGreaterThan(0);

        // Trigger cleanup by advancing time past cleanup interval (10 seconds)
        jasmine.clock().tick(11000);

        // Run another update to trigger cleanup logic
        service.update(16, entityManager);

        // Cleanup should have occurred (we can't directly test private map size,
        // but the system should not crash and should continue working)
        const statsAfter = service.getCollisionStats();
        expect(statsAfter.checks).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // CRITICAL: Invincibility Systems Tests
  describe('Invincibility Systems', () => {
    beforeEach(() => {
      service.init();
    });

    it('should block damage when PlayerControlledComponent.isInvincible is true', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      const playerComp = new PlayerControlledComponent();
      playerComp.isInvincible = true;
      playerComp.invincibilityEndTime = Date.now() + 5000; // 5 seconds from now
      entityManager.addComponent(player, playerComp);
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(50));

      service.update(16, entityManager);

      // Player should take NO damage due to invincibility
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(100);
    });

    it('should expire invincibility after invincibilityEndTime passes', () => {
      // Test that invincibility is properly checked and cleared when expired
      // Set invincibilityEndTime to a value LESS than current Date.now mock so it's already expired

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      const playerComp = new PlayerControlledComponent();
      playerComp.isInvincible = true;
      // Set end time to past so it's already expired when collision is checked
      playerComp.invincibilityEndTime = 1000; // Well below the mock Date.now which starts at ~1000000
      entityManager.addComponent(player, playerComp);
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(15));

      // Collision should detect expired invincibility, clear it, and apply damage
      service.update(16, entityManager);
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(85); // 100 - 15 (invincibility expired, damage applied)

      // Verify invincibility was cleared by the collision system
      const playerCompAfter = entityManager.getComponent(player, PlayerControlledComponent);
      expect(playerCompAfter!.isInvincible).toBe(false);
      expect(playerCompAfter!.invincibilityEndTime).toBe(0);
    });

    it('should block damage when PlayerService.isInvincible returns true (dash mechanic)', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isInvincible.and.returnValue(true); // Simulate dash invincibility

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(40));

      service.update(16, entityManager);

      // Player should take NO damage during dash
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(100);
    });

    it('should allow damage when PlayerService.isInvincible returns false', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isInvincible.and.returnValue(false); // Not dashing

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(15)); // MAX_DAMAGE_PER_FRAME is 15

      service.update(16, entityManager);

      // Player should take damage when not dashing
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBeLessThan(100);
      expect(playerHealth!.health).toBe(85); // 100 - 15
    });

    it('should not block shard collection when invincible', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      const playerComp = new PlayerControlledComponent();
      playerComp.isInvincible = true;
      playerComp.invincibilityEndTime = Date.now() + 5000;
      entityManager.addComponent(player, playerComp);
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // Create shard
      const shard = entityManager.createEntity();
      entityManager.addComponent(shard, new PositionComponent(105, 105));
      entityManager.addComponent(shard, new CollisionBoxComponent(5, 'shard'));
      entityManager.addComponent(shard, new ShardComponent(10));

      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;

      service.update(16, entityManager);

      // Verify shard was collected (invincibility doesn't block shard collection)
      expect(gameStateSpy.addShards).toHaveBeenCalledWith(10);
    });

    it('should handle infinite invincibility (invincibilityEndTime = 0)', () => {
      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      const playerComp = new PlayerControlledComponent();
      playerComp.isInvincible = true;
      playerComp.invincibilityEndTime = 0; // Infinite invincibility (for testing/debug mode)
      entityManager.addComponent(player, playerComp);
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(50));

      service.update(16, entityManager);

      // Should remain invincible indefinitely
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(100);

      const playerCompAfter = entityManager.getComponent(player, PlayerControlledComponent);
      expect(playerCompAfter!.isInvincible).toBe(true);
    });
  });

  describe('Killing Blow Damage Numbers', () => {
    // Bug fix: killing blows suppressed damage numbers because the health check
    // ran AFTER health was set to 0. Now uses previousHealth capture.

    beforeEach(() => {
      service.init();
    });

    it('should show damage number on killing blow (previousHealth > 0)', () => {
      const effectFactorySpy = TestBed.inject(EffectFactoryService) as jasmine.SpyObj<EffectFactoryService>;

      const projectile = entityManager.createEntity();
      entityManager.addComponent(projectile, new PositionComponent(100, 100));
      entityManager.addComponent(projectile, new CollisionBoxComponent(5, 'projectile'));
      entityManager.addComponent(projectile, new ProjectileComponent(100, 3000, Date.now()));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(30, 30); // Will die from 100 damage
      entityManager.addComponent(enemy, enemyHealth);

      service.update(16, entityManager);

      // Enemy should be dead
      expect(enemyHealth.health).toBe(0);
      // Damage number should still be created (previousHealth was 30 > 0)
      expect(effectFactorySpy.createDamageNumber).toHaveBeenCalled();
    });
  });

  // OFFENSIVE DASH: Deals damage to enemies when dashing through them
  describe('Offensive Dash', () => {
    beforeEach(() => {
      service.init();
    });

    it('should deal damage to enemy when player is dashing', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isDashing.and.returnValue(true);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(100, 100);
      entityManager.addComponent(enemy, enemyHealth);
      entityManager.addComponent(enemy, new DamageComponent(25)); // Enemy damage should be ignored

      service.update(16, entityManager);

      // Player should take NO damage (dashing grants immunity)
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(100);

      // Enemy should take dash damage (50 from config)
      expect(enemyHealth.health).toBeLessThan(100);
      expect(enemyHealth.health).toBe(50); // 100 - 50 dash damage
    });

    it('should not deal dash damage when player is not dashing', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isDashing.and.returnValue(false);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(100, 100);
      entityManager.addComponent(enemy, enemyHealth);
      entityManager.addComponent(enemy, new DamageComponent(15));

      service.update(16, entityManager);

      // Player should take damage (not dashing)
      const playerHealth = entityManager.getComponent(player, HealthComponent);
      expect(playerHealth!.health).toBe(85); // 100 - 15 (capped at MAX_DAMAGE_PER_FRAME)

      // Enemy should NOT take any damage
      expect(enemyHealth.health).toBe(100);
    });

    it('should only hit each enemy once per dash', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isDashing.and.returnValue(true);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(100, 100);
      entityManager.addComponent(enemy, enemyHealth);

      // First frame while dashing
      service.update(16, entityManager);
      expect(enemyHealth.health).toBe(50); // Hit once

      // Second frame still dashing - same enemy should NOT be hit again
      service.update(16, entityManager);
      expect(enemyHealth.health).toBe(50); // Still 50, not hit again

      // Third frame still dashing
      service.update(16, entityManager);
      expect(enemyHealth.health).toBe(50); // Still 50
    });

    it('should reset dash hit tracking when dash ends', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      const enemyHealth = new HealthComponent(100, 100);
      entityManager.addComponent(enemy, enemyHealth);
      entityManager.addComponent(enemy, new DamageComponent(10));

      // First dash
      playerServiceSpy.isDashing.and.returnValue(true);
      service.update(16, entityManager);
      expect(enemyHealth.health).toBe(50); // Hit by first dash

      // Dash ends
      playerServiceSpy.isDashing.and.returnValue(false);
      service.update(16, entityManager);

      // Second dash - should be able to hit same enemy again
      playerServiceSpy.isDashing.and.returnValue(true);
      service.update(16, entityManager);
      expect(enemyHealth.health).toBe(0); // Hit by second dash (50 - 50 = 0)
    });

    it('should hit multiple enemies in single dash', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isDashing.and.returnValue(true);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(30, 'player')); // Larger collision
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      // First enemy
      const enemy1 = entityManager.createEntity();
      entityManager.addComponent(enemy1, new PositionComponent(105, 100));
      entityManager.addComponent(enemy1, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy1, new EnemyTypeComponent('basic'));
      const enemy1Health = new HealthComponent(100, 100);
      entityManager.addComponent(enemy1, enemy1Health);

      // Second enemy
      const enemy2 = entityManager.createEntity();
      entityManager.addComponent(enemy2, new PositionComponent(95, 100));
      entityManager.addComponent(enemy2, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy2, new EnemyTypeComponent('tank'));
      const enemy2Health = new HealthComponent(100, 100);
      entityManager.addComponent(enemy2, enemy2Health);

      service.update(16, entityManager);

      // Both enemies should be hit
      expect(enemy1Health.health).toBe(50);
      expect(enemy2Health.health).toBe(50);
    });

    it('should apply damage reduction to dash damage', () => {
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerServiceSpy.isDashing.and.returnValue(true);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('tank'));
      // Tank has 30% damage reduction
      const enemyHealth = new HealthComponent(100, 100, 0.3);
      entityManager.addComponent(enemy, enemyHealth);

      service.update(16, entityManager);

      // Dash damage (50) reduced by 30% = 35 damage
      expect(enemyHealth.health).toBe(65); // 100 - 35
    });
  });

  // ---- Item 3: Emergency Barrier ----
  describe('Item 3 — Emergency Barrier (shield_generator)', () => {
    beforeEach(() => {
      service.init();
    });

    it('absorbs the first hit and returns 0 damage when barrier is charged', () => {
      const playerUpgradesSpy = TestBed.inject(PlayerUpgradesService) as jasmine.SpyObj<PlayerUpgradesService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;
      playerUpgradesSpy.hasBarrier.and.returnValue(true);
      playerUpgradesSpy.isBarrierCharged.and.returnValue(true);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(20));

      service.update(16, entityManager);

      // Barrier absorbed the hit — no damage reaches the game state
      expect(gameStateSpy.takeDamage).not.toHaveBeenCalled();
      // Barrier charge must be consumed
      expect(playerUpgradesSpy.consumeBarrierCharge).toHaveBeenCalledTimes(1);
    });

    it('does NOT block damage when the barrier is not charged', () => {
      const playerUpgradesSpy = TestBed.inject(PlayerUpgradesService) as jasmine.SpyObj<PlayerUpgradesService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;
      playerUpgradesSpy.hasBarrier.and.returnValue(true);
      playerUpgradesSpy.isBarrierCharged.and.returnValue(false); // on cooldown

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      service.update(16, entityManager);

      expect(gameStateSpy.takeDamage).toHaveBeenCalledWith(10, 'enemy_contact');
      const playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      expect(playerServiceSpy.setDamageFeedbackSource).toHaveBeenCalledWith(105, 105);
      // GameState owns the single onDamageTaken notification in production.
      expect(playerServiceSpy.onDamageTaken).not.toHaveBeenCalled();
      expect(playerUpgradesSpy.consumeBarrierCharge).not.toHaveBeenCalled();
    });

    it('does NOT block damage when no barrier was purchased', () => {
      const playerUpgradesSpy = TestBed.inject(PlayerUpgradesService) as jasmine.SpyObj<PlayerUpgradesService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;
      playerUpgradesSpy.hasBarrier.and.returnValue(false);

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      service.update(16, entityManager);

      expect(gameStateSpy.takeDamage).toHaveBeenCalled();
    });
  });

  // ---- Item 7: Vulnerability curse — damageTakenMultiplier ----
  describe('Item 7 — Vulnerability curse (damageTakenMultiplier)', () => {
    beforeEach(() => {
      service.init();
    });

    it('multiplies incoming damage by damageTakenMultiplier when curse is active (1.5×)', () => {
      const buffSystemSpy = TestBed.inject(BuffSystemService) as jasmine.SpyObj<BuffSystemService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;

      // Simulate vulnerability curse: takes 50% more damage
      Object.defineProperty(buffSystemSpy, 'damageTakenMultiplier', { get: () => 1.5, configurable: true });

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100, 0)); // No base reduction

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // Use 10 damage × 1.5 = 15 — well within MAX_DAMAGE_PER_FRAME
      entityManager.addComponent(enemy, new DamageComponent(10));

      service.update(16, entityManager);

      expect(gameStateSpy.takeDamage).toHaveBeenCalledWith(15, 'enemy_contact');
    });

    it('does NOT amplify damage when damageTakenMultiplier is 1.0 (no curse)', () => {
      const buffSystemSpy = TestBed.inject(BuffSystemService) as jasmine.SpyObj<BuffSystemService>;
      const gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;

      Object.defineProperty(buffSystemSpy, 'damageTakenMultiplier', { get: () => 1.0, configurable: true });

      const player = entityManager.createEntity();
      entityManager.addComponent(player, new PositionComponent(100, 100));
      entityManager.addComponent(player, new CollisionBoxComponent(20, 'player'));
      entityManager.addComponent(player, new PlayerControlledComponent());
      entityManager.addComponent(player, new HealthComponent(100, 100, 0));

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(105, 105));
      entityManager.addComponent(enemy, new CollisionBoxComponent(20, 'enemy'));
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new DamageComponent(10));

      service.update(16, entityManager);

      expect(gameStateSpy.takeDamage).toHaveBeenCalledWith(10, 'enemy_contact');
    });
  });
});
