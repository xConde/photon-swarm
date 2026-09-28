import { Injectable } from '@angular/core';
import { SeededRandomService } from './seeded-random.service';
import { GameSystemError } from './error-handler.service';

/**
 * Seedable random number generator service
 * Replaces Math.random() usage throughout the game engine
 * Now uses deterministic SeededRandomService for reproducible results
 */
@Injectable({ providedIn: 'root' })
export class RandomService {
  private rngSequence: number[] = [];

  constructor(private seededRandom: SeededRandomService) {}

  /**
   * Set the seed for deterministic random generation
   */
  setSeed(seed: number | string): void {
    const seedStr = typeof seed === 'number' ? seed.toString() : seed;
    this.seededRandom.setSeed(seedStr);
    this.rngSequence = [];
  }

  /**
   * Get current seed value
   */
  getSeed(): string {
    return this.seededRandom.getSeed();
  }

  /**
   * Generate a random number between 0 and 1
   */
  random(): number {
    if (this.rngSequence.length > 0) {
      const queuedValue = this.rngSequence.shift();
      return queuedValue ?? this.seededRandom.random();
    }
    return this.seededRandom.random();
  }

  /**
   * Generate a random integer between min (inclusive) and max (exclusive)
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min)) + min;
  }

  /**
   * Generate a random number between min and max
   */
  randomRange(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  /**
   * Choose a random element from an array
   */
  randomChoice<T>(array: T[]): T {
    if (array.length === 0) {
      throw new GameSystemError('Cannot choose from empty array', 'RandomService');
    }
    return array[this.randomInt(0, array.length)];
  }

  /**
   * Shuffle an array in place using Fisher-Yates algorithm
   */
  shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Generate a random angle in radians (0 to 2π)
   */
  randomAngle(): number {
    return this.random() * Math.PI * 2;
  }

  /**
   * Generate a random point within a circle
   */
  randomPointInCircle(centerX: number, centerY: number, radius: number): { x: number; y: number } {
    const angle = this.randomAngle();
    const distance = this.random() * radius;
    return {
      x: centerX + Math.cos(angle) * distance,
      y: centerY + Math.sin(angle) * distance,
    };
  }

  /**
   * Generate a random point within a rectangle
   */
  randomPointInRect(x: number, y: number, width: number, height: number): { x: number; y: number } {
    return {
      x: x + this.random() * width,
      y: y + this.random() * height,
    };
  }

  /**
   * Weighted random selection
   */
  weightedChoice<T>(choices: Array<{ value: T; weight: number }>): T {
    const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0);
    let random = this.random() * totalWeight;

    for (const choice of choices) {
      random -= choice.weight;
      if (random <= 0) {
        return choice.value;
      }
    }

    return choices[choices.length - 1].value;
  }

  /**
   * Check if a random event occurs with given probability
   */
  chance(probability: number): boolean {
    return this.random() < probability;
  }

  /**
   * Generate a random direction vector
   */
  randomDirection(): { x: number; y: number } {
    const angle = this.randomAngle();
    return {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };
  }

  /**
   * Add a sequence of predetermined random numbers for testing
   */
  setSequence(sequence: number[]): void {
    this.rngSequence = [...sequence];
  }

  /**
   * Clear any predetermined sequence
   */
  clearSequence(): void {
    this.rngSequence = [];
  }

  /**
   * Create a forked random instance with a derived seed
   * Useful for independent random streams (e.g., per-king generation)
   */
  fork(suffix: string): SeededRandomService {
    return this.seededRandom.fork(suffix);
  }
}
