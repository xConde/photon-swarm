import { Injectable } from '@angular/core';

export interface ShakeConfig {
  intensity: number; // Maximum displacement in pixels
  duration: number; // Duration in milliseconds
  frequency: number; // Shake frequency (higher = more jittery)
  fadeOut: boolean; // Whether to fade out over time
  direction?: 'both' | 'horizontal' | 'vertical'; // Shake direction
}

interface ActiveShake {
  config: ShakeConfig;
  startTime: number;
  currentOffset: { x: number; y: number };
}

/**
 * Service to handle camera shake effects for impacts and explosions
 */
@Injectable({
  providedIn: 'root',
})
export class CameraShakeService {
  private activeShakes: ActiveShake[] = [];
  private combinedOffset = { x: 0, y: 0 };

  // Maximum combined shake to prevent motion sickness from multi-kills
  private readonly MAX_COMBINED_SHAKE = 30;

  constructor() {}

  /**
   * Add a screen shake effect
   */
  addShake(config: Partial<ShakeConfig>): void {
    const fullConfig: ShakeConfig = {
      intensity: config.intensity || 10,
      duration: config.duration || 200,
      frequency: config.frequency || 30,
      fadeOut: config.fadeOut !== false,
      direction: config.direction || 'both',
    };

    this.activeShakes.push({
      config: fullConfig,
      startTime: window.performance.now(),
      currentOffset: { x: 0, y: 0 },
    });

    // Log shake for debug
    if (window.debugLogBridge) {
      window.debugLogBridge.log('Camera shake added', 'info', {
        source: 'camera_shake',
        intensity: fullConfig.intensity,
        duration: fullConfig.duration,
        activeShakes: this.activeShakes.length,
      });
    }
  }

  /**
   * Add trauma-based shake (more realistic, accumulative)
   */
  addTrauma(trauma: number): void {
    // Trauma is 0-1, where 1 is maximum shake
    const intensity = trauma * 20; // Max 20px displacement
    const duration = 300 + trauma * 200; // 300-500ms

    this.addShake({
      intensity,
      duration,
      frequency: 40,
      fadeOut: true,
    });
  }

  /**
   * Update shake calculations
   */
  update(): void {
    const currentTime = window.performance.now();

    // Reset combined offset
    this.combinedOffset.x = 0;
    this.combinedOffset.y = 0;

    // Update each active shake
    this.activeShakes = this.activeShakes.filter((shake) => {
      const elapsed = currentTime - shake.startTime;
      const progress = elapsed / shake.config.duration;

      // Remove completed shakes
      if (progress >= 1) {
        return false;
      }

      // Calculate intensity with fade out
      let currentIntensity = shake.config.intensity;
      if (shake.config.fadeOut) {
        // Exponential fade out for more impact
        currentIntensity *= Math.pow(1 - progress, 2);
      }

      // Calculate shake offset using perlin-like noise
      const shakeX = (Math.random() - 0.5) * 2;
      const shakeY = (Math.random() - 0.5) * 2;

      // Apply frequency
      const frequencyMultiplier = Math.sin(elapsed * shake.config.frequency * 0.01);

      // Apply direction constraints
      if (shake.config.direction === 'horizontal') {
        shake.currentOffset.x = shakeX * currentIntensity * frequencyMultiplier;
        shake.currentOffset.y = 0;
      } else if (shake.config.direction === 'vertical') {
        shake.currentOffset.x = 0;
        shake.currentOffset.y = shakeY * currentIntensity * frequencyMultiplier;
      } else {
        shake.currentOffset.x = shakeX * currentIntensity * frequencyMultiplier;
        shake.currentOffset.y = shakeY * currentIntensity * frequencyMultiplier;
      }

      // Add to combined offset
      this.combinedOffset.x += shake.currentOffset.x;
      this.combinedOffset.y += shake.currentOffset.y;

      return true;
    });

    // Cap combined shake to prevent motion sickness from multi-kills
    this.combinedOffset.x = Math.max(
      -this.MAX_COMBINED_SHAKE,
      Math.min(this.MAX_COMBINED_SHAKE, this.combinedOffset.x)
    );
    this.combinedOffset.y = Math.max(
      -this.MAX_COMBINED_SHAKE,
      Math.min(this.MAX_COMBINED_SHAKE, this.combinedOffset.y)
    );
  }

  /**
   * Get current camera offset.
   * Returns the shared field directly — callers must read it immediately and
   * must not retain the reference across frames (combinedOffset is mutated by update()).
   */
  getOffset(): { x: number; y: number } {
    return this.combinedOffset;
  }

  /**
   * Check if any shake is active
   */
  isShaking(): boolean {
    return this.activeShakes.length > 0;
  }

  /**
   * Clear all active shakes
   */
  clear(): void {
    this.activeShakes = [];
    this.combinedOffset = { x: 0, y: 0 };
  }

  /**
   * Preset shake effects
   */
  static readonly PRESETS = {
    // Small hit
    LIGHT_HIT: {
      intensity: 3,
      duration: 100,
      frequency: 30,
    },

    // Normal enemy hit
    MEDIUM_HIT: {
      intensity: 6,
      duration: 150,
      frequency: 35,
    },

    // Critical hit or heavy damage
    HEAVY_HIT: {
      intensity: 12,
      duration: 250,
      frequency: 40,
    },

    // Explosion
    EXPLOSION: {
      intensity: 20,
      duration: 400,
      frequency: 50,
    },

    // Player damage
    PLAYER_DAMAGE: {
      intensity: 15,
      duration: 300,
      frequency: 45,
      direction: 'horizontal' as const,
    },

    // Boss impact
    BOSS_SLAM: {
      intensity: 25,
      duration: 500,
      frequency: 25,
      direction: 'vertical' as const,
    },
  };
}
