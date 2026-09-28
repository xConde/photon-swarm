// src/app/sections/pages/projects/lazy-projects/photon-swarm/core/render.service.ts
import { inject, Injectable } from '@angular/core';
import { EngineSystem } from './system';
import { Enemy, EnemyType } from '../models/enemy.model';
import { Projectile } from '../models/projectile.model';
import { EnemyProperties } from '../models/game-types.model';
import { ThemeService } from '@services/theme.service';
import { ThemeColorPalette } from '@photon/config/game-constants';
import { PaletteService } from '../../services/palette.service';
import { RenderColorCacheService } from '../engine/render-color-cache.service';

export interface RenderOptions {
  voidBeamEnabled?: boolean;
  hasShield?: boolean;
  timeDilationEnabled?: boolean;
  burnSpreadEnabled?: boolean;
  shieldBreakerEnabled?: boolean;
}

@EngineSystem()
@Injectable({ providedIn: 'root' })
export class RenderService {
  private readonly paletteService = inject(PaletteService);
  private readonly themeService = inject(ThemeService);
  private readonly colorCache = inject(RenderColorCacheService);

  private hexParseCache = new Map<string, [number, number, number]>();

  private cachedRgba(r: number, g: number, b: number, a: number): string {
    return this.colorCache.cachedRgba(r, g, b, a);
  }

  /**
   * Theme-aware canvas colors with colorblind overrides applied.
   * Memoization lives in PaletteService so the cache is shared across
   * every renderer instead of duplicated per-service.
   */
  private get canvasColors(): ThemeColorPalette['CANVAS'] {
    return this.paletteService.getCanvas();
  }

  /** Clear entire canvas */
  clear(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h);
  }

  /**
   * Draw cyber bubble discharge effect.
   * Color is theme-aware: deep pink in dark mode, violet in light mode (CANVAS.DISCHARGE).
   * A single expanding bubble that pops at max radius.
   */
  renderDischargeEffects(
    ctx: CanvasRenderingContext2D,
    effects: { x: number; y: number; currentRadius: number; maxRadius: number }[],
    _voidBeamEnabled: boolean = false,
    frameTime: number = Date.now()
  ): void {
    // Parse theme-aware discharge color to RGB components once per call
    const [dr, dg, db] = this.parseHex(this.canvasColors.DISCHARGE);
    // Lighter variant for gradient center
    const cr = Math.min(255, Math.round(dr * 1.2));
    const cg = Math.min(255, Math.round(dg * 1.2));
    const cb = Math.min(255, Math.round(db * 1.2));

    ctx.save();
    for (const ef of effects) {
      const MAX_SANE_RADIUS = 400; // Max radius for area attack
      const clampedRadius = Math.min(ef.currentRadius || 0, MAX_SANE_RADIUS);
      const clampedMaxRadius = Math.min(ef.maxRadius || 0, MAX_SANE_RADIUS);

      // Calculate progress (0 to 1)
      const progress = clampedRadius / clampedMaxRadius;

      // Bubble pops at 90% progress for visual impact
      if (progress >= 0.9) {
        // Pop effect - scatter particles
        const particleCount = 16;
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2;
          const particleProgress = (progress - 0.9) * 10; // 0 to 1 for last 10%
          const particleRadius = clampedMaxRadius + particleProgress * 50;
          const px = ef.x + Math.cos(angle) * particleRadius;
          const py = ef.y + Math.sin(angle) * particleRadius;
          const particleOpacity = Math.max(0, 1 - particleProgress);

          ctx.fillStyle = this.cachedRgba(dr, dg, db, particleOpacity * 0.6);
          ctx.beginPath();
          ctx.arc(px, py, 4 * (1 - particleProgress), 0, Math.PI * 2);
          ctx.fill();
        }
        continue; // Skip main bubble rendering when popping
      }

      // Main cyber bubble
      const bubbleOpacity = Math.max(0, 1 - progress * 0.3); // Fade slightly as it expands

      // Outer glow via gradient (replaces shadowBlur for performance)
      const glowGradient = ctx.createRadialGradient(ef.x, ef.y, clampedRadius, ef.x, ef.y, clampedRadius + 30);
      glowGradient.addColorStop(0, this.cachedRgba(dr, dg, db, bubbleOpacity * 0.35));
      glowGradient.addColorStop(1, this.cachedRgba(dr, dg, db, 0));
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, clampedRadius + 30, 0, Math.PI * 2);
      ctx.fill();

      // Bubble surface with gradient
      const gradient = ctx.createRadialGradient(ef.x, ef.y, clampedRadius * 0.5, ef.x, ef.y, clampedRadius);
      gradient.addColorStop(0, this.cachedRgba(cr, cg, cb, bubbleOpacity * 0.1)); // Light center
      gradient.addColorStop(0.7, this.cachedRgba(dr, dg, db, bubbleOpacity * 0.2)); // Mid
      gradient.addColorStop(1, this.cachedRgba(dr, dg, db, bubbleOpacity * 0.4)); // Edge

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, clampedRadius, 0, Math.PI * 2);
      ctx.fill();

      // Bubble border - cyberpunk style segments
      ctx.strokeStyle = this.cachedRgba(dr, dg, db, bubbleOpacity * 0.8);
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 5]); // Dashed line for cyber effect
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, clampedRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Inner energy ring
      const energyPulse = Math.sin(frameTime * 0.01) * 0.2 + 0.8;
      ctx.strokeStyle = this.cachedRgba(255, 255, 255, bubbleOpacity * 0.6 * energyPulse);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ef.x, ef.y, clampedRadius * 0.95, 0, Math.PI * 2);
      ctx.stroke();

      // Digital glitch lines for cyber effect
      if (Math.random() < 0.3) {
        // 30% chance for glitch effect
        const glitchCount = 3;
        for (let i = 0; i < glitchCount; i++) {
          const glitchAngle = Math.random() * Math.PI * 2;
          const glitchStart = clampedRadius * 0.3;
          const glitchEnd = clampedRadius * 0.9;

          ctx.strokeStyle = this.cachedRgba(dr, dg, db, bubbleOpacity * 0.4);
          ctx.lineWidth = Math.random() * 2 + 1;
          ctx.beginPath();
          ctx.moveTo(ef.x + Math.cos(glitchAngle) * glitchStart, ef.y + Math.sin(glitchAngle) * glitchStart);
          ctx.lineTo(ef.x + Math.cos(glitchAngle) * glitchEnd, ef.y + Math.sin(glitchAngle) * glitchEnd);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /** Draw all projectiles */
  renderProjectiles(
    ctx: CanvasRenderingContext2D,
    projectiles: Projectile[],
    enemyProps: Record<EnemyType, EnemyProperties>
  ): void {
    ctx.save();
    for (const p of projectiles) {
      const hit = p.hitTime && window.performance.now() - p.hitTime < 150;
      if (hit) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      // health-ring on projectile
      let baseH = 1;
      if (p.color === enemyProps.sniper?.projectileColor) baseH = enemyProps.sniper.projectileHealth ?? 3;
      else if (p.color === enemyProps.spitter?.projectileColor) baseH = enemyProps.spitter.projectileHealth ?? 1;

      if (p.health < baseH) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 0.6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * Draw all enemies.
   * options.burnSpreadEnabled → more burn particles
   * options.shieldBreakerEnabled → jagged shield cracks
   */
  renderEnemies(
    ctx: CanvasRenderingContext2D,
    enemies: Enemy[],
    enemyProps: Record<EnemyType, EnemyProperties>,
    rarityMods: Record<string, { speed: number; health: number; radius: number; shards: number }>,
    shieldedSnipers: Map<Enemy, { thug: Enemy; shieldHealth: number; maxShield: number }>,
    _playerX: number,
    _playerY: number,
    options: RenderOptions = {}
  ): void {
    ctx.save();
    const { burnSpreadEnabled = false, shieldBreakerEnabled = false } = options;

    for (const e of enemies) {
      // ensure maxHealth
      if (e.maxHealth == null) {
        const bH = enemyProps[e.type]?.health || 2;
        const mH = rarityMods[e.rarity || 'common'].health || 1;
        e.maxHealth = bH * mH;
      }

      // base color by rarity (theme-aware default)
      let base = enemyProps[e.type]?.color || this.canvasColors.ACCENT_CYAN;
      const rarityStr = e.rarity ? String(e.rarity) : '';
      if (rarityStr === 'legendary') base = '#1e90ff';
      else if (rarityStr === 'epic') base = '#ff8c00';
      else if (rarityStr === 'rare') base = '#ffcc00';

      // elite glow (theme-aware highlight)
      if (e.isElite) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = this.canvasColors.STROKE_PRIMARY;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * 1.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        base = this.blend(base, this.canvasColors.STROKE_PRIMARY, 0.3);
      }

      // body
      ctx.fillStyle = e.color || base;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fill();

      // type overlays
      if (e.type === EnemyType.Spitter) this.spitter(ctx, e, enemyProps.spitter);
      if (e.type === EnemyType.Thug) this.thug(ctx, e);
      if (e.type === EnemyType.Sniper)
        this.sniper(ctx, e, enemyProps.sniper, shieldedSnipers.get(e), shieldBreakerEnabled);

      // health bar
      if ((e.health || 0) < (e.maxHealth || 1)) {
        this.healthBar(ctx, e);
      }

      // burn particles
      if (e.burning) {
        this.burnParticles(ctx, e, burnSpreadEnabled);
      }
    }
    ctx.restore();
  }

  //─── private helpers ─────────────────────────────────────────────

  private spitter(ctx: CanvasRenderingContext2D, e: Enemy, p: EnemyProperties): void {
    const scale = 0.5 + 0.2 * Math.sin(e.pulsePhase || 0);
    // Theme-aware spitter eye colors
    const focusingColor = this.canvasColors.STROKE_PRIMARY;
    const idleColor = this.themeService.isDayMode ? '#2f4f4f' : '#ddeeff';
    ctx.fillStyle = e.isFocusing ? focusingColor : idleColor;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * scale, 0, Math.PI * 2);
    ctx.fill();

    if (e.isFocusing && e.focusStartTime) {
      const prog = Math.min(1, (window.performance.now() - e.focusStartTime) / (p.focusTime || 1000));
      if (prog > 0.7) {
        ctx.strokeStyle = this.cachedRgba(0, 170, 255, 0.2 + prog * 0.6);
        ctx.lineWidth = 1 + prog * 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (1 + prog * 0.5), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.strokeStyle = '#66ccff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI + (e.pulsePhase || 0) * 0.5;
      const sx = e.x + Math.cos(a) * e.radius;
      const sy = e.y + Math.sin(a) * e.radius;
      const ex = e.x + Math.cos(a) * e.radius * 1.3;
      const ey = e.y + Math.sin(a) * e.radius * 1.3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  private thug(ctx: CanvasRenderingContext2D, e: Enemy): void {
    ctx.fillStyle = '#663300';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();

    const plates = 6;
    for (let i = 0; i < plates; i++) {
      const ang = (i / plates) * 2 * Math.PI + window.performance.now() / 1000;
      const cx = e.x + Math.cos(ang) * e.radius * 0.8;
      const cy = e.y + Math.sin(ang) * e.radius * 0.8;
      ctx.fillStyle = '#aa6600';
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        const a2 = (j / 6) * 2 * Math.PI;
        const px = cx + Math.cos(a2) * e.radius * 0.3;
        const py = cy + Math.sin(a2) * e.radius * 0.3;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      const sx = cx + Math.cos(ang) * e.radius * 0.4;
      const sy = cy + Math.sin(ang) * e.radius * 0.4;
      ctx.strokeStyle = '#cc3300';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }

  private sniper(
    ctx: CanvasRenderingContext2D,
    e: Enemy,
    p: EnemyProperties,
    shieldData: { thug: Enemy; shieldHealth: number; maxShield: number } | undefined,
    shieldBreaker: boolean
  ): void {
    const scale = 0.6 + 0.2 * Math.sin(e.pulsePhase || 0);
    ctx.fillStyle = e.isFocusing ? '#ff3333' : '#aa1111';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius * scale, 0, Math.PI * 2);
    ctx.fill();

    if (e.isFocusing && e.focusStartTime && e.focusDirection) {
      const prog = Math.min(1, (window.performance.now() - e.focusStartTime) / (p.focusTime || 1000));
      if (prog > 0.5) {
        const len = 300 * prog;
        const ex = e.x + e.focusDirection.x * len;
        const ey = e.y + e.focusDirection.y * len;
        ctx.strokeStyle = this.cachedRgba(255, 0, 0, (prog - 0.5) * 2 * 0.7);
        ctx.lineWidth = 1 + prog;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        const r = 5 + 3 * Math.sin(window.performance.now() / 80);
        ctx.strokeStyle = this.cachedRgba(255, 0, 0, prog);
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (shieldData) {
      const pct = shieldData.shieldHealth / shieldData.maxShield;
      const op = 0.3 + pct * 0.5;
      const pulse = 1 + 0.05 * Math.sin(window.performance.now() / 150);
      ctx.strokeStyle = this.cachedRgba(255, 150, 50, op);
      ctx.lineWidth = 2 + pct * 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius * 1.2 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      if (shieldBreaker) {
        // draw jagged cracks
        ctx.strokeStyle = this.cachedRgba(255, 50, 50, op);
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
          const a1 = Math.random() * 2 * Math.PI;
          const a2 = a1 + (Math.random() * 0.4 - 0.2);
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(a1) * e.radius * 1.2 * pulse, e.y + Math.sin(a1) * e.radius * 1.2 * pulse);
          ctx.lineTo(e.x + Math.cos(a2) * e.radius * 1.4 * pulse, e.y + Math.sin(a2) * e.radius * 1.4 * pulse);
          ctx.stroke();
        }
      }
    }
  }

  private healthBar(ctx: CanvasRenderingContext2D, e: Enemy): void {
    const w = e.radius * 1.6,
      h = 4;
    const x = e.x - w / 2,
      y = e.y - e.radius - h - 4;
    const pct = Math.max(0, e.health / e.maxHealth);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    let col = 'rgba(0,255,0,0.8)';
    if (pct < 0.66) col = 'rgba(255,255,0,0.8)';
    if (pct < 0.33) col = 'rgba(255,0,0,0.8)';
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * pct, h);
  }

  private burnParticles(ctx: CanvasRenderingContext2D, e: Enemy, spread: boolean): void {
    const count = spread ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const dist = e.radius * (spread ? 1 : 0.7);
      const px = e.x + Math.cos(angle) * dist;
      const py = e.y + Math.sin(angle) * dist - (spread ? Math.random() * 3 : 0);
      ctx.fillStyle = Math.random() < 0.5 ? '#ff6600' : '#ffcc00';
      const sz = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.arc(px, py, sz, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Parse a hex color string to [r, g, b], with caching */
  private parseHex(hex: string): [number, number, number] {
    let cached = this.hexParseCache.get(hex);
    if (!cached) {
      if (this.hexParseCache.size > 128) this.hexParseCache.clear();
      let h = hex.replace(/^#/, '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const m = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
      cached = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
      this.hexParseCache.set(hex, cached);
    }
    return cached;
  }

  /** blend two hex colors */
  private blend(c1: string, c2: string, t: number): string {
    const [r1, g1, b1] = this.parseHex(c1),
      [r2, g2, b2] = this.parseHex(c2);
    const r = Math.round(r1 * (1 - t) + r2 * t),
      g = Math.round(g1 * (1 - t) + g2 * t),
      b = Math.round(b1 * (1 - t) + b2 * t);
    return `rgb(${r},${g},${b})`;
  }
}
