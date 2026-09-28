import { Injectable } from '@angular/core';

/**
 * Territory momentum metrics data structure
 */
export interface TerritoryMomentumMetrics {
  performance: {
    avgUpdateMs: string;
    lastUpdateMs: string;
    cacheHitRate: string;
    updateCount: number;
  };
  balance: {
    current: string;
    leader: number | null;
    loser: number | null;
    lastStandFactions: number;
    comebacks: number;
  };
  player: {
    totalKills: number;
    totalDeaths: number;
    influence: string;
    killsByFaction: number[];
  };
  history: {
    recentBalance: number[];
    samples: number;
  };
  momentum?: {
    factions: Map<number, unknown>;
  };
}

/**
 * Optimized metrics collection for Territory Momentum System
 *
 * Design principles:
 * - Lazy calculation only when requested
 * - Cached results with TTL
 * - Circular buffers for history
 * - Minimal garbage generation
 */
@Injectable({ providedIn: 'root' })
export class TerritoryMomentumMetricsService {
  // Performance counters
  private updateCount = 0;
  private totalUpdateTimeMs = 0;
  private lastUpdateTimeMs = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  // Circular buffer for balance history (avoids array.shift)
  private readonly HISTORY_SIZE = 100;
  private balanceHistory = new Float32Array(this.HISTORY_SIZE);
  private historyIndex = 0;
  private historyCount = 0;

  // Cached metrics with TTL
  private cachedMetrics: TerritoryMomentumMetrics | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 1000; // 1 second cache

  // Player impact tracking (bounded)
  private readonly MAX_TRACKED_KILLS = 1000;
  private playerKillsByFaction = new Uint16Array(5); // Index 0 unused, 1-4 for factions
  private playerDeathsByFaction = new Uint16Array(5);
  private playerInfluence = 0;

  // Game state counters
  private comebackCount = 0;
  private lastStandCount = 0;
  private currentBalance = 1.0;
  private globalLeader: number | null = null;
  private globalLoser: number | null = null;

  /**
   * Record an update cycle
   */
  public recordUpdate(durationMs: number, balance: number, leader: number | null, loser: number | null): void {
    this.updateCount++;
    this.totalUpdateTimeMs += durationMs;
    this.lastUpdateTimeMs = durationMs;
    this.currentBalance = balance;
    this.globalLeader = leader;
    this.globalLoser = loser;

    // Add to circular buffer
    this.balanceHistory[this.historyIndex] = balance;
    this.historyIndex = (this.historyIndex + 1) % this.HISTORY_SIZE;
    this.historyCount = Math.min(this.historyCount + 1, this.HISTORY_SIZE);

    // Invalidate cache
    this.cachedMetrics = null;
  }

  /**
   * Record cache performance
   */
  public recordCacheHit(): void {
    this.cacheHits++;
  }

  public recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /**
   * Record player actions (bounded)
   */
  public recordPlayerKill(factionId: number): void {
    if (factionId >= 1 && factionId <= 4) {
      // Saturating add to prevent overflow
      if (this.playerKillsByFaction[factionId] < this.MAX_TRACKED_KILLS) {
        this.playerKillsByFaction[factionId]++;
      }
      this.playerInfluence = Math.min(10, this.playerInfluence + 0.01);
      // Invalidate cache when player data changes
      this.cachedMetrics = null;
    }
  }

  public recordPlayerDeath(factionId: number): void {
    if (factionId >= 1 && factionId <= 4) {
      if (this.playerDeathsByFaction[factionId] < this.MAX_TRACKED_KILLS) {
        this.playerDeathsByFaction[factionId]++;
      }
      this.playerInfluence = Math.max(0, this.playerInfluence - 0.05);
      // Invalidate cache when player data changes
      this.cachedMetrics = null;
    }
  }

  /**
   * Record game events
   */
  public recordComeback(): void {
    this.comebackCount++;
  }

  public recordLastStand(count: number): void {
    this.lastStandCount = count;
  }

  /**
   * Get metrics (cached and optimized)
   */
  public getMetrics(): TerritoryMomentumMetrics {
    const now = Date.now();

    // Return cached metrics if still valid
    if (this.cachedMetrics && now - this.cacheTimestamp < this.CACHE_TTL_MS) {
      return this.cachedMetrics;
    }

    // Build new metrics (only when needed)
    this.cachedMetrics = this.buildMetrics();
    this.cacheTimestamp = now;

    return this.cachedMetrics;
  }

  /**
   * Build metrics object (called infrequently)
   */
  private buildMetrics(): TerritoryMomentumMetrics {
    // Calculate derived values
    const avgUpdateTime = this.updateCount > 0 ? (this.totalUpdateTimeMs / this.updateCount).toFixed(2) : '0.00';

    const totalCacheOps = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheOps > 0 ? ((this.cacheHits / totalCacheOps) * 100).toFixed(1) : '0.0';

    // Get recent balance scores efficiently
    const recentScores = this.getRecentBalanceScores(10);

    // Calculate totals
    let totalKills = 0;
    let totalDeaths = 0;
    for (let i = 1; i <= 4; i++) {
      totalKills += this.playerKillsByFaction[i];
      totalDeaths += this.playerDeathsByFaction[i];
    }

    return {
      // Performance (strings to avoid repeated formatting)
      performance: {
        avgUpdateMs: avgUpdateTime,
        lastUpdateMs: this.lastUpdateTimeMs.toFixed(2),
        cacheHitRate: cacheHitRate + '%',
        updateCount: this.updateCount,
      },

      // Game Balance
      balance: {
        current: this.currentBalance.toFixed(3),
        leader: this.globalLeader,
        loser: this.globalLoser,
        lastStandFactions: this.lastStandCount,
        comebacks: this.comebackCount,
      },

      // Player Impact
      player: {
        totalKills,
        totalDeaths,
        influence: this.playerInfluence.toFixed(2),
        killsByFaction: Array.from(this.playerKillsByFaction.slice(1, 5)),
      },

      // Historical (only recent)
      history: {
        recentBalance: recentScores,
        samples: this.historyCount,
      },
    };
  }

  /**
   * Get recent balance scores from circular buffer
   */
  private getRecentBalanceScores(count: number): number[] {
    const result: number[] = [];
    const available = Math.min(count, this.historyCount);

    for (let i = 0; i < available; i++) {
      // Read backwards from current position
      const index = (this.historyIndex - i - 1 + this.HISTORY_SIZE) % this.HISTORY_SIZE;
      result.unshift(parseFloat(this.balanceHistory[index].toFixed(3)));
    }

    return result;
  }

  /**
   * Get quick stats (no object creation)
   */
  public getQuickStats(): { balance: number; cacheRate: number; avgTime: number } {
    const totalCacheOps = this.cacheHits + this.cacheMisses;
    return {
      balance: this.currentBalance,
      cacheRate: totalCacheOps > 0 ? this.cacheHits / totalCacheOps : 0,
      avgTime: this.updateCount > 0 ? this.totalUpdateTimeMs / this.updateCount : 0,
    };
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    this.updateCount = 0;
    this.totalUpdateTimeMs = 0;
    this.lastUpdateTimeMs = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;

    this.balanceHistory.fill(1.0);
    this.historyIndex = 0;
    this.historyCount = 0;

    this.playerKillsByFaction.fill(0);
    this.playerDeathsByFaction.fill(0);
    this.playerInfluence = 0;

    this.comebackCount = 0;
    this.lastStandCount = 0;
    this.currentBalance = 1.0;
    this.globalLeader = null;
    this.globalLoser = null;

    this.cachedMetrics = null;
    this.cacheTimestamp = 0;
  }
}
