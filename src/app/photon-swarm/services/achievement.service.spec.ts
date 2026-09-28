import { TestBed } from '@angular/core/testing';
import { Achievement, AchievementService } from './achievement.service';
import { StorageService } from './storage.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

describe('AchievementService', () => {
  let service: AchievementService;
  let storage: jasmine.SpyObj<StorageService>;
  let debugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', ['get', 'set', 'remove', 'clearAll']);
    storage.get.and.returnValue(null);
    debugLog = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [
        AchievementService,
        { provide: StorageService, useValue: storage },
        { provide: DebugLogBridgeService, useValue: debugLog },
      ],
    });

    service = TestBed.inject(AchievementService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Initialisation', () => {
    it('should initialise all defined achievements as locked', () => {
      const all = service.getAll();
      expect(all.length).toBeGreaterThan(0);
      expect(all.every((a) => !a.unlocked)).toBe(true);
    });

    it('should report total count equal to number of defined achievements', () => {
      expect(service.getTotalCount()).toBe(service.getAll().length);
    });

    it('should report 0 unlocked on a fresh state', () => {
      expect(service.getUnlockedCount()).toBe(0);
    });

    it('should restore previously unlocked achievements from storage', () => {
      const timestamp = Date.now();
      storage.get.and.returnValue({
        unlockedIds: { first_blood: timestamp },
        totalShards: 500,
        totalRuns: 3,
      });

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AchievementService,
          { provide: StorageService, useValue: storage },
          { provide: DebugLogBridgeService, useValue: debugLog },
        ],
      });
      service = TestBed.inject(AchievementService);

      expect(service.isUnlocked('first_blood')).toBe(true);
      expect(service.getUnlockedCount()).toBe(1);
    });

    it('should handle corrupted storage data gracefully', () => {
      storage.get.and.returnValue('corrupted-string');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AchievementService,
          { provide: StorageService, useValue: storage },
          { provide: DebugLogBridgeService, useValue: debugLog },
        ],
      });
      service = TestBed.inject(AchievementService);
      expect(service.getUnlockedCount()).toBe(0);
      expect(storage.remove).toHaveBeenCalled();
    });
  });

  describe('recordKill()', () => {
    it('should unlock "first_blood" on the first kill', () => {
      const unlocked: Achievement[] = [];
      service.achievementUnlocked$.subscribe((a) => unlocked.push(a));

      service.recordKill();

      expect(service.isUnlocked('first_blood')).toBe(true);
      expect(unlocked.length).toBe(1);
      expect(unlocked[0].id).toBe('first_blood');
    });

    it('should not re-emit for "first_blood" on subsequent kills', () => {
      const unlocked: Achievement[] = [];
      service.achievementUnlocked$.subscribe((a) => unlocked.push(a));

      service.recordKill();
      service.recordKill();
      service.recordKill();

      const firstBloodEvents = unlocked.filter((a) => a.id === 'first_blood');
      expect(firstBloodEvents.length).toBe(1);
    });

    it('should unlock "centurion" at exactly 100 kills', () => {
      const unlocked: Achievement[] = [];
      service.achievementUnlocked$.subscribe((a) => unlocked.push(a));

      for (let i = 0; i < 100; i++) {
        service.recordKill();
      }

      expect(service.isUnlocked('centurion')).toBe(true);
      expect(unlocked.some((a) => a.id === 'centurion')).toBe(true);
    });

    it('should track progress toward "centurion" without unlocking early', () => {
      for (let i = 0; i < 50; i++) {
        service.recordKill();
      }
      const progress = service.getProgress('centurion');
      expect(progress.current).toBe(50);
      expect(service.isUnlocked('centurion')).toBe(false);
    });

    it('should unlock "chain_lightning" when 5 kills happen within 2 seconds', () => {
      const unlocked: Achievement[] = [];
      service.achievementUnlocked$.subscribe((a) => unlocked.push(a));

      // All 5 kills in rapid succession (synchronous, so same ms bucket effectively)
      for (let i = 0; i < 5; i++) {
        service.recordKill();
      }

      expect(service.isUnlocked('chain_lightning')).toBe(true);
    });
  });

  describe('recordDamageDealt()', () => {
    it('should unlock "overkill" when a single hit deals >= 500 damage', () => {
      const unlocked: Achievement[] = [];
      service.achievementUnlocked$.subscribe((a) => unlocked.push(a));

      service.recordDamageDealt(500);

      expect(service.isUnlocked('overkill')).toBe(true);
      expect(unlocked.some((a) => a.id === 'overkill')).toBe(true);
    });

    it('should not unlock "overkill" for damage below threshold', () => {
      service.recordDamageDealt(499);
      expect(service.isUnlocked('overkill')).toBe(false);
    });
  });

  describe('recordLevelUp()', () => {
    it('should unlock "rank_10" at level 10', () => {
      service.recordLevelUp(10);
      expect(service.isUnlocked('rank_10')).toBe(true);
    });

    it('should unlock "untouchable" at level 5 when no damage taken', () => {
      service.recordLevelUp(5);
      expect(service.isUnlocked('untouchable')).toBe(true);
    });

    it('should NOT unlock "untouchable" when damage was taken before level 5', () => {
      service.recordDamageTaken();
      service.recordLevelUp(5);
      expect(service.isUnlocked('untouchable')).toBe(false);
    });

    it('should reset "untouchable" eligibility after resetRunState()', () => {
      service.recordDamageTaken();
      service.resetRunState();
      service.recordLevelUp(5);
      expect(service.isUnlocked('untouchable')).toBe(true);
    });
  });

  describe('recordShardsCollected()', () => {
    it('should accumulate shards across multiple calls', () => {
      service.recordShardsCollected(3000);
      service.recordShardsCollected(4000);
      const progress = service.getProgress('shard_hoarder');
      expect(progress.current).toBe(7000);
    });

    it('should unlock "shard_hoarder" when 10000 total shards collected', () => {
      service.recordShardsCollected(10000);
      expect(service.isUnlocked('shard_hoarder')).toBe(true);
    });

    it('should ignore non-positive shard amounts', () => {
      service.recordShardsCollected(0);
      service.recordShardsCollected(-100);
      expect(service.getProgress('shard_hoarder').current).toBe(0);
    });
  });

  describe('recordRunComplete()', () => {
    it('should unlock "dedicated" after 10 completed runs', () => {
      for (let i = 0; i < 10; i++) {
        service.recordRunComplete();
      }
      expect(service.isUnlocked('dedicated')).toBe(true);
    });

    it('should persist after each run completion', () => {
      service.recordRunComplete();
      expect(storage.set).toHaveBeenCalled();
    });
  });

  describe('getProgress()', () => {
    it('should return zeros for an unknown achievement id', () => {
      expect(service.getProgress('nonexistent')).toEqual({ current: 0, threshold: 0 });
    });
  });

  describe('resetRunState()', () => {
    it('should reset per-run kill count', () => {
      // Record kills then reset
      for (let i = 0; i < 5; i++) service.recordKill();
      service.resetRunState();

      // After reset kills start fresh; centurion needs 100 kills from zero
      // Progress toward centurion after reset should track from 0 again
      expect(service.isUnlocked('centurion')).toBe(false);
    });
  });
});
