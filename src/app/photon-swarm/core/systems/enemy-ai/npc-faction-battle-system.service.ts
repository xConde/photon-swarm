import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { EntityManager, System } from '../../ecs/ecs.model';
import { BorderConflictSystemService, FourKingsTerritoryService, TerritoryStrengthSystemService } from '../territory';
import { isGuardianImmune } from '../../combat/guardian-immunity.helper';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { getFactionColors, TERRITORY_SYSTEM_CONFIG } from '@photon/config/game-constants';
import {
  AIControlledComponent,
  DamageComponent,
  EnemyTypeComponent,
  FactionComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
} from '@photon/components';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { ThemeService } from '@services/theme.service';

export interface FactionBattleStats {
  totalBattles: number;
  battlesPerFaction: Map<number, number>;
  casualties: Map<number, number>;
  activeBattles: number;
  lastBattleTime: number;
}

export interface NPCTarget {
  entityId: number;
  faction: number;
  distance: number;
  priority: number;
  isPlayer: boolean;
}

/**
 * NPC Faction Battle System
 *
 * Manages NPC-to-NPC combat based on faction allegiances.
 * Creates dynamic battles between opposing factions.
 */
@Injectable({ providedIn: 'root' })
export class NPCFactionBattleSystemService implements System, OnDestroy {
  // Feature flag to enable/disable NPC combat
  private readonly ENABLE_NPC_COMBAT = true; // NPC faction battles with visual feedback (Session 20)

  // Battle configuration from game constants
  private readonly BATTLE_UPDATE_INTERVAL = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.UPDATE_INTERVAL_MS;
  private readonly TARGET_ACQUISITION_RANGE = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_ACQUISITION_RANGE;
  private readonly COMBAT_RANGE = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.COMBAT_RANGE;
  private readonly RETARGET_INTERVAL = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.RETARGET_INTERVAL_MS;
  private readonly NPC_DAMAGE_MULTIPLIER = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.NPC_DAMAGE_MULTIPLIER;
  private readonly COMBAT_LOG_CHANCE = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.COMBAT_LOG_CHANCE;
  private readonly KILL_TERRITORY_BOOST = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.KILL_TERRITORY_BOOST;

  // Tracking
  private lastUpdateTime = 0;
  private battleStats: FactionBattleStats = {
    totalBattles: 0,
    battlesPerFaction: new Map(),
    casualties: new Map(),
    activeBattles: 0,
    lastBattleTime: 0,
  };

  // Target tracking for each NPC
  private npcTargets = new Map<number, NPCTarget>(); // entityId -> target
  private lastRetargetTime = new Map<number, number>(); // entityId -> last retarget time

  // Visual effect throttling (prevents excessive damage numbers and sparks)
  private lastClashSparkTime = new Map<string, number>(); // "attackerId-targetId" -> timestamp
  private lastDamageNumberTime = new Map<string, number>(); // "attackerId-targetId" -> timestamp
  private accumulatedDamage = new Map<string, number>(); // "attackerId-targetId" -> accumulated damage
  private lastThrottleCleanup = 0;

  // Observable for battle events
  private battleEventsSubject = new BehaviorSubject<FactionBattleStats>(this.battleStats);
  public battleEvents$ = this.battleEventsSubject.asObservable();

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private borderConflictSystem: BorderConflictSystemService,
    private territoryStrengthSystem: TerritoryStrengthSystemService,
    private entityFactory: EntityFactoryECSService,
    private debugLog: DebugLogBridgeService,
    private effectFactory: EffectFactoryService,
    private themeService: ThemeService
  ) {}

  init(_entityManager: EntityManager): void {
    this.debugLog.log('NPC Faction Battle System Initialized', 'info', {
      targetRange: this.TARGET_ACQUISITION_RANGE,
      combatRange: this.COMBAT_RANGE,
    });
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    // Check if NPC combat is enabled
    if (!this.ENABLE_NPC_COMBAT) {
      return;
    }

    const currentTime = window.performance.now();

    // Throttle updates for performance
    if (currentTime - this.lastUpdateTime < this.BATTLE_UPDATE_INTERVAL) {
      return;
    }
    this.lastUpdateTime = currentTime;

    // Update NPC targeting
    this.updateNPCTargeting(entityManager, currentTime);

    // Handle NPC combat
    this.handleNPCCombat(entityManager, deltaTime, currentTime);

    // Update battle statistics
    this.updateBattleStats();

    // Periodic cleanup of stale throttle entries
    const visualConfig = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.VISUAL;
    if (currentTime - this.lastThrottleCleanup > visualConfig.STALE_THROTTLE_CHECK_INTERVAL_MS) {
      this.cleanupStaleThrottleEntries(currentTime, visualConfig.STALE_THROTTLE_CLEANUP_MS);
      this.lastThrottleCleanup = currentTime;
    }
  }

  /**
   * Update targeting for all NPCs
   */
  private updateNPCTargeting(entityManager: EntityManager, currentTime: number): void {
    const npcs = entityManager.getEntitiesWithComponents(
      EnemyTypeComponent,
      FactionComponent,
      PositionComponent,
      AIControlledComponent
    );

    for (const npcId of npcs) {
      // Skip inactive/pooled entities
      if (!this.entityFactory.isEntityActive(npcId)) {
        continue;
      }

      // Check if it's time to retarget
      const lastRetarget = this.lastRetargetTime.get(npcId) || 0;
      if (currentTime - lastRetarget < this.RETARGET_INTERVAL) {
        continue; // Keep current target
      }

      // Find best target for this NPC
      const target = this.findBestTarget(npcId, entityManager);
      if (target) {
        this.npcTargets.set(npcId, target);
        this.lastRetargetTime.set(npcId, currentTime);

        // Update AI component to track target
        const ai = entityManager.getComponent(npcId, AIControlledComponent);
        if (ai) {
          // Store target info in AI component for movement system
          ai.npcBattleTargetId = target.entityId;
          ai.targetPriority = target.priority;
        }
      } else {
        // No valid target, clear targeting
        this.npcTargets.delete(npcId);
        const ai = entityManager.getComponent(npcId, AIControlledComponent);
        if (ai) {
          ai.npcBattleTargetId = undefined;
          ai.targetPriority = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.NONE;
        }
      }
    }
  }

  /**
   * Find the best target for an NPC based on faction and priority
   */
  private findBestTarget(npcId: number, entityManager: EntityManager): NPCTarget | null {
    const npcFaction = entityManager.getComponent(npcId, FactionComponent);
    const npcPosition = entityManager.getComponent(npcId, PositionComponent);

    if (!npcFaction || !npcPosition) return null;

    let bestTarget: NPCTarget | null = null;
    let bestScore = -Infinity;

    // Check if in conflict zone for enhanced targeting
    const inConflictZone = this.borderConflictSystem.isInConflictZone(npcPosition.x, npcPosition.y);
    const conflictFactions = inConflictZone
      ? this.borderConflictSystem.getConflictingFactions(npcPosition.x, npcPosition.y)
      : [];

    // Get all potential targets
    const potentialTargets = entityManager.getEntitiesWithComponents(PositionComponent, HealthComponent);

    for (const targetId of potentialTargets) {
      if (targetId === npcId) continue; // Don't target self

      // Skip inactive entities
      if (!this.entityFactory.isEntityActive(targetId)) {
        continue;
      }

      const targetPosition = entityManager.getComponent(targetId, PositionComponent);
      const targetHealth = entityManager.getComponent(targetId, HealthComponent);

      if (!targetPosition || !targetHealth || targetHealth.health <= 0) continue;

      if (isGuardianImmune(targetId, entityManager)) continue;

      // Calculate distance
      const dx = targetPosition.x - npcPosition.x;
      const dy = targetPosition.y - npcPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Skip if out of range
      if (distance > this.TARGET_ACQUISITION_RANGE) continue;

      // Determine target type and calculate priority
      const isPlayer = entityManager.hasComponent(targetId, PlayerControlledComponent);
      const targetFaction = entityManager.getComponent(targetId, FactionComponent);

      let priority: number;

      if (isPlayer) {
        // Check player's faction relationship
        const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(targetPosition.x, targetPosition.y);

        if (territoryInfo && territoryInfo.kingId === npcFaction.kingId) {
          // Player in our territory - lower priority
          priority = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.PLAYER_FRIENDLY;
        } else if (territoryInfo && territoryInfo.kingId !== npcFaction.kingId) {
          // Player in hostile territory - medium priority
          priority = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.PLAYER_HOSTILE;
        } else {
          // Player in neutral territory - low priority
          priority = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.PLAYER_NEUTRAL;
        }
      } else if (targetFaction) {
        // Another NPC
        if (targetFaction.kingId === npcFaction.kingId) {
          continue; // Same faction, skip
        }

        // Enemy faction NPC - high priority
        priority = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.ENEMY_NPC;

        // Even higher priority if in conflict zone with this faction
        if (conflictFactions.includes(targetFaction.kingId)) {
          priority = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.ENEMY_NPC_CONFLICT;
        }
      } else {
        continue; // No faction, skip
      }

      // Calculate targeting score (higher is better)
      const distanceScore = 1 - distance / this.TARGET_ACQUISITION_RANGE;
      const priorityScore = priority / TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_PRIORITY.ENEMY_NPC_CONFLICT;
      const healthScore = 1 - targetHealth.health / targetHealth.maxHealth; // Prefer wounded targets

      const weights = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.TARGET_SCORE_WEIGHTS;
      const totalScore =
        priorityScore * weights.PRIORITY + distanceScore * weights.DISTANCE + healthScore * weights.HEALTH;

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestTarget = {
          entityId: targetId,
          faction: targetFaction ? targetFaction.kingId : 0,
          distance: distance,
          priority: priority,
          isPlayer: isPlayer,
        };
      }
    }

    return bestTarget;
  }

  /**
   * Handle NPC combat based on their targets
   */
  private handleNPCCombat(entityManager: EntityManager, deltaTime: number, currentTime: number): void {
    const activeBattles = new Set<string>(); // Track unique battles
    const visualConfig = TERRITORY_SYSTEM_CONFIG.NPC_BATTLES.VISUAL;

    for (const [npcId, target] of this.npcTargets.entries()) {
      // Skip if NPC or target is inactive
      if (!this.entityFactory.isEntityActive(npcId) || !this.entityFactory.isEntityActive(target.entityId)) {
        this.npcTargets.delete(npcId);
        continue;
      }

      // Check if in combat range
      if (target.distance > this.COMBAT_RANGE) {
        // Move towards target (handled by movement system with targetEntity)
        continue;
      }

      // Get components for combat
      const npcDamage = entityManager.getComponent(npcId, DamageComponent);
      const npcFaction = entityManager.getComponent(npcId, FactionComponent);
      const npcPosition = entityManager.getComponent(npcId, PositionComponent);
      const targetHealth = entityManager.getComponent(target.entityId, HealthComponent);

      if (!npcDamage || !npcFaction || !npcPosition || !targetHealth) continue;

      // Apply damage (reduced for NPC vs NPC combat)
      const damageAmount = target.isPlayer
        ? npcDamage.contactDamage
        : npcDamage.contactDamage * this.NPC_DAMAGE_MULTIPLIER;

      // Apply damage with proper timing
      const damagePerSecond = damageAmount;

      // Ensure deltaTime is valid (should be in milliseconds from game loop)
      // Cap at 100ms (10fps) to prevent damage spikes after lag
      const validDeltaTime = deltaTime > 0 ? Math.min(deltaTime, 100) : 16;
      const actualDamage = damagePerSecond * (validDeltaTime / 1000);

      targetHealth.health = Math.max(0, targetHealth.health - actualDamage);
      targetHealth.lastDamageSource = 'npc';

      // Fetch target position for visual effects and death effect
      const targetPosition = entityManager.getComponent(target.entityId, PositionComponent);

      // === Visual Effects (throttled) ===
      if (targetPosition && !target.isPlayer) {
        const pairKey = `${npcId}-${target.entityId}`;
        const factionColors = getFactionColors(npcFaction.kingId, this.themeService.isDayMode);

        // Accumulate damage for throttled display
        const accDmg = (this.accumulatedDamage.get(pairKey) || 0) + actualDamage;
        this.accumulatedDamage.set(pairKey, accDmg);

        // Throttled damage number (faction-colored, smaller, transparent)
        // Skip display when accumulated damage rounds to 0 (first-tick micro-damage)
        const lastDmgTime = this.lastDamageNumberTime.get(pairKey) || 0;
        if (currentTime - lastDmgTime >= visualConfig.DAMAGE_NUMBER_THROTTLE_MS && Math.round(accDmg) >= 1) {
          this.effectFactory.createNpcDamageNumber(
            { x: targetPosition.x, y: targetPosition.y },
            accDmg,
            factionColors.primary
          );
          this.accumulatedDamage.set(pairKey, 0);
          this.lastDamageNumberTime.set(pairKey, currentTime);
        }

        // Throttled clash sparks at midpoint
        const lastSpark = this.lastClashSparkTime.get(pairKey) || 0;
        if (currentTime - lastSpark >= visualConfig.CLASH_SPARK_THROTTLE_MS) {
          const midX = (npcPosition.x + targetPosition.x) / 2;
          const midY = (npcPosition.y + targetPosition.y) / 2;
          this.effectFactory.createNpcClashSparks({ x: midX, y: midY }, factionColors.primary);
          this.lastClashSparkTime.set(pairKey, currentTime);
        }
      }

      // Track battle
      const battleKey = `${Math.min(npcFaction.kingId, target.faction)}-${Math.max(npcFaction.kingId, target.faction)}`;
      activeBattles.add(battleKey);

      // Log significant events (configurable sample rate)
      if (Math.random() < this.COMBAT_LOG_CHANCE) {
        this.debugLog.log('NPC Combat', 'info', {
          attacker: { id: npcId, faction: npcFaction.kingId },
          target: { id: target.entityId, faction: target.faction, isPlayer: target.isPlayer },
          damage: actualDamage.toFixed(3),
          targetHealth: `${targetHealth.health.toFixed(0)}/${targetHealth.maxHealth}`,
        });
      }

      // Check for kill (death effect at victim position, territory at attacker position)
      if (targetHealth.health <= 0 && !target.isPlayer) {
        this.handleNPCKill(npcId, target.entityId, npcFaction.kingId, target.faction, npcPosition, targetPosition);

        // Clear killer's combat state so aggro glow turns off immediately
        const killerAi = entityManager.getComponent(npcId, AIControlledComponent);
        if (killerAi) {
          killerAi.npcBattleTargetId = undefined;
        }
      }
    }

    // Update active battle count
    this.battleStats.activeBattles = activeBattles.size;
    if (activeBattles.size > 0) {
      this.battleStats.lastBattleTime = Date.now();
    }
  }

  /**
   * Handle when an NPC kills another NPC
   */
  private handleNPCKill(
    killerId: number,
    victimId: number,
    killerFaction: number,
    victimFaction: number,
    killerPosition: PositionComponent,
    victimPosition?: PositionComponent
  ): void {
    // Update statistics
    this.battleStats.totalBattles++;

    const killerBattles = this.battleStats.battlesPerFaction.get(killerFaction) || 0;
    this.battleStats.battlesPerFaction.set(killerFaction, killerBattles + 1);

    const victimCasualties = this.battleStats.casualties.get(victimFaction) || 0;
    this.battleStats.casualties.set(victimFaction, victimCasualties + 1);

    // Weaken territory where the kill happened (faction warfare affects territory)
    const gridPos = this.fourKingsTerritory.worldToGrid(killerPosition.x, killerPosition.y);
    if (gridPos) {
      // Slightly less impact than player kills (default radius)
      this.territoryStrengthSystem.weakenTilesFromKill(gridPos.gridX, gridPos.gridY);

      // Boost conflict intensity in this area
      this.borderConflictSystem.boostConflictIntensity(gridPos.gridX, gridPos.gridY, this.KILL_TERRITORY_BOOST);
    }

    // Faction-colored death effect at victim's position (fallback to killer position)
    const deathPos = victimPosition || killerPosition;
    const factionColors = getFactionColors(killerFaction, this.themeService.isDayMode);
    this.effectFactory.createNpcDeathEffect({ x: deathPos.x, y: deathPos.y }, factionColors.primary);

    // Clean up throttle tracking for this pair
    const pairKey = `${killerId}-${victimId}`;
    this.lastClashSparkTime.delete(pairKey);
    this.lastDamageNumberTime.delete(pairKey);
    this.accumulatedDamage.delete(pairKey);

    // Clear target for killer
    this.npcTargets.delete(killerId);

    // Log the kill
    this.debugLog.log('NPC Faction Kill', 'success', {
      killer: { id: killerId, faction: killerFaction },
      victim: { id: victimId, faction: victimFaction },
      location: { x: killerPosition.x.toFixed(0), y: killerPosition.y.toFixed(0) },
      stats: {
        totalBattles: this.battleStats.totalBattles,
        activeBattles: this.battleStats.activeBattles,
      },
    });
  }

  /**
   * Update and emit battle statistics
   */
  private updateBattleStats(): void {
    this.battleEventsSubject.next(this.battleStats);
  }

  /**
   * Get current battle statistics
   */
  public getBattleStats(): FactionBattleStats {
    return { ...this.battleStats };
  }

  /**
   * Check if NPC has a target
   */
  public hasTarget(npcId: number): boolean {
    return this.npcTargets.has(npcId);
  }

  /**
   * Get NPC's current target
   */
  public getTarget(npcId: number): NPCTarget | undefined {
    return this.npcTargets.get(npcId);
  }

  /**
   * Force NPC to retarget
   */
  public forceRetarget(npcId: number): void {
    this.lastRetargetTime.delete(npcId);
  }

  /**
   * Clean up all tracking state for a dead entity to prevent memory leaks.
   * Removes both number-keyed Maps (npcTargets, lastRetargetTime) and
   * string-keyed pair Maps (lastClashSparkTime, lastDamageNumberTime, accumulatedDamage).
   */
  public cleanupDeadEnemy(entityId: number): void {
    // Clean number-keyed maps
    this.npcTargets.delete(entityId);
    this.lastRetargetTime.delete(entityId);

    // Clean string-keyed pair maps (keys like "attackerId-targetId")
    const idStr = String(entityId);
    for (const key of this.lastClashSparkTime.keys()) {
      if (key.startsWith(idStr + '-') || key.endsWith('-' + idStr)) {
        this.lastClashSparkTime.delete(key);
      }
    }
    for (const key of this.lastDamageNumberTime.keys()) {
      if (key.startsWith(idStr + '-') || key.endsWith('-' + idStr)) {
        this.lastDamageNumberTime.delete(key);
        this.accumulatedDamage.delete(key);
      }
    }
    for (const key of this.accumulatedDamage.keys()) {
      if (key.startsWith(idStr + '-') || key.endsWith('-' + idStr)) {
        this.accumulatedDamage.delete(key);
      }
    }
  }

  /**
   * Remove stale throttle entries for inactive entity pairs
   */
  private cleanupStaleThrottleEntries(currentTime: number, staleThresholdMs: number): void {
    for (const [key, time] of this.lastClashSparkTime) {
      if (currentTime - time > staleThresholdMs) {
        this.lastClashSparkTime.delete(key);
      }
    }
    for (const [key, time] of this.lastDamageNumberTime) {
      if (currentTime - time > staleThresholdMs) {
        this.lastDamageNumberTime.delete(key);
        this.accumulatedDamage.delete(key);
      }
    }
  }

  /**
   * Reset tracking state for game restart — clears all Maps/Sets and reinitializes battle stats.
   */
  reset(): void {
    this.npcTargets.clear();
    this.lastRetargetTime.clear();
    this.lastClashSparkTime.clear();
    this.lastDamageNumberTime.clear();
    this.accumulatedDamage.clear();
    this.lastUpdateTime = 0;
    this.lastThrottleCleanup = 0;
    this.battleStats = {
      totalBattles: 0,
      battlesPerFaction: new Map(),
      casualties: new Map(),
      activeBattles: 0,
      lastBattleTime: 0,
    };
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.npcTargets.clear();
    this.lastRetargetTime.clear();
    this.lastClashSparkTime.clear();
    this.lastDamageNumberTime.clear();
    this.accumulatedDamage.clear();
    this.battleEventsSubject.complete();
  }

  ngOnDestroy(): void {
    this.destroy();
  }
}
