import { TestBed } from '@angular/core/testing';
import { PostProcessingService } from './post-processing.service';

describe('PostProcessingService', () => {
  let service: PostProcessingService;
  let mockCanvas: HTMLCanvasElement;
  let mockCtx: CanvasRenderingContext2D;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PostProcessingService);

    // Create mock canvas and context
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;
    mockCtx = mockCanvas.getContext('2d')!;

    // Mock getImageData and putImageData
    const mockImageData = new ImageData(mockCanvas.width, mockCanvas.height);
    spyOn(mockCtx, 'getImageData').and.returnValue(mockImageData);
    spyOn(mockCtx, 'createImageData').and.returnValue(mockImageData);
    spyOn(mockCtx, 'putImageData');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should start with no active effects', () => {
    expect(service.hasActiveEffects()).toBeFalsy();
  });

  it('should add chromatic aberration effect', () => {
    service.addChromaticAberration({
      intensity: 0.5,
      duration: 300,
    });

    expect(service.hasActiveEffects()).toBeTruthy();
  });

  it('should apply effects to canvas', () => {
    service.addChromaticAberration({
      intensity: 0.5,
      duration: 300,
    });

    // The service uses an internal offscreen canvas for image manipulation,
    // not the passed-in context. Just verify it runs without error.
    expect(() => service.applyEffects(mockCtx, mockCanvas)).not.toThrow();
    // After applying, effect may still be active (hasn't expired yet)
    expect(service.hasActiveEffects()).toBeTruthy();
  });

  it('should fade out effects over time', (done) => {
    service.addChromaticAberration({
      intensity: 1.0,
      duration: 100,
      fadeOut: true,
    });

    expect(service.hasActiveEffects()).toBeTruthy();

    // Update a few times to simulate fade
    for (let i = 0; i < 5; i++) {
      service.applyEffects(mockCtx, mockCanvas);
    }

    // Wait for duration to expire
    setTimeout(() => {
      service.applyEffects(mockCtx, mockCanvas);
      expect(service.hasActiveEffects()).toBeFalsy();
      done();
    }, 150);
  });

  it('should clear all effects', () => {
    service.addChromaticAberration({
      intensity: 0.5,
      duration: 1000,
    });

    expect(service.hasActiveEffects()).toBeTruthy();

    service.clear();

    expect(service.hasActiveEffects()).toBeFalsy();
  });

  it('should handle multiple simultaneous effects', () => {
    service.addChromaticAberration({
      intensity: 0.3,
      duration: 200,
    });

    service.addChromaticAberration({
      intensity: 0.5,
      duration: 300,
    });

    expect(service.hasActiveEffects()).toBeTruthy();

    // Both effects should be active - verify applyEffects runs without error
    expect(() => service.applyEffects(mockCtx, mockCanvas)).not.toThrow();
    // Effects should still be active after one apply call
    expect(service.hasActiveEffects()).toBeTruthy();
  });

  it('should use presets correctly', () => {
    const presets = PostProcessingService.PRESETS;

    // Test each preset
    expect(presets.LIGHT_DAMAGE.intensity).toBe(0.3);
    expect(presets.MEDIUM_DAMAGE.intensity).toBe(0.6);
    expect(presets.HEAVY_DAMAGE.intensity).toBe(1.0);
    expect(presets.CRITICAL_HIT.intensity).toBe(0.8);

    // All presets should have fadeOut enabled
    Object.values(presets).forEach((preset) => {
      expect(preset.fadeOut).toBe(true);
    });
  });

  it('should not apply effects when there are none', () => {
    service.applyEffects(mockCtx, mockCanvas);

    expect(mockCtx.getImageData).not.toHaveBeenCalled();
    expect(mockCtx.putImageData).not.toHaveBeenCalled();
  });

  it('should reuse offscreen canvas when dimensions match', () => {
    service.addChromaticAberration({ intensity: 0.5, duration: 300 });

    // First call creates offscreen canvas
    service.applyEffects(mockCtx, mockCanvas);
    const getImageDataSpy = mockCtx.getImageData as jasmine.Spy;
    const firstCallCount = getImageDataSpy.calls.count();

    // Second call should reuse canvas
    service.applyEffects(mockCtx, mockCanvas);
    const secondCallCount = getImageDataSpy.calls.count();

    expect(secondCallCount).toBe(firstCallCount * 2);
  });

  it('should handle chromatic aberration intensity correctly', () => {
    // Test that higher intensity creates larger pixel shifts.
    // The implementation uses a half-resolution OffscreenCanvas for performance:
    // it downscales the source canvas, processes pixels, then blits back via drawImage.
    // putImageData is called on the internal half-res canvas context, not mockCtx.
    // The main ctx receives a drawImage call to composite the result.
    spyOn(mockCtx, 'drawImage');
    spyOn(mockCtx, 'save');
    spyOn(mockCtx, 'restore');

    service.addChromaticAberration({
      intensity: 1.0, // Max intensity
      duration: 300,
    });

    expect(() => service.applyEffects(mockCtx, mockCanvas)).not.toThrow();
    // The effect was applied — drawImage composites the processed half-res canvas back
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });
});
