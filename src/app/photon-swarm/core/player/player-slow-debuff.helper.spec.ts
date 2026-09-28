import { TestBed } from '@angular/core/testing';
import { PlayerSlowDebuffHelper } from './player-slow-debuff.helper';

describe('PlayerSlowDebuffHelper', () => {
  let helper: PlayerSlowDebuffHelper;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PlayerSlowDebuffHelper] });
    helper = TestBed.inject(PlayerSlowDebuffHelper);
  });

  it('should be created', () => {
    expect(helper).toBeTruthy();
  });

  describe('applySlow', () => {
    it('sets the multiplier to (1 - factor)', () => {
      helper.applySlow(0.4, 2000);
      expect(helper['slowMultiplier']).toBeCloseTo(0.6);
    });

    it('clamps factor to [0, 1]', () => {
      helper.applySlow(1.5, 2000);
      expect(helper['slowMultiplier']).toBe(0); // clamped

      helper.applySlow(-0.5, 2000);
      expect(helper['slowMultiplier']).toBe(1.0); // clamped to 0 → multiplier = 1
    });

    it('non-stacking: second call refreshes slowEndTime', () => {
      helper.applySlow(0.4, 500);
      const firstEnd = helper['slowEndTime'];

      helper.applySlow(0.4, 2000);
      const secondEnd = helper['slowEndTime'];

      expect(secondEnd).toBeGreaterThan(firstEnd);
    });

    it('non-stacking: second call does not change multiplier when same factor', () => {
      helper.applySlow(0.4, 2000);
      helper.applySlow(0.4, 2000);
      expect(helper['slowMultiplier']).toBeCloseTo(0.6);
    });
  });

  describe('isSlowed', () => {
    it('returns false before any slow is applied', () => {
      expect(helper.isSlowed()).toBeFalse();
    });

    it('returns true immediately after applySlow', () => {
      helper.applySlow(0.4, 2000);
      expect(helper.isSlowed()).toBeTrue();
    });

    it('returns false after slow duration expires (mocked time)', () => {
      helper.applySlow(0.4, 100);
      helper['slowEndTime'] = Date.now() - 1;
      expect(helper.isSlowed()).toBeFalse();
    });

    it('auto-resets the multiplier to 1.0 when expired', () => {
      helper.applySlow(0.4, 100);
      helper['slowEndTime'] = Date.now() - 1;
      helper.isSlowed(); // triggers auto-reset
      expect(helper['slowMultiplier']).toBe(1.0);
    });
  });

  describe('getSlowRemainingMs', () => {
    it('returns 0 when not slowed', () => {
      expect(helper.getSlowRemainingMs()).toBe(0);
    });

    it('returns a positive value when slowed', () => {
      helper.applySlow(0.4, 2000);
      const remaining = helper.getSlowRemainingMs();
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(2000);
    });

    it('returns 0 after the slow expires', () => {
      helper.applySlow(0.4, 100);
      helper['slowEndTime'] = Date.now() - 1;
      expect(helper.getSlowRemainingMs()).toBe(0);
    });
  });

  describe('getCurrentMultiplier', () => {
    it('is 1.0 when not slowed', () => {
      expect(helper.getCurrentMultiplier()).toBe(1.0);
    });

    it('reflects the active slow multiplier', () => {
      helper.applySlow(0.4, 2000);
      expect(helper.getCurrentMultiplier()).toBeCloseTo(0.6);
    });
  });

  describe('reset', () => {
    it('clears an active slow', () => {
      helper.applySlow(0.4, 2000);
      helper.reset();
      expect(helper.isSlowed()).toBeFalse();
      expect(helper.getCurrentMultiplier()).toBe(1.0);
    });
  });
});
