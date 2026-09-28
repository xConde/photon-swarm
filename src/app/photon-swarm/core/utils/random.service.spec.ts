import { TestBed } from '@angular/core/testing';
import { RandomService } from './random.service';

describe('RandomService', () => {
  let service: RandomService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RandomService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('seed management', () => {
    it('should set and get seed correctly', () => {
      const testSeed = 12345;
      service.setSeed(testSeed);
      expect(service.getSeed()).toBe(testSeed.toString());
    });

    it('should clear sequence when seed is set', () => {
      service.setSequence([0.1, 0.2, 0.3]);
      service.setSeed(12345);
      // Should not use predetermined sequence after seed is set
      expect(service.random()).not.toBe(0.1);
    });
  });

  describe('random number generation', () => {
    it('should generate numbers between 0 and 1', () => {
      for (let i = 0; i < 100; i++) {
        const value = service.random();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });

    it('should use predetermined sequence when set', () => {
      const sequence = [0.1, 0.5, 0.9];
      service.setSequence(sequence);

      expect(service.random()).toBe(0.1);
      expect(service.random()).toBe(0.5);
      expect(service.random()).toBe(0.9);
      // After sequence is exhausted, should fall back to Math.random
      expect(service.random()).not.toBe(0.1);
    });

    it('preserves zero in a predetermined sequence', () => {
      service.setSequence([0, 0.25]);

      expect(service.random()).toBe(0);
      expect(service.random()).toBe(0.25);
    });
  });

  describe('randomInt', () => {
    it('should generate integers within range', () => {
      for (let i = 0; i < 100; i++) {
        const value = service.randomInt(1, 10);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThan(10);
      }
    });

    it('should handle edge cases', () => {
      expect(service.randomInt(5, 5)).toBe(5); // min equals max
      expect(service.randomInt(0, 1)).toBe(0); // single value range
    });
  });

  describe('randomRange', () => {
    it('should generate numbers within range', () => {
      for (let i = 0; i < 100; i++) {
        const value = service.randomRange(10, 20);
        expect(value).toBeGreaterThanOrEqual(10);
        expect(value).toBeLessThan(20);
      }
    });
  });

  describe('randomChoice', () => {
    it('should select random element from array', () => {
      const array = ['a', 'b', 'c'];
      const choice = service.randomChoice(array);
      expect(array).toContain(choice);
    });

    it('should throw error for empty array', () => {
      expect(() => service.randomChoice([])).toThrowError('Cannot choose from empty array');
    });
  });

  describe('shuffle', () => {
    it('should shuffle array without modifying original', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = service.shuffle(original);

      expect(shuffled.length).toBe(original.length);
      expect([...shuffled].sort()).toEqual([...original].sort());
      expect(original).toEqual([1, 2, 3, 4, 5]); // Original unchanged
    });

    it('should handle single element array', () => {
      const array = [1];
      const shuffled = service.shuffle(array);
      expect(shuffled).toEqual(array);
    });
  });

  describe('randomAngle', () => {
    it('should generate angles between 0 and 2π', () => {
      for (let i = 0; i < 100; i++) {
        const angle = service.randomAngle();
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThan(2 * Math.PI);
      }
    });
  });

  describe('randomPointInCircle', () => {
    it('should generate points within circle', () => {
      const centerX = 100;
      const centerY = 100;
      const radius = 50;

      for (let i = 0; i < 100; i++) {
        const point = service.randomPointInCircle(centerX, centerY, radius);
        const distance = Math.sqrt(Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2));
        expect(distance).toBeLessThanOrEqual(radius);
      }
    });
  });

  describe('randomPointInRect', () => {
    it('should generate points within rectangle', () => {
      const x = 10;
      const y = 20;
      const width = 100;
      const height = 50;

      for (let i = 0; i < 100; i++) {
        const point = service.randomPointInRect(x, y, width, height);
        expect(point.x).toBeGreaterThanOrEqual(x);
        expect(point.x).toBeLessThan(x + width);
        expect(point.y).toBeGreaterThanOrEqual(y);
        expect(point.y).toBeLessThan(y + height);
      }
    });
  });

  describe('chance', () => {
    it('should return boolean based on probability', () => {
      // Test with predetermined sequence
      service.setSequence([0.1, 0.5, 0.9]);

      expect(service.chance(0.2)).toBe(true); // 0.1 < 0.2
      expect(service.chance(0.2)).toBe(false); // 0.5 > 0.2
      expect(service.chance(0.2)).toBe(false); // 0.9 > 0.2
    });

    it('should handle edge cases', () => {
      service.setSequence([0, 1]);
      expect(service.chance(0)).toBe(false); // 0 >= 0, should be false
      expect(service.chance(1)).toBe(false); // 1 >= 1, should be false
    });
  });

  describe('randomDirection', () => {
    it('should generate normalized direction vectors', () => {
      for (let i = 0; i < 100; i++) {
        const direction = service.randomDirection();
        const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
        expect(magnitude).toBeCloseTo(1, 10);
      }
    });
  });

  describe('sequence management', () => {
    it('should set and clear sequence correctly', () => {
      const sequence = [0.1, 0.2];
      service.setSequence(sequence);

      expect(service.random()).toBe(0.1);
      expect(service.random()).toBe(0.2);

      service.clearSequence();
      // Should not use predetermined values after clearing
      expect(service.random()).not.toBe(0.1);
    });
  });
});
