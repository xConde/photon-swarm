import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import {
  AIControlledComponent,
  EnemyTypeComponent,
  FactionComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ENEMY_SEPARATION_CONFIG, IDLE_BEHAVIOR_CONFIG } from '@photon/config/game-constants';
import { MathUtilsService } from '../../utils/math-utils.service';

/**
 * Idle Behavior System - Brings enemies to life when not in combat
 *
 * Features:
 * - Dancing: Enemies dance with each other when close
 * - Wandering: Organic movement patterns per faction
 * - Patrolling: Territory defense routes
 * - Socializing: Group formations and interactions
 */
@Injectable({ providedIn: 'root' })
export class IdleBehaviorSystemService implements System {
  private lastUpdateTime = 0;
  private lastCleanupTime = 0;
  private playerPosition: { x: number; y: number } | null = null;
  private dancePartners = new Map<number, number>(); // entity -> partner mapping
  private patrolRoutes = new Map<number, { center: { x: number; y: number }; angle: number }>();

  // Spatial partitioning for performance
  private spatialGrid = new Map<string, Set<number>>();
  private gridCellSize = IDLE_BEHAVIOR_CONFIG.SPATIAL_GRID_CELL_SIZE;
  // Pre-allocated Set pool to avoid per-frame allocations in buildSpatialGrid
  private gridSetPool: Set<number>[] = [];
  // Reusable Set for cleanup validity checks
  private reusableValidSet = new Set<number>();

  private entityManager?: EntityManager;

  constructor(private debugLog: DebugLogBridgeService) {}

  init(entityManager: EntityManager): void {
    this.entityManager = entityManager;
    this.debugLog.log('💃 Idle Behavior System initialized', 'info', {
      source: 'idle_behavior_system',
      features: ['dancing', 'wandering', 'patrolling', 'socializing'],
    });
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    const currentTime = Date.now();

    // Throttle updates for performance
    if (currentTime - this.lastUpdateTime < IDLE_BEHAVIOR_CONFIG.UPDATE_INTERVAL) {
      return;
    }
    this.lastUpdateTime = currentTime;

    // Periodic cleanup to prevent memory leaks
    if (currentTime - this.lastCleanupTime > IDLE_BEHAVIOR_CONFIG.CLEANUP_INTERVAL) {
      this.cleanupStaleEntities(entityManager);
      this.lastCleanupTime = currentTime;
    }

    // Update player position
    this.updatePlayerPosition(entityManager);

    if (!this.playerPosition) return;

    // Get all AI-controlled enemies
    const enemies = entityManager.getEntitiesWithComponents(
      EnemyTypeComponent,
      AIControlledComponent,
      PositionComponent,
      VelocityComponent
    );

    // Build spatial grid for efficient neighbor finding
    this.buildSpatialGrid(enemies, entityManager);

    // Process each enemy for idle behaviors
    for (const enemyId of enemies) {
      const position = entityManager.getComponent(enemyId, PositionComponent);
      const ai = entityManager.getComponent(enemyId, AIControlledComponent);
      const velocity = entityManager.getComponent(enemyId, VelocityComponent);

      if (!position || !ai) continue;

      // Check if enemy is idle (far from player)
      const distToPlayer = this.getDistance(position, this.playerPosition);

      // CRITICAL: If enemy is too far, override idle and force return to player
      // This prevents enemies from wandering into the cleanup zone
      if (distToPlayer > ENEMY_SEPARATION_CONFIG.CLEANUP_SAFE_DISTANCE && velocity) {
        this.forceReturnToPlayer(position, velocity, ai, distToPlayer);
        continue;
      }

      const isIdle = distToPlayer > IDLE_BEHAVIOR_CONFIG.IDLE_DISTANCE;

      if (isIdle) {
        // Enemy is idle, apply personality behaviors
        this.applyIdleBehavior(enemyId, position, ai, entityManager, currentTime);
      } else {
        // Enemy is in combat range, clear idle states
        this.clearIdleState(enemyId, ai);
      }
    }

    // Update dance animations
    this.updateDanceAnimations(entityManager, deltaTime);
  }

  private updatePlayerPosition(entityManager: EntityManager): void {
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
    if (players.length > 0) {
      const playerPos = entityManager.getComponent(players[0], PositionComponent);
      if (playerPos) {
        this.playerPosition = { x: playerPos.x, y: playerPos.y };
      }
    }
  }

  private applyIdleBehavior(
    enemyId: number,
    position: PositionComponent,
    ai: AIControlledComponent,
    entityManager: EntityManager,
    currentTime: number
  ): void {
    // Check for nearby allies for social behaviors (optimized with spatial grid)
    const nearbyAllies = this.findNearbyAlliesOptimized(enemyId, position, entityManager);

    // Priority 1: Dancing (most fun!)
    if (nearbyAllies.length > 0 && Math.random() < IDLE_BEHAVIOR_CONFIG.DANCE.CHANCE) {
      const partner = nearbyAllies[0];
      const partnerPos = entityManager.getComponent(partner.id, PositionComponent);

      if (partnerPos && partner.distance < IDLE_BEHAVIOR_CONFIG.DANCE_DISTANCE) {
        this.startDancing(enemyId, partner.id, ai, currentTime);
        return;
      }
    }

    // Priority 2: Socializing (group formations)
    if (nearbyAllies.length >= 2 && Math.random() < IDLE_BEHAVIOR_CONFIG.SOCIAL.CHANCE) {
      this.startSocializing(enemyId, nearbyAllies, ai, entityManager);
      return;
    }

    // Priority 3: Patrolling (territory defense)
    const faction = entityManager.getComponent(enemyId, FactionComponent);
    if (faction && Math.random() < IDLE_BEHAVIOR_CONFIG.PATROL.CHANCE) {
      this.startPatrolling(enemyId, position, ai, faction);
      return;
    }

    // Priority 4: Wandering (default idle behavior)
    this.startWandering(enemyId, ai, entityManager);
  }

  private startDancing(enemyId: number, partnerId: number, ai: AIControlledComponent, currentTime: number): void {
    // Check if already dancing
    if (ai.isDancing) return;

    // Validate partner has AI component
    const partnerAI = this.entityManager?.getComponent(partnerId, AIControlledComponent);
    if (!partnerAI) return;

    // Set up dance state
    ai.isDancing = true;
    ai.danceTargetId = partnerId;
    ai.danceStartTime = currentTime;
    ai.danceStage = Math.random() > 0.5 ? 'bounce' : 'spin';
    ai.spinAngle = 0;
    ai.spinSpeed = (Math.random() * 2 + 1) * (Math.random() > 0.5 ? 1 : -1); // Random spin speed and direction

    // Register dance partnership with size limits
    if (this.dancePartners.size < IDLE_BEHAVIOR_CONFIG.MAX_DANCE_PARTNERS * 2) {
      this.dancePartners.set(enemyId, partnerId);
      this.dancePartners.set(partnerId, enemyId);
    }

    // Set behavior to idle during dance
    ai.behaviorPattern = BehaviorPattern.Idle;
  }

  private startSocializing(
    enemyId: number,
    nearbyAllies: Array<{ id: number; distance: number }>,
    ai: AIControlledComponent,
    entityManager: EntityManager
  ): void {
    // Form a group circle
    ai.behaviorPattern = BehaviorPattern.Grouping;

    // Calculate center of group
    let centerX = 0;
    let centerY = 0;
    let count = 0;

    for (const ally of nearbyAllies.slice(0, 4)) {
      // Max 4 in a group
      const allyPos = entityManager.getComponent(ally.id, PositionComponent);
      if (allyPos) {
        centerX += allyPos.x;
        centerY += allyPos.y;
        count++;
      }
    }

    if (count > 0) {
      centerX /= count;
      centerY /= count;

      // Move towards group center but maintain some distance
      const position = entityManager.getComponent(enemyId, PositionComponent);
      if (position) {
        const dx = centerX - position.x;
        const dy = centerY - position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > IDLE_BEHAVIOR_CONFIG.SOCIAL.GROUP_DISTANCE) {
          ai.wanderDirection = {
            x: (dx / dist) * IDLE_BEHAVIOR_CONFIG.SOCIAL.APPROACH_SPEED,
            y: (dy / dist) * IDLE_BEHAVIOR_CONFIG.SOCIAL.APPROACH_SPEED,
          };
        }
      }
    }
  }

  private startPatrolling(
    enemyId: number,
    position: PositionComponent,
    ai: AIControlledComponent,
    faction: FactionComponent
  ): void {
    // Get or create patrol route with size limits
    if (!this.patrolRoutes.has(enemyId)) {
      if (this.patrolRoutes.size < IDLE_BEHAVIOR_CONFIG.MAX_PATROL_ROUTES) {
        this.patrolRoutes.set(enemyId, {
          center: { x: position.x, y: position.y },
          angle: 0,
        });
      } else {
        return; // Skip patrol if too many routes
      }
    }

    const patrol = this.patrolRoutes.get(enemyId);
    if (!patrol) return; // Safety check

    // Update patrol angle for circular route - faction affects patrol speed
    const factionPatrolConfig = IDLE_BEHAVIOR_CONFIG.FACTION_PATROL[faction.kingId];
    const patrolSpeed = factionPatrolConfig?.speed || IDLE_BEHAVIOR_CONFIG.PATROL.ROTATION_SPEED;

    patrol.angle += patrolSpeed;
    if (patrol.angle > Math.PI * 2) {
      patrol.angle -= Math.PI * 2;
    }

    // Calculate patrol position - faction affects patrol radius
    const radiusMultiplier = factionPatrolConfig?.radius || 1.0;
    const patrolRadius = IDLE_BEHAVIOR_CONFIG.PATROL_RADIUS * radiusMultiplier;

    const patrolX = patrol.center.x + Math.cos(patrol.angle) * patrolRadius;
    const patrolY = patrol.center.y + Math.sin(patrol.angle) * patrolRadius;

    // Set wander direction towards patrol point
    const dx = patrolX - position.x;
    const dy = patrolY - position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 10) {
      ai.wanderDirection = {
        x: (dx / dist) * 0.8, // Patrol speed
        y: (dy / dist) * 0.8,
      };
      ai.behaviorPattern = BehaviorPattern.Wander;
    }
  }

  private startWandering(enemyId: number, ai: AIControlledComponent, entityManager: EntityManager): void {
    const faction = entityManager.getComponent(enemyId, FactionComponent);

    // Faction-specific wander patterns
    let wanderStyle = 'random';
    if (faction) {
      switch (faction.kingId) {
        case 1: // Crimson - aggressive zigzag
          wanderStyle = 'zigzag';
          break;
        case 2: // Azure - defensive circles
          wanderStyle = 'circular';
          break;
        case 3: // Verdant - organic flow
          wanderStyle = 'organic';
          break;
        case 4: // Golden - erratic jumps
          wanderStyle = 'erratic';
          break;
      }
    }

    // Apply wander pattern
    const angle = this.getWanderAngle(wanderStyle, Date.now());
    const speed = this.getWanderSpeed(wanderStyle);

    ai.wanderDirection = {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed,
    };
    ai.behaviorPattern = BehaviorPattern.Wander;
    ai.lastMovementChange = Date.now();
  }

  private getWanderAngle(style: string, time: number): number {
    switch (style) {
      case 'zigzag':
        return (Math.floor(time / 1000) % 2) * Math.PI + Math.random() * 0.5;
      case 'circular':
        return (time / 1000) * 0.5;
      case 'organic':
        return Math.sin(time / 1000) * Math.PI + Math.random() * 0.3;
      case 'erratic':
        return Math.random() * Math.PI * 2;
      default:
        return Math.random() * Math.PI * 2;
    }
  }

  private getWanderSpeed(style: string): number {
    return (
      IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED[style as keyof typeof IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED] ||
      IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED.default
    );
  }

  private updateDanceAnimations(entityManager: EntityManager, deltaTime: number): void {
    const deltaSeconds = deltaTime / 1000;

    for (const [enemyId, partnerId] of this.dancePartners) {
      const ai = entityManager.getComponent(enemyId, AIControlledComponent);
      const position = entityManager.getComponent(enemyId, PositionComponent);
      const velocity = entityManager.getComponent(enemyId, VelocityComponent);
      const renderable = entityManager.getComponent(enemyId, RenderableComponent);

      if (!ai || !position || !velocity || !ai.isDancing) {
        this.dancePartners.delete(enemyId);
        continue;
      }

      // Get partner position
      const partnerPos = entityManager.getComponent(partnerId, PositionComponent);
      if (!partnerPos) {
        this.stopDancing(enemyId, ai);
        continue;
      }

      // Update dance animation
      const danceTime = (Date.now() - (ai.danceStartTime || 0)) / 1000;

      if (ai.danceStage === 'bounce') {
        // Bounce up and down
        const bounceHeight = Math.sin(danceTime * 4) * 5;
        velocity.vx = 0;
        velocity.vy = bounceHeight;

        // Add visual pulse
        if (renderable) {
          renderable.glowIntensity = 0.5 + Math.sin(danceTime * 4) * 0.3;
        }
      } else if (ai.danceStage === 'spin') {
        // Spin around partner
        ai.spinAngle = (ai.spinAngle || 0) + (ai.spinSpeed || 1) * deltaSeconds;

        const radius = 50;
        const targetX = partnerPos.x + Math.cos(ai.spinAngle) * radius;
        const targetY = partnerPos.y + Math.sin(ai.spinAngle) * radius;

        // Move towards spin position
        const dx = targetX - position.x;
        const dy = targetY - position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 5) {
          velocity.vx = (dx / dist) * 100;
          velocity.vy = (dy / dist) * 100;
        }

        // Visual rotation handled by rendering system via spinAngle
        // No need to modify renderable component here
      }

      // Dance for configured duration then stop
      const danceDuration =
        IDLE_BEHAVIOR_CONFIG.DANCE.MIN_DURATION +
        Math.random() * (IDLE_BEHAVIOR_CONFIG.DANCE.MAX_DURATION - IDLE_BEHAVIOR_CONFIG.DANCE.MIN_DURATION);
      if (danceTime > danceDuration) {
        this.stopDancing(enemyId, ai);
      }
    }
  }

  private stopDancing(enemyId: number, ai: AIControlledComponent): void {
    ai.isDancing = false;
    ai.danceTargetId = undefined;
    ai.danceComplete = true;
    ai.behaviorPattern = BehaviorPattern.Wander;

    // Remove from partners map
    const partnerId = this.dancePartners.get(enemyId);
    if (partnerId !== undefined) {
      this.dancePartners.delete(enemyId);
      this.dancePartners.delete(partnerId);
    }
  }

  private clearIdleState(enemyId: number, ai: AIControlledComponent): void {
    if (ai.isDancing) {
      this.stopDancing(enemyId, ai);
    }

    // Clear patrol route
    this.patrolRoutes.delete(enemyId);

    // Reset to combat-ready state
    if (
      ai.behaviorPattern === BehaviorPattern.Idle ||
      ai.behaviorPattern === BehaviorPattern.Wander ||
      ai.behaviorPattern === BehaviorPattern.Grouping
    ) {
      ai.behaviorPattern = BehaviorPattern.Direct; // Default combat behavior
    }
  }

  /**
   * Force enemy to return toward player when too close to cleanup boundary
   * This prevents enemies from wandering off and getting cleaned up
   */
  private forceReturnToPlayer(
    position: PositionComponent,
    velocity: VelocityComponent,
    ai: AIControlledComponent,
    distToPlayer: number
  ): void {
    if (!this.playerPosition) return;

    // Clear any idle states
    ai.isDancing = false;
    ai.danceTargetId = undefined;
    ai.behaviorPattern = BehaviorPattern.Direct;

    // Calculate direction toward player
    const dx = this.playerPosition.x - position.x;
    const dy = this.playerPosition.y - position.y;
    const dist = distToPlayer > 0 ? distToPlayer : 1;

    // Urgency increases as enemy gets closer to cleanup boundary
    const safeDistance = ENEMY_SEPARATION_CONFIG.CLEANUP_SAFE_DISTANCE;
    const urgency = Math.min(1.0, (distToPlayer - safeDistance) / 500 + 0.5);
    const returnSpeed = 100 * urgency;

    // Set velocity toward player
    velocity.vx = (dx / dist) * returnSpeed;
    velocity.vy = (dy / dist) * returnSpeed;
  }

  private getDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return MathUtilsService.distance(a.x, a.y, b.x, b.y);
  }

  /**
   * Build spatial grid for O(1) neighbor lookups
   */
  private buildSpatialGrid(enemies: number[], entityManager: EntityManager): void {
    // Return used Sets to the pool before clearing the grid
    for (const cellSet of this.spatialGrid.values()) {
      cellSet.clear();
      this.gridSetPool.push(cellSet);
    }
    this.spatialGrid.clear();

    for (const enemyId of enemies) {
      const position = entityManager.getComponent(enemyId, PositionComponent);
      if (!position) continue;

      const gridX = Math.floor(position.x / this.gridCellSize);
      const gridY = Math.floor(position.y / this.gridCellSize);
      const key = `${gridX},${gridY}`;

      let cellSet = this.spatialGrid.get(key);
      if (!cellSet) {
        cellSet = this.gridSetPool.pop() || new Set();
        this.spatialGrid.set(key, cellSet);
      }
      cellSet.add(enemyId);
    }
  }

  /**
   * Find nearby allies using spatial grid - O(1) average case
   */
  private findNearbyAlliesOptimized(
    enemyId: number,
    position: PositionComponent,
    entityManager: EntityManager
  ): Array<{ id: number; distance: number }> {
    const allies: Array<{ id: number; distance: number }> = [];
    const faction = entityManager.getComponent(enemyId, FactionComponent);

    // Check current cell and neighboring cells
    const gridX = Math.floor(position.x / this.gridCellSize);
    const gridY = Math.floor(position.y / this.gridCellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gridX + dx},${gridY + dy}`;
        const cellEnemies = this.spatialGrid.get(key);

        if (!cellEnemies) continue;

        for (const otherId of cellEnemies) {
          if (otherId === enemyId) continue;

          const otherPos = entityManager.getComponent(otherId, PositionComponent);
          const otherFaction = entityManager.getComponent(otherId, FactionComponent);

          if (!otherPos || !otherFaction) continue;

          // Check if same faction
          if (faction && otherFaction.kingId !== faction.kingId) continue;

          const distance = this.getDistance(position, otherPos);
          if (distance < IDLE_BEHAVIOR_CONFIG.SOCIAL_DISTANCE) {
            allies.push({ id: otherId, distance });
          }
        }
      }
    }

    // Sort by distance
    allies.sort((a, b) => a.distance - b.distance);
    return allies;
  }

  /**
   * Clean up stale entities to prevent memory leaks
   */
  private cleanupStaleEntities(entityManager: EntityManager): void {
    this.reusableValidSet.clear();
    for (const id of entityManager.getEntitiesWithComponents(EnemyTypeComponent)) {
      this.reusableValidSet.add(id);
    }
    const validEntities = this.reusableValidSet;

    // Clean dance partners
    for (const [id] of this.dancePartners) {
      if (!validEntities.has(id)) {
        const partnerId = this.dancePartners.get(id);
        this.dancePartners.delete(id);
        if (partnerId !== undefined) {
          this.dancePartners.delete(partnerId);
        }
      }
    }

    // Clean patrol routes
    for (const [id] of this.patrolRoutes) {
      if (!validEntities.has(id)) {
        this.patrolRoutes.delete(id);
      }
    }

    // Size-based cleanup if maps grow too large
    if (this.dancePartners.size > IDLE_BEHAVIOR_CONFIG.MAX_DANCE_PARTNERS * 2) {
      // Keep only the most recent entries
      const entriesToKeep = IDLE_BEHAVIOR_CONFIG.MAX_DANCE_PARTNERS;
      const entries = Array.from(this.dancePartners.entries());
      this.dancePartners.clear();
      for (let i = entries.length - entriesToKeep * 2; i < entries.length; i++) {
        if (entries[i]) {
          this.dancePartners.set(entries[i][0], entries[i][1]);
        }
      }
    }

    if (this.patrolRoutes.size > IDLE_BEHAVIOR_CONFIG.MAX_PATROL_ROUTES) {
      // Keep only the most recent entries
      const entriesToKeep = Math.floor(IDLE_BEHAVIOR_CONFIG.MAX_PATROL_ROUTES * 0.8);
      const entries = Array.from(this.patrolRoutes.entries());
      this.patrolRoutes.clear();
      for (let i = entries.length - entriesToKeep; i < entries.length; i++) {
        if (entries[i]) {
          this.patrolRoutes.set(entries[i][0], entries[i][1]);
        }
      }
    }
  }

  /**
   * Clean up tracking data for a dead enemy to prevent memory leaks
   */
  public cleanupDeadEnemy(entityId: number): void {
    // Remove from dance partners (also remove partner's reference)
    const partnerId = this.dancePartners.get(entityId);
    if (partnerId !== undefined) {
      this.dancePartners.delete(partnerId);
    }
    this.dancePartners.delete(entityId);

    // Remove patrol route
    this.patrolRoutes.delete(entityId);
  }

  /**
   * Get tracking map sizes for debug export diagnostics
   * Used to detect memory leaks in idle behavior tracking
   */
  public getTrackingMapSizes(): {
    dancePartners: number;
    patrolRoutes: number;
    spatialGridCells: number;
  } {
    return {
      dancePartners: this.dancePartners.size,
      patrolRoutes: this.patrolRoutes.size,
      spatialGridCells: this.spatialGrid.size,
    };
  }

  /**
   * Reset all tracking data for game restart (called from GameEngine.reset())
   */
  reset(): void {
    this.destroy();
  }

  destroy(): void {
    this.dancePartners.clear();
    this.patrolRoutes.clear();
    this.spatialGrid.clear();
  }
}
