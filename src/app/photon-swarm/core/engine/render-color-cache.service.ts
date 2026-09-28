// Extracted from GameRenderingService (Campaign D — god-service decomp). Pure color conversion +
// memoization: hex→rgb, light-mode darken, rgba string caching. Shared cache usable by all renderers.

import { Injectable } from '@angular/core';
import { ThemeService } from '@services/theme.service';

@Injectable({ providedIn: 'root' })
export class RenderColorCacheService {
  /**
   * Safety cap for the HEX-KEYED caches (rgbCache, darkenCache). Their keys are hex
   * color strings — a small, mostly-fixed palette — so 512 comfortably holds the set.
   */
  private static readonly CACHE_SIZE_CAP = 512;

  /**
   * Tighter cap for the rgba cache. Its key space is much larger — every distinct
   * (r, g, b, alpha-bucket) combination, including animated opacity — so it grows
   * faster than the hex caches; a smaller cap bounds memory more aggressively.
   */
  private static readonly RGBA_CACHE_SIZE_CAP = 256;

  // hexToRgb cache: static regex + result memoization
  private static readonly HEX_REGEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

  /**
   * Memoization cache for `hexToRgb()`. Hex color strings rarely change between frames,
   * so caching the parsed {r,g,b} avoids redundant regex + parseInt work every frame.
   */
  private readonly rgbCache = new Map<string, { r: number; g: number; b: number }>();

  private readonly darkenCache = new Map<string, string>();

  /** Pre-bucketed rgba string cache — avoids per-particle string allocation in render loops */
  private rgbaCache = new Map<string, string>();

  constructor(private themeService: ThemeService) {}

  /**
   * Convert hex color to RGB object (cached)
   */
  public hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const cached = this.rgbCache.get(hex);
    if (cached) return cached;

    const result = RenderColorCacheService.HEX_REGEX.exec(hex);
    if (!result) return null;

    const rgb = {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
    if (this.rgbCache.size >= RenderColorCacheService.CACHE_SIZE_CAP) {
      this.rgbCache.clear();
    }
    this.rgbCache.set(hex, rgb);
    return rgb;
  }

  /**
   * Darken a hex color by 40% for light mode visibility on the cream background.
   * Returns the input unchanged in dark mode or if hex parsing fails (rgb() strings).
   */
  public darkenForLightMode(hexColor: string): string {
    if (!this.themeService.isDayMode) return hexColor;

    const cached = this.darkenCache.get(hexColor);
    if (cached) return cached;

    const rgb = this.hexToRgb(hexColor);
    if (!rgb) return hexColor;

    // Convert to HSL to preserve hue while adjusting lightness and saturation.
    // Simple darkening (multiply RGB) makes all colors converge to the same murky tone.
    // Instead: keep hue, boost saturation, reduce lightness for vibrant dark-on-light colors.
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }

    // Target: 35-45% lightness (readable on cream #f8fafc), high saturation for differentiation
    const newL = Math.min(0.42, l * 0.55);
    const newS = Math.min(1, s * 1.3 + 0.15); // boost saturation

    // HSL → RGB
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q2 = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
    const p2 = 2 * newL - q2;
    const rr = Math.round(hue2rgb(p2, q2, h + 1 / 3) * 255);
    const gg = Math.round(hue2rgb(p2, q2, h) * 255);
    const bb = Math.round(hue2rgb(p2, q2, h - 1 / 3) * 255);
    const result = `rgb(${rr},${gg},${bb})`;

    if (this.darkenCache.size >= RenderColorCacheService.CACHE_SIZE_CAP) this.darkenCache.clear();
    this.darkenCache.set(hexColor, result);
    return result;
  }

  public cachedRgba(r: number, g: number, b: number, a: number): string {
    // Bucket alpha to 0.05 increments so animated opacity still caches effectively
    const ba = Math.round(a * 20) / 20;
    const key = `${r},${g},${b},${ba}`;
    let cached = this.rgbaCache.get(key);
    if (!cached) {
      if (this.rgbaCache.size > RenderColorCacheService.RGBA_CACHE_SIZE_CAP) this.rgbaCache.clear();
      cached = `rgba(${r}, ${g}, ${b}, ${ba})`;
      this.rgbaCache.set(key, cached);
    }
    return cached;
  }

  /**
   * Clear all three caches managed by this service.
   * Called from GameRenderingService.clearRenderCaches() to preserve existing cache-clearing behaviour.
   */
  public clearCaches(): void {
    this.rgbCache.clear();
    this.darkenCache.clear();
    this.rgbaCache.clear();
  }
}
