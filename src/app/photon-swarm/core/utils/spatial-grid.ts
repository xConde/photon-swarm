/**
 * Spatial grid for efficient collision detection.
 *
 * Numeric cell keys, pooled cell buckets, and pooled pair tuples keep the
 * per-frame collision rebuild free of string parsing and short-lived objects.
 */
export class SpatialGrid<T extends SpatialEntity> {
  private static readonly INEFFICIENT_CHECK_RATIO = 0.75;

  private readonly grid = new Map<number, SpatialCell<T>>();
  private readonly cellPool: SpatialCell<T>[] = [];
  private readonly pairsBuffer: Array<[T, T]> = [];
  private readonly pairPool: Array<[T, T]> = [];
  private readonly processedPairs = new Set<number>();

  private readonly stats = {
    totalChecks: 0,
    savedChecks: 0,
    gridHits: 0,
    gridMisses: 0,
  };
  private lastPerformanceWarning = 0;

  constructor(
    _worldWidth: number,
    _worldHeight: number,
    private readonly cellSize: number = 100
  ) {}

  /** Return all active buckets to the pool for reuse by the next rebuild. */
  clear(): void {
    for (const cell of this.grid.values()) {
      cell.entities.length = 0;
      this.cellPool.push(cell);
    }
    this.grid.clear();
  }

  insert(entity: T): void {
    const startX = Math.floor((entity.x - entity.radius) / this.cellSize);
    const endX = Math.floor((entity.x + entity.radius) / this.cellSize);
    const startY = Math.floor((entity.y - entity.radius) / this.cellSize);
    const endY = Math.floor((entity.y + entity.radius) / this.cellSize);

    for (let cellX = startX; cellX <= endX; cellX++) {
      for (let cellY = startY; cellY <= endY; cellY++) {
        this.getOrCreateCell(cellX, cellY).entities.push(entity);
      }
    }
  }

  remove(entity: T): void {
    this.removeFromBounds(
      entity,
      entity.x - entity.radius,
      entity.y - entity.radius,
      entity.x + entity.radius,
      entity.y + entity.radius
    );
  }

  update(entity: T, oldX: number, oldY: number): void {
    this.removeFromBounds(
      entity,
      oldX - entity.radius,
      oldY - entity.radius,
      oldX + entity.radius,
      oldY + entity.radius
    );
    this.insert(entity);
  }

  query(x: number, y: number, radius: number): T[] {
    const results = new Set<T>();
    const startX = Math.floor((x - radius) / this.cellSize);
    const endX = Math.floor((x + radius) / this.cellSize);
    const startY = Math.floor((y - radius) / this.cellSize);
    const endY = Math.floor((y + radius) / this.cellSize);

    for (let cellX = startX; cellX <= endX; cellX++) {
      for (let cellY = startY; cellY <= endY; cellY++) {
        const cell = this.grid.get(this.getCellKey(cellX, cellY));
        if (!cell) {
          this.stats.gridMisses++;
          continue;
        }

        this.stats.gridHits++;
        for (const entity of cell.entities) {
          const dx = entity.x - x;
          const dy = entity.y - y;
          const combinedRadius = radius + entity.radius;
          if (dx * dx + dy * dy <= combinedRadius * combinedRadius) results.add(entity);
        }
      }
    }

    return Array.from(results);
  }

  /**
   * Return confirmed circular overlaps.
   *
   * Entities occupy every cell touched by their bounds, so overlapping circles
   * necessarily share at least one bucket. Pair IDs suppress repeats when large
   * entities share several buckets.
   *
   * The returned array is a scratch buffer and must be consumed immediately.
   */
  getPotentialPairs(entities: T[]): Array<[T, T]> {
    this.pairsBuffer.length = 0;
    this.processedPairs.clear();
    this.stats.totalChecks = 0;

    for (const cell of this.grid.values()) {
      const cellEntities = cell.entities;
      for (let i = 0; i < cellEntities.length; i++) {
        const entityA = cellEntities[i];
        for (let j = i + 1; j < cellEntities.length; j++) {
          const entityB = cellEntities[j];
          const pairKey = this.getPairKey(entityA.id, entityB.id);
          if (this.processedPairs.has(pairKey)) continue;

          this.processedPairs.add(pairKey);
          this.stats.totalChecks++;

          const dx = entityA.x - entityB.x;
          const dy = entityA.y - entityB.y;
          const combinedRadius = entityA.radius + entityB.radius;
          if (dx * dx + dy * dy < combinedRadius * combinedRadius) {
            this.appendPair(entityA, entityB);
          }
        }
      }
    }

    const bruteForceChecks = (entities.length * (entities.length - 1)) / 2;
    this.stats.savedChecks = Math.max(0, bruteForceChecks - this.stats.totalChecks);
    this.warnIfGridIsInefficient(entities.length, bruteForceChecks);
    return this.pairsBuffer;
  }

  getStats(): SpatialGridStats {
    let efficiency = 0;
    const totalPossibleChecks = this.stats.savedChecks + this.stats.totalChecks;
    if (totalPossibleChecks > 0) efficiency = (this.stats.savedChecks / totalPossibleChecks) * 100;

    return {
      ...this.stats,
      efficiency: Math.max(0, Math.min(100, efficiency)),
      cellCount: this.grid.size,
      avgEntitiesPerCell: this.getAvgEntitiesPerCell(),
    };
  }

  resetStats(): void {
    this.stats.totalChecks = 0;
    this.stats.savedChecks = 0;
    this.stats.gridHits = 0;
    this.stats.gridMisses = 0;
  }

  getDebugData(): { cells: Array<{ x: number; y: number; count: number }> } {
    const cells: Array<{ x: number; y: number; count: number }> = [];
    for (const cell of this.grid.values()) {
      cells.push({
        x: cell.x * this.cellSize,
        y: cell.y * this.cellSize,
        count: cell.entities.length,
      });
    }
    return { cells };
  }

  getRecommendedCellSize(entities: T[]): number {
    if (entities.length === 0) return this.cellSize;

    let radiusTotal = 0;
    for (const entity of entities) radiusTotal += entity.radius;
    const recommendedSize = Math.round((radiusTotal / entities.length) * 3);
    return Math.max(50, Math.min(500, recommendedSize));
  }

  private appendPair(entityA: T, entityB: T): void {
    const index = this.pairsBuffer.length;
    let pair = this.pairPool[index];
    if (!pair) {
      pair = [entityA, entityB];
      this.pairPool.push(pair);
    } else {
      pair[0] = entityA;
      pair[1] = entityB;
    }
    this.pairsBuffer.push(pair);
  }

  private getOrCreateCell(x: number, y: number): SpatialCell<T> {
    const key = this.getCellKey(x, y);
    const existing = this.grid.get(key);
    if (existing) return existing;

    const cell = this.cellPool.pop() ?? { x, y, entities: [] };
    cell.x = x;
    cell.y = y;
    cell.entities.length = 0;
    this.grid.set(key, cell);
    return cell;
  }

  private removeFromBounds(entity: T, minX: number, minY: number, maxX: number, maxY: number): void {
    const startX = Math.floor(minX / this.cellSize);
    const endX = Math.floor(maxX / this.cellSize);
    const startY = Math.floor(minY / this.cellSize);
    const endY = Math.floor(maxY / this.cellSize);

    for (let cellX = startX; cellX <= endX; cellX++) {
      for (let cellY = startY; cellY <= endY; cellY++) {
        const key = this.getCellKey(cellX, cellY);
        const cell = this.grid.get(key);
        if (!cell) continue;

        const index = cell.entities.indexOf(entity);
        if (index !== -1) cell.entities.splice(index, 1);
        if (cell.entities.length === 0) {
          this.grid.delete(key);
          this.cellPool.push(cell);
        }
      }
    }
  }

  /** Collision-free pairing for the small signed integer coordinates used by the world grid. */
  private getCellKey(x: number, y: number): number {
    return this.pairSignedIntegers(x, y);
  }

  private getPairKey(entityA: number, entityB: number): number {
    const minId = Math.min(entityA, entityB);
    const maxId = Math.max(entityA, entityB);
    return this.pairSignedIntegers(minId, maxId);
  }

  private pairSignedIntegers(a: number, b: number): number {
    const naturalA = a >= 0 ? a * 2 : -a * 2 - 1;
    const naturalB = b >= 0 ? b * 2 : -b * 2 - 1;
    const sum = naturalA + naturalB;
    return (sum * (sum + 1)) / 2 + naturalB;
  }

  private getAvgEntitiesPerCell(): number {
    if (this.grid.size === 0) return 0;
    let totalEntities = 0;
    for (const cell of this.grid.values()) totalEntities += cell.entities.length;
    return totalEntities / this.grid.size;
  }

  private warnIfGridIsInefficient(entityCount: number, bruteForceChecks: number): void {
    if (bruteForceChecks === 0 || entityCount <= 10) return;

    const checkRatio = this.stats.totalChecks / bruteForceChecks;
    if (checkRatio < SpatialGrid.INEFFICIENT_CHECK_RATIO) return;

    const now = Date.now();
    if (this.lastPerformanceWarning && now - this.lastPerformanceWarning <= 5000) return;
    this.lastPerformanceWarning = now;

    if (typeof window !== 'undefined' && window.debugLogBridge) {
      window.debugLogBridge.log('⚠️ [SpatialGrid] Poor performance detected', 'warning', {
        source: 'spatial_grid',
        entities: entityCount,
        totalChecks: this.stats.totalChecks,
        bruteForceChecks,
        checkRatio,
        cellSize: this.cellSize,
        cellCount: this.grid.size,
        avgEntitiesPerCell: this.getAvgEntitiesPerCell(),
      });
    }
  }
}

interface SpatialCell<T> {
  x: number;
  y: number;
  entities: T[];
}

export interface SpatialEntity {
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface SpatialGridStats {
  totalChecks: number;
  savedChecks: number;
  gridHits: number;
  gridMisses: number;
  efficiency: number;
  cellCount: number;
  avgEntitiesPerCell: number;
}
