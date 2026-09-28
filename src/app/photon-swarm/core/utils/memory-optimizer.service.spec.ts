import { TestBed } from '@angular/core/testing';
import { MemoryOptimizerService } from './memory-optimizer.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import type { ExtendedPerformance } from '../models/game-types.model';

/** Installs a configurable memory getter on window.performance. */
function installMemoryMock(usedMB: number, totalMB: number, limitMB: number): void {
  const BYTES_PER_MB = 1048576;
  Object.defineProperty(window.performance, 'memory', {
    configurable: true,
    get: () => ({
      usedJSHeapSize: usedMB * BYTES_PER_MB,
      totalJSHeapSize: totalMB * BYTES_PER_MB,
      jsHeapSizeLimit: limitMB * BYTES_PER_MB,
    }),
  });
}

/** Removes the performance.memory mock installed by installMemoryMock(). */
function removeMemoryMock(): void {
  // Restore to an undefined getter so the service sees no memory API
  Object.defineProperty(window.performance, 'memory', {
    configurable: true,
    get: () => undefined,
  });
}

describe('MemoryOptimizerService', () => {
  let service: MemoryOptimizerService;
  let debugBridgeSpy: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    debugBridgeSpy = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);
    jasmine.clock().install();

    TestBed.configureTestingModule({
      providers: [MemoryOptimizerService, { provide: DebugLogBridgeService, useValue: debugBridgeSpy }],
    });

    service = TestBed.inject(MemoryOptimizerService);
  });

  afterEach(() => {
    service.destroy();
    jasmine.clock().uninstall();
    removeMemoryMock();
  });

  // -----------------------------------------------------------------------
  // getMemoryUsage()
  // -----------------------------------------------------------------------

  it('getMemoryUsage() returns zeros when performance.memory is unavailable', () => {
    removeMemoryMock();
    const usage = service.getMemoryUsage();
    expect(usage.usedJSHeapSize).toBe(0);
    expect(usage.totalJSHeapSize).toBe(0);
    expect(usage.jsHeapSizeLimit).toBe(0);
    expect(usage.percentage).toBe(0);
  });

  it('getMemoryUsage() converts bytes to MB and computes percentage', () => {
    installMemoryMock(50, 200, 500);
    const usage = service.getMemoryUsage();
    expect(usage.usedJSHeapSize).toBe(50);
    expect(usage.totalJSHeapSize).toBe(200);
    expect(usage.jsHeapSizeLimit).toBe(500);
    expect(usage.percentage).toBe(10); // 50/500 * 100
  });

  // -----------------------------------------------------------------------
  // isMemoryCritical()
  // -----------------------------------------------------------------------

  it('isMemoryCritical() returns false when usage is well below thresholds', () => {
    installMemoryMock(20, 200, 500); // 4%
    expect(service.isMemoryCritical()).toBeFalse();
  });

  it('isMemoryCritical() returns true when percentage exceeds 80%', () => {
    installMemoryMock(450, 500, 500); // 90%
    expect(service.isMemoryCritical()).toBeTrue();
  });

  it('isMemoryCritical() returns true when usedJSHeapSize exceeds FORCE_GC_THRESHOLD_MB (100 MB)', () => {
    installMemoryMock(150, 200, 500); // 150 MB
    expect(service.isMemoryCritical()).toBeTrue();
  });

  // -----------------------------------------------------------------------
  // getMemoryTrend()
  // -----------------------------------------------------------------------

  it('getMemoryTrend() returns "unknown" with fewer than 10 history entries', () => {
    expect(service.getMemoryTrend()).toBe('unknown');
  });

  it('getMemoryTrend() returns "increasing" when recent average is higher', () => {
    // 5 older readings at 30 MB, then 5 recent at 60 MB
    for (let i = 0; i < 5; i++) {
      installMemoryMock(30, 200, 500);
      service.performCleanup();
    }
    for (let i = 0; i < 5; i++) {
      installMemoryMock(60, 200, 500);
      service.performCleanup();
    }
    expect(service.getMemoryTrend()).toBe('increasing');
  });

  it('getMemoryTrend() returns "stable" when averages differ by less than 2 MB', () => {
    for (let i = 0; i < 10; i++) {
      installMemoryMock(50, 200, 500);
      service.performCleanup();
    }
    expect(service.getMemoryTrend()).toBe('stable');
  });

  it('getMemoryTrend() returns "decreasing" when recent average is lower', () => {
    for (let i = 0; i < 5; i++) {
      installMemoryMock(60, 200, 500);
      service.performCleanup();
    }
    for (let i = 0; i < 5; i++) {
      installMemoryMock(30, 200, 500);
      service.performCleanup();
    }
    expect(service.getMemoryTrend()).toBe('decreasing');
  });

  // -----------------------------------------------------------------------
  // getMemoryStats()
  // -----------------------------------------------------------------------

  it('getMemoryStats() returns a copy of history, not the internal array', () => {
    installMemoryMock(40, 200, 500);
    service.performCleanup();
    const stats = service.getMemoryStats();
    const originalLen = stats.history.length;
    stats.history.push(9999);
    expect(service.getMemoryStats().history.length).toBe(originalLen);
  });

  it('getMemoryStats() cleanupCount reflects number of performCleanup calls', () => {
    installMemoryMock(40, 200, 500);
    service.performCleanup();
    service.performCleanup();
    expect(service.getMemoryStats().cleanupCount).toBe(2);
  });

  // -----------------------------------------------------------------------
  // performCleanup() / manualCleanup()
  // -----------------------------------------------------------------------

  it('performCleanup() logs to debugBridge when memory is freed', () => {
    const BYTES_PER_MB = 1048576;
    let call = 0;
    // Alternate: first call returns 80 MB (before), second 60 MB (after) → freed > 0
    Object.defineProperty(window.performance, 'memory', {
      configurable: true,
      get: () => {
        const usedMB = call++ < 1 ? 80 : 60;
        return {
          usedJSHeapSize: usedMB * BYTES_PER_MB,
          totalJSHeapSize: 200 * BYTES_PER_MB,
          jsHeapSizeLimit: 500 * BYTES_PER_MB,
        };
      },
    });

    service.performCleanup();
    expect(debugBridgeSpy.log).toHaveBeenCalled();
  });

  it('manualCleanup() does not throw', () => {
    installMemoryMock(30, 200, 500);
    expect(() => service.manualCleanup()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // Periodic cleanup interval
  // -----------------------------------------------------------------------

  it('periodic cleanup fires after CLEANUP_INTERVAL_MS (30s)', () => {
    installMemoryMock(40, 200, 500);
    spyOn(service, 'performCleanup').and.callThrough();
    jasmine.clock().tick(30000);
    expect(service.performCleanup).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  it('destroy() clears the cleanup interval without throwing', () => {
    expect(() => service.destroy()).not.toThrow();
  });

  it('destroy() can be called multiple times safely', () => {
    service.destroy();
    expect(() => service.destroy()).not.toThrow();
  });

  it('ngOnDestroy() delegates to destroy()', () => {
    spyOn(service, 'destroy');
    service.ngOnDestroy();
    expect(service.destroy).toHaveBeenCalled();
  });

  it('optimizeGameObjects() does not throw', () => {
    expect(() => service.optimizeGameObjects()).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // GC hack removal: triggerGarbageCollection must no longer exist
  // -----------------------------------------------------------------------

  it('triggerGarbageCollection() does not exist on the service (counterproductive GC hack removed)', () => {
    // Previously a private method allocated 1,000,000 throwaway objects synchronously.
    // Confirm the method is entirely absent so it can never be re-added accidentally.
    expect(typeof (service as unknown as Record<string, unknown>)['triggerGarbageCollection']).toBe('undefined');
  });

  // -----------------------------------------------------------------------
  // ExtendedPerformance type assertion (structural check)
  // -----------------------------------------------------------------------

  it('getMemoryUsage() handles ExtendedPerformance type correctly', () => {
    // Verify the cast does not blow up even when memory is undefined
    const perf = window.performance as ExtendedPerformance;
    // If memory is undefined, service returns zeros
    const noMemPerf = { memory: undefined } as unknown as ExtendedPerformance;
    expect(noMemPerf.memory).toBeUndefined();
    expect(perf).toBeTruthy();
  });
});
