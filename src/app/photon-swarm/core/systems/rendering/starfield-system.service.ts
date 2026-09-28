import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { isCoarseTouchDevice } from '../../utils/touch-device.util';
import { WORLD_CONFIG } from '@photon/config/game-constants';

/**
 * Starfield System - renders beautiful background stars
 * Creates an immersive space environment without being distracting
 */
@Injectable({
  providedIn: 'root',
})
export class StarfieldSystemService implements System {
  private stars: Star[] = [];
  private initialized = false;
  private worldWidth = WORLD_CONFIG.BOUNDS.WIDTH;
  private worldHeight = WORLD_CONFIG.BOUNDS.HEIGHT;

  /** Scale star brightness by intensity (1.0 = normal, 1.5 = 50% brighter). */
  intensityBrightnessMultiplier = 1.0;

  /**
   * Frame counter used to throttle the twinkle Math.sin update.
   * Twinkle runs every 3rd frame — imperceptible at the slow twinkle speed
   * (TWINKLE_SPEED = 0.001) while cutting ~6900 sin() calls/frame by 67%.
   */
  private twinkleFrameCount = 0;

  // Star generation parameters
  private readonly STAR_DENSITY = 0.00064; // Stars per square unit (reduced by 20%)
  private readonly MIN_STAR_SIZE = 0.5;
  private readonly MAX_STAR_SIZE = 2.5;
  private readonly TWINKLE_SPEED = 0.001;

  // Star colors for dark mode (variety and immersion)
  private readonly STAR_COLORS_DARK = [
    '#ffffff', // Pure white - most common
    '#f8f8ff', // Ghost white
    '#e6e6fa', // Lavender
    '#ffe4e1', // Misty rose (warm white)
    '#f0f8ff', // Alice blue (cool white)
    '#fdf5e6', // Old lace (warm)
    '#f5f5dc', // Beige (warm)
  ];

  // Star colors for light mode (solid colors - opacity handled by globalAlpha)
  private readonly STAR_COLORS_LIGHT = [
    '#2f4f4f', // Dark slate - most common
    '#3a5a5a', // Medium slate
    '#4a6a6a', // Lighter slate
    '#5f7f7f', // Muted teal
  ];

  constructor() {}

  init(_entityManager: EntityManager): void {
    if (this.initialized) return;

    // Use default world dimensions or get from game engine if available
    this.generateStars();
    this.initialized = true;
  }

  /**
   * Initialize with specific world dimensions
   */
  initWithDimensions(worldWidth: number, worldHeight: number): void {
    if (this.initialized) return;

    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.generateStars();
    this.initialized = true;
  }

  update(_deltaTime: number, _entityManager: EntityManagerService): void {
    // Throttle twinkle updates to every 3rd frame — TWINKLE_SPEED (0.001) is so
    // slow (~1 cycle per ~6 seconds) that skipping 2 of 3 frames is imperceptible
    // while cutting ~6900 Math.sin calls/frame by 67%.
    this.twinkleFrameCount = (this.twinkleFrameCount + 1) % 3;
    if (this.twinkleFrameCount !== 0) {
      return;
    }

    // Update star twinkle animations
    const currentTime = window.performance.now();

    for (const star of this.stars) {
      // Create subtle twinkle effect
      star.opacity = 0.3 + 0.4 * Math.sin(currentTime * this.TWINKLE_SPEED + star.phase);

      // Ensure opacity stays within reasonable bounds
      star.opacity = Math.max(0.1, Math.min(0.8, star.opacity));
    }
  }

  /**
   * Render the starfield as a background layer
   * Supports light/dark mode for theme-aware rendering
   */
  renderStarfield(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewWidth: number,
    viewHeight: number,
    isDayMode: boolean = false,
    scale: number = 1
  ): void {
    if (!this.initialized) return;

    ctx.save();
    const padding = 200;
    const leftBound = cameraX - padding;
    const rightBound = cameraX + viewWidth + padding;
    const topBound = cameraY - padding;
    const bottomBound = cameraY + viewHeight + padding;

    // PERF (dominant mobile cost): set fillStyle + globalAlpha ONCE for the whole field instead
    // of per star. Each per-star state change forces a mobile-GPU tile-render flush (hundreds to
    // thousands per frame). Batching to a single state-set + plain fillRect makes the starfield
    // nearly free. Stars keep per-size variation (the fillRect dimension carries depth); the
    // slight loss of per-star colour/opacity twinkle is invisible at this scale.
    ctx.fillStyle = isDayMode ? this.STAR_COLORS_LIGHT[0] : '#ffffff';
    ctx.globalAlpha = isDayMode
      ? Math.min(1, 0.6 * this.intensityBrightnessMultiplier)
      : Math.min(1, 0.5 * this.intensityBrightnessMultiplier);

    for (const star of this.stars) {
      if (star.x < leftBound || star.x > rightBound || star.y < topBound || star.y > bottomBound) {
        continue;
      }
      const scaledSize = star.size * scale;
      const px = scaledSize < 1 ? 1 : Math.max(1, Math.round(scaledSize));
      ctx.fillRect(star.x - cameraX, star.y - cameraY, px, px);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Generate stars distributed across the world
   */
  private generateStars(): void {
    this.stars = [];

    const totalArea = this.worldWidth * this.worldHeight;
    // Each visible star sets fillStyle+globalAlpha (a mobile-GPU tile flush). Halve the count on
    // touch devices to roughly halve those per-frame state changes; desktop keeps full density.
    const isTouch = isCoarseTouchDevice();
    // The render loop linearly scans EVERY star for viewport culling (~34k at 0.5x). A quarter of
    // full density still reads as a star field at phone scale while halving that per-frame scan.
    const density = isTouch ? this.STAR_DENSITY * 0.25 : this.STAR_DENSITY;
    const starCount = Math.floor(totalArea * density);

    for (let i = 0; i < starCount; i++) {
      const star: Star = {
        x: Math.random() * this.worldWidth,
        y: Math.random() * this.worldHeight,
        size: this.MIN_STAR_SIZE + Math.random() * (this.MAX_STAR_SIZE - this.MIN_STAR_SIZE),
        color: this.getRandomStarColor(),
        opacity: 0.3 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2, // Random phase for twinkle
        type: this.getStarType(),
      };

      this.stars.push(star);
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log(
        `Generated ${starCount} stars for ${this.worldWidth}x${this.worldHeight} world`,
        'info',
        {
          source: 'starfield_system',
          operation: 'generate_stars',
          starCount,
          worldWidth: this.worldWidth,
          worldHeight: this.worldHeight,
        }
      );
    }
  }

  /**
   * Get a random star color weighted towards white/neutral tones
   */
  private getRandomStarColor(): string {
    if (Math.random() < 0.7) {
      return '#ffffff';
    }

    const colorIndex = Math.floor(Math.random() * this.STAR_COLORS_DARK.length);
    return this.STAR_COLORS_DARK[colorIndex];
  }

  /**
   * Determine star type based on size
   */
  private getStarType(): 'tiny' | 'small' | 'medium' | 'large' {
    const size = this.stars.length > 0 ? this.stars[this.stars.length - 1]?.size || 1 : 1;

    if (size < 0.8) return 'tiny';
    if (size < 1.3) return 'small';
    if (size < 2.0) return 'medium';
    return 'large';
  }

  /** Scale star brightness by intensity (1.0 = normal, 2.0 = max). */
  setIntensityBrightnessMultiplier(value: number): void {
    this.intensityBrightnessMultiplier = Math.max(1.0, Math.min(2.0, value));
  }

  /**
   * Get star count for debugging
   */
  getStarCount(): number {
    return this.stars.length;
  }

  /**
   * Get visible star count for performance monitoring
   */
  getVisibleStarCount(cameraX: number, cameraY: number, viewWidth: number, viewHeight: number): number {
    const padding = 200;
    const leftBound = cameraX - padding;
    const rightBound = cameraX + viewWidth + padding;
    const topBound = cameraY - padding;
    const bottomBound = cameraY + viewHeight + padding;

    let count = 0;
    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      if (star.x >= leftBound && star.x <= rightBound && star.y >= topBound && star.y <= bottomBound) {
        count++;
      }
    }
    return count;
  }
}

/**
 * Star interface
 */
interface Star {
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  phase: number; // For twinkle animation
  type: 'tiny' | 'small' | 'medium' | 'large';
}
