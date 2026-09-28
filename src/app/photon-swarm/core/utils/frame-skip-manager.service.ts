import { Injectable } from '@angular/core';

/**
 * Frame Skip Manager
 *
 * Optimizes performance by allowing expensive operations to run less frequently
 * while maintaining smooth gameplay for critical systems.
 */
@Injectable({ providedIn: 'root' })
export class FrameSkipManagerService {
  private frameCounters = new Map<string, number>();
  private skipRates = new Map<string, number>();
  private currentMultiplier = 1;

  // Default skip rates for different system types
  private readonly DEFAULT_SKIP_RATES = {
    CRITICAL: 1, // Every frame (60 FPS)
    HIGH: 2, // Every 2nd frame (30 FPS)
    MEDIUM: 4, // Every 4th frame (15 FPS)
    LOW: 8, // Every 8th frame (7.5 FPS)
    BACKGROUND: 16, // Every 16th frame (3.75 FPS)
  };

  // System-specific optimal rates based on testing
  private readonly SYSTEM_RATES = {
    // Critical - needs every frame
    collision: this.DEFAULT_SKIP_RATES.CRITICAL,
    movement: this.DEFAULT_SKIP_RATES.CRITICAL,
    projectile: this.DEFAULT_SKIP_RATES.CRITICAL,

    // High priority - can skip occasional frames
    'enemy-movement': this.DEFAULT_SKIP_RATES.HIGH,
    'weapon-firing': this.DEFAULT_SKIP_RATES.HIGH,
    'death-detection': this.DEFAULT_SKIP_RATES.HIGH,

    // Medium priority - less frequent updates OK
    'ai-behavior': this.DEFAULT_SKIP_RATES.MEDIUM,
    'territory-effect': this.DEFAULT_SKIP_RATES.MEDIUM,
    'faction-standing': this.DEFAULT_SKIP_RATES.MEDIUM,
    'buff-management': this.DEFAULT_SKIP_RATES.MEDIUM,
    'idle-behavior': this.DEFAULT_SKIP_RATES.MEDIUM,
    'npc-ability': this.DEFAULT_SKIP_RATES.MEDIUM,
    'npc-faction-battle': this.DEFAULT_SKIP_RATES.MEDIUM,
    environment: this.DEFAULT_SKIP_RATES.MEDIUM,

    // Low priority - infrequent updates fine
    minimap: this.DEFAULT_SKIP_RATES.LOW,
    territory: this.DEFAULT_SKIP_RATES.LOW,
    'territory-strength': this.DEFAULT_SKIP_RATES.LOW,
    'territory-warfare': this.DEFAULT_SKIP_RATES.LOW,
    'four-kings-territory': this.DEFAULT_SKIP_RATES.LOW,
    spawn: this.DEFAULT_SKIP_RATES.LOW,

    // Background - very infrequent
    'performance-monitor': this.DEFAULT_SKIP_RATES.BACKGROUND,
    'save-game': this.DEFAULT_SKIP_RATES.BACKGROUND,
  };

  constructor() {
    this.initializeSkipRates();
  }

  /**
   * Initialize skip rates for all known systems
   */
  private initializeSkipRates(): void {
    Object.entries(this.SYSTEM_RATES).forEach(([system, rate]) => {
      this.skipRates.set(system, rate);
      this.frameCounters.set(system, 0);
    });
  }

  /**
   * Check if a system should run this frame
   */
  shouldRun(systemName: string): boolean {
    // If not configured, default to running every frame
    if (!this.skipRates.has(systemName)) {
      return true;
    }

    const skipRate = this.skipRates.get(systemName) ?? 1;
    const counter = this.frameCounters.get(systemName) || 0;

    // Increment counter
    this.frameCounters.set(systemName, counter + 1);

    // Check if we should run
    if (counter % skipRate === 0) {
      // Reset counter to prevent overflow
      if (counter > 1000000) {
        this.frameCounters.set(systemName, 0);
      }
      return true;
    }

    return false;
  }

  /**
   * Dynamic adjustment based on current FPS
   */
  adjustForPerformance(currentFPS: number, targetFPS: number = 60): void {
    const performanceRatio = currentFPS / targetFPS;
    let newMultiplier: number;

    if (performanceRatio < 0.5) {
      // Very poor performance (<30 FPS) - increase skip rates significantly
      newMultiplier = 2;
    } else if (performanceRatio < 0.75) {
      // Poor performance (<45 FPS) - slightly increase skip rates
      newMultiplier = 1.5;
    } else {
      // Acceptable performance (45+ FPS) - restore normal rates
      newMultiplier = 1;
    }

    // Only apply if multiplier changed — prevents redundant Map iteration
    if (newMultiplier !== this.currentMultiplier) {
      this.currentMultiplier = newMultiplier;
      this.applyPerformanceMultiplier(newMultiplier);
    }
  }

  /**
   * Apply a multiplier to all skip rates
   */
  private applyPerformanceMultiplier(multiplier: number): void {
    Object.entries(this.SYSTEM_RATES).forEach(([system, baseRate]) => {
      const newRate = Math.max(1, Math.round(baseRate * multiplier));
      this.skipRates.set(system, newRate);
    });
  }

  /**
   * Get skip rate for a system
   */
  getSkipRate(systemName: string): number {
    return this.skipRates.get(systemName) || 1;
  }

  /**
   * Set custom skip rate for a system
   */
  setSkipRate(systemName: string, rate: number): void {
    this.skipRates.set(systemName, Math.max(1, rate));
    this.frameCounters.set(systemName, 0);
  }

  /**
   * Get performance statistics
   */
  getStats(): { system: string; rate: number; fps: number }[] {
    const stats: { system: string; rate: number; fps: number }[] = [];

    this.skipRates.forEach((rate, system) => {
      stats.push({
        system,
        rate,
        fps: 60 / rate,
      });
    });

    return stats.sort((a, b) => a.rate - b.rate);
  }

  /**
   * Reset all counters and rates to defaults
   */
  reset(): void {
    this.frameCounters.clear();
    this.skipRates.clear();
    this.currentMultiplier = 1;
    this.initializeSkipRates();
  }
}
