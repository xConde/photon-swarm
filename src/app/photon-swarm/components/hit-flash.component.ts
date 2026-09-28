import { Component } from '../core/ecs/ecs.model';

/**
 * Hit flash component - creates a white flash overlay when an entity takes damage
 */
export class HitFlashComponent implements Component {
  public intensity: number;
  public duration: number;
  public startTime: number;
  public color: string;

  constructor(...args: unknown[]) {
    this.intensity = (args[0] as number) ?? 1.0; // 0-1, how bright the flash
    this.duration = (args[1] as number) ?? 100; // Total duration in milliseconds
    this.startTime = (args[2] as number) ?? Date.now(); // When the flash started
    this.color = (args[3] as string) ?? '#ffffff'; // Flash color (default white)
  }

  /**
   * Get current flash intensity based on elapsed time
   */
  getCurrentIntensity(): number {
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.duration) return 0;

    // Quick fade in, slow fade out
    const progress = elapsed / this.duration;
    if (progress < 0.2) {
      // Fade in for first 20%
      return this.intensity * (progress / 0.2);
    } else {
      // Fade out for remaining 80%
      return this.intensity * (1 - (progress - 0.2) / 0.8);
    }
  }

  /**
   * Check if the flash has expired
   */
  isExpired(): boolean {
    return Date.now() - this.startTime >= this.duration;
  }
}
