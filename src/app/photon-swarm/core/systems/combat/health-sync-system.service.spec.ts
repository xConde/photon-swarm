import { TestBed } from '@angular/core/testing';
import { HealthSyncSystemService } from './health-sync-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameStateService } from '../../state/game-state.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { HealthComponent, PlayerControlledComponent } from '@photon/components';
import { ErrorHandlerService } from '../../utils/error-handler.service';

describe('HealthSyncSystemService', () => {
  let service: HealthSyncSystemService;
  let entityManager: EntityManagerService;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    gameStateSpy = jasmine.createSpyObj('GameStateService', ['getHealth', 'getMaxHealth']);
    debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    gameStateSpy.getHealth.and.returnValue(100);
    gameStateSpy.getMaxHealth.and.returnValue(100);

    TestBed.configureTestingModule({
      providers: [
        HealthSyncSystemService,
        EntityManagerService,
        ErrorHandlerService,
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });

    service = TestBed.inject(HealthSyncSystemService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should start with zero sync error count', () => {
      expect(service['syncErrorCount']).toBe(0);
    });
  });

  describe('update — no player entity', () => {
    it('should do nothing when no player entity exists', () => {
      service.update(16, entityManager);
      expect(gameStateSpy.getHealth).not.toHaveBeenCalled();
    });
  });

  describe('update — player entity without HealthComponent', () => {
    it('should do nothing when player has no health component', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PlayerControlledComponent());

      service.update(16, entityManager);

      expect(gameStateSpy.getHealth).not.toHaveBeenCalled();
    });
  });

  describe('update — health sync logic', () => {
    let playerId: number;
    let healthComp: HealthComponent;

    beforeEach(() => {
      playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      healthComp = new HealthComponent(80, 100);
      entityManager.addComponent(playerId, healthComp);
    });

    it('should sync ECS health when it differs from GameState', () => {
      gameStateSpy.getHealth.and.returnValue(100);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      expect(healthComp.health).toBe(100);
    });

    it('should sync ECS maxHealth when it differs from GameState', () => {
      gameStateSpy.getHealth.and.returnValue(80);
      gameStateSpy.getMaxHealth.and.returnValue(150);

      service.update(16, entityManager);

      expect(healthComp.maxHealth).toBe(150);
    });

    it('should not sync when health values are already equal', () => {
      gameStateSpy.getHealth.and.returnValue(80);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      // No change — values already match
      expect(healthComp.health).toBe(80);
      expect(healthComp.maxHealth).toBe(100);
    });

    it('should not sync when difference is below 0.01 threshold', () => {
      healthComp.health = 80.005;
      gameStateSpy.getHealth.and.returnValue(80);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      // Difference is 0.005, below threshold — no sync should occur
      expect(healthComp.health).toBe(80.005);
    });
  });

  describe('update — dead player skip logic', () => {
    it('should not modify health component when both GameState and ECS health are 0 (dead)', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PlayerControlledComponent());
      const healthComp = new HealthComponent(0, 100);
      entityManager.addComponent(entity, healthComp);

      gameStateSpy.getHealth.and.returnValue(0);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      // health stays 0 — no spurious update applied
      expect(healthComp.health).toBe(0);
      // No log emitted (sync was skipped)
      expect(debugLogSpy.log).not.toHaveBeenCalled();
    });

    it('should sync when GameState health is 0 but ECS health is still positive (dying)', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PlayerControlledComponent());
      const healthComp = new HealthComponent(50, 100);
      entityManager.addComponent(entity, healthComp);

      gameStateSpy.getHealth.and.returnValue(0);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      expect(healthComp.health).toBe(0);
    });
  });

  describe('update — log throttling', () => {
    it('should log sync only when health diff is greater than 1', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PlayerControlledComponent());
      const healthComp = new HealthComponent(80, 100);
      entityManager.addComponent(entity, healthComp);

      gameStateSpy.getHealth.and.returnValue(100);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      // Diff is 20, which is >1, so log should be called
      expect(debugLogSpy.log).toHaveBeenCalled();
    });

    it('should not log when diff is between 0.01 and 1 (not meaningful)', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PlayerControlledComponent());
      const healthComp = new HealthComponent(99.5, 100);
      entityManager.addComponent(entity, healthComp);

      gameStateSpy.getHealth.and.returnValue(100);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      // Sync happens (diff 0.5 > 0.01) but log is suppressed (diff 0.5 <= 1)
      expect(debugLogSpy.log).not.toHaveBeenCalled();
      expect(healthComp.health).toBe(100);
    });

    it('should stop logging after MAX_SYNC_ERRORS syncs', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PlayerControlledComponent());

      service['syncErrorCount'] = service['MAX_SYNC_ERRORS'];

      const healthComp = new HealthComponent(50, 100);
      entityManager.addComponent(entity, healthComp);

      gameStateSpy.getHealth.and.returnValue(100);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      service.update(16, entityManager);

      // Should still sync the value, just not log
      expect(healthComp.health).toBe(100);
      expect(debugLogSpy.log).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should reset syncErrorCount to 0', () => {
      service['syncErrorCount'] = 7;
      service.reset();
      expect(service['syncErrorCount']).toBe(0);
    });

    it('should log a reset message', () => {
      service.reset();
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('reset'),
        'info',
        jasmine.objectContaining({ source: 'health_sync_system' })
      );
    });
  });
});
