import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { MinimapEntities, Territory } from './map.model';
import { ThemeService } from '@services/theme.service';
import {
  GUARDIAN_DEFINITIONS,
  ThemeColorPalette,
  TREASURE_CONFIG,
  ZONE_GATE_DEFINITIONS,
} from '@photon/config/game-constants';
import {
  FACTION_IDENTITIES,
  getFactionName,
  getFactionTheme,
  KING_FACTION_IDS,
} from '@photon/config/faction-identity.config';
import { PaletteService } from '../../services/palette.service';
import {
  GuardianSpawnerSystemService,
  TreasureCacheSystemService,
  ZoneConfigService,
  ZoneStateService,
} from '../../core/systems/world';
import { ZoneId } from '../../core/models/zone.model';

/**
 * Convert a canonical `#rrggbb` faction color to an `rgba(...)` string at a fixed alpha.
 * Called only at module load (see MINIMAP_CONFIG.territoryColors below) — never per frame.
 */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Minimap renderer with theme-aware aesthetics
 * High performance, real-time tactical display
 * Supports light/dark theme modes following website theme system
 */
@Injectable({
  providedIn: 'root',
})
export class MinimapRendererService {
  // Performance optimization
  private radarSweepAngle = 0;
  private pulsePhase = 0;

  // Cached background OffscreenCanvas — keyed by (isDayMode << 1 | isInCombat).
  // Index 0 = dark+peace, 1 = dark+combat, 2 = light+peace, 3 = light+combat.
  // Invalidated (set to null) on theme flip so the next renderBackground call
  // repaints it.  Falls back to direct gradient if OffscreenCanvas is unavailable
  // (e.g. Karma test environment).
  private readonly bgCache: (OffscreenCanvas | null)[] = [null, null, null, null];
  private bgCacheLastDayMode: boolean | null = null;

  // Pre-allocated flat territory grid — 8x8 cells as Int8Array.
  // -1 = no territory, 0-127 = kingId.  Avoids per-frame array/object allocation.
  private readonly territoryGridFlat = new Int8Array(64);

  // Pre-computed base RGB strings for spawn warnings (no per-frame string concat).
  // Each entry: [lightRgb, darkRgb].
  private readonly spawnWarningRgb: Readonly<Record<string, [string, string]>> = {
    elite: ['113,54,170', '168,85,247'],
    swarm: ['184,69,10', '255,107,53'],
    default: ['41,121,178', '255,80,80'],
  };

  // Blackout event state — dims the minimap heavily during the event
  private _blackoutActive = false;

  // Pre-allocated arrays for zone boundary rendering — avoids per-frame allocation
  private readonly zoneDashArray: number[] = [3, 3];
  private readonly zoneEmptyDash: number[] = [];

  // Pre-cached zone boundary colors keyed by zone id, per theme
  // Format: { locked: 'rgba(r,g,b,0.5)', unlocked: 'rgba(r,g,b,0.8)' }
  private readonly zoneBoundaryColors = new Map<number, { locked: string; unlocked: string }>();

  // Pre-cached POI colors keyed by zone id
  // treasure uses accentColor, guardian uses themeColor
  private readonly poiColors = new Map<
    number,
    { treasureClosed: string; treasureOpen: string; guardianAlive: string; guardianDead: string }
  >();

  // Pre-allocated scratch array for POI rendering — reused each frame via length = 0.
  // Each slot object is mutated in place (no per-frame allocation).
  // PERF: pre-allocated — slots are filled via property assignment, not object literals.
  private readonly poiScratchArray: Array<{
    type: string;
    x: number;
    y: number;
    state: string;
    zoneId: number;
    id: number;
  }> = [];
  /** Maximum expected POI count (12 guardians + N caches). Pre-fill slots to avoid push allocation. */
  private poiScratchInitialized = false;

  // Flash tracking — key is `cache_${cacheId}` or `guardian_${guardianId}`, value is start timestamp.
  // Populated on event trigger (not per-frame), cleaned up lazily during render.
  private readonly poiFlashTimes = new Map<string, number>();

  // Guardian liveness from the previous frame — used to detect alive→dead transitions each render.
  private readonly previousGuardianAlive = new Map<number, boolean>();

  // Subscription for cache-opened events — stored for cleanup.
  private cacheOpenedSub: Subscription | null = null;

  // Pre-cached flash halo colors keyed by zone id (accent for cache, theme for guardian).
  private readonly flashHaloColors = new Map<number, { cache: string; guardian: string }>();

  public set blackoutActive(value: boolean) {
    this._blackoutActive = value;
  }

  // Core configuration (non-color values)
  private readonly MINIMAP_CONFIG = {
    radius: 800,
    size: 200,
    // Territory colors matching Four Kings — derived from the canonical faction identity
    // config (config/faction-identity.config.ts) so a hue change there propagates here
    // automatically. Alphas are tuned per-theme for minimap readability.
    territoryColors: {
      1: {
        dark: hexToRgba(FACTION_IDENTITIES[1].dark.territory.color, 0.25),
        light: hexToRgba(FACTION_IDENTITIES[1].light.territory.color, 0.14),
      },
      2: {
        dark: hexToRgba(FACTION_IDENTITIES[2].dark.territory.color, 0.25),
        light: hexToRgba(FACTION_IDENTITIES[2].light.territory.color, 0.14),
      },
      3: {
        dark: hexToRgba(FACTION_IDENTITIES[3].dark.territory.color, 0.25),
        light: hexToRgba(FACTION_IDENTITIES[3].light.territory.color, 0.14),
      },
      4: {
        dark: hexToRgba(FACTION_IDENTITIES[4].dark.territory.color, 0.25),
        light: hexToRgba(FACTION_IDENTITIES[4].light.territory.color, 0.14),
      },
    },
    // Animation speeds
    animation: {
      radarSpeed: 0.02,
      pulseSpeed: 0.003,
      glitchChance: 0.005,
      staticIntensity: 0.02,
    },
  };

  // Pre-cached gate colors keyed by zone id (destination zone themeColor).
  // Locked gate icon uses the destination zone color so the player knows where it leads.
  private readonly gateColors = new Map<number, { locked: string; lockedRgb: string }>();

  // Pre-cached faction legend entries (debug-mode minimap layer), one array per theme —
  // computed once from the canonical faction identity config so neither the name nor the
  // color can drift from FACTION_IDENTITIES. Selected by isDayMode at render time; never
  // rebuilt per frame.
  private readonly factionLegendDark: ReadonlyArray<{ name: string; color: string }>;
  private readonly factionLegendLight: ReadonlyArray<{ name: string; color: string }>;

  constructor(
    private themeService: ThemeService,
    private zoneConfig: ZoneConfigService,
    private zoneState: ZoneStateService,
    private treasureCacheSystem: TreasureCacheSystemService,
    private guardianSpawner: GuardianSpawnerSystemService,
    private paletteService: PaletteService
  ) {
    this.precacheZoneBoundaryColors();
    this.precachePoiColors();
    this.precacheGateColors();
    // Short label = first word of the canonical name ('Crimson Legion' -> 'Crimson').
    // The legend panel is a fixed 52px wide at a 7px monospace font (~9 characters),
    // so full multi-word canonical names ('Shadow Syndicate', 'Azure Order') don't fit.
    this.factionLegendDark = KING_FACTION_IDS.map((id) => ({
      name: getFactionName(id).split(' ')[0],
      color: getFactionTheme(id, false).territory.color,
    }));
    this.factionLegendLight = KING_FACTION_IDS.map((id) => ({
      name: getFactionName(id).split(' ')[0],
      color: getFactionTheme(id, true).territory.color,
    }));
    this.cacheOpenedSub = this.treasureCacheSystem.cacheOpened$.subscribe(({ cacheId }) => {
      this.poiFlashTimes.set(`cache_${cacheId}`, Date.now());
    });
  }

  /**
   * Clean up event subscriptions. Call when the game session ends.
   */
  destroy(): void {
    this.cacheOpenedSub?.unsubscribe();
    this.cacheOpenedSub = null;
    this.poiFlashTimes.clear();
    this.previousGuardianAlive.clear();
  }

  /**
   * Pre-compute zone boundary RGBA strings from each zone's hex themeColor.
   * Called once in the constructor — no string work during render loops.
   */
  private precacheZoneBoundaryColors(): void {
    for (const zone of this.zoneConfig.getAllZones()) {
      const hex = zone.themeColor;
      // Parse #rrggbb — themeColor is always a 6-digit hex string per zone.config.ts
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      this.zoneBoundaryColors.set(zone.id, {
        locked: `rgba(${r},${g},${b},0.3)`,
        unlocked: `rgba(${r},${g},${b},0.5)`,
      });
    }
  }

  /**
   * Pre-compute POI RGBA strings from each zone's themeColor (guardian) and accentColor (treasure).
   * Called once in the constructor — no string work during render loops.
   */
  private precachePoiColors(): void {
    for (const zone of this.zoneConfig.getAllZones()) {
      // accentColor drives treasure markers
      const ah = zone.accentColor;
      const ar = parseInt(ah.slice(1, 3), 16);
      const ag = parseInt(ah.slice(3, 5), 16);
      const ab = parseInt(ah.slice(5, 7), 16);

      // themeColor drives guardian markers
      const th = zone.themeColor;
      const tr = parseInt(th.slice(1, 3), 16);
      const tg = parseInt(th.slice(3, 5), 16);
      const tb = parseInt(th.slice(5, 7), 16);

      this.poiColors.set(zone.id, {
        treasureClosed: `rgba(${ar},${ag},${ab},0.9)`,
        treasureOpen: `rgba(${ar},${ag},${ab},0.2)`,
        guardianAlive: `rgba(${tr},${tg},${tb},0.9)`,
        guardianDead: `rgba(${tr},${tg},${tb},0.2)`,
      });

      // Pre-cache halo RGB strings (alpha applied via globalAlpha at render time — no string concat in hot path)
      this.flashHaloColors.set(zone.id, {
        cache: `rgb(${ar},${ag},${ab})`,
        guardian: `rgb(${tr},${tg},${tb})`,
      });
    }
  }

  /**
   * Pre-compute gate icon RGBA strings keyed by destination zone id.
   * Locked gate uses the destination zone themeColor (signals where it leads).
   * Called once in the constructor — no string work during render loops.
   */
  private precacheGateColors(): void {
    for (const zone of this.zoneConfig.getAllZones()) {
      const hex = zone.themeColor;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      this.gateColors.set(zone.id, {
        locked: `rgba(${r},${g},${b},0.85)`,
        lockedRgb: `rgb(${r},${g},${b})`,
      });
    }
  }

  /**
   * Get current theme colors for minimap rendering
   */
  private getMinimapColors(): ThemeColorPalette['MINIMAP'] {
    return this.paletteService.getMinimap();
  }

  /**
   * Get territory color based on current theme
   */
  private getTerritoryColor(kingId: number): string {
    const colors = this.MINIMAP_CONFIG.territoryColors[kingId as keyof typeof this.MINIMAP_CONFIG.territoryColors];
    if (!colors) return this.themeService.isDayMode ? 'rgba(100, 100, 100, 0.15)' : 'rgba(100, 100, 100, 0.2)';
    return this.themeService.isDayMode ? colors.light : colors.dark;
  }

  /**
   * Main minimap render function.
   * @param debugMode When true, renders coordinate readout and faction legend.
   */
  renderMinimap(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number,
    playerRotation: number,
    territories: Territory[],
    entities: MinimapEntities,
    isInCombat: boolean,
    debugMode = false
  ): void {
    // Clear and setup
    ctx.clearRect(0, 0, width, height);

    // Blackout event: render a heavily dimmed minimap (player orientation preserved)
    if (this._blackoutActive) {
      ctx.save();
      ctx.globalAlpha = 0.15;
    }

    // Update animations
    this.updateAnimations();

    // Layer 1: Background
    this.renderBackground(ctx, width, height, isInCombat);

    // Layer 2: Territory zones
    this.renderTerritoryZones(ctx, width, height, playerX, playerY, territories);

    // Layer 2.5: Zone boundaries (dashed outlines over territories, under entities)
    this.renderZoneBoundaries(ctx, width, height, playerX, playerY);

    // Layer 3: Grid overlay (subtle)
    this.renderGrid(ctx, width, height);

    // Layer 4: Entities
    this.renderEntities(ctx, width, height, playerX, playerY, entities);

    // Layer 4.5: Zone POIs (treasure caches and guardians — drawn above enemy dots)
    this.renderZonePOIs(ctx, width, height, playerX, playerY);

    // Layer 4.6: Zone gates — locked/unlocked icons with pulse when nearly unlocked
    this.renderZoneGates(ctx, width, height, playerX, playerY);

    // Layer 5: Player indicator
    this.renderPlayer(ctx, width, height, playerRotation);

    // Layer 6: HUD elements (coordinates only in debug mode to reduce clutter)
    this.renderHUDElements(ctx, width, height, playerX, playerY, isInCombat, debugMode);

    // Layer 7: Spawn warnings on edges
    this.renderSpawnWarnings(ctx, width, height, entities.spawnWarnings);

    // Layer 9: Faction color legend — debug mode only on minimap
    // (legend is shown in the full map overlay instead)
    if (debugMode) {
      this.renderFactionLegend(ctx, width, height);
    }

    // Layer 10: Border and frame
    this.renderFrame(ctx, width, height, isInCombat);

    // Restore alpha after blackout dim pass
    if (this._blackoutActive) {
      ctx.restore();
    }
  }

  /**
   * Update animation states
   */
  private updateAnimations(): void {
    this.radarSweepAngle += this.MINIMAP_CONFIG.animation.radarSpeed;
    if (this.radarSweepAngle > Math.PI * 2) {
      this.radarSweepAngle -= Math.PI * 2;
    }

    this.pulsePhase += this.MINIMAP_CONFIG.animation.pulseSpeed;
  }

  /**
   * Render minimap background with theme-aware styling.
   *
   * Performance: the radial gradient is rendered once into a 200×200 OffscreenCanvas
   * keyed by (isDayMode, isInCombat) and re-drawn via drawImage each frame.
   * The cache is invalidated when the theme flips.
   *
   * Fallback: if OffscreenCanvas is unavailable (test/SSR environments) the gradient
   * is created directly on ctx so existing specs remain green.
   */
  private renderBackground(ctx: CanvasRenderingContext2D, width: number, height: number, isInCombat: boolean): void {
    const colors = this.getMinimapColors();
    const isDayMode = this.themeService.isDayMode;

    // Base background (always painted directly — single fillRect, cheap)
    ctx.fillStyle = colors.BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    // Invalidate cached gradients when theme switches
    if (this.bgCacheLastDayMode !== isDayMode) {
      this.bgCache[0] = null;
      this.bgCache[1] = null;
      this.bgCache[2] = null;
      this.bgCache[3] = null;
      this.bgCacheLastDayMode = isDayMode;
    }

    // Cache key: bit 1 = isDayMode, bit 0 = isInCombat
    const cacheKey = (isDayMode ? 2 : 0) | (isInCombat ? 1 : 0);

    // Fast path: draw cached gradient and return
    if (this.bgCache[cacheKey] !== null) {
      ctx.drawImage(this.bgCache[cacheKey], 0, 0, width, height);
      return;
    }

    // Slow path: create the gradient.
    // Use OffscreenCanvas when available so the gradient paints into an off-screen
    // buffer that can be re-used.  Fall back to ctx when OffscreenCanvas is absent.
    const canvasSize = 200; // fixed resolution — scaled by drawImage at render time
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';

    let gradCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    if (useOffscreen) {
      const offscreen = new OffscreenCanvas(canvasSize, canvasSize);
      const octx = offscreen.getContext('2d');
      if (!octx) {
        // Extremely unlikely but guard against null
        this._paintGradientDirect(ctx, width, height, isDayMode, isInCombat);
        return;
      }
      gradCtx = octx;
      this.bgCache[cacheKey] = offscreen;
    } else {
      // Fallback: paint directly onto ctx (test environments / old browsers)
      this._paintGradientDirect(ctx, width, height, isDayMode, isInCombat);
      return;
    }

    // Paint gradient into the offscreen buffer
    const half = canvasSize / 2;
    const gradient = gradCtx.createRadialGradient(half, half, 0, half, half, half);

    this._applyGradientColorStops(gradient, isDayMode, isInCombat);

    gradCtx.fillStyle = gradient;
    gradCtx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw the freshly-painted offscreen canvas onto the minimap canvas
    ctx.drawImage(this.bgCache[cacheKey], 0, 0, width, height);
  }

  /**
   * Apply the shared radial-gradient color-stop sequence to a gradient object.
   *
   * Both the OffscreenCanvas bake path and the direct-paint fallback use the same
   * four stop sets keyed by (isDayMode, isInCombat).  Extracting them here keeps
   * the two call sites character-identical and prevents stop-set drift.
   */
  private _applyGradientColorStops(gradient: CanvasGradient, isDayMode: boolean, isInCombat: boolean): void {
    if (isInCombat) {
      if (isDayMode) {
        gradient.addColorStop(0, 'rgba(220, 38, 38, 0.12)');
        gradient.addColorStop(0.7, 'rgba(220, 38, 38, 0.08)');
        gradient.addColorStop(1, 'rgba(71, 85, 105, 0.15)');
      } else {
        gradient.addColorStop(0, 'rgba(50, 0, 0, 0.3)');
        gradient.addColorStop(0.7, 'rgba(20, 0, 0, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      }
    } else {
      if (isDayMode) {
        gradient.addColorStop(0, 'rgba(248, 250, 252, 0.1)');
        gradient.addColorStop(0.7, 'rgba(71, 85, 105, 0.05)');
        gradient.addColorStop(1, 'rgba(71, 85, 105, 0.12)');
      } else {
        gradient.addColorStop(0, 'rgba(0, 20, 30, 0.3)');
        gradient.addColorStop(0.7, 'rgba(0, 10, 20, 0.5)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      }
    }
  }

  /**
   * Direct gradient paint onto ctx — fallback when OffscreenCanvas is unavailable.
   * Keeps existing behaviour identical to the pre-cache version.
   */
  private _paintGradientDirect(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    isDayMode: boolean,
    isInCombat: boolean
  ): void {
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width / 2);
    this._applyGradientColorStops(gradient, isDayMode, isInCombat);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  /**
   * Render territory zones on minimap — simplified 8×8 quadrant display.
   *
   * Performance: uses the pre-allocated flat Int8Array (territoryGridFlat) instead of
   * allocating a 9-element 2D array each frame.  -1 = no territory; ≥0 = kingId.
   */
  private renderTerritoryZones(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number,
    territories: Territory[]
  ): void {
    const gridSize = 8;
    const cellWidth = width / gridSize;
    const cellHeight = height / gridSize;

    // Reset the flat grid — no allocation, just a typed-array fill.
    this.territoryGridFlat.fill(-1);

    // Populate: index = gx * gridSize + gy
    const radiusDiam = this.MINIMAP_CONFIG.radius * 2;
    const cellWorld = radiusDiam / gridSize;

    for (let gx = 0; gx < gridSize; gx++) {
      const worldX = playerX - this.MINIMAP_CONFIG.radius + (gx + 0.5) * cellWorld;
      for (let gy = 0; gy < gridSize; gy++) {
        const worldY = playerY - this.MINIMAP_CONFIG.radius + (gy + 0.5) * cellWorld;
        for (const territory of territories) {
          if (this.isInTerritory(worldX, worldY, territory)) {
            this.territoryGridFlat[gx * gridSize + gy] = territory.kingId;
            break;
          }
        }
      }
    }

    // Draw the simplified territory zones
    const isDayMode = this.themeService.isDayMode;

    for (let gx = 0; gx < gridSize; gx++) {
      for (let gy = 0; gy < gridSize; gy++) {
        const kingId = this.territoryGridFlat[gx * gridSize + gy];
        if (kingId < 0) continue;

        const x = gx * cellWidth;
        const y = gy * cellHeight;

        // Get theme-aware territory color
        const territoryColor = this.getTerritoryColor(kingId);

        // Fill cell with territory color
        ctx.globalAlpha = isDayMode ? 0.1 : 0.2;
        ctx.fillStyle = territoryColor;
        ctx.fillRect(x, y, cellWidth, cellHeight);

        // Draw border between different territories
        ctx.globalAlpha = isDayMode ? 0.15 : 0.3;
        ctx.strokeStyle = territoryColor;
        ctx.lineWidth = 0.5;

        // Only draw borders where territories change
        if (gx === 0 || this.territoryGridFlat[(gx - 1) * gridSize + gy] !== kingId) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + cellHeight);
          ctx.stroke();
        }
        if (gx === gridSize - 1 || this.territoryGridFlat[(gx + 1) * gridSize + gy] !== kingId) {
          ctx.beginPath();
          ctx.moveTo(x + cellWidth, y);
          ctx.lineTo(x + cellWidth, y + cellHeight);
          ctx.stroke();
        }
        if (gy === 0 || this.territoryGridFlat[gx * gridSize + (gy - 1)] !== kingId) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + cellWidth, y);
          ctx.stroke();
        }
        if (gy === gridSize - 1 || this.territoryGridFlat[gx * gridSize + (gy + 1)] !== kingId) {
          ctx.beginPath();
          ctx.moveTo(x, y + cellHeight);
          ctx.lineTo(x + cellWidth, y + cellHeight);
          ctx.stroke();
        }
      }
    }
  }
  /**
   * Render zone boundary rectangles as dashed lines on the minimap.
   *
   * Only the edges that fall within the minimap viewport (0,0 → width,height)
   * are drawn. No save()/restore(), no string work, no Math.sqrt.
   */
  private renderZoneBoundaries(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number
  ): void {
    const radius = this.MINIMAP_CONFIG.radius;
    const diameter = radius * 2;

    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;

    for (const zone of this.zoneConfig.getAllZones()) {
      const colors = this.zoneBoundaryColors.get(zone.id);
      if (!colors) continue;

      const isUnlocked = this.zoneState.isZoneUnlocked(zone.id);
      const zoneState = this.zoneState.getZoneState(zone.id);
      if (zoneState?.isCompleted) {
        ctx.setLineDash(this.zoneEmptyDash); // Solid line for completed zones
        ctx.globalAlpha = 0.35; // Brighter
      } else {
        ctx.setLineDash(this.zoneDashArray); // Dashed for incomplete
        ctx.globalAlpha = isUnlocked ? 0.2 : 0.1;
      }
      ctx.strokeStyle = isUnlocked ? colors.unlocked : colors.locked;

      const { bounds } = zone;

      // Convert zone boundary corners from world space to minimap pixel space.
      // minimapX = ((worldX - playerX + radius) / diameter) * width
      const left = ((bounds.x - playerX + radius) / diameter) * width;
      const top = ((bounds.y - playerY + radius) / diameter) * height;
      const right = ((bounds.x + bounds.width - playerX + radius) / diameter) * width;
      const bottom = ((bounds.y + bounds.height - playerY + radius) / diameter) * height;

      // Skip zones entirely outside the viewport
      if (right < 0 || left > width || bottom < 0 || top > height) continue;

      // Clip edge endpoints to the minimap viewport before stroking.
      // Only draw each edge when it is (at least partially) visible.
      // Top edge: y = top, x from left to right
      if (top >= 0 && top <= height) {
        const x0 = Math.max(left, 0);
        const x1 = Math.min(right, width);
        if (x1 > x0) {
          ctx.beginPath();
          ctx.moveTo(x0, top);
          ctx.lineTo(x1, top);
          ctx.stroke();
        }
      }

      // Bottom edge: y = bottom, x from left to right
      if (bottom >= 0 && bottom <= height) {
        const x0 = Math.max(left, 0);
        const x1 = Math.min(right, width);
        if (x1 > x0) {
          ctx.beginPath();
          ctx.moveTo(x0, bottom);
          ctx.lineTo(x1, bottom);
          ctx.stroke();
        }
      }

      // Left edge: x = left, y from top to bottom
      if (left >= 0 && left <= width) {
        const y0 = Math.max(top, 0);
        const y1 = Math.min(bottom, height);
        if (y1 > y0) {
          ctx.beginPath();
          ctx.moveTo(left, y0);
          ctx.lineTo(left, y1);
          ctx.stroke();
        }
      }

      // Right edge: x = right, y from top to bottom
      if (right >= 0 && right <= width) {
        const y0 = Math.max(top, 0);
        const y1 = Math.min(bottom, height);
        if (y1 > y0) {
          ctx.beginPath();
          ctx.moveTo(right, y0);
          ctx.lineTo(right, y1);
          ctx.stroke();
        }
      }
    }

    // Locked zone overlay: darken zones that haven't been unlocked yet
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.globalAlpha = 1;
    for (const zone of this.zoneConfig.getAllZones()) {
      if (this.zoneState.isZoneUnlocked(zone.id)) continue;

      const { bounds } = zone;
      const left = ((bounds.x - playerX + radius) / diameter) * width;
      const top = ((bounds.y - playerY + radius) / diameter) * height;
      const right = ((bounds.x + bounds.width - playerX + radius) / diameter) * width;
      const bottom = ((bounds.y + bounds.height - playerY + radius) / diameter) * height;

      // Skip zones entirely outside the viewport
      if (right < 0 || left > width || bottom < 0 || top > height) continue;

      // Clip to minimap bounds
      const clippedLeft = Math.max(0, left);
      const clippedTop = Math.max(0, top);
      const clippedRight = Math.min(width, right);
      const clippedBottom = Math.min(height, bottom);

      if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) continue;

      ctx.fillRect(clippedLeft, clippedTop, clippedRight - clippedLeft, clippedBottom - clippedTop);
    }

    ctx.setLineDash(this.zoneEmptyDash);
  }

  /**
   * Render grid overlay with theme-aware colors
   */
  private renderGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const colors = this.getMinimapColors();
    ctx.strokeStyle = colors.GRID;
    ctx.lineWidth = 0.5;

    // Radial grid lines
    const centerX = width / 2;
    const centerY = height / 2;

    // Circles
    for (let r = 30; r < width / 2; r += 30) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Spokes
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + (Math.cos(angle) * width) / 2, centerY + (Math.sin(angle) * width) / 2);
      ctx.stroke();
    }
  }

  /**
   * Render entities on minimap with theme-aware colors
   */
  private renderEntities(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number,
    entities: MinimapEntities
  ): void {
    const colors = this.getMinimapColors();
    const scale = width / (this.MINIMAP_CONFIG.radius * 2);
    const centerX = width / 2;
    const centerY = height / 2;

    // Render enemies with threat-level visual distinction
    for (const enemy of entities.enemies || []) {
      const dx = enemy.x - playerX;
      const dy = enemy.y - playerY;
      // PERF: squared distance — avoids Math.sqrt; 200px threshold → 40000 sq
      const distSq = dx * dx + dy * dy;

      // Note: Entities are already filtered by map component, so we render all passed entities
      // Only clip those outside the minimap display bounds
      const x = centerX + dx * scale;
      const y = centerY + dy * scale;

      // Only render if within canvas bounds
      if (x >= 0 && x <= width && y >= 0 && y <= height) {
        // Pulse effect for nearby enemies
        if (distSq < 40000) {
          // 200^2
          const pulse = Math.sin(this.pulsePhase * 10) * 0.3 + 0.7;
          ctx.globalAlpha = pulse;
          ctx.fillStyle = colors.ENEMY_PULSE;
          ctx.beginPath();
          ctx.arc(x, y, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        // Threat-based color: boss = magenta, elite = gold, normal = red
        const isDayMode = this.themeService.isDayMode;
        let enemyColor: string;
        let size: number;

        if (enemy.type === 'boss') {
          enemyColor = isDayMode ? '#9932cc' : '#ff00ff';
          size = 6;
        } else if (enemy.type === 'elite') {
          enemyColor = colors.OBJECTIVE; // Gold/goldenrod
          size = 5;
        } else {
          enemyColor = colors.ENEMY;
          size = 4;
        }

        ctx.fillStyle = enemyColor;

        // Draw as a diamond shape for better visibility
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      }
    }

    // Render items with theme-aware rarity colors
    for (const item of entities.items || []) {
      const dx = item.x - playerX;
      const dy = item.y - playerY;

      const x = centerX + dx * scale;
      const y = centerY + dy * scale;

      // Only render if within canvas bounds
      if (x >= 0 && x <= width && y >= 0 && y <= height) {
        // Color by rarity - theme-aware
        const itemColors: Record<string, string> = {
          common: colors.ITEM_COMMON,
          rare: colors.ITEM_RARE,
          epic: colors.ITEM_EPIC,
          legendary: colors.ITEM_LEGENDARY,
        };

        ctx.fillStyle = itemColors[item.rarity] || itemColors['common'];
        // Shards smaller than powerups for visual hierarchy
        const dotRadius = item.type === 'shard' ? 1.5 : 2;
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * Render zone POI layer: treasure caches (diamonds) and guardians (triangles).
   *
   * Performance contract:
   *  - No string concatenation (colors pre-cached in poiColors)
   *  - No save()/restore()
   *  - No shadowBlur
   *  - Scratch array reused via length = 0
   */
  private renderZonePOIs(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number
  ): void {
    const radius = this.MINIMAP_CONFIG.radius;
    const diameter = radius * 2;

    // PERF: pre-allocated slots — initialize once, then mutate in place each frame (no per-frame allocation).
    if (!this.poiScratchInitialized) {
      for (let i = 0; i < TREASURE_CONFIG.CACHE_DEFINITIONS.length; i++) {
        this.poiScratchArray.push({ type: 'treasure', x: 0, y: 0, state: 'closed', zoneId: 0, id: 0 });
      }
      for (let i = 0; i < GUARDIAN_DEFINITIONS.length; i++) {
        this.poiScratchArray.push({ type: 'guardian', x: 0, y: 0, state: 'alive', zoneId: 0, id: 0 });
      }
      this.poiScratchInitialized = true;
    }

    const now = Date.now();

    // Fill slots in place — no object allocation per frame
    let slotIdx = 0;
    for (const def of TREASURE_CONFIG.CACHE_DEFINITIONS) {
      const slot = this.poiScratchArray[slotIdx++];
      slot.type = 'treasure';
      slot.x = def.x;
      slot.y = def.y;
      slot.state = this.treasureCacheSystem.isCacheOpen(def.cacheId) ? 'open' : 'closed';
      slot.zoneId = def.zoneId;
      slot.id = def.cacheId;
    }
    for (const def of GUARDIAN_DEFINITIONS) {
      const alive = this.guardianSpawner.isGuardianAlive(def.guardianId);
      // Detect alive→dead transition and record flash start time
      const wasAlive = this.previousGuardianAlive.get(def.guardianId) ?? true;
      if (wasAlive && !alive) {
        this.poiFlashTimes.set(`guardian_${def.guardianId}`, now);
      }
      this.previousGuardianAlive.set(def.guardianId, alive);

      const slot = this.poiScratchArray[slotIdx++];
      slot.type = 'guardian';
      slot.x = def.homeX;
      slot.y = def.homeY;
      slot.state = alive ? 'alive' : 'dead';
      slot.zoneId = def.zoneId;
      slot.id = def.guardianId;
    }

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;

    const FLASH_DURATION = 800; // ms — total flash fade-out window

    for (const poi of this.poiScratchArray) {
      const mx = ((poi.x - playerX + radius) / diameter) * width;
      const my = ((poi.y - playerY + radius) / diameter) * height;

      // Skip POIs that are outside the minimap viewport
      if (mx < 0 || mx > width || my < 0 || my > height) continue;

      const colors = this.poiColors.get(poi.zoneId);
      if (!colors) continue;

      // Compute flash alpha for this POI — check pre-cached key, clean up expired entries lazily
      const flashKey = poi.type === 'treasure' ? `cache_${poi.id}` : `guardian_${poi.id}`;
      const flashStart = this.poiFlashTimes.get(flashKey);
      let flashAlpha = 0;
      if (flashStart !== undefined) {
        const elapsed = now - flashStart;
        if (elapsed < FLASH_DURATION) {
          flashAlpha = 0.8 * (1 - elapsed / FLASH_DURATION);
        } else {
          this.poiFlashTimes.delete(flashKey); // lazy cleanup — no allocation
        }
      }

      // Draw flash halo behind the POI (larger filled circle, fade-out alpha)
      if (flashAlpha > 0) {
        const haloColors = this.flashHaloColors.get(poi.zoneId);
        if (haloColors) {
          ctx.globalAlpha = flashAlpha;
          ctx.fillStyle = poi.type === 'treasure' ? haloColors.cache : haloColors.guardian;
          ctx.beginPath();
          ctx.arc(mx, my, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      if (poi.type === 'treasure') {
        // Diamond shape: 4px when closed, 3px when open
        const half = poi.state === 'closed' ? 4 : 3;
        ctx.fillStyle = poi.state === 'closed' ? colors.treasureClosed : colors.treasureOpen;
        ctx.beginPath();
        ctx.moveTo(mx, my - half); // top
        ctx.lineTo(mx + half, my); // right
        ctx.lineTo(mx, my + half); // bottom
        ctx.lineTo(mx - half, my); // left
        ctx.closePath();
        ctx.fill();
      } else {
        // Equilateral triangle: 4px when alive, 3px when dead
        const size = poi.state === 'alive' ? 4 : 3;
        ctx.fillStyle = poi.state === 'alive' ? colors.guardianAlive : colors.guardianDead;
        ctx.beginPath();
        ctx.moveTo(mx, my - size); // apex
        ctx.lineTo(mx + size * 0.866, my + size * 0.5); // bottom-right
        ctx.lineTo(mx - size * 0.866, my + size * 0.5); // bottom-left
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Render zone gate icons on the minimap.
   *
   * Unlocked gate  → hollow square (4px), green at 0.3 alpha — low visual weight.
   * Locked gate    → filled square (4px), destination zone themeColor.
   * Nearly unlocked (progress >= 80%) → pulsing opacity via Math.sin.
   *
   * Performance contract:
   *  - No string concatenation (colors pre-cached in gateColors)
   *  - No save()/restore()
   *  - No shadowBlur
   */
  private renderZoneGates(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number
  ): void {
    const radius = this.MINIMAP_CONFIG.radius;
    const diameter = radius * 2;
    const now = Date.now();

    for (const gateDef of ZONE_GATE_DEFINITIONS) {
      const mx = ((gateDef.x - playerX + radius) / diameter) * width;
      const my = ((gateDef.y - playerY + radius) / diameter) * height;

      // Skip gates outside the minimap viewport
      if (mx < 0 || mx > width || my < 0 || my > height) continue;

      const isUnlocked = this.zoneState.isZoneUnlocked(gateDef.toZoneId);

      if (isUnlocked) {
        // Unlocked: hollow square, green, subtle
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = '#22c55e'; // green-500
        ctx.lineWidth = 1;
        ctx.strokeRect(mx - 2, my - 2, 4, 4);
        ctx.globalAlpha = 1;
      } else {
        const destColors = this.gateColors.get(gateDef.toZoneId);
        if (!destColors) continue;

        const nearlyUnlocked = this.isGateNearlyUnlocked(gateDef);

        let alpha: number;
        if (nearlyUnlocked) {
          // Pulse between 0.5 and 1.0
          alpha = 0.75 + 0.25 * Math.sin(now * 0.006);
        } else {
          alpha = 0.75;
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = destColors.locked;
        ctx.fillRect(mx - 2, my - 2, 4, 4);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Check if a gate is >= 80% toward its unlock condition using ZoneStateService data. */
  private isGateNearlyUnlocked(gateDef: { fromZoneId: number; unlockCondition: string; unlockValue: number }): boolean {
    if (gateDef.unlockValue <= 0) return true;
    const state = this.zoneState.getZoneState(gateDef.fromZoneId as ZoneId);
    if (!state) return false;
    let current: number;
    switch (gateDef.unlockCondition) {
      case 'treasure_clear':
        current = state.cachesOpened;
        break;
      case 'guardian_kill':
        current = state.guardiansSlain;
        break;
      default:
        return false; // wave condition — no pulse (minor UX tradeoff to avoid circular DI)
    }
    return current / gateDef.unlockValue >= 0.8;
  }

  /**
   * Render player indicator with theme-aware colors
   */
  private renderPlayer(ctx: CanvasRenderingContext2D, width: number, height: number, rotation: number): void {
    const colors = this.getMinimapColors();
    const centerX = width / 2;
    const centerY = height / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rotation);

    // Player arrow
    ctx.fillStyle = colors.PLAYER;
    ctx.strokeStyle = colors.PLAYER_GLOW;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Vision cone - use player glow color with reduced opacity
    ctx.strokeStyle = colors.PLAYER_GLOW;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(30, -20);
    ctx.lineTo(30, 20);
    ctx.closePath();
    ctx.stroke();

    ctx.restore();

    // Center dot
    ctx.fillStyle = colors.PLAYER;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  /**
   * Render HUD elements with theme-aware colors.
   * @param debugMode When true, renders world-space coordinates.
   */
  private renderHUDElements(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    playerX: number,
    playerY: number,
    isInCombat: boolean,
    debugMode = false
  ): void {
    const colors = this.getMinimapColors();

    // Coordinates — only in debug mode to reduce minimap clutter
    if (debugMode) {
      ctx.fillStyle = colors.HUD_TEXT;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`[${Math.floor(playerX)}, ${Math.floor(playerY)}]`, width / 2, height - 5);
    }

    // Combat indicator
    if (isInCombat) {
      ctx.fillStyle = colors.COMBAT_TEXT;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const pulse = Math.sin(this.pulsePhase * 10) * 0.3 + 0.7;
      ctx.globalAlpha = pulse;
      ctx.fillText('COMBAT', width / 2, 15);
    }

    // Distance markers
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.GRID;
    ctx.font = '8px monospace';
    ctx.fillStyle = colors.HUD_TEXT;
    ctx.textAlign = 'left';

    // Range indicator
    ctx.fillText('400m', width - 25, height / 2);
  }
  /**
   * Render faction color legend in the bottom-left corner of the minimap.
   * Only called when debugMode is active.
   */
  private renderFactionLegend(ctx: CanvasRenderingContext2D, _width: number, height: number): void {
    const isDayMode = this.themeService.isDayMode;

    // Pre-cached per-theme arrays (see constructor) — no allocation here.
    const factions = isDayMode ? this.factionLegendLight : this.factionLegendDark;

    const squareSize = 6;
    const padding = 3;
    const textOffset = squareSize + 3;
    const lineHeight = squareSize + 3;
    const startX = 4;
    // Position above the coordinate readout (which is at height - 5 with 10px font)
    const startY = height - 18 - factions.length * lineHeight;

    ctx.save();

    // Semi-transparent background panel
    const panelW = 52;
    const panelH = factions.length * lineHeight + padding;
    ctx.globalAlpha = isDayMode ? 0.55 : 0.45;
    ctx.fillStyle = isDayMode ? 'rgba(248, 250, 252, 0.8)' : 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(startX - 1, startY - padding, panelW, panelH);

    ctx.globalAlpha = 1;
    ctx.font = '7px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < factions.length; i++) {
      const y = startY + i * lineHeight + squareSize / 2;

      // Colored square
      ctx.fillStyle = factions[i].color;
      ctx.fillRect(startX, y - squareSize / 2, squareSize, squareSize);

      // Faction name
      ctx.fillStyle = isDayMode ? '#334155' : 'rgba(200, 200, 200, 0.9)';
      ctx.fillText(factions[i].name, startX + textOffset, y);
    }

    ctx.restore();
  }

  /**
   * Render minimap frame and border with theme-aware colors
   */
  private renderFrame(ctx: CanvasRenderingContext2D, width: number, height: number, isInCombat: boolean): void {
    const colors = this.getMinimapColors();

    // Outer border
    ctx.strokeStyle = isInCombat ? colors.FRAME_COMBAT : colors.FRAME;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);

    // Inner glow - only in dark mode for the neon effect
    if (!this.themeService.isDayMode) {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, colors.FRAME_GLOW);
      gradient.addColorStop(0.5, 'transparent');
      gradient.addColorStop(1, colors.FRAME_GLOW);

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 1;
      ctx.strokeRect(3, 3, width - 6, height - 6);
    }

    // Corner markers
    ctx.strokeStyle = colors.CORNER;
    ctx.lineWidth = 2;
    const cornerSize = 10;

    // Top-left
    ctx.beginPath();
    ctx.moveTo(0, cornerSize);
    ctx.lineTo(0, 0);
    ctx.lineTo(cornerSize, 0);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(width - cornerSize, 0);
    ctx.lineTo(width, 0);
    ctx.lineTo(width, cornerSize);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(0, height - cornerSize);
    ctx.lineTo(0, height);
    ctx.lineTo(cornerSize, height);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(width - cornerSize, height);
    ctx.lineTo(width, height);
    ctx.lineTo(width, height - cornerSize);
    ctx.stroke();
  }

  /**
   * Check if point is in territory
   */
  private isInTerritory(x: number, y: number, territory: Territory): boolean {
    // Simple bounds check - enhance based on your territory system
    if (!territory.minX || !territory.maxX || !territory.minY || !territory.maxY) {
      return false;
    }
    return x >= territory.minX && x <= territory.maxX && y >= territory.minY && y <= territory.maxY;
  }

  /**
   * Render spawn warnings on minimap edges.
   * Shows pulsing indicators when enemies are approaching from a direction.
   *
   * Performance: base RGB strings are pre-computed in spawnWarningRgb (no per-frame
   * string concatenation).  Alpha is applied via ctx.globalAlpha only.
   */
  private renderSpawnWarnings(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    spawnWarnings?: MinimapEntities['spawnWarnings']
  ): void {
    if (!spawnWarnings || spawnWarnings.length === 0) return;

    const isDayMode = this.themeService.isDayMode;

    for (const warning of spawnWarnings) {
      // Get edge position based on direction
      const edgeInfo = this.getEdgePosition(warning.direction, width, height);

      // Pulse animation
      const pulse = Math.sin(this.pulsePhase * 8) * 0.4 + 0.6;
      const intensity = warning.intensity * pulse;

      // Pick pre-computed base RGB string — no string concat in hot path
      const waveKey = warning.waveType ?? 'default';
      const rgbPair = this.spawnWarningRgb[waveKey] ?? this.spawnWarningRgb['default'];
      const baseRgb = isDayMode ? rgbPair[0] : rgbPair[1];
      // Solid color string (alpha applied via globalAlpha below)
      const solidColor = `rgb(${baseRgb})`;

      // Draw warning indicator
      ctx.globalAlpha = intensity;
      ctx.fillStyle = solidColor;
      ctx.strokeStyle = solidColor;
      ctx.lineWidth = 2;

      // Draw arrow pointing inward
      ctx.save();
      ctx.translate(edgeInfo.x, edgeInfo.y);
      ctx.rotate(edgeInfo.rotation);

      // Arrow shape
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 4);
      ctx.lineTo(0, 0);
      ctx.lineTo(-6, 4);
      ctx.closePath();
      ctx.fill();

      // Glow effect
      ctx.globalAlpha = intensity * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 12 + warning.intensity * 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Edge glow line
      ctx.globalAlpha = intensity * 0.3;
      ctx.strokeStyle = solidColor;
      ctx.lineWidth = 3;

      if (warning.direction === 'north' || warning.direction === 'south') {
        // Horizontal edge glow
        const y = warning.direction === 'north' ? 2 : height - 2;
        ctx.beginPath();
        ctx.moveTo(edgeInfo.x - 30, y);
        ctx.lineTo(edgeInfo.x + 30, y);
        ctx.stroke();
      } else if (warning.direction === 'east' || warning.direction === 'west') {
        // Vertical edge glow
        const x = warning.direction === 'west' ? 2 : width - 2;
        ctx.beginPath();
        ctx.moveTo(x, edgeInfo.y - 30);
        ctx.lineTo(x, edgeInfo.y + 30);
        ctx.stroke();
      }
    }

    // Reset globalAlpha to prevent leaking to subsequent render calls
    ctx.globalAlpha = 1;
  }

  /**
   * Get edge position and rotation for spawn warning
   */
  private getEdgePosition(
    direction: string,
    width: number,
    height: number
  ): { x: number; y: number; rotation: number } {
    const centerX = width / 2;
    const centerY = height / 2;
    const margin = 15;

    switch (direction) {
      case 'north':
        return { x: centerX, y: margin, rotation: Math.PI };
      case 'south':
        return { x: centerX, y: height - margin, rotation: 0 };
      case 'east':
        return { x: width - margin, y: centerY, rotation: -Math.PI / 2 };
      case 'west':
        return { x: margin, y: centerY, rotation: Math.PI / 2 };
      case 'northeast':
        return { x: width - margin, y: margin, rotation: (-Math.PI * 3) / 4 };
      case 'northwest':
        return { x: margin, y: margin, rotation: (Math.PI * 3) / 4 };
      case 'southeast':
        return { x: width - margin, y: height - margin, rotation: -Math.PI / 4 };
      case 'southwest':
        return { x: margin, y: height - margin, rotation: Math.PI / 4 };
      default:
        return { x: centerX, y: margin, rotation: Math.PI };
    }
  }
}

// Re-export type from model for backwards compatibility
export type { MinimapEntities } from './map.model';
