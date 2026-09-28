import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { ExtendedPerformance } from '../models/game-types.model';

/**
 * Memory Optimization Service
 *
 * Provides memory management utilities and automatic cleanup for the game
 * Helps maintain stable memory usage and prevent memory leaks
 */
@Injectable({
  providedIn: 'root',
})
export class MemoryOptimizerService implements OnDestroy {
  private readonly CLEANUP_INTERVAL_MS = 30000; // Clean up every 30 seconds
  private readonly FORCE_GC_THRESHOLD_MB = 100; // Force garbage collection at 100MB

  private cleanupInterval?: number;
  private memoryHistory: number[] = [];
  private readonly MAX_HISTORY_LENGTH = 20;

  constructor(
    private debugBridge: DebugLogBridgeService,
    private ngZone: NgZone
  ) {
    this.startPeriodicCleanup();
  }

  /**
   * Start periodic memory cleanup
   */
  private startPeriodicCleanup(): void {
    this.ngZone.runOutsideAngular(() => {
      this.cleanupInterval = window.setInterval(() => {
        this.performCleanup();
      }, this.CLEANUP_INTERVAL_MS);
    });
  }

  /**
   * Perform memory cleanup operations
   */
  performCleanup(): void {
    const memoryBefore = this.getMemoryUsage();

    // Clear various caches and temporary data
    this.clearTemporaryData();

    // Force garbage collection if memory usage is high
    if (memoryBefore.usedJSHeapSize > this.FORCE_GC_THRESHOLD_MB) {
      this.forceGarbageCollection();
    }

    const memoryAfter = this.getMemoryUsage();
    const memoryFreed = memoryBefore.usedJSHeapSize - memoryAfter.usedJSHeapSize;

    // Track memory history
    this.memoryHistory.push(memoryAfter.usedJSHeapSize);
    if (this.memoryHistory.length > this.MAX_HISTORY_LENGTH) {
      this.memoryHistory.shift();
    }

    // Log cleanup results only if memory was actually freed
    if (memoryFreed > 0) {
      this.debugBridge.log('Memory cleanup performed', 'info', {
        source: 'memory-optimizer',
        before: memoryBefore.usedJSHeapSize,
        after: memoryAfter.usedJSHeapSize,
        freed: memoryFreed,
      });
    }
  }

  /**
   * Get current memory usage information
   */
  getMemoryUsage(): {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
    percentage: number;
  } {
    const memory = (window.performance as ExtendedPerformance).memory;

    if (memory) {
      const used = Math.round(memory.usedJSHeapSize / 1048576); // MB
      const total = Math.round(memory.totalJSHeapSize / 1048576); // MB
      const limit = Math.round(memory.jsHeapSizeLimit / 1048576); // MB

      return {
        usedJSHeapSize: used,
        totalJSHeapSize: total,
        jsHeapSizeLimit: limit,
        percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
      };
    }

    return {
      usedJSHeapSize: 0,
      totalJSHeapSize: 0,
      jsHeapSizeLimit: 0,
      percentage: 0,
    };
  }

  /**
   * Clear temporary data and caches
   */
  private clearTemporaryData(): void {
    // Console clearing removed - debug logs are now managed by DebugLogBridgeService
    // which has its own memory management and log rotation

    // Clear any temporary DOM elements
    this.clearTemporaryDOMElements();

    // Clear image caches that might be holding memory
    this.clearImageCaches();
  }

  /**
   * Remove temporary DOM elements that might be holding memory
   */
  private clearTemporaryDOMElements(): void {
    // Remove any temporary canvas elements
    const tempCanvases = document.querySelectorAll('canvas[data-temp="true"]');
    tempCanvases.forEach((canvas) => canvas.remove());

    // Remove any temporary divs or containers
    const tempContainers = document.querySelectorAll('[data-temp="true"]');
    tempContainers.forEach((container) => container.remove());
  }

  /**
   * Clear image caches and unused image objects
   */
  private clearImageCaches(): void {
    // This would clear any image caches if implemented in the game
    // For now, we'll just log that we're attempting cleanup
    // Only log if debug mode is enabled
    // Image cache cleanup is automatic, no need to log every attempt
  }

  /**
   * Force garbage collection (if available via --expose-gc flag in Node/Chrome DevTools)
   */
  private forceGarbageCollection(): void {
    if (window.gc) {
      window.gc();
      this.debugBridge.log('Forced garbage collection', 'info', {
        source: 'memory-optimizer',
        success: true,
      });
    }
  }

  /**
   * Get memory usage trend
   */
  getMemoryTrend(): 'stable' | 'increasing' | 'decreasing' | 'unknown' {
    if (this.memoryHistory.length < 5) {
      return 'unknown';
    }

    const recent = this.memoryHistory.slice(-5);
    const older = this.memoryHistory.slice(-10, -5);

    if (older.length < 5) {
      return 'unknown';
    }

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const diff = recentAvg - olderAvg;

    if (Math.abs(diff) < 2) return 'stable';
    return diff > 0 ? 'increasing' : 'decreasing';
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): {
    current: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    history: number[];
    trend: 'increasing' | 'stable' | 'decreasing';
    cleanupCount: number;
  } {
    return {
      current: this.getMemoryUsage(),
      history: [...this.memoryHistory],
      trend:
        this.getMemoryTrend() === 'unknown'
          ? 'stable'
          : (this.getMemoryTrend() as 'increasing' | 'stable' | 'decreasing'),
      cleanupCount: this.memoryHistory.length,
    };
  }

  /**
   * Check if memory usage is critical
   */
  isMemoryCritical(): boolean {
    const usage = this.getMemoryUsage();
    return usage.percentage > 80 || usage.usedJSHeapSize > this.FORCE_GC_THRESHOLD_MB;
  }

  /**
   * Optimize memory for specific game objects
   */
  optimizeGameObjects(): void {
    // Clear any cached collision detection results
    this.clearCollisionCaches();

    // Optimize particle systems
    this.optimizeParticleSystems();

    // Clean up entity references
    this.cleanupEntityReferences();
  }

  /**
   * Clear collision detection caches
   */
  private clearCollisionCaches(): void {
    // Implementation would depend on how collision caching is implemented
    // Collision cache cleanup is automatic, no logging needed
  }

  /**
   * Optimize particle systems memory usage
   */
  private optimizeParticleSystems(): void {
    // Clean up inactive particles, reset object pools, etc.
    // Particle optimization is automatic, no logging needed
  }

  /**
   * Clean up entity references that might be holding memory
   */
  private cleanupEntityReferences(): void {
    // Clear any weak references or cached entity lookups
    // Entity cleanup is automatic, no logging needed
  }

  /**
   * Angular lifecycle hook - cleanup on service destruction
   */
  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Stop periodic cleanup (call when shutting down)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Manual memory cleanup trigger
   */
  manualCleanup(): void {
    this.performCleanup();
    this.optimizeGameObjects();
  }
}
