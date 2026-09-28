import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { WORLD_CONFIG } from '@photon/config/game-constants';
import { FourKingsTerritoryService } from '../territory';
import { createFactionComponent, FactionComponent } from '@photon/components/faction.component';
import {
  AIControlledComponent,
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
} from '@photon/components';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { QuadTreeNode, SpatialEntity } from '../../utils/quadtree';
import { MathUtilsService } from '../../utils/math-utils.service';

/**
 * Faction AI System
 *
 * Manages faction-based behaviors for enemies:
 * - Applies faction bonuses to stats
 * - Handles inter-faction combat
 * - Manages faction-specific AI behaviors
 * - Spawns enemies based on territory control
 */
@Injectable({ providedIn: 'root' })
export class FactionAISystemService implements System {
  private readonly AI_UPDATE_INTERVAL = 100; // Update AI every 100ms
  private readonly FACTION_COMBAT_RANGE = 150; // Range for inter-faction combat
  private lastAIUpdate = 0;
  private bonusesApplied = new Set<number>(); // Track entities that have had bonuses applied

  // Spatial partitioning for O(log n) faction combat queries
  private readonly WORLD_WIDTH = WORLD_CONFIG.BOUNDS.WIDTH;
  private readonly WORLD_HEIGHT = WORLD_CONFIG.BOUNDS.HEIGHT;
  private factionSpatialTree: QuadTreeNode;
  private factionEntityCache = new Map<number, SpatialEntity>(); // Cache for spatial lookup

  // Verdant faction regeneration tracking
  private readonly VERDANT_REGEN_INTERVAL = 1000; // Heal every 1 second
  private readonly VERDANT_REGEN_AMOUNT = 2; // Heal 2 HP per tick
  private readonly VERDANT_REGEN_IN_COMBAT_MULTIPLIER = 0.5; // Half healing in combat
  private lastVerdantRegenTime = new Map<number, number>(); // Track last heal time per entity
  // Reusable Set for cleanup validity checks (avoids per-call allocation)
  private reusableValidSet = new Set<number>();

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private debugBridge: DebugLogBridgeService
  ) {
    // Initialize spatial tree for faction combat queries
    this.factionSpatialTree = new QuadTreeNode(
      { x: 0, y: 0, width: this.WORLD_WIDTH, height: this.WORLD_HEIGHT },
      10, // maxEntities per node
      5 // maxDepth
    );
  }

  init(entityManager: EntityManager): void {
    // Assign factions to existing enemies based on their current territory
    this.assignFactionsToExistingEnemies(entityManager);
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = window.performance.now();

    // Throttle AI updates for performance
    if (currentTime - this.lastAIUpdate < this.AI_UPDATE_INTERVAL) {
      return;
    }
    this.lastAIUpdate = currentTime;

    // Build spatial tree for efficient faction combat queries
    this.buildFactionSpatialTree(entityManager);

    // Update faction-based behaviors
    this.updateFactionBehaviors(entityManager);

    // Handle inter-faction combat
    this.handleInterFactionCombat(entityManager);

    // Apply faction bonuses
    this.applyFactionBonuses(entityManager);

    // Apply Verdant faction regeneration
    this.applyVerdantRegeneration(entityManager, currentTime);
  }

  /**
   * Build spatial tree for faction combat queries
   * Called once per update cycle (every 100ms) for O(n log n) vs O(n²)
   */
  private buildFactionSpatialTree(entityManager: EntityManager): void {
    this.factionSpatialTree.clear();
    this.factionEntityCache.clear();

    const factionedEnemies = entityManager.getEntitiesWithComponents(
      FactionComponent,
      PositionComponent,
      HealthComponent
    );

    for (const enemyId of factionedEnemies) {
      const position = entityManager.getComponent(enemyId, PositionComponent);
      const faction = entityManager.getComponent(enemyId, FactionComponent);
      if (!position || !faction) continue;

      const spatialEntity: SpatialEntity = {
        id: enemyId,
        x: position.x,
        y: position.y,
        radius: 25, // Standard enemy radius
        collisionGroup: `faction_${faction.kingId}`, // Encode faction in collision group
      };

      this.factionSpatialTree.insert(spatialEntity);
      this.factionEntityCache.set(enemyId, spatialEntity);
    }
  }

  /**
   * Assign factions to enemies that don't have them
   */
  private assignFactionsToExistingEnemies(entityManager: EntityManager): void {
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);

    enemies.forEach((enemyId) => {
      // Skip if already has faction
      if (entityManager.hasComponent(enemyId, FactionComponent)) {
        return;
      }

      const position = entityManager.getComponent(enemyId, PositionComponent);
      if (!position) return;

      // Determine faction based on current territory
      const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(position.x, position.y);
      const factionKingId = territoryInfo ? territoryInfo.kingId : Math.floor(Math.random() * 4) + 1; // In neutral territory, assign random faction

      const factionComponent = createFactionComponent(factionKingId);
      if (factionComponent) {
        entityManager.addComponent(enemyId, factionComponent);

        // Apply faction visual styling
        this.applyFactionVisuals(enemyId, factionComponent, entityManager);

        // Apply faction stat bonuses immediately for new faction assignments
        if (!this.bonusesApplied.has(enemyId)) {
          this.applyFactionStatBonuses(enemyId, factionComponent, entityManager);
          this.bonusesApplied.add(enemyId);
        }
      }
    });
  }

  /**
   * Update faction-specific behaviors
   */
  private updateFactionBehaviors(entityManager: EntityManager): void {
    const factionedEnemies = entityManager.getEntitiesWithComponents(
      FactionComponent,
      EnemyTypeComponent,
      PositionComponent,
      AIControlledComponent
    );

    factionedEnemies.forEach((enemyId) => {
      const faction = entityManager.getComponent(enemyId, FactionComponent);
      const position = entityManager.getComponent(enemyId, PositionComponent);
      const ai = entityManager.getComponent(enemyId, AIControlledComponent);

      if (!faction || !position || !ai) return;

      // Check if enemy is in their faction's territory
      const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(position.x, position.y);
      const inHomeTerr = territoryInfo && territoryInfo.kingId === faction.kingId;

      // Modify AI behavior based on faction and territory
      this.applyFactionAIModifiers(enemyId, faction, inHomeTerr || false, ai, entityManager);
    });
  }

  // Track which entities have had their base detection range modified
  private detectionRangeModified = new Set<number>();

  /**
   * Apply faction-specific AI behavior modifiers
   * FIX: Only apply detection range modifiers ONCE (not every update)
   * FIX: Only modify behavior if enemy is in combat mode (not wandering)
   */
  private applyFactionAIModifiers(
    enemyId: number,
    faction: FactionComponent,
    _inHomeTerritory: boolean,
    ai: AIControlledComponent,
    entityManager: EntityManager
  ): void {
    // FIX: Apply detection range modifier only once per entity
    if (!this.detectionRangeModified.has(enemyId)) {
      switch (faction.kingId) {
        case 1: // Crimson King - Aggressive berserkers
          ai.detectionRange *= faction.getBehaviorModifier('aggro_range');
          break;
        case 2: // Azure King - Defensive formations
          ai.detectionRange *= 0.8;
          break;
        case 3: // Verdant King - Swarm tactics (base range unchanged)
          break;
        case 4: // Shadow King - Hit and run (base range unchanged)
          break;
      }
      this.detectionRangeModified.add(enemyId);
    }

    // FIX: Only modify behavior if enemy is actively chasing (not wandering/idle)
    // This respects the ai-behavior-system's wander logic when player is out of range
    if (ai.behaviorPattern === BehaviorPattern.Wander || ai.behaviorPattern === BehaviorPattern.Idle) {
      return; // Don't override wander/idle - let ai-behavior-system handle it
    }

    // Apply faction-specific combat behaviors
    switch (faction.kingId) {
      case 1: // Crimson King - Aggressive berserkers
        ai.behaviorPattern = BehaviorPattern.Direct;
        break;

      case 2: // Azure King - Defensive formations
        ai.behaviorPattern = BehaviorPattern.Orbit;
        break;

      case 3: {
        // Verdant King - Swarm tactics
        const nearbyAllies = this.findNearbyAllies(enemyId, faction.kingId, 80, entityManager);
        if (nearbyAllies.length >= 2) {
          ai.behaviorPattern = BehaviorPattern.Grouping;
        }
        // If alone, keep current behavior (don't force wander - that's handled elsewhere)
        break;
      }

      case 4: // Shadow King - Hit and run
        ai.behaviorPattern = BehaviorPattern.Flank;
        break;
    }
  }

  /**
   * Handle combat between different factions
   * Optimized: Uses spatial partitioning for O(n log n) instead of O(n²)
   */
  private handleInterFactionCombat(entityManager: EntityManager): void {
    // Iterate through all faction entities (spatial tree already built in buildFactionSpatialTree)
    for (const [enemyId, spatialEntity] of this.factionEntityCache) {
      const faction = entityManager.getComponent(enemyId, FactionComponent);
      if (!faction) continue;

      // Use spatial tree to find nearby enemies in O(log n)
      const nearbySpatial = this.factionSpatialTree.queryRadius(
        spatialEntity.x,
        spatialEntity.y,
        this.FACTION_COMBAT_RANGE
      );

      // Filter for hostile factions only
      let closestId = -1;
      let closestDistSq = Infinity;

      for (const other of nearbySpatial) {
        if (other.id === enemyId) continue;

        // Extract faction from collision group (faction_1, faction_2, etc.)
        const otherFactionId = parseInt(other.collisionGroup.split('_')[1], 10);

        // Check if factions are hostile
        if (!faction.isHostileTo(otherFactionId)) continue;

        // Track closest hostile (use squared distance for performance)
        const dx = spatialEntity.x - other.x;
        const dy = spatialEntity.y - other.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < closestDistSq) {
          closestDistSq = distSq;
          closestId = other.id;
        }
      }

      // If hostile enemies nearby, modify AI to target them instead of player
      if (closestId !== -1) {
        const ai = entityManager.getComponent(enemyId, AIControlledComponent);
        if (ai) {
          ai.targetEntityId = closestId;
          ai.behaviorPattern = BehaviorPattern.Direct;
        }
      }
    }
  }

  /**
   * Apply faction bonuses to enemy stats
   */
  private applyFactionBonuses(entityManager: EntityManager): void {
    const factionedEnemies = entityManager.getEntitiesWithComponents(FactionComponent, EnemyTypeComponent);

    // Clean up Sets of destroyed entities periodically
    if (this.bonusesApplied.size > 100 || this.detectionRangeModified.size > 100) {
      this.reusableValidSet.clear();
      for (const id of factionedEnemies) this.reusableValidSet.add(id);
      const validEnemies = this.reusableValidSet;
      this.bonusesApplied.forEach((id) => {
        if (!validEnemies.has(id)) {
          this.bonusesApplied.delete(id);
        }
      });
      this.detectionRangeModified.forEach((id) => {
        if (!validEnemies.has(id)) {
          this.detectionRangeModified.delete(id);
        }
      });
    }

    factionedEnemies.forEach((enemyId) => {
      const health = entityManager.getComponent(enemyId, HealthComponent);

      // Check if this entity needs bonuses applied
      // If health exists and hasn't been modified (health == maxHealth from config), apply bonuses
      // This handles pooled entities that get reused with fresh components
      if (this.bonusesApplied.has(enemyId) && health) {
        // Check if this is a fresh health component (not yet modified by faction bonus)
        const enemyType = entityManager.getComponent(enemyId, EnemyTypeComponent);
        const faction = entityManager.getComponent(enemyId, FactionComponent);
        if (enemyType && faction) {
          // Get base health for this enemy type
          const baseHealth = this.getBaseHealthForType(enemyType.type);
          // If current health matches base (unmodified), remove from set to reapply bonus
          if (Math.abs(health.maxHealth - baseHealth) < 0.01) {
            this.bonusesApplied.delete(enemyId);
          }
        }
      }

      // Skip if bonuses already applied to this entity
      if (this.bonusesApplied.has(enemyId)) {
        return;
      }

      const faction = entityManager.getComponent(enemyId, FactionComponent);
      const enemyType = entityManager.getComponent(enemyId, EnemyTypeComponent);

      if (!faction || !enemyType) return;

      // Apply faction bonuses and mark as applied
      this.applyFactionStatBonuses(enemyId, faction, entityManager);
      this.bonusesApplied.add(enemyId);
    });
  }

  /**
   * Get base health for enemy type (before any modifiers)
   */
  private getBaseHealthForType(type: string): number {
    // Import from game constants
    const baseHealthMap: Record<string, number> = {
      basic: 30,
      spitter: 40,
      tank: 100,
      swarm: 50,
      thug: 60,
      sniper: 45,
      boss: 500,
    };
    return baseHealthMap[type] || 30;
  }

  /**
   * Apply faction-specific stat bonuses
   * FIX: Added validation to prevent health corruption from invalid modifiers
   */
  private applyFactionStatBonuses(enemyId: number, faction: FactionComponent, entityManager: EntityManager): void {
    const health = entityManager.getComponent(enemyId, HealthComponent);
    const damage = entityManager.getComponent(enemyId, DamageComponent);

    faction.behaviors.forEach((behavior) => {
      // FIX: Validate modifier before applying to prevent NaN/Infinity corruption
      const modifier = behavior.modifier;
      if (!isFinite(modifier) || modifier <= 0 || modifier > 10) {
        // Skip invalid modifiers - must be finite, positive, and within reasonable bounds (0-10x)
        this.debugBridge.log('Invalid behavior modifier skipped', 'warning', {
          source: 'faction-ai-system',
          entityId: enemyId,
          behaviorType: behavior.type,
          invalidModifier: modifier,
        });
        return;
      }

      switch (behavior.type) {
        case 'health':
          if (health) {
            const newMaxHealth = health.maxHealth * modifier;
            // FIX: Validate result is within bounds (max 5000 for enemies)
            if (isFinite(newMaxHealth) && newMaxHealth > 0 && newMaxHealth <= 5000) {
              health.maxHealth = newMaxHealth;
              health.health = health.maxHealth; // Heal to full with new max
            }
          }
          break;

        case 'damage':
          if (damage) {
            const newDamage = damage.contactDamage * modifier;
            // FIX: Validate result is within bounds
            if (isFinite(newDamage) && newDamage > 0 && newDamage <= 500) {
              damage.contactDamage = newDamage;
            }
          }
          break;

        case 'speed':
          // Speed modifier would be applied in movement system
          // Store it in a component for later use
          break;
      }
    });
  }

  /**
   * Apply faction visual styling to enemies
   */
  private applyFactionVisuals(enemyId: number, faction: FactionComponent, entityManager: EntityManager): void {
    // Apply faction colors to renderable component
    const renderable = entityManager.getComponent(enemyId, RenderableComponent);
    if (renderable) {
      // Use the faction's primary color
      const factionColor = faction.colors.primary;
      renderable.color = factionColor;

      // Add subtle glow for faction identification
      renderable.glowIntensity = 0.3;

      this.debugBridge.log('Faction Visuals Applied', 'success', {
        source: 'faction-ai-system',
        entityId: enemyId,
        kingId: faction.kingId,
        kingName: faction.kingName,
        appliedColor: factionColor,
        glowIntensity: renderable.glowIntensity,
      });
    } else {
      this.debugBridge.log('No Renderable Component Found', 'warning', {
        source: 'faction-ai-system',
        entityId: enemyId,
        kingId: faction.kingId,
      });
    }
  }

  /**
   * Find nearby allies of the same faction
   * Optimized: Uses spatial partitioning for O(log n) instead of O(n)
   */
  private findNearbyAllies(enemyId: number, kingId: number, range: number, _entityManager: EntityManager): number[] {
    const spatialEntity = this.factionEntityCache.get(enemyId);
    if (!spatialEntity) return [];

    // Use spatial tree to find nearby entities in O(log n)
    const nearbySpatial = this.factionSpatialTree.queryRadius(spatialEntity.x, spatialEntity.y, range);

    const allies: number[] = [];
    const targetFactionGroup = `faction_${kingId}`;

    for (const other of nearbySpatial) {
      if (other.id === enemyId) continue;

      // Check if same faction using the collision group
      if (other.collisionGroup === targetFactionGroup) {
        allies.push(other.id);
      }
    }

    return allies;
  }

  /**
   * Apply Verdant faction regeneration ability
   */
  private applyVerdantRegeneration(entityManager: EntityManager, currentTime: number): void {
    // Clean up dead/pooled entities from tracking Map periodically
    if (this.lastVerdantRegenTime.size > 100) {
      // Clean up entries for entities that no longer exist
      this.reusableValidSet.clear();
      for (const id of entityManager.getEntitiesWithComponents(FactionComponent, HealthComponent)) {
        this.reusableValidSet.add(id);
      }
      const validEntities = this.reusableValidSet;

      for (const [entityId] of this.lastVerdantRegenTime) {
        if (!validEntities.has(entityId)) {
          this.lastVerdantRegenTime.delete(entityId);
        }
      }
    }

    // Get all Verdant faction enemies
    const verdantEnemies = entityManager.getEntitiesWithComponents(
      FactionComponent,
      EnemyTypeComponent,
      HealthComponent
    );

    verdantEnemies.forEach((enemyId) => {
      const faction = entityManager.getComponent(enemyId, FactionComponent);
      const health = entityManager.getComponent(enemyId, HealthComponent);

      if (!faction || !health || faction.kingId !== 3) return; // Only Verdant (kingId = 3)

      // Check if enemy is at full health
      if (health.health >= health.maxHealth) {
        this.lastVerdantRegenTime.delete(enemyId); // Reset timer if at full health
        return;
      }

      // Check regeneration timer
      const lastRegenTime = this.lastVerdantRegenTime.get(enemyId) || 0;
      if (currentTime - lastRegenTime < this.VERDANT_REGEN_INTERVAL) {
        return; // Not time to heal yet
      }

      // Check if in combat (near player or hostile enemies)
      const position = entityManager.getComponent(enemyId, PositionComponent);
      let inCombat = false;

      if (position) {
        // Check if player is nearby
        const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
        for (const playerId of playerEntities) {
          const playerPos = entityManager.getComponent(playerId, PositionComponent);
          if (playerPos) {
            const dist = MathUtilsService.distance(playerPos.x, playerPos.y, position.x, position.y);
            if (dist < 300) {
              inCombat = true;
              break;
            }
          }
        }
      }

      // Skip combat-unready enemies (e.g. freshly spawned, still fading in)
      const renderable = entityManager.getComponent(enemyId, RenderableComponent);
      if (renderable && !renderable.isCombatReady(currentTime)) return;

      // Calculate regen amount with safety checks
      const baseRegen = this.VERDANT_REGEN_AMOUNT;
      const regenModifier = Math.min(faction.getBehaviorModifier('special_ability'), 3.0); // Cap at 3x to prevent exploits
      const combatModifier = inCombat ? this.VERDANT_REGEN_IN_COMBAT_MULTIPLIER : 1.0;
      const regenAmount = Math.min(baseRegen * regenModifier * combatModifier, 10); // Cap at 10 HP per tick

      // Validate health values before healing
      if (!isFinite(health.health) || !isFinite(health.maxHealth) || health.health < 0 || health.maxHealth <= 0) {
        this.lastVerdantRegenTime.delete(enemyId); // Remove corrupted entity
        return;
      }

      // Apply healing
      const newHealth = Math.min(health.health + regenAmount, health.maxHealth);
      const actualHealing = newHealth - health.health;

      if (actualHealing > 0) {
        health.health = newHealth;
        this.lastVerdantRegenTime.set(enemyId, currentTime);
      }
    });
  }

  /**
   * Get faction statistics for debugging
   */
  getFactionStats(entityManager: EntityManager): Record<number, { count: number; name: string }> {
    const factionedEnemies = entityManager.getEntitiesWithComponents(FactionComponent);
    const stats: Record<number, { count: number; name: string }> = {};

    factionedEnemies.forEach((enemyId) => {
      const faction = entityManager.getComponent(enemyId, FactionComponent);
      if (!faction) return;

      if (!stats[faction.kingId]) {
        stats[faction.kingId] = { count: 0, name: faction.kingName };
      }
      stats[faction.kingId].count++;
    });

    return stats;
  }

  /**
   * Clean up tracking data for a dead enemy to prevent memory leaks
   */
  public cleanupDeadEnemy(entityId: number): void {
    this.bonusesApplied.delete(entityId);
    this.detectionRangeModified.delete(entityId);
    this.lastVerdantRegenTime.delete(entityId);
  }

  /**
   * Get tracking map sizes for debug export diagnostics
   * Used to detect memory leaks in faction tracking
   */
  public getTrackingMapSizes(): {
    bonusesApplied: number;
    detectionRangeModified: number;
    lastVerdantRegenTime: number;
    factionEntityCache: number;
  } {
    return {
      bonusesApplied: this.bonusesApplied.size,
      detectionRangeModified: this.detectionRangeModified.size,
      lastVerdantRegenTime: this.lastVerdantRegenTime.size,
      factionEntityCache: this.factionEntityCache.size,
    };
  }

  /**
   * Reset all tracking data for game restart (called from GameEngine.reset())
   */
  reset(): void {
    this.destroy();
  }

  destroy(): void {
    // Cleanup tracking maps
    this.lastVerdantRegenTime.clear();
    this.detectionRangeModified.clear();
    this.bonusesApplied.clear();

    // Cleanup spatial partitioning
    this.factionSpatialTree.clear();
    this.factionEntityCache.clear();
  }
}
