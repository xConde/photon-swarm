// Extracted from FourKingsTerritoryService (Campaign D — god-service decomp).
// Pure tile color computation: dynamic tile colors, faction color variation,
// color-distance validation, neutral background. Read-only — never mutates territory grid state.

import { Injectable } from '@angular/core';
import { ThemeService } from '@services/theme.service';
import { FACTION_IDENTITIES, FactionId, KING_FACTION_IDS } from '@photon/config/faction-identity.config';
import { KingConfig, TerritoryTile } from '../../models/territory.model';

@Injectable({ providedIn: 'root' })
export class TerritoryColorService {
  // Cache for getFactionColorVariations — keyed by `${kingId}-${isDayMode ? 1 : 0}`, only 10 possible entries
  private factionColorCache = new Map<string, string[]>();

  constructor(private themeService: ThemeService) {}

  /**
   * Render neutral background when territory system is not fully initialized
   * This prevents players from seeing "naked" tiles
   */
  renderNeutralBackground(ctx: CanvasRenderingContext2D, camera: { x: number; y: number }, tileSize: number): void {
    // Calculate visible screen area in tiles
    const startTileX = Math.floor(camera.x / tileSize);
    const startTileY = Math.floor(camera.y / tileSize);
    const endTileX = Math.ceil((camera.x + ctx.canvas.width) / tileSize);
    const endTileY = Math.ceil((camera.y + ctx.canvas.height) / tileSize);

    // Render neutral tiles for the visible area
    ctx.fillStyle = '#1a1a1a'; // Dark neutral background
    ctx.globalAlpha = 0.05; // Cap at 0.05 for visibility

    for (let tileX = startTileX; tileX <= endTileX; tileX++) {
      for (let tileY = startTileY; tileY <= endTileY; tileY++) {
        // Canvas is already translated by game-rendering.service.ts
        // Draw at world positions, not screen positions!
        const worldX = tileX * tileSize;
        const worldY = tileY * tileSize;

        // Draw the tile (viewport check is done by startTileX/endTileX calculation)
        ctx.fillRect(worldX, worldY, tileSize, tileSize);

        // Add subtle grid lines
        ctx.strokeStyle = '#2a2a2a';
        ctx.globalAlpha = 0.1;
        ctx.lineWidth = 1;
        ctx.strokeRect(worldX, worldY, tileSize, tileSize);
        ctx.globalAlpha = 0.05; // Reset for next tile
      }
    }

    ctx.globalAlpha = 1; // Reset alpha
  }

  /**
   * Get dynamic color variation for a territory tile based on its properties
   */
  getDynamicTileColor(
    x: number,
    y: number,
    king: KingConfig,
    territory: TerritoryTile | null,
    gridWidth: number,
    coreTilesPerKing: Map<number, Set<number>>,
    borderTilesPerKing: Map<number, Set<number>>
  ): {
    base: string;
    secondary: string | null;
    glow: string;
    accent: string;
  } {
    if (!territory) {
      return {
        base: king.baseColor,
        secondary: null,
        glow: king.glowColor,
        accent: king.color,
      };
    }

    // Generate deterministic variations based on tile position and properties
    const seed = x * 1000 + y + territory.kingId * 10000;
    const variation = this.seededRandom(seed);

    // Calculate tile context
    const flatIdx = y * gridWidth + x;
    // Sprint 8: use pre-computed core tile set instead of counting neighbors per frame
    const isCoreTile = coreTilesPerKing.get(territory.kingId)?.has(flatIdx) ?? false;
    const isBorderTile = borderTilesPerKing.get(territory.kingId)?.has(flatIdx) ?? false;
    const isRoadTile = territory.contested;
    const tileAge = territory.age;
    const tileStrength = territory.strength;

    // Base color variations for each faction
    const colorVariations = this.getFactionColorVariations(king.id);

    // Select color variant based on tile properties
    let baseColorIndex: number;
    let secondaryColorIndex = null;

    if (isRoadTile) {
      // Road tiles use darker, muted variants
      baseColorIndex = 4; // Darkest variant
      secondaryColorIndex = 3; // Dark secondary
    } else if (isCoreTile) {
      // Core tiles use rich, saturated colors
      baseColorIndex = variation < 0.3 ? 0 : variation < 0.7 ? 1 : 2; // Bright variants
      if (tileStrength > 0.8) {
        secondaryColorIndex = 1; // Add secondary for strong core tiles
      }
    } else if (isBorderTile) {
      // Border tiles use medium variants with some variation
      baseColorIndex = variation < 0.5 ? 2 : 3; // Medium variants
    } else {
      // Standard tiles use main color with subtle variation
      baseColorIndex = variation < 0.4 ? 0 : variation < 0.8 ? 1 : 2;
    }

    // Add age-based weathering
    if (tileAge > 50) {
      baseColorIndex = Math.min(baseColorIndex + 1, colorVariations.length - 1);
    }

    return {
      base: colorVariations[baseColorIndex],
      secondary: secondaryColorIndex !== null ? colorVariations[secondaryColorIndex] : null,
      glow: king.glowColor,
      accent: colorVariations[Math.min(baseColorIndex + 1, colorVariations.length - 1)],
    };
  }

  /**
   * Get color variations for each faction (theme-aware)
   */
  getFactionColorVariations(kingId: number): string[] {
    const isDayMode = this.themeService.isDayMode;
    const cacheKey = `${kingId}-${isDayMode ? 1 : 0}`;
    const cached = this.factionColorCache.get(cacheKey);
    if (cached) return cached;

    // Ramps are declared once in config/faction-identity.config.ts. Only the four
    // warring factions hold territory; anything else keeps the historical
    // single-color fallback rather than borrowing Neutral's ramp.
    const identity = KING_FACTION_IDS.includes(kingId as FactionId) ? FACTION_IDENTITIES[kingId as FactionId] : null;
    const result: string[] = identity
      ? [...(isDayMode ? identity.light : identity.dark).territoryRamp]
      : [isDayMode ? '#94a3b8' : '#ffffff'];

    this.factionColorCache.set(cacheKey, result);
    return result;
  }

  /**
   * Seeded random number generator for consistent variations
   */
  seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  /**
   * Validate color distinguishability between factions (development helper)
   */
  validateColorDistinguishability(): void {
    if (typeof window !== 'undefined' && window.console) {
      const factions = [1, 2, 3, 4];
      const minDistanceThreshold = 50; // Minimum perceptual color distance

      if (window.debugLogBridge) {
        window.debugLogBridge.log('🎨 Faction Color Distinguishability Analysis:', 'info');
      }

      for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
          const faction1Colors = this.getFactionColorVariations(factions[i]);
          const faction2Colors = this.getFactionColorVariations(factions[j]);

          // Check primary colors
          const distance = this.calculateColorDistance(faction1Colors[0], faction2Colors[0]);
          const faction1Name = ['Crimson', 'Azure', 'Verdant', 'Shadow'][i];
          const faction2Name = ['Crimson', 'Azure', 'Verdant', 'Shadow'][j];

          if (window.debugLogBridge) {
            window.debugLogBridge.log(
              `${faction1Name} vs ${faction2Name}: Distance ${distance.toFixed(1)} ${distance > minDistanceThreshold ? '✅' : '❌'}`,
              'info'
            );
          }

          // Check darkest variants for potential confusion
          const darkDistance = this.calculateColorDistance(
            faction1Colors[faction1Colors.length - 1],
            faction2Colors[faction2Colors.length - 1]
          );
          if (window.debugLogBridge) {
            window.debugLogBridge.log(
              `  Dark variants: Distance ${darkDistance.toFixed(1)} ${darkDistance > 25 ? '✅' : '❌'}`,
              'info'
            );
          }
        }
      }
    }
  }

  /**
   * Calculate perceptual color distance using Delta E approximation
   */
  calculateColorDistance(color1: string, color2: string): number {
    const rgb1 = this.hexToRgb(color1);
    const rgb2 = this.hexToRgb(color2);

    if (!rgb1 || !rgb2) return 0;

    // Simple Euclidean distance in RGB space (approximation)
    const dr = rgb1.r - rgb2.r;
    const dg = rgb1.g - rgb2.g;
    const db = rgb1.b - rgb2.b;

    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /**
   * Convert hex color to RGB
   */
  hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  }
}
