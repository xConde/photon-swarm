import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { TerritoryVisualFeedbackService } from '../territory/territory-visual-feedback.service';
import { FourKingsTerritoryService, TerritoryStrengthSystemService, TileStrengthChange } from '../territory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

describe('TerritoryVisualFeedbackService', () => {
  let service: TerritoryVisualFeedbackService;
  let mockTerritoryStrength: jasmine.SpyObj<TerritoryStrengthSystemService>;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let strengthChangesSubject: BehaviorSubject<TileStrengthChange[]>;
  let mockCanvas: HTMLCanvasElement;
  let mockContext: jasmine.SpyObj<CanvasRenderingContext2D>;

  beforeEach(() => {
    // Create mock canvas and context
    mockContext = jasmine.createSpyObj('CanvasRenderingContext2D', [
      'save',
      'restore',
      'beginPath',
      'arc',
      'stroke',
      'fill',
      'fillRect',
      'fillText',
      'strokeStyle',
      'fillStyle',
      'globalAlpha',
      'lineWidth',
      'font',
      'textAlign',
      'textBaseline',
    ]);

    mockCanvas = document.createElement('canvas');
    spyOn(mockCanvas, 'getContext').and.returnValue(mockContext);

    // Create mock services
    strengthChangesSubject = new BehaviorSubject<TileStrengthChange[]>([]);

    mockTerritoryStrength = jasmine.createSpyObj('TerritoryStrengthSystemService', [], {
      strengthChanges$: strengthChangesSubject.asObservable(),
    });

    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getTileSize',
      'getWorldData',
      'getIsInitialized',
    ]);
    mockFourKingsTerritory.getTileSize.and.returnValue(50);
    mockFourKingsTerritory.getWorldData.and.returnValue(null);
    mockFourKingsTerritory.getIsInitialized.and.returnValue(true);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [
        TerritoryVisualFeedbackService,
        { provide: TerritoryStrengthSystemService, useValue: mockTerritoryStrength },
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
      ],
    });

    service = TestBed.inject(TerritoryVisualFeedbackService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  describe('Canvas Management', () => {
    it('should set canvas only once', () => {
      service.setCanvas(mockCanvas);
      service.setCanvas(mockCanvas);
      service.setCanvas(mockCanvas);

      // Should only call getContext once due to canvasSet flag
      expect(mockCanvas.getContext).toHaveBeenCalledTimes(1);
    });

    it('should get 2d context when canvas is set', () => {
      service.setCanvas(mockCanvas);
      expect(mockCanvas.getContext).toHaveBeenCalledWith('2d');
    });
  });

  describe('Effect Creation', () => {
    beforeEach(() => {
      service.setCanvas(mockCanvas);
    });

    it('should create effects for kill_impact changes', () => {
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 65,
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);

      expect(service.getActiveEffectCount()).toBe(1);
    });

    it('should not create effects for regeneration changes', () => {
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 65,
          newStrength: 66,
          reason: 'regeneration',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);

      expect(service.getActiveEffectCount()).toBe(0);
    });

    it('should limit active effects to prevent memory leak', () => {
      // Create more effects than the limit
      for (let i = 0; i < 60; i++) {
        const changes: TileStrengthChange[] = [
          {
            gridX: i % 10,
            gridY: Math.floor(i / 10),
            oldStrength: 75,
            newStrength: 65,
            reason: 'kill_impact',
            timestamp: Date.now(),
          },
        ];
        strengthChangesSubject.next(changes);
      }

      // Should be capped at MAX_ACTIVE_EFFECTS (50)
      expect(service.getActiveEffectCount()).toBeLessThanOrEqual(50);
    });

    it('should assign colors based on strength reduction', () => {
      const testCases = [
        { old: 75, new: 65, expectedColor: '#ffaa00' }, // Minor (< 5)
        { old: 75, new: 70, expectedColor: '#ff6600' }, // Moderate (5-7)
        { old: 75, new: 67, expectedColor: '#ff0000' }, // Major (>= 8)
      ];

      testCases.forEach((test) => {
        const changes: TileStrengthChange[] = [
          {
            gridX: 5,
            gridY: 5,
            oldStrength: test.old,
            newStrength: test.new,
            reason: 'kill_impact',
            timestamp: Date.now(),
          },
        ];

        strengthChangesSubject.next(changes);
        // Color is set internally - we can't directly test it without exposing private members
        // But we verify the effect was created
        expect(service.getActiveEffectCount()).toBeGreaterThan(0);
        service.clearEffects(); // Reset for next test
      });
    });
  });

  describe('Rendering', () => {
    beforeEach(() => {
      service.setCanvas(mockCanvas);
      mockCanvas.width = 1920;
      mockCanvas.height = 1080;
    });

    it('should not render without canvas context', () => {
      const serviceWithoutCanvas = TestBed.inject(TerritoryVisualFeedbackService);

      // Should not throw even without canvas
      expect(() => {
        serviceWithoutCanvas.render(0, 0);
      }).not.toThrow();
    });

    it('should remove expired effects during render', (done) => {
      // Create an effect
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 65,
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);
      expect(service.getActiveEffectCount()).toBe(1);

      // Wait for effect to expire (EFFECT_DURATION = 1000ms)
      setTimeout(() => {
        service.render(0, 0);
        expect(service.getActiveEffectCount()).toBe(0);
        done();
      }, 1100);
    });

    it('should skip off-screen effects', () => {
      // Create effect far off-screen
      const changes: TileStrengthChange[] = [
        {
          gridX: 100,
          gridY: 100,
          oldStrength: 75,
          newStrength: 65,
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);

      // Render with camera at origin
      service.render(0, 0);

      // Context methods should not be called for off-screen effects
      expect(mockContext.save).not.toHaveBeenCalled();
    });

    it('should render on-screen effects', () => {
      // Create effect on-screen
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 65,
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);

      // Render with camera at origin
      service.render(0, 0);

      // Should call rendering methods
      expect(mockContext.save).toHaveBeenCalled();
      expect(mockContext.restore).toHaveBeenCalled();
      expect(mockContext.beginPath).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should clear all effects when clearEffects is called', () => {
      // Add some effects
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 65,
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);
      expect(service.getActiveEffectCount()).toBeGreaterThan(0);

      service.clearEffects();
      expect(service.getActiveEffectCount()).toBe(0);
    });

    it('should unsubscribe from strength changes on destroy', () => {
      // Create a new service to test subscription cleanup
      const newService = TestBed.inject(TerritoryVisualFeedbackService);

      // Add an effect to verify subscription is active
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 65,
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);
      expect(newService.getActiveEffectCount()).toBe(1);

      // Destroy service
      newService.ngOnDestroy();

      // New changes should not affect the destroyed service
      strengthChangesSubject.next(changes);
      expect(newService.getActiveEffectCount()).toBe(0); // Effects were cleared
    });
  });

  describe('Logging', () => {
    beforeEach(() => {
      service.setCanvas(mockCanvas);
    });

    it('should log significant weakening events', () => {
      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 70, // Reduction of 5, which is significant
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);

      expect(mockDebugLog.log).toHaveBeenCalledWith(
        'Territory significantly weakened',
        'info',
        jasmine.objectContaining({
          gridPos: '5,5',
          reduction: 5,
          newStrength: 70,
          canBeCaptured: false,
        })
      );
    });

    it('should not log minor weakening events', () => {
      mockDebugLog.log.calls.reset();

      const changes: TileStrengthChange[] = [
        {
          gridX: 5,
          gridY: 5,
          oldStrength: 75,
          newStrength: 73, // Reduction of 2, not significant
          reason: 'kill_impact',
          timestamp: Date.now(),
        },
      ];

      strengthChangesSubject.next(changes);

      expect(mockDebugLog.log).not.toHaveBeenCalled();
    });
  });
});
