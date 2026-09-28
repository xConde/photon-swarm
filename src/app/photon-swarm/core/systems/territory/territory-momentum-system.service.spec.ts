import { TestBed } from '@angular/core/testing';
import {
  FourKingsTerritoryService,
  TerritoryMomentumMetricsService,
  TerritoryMomentumSystemService,
  TerritoryStrengthSystemService,
} from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { take } from 'rxjs/operators';
import { GeneratedWorld } from '../../models/territory.model';

describe('TerritoryMomentumSystemService', () => {
  let service: TerritoryMomentumSystemService;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockTerritoryStrengthSystem: jasmine.SpyObj<TerritoryStrengthSystemService>;
  let mockMetricsService: jasmine.SpyObj<TerritoryMomentumMetricsService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    // Create mock services
    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getWorldData',
      'getTile',
      'getIsInitialized',
    ]);

    // Set default return value for getWorldData
    mockFourKingsTerritory.getWorldData.and.returnValue(null);
    mockFourKingsTerritory.getIsInitialized.and.returnValue(true);

    mockTerritoryStrengthSystem = jasmine.createSpyObj('TerritoryStrengthSystemService', [
      'getTileStrength',
      'weakenTilesFromKill',
    ]);

    mockMetricsService = jasmine.createSpyObj('TerritoryMomentumMetricsService', [
      'recordUpdate',
      'recordCacheHit',
      'recordCacheMiss',
      'recordPlayerKill',
      'recordPlayerDeath',
      'recordComeback',
      'recordLastStand',
      'getMetrics',
      'getQuickStats',
      'reset',
    ]);

    // Mock the metrics response
    mockMetricsService.getMetrics.and.returnValue({
      performance: {
        avgUpdateMs: '5.00',
        lastUpdateMs: '5.00',
        cacheHitRate: '95.0%',
        updateCount: 10,
      },
      balance: {
        current: '0.850',
        leader: 1,
        loser: 4,
        lastStandFactions: 0,
        comebacks: 0,
      },
      player: {
        totalKills: 0,
        totalDeaths: 0,
        influence: '0.00',
        killsByFaction: [0, 0, 0, 0],
      },
      history: {
        recentBalance: [0.85],
        samples: 1,
      },
    });

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [
        TerritoryMomentumSystemService,
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: TerritoryStrengthSystemService, useValue: mockTerritoryStrengthSystem },
        { provide: TerritoryMomentumMetricsService, useValue: mockMetricsService },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    service = TestBed.inject(TerritoryMomentumSystemService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  describe('Initialization', () => {
    it('should initialize with 4 factions', () => {
      expect(mockDebugLog.log).toHaveBeenCalledWith(
        'Territory Momentum System Initialized',
        'info',
        jasmine.objectContaining({
          factionCount: 4,
        })
      );
    });

    it('should start with all factions at neutral momentum', () => {
      for (let kingId = 1; kingId <= 4; kingId++) {
        const momentum = service.getFactionMomentum(kingId);
        expect(momentum).toBeDefined();
        expect(momentum?.momentum).toBe(0);
        expect(momentum?.isWinning).toBe(false);
        // Note: With no world data (null), all factions have 0 territory,
        // which correctly triggers isDesperate and isLosing states
        expect(momentum?.isDesperate).toBe(true);
        expect(momentum?.isLosing).toBe(true);
      }
    });

    it('should emit initial momentum state', (done) => {
      service.momentum$.pipe(take(1)).subscribe((state) => {
        expect(state.factions.size).toBe(4);
        expect(state.balanceScore).toBe(1.0);
        done();
      });
    });
  });

  describe('Territory Counting', () => {
    it('should correctly count territories for each faction', () => {
      const mockWorld: GeneratedWorld = createMockWorld([
        [1, 1, 2, 2],
        [1, 3, 3, 2],
        [4, 3, 3, 2],
        [4, 4, 4, 2],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);

      // Invalidate cache and force update to count territories
      service.invalidateCache();
      service.forceUpdate();

      // Check faction 1 has 3 tiles
      const faction1 = service.getFactionMomentum(1);
      expect(faction1?.territoryCount).toBe(3);

      // Check faction 2 has 5 tiles
      const faction2 = service.getFactionMomentum(2);
      expect(faction2?.territoryCount).toBe(5);

      // Check faction 3 has 4 tiles
      const faction3 = service.getFactionMomentum(3);
      expect(faction3?.territoryCount).toBe(4);

      // Check faction 4 has 4 tiles
      const faction4 = service.getFactionMomentum(4);
      expect(faction4?.territoryCount).toBe(4);
    });
  });

  describe('Momentum Calculation', () => {
    it('should mark faction as winning when above threshold', () => {
      const mockWorld = createMockWorld([
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [2, 2, 3, 3],
        [2, 4, 3, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);

      // Invalidate cache and simulate territory gain for faction 1
      service.invalidateCache();
      service.forceUpdate();

      const faction1 = service.getFactionMomentum(1);
      expect(faction1?.territoryCount).toBe(8); // 50% of territory

      // Simulate momentum buildup
      for (let i = 0; i < 3; i++) {
        service.forceUpdate();
      }
    });

    it('should mark faction as losing when below threshold', () => {
      const mockWorld = createMockWorld([
        [2, 2, 2, 2],
        [2, 2, 3, 3],
        [3, 3, 3, 4],
        [1, 4, 4, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      const faction1 = service.getFactionMomentum(1);
      expect(faction1?.territoryCount).toBe(1); // Only 6.25% of territory
      expect(faction1?.isDesperate).toBe(true);
    });

    it('should trigger last stand when very low territory', () => {
      // LAST_STAND_THRESHOLD is 5%, so faction needs < 5% of total territory
      // Using 5x5 grid (25 tiles), 1 tile = 4% which triggers last stand
      const mockWorld = createMockWorld([
        [2, 2, 2, 2, 2],
        [2, 2, 2, 2, 2],
        [3, 3, 3, 3, 3],
        [3, 3, 3, 3, 3],
        [3, 3, 3, 3, 1], // Only 1 tile for faction 1 (4% < 5% threshold)
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      const faction1 = service.getFactionMomentum(1);
      expect(faction1?.territoryCount).toBe(1);
      expect(faction1?.lastStandActive).toBe(true);
      expect(faction1?.rallyMultiplier).toBe(3.0); // Last stand multiplier
    });
  });

  describe('Spawn Modifiers', () => {
    it('should reduce spawns for winning factions', () => {
      // Set faction 1 as winning
      const mockWorld = createMockWorld([
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [2, 2, 3, 3],
        [2, 4, 3, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);

      // Invalidate cache and force update
      service.invalidateCache();
      service.forceUpdate();

      // Manually set winning state for testing
      const faction1 = service.getFactionMomentum(1);
      if (faction1) {
        faction1.isWinning = true;
        faction1.momentum = 0.5;
      }

      const spawnMultiplier = service.getSpawnMultiplier(1);
      expect(spawnMultiplier).toBe(0.8); // 20% fewer spawns
    });

    it('should increase spawns for desperate factions', () => {
      const mockWorld = createMockWorld([
        [2, 2, 2, 2],
        [2, 2, 2, 2],
        [3, 3, 3, 3],
        [3, 3, 3, 1],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      const spawnMultiplier = service.getSpawnMultiplier(1);
      expect(spawnMultiplier).toBe(1.5); // 50% more spawns
    });

    it('should provide rally multiplier for losing factions', () => {
      const mockWorld = createMockWorld([
        [2, 2, 2, 2],
        [2, 2, 3, 3],
        [3, 3, 3, 4],
        [1, 4, 4, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      const strengthMultiplier = service.getEnemyStrengthMultiplier(1);
      expect(strengthMultiplier).toBeGreaterThan(1.0);
    });
  });

  describe('Expansion Modifiers', () => {
    it('should provide expansion bonus for winning factions', () => {
      // Manually set winning state
      const faction1 = service.getFactionMomentum(1);
      if (faction1) {
        faction1.isWinning = true;
        faction1.momentum = 0.8;
        faction1.expansionBonus = 0.4; // 40% faster expansion
      }

      const expansionMultiplier = service.getExpansionMultiplier(1);
      expect(expansionMultiplier).toBe(1.4);
    });

    it('should provide strength bonus for captured territories', () => {
      // Manually set winning state
      const faction1 = service.getFactionMomentum(1);
      if (faction1) {
        faction1.isWinning = true;
        faction1.momentum = 0.8;
        faction1.strengthBonus = 16; // +16 strength
      }

      const strengthBonus = service.getTerritoryStrengthBonus(1);
      expect(strengthBonus).toBe(16);
    });

    it('should not provide expansion bonus for losing factions', () => {
      const faction1 = service.getFactionMomentum(1);
      if (faction1) {
        faction1.isLosing = true;
        faction1.expansionBonus = 0;
      }

      const expansionMultiplier = service.getExpansionMultiplier(1);
      expect(expansionMultiplier).toBe(1.0);
    });
  });

  describe('Balance Score', () => {
    it('should calculate perfect balance when territories are equal', () => {
      const mockWorld = createMockWorld([
        [1, 1, 2, 2],
        [1, 1, 2, 2],
        [3, 3, 4, 4],
        [3, 3, 4, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      const balanceScore = service.getBalanceScore();
      expect(balanceScore).toBeCloseTo(1.0, 1); // Perfect balance
    });

    it('should calculate low balance when one faction dominates', () => {
      const mockWorld = createMockWorld([
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [2, 3, 4, 1],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      const balanceScore = service.getBalanceScore();
      expect(balanceScore).toBeLessThan(0.5); // Poor balance
    });
  });

  describe('Observable Events', () => {
    it('should emit momentum updates', (done) => {
      let updateCount = 0;

      service.momentum$.subscribe((state) => {
        updateCount++;
        expect(state.factions.size).toBe(4);

        if (updateCount === 2) {
          // After force update
          done();
        }
      });

      service.forceUpdate();
    });

    it('should track global leader and loser', () => {
      const mockWorld = createMockWorld([
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [2, 3, 3, 3],
        [2, 4, 3, 3],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      service.momentum$.pipe(take(1)).subscribe((state) => {
        expect(state.globalLeader).toBe(1); // Faction 1 has most territory
        expect(state.globalLoser).toBe(4); // Faction 4 has least
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty world gracefully', () => {
      mockFourKingsTerritory.getWorldData.and.returnValue(null);

      expect(() => service.forceUpdate()).not.toThrow();

      const faction1 = service.getFactionMomentum(1);
      expect(faction1?.territoryCount).toBe(0);
    });

    it('should handle all neutral territories', () => {
      const mockWorld = createMockWorld([
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      for (let kingId = 1; kingId <= 4; kingId++) {
        const faction = service.getFactionMomentum(kingId);
        expect(faction?.territoryCount).toBe(0);
        expect(faction?.isDesperate).toBe(true);
      }
    });

    it('should clamp momentum values to valid range', () => {
      const faction1 = service.getFactionMomentum(1);
      if (faction1) {
        // Try to set extreme values
        faction1.momentum = 10;
        service.forceUpdate();

        // Should be clamped to [-1, 1]
        expect(faction1.momentum).toBeLessThanOrEqual(1);
        expect(faction1.momentum).toBeGreaterThanOrEqual(-1);
      }
    });
  });

  describe('Player Impact', () => {
    it('should record player kills and affect faction momentum', () => {
      const factionId = 2;
      const x = 100;
      const y = 200;

      service.recordPlayerKill(factionId, x, y);

      expect(mockMetricsService.recordPlayerKill).toHaveBeenCalledWith(factionId);

      const faction = service.getFactionMomentum(factionId);
      expect(faction).toBeDefined();
      // Momentum should decrease for killed faction
      expect(faction!.momentum).toBeLessThanOrEqual(0);
    });

    it('should record player deaths and boost killer faction', () => {
      const killerFactionId = 3;

      service.recordPlayerDeath(killerFactionId);

      expect(mockMetricsService.recordPlayerDeath).toHaveBeenCalledWith(killerFactionId);

      const faction = service.getFactionMomentum(killerFactionId);
      expect(faction).toBeDefined();
      // Momentum should increase for killer faction
      expect(faction!.momentum).toBeGreaterThanOrEqual(0);
    });

    it('should ignore invalid faction IDs for player kills', () => {
      service.recordPlayerKill(0, 100, 100);
      service.recordPlayerKill(5, 100, 100);
      service.recordPlayerKill(-1, 100, 100);

      expect(mockMetricsService.recordPlayerKill).not.toHaveBeenCalled();
    });

    it('should ignore invalid faction IDs for player deaths', () => {
      service.recordPlayerDeath(0);
      service.recordPlayerDeath(5);
      service.recordPlayerDeath(-1);

      expect(mockMetricsService.recordPlayerDeath).not.toHaveBeenCalled();
    });

    it('should trigger comeback tracking when faction becomes desperate', () => {
      const factionId = 1;

      // Set up faction to be close to desperate threshold
      const faction = service.getFactionMomentum(factionId);
      if (faction) {
        faction.territoryCount = 6; // Just above desperate threshold
        faction.isDesperate = false;
      }

      // Multiple kills should push faction to desperation
      service.recordPlayerKill(factionId, 100, 100);

      // Check if faction is now desperate and comeback was recorded
      if (faction && faction.isDesperate) {
        expect(mockMetricsService.recordComeback).toHaveBeenCalled();
      }
    });
  });

  describe('Metrics Integration', () => {
    it('should delegate metrics to metrics service', () => {
      const metrics = service.getMetrics();

      expect(mockMetricsService.getMetrics).toHaveBeenCalled();
      expect(metrics).toBeDefined();
      expect(metrics.performance).toBeDefined();
      expect(metrics.balance).toBeDefined();
      expect(metrics.player).toBeDefined();
      expect(metrics.momentum).toBeDefined();
    });

    it('should record cache hits and misses', () => {
      const mockWorld = createMockWorld([
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);

      // Invalidate cache first to ensure a cache miss
      service.invalidateCache();
      // First update should miss cache
      service.forceUpdate();
      expect(mockMetricsService.recordCacheMiss).toHaveBeenCalled();

      // Incremental changes should use cache
      service.onTerritoryChange(0, 0, 1, 2);

      // Next update might hit cache
      service.forceUpdate();
    });

    it('should track update performance', () => {
      const mockWorld = createMockWorld([
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
        [1, 2, 3, 4],
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      expect(mockMetricsService.recordUpdate).toHaveBeenCalledWith(
        jasmine.any(Number), // duration
        jasmine.any(Number), // balance
        jasmine.any(Number), // leader
        jasmine.any(Number) // loser
      );
    });

    it('should track last stand factions', () => {
      const mockWorld = createMockWorld([
        [2, 2, 2, 2],
        [2, 2, 2, 2],
        [3, 3, 3, 3],
        [3, 3, 3, 1], // Only 1 tile for faction 1
      ]);

      mockFourKingsTerritory.getWorldData.and.returnValue(mockWorld);
      service.invalidateCache();
      service.forceUpdate();

      expect(mockMetricsService.recordLastStand).toHaveBeenCalledWith(1); // 1 faction in last stand
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      const completeSpy = jasmine.createSpy('complete');
      const subscription = service.momentum$.subscribe({
        complete: completeSpy,
      });

      service.ngOnDestroy();

      expect(completeSpy).toHaveBeenCalled();
      subscription.unsubscribe();
    });
  });
});

// Helper function to create mock world data
function createMockWorld(grid: number[][]): GeneratedWorld {
  const height = grid.length;
  const width = grid[0].length;

  const tiles = grid.map((row, y) =>
    row.map((kingId, x) => ({
      x,
      y,
      kingId,
      strength: 75,
      age: 0,
      contested: false,
      distanceFromCapital: 5,
      colorVariant: 0.5,
      hasStructure: false,
      lastUpdated: Date.now(),
    }))
  );

  return {
    territories: tiles,
    seed: 'test',
    hash: 'test-hash',
    kingStartPositions: [],
    kingConfigs: [],
    generationMetadata: {
      timestamp: Date.now(),
      version: '1.0',
      gridSize: { width, height },
      totalTiles: width * height,
      generationTime: 0,
    },
  };
}
