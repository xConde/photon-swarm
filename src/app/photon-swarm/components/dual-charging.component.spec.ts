import { DualChargingComponent } from './dual-charging.component';

describe('DualChargingComponent', () => {
  let component: DualChargingComponent;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 1000000;
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(mockTime));
    component = new DualChargingComponent();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  function advanceTime(deltaMs: number, isMoving: boolean): void {
    mockTime += deltaMs;
    jasmine.clock().mockDate(new Date(mockTime));
    component.update(deltaMs, isMoving);
  }

  describe('ECS compatibility', () => {
    it('should accept unknown[] constructor args', () => {
      expect(new DualChargingComponent('ignored', 123, null)).toBeTruthy();
    });
  });

  describe('charge accumulation', () => {
    it('should build movement charge while moving', () => {
      advanceTime(1000, true);
      expect(component.getMovementCharge()).toBeCloseTo(0.4, 2);
    });

    it('should build focus charge while stationary', () => {
      advanceTime(1000, false);
      expect(component.getFocusCharge()).toBeCloseTo(0.4, 2);
    });

    it('should cap charges at 100%', () => {
      advanceTime(5000, true);
      expect(component.getMovementCharge()).toBe(1.0);
    });
  });

  describe('auto-fire', () => {
    it('should trigger at 100% charge when cooldown ready', () => {
      advanceTime(1100, true);
      advanceTime(2500, true);

      const state = component.getChargeState();
      expect(state.movementCharge).toBeGreaterThanOrEqual(1.0);
      expect(state.shouldAutoFire).toBe(true);
    });

    it('should trigger even when player stops at 100%', () => {
      advanceTime(1100, true);
      advanceTime(2500, true);
      advanceTime(100, false);

      const state = component.getChargeState();
      expect(state.movementCharge).toBeGreaterThanOrEqual(1.0);
      expect(state.shouldAutoFire).toBe(true);
    });

    it('should not trigger during cooldown', () => {
      advanceTime(1100, true);
      advanceTime(2500, true);
      component.fireMovementCharge();
      advanceTime(100, true);

      expect(component.getChargeState().shouldAutoFire).toBe(false);
    });

    it('should reset charge after firing', () => {
      advanceTime(3000, true);
      component.fireMovementCharge();

      const charge = component.getMovementCharge();
      expect(charge).toBeGreaterThan(0);
      expect(charge).toBeLessThan(1.0);
    });

    it('should reset movement charge to exactly AUTO_FIRE_RESET_CHARGE (0.5)', () => {
      // All reset paths now use 0.5 — prevents desync between movement and focus resets.
      advanceTime(3000, true); // charge >= 1.0
      const returned = component.fireMovementCharge();

      expect(returned).toBeCloseTo(1.0, 1);
      expect(component.getMovementCharge()).toBeCloseTo(0.5, 2);
    });

    it('should reset focus charge to exactly AUTO_FIRE_RESET_CHARGE (0.5)', () => {
      // Bug fix: focus used to reset to FOCUS_FIRE_RESET_CHARGE (0.7), causing
      // desync between ECS and PlayerService. Unified to 0.5.
      advanceTime(3000, false); // focus charge >= 1.0
      const returned = component.fireMovementCharge();

      expect(returned).toBeCloseTo(1.0, 1);
      expect(component.getFocusCharge()).toBeCloseTo(0.5, 2);
    });
  });

  describe('maintenance window', () => {
    it('should preserve charge briefly after stopping', () => {
      advanceTime(2000, true);
      const charge = component.getMovementCharge();

      advanceTime(200, false);
      expect(component.getMovementCharge()).toBe(charge);
    });

    it('should decay charge after window expires', () => {
      advanceTime(2000, true);
      const charge = component.getMovementCharge();

      advanceTime(100, false);
      advanceTime(250, false);
      advanceTime(150, false);

      expect(component.getMovementCharge()).toBeLessThan(charge);
    });
  });

  describe('charge decay', () => {
    it('should decay focus charge while moving', () => {
      advanceTime(2000, false);
      const focus = component.getFocusCharge();

      advanceTime(1000, true);
      expect(component.getFocusCharge()).toBeLessThan(focus);
    });

    it('should decay movement charge while stationary past maintenance window', () => {
      advanceTime(1000, true);
      const movement = component.getMovementCharge();

      advanceTime(100, false);
      advanceTime(400, false);

      expect(component.getMovementCharge()).toBeLessThan(movement);
    });
  });
});
