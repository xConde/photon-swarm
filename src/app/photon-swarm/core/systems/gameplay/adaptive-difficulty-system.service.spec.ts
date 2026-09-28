import { TestBed } from '@angular/core/testing';
import { AdaptiveDifficultySystemService } from './adaptive-difficulty-system.service';
import { GameStateService } from '../../state/game-state.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

describe('AdaptiveDifficultySystemService', () => {
  let service: AdaptiveDifficultySystemService;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 0;
    gameStateSpy = jasmine.createSpyObj('GameStateService', ['getHealth', 'getMaxHealth']);
    debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    gameStateSpy.getHealth.and.returnValue(100);
    gameStateSpy.getMaxHealth.and.returnValue(100);

    TestBed.configureTestingModule({
      providers: [
        AdaptiveDifficultySystemService,
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });

    service = TestBed.inject(AdaptiveDifficultySystemService);

    spyOn(Date, 'now').and.callFake(() => mockTime);
  });

  afterEach(() => {
    service.destroy();
  });

  function advanceTime(ms: number): void {
    mockTime += ms;
  }

  function triggerUpdate(): void {
    // advance past the 1000ms throttle
    advanceTime(1100);
    service.update(16);
  }

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should start with difficulty multiplier of 1.0', () => {
      expect(service['currentDifficultyMultiplier']).toBe(1.0);
    });

    it('should start with no death spiral detected', () => {
      expect(service['deathSpiralDetected']).toBe(false);
    });

    it('should start with no easy mode detected', () => {
      expect(service['easyModeDetected']).toBe(false);
    });
  });

  describe('update — throttling', () => {
    it('should not update if called within UPDATE_INTERVAL', () => {
      const initialScore = service['performanceHistory'].length;
      advanceTime(500); // below 1000ms threshold
      service.update(16);
      expect(service['performanceHistory'].length).toBe(initialScore);
    });

    it('should update after UPDATE_INTERVAL has passed', () => {
      triggerUpdate();
      expect(service['performanceHistory'].length).toBe(1);
    });
  });

  describe('getSpawnRateMultiplier', () => {
    it('should return current multiplier in normal conditions', () => {
      expect(service.getSpawnRateMultiplier()).toBe(1.0);
    });

    it('should reduce spawn rate by 30% during death spiral', () => {
      service['deathSpiralDetected'] = true;
      service['currentDifficultyMultiplier'] = 1.0;
      expect(service.getSpawnRateMultiplier()).toBeCloseTo(0.7);
    });

    it('should increase spawn rate by 20% during easy mode', () => {
      service['easyModeDetected'] = true;
      service['currentDifficultyMultiplier'] = 1.0;
      expect(service.getSpawnRateMultiplier()).toBeCloseTo(1.2);
    });
  });

  describe('getEnemyHealthMultiplier', () => {
    it('should return current difficulty multiplier directly', () => {
      service['currentDifficultyMultiplier'] = 1.5;
      expect(service.getEnemyHealthMultiplier()).toBe(1.5);
    });
  });

  describe('getEnemyDamageMultiplier', () => {
    it('should scale at 50% the rate of the difficulty multiplier', () => {
      service['currentDifficultyMultiplier'] = 2.0;
      // 1.0 + (2.0 - 1.0) * 0.5 = 1.5
      expect(service.getEnemyDamageMultiplier()).toBeCloseTo(1.5);
    });

    it('should be 1.0 at base difficulty', () => {
      service['currentDifficultyMultiplier'] = 1.0;
      expect(service.getEnemyDamageMultiplier()).toBeCloseTo(1.0);
    });

    it('should be below 1.0 when difficulty is reduced below 1.0', () => {
      service['currentDifficultyMultiplier'] = 0.5;
      // 1.0 + (0.5 - 1.0) * 0.5 = 0.75
      expect(service.getEnemyDamageMultiplier()).toBeCloseTo(0.75);
    });
  });

  describe('recordPlayerDeath', () => {
    it('should increment recentDeaths', () => {
      expect(service['recentDeaths']).toBe(0);
      service.recordPlayerDeath();
      expect(service['recentDeaths']).toBe(1);
    });

    it('should track decay timer for cleanup', () => {
      service.recordPlayerDeath();
      expect(service['decayTimers'].length).toBe(1);
    });
  });

  describe('recordEnemyKill', () => {
    it('should increment recentKills', () => {
      expect(service['recentKills']).toBe(0);
      service.recordEnemyKill();
      expect(service['recentKills']).toBe(1);
    });

    it('should track decay timer for cleanup', () => {
      service.recordEnemyKill();
      expect(service['decayTimers'].length).toBe(1);
    });
  });

  describe('updateDamageRates', () => {
    it('should apply exponential moving average for damage dealt', () => {
      service['damageDealtRate'] = 0;
      service.updateDamageRates(100, 0);
      // alpha = 0.1: 0 * 0.9 + 100 * 0.1 = 10
      expect(service['damageDealtRate']).toBeCloseTo(10);
    });

    it('should apply exponential moving average for damage taken', () => {
      service['damageTakenRate'] = 0;
      service.updateDamageRates(0, 50);
      // 0 * 0.9 + 50 * 0.1 = 5
      expect(service['damageTakenRate']).toBeCloseTo(5);
    });

    it('should accumulate over multiple calls', () => {
      service.updateDamageRates(100, 0);
      service.updateDamageRates(100, 0);
      // After 2 calls: 10 * 0.9 + 10 = 19
      expect(service['damageDealtRate']).toBeGreaterThan(10);
    });
  });

  describe('death spiral detection', () => {
    it('should detect death spiral after 3 consecutive deaths within 30s', () => {
      gameStateSpy.getHealth.and.returnValue(0);
      service['consecutiveDeaths'] = 3;
      service['lastDeathTime'] = mockTime;

      triggerUpdate();

      expect(service['deathSpiralDetected']).toBe(true);
    });

    it('should log a warning when death spiral is first detected', () => {
      gameStateSpy.getHealth.and.returnValue(0);
      service['consecutiveDeaths'] = 2; // about to hit threshold
      service['lastDeathTime'] = mockTime;

      triggerUpdate(); // 3rd death pushes over threshold

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('Death Spiral'),
        'warning',
        jasmine.any(Object)
      );
    });

    it('should apply emergency difficulty reduction during death spiral', () => {
      service['deathSpiralDetected'] = true;
      service['targetDifficultyMultiplier'] = 1.0;

      // adjustTargetDifficulty with any score — spiral forces change <= -0.2
      service['adjustTargetDifficulty'](50);

      expect(service['targetDifficultyMultiplier']).toBeLessThanOrEqual(0.8);
    });
  });

  describe('easy mode detection', () => {
    it('should detect easy mode after 10 consecutive updates at full health', () => {
      gameStateSpy.getHealth.and.returnValue(100);
      gameStateSpy.getMaxHealth.and.returnValue(100);
      service['consecutiveFullHealth'] = 10;

      triggerUpdate();

      expect(service['easyModeDetected']).toBe(true);
    });

    it('should reset consecutiveFullHealth when player takes damage', () => {
      service['consecutiveFullHealth'] = 5;
      gameStateSpy.getHealth.and.returnValue(50);
      gameStateSpy.getMaxHealth.and.returnValue(100);

      triggerUpdate();

      expect(service['consecutiveFullHealth']).toBe(0);
    });
  });

  describe('difficulty clamping', () => {
    it('should not exceed MAX_DIFFICULTY', () => {
      service['targetDifficultyMultiplier'] = 1.9;
      service['adjustTargetDifficulty'](100); // excellent score, +0.1
      expect(service['targetDifficultyMultiplier']).toBeLessThanOrEqual(service['MAX_DIFFICULTY']);
    });

    it('should not go below MIN_DIFFICULTY', () => {
      service['targetDifficultyMultiplier'] = 0.6;
      service['adjustTargetDifficulty'](5); // critical score, -0.15
      expect(service['targetDifficultyMultiplier']).toBeGreaterThanOrEqual(service['MIN_DIFFICULTY']);
    });
  });

  describe('smooth difficulty transition', () => {
    it('should move current difficulty toward target by DIFFICULTY_CHANGE_RATE per update', () => {
      service['currentDifficultyMultiplier'] = 1.0;
      service['targetDifficultyMultiplier'] = 1.5;

      service['smoothDifficultyTransition']();

      // Should increase by DIFFICULTY_CHANGE_RATE (0.01)
      expect(service['currentDifficultyMultiplier']).toBeCloseTo(1.01);
    });

    it('should not overshoot target', () => {
      service['currentDifficultyMultiplier'] = 1.499;
      service['targetDifficultyMultiplier'] = 1.5;

      service['smoothDifficultyTransition']();

      expect(service['currentDifficultyMultiplier']).toBeLessThanOrEqual(1.5);
    });
  });

  describe('reset', () => {
    it('should reset all tracking state to defaults', () => {
      service['recentDeaths'] = 5;
      service['recentKills'] = 10;
      service['currentDifficultyMultiplier'] = 1.8;
      service['deathSpiralDetected'] = true;
      service['easyModeDetected'] = true;
      service['performanceHistory'] = [50, 60, 70];

      service.reset();

      expect(service['recentDeaths']).toBe(0);
      expect(service['recentKills']).toBe(0);
      expect(service['currentDifficultyMultiplier']).toBe(1.0);
      expect(service['deathSpiralDetected']).toBe(false);
      expect(service['easyModeDetected']).toBe(false);
      expect(service['performanceHistory'].length).toBe(0);
    });

    it('should clear all pending decay timers on reset', () => {
      service.recordPlayerDeath();
      service.recordEnemyKill();
      expect(service['decayTimers'].length).toBe(2);

      service.reset();

      expect(service['decayTimers'].length).toBe(0);
    });

    it('should log reset event', () => {
      service.reset();
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('Reset'),
        'info',
        jasmine.objectContaining({ source: 'adaptive_difficulty' })
      );
    });
  });

  describe('getDebugState', () => {
    it('should return state object with expected keys', () => {
      const state = service.getDebugState();
      expect(state).toEqual(
        jasmine.objectContaining({
          currentDifficulty: jasmine.any(String),
          targetDifficulty: jasmine.any(String),
          deathSpiral: jasmine.any(Boolean),
          easyMode: jasmine.any(Boolean),
          recentKills: jasmine.any(Number),
          recentDeaths: jasmine.any(Number),
        })
      );
    });
  });

  describe('destroy / ngOnDestroy', () => {
    it('should clear timers on destroy', () => {
      service.recordPlayerDeath();
      expect(service['decayTimers'].length).toBe(1);
      service.destroy();
      expect(service['decayTimers'].length).toBe(0);
    });

    it('should clear performanceHistory on destroy', () => {
      service['performanceHistory'] = [1, 2, 3];
      service.destroy();
      expect(service['performanceHistory'].length).toBe(0);
    });
  });
});
