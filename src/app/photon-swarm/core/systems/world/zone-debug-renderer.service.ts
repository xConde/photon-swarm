import { Injectable } from '@angular/core';

import { ZoneConfigService } from './zone-config.service';

/**
 * ZoneDebugRendererService
 *
 * Renders zone boundary rectangles and labels in world-space when debug mode is
 * active. Draws on top of all other world-space content so boundaries are always
 * clearly visible.
 *
 * PERFORMANCE:
 * - All color strings and arrays are pre-allocated in the constructor.
 * - No string concatenation, template literals, or object creation in the render loop.
 * - Viewport culling skips off-screen zones before any draw calls.
 * - No ctx.save()/restore(), no shadowBlur (per performance-rules.md).
 */
@Injectable({ providedIn: 'root' })
export class ZoneDebugRendererService {
  /** Pre-allocated dash array — reused on every setLineDash call. */
  private readonly dashArray: number[] = [8, 8];

  /** Pre-allocated empty array — reused to reset line dash. */
  private readonly emptyDash: number[] = [];

  /** Pre-cached fill colors (rgba at 0.3 alpha) for each zone boundary rect. */
  private readonly zoneColors: string[];

  /** Pre-cached stroke/label colors (rgba at 0.8 alpha) for each zone label. */
  private readonly zoneLabelColors: string[];

  /** Pre-cached subtle border colors for always-on zone boundary display. */
  private readonly zoneBorderColors: string[];

  constructor(private readonly zoneConfig: ZoneConfigService) {
    const zones = this.zoneConfig.getAllZones();
    this.zoneColors = new Array<string>(zones.length);
    this.zoneLabelColors = new Array<string>(zones.length);

    this.zoneBorderColors = new Array<string>(zones.length);
    for (let i = 0; i < zones.length; i++) {
      const rgb = ZoneDebugRendererService.hexToRgbParts(zones[i].themeColor);
      this.zoneColors[i] = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
      this.zoneLabelColors[i] = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)`;
      this.zoneBorderColors[i] = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`;
    }
  }

  /**
   * Render dashed zone boundary rectangles and name labels.
   * Must be called while the canvas is in world-space (camera transform applied).
   *
   * @param ctx   Active 2D rendering context.
   * @param cameraX  Top-left world-space X of the viewport.
   * @param cameraY  Top-left world-space Y of the viewport.
   * @param zoom  Current camera zoom/scale factor.
   * @param debugMode  When false, renders subtle boundary lines only (no labels or fills).
   */
  renderZoneBoundaries(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    zoom: number,
    debugMode: boolean,
    cssWidth?: number,
    cssHeight?: number
  ): void {
    const zones = this.zoneConfig.getAllZones();
    // CSS (logical) viewport — at renderScale < 1 ctx.canvas.width is the smaller sub-native
    // backing store and would cull always-visible zone boundary lines before the screen edge.
    const viewportW = (cssWidth ?? ctx.canvas.width) / zoom;
    const viewportH = (cssHeight ?? ctx.canvas.height) / zoom;

    // Always render subtle zone boundary lines
    ctx.lineWidth = 1;
    ctx.setLineDash(this.dashArray);

    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const { bounds } = zone;

      // Viewport culling
      if (
        bounds.x + bounds.width < cameraX ||
        bounds.x > cameraX + viewportW ||
        bounds.y + bounds.height < cameraY ||
        bounds.y > cameraY + viewportH
      ) {
        continue;
      }

      const wx = bounds.x;
      const wy = bounds.y;
      const ww = bounds.width;
      const wh = bounds.height;

      // Subtle boundary for gameplay — always visible
      ctx.strokeStyle = this.zoneBorderColors[i];
      ctx.strokeRect(wx, wy, ww, wh);

      if (debugMode) {
        // Full debug overlay: filled regions + name labels
        ctx.strokeStyle = this.zoneColors[i];
        ctx.lineWidth = 2;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.lineWidth = 1;

        ctx.fillStyle = this.zoneLabelColors[i];
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(zone.name, wx + ww * 0.5, wy + wh * 0.5);
      }
    }

    ctx.setLineDash(this.emptyDash);
  }

  /** Parse a 6-digit hex color string into its R, G, B integer components. */
  private static hexToRgbParts(hex: string): { r: number; g: number; b: number } {
    // Strip leading '#' if present
    const clean = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b };
  }
}
