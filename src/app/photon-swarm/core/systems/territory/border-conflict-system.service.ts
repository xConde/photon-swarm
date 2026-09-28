import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { FourKingsTerritoryService, TerritoryStrengthSystemService, TileNeighbors } from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { TERRITORY_SYSTEM_CONFIG } from '@photon/config/game-constants';

export interface ConflictZone {
  gridX: number;
  gridY: number;
  faction1: number;
  faction2: number;
  intensity: number; // 0-1, based on strength difference
  isActive: boolean;
}

export interface BorderTile {
  gridX: number;
  gridY: number;
  kingId: number;
  adjacentFactions: Set<number>;
  isBorder: boolean;
}

export interface ConflictStats {
  totalConflictZones: number;
  activeConflicts: number;
  conflictsByIntensity: {
    low: number; // intensity < 0.3
    medium: number; // intensity 0.3-0.7
    high: number; // intensity > 0.7
  };
  hottestZone: ConflictZone | null;
}

/**
 * Border Conflict System Service
 *
 * Identifies and manages conflict zones where different factions meet.
 * Creates dynamic battlefronts with increased enemy activity.
 */
@Injectable({
  providedIn: 'root',
})
export class BorderConflictSystemService implements OnDestroy {
  // Conflict detection constants from config
  private readonly CONFLICT_UPDATE_INTERVAL = TERRITORY_SYSTEM_CONFIG.CONFLICT.UPDATE_INTERVAL_MS;
  private readonly MIN_INTENSITY_THRESHOLD = TERRITORY_SYSTEM_CONFIG.CONFLICT.MIN_INTENSITY_THRESHOLD;
  private readonly INTENSITY_DECAY_RATE = TERRITORY_SYSTEM_CONFIG.CONFLICT.INTENSITY_DECAY_RATE;

  // Conflict zone tracking
  private conflictZones = new Map<string, ConflictZone>(); // "x,y" -> ConflictZone
  private borderTiles = new Map<string, BorderTile>(); // "x,y" -> BorderTile
  private updateTimer: number | null = null;
  private conflictInterval: number | null = null;
  private initTimer: number | null = null;
  private initRetryCount = 0;
  private readonly MAX_INIT_RETRIES = 50; // Max 5 seconds of retries
  private strengthSubscription: Subscription | null = null;
  private isInitialized = false;

  // Observable for UI and other systems
  private conflictZonesSubject = new BehaviorSubject<ConflictZone[]>([]);
  public conflictZones$ = this.conflictZonesSubject.asObservable();

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private territoryStrengthSystem: TerritoryStrengthSystemService,
    private debugLog: DebugLogBridgeService,
    private ngZone: NgZone
  ) {
    this.activateSession();
  }

  /** Start this reusable root service for the active routed game session. */
  activateSession(): void {
    if (this.isInitialized || this.initTimer !== null || this.conflictInterval !== null) return;
    this.initRetryCount = 0;
    this.waitForInitialization();
  }

  /**
   * Wait for required systems to initialize
   */
  private waitForInitialization(): void {
    // Clear any existing timer
    if (this.initTimer !== null) {
      window.clearTimeout(this.initTimer);
      this.initTimer = null;
    }

    const checkInit = (): void => {
      if (this.fourKingsTerritory.getIsInitialized() && this.territoryStrengthSystem.getIsInitialized()) {
        this.initTimer = null;
        this.initialize();
      } else if (this.initRetryCount < this.MAX_INIT_RETRIES) {
        this.initRetryCount++;
        this.ngZone.runOutsideAngular(() => {
          this.initTimer = window.setTimeout(checkInit, 100);
        });
      } else {
        this.initTimer = null;
        this.debugLog.log('Border Conflict System failed to initialize - dependencies not ready', 'warning', {
          retries: this.initRetryCount,
        });
      }
    };
    checkInit();
  }

  /**
   * Initialize the conflict system
   */
  private initialize(): void {
    if (this.isInitialized) return;

    this.isInitialized = true;
    this.startConflictDetection();

    // Subscribe to territory changes to update conflicts
    this.strengthSubscription = this.territoryStrengthSystem.strengthChanges$.subscribe(() => {
      // Debounce updates
      if (!this.updateTimer) {
        this.ngZone.runOutsideAngular(() => {
          this.updateTimer = window.setTimeout(() => {
            this.updateTimer = null;
            this.detectConflictZones();
          }, 1000);
        });
      }
    });

    this.debugLog.log('Border Conflict System Initialized', 'info', {
      updateInterval: this.CONFLICT_UPDATE_INTERVAL,
    });
  }

  /**
   * Start periodic conflict detection
   */
  private startConflictDetection(): void {
    // Initial detection
    this.detectBorderTiles();
    this.detectConflictZones();

    // Periodic updates
    this.ngZone.runOutsideAngular(() => {
      this.conflictInterval = window.setInterval(() => {
        this.updateConflictIntensities();
        this.detectConflictZones();
      }, this.CONFLICT_UPDATE_INTERVAL);
    });
  }

  /**
   * Detect all border tiles (tiles adjacent to other factions)
   */
  private detectBorderTiles(): void {
    this.borderTiles.clear();

    const worldData = this.fourKingsTerritory.getWorldData();
    if (!worldData || !worldData.territories) return;

    const height = worldData.territories.length;
    const width = worldData.territories[0]?.length || 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = worldData.territories[y]?.[x];
        if (!tile || tile.kingId === 0) continue; // Skip neutral tiles

        const adjacentFactions = new Set<number>();

        // Check all adjacent tiles
        const neighbors = [
          { dx: 0, dy: -1 }, // North
          { dx: 0, dy: 1 }, // South
          { dx: -1, dy: 0 }, // West
          { dx: 1, dy: 0 }, // East
        ];

        for (const { dx, dy } of neighbors) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const neighbor = worldData.territories[ny]?.[nx];
            if (neighbor && neighbor.kingId !== tile.kingId && neighbor.kingId !== 0) {
              adjacentFactions.add(neighbor.kingId);
            }
          }
        }

        if (adjacentFactions.size > 0) {
          const borderTile: BorderTile = {
            gridX: x,
            gridY: y,
            kingId: tile.kingId,
            adjacentFactions,
            isBorder: true,
          };

          this.borderTiles.set(`${x},${y}`, borderTile);
        }
      }
    }

    this.debugLog.log('Border tiles detected', 'info', {
      totalBorderTiles: this.borderTiles.size,
    });
  }

  /**
   * Detect and update conflict zones
   */
  private detectConflictZones(): void {
    const newConflictZones: ConflictZone[] = [];

    // Check each border tile for conflict potential
    this.borderTiles.forEach((borderTile, key) => {
      const { gridX, gridY, kingId, adjacentFactions } = borderTile;

      // Get strength of this tile
      const tileStrength = this.territoryStrengthSystem.getTileStrength(gridX, gridY);

      // Check conflict with each adjacent faction
      adjacentFactions.forEach((enemyFaction) => {
        // Find strongest adjacent enemy tile
        let maxEnemyStrength = 0;
        const neighbors: TileNeighbors = this.territoryStrengthSystem.getTileNeighbors(gridX, gridY);

        // Iterate over known directions with proper typing
        const directions: (keyof TileNeighbors)[] = ['north', 'south', 'east', 'west'];
        for (const direction of directions) {
          const neighbor = neighbors[direction];
          if (neighbor) {
            const neighborTile = this.fourKingsTerritory.getTile(neighbor.gridX, neighbor.gridY);
            if (neighborTile && neighborTile.kingId === enemyFaction) {
              const strength = this.territoryStrengthSystem.getTileStrength(neighbor.gridX, neighbor.gridY);
              maxEnemyStrength = Math.max(maxEnemyStrength, strength);
            }
          }
        }

        // Calculate conflict intensity based on strength difference
        const strengthDiff = Math.abs(tileStrength - maxEnemyStrength);
        const maxStrength = Math.max(tileStrength, maxEnemyStrength);
        const intensity = maxStrength > 0 ? 1 - strengthDiff / maxStrength : 0;

        // Check if this is an active conflict
        if (intensity >= this.MIN_INTENSITY_THRESHOLD) {
          // Check if we already have this conflict zone
          const existingZone = this.conflictZones.get(key);

          const conflictZone: ConflictZone = {
            gridX,
            gridY,
            faction1: kingId,
            faction2: enemyFaction,
            intensity: existingZone
              ? // Blend old and new intensity for smoothing
                existingZone.intensity * TERRITORY_SYSTEM_CONFIG.CONFLICT.INTENSITY_BLEND_OLD +
                intensity * TERRITORY_SYSTEM_CONFIG.CONFLICT.INTENSITY_BLEND_NEW
              : intensity,
            isActive: true,
          };

          newConflictZones.push(conflictZone);
          this.conflictZones.set(key, conflictZone);
        }
      });
    });

    // Remove inactive zones
    const activeKeys = new Set(newConflictZones.map((z) => `${z.gridX},${z.gridY}`));
    const keysToRemove: string[] = [];

    this.conflictZones.forEach((_zone, key) => {
      if (!activeKeys.has(key)) {
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach((key) => this.conflictZones.delete(key));

    // Update observable
    this.conflictZonesSubject.next(newConflictZones);

    // Log significant changes
    if (Math.random() < TERRITORY_SYSTEM_CONFIG.CONFLICT.CONFLICT_LOG_CHANCE) {
      this.debugLog.log('Conflict zones updated', 'info', {
        activeZones: newConflictZones.length,
        hottestZone: this.getHottestZone(),
      });
    }
  }

  /**
   * Update conflict intensities over time
   */
  private updateConflictIntensities(): void {
    this.conflictZones.forEach((zone) => {
      // Decay intensity over time if no recent battles
      zone.intensity *= this.INTENSITY_DECAY_RATE;

      // Remove if intensity is too low
      if (zone.intensity < this.MIN_INTENSITY_THRESHOLD) {
        zone.isActive = false;
      }
    });
  }

  /**
   * Boost conflict intensity when combat occurs
   */
  public boostConflictIntensity(gridX: number, gridY: number, amount: number = 0.1): void {
    const key = `${gridX},${gridY}`;
    const zone = this.conflictZones.get(key);

    if (zone) {
      zone.intensity = Math.min(1, zone.intensity + amount);
      zone.isActive = true;
    }
  }

  /**
   * Check if a position is in a conflict zone
   */
  public isInConflictZone(worldX: number, worldY: number): boolean {
    const gridPos = this.fourKingsTerritory.worldToGrid(worldX, worldY);
    if (!gridPos) return false;

    const key = `${gridPos.gridX},${gridPos.gridY}`;
    const zone = this.conflictZones.get(key);

    return zone ? zone.isActive : false;
  }

  /**
   * Get conflict zone at position
   */
  public getConflictZone(worldX: number, worldY: number): ConflictZone | null {
    const gridPos = this.fourKingsTerritory.worldToGrid(worldX, worldY);
    if (!gridPos) return null;

    const key = `${gridPos.gridX},${gridPos.gridY}`;
    return this.conflictZones.get(key) || null;
  }

  /**
   * Get all active conflict zones
   */
  public getActiveConflictZones(): ConflictZone[] {
    const result: ConflictZone[] = [];
    this.conflictZones.forEach((z) => {
      if (z.isActive) result.push(z);
    });
    return result;
  }

  /**
   * Get conflict zones for a specific faction
   */
  public getFactionsConflictZones(factionId: number): ConflictZone[] {
    const result: ConflictZone[] = [];
    this.conflictZones.forEach((z) => {
      if (z.isActive && (z.faction1 === factionId || z.faction2 === factionId)) result.push(z);
    });
    return result;
  }

  /**
   * Get the most intense conflict zone
   */
  public getHottestZone(): ConflictZone | null {
    let hottestZone: ConflictZone | null = null;
    let maxIntensity = 0;

    this.conflictZones.forEach((zone) => {
      if (zone.isActive && zone.intensity > maxIntensity) {
        maxIntensity = zone.intensity;
        hottestZone = zone;
      }
    });

    return hottestZone;
  }

  /**
   * Get conflict statistics
   */
  public getConflictStats(): ConflictStats {
    let totalConflictZones = 0;
    let activeConflicts = 0;
    let low = 0;
    let medium = 0;
    let high = 0;

    this.conflictZones.forEach((z) => {
      totalConflictZones++;
      if (z.isActive) {
        activeConflicts++;
        if (z.intensity < 0.3) low++;
        else if (z.intensity <= 0.7) medium++;
        else high++;
      }
    });

    return {
      totalConflictZones,
      activeConflicts,
      conflictsByIntensity: { low, medium, high },
      hottestZone: this.getHottestZone(),
    };
  }

  /**
   * Get spawn multiplier for conflict zones
   */
  public getSpawnMultiplier(worldX: number, worldY: number): number {
    const zone = this.getConflictZone(worldX, worldY);
    if (!zone || !zone.isActive) return 1.0;

    // Scale spawn rate based on intensity
    return (
      TERRITORY_SYSTEM_CONFIG.CONFLICT.SPAWN_MULTIPLIER_BASE +
      zone.intensity * TERRITORY_SYSTEM_CONFIG.CONFLICT.SPAWN_MULTIPLIER_SCALE
    );
  }

  /**
   * Should spawn mixed factions in this zone
   */
  public shouldSpawnMixedFactions(worldX: number, worldY: number): boolean {
    const zone = this.getConflictZone(worldX, worldY);
    return zone ? zone.isActive && zone.intensity > TERRITORY_SYSTEM_CONFIG.CONFLICT.MIXED_FACTION_THRESHOLD : false;
  }

  /**
   * Get factions involved in conflict at position
   */
  public getConflictingFactions(worldX: number, worldY: number): number[] {
    const zone = this.getConflictZone(worldX, worldY);
    return zone ? [zone.faction1, zone.faction2] : [];
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.deactivateSession();
    this.conflictZonesSubject.complete();
  }

  /** Stop timers/subscriptions without completing the reusable public stream. */
  deactivateSession(): void {
    if (this.updateTimer !== null) {
      window.clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    if (this.conflictInterval !== null) {
      window.clearInterval(this.conflictInterval);
      this.conflictInterval = null;
    }

    if (this.initTimer !== null) {
      window.clearTimeout(this.initTimer);
      this.initTimer = null;
    }

    if (this.strengthSubscription) {
      this.strengthSubscription.unsubscribe();
      this.strengthSubscription = null;
    }

    this.conflictZones.clear();
    this.borderTiles.clear();
    this.conflictZonesSubject.next([]);
    this.isInitialized = false;
    this.initRetryCount = 0;
  }

  /**
   * Angular lifecycle cleanup
   */
  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Reset conflict zones
   */
  reset(): void {
    this.conflictZones.clear();
    this.borderTiles.clear();

    if (this.isInitialized) {
      this.detectBorderTiles();
      this.detectConflictZones();
    }
  }
}
