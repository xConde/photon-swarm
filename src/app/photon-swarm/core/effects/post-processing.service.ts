import { Injectable } from '@angular/core';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

export interface ChromaticAberrationConfig {
  intensity: number; // 0-1, where 1 is maximum shift
  duration: number; // Duration in milliseconds
  fadeOut: boolean; // Whether to fade out over time
}

export interface VignetteConfig {
  intensity: number; // 0-1, where 1 is maximum vignette
  duration: number; // Duration in milliseconds
  fadeOut: boolean; // Whether to fade out over time
}

export interface BloomConfig {
  intensity: number; // 0-1, where 1 is maximum bloom
  duration: number; // Duration in milliseconds
  fadeOut: boolean; // Whether to fade out over time
}

export interface ScreenFlashConfig {
  color: { r: number; g: number; b: number };
  opacity: number;
  duration: number;
}

export type VignetteState = 'none' | 'normal' | 'danger' | 'focus_fire' | 'blackout';

type EffectConfig = ChromaticAberrationConfig | VignetteConfig | BloomConfig;

interface ActiveEffect {
  type: 'chromaticAberration' | 'vignette' | 'bloom';
  config: EffectConfig;
  startTime: number;
  intensity: number;
}

interface ScreenFlash {
  color: { r: number; g: number; b: number };
  /**
   * PERF: Pre-built rgb(r,g,b) string, set once at addScreenFlash() time.
   * Avoids building a new string on every rendered frame.
   */
  rgbString: string;
  opacity: number;
  duration: number;
  startTime: number;
}

/**
 * Service to handle post-processing visual effects
 */
@Injectable({
  providedIn: 'root',
})
export class PostProcessingService {
  private activeEffects: ActiveEffect[] = [];

  // Half-resolution canvas for chromatic aberration (4x fewer pixels = ~4x faster)
  private halfResCanvas: HTMLCanvasElement | null = null;
  private halfResCtx: CanvasRenderingContext2D | null = null;
  private halfResSourceWidth = 0;
  private halfResSourceHeight = 0;

  // PERF: Pre-allocated output ImageData reused every frame — avoids ~2 MB alloc per active frame.
  // Re-allocated only when halfW/halfH change (canvas resize).
  private cachedOutputImageData: ImageData | null = null;
  private cachedOutputWidth = 0;
  private cachedOutputHeight = 0;

  // Screen flash state
  private activeFlashes: ScreenFlash[] = [];
  private lastFlashTime = 0;

  // Vignette state
  private vignetteState: VignetteState = 'none';
  private cachedVignetteGradient: CanvasGradient | null = null;
  private cachedVignetteWidth = 0;
  private cachedVignetteHeight = 0;
  private cachedVignetteState: VignetteState = 'none';

  constructor(private debugLog: DebugLogBridgeService) {}

  /**
   * Add chromatic aberration effect (color channel separation)
   */
  addChromaticAberration(config: Partial<ChromaticAberrationConfig>): void {
    const fullConfig: ChromaticAberrationConfig = {
      intensity: config.intensity || 0.5,
      duration: config.duration || 300,
      fadeOut: config.fadeOut !== false,
    };

    this.activeEffects.push({
      type: 'chromaticAberration',
      config: fullConfig,
      startTime: window.performance.now(),
      intensity: fullConfig.intensity,
    });

    // Log chromatic aberration effect
    this.debugLog.log('🎨 Chromatic aberration effect added', 'info', {
      source: 'post_processing',
      operation: 'add_chromatic_aberration',
      intensity: fullConfig.intensity,
      duration: fullConfig.duration,
      fadeOut: fullConfig.fadeOut,
      activeEffects: this.activeEffects.length,
    });
  }

  /**
   * Apply post-processing effects to the canvas
   */
  applyEffects(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const currentTime = window.performance.now();

    // Update and filter active effects
    this.activeEffects = this.activeEffects.filter((effect) => {
      const elapsed = currentTime - effect.startTime;
      const progress = elapsed / effect.config.duration;

      if (progress >= 1) {
        // Clean up half-res canvas when the last chromatic aberration effect completes
        if (
          effect.type === 'chromaticAberration' &&
          this.activeEffects.filter((e) => e.type === 'chromaticAberration').length === 1
        ) {
          this.halfResCanvas = null;
          this.halfResCtx = null;
          this.halfResSourceWidth = 0;
          this.halfResSourceHeight = 0;
          this.cachedOutputImageData = null;
          this.cachedOutputWidth = 0;
          this.cachedOutputHeight = 0;
        }
        return false;
      }

      // Update intensity with fade
      if (effect.config.fadeOut) {
        effect.intensity = effect.config.intensity * (1 - progress);
      }

      return true;
    });

    // Post-processing is a full-screen, screen-space pass. Only when rendering sub-native (touch
    // resolution scaling, renderScale < 1) reset the transform to identity so the full-screen
    // fills cover the whole backing store instead of leaving a stale strip. On desktop the
    // inherited transform is left exactly as before — byte-identical behavior.
    const subNative = canvas.width < (parseFloat(canvas.style.width) || canvas.width);
    ctx.save();
    if (subNative) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Apply chromatic aberration if active
    const chromaticEffect = this.activeEffects.find((e) => e.type === 'chromaticAberration');
    if (chromaticEffect && chromaticEffect.intensity > 0.01) {
      // Skip if intensity is too low
      this.applyChromaticAberration(ctx, canvas, chromaticEffect.intensity);
    }

    // Apply screen flashes
    this.applyScreenFlashes(ctx, canvas);

    // Apply vignette
    this.applyVignette(ctx, canvas);

    ctx.restore();
  }

  /**
   * Apply chromatic aberration effect at half resolution.
   *
   * Full-canvas getImageData + pixel loop at 1920×1080 costs ~30–45ms.
   * By downscaling to half resolution first (GPU-accelerated drawImage), the pixel
   * buffer is 4× smaller, cutting read/process/write time to ~8–12ms total.
   * The slight blur introduced by the downscale/upscale round-trip enhances the
   * distortion look rather than detracting from it.
   */
  private applyChromaticAberration(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, intensity: number): void {
    // Early exit if intensity is too low
    if (intensity < 0.01) return;

    const halfW = Math.ceil(canvas.width / 2);
    const halfH = Math.ceil(canvas.height / 2);

    try {
      // Lazy-create or resize the half-resolution canvas
      if (
        !this.halfResCanvas ||
        this.halfResSourceWidth !== canvas.width ||
        this.halfResSourceHeight !== canvas.height
      ) {
        this.halfResCanvas = document.createElement('canvas');
        this.halfResCanvas.width = halfW;
        this.halfResCanvas.height = halfH;
        this.halfResCtx = this.halfResCanvas.getContext('2d', {
          willReadFrequently: true,
        });
        this.halfResSourceWidth = canvas.width;
        this.halfResSourceHeight = canvas.height;
      }

      if (!this.halfResCtx) return;

      // GPU-accelerated downscale: draw the full canvas into the half-res canvas (~1ms)
      this.halfResCtx.clearRect(0, 0, halfW, halfH);
      this.halfResCtx.drawImage(canvas, 0, 0, halfW, halfH);

      // Read half-res pixels (4× fewer than full canvas)
      const imageData = this.halfResCtx.getImageData(0, 0, halfW, halfH);
      const data = imageData.data;

      // Calculate shift amount based on intensity — operate in half-res coordinates
      // (original was intensity*5 at full res; half that keeps the same visual shift)
      const maxShift = Math.max(1, Math.floor(intensity * 2.5));

      // Only apply effect if there's a meaningful shift
      if (maxShift > 0) {
        // PERF: Reuse the pre-allocated ImageData buffer; re-allocate only on canvas resize.
        if (!this.cachedOutputImageData || this.cachedOutputWidth !== halfW || this.cachedOutputHeight !== halfH) {
          this.cachedOutputImageData = this.halfResCtx.createImageData(halfW, halfH);
          this.cachedOutputWidth = halfW;
          this.cachedOutputHeight = halfH;
        }
        const outputData = this.cachedOutputImageData;
        const output = outputData.data;

        // Apply chromatic aberration over the smaller pixel grid
        for (let y = 0; y < halfH; y++) {
          for (let x = 0; x < halfW; x++) {
            const idx = (y * halfW + x) * 4;

            // Red channel - shift left
            const redX = Math.max(0, x - maxShift);
            const redIdx = (y * halfW + redX) * 4;
            output[idx] = data[redIdx];

            // Green channel - no shift
            output[idx + 1] = data[idx + 1];

            // Blue channel - shift right
            const blueX = Math.min(halfW - 1, x + maxShift);
            const blueIdx = (y * halfW + blueX) * 4;
            output[idx + 2] = data[blueIdx + 2];

            // Alpha channel
            output[idx + 3] = data[idx + 3];
          }
        }

        // Write processed data back to the half-res canvas
        this.halfResCtx.putImageData(outputData, 0, 0);

        // GPU-accelerated upscale back to the main canvas (~1ms); slight blur enhances the effect
        ctx.save();
        ctx.globalAlpha = Math.min(1, intensity * 1.5); // Fade based on intensity
        ctx.drawImage(this.halfResCanvas, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1.0;
        ctx.restore();
      }
    } catch (error) {
      // If there's any error, clean up and log
      this.debugLog.log('Error applying chromatic aberration', 'error', {
        source: 'post_processing',
        operation: 'chromatic_aberration_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.halfResCanvas = null;
      this.halfResCtx = null;
      this.halfResSourceWidth = 0;
      this.halfResSourceHeight = 0;
      this.cachedOutputImageData = null;
      this.cachedOutputWidth = 0;
      this.cachedOutputHeight = 0;
    }
  }

  /**
   * Add screen flash effect — a full-screen color overlay that fades out.
   */
  addScreenFlash(config: ScreenFlashConfig): void {
    // Throttle: ignore flashes requested within 50ms of the last one
    const now = window.performance.now();
    if (now - this.lastFlashTime < 50) return;
    this.lastFlashTime = now;

    const { r, g, b } = config.color;
    this.activeFlashes.push({
      color: config.color,
      // PERF: Pre-build rgb string once at enqueue time — avoids per-frame template-literal allocation
      rgbString: `rgb(${r},${g},${b})`,
      opacity: config.opacity,
      duration: config.duration,
      startTime: window.performance.now(),
    });

    this.debugLog.log('Screen flash added', 'info', {
      source: 'post_processing',
      operation: 'add_screen_flash',
      color: config.color,
      opacity: config.opacity,
      duration: config.duration,
      activeFlashes: this.activeFlashes.length,
    });
  }

  /**
   * Set the vignette rendering state.
   * - 'none':       no vignette
   * - 'normal':     faint dark edges (constant)
   * - 'danger':     red pulsing edges (low health)
   * - 'focus_fire': subtle orange-tinted edges (Focus Fire active)
   */
  setVignetteState(state: VignetteState): void {
    if (state === this.vignetteState) return;
    this.vignetteState = state;
    // Invalidate cached gradient so it rebuilds with the new color
    this.cachedVignetteGradient = null;
  }

  /**
   * Toggle the subtle orange vignette for Focus Fire mode.
   * Does not override 'danger' state — danger takes priority.
   */
  setFocusFireVignette(active: boolean): void {
    if (this.vignetteState === 'danger') return; // danger takes priority
    const target: VignetteState = active ? 'focus_fire' : 'none';
    this.setVignetteState(target);
  }

  /**
   * Clear all active effects
   */
  clear(): void {
    this.activeEffects = [];
    this.activeFlashes = [];
    this.vignetteState = 'none';
    this.cachedVignetteGradient = null;
    // Also clear half-res canvas and cached ImageData to free memory
    this.halfResCanvas = null;
    this.halfResCtx = null;
    this.halfResSourceWidth = 0;
    this.halfResSourceHeight = 0;
    this.cachedOutputImageData = null;
    this.cachedOutputWidth = 0;
    this.cachedOutputHeight = 0;
  }

  /**
   * Check if any effects are active
   */
  hasActiveEffects(): boolean {
    return this.activeEffects.length > 0 || this.activeFlashes.length > 0 || this.vignetteState !== 'none';
  }

  /**
   * Preset effects
   */
  static readonly PRESETS = {
    LIGHT_DAMAGE: {
      intensity: 0.3,
      duration: 200,
      fadeOut: true,
    },

    MEDIUM_DAMAGE: {
      intensity: 0.6,
      duration: 300,
      fadeOut: true,
    },

    HEAVY_DAMAGE: {
      intensity: 1.0,
      duration: 500,
      fadeOut: true,
    },

    CRITICAL_HIT: {
      intensity: 0.8,
      duration: 150,
      fadeOut: true,
    },
  };

  /** Screen flash presets for common gameplay events */
  static readonly FLASH_PRESETS = {
    /** White flash on critical hit — subtle, 100ms */
    CRITICAL_HIT: { color: { r: 255, g: 255, b: 255 }, opacity: 0.15, duration: 100 },
    /** Red flash on player damage — 150ms */
    PLAYER_DAMAGE: { color: { r: 255, g: 40, b: 40 }, opacity: 0.2, duration: 150 },
    /** Gold flash on level-up — 200ms */
    LEVEL_UP: { color: { r: 255, g: 215, b: 0 }, opacity: 0.25, duration: 200 },
  } as const;

  // ── Private rendering helpers ──────────────────────────────────────────

  /**
   * Render and advance all active screen flashes.
   * Each flash is a full-canvas rect that linearly fades from its initial opacity to 0.
   */
  private applyScreenFlashes(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.activeFlashes.length === 0) return;
    const now = window.performance.now();

    this.activeFlashes = this.activeFlashes.filter((flash) => {
      const elapsed = now - flash.startTime;
      if (elapsed >= flash.duration) return false;

      const progress = elapsed / flash.duration;
      const currentOpacity = flash.opacity * (1 - progress);
      if (currentOpacity < 0.005) return false;

      // PERF: Use pre-cached rgb string — no per-frame template-literal allocation
      ctx.save();
      ctx.globalAlpha = currentOpacity;
      ctx.fillStyle = flash.rgbString;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      return true;
    });
  }

  /**
   * Render the vignette overlay.
   * Uses a cached radial gradient when the canvas size and state haven't changed.
   */
  private applyVignette(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.vignetteState === 'none') return;

    const w = canvas.width;
    const h = canvas.height;

    // For the danger state, the pulsing opacity means we always redraw (cheap — just fillStyle).
    // For the normal state, we cache the gradient object.
    const needsNewGradient =
      !this.cachedVignetteGradient ||
      this.cachedVignetteWidth !== w ||
      this.cachedVignetteHeight !== h ||
      this.cachedVignetteState !== this.vignetteState;

    if (needsNewGradient) {
      this.buildVignetteGradient(ctx, w, h);
    }

    if (!this.cachedVignetteGradient) return;

    ctx.save();

    if (this.vignetteState === 'danger') {
      // Pulse between 0.3 and 0.5 using a sine wave (~2 Hz)
      const t = window.performance.now() / 500; // period ≈ 1s full cycle at / 500
      const pulse = 0.3 + 0.2 * ((Math.sin(t * Math.PI * 2) + 1) / 2);
      ctx.globalAlpha = pulse;
    } else if (this.vignetteState === 'focus_fire') {
      // Subtle orange vignette — constant low opacity, not distracting
      ctx.globalAlpha = 0.1;
    } else if (this.vignetteState === 'blackout') {
      // Heavy edge fog — full opacity, cached gradient handles the falloff
      ctx.globalAlpha = 1.0;
    } else {
      // 'normal' — constant faint vignette
      ctx.globalAlpha = 0.1;
    }

    ctx.fillStyle = this.cachedVignetteGradient;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  /**
   * Build and cache the radial gradient used for the vignette.
   */
  private buildVignetteGradient(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.sqrt(cx * cx + cy * cy);

    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, radius);

    if (this.vignetteState === 'danger') {
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.6, 'rgba(80,0,0,0.3)');
      gradient.addColorStop(1, 'rgba(120,0,0,0.8)');
    } else if (this.vignetteState === 'focus_fire') {
      // Subtle orange-tinted edges — amber color (#ff8c00) at low opacity
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.65, 'rgba(180,80,0,0.2)');
      gradient.addColorStop(1, 'rgba(255,140,0,0.7)');
    } else if (this.vignetteState === 'blackout') {
      // Heavy dark purple-black fog — center visible, edges nearly opaque
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.35, 'rgba(10,5,20,0.3)');
      gradient.addColorStop(0.6, 'rgba(10,5,20,0.65)');
      gradient.addColorStop(1.0, 'rgba(10,5,20,0.95)');
    } else {
      // 'normal'
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(0.7, 'rgba(0,0,0,0.15)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
    }

    this.cachedVignetteGradient = gradient;
    this.cachedVignetteWidth = w;
    this.cachedVignetteHeight = h;
    this.cachedVignetteState = this.vignetteState;
  }
}
