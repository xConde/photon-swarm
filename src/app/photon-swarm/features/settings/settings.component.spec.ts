import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SettingsComponent } from './settings.component';
import { GameSettings, SettingsService } from '../../core/utils/settings.service';
import { AudioService } from '../../core/audio/audio.service';
import { ThemeService } from '@services/theme.service';
import { BindableAction, KeyBindingService, KeyBindingsMap } from '../../core/controls/key-binding.service';
import { GameControlsService } from '../../core/controls/game-controls.service';
import { BehaviorSubject, of } from 'rxjs';

describe('SettingsComponent', () => {
  let component: SettingsComponent;
  let fixture: ComponentFixture<SettingsComponent>;
  let mockSettingsService: jasmine.SpyObj<SettingsService>;
  let mockAudioService: jasmine.SpyObj<AudioService>;
  let mockKeyBindingService: jasmine.SpyObj<KeyBindingService>;
  let mockGameControlsService: jasmine.SpyObj<GameControlsService>;
  let settings$: BehaviorSubject<GameSettings>;
  let bindings$: BehaviorSubject<KeyBindingsMap>;

  const defaultSettings: GameSettings = {
    volume: 70,
    screenShake: true,
    showDamageNumbers: true,
    chromaticAberration: true,
    lowHealthVignette: true,
    colorblindMode: 'none',
    sensitivity: 100,
    invertAimY: false,
  };

  const defaultBindings: KeyBindingsMap = {
    moveUp: 'w',
    moveDown: 's',
    moveLeft: 'a',
    moveRight: 'd',
    dash: ' ',
    parry: 'e',
    flightMode: 'shift',
    mapToggle: 'm',
  };

  beforeEach(async () => {
    settings$ = new BehaviorSubject<GameSettings>({ ...defaultSettings });
    bindings$ = new BehaviorSubject<KeyBindingsMap>({ ...defaultBindings });

    mockSettingsService = jasmine.createSpyObj('SettingsService', ['getSettings', 'updateSettings', 'resetToDefaults']);
    mockSettingsService.getSettings.and.returnValue({ ...defaultSettings });
    mockSettingsService.settings$ = settings$.asObservable();

    mockAudioService = jasmine.createSpyObj('AudioService', ['isMuted', 'toggleMute', 'setVolume']);
    mockAudioService.isMuted.and.returnValue(false);

    mockKeyBindingService = jasmine.createSpyObj('KeyBindingService', ['setKey', 'resetDefaults', 'getBindings']);
    mockKeyBindingService.bindings$ = bindings$.asObservable();
    mockKeyBindingService.setKey.and.returnValue({ success: true });

    mockGameControlsService = jasmine.createSpyObj('GameControlsService', [
      'getControlsForState',
      'getCooldowns',
      'getPlayerActionState',
    ]);
    mockGameControlsService.getControlsForState.and.returnValue([]);
    mockGameControlsService.getCooldowns.and.returnValue(of(new Map()));
    mockGameControlsService.getPlayerActionState.and.returnValue(
      of({
        isMoving: false,
        isDashing: false,
        isTargeting: false,
        isCombat: false,
        mapOpened: false,
        dashCooldownPercent: 0,
      })
    );

    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: AudioService, useValue: mockAudioService },
        { provide: KeyBindingService, useValue: mockKeyBindingService },
        { provide: GameControlsService, useValue: mockGameControlsService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load initial settings from SettingsService', () => {
      expect(mockSettingsService.getSettings).toHaveBeenCalled();
      expect(component.settings().volume).toBe(70);
      expect(component.settings().screenShake).toBe(true);
    });

    it('should reflect muted state from AudioService', () => {
      expect(mockAudioService.isMuted).toHaveBeenCalled();
      expect(component.audioMuted()).toBe(false);
    });

    it('should build key binding rows from service bindings', () => {
      expect(component.keyBindingRows().length).toBeGreaterThan(0);
    });

    it('should start with no active rebind action', () => {
      expect(component.rebindingAction()).toBeNull();
    });

    it('should start with no conflict warning', () => {
      expect(component.conflictWarning()).toBe('');
    });
  });

  it('offers dark and light modes in settings and resets to dark', () => {
    fixture.componentRef.setInput('isVisible', true);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('#setting-theme') as HTMLSelectElement | null;
    const theme = TestBed.inject(ThemeService);
    expect(select).not.toBeNull();
    expect(select!.value).toBe('dark');

    select!.value = 'light';
    select!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(theme.isDayMode).toBeTrue();

    component.resetToDefaults();
    fixture.detectChanges();
    expect(theme.isDayMode).toBeFalse();
  });

  describe('settings changes', () => {
    it('should update volume signal and call AudioService', () => {
      component.updateVolume(50);
      expect(component.settings().volume).toBe(50);
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(jasmine.objectContaining({ volume: 50 }));
    });

    it('should round volume to integer', () => {
      component.updateVolume(72.6);
      expect(component.settings().volume).toBe(73);
    });

    it('should update sensitivity signal', () => {
      component.updateSensitivity(150);
      expect(component.settings().sensitivity).toBe(150);
    });

    it('should round sensitivity to integer', () => {
      component.updateSensitivity(123.7);
      expect(component.settings().sensitivity).toBe(124);
    });

    it('should toggle screenShake', () => {
      const initial = component.settings().screenShake;
      component.toggleScreenShake();
      expect(component.settings().screenShake).toBe(!initial);
      expect(mockSettingsService.updateSettings).toHaveBeenCalled();
    });

    it('should toggle showDamageNumbers', () => {
      const initial = component.settings().showDamageNumbers;
      component.toggleShowDamageNumbers();
      expect(component.settings().showDamageNumbers).toBe(!initial);
      expect(mockSettingsService.updateSettings).toHaveBeenCalled();
    });

    it('should expose and persist hit distortion', () => {
      component.toggleChromaticAberration();

      expect(component.settings().chromaticAberration).toBeFalse();
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        jasmine.objectContaining({ chromaticAberration: false })
      );
    });

    it('should expose and persist the low-health warning', () => {
      component.toggleLowHealthVignette();

      expect(component.settings().lowHealthVignette).toBeFalse();
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        jasmine.objectContaining({ lowHealthVignette: false })
      );
    });

    it('should toggle audio mute and update signal', () => {
      mockAudioService.isMuted.and.returnValue(true);
      component.toggleAudioMute();
      expect(mockAudioService.toggleMute).toHaveBeenCalled();
      expect(component.audioMuted()).toBe(true);
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(jasmine.objectContaining({ muted: true }));
    });

    it('should update settings signal when settings$ emits', () => {
      const updated: GameSettings = { ...defaultSettings, volume: 30 };
      settings$.next(updated);
      expect(component.settings().volume).toBe(30);
    });

    it('updateColorblindMode mutates the local settings signal', () => {
      component.updateColorblindMode('protanopia');
      expect(component.settings().colorblindMode).toBe('protanopia');
    });

    it('updateColorblindMode persists immediately to the SettingsService', () => {
      component.updateColorblindMode('deuteranopia');
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(
        jasmine.objectContaining({ colorblindMode: 'deuteranopia' })
      );
    });

    it('the colorblind <select> exposes exactly the four canonical modes — pins UI/enum drift', () => {
      // Sprint A6 added a native <select> for colorblindMode. The option
      // values must match COLORBLIND_MODES exactly; if the enum gains a
      // fifth mode and the template forgets to add the option, this spec
      // fires before the bug ships.
      fixture.componentRef.setInput('isVisible', true);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const select = host.querySelector<HTMLSelectElement>('#setting-colorblind-mode');
      expect(select).withContext('Colorblind select missing from settings modal').not.toBeNull();
      if (!select) return;
      const optionValues = Array.from(select.options).map((o) => o.value);
      // Order matches the canonical roster in SettingsService.
      expect(optionValues).toEqual(['none', 'protanopia', 'deuteranopia', 'tritanopia']);
    });
  });

  describe('Done action', () => {
    it('should emit close because every setting is already persisted', () => {
      const closeSpy = jasmine.createSpy('close');
      component.close.subscribe(closeSpy);
      component.closeSettings();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('resetToDefaults', () => {
    it('should call resetToDefaults on both services', () => {
      component.resetToDefaults();
      expect(mockSettingsService.resetToDefaults).toHaveBeenCalled();
      expect(mockKeyBindingService.resetDefaults).toHaveBeenCalled();
    });
  });

  describe('keyboard handling', () => {
    function dispatchKey(key: string): void {
      const event = new KeyboardEvent('keydown', { key, bubbles: true });
      document.dispatchEvent(event);
    }

    it('should close modal on Escape when visible and not in rebind mode', () => {
      fixture.componentRef.setInput('isVisible', true);
      fixture.detectChanges();

      const closeSpy = jasmine.createSpy('close');
      component.close.subscribe(closeSpy);

      dispatchKey('Escape');
      expect(closeSpy).toHaveBeenCalled();
    });

    it('should not close modal on Escape when isVisible is false', () => {
      fixture.componentRef.setInput('isVisible', false);
      fixture.detectChanges();

      const closeSpy = jasmine.createSpy('close');
      component.close.subscribe(closeSpy);

      dispatchKey('Escape');
      expect(closeSpy).not.toHaveBeenCalled();
    });

    describe('rebind mode', () => {
      const action: BindableAction = 'dash';

      beforeEach(() => {
        component.startRebind(action);
        fixture.detectChanges();
      });

      it('should set rebindingAction when startRebind is called', () => {
        expect(component.rebindingAction()).toBe(action);
      });

      it('should cancel rebind mode on Escape without closing modal', () => {
        const closeSpy = jasmine.createSpy('close');
        component.close.subscribe(closeSpy);

        dispatchKey('Escape');

        expect(component.rebindingAction()).toBeNull();
        expect(component.conflictWarning()).toBe('');
        expect(closeSpy).not.toHaveBeenCalled();
      });

      it('should apply key binding on non-Escape key when setKey succeeds', () => {
        mockKeyBindingService.setKey.and.returnValue({ success: true });
        dispatchKey('f');

        expect(mockKeyBindingService.setKey).toHaveBeenCalledWith(action, 'f');
        expect(component.rebindingAction()).toBeNull();
        expect(component.conflictWarning()).toBe('');
      });

      it('should show conflict warning when setKey returns a conflict', () => {
        mockKeyBindingService.setKey.and.returnValue({ success: false, conflictAction: 'moveUp' });
        dispatchKey('w');

        expect(component.rebindingAction()).toBe(action);
        expect(component.conflictWarning()).toContain('Move Up');
      });

      it('should clear conflict warning when startRebind is called again', () => {
        component.conflictWarning.set('some warning');
        component.startRebind('parry');
        expect(component.conflictWarning()).toBe('');
      });
    });
  });

  describe('resetKeyBindings', () => {
    it('should reset key binding service and clear rebind state', () => {
      component.startRebind('dash');
      component.conflictWarning.set('some conflict');

      component.resetKeyBindings();

      expect(mockKeyBindingService.resetDefaults).toHaveBeenCalled();
      expect(component.rebindingAction()).toBeNull();
      expect(component.conflictWarning()).toBe('');
    });
  });

  describe('closeModal', () => {
    it('should clear rebind state and emit close', () => {
      component.startRebind('dash');
      component.conflictWarning.set('warning');

      const closeSpy = jasmine.createSpy('close');
      component.close.subscribe(closeSpy);

      component.closeModal();

      expect(component.rebindingAction()).toBeNull();
      expect(component.conflictWarning()).toBe('');
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('getKeyDisplayName', () => {
    it('should delegate to KeyBindingService static method', () => {
      expect(component.getKeyDisplayName(' ')).toBe('SPACE');
      expect(component.getKeyDisplayName('shift')).toBe('SHIFT');
      expect(component.getKeyDisplayName('w')).toBe('W');
    });
  });

  describe('key binding rows', () => {
    it('should update keyBindingRows when bindings$ emits', () => {
      const updated: KeyBindingsMap = { ...defaultBindings, dash: 'q' };
      bindings$.next(updated);
      fixture.detectChanges();

      const dashRow = component.keyBindingRows().find((r) => r.action === 'dash');
      expect(dashRow).toBeDefined();
      expect(dashRow?.key).toBe('q');
    });
  });
});
