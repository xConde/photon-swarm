import { TestBed } from '@angular/core/testing';
import { Notification, UIStateService } from './ui-state.service';
import { HoveredItem, HoveredItemType } from '../models/game-types.model';

describe('UIStateService', () => {
  let service: UIStateService;

  beforeEach(() => {
    // Provide a minimal debugLogBridge stub so constructor guard passes silently
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;

    TestBed.configureTestingModule({});
    service = TestBed.inject(UIStateService);
  });

  afterEach(() => {
    (window as Window & { debugLogBridge?: unknown }).debugLogBridge = undefined;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('miniMapEnabled should default to true', () => {
      expect(service.miniMapEnabled()).toBeTrue();
    });

    it('miniMapPosition should default to top-right', () => {
      expect(service.miniMapPosition()).toBe('top-right');
    });

    it('miniMapScale should default to 0.25', () => {
      expect(service.miniMapScale()).toBeCloseTo(0.25, 5);
    });

    it('fullMapEnabled should default to false', () => {
      expect(service.fullMapEnabled()).toBeFalse();
    });

    it('hoveredItem should default to null', () => {
      expect(service.hoveredItem()).toBeNull();
    });

    it('tooltipText should default to empty string', () => {
      expect(service.tooltipText()).toBe('');
    });

    it('tooltipX and tooltipY should default to 0', () => {
      expect(service.tooltipX()).toBe(0);
      expect(service.tooltipY()).toBe(0);
    });

    it('proximityRange should default to 80', () => {
      expect(service.proximityRange()).toBe(80);
    });

    it('notifications should default to empty array', () => {
      expect(service.notifications()).toEqual([]);
    });

    it('damageFlashIntensity should default to 0', () => {
      expect(service.damageFlashIntensity()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------

  describe('reset()', () => {
    it('should restore all signals to their default values', () => {
      // Mutate everything
      service.toggleMinimap(false);
      service.setMinimapPosition('bottom-left');
      service.toggleFullMap();
      service.setTooltip('hello', 10, 20);
      service.addNotification('msg', 0, '#fff');
      service.triggerDamageFlash(0.8);

      service.reset();

      expect(service.miniMapEnabled()).toBeTrue();
      expect(service.miniMapPosition()).toBe('top-right');
      expect(service.miniMapScale()).toBeCloseTo(0.25, 5);
      expect(service.fullMapEnabled()).toBeFalse();
      expect(service.hoveredItem()).toBeNull();
      expect(service.tooltipText()).toBe('');
      expect(service.tooltipX()).toBe(0);
      expect(service.tooltipY()).toBe(0);
      expect(service.proximityRange()).toBe(80);
      expect(service.notifications()).toEqual([]);
      expect(service.damageFlashIntensity()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Minimap
  // -------------------------------------------------------------------------

  describe('toggleMinimap()', () => {
    it('should toggle minimap when called without argument', () => {
      service.toggleMinimap();
      expect(service.miniMapEnabled()).toBeFalse();

      service.toggleMinimap();
      expect(service.miniMapEnabled()).toBeTrue();
    });

    it('should set explicit value when provided', () => {
      service.toggleMinimap(false);
      expect(service.miniMapEnabled()).toBeFalse();

      service.toggleMinimap(true);
      expect(service.miniMapEnabled()).toBeTrue();
    });

    it('should be a no-op signal-change when called with current value', () => {
      service.toggleMinimap(true);
      // Still true — no change
      expect(service.miniMapEnabled()).toBeTrue();
    });
  });

  describe('setMinimapPosition()', () => {
    it('should update minimap position to bottom-left', () => {
      service.setMinimapPosition('bottom-left');
      expect(service.miniMapPosition()).toBe('bottom-left');
    });

    it('should update minimap position back to top-right', () => {
      service.setMinimapPosition('bottom-left');
      service.setMinimapPosition('top-right');
      expect(service.miniMapPosition()).toBe('top-right');
    });
  });

  describe('toggleFullMap()', () => {
    it('should toggle full map state', () => {
      service.toggleFullMap();
      expect(service.fullMapEnabled()).toBeTrue();

      service.toggleFullMap();
      expect(service.fullMapEnabled()).toBeFalse();
    });

    it('should synchronize to an explicit state without inverting a drifted layer', () => {
      service.toggleFullMap(true);
      expect(service.fullMapEnabled()).toBeTrue();

      service.toggleFullMap(true);
      expect(service.fullMapEnabled()).toBeTrue();

      service.toggleFullMap(false);
      expect(service.fullMapEnabled()).toBeFalse();
    });
  });

  // -------------------------------------------------------------------------
  // Tooltips
  // -------------------------------------------------------------------------

  describe('setTooltip()', () => {
    it('should set text, x, and y', () => {
      service.setTooltip('Wave 3', 100, 200);
      expect(service.tooltipText()).toBe('Wave 3');
      expect(service.tooltipX()).toBe(100);
      expect(service.tooltipY()).toBe(200);
    });

    it('should default hoveredItem to null when not provided', () => {
      service.setTooltip('text', 0, 0);
      expect(service.hoveredItem()).toBeNull();
    });

    it('should set hoveredItem when provided', () => {
      const item: HoveredItem = { type: HoveredItemType.Enemy, id: 'e-42', x: 50, y: 60 };
      service.setTooltip('Enemy', 50, 60, item);
      expect(service.hoveredItem()).toEqual(item);
    });
  });

  describe('clearTooltip()', () => {
    it('should clear text and hoveredItem', () => {
      const item: HoveredItem = { type: HoveredItemType.Enemy, id: 'e-1', x: 50, y: 50 };
      service.setTooltip('Enemy', 50, 50, item);

      service.clearTooltip();

      expect(service.tooltipText()).toBe('');
      expect(service.hoveredItem()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  describe('addNotification()', () => {
    it('should add a notification', () => {
      service.addNotification('Level Up!', 1000, '#0f0');
      const notes = service.notifications();
      expect(notes.length).toBe(1);
      expect(notes[0].text).toBe('Level Up!');
      expect(notes[0].color).toBe('#0f0');
    });

    it('should ignore empty or whitespace-only text', () => {
      service.addNotification('', 0, '#fff');
      service.addNotification('   ', 0, '#fff');
      expect(service.notifications().length).toBe(0);
    });

    it('should keep at most 2 notifications (oldest dropped)', () => {
      service.addNotification('First', 100, '#f00');
      service.addNotification('Second', 200, '#0f0');
      service.addNotification('Third', 300, '#00f');

      const notes = service.notifications();
      expect(notes.length).toBe(2);
      expect(notes[0].text).toBe('Second');
      expect(notes[1].text).toBe('Third');
    });
  });

  describe('updateNotifications()', () => {
    it('should remove notifications past their expiry', () => {
      service.addNotification('Old', 0, '#fff');
      service.addNotification('Recent', 10_000, '#fff');

      // NOTIFICATION_DURATION is 3000ms per game-constants
      service.updateNotifications(5000); // 5s current time — Old (age=5000) is expired

      const notes = service.notifications();
      expect(notes.some((n: Notification) => n.text === 'Old')).toBeFalse();
      expect(notes.some((n: Notification) => n.text === 'Recent')).toBeTrue();
    });

    it('should keep notifications within duration', () => {
      service.addNotification('Fresh', 4000, '#fff');
      service.updateNotifications(5000); // age = 1000ms < 3000ms

      expect(service.notifications().length).toBe(1);
    });

    it('should clear all when all are expired', () => {
      service.addNotification('A', 0, '#f00');
      service.updateNotifications(100_000);
      expect(service.notifications().length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Damage flash
  // -------------------------------------------------------------------------

  describe('triggerDamageFlash()', () => {
    it('should set flash intensity', () => {
      service.triggerDamageFlash(0.6);
      expect(service.damageFlashIntensity()).toBeCloseTo(0.6, 5);
    });

    it('should clamp intensity to 1.0', () => {
      service.triggerDamageFlash(2.0);
      expect(service.damageFlashIntensity()).toBe(1.0);
    });
  });

  describe('updateDamageFlash()', () => {
    it('should decrement intensity by 0.08 per call', () => {
      service.triggerDamageFlash(0.5);
      service.updateDamageFlash();
      expect(service.damageFlashIntensity()).toBeCloseTo(0.42, 5);
    });

    it('should not go below 0', () => {
      service.triggerDamageFlash(0.04);
      service.updateDamageFlash();
      expect(service.damageFlashIntensity()).toBe(0);
    });

    it('should fade to 0 after enough updates', () => {
      service.triggerDamageFlash(1.0);
      for (let i = 0; i < 20; i++) {
        service.updateDamageFlash();
      }
      expect(service.damageFlashIntensity()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Kill streak messages
  // -------------------------------------------------------------------------

  describe('getKillStreakMessage()', () => {
    it('should return empty string for streaks below 3', () => {
      expect(service.getKillStreakMessage(0)).toBe('');
      expect(service.getKillStreakMessage(2)).toBe('');
    });

    it('should return DOUBLE KILL for streak >= 3', () => {
      expect(service.getKillStreakMessage(3)).toContain('DOUBLE KILL');
    });

    it('should return KILL STREAK for streak >= 5', () => {
      expect(service.getKillStreakMessage(5)).toContain('KILL STREAK');
    });

    it('should return MULTI-KILL for streak >= 10', () => {
      expect(service.getKillStreakMessage(10)).toContain('MULTI-KILL');
    });

    it('should return RAMPAGE for streak >= 15', () => {
      expect(service.getKillStreakMessage(15)).toContain('RAMPAGE');
    });

    it('should return EPIC STREAK for streak >= 25', () => {
      expect(service.getKillStreakMessage(25)).toContain('EPIC STREAK');
    });

    it('should return LEGENDARY STREAK for streak >= 50', () => {
      expect(service.getKillStreakMessage(50)).toContain('LEGENDARY STREAK');
    });
  });

  describe('getKillStreakColor()', () => {
    it('should return a non-empty hex string for any streak', () => {
      [1, 3, 5, 10, 15, 25, 50].forEach((streak) => {
        const color = service.getKillStreakColor(streak);
        expect(color).toMatch(/^#[0-9a-fA-F]{3,6}$/);
      });
    });

    it('should return magenta (#ff00ff) for epic/legendary streaks', () => {
      expect(service.getKillStreakColor(50)).toBe('#ff00ff');
      expect(service.getKillStreakColor(25)).toBe('#ff00ff');
    });

    it('should return green for streak tier', () => {
      expect(service.getKillStreakColor(5)).toBe('#00ff00');
    });
  });
});
