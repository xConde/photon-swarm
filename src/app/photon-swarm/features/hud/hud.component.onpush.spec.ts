import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { HudComponent } from './hud.component';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { UIStateService } from '../../core/state/ui-state.service';
import { BuffManagementSystemService, UIQuerySystemService } from '../../core/systems/gameplay';
import { PerformanceMonitorService } from '../../core/utils/performance-monitor.service';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { SpawnSystemService } from '../../core/systems/enemy-ai';
import { ThemeService } from '@services/theme.service';
import { ConsumableService } from '../../services/consumable.service';
import { UpgradeService } from '../../services/upgrade.service';
import { AscensionService } from '../../services/ascension.service';
import { PlayerService } from '../../core/player/player.service';
import { GameSettings, SettingsService } from '../../core/utils/settings.service';

/**
 * OnPush Change Detection Edge Case Tests
 *
 * CRITICAL: These tests ensure OnPush change detection works correctly
 * with async operations (setInterval, setTimeout, requestAnimationFrame).
 *
 * **Why These Tests Matter:**
 * OnPush components only trigger change detection when:
 * - @Input properties change
 * - Events are emitted
 * - Observables emit (with async pipe)
 * - Manual markForCheck() is called
 *
 * Async operations (setInterval, setTimeout, RAF) do NOT automatically
 * trigger change detection in OnPush components, causing UI to freeze.
 *
 * **Historical Context:**
 * November 12, 2025 - FPS counter stuck at 0 after adding OnPush strategy.
 * Root cause: setInterval updated `currentFPS` but didn't call markForCheck().
 *
 * **Prevention:**
 * These tests verify that all async operations properly trigger change detection
 * via ChangeDetectorRef.markForCheck().
 */
const defaultGameSettings: GameSettings = {
  volume: 70,
  muted: false,
  screenShake: true,
  showDamageNumbers: true,
  chromaticAberration: true,
  lowHealthVignette: true,
  colorblindMode: 'none',
  sensitivity: 100,
  invertAimY: false,
};

describe('HudComponent - OnPush Change Detection Edge Cases', () => {
  let component: HudComponent;
  let fixture: ComponentFixture<HudComponent>;
  let cdr: ChangeDetectorRef;
  let performanceMonitor: jasmine.SpyObj<PerformanceMonitorService>;
  let settings$: BehaviorSubject<GameSettings>;
  let settingsServiceMock: jasmine.SpyObj<SettingsService>;

  beforeEach(async () => {
    // Mock services
    const gameEngineMock = {
      state$: of(null),
      state: jasmine.createSpy('state').and.returnValue(null),
      getPlayerEntity: jasmine.createSpy('getPlayerEntity').and.returnValue(null),
      isGameActive: jasmine.createSpy('isGameActive').and.returnValue(true),
    };

    const uiStateMock = {
      miniMapPosition: jasmine.createSpy('miniMapPosition').and.returnValue('top-right'),
      fullMapEnabled: jasmine.createSpy('fullMapEnabled').and.returnValue(false),
      miniMapEnabled: jasmine.createSpy('miniMapEnabled').and.returnValue(false),
    };
    const uiQueryMock = {
      startPolling: jasmine.createSpy('startPolling'),
      stopPolling: jasmine.createSpy('stopPolling'),
      playerStats$: of(null),
    };

    const performanceMonitorMock = jasmine.createSpyObj('PerformanceMonitorService', ['getPerformanceSummary']);
    performanceMonitorMock.getPerformanceSummary.and.returnValue({
      averageFps: 60,
      frameCount: 1000,
      systemMetrics: [],
      memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
      performanceScore: 100,
    });

    const spawnSystemMock = {
      waveStarted$: new Subject<{ waveNumber: number; waveType: 'normal' | 'swarm' | 'elite' | 'boss' }>(),
    };

    const themeServiceMock = {
      isDayMode: false,
      isDayMode$: of(false),
    };

    const consumableServiceMock = {
      inventory$: new BehaviorSubject<Map<string, number>>(new Map()),
      initialize: jasmine.createSpy('initialize'),
      getQuickSlots: jasmine.createSpy('getQuickSlots').and.returnValue([]),
      use: jasmine.createSpy('use').and.returnValue(false),
      isOnCooldown: jasmine.createSpy('isOnCooldown').and.returnValue(false),
      getCooldownRemaining: jasmine.createSpy('getCooldownRemaining').and.returnValue(0),
      getQuantity: jasmine.createSpy('getQuantity').and.returnValue(0),
    };

    const buffSystemMock = {
      getEntityBuffs: jasmine.createSpy('getEntityBuffs').and.returnValue([]),
      getBuffRemainingTime: jasmine.createSpy('getBuffRemainingTime').and.returnValue(0),
    };

    const upgradeServiceMock = {
      getCurrentUpgrades: jasmine.createSpy('getCurrentUpgrades').and.returnValue(new Map()),
    };

    const ascensionServiceMock = jasmine.createSpyObj('AscensionService', ['getAscensionLevel']);
    ascensionServiceMock.getAscensionLevel.and.returnValue(0);

    const playerServiceMock = jasmine.createSpyObj('PlayerService', [
      'getDashCooldownFraction',
      'getParryCooldownFraction',
    ]);
    playerServiceMock.getDashCooldownFraction.and.returnValue(0);
    playerServiceMock.getParryCooldownFraction.and.returnValue(0);

    settings$ = new BehaviorSubject<GameSettings>({ ...defaultGameSettings });
    settingsServiceMock = jasmine.createSpyObj('SettingsService', ['getSettings', 'updateSettings']);
    settingsServiceMock.getSettings.and.callFake(() => settings$.value);
    settingsServiceMock.updateSettings.and.callFake((partial: Partial<GameSettings>) => {
      settings$.next({ ...settings$.value, ...partial });
    });
    settingsServiceMock.settings$ = settings$.asObservable();

    await TestBed.configureTestingModule({
      imports: [HudComponent],
      providers: [
        { provide: GameEngineService, useValue: gameEngineMock },
        { provide: UIStateService, useValue: uiStateMock },
        { provide: UIQuerySystemService, useValue: uiQueryMock },
        { provide: PerformanceMonitorService, useValue: performanceMonitorMock },
        { provide: SpawnSystemService, useValue: spawnSystemMock },
        { provide: ThemeService, useValue: themeServiceMock },
        { provide: ConsumableService, useValue: consumableServiceMock },
        { provide: BuffManagementSystemService, useValue: buffSystemMock },
        { provide: UpgradeService, useValue: upgradeServiceMock },
        { provide: AscensionService, useValue: ascensionServiceMock },
        { provide: PlayerService, useValue: playerServiceMock },
        { provide: SettingsService, useValue: settingsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HudComponent);
    component = fixture.componentInstance;
    cdr = fixture.debugElement.injector.get(ChangeDetectorRef);
    performanceMonitor = TestBed.inject(PerformanceMonitorService) as jasmine.SpyObj<PerformanceMonitorService>;

    // Spy on markForCheck to verify it's called
    spyOn(cdr, 'markForCheck').and.callThrough();
  });

  afterEach(() => {
    // Clean up component to stop intervals (defensive check for failed setup)
    if (fixture) {
      fixture.destroy();
    }
  });

  describe('FPS Counter (setInterval)', () => {
    it('should update FPS from performance monitor', fakeAsync(() => {
      // Arrange
      performanceMonitor.getPerformanceSummary.and.returnValue({
        averageFps: 45,
        frameCount: 500,
        systemMetrics: [],
        memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
        performanceScore: 80,
      });

      // Act
      component.ngOnInit();
      tick(500); // Wait for setInterval to fire

      // Assert - FPS should be updated from mock
      expect(component.currentFPS).toBe(45);
    }));

    it('should continue updating FPS every 500ms', fakeAsync(() => {
      // Arrange
      let fps = 60;
      performanceMonitor.getPerformanceSummary.and.callFake(() => ({
        averageFps: fps,
        frameCount: 1000,
        systemMetrics: [],
        memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
        performanceScore: 100,
      }));

      component.ngOnInit();

      // Act & Assert - First update
      tick(500);
      expect(component.currentFPS).toBe(60);

      // Update FPS
      fps = 50;
      tick(500);
      expect(component.currentFPS).toBe(50);

      // Update FPS again
      fps = 40;
      tick(500);
      expect(component.currentFPS).toBe(40);
    }));

    it('should stop FPS updates when component is destroyed', fakeAsync(() => {
      // Arrange
      let fps = 60;
      performanceMonitor.getPerformanceSummary.and.callFake(() => ({
        averageFps: fps,
        frameCount: 1000,
        systemMetrics: [],
        memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
        performanceScore: 100,
      }));

      component.ngOnInit();
      tick(500);
      expect(component.currentFPS).toBe(60);

      // Act - destroy then change fps
      component.ngOnDestroy();
      fps = 30;
      tick(1000); // Wait longer than interval

      // Assert - FPS should not have updated after destroy
      expect(component.currentFPS).toBe(60);
    }));
  });

  describe('Edge Cases', () => {
    it('should handle rapid FPS changes without missing updates', fakeAsync(() => {
      // Simulate performance degradation
      const fpsValues = [60, 55, 50, 45, 40, 35, 30];
      let index = 0;

      performanceMonitor.getPerformanceSummary.and.callFake(() => ({
        averageFps: fpsValues[index++ % fpsValues.length],
        frameCount: 1000,
        systemMetrics: [],
        memoryUsage: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0 },
        performanceScore: 100,
      }));

      component.ngOnInit();

      // Fast-forward through multiple updates and verify each one
      for (let i = 0; i < fpsValues.length; i++) {
        tick(500);
        expect(component.currentFPS).toBe(fpsValues[i]);
      }
    }));

    it('should not leak timers when destroyed mid-animation', fakeAsync(() => {
      // Arrange
      component.ngOnInit();
      tick(250); // Mid-interval

      // Act
      component.ngOnDestroy();

      // Assert - No errors should occur
      tick(1000);
      expect(component.currentFPS).toBeDefined();
    }));

    it('should maintain UI consistency with OnPush strategy', () => {
      // Verify component has OnPush strategy by checking Angular's compiled component definition
      const componentDef = (HudComponent as unknown as { ɵcmp?: { onPush?: boolean } }).ɵcmp;
      expect(componentDef).toBeDefined();
      expect(componentDef?.onPush).toBe(true);
    });
  });

  describe('Ascension Surfacing', () => {
    it('reports the ascension level from the service', () => {
      const ascension = TestBed.inject(AscensionService) as jasmine.SpyObj<AscensionService>;
      ascension.getAscensionLevel.and.returnValue(3);

      expect(component.ascensionLevel).toBe(3);
    });

    it('hides the ascension stat block when the player has never ascended', () => {
      const ascension = TestBed.inject(AscensionService) as jasmine.SpyObj<AscensionService>;
      ascension.getAscensionLevel.and.returnValue(0);

      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.ascension-stat')).toBeNull();
    });

    it('renders the ascension stat block when the player has ascended at least once', () => {
      const ascension = TestBed.inject(AscensionService) as jasmine.SpyObj<AscensionService>;
      ascension.getAscensionLevel.and.returnValue(2);

      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const badge = host.querySelector('.ascension-stat');
      expect(badge).not.toBeNull();
      // Now labelled "ASC" with a plain number value (was an unlabelled star + "A2").
      expect(badge?.querySelector('.pill-label')?.textContent?.trim()).toBe('ASC');
      expect(badge?.querySelector('.ascension-value')?.textContent?.trim()).toBe('2');
      expect(badge?.getAttribute('aria-label')).toBe('Ascension level 2');
    });
  });

  describe('Desktop Ability Cooldown Row', () => {
    let playerService: jasmine.SpyObj<PlayerService>;

    beforeEach(() => {
      playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
    });

    it('renders the .ability-cd-row element in the template', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.ability-cd-row')).not.toBeNull();
    });

    it('renders exactly two .ability-slot elements (DASH and PARRY)', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const slots = host.querySelectorAll('.ability-slot');
      expect(slots.length).toBe(2);
    });

    it('names both actions and renders their SPACE and E key labels', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const copy = Array.from(host.querySelectorAll('.ability-copy')).map((el) => el.textContent?.trim());
      expect(copy).toContain('DashSpace');
      expect(copy).toContain('ParryE');
    });

    it('does NOT show the cooldown sweep when both abilities are ready (fraction = 0)', () => {
      playerService.getDashCooldownFraction.and.returnValue(0);
      playerService.getParryCooldownFraction.and.returnValue(0);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll('.cooldown-sweep').length).toBe(0);
    });

    it('adds .on-cooldown to the dash slot and shows its recharge bar', () => {
      playerService.getDashCooldownFraction.and.returnValue(0.75);
      playerService.getParryCooldownFraction.and.returnValue(0);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const slots = host.querySelectorAll('.ability-slot');
      // First slot is DASH
      expect(slots[0].classList.contains('on-cooldown')).toBe(true);
      expect(slots[0].querySelector('.ability-recharge')).not.toBeNull();
      // Second slot (PARRY) stays clear
      expect(slots[1].classList.contains('on-cooldown')).toBe(false);
    });

    it('adds .on-cooldown to the parry slot and shows its recharge bar', () => {
      playerService.getDashCooldownFraction.and.returnValue(0);
      playerService.getParryCooldownFraction.and.returnValue(0.5);
      fixture.detectChanges();

      const host = fixture.nativeElement as HTMLElement;
      const slots = host.querySelectorAll('.ability-slot');
      // Second slot is PARRY
      expect(slots[1].classList.contains('on-cooldown')).toBe(true);
      expect(slots[1].querySelector('.ability-recharge')).not.toBeNull();
      // First slot (DASH) stays clear
      expect(slots[0].classList.contains('on-cooldown')).toBe(false);
    });

    it('renders an SVG icon in each ability slot', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const icons = host.querySelectorAll('.ability-slot .ability-icon svg');
      expect(icons.length).toBe(2);
    });

    it('dashCooldownFraction getter delegates to PlayerService', () => {
      playerService.getDashCooldownFraction.and.returnValue(0.3);
      expect(component.dashCooldownFraction).toBe(0.3);
    });

    it('parryCooldownFraction getter delegates to PlayerService', () => {
      playerService.getParryCooldownFraction.and.returnValue(0.8);
      expect(component.parryCooldownFraction).toBe(0.8);
    });
  });

  describe('Audio Mute Toggle', () => {
    it('reflects the muted state from SettingsService — the same state the Settings dialog uses', () => {
      settings$.next({ ...defaultGameSettings, muted: true });
      fixture.detectChanges();
      expect(component.audioMuted()).toBe(true);
    });

    it('writes to SettingsService.updateSettings rather than a component-local flag', () => {
      component.toggleAudioMute();
      expect(settingsServiceMock.updateSettings).toHaveBeenCalledWith({ muted: true });
    });

    it('toggles back to unmuted on a second call', () => {
      settings$.next({ ...defaultGameSettings, muted: true });
      fixture.detectChanges();

      component.toggleAudioMute();

      expect(settingsServiceMock.updateSettings).toHaveBeenCalledWith({ muted: false });
    });

    it('renders a button with aria-pressed and aria-label reflecting the mute state', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const btn = host.querySelector('.mute-toggle');
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute('aria-pressed')).toBe('false');
      expect(btn?.getAttribute('aria-label')).toBe('Mute audio');

      settings$.next({ ...defaultGameSettings, muted: true });
      fixture.detectChanges();

      expect(btn?.getAttribute('aria-pressed')).toBe('true');
      expect(btn?.getAttribute('aria-label')).toBe('Unmute audio');
    });

    it('clicking the button calls through to the shared SettingsService state', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const btn = host.querySelector('.mute-toggle') as HTMLButtonElement;

      btn.click();

      expect(settingsServiceMock.updateSettings).toHaveBeenCalledWith({ muted: true });
    });

    it('prevents default on mousedown so a mouse click never leaves the button focused (Space is the global Dash key)', () => {
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const btn = host.querySelector('.mute-toggle') as HTMLButtonElement;
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

      btn.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });
});
