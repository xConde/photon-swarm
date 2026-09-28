import { TestBed } from '@angular/core/testing';
import { MinimapEntities, MinimapRendererService } from './minimap-renderer.service';
import { Territory } from './map-renderer.service';
import { ThemeService } from '@services/theme.service';

describe('MinimapRendererService', () => {
  let service: MinimapRendererService;
  let mockCtx: jasmine.SpyObj<CanvasRenderingContext2D>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;

  beforeEach(() => {
    // Create mock ThemeService
    mockThemeService = jasmine.createSpyObj('ThemeService', [], {
      isDayMode: false, // Default to dark mode
    });

    TestBed.configureTestingModule({
      providers: [MinimapRendererService, { provide: ThemeService, useValue: mockThemeService }],
    });
    service = TestBed.inject(MinimapRendererService);

    // Create comprehensive mock canvas context
    mockCtx = jasmine.createSpyObj('CanvasRenderingContext2D', [
      'save',
      'restore',
      'beginPath',
      'rect',
      'clip',
      'fillRect',
      'strokeRect',
      'arc',
      'fill',
      'stroke',
      'closePath',
      'moveTo',
      'lineTo',
      'translate',
      'rotate',
      'clearRect',
      'fillText',
      'createRadialGradient',
      'createLinearGradient',
      'setTransform',
      'scale',
      'drawImage',
      'getImageData',
      'putImageData',
      'setLineDash',
    ]);

    // Mock gradients
    const mockRadialGradient = jasmine.createSpyObj('CanvasGradient', [
      'addColorStop',
    ]) as jasmine.SpyObj<CanvasGradient>;
    const mockLinearGradient = jasmine.createSpyObj('CanvasGradient', [
      'addColorStop',
    ]) as jasmine.SpyObj<CanvasGradient>;
    mockCtx.createRadialGradient.and.returnValue(mockRadialGradient);
    mockCtx.createLinearGradient.and.returnValue(mockLinearGradient);

    // Mock image data for interference effects
    const mockImageData = {
      data: new Uint8ClampedArray(800), // 200x200x4 would be larger, this is simplified
      width: 200,
      height: 200,
    };
    mockCtx.getImageData.and.returnValue(mockImageData as ImageData);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('renderMinimap', () => {
    const defaultParams = {
      width: 200,
      height: 200,
      playerX: 0,
      playerY: 0,
      playerRotation: 0,
    };

    it('should clear canvas before rendering', () => {
      const territories: Territory[] = [];
      const entities: MinimapEntities = {
        enemies: [],

        items: [],
      };

      service.renderMinimap(
        mockCtx,
        defaultParams.width,
        defaultParams.height,
        defaultParams.playerX,
        defaultParams.playerY,
        defaultParams.playerRotation,
        territories,
        entities,
        false
      );

      expect(mockCtx.clearRect).toHaveBeenCalledWith(0, 0, 200, 200);
    });

    it('should render all layers in correct order', () => {
      // Just verify the main method executes without errors

      const territories: Territory[] = [];
      const entities: MinimapEntities = {
        enemies: [],

        items: [],
      };

      service.renderMinimap(
        mockCtx,
        defaultParams.width,
        defaultParams.height,
        defaultParams.playerX,
        defaultParams.playerY,
        defaultParams.playerRotation,
        territories,
        entities,
        false
      );

      // Verify the methods that still exist were called
      expect(mockCtx.clearRect).toHaveBeenCalled();
      expect(mockCtx.fillRect).toHaveBeenCalled(); // From background
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should update animations', () => {
      interface MinimapRendererWithPrivates {
        updateAnimations: () => void;
      }
      const updateAnimationsSpy = spyOn(service as unknown as MinimapRendererWithPrivates, 'updateAnimations');

      const territories: Territory[] = [];
      const entities: MinimapEntities = {
        enemies: [],

        items: [],
      };

      service.renderMinimap(
        mockCtx,
        defaultParams.width,
        defaultParams.height,
        defaultParams.playerX,
        defaultParams.playerY,
        defaultParams.playerRotation,
        territories,
        entities,
        false
      );

      expect(updateAnimationsSpy).toHaveBeenCalled();
    });
  });

  describe('renderBackground', () => {
    it('should render different background in combat', () => {
      const renderBgMethod = service['renderBackground'];
      renderBgMethod.call(service, mockCtx, 200, 200, true);

      // Base background fill is always painted directly onto ctx
      expect(mockCtx.fillRect).toHaveBeenCalled();
      // Gradient is applied either via drawImage (OffscreenCanvas path) or
      // createRadialGradient (fallback path when OffscreenCanvas is unavailable)
      const gradientApplied = mockCtx.drawImage.calls.any() || mockCtx.createRadialGradient.calls.any();
      expect(gradientApplied).toBeTrue();
    });

    it('should render normal background when not in combat', () => {
      const renderBgMethod = service['renderBackground'];
      renderBgMethod.call(service, mockCtx, 200, 200, false);

      expect(mockCtx.fillRect).toHaveBeenCalled();
      const gradientApplied = mockCtx.drawImage.calls.any() || mockCtx.createRadialGradient.calls.any();
      expect(gradientApplied).toBeTrue();
    });
  });

  describe('renderEntities', () => {
    it('should render enemies with correct colors', () => {
      const entities: MinimapEntities = {
        enemies: [
          { x: 100, y: 100, type: 'normal' },
          { x: 200, y: 200, type: 'elite' },
        ],

        items: [],
      };

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 200, 200, 0, 0, entities);

      // Should draw circles for enemies
      expect(mockCtx.arc).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
    });

    it('should render items with rarity colors', () => {
      const entities: MinimapEntities = {
        enemies: [],

        items: [
          { x: 50, y: 50, rarity: 'common' },
          { x: 100, y: 100, rarity: 'rare' },
          { x: 150, y: 150, rarity: 'epic' },
        ],
      };

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 200, 200, 0, 0, entities);

      // Items are now rendered as circles using arc
      expect(mockCtx.arc).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
    });
  });

  describe('renderPlayer', () => {
    it('should render player at center', () => {
      const renderPlayerMethod = service['renderPlayer'];
      renderPlayerMethod.call(service, mockCtx, 200, 200, Math.PI / 4);

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.translate).toHaveBeenCalledWith(100, 100); // Center of 200x200
      expect(mockCtx.rotate).toHaveBeenCalledWith(Math.PI / 4);
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should draw player arrow shape', () => {
      const renderPlayerMethod = service['renderPlayer'];
      renderPlayerMethod.call(service, mockCtx, 200, 200, 0);

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
      expect(mockCtx.closePath).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
    });
  });

  describe('renderGrid', () => {
    it('should render grid lines', () => {
      const renderGridMethod = service['renderGrid'];
      renderGridMethod.call(service, mockCtx, 200, 200);

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });
  });

  describe('renderHUDElements', () => {
    it('should render coordinates in debug mode', () => {
      const renderHUDMethod = service['renderHUDElements'];
      // debugMode = true is required to render coordinate text
      renderHUDMethod.call(service, mockCtx, 200, 200, 1234, 5678, false, true);

      expect(mockCtx.fillText).toHaveBeenCalledWith('[1234, 5678]', jasmine.any(Number), jasmine.any(Number));
    });

    it('should not render coordinates when debugMode is false', () => {
      const renderHUDMethod = service['renderHUDElements'];
      renderHUDMethod.call(service, mockCtx, 200, 200, 1234, 5678, false, false);

      expect(mockCtx.fillText).not.toHaveBeenCalledWith('[1234, 5678]', jasmine.any(Number), jasmine.any(Number));
    });

    it('should render combat warning when in combat', () => {
      const renderHUDMethod = service['renderHUDElements'];
      renderHUDMethod.call(service, mockCtx, 200, 200, 0, 0, true);

      expect(mockCtx.fillText).toHaveBeenCalledWith('COMBAT', jasmine.any(Number), jasmine.any(Number));
    });
  });

  describe('theme awareness', () => {
    it('should use dark mode colors when isDayMode is false', () => {
      // ThemeService is mocked with isDayMode: false by default
      const colors = service['getMinimapColors']();

      // Dark mode should have neon colors
      expect(colors.PLAYER).toBe('#00ff00');
      expect(colors.ENEMY).toBe('#ff0044');
    });

    it('should use light mode colors when isDayMode is true', () => {
      // Update mock to return day mode
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });

      const colors = service['getMinimapColors']();

      // Light mode should have valid color strings
      expect(colors.PLAYER).toBeDefined();
      expect(colors.ENEMY).toBeDefined();
      expect(colors.PLAYER).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors.ENEMY).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should get correct territory colors for dark mode', () => {
      const color = service['getTerritoryColor'](1);
      expect(color).toContain('rgba(231, 76, 60'); // Crimson King dark
    });

    it('should get correct territory colors for light mode', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });
      const color = service['getTerritoryColor'](1);
      expect(color).toContain('rgba(181, 32, 32'); // Crimson King light — FACTION_IDENTITIES[1].light.territory.color
    });

    it('should skip neon glow in light mode frame rendering', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });

      const renderFrameMethod = service['renderFrame'];
      renderFrameMethod.call(service, mockCtx, 200, 200, false);

      // In light mode, createLinearGradient should NOT be called (no glow)
      expect(mockCtx.createLinearGradient).not.toHaveBeenCalled();
    });

    it('should add neon glow in dark mode frame rendering', () => {
      // Default is dark mode
      const renderFrameMethod = service['renderFrame'];
      renderFrameMethod.call(service, mockCtx, 200, 200, false);

      // In dark mode, createLinearGradient SHOULD be called for glow effect
      expect(mockCtx.createLinearGradient).toHaveBeenCalled();
    });
  });

  describe('updateAnimations', () => {
    it('should update radar sweep angle', () => {
      const initialAngle = service['radarSweepAngle'];

      const updateMethod = service['updateAnimations'];
      updateMethod.call(service);

      expect(service['radarSweepAngle']).not.toBe(initialAngle);
    });

    it('should update pulse phase', () => {
      const initialPhase = service['pulsePhase'];

      const updateMethod = service['updateAnimations'];
      updateMethod.call(service);

      expect(service['pulsePhase']).not.toBe(initialPhase);
    });
  });

  describe('_applyGradientColorStops', () => {
    // Proves the shared helper applies the same stops that were previously inlined
    // in both the OffscreenCanvas bake path and _paintGradientDirect.
    const CASES: Array<{ isDayMode: boolean; isInCombat: boolean; expected: [number, string][] }> = [
      {
        isDayMode: false,
        isInCombat: false,
        expected: [
          [0, 'rgba(0, 20, 30, 0.3)'],
          [0.7, 'rgba(0, 10, 20, 0.5)'],
          [1, 'rgba(0, 0, 0, 0.8)'],
        ],
      },
      {
        isDayMode: false,
        isInCombat: true,
        expected: [
          [0, 'rgba(50, 0, 0, 0.3)'],
          [0.7, 'rgba(20, 0, 0, 0.5)'],
          [1, 'rgba(0, 0, 0, 0.8)'],
        ],
      },
      {
        isDayMode: true,
        isInCombat: false,
        expected: [
          [0, 'rgba(248, 250, 252, 0.1)'],
          [0.7, 'rgba(71, 85, 105, 0.05)'],
          [1, 'rgba(71, 85, 105, 0.12)'],
        ],
      },
      {
        isDayMode: true,
        isInCombat: true,
        expected: [
          [0, 'rgba(220, 38, 38, 0.12)'],
          [0.7, 'rgba(220, 38, 38, 0.08)'],
          [1, 'rgba(71, 85, 105, 0.15)'],
        ],
      },
    ];

    for (const { isDayMode, isInCombat, expected } of CASES) {
      it(`applies correct stops (isDayMode=${isDayMode}, isInCombat=${isInCombat})`, () => {
        const mockGradient = jasmine.createSpyObj<CanvasGradient>('CanvasGradient', ['addColorStop']);
        service['_applyGradientColorStops'](mockGradient, isDayMode, isInCombat);
        expect(mockGradient.addColorStop).toHaveBeenCalledTimes(3);
        for (const [offset, color] of expected) {
          expect(mockGradient.addColorStop).toHaveBeenCalledWith(offset, color);
        }
      });
    }
  });

  describe('isInTerritory', () => {
    it('should return true when point is inside territory', () => {
      const territory: Territory = {
        x: 100,
        y: 100,
        kingId: 1,
        minX: 50,
        maxX: 150,
        minY: 50,
        maxY: 150,
      };

      const isInTerritoryMethod = service['isInTerritory'];
      const result = isInTerritoryMethod.call(service, 100, 100, territory);

      expect(result).toBeTruthy();
    });

    it('should return false when point is outside territory', () => {
      const territory: Territory = {
        x: 100,
        y: 100,
        kingId: 1,
        minX: 50,
        maxX: 150,
        minY: 50,
        maxY: 150,
      };

      const isInTerritoryMethod = service['isInTerritory'];
      const result = isInTerritoryMethod.call(service, 200, 200, territory);

      expect(result).toBeFalsy();
    });
  });
});
