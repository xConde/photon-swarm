import { Injectable } from '@angular/core';
import { EnemyType } from '../../models/enemy.model';
import { TerritoryGridService } from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { SPAWN_CONFIG } from '@photon/config/game-constants';

/**
 * Faction Spawn Weights Service
 *
 * CRITICAL: This service ensures ALL enemy types spawn in ALL territories!
 * Factions only provide SLIGHT weight modifications, not exclusions.
 *
 * For example:
 * - Crimson territory: ALL enemies spawn, just 20% more thugs/tanks
 * - Azure territory: ALL enemies spawn, just 20% more snipers/spitters
 *
 * This is a CORE GAME MECHANIC - factions influence but don't restrict spawns.
 */
@Injectable({ providedIn: 'root' })
export class FactionSpawnWeightsService {
  // Base weights from config — boss is always 0 here (spawns only via boss waves)
  private readonly BASE_WEIGHTS = {
    basic: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.basic ?? 28,
    spitter: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.spitter ?? 18,
    tank: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.tank ?? 15,
    swarm: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.swarm ?? 15,
    thug: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.thug ?? 11,
    sniper: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sniper ?? 9,
    boss: 0, // Bosses spawn only via scheduled boss waves (wave 15, 25, 35...)
    disruptor: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.disruptor ?? 12,
    sentinel: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sentinel ?? 10,
  };

  // Faction weight modifiers - SMALL adjustments only!
  private readonly FACTION_MODIFIERS = {
    1: {
      // Crimson Legion - slightly more aggressive melee
      basic: 1.0, // No change
      spitter: 0.9, // 10% less
      tank: 1.2, // 20% more
      swarm: 1.0, // No change
      thug: 1.2, // 20% more
      sniper: 0.9, // 10% less
      boss: 1.1, // 10% more
      disruptor: 0.9, // 10% less — Crimson prefers brutes
      sentinel: 1.3, // 30% more — Crimson uses shield formations
    },
    2: {
      // Azure Order - slightly more ranged
      basic: 1.0, // No change
      spitter: 1.2, // 20% more
      tank: 0.9, // 10% less
      swarm: 0.9, // 10% less
      thug: 0.9, // 10% less
      sniper: 1.2, // 20% more
      boss: 1.0, // No change
      disruptor: 1.2, // 20% more — Azure uses tactical debuffers
      sentinel: 0.9, // 10% less — Azure prefers ranged
    },
    3: {
      // Verdant Collective - slightly more swarm
      basic: 1.2, // 20% more
      spitter: 1.0, // No change
      tank: 0.9, // 10% less
      swarm: 1.2, // 20% more
      thug: 0.9, // 10% less
      sniper: 0.9, // 10% less
      boss: 0.9, // 10% less
      disruptor: 1.0, // No change
      sentinel: 0.9, // 10% less — Verdant prefers swarming
    },
    4: {
      // Shadow Dominion - slightly more elite
      basic: 0.9, // 10% less
      spitter: 1.0, // No change
      tank: 1.1, // 10% more
      swarm: 0.9, // 10% less
      thug: 1.0, // No change
      sniper: 1.1, // 10% more
      boss: 1.2, // 20% more
      disruptor: 1.1, // 10% more — Shadow uses subtle disruption tactics
      sentinel: 1.1, // 10% more — Shadow uses shielded vanguards
    },
    0: {
      // Neutral territory - no modifications
      basic: 1.0,
      spitter: 1.0,
      tank: 1.0,
      swarm: 1.0,
      thug: 1.0,
      sniper: 1.0,
      boss: 1.0,
      disruptor: 1.0,
      sentinel: 1.0,
    },
  };

  constructor(
    private territoryGrid: TerritoryGridService,
    private debugLog: DebugLogBridgeService
  ) {}

  /**
   * Get spawn weights for a position, considering faction influence
   *
   * CRITICAL: This ALWAYS returns weights for ALL enemy types!
   * Faction only provides slight modifications.
   */
  getSpawnWeights(worldX: number, worldY: number, playerLevel: number): { [key in EnemyType]: number } {
    // Start with base weights - ALL types have weight
    const weights = { ...this.BASE_WEIGHTS };

    // Apply level-based adjustments first
    this.applyLevelAdjustments(weights, playerLevel);

    // Get faction at this position
    const tile = this.territoryGrid.getTileAtWorld(worldX, worldY);
    const factionId = tile?.factionId || 0;

    // Apply faction modifiers (small adjustments only)
    this.applyFactionModifiers(weights, factionId, tile?.isBase || false);

    // CRITICAL: Ensure NO weights are zero (except level-gated bosses)
    this.ensureMinimumWeights(weights, playerLevel);

    return weights;
  }

  /**
   * Apply level-based weight adjustments
   */
  private applyLevelAdjustments(weights: { [key in EnemyType]: number }, level: number): void {
    if (level < 5) {
      // Early game: reduce dangerous enemies but don't eliminate
      weights.boss *= 0.1; // Very rare but possible
      weights.sniper *= 0.5; // Less common but still spawn
      weights.tank *= 0.7; // Slightly less common
    } else if (level < 10) {
      // Mid game: balanced distribution
      weights.boss *= 0.3; // Still rare
      weights.sniper *= 0.8; // Almost normal
    } else {
      // Late game: full distribution
      // No changes needed
    }
  }

  /**
   * Apply faction modifiers to weights
   */
  private applyFactionModifiers(weights: { [key in EnemyType]: number }, factionId: number, isBase: boolean): void {
    const modifiers =
      this.FACTION_MODIFIERS[factionId as keyof typeof this.FACTION_MODIFIERS] || this.FACTION_MODIFIERS[0];

    // Apply faction modifiers
    for (const type of Object.keys(weights) as EnemyType[]) {
      const modifier = modifiers[type as keyof typeof modifiers] || 1.0;
      weights[type] *= modifier;

      // Double the effect in faction bases
      if (isBase && factionId > 0) {
        const extraModifier = 1 + (modifier - 1); // Double the deviation from 1.0
        weights[type] = (weights[type] * extraModifier) / modifier;
      }
    }
  }

  /**
   * Ensure minimum weights so all enemy types can spawn
   */
  private ensureMinimumWeights(weights: { [key in EnemyType]: number }, level: number): void {
    const MIN_WEIGHT = 1; // Minimum weight for any enemy type

    for (const type of Object.keys(weights) as EnemyType[]) {
      // Boss exception: can be 0 at very low levels
      if (type === EnemyType.Boss && level < 3) {
        weights[type] = 0;
      } else {
        weights[type] = Math.max(MIN_WEIGHT, weights[type]);
      }
    }
  }

  /**
   * Get faction influence description for debug/UI
   */
  getFactionInfluence(factionId: number): string {
    switch (factionId) {
      case 1:
        return 'Crimson: +20% aggressive melee';
      case 2:
        return 'Azure: +20% ranged specialists';
      case 3:
        return 'Verdant: +20% swarm units';
      case 4:
        return 'Shadow: +20% elite units';
      default:
        return 'Neutral: balanced spawning';
    }
  }

  /**
   * Debug: Log spawn weight distribution
   */
  logSpawnDistribution(worldX: number, worldY: number, playerLevel: number): void {
    const weights = this.getSpawnWeights(worldX, worldY, playerLevel);
    const tile = this.territoryGrid.getTileAtWorld(worldX, worldY);

    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const percentages: { [key: string]: string } = {};

    for (const [type, weight] of Object.entries(weights)) {
      percentages[type] = `${((weight / total) * 100).toFixed(1)}%`;
    }

    this.debugLog.log('Spawn Weight Distribution', 'info', {
      position: `${worldX},${worldY}`,
      factionId: tile?.factionId || 0,
      factionInfluence: this.getFactionInfluence(tile?.factionId || 0),
      isBase: tile?.isBase || false,
      playerLevel,
      distribution: percentages,
      totalWeight: total,
    });
  }
}
