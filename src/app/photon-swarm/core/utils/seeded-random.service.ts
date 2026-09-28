import { Injectable } from '@angular/core';

/**
 * Seeded Random Number Generator Service
 *
 * Provides deterministic random number generation using the Park-Miller algorithm.
 * This ensures that the same seed always produces the same sequence of random numbers,
 * which is essential for reproducible territory generation.
 */
@Injectable({
  providedIn: 'root',
})
export class SeededRandomService {
  private seed: number = 1;
  private originalSeed: string = '';

  // Park-Miller constants
  private readonly a = 16807; // 7^5
  private readonly m = 2147483647; // 2^31 - 1 (Mersenne prime)
  private readonly q = 127773; // m / a
  private readonly r = 2836; // m % a

  constructor() {
    // Initialize with current timestamp
    this.setSeed(Date.now().toString());
  }

  /**
   * Set the seed for random number generation
   * @param seed String seed that will be hashed to a number
   */
  setSeed(seed: string): void {
    this.originalSeed = seed;
    this.seed = this.hashSeed(seed);

    if (window.debugLogBridge) {
      window.debugLogBridge.log('SeededRandom: Seed initialized', 'info', {
        originalSeed: seed,
        numericSeed: this.seed,
      });
    }
  }

  /**
   * Get the current seed string
   */
  getSeed(): string {
    return this.originalSeed;
  }

  /**
   * Generate a random number between 0 and 1
   */
  random(): number {
    this.seed = this.nextSeed();
    return (this.seed - 1) / (this.m - 1);
  }

  /**
   * Generate a random integer between min and max (inclusive)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  /**
   * Generate a random float between min and max
   */
  randomFloat(min: number, max: number): number {
    return this.random() * (max - min) + min;
  }

  /**
   * Randomly choose an element from an array
   */
  randomChoice<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[this.randomInt(0, array.length - 1)];
  }

  /**
   * Shuffle an array in place using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Generate a random boolean with optional probability
   */
  randomBoolean(probability: number = 0.5): boolean {
    return this.random() < probability;
  }

  /**
   * Create a new instance with a derived seed
   * Useful for creating independent random streams
   */
  fork(suffix: string): SeededRandomService {
    const forked = new SeededRandomService();
    forked.setSeed(`${this.originalSeed}-${suffix}`);
    return forked;
  }

  /**
   * Hash a string seed to a numeric value
   */
  private hashSeed(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Ensure positive number between 1 and m-1
    return Math.abs(hash % (this.m - 1)) + 1;
  }

  /**
   * Generate next seed using Park-Miller algorithm
   */
  private nextSeed(): number {
    const hi = Math.floor(this.seed / this.q);
    const lo = this.seed % this.q;
    const test = this.a * lo - this.r * hi;

    if (test > 0) {
      this.seed = test;
    } else {
      this.seed = test + this.m;
    }

    return this.seed;
  }

  /**
   * Generate a deterministic world seed based on game parameters
   */
  static generateWorldSeed(timestamp: number, kingCount: number, version: string = '1.0'): string {
    return `${timestamp}-k${kingCount}-v${version}`;
  }

  /**
   * Parse a world seed to extract parameters
   */
  static parseWorldSeed(seed: string): { timestamp: number; kingCount: number; version: string } | null {
    const match = seed.match(/^(\d+)-k(\d+)-v(.+)$/);
    if (!match) return null;

    return {
      timestamp: parseInt(match[1], 10),
      kingCount: parseInt(match[2], 10),
      version: match[3],
    };
  }
}
