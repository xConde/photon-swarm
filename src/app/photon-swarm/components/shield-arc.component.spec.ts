/**
 * ShieldArcComponent spec
 *
 * Validates constructor(...args: unknown[]) ECS compliance and all field defaults/overrides.
 */
import { ShieldArcComponent } from './shield-arc.component';

function spreadConstruct<T>(Ctor: new (...args: unknown[]) => T, args: unknown[]): T {
  return new Ctor(...args);
}

describe('ShieldArcComponent', () => {
  describe('default construction (no args)', () => {
    let c: ShieldArcComponent;

    beforeEach(() => {
      c = new ShieldArcComponent();
    });

    it('sets arcAngle to 2π/3 (120 degrees)', () => {
      expect(c.arcAngle).toBeCloseTo((2 * Math.PI) / 3, 5);
    });

    it('sets damageReduction to 0.8', () => expect(c.damageReduction).toBe(0.8));
    it('sets facingAngle to 0', () => expect(c.facingAngle).toBe(0));
    it('sets lastBlockTime to 0', () => expect(c.lastBlockTime).toBe(0));
  });

  describe('parameterised construction (via args[])', () => {
    it('accepts all four parameters', () => {
      const arcAngle = Math.PI / 2;
      const c = spreadConstruct(ShieldArcComponent, [arcAngle, 0.5, 1.2, 9999]);
      expect(c.arcAngle).toBe(arcAngle);
      expect(c.damageReduction).toBe(0.5);
      expect(c.facingAngle).toBe(1.2);
      expect(c.lastBlockTime).toBe(9999);
    });

    it('falls back to defaults when args are undefined', () => {
      const c = spreadConstruct(ShieldArcComponent, [undefined, undefined, undefined, undefined]);
      expect(c.arcAngle).toBeCloseTo((2 * Math.PI) / 3, 5);
      expect(c.damageReduction).toBe(0.8);
      expect(c.facingAngle).toBe(0);
      expect(c.lastBlockTime).toBe(0);
    });

    it('accepts partial args — unspecified positions use defaults', () => {
      const c = spreadConstruct(ShieldArcComponent, [Math.PI]);
      expect(c.arcAngle).toBe(Math.PI);
      expect(c.damageReduction).toBe(0.8);
      expect(c.facingAngle).toBe(0);
    });
  });

  describe('ECS ComponentType compliance', () => {
    it('can be constructed with spread operator from unknown[]', () => {
      const args: unknown[] = [(2 * Math.PI) / 3, 0.8, 0, 0];
      const c = new ShieldArcComponent(...args);
      expect(c.arcAngle).toBeCloseTo((2 * Math.PI) / 3, 5);
    });

    it('zero args construction does not throw', () => {
      expect(() => new ShieldArcComponent()).not.toThrow();
    });
  });

  describe('getBlockReduction (static)', () => {
    // Shield facing right (0 radians), 120-degree arc, 80% reduction
    let shield: ShieldArcComponent;

    beforeEach(() => {
      shield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, 0, 0);
    });

    it('returns damageReduction when attack comes from directly in front (aligned with facingAngle)', () => {
      // sourceAngle === facingAngle: attack from directly ahead
      expect(ShieldArcComponent.getBlockReduction(shield, 0)).toBe(0.8);
    });

    it('returns 0 when attack comes from directly behind (opposite facingAngle)', () => {
      expect(ShieldArcComponent.getBlockReduction(shield, Math.PI)).toBe(0);
    });

    it('returns damageReduction at exactly the arc boundary (inclusive)', () => {
      // Boundary is at exactly arcAngle/2 = π/3 (60 degrees)
      expect(ShieldArcComponent.getBlockReduction(shield, Math.PI / 3)).toBe(0.8);
      expect(ShieldArcComponent.getBlockReduction(shield, -Math.PI / 3)).toBe(0.8);
    });

    it('returns 0 just outside the arc boundary', () => {
      const justOutside = Math.PI / 3 + 0.001;
      expect(ShieldArcComponent.getBlockReduction(shield, justOutside)).toBe(0);
      expect(ShieldArcComponent.getBlockReduction(shield, -justOutside)).toBe(0);
    });

    it('normalizes angles that cross the ±π boundary', () => {
      // Shield facing left (π), attack from slightly above-left — should be blocked
      const leftFacingShield = new ShieldArcComponent((2 * Math.PI) / 3, 0.8, Math.PI, 0);
      // Source angle of -π is the same direction as +π (facing left)
      expect(ShieldArcComponent.getBlockReduction(leftFacingShield, -Math.PI)).toBe(0.8);
    });

    it('returns 0 when damageReduction is 0 regardless of angle', () => {
      const noShield = new ShieldArcComponent((2 * Math.PI) / 3, 0, 0, 0);
      expect(ShieldArcComponent.getBlockReduction(noShield, 0)).toBe(0);
    });
  });

  describe('arcAngle is 120 degrees in radians', () => {
    it('half-arc covers 60 degrees on each side', () => {
      const c = new ShieldArcComponent();
      const halfArc = c.arcAngle / 2;
      expect(halfArc).toBeCloseTo(Math.PI / 3, 5); // 60 degrees
    });
  });

  describe('field ranges', () => {
    it('accepts damageReduction of 0 (no shield)', () => {
      const c = spreadConstruct(ShieldArcComponent, [(2 * Math.PI) / 3, 0, 0, 0]);
      expect(c.damageReduction).toBe(0);
    });

    it('accepts damageReduction of 1 (full block)', () => {
      const c = spreadConstruct(ShieldArcComponent, [(2 * Math.PI) / 3, 1, 0, 0]);
      expect(c.damageReduction).toBe(1);
    });

    it('accepts negative facingAngle (wrapping handled externally)', () => {
      const c = spreadConstruct(ShieldArcComponent, [(2 * Math.PI) / 3, 0.8, -Math.PI, 0]);
      expect(c.facingAngle).toBe(-Math.PI);
    });

    it('accepts a timestamp for lastBlockTime', () => {
      const now = Date.now();
      const c = spreadConstruct(ShieldArcComponent, [(2 * Math.PI) / 3, 0.8, 0, now]);
      expect(c.lastBlockTime).toBe(now);
    });
  });
});
