/**
 * TeleportEffectComponent spec
 *
 * Validates constructor(...args: unknown[]) ECS compliance, field defaults/overrides,
 * getProgress at multiple elapsed times, isComplete boundary, and the `arrived` flag.
 */
import { TeleportEffectComponent } from './teleport-effect.component';

function spreadConstruct<T>(Ctor: new (...args: unknown[]) => T, args: unknown[]): T {
  return new Ctor(...args);
}

describe('TeleportEffectComponent', () => {
  describe('default construction (no args)', () => {
    let c: TeleportEffectComponent;
    let beforeTime: number;
    let afterTime: number;

    beforeEach(() => {
      beforeTime = Date.now();
      c = new TeleportEffectComponent();
      afterTime = Date.now();
    });

    it('sets targetX to 0', () => expect(c.targetX).toBe(0));
    it('sets targetY to 0', () => expect(c.targetY).toBe(0));
    it('sets startTime to approximately Date.now()', () => {
      expect(c.startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(c.startTime).toBeLessThanOrEqual(afterTime);
    });
    it('sets durationMs to 250', () => expect(c.durationMs).toBe(250));
    it('sets originalOpacity to 1.0', () => expect(c.originalOpacity).toBe(1.0));
    it('sets arrived to false', () => expect(c.arrived).toBeFalse());
  });

  describe('custom args', () => {
    it('accepts all six parameters', () => {
      const now = Date.now();
      const c = spreadConstruct(TeleportEffectComponent, [100, 200, now, 500, 0.8, false]);
      expect(c.targetX).toBe(100);
      expect(c.targetY).toBe(200);
      expect(c.startTime).toBe(now);
      expect(c.durationMs).toBe(500);
      expect(c.originalOpacity).toBe(0.8);
      expect(c.arrived).toBeFalse();
    });

    it('accepts arrived = true', () => {
      const c = spreadConstruct(TeleportEffectComponent, [0, 0, Date.now(), 250, 1.0, true]);
      expect(c.arrived).toBeTrue();
    });

    it('falls back to defaults when args are undefined', () => {
      const c = spreadConstruct(TeleportEffectComponent, [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(c.targetX).toBe(0);
      expect(c.targetY).toBe(0);
      expect(c.durationMs).toBe(250);
      expect(c.originalOpacity).toBe(1.0);
      expect(c.arrived).toBeFalse();
    });

    it('accepts partial args — unspecified positions use defaults', () => {
      const c = spreadConstruct(TeleportEffectComponent, [300, 400]);
      expect(c.targetX).toBe(300);
      expect(c.targetY).toBe(400);
      expect(c.durationMs).toBe(250);
    });
  });

  describe('ECS ComponentType compliance', () => {
    it('can be constructed with spread operator from unknown[]', () => {
      const now = Date.now();
      const args: unknown[] = [50, 75, now, 250, 1.0, false];
      const c = new TeleportEffectComponent(...args);
      expect(c.targetX).toBe(50);
    });

    it('zero-arg construction does not throw', () => {
      expect(() => new TeleportEffectComponent()).not.toThrow();
    });
  });

  describe('getProgress', () => {
    it('returns 0 at start (startTime = Date.now())', () => {
      const c = new TeleportEffectComponent(0, 0, Date.now(), 250, 1.0);
      // At the instant of creation, progress should be near 0
      expect(c.getProgress()).toBeGreaterThanOrEqual(0);
      expect(c.getProgress()).toBeLessThan(0.1); // generous bound for synchronous test
    });

    it('returns approximately 0.5 when half the duration has elapsed', () => {
      const halfPast = Date.now() - 125; // 125ms ago, duration 250ms
      const c = new TeleportEffectComponent(0, 0, halfPast, 250, 1.0);
      const progress = c.getProgress();
      // Allow ±50ms tolerance for test runner scheduling
      expect(progress).toBeGreaterThanOrEqual(0.3);
      expect(progress).toBeLessThanOrEqual(0.9);
    });

    it('returns 1 when full duration has elapsed', () => {
      const fullPast = Date.now() - 250; // exactly at duration
      const c = new TeleportEffectComponent(0, 0, fullPast, 250, 1.0);
      expect(c.getProgress()).toBe(1);
    });

    it('clamps to 1 when duration is overshot', () => {
      const longPast = Date.now() - 5000; // well past duration
      const c = new TeleportEffectComponent(0, 0, longPast, 250, 1.0);
      expect(c.getProgress()).toBe(1);
    });
  });

  describe('isComplete', () => {
    it('returns false at start', () => {
      const c = new TeleportEffectComponent(0, 0, Date.now(), 250, 1.0);
      expect(c.isComplete()).toBeFalse();
    });

    it('returns true when duration has elapsed', () => {
      const past = Date.now() - 300; // past 250ms duration
      const c = new TeleportEffectComponent(0, 0, past, 250, 1.0);
      expect(c.isComplete()).toBeTrue();
    });

    it('returns true exactly at boundary (progress === 1)', () => {
      const past = Date.now() - 250;
      const c = new TeleportEffectComponent(0, 0, past, 250, 1.0);
      expect(c.getProgress()).toBe(1);
      expect(c.isComplete()).toBeTrue();
    });
  });
});
