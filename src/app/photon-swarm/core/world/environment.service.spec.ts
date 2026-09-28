import { TestBed } from '@angular/core/testing';
import { EnvironmentService } from './environment.service';
import { ThemeService } from '@services/theme.service';

describe('EnvironmentService', () => {
  let service: EnvironmentService;
  let mockCanvas: HTMLCanvasElement;
  let mockContext: CanvasRenderingContext2D;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EnvironmentService, { provide: ThemeService, useValue: { isDayMode: false } }],
    });
    service = TestBed.inject(EnvironmentService);

    // Create mock canvas and context
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;
    mockContext = mockCanvas.getContext('2d')!;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initialize', () => {
    it('should not throw when called', () => {
      expect(() => service.initialize(mockCanvas, 12000, 9000)).not.toThrow();
    });
  });

  describe('renderBackground', () => {
    it('should fill the entire canvas with a gradient', () => {
      const fillRectSpy = spyOn(mockContext, 'fillRect');
      const mockGradient = jasmine.createSpyObj('CanvasGradient', ['addColorStop']);
      const createRadialGradientSpy = spyOn(mockContext, 'createRadialGradient').and.returnValue(mockGradient);

      service.renderBackground(mockContext);

      // Implementation uses createRadialGradient at canvas center
      expect(createRadialGradientSpy).toHaveBeenCalledWith(400, 300, 0, 400, 300, jasmine.any(Number));
      expect(mockGradient.addColorStop).toHaveBeenCalled();
      expect(fillRectSpy).toHaveBeenCalledWith(0, 0, 800, 600);
    });
  });

  describe('renderWorld', () => {
    it('should draw a grid pattern', () => {
      const beginPathSpy = spyOn(mockContext, 'beginPath');
      spyOn(mockContext, 'moveTo');
      spyOn(mockContext, 'lineTo');
      const strokeSpy = spyOn(mockContext, 'stroke');

      service.renderWorld(mockContext, 0, 0, 800, 600);

      expect(mockContext.strokeStyle).toBe('rgba(0, 255, 255, 0.04)');
      expect(mockContext.lineWidth).toBe(1);
      expect(beginPathSpy).toHaveBeenCalled();
      expect(strokeSpy).toHaveBeenCalled();
    });

    it('should draw vertical and horizontal lines', () => {
      const moveToSpy = spyOn(mockContext, 'moveTo');
      const lineToSpy = spyOn(mockContext, 'lineTo');

      service.renderWorld(mockContext, 0, 0, 800, 600);

      // Should call moveTo and lineTo for grid lines
      expect(moveToSpy).toHaveBeenCalled();
      expect(lineToSpy).toHaveBeenCalled();
    });

    it('should handle different camera positions', () => {
      const moveToSpy = spyOn(mockContext, 'moveTo');
      const lineToSpy = spyOn(mockContext, 'lineTo');

      service.renderWorld(mockContext, 100, 50, 800, 600);

      expect(moveToSpy).toHaveBeenCalled();
      expect(lineToSpy).toHaveBeenCalled();
    });

    it('should handle different viewport sizes', () => {
      const moveToSpy = spyOn(mockContext, 'moveTo');
      const lineToSpy = spyOn(mockContext, 'lineTo');

      service.renderWorld(mockContext, 0, 0, 400, 300);

      expect(moveToSpy).toHaveBeenCalled();
      expect(lineToSpy).toHaveBeenCalled();
    });
  });
});
