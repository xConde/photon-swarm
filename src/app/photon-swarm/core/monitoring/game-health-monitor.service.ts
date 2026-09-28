import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { PerformanceMonitorService } from '../utils/performance-monitor.service';
import { MemoryOptimizerService } from '../utils/memory-optimizer.service';
import { EnemyManagerService } from '../systems/enemy-ai';
import { PositionSyncService } from '../systems/gameplay';
import { EntityManagerService } from '../ecs/entity-manager.service';

/**
 * Enemy count thresholds for performance ratings
 */
const ENEMY_COUNT_THRESHOLDS = {
  POOR: 60,
  FAIR: 45,
  EXCELLENT: 20,
} as const;

/**
 * Comprehensive Game Health Monitoring Dashboard Service
 *
 * Provides a unified view of all game systems health and performance metrics
 * Acts as a central hub for monitoring game stability and performance
 */
@Injectable({
  providedIn: 'root',
})
export class GameHealthMonitorService implements OnDestroy {
  private readonly healthData$ = new BehaviorSubject<GameHealthData>({
    overall: { status: 'unknown', score: 0, issues: [] },
    performance: { fps: 0, trend: 'unknown', score: 0 },
    memory: { usage: 0, trend: 'unknown', critical: false },
    entities: { count: 0, enemies: 0, performance: 'good' },
    systems: { active: 0, errors: 0, warnings: 0 },
    timestamp: Date.now(),
  });

  private readonly MONITORING_INTERVAL_MS = 5000; // Update every 5 seconds (reduced from 2s to prevent frame spikes)
  private monitoringInterval?: number;
  private readonly healthHistory: GameHealthSnapshot[] = [];
  private readonly MAX_HISTORY_LENGTH = 30; // 1 minute of history at 2s intervals

  constructor(
    private ngZone: NgZone,
    private performanceMonitor: PerformanceMonitorService,
    private memoryOptimizer: MemoryOptimizerService,
    private enemyManager: EnemyManagerService,
    private positionSync: PositionSyncService,
    _entityManager: EntityManagerService
  ) {
    // Monitoring is now lazy - call startMonitoring() explicitly when needed
  }

  /**
   * Get current game health data as observable
   */
  getHealthData(): Observable<GameHealthData> {
    return this.healthData$.asObservable();
  }

  /**
   * Get current health snapshot
   */
  getCurrentHealth(): GameHealthData {
    return this.healthData$.value;
  }

  /**
   * Start continuous health monitoring
   */
  public startMonitoring(): void {
    // Prevent multiple intervals
    if (this.monitoringInterval) {
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.monitoringInterval = window.setInterval(() => {
        this.updateHealthData();
      }, this.MONITORING_INTERVAL_MS);
    });

    // Initial update
    this.updateHealthData();
  }

  /**
   * Stop continuous health monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Update all health monitoring data
   */
  private updateHealthData(): void {
    const performanceData = this.assessPerformance();
    const memoryData = this.assessMemory();
    const entityData = this.assessEntities();
    const systemData = this.assessSystems();
    const overallData = this.calculateOverallHealth(performanceData, memoryData, entityData, systemData);

    const healthData: GameHealthData = {
      overall: overallData,
      performance: performanceData,
      memory: memoryData,
      entities: entityData,
      systems: systemData,
      timestamp: Date.now(),
    };

    // Store in history
    this.healthHistory.push({
      ...healthData,
      id: Date.now().toString(),
    });

    if (this.healthHistory.length > this.MAX_HISTORY_LENGTH) {
      this.healthHistory.shift();
    }

    this.healthData$.next(healthData);

    // Log critical issues
    if (overallData.status === 'critical') {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('GAME_HEALTH_CRITICAL', 'error', {
          source: 'game_health_monitor',
          operation: 'health_check',
          issues: overallData.issues,
          score: overallData.score,
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Assess performance health
   */
  private assessPerformance(): PerformanceHealth {
    const perfSummary = this.performanceMonitor.getPerformanceSummary();

    let score = 100;
    let trend: 'improving' | 'stable' | 'declining' = 'stable';

    // Calculate performance score
    if (perfSummary.averageFps < 30) score -= 40;
    else if (perfSummary.averageFps < 45) score -= 20;
    else if (perfSummary.averageFps < 55) score -= 10;

    // Check system performance — count without allocating a filtered array
    let slowSystemCount = 0;
    for (let i = 0; i < perfSummary.systemMetrics.length; i++) {
      if (perfSummary.systemMetrics[i].performanceRating === 'poor') slowSystemCount++;
    }
    score -= slowSystemCount * 15;

    // Determine trend (simplified for now)
    if (perfSummary.averageFps > 55) trend = 'improving';
    else if (perfSummary.averageFps < 40) trend = 'declining';

    return {
      fps: perfSummary.averageFps,
      trend,
      score: Math.max(0, score),
    };
  }

  /**
   * Assess memory health
   */
  private assessMemory(): MemoryHealth {
    const memoryStats = this.memoryOptimizer.getMemoryStats();

    const percentage = (memoryStats.current.usedJSHeapSize / memoryStats.current.jsHeapSizeLimit) * 100;
    return {
      usage: memoryStats.current.usedJSHeapSize,
      trend: memoryStats.trend,
      critical: percentage > 80,
    };
  }

  /**
   * Assess entity system health
   */
  private assessEntities(): EntityHealth {
    const enemyCount = this.enemyManager.getEnemyCount();
    const totalEntities = this.getTotalEntityCount();

    let performance: 'excellent' | 'good' | 'fair' | 'poor' = 'good';

    if (enemyCount > ENEMY_COUNT_THRESHOLDS.POOR) performance = 'poor';
    else if (enemyCount > ENEMY_COUNT_THRESHOLDS.FAIR) performance = 'fair';
    else if (enemyCount < ENEMY_COUNT_THRESHOLDS.EXCELLENT) performance = 'excellent';

    return {
      count: totalEntities,
      enemies: enemyCount,
      performance,
    };
  }

  /**
   * Assess system health
   */
  private assessSystems(): SystemHealth {
    // This would be enhanced to track actual system errors/warnings
    const positionComparison = this.positionSync.getPositionComparison();

    return {
      active: 5, // Would count actual active systems
      errors: positionComparison.inSync ? 0 : 1,
      warnings: 0,
    };
  }

  /**
   * Calculate overall health status
   */
  private calculateOverallHealth(
    performance: PerformanceHealth,
    memory: MemoryHealth,
    entities: EntityHealth,
    systems: SystemHealth
  ): OverallHealth {
    const issues: string[] = [];
    let score = 100;

    // Performance issues
    if (performance.fps < 30) {
      issues.push('Low FPS detected');
      score -= 30;
    }
    if (performance.trend === 'declining') {
      issues.push('Performance declining');
      score -= 10;
    }

    // Memory issues
    if (memory.critical) {
      issues.push('Critical memory usage');
      score -= 25;
    }
    if (memory.trend === 'increasing') {
      issues.push('Memory usage increasing');
      score -= 10;
    }

    // Entity issues
    if (entities.performance === 'poor') {
      issues.push('Too many entities');
      score -= 20;
    }

    // System issues
    if (systems.errors > 0) {
      issues.push('System errors detected');
      score -= 15;
    }

    // Determine status
    let status: 'excellent' | 'good' | 'warning' | 'critical';
    if (score >= 90) status = 'excellent';
    else if (score >= 70) status = 'good';
    else if (score >= 50) status = 'warning';
    else status = 'critical';

    return {
      status,
      score: Math.max(0, score),
      issues,
    };
  }

  /**
   * Get total entity count
   */
  private getTotalEntityCount(): number {
    // This would count all entities in the ECS system
    // For now, return a placeholder
    return 50; // Placeholder
  }

  /**
   * Get health history
   */
  getHealthHistory(): GameHealthSnapshot[] {
    return [...this.healthHistory];
  }

  /**
   * Get health trends over time
   */
  getHealthTrends(): {
    performance: number[];
    memory: number[];
    entities: number[];
    overall: number[];
  } {
    return {
      performance: this.healthHistory.map((h) => h.performance.fps),
      memory: this.healthHistory.map((h) => h.memory.usage),
      entities: this.healthHistory.map((h) => h.entities.enemies),
      overall: this.healthHistory.map((h) => h.overall.score),
    };
  }

  /**
   * Force health check update
   */
  forceHealthCheck(): void {
    this.updateHealthData();
  }

  /**
   * Check if game is in a healthy state
   */
  isGameHealthy(): boolean {
    const current = this.getCurrentHealth();
    return current.overall.status === 'excellent' || current.overall.status === 'good';
  }

  /**
   * Get health status color for UI
   */
  getHealthStatusColor(): string {
    const status = this.getCurrentHealth().overall.status;
    switch (status) {
      case 'excellent':
        return '#00ff00';
      case 'good':
        return '#90ff90';
      case 'warning':
        return '#ffaa00';
      case 'critical':
        return '#ff0000';
      default:
        return '#888888';
    }
  }

  /**
   * Stop monitoring (cleanup)
   */
  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Angular lifecycle hook - cleanup on destroy
   */
  ngOnDestroy(): void {
    this.destroy();
  }
}

// =============================================================================
// INTERFACES
// =============================================================================

export interface GameHealthData {
  overall: OverallHealth;
  performance: PerformanceHealth;
  memory: MemoryHealth;
  entities: EntityHealth;
  systems: SystemHealth;
  timestamp: number;
}

export interface GameHealthSnapshot extends GameHealthData {
  id: string;
}

export interface OverallHealth {
  status: 'excellent' | 'good' | 'warning' | 'critical' | 'unknown';
  score: number; // 0-100
  issues: string[];
}

export interface PerformanceHealth {
  fps: number;
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  score: number; // 0-100
}

export interface MemoryHealth {
  usage: number; // MB
  trend: 'stable' | 'increasing' | 'decreasing' | 'unknown';
  critical: boolean;
}

export interface EntityHealth {
  count: number;
  enemies: number;
  performance: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface SystemHealth {
  active: number;
  errors: number;
  warnings: number;
}
