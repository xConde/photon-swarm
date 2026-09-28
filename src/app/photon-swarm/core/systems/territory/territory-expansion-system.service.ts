import { Injectable, NgZone, OnDestroy } from '@angular/core';
import {
  FourKingsTerritoryService,
  TerritoryMomentumSystemService,
  TerritoryStrengthSystemService,
} from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
export interface ExpansionEvent {
  gridX: number;
  gridY: number;
  fromKingId: number;
  toKingId: number;
  newStrength: number;
  timestamp: number;
}

export interface ExpansionCandidate {
  gridX: number;
  gridY: number;
  currentKingId: number;
  currentStrength: number;
  bestExpander: {
    kingId: number;
    strength: number;
    direction: 'north' | 'south' | 'east' | 'west';
  } | null;
}

/**
 * Territory Expansion System Service
 *
 * Manages dynamic territory expansion when tiles become weak.
 * Strong tiles can capture weak neighboring tiles from other factions.
 */
@Injectable({
  providedIn: 'root',
})
export class TerritoryExpansionSystemService implements OnDestroy {
  // Expansion constants
  private readonly EXPANSION_CHECK_INTERVAL = 10300; // 10.3 seconds — offset to avoid simultaneous firing with border conflict (5.5s) and regen (30s)
  private readonly WEAK_THRESHOLD = 30; // Can be captured if below this
  private readonly STRONG_THRESHOLD = 60; // Must be above this to expand
  private readonly CAPTURED_STRENGTH = 50; // Strength given to captured tiles
  private readonly MAX_INIT_RETRIES = 50; // Max 5 seconds of retries

  // Expansion tracking
  private expansionTimer: number | null = null;
  private initTimer: number | null = null;
  private initRetryCount = 0;
  private expansionHistory: ExpansionEvent[] = [];
  private isInitialized = false;
  private lastExpansionCheck = 0;

  constructor(
    private fourKingsTerritory: FourKingsTerritoryService,
    private territoryStrengthSystem: TerritoryStrengthSystemService,
    private debugLog: DebugLogBridgeService,
    private ngZone: NgZone,
    private territoryMomentum?: TerritoryMomentumSystemService
  ) {
    this.activateSession();
  }

  /** Start this reusable root service for the active routed game session. */
  activateSession(): void {
    if (this.isInitialized || this.initTimer !== null || this.expansionTimer !== null) return;
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
        // Check again in 100ms with retry limit
        this.initRetryCount++;
        this.ngZone.runOutsideAngular(() => {
          this.initTimer = window.setTimeout(checkInit, 100);
        });
      } else {
        // Give up after max retries
        this.initTimer = null;
        this.debugLog.log('Territory Expansion System failed to initialize - dependencies not ready', 'warning', {
          retries: this.initRetryCount,
          fourKingsReady: this.fourKingsTerritory.getIsInitialized(),
          strengthReady: this.territoryStrengthSystem.getIsInitialized(),
        });
      }
    };
    checkInit();
  }

  /**
   * Initialize the expansion system
   */
  private initialize(): void {
    if (this.isInitialized) return;

    this.isInitialized = true;
    this.startExpansionChecks();

    this.debugLog.log('Territory Expansion System Initialized', 'info', {
      checkInterval: this.EXPANSION_CHECK_INTERVAL,
      weakThreshold: this.WEAK_THRESHOLD,
      strongThreshold: this.STRONG_THRESHOLD,
    });
  }

  /**
   * Start periodic expansion checks
   */
  private startExpansionChecks(): void {
    if (this.expansionTimer !== null) {
      window.clearInterval(this.expansionTimer);
    }

    // Check for expansion opportunities every 10 seconds
    this.ngZone.runOutsideAngular(() => {
      this.expansionTimer = window.setInterval(() => {
        this.checkForExpansions();
      }, this.EXPANSION_CHECK_INTERVAL);
    });

    // Do an immediate check
    this.checkForExpansions();
  }

  /**
   * Check all tiles for expansion opportunities
   */
  private checkForExpansions(): void {
    if (!this.isInitialized) return;

    const now = Date.now();
    this.lastExpansionCheck = now;

    const candidates = this.findExpansionCandidates();

    if (candidates.length === 0) {
      return; // No expansion opportunities
    }

    // Process expansion candidates
    const expansions: ExpansionEvent[] = [];

    for (const candidate of candidates) {
      if (candidate.bestExpander) {
        // Perform the expansion
        const capturedStrength = this.expandTerritory(
          candidate.gridX,
          candidate.gridY,
          candidate.currentKingId,
          candidate.bestExpander.kingId
        );

        if (capturedStrength > 0) {
          expansions.push({
            gridX: candidate.gridX,
            gridY: candidate.gridY,
            fromKingId: candidate.currentKingId,
            toKingId: candidate.bestExpander.kingId,
            newStrength: capturedStrength,
            timestamp: now,
          });
        }
      }
    }

    if (expansions.length > 0) {
      this.expansionHistory.push(...expansions);

      this.debugLog.log('Territory Expansions Occurred', 'info', {
        expansionCount: expansions.length,
        expansions: expansions.map((e) => ({
          tile: `${e.gridX},${e.gridY}`,
          from: this.getKingName(e.fromKingId),
          to: this.getKingName(e.toKingId),
        })),
      });
    }
  }

  /**
   * Find all tiles that can be expanded into
   */
  private findExpansionCandidates(): ExpansionCandidate[] {
    const candidates: ExpansionCandidate[] = [];
    const weakTiles = this.territoryStrengthSystem.getWeakTiles();

    for (const weakTile of weakTiles) {
      // Get current tile info
      const currentTile = this.fourKingsTerritory.getTile(weakTile.gridX, weakTile.gridY);
      if (!currentTile || currentTile.kingId === 0) continue; // Skip neutral tiles

      // Find strongest adjacent tile from different faction
      const bestExpander = this.findBestExpander(weakTile.gridX, weakTile.gridY, currentTile.kingId);

      if (bestExpander) {
        candidates.push({
          gridX: weakTile.gridX,
          gridY: weakTile.gridY,
          currentKingId: currentTile.kingId,
          currentStrength: weakTile.strength,
          bestExpander,
        });
      }
    }

    // Sort by weakness (weakest first)
    candidates.sort((a, b) => a.currentStrength - b.currentStrength);

    return candidates;
  }

  /**
   * Find the best faction to expand into a weak tile
   */
  private findBestExpander(gridX: number, gridY: number, currentKingId: number): ExpansionCandidate['bestExpander'] {
    const neighbors = this.territoryStrengthSystem.getTileNeighbors(gridX, gridY);
    let bestExpander: ExpansionCandidate['bestExpander'] = null;
    let bestStrength = this.STRONG_THRESHOLD;

    // Check each neighbor
    const checkNeighbor = (
      neighbor: { gridX: number; gridY: number; strength: number } | undefined,
      direction: 'north' | 'south' | 'east' | 'west'
    ): void => {
      if (!neighbor) return;

      const neighborTile = this.fourKingsTerritory.getTile(neighbor.gridX, neighbor.gridY);
      if (!neighborTile) return;

      // Skip if same faction or neutral
      if (neighborTile.kingId === currentKingId || neighborTile.kingId === 0) return;

      // Apply momentum bonus to expansion threshold for winning factions
      let effectiveThreshold = this.STRONG_THRESHOLD;
      if (this.territoryMomentum) {
        const expansionMultiplier = this.territoryMomentum.getExpansionMultiplier(neighborTile.kingId);
        // Lower threshold for winning factions (easier to expand)
        effectiveThreshold = this.STRONG_THRESHOLD / Math.max(1.0, expansionMultiplier);
      }

      // Check if strong enough to expand
      const strength = this.territoryStrengthSystem.getTileStrength(neighbor.gridX, neighbor.gridY);
      if (strength > effectiveThreshold && strength > bestStrength) {
        bestStrength = strength;
        bestExpander = {
          kingId: neighborTile.kingId,
          strength: strength,
          direction: direction,
        };
      }
    };

    checkNeighbor(neighbors.north, 'north');
    checkNeighbor(neighbors.south, 'south');
    checkNeighbor(neighbors.east, 'east');
    checkNeighbor(neighbors.west, 'west');

    return bestExpander;
  }

  /**
   * Expand territory by changing tile ownership
   * @returns The captured strength or 0 if expansion failed
   */
  private expandTerritory(gridX: number, gridY: number, fromKingId: number, toKingId: number): number {
    // Update the tile in the world data
    const worldData = this.fourKingsTerritory.getWorldData();
    if (!worldData || !worldData.territories) return 0;

    const tile = worldData.territories[gridY]?.[gridX];
    if (!tile || tile.kingId !== fromKingId) return 0;

    // Apply momentum bonus to captured tile strength
    let capturedStrength = this.CAPTURED_STRENGTH;
    if (this.territoryMomentum) {
      const strengthBonus = this.territoryMomentum.getTerritoryStrengthBonus(toKingId);
      capturedStrength += strengthBonus;
    }

    // Change ownership
    tile.kingId = toKingId;
    tile.strength = capturedStrength;

    // Update strength system
    this.territoryStrengthSystem.setTileStrength(gridX, gridY, capturedStrength, 'territory_expansion');

    // Force visual update
    this.fourKingsTerritory.markTileForUpdate(gridX, gridY);

    return capturedStrength;
  }

  /**
   * Get king name for logging
   */
  private getKingName(kingId: number): string {
    const names = ['Neutral', 'Crimson', 'Verdant', 'Azure', 'Golden'];
    return names[kingId] || `Unknown(${kingId})`;
  }

  /**
   * Get expansion statistics
   */
  getExpansionStats(): {
    totalExpansions: number;
    recentExpansions: ExpansionEvent[];
    lastCheckTime: number;
    nextCheckTime: number;
  } {
    const now = Date.now();
    const recentCutoff = now - 60000; // Last minute

    return {
      totalExpansions: this.expansionHistory.length,
      recentExpansions: this.expansionHistory.filter((e) => e.timestamp > recentCutoff),
      lastCheckTime: this.lastExpansionCheck,
      nextCheckTime: this.lastExpansionCheck + this.EXPANSION_CHECK_INTERVAL,
    };
  }

  /**
   * Force an immediate expansion check (for testing)
   */
  forceExpansionCheck(): void {
    this.checkForExpansions();
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
  }

  /** Stop timers without making the root service unusable on route re-entry. */
  deactivateSession(): void {
    if (this.expansionTimer !== null) {
      window.clearInterval(this.expansionTimer);
      this.expansionTimer = null;
    }
    if (this.initTimer !== null) {
      window.clearTimeout(this.initTimer);
      this.initTimer = null;
    }
    this.isInitialized = false;
    this.initRetryCount = 0;
    this.expansionHistory = [];
  }

  /**
   * Reset expansion system
   */
  reset(): void {
    this.expansionHistory = [];
    this.lastExpansionCheck = 0;

    if (this.isInitialized) {
      // Restart checks
      this.startExpansionChecks();
    }
  }
}
