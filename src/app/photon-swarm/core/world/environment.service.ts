import { Injectable } from '@angular/core';
import { EngineSystem } from '../utils/system';
import { StarfieldSystemService } from '../systems/rendering';
import { ParallaxStarfieldService } from '../engine/parallax-starfield.service';
import { ThemeService } from '@services/theme.service';
import { PaletteService } from '../../services/palette.service';
import { ZoneStateService } from '../systems/world/zone-state.service';

/**
 * Environment Service - handles background rendering and environmental effects
 * Now includes beautiful starfield background for immersive space experience
 * Supports light/dark theme modes following website theme system
 */
@EngineSystem()
@Injectable({ providedIn: 'root' })
export class EnvironmentService {
  /** Cached radial gradient — invalidated when canvas dimensions, theme, or zone changes. */
  private cachedGradient: CanvasGradient | null = null;
  private cachedGradientWidth = 0;
  private cachedGradientHeight = 0;
  private cachedGradientIsDayMode: boolean | null = null;
  /** Zone id used for the current cached gradient — invalidates when zone changes. */
  private cachedGradientZoneId: number | null = -1;

  /**
   * Per-zone hue bias for dark-mode outer gradient stop (≤ 12% mix).
   * Zone 1 = faint warm red, Zone 2 = faint teal, Zone 3 = faint green, Zone 4 = deep purple.
   */
  private static readonly ZONE_TINT: Record<number, string> = {
    1: 'rgba(120,30,20,0.10)', // Zone 1: nebula warm-red
    2: 'rgba(20,80,90,0.10)', // Zone 2: teal
    3: 'rgba(20,80,35,0.10)', // Zone 3: faint green
    4: 'rgba(55,10,80,0.12)', // Zone 4: deep purple
  };

  constructor(
    private starfieldSystem: StarfieldSystemService,
    private parallaxStarfield: ParallaxStarfieldService,
    private themeService: ThemeService,
    private paletteService: PaletteService,
    private zoneState: ZoneStateService
  ) {}

  initialize(_canvas: HTMLCanvasElement, _worldW: number, _worldH: number): void {
    // Reset the gradient cache so renderBackground rebuilds it against the new
    // canvas context on route re-entry. A cached CanvasGradient is bound to the
    // context that created it; reusing it in a new context produces a dead fillStyle.
    this.cachedGradient = null;
    this.cachedGradientWidth = 0;
    this.cachedGradientHeight = 0;
    this.cachedGradientIsDayMode = null;
    this.cachedGradientZoneId = -1;
    this.starfieldSystem.initWithDimensions(_worldW, _worldH);
  }

  /**
   * Renders beautiful background with theme-aware gradient and starfield
   * Dark mode: Deep space void gradient
   * Light mode: Cool slate gradient (Precision & Density aesthetic)
   */
  renderBackground(
    ctx: CanvasRenderingContext2D,
    cameraX?: number,
    cameraY?: number,
    viewWidth?: number,
    viewHeight?: number,
    screenWidth?: number,
    screenHeight?: number
  ): void {
    // CSS screen size (logical px). The gradient + full-screen fill cover the canvas in CSS
    // coordinates; at renderScale < 1 the backing store (ctx.canvas.width) is smaller and would
    // leave an unfilled strip on the right/bottom. Fall back to the backing store if not passed.
    const width = screenWidth ?? ctx.canvas.width;
    const height = screenHeight ?? ctx.canvas.height;
    const isDayMode = this.themeService.isDayMode;
    const currentZoneId = this.zoneState.getCurrentZoneId();

    // Rebuild the gradient only when canvas size, theme, or zone changes.
    if (
      this.cachedGradient === null ||
      this.cachedGradientWidth !== width ||
      this.cachedGradientHeight !== height ||
      this.cachedGradientIsDayMode !== isDayMode ||
      this.cachedGradientZoneId !== currentZoneId
    ) {
      const themeColors = this.paletteService.getPalette();
      const grd = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height));

      if (isDayMode) {
        // Light mode: unchanged
        grd.addColorStop(0, themeColors.BACKGROUND.GRADIENT_START);
        grd.addColorStop(0.5, themeColors.BACKGROUND.GRADIENT_MID);
        grd.addColorStop(1, themeColors.BACKGROUND.GRADIENT_END);
      } else {
        // Dark mode: base gradient + subtle per-zone hue bias on the outer stop
        const zoneTint = currentZoneId !== null ? (EnvironmentService.ZONE_TINT[currentZoneId] ?? null) : null;
        grd.addColorStop(0, themeColors.BACKGROUND.GRADIENT_START);
        grd.addColorStop(0.3, themeColors.BACKGROUND.SECONDARY);
        grd.addColorStop(0.7, themeColors.BACKGROUND.GRADIENT_MID);
        grd.addColorStop(1, themeColors.BACKGROUND.GRADIENT_END);
        // Overlay the zone tint at the outer edge as a second stop slightly inside 1.0
        // so it blends with the base end color rather than replacing it entirely.
        if (zoneTint) {
          grd.addColorStop(0.85, zoneTint);
        }
      }

      this.cachedGradient = grd;
      this.cachedGradientWidth = width;
      this.cachedGradientHeight = height;
      this.cachedGradientIsDayMode = isDayMode;
      this.cachedGradientZoneId = currentZoneId;
    }

    ctx.fillStyle = this.cachedGradient;
    ctx.fillRect(0, 0, width, height);

    // Render parallax starfield layers (depth effect behind world-space stars). Parallax draws
    // in screen space (before the camera transform), so it culls against the CSS SCREEN size;
    // the world-space starfield culls against the zoom-divided world viewport.
    if (cameraX !== undefined && cameraY !== undefined && viewWidth && viewHeight) {
      this.parallaxStarfield.render(ctx, cameraX, cameraY, width, height);
      this.starfieldSystem.renderStarfield(ctx, cameraX, cameraY, viewWidth, viewHeight, isDayMode);
    }
  }

  /**
   * Renders a faint grid for spatial orientation with theme-aware colors
   */
  renderWorld(ctx: CanvasRenderingContext2D, cameraX: number, cameraY: number, viewW: number, viewH: number): void {
    const CELL = 120;
    const themeColors = this.paletteService.getPalette();

    ctx.strokeStyle = themeColors.GAME.GRID_LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const startX = Math.floor(cameraX / CELL) * CELL - cameraX;
    const startY = Math.floor(cameraY / CELL) * CELL - cameraY;
    for (let x = startX; x <= viewW; x += CELL) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, viewH);
    }
    for (let y = startY; y <= viewH; y += CELL) {
      ctx.moveTo(0, y);
      ctx.lineTo(viewW, y);
    }
    ctx.stroke();
  }
}
