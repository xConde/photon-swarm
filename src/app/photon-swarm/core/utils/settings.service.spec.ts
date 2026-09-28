import { TestBed } from '@angular/core/testing';
import { COLORBLIND_MODES, SettingsService } from './settings.service';
import { StorageService } from '../../services/storage.service';
import { CONTROL_CONSTANTS } from '../controls/control-constants';

describe('SettingsService', () => {
  let service: SettingsService;
  let storageSpy: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storageSpy = jasmine.createSpyObj('StorageService', ['get', 'set', 'remove']);

    TestBed.configureTestingModule({
      providers: [SettingsService, { provide: StorageService, useValue: storageSpy }],
    });

    service = TestBed.inject(SettingsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should use centralized control constants', () => {
    expect(CONTROL_CONSTANTS.MOVEMENT_KEYS.includes('w')).toBe(true);
    expect(CONTROL_CONSTANTS.DASH_KEY).toBe(' ');
    expect(CONTROL_CONSTANTS.FLIGHT_MODE_KEY).toBe('shift');
  });

  it('normalizes malformed persisted settings before exposing them to render systems', () => {
    storageSpy.get.and.returnValue({
      volume: 140,
      sensitivity: Number.NaN,
      screenShake: 'yes',
      colorblindMode: 'rainbow',
      invertAimY: true,
    });

    const normalizedService = new SettingsService(storageSpy);

    expect(normalizedService.getSettings()).toEqual({
      volume: 100,
      muted: false,
      screenShake: true,
      showDamageNumbers: true,
      chromaticAberration: true,
      lowHealthVignette: true,
      colorblindMode: 'none',
      sensitivity: 100,
      invertAimY: true,
    });
    expect(storageSpy.set).toHaveBeenCalled();
  });

  it('normalizes numeric updates and retains prior values for invalid enum data', () => {
    service.updateSettings({ volume: 72.6, sensitivity: 999 });
    service.updateSettings({ colorblindMode: 'rainbow' as 'none' });

    expect(service.getSettings().volume).toBe(73);
    expect(service.getSettings().sensitivity).toBe(200);
    expect(service.getSettings().colorblindMode).toBe('none');
  });

  describe('colorblindMode (Sprint A4)', () => {
    it("defaults to 'none' so existing players see the canonical palette on first launch", () => {
      expect(service.getSettings().colorblindMode).toBe('none');
    });

    it('persists a valid colorblind mode via updateSettings', () => {
      service.updateSettings({ colorblindMode: 'protanopia' });
      expect(service.getSettings().colorblindMode).toBe('protanopia');
    });

    it('honors each of the three named CVD modes', () => {
      ['protanopia', 'deuteranopia', 'tritanopia'].forEach((mode) => {
        service.updateSettings({ colorblindMode: mode as 'protanopia' });
        expect(service.getSettings().colorblindMode).withContext(mode).toBe(mode);
      });
    });

    it('drops unknown values rather than persisting them — render layer never sees garbage', () => {
      service.updateSettings({ colorblindMode: 'deuteranopia' });
      // Hand-rolled garbage from a tampered save file:
      service.updateSettings({ colorblindMode: 'rainbow' as 'none' });
      // Previous valid value should remain (the bad update was dropped).
      expect(service.getSettings().colorblindMode).toBe('deuteranopia');
    });

    it('exports COLORBLIND_MODES with exactly four entries — defends against future enum drift', () => {
      expect(COLORBLIND_MODES.length).toBe(4);
      expect(COLORBLIND_MODES).toEqual(['none', 'protanopia', 'deuteranopia', 'tritanopia']);
    });

    it("getSetting('colorblindMode') returns the same value as getSettings().colorblindMode", () => {
      service.updateSettings({ colorblindMode: 'tritanopia' });
      expect(service.getSetting('colorblindMode')).toBe(service.getSettings().colorblindMode);
    });
  });
});
