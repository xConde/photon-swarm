import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { FourKingsTerritoryService } from '../territory';
import { TerritoryTile } from '../../models/territory.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { MathUtilsService } from '../../utils/math-utils.service';

export interface TileStrengthChange {
  gridX: number;
  gridY: number;
  oldStrength: number;
  newStrength: number;
  reason: string;
  timestamp: number;
}

export interface TerritoryStrengthSnapshot {
  tileStrengths: Map<string, number>; // key: "x,y", value: strength
  lastUpdate: number;
}

export interface TileNeighbors {
  north?: { gridX: number; gridY: number; strength: number; kingId?: number };
  south?: { gridX: number; gridY: number; strength: number; kingId?: number };
  east?: { gridX: number; gridY: number; strength: number; kingId?: number };
  west?: { gridX: number; gridY: number; strength: number; kingId?: number };
}

/**
 * Territory Strength System Service
 *
 * Manages the strength values of territory tiles, enabling dynamic territory expansion.
 * Strength ranges from 10-100, where:
 * - 100: Base tiles (unbreakable)
 * - 75: Normal starting strength
 * - 30: Weak threshold (can be captured)
 * - 10: Minimum strength
 */
@Injectable({
  providedIn: 'root',
})
export class TerritoryStrengthSystemService implements OnDestroy {
  // Constants
  private readonly BASE_STRENGTH = 100;
  private readonly INITIAL_STRENGTH = 75;
  private readonly WEAK_THRESHOLD = 30;
  private readonly MIN_STRENGTH = 10;
  private readonly STRENGTH_REGEN_RATE = 1; // per 30 seconds
  private readonly KILL_IMPACT_STRENGTH = 10; // reduced per kill
  private readonly IMPACT_RADIUS = 100; // pixels
  private readonly MAX_INIT_RETRIES = 50; // Max 5 seconds of retries

  // Tile strength tracking
  private tileStrengths = new Map<string, number>(); // "gridX,gridY" -> strength
  private baseTiles = new Set<string>(); // Base tiles that can't be weakened
  private strengthHistory: TileStrengthChange[] = [];
  private readonly MAX_HISTORY_SIZE = 1000; // Prevent unbounded growth

  // Observable for UI updates
  private strengthChangesSubject = new BehaviorSubject<TileStrengthChange[]>([]);
  public strengthChanges$ = this.strengthChangesSubject.asObservable();

  /**
   * Add changes to history with size limit
   */
  private addToHistory(...changes: TileStrengthChange[]): void {
    this.strengthHistory.push(...changes);
    // Cap history size to prevent unbounded memory growth
    if (this.strengthHistory.length > this.MAX_HISTORY_SIZE) {
      this.strengthHistory.splice(0, this.strengthHistory.length - this.MAX_HISTORY_SIZE);
    }
  }

  // Regeneration timer
  private regenInterval: number | null = null;
  private readonly REGEN_BATCH_SIZE = 500; // Max tiles processed per regen tick
  private regenBatchCursor = 0; // Index into tileStrengths keys for batched iteration
  private regenKeys: string[] = []; // Cached key list, rebuilt each full pass

  // Track initialization state
  private isInitialized = false;
  private initializationRetryTimer: number | null = null;
  private initRetryCount = 0;

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private debugLog: DebugLogBridgeService,
    private ngZone: NgZone
  ) {
    this.activateSession();
  }

  /** Start this reusable root service for the active routed game session. */
  activateSession(): void {
    if (this.isInitialized) {
      if (this.regenInterval === null) this.startRegeneration();
      return;
    }
    if (this.initializationRetryTimer !== null) return;
    this.initRetryCount = 0;
    this.attemptInitialization();
  }

  /**
   * Attempt to initialize, retry if territory system not ready
   */
  private attemptInitialization(): void {
    if (this.isInitialized) return;

    if (!this.fourKingsTerritory.getIsInitialized()) {
      // Retry with limit
      if (this.initRetryCount < this.MAX_INIT_RETRIES && this.initializationRetryTimer === null) {
        this.initRetryCount++;
        this.ngZone.runOutsideAngular(() => {
          this.initializationRetryTimer = window.setTimeout(() => {
            this.initializationRetryTimer = null;
            this.attemptInitialization();
          }, 100);
        });
      } else if (this.initRetryCount >= this.MAX_INIT_RETRIES) {
        this.debugLog.log('Territory Strength System failed to initialize - territory not ready', 'warning', {
          retries: this.initRetryCount,
        });
      }
      return;
    }

    this.initializeTileStrengths();
  }

  /**
   * Initialize all tile strengths to default values
   */
  private initializeTileStrengths(): void {
    const worldData = this.fourKingsTerritory.getWorldData();
    if (!worldData || !worldData.territories) {
      return;
    }

    // Clear existing data
    this.tileStrengths.clear();
    this.baseTiles.clear();

    // Initialize all tiles
    for (let gridY = 0; gridY < worldData.territories.length; gridY++) {
      const row = worldData.territories[gridY];
      if (!row) continue;

      for (let gridX = 0; gridX < row.length; gridX++) {
        const tile = row[gridX];
        if (!tile || tile.kingId === 0) continue; // Skip neutral tiles

        const key = this.getTileKey(gridX, gridY);

        // Check if this is a base tile (near faction starting position)
        const isBase = this.isBaseTile(tile, worldData);

        if (isBase) {
          this.tileStrengths.set(key, this.BASE_STRENGTH);
          this.baseTiles.add(key);
        } else {
          // Tile strength is already 0-100 in the model now
          // Use the tile's strength if valid, otherwise use default
          let initialStrength = this.INITIAL_STRENGTH;
          if (typeof tile.strength === 'number' && tile.strength >= 0 && tile.strength <= 100) {
            initialStrength = tile.strength;
          }
          this.tileStrengths.set(key, initialStrength);
        }
      }
    }

    // Start regeneration timer
    this.startRegeneration();

    // Mark as initialized
    this.isInitialized = true;

    this.debugLog.log('Territory Strength System Initialized', 'info', {
      totalTiles: this.tileStrengths.size,
      baseTiles: this.baseTiles.size,
      averageStrength: this.getAverageStrength(),
    });
  }

  /**
   * Check if a tile is a base tile (near faction starting position)
   */
  private isBaseTile(
    tile: TerritoryTile,
    worldData: { kingStartPositions?: Array<{ kingId: number; x: number; y: number }> }
  ): boolean {
    if (!worldData.kingStartPositions) return false;

    const startPos = worldData.kingStartPositions.find((pos) => pos.kingId === tile.kingId);
    if (!startPos) return false;

    // Base tiles are within 3 tiles of starting position
    const distance = MathUtilsService.distance(startPos.x, startPos.y, tile.x, tile.y);

    return distance <= 3;
  }

  /**
   * Get tile key for map storage
   */
  private getTileKey(gridX: number, gridY: number): string {
    return `${gridX},${gridY}`;
  }

  /**
   * Get strength of a specific tile
   */
  getTileStrength(gridX: number, gridY: number): number {
    const key = this.getTileKey(gridX, gridY);
    return this.tileStrengths.get(key) || 0;
  }

  /**
   * Weaken tiles around a kill location
   */
  weakenTilesFromKill(worldX: number, worldY: number): void {
    // Skip if not initialized yet
    if (!this.isInitialized) {
      this.attemptInitialization();
      return;
    }

    // Convert world position to grid position
    const gridPos = this.fourKingsTerritory.worldToGrid(worldX, worldY);
    if (!gridPos) return;

    // Calculate grid radius from pixel radius
    const tileSize = this.fourKingsTerritory.getTileSize();
    const gridRadius = Math.ceil(this.IMPACT_RADIUS / tileSize);

    const changes: TileStrengthChange[] = [];

    // Affect tiles in radius
    for (let dy = -gridRadius; dy <= gridRadius; dy++) {
      for (let dx = -gridRadius; dx <= gridRadius; dx++) {
        const targetX = gridPos.gridX + dx;
        const targetY = gridPos.gridY + dy;

        // Check distance (already in grid units, not pixels)
        const distance = MathUtilsService.distance(0, 0, dx, dy);
        if (distance > gridRadius) continue;

        const key = this.getTileKey(targetX, targetY);

        // Skip base tiles
        if (this.baseTiles.has(key)) continue;

        const currentStrength = this.tileStrengths.get(key);
        if (currentStrength === undefined) continue;

        // Calculate strength reduction based on distance (use grid distance)
        const distanceFactor = 1 - distance / gridRadius;
        const reduction = Math.floor(this.KILL_IMPACT_STRENGTH * distanceFactor);

        const newStrength = Math.max(this.MIN_STRENGTH, currentStrength - reduction);

        if (newStrength !== currentStrength) {
          this.tileStrengths.set(key, newStrength);

          changes.push({
            gridX: targetX,
            gridY: targetY,
            oldStrength: currentStrength,
            newStrength,
            reason: 'kill_impact',
            timestamp: Date.now(),
          });
        }
      }
    }

    if (changes.length > 0) {
      this.addToHistory(...changes);
      this.strengthChangesSubject.next(changes);

      this.debugLog.log('Territory weakened from kill', 'info', {
        killPosition: { worldX, worldY },
        tilesAffected: changes.length,
        averageReduction: changes.reduce((sum, c) => sum + (c.oldStrength - c.newStrength), 0) / changes.length,
      });
    }
  }

  /**
   * Regenerate tile strength over time
   */
  private startRegeneration(): void {
    if (this.regenInterval !== null) {
      window.clearInterval(this.regenInterval);
    }

    // Regenerate every 30 seconds
    this.ngZone.runOutsideAngular(() => {
      this.regenInterval = window.setInterval(() => {
        this.regenerateStrength();
      }, 30000);
    });
  }

  /**
   * Regenerate strength for a batch of tiles.
   * Processes REGEN_BATCH_SIZE tiles per call to avoid 200-500ms spikes when
   * the full map contains 2500+ tiles. The cursor advances each tick; once it
   * reaches the end the key list is rebuilt for the next full pass.
   */
  private regenerateStrength(): void {
    // Rebuild key list at the start of each full pass
    if (this.regenBatchCursor === 0 || this.regenBatchCursor >= this.regenKeys.length) {
      this.regenKeys = Array.from(this.tileStrengths.keys());
      this.regenBatchCursor = 0;
    }

    const end = Math.min(this.regenBatchCursor + this.REGEN_BATCH_SIZE, this.regenKeys.length);
    const changes: TileStrengthChange[] = [];
    const now = Date.now();

    for (let i = this.regenBatchCursor; i < end; i++) {
      const key = this.regenKeys[i];
      const strength = this.tileStrengths.get(key);
      if (strength === undefined) continue;

      // Skip base tiles (already at max)
      if (this.baseTiles.has(key)) continue;

      // Don't regenerate if already at initial strength
      if (strength >= this.INITIAL_STRENGTH) continue;

      const newStrength = Math.min(this.INITIAL_STRENGTH, strength + this.STRENGTH_REGEN_RATE);

      if (newStrength !== strength) {
        this.tileStrengths.set(key, newStrength);

        const commaIdx = key.indexOf(',');
        const gridX = Number(key.slice(0, commaIdx));
        const gridY = Number(key.slice(commaIdx + 1));
        changes.push({ gridX, gridY, oldStrength: strength, newStrength, reason: 'regeneration', timestamp: now });
      }
    }

    this.regenBatchCursor = end;

    if (changes.length > 0) {
      this.addToHistory(...changes);
      this.strengthChangesSubject.next(changes);

      this.debugLog.log('Territory strength regenerated', 'info', {
        tilesRegenerated: changes.length,
        batchProgress: `${end}/${this.regenKeys.length}`,
        averageIncrease: this.STRENGTH_REGEN_RATE,
      });
    }
  }

  /**
   * Check if system is initialized and ready
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get tiles below weak threshold (can be captured)
   */
  getWeakTiles(): Array<{ gridX: number; gridY: number; strength: number }> {
    const weakTiles: Array<{ gridX: number; gridY: number; strength: number }> = [];

    this.tileStrengths.forEach((strength, key) => {
      if (strength <= this.WEAK_THRESHOLD && !this.baseTiles.has(key)) {
        const [gridX, gridY] = key.split(',').map(Number);
        weakTiles.push({ gridX, gridY, strength });
      }
    });

    return weakTiles;
  }

  /**
   * Get average strength across all tiles
   */
  private getAverageStrength(): number {
    if (this.tileStrengths.size === 0) return 0;

    let total = 0;
    this.tileStrengths.forEach((strength) => {
      total += strength;
    });

    return total / this.tileStrengths.size;
  }

  /**
   * Update tile strength (for expansion/capture)
   */
  setTileStrength(gridX: number, gridY: number, newStrength: number, reason: string): void {
    const key = this.getTileKey(gridX, gridY);
    const currentStrength = this.tileStrengths.get(key) || 0;

    // Clamp strength to valid range
    const clampedStrength = Math.max(this.MIN_STRENGTH, Math.min(100, newStrength));

    this.tileStrengths.set(key, clampedStrength);

    const change: TileStrengthChange = {
      gridX,
      gridY,
      oldStrength: currentStrength,
      newStrength: clampedStrength,
      reason,
      timestamp: Date.now(),
    };

    this.addToHistory(change);
    this.strengthChangesSubject.next([change]);
  }

  /**
   * Get neighboring tiles for expansion checks
   */
  getTileNeighbors(gridX: number, gridY: number): TileNeighbors {
    const neighbors: TileNeighbors = {};

    // North
    if (gridY > 0) {
      const strength = this.getTileStrength(gridX, gridY - 1);
      if (strength > 0) {
        neighbors.north = { gridX, gridY: gridY - 1, strength };
      }
    }

    // South
    const strength = this.getTileStrength(gridX, gridY + 1);
    if (strength > 0) {
      neighbors.south = { gridX, gridY: gridY + 1, strength };
    }

    // East
    const strengthEast = this.getTileStrength(gridX + 1, gridY);
    if (strengthEast > 0) {
      neighbors.east = { gridX: gridX + 1, gridY, strength: strengthEast };
    }

    // West
    if (gridX > 0) {
      const strengthWest = this.getTileStrength(gridX - 1, gridY);
      if (strengthWest > 0) {
        neighbors.west = { gridX: gridX - 1, gridY, strength: strengthWest };
      }
    }

    return neighbors;
  }

  /**
   * Check if tile can be captured (weak enough and not a base)
   */
  canTileBeCaptured(gridX: number, gridY: number): boolean {
    const key = this.getTileKey(gridX, gridY);
    if (this.baseTiles.has(key)) return false;

    const strength = this.getTileStrength(gridX, gridY);
    return strength > 0 && strength <= this.WEAK_THRESHOLD;
  }

  /**
   * Get constants for other systems
   */
  getConstants(): { BASE_STRENGTH: number; INITIAL_STRENGTH: number; WEAK_THRESHOLD: number; MIN_STRENGTH: number } {
    return {
      BASE_STRENGTH: this.BASE_STRENGTH,
      INITIAL_STRENGTH: this.INITIAL_STRENGTH,
      WEAK_THRESHOLD: this.WEAK_THRESHOLD,
      MIN_STRENGTH: this.MIN_STRENGTH,
    };
  }

  /**
   * Get visual opacity for tile based on strength
   */
  getStrengthVisualOpacity(gridX: number, gridY: number): number {
    const strength = this.getTileStrength(gridX, gridY);
    if (strength === 0) return 0;

    // Map strength (10-100) to opacity (0.02-0.05)
    // Weaker tiles are more transparent
    const normalizedStrength = (strength - this.MIN_STRENGTH) / (100 - this.MIN_STRENGTH);
    return 0.02 + normalizedStrength * 0.03;
  }

  /**
   * Serialize for saving
   */
  serialize(): TerritoryStrengthSnapshot {
    return {
      tileStrengths: new Map(this.tileStrengths),
      lastUpdate: Date.now(),
    };
  }

  /**
   * Deserialize from save data
   */
  deserialize(snapshot: TerritoryStrengthSnapshot): void {
    if (!snapshot || !snapshot.tileStrengths) {
      this.debugLog.log('Invalid territory strength snapshot, initializing defaults', 'warning', {});
      this.initializeTileStrengths();
      return;
    }

    this.tileStrengths = new Map(snapshot.tileStrengths);
    this.strengthHistory = [];

    this.debugLog.log('Territory strengths loaded from save', 'info', {
      tileCount: this.tileStrengths.size,
      averageStrength: this.getAverageStrength(),
    });
  }

  /**
   * Reset all strengths
   */
  reset(): void {
    this.deactivateSession();
    this.activateSession();
  }

  /** Stop timers and clear session data without completing public streams. */
  deactivateSession(): void {
    if (this.regenInterval !== null) {
      window.clearInterval(this.regenInterval);
      this.regenInterval = null;
    }

    this.tileStrengths.clear();
    this.baseTiles.clear();
    this.strengthHistory = [];
    this.regenKeys = [];
    this.regenBatchCursor = 0;
    this.isInitialized = false;
    this.initRetryCount = 0;
    if (this.initializationRetryTimer !== null) {
      window.clearTimeout(this.initializationRetryTimer);
      this.initializationRetryTimer = null;
    }
  }

  /**
   * Angular lifecycle hook
   */
  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.deactivateSession();
    this.strengthChangesSubject.complete();
  }
}
