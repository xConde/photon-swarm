import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ThemeService } from '@services/theme.service';
import { ZoneStateService } from '../systems/world';

/**
 * ParallaxStarfieldService - renders a multi-layer parallax starfield background.
 *
 * Three layers of stars move at different speeds relative to the camera,
 * creating a depth illusion. All star arrays are pre-allocated at construction
 * time — zero per-frame allocations.
 *
 * Performance: uses fillRect (not arc), sets fillStyle once per layer,
 * no shadowBlur, no save/restore per star, no string interpolation in render loop.
 *
 * Zone ambient particles: 40 pre-allocated slots provide per-zone atmospheric
 * effects. Particles fade in/out on zone change and drift in world space,
 * wrapping in a 2000x2000 grid around the player position.
 */

interface ParallaxStar {
  x: number;
  y: number;
}

interface StarLayer {
  stars: ParallaxStar[];
  size: number;
  parallaxFactor: number;
  regionWidth: number;
  regionHeight: number;
}

interface AmbientParticle {
  x: number;
  y: number;
  size: number;
  alpha: number;
  targetAlpha: number;
  speedX: number;
  speedY: number;
  phase: number;
}

/** Per-zone ambient particle configuration (defined once, never allocated per frame). */
interface ZoneAmbientConfig {
  /** Number of active slots to use (≤ 40) */
  count: number;
  minSize: number;
  maxSize: number;
  minSpeed: number;
  maxSpeed: number;
  /** Maximum target alpha for fully-faded-in particles */
  maxAlpha: number;
  /** Pre-cached fillStyle string — set once in initZoneAmbient */
  color: string;
  /** Whether to use arc (true) or fillRect (false) for rendering */
  useArc: boolean;
}

const ZONE_AMBIENT_CONFIGS: Record<number, ZoneAmbientConfig> = {
  // Zone 1 — Nebula: large slow circles, warm red/pink tint
  1: {
    count: 25,
    minSize: 3,
    maxSize: 6,
    minSpeed: 5,
    maxSpeed: 15,
    maxAlpha: 0.35,
    color: 'rgba(255,100,120,',
    useArc: true,
  },
  // Zone 2 — Asteroid: small fast specks, cool blue tint
  2: {
    count: 35,
    minSize: 1,
    maxSize: 2,
    minSpeed: 20,
    maxSpeed: 40,
    maxAlpha: 0.45,
    color: 'rgba(80,160,255,',
    useArc: false,
  },
  // Zone 3 — Void: medium slow clouds, green tint, very low alpha
  3: {
    count: 20,
    minSize: 4,
    maxSize: 8,
    minSpeed: 3,
    maxSpeed: 8,
    maxAlpha: 0.22,
    color: 'rgba(60,220,120,',
    useArc: true,
  },
  // Zone 4 — Core: tiny fast micro-particles, purple tint
  4: {
    count: 40,
    minSize: 0.5,
    maxSize: 1.5,
    minSpeed: 30,
    maxSpeed: 60,
    maxAlpha: 0.5,
    color: 'rgba(180,80,255,',
    useArc: false,
  },
};

/** Grid size for ambient particle wrapping (world-space). */
const AMBIENT_GRID = 2000;
const HALF_GRID = AMBIENT_GRID / 2;

/**
 * 16-step alpha lookup table (indices 0–15 map to alpha 0.0–1.0 in steps of 1/15).
 * Used to convert a particle's floating-point alpha into a pre-built string fragment,
 * eliminating per-particle .toFixed(3) string allocation in the render loop.
 *
 * Index = Math.round(alpha * 15), clamped to [0, 15].
 */
const ALPHA_TABLE_SIZE = 16;
const ALPHA_LOOKUP: readonly string[] = Array.from({ length: ALPHA_TABLE_SIZE }, (_, i) =>
  (i / (ALPHA_TABLE_SIZE - 1)).toFixed(3)
);

/** Pre-computed fillStyle strings for each layer, indexed by layer (0-2). */
const DARK_FILLS = ['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0.7)'];
// Light-mode: slate-900 base (15,23,42) at higher opacity so stars register on pale background
const LIGHT_FILLS = ['rgba(15,23,42,0.40)', 'rgba(15,23,42,0.52)', 'rgba(15,23,42,0.65)'];

@Injectable({
  providedIn: 'root',
})
export class ParallaxStarfieldService implements OnDestroy {
  private readonly themeService = inject(ThemeService);
  private readonly zoneStateService = inject(ZoneStateService);
  private readonly layers: StarLayer[];

  /** Scale parallax speed by intensity (1.0 = normal, 1.4 = 40% faster). */
  intensitySpeedMultiplier = 1.0;

  // ---------------------------------------------------------------------------
  // Zone ambient particle state (40 pre-allocated slots, never grow/shrink)
  // ---------------------------------------------------------------------------
  private readonly zoneAmbientParticles: AmbientParticle[] = Array.from({ length: 40 }, () => ({
    x: 0,
    y: 0,
    size: 0,
    alpha: 0,
    targetAlpha: 0,
    speedX: 0,
    speedY: 0,
    phase: 0,
  }));

  private activeAmbientCount = 0;
  private currentAmbientZoneId: number | null = null;
  /** Pre-cached color string base for the active zone (e.g. "rgba(255,100,120,") */
  private ambientColorBase = '';
  /** Whether active zone particles use arc rendering */
  private ambientUseArc = false;
  /** Pre-computed fillStyle strings for each ALPHA_LOOKUP index for the active zone. */
  private ambientFillStyles: string[] = [];

  /** Timestamp of the previous render frame for computing deltaTime internally. */
  private lastFrameTime = 0;

  private readonly zoneChangeSub: Subscription;

  constructor() {
    // Pre-allocate all star layers. Region is 3x a typical 1920x1080 viewport
    // so wrapping seams stay invisible.
    const regionW = 1920 * 3;
    const regionH = 1080 * 3;

    this.layers = [
      this.createLayer(150, 1, 0.1, regionW, regionH),
      this.createLayer(80, 1.5, 0.3, regionW, regionH),
      this.createLayer(40, 2, 0.6, regionW, regionH),
    ];

    this.zoneChangeSub = this.zoneStateService.zoneChanged$.subscribe((event) => {
      this.initZoneAmbient(event.to);
    });
  }

  ngOnDestroy(): void {
    this.zoneChangeSub.unsubscribe();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Render all parallax star layers and zone ambient particles.
   * Call immediately after clearing/filling the canvas background, before entity rendering.
   *
   * Parallax renders in screen-space (before the camera transform), so it culls against the
   * CSS SCREEN size passed by the caller — NOT ctx.canvas.width, which on touch is the smaller
   * sub-native backing store (renderScale < 1) and would leave a starless strip on the right/bottom.
   */
  render(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    // Compute frame delta internally so callers don't need to pass it.
    const now = Date.now();
    const deltaTime = this.lastFrameTime === 0 ? 0 : (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    // CSS screen dimensions (logical px) — parallax is screen-space, not world-space.
    const canvasW = screenWidth || ctx.canvas.width;
    const canvasH = screenHeight || ctx.canvas.height;

    const isDark = !this.themeService.isDayMode;
    const fills = isDark ? DARK_FILLS : LIGHT_FILLS;

    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      const regionW = layer.regionWidth;
      const regionH = layer.regionHeight;

      // Offset by camera * parallax factor, then modular-wrap into [0, regionSize)
      const pf = layer.parallaxFactor * this.intensitySpeedMultiplier;
      const offsetX = (((cameraX * pf) % regionW) + regionW) % regionW;
      const offsetY = (((cameraY * pf) % regionH) + regionH) % regionH;

      ctx.fillStyle = fills[l];
      const size = layer.size;
      const stars = layer.stars;

      for (let i = 0; i < stars.length; i++) {
        // Wrap star position so it tiles seamlessly
        let sx = (((stars[i].x - offsetX) % regionW) + regionW) % regionW;
        let sy = (((stars[i].y - offsetY) % regionH) + regionH) % regionH;

        // Map into viewport: stars beyond canvas are off-screen
        if (sx > canvasW && sx < regionW - size) continue;
        if (sy > canvasH && sy < regionH - size) continue;

        // Handle wrap-around: if star wrapped past region edge, shift it
        if (sx >= regionW - size) {
          sx -= regionW;
        }
        if (sy >= regionH - size) {
          sy -= regionH;
        }

        ctx.fillRect(sx, sy, size, size);
      }
    }

    // Update and render zone ambient particles after the starfield layers.
    if (this.activeAmbientCount > 0 && deltaTime > 0) {
      this.updateZoneAmbient(deltaTime, cameraX, cameraY);
    }
    this.renderZoneAmbient(ctx, cameraX, cameraY, canvasW, canvasH);
  }

  /** Scale parallax speed by intensity (1.0 = normal, 2.0 = max). */
  setIntensitySpeedMultiplier(value: number): void {
    this.intensitySpeedMultiplier = Math.max(1.0, Math.min(2.0, value));
  }

  // ---------------------------------------------------------------------------
  // Zone ambient particles
  // ---------------------------------------------------------------------------

  /**
   * Initialise ambient particles for the given zone.
   * Idempotent — returns early if already on this zone.
   * Pass null to fade out all particles (player left all zones).
   */
  initZoneAmbient(zoneId: number | null): void {
    if (zoneId === this.currentAmbientZoneId) {
      return;
    }
    this.currentAmbientZoneId = zoneId;

    if (zoneId === null) {
      // Fade out all active particles — don't reset positions.
      for (let i = 0; i < this.activeAmbientCount; i++) {
        this.zoneAmbientParticles[i].targetAlpha = 0;
      }
      this.ambientColorBase = '';
      this.ambientFillStyles = [];
      return;
    }

    const cfg = ZONE_AMBIENT_CONFIGS[zoneId];
    if (!cfg) {
      // Unknown zone — fade everything out.
      for (let i = 0; i < this.activeAmbientCount; i++) {
        this.zoneAmbientParticles[i].targetAlpha = 0;
      }
      this.ambientColorBase = '';
      this.ambientFillStyles = [];
      return;
    }

    this.ambientColorBase = cfg.color;
    // Precompute the full fillStyle strings for every ALPHA_LOOKUP index so the
    // render loop can index directly instead of concatenating strings per particle.
    this.ambientFillStyles = ALPHA_LOOKUP.map((a) => cfg.color + a + ')');
    this.ambientUseArc = cfg.useArc;
    this.activeAmbientCount = cfg.count;

    for (let i = 0; i < cfg.count; i++) {
      const p = this.zoneAmbientParticles[i];

      // Place randomly in the 2000×2000 grid (centred on origin; actual
      // position during render is offset relative to the current player pos).
      p.x = (Math.random() - 0.5) * AMBIENT_GRID;
      p.y = (Math.random() - 0.5) * AMBIENT_GRID;

      p.size = cfg.minSize + Math.random() * (cfg.maxSize - cfg.minSize);

      const speed = cfg.minSpeed + Math.random() * (cfg.maxSpeed - cfg.minSpeed);
      const angle = Math.random() * Math.PI * 2;
      p.speedX = Math.cos(angle) * speed;
      p.speedY = Math.sin(angle) * speed;

      p.phase = Math.random() * Math.PI * 2;
      p.alpha = 0; // Fade in from 0
      p.targetAlpha = cfg.maxAlpha * (0.6 + Math.random() * 0.4); // Slight variation
    }

    // Ensure any slots beyond the new count are faded out so they don't render.
    for (let i = cfg.count; i < 40; i++) {
      this.zoneAmbientParticles[i].targetAlpha = 0;
      this.zoneAmbientParticles[i].alpha = 0;
    }
  }

  /**
   * Update ambient particle positions and alpha.
   * Called internally from render() with the computed frame deltaTime (seconds).
   *
   * @param deltaTime - seconds since last frame
   * @param playerX   - used as the wrap anchor (camera world position X)
   * @param playerY   - used as the wrap anchor (camera world position Y)
   */
  private updateZoneAmbient(deltaTime: number, playerX: number, playerY: number): void {
    const fadeRate = Math.min(1, deltaTime * 2);

    for (let i = 0; i < this.activeAmbientCount; i++) {
      const p = this.zoneAmbientParticles[i];

      // Fade alpha toward target.
      p.alpha += (p.targetAlpha - p.alpha) * fadeRate;

      // Move particle.
      p.x += p.speedX * deltaTime;
      p.y += p.speedY * deltaTime;

      // Wrap particle inside a 2000×2000 grid anchored to the player.
      // If the particle drifts more than HALF_GRID away from the player,
      // teleport it to the opposite side so coverage stays even.
      const relX = p.x - playerX;
      if (relX > HALF_GRID) {
        p.x -= AMBIENT_GRID;
      } else if (relX < -HALF_GRID) {
        p.x += AMBIENT_GRID;
      }

      const relY = p.y - playerY;
      if (relY > HALF_GRID) {
        p.y -= AMBIENT_GRID;
      } else if (relY < -HALF_GRID) {
        p.y += AMBIENT_GRID;
      }
    }
  }

  /**
   * Render all visible ambient particles for the current zone.
   * Particles with alpha ≤ 0.01 are skipped to avoid invisible draws.
   *
   * No save/restore, no shadowBlur, no string allocation per particle.
   */
  private renderZoneAmbient(
    ctx: CanvasRenderingContext2D,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    if (this.ambientColorBase === '') {
      // Check whether any lingering fading particles still need drawing.
      let anyVisible = false;
      for (let i = 0; i < this.activeAmbientCount; i++) {
        if (this.zoneAmbientParticles[i].alpha > 0.01) {
          anyVisible = true;
          break;
        }
      }
      if (!anyVisible) {
        return;
      }
    }

    const canvasW = screenWidth || ctx.canvas.width;
    const canvasH = screenHeight || ctx.canvas.height;

    for (let i = 0; i < this.activeAmbientCount; i++) {
      const p = this.zoneAmbientParticles[i];
      if (p.alpha <= 0.01) continue;

      // Convert world position to screen position.
      const sx = p.x - cameraX + canvasW * 0.5;
      const sy = p.y - cameraY + canvasH * 0.5;

      // Cull off-screen particles (with a small margin equal to the particle size).
      const margin = p.size + 1;
      if (sx < -margin || sx > canvasW + margin || sy < -margin || sy > canvasH + margin) {
        continue;
      }

      // Map alpha to one of 16 pre-built string steps — no per-frame string allocation.
      const alphaIdx = Math.min(ALPHA_TABLE_SIZE - 1, Math.round(p.alpha * (ALPHA_TABLE_SIZE - 1)));
      ctx.fillStyle = this.ambientFillStyles[alphaIdx];

      if (this.ambientUseArc) {
        ctx.beginPath();
        ctx.arc(sx, sy, p.size, 0, 6.2832); // 6.2832 ≈ 2π, avoids Math.PI * 2
        ctx.fill();
      } else {
        const half = p.size * 0.5;
        ctx.fillRect(sx - half, sy - half, p.size, p.size);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createLayer(
    count: number,
    size: number,
    parallaxFactor: number,
    regionWidth: number,
    regionHeight: number
  ): StarLayer {
    const stars: ParallaxStar[] = new Array<ParallaxStar>(count);
    for (let i = 0; i < count; i++) {
      stars[i] = {
        x: Math.random() * regionWidth,
        y: Math.random() * regionHeight,
      };
    }
    return { stars, size, parallaxFactor, regionWidth, regionHeight };
  }
}
