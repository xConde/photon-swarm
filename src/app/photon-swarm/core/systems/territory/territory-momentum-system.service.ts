import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import {
  FourKingsTerritoryService,
  TerritoryMomentumMetrics,
  TerritoryMomentumMetricsService,
  TerritoryStrengthSystemService,
} from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { TERRITORY_SYSTEM_CONFIG } from '@photon/config/game-constants';

export interface FactionMomentum {
  kingId: number;
  territoryCount: number;
  previousTerritoryCount: number;
  momentum: number; // -1 to 1, negative = losing, positive = winning
  territoryChange: number; // Recent change in territory count
  isWinning: boolean;
  isLosing: boolean;
  isDesperate: boolean; // Very low territory count
  lastStandActive: boolean; // Final territories get bonuses
  rallyMultiplier: number; // Enemy strength multiplier when losing
  expansionBonus: number; // Territory expansion speed bonus
  strengthBonus: number; // Bonus strength for new territories
}

export interface MomentumState {
  factions: Map<number, FactionMomentum>;
  globalLeader: number | null;
  globalLoser: number | null;
  balanceScore: number; // 0-1, higher = more balanced
  lastUpdateTime: number;
}

/**
 * Territory Momentum System
 *
 * Tracks faction performance and applies momentum mechanics:
 * - Winning factions gain expansion bonuses but face stronger resistance
 * - Losing factions rally with stronger units and defense bonuses
 * - Prevents snowball victories and enables comebacks
 */
@Injectable({ providedIn: 'root' })
export class TerritoryMomentumSystemService implements OnDestroy {
  // Configuration from game constants
  private readonly config = TERRITORY_SYSTEM_CONFIG.MOMENTUM;

  // Quick references for frequently used values
  private readonly UPDATE_INTERVAL_MS = this.config.UPDATE_INTERVAL_MS;
  private readonly MOMENTUM_DECAY = this.config.MOMENTUM_DECAY;
  private readonly MOMENTUM_GAIN = this.config.MOMENTUM_GAIN;

  // State tracking
  private momentumState: MomentumState = {
    factions: new Map(),
    globalLeader: null,
    globalLoser: null,
    balanceScore: 1.0,
    lastUpdateTime: Date.now(),
  };

  // Performance optimization - cache territory counts
  private cachedTerritoryCounts: Map<number, number> = new Map();
  private cacheValid = false;
  private territoryChangeCount = 0;

  // Metrics are now handled by dedicated TerritoryMomentumMetricsService

  // Update subscription
  private updateSubscription: Subscription | null = null;

  // Observable for momentum changes
  private momentumSubject = new BehaviorSubject<MomentumState>(this.momentumState);
  public momentum$ = this.momentumSubject.asObservable();

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    _territoryStrengthSystem: TerritoryStrengthSystemService,
    private debugLog: DebugLogBridgeService,
    private metricsService: TerritoryMomentumMetricsService
  ) {
    this.initialize();
  }

  /**
   * Initialize the momentum system
   */
  private initialize(): void {
    // Initialize faction momentum for all 4 kings
    for (let kingId = 1; kingId <= 4; kingId++) {
      this.momentumState.factions.set(kingId, this.createDefaultMomentum(kingId));
    }

    // Start periodic updates
    this.updateSubscription = interval(this.UPDATE_INTERVAL_MS).subscribe(() => {
      this.updateMomentum();
    });

    // Initial update
    this.updateMomentum();

    this.debugLog.log('Territory Momentum System Initialized', 'info', {
      updateInterval: this.UPDATE_INTERVAL_MS,
      factionCount: this.momentumState.factions.size,
    });
  }

  /**
   * Create default momentum state for a faction
   */
  private createDefaultMomentum(kingId: number): FactionMomentum {
    return {
      kingId,
      territoryCount: 0,
      previousTerritoryCount: 0,
      momentum: 0,
      territoryChange: 0,
      isWinning: false,
      isLosing: false,
      isDesperate: false,
      lastStandActive: false,
      rallyMultiplier: 1.0,
      expansionBonus: 0,
      strengthBonus: 0,
    };
  }

  /**
   * Update momentum for all factions
   */
  private updateMomentum(): void {
    const startTime = typeof window !== 'undefined' && window.performance ? window.performance.now() : Date.now();
    const currentTime = Date.now();

    // Get current territory counts
    const territoryCounts = this.calculateTerritoryCounts();
    const totalTerritories = Array.from(territoryCounts.values()).reduce((sum, count) => sum + count, 0);
    const averageTerritories = totalTerritories / territoryCounts.size || 1;

    let leaderId: number | null = null;
    let loserId: number | null = null;
    let maxTerritories = 0;
    let minTerritories = Infinity;

    // Update each faction's momentum
    for (const [kingId, currentCount] of territoryCounts.entries()) {
      const momentum = this.momentumState.factions.get(kingId);
      if (!momentum) continue;

      // Calculate territory change
      momentum.territoryChange = currentCount - momentum.previousTerritoryCount;
      momentum.previousTerritoryCount = momentum.territoryCount;
      momentum.territoryCount = currentCount;

      // Update momentum value
      if (momentum.territoryChange !== 0) {
        // Gain momentum from territory changes
        const changeRatio = momentum.territoryChange / Math.max(1, momentum.previousTerritoryCount);
        momentum.momentum += changeRatio * this.MOMENTUM_GAIN;
      } else {
        // Decay momentum when no changes
        momentum.momentum *= this.MOMENTUM_DECAY;
      }

      // Clamp momentum to [-1, 1]
      momentum.momentum = Math.max(-1, Math.min(1, momentum.momentum));

      // Calculate relative position
      const relativePosition = (currentCount - averageTerritories) / averageTerritories;
      const territoryRatio = currentCount / Math.max(1, totalTerritories);

      // Determine faction state
      momentum.isWinning = relativePosition > this.config.WINNING_THRESHOLD && momentum.momentum > 0;
      momentum.isLosing = relativePosition < this.config.LOSING_THRESHOLD || momentum.momentum < -0.2;
      momentum.isDesperate = territoryRatio < this.config.DESPERATE_THRESHOLD;
      momentum.lastStandActive = territoryRatio < this.config.LAST_STAND_THRESHOLD;

      // Calculate bonuses/penalties based on state
      if (momentum.isWinning) {
        // Winning factions get expansion bonuses
        momentum.expansionBonus = Math.abs(momentum.momentum) * this.config.MAX_EXPANSION_BONUS;
        momentum.strengthBonus = Math.abs(momentum.momentum) * this.config.MAX_STRENGTH_BONUS;
        momentum.rallyMultiplier = 1.0; // Normal enemy strength
      } else if (momentum.lastStandActive) {
        // Last stand - maximum defensive bonuses
        momentum.expansionBonus = 0;
        momentum.strengthBonus = this.config.MAX_STRENGTH_BONUS * 2; // Double strength bonus
        momentum.rallyMultiplier = this.config.LAST_STAND_MULTIPLIER;
      } else if (momentum.isDesperate) {
        // Desperate - strong rally effect
        momentum.expansionBonus = 0;
        momentum.strengthBonus = this.config.MAX_STRENGTH_BONUS;
        momentum.rallyMultiplier = this.config.MAX_RALLY_MULTIPLIER;
      } else if (momentum.isLosing) {
        // Losing - moderate rally effect
        momentum.expansionBonus = 0;
        momentum.strengthBonus = this.config.MAX_STRENGTH_BONUS * 0.5;
        momentum.rallyMultiplier = 1.0 + Math.abs(momentum.momentum);
      } else {
        // Neutral state
        momentum.expansionBonus = 0;
        momentum.strengthBonus = 0;
        momentum.rallyMultiplier = 1.0;
      }

      // Track global leader and loser
      if (currentCount > maxTerritories) {
        maxTerritories = currentCount;
        leaderId = kingId;
      }
      if (currentCount < minTerritories) {
        minTerritories = currentCount;
        loserId = kingId;
      }
    }

    // Calculate balance score (0 = one faction dominates, 1 = perfectly balanced)
    const variance = this.calculateVariance(Array.from(territoryCounts.values()));
    this.momentumState.balanceScore = Math.max(0, 1 - variance / (averageTerritories * averageTerritories));

    // Update global state
    this.momentumState.globalLeader = leaderId;
    this.momentumState.globalLoser = loserId;
    this.momentumState.lastUpdateTime = currentTime;

    // Track update in metrics service
    const updateTime =
      (typeof window !== 'undefined' && window.performance ? window.performance.now() : Date.now()) - startTime;
    this.metricsService.recordUpdate(
      updateTime,
      this.momentumState.balanceScore,
      this.momentumState.globalLeader,
      this.momentumState.globalLoser
    );

    // Track factions in last stand
    const lastStandCount = Array.from(this.momentumState.factions.values()).filter((f) => f.lastStandActive).length;
    this.metricsService.recordLastStand(lastStandCount);

    // Emit update
    this.momentumSubject.next(this.momentumState);

    // Log metrics periodically (check metrics service update count)
    const metrics = this.metricsService.getMetrics();
    const performanceMetrics = metrics['performance'];
    if (performanceMetrics && typeof performanceMetrics === 'object' && 'updateCount' in performanceMetrics) {
      const updateCount = (performanceMetrics as { updateCount: number }).updateCount;
      if (updateCount % 10 === 0) {
        this.logMetrics();
      }
    }
  }

  /**
   * Calculate current territory counts for all factions
   * Optimized with caching to avoid full grid iteration every time
   */
  private calculateTerritoryCounts(): Map<number, number> {
    // Use cache if valid
    if (this.cacheValid) {
      this.metricsService.recordCacheHit();
      return new Map(this.cachedTerritoryCounts);
    }

    this.metricsService.recordCacheMiss();

    const counts = new Map<number, number>();

    // Initialize counts
    for (let kingId = 1; kingId <= 4; kingId++) {
      counts.set(kingId, 0);
    }

    // Count territories from the world grid
    const world = this.fourKingsTerritory.getWorldData();
    if (world && world.territories) {
      for (const row of world.territories) {
        for (const tile of row) {
          if (tile && tile.kingId > 0) {
            const currentCount = counts.get(tile.kingId) || 0;
            counts.set(tile.kingId, currentCount + 1);
          }
        }
      }
    }

    // Update cache
    this.cachedTerritoryCounts = new Map(counts);
    this.cacheValid = true;

    return counts;
  }

  /**
   * Invalidate cache when territory changes
   */
  public invalidateCache(): void {
    this.cacheValid = false;
    this.territoryChangeCount++;

    // Auto-invalidate cache based on threshold
    if (this.territoryChangeCount >= this.config.CACHE_UPDATE_THRESHOLD) {
      this.forceUpdate();
      this.territoryChangeCount = 0;
    }
  }

  /**
   * Register territory change for incremental updates
   */
  public onTerritoryChange(_gridX: number, _gridY: number, oldKingId: number, newKingId: number): void {
    // Update cached counts incrementally
    if (this.cacheValid && this.cachedTerritoryCounts.size > 0) {
      if (oldKingId > 0) {
        const oldCount = this.cachedTerritoryCounts.get(oldKingId) || 0;
        this.cachedTerritoryCounts.set(oldKingId, Math.max(0, oldCount - 1));
      }
      if (newKingId > 0) {
        const newCount = this.cachedTerritoryCounts.get(newKingId) || 0;
        this.cachedTerritoryCounts.set(newKingId, newCount + 1);
      }

      // Keep cache valid for incremental updates
      this.territoryChangeCount++;

      // Force full recalculation periodically
      if (this.territoryChangeCount >= this.config.CACHE_UPDATE_THRESHOLD) {
        this.invalidateCache();
      }
    } else {
      this.invalidateCache();
    }
  }

  /**
   * Calculate variance for balance score
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => (val - mean) * (val - mean));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
  }

  /**
   * Get momentum for a specific faction
   */
  public getFactionMomentum(kingId: number): FactionMomentum | undefined {
    return this.momentumState.factions.get(kingId);
  }

  /**
   * Get spawn multiplier for a faction based on momentum
   */
  public getSpawnMultiplier(kingId: number): number {
    const momentum = this.getFactionMomentum(kingId);
    if (!momentum) return 1.0;

    // Winning factions spawn fewer but normal enemies
    if (momentum.isWinning) {
      return this.config.WINNING_SPAWN_REDUCTION;
    }

    // Losing factions spawn more and stronger enemies
    if (momentum.isDesperate || momentum.lastStandActive) {
      return this.config.DESPERATE_SPAWN_INCREASE;
    }

    if (momentum.isLosing) {
      return this.config.LOSING_SPAWN_INCREASE;
    }

    return 1.0;
  }

  /**
   * Get enemy strength multiplier for a faction
   */
  public getEnemyStrengthMultiplier(kingId: number): number {
    const momentum = this.getFactionMomentum(kingId);
    return momentum?.rallyMultiplier || 1.0;
  }

  /**
   * Get territory expansion speed multiplier
   */
  public getExpansionMultiplier(kingId: number): number {
    const momentum = this.getFactionMomentum(kingId);
    return 1.0 + (momentum?.expansionBonus || 0);
  }

  /**
   * Get strength bonus for newly captured territories
   */
  public getTerritoryStrengthBonus(kingId: number): number {
    const momentum = this.getFactionMomentum(kingId);
    return momentum?.strengthBonus || 0;
  }

  /**
   * Check if a faction is in last stand mode
   */
  public isInLastStand(kingId: number): boolean {
    const momentum = this.getFactionMomentum(kingId);
    return momentum?.lastStandActive || false;
  }

  /**
   * Get the current balance score
   */
  public getBalanceScore(): number {
    return this.momentumState.balanceScore;
  }

  /**
   * Force an immediate momentum update
   */
  public forceUpdate(): void {
    this.updateMomentum();
  }

  /**
   * Record a player kill for momentum impact
   */
  public recordPlayerKill(enemyFactionId: number, x: number, y: number): void {
    if (enemyFactionId <= 0 || enemyFactionId > 4) return;

    // Track kill in metrics service
    this.metricsService.recordPlayerKill(enemyFactionId);

    // Apply momentum penalty to the faction
    const momentum = this.momentumState.factions.get(enemyFactionId);
    if (momentum) {
      momentum.momentum -= this.config.PLAYER_KILL_IMPACT;
      momentum.momentum = Math.max(-1, momentum.momentum);

      // Check if this pushed faction into desperation
      if (!momentum.isDesperate && momentum.territoryCount < this.config.DESPERATE_THRESHOLD * 100) {
        momentum.isDesperate = true;
        this.metricsService.recordComeback(); // Track potential comeback
      }
    }

    // Influence is tracked in metrics service

    this.debugLog.log('Player Kill Impact', 'info', {
      faction: enemyFactionId,
      location: { x: x.toFixed(0), y: y.toFixed(0) },
      newMomentum: momentum?.momentum.toFixed(2),
      totalKills: (this.metricsService.getMetrics() as { player: { totalKills: number } }).player.totalKills,
    });
  }

  /**
   * Record player death for momentum impact
   */
  public recordPlayerDeath(killerFactionId: number): void {
    if (killerFactionId <= 0 || killerFactionId > 4) return;

    // Track death in metrics service
    this.metricsService.recordPlayerDeath(killerFactionId);

    // Give momentum boost to killing faction
    const momentum = this.momentumState.factions.get(killerFactionId);
    if (momentum) {
      momentum.momentum += this.config.PLAYER_DEATH_IMPACT;
      momentum.momentum = Math.min(1, momentum.momentum);
    }

    // Influence reduction handled in metrics service
  }

  /**
   * Get comprehensive performance metrics (delegated to metrics service)
   */
  public getMetrics(): TerritoryMomentumMetrics {
    // Get metrics from optimized service
    const metrics = this.metricsService.getMetrics();

    // Add momentum-specific data
    metrics.momentum = {
      factions: this.momentumState.factions,
    };

    return metrics;
  }

  /**
   * Log detailed metrics to debug
   */
  public logMetrics(): void {
    const metrics = this.getMetrics();
    // Convert to plain object for debugLog compatibility
    const metricsObj: Record<string, unknown> = {
      performance: metrics.performance,
      balance: metrics.balance,
      player: metrics.player,
      history: metrics.history,
      momentum: metrics.momentum,
    };
    this.debugLog.log('Territory Momentum Metrics', 'info', metricsObj);
  }

  /**
   * Clean up
   */
  ngOnDestroy(): void {
    // Safely unsubscribe from interval - wrap in try/catch to prevent
    // cascading failures during test teardown when scheduler may be null
    if (this.updateSubscription) {
      try {
        this.updateSubscription.unsubscribe();
      } catch {
        // Ignore errors during subscription cleanup (common in test teardown)
      }
      this.updateSubscription = null;
    }

    // Complete the subject
    if (this.momentumSubject && !this.momentumSubject.closed) {
      this.momentumSubject.complete();
    }
  }
}
