import { Injectable, isDevMode } from '@angular/core';
import { EnemySpriteGeneratorService } from './enemy-sprite-generator.service';
import { SpriteCanvas } from '../utils/canvas-factory';
import { isCoarseTouchDevice } from '../utils/touch-device.util';
import { EntityManager } from '../ecs/ecs.model';
import { EnemyType } from '../models/enemy.model';
import {
  AIControlledComponent,
  DeathAnimationComponent,
  EnemyTypeComponent,
  FactionComponent,
  HealAuraComponent,
  HealthBarDisplayComponent,
  HealthComponent,
  PositionComponent,
  RenderableComponent,
  TerritorialGuardianComponent,
  WeaponComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { ThemeService } from '@services/theme.service';
import { ZONE_CONFIG } from '@photon/config/constants/world/zone.config';
import { PaletteService } from '../../services/palette.service';

/**
 * Faction Enemy Renderer Service
 *
 * Efficiently renders enemies using pre-generated faction sprites.
 * Uses sprite batching and caching for optimal performance.
 *
 * PERFORMANCE FEATURES:
 * - Pre-generated sprites (no runtime generation)
 * - Sprite batching by type+faction
 * - Viewport culling
 * - Health bar batching
 */
/** Shape of a single entry in a sprite batch. */
interface BatchEntry {
  entity: number;
  screenX: number;
  screenY: number;
  sprite: SpriteCanvas;
}

@Injectable({ providedIn: 'root' })
export class FactionEnemyRendererService {
  /** True on coarse-touch devices — set once at construction, never per frame. */
  private readonly isTouch: boolean = isCoarseTouchDevice();

  /** True when running under Angular dev mode — hoisted so it is computed once. */
  private readonly isDev: boolean = isDevMode();

  // Performance tracking
  private enemiesRendered = 0;
  private lastRenderTime = 0;

  /** Pre-cached zone ring colors as { r, g, b } parsed from ZONE_CONFIG themeColor hex strings. */
  private zoneRingColors: Map<number, { r: number; g: number; b: number }>;

  /**
   * Pre-built rgba strings for guardian health bar fills and glow backgrounds,
   * keyed by zoneId. Avoids per-frame template-literal allocation.
   * fill = rgba at alpha 0.85 (health fill), glow = rgba at alpha 0.15 (aggro bg).
   */
  private guardianHealthFillColors: Map<number, string>;
  private guardianHealthGlowColors: Map<number, string>;

  /**
   * Hoisted batch Map — cleared and reused each frame instead of re-allocated.
   * Key: integer encoding (type * 1000 + factionId * 10 + zoneId), avoiding
   * per-frame string allocation from the previous template-literal key.
   */
  private readonly batchMap = new Map<number, BatchEntry[]>();

  /**
   * Object pool for BatchEntry instances — grown lazily, never shrunken.
   * `_poolSize` tracks how many slots are currently in use this frame.
   */
  private readonly batchEntryPool: BatchEntry[] = [];
  private _poolSize = 0;

  // Lazily-assigned stable numeric index per enemy-type string, so the per-frame sprite key
  // can be an integer (no string allocation). EnemyType is a string const enum (no runtime
  // object to enumerate), so we assign an index the first time each type string is seen.
  private readonly typeKeyIndex = new Map<string, number>();
  private nextTypeIndex = 1;

  constructor(
    public spriteGenerator: EnemySpriteGeneratorService,
    private themeService: ThemeService,
    private paletteService: PaletteService
  ) {
    // Pre-generate all sprites on service creation
    this.spriteGenerator.initializeSprites();

    // Pre-cache zone ring RGB values once (no per-frame string parsing)
    this.zoneRingColors = new Map();
    this.guardianHealthFillColors = new Map();
    this.guardianHealthGlowColors = new Map();
    for (const zone of ZONE_CONFIG.ZONES) {
      const hex = zone.themeColor.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      this.zoneRingColors.set(zone.id, { r, g, b });
      this.guardianHealthFillColors.set(zone.id, `rgba(${r},${g},${b},0.85)`);
      this.guardianHealthGlowColors.set(zone.id, `rgba(${r},${g},${b},0.15)`);
    }
  }

  /**
   * Render all visible enemies with faction sprites
   */
  renderEnemies(
    ctx: CanvasRenderingContext2D,
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number = 1
  ): void {
    // Only track performance in development (isDev hoisted to constructor field)
    const startTime = this.isDev ? window.performance.now() : 0;
    this.enemiesRendered = 0;

    // Get all enemy entities
    const enemies = entityManager.getEntitiesWithComponents(PositionComponent, EnemyTypeComponent);

    // Group enemies by sprite type for batching
    const enemyBatches = this.batchEnemiesBySprite(
      enemies,
      entityManager,
      cameraX,
      cameraY,
      screenWidth,
      screenHeight,
      zoom
    );

    // Render sniper targeting lines FIRST (behind sprites)
    this.renderSniperTargetingLines(ctx, enemies, entityManager, cameraX, cameraY, screenWidth, screenHeight, zoom);

    // Render charger wind-up telegraphs (behind sprites)
    this.renderChargerTelegraphs(ctx, enemies, entityManager, cameraX, cameraY, screenWidth, screenHeight, zoom);

    // Render behavior state indicators (behind sprites)
    this.renderBehaviorIndicators(ctx, enemies, entityManager, cameraX, cameraY, screenWidth, screenHeight, zoom);

    // Render each batch
    const currentTime = window.performance.now();
    for (const [, batch] of enemyBatches) {
      this.renderEnemyBatch(ctx, batch, zoom, entityManager, currentTime);
    }

    // Render guardian aggro/return rings (above sprites, below health bars)
    this.renderGuardianRings(ctx, enemyBatches, entityManager, zoom);

    // Render heal-aura radius rings (gameplay telegraph — shown on both desktop and touch)
    this.renderHealAuraRings(ctx, enemyBatches, entityManager, zoom);

    // Render health bars in separate pass (for better layering)
    this.renderHealthBars(ctx, enemyBatches, entityManager, zoom);

    if (this.isDev) {
      this.lastRenderTime = window.performance.now() - startTime;
    }
  }

  /**
   * Batch enemies by their sprite type for efficient rendering.
   *
   * PERFORMANCE: reuses the hoisted `batchMap` (cleared each frame, never re-allocated),
   * recycles `BatchEntry` objects from `batchEntryPool` (grown lazily, never shrunken),
   * and encodes the sprite key as an integer to avoid per-frame string allocation.
   *
   * Integer key encoding: type * 100_000 + factionId * 10 + (zoneId ?? 0) * 2 + isGuardian.
   * The multipliers are chosen so the components cannot collide given realistic value ranges:
   *   - type       < 100   (enemy-type enum ordinals)
   *   - factionId  < 1000  (faction IDs)
   *   - zoneId     < 100   (zone IDs from ZONE_CONFIG)
   *   - isGuardian  0 | 1
   */
  private batchEnemiesBySprite(
    enemies: number[],
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number
  ): Map<number, BatchEntry[]> {
    // Reuse hoisted map — reset pool counter and clear the map in-place.
    this._poolSize = 0;
    this.batchMap.clear();

    const halfWidth = screenWidth / 2;
    const halfHeight = screenHeight / 2;
    const buffer = 100; // Extra pixels for smooth scrolling
    const now = window.performance.now(); // Single timestamp for all viewport checks this frame

    for (const entity of enemies) {
      const position = entityManager.getComponent(entity, PositionComponent);
      const enemyType = entityManager.getComponent(entity, EnemyTypeComponent);

      if (!position || !enemyType) continue;

      // Viewport culling
      const screenX = (position.x - cameraX) * zoom + halfWidth;
      const screenY = (position.y - cameraY) * zoom + halfHeight;

      // Get renderable once — used for both viewport tracking and batching
      const renderable = entityManager.getComponent(entity, RenderableComponent);

      if (screenX < -buffer || screenX > screenWidth + buffer || screenY < -buffer || screenY > screenHeight + buffer) {
        // Mark as exited viewport so re-entry triggers appear animation
        if (renderable?.wasInViewport) renderable.markViewportExit();
        continue; // Skip off-screen enemies
      }

      // Mark as entered viewport — triggers appear animation on first entry or re-entry
      if (renderable) renderable.markViewportEntry(now);

      // Get faction from FactionComponent (default to neutral if not present)
      let factionId = 0;
      try {
        const factionComp = entityManager.getComponent(entity, FactionComponent);
        if (factionComp && factionComp.kingId) {
          factionId = factionComp.kingId;
        }
      } catch {
        // Component not registered, use default
        factionId = 0;
      }

      // Determine guardian status for tint strength (guardians get 30% tint vs 10% for regular)
      const isGuardian = !!entityManager.getComponent(entity, TerritorialGuardianComponent);

      // Get sprite for this enemy+faction+zone combo (zone tint baked in at generation time)
      const zoneId = enemyType.zoneId ?? null;
      const sprite = this.spriteGenerator.getSprite(
        enemyType.type,
        factionId,
        undefined,
        undefined,
        zoneId,
        isGuardian
      );

      // Integer sprite key — avoids per-frame string allocation.
      let typeIdx = this.typeKeyIndex.get(enemyType.type);
      if (typeIdx === undefined) {
        typeIdx = this.nextTypeIndex++;
        this.typeKeyIndex.set(enemyType.type, typeIdx);
      }
      const spriteKey = typeIdx * 100_000 + factionId * 10 + (zoneId ?? 0) * 2 + (isGuardian ? 1 : 0);

      // Retrieve or create the batch array for this sprite key.
      let batch = this.batchMap.get(spriteKey);
      if (!batch) {
        batch = [];
        this.batchMap.set(spriteKey, batch);
      }

      // Acquire a pooled entry object; grow the pool if exhausted.
      let entry: BatchEntry;
      if (this._poolSize < this.batchEntryPool.length) {
        entry = this.batchEntryPool[this._poolSize];
      } else {
        entry = { entity: 0, screenX: 0, screenY: 0, sprite };
        this.batchEntryPool.push(entry);
      }
      this._poolSize++;

      // Mutate in place — no new object allocation.
      entry.entity = entity;
      entry.screenX = screenX;
      entry.screenY = screenY;
      entry.sprite = sprite;

      batch.push(entry);
      this.enemiesRendered++;
    }

    return this.batchMap;
  }

  /**
   * Render a batch of enemies with the same sprite
   */
  private renderEnemyBatch(
    ctx: CanvasRenderingContext2D,
    batch: BatchEntry[],
    zoom: number,
    entityManager: EntityManager,
    currentTime: number
  ): void {
    if (batch.length === 0) return;

    // Get the sprite (same for all in batch)
    const sprite = batch[0].sprite;
    // Clamp zoom to prevent extreme scaling that causes visual instability
    const clampedZoom = Math.max(0.5, Math.min(2, zoom));

    // Boss-only 1.3× draw scale for stronger visual presence.
    // All entities in a batch share the same type, so check the first entity once.
    const firstEnemyType = entityManager.getComponent(batch[0].entity, EnemyTypeComponent);
    const isBossBatch = firstEnemyType?.type === EnemyType.Boss;
    const bossScale = isBossBatch ? 1.3 : 1.0;
    const baseSize = sprite.width * clampedZoom * bossScale;

    // Use performance.now() to match TerritorialGuardianComponent.spawnTime and
    // RenderableComponent.spawnTime — both store monotonic timestamps from the
    // same clock source.
    const now = window.performance.now();
    for (const enemy of batch) {
      // Spawn animation: scale up from 0.4→1.0 with ease-out and fade in from 0.3→1.0 over 250ms
      // Skip spawn animation if a death animation is already active
      const renderable = entityManager.getComponent(enemy.entity, RenderableComponent);
      const isDying = entityManager.getComponent(enemy.entity, DeathAnimationComponent) !== undefined;
      const spawnProgress = isDying || !renderable ? 1 : renderable.getSpawnProgress(currentTime);

      // Guardian respawn fade-in: 1-second fade on top of the normal spawn animation
      const guardian = entityManager.getComponent(enemy.entity, TerritorialGuardianComponent);
      const guardianFadeIn = guardian ? Math.min(1, (now - guardian.spawnTime) / 1000) : 1;

      // Death fade-out. The DeathAnimationSystem writes the flash→fade curve into
      // renderable.opacity every frame, but it was never applied here — so a dead enemy rendered
      // at FULL opacity for the whole 600ms death animation and then popped out of existence (the
      // "ghost": a killed NPC still drawn solid, lingering, before it suddenly disappears). Apply
      // it so the enemy visibly fades out. (Clamp to [0,1]; the flash peak >1 just reads as full.)
      const deathOpacity = isDying && renderable ? Math.max(0, Math.min(1, renderable.opacity ?? 1)) : 1;

      if (spawnProgress < 1) {
        // Spawn-in: ease-out (t*(2-t)) scale 0.4→1.0, alpha 0.3→1.0 over 250ms
        const eased = spawnProgress * (2 - spawnProgress);
        const scale = 0.4 + 0.6 * eased;
        const spriteSize = baseSize * scale;
        ctx.globalAlpha = (0.3 + 0.7 * eased) * guardianFadeIn;
        ctx.drawImage(sprite, enemy.screenX - spriteSize / 2, enemy.screenY - spriteSize / 2, spriteSize, spriteSize);
        ctx.globalAlpha = 1;
      } else {
        const alpha = guardianFadeIn * deathOpacity;
        if (alpha < 1) {
          ctx.globalAlpha = alpha;
          ctx.drawImage(sprite, enemy.screenX - baseSize / 2, enemy.screenY - baseSize / 2, baseSize, baseSize);
          ctx.globalAlpha = 1;
        } else {
          ctx.drawImage(sprite, enemy.screenX - baseSize / 2, enemy.screenY - baseSize / 2, baseSize, baseSize);
        }
      }
    }
  }

  /**
   * Render health bars for all visible enemies
   */
  private renderHealthBars(
    ctx: CanvasRenderingContext2D,
    enemyBatches: Map<number, BatchEntry[]>,
    entityManager: EntityManager,
    zoom: number
  ): void {
    // PERF: no save()/restore() — this method only sets fillStyle/strokeStyle/lineWidth,
    // no transforms are applied, so save/restore is pure overhead.
    // Health bar settings - Fixed sizes that don't scale with zoom to prevent instability
    // Use clamped zoom to prevent extreme scaling
    const clampedZoom = Math.max(0.5, Math.min(2, zoom));
    // PERF: pre-cached — resolve theme colors once per renderHealthBars call, not per enemy.
    const canvasColors = this.paletteService.getCanvas();
    const barWidth = 30; // Fixed width in screen pixels
    const barHeight = 4; // Fixed height in screen pixels
    const barOffset = 20; // Fixed offset from enemy center

    for (const batch of enemyBatches.values()) {
      for (const enemy of batch) {
        const health = entityManager.getComponent(enemy.entity, HealthComponent);
        if (!health) continue;

        // No health bar on a dying enemy — it is fading out, the bar would read as a live target.
        if (entityManager.getComponent(enemy.entity, DeathAnimationComponent)) continue;

        // Check if health bar should be displayed
        const healthBarDisplay = entityManager.getComponent(enemy.entity, HealthBarDisplayComponent);
        const shouldShowHealthBar = healthBarDisplay
          ? healthBarDisplay.shouldDisplay()
          : health.health < health.maxHealth;

        if (!shouldShowHealthBar) continue; // Skip if health bar shouldn't be shown

        // Clamp health values to prevent rendering issues
        const currentHealth = Math.max(0, Math.min(health.health, health.maxHealth));
        const maxHealth = Math.max(1, health.maxHealth); // Prevent divide by zero
        const healthPercent = currentHealth / maxHealth;

        // Guardian: wider, more prominent health bar with zone theme color
        const guardian = entityManager.getComponent(enemy.entity, TerritorialGuardianComponent);
        // Boss: check entity type for 1.3× sprite-scale compensation
        const enemyTypeComp = entityManager.getComponent(enemy.entity, EnemyTypeComponent);
        const isBossEntity = enemyTypeComp?.type === EnemyType.Boss;
        let effectiveBarWidth: number;
        let effectiveBarHeight: number;
        if (guardian) {
          if (guardian.isAggroed) {
            // Aggro state: prominent boss-style health bar
            effectiveBarWidth = barWidth * 2.0;
            effectiveBarHeight = barHeight + 3;
          } else {
            // Patrol/leash: standard guardian bar
            effectiveBarWidth = barWidth * 1.5;
            effectiveBarHeight = barHeight + 2;
          }
        } else if (isBossEntity) {
          // Boss drawn at 1.3× — widen bar and push it up to clear the larger sprite
          effectiveBarWidth = barWidth * 1.5;
          effectiveBarHeight = barHeight + 2;
        } else {
          effectiveBarWidth = barWidth;
          effectiveBarHeight = barHeight;
        }

        // Calculate bar position - scale offset with clamped zoom for proper positioning.
        // Bosses get extra vertical offset to clear the 1.3× sprite top edge.
        const bossBarExtraOffset = isBossEntity ? 10 : 0;
        const barY = enemy.screenY - (barOffset + bossBarExtraOffset) * clampedZoom;
        const barX = enemy.screenX - effectiveBarWidth / 2;

        // Aggro glow: filled rect 2px larger on each side behind the health bar
        if (guardian?.isAggroed) {
          ctx.fillStyle = this.guardianHealthGlowColors.get(guardian.zoneId) ?? 'rgba(80,200,255,0.15)';
          ctx.fillRect(barX - 2, barY - 2, effectiveBarWidth + 4, effectiveBarHeight + 4);
        }

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(barX, barY, effectiveBarWidth, effectiveBarHeight);

        // Health fill - ensure width is never negative
        const fillWidth = Math.max(0, effectiveBarWidth * healthPercent);
        if (fillWidth > 0) {
          if (guardian) {
            // Use pre-built rgba string (avoids per-frame template-literal allocation).
            ctx.fillStyle = this.guardianHealthFillColors.get(guardian.zoneId) ?? 'rgba(80,200,255,0.85)';
          } else {
            // PERF: pre-cached — canvasColors resolved once above, not via getThemeColors() per enemy.
            ctx.fillStyle =
              healthPercent > 0.6
                ? canvasColors.HEALTH_HIGH
                : healthPercent > 0.3
                  ? canvasColors.HEALTH_MED
                  : canvasColors.HEALTH_LOW;
          }
          ctx.fillRect(barX, barY, fillWidth, effectiveBarHeight);
        }

        if (guardian) {
          // Thin outline for guardian health bar
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, effectiveBarWidth, effectiveBarHeight);
        } else {
          // Standard border
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, effectiveBarWidth, effectiveBarHeight);
        }
      }
    }
    // PERF: no ctx.restore() needed — no save() was called; no transforms were applied.
  }

  /**
   * Get render statistics
   */
  getRenderStats(): {
    enemiesRendered: number;
    lastRenderTime: number;
    spritesCached: number;
    memoryUsage: number;
  } {
    const cacheStats = this.spriteGenerator.getCacheStats();

    return {
      enemiesRendered: this.enemiesRendered,
      lastRenderTime: this.lastRenderTime,
      spritesCached: cacheStats.totalSprites,
      memoryUsage: cacheStats.memoryEstimate,
    };
  }

  /**
   * Clear caches (for memory management)
   */
  clearCaches(): void {
    this.spriteGenerator.clearCache();
  }

  /**
   * Render sniper targeting lines (dashed line telegraph)
   * Shows players where snipers are aiming before they fire
   */
  private renderSniperTargetingLines(
    ctx: CanvasRenderingContext2D,
    enemies: number[],
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number
  ): void {
    ctx.save();
    const halfWidth = screenWidth / 2;
    const halfHeight = screenHeight / 2;
    const currentTime = Date.now();
    const buffer = 200;

    for (const entity of enemies) {
      const ai = entityManager.getComponent(entity, AIControlledComponent);
      const weapon = entityManager.getComponent(entity, WeaponComponent);
      const position = entityManager.getComponent(entity, PositionComponent);

      if (!ai || !weapon || !position) continue;

      // Only render for snipers that are aiming
      const isSniper =
        ai.behaviorPattern === BehaviorPattern.Sniper || ai.originalBehaviorPattern === BehaviorPattern.Sniper;
      if (!isSniper || !weapon.isAiming || !weapon.targetDirection) continue;

      // Calculate screen position
      const screenX = (position.x - cameraX) * zoom + halfWidth;
      const screenY = (position.y - cameraY) * zoom + halfHeight;

      // Viewport culling — skip off-screen snipers
      if (screenX < -buffer || screenX > screenWidth + buffer || screenY < -buffer || screenY > screenHeight + buffer) {
        continue;
      }

      // Get aim progress for visual intensity
      const aimProgress = weapon.getAimProgress(currentTime);

      // Line length extends as aim progresses
      const maxLineLength = 400 * zoom;
      const lineLength = maxLineLength * (0.3 + aimProgress * 0.7); // Start at 30%, grow to 100%

      // Calculate end point
      const endX = screenX + weapon.targetDirection.x * lineLength;
      const endY = screenY + weapon.targetDirection.y * lineLength;

      // Draw the dashed targeting line
      ctx.beginPath();
      ctx.moveTo(screenX, screenY);
      ctx.lineTo(endX, endY);

      // Dashed line pattern - gets more solid as aim completes
      const dashLength = 10 - aimProgress * 5; // 10px -> 5px dashes
      const gapLength = 8 - aimProgress * 6; // 8px -> 2px gaps
      ctx.setLineDash([dashLength, gapLength]);

      // Color intensity increases with aim progress
      // Red warning color that gets brighter
      const alpha = 0.3 + aimProgress * 0.5; // 0.3 -> 0.8
      const red = Math.floor(255);
      const green = Math.floor(100 - aimProgress * 80); // Orange -> Red
      const blue = Math.floor(100 - aimProgress * 100);
      ctx.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`;

      // Line width increases with aim progress — clamp to ≥2 screen px so it
      // stays legible at low zoom / mobile render scale.
      ctx.lineWidth = Math.max(1.5 + aimProgress * 1.5, 2); // 1.5 -> 3, min 2px

      ctx.stroke();

      // Draw a pulsing reticle at the end when nearly ready
      if (aimProgress > 0.6) {
        const pulseIntensity = Math.sin(currentTime * 0.01) * 0.3 + 0.7;
        const reticleSize = (4 + aimProgress * 4) * pulseIntensity;

        ctx.beginPath();
        ctx.arc(endX, endY, reticleSize, 0, Math.PI * 2);
        ctx.setLineDash([]); // Solid for reticle
        ctx.strokeStyle = `rgba(255, 50, 50, ${alpha * pulseIntensity})`;
        // Already 2px — meets the ≥1.5 screen-px minimum for legibility
        ctx.lineWidth = 2;
        ctx.stroke();

        // Inner crosshair
        ctx.beginPath();
        ctx.moveTo(endX - reticleSize, endY);
        ctx.lineTo(endX + reticleSize, endY);
        ctx.moveTo(endX, endY - reticleSize);
        ctx.lineTo(endX, endY + reticleSize);
        ctx.stroke();
      }
    }

    ctx.setLineDash([]); // Reset dash pattern
    ctx.restore();
  }

  /**
   * Render charger wind-up telegraphs (glowing charge indicator)
   * Shows players when a charger is about to charge
   */
  private renderChargerTelegraphs(
    ctx: CanvasRenderingContext2D,
    enemies: number[],
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number
  ): void {
    ctx.save();
    const halfWidth = screenWidth / 2;
    const halfHeight = screenHeight / 2;
    const currentTime = Date.now();
    const buffer = 200;

    for (const entity of enemies) {
      const ai = entityManager.getComponent(entity, AIControlledComponent);
      const position = entityManager.getComponent(entity, PositionComponent);

      if (!ai || !position) continue;

      // Only render for chargers with charge direction set (wind-up or charging)
      const isCharger =
        ai.behaviorPattern === BehaviorPattern.Charger || ai.originalBehaviorPattern === BehaviorPattern.Charger;
      if (!isCharger || !ai.chargeTargetDirection) continue;

      // Calculate screen position
      const screenX = (position.x - cameraX) * zoom + halfWidth;
      const screenY = (position.y - cameraY) * zoom + halfHeight;

      // Viewport culling — skip off-screen chargers
      if (screenX < -buffer || screenX > screenWidth + buffer || screenY < -buffer || screenY > screenHeight + buffer) {
        continue;
      }

      // Calculate charge progress
      const windUpDuration = 600;
      const chargeDuration = 1400;
      const timeSinceStart = currentTime - ai.chargeStartTime;
      const isWindingUp = timeSinceStart < windUpDuration;
      const isCharging = ai.isCharging;

      if (isWindingUp) {
        // WIND-UP PHASE: Pulsing glow + direction arrow
        const windUpProgress = timeSinceStart / windUpDuration;
        const pulseSpeed = 0.015 + windUpProgress * 0.01; // Pulse faster as charge nears
        const pulseIntensity = 0.5 + 0.5 * Math.sin(currentTime * pulseSpeed);

        // Pulsing warning glow around charger
        const glowRadius = (30 + windUpProgress * 20) * zoom;

        // Orange -> Red as charge builds
        const red = 255;
        const green = Math.floor(180 - windUpProgress * 130); // 180 -> 50
        const alpha = (0.3 + windUpProgress * 0.4) * pulseIntensity;

        ctx.beginPath();
        ctx.arc(screenX, screenY, glowRadius, 0, Math.PI * 2);
        if (this.isTouch) {
          // Flat fill avoids per-frame createRadialGradient on the GPU-limited mobile path,
          // but keeps the orange->red charge ramp + pulse so the telegraph stays readable.
          ctx.fillStyle = `rgba(${red}, ${green}, 50, ${alpha})`;
        } else {
          const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, glowRadius);
          gradient.addColorStop(0, `rgba(${red}, ${green}, 50, ${alpha})`);
          gradient.addColorStop(0.5, `rgba(${red}, ${green}, 30, ${alpha * 0.5})`);
          gradient.addColorStop(1, `rgba(${red}, ${green}, 0, 0)`);
          ctx.fillStyle = gradient;
        }
        ctx.fill();

        // Direction arrow showing where charge will go
        const arrowLength = (40 + windUpProgress * 30) * zoom;
        const arrowEndX = screenX + ai.chargeTargetDirection.x * arrowLength;
        const arrowEndY = screenY + ai.chargeTargetDirection.y * arrowLength;

        // Arrow shaft — clamp to ≥2 screen px so it stays legible at low zoom / mobile scale
        ctx.beginPath();
        ctx.moveTo(screenX, screenY);
        ctx.lineTo(arrowEndX, arrowEndY);
        ctx.strokeStyle = `rgba(255, ${green}, 50, ${0.5 + windUpProgress * 0.4})`;
        ctx.lineWidth = Math.max(2 + windUpProgress * 2, 2); // 2 -> 4, min 2px
        ctx.stroke();

        // Arrow head
        const headSize = (8 + windUpProgress * 4) * zoom;
        const angle = Math.atan2(ai.chargeTargetDirection.y, ai.chargeTargetDirection.x);
        ctx.beginPath();
        ctx.moveTo(arrowEndX, arrowEndY);
        ctx.lineTo(
          arrowEndX - headSize * Math.cos(angle - Math.PI / 6),
          arrowEndY - headSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.moveTo(arrowEndX, arrowEndY);
        ctx.lineTo(
          arrowEndX - headSize * Math.cos(angle + Math.PI / 6),
          arrowEndY - headSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.stroke();

        // "!" warning indicator when almost ready — clamp to ≥12 screen px so it
        // stays legible at mobile render scale. All drawing here is in screen
        // space (positions are pre-multiplied by zoom), so the font px are literal
        // screen pixels: Math.max(14 * zoom, 12) is correct without any division.
        if (windUpProgress > 0.7) {
          ctx.font = `bold ${Math.max(14 * zoom, 12)}px Arial`;
          ctx.fillStyle = `rgba(255, 100, 50, ${pulseIntensity})`;
          ctx.textAlign = 'center';
          ctx.fillText('!', screenX, screenY - 25 * zoom);
        }
      } else if (isCharging) {
        // CHARGING PHASE: Speed lines / motion blur effect
        const chargeProgress = (timeSinceStart - windUpDuration) / chargeDuration;

        // Trail effect behind charger
        const trailLength = 60 * zoom;
        const trailStartX = screenX - ai.chargeTargetDirection.x * trailLength;
        const trailStartY = screenY - ai.chargeTargetDirection.y * trailLength;

        // Multiple trail lines for speed effect
        for (let i = 0; i < 5; i++) {
          const offset = (i - 2) * 4 * zoom;
          const perpX = -ai.chargeTargetDirection.y * offset;
          const perpY = ai.chargeTargetDirection.x * offset;

          ctx.beginPath();
          ctx.moveTo(trailStartX + perpX, trailStartY + perpY);
          ctx.lineTo(screenX + perpX * 0.3, screenY + perpY * 0.3);

          const trailAlpha = (0.4 - Math.abs(i - 2) * 0.1) * (1 - chargeProgress * 0.5);
          ctx.strokeStyle = `rgba(255, 150, 50, ${trailAlpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Charging glow (less intense than wind-up)
        const chargeGlowRadius = 25 * zoom;

        ctx.beginPath();
        ctx.arc(screenX, screenY, chargeGlowRadius, 0, Math.PI * 2);
        if (this.isTouch) {
          // Flat fill avoids per-frame createRadialGradient on the GPU-limited mobile path.
          ctx.fillStyle = `rgba(255,100,50,0.2)`;
        } else {
          const chargeGradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, chargeGlowRadius);
          chargeGradient.addColorStop(0, `rgba(255, 100, 50, 0.4)`);
          chargeGradient.addColorStop(1, `rgba(255, 50, 0, 0)`);
          ctx.fillStyle = chargeGradient;
        }
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * Render territorial guardian aggro and return-state rings.
   *
   * Aggroed (chasing): two concentric pulsing rings in the zone theme color.
   * Leashed (returning home): single steady white ring.
   *
   * PERFORMANCE: no save/restore, no shadowBlur, no gradient, no string concatenation.
   * RGB values are pre-cached in zoneRingColors; rgba strings are built inline with
   * simple numeric arithmetic (one concatenation per ring per frame, intentional).
   */
  private renderGuardianRings(
    ctx: CanvasRenderingContext2D,
    enemyBatches: Map<number, BatchEntry[]>,
    entityManager: EntityManager,
    zoom: number
  ): void {
    const now = Date.now();
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.004);
    const clampedZoom = Math.max(0.5, Math.min(2, zoom));
    // Approximate enemy radius from sprite size — matches renderEnemyBatch sizing
    const spriteHalfSize = 16 * clampedZoom; // half of typical 32px sprite at current zoom

    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    for (const batch of enemyBatches.values()) {
      for (const enemy of batch) {
        const guardian = entityManager.getComponent(enemy.entity, TerritorialGuardianComponent);
        if (!guardian) continue;

        const enemyRadius = spriteHalfSize;

        if (guardian.isLeashed) {
          // Return state: single steady white ring
          ctx.strokeStyle = `rgba(255,255,255,0.2)`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(enemy.screenX, enemy.screenY, enemyRadius + 15 * clampedZoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 2;
        } else if (guardian.isAggroed) {
          // Aggro state: two concentric pulsing rings in zone theme color
          const rgb = this.zoneRingColors.get(guardian.zoneId) ?? { r: 255, g: 255, b: 255 };

          // Outer ring
          const outerAlpha = 0.3 * pulse;
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${outerAlpha})`;
          ctx.beginPath();
          ctx.arc(enemy.screenX, enemy.screenY, enemyRadius + 20 * clampedZoom, 0, Math.PI * 2);
          ctx.stroke();

          // Inner ring
          const innerAlpha = 0.2 * pulse;
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${innerAlpha})`;
          ctx.beginPath();
          ctx.arc(enemy.screenX, enemy.screenY, enemyRadius + 10 * clampedZoom, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Patrol state: subtle dashed awareness ring showing aggro radius
          const rgb = this.zoneRingColors.get(guardian.zoneId) ?? { r: 255, g: 255, b: 255 };
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 8]);
          ctx.beginPath();
          ctx.arc(enemy.screenX, enemy.screenY, guardian.aggroRadius * clampedZoom, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 2;
        }
      }
    }
  }

  /**
   * Render lightweight behavior state indicators for visible enemies.
   * Gives visual personality to different AI behaviors without shadowBlur.
   *
   * PERFORMANCE: Only renders for on-screen enemies, uses simple canvas paths.
   * No string manipulation, no shadowBlur, minimal save/restore.
   */
  private renderBehaviorIndicators(
    ctx: CanvasRenderingContext2D,
    enemies: number[],
    entityManager: EntityManager,
    cameraX: number,
    cameraY: number,
    screenWidth: number,
    screenHeight: number,
    zoom: number
  ): void {
    // On touch devices these decorative overlays are unreadable at phone scale and
    // cost an O(N-enemies) loop + N rgba() string allocations + per-enemy setLineDash
    // flushes every frame. Skip entirely; desktop behavior is unchanged.
    if (this.isTouch) return;

    ctx.save();
    const halfWidth = screenWidth / 2;
    const halfHeight = screenHeight / 2;
    const currentTime = Date.now();
    const buffer = 100;

    ctx.lineWidth = 1;

    // Pre-filter once: only swarming enemies need the O(N) inner scan.
    // Without this pre-filter the inner loop is O(N²) over all enemies.
    const swarmingEnemies: number[] = [];
    for (const e of enemies) {
      const a = entityManager.getComponent(e, AIControlledComponent);
      if (a?.aiVisualState === 'swarming') swarmingEnemies.push(e);
    }

    // Theme-aware indicator colors (light mode needs darker, more contrasting colors)
    const isDayMode = this.themeService.isDayMode;
    const indicatorColors = {
      aggressive: isDayMode ? { r: 180, g: 50, b: 50 } : { r: 255, g: 80, b: 60 },
      swarm: isDayMode ? { r: 60, g: 120, b: 60 } : { r: 200, g: 255, b: 100 },
      retreat: isDayMode ? { r: 160, g: 100, b: 40 } : { r: 255, g: 220, b: 100 },
      boss: isDayMode ? { r: 160, g: 90, b: 40 } : { r: 255, g: 200, b: 100 },
    };
    // Light mode uses higher opacity for visibility on light backgrounds
    const alphaMultiplier = isDayMode ? 1.6 : 1.0;

    for (const entity of enemies) {
      const ai = entityManager.getComponent(entity, AIControlledComponent);
      const position = entityManager.getComponent(entity, PositionComponent);

      if (!ai || !position) continue;

      // Viewport culling
      const screenX = (position.x - cameraX) * zoom + halfWidth;
      const screenY = (position.y - cameraY) * zoom + halfHeight;

      if (screenX < -buffer || screenX > screenWidth + buffer || screenY < -buffer || screenY > screenHeight + buffer) {
        continue;
      }

      const visualState = ai.aiVisualState;

      // Aggressive: Small pulsing red triangles radiating outward
      if (visualState === 'attacking') {
        const pulse = 0.5 + 0.5 * Math.sin(currentTime * 0.006 + ai.movementSeed * 10);
        const triSize = (4 + pulse * 3) * zoom;
        const triDist = (18 + pulse * 5) * zoom;
        const c = indicatorColors.aggressive;
        const alpha = Math.min((0.25 + pulse * 0.2) * alphaMultiplier, 0.7);
        ctx.fillStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;

        for (let i = 0; i < 3; i++) {
          const angle = (i * Math.PI * 2) / 3 + currentTime * 0.002;
          const tx = screenX + Math.cos(angle) * triDist;
          const ty = screenY + Math.sin(angle) * triDist;

          ctx.beginPath();
          ctx.moveTo(tx + Math.cos(angle) * triSize, ty + Math.sin(angle) * triSize);
          ctx.lineTo(tx + Math.cos(angle + 2.4) * triSize, ty + Math.sin(angle + 2.4) * triSize);
          ctx.lineTo(tx + Math.cos(angle - 2.4) * triSize, ty + Math.sin(angle - 2.4) * triSize);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Swarm: Thin dotted connection lines to nearby swarm allies
      if (visualState === 'swarming') {
        const c = indicatorColors.swarm;
        const swarmAlpha = Math.min(0.12 * alphaMultiplier, 0.25);
        ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${swarmAlpha})`;
        ctx.setLineDash([3, 6]);
        ctx.lineWidth = 1;

        // Only draw lines to a few nearby swarm allies (performance).
        // Iterates the pre-filtered swarmingEnemies subset instead of all enemies,
        // reducing this inner scan from O(N) to O(swarmers) per swarming enemy.
        let lineCount = 0;
        for (const other of swarmingEnemies) {
          if (other === entity || lineCount >= 2) break;
          const otherPos = entityManager.getComponent(other, PositionComponent);
          if (!otherPos) continue;

          const dx = position.x - otherPos.x;
          const dy = position.y - otherPos.y;
          if (dx * dx + dy * dy < 120 * 120) {
            const otherScreenX = (otherPos.x - cameraX) * zoom + halfWidth;
            const otherScreenY = (otherPos.y - cameraY) * zoom + halfHeight;
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(otherScreenX, otherScreenY);
            ctx.stroke();
            lineCount++;
          }
        }
        ctx.setLineDash([]);
      }

      // Retreat: Small flee arrows behind the enemy
      if (visualState === 'retreating' && ai.wanderDirection) {
        const fleeAlpha = Math.min((0.3 + 0.15 * Math.sin(currentTime * 0.005)) * alphaMultiplier, 0.6);
        const c = indicatorColors.retreat;
        ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${fleeAlpha})`;
        ctx.lineWidth = 1.5;

        // Arrow points opposite to movement direction (trail behind)
        const mdx = ai.wanderDirection.x;
        const mdy = ai.wanderDirection.y;
        const mag = Math.sqrt(mdx * mdx + mdy * mdy);
        if (mag > 0.01) {
          const nx = -mdx / mag;
          const ny = -mdy / mag;
          for (let i = 0; i < 2; i++) {
            const dist = (14 + i * 10) * zoom;
            const ax = screenX + nx * dist;
            const ay = screenY + ny * dist;
            const aSize = 4 * zoom;

            ctx.beginPath();
            ctx.moveTo(ax + nx * aSize, ay + ny * aSize);
            ctx.lineTo(ax + ny * aSize * 0.6, ay - nx * aSize * 0.6);
            ctx.moveTo(ax + nx * aSize, ay + ny * aSize);
            ctx.lineTo(ax - ny * aSize * 0.6, ay + nx * aSize * 0.6);
            ctx.stroke();
          }
        }
      }

      // Boss: Subtle concentric shield rings at low opacity
      if (ai.behaviorPattern === BehaviorPattern.Boss) {
        const ringPulse = 0.5 + 0.5 * Math.sin(currentTime * 0.002 + ai.movementSeed * 5);
        const c = indicatorColors.boss;
        const bossAlpha = Math.min((0.08 + ringPulse * 0.06) * alphaMultiplier, 0.25);
        ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${bossAlpha})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);

        for (let r = 0; r < 2; r++) {
          const radius = (22 + r * 10 + ringPulse * 3) * zoom;
          ctx.beginPath();
          ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.setLineDash([]); // Reset any dash pattern set by swarm indicators
    ctx.restore();
  }

  /**
   * Render heal-aura radius rings for enemies carrying HealAuraComponent.
   *
   * This is a gameplay telegraph (shows healing range), so it renders on BOTH
   * desktop and touch — players need this information to prioritize Sentinels.
   *
   * PERFORMANCE: stroke only, no gradient per frame, no fill, no save/restore.
   * Reuses the hoisted pulse from Date.now() computed once per call.
   */
  private renderHealAuraRings(
    ctx: CanvasRenderingContext2D,
    enemyBatches: Map<number, BatchEntry[]>,
    entityManager: EntityManager,
    zoom: number
  ): void {
    const now = Date.now();
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.003);
    const clampedZoom = Math.max(0.5, Math.min(2, zoom));

    ctx.setLineDash([]);
    // 1.5 screen-px stroke is the minimum for legibility at mobile render scale.
    // The heal-aura is drawn in screen space (enemy.screenX/Y already scaled),
    // so this value IS the screen-pixel width — no zoom correction needed.
    ctx.lineWidth = 1.5;

    for (const batch of enemyBatches.values()) {
      for (const enemy of batch) {
        const healAura = entityManager.getComponent(enemy.entity, HealAuraComponent);
        if (!healAura) continue;

        // Don't render ring on a dying enemy
        if (entityManager.getComponent(enemy.entity, DeathAnimationComponent)) continue;

        const auraRadius = healAura.radius * clampedZoom;
        // Pale green pulsing ring — alpha range 0.12…0.28
        const ringAlpha = 0.12 + pulse * 0.16;
        ctx.strokeStyle = `rgba(100,220,130,${ringAlpha})`;
        ctx.beginPath();
        ctx.arc(enemy.screenX, enemy.screenY, auraRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
