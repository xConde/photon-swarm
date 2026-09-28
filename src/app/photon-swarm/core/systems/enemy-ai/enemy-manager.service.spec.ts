import { TestBed } from '@angular/core/testing';
import { EnemyManagerService } from './enemy-manager.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import {
  DeathAnimationComponent,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  RenderableComponent,
} from '@photon/components';
import { EnemyType } from '../../models/enemy.model';
import { PoolType, SPAWN_CONFIG } from '@photon/config/game-constants';

describe('EnemyManagerService', () => {
  let service: EnemyManagerService;
  let entityManager: EntityManagerService;
  let entityFactory: jasmine.SpyObj<EntityFactoryECSService>;
  let performanceMonitor: jasmine.SpyObj<PerformanceMonitorService>;

  beforeEach(() => {
    const perfSpy = jasmine.createSpyObj('PerformanceMonitorService', ['getPerformanceSummary', 'startSystemTimer']);
    perfSpy.startSystemTimer.and.returnValue({ end: jasmine.createSpy('end').and.returnValue(0) });
    const debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    // FIX: Add EntityFactoryECSService spy for testing returnToPool calls
    const factorySpy = jasmine.createSpyObj('EntityFactoryECSService', ['returnToPool']);

    TestBed.configureTestingModule({
      providers: [
        EnemyManagerService,
        EntityManagerService,
        { provide: EntityFactoryECSService, useValue: factorySpy },
        { provide: PerformanceMonitorService, useValue: perfSpy },
        { provide: DebugLogBridgeService, useValue: debugSpy },
      ],
    });

    service = TestBed.inject(EnemyManagerService);
    entityManager = TestBed.inject(EntityManagerService);
    entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
    performanceMonitor = TestBed.inject(PerformanceMonitorService) as jasmine.SpyObj<PerformanceMonitorService>;

    performanceMonitor.getPerformanceSummary.and.returnValue({
      averageFps: 60,
      frameCount: 1000,
      systemMetrics: [],
      memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
      performanceScore: 100,
    });
  });

  afterEach(() => {
    entityManager.clear();
  });

  /**
   * Helper to create a test enemy entity
   */
  function createEnemy(x: number, y: number, health = 100): number {
    const entity = entityManager.createEntity();
    entityManager.addComponent(entity, new PositionComponent(x, y));
    entityManager.addComponent(entity, new EnemyTypeComponent(EnemyType.Basic, 'common'));
    entityManager.addComponent(entity, new HealthComponent(health, health));
    const renderable = new RenderableComponent('#ff0000', 1);
    // Set spawnTime to 5 seconds ago so spawn immunity (2000ms) does not block cleanup tests
    renderable.spawnTime = window.performance.now() - 5000;
    entityManager.addComponent(entity, renderable);
    return entity;
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getEnemies', () => {
    it('should return empty array when no enemies exist', () => {
      expect(service.getEnemies()).toEqual([]);
    });

    it('should return all enemies with their components', () => {
      createEnemy(100, 100);
      createEnemy(200, 200);

      const enemies = service.getEnemies();
      expect(enemies.length).toBe(2);
      expect(enemies[0].position).toBeDefined();
      expect(enemies[0].enemyType).toBeDefined();
      expect(enemies[0].health).toBeDefined();
    });
  });

  describe('getEnemyCount', () => {
    it('should return 0 when no enemies', () => {
      expect(service.getEnemyCount()).toBe(0);
    });

    it('should return correct count', () => {
      createEnemy(100, 100);
      createEnemy(200, 200);
      createEnemy(300, 300);

      expect(service.getEnemyCount()).toBe(3);
    });
  });

  describe('canSpawnEnemy', () => {
    it('should return true when below max enemies', () => {
      expect(service.canSpawnEnemy()).toBe(true);
    });

    it('should return false when at max enemies', () => {
      // Create MAX_ENEMIES enemies
      for (let i = 0; i < SPAWN_CONFIG.LIMITS.MAX_ENEMIES; i++) {
        createEnemy(i * 100, i * 100);
      }

      expect(service.canSpawnEnemy()).toBe(false);
    });

    it('should return false when FPS is low and above performance limit', () => {
      performanceMonitor.getPerformanceSummary.and.returnValue({
        averageFps: 40, // Below PERFORMANCE_LIMIT_FPS
        frameCount: 500,
        systemMetrics: [],
        memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
        performanceScore: 50,
      });

      // Create more than PERFORMANCE_LIMIT_ENEMIES
      for (let i = 0; i < SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_ENEMIES + 5; i++) {
        createEnemy(i * 100, i * 100);
      }

      expect(service.canSpawnEnemy()).toBe(false);
    });
  });

  describe('cleanupDistantEnemies - fade animation', () => {
    const CLEANUP_DISTANCE = SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE;
    const FADE_DISTANCE = SPAWN_CONFIG.LIMITS.CLEANUP_FADE_DISTANCE;
    const playerX = 6000;
    const playerY = 4500;

    it('should NOT cleanup enemies within fade distance', () => {
      // Create enemy at safe distance
      const safeDistance = FADE_DISTANCE - 100;
      const enemy = createEnemy(playerX + safeDistance, playerY);

      const cleanedUp = service.cleanupDistantEnemies(playerX, playerY);

      expect(cleanedUp).toBe(0);
      expect(entityManager.getComponent(enemy, PositionComponent)).toBeDefined();
    });

    it('should add DeathAnimationComponent to enemies between fade and cleanup distance', () => {
      // Create enemy in fade zone (between FADE_DISTANCE and CLEANUP_DISTANCE)
      const fadeZoneDistance = (FADE_DISTANCE + CLEANUP_DISTANCE) / 2;
      const enemy = createEnemy(playerX + fadeZoneDistance, playerY);

      service.cleanupDistantEnemies(playerX, playerY);

      // Should have death animation but NOT be destroyed
      const deathAnim = entityManager.getComponent(enemy, DeathAnimationComponent);
      expect(deathAnim).toBeDefined();
      expect(deathAnim?.animationType).toBe('fade');
      expect(entityManager.getComponent(enemy, PositionComponent)).toBeDefined();
    });

    it('should hard destroy enemies beyond cleanup distance', () => {
      // Create enemy beyond hard cleanup distance
      const farDistance = CLEANUP_DISTANCE + 100;
      const enemy = createEnemy(playerX + farDistance, playerY);

      const cleanedUp = service.cleanupDistantEnemies(playerX, playerY);

      expect(cleanedUp).toBe(1);
      // Entity is returned to pool, but still exists in entity manager
      // Verify returnToPool was called instead of checking entity removal
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, enemy);
    });

    it('should NOT add duplicate death animations', () => {
      // Create enemy in fade zone
      const fadeZoneDistance = (FADE_DISTANCE + CLEANUP_DISTANCE) / 2;
      const enemy = createEnemy(playerX + fadeZoneDistance, playerY);

      // First cleanup - should add animation
      service.cleanupDistantEnemies(playerX, playerY);
      const firstAnim = entityManager.getComponent(enemy, DeathAnimationComponent);
      expect(firstAnim).toBeDefined();

      // Second cleanup - should NOT add another animation
      service.cleanupDistantEnemies(playerX, playerY);
      // Entity should still exist (animation in progress)
      expect(entityManager.getComponent(enemy, PositionComponent)).toBeDefined();
    });

    it('should track entities marked for fade', () => {
      interface ServiceWithFadeTracking {
        entitiesMarkedForFade: Set<number>;
      }
      const serviceInternal = service as unknown as ServiceWithFadeTracking;

      // Create enemy in fade zone
      const fadeZoneDistance = (FADE_DISTANCE + CLEANUP_DISTANCE) / 2;
      const enemy = createEnemy(playerX + fadeZoneDistance, playerY);

      service.cleanupDistantEnemies(playerX, playerY);

      expect(serviceInternal.entitiesMarkedForFade.has(enemy)).toBe(true);
    });

    it('should clean up fade tracking for destroyed entities', () => {
      interface ServiceWithFadeTracking {
        entitiesMarkedForFade: Set<number>;
        cleanupFadeTracking: () => void;
      }
      const serviceInternal = service as unknown as ServiceWithFadeTracking;

      // Manually add a non-existent entity to tracking
      serviceInternal.entitiesMarkedForFade.add(99999);

      // Call cleanup
      serviceInternal.cleanupFadeTracking();

      expect(serviceInternal.entitiesMarkedForFade.has(99999)).toBe(false);
    });

    it('should instantly destroy enemies without renderable component', () => {
      // Create enemy without renderable in fade zone
      const fadeZoneDistance = (FADE_DISTANCE + CLEANUP_DISTANCE) / 2;
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PositionComponent(playerX + fadeZoneDistance, playerY));
      entityManager.addComponent(entity, new EnemyTypeComponent(EnemyType.Basic, 'common'));
      entityManager.addComponent(entity, new HealthComponent(100, 100));
      // Note: NO RenderableComponent

      const cleanedUp = service.cleanupDistantEnemies(playerX, playerY);

      expect(cleanedUp).toBe(1);
      // Entity without renderable is instantly returned to pool (no fade animation)
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, entity);
    });

    it('should skip enemies already dying', () => {
      // Create enemy in fade zone with existing death animation
      const fadeZoneDistance = (FADE_DISTANCE + CLEANUP_DISTANCE) / 2;
      const enemy = createEnemy(playerX + fadeZoneDistance, playerY);

      // Manually add death animation (simulating combat death)
      entityManager.addComponent(enemy, new DeathAnimationComponent(600, 'flash'));

      const cleanedUp = service.cleanupDistantEnemies(playerX, playerY);

      // Should not count as cleaned up (already dying)
      expect(cleanedUp).toBe(0);
    });
  });

  describe('getEnemiesInRange', () => {
    it('should return enemies within specified range', () => {
      createEnemy(100, 100);
      createEnemy(200, 200);
      createEnemy(1000, 1000); // Far away

      const inRange = service.getEnemiesInRange(150, 150, 200);

      expect(inRange.length).toBe(2);
      expect(inRange[0].distance).toBeLessThanOrEqual(200);
    });

    it('should sort by distance', () => {
      createEnemy(300, 300);
      createEnemy(100, 100);
      createEnemy(200, 200);

      const inRange = service.getEnemiesInRange(0, 0, 500);

      expect(inRange.length).toBe(3);
      expect(inRange[0].distance).toBeLessThan(inRange[1].distance);
      expect(inRange[1].distance).toBeLessThan(inRange[2].distance);
    });
  });

  describe('clearAllEnemies', () => {
    it('should destroy all enemies', () => {
      createEnemy(100, 100);
      createEnemy(200, 200);
      createEnemy(300, 300);

      const cleared = service.clearAllEnemies();

      expect(cleared).toBe(3);
      // Note: getEnemyCount still returns 3 because we're using a mock entityFactory
      // that doesn't actually remove entities. The important thing is returnToPool was called.
    });

    // FIX: Test that clearAllEnemies uses returnToPool instead of destroyEntity
    it('should call returnToPool for each enemy when clearing all', () => {
      const enemy1 = createEnemy(100, 100);
      const enemy2 = createEnemy(200, 200);
      const enemy3 = createEnemy(300, 300);

      service.clearAllEnemies();

      // Verify returnToPool was called 3 times with ENEMY pool type
      expect(entityFactory.returnToPool).toHaveBeenCalledTimes(3);
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, enemy1);
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, enemy2);
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, enemy3);
    });
  });

  // FIX: Tests for pool-based cleanup (instead of destroyEntity)
  describe('pool-based entity cleanup', () => {
    const CLEANUP_DISTANCE = SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE;
    const FADE_DISTANCE = SPAWN_CONFIG.LIMITS.CLEANUP_FADE_DISTANCE;
    const playerX = 6000;
    const playerY = 4500;

    it('should call returnToPool for hard cleanup of distant enemies', () => {
      // Create enemy beyond hard cleanup distance
      const farDistance = CLEANUP_DISTANCE + 100;
      const enemy = createEnemy(playerX + farDistance, playerY);

      service.cleanupDistantEnemies(playerX, playerY);

      // Verify returnToPool was called with ENEMY pool type
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, enemy);
    });

    it('should call returnToPool for enemies without renderable in fade zone', () => {
      // Create enemy without renderable in fade zone
      const fadeZoneDistance = (FADE_DISTANCE + CLEANUP_DISTANCE) / 2;
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PositionComponent(playerX + fadeZoneDistance, playerY));
      entityManager.addComponent(entity, new EnemyTypeComponent(EnemyType.Basic, 'common'));
      entityManager.addComponent(entity, new HealthComponent(100, 100));
      // Note: NO RenderableComponent - should trigger instant cleanup

      service.cleanupDistantEnemies(playerX, playerY);

      // Verify returnToPool was called with ENEMY pool type
      expect(entityFactory.returnToPool).toHaveBeenCalledWith(PoolType.ENEMY, entity);
    });
  });

  describe('getEnemyDistribution', () => {
    it('should calculate distribution by distance', () => {
      createEnemy(100, 100); // Near
      createEnemy(600, 600); // Medium
      createEnemy(1200, 1200); // Far

      const dist = service.getEnemyDistribution(0, 0);

      expect(dist.total).toBe(3);
      expect(dist.byDistance.near).toBeGreaterThanOrEqual(1);
    });

    it('should calculate distribution by type', () => {
      createEnemy(100, 100);
      createEnemy(200, 200);

      const dist = service.getEnemyDistribution(0, 0);

      expect(dist.byType['basic']).toBe(2);
    });
  });
});
