import { SpatialEntity, SpatialGrid } from './spatial-grid';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

describe('SpatialGrid', () => {
  const makeEntity = (id: number, x: number, y: number, radius: number): SpatialEntity => ({ id, x, y, radius });
  const originalDebugLogBridge = window.debugLogBridge;

  afterEach(() => {
    window.debugLogBridge = originalDebugLogBridge;
  });

  it('returns a multi-cell overlap exactly once', () => {
    const grid = new SpatialGrid<SpatialEntity>(1000, 1000, 100);
    const entityA = makeEntity(1, 100, 100, 75);
    const entityB = makeEntity(2, 110, 110, 75);

    grid.insert(entityA);
    grid.insert(entityB);

    expect(grid.getPotentialPairs([entityA, entityB])).toEqual([[entityA, entityB]]);
  });

  it('detects overlaps that cross a cell boundary', () => {
    const grid = new SpatialGrid<SpatialEntity>(1000, 1000, 100);
    const entityA = makeEntity(1, 95, 50, 10);
    const entityB = makeEntity(2, 105, 50, 10);

    grid.insert(entityA);
    grid.insert(entityB);

    expect(grid.getPotentialPairs([entityA, entityB]).length).toBe(1);
  });

  it('does not report circles that only touch at their edges', () => {
    const grid = new SpatialGrid<SpatialEntity>(1000, 1000, 100);
    const entityA = makeEntity(1, 80, 50, 10);
    const entityB = makeEntity(2, 100, 50, 10);

    grid.insert(entityA);
    grid.insert(entityB);

    expect(grid.getPotentialPairs([entityA, entityB])).toEqual([]);
  });

  it('reuses cleared buckets without retaining stale entities', () => {
    const grid = new SpatialGrid<SpatialEntity>(1000, 1000, 100);
    const oldEntity = makeEntity(1, 50, 50, 20);
    const entityA = makeEntity(2, -20, -20, 15);
    const entityB = makeEntity(3, -10, -10, 15);
    grid.insert(oldEntity);

    grid.clear();
    grid.insert(entityA);
    grid.insert(entityB);

    const results = grid.query(-15, -15, 20);
    expect(results).toContain(entityA);
    expect(results).toContain(entityB);
    expect(results).not.toContain(oldEntity);
  });

  it('warns when a dense cell performs near brute-force pair checks', () => {
    const debugLogBridge = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);
    window.debugLogBridge = debugLogBridge;
    const grid = new SpatialGrid<SpatialEntity>(1000, 1000, 100);
    const entities = Array.from({ length: 11 }, (_, index) => makeEntity(index + 1, 50, 50, 1));
    entities.forEach((entity) => grid.insert(entity));

    grid.getPotentialPairs(entities);

    expect(debugLogBridge.log).toHaveBeenCalledWith(
      '⚠️ [SpatialGrid] Poor performance detected',
      'warning',
      jasmine.objectContaining({
        entities: 11,
        totalChecks: 55,
        bruteForceChecks: 55,
        checkRatio: 1,
      })
    );
  });
});
