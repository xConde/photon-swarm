import { TestBed } from '@angular/core/testing';
import { PerformanceMonitorService } from './performance-monitor.service';
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

function removeMemoryMock(): void {
  Object.defineProperty(window.performance, 'memory', {
    configurable: true,
    get: () => undefined,
  });
}

describe('PerformanceMonitorService', () => {
  let service: PerformanceMonitorService;

  beforeEach(() => {
    delete window.debugLogBridge;

    TestBed.configureTestingModule({});
    service = TestBed.inject(PerformanceMonitorService);
  });

  afterEach(() => {
    service.resetMetrics();
    removeMemoryMock();
  });

  // -----------------------------------------------------------------------
  // isMonitoringEnabled / setEnabled
  // -----------------------------------------------------------------------

  it('should be enabled by default', () => {
    expect(service.isMonitoringEnabled()).toBeTrue();
  });

  it('setEnabled(false) disables monitoring', () => {
    service.setEnabled(false);
    expect(service.isMonitoringEnabled()).toBeFalse();
  });

  it('setEnabled(true) re-enables monitoring', () => {
    service.setEnabled(false);
    service.setEnabled(true);
    expect(service.isMonitoringEnabled()).toBeTrue();
  });

  // -----------------------------------------------------------------------
  // recordSystemMetrics() / getSystemMetrics()
  // -----------------------------------------------------------------------

  it('getSystemMetrics() returns undefined for unknown system before any recording', () => {
    expect(service.getSystemMetrics('unknown')).toBeUndefined();
  });

  it('recordSystemMetrics() creates new entry for a new system name', () => {
    service.recordSystemMetrics('MovementSystem', 5);
    const metrics = service.getSystemMetrics('MovementSystem');
    expect(metrics).toBeDefined();
    expect(metrics!.name).toBe('MovementSystem');
    expect(metrics!.callCount).toBe(1);
    expect(metrics!.totalTime).toBeCloseTo(5);
  });

  it('recordSystemMetrics() accumulates call counts correctly', () => {
    service.recordSystemMetrics('RenderSystem', 3);
    service.recordSystemMetrics('RenderSystem', 7);
    const metrics = service.getSystemMetrics('RenderSystem');
    expect(metrics!.callCount).toBe(2);
    expect(metrics!.averageTime).toBeCloseTo(5);
  });

  it('recordSystemMetrics() tracks maxTime correctly', () => {
    service.recordSystemMetrics('CollisionSystem', 2);
    service.recordSystemMetrics('CollisionSystem', 10);
    service.recordSystemMetrics('CollisionSystem', 6);
    expect(service.getSystemMetrics('CollisionSystem')!.maxTime).toBe(10);
  });

  it('recordSystemMetrics() tracks minTime correctly', () => {
    service.recordSystemMetrics('AISystem', 8);
    service.recordSystemMetrics('AISystem', 3);
    service.recordSystemMetrics('AISystem', 6);
    expect(service.getSystemMetrics('AISystem')!.minTime).toBe(3);
  });

  it('recordSystemMetrics() stores the last entity count', () => {
    service.recordSystemMetrics('SpawnSystem', 5, 42);
    expect(service.getSystemMetrics('SpawnSystem')!.lastEntityCount).toBe(42);
  });

  it('recordSystemMetrics() assigns "excellent" for duration < 1ms', () => {
    service.recordSystemMetrics('FastSystem', 0.5);
    expect(service.getSystemMetrics('FastSystem')!.performanceRating).toBe('excellent');
  });

  it('recordSystemMetrics() assigns "good" for 1ms <= duration < 5ms', () => {
    service.recordSystemMetrics('GoodSystem', 3);
    expect(service.getSystemMetrics('GoodSystem')!.performanceRating).toBe('good');
  });

  it('recordSystemMetrics() assigns "fair" for 5ms <= duration < 16ms', () => {
    service.recordSystemMetrics('FairSystem', 10);
    expect(service.getSystemMetrics('FairSystem')!.performanceRating).toBe('fair');
  });

  it('recordSystemMetrics() assigns "poor" for duration >= 16ms', () => {
    service.recordSystemMetrics('SlowSystem', 20);
    expect(service.getSystemMetrics('SlowSystem')!.performanceRating).toBe('poor');
  });

  it('recordSystemMetrics() is no-op when monitoring is disabled', () => {
    service.setEnabled(false);
    service.recordSystemMetrics('AnySystem', 5);
    expect(service.getSystemMetrics('AnySystem')).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // recordFrameMetrics()
  // -----------------------------------------------------------------------

  it('recordFrameMetrics() is no-op when monitoring is disabled', () => {
    service.setEnabled(false);
    service.recordFrameMetrics(16, { render: 5 });
    expect(service.getFrameHistory().length).toBe(0);
  });

  it('recordFrameMetrics() appends to frame history', () => {
    service.recordFrameMetrics(16, { render: 5 });
    expect(service.getFrameHistory().length).toBe(1);
  });

  it('recordFrameMetrics() computes fps correctly from deltaTime', () => {
    service.recordFrameMetrics(20, {});
    expect(service.getFrameHistory()[0].fps).toBeCloseTo(50);
  });

  it('recordFrameMetrics() caps frame history at maxFrameHistory (300)', () => {
    for (let i = 0; i < 310; i++) {
      service.recordFrameMetrics(16, {});
    }
    expect(service.getFrameHistory().length).toBe(300);
  });

  it('recordFrameMetrics() snapshots reused timing objects', () => {
    const timings = { RenderSystem: 4 };
    service.recordFrameMetrics(16, timings);

    timings.RenderSystem = 99;

    expect(service.getFrameHistory()[0].systemTimings['RenderSystem']).toBe(4);
  });

  it('recordFrameMetrics() keeps ring-buffer history in chronological order', () => {
    for (let i = 0; i < 305; i++) {
      service.recordFrameMetrics(16, null, 0, i);
    }

    const history = service.getFrameHistory();
    expect(history[0].timestamp).toBe(5);
    expect(history[history.length - 1].timestamp).toBe(304);
  });

  // -----------------------------------------------------------------------
  // getPerformanceSummary()
  // -----------------------------------------------------------------------

  it('getPerformanceSummary() returns averageFps of 60 with no frames recorded', () => {
    const summary = service.getPerformanceSummary();
    expect(summary.averageFps).toBe(60);
  });

  it('getPerformanceSummary() computes averageFps from recent frames', () => {
    for (let i = 0; i < 4; i++) {
      service.recordFrameMetrics(25, {}); // 1000/25 = 40 FPS
    }
    expect(service.getPerformanceSummary().averageFps).toBeCloseTo(40, 0);
  });

  it('getPerformanceSummary() includes system metrics entries', () => {
    service.recordSystemMetrics('SomeSystem', 4);
    const summary = service.getPerformanceSummary();
    expect(summary.systemMetrics.length).toBeGreaterThan(0);
    expect(summary.systemMetrics[0].name).toBe('SomeSystem');
  });

  it('getPerformanceSummary() penalises poor systems in performanceScore', () => {
    // Poor system forces penalty
    service.recordSystemMetrics('Slow1', 20);
    service.recordSystemMetrics('Slow2', 20);
    const summary = service.getPerformanceSummary();
    // Each poor system subtracts 10 from fpsScore; 2 poor systems = -20
    expect(summary.performanceScore).toBeLessThanOrEqual(80);
  });

  // -----------------------------------------------------------------------
  // resetMetrics()
  // -----------------------------------------------------------------------

  it('resetMetrics() clears both system and frame metrics', () => {
    service.recordSystemMetrics('X', 5);
    service.recordFrameMetrics(16, {});
    service.resetMetrics();
    expect(service.getSystemMetrics('X')).toBeUndefined();
    expect(service.getFrameHistory().length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // getFrameHistory()
  // -----------------------------------------------------------------------

  it('getFrameHistory() returns a copy — external mutations do not affect state', () => {
    service.recordFrameMetrics(16, {});
    const history = service.getFrameHistory();
    const originalLen = history.length;
    history.push({ timestamp: 0, deltaTime: 0, fps: 0, systemTimings: {}, totalFrameTime: 0 });
    expect(service.getFrameHistory().length).toBe(originalLen);
  });

  // -----------------------------------------------------------------------
  // startSystemTimer()
  // -----------------------------------------------------------------------

  it('startSystemTimer() end() records metrics and returns non-negative duration', () => {
    service.beginFrame(1, true);
    const timer = service.startSystemTimer('TestSystem');
    const duration = timer.end(10);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(service.getSystemMetrics('TestSystem')).toBeDefined();
    expect(service.getSystemMetrics('TestSystem')!.lastEntityCount).toBe(10);
  });

  it('startSystemTimer() when disabled returns a no-op timer that records nothing', () => {
    service.setEnabled(false);
    const timer = service.startSystemTimer('DisabledSystem');
    timer.end();
    expect(service.getSystemMetrics('DisabledSystem')).toBeUndefined();
  });

  it('samples detailed timings instead of enabling them on every frame', () => {
    expect(service.beginFrame(1, true)).toBeTrue();
    expect(service.beginFrame(2, true)).toBeFalse();
    expect(service.beginFrame(11, true)).toBeTrue();
    expect(service.beginFrame(12, false)).toBeFalse();
  });

  // -----------------------------------------------------------------------
  // getCriticalMetrics()
  // -----------------------------------------------------------------------

  it('getCriticalMetrics() isHealthy is true with default state', () => {
    expect(service.getCriticalMetrics().isHealthy).toBeTrue();
  });

  it('getCriticalMetrics() reports longFrames count after frames >20ms', () => {
    for (let i = 0; i < 5; i++) {
      service.recordFrameMetrics(25, {}); // 25ms > 20ms threshold
    }
    expect(service.getCriticalMetrics().longFrames).toBe(5);
  });

  it('getCriticalMetrics() reads FPS and entity count from recorded frames', () => {
    service.recordFrameMetrics(25, null, 42);

    expect(service.getCriticalMetrics().fps).toBeCloseTo(40);
    expect(service.getCriticalMetrics().entityCount).toBe(42);
  });

  it('getCriticalMetrics() isHealthy false when longFrameCount >= 10', () => {
    for (let i = 0; i < 10; i++) {
      service.recordFrameMetrics(25, {});
    }
    expect(service.getCriticalMetrics().isHealthy).toBeFalse();
  });

  // -----------------------------------------------------------------------
  // checkMemoryUsage()
  // -----------------------------------------------------------------------

  it('checkMemoryUsage() does not throw when performance.memory is unavailable', () => {
    removeMemoryMock();
    expect(() => service.checkMemoryUsage()).not.toThrow();
  });

  it('checkMemoryUsage() increments memoryWarnings when usage exceeds 80%', () => {
    installMemoryMock(450, 500, 500); // 90% usage

    service.checkMemoryUsage();
    service.checkMemoryUsage();

    expect(service.getCriticalMetrics().memoryWarnings).toBe(2);
  });

  it('checkMemoryUsage() does not increment warnings when usage is below 80%', () => {
    installMemoryMock(30, 200, 500); // 6%

    service.checkMemoryUsage();

    expect(service.getCriticalMetrics().memoryWarnings).toBe(0);
  });
});
