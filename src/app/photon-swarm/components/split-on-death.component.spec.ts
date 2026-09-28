/**
 * SplitOnDeathComponent spec
 *
 * Validates constructor(...args: unknown[]) ECS compliance, all field defaults/overrides,
 * canSplit() boundary conditions, and spawnChildGeneration() increment behaviour.
 */
import { SplitOnDeathComponent } from './split-on-death.component';

function spreadConstruct<T>(Ctor: new (...args: unknown[]) => T, args: unknown[]): T {
  return new Ctor(...args);
}

describe('SplitOnDeathComponent', () => {
  describe('default construction (no args)', () => {
    let c: SplitOnDeathComponent;

    beforeEach(() => {
      c = new SplitOnDeathComponent();
    });

    it('sets childCount to 2', () => expect(c.childCount).toBe(2));
    it('sets generation to 0', () => expect(c.generation).toBe(0));
    it('sets maxGenerations to 1', () => expect(c.maxGenerations).toBe(1));
    it('sets childHealthScale to 0.5', () => expect(c.childHealthScale).toBe(0.5));
    it('sets jitterRadius to 28', () => expect(c.jitterRadius).toBe(28));
  });

  describe('parameterised construction (via args[])', () => {
    it('accepts all five parameters', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [3, 1, 2, 0.75, 40]);
      expect(c.childCount).toBe(3);
      expect(c.generation).toBe(1);
      expect(c.maxGenerations).toBe(2);
      expect(c.childHealthScale).toBe(0.75);
      expect(c.jitterRadius).toBe(40);
    });

    it('falls back to defaults when args are undefined', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [undefined, undefined, undefined, undefined, undefined]);
      expect(c.childCount).toBe(2);
      expect(c.generation).toBe(0);
      expect(c.maxGenerations).toBe(1);
      expect(c.childHealthScale).toBe(0.5);
      expect(c.jitterRadius).toBe(28);
    });

    it('accepts partial args — unspecified positions use defaults', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [4]);
      expect(c.childCount).toBe(4);
      expect(c.generation).toBe(0);
      expect(c.maxGenerations).toBe(1);
    });
  });

  describe('ECS ComponentType compliance', () => {
    it('can be constructed with spread operator from unknown[]', () => {
      const args: unknown[] = [2, 0, 1, 0.5, 28];
      const c = new SplitOnDeathComponent(...args);
      expect(c.childCount).toBe(2);
    });

    it('zero args construction does not throw', () => {
      expect(() => new SplitOnDeathComponent()).not.toThrow();
    });
  });

  describe('canSplit()', () => {
    it('returns true when generation=0 and maxGenerations=1 (gen 0 parent can split)', () => {
      const c = new SplitOnDeathComponent();
      expect(c.canSplit()).toBeTrue();
    });

    it('returns false when generation equals maxGenerations (child cannot split)', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [2, 1, 1, 0.5, 28]);
      expect(c.canSplit()).toBeFalse();
    });

    it('returns false when generation exceeds maxGenerations', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [2, 2, 1, 0.5, 28]);
      expect(c.canSplit()).toBeFalse();
    });

    it('returns true when generation is strictly less than maxGenerations', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [2, 0, 2, 0.5, 28]);
      expect(c.canSplit()).toBeTrue();
    });
  });

  describe('spawnChildGeneration()', () => {
    it('returns generation + 1 for gen 0', () => {
      const c = new SplitOnDeathComponent();
      expect(c.spawnChildGeneration()).toBe(1);
    });

    it('returns generation + 1 for arbitrary generation values', () => {
      const c = spreadConstruct(SplitOnDeathComponent, [2, 3, 5, 0.5, 28]);
      expect(c.spawnChildGeneration()).toBe(4);
    });

    it('does not mutate generation field', () => {
      const c = new SplitOnDeathComponent();
      c.spawnChildGeneration();
      expect(c.generation).toBe(0);
    });
  });
});
