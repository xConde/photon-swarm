import { Injectable } from '@angular/core';
import { ExtendedPerformance } from '../models/game-types.model';

const EMPTY_SYSTEM_TIMINGS: Readonly<Record<string, number>> = Object.freeze({});

interface CriticalMetrics {
  fps: number;
  longFrames: number;
  entityCount: number;
  memoryMB: number;
  memoryWarnings: number;
  isHealthy: boolean;
}

/**
 * Performance monitoring service for ECS systems and game components
 * Tracks system execution times, memory usage, and performance metrics
 */
@Injectable({
  providedIn: 'root',
})
export class PerformanceMonitorService {
  private readonly noOpTimer = new NoOpTimer();
  private systemMetrics = new Map<string, SystemMetrics>();
  private frameMetrics: FrameMetrics[] = [];
  private maxFrameHistory = 300; // Store last 300 frames (5 seconds at 60fps)
  private frameWriteIndex = 0;
  private isEnabled = true;
  private detailedTimingFrame = false;
  private forcedDetailedFrames = 0;
  private readonly DETAILED_TIMING_SAMPLE_INTERVAL = 10;

  // Spike detection — tracks frames exceeding budget for debugging
  private readonly SPIKE_THRESHOLD_MS = 20; // ~50fps threshold - anything below is a spike
  private spikeHistory: Array<{
    timestamp: number;
    frameTime: number;
    worstSystem: string;
    worstSystemTime: number;
    totalSystemTime: number;
    renderTime: number;
  }> = [];
  private readonly MAX_SPIKE_HISTORY = 50;
  private renderTimeThisFrame = 0;

  // Critical performance tracking
  private longFrameCount = 0;
  private totalEntityCount = 0;
  private memoryWarnings = 0;

  /** Called by rendering system to report render time separately from ECS system updates */
  recordRenderTime(ms: number): void {
    this.renderTimeThisFrame = ms;
  }

  /**
   * Select whether this frame receives full per-system instrumentation.
   * Regular development sampling is 1-in-10 frames; a spike enables the
   * next three frames so repeated stalls retain useful attribution.
   */
  beginFrame(frameNumber: number, detailedMonitoringEnabled: boolean): boolean {
    if (!this.isEnabled || !detailedMonitoringEnabled) {
      this.detailedTimingFrame = false;
      return false;
    }

    const isScheduledSample = frameNumber % this.DETAILED_TIMING_SAMPLE_INTERVAL === 1;
    const isForcedSample = this.forcedDetailedFrames > 0;
    if (isForcedSample) this.forcedDetailedFrames--;
    this.detailedTimingFrame = isScheduledSample || isForcedSample;
    return this.detailedTimingFrame;
  }

  isDetailedTimingEnabledForFrame(): boolean {
    return this.detailedTimingFrame;
  }

  /**
   * Start monitoring a system's performance
   */
  startSystemTimer(systemName: string): PerformanceTimer {
    if (!this.isEnabled || !this.detailedTimingFrame) return this.noOpTimer;

    const startTime = window.performance.now();
    return new PerformanceTimer(systemName, startTime, this);
  }

  /**
   * Record system execution metrics
   */
  recordSystemMetrics(systemName: string, duration: number, entityCount?: number): void {
    if (!this.isEnabled) return;

    let metrics = this.systemMetrics.get(systemName);
    if (!metrics) {
      metrics = {
        name: systemName,
        totalTime: 0,
        callCount: 0,
        averageTime: 0,
        maxTime: 0,
        minTime: Infinity,
        lastEntityCount: 0,
        performanceRating: 'good',
      };
      this.systemMetrics.set(systemName, metrics);
    }

    // Update metrics
    metrics.totalTime += duration;
    metrics.callCount++;
    metrics.averageTime = metrics.totalTime / metrics.callCount;
    metrics.maxTime = Math.max(metrics.maxTime, duration);
    metrics.minTime = Math.min(metrics.minTime, duration);

    if (entityCount !== undefined) {
      metrics.lastEntityCount = entityCount;
    }

    // Update performance rating
    metrics.performanceRating = this.calculatePerformanceRating(duration);

    // Log performance warnings
    if (duration > 16) {
      // More than 16ms (1 frame at 60fps)
      if (window.debugLogBridge) {
        window.debugLogBridge.log('⚠️ Performance Warning', duration > 33 ? 'error' : 'warning', {
          source: 'performance_monitor',
          system: systemName,
          duration: duration.toFixed(2),
          entityCount,
          severity: duration > 33 ? 'critical' : 'warning',
        });
      }
    }
  }

  /**
   * Record frame-level metrics
   */
  recordFrameMetrics(
    deltaTime: number,
    systemTimings: Readonly<Record<string, number>> | null = null,
    entityCount?: number,
    timestamp: number = window.performance.now()
  ): void {
    if (!this.isEnabled) return;

    let totalFrameTime = 0;
    if (systemTimings) {
      for (const key in systemTimings) {
        totalFrameTime += systemTimings[key];
      }
    }

    // The engine reuses its timing object. Snapshot only sampled frames so
    // retained history stays immutable without allocating a large object on
    // every normal frame.
    const retainedTimings = systemTimings ? { ...systemTimings } : EMPTY_SYSTEM_TIMINGS;
    const frameMetric: FrameMetrics = {
      timestamp,
      deltaTime,
      fps: 1000 / deltaTime,
      systemTimings: retainedTimings,
      totalFrameTime,
    };

    // Fixed-size ring buffer: avoids shifting 300 entries every frame once full.
    if (this.frameMetrics.length < this.maxFrameHistory) {
      this.frameMetrics.push(frameMetric);
    } else {
      this.frameMetrics[this.frameWriteIndex] = frameMetric;
      this.frameWriteIndex = (this.frameWriteIndex + 1) % this.maxFrameHistory;
    }

    if (entityCount !== undefined) this.totalEntityCount = entityCount;

    if (deltaTime > 20) this.longFrameCount++;

    if (frameMetric.fps < 30 && window.debugLogBridge) {
      window.debugLogBridge.log('📉 Low FPS Detected', 'warning', {
        source: 'frame_performance',
        fps: frameMetric.fps.toFixed(1),
        deltaTime: deltaTime.toFixed(2),
        totalFrameTime: frameMetric.totalFrameTime.toFixed(2),
        slowestSystem: this.getSlowestSystem(retainedTimings),
      });
    }

    if (deltaTime > this.SPIKE_THRESHOLD_MS) {
      let worstSystem = 'unknown';
      let worstTime = 0;
      let totalSystemTime = 0;
      for (const key in retainedTimings) {
        const time = retainedTimings[key];
        totalSystemTime += time;
        if (time > worstTime) {
          worstTime = time;
          worstSystem = key;
        }
      }
      this.spikeHistory.push({
        timestamp,
        frameTime: deltaTime,
        worstSystem,
        worstSystemTime: worstTime,
        totalSystemTime,
        renderTime: this.renderTimeThisFrame,
      });
      if (this.spikeHistory.length > this.MAX_SPIKE_HISTORY) this.spikeHistory.shift();
      this.forcedDetailedFrames = 3;
    }
    this.renderTimeThisFrame = 0;
  }

  /**
   * Get current performance summary
   */
  getPerformanceSummary(): PerformanceSummary {
    const recentFrames = this.getOrderedFrameHistory().slice(-30); // Last 30 frames
    const avgFps =
      recentFrames.length > 0 ? recentFrames.reduce((sum, frame) => sum + frame.fps, 0) / recentFrames.length : 60; // Default to 60 FPS if no frames recorded yet

    const systemSummaries = Array.from(this.systemMetrics.values()).map((metrics) => ({
      name: metrics.name,
      averageTime: Number(metrics.averageTime.toFixed(3)),
      maxTime: Number(metrics.maxTime.toFixed(3)),
      callCount: metrics.callCount,
      entityCount: metrics.lastEntityCount,
      performanceRating: metrics.performanceRating,
    }));

    return {
      averageFps: Number(avgFps.toFixed(1)),
      frameCount: this.frameMetrics.length,
      systemMetrics: systemSummaries,
      memoryUsage: this.getMemoryUsage(),
      performanceScore: this.calculateOverallPerformanceScore(avgFps, systemSummaries),
    };
  }

  /**
   * Get detailed system metrics
   */
  getSystemMetrics(systemName: string): SystemMetrics | undefined {
    return this.systemMetrics.get(systemName);
  }

  /**
   * Reset all performance metrics
   */
  resetMetrics(): void {
    this.systemMetrics.clear();
    this.frameMetrics = [];
    this.frameWriteIndex = 0;
    this.spikeHistory.length = 0;
    this.renderTimeThisFrame = 0;
    this.longFrameCount = 0;
    this.totalEntityCount = 0;
    this.memoryWarnings = 0;
    this.forcedDetailedFrames = 0;
    this.detailedTimingFrame = false;
  }

  /**
   * Enable/disable performance monitoring
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
  }

  /**
   * Check if monitoring is enabled
   */
  isMonitoringEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Get frame timing history for visualization
   */
  getFrameHistory(): FrameMetrics[] {
    return this.getOrderedFrameHistory();
  }

  /**
   * Get spike history for debug export
   */
  getSpikeHistory(): Array<{
    timestamp: number;
    frameTime: number;
    worstSystem: string;
    worstSystemTime: number;
    totalSystemTime: number;
    renderTime: number;
  }> {
    return this.spikeHistory.slice();
  }

  /**
   * Get summary stats across all recorded spikes
   */
  getSpikeSummary(): {
    total: number;
    avgFrameTime: number;
    maxFrameTime: number;
    avgRenderTime: number;
    maxRenderTime: number;
    worstSystems: Record<string, number>;
  } {
    const count = this.spikeHistory.length;
    if (count === 0) {
      return { total: 0, avgFrameTime: 0, maxFrameTime: 0, avgRenderTime: 0, maxRenderTime: 0, worstSystems: {} };
    }
    let totalFrameTime = 0;
    let maxFrameTime = 0;
    let totalRenderTime = 0;
    let maxRenderTime = 0;
    const systemCounts: Record<string, number> = {};
    for (const spike of this.spikeHistory) {
      totalFrameTime += spike.frameTime;
      if (spike.frameTime > maxFrameTime) maxFrameTime = spike.frameTime;
      totalRenderTime += spike.renderTime;
      if (spike.renderTime > maxRenderTime) maxRenderTime = spike.renderTime;
      systemCounts[spike.worstSystem] = (systemCounts[spike.worstSystem] ?? 0) + 1;
    }
    return {
      total: count,
      avgFrameTime: Number((totalFrameTime / count).toFixed(2)),
      maxFrameTime: Number(maxFrameTime.toFixed(2)),
      avgRenderTime: Number((totalRenderTime / count).toFixed(2)),
      maxRenderTime: Number(maxRenderTime.toFixed(2)),
      worstSystems: systemCounts,
    };
  }

  /**
   * Private helper methods
   */
  private calculatePerformanceRating(_duration: number): PerformanceRating {
    if (_duration < 1) return 'excellent';
    if (_duration < 5) return 'good';
    if (_duration < 16) return 'fair';
    return 'poor';
  }

  private getSlowestSystem(systemTimings: Readonly<Record<string, number>>): string {
    let slowestSystem = '';
    let maxTime = 0;

    for (const [system, time] of Object.entries(systemTimings)) {
      if (time > maxTime) {
        maxTime = time;
        slowestSystem = system;
      }
    }

    return slowestSystem;
  }

  private getOrderedFrameHistory(): FrameMetrics[] {
    if (this.frameMetrics.length < this.maxFrameHistory || this.frameWriteIndex === 0) {
      return this.frameMetrics.slice();
    }
    return this.frameMetrics.slice(this.frameWriteIndex).concat(this.frameMetrics.slice(0, this.frameWriteIndex));
  }

  private getMemoryUsage(): MemoryInfo {
    const memory = (window.performance as ExtendedPerformance).memory;

    if (memory) {
      return {
        usedJSHeapSize: Math.round(memory.usedJSHeapSize / 1048576), // MB
        totalJSHeapSize: Math.round(memory.totalJSHeapSize / 1048576), // MB
        jsHeapSizeLimit: Math.round(memory.jsHeapSizeLimit / 1048576), // MB
      };
    }

    return {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0,
    };
  }

  private calculateOverallPerformanceScore(
    avgFps: number,
    systems: { performanceRating: PerformanceRating }[]
  ): number {
    // Calculate performance score from 0-100
    const fpsScore = Math.min(100, (avgFps / 60) * 100);

    // Penalize systems with poor performance
    const poorSystems = systems.filter((s) => s.performanceRating === 'poor').length;
    const systemPenalty = poorSystems * 10;

    return Math.max(0, Math.round(fpsScore - systemPenalty));
  }

  /**
   * Check memory usage and track warnings
   */
  checkMemoryUsage(): void {
    const perf = window.performance as ExtendedPerformance;
    if (perf.memory) {
      const usedMB = Math.round(perf.memory.usedJSHeapSize / 1048576);
      const limitMB = Math.round(perf.memory.jsHeapSizeLimit / 1048576);
      const percentage = (usedMB / limitMB) * 100;

      if (percentage > 80) {
        this.memoryWarnings++;
        if (window.debugLogBridge) {
          window.debugLogBridge.log('💾 High Memory Usage', 'error', {
            source: 'performance_monitor',
            usedMB,
            limitMB,
            percentage: percentage.toFixed(1),
            warnings: this.memoryWarnings,
          });
        }
      }
    }
  }

  /**
   * Get critical performance metrics
   */
  getCriticalMetrics(): CriticalMetrics {
    const recentFrames = this.getOrderedFrameHistory();
    const avgFps =
      recentFrames.length > 0
        ? recentFrames.reduce((sum: number, frame: FrameMetrics) => sum + frame.fps, 0) / recentFrames.length
        : 60;
    const perf = window.performance as ExtendedPerformance;

    return {
      fps: avgFps,
      longFrames: this.longFrameCount,
      entityCount: this.totalEntityCount,
      memoryMB: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : 0,
      memoryWarnings: this.memoryWarnings,
      isHealthy: avgFps > 45 && this.longFrameCount < 10 && this.memoryWarnings < 3,
    };
  }

  /**
   * Log critical performance report
   */
  logCriticalReport(): void {
    const metrics = this.getCriticalMetrics();

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🎮 Critical Performance Metrics', metrics.isHealthy ? 'info' : 'warning', {
        source: 'performance_monitor',
        fps: metrics.fps,
        longFrames: metrics.longFrames,
        entityCount: metrics.entityCount,
        memoryMB: metrics.memoryMB,
        memoryWarnings: metrics.memoryWarnings,
        healthStatus: metrics.isHealthy ? '✅ Healthy' : '⚠️ Degraded',
      });
    }
  }
}

/**
 * Performance timer class
 */
export class PerformanceTimer {
  constructor(
    private systemName: string,
    private startTime: number,
    private monitor: PerformanceMonitorService
  ) {}

  end(entityCount?: number): number {
    const duration = window.performance.now() - this.startTime;
    this.monitor.recordSystemMetrics(this.systemName, duration, entityCount);
    return duration;
  }
}

/**
 * No-op timer for when monitoring is disabled
 */
class NoOpTimer extends PerformanceTimer {
  constructor() {
    super('', 0, undefined as unknown as PerformanceMonitorService);
  }

  override end(): number {
    return 0;
  }
}

/**
 * Performance monitoring decorator — intentionally a no-op passthrough.
 *
 * The original implementation instantiated `new PerformanceMonitorService()` directly,
 * bypassing Angular DI. Each decorated call got a throwaway singleton whose metrics were
 * never aggregated and never surfaced anywhere. The disconnected instance was also a
 * per-call allocation that fired on every decorated invocation.
 *
 * The decorator is kept as a no-op export so existing `@MonitorPerformance` call sites
 * continue to compile without changes. If per-method timing is needed in the future,
 * inject `PerformanceMonitorService` via DI and call `startSystemTimer` / `timer.end()`
 * directly inside the method body.
 */
export function MonitorPerformance(_systemName?: string) {
  return function (_target: unknown, _propertyKey: string, _descriptor: PropertyDescriptor) {
    // no-op: original broke DI, metrics were never aggregated
  };
}

// =============================================================================
// INTERFACES
// =============================================================================

export interface SystemMetrics {
  name: string;
  totalTime: number;
  callCount: number;
  averageTime: number;
  maxTime: number;
  minTime: number;
  lastEntityCount: number;
  performanceRating: PerformanceRating;
}

export interface FrameMetrics {
  timestamp: number;
  deltaTime: number;
  fps: number;
  systemTimings: Readonly<Record<string, number>>;
  totalFrameTime: number;
}

export interface PerformanceSummary {
  averageFps: number;
  frameCount: number;
  systemMetrics: {
    name: string;
    averageTime: number;
    maxTime: number;
    callCount: number;
    entityCount: number;
    performanceRating: PerformanceRating;
  }[];
  memoryUsage: MemoryInfo;
  performanceScore: number;
}

export interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export type PerformanceRating = 'excellent' | 'good' | 'fair' | 'poor';
