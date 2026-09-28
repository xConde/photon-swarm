import { TestBed } from '@angular/core/testing';
import { PaletteService } from './palette.service';
import { ThemeService } from '@services/theme.service';
import { SettingsService } from '../core/utils/settings.service';

describe('PaletteService', () => {
  let service: PaletteService;
  let themeService: { isDayMode: boolean };
  let settingsService: jasmine.SpyObj<SettingsService>;

  beforeEach(() => {
    themeService = { isDayMode: false };
    settingsService = jasmine.createSpyObj('SettingsService', ['getSettings']);
    settingsService.getSettings.and.returnValue({
      volume: 70,
      screenShake: true,
      showDamageNumbers: true,
      chromaticAberration: true,
      lowHealthVignette: true,
      colorblindMode: 'none',
      sensitivity: 100,
    });

    TestBed.configureTestingModule({
      providers: [
        PaletteService,
        { provide: ThemeService, useValue: themeService },
        { provide: SettingsService, useValue: settingsService },
      ],
    });
    service = TestBed.inject(PaletteService);
  });

  it('returns a full palette with CANVAS and MINIMAP sections', () => {
    const palette = service.getPalette();
    expect(palette.CANVAS).toBeDefined();
    expect(palette.MINIMAP).toBeDefined();
    expect(palette.TEXT).toBeDefined();
  });

  it('getCanvas / getMinimap are thin sub-accessors', () => {
    const palette = service.getPalette();
    expect(service.getCanvas()).toBe(palette.CANVAS);
    expect(service.getMinimap()).toBe(palette.MINIMAP);
  });

  describe('memoization', () => {
    it('returns the same palette reference across consecutive reads when neither input changes', () => {
      const a = service.getPalette();
      const b = service.getPalette();
      expect(a).toBe(b);
    });

    it('invalidates the cache when the colorblind mode changes', () => {
      const noneCanvas = service.getCanvas();

      settingsService.getSettings.and.returnValue({
        ...settingsService.getSettings(),
        colorblindMode: 'protanopia',
      });
      const protCanvas = service.getCanvas();

      expect(protCanvas).not.toBe(noneCanvas);
      // Protanopia substitutes red signals — pinning the contract here.
      expect(protCanvas.HEALTH_LOW).not.toBe(noneCanvas.HEALTH_LOW);
    });

    it('invalidates the cache when the theme mode flips', () => {
      const dark = service.getPalette();
      themeService.isDayMode = true;
      const light = service.getPalette();
      expect(light).not.toBe(dark);
    });

    it("with mode 'none' the underlying THEME_COLORS object is the source of truth — flipping back is reference-equal", () => {
      const dark = service.getPalette();
      themeService.isDayMode = true;
      service.getPalette(); // miss, populates LIGHT
      themeService.isDayMode = false;
      const darkAgain = service.getPalette();
      // applyColorblindOverrides('none') returns the input unchanged,
      // so both readings of the dark palette resolve to the same
      // THEME_COLORS.DARK constant.
      expect(darkAgain).toBe(dark);
    });
  });

  describe('colorblind substitution applied to the returned palette', () => {
    it('protanopia mutates the danger ramp', () => {
      settingsService.getSettings.and.returnValue({
        ...settingsService.getSettings(),
        colorblindMode: 'protanopia',
      });
      const canvas = service.getCanvas();
      expect(canvas.HEALTH_LOW).toBe('#ff8c1a');
    });

    it('deuteranopia mutates the health-high ramp', () => {
      settingsService.getSettings.and.returnValue({
        ...settingsService.getSettings(),
        colorblindMode: 'deuteranopia',
      });
      const canvas = service.getCanvas();
      expect(canvas.HEALTH_HIGH).toBe('#22d3ee');
    });

    it('tritanopia mutates the beam color', () => {
      settingsService.getSettings.and.returnValue({
        ...settingsService.getSettings(),
        colorblindMode: 'tritanopia',
      });
      const canvas = service.getCanvas();
      expect(canvas.BEAM).toBe('#cc66ff');
    });
  });
});
