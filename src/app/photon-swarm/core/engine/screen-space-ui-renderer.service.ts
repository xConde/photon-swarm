// Extracted from GameRenderingService (Campaign D — god-service decomp).
// Screen-space (non-world-space) UI overlays: damage flash, boss-phase flash, low-health vignette, tooltip, notifications.
import { Injectable } from '@angular/core';
import { ThemeService } from '@services/theme.service';
import { PaletteService } from '../../services/palette.service';

@Injectable({ providedIn: 'root' })
export class ScreenSpaceUiRendererService {
  /**
   * PERF: Pre-rendered OffscreenCanvas for the low-health vignette.
   * Built once (or on resize) — drawn via drawImage each frame to avoid
   * createRadialGradient + addColorStop overhead per frame.
   * Uses alpha=1 for all stops; per-frame alpha is applied via ctx.globalAlpha.
   */
  private _lowHealthCanvas: HTMLCanvasElement | null = null;
  private _lowHealthCanvasWidth = 0;
  private _lowHealthCanvasHeight = 0;

  constructor(
    private themeService: ThemeService,
    private paletteService: PaletteService
  ) {}

  /**
   * Render damage flash overlay
   */
  public renderDamageFlash(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    intensity: number
  ): void {
    if (intensity > 0) {
      // PERFORMANCE: No save/restore needed — only style changes, no transforms
      ctx.globalAlpha = intensity;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.globalAlpha = 1.0;
    }
  }

  /**
   * Render boss phase-break flash overlay.
   * White/gold colour distinguishes it from the red damage flash.
   * Fades quickly (driven by UIStateService.updateBossPhaseFlash each frame).
   */
  public renderBossPhaseFlash(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    intensity: number
  ): void {
    // PERFORMANCE: No save/restore — only fillStyle and globalAlpha changes, no transforms
    ctx.globalAlpha = intensity * 0.6; // keep max at ~0.27 so game is still readable
    ctx.fillStyle = '#ffe066'; // gold-white
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.globalAlpha = 1.0;
  }

  /**
   * Render low health warning vignette at screen edges.
   * Red radial gradient that pulses faster at lower HP.
   *
   * PERFORMANCE: The gradient shape is pre-rendered into an HTMLCanvasElement
   * (built once, or rebuilt only on canvas resize).  Each frame we draw it via
   * ctx.drawImage scaled to the current canvas size and modulate intensity with
   * ctx.globalAlpha — no createRadialGradient / addColorStop per frame.
   */
  public renderLowHealthWarning(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    canvasHeight: number,
    healthPercent: number,
    frameTime: number
  ): void {
    // Rebuild the cached canvas when size has changed (covers initial creation too)
    if (
      this._lowHealthCanvas === null ||
      this._lowHealthCanvasWidth !== canvasWidth ||
      this._lowHealthCanvasHeight !== canvasHeight
    ) {
      this._buildLowHealthCanvas(canvasWidth, canvasHeight);
    }

    if (!this._lowHealthCanvas) return;

    // healthPercent is already < 0.3 when called
    // urgency: 0 at 30% HP, 1 at 0% HP
    const urgency = 1 - healthPercent / 0.3;

    // Pulse speed increases with urgency (2 Hz at 30% HP → 6 Hz at 0%)
    const pulseSpeed = 0.004 + urgency * 0.008;
    const pulse = 0.5 + 0.5 * Math.sin(frameTime * pulseSpeed);

    // Max alpha ~0.15 to avoid obscuring gameplay (canvas was pre-rendered at alpha=1)
    const alpha = (0.05 + urgency * 0.1) * (0.7 + pulse * 0.3);

    // PERFORMANCE: single drawImage blit — no per-frame gradient construction
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._lowHealthCanvas, 0, 0, canvasWidth, canvasHeight);
    ctx.globalAlpha = 1.0;
  }

  /**
   * Build (or rebuild) the low-health OffscreenCanvas cache.
   * Renders the gradient shape once at full opacity so the caller can
   * modulate intensity cheaply via globalAlpha.
   */
  private _buildLowHealthCanvas(width: number, height: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const offCtx = canvas.getContext('2d');
    if (!offCtx) return;

    const cx = width / 2;
    const cy = height / 2;
    const outerRadius = Math.max(width, height) * 0.7;

    const gradient = offCtx.createRadialGradient(cx, cy, outerRadius * 0.6, cx, cy, outerRadius);
    gradient.addColorStop(0, 'rgba(180,0,0,0)');
    gradient.addColorStop(0.7, 'rgba(180,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(120,0,0,1)');

    offCtx.fillStyle = gradient;
    offCtx.fillRect(0, 0, width, height);

    this._lowHealthCanvas = canvas;
    this._lowHealthCanvasWidth = width;
    this._lowHealthCanvasHeight = height;
  }

  /**
   * Render tooltip
   */
  public renderTooltip(ctx: CanvasRenderingContext2D, tooltipText: string, tooltipX: number, tooltipY: number): void {
    if (!tooltipText) return;

    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    const themeColors = this.paletteService.getCanvas();
    ctx.font = '14px monospace';
    ctx.fillStyle = themeColors.STROKE_PRIMARY;
    ctx.strokeStyle = this.themeService.isDayMode ? '#f8fafc' : '#000000'; // Slate-50
    ctx.lineWidth = 2;

    // Draw text with outline
    ctx.strokeText(tooltipText, tooltipX, tooltipY);
    ctx.fillText(tooltipText, tooltipX, tooltipY);
  }

  /**
   * Render notifications
   */
  public renderNotifications(
    ctx: CanvasRenderingContext2D,
    canvasWidth: number,
    notifications: Array<{ text: string; startTime: number; color: string }>,
    frameTime: number
  ): void {
    const currentTime = frameTime;
    const displayDuration = 3000; // 3 seconds

    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let yOffset = 0;
    for (const notification of notifications) {
      const age = currentTime - notification.startTime;
      if (age > displayDuration) continue;

      const alpha = Math.max(0, 1 - age / displayDuration);
      const y = 100 + yOffset;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = notification.color;
      ctx.strokeStyle = this.themeService.isDayMode ? '#ffffff' : '#000000';
      ctx.lineWidth = this.themeService.isDayMode ? 3 : 2;

      ctx.strokeText(notification.text, canvasWidth / 2, y);
      ctx.fillText(notification.text, canvasWidth / 2, y);

      yOffset += 40;
    }
    ctx.globalAlpha = 1.0;
  }
}
