import { Injectable } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { GameRenderingService } from '../../engine/game-rendering.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { PlayerService } from '../../player/player.service';
import { UIStateService } from '../../state/ui-state.service';
import { GameStateService } from '../../state/game-state.service';
import { AimingSystemService } from '../combat/aiming-system.service';
import { FloatingTextSystemService } from '../rendering';
import { TerritoryVisualFeedbackService } from '../territory/territory-visual-feedback.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { SettingsService } from '../../utils/settings.service';
import { Enemy, Projectile } from '../../models/game-types.model';
import { createEnemyId, createShardId, EnemyId } from '../../models/common.model';
import { Asteroid } from '../../models/asteroid.model';
import { Shard, ShardType } from '../../models/projectile.model';
import { DischargeEffect } from '../../models/effects.model';
import {
  createEffectPool,
  createEnemyPool,
  createProjectilePool,
  ObjectPool,
  PooledEffect,
  PooledEnemy,
  PooledProjectile,
} from '../../utils/object-pool';

// Rendering interfaces
interface RenderingEnemy extends Omit<Enemy, 'id'> {
  id: number | EnemyId;
  health: number;
  maxHealth: number;
  color: string;
}

interface RenderingProjectile extends Omit<Projectile, 'id'> {
  id: number;
}

// Removed unused interfaces HazardZone and AimingProjection
// These are returned as inline types from their respective methods
import {
  AIControlledComponent,
  AsteroidComponent,
  BossPhaseComponent,
  ChargedProjectileComponent,
  DamageComponent,
  DeathAnimationComponent,
  DischargeEffectComponent,
  EnemyTypeComponent,
  HealthComponent,
  HitFlashComponent,
  KnockbackComponent,
  PositionComponent,
  PowerupComponent,
  ProjectileComponent,
  RenderableComponent,
  ShardComponent,
  ShieldArcComponent,
} from '@photon/components';
import { FactionComponent } from '@photon/components/faction.component';
import { AsteroidState, FallingAsteroidComponent } from '@photon/components/falling-asteroid.component';
import { ENVIRONMENT_CONFIG, MONITORING_CONFIG } from '@photon/config/game-constants';
import { PaletteService } from '../../../services/palette.service';

/**
 * System that bridges ECS update loop with the rendering pipeline
 * Ensures the game visuals are actually drawn to the canvas
 */
@Injectable({
  providedIn: 'root',
})
export class RenderingSystemService implements System {
  private static readonly EMPTY_PICKUP_EFFECTS: Array<{
    x: number;
    y: number;
    currentRadius: number;
    maxRadius: number;
    opacity: number;
  }> = [];

  private cameraState = {
    prevCameraX: undefined as number | undefined,
    prevCameraY: undefined as number | undefined,
  };

  // Object pools for performance
  private enemyPool: ObjectPool<PooledEnemy>;
  private projectilePool: ObjectPool<PooledProjectile>;
  private effectPool: ObjectPool<PooledEffect>;

  // Reusable arrays to avoid allocation per frame
  private enemiesArray: RenderingEnemy[] = [];
  private projectilesArray: RenderingProjectile[] = [];
  private shardsArray: Shard[] = [];
  private asteroidsArray: Asteroid[] = [];
  private dischargeEffectsArray: DischargeEffect[] = [];
  private deathEffectsArray: Array<{
    x: number;
    y: number;
    currentRadius: number;
    maxRadius: number;
    opacity: number;
  }> = [];
  // PERFORMANCE: Reusable array for trajectory points to avoid .map() + spread per frame
  private trajectoryPointsArray: Array<{ x: number; y: number; alpha: number }> = [];
  private hazardZonesArray: Array<{
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
  }> = [];
  private fallingAsteroidsArray: Array<{
    x: number;
    y: number;
    state: AsteroidState;
    size: number;
    impactRadius: number;
    warningProgress: number;
    fallProgress: number;
    health?: number;
    maxHealth?: number;
    rewardType?: 'speed' | 'damage' | 'shield' | 'regen' | 'crit' | 'xp_boost';
    isMega?: boolean;
  }> = [];

  constructor(
    private gameRendering: GameRenderingService,
    private gameEngine: GameEngineService,
    private player: PlayerService,
    private uiState: UIStateService,
    private aimingSystem: AimingSystemService,
    private floatingTextSystem: FloatingTextSystemService,
    private territoryVisualFeedback: TerritoryVisualFeedbackService,
    private debugLog: DebugLogBridgeService,
    private entityFactory: EntityFactoryECSService,
    private performanceMonitor: PerformanceMonitorService,
    private gameState: GameStateService,
    private settings: SettingsService,
    private paletteService: PaletteService
  ) {
    // Initialize object pools
    this.enemyPool = createEnemyPool();
    this.projectilePool = createProjectilePool();
    this.effectPool = createEffectPool();
  }

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    const measurePerformance = MONITORING_CONFIG.ENABLED && this.performanceMonitor.isDetailedTimingEnabledForFrame();
    const timer = measurePerformance ? this.performanceMonitor.startSystemTimer('RenderingSystem') : null;

    const issues: string[] = [];
    const canvas = this.gameEngine.getCanvas();
    const ctx = this.gameEngine.getContext();

    if (!canvas || !ctx) {
      issues.push('No canvas or context available');
      this.debugLog.log('RENDER_CYCLE:', 'error', {
        success: false,
        issues: issues,
        timestamp: Date.now(),
      });
      if (timer) {
        timer.end(0);
      }
      return;
    }

    // Set canvas for territory visual feedback (setCanvas already handles only setting once)
    this.territoryVisualFeedback.setCanvas(canvas);

    // Get player position
    const playerPos = this.player.getPosition();
    if (!playerPos) {
      issues.push('No player position available');

      // Log camera stuck issue
      this.debugLog.log('🚨 Camera Stuck - No Player Position', 'error', {
        source: 'rendering_system',
        playerService: !!this.player,
        timestamp: Date.now(),
      });
    }

    // Logical viewport size for full-screen fills + viewport culling. Only DIVERGE from the
    // device backing store when actually rendering sub-native (touch resolution scaling makes
    // canvas.width < the CSS size). On desktop the backing store is >= the logical size (DPR
    // capped at 2), so we keep the original device dims and every downstream op behaves EXACTLY
    // as before — desktop is byte-identical, the CSS-dim path is touch-only.
    const cssStyleW = parseFloat(canvas.style.width) || canvas.width;
    const cssStyleH = parseFloat(canvas.style.height) || canvas.height;
    const subNative = canvas.width < cssStyleW;
    const cssWidth = subNative ? cssStyleW : canvas.width;
    const cssHeight = subNative ? cssStyleH : canvas.height;

    // Prepare render context
    const renderContext = {
      canvas,
      ctx,
      playerX: playerPos.x,
      playerY: playerPos.y,
      worldWidth: this.gameEngine.getWorldWidth(),
      worldHeight: this.gameEngine.getWorldHeight(),
      cameraZoomScale: this.gameEngine.getCameraZoomScale(),
      cssWidth,
      cssHeight,
    };

    // Gather entities from ECS
    const gameEntities = {
      enemies: this.getEnemies(entityManager) as Enemy[],
      asteroids: this.getAsteroids(entityManager),
      projectiles: this.getProjectiles(entityManager) as Projectile[],
      shardsOnGround: this.getShards(entityManager),
      dischargeEffects: this.getDischargeEffects(entityManager),
      pickupEffects: this.getPickupEffects(entityManager),
      enemyDeathEffects: this.getDeathEffects(entityManager),
      aimingProjection: this.getAimingProjection(entityManager),
      playerChargeLevel: this.getPlayerChargeLevel(entityManager),
      hazardZones: this.getHazardZones(entityManager),
      fallingAsteroids: this.getFallingAsteroids(entityManager),
      // Visual feedback states for new mechanics
      isParrying: this.player.isParrying(),
      isChargingDischarge: this.player.isChargingDischarge(),
      dischargeChargeLevel: this.player.getDischargeChargeLevel(),
    };

    // Get UI state using signals directly
    const miniMapEnabled = this.uiState.miniMapEnabled();
    const fullMapEnabled = this.uiState.fullMapEnabled();

    // Fade boss phase flash each frame before sampling the signal value
    this.uiState.updateBossPhaseFlash();

    const uiStateData = {
      miniMapEnabled: miniMapEnabled,
      miniMapPosition: this.uiState.miniMapPosition(),
      miniMapScale: this.uiState.miniMapScale(),
      fullMapEnabled: fullMapEnabled,
      damageFlashIntensity: this.uiState.damageFlashIntensity(),
      bossPhaseFlashIntensity: this.uiState.bossPhaseFlashIntensity(),
      notifications: this.uiState.notifications(),
      tooltipText: this.uiState.tooltipText(),
      tooltipX: this.uiState.tooltipX(),
      tooltipY: this.uiState.tooltipY(),
      hoveredItem: null,
      // Only compute healthPercent if vignette is enabled (avoids rendering overhead)
      healthPercent:
        this.settings.getSettings().lowHealthVignette && this.gameState.getMaxHealth() > 0
          ? this.gameState.getHealth() / this.gameState.getMaxHealth()
          : 1,
    };

    // Check for burn spread (from curses/upgrades)
    const burnSpreadEnabled = true; // Sprint 28: always enabled — flame spread renders when burn is active

    // Validate UI state before rendering
    if (!this.uiState.miniMapEnabled()) {
      // This is normal, not an issue
    }

    // Perform the actual rendering
    const renderStart = measurePerformance ? window.performance.now() : 0;
    const { cameraX, cameraY } = this.gameRendering.render(
      renderContext,
      gameEntities,
      uiStateData,
      this.cameraState,
      burnSpreadEnabled,
      true, // smoothing enabled
      entityManager
    );
    if (measurePerformance) {
      this.performanceMonitor.recordRenderTime(window.performance.now() - renderStart);
    }

    // Render floating text (damage numbers, etc) on top of everything else
    if (ctx) {
      const camera = {
        x: cameraX,
        y: cameraY,
      };
      this.floatingTextSystem.renderFloatingText(ctx, camera, entityManager);

      // Render territory weakening effects
      this.territoryVisualFeedback.render(cameraX, cameraY);
    }

    // DEBUG: Log render cycle issues if any
    if (issues.length > 0) {
      this.debugLog.log('⚠️ Render Cycle Issues', 'warning', {
        source: 'render_cycle',
        success: false,
        issues: issues,
        entities: {
          enemies: gameEntities.enemies.length,
          asteroids: gameEntities.asteroids.length,
          projectiles: gameEntities.projectiles.length,
        },
        ui_state: {
          minimap_enabled: uiStateData.miniMapEnabled,
          fullmap_enabled: uiStateData.fullMapEnabled,
        },
      });
    }

    // Stop performance timer with actual entity count gathered during this frame
    const totalEntities =
      gameEntities.enemies.length + gameEntities.projectiles.length + gameEntities.shardsOnGround.length;
    if (timer) {
      timer.end(totalEntities);
    }
  }

  /**
   * Convert ECS enemies to rendering format
   */
  private getEnemies(entityManager: EntityManagerService): RenderingEnemy[] {
    // Release all previously pooled enemies
    this.enemyPool.releaseAll();

    // Clear and reuse existing array
    this.enemiesArray.length = 0;
    const enemyEntities = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);

    // Send enemy detection to debug bridge if available
    const now = Date.now();
    if (now - this.lastEnemyLogTime > 3000) {
      this.lastEnemyLogTime = now;
      this.debugLog.log('Enemy Detection', 'info', {
        source: 'enemy_detection',
        count: enemyEntities.length,
      });
    }

    for (const entityId of enemyEntities) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(entityId)) {
        continue;
      }

      // Skip dead enemies — death effects system handles their visual separately
      if (entityManager.hasComponent(entityId, DeathAnimationComponent)) {
        continue;
      }

      const position = entityManager.getComponent(entityId, PositionComponent);
      const enemyType = entityManager.getComponent(entityId, EnemyTypeComponent);
      const health = entityManager.getComponent(entityId, HealthComponent);
      const ai = entityManager.getComponent(entityId, AIControlledComponent);

      // Cache visual effect components (avoids per-enemy lookups during rendering)
      const knockback = entityManager.getComponent(entityId, KnockbackComponent);
      const hitFlash = entityManager.getComponent(entityId, HitFlashComponent);
      const faction = entityManager.getComponent(entityId, FactionComponent);

      if (position && enemyType) {
        // Get pooled enemy object
        const pooledEnemy = this.enemyPool.acquire();

        // Update pooled object properties
        pooledEnemy.x = position.x;
        pooledEnemy.y = position.y;
        pooledEnemy.vx = 0;
        pooledEnemy.vy = 0;
        pooledEnemy.type = enemyType.type;
        pooledEnemy.health = health?.health || 0;
        pooledEnemy.maxHealth = health?.maxHealth || 100;
        pooledEnemy.radius = this.getEnemyRadius(enemyType.type);
        pooledEnemy.color = this.getEnemyColor(enemyType.type);
        pooledEnemy.eliteStatus = enemyType.isElite || false;
        pooledEnemy.isChampion = enemyType.isChampion || false;

        // Add dancing properties for visual feedback
        pooledEnemy.isDancing = ai?.isDancing || false;
        pooledEnemy.danceStage = ai?.danceStage;
        pooledEnemy.spinAngle = ai?.spinAngle || 0;

        // Cache visual effect data (eliminates 4 component lookups per enemy during render)
        pooledEnemy.isKnockedBack = knockback?.isActive || false;
        pooledEnemy.hitFlashIntensity = hitFlash && !hitFlash.isExpired() ? hitFlash.getCurrentIntensity() : 0;
        pooledEnemy.factionId = faction?.kingId || 0;
        pooledEnemy.isInNpcCombat = ai?.npcBattleTargetId !== undefined;

        // Cache boss phase data for boss entities (drives the health-segment bar renderer)
        const bossPhase = entityManager.getComponent(entityId, BossPhaseComponent);
        if (bossPhase && health) {
          // Detect phase transition: trigger screen flash when phase number increases
          const prevPhase = this.bossLastPhase.get(entityId);
          if (prevPhase !== undefined && bossPhase.currentPhase > prevPhase) {
            // White flash on phase break — distinct from red damage flash
            this.uiState.triggerBossPhaseFlash();
          }
          this.bossLastPhase.set(entityId, bossPhase.currentPhase);

          pooledEnemy.bossPhaseData = {
            currentPhase: bossPhase.currentPhase,
            maxPhases: bossPhase.maxPhases,
            phaseThresholds: bossPhase.phaseThresholds,
            phaseTransitioning: bossPhase.phaseTransitioning,
            archetype: bossPhase.archetype,
          };
        } else {
          pooledEnemy.bossPhaseData = undefined;
        }

        // Cache shield arc data for sentinel entities (drives the shield arc overlay)
        const shieldArc = entityManager.getComponent(entityId, ShieldArcComponent);
        if (shieldArc) {
          pooledEnemy.shieldArcData = {
            facingAngle: shieldArc.facingAngle,
            halfArc: shieldArc.arcAngle / 2,
            lastBlockTime: shieldArc.lastBlockTime,
          };
        } else {
          pooledEnemy.shieldArcData = undefined;
        }

        // Set id directly on pooled object — no spread, no allocation
        (pooledEnemy as unknown as RenderingEnemy).id = createEnemyId(entityId);
        this.enemiesArray.push(pooledEnemy as unknown as RenderingEnemy);
      }
    }

    return this.enemiesArray;
  }

  private lastEnemyLogTime = 0;

  /** Tracks the last observed phase per boss entity so phase transitions can trigger a screen flash. */
  private bossLastPhase = new Map<number, number>();

  /**
   * Remove per-entity rendering state when an enemy dies.
   * Called by DeathDetectionSystemService.checkEnemyDeaths to prevent Map leak.
   */
  cleanupDeadEnemy(entityId: number): void {
    this.bossLastPhase.delete(entityId);
  }

  /**
   * Convert ECS projectiles to rendering format
   */
  private getProjectiles(entityManager: EntityManagerService): RenderingProjectile[] {
    // Release all previously pooled projectiles
    this.projectilePool.releaseAll();

    // Clear and reuse existing array
    this.projectilesArray.length = 0;
    const projectileEntities = entityManager.getEntitiesWithComponents(ProjectileComponent, PositionComponent);

    // Get theme-aware fallback color
    const canvasColors = this.paletteService.getCanvas();

    // PERF: hoist performance.now() once for the entire projectile loop — avoids a
    // repeated OS call (~0.1–0.5 µs each) for spawnTime and getPulseGlow per projectile.
    const nowPerf = window.performance.now();

    for (const entityId of projectileEntities) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(entityId)) {
        continue;
      }

      const position = entityManager.getComponent(entityId, PositionComponent);
      const projectile = entityManager.getComponent(entityId, ProjectileComponent);
      const chargedProjectile = entityManager.getComponent(entityId, ChargedProjectileComponent);

      if (position && projectile) {
        const baseRadius = 5;
        const isCharged = chargedProjectile?.isCharged || false;
        const chargeLevel = chargedProjectile?.chargeLevel || 0;

        // Get pooled projectile object
        const pooledProj = this.projectilePool.acquire();

        // Update pooled object properties
        pooledProj.id = entityId;
        pooledProj.x = position.x;
        pooledProj.y = position.y;
        pooledProj.vx = 0;
        pooledProj.vy = 0;
        pooledProj.speed = 100;
        pooledProj.lifetime = 5000;
        pooledProj.damage = projectile.damage;
        pooledProj.spawnTime = nowPerf;
        pooledProj.health = 1;
        pooledProj.radius = baseRadius * (chargedProjectile?.getSizeMultiplier() || 1);
        pooledProj.isCharged = isCharged;
        pooledProj.chargeLevel = chargeLevel;
        pooledProj.color = chargedProjectile?.getCurrentColor() || canvasColors.ACCENT_CYAN;
        pooledProj.glowIntensity = chargedProjectile?.getPulseGlow(nowPerf) || 0;
        pooledProj.shouldEmitTrail = chargedProjectile?.shouldEmitTrail() || false;
        if (pooledProj.trailData.points) pooledProj.trailData.points.length = 0;
        else pooledProj.trailData.points = [];

        this.projectilesArray.push(pooledProj);
      }
    }

    return this.projectilesArray;
  }

  /**
   * Get shards from ECS
   */
  private getShards(entityManager: EntityManagerService): Shard[] {
    const shardEntities = entityManager.getEntitiesWithComponents(ShardComponent, PositionComponent);

    // Get theme-aware fallback colors
    const canvasColors = this.paletteService.getCanvas();

    let writeIndex = 0;

    for (const entityId of shardEntities) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(entityId)) {
        continue;
      }

      const position = entityManager.getComponent(entityId, PositionComponent);
      const shard = entityManager.getComponent(entityId, ShardComponent);

      if (position && shard) {
        // ALWAYS use theme-aware color at render time to ensure shards match current theme
        // This handles theme changes mid-game (shards created in dark mode shown in light mode)
        const value = shard.value;
        const shardColor =
          value > 5 ? canvasColors.SHARD_HIGH : value > 2 ? canvasColors.SHARD_MED : canvasColors.SHARD_LOW;

        // Reuse existing array slot or grow — avoids per-shard object allocation each frame
        let entry: Shard;
        if (writeIndex < this.shardsArray.length) {
          entry = this.shardsArray[writeIndex];
        } else {
          entry = {} as Shard;
          this.shardsArray.push(entry);
        }

        entry.id = createShardId(entityId);
        entry.x = position.x;
        entry.y = position.y;
        entry.vx = 0;
        entry.vy = 0;
        entry.radius = Math.min(4 + value * 0.5, 8);
        entry.spawnTime = shard.spawnTime;
        entry.value = shard.value;
        entry.color = shardColor;
        entry.glowPhase = shard.glowPhase;
        entry.isBeingAttracted = shard.isBeingAttracted;
        entry.attractionDistance = shard.attractionDistance;
        entry.type = ShardType.Normal;

        writeIndex++;
      }
    }

    // Trim to actual count so stale entries from a previous larger frame are not rendered
    this.shardsArray.length = writeIndex;

    return this.shardsArray;
  }

  /**
   * Get asteroids from ECS
   */
  private getAsteroids(entityManager: EntityManagerService): Asteroid[] {
    const asteroidEntities = entityManager.getEntitiesWithComponents(AsteroidComponent, PositionComponent);

    let writeIndex = 0;

    for (const entityId of asteroidEntities) {
      const position = entityManager.getComponent(entityId, PositionComponent);
      const asteroid = entityManager.getComponent(entityId, AsteroidComponent);
      const health = entityManager.getComponent(entityId, HealthComponent);

      if (position && asteroid) {
        // Reuse existing array slot or grow — avoids per-asteroid object allocation each frame
        let entry: Asteroid;
        if (writeIndex < this.asteroidsArray.length) {
          entry = this.asteroidsArray[writeIndex];
        } else {
          entry = {} as Asteroid;
          this.asteroidsArray.push(entry);
        }

        entry.id = entityId;
        entry.x = position.x;
        entry.y = position.y;
        entry.width = asteroid.size * 2;
        entry.height = asteroid.size * 2;
        entry.type = asteroid.size > 40 ? 'large' : 'medium';
        entry.color = '#8B7355';
        entry.isDiscovered = false;
        entry.health = health?.health || asteroid.health;
        entry.maxHealth = health?.maxHealth || asteroid.health;
        entry.vx = 0;
        entry.vy = 0;

        writeIndex++;
      }
    }

    // Trim to actual count so stale entries from a previous larger frame are not rendered
    this.asteroidsArray.length = writeIndex;

    return this.asteroidsArray;
  }

  /**
   * Get discharge effects from ECS
   */
  private getDischargeEffects(entityManager: EntityManagerService): DischargeEffect[] {
    const effectEntities = entityManager.getEntitiesWithComponents(DischargeEffectComponent, PositionComponent);

    // Get theme-aware effect color
    const canvasColors = this.paletteService.getCanvas();
    const effectColor = canvasColors.EFFECT_COLOR;

    let writeIndex = 0;

    // PERF: hoist performance.now() once for the entire discharge loop — avoids a
    // repeated OS call per active discharge effect when computing startTime.
    const nowPerfDischarge = window.performance.now();

    for (const entityId of effectEntities) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(entityId)) {
        continue;
      }

      const position = entityManager.getComponent(entityId, PositionComponent);
      const discharge = entityManager.getComponent(entityId, DischargeEffectComponent);

      if (position && discharge && !discharge.isExpired()) {
        // Reuse existing array slot or grow — avoids per-effect object allocation each frame
        let entry: DischargeEffect;
        if (writeIndex < this.dischargeEffectsArray.length) {
          entry = this.dischargeEffectsArray[writeIndex];
        } else {
          entry = {} as DischargeEffect;
          this.dischargeEffectsArray.push(entry);
        }

        entry.x = position.x;
        entry.y = position.y;
        entry.radius = discharge.radius;
        entry.currentRadius = discharge.radius;
        entry.maxRadius = discharge.maxRadius;
        entry.startTime = nowPerfDischarge - discharge.elapsed * 1000;
        entry.duration = discharge.duration * 1000;
        entry.color = effectColor;

        writeIndex++;
      }
    }

    // Trim to actual count so stale entries from a previous larger frame are not rendered
    this.dischargeEffectsArray.length = writeIndex;

    return this.dischargeEffectsArray;
  }

  /**
   * Get pickup effects
   */
  private getPickupEffects(
    _entityManager: EntityManagerService
  ): Array<{ x: number; y: number; currentRadius: number; maxRadius: number; opacity: number }> {
    return RenderingSystemService.EMPTY_PICKUP_EFFECTS;
  }

  /**
   * Get death effects
   */
  private getDeathEffects(
    entityManager: EntityManagerService
  ): Array<{ x: number; y: number; currentRadius: number; maxRadius: number; opacity: number }> {
    // Release all previously pooled effects
    this.effectPool.releaseAll();

    // Clear and reuse existing array
    this.deathEffectsArray.length = 0;
    const deathEntities = entityManager.getEntitiesWithComponents(DeathAnimationComponent, PositionComponent);

    for (const entityId of deathEntities) {
      const position = entityManager.getComponent(entityId, PositionComponent);
      const deathAnim = entityManager.getComponent(entityId, DeathAnimationComponent);

      if (position && deathAnim && !deathAnim.isComplete()) {
        const progress = deathAnim.getProgress();
        const opacity = deathAnim.getCurrentOpacity();
        const scale = deathAnim.getCurrentScale();
        const baseRadius = 30; // Base radius for death effect
        const maxRadius = baseRadius * 2;
        const currentRadius = baseRadius + (maxRadius - baseRadius) * progress * scale;

        // Get pooled effect object
        const pooledEffect = this.effectPool.acquire();
        pooledEffect.x = position.x;
        pooledEffect.y = position.y;
        pooledEffect.currentRadius = currentRadius;
        pooledEffect.maxRadius = maxRadius;
        pooledEffect.opacity = opacity;

        this.deathEffectsArray.push(pooledEffect);
      }
    }

    return this.deathEffectsArray;
  }

  /**
   * Get enemy radius based on type
   */
  private getEnemyRadius(type: string): number {
    switch (type) {
      case 'basic':
        return 20;
      case 'spitter':
        return 18;
      case 'tank':
        return 30;
      case 'swarm':
        return 15;
      case 'thug':
        return 25;
      case 'sniper':
        return 22;
      case 'boss':
        return 40;
      default:
        return 20;
    }
  }

  /**
   * Get enemy color based on type - REMOVED HARDCODED COLORS
   * Now returns neutral color since actual rendering uses faction sprites
   */
  private getEnemyColor(_type: string): string {
    // IMPORTANT: Return neutral gray since the actual rendering uses
    // faction-colored sprites from FactionEnemyRendererService.
    // This color is only used for legacy systems and fallback cases.
    return '#999999';
  }

  /**
   * Get aiming projection data for rendering
   */
  private getAimingProjection(entityManager: EntityManagerService): {
    line: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
    points: Array<{ x: number; y: number; alpha: number }>;
    isActive: boolean;
  } {
    const trajectoryLine = this.aimingSystem.getTrajectoryLine(entityManager);
    const trajectoryPoints = this.aimingSystem.getTrajectoryPoints(entityManager);

    // PERFORMANCE: Reuse array + for-loop instead of .map() + spread per frame
    const points = this.trajectoryPointsArray;
    points.length = 0;
    if (trajectoryPoints && trajectoryPoints.length > 0) {
      const divisor = trajectoryPoints.length - 1 || 1;
      for (let i = 0; i < trajectoryPoints.length; i++) {
        const pt = trajectoryPoints[i];
        points.push({ x: pt.x, y: pt.y, alpha: 1 - (i / divisor) * 0.7 });
      }
    }

    return {
      line: trajectoryLine || null,
      points,
      isActive: trajectoryLine !== null || (trajectoryPoints && trajectoryPoints.length > 0),
    };
  }

  /**
   * Get player charge level for rendering from dual bucket system
   */
  private getPlayerChargeLevel(_entityManager: EntityManagerService): number {
    // Charge level not surfaced to renderer in beam mode (the only active mode); retained for future projectile mode.
    return 0;
  }

  /**
   * Get hazard zones for rendering.
   * @returns A reusable array reference — consume synchronously within the same frame.
   *          The array is cleared on the next call via `.length = 0`.
   */
  private getHazardZones(entityManager: EntityManagerService): Array<{
    id: number;
    x: number;
    y: number;
    radius: number;
    color: string;
    opacity: number;
    damagePerSecond: number;
  }> {
    // Clear and reuse existing array
    this.hazardZonesArray.length = 0;
    const hazardEntities = entityManager.getEntitiesWithComponents(
      PositionComponent,
      RenderableComponent,
      DamageComponent
    );

    for (const entityId of hazardEntities) {
      const position = entityManager.getComponent(entityId, PositionComponent);
      const renderable = entityManager.getComponent(entityId, RenderableComponent);
      const damage = entityManager.getComponent(entityId, DamageComponent);

      // Check if this is a hazard zone (background layer with damage)
      if (position && renderable && damage && renderable.renderLayer === 'background') {
        this.hazardZonesArray.push({
          id: entityId,
          x: position.x,
          y: position.y,
          radius: ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS,
          color: '#ff4444',
          opacity: 0.5,
          damagePerSecond: damage.contactDamage,
        });
      }
    }

    // Also include powerup zones (have PowerupComponent instead of DamageComponent)
    const powerupEntities = entityManager.getEntitiesWithComponents(
      PositionComponent,
      RenderableComponent,
      PowerupComponent
    );

    for (const entityId of powerupEntities) {
      const position = entityManager.getComponent(entityId, PositionComponent);
      const renderable = entityManager.getComponent(entityId, RenderableComponent);
      const powerup = entityManager.getComponent(entityId, PowerupComponent);

      if (position && renderable && powerup) {
        this.hazardZonesArray.push({
          id: entityId,
          x: position.x,
          y: position.y,
          radius: ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS,
          color: renderable.color,
          opacity: renderable.opacity,
          damagePerSecond: 0,
          isActive: powerup.isActive,
          multiplier: powerup.value,
          powerupType: powerup.type,
        });
      }
    }

    return this.hazardZonesArray;
  }

  /**
   * Get falling asteroids for special rendering.
   * @returns A reusable array reference — consume synchronously within the same frame.
   *          The array is cleared on the next call via `.length = 0`.
   */
  private getFallingAsteroids(entityManager: EntityManagerService): Array<{
    x: number;
    y: number;
    state: AsteroidState;
    size: number;
    impactRadius: number;
    warningProgress: number;
    fallProgress: number;
    health?: number;
    maxHealth?: number;
    rewardType?: 'speed' | 'damage' | 'shield' | 'regen' | 'crit' | 'xp_boost';
    isMega?: boolean;
  }> {
    // Clear and reuse existing array
    this.fallingAsteroidsArray.length = 0;

    const asteroidEntities = entityManager.getEntitiesWithComponents(FallingAsteroidComponent, PositionComponent);

    const currentTime = Date.now();

    for (const entityId of asteroidEntities) {
      const position = entityManager.getComponent(entityId, PositionComponent);
      const fallingAsteroid = entityManager.getComponent(entityId, FallingAsteroidComponent);
      const health = entityManager.getComponent(entityId, HealthComponent);

      if (position && fallingAsteroid) {
        // Skip destroyed asteroids - they should not be rendered
        if (fallingAsteroid.state === AsteroidState.DESTROYED) {
          continue;
        }

        // Also skip landed asteroids with 0 health (being collected)
        if (fallingAsteroid.state === AsteroidState.LANDED && health && health.health <= 0) {
          continue;
        }

        let warningProgress = 0;
        let fallProgress = 0;

        if (fallingAsteroid.state === AsteroidState.WARNING) {
          warningProgress = Math.min((currentTime - fallingAsteroid.warningStartTime) / 2000, 1);
        } else if (fallingAsteroid.state === AsteroidState.FALLING) {
          fallProgress = Math.min((currentTime - fallingAsteroid.fallStartTime) / 1500, 1);
        }

        this.fallingAsteroidsArray.push({
          x: position.x,
          y: position.y,
          state: fallingAsteroid.state,
          rewardType: fallingAsteroid.rewardType,
          size: fallingAsteroid.size,
          impactRadius: fallingAsteroid.impactRadius,
          warningProgress,
          fallProgress,
          health: health?.health,
          maxHealth: health?.maxHealth,
          isMega: fallingAsteroid.isMega,
        });
      }
    }

    return this.fallingAsteroidsArray;
  }

  /**
   * Get object pool statistics for performance monitoring
   */
  getPoolStats(): { enemy: { reuseRate: number }; projectile: { reuseRate: number }; effect: { reuseRate: number } } {
    return {
      enemy: this.enemyPool.getStats(),
      projectile: this.projectilePool.getStats(),
      effect: this.effectPool.getStats(),
    };
  }

  /** Drop per-session entity state while retaining the reusable object pools. */
  reset(): void {
    this.enemyPool.releaseAll();
    this.projectilePool.releaseAll();
    this.effectPool.releaseAll();
    this.enemiesArray.length = 0;
    this.projectilesArray.length = 0;
    this.shardsArray.length = 0;
    this.asteroidsArray.length = 0;
    this.dischargeEffectsArray.length = 0;
    this.deathEffectsArray.length = 0;
    this.trajectoryPointsArray.length = 0;
    this.hazardZonesArray.length = 0;
    this.fallingAsteroidsArray.length = 0;
    this.bossLastPhase.clear();
    this.cameraState.prevCameraX = undefined;
    this.cameraState.prevCameraY = undefined;
    this.lastEnemyLogTime = 0;
  }

  /**
   * Log pool performance to console
   */
  logPoolPerformance(): void {
    const stats = this.getPoolStats();
    const totalReuseRate = (
      ((stats.enemy.reuseRate + stats.projectile.reuseRate + stats.effect.reuseRate) / 3) *
      100
    ).toFixed(1);

    this.debugLog.log('🏊 Object Pool Performance', 'info', {
      source: 'rendering_system',
      operation: 'pool_performance',
      enemyPool: stats.enemy,
      projectilePool: stats.projectile,
      effectPool: stats.effect,
      totalReuseRate: totalReuseRate + '%',
    });
  }
}
