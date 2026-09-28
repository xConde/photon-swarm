import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { FourKingsTerritoryService } from '../territory';
import {
  AccelerationComponent,
  AIControlledComponent,
  EnemyTypeComponent,
  FactionComponent,
  KnockbackComponent,
  PlayerControlledComponent,
  PositionComponent,
  TerritorialGuardianComponent,
  VelocityComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { ENEMY_SEPARATION_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { QuadTreeNode } from '../../utils/quadtree';

@Injectable({ providedIn: 'root' })
export class EnemyMovementSystemService implements System {
  private playerPosition: { x: number; y: number } | null = null;
  private firstUpdate = true;
  private enemyCount = 0;

  private readonly WORLD_WIDTH = WORLD_CONFIG.BOUNDS.WIDTH;
  private readonly WORLD_HEIGHT = WORLD_CONFIG.BOUNDS.HEIGHT;

  // Cached enemy positions for separation calculation (updated each frame).
  // Slot objects are pre-allocated and mutated in place — no per-frame allocation.
  private enemyPositionsCache: Array<{ id: number; x: number; y: number }> = [];
  // Parallel pre-allocated SpatialEntity slots reused for spatial-tree insertion.
  private spatialEntityPool: Array<{ id: number; x: number; y: number; radius: number; collisionGroup: string }> = [];

  // Stuck detection: tracks accumulated time (ms) an enemy has been blocked
  private stuckTimeAccumulator = new Map<number, number>();
  private readonly STUCK_THRESHOLD_MS = 200; // 200ms before escape from stuck state
  private readonly STUCK_CLEANUP_INTERVAL_MS = 2000; // Clean up tracking every 2 seconds
  private stuckCleanupAccumulator = 0;

  // Smoothed separation direction per enemy to prevent jitter
  // Instead of snapping to new separation direction, we lerp toward it
  private smoothedSeparation = new Map<number, { x: number; y: number }>();
  // Reusable Set for cleanup validity checks (avoids per-call allocation)
  private reusableCleanupSet = new Set<number>();
  private readonly SEPARATION_SMOOTHING_RATE = 24; // Per-second rate (higher = faster convergence)

  // Safety limit - force cleanup if maps grow beyond expected size (prevents memory leaks)
  private readonly MAX_TRACKED_ENTRIES = 60; // Max enemies is 50, so 60 is a reasonable safety margin

  // Spatial partitioning for O(n log n) enemy separation instead of O(n²)
  private enemySpatialTree: QuadTreeNode;
  private readonly ENEMY_RADIUS = 25; // Average enemy radius for spatial queries

  // Reusable per-frame objects — allocated once, mutated in place to avoid GC pressure
  private readonly _finalDir = { x: 0, y: 0 };
  private readonly _sepResult = { x: 0, y: 0, blendFactor: 0, nearbyCount: 0 };

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private entityFactory: EntityFactoryECSService
  ) {
    // Initialize spatial tree for enemy separation queries
    this.enemySpatialTree = new QuadTreeNode(
      { x: 0, y: 0, width: this.WORLD_WIDTH, height: this.WORLD_HEIGHT },
      10, // maxEntities per node
      5 // maxDepth
    );
  }

  private readonly MOVEMENT_SPEEDS = {
    direct: 1.0,
    flank: 1.2,
    orbit: 1.1,
    retreat: 1.8,
    wander: 0.5,
    grouping: 0.9,
    ranged: 0.8,
    sniper: 0.4,
    charger: 1.3,
    swarm: 1.6,
    aggressive: 1.3,
    boss: 0.5,
    idle: 0.0,
    disruptor: 0.9, // Moderate — maintains preferred range
    sentinel: 0.7, // Slow, deliberate advance — never retreats
    territorial_guardian: 0.8, // Moderate patrol speed; aggro/leash boosts applied below
  } as const;

  private readonly BEHAVIOR_DISTANCES = {
    orbit: 200,
    retreat: 150,
    flank: 250,
    ranged: 300,
    sniper: 500,
  } as const;

  /**
   * Per-behavior separation weight multiplier.
   * Controls how much each behavior type is affected by enemy-to-enemy separation.
   * Swarm enemies WANT to clump (low multiplier), snipers want space (high multiplier),
   * bosses plow through others (low multiplier).
   */
  private readonly SEPARATION_BEHAVIOR_SCALE: Record<string, number> = {
    [BehaviorPattern.Idle]: 1.0,
    [BehaviorPattern.Direct]: 1.0,
    [BehaviorPattern.Flank]: 1.0,
    [BehaviorPattern.Orbit]: 1.0,
    [BehaviorPattern.Retreat]: 0.8,
    [BehaviorPattern.Wander]: 1.0,
    [BehaviorPattern.Grouping]: 0.4,
    [BehaviorPattern.Ranged]: 1.1,
    [BehaviorPattern.Sniper]: 1.2,
    [BehaviorPattern.Charger]: 0.6,
    [BehaviorPattern.Swarm]: 0.3,
    [BehaviorPattern.Aggressive]: 0.7,
    [BehaviorPattern.Boss]: 0.5,
    [BehaviorPattern.Disruptor]: 0.8, // Maintains loose formation, not rigidly packed
    [BehaviorPattern.Sentinel]: 0.3, // Deliberately clumps — forms shield walls with other sentinels
  };

  init(_entityManager: EntityManagerService): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log(`🏃 Enemy Movement System Initialized`, 'success', {
        worldBounds: { width: this.WORLD_WIDTH, height: this.WORLD_HEIGHT },
      });
    }
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    deltaTime = Math.min(deltaTime, 100); // Cap at ~10fps equivalent

    const deltaSeconds = deltaTime / 1000;

    this.updatePlayerPosition(entityManager);

    const enemies = entityManager.getEntitiesWithComponents(
      EnemyTypeComponent,
      PositionComponent,
      VelocityComponent,
      AIControlledComponent
    );

    if (this.firstUpdate && window.debugLogBridge) {
      window.debugLogBridge.log(`🏃 Enemy Movement System Active - ${enemies.length} enemies found`, 'info', {
        enemyCount: enemies.length,
        playerPosition: this.playerPosition,
        worldBounds: { width: this.WORLD_WIDTH, height: this.WORLD_HEIGHT },
      });
      this.firstUpdate = false;
    }

    if (enemies.length !== this.enemyCount) {
      this.enemyCount = enemies.length;
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`👾 Enemy Count Changed: ${this.enemyCount}`, 'info', { count: this.enemyCount });
      }
    }

    // Build enemy positions cache for separation calculations (avoids O(n²) lookups)
    this.buildEnemyPositionsCache(enemies, entityManager);

    // Periodic cleanup of stuck tracking for entities that no longer exist
    // Also force cleanup if maps exceed safety limit (prevents memory leaks from pool reuse)
    this.stuckCleanupAccumulator += deltaTime;
    const forceCleanup =
      this.stuckTimeAccumulator.size > this.MAX_TRACKED_ENTRIES ||
      this.smoothedSeparation.size > this.MAX_TRACKED_ENTRIES;

    if (this.stuckCleanupAccumulator >= this.STUCK_CLEANUP_INTERVAL_MS || forceCleanup) {
      this.stuckCleanupAccumulator = 0;
      this.reusableCleanupSet.clear();
      for (const e of enemies) this.reusableCleanupSet.add(e);
      const activeEnemyIds = this.reusableCleanupSet;
      for (const trackedId of this.stuckTimeAccumulator.keys()) {
        if (!activeEnemyIds.has(trackedId)) {
          this.stuckTimeAccumulator.delete(trackedId);
        }
      }
      // Also clean up smoothed separation for dead enemies
      for (const trackedId of this.smoothedSeparation.keys()) {
        if (!activeEnemyIds.has(trackedId)) {
          this.smoothedSeparation.delete(trackedId);
        }
      }
    }

    for (const enemyId of enemies) {
      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(enemyId)) {
        continue;
      }

      const position = entityManager.getComponent(enemyId, PositionComponent);
      const velocity = entityManager.getComponent(enemyId, VelocityComponent);
      const ai = entityManager.getComponent(enemyId, AIControlledComponent);
      const enemyType = entityManager.getComponent(enemyId, EnemyTypeComponent);

      if (!position || !velocity || !enemyType || !ai) continue;

      // Handle knockback - overrides AI movement if active
      const knockback = entityManager.getComponent(enemyId, KnockbackComponent);
      if (knockback && knockback.update(deltaTime)) {
        const knockbackVel = knockback.getCurrentVelocity();

        // Apply knockback velocity directly to position, clamped to world bounds
        position.x = Math.max(0, Math.min(this.WORLD_WIDTH, position.x + knockbackVel.vx * deltaSeconds));
        position.y = Math.max(0, Math.min(this.WORLD_HEIGHT, position.y + knockbackVel.vy * deltaSeconds));

        // Set velocity to zero during knockback to prevent AI movement
        velocity.vx = 0;
        velocity.vy = 0;

        continue; // Skip AI movement while under knockback
      }

      // Check if NPC has a target entity (from NPC battle system)
      let targetPosition: { x: number; y: number } | null = null;

      if (ai.npcBattleTargetId !== undefined && ai.targetPriority > 0) {
        // NPC has a target from faction battle system - do lazy lookup instead of using cache
        const targetPos = entityManager.getComponent(ai.npcBattleTargetId, PositionComponent);
        targetPosition = targetPos ? { x: targetPos.x, y: targetPos.y } : null;
      } else if (this.playerPosition) {
        // Default to targeting player
        targetPosition = this.playerPosition;
      }

      const acceleration = entityManager.getComponent(enemyId, AccelerationComponent);

      if (targetPosition && ai.behaviorPattern !== BehaviorPattern.Idle) {
        const speedMultiplier = this.MOVEMENT_SPEEDS[ai.behaviorPattern] || 1.0;

        if (acceleration) {
          acceleration.targetSpeed = speedMultiplier;
          acceleration.lerp(speedMultiplier, deltaSeconds);
        }

        const finalSpeedMultiplier = acceleration ? acceleration.currentSpeed : speedMultiplier;

        // All behaviors now use wanderDirection from AIBehaviorSystem
        // This provides unified movement handling with behavior-specific logic
        if (ai.wanderDirection) {
          // ARCHITECTURAL FIX: Apply separation to wanderDirection BEFORE calculating velocity
          // Previously: velocity was SET from wanderDirection, then separation was applied to velocity
          // Problem: Next frame velocity was SET again, erasing separation effect (one-frame effect)
          // Fix: Blend separation INTO wanderDirection so it persists across frames
          // Reuse pre-allocated _finalDir to avoid per-enemy per-frame allocation.
          const finalDirection = this._finalDir;
          finalDirection.x = ai.wanderDirection.x;
          finalDirection.y = ai.wanderDirection.y;

          let separation: ReturnType<typeof this.calculateSeparationDirection> = null;
          if (ENEMY_SEPARATION_CONFIG.ENABLED) {
            separation = this.calculateSeparationDirection(enemyId, position);
            if (separation && separation.blendFactor > 0) {
              // Scale separation by behavior type (swarm clumps, snipers spread)
              const behaviorScale = this.SEPARATION_BEHAVIOR_SCALE[ai.behaviorPattern] ?? 1.0;
              separation.blendFactor *= behaviorScale;
              // Minimum separation floor to prevent complete stacking (visual clarity)
              separation.blendFactor = Math.max(separation.blendFactor, 0.08);
              // JITTER FIX: Use temporally smoothed separation direction
              // Instead of snapping to new separation direction each frame (causes oscillation),
              // we lerp toward it gradually for smooth, natural movement
              let smoothed = this.smoothedSeparation.get(enemyId);
              if (!smoothed) {
                smoothed = { x: separation.x, y: separation.y };
                this.smoothedSeparation.set(enemyId, smoothed);
              } else {
                // Lerp toward target separation direction (frame-rate independent)
                const smoothingFactor = 1 - Math.exp(-this.SEPARATION_SMOOTHING_RATE * deltaSeconds);
                smoothed.x += (separation.x - smoothed.x) * smoothingFactor;
                smoothed.y += (separation.y - smoothed.y) * smoothingFactor;
              }

              // Blend smoothed separation into direction
              finalDirection.x =
                ai.wanderDirection.x * (1 - separation.blendFactor) + smoothed.x * separation.blendFactor;
              finalDirection.y =
                ai.wanderDirection.y * (1 - separation.blendFactor) + smoothed.y * separation.blendFactor;

              // Normalize the blended direction
              const mag = Math.sqrt(finalDirection.x * finalDirection.x + finalDirection.y * finalDirection.y);
              if (mag > 0.01) {
                finalDirection.x /= mag;
                finalDirection.y /= mag;
              }
            } else {
              // No separation needed - clear smoothed direction so it resets if needed later
              this.smoothedSeparation.delete(enemyId);
            }
          }

          let speed = this.getBaseSpeed(enemyType.type) * finalSpeedMultiplier;

          // Swarm pack pressure: 3+ neighbors within ~75px boosts speed by 1.15x.
          // nearbyCount was already computed inside calculateSeparationDirection —
          // no extra spatial query needed.
          if (ai.behaviorPattern === BehaviorPattern.Swarm && separation !== null && separation.nearbyCount >= 3) {
            speed *= 1.15;
          }

          let vx = finalDirection.x * speed;
          let vy = finalDirection.y * speed;
          if (!Number.isFinite(vx)) vx = 0;
          if (!Number.isFinite(vy)) vy = 0;
          velocity.vx = vx;
          velocity.vy = vy;

          // Territorial guardians: 25% faster when aggroed, 50% faster when returning home
          if (ai.behaviorPattern === BehaviorPattern.TerritorialGuardian) {
            const guardianComp = entityManager.getComponent(enemyId, TerritorialGuardianComponent);
            if (guardianComp?.isLeashed) {
              velocity.vx *= 1.5;
              velocity.vy *= 1.5;
            } else if (guardianComp?.isAggroed) {
              velocity.vx *= 1.25;
              velocity.vy *= 1.25;
            }
          }
        } else {
          // Fallback to direct movement if wanderDirection not set
          this.updateVelocityTowardsTarget(
            position,
            velocity,
            ai,
            enemyType,
            targetPosition,
            deltaSeconds,
            finalSpeedMultiplier
          );
        }
      } else if (acceleration) {
        acceleration.targetSpeed = 0;
        acceleration.lerp(0, deltaSeconds);
      }

      // Dampen sub-pixel velocities that cause visible "dancing" oscillation
      // CRITICAL FIX: Previous threshold of 2 px/frame was too high
      // At 60fps with speed 80 px/s = 1.33 px/frame, enemies would frequently stop
      // New threshold 0.5 only stops truly imperceptible movement
      const velocityMag = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
      if (velocityMag > 0 && velocityMag < 0.5) {
        velocity.vx = 0;
        velocity.vy = 0;
      }

      // Check faction boundaries before applying movement
      const newX = position.x + velocity.vx * deltaSeconds;
      const newY = position.y + velocity.vy * deltaSeconds;

      if (this.canMoveToPosition(enemyId, newX, newY, entityManager)) {
        position.x = newX;
        position.y = newY;
        // Clamp to world bounds — enemies must stay within the playable area
        position.x = Math.max(0, Math.min(this.WORLD_WIDTH, position.x));
        position.y = Math.max(0, Math.min(this.WORLD_HEIGHT, position.y));
        // Clear stuck accumulator on successful movement
        this.stuckTimeAccumulator.delete(enemyId);
      } else {
        // Track stuck time for this enemy (time-based, frame-rate independent)
        const currentStuckTime = (this.stuckTimeAccumulator.get(enemyId) ?? 0) + deltaTime;
        this.stuckTimeAccumulator.set(enemyId, currentStuckTime);

        // If stuck for too long, force a new direction
        if (currentStuckTime >= this.STUCK_THRESHOLD_MS) {
          const blockedDx = newX - position.x;
          const blockedDy = newY - position.y;
          const blockedAngle = Math.atan2(blockedDy, blockedDx);

          // SAFE: Try tangent directions first (slide along boundary), then random escape
          // Left tangent (+90°)
          const leftAngle = blockedAngle + Math.PI / 2;
          const leftX = position.x + Math.cos(leftAngle) * 50;
          const leftY = position.y + Math.sin(leftAngle) * 50;

          // Right tangent (-90°)
          const rightAngle = blockedAngle - Math.PI / 2;
          const rightX = position.x + Math.cos(rightAngle) * 50;
          const rightY = position.y + Math.sin(rightAngle) * 50;

          let escapeAngle: number;

          if (this.canMoveToPosition(enemyId, leftX, leftY, entityManager)) {
            // Prefer left tangent (slide along boundary)
            escapeAngle = leftAngle;
          } else if (this.canMoveToPosition(enemyId, rightX, rightY, entityManager)) {
            // Try right tangent
            escapeAngle = rightAngle;
          } else {
            // Both tangents blocked (corner case) - escape backwards with slight random offset
            escapeAngle = blockedAngle + Math.PI + (Math.random() - 0.5) * 0.5;
          }

          ai.wanderDirection = {
            x: Math.cos(escapeAngle),
            y: Math.sin(escapeAngle),
          };
          ai.lastMovementChange = Date.now();
          this.stuckTimeAccumulator.set(enemyId, 0);
          // Removed direct velocity override - let normal movement system apply wanderDirection
          // This prevents sudden 90-180 degree velocity jumps that cause jitter
        } else {
          // Standard boundary handling: mild velocity reduction and tangent slide
          // Frame-rate independent decay: 0.8 per frame at 60fps = ~0.8^60 per second
          const dampingFactor = Math.pow(0.8, deltaTime / 16.67);
          velocity.vx *= dampingFactor;
          velocity.vy *= dampingFactor;

          // Try to move along the boundary with stronger tangent force
          const tangentX = -velocity.vy * deltaSeconds * 0.5;
          const tangentY = velocity.vx * deltaSeconds * 0.5;

          if (this.canMoveToPosition(enemyId, position.x + tangentX, position.y + tangentY, entityManager)) {
            position.x += tangentX;
            position.y += tangentY;
          }
        }
      }

      position.x = Math.max(0, Math.min(this.WORLD_WIDTH, position.x));
      position.y = Math.max(0, Math.min(this.WORLD_HEIGHT, position.y));

      // HALLS OF TORMENT STYLE: Hard push overlapping enemies apart
      // This runs AFTER position is updated to physically separate stacked enemies
      this.applyHardSeparation(enemyId, position, deltaSeconds);

      // Distance correction: Pull enemies that drift too far back toward combat range
      // FIXED: Uses direct position interpolation instead of velocity modification.
      // Velocity-based pull was ineffective because velocity is overwritten each frame
      // by the AI movement system (wanderDirection → velocity).
      if (this.playerPosition) {
        const MAX_COMBAT_DISTANCE = 700; // Start pulling at this distance
        const HARD_LIMIT_DISTANCE = 1200; // Snap at extreme distances (raised — gradual pull now works)

        const dx = position.x - this.playerPosition.x;
        const dy = position.y - this.playerPosition.y;
        const distanceToPlayer = Math.sqrt(dx * dx + dy * dy);

        if (distanceToPlayer > MAX_COMBAT_DISTANCE) {
          // Unit direction from player to enemy (for position adjustments)
          const dirX = dx / distanceToPlayer;
          const dirY = dy / distanceToPlayer;

          if (distanceToPlayer > HARD_LIMIT_DISTANCE) {
            // Extreme distance — snap to just inside combat range
            // Maintains the same angle from player for visual continuity
            position.x = this.playerPosition.x + dirX * (MAX_COMBAT_DISTANCE - 50);
            position.y = this.playerPosition.y + dirY * (MAX_COMBAT_DISTANCE - 50);
            velocity.vx *= 0.1;
            velocity.vy *= 0.1;
          } else {
            // Gradual position-based pull toward combat range
            // Pull strength scales with excess distance (stronger when further)
            const excessDistance = distanceToPlayer - MAX_COMBAT_DISTANCE;
            const pullStrength = Math.min(excessDistance / 300, 1.0);
            const pullRate = pullStrength * 200 * deltaSeconds; // Max 200 px/sec
            position.x -= dirX * pullRate;
            position.y -= dirY * pullRate;
          }

          // Nudge wanderDirection toward player so AI cooperates with pull
          // Skip retreat/sniper behaviors that intentionally stay far
          if (
            ai.behaviorPattern !== BehaviorPattern.Retreat &&
            ai.behaviorPattern !== BehaviorPattern.Sniper &&
            ai.wanderDirection
          ) {
            const toPlayerX = -dirX;
            const toPlayerY = -dirY;
            ai.wanderDirection.x = ai.wanderDirection.x * 0.7 + toPlayerX * 0.3;
            ai.wanderDirection.y = ai.wanderDirection.y * 0.7 + toPlayerY * 0.3;
          }
        }
      }

      // Re-clamp: distance correction snap/pull can exceed world bounds near edges
      position.x = Math.max(0, Math.min(this.WORLD_WIDTH, position.x));
      position.y = Math.max(0, Math.min(this.WORLD_HEIGHT, position.y));

      // Removed - wander direction should come from AI system
    }
  }

  private updatePlayerPosition(entityManager: EntityManager): void {
    // Update player position only - NPC targets use lazy lookup now
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
    if (players.length > 0) {
      const playerPos = entityManager.getComponent(players[0], PositionComponent);
      if (playerPos) {
        this.playerPosition = { x: playerPos.x, y: playerPos.y };
      }
    }
  }

  private updateVelocityTowardsTarget(
    position: PositionComponent,
    velocity: VelocityComponent,
    ai: AIControlledComponent,
    enemyType: EnemyTypeComponent,
    targetPosition: { x: number; y: number },
    _deltaSeconds: number,
    speedMultiplier: number = 1.0
  ): void {
    const dx = targetPosition.x - position.x;
    const dy = targetPosition.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < ai.detectionRange) {
      const behavior = ai.behaviorPattern;
      const baseSpeed = this.getBaseSpeed(enemyType.type);

      switch (behavior) {
        case BehaviorPattern.Direct:
          this.setDirectMovement(velocity, dx, dy, distance, baseSpeed * speedMultiplier);
          break;
        case BehaviorPattern.Flank:
          this.setFlankMovement(velocity, dx, dy, distance, baseSpeed * speedMultiplier, position);
          break;
        case BehaviorPattern.Orbit:
          this.setOrbitMovement(velocity, dx, dy, distance, baseSpeed * speedMultiplier);
          break;
        default:
          this.setDirectMovement(velocity, dx, dy, distance, baseSpeed * speedMultiplier);
      }
    }
  }

  private setDirectMovement(
    velocity: VelocityComponent,
    dx: number,
    dy: number,
    distance: number,
    speed: number
  ): void {
    if (distance > 0) {
      velocity.vx = (dx / distance) * speed;
      velocity.vy = (dy / distance) * speed;
    }
  }

  private setFlankMovement(
    velocity: VelocityComponent,
    dx: number,
    dy: number,
    distance: number,
    speed: number,
    position: PositionComponent
  ): void {
    if (distance > 0) {
      const flankAngle = Math.atan2(dy, dx) + (Math.sin(position.x * 0.01) > 0 ? Math.PI / 4 : -Math.PI / 4);
      velocity.vx = Math.cos(flankAngle) * speed;
      velocity.vy = Math.sin(flankAngle) * speed;
    }
  }

  private setOrbitMovement(velocity: VelocityComponent, dx: number, dy: number, distance: number, speed: number): void {
    const desiredDistance = this.BEHAVIOR_DISTANCES.orbit;

    if (distance > 0) {
      const tangentX = -dy / distance;
      const tangentY = dx / distance;

      if (distance < desiredDistance * 0.8) {
        velocity.vx = tangentX * speed - (dx / distance) * speed * 0.3;
        velocity.vy = tangentY * speed - (dy / distance) * speed * 0.3;
      } else if (distance > desiredDistance * 1.2) {
        velocity.vx = tangentX * speed + (dx / distance) * speed * 0.3;
        velocity.vy = tangentY * speed + (dy / distance) * speed * 0.3;
      } else {
        velocity.vx = tangentX * speed;
        velocity.vy = tangentY * speed;
      }
    }
  }

  private getBaseSpeed(enemyType: string): number {
    // NOTE: These values should match ENEMY_STATS.*.SPEED in enemy-stats.config.ts
    // They represent pixels per second of movement
    const speeds: Record<string, number> = {
      basic: 90,
      spitter: 60,
      tank: 40,
      swarm: 105,
      thug: 70,
      sniper: 45,
      boss: 30,
      disruptor: 70,
      sentinel: 55,
    };

    return speeds[enemyType] || 60;
  }

  /**
   * Build cache of enemy positions for efficient separation calculations.
   * Also rebuilds the spatial tree for O(n log n) neighbor queries.
   *
   * PERF: Both the positionsCache and spatialEntityPool use pre-allocated slot
   * objects that are mutated in place, avoiding per-frame heap allocation.
   * Pool slots are grown on demand (first time a given index is needed) then
   * reused every subsequent frame.
   */
  private buildEnemyPositionsCache(enemies: Iterable<number>, entityManager: EntityManager): void {
    let writeIndex = 0;

    for (const enemyId of enemies) {
      if (!this.entityFactory.isEntityActive(enemyId)) continue;
      const pos = entityManager.getComponent(enemyId, PositionComponent);
      if (!pos) continue;

      // Reuse existing slot or allocate a new one if the pool hasn't grown this far yet
      if (writeIndex < this.enemyPositionsCache.length) {
        const slot = this.enemyPositionsCache[writeIndex];
        slot.id = enemyId;
        slot.x = pos.x;
        slot.y = pos.y;
      } else {
        this.enemyPositionsCache.push({ id: enemyId, x: pos.x, y: pos.y });
      }

      writeIndex++;
    }

    // Trim stale tail entries from a previous frame with more enemies
    this.enemyPositionsCache.length = writeIndex;

    // Rebuild spatial tree for efficient neighbour queries — O(n log n) separation
    this.enemySpatialTree.clear();
    for (let i = 0; i < writeIndex; i++) {
      const cacheSlot = this.enemyPositionsCache[i];

      // Reuse or grow the parallel SpatialEntity pool
      if (i < this.spatialEntityPool.length) {
        const sp = this.spatialEntityPool[i];
        sp.id = cacheSlot.id;
        sp.x = cacheSlot.x;
        sp.y = cacheSlot.y;
        // radius and collisionGroup are constant — no write needed after first allocation
        this.enemySpatialTree.insert(sp);
      } else {
        const sp = {
          id: cacheSlot.id,
          x: cacheSlot.x,
          y: cacheSlot.y,
          radius: this.ENEMY_RADIUS,
          collisionGroup: 'enemy',
        };
        this.spatialEntityPool.push(sp);
        this.enemySpatialTree.insert(sp);
      }
    }
  }

  /**
   * HALLS OF TORMENT STYLE: Hard position push for overlapping enemies
   * This physically moves enemies apart when they're too close,
   * preventing the "stacking under player" problem.
   *
   * OPTIMIZED: Uses spatial partitioning for O(n log n) instead of O(n²)
   *
   * BALANCED: Push is perpendicular to chase direction when possible,
   * so enemies spread around the player rather than being pushed away.
   */
  private applyHardSeparation(enemyId: number, position: PositionComponent, deltaSeconds: number): void {
    const HARD_PUSH_RADIUS = 35; // Minimum distance between enemy centers
    const PUSH_STRENGTH = 120; // Pixels per second of push force (reduced for balance)

    let pushX = 0;
    let pushY = 0;

    // Query only nearby enemies using spatial partitioning (O(log n) instead of O(n))
    const nearby = this.enemySpatialTree.queryRadius(position.x, position.y, HARD_PUSH_RADIUS * 2);

    for (const other of nearby) {
      if (other.id === enemyId) continue;

      const dx = position.x - other.x;
      const dy = position.y - other.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < HARD_PUSH_RADIUS * HARD_PUSH_RADIUS && distSq > 0) {
        const dist = Math.sqrt(distSq);
        // Push force is stronger the more they overlap
        const overlap = HARD_PUSH_RADIUS - dist;
        const force = (overlap / HARD_PUSH_RADIUS) * PUSH_STRENGTH;

        // Push direction - away from the other enemy
        pushX += (dx / dist) * force;
        pushY += (dy / dist) * force;
      } else if (distSq === 0) {
        // Exactly same position - push in random direction
        const angle = Math.random() * Math.PI * 2;
        pushX += Math.cos(angle) * PUSH_STRENGTH * 0.5;
        pushY += Math.sin(angle) * PUSH_STRENGTH * 0.5;
      }
    }

    // Apply the push
    if (pushX !== 0 || pushY !== 0) {
      position.x += pushX * deltaSeconds;
      position.y += pushY * deltaSeconds;

      // Clamp to world bounds
      position.x = Math.max(0, Math.min(this.WORLD_WIDTH, position.x));
      position.y = Math.max(0, Math.min(this.WORLD_HEIGHT, position.y));
    }
  }

  /**
   * Calculate separation direction for blending with wanderDirection.
   * Writes into the shared _sepResult field and returns it, or returns null when
   * there are no nearby neighbours. The returned reference is _sepResult — callers
   * must not store it across frames.
   *
   * OPTIMIZED: Uses spatial partitioning for O(n log n) instead of O(n²)
   *
   * HALLS OF TORMENT STYLE: Enemies should swarm and approach the player,
   * but spread out perpendicular to their chase direction. This creates
   * the classic "surrounding" behavior rather than piling on one spot.
   */
  private calculateSeparationDirection(
    enemyId: number,
    position: PositionComponent
  ): { x: number; y: number; blendFactor: number; nearbyCount: number } | null {
    const { SEPARATION_RADIUS, SEPARATION_WEIGHT } = ENEMY_SEPARATION_CONFIG;

    let separationX = 0;
    let separationY = 0;
    let nearbyCount = 0;

    // Query only nearby enemies using spatial partitioning (O(log n) instead of O(n))
    const nearby = this.enemySpatialTree.queryRadius(position.x, position.y, SEPARATION_RADIUS * 1.5);

    for (const other of nearby) {
      if (other.id === enemyId) continue;

      const dx = position.x - other.x;
      const dy = position.y - other.y;
      const distSq = dx * dx + dy * dy;
      const radiusSq = SEPARATION_RADIUS * SEPARATION_RADIUS;

      if (distSq < radiusSq && distSq > 0) {
        const dist = Math.sqrt(distSq);
        // Linear falloff - gentler than inverse square
        const strength = 1 - dist / SEPARATION_RADIUS;
        separationX += (dx / dist) * strength;
        separationY += (dy / dist) * strength;
        nearbyCount++;
      }
    }

    if (nearbyCount === 0) {
      return null;
    }

    const sepMag = Math.sqrt(separationX * separationX + separationY * separationY);
    if (sepMag < 0.01) {
      return null;
    }

    // Normalize the separation direction and write into reusable field
    // MODERATE blend: enough to spread out, not enough to prevent approach
    // 20% base + 10% per neighbor, capped at 40%
    this._sepResult.x = separationX / sepMag;
    this._sepResult.y = separationY / sepMag;
    this._sepResult.blendFactor = Math.min(0.2 + nearbyCount * 0.1, 0.4) * SEPARATION_WEIGHT;
    this._sepResult.nearbyCount = nearbyCount;

    return this._sepResult;
  }

  /**
   * Check if an enemy can move to a specific position based on faction territories
   *
   * HALLS OF TORMENT STYLE: Combat is king - territory restrictions should NEVER
   * prevent enemies from reaching the player. Only distant off-screen enemies
   * that are wandering aimlessly are restricted.
   */
  private canMoveToPosition(enemyId: number, x: number, y: number, entityManager: EntityManager): boolean {
    // World bounds check - always enforce
    if (x < 0 || x > this.WORLD_WIDTH || y < 0 || y > this.WORLD_HEIGHT) {
      return false;
    }

    const faction = entityManager.getComponent(enemyId, FactionComponent);
    if (!faction) return true; // No faction = can move anywhere

    const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(x, y);
    if (!territoryInfo) return true; // Neutral territory = anyone can move

    // Check if this is hostile territory
    if (faction.isHostileTo(territoryInfo.kingId)) {
      // COMBAT PRIORITY: If player is anywhere nearby, allow ALL movement
      // This ensures enemies can always chase the player
      if (this.playerPosition) {
        const currentPos = entityManager.getComponent(enemyId, PositionComponent);
        if (currentPos) {
          const dx = this.playerPosition.x - currentPos.x;
          const dy = this.playerPosition.y - currentPos.y;
          const distSquared = dx * dx + dy * dy;
          // Allow crossing within visible range (800px covers most gameplay scenarios)
          if (distSquared < 800 * 800) {
            return true;
          }
        }
      }

      // NPC battle targets - always allow crossing
      const ai = entityManager.getComponent(enemyId, AIControlledComponent);
      if (ai?.targetEntityId || ai?.npcBattleTargetId) {
        return true;
      }

      // Only truly distant, non-combat enemies are restricted
      return false;
    }

    return true; // Allied or own territory = free movement
  }

  /**
   * Clean up tracking data for a dead enemy to prevent memory leaks
   */
  public cleanupDeadEnemy(entityId: number): void {
    this.stuckTimeAccumulator.delete(entityId);
    this.smoothedSeparation.delete(entityId);
  }

  /**
   * Get diagnostic data for debug export
   * Used to diagnose stuck enemies and behavior distribution issues
   */
  public getEnemyDiagnostics(entityManager: EntityManager): {
    behaviorDistribution: Record<string, number>;
    enemyPositionsCacheSize: number;
    velocitySamples: Array<{ id: number; vx: number; vy: number; behavior: string }>;
    stuckEnemyCount: number;
    stuckFrameDistribution: Record<string, number>;
    totalEnemies: number;
  } {
    const behaviorDistribution: Record<string, number> = {};
    const velocitySamples: Array<{ id: number; vx: number; vy: number; behavior: string }> = [];
    let stuckEnemyCount = 0;
    const stuckFrameDistribution: Record<string, number> = { '0': 0, '1-5': 0, '6-11': 0, '12+': 0 };

    const enemies = entityManager.getEntitiesWithComponents(
      EnemyTypeComponent,
      PositionComponent,
      VelocityComponent,
      AIControlledComponent
    );

    let sampleCount = 0;
    const maxSamples = 10;

    for (const enemyId of enemies) {
      if (!this.entityFactory.isEntityActive(enemyId)) continue;

      const ai = entityManager.getComponent(enemyId, AIControlledComponent);
      const velocity = entityManager.getComponent(enemyId, VelocityComponent);

      if (ai) {
        const pattern = ai.behaviorPattern || 'unknown';
        behaviorDistribution[pattern] = (behaviorDistribution[pattern] || 0) + 1;
      }

      // Collect velocity samples (first 10 active enemies)
      if (velocity && sampleCount < maxSamples) {
        velocitySamples.push({
          id: enemyId,
          vx: Math.round(velocity.vx * 100) / 100,
          vy: Math.round(velocity.vy * 100) / 100,
          behavior: ai?.behaviorPattern || 'unknown',
        });
        sampleCount++;
      }

      // Track stuck time distribution (converted from time-based accumulators)
      const stuckTimeMs = this.stuckTimeAccumulator.get(enemyId) ?? 0;
      if (stuckTimeMs === 0) {
        stuckFrameDistribution['0']++;
      } else if (stuckTimeMs <= 83) {
        stuckFrameDistribution['1-5']++;
      } else if (stuckTimeMs < this.STUCK_THRESHOLD_MS) {
        stuckFrameDistribution['6-11']++;
      } else {
        stuckFrameDistribution['12+']++;
        stuckEnemyCount++;
      }
    }

    return {
      behaviorDistribution,
      enemyPositionsCacheSize: this.enemyPositionsCache.length,
      velocitySamples,
      stuckEnemyCount,
      stuckFrameDistribution,
      totalEnemies: enemies.length,
    };
  }

  reset(): void {
    this.playerPosition = null;
    this.stuckTimeAccumulator.clear();
    this.smoothedSeparation.clear();
    this.reusableCleanupSet.clear();
    this.enemyPositionsCache = [];
    this.spatialEntityPool = [];
    this.enemySpatialTree.clear();
    this.stuckCleanupAccumulator = 0;
    this.firstUpdate = true;
    this.enemyCount = 0;
  }

  destroy(): void {
    this.reset();
  }
}
