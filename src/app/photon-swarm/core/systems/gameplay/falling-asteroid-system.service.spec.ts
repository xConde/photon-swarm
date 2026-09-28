import { TestBed } from '@angular/core/testing';
import { FallingAsteroidSystemService } from './falling-asteroid-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { GameStateService } from '../../state/game-state.service';
import { SettingsService } from '../../utils/settings.service';
import { BuffManagementSystemService } from '../gameplay';
import { BuffSystemService } from '../../progression/buff-system.service';
import { AudioService } from '../../audio/audio.service';
import { AsteroidState, FallingAsteroidComponent } from '@photon/components/falling-asteroid.component';
import {
  CollisionBoxComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';

describe('FallingAsteroidSystemService', () => {
  let service: FallingAsteroidSystemService;
  let entityManager: EntityManagerService;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;
  let buffSystemSpy: jasmine.SpyObj<BuffManagementSystemService>;
  let settingsSpy: jasmine.SpyObj<SettingsService>;
  let buffSystemServiceSpy: jasmine.SpyObj<BuffSystemService>;
  let audioSpy: jasmine.SpyObj<AudioService>;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 10000;

    gameStateSpy = jasmine.createSpyObj('GameStateService', ['takeDamage', 'getHealth', 'getMaxHealth']);
    buffSystemSpy = jasmine.createSpyObj('BuffManagementSystemService', [
      'applyBuff',
      'getActiveBuffs',
      'getBuffValue',
      'hasBuff',
    ]);
    settingsSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
    buffSystemServiceSpy = jasmine.createSpyObj('BuffSystemService', ['applyBuff']);
    audioSpy = jasmine.createSpyObj('AudioService', ['playPowerupCollect']);

    gameStateSpy.getHealth.and.returnValue(100);
    gameStateSpy.getMaxHealth.and.returnValue(100);
    buffSystemSpy.applyBuff.and.returnValue(false); // default: buff not applied
    settingsSpy.getSettings.and.returnValue({
      screenShake: false,
      volume: 100,
      showDamageNumbers: true,
      chromaticAberration: false,
      lowHealthVignette: true,
      colorblindMode: 'none',
      sensitivity: 1,
    });

    TestBed.configureTestingModule({
      providers: [
        FallingAsteroidSystemService,
        EntityManagerService,
        ErrorHandlerService,
        { provide: DebugLogBridgeService, useValue: jasmine.createSpyObj('DebugLogBridgeService', ['log']) },
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: BuffManagementSystemService, useValue: buffSystemSpy },
        { provide: SettingsService, useValue: settingsSpy },
        { provide: BuffSystemService, useValue: buffSystemServiceSpy },
        { provide: AudioService, useValue: audioSpy },
      ],
    });

    service = TestBed.inject(FallingAsteroidSystemService);
    entityManager = TestBed.inject(EntityManagerService);

    spyOn(Date, 'now').and.callFake(() => mockTime);
    spyOn(window.performance, 'now').and.returnValue(0);
  });

  afterEach(() => {
    entityManager.clear();
  });

  function createPlayerAt(x: number, y: number): number {
    const entity = entityManager.createEntity();
    entityManager.addComponent(entity, new PlayerControlledComponent());
    entityManager.addComponent(entity, new PositionComponent(x, y));
    return entity;
  }

  function createAsteroidEntity(state: AsteroidState, targetX = 0, targetY = 0, warningStartTime = 0): number {
    const entity = entityManager.createEntity();
    const asteroid = new FallingAsteroidComponent(
      state,
      warningStartTime, // warningStartTime
      0, // fallStartTime
      0, // impactTime
      targetX,
      targetY,
      1000, // fallHeight
      150, // impactRadius
      40, // impactDamage
      40, // size
      80, // health
      80, // maxHealth
      'speed',
      10000,
      1.5,
      false // not mega
    );
    entityManager.addComponent(entity, asteroid);
    entityManager.addComponent(entity, new PositionComponent(targetX, targetY));
    entityManager.addComponent(entity, new RenderableComponent('#00ffff', 'world', true, 0.3, 0));
    entityManager.addComponent(entity, new VelocityComponent(0, 0));
    return entity;
  }

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should schedule first spawn 10s after init', () => {
      mockTime = 0;
      service.init(entityManager);
      expect(service['nextSpawnTime']).toBe(10000);
    });

    it('should not cache a player entity before first update', () => {
      expect(service['playerEntity']).toBeNull();
    });
  });

  describe('update — player caching', () => {
    it('should cache player entity on first update', () => {
      const player = createPlayerAt(0, 0);
      service['nextSpawnTime'] = mockTime + 99999; // prevent spawning

      service.update(16, entityManager);

      expect(service['playerEntity']).toBe(player);
    });

    it('should not spawn asteroid before nextSpawnTime', () => {
      createPlayerAt(0, 0);
      service['nextSpawnTime'] = mockTime + 1000;

      service.update(16, entityManager);

      const asteroids = entityManager.getEntitiesWithComponents(FallingAsteroidComponent);
      expect(asteroids.length).toBe(0);
    });

    it('should spawn asteroid when nextSpawnTime is reached', () => {
      createPlayerAt(0, 0);
      service['nextSpawnTime'] = mockTime - 1; // time already passed

      service.update(16, entityManager);

      const asteroids = entityManager.getEntitiesWithComponents(FallingAsteroidComponent);
      expect(asteroids.length).toBe(1);
    });

    it('should schedule a new spawn time after spawning', () => {
      createPlayerAt(0, 0);
      service['nextSpawnTime'] = mockTime - 1;
      const previousSpawnTime = service['nextSpawnTime'];

      service.update(16, entityManager);

      expect(service['nextSpawnTime']).toBeGreaterThan(previousSpawnTime);
    });
  });

  describe('asteroid state machine — WARNING phase', () => {
    it('should pulse opacity during warning phase', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.WARNING, 0, 0, mockTime - 100);
      const render = entityManager.getComponent(asteroidId, RenderableComponent);

      service.update(16, entityManager);

      // Pulse formula: sin(elapsed * 0.01) * 0.2 + 0.4 — just verify it changed
      expect(render?.opacity).toBeDefined();
      expect(render?.opacity).toBeGreaterThan(0);
    });

    it('should transition to FALLING after WARNING_DURATION (2000ms)', () => {
      const warningStart = mockTime - 2100; // past 2000ms warning duration
      const asteroidId = createAsteroidEntity(AsteroidState.WARNING, 100, 200, warningStart);

      service.update(16, entityManager);

      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      expect(asteroid?.state).toBe(AsteroidState.FALLING);
    });
  });

  describe('asteroid state machine — FALLING phase', () => {
    it('should move asteroid downward as fall progresses', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.FALLING, 100, 200);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.fallStartTime = mockTime - 750; // halfway through 1500ms fall
      }
      const position = entityManager.getComponent(asteroidId, PositionComponent);
      const initialY = position?.y ?? 0;

      service.update(16, entityManager);

      // Y should have moved toward target
      expect(position?.y).not.toBe(initialY);
    });

    it('should transition to IMPACT when fall is complete', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.FALLING, 100, 200);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.fallStartTime = mockTime - 2000; // well past 1500ms FALL_DURATION
      }

      service.update(16, entityManager);

      expect(asteroid?.state).toBe(AsteroidState.IMPACT);
    });
  });

  describe('asteroid state machine — IMPACT phase', () => {
    it('should add HealthComponent to asteroid on impact', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.IMPACT, 100, 200);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.impactTime = mockTime - 100; // recently impacted
      }

      service.update(16, entityManager);

      expect(entityManager.hasComponent(asteroidId, HealthComponent)).toBe(true);
    });

    it('should add CollisionBoxComponent to asteroid on impact', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.IMPACT, 100, 200);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.impactTime = mockTime - 100;
      }

      service.update(16, entityManager);

      expect(entityManager.hasComponent(asteroidId, CollisionBoxComponent)).toBe(true);
    });

    it('should transition to LANDED after IMPACT_DURATION (500ms)', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.IMPACT, 100, 200);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.impactTime = mockTime - 600; // past 500ms
      }

      service.update(16, entityManager);

      expect(asteroid?.state).toBe(AsteroidState.LANDED);
    });
  });

  describe('asteroid state machine — LANDED phase', () => {
    it('should transition to DESTROYED and destroy entity when health reaches 0', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.LANDED);
      entityManager.addComponent(asteroidId, new HealthComponent(0, 80));

      service.update(16, entityManager);

      expect(entityManager.hasEntity(asteroidId)).toBe(false);
    });

    it('should remain in LANDED state while health is above 0', () => {
      const asteroidId = createAsteroidEntity(AsteroidState.LANDED);
      entityManager.addComponent(asteroidId, new HealthComponent(50, 80));

      service.update(16, entityManager);

      // Entity still exists
      expect(entityManager.hasEntity(asteroidId)).toBe(true);
    });
  });

  describe('impact damage', () => {
    it('should deal damage to player within impact radius', () => {
      // Player at 0,0; asteroid impacts at 50,0 (distance 50, within radius 150)
      createPlayerAt(0, 0);
      service['playerEntity'] = entityManager.getEntitiesWithComponents(PlayerControlledComponent)[0];

      const asteroidId = createAsteroidEntity(AsteroidState.FALLING, 50, 0);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.fallStartTime = mockTime - 2000; // force impact this frame
      }

      service.update(16, entityManager);

      expect(gameStateSpy.takeDamage).toHaveBeenCalled();
    });

    it('should not deal damage to player outside impact radius', () => {
      // Player at 1000,0; asteroid impacts at 0,0 (distance 1000 > radius 150)
      createPlayerAt(1000, 0);
      service['playerEntity'] = entityManager.getEntitiesWithComponents(PlayerControlledComponent)[0];

      const asteroidId = createAsteroidEntity(AsteroidState.FALLING, 0, 0);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.fallStartTime = mockTime - 2000;
      }

      service.update(16, entityManager);

      expect(gameStateSpy.takeDamage).not.toHaveBeenCalled();
    });

    it('should instant-kill enemies within impact radius', () => {
      // Set up player far away to avoid player damage path
      createPlayerAt(9999, 9999);
      service['playerEntity'] = entityManager.getEntitiesWithComponents(PlayerControlledComponent)[0];

      // Enemy at 50,0 — within radius 150 of impact at 0,0
      const enemy = entityManager.createEntity();
      entityManager.addComponent(enemy, new EnemyTypeComponent());
      entityManager.addComponent(enemy, new PositionComponent(50, 0));
      const enemyHealth = new HealthComponent(100, 100);
      entityManager.addComponent(enemy, enemyHealth);

      const asteroidId = createAsteroidEntity(AsteroidState.FALLING, 0, 0);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
      if (asteroid) {
        asteroid.fallStartTime = mockTime - 2000;
      }

      service.update(16, entityManager);

      expect(enemyHealth.health).toBe(0);
    });
  });

  describe('scheduleNextSpawn', () => {
    it('should schedule next spawn within MIN and MAX interval range', () => {
      service['scheduleNextSpawn']();
      const nextSpawn = service['nextSpawnTime'];
      const minExpected = mockTime + 25000;
      const maxExpected = mockTime + 45000;
      expect(nextSpawn).toBeGreaterThanOrEqual(minExpected);
      expect(nextSpawn).toBeLessThanOrEqual(maxExpected);
    });
  });

  describe('MEGA asteroid', () => {
    it('should set isMega=true on spawned MEGA component', () => {
      // Verify the isMega field round-trips through the component
      const megaComp = new FallingAsteroidComponent(
        AsteroidState.WARNING,
        0,
        0,
        0,
        0,
        0,
        1000,
        150,
        60,
        60,
        160,
        160,
        'speed',
        20000,
        1.5,
        true // isMega
      );
      expect(megaComp.isMega).toBe(true);
    });

    it('should set isMega=false on regular spawned component', () => {
      const normalComp = new FallingAsteroidComponent(
        AsteroidState.WARNING,
        0,
        0,
        0,
        0,
        0,
        1000,
        150,
        40,
        40,
        80,
        80,
        'speed',
        10000,
        1.5,
        false
      );
      expect(normalComp.isMega).toBe(false);
    });

    it('should trigger larger screen shake for MEGA on impact', () => {
      const mockCameraShake = jasmine.createSpyObj('CameraShakeService', ['addShake']);
      window.cameraShake = mockCameraShake;
      settingsSpy.getSettings.and.returnValue({
        screenShake: true,
        volume: 100,
        showDamageNumbers: true,
        chromaticAberration: false,
        lowHealthVignette: true,
        colorblindMode: 'none',
        sensitivity: 1,
      });

      createPlayerAt(9999, 9999);
      service['playerEntity'] = entityManager.getEntitiesWithComponents(PlayerControlledComponent)[0];

      const asteroidId = createAsteroidEntity(AsteroidState.FALLING, 0, 0);
      const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent)!;
      asteroid.isMega = true;
      asteroid.fallStartTime = mockTime - 2000; // force impact

      service.update(16, entityManager);

      const callArgs = mockCameraShake.addShake.calls.mostRecent().args[0] as { intensity: number };
      expect(callArgs.intensity).toBe(18); // MEGA gets stronger shake

      delete window.cameraShake;
    });
  });

  describe('shockwave radius contract', () => {
    it('FallingAsteroidComponent.impactRadius defaults to 150 — shockwave must reach that radius', () => {
      // This is a contract test: impactRadius=150 is what the damage system uses,
      // and the renderer (Bug B fix) now uses full impactRadius for shockwave rings.
      const comp = new FallingAsteroidComponent();
      expect(comp.impactRadius).toBe(150);
    });
  });
});
