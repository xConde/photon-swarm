import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { RenderService } from '../utils/render.service';
import { EnvironmentService } from '../world/environment.service';
import { TerritoryService } from '../world/territory.service';
import { PlayerService } from '../player/player.service';
import { HoveredItem } from '../models/game-types.model';
import { EffectsSystemService } from '../entities/effects-system.service';
import { FourKingsTerritoryService } from '../systems/territory';
import { FactionEnemyRendererService } from '../rendering/faction-enemy-renderer.service';
import { ZoneDebugRendererService } from '../systems/world/zone-debug-renderer.service';
import { ZoneParticleRendererService } from '../rendering/zone-particle-renderer.service';
import { ZoneConfigService } from '../systems/world/zone-config.service';
import { ZoneStateService } from '../systems/world/zone-state.service';
import { EntityManager } from '../ecs/ecs.model';
import { PositionComponent, ZoneGateComponent, ZoneTreasureCacheComponent } from '@photon/components';
import { BOSS_ARCHETYPE_TINTS } from '@photon/components/boss-phase.component';
import { Enemy, EnemyType } from '../models/enemy.model';
import { Asteroid } from '../models/asteroid.model';
import { Projectile, Shard } from '../models/projectile.model';
import { BlendMode, DischargeEffect, ParticleData, ParticleType } from '../models/effects.model';
import { CameraShakeService } from '../effects/camera-shake.service';
import { PostProcessingService } from '../effects/post-processing.service';
import { getFactionColors, PLAYER_CONFIG, TERRITORY_SYSTEM_CONFIG } from '@photon/config/game-constants';
import { ThemeService } from '@services/theme.service';
import { PaletteService } from '../../services/palette.service';
import { GuardianSpawnerSystemService } from '../systems/world/guardian-spawner-system.service';
import { ZoneGateSystemService } from '../systems/world/zone-gate-system.service';
import { GUARDIAN_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { ScreenSpaceUiRendererService } from './screen-space-ui-renderer.service';
import { RenderColorCacheService } from './render-color-cache.service';

const RING_CONFIG = PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.VISUALS.RING;

interface AsteroidRenderGeometry {
  /** ECS identity and dimensions currently occupying this pooled render-model slot. */
  readonly entityId: number;
  readonly width: number;
  readonly height: number;
  /** Flat x/y pairs relative to the asteroid centre. */
  readonly outline: number[];
  /** Three x/y pairs describing the shaded lower facet. */
  readonly shadowFacet: number[];
  /** Three x/y pairs describing a broken highlight ridge. */
  readonly highlightRidge: number[];
  /** Repeating x/y/radiusX/radiusY crater tuples. */
  readonly craters: number[];
}

export interface RenderContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  playerX: number;
  playerY: number;
  worldWidth: number;
  worldHeight: number;
  cameraZoomScale: number;
  // CSS (logical) viewport size in px. On touch the backing store renders BELOW native
  // resolution (resizeCanvas applies a renderScale < 1 via ctx.scale), so the game draws in
  // CSS coordinates while canvas.width/height are the smaller device pixels. Every full-screen
  // op (clear, background fill) and viewport-cull MUST use these CSS dims, not canvas.width —
  // otherwise it under-covers / over-culls by (1 - renderScale) at the right/bottom edges.
  cssWidth: number;
  cssHeight: number;
}

export interface GameEntities {
  enemies: Enemy[];
  asteroids: Asteroid[];
  projectiles: Projectile[];
  shardsOnGround: Shard[];
  dischargeEffects: DischargeEffect[];
  pickupEffects: Array<{ x: number; y: number; currentRadius: number; maxRadius: number; opacity: number }>;
  enemyDeathEffects: Array<{ x: number; y: number; currentRadius: number; maxRadius: number; opacity: number }>;
  aimingProjection: {
    line: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
    points: Array<{ x: number; y: number; alpha: number }>;
    isActive: boolean;
  };
  playerChargeLevel?: number;
  hazardZones?: Array<{
    id: number;
    x: number;
    y: number;
    radius: number;
    color: string;
    opacity: number;
    damagePerSecond: number;
    isActive?: boolean;
    multiplier?: number;
    powerupType?: string;
  }>;
  fallingAsteroids?: Array<{
    x: number;
    y: number;
    state: string; // AsteroidState enum as string
    size: number;
    impactRadius: number;
    warningProgress: number;
    fallProgress: number;
    health?: number;
    maxHealth?: number;
    rewardType?: string;
    isMega?: boolean;
  }>;
}

export interface UIState {
  miniMapEnabled: boolean;
  miniMapPosition: 'top-right' | 'bottom-left';
  miniMapScale: number;
  fullMapEnabled: boolean;
  damageFlashIntensity: number;
  /** Boss phase-break flash intensity (0-1). White/gold flash, fades independently of damage flash. */
  bossPhaseFlashIntensity: number;
  notifications: Array<{ text: string; startTime: number; color: string }>;
  tooltipText: string;
  tooltipX: number;
  tooltipY: number;
  hoveredItem: HoveredItem | null;
  healthPercent?: number;
  /** When true, world-space debug overlays (e.g. zone boundaries) are rendered. */
  debugMode?: boolean;
}

export interface CameraState {
  prevCameraX?: number;
  prevCameraY?: number;
}

/**
 * Dedicated rendering service for Photon Swarm game.
 * Handles all visual rendering including entities, UI, effects, and camera management.
 *
 * PERFORMANCE RULES (see rendering comments below):
 * - cameraX/cameraY is the TOP-LEFT corner, not center. Culling bounds must
 *   extend from cameraX to cameraX + screenWidth/zoom, not ± viewWidth/2.
 * - NEVER use source-atop composite — requires GPU framebuffer readback per call.
 *   Use simple arc+fill overlays for hit flash / aggro glow.
 * - NEVER use createRadialGradient in per-entity loops — use concentric circles.
 * - cullInto() reuses pre-allocated class arrays. Do NOT use .filter() for culling.
 * - cachedRgba() avoids per-particle string allocation. Use it for all rgba colors.
 */
@Injectable({
  providedIn: 'root',
})
export class GameRenderingService {
  // Debug throttling
  private lastCameraDebugTime = 0;
  private readonly CAMERA_DEBUG_THROTTLE_MS = 5000; // Log camera once per 5 seconds max

  // PERF: cache the single game canvas so calculateCameraPosition (called every frame)
  // does not run document.querySelector('canvas') 60×/s. Re-query only if the cached
  // element was detached (re-init / route change) — isConnected guards against staleness.
  private cachedCanvas: HTMLCanvasElement | null = null;

  /** Tracks the previous frame timestamp (ms) to derive deltaTime for zone particle animation. */
  private lastFrameTimeMs = 0;

  /** Safety cap: if any render cache exceeds this size, clear it to prevent unbounded growth. */
  private static readonly CACHE_SIZE_CAP = 512;

  /** PERFORMANCE: Reuse the same empty array for setLineDash([]) to avoid per-call allocation. */
  private static readonly EMPTY_DASH: number[] = [];
  private static readonly DASH_8_8: number[] = [8, 8];
  private static readonly DASH_6_12: number[] = [6, 12];
  private static readonly DASH_5_5: number[] = [5, 5];
  private static readonly DASH_10_10: number[] = [10, 10];
  private static readonly DASH_4_8: number[] = [4, 8];

  // Pre-allocated Maps to avoid GC pressure in render loops
  private readonly projectileColorBatches = new Map<string, Projectile[]>();
  private readonly particleBlendGroups = new Map<BlendMode, ParticleData[]>();

  /**
   * `hazardColorCache` and `hitFlashCache` eliminate per-frame template literal allocations
   * in hot render loops.
   *
   * hazardColorCache key: packed 32-bit integer `(r<<24)|(g<<16)|(b<<8)|Math.round(a*255)`.
   * Collision-free for any (r,g,b) in [0,255] and alpha rounded to the nearest 1/255 step.
   * Using a numeric Map key avoids per-call string concatenation.
   *
   * hitFlashCache keys remain string (hex color + bucketed intensity) — small set, infrequent.
   */
  private readonly hazardColorCache = new Map<number, string>();
  private readonly hitFlashCache = new Map<string, string>();

  /**
   * Pre-cached zone RGB triplets: zoneId → {r, g, b}.
   * Built once in the constructor. Used in renderZoneGates() to feed cachedRgba()
   * with per-frame alpha values, avoiding template literal allocation in the render loop.
   */
  // PERF: pre-cached — zone theme RGB built once in constructor, fed to cachedRgba() per frame.
  private readonly zoneGateRgbCache = new Map<number, { r: number; g: number; b: number }>();

  /**
   * Pre-cached accent RGB triplets: zoneId → {r, g, b}.
   * Built once in the constructor from zone accentColor hex strings.
   * Used in renderTreasureCaches() to feed cachedRgba() without per-frame string allocation.
   */
  // PERF: pre-cached — zone accent RGB built once in constructor, fed to cachedRgba() per frame.
  private readonly zoneAccentRgbCache = new Map<number, { r: number; g: number; b: number }>();

  // Off-screen treasure-cache edge arrows: only the NEAREST 3 render (13 at once read as
  // "triangles everywhere"). Pre-allocated slots — no per-frame allocation or sort.
  // PERF: fixed-size reusable slot objects, insertion-ordered by squared distance.
  private readonly cacheArrowSlots = [
    { dist2: 0, angle: 0, r: 0, g: 0, b: 0 },
    { dist2: 0, angle: 0, r: 0, g: 0, b: 0 },
    { dist2: 0, angle: 0, r: 0, g: 0, b: 0 },
  ];
  private cacheArrowCount = 0;

  /**
   * cacheId → guardianId mapping.
   * Built once in constructor from GUARDIAN_DEFINITIONS. Used in renderTreasureCaches()
   * to check guardian liveness without iterating definitions per frame.
   */
  // PERF: pre-built — O(1) guardian lookup per cache entity per frame.
  private readonly cacheGuardianMap = new Map<number, number>();

  /** Subscription for zone-change screen flash — unsubscribed in clearRenderCaches(). */
  private zoneFlashSub: Subscription | null = null;

  // PERFORMANCE: Pre-allocated arrays for projectile separation to avoid per-frame allocation
  private readonly basicProjectilesBuffer: Projectile[] = [];
  private readonly chargedProjectilesBuffer: Projectile[] = [];

  /**
   * Ambient asteroid geometry is generated once per model object. Weak keys let
   * despawned asteroids be collected without a render-system cleanup dependency.
   */
  private asteroidGeometryCache = new WeakMap<Asteroid, AsteroidRenderGeometry>();

  // PERFORMANCE: Pre-allocated cull result buffers — reused every frame to eliminate the 7
  // array allocations that `.filter()` would create per call to cullEntities().
  private readonly culledAsteroids: Asteroid[] = [];
  private readonly culledEnemies: Enemy[] = [];
  private readonly culledShards: Shard[] = [];
  private readonly culledProjectiles: Projectile[] = [];
  private readonly culledDischargeEffects: DischargeEffect[] = [];
  private readonly culledPickupEffects: Array<{
    x: number;
    y: number;
    currentRadius: number;
    maxRadius: number;
    opacity: number;
  }> = [];
  private readonly culledDeathEffects: Array<{
    x: number;
    y: number;
    currentRadius: number;
    maxRadius: number;
    opacity: number;
  }> = [];

  constructor(
    private renderer: RenderService,
    private environment: EnvironmentService,
    private territories: TerritoryService, // Kept for dependency injection
    private player: PlayerService,
    private effectsSystem: EffectsSystemService,
    private fourKingsTerritory: FourKingsTerritoryService,
    private cameraShake: CameraShakeService,
    private postProcessing: PostProcessingService,
    private factionEnemyRenderer: FactionEnemyRendererService,
    private themeService: ThemeService,
    private zoneDebugRenderer: ZoneDebugRendererService,
    private zoneConfig: ZoneConfigService,
    private guardianSpawner: GuardianSpawnerSystemService,
    private zoneGateSystem: ZoneGateSystemService,
    private zoneParticleRenderer: ZoneParticleRendererService,
    private zoneState: ZoneStateService,
    private paletteService: PaletteService,
    private screenUiRenderer: ScreenSpaceUiRendererService,
    private colorCache: RenderColorCacheService
  ) {
    this.zoneParticleRenderer.init();
    // Pre-cache zone gate and accent colors to eliminate per-frame string allocation.
    // Iterates the 4 static zone definitions once at construction time.
    for (const zone of this.zoneConfig.getAllZones()) {
      const rgb = this.colorCache.hexToRgb(zone.themeColor);
      if (rgb) {
        this.zoneGateRgbCache.set(zone.id, rgb);
      }

      // Pre-cache accent color RGB triplets for treasure cache rendering.
      const accentRgb = this.colorCache.hexToRgb(zone.accentColor);
      if (accentRgb) {
        this.zoneAccentRgbCache.set(zone.id, accentRgb);
      }
    }

    // Pre-build cacheId → guardianId map from static definitions.
    // Used in renderTreasureCaches() for O(1) per-entity liveness checks.
    for (const def of GUARDIAN_DEFINITIONS) {
      this.cacheGuardianMap.set(def.guardedCacheId, def.guardianId);
    }

    // EMERGENCY DEBUG: This is calling renderTerritories!
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🚨 EMERGENCY: GameRenderingService constructor called', 'error', {
        source: 'emergency_debug',
        test: 'game_rendering_constructed',
        hasFourKingsTerritoryService: !!this.fourKingsTerritory,
        hasTerritoryService: !!this.territories,
        timestamp: Date.now(),
      });
    }

    // Zone transition screen-edge flash: fire a brief color wash when the player
    // crosses into a new zone. Uses the pre-cached zone theme RGB so there's no
    // per-event hex parsing. Opacity 0.35 / 400 ms is visible but not jarring.
    this.zoneFlashSub = this.zoneState.zoneChanged$.subscribe(({ to }) => {
      if (to === null) return;
      const rgb = this.zoneGateRgbCache.get(to);
      if (!rgb) return;
      this.postProcessing.addScreenFlash({ color: rgb, opacity: 0.35, duration: 400 });
    });
  }

  /**
   * Reset canvas state to known defaults
   * FIXED: Centralized state reset to prevent corruption
   */
  private resetCanvasState(ctx: CanvasRenderingContext2D, resetTransform: boolean = false): void {
    ctx.globalAlpha = 1.0;
    ctx.globalCompositeOperation = 'source-over';
    // PERFORMANCE: shadow properties omitted — no render path in this service sets shadowBlur.
    // enemy-sprite-generator.service.ts uses its own offscreen canvas and resets its own state.
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 10;
    // PERFORMANCE: Reuse pre-allocated empty array instead of allocating a new [] each call.
    ctx.setLineDash(GameRenderingService.EMPTY_DASH);
    ctx.font = '12px Arial';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    // Only reset transform when necessary (expensive operation)
    if (resetTransform) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }

  /**
   * Main rendering pipeline - orchestrates all rendering operations
   */
  public render(
    context: RenderContext,
    entities: GameEntities,
    uiState: UIState,
    cameraState: CameraState,
    burnSpreadEnabled: boolean,
    smoothing: boolean = true,
    entityManager?: EntityManager
  ): { cameraX: number; cameraY: number } {
    if (!context.ctx) return { cameraX: 0, cameraY: 0 };

    // Capture timestamp once per frame to avoid repeated Date.now() calls in render loops
    const frameTime = Date.now();

    // FIXED: Reset all canvas state through centralized method
    this.resetCanvasState(context.ctx);

    this.renderer.clear(context.ctx, context.cssWidth, context.cssHeight);

    // Calculate camera position for starfield rendering
    const { cameraX, cameraY } = this.calculateCameraPosition(
      context.playerX,
      context.playerY,
      context.worldWidth,
      context.worldHeight,
      context.cssWidth,
      context.cssHeight,
      context.cameraZoomScale,
      cameraState,
      smoothing
    );

    // Render beautiful space background with starfield. viewWidth/Height are world-space
    // (zoom-divided) for the starfield cull; cssWidth/Height are the CSS screen size for the
    // full-screen gradient fill and the screen-space parallax cull.
    const viewWidth = context.cssWidth / context.cameraZoomScale;
    const viewHeight = context.cssHeight / context.cameraZoomScale;
    this.environment.renderBackground(
      context.ctx,
      cameraX,
      cameraY,
      viewWidth,
      viewHeight,
      context.cssWidth,
      context.cssHeight
    );

    // Update camera shake
    this.cameraShake.update();
    const shakeOffset = this.cameraShake.getOffset();

    // Apply camera transform with shake offset
    context.ctx.save();
    context.ctx.scale(context.cameraZoomScale, context.cameraZoomScale);
    context.ctx.translate(-cameraX + shakeOffset.x, -cameraY + shakeOffset.y);

    // Render world-space content
    this.renderWorldSpace(
      context,
      entities,
      cameraX,
      cameraY,
      burnSpreadEnabled,
      frameTime,
      uiState.debugMode ?? false,
      entityManager
    );

    context.ctx.restore();

    // Reset canvas state between world-space and screen-space to prevent alpha/style leaks
    this.resetCanvasState(context.ctx);

    // Render screen-space UI
    this.renderScreenSpace(context, uiState, cameraX, cameraY, frameTime);

    // Apply post-processing effects (chromatic aberration, etc.)
    if (this.postProcessing.hasActiveEffects()) {
      this.postProcessing.applyEffects(context.ctx, context.canvas);
    }

    // FIXED: Reset canvas state after all rendering through centralized method
    this.resetCanvasState(context.ctx);

    // Return camera position for tracking
    return { cameraX, cameraY };
  }

  /**
   * Render all world-space entities and effects
   */
  private renderWorldSpace(
    context: RenderContext,
    entities: GameEntities,
    cameraX: number,
    cameraY: number,
    burnSpreadEnabled: boolean,
    frameTime: number,
    debugMode: boolean = false,
    entityManager?: EntityManager
  ): void {
    // Render world-space region tint grid
    const viewW = context.cssWidth / context.cameraZoomScale;
    const viewH = context.cssHeight / context.cameraZoomScale;
    this.environment.renderWorld(context.ctx, cameraX, cameraY, viewW, viewH);

    // Territory visualization (beneath entities)
    // Render territories using the fourKingsTerritory service
    if (this.fourKingsTerritory) {
      this.fourKingsTerritory.renderTerritories(context.ctx, { x: cameraX, y: cameraY });
    }

    // Render hazard zones (beneath entities but above territory)
    this.renderHazardZones(context.ctx, entities.hazardZones || [], frameTime);

    // Render world boundaries
    this.renderWorldBoundaries(context.ctx, context.worldWidth, context.worldHeight);

    // Apply viewport culling to all entity renders for massive performance boost.
    // CSS (logical) size, not the backing store — at renderScale < 1 the backing store is
    // smaller and would over-cull, popping entities out before they reach the screen edge.
    const screenWidth = context.cssWidth;
    const screenHeight = context.cssHeight;
    const zoom = context.cameraZoomScale;

    // Cull entities before rendering - only render what's visible
    // PERFORMANCE: cullInto() reuses pre-allocated class arrays instead of allocating via .filter()
    this.cullInto(this.culledAsteroids, entities.asteroids, cameraX, cameraY, screenWidth, screenHeight, zoom);
    this.cullInto(this.culledEnemies, entities.enemies, cameraX, cameraY, screenWidth, screenHeight, zoom);
    this.cullInto(this.culledShards, entities.shardsOnGround, cameraX, cameraY, screenWidth, screenHeight, zoom);
    this.cullInto(this.culledProjectiles, entities.projectiles, cameraX, cameraY, screenWidth, screenHeight, zoom);

    // Render falling asteroids warnings and effects first (behind everything)
    if (entities.fallingAsteroids) {
      this.renderFallingAsteroids(context.ctx, entities.fallingAsteroids, frameTime);
    }

    // Render only visible game entities
    this.renderAsteroids(context.ctx, this.culledAsteroids);
    this.renderEnemies(context.ctx, this.culledEnemies, frameTime);
    this.renderPlayer(context.ctx, entities.playerChargeLevel || 0);
    this.renderAimingProjection(context.ctx, entities.aimingProjection, frameTime);
    this.renderShards(context.ctx, this.culledShards, frameTime, context.playerX, context.playerY);
    this.renderProjectiles(context.ctx, this.culledProjectiles, frameTime);

    // Cull and render effects for additional performance
    // PERFORMANCE: cullInto() reuses pre-allocated arrays; radiusFn avoids .map() + spread allocations
    this.cullInto(
      this.culledDischargeEffects,
      entities.dischargeEffects,
      cameraX,
      cameraY,
      screenWidth,
      screenHeight,
      zoom,
      (e) => e.currentRadius || e.maxRadius || 100
    );
    this.cullInto(
      this.culledPickupEffects,
      entities.pickupEffects,
      cameraX,
      cameraY,
      screenWidth,
      screenHeight,
      zoom,
      () => 50
    );
    this.cullInto(
      this.culledDeathEffects,
      entities.enemyDeathEffects,
      cameraX,
      cameraY,
      screenWidth,
      screenHeight,
      zoom,
      () => 50
    );

    // Render only visible effects
    this.renderer.renderDischargeEffects(context.ctx, this.culledDischargeEffects, burnSpreadEnabled, frameTime);
    this.renderPickupEffects(context.ctx, this.culledPickupEffects);
    this.renderEnemyDeathEffects(context.ctx, this.culledDeathEffects);

    // Render new particle effects system
    this.renderParticleEffects(context.ctx);

    // Render ambient zone particles (cosmetic, world-space, below gates)
    const nowMs = window.performance.now();
    const deltaTime = this.lastFrameTimeMs > 0 ? Math.min((nowMs - this.lastFrameTimeMs) / 1000, 0.1) : 0.016;
    this.lastFrameTimeMs = nowMs;
    this.zoneParticleRenderer.render(context.ctx, cameraX, cameraY, viewW, viewH, deltaTime);

    // Render zone gate visuals (locked barriers + unlock ring animations)
    if (entityManager) {
      this.renderZoneGates(context.ctx, entityManager, cameraX, cameraY, screenWidth, screenHeight);
      this.renderTreasureCaches(context.ctx, entityManager, cameraX, cameraY, screenWidth, screenHeight, zoom);
    }

    // Debug overlay: zone boundaries (last world-space layer — draws on top of everything)
    this.zoneDebugRenderer.renderZoneBoundaries(
      context.ctx,
      cameraX,
      cameraY,
      context.cameraZoomScale,
      debugMode,
      context.cssWidth,
      context.cssHeight
    );
  }

  /**
   * Render all screen-space UI elements
   */
  private renderScreenSpace(
    context: RenderContext,
    uiState: UIState,
    _cameraX: number,
    _cameraY: number,
    frameTime: number
  ): void {
    // Draw damage feedback overlay
    this.screenUiRenderer.renderDamageFlash(
      context.ctx,
      context.cssWidth,
      context.cssHeight,
      uiState.damageFlashIntensity
    );

    // Draw boss phase-break flash (white/gold — fires when boss escalates to a new phase)
    if (uiState.bossPhaseFlashIntensity > 0) {
      this.screenUiRenderer.renderBossPhaseFlash(
        context.ctx,
        context.cssWidth,
        context.cssHeight,
        uiState.bossPhaseFlashIntensity
      );
    }

    // Draw low health warning vignette
    if (uiState.healthPercent !== undefined && uiState.healthPercent < 0.3) {
      this.screenUiRenderer.renderLowHealthWarning(
        context.ctx,
        context.cssWidth,
        context.cssHeight,
        uiState.healthPercent,
        frameTime
      );
    }

    // Draw proximity tooltips
    this.screenUiRenderer.renderTooltip(context.ctx, uiState.tooltipText, uiState.tooltipX, uiState.tooltipY);

    // Draw notifications (kill streaks, etc.)
    this.screenUiRenderer.renderNotifications(context.ctx, context.cssWidth, uiState.notifications, frameTime);

    // NOTE: Map rendering is now handled by the Angular MapComponent
    // The old canvas-based minimap and fullmap have been removed
  }

  /**
   * Calculate camera position with smooth following
   */
  public calculateCameraPosition(
    playerX: number,
    playerY: number,
    worldWidth: number,
    worldHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    cameraZoomScale: number,
    cameraState: CameraState,
    smoothing: boolean = true
  ): { cameraX: number; cameraY: number } {
    // CRITICAL FIX: Use CSS dimensions, not scaled canvas buffer dimensions
    // The canvas buffer might be scaled for high DPI, but camera should use logical viewport size.
    // PERF: cached across frames — only re-query when the element is gone (re-init).
    if (!this.cachedCanvas?.isConnected) {
      this.cachedCanvas = document.querySelector('canvas');
    }
    const canvas = this.cachedCanvas;

    let actualCanvasWidth = canvasWidth;
    let actualCanvasHeight = canvasHeight;

    if (canvas) {
      const cssWidth = parseFloat(canvas.style.width);
      const cssHeight = parseFloat(canvas.style.height);

      // Only use CSS dimensions if they are valid numbers
      if (!isNaN(cssWidth) && cssWidth > 0) {
        actualCanvasWidth = cssWidth;
      }
      if (!isNaN(cssHeight) && cssHeight > 0) {
        actualCanvasHeight = cssHeight;
      }
    }

    const viewW = actualCanvasWidth / cameraZoomScale;
    const viewH = actualCanvasHeight / cameraZoomScale;

    // Send camera calculation data to debug bridge (throttled)
    const now = Date.now();
    if (window.debugLogBridge && now - this.lastCameraDebugTime > this.CAMERA_DEBUG_THROTTLE_MS) {
      this.lastCameraDebugTime = now;
      window.debugLogBridge.log('Camera calc', 'info', {
        source: 'camera',
        player: [playerX, playerY],
        zoom: cameraZoomScale,
      });
    }

    // Calculate ideal camera position (centered on player)
    let idealCameraX = playerX - viewW / 2;
    let idealCameraY = playerY - viewH / 2;

    // Clamp camera to world boundaries
    idealCameraX = Math.max(0, Math.min(worldWidth - viewW, idealCameraX));
    idealCameraY = Math.max(0, Math.min(worldHeight - viewH, idealCameraY));

    let cameraX = idealCameraX;
    let cameraY = idealCameraY;

    // Apply smoothing if enabled and we have previous camera position
    if (smoothing && cameraState.prevCameraX !== undefined && cameraState.prevCameraY !== undefined) {
      // Adjusted smoothing factor to prevent oscillation during rapid movements
      const smoothingFactor = 0.15;
      cameraX = cameraState.prevCameraX + (idealCameraX - cameraState.prevCameraX) * smoothingFactor;
      cameraY = cameraState.prevCameraY + (idealCameraY - cameraState.prevCameraY) * smoothingFactor;

      // If we're very close to the ideal position, snap to it to prevent infinite micro-movements.
      // PERF: use squared-distance (dx*dx+dy*dy < 0.25) to avoid sqrt + pow each frame.
      const sdx = idealCameraX - cameraX;
      const sdy = idealCameraY - cameraY;
      if (sdx * sdx + sdy * sdy < 0.25) {
        cameraX = idealCameraX;
        cameraY = idealCameraY;
      }
    }

    // Update camera state
    cameraState.prevCameraX = cameraX;
    cameraState.prevCameraY = cameraY;

    return { cameraX, cameraY };
  }

  /**
   * Render world boundaries
   */
  private renderWorldBoundaries(ctx: CanvasRenderingContext2D, worldWidth: number, worldHeight: number): void {
    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    const prevStrokeStyle = ctx.strokeStyle;
    const prevLineWidth = ctx.lineWidth;
    // Theme-aware boundary: dark (#444444) in dark mode, Slate-400 (#94a3b8) in light mode
    ctx.strokeStyle = this.paletteService.getCanvas().BOUNDARY;
    ctx.lineWidth = 2;
    ctx.setLineDash(GameRenderingService.DASH_10_10);
    ctx.strokeRect(0, 0, worldWidth, worldHeight);
    ctx.setLineDash(GameRenderingService.EMPTY_DASH);
    ctx.strokeStyle = prevStrokeStyle;
    ctx.lineWidth = prevLineWidth;
  }

  /**
   * Render powerup zones with attractive visual effects
   */
  private renderHazardZones(
    ctx: CanvasRenderingContext2D,
    hazardZones: Array<{
      id: number;
      x: number;
      y: number;
      radius: number;
      color: string;
      opacity: number;
      damagePerSecond: number;
      isActive?: boolean;
      multiplier?: number;
      powerupType?: string;
    }>,
    frameTime: number
  ): void {
    for (const zone of hazardZones) {
      ctx.save();

      // Check if this is a powerup zone (has multiplier) or old hazard zone
      const isPowerup = zone.multiplier !== undefined;
      const isActive = zone.isActive !== false;

      // Pulsing effect - faster and more prominent for active powerups
      const time = frameTime / 1000;
      const pulseSpeed = isPowerup && isActive ? 4 : 1;
      const pulseScale = 1 + Math.sin(time * pulseSpeed) * (isPowerup && isActive ? 0.2 : 0.05);
      const pulseOpacity = zone.opacity * (isActive ? 1 : 0.2) + Math.sin(time * pulseSpeed * 1.5) * 0.2;

      if (isPowerup) {
        // Parse hex color to RGB (cached), then darken for light-mode visibility
        const rawRgb = this.colorCache.hexToRgb(zone.color) || { r: 255, g: 0, b: 0 };
        // In light mode, reduce brightness to 55% so powerups are visible on cream
        const lmf = this.themeService.isDayMode ? 0.55 : 1.0;
        const r = Math.round(rawRgb.r * lmf);
        const g = Math.round(rawRgb.g * lmf);
        const b = Math.round(rawRgb.b * lmf);

        // PERF (mobile): the zone "glow" used to be two large FILLED discs (full + half radius)
        // per zone every frame — with several screen-sized zones that is ~12x viewport overdraw
        // and a dominant GPU cost. Use a single small filled core for the glow hint and let the
        // stroked boundary ring (below) carry the zone shape — near-zero fill area.
        const glowRadius = zone.radius * pulseScale;
        ctx.fillStyle = this.getCachedRgba(r, g, b, pulseOpacity * 0.3);
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, Math.min(glowRadius * 0.25, 40), 0, Math.PI * 2);
        ctx.fill();

        // Outer ring
        ctx.strokeStyle = this.getCachedRgba(r, g, b, isActive ? pulseOpacity * 0.8 : 0.15);
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.setLineDash(isActive ? GameRenderingService.EMPTY_DASH : GameRenderingService.DASH_8_8);
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
        ctx.stroke();

        // Rotating dashed inner ring (matches asteroid pickup indicator)
        if (isActive) {
          ctx.save();
          ctx.translate(zone.x, zone.y);
          ctx.rotate(time * 1.5);
          ctx.strokeStyle = this.getCachedRgba(r, g, b, pulseOpacity * 0.4);
          ctx.lineWidth = 1;
          ctx.setLineDash(GameRenderingService.DASH_6_12);
          ctx.beginPath();
          ctx.arc(0, 0, zone.radius * 0.65, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // Draw powerup text — dark text in light mode for visibility on cream
        ctx.setLineDash(GameRenderingService.EMPTY_DASH);
        ctx.fillStyle = this.themeService.isDayMode
          ? this.getCachedRgba(47, 79, 79, Math.min(1, pulseOpacity * 1.4))
          : this.getCachedRgba(255, 255, 255, pulseOpacity * 1.2);
        ctx.font = isActive ? 'bold 16px Arial' : 'italic 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (isActive) {
          if (zone.powerupType === 'health') {
            // Draw heart icon (matches HUD SVG path, scaled to 18px)
            ctx.save();
            ctx.translate(zone.x - 9, zone.y - 14);
            ctx.scale(0.75, 0.75);
            ctx.fillStyle = '#ff3366';
            ctx.globalAlpha = Math.min(1, pulseOpacity * 1.2);
            ctx.beginPath();
            ctx.moveTo(12, 21.35);
            ctx.bezierCurveTo(6.8, 17.36, 2, 12.28, 2, 8.5);
            ctx.bezierCurveTo(2, 5.42, 4.42, 3, 7.5, 3);
            ctx.bezierCurveTo(9.24, 3, 10.91, 3.81, 12, 5.09);
            ctx.bezierCurveTo(13.09, 3.81, 14.76, 3, 16.5, 3);
            ctx.bezierCurveTo(19.58, 3, 22, 5.42, 22, 8.5);
            ctx.bezierCurveTo(22, 12.28, 17.2, 17.36, 12, 21.35);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            ctx.font = 'bold 12px Arial';
            ctx.fillText('REPAIR', zone.x, zone.y + 15);
          } else {
            const label = this.getPowerupLabel(zone.powerupType);
            const valueText = zone.powerupType === 'shield' ? '-30%' : `${zone.multiplier}x`;
            ctx.fillText(valueText, zone.x, zone.y - 10);
            ctx.font = 'bold 12px Arial';
            ctx.fillText(label, zone.x, zone.y + 10);
          }
        } else {
          ctx.fillText('Recharging...', zone.x, zone.y);
        }
      } else {
        // Old hazard zone rendering (fallback).
        // PERF: Replaced createRadialGradient with three concentric arc fills — no gradient
        // object allocation per frame. The three layers approximate the original radial fade.
        // PERF (mobile): was three large concentric FILLS (full / 66% / 33% radius) = heavy
        // per-frame overdraw. Keep a small filled core + a single stroked boundary ring.
        const glowR = zone.radius * pulseScale;
        ctx.fillStyle = this.getCachedRgba(255, 0, 0, pulseOpacity * 0.5);
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, Math.min(glowR * 0.25, 40), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.getCachedRgba(255, 0, 0, pulseOpacity * 0.4);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, glowR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = this.getCachedRgba(255, 255, 255, pulseOpacity * 0.9);
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`⚠️ ${zone.damagePerSecond} DPS`, zone.x, zone.y);
      }

      ctx.restore();
    }
  }

  private getPowerupLabel(type?: string): string {
    switch (type) {
      case 'damage_multiplier':
        return 'DAMAGE';
      case 'speed':
        return 'SPEED';
      case 'shield':
        return 'SHIELD';
      case 'rapid_fire':
        return 'FIRE RATE';
      case 'experience':
        return 'XP BOOST';
      default:
        return 'POWER UP';
    }
  }

  /**
   * Render falling asteroids with warning zones and impact effects
   */
  private renderFallingAsteroids(
    ctx: CanvasRenderingContext2D,
    fallingAsteroids: Array<{
      x: number;
      y: number;
      state: string;
      size: number;
      impactRadius: number;
      warningProgress: number;
      fallProgress: number;
      health?: number;
      maxHealth?: number;
      rewardType?: string;
      isMega?: boolean;
    }>,
    frameTime: number
  ): void {
    for (const asteroid of fallingAsteroids) {
      switch (asteroid.state) {
        case 'warning': {
          // Pulse accelerates as warningProgress → 1 (Bug D: drive off warningProgress)
          const warnPulseSpeed = 0.006 + asteroid.warningProgress * 0.012;
          const pulseIntensity = Math.sin(frameTime * warnPulseSpeed) * 0.2 + 0.3 + asteroid.warningProgress * 0.2;
          // MEGA uses gold tint, regular uses theme cyan/slate (Bug C)
          let warningR: number, warningG: number, warningB: number;
          if (asteroid.isMega) {
            warningR = this.themeService.isDayMode ? 202 : 255;
            warningG = this.themeService.isDayMode ? 138 : 170;
            warningB = 0;
          } else {
            warningR = this.themeService.isDayMode ? 47 : 0;
            warningG = this.themeService.isDayMode ? 79 : 255;
            warningB = this.themeService.isDayMode ? 79 : 255;
          }
          ctx.strokeStyle = this.getCachedRgba(warningR, warningG, warningB, pulseIntensity);
          ctx.lineWidth = 2;
          ctx.setLineDash(GameRenderingService.DASH_5_5);

          // Draw hexagonal warning zone (more cyber)
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const x = asteroid.x + Math.cos(angle) * asteroid.impactRadius;
            const y = asteroid.y + Math.sin(angle) * asteroid.impactRadius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();

          // Draw digital crosshair at center (theme-aware sienna/magenta)
          const crosshairR = this.themeService.isDayMode ? 160 : 255;
          const crosshairG = this.themeService.isDayMode ? 82 : 0;
          const crosshairB = this.themeService.isDayMode ? 45 : 255;
          ctx.strokeStyle = this.getCachedRgba(crosshairR, crosshairG, crosshairB, pulseIntensity + 0.3);
          ctx.lineWidth = 1;
          ctx.setLineDash(GameRenderingService.EMPTY_DASH);
          ctx.beginPath();
          ctx.moveTo(asteroid.x - asteroid.size, asteroid.y);
          ctx.lineTo(asteroid.x + asteroid.size, asteroid.y);
          ctx.moveTo(asteroid.x, asteroid.y - asteroid.size);
          ctx.lineTo(asteroid.x, asteroid.y + asteroid.size);
          ctx.stroke();

          // Digital warning text (theme-aware - dark slate for light mode, cyan for dark)
          const textR = warningR;
          const textG = warningG;
          const textB = warningB;
          ctx.fillStyle = this.getCachedRgba(textR, textG, textB, pulseIntensity + 0.4);
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            asteroid.isMega ? '[ ★ MEGA CORE INBOUND ]' : '[ DATA CORE INBOUND ]',
            asteroid.x,
            asteroid.y - asteroid.impactRadius - 20
          );
          ctx.setLineDash(GameRenderingService.EMPTY_DASH);
          break;
        }

        case 'falling': {
          // CONTINUE WARNING INDICATORS AT IMPACT ZONE
          // Intensifying warning as asteroid gets closer
          const warningIntensity = 0.3 + asteroid.fallProgress * 0.5;
          const pulseSpeed = 0.01 + asteroid.fallProgress * 0.02; // Pulse faster as it approaches
          const warningPulse = Math.sin(frameTime * pulseSpeed) * 0.3 + warningIntensity;

          // MEGA: gold danger zone, regular: orange→red (Bug C)
          if (asteroid.isMega) {
            ctx.strokeStyle = this.getCachedRgba(255, Math.floor(170 - asteroid.fallProgress * 70), 0, warningPulse);
          } else {
            ctx.strokeStyle = this.getCachedRgba(255, Math.floor(255 - asteroid.fallProgress * 155), 0, warningPulse);
          }
          ctx.lineWidth = 2 + asteroid.fallProgress * 2;
          ctx.setLineDash(GameRenderingService.DASH_5_5);

          // Draw hexagonal danger zone
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const x = asteroid.x + Math.cos(angle) * asteroid.impactRadius;
            const y = asteroid.y + Math.sin(angle) * asteroid.impactRadius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();

          // Inner warning ring - pulsing more urgently
          ctx.strokeStyle = this.getCachedRgba(255, 0, 0, warningPulse * 1.2);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(asteroid.x, asteroid.y, asteroid.impactRadius * 0.7, 0, Math.PI * 2);
          ctx.stroke();

          // Danger crosshair at center - getting brighter
          ctx.strokeStyle = this.getCachedRgba(255, 0, 0, warningPulse + 0.3);
          ctx.lineWidth = 2;
          ctx.setLineDash(GameRenderingService.EMPTY_DASH);
          ctx.beginPath();
          ctx.moveTo(asteroid.x - asteroid.size * 1.5, asteroid.y);
          ctx.lineTo(asteroid.x + asteroid.size * 1.5, asteroid.y);
          ctx.moveTo(asteroid.x, asteroid.y - asteroid.size * 1.5);
          ctx.lineTo(asteroid.x, asteroid.y + asteroid.size * 1.5);
          ctx.stroke();

          // Warning text that changes to DANGER when close
          ctx.fillStyle = this.getCachedRgba(255, Math.floor(100 - asteroid.fallProgress * 100), 0, warningPulse + 0.4);
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const warningText = asteroid.fallProgress > 0.7 ? '[ !!! DANGER !!! ]' : '[ DATA CORE INBOUND ]';
          ctx.fillText(warningText, asteroid.x, asteroid.y - asteroid.impactRadius - 20);

          // Reset dash for asteroid rendering
          ctx.setLineDash(GameRenderingService.EMPTY_DASH);
          ctx.globalAlpha = 1;

          // Draw falling data core (glowing cube/hexagon) - theme-aware
          const fallY = asteroid.y - (1 - asteroid.fallProgress) * 500;
          const fallingColors = this.paletteService.getCanvas();

          // PERFORMANCE: Concentric circle fills replace radial gradients (no gradient object allocation)
          const glowExtent = 30 * asteroid.fallProgress;
          if (glowExtent > 0) {
            // Outer glow — two concentric circles fading out
            ctx.fillStyle = fallingColors.GLOW_PRIMARY;
            ctx.globalAlpha = asteroid.fallProgress * 0.25;
            ctx.beginPath();
            ctx.arc(asteroid.x, fallY, asteroid.size + glowExtent, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = asteroid.fallProgress * 0.12;
            ctx.beginPath();
            ctx.arc(asteroid.x, fallY, asteroid.size + glowExtent * 0.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          // Core body - digital hexagon with deterministic-per-100ms glitch (Polish 2)
          const glitchBucket = Math.floor(frameTime / 100);
          const glitchOffset = ((glitchBucket * 1664525 + 1013904223) & 0xffff) / 32767.5 - 1; // LCG → [-1, 1]
          ctx.fillStyle = fallingColors.ACCENT_BLUE;
          this.drawHexagon(ctx, asteroid.x + glitchOffset, fallY, asteroid.size);

          // Inner bright core — two concentric circles replace radial gradient
          ctx.fillStyle = fallingColors.STROKE_PRIMARY;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.arc(asteroid.x, fallY, asteroid.size * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;

          ctx.fillStyle = fallingColors.STROKE_PRIMARY;
          this.drawHexagon(ctx, asteroid.x, fallY, asteroid.size * 0.3);

          // Data stream trails — deterministic per-interval xOffset (Polish 2)
          if (asteroid.fallProgress > 0.3) {
            const trailAlpha = (asteroid.fallProgress - 0.3) * 0.7;
            ctx.strokeStyle = this.themeService.isDayMode
              ? this.getCachedRgba(47, 79, 79, trailAlpha)
              : this.getCachedRgba(0, 255, 255, trailAlpha);
            ctx.lineWidth = 1;
            const trailBucket = Math.floor(frameTime / 100);
            for (let i = 0; i < 5; i++) {
              ctx.globalAlpha = (asteroid.fallProgress - 0.3) * (1 - i * 0.15);
              ctx.beginPath();
              // LCG seeded by (bucket + i) to vary per trail but be stable within the 100ms window
              const seed = ((trailBucket + i * 6364136) * 1664525 + 1013904223) & 0xffff;
              const xOffset = (seed / 65535 - 0.5) * asteroid.size * 2;
              ctx.moveTo(asteroid.x + xOffset, fallY - asteroid.size);
              ctx.lineTo(asteroid.x + xOffset * 0.5, fallY - asteroid.size - 100 * asteroid.fallProgress);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          break;
        }

        case 'impact': {
          // Bug B: shockwave reaches FULL impactRadius (matches damage area)
          // Bug E: use getCachedRgba for the corruption pixel color
          // Polish 1: outer ring + 2 inner rings for better impact read
          // Polish 2: deterministic-per-100ms corruption offsets
          // Polish 5: no save/restore needed — only fillStyle/strokeStyle, no transforms
          const shockwaveRadius = asteroid.impactRadius; // Bug B fix: full radius
          const impactBucket = Math.floor(frameTime / 100);

          // Outer ring at full impactRadius + 2 inner rings
          for (let ring = 0; ring < 3; ring++) {
            const ringRadius = shockwaveRadius * (1 - ring * 0.25);
            const ringAlpha = 0.6 - ring * 0.15;
            ctx.strokeStyle = this.themeService.isDayMode
              ? this.getCachedRgba(47, 79, 79, ringAlpha)
              : this.getCachedRgba(0, 255, 255, ringAlpha);
            ctx.lineWidth = 3 - ring;
            ctx.beginPath();
            ctx.arc(asteroid.x, asteroid.y, ringRadius, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Digital corruption pixels — deterministic per 100ms window (Polish 2, Bug E)
          ctx.fillStyle = this.getCachedRgba(255, 0, 255, 0.8); // Bug E: use cache
          for (let i = 0; i < 6; i++) {
            const seed = (impactBucket * 16807 + i * 1664525 + 1013904223) & 0xffff;
            const angleSeed = (seed * 9301 + 49297) & 0xffff;
            const distSeed = ((seed ^ angleSeed) * 1013904223) & 0xffff;
            const angle = (i / 6) * Math.PI * 2 + (angleSeed / 65535) * 0.2;
            const dist = asteroid.size * (1 + (distSeed / 65535) * 0.5);
            ctx.fillRect(asteroid.x + Math.cos(angle) * dist - 2, asteroid.y + Math.sin(angle) * dist - 2, 4, 4);
          }
          ctx.setLineDash(GameRenderingService.EMPTY_DASH);
          break;
        }

        case 'landed': {
          // Don't render if already collected (0 health)
          if (asteroid.health !== undefined && asteroid.health <= 0) {
            break;
          }

          // Get reward type for color coding (theme-aware)
          const rewardType = asteroid.rewardType || 'speed';
          const themeColors = this.paletteService.getCanvas();
          let coreColor = themeColors.ACCENT_CYAN;
          let labelText = 'SPEED';

          switch (rewardType) {
            case 'speed':
              coreColor = themeColors.ACCENT_CYAN;
              labelText = 'SPEED';
              break;
            case 'damage':
              coreColor = themeColors.DAMAGE_CRITICAL;
              labelText = 'DAMAGE';
              break;
            case 'shield':
              coreColor = themeColors.ACCENT_BLUE;
              labelText = 'SHIELD';
              break;
            case 'regen':
              coreColor = themeColors.ACCENT_MAGENTA;
              labelText = 'REGEN';
              break;
            case 'crit':
              coreColor = themeColors.ACCENT_GOLD; // Polish 4: palette token
              labelText = 'CRIT';
              break;
            case 'xp_boost':
              coreColor = themeColors.ACCENT_VIOLET; // Polish 4: palette token
              labelText = 'XP BOOST';
              break;
          }
          // Bug C: MEGA gets ★ prefix on label
          const displayLabel = asteroid.isMega ? '★ ' + labelText : labelText;

          // STRONG pulsing animation to grab attention
          const pulse = Math.sin(frameTime * 0.006) * 0.4 + 0.6;
          const bigPulse = Math.sin(frameTime * 0.003) * 20 + 30;

          // PERFORMANCE: Concentric circle fills replace radial gradient (no gradient object allocation)
          const glowRadius = asteroid.size * 2 + bigPulse;
          ctx.fillStyle = coreColor;
          ctx.globalAlpha = pulse * 0.3;
          ctx.beginPath();
          ctx.arc(asteroid.x, asteroid.y, glowRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = pulse * 0.15;
          ctx.beginPath();
          ctx.arc(asteroid.x, asteroid.y, glowRadius * 0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Bug C: MEGA outer gold ring at size*2.5 (drawn before rotation save)
          if (asteroid.isMega) {
            const megaRingColor = themeColors.ACCENT_GOLD;
            ctx.strokeStyle = megaRingColor;
            ctx.lineWidth = 3;
            ctx.globalAlpha = pulse * 0.9;
            ctx.beginPath();
            ctx.arc(asteroid.x, asteroid.y, asteroid.size * 2.5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

          // Animated rotating pickup indicator (save/restore for rotation — Polish 5)
          const rotation = frameTime * 0.002;
          ctx.save();
          ctx.translate(asteroid.x, asteroid.y);
          ctx.rotate(rotation);

          // Draw animated pickup rings
          ctx.strokeStyle = coreColor;
          ctx.lineWidth = 3;
          ctx.globalAlpha = pulse;
          ctx.beginPath();
          ctx.arc(0, 0, asteroid.size * 1.8, 0, Math.PI * 2);
          ctx.stroke();

          // Inner ring rotating opposite
          ctx.rotate(-rotation * 2);
          ctx.lineWidth = 2;
          ctx.globalAlpha = pulse * 0.7;
          ctx.setLineDash(GameRenderingService.DASH_10_10);
          ctx.beginPath();
          ctx.arc(0, 0, asteroid.size * 1.2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash(GameRenderingService.EMPTY_DASH);

          ctx.restore();

          // Draw the actual powerup core
          ctx.fillStyle = coreColor;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(asteroid.x, asteroid.y, asteroid.size * 0.6, 0, Math.PI * 2);
          ctx.fill();

          // Bright center pulse (theme-aware)
          ctx.fillStyle = themeColors.STROKE_PRIMARY;
          ctx.globalAlpha = pulse;
          ctx.beginPath();
          ctx.arc(asteroid.x, asteroid.y, asteroid.size * 0.3, 0, Math.PI * 2);
          ctx.fill();

          // Clear label text — stroke outline provides contrast without shadowBlur
          // displayLabel already has '★ ' prefix for MEGA (Bug C)
          ctx.globalAlpha = 1;
          ctx.font = 'bold 14px monospace';
          ctx.fillStyle = coreColor;
          ctx.strokeStyle = this.themeService.isDayMode ? '#ffffff' : '#000000';
          ctx.lineWidth = this.themeService.isDayMode ? 4 : 3;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeText(displayLabel, asteroid.x, asteroid.y - asteroid.size * 1.8);
          ctx.fillText(displayLabel, asteroid.x, asteroid.y - asteroid.size * 1.8);

          ctx.globalAlpha = 1;

          // Draw corruption/damage if health is low — deterministic per-100ms (Polish 2)
          if (asteroid.health !== undefined && asteroid.maxHealth !== undefined) {
            const healthPercent = asteroid.health / asteroid.maxHealth;
            if (healthPercent < 0.7) {
              // Digital corruption lines
              ctx.strokeStyle = this.getCachedRgba(255, 0, 0, 1 - healthPercent);
              ctx.lineWidth = 1;
              const corruptBucket = Math.floor(frameTime / 100);
              for (let i = 0; i < 5; i++) {
                const seed = (corruptBucket * 16807 + i * 1664525 + 1013904223) & 0xffff;
                if (seed / 65535 > healthPercent) {
                  const startAngle = ((seed * 9301) & 0xffff) / 10430 - 0.5; // [~0, ~2π]
                  const endAngle = startAngle + ((seed * 49297) & 0xffff) / 20860;
                  ctx.beginPath();
                  ctx.moveTo(
                    asteroid.x + Math.cos(startAngle) * asteroid.size * 0.3,
                    asteroid.y + Math.sin(startAngle) * asteroid.size * 0.3
                  );
                  ctx.lineTo(
                    asteroid.x + Math.cos(endAngle) * asteroid.size * 0.8,
                    asteroid.y + Math.sin(endAngle) * asteroid.size * 0.8
                  );
                  ctx.stroke();
                }
              }
            }

            // Draw health bar - digital style
            if (healthPercent < 1) {
              const barWidth = asteroid.size * 2;
              const barHeight = 3;
              const barY = asteroid.y - asteroid.size - 10;

              // Background
              ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
              ctx.fillRect(asteroid.x - barWidth / 2 - 1, barY - 1, barWidth + 2, barHeight + 2);

              // Health bar — solid theme-color fill.
              // PERF: Replaced createLinearGradient (heap allocation per frame) with a
              // direct palette string assignment. themeColors strings are already memoized
              // by PaletteService — zero allocation per frame.
              ctx.fillStyle = healthPercent > 0.3 ? themeColors.HEALTH_HIGH : themeColors.HEALTH_LOW;
              ctx.fillRect(asteroid.x - barWidth / 2, barY, barWidth * healthPercent, barHeight);
            }
          }
          ctx.globalAlpha = 1;
          break;
        }

        // Destroyed state should never be rendered - it's filtered out
        // case 'destroyed':
        //   break;
      }
    }
  }

  /**
   * Render ambient asteroids with a 'cyber rock' silhouette (Polish 3).
   *
   * Four-tone: body, shadow facet, crater field and sunward ridge, theme-aware.
   * Geometry is deterministic per entity and cached in a WeakMap, so the render loop
   * performs no random work or object allocation and despawned rocks remain collectable.
   */
  private renderAsteroids(ctx: CanvasRenderingContext2D, asteroids: Asteroid[]): void {
    if (asteroids.length === 0) return;

    const canvasColors = this.paletteService.getCanvas();

    for (const asteroid of asteroids) {
      let geometry = this.asteroidGeometryCache.get(asteroid);
      if (
        !geometry ||
        geometry.entityId !== asteroid.id ||
        geometry.width !== asteroid.width ||
        geometry.height !== asteroid.height
      ) {
        geometry = this.createAsteroidRenderGeometry(asteroid);
        this.asteroidGeometryCache.set(asteroid, geometry);
      }
      const outline = geometry.outline;
      const vertCount = outline.length >> 1;

      // Main mass.
      ctx.fillStyle = canvasColors.ASTEROID;
      ctx.beginPath();
      ctx.moveTo(asteroid.x + outline[0], asteroid.y + outline[1]);
      for (let vi = 1; vi < vertCount; vi++) {
        ctx.lineTo(asteroid.x + outline[vi * 2], asteroid.y + outline[vi * 2 + 1]);
      }
      ctx.closePath();
      ctx.fill();

      // Lower plane: an angular shadow makes the silhouette read as a volume.
      const shadow = geometry.shadowFacet;
      ctx.fillStyle = canvasColors.ASTEROID_SHADOW;
      ctx.beginPath();
      ctx.moveTo(asteroid.x + shadow[0], asteroid.y + shadow[1]);
      ctx.lineTo(asteroid.x + shadow[2], asteroid.y + shadow[3]);
      ctx.lineTo(asteroid.x + shadow[4], asteroid.y + shadow[5]);
      ctx.closePath();
      ctx.fill();

      // Pitted surface. Ellipses are cached geometry and deliberately hard-edged;
      // this keeps the industrial vector language without expensive blur/gradients.
      ctx.fillStyle = canvasColors.ASTEROID_CRATER;
      ctx.strokeStyle = canvasColors.ASTEROID_HIGHLIGHT;
      ctx.lineWidth = 0.75;
      const craters = geometry.craters;
      for (let ci = 0; ci < craters.length; ci += 4) {
        ctx.beginPath();
        ctx.ellipse(
          asteroid.x + craters[ci],
          asteroid.y + craters[ci + 1],
          craters[ci + 2],
          craters[ci + 3],
          0,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();
      }

      // Broken sunward ridge plus a stronger perimeter separate rocks from the field.
      const ridge = geometry.highlightRidge;
      ctx.strokeStyle = canvasColors.ASTEROID_HIGHLIGHT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(asteroid.x + ridge[0], asteroid.y + ridge[1]);
      ctx.lineTo(asteroid.x + ridge[2], asteroid.y + ridge[3]);
      ctx.lineTo(asteroid.x + ridge[4], asteroid.y + ridge[5]);
      ctx.stroke();

      ctx.strokeStyle = canvasColors.ASTEROID_RIM;
      ctx.lineWidth = asteroid.type === 'large' ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(asteroid.x + outline[0], asteroid.y + outline[1]);
      for (let vi = 1; vi < vertCount; vi++) {
        ctx.lineTo(asteroid.x + outline[vi * 2], asteroid.y + outline[vi * 2 + 1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  private createAsteroidRenderGeometry(asteroid: Asteroid): AsteroidRenderGeometry {
    const radiusX = asteroid.width / 2;
    const radiusY = asteroid.height / 2;
    const minRadius = Math.min(radiusX, radiusY);
    let rng = (asteroid.id * 1664525 + 1013904223) >>> 0;
    const vertCount = 7 + (rng % 2);
    const outline = new Array<number>(vertCount * 2);

    for (let vi = 0; vi < vertCount; vi++) {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const jitter = 0.78 + (rng & 0xff) / 544;
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const angleStep = (Math.PI * 2) / vertCount;
      const angleOffset = ((rng & 0xff) / 255 - 0.5) * angleStep * 0.38;
      const angle = vi * angleStep + angleOffset;
      outline[vi * 2] = Math.cos(angle) * radiusX * jitter;
      outline[vi * 2 + 1] = Math.sin(angle) * radiusY * jitter;
    }

    const lowerLeft = Math.floor(vertCount * 0.35) * 2;
    const lowerRight = Math.floor(vertCount * 0.68) * 2;
    const shadowFacet = [
      outline[lowerLeft],
      outline[lowerLeft + 1],
      -radiusX * 0.08,
      radiusY * 0.16,
      outline[lowerRight],
      outline[lowerRight + 1],
    ];

    const highlightRidge = [
      outline[0] * 0.78,
      outline[1] * 0.78,
      -radiusX * 0.12,
      -radiusY * 0.2,
      outline[2] * 0.68,
      outline[3] * 0.68,
    ];

    const craterCount = asteroid.type === 'large' ? 3 : 2;
    const craters = new Array<number>(craterCount * 4);
    for (let ci = 0; ci < craterCount; ci++) {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const angle = ((rng & 0xffff) / 65535) * Math.PI * 2;
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const distance = 0.12 + ((rng & 0xff) / 255) * 0.28;
      rng = (rng * 1664525 + 1013904223) >>> 0;
      const craterRadius = minRadius * (0.1 + ((rng & 0xff) / 255) * 0.08);
      const offset = ci * 4;
      craters[offset] = Math.cos(angle) * radiusX * distance;
      craters[offset + 1] = Math.sin(angle) * radiusY * distance;
      craters[offset + 2] = craterRadius;
      craters[offset + 3] = craterRadius * 0.62;
    }

    return {
      entityId: asteroid.id,
      width: asteroid.width,
      height: asteroid.height,
      outline,
      shadowFacet,
      highlightRidge,
      craters,
    };
  }

  /**
   * Draw hexagon shape for asteroids
   */
  private drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    const sides = 6;
    const step = (Math.PI * 2) / sides;

    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = i * step;
      const px = x + Math.cos(angle) * size;
      const py = y + Math.sin(angle) * size;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
  }

  /**
   * Render enemies with enhanced visuals
   * Performance: Uses cached visual effect data from RenderingSystemService.getEnemies()
   */
  private renderEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[], frameTime: number): void {
    for (const enemy of enemies) {
      // Ensure clean state at start of each enemy — prevents alpha/style bleed between enemies
      ctx.globalAlpha = 1;

      // Use cached visual effect data (populated in RenderingSystemService.getEnemies())
      // This eliminates 2 component lookups per enemy per frame
      const isKnockedBack = enemy.isKnockedBack || false;
      const hitFlashIntensity = enemy.hitFlashIntensity || 0;

      // PERFORMANCE: Only use ctx.save()/restore() when transform is needed (knockback)
      // This eliminates ~50+ state save/restore operations per frame for non-knockback enemies
      // Knockback is rare (only during active hits), so most frames have 0 save/restore calls
      if (isKnockedBack) {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.scale(1.05, 1.05); // Scale up for "oompf" - combined with color change provides sufficient feedback
        ctx.translate(-enemy.x, -enemy.y);
      }

      // PERFORMANCE: Champion glow — gold concentric rings, larger than elite glow
      // Champion supersedes elite (when isChampion is true, eliteStatus is false)
      if (enemy.isChampion && !isKnockedBack) {
        const glowRadius = (enemy.radius || 20) * 2.2;
        ctx.fillStyle = '#fbbf24'; // Gold
        // Outer glow ring
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        // Inner glow ring
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, glowRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Gold ring outline
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, (enemy.radius || 20) * 1.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (enemy.eliteStatus && !isKnockedBack) {
        // PERFORMANCE: Elite glow using two concentric circles instead of per-frame radial gradient creation
        // Radial gradients are GPU-expensive (object allocation + GPU upload every frame per elite)
        // Two semi-transparent circles achieve a similar layered glow at near-zero cost
        const glowRadius = (enemy.radius || 20) * 1.8;
        ctx.fillStyle = '#ff4400';
        // Outer glow ring
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, glowRadius, 0, Math.PI * 2);
        ctx.fill();
        // Inner glow ring
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, glowRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Draw enemy with potential white tint if knocked back or hit flashed
      let enemyColor = enemy.color || '#ff0000';

      if (hitFlashIntensity > 0) {
        // PERFORMANCE: Cache hit flash color mixing to avoid per-enemy per-frame string allocations
        // Bucket intensity to nearest 0.1 for cache hits (visual difference is imperceptible)
        const rgb = this.colorCache.hexToRgb(enemyColor) || { r: 255, g: 0, b: 0 };
        const bucket = Math.round(hitFlashIntensity * 10) / 10;
        const cacheKey = `${enemyColor},${bucket}`;
        let flashColor = this.hitFlashCache.get(cacheKey);
        if (!flashColor) {
          const flashR = Math.round(rgb.r + (255 - rgb.r) * bucket);
          const flashG = Math.round(rgb.g + (255 - rgb.g) * bucket);
          const flashB = Math.round(rgb.b + (255 - rgb.b) * bucket);
          flashColor = `rgb(${flashR}, ${flashG}, ${flashB})`;
          if (this.hitFlashCache.size >= GameRenderingService.CACHE_SIZE_CAP) {
            this.hitFlashCache.clear();
          }
          this.hitFlashCache.set(cacheKey, flashColor);
        }
        enemyColor = flashColor;
      } else if (isKnockedBack) {
        enemyColor = '#ffcccc';
      }

      // Draw enemy based on faction type
      // Champions are 1.3x scale — apply transform only for champions (rare, so cost is acceptable)
      if (enemy.isChampion) {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.scale(1.3, 1.3);
        ctx.translate(-enemy.x, -enemy.y);
        this.drawFactionEnemy(ctx, enemy, enemyColor, frameTime);
        ctx.restore();
      } else {
        this.drawFactionEnemy(ctx, enemy, enemyColor, frameTime);
      }

      // Draw shield arc overlay for sentinel enemies
      if (enemy.shieldArcData !== undefined) {
        this.renderShieldArc(ctx, enemy, frameTime);
      }

      // Draw dancing indicator if enemy is dancing
      if (enemy.isDancing) {
        this.renderDancingIndicator(ctx, enemy, frameTime);
      }

      // Health bar for damaged enemies (render BEFORE restore to keep transformation)
      if (enemy.bossPhaseData) {
        // Boss entities: always show the phase-segment health bar (even at full health)
        this.renderBossHealthBar(ctx, enemy);
      } else if (enemy.isChampion) {
        // Champions: always show gold health bar (even at full health — like mini-boss)
        this.renderChampionHealthBar(ctx, enemy);
      } else if (enemy.health < enemy.maxHealth) {
        this.renderEnemyHealthBar(ctx, enemy);
      }

      // Restore transform only if we saved it
      if (isKnockedBack) {
        ctx.restore();
      }
    }
  }

  /**
   * Render Sentinel shield arc overlay.
   *
   * NO shadowBlur, NO per-frame gradients — solid fill and stroke only.
   * Shield flashes brighter for 200ms after blocking a hit.
   */
  private renderShieldArc(ctx: CanvasRenderingContext2D, enemy: Enemy, frameTime: number): void {
    const arcData = enemy.shieldArcData;
    if (!arcData) return;

    const arcRadius = (enemy.radius || 20) * 1.5;
    const startAngle = arcData.facingAngle - arcData.halfArc;
    const endAngle = arcData.facingAngle + arcData.halfArc;

    // Determine if the shield was recently hit (within 200ms) — bright flash
    // frameTime is Date.now() captured once per frame; reuse it here to avoid a redundant call
    const isFlashing = frameTime - arcData.lastBlockTime < 200;
    const fillAlpha = isFlashing ? 0.35 : 0.15;
    const strokeAlpha = isFlashing ? 0.9 : 0.6;

    // Semi-transparent fill for shield area
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = '#00ccff';
    ctx.beginPath();
    ctx.moveTo(enemy.x, enemy.y);
    ctx.arc(enemy.x, enemy.y, arcRadius, startAngle, endAngle);
    ctx.closePath();
    ctx.fill();

    // Brighter arc edge line
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, arcRadius, startAngle, endAngle);
    ctx.stroke();

    // Reset alpha
    ctx.globalAlpha = 1;
  }

  /**
   * Render enemy health bar
   */
  private renderEnemyHealthBar(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    // Use fixed bar width instead of radius-based to prevent instability
    // Clamp radius to reasonable bounds to prevent extreme sizes
    const clampedRadius = Math.max(10, Math.min(50, enemy.radius || 20));
    const barWidth = 40; // Fixed width for stability
    const barHeight = 4;
    const barX = enemy.x - barWidth / 2;
    const barY = enemy.y - clampedRadius - 8;

    // Validate health values to prevent NaN or extreme values
    const currentHealth = Math.max(0, Math.min(enemy.health || 0, enemy.maxHealth || 100));
    const maxHealth = Math.max(1, enemy.maxHealth || 100); // Prevent divide by zero
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));

    // Background
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Health bar - ensure width is never negative or too large
    const fillWidth = Math.max(0, Math.min(barWidth, barWidth * healthPercent));
    if (fillWidth > 0) {
      // Use theme-aware health colors
      const canvasColors = this.paletteService.getCanvas();
      const healthColor =
        healthPercent > 0.5
          ? canvasColors.HEALTH_HIGH
          : healthPercent > 0.25
            ? canvasColors.HEALTH_MED
            : canvasColors.HEALTH_LOW;
      ctx.fillStyle = healthColor;
      ctx.fillRect(barX, barY, fillWidth, barHeight);
    }

    // Add border for better visibility
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  /**
   * Render champion health bar — gold-colored, always visible
   */
  private renderChampionHealthBar(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const clampedRadius = Math.max(10, Math.min(50, enemy.radius || 20));
    const barWidth = 48; // Slightly wider than normal to distinguish
    const barHeight = 5; // One pixel taller than normal
    const barX = enemy.x - barWidth / 2;
    const barY = enemy.y - clampedRadius - 9;

    const currentHealth = Math.max(0, Math.min(enemy.health || 0, enemy.maxHealth || 100));
    const maxHealth = Math.max(1, enemy.maxHealth || 100);
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));

    // Dark amber background
    ctx.fillStyle = '#78350f';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Gold fill
    const fillWidth = Math.max(0, Math.min(barWidth, barWidth * healthPercent));
    if (fillWidth > 0) {
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(barX, barY, fillWidth, barHeight);
    }

    // Gold border
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  /**
   * Render dancing indicator above enemy
   */
  private renderDancingIndicator(ctx: CanvasRenderingContext2D, enemy: Enemy, frameTime: number): void {
    // Music notes that float up and fade
    const time = frameTime / 1000;
    const bounceOffset = Math.sin(time * 4) * 5; // Sync with bounce animation

    // Position above enemy
    const indicatorY = enemy.y - (enemy.radius || 20) - 20 + bounceOffset;

    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Alternate between two note symbols
    const noteSymbol = Math.floor(time * 2) % 2 === 0 ? '♪' : '♫';

    // Rainbow color cycling for fun
    const hue = (time * 100) % 360;
    ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 2;

    // PERFORMANCE: Removed shadowBlur glow - the bright rainbow color is sufficient

    // Draw the note
    ctx.strokeText(noteSymbol, enemy.x, indicatorY);
    ctx.fillText(noteSymbol, enemy.x, indicatorY);

    // Add small floating notes around
    if (enemy.danceStage === 'spin' && enemy.spinAngle !== undefined) {
      // Draw small notes in a circle for spinning enemies
      const noteCount = 3;
      for (let i = 0; i < noteCount; i++) {
        const angle = enemy.spinAngle + (i * Math.PI * 2) / noteCount;
        const noteX = enemy.x + Math.cos(angle) * 30;
        const noteY = enemy.y + Math.sin(angle) * 30;

        ctx.globalAlpha = 0.5;
        ctx.font = '12px Arial';
        ctx.fillText('♪', noteX, noteY);
      }
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Render player
   */
  private renderPlayer(ctx: CanvasRenderingContext2D, chargeLevel: number): void {
    this.player.render(ctx, chargeLevel);
  }

  /**
   * Render aiming projection - trajectory line and preview dots
   */
  private renderAimingProjection(
    ctx: CanvasRenderingContext2D,
    aimingProjection: {
      line: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
      points: Array<{ x: number; y: number; alpha: number }>;
      isActive: boolean;
    },
    frameTime: number
  ): void {
    if (!aimingProjection.isActive) return;

    // PERFORMANCE: No save/restore needed — only style changes, no transforms

    // Render trajectory line (theme-aware)
    const themeColors = this.paletteService.getCanvas();
    if (aimingProjection.line) {
      ctx.strokeStyle = themeColors.ACCENT_CYAN;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash(GameRenderingService.DASH_5_5); // Dashed line

      ctx.beginPath();
      ctx.moveTo(aimingProjection.line.start.x, aimingProjection.line.start.y);
      ctx.lineTo(aimingProjection.line.end.x, aimingProjection.line.end.y);
      ctx.stroke();

      ctx.setLineDash(GameRenderingService.EMPTY_DASH); // Reset line dash

      // Focus-fire lock ring at line end — subtle pulse using frameTime
      // PERFORMANCE: globalAlpha computed once; no trig beyond the arc call
      const pulseAlpha = 0.55 + 0.25 * Math.sin(frameTime * 0.006);
      ctx.globalAlpha = pulseAlpha;
      ctx.strokeStyle = themeColors.ACCENT_CYAN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(aimingProjection.line.end.x, aimingProjection.line.end.y, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.6; // Restore to pre-ring value for trajectory points below
    }

    // Render trajectory points (preview projectiles)
    // PERFORMANCE: Solid color is sufficient for small dots — no shadowBlur
    const trajectoryColor = themeColors.TRAIL_MOVEMENT;
    for (const point of aimingProjection.points) {
      ctx.globalAlpha = point.alpha;
      ctx.fillStyle = trajectoryColor;

      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }

  /**
   * Render shards as crystalline diamond shapes with glow + attraction effects.
   * PERFORMANCE: Uses pre-calculated diamond vertices — no trig in the hot loop.
   * Glow layer stays circular (cheaper, reads as ambient light emanation).
   */
  private renderShards(
    ctx: CanvasRenderingContext2D,
    shardsOnGround: Shard[],
    frameTime: number,
    playerX: number,
    playerY: number
  ): void {
    const now = Date.now();

    for (const shard of shardsOnGround) {
      const isBeingAttracted = shard.isBeingAttracted || false;
      const attractionDistance = shard.attractionDistance || 1;
      const r = shard.radius;
      const x = shard.x;
      const y = shard.y;

      // Age-based fade — shards begin fading at 15s, fully gone at 20s
      const age = now - (shard.spawnTime || now);
      const fadeStart = 15_000;
      const fadeEnd = 20_000;
      const ageFade = age < fadeStart ? 1.0 : Math.max(0, 1 - (age - fadeStart) / (fadeEnd - fadeStart));
      if (ageFade <= 0) continue; // Skip fully expired shards

      // Glow pulsation — phase-offset per shard for visual diversity
      let glowIntensity = Math.sin((shard.glowPhase || 0) + frameTime * 0.01) * 0.3 + 0.7;
      let alpha = 0.8 * ageFade;
      let glowRadius = r * 2.5;

      if (isBeingAttracted) {
        glowIntensity = Math.sin(frameTime * 0.02) * 0.4 + 0.8;
        glowRadius = r * 2.5 + (1 - attractionDistance) * 15;
        alpha = (0.8 + (1 - attractionDistance) * 0.2) * ageFade;
      }

      const color = this.colorCache.darkenForLightMode(shard.color || '#ff69b4');

      // 1) Ambient glow circle (cheap, no path complexity)
      ctx.globalAlpha = alpha * 0.3 * glowIntensity;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // 2) Diamond core — 4-point crystal shape (tall & narrow)
      // Vertices: top, right, bottom, left with slight vertical elongation
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.3); // top (elongated)
      ctx.lineTo(x + r * 0.65, y); // right
      ctx.lineTo(x, y + r * 0.9); // bottom (shorter tail)
      ctx.lineTo(x - r * 0.65, y); // left
      ctx.closePath();
      ctx.fill();

      // 3) Inner highlight — smaller diamond offset upward for facet illusion
      ctx.globalAlpha = alpha * 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.9);
      ctx.lineTo(x + r * 0.25, y - r * 0.15);
      ctx.lineTo(x, y + r * 0.1);
      ctx.lineTo(x - r * 0.25, y - r * 0.15);
      ctx.closePath();
      ctx.fill();

      // 4) Crystal outline for crispness
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.3);
      ctx.lineTo(x + r * 0.65, y);
      ctx.lineTo(x, y + r * 0.9);
      ctx.lineTo(x - r * 0.65, y);
      ctx.closePath();
      ctx.stroke();

      // 5) Attraction effects
      if (isBeingAttracted) {
        // Expanding ring that intensifies as shard approaches
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.globalAlpha = (1 - attractionDistance) * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 5 + (1 - attractionDistance) * 10, 0, Math.PI * 2);
        ctx.stroke();

        // Dashed trail line toward player
        ctx.save();
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = this.themeService.isDayMode ? 'rgba(47, 79, 79, 0.3)' : 'rgba(0, 255, 200, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash(GameRenderingService.DASH_4_8);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(playerX, playerY);
        ctx.stroke();
        ctx.restore();
      }

      ctx.globalAlpha = 1.0;

      // 6) Value text for multi-shards
      if ((shard.value || 1) > 1) {
        const textColor = this.paletteService.getCanvas().STROKE_PRIMARY;
        ctx.fillStyle = textColor;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((shard.value || 1).toString(), x, y - r * 1.3 - 5);
      }
    }
  }

  /**
   * Render projectiles with batching optimization
   * FIX: Batch basic projectiles by color to reduce draw calls and state changes
   */
  private renderProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[], frameTime: number): void {
    // PERFORMANCE: Reuse pre-allocated arrays instead of allocating new ones per frame
    const basicProjectiles = this.basicProjectilesBuffer;
    const chargedProjectiles = this.chargedProjectilesBuffer;
    basicProjectiles.length = 0;
    chargedProjectiles.length = 0;

    for (const projectile of projectiles) {
      if (!(projectile.radius > 0)) continue; // guard against corrupt data

      if (projectile.isCharged) {
        chargedProjectiles.push(projectile);
      } else {
        basicProjectiles.push(projectile);
      }
    }

    // Batch render basic projectiles by color (most common case)
    this.renderBasicProjectilesBatched(ctx, basicProjectiles);

    // Render charged projectiles individually (they have complex effects)
    // PERFORMANCE: No save/restore needed — renderChargedProjectile only changes styles, no transforms
    for (const projectile of chargedProjectiles) {
      this.renderChargedProjectile(ctx, projectile, frameTime);
    }
    ctx.globalAlpha = 1.0;
  }

  /**
   * Batch render basic projectiles by color for performance
   * FIX: Groups projectiles by color and renders in batches to reduce state changes
   */
  private renderBasicProjectilesBatched(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    if (projectiles.length === 0) return;

    // Group projectiles by color (use theme-aware default)
    // FIX: Reuse pre-allocated Map to avoid GC pressure
    const defaultColor = this.paletteService.getCanvas().ACCENT_CYAN;
    const byColor = this.projectileColorBatches;
    // Clear arrays but keep map structure
    for (const batch of byColor.values()) {
      batch.length = 0;
    }
    for (const projectile of projectiles) {
      const color = projectile.color || defaultColor;
      let batch = byColor.get(color);
      if (!batch) {
        batch = [];
        byColor.set(color, batch);
      }
      batch.push(projectile);
    }

    // Render each color batch with a single state setup
    // PERFORMANCE: Removed shadowBlur entirely - projectiles are small, solid color is sufficient
    for (const [color, batch] of byColor) {
      ctx.fillStyle = color;

      // Draw all projectiles of this color in one path
      ctx.beginPath();
      for (const projectile of batch) {
        ctx.moveTo(projectile.x + projectile.radius, projectile.y);
        ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  /**
   * Render charged projectile with enhanced effects
   * PERFORMANCE: Uses simple concentric fills instead of radial gradients or shadowBlur
   */
  private renderChargedProjectile(ctx: CanvasRenderingContext2D, projectile: Projectile, frameTime: number): void {
    const time = frameTime;
    // Light mode: darken neon charged projectile color for visibility on cream background
    const effectiveColor = this.colorCache.darkenForLightMode(projectile.color);
    const pulseIntensity = Math.sin(time * 0.01) * 0.3 + 0.7;
    const glowIntensity = (projectile.glowIntensity || 1) * pulseIntensity;

    // PERFORMANCE: Simple circle glow instead of expensive radial gradient
    const glowRadius = projectile.radius * 2.5 * glowIntensity;
    ctx.globalAlpha = 0.25 * pulseIntensity;
    ctx.fillStyle = effectiveColor;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // Outer glow ring
    ctx.globalAlpha = 0.3 * pulseIntensity;
    ctx.fillStyle = effectiveColor;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius * 1.8, 0, Math.PI * 2);
    ctx.fill();

    // Inner bright core (theme-aware)
    const coreColor = this.paletteService.getCanvas().STROKE_PRIMARY;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // Main projectile body
    ctx.globalAlpha = 1;
    ctx.fillStyle = effectiveColor;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();

    // Energy crackle effect for highly charged projectiles
    if ((projectile.chargeLevel ?? 0) > 0.7) {
      this.renderEnergyArcs(ctx, projectile, time);
    }

    // Render charge indicator ring
    const chargeLevel = projectile.chargeLevel ?? 0;
    if (chargeLevel > 0) {
      ctx.strokeStyle = effectiveColor;
      ctx.lineWidth = RING_CONFIG.LINE_WIDTH;
      ctx.globalAlpha = RING_CONFIG.MIN_ALPHA + chargeLevel * RING_CONFIG.ALPHA_SCALE;
      ctx.beginPath();
      const ringRadius =
        projectile.radius * (RING_CONFIG.MIN_RADIUS_MULTIPLIER + chargeLevel * RING_CONFIG.RADIUS_SCALE);
      ctx.arc(projectile.x, projectile.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Guarantee alpha reset regardless of chargeLevel path
    ctx.globalAlpha = 1;
  }

  /**
   * Render energy arcs around highly charged projectiles
   */
  private renderEnergyArcs(ctx: CanvasRenderingContext2D, projectile: Projectile, time: number): void {
    const arcCount = 4;
    const arcRadius = projectile.radius * 1.5;

    ctx.strokeStyle = projectile.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6 + Math.sin(time * 0.015) * 0.3;

    for (let i = 0; i < arcCount; i++) {
      const angle = (time * 0.005 + (i * Math.PI) / 2) % (Math.PI * 2);
      const arcOffset = Math.sin(time * 0.01 + i) * 3;

      const startX = projectile.x + Math.cos(angle) * (arcRadius + arcOffset);
      const startY = projectile.y + Math.sin(angle) * (arcRadius + arcOffset);
      const endX = projectile.x + Math.cos(angle + 0.3) * (arcRadius - arcOffset);
      const endY = projectile.y + Math.sin(angle + 0.3) * (arcRadius - arcOffset);

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Render pickup effects
   */
  private renderPickupEffects(
    ctx: CanvasRenderingContext2D,
    pickupEffects: Array<{ x: number; y: number; currentRadius: number; maxRadius: number; opacity: number }>
  ): void {
    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    // PERF: Route per-frame rgba strings through getCachedRgba to eliminate template-literal
    // allocation. opacity is bucketed to nearest 1/255 step inside getCachedRgba.
    ctx.lineWidth = 1;
    const isDayMode = this.themeService.isDayMode;
    for (const p of pickupEffects) {
      if (!(p.currentRadius > 0)) continue; // prevent negative radius crash
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = isDayMode
        ? this.getCachedRgba(8, 145, 178, p.opacity)
        : this.getCachedRgba(255, 255, 255, p.opacity);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.currentRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  }

  /**
   * Render enemy death effects
   */
  private renderEnemyDeathEffects(
    ctx: CanvasRenderingContext2D,
    enemyDeathEffects: Array<{ x: number; y: number; currentRadius: number; maxRadius: number; opacity: number }>
  ): void {
    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    // PERF: Route per-frame rgba string through getCachedRgba to eliminate template-literal
    // allocation. opacity is bucketed to nearest 1/255 step inside getCachedRgba.
    ctx.lineWidth = 2;
    for (const e of enemyDeathEffects) {
      if (!(e.currentRadius > 0)) continue;
      ctx.globalAlpha = e.opacity;
      ctx.strokeStyle = this.getCachedRgba(255, 80, 80, e.opacity);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.currentRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
  }

  /**
   * Render a boss health-segment bar above a boss entity.
   *
   * Layout (world-space, called inside camera transform):
   *   - Bar is positioned BOSS_HEALTH_BAR_OFFSET px above the entity centre.
   *   - Width: BOSS_HEALTH_BAR_WIDTH px, Height: BOSS_HEALTH_BAR_HEIGHT px.
   *   - Fill colour transitions green → yellow → red with health %.
   *   - Thin vertical phase-marker lines at each phaseThreshold boundary.
   *   - Subtle white outline for readability on any background.
   *
   * PERFORMANCE: called at most once per frame (single boss entity).
   * No save/restore needed — only rect/line ops, no transforms.
   */
  private readonly BOSS_HEALTH_BAR_WIDTH = 60;
  private readonly BOSS_HEALTH_BAR_HEIGHT = 4;
  private readonly BOSS_HEALTH_BAR_OFFSET = 20; // px above entity centre

  private renderBossHealthBar(ctx: CanvasRenderingContext2D, enemy: Enemy): void {
    const bossPhaseData = enemy.bossPhaseData;
    if (!bossPhaseData) return;

    const clampedRadius = Math.max(10, Math.min(60, enemy.radius || 40));
    const barW = this.BOSS_HEALTH_BAR_WIDTH;
    const barH = this.BOSS_HEALTH_BAR_HEIGHT;
    const barX = enemy.x - barW / 2;
    const barY = enemy.y - clampedRadius - this.BOSS_HEALTH_BAR_OFFSET;

    const currentHealth = Math.max(0, Math.min(enemy.health || 0, enemy.maxHealth || 1));
    const maxHealth = Math.max(1, enemy.maxHealth || 1);
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));

    // Background track
    ctx.fillStyle = this.themeService.isDayMode ? 'rgba(220, 38, 38, 0.15)' : 'rgba(255, 255, 255, 0.15)';
    ctx.fillRect(barX, barY, barW, barH);

    // Health fill — colour transitions with health percentage
    const fillWidth = Math.max(0, barW * healthPercent);
    if (fillWidth > 0) {
      const canvasColors = this.paletteService.getCanvas();
      const healthColor =
        healthPercent > 0.5
          ? canvasColors.HEALTH_HIGH
          : healthPercent > 0.25
            ? canvasColors.HEALTH_MED
            : canvasColors.HEALTH_LOW;
      ctx.fillStyle = healthColor;
      ctx.fillRect(barX, barY, fillWidth, barH);
    }

    // Phase-transition markers — thin vertical lines at each phaseThreshold
    if (bossPhaseData.phaseThresholds.length > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      for (const threshold of bossPhaseData.phaseThresholds) {
        const markerX = barX + barW * threshold;
        ctx.beginPath();
        ctx.moveTo(markerX, barY - 1);
        ctx.lineTo(markerX, barY + barH + 1);
        ctx.stroke();
      }
    }

    // Outer border
    ctx.strokeStyle = this.themeService.isDayMode ? 'rgba(71, 85, 105, 0.35)' : 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);
  }

  /**
   * Clear all render caches to reclaim memory.
   * Called on game reset / wave transitions to prevent unbounded growth.
   */
  public clearRenderCaches(): void {
    this.colorCache.clearCaches();
    this.hazardColorCache.clear();
    this.hitFlashCache.clear();
    this.asteroidGeometryCache = new WeakMap<Asteroid, AsteroidRenderGeometry>();
    // Clear stale color-key entries accumulated across sessions; the Map is fully
    // rebuilt before it is read each frame, so clearing here is always safe.
    this.projectileColorBatches.clear();
    this.zoneParticleRenderer.reset();
    this.zoneFlashSub?.unsubscribe();
    this.zoneFlashSub = null;
  }

  // NOTE: Old renderMinimap, renderFullMap, and renderTerritoryBackground methods have been removed.
  // Map rendering is now handled by the Angular MapComponent (features/map/).

  /**
   * Render particle effects from the new effects system
   */
  private renderParticleEffects(ctx: CanvasRenderingContext2D): void {
    // Render particles by layer (0 = background, higher = foreground)
    for (let layer = 0; layer < 10; layer++) {
      const particles = this.effectsSystem.getParticlesByLayer(layer);
      this.renderParticleLayer(ctx, particles);
    }
  }

  /**
   * Render zone gate visuals in world space.
   *
   * Locked gates: vertical barrier line + pulsing diamond shape using the destination
   * zone's themeColor. Unlock animation: expanding ring that fades over 1 second.
   *
   * PERFORMANCE:
   * - Zone colors pre-cached in constructor (no string allocation per frame).
   * - Viewport culled before any canvas ops (200px buffer).
   * - No shadowBlur, no save()/restore().
   * - Dynamic ring alpha fed through cachedRgba() to stay in the bucket cache.
   */
  private renderZoneGates(
    ctx: CanvasRenderingContext2D,
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number
  ): void {
    const gateEntities = entityManager.getEntitiesWithComponents(ZoneGateComponent, PositionComponent);
    if (gateEntities.length === 0) return;

    const now = Date.now();

    for (const entity of gateEntities) {
      const gate = entityManager.getComponent(entity, ZoneGateComponent);
      const pos = entityManager.getComponent(entity, PositionComponent);
      if (!gate || !pos) continue;

      // Viewport cull with 200px buffer (world-space coords match cameraX/Y offset frame)
      const cullBuffer = 200;
      if (
        pos.x < cameraX - cullBuffer ||
        pos.x > cameraX + screenWidth + cullBuffer ||
        pos.y < cameraY - cullBuffer ||
        pos.y > cameraY + screenHeight + cullBuffer
      ) {
        continue;
      }

      // World-to-screen transform is already applied via ctx.translate in the camera block,
      // so we draw at world-space coordinates directly.
      const drawX = pos.x;
      const drawY = pos.y;

      if (!gate.isUnlocked) {
        // --- Locked gate: vertical barrier + pulsing diamond ---
        const pulseAlpha = 0.6 * (0.7 + 0.3 * Math.sin(now * 0.003));
        const rgb = this.zoneGateRgbCache.get(gate.toZoneId);

        if (rgb) {
          const color = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, pulseAlpha);

          // Vertical barrier line (3px wide, 200px tall)
          ctx.globalAlpha = pulseAlpha;
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(drawX, drawY - 100);
          ctx.lineTo(drawX, drawY + 100);
          ctx.stroke();

          // Diamond shape at center (15px from center to each point)
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(drawX, drawY - 15); // top
          ctx.lineTo(drawX + 15, drawY); // right
          ctx.lineTo(drawX, drawY + 15); // bottom
          ctx.lineTo(drawX - 15, drawY); // left
          ctx.closePath();
          ctx.fill();

          // Progress bar for locked gate (below diamond)
          const progress = this.zoneGateSystem.getCurrentProgress(gate);
          const ratio = Math.min(1, progress / gate.unlockValue);
          if (ratio > 0) {
            const barWidth = 40;
            const barHeight = 3;
            const barY = drawY + 22;
            const barX = drawX - barWidth / 2;

            // Background track
            ctx.fillStyle = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, 0.15);
            ctx.fillRect(barX, barY, barWidth, barHeight);

            // Progress fill
            ctx.fillStyle = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, pulseAlpha * 0.8);
            ctx.fillRect(barX, barY, barWidth * ratio, barHeight);
          }

          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
        }
      } else {
        // --- Recently unlocked: expanding ring animation (1 second) ---
        const elapsed = now - gate.lastTriggerTime;
        if (elapsed < 1000) {
          const progress = elapsed / 1000;
          const radius = 20 + progress * 100;
          const alpha = 1 - progress;
          const rgb = this.zoneGateRgbCache.get(gate.toZoneId);

          if (rgb) {
            const color = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, alpha);
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Particle burst: 8 small dots radiating outward from gate center
            const particleCount = 8;
            const particleRadius = 3;
            ctx.fillStyle = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, alpha * 0.7);
            for (let i = 0; i < particleCount; i++) {
              const pAngle = (i / particleCount) * Math.PI * 2;
              const pDist = 15 + progress * 80; // Expand outward with the ring
              const px = drawX + Math.cos(pAngle) * pDist;
              const py = drawY + Math.sin(pAngle) * pDist;
              ctx.beginPath();
              ctx.arc(px, py, particleRadius * (1 - progress), 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.globalAlpha = 1;
            ctx.lineWidth = 1;
          }
        }
      }
    }
  }

  /**
   * Render treasure cache entities as hexagons in world-space.
   *
   * Closed caches: slowly rotating hexagon (radius 18) with gentle alpha pulse + inner dot.
   * Open caches: small static hexagon (radius 10) at low alpha (depleted look).
   * Off-screen closed caches: direction arrow at screen edge pointing toward the cache.
   *
   * PERFORMANCE:
   * - Accent colors pre-cached in constructor (no string allocation per frame).
   * - No shadowBlur, no gradient creation, no save()/restore().
   * - Hexagon vertices computed inline (6 trig calls — no array allocation).
   * - Off-screen arrow only rendered for closed caches.
   * - Dynamic alpha fed through cachedRgba() to stay in the bucket cache.
   */
  private renderTreasureCaches(
    ctx: CanvasRenderingContext2D,
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number
  ): void {
    const cacheEntities = entityManager.getEntitiesWithComponents(ZoneTreasureCacheComponent, PositionComponent);
    if (cacheEntities.length === 0) return;

    // The ctx carries the camera ZOOM scale, so all math in here is in WORLD units.
    // screenWidth/Height are CSS *screen* px — at zoom < 1 using them directly shrank the
    // "screen edge" rectangle to a mid-field box and the cache arrows floated "everywhere"
    // instead of hugging the edges. Convert to world-view dims once.
    const viewW = screenWidth / zoom;
    const viewH = screenHeight / zoom;

    const now = Date.now();
    const onScreenBuffer = 50;
    this.cacheArrowCount = 0;

    for (const entity of cacheEntities) {
      const cache = entityManager.getComponent(entity, ZoneTreasureCacheComponent);
      const pos = entityManager.getComponent(entity, PositionComponent);
      if (!cache || !pos) continue;

      const rgb = this.zoneAccentRgbCache.get(cache.zoneId);
      if (!rgb) continue;

      // Screen-space coordinates (world transform is applied via ctx.translate in the camera block)
      // Since the camera transform is already applied, we draw at world coords.
      // For screen-edge arrows we need actual screen coords (world pos minus camera offset).
      const screenX = pos.x - cameraX;
      const screenY = pos.y - cameraY;

      const onScreen =
        screenX >= -onScreenBuffer &&
        screenX <= viewW + onScreenBuffer &&
        screenY >= -onScreenBuffer &&
        screenY <= viewH + onScreenBuffer;

      if (onScreen) {
        // Draw at world-space coordinates (camera transform already applied to ctx)
        const drawX = pos.x;
        const drawY = pos.y;

        if (!cache.isOpen) {
          // --- Closed cache: rotating hexagon with alpha pulse ---
          const rotation = (now * 0.0005) % (Math.PI * 2);
          let pulseAlpha = 0.8 * (0.7 + 0.3 * Math.sin(now * 0.002));
          let hexRadius = 18;

          // Check if guardian is dead — pulse brighter as "openable" signal
          const guardianId = this.cacheGuardianMap.get(cache.cacheId);
          const isOpenable = guardianId === undefined || !this.guardianSpawner.isGuardianAlive(guardianId);
          if (isOpenable) {
            pulseAlpha = 0.95 * (0.8 + 0.2 * Math.sin(now * 0.004)); // Faster, brighter pulse
            hexRadius = 22; // Slightly larger to signal "come collect me"
          }

          ctx.strokeStyle = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, pulseAlpha);
          ctx.lineWidth = 2;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = rotation + i * (Math.PI / 3);
            const vx = drawX + hexRadius * Math.cos(angle);
            const vy = drawY + hexRadius * Math.sin(angle);
            if (i === 0) {
              ctx.moveTo(vx, vy);
            } else {
              ctx.lineTo(vx, vy);
            }
          }
          ctx.closePath();
          ctx.stroke();

          // Inner dot at center
          ctx.fillStyle = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, pulseAlpha);
          ctx.beginPath();
          ctx.arc(drawX, drawY, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.lineWidth = 1;
        } else {
          // --- Open cache: small static hexagon at low alpha (depleted) ---
          const hexRadius = 10;
          const depletedAlpha = 0.2;

          ctx.strokeStyle = this.colorCache.cachedRgba(rgb.r, rgb.g, rgb.b, depletedAlpha);
          ctx.lineWidth = 2;
          ctx.globalAlpha = 1;
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = i * (Math.PI / 3);
            const vx = drawX + hexRadius * Math.cos(angle);
            const vy = drawY + hexRadius * Math.sin(angle);
            if (i === 0) {
              ctx.moveTo(vx, vy);
            } else {
              ctx.lineTo(vx, vy);
            }
          }
          ctx.closePath();
          ctx.stroke();

          ctx.lineWidth = 1;
        }
      } else if (!cache.isOpen) {
        // --- Off-screen closed cache: candidate for an edge direction arrow ---
        // Up to 13 caches exist; rendering ALL their arrows read as "triangles everywhere".
        // Collect candidates into the pre-allocated nearest-N slots; render after the loop.
        const centerWorldX = cameraX + viewW * 0.5;
        const centerWorldY = cameraY + viewH * 0.5;
        const dx = pos.x - centerWorldX;
        const dy = pos.y - centerWorldY;
        const dist2 = dx * dx + dy * dy;

        // Insertion into the fixed nearest-N slot array (no sort, no allocation)
        const slots = this.cacheArrowSlots;
        if (this.cacheArrowCount < slots.length || dist2 < slots[this.cacheArrowCount - 1].dist2) {
          let i = Math.min(this.cacheArrowCount, slots.length - 1);
          while (i > 0 && slots[i - 1].dist2 > dist2) {
            slots[i].dist2 = slots[i - 1].dist2;
            slots[i].angle = slots[i - 1].angle;
            slots[i].r = slots[i - 1].r;
            slots[i].g = slots[i - 1].g;
            slots[i].b = slots[i - 1].b;
            i--;
          }
          slots[i].dist2 = dist2;
          slots[i].angle = Math.atan2(dy, dx);
          slots[i].r = rgb.r;
          slots[i].g = rgb.g;
          slots[i].b = rgb.b;
          if (this.cacheArrowCount < slots.length) this.cacheArrowCount++;
        }
      }
    }

    // --- Render the nearest-N off-screen cache arrows at the true screen edges ---
    // Gentle shared pulse so they read as live pointers ("a cache is THAT way"), not debris.
    if (this.cacheArrowCount > 0) {
      const margin = 30 / zoom; // 30 SCREEN px, expressed in world units
      const halfW = viewW * 0.5 - margin;
      const halfH = viewH * 0.5 - margin;
      const arrowSize = 10 / zoom; // constant ~10 screen px — UI marker, not a world object
      const pulseAlpha = 0.45 + 0.25 * Math.sin(now * 0.004);

      for (let s = 0; s < this.cacheArrowCount; s++) {
        const slot = this.cacheArrowSlots[s];
        const angle = slot.angle;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        let tx: number;
        let ty: number;

        if (Math.abs(sinA) * halfW > Math.abs(cosA) * halfH) {
          // Hits top or bottom edge
          const sign = sinA > 0 ? 1 : -1;
          ty = sign * halfH;
          tx = (cosA / Math.abs(sinA)) * halfH * sign;
        } else {
          // Hits left or right edge
          const sign = cosA > 0 ? 1 : -1;
          tx = sign * halfW;
          ty = (sinA / Math.abs(cosA)) * halfW * sign;
        }

        // Center-relative → view coords → world coords (camera transform is active)
        const arrowWorldX = cameraX + Math.max(margin, Math.min(viewW - margin, tx + viewW * 0.5));
        const arrowWorldY = cameraY + Math.max(margin, Math.min(viewH - margin, ty + viewH * 0.5));

        ctx.fillStyle = this.colorCache.cachedRgba(slot.r, slot.g, slot.b, 0.85);
        ctx.globalAlpha = pulseAlpha;
        ctx.beginPath();
        ctx.moveTo(arrowWorldX + arrowSize * cosA, arrowWorldY + arrowSize * sinA);
        ctx.lineTo(
          arrowWorldX + arrowSize * Math.cos(angle + (2 * Math.PI) / 3),
          arrowWorldY + arrowSize * Math.sin(angle + (2 * Math.PI) / 3)
        );
        ctx.lineTo(
          arrowWorldX + arrowSize * Math.cos(angle - (2 * Math.PI) / 3),
          arrowWorldY + arrowSize * Math.sin(angle - (2 * Math.PI) / 3)
        );
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Reset state
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /**
   * Render a specific layer of particles
   */
  private renderParticleLayer(ctx: CanvasRenderingContext2D, particles: ParticleData[]): void {
    if (particles.length === 0) return;

    // PERFORMANCE: No save/restore needed — only changes globalCompositeOperation, no transforms

    // Group particles by blend mode for batching
    const particlesByBlend = this.groupParticlesByBlendMode(particles);

    for (const [blendMode, groupedParticles] of particlesByBlend) {
      this.setBlendMode(ctx, blendMode);
      this.renderParticleGroup(ctx, groupedParticles);
      ctx.globalCompositeOperation = 'source-over'; // Reset after each blend group
    }

    // Safety net: ensure composite operation is reset even if loop exits unexpectedly
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /**
   * Group particles by blend mode for efficient rendering
   */
  private groupParticlesByBlendMode(particles: ParticleData[]): Map<BlendMode, ParticleData[]> {
    // FIX: Reuse pre-allocated Map to avoid GC pressure
    const groups = this.particleBlendGroups;
    // Clear arrays but keep map structure
    for (const group of groups.values()) {
      group.length = 0;
    }

    for (const particle of particles) {
      if (!particle.isAlive) continue;

      const blendMode = BlendMode.ADDITIVE; // Default blend mode
      let group = groups.get(blendMode);
      if (!group) {
        group = [];
        groups.set(blendMode, group);
      }
      group.push(particle);
    }

    return groups;
  }

  /**
   * Set canvas blend mode
   */
  private setBlendMode(ctx: CanvasRenderingContext2D, blendMode: BlendMode): void {
    switch (blendMode) {
      case BlendMode.ADDITIVE:
        ctx.globalCompositeOperation = 'lighter';
        break;
      case BlendMode.MULTIPLY:
        ctx.globalCompositeOperation = 'multiply';
        break;
      case BlendMode.SCREEN:
        ctx.globalCompositeOperation = 'screen';
        break;
      case BlendMode.OVERLAY:
        ctx.globalCompositeOperation = 'overlay';
        break;
      default:
        ctx.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * Render a group of particles with the same blend mode
   */
  private renderParticleGroup(ctx: CanvasRenderingContext2D, particles: ParticleData[]): void {
    for (const particle of particles) {
      this.renderSingleParticle(ctx, particle);
    }
  }

  /**
   * Render an individual particle
   */
  private renderSingleParticle(ctx: CanvasRenderingContext2D, particle: ParticleData): void {
    // PERFORMANCE: Only save/restore when rotation transform is needed
    const hasRotation = particle.rotation !== 0;

    ctx.globalAlpha = particle.opacity;

    const { r, g, b, a } = particle.color;
    ctx.fillStyle = this.colorCache.cachedRgba(r ?? 0, g ?? 0, b ?? 0, a ?? 1);

    // Apply rotation if needed (requires save/restore for transform)
    if (hasRotation) {
      ctx.save();
      ctx.translate(particle.position.x, particle.position.y);
      ctx.rotate(particle.rotation);
      ctx.translate(-particle.position.x, -particle.position.y);
    }

    // Render based on particle type
    switch (particle.type) {
      case ParticleType.DAMAGE_NUMBER:
        this.renderDamageNumberParticle(ctx, particle);
        break;
      default:
        this.renderCircleParticle(ctx, particle);
    }

    if (hasRotation) {
      ctx.restore();
    }
  }

  /**
   * Render a circular particle (most common)
   */
  private renderCircleParticle(ctx: CanvasRenderingContext2D, particle: ParticleData): void {
    ctx.beginPath();
    ctx.arc(particle.position.x, particle.position.y, particle.size, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Render a damage number particle
   */
  private renderDamageNumberParticle(ctx: CanvasRenderingContext2D, particle: ParticleData): void {
    // Get damage value from effects system
    const damage = this.effectsSystem.getDamageValue(particle.id);
    const text = damage !== undefined ? damage.toString() : '0';
    const fontSize = Math.max(12, particle.size);

    // PERFORMANCE: No save/restore needed — only style changes, no transforms
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = particle.opacity;

    // Text color based on particle color
    ctx.fillStyle = this.colorCache.cachedRgba(
      particle.color.r ?? 0,
      particle.color.g ?? 0,
      particle.color.b ?? 0,
      particle.color.a ?? 1
    );

    // Draw text with outline for visibility - theme aware
    // Light mode: white outline makes colored text pop on slate background
    // Dark mode: black outline makes bright text pop on dark background
    const isDayMode = this.themeService.isDayMode;
    ctx.strokeStyle = isDayMode ? '#ffffff' : '#000000';
    ctx.lineWidth = isDayMode ? 3 : 2;
    ctx.strokeText(text, particle.position.x, particle.position.y);
    ctx.fillText(text, particle.position.x, particle.position.y);
  }

  /**
   * Get a cached rgba() color string, keyed by a collision-free 32-bit integer.
   *
   * Key formula: `(r<<24)|(g<<16)|(b<<8)|Math.round(a*255)`
   * - r, g, b are already integers in [0,255] (canvas color channels).
   * - alpha is quantised to the nearest 1/255 step (~0.004 resolution), which is
   *   imperceptible and keeps the key space bounded to ≤ 256 entries per (r,g,b).
   * - No string concatenation — zero heap allocation for the cache lookup.
   *
   * Eliminates per-frame template literal allocations in render loops.
   */
  private getCachedRgba(r: number, g: number, b: number, a: number): string {
    const a8 = Math.round(Math.max(0, Math.min(1, a)) * 255);
    const key = ((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | a8;
    let cached = this.hazardColorCache.get(key);
    if (!cached) {
      // Quantise the stored alpha to the SAME 1/255 step the key uses. Rounding to 1/100
      // here instead let two alphas in one a8 bucket resolve to different strings (first
      // writer won, up to 0.01 alpha drift). Sharing the boundary eliminates the mismatch.
      cached = `rgba(${r}, ${g}, ${b}, ${(a8 / 255).toFixed(3)})`;
      if (this.hazardColorCache.size >= GameRenderingService.CACHE_SIZE_CAP) {
        this.hazardColorCache.clear();
      }
      this.hazardColorCache.set(key, cached);
    }
    return cached;
  }

  /**
   * Draw faction-specific enemy designs
   * 4 factions based on territory kings:
   * 1. Crimson (Red) - Aggressive triangular ships
   * 2. Azure (Blue) - Defensive hexagonal drones
   * 3. Verdant (Green) - Organic swarm creatures
   * 4. Golden (Yellow) - Energy-based entities
   */
  /**
   * Performance: Uses cached factionId and hitFlashIntensity from RenderingSystemService.getEnemies()
   * This eliminates 2 component lookups per enemy per frame (FactionComponent + duplicate HitFlashComponent)
   */
  private drawFactionEnemy(ctx: CanvasRenderingContext2D, enemy: Enemy, _color: string, frameTime: number): void {
    // Use cached faction ID (populated in RenderingSystemService.getEnemies())
    const factionId = enemy.factionId || 0;

    // Get the pre-generated creature sprite (animated for Boss, shooting for ranged)
    const enemyType = enemy.type || EnemyType.Basic;
    const animationTime = frameTime;

    // Check if enemy is shooting (for ranged enemies)
    let isShooting = false;
    if (enemyType === EnemyType.Spitter || enemyType === EnemyType.Sniper) {
      // Enemy is shooting if they shot recently (within last 500ms)
      const lastShotTime = enemy.lastShotTime || 0;
      isShooting = animationTime - lastShotTime < 500;
    }

    const sprite = this.factionEnemyRenderer.spriteGenerator.getSprite(
      enemyType,
      factionId,
      enemyType === EnemyType.Boss ? animationTime : undefined,
      isShooting,
      undefined,
      undefined,
      enemy.bossPhaseData?.archetype
    );

    // Draw the sprite centered on enemy position - no extra glow needed
    // The sprites themselves are now VIBRANT and faction-colored
    const spriteSize = sprite.width;
    ctx.drawImage(sprite, enemy.x - spriteSize / 2, enemy.y - spriteSize / 2, spriteSize, spriteSize);

    // Per-archetype tint overlay for bosses — makes Swarm King and Pyroclast
    // visually distinct from the standard Void Tyrant instead of relying on
    // phase-timing differences alone (Honesty Fix #2).
    if (enemyType === EnemyType.Boss && enemy.bossPhaseData) {
      const tint = BOSS_ARCHETYPE_TINTS[enemy.bossPhaseData.archetype];
      if (tint !== null) {
        const tintRadius = spriteSize * 0.42;
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, tintRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // PERFORMANCE: Hit flash and aggro glow use simple overlay circles instead of
    // source-atop composite — source-atop requires GPU framebuffer readback per enemy
    // and was the dominant lag spike source with 20-30 NPC combat enemies on screen.
    const hitFlashIntensity = enemy.hitFlashIntensity || 0;
    if (hitFlashIntensity > 0) {
      // White flash overlay — draw a semi-transparent white circle over the sprite
      const flashRadius = spriteSize * 0.35;
      ctx.globalAlpha = hitFlashIntensity * 0.5;
      ctx.fillStyle = this.themeService.isDayMode ? '#dc2626' : '#ffffff';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, flashRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Subtle aggro glow for NPCs in faction combat (don't stack with hit flash)
    const isInNpcCombat = enemy.isInNpcCombat || false;
    if (isInNpcCombat && hitFlashIntensity <= 0) {
      const aggroConfig = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.VISUAL;
      const pulseAlpha =
        aggroConfig.AGGRO_GLOW_ALPHA_BASE +
        aggroConfig.AGGRO_GLOW_ALPHA_PULSE * Math.sin(frameTime * aggroConfig.AGGRO_GLOW_PULSE_SPEED);
      const aggroColors = getFactionColors(factionId, this.themeService.isDayMode);
      // Draw faction-colored glow circle behind sprite
      const glowRadius = spriteSize * 0.4;
      ctx.globalAlpha = pulseAlpha;
      ctx.fillStyle = aggroColors.glow;
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Cull entities outside the viewport into a pre-allocated output array.
   * Eliminates the per-call array allocation that `.filter()` would produce.
   * The output array is cleared and refilled on each call — callers must not
   * hold references across frames or across subsequent cullInto() calls on the
   * same buffer.
   *
   * @param out   Pre-allocated class-level array to write results into (cleared first)
   * @param radiusFn Optional function to extract radius from each entity, avoiding
   *   intermediate .map() allocations when entities lack a `radius` property.
   */
  private cullInto<T extends { x: number; y: number; radius?: number }>(
    out: T[],
    entities: T[],
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number,
    radiusFn?: (entity: T) => number
  ): void {
    // Add buffer to render entities slightly off-screen for smooth transitions
    const buffer = 150; // Buffer in world units

    // cameraX/cameraY is the TOP-LEFT corner of the viewport (from calculateCameraPosition).
    // The viewport extends from cameraX to cameraX + screenWidth/zoom in world units.
    const minX = cameraX - buffer;
    const maxX = cameraX + screenWidth / zoom + buffer;
    const minY = cameraY - buffer;
    const maxY = cameraY + screenHeight / zoom + buffer;

    out.length = 0;
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const radius = radiusFn ? radiusFn(entity) : entity.radius || 50;
      if (
        entity.x + radius >= minX &&
        entity.x - radius <= maxX &&
        entity.y + radius >= minY &&
        entity.y - radius <= maxY
      ) {
        out.push(entity);
      }
    }
  }
}
