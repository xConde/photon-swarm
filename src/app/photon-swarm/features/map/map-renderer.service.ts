import { Injectable } from '@angular/core';
import { ThemeService } from '@services/theme.service';
import { ThemeColorPalette } from '@photon/config/game-constants';
import { FACTION_IDENTITIES } from '@photon/config/faction-identity.config';
import { MapEntities, Territory } from './map.model';
import { PaletteService } from '../../services/palette.service';

/**
 * Convert a canonical `#rrggbb` faction color to an `rgba(...)` string at a fixed alpha.
 * Called only at module load (see TERRITORY_COLORS / TERRITORY_BORDER_COLORS below) —
 * never per frame.
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Theme-aware map rendering service for arena shooter
 * Supports light/dark theme modes following website theme system
 * No fog of war - full strategic visibility
 */
@Injectable({
  providedIn: 'root',
})
export class MapRendererService {
  // Territory colors matching Four Kings — derived from the canonical faction identity
  // config (config/faction-identity.config.ts) so a hue change there propagates here
  // automatically. Alphas are tuned per-theme for map readability and preserved
  // independently of the config.
  private readonly TERRITORY_COLORS = {
    dark: {
      1: hexToRgba(FACTION_IDENTITIES[1].dark.territory.color, 0.25),
      2: hexToRgba(FACTION_IDENTITIES[2].dark.territory.color, 0.25),
      3: hexToRgba(FACTION_IDENTITIES[3].dark.territory.color, 0.25),
      4: hexToRgba(FACTION_IDENTITIES[4].dark.territory.color, 0.25),
    },
    light: {
      1: hexToRgba(FACTION_IDENTITIES[1].light.territory.color, 0.06), // faint tint so map stays readable
      2: hexToRgba(FACTION_IDENTITIES[2].light.territory.color, 0.06),
      3: hexToRgba(FACTION_IDENTITIES[3].light.territory.color, 0.06),
      4: hexToRgba(FACTION_IDENTITIES[4].light.territory.color, 0.06),
    },
  };

  // Pre-computed border colors (higher opacity than fill colors) — same canonical source.
  private readonly TERRITORY_BORDER_COLORS = {
    dark: {
      1: hexToRgba(FACTION_IDENTITIES[1].dark.territory.color, 0.35),
      2: hexToRgba(FACTION_IDENTITIES[2].dark.territory.color, 0.35),
      3: hexToRgba(FACTION_IDENTITIES[3].dark.territory.color, 0.35),
      4: hexToRgba(FACTION_IDENTITIES[4].dark.territory.color, 0.35),
    },
    light: {
      1: hexToRgba(FACTION_IDENTITIES[1].light.territory.color, 0.1),
      2: hexToRgba(FACTION_IDENTITIES[2].light.territory.color, 0.1),
      3: hexToRgba(FACTION_IDENTITIES[3].light.territory.color, 0.1),
      4: hexToRgba(FACTION_IDENTITIES[4].light.territory.color, 0.1),
    },
  };

  // Item rarity colors - theme aware
  private readonly RARITY_COLORS = {
    dark: {
      common: '#FFFFFF', // White
      rare: '#4169E1', // Blue
      epic: '#9932CC', // Purple
      legendary: '#FFD700', // Gold
    },
    light: {
      common: '#4a4a4a', // Dark gray
      rare: '#3a5cb8', // Muted blue
      epic: '#7d2aa8', // Muted purple
      legendary: '#b8860b', // Dark goldenrod
    },
  };

  constructor(
    private themeService: ThemeService,
    private paletteService: PaletteService
  ) {}

  /**
   * Get current theme colors for map rendering
   */
  private getMapColors(): ThemeColorPalette['MINIMAP'] {
    return this.paletteService.getMinimap();
  }

  /**
   * Get territory fill color based on current theme
   */
  private getTerritoryColor(kingId: number): string {
    const theme = this.themeService.isDayMode ? 'light' : 'dark';
    return (
      this.TERRITORY_COLORS[theme][kingId as keyof (typeof this.TERRITORY_COLORS)['dark']] || 'rgba(100, 100, 100, 0.2)'
    );
  }

  /**
   * Get territory border color based on current theme
   */
  private getTerritoryBorderColor(kingId: number): string {
    const theme = this.themeService.isDayMode ? 'light' : 'dark';
    return (
      this.TERRITORY_BORDER_COLORS[theme][kingId as keyof (typeof this.TERRITORY_BORDER_COLORS)['dark']] ||
      'rgba(100, 100, 100, 0.3)'
    );
  }

  /**
   * Get rarity color based on current theme
   */
  private getRarityColor(rarity: string): string {
    const theme = this.themeService.isDayMode ? 'light' : 'dark';
    return (
      this.RARITY_COLORS[theme][rarity as keyof (typeof this.RARITY_COLORS)['dark']] ||
      this.RARITY_COLORS[theme]['common']
    );
  }

  /**
   * Render the full strategic map - simplified to 3 layers
   */
  renderFullMap(
    ctx: CanvasRenderingContext2D,
    mapX: number,
    mapY: number,
    mapSize: number,
    playerX: number,
    playerY: number,
    viewRadius: number,
    territories: Territory[],
    entities: MapEntities
  ): void {
    // Save context state
    ctx.save();

    // Create clipping region for map
    ctx.beginPath();
    ctx.rect(mapX, mapY, mapSize, mapSize);
    ctx.clip();

    // Layer 1: Background and territories
    this.renderBackground(ctx, mapX, mapY, mapSize, playerX, playerY, viewRadius, territories);

    // Layer 2: Entities (enemies, powerups, hazards)
    this.renderEntities(ctx, mapX, mapY, mapSize, playerX, playerY, viewRadius, entities);

    // Layer 3: UI overlay (player, grid, indicators)
    this.renderUIOverlay(ctx, mapX, mapY, mapSize, playerX, playerY, viewRadius);

    // Restore context
    ctx.restore();

    // Draw map border (outside clip)
    this.renderMapBorder(ctx, mapX, mapY, mapSize);
  }

  /**
   * Layer 1: Background and territories - theme aware
   */
  private renderBackground(
    ctx: CanvasRenderingContext2D,
    mapX: number,
    mapY: number,
    mapSize: number,
    playerX: number,
    playerY: number,
    viewRadius: number,
    territories: Territory[]
  ): void {
    const colors = this.getMapColors();
    const isDayMode = this.themeService.isDayMode;

    // Theme-aware background
    ctx.fillStyle = colors.BACKGROUND;
    ctx.fillRect(mapX, mapY, mapSize, mapSize);

    // Add subtle vignette effect - theme aware
    const gradient = ctx.createRadialGradient(
      mapX + mapSize / 2,
      mapY + mapSize / 2,
      mapSize * 0.3,
      mapX + mapSize / 2,
      mapY + mapSize / 2,
      mapSize * 0.7
    );
    if (isDayMode) {
      gradient.addColorStop(0, 'rgba(248, 250, 252, 0)'); // Slate-50
      gradient.addColorStop(1, 'rgba(71, 85, 105, 0.12)'); // Slate-600
    } else {
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(mapX, mapY, mapSize, mapSize);

    // Render territories
    const scale = mapSize / (viewRadius * 2);

    for (const territory of territories) {
      const x = mapX + (territory.x - playerX + viewRadius) * scale;
      const y = mapY + (territory.y - playerY + viewRadius) * scale;
      const size = scale * 100;

      // Territory fill with theme-aware colors
      ctx.fillStyle = this.getTerritoryColor(territory.kingId);
      ctx.fillRect(x, y, size, size);

      // Territory border - subtle (pre-computed, no string manipulation)
      ctx.strokeStyle = this.getTerritoryBorderColor(territory.kingId);
      ctx.lineWidth = 0.3;
      ctx.strokeRect(x, y, size, size);
    }
  }

  /**
   * Layer 2: Entities - theme aware
   */
  private renderEntities(
    ctx: CanvasRenderingContext2D,
    mapX: number,
    mapY: number,
    mapSize: number,
    playerX: number,
    playerY: number,
    viewRadius: number,
    entities: MapEntities
  ): void {
    const colors = this.getMapColors();
    const isDayMode = this.themeService.isDayMode;
    const scale = mapSize / (viewRadius * 2);

    // Render all enemies with different styles based on threat level
    for (const enemy of entities.enemies || []) {
      const x = mapX + (enemy.x - playerX + viewRadius) * scale;
      const y = mapY + (enemy.y - playerY + viewRadius) * scale;

      // Skip if outside map bounds
      if (x < mapX || x > mapX + mapSize || y < mapY || y > mapY + mapSize) continue;

      // Enemy indicator - threat-based styling with theme colors
      let color: string;
      let glowColor: string; // Pre-computed RGBA for gradient
      let size: number;
      let showGlow = false;

      if (enemy.threat === 'boss') {
        color = isDayMode ? '#9932cc' : '#ff00ff'; // Dark orchid / magenta
        glowColor = isDayMode ? 'rgba(153, 50, 204, 0.5)' : 'rgba(255, 0, 255, 0.5)';
        size = 8;
        showGlow = !isDayMode; // No glow in light mode
      } else if (enemy.threat === 'elite') {
        color = colors.OBJECTIVE; // Goldenrod in both themes
        glowColor = 'rgba(218, 165, 32, 0.5)'; // Goldenrod with alpha
        size = 5;
        showGlow = !isDayMode;
      } else {
        // Normal enemies - smaller, no glow
        color = colors.ENEMY;
        glowColor = '';
        size = 3;
      }

      // PERFORMANCE: Gradient-based glow for elites/bosses instead of shadowBlur
      if (showGlow) {
        const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
        glowGradient.addColorStop(0, color);
        glowGradient.addColorStop(0.4, glowColor);
        glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();

      // Inner bright dot for elites and bosses
      if (enemy.threat === 'boss' || enemy.threat === 'elite') {
        ctx.fillStyle = isDayMode ? 'rgba(248, 250, 252, 0.9)' : 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x, y, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Health bar for bosses
      if (enemy.threat === 'boss' && enemy.health !== undefined) {
        ctx.fillStyle = colors.ENEMY;
        ctx.fillRect(x - 10, y - 12, 20 * enemy.health, 2);
        ctx.strokeStyle = isDayMode ? 'rgba(47, 79, 79, 0.5)' : 'rgba(255, 255, 255, 0.5)';
        ctx.strokeRect(x - 10, y - 12, 20, 2);
      }
    }

    // Render item indicators with theme-aware rarity colors
    for (const item of entities.items || []) {
      const x = mapX + (item.x - playerX + viewRadius) * scale;
      const y = mapY + (item.y - playerY + viewRadius) * scale;

      const pulse = 0.7 + Math.sin(Date.now() / 500) * 0.3;
      ctx.fillStyle = this.getRarityColor(item.rarity || 'common');
      ctx.globalAlpha = pulse;

      // Shards: smaller diamond; Powerups: larger diamond
      const half = item.type === 'shard' ? 2 : 3;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-half, -half, half * 2, half * 2);
      ctx.strokeStyle = isDayMode ? 'rgba(47, 79, 79, 0.5)' : 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(-half, -half, half * 2, half * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Render asteroid hazards
    for (const asteroid of entities.asteroids || []) {
      const x = mapX + (asteroid.x - playerX + viewRadius) * scale;
      const y = mapY + (asteroid.y - playerY + viewRadius) * scale;

      // Hazard warning indicator - theme aware
      ctx.fillStyle = colors.OBJECTIVE; // Orange/goldenrod for hazards
      ctx.strokeStyle = colors.DANGER;
      ctx.lineWidth = 1.5;

      // Triangle warning symbol
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 4, y + 3);
      ctx.lineTo(x - 4, y + 3);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Layer 3: UI Overlay - theme aware
   */
  private renderUIOverlay(
    ctx: CanvasRenderingContext2D,
    mapX: number,
    mapY: number,
    mapSize: number,
    playerX: number,
    playerY: number,
    viewRadius: number
  ): void {
    const colors = this.getMapColors();
    const isDayMode = this.themeService.isDayMode;
    const scale = mapSize / (viewRadius * 2);

    // Grid overlay - theme aware
    ctx.strokeStyle = colors.GRID;
    ctx.lineWidth = 0.3;
    const gridSize = 1000 * scale; // Larger grid squares

    for (let i = 0; i <= (viewRadius * 2) / 500; i++) {
      const pos = i * gridSize;
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(mapX + pos, mapY);
      ctx.lineTo(mapX + pos, mapY + mapSize);
      ctx.stroke();
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(mapX, mapY + pos);
      ctx.lineTo(mapX + mapSize, mapY + pos);
      ctx.stroke();
    }

    // Player indicator (always centered)
    const centerX = mapX + mapSize / 2;
    const centerY = mapY + mapSize / 2;

    ctx.fillStyle = colors.PLAYER;
    ctx.strokeStyle = colors.PLAYER_GLOW;
    ctx.lineWidth = 2;

    // Player arrow - larger and more visible
    ctx.save();
    ctx.translate(centerX, centerY);

    // PERFORMANCE: Gradient-based glow for player instead of shadowBlur (dark mode only)
    if (!isDayMode) {
      const playerGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, 20);
      playerGlow.addColorStop(0, 'rgba(0, 255, 255, 0.6)');
      playerGlow.addColorStop(0.5, 'rgba(0, 255, 255, 0.2)');
      playerGlow.addColorStop(1, 'rgba(0, 255, 255, 0)');
      ctx.fillStyle = playerGlow;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = colors.PLAYER;
    ctx.strokeStyle = isDayMode ? 'rgba(47, 79, 79, 0.8)' : 'rgba(255, 255, 255, 0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center dot
    ctx.fillStyle = isDayMode ? 'rgba(248, 250, 252, 0.95)' : 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Player position text
    ctx.fillStyle = colors.HUD_TEXT;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`[${Math.floor(playerX)}, ${Math.floor(playerY)}]`, centerX, mapY + mapSize + 20);
  }

  /**
   * Render map border - theme aware
   */
  private renderMapBorder(ctx: CanvasRenderingContext2D, mapX: number, mapY: number, mapSize: number): void {
    const colors = this.getMapColors();
    const isDayMode = this.themeService.isDayMode;

    // Outer border - theme aware
    ctx.strokeStyle = colors.FRAME;
    ctx.lineWidth = 2;
    ctx.strokeRect(mapX - 1, mapY - 1, mapSize + 2, mapSize + 2);

    // Inner glow (dark mode only for neon effect)
    if (!isDayMode) {
      ctx.strokeStyle = colors.FRAME_GLOW;
      ctx.lineWidth = 1;
      ctx.strokeRect(mapX - 2, mapY - 2, mapSize + 4, mapSize + 4);
    }
  }

  /**
   * Get exploration percentage (removed - always 100% for arena shooter)
   */
  getExplorationPercentage(): number {
    return 100; // Full map always visible
  }
}

// Re-export types from model for backwards compatibility
export type { MapEntities, Territory } from './map.model';
