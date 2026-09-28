import { TestBed } from '@angular/core/testing';
import { ComboState, ComboSystemService } from '../combat';
import { AudioService } from '../../audio/audio.service';

describe('ComboSystemService', () => {
  let service: ComboSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ComboSystemService,
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
      ],
    });

    // Use fake timers for all tests - uninstall first in case previous test left clock installed
    try {
      jasmine.clock().uninstall();
    } catch {
      // Clock wasn't installed, which is fine
    }
    jasmine.clock().install();
    service = TestBed.inject(ComboSystemService);
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
    jasmine.clock().uninstall();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initial State', () => {
    it('should start with zero combo count', () => {
      expect(service.getCurrentCombo()).toBe(0);
    });

    it('should start with multiplier of 1', () => {
      expect(service.getCurrentMultiplier()).toBe(1);
    });

    it('should have no tier initially', () => {
      expect(service.getCurrentTier()).toBeNull();
    });
  });

  describe('registerKill', () => {
    it('should start a new combo on first kill', () => {
      service.registerKill(100);

      expect(service.getCurrentCombo()).toBe(1);
      expect(service.getCurrentMultiplier()).toBe(1);
    });

    it('should increment combo on rapid successive kills', () => {
      service.registerKill(100);
      jasmine.clock().tick(1000); // 1 second later (within 3s window)
      service.registerKill(100);

      expect(service.getCurrentCombo()).toBe(2);
    });

    it('should return base points when multiplier is 1', () => {
      const points = service.registerKill(100);
      expect(points).toBe(100);
    });

    it('should apply multiplier to score at higher combos', () => {
      // Get to TRIPLE KILL tier (3 kills = 1.5x)
      service.registerKill(100);
      jasmine.clock().tick(500);
      service.registerKill(100);
      jasmine.clock().tick(500);
      const points = service.registerKill(100);

      // 3rd kill should have 1.5x multiplier
      expect(points).toBe(150);
    });

    it('should reset combo if kills are too far apart', () => {
      service.registerKill(100);
      expect(service.getCurrentCombo()).toBe(1);

      // Wait longer than COMBO_WINDOW (3000ms)
      jasmine.clock().tick(3500);

      service.registerKill(100);
      // Should start new combo, not continue
      expect(service.getCurrentCombo()).toBe(1);
    });

    it('should track total score across kills', () => {
      let state: ComboState | undefined;
      service.getComboState().subscribe((s) => (state = s));

      service.registerKill(100);
      jasmine.clock().tick(0); // Process microtasks
      expect(state?.totalScore).toBe(100);

      jasmine.clock().tick(500);
      service.registerKill(100);
      jasmine.clock().tick(0);
      expect(state?.totalScore).toBe(200);
    });
  });

  describe('Combo Tiers', () => {
    it('should reach TRIPLE KILL tier at 3 kills', () => {
      for (let i = 0; i < 3; i++) {
        service.registerKill(100);
        jasmine.clock().tick(500);
      }

      const tier = service.getCurrentTier();
      expect(tier?.name).toBe('TRIPLE KILL');
      expect(service.getCurrentMultiplier()).toBe(1.5);
    });

    it('should reach RAMPAGE tier at 5 kills', () => {
      for (let i = 0; i < 5; i++) {
        service.registerKill(100);
        jasmine.clock().tick(500);
      }

      const tier = service.getCurrentTier();
      expect(tier?.name).toBe('RAMPAGE');
      expect(service.getCurrentMultiplier()).toBe(2.0);
    });

    it('should reach KILLING SPREE tier at 10 kills', () => {
      for (let i = 0; i < 10; i++) {
        service.registerKill(100);
        jasmine.clock().tick(200);
      }

      const tier = service.getCurrentTier();
      expect(tier?.name).toBe('KILLING SPREE');
      expect(service.getCurrentMultiplier()).toBe(3.0);
    });

    it('should reach GODLIKE tier at 30 kills', () => {
      for (let i = 0; i < 30; i++) {
        service.registerKill(100);
        jasmine.clock().tick(50);
      }

      const tier = service.getCurrentTier();
      expect(tier?.name).toBe('GODLIKE');
      expect(service.getCurrentMultiplier()).toBe(7.5);
    });

    it('should reach LEGENDARY tier at 50 kills', () => {
      for (let i = 0; i < 50; i++) {
        service.registerKill(100);
        jasmine.clock().tick(50);
      }

      const tier = service.getCurrentTier();
      expect(tier?.name).toBe('LEGENDARY');
      expect(service.getCurrentMultiplier()).toBe(10.0);
    });
  });

  describe('Combo Decay', () => {
    it('should decay timeRemaining over time', () => {
      let state: ComboState | undefined;
      service.getComboState().subscribe((s) => (state = s));

      service.registerKill(100);
      jasmine.clock().tick(0);
      expect(state?.timeRemaining).toBe(3000);

      jasmine.clock().tick(1000);
      // Should have decayed by ~1000ms (with some tolerance for interval timing)
      expect(state?.timeRemaining).toBeLessThanOrEqual(2100);
      expect(state?.timeRemaining).toBeGreaterThanOrEqual(1900);
    });

    it('should reset combo when timer expires', () => {
      let state: ComboState | undefined;
      service.getComboState().subscribe((s) => (state = s));

      service.registerKill(100);
      jasmine.clock().tick(0);
      expect(state?.isActive).toBe(true);
      expect(state?.count).toBe(1);

      // Wait for full decay
      jasmine.clock().tick(3500);

      expect(state?.isActive).toBe(false);
      expect(state?.count).toBe(0);
      expect(state?.multiplier).toBe(1);
    });

    it('should refresh timer on new kill', () => {
      let state: ComboState | undefined;
      service.getComboState().subscribe((s) => (state = s));

      service.registerKill(100);
      jasmine.clock().tick(0);

      // Wait 2 seconds
      jasmine.clock().tick(2000);

      // New kill should refresh timer
      service.registerKill(100);
      jasmine.clock().tick(0);
      expect(state?.timeRemaining).toBe(3000);
    });
  });

  describe('Edge Cases', () => {
    it('should handle kill at exact combo window boundary', () => {
      service.registerKill(100);

      // Kill at exactly 3000ms - should start new combo
      jasmine.clock().tick(3000);
      service.registerKill(100);

      // At exactly 3000ms, timeSinceLastKill === COMBO_WINDOW, not <
      // So it should start a new combo
      expect(service.getCurrentCombo()).toBe(1);
    });

    it('should handle kill just before combo window expires', () => {
      service.registerKill(100);

      // Kill at 2999ms - should continue combo
      jasmine.clock().tick(2999);
      service.registerKill(100);

      expect(service.getCurrentCombo()).toBe(2);
    });

    it('should handle rapid kills (same millisecond)', () => {
      service.registerKill(100);
      service.registerKill(100);
      service.registerKill(100);

      expect(service.getCurrentCombo()).toBe(3);
    });

    it('should preserve totalScore on combo break', () => {
      let state: ComboState | undefined;
      service.getComboState().subscribe((s) => (state = s));

      // Build up some score
      service.registerKill(100);
      jasmine.clock().tick(500);
      service.registerKill(100);
      jasmine.clock().tick(500);
      service.registerKill(100); // 1.5x = 150
      jasmine.clock().tick(0);

      const scoreBeforeBreak = state?.totalScore;
      expect(scoreBeforeBreak).toBe(350); // 100 + 100 + 150

      // Let combo expire
      jasmine.clock().tick(4000);

      // Score should be preserved even though combo reset
      expect(state?.totalScore).toBe(350);
    });

    it('should handle default basePoints', () => {
      const points = service.registerKill();
      expect(points).toBe(100); // Default is 100
    });

    it('should floor fractional points', () => {
      // Get to 1.5x multiplier (3 kills)
      service.registerKill(100);
      jasmine.clock().tick(500);
      service.registerKill(100);
      jasmine.clock().tick(500);

      // Use odd number to test flooring
      const points = service.registerKill(77);
      expect(points).toBe(115); // 77 * 1.5 = 115.5, floored to 115
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      let state: ComboState | undefined;
      service.getComboState().subscribe((s) => (state = s));

      // Build up combo
      for (let i = 0; i < 5; i++) {
        service.registerKill(100);
        jasmine.clock().tick(500);
      }
      jasmine.clock().tick(0);

      expect(state?.count).toBe(5);
      expect(state?.totalScore).toBeGreaterThan(0);

      service.reset();
      jasmine.clock().tick(0);

      expect(state?.count).toBe(0);
      expect(state?.multiplier).toBe(1);
      expect(state?.timeRemaining).toBe(0);
      expect(state?.isActive).toBe(false);
      expect(state?.totalScore).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should clean up interval on destroy', () => {
      // Start a combo so the decay interval is running
      service.registerKill(100);

      spyOn(window, 'clearInterval').and.callThrough();

      service.destroy();

      expect(window.clearInterval).toHaveBeenCalled();
    });

    it('should complete the observable on destroy', () => {
      let completed = false;
      service.getComboState().subscribe({
        complete: () => (completed = true),
      });

      service.destroy();
      jasmine.clock().tick(0);

      expect(completed).toBe(true);
    });
  });
});
