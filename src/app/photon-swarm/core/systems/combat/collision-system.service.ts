import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { Subject } from 'rxjs';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PlayerService } from '../../player/player.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { GameStateService } from '../../state/game-state.service';
import { SettingsService } from '../../utils/settings.service';
// import { CameraShakeService } from '../../effects/camera-shake.service'; // Removed - no screen shake per user request
import { PostProcessingService } from '../../effects/post-processing.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { CurseService } from '../../../services/curse.service';
import { AchievementService } from '../../../services/achievement.service';
import { DifficultyService } from '../../../services/difficulty.service';
import { ActiveBuff, BuffManagementSystemService, FactionStandingSystemService } from '../gameplay';
import { BuffSystemService } from '../../progression/buff-system.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { AudioService } from '../../audio/audio.service';
import { AscensionService } from '../../../services/ascension.service';
import { DamageResolverService } from '../../combat/damage-resolver.service';
import {
  BEAM_REFLECTION,
  DAMAGE_CONFIG,
  FOCUS_CHARGING_CONFIG,
  IS_PRODUCTION,
  MEMORY_CONFIG,
  MONITORING_CONFIG,
  PLAYER_CONFIG,
  PoolType,
  WORLD_CONFIG,
} from '@photon/config/game-constants';

const IMPACT_CONFIG = PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.VISUALS.IMPACT;
const HIT_FLASH_CONFIG = PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.VISUALS.HIT_FLASH;
import { SpatialEntity, SpatialGrid } from '../../utils/spatial-grid';
import {
  AsteroidState,
  BuffComponent,
  ChargedProjectileComponent,
  CollisionBoxComponent,
  DamageComponent,
  EnemyTypeComponent,
  FactionComponent,
  FallingAsteroidComponent,
  HealthBarDisplayComponent,
  HealthComponent,
  HitFlashComponent,
  PlayerControlledComponent,
  PositionComponent,
  ProjectileComponent,
  RenderableComponent,
  ShardComponent,
  SourceTagComponent,
  VelocityComponent,
} from '@photon/components';

/**
 * Collision event data
 */
export interface CollisionEvent {
  entityA: number;
  entityB: number;
  type: 'player-enemy' | 'player-projectile' | 'beam-enemy' | 'projectile-enemy' | 'player-shard';
  damage?: number;
  position: { x: number; y: number };
  timestamp: number;
}

/**
 * Spatial partitioning configuration
 */
interface SpatialConfig {
  cellSize: number;
  worldWidth: number;
  worldHeight: number;
}

/**
 * Collision rules lookup table — hoisted out of shouldEntitiesCollide to avoid
 * allocating a new object on every call (called once per potential pair per frame).
 */
const COLLISION_RULES: Readonly<Record<string, readonly string[]>> = {
  player: ['enemy', 'projectile', 'shard', 'asteroid'],
  enemy: ['player', 'projectile'],
  projectile: ['player', 'enemy', 'asteroid'],
  shard: ['player'],
  asteroid: ['player', 'projectile'],
};

/**
 * Entity with spatial properties for collision detection
 */
interface SpatialCollisionEntity extends SpatialEntity {
  entityId: number;
  type: 'player' | 'enemy' | 'projectile' | 'shard' | 'asteroid';
  collisionGroup: CollisionBoxComponent['collisionGroup'];
  collidesWith: string[];
}

/**
 * ECS CollisionSystem - handles all collision detection and resolution
 *
 * Features:
 * - Spatial partitioning for performance optimization
 * - Component-based collision groups
 * - Event-driven collision notifications
 * - Damage application integration
 *
 * CLEAN ARCHITECTURE - Health Management:
 * - GameStateService is the single authoritative source for health
 * - Collision system calls gameState.takeDamage() to apply damage
 * - ECS HealthComponent is synced FROM GameState for rendering
 * - One-way data flow: Collision → GameState → ECS Component
 */
@Injectable({
  providedIn: 'root',
})
export class CollisionSystemService implements System {
  private spatialConfig: SpatialConfig = {
    cellSize: 200, // Optimized for average entity size, reduces cell checks by 3x
    worldWidth: WORLD_CONFIG.BOUNDS.WIDTH,
    worldHeight: WORLD_CONFIG.BOUNDS.HEIGHT,
  };

  // Optimized spatial grid
  private spatialGrid: SpatialGrid<SpatialCollisionEntity>;

  // Pre-allocated array for spatial entities (prevents per-frame allocation)
  private spatialEntities: SpatialCollisionEntity[] = [];
  private readonly spatialEntityPool: SpatialCollisionEntity[] = [];

  constructor(
    private effectFactory: EffectFactoryService,
    private entityFactory: EntityFactoryECSService,
    private playerService: PlayerService,
    private playerUpgrades: PlayerUpgradesService,
    private gameState: GameStateService,
    private settings: SettingsService,
    // private cameraShake: CameraShakeService, // Removed - no screen shake per user request
    private postProcessing: PostProcessingService,
    private debugLog: DebugLogBridgeService,
    private progressionSystem: ProgressionSystemService,
    private performanceMonitor: PerformanceMonitorService,
    private curseService: CurseService,
    private factionStandingSystem: FactionStandingSystemService,
    private errorHandler: ErrorHandlerService,
    private buffManagement: BuffManagementSystemService,
    private audio: AudioService,
    private ascensionService: AscensionService,
    private achievementService: AchievementService,
    private difficultyService: DifficultyService,
    private damageResolver: DamageResolverService,
    private buffSystem: BuffSystemService
  ) {
    // Initialize spatial grid
    this.spatialGrid = new SpatialGrid<SpatialCollisionEntity>(
      this.spatialConfig.worldWidth,
      this.spatialConfig.worldHeight,
      this.spatialConfig.cellSize
    );
  }

  // Event streams
  private collisionSubject = new Subject<CollisionEvent>();
  public collision$ = this.collisionSubject.asObservable();

  // Performance tracking
  private collisionChecks = 0;
  private collisionsDetected = 0;

  // Collision immunity tracking - using WeakMap to prevent memory leaks
  private readonly COLLISION_IMMUNITY_DURATION = DAMAGE_CONFIG.COLLISION_IMMUNITY_DURATION_MS;
  private lastCollisionTime = new Map<string, number>(); // Still use Map but with aggressive cleanup
  private lastPlayerDamageTime = 0; // Uses performance.now() for more precise timing
  private readonly PLAYER_DAMAGE_IMMUNITY_MS = DAMAGE_CONFIG.PLAYER_DAMAGE_IMMUNITY_MS;

  // Frame-based collision tracking to prevent duplicates in same frame
  private frameCollisions = new Set<string>();
  private lastFrameId = -1;

  // Immunity state tracking to reduce log spam - auto-cleanup with collision map
  private immunityStateMap = new Map<string, boolean>(); // Track if we've already logged immunity start
  private playerDamageImmunityLogged = false; // Track if we've logged player damage immunity
  private playerInvincibilityLogged = false; // Track if we've logged player invincibility
  private dashInvincibilityLogged = false; // Track if we've logged dash invincibility

  // Cleanup tracking
  private lastCleanupTime = window.performance.now();
  private readonly CLEANUP_INTERVAL_MS = MEMORY_CONFIG.COLLISION_IMMUNITY.CLEANUP_INTERVAL_MS;
  private readonly MAX_MAP_SIZE = MEMORY_CONFIG.COLLISION_IMMUNITY.MAX_MAP_SIZE;

  // Frame-based damage cap tracking
  private frameId = 0;
  private frameDamageDealt = 0;
  private readonly MAX_DAMAGE_PER_FRAME = DAMAGE_CONFIG.MAX_DAMAGE_PER_FRAME;

  // Performance metrics
  private damageCapHitCount = 0;
  private lastCapMetricsLog = 0; // Uses Date.now() for frame-relative timing
  private frameStartTime = 0;
  private frameCount = 0;

  // Track last faction that damaged the player (for death attribution)
  private lastPlayerDamageSource: { factionId: number; timestamp: number } | null = null;

  // Charged impact performance tracking
  private chargedImpactStats = {
    totalImpacts: 0,
    highChargeImpacts: 0,
    shakesTriggered: 0,
    chromaticTriggered: 0,
  };
  private readonly CHARGED_STATS_INTERVAL = 30000; // Report every 30 seconds

  // Damage number throttling for player damage (prevents spam in multi-enemy scenarios)
  private playerDamageNumbersThisFrame = 0;
  private readonly MAX_PLAYER_DAMAGE_NUMBERS_PER_FRAME = 3; // Limit visual clutter

  // Projectile pooling metrics
  private projectilesPooledCount = 0;
  private lastPoolingReportTime = 0;

  // Offensive Dash tracking - enemies hit during current dash
  private dashHitEnemies = new Set<number>();
  private lastDashState = false;

  /**
   * Initialize the collision system
   */
  init(): void {
    // System initialization complete - no logging needed
    this.clearSpatialGrid();
  }

  /**
   * Clear the spatial grid
   */
  private clearSpatialGrid(): void {
    this.spatialGrid.clear();
  }

  /**
   * Clean up old collision immunity entries - prevents memory leak
   * Called periodically and when map size exceeds threshold
   */
  // Pre-allocated buffers for cleanup to avoid per-call allocations
  private cleanupKeysBuffer: string[] = [];
  private cleanupEntriesBuffer: Array<[string, number]> = [];
  private cleanupExpiredSet = new Set<string>();

  private cleanupCollisionImmunity(): void {
    const currentTime = window.performance.now();
    const keysToRemove = this.cleanupKeysBuffer;
    keysToRemove.length = 0;
    const immunityExpiredTime = this.COLLISION_IMMUNITY_DURATION + MEMORY_CONFIG.COLLISION_IMMUNITY.EXPIRY_BUFFER_MS;

    // Clean up expired entries
    for (const [key, lastTime] of this.lastCollisionTime.entries()) {
      if (currentTime - lastTime > immunityExpiredTime) {
        keysToRemove.push(key);
      }
    }

    // If still too large after expiry cleanup, aggressively remove oldest entries
    // This prevents unbounded growth during intense gameplay with many entities
    const remainingSize = this.lastCollisionTime.size - keysToRemove.length;
    if (remainingSize > this.MAX_MAP_SIZE) {
      // Build a reusable set of expired keys for O(1) lookup
      this.cleanupExpiredSet.clear();
      for (let j = 0; j < keysToRemove.length; j++) {
        this.cleanupExpiredSet.add(keysToRemove[j]);
      }
      const remaining = this.cleanupEntriesBuffer;
      remaining.length = 0;

      for (const entry of this.lastCollisionTime.entries()) {
        if (!this.cleanupExpiredSet.has(entry[0])) {
          remaining.push(entry);
        }
      }

      // Sort remaining by timestamp ascending (oldest first)
      remaining.sort((a, b) => a[1] - b[1]);

      // Remove oldest entries until we're under the limit
      const toRemove = remainingSize - this.MAX_MAP_SIZE;
      for (let i = 0; i < toRemove && i < remaining.length; i++) {
        keysToRemove.push(remaining[i][0]);
      }
    }

    // Batch remove for performance
    for (let i = 0; i < keysToRemove.length; i++) {
      this.lastCollisionTime.delete(keysToRemove[i]);
      this.immunityStateMap.delete(keysToRemove[i]);
    }

    if (keysToRemove.length > 0 && !IS_PRODUCTION) {
      this.debugLog.log(`Cleaned up ${keysToRemove.length} expired collision immunity entries`, 'info');
    }
  }

  /**
   * Main system update - performs collision detection
   */
  update(_deltaTime: number, entityManager: EntityManager): void {
    // Start performance timer (only in development)
    const timer = MONITORING_CONFIG.ENABLED ? this.performanceMonitor.startSystemTimer('CollisionSystem') : null;

    // Reset performance counters
    this.collisionChecks = 0;
    this.collisionsDetected = 0;

    // Reset frame damage tracking for new frame
    this.frameId = (this.frameId + 1) % Number.MAX_SAFE_INTEGER;
    this.frameDamageDealt = 0;
    this.playerDamageNumbersThisFrame = 0; // Reset player damage number counter

    // CRITICAL FIX: Clear frame collision tracking for new frame
    // This ensures duplicate collision prevention resets each frame
    if (this.frameId !== this.lastFrameId) {
      this.frameCollisions.clear();
      this.lastFrameId = this.frameId;
    }

    // Track frame count for accurate metrics
    if (this.frameStartTime === 0) {
      this.frameStartTime = Date.now();
    }
    this.frameCount++;

    // Offensive Dash: Clear hit tracking when dash ends
    const currentDashState = this.playerService.isDashing();
    if (this.lastDashState && !currentDashState) {
      // Dash just ended - clear the set of hit enemies
      this.dashHitEnemies.clear();
    }
    this.lastDashState = currentDashState;

    // Perform collision detection with integrated spatial grid rebuild
    this.detectCollisionsOptimized(entityManager);

    // Clean up old collision immunity entries periodically to prevent memory leak
    const currentTime = window.performance.now();
    const shouldCleanup =
      currentTime - this.lastCleanupTime > this.CLEANUP_INTERVAL_MS || this.lastCollisionTime.size > this.MAX_MAP_SIZE;

    // Force immediate cleanup if map size exceeds 150% of max size (emergency threshold)
    const isEmergency = this.lastCollisionTime.size > this.MAX_MAP_SIZE * 1.5;

    if (shouldCleanup || isEmergency) {
      this.cleanupCollisionImmunity();
      this.lastCleanupTime = currentTime;
    }

    // Stop performance timer and record metrics
    if (timer) {
      timer.end(this.collisionChecks);
    }

    // Report charged impact stats periodically
    if (
      this.chargedImpactStats.totalImpacts > 0 &&
      currentTime - this.lastCapMetricsLog > this.CHARGED_STATS_INTERVAL
    ) {
      this.reportChargedImpactStats();
    }

    // Report projectile pooling stats periodically
    if (this.projectilesPooledCount > 0 && currentTime - this.lastPoolingReportTime > this.CHARGED_STATS_INTERVAL) {
      this.lastPoolingReportTime = currentTime;
      this.reportPoolingStats();
    }
    if (
      DAMAGE_CONFIG.DAMAGE_CAP_METRICS.TRACK_CAP_HITS &&
      currentTime - this.lastCapMetricsLog > DAMAGE_CONFIG.DAMAGE_CAP_METRICS.METRICS_LOG_INTERVAL_MS
    ) {
      this.lastCapMetricsLog = currentTime;
      if (this.damageCapHitCount > 0) {
        this.debugLog.log('📊 Damage Cap Metrics (60s)', 'info', {
          source: 'collision_metrics',
          damageCapHits: this.damageCapHitCount,
          framesProcessed: this.frameCount,
          capHitRate:
            this.frameCount > 0 ? ((this.damageCapHitCount / this.frameCount) * 100).toFixed(2) + '%' : '0.00%',
          avgFps:
            this.frameCount > 0 && currentTime > this.frameStartTime
              ? Math.round(this.frameCount / ((currentTime - this.frameStartTime) / 1000))
              : 0,
        });
      }
    }
  }

  /**
   * Set world bounds for spatial partitioning
   */
  setWorldBounds(width: number, height: number): void {
    this.spatialConfig.worldWidth = width;
    this.spatialConfig.worldHeight = height;
  }

  /**
   * Optimized collision detection - combines spatial grid rebuild with collision checks
   * Eliminates double iteration over all entities
   */
  private detectCollisionsOptimized(entityManager: EntityManager): void {
    // Clear the spatial grid
    this.spatialGrid.clear();

    // Get all collision entities
    const collisionEntities = entityManager.getEntitiesWithComponents(PositionComponent, CollisionBoxComponent);

    // Reset pre-allocated array instead of creating a new one each frame
    this.spatialEntities.length = 0;

    // Build spatial entities array AND populate grid in single pass
    for (const entityId of collisionEntities) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(entityId)) {
        continue;
      }

      // Use safe component access to prevent crashes during entity lifecycle changes
      const position = this.errorHandler.safeGetComponent(
        entityManager,
        entityId,
        PositionComponent,
        'SPATIAL_GRID_POSITION'
      );
      const collisionBox = this.errorHandler.safeGetComponent(
        entityManager,
        entityId,
        CollisionBoxComponent,
        'SPATIAL_GRID_COLLISION'
      );

      // Skip if components are missing
      if (!position || !collisionBox) {
        continue;
      }

      // Determine entity type
      let type: 'player' | 'enemy' | 'projectile' | 'shard' | 'asteroid' = 'enemy';
      if (entityManager.hasComponent(entityId, PlayerControlledComponent)) {
        type = 'player';
      } else if (entityManager.hasComponent(entityId, ProjectileComponent)) {
        type = 'projectile';
      } else if (entityManager.hasComponent(entityId, ShardComponent)) {
        type = 'shard';
      } else if (entityManager.hasComponent(entityId, FallingAsteroidComponent)) {
        // Only landed asteroids participate in collision
        const fallingAsteroid = entityManager.getComponent(entityId, FallingAsteroidComponent);
        if (fallingAsteroid && fallingAsteroid.state === AsteroidState.LANDED) {
          type = 'asteroid';
        } else {
          continue; // Skip non-landed asteroids
        }
      }

      // Reuse the record at this active index. The pool grows only to the
      // session's high-water mark instead of allocating one object per entity/frame.
      const spatialIndex = this.spatialEntities.length;
      let spatialEntity = this.spatialEntityPool[spatialIndex];
      if (!spatialEntity) {
        spatialEntity = {
          id: entityId,
          entityId,
          x: position.x,
          y: position.y,
          radius: collisionBox.radius,
          type,
          collisionGroup: collisionBox.collisionGroup,
          collidesWith: collisionBox.collidesWith,
        };
        this.spatialEntityPool.push(spatialEntity);
      } else {
        spatialEntity.id = entityId;
        spatialEntity.entityId = entityId;
        spatialEntity.x = position.x;
        spatialEntity.y = position.y;
        spatialEntity.radius = collisionBox.radius;
        spatialEntity.type = type;
        spatialEntity.collisionGroup = collisionBox.collisionGroup;
        spatialEntity.collidesWith = collisionBox.collidesWith;
      }

      // Add to array AND spatial grid in single pass
      this.spatialEntities.push(spatialEntity);
      this.spatialGrid.insert(spatialEntity);
    }

    // Get potential collision pairs using spatial grid
    const potentialPairs = this.spatialGrid.getPotentialPairs(this.spatialEntities);

    // Check each potential pair
    for (const [entityA, entityB] of potentialPairs) {
      // SpatialGrid has already confirmed the circular overlap. Only collision
      // group/source rules remain before resolution.
      if (this.shouldEntitiesCollide(entityA, entityB, entityManager)) {
        this.handleCollision(entityA.entityId, entityB.entityId, entityManager);
      }

      this.collisionChecks++;
    }
  }

  /**
   * Check if two entities should be tested for collision based on their collision groups
   */
  private shouldEntitiesCollide(
    entityA: SpatialCollisionEntity,
    entityB: SpatialCollisionEntity,
    entityManager: EntityManager
  ): boolean {
    // Check collision group compatibility
    const groupA = entityA.collisionGroup;
    const groupB = entityB.collisionGroup;

    // CRITICAL FIX: Check if this is a player projectile trying to collide with player
    // Prevent self-damage at the collision detection level
    if ((groupA === 'player' && groupB === 'projectile') || (groupA === 'projectile' && groupB === 'player')) {
      // Check if the projectile belongs to the player
      const projectileEntity = groupA === 'projectile' ? entityA.entityId : entityB.entityId;
      const sourceTag = entityManager.getComponent(projectileEntity, SourceTagComponent);

      if (sourceTag && sourceTag.source === 'player') {
        // Player projectile should not collide with player
        return false;
      }
    }

    const canCollideA = entityA.collidesWith.includes('all') || entityA.collidesWith.includes(groupB);
    const canCollideB = entityB.collidesWith.includes('all') || entityB.collidesWith.includes(groupA);

    const ruleAllows = COLLISION_RULES[groupA]?.includes(groupB) || COLLISION_RULES[groupB]?.includes(groupA);

    return canCollideA && canCollideB && ruleAllows;
  }

  /**
   * Handle collision between two entities
   */
  protected handleCollision(entityA: number, entityB: number, entityManager: EntityManager): void {
    // Wrap collision handling in error recovery to prevent system crash
    this.errorHandler.safeExecute(() => {
      const positionA = this.errorHandler.safeGetComponent(
        entityManager,
        entityA,
        PositionComponent,
        'COLLISION_HANDLE_POS_A'
      );
      const positionB = this.errorHandler.safeGetComponent(
        entityManager,
        entityB,
        PositionComponent,
        'COLLISION_HANDLE_POS_B'
      );

      if (!positionA || !positionB) {
        return;
      }

      // Determine collision type
      const collisionType = this.getCollisionType(entityA, entityB, entityManager);

      // Calculate collision position (midpoint)
      const collisionPosition = {
        x: (positionA.x + positionB.x) / 2,
        y: (positionA.y + positionB.y) / 2,
      };

      // Apply collision effects
      let damage = 0;
      if (collisionType === 'player-enemy') {
        // Check if enemy is still spawning — skip ALL contact interactions during spawn
        const contactEnemy = entityManager.hasComponent(entityA, EnemyTypeComponent) ? entityA : entityB;
        const contactRenderable = entityManager.getComponent(contactEnemy, RenderableComponent);

        if (contactRenderable && !contactRenderable.isCombatReady(window.performance.now())) {
          // Enemy not combat-ready — no contact damage in either direction
        } else if (this.playerService.isDashing()) {
          // OFFENSIVE DASH: If player is dashing, deal damage to enemy instead of taking damage
          // Only hit each enemy once per dash
          if (!this.dashHitEnemies.has(contactEnemy)) {
            this.dashHitEnemies.add(contactEnemy);
            damage = this.applyDashDamageToEnemy(contactEnemy, entityManager, collisionPosition);
          }
        } else {
          // Normal collision - player takes damage
          damage = this.handlePlayerDamageCollision(entityA, entityB, entityManager);
        }
      } else if (collisionType === 'player-projectile') {
        // Check for PARRY - reflect projectile back at enemies
        if (this.playerService.isParrying()) {
          const projectileEntity = entityManager.hasComponent(entityA, ProjectileComponent) ? entityA : entityB;
          damage = this.reflectProjectile(projectileEntity, entityManager, collisionPosition);
          this.playerService.endParry(true); // Successful parry
        } else {
          // Normal projectile collision - player takes damage
          damage = this.handlePlayerDamageCollision(entityA, entityB, entityManager);
        }
      } else if (collisionType === 'projectile-enemy') {
        // Skip damage to enemies not yet combat-ready
        const enemyEntityForSpawn = entityManager.hasComponent(entityA, EnemyTypeComponent) ? entityA : entityB;
        const spawnRenderable = entityManager.getComponent(enemyEntityForSpawn, RenderableComponent);
        if (spawnRenderable && !spawnRenderable.isCombatReady(window.performance.now())) {
          // Enemy not combat-ready — no projectile damage
        } else {
          damage = this.applyDamageToEnemy(entityA, entityB, entityManager);
        }
      } else if (collisionType === 'player-shard') {
        this.handleShardCollection(entityA, entityB, entityManager);
      }

      // Emit collision event only if there are active subscribers (avoids per-collision allocation
      // when no one is listening — collision$ has zero subscribers in the current codebase).
      if (this.collisionSubject.observed) {
        const collisionEvent: CollisionEvent = {
          entityA,
          entityB,
          type: collisionType,
          damage,
          position: collisionPosition,
          timestamp: Date.now(),
        };
        this.collisionSubject.next(collisionEvent);
      }
      this.collisionsDetected++;
    }, 'HANDLE_COLLISION'); // Close the safeExecute wrapper
  }

  /**
   * Determine collision type based on entity components
   */
  private getCollisionType(entityA: number, entityB: number, entityManager: EntityManager): CollisionEvent['type'] {
    const isPlayerA = entityManager.hasComponent(entityA, PlayerControlledComponent);
    const isPlayerB = entityManager.hasComponent(entityB, PlayerControlledComponent);
    const isEnemyA = entityManager.hasComponent(entityA, EnemyTypeComponent);
    const isEnemyB = entityManager.hasComponent(entityB, EnemyTypeComponent);
    const isProjectileA = entityManager.hasComponent(entityA, ProjectileComponent);
    const isProjectileB = entityManager.hasComponent(entityB, ProjectileComponent);
    const isShardA = entityManager.hasComponent(entityA, ShardComponent);
    const isShardB = entityManager.hasComponent(entityB, ShardComponent);

    // Check for landed asteroids
    const fallingAsteroidA = entityManager.getComponent(entityA, FallingAsteroidComponent);
    const fallingAsteroidB = entityManager.getComponent(entityB, FallingAsteroidComponent);
    const isAsteroidA = fallingAsteroidA && fallingAsteroidA.state === AsteroidState.LANDED;
    const isAsteroidB = fallingAsteroidB && fallingAsteroidB.state === AsteroidState.LANDED;

    if ((isPlayerA && isEnemyB) || (isPlayerB && isEnemyA)) {
      return 'player-enemy';
    }
    if ((isPlayerA && isProjectileB) || (isPlayerB && isProjectileA)) {
      return 'player-projectile';
    }
    if ((isProjectileA && isEnemyB) || (isProjectileB && isEnemyA)) {
      return 'projectile-enemy';
    }
    if ((isPlayerA && isShardB) || (isPlayerB && isShardA)) {
      return 'player-shard';
    }
    // Handle projectile-asteroid collisions (treat like enemy for damage)
    if ((isProjectileA && isAsteroidB) || (isProjectileB && isAsteroidA)) {
      return 'projectile-enemy';
    }

    // Default fallback
    return 'player-enemy';
  }

  /**
   * Handle player damage collision with immunity tracking
   */
  private handlePlayerDamageCollision(entityA: number, entityB: number, entityManager: EntityManager): number {
    const collisionKey = `${entityA}-${entityB}`;
    const currentTime = window.performance.now();

    // Check if this collision was already processed this frame
    if (this.frameCollisions.has(collisionKey)) {
      return 0;
    }

    const lastCollision = this.lastCollisionTime.get(collisionKey) || 0;

    if (currentTime - lastCollision >= this.COLLISION_IMMUNITY_DURATION) {
      const damage = this.applyDamageToPlayer(entityA, entityB, entityManager);
      this.lastCollisionTime.set(collisionKey, currentTime);
      this.frameCollisions.add(collisionKey);

      if (this.immunityStateMap.has(collisionKey)) {
        this.immunityStateMap.delete(collisionKey);
        this.debugLog.log('✅ Collision Immunity Expired', 'info', {
          source: 'collision_immunity',
          operation: 'immunity_expired',
          entityA: entityA,
          entityB: entityB,
          immunityDuration: this.COLLISION_IMMUNITY_DURATION,
        });
      }
      return damage;
    } else {
      if (!this.immunityStateMap.get(collisionKey)) {
        this.immunityStateMap.set(collisionKey, true);
        this.debugLog.log('🛡️ Collision Immunity Started', 'info', {
          source: 'collision_immunity',
          operation: 'immunity_started',
          entityA: entityA,
          entityB: entityB,
          immunityDuration: this.COLLISION_IMMUNITY_DURATION,
          immunityRemaining: this.COLLISION_IMMUNITY_DURATION - (currentTime - lastCollision),
        });
      }
      return 0;
    }
  }

  /**
   * Reflect projectile back at enemies (Parry mechanic)
   */
  private reflectProjectile(
    projectileEntity: number,
    entityManager: EntityManager,
    collisionPosition: { x: number; y: number }
  ): number {
    const velocity = entityManager.getComponent(projectileEntity, VelocityComponent);
    const projectileComp = entityManager.getComponent(projectileEntity, ProjectileComponent);

    if (!velocity || !projectileComp) {
      // Can't reflect - destroy projectile instead
      entityManager.destroyEntity(projectileEntity);
      return 0;
    }

    // Reverse velocity direction (reflect back)
    velocity.vx = -velocity.vx;
    velocity.vy = -velocity.vy;

    // Mark as player-owned so it damages enemies instead
    projectileComp.isPlayerOwned = true;

    // Boost damage for reflected projectiles (reward for skill)
    const originalDamage = projectileComp.damage || 20;
    projectileComp.damage = originalDamage * 2; // Double damage on reflect

    // Audio + visual feedback for successful parry
    this.audio.playParrySuccess();
    this.effectFactory.createFloatingLabel(
      { x: collisionPosition.x, y: collisionPosition.y - 30 },
      'PARRY!',
      '#00e5ff' // cyan
    );

    // Create impact effect at parry point
    this.effectFactory.createBeamImpact(collisionPosition, 50);

    // Log successful parry
    this.debugLog.log('⚔️ Projectile Reflected!', 'success', {
      source: 'parry_system',
      originalDamage,
      reflectedDamage: projectileComp.damage,
      newVelocity: { vx: velocity.vx, vy: velocity.vy },
    });

    return 0; // No damage to player
  }

  /**
   * Apply dash damage to enemy (Offensive Dash mechanic)
   */
  private applyDashDamageToEnemy(
    enemyEntity: number,
    entityManager: EntityManager,
    collisionPosition: { x: number; y: number }
  ): number {
    const enemyHealth = entityManager.getComponent(enemyEntity, HealthComponent);
    if (!enemyHealth || enemyHealth.health <= 0) return 0;

    // Get dash damage from config
    const dashDamage = PLAYER_CONFIG.ABILITIES.DASH.DAMAGE || 50;

    // Apply damage — behavior-preserving: dash applies ONLY flat damageReduction
    // (its original resistance) and bypasses the Sentinel shield, same as projectiles.
    const dashResult = this.damageResolver.applyDamageToEnemy({
      health: enemyHealth,
      rawDamage: dashDamage,
      source: 'player',
      damageReduction: enemyHealth.damageReduction,
    });
    const actualDamage = dashResult.appliedDamage;

    // Track damage dealt for achievement (overkill)
    if (actualDamage > 0) {
      this.achievementService.recordDamageDealt(actualDamage);
    }

    // Visual feedback - create damage number
    if (this.settings.getSettings().showDamageNumbers && actualDamage > 0) {
      this.effectFactory.createDamageNumber(
        { x: collisionPosition.x, y: collisionPosition.y - 20 },
        Math.round(actualDamage),
        false // Yellow reserved for actual crits only
      );
    }

    // Create hit flash on enemy
    const existingFlash = entityManager.getComponent(enemyEntity, HitFlashComponent);
    if (!existingFlash || existingFlash.isExpired()) {
      if (existingFlash) {
        entityManager.removeComponent(enemyEntity, HitFlashComponent);
      }
      entityManager.addComponent(
        enemyEntity,
        new HitFlashComponent(0.8, 150, Date.now(), '#00ffff') // Cyan flash for dash damage
      );
    }

    // Create impact effect
    this.effectFactory.createBeamImpact(collisionPosition, actualDamage);

    // Log dash damage
    const enemyType = entityManager.getComponent(enemyEntity, EnemyTypeComponent);
    this.debugLog.log('⚡ Offensive Dash Damage', 'success', {
      source: 'offensive_dash',
      enemyEntity,
      enemyType: enemyType?.type || 'unknown',
      damage: actualDamage,
      remainingHealth: enemyHealth.health,
    });

    return actualDamage;
  }

  /**
   * Apply damage to player entity
   */
  private applyDamageToPlayer(entityA: number, entityB: number, entityManager: EntityManager): number {
    // Determine which entity is the player and which is the damage dealer
    const playerEntity = entityManager.hasComponent(entityA, PlayerControlledComponent) ? entityA : entityB;
    const damageEntity = playerEntity === entityA ? entityB : entityA;

    const playerHealth = entityManager.getComponent(playerEntity, HealthComponent);
    const damageComponent = entityManager.getComponent(damageEntity, DamageComponent);

    if (!playerHealth || !damageComponent) return 0;

    // CRITICAL FIX: Check if this is a player projectile hitting the player
    // Players should NOT be damaged by their own projectiles!
    const sourceTag = entityManager.getComponent(damageEntity, SourceTagComponent);
    if (sourceTag && sourceTag.source === 'player') {
      // This is a player projectile - don't damage the player!
      this.debugLog.log('🛡️ Player projectile ignored (no self-damage)', 'info', {
        source: 'collision_self_damage_prevention',
        projectileEntity: damageEntity,
        playerEntity: playerEntity,
      });
      return 0;
    }

    // Check if player is invincible (from dash, immunity grant, or other sources)
    const playerComp = entityManager.getComponent(playerEntity, PlayerControlledComponent);
    if (playerComp && playerComp.isInvincible) {
      // Check if immunity has expired
      const currentTime = Date.now();
      if (playerComp.invincibilityEndTime > 0 && currentTime >= playerComp.invincibilityEndTime) {
        // Immunity expired, clean it up
        playerComp.isInvincible = false;
        playerComp.invincibilityEndTime = 0;

        // Log invincibility expiry
        if (this.playerInvincibilityLogged) {
          this.playerInvincibilityLogged = false;
          this.debugLog.log('✅ Invincibility Expired', 'info', {
            source: 'collision_invincibility',
            operation: 'invincibility_expired',
          });
        }
      } else {
        // Player is still invincible - only log once
        if (!this.playerInvincibilityLogged) {
          this.playerInvincibilityLogged = true;
          this.debugLog.log('✨ Invincibility Started - Damage Blocked', 'info', {
            source: 'collision_invincibility',
            operation: 'invincibility_started',
            playerEntity,
            remainingTime:
              playerComp.invincibilityEndTime > 0
                ? Math.ceil((playerComp.invincibilityEndTime - currentTime) / 1000)
                : 'infinite',
          });
        }
        return 0;
      }
    }

    // Legacy check for PlayerService invincibility (for dash mechanic)
    if (this.playerService && this.playerService.isInvincible()) {
      if (!this.dashInvincibilityLogged) {
        this.dashInvincibilityLogged = true;
        this.debugLog.log('✨ Dash Invincibility Started', 'info', {
          source: 'collision_dash_invincibility',
          operation: 'dash_invincibility_started',
        });
      }
      return 0;
    } else if (this.dashInvincibilityLogged) {
      // Dash invincibility expired
      this.dashInvincibilityLogged = false;
      this.debugLog.log('✅ Dash Invincibility Expired', 'info', {
        source: 'collision_dash_invincibility',
        operation: 'dash_invincibility_expired',
      });
    }

    // Check global damage immunity (prevents multiple enemies hitting at once)
    const currentTime = window.performance.now();
    if (currentTime - this.lastPlayerDamageTime < this.PLAYER_DAMAGE_IMMUNITY_MS) {
      // Only log when immunity starts
      if (!this.playerDamageImmunityLogged) {
        this.playerDamageImmunityLogged = true;
        this.debugLog.log('🛡️ Player Damage Immunity Started', 'info', {
          source: 'player_damage_immunity',
          operation: 'immunity_started',
          immunityDuration: this.PLAYER_DAMAGE_IMMUNITY_MS,
          immunityRemaining: this.PLAYER_DAMAGE_IMMUNITY_MS - (currentTime - this.lastPlayerDamageTime),
        });
      }
      return 0;
    } else if (this.playerDamageImmunityLogged) {
      // Log when immunity expires
      this.playerDamageImmunityLogged = false;
      this.debugLog.log('✅ Player Damage Immunity Expired', 'info', {
        source: 'player_damage_immunity',
        operation: 'immunity_expired',
        totalDuration: this.PLAYER_DAMAGE_IMMUNITY_MS,
      });
    }

    // Emergency Barrier — absorb one hit before any other calculation
    if (this.playerUpgrades.hasBarrier() && this.playerUpgrades.isBarrierCharged()) {
      this.playerUpgrades.consumeBarrierCharge();
      // Visual feedback: re-use the existing damage-immunity flash
      this.postProcessing.addChromaticAberration(PostProcessingService.PRESETS.MEDIUM_DAMAGE);
      this.debugLog.log('🛡️ Emergency Barrier absorbed a hit', 'info', {
        source: 'collision_barrier',
      });
      return 0;
    }

    // Apply curse difficulty multiplier to enemy damage
    const curseDifficulty = this.curseService ? this.curseService.getDifficultyMultiplier() : 1.0;
    const baseDamage = damageComponent.contactDamage * curseDifficulty;

    // Apply damage reduction based on focus charge level
    const focusCharge = this.playerService.getFocusCharge();
    const reductionConfig = FOCUS_CHARGING_CONFIG.FOCUS_DAMAGE_REDUCTION;
    const focusBasedReduction = Math.min(
      reductionConfig.MAX_REDUCTION,
      (focusCharge / 100) * reductionConfig.SCALE_FACTOR
    );

    // Get player position for territory effects
    const playerPosition = entityManager.getComponent(playerEntity, PositionComponent);
    let territoryDefenseMultiplier = 1.0;

    if (playerPosition) {
      const territoryEffects = this.factionStandingSystem.getTerritoryEffects(playerPosition.x, playerPosition.y);
      territoryDefenseMultiplier = territoryEffects.defenseMultiplier;
    }

    // Include buff-based damage reduction (from shield powerups)
    const buffComp = entityManager.getComponent(playerEntity, BuffComponent);
    const buffDamageReduction = buffComp?.damageReduction ?? 0;

    // Combine all damage reductions and apply territory defense
    const totalReduction = playerHealth.damageReduction + focusBasedReduction + buffDamageReduction;
    // Apply vulnerability curse (damageTakenMultiplier from BuffSystemService)
    const damageTakenMult = this.buffSystem.damageTakenMultiplier;
    let actualDamage = Math.round(baseDamage * (1 - totalReduction) * territoryDefenseMultiplier * damageTakenMult);
    if (!Number.isFinite(actualDamage) || actualDamage < 0) {
      actualDamage = 0;
    }

    // Apply frame-based damage cap
    if (actualDamage > 0 && this.frameDamageDealt + actualDamage > this.MAX_DAMAGE_PER_FRAME) {
      const originalDamage = actualDamage;
      actualDamage = Math.max(0, this.MAX_DAMAGE_PER_FRAME - this.frameDamageDealt);
      this.damageCapHitCount++;

      // Log damage capping event based on configured frequency
      if (
        DAMAGE_CONFIG.DAMAGE_CAP_METRICS.TRACK_CAP_HITS &&
        Math.random() < DAMAGE_CONFIG.DAMAGE_CAP_METRICS.LOG_FREQUENCY
      ) {
        this.debugLog.log('⚠️ Frame Damage Cap Applied', 'warning', {
          source: 'collision_damage_cap',
          frameId: this.frameId,
          attemptedDamage: originalDamage,
          cappedDamage: actualDamage,
          frameDamageBeforeCap: this.frameDamageDealt,
          maxDamagePerFrame: this.MAX_DAMAGE_PER_FRAME,
          totalCapHits: this.damageCapHitCount,
        });
      }
    }

    // Track frame damage
    this.frameDamageDealt += actualDamage;

    // CLEAN ARCHITECTURE: GameState is the single source of truth for health
    // Step 1: Get current health from authoritative source
    const healthBefore = this.gameState.getHealth();

    // Step 2: Validate we can apply damage
    if (healthBefore <= 0) {
      // Player is already dead, ignore further damage
      return 0;
    }

    // Step 3: Apply damage through GameState (it handles all health logic)
    this.gameState.takeDamage(actualDamage, 'enemy_contact');

    // Step 4: Get the result and sync to ECS for rendering/display
    const healthAfter = this.gameState.getHealth();
    playerHealth.health = healthAfter;
    playerHealth.maxHealth = this.gameState.getMaxHealth();

    // Note: Debug force death code removed for production

    // Update last damage time for global immunity
    if (actualDamage > 0) {
      this.lastPlayerDamageTime = window.performance.now();

      // Track the faction that damaged the player (for death attribution)
      const enemyFaction = entityManager.getComponent(damageEntity, FactionComponent);
      if (enemyFaction && actualDamage > 0) {
        this.lastPlayerDamageSource = {
          factionId: enemyFaction.kingId,
          timestamp: Date.now(),
        };
      }

      // GameState emits the authoritative damage event to PlayerService exactly once.
      // Collision contributes only world-space source data for the local hit bracket.
      const damagePosition = entityManager.getComponent(damageEntity, PositionComponent);
      if (damagePosition) {
        this.playerService.setDamageFeedbackSource(damagePosition.x, damagePosition.y);
      }

      // Chromatic aberration on player hit (replaces disruptive screen shake)
      if (this.settings.getSettings().chromaticAberration) {
        const maxHealth = this.gameState.getMaxHealth();
        const damagePercent = maxHealth > 0 ? actualDamage / maxHealth : 0;
        if (damagePercent > 0.15) {
          this.postProcessing.addChromaticAberration(PostProcessingService.PRESETS.HEAVY_DAMAGE);
        } else if (damagePercent > 0.05) {
          this.postProcessing.addChromaticAberration(PostProcessingService.PRESETS.MEDIUM_DAMAGE);
        } else {
          this.postProcessing.addChromaticAberration(PostProcessingService.PRESETS.LIGHT_DAMAGE);
        }
      }

      // Red screen flash on player damage
      this.postProcessing.addScreenFlash(PostProcessingService.FLASH_PRESETS.PLAYER_DAMAGE);

      // Update vignette based on current health percentage
      const currentHealth = this.gameState.getHealth();
      const currentMaxHealth = this.gameState.getMaxHealth();
      const healthPercent = currentMaxHealth > 0 ? currentHealth / currentMaxHealth : 1;
      this.postProcessing.setVignetteState(healthPercent < 0.3 ? 'danger' : 'normal');

      // Add damage numbers when player takes damage (with throttling for multi-enemy scenarios)
      const playerPosition = entityManager.getComponent(playerEntity, PositionComponent);
      if (playerPosition && this.settings.getSettings().showDamageNumbers) {
        // Throttle damage numbers to prevent visual spam when surrounded by enemies
        if (this.playerDamageNumbersThisFrame < this.MAX_PLAYER_DAMAGE_NUMBERS_PER_FRAME) {
          this.effectFactory.createDamageNumber(
            { x: playerPosition.x, y: playerPosition.y - 30 }, // Higher offset for player
            Math.round(actualDamage),
            false // Player damage is never critical
          );
          this.playerDamageNumbersThisFrame++;
        }
      }
    }

    // Destroy/pool projectile if it hit the player
    const isProjectile = entityManager.hasComponent(damageEntity, ProjectileComponent);
    if (isProjectile) {
      const projectileComp = entityManager.getComponent(damageEntity, ProjectileComponent);

      // Only pool non-penetrating projectiles (penetrating ones continue through)
      if (!projectileComp?.penetrating) {
        // Return projectile to pool for performance
        const isChargedProjectile = entityManager.hasComponent(damageEntity, ChargedProjectileComponent);
        const poolType = isChargedProjectile ? PoolType.CHARGED_PROJECTILE : PoolType.PROJECTILE;

        // returnToPool already has defensive checks for double-pooling and entity existence
        this.entityFactory.returnToPool(poolType, damageEntity);
        this.projectilesPooledCount++;
      }
    }

    // Send detailed collision damage info to debug bridge
    if (actualDamage > 0) {
      // Get details about the damage source
      const enemyType = entityManager.getComponent(damageEntity, EnemyTypeComponent);
      const enemyPosition = entityManager.getComponent(damageEntity, PositionComponent);
      const enemyFactionComp = entityManager.getComponent(damageEntity, FactionComponent);

      this.debugLog.log('💥 Collision Damage', actualDamage > 10 ? 'warning' : 'info', {
        source: 'collision',
        entityId: damageEntity,
        damageAmount: actualDamage,
        enemyType: enemyType?.type || 'unknown',
        enemyFaction: enemyFactionComp?.kingName || 'no_faction',
        enemyFactionId: enemyFactionComp?.kingId || 0,
        enemyPosition: enemyPosition ? { x: enemyPosition.x.toFixed(0), y: enemyPosition.y.toFixed(0) } : 'unknown',
        playerPosition: playerPosition ? { x: playerPosition.x.toFixed(0), y: playerPosition.y.toFixed(0) } : 'unknown',
        healthBefore: healthBefore,
        healthAfter: playerHealth.health,
        damageReductions: {
          focusReduction: focusBasedReduction.toFixed(2),
          territoryMultiplier: territoryDefenseMultiplier.toFixed(2),
          playerDamageReduction: playerHealth.damageReduction.toFixed(2),
          buffDamageReduction: buffDamageReduction.toFixed(2),
          totalReduction: (totalReduction * 100).toFixed(1) + '%',
        },
        frameDamageTotal: this.frameDamageDealt,
        frameId: this.frameId,
      });
    }

    return actualDamage;
  }

  /**
   * Apply damage to enemy entity (or asteroid)
   */
  private applyDamageToEnemy(entityA: number, entityB: number, entityManager: EntityManager): number {
    // Determine which entity is the enemy/asteroid and which is the projectile
    let targetEntity: number;
    let projectileEntity: number;

    // Check if either entity is an enemy
    if (entityManager.hasComponent(entityA, EnemyTypeComponent)) {
      targetEntity = entityA;
      projectileEntity = entityB;
    } else if (entityManager.hasComponent(entityB, EnemyTypeComponent)) {
      targetEntity = entityB;
      projectileEntity = entityA;
    }
    // Check if either entity is a landed asteroid
    else {
      const asteroidA = entityManager.getComponent(entityA, FallingAsteroidComponent);
      const asteroidB = entityManager.getComponent(entityB, FallingAsteroidComponent);

      if (asteroidA && asteroidA.state === AsteroidState.LANDED) {
        targetEntity = entityA;
        projectileEntity = entityB;
      } else if (asteroidB && asteroidB.state === AsteroidState.LANDED) {
        targetEntity = entityB;
        projectileEntity = entityA;
      } else {
        return 0; // No valid target
      }
    }

    const targetHealth = entityManager.getComponent(targetEntity, HealthComponent);
    if (!targetHealth || targetHealth.health <= 0) return 0;

    const projectileComponent = entityManager.getComponent(projectileEntity, ProjectileComponent);

    if (!targetHealth || !projectileComponent) return 0;

    // Check if this is a reflected projectile ONCE at the beginning
    const sourceTag = entityManager.getComponent(projectileEntity, SourceTagComponent);
    const isReflected = sourceTag && sourceTag.isReflected === true;

    // Apply buff damage multiplier for player projectiles only
    const isPlayerProjectile = sourceTag?.source === 'player' || isReflected;
    let buffDamageMultiplier = 1.0;
    if (isPlayerProjectile) {
      const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
      const playerEntityForBuff = playerEntities[0];
      const buffComp = playerEntityForBuff ? entityManager.getComponent(playerEntityForBuff, BuffComponent) : undefined;
      buffDamageMultiplier = buffComp?.damageMultiplier ?? 1.0;
    }

    // Apply reflection damage bonus, ascension bonus, and focus fire bonus if applicable
    const focusFireMult = isPlayerProjectile ? this.playerService.getFocusFireDamageMultiplier() : 1.0;
    const baseDamage =
      projectileComponent.damage * this.ascensionService.getDamageBonus() * buffDamageMultiplier * focusFireMult;
    const damage = isReflected ? baseDamage * BEAM_REFLECTION.DAMAGE_MULTIPLIER : baseDamage;
    // Capture health before applying damage so killing blows still show damage numbers
    const damageSource = sourceTag?.source === 'player' || isReflected ? 'player' : 'environmental';
    // Behavior-preserving: projectiles apply ONLY flat damageReduction (their
    // original resistance) and intentionally BYPASS the Sentinel directional
    // shield. This is by design — projectiles are the counter to shielded
    // Sentinels (whose shield always faces the player, so it would otherwise
    // block every shot). The beam is the weapon the shield blocks.
    const damageResult = this.damageResolver.applyDamageToEnemy({
      health: targetHealth,
      rawDamage: damage,
      source: damageSource,
      damageReduction: targetHealth.damageReduction,
    });
    const previousHealth = damageResult.previousHealth;
    const actualDamage = damageResult.appliedDamage;

    // Track damage dealt for achievement (overkill)
    if (actualDamage > 0) {
      this.achievementService.recordDamageDealt(actualDamage);
    }

    // Add hit flash effect when target takes damage
    // Use previousHealth to ensure killing blows still show visual feedback and damage numbers
    if (actualDamage > 0 && previousHealth > 0) {
      // Check if this is an asteroid - they get special effects
      const asteroid = entityManager.getComponent(targetEntity, FallingAsteroidComponent);
      if (asteroid) {
        // Create sparks/debris for asteroid hits
        const targetPos = entityManager.getComponent(targetEntity, PositionComponent);
        if (targetPos) {
          this.effectFactory.createBeamImpact({ x: targetPos.x, y: targetPos.y }, actualDamage);
        }
      } else {
        // Regular enemy hit flash
        const existingFlash = entityManager.getComponent(targetEntity, HitFlashComponent);
        if (existingFlash && !existingFlash.isExpired()) {
          // Don't add new flash if one is already active to prevent flicker
        } else {
          // Remove expired flash if any
          if (existingFlash) {
            entityManager.removeComponent(targetEntity, HitFlashComponent);
          }

          // Add new hit flash with intensity based on damage
          const flashIntensity = Math.min(
            HIT_FLASH_CONFIG.MAX_INTENSITY,
            actualDamage / HIT_FLASH_CONFIG.DAMAGE_SCALE_DIVISOR
          );
          entityManager.addComponent(
            targetEntity,
            new HitFlashComponent(
              flashIntensity,
              HIT_FLASH_CONFIG.PROJECTILE_DURATION,
              Date.now(),
              HIT_FLASH_CONFIG.PROJECTILE_COLOR
            )
          );
        }

        // Update health bar display component to extend visibility
        let healthBarDisplay = entityManager.getComponent(targetEntity, HealthBarDisplayComponent);
        if (!healthBarDisplay) {
          healthBarDisplay = new HealthBarDisplayComponent();
          healthBarDisplay.lastHealthPercent = 1.0;
          entityManager.addComponent(targetEntity, healthBarDisplay);
        }
        healthBarDisplay.extendDisplay();
      }

      // Get enemy position for effects
      const targetPosition = entityManager.getComponent(targetEntity, PositionComponent);

      // Create damage number if damage numbers are enabled
      if (this.settings.getSettings().showDamageNumbers && actualDamage > 0 && targetPosition) {
        // We already checked if this is reflected above, reuse that check

        if (isReflected) {
          // Reflected projectiles create special visual feedback
          // This communicates to the player that the beam successfully deflected an attack

          // Debug log to verify reflected projectiles are detected
          if (Math.random() < 0.3) {
            this.debugLog.log('🔄 Reflected Damage Applied', 'info', {
              source: 'collision_reflected',
              projectileId: projectileEntity,
              targetId: targetEntity,
              damage: actualDamage.toFixed(1),
              isReflected: true,
              visualsOnly: 'No damage numbers shown',
            });
          }

          // Create a distinct impact effect for deflection damage
          // Using beam impact with higher intensity to show the deflection power
          this.effectFactory.createBeamImpact({ x: targetPosition.x, y: targetPosition.y }, actualDamage);

          // Create additional particle burst to emphasize the deflection hit
          this.effectFactory.createEnemyExplosion(
            { x: targetPosition.x, y: targetPosition.y },
            0.4 // Subtle explosion to show deflection impact
          );

          // Optional: Could add deflection counter or combo system here
          // For now, visual feedback is sufficient
        } else {
          // Normal damage numbers for direct player projectiles
          const isCritical = projectileComponent.isCritical || false;
          if (isCritical) {
            this.postProcessing.addScreenFlash(PostProcessingService.FLASH_PRESETS.CRITICAL_HIT);
          }
          this.effectFactory.createDamageNumber(
            { x: targetPosition.x, y: targetPosition.y - 20 },
            Math.round(actualDamage),
            isCritical
          );
        }
      }

      // Create enhanced impact for charged projectiles
      const chargedProjectile = entityManager.getComponent(projectileEntity, ChargedProjectileComponent);
      if (chargedProjectile && chargedProjectile.isCharged && targetPosition) {
        const chargeLevel = chargedProjectile.chargeLevel;
        const impactIntensity =
          IMPACT_CONFIG.MIN_INTENSITY + chargeLevel * (IMPACT_CONFIG.MAX_INTENSITY - IMPACT_CONFIG.MIN_INTENSITY);

        // Create bigger explosion for charged projectiles
        this.effectFactory.createEnemyExplosion({ x: targetPosition.x, y: targetPosition.y }, impactIntensity);

        // Track performance metrics
        this.chargedImpactStats.totalImpacts++;
        if (chargeLevel > 0.7) {
          this.chargedImpactStats.highChargeImpacts++;
        }
      }

      // Destroy projectile unless it's penetrating
      // FIX: Use returnToPool instead of destroyEntity to preserve pool resources
      if (!projectileComponent.penetrating) {
        // Check if it's a charged projectile or regular projectile
        const isCharged = entityManager.hasComponent(projectileEntity, ChargedProjectileComponent);
        const poolType = isCharged ? PoolType.CHARGED_PROJECTILE : PoolType.PROJECTILE;
        this.entityFactory.returnToPool(poolType, projectileEntity);
      }

      return actualDamage;
    }

    return 0; // Default return value
  }

  /**
   * Handle shard collection by player
   */
  private handleShardCollection(entityA: number, entityB: number, entityManager: EntityManager): void {
    // Determine which entity is the player and which is the shard
    const playerEntity = entityManager.hasComponent(entityA, PlayerControlledComponent) ? entityA : entityB;
    const shardEntity = playerEntity === entityA ? entityB : entityA;

    const shardComponent = entityManager.getComponent(shardEntity, ShardComponent);
    const shardPosition = entityManager.getComponent(shardEntity, PositionComponent);

    if (!shardComponent || !shardPosition) return;

    // Apply shard multiplier (includes ascension bonus + difficulty modifier)
    const shardMultiplier = this.playerUpgrades.getShardMultiplier();
    const difficultyShardMultiplier = this.difficultyService.getModifiers().shardMultiplier;
    const finalShardValue = Math.floor(
      shardComponent.value * shardMultiplier * this.ascensionService.getShardBonus() * difficultyShardMultiplier
    );

    // Update player shards through GameStateService
    this.gameState.addShards(finalShardValue);
    this.audio.playShardCollect();

    // Log shard collection (only in development - happens frequently)
    if (!IS_PRODUCTION) {
      this.debugLog.log(`💎 Shard collected: +${finalShardValue} shards`, 'info', {
        source: 'collision_system',
        operation: 'shard_collection',
        shardValue: finalShardValue,
        xpAwarded: finalShardValue,
        currentXp: this.progressionSystem.xp,
        currentLevel: this.progressionSystem.level,
      });
    }

    // Create collection effect with multiplied value
    this.effectFactory.createShardCollection({ x: shardPosition.x, y: shardPosition.y }, finalShardValue);

    // Show "+N" floating text at collection point
    if (this.settings.getSettings().showDamageNumbers && finalShardValue > 0) {
      this.effectFactory.createShardPickupText({ x: shardPosition.x, y: shardPosition.y }, finalShardValue);
    }

    // Check for Shard Synthesis buff trigger
    if (this.playerUpgrades.hasShardSynthesis()) {
      this.triggerShardSynthesisBuff(playerEntity, entityManager);
    }

    // Return shard to pool instead of destroying
    this.entityFactory.returnToPool(PoolType.SHARD, shardEntity);
  }

  /**
   * Trigger a random temporary buff from Shard Synthesis
   */
  private triggerShardSynthesisBuff(playerEntity: number, entityManager: EntityManager): void {
    // Define possible buffs with their effects
    const possibleBuffs = [
      {
        id: 'shard_speed',
        name: 'Shard Speed',
        effects: { speedMultiplier: 1.3 },
        description: 'speed boost',
      },
      {
        id: 'shard_damage',
        name: 'Shard Damage',
        effects: { damageMultiplier: 1.5 },
        description: 'damage boost',
      },
      {
        id: 'shard_firerate',
        name: 'Shard Fire Rate',
        effects: { fireRateMultiplier: 1.5 },
        description: 'fire rate boost',
      },
    ];

    // Pick a random buff
    const buff = possibleBuffs[Math.floor(Math.random() * possibleBuffs.length)];
    const duration = this.playerUpgrades.getShardSynthesisDuration();

    // Register the temporary buff if not already registered
    if (!this.buffManagement.isBuffRegistered(buff.id)) {
      this.buffManagement.registerBuff({
        id: buff.id,
        name: buff.name,
        description: `Temporary ${buff.description} from shard collection`,
        duration: duration,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 150,
        effects: buff.effects,
      });
    }

    // Apply the buff
    const success = this.buffManagement.applyBuff(playerEntity, buff.id, entityManager);

    // Show synthesis buff callout at player position
    if (success) {
      const playerPos = entityManager.getComponent(playerEntity, PositionComponent);
      if (playerPos) {
        this.effectFactory.createSynthesisBuffText({ x: playerPos.x, y: playerPos.y }, buff.id, buff.description);
      }
    }

    // Log the buff application (reduced frequency)
    if (success && Math.random() < 0.3) {
      // 30% chance to log
      this.debugLog.log(`💎✨ Shard Synthesis: Applied ${buff.description} for ${duration / 1000}s`, 'info', {
        source: 'collision_system',
        operation: 'shard_synthesis_buff',
        buffType: buff.id,
        duration: `${duration}ms`,
        currentBuffs: this.buffManagement.getEntityBuffs(playerEntity).map((b: ActiveBuff) => b.buffId),
      });
    }
  }

  /**
   * Get collision system statistics
   */
  getCollisionStats(): { checks: number; collisions: number; cells: number; damageCapHits: number } {
    return {
      checks: this.collisionChecks,
      collisions: this.collisionsDetected,
      cells: this.spatialGrid.getStats().cellCount,
      damageCapHits: this.damageCapHitCount,
    };
  }

  /**
   * Report charged impact performance metrics
   */
  private reportPoolingStats(): void {
    if (this.projectilesPooledCount > 0) {
      // Get pool statistics from entity factory
      const poolStats = this.entityFactory.getPoolStats();

      this.debugLog.log('♻️ Projectile Pooling Metrics (30s)', 'info', {
        source: 'collision_pooling_metrics',
        projectilesPooledOnHit: this.projectilesPooledCount,
        poolHitRate: poolStats.projectile?.hitRate || 0,
        chargedPoolHitRate: poolStats.chargedProjectile?.hitRate || 0,
        memorySaved: `~${(this.projectilesPooledCount * 0.5).toFixed(1)}KB`,
        avgPooledPerMinute: Math.round((this.projectilesPooledCount / 30) * 60),
      });

      // Reset counter
      this.projectilesPooledCount = 0;
    }
  }

  private reportChargedImpactStats(): void {
    if (this.chargedImpactStats.totalImpacts > 0) {
      const highChargeRate = (
        (this.chargedImpactStats.highChargeImpacts / this.chargedImpactStats.totalImpacts) *
        100
      ).toFixed(1);
      const shakeRate = (
        (this.chargedImpactStats.shakesTriggered / this.chargedImpactStats.totalImpacts) *
        100
      ).toFixed(1);
      const chromaticRate = (
        (this.chargedImpactStats.chromaticTriggered / this.chargedImpactStats.totalImpacts) *
        100
      ).toFixed(1);

      this.debugLog.log('Charged Impact Performance', 'info', {
        source: 'collision_system',
        operation: 'charged_impact_report',
        metrics: {
          totalImpacts: this.chargedImpactStats.totalImpacts,
          highChargeImpacts: this.chargedImpactStats.highChargeImpacts,
          highChargeRate: highChargeRate + '%',
          shakesTriggered: this.chargedImpactStats.shakesTriggered,
          shakeRate: shakeRate + '%',
          chromaticTriggered: this.chargedImpactStats.chromaticTriggered,
          chromaticRate: chromaticRate + '%',
        },
        interval: this.CHARGED_STATS_INTERVAL,
      });

      // Reset counters
      this.chargedImpactStats.totalImpacts = 0;
      this.chargedImpactStats.highChargeImpacts = 0;
      this.chargedImpactStats.shakesTriggered = 0;
      this.chargedImpactStats.chromaticTriggered = 0;
    }
  }

  /**
   * Get the last faction that damaged the player (for death attribution)
   */
  public getLastPlayerDamageSource(): number | null {
    if (!this.lastPlayerDamageSource) return null;

    // Only return if damage was recent (within 5 seconds)
    const timeSinceDamage = Date.now() - this.lastPlayerDamageSource.timestamp;
    if (timeSinceDamage > 5000) return null;

    return this.lastPlayerDamageSource.factionId;
  }

  /**
   * Clean up tracking data for a dead enemy to prevent memory leaks
   */
  public cleanupDeadEnemy(entityId: number): void {
    // Remove all collision immunity entries involving this entity
    const entityStr = String(entityId);
    for (const key of this.lastCollisionTime.keys()) {
      if (key.startsWith(entityStr + '-') || key.endsWith('-' + entityStr)) {
        this.lastCollisionTime.delete(key);
        this.immunityStateMap.delete(key);
      }
    }
    // Remove from dash hit tracking
    this.dashHitEnemies.delete(entityId);
  }

  /**
   * Get tracking map sizes for debug export diagnostics
   * Used to detect memory leaks in collision tracking
   */
  public getTrackingMapSizes(): {
    lastCollisionTime: number;
    immunityStateMap: number;
    frameCollisions: number;
    dashHitEnemies: number;
    spatialGridStats: { cellCount: number; avgEntitiesPerCell: number };
  } {
    const gridStats = this.spatialGrid.getStats();
    return {
      lastCollisionTime: this.lastCollisionTime.size,
      immunityStateMap: this.immunityStateMap.size,
      frameCollisions: this.frameCollisions.size,
      dashHitEnemies: this.dashHitEnemies.size,
      spatialGridStats: {
        cellCount: gridStats.cellCount,
        avgEntitiesPerCell: gridStats.avgEntitiesPerCell,
      },
    };
  }

  /**
   * Reset tracking state for game restart — clears all Maps/Sets that accumulate per-entity state.
   */
  reset(): void {
    this.lastCollisionTime.clear();
    this.frameCollisions.clear();
    this.immunityStateMap.clear();
    this.cleanupExpiredSet.clear();
    this.dashHitEnemies.clear();
    this.lastPlayerDamageTime = 0;
    this.lastPlayerDamageSource = null;
    this.frameId = 0;
    this.frameDamageDealt = 0;
    this.frameStartTime = 0;
    this.frameCount = 0;
    this.playerDamageImmunityLogged = false;
    this.playerInvincibilityLogged = false;
    this.dashInvincibilityLogged = false;
    this.playerDamageNumbersThisFrame = 0;
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    // Report final stats
    if (this.chargedImpactStats.totalImpacts > 0) {
      this.reportChargedImpactStats();
    }
    this.collisionSubject.complete();
    this.clearSpatialGrid();
  }
}
