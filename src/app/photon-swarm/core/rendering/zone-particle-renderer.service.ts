import { Injectable } from '@angular/core';

import { ZONE_CONFIG } from '@photon/config/game-constants';
import { ZoneDefinition } from '../models/zone.model';
import { isCoarseTouchDevice } from '../utils/touch-device.util';

interface AmbientParticle {
  x: number;
  y: number;
  size: number;
  alpha: number;
  speed: number;
  angle: number;
  cosAngle: number;
  sinAngle: number;
  phase: number;
}

/**
 * ZoneParticleRendererService
 *
 * Renders ambient zone-themed particles in world space. Each zone has a distinct
 * visual style expressed through particle drift direction, size, and behavior.
 *
 * PERFORMANCE:
 * - Fixed particle pool per zone (no allocations in render loop).
 * - Pre-cached zone RGB values and color strings.
 * - Viewport culling per particle (skip off-screen particles).
 * - No save()/restore(), no shadowBlur, no string concatenation per particle.
 */
@Injectable({ providedIn: 'root' })
export class ZoneParticleRendererService {
  // Each particle is an individual arc+fill draw per visible zone per frame (up to 40 x N-zones).
  // Touch GPUs choke on that many small draws — a quarter pool is still ambient at phone scale.
  private readonly PARTICLES_PER_ZONE = isCoarseTouchDevice() ? 10 : 40;
  private readonly zoneParticles = new Map<number, AmbientParticle[]>();
  private readonly zoneRgb = new Map<number, { r: number; g: number; b: number }>();
  private readonly zoneColorStrings = new Map<number, string[]>();
  private initialized = false;

  /** One-time initialization of particle pools and color caches. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    for (const zone of ZONE_CONFIG.ZONES) {
      const rgb = this.hexToRgb(zone.themeColor);
      this.zoneRgb.set(zone.id, rgb);

      // Pre-cache 11 alpha-stepped color strings (0.00 to 0.10)
      const colors: string[] = [];
      for (let a = 0; a <= 10; a++) {
        const alpha = (a / 100).toFixed(2);
        colors.push(`rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`);
      }
      this.zoneColorStrings.set(zone.id, colors);

      const particles: AmbientParticle[] = [];
      const { bounds } = zone;
      for (let p = 0; p < this.PARTICLES_PER_ZONE; p++) {
        const angle = this.getZoneDriftAngle(zone);
        particles.push({
          x: bounds.x + Math.random() * bounds.width,
          y: bounds.y + Math.random() * bounds.height,
          size: 1 + Math.random() * 2.5,
          alpha: 0.03 + Math.random() * 0.07,
          speed: 5 + Math.random() * 15,
          angle,
          cosAngle: Math.cos(angle),
          sinAngle: Math.sin(angle),
          phase: Math.random() * Math.PI * 2,
        });
      }
      this.zoneParticles.set(zone.id, particles);
    }
  }

  /**
   * Render ambient particles for zones visible in the current viewport.
   * Called once per frame from the world-space render pass.
   */
  render(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    viewportW: number,
    viewportH: number,
    deltaTime: number
  ): void {
    if (!this.initialized) this.init();

    const now = window.performance.now() * 0.001;

    for (const zone of ZONE_CONFIG.ZONES) {
      const { bounds } = zone;

      // Viewport culling at zone level
      if (
        bounds.x + bounds.width < cameraX ||
        bounds.x > cameraX + viewportW ||
        bounds.y + bounds.height < cameraY ||
        bounds.y > cameraY + viewportH
      ) {
        continue;
      }

      const particles = this.zoneParticles.get(zone.id);
      const colors = this.zoneColorStrings.get(zone.id);
      if (!particles || !colors) continue;

      for (const p of particles) {
        // Animate position
        p.x += p.cosAngle * p.speed * deltaTime;
        p.y += p.sinAngle * p.speed * deltaTime;

        // Zone-specific oscillation
        if (zone.id === 3) {
          // Void Rift: horizontal oscillation
          p.x += Math.sin(now * 2 + p.phase) * 0.3;
        }

        // Wrap within zone bounds
        if (p.x < bounds.x) p.x += bounds.width;
        if (p.x > bounds.x + bounds.width) p.x -= bounds.width;
        if (p.y < bounds.y) p.y += bounds.height;
        if (p.y > bounds.y + bounds.height) p.y -= bounds.height;

        // Per-particle viewport culling
        if (
          p.x < cameraX - 10 ||
          p.x > cameraX + viewportW + 10 ||
          p.y < cameraY - 10 ||
          p.y > cameraY + viewportH + 10
        ) {
          continue;
        }

        // Pulsing alpha based on zone style
        const pulseAlpha = p.alpha * (0.7 + 0.3 * Math.sin(now * 1.5 + p.phase));
        const alphaIndex = Math.min(10, Math.max(0, Math.round(pulseAlpha * 100)));
        ctx.fillStyle = colors[alphaIndex];

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  destroy(): void {
    this.zoneParticles.clear();
    this.zoneRgb.clear();
    this.zoneColorStrings.clear();
    this.initialized = false;
  }

  reset(): void {
    this.destroy();
  }

  private getZoneDriftAngle(zone: ZoneDefinition): number {
    switch (zone.id) {
      case 1:
        return -Math.PI * 0.5 + (Math.random() - 0.5) * 0.4; // Upward drift
      case 2:
        return -Math.PI * 0.25 + (Math.random() - 0.5) * 0.3; // Diagonal up-right
      case 3:
        return Math.PI + (Math.random() - 0.5) * 0.6; // Leftward with spread
      case 4:
        return Math.PI * 0.5 + (Math.random() - 0.5) * 0.4; // Downward drift
      default:
        return Math.random() * Math.PI * 2;
    }
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const clean = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
}
