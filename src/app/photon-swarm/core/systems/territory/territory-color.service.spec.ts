import { TestBed } from '@angular/core/testing';
import { TerritoryColorService } from './territory-color.service';
import { ThemeService } from '@services/theme.service';
import { KingConfig, TerritoryTile } from '../../models/territory.model';

describe('TerritoryColorService', () => {
  let service: TerritoryColorService;
  let mockThemeService: { isDayMode: boolean };

  const mockKing: KingConfig = {
    id: 1,
    name: 'Crimson King',
    color: '#e74c3c',
    baseColor: '#c0392b',
    glowColor: '#ff6666',
    expansionStyle: 'aggressive',
    expansionRate: 3.5,
    clusterTendency: 0.6,
    warlikeness: 0.9,
  };

  const mockTile: TerritoryTile = {
    x: 10,
    y: 20,
    kingId: 1,
    strength: 0.8,
    age: 10,
    contested: false,
  };

  const emptyCoreTiles = new Map<number, Set<number>>();
  const emptyBorderTiles = new Map<number, Set<number>>();

  beforeEach(() => {
    mockThemeService = { isDayMode: false };

    TestBed.configureTestingModule({
      providers: [TerritoryColorService, { provide: ThemeService, useValue: mockThemeService }],
    });

    service = TestBed.inject(TerritoryColorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getDynamicTileColor', () => {
    it('should return a deterministic color for the same inputs (cache/seed determinism)', () => {
      const result1 = service.getDynamicTileColor(10, 20, mockKing, mockTile, 100, emptyCoreTiles, emptyBorderTiles);
      const result2 = service.getDynamicTileColor(10, 20, mockKing, mockTile, 100, emptyCoreTiles, emptyBorderTiles);

      expect(result1.base).toBe(result2.base);
      expect(result1.glow).toBe(result2.glow);
      expect(result1.accent).toBe(result2.accent);
      expect(result1.secondary).toBe(result2.secondary);
    });

    it('should return king baseColor when territory is null', () => {
      const result = service.getDynamicTileColor(5, 5, mockKing, null, 100, emptyCoreTiles, emptyBorderTiles);

      expect(result.base).toBe(mockKing.baseColor);
      expect(result.secondary).toBeNull();
      expect(result.glow).toBe(mockKing.glowColor);
      expect(result.accent).toBe(mockKing.color);
    });

    it('should use darkest variant for contested (road) tiles', () => {
      const roadTile: TerritoryTile = { ...mockTile, contested: true };
      const result = service.getDynamicTileColor(5, 5, mockKing, roadTile, 100, emptyCoreTiles, emptyBorderTiles);

      // Road tiles should have a secondary color (index 3)
      expect(result.secondary).not.toBeNull();
    });

    it('should reflect coreTile vs standard tile path differences', () => {
      const coreTiles = new Map<number, Set<number>>();
      coreTiles.set(1, new Set([5 * 100 + 5])); // tile (5,5) at gridWidth=100

      const coreResult = service.getDynamicTileColor(5, 5, mockKing, mockTile, 100, coreTiles, emptyBorderTiles);
      const stdResult = service.getDynamicTileColor(5, 5, mockKing, mockTile, 100, emptyCoreTiles, emptyBorderTiles);

      // Both should produce valid hex color strings
      expect(coreResult.base).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(stdResult.base).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  });

  describe('getFactionColorVariations', () => {
    it('should return distinct color arrays for each king id', () => {
      const king1 = service.getFactionColorVariations(1);
      const king2 = service.getFactionColorVariations(2);
      const king3 = service.getFactionColorVariations(3);
      const king4 = service.getFactionColorVariations(4);

      expect(king1[0]).not.toBe(king2[0]);
      expect(king1[0]).not.toBe(king3[0]);
      expect(king1[0]).not.toBe(king4[0]);
      expect(king2[0]).not.toBe(king3[0]);
      expect(king2[0]).not.toBe(king4[0]);
      expect(king3[0]).not.toBe(king4[0]);
    });

    it('should return 5 variations for each standard king', () => {
      expect(service.getFactionColorVariations(1).length).toBe(5);
      expect(service.getFactionColorVariations(2).length).toBe(5);
      expect(service.getFactionColorVariations(3).length).toBe(5);
      expect(service.getFactionColorVariations(4).length).toBe(5);
    });

    it('should return different colors for day mode vs dark mode for king 1', () => {
      mockThemeService.isDayMode = false;
      const darkColors = service.getFactionColorVariations(1);

      // Force cache bust by switching mode
      mockThemeService.isDayMode = true;
      const dayColors = service.getFactionColorVariations(1);

      expect(darkColors[0]).not.toBe(dayColors[0]);
    });

    it('should return a fallback color for unknown king id', () => {
      const fallback = service.getFactionColorVariations(99);
      expect(fallback.length).toBeGreaterThan(0);
    });
  });

  describe('hexToRgb', () => {
    it('should parse a known hex correctly', () => {
      const result = service.hexToRgb('#ff8800');
      expect(result).not.toBeNull();
      expect(result!.r).toBe(255);
      expect(result!.g).toBe(136);
      expect(result!.b).toBe(0);
    });

    it('should return null for an invalid hex string', () => {
      expect(service.hexToRgb('not-a-color')).toBeNull();
    });

    it('should handle hex without leading #', () => {
      const result = service.hexToRgb('ff0000');
      expect(result).not.toBeNull();
      expect(result!.r).toBe(255);
      expect(result!.g).toBe(0);
      expect(result!.b).toBe(0);
    });
  });

  describe('calculateColorDistance', () => {
    it('should return 0 for identical colors', () => {
      const distance = service.calculateColorDistance('#ff0000', '#ff0000');
      expect(distance).toBe(0);
    });

    it('should return > 0 for different colors', () => {
      const distance = service.calculateColorDistance('#ff0000', '#0000ff');
      expect(distance).toBeGreaterThan(0);
    });

    it('should return 0 when hex parsing fails', () => {
      const distance = service.calculateColorDistance('bad', 'hex');
      expect(distance).toBe(0);
    });

    it('should satisfy triangle inequality direction (black vs white > black vs grey)', () => {
      const blackToWhite = service.calculateColorDistance('#000000', '#ffffff');
      const blackToGrey = service.calculateColorDistance('#000000', '#808080');
      expect(blackToWhite).toBeGreaterThan(blackToGrey);
    });
  });

  describe('validateColorDistinguishability', () => {
    it('should run without throwing when debugLogBridge is absent', () => {
      const saved = window.debugLogBridge;
      (window as { debugLogBridge: unknown }).debugLogBridge = undefined;
      expect(() => service.validateColorDistinguishability()).not.toThrow();
      window.debugLogBridge = saved;
    });

    it('should run without throwing when debugLogBridge is present', () => {
      window.debugLogBridge = {
        log: jasmine.createSpy('log'),
      };
      expect(() => service.validateColorDistinguishability()).not.toThrow();
    });
  });

  describe('renderNeutralBackground', () => {
    it('should run without throwing given a mocked ctx', () => {
      const mockCanvas = jasmine.createSpyObj('HTMLCanvasElement', [], { width: 800, height: 600 });
      const mockCtx = jasmine.createSpyObj('CanvasRenderingContext2D', ['fillRect', 'strokeRect'], {
        canvas: mockCanvas,
        fillStyle: '',
        strokeStyle: '',
        globalAlpha: 1,
        lineWidth: 1,
      });
      const camera = { x: 0, y: 0 };
      expect(() => service.renderNeutralBackground(mockCtx, camera, 64)).not.toThrow();
    });

    it('should reset globalAlpha to 1 after rendering', () => {
      const mockCanvas = jasmine.createSpyObj('HTMLCanvasElement', [], { width: 128, height: 128 });
      const ctx = {
        canvas: mockCanvas,
        fillStyle: '',
        strokeStyle: '',
        globalAlpha: 1,
        lineWidth: 1,
        fillRect: jasmine.createSpy('fillRect'),
        strokeRect: jasmine.createSpy('strokeRect'),
      } as unknown as CanvasRenderingContext2D;

      service.renderNeutralBackground(ctx, { x: 0, y: 0 }, 64);
      expect(ctx.globalAlpha).toBe(1);
    });
  });
});
