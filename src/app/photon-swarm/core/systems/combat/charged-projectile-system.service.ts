import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import {
  ChargedProjectileComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';
import { MonitorPerformance } from '../../utils/performance-monitor.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ThemeService } from '@services/theme.service';
import { PaletteService } from '../../../services/palette.service';

/**
 * Charged Projectile System - manages visual animations and effects for charged projectiles
 *
 * This system handles:
 * - Pulsing glow animations for charged projectiles
 * - Trail particle effects for high-charge projectiles
 * - Color transitions and special visual states
 * - Performance-optimized visual updates
 */
@Injectable({
  providedIn: 'root',
})
export class ChargedProjectileSystemService implements System {
  private lastUpdateTime = 0;
  private readonly UPDATE_INTERVAL_MS = 16; // ~60 FPS for smooth animations

  // Performance tracking
  private performanceStats = {
    trailsSpawned: 0,
    projectilesProcessed: 0,
    lastReportTime: 0,
  };
  private readonly STATS_REPORT_INTERVAL = 30000; // Report every 30 seconds

  constructor(
    // private effectFactory: EffectFactoryService, // Unused after disabling trail effects
    private debugLog: DebugLogBridgeService,
    private themeService: ThemeService,
    private paletteService: PaletteService
  ) {}

  /**
   * Initialize the charged projectile system
   */
  init(_entityManager: EntityManager): void {
    // No initialization needed for this visual system
  }

  /**
   * Main system update - animates charged projectile effects
   */
  @MonitorPerformance('ChargedProjectileSystem.update')
  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = Date.now();

    // Throttle updates for performance
    if (currentTime - this.lastUpdateTime < this.UPDATE_INTERVAL_MS) {
      return;
    }
    this.lastUpdateTime = currentTime;

    // Get all charged projectiles
    const chargedProjectiles = entityManager.getEntitiesWithComponents(ChargedProjectileComponent, RenderableComponent);

    let processedCount = 0;
    for (const entityId of chargedProjectiles) {
      this.updateChargedProjectileVisuals(entityId, currentTime, entityManager);
      processedCount++;
    }

    // Update performance stats
    this.performanceStats.projectilesProcessed += processedCount;

    // Report performance metrics periodically
    if (currentTime - this.performanceStats.lastReportTime > this.STATS_REPORT_INTERVAL) {
      this.reportPerformanceMetrics();
      this.performanceStats.lastReportTime = currentTime;
    }
  }

  /**
   * Update visual effects for a single charged projectile
   */
  private updateChargedProjectileVisuals(entityId: number, currentTime: number, entityManager: EntityManager): void {
    const chargedProjectile = entityManager.getComponent(entityId, ChargedProjectileComponent);
    const renderable = entityManager.getComponent(entityId, RenderableComponent);

    if (!chargedProjectile || !renderable) return;

    // Update charged state in case charge level changed
    chargedProjectile.updateChargedState();

    if (chargedProjectile.isCharged) {
      // Update pulsing glow effect
      renderable.glowIntensity = chargedProjectile.getPulseGlow(currentTime);

      // Update color with time-based effects
      renderable.color = this.getAnimatedColor(chargedProjectile, currentTime);

      // Handle trail effects for high-charge projectiles
      this.handleTrailEffects(entityId, chargedProjectile, currentTime, entityManager);
    } else {
      // Reset to normal projectile appearance
      renderable.glowIntensity = 0;
      renderable.color = this.paletteService.getCanvas().ACCENT_CYAN; // Theme-aware default
      renderable.renderLayer = 'world'; // Normal render layer
    }
  }

  /**
   * Get animated color for charged projectiles
   */
  private getAnimatedColor(chargedProjectile: ChargedProjectileComponent, currentTime: number): string {
    if (!chargedProjectile.isCharged) {
      return chargedProjectile.getCurrentColor();
    }

    // Add subtle color cycling for fully charged projectiles
    if (chargedProjectile.chargeLevel >= 0.8) {
      const cycle = Math.sin(currentTime * 0.005) * 0.3 + 0.7;
      const intensity = Math.floor(chargedProjectile.chargeLevel * 255 * cycle);
      // Theme-aware color cycling - dark mode uses cyan, light mode uses teal
      if (this.themeService.isDayMode) {
        return `rgba(${Math.floor(47 + intensity * 0.4)}, ${Math.floor(79 + intensity * 0.4)}, ${Math.floor(79 + intensity * 0.4)}, 0.95)`;
      }
      return `rgba(${intensity}, 255, 255, 0.95)`;
    }

    return chargedProjectile.getCurrentColor();
  }

  /**
   * Handle particle trail effects for high-charge projectiles
   */
  private handleTrailEffects(
    entityId: number,
    chargedProjectile: ChargedProjectileComponent,
    _currentTime: number,
    entityManager: EntityManager
  ): void {
    if (!chargedProjectile.shouldEmitTrail()) return;

    const position = entityManager.getComponent(entityId, PositionComponent);
    const velocity = entityManager.getComponent(entityId, VelocityComponent);

    if (!position || !velocity) return;

    // Trail effects disabled to reduce visual clutter
    // The trail particles were creating excessive star-like effects
  }

  /**
   * Get charged projectile statistics for debugging
   */
  getChargedProjectileStats(entityManager: EntityManager): {
    total: number;
    charged: number;
    highCharge: number;
    averageCharge: number;
  } {
    const chargedProjectiles = entityManager.getEntitiesWithComponents(ChargedProjectileComponent);

    let charged = 0;
    let highCharge = 0;
    let totalCharge = 0;

    for (const entityId of chargedProjectiles) {
      const chargedProjectile = entityManager.getComponent(entityId, ChargedProjectileComponent);
      if (chargedProjectile) {
        totalCharge += chargedProjectile.chargeLevel;
        if (chargedProjectile.isCharged) charged++;
        if (chargedProjectile.chargeLevel >= 0.8) highCharge++;
      }
    }

    return {
      total: chargedProjectiles.length,
      charged,
      highCharge,
      averageCharge: chargedProjectiles.length > 0 ? totalCharge / chargedProjectiles.length : 0,
    };
  }

  /**
   * Create a charged projectile effect at a position (for special abilities)
   */
  createChargedEffect(_position: { x: number; y: number }, _chargeLevel: number, _entityManager: EntityManager): void {
    // This could be used for special charged effects like explosions
    // Would integrate with the effects system
  }

  /**
   * Report performance metrics to debug log
   */
  private reportPerformanceMetrics(): void {
    const avgProjectilesPerUpdate =
      this.performanceStats.projectilesProcessed / (this.STATS_REPORT_INTERVAL / this.UPDATE_INTERVAL_MS);

    this.debugLog.log('Charged Projectile System Performance', 'info', {
      source: 'charged_projectile_system',
      operation: 'performance_report',
      metrics: {
        trailsSpawned: this.performanceStats.trailsSpawned,
        projectilesProcessed: this.performanceStats.projectilesProcessed,
        avgProjectilesPerUpdate: avgProjectilesPerUpdate.toFixed(2),
        trailSpawnRate:
          ((this.performanceStats.trailsSpawned / this.performanceStats.projectilesProcessed) * 100).toFixed(1) + '%',
      },
      interval: this.STATS_REPORT_INTERVAL,
    });

    // Reset counters
    this.performanceStats.trailsSpawned = 0;
    this.performanceStats.projectilesProcessed = 0;
  }

  /**
   * No cleanup needed
   */
  destroy(): void {
    // Report final metrics
    if (this.performanceStats.projectilesProcessed > 0) {
      this.reportPerformanceMetrics();
    }
  }
}
