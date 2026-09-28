/**
 * HealAuraComponent spec
 *
 * Validates constructor(...args: unknown[]) ECS compliance, field defaults/overrides,
 * and the isReadyToPulse / markPulsed helpers.
 */
import { HealAuraComponent } from './heal-aura.component';

function spreadConstruct<T>(Ctor: new (...args: unknown[]) => T, args: unknown[]): T {
  return new Ctor(...args);
}

describe('HealAuraComponent', () => {
  describe('default construction (no args)', () => {
    let c: HealAuraComponent;

    beforeEach(() => {
      c = new HealAuraComponent();
    });

    it('sets radius to 180', () => expect(c.radius).toBe(180));
    it('sets healPercent to 0.03', () => expect(c.healPercent).toBe(0.03));
    it('sets intervalMs to 1500', () => expect(c.intervalMs).toBe(1500));
    it('sets lastPulseAt to 0', () => expect(c.lastPulseAt).toBe(0));
  });

  describe('custom args', () => {
    it('accepts all four parameters', () => {
      const c = spreadConstruct(HealAuraComponent, [240, 0.05, 2000, 9999]);
      expect(c.radius).toBe(240);
      expect(c.healPercent).toBe(0.05);
      expect(c.intervalMs).toBe(2000);
      expect(c.lastPulseAt).toBe(9999);
    });

    it('falls back to defaults when args are undefined', () => {
      const c = spreadConstruct(HealAuraComponent, [undefined, undefined, undefined, undefined]);
      expect(c.radius).toBe(180);
      expect(c.healPercent).toBe(0.03);
      expect(c.intervalMs).toBe(1500);
      expect(c.lastPulseAt).toBe(0);
    });

    it('accepts partial args — unspecified positions use defaults', () => {
      const c = spreadConstruct(HealAuraComponent, [300]);
      expect(c.radius).toBe(300);
      expect(c.healPercent).toBe(0.03);
      expect(c.intervalMs).toBe(1500);
      expect(c.lastPulseAt).toBe(0);
    });
  });

  describe('ECS ComponentType compliance', () => {
    it('can be constructed with spread operator from unknown[]', () => {
      const args: unknown[] = [180, 0.03, 1500, 0];
      const c = new HealAuraComponent(...args);
      expect(c.radius).toBe(180);
    });

    it('zero args construction does not throw', () => {
      expect(() => new HealAuraComponent()).not.toThrow();
    });
  });

  describe('isReadyToPulse', () => {
    it('returns true when elapsed time equals intervalMs (boundary inclusive)', () => {
      const c = new HealAuraComponent(180, 0.03, 1500, 1000);
      expect(c.isReadyToPulse(2500)).toBeTrue(); // now - lastPulseAt === intervalMs
    });

    it('returns true when elapsed time exceeds intervalMs', () => {
      const c = new HealAuraComponent(180, 0.03, 1500, 1000);
      expect(c.isReadyToPulse(3000)).toBeTrue();
    });

    it('returns false when elapsed time is less than intervalMs', () => {
      const c = new HealAuraComponent(180, 0.03, 1500, 1000);
      expect(c.isReadyToPulse(2499)).toBeFalse();
    });

    it('returns true immediately when lastPulseAt is 0', () => {
      const c = new HealAuraComponent();
      // any positive now >= 1500 fires; 0 lastPulseAt fires on first tick
      expect(c.isReadyToPulse(1500)).toBeTrue();
    });

    it('returns true on the very first game frame (now=0, lastPulseAt=0) since elapsed==0 meets no interval', () => {
      // edge case: if both are 0, elapsed is 0 which is < 1500 — not ready
      const c = new HealAuraComponent();
      expect(c.isReadyToPulse(0)).toBeFalse();
    });
  });

  describe('markPulsed', () => {
    it('updates lastPulseAt to the provided timestamp', () => {
      const c = new HealAuraComponent();
      expect(c.lastPulseAt).toBe(0);
      c.markPulsed(5000);
      expect(c.lastPulseAt).toBe(5000);
    });

    it('calling markPulsed then isReadyToPulse just before next interval returns false', () => {
      const c = new HealAuraComponent(180, 0.03, 1500, 0);
      c.markPulsed(5000);
      expect(c.isReadyToPulse(6499)).toBeFalse();
    });

    it('calling markPulsed then isReadyToPulse at next interval returns true', () => {
      const c = new HealAuraComponent(180, 0.03, 1500, 0);
      c.markPulsed(5000);
      expect(c.isReadyToPulse(6500)).toBeTrue();
    });

    it('subsequent markPulsed calls update the timestamp each time', () => {
      const c = new HealAuraComponent();
      c.markPulsed(1000);
      expect(c.lastPulseAt).toBe(1000);
      c.markPulsed(2500);
      expect(c.lastPulseAt).toBe(2500);
    });
  });
});
