import { TestBed } from '@angular/core/testing';
import { DeathDetectionSystemService } from './death-detection-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameStateService } from '../../state/game-state.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { TerritoryMomentumSystemService, TerritoryStrengthSystemService } from '../territory';
import { BeamCollisionSystemService, CollisionSystemService, ComboSystemService } from '../combat';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { VisualFeedbackCoordinatorService } from '../../services/visual-feedback-coordinator.service';
import { FactionAISystemService } from '../enemy-ai/faction-ai-system.service';
import { IdleBehaviorSystemService } from '../enemy-ai/idle-behavior-system.service';
import { EnemyMovementSystemService } from '../enemy-ai/enemy-movement-system.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { CameraShakeService } from '../../effects/camera-shake.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { SettingsService } from '../../utils/settings.service';
import { AudioService } from '../../audio/audio.service';
import { TimeScaleService } from '../../engine/time-scale.service';
import { AchievementService } from '../../../services/achievement.service';
import { DifficultyService } from '../../../services/difficulty.service';
import { RenderingSystemService } from '../rendering/rendering-system.service';
import { Component, ComponentType } from '../../ecs/ecs.model';
import {
  EnemyTypeComponent,
  FactionComponent,
  HealthComponent,
  MinionTagComponent,
  PositionComponent,
  RenderableComponent,
  SplitOnDeathComponent,
} from '@photon/components';
import { MinionTrackerService } from '../enemy-ai/minion-tracker.service';

describe('DeathDetectionSystemService', () => {
  let service: DeathDetectionSystemService;
  let entityManager: EntityManagerService;
  let entityFactorySpy: jasmine.SpyObj<EntityFactoryECSService>;
  let effectFactorySpy: jasmine.SpyObj<EffectFactoryService>;
  let visualFeedbackSpy: jasmine.SpyObj<VisualFeedbackCoordinatorService>;
  let territoryMomentumSpy: jasmine.SpyObj<TerritoryMomentumSystemService>;
  let territoryStrengthSpy: jasmine.SpyObj<TerritoryStrengthSystemService>;
  let minionTrackerSpy: jasmine.SpyObj<MinionTrackerService>;

  beforeEach(() => {
    const gameStateSpy = jasmine.createSpyObj('GameStateService', [
      'getHealth',
      'getKillStreak',
      'incrementKills',
      'isGameOver',
      'isRunEnded',
    ]);
    gameStateSpy.getHealth.and.returnValue(100);
    gameStateSpy.getKillStreak.and.returnValue(0);
    gameStateSpy.isGameOver.and.returnValue(false);
    gameStateSpy.isRunEnded.and.returnValue(false);

    entityFactorySpy = jasmine.createSpyObj('EntityFactoryECSService', ['returnToPool', 'createShard', 'createEnemy']);
    entityFactorySpy.createEnemy.and.returnValue(-1); // default: no-op child

    effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', ['createEnemyExplosion']);

    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['addXp'], {
      level: 1,
    });

    territoryStrengthSpy = jasmine.createSpyObj('TerritoryStrengthSystemService', ['weakenTilesFromKill']);

    territoryMomentumSpy = jasmine.createSpyObj('TerritoryMomentumSystemService', ['recordPlayerKill']);

    const collisionSystemSpy = jasmine.createSpyObj('CollisionSystemService', ['cleanupDeadEnemy']);

    const comboSystemSpy = jasmine.createSpyObj('ComboSystemService', [
      'recordKill',
      'registerKill',
      'getCurrentMultiplier',
    ]);
    comboSystemSpy.getCurrentMultiplier.and.returnValue(1);

    const errorHandlerSpy = jasmine.createSpyObj('ErrorHandlerService', ['safeExecute', 'safeGetComponent']);
    errorHandlerSpy.safeExecute.and.callFake((fn: () => void) => fn());
    errorHandlerSpy.safeGetComponent.and.callFake(
      <T extends Component>(em: EntityManagerService, entityId: number, componentType: ComponentType<T>) =>
        em.getComponent(entityId, componentType) ?? null
    );

    visualFeedbackSpy = jasmine.createSpyObj('VisualFeedbackCoordinatorService', ['showKill']);

    const beamCollisionSpy = jasmine.createSpyObj('BeamCollisionSystemService', ['cleanupDeadEnemy']);

    const factionAiSpy = jasmine.createSpyObj('FactionAISystemService', ['cleanupDeadEnemy']);

    const idleBehaviorSpy = jasmine.createSpyObj('IdleBehaviorSystemService', ['cleanupDeadEnemy']);

    const enemyMovementSpy = jasmine.createSpyObj('EnemyMovementSystemService', ['cleanupDeadEnemy']);

    const cameraShakeSpy = jasmine.createSpyObj('CameraShakeService', ['addShake']);

    const postProcessingSpy = jasmine.createSpyObj('PostProcessingService', ['addChromaticAberration']);

    const settingsSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
    settingsSpy.getSettings.and.returnValue({ screenShake: false, showDamageNumbers: false });

    const achievementSpy = jasmine.createSpyObj('AchievementService', [
      'recordKill',
      'recordKillStreak',
      'recordComboMultiplier',
    ]);

    minionTrackerSpy = jasmine.createSpyObj('MinionTrackerService', [
      'cleanupOwner',
      'recordMinionDeath',
      'getAliveCount',
      'recordSpawn',
      'prune',
      'reset',
    ]);

    TestBed.configureTestingModule({
      providers: [
        DeathDetectionSystemService,
        EntityManagerService,
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: TerritoryStrengthSystemService, useValue: territoryStrengthSpy },
        { provide: TerritoryMomentumSystemService, useValue: territoryMomentumSpy },
        { provide: CollisionSystemService, useValue: collisionSystemSpy },
        { provide: ComboSystemService, useValue: comboSystemSpy },
        { provide: ErrorHandlerService, useValue: errorHandlerSpy },
        { provide: VisualFeedbackCoordinatorService, useValue: visualFeedbackSpy },
        { provide: BeamCollisionSystemService, useValue: beamCollisionSpy },
        { provide: FactionAISystemService, useValue: factionAiSpy },
        { provide: IdleBehaviorSystemService, useValue: idleBehaviorSpy },
        { provide: EnemyMovementSystemService, useValue: enemyMovementSpy },
        { provide: CameraShakeService, useValue: cameraShakeSpy },
        { provide: PostProcessingService, useValue: postProcessingSpy },
        {
          provide: SettingsService,
          useValue: (() => {
            const s = jasmine.createSpyObj('SettingsService', ['getSettings']);
            s.getSettings.and.returnValue({
              showDamageNumbers: true,
              volume: 100,
              screenShake: true,
              sensitivity: 100,
              chromaticAberration: true,
              lowHealthVignette: true,
            });
            return s;
          })(),
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
        { provide: AchievementService, useValue: achievementSpy },
        {
          provide: TimeScaleService,
          useValue: jasmine.createSpyObj('TimeScaleService', ['applySlowMotion']),
        },
        {
          provide: DifficultyService,
          useValue: jasmine.createSpyObj('DifficultyService', ['getDifficulty', 'getModifiers']),
        },
        {
          provide: RenderingSystemService,
          useValue: jasmine.createSpyObj('RenderingSystemService', ['cleanupDeadEnemy']),
        },
        { provide: MinionTrackerService, useValue: minionTrackerSpy },
      ],
    });

    service = TestBed.inject(DeathDetectionSystemService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  function createDeadEnemy(damageSource: 'player' | 'environmental' | 'unknown' = 'player'): number {
    const enemy = entityManager.createEntity();
    entityManager.addComponent(enemy, new PositionComponent(100, 100));
    const health = new HealthComponent(100, 100);
    health.health = 0;
    health.isDead = false;
    health.lastDamageSource = damageSource;
    entityManager.addComponent(enemy, health);
    entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
    entityManager.addComponent(enemy, new FactionComponent(1));
    entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));
    return enemy;
  }

  describe('environmental kills', () => {
    it('should NOT drop shards for environmental kills', () => {
      createDeadEnemy('environmental');

      service.update(16, entityManager);

      expect(entityFactorySpy.createShard).not.toHaveBeenCalled();
    });

    it('should NOT show kill feed for environmental kills', () => {
      createDeadEnemy('environmental');

      service.update(16, entityManager);

      expect(visualFeedbackSpy.showKill).not.toHaveBeenCalled();
    });

    it('should NOT record territory momentum for environmental kills', () => {
      createDeadEnemy('environmental');

      service.update(16, entityManager);

      expect(territoryMomentumSpy.recordPlayerKill).not.toHaveBeenCalled();
    });

    it('should still weaken territory for environmental kills', () => {
      createDeadEnemy('environmental');

      service.update(16, entityManager);

      expect(territoryStrengthSpy.weakenTilesFromKill).toHaveBeenCalledWith(100, 100);
    });

    it('should create explosion effect for environmental kills', () => {
      createDeadEnemy('environmental');

      service.update(16, entityManager);

      expect(effectFactorySpy.createEnemyExplosion).toHaveBeenCalledWith({ x: 100, y: 100 }, 0.8);
    });

    it('should return enemy to pool for environmental kills', () => {
      const enemy = createDeadEnemy('environmental');

      service.update(16, entityManager);

      expect(entityFactorySpy.returnToPool).toHaveBeenCalledWith(jasmine.any(String), enemy);
    });
  });

  describe('player kills', () => {
    it('should show kill feed for player kills', () => {
      createDeadEnemy('player');

      service.update(16, entityManager);

      expect(visualFeedbackSpy.showKill).toHaveBeenCalled();
    });

    it('should record territory momentum for player kills', () => {
      createDeadEnemy('player');

      service.update(16, entityManager);

      expect(territoryMomentumSpy.recordPlayerKill).toHaveBeenCalledWith(1, 100, 100);
    });

    it('should weaken territory for player kills', () => {
      createDeadEnemy('player');

      service.update(16, entityManager);

      expect(territoryStrengthSpy.weakenTilesFromKill).toHaveBeenCalledWith(100, 100);
    });
  });

  describe('shard value scaling by enemy type', () => {
    function createDeadEnemyOfType(type: string): number {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent(type));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));
      return enemy;
    }

    beforeEach(() => {
      // Force shard drops — override Math.random to always return 0 (< 0.7 threshold)
      spyOn(Math, 'random').and.returnValue(0);
    });

    it('should drop shards with value 1 for basic enemies', () => {
      createDeadEnemyOfType('basic');

      service.update(16, entityManager);

      expect(entityFactorySpy.createShard).toHaveBeenCalledWith(jasmine.any(Number), jasmine.any(Number), 1);
    });

    it('should drop shards with value 2 for tank enemies', () => {
      createDeadEnemyOfType('tank');

      service.update(16, entityManager);

      expect(entityFactorySpy.createShard).toHaveBeenCalledWith(jasmine.any(Number), jasmine.any(Number), 2);
    });

    it('should drop shards with value 3 for sniper enemies', () => {
      createDeadEnemyOfType('sniper');

      service.update(16, entityManager);

      expect(entityFactorySpy.createShard).toHaveBeenCalledWith(jasmine.any(Number), jasmine.any(Number), 3);
    });

    it('should drop shards with value 8 for boss enemies', () => {
      createDeadEnemyOfType('boss');

      service.update(16, entityManager);

      expect(entityFactorySpy.createShard).toHaveBeenCalledWith(jasmine.any(Number), jasmine.any(Number), 8);
    });

    it('should fall back to basic shard value for unknown enemy types', () => {
      createDeadEnemyOfType('unknown_alien');

      service.update(16, entityManager);

      expect(entityFactorySpy.createShard).toHaveBeenCalledWith(jasmine.any(Number), jasmine.any(Number), 1);
    });
  });

  describe('unknown damage source', () => {
    it('should treat unknown damage source as player kill (drop rewards)', () => {
      createDeadEnemy('unknown');

      service.update(16, entityManager);

      expect(visualFeedbackSpy.showKill).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle multiple enemies dying in same frame', () => {
      createDeadEnemy('player');
      createDeadEnemy('player');
      createDeadEnemy('environmental');

      // Should process without errors
      expect(() => service.update(16, entityManager)).not.toThrow();
      // At least one explosion should be created
      expect(effectFactorySpy.createEnemyExplosion).toHaveBeenCalled();
    });

    it('should skip enemies already marked as dead', () => {
      const enemy = createDeadEnemy('player');
      const health = entityManager.getComponent(enemy, HealthComponent)!;
      health.isDead = true; // Already processed

      service.update(16, entityManager);

      expect(effectFactorySpy.createEnemyExplosion).not.toHaveBeenCalled();
    });

    it('should skip enemies with health > 0', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(100, 100);
      health.health = 50; // Still alive
      health.isDead = false;
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));

      service.update(16, entityManager);

      expect(effectFactorySpy.createEnemyExplosion).not.toHaveBeenCalled();
    });

    it('should handle enemy without PositionComponent', () => {
      const enemy = entityManager.createEntity();
      // No PositionComponent
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));

      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should handle enemy without FactionComponent', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      // No FactionComponent
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));

      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should handle empty entity list', () => {
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should handle zero deltaTime', () => {
      createDeadEnemy('player');

      expect(() => service.update(0, entityManager)).not.toThrow();
    });

    it('should handle negative health values gracefully', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(100, 100);
      health.health = -50; // Overkill damage
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));

      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should mark enemy as dead after processing', () => {
      const enemy = createDeadEnemy('player');

      service.update(16, entityManager);

      const health = entityManager.getComponent(enemy, HealthComponent);
      expect(health?.isDead).toBeTrue();
    });
  });

  describe('special enemy types', () => {
    it('should handle elite enemy death without error', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(200, 200);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      const enemyType = new EnemyTypeComponent('basic');
      (enemyType as { isElite: boolean }).isElite = true;
      entityManager.addComponent(enemy, enemyType);
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));

      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should handle boss enemy death without error', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(500, 500);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('boss'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 40));

      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should process new deaths after previous frame', () => {
      createDeadEnemy('player');
      expect(() => service.update(16, entityManager)).not.toThrow();

      // Create another enemy after first was processed
      createDeadEnemy('player');
      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  describe('splitOnDeath', () => {
    function createDeadSwarm(damageSource: 'player' | 'environmental' = 'player'): number {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(200, 200));
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = damageSource;
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('swarm'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 12));
      entityManager.addComponent(enemy, new SplitOnDeathComponent()); // gen=0, maxGen=1
      return enemy;
    }

    it('spawns 2 child swarms when a gen-0 Swarm dies to player', () => {
      createDeadSwarm('player');

      service.update(16, entityManager);

      expect(entityFactorySpy.createEnemy).toHaveBeenCalledTimes(2);
    });

    it('does NOT spawn children for environmental kill on splittable enemy', () => {
      createDeadSwarm('environmental');

      service.update(16, entityManager);

      expect(entityFactorySpy.createEnemy).not.toHaveBeenCalled();
    });

    it('does NOT spawn children for enemy without SplitOnDeathComponent', () => {
      // Plain basic enemy — no SplitOnDeathComponent
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(200, 200));
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));
      // No SplitOnDeathComponent

      service.update(16, entityManager);

      expect(entityFactorySpy.createEnemy).not.toHaveBeenCalled();
    });

    it('child SplitOnDeathComponent has canSplit()=false at gen 1 (no infinite recursion)', () => {
      // Manually verify the generation boundary without running the full system
      const childSplit = new SplitOnDeathComponent(); // defaults: gen=0, maxGen=1
      childSplit.generation = 1; // simulate what processSplitOnDeath sets on the child
      expect(childSplit.canSplit()).toBeFalse();
    });

    it('scales child HP to 50% of parent maxHealth', () => {
      // Use childCount=1 so only one child is created, giving a clean single-write.
      const parent = entityManager.createEntity();
      entityManager.addComponent(parent, new PositionComponent(200, 200));
      const parentHealth = new HealthComponent(100, 100);
      parentHealth.health = 0;
      parentHealth.isDead = false;
      parentHealth.lastDamageSource = 'player';
      entityManager.addComponent(parent, parentHealth);
      entityManager.addComponent(parent, new EnemyTypeComponent('swarm'));
      entityManager.addComponent(parent, new FactionComponent(1));
      entityManager.addComponent(parent, new RenderableComponent('enemy', 12));
      // childCount=1 avoids double-scaling through the same spy entity
      entityManager.addComponent(parent, new SplitOnDeathComponent(1, 0, 1, 0.5, 28));

      const childId = entityManager.createEntity();
      const childHealth = new HealthComponent(100, 100);
      entityManager.addComponent(childId, childHealth);
      const childSplit = new SplitOnDeathComponent();
      entityManager.addComponent(childId, childSplit);
      entityFactorySpy.createEnemy.and.returnValue(childId);

      service.update(16, entityManager);

      expect(childHealth.maxHealth).toBe(50);
      expect(childHealth.health).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // B2: Boss defeated — playBossBurst + bonus shards
  // -------------------------------------------------------------------------
  describe('boss defeated rewards', () => {
    let audioSpy: jasmine.SpyObj<AudioService>;

    beforeEach(() => {
      audioSpy = TestBed.inject(AudioService) as jasmine.SpyObj<AudioService>;
    });

    it('calls audio.playBossBurst() when a boss enemy dies to a player kill', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(300, 400));
      const health = new HealthComponent(500, 500);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('boss'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 40));

      service.update(16, entityManager);

      expect(audioSpy.playBossBurst).toHaveBeenCalled();
    });

    it('creates 5 bonus-shard entities (value 5 each = +25 total) when a boss dies', () => {
      // Override Math.random: 0 ensures normal shard drops as well
      spyOn(Math, 'random').and.returnValue(0);
      entityFactorySpy.createShard.calls.reset();

      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(300, 400));
      const health = new HealthComponent(500, 500);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('boss'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 40));

      service.update(16, entityManager);

      // Expect at least 5 calls with value=5 (bonus shards)
      const bonusCalls = entityFactorySpy.createShard.calls.allArgs().filter((args: unknown[]) => args[2] === 5);
      expect(bonusCalls.length).toBe(5);
    });

    it('does NOT call audio.playBossBurst() for a basic enemy death', () => {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));

      service.update(16, entityManager);

      expect(audioSpy.playBossBurst).not.toHaveBeenCalled();
    });
  });

  describe('minionTracker integration', () => {
    function createDeadEnemy(damageSource: 'player' | 'environmental' = 'player'): number {
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new PositionComponent(100, 100));
      const health = new HealthComponent(100, 100);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = damageSource;
      entityManager.addComponent(enemy, health);
      entityManager.addComponent(enemy, new EnemyTypeComponent('tank'));
      entityManager.addComponent(enemy, new FactionComponent(1));
      entityManager.addComponent(enemy, new RenderableComponent('enemy', 20));
      return enemy;
    }

    it('should call cleanupOwner when a summoner enemy dies', () => {
      const ownerId = createDeadEnemy('player');

      service.update(16, entityManager);

      expect(minionTrackerSpy.cleanupOwner).toHaveBeenCalledWith(ownerId);
    });

    it('should call recordMinionDeath when an entity with MinionTagComponent dies', () => {
      const ownerId = 999;
      const minion = entityManager.createEntity();
      entityManager.addComponent(minion, new PositionComponent(100, 100));
      const health = new HealthComponent(50, 50);
      health.health = 0;
      health.isDead = false;
      health.lastDamageSource = 'player';
      entityManager.addComponent(minion, health);
      entityManager.addComponent(minion, new EnemyTypeComponent('swarm'));
      entityManager.addComponent(minion, new FactionComponent(1));
      entityManager.addComponent(minion, new RenderableComponent('enemy', 10));
      entityManager.addComponent(minion, new MinionTagComponent(ownerId));

      service.update(16, entityManager);

      expect(minionTrackerSpy.recordMinionDeath).toHaveBeenCalledWith(minion, ownerId);
    });

    it('should NOT call recordMinionDeath for a plain enemy without MinionTagComponent', () => {
      createDeadEnemy('player');

      service.update(16, entityManager);

      expect(minionTrackerSpy.recordMinionDeath).not.toHaveBeenCalled();
    });
  });
});
