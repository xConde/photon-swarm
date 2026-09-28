/**
 * EmpPulseComponent spec
 *
 * Validates constructor(...args: unknown[]) ECS compliance and all field defaults/overrides.
 */
import { EmpPulseComponent } from './emp-pulse.component';

function spreadConstruct<T>(Ctor: new (...args: unknown[]) => T, args: unknown[]): T {
  return new Ctor(...args);
}

describe('EmpPulseComponent', () => {
  describe('default construction (no args)', () => {
    let c: EmpPulseComponent;

    beforeEach(() => {
      c = new EmpPulseComponent();
    });

    it('sets cooldown to 6000ms', () => expect(c.cooldown).toBe(6000));
    it('sets lastPulseTime to 0', () => expect(c.lastPulseTime).toBe(0));
    it('sets radius to 120', () => expect(c.radius).toBe(120));
    it('sets slowFactor to 0.4', () => expect(c.slowFactor).toBe(0.4));
    it('sets slowDuration to 2000ms', () => expect(c.slowDuration).toBe(2000));
    it('sets chargeDrain to 0.3', () => expect(c.chargeDrain).toBe(0.3));
  });

  describe('parameterised construction (via args[])', () => {
    it('accepts all six parameters', () => {
      const c = spreadConstruct(EmpPulseComponent, [8000, 1000, 200, 0.6, 3000, 0.5]);
      expect(c.cooldown).toBe(8000);
      expect(c.lastPulseTime).toBe(1000);
      expect(c.radius).toBe(200);
      expect(c.slowFactor).toBe(0.6);
      expect(c.slowDuration).toBe(3000);
      expect(c.chargeDrain).toBe(0.5);
    });

    it('falls back to defaults when args are undefined', () => {
      const c = spreadConstruct(EmpPulseComponent, [undefined, undefined, undefined, undefined, undefined, undefined]);
      expect(c.cooldown).toBe(6000);
      expect(c.radius).toBe(120);
    });

    it('accepts partial args — unspecified positions use defaults', () => {
      const c = spreadConstruct(EmpPulseComponent, [4000]);
      expect(c.cooldown).toBe(4000);
      expect(c.lastPulseTime).toBe(0);
      expect(c.radius).toBe(120);
    });
  });

  describe('ECS ComponentType compliance', () => {
    it('can be constructed with spread operator from unknown[]', () => {
      const args: unknown[] = [6000, 0, 120, 0.4, 2000, 0.3];
      const c = new EmpPulseComponent(...args);
      expect(c.cooldown).toBe(6000);
    });

    it('zero args construction does not throw', () => {
      expect(() => new EmpPulseComponent()).not.toThrow();
    });
  });

  describe('field ranges', () => {
    it('accepts slowFactor of 0 (no slow)', () => {
      const c = spreadConstruct(EmpPulseComponent, [6000, 0, 120, 0, 2000, 0.3]);
      expect(c.slowFactor).toBe(0);
    });

    it('accepts slowFactor of 1 (full stop)', () => {
      const c = spreadConstruct(EmpPulseComponent, [6000, 0, 120, 1, 2000, 0.3]);
      expect(c.slowFactor).toBe(1);
    });

    it('accepts negative lastPulseTime (pre-primed)', () => {
      const c = spreadConstruct(EmpPulseComponent, [6000, -1000, 120, 0.4, 2000, 0.3]);
      expect(c.lastPulseTime).toBe(-1000);
    });
  });
});
