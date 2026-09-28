import { Component } from '../core/ecs/ecs.model';

/**
 * Component for floating text effects (damage numbers, etc)
 */
export class FloatingTextComponent implements Component {
  public text: string;
  public color: string;
  public fontSize: number;
  public duration: number; // milliseconds
  public startTime: number;
  public offsetX: number;
  public offsetY: number; // Start above the entity
  public velocityX: number;
  public velocityY: number; // Float upward
  public fadeStart: number; // Start fading at 70% of duration
  public scale: number;
  // Pre-parsed RGB values for performance (avoid string manipulation in render loop)
  public colorR: number;
  public colorG: number;
  public colorB: number;

  constructor(...args: unknown[]) {
    this.text = (args[0] as string) ?? '';
    this.color = (args[1] as string) ?? '#ffffff';
    this.fontSize = (args[2] as number) ?? 16;
    this.duration = (args[3] as number) ?? 1000;
    this.startTime = (args[4] as number) ?? window.performance.now();
    this.offsetX = (args[5] as number) ?? 0;
    this.offsetY = (args[6] as number) ?? -20;
    this.velocityX = (args[7] as number) ?? 0;
    this.velocityY = (args[8] as number) ?? -50;
    this.fadeStart = (args[9] as number) ?? 0.7;
    this.scale = (args[10] as number) ?? 1;

    // Pre-parse color to RGB components for fast rgba construction in render loop
    const rgb = this.parseColor(this.color);
    this.colorR = rgb.r;
    this.colorG = rgb.g;
    this.colorB = rgb.b;
  }

  /**
   * Parse color string (hex or rgb) to RGB components
   * Done once at creation time to avoid string manipulation in render loop
   */
  private parseColor(color: string): { r: number; g: number; b: number } {
    // Handle hex colors (#ffffff, #fff, etc.)
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        // Short form: #fff -> #ffffff
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
        };
      } else {
        // Long form: #ffffff
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
        };
      }
    }

    // Handle rgb/rgba strings: rgb(255, 255, 255) or rgba(255, 255, 255, 0.5)
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return {
        r: parseInt(match[1], 10),
        g: parseInt(match[2], 10),
        b: parseInt(match[3], 10),
      };
    }

    // Default to white if parsing fails
    return { r: 255, g: 255, b: 255 };
  }

  /**
   * Get current opacity based on lifetime
   */
  getOpacity(currentTime: number): number {
    const elapsed = currentTime - this.startTime;
    const progress = elapsed / this.duration;

    if (progress >= 1) return 0;
    if (progress < this.fadeStart) return 1;

    // Fade out in the last portion
    const fadeProgress = (progress - this.fadeStart) / (1 - this.fadeStart);
    return 1 - fadeProgress;
  }

  /**
   * Check if the text should be removed
   */
  isExpired(currentTime: number): boolean {
    return currentTime - this.startTime >= this.duration;
  }
}
