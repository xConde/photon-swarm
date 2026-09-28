import { TestBed } from '@angular/core/testing';
import { XPEventSource, XPEventTrackerService, XPMultiplier } from './xp-event-tracker.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

describe('XPEventTrackerService', () => {
  let service: XPEventTrackerService;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [XPEventTrackerService, { provide: DebugLogBridgeService, useValue: spy }],
    });

    service = TestBed.inject(XPEventTrackerService);
    debugLogSpy = TestBed.inject(DebugLogBridgeService) as jasmine.SpyObj<DebugLogBridgeService>;
  });

  describe('Basic Event Tracking', () => {
    it('should track simple XP event', () => {
      const event = service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);

      expect(event).toBeDefined();
      expect(event.source).toBe(XPEventSource.ENEMY_KILL);
      expect(event.baseAmount).toBe(10);
      expect(event.finalAmount).toBe(10);
      expect(event.multipliers.length).toBe(0);
    });

    it('should apply multipliers correctly', () => {
      const multipliers: XPMultiplier[] = [
        { source: 'buff_1', value: 2.0, description: 'Double XP' },
        { source: 'buff_2', value: 1.5, description: '50% Bonus' },
      ];

      const event = service.trackXPEvent(XPEventSource.ENEMY_KILL, 10, multipliers);

      expect(event.finalAmount).toBe(30); // 10 * 2.0 * 1.5
      expect(event.multipliers.length).toBe(2);
    });

    it('should generate unique event IDs', () => {
      const event1 = service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      const event2 = service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);

      expect(event1.id).not.toBe(event2.id);
    });

    it('should include timestamp in events', () => {
      const beforeTime = Date.now();
      const event = service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      const afterTime = Date.now();

      expect(event.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(event.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('Enemy Kill Tracking', () => {
    it('should track basic enemy kill with metadata', () => {
      const event = service.trackEnemyKillXP('goblin', 123, 10, false, [], { x: 100, y: 200 });

      expect(event.source).toBe(XPEventSource.ENEMY_KILL);
      expect(event.metadata.enemyType).toBe('goblin');
      expect(event.metadata.enemyId).toBe(123);
      expect(event.metadata.position).toEqual({ x: 100, y: 200 });
    });

    it('should track elite enemy kill correctly', () => {
      const event = service.trackEnemyKillXP(
        'elite_warrior',
        456,
        50,
        true, // isElite
        []
      );

      expect(event.source).toBe(XPEventSource.ELITE_KILL);
      expect(event.baseAmount).toBe(50);
    });

    it('should apply enemy kill multipliers', () => {
      const multipliers: XPMultiplier[] = [{ source: 'weekend_bonus', value: 2.0, description: 'Weekend Event' }];

      const event = service.trackEnemyKillXP('skeleton', 789, 15, false, multipliers);

      expect(event.finalAmount).toBe(30);
      expect(event.multipliers[0].description).toBe('Weekend Event');
    });
  });

  describe('Buff XP Tracking', () => {
    it('should track buffed XP with buff metadata', () => {
      const buffMultipliers = [
        { buffId: 'xp_potion', multiplier: 1.5, name: 'XP Potion' },
        { buffId: 'vip_bonus', multiplier: 1.2, name: 'VIP Bonus' },
      ];

      const event = service.trackBuffedXP(XPEventSource.ENEMY_KILL, 100, buffMultipliers);

      expect(event.finalAmount).toBe(180); // 100 * 1.5 * 1.2
      expect(event.metadata.buffIds).toEqual(['xp_potion', 'vip_bonus']);
      expect(event.multipliers.length).toBe(2);
      expect(event.multipliers[0].source).toBe('buff_xp_potion');
      expect(event.multipliers[0].description).toBe('XP Potion');
    });
  });

  describe('Statistics Tracking', () => {
    it('should track total XP and event count', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 100);

      const stats = service.getStatistics();

      expect(stats.totalXpGained).toBe(130);
      expect(stats.totalEvents).toBe(3);
      expect(stats.averageXpPerEvent).toBe(43); // floor(130/3)
    });

    it('should track events by source', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 100);
      service.trackXPEvent(XPEventSource.ELITE_KILL, 50);

      const stats = service.getStatistics();

      expect(stats.eventsBySource.get(XPEventSource.ENEMY_KILL)).toBe(2);
      expect(stats.eventsBySource.get(XPEventSource.BOSS_KILL)).toBe(1);
      expect(stats.eventsBySource.get(XPEventSource.ELITE_KILL)).toBe(1);
    });

    it('should track XP by source', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 100);

      const stats = service.getStatistics();

      expect(stats.xpBySource.get(XPEventSource.ENEMY_KILL)).toBe(30);
      expect(stats.xpBySource.get(XPEventSource.BOSS_KILL)).toBe(100);
    });

    it('should track largest XP gain', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 500);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);

      const stats = service.getStatistics();

      expect(stats.largestXpGain).toBeDefined();
      expect(stats.largestXpGain?.finalAmount).toBe(500);
      expect(stats.largestXpGain?.source).toBe(XPEventSource.BOSS_KILL);
    });

    it('should track recent events', () => {
      for (let i = 0; i < 15; i++) {
        service.trackXPEvent(XPEventSource.ENEMY_KILL, i);
      }

      const stats = service.getStatistics();

      expect(stats.recentEvents.length).toBe(10); // Last 10 events
      expect(stats.recentEvents[9].baseAmount).toBe(14); // Last event
    });

    it('should calculate XP per minute', () => {
      // Track some events
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 100);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 200);

      // Get stats (should calculate XP/minute)
      const stats = service.getStatistics();

      expect(stats.xpPerMinute).toBeGreaterThanOrEqual(0);
      expect(stats.sessionStartTime).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('Event Querying', () => {
    it('should get events by source', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 100);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);

      const enemyKills = service.getEventsBySource(XPEventSource.ENEMY_KILL);

      expect(enemyKills.length).toBe(2);
      expect(enemyKills[0].baseAmount).toBe(10);
      expect(enemyKills[1].baseAmount).toBe(20);
    });

    it('should limit events by source', () => {
      for (let i = 0; i < 20; i++) {
        service.trackXPEvent(XPEventSource.ENEMY_KILL, i);
      }

      const events = service.getEventsBySource(XPEventSource.ENEMY_KILL, 5);

      expect(events.length).toBe(5);
      expect(events[4].baseAmount).toBe(19); // Last event
    });

    it('should get events within time range', () => {
      const startTime = Date.now();

      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);

      const midTime = Date.now();

      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);

      const eventsInRange = service.getEventsInTimeRange(startTime, midTime);

      expect(eventsInRange.length).toBeGreaterThanOrEqual(1);
      expect(eventsInRange[0].baseAmount).toBe(10);
    });
  });

  describe('Event Management', () => {
    it('should limit stored events to maximum', () => {
      // Add more than max events (100)
      for (let i = 0; i < 150; i++) {
        service.trackXPEvent(XPEventSource.ENEMY_KILL, i);
      }

      // Should only keep last 100
      const stats = service.getStatistics();
      expect(stats.totalEvents).toBe(150); // Stats track all

      const allEvents = service.getEventsBySource(XPEventSource.ENEMY_KILL, 200);
      expect(allEvents.length).toBeLessThanOrEqual(100);
    });

    it('should clear all events', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);

      service.clearEvents();

      const stats = service.getStatistics();
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalXpGained).toBe(0);
      expect(stats.recentEvents.length).toBe(0);
    });

    it('should reset statistics when clearing', () => {
      service.trackXPEvent(XPEventSource.BOSS_KILL, 1000);

      const statsBefore = service.getStatistics();
      expect(statsBefore.largestXpGain).toBeDefined();

      service.clearEvents();

      const statsAfter = service.getStatistics();
      expect(statsAfter.largestXpGain).toBeNull();
      expect(statsAfter.averageXpPerEvent).toBe(0);
    });
  });

  describe('Export and Logging', () => {
    it('should export events as JSON', () => {
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 100);

      const exported = service.exportEvents();
      const parsed = JSON.parse(exported);

      expect(parsed.statistics).toBeDefined();
      expect(parsed.events).toBeDefined();
      expect(parsed.statistics.totalXpGained).toBe(110);
    });

    it('should log significant events', () => {
      // Event with multipliers (significant)
      const multipliers: XPMultiplier[] = [{ source: 'buff', value: 2.0, description: 'Double XP' }];

      service.trackXPEvent(XPEventSource.ENEMY_KILL, 50, multipliers);

      // Should log events with multipliers
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('XP Gained'),
        'success',
        jasmine.any(Object)
      );
    });

    it('should log events over 100 XP', () => {
      service.trackXPEvent(XPEventSource.BOSS_KILL, 150);

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('XP Gained'),
        'success',
        jasmine.objectContaining({
          finalAmount: 150,
        })
      );
    });

    it('should generate detailed report', () => {
      // Setup various events
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);
      service.trackXPEvent(XPEventSource.BOSS_KILL, 100);
      service.trackXPEvent(XPEventSource.ELITE_KILL, 50);

      // Generate report
      service.logDetailedReport();

      // Should log main report
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('XP Tracking Report'),
        'info',
        jasmine.objectContaining({
          totalXP: 180,
          totalEvents: 4,
        })
      );

      // Should log breakdown by source
      const sourceLogs = debugLogSpy.log.calls.all().filter((call) => call.args[0].includes('enemy_kill:'));
      expect(sourceLogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Observable Events', () => {
    it('should emit events through observable', (done) => {
      service.xpEvent$.subscribe((event) => {
        expect(event.baseAmount).toBe(25);
        expect(event.source).toBe(XPEventSource.ENEMY_KILL);
        done();
      });

      service.trackXPEvent(XPEventSource.ENEMY_KILL, 25);
    });

    it('should emit multiple events in order', (done) => {
      const amounts: number[] = [];

      service.xpEvent$.subscribe((event) => {
        amounts.push(event.baseAmount);

        if (amounts.length === 3) {
          expect(amounts).toEqual([10, 20, 30]);
          done();
        }
      });

      service.trackXPEvent(XPEventSource.ENEMY_KILL, 10);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 20);
      service.trackXPEvent(XPEventSource.ENEMY_KILL, 30);
    });
  });
});
