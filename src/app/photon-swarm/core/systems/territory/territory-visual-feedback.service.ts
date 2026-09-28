import { Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  FourKingsTerritoryService,
  TerritoryMomentumSystemService,
  TerritoryStrengthSystemService,
  TileStrengthChange,
} from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

export interface TileWeakeningEffect {
  gridX: number;
  gridY: number;
  worldX: number;
  worldY: number;
  oldStrength: number;
  newStrength: number;
  startTime: number;
  duration: number;
  color: string;
}

/**
 * Territory Visual Feedback Service
 *
 * Provides visual effects when territory tiles are weakened or strengthened.
 * Shows ripple effects, color flashes, and strength change indicators.
 */
@Injectable({
  providedIn: 'root',
})
export class TerritoryVisualFeedbackService implements OnDestroy {
  private activeEffects: TileWeakeningEffect[] = [];
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvasSet = false;
  private strengthChangesSubscription: Subscription | null = null;

  // Visual constants
  private readonly EFFECT_DURATION = 1000; // milliseconds
  private readonly RIPPLE_MAX_RADIUS = 150;
  private readonly FLASH_INTENSITY = 0.8;
  private readonly MAX_ACTIVE_EFFECTS = 50; // Prevent memory leak

  constructor(
    private territoryStrengthSystem: TerritoryStrengthSystemService,
    private fourKingsTerritory: FourKingsTerritoryService,
    private territoryMomentum: TerritoryMomentumSystemService,
    private debugLog: DebugLogBridgeService
  ) {
    this.subscribeToStrengthChanges();
  }

  /**
   * Set canvas for rendering effects
   */
  setCanvas(canvas: HTMLCanvasElement): void {
    if (this.canvasSet) return; // Only set once
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.canvasSet = true;
  }

  /**
   * Subscribe to territory strength changes
   */
  private subscribeToStrengthChanges(): void {
    // Clean up any existing subscription
    if (this.strengthChangesSubscription) {
      this.strengthChangesSubscription.unsubscribe();
    }

    this.strengthChangesSubscription = this.territoryStrengthSystem.strengthChanges$.subscribe((changes) => {
      this.handleStrengthChanges(changes);
    });
  }

  /**
   * Handle strength changes and create visual effects
   */
  private handleStrengthChanges(changes: TileStrengthChange[]): void {
    const tileSize = this.fourKingsTerritory.getTileSize();

    for (const change of changes) {
      // Only show effects for weakening (not regeneration)
      if (change.reason === 'kill_impact') {
        const worldX = change.gridX * tileSize + tileSize / 2;
        const worldY = change.gridY * tileSize + tileSize / 2;

        const effect: TileWeakeningEffect = {
          gridX: change.gridX,
          gridY: change.gridY,
          worldX,
          worldY,
          oldStrength: change.oldStrength,
          newStrength: change.newStrength,
          startTime: Date.now(),
          duration: this.EFFECT_DURATION,
          color: this.getEffectColor(change.oldStrength, change.newStrength),
        };

        // Limit active effects to prevent memory leak
        if (this.activeEffects.length >= this.MAX_ACTIVE_EFFECTS) {
          // Remove oldest effects
          this.activeEffects.splice(0, this.activeEffects.length - this.MAX_ACTIVE_EFFECTS + 1);
        }

        this.activeEffects.push(effect);

        // Log significant weakening
        if (change.oldStrength - change.newStrength >= 5) {
          this.debugLog.log('Territory significantly weakened', 'info', {
            gridPos: `${change.gridX},${change.gridY}`,
            reduction: change.oldStrength - change.newStrength,
            newStrength: change.newStrength,
            canBeCaptured: change.newStrength <= 30,
          });
        }
      }
    }
  }

  /**
   * Get color for weakening effect based on strength change
   */
  private getEffectColor(oldStrength: number, newStrength: number): string {
    const reduction = oldStrength - newStrength;

    if (reduction >= 8) {
      return '#ff0000'; // Red for major weakening
    } else if (reduction >= 5) {
      return '#ff6600'; // Orange for moderate weakening
    } else {
      return '#ffaa00'; // Yellow for minor weakening
    }
  }

  /**
   * Render all active visual effects
   */
  render(cameraX: number, cameraY: number): void {
    if (!this.ctx || !this.canvas) return;

    const now = Date.now();

    // Update and render effects
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      const elapsed = now - effect.startTime;

      if (elapsed >= effect.duration) {
        // Remove expired effect
        this.activeEffects.splice(i, 1);
        continue;
      }

      this.renderWeakeningEffect(effect, elapsed, cameraX, cameraY);
    }
  }

  /**
   * Render a single weakening effect
   */
  private renderWeakeningEffect(effect: TileWeakeningEffect, elapsed: number, cameraX: number, cameraY: number): void {
    if (!this.ctx || !this.canvas) return;

    const progress = elapsed / effect.duration;
    const screenX = effect.worldX - cameraX;
    const screenY = effect.worldY - cameraY;

    // Skip if off-screen. Use the CSS (logical) size — effects draw in CSS coords, while on touch
    // this.canvas.width is the smaller sub-native backing store (renderScale < 1).
    const cssW = parseFloat(this.canvas.style.width) || this.canvas.width;
    const cssH = parseFloat(this.canvas.style.height) || this.canvas.height;
    if (screenX < -200 || screenX > cssW + 200 || screenY < -200 || screenY > cssH + 200) {
      return;
    }

    this.ctx.save();

    // Ripple effect
    this.renderRipple(screenX, screenY, progress, effect.color);

    // Flash effect on the tile
    this.renderTileFlash(effect, screenX, screenY, progress);

    // Floating damage number
    this.renderDamageNumber(effect, screenX, screenY, progress);

    this.ctx.restore();
  }

  /**
   * Render expanding ripple effect
   */
  private renderRipple(x: number, y: number, progress: number, color: string): void {
    if (!this.ctx) return;

    const radius = this.RIPPLE_MAX_RADIUS * progress;
    const opacity = (1 - progress) * 0.5;

    this.ctx.strokeStyle = color;
    this.ctx.globalAlpha = opacity;
    this.ctx.lineWidth = 2;

    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    // Inner ripple
    if (progress < 0.7) {
      const innerRadius = radius * 0.6;
      this.ctx.globalAlpha = opacity * 0.5;
      this.ctx.beginPath();
      this.ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
      this.ctx.stroke();
    }
  }

  /**
   * Render tile flash effect
   */
  private renderTileFlash(effect: TileWeakeningEffect, screenX: number, screenY: number, progress: number): void {
    if (!this.ctx) return;

    const tileSize = this.fourKingsTerritory.getTileSize();
    const flashOpacity = (1 - progress) * this.FLASH_INTENSITY * 0.3;

    this.ctx.fillStyle = effect.color;
    this.ctx.globalAlpha = flashOpacity;

    // Draw flashing tile overlay
    this.ctx.fillRect(screenX - tileSize / 2, screenY - tileSize / 2, tileSize, tileSize);
  }

  /**
   * Render floating damage number
   */
  private renderDamageNumber(effect: TileWeakeningEffect, screenX: number, screenY: number, progress: number): void {
    if (!this.ctx) return;

    const reduction = Math.floor(effect.oldStrength - effect.newStrength);
    if (reduction <= 0) return;

    // Float upward and fade out
    const floatY = screenY - progress * 50;
    const opacity = 1 - progress;

    this.ctx.font = 'bold 20px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    // Shadow
    this.ctx.globalAlpha = opacity * 0.5;
    this.ctx.fillStyle = '#000000';
    this.ctx.fillText(`-${reduction}`, screenX + 2, floatY + 2);

    // Main text
    this.ctx.globalAlpha = opacity;
    this.ctx.fillStyle = effect.color;
    this.ctx.fillText(`-${reduction}`, screenX, floatY);

    // Show "WEAK!" if tile can now be captured
    if (effect.newStrength <= 30 && effect.oldStrength > 30) {
      this.ctx.font = 'bold 14px monospace';
      this.ctx.globalAlpha = opacity * 0.8;
      this.ctx.fillStyle = '#ffff00';
      this.ctx.fillText('WEAK!', screenX, floatY + 25);
    }
  }

  /**
   * Clear all active effects
   */
  clearEffects(): void {
    this.activeEffects = [];
  }

  /**
   * Get count of active effects (for performance monitoring)
   */
  getActiveEffectCount(): number {
    return this.activeEffects.length;
  }

  /**
   * Get visual effect intensity based on momentum
   */
  public getMomentumEffectIntensity(kingId: number): number {
    if (!this.territoryMomentum) return 1.0;

    const momentum = this.territoryMomentum.getFactionMomentum(kingId);
    if (!momentum) return 1.0;

    if (momentum.lastStandActive) {
      return 2.0; // Double intensity for last stand
    } else if (momentum.isDesperate) {
      return 1.5; // 50% more intensity
    } else if (momentum.isWinning) {
      return 0.8; // Slightly less intensity (they're secure)
    }

    return 1.0;
  }

  /**
   * Check if should show special effects for faction
   */
  public shouldShowMomentumEffects(kingId: number): boolean {
    if (!this.territoryMomentum) return false;

    const momentum = this.territoryMomentum.getFactionMomentum(kingId);
    return momentum ? momentum.lastStandActive || momentum.isDesperate : false;
  }

  /**
   * Clean up subscriptions on destroy
   */
  ngOnDestroy(): void {
    if (this.strengthChangesSubscription) {
      this.strengthChangesSubscription.unsubscribe();
      this.strengthChangesSubscription = null;
    }
    this.clearEffects();
    this.canvasSet = false;
  }
}
