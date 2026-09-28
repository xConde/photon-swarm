import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

/**
 * XP Event Types for tracking different sources
 */
export enum XPEventSource {
  ENEMY_KILL = 'enemy_kill',
  BOSS_KILL = 'boss_kill',
  ELITE_KILL = 'elite_kill',
  MULTI_KILL = 'multi_kill',
  BUFF_BONUS = 'buff_bonus',
  UPGRADE_BONUS = 'upgrade_bonus',
  QUEST_REWARD = 'quest_reward',
  ACHIEVEMENT = 'achievement',
  DEBUG_COMMAND = 'debug_command',
}

/**
 * XP Event data structure for tracking
 */
export interface XPEvent {
  id: string;
  source: XPEventSource;
  baseAmount: number;
  multipliers: XPMultiplier[];
  finalAmount: number;
  timestamp: number;
  metadata: {
    enemyType?: string;
    enemyId?: number;
    buffIds?: string[];
    comboCount?: number;
    position?: { x: number; y: number };
    levelBefore?: number;
    levelAfter?: number;
  };
}

/**
 * XP Multiplier tracking
 */
export interface XPMultiplier {
  source: string;
  value: number;
  description: string;
}

/**
 * XP Statistics for debugging
 */
export interface XPStatistics {
  totalXpGained: number;
  totalEvents: number;
  eventsBySource: Map<XPEventSource, number>;
  xpBySource: Map<XPEventSource, number>;
  averageXpPerEvent: number;
  largestXpGain: XPEvent | null;
  recentEvents: XPEvent[];
  xpPerMinute: number;
  sessionStartTime: number;
}

/**
 * XP Event Tracking Service
 *
 * Tracks all XP events for debugging and analytics.
 * Provides detailed logging of XP sources, multipliers, and accumulation.
 */
@Injectable({
  providedIn: 'root',
})
export class XPEventTrackerService {
  private events: XPEvent[] = [];
  private eventIdCounter = 0;
  private sessionStartTime = Date.now();
  private maxStoredEvents = 100; // Keep last 100 events in memory

  // Event streams
  private xpEventSubject = new Subject<XPEvent>();
  public xpEvent$: Observable<XPEvent> = this.xpEventSubject.asObservable();

  // Statistics
  private stats: XPStatistics = {
    totalXpGained: 0,
    totalEvents: 0,
    eventsBySource: new Map(),
    xpBySource: new Map(),
    averageXpPerEvent: 0,
    largestXpGain: null,
    recentEvents: [],
    xpPerMinute: 0,
    sessionStartTime: Date.now(),
  };

  constructor(private debugLog: DebugLogBridgeService) {
    this.resetStatistics();
  }

  /**
   * Track an XP event
   */
  trackXPEvent(
    source: XPEventSource,
    baseAmount: number,
    multipliers: XPMultiplier[] = [],
    metadata: Partial<XPEvent['metadata']> = {}
  ): XPEvent {
    // Validate input
    if (baseAmount < 0) {
      this.debugLog.log('Invalid negative XP amount', 'warning', { baseAmount, source });
      baseAmount = 0;
    }

    // Multipliers stack multiplicatively for compound bonuses
    let finalAmount = baseAmount;
    for (const multiplier of multipliers) {
      finalAmount *= multiplier.value;
    }
    finalAmount = Math.floor(finalAmount);

    const event: XPEvent = {
      id: `xp_${this.eventIdCounter++}`,
      source,
      baseAmount,
      multipliers,
      finalAmount,
      timestamp: Date.now(),
      metadata,
    };

    this.events.push(event);
    if (this.events.length > this.maxStoredEvents) {
      this.events.shift(); // FIFO to prevent unbounded memory growth
    }

    this.updateStatistics(event);
    this.xpEventSubject.next(event);

    // Log events with multipliers or high values for balance tuning visibility
    if (finalAmount > 100 || multipliers.length > 0) {
      this.logXPEvent(event);
    }

    return event;
  }

  /**
   * Track enemy kill XP with detailed context
   */
  trackEnemyKillXP(
    enemyType: string,
    enemyId: number,
    baseXp: number,
    isElite: boolean = false,
    multipliers: XPMultiplier[] = [],
    position?: { x: number; y: number }
  ): XPEvent {
    const source = isElite ? XPEventSource.ELITE_KILL : XPEventSource.ENEMY_KILL;
    return this.trackXPEvent(source, baseXp, multipliers, {
      enemyType,
      enemyId,
      position,
    });
  }

  /**
   * Track buff-enhanced XP
   */
  trackBuffedXP(
    originalSource: XPEventSource,
    baseAmount: number,
    buffMultipliers: Array<{ buffId: string; multiplier: number; name: string }>
  ): XPEvent {
    const multipliers: XPMultiplier[] = buffMultipliers.map((buff) => ({
      source: `buff_${buff.buffId}`,
      value: buff.multiplier,
      description: buff.name,
    }));

    return this.trackXPEvent(originalSource, baseAmount, multipliers, {
      buffIds: buffMultipliers.map((b) => b.buffId),
    });
  }

  /**
   * Get current XP statistics
   */
  getStatistics(): XPStatistics {
    // Update XP per minute
    const sessionMinutes = (Date.now() - this.sessionStartTime) / 60000;
    this.stats.xpPerMinute = sessionMinutes > 0 ? Math.floor(this.stats.totalXpGained / sessionMinutes) : 0;

    this.stats.recentEvents = this.events.slice(-10); // Last 10 events

    return { ...this.stats };
  }

  /**
   * Get events by source type
   */
  getEventsBySource(source: XPEventSource, limit: number = 10): XPEvent[] {
    return this.events.filter((e) => e.source === source).slice(-limit);
  }

  /**
   * Get events within time range
   */
  getEventsInTimeRange(startTime: number, endTime: number): XPEvent[] {
    return this.events.filter((e) => e.timestamp >= startTime && e.timestamp <= endTime);
  }

  /**
   * Clear all tracked events
   */
  clearEvents(): void {
    this.events = [];
    this.resetStatistics();

    this.debugLog.log('XP Event Tracker cleared', 'info', {
      source: 'xp_tracker',
      operation: 'clear',
    });
  }

  private cleanupStatisticsMaps(): void {
    // Keep only top 10 sources by event count to prevent memory growth
    if (this.stats.eventsBySource.size > 20) {
      const sortedSources = Array.from(this.stats.eventsBySource.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      this.stats.eventsBySource.clear();
      this.stats.xpBySource.clear();

      sortedSources.forEach(([source, count]) => {
        this.stats.eventsBySource.set(source, count);
        const xp = this.events.filter((e) => e.source === source).reduce((sum, e) => sum + e.finalAmount, 0);
        this.stats.xpBySource.set(source, xp);
      });
    }
  }

  /**
   * Export events for debugging
   */
  exportEvents(): string {
    return JSON.stringify(
      {
        statistics: this.getStatistics(),
        events: this.events,
      },
      null,
      2
    );
  }

  /**
   * Log detailed report to debug console
   */
  logDetailedReport(): void {
    const stats = this.getStatistics();

    this.debugLog.log('📊 XP Tracking Report', 'info', {
      source: 'xp_tracker',
      totalXP: stats.totalXpGained,
      totalEvents: stats.totalEvents,
      averageXP: stats.averageXpPerEvent,
      xpPerMinute: stats.xpPerMinute,
      largestGain: stats.largestXpGain?.finalAmount || 0,
      bySource: Object.fromEntries(stats.xpBySource),
    });

    // Log source breakdown
    stats.eventsBySource.forEach((count, source) => {
      const xp = stats.xpBySource.get(source) || 0;
      const avg = count > 0 ? Math.floor(xp / count) : 0;

      this.debugLog.log(`  ${source}: ${count} events, ${xp} XP (avg: ${avg})`, 'info', {
        source: 'xp_tracker',
        eventSource: source,
        count,
        totalXp: xp,
        average: avg,
      });
    });
  }

  /**
   * Update statistics with new event
   */
  private updateStatistics(event: XPEvent): void {
    // Update totals
    this.stats.totalXpGained += event.finalAmount;
    this.stats.totalEvents++;

    // Update by source
    const sourceCount = this.stats.eventsBySource.get(event.source) || 0;
    this.stats.eventsBySource.set(event.source, sourceCount + 1);

    const sourceXp = this.stats.xpBySource.get(event.source) || 0;
    this.stats.xpBySource.set(event.source, sourceXp + event.finalAmount);

    // Prevent unbounded growth in long sessions (every 10k events)
    if (this.stats.totalEvents % 10000 === 0) {
      this.cleanupStatisticsMaps();
    }

    // Update average
    this.stats.averageXpPerEvent = Math.floor(this.stats.totalXpGained / this.stats.totalEvents);

    // Track largest gain
    if (!this.stats.largestXpGain || event.finalAmount > this.stats.largestXpGain.finalAmount) {
      this.stats.largestXpGain = event;
    }
  }

  /**
   * Reset statistics
   */
  private resetStatistics(): void {
    this.stats = {
      totalXpGained: 0,
      totalEvents: 0,
      eventsBySource: new Map(),
      xpBySource: new Map(),
      averageXpPerEvent: 0,
      largestXpGain: null,
      recentEvents: [],
      xpPerMinute: 0,
      sessionStartTime: Date.now(),
    };
    this.sessionStartTime = Date.now();
  }

  /**
   * Log XP event to debug console
   */
  private logXPEvent(event: XPEvent): void {
    const multiplierStr =
      event.multipliers.length > 0
        ? ` (${event.multipliers.map((m) => `${m.description}: ${m.value}x`).join(', ')})`
        : '';

    this.debugLog.log(`💰 XP Gained: ${event.baseAmount} → ${event.finalAmount}${multiplierStr}`, 'success', {
      source: 'xp_tracker',
      eventId: event.id,
      eventSource: event.source,
      baseAmount: event.baseAmount,
      finalAmount: event.finalAmount,
      multipliers: event.multipliers,
      metadata: event.metadata,
    });
  }
}
