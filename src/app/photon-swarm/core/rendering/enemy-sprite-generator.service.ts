import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { EnemyType } from '../models/enemy.model';
import { getFactionColors, POOL_CONFIG } from '@photon/config/game-constants';
import { ThemeService } from '@services/theme.service';
import { createSpriteCanvas, SpriteCanvas, SpriteContext2D } from '../utils/canvas-factory';
import { BossArchetype } from '../../components/boss-phase.component';
import { ZONE_CONFIG } from '@photon/config/constants/world/zone.config';

/**
 * Enemy Sprite Generator Service
 *
 * Creates lightweight, procedurally generated space creature sprites with faction tinting.
 * Uses canvas paths to draw organic, creature-like forms inspired by deep sea and cosmic horror.
 *
 * DESIGN PHILOSOPHY:
 * - Each enemy is a unique space creature (jellyfish, crab, kraken, etc.)
 * - Creatures inspired by ocean life adapted to the void of space
 * - Faction provides bioluminescent color variations
 * - Sprites are cached per faction+type combo
 * - All rendered at runtime, no image assets needed
 *
 * CREATURE TYPES:
 * - Basic: Space Jellyfish - Drifting, translucent with tentacles
 * - Spitter: Space Pufferfish - Inflates and shoots toxic spines
 * - Tank: Space Turtle - Heavily armored shell creature
 * - Swarm: Space Piranha - Small but vicious, travels in schools
 * - Thug: Space Crab - Aggressive with powerful claws
 * - Sniper: Space Mantis Shrimp - Long-range striker with compound eyes
 * - Boss: Space Kraken - Tentacled horror from the void
 */
@Injectable({ providedIn: 'root' })
export class EnemySpriteGeneratorService implements OnDestroy {
  // LRU Sprite cache with memory management
  private spriteCache = new Map<string, SpriteCanvas>();
  /**
   * LRU tracking: maps cache key → monotonically-increasing access counter.
   * Replaces the old string[] (indexOf+splice = O(n) per hit).
   * Update is O(1); eviction scans once for the minimum.
   */
  private cacheAccessOrder = new Map<string, number>();
  private cacheAccessCounter = 0;
  private readonly MAX_CACHE_SIZE = POOL_CONFIG.MAX_SIZES.ENEMY; // Use centralized config
  private readonly MAX_MEMORY_MB = 50; // Maximum memory usage in MB
  private animationFramePool = new Map<string, SpriteCanvas[]>(); // Pool for animation frames
  private readonly MAX_POOLED_FRAMES = 10; // Per animation type
  private cleanupInterval?: number;

  /**
   * Time-bucket cache for animated sprites (Boss/Kraken, shooting anemone/sniper).
   * Key: `${poolKey}-${bucket}` where bucket = Math.floor(animationTime / 50) * 50.
   * Entries store { frame, bucket } so we can evict those older than 2 buckets.
   * Cleared alongside animationFramePool on theme-switch / level-reset / destroy.
   */
  private animationBucketCache = new Map<string, { frame: SpriteCanvas; bucket: number }>();

  /**
   * Alpha lookup table: faction color hex → Map<alpha-string, rgba-string>.
   * Populated at construction time for the common alphas used in per-frame draw paths.
   * Usage: this.alphaTable.get(color)?.get(alphaKey) ?? this.addAlpha(color, alpha)
   */
  private alphaTable = new Map<string, Map<string, string>>();

  /** Common alpha values pre-cached in the lookup table. */
  private static readonly PREBUILT_ALPHAS = [0.5, 0.6, 0.7, 0.8] as const;

  // Sprite size constants - increased for complex creatures
  private readonly SPRITE_SIZES = {
    [EnemyType.Basic]: 30, // Jellyfish
    [EnemyType.Spitter]: 36, // Anemone
    [EnemyType.Tank]: 40, // Hermit Crab
    [EnemyType.Swarm]: 20, // Minnow
    [EnemyType.Thug]: 44, // Lobster - needs extra space
    [EnemyType.Sniper]: 38, // Anglerfish
    [EnemyType.Boss]: 50, // Kraken
    [EnemyType.Disruptor]: 32, // Electric Eel — medium, arcing body
    [EnemyType.Sentinel]: 42, // Large, bulky shield carrier
  };

  // Generate once at startup or on-demand
  private currentThemeIsDayMode = false;
  private themeSubscription?: { unsubscribe: () => void };

  /** Pre-cached zone RGB values (parsed once, reused at sprite generation time). */
  private zoneRgbCache: Map<number, { r: number; g: number; b: number }>;

  constructor(
    private ngZone: NgZone,
    private themeService: ThemeService
  ) {
    // Clear any existing cache to force regeneration with new colors
    this.spriteCache.clear();
    this.cacheAccessOrder.clear();
    this.cacheAccessCounter = 0;
    this.animationFramePool.clear();
    this.animationBucketCache.clear();

    // Pre-cache zone RGB values once — no per-generation hex parsing
    this.zoneRgbCache = new Map();
    for (const zone of ZONE_CONFIG.ZONES) {
      const hex = zone.themeColor.replace('#', '');
      this.zoneRgbCache.set(zone.id, {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
      });
    }

    // Track current theme
    this.currentThemeIsDayMode = this.themeService.isDayMode;

    // Build alpha lookup table — faction colors × common alphas pre-built once.
    // Filled after theme is known; rebuilt on theme change.
    this.rebuildAlphaTable();

    // Subscribe to theme changes — clear cache so sprites regenerate lazily on next getSprite()
    // Avoids synchronous 35-sprite rebuild that blocks the main thread and causes frame spikes
    this.themeSubscription = this.themeService.isDayMode$.subscribe((isDayMode) => {
      if (isDayMode !== this.currentThemeIsDayMode) {
        this.currentThemeIsDayMode = isDayMode;
        this.spriteCache.clear();
        this.cacheAccessOrder.clear();
        this.cacheAccessCounter = 0;
        this.animationFramePool.clear();
        this.animationBucketCache.clear();
        this.rebuildAlphaTable();
      }
    });

    // Set up periodic cleanup every 60 seconds
    this.ngZone.runOutsideAngular(() => {
      this.cleanupInterval = window.setInterval(() => this.performCacheCleanup(), 60000);
    });
  }

  /**
   * Clean up resources. Defensive against double-teardown and against
   * Karma tests that uninstall a fake clock before TestBed runs
   * ngOnDestroy — clearInterval against a torn-down fake-clock id throws
   * `Cannot read properties of null (reading 'removeFunctionWithId')` and
   * cascades into subsequent test failures. Capture the id, null it out
   * first, then attempt the clear inside a try/catch.
   */
  destroy(): void {
    const intervalId = this.cleanupInterval;
    this.cleanupInterval = undefined;
    if (intervalId !== undefined) {
      try {
        clearInterval(intervalId);
      } catch {
        // Fake clock already uninstalled — nothing to clear, swallow.
      }
    }
    if (this.themeSubscription) {
      this.themeSubscription.unsubscribe();
      this.themeSubscription = undefined;
    }
    this.spriteCache.clear();
    this.animationFramePool.clear();
    this.animationBucketCache.clear();
    this.cacheAccessOrder.clear();
    this.cacheAccessCounter = 0;
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Initialize all sprite combinations
   * Call this during game load to pre-generate sprites
   */
  initializeSprites(): void {
    // ALWAYS regenerate sprites with new vibrant colors
    this.spriteCache.clear();

    // Force fresh generation even if some sprites exist

    const enemyTypes: EnemyType[] = [
      EnemyType.Basic,
      EnemyType.Spitter,
      EnemyType.Tank,
      EnemyType.Swarm,
      EnemyType.Thug,
      EnemyType.Sniper,
      EnemyType.Boss,
      EnemyType.Sentinel,
    ];
    const factionIds = [0, 1, 2, 3, 4]; // 0 = neutral

    for (const type of enemyTypes) {
      for (const factionId of factionIds) {
        this.generateSprite(type, factionId);
      }
    }

    // Sprites initialized
  }

  /**
   * Get or generate a sprite for enemy type + faction + zone combo
   * @param animationTime - For Boss/Kraken tentacle animation
   * @param isShooting - For ranged enemy shooting animations
   * @param zoneId - Zone id for theme color tinting (null = no tint)
   * @param isGuardian - Guardians receive 30% tint; regular enemies 10%
   * @param archetype - Boss archetype for distinct silhouettes (standard/swarm_king/pyroclast)
   */
  getSprite(
    enemyType: EnemyType,
    factionId: number,
    animationTime?: number,
    isShooting?: boolean,
    zoneId?: number | null,
    isGuardian?: boolean,
    archetype?: BossArchetype
  ): SpriteCanvas {
    // Validate inputs
    if (!this.isValidEnemyType(enemyType) || !this.isValidFactionId(factionId)) {
      // Return fallback sprite
      return this.getFallbackSprite();
    }

    // For animated enemies (Boss/Kraken), use pooled frames keyed by archetype
    if (enemyType === EnemyType.Boss && animationTime !== undefined) {
      const resolvedArchetype = archetype ?? 'standard';
      return this.getPooledAnimationFrame(
        `boss-${resolvedArchetype}`,
        () => this.generateAnimatedBossFrame(enemyType, factionId, animationTime, resolvedArchetype),
        animationTime
      );
    }

    // For shooting animations on ranged enemies - use pooled frames
    if (isShooting && (enemyType === EnemyType.Spitter || enemyType === EnemyType.Sniper)) {
      const poolKey = `${enemyType}-shooting`;
      const shootTime = animationTime ?? Date.now();
      return this.getPooledAnimationFrame(
        poolKey,
        () => this.generateShootingFrame(enemyType, factionId, shootTime),
        shootTime
      );
    }

    const resolvedZoneId = zoneId ?? null;
    const key = `${enemyType}-f${factionId}-z${resolvedZoneId ?? 0}${isGuardian ? '-g' : ''}`;

    if (!this.spriteCache.has(key)) {
      this.generateSprite(enemyType, factionId, resolvedZoneId, isGuardian ?? false);
    }

    // Update LRU access order
    this.updateCacheAccess(key);

    return this.spriteCache.get(key) || this.getFallbackSprite();
  }

  /**
   * Generate shooting animation frame for ranged enemies
   */
  private generateShootingFrame(enemyType: EnemyType, factionId: number, time: number): SpriteCanvas {
    const size = this.SPRITE_SIZES[enemyType];
    const canvasMultiplier = 2.2; // Slight extra for shooting effects
    const canvas = createSpriteCanvas(size * canvasMultiplier, size * canvasMultiplier);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const colors = this.getFactionColorsForSprite(factionId);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Draw the base creature with shooting animation
    if (enemyType === EnemyType.Spitter) {
      this.drawShootingAnemone(ctx, centerX, centerY, size, colors, time);
    } else if (enemyType === EnemyType.Sniper) {
      this.drawShootingAnglerfish(ctx, centerX, centerY, size, colors, time);
    }

    ctx.restore();
    return canvas;
  }

  /**
   * Generate animated frame for Boss — dispatches on archetype for distinct silhouettes.
   */
  private generateAnimatedBossFrame(
    enemyType: EnemyType,
    factionId: number,
    time: number,
    archetype: BossArchetype = 'standard'
  ): SpriteCanvas {
    const size = this.SPRITE_SIZES[enemyType];
    const canvas = createSpriteCanvas(size * 3, size * 3);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const colors = this.getFactionColorsForSprite(factionId);

    if (archetype === 'swarm_king') {
      this.drawAnimatedSwarmKing(ctx, centerX, centerY, size, colors, time);
    } else if (archetype === 'pyroclast') {
      this.drawAnimatedPyroclast(ctx, centerX, centerY, size, colors, time);
    } else {
      // 'standard' (or any unrecognised value) → canonical kraken
      this.drawAnimatedKraken(ctx, centerX, centerY, size, colors, time);
    }

    return canvas;
  }

  /**
   * Generate a sprite for specific enemy + faction + zone
   */
  private generateSprite(
    enemyType: EnemyType,
    factionId: number,
    zoneId: number | null = null,
    isGuardian: boolean = false
  ): void {
    const size = this.SPRITE_SIZES[enemyType];
    // Increased canvas size for creatures with appendages
    let canvasMultiplier = 2;
    if (enemyType === EnemyType.Tank) canvasMultiplier = 2.8; // Extra space for hermit crab claws
    if (enemyType === EnemyType.Thug) canvasMultiplier = 3; // Extra space for lobster claws
    if (enemyType === EnemyType.Boss) canvasMultiplier = 3; // Increased for kraken tentacles
    if (enemyType === EnemyType.Sentinel) canvasMultiplier = 2.5; // Extra space for shield arc indicator

    const canvas = createSpriteCanvas(size * canvasMultiplier, size * canvasMultiplier);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Center point adjusted for canvas size
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Get faction colors
    const colors = this.getFactionColorsForSprite(factionId);

    // Clear and setup
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Draw enemy shape based on type
    switch (enemyType) {
      case EnemyType.Basic:
        this.drawBasicEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Spitter:
        this.drawSpitterEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Tank:
        this.drawTankEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Swarm:
        this.drawSwarmEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Thug:
        this.drawThugEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Sniper:
        this.drawSniperEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Boss:
        this.drawBossEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Disruptor:
        this.drawDisruptorEnemy(ctx, centerX, centerY, size, colors);
        break;
      case EnemyType.Sentinel:
        this.drawSentinelEnemy(ctx, centerX, centerY, size, colors);
        break;
    }

    ctx.restore();

    // Apply zone color tint via pixel blending (done once at generation, not per-frame)
    if (zoneId !== null) {
      const zoneRgb = this.zoneRgbCache.get(zoneId);
      if (zoneRgb) {
        const tintAlpha = isGuardian ? 0.3 : 0.1;
        this.applyZoneTint(ctx, canvas.width, canvas.height, zoneRgb, tintAlpha);
      }
    }

    // Cache the sprite with LRU eviction
    const key = `${enemyType}-f${factionId}-z${zoneId ?? 0}${isGuardian ? '-g' : ''}`;
    this.addToCache(key, canvas);
  }

  /**
   * Blend a flat zone color onto all opaque pixels of the sprite canvas.
   * This runs once per cache miss (generation time), never per-frame.
   *
   * Uses pixel iteration to respect existing transparency and avoid composite
   * operation side effects on the cached sprite.
   */
  private applyZoneTint(
    ctx: SpriteContext2D,
    width: number,
    height: number,
    rgb: { r: number; g: number; b: number },
    alpha: number
  ): void {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const inv = 1 - alpha;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        data[i] = Math.round(data[i] * inv + rgb.r * alpha);
        data[i + 1] = Math.round(data[i + 1] * inv + rgb.g * alpha);
        data[i + 2] = Math.round(data[i + 2] * inv + rgb.b * alpha);
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  /**
   * Get faction colors from centralized configuration
   * Now theme-aware - uses darker, higher contrast colors for light mode
   */
  private getFactionColorsForSprite(factionId: number): {
    primary: string;
    secondary: string;
    glow: string;
    outline: string;
  } {
    // Use theme-aware faction colors from game-constants.ts
    return getFactionColors(factionId, this.currentThemeIsDayMode);
  }

  /**
   * BASIC ENEMY - Space Jellyfish
   * Inspired by deep sea jellyfish, floats through space
   */
  private drawBasicEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size * 0.8;

    // Bioluminescent glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const glowOuter0 = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.0 + r * 0.35);
      const haloAlpha = 0.22 - r * 0.08;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.5, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, glowOuter0);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // A domed bell with a scalloped underside reads as a creature at combat scale.
    // The previous full ellipse looked like a generic glowing orb once downsampled.
    const gradient = ctx.createRadialGradient(x, y - radius * 0.3, 0, x, y, radius);
    gradient.addColorStop(0, colors.glow);
    gradient.addColorStop(0.4, colors.primary);
    gradient.addColorStop(0.82, colors.secondary);
    gradient.addColorStop(1, this.addAlpha(colors.primary, 0.8));

    ctx.fillStyle = gradient;
    this.traceJellyfishBell(ctx, x, y, radius);
    ctx.fill();

    // Bell ribs keep the silhouette legible when faction tint collapses tonal detail.
    ctx.strokeStyle = this.lookupAlpha(colors.glow, 0.55);
    ctx.lineWidth = 1;
    for (const side of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.18, y - radius * 0.58);
      ctx.quadraticCurveTo(x + side * radius * 0.4, y - radius * 0.08, x + side * radius * 0.44, y + radius * 0.22);
      ctx.stroke();
    }

    // Five weighted tendrils trail from the scallops; the centre strand is the
    // anchor and the outer two curl away from the direction of travel.
    ctx.strokeStyle = colors.primary;
    const tentacleCount = 5;
    for (let i = 0; i < tentacleCount; i++) {
      const offset = i - 2;
      const tentacleX = x + offset * radius * 0.28;
      const tentacleY = y + radius * (offset % 2 === 0 ? 0.22 : 0.3);
      const curveDrift = offset * radius * 0.08;
      ctx.lineWidth = i === 2 ? 2.2 : 1.4;
      ctx.beginPath();
      ctx.moveTo(tentacleX, tentacleY);
      ctx.quadraticCurveTo(
        tentacleX - curveDrift,
        tentacleY + radius * 0.7,
        tentacleX + curveDrift,
        tentacleY + radius * (i === 2 ? 1.45 : 1.2)
      );
      ctx.stroke();
    }

    // Core eye/nucleus — stepped halo (no shadowBlur)
    const eyeR = radius * 0.2;
    const eyeX = x;
    const eyeY = y - radius * 0.1;
    const eyeGlowOuter = this.lookupAlpha(colors.glow, 0);
    const eyeHalo = ctx.createRadialGradient(eyeX, eyeY, eyeR * 0.4, eyeX, eyeY, eyeR * 1.8);
    eyeHalo.addColorStop(0, this.lookupAlpha(colors.glow, 0.35));
    eyeHalo.addColorStop(1, eyeGlowOuter);
    ctx.fillStyle = eyeHalo;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
    ctx.fill();

    // Outline - stronger for better definition
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1;
    this.traceJellyfishBell(ctx, x, y, radius);
    ctx.stroke();
  }

  private traceJellyfishBell(ctx: SpriteContext2D, x: number, y: number, radius: number): void {
    ctx.beginPath();
    ctx.moveTo(x - radius, y + radius * 0.18);
    ctx.bezierCurveTo(x - radius * 0.92, y - radius * 0.62, x - radius * 0.48, y - radius * 0.82, x, y - radius * 0.82);
    ctx.bezierCurveTo(
      x + radius * 0.48,
      y - radius * 0.82,
      x + radius * 0.92,
      y - radius * 0.62,
      x + radius,
      y + radius * 0.18
    );
    ctx.quadraticCurveTo(x + radius * 0.76, y + radius * 0.4, x + radius * 0.5, y + radius * 0.24);
    ctx.quadraticCurveTo(x + radius * 0.25, y + radius * 0.47, x, y + radius * 0.26);
    ctx.quadraticCurveTo(x - radius * 0.25, y + radius * 0.47, x - radius * 0.5, y + radius * 0.24);
    ctx.quadraticCurveTo(x - radius * 0.76, y + radius * 0.4, x - radius, y + radius * 0.18);
    ctx.closePath();
  }

  /**
   * SPITTER ENEMY - Space Anemone
   * Stationary-looking but shoots projectiles from tentacle tips
   */
  private drawSpitterEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size * 0.9;

    // Glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const spitterGlowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (0.8 + r * 0.35);
      const haloAlpha = 0.2 - r * 0.07;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.5, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, spitterGlowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Central body/mouth - VIBRANT faction colors
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.4);
    gradient.addColorStop(0, colors.glow); // Bright center
    gradient.addColorStop(0.5, colors.primary); // Main faction color
    gradient.addColorStop(1, colors.primary); // Keep it saturated

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.35, 0, Math.PI * 2);
    ctx.fill();

    // Flowing tentacles in a ring
    for (let i = 0; i < 12; i++) {
      const angle = ((Math.PI * 2) / 12) * i;
      const tentacleBase = radius * 0.3;
      const tentacleLength = radius * 0.7;

      // Each tentacle with gradient
      const tentGradient = ctx.createLinearGradient(
        x + Math.cos(angle) * tentacleBase,
        y + Math.sin(angle) * tentacleBase,
        x + Math.cos(angle) * (tentacleBase + tentacleLength),
        y + Math.sin(angle) * (tentacleBase + tentacleLength)
      );
      tentGradient.addColorStop(0, colors.primary); // Full faction color
      tentGradient.addColorStop(0.7, colors.secondary); // Slightly lighter
      tentGradient.addColorStop(1, colors.glow); // Bright tips

      ctx.strokeStyle = tentGradient;
      ctx.lineWidth = size * 0.08;
      ctx.lineCap = 'round';

      ctx.beginPath();
      const startX = x + Math.cos(angle) * tentacleBase;
      const startY = y + Math.sin(angle) * tentacleBase;
      const midX = x + Math.cos(angle + 0.1) * (tentacleBase + tentacleLength * 0.5);
      const midY = y + Math.sin(angle + 0.1) * (tentacleBase + tentacleLength * 0.5);
      const endX = x + Math.cos(angle - 0.1) * (tentacleBase + tentacleLength);
      const endY = y + Math.sin(angle - 0.1) * (tentacleBase + tentacleLength);

      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();

      // Glowing tips (projectile launchers)
      ctx.fillStyle = colors.glow;
      ctx.beginPath();
      ctx.arc(endX, endY, size * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }

    // Central eye/mouth - darker center for contrast (no shadowBlur)
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * TANK ENEMY - Space Hermit Crab
   * Uses debris/asteroids as shell, heavily armored
   */
  private drawTankEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size * 0.75; // Reduced to fit claws in canvas

    // Glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const tankGlowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.05 + r * 0.4);
      const haloAlpha = 0.2 - r * 0.07;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.5, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, tankGlowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Large rocky shell - VIBRANT faction colored
    const shellGradient = ctx.createRadialGradient(x, y - radius * 0.1, 0, x, y - radius * 0.1, radius);
    shellGradient.addColorStop(0, colors.glow); // Bright center
    shellGradient.addColorStop(0.4, colors.primary); // Main faction color
    shellGradient.addColorStop(0.8, colors.secondary); // Still vibrant
    shellGradient.addColorStop(1, colors.primary); // Keep edges colored

    ctx.fillStyle = shellGradient;
    ctx.beginPath();
    // More defined rocky shape with visible chunks
    const points = 12;
    for (let i = 0; i < points; i++) {
      const angle = ((Math.PI * 2) / points) * i;
      const variance = 0.8 + Math.sin(i * 2.3) * 0.2 + Math.cos(i * 3.7) * 0.1;
      const px = x + Math.cos(angle) * radius * variance;
      const py = y - radius * 0.1 + Math.sin(angle) * radius * 0.85 * variance;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // Rocky texture on shell - stronger definition
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Shell details - crystal formations (no shadowBlur)
    ctx.fillStyle = colors.glow;
    for (let i = 0; i < 5; i++) {
      const crystalAngle = ((Math.PI * 2) / 5) * i;
      const crystalX = x + Math.cos(crystalAngle) * radius * 0.5;
      const crystalY = y - radius * 0.1 + Math.sin(crystalAngle) * radius * 0.4;
      ctx.beginPath();
      ctx.moveTo(crystalX, crystalY);
      ctx.lineTo(crystalX - 3, crystalY - 6);
      ctx.lineTo(crystalX, crystalY - 8);
      ctx.lineTo(crystalX + 3, crystalY - 6);
      ctx.closePath();
      ctx.fill();
    }

    // A bright shell spiral distinguishes the Hermit from the round bruisers at
    // a glance and gives its charge a stable visual centre.
    ctx.strokeStyle = this.lookupAlpha(colors.glow, 0.7);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let step = 0; step <= 28; step++) {
      const angle = step * 0.42;
      const spiralRadius = radius * (0.04 + step * 0.017);
      const spiralX = x + Math.cos(angle) * spiralRadius;
      const spiralY = y - radius * 0.12 + Math.sin(angle) * spiralRadius * 0.82;
      if (step === 0) ctx.moveTo(spiralX, spiralY);
      else ctx.lineTo(spiralX, spiralY);
    }
    ctx.stroke();

    // Crab body - FULL SATURATION
    const bodyGradient = ctx.createRadialGradient(x, y + radius * 0.4, 0, x, y + radius * 0.4, radius * 0.5);
    bodyGradient.addColorStop(0, colors.secondary); // Bright
    bodyGradient.addColorStop(1, colors.primary); // Main faction color

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.ellipse(x, y + radius * 0.4, radius * 0.45, radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Large defensive claws (scaled to fit)
    for (const side of [-1, 1]) {
      // Upper arm segment
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = radius * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.3, y + radius * 0.4);
      const elbowX = x + side * radius * 0.55;
      const elbowY = y + radius * 0.3;
      ctx.lineTo(elbowX, elbowY);
      ctx.stroke();

      // Lower arm segment
      ctx.beginPath();
      ctx.moveTo(elbowX, elbowY);
      ctx.lineTo(x + side * radius * 0.7, y + radius * 0.1);
      ctx.stroke();

      // Detailed claw
      const clawX = x + side * radius * 0.7;
      const clawY = y + radius * 0.1;

      // Claw base
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      ctx.arc(clawX, clawY, radius * 0.18, 0, Math.PI * 2);
      ctx.fill();

      // Claw pincers (smaller)
      ctx.beginPath();
      ctx.moveTo(clawX, clawY);
      ctx.lineTo(clawX + side * radius * 0.25, clawY - radius * 0.2);
      ctx.lineTo(clawX + side * radius * 0.3, clawY - radius * 0.12);
      ctx.lineTo(clawX + side * radius * 0.28, clawY);
      ctx.lineTo(clawX + side * radius * 0.3, clawY + radius * 0.12);
      ctx.lineTo(clawX + side * radius * 0.25, clawY + radius * 0.2);
      ctx.closePath();
      ctx.fill();

      // Claw detail
      ctx.strokeStyle = colors.outline;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Eyes on stalks (more prominent)
    for (const side of [-1, 1]) {
      // Eye stalk
      ctx.strokeStyle = colors.secondary;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.2, y + radius * 0.3);
      ctx.quadraticCurveTo(x + side * radius * 0.25, y + radius * 0.1, x + side * radius * 0.3, y - radius * 0.1);
      ctx.stroke();

      // Eye ball
      ctx.fillStyle = colors.secondary;
      ctx.beginPath();
      ctx.arc(x + side * radius * 0.3, y - radius * 0.1, radius * 0.12, 0, Math.PI * 2);
      ctx.fill();

      // Eye iris
      ctx.fillStyle = colors.glow;
      ctx.beginPath();
      ctx.arc(x + side * radius * 0.3, y - radius * 0.1, radius * 0.08, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      ctx.fillStyle = colors.outline;
      ctx.beginPath();
      ctx.arc(x + side * radius * 0.3, y - radius * 0.1, radius * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }

    // Small walking legs
    ctx.strokeStyle = this.addAlpha(colors.secondary, 0.7);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + side * radius * 0.3, y + radius * 0.5);
        ctx.lineTo(x + side * radius * (0.5 + i * 0.1), y + radius * 0.7);
        ctx.stroke();
      }
    }
  }

  /**
   * SWARM ENEMY - Space Minnow/Neon Tetra
   * Small glowing fish, travels in schools
   */
  private drawSwarmEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size * 0.7;

    // Glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const swarmGlowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.1 + r * 0.4);
      const haloAlpha = 0.22 - r * 0.08;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.5, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, swarmGlowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sleek body
    const bodyGradient = ctx.createLinearGradient(x - radius, y, x + radius, y);
    bodyGradient.addColorStop(0, colors.secondary);
    bodyGradient.addColorStop(0.5, colors.primary);
    bodyGradient.addColorStop(1, colors.glow);

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Neon stripe — tripled lineWidth (was 2) + full-alpha glow color, no shadowBlur
    ctx.strokeStyle = colors.glow;
    ctx.lineWidth = Math.max(4, radius * 0.45); // ~6 at default swarm radius
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.7, y);
    ctx.lineTo(x + radius * 0.5, y);
    ctx.stroke();

    // Tail fin (V-shaped)
    ctx.fillStyle = this.addAlpha(colors.primary, 0.7);
    ctx.beginPath();
    ctx.moveTo(x + radius * 0.8, y);
    ctx.lineTo(x + radius * 1.2, y - radius * 0.3);
    ctx.lineTo(x + radius * 1.1, y);
    ctx.lineTo(x + radius * 1.2, y + radius * 0.3);
    ctx.closePath();
    ctx.fill();

    // Small fins
    ctx.fillStyle = this.addAlpha(colors.secondary, 0.6);
    // Top fin
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.2, y - radius * 0.3);
    ctx.lineTo(x, y - radius * 0.5);
    ctx.lineTo(x + radius * 0.2, y - radius * 0.3);
    ctx.closePath();
    ctx.fill();

    // Bottom fin
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.2, y + radius * 0.3);
    ctx.lineTo(x, y + radius * 0.5);
    ctx.lineTo(x + radius * 0.2, y + radius * 0.3);
    ctx.closePath();
    ctx.fill();

    // Eye
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(x - radius * 0.5, y - radius * 0.05, radius * 0.15, 0, Math.PI * 2);
    ctx.fill();

    // Pupil
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.arc(x - radius * 0.5, y - radius * 0.05, radius * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * THUG ENEMY - Space Lobster
   * Aggressive with huge crusher claws
   */
  private drawThugEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size * 0.65; // Further reduced to ensure claws fit

    // Glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const thugGlowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.0 + r * 0.35);
      const haloAlpha = 0.2 - r * 0.07;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.5, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, thugGlowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Elongated armored body
    const bodyGradient = ctx.createLinearGradient(x, y - radius, x, y + radius);
    bodyGradient.addColorStop(0, colors.primary);
    bodyGradient.addColorStop(0.5, colors.secondary);
    bodyGradient.addColorStop(1, colors.primary);

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.5, radius, 0, 0, Math.PI * 2);
    ctx.fill();

    // Armor segments
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.5, y + i * radius * 0.25);
      ctx.lineTo(x + radius * 0.5, y + i * radius * 0.25);
      ctx.stroke();
    }

    // Tail fan
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    ctx.moveTo(x, y + radius);
    ctx.lineTo(x - radius * 0.4, y + radius * 1.3);
    ctx.lineTo(x, y + radius * 1.1);
    ctx.lineTo(x + radius * 0.4, y + radius * 1.3);
    ctx.closePath();
    ctx.fill();

    // Massive crusher claws (adjusted to fit canvas)
    for (const side of [-1, 1]) {
      // Upper arm
      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = radius * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.4, y - radius * 0.3);
      ctx.lineTo(x + side * radius * 0.7, y - radius * 0.45);
      ctx.stroke();

      // Lower arm
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.7, y - radius * 0.45);
      ctx.lineTo(x + side * radius * 0.95, y - radius * 0.6);
      ctx.stroke();

      // Crusher claw (asymmetric for realism)
      const clawSize = side === -1 ? radius * 0.35 : radius * 0.3;
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      const clawX = x + side * radius * 0.95;
      const clawY = y - radius * 0.6;

      // Main claw body
      ctx.arc(clawX, clawY, clawSize, 0, Math.PI * 2);
      ctx.fill();

      // Claw fingers (scaled down)
      ctx.beginPath();
      ctx.moveTo(clawX, clawY);
      ctx.lineTo(clawX + side * clawSize * 0.7, clawY - clawSize * 0.5);
      ctx.lineTo(clawX + side * clawSize * 1.0, clawY);
      ctx.lineTo(clawX + side * clawSize * 0.7, clawY + clawSize * 0.5);
      ctx.closePath();
      ctx.fill();
    }

    // Antennae (scaled to fit)
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = 1.5;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.2, y - radius * 0.9);
      ctx.quadraticCurveTo(x + side * radius * 0.35, y - radius * 1.05, x + side * radius * 0.5, y - radius * 1.1);
      ctx.stroke();
    }

    // Eyes
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.arc(x - radius * 0.2, y - radius * 0.8, radius * 0.1, 0, Math.PI * 2);
    ctx.arc(x + radius * 0.2, y - radius * 0.8, radius * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Walking legs (small)
    ctx.strokeStyle = this.addAlpha(colors.secondary, 0.6);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x + side * radius * 0.4, y - radius * 0.3 + i * radius * 0.3);
        ctx.lineTo(x + side * radius * 0.6, y - radius * 0.2 + i * radius * 0.3);
        ctx.stroke();
      }
    }
  }

  /**
   * SNIPER ENEMY - Space Anglerfish
   * Lures prey with glowing bait, then strikes from distance
   */
  private drawSniperEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size * 0.8;

    // Glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const sniperGlowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.0 + r * 0.35);
      const haloAlpha = 0.18 - r * 0.06;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.5, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, sniperGlowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Large head/mouth
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, colors.outline);
    gradient.addColorStop(0.5, colors.secondary);
    gradient.addColorStop(1, this.addAlpha(colors.secondary, 0.7));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Huge mouth with teeth
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.arc(x, y + radius * 0.1, radius * 0.6, 0, Math.PI);
    ctx.fill();

    // Sharp teeth
    ctx.fillStyle = colors.glow;
    const teethCount = 8;
    for (let i = 0; i < teethCount; i++) {
      const angle = (Math.PI / teethCount) * i;
      const toothX = x + Math.cos(angle) * radius * 0.55;
      const toothY = y + radius * 0.1 + Math.sin(angle) * radius * 0.55;

      ctx.beginPath();
      ctx.moveTo(toothX, toothY);
      ctx.lineTo(toothX - Math.cos(angle) * radius * 0.1, toothY - Math.sin(angle) * radius * 0.1);
      ctx.lineTo(toothX + Math.sin(angle) * radius * 0.05, toothY - Math.cos(angle) * radius * 0.05);
      ctx.closePath();
      ctx.fill();
    }

    // Lure stalk
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 0.8);
    ctx.quadraticCurveTo(x - radius * 0.3, y - radius * 1.2, x, y - radius * 1.5);
    ctx.stroke();

    // Glowing lure (the sniper's "scope")
    const lureGlow = ctx.createRadialGradient(x, y - radius * 1.5, 0, x, y - radius * 1.5, radius * 0.3);
    lureGlow.addColorStop(0, colors.glow);
    lureGlow.addColorStop(0.5, this.addAlpha(colors.glow, 0.5));
    lureGlow.addColorStop(1, 'transparent');

    ctx.fillStyle = lureGlow;
    ctx.beginPath();
    ctx.arc(x, y - radius * 1.5, radius * 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Bright center of lure
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y - radius * 1.5, radius * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Small beady eyes
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.arc(x - radius * 0.4, y - radius * 0.3, radius * 0.08, 0, Math.PI * 2);
    ctx.arc(x + radius * 0.4, y - radius * 0.3, radius * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // Tail
    ctx.fillStyle = this.addAlpha(colors.secondary, 0.7);
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.3, y + radius * 0.8);
    ctx.lineTo(x, y + radius * 1.2);
    ctx.lineTo(x + radius * 0.3, y + radius * 0.8);
    ctx.closePath();
    ctx.fill();

    // Side fins
    ctx.fillStyle = this.addAlpha(colors.primary, 0.5);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + side * radius * 0.8, y);
      ctx.quadraticCurveTo(x + side * radius * 1.1, y + radius * 0.2, x + side * radius * 0.9, y + radius * 0.4);
      ctx.lineTo(x + side * radius * 0.7, y + radius * 0.2);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * DISRUPTOR ENEMY - Space Electric Eel
   * Elongated, crackling with purple arcs.
   * NO shadowBlur, NO per-frame gradients — solid fills and strokes only.
   */
  private drawDisruptorEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const halfW = size * 0.32;
    const halfH = size * 0.7;

    // Body — elongated oval
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    ctx.ellipse(x, y, halfW, halfH, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body outline
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, halfW, halfH, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Central stripe — gives the eel its distinctive banding
    ctx.strokeStyle = colors.secondary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - halfH * 0.7);
    ctx.lineTo(x, y + halfH * 0.7);
    ctx.stroke();

    // Crackling arc 1 — top-left zig-zag
    ctx.strokeStyle = colors.glow;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - halfW * 0.5, y - halfH * 0.35);
    ctx.lineTo(x - halfW * 1.1, y - halfH * 0.15);
    ctx.lineTo(x - halfW * 0.8, y);
    ctx.lineTo(x - halfW * 1.2, y + halfH * 0.15);
    ctx.stroke();

    // Crackling arc 2 — top-right zig-zag
    ctx.beginPath();
    ctx.moveTo(x + halfW * 0.5, y - halfH * 0.25);
    ctx.lineTo(x + halfW * 1.15, y - halfH * 0.05);
    ctx.lineTo(x + halfW * 0.85, y + halfH * 0.1);
    ctx.lineTo(x + halfW * 1.1, y + halfH * 0.3);
    ctx.stroke();

    // Eyes — two small bright circles
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.arc(x - halfW * 0.4, y - halfH * 0.45, size * 0.07, 0, Math.PI * 2);
    ctx.arc(x + halfW * 0.4, y - halfH * 0.45, size * 0.07, 0, Math.PI * 2);
    ctx.fill();

    // Tail fin
    ctx.fillStyle = this.addAlpha(colors.secondary, 0.7);
    ctx.beginPath();
    ctx.moveTo(x - halfW * 0.5, y + halfH * 0.75);
    ctx.lineTo(x, y + halfH * 1.05);
    ctx.lineTo(x + halfW * 0.5, y + halfH * 0.75);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * SENTINEL ENEMY - Heavy Space Armadillo / Shielded Bruiser
   * Bulky, angular body with a thick frontal carapace suggesting shield coverage.
   * NO shadowBlur, NO per-frame gradients — solid fills and strokes only.
   */
  private drawSentinelEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const halfW = size * 0.42;
    const halfH = size * 0.38;

    // Main body — wide, heavy hexagonal torso
    ctx.fillStyle = colors.primary;
    ctx.beginPath();
    // Flattened hexagon: wider than tall for a "shield carrier" silhouette
    ctx.moveTo(x, y - halfH);
    ctx.lineTo(x + halfW * 0.85, y - halfH * 0.5);
    ctx.lineTo(x + halfW, y + halfH * 0.3);
    ctx.lineTo(x + halfW * 0.5, y + halfH);
    ctx.lineTo(x - halfW * 0.5, y + halfH);
    ctx.lineTo(x - halfW, y + halfH * 0.3);
    ctx.lineTo(x - halfW * 0.85, y - halfH * 0.5);
    ctx.closePath();
    ctx.fill();

    // Body outline
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - halfH);
    ctx.lineTo(x + halfW * 0.85, y - halfH * 0.5);
    ctx.lineTo(x + halfW, y + halfH * 0.3);
    ctx.lineTo(x + halfW * 0.5, y + halfH);
    ctx.lineTo(x - halfW * 0.5, y + halfH);
    ctx.lineTo(x - halfW, y + halfH * 0.3);
    ctx.lineTo(x - halfW * 0.85, y - halfH * 0.5);
    ctx.closePath();
    ctx.stroke();

    // Frontal shield plate — thick top panel indicating shield direction
    ctx.fillStyle = colors.secondary;
    ctx.beginPath();
    ctx.moveTo(x - halfW * 0.5, y - halfH * 0.15);
    ctx.lineTo(x + halfW * 0.5, y - halfH * 0.15);
    ctx.lineTo(x + halfW * 0.5, y - halfH * 0.7);
    ctx.lineTo(x + halfW * 0.25, y - halfH);
    ctx.lineTo(x - halfW * 0.25, y - halfH);
    ctx.lineTo(x - halfW * 0.5, y - halfH * 0.7);
    ctx.closePath();
    ctx.fill();

    // Shield plate edge line — distinct visual cue for the shielded front
    ctx.strokeStyle = colors.glow;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - halfW * 0.5, y - halfH * 0.7);
    ctx.lineTo(x - halfW * 0.25, y - halfH);
    ctx.lineTo(x + halfW * 0.25, y - halfH);
    ctx.lineTo(x + halfW * 0.5, y - halfH * 0.7);
    ctx.stroke();

    // Center armor seam — vertical groove
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - halfH * 0.15);
    ctx.lineTo(x, y + halfH * 0.9);
    ctx.stroke();

    // Shoulder spikes (two) — angular threat indicators
    ctx.fillStyle = colors.secondary;
    // Left shoulder spike
    ctx.beginPath();
    ctx.moveTo(x - halfW, y + halfH * 0.3);
    ctx.lineTo(x - halfW * 1.35, y - halfH * 0.1);
    ctx.lineTo(x - halfW * 0.85, y - halfH * 0.5);
    ctx.closePath();
    ctx.fill();
    // Right shoulder spike
    ctx.beginPath();
    ctx.moveTo(x + halfW, y + halfH * 0.3);
    ctx.lineTo(x + halfW * 1.35, y - halfH * 0.1);
    ctx.lineTo(x + halfW * 0.85, y - halfH * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * BOSS ENEMY - Space Kraken/Octopus
   * Massive tentacled horror from the void
   */
  private drawBossEnemy(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>
  ): void {
    const radius = size;

    // Glow halo — radial gradient, NO shadowBlur (GPU-expensive).
    const bossGlowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.05 + r * 0.35);
      const haloAlpha = 0.22 - r * 0.08;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.6, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, bossGlowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Main body/mantle
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.7);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(0.5, colors.secondary);
    gradient.addColorStop(1, this.addAlpha(colors.secondary, 0.8));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.7, radius * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eight tentacles
    for (let i = 0; i < 8; i++) {
      const angle = ((Math.PI * 2) / 8) * i;
      const tentacleStartX = x + Math.cos(angle) * radius * 0.5;
      const tentacleStartY = y + Math.sin(angle) * radius * 0.5;

      // Each tentacle with suckers
      ctx.strokeStyle = colors.secondary;
      ctx.lineWidth = size * 0.08 * (1 - i * 0.02); // Varying thickness
      ctx.beginPath();
      ctx.moveTo(tentacleStartX, tentacleStartY);

      // Curvy tentacle path
      const cp1x = tentacleStartX + Math.cos(angle + 0.3) * radius * 0.6;
      const cp1y = tentacleStartY + Math.sin(angle + 0.3) * radius * 0.6;
      const cp2x = tentacleStartX + Math.cos(angle - 0.3) * radius * 0.9;
      const cp2y = tentacleStartY + Math.sin(angle - 0.3) * radius * 0.9;
      const endX = x + Math.cos(angle) * radius * 1.2;
      const endY = y + Math.sin(angle) * radius * 1.2;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
      ctx.stroke();

      // Suckers along tentacle
      ctx.fillStyle = this.addAlpha(colors.glow, 0.6);
      for (let j = 0; j < 4; j++) {
        const t = (j + 1) / 5;
        const suckerX = this.getBezierPoint(tentacleStartX, cp1x, cp2x, endX, t);
        const suckerY = this.getBezierPoint(tentacleStartY, cp1y, cp2y, endY, t);
        ctx.beginPath();
        ctx.arc(suckerX, suckerY, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Beak/mouth in center
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 0.15);
    ctx.lineTo(x - radius * 0.1, y + radius * 0.1);
    ctx.lineTo(x, y + radius * 0.05);
    ctx.lineTo(x + radius * 0.1, y + radius * 0.1);
    ctx.closePath();
    ctx.fill();

    // Large menacing eyes
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.25, y - radius * 0.1, radius * 0.15, radius * 0.2, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x + radius * 0.25, y - radius * 0.1, radius * 0.15, radius * 0.2, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Pupils
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.25, y - radius * 0.1, radius * 0.05, radius * 0.12, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x + radius * 0.25, y - radius * 0.1, radius * 0.05, radius * 0.12, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Utility: Add alpha to a color
   */
  private addAlpha(color: string, alpha: number): string {
    // If already rgba, replace alpha
    if (color.startsWith('rgba')) {
      return color.replace(/[\d.]+\)$/, `${alpha})`);
    }
    // Convert hex to rgba
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    // Assume rgb, add alpha
    return color.replace('rgb', 'rgba').replace(')', `, ${alpha})`);
  }

  /**
   * Utility: Get point on bezier curve
   */
  private getBezierPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    return uuu * p0 + 3 * uu * t * p1 + 3 * u * tt * p2 + ttt * p3;
  }

  /**
   * Draw animated Kraken with moving tentacles
   */
  private drawAnimatedKraken(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>,
    time: number
  ): void {
    const radius = size;

    // Outer glow halo via radial gradient — NO shadowBlur (GPU-expensive).
    // Two stepped concentric arc-fills (same pattern as drawAnimatedSwarmKing / drawAnimatedPyroclast).
    const glowOuter = this.lookupAlpha(colors.glow, 0);
    for (let r = 0; r < 2; r++) {
      const haloRadius = radius * (1.05 + r * 0.25);
      const haloAlpha = 0.18 - r * 0.06;
      const haloGrad = ctx.createRadialGradient(x, y, haloRadius * 0.6, x, y, haloRadius);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, haloAlpha));
      haloGrad.addColorStop(1, glowOuter);
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Main body/mantle (pulsing)
    const bodyPulse = 1 + Math.sin(time * 0.001) * 0.05;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.7 * bodyPulse);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(0.5, colors.secondary);
    gradient.addColorStop(1, this.lookupAlpha(colors.secondary, 0.8));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 0.7 * bodyPulse, radius * 0.8 * bodyPulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hoist loop-invariant sucker color — addAlpha / string work once, not 8× per frame
    const suckerFill = this.lookupAlpha(colors.glow, 0.6);

    // Eight animated tentacles
    for (let i = 0; i < 8; i++) {
      const angle = ((Math.PI * 2) / 8) * i;
      const tentacleStartX = x + Math.cos(angle) * radius * 0.5;
      const tentacleStartY = y + Math.sin(angle) * radius * 0.5;

      // Animate tentacle movement
      const waveOffset = Math.sin(time * 0.002 + i * 0.8) * 0.3;
      const curlAmount = Math.sin(time * 0.003 + i * 1.2) * 0.2;

      // Each tentacle with animated curves
      ctx.strokeStyle = colors.secondary;
      ctx.lineWidth = size * 0.08 * (1 - i * 0.02);
      ctx.beginPath();
      ctx.moveTo(tentacleStartX, tentacleStartY);

      // Animated control points for smooth undulation
      const cp1x = tentacleStartX + Math.cos(angle + waveOffset) * radius * 0.6;
      const cp1y = tentacleStartY + Math.sin(angle + waveOffset) * radius * 0.6;
      const cp2x = tentacleStartX + Math.cos(angle - curlAmount) * radius * 0.9;
      const cp2y = tentacleStartY + Math.sin(angle - curlAmount) * radius * 0.9;
      const endX = x + Math.cos(angle + waveOffset * 0.5) * radius * 1.2;
      const endY = y + Math.sin(angle + waveOffset * 0.5) * radius * 1.2;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
      ctx.stroke();

      // Animated suckers along tentacle (pre-hoisted color — no per-iteration string build)
      ctx.fillStyle = suckerFill;
      for (let j = 0; j < 4; j++) {
        const t = (j + 1) / 5;
        const suckerX = this.getBezierPoint(tentacleStartX, cp1x, cp2x, endX, t);
        const suckerY = this.getBezierPoint(tentacleStartY, cp1y, cp2y, endY, t);
        const suckerSize = 2 + Math.sin(time * 0.005 + j * 0.5) * 0.5;
        ctx.beginPath();
        ctx.arc(suckerX, suckerY, suckerSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Beak/mouth
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 0.15);
    ctx.lineTo(x - radius * 0.1, y + radius * 0.1);
    ctx.lineTo(x, y + radius * 0.05);
    ctx.lineTo(x + radius * 0.1, y + radius * 0.1);
    ctx.closePath();
    ctx.fill();

    // Pulsing eyes
    const eyePulse = 0.9 + Math.sin(time * 0.004) * 0.1;
    ctx.fillStyle = colors.glow;
    ctx.beginPath();
    ctx.ellipse(
      x - radius * 0.25,
      y - radius * 0.1,
      radius * 0.15 * eyePulse,
      radius * 0.2 * eyePulse,
      -0.2,
      0,
      Math.PI * 2
    );
    ctx.ellipse(
      x + radius * 0.25,
      y - radius * 0.1,
      radius * 0.15 * eyePulse,
      radius * 0.2 * eyePulse,
      0.2,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Pupils (looking around)
    const lookAngle = time * 0.001;
    const pupilOffset = Math.sin(lookAngle) * radius * 0.02;
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.25 + pupilOffset, y - radius * 0.1, radius * 0.05, radius * 0.12, -0.2, 0, Math.PI * 2);
    ctx.ellipse(x + radius * 0.25 - pupilOffset, y - radius * 0.1, radius * 0.05, radius * 0.12, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw animated Swarm King — a bulbous brood-queen ringed by pulsing egg-sac nodes.
   * Silhouette reads as a "queen surrounded by spawn" — compact central mass, no long
   * tentacles, several orbiting nodes that slowly rotate and pulse.
   *
   * Performance rules: NO shadowBlur — glow via radial gradients only.
   *                    NO string manipulation inside loops.
   */
  private drawAnimatedSwarmKing(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>,
    time: number
  ): void {
    const radius = size;

    // --- Central mass (large, bulbous) ---
    const bodyPulse = 1 + Math.sin(time * 0.0015) * 0.06;
    const bodyGradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.85 * bodyPulse);
    bodyGradient.addColorStop(0, colors.glow);
    bodyGradient.addColorStop(0.35, colors.primary);
    bodyGradient.addColorStop(0.7, colors.secondary);
    bodyGradient.addColorStop(1, this.addAlpha(colors.secondary, 0.6));

    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    // Slightly squashed sphere — queen is wide and low
    ctx.ellipse(x, y, radius * 0.85 * bodyPulse, radius * 0.72 * bodyPulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // --- Stubby limb nubs (3 pairs, shorter than kraken tentacles) ---
    const limbColor = colors.secondary;
    ctx.strokeStyle = limbColor;
    ctx.lineWidth = size * 0.1;
    const limbCount = 6;
    for (let i = 0; i < limbCount; i++) {
      const baseAngle = ((Math.PI * 2) / limbCount) * i;
      const wave = Math.sin(time * 0.002 + i * 1.1) * 0.15;
      const startX = x + Math.cos(baseAngle) * radius * 0.55;
      const startY = y + Math.sin(baseAngle) * radius * 0.55;
      const endX = x + Math.cos(baseAngle + wave) * radius * 0.85;
      const endY = y + Math.sin(baseAngle + wave) * radius * 0.85;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.quadraticCurveTo(
        x + Math.cos(baseAngle + wave * 0.5) * radius * 0.7,
        y + Math.sin(baseAngle + wave * 0.5) * radius * 0.7,
        endX,
        endY
      );
      ctx.stroke();
    }

    // --- Orbiting egg-sac nodes (6 nodes rotating around body) ---
    const orbitRadius = radius * 1.25;
    const nodeCount = 6;
    const orbitSpeed = time * 0.0006;
    // Precompute ALL loop-invariant color strings outside the loop — addAlpha
    // does string work, and these values never change across iterations.
    const nodeGlowAlpha = 0.85;
    const nodeCoreAlpha = 0.6;
    const nodeFillOuter = this.addAlpha(colors.glow, nodeGlowAlpha);
    const nodeFillInner = this.addAlpha(colors.primary, nodeCoreAlpha);
    const nodeFillEdge = this.addAlpha(colors.secondary, 0); // transparent outer stop
    const tetherStroke = this.addAlpha(colors.glow, 0.35);

    for (let i = 0; i < nodeCount; i++) {
      const angle = orbitSpeed + ((Math.PI * 2) / nodeCount) * i;
      const nodePulse = 0.8 + Math.sin(time * 0.003 + i * 1.4) * 0.2;
      const nodeR = size * 0.18 * nodePulse;
      const nx = x + Math.cos(angle) * orbitRadius;
      const ny = y + Math.sin(angle) * orbitRadius;

      // Glow halo for node (radial gradient, no shadowBlur)
      const nodeGrad = ctx.createRadialGradient(nx, ny, 0, nx, ny, nodeR * 2);
      nodeGrad.addColorStop(0, nodeFillOuter);
      nodeGrad.addColorStop(0.5, nodeFillInner);
      nodeGrad.addColorStop(1, nodeFillEdge);

      ctx.fillStyle = nodeGrad;
      ctx.beginPath();
      ctx.arc(nx, ny, nodeR * 2, 0, Math.PI * 2);
      ctx.fill();

      // Solid node core
      ctx.fillStyle = colors.primary;
      ctx.beginPath();
      ctx.arc(nx, ny, nodeR, 0, Math.PI * 2);
      ctx.fill();

      // Tether line from body edge to node
      ctx.strokeStyle = tetherStroke;
      ctx.lineWidth = 1.5;
      const bodyEdgeX = x + Math.cos(angle) * radius * 0.82;
      const bodyEdgeY = y + Math.sin(angle) * radius * 0.82;
      ctx.beginPath();
      ctx.moveTo(bodyEdgeX, bodyEdgeY);
      ctx.lineTo(nx, ny);
      ctx.stroke();
    }

    // --- Central eye cluster (queen eye, compound multi-lens look) ---
    const eyePulse = 0.9 + Math.sin(time * 0.004) * 0.1;
    // Three compound lenses in a triangle arrangement
    const eyeOffsets = [
      { dx: 0, dy: -radius * 0.18 },
      { dx: -radius * 0.16, dy: radius * 0.1 },
      { dx: radius * 0.16, dy: radius * 0.1 },
    ];
    for (const off of eyeOffsets) {
      ctx.fillStyle = colors.glow;
      ctx.beginPath();
      ctx.ellipse(x + off.dx, y + off.dy, radius * 0.12 * eyePulse, radius * 0.14 * eyePulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colors.outline;
      ctx.beginPath();
      ctx.arc(x + off.dx, y + off.dy, radius * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Draw animated Pyroclast — a spiked, molten-core bruiser.
   * Silhouette is an angular polygon with sharp radiating spikes, crossed by
   * glowing cracks and ringed by expanding ember pulses. Reads as armored and
   * volcanic — nothing soft or tentacled.
   *
   * Performance rules: NO shadowBlur — glow via radial gradients only.
   *                    NO string manipulation inside loops.
   */
  private drawAnimatedPyroclast(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>,
    time: number
  ): void {
    const radius = size;

    // --- Outer ember pulse rings (2 concentric rings expanding over time) ---
    // Each ring's radius is driven by fractional time to create a looping expand effect.
    const ringBaseAlpha = 0.3;
    const ringEdge = this.addAlpha(colors.glow, 0); // loop-invariant transparent outer stop
    for (let r = 0; r < 2; r++) {
      const phase = (time * 0.0008 + r * 0.5) % 1.0;
      const ringRadius = radius * 0.8 + phase * radius * 0.9;
      const ringAlpha = ringBaseAlpha * (1 - phase); // varies per ring — must stay in-loop
      const ringGrad = ctx.createRadialGradient(x, y, ringRadius * 0.7, x, y, ringRadius);
      ringGrad.addColorStop(0, this.addAlpha(colors.glow, ringAlpha));
      ringGrad.addColorStop(1, ringEdge);
      ctx.fillStyle = ringGrad;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Angular spiked body (jagged polygon, 7 spikes) ---
    const spikeCount = 7;
    const bodyPulse = 1 + Math.sin(time * 0.002) * 0.04;
    const innerR = radius * 0.5 * bodyPulse;
    const outerR = radius * 0.95 * bodyPulse;

    // Body gradient — dark core shading to molten edges
    const bodyGrad = ctx.createRadialGradient(x, y, 0, x, y, outerR);
    bodyGrad.addColorStop(0, colors.secondary);
    bodyGrad.addColorStop(0.45, colors.primary);
    bodyGrad.addColorStop(0.8, colors.glow);
    bodyGrad.addColorStop(1, this.addAlpha(colors.glow, 0.5));

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    for (let i = 0; i < spikeCount * 2; i++) {
      const angle = ((Math.PI * 2) / (spikeCount * 2)) * i - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();

    // Body outline — sharp, angular stroke
    ctx.strokeStyle = colors.outline;
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    for (let i = 0; i < spikeCount * 2; i++) {
      const angle = ((Math.PI * 2) / (spikeCount * 2)) * i - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.stroke();

    // --- Crack lines radiating from center (3 cracks, glowing glow color) ---
    // Precompute crack color outside inner logic
    const crackColor = this.addAlpha(colors.glow, 0.9);
    const crackCount = 3;
    for (let c = 0; c < crackCount; c++) {
      const crackAngle = ((Math.PI * 2) / crackCount) * c + time * 0.0003;
      const crackLen = innerR * (0.7 + Math.sin(time * 0.004 + c * 2.1) * 0.3);
      const midOffsetX = Math.cos(crackAngle + 0.3) * crackLen * 0.4;
      const midOffsetY = Math.sin(crackAngle + 0.3) * crackLen * 0.4;
      ctx.strokeStyle = crackColor;
      ctx.lineWidth = size * 0.04;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + midOffsetX,
        y + midOffsetY,
        x + Math.cos(crackAngle) * crackLen,
        y + Math.sin(crackAngle) * crackLen
      );
      ctx.stroke();
    }

    // --- Central molten eye (single, large, menacing) ---
    const eyeR = radius * 0.22;
    const eyePulse = 0.85 + Math.sin(time * 0.005) * 0.15;
    const eyeGrad = ctx.createRadialGradient(x, y, 0, x, y, eyeR * eyePulse);
    eyeGrad.addColorStop(0, '#ffffff');
    eyeGrad.addColorStop(0.3, colors.glow);
    eyeGrad.addColorStop(0.7, colors.primary);
    eyeGrad.addColorStop(1, this.addAlpha(colors.secondary, 0.8));

    ctx.fillStyle = eyeGrad;
    ctx.beginPath();
    ctx.arc(x, y, eyeR * eyePulse, 0, Math.PI * 2);
    ctx.fill();

    // Vertical slit pupil
    ctx.fillStyle = colors.outline;
    ctx.beginPath();
    ctx.ellipse(x, y, eyeR * 0.15, eyeR * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Draw shooting Anemone (Spitter) - tentacles pulse when firing
   */
  private drawShootingAnemone(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>,
    time: number
  ): void {
    // Draw base anemone
    this.drawSpitterEnemy(ctx, x, y, size, colors);

    // Add shooting pulse effect
    const shootPulse = Math.sin(time * 0.01) * 0.5 + 0.5;
    const orbRadius = 3 + shootPulse * 2;

    // Precompute halo color strings outside the 12-iteration loop (no per-iteration string build).
    // Glow halo via concentric arc-fills — NO shadowBlur (GPU-expensive).
    const haloOuter = this.lookupAlpha(colors.glow, 0);
    const tipAlpha = 0.6 + shootPulse * 0.4;

    for (let i = 0; i < 12; i++) {
      const angle = ((Math.PI * 2) / 12) * i;
      const tentacleLength = size * 0.7;
      const tipX = x + Math.cos(angle) * (size * 0.3 + tentacleLength);
      const tipY = y + Math.sin(angle) * (size * 0.3 + tentacleLength);

      // Stepped radial gradient halo around each tip (replaces shadowBlur)
      const haloR = orbRadius * 2.5;
      const haloGrad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, haloR);
      haloGrad.addColorStop(0, this.lookupAlpha(colors.glow, tipAlpha * 0.7));
      haloGrad.addColorStop(0.5, this.lookupAlpha(colors.glow, tipAlpha * 0.25));
      haloGrad.addColorStop(1, haloOuter);
      ctx.fillStyle = haloGrad;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(tipX, tipY, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Solid orb core
      ctx.fillStyle = colors.glow;
      ctx.globalAlpha = tipAlpha;
      ctx.beginPath();
      ctx.arc(tipX, tipY, orbRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw shooting Anglerfish (Sniper) - lure brightens when aiming
   */
  private drawShootingAnglerfish(
    ctx: SpriteContext2D,
    x: number,
    y: number,
    size: number,
    colors: ReturnType<typeof this.getFactionColorsForSprite>,
    time: number
  ): void {
    // Draw base anglerfish
    this.drawSniperEnemy(ctx, x, y, size, colors);

    // Enhanced lure glow when shooting
    const aimPulse = Math.sin(time * 0.008) * 0.5 + 0.5;

    // Brighter, larger lure when aiming
    const lureGlow = ctx.createRadialGradient(x, y - size * 1.5, 0, x, y - size * 1.5, size * 0.5);
    lureGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    lureGlow.addColorStop(0.3, colors.glow);
    lureGlow.addColorStop(0.6, this.addAlpha(colors.glow, 0.5));
    lureGlow.addColorStop(1, 'transparent');

    ctx.fillStyle = lureGlow;
    ctx.globalAlpha = 0.5 + aimPulse * 0.5;
    ctx.beginPath();
    ctx.arc(x, y - size * 1.5, size * 0.4 + aimPulse * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Targeting laser hint
    ctx.strokeStyle = colors.glow;
    ctx.globalAlpha = aimPulse * 0.3;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, y - size * 1.5);
    ctx.lineTo(x, y - size * 3);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = 1;
  }

  /**
   * Clear sprite cache (for memory management)
   */
  clearCache(): void {
    this.spriteCache.clear();
    this.cacheAccessOrder.clear();
    this.cacheAccessCounter = 0;
    this.animationFramePool.clear();
    this.animationBucketCache.clear();
  }

  /**
   * Perform periodic cache cleanup
   */
  private performCacheCleanup(): void {
    const stats = this.getCacheStats();
    const memoryMB = stats.memoryEstimate / (1024 * 1024);

    // Clean if over memory limit or too many sprites
    if (memoryMB > this.MAX_MEMORY_MB || this.spriteCache.size > this.MAX_CACHE_SIZE) {
      // Remove least recently used sprites
      const toRemove = Math.max(
        Math.floor(this.spriteCache.size * 0.3), // Remove 30%
        this.spriteCache.size - Math.floor(this.MAX_CACHE_SIZE * 0.7) // Keep 70% of max
      );

      // Collect entries sorted ascending by access counter, then evict the oldest N.
      // This runs at most every 60 s (periodic cleanup), not per frame.
      const sorted = Array.from(this.cacheAccessOrder.entries()).sort((a, b) => a[1] - b[1]);
      const actualRemove = Math.min(toRemove, sorted.length);
      for (let i = 0; i < actualRemove; i++) {
        const key = sorted[i][0];
        this.spriteCache.delete(key);
        this.cacheAccessOrder.delete(key);
      }
    }

    // Clean animation frame pool
    for (const [key, frames] of this.animationFramePool) {
      // Keep only recent frames
      if (frames.length > this.MAX_POOLED_FRAMES) {
        this.animationFramePool.set(key, frames.slice(-this.MAX_POOLED_FRAMES));
      }
    }
  }

  /**
   * Update LRU access timestamp — O(1) Map.set replaces the former
   * O(n) indexOf + splice on a string array.
   */
  private updateCacheAccess(key: string): void {
    this.cacheAccessOrder.set(key, ++this.cacheAccessCounter);
  }

  /**
   * Add sprite to cache with LRU eviction.
   * Eviction scans the Map once for the entry with the lowest access counter (O(n) on
   * cache size, but eviction is rare — triggered only when the cache is full).
   */
  private addToCache(key: string, canvas: SpriteCanvas): void {
    // Check cache limits
    if (this.spriteCache.size >= this.MAX_CACHE_SIZE) {
      // Evict least recently used: find the entry with the smallest counter value
      let lruKey: string | undefined;
      let lruCounter = Infinity;
      for (const [k, counter] of this.cacheAccessOrder) {
        if (counter < lruCounter) {
          lruCounter = counter;
          lruKey = k;
        }
      }
      if (lruKey !== undefined) {
        this.spriteCache.delete(lruKey);
        this.cacheAccessOrder.delete(lruKey);
      }
    }

    this.spriteCache.set(key, canvas);
    this.updateCacheAccess(key);
  }

  /**
   * Get a time-bucketed animation frame, generating it only on bucket transitions.
   *
   * bucket = Math.floor(animationTime / 50) * 50  → ~20 generator calls/s instead of ~60.
   * cacheKey = `${poolKey}-${bucket}`
   * On hit: return the cached frame without calling generator().
   * On miss: generate + store; evict all entries whose stored bucket differs by > 1 bucket
   *          (keeps at most the current and the immediately-preceding bucket).
   *
   * animationTime defaults to Date.now() when not supplied by the call site so the
   * fallback path (isShooting without an explicit animationTime) still buckets correctly.
   */
  private getPooledAnimationFrame(
    poolKey: string,
    generator: () => SpriteCanvas,
    animationTime?: number
  ): SpriteCanvas {
    const t = animationTime ?? Date.now();
    const bucket = Math.floor(t / 50) * 50;
    const cacheKey = `${poolKey}-${bucket}`;

    const hit = this.animationBucketCache.get(cacheKey);
    if (hit) {
      return hit.frame;
    }

    // Generate new frame for this bucket
    const frame = generator();
    this.animationBucketCache.set(cacheKey, { frame, bucket });

    // Evict stale entries (older than 2 buckets = 100 ms)
    const staleThreshold = bucket - 100;
    for (const [key, entry] of this.animationBucketCache) {
      if (entry.bucket < staleThreshold) {
        this.animationBucketCache.delete(key);
      }
    }

    return frame;
  }

  /**
   * Rebuild the alpha lookup table from the current faction colors.
   * Called once at construction and again on theme change.
   */
  private rebuildAlphaTable(): void {
    this.alphaTable.clear();
    const factionIds = [0, 1, 2, 3, 4];
    for (const factionId of factionIds) {
      const colors = this.getFactionColorsForSprite(factionId);
      for (const colorKey of [colors.primary, colors.secondary, colors.glow, colors.outline] as const) {
        if (!this.alphaTable.has(colorKey)) {
          const alphaMap = new Map<string, string>();
          for (const alpha of EnemySpriteGeneratorService.PREBUILT_ALPHAS) {
            alphaMap.set(String(alpha), this.addAlpha(colorKey, alpha));
          }
          this.alphaTable.set(colorKey, alphaMap);
        }
      }
    }
  }

  /**
   * Fast alpha lookup — returns pre-built rgba string when the color+alpha combination
   * was precomputed at init time, otherwise falls back to addAlpha() string construction.
   */
  private lookupAlpha(color: string, alpha: number): string {
    const alphaMap = this.alphaTable.get(color);
    if (alphaMap) {
      const cached = alphaMap.get(String(alpha));
      if (cached !== undefined) return cached;
    }
    return this.addAlpha(color, alpha);
  }

  /**
   * Validate enemy type
   */
  private isValidEnemyType(type: EnemyType): boolean {
    // Check against known enemy types since EnemyType is a const enum
    return (
      type === EnemyType.Basic ||
      type === EnemyType.Spitter ||
      type === EnemyType.Tank ||
      type === EnemyType.Swarm ||
      type === EnemyType.Thug ||
      type === EnemyType.Sniper ||
      type === EnemyType.Boss ||
      type === EnemyType.Disruptor ||
      type === EnemyType.Sentinel
    );
  }

  /**
   * Validate faction ID
   */
  private isValidFactionId(factionId: number): boolean {
    return factionId >= 0 && factionId <= 4;
  }

  /**
   * Get fallback sprite for error cases
   */
  private getFallbackSprite(): SpriteCanvas {
    const canvas = createSpriteCanvas(40, 40);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // Draw simple circle as fallback
    ctx.fillStyle = '#666666';
    ctx.beginPath();
    ctx.arc(20, 20, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 2;
    ctx.stroke();

    return canvas;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalSprites: number;
    memoryEstimate: number; // in bytes
  } {
    let totalMemory = 0;

    for (const canvas of this.spriteCache.values()) {
      // Each pixel is 4 bytes (RGBA)
      totalMemory += canvas.width * canvas.height * 4;
    }

    return {
      totalSprites: this.spriteCache.size,
      memoryEstimate: totalMemory,
    };
  }
}
