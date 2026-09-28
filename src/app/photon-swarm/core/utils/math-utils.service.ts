import { Injectable } from '@angular/core';

/**
 * Mathematical utility functions commonly used in game development
 * Provides optimized and standardized math operations for the game
 */
@Injectable({
  providedIn: 'root',
})
export class MathUtilsService {
  // =============================================================================
  // DISTANCE AND GEOMETRY
  // =============================================================================

  /**
   * Calculate Euclidean distance between two points
   */
  static distance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate squared distance (faster, no sqrt)
   */
  static distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  /**
   * Calculate Manhattan distance between two points
   */
  static manhattanDistance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
  }

  /**
   * Check if point is within circle
   */
  static isPointInCircle(px: number, py: number, cx: number, cy: number, radius: number): boolean {
    return this.distanceSquared(px, py, cx, cy) <= radius * radius;
  }

  /**
   * Check if two circles overlap
   */
  static circlesOverlap(x1: number, y1: number, r1: number, x2: number, y2: number, r2: number): boolean {
    const minDistance = r1 + r2;
    return this.distanceSquared(x1, y1, x2, y2) <= minDistance * minDistance;
  }

  // =============================================================================
  // ANGLES AND ROTATION
  // =============================================================================

  /**
   * Calculate angle between two points in radians
   */
  static angleBetween(x1: number, y1: number, x2: number, y2: number): number {
    return Math.atan2(y2 - y1, x2 - x1);
  }

  /**
   * Calculate angle between two points in degrees
   */
  static angleBetweenDegrees(x1: number, y1: number, x2: number, y2: number): number {
    return (this.angleBetween(x1, y1, x2, y2) * 180) / Math.PI;
  }

  /**
   * Normalize angle to range [0, 2π]
   */
  static normalizeAngle(angle: number): number {
    while (angle < 0) angle += 2 * Math.PI;
    while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
    return angle;
  }

  /**
   * Calculate shortest angular difference between two angles
   */
  static angleDifference(angle1: number, angle2: number): number {
    const diff = angle2 - angle1;
    const normalizedDiff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
    return normalizedDiff;
  }

  /**
   * Rotate point around another point
   */
  static rotatePoint(px: number, py: number, cx: number, cy: number, angle: number): { x: number; y: number } {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = px - cx;
    const dy = py - cy;

    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  // =============================================================================
  // INTERPOLATION AND EASING
  // =============================================================================

  /**
   * Linear interpolation
   */
  static lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
  }

  /**
   * Smooth step interpolation
   */
  static smoothStep(start: number, end: number, t: number): number {
    t = this.clamp(t, 0, 1);
    t = t * t * (3 - 2 * t);
    return this.lerp(start, end, t);
  }

  /**
   * Smoother step interpolation
   */
  static smootherStep(start: number, end: number, t: number): number {
    t = this.clamp(t, 0, 1);
    t = t * t * t * (t * (t * 6 - 15) + 10);
    return this.lerp(start, end, t);
  }

  /**
   * Exponential ease out
   */
  static easeOutExpo(t: number): number {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  // =============================================================================
  // UTILITY FUNCTIONS
  // =============================================================================

  /**
   * Clamp value between min and max
   */
  static clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Map value from one range to another
   */
  static map(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
    return toMin + ((value - fromMin) * (toMax - toMin)) / (fromMax - fromMin);
  }

  /**
   * Check if value is approximately equal (within epsilon)
   */
  static approximately(a: number, b: number, epsilon: number = 0.0001): boolean {
    return Math.abs(a - b) < epsilon;
  }

  /**
   * Sign function (-1, 0, or 1)
   */
  static sign(value: number): number {
    return value > 0 ? 1 : value < 0 ? -1 : 0;
  }

  /**
   * Random number between min and max (inclusive)
   */
  static randomRange(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }

  /**
   * Random integer between min and max (inclusive)
   */
  static randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Random point on unit circle
   */
  static randomCirclePoint(): { x: number; y: number } {
    const angle = Math.random() * 2 * Math.PI;
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };
  }

  /**
   * Random point inside unit circle
   */
  static randomCirclePointInside(): { x: number; y: number } {
    const angle = Math.random() * 2 * Math.PI;
    const radius = Math.sqrt(Math.random());
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  }

  // =============================================================================
  // VECTOR OPERATIONS
  // =============================================================================

  /**
   * Normalize a 2D vector
   */
  static normalize(x: number, y: number): { x: number; y: number } {
    const length = Math.sqrt(x * x + y * y);
    if (length === 0) return { x: 0, y: 0 };
    return { x: x / length, y: y / length };
  }

  /**
   * Calculate dot product of two 2D vectors
   */
  static dot(x1: number, y1: number, x2: number, y2: number): number {
    return x1 * x2 + y1 * y2;
  }

  /**
   * Calculate cross product of two 2D vectors (returns scalar)
   */
  static cross(x1: number, y1: number, x2: number, y2: number): number {
    return x1 * y2 - y1 * x2;
  }

  /**
   * Reflect vector across a normal
   */
  static reflect(vx: number, vy: number, nx: number, ny: number): { x: number; y: number } {
    const dot = this.dot(vx, vy, nx, ny);
    return {
      x: vx - 2 * dot * nx,
      y: vy - 2 * dot * ny,
    };
  }

  // =============================================================================
  // GAME-SPECIFIC FUNCTIONS
  // =============================================================================

  /**
   * Calculate movement with diagonal speed compensation
   */
  static calculateMovement(
    horizontal: number,
    vertical: number,
    speed: number,
    diagonalFactor: number = 1 / Math.sqrt(2)
  ): { x: number; y: number } {
    if (horizontal !== 0 && vertical !== 0) {
      // Diagonal movement
      return {
        x: horizontal * speed * diagonalFactor,
        y: vertical * speed * diagonalFactor,
      };
    } else {
      // Straight movement
      return {
        x: horizontal * speed,
        y: vertical * speed,
      };
    }
  }

  /**
   * Calculate screen wrapping position
   */
  static wrapPosition(x: number, y: number, width: number, height: number): { x: number; y: number } {
    return {
      x: ((x % width) + width) % width,
      y: ((y % height) + height) % height,
    };
  }

  /**
   * Calculate damage with distance falloff
   */
  static calculateDamageWithFalloff(
    baseDamage: number,
    distance: number,
    maxRange: number,
    falloffCurve: number = 2
  ): number {
    if (distance >= maxRange) return 0;
    const falloff = Math.pow(1 - distance / maxRange, falloffCurve);
    return baseDamage * falloff;
  }
}

// =============================================================================
// VECTOR2D CLASS
// =============================================================================

/**
 * 2D Vector class with common operations
 */
export class Vector2D {
  constructor(
    public x: number = 0,
    public y: number = 0
  ) {}

  // Static creation methods
  static zero(): Vector2D {
    return new Vector2D(0, 0);
  }
  static one(): Vector2D {
    return new Vector2D(1, 1);
  }
  static up(): Vector2D {
    return new Vector2D(0, -1);
  }
  static down(): Vector2D {
    return new Vector2D(0, 1);
  }
  static left(): Vector2D {
    return new Vector2D(-1, 0);
  }
  static right(): Vector2D {
    return new Vector2D(1, 0);
  }

  // Instance methods
  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  normalize(): Vector2D {
    const mag = this.magnitude();
    if (mag === 0) return Vector2D.zero();
    return new Vector2D(this.x / mag, this.y / mag);
  }

  add(other: Vector2D): Vector2D {
    return new Vector2D(this.x + other.x, this.y + other.y);
  }

  subtract(other: Vector2D): Vector2D {
    return new Vector2D(this.x - other.x, this.y - other.y);
  }

  multiply(scalar: number): Vector2D {
    return new Vector2D(this.x * scalar, this.y * scalar);
  }

  divide(scalar: number): Vector2D {
    return new Vector2D(this.x / scalar, this.y / scalar);
  }

  dot(other: Vector2D): number {
    return this.x * other.x + this.y * other.y;
  }

  cross(other: Vector2D): number {
    return this.x * other.y - this.y * other.x;
  }

  distanceTo(other: Vector2D): number {
    return MathUtilsService.distance(this.x, this.y, other.x, other.y);
  }

  angleTo(other: Vector2D): number {
    return MathUtilsService.angleBetween(this.x, this.y, other.x, other.y);
  }

  clone(): Vector2D {
    return new Vector2D(this.x, this.y);
  }

  toString(): string {
    return `Vector2D(${this.x.toFixed(2)}, ${this.y.toFixed(2)})`;
  }
}
