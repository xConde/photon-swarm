import { TestBed } from '@angular/core/testing';
import { GameEngineService } from './game-engine.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { LoopSystemService } from './loop-system.service';
import { GameStateService } from '../state/game-state.service';
import { GameStats } from '../models/game-state.model';
import { UIStateService } from '../state/ui-state.service';
import { Component, ComponentType, System } from '../ecs/ecs.model';
import { Subject } from 'rxjs';
import { EntityFactoryECSService } from '../entities/entity-factory-ecs.service';
import { PlayerUpgradesService } from '../player/player-upgrades.service';
import { BuffSystemService } from '../progression/buff-system.service';
import { BurnSystemService } from '../systems/combat';
import { UpgradeService } from '../../services/upgrade.service';
import { UpgradeOption } from '../models/upgrade.model';
import { CurseService } from '../../services/curse.service';
import { SaveGameAdapter } from '../state/save-game.adapter';
import { SaveGameData } from '../models/save-game.model';
import { EnemyType } from '../models/enemy.model';
import { HealthComponent, VelocityComponent } from '@photon/components';
import { PlayerService } from '../player/player.service';

// Mock system for testing
class MockSystem implements System {
  public initialized = false;
  public initCount = 0;
  public updateCount = 0;
  public destroyed = false;
  public resetCount = 0;
  public initializeRunCount = 0;

  init(_entityManager: EntityManagerService): void {
    this.initialized = true;
    this.initCount++;
  }

  update(_deltaTime: number, _entityManager: EntityManagerService): void {
    this.updateCount++;
  }

  destroy(): void {
    this.destroyed = true;
  }

  reset(): void {
    this.resetCount++;
  }

  initializeRun(): void {
    this.initializeRunCount++;
  }
}

class AnotherMockSystem implements System {
  public updateCount = 0;

  update(_deltaTime: number, _entityManager: EntityManagerService): void {
    this.updateCount++;
  }
}

describe('GameEngineService - ECS System Runner', () => {
  let service: GameEngineService;
  let loopSystemSpy: jasmine.SpyObj<LoopSystemService>;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;
  let uiStateSpy: jasmine.SpyObj<UIStateService>;
  let entityManagerSpy: jasmine.SpyObj<EntityManagerService>;
  let entityFactorySpy: jasmine.SpyObj<EntityFactoryECSService>;
  let playerUpgrades: PlayerUpgradesService;
  let buffSystem: BuffSystemService;
  let burnSystem: BurnSystemService;
  let upgradeService: UpgradeService;
  let curseService: CurseService;

  beforeEach(() => {
    const loopSpy = jasmine.createSpyObj('LoopSystemService', ['start', 'stop', 'pause', 'resume', 'destroy']);
    const gameOverSubject = new Subject<GameStats>();
    const gameStateSpyObj = jasmine.createSpyObj('GameStateService', [
      'setPaused',
      'isPaused',
      'setStartTime',
      'setLastTime',
      'reset',
      'getHealth',
      'getMaxHealth',
      'getStartTime',
      'setHealth',
      'setPlayerName',
      'getPlayerName',
      'generatePilotName',
      'addShards',
      'getShards',
      'restoreSavedRunMetrics',
      'update',
      'clampCurrentHealth',
    ]);
    gameStateSpyObj.gameOver$ = gameOverSubject.asObservable();
    gameStateSpyObj.getHealth = jasmine.createSpy().and.returnValue(100);
    gameStateSpyObj.getMaxHealth = jasmine.createSpy().and.returnValue(100);
    gameStateSpyObj.getStartTime = jasmine.createSpy().and.returnValue(0);
    gameStateSpyObj.getShards = jasmine.createSpy().and.returnValue(0);
    gameStateSpyObj.getPlayerName = jasmine.createSpy().and.returnValue('Pilot-Test');
    const uiSpy = jasmine.createSpyObj('UIStateService', ['updateNotifications', 'updateDamageFlash', 'reset']);
    const entitySpy = jasmine.createSpyObj('EntityManagerService', [
      'clear',
      'getEntitiesWithComponents',
      'getEntityCount',
      'getComponent',
      'hasComponent',
    ]);
    entitySpy.getEntitiesWithComponents.and.returnValue([]);
    entitySpy.getEntityCount.and.returnValue(0);
    const entityFactorySpyObj = jasmine.createSpyObj('EntityFactoryECSService', [
      'resetSession',
      'createPlayer',
      'createEnemy',
    ]);

    TestBed.configureTestingModule({
      providers: [
        GameEngineService,
        { provide: LoopSystemService, useValue: loopSpy },
        { provide: GameStateService, useValue: gameStateSpyObj },
        { provide: UIStateService, useValue: uiSpy },
        { provide: EntityManagerService, useValue: entitySpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpyObj },
      ],
    });

    service = TestBed.inject(GameEngineService);
    loopSystemSpy = TestBed.inject(LoopSystemService) as jasmine.SpyObj<LoopSystemService>;
    gameStateSpy = TestBed.inject(GameStateService) as jasmine.SpyObj<GameStateService>;
    uiStateSpy = TestBed.inject(UIStateService) as jasmine.SpyObj<UIStateService>;
    entityManagerSpy = TestBed.inject(EntityManagerService) as jasmine.SpyObj<EntityManagerService>;
    entityFactorySpy = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;
    playerUpgrades = TestBed.inject(PlayerUpgradesService);
    buffSystem = TestBed.inject(BuffSystemService);
    burnSystem = TestBed.inject(BurnSystemService);
    upgradeService = TestBed.inject(UpgradeService);
    curseService = TestBed.inject(CurseService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('restores every gameplay domain when a multi-step card throws', () => {
    const playerSnapshot = playerUpgrades.captureUpgradeTransaction();
    const card: UpgradeOption = {
      id: 'transaction_failure',
      name: 'Transaction Failure',
      description: 'Mutates several systems before failing',
      type: 'upgrade',
      rarity: 'common',
      effect: (engine) => {
        engine.increaseMovementSpeed(0.5);
        engine.increaseBeamDamage(0.5);
        engine.player.increaseMaxHealth(50);
        engine.unlockDoubleBeam();
        engine.enableBurnSpread();
        engine.applyVulnerabilityCurse();
        curseService.addCurse({
          id: 'transaction-curse',
          name: 'Transaction Curse',
          description: 'Must be rolled back',
          severity: 'high',
          active: true,
        });
        throw new Error('injected failure');
      },
    };

    expect(upgradeService.apply(card, service)).toBeFalse();

    expect(playerUpgrades.captureUpgradeTransaction()).toEqual(playerSnapshot);
    expect(buffSystem.damageTakenMultiplier).toBe(1);
    expect(burnSystem.isBurnSpreadEnabled()).toBeFalse();
    expect(curseService.hasCurse('transaction-curse')).toBeFalse();
    expect(gameStateSpy.setHealth).toHaveBeenCalledWith(100, 'upgrade_transaction_rollback');
    expect(upgradeService.getCount(card.id)).toBe(0);
  });

  describe('System Management', () => {
    it('should register a system', () => {
      service.registerSystem(MockSystem);
      expect(service.getSystems().length).toBe(1);
      expect(service.getSystems()[0]).toBeInstanceOf(MockSystem);
    });

    it('should register multiple systems', () => {
      service.registerSystems(MockSystem, AnotherMockSystem);
      expect(service.getSystems().length).toBe(2);
    });

    it('should not register the same DI-owned system instance twice', () => {
      const system = new MockSystem();

      service.registerSystemInstance(system);
      service.registerSystemInstance(system);

      expect(service.getSystems()).toEqual([system]);
    });

    it('should initialize systems when canvas is set', () => {
      const canvas = document.createElement('canvas');
      service.registerSystem(MockSystem);
      service.initialize(canvas);

      const system = service.getSystem(MockSystem) as MockSystem;
      expect(system?.initialized).toBe(true);
    });

    it('should initialize systems added after canvas initialization', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);

      service.registerSystem(MockSystem);
      const system = service.getSystem(MockSystem) as MockSystem;
      expect(system?.initialized).toBe(true);
    });

    it('should remove a system', () => {
      service.registerSystems(MockSystem, AnotherMockSystem);
      service.removeSystem(MockSystem);

      expect(service.getSystems().length).toBe(1);
      expect(service.getSystem(MockSystem)).toBeUndefined();
      expect(service.getSystem(AnotherMockSystem)).toBeDefined();
    });

    it('should destroy system when removing', () => {
      service.registerSystem(MockSystem);
      const system = service.getSystem(MockSystem) as MockSystem;

      service.removeSystem(MockSystem);
      expect(system.destroyed).toBe(true);
    });

    it('should clear all systems', () => {
      service.registerSystems(MockSystem, AnotherMockSystem);
      service.clearSystems();

      expect(service.getSystems().length).toBe(0);
    });

    it('should handle removing non-existent system', () => {
      service.registerSystem(MockSystem);
      expect(() => service.removeSystem(AnotherMockSystem)).not.toThrow();
      expect(service.getSystems().length).toBe(1);
    });
  });

  describe('Game Loop', () => {
    let canvas: HTMLCanvasElement;

    beforeEach(() => {
      canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      service.initialize(canvas);
    });

    it('should start the game loop', () => {
      service.start();

      expect(service.isRunning()).toBe(true);
      expect(loopSystemSpy.start).toHaveBeenCalled();
      expect(gameStateSpy.setPaused).toHaveBeenCalledWith(false);
    });

    it('should not start if already running', () => {
      service.start();
      loopSystemSpy.start.calls.reset();

      service.start();
      expect(loopSystemSpy.start).not.toHaveBeenCalled();
    });

    it('should pause the game', () => {
      service.start();
      gameStateSpy.isPaused.and.returnValue(false);

      service.pause();

      expect(gameStateSpy.setPaused).toHaveBeenCalledWith(true);
      expect(loopSystemSpy.pause).toHaveBeenCalled();
    });

    it('should not pause if already paused', () => {
      service.start();
      service.pause();
      gameStateSpy.isPaused.and.returnValue(true);
      loopSystemSpy.pause.calls.reset();

      service.pause();
      expect(loopSystemSpy.pause).not.toHaveBeenCalled();
    });

    it('should resume the game', () => {
      service.start();
      service.pause();
      gameStateSpy.isPaused.and.returnValue(true);

      service.resume();

      expect(gameStateSpy.setPaused).toHaveBeenCalledWith(false);
      expect(loopSystemSpy.resume).toHaveBeenCalled();
    });

    it('should not resume if not paused', () => {
      service.start();
      gameStateSpy.isPaused.and.returnValue(false);

      service.resume();
      expect(loopSystemSpy.resume).not.toHaveBeenCalled();
    });

    it('should stop the game', () => {
      service.start();
      service.stop();

      expect(service.isRunning()).toBe(false);
      expect(loopSystemSpy.stop).toHaveBeenCalled();
    });

    it('should toggle pause state', () => {
      service.start();
      gameStateSpy.isPaused.and.returnValue(false);

      service.togglePause();
      expect(gameStateSpy.setPaused).toHaveBeenCalledWith(true);

      gameStateSpy.isPaused.and.returnValue(true);
      service.togglePause();
      expect(gameStateSpy.setPaused).toHaveBeenCalledWith(false);
    });
  });

  describe('Update Loop', () => {
    it('should update all systems in order', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);
      service.registerSystems(MockSystem, AnotherMockSystem);

      // Get the update callback
      service.start();
      const updateCallback = loopSystemSpy.start.calls.mostRecent().args[0];

      // Simulate update
      gameStateSpy.isPaused.and.returnValue(false);
      updateCallback(16, window.performance.now());

      const system1 = service.getSystem(MockSystem) as MockSystem;
      const system2 = service.getSystem(AnotherMockSystem) as AnotherMockSystem;

      expect(system1.updateCount).toBe(1);
      expect(system2.updateCount).toBe(1);
    });

    it('should not update systems when paused', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);
      service.registerSystem(MockSystem);

      service.start();
      const updateCallback = loopSystemSpy.start.calls.mostRecent().args[0];

      gameStateSpy.isPaused.and.returnValue(true);
      updateCallback(16, window.performance.now());

      const system = service.getSystem(MockSystem) as MockSystem;
      expect(system.updateCount).toBe(0);
    });

    it('should update UI state during update', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);

      service.start();
      const updateCallback = loopSystemSpy.start.calls.mostRecent().args[0];

      gameStateSpy.isPaused.and.returnValue(false);
      const currentTime = window.performance.now();
      updateCallback(16, currentTime);

      expect(uiStateSpy.updateNotifications).toHaveBeenCalledWith(currentTime);
      expect(uiStateSpy.updateDamageFlash).toHaveBeenCalled();
    });

    it('stops the frame immediately when a system ends the run', () => {
      const canvas = document.createElement('canvas');
      const laterSystem = new MockSystem();
      const terminalSystem: System = {
        update: () => service.stop(),
      };
      service.initialize(canvas);
      service.registerSystemInstance(terminalSystem);
      service.registerSystemInstance(laterSystem);
      service.startWithoutReset();
      const updateCallback = loopSystemSpy.start.calls.mostRecent().args[0];
      gameStateSpy.isPaused.and.returnValue(false);
      gameStateSpy.update.calls.reset();

      updateCallback(16, window.performance.now());

      expect(laterSystem.updateCount).toBe(0);
      expect(gameStateSpy.update).not.toHaveBeenCalled();
      expect(uiStateSpy.updateNotifications).not.toHaveBeenCalled();
    });
  });

  describe('Reset', () => {
    it('should reset all state and initialize each new run without repeating init', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);
      service.registerSystem(MockSystem);

      service.reset();

      expect(entityManagerSpy.clear).toHaveBeenCalled();
      expect(gameStateSpy.reset).toHaveBeenCalled();
      expect(uiStateSpy.reset).toHaveBeenCalled();

      // The reusable system is reset without duplicating init-time wiring.
      const system = service.getSystem(MockSystem) as MockSystem;
      expect(system.initialized).toBe(true);
      expect(system.resetCount).toBe(1);
      expect(system.initCount).toBe(1);
      expect(system.initializeRunCount).toBe(1);
    });

    it('resets every registered system that opts into run cleanup', () => {
      const canvas = document.createElement('canvas');
      const first = new MockSystem();
      const second = new MockSystem();
      service.initialize(canvas);
      service.registerSystemInstance(first);
      service.registerSystemInstance(second);

      service.reset();

      expect(first.resetCount).toBe(1);
      expect(second.resetCount).toBe(1);
      expect(first.initializeRunCount).toBe(1);
      expect(second.initializeRunCount).toBe(1);
    });

    it('should reset when starting the game', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);

      service.start();

      expect(entityManagerSpy.clear).toHaveBeenCalled();
      expect(gameStateSpy.reset).toHaveBeenCalled();
      expect(uiStateSpy.reset).toHaveBeenCalled();
    });
  });

  describe('Full-run save restoration', () => {
    it('replays upgrades and rebuilds complete entities through the factory', () => {
      const saveAdapter = TestBed.inject(SaveGameAdapter);
      const playerService = TestBed.inject(PlayerService);
      const savedData: SaveGameData = {
        version: 1,
        seed: 'restored-seed',
        timestamp: Date.now(),
        player: {
          name: 'Saved Pilot',
          x: 1234,
          y: 2345,
          health: 175,
          maxHealth: 200,
          shards: 42,
          xp: 90,
          level: 3,
          currentRunUpgrades: { reinforced_shields: 1 },
          currentRunCurses: [],
        },
        enemies: [
          {
            id: 'saved-enemy',
            type: EnemyType.Spitter,
            rarity: 'rare',
            isElite: true,
            isChampion: false,
            factionId: 2,
            x: 400,
            y: 500,
            health: 60,
            maxHealth: 80,
            vx: 3,
            vy: -4,
          },
        ],
        meta: {
          survivalTime: 12_000,
          survivalPhase: 'active',
          currentStage: 1,
          stageProgress: 0,
          unlockedStages: [1],
          kills: 17,
          maxKillStreak: 6,
          resinCurrency: 0,
          gameStartTime: 0,
        },
      };
      const playerHealth = new HealthComponent(100, 100);
      const enemyHealth = new HealthComponent(100, 100);
      const enemyVelocity = new VelocityComponent(0, 0);

      spyOn(saveAdapter, 'load').and.returnValue(savedData);
      spyOn(saveAdapter, 'loadPlayerName').and.returnValue(null);
      spyOn(upgradeService, 'reapplySavedUpgradeEffects').and.returnValue(true);
      spyOn(playerService, 'getMaxHealth').and.returnValue(200);
      entityFactorySpy.createPlayer.and.returnValue(1001);
      entityFactorySpy.createEnemy.and.returnValue(2001);
      entityManagerSpy.getComponent.and.callFake(
        <T extends Component>(entity: number, componentType: ComponentType<T>): T | undefined => {
          if (entity === 1001 && componentType.name === HealthComponent.name) return playerHealth as unknown as T;
          if (entity === 2001 && componentType.name === HealthComponent.name) return enemyHealth as unknown as T;
          if (entity === 2001 && componentType.name === VelocityComponent.name) return enemyVelocity as unknown as T;
          return undefined;
        }
      );

      expect(service.loadGameState()).toBeTrue();

      expect(upgradeService.loadUpgradesFromSave).toBeDefined();
      expect(upgradeService.reapplySavedUpgradeEffects).toHaveBeenCalledWith(service, { reinforced_shields: 1 });
      expect(playerService.x$.value).toBe(1234);
      expect(playerService.y$.value).toBe(2345);
      expect(entityFactorySpy.createPlayer).toHaveBeenCalledWith(1234, 2345);
      expect(entityFactorySpy.createEnemy).toHaveBeenCalledWith(400, 500, EnemyType.Spitter, 'rare', true, 2, false);
      expect(playerHealth).toEqual(jasmine.objectContaining({ health: 175, maxHealth: 200 }));
      expect(enemyHealth).toEqual(jasmine.objectContaining({ health: 60, maxHealth: 80 }));
      expect(enemyVelocity).toEqual(jasmine.objectContaining({ vx: 3, vy: -4 }));
      expect(gameStateSpy.restoreSavedRunMetrics).toHaveBeenCalledWith(17, 6, 12_000);
    });

    it('does not overwrite restored elapsed time when starting the loaded loop', () => {
      gameStateSpy.getStartTime.and.returnValue(5000);

      service.startWithoutReset();

      expect(gameStateSpy.setStartTime).not.toHaveBeenCalled();
      expect(gameStateSpy.setLastTime).toHaveBeenCalled();
    });
  });

  describe('Session deactivation', () => {
    it('should reset and unregister systems without destroying them', () => {
      const canvas = document.createElement('canvas');
      const system = new MockSystem();
      service.initialize(canvas);
      service.registerSystemInstance(system);
      service.startWithoutReset();

      service.deactivateSession();

      expect(system.resetCount).toBe(1);
      expect(system.destroyed).toBeFalse();
      expect(service.getSystems()).toEqual([]);
      expect(service.isRunning()).toBeFalse();
      expect(entityFactorySpy.resetSession).toHaveBeenCalledTimes(1);
      expect(entityManagerSpy.clear).toHaveBeenCalled();
      expect(entityFactorySpy.resetSession).toHaveBeenCalledBefore(entityManagerSpy.clear);
      expect(loopSystemSpy.destroy).toHaveBeenCalled();
      expect(service.getCanvas()).toBeNull();
      expect(service.getContext()).toBeNull();
    });

    it('should support initialize, register, and start after route re-entry', () => {
      const canvas = document.createElement('canvas');
      const firstSessionSystem = new MockSystem();
      service.initialize(canvas);
      service.registerSystemInstance(firstSessionSystem);
      service.startWithoutReset();
      service.deactivateSession();

      const secondSessionSystem = new MockSystem();
      service.initialize(canvas);
      service.registerSystemInstance(secondSessionSystem);
      loopSystemSpy.start.calls.reset();
      service.startWithoutReset();

      expect(secondSessionSystem.initialized).toBeTrue();
      expect(service.getSystems()).toContain(secondSessionSystem);
      expect(service.getSystems()).not.toContain(firstSessionSystem);
      expect(service.getSystems().filter((system) => system === secondSessionSystem).length).toBe(1);
      expect(service.isRunning()).toBeTrue();
      expect(loopSystemSpy.start).toHaveBeenCalledTimes(1);
    });
  });

  describe('Canvas and Context', () => {
    it('should initialize canvas with proper context settings', () => {
      const canvas = document.createElement('canvas');
      const mockContext = jasmine.createSpyObj('CanvasRenderingContext2D', ['clearRect']);
      spyOn(canvas, 'getContext').and.returnValue(mockContext);

      service.initialize(canvas);

      expect(canvas.getContext).toHaveBeenCalledWith('2d', {
        alpha: false,
        desynchronized: true,
      });
      expect(service.getCanvas()).toBe(canvas);
      expect(service.getContext()).toBe(mockContext);
    });

    it('should return null for canvas/context before initialization', () => {
      expect(service.getCanvas()).toBeNull();
      expect(service.getContext()).toBeNull();
    });
  });

  describe('World Properties', () => {
    it('should return correct world dimensions', () => {
      expect(service.getWorldWidth()).toBe(12000);
      expect(service.getWorldHeight()).toBe(9000);
    });
  });

  describe('Entity Manager', () => {
    it('should return the entity manager instance', () => {
      expect(service.getEntityManager()).toBe(entityManagerSpy);
    });
  });

  describe('Observable Streams', () => {
    it('should expose running state as observable', (done) => {
      service.running.subscribe((isRunning) => {
        expect(typeof isRunning).toBe('boolean');
        done();
      });
    });

    it('should emit running state changes', (done) => {
      let emissions = 0;
      service.running.subscribe((isRunning) => {
        emissions++;
        if (emissions === 2) {
          expect(isRunning).toBe(true);
          done();
        }
      });

      service.start();
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple rapid state changes', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);

      for (let i = 0; i < 10; i++) {
        service.start();
        service.pause();
        service.resume();
        service.stop();
      }

      expect(service.isRunning()).toBe(false);
    });

    it('should handle system registration before initialization', () => {
      service.registerSystem(MockSystem);

      const canvas = document.createElement('canvas');
      service.initialize(canvas);

      const system = service.getSystem(MockSystem) as MockSystem;
      expect(system.initialized).toBe(true);
    });

    it('should handle clearing systems during runtime', () => {
      const canvas = document.createElement('canvas');
      service.initialize(canvas);
      service.registerSystems(MockSystem, AnotherMockSystem);
      service.start();

      service.clearSystems();
      expect(service.getSystems().length).toBe(0);

      // Should still run without errors
      const updateCallback = loopSystemSpy.start.calls.mostRecent().args[0];
      gameStateSpy.isPaused.and.returnValue(false);
      expect(() => updateCallback(16, window.performance.now())).not.toThrow();
    });
  });

  describe('clampCurrentHealth', () => {
    it('delegates to GameStateService.clampCurrentHealth instead of silently no-op-ing', () => {
      service.clampCurrentHealth();
      expect(gameStateSpy.clampCurrentHealth).toHaveBeenCalled();
    });
  });

  describe('generatePilotName', () => {
    it('delegates to GameStateService.generatePilotName and returns its result', () => {
      (gameStateSpy.generatePilotName as jasmine.Spy).and.returnValue('Pilot-482910');

      expect(service.generatePilotName()).toBe('Pilot-482910');
      expect(gameStateSpy.generatePilotName).toHaveBeenCalled();
    });
  });
});
