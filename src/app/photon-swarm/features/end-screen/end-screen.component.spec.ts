import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EndScreenComponent } from './end-screen.component';
import { AscensionService } from '../../services/ascension.service';
import { PersonalBests, RunHistoryService } from '../../services/run-history.service';
import { GameStats } from '../../core/models/game-state.model';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { IntensityService } from '../../core/systems/combat';

describe('EndScreenComponent', () => {
  let component: EndScreenComponent;
  let fixture: ComponentFixture<EndScreenComponent>;
  let mockAscensionService: jasmine.SpyObj<AscensionService>;
  let mockRunHistoryService: jasmine.SpyObj<RunHistoryService>;
  let intensitySpy: jasmine.SpyObj<IntensityService>;

  const baseStats: GameStats = {
    level: 10,
    shards: 500,
    time: 300, // 5 minutes in seconds
    health: 80,
    maxHealth: 100,
    kills: 50,
    maxKillStreak: 10,
  };

  const emptyBests: PersonalBests = {
    bestKills: 0,
    bestLevel: 0,
    bestTime: 0,
    bestCombo: 0,
  };

  function createComponent(stats: GameStats = baseStats): void {
    fixture = TestBed.createComponent(EndScreenComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('stats', stats);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    mockAscensionService = jasmine.createSpyObj('AscensionService', [
      'canAscend',
      'getAscensionLevel',
      'ascend',
      'getMaxHeatLevel',
      'getRerollCharges',
      'getUnlockForLevel',
    ]);
    mockAscensionService.canAscend.and.returnValue(false);
    mockAscensionService.getAscensionLevel.and.returnValue(0);
    mockAscensionService.ascend.and.returnValue(1);
    mockAscensionService.getMaxHeatLevel.and.returnValue(0);
    mockAscensionService.getRerollCharges.and.returnValue(1);
    mockAscensionService.getUnlockForLevel.and.callFake((level) => `Unlock ${level}`);

    mockRunHistoryService = jasmine.createSpyObj('RunHistoryService', ['getPersonalBests', 'saveRun']);
    mockRunHistoryService.getPersonalBests.and.returnValue({ ...emptyBests });

    intensitySpy = jasmine.createSpyObj('IntensityService', [
      'getCurrentState',
      'getState',
      'getMilestones',
      'getXpMultiplier',
      'start',
      'stop',
      'reset',
      'registerKill',
      'applyDamagePenalty',
    ]);
    intensitySpy.getCurrentState.and.returnValue({
      intensity: 0,
      tier: 'idle',
      peakIntensity: 0.42,
      isRising: false,
      killStreak: 0,
      maxKillStreak: 15,
      isRecovering: false,
    });

    await TestBed.configureTestingModule({
      imports: [EndScreenComponent],
      providers: [
        { provide: AscensionService, useValue: mockAscensionService },
        { provide: RunHistoryService, useValue: mockRunHistoryService },
        { provide: IntensityService, useValue: intensitySpy },
      ],
    }).compileComponents();
  });

  it('should create', () => {
    createComponent();
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should capture previous bests before saving', () => {
      const existingBests: PersonalBests = { bestKills: 30, bestLevel: 8, bestTime: 200, bestCombo: 5 };
      mockRunHistoryService.getPersonalBests.and.returnValue({ ...existingBests });
      createComponent();

      // getPersonalBests called once for snapshot, once by computed signal
      expect(mockRunHistoryService.getPersonalBests).toHaveBeenCalled();
      expect(mockRunHistoryService.saveRun).toHaveBeenCalledWith(jasmine.objectContaining({ level: 10 }), 0);
    });

    it('should save the run with the current ascension level', () => {
      mockAscensionService.getAscensionLevel.and.returnValue(3);
      createComponent();
      expect(mockRunHistoryService.saveRun).toHaveBeenCalledWith(baseStats, 3);
    });
  });

  describe('formattedTime computed signal', () => {
    it('should format seconds to MM:SS', () => {
      createComponent({ ...baseStats, time: 300 });
      expect(component.formattedTime()).toBe('5:00');
    });

    it('should pad seconds below 10 with a zero', () => {
      createComponent({ ...baseStats, time: 65 });
      expect(component.formattedTime()).toBe('1:05');
    });

    it('should handle zero time', () => {
      createComponent({ ...baseStats, time: 0 });
      expect(component.formattedTime()).toBe('0:00');
    });

    it('should handle times over an hour', () => {
      createComponent({ ...baseStats, time: 3661 });
      expect(component.formattedTime()).toBe('61:01');
    });
  });

  describe('canAscend computed signal', () => {
    it('should return false when PRESTIGE_ENABLED is true but canAscend returns false', () => {
      mockAscensionService.canAscend.and.returnValue(false);
      createComponent();
      if (PROGRESSION_CONFIG.PRESTIGE_ENABLED) {
        expect(component.canAscend()).toBe(false);
      } else {
        expect(component.canAscend()).toBe(false);
      }
    });

    it('should return true when PRESTIGE_ENABLED and ascension service allows it', () => {
      mockAscensionService.canAscend.and.returnValue(true);
      createComponent();
      expect(component.canAscend()).toBe(PROGRESSION_CONFIG.PRESTIGE_ENABLED);
    });

    it('should pass the current level to canAscend', () => {
      createComponent({ ...baseStats, level: 15 });
      expect(mockAscensionService.canAscend).toHaveBeenCalledWith(15);
    });
  });

  describe('ascensionLevel computed signal', () => {
    it('should return current ascension level from service', () => {
      mockAscensionService.getAscensionLevel.and.returnValue(2);
      createComponent();
      expect(component.ascensionLevel()).toBe(2);
    });
  });

  describe('nextMasteryUnlock computed signal', () => {
    it('describes the next option unlock instead of permanent stat power', () => {
      mockAscensionService.getAscensionLevel.and.returnValue(0);
      mockAscensionService.getUnlockForLevel.and.returnValue('Heat 1 available');
      createComponent();

      expect(component.nextMasteryUnlock()).toBe('Heat 1 available');
      expect(mockAscensionService.getUnlockForLevel).toHaveBeenCalledWith(1);
    });

    it('reports the Heat level used by the completed run', () => {
      createComponent({ ...baseStats, difficulty: 'extreme' });

      expect(component.heatLevel()).toBe(2);
    });
  });

  describe('currentMasteryUnlocks computed signal', () => {
    it('reports unlocked Heat and refit capacity', () => {
      mockAscensionService.getMaxHeatLevel.and.returnValue(1);
      mockAscensionService.getRerollCharges.and.returnValue(2);
      createComponent();

      expect(component.currentMasteryUnlocks()).toEqual(['Heat 1 available', '2 refit rerolls']);
    });
  });

  describe('run-end variant (Phase 8)', () => {
    it('isVictory is false when stats omit endReason (legacy death paths)', () => {
      createComponent();
      expect(component.isVictory()).toBeFalse();
    });

    it("isVictory is true only when endReason === 'victory'", () => {
      createComponent({ ...baseStats, endReason: 'victory' });
      expect(component.isVictory()).toBeTrue();
    });

    it("isVictory stays false for 'quit'", () => {
      createComponent({ ...baseStats, endReason: 'quit' });
      expect(component.isVictory()).toBeFalse();
    });

    it('headline branches by endReason', () => {
      createComponent({ ...baseStats, endReason: 'death' });
      expect(component.endHeadline()).toBe('Game Over');

      createComponent({ ...baseStats, endReason: 'victory' });
      expect(component.endHeadline()).toBe('Run Complete');

      createComponent({ ...baseStats, endReason: 'quit' });
      expect(component.endHeadline()).toBe('Run Abandoned');
    });

    it('tagline copy is distinct per end reason', () => {
      createComponent({ ...baseStats, endReason: 'death' });
      const deathCopy = component.endTagline();

      createComponent({ ...baseStats, endReason: 'victory' });
      const victoryCopy = component.endTagline();

      expect(victoryCopy).not.toBe(deathCopy);
      expect(victoryCopy.length).toBeGreaterThan(10);
    });

    it('default end-message paragraph no longer renders when ascension panel is absent', () => {
      createComponent({ ...baseStats, endReason: 'death' });
      const host = fixture.nativeElement as HTMLElement;
      // The tagline now lives at the top; the standalone .end-message paragraph
      // was removed so the death and ascension states don't duplicate copy.
      expect(host.querySelector('.end-message')).toBeNull();
      expect(host.querySelector('.end-tagline')).not.toBeNull();
    });

    it('shows the completed run build with stack counts', () => {
      createComponent({
        ...baseStats,
        runBuild: [
          { id: 'core_power', name: 'Power', type: 'upgrade', rarity: 'core', stacks: 2 },
          { id: 'vulnerability', name: 'Shield Fracture', type: 'curse', rarity: 'curse', stacks: 1 },
        ],
      });

      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.run-build')).not.toBeNull();
      expect(host.textContent).toContain('Power');
      expect(host.textContent).toContain('×2');
      expect(host.querySelector('.run-build-item.curse')).not.toBeNull();
    });
  });

  describe('personalBests computed signal', () => {
    it('should return personal bests from run history service', () => {
      const bests: PersonalBests = { bestKills: 100, bestLevel: 20, bestTime: 600, bestCombo: 15 };
      mockRunHistoryService.getPersonalBests.and.returnValue(bests);
      createComponent();
      expect(component.personalBests()).toEqual(bests);
    });
  });

  describe('newRecords computed signal', () => {
    it('should mark all records as new on first run (all zeros)', () => {
      mockRunHistoryService.getPersonalBests.and.returnValue({ ...emptyBests });
      createComponent({ ...baseStats, kills: 5, level: 3, time: 120, maxKillStreak: 3 });

      const records = component.newRecords();
      expect(records.kills).toBe(true);
      expect(records.level).toBe(true);
      expect(records.time).toBe(true);
      expect(records.combo).toBe(true);
    });

    it('should return all false when previousBests is null (before ngOnInit)', () => {
      // Before detectChanges, previousBests is null
      fixture = TestBed.createComponent(EndScreenComponent);
      component = fixture.componentInstance;
      fixture.componentRef.setInput('stats', baseStats);
      // Do NOT call detectChanges (no ngOnInit)

      const records = component.newRecords();
      expect(records.kills).toBe(false);
      expect(records.level).toBe(false);
      expect(records.time).toBe(false);
      expect(records.combo).toBe(false);
    });

    it('should detect new kill record when current run beats previous best', () => {
      mockRunHistoryService.getPersonalBests.and.returnValue({
        bestKills: 40,
        bestLevel: 8,
        bestTime: 200,
        bestCombo: 5,
      });
      createComponent({ ...baseStats, kills: 55, level: 7, time: 180, maxKillStreak: 4 });

      const records = component.newRecords();
      expect(records.kills).toBe(true);
      expect(records.level).toBe(false);
      expect(records.time).toBe(false);
      expect(records.combo).toBe(false);
    });

    it('should not mark record when stats equal previous best', () => {
      mockRunHistoryService.getPersonalBests.and.returnValue({
        bestKills: 50,
        bestLevel: 10,
        bestTime: 300,
        bestCombo: 10,
      });
      createComponent(baseStats);

      const records = component.newRecords();
      expect(records.kills).toBe(false);
      expect(records.level).toBe(false);
      expect(records.time).toBe(false);
      expect(records.combo).toBe(false);
    });
  });

  describe('calculateHealthPercentage', () => {
    it('should return correct health percentage', () => {
      createComponent({ ...baseStats, health: 75, maxHealth: 100 });
      expect(component.calculateHealthPercentage()).toBe(75);
    });

    it('should return 0 when health is 0', () => {
      createComponent({ ...baseStats, health: 0, maxHealth: 100 });
      expect(component.calculateHealthPercentage()).toBe(0);
    });

    it('should return 100 when at full health', () => {
      createComponent({ ...baseStats, health: 100, maxHealth: 100 });
      expect(component.calculateHealthPercentage()).toBe(100);
    });

    it('should clamp to 0 when maxHealth is 0 or undefined', () => {
      createComponent({ ...baseStats, maxHealth: 0 });
      expect(component.calculateHealthPercentage()).toBe(0);
    });

    it('should clamp percentage to [0, 100]', () => {
      createComponent({ ...baseStats, health: 150, maxHealth: 100 });
      expect(component.calculateHealthPercentage()).toBe(100);
    });
  });

  describe('onRestart', () => {
    it('should emit restart event', () => {
      createComponent();
      const restartSpy = jasmine.createSpy('restart');
      component.restart.subscribe(restartSpy);

      component.onRestart();
      expect(restartSpy).toHaveBeenCalled();
    });
  });

  describe('onAscend', () => {
    it('should call ascensionService.ascend and emit ascend event', () => {
      createComponent();
      const ascendSpy = jasmine.createSpy('ascend');
      component.ascend.subscribe(ascendSpy);

      component.onAscend();

      expect(mockAscensionService.ascend).toHaveBeenCalled();
      expect(ascendSpy).toHaveBeenCalled();
    });

    it('should not ascend more than once if called multiple times', () => {
      createComponent();
      component.onAscend();
      component.onAscend();
      component.onAscend();

      expect(mockAscensionService.ascend).toHaveBeenCalledTimes(1);
    });
  });

  describe('formatTime', () => {
    it('should format 90 seconds as 1:30', () => {
      createComponent();
      expect(component.formatTime(90)).toBe('1:30');
    });

    it('should format 3600 seconds as 60:00', () => {
      createComponent();
      expect(component.formatTime(3600)).toBe('60:00');
    });

    it('should pad single-digit seconds', () => {
      createComponent();
      expect(component.formatTime(9)).toBe('0:09');
    });

    it('should not pad double-digit seconds', () => {
      createComponent();
      expect(component.formatTime(75)).toBe('1:15');
    });
  });
});
