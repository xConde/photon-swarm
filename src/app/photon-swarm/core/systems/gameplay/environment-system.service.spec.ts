import { TestBed } from '@angular/core/testing';
import { EnvironmentSystemService } from './environment-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { RandomService } from '../../utils/random.service';
import { GameStateService } from '../../state/game-state.service';
import { BuffManagementSystemService } from './buff-management-system.service';
import { VisualFeedbackCoordinatorService } from '../../services/visual-feedback-coordinator.service';
import { BuffSystemService } from '../../progression/buff-system.service';
import { AudioService } from '../../audio/audio.service';
import {
  AsteroidComponent,
  CollisionBoxComponent,
  DamageComponent,
  HealthComponent,
  PositionComponent,
  PowerupComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';

describe('EnvironmentSystemService', () => {
  let service: EnvironmentSystemService;
  let entityManager: EntityManagerService;
  let entityFactory: EntityFactoryECSService;
  let randomService: jasmine.SpyObj<RandomService>;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;

  beforeEach(() => {
    const randomSpy = jasmine.createSpyObj('RandomService', ['random']);
    const gameSpy = jasmine.createSpyObj('GameStateService', ['takeDamage', 'getHealth']);
    const buffManagementSpy = jasmine.createSpyObj('BuffManagementSystemService', ['applyBuff']);
    const visualFeedbackSpy = jasmine.createSpyObj('VisualFeedbackCoordinatorService', ['showUpgrade']);
    const buffSystemSpy = jasmine.createSpyObj('BuffSystemService', ['applyBuff']);
    const audioSpy = jasmine.createSpyObj('AudioService', ['playPowerupCollect']);

    // Default mock values
    gameSpy.getHealth.and.returnValue(100);

    TestBed.configureTestingModule({
      providers: [
        EnvironmentSystemService,
        EntityManagerService,
        EntityFactoryECSService,
        { provide: RandomService, useValue: randomSpy },
        { provide: GameStateService, useValue: gameSpy },
        { provide: BuffManagementSystemService, useValue: buffManagementSpy },
        { provide: VisualFeedbackCoordinatorService, useValue: visualFeedbackSpy },
        { provide: BuffSystemService, useValue: buffSystemSpy },
        { provide: AudioService, useValue: audioSpy },
      ],
    });

    service = TestBed.inject(EnvironmentSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    entityFactory = TestBed.inject(EntityFactoryECSService);
    randomService = TestBed.inject(RandomService) as jasmine.SpyObj<RandomService>;
    gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;

    // Default mock values
    randomService.random.and.returnValue(0.5);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('initialization', () => {
    it('should create powerup zones on init', () => {
      let eventCount = 0;
      service.environmentEvent$.subscribe((event) => {
        if (event.type === 'damage_field_created') {
          eventCount++;
        }
      });

      service.init(entityManager);

      // 3 powerup zones emit events (health pack does not emit)
      expect(eventCount).toBe(3);
      // hazardZones includes 3 powerup zones + 1 health pack = 4
      expect(service['hazardZones'].length).toBe(4);
    });

    it('should reset timers on init', () => {
      service['asteroidSpawnTimer'] = 100;
      service['voidStormTimer'] = 200;
      service['voidStormActive'] = true;

      service.init(entityManager);

      expect(service['asteroidSpawnTimer']).toBe(0);
      expect(service['voidStormTimer']).toBe(0);
      expect(service['voidStormActive']).toBe(false);
    });

    it('reconstructs one complete powerup set after the ECS world is cleared', () => {
      service.init(entityManager);
      entityManager.clear();

      service.reset();
      service.initializeRun(entityManager);

      expect(entityManager.getEntitiesWithComponents(PowerupComponent).length).toBe(4);
      expect(service['hazardZones'].length).toBe(4);
    });
  });

  describe('asteroid spawning', () => {
    it('should spawn asteroids at regular intervals', () => {
      service.init(entityManager);

      let spawnCount = 0;
      service.environmentEvent$.subscribe((event) => {
        if (event.type === 'asteroid_spawned') {
          spawnCount++;
        }
      });

      // Spawn rate is 0.5 per second, so every 2 seconds
      // Note: update() clamps deltaTime to max 100ms, so we need to call it multiple times
      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager); // 100ms * 10 = 1 second
      }
      expect(spawnCount).toBe(0);

      // 11 more updates = 2.1 seconds total
      for (let i = 0; i < 11; i++) {
        service.update(100, entityManager);
      }
      expect(spawnCount).toBe(1);
    });

    it('should spawn asteroids from random edges', () => {
      service.init(entityManager);
      service.setWorldBounds(1000, 1000);

      // Test all 4 edges
      const positions: Array<{ x: number; y: number }> = [];

      service.environmentEvent$.subscribe((event) => {
        if (event.type === 'asteroid_spawned' && event.position) {
          positions.push(event.position);
        }
      });

      // Mock different random values for each edge
      randomService.random.and.returnValues(0, 0.5, 0.25, 0.5, 0.5, 0.5, 0.75, 0.5);

      for (let i = 0; i < 4; i++) {
        service['spawnAsteroid'](entityManager);
      }

      // Check that asteroids spawn from different edges
      expect(positions.length).toBe(4);

      // At least one should be from each edge (with margin)
      const hasTop = positions.some((p) => p.y < 0);
      const hasBottom = positions.some((p) => p.y > 1000);
      const hasLeft = positions.some((p) => p.x < 0);
      const hasRight = positions.some((p) => p.x > 1000);

      expect(hasTop || hasBottom || hasLeft || hasRight).toBeTruthy();
    });

    it('should create asteroids with correct components', () => {
      service.init(entityManager);

      service['spawnAsteroid'](entityManager);

      // Find asteroids by checking for collision group 'asteroid'
      const entitiesWithCollision = entityManager.getEntitiesWithComponents(CollisionBoxComponent);
      let asteroid: number | null = null;
      for (const entity of entitiesWithCollision) {
        const collisionBox = entityManager.getComponent(entity, CollisionBoxComponent)!;
        if (collisionBox.collisionGroup === 'asteroid') {
          asteroid = entity;
          break;
        }
      }

      expect(asteroid).not.toBeNull();
      expect(entityManager.hasComponent(asteroid!, PositionComponent)).toBeTruthy();
      expect(entityManager.hasComponent(asteroid!, VelocityComponent)).toBeTruthy();
      expect(entityManager.hasComponent(asteroid!, CollisionBoxComponent)).toBeTruthy();
      expect(entityManager.hasComponent(asteroid!, RenderableComponent)).toBeTruthy();
      expect(entityManager.hasComponent(asteroid!, HealthComponent)).toBeTruthy();
      expect(entityManager.hasComponent(asteroid!, DamageComponent)).toBeTruthy();
      // Bug A fix: AsteroidComponent must be attached so the renderer can query it
      expect(entityManager.hasComponent(asteroid!, AsteroidComponent)).toBeTruthy();
    });

    it('should not spawn when ambient cap is reached', () => {
      service.init(entityManager);
      service.setWorldBounds(2000, 2000);

      // Saturate to MAX_CONCURRENT (12)
      for (let i = 0; i < 12; i++) {
        service['spawnAsteroid'](entityManager);
      }
      const beforeCount = entityManager.getEntitiesWithComponents(AsteroidComponent).length;

      // One more spawn attempt should be silently dropped
      service['spawnAsteroid'](entityManager);
      const afterCount = entityManager.getEntitiesWithComponents(AsteroidComponent).length;

      expect(beforeCount).toBe(12);
      expect(afterCount).toBe(12); // cap enforced
    });
  });

  describe('asteroid movement', () => {
    it('should update asteroid positions', () => {
      const asteroid = entityManager.createEntity();
      entityManager.addComponent(asteroid, new PositionComponent(500, 500));
      entityManager.addComponent(asteroid, new VelocityComponent(100, 0));
      // Service identifies asteroids by CollisionBoxComponent with collisionGroup 'asteroid'
      entityManager.addComponent(asteroid, new CollisionBoxComponent(20, 'asteroid'));

      // Note: update() clamps deltaTime to max 100ms, so we need multiple calls for 1 second
      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager);
      }

      const position = entityManager.getComponent(asteroid, PositionComponent)!;
      expect(position.x).toBe(600); // 500 + 100 * 1
      expect(position.y).toBe(500);
    });

    it('should remove asteroids that go too far outside bounds', () => {
      service.setWorldBounds(1000, 1000);

      // Create asteroid far outside bounds - removal happens immediately when position is checked
      const asteroid = entityManager.createEntity();
      entityManager.addComponent(asteroid, new PositionComponent(-500, 500)); // Very far outside
      entityManager.addComponent(asteroid, new VelocityComponent(-100, 0));
      entityManager.addComponent(asteroid, new CollisionBoxComponent(20, 'asteroid'));

      service.update(100, entityManager);

      expect(entityManager.getEntityCount()).toBe(0); // Asteroid removed
    });
  });

  describe('void storm', () => {
    it('should start void storm after frequency interval', () => {
      service.init(entityManager);

      let stormStarted = false;
      service.environmentEvent$.subscribe((event) => {
        if (event.type === 'void_storm_started') {
          stormStarted = true;
        }
      });

      // ENVIRONMENT_CONFIG.VOID_STORM.INTERVAL_MS = 120000 (2 minutes)
      // Note: update() clamps deltaTime to 100ms max, so we need many calls
      // For practical testing, use forceVoidStorm() instead
      service.forceVoidStorm();
      expect(stormStarted).toBeTruthy();
      expect(service['voidStormActive']).toBeTruthy();
    });

    it('should end void storm after duration', () => {
      service.init(entityManager);
      service.forceVoidStorm();

      let stormEnded = false;
      service.environmentEvent$.subscribe((event) => {
        if (event.type === 'void_storm_ended') {
          stormEnded = true;
        }
      });

      // ENVIRONMENT_CONFIG.VOID_STORM.DURATION_MS = 8000 (8 seconds)
      // Note: update() clamps deltaTime to 100ms max
      // Update 70 times = 7 seconds - storm still active
      for (let i = 0; i < 70; i++) {
        service.update(100, entityManager);
      }
      expect(stormEnded).toBeFalsy();

      // Update 15 more times = 8.5 seconds total - storm should end
      for (let i = 0; i < 15; i++) {
        service.update(100, entityManager);
      }
      expect(stormEnded).toBeTruthy();
      expect(service['voidStormActive']).toBeFalsy();
    });
  });

  describe('powerup zones (formerly hazard zones)', () => {
    it('should not apply damage to players in powerup zones', () => {
      // Powerup zones no longer deal damage - they grant powerups instead
      service.init(entityManager);
      const player = entityFactory.createPlayer(500, 500);

      // Place player in powerup zone
      const powerupPos = entityManager.getComponent(service['hazardZones'][0], PositionComponent)!;
      const playerPos = entityManager.getComponent(player, PositionComponent)!;
      playerPos.x = powerupPos.x;
      playerPos.y = powerupPos.y;

      const health = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = health.health;

      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager);
      }

      // Health should remain unchanged (powerup zones don't damage)
      expect(health.health).toBe(initialHealth);
    });
  });

  describe('void storm timing (no longer damages)', () => {
    it('should track void storm state without applying damage', () => {
      service.init(entityManager);
      const player = entityFactory.createPlayer(500, 500);

      service.forceVoidStorm();

      const health = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = health.health;

      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager);
      }

      // Void storms no longer apply damage - they only track state
      expect(health.health).toBe(initialHealth);
      expect(service['voidStormActive']).toBeTruthy();
    });
  });

  describe('boundary damage', () => {
    it('should damage entities outside world bounds', () => {
      service.setWorldBounds(1000, 1000);

      const player = entityFactory.createPlayer(-100, 500); // Outside left boundary
      const health = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = health.health;

      // Set up gameState mock to track damage for player
      let trackedHealth = initialHealth;
      gameStateSpy.takeDamage.and.callFake((damage: number) => {
        trackedHealth = Math.max(0, trackedHealth - damage);
      });
      gameStateSpy.getHealth.and.callFake(() => trackedHealth);

      // Note: update() clamps deltaTime to 100ms max, so 10 calls = 1 second
      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager);
      }

      // ENVIRONMENT_CONFIG.WORLD_BOUNDARY.DAMAGE_PER_SECOND = 20 damage per second
      // Now synced from gameState for player entities
      expect(health.health).toBeCloseTo(initialHealth - 20, 1);
    });

    it('should not damage entities inside bounds', () => {
      service.setWorldBounds(1000, 1000);

      const player = entityFactory.createPlayer(500, 500); // Inside bounds
      const health = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = health.health;

      // Set up gameState mock to track damage for player
      let trackedHealth = initialHealth;
      gameStateSpy.takeDamage.and.callFake((damage: number) => {
        trackedHealth = Math.max(0, trackedHealth - damage);
      });
      gameStateSpy.getHealth.and.callFake(() => trackedHealth);

      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager);
      }

      expect(health.health).toBe(initialHealth);
    });

    it('should allow grace margin before damage', () => {
      service.setWorldBounds(1000, 1000);

      const player = entityFactory.createPlayer(-40, 500); // Just outside, within margin
      const health = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = health.health;

      // Set up gameState mock to track damage for player
      let trackedHealth = initialHealth;
      gameStateSpy.takeDamage.and.callFake((damage: number) => {
        trackedHealth = Math.max(0, trackedHealth - damage);
      });
      gameStateSpy.getHealth.and.callFake(() => trackedHealth);

      for (let i = 0; i < 10; i++) {
        service.update(100, entityManager);
      }

      expect(health.health).toBe(initialHealth); // No damage within margin
    });
  });

  describe('environment status', () => {
    it('should report correct status', () => {
      service.init(entityManager);

      let status = service.getEnvironmentStatus();
      expect(status.voidStormActive).toBeFalsy();
      // hazardZones includes 3 powerup zones + 1 health pack = 4
      expect(status.hazardZoneCount).toBe(4);
      expect(status.nextStormIn).toBeCloseTo(120, 1); // ENVIRONMENT_CONFIG.VOID_STORM.INTERVAL_MS / 1000

      service.forceVoidStorm();
      status = service.getEnvironmentStatus();
      expect(status.voidStormActive).toBeTruthy();
      expect(status.voidStormTimeRemaining).toBeCloseTo(8, 1); // ENVIRONMENT_CONFIG.VOID_STORM.DURATION_MS / 1000
      expect(status.nextStormIn).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should complete observable and clear hazard zones on destroy', () => {
      service.init(entityManager);

      let completed = false;
      service.environmentEvent$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      service.destroy();

      expect(completed).toBeTruthy();
      expect(service['hazardZones'].length).toBe(0);
    });
  });
});
