import { TestBed } from '@angular/core/testing';
import { MapEntities, MapRendererService, Territory } from './map-renderer.service';
import { ThemeService } from '@services/theme.service';

describe('MapRendererService', () => {
  let service: MapRendererService;
  let mockCtx: jasmine.SpyObj<CanvasRenderingContext2D>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;

  beforeEach(() => {
    // Create mock ThemeService
    mockThemeService = jasmine.createSpyObj('ThemeService', [], {
      isDayMode: false, // Default to dark mode
    });

    TestBed.configureTestingModule({
      providers: [MapRendererService, { provide: ThemeService, useValue: mockThemeService }],
    });
    service = TestBed.inject(MapRendererService);

    // Create mock canvas context
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
      'setTransform',
    ]);

    // Mock gradient
    const mockGradient = jasmine.createSpyObj('CanvasGradient', ['addColorStop']) as jasmine.SpyObj<CanvasGradient>;
    mockCtx.createRadialGradient.and.returnValue(mockGradient);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('renderFullMap', () => {
    const defaultParams = {
      mapX: 10,
      mapY: 10,
      mapSize: 400,
      playerX: 0,
      playerY: 0,
      viewRadius: 1000,
    };

    it('should save and restore context state', () => {
      const territories: Territory[] = [];
      const entities: MapEntities = {
        enemies: [],
        items: [],
      };

      service.renderFullMap(
        mockCtx,
        defaultParams.mapX,
        defaultParams.mapY,
        defaultParams.mapSize,
        defaultParams.playerX,
        defaultParams.playerY,
        defaultParams.viewRadius,
        territories,
        entities
      );

      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should create clipping region for map', () => {
      const territories: Territory[] = [];
      const entities: MapEntities = {
        enemies: [],
        items: [],
      };

      service.renderFullMap(
        mockCtx,
        defaultParams.mapX,
        defaultParams.mapY,
        defaultParams.mapSize,
        defaultParams.playerX,
        defaultParams.playerY,
        defaultParams.viewRadius,
        territories,
        entities
      );

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.rect).toHaveBeenCalledWith(
        defaultParams.mapX,
        defaultParams.mapY,
        defaultParams.mapSize,
        defaultParams.mapSize
      );
      expect(mockCtx.clip).toHaveBeenCalled();
    });

    it('should render all layers in correct order', () => {
      spyOn<MapRendererService>(service, 'renderBackground' as keyof MapRendererService);
      spyOn<MapRendererService>(service, 'renderEntities' as keyof MapRendererService);
      spyOn<MapRendererService>(service, 'renderUIOverlay' as keyof MapRendererService);
      spyOn<MapRendererService>(service, 'renderMapBorder' as keyof MapRendererService);

      const territories: Territory[] = [];
      const entities: MapEntities = {
        enemies: [],
        items: [],
      };

      service.renderFullMap(
        mockCtx,
        defaultParams.mapX,
        defaultParams.mapY,
        defaultParams.mapSize,
        defaultParams.playerX,
        defaultParams.playerY,
        defaultParams.viewRadius,
        territories,
        entities
      );

      expect(service['renderBackground']).toHaveBeenCalled();
      expect(service['renderEntities']).toHaveBeenCalled();
      expect(service['renderUIOverlay']).toHaveBeenCalled();
      expect(service['renderMapBorder']).toHaveBeenCalled();
    });
  });

  describe('renderBackground', () => {
    it('should render background and vignette effect', () => {
      const territories: Territory[] = [];

      const renderBgMethod = service['renderBackground'];
      renderBgMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, territories);

      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.createRadialGradient).toHaveBeenCalled();
    });

    it('should render territories with correct colors', () => {
      const territories: Territory[] = [
        { x: 0, y: 0, kingId: 1 },
        { x: 100, y: 0, kingId: 2 },
      ];

      const renderBgMethod = service['renderBackground'];
      renderBgMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, territories);

      // Should render territory fills
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.strokeRect).toHaveBeenCalled();
    });
  });

  describe('renderEntities', () => {
    it('should render enemies with different threat levels', () => {
      const entities: MapEntities = {
        enemies: [
          { x: 100, y: 100, threat: 'normal' },
          { x: 200, y: 200, threat: 'elite' },
          { x: 300, y: 300, threat: 'boss', health: 0.5 },
        ],
        items: [],
      };

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, entities);

      // Should draw circles for each enemy:
      // - 3 main dots (normal, elite, boss)
      // - 2 inner dots (elite and boss)
      // - 2 glow arcs (elite and boss, dark mode only)
      expect(mockCtx.arc).toHaveBeenCalledTimes(7);
      expect(mockCtx.fill).toHaveBeenCalled();
    });

    it('should skip enemies outside map bounds', () => {
      const entities: MapEntities = {
        enemies: [
          { x: 10000, y: 10000, threat: 'normal' }, // Far outside view
        ],
        items: [],
      };

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, entities);

      // Should not draw anything for out-of-bounds enemy
      expect(mockCtx.arc).not.toHaveBeenCalled();
    });

    it('should render boss health bars', () => {
      const entities: MapEntities = {
        enemies: [{ x: 100, y: 100, threat: 'boss', health: 0.5 }],
        items: [],
      };

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, entities);

      // Should draw health bar for boss
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.strokeRect).toHaveBeenCalled();
    });

    it('should render powerups with pulsing effect', () => {
      const entities: MapEntities = {
        enemies: [],
        items: [{ x: 100, y: 100, rarity: 'rare' }],
      };

      spyOn(Date, 'now').and.returnValue(1000);

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, entities);

      // Should draw diamond shape for powerup
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.translate).toHaveBeenCalled();
      expect(mockCtx.rotate).toHaveBeenCalledWith(Math.PI / 4);
      expect(mockCtx.fillRect).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should render asteroid hazards', () => {
      const entities: MapEntities = {
        enemies: [],
        items: [],
        asteroids: [{ x: 100, y: 100, state: 'falling' }],
      };

      const renderEntitiesMethod = service['renderEntities'];
      renderEntitiesMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000, entities);

      // Should draw triangle warning symbol
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
      expect(mockCtx.closePath).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });
  });

  describe('renderUIOverlay', () => {
    it('should render grid overlay', () => {
      const renderUIMethod = service['renderUIOverlay'];
      renderUIMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000);

      // Should draw grid lines
      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.moveTo).toHaveBeenCalled();
      expect(mockCtx.lineTo).toHaveBeenCalled();
      expect(mockCtx.stroke).toHaveBeenCalled();
    });

    it('should render player indicator at center', () => {
      const renderUIMethod = service['renderUIOverlay'];
      renderUIMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000);

      // Should draw player arrow
      expect(mockCtx.save).toHaveBeenCalled();
      expect(mockCtx.translate).toHaveBeenCalledWith(210, 210); // Center of 400x400 map at (10,10)
      expect(mockCtx.fill).toHaveBeenCalled();
      expect(mockCtx.restore).toHaveBeenCalled();
    });

    it('should render player position text', () => {
      const renderUIMethod = service['renderUIOverlay'];
      renderUIMethod.call(service, mockCtx, 10, 10, 400, 100, 200, 1000);

      // Should display coordinates
      expect(mockCtx.fillText).toHaveBeenCalledWith('[100, 200]', jasmine.any(Number), jasmine.any(Number));
    });
  });

  describe('renderMapBorder', () => {
    it('should render outer border in dark mode with glow', () => {
      const renderBorderMethod = service['renderMapBorder'];
      renderBorderMethod.call(service, mockCtx, 10, 10, 400);

      // Should draw two borders (outer + glow) in dark mode
      expect(mockCtx.strokeRect).toHaveBeenCalledTimes(2);
    });

    it('should render only outer border in light mode (no glow)', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });

      const renderBorderMethod = service['renderMapBorder'];
      renderBorderMethod.call(service, mockCtx, 10, 10, 400);

      // Should draw only one border (no glow) in light mode
      expect(mockCtx.strokeRect).toHaveBeenCalledTimes(1);
    });
  });

  describe('getExplorationPercentage', () => {
    it('should always return 100 for arena shooter', () => {
      const percentage = service.getExplorationPercentage();
      expect(percentage).toBe(100);
    });
  });

  describe('theme awareness', () => {
    it('should use dark mode colors when isDayMode is false', () => {
      const colors = service['getMapColors']();

      // Dark mode should have neon colors
      expect(colors.PLAYER).toBe('#00ff00');
      expect(colors.ENEMY).toBe('#ff0044');
    });

    it('should use light mode colors when isDayMode is true', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });

      const colors = service['getMapColors']();

      // Light mode should have valid color strings
      expect(colors.PLAYER).toBeDefined();
      expect(colors.ENEMY).toBeDefined();
      expect(colors.PLAYER).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors.ENEMY).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should get correct territory colors for dark mode', () => {
      const color = service['getTerritoryColor'](1);
      expect(color).toContain('rgba(231, 76, 60'); // Crimson King dark — FACTION_IDENTITIES[1].dark.territory.color
    });

    it('should get correct territory colors for light mode', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });
      const color = service['getTerritoryColor'](1);
      expect(color).toContain('rgba(181, 32, 32'); // Crimson King light — FACTION_IDENTITIES[1].light.territory.color
    });

    it('should get correct rarity colors for dark mode', () => {
      const color = service['getRarityColor']('legendary');
      expect(color).toBe('#FFD700'); // Gold in dark mode
    });

    it('should get correct rarity colors for light mode', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });
      const color = service['getRarityColor']('legendary');
      expect(color).toBe('#b8860b'); // Dark goldenrod in light mode
    });

    it('should skip player glow shadow in light mode', () => {
      Object.defineProperty(mockThemeService, 'isDayMode', { get: () => true });

      const renderUIMethod = service['renderUIOverlay'];
      renderUIMethod.call(service, mockCtx, 10, 10, 400, 0, 0, 1000);

      // In light mode, shadowBlur should not be set to 15 (no glow)
      // We verify by checking shadowColor was never set
      expect(mockCtx.shadowColor).toBeUndefined();
    });
  });
});
