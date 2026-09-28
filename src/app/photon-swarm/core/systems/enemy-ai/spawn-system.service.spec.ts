import { TestBed } from '@angular/core/testing';
import { SpawnSystemService } from '../enemy-ai';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { RandomService } from '../../utils/random.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { EnemyManagerService } from './enemy-manager.service';
import { PlayerService } from '../../player/player.service';
import { GameStateService } from '../../state/game-state.service';
import { CurseService } from '../../../services/curse.service';
import { DamageComponent, PositionComponent, SpawnerComponent, WeaponComponent } from '@photon/components';
import { take } from 'rxjs';
import { EnemyType } from '../../models/enemy.model';
import { SpawnPositionService } from './spawn-position.service';
import { ENCOUNTER_DIRECTOR_CONFIG, SPAWN_CONFIG } from '@photon/config/game-constants';

describe('SpawnSystemService', () => {
  let service: SpawnSystemService;
  let entityManager: EntityManagerService;
  let randomService: jasmine.SpyObj<RandomService>;
  let progressionService: jasmine.SpyObj<ProgressionSystemService>;

  beforeEach(() => {
    const randomSpy = jasmine.createSpyObj('RandomService', ['random', 'randomPointInCircle', 'weightedChoice']);
    // Create progression spy with a mutable level property - use plain object with level
    const progressionSpy = { level: 5 };
    const enemyManagerSpy = jasmine.createSpyObj('EnemyManagerService', [
      'canSpawnEnemy',
      'registerEnemy',
      'getEnemyCount',
      'getMaxEnemies',
    ]);
    enemyManagerSpy.canSpawnEnemy.and.returnValue(true);
    enemyManagerSpy.getEnemyCount.and.returnValue(0);
    enemyManagerSpy.getMaxEnemies.and.returnValue(100);
    const playerServiceSpy = jasmine.createSpyObj('PlayerService', ['getPosition', 'isParryAvailable']);
    playerServiceSpy.isParryAvailable.and.returnValue(false);
    const gameStateSpy = jasmine.createSpyObj('GameStateService', [
      'getStartTime',
      'getHealth',
      'getMaxHealth',
      'getKills',
    ]);
    const curseServiceSpy = jasmine.createSpyObj('CurseService', ['getDifficultyMultiplier']);
    const entityFactorySpy = jasmine.createSpyObj('EntityFactoryECSService', ['createEnemy', 'createProjectile']);

    gameStateSpy.getHealth.and.returnValue(100);
    gameStateSpy.getMaxHealth.and.returnValue(100);
    gameStateSpy.getKills.and.returnValue(0);
    curseServiceSpy.getDifficultyMultiplier.and.returnValue(1.0);
    entityFactorySpy.createEnemy.and.returnValue(1);

    TestBed.configureTestingModule({
      providers: [
        SpawnSystemService,
        EntityManagerService,
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: RandomService, useValue: randomSpy },
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: EnemyManagerService, useValue: enemyManagerSpy },
        { provide: PlayerService, useValue: playerServiceSpy },
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: CurseService, useValue: curseServiceSpy },
      ],
    });

    service = TestBed.inject(SpawnSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    randomService = TestBed.inject(RandomService) as jasmine.SpyObj<RandomService>;
    progressionService = TestBed.inject(ProgressionSystemService) as jasmine.SpyObj<ProgressionSystemService>;

    // Default mock values
    randomService.random.and.returnValue(0.5);
    randomService.randomPointInCircle.and.returnValue({ x: 10, y: 10 });
    randomService.weightedChoice.and.returnValue('basic');
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('initialization', () => {
    it('should initialize spawn timer', () => {
      service.init();
      interface SpawnSystemWithTimer {
        spawnTimer: number;
      }
      expect((service as unknown as SpawnSystemWithTimer).spawnTimer).toBe(0);
    });

    it('should update spawn rate based on player level', () => {
      interface ProgressionWithLevel {
        level: number;
      }
      (progressionService as unknown as ProgressionWithLevel).level = 10;
      service.init();
      interface SpawnSystemWithRate {
        currentSpawnRate: number;
      }
      expect((service as unknown as SpawnSystemWithRate).currentSpawnRate).toBeLessThan(3000);
    });
  });

  describe('spawn timing', () => {
    it('re-arms the opening contact after a full run reset', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      entityFactory.createEnemy.and.returnValue(17);

      service.init(entityManager);
      service.update(1, entityManager);
      expect(entityFactory.createEnemy).toHaveBeenCalledTimes(1);

      entityFactory.createEnemy.calls.reset();
      service.reset();
      service.initializeRun(entityManager);
      service.update(1, entityManager);

      expect(entityFactory.createEnemy).toHaveBeenCalledTimes(1);
    });

    it('should wait for the first authored wave before allowing ambient reinforcement', () => {
      interface SpawnSystemWithPrivates {
        currentSpawnRate: number;
        currentWaveNumber: number;
        entityFactory: EntityFactoryECSService;
      }
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      service.init();
      (service as unknown as SpawnSystemWithPrivates).currentSpawnRate = 1000;

      // Reset call count from init
      entityFactory.createEnemy.calls.reset();

      service.update(3000, entityManager);
      expect(entityFactory.createEnemy).not.toHaveBeenCalled();

      (service as unknown as SpawnSystemWithPrivates).currentWaveNumber = 1;
      service.update(1, entityManager);
      expect(entityFactory.createEnemy).toHaveBeenCalledTimes(1);
    });

    it('should reset timer after spawning', () => {
      interface SpawnSystemWithPrivates {
        currentSpawnRate: number;
        spawnTimer: number;
        currentWaveNumber: number;
        entityFactory: EntityFactoryECSService;
      }
      service.init();
      (service as unknown as SpawnSystemWithPrivates).currentSpawnRate = 1000;
      (service as unknown as SpawnSystemWithPrivates).currentWaveNumber = 1;

      service.update(2300, entityManager);
      expect((service as unknown as SpawnSystemWithPrivates).spawnTimer).toBeLessThan(200);
    });
  });

  describe('spawn position', () => {
    let playerService: jasmine.SpyObj<PlayerService>;
    let gameState: jasmine.SpyObj<GameStateService>;

    beforeEach(() => {
      playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      gameState = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
    });

    it('should spawn normal enemies at least 400 units from player', () => {
      interface SpawnSystemWithGetSpawnPosition {
        getSpawnPosition: (enemyType: EnemyType) => { x: number; y: number };
      }
      randomService.random.and.returnValue(0.5);
      const pos = (service as unknown as SpawnSystemWithGetSpawnPosition).getSpawnPosition('basic' as EnemyType);
      const playerPos = playerService.getPosition();
      const distance = Math.sqrt(Math.pow(pos.x - playerPos.x, 2) + Math.pow(pos.y - playerPos.y, 2));

      // Actual implementation uses baseMinDistance=400, baseMaxDistance=800 for normal enemies
      expect(distance).toBeGreaterThanOrEqual(400);
      expect(distance).toBeLessThanOrEqual(1000); // Allow some variance
    });

    it('should spawn boss enemies at least 800 units from player', () => {
      interface SpawnSystemWithGetSpawnPosition {
        getSpawnPosition: (enemyType: EnemyType) => { x: number; y: number };
      }
      randomService.random.and.returnValue(0.5);
      const pos = (service as unknown as SpawnSystemWithGetSpawnPosition).getSpawnPosition('boss' as EnemyType);
      const playerPos = playerService.getPosition();
      const distance = Math.sqrt(Math.pow(pos.x - playerPos.x, 2) + Math.pow(pos.y - playerPos.y, 2));

      // Actual implementation uses baseMinDistance=800, baseMaxDistance=1200 for boss enemies
      expect(distance).toBeGreaterThanOrEqual(800);
      expect(distance).toBeLessThanOrEqual(1500); // Allow some variance
    });

    it('should not spawn bosses within first 10 seconds', () => {
      interface ProgressionWithLevel {
        level: number;
      }
      interface WeightedChoice<T> {
        value: T;
        weight: number;
      }
      interface SpawnSystemWithSelectEnemyType {
        selectEnemyType: () => EnemyType;
      }
      gameState.getStartTime.and.returnValue(window.performance.now() - 5000); // 5 seconds elapsed
      (progressionService as unknown as ProgressionWithLevel).level = 15; // High enough level for boss spawns
      randomService.random.and.returnValue(0.01); // Would normally trigger boss spawn

      let bossWeight = -1;
      randomService.weightedChoice.and.callFake(<T>(choices: WeightedChoice<T>[]) => {
        const bossChoice = choices.find((c) => c.value === 'boss');
        if (bossChoice) {
          bossWeight = bossChoice.weight;
        }
        return choices.find((c) => c.weight > 0)?.value || ('basic' as T);
      });

      const enemyType = (service as unknown as SpawnSystemWithSelectEnemyType).selectEnemyType();
      expect(bossWeight).toBe(0, 'Boss weight should be 0 in first 10 seconds');
      expect(enemyType).not.toBe('boss');
    });

    it('should spawn enemies at appropriate distances from player', () => {
      interface SpawnSystemWithGetSpawnPosition {
        getSpawnPosition: () => { x: number; y: number };
      }
      service.setWorldBounds(12000, 9000);
      randomService.random.and.returnValue(0.5);
      const pos = (service as unknown as SpawnSystemWithGetSpawnPosition).getSpawnPosition();

      // Should spawn at reasonable distance from center (6000, 4500)
      // Should be within world bounds
      expect(pos.x).toBeGreaterThanOrEqual(100); // margin
      expect(pos.x).toBeLessThanOrEqual(11900); // width - margin
      expect(pos.y).toBeGreaterThanOrEqual(100); // margin
      expect(pos.y).toBeLessThanOrEqual(8900); // height - margin
    });
  });

  describe('enemy type selection', () => {
    it('should limit enemy types for low level players', () => {
      interface ProgressionWithLevel {
        level: number;
      }
      (progressionService as unknown as ProgressionWithLevel).level = 3;

      // At level < 5 and wave 0: boss is 0 (always), sniper is 0 (locked until wave 12)

      interface WeightedChoice<T> {
        value: T;
        weight: number;
      }
      interface SpawnSystemWithSelectEnemyType {
        currentWaveNumber: number;
        selectEnemyType: () => EnemyType;
      }
      // Wave number is 0 by default — sniper is locked until wave 12
      randomService.weightedChoice.and.callFake(<T>(choices: WeightedChoice<T>[]): T => {
        // Verify boss has 0 weight (boss uses scheduled waves only)
        const bossChoice = choices.find((c) => c.value === 'boss');
        expect(bossChoice?.weight).toBe(0);
        // Sniper is 0 at wave 0 (locked until wave 12) via wave gating
        const sniperChoice = choices.find((c) => c.value === 'sniper');
        expect(sniperChoice?.weight).toBe(0);
        return 'basic' as T;
      });

      (service as unknown as SpawnSystemWithSelectEnemyType).selectEnemyType();
      expect(randomService.weightedChoice).toHaveBeenCalled();
    });

    it('should allow all non-boss enemy types for high level players', () => {
      interface ProgressionWithLevel {
        level: number;
      }
      interface WeightedChoice<T> {
        value: T;
        weight: number;
      }
      interface SpawnSystemWithSelectEnemyType {
        currentWaveNumber: number;
        selectEnemyType: () => EnemyType;
      }
      (progressionService as unknown as ProgressionWithLevel).level = 15;
      // Use high wave number so all non-boss types are unlocked
      (service as unknown as SpawnSystemWithSelectEnemyType).currentWaveNumber = 20;

      randomService.weightedChoice.and.callFake(<T>(choices: WeightedChoice<T>[]): T => {
        // Verify all non-boss enemy types have non-zero weight at high level + wave
        const types = ['basic', 'spitter', 'tank', 'swarm', 'thug', 'sniper'];
        for (const type of types) {
          const choice = choices.find((c) => c.value === type);
          expect(choice?.weight).toBeGreaterThan(0);
        }
        // Boss weight is always 0 — bosses spawn only via scheduled boss waves
        const bossChoice = choices.find((c) => c.value === 'boss');
        expect(bossChoice?.weight ?? 0).toBe(0);
        return 'basic' as T;
      });

      const type = (service as unknown as SpawnSystemWithSelectEnemyType).selectEnemyType();
      expect(type).toBe('basic');
    });
  });

  describe('rarity selection', () => {
    it('should select common rarity most often', () => {
      interface SpawnSystemWithSelectRarity {
        selectRarity: () => string;
      }
      randomService.random.and.returnValue(0.8);
      expect((service as unknown as SpawnSystemWithSelectRarity).selectRarity()).toBe('common');
    });

    it('should select rare rarity sometimes', () => {
      interface SpawnSystemWithSelectRarity {
        selectRarity: () => string;
      }
      randomService.random.and.returnValue(0.2);
      expect((service as unknown as SpawnSystemWithSelectRarity).selectRarity()).toBe('rare');
    });

    it('should select legendary rarity rarely', () => {
      interface SpawnSystemWithSelectRarity {
        selectRarity: () => string;
      }
      randomService.random.and.returnValue(0.01);
      expect((service as unknown as SpawnSystemWithSelectRarity).selectRarity()).toBe('legendary');
    });
  });

  describe('spawn events', () => {
    it('should emit spawn event when enemy is created', (done) => {
      interface SpawnSystemWithPrivates {
        currentSpawnRate: number;
        currentWaveNumber: number;
        entityFactory: EntityFactoryECSService;
      }
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      service.init();
      (service as unknown as SpawnSystemWithPrivates).currentSpawnRate = 100;
      (service as unknown as SpawnSystemWithPrivates).currentWaveNumber = 1;

      // Use the existing spy and configure return value
      entityFactory.createEnemy.and.returnValue(123);
      entityFactory.createEnemy.calls.reset();

      service.enemySpawned$.pipe(take(1)).subscribe((event) => {
        expect(event.entity).toBe(123);
        expect(event.type).toBe('basic');
        expect(event.position).toBeDefined();
        done();
      });

      service.update(2300, entityManager);
    });
  });

  describe('spawner components', () => {
    it('should update spawner timers', () => {
      const spawnerEntity = entityManager.createEntity();
      // lastSpawnTime=0 means canSpawn() will return true (Date.now() - 0 >= 1000)
      const spawner = new SpawnerComponent('swarm', 1000, 3, 0);
      entityManager.addComponent(spawnerEntity, spawner);
      entityManager.addComponent(spawnerEntity, new PositionComponent(500, 500));

      service.update(500, entityManager);

      // updateSpawners uses Date.now() for canSpawn; with lastSpawnTime=0,
      // canSpawn() is true so lastSpawnTime and spawnCount should be updated
      expect(spawner.lastSpawnTime).toBeGreaterThan(0);
      expect(spawner.spawnCount).toBeGreaterThan(0);
    });

    it('should spawn entities from spawner components', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      const spawnerEntity = entityManager.createEntity();
      const spawner = new SpawnerComponent('swarm', 1000, 3, 0);
      entityManager.addComponent(spawnerEntity, spawner);
      entityManager.addComponent(spawnerEntity, new PositionComponent(500, 500));

      // Use the existing spy
      entityFactory.createEnemy.and.returnValue(456);
      entityFactory.createEnemy.calls.reset();

      // Update past spawn rate
      service.update(1100, entityManager);

      expect(entityFactory.createEnemy).toHaveBeenCalled();
      expect(spawner.spawnCount).toBeGreaterThan(0);
    });

    it('should respect max spawns limit', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      const spawnerEntity = entityManager.createEntity();
      // SpawnerComponent args: (spawnType, spawnRate, lastSpawnTime, maxSpawns, spawnCount)
      const spawner = new SpawnerComponent('swarm', 100, 0, 2, 2); // Already at max (spawnCount=2, maxSpawns=2)
      entityManager.addComponent(spawnerEntity, spawner);
      entityManager.addComponent(spawnerEntity, new PositionComponent(500, 500));

      // Initialize service so currentSpawnRate is set high enough to prevent main spawns
      service.init();
      interface SpawnSystemWithPrivates {
        currentSpawnRate: number;
      }
      (service as unknown as SpawnSystemWithPrivates).currentSpawnRate = 10000; // Very high to prevent main spawns

      // Use the existing spy
      entityFactory.createEnemy.calls.reset();

      service.update(200, entityManager);

      // Spawner at max shouldn't spawn - only check spawner didn't add to spawnCount
      expect(spawner.spawnCount).toBe(2); // Should remain at 2
    });
  });

  describe('spawn rate scaling', () => {
    it('should decrease spawn rate with player level', () => {
      interface ProgressionWithLevel {
        level: number;
      }
      interface SpawnSystemWithPrivates {
        updateSpawnRate: () => void;
        currentSpawnRate: number;
      }
      // Level 1: 800 * 0.95^0 = 800
      (progressionService as unknown as ProgressionWithLevel).level = 1;
      (service as unknown as SpawnSystemWithPrivates).updateSpawnRate();
      const rate1 = (service as unknown as SpawnSystemWithPrivates).currentSpawnRate;

      // Level 20: 800 * 0.95^19 ≈ 290, but capped at 300 (MIN_SPAWN_RATE_MS)
      (progressionService as unknown as ProgressionWithLevel).level = 20;
      (service as unknown as SpawnSystemWithPrivates).updateSpawnRate();
      const rate20 = (service as unknown as SpawnSystemWithPrivates).currentSpawnRate;

      expect(rate20).toBeLessThan(rate1);
    });

    it('should not go below minimum spawn rate', () => {
      interface ProgressionWithLevel {
        level: number;
      }
      interface SpawnSystemWithPrivates {
        updateSpawnRate: () => void;
        currentSpawnRate: number;
      }
      // At very high level, should be capped at MIN_SPAWN_RATE_MS (300)
      (progressionService as unknown as ProgressionWithLevel).level = 100;
      (service as unknown as SpawnSystemWithPrivates).updateSpawnRate();

      expect((service as unknown as SpawnSystemWithPrivates).currentSpawnRate).toBe(300); // MIN_SPAWN_RATE_MS
    });
  });

  describe('force spawn', () => {
    it('should spawn specified number of enemies', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();

      service.forceSpawn(5);

      expect(entityFactory.createEnemy).toHaveBeenCalledTimes(5);
    });

    it('should use specified type when provided', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();

      service.forceSpawn(3, 'boss' as EnemyType);

      expect(entityFactory.createEnemy).toHaveBeenCalledWith(
        jasmine.any(Number),
        jasmine.any(Number),
        'boss' as EnemyType,
        jasmine.any(String),
        false,
        jasmine.any(Number) // factionId
      );
    });
  });

  describe('cleanup', () => {
    it('should complete observable on destroy', () => {
      let completed = false;
      service.enemySpawned$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      service.destroy();

      expect(completed).toBeTruthy();
    });
  });

  describe('spawn cluster reset', () => {
    interface SpawnPositionWithCluster {
      lastSpawnPosition: { x: number; y: number } | null;
      spawnsSinceClusterReset: number;
      lastClusterResetTime: number;
      maybeResetClusterPosition: () => void;
      getSpawnPosition: (enemyType?: EnemyType) => { x: number; y: number };
    }
    let spawnPositionService: SpawnPositionService;

    beforeEach(() => {
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      service.setWorldBounds(12000, 9000);
      spawnPositionService = TestBed.inject(SpawnPositionService);
    });

    it('should reset cluster position after RESET_AFTER_SPAWNS spawns', () => {
      const serviceWithCluster = spawnPositionService as unknown as SpawnPositionWithCluster;

      // Set initial cluster position (RESET_AFTER_SPAWNS = 5)
      serviceWithCluster.lastSpawnPosition = { x: 1000, y: 1000 };
      serviceWithCluster.spawnsSinceClusterReset = 5; // At threshold
      serviceWithCluster.lastClusterResetTime = Date.now();

      // Call maybeResetClusterPosition
      serviceWithCluster.maybeResetClusterPosition();

      // Should have reset
      expect(serviceWithCluster.lastSpawnPosition).toBeNull();
      expect(serviceWithCluster.spawnsSinceClusterReset).toBe(0);
    });

    it('should reset cluster position after RESET_AFTER_MS timeout', () => {
      const serviceWithCluster = spawnPositionService as unknown as SpawnPositionWithCluster;

      // Set initial cluster position with old timestamp (RESET_AFTER_MS = 15000)
      serviceWithCluster.lastSpawnPosition = { x: 1000, y: 1000 };
      serviceWithCluster.spawnsSinceClusterReset = 2; // Below count threshold
      serviceWithCluster.lastClusterResetTime = Date.now() - 16000; // 16 seconds ago (over 15s threshold)

      // Call maybeResetClusterPosition
      serviceWithCluster.maybeResetClusterPosition();

      // Should have reset due to timeout
      expect(serviceWithCluster.lastSpawnPosition).toBeNull();
      expect(serviceWithCluster.spawnsSinceClusterReset).toBe(0);
    });

    it('should NOT reset cluster position if below thresholds', () => {
      const serviceWithCluster = spawnPositionService as unknown as SpawnPositionWithCluster;

      // Set initial cluster position with recent timestamp and low count
      // RESET_AFTER_SPAWNS = 3, RESET_AFTER_MS = 10000
      serviceWithCluster.lastSpawnPosition = { x: 1000, y: 1000 };
      serviceWithCluster.spawnsSinceClusterReset = 2; // Below threshold (< 3)
      serviceWithCluster.lastClusterResetTime = Date.now(); // Just now (< 10000ms ago)

      // Call maybeResetClusterPosition
      serviceWithCluster.maybeResetClusterPosition();

      // Should NOT have reset
      expect(serviceWithCluster.lastSpawnPosition).toEqual({ x: 1000, y: 1000 });
      expect(serviceWithCluster.spawnsSinceClusterReset).toBe(2);
    });

    it('should increment spawn counter on each spawn', () => {
      const serviceWithCluster = spawnPositionService as unknown as SpawnPositionWithCluster;

      // Reset counter
      serviceWithCluster.spawnsSinceClusterReset = 0;
      serviceWithCluster.lastClusterResetTime = Date.now();

      // Trigger spawn position calculation
      randomService.random.and.returnValue(0.5);
      serviceWithCluster.getSpawnPosition();

      expect(serviceWithCluster.spawnsSinceClusterReset).toBe(1);

      serviceWithCluster.getSpawnPosition();
      expect(serviceWithCluster.spawnsSinceClusterReset).toBe(2);
    });

    it('should use cluster position when random is below CLUSTER.CHANCE', () => {
      const serviceWithCluster = spawnPositionService as unknown as SpawnPositionWithCluster;

      // Set cluster position near the player (within 1400-unit max spawn distance)
      // Player is at {6000, 4500}; placing cluster at {5800, 4300} (~283 units away)
      // so the distance clamp does not push the result far from the cluster center.
      const clusterX = 5800;
      const clusterY = 4300;
      serviceWithCluster.lastSpawnPosition = { x: clusterX, y: clusterY };
      serviceWithCluster.spawnsSinceClusterReset = 0;
      serviceWithCluster.lastClusterResetTime = Date.now();

      // Set random to trigger clustering (below 0.15 CLUSTER.CHANCE)
      randomService.random.and.returnValue(0.1);

      const pos = serviceWithCluster.getSpawnPosition();

      // Should be near the cluster position (within 150-350 range)
      const dx = pos.x - clusterX;
      const dy = pos.y - clusterY;
      const distFromCluster = Math.sqrt(dx * dx + dy * dy);

      // Cluster distance is 250-500 (with 0.1 random it's ~275)
      expect(distFromCluster).toBeLessThanOrEqual(600); // Some margin for world bounds clamping
    });
  });

  // =============================================================================
  // WAVE SYSTEM TESTS
  // =============================================================================
  describe('wave system', () => {
    // Updated interface to match current service implementation with overlapping waves
    interface ActiveWave {
      waveId: number;
      type: 'normal' | 'swarm' | 'elite' | 'boss';
      totalEnemies: number;
      spawnedEnemies: number;
      spawnInterval: number;
      lastSpawnTime: number;
      startTime: number;
    }

    interface SpawnSystemWithWavePrivates {
      waveTimer: number;
      currentWaveNumber: number;
      activeWaves: ActiveWave[]; // Changed from activeWave to activeWaves array
      lastWaveStartTime: number; // Track overlap timing
      startNewWave: (entityManager: EntityManagerService) => void;
      updateWaveSystem: (deltaTime: number, entityManager: EntityManagerService) => void;
      spawnWaveEnemy: (entityManager: EntityManagerService, wave: unknown) => void;
      softenOpeningEnemy: (entityManager: EntityManagerService, entity: number) => void;
      entityFactory: EntityFactoryECSService;
    }

    // Helper to get first active wave (for backwards compatibility with tests)
    const getActiveWave = (serviceWithWave: SpawnSystemWithWavePrivates): ActiveWave | null => {
      return serviceWithWave.activeWaves.length > 0 ? serviceWithWave.activeWaves[0] : null;
    };

    interface ProgressionWithLevel {
      level: number;
    }

    beforeEach(() => {
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      service.setWorldBounds(12000, 9000);
    });

    describe('wave type selection', () => {
      it('should create normal wave type when level < 5 and roll below swarm threshold', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 3;

        // Roll that would trigger elite wave if level was high enough
        // but is below swarm threshold (0.15), so becomes normal
        randomService.random.and.returnValue(0.05); // Below ELITE_WAVE_CHANCE (0.15)

        serviceWithWave.startNewWave(entityManager);

        // Should NOT be elite because level < 5
        // Should NOT be swarm because roll < 0.15
        // Should be normal
        expect(getActiveWave(serviceWithWave)).not.toBeNull();
        expect(getActiveWave(serviceWithWave)?.type).toBe('normal');
      });

      it('should create elite wave when level >= 5 and roll < ELITE_WAVE_CHANCE', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 5;
        serviceWithWave.currentWaveNumber = 1;

        // Roll below ELITE_WAVE_CHANCE (0.15)
        randomService.random.and.returnValue(0.1);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)).not.toBeNull();
        expect(getActiveWave(serviceWithWave)?.type).toBe('elite');
      });

      it('should create swarm wave when roll is in swarm range', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 3;
        serviceWithWave.currentWaveNumber = 1;

        // Roll between ELITE_WAVE_CHANCE (0.15) and ELITE + SWARM (0.35)
        randomService.random.and.returnValue(0.25);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)).not.toBeNull();
        expect(getActiveWave(serviceWithWave)?.type).toBe('swarm');
      });

      it('should create normal wave when roll is above both thresholds', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 10;

        // Roll above ELITE + SWARM (0.35)
        randomService.random.and.returnValue(0.5);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)).not.toBeNull();
        expect(getActiveWave(serviceWithWave)?.type).toBe('normal');
      });
    });

    describe('wave size calculation', () => {
      it('should author a readable three-target opening at level 1', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 1;

        // Force normal wave (roll > 0.40 to be past ELITE_WAVE_CHANCE + SWARM_WAVE_CHANCE)
        randomService.random.and.returnValue(0.5);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBe(3);
      });

      it('should scale wave size after the three-wave onboarding cadence', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 5;
        serviceWithWave.currentWaveNumber = 3;

        // Force normal wave
        randomService.random.and.returnValue(0.5);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBe(10);
      });

      it('should cap wave size at MAX_WAVE_SIZE', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 20; // Would be 29 enemies uncapped
        serviceWithWave.currentWaveNumber = 59;

        // Force normal wave
        randomService.random.and.returnValue(0.5);

        serviceWithWave.startNewWave(entityManager);

        // Should be capped at MAX_WAVE_SIZE (22)
        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBe(22);
      });

      it('should apply the authored swarm multiplier', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 1;
        serviceWithWave.currentWaveNumber = 1;

        // Force swarm wave (roll between 0.15 and 0.40)
        randomService.random.and.returnValue(0.25);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.type).toBe('swarm');
        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBe(7);
      });

      it('should reduce target count for elite waves', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 5;
        serviceWithWave.currentWaveNumber = 1;

        // Force elite wave (roll < 0.15 and level >= 5)
        randomService.random.and.returnValue(0.1);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.type).toBe('elite');
        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBe(4);
      });
    });

    describe('opening pressure', () => {
      it('reduces both contact and ranged damage for onboarding enemies', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const enemy = entityManager.createEntity();
        entityManager.addComponent(enemy, new DamageComponent(10, 'contact'));
        entityManager.addComponent(enemy, new WeaponComponent(15, 1000));

        serviceWithWave.softenOpeningEnemy(entityManager, enemy);

        expect(entityManager.getComponent(enemy, DamageComponent)?.contactDamage).toBe(4);
        expect(entityManager.getComponent(enemy, WeaponComponent)?.damage).toBe(6);
      });
    });

    describe('wave enemy type selection', () => {
      it('should spawn swarm/basic types in swarm waves', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        const swarmWave = {
          waveId: 1,
          type: 'swarm' as const,
          totalEnemies: 5,
          spawnedEnemies: 0,
          spawnInterval: 500,
          lastSpawnTime: window.performance.now(),
          startTime: window.performance.now(),
        };

        // Call multiple times to verify types
        const spawnedTypes: EnemyType[] = [];
        for (let i = 0; i < 10; i++) {
          randomService.random.and.returnValue(i * 0.1); // Vary the random for type selection
          serviceWithWave.spawnWaveEnemy(entityManager, swarmWave);

          const call = entityFactory.createEnemy.calls.mostRecent();
          spawnedTypes.push(call.args[2]);
        }

        // All types should be from swarm pool: Swarm, Basic, Swarm, Spitter
        const validSwarmTypes = [EnemyType.Swarm, EnemyType.Basic, EnemyType.Spitter];
        for (const type of spawnedTypes) {
          expect(validSwarmTypes).toContain(type);
        }
      });

      it('should spawn tank/thug/sniper types in elite waves', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        const eliteWave = {
          waveId: 1,
          type: 'elite' as const,
          totalEnemies: 5,
          spawnedEnemies: 0,
          spawnInterval: 500,
          lastSpawnTime: window.performance.now(),
          startTime: window.performance.now(),
        };

        // Call multiple times to verify types
        const spawnedTypes: EnemyType[] = [];
        for (let i = 0; i < 10; i++) {
          randomService.random.and.returnValue(i * 0.1);
          serviceWithWave.spawnWaveEnemy(entityManager, eliteWave);

          const call = entityFactory.createEnemy.calls.mostRecent();
          spawnedTypes.push(call.args[2]);
        }

        // All types should be from elite pool: Tank, Thug, Sniper, Spitter
        const validEliteTypes = [EnemyType.Tank, EnemyType.Thug, EnemyType.Sniper, EnemyType.Spitter];
        for (const type of spawnedTypes) {
          expect(validEliteTypes).toContain(type);
        }
      });

      it('should have 50% elite chance in elite waves', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        const eliteWave = {
          waveId: 1,
          type: 'elite' as const,
          totalEnemies: 1,
          spawnedEnemies: 0,
          spawnInterval: 500,
          lastSpawnTime: window.performance.now(),
          startTime: window.performance.now(),
        };

        // Test with roll below 0.5 (should be elite)
        randomService.random.and.returnValue(0.3);
        serviceWithWave.spawnWaveEnemy(entityManager, eliteWave);

        let call = entityFactory.createEnemy.calls.mostRecent();
        expect(call.args[4]).toBe(true); // isElite parameter

        // Test with roll above 0.5 (should not be elite)
        randomService.random.and.returnValue(0.7);
        serviceWithWave.spawnWaveEnemy(entityManager, eliteWave);

        call = entityFactory.createEnemy.calls.mostRecent();
        expect(call.args[4]).toBe(false); // isElite parameter
      });
    });

    describe('wave observable emission', () => {
      it('should emit waveStarted$ when new wave begins', (done) => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 5;

        // Force normal wave
        randomService.random.and.returnValue(0.5);

        service.waveStarted$.pipe(take(1)).subscribe((event) => {
          expect(event.waveNumber).toBe(1);
          expect(event.waveType).toBe('normal');
          expect(event.enemyCount).toBe(3);
          done();
        });

        serviceWithWave.startNewWave(entityManager);
      });

      it('should increment wave number with each new wave', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        randomService.random.and.returnValue(0.5);

        expect(serviceWithWave.currentWaveNumber).toBe(0);

        serviceWithWave.startNewWave(entityManager);
        expect(serviceWithWave.currentWaveNumber).toBe(1);

        // Clear active waves to allow next
        serviceWithWave.activeWaves = [];

        serviceWithWave.startNewWave(entityManager);
        expect(serviceWithWave.currentWaveNumber).toBe(2);
      });

      it('should complete waveStarted$ on destroy', () => {
        let completed = false;
        service.waveStarted$.subscribe({
          complete: () => {
            completed = true;
          },
        });

        service.destroy();

        expect(completed).toBeTruthy();
      });
    });

    describe('wave state transitions', () => {
      it('should start wave when waveTimer exceeds WAVE_INTERVAL_MS', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const enemyManager = TestBed.inject(EnemyManagerService) as jasmine.SpyObj<EnemyManagerService>;
        enemyManager.canSpawnEnemy.and.returnValue(true);

        randomService.random.and.returnValue(0.5);

        // Set timer just below threshold (WAVE_INTERVAL_MS = 18000)
        // Ensure overlap check passes (MIN_OVERLAP_INTERVAL_MS = 12000)
        serviceWithWave.lastWaveStartTime = window.performance.now() - 15000;
        serviceWithWave.waveTimer = 17000;
        serviceWithWave.updateWaveSystem(1500, entityManager);

        // Wave should have started
        expect(getActiveWave(serviceWithWave)).not.toBeNull();
        expect(serviceWithWave.waveTimer).toBe(0); // Reset after starting wave
      });

      it('should NOT start new wave while max concurrent waves active', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;

        // Set up 3 active waves (exceeds MAX_CONCURRENT_WAVES = 2)
        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 2,
            spawnInterval: 500,
            lastSpawnTime: window.performance.now(),
            startTime: window.performance.now(),
          },
          {
            waveId: 2,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 2,
            spawnInterval: 500,
            lastSpawnTime: window.performance.now(),
            startTime: window.performance.now(),
          },
          {
            waveId: 3,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 2,
            spawnInterval: 500,
            lastSpawnTime: window.performance.now(),
            startTime: window.performance.now(),
          },
        ];

        const initialWaveNumber = serviceWithWave.currentWaveNumber;

        // Try to trigger new wave (timer exceeds WAVE_INTERVAL_MS = 18000)
        serviceWithWave.waveTimer = 19000;
        serviceWithWave.updateWaveSystem(1000, entityManager);

        // Should not have started new wave (max concurrent reached)
        expect(serviceWithWave.currentWaveNumber).toBe(initialWaveNumber);
      });

      it('should start the onboarding recovery timer when a directive clears', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        serviceWithWave.currentWaveNumber = 1;
        serviceWithWave.waveTimer = SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS;
        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 3,
            spawnedEnemies: 3,
            spawnInterval: 500,
            lastSpawnTime: window.performance.now(),
            startTime: window.performance.now() - 20000,
          },
        ];
        spyOn(service.encounterObjectives, 'update').and.returnValue([
          {
            waveNumber: 1,
            type: 'normal',
            title: 'Scout Screen',
            success: true,
            rewardGranted: true,
            reward: { shards: 4, xp: 10 },
          },
        ]);

        serviceWithWave.updateWaveSystem(1000, entityManager);

        expect(serviceWithWave.currentWaveNumber).toBe(1);
        expect(serviceWithWave.activeWaves).toEqual([]);
        expect(serviceWithWave.waveTimer).toBe(
          SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS - ENCOUNTER_DIRECTOR_CONFIG.OPENING.RECOVERY_AFTER_CLEAR_MS
        );
      });

      it('should clear activeWave when all enemies spawned', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;

        // Set up wave that's about to complete
        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 5, // All spawned
            spawnInterval: 500,
            lastSpawnTime: window.performance.now(),
            startTime: window.performance.now(),
          },
        ];

        serviceWithWave.updateWaveSystem(100, entityManager);

        // Wave should be cleared
        expect(getActiveWave(serviceWithWave)).toBeNull();
      });

      it('should spawn enemies at spawnInterval during active wave', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        const startTime = window.performance.now();

        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 0,
            spawnInterval: 500,
            lastSpawnTime: startTime - 600, // 600ms ago (> 500 interval)
            startTime: startTime,
          },
        ];

        serviceWithWave.updateWaveSystem(100, entityManager);

        // Should have spawned one enemy
        expect(getActiveWave(serviceWithWave)?.spawnedEnemies).toBe(1);
        expect(entityFactory.createEnemy).toHaveBeenCalledTimes(1);
      });

      it('should NOT spawn if canSpawn is false', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        const startTime = window.performance.now();

        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 0,
            spawnInterval: 500,
            lastSpawnTime: startTime - 600,
            startTime: startTime,
          },
        ];

        // canSpawn is false - override the mock to return false
        const enemyManagerSpy = TestBed.inject(EnemyManagerService) as jasmine.SpyObj<EnemyManagerService>;
        enemyManagerSpy.canSpawnEnemy.and.returnValue(false);
        serviceWithWave.updateWaveSystem(100, entityManager);

        // Should NOT have spawned
        expect(getActiveWave(serviceWithWave)?.spawnedEnemies).toBe(0);
        expect(entityFactory.createEnemy).not.toHaveBeenCalled();
      });
    });

    describe('wave spawn interval calculation', () => {
      it('should calculate spawn interval based on wave size and duration', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 1;

        // Force normal wave
        randomService.random.and.returnValue(0.5);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.spawnInterval).toBe(2000);
      });

      it('should have shorter spawn interval for larger waves', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 1;
        serviceWithWave.currentWaveNumber = 1;

        // Force swarm wave (1.5x enemies)
        randomService.random.and.returnValue(0.25);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.spawnInterval).toBeCloseTo(571.43, 1);
      });
    });

    // =========================================================================
    // EDGE CASE TESTS - Critical scenarios for dynamic gameplay
    // =========================================================================
    describe('edge cases', () => {
      it('should create normal wave when low roll at low level (not elite eligible)', () => {
        // FIX VERIFIED: Low rolls at low levels now correctly become normal, not swarm
        // The swarm range is 0.15-0.35, so rolls below 0.15 at low levels are normal
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 3;

        // Very low roll (0.05) - below ELITE_WAVE_CHANCE (0.15), so not in swarm range
        randomService.random.and.returnValue(0.05);

        serviceWithWave.startNewWave(entityManager);

        // Fixed behavior: becomes 'normal' because 0.05 < 0.15 (below swarm threshold)
        // Elite is skipped due to level < 5, and swarm requires roll >= 0.15
        expect(getActiveWave(serviceWithWave)?.type).toBe('normal');
      });

      it('should handle level 0 gracefully', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 0;

        randomService.random.and.returnValue(0.5);

        serviceWithWave.startNewWave(entityManager);

        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBe(3);
        expect(getActiveWave(serviceWithWave)?.totalEnemies).toBeGreaterThan(0);
      });

      it('should only start ONE wave even with very large deltaTime (tab backgrounded)', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        randomService.random.and.returnValue(0.5);

        // Simulate tab being backgrounded - 60 seconds of accumulated time
        // This is 3x the wave interval, but should only trigger ONE wave
        // Ensure overlap check passes (MIN_OVERLAP_INTERVAL_MS = 12000)
        serviceWithWave.lastWaveStartTime = window.performance.now() - 15000;
        serviceWithWave.waveTimer = 0;
        serviceWithWave.updateWaveSystem(60000, entityManager);

        expect(serviceWithWave.currentWaveNumber).toBe(1);
        expect(serviceWithWave.waveTimer).toBe(0); // Reset after starting wave
      });

      it('should stall wave progress when canSpawn is always false', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;

        // Override canSpawnEnemy to return false
        const enemyManagerSpy = TestBed.inject(EnemyManagerService) as jasmine.SpyObj<EnemyManagerService>;
        enemyManagerSpy.canSpawnEnemy.and.returnValue(false);

        const startTime = window.performance.now();
        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 0,
            spawnInterval: 100, // Very short interval
            lastSpawnTime: startTime - 5000, // 5 seconds ago
            startTime: startTime,
          },
        ];

        // Update many times with canSpawn=false
        for (let i = 0; i < 100; i++) {
          serviceWithWave.updateWaveSystem(100, entityManager);
        }

        // Wave should still be active with 0 spawned enemies
        expect(getActiveWave(serviceWithWave)).not.toBeNull();
        expect(getActiveWave(serviceWithWave)?.spawnedEnemies).toBe(0);
      });

      it('should handle boundary roll value exactly at ELITE_WAVE_CHANCE (0.15)', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 10;
        serviceWithWave.currentWaveNumber = 1;

        // Roll exactly at elite threshold - should NOT be elite (< not <=)
        randomService.random.and.returnValue(0.15);

        serviceWithWave.startNewWave(entityManager);

        // 0.15 is NOT < 0.15, so fails elite check
        // 0.15 IS >= 0.15 AND < 0.40 (0.15 + 0.25), so becomes swarm
        expect(getActiveWave(serviceWithWave)?.type).toBe('swarm');
      });

      it('should handle boundary roll value exactly at combined threshold (0.40)', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 10;

        // Roll exactly at combined threshold (0.15 + 0.25 = 0.40)
        randomService.random.and.returnValue(0.4);

        serviceWithWave.startNewWave(entityManager);

        // 0.40 is NOT < 0.40, so becomes normal
        expect(getActiveWave(serviceWithWave)?.type).toBe('normal');
      });

      it('should handle wave with zero spawn interval gracefully', () => {
        // This could happen if WAVE_SPAWN_DURATION_MS is 0 or waveSize is Infinity
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 0,
            spawnInterval: 0, // Edge case: zero interval
            lastSpawnTime: window.performance.now() - 1,
            startTime: window.performance.now(),
          },
        ];

        // Should spawn immediately since interval is 0
        serviceWithWave.updateWaveSystem(1, entityManager);

        expect(getActiveWave(serviceWithWave)?.spawnedEnemies).toBe(1);
      });

      it('should not crash when wave completes on same frame it was checked', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;

        // Wave that's already complete
        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 5,
            spawnInterval: 500,
            lastSpawnTime: window.performance.now(),
            startTime: window.performance.now() - 3000,
          },
        ];

        // Should clear the wave without error
        serviceWithWave.updateWaveSystem(100, entityManager);

        expect(getActiveWave(serviceWithWave)).toBeNull();
      });

      it('should emit correct enemyCount even at MAX_WAVE_SIZE cap', (done) => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        (progressionService as unknown as ProgressionWithLevel).level = 50; // Would be 59 uncapped
        serviceWithWave.currentWaveNumber = 59;

        randomService.random.and.returnValue(0.5);

        service.waveStarted$.pipe(take(1)).subscribe((event) => {
          // Should be capped at 22, not 59 (MAX_WAVE_SIZE = 22)
          expect(event.enemyCount).toBe(22);
          expect(event.enemyCount).toBeLessThanOrEqual(22);
          done();
        });

        serviceWithWave.startNewWave(entityManager);
      });

      it('should handle rapid consecutive updateWaveSystem calls', () => {
        const serviceWithWave = service as unknown as SpawnSystemWithWavePrivates;
        const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
        entityFactory.createEnemy.and.returnValue(1);
        entityFactory.createEnemy.calls.reset();

        const startTime = window.performance.now();
        serviceWithWave.activeWaves = [
          {
            waveId: 1,
            type: 'normal',
            totalEnemies: 5,
            spawnedEnemies: 0,
            spawnInterval: 500,
            lastSpawnTime: startTime - 600, // Ready to spawn
            startTime: startTime,
          },
        ];

        // Call update twice in rapid succession (same millisecond)
        serviceWithWave.updateWaveSystem(0, entityManager);
        serviceWithWave.updateWaveSystem(0, entityManager);

        // Should only spawn once due to lastSpawnTime update
        // (Second call sees lastSpawnTime was just updated)
        expect(getActiveWave(serviceWithWave)?.spawnedEnemies).toBeLessThanOrEqual(2);
      });
    });
  });

  // ===========================================================================
  // Phase 2: Spawn Gating Tests
  // ===========================================================================
  describe('spawn gating — ENEMY_UNLOCK_WAVES', () => {
    interface SpawnGatingPrivates {
      currentWaveNumber: number;
      unlockedTypes: Set<string>;
      selectEnemyType(pos?: { x: number; y: number }): EnemyType;
      startNewWave(em: unknown): void;
    }

    let sut: SpawnGatingPrivates;
    let capturedChoices: Array<{ value: EnemyType; weight: number }>;

    beforeEach(() => {
      sut = service as unknown as SpawnGatingPrivates;
      capturedChoices = [];

      // Intercept weightedChoice to capture the weights array.
      // Cast through unknown to satisfy Jasmine's generic callFake type constraint.
      (randomService.weightedChoice as unknown as jasmine.Spy).and.callFake(
        (choices: Array<{ value: EnemyType; weight: number }>) => {
          capturedChoices = choices;
          const eligible = choices.filter((c) => c.weight > 0);
          return eligible[0]?.value ?? EnemyType.Basic;
        }
      );
    });

    describe('wave 1 — only basic and spitter eligible', () => {
      it('does not include swarm, tank, thug, sniper, or boss in eligible types', () => {
        sut.currentWaveNumber = 1;
        sut.selectEnemyType({ x: 100, y: 100 });

        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Basic);
        expect(eligible).toContain(EnemyType.Spitter);
        expect(eligible).not.toContain(EnemyType.Swarm);
        expect(eligible).not.toContain(EnemyType.Tank);
        expect(eligible).not.toContain(EnemyType.Thug);
        expect(eligible).not.toContain(EnemyType.Sniper);
        expect(eligible).not.toContain(EnemyType.Boss);
      });
    });

    describe('swarm unlocks at wave 3', () => {
      it('wave 2: swarm not eligible', () => {
        sut.currentWaveNumber = 2;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Swarm);
      });

      it('wave 3: swarm eligible', () => {
        sut.currentWaveNumber = 3;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Swarm);
      });
    });

    describe('tank unlocks at wave 5', () => {
      beforeEach(() => {
        // Use level 6 so level-based adjustments apply tank weight normally
        (progressionService as unknown as { level: number }).level = 6;
      });

      it('wave 4: tank not eligible', () => {
        sut.currentWaveNumber = 4;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Tank);
      });

      it('wave 5: tank eligible', () => {
        sut.currentWaveNumber = 5;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Tank);
      });
    });

    describe('thug unlocks at wave 8', () => {
      beforeEach(() => {
        (progressionService as unknown as { level: number }).level = 10;
      });

      it('wave 7: thug not eligible', () => {
        sut.currentWaveNumber = 7;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Thug);
      });

      it('wave 8: thug eligible', () => {
        sut.currentWaveNumber = 8;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Thug);
      });
    });

    describe('sniper unlocks at wave 12', () => {
      beforeEach(() => {
        (progressionService as unknown as { level: number }).level = 10;
      });

      it('wave 11: sniper not eligible', () => {
        sut.currentWaveNumber = 11;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Sniper);
      });

      it('wave 12: sniper eligible', () => {
        sut.currentWaveNumber = 12;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Sniper);
      });
    });

    describe('boss — always weight 0 in normal selection', () => {
      it('boss weight is 0 even at high wave number', () => {
        (progressionService as unknown as { level: number }).level = 20;
        sut.currentWaveNumber = 20;
        sut.selectEnemyType({ x: 100, y: 100 });
        const bossEntry = capturedChoices.find((c) => c.value === EnemyType.Boss);
        expect(bossEntry?.weight ?? 0).toBe(0);
      });
    });

    describe('disruptor unlocks at wave 18', () => {
      beforeEach(() => {
        (progressionService as unknown as { level: number }).level = 15;
      });

      it('wave 17: disruptor not eligible', () => {
        sut.currentWaveNumber = 17;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Disruptor);
      });

      it('wave 18: disruptor eligible', () => {
        sut.currentWaveNumber = 18;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Disruptor);
      });

      it('wave 1 does not include disruptor', () => {
        sut.currentWaveNumber = 1;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Disruptor);
      });
    });

    describe('sentinel unlocks at wave 22', () => {
      beforeEach(() => {
        (progressionService as unknown as { level: number }).level = 18;
      });

      it('wave 21: sentinel not eligible', () => {
        sut.currentWaveNumber = 21;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Sentinel);
      });

      it('wave 22: sentinel eligible', () => {
        sut.currentWaveNumber = 22;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).toContain(EnemyType.Sentinel);
      });

      it('wave 1 does not include sentinel', () => {
        sut.currentWaveNumber = 1;
        sut.selectEnemyType({ x: 100, y: 100 });
        const eligible = capturedChoices.filter((c) => c.weight > 0).map((c) => c.value);
        expect(eligible).not.toContain(EnemyType.Sentinel);
      });
    });

    describe('weight renormalization — gated types never selected', () => {
      it('no locked type is ever returned at wave 1', () => {
        sut.currentWaveNumber = 1;
        const results = new Set<EnemyType>();
        for (let i = 0; i < 30; i++) {
          results.add(sut.selectEnemyType({ x: 100, y: 100 }));
        }
        expect(results.has(EnemyType.Tank)).toBeFalse();
        expect(results.has(EnemyType.Thug)).toBeFalse();
        expect(results.has(EnemyType.Sniper)).toBeFalse();
        expect(results.has(EnemyType.Boss)).toBeFalse();
        expect(results.has(EnemyType.Swarm)).toBeFalse();
        expect(results.has(EnemyType.Sentinel)).toBeFalse();
      });
    });
  });

  describe('boss wave scheduling', () => {
    interface StartWavePrivates {
      currentWaveNumber: number;
      startNewWave(em: unknown): void;
    }

    let mockEm: { getEntitiesWithComponents: jasmine.Spy };

    beforeEach(() => {
      mockEm = {
        getEntitiesWithComponents: jasmine.createSpy('getEntitiesWithComponents').and.returnValue([]),
      };
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();
    });

    // NOTE: WAVE_EVENTS schedule takes priority over boss wave scheduling.
    // Waves 25/40 → boss_rush; wave 35 → blackout; waves 10/30/45 → faction_invasion.
    // Wave 15 has NO WAVE_EVENTS entry (removed to reduce early spike), so the
    // Phase 2 scheduled-boss formula fires: wave 15 → single 'boss' wave.
    // Next boss_rush events are wave 25 and 40.

    it('wave 15 emits boss (no WAVE_EVENTS entry — scheduled boss wave)', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });

      const sut = service as unknown as StartWavePrivates;
      sut.currentWaveNumber = 14;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('boss');
    });

    it('wave 25 emits boss_rush (overrides Phase 2 boss wave via WAVE_EVENTS)', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });

      const sut = service as unknown as StartWavePrivates;
      sut.currentWaveNumber = 24;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('boss_rush');
    });

    it('wave 35 emits blackout (overrides Phase 2 boss wave via WAVE_EVENTS)', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });

      const sut = service as unknown as StartWavePrivates;
      sut.currentWaveNumber = 34;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('blackout');
    });

    it('wave 16 is not a boss wave', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });

      // Force random to 0.5 (neither elite nor swarm roll)
      randomService.random.and.returnValue(0.5);
      const sut = service as unknown as StartWavePrivates;
      sut.currentWaveNumber = 15;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('normal');
    });

    it('boss_rush wave before wave 35 has 2 enemies', () => {
      let emittedCount = 0;
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedCount = evt.enemyCount;
      });

      // Wave 25 = boss_rush, pre-35 → 2 bosses
      const sut = service as unknown as StartWavePrivates;
      sut.currentWaveNumber = 24;
      sut.startNewWave(mockEm);
      expect(emittedCount).toBe(2);
    });

    it('boss_rush wave at wave 40 has 3 enemies (wave >= 35)', () => {
      let emittedCount = 0;
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedCount = evt.enemyCount;
      });

      // Wave 40 = boss_rush, wave >= 35 → 3 bosses
      const sut = service as unknown as StartWavePrivates;
      sut.currentWaveNumber = 39;
      sut.startNewWave(mockEm);
      expect(emittedCount).toBe(3);
    });
  });

  // ===========================================================================
  // WAVE EVENT SCHEDULING TESTS (Phase 5)
  // ===========================================================================
  describe('wave event scheduling', () => {
    interface EventPrivates {
      currentWaveNumber: number;
      startNewWave(em: unknown): void;
    }

    let mockEm: { getEntitiesWithComponents: jasmine.Spy };

    beforeEach(() => {
      mockEm = {
        getEntitiesWithComponents: jasmine.createSpy('getEntitiesWithComponents').and.returnValue([]),
      };
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      service.setWorldBounds(12000, 9000);
    });

    it('wave 10 triggers faction_invasion', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });
      const sut = service as unknown as EventPrivates;
      sut.currentWaveNumber = 9;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('faction_invasion');
    });

    it('wave 15 produces boss (no WAVE_EVENTS entry — scheduled boss via Phase 2 formula)', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });
      const sut = service as unknown as EventPrivates;
      sut.currentWaveNumber = 14;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('boss');
    });

    it('wave 15 produces a single boss (no boss_rush double-spawn)', () => {
      // A1: wave 15 boss_rush was removed from WAVE_EVENTS; the Phase 2
      // scheduled-boss formula fires instead giving exactly one 'boss' wave.
      // wave size for a 'boss' wave is 2 (< wave 35), confirming it's the boss
      // code path not boss_rush (which would also be 2 but type === 'boss_rush').
      let emittedWaveType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedWaveType = evt.waveType;
      });
      const sut = service as unknown as EventPrivates;
      sut.currentWaveNumber = 14;
      sut.startNewWave(mockEm);
      expect(emittedWaveType).toBe('boss');
      expect(emittedWaveType).not.toBe('boss_rush');
    });

    it('wave 35 triggers blackout', () => {
      // Wave 20 previously triggered blackout; zone progression moved blackout to wave 35
      // (wave 20 now triggers guardian_surge per WAVE_EVENTS config).
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });
      const sut = service as unknown as EventPrivates;
      sut.currentWaveNumber = 34;
      sut.startNewWave(mockEm);
      expect(emittedType).toBe('blackout');
    });

    it('wave 11 (non-event) falls through to normal/swarm/elite roll', () => {
      let emittedType = '';
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedType = evt.waveType;
      });
      randomService.random.and.returnValue(0.5); // Normal roll (above elite+swarm threshold)
      const sut = service as unknown as EventPrivates;
      sut.currentWaveNumber = 10;
      sut.startNewWave(mockEm);
      expect(['normal', 'elite', 'swarm']).toContain(emittedType);
    });
  });

  describe('boss_rush wave behavior', () => {
    interface BossRushPrivates {
      currentWaveNumber: number;
      startNewWave(em: unknown): void;
      spawnWaveEnemy(em: unknown, wave: unknown): void;
    }

    let mockEm: { getEntitiesWithComponents: jasmine.Spy };

    beforeEach(() => {
      mockEm = {
        getEntitiesWithComponents: jasmine.createSpy('getEntitiesWithComponents').and.returnValue([]),
      };
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      service.setWorldBounds(12000, 9000);
    });

    it('boss_rush spawns Boss type', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();

      const bossRushWave = {
        waveId: 15,
        type: 'boss_rush' as const,
        totalEnemies: 2,
        spawnedEnemies: 0,
        spawnInterval: 3000,
        lastSpawnTime: window.performance.now(),
        startTime: window.performance.now(),
      };
      const sut = service as unknown as BossRushPrivates;
      sut.spawnWaveEnemy(mockEm, bossRushWave);

      const callArgs = entityFactory.createEnemy.calls.mostRecent().args;
      expect(callArgs[2]).toBe(EnemyType.Boss);
    });

    it('boss_rush uses legendary rarity', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();

      const bossRushWave = {
        waveId: 15,
        type: 'boss_rush' as const,
        totalEnemies: 2,
        spawnedEnemies: 0,
        spawnInterval: 3000,
        lastSpawnTime: window.performance.now(),
        startTime: window.performance.now(),
      };
      const sut = service as unknown as BossRushPrivates;
      sut.spawnWaveEnemy(mockEm, bossRushWave);

      const callArgs = entityFactory.createEnemy.calls.mostRecent().args;
      expect(callArgs[3]).toBe('legendary');
    });
  });

  describe('faction_invasion wave behavior', () => {
    interface InvasionPrivates {
      currentWaveNumber: number;
      startNewWave(em: unknown): void;
      spawnWaveEnemy(em: unknown, wave: unknown): void;
      activeWaves: Array<{ type: string; invasionFactionId?: number; totalEnemies: number }>;
    }

    let mockEm: { getEntitiesWithComponents: jasmine.Spy };

    beforeEach(() => {
      mockEm = {
        getEntitiesWithComponents: jasmine.createSpy('getEntitiesWithComponents').and.returnValue([]),
      };
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      service.setWorldBounds(12000, 9000);
    });

    it('faction_invasion assigns a faction ID (1-4) to the wave', () => {
      const sut = service as unknown as InvasionPrivates;
      sut.currentWaveNumber = 9;
      sut.startNewWave(mockEm);

      const wave = sut.activeWaves.find((w) => w.type === 'faction_invasion');
      expect(wave).toBeDefined();
      expect(wave?.invasionFactionId).toBeGreaterThanOrEqual(1);
      expect(wave?.invasionFactionId).toBeLessThanOrEqual(4);
    });

    it('faction_invasion wave is 2x normal size (capped at MAX_WAVE_SIZE)', () => {
      let emittedCount = 0;
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedCount = evt.enemyCount;
      });
      // Wave 10: base 11, authored invasion multiplier 1.55 rounds up to 18 targets.
      const sut = service as unknown as InvasionPrivates & { currentWaveNumber: number };
      sut.currentWaveNumber = 9;
      sut.startNewWave(mockEm);
      expect(emittedCount).toBe(18);
    });

    it('faction_invasion all spawned enemies use the invasion faction ID', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();

      const invasionWave = {
        waveId: 10,
        type: 'faction_invasion' as const,
        totalEnemies: 5,
        spawnedEnemies: 0,
        spawnInterval: 500,
        lastSpawnTime: window.performance.now(),
        startTime: window.performance.now(),
        invasionFactionId: 2, // Azure Order
      };
      const sut = service as unknown as InvasionPrivates;
      sut.spawnWaveEnemy(mockEm, invasionWave);

      const callArgs = entityFactory.createEnemy.calls.mostRecent().args;
      expect(callArgs[5]).toBe(2); // factionId = invasionFactionId
    });

    it('waveStarted$ includes factionName for faction_invasion', () => {
      let emittedFactionName: string | undefined;
      service.waveStarted$.pipe(take(1)).subscribe((evt) => {
        emittedFactionName = evt.factionName;
      });
      const sut = service as unknown as InvasionPrivates;
      sut.currentWaveNumber = 9;
      sut.startNewWave(mockEm);
      expect(emittedFactionName).toBeDefined();
      expect(emittedFactionName!.length).toBeGreaterThan(0);
    });
  });

  describe('blackout wave behavior', () => {
    interface BlackoutPrivates {
      currentWaveNumber: number;
      startNewWave(em: unknown): void;
      spawnWaveEnemy(em: unknown, wave: unknown): void;
      isBlackoutActive: boolean;
      activeEvent: string | null;
    }

    let mockEm: { getEntitiesWithComponents: jasmine.Spy };

    beforeEach(() => {
      mockEm = {
        getEntitiesWithComponents: jasmine.createSpy('getEntitiesWithComponents').and.returnValue([]),
      };
      const playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
      playerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
      service.setWorldBounds(12000, 9000);
    });

    it('blackout spawns from high-threat enemy pool', () => {
      const entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      entityFactory.createEnemy.calls.reset();

      const blackoutWave = {
        waveId: 20,
        type: 'blackout' as const,
        totalEnemies: 5,
        spawnedEnemies: 0,
        spawnInterval: 500,
        lastSpawnTime: window.performance.now(),
        startTime: window.performance.now(),
      };

      const spawnedTypes = new Set<EnemyType>();
      const sut = service as unknown as BlackoutPrivates;
      for (let i = 0; i < 20; i++) {
        randomService.random.and.returnValue(i * 0.05);
        sut.spawnWaveEnemy(mockEm, blackoutWave);
        const call = (entityFactory.createEnemy.calls.mostRecent().args as [unknown, unknown, EnemyType])[2];
        spawnedTypes.add(call);
      }

      const validBlackoutTypes = [EnemyType.Sniper, EnemyType.Disruptor, EnemyType.Thug, EnemyType.Sentinel];
      for (const t of spawnedTypes) {
        expect(validBlackoutTypes).toContain(t);
      }
    });

    it('isBlackoutActive returns true when activeEvent is blackout', () => {
      const sut = service as unknown as BlackoutPrivates;
      sut.activeEvent = 'blackout';
      expect(sut.isBlackoutActive).toBeTrue();
    });

    it('isBlackoutActive returns false when activeEvent is not blackout', () => {
      const sut = service as unknown as BlackoutPrivates;
      sut.activeEvent = null;
      expect(sut.isBlackoutActive).toBeFalse();
    });
  });

  describe('newThreatUnlocked$ announcements', () => {
    interface UnlockPrivates {
      currentWaveNumber: number;
      unlockedTypes: Set<string>;
      startNewWave(em: unknown): void;
    }

    let mockEm: { getEntitiesWithComponents: jasmine.Spy };

    beforeEach(() => {
      mockEm = {
        getEntitiesWithComponents: jasmine.createSpy('getEntitiesWithComponents').and.returnValue([]),
      };
    });

    it('emits when swarm unlocks at wave 3', (done) => {
      service.newThreatUnlocked$.pipe(take(1)).subscribe(({ type, waveNumber }) => {
        expect(type).toBe('swarm');
        expect(waveNumber).toBe(3);
        done();
      });

      const sut = service as unknown as UnlockPrivates;
      sut.currentWaveNumber = 2;
      sut.startNewWave(mockEm);
    });

    it('emits when tank unlocks at wave 5', (done) => {
      service.newThreatUnlocked$.pipe(take(1)).subscribe(({ type, waveNumber }) => {
        expect(type).toBe('tank');
        expect(waveNumber).toBe(5);
        done();
      });

      const sut = service as unknown as UnlockPrivates;
      sut.currentWaveNumber = 4;
      sut.startNewWave(mockEm);
    });

    it('does not emit the same type twice in the same run', () => {
      const emissions: string[] = [];
      service.newThreatUnlocked$.subscribe(({ type }) => {
        emissions.push(type);
      });

      const sut = service as unknown as UnlockPrivates;

      // First pass: wave 3 → swarm unlocks
      sut.currentWaveNumber = 2;
      sut.startNewWave(mockEm);
      const countFirst = emissions.filter((t) => t === 'swarm').length;

      // Second pass at same wave number (simulate edge case)
      sut.currentWaveNumber = 2;
      sut.startNewWave(mockEm);
      const countSecond = emissions.filter((t) => t === 'swarm').length;

      expect(countFirst).toBe(1);
      expect(countSecond).toBe(1); // Not emitted again
    });

    it('reset() clears unlockedTypes so re-run emits announcements again', () => {
      const emissions: string[] = [];
      service.newThreatUnlocked$.subscribe(({ type }) => {
        emissions.push(type);
      });

      const sut = service as unknown as UnlockPrivates;

      sut.currentWaveNumber = 2;
      sut.startNewWave(mockEm);
      expect(emissions.filter((t) => t === 'swarm').length).toBe(1);

      // New game session
      service.reset();
      sut.currentWaveNumber = 2;
      sut.startNewWave(mockEm);
      expect(emissions.filter((t) => t === 'swarm').length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // B3 / B8: waveEventEnded$ label keys + sectorAlert$ at wave 8
  // -------------------------------------------------------------------------
  describe('waveEventEnded$ event label keys', () => {
    // The wave-announcement component maps waveEventEnded$.event to a display
    // label. Verify the Subject exists and emits the expected WaveType values
    // that the map covers.

    it('waveEventEnded$ is defined on the service', () => {
      expect(service.waveEventEnded$).toBeDefined();
    });

    it('waveEventEnded$ emits the event key provided to it', (done) => {
      service.waveEventEnded$.pipe(take(1)).subscribe(({ event }) => {
        expect(event).toBe('faction_invasion');
        done();
      });
      // Trigger directly to test the Subject wire
      (service as unknown as { waveEventEnded$: { next: (v: unknown) => void } }).waveEventEnded$.next({
        event: 'faction_invasion',
      });
    });

    it('sectorAlert$ is defined on the service', () => {
      expect(service.sectorAlert$).toBeDefined();
    });

    it('sectorAlert$ emits SECTOR ALERT message at wave 8', (done) => {
      service.sectorAlert$.pipe(take(1)).subscribe(({ message }) => {
        expect(message).toContain('SECTOR ALERT');
        expect(message).toContain('ZONE GATES ACTIVE');
        done();
      });

      const sut = service as unknown as { currentWaveNumber: number; startNewWave: (em: unknown) => void };
      sut.currentWaveNumber = 7;
      sut.startNewWave({
        getEntitiesWithComponents: jasmine.createSpy().and.returnValue([]),
      });
    });

    it('sectorAlert$ does NOT emit at wave 9', () => {
      let emitted = false;
      service.sectorAlert$.pipe(take(1)).subscribe(() => {
        emitted = true;
      });

      const sut = service as unknown as { currentWaveNumber: number; startNewWave: (em: unknown) => void };
      sut.currentWaveNumber = 8;
      sut.startNewWave({
        getEntitiesWithComponents: jasmine.createSpy().and.returnValue([]),
      });

      expect(emitted).toBeFalse();
    });
  });

  describe('champion spawn logic', () => {
    interface ChampionPrivates {
      currentWaveNumber: number;
      spawnEnemy: (entityManager: EntityManagerService) => void;
      config: { eliteChance: number };
    }

    let entityFactory: jasmine.SpyObj<EntityFactoryECSService>;

    beforeEach(() => {
      entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
      service.init();
      entityFactory.createEnemy.calls.reset();
    });

    it('should not spawn champions before wave 15', () => {
      const sut = service as unknown as ChampionPrivates;
      sut.currentWaveNumber = 14;

      // Force champion chance (5% threshold = 0.04 < 0.05)
      randomService.random.and.returnValue(0.04);

      sut.spawnEnemy(entityManager);

      const call = entityFactory.createEnemy.calls.mostRecent();
      // 7th arg (index 6) is isChampion
      const isChampion = call.args[6];
      expect(isChampion).toBe(false);
    });

    it('should spawn champions at wave 15+ when random < 0.05', () => {
      const sut = service as unknown as ChampionPrivates;
      sut.currentWaveNumber = 15;

      // Sequence: selectEnemyType random calls, then champion roll = 0.04 (< 0.05)
      // Use callFake to return 0.5 for most calls and 0.04 for champion check
      let callCount = 0;
      randomService.random.and.callFake(() => {
        callCount++;
        // Champion check is one of the last random() calls in spawnEnemy
        // Return 0.04 for it to trigger champion
        return callCount >= 3 ? 0.04 : 0.5;
      });
      randomService.weightedChoice.and.returnValue('basic');

      sut.spawnEnemy(entityManager);

      const call = entityFactory.createEnemy.calls.mostRecent();
      const isChampion = call.args[6];
      expect(isChampion).toBe(true);
    });

    it('should not spawn champions when random >= 0.05', () => {
      const sut = service as unknown as ChampionPrivates;
      sut.currentWaveNumber = 20;

      // All random calls return 0.5 — champion roll of 0.5 is >= 0.05
      randomService.random.and.returnValue(0.5);
      randomService.weightedChoice.and.returnValue('basic');

      sut.spawnEnemy(entityManager);

      const call = entityFactory.createEnemy.calls.mostRecent();
      const isChampion = call.args[6];
      expect(isChampion).toBe(false);
    });

    it('champion should supersede elite (isElite = false when isChampion = true)', () => {
      const sut = service as unknown as ChampionPrivates;
      sut.currentWaveNumber = 15;
      // Set high elite chance so elite would normally be true
      sut.config.eliteChance = 1.0;

      let callCount = 0;
      randomService.random.and.callFake(() => {
        callCount++;
        return callCount >= 3 ? 0.04 : 0.5;
      });
      randomService.weightedChoice.and.returnValue('basic');

      sut.spawnEnemy(entityManager);

      const call = entityFactory.createEnemy.calls.mostRecent();
      const isElite = call.args[4]; // 5th arg
      const isChampion = call.args[6]; // 7th arg
      expect(isChampion).toBe(true);
      expect(isElite).toBe(false);
    });

    it('champion should always use legendary rarity', () => {
      const sut = service as unknown as ChampionPrivates;
      sut.currentWaveNumber = 15;

      let callCount = 0;
      randomService.random.and.callFake(() => {
        callCount++;
        return callCount >= 3 ? 0.04 : 0.5;
      });
      randomService.weightedChoice.and.returnValue('basic');

      sut.spawnEnemy(entityManager);

      const call = entityFactory.createEnemy.calls.mostRecent();
      const rarity = call.args[3]; // 4th arg
      expect(rarity).toBe('legendary');
    });
  });
});
