import { ComponentFactory } from './component-factory';
import { AbilityComponent, AbilityType, InvincibilityComponent } from '@photon/components';

describe('ComponentFactory', () => {
  describe('createAbilityComponent', () => {
    it('should create an AbilityComponent with provided abilities', () => {
      const abilities = [
        {
          type: AbilityType.AREA_BUFF,
          cooldownMs: 5000,
          lastUsedTime: 0,
          damage: 10,
        },
        {
          type: AbilityType.POISON_CLOUD,
          cooldownMs: 8000,
          lastUsedTime: 0,
          damage: 5,
        },
      ];

      const component = ComponentFactory.createAbilityComponent(abilities);

      expect(component).toBeInstanceOf(AbilityComponent);
      expect(component.abilities).toEqual(abilities);
      expect(component.abilities.length).toBe(2);
      expect(component.currentAbilityIndex).toBe(0);
      expect(component.nextAbilityTime).toBe(0);
    });

    it('should create an AbilityComponent with empty abilities array', () => {
      const component = ComponentFactory.createAbilityComponent([]);

      expect(component).toBeInstanceOf(AbilityComponent);
      expect(component.abilities).toEqual([]);
      expect(component.abilities.length).toBe(0);
    });
  });

  describe('createInvincibilityComponent', () => {
    it('should create an InvincibilityComponent with specified duration', () => {
      const durationMs = 2000;
      const beforeTime = window.performance.now();

      const component = ComponentFactory.createInvincibilityComponent(durationMs);

      const afterTime = window.performance.now();

      expect(component).toBeInstanceOf(InvincibilityComponent);
      expect(component.duration).toBe(durationMs);
      expect(component.startTime).toBeGreaterThanOrEqual(beforeTime);
      expect(component.startTime).toBeLessThanOrEqual(afterTime);
    });

    it('should create active invincibility components', () => {
      const component = ComponentFactory.createInvincibilityComponent(1000);

      expect(component.isActive()).toBe(true);
      expect(component.getRemainingTime()).toBeGreaterThan(0);
      expect(component.getRemainingTime()).toBeLessThanOrEqual(1000);
    });

    it('should handle different duration values', () => {
      const shortDuration = ComponentFactory.createInvincibilityComponent(100);
      const longDuration = ComponentFactory.createInvincibilityComponent(10000);

      expect(shortDuration.duration).toBe(100);
      expect(longDuration.duration).toBe(10000);
      expect(shortDuration.getRemainingTime()).toBeLessThanOrEqual(100);
      expect(longDuration.getRemainingTime()).toBeLessThanOrEqual(10000);
    });
  });

  describe('resetInvincibility', () => {
    it('should reset existing invincibility component with new duration', () => {
      const component = new InvincibilityComponent();
      component.duration = 1000;
      component.startTime = window.performance.now() - 500; // Half expired

      const newDuration = 3000;
      const beforeReset = window.performance.now();

      ComponentFactory.resetInvincibility(component, newDuration);

      const afterReset = window.performance.now();

      expect(component.duration).toBe(newDuration);
      expect(component.startTime).toBeGreaterThanOrEqual(beforeReset);
      expect(component.startTime).toBeLessThanOrEqual(afterReset);
      expect(component.isActive()).toBe(true);
      expect(component.getRemainingTime()).toBeGreaterThan(2900);
    });

    it('should properly reset expired invincibility', () => {
      const component = new InvincibilityComponent();
      component.duration = 100;
      component.startTime = window.performance.now() - 1000; // Long expired

      expect(component.isActive()).toBe(false);

      ComponentFactory.resetInvincibility(component, 2000);

      expect(component.isActive()).toBe(true);
      expect(component.getRemainingTime()).toBeGreaterThan(1900);
    });

    it('should work with different duration values', () => {
      const component = new InvincibilityComponent();

      // Reset multiple times with different durations
      ComponentFactory.resetInvincibility(component, 1000);
      expect(component.duration).toBe(1000);
      const firstStartTime = component.startTime;

      // Small delay to ensure time advances (performance.now() is monotonic)
      // Use a busy-wait to guarantee time advancement
      const start = window.performance.now();
      while (window.performance.now() - start < 1) {
        // spin
      }

      ComponentFactory.resetInvincibility(component, 5000);
      expect(component.duration).toBe(5000);
      // After time advancement, the new startTime should be later
      expect(component.startTime).toBeGreaterThan(firstStartTime);
    });
  });

  describe('factory pattern benefits', () => {
    it('should create independent component instances', () => {
      const abilities1 = [{ type: AbilityType.AREA_BUFF, cooldownMs: 1000, lastUsedTime: 0 }];
      const abilities2 = [{ type: AbilityType.AREA_HEAL, cooldownMs: 2000, lastUsedTime: 0 }];

      const comp1 = ComponentFactory.createAbilityComponent(abilities1);
      const comp2 = ComponentFactory.createAbilityComponent(abilities2);

      expect(comp1).not.toBe(comp2);
      expect(comp1.abilities).not.toBe(comp2.abilities);

      // Modifying one shouldn't affect the other
      comp1.currentAbilityIndex = 5;
      expect(comp2.currentAbilityIndex).toBe(0);
    });

    it('should create components without exposing constructor complexity', () => {
      // The factory method hides the complexity of setting up components
      const component = ComponentFactory.createInvincibilityComponent(2000);

      // Component is fully initialized and ready to use
      expect(component.isActive()).toBe(true);
      expect(component.duration).toBe(2000);
      expect(component.startTime).toBeDefined();

      // No need to manually set properties after construction
    });

    it('should provide consistent initialization', () => {
      // Every component created through factory has consistent initialization
      const components = [];
      for (let i = 0; i < 10; i++) {
        components.push(ComponentFactory.createInvincibilityComponent(1000));
      }

      components.forEach((comp) => {
        expect(comp.duration).toBe(1000);
        expect(comp.startTime).toBeDefined();
        expect(comp.isActive()).toBe(true);
      });
    });
  });
});
