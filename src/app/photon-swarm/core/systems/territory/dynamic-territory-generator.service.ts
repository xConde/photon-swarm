import { Injectable } from '@angular/core';
import { RandomService } from '../../utils/random.service';
import { KingConfig, TerritoryTile } from '../../models/territory.model';
import { TERRITORY_CONFIG } from '@photon/config/game-constants';

/**
 * Dynamic Territory Generator
 * Creates organic, varied territory layouts with roads and natural boundaries
 */
@Injectable({
  providedIn: 'root',
})
export class DynamicTerritoryGeneratorService {
  // Territory generation constants
  private static readonly SEED_POINT_MARGIN = 8; // Keep seeds away from edges
  private static readonly MIN_SEEDS_PER_KING = 2;
  private static readonly MAX_SEEDS_PER_KING = 4;
  private static readonly MIN_SEED_DISTANCE = 15; // Minimum distance between seeds
  private static readonly SEED_STRENGTH_BASE = 0.8;
  private static readonly SEED_STRENGTH_VARIANCE = 0.2;

  // Road generation constants
  private static readonly MIN_MAJOR_ROADS = 3;
  private static readonly MAX_MAJOR_ROADS = 5;
  private static readonly MIN_ROAD_WIDTH = 2;
  private static readonly MAX_ROAD_WIDTH = 3;
  private static readonly ROAD_CURVE_PROBABILITY = 0.3;
  private static readonly ROAD_STRENGTH = 0.1;
  private static readonly ROAD_CONNECTIONS_HORIZONTAL = 6; // East-West (2+4)
  private static readonly ROAD_CONNECTIONS_VERTICAL = 9; // North-South (1+8)

  // Territory expansion constants
  private static readonly TERRITORY_BALANCE_TOLERANCE = 0.1; // 10% variance - more achievable for 4-way balance
  private static readonly MAX_BALANCE_ITERATIONS = 100;
  private static readonly MAX_BORDER_TRANSFERS = 15; // Increased from 5 to allow more aggressive balancing
  private static readonly CONNECTING_PATH_STRENGTH = 0.4;
  private static readonly TRANSFERRED_TILE_STRENGTH = 0.3;

  // Territory validation constants
  private static readonly BORDER_ROAD_PROBABILITY = 0.15;
  private static readonly ORGANIC_IRREGULARITY_PROBABILITY = 0.05;

  // Territory consolidation constants
  private static readonly MIN_ISLAND_SIZE = 20; // Minimum tiles per island
  private static readonly MAX_GAP_SIZE = 3; // Maximum gap to fill between islands
  private static readonly CONSOLIDATION_STRENGTH = 0.6; // Strength for consolidated tiles

  // Expansion strength constants
  private static readonly BASE_EXPANSION_STRENGTH = 0.5;
  private static readonly EXPANSION_STRENGTH_VARIANCE = 0.3;
  private static readonly MAX_DISTANCE_BONUS = 0.3;
  private static readonly DISTANCE_PENALTY_RATE = 0.05;

  constructor(private random: RandomService) {
    // The random service now uses SeededRandomService internally
    // ensuring deterministic territory generation
  }

  /**
   * Initialize the random seed for deterministic territory generation
   */
  setSeed(seed: string): void {
    this.random.setSeed(seed);

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Generator: Seed initialized', 'info', {
        seed,
        service: 'DynamicTerritoryGeneratorService',
      });
    }
  }

  /**
   * Generate dynamic territories with organic boundaries and roads
   * Now fully deterministic based on the set seed
   */
  generateTerritories(gridWidth: number, gridHeight: number, kings: KingConfig[]): (TerritoryTile | null)[][] {
    const grid: (TerritoryTile | null)[][] = [];

    // Initialize empty grid
    for (let x = 0; x < gridWidth; x++) {
      grid[x] = [];
      for (let y = 0; y < gridHeight; y++) {
        grid[x][y] = null;
      }
    }

    // Generate seed points for each king (multiple per king for varied territories)
    const seedPoints = this.generateKingSeedPoints(gridWidth, gridHeight, kings);

    // Generate major roads/corridors first
    this.generateMajorRoads(grid, gridWidth, gridHeight, kings);

    // Use Voronoi-like expansion with faction-specific growth patterns
    this.expandTerritoriesFromSeeds(grid, gridWidth, gridHeight, seedPoints, kings);

    // Create border roads and neutral corridors
    this.createBorderRoads(grid, gridWidth, gridHeight);

    // Ensure no tile is left unclaimed
    this.fillRemainingTiles(grid, gridWidth, gridHeight, kings);

    // Additional gap-filling pass to prevent large open spaces
    this.fillLargeGaps(grid, gridWidth, gridHeight, kings);

    // Add organic irregularities
    this.addOrganicIrregularities(grid, gridWidth, gridHeight);

    // CRITICAL: Aggressive island consolidation BEFORE balance algorithm
    // This prevents the 164+ island fragmentation issue
    this.consolidateTerritoryIslandsAggressive(grid, gridWidth, gridHeight, kings);

    // Fill small gaps between territories of the same king
    this.fillSmallTerritoryGaps(grid, gridWidth, gridHeight, kings);

    // REQUIREMENT 1: Ensure all territories are connected (no isolated islands)
    this.ensureConnectedTerritories(grid, gridWidth, gridHeight, kings);

    // REQUIREMENT 1.5: Ensure all territory groups have at least 3 tiles touching
    this.enforceMinimumTileGroupSize(grid, gridWidth, gridHeight, kings);

    // REQUIREMENT 2: Balance territory sizes within 5% variance
    this.balanceTerritoryDistribution(grid, gridWidth, gridHeight, kings);

    // Final validation and logging
    this.validateAndLogTerritoryGeneration(grid, gridWidth, gridHeight, kings);

    return grid;
  }

  /**
   * Generate multiple seed points for each king for varied territory shapes
   */
  private generateKingSeedPoints(
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): Array<{ x: number; y: number; kingId: number; strength: number }> {
    const seeds: Array<{ x: number; y: number; kingId: number; strength: number }> = [];

    // Generate seeds per king for varied territory shapes
    for (const king of kings) {
      const seedCount =
        DynamicTerritoryGeneratorService.MIN_SEEDS_PER_KING +
        Math.floor(
          this.random.random() *
            (DynamicTerritoryGeneratorService.MAX_SEEDS_PER_KING -
              DynamicTerritoryGeneratorService.MIN_SEEDS_PER_KING +
              1)
        );

      for (let i = 0; i < seedCount; i++) {
        const x =
          DynamicTerritoryGeneratorService.SEED_POINT_MARGIN +
          Math.floor(this.random.random() * (gridWidth - DynamicTerritoryGeneratorService.SEED_POINT_MARGIN * 2));
        const y =
          DynamicTerritoryGeneratorService.SEED_POINT_MARGIN +
          Math.floor(this.random.random() * (gridHeight - DynamicTerritoryGeneratorService.SEED_POINT_MARGIN * 2));

        // Ensure seeds aren't too close to each other
        const tooClose = seeds.some(
          (seed) => Math.abs(seed.x - x) + Math.abs(seed.y - y) < DynamicTerritoryGeneratorService.MIN_SEED_DISTANCE
        );

        if (!tooClose) {
          seeds.push({
            x,
            y,
            kingId: king.id,
            strength:
              DynamicTerritoryGeneratorService.SEED_STRENGTH_BASE +
              this.random.random() * DynamicTerritoryGeneratorService.SEED_STRENGTH_VARIANCE,
          });
        }
      }
    }

    return seeds;
  }

  /**
   * Generate major roads/corridors that cut across the map
   */
  private generateMajorRoads(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const roadCount =
      DynamicTerritoryGeneratorService.MIN_MAJOR_ROADS +
      Math.floor(
        this.random.random() *
          (DynamicTerritoryGeneratorService.MAX_MAJOR_ROADS - DynamicTerritoryGeneratorService.MIN_MAJOR_ROADS + 1)
      );

    for (let i = 0; i < roadCount; i++) {
      if (this.random.random() < 0.5) {
        // Horizontal road
        this.createHorizontalRoad(grid, gridWidth, gridHeight, kings);
      } else {
        // Vertical road
        this.createVerticalRoad(grid, gridWidth, gridHeight, kings);
      }
    }
  }

  /**
   * Create a horizontal road with organic curves
   */
  private createHorizontalRoad(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const startY = Math.floor(this.random.random() * gridHeight);
    const roadWidth =
      DynamicTerritoryGeneratorService.MIN_ROAD_WIDTH +
      Math.floor(
        this.random.random() *
          (DynamicTerritoryGeneratorService.MAX_ROAD_WIDTH - DynamicTerritoryGeneratorService.MIN_ROAD_WIDTH + 1)
      );

    let currentY = startY;

    for (let x = 0; x < gridWidth; x++) {
      // Add organic curves to the road
      if (this.random.random() < DynamicTerritoryGeneratorService.ROAD_CURVE_PROBABILITY) {
        currentY += this.random.random() < 0.5 ? 1 : -1;
        currentY = Math.max(1, Math.min(gridHeight - 2, currentY));
      }

      // Mark road tiles (assign to nearest king immediately)
      for (let dy = -Math.floor(roadWidth / 2); dy <= Math.floor(roadWidth / 2); dy++) {
        const roadY = currentY + dy;
        if (roadY >= 0 && roadY < gridHeight) {
          // Find nearest king for this road tile
          const nearestKing =
            this.findNearestKing(grid, gridWidth, gridHeight, x, roadY) ||
            ((Math.floor(x / 10) + Math.floor(roadY / 10)) % kings.length) + 1;

          grid[x][roadY] = {
            x,
            y: roadY,
            kingId: nearestKing,
            strength: DynamicTerritoryGeneratorService.ROAD_STRENGTH,
            age: 0,
            contested: true,
            isRoad: true,
            roadConnections: DynamicTerritoryGeneratorService.ROAD_CONNECTIONS_HORIZONTAL,
          };
        }
      }
    }
  }

  /**
   * Create a vertical road with organic curves
   */
  private createVerticalRoad(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const startX = Math.floor(this.random.random() * gridWidth);
    const roadWidth =
      DynamicTerritoryGeneratorService.MIN_ROAD_WIDTH +
      Math.floor(
        this.random.random() *
          (DynamicTerritoryGeneratorService.MAX_ROAD_WIDTH - DynamicTerritoryGeneratorService.MIN_ROAD_WIDTH + 1)
      );

    let currentX = startX;

    for (let y = 0; y < gridHeight; y++) {
      // Add organic curves to the road
      if (this.random.random() < DynamicTerritoryGeneratorService.ROAD_CURVE_PROBABILITY) {
        currentX += this.random.random() < 0.5 ? 1 : -1;
        currentX = Math.max(1, Math.min(gridWidth - 2, currentX));
      }

      // Mark road tiles (assign to nearest king immediately)
      for (let dx = -Math.floor(roadWidth / 2); dx <= Math.floor(roadWidth / 2); dx++) {
        const roadX = currentX + dx;
        if (roadX >= 0 && roadX < gridWidth) {
          // Find nearest king for this road tile
          const nearestKing =
            this.findNearestKing(grid, gridWidth, gridHeight, roadX, y) ||
            ((Math.floor(roadX / 10) + Math.floor(y / 10)) % kings.length) + 1;

          grid[roadX][y] = {
            x: roadX,
            y,
            kingId: nearestKing,
            strength: DynamicTerritoryGeneratorService.ROAD_STRENGTH,
            age: 0,
            contested: true,
            isRoad: true,
            roadConnections: DynamicTerritoryGeneratorService.ROAD_CONNECTIONS_VERTICAL,
          };
        }
      }
    }
  }

  /**
   * Expand territories from seed points using faction-specific patterns
   */
  private expandTerritoriesFromSeeds(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    seeds: Array<{ x: number; y: number; kingId: number; strength: number }>,
    kings: KingConfig[]
  ): void {
    // Place initial seeds
    seeds.forEach((seed) => {
      const cell = grid[seed.x][seed.y];
      if (!cell || cell.kingId === 0) {
        grid[seed.x][seed.y] = {
          x: seed.x,
          y: seed.y,
          kingId: seed.kingId,
          strength: seed.strength,
          age: 0,
          contested: false,
        };
      }
    });

    // Expand outward in waves
    let expansionRounds = 0;
    const maxRounds = Math.max(gridWidth, gridHeight) * 2; // Increase max rounds to ensure full coverage

    while (expansionRounds < maxRounds) {
      let expandedAnyTile = false;

      // Randomize king order each round for fairness
      const kingOrder = [...kings].sort(() => this.random.random() - 0.5);

      for (const king of kingOrder) {
        // Increase expansion rate for better coverage
        const expandedTiles = this.expandKingTerritoryImproved(grid, gridWidth, gridHeight, king);
        expandedAnyTile = expandedAnyTile || expandedTiles > 0;
      }

      if (!expandedAnyTile) {
        // If no expansion happened, check coverage
        const coverage = this.calculateCoverage(grid, gridWidth, gridHeight);
        if (coverage < 0.95) {
          // If less than 95% covered, force more aggressive expansion
          if (window.debugLogBridge && expansionRounds % 10 === 0) {
            window.debugLogBridge.log(
              `Territory expansion stalled at ${(coverage * 100).toFixed(1)}% coverage, forcing aggressive expansion`,
              'warning',
              {
                source: 'dynamic_territory_generator',
                operation: 'expand_territories',
                round: expansionRounds,
                coverage: coverage,
              }
            );
          }
          // Continue with more aggressive expansion (loop continues regardless)
        } else {
          break;
        }
      }

      expansionRounds++;
    }

    if (window.debugLogBridge) {
      const finalCoverage = this.calculateCoverage(grid, gridWidth, gridHeight);
      window.debugLogBridge.log(`Territory expansion completed`, 'info', {
        source: 'dynamic_territory_generator',
        operation: 'expand_territories_complete',
        rounds: expansionRounds,
        finalCoverage: (finalCoverage * 100).toFixed(1) + '%',
      });
    }
  }

  /**
   * Calculate coverage percentage of the grid
   */
  private calculateCoverage(grid: (TerritoryTile | null)[][], gridWidth: number, gridHeight: number): number {
    let filledTiles = 0;
    const totalTiles = gridWidth * gridHeight;

    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const tile = grid[x][y];
        if (tile && tile.kingId > 0) {
          filledTiles++;
        }
      }
    }

    return filledTiles / totalTiles;
  }

  /**
   * Improved expansion method with better coverage
   */
  private expandKingTerritoryImproved(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    king: KingConfig
  ): number {
    const ownedTiles = this.getKingTiles(grid, gridWidth, gridHeight, king.id);
    let expandedCount = 0;

    // If king has no tiles, give them some seed positions
    if (ownedTiles.length === 0) {
      const seedX = Math.floor(this.random.random() * gridWidth);
      const seedY = Math.floor(this.random.random() * gridHeight);
      if (!grid[seedX][seedY]) {
        grid[seedX][seedY] = {
          x: seedX,
          y: seedY,
          kingId: king.id,
          strength: 0.8,
          age: 0,
          contested: false,
        };
        expandedCount++;
      }
      return expandedCount;
    }

    // Get all border tiles for more efficient expansion
    const borderTiles = ownedTiles.filter((tile) =>
      this.getNeighborTiles(tile.x, tile.y, gridWidth, gridHeight).some((n) => {
        const neighborTile = grid[n.x][n.y];
        return !neighborTile || neighborTile.kingId !== king.id;
      })
    );

    // Shuffle for varied expansion
    const shuffledBorderTiles = [...borderTiles].sort(() => this.random.random() - 0.5);

    // Expand from more tiles for better coverage
    const tilesToExpand = Math.min(
      shuffledBorderTiles.length,
      Math.ceil(king.expansionRate * 2) // Double the expansion rate
    );

    for (let i = 0; i < tilesToExpand; i++) {
      const tile = shuffledBorderTiles[i];
      const neighbors = this.getNeighborTiles(tile.x, tile.y, gridWidth, gridHeight);

      // Shuffle neighbors for varied expansion direction
      const shuffledNeighbors = [...neighbors].sort(() => this.random.random() - 0.5);

      for (const neighbor of shuffledNeighbors) {
        const neighborTile = grid[neighbor.x][neighbor.y];
        if (!neighborTile || (neighborTile.kingId === 0 && this.random.random() < 0.7)) {
          const strength = this.calculateExpansionStrength(grid, king, neighbor, tile);
          grid[neighbor.x][neighbor.y] = {
            x: neighbor.x,
            y: neighbor.y,
            kingId: king.id,
            strength,
            age: 0,
            contested: false,
          };
          expandedCount++;
          break; // Only one expansion per border tile
        }
      }
    }

    return expandedCount;
  }

  /**
   * Calculate expansion strength for a tile
   */
  private calculateExpansionStrength(
    grid: (TerritoryTile | null)[][],
    king: KingConfig,
    neighbor: { x: number; y: number },
    _fromTile: TerritoryTile
  ): number {
    const baseStrength =
      DynamicTerritoryGeneratorService.BASE_EXPANSION_STRENGTH +
      this.random.random() * DynamicTerritoryGeneratorService.EXPANSION_STRENGTH_VARIANCE;
    const distanceBonus = Math.max(
      0,
      DynamicTerritoryGeneratorService.MAX_DISTANCE_BONUS -
        this.getDistanceToNearestOwnedTile(grid, neighbor.x, neighbor.y, king.id) *
          DynamicTerritoryGeneratorService.DISTANCE_PENALTY_RATE
    );

    return Math.min(1.0, baseStrength + distanceBonus);
  }

  /**
   * Create border roads between major territories
   */
  private createBorderRoads(grid: (TerritoryTile | null)[][], gridWidth: number, gridHeight: number): void {
    // Find border areas between different kings
    for (let x = 1; x < gridWidth - 1; x++) {
      for (let y = 1; y < gridHeight - 1; y++) {
        const tile = grid[x][y];
        if (!tile) continue;

        const neighbors = this.getNeighborTiles(x, y, gridWidth, gridHeight);
        const differentKings = new Set(
          neighbors.map((n) => grid[n.x][n.y]?.kingId).filter((id) => id && id !== tile.kingId)
        );

        // If bordering 2+ different kings, sometimes create a road
        if (
          differentKings.size >= 2 &&
          this.random.random() < DynamicTerritoryGeneratorService.BORDER_ROAD_PROBABILITY
        ) {
          tile.contested = true;
          tile.strength = Math.min(tile.strength, 0.3);
        }
      }
    }
  }

  /**
   * Fill any remaining unclaimed tiles and fix invalid kingId = 0 tiles
   */
  private fillRemainingTiles(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    if (kings.length === 0) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Cannot fill remaining tiles: no kings provided', 'error', {
          source: 'dynamic_territory_generator',
          operation: 'fill_remaining_tiles',
        });
      }
      return;
    }

    let unfilledCount = 0;
    let fixedInvalidCount = 0;

    // CRITICAL FIX: Ensure EVERY grid position is filled
    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const tile = grid[x][y];

        // Handle null tiles (empty)
        if (!tile) {
          // Find nearest owned tile and assign to that king
          let nearestKing = this.findNearestKing(grid, gridWidth, gridHeight, x, y);

          // If no nearest king found, use a more intelligent assignment
          if (!nearestKing) {
            // Create a deterministic pattern that ensures good distribution
            // Use a wave pattern that alternates between kings
            const waveX = Math.floor(x / 10);
            const waveY = Math.floor(y / 10);
            nearestKing = ((waveX + waveY) % kings.length) + 1;

            if (window.debugLogBridge && unfilledCount < 10) {
              window.debugLogBridge.log(
                `No nearest king found for tile (${x}, ${y}), using wave pattern assignment to king ${nearestKing}`,
                'warning',
                {
                  source: 'dynamic_territory_generator',
                  operation: 'fill_remaining_tiles',
                  position: [x, y],
                  waveCoords: [waveX, waveY],
                }
              );
            }
          }

          grid[x][y] = {
            x,
            y,
            kingId: nearestKing,
            strength: 0.2 + this.random.random() * 0.3,
            age: 0,
            contested: false,
          };
          unfilledCount++;
        }
        // EMERGENCY FIX: Handle tiles with invalid kingId = 0 (unassigned roads)
        else if (tile.kingId === 0) {
          // Find nearest valid king and assign
          let nearestKing = this.findNearestKing(grid, gridWidth, gridHeight, x, y);

          // If no nearest king found, use wave pattern
          if (!nearestKing) {
            const waveX = Math.floor(x / 10);
            const waveY = Math.floor(y / 10);
            nearestKing = ((waveX + waveY) % kings.length) + 1;
          }

          // Fix the invalid kingId
          tile.kingId = nearestKing;
          fixedInvalidCount++;

          if (window.debugLogBridge && fixedInvalidCount <= 5) {
            // Log first 5 for debugging
            window.debugLogBridge.log(
              `Fixed invalid kingId=0 at (${x}, ${y}), assigned to king ${nearestKing}`,
              'warning',
              {
                source: 'dynamic_territory_generator',
                operation: 'fix_invalid_kingid',
                position: [x, y],
                assignedKing: nearestKing,
                isRoad: tile.isRoad || false,
              }
            );
          }
        }
      }
    }

    // FINAL VERIFICATION: Ensure 100% coverage
    let finalCheckEmpty = 0;
    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const tile = grid[x][y];
        if (!tile || tile.kingId === 0) {
          finalCheckEmpty++;
        }
      }
    }

    if (window.debugLogBridge) {
      if (unfilledCount > 0) {
        window.debugLogBridge.log(`Filled ${unfilledCount} empty tiles to ensure full coverage`, 'info', {
          source: 'dynamic_territory_generator',
          operation: 'fill_remaining_tiles',
          unfilledCount,
          totalTiles: gridWidth * gridHeight,
          coveragePercent: (((gridWidth * gridHeight - finalCheckEmpty) / (gridWidth * gridHeight)) * 100).toFixed(2),
        });
      }

      if (fixedInvalidCount > 0) {
        window.debugLogBridge.log(`EMERGENCY FIX: Fixed ${fixedInvalidCount} tiles with invalid kingId=0`, 'error', {
          source: 'dynamic_territory_generator',
          operation: 'fix_invalid_kingid',
          fixedCount: fixedInvalidCount,
          totalTiles: gridWidth * gridHeight,
        });
      }

      if (finalCheckEmpty > 0) {
        window.debugLogBridge.log(`WARNING: ${finalCheckEmpty} tiles still empty after fill operation!`, 'error', {
          source: 'dynamic_territory_generator',
          operation: 'final_verification',
          emptyTiles: finalCheckEmpty,
          totalTiles: gridWidth * gridHeight,
        });
      }
    }
  }

  /**
   * Fill large gaps to prevent vast open spaces
   */
  private fillLargeGaps(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const gapThreshold = 25; // Areas larger than 25x25 tiles
    let gapsFilled = 0;

    // Check for large rectangular gaps using a sliding window approach
    for (let x = 0; x < gridWidth - gapThreshold; x += gapThreshold) {
      for (let y = 0; y < gridHeight - gapThreshold; y += gapThreshold) {
        const gapInfo = this.analyzeGapRegion(grid, x, y, gapThreshold, gapThreshold);

        if (gapInfo.emptyTiles > gapThreshold * gapThreshold * 0.8) {
          // This is a large gap, fill it
          this.fillGapRegion(grid, x, y, gapThreshold, gapThreshold, kings);
          gapsFilled++;
        }
      }
    }

    if (gapsFilled > 0 && window.debugLogBridge) {
      window.debugLogBridge.log(`Filled ${gapsFilled} large gaps to prevent open spaces`, 'info', {
        source: 'dynamic_territory_generator',
        operation: 'fill_large_gaps',
        gapsFilled,
        threshold: gapThreshold,
      });
    }
  }

  /**
   * Analyze a region to determine if it's a large gap
   */
  private analyzeGapRegion(
    grid: (TerritoryTile | null)[][],
    startX: number,
    startY: number,
    width: number,
    height: number
  ): {
    emptyTiles: number;
    totalTiles: number;
    dominantKing?: number;
  } {
    let emptyTiles = 0;
    let totalTiles = 0;
    const kingCounts = new Map<number, number>();

    for (let x = startX; x < Math.min(startX + width, grid.length); x++) {
      for (let y = startY; y < Math.min(startY + height, grid[0].length); y++) {
        totalTiles++;

        const tile = grid[x][y];
        if (!tile) {
          emptyTiles++;
        } else {
          const kingId = tile.kingId;
          if (kingId > 0) {
            kingCounts.set(kingId, (kingCounts.get(kingId) || 0) + 1);
          }
        }
      }
    }

    // Find dominant king in surrounding area
    let dominantKing: number | undefined;
    let maxCount = 0;
    for (const [kingId, count] of Array.from(kingCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantKing = kingId;
      }
    }

    return { emptyTiles, totalTiles, dominantKing };
  }

  /**
   * Fill a gap region with territory tiles
   */
  private fillGapRegion(
    grid: (TerritoryTile | null)[][],
    startX: number,
    startY: number,
    width: number,
    height: number,
    kings: KingConfig[]
  ): void {
    const regionInfo = this.analyzeGapRegion(grid, startX, startY, width, height);

    // Use dominant king if available, otherwise choose randomly
    const assignedKing = regionInfo.dominantKing || Math.floor(this.random.random() * kings.length) + 1;

    // Create a natural pattern within the gap
    for (let x = startX; x < Math.min(startX + width, grid.length); x++) {
      for (let y = startY; y < Math.min(startY + height, grid[0].length); y++) {
        if (!grid[x][y]) {
          // Create natural variation in the gap filling
          if (this.random.random() < 0.85) {
            // 85% chance to fill each tile
            grid[x][y] = {
              x,
              y,
              kingId: assignedKing,
              strength: 0.3 + this.random.random() * 0.4,
              age: 0,
              contested: false,
            };
          }
        }
      }
    }
  }

  /**
   * Add organic irregularities to make territories feel more natural
   */
  private addOrganicIrregularities(grid: (TerritoryTile | null)[][], gridWidth: number, gridHeight: number): void {
    const iterations = 3;

    for (let i = 0; i < iterations; i++) {
      for (let x = 1; x < gridWidth - 1; x++) {
        for (let y = 1; y < gridHeight - 1; y++) {
          if (this.random.random() < DynamicTerritoryGeneratorService.ORGANIC_IRREGULARITY_PROBABILITY) {
            this.createOrganicPatch(grid, gridWidth, gridHeight, x, y);
          }
        }
      }
    }
  }

  /**
   * Create a small organic patch that changes local ownership
   */
  private createOrganicPatch(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    centerX: number,
    centerY: number
  ): void {
    const tile = grid[centerX][centerY];
    if (!tile) return;

    const neighbors = this.getNeighborTiles(centerX, centerY, gridWidth, gridHeight);
    const neighborKings = neighbors
      .map((n) => grid[n.x][n.y]?.kingId)
      .filter((id): id is number => id !== undefined && id !== null && id !== tile.kingId);

    if (neighborKings.length > 0) {
      const newKing = neighborKings[Math.floor(this.random.random() * neighborKings.length)];
      const patchSize = 1 + Math.floor(this.random.random() * 3); // 1-3 tiles

      // Create small patch
      for (let dx = -patchSize; dx <= patchSize; dx++) {
        for (let dy = -patchSize; dy <= patchSize; dy++) {
          const x = centerX + dx;
          const y = centerY + dy;

          if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
            if (this.random.random() < 0.6) {
              // 60% chance per patch tile
              const existingTile = grid[x][y];
              if (existingTile && existingTile.strength < 0.7) {
                grid[x][y] = {
                  x,
                  y,
                  kingId: newKing,
                  strength: 0.3 + this.random.random() * 0.4,
                  age: 0,
                  contested: false,
                };
              }
            }
          }
        }
      }
    }
  }

  // Helper methods
  private getKingTiles(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kingId: number
  ): TerritoryTile[] {
    const tiles = [];
    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const tile = grid[x][y];
        if (tile && tile.kingId === kingId) {
          tiles.push(tile);
        }
      }
    }
    return tiles;
  }

  private findNearestKing(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    x: number,
    y: number
  ): number | null {
    let nearestKing = null;
    let nearestDistance = Infinity;

    for (let checkX = 0; checkX < gridWidth; checkX++) {
      for (let checkY = 0; checkY < gridHeight; checkY++) {
        const tile = grid[checkX][checkY];
        if (tile && tile.kingId > 0) {
          const distance = Math.abs(x - checkX) + Math.abs(y - checkY);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestKing = tile.kingId;
          }
        }
      }
    }

    return nearestKing;
  }

  private getDistanceToNearestOwnedTile(
    grid: (TerritoryTile | null)[][],
    x: number,
    y: number,
    kingId: number
  ): number {
    let minDistance = Infinity;

    const gridWidth = grid.length;
    const gridHeight = grid[0].length;

    for (let checkX = 0; checkX < gridWidth; checkX++) {
      for (let checkY = 0; checkY < gridHeight; checkY++) {
        const tile = grid[checkX][checkY];
        if (tile && tile.kingId === kingId) {
          const distance = Math.abs(x - checkX) + Math.abs(y - checkY);
          minDistance = Math.min(minDistance, distance);
        }
      }
    }

    return minDistance === Infinity ? 10 : minDistance;
  }

  private getNeighborTiles(
    x: number,
    y: number,
    gridWidth: number,
    gridHeight: number
  ): Array<{ x: number; y: number }> {
    const neighbors = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
          neighbors.push({ x: nx, y: ny });
        }
      }
    }

    return neighbors;
  }

  /**
   * REQUIREMENT 1: Ensure all faction territories are connected
   * Removes isolated islands and connects territories via thin corridors
   */
  private ensureConnectedTerritories(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    for (const king of kings) {
      const territories = this.findTerritoryIslands(grid, gridWidth, gridHeight, king.id);

      if (territories.length > 1) {
        // Connect all islands to the largest one
        const largestIsland = territories.reduce((a, b) => (a.tiles.length > b.tiles.length ? a : b));

        for (const island of territories) {
          if (island !== largestIsland) {
            this.connectTerritoryIslands(grid, gridWidth, gridHeight, largestIsland, island, king.id);
          }
        }

        if (window.debugLogBridge) {
          window.debugLogBridge.log('Territory Connectivity: Fixed islands', 'info', {
            kingId: king.id,
            originalIslands: territories.length,
            connectedIslands: territories.length - 1,
          });
        }
      }
    }
  }

  /**
   * Ensure all territory groups have at least 3 tiles touching
   * This makes the map more cohesive by eliminating tiny isolated clusters
   */
  private enforceMinimumTileGroupSize(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const MIN_GROUP_SIZE = 3;

    for (const king of kings) {
      let changedTiles = 0;
      const territories = this.findTerritoryIslands(grid, gridWidth, gridHeight, king.id);

      for (const island of territories) {
        if (island.tiles.length < MIN_GROUP_SIZE) {
          // This island is too small, need to either expand it or remove it
          const expandedSuccessfully = this.expandSmallTerritoryGroup(
            grid,
            gridWidth,
            gridHeight,
            island,
            king.id,
            MIN_GROUP_SIZE
          );

          if (!expandedSuccessfully) {
            // If we can't expand it, convert it to neutral or give it to a neighbor
            this.convertSmallTerritoryGroup(grid, gridWidth, gridHeight, island, kings);
            changedTiles += island.tiles.length;
          }
        }
      }

      if (changedTiles > 0 && window.debugLogBridge) {
        window.debugLogBridge.log('Territory Cohesion: Enforced minimum group size', 'info', {
          kingId: king.id,
          changedTiles,
          minimumGroupSize: MIN_GROUP_SIZE,
        });
      }
    }
  }

  /**
   * Try to expand a small territory group to meet minimum size
   */
  private expandSmallTerritoryGroup(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    island: { tiles: Array<{ x: number; y: number }>; center: { x: number; y: number } },
    kingId: number,
    targetSize: number
  ): boolean {
    const tilesNeeded = targetSize - island.tiles.length;
    let tilesAdded = 0;

    // Find available adjacent tiles
    const availableTiles: Array<{ x: number; y: number; distance: number }> = [];

    for (const tile of island.tiles) {
      const neighbors = this.getNeighborTiles(tile.x, tile.y, gridWidth, gridHeight);
      for (const neighbor of neighbors) {
        const neighborTile = grid[neighbor.x][neighbor.y];
        if (!neighborTile || neighborTile.kingId === 0) {
          // Calculate distance from island center
          const distance = Math.abs(neighbor.x - island.center.x) + Math.abs(neighbor.y - island.center.y);
          availableTiles.push({ x: neighbor.x, y: neighbor.y, distance });
        }
      }
    }

    // Sort by distance from center (closest first)
    availableTiles.sort((a, b) => a.distance - b.distance);

    // Add tiles up to the target size
    for (const tile of availableTiles.slice(0, tilesNeeded)) {
      grid[tile.x][tile.y] = {
        x: tile.x,
        y: tile.y,
        kingId,
        strength: DynamicTerritoryGeneratorService.TRANSFERRED_TILE_STRENGTH,
        age: 0,
        contested: false,
      };
      tilesAdded++;
    }

    return tilesAdded >= tilesNeeded;
  }

  /**
   * Convert a small territory group to neutral or give it to a neighbor
   */
  private convertSmallTerritoryGroup(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    island: { tiles: Array<{ x: number; y: number }>; center: { x: number; y: number } },
    _kings: KingConfig[]
  ): void {
    // Find the most common neighboring king
    const neighborCounts = new Map<number, number>();

    for (const tile of island.tiles) {
      const neighbors = this.getNeighborTiles(tile.x, tile.y, gridWidth, gridHeight);
      for (const neighbor of neighbors) {
        const neighborTile = grid[neighbor.x][neighbor.y];
        if (neighborTile && neighborTile.kingId !== 0) {
          neighborCounts.set(neighborTile.kingId, (neighborCounts.get(neighborTile.kingId) || 0) + 1);
        }
      }
    }

    // Find the king with the most neighboring tiles
    let bestNeighborKing = 0;
    let maxCount = 0;
    for (const [kingId, count] of Array.from(neighborCounts)) {
      if (count > maxCount) {
        maxCount = count;
        bestNeighborKing = kingId;
      }
    }

    // Convert all tiles in the small group
    for (const tile of island.tiles) {
      if (bestNeighborKing > 0) {
        // Give to the neighboring king
        grid[tile.x][tile.y] = {
          x: tile.x,
          y: tile.y,
          kingId: bestNeighborKing,
          strength: DynamicTerritoryGeneratorService.TRANSFERRED_TILE_STRENGTH,
          age: 0,
          contested: false,
        };
      } else {
        // Make neutral
        grid[tile.x][tile.y] = null;
      }
    }
  }

  /**
   * Find all disconnected territory islands for a king
   */
  private findTerritoryIslands(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kingId: number
  ): Array<{ tiles: Array<{ x: number; y: number }>; center: { x: number; y: number } }> {
    const visited = new Set<string>();
    const islands: Array<{ tiles: Array<{ x: number; y: number }>; center: { x: number; y: number } }> = [];

    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const key = `${x},${y}`;
        if (!visited.has(key) && grid[x]?.[y]?.kingId === kingId) {
          const island = this.floodFillTerritoryIsland(grid, gridWidth, gridHeight, x, y, kingId, visited);
          if (island.length > 0) {
            // Calculate center of this island
            const centerX = Math.round(island.reduce((sum, t) => sum + t.x, 0) / island.length);
            const centerY = Math.round(island.reduce((sum, t) => sum + t.y, 0) / island.length);
            islands.push({ tiles: island, center: { x: centerX, y: centerY } });
          }
        }
      }
    }

    return islands;
  }

  /**
   * Flood fill to find all connected tiles in an island
   */
  private floodFillTerritoryIsland(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    startX: number,
    startY: number,
    kingId: number,
    visited: Set<string>
  ): Array<{ x: number; y: number }> {
    const stack = [{ x: startX, y: startY }];
    const island: Array<{ x: number; y: number }> = [];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      const { x, y } = current;
      const key = `${x},${y}`;

      if (visited.has(key) || x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) {
        continue;
      }

      const tile = grid[x]?.[y];
      if (!tile || tile.kingId !== kingId) {
        continue;
      }

      visited.add(key);
      island.push({ x, y });

      // Add adjacent tiles to stack
      stack.push({ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 });
    }

    return island;
  }

  /**
   * Connect two territory islands with a thin corridor
   */
  private connectTerritoryIslands(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    largestIsland: { tiles: Array<{ x: number; y: number }>; center: { x: number; y: number } },
    smallIsland: { tiles: Array<{ x: number; y: number }>; center: { x: number; y: number } },
    kingId: number
  ): void {
    // Find closest points between islands
    let minDistance = Infinity;
    let closestPair: { from: { x: number; y: number }; to: { x: number; y: number } } | null = null;

    for (const fromTile of smallIsland.tiles) {
      for (const toTile of largestIsland.tiles) {
        const distance = Math.abs(fromTile.x - toTile.x) + Math.abs(fromTile.y - toTile.y);
        if (distance < minDistance) {
          minDistance = distance;
          closestPair = { from: fromTile, to: toTile };
        }
      }
    }

    if (closestPair) {
      // Create a path between the closest points
      this.createTerritoryPath(grid, gridWidth, gridHeight, closestPair.from, closestPair.to, kingId);
    }
  }

  /**
   * Create a path between two points for territory connection
   */
  private createTerritoryPath(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    kingId: number
  ): void {
    let currentX = from.x;
    let currentY = from.y;

    // Create path using A*-like approach (simplified)
    while (currentX !== to.x || currentY !== to.y) {
      // Add current position to territory if not already owned
      if (currentX >= 0 && currentX < gridWidth && currentY >= 0 && currentY < gridHeight) {
        const existingTile = grid[currentX][currentY];
        if (!existingTile || existingTile.kingId !== kingId) {
          grid[currentX][currentY] = {
            x: currentX,
            y: currentY,
            kingId,
            strength: DynamicTerritoryGeneratorService.CONNECTING_PATH_STRENGTH,
            age: 0,
            contested: false,
          };
        }
      }

      // Move towards target
      if (currentX < to.x) currentX++;
      else if (currentX > to.x) currentX--;

      if (currentY < to.y) currentY++;
      else if (currentY > to.y) currentY--;
    }
  }

  /**
   * REQUIREMENT 2: Balance territory distribution within 5% variance
   */
  private balanceTerritoryDistribution(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const totalTiles = gridWidth * gridHeight;
    const targetTilesPerKing = Math.floor(totalTiles / kings.length);
    const tolerance = Math.floor(targetTilesPerKing * DynamicTerritoryGeneratorService.TERRITORY_BALANCE_TOLERANCE);

    // Count current tiles per king
    const kingTileCounts = new Map<number, number>();
    for (const king of kings) {
      kingTileCounts.set(king.id, 0);
    }

    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const tile = grid[x]?.[y];
        if (tile && tile.kingId > 0) {
          kingTileCounts.set(tile.kingId, (kingTileCounts.get(tile.kingId) || 0) + 1);
        }
      }
    }

    // Rebalance territories
    let iteration = 0;

    while (iteration < DynamicTerritoryGeneratorService.MAX_BALANCE_ITERATIONS) {
      let rebalanced = false;

      // Find kings that are over/under the target
      const overKings = kings.filter((k) => (kingTileCounts.get(k.id) || 0) > targetTilesPerKing + tolerance);
      const underKings = kings.filter((k) => (kingTileCounts.get(k.id) || 0) < targetTilesPerKing - tolerance);

      // Don't exit early - continue trying to improve balance
      if (overKings.length === 0 && underKings.length === 0) {
        break; // All kings are within tolerance
      }

      // Transfer tiles from over-kings to under-kings
      for (const overKing of overKings) {
        for (const underKing of underKings) {
          const transferred = this.transferBorderTiles(
            grid,
            gridWidth,
            gridHeight,
            overKing.id,
            underKing.id,
            DynamicTerritoryGeneratorService.MAX_BORDER_TRANSFERS
          );

          if (transferred > 0) {
            kingTileCounts.set(overKing.id, (kingTileCounts.get(overKing.id) || 0) - transferred);
            kingTileCounts.set(underKing.id, (kingTileCounts.get(underKing.id) || 0) + transferred);
            rebalanced = true;
          }
        }
      }

      // Continue even if no transfers happened this iteration
      // Sometimes we need multiple iterations to find transferable tiles
      iteration++;

      // Only break if we've made no progress for several iterations
      if (!rebalanced && iteration > TERRITORY_CONFIG.NO_PROGRESS_ITERATION_LIMIT) {
        break;
      }
    }

    // Second pass: If still imbalanced, do more aggressive transfers
    const finalCounts = Array.from(kingTileCounts.entries());
    const avgTiles = finalCounts.reduce((sum, [_, count]) => sum + count, 0) / finalCounts.length;
    const maxDiff = Math.max(...finalCounts.map(([_, count]) => Math.abs(count - avgTiles)));

    if (maxDiff > tolerance) {
      // Find the most over and under represented kings
      const sortedKings = [...finalCounts].sort((a, b) => b[1] - a[1]);
      const richestKing = sortedKings[0];
      const poorestKing = sortedKings[sortedKings.length - 1];

      // Try a larger transfer between extremes
      const aggressiveTransfer = Math.min(
        Math.floor((richestKing[1] - poorestKing[1]) / 2),
        DynamicTerritoryGeneratorService.MAX_BORDER_TRANSFERS * TERRITORY_CONFIG.AGGRESSIVE_TRANSFER_MULTIPLIER
      );

      const transferred = this.transferBorderTiles(
        grid,
        gridWidth,
        gridHeight,
        richestKing[0],
        poorestKing[0],
        aggressiveTransfer
      );

      if (transferred > 0) {
        kingTileCounts.set(richestKing[0], richestKing[1] - transferred);
        kingTileCounts.set(poorestKing[0], poorestKing[1] + transferred);
      }
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Balance: Completed', 'info', {
        targetTilesPerKing,
        tolerance,
        finalDistribution: Array.from(kingTileCounts.entries()).map(([kingId, count]) => ({
          kingId,
          tileCount: count,
          percentage: ((count / totalTiles) * 100).toFixed(1) + '%',
        })),
        iterations: iteration,
      });
    }
  }

  /**
   * Transfer border tiles from one king to another
   */
  private transferBorderTiles(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    fromKingId: number,
    toKingId: number,
    maxTransfers: number
  ): number {
    let transferred = 0;

    // Find border tiles of fromKing that are adjacent to toKing territory
    const borderTiles: Array<{ x: number; y: number; tile: TerritoryTile }> = [];

    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const tile = grid[x]?.[y];
        if (tile && tile.kingId === fromKingId) {
          // Check if adjacent to toKing territory
          const neighbors = this.getNeighborTiles(x, y, gridWidth, gridHeight);
          const hasToKingNeighbor = neighbors.some((n) => {
            const neighborTile = grid[n.x]?.[n.y];
            return neighborTile && neighborTile.kingId === toKingId;
          });

          if (hasToKingNeighbor) {
            borderTiles.push({ x, y, tile });
          }
        }
      }
    }

    // Transfer the weakest border tiles
    borderTiles
      .sort((a, b) => a.tile.strength - b.tile.strength) // Weakest first
      .slice(0, maxTransfers)
      .forEach(({ x, y }) => {
        const tile = grid[x][y];
        if (tile) {
          tile.kingId = toKingId;
          tile.strength = DynamicTerritoryGeneratorService.TRANSFERRED_TILE_STRENGTH;
        }
        transferred++;
      });

    return transferred;
  }

  /**
   * Final validation and logging of territory generation
   */
  private validateAndLogTerritoryGeneration(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const stats = {
      totalTiles: 0,
      kingStats: [] as Array<{
        kingId: number;
        name: string;
        tileCount: number;
        percentage: number;
        islands: number;
      }>,
    };

    for (const king of kings) {
      const kingTiles = this.getKingTiles(grid, gridWidth, gridHeight, king.id);
      const islands = this.findTerritoryIslands(grid, gridWidth, gridHeight, king.id);

      stats.kingStats.push({
        kingId: king.id,
        name: king.name,
        tileCount: kingTiles.length,
        percentage: (kingTiles.length / (gridWidth * gridHeight)) * 100,
        islands: islands.length,
      });

      stats.totalTiles += kingTiles.length;
    }

    // Create clear text summary for easy debugging
    const textSummary = this.createTerritoryTextSummary(stats, gridWidth, gridHeight);

    if (window.debugLogBridge) {
      window.debugLogBridge.log('Territory Generation: Final Statistics', 'info', {
        gridSize: [gridWidth, gridHeight],
        totalTiles: stats.totalTiles,
        coverage: ((stats.totalTiles / (gridWidth * gridHeight)) * 100).toFixed(1) + '%',
        kingStats: stats.kingStats,
        balanced: this.checkTerritoryBalance(stats.kingStats),
        allConnected: stats.kingStats.every((k) => k.islands <= 1),
        textSummary,
      });

      // Also log the clear text summary separately for easy reading
      window.debugLogBridge.log('Territory Distribution Summary', 'info', {
        message: textSummary,
      });
    }
  }

  /**
   * Create clear text summary for debugging territory distribution
   */
  private createTerritoryTextSummary(
    stats: {
      totalTiles: number;
      kingStats: Array<{
        kingId: number;
        name: string;
        tileCount: number;
        percentage: number;
        islands: number;
      }>;
    },
    gridWidth: number,
    gridHeight: number
  ): string {
    const totalGridTiles = gridWidth * gridHeight;
    const coverage = ((stats.totalTiles / totalGridTiles) * 100).toFixed(1);
    const balanced = this.checkTerritoryBalance(stats.kingStats);
    const allConnected = stats.kingStats.every((k) => k.islands <= 1);

    let summary = `\n🏰 TERRITORY GENERATION COMPLETE 🏰\n`;
    summary += `═══════════════════════════════════════════\n`;
    summary += `📊 Grid Size: ${gridWidth} x ${gridHeight} (${totalGridTiles.toLocaleString()} total tiles)\n`;
    summary += `🗺️  Coverage: ${coverage}% (${stats.totalTiles.toLocaleString()} claimed tiles)\n`;
    summary += `⚖️  Balanced: ${balanced ? '✅ YES' : '❌ NO'} (within ${(DynamicTerritoryGeneratorService.TERRITORY_BALANCE_TOLERANCE * 100).toFixed(1)}% variance)\n`;
    summary += `🔗 Connected: ${allConnected ? '✅ YES' : '❌ NO'} (no isolated islands)\n\n`;

    summary += `👑 FACTION DISTRIBUTION:\n`;
    summary += `─────────────────────────\n`;

    // Sort by percentage for cleaner display
    const sortedStats = [...stats.kingStats].sort((a, b) => b.percentage - a.percentage);

    for (const king of sortedStats) {
      const percentage = king.percentage.toFixed(1);
      const tiles = king.tileCount.toLocaleString();
      const connectionStatus = king.islands <= 1 ? '🔗' : `🏝️ ${king.islands}`;
      const bar = this.createProgressBar(king.percentage, 25);

      summary += `${king.name.padEnd(12)} ${percentage.padStart(5)}% │${bar}│ ${tiles.padStart(8)} tiles ${connectionStatus}\n`;
    }

    summary += `─────────────────────────\n`;

    // Add balance analysis
    if (stats.kingStats.length > 0) {
      const average = stats.kingStats.reduce((sum, k) => sum + k.tileCount, 0) / stats.kingStats.length;
      const minTiles = Math.min(...stats.kingStats.map((k) => k.tileCount));
      const maxTiles = Math.max(...stats.kingStats.map((k) => k.tileCount));
      const variance = ((maxTiles - minTiles) / average) * 100;

      summary += `📈 Average: ${average.toFixed(0)} tiles per faction\n`;
      summary += `📉 Range: ${minTiles.toLocaleString()} - ${maxTiles.toLocaleString()} tiles\n`;
      summary += `📊 Variance: ${variance.toFixed(1)}% (target: <${(DynamicTerritoryGeneratorService.TERRITORY_BALANCE_TOLERANCE * 100).toFixed(1)}%)\n`;
    }

    summary += `═══════════════════════════════════════════`;

    return summary;
  }

  /**
   * Create ASCII progress bar for percentage display
   */
  private createProgressBar(percentage: number, width: number): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * Check if territories are balanced within 5% variance
   */
  private checkTerritoryBalance(kingStats: Array<{ tileCount: number }>): boolean {
    if (kingStats.length === 0) return true;

    const average = kingStats.reduce((sum, k) => sum + k.tileCount, 0) / kingStats.length;
    const tolerance = average * DynamicTerritoryGeneratorService.TERRITORY_BALANCE_TOLERANCE;

    return kingStats.every((k) => Math.abs(k.tileCount - average) <= tolerance);
  }

  /**
   * Aggressive island consolidation to prevent extreme fragmentation (164+ islands)
   * This method runs BEFORE balance algorithm to ensure territories are coherent
   */
  private consolidateTerritoryIslandsAggressive(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🏝️ Starting aggressive island consolidation', 'info', {
        source: 'dynamic_territory_generator',
        operation: 'consolidate_islands_aggressive',
        minIslandSize: DynamicTerritoryGeneratorService.MIN_ISLAND_SIZE,
      });
    }

    for (const king of kings) {
      let consolidationRounds = 0;
      let totalMerged = 0;
      let previousIslandCount = -1;

      // Keep consolidating until we stop making progress
      while (consolidationRounds < 10) {
        const islands = this.findTerritoryIslands(grid, gridWidth, gridHeight, king.id);

        // Stop if we're not making progress
        if (islands.length === previousIslandCount) {
          break;
        }
        previousIslandCount = islands.length;

        if (islands.length <= 1) {
          break; // Already consolidated
        }

        // Sort islands by size (largest first)
        islands.sort((a, b) => b.tiles.length - a.tiles.length);

        // Find the largest island as the main landmass
        const mainIsland = islands[0];
        let mergedThisRound = 0;

        // Try to merge all smaller islands into the main island or each other
        for (let i = 1; i < islands.length; i++) {
          const smallIsland = islands[i];

          // If island is too small, it MUST be merged
          if (smallIsland.tiles.length < DynamicTerritoryGeneratorService.MIN_ISLAND_SIZE) {
            // Find the nearest larger island
            let nearestIsland = mainIsland;
            let minDistance = this.getIslandDistance(mainIsland, smallIsland);

            // Check if another island is closer
            for (let j = 0; j < i; j++) {
              const distance = this.getIslandDistance(islands[j], smallIsland);
              if (distance < minDistance) {
                minDistance = distance;
                nearestIsland = islands[j];
              }
            }

            // Aggressively connect the islands
            const connected = this.connectIslandsAggressive(
              grid,
              gridWidth,
              gridHeight,
              nearestIsland,
              smallIsland,
              king.id
            );

            if (connected) {
              mergedThisRound++;
              totalMerged++;
            } else {
              // If we can't connect, absorb the small island into nearest territory
              this.absorbSmallIsland(grid, gridWidth, gridHeight, smallIsland, king.id);
              mergedThisRound++;
              totalMerged++;
            }
          }
        }

        consolidationRounds++;

        if (mergedThisRound === 0) {
          break; // No more merges possible
        }
      }

      // Final pass: Ensure no tiny islands remain
      const finalIslands = this.findTerritoryIslands(grid, gridWidth, gridHeight, king.id);
      for (const island of finalIslands) {
        if (island.tiles.length < DynamicTerritoryGeneratorService.MIN_ISLAND_SIZE && finalIslands.length > 1) {
          this.absorbSmallIsland(grid, gridWidth, gridHeight, island, king.id);
        }
      }

      if (window.debugLogBridge && totalMerged > 0) {
        const finalIslandCount = this.findTerritoryIslands(grid, gridWidth, gridHeight, king.id).length;
        window.debugLogBridge.log(`✅ Consolidated ${king.name} territories`, 'info', {
          source: 'dynamic_territory_generator',
          operation: 'consolidation_complete',
          kingId: king.id,
          kingName: king.name,
          initialIslands: previousIslandCount,
          finalIslands: finalIslandCount,
          islandsMerged: totalMerged,
          consolidationRounds,
        });
      }
    }
  }

  /**
   * Calculate minimum distance between two islands
   */
  private getIslandDistance(
    islandA: { tiles: Array<{ x: number; y: number }> },
    islandB: { tiles: Array<{ x: number; y: number }> }
  ): number {
    let minDistance = Infinity;

    for (const tileA of islandA.tiles) {
      for (const tileB of islandB.tiles) {
        const distance = Math.abs(tileA.x - tileB.x) + Math.abs(tileA.y - tileB.y);
        minDistance = Math.min(minDistance, distance);
      }
    }

    return minDistance;
  }

  /**
   * Aggressively connect two islands with a wide corridor
   */
  private connectIslandsAggressive(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    islandA: { tiles: Array<{ x: number; y: number }> },
    islandB: { tiles: Array<{ x: number; y: number }> },
    kingId: number
  ): boolean {
    // Find closest points between islands
    let closestPair: { from: { x: number; y: number }; to: { x: number; y: number }; distance: number } | null = null;
    let minDistance = Infinity;

    for (const tileA of islandA.tiles) {
      for (const tileB of islandB.tiles) {
        const distance = Math.abs(tileA.x - tileB.x) + Math.abs(tileA.y - tileB.y);
        if (distance < minDistance) {
          minDistance = distance;
          closestPair = { from: tileA, to: tileB, distance };
        }
      }
    }

    if (!closestPair || closestPair.distance > 50) {
      return false; // Islands too far apart
    }

    // Create a wider corridor (3 tiles wide) to ensure good connectivity
    const corridorWidth = 3;
    this.createWideCorridor(grid, gridWidth, gridHeight, closestPair.from, closestPair.to, kingId, corridorWidth);

    return true;
  }

  /**
   * Create a wide corridor between two points
   */
  private createWideCorridor(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    kingId: number,
    width: number
  ): void {
    // Use Bresenham's line algorithm for the main path
    const points = this.getLinePoints(from.x, from.y, to.x, to.y);

    // Widen the corridor
    for (const point of points) {
      for (let dx = -Math.floor(width / 2); dx <= Math.floor(width / 2); dx++) {
        for (let dy = -Math.floor(width / 2); dy <= Math.floor(width / 2); dy++) {
          const x = point.x + dx;
          const y = point.y + dy;

          if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
            // Only overwrite if empty or belongs to a different small faction
            const existing = grid[x][y];
            if (!existing || existing.kingId !== kingId) {
              grid[x][y] = {
                x,
                y,
                kingId,
                strength: DynamicTerritoryGeneratorService.CONSOLIDATION_STRENGTH,
                age: 0,
                contested: false,
              };
            }
          }
        }
      }
    }
  }

  /**
   * Get all points along a line using Bresenham's algorithm
   */
  private getLinePoints(x0: number, y0: number, x1: number, y1: number): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    let x = x0;
    let y = y0;

    while (true) {
      points.push({ x, y });

      if (x === x1 && y === y1) break;

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }

    return points;
  }

  /**
   * Absorb a small island by expanding nearby territories
   */
  private absorbSmallIsland(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    island: { tiles: Array<{ x: number; y: number }> },
    currentKingId: number
  ): void {
    // For each tile in the small island, give it to the nearest neighboring territory
    for (const tile of island.tiles) {
      const neighbors = this.getNeighborTiles(tile.x, tile.y, gridWidth, gridHeight);

      // Find the most common neighboring king (excluding current king)
      const neighborKings = new Map<number, number>();

      for (const neighbor of neighbors) {
        const neighborTile = grid[neighbor.x]?.[neighbor.y];
        if (neighborTile && neighborTile.kingId !== currentKingId) {
          neighborKings.set(neighborTile.kingId, (neighborKings.get(neighborTile.kingId) || 0) + 1);
        }
      }

      // If surrounded by other kings, give to the most common one
      if (neighborKings.size > 0) {
        let bestKing = currentKingId;
        let maxCount = 0;

        for (const [kingId, count] of Array.from(neighborKings)) {
          if (count > maxCount) {
            maxCount = count;
            bestKing = kingId;
          }
        }

        grid[tile.x][tile.y] = {
          x: tile.x,
          y: tile.y,
          kingId: bestKing,
          strength: DynamicTerritoryGeneratorService.TRANSFERRED_TILE_STRENGTH,
          age: 0,
          contested: false,
        };
      }
    }
  }

  /**
   * Fill small gaps between territories of the same king
   */
  private fillSmallTerritoryGaps(
    grid: (TerritoryTile | null)[][],
    gridWidth: number,
    gridHeight: number,
    kings: KingConfig[]
  ): void {
    const maxGapSize = DynamicTerritoryGeneratorService.MAX_GAP_SIZE;
    let totalFilled = 0;

    for (const king of kings) {
      let filledForKing = 0;

      // Find all empty tiles that are surrounded mostly by this king's territory
      for (let x = 0; x < gridWidth; x++) {
        for (let y = 0; y < gridHeight; y++) {
          const tile = grid[x][y];
          if (!tile || tile.kingId !== king.id) {
            continue;
          }

          // Check for gaps in all directions
          for (let distance = 1; distance <= maxGapSize; distance++) {
            // Check horizontal gap
            if (x + distance + 1 < gridWidth) {
              const farTile = grid[x + distance + 1]?.[y];
              if (farTile && farTile.kingId === king.id) {
                // Fill the gap
                for (let gx = x + 1; gx <= x + distance; gx++) {
                  const gapTile = grid[gx][y];
                  if (!gapTile || gapTile.kingId !== king.id) {
                    grid[gx][y] = {
                      x: gx,
                      y,
                      kingId: king.id,
                      strength: DynamicTerritoryGeneratorService.CONSOLIDATION_STRENGTH,
                      age: 0,
                      contested: false,
                    };
                    filledForKing++;
                  }
                }
              }
            }

            // Check vertical gap
            if (y + distance + 1 < gridHeight) {
              const farTile = grid[x]?.[y + distance + 1];
              if (farTile && farTile.kingId === king.id) {
                // Fill the gap
                for (let gy = y + 1; gy <= y + distance; gy++) {
                  const gapTile = grid[x][gy];
                  if (!gapTile || gapTile.kingId !== king.id) {
                    grid[x][gy] = {
                      x,
                      y: gy,
                      kingId: king.id,
                      strength: DynamicTerritoryGeneratorService.CONSOLIDATION_STRENGTH,
                      age: 0,
                      contested: false,
                    };
                    filledForKing++;
                  }
                }
              }
            }
          }
        }
      }

      if (filledForKing > 0) {
        totalFilled += filledForKing;

        if (window.debugLogBridge) {
          window.debugLogBridge.log(`🔧 Filled ${filledForKing} gap tiles for ${king.name}`, 'info', {
            source: 'dynamic_territory_generator',
            operation: 'fill_small_gaps',
            kingId: king.id,
            kingName: king.name,
            tilesFilled: filledForKing,
          });
        }
      }
    }

    if (totalFilled > 0 && window.debugLogBridge) {
      window.debugLogBridge.log(`✅ Gap filling complete: ${totalFilled} total tiles filled`, 'info', {
        source: 'dynamic_territory_generator',
        operation: 'gap_filling_complete',
        totalTilesFilled: totalFilled,
        maxGapSize,
      });
    }
  }
}
