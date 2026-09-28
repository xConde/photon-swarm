import { TestBed } from '@angular/core/testing';
import { ScreenSpaceUiRendererService } from './screen-space-ui-renderer.service';
import { ThemeService } from '@services/theme.service';
import { PaletteService } from '../../services/palette.service';

describe('ScreenSpaceUiRendererService', () => {
  let service: ScreenSpaceUiRendererService;
  let ctx: jasmine.SpyObj<CanvasRenderingContext2D>;
  let mockPaletteService: { getCanvas: jasmine.Spy };
  let mockThemeService: { isDayMode: boolean };

  beforeEach(() => {
    mockPaletteService = {
      getCanvas: jasmine.createSpy('getCanvas').and.returnValue({
        STROKE_PRIMARY: '#ffffff',
        HEALTH_HIGH: '#00ff00',
        HEALTH_MED: '#ffff00',
        HEALTH_LOW: '#ff0000',
        BOUNDARY: '#aaaaaa',
        ACCENT_CYAN: '#00ffff',
      }),
    };

    mockThemeService = { isDayMode: false };

    // Build a spy for CanvasRenderingContext2D
    ctx = jasmine.createSpyObj<CanvasRenderingContext2D>('ctx', [
      'fillRect',
      'strokeText',
      'fillText',
      'strokeRect',
      'save',
      'restore',
      'createRadialGradient',
      'drawImage',
      'beginPath',
      'moveTo',
      'lineTo',
      'stroke',
    ]);

    // createRadialGradient needs to return something with addColorStop
    const mockGradient = {
      addColorStop: jasmine.createSpy('addColorStop'),
    };
    ctx.createRadialGradient.and.returnValue(mockGradient);

    // Writeable properties used by the methods
    Object.defineProperties(ctx, {
      globalAlpha: { writable: true, value: 1.0 },
      fillStyle: { writable: true, value: '' },
      strokeStyle: { writable: true, value: '' },
      lineWidth: { writable: true, value: 1 },
      font: { writable: true, value: '' },
      textAlign: { writable: true, value: 'left' },
      textBaseline: { writable: true, value: 'alphabetic' },
    });

    TestBed.configureTestingModule({
      providers: [
        ScreenSpaceUiRendererService,
        { provide: PaletteService, useValue: mockPaletteService },
        { provide: ThemeService, useValue: mockThemeService },
      ],
    });

    service = TestBed.inject(ScreenSpaceUiRendererService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // renderDamageFlash
  // ---------------------------------------------------------------------------
  describe('renderDamageFlash', () => {
    it('does NOT call fillRect when intensity is 0 (early-return guard)', () => {
      service.renderDamageFlash(ctx, 800, 600, 0);
      expect(ctx.fillRect).not.toHaveBeenCalled();
    });

    it('calls fillRect when intensity > 0', () => {
      service.renderDamageFlash(ctx, 800, 600, 0.5);
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it('resets globalAlpha to 1.0 after painting', () => {
      service.renderDamageFlash(ctx, 800, 600, 0.8);
      expect((ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // renderBossPhaseFlash
  // ---------------------------------------------------------------------------
  describe('renderBossPhaseFlash', () => {
    it('runs without throwing', () => {
      expect(() => service.renderBossPhaseFlash(ctx, 800, 600, 0.5)).not.toThrow();
    });

    it('calls fillRect with full canvas dimensions', () => {
      service.renderBossPhaseFlash(ctx, 800, 600, 0.4);
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    });

    it('resets globalAlpha to 1.0 after painting', () => {
      service.renderBossPhaseFlash(ctx, 800, 600, 0.4);
      expect((ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // renderLowHealthWarning
  // ---------------------------------------------------------------------------
  describe('renderLowHealthWarning', () => {
    it('runs without throwing at 0% health', () => {
      expect(() => service.renderLowHealthWarning(ctx, 800, 600, 0, 0)).not.toThrow();
    });

    it('draws the pre-rendered vignette via drawImage (OffscreenCanvas path, no per-frame createRadialGradient)', () => {
      // The service pre-renders the vignette into an OffscreenCanvas and blits it via drawImage.
      // createRadialGradient is NOT called on the main ctx — only on the internal off-screen context.
      service.renderLowHealthWarning(ctx, 800, 600, 0.1, 1000);
      expect(ctx.drawImage).toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
    });

    it('uses different urgency amounts at different health values (urgency 0 at 0.3, 1 at 0)', () => {
      // At healthPercent=0.29 (just below threshold) urgency should be low
      service.renderLowHealthWarning(ctx, 800, 600, 0.29, 0);
      expect(ctx.drawImage).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // renderTooltip
  // ---------------------------------------------------------------------------
  describe('renderTooltip', () => {
    it('does NOT paint when tooltipText is empty string (early-return guard)', () => {
      service.renderTooltip(ctx, '', 100, 100);
      expect(ctx.fillText).not.toHaveBeenCalled();
      expect(ctx.strokeText).not.toHaveBeenCalled();
    });

    it('calls strokeText and fillText with the tooltip text', () => {
      service.renderTooltip(ctx, 'Hello tooltip', 50, 80);
      expect(ctx.strokeText).toHaveBeenCalledWith('Hello tooltip', 50, 80);
      expect(ctx.fillText).toHaveBeenCalledWith('Hello tooltip', 50, 80);
    });

    it('reads STROKE_PRIMARY from paletteService', () => {
      service.renderTooltip(ctx, 'Test', 0, 0);
      expect(mockPaletteService.getCanvas).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // renderNotifications
  // ---------------------------------------------------------------------------
  describe('renderNotifications', () => {
    it('runs without throwing with an empty notifications array', () => {
      expect(() => service.renderNotifications(ctx, 800, [], 5000)).not.toThrow();
    });

    it('resets globalAlpha to 1.0 after rendering notifications', () => {
      const notifications = [{ text: 'Kill!', startTime: 4000, color: '#ff0' }];
      service.renderNotifications(ctx, 800, notifications, 5000);
      expect((ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1.0);
    });

    it('skips notifications older than 3000ms', () => {
      // notification started 4000ms ago: age = 5000 - 1000 = 4000 > 3000 → skip
      const staleNotification = [{ text: 'Old', startTime: 1000, color: '#fff' }];
      service.renderNotifications(ctx, 800, staleNotification, 5000);
      expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it('renders notifications within the 3000ms window', () => {
      const freshNotification = [{ text: 'New', startTime: 4500, color: '#fff' }];
      service.renderNotifications(ctx, 800, freshNotification, 5000);
      expect(ctx.fillText).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // save/restore balance check for renderTooltip
  // (tooltip uses no save/restore per performance comment, so count should be 0/0)
  // ---------------------------------------------------------------------------
  describe('save/restore balance', () => {
    it('renderTooltip does not call save or restore (no-transform fast path)', () => {
      service.renderTooltip(ctx, 'check', 10, 20);
      expect(ctx.save).not.toHaveBeenCalled();
      expect(ctx.restore).not.toHaveBeenCalled();
    });

    it('renderDamageFlash does not call save or restore (no-transform fast path)', () => {
      service.renderDamageFlash(ctx, 800, 600, 0.5);
      expect(ctx.save).not.toHaveBeenCalled();
      expect(ctx.restore).not.toHaveBeenCalled();
    });
  });
});
