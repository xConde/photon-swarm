import { Injectable } from '@angular/core';

/** Statistics for a single object pool */
export interface PoolStats {
  poolSize: number;
  maxSize: number;
  utilization: number;
}

/**
 * Generic object pool for reusing objects to reduce GC pressure
 */
export class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  private maxSize: number;

  constructor(createFn: () => T, resetFn: (obj: T) => void, maxSize: number = 100) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.maxSize = maxSize;
  }

  /**
   * Get an object from the pool or create a new one
   */
  get(): T {
    const pooled = this.pool.pop();
    if (pooled !== undefined) {
      return pooled;
    }
    return this.createFn();
  }

  /**
   * Return an object to the pool
   */
  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool.length = 0;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize,
      utilization: (this.maxSize - this.pool.length) / this.maxSize,
    };
  }
}

/**
 * Object Pool Manager Service
 */
@Injectable({
  providedIn: 'root',
})
export class ObjectPoolService {
  private pools = new Map<string, ObjectPool<unknown>>();

  /**
   * Create a new pool
   */
  createPool<T>(name: string, createFn: () => T, resetFn: (obj: T) => void, maxSize: number = 100): ObjectPool<T> {
    const pool = new ObjectPool<T>(createFn, resetFn, maxSize);
    this.pools.set(name, pool as ObjectPool<unknown>);
    return pool;
  }

  /**
   * Get an existing pool
   */
  getPool<T>(name: string): ObjectPool<T> | undefined {
    return this.pools.get(name) as ObjectPool<T> | undefined;
  }

  /**
   * Get object from pool
   */
  get<T>(poolName: string): T | undefined {
    const pool = this.pools.get(poolName) as ObjectPool<T> | undefined;
    return pool ? pool.get() : undefined;
  }

  /**
   * Release object to pool
   */
  release<T>(poolName: string, obj: T): void {
    const pool = this.pools.get(poolName) as ObjectPool<T> | undefined;
    if (pool) {
      pool.release(obj);
    }
  }

  /**
   * Clear all pools
   */
  clearAll(): void {
    this.pools.forEach((pool) => pool.clear());
  }

  /**
   * Get statistics for all pools
   */
  getAllStats(): Record<string, PoolStats> {
    const stats: Record<string, PoolStats> = {};
    this.pools.forEach((pool, name) => {
      stats[name] = pool.getStats();
    });
    return stats;
  }
}
