import { Injectable } from '@angular/core';
import { KingConfig, TerritoryChunk, TerritoryTile } from '../../models/territory.model';
import { DynamicTerritoryGeneratorService } from './dynamic-territory-generator.service';
import { TerritoryHashService } from '../../world/territory-hash.service';

/**
 * Territory Chunk Manager Service
 *
 * Manages chunk-based territory generation for performance optimization.
 * Only generates and loads chunks that are visible or needed.
 */
@Injectable({ providedIn: 'root' })
export class TerritoryChunkManagerService {
  private readonly CHUNK_SIZE = 32; // 32x32 tiles per chunk
  private readonly MAX_CACHED_CHUNKS = 1000; // Increased from 400 to prevent cache eviction

  private chunks = new Map<string, TerritoryChunk>();
  private chunkAccessOrder: string[] = [];
  private gridWidth: number = 0;
  private gridHeight: number = 0;

  // Cache statistics
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private totalAccesses: number = 0;
  private lastMetricsLogTime: number = 0;
  private readonly METRICS_LOG_INTERVAL_MS = 60000; // Log every 60 seconds

  constructor(
    private territoryGenerator: DynamicTerritoryGeneratorService,
    private hashService: TerritoryHashService
  ) {}

  /**
   * Initialize the chunk manager with world parameters
   */
  initialize(
    seed: string,
    kingConfigs: KingConfig[],
    gridWidth: number,
    gridHeight: number,
    preGeneratedGrid?: (TerritoryTile | null)[][]
  ): void {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;

    // Clear existing data and reset stats
    this.chunks.clear();
    this.chunkAccessOrder = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.totalAccesses = 0;
    this.lastMetricsLogTime = Date.now();

    // Use pre-generated grid if provided, otherwise keep existing
    if (preGeneratedGrid) {
      this.fullWorldGrid = preGeneratedGrid;
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory Chunk Manager: Using pre-generated grid', 'info', {
          source: 'territory_chunk_manager',
          operation: 'initialize_with_grid',
          gridProvided: true,
          gridSize: [gridWidth, gridHeight],
        });
      }
    } else if (!this.fullWorldGrid) {
      // Generate the world if not provided
      this.territoryGenerator.setSeed(seed);
      this.fullWorldGrid = this.territoryGenerator.generateTerritories(gridWidth, gridHeight, kingConfigs);
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory Chunk Manager: Generated world grid', 'info', {
          source: 'territory_chunk_manager',
          operation: 'initialize_without_grid',
          gridProvided: false,
        });
      }
    } else {
      // Keep existing fullWorldGrid
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory Chunk Manager: Keeping existing world grid', 'info', {
          source: 'territory_chunk_manager',
          operation: 'initialize_keep_existing',
          hasExistingGrid: true,
        });
      }
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Chunk Manager: Initialized', 'info', {
        seed,
        kingCount: kingConfigs.length,
        gridSize: [gridWidth, gridHeight],
        chunkSize: this.CHUNK_SIZE,
        totalChunks: this.getTotalChunkCount(),
        preGeneratedGrid: !!preGeneratedGrid,
      });
    }
  }

  /**
   * Get territory tile at specific coordinates, using chunk cache when appropriate
   */
  getTile(x: number, y: number): TerritoryTile | null {
    // Validate coordinates
    if (x < 0 || y < 0 || x >= this.gridWidth || y >= this.gridHeight) {
      return null;
    }

    // Direct access when we have full world grid (most common case)
    if (this.fullWorldGrid && this.fullWorldGrid[x] && this.fullWorldGrid[x][y]) {
      // Still count as cache hit since we're accessing pre-generated data
      this.cacheHits++;
      this.totalAccesses++;

      // Log cache performance metrics periodically
      this.logCacheMetricsIfNeeded();

      return this.fullWorldGrid[x][y];
    }

    // Fallback to chunk system (should rarely happen)
    const chunkX = Math.floor(x / this.CHUNK_SIZE);
    const chunkY = Math.floor(y / this.CHUNK_SIZE);
    const chunkKey = `${chunkX},${chunkY}`;

    const chunk = this.getOrGenerateChunk(chunkKey);
    if (!chunk || !chunk.tiles) {
      return null;
    }

    // Get tile within chunk
    const localX = x - chunkX * this.CHUNK_SIZE;
    const localY = y - chunkY * this.CHUNK_SIZE;

    return chunk.tiles[localX]?.[localY] || null;
  }

  /**
   * Get all tiles in a specific rectangular area
   */
  getTilesInRegion(startX: number, startY: number, width: number, height: number): (TerritoryTile | null)[][] {
    const result: (TerritoryTile | null)[][] = [];

    for (let x = startX; x < startX + width; x++) {
      result[x - startX] = [];
      for (let y = startY; y < startY + height; y++) {
        result[x - startX][y - startY] = this.getTile(x, y);
      }
    }

    return result;
  }

  /**
   * Preload chunks around a specific position (for camera following)
   */
  preloadChunksAroundPosition(centerX: number, centerY: number, radius: number = 2): void {
    // When we have full world grid, this is mainly for cache warming
    if (!this.fullWorldGrid) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('⚠️ Preload called without world grid', 'warning', {
          source: 'territory_chunk_manager',
          operation: 'preload_no_grid',
        });
      }
      return;
    }

    const centerChunkX = Math.floor(centerX / this.CHUNK_SIZE);
    const centerChunkY = Math.floor(centerY / this.CHUNK_SIZE);

    const chunksToLoad: string[] = [];
    const chunksAlreadyCached: string[] = [];
    let actualChunksGenerated = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const chunkX = centerChunkX + dx;
        const chunkY = centerChunkY + dy;

        if (this.isValidChunkCoordinate(chunkX, chunkY)) {
          const chunkKey = `${chunkX},${chunkY}`;
          if (!this.chunks.has(chunkKey)) {
            chunksToLoad.push(chunkKey);
            // Actually generate and cache the chunk
            const chunk = this.generateChunk(chunkX, chunkY);
            if (chunk && chunk.isGenerated) {
              this.chunks.set(chunkKey, chunk);
              this.updateAccessOrder(chunkKey);
              actualChunksGenerated++;
            }
          } else {
            chunksAlreadyCached.push(chunkKey);
            // Update access time for LRU
            const chunk = this.chunks.get(chunkKey);
            if (chunk) {
              chunk.lastAccessed = Date.now();
              this.updateAccessOrder(chunkKey);
            }
          }
        }
      }
    }

    // Clean up old chunks if needed
    if (this.chunks.size > this.MAX_CACHED_CHUNKS) {
      this.cleanupOldChunks();
    }

    // Log preloading activity with improved metrics
    if (window.debugLogBridge && actualChunksGenerated > 0) {
      const stats = this.getCacheStats();
      window.debugLogBridge.log('📦 Territory Chunk Preload', 'info', {
        source: 'territory_chunk_manager',
        operation: 'preload_chunks',
        centerTilePos: [centerX, centerY],
        centerChunk: [centerChunkX, centerChunkY],
        radius,
        chunksGenerated: actualChunksGenerated,
        chunksAlreadyCached: chunksAlreadyCached.length,
        totalCachedChunks: this.chunks.size,
        maxCachedChunks: this.MAX_CACHED_CHUNKS,
        cacheHitRate: (stats.cacheHitRate * 100).toFixed(2) + '%',
        cacheFillPercent: ((this.chunks.size / this.MAX_CACHED_CHUNKS) * 100).toFixed(1) + '%',
      });
    }
  }

  /**
   * Generate or retrieve a chunk
   */
  private getOrGenerateChunk(chunkKey: string): TerritoryChunk | null {
    this.totalAccesses++;

    // Check if chunk is already cached
    if (this.chunks.has(chunkKey)) {
      this.cacheHits++;
      const chunk = this.chunks.get(chunkKey);
      if (!chunk) {
        throw new Error(`Chunk ${chunkKey} should exist but was not found`);
      }
      chunk.lastAccessed = Date.now();
      this.updateAccessOrder(chunkKey);

      return chunk;
    }

    // Cache miss - but this is expected during initial load
    this.cacheMisses++;

    // Parse chunk coordinates
    const [chunkX, chunkY] = chunkKey.split(',').map(Number);
    if (!this.isValidChunkCoordinate(chunkX, chunkY)) {
      return null;
    }

    // Generate the chunk
    const chunk = this.generateChunk(chunkX, chunkY);

    // Cache the chunk
    this.chunks.set(chunkKey, chunk);
    this.chunkAccessOrder.push(chunkKey);

    // Cleanup old chunks if we exceed the limit
    this.cleanupOldChunks();

    return chunk;
  }

  // Store the complete generated world grid to avoid regenerating
  private fullWorldGrid: (TerritoryTile | null)[][] | null = null;

  /**
   * Generate a specific chunk using the pre-generated world
   */
  private generateChunk(chunkX: number, chunkY: number): TerritoryChunk {
    const startTime = window.performance.now();

    // CRITICAL: World must already be generated
    if (!this.fullWorldGrid) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('❌ Cannot generate chunk without pre-generated world grid', 'error', {
          source: 'territory_chunk_manager',
          operation: 'generate_chunk',
          chunkX,
          chunkY,
        });
      }
      // Return empty chunk to prevent crash
      return {
        chunkX,
        chunkY,
        chunkSize: this.CHUNK_SIZE,
        tiles: [],
        isGenerated: false,
        isVisible: false,
        lastAccessed: Date.now(),
        hash: 'empty',
      };
    }

    // Calculate world coordinates for this chunk
    const worldStartX = chunkX * this.CHUNK_SIZE;
    const worldStartY = chunkY * this.CHUNK_SIZE;
    const worldEndX = Math.min(worldStartX + this.CHUNK_SIZE, this.gridWidth);
    const worldEndY = Math.min(worldStartY + this.CHUNK_SIZE, this.gridHeight);

    const actualWidth = worldEndX - worldStartX;
    const actualHeight = worldEndY - worldStartY;

    // Extract the chunk's portion from the pre-generated world
    const chunkTiles: (TerritoryTile | null)[][] = [];
    for (let x = 0; x < actualWidth; x++) {
      chunkTiles[x] = [];
      for (let y = 0; y < actualHeight; y++) {
        const worldX = worldStartX + x;
        const worldY = worldStartY + y;
        chunkTiles[x][y] = this.fullWorldGrid[worldX]?.[worldY] || null;
      }
    }

    // Generate hash for this chunk
    const hash = this.hashService.generateTerritoryHash(chunkTiles);

    const generationTime = window.performance.now() - startTime;

    const chunk: TerritoryChunk = {
      chunkX,
      chunkY,
      chunkSize: this.CHUNK_SIZE,
      tiles: chunkTiles,
      isGenerated: true,
      isVisible: false, // Will be set by rendering system
      lastAccessed: Date.now(),
      hash,
    };

    if (window.debugLogBridge && generationTime > 5) {
      // Only log slow chunks
      window.debugLogBridge.log('Territory Chunk: Extracted', 'info', {
        chunkCoords: [chunkX, chunkY],
        worldCoords: [worldStartX, worldStartY, worldEndX, worldEndY],
        actualSize: [actualWidth, actualHeight],
        hash,
        extractionTime: `${generationTime.toFixed(2)}ms`,
      });
    }

    return chunk;
  }

  /**
   * Check if chunk coordinates are valid
   */
  private isValidChunkCoordinate(chunkX: number, chunkY: number): boolean {
    const maxChunkX = Math.ceil(this.gridWidth / this.CHUNK_SIZE);
    const maxChunkY = Math.ceil(this.gridHeight / this.CHUNK_SIZE);
    return chunkX >= 0 && chunkY >= 0 && chunkX < maxChunkX && chunkY < maxChunkY;
  }

  /**
   * Update chunk access order for LRU cleanup
   */
  private updateAccessOrder(chunkKey: string): void {
    const index = this.chunkAccessOrder.indexOf(chunkKey);
    if (index > -1) {
      this.chunkAccessOrder.splice(index, 1);
    }
    this.chunkAccessOrder.push(chunkKey);
  }

  /**
   * Clean up least recently used chunks
   */
  private cleanupOldChunks(): void {
    while (this.chunks.size > this.MAX_CACHED_CHUNKS && this.chunkAccessOrder.length > 0) {
      const oldestChunkKey = this.chunkAccessOrder.shift();
      if (oldestChunkKey) {
        this.chunks.delete(oldestChunkKey);
      }

      if (window.debugLogBridge) {
        window.debugLogBridge.log('Territory Chunk: Cleaned up', 'info', {
          chunkKey: oldestChunkKey,
          remainingChunks: this.chunks.size,
        });
      }
    }
  }

  /**
   * Get total number of chunks in the world
   */
  private getTotalChunkCount(): number {
    const chunksX = Math.ceil(this.gridWidth / this.CHUNK_SIZE);
    const chunksY = Math.ceil(this.gridHeight / this.CHUNK_SIZE);
    return chunksX * chunksY;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cachedChunks: number;
    totalChunks: number;
    cacheHitRate: number;
    memoryUsage: string;
  } {
    return {
      cachedChunks: this.chunks.size,
      totalChunks: this.getTotalChunkCount(),
      cacheHitRate: this.totalAccesses > 0 ? this.cacheHits / this.totalAccesses : 0,
      memoryUsage: `${((this.chunks.size * this.CHUNK_SIZE * this.CHUNK_SIZE * 8) / 1024).toFixed(1)}KB`,
    };
  }

  /**
   * Check if chunk manager has full world grid initialized
   */
  hasFullWorldGrid(): boolean {
    return this.fullWorldGrid !== null;
  }

  /**
   * Clear all cached chunks (for memory cleanup)
   */
  clearCache(): void {
    this.chunks.clear();
    this.chunkAccessOrder = [];

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Chunks: Cache cleared', 'info');
    }
  }

  /**
   * Log cache performance metrics periodically
   */
  private logCacheMetricsIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastMetricsLogTime < this.METRICS_LOG_INTERVAL_MS) {
      return;
    }

    this.lastMetricsLogTime = now;
    const stats = this.getCacheStats();

    if (window.debugLogBridge && this.totalAccesses > 0) {
      window.debugLogBridge.log('📊 Territory Cache Performance (60s)', 'info', {
        source: 'territory_chunk_manager',
        operation: 'cache_metrics',
        cacheHitRate: (stats.cacheHitRate * 100).toFixed(2) + '%',
        totalAccesses: this.totalAccesses,
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        cachedChunks: this.chunks.size,
        maxChunks: this.MAX_CACHED_CHUNKS,
        memoryUsage: stats.memoryUsage,
        hasFullWorldGrid: !!this.fullWorldGrid,
        performance: stats.cacheHitRate > 0.8 ? '✅ Good' : '⚠️ Needs improvement',
      });
    }
  }
}
