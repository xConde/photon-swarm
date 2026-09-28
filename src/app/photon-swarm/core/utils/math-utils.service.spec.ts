import { MathUtilsService, Vector2D } from './math-utils.service';

describe('MathUtilsService', () => {
  describe('Distance and Geometry', () => {
    it('should calculate Euclidean distance correctly', () => {
      expect(MathUtilsService.distance(0, 0, 3, 4)).toBe(5);
      expect(MathUtilsService.distance(0, 0, 0, 0)).toBe(0);
      expect(MathUtilsService.distance(1, 1, 4, 5)).toBe(5);
    });

    it('should calculate squared distance correctly', () => {
      expect(MathUtilsService.distanceSquared(0, 0, 3, 4)).toBe(25);
      expect(MathUtilsService.distanceSquared(0, 0, 0, 0)).toBe(0);
    });

    it('distance() is identical to inline Math.sqrt(dx*dx+dy*dy)', () => {
      const cases: [number, number, number, number][] = [
        [0, 0, 3, 4],
        [10, 20, 13, 24],
        [-5, -5, 5, 5],
        [100, 200, 100, 200], // zero distance
        [0, 0, -3, -4],
      ];
      for (const [x1, y1, x2, y2] of cases) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const inline = Math.sqrt(dx * dx + dy * dy);
        const shared = MathUtilsService.distance(x1, y1, x2, y2);
        expect(shared).toBe(inline, `distance(${x1},${y1},${x2},${y2})`);
      }
    });

    it('distance() is identical to inline Math.sqrt(Math.pow(dx,2)+Math.pow(dy,2))', () => {
      const cases: [number, number, number, number][] = [
        [0, 0, 5, 12],
        [3, 4, 6, 8],
        [-10, 0, 10, 0],
      ];
      for (const [x1, y1, x2, y2] of cases) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const inlinePow = Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
        const shared = MathUtilsService.distance(x1, y1, x2, y2);
        expect(shared).toBe(inlinePow, `distance(${x1},${y1},${x2},${y2})`);
      }
    });

    it('should calculate Manhattan distance correctly', () => {
      expect(MathUtilsService.manhattanDistance(0, 0, 3, 4)).toBe(7);
      expect(MathUtilsService.manhattanDistance(1, 2, 4, 6)).toBe(7);
    });

    it('should check if point is in circle', () => {
      expect(MathUtilsService.isPointInCircle(0, 0, 0, 0, 5)).toBeTrue();
      expect(MathUtilsService.isPointInCircle(3, 4, 0, 0, 5)).toBeTrue(); // On edge
      expect(MathUtilsService.isPointInCircle(6, 0, 0, 0, 5)).toBeFalse();
    });

    it('should check if circles overlap', () => {
      expect(MathUtilsService.circlesOverlap(0, 0, 5, 8, 0, 5)).toBeTrue();
      expect(MathUtilsService.circlesOverlap(0, 0, 5, 0, 0, 5)).toBeTrue(); // Same center
      expect(MathUtilsService.circlesOverlap(0, 0, 2, 10, 0, 2)).toBeFalse();
    });
  });

  describe('Angles and Rotation', () => {
    it('should calculate angle between points', () => {
      expect(MathUtilsService.angleBetween(0, 0, 1, 0)).toBeCloseTo(0);
      expect(MathUtilsService.angleBetween(0, 0, 0, 1)).toBeCloseTo(Math.PI / 2);
      expect(MathUtilsService.angleBetween(0, 0, -1, 0)).toBeCloseTo(Math.PI);
    });

    it('should calculate angle in degrees', () => {
      expect(MathUtilsService.angleBetweenDegrees(0, 0, 1, 0)).toBeCloseTo(0);
      expect(MathUtilsService.angleBetweenDegrees(0, 0, 0, 1)).toBeCloseTo(90);
    });

    it('should normalize angle to [0, 2π]', () => {
      expect(MathUtilsService.normalizeAngle(0)).toBe(0);
      expect(MathUtilsService.normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI);
      expect(MathUtilsService.normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    });

    it('should calculate angle difference', () => {
      expect(MathUtilsService.angleDifference(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
      expect(MathUtilsService.angleDifference(0, -Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    });

    it('should rotate point around center', () => {
      const result = MathUtilsService.rotatePoint(1, 0, 0, 0, Math.PI / 2);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });
  });

  describe('Interpolation and Easing', () => {
    it('should perform linear interpolation', () => {
      expect(MathUtilsService.lerp(0, 10, 0)).toBe(0);
      expect(MathUtilsService.lerp(0, 10, 1)).toBe(10);
      expect(MathUtilsService.lerp(0, 10, 0.5)).toBe(5);
    });

    it('should perform smooth step interpolation', () => {
      expect(MathUtilsService.smoothStep(0, 10, 0)).toBe(0);
      expect(MathUtilsService.smoothStep(0, 10, 1)).toBe(10);
      expect(MathUtilsService.smoothStep(0, 10, 0.5)).toBe(5);
    });

    it('should clamp smooth step input', () => {
      expect(MathUtilsService.smoothStep(0, 10, -1)).toBe(0);
      expect(MathUtilsService.smoothStep(0, 10, 2)).toBe(10);
    });

    it('should perform exponential ease out', () => {
      expect(MathUtilsService.easeOutExpo(0)).toBeCloseTo(0);
      expect(MathUtilsService.easeOutExpo(1)).toBe(1);
      expect(MathUtilsService.easeOutExpo(0.5)).toBeGreaterThan(0.5); // Ease out is faster at start
    });
  });

  describe('Utility Functions', () => {
    it('should clamp value between min and max', () => {
      expect(MathUtilsService.clamp(5, 0, 10)).toBe(5);
      expect(MathUtilsService.clamp(-5, 0, 10)).toBe(0);
      expect(MathUtilsService.clamp(15, 0, 10)).toBe(10);
    });

    it('should map value from one range to another', () => {
      expect(MathUtilsService.map(5, 0, 10, 0, 100)).toBe(50);
      expect(MathUtilsService.map(0, 0, 10, 100, 200)).toBe(100);
      expect(MathUtilsService.map(10, 0, 10, 100, 200)).toBe(200);
    });

    it('should check approximate equality', () => {
      expect(MathUtilsService.approximately(1.0, 1.00001)).toBeTrue();
      expect(MathUtilsService.approximately(1.0, 1.1)).toBeFalse();
      expect(MathUtilsService.approximately(1.0, 1.05, 0.1)).toBeTrue();
    });

    it('should return correct sign', () => {
      expect(MathUtilsService.sign(5)).toBe(1);
      expect(MathUtilsService.sign(-5)).toBe(-1);
      expect(MathUtilsService.sign(0)).toBe(0);
    });

    it('should generate random range values', () => {
      for (let i = 0; i < 100; i++) {
        const value = MathUtilsService.randomRange(5, 10);
        expect(value).toBeGreaterThanOrEqual(5);
        expect(value).toBeLessThan(10);
      }
    });

    it('should generate random integers', () => {
      for (let i = 0; i < 100; i++) {
        const value = MathUtilsService.randomInt(1, 5);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
        expect(Number.isInteger(value)).toBeTrue();
      }
    });

    it('should generate random point on unit circle', () => {
      for (let i = 0; i < 10; i++) {
        const point = MathUtilsService.randomCirclePoint();
        const magnitude = Math.sqrt(point.x * point.x + point.y * point.y);
        expect(magnitude).toBeCloseTo(1);
      }
    });

    it('should generate random point inside unit circle', () => {
      for (let i = 0; i < 10; i++) {
        const point = MathUtilsService.randomCirclePointInside();
        const magnitude = Math.sqrt(point.x * point.x + point.y * point.y);
        expect(magnitude).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Vector Operations', () => {
    it('should normalize vectors', () => {
      const result = MathUtilsService.normalize(3, 4);
      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);
    });

    it('should return zero for zero vector normalization', () => {
      const result = MathUtilsService.normalize(0, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('should calculate dot product', () => {
      expect(MathUtilsService.dot(1, 0, 0, 1)).toBe(0); // Perpendicular
      expect(MathUtilsService.dot(1, 0, 1, 0)).toBe(1); // Parallel
      expect(MathUtilsService.dot(3, 4, 2, 1)).toBe(10);
    });

    it('should calculate cross product', () => {
      expect(MathUtilsService.cross(1, 0, 0, 1)).toBe(1);
      expect(MathUtilsService.cross(1, 0, 1, 0)).toBe(0); // Parallel
    });

    it('should reflect vector across normal', () => {
      const result = MathUtilsService.reflect(1, -1, 0, 1);
      expect(result.x).toBeCloseTo(1);
      expect(result.y).toBeCloseTo(1);
    });
  });

  describe('Game-Specific Functions', () => {
    it('should calculate straight movement', () => {
      const result = MathUtilsService.calculateMovement(1, 0, 10);
      expect(result.x).toBe(10);
      expect(result.y).toBe(0);
    });

    it('should calculate diagonal movement with compensation', () => {
      const result = MathUtilsService.calculateMovement(1, 1, 10);
      const expectedSpeed = 10 / Math.sqrt(2);
      expect(result.x).toBeCloseTo(expectedSpeed);
      expect(result.y).toBeCloseTo(expectedSpeed);
    });

    it('should wrap position correctly', () => {
      expect(MathUtilsService.wrapPosition(150, 250, 100, 200)).toEqual({ x: 50, y: 50 });
      expect(MathUtilsService.wrapPosition(-10, -20, 100, 200)).toEqual({ x: 90, y: 180 });
    });

    it('should calculate damage with falloff', () => {
      expect(MathUtilsService.calculateDamageWithFalloff(100, 0, 100)).toBe(100);
      expect(MathUtilsService.calculateDamageWithFalloff(100, 100, 100)).toBe(0);
      expect(MathUtilsService.calculateDamageWithFalloff(100, 50, 100)).toBeCloseTo(25); // Linear falloff^2
    });
  });
});

describe('Vector2D', () => {
  describe('Static creation methods', () => {
    it('should create zero vector', () => {
      const v = Vector2D.zero();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('should create unit vectors', () => {
      expect(Vector2D.up()).toEqual(new Vector2D(0, -1));
      expect(Vector2D.down()).toEqual(new Vector2D(0, 1));
      expect(Vector2D.left()).toEqual(new Vector2D(-1, 0));
      expect(Vector2D.right()).toEqual(new Vector2D(1, 0));
      expect(Vector2D.one()).toEqual(new Vector2D(1, 1));
    });
  });

  describe('Instance methods', () => {
    it('should calculate magnitude', () => {
      expect(new Vector2D(3, 4).magnitude()).toBe(5);
      expect(new Vector2D(0, 0).magnitude()).toBe(0);
    });

    it('should calculate magnitude squared', () => {
      expect(new Vector2D(3, 4).magnitudeSquared()).toBe(25);
    });

    it('should normalize vector', () => {
      const v = new Vector2D(3, 4).normalize();
      expect(v.x).toBeCloseTo(0.6);
      expect(v.y).toBeCloseTo(0.8);
    });

    it('should return zero for zero vector normalization', () => {
      const v = new Vector2D(0, 0).normalize();
      expect(v.x).toBe(0);
      expect(v.y).toBe(0);
    });

    it('should add vectors', () => {
      const result = new Vector2D(1, 2).add(new Vector2D(3, 4));
      expect(result).toEqual(new Vector2D(4, 6));
    });

    it('should subtract vectors', () => {
      const result = new Vector2D(5, 6).subtract(new Vector2D(3, 4));
      expect(result).toEqual(new Vector2D(2, 2));
    });

    it('should multiply by scalar', () => {
      const result = new Vector2D(2, 3).multiply(3);
      expect(result).toEqual(new Vector2D(6, 9));
    });

    it('should divide by scalar', () => {
      const result = new Vector2D(6, 9).divide(3);
      expect(result).toEqual(new Vector2D(2, 3));
    });

    it('should calculate dot product', () => {
      expect(new Vector2D(1, 2).dot(new Vector2D(3, 4))).toBe(11);
    });

    it('should calculate cross product', () => {
      expect(new Vector2D(1, 2).cross(new Vector2D(3, 4))).toBe(-2);
    });

    it('should calculate distance to another vector', () => {
      expect(new Vector2D(0, 0).distanceTo(new Vector2D(3, 4))).toBe(5);
    });

    it('should calculate angle to another vector', () => {
      expect(new Vector2D(0, 0).angleTo(new Vector2D(1, 0))).toBe(0);
    });

    it('should clone vector', () => {
      const v = new Vector2D(1, 2);
      const clone = v.clone();
      expect(clone).toEqual(v);
      expect(clone).not.toBe(v);
    });

    it('should convert to string', () => {
      expect(new Vector2D(1.234, 5.678).toString()).toBe('Vector2D(1.23, 5.68)');
    });
  });
});
