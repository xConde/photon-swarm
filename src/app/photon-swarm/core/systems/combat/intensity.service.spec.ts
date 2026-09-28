import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { IntensityMilestone, IntensityService, IntensityTier } from './intensity.service';
import { ComboState, ComboSystemService } from './combo-system.service';
import { PlayerUIData, UIQuerySystemService } from '../gameplay';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { AchievementService } from '../../../services/achievement.service';

describe('IntensityService', () => {
  let service: IntensityService;

  // Combo state subject so tests can push updates
  let comboState$: BehaviorSubject<ComboState>;

  let comboSpy: jasmine.SpyObj<ComboSystemService>;
  let uiQuerySpy: jasmine.SpyObj<UIQuerySystemService>;
  let debugSpy: jasmine.SpyObj<DebugLogBridgeService>;
  let achievementSpy: jasmine.SpyObj<AchievementService>;

  beforeEach(() => {
    comboState$ = new BehaviorSubject<ComboState>({
      count: 0,
      multiplier: 1,
      timeRemaining: 0,
      isActive: false,
      totalScore: 0,
    });

    comboSpy = jasmine.createSpyObj('ComboSystemService', ['getComboState', 'getCurrentMultiplier', 'getCurrentCombo']);
    comboSpy.getComboState.and.returnValue(comboState$.asObservable());
    comboSpy.getCurrentMultiplier.and.returnValue(1.0);
    comboSpy.getCurrentCombo.and.returnValue(0);

    uiQuerySpy = jasmine.createSpyObj('UIQuerySystemService', ['getPlayerStats']);
    uiQuerySpy.getPlayerStats.and.returnValue({ health: 100, maxHealth: 100 } as unknown as PlayerUIData);

    debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    achievementSpy = jasmine.createSpyObj('AchievementService', ['recordKillStreak']);

    TestBed.configureTestingModule({
      providers: [
        IntensityService,
        { provide: ComboSystemService, useValue: comboSpy },
        { provide: UIQuerySystemService, useValue: uiQuerySpy },
        { provide: DebugLogBridgeService, useValue: debugSpy },
        { provide: AchievementService, useValue: achievementSpy },
      ],
    });

    service = TestBed.inject(IntensityService);
  });

  afterEach(() => {
    service.stop();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ===== registerKill =====

  describe('registerKill', () => {
    it('should not register kills when not running', () => {
      // isRunning is false by default
      service.registerKill();
      expect(service.getCurrentState().intensity).toBe(0);
    });

    it('should increase intensity by KILL_GAIN at base combo multiplier', () => {
      // base: KILL_GAIN=0.04, COMBO_MULTIPLIER=0.5
      // effectiveMultiplier = 1 + (1 - 1) * 0.5 = 1.0
      // gain = 0.04 * 1.0 = 0.04
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      service.registerKill();

      expect(service.getCurrentState().intensity).toBeCloseTo(0.04, 5);
    });

    it('should scale gain by combo multiplier', () => {
      // comboMultiplier=3, COMBO_MULTIPLIER=0.5
      // effectiveMultiplier = 1 + (3-1)*0.5 = 2.0
      // gain = 0.04 * 2.0 = 0.08
      comboSpy.getCurrentMultiplier.and.returnValue(3.0);
      comboSpy.getCurrentCombo.and.returnValue(3);

      service.start();
      service.registerKill();

      expect(service.getCurrentState().intensity).toBeCloseTo(0.08, 5);
    });

    it('should add MULTI_KILL_BONUS when combo count > 5', () => {
      // base gain = 0.04, MULTI_KILL_BONUS = 0.02 → total = 0.06
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(6);

      service.start();
      service.registerKill();

      expect(service.getCurrentState().intensity).toBeCloseTo(0.06, 5);
    });

    it('should not exceed 1.0 intensity', () => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      // Register many kills to overflow
      for (let i = 0; i < 50; i++) {
        service.registerKill();
      }

      expect(service.getCurrentState().intensity).toBe(1.0);
    });

    it('should increment killStreak and maxKillStreak', () => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      service.registerKill();
      service.registerKill();

      const state = service.getCurrentState();
      expect(state.killStreak).toBe(2);
      expect(state.maxKillStreak).toBe(2);
    });

    it('should apply recovery bonus when in recovery window', () => {
      // Take damage first to start recovery window, then kill
      // gain during recovery = 0.04 * (1 + 0.5) = 0.06
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      // Put intensity at 0.5 so damage penalty doesn't floor it to 0
      for (let i = 0; i < 13; i++) {
        service.registerKill();
      }
      const intensityBeforeDamage = service.getCurrentState().intensity;

      service.applyDamagePenalty(10);
      const intensityAfterDamage = service.getCurrentState().intensity;

      // Now kill during recovery window
      service.registerKill();
      const intensityAfterKill = service.getCurrentState().intensity;
      const actualGain = intensityAfterKill - intensityAfterDamage;

      // RECOVERY_KILL_BONUS = 0.5, so gain = 0.04 * 1.5 = 0.06
      expect(actualGain).toBeCloseTo(0.06, 4);
      expect(intensityBeforeDamage).toBeGreaterThan(0); // sanity
    });
  });

  // ===== applyDamagePenalty =====

  describe('applyDamagePenalty', () => {
    it('should not apply penalty when not running', () => {
      // Force some intensity first via test-only reset path
      service.start();
      service.registerKill();
      const before = service.getCurrentState().intensity;
      service.stop();

      service.applyDamagePenalty(50);
      expect(service.getCurrentState().intensity).toBe(before);
    });

    it('should reduce intensity by scaled penalty', () => {
      // damageAmount=10, penalty = min(0.30, 0.05 + 0.004*10) = min(0.30, 0.09) = 0.09
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      // Build up intensity to 0.5 first
      for (let i = 0; i < 13; i++) {
        service.registerKill();
      }
      const before = service.getCurrentState().intensity;
      service.applyDamagePenalty(10);
      const after = service.getCurrentState().intensity;

      expect(before - after).toBeCloseTo(0.09, 5);
    });

    it('should clamp penalty to DAMAGE_PENALTY_MIN for tiny hits', () => {
      // damageAmount=0, penalty = min(0.30, 0.05 + 0) = 0.05
      service.start();
      for (let i = 0; i < 13; i++) {
        service.registerKill();
      }
      const before = service.getCurrentState().intensity;
      service.applyDamagePenalty(0);
      const after = service.getCurrentState().intensity;

      expect(before - after).toBeCloseTo(0.05, 5);
    });

    it('should clamp penalty to DAMAGE_PENALTY_MAX for massive hits', () => {
      // damageAmount=999, penalty = min(0.30, 0.05 + 0.004*999) → capped at 0.30
      service.start();
      for (let i = 0; i < 20; i++) {
        service.registerKill();
      }
      const before = service.getCurrentState().intensity;
      service.applyDamagePenalty(999);
      const after = service.getCurrentState().intensity;

      expect(before - after).toBeCloseTo(0.3, 5);
    });

    it('should reset killStreak to 0', () => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      service.registerKill();
      service.registerKill();
      expect(service.getCurrentState().killStreak).toBe(2);

      service.applyDamagePenalty(10);
      expect(service.getCurrentState().killStreak).toBe(0);
    });

    it('should start recovery window after damage', () => {
      service.start();
      for (let i = 0; i < 5; i++) {
        service.registerKill();
      }
      service.applyDamagePenalty(10);

      // isRecovering should be true immediately after damage
      expect(service.getCurrentState().isRecovering).toBe(true);
    });

    it('should not go below 0', () => {
      service.start();
      // No kills — intensity is already 0
      service.applyDamagePenalty(999);

      expect(service.getCurrentState().intensity).toBe(0);
    });
  });

  // ===== decay =====

  describe('decay', () => {
    it('should not decay when not running', fakeAsync(() => {
      // Don't call start() — isRunning stays false
      // Manually set intensity by using internal approach: start, kill, stop, then check decay
      // Instead, just ensure no-decay when stopped
      tick(500); // No intervals set up
      expect(service.getCurrentState().intensity).toBe(0);
    }));

    it('should not decay when intensity is 0', fakeAsync(() => {
      service.start();
      // intensity is already 0
      tick(1000);
      expect(service.getCurrentState().intensity).toBe(0);
      service.stop();
    }));

    it('should decay over time when running with intensity > 0', fakeAsync(() => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);
      service.start();

      // Build intensity to ~0.5 (13 kills × 0.04 = 0.52)
      for (let i = 0; i < 13; i++) {
        service.registerKill();
      }
      const before = service.getCurrentState().intensity;
      expect(before).toBeGreaterThan(0);

      // Tick 1 second (10 decay intervals of 100ms each)
      tick(1000);

      const after = service.getCurrentState().intensity;
      expect(after).toBeLessThan(before);

      service.stop();
    }));

    it('should decay faster at higher intensity (exponential)', fakeAsync(() => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      // Measure decay at low intensity
      service.start();
      for (let i = 0; i < 3; i++) {
        service.registerKill();
      }
      const lowIntensity = service.getCurrentState().intensity; // ~0.12
      tick(100); // one decay tick
      const lowAfterTick = service.getCurrentState().intensity;
      const lowDecayPerTick = lowIntensity - lowAfterTick;

      service.stop();
      service.reset();
      service.start();

      // Build to high intensity
      for (let i = 0; i < 24; i++) {
        service.registerKill();
      }
      const highIntensity = service.getCurrentState().intensity; // ~0.96
      tick(100);
      const highAfterTick = service.getCurrentState().intensity;
      const highDecayPerTick = highIntensity - highAfterTick;

      // High intensity should decay faster
      expect(highDecayPerTick).toBeGreaterThan(lowDecayPerTick);

      service.stop();
    }));

    it('should barely decay at low intensity', fakeAsync(() => {
      // NATURAL_DECAY_BASE=0.008, NATURAL_DECAY_SCALE=0.025
      // At intensity=0.1: decayRate = 0.008 + 0.025*0.1 = 0.0105
      // decayPerTick = 0.0105 * 100/1000 = 0.00105 per 100ms tick
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      service.registerKill(); // ~0.04 intensity
      service.registerKill(); // ~0.08
      service.registerKill(); // ~0.12

      tick(100); // one tick
      const state = service.getCurrentState();
      // Decay at ~0.12: 0.008 + 0.025*0.12 = 0.011 → 0.0011 per tick
      // intensity should drop by approximately 0.001, staying above 0.11
      expect(state.intensity).toBeGreaterThan(0.1);

      service.stop();
    }));
  });

  // ===== milestones =====

  describe('milestones', () => {
    it('should emit milestone on rising tier crossing', fakeAsync(() => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      const milestones: IntensityMilestone[] = [];
      service.getMilestones().subscribe((m) => milestones.push(m));

      service.start();
      // Push past TIER_RISING=0.3 threshold
      for (let i = 0; i < 10; i++) {
        service.registerKill(); // 10 × 0.04 = 0.40
      }

      expect(milestones.length).toBeGreaterThanOrEqual(1);
      expect(milestones[0].tier).toBe('rising');

      service.stop();
    }));

    it('should not emit milestone on falling tier crossing', fakeAsync(() => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      // Reach 'rising' tier
      for (let i = 0; i < 10; i++) {
        service.registerKill();
      }

      const milestonesAfterRise: IntensityMilestone[] = [];
      service.getMilestones().subscribe((m) => milestonesAfterRise.push(m));

      // Apply repeated damage to drop back below TIER_RISING=0.3
      for (let i = 0; i < 10; i++) {
        service.applyDamagePenalty(20); // 0.05+0.004*20=0.13 each
      }

      // The subscription only captures events after it was created — falling edge should not fire
      expect(milestonesAfterRise.length).toBe(0);

      service.stop();
    }));

    it('should emit correct tier labels at each threshold', () => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      const milestones: IntensityMilestone[] = [];
      service.getMilestones().subscribe((m) => milestones.push(m));

      service.start();
      // Cross rising (0.3): 8 kills = 0.32
      for (let i = 0; i < 8; i++) service.registerKill();
      // Cross surging (0.6): 8 more = 0.64
      for (let i = 0; i < 8; i++) service.registerKill();
      // Cross critical (0.85): 8 more = 0.96
      for (let i = 0; i < 8; i++) service.registerKill();

      const tiers = milestones.map((m) => m.tier);
      expect(tiers).toContain('rising' as IntensityTier);
      expect(tiers).toContain('surging' as IntensityTier);
      expect(tiers).toContain('critical' as IntensityTier);

      service.stop();
    });
  });

  // ===== getXpMultiplier =====

  describe('getXpMultiplier', () => {
    it('should return 1.0 at intensity 0', () => {
      // intensity starts at 0
      expect(service.getXpMultiplier()).toBeCloseTo(1.0, 5);
    });

    it('should return 1.5 at intensity 1.0', () => {
      // XP_MULTIPLIER_MAX = 0.5 → 1.0 + 1.0*0.5 = 1.5
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);
      service.start();
      for (let i = 0; i < 50; i++) service.registerKill(); // clamp to 1.0
      expect(service.getXpMultiplier()).toBeCloseTo(1.5, 4);
      service.stop();
    });

    it('should interpolate linearly between 1.0 and 1.5', () => {
      // At intensity 0.5 → expected multiplier = 1.0 + 0.5*0.5 = 1.25
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);
      service.start();
      // 13 kills → ~0.52 intensity
      for (let i = 0; i < 13; i++) service.registerKill();
      const multiplier = service.getXpMultiplier();
      expect(multiplier).toBeGreaterThan(1.0);
      expect(multiplier).toBeLessThan(1.5);
      // Linear interpolation: should be proportional to intensity
      const intensity = service.getCurrentState().intensity;
      expect(multiplier).toBeCloseTo(1.0 + intensity * 0.5, 5);
      service.stop();
    });
  });

  // ===== lifecycle =====

  describe('lifecycle', () => {
    it('should not process events when stopped', () => {
      // Never call start()
      service.registerKill();
      service.applyDamagePenalty(100);

      const state = service.getCurrentState();
      expect(state.intensity).toBe(0);
      expect(state.killStreak).toBe(0);
    });

    it('should reset all state on reset()', () => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      for (let i = 0; i < 10; i++) service.registerKill();

      const stateBeforeReset = service.getCurrentState();
      expect(stateBeforeReset.intensity).toBeGreaterThan(0);
      expect(stateBeforeReset.killStreak).toBeGreaterThan(0);

      service.reset();

      const stateAfterReset = service.getCurrentState();
      expect(stateAfterReset.intensity).toBe(0);
      expect(stateAfterReset.peakIntensity).toBe(0);
      expect(stateAfterReset.killStreak).toBe(0);
      expect(stateAfterReset.maxKillStreak).toBe(0);
      expect(stateAfterReset.tier).toBe('idle');

      service.stop();
    });

    it('should start intervals correctly and process decay', fakeAsync(() => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      for (let i = 0; i < 5; i++) service.registerKill(); // 0.20 intensity
      const before = service.getCurrentState().intensity;

      tick(1000); // let decay intervals fire
      const after = service.getCurrentState().intensity;
      expect(after).toBeLessThan(before);

      service.stop();
    }));

    it('should stop intervals and halt decay after stop()', fakeAsync(() => {
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      for (let i = 0; i < 5; i++) service.registerKill();

      service.stop();
      const frozen = service.getCurrentState().intensity;

      tick(5000); // far future — no decay should happen
      expect(service.getCurrentState().intensity).toBe(frozen);
    }));

    it('should guard against double-start', () => {
      service.start();
      service.start(); // second call should be a no-op

      // Should still work normally
      service.registerKill();
      expect(service.getCurrentState().killStreak).toBe(1);
      service.stop();
    });
  });

  // ===== decay math verification =====

  describe('decay math', () => {
    it('should match the documented exponential formula', fakeAsync(() => {
      // NATURAL_DECAY_BASE=0.008, NATURAL_DECAY_SCALE=0.025, DECAY_INTERVAL_MS=100
      // At intensity I: decayPerTick = (0.008 + 0.025*I) * 0.1
      comboSpy.getCurrentMultiplier.and.returnValue(1.0);
      comboSpy.getCurrentCombo.and.returnValue(0);

      service.start();
      // 10 kills → exactly 0.40 intensity
      for (let i = 0; i < 10; i++) service.registerKill();
      const I = service.getCurrentState().intensity;

      const expectedDecayPerTick = (0.008 + 0.025 * I) * 0.1;

      tick(100); // one decay tick
      const after = service.getCurrentState().intensity;
      const actualDecay = I - after;

      // Allow floating point tolerance
      expect(actualDecay).toBeCloseTo(expectedDecayPerTick, 4);

      service.stop();
    }));
  });
});
