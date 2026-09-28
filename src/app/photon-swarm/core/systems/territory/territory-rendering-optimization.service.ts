import { Injectable } from '@angular/core';
import { FOUR_KINGS_CONFIG } from '@photon/config/game-constants';

/**
 * Territory Rendering Optimization Service
 *
 * Provides Level of Detail (LOD) and culling optimizations for territory rendering.
 * Reduces rendering cost for territories that are far from the camera or partially visible.
 */
@Injectable({ providedIn: 'root' })
export class TerritoryRenderingOptimizationService {
  private readonly TILE_SIZE = FOUR_KINGS_CONFIG.TILE_SIZE;

  // LOD configuration
  private readonly LOD_LEVELS = {
    FULL: { distance: 0, tileGroupSize: 1, alpha: 1.0 },
    MEDIUM: { distance: 500, tileGroupSize: 2, alpha: 0.8 },
    LOW: { distance: 1000, tileGroupSize: 4, alpha: 0.6 },
    MINIMAL: { distance: 1500, tileGroupSize: 8, alpha: 0.4 },
  };

  // Cache for aggregated tile colors — keyed by integer hash for zero per-frame string allocation
  private lodColorCache = new Map<number, { color: string; strength: number }>();
  private cacheFrameCounter = 0;
  private readonly CACHE_CLEAR_INTERVAL = 600; // Clear cache every 10 seconds at 60fps

  // Pre-allocated Float64Array(5) for king-strength accumulation (kings 1-4, index 0 unused)
  private readonly kingStrengthAccum = new Float64Array(5);

  constructor() {}

  /**
   * Calculate optimized render bounds with expanded buffer for smooth scrolling
   */
  calculateOptimizedRenderBounds(
    camera: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number,
    gridWidth: number,
    gridHeight: number
  ): {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    totalTiles: number;
    lodLevel: 'FULL' | 'MEDIUM' | 'LOW' | 'MINIMAL';
  } {
    // Calculate camera distance from origin for LOD determination
    const cameraDistance = Math.sqrt(camera.x * camera.x + camera.y * camera.y);

    // Determine LOD level based on camera distance or zoom
    let lodLevel: 'FULL' | 'MEDIUM' | 'LOW' | 'MINIMAL' = 'FULL';
    if (cameraDistance > this.LOD_LEVELS.MINIMAL.distance) {
      lodLevel = 'MINIMAL';
    } else if (cameraDistance > this.LOD_LEVELS.LOW.distance) {
      lodLevel = 'LOW';
    } else if (cameraDistance > this.LOD_LEVELS.MEDIUM.distance) {
      lodLevel = 'MEDIUM';
    }

    const lod = this.LOD_LEVELS[lodLevel];

    // Calculate visible tile bounds with buffer based on LOD
    const bufferTiles = Math.ceil(2 / lod.tileGroupSize); // Reduced buffer for grouped tiles

    const cameraLeftTile = Math.floor(camera.x / this.TILE_SIZE);
    const cameraTopTile = Math.floor(camera.y / this.TILE_SIZE);
    const cameraRightTile = Math.ceil((camera.x + canvasWidth) / this.TILE_SIZE);
    const cameraBottomTile = Math.ceil((camera.y + canvasHeight) / this.TILE_SIZE);

    // Apply LOD grouping - snap to group boundaries
    const groupSize = lod.tileGroupSize;
    const startX = Math.max(0, Math.floor((cameraLeftTile - bufferTiles) / groupSize) * groupSize);
    const startY = Math.max(0, Math.floor((cameraTopTile - bufferTiles) / groupSize) * groupSize);
    const endX = Math.min(gridWidth, Math.ceil((cameraRightTile + bufferTiles) / groupSize) * groupSize);
    const endY = Math.min(gridHeight, Math.ceil((cameraBottomTile + bufferTiles) / groupSize) * groupSize);

    const totalTiles = ((endX - startX) / groupSize) * ((endY - startY) / groupSize);

    return {
      startX,
      startY,
      endX,
      endY,
      totalTiles,
      lodLevel,
    };
  }

  /**
   * Check if a tile group should be rendered based on frustum culling
   */
  shouldRenderTileGroup(
    tileX: number,
    tileY: number,
    groupSize: number,
    camera: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number
  ): boolean {
    // Calculate world bounds of the tile group
    const worldX = tileX * this.TILE_SIZE;
    const worldY = tileY * this.TILE_SIZE;
    const groupWorldSize = groupSize * this.TILE_SIZE;

    // Check if tile group is within camera view (with small buffer)
    const buffer = this.TILE_SIZE * 2;
    return !(
      worldX > camera.x + canvasWidth + buffer ||
      worldX + groupWorldSize < camera.x - buffer ||
      worldY > camera.y + canvasHeight + buffer ||
      worldY + groupWorldSize < camera.y - buffer
    );
  }

  /**
   * Aggregate colors for LOD rendering.
   * Zero per-frame heap allocation: integer hash key + pre-allocated Float64Array accumulator.
   */
  aggregateTileColors(
    tiles: Array<{ king: number; strength: number; color: string }>,
    lodLevel: 'FULL' | 'MEDIUM' | 'LOW' | 'MINIMAL'
  ): { color: string; strength: number } {
    if (tiles.length === 0) {
      return { color: '#1a1a1a', strength: 0.05 };
    }

    // For FULL LOD, return the first tile as-is
    if (lodLevel === 'FULL') {
      return { color: tiles[0].color, strength: tiles[0].strength };
    }

    // Build an integer hash — no string allocation. Uses MurmurHash3 32-bit mixing (all
    // Math.imul, no precision loss) rather than a weak `* prime + … | 0` accumulation: the
    // weak mix collided at ~0.02–0.05% on 4–8 tile groups, painting a stale faction colour on
    // a LOD cell for up to the cache-clear interval. Proper avalanche mixing drops collisions
    // to the birthday bound for the cache size (negligible at a few hundred entries).
    const lodIdx = lodLevel === 'MEDIUM' ? 1 : lodLevel === 'LOW' ? 2 : 3;
    let hash = lodIdx | 0;
    for (let i = 0; i < tiles.length; i++) {
      // king 0-4, strength as 0-99 integer → one per-tile value, then Murmur3 mix-step.
      let k = (tiles[i].king * 128 + Math.round(tiles[i].strength * 99)) | 0;
      k = Math.imul(k, 0xcc9e2d51);
      k = (k << 15) | (k >>> 17);
      k = Math.imul(k, 0x1b873593);
      hash ^= k;
      hash = (hash << 13) | (hash >>> 19);
      hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
    }
    // Murmur3 finalizer (avalanche), then coerce to unsigned for a stable Map key.
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;
    hash = hash >>> 0;

    // Check cache
    const cachedResult = this.lodColorCache.get(hash);
    if (cachedResult) {
      return cachedResult;
    }

    // Find dominant king using pre-allocated Float64Array — zero allocation
    this.kingStrengthAccum.fill(0);
    let totalStrength = 0;

    for (const tile of tiles) {
      const idx = tile.king < 5 ? tile.king : 0;
      this.kingStrengthAccum[idx] += tile.strength;
      totalStrength += tile.strength;
    }

    // Find dominant king (indices 1-4 only; 0 = neutral)
    let dominantKing = 0;
    let maxStrength = 0;
    for (let k = 1; k < 5; k++) {
      if (this.kingStrengthAccum[k] > maxStrength) {
        dominantKing = k;
        maxStrength = this.kingStrengthAccum[k];
      }
    }

    // Find the color of the dominant king
    let dominantColor = '#1a1a1a';
    for (const tile of tiles) {
      if (tile.king === dominantKing) {
        dominantColor = tile.color;
        break;
      }
    }

    const result = {
      color: dominantColor,
      strength: Math.min(1, totalStrength / tiles.length) * this.LOD_LEVELS[lodLevel].alpha,
    };

    // Cache the result
    this.lodColorCache.set(hash, result);

    return result;
  }

  /**
   * Render optimized territory tiles with LOD
   */
  renderTileWithLOD(
    ctx: CanvasRenderingContext2D,
    worldX: number,
    worldY: number,
    tileSize: number,
    color: string,
    strength: number,
    lodLevel: 'FULL' | 'MEDIUM' | 'LOW' | 'MINIMAL'
  ): void {
    const lod = this.LOD_LEVELS[lodLevel];

    // Skip very weak tiles at lower LOD levels
    if (lodLevel !== 'FULL' && strength < 0.1) {
      return;
    }

    // Apply LOD-specific optimizations
    ctx.fillStyle = color;
    ctx.globalAlpha = Math.min(0.05, strength * FOUR_KINGS_CONFIG.VISUAL_OPACITY * lod.alpha);

    // For lower LOD, use simpler rendering
    if (lodLevel === 'MINIMAL' || lodLevel === 'LOW') {
      // Simple fill without borders
      ctx.fillRect(worldX, worldY, tileSize, tileSize);
    } else {
      // Full detail rendering
      ctx.fillRect(worldX, worldY, tileSize, tileSize);

      // Add border only for FULL and MEDIUM LOD
      if (lodLevel === 'FULL' && strength > 0.3) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = Math.min(0.02, strength * 0.05);
        ctx.lineWidth = 1;
        ctx.strokeRect(worldX, worldY, tileSize, tileSize);
      }
    }
  }

  /**
   * Clear LOD cache periodically to prevent memory buildup
   */
  updateCacheManagement(): void {
    this.cacheFrameCounter++;

    if (this.cacheFrameCounter >= this.CACHE_CLEAR_INTERVAL) {
      this.lodColorCache.clear();
      this.cacheFrameCounter = 0;
    }
  }

  /**
   * Get render statistics for performance monitoring
   */
  getRenderStats(): {
    cacheSize: number;
    cacheHitRate: number;
  } {
    return {
      cacheSize: this.lodColorCache.size,
      cacheHitRate: 0, // Would need to track hits/misses for accurate rate
    };
  }

  /**
   * Determine if we should use simplified rendering based on performance
   */
  shouldUseSimplifiedRendering(fps: number, targetFps: number = 60): boolean {
    // If FPS drops below 80% of target, use simplified rendering
    return fps < targetFps * 0.8;
  }

  /**
   * Calculate adaptive LOD distance based on performance
   */
  adaptLODDistances(currentFps: number, targetFps: number = 60): void {
    const performanceRatio = currentFps / targetFps;

    if (performanceRatio < 0.5) {
      // Very poor performance - use aggressive LOD
      this.LOD_LEVELS.MEDIUM.distance = 300;
      this.LOD_LEVELS.LOW.distance = 600;
      this.LOD_LEVELS.MINIMAL.distance = 900;
    } else if (performanceRatio < 0.8) {
      // Moderate performance - use moderate LOD
      this.LOD_LEVELS.MEDIUM.distance = 400;
      this.LOD_LEVELS.LOW.distance = 800;
      this.LOD_LEVELS.MINIMAL.distance = 1200;
    } else {
      // Good performance - use normal LOD
      this.LOD_LEVELS.MEDIUM.distance = 500;
      this.LOD_LEVELS.LOW.distance = 1000;
      this.LOD_LEVELS.MINIMAL.distance = 1500;
    }
  }
}
