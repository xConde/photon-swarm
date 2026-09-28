import { DeathAnimationComponent } from './death-animation.component';

describe('DeathAnimationComponent', () => {
  // Mock performance.now for deterministic tests
  let mockNow: number;

  beforeEach(() => {
    mockNow = 1000;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);
  });

  describe('constructor', () => {
    it('should create with default values', () => {
      const component = new DeathAnimationComponent();

      expect(component.duration).toBe(500);
      expect(component.animationType).toBe('fade');
      expect(component.startTime).toBe(1000);
      expect(component.originalOpacity).toBe(1.0);
      expect(component.originalScale).toBe(1.0);
      expect(component.isAnimating).toBe(true);
    });

    it('should accept custom duration and animation type', () => {
      const component = new DeathAnimationComponent(600, 'flash');

      expect(component.duration).toBe(600);
      expect(component.animationType).toBe('flash');
    });

    it('should handle shrink animation type', () => {
      const component = new DeathAnimationComponent(400, 'shrink');

      expect(component.duration).toBe(400);
      expect(component.animationType).toBe('shrink');
    });
  });

  describe('getProgress', () => {
    it('should return 0 at start', () => {
      const component = new DeathAnimationComponent(500);

      expect(component.getProgress()).toBe(0);
    });

    it('should return 0.5 at halfway point', () => {
      const component = new DeathAnimationComponent(500);
      mockNow = 1250; // 250ms elapsed

      expect(component.getProgress()).toBe(0.5);
    });

    it('should return 1 at completion', () => {
      const component = new DeathAnimationComponent(500);
      mockNow = 1500; // 500ms elapsed

      expect(component.getProgress()).toBe(1.0);
    });

    it('should cap progress at 1.0', () => {
      const component = new DeathAnimationComponent(500);
      mockNow = 2000; // 1000ms elapsed (past duration)

      expect(component.getProgress()).toBe(1.0);
    });
  });

  describe('isComplete', () => {
    it('should return false when not complete', () => {
      const component = new DeathAnimationComponent(500);
      mockNow = 1200;

      expect(component.isComplete()).toBe(false);
    });

    it('should return true when complete', () => {
      const component = new DeathAnimationComponent(500);
      mockNow = 1500;

      expect(component.isComplete()).toBe(true);
    });

    it('should return true when past duration', () => {
      const component = new DeathAnimationComponent(500);
      mockNow = 2000;

      expect(component.isComplete()).toBe(true);
    });
  });

  describe('getCurrentOpacity - fade animation', () => {
    it('should return original opacity at start', () => {
      const component = new DeathAnimationComponent(500, 'fade');

      expect(component.getCurrentOpacity()).toBe(1.0);
    });

    it('should return 0.5 opacity at halfway', () => {
      const component = new DeathAnimationComponent(500, 'fade');
      mockNow = 1250;

      expect(component.getCurrentOpacity()).toBe(0.5);
    });

    it('should return 0 opacity at completion', () => {
      const component = new DeathAnimationComponent(500, 'fade');
      mockNow = 1500;

      expect(component.getCurrentOpacity()).toBe(0);
    });

    it('should return original opacity when not animating', () => {
      const component = new DeathAnimationComponent(500, 'fade');
      component.isAnimating = false;
      mockNow = 1500;

      expect(component.getCurrentOpacity()).toBe(1.0);
    });
  });

  describe('getCurrentOpacity - flash animation', () => {
    it('should brighten during initial flash phase (0-20%)', () => {
      const component = new DeathAnimationComponent(500, 'flash');
      mockNow = 1050; // 10% progress

      const opacity = component.getCurrentOpacity();
      expect(opacity).toBeGreaterThan(1.0);
      expect(opacity).toBeLessThanOrEqual(1.5);
    });

    it('should fade after flash phase (>20%)', () => {
      const component = new DeathAnimationComponent(500, 'flash');
      mockNow = 1300; // 60% progress

      const opacity = component.getCurrentOpacity();
      expect(opacity).toBeLessThan(1.0);
      expect(opacity).toBeGreaterThan(0);
    });

    it('should reach 0 at completion', () => {
      const component = new DeathAnimationComponent(500, 'flash');
      mockNow = 1500;

      expect(component.getCurrentOpacity()).toBe(0);
    });
  });

  describe('getCurrentOpacity - shrink animation', () => {
    it('should fade more slowly than pure fade', () => {
      const component = new DeathAnimationComponent(500, 'shrink');
      mockNow = 1500; // 100% progress

      // Shrink only reduces opacity by half at completion
      expect(component.getCurrentOpacity()).toBe(0.5);
    });
  });

  describe('getCurrentScale - fade animation', () => {
    it('should maintain original scale', () => {
      const component = new DeathAnimationComponent(500, 'fade');
      mockNow = 1250;

      expect(component.getCurrentScale()).toBe(1.0);
    });
  });

  describe('getCurrentScale - shrink animation', () => {
    it('should return original scale at start', () => {
      const component = new DeathAnimationComponent(500, 'shrink');

      expect(component.getCurrentScale()).toBe(1.0);
    });

    it('should shrink to 0.5 at halfway', () => {
      const component = new DeathAnimationComponent(500, 'shrink');
      mockNow = 1250;

      expect(component.getCurrentScale()).toBe(0.5);
    });

    it('should shrink to 0 at completion', () => {
      const component = new DeathAnimationComponent(500, 'shrink');
      mockNow = 1500;

      expect(component.getCurrentScale()).toBe(0);
    });

    it('should return original scale when not animating', () => {
      const component = new DeathAnimationComponent(500, 'shrink');
      component.isAnimating = false;
      mockNow = 1500;

      expect(component.getCurrentScale()).toBe(1.0);
    });
  });

  describe('getCurrentScale - flash animation', () => {
    it('should grow slightly during flash phase', () => {
      const component = new DeathAnimationComponent(500, 'flash');
      mockNow = 1050; // 10% progress

      const scale = component.getCurrentScale();
      expect(scale).toBeGreaterThan(1.0);
      expect(scale).toBeLessThanOrEqual(1.04); // Max 1 + 0.2*0.2 = 1.04
    });

    it('should return to original scale after flash phase', () => {
      const component = new DeathAnimationComponent(500, 'flash');
      mockNow = 1300; // 60% progress

      expect(component.getCurrentScale()).toBe(1.0);
    });
  });

  describe('ECS compatibility', () => {
    it('should work with unknown[] constructor args pattern', () => {
      // This tests the ECS component pattern with rest args
      const args: unknown[] = [600, 'flash'];
      const component = new DeathAnimationComponent(...args);

      expect(component.duration).toBe(600);
      expect(component.animationType).toBe('flash');
    });

    it('should handle missing args gracefully', () => {
      const args: unknown[] = [];
      const component = new DeathAnimationComponent(...args);

      expect(component.duration).toBe(500);
      expect(component.animationType).toBe('fade');
    });
  });
});
