import { Injectable } from '@angular/core';
import { EntityManager } from '../../ecs/ecs.model';
import { PlayerControlledComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { FOUR_KINGS_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';

/**
 * Tile Visibility Service
 *
 * Ensures tiles are NEVER visible to the player during generation by:
 * 1. Pre-calculating visibility bounds with generous buffers
 * 2. Tracking tile generation state and readiness
 * 3. Predictively loading tiles based on velocity and direction
 * 4. Providing metrics and alerts for visibility violations
 *
 * This is the definitive solution to prevent tile pop-in.
 */
@Injectable({ providedIn: 'root' })
export class TileVisibilityService {
  // Visibility configuration
  private readonly TILE_SIZE = FOUR_KINGS_CONFIG.TILE_SIZE;
  private readonly WORLD_WIDTH = WORLD_CONFIG.BOUNDS.WIDTH;
  private readonly WORLD_HEIGHT = WORLD_CONFIG.BOUNDS.HEIGHT;

  // Reasonable buffer zones that prevent tile pop-in without rendering entire world
  private readonly MIN_RENDER_BUFFER = 15; // Minimum tiles beyond screen edge
  private readonly VELOCITY_BUFFER_FACTOR = 0.05; // Small extra tiles per unit of velocity
  private readonly DASH_BUFFER = 25; // Extra buffer for dash ability
  private readonly PREDICTION_TIME = 1.5; // Seconds to look ahead

  // Performance thresholds

  // Tracking state
  private visibilityViolations = 0;
  private totalVisibilityChecks = 0;
  private lastViolationTime = 0;
  private violationHistory: Array<{
    timestamp: number;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    missingTiles: number;
    context: string;
  }> = [];

  // Player state cache
  private lastPlayerVelocity: { x: number; y: number } = { x: 0, y: 0 };
  private playerMovementHistory: Array<{
    timestamp: number;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
  }> = [];

  // Preload zone cache
  private lastPreloadBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null = null;

  constructor() {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('TileVisibilityService: Initialized', 'info', {
        source: 'tile_visibility',
        minRenderBuffer: this.MIN_RENDER_BUFFER,
        velocityBufferFactor: this.VELOCITY_BUFFER_FACTOR,
        dashBuffer: this.DASH_BUFFER,
        predictionTime: this.PREDICTION_TIME,
      });
    }
  }

  /**
   * Calculate the required preload bounds for a given position and velocity
   */
  calculatePreloadBounds(
    position: { x: number; y: number },
    velocity: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number
  ): {
    centerTile: { x: number; y: number };
    radius: number;
    bounds: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    };
    metrics: {
      speed: number;
      predictedPosition: { x: number; y: number };
      bufferTiles: number;
      totalTilesRequired: number;
    };
  } {
    // Calculate current speed
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);

    // Calculate screen bounds in tiles
    const screenTilesX = Math.ceil(canvasWidth / this.TILE_SIZE);
    const screenTilesY = Math.ceil(canvasHeight / this.TILE_SIZE);

    // Calculate dynamic buffer based on velocity
    const velocityBuffer = Math.ceil(speed * this.VELOCITY_BUFFER_FACTOR);
    const totalBuffer = this.MIN_RENDER_BUFFER + velocityBuffer + this.DASH_BUFFER;

    // Predict future position
    const predictedX = position.x + velocity.x * this.PREDICTION_TIME;
    const predictedY = position.y + velocity.y * this.PREDICTION_TIME;

    // Calculate center tile (use predicted position for forward loading)
    const centerTileX = Math.floor(predictedX / this.TILE_SIZE);
    const centerTileY = Math.floor(predictedY / this.TILE_SIZE);

    // Calculate required radius (includes screen size + all buffers)
    const radiusX = Math.ceil(screenTilesX / 2) + totalBuffer;
    const radiusY = Math.ceil(screenTilesY / 2) + totalBuffer;
    const radius = Math.max(radiusX, radiusY);

    // Calculate bounds
    const bounds = {
      minX: Math.max(0, centerTileX - radius),
      minY: Math.max(0, centerTileY - radius),
      maxX: Math.min(Math.floor(this.WORLD_WIDTH / this.TILE_SIZE), centerTileX + radius),
      maxY: Math.min(Math.floor(this.WORLD_HEIGHT / this.TILE_SIZE), centerTileY + radius),
    };

    // Calculate metrics
    const totalTilesRequired = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);

    return {
      centerTile: { x: centerTileX, y: centerTileY },
      radius,
      bounds,
      metrics: {
        speed,
        predictedPosition: { x: predictedX, y: predictedY },
        bufferTiles: totalBuffer,
        totalTilesRequired,
      },
    };
  }

  /**
   * Validate that all tiles in the visible area are loaded
   */
  validateVisibleTilesLoaded(
    position: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number,
    tileChecker: (x: number, y: number) => boolean
  ): {
    allLoaded: boolean;
    missingTiles: Array<{ x: number; y: number }>;
    coverage: number;
  } {
    this.totalVisibilityChecks++;

    // Calculate visible bounds (what the player can see)
    const visibleMinX = Math.floor((position.x - canvasWidth / 2) / this.TILE_SIZE);
    const visibleMaxX = Math.ceil((position.x + canvasWidth / 2) / this.TILE_SIZE);
    const visibleMinY = Math.floor((position.y - canvasHeight / 2) / this.TILE_SIZE);
    const visibleMaxY = Math.ceil((position.y + canvasHeight / 2) / this.TILE_SIZE);

    const missingTiles: Array<{ x: number; y: number }> = [];
    let loadedCount = 0;
    let totalCount = 0;

    for (let x = visibleMinX; x <= visibleMaxX; x++) {
      for (let y = visibleMinY; y <= visibleMaxY; y++) {
        // Skip out-of-bounds tiles
        if (x < 0 || y < 0 || x >= this.WORLD_WIDTH / this.TILE_SIZE || y >= this.WORLD_HEIGHT / this.TILE_SIZE) {
          continue;
        }

        totalCount++;

        if (tileChecker(x, y)) {
          loadedCount++;
        } else {
          missingTiles.push({ x, y });
        }
      }
    }

    const allLoaded = missingTiles.length === 0;
    const coverage = totalCount > 0 ? loadedCount / totalCount : 1;

    // Record violation if tiles are missing
    if (!allLoaded) {
      this.recordVisibilityViolation(position, this.lastPlayerVelocity, missingTiles.length, 'visible_tiles_missing');
    }

    return {
      allLoaded,
      missingTiles,
      coverage,
    };
  }

  /**
   * Update player tracking and movement history
   */
  updatePlayerTracking(entityManager: EntityManager): {
    position: { x: number; y: number } | null;
    velocity: { x: number; y: number };
    hasPlayer: boolean;
  } {
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);

    if (playerEntities.length === 0) {
      return {
        position: null,
        velocity: { x: 0, y: 0 },
        hasPlayer: false,
      };
    }

    const playerEntity = playerEntities[0];
    const position = entityManager.getComponent(playerEntity, PositionComponent);
    const velocity = entityManager.getComponent(playerEntity, VelocityComponent) || { vx: 0, vy: 0 };

    if (!position) {
      return {
        position: null,
        velocity: { x: 0, y: 0 },
        hasPlayer: false,
      };
    }

    const playerPos = { x: position.x, y: position.y };
    const playerVel = { x: velocity.vx, y: velocity.vy };

    // Update tracking
    this.lastPlayerVelocity = playerVel;

    // Add to movement history
    const now = Date.now();
    this.playerMovementHistory.push({
      timestamp: now,
      position: { ...playerPos },
      velocity: { ...playerVel },
    });

    // Keep only last 5 seconds of history
    const cutoffTime = now - 5000;
    this.playerMovementHistory = this.playerMovementHistory.filter((h) => h.timestamp > cutoffTime);

    return {
      position: playerPos,
      velocity: playerVel,
      hasPlayer: true,
    };
  }

  /**
   * Check if preload bounds have changed significantly
   */
  shouldUpdatePreload(newBounds: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
    if (!this.lastPreloadBounds) {
      this.lastPreloadBounds = { ...newBounds };
      return true;
    }

    // Check if bounds have changed by more than 10% or 5 tiles
    const threshold = 5;
    const changed =
      Math.abs(newBounds.minX - this.lastPreloadBounds.minX) > threshold ||
      Math.abs(newBounds.minY - this.lastPreloadBounds.minY) > threshold ||
      Math.abs(newBounds.maxX - this.lastPreloadBounds.maxX) > threshold ||
      Math.abs(newBounds.maxY - this.lastPreloadBounds.maxY) > threshold;

    if (changed) {
      this.lastPreloadBounds = { ...newBounds };
    }

    return changed;
  }

  /**
   * Record a visibility violation
   */
  private recordVisibilityViolation(
    position: { x: number; y: number },
    velocity: { x: number; y: number },
    missingTiles: number,
    context: string
  ): void {
    this.visibilityViolations++;
    this.lastViolationTime = Date.now();

    const violation = {
      timestamp: this.lastViolationTime,
      position: { ...position },
      velocity: { ...velocity },
      missingTiles,
      context,
    };

    this.violationHistory.push(violation);

    // Keep only last 100 violations
    if (this.violationHistory.length > 100) {
      this.violationHistory.shift();
    }

    // Log violation
    if (window.debugLogBridge) {
      window.debugLogBridge.log('⚠️ TILE VISIBILITY VIOLATION!', 'error', {
        source: 'tile_visibility',
        violation,
        totalViolations: this.visibilityViolations,
        violationRate: ((this.visibilityViolations / this.totalVisibilityChecks) * 100).toFixed(2) + '%',
      });
    }
  }

  /**
   * Get visibility metrics
   */
  getMetrics(): {
    violations: number;
    totalChecks: number;
    violationRate: number;
    lastViolationTime: number;
    recentViolations: number;
    averageSpeed: number;
    maxSpeed: number;
    recommendation: string;
  } {
    const now = Date.now();
    const recentCutoff = now - 60000; // Last minute
    const recentViolations = this.violationHistory.filter((v) => v.timestamp > recentCutoff).length;

    // Calculate average and max speed from history
    let totalSpeed = 0;
    let maxSpeed = 0;

    for (const entry of this.playerMovementHistory) {
      const speed = Math.sqrt(entry.velocity.x ** 2 + entry.velocity.y ** 2);
      totalSpeed += speed;
      maxSpeed = Math.max(maxSpeed, speed);
    }

    const averageSpeed = this.playerMovementHistory.length > 0 ? totalSpeed / this.playerMovementHistory.length : 0;

    // Generate recommendation
    let recommendation = 'System operating normally';

    if (this.visibilityViolations > 0) {
      if (recentViolations > 10) {
        recommendation = 'CRITICAL: Frequent visibility violations! Increase render buffer or optimize chunk loading.';
      } else if (recentViolations > 5) {
        recommendation = 'WARNING: Recent visibility violations detected. Monitor system performance.';
      } else if (maxSpeed > 800) {
        recommendation = 'High-speed movement detected. Consider increasing velocity buffer factor.';
      } else {
        recommendation = 'Minor violations detected. System may need tuning.';
      }
    }

    return {
      violations: this.visibilityViolations,
      totalChecks: this.totalVisibilityChecks,
      violationRate: this.totalVisibilityChecks > 0 ? this.visibilityViolations / this.totalVisibilityChecks : 0,
      lastViolationTime: this.lastViolationTime,
      recentViolations,
      averageSpeed,
      maxSpeed,
      recommendation,
    };
  }

  /**
   * Calculate optimal chunk preload strategy
   */
  calculateOptimalPreloadStrategy(
    position: { x: number; y: number },
    velocity: { x: number; y: number },
    currentChunkCount: number,
    maxChunkCount: number
  ): {
    strategy: 'aggressive' | 'normal' | 'conservative';
    priorityZones: Array<{
      centerX: number;
      centerY: number;
      radius: number;
      priority: number;
    }>;
    recommendedChunkIncrease: number;
  } {
    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
    const chunkUsageRatio = currentChunkCount / maxChunkCount;

    // Determine strategy based on speed and chunk usage
    let strategy: 'aggressive' | 'normal' | 'conservative';

    if (speed > 600 || chunkUsageRatio < 0.5) {
      strategy = 'aggressive';
    } else if (speed > 300 || chunkUsageRatio < 0.7) {
      strategy = 'normal';
    } else {
      strategy = 'conservative';
    }

    // Calculate priority zones
    const priorityZones: Array<{
      centerX: number;
      centerY: number;
      radius: number;
      priority: number;
    }> = [];

    // Current position (highest priority)
    const currentTileX = Math.floor(position.x / this.TILE_SIZE);
    const currentTileY = Math.floor(position.y / this.TILE_SIZE);

    priorityZones.push({
      centerX: currentTileX,
      centerY: currentTileY,
      radius: 20,
      priority: 1,
    });

    // Predicted positions based on velocity
    if (speed > 0) {
      // Near future (0.5 seconds)
      const near = {
        x: Math.floor((position.x + velocity.x * 0.5) / this.TILE_SIZE),
        y: Math.floor((position.y + velocity.y * 0.5) / this.TILE_SIZE),
      };

      priorityZones.push({
        centerX: near.x,
        centerY: near.y,
        radius: 15,
        priority: 2,
      });

      // Far future (1.5 seconds)
      const far = {
        x: Math.floor((position.x + velocity.x * 1.5) / this.TILE_SIZE),
        y: Math.floor((position.y + velocity.y * 1.5) / this.TILE_SIZE),
      };

      priorityZones.push({
        centerX: far.x,
        centerY: far.y,
        radius: 10,
        priority: 3,
      });
    }

    // Recommend chunk increase if needed
    let recommendedChunkIncrease = 0;

    if (strategy === 'aggressive' && chunkUsageRatio > 0.8) {
      recommendedChunkIncrease = Math.ceil(maxChunkCount * 0.5); // 50% increase
    } else if (strategy === 'normal' && chunkUsageRatio > 0.9) {
      recommendedChunkIncrease = Math.ceil(maxChunkCount * 0.25); // 25% increase
    }

    return {
      strategy,
      priorityZones,
      recommendedChunkIncrease,
    };
  }

  /**
   * Reset metrics (for testing or new game)
   */
  resetMetrics(): void {
    this.visibilityViolations = 0;
    this.totalVisibilityChecks = 0;
    this.lastViolationTime = 0;
    this.violationHistory = [];
    this.playerMovementHistory = [];
    this.lastPlayerVelocity = { x: 0, y: 0 };
    this.lastPreloadBounds = null;

    if (window.debugLogBridge) {
      window.debugLogBridge.log('TileVisibilityService: Metrics reset', 'info');
    }
  }
}
