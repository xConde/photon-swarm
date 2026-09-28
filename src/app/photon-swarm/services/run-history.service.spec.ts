import { TestBed } from '@angular/core/testing';
import { PersonalBests, RunEntry, RunHistoryService } from './run-history.service';
import { StorageService } from './storage.service';
import { GameStats } from '../core/models/game-state.model';

function makeStats(overrides: Partial<GameStats> = {}): GameStats {
  return { level: 1, shards: 0, time: 60, kills: 10, maxKillStreak: 3, ...overrides };
}

function makeEntry(overrides: Partial<RunEntry> = {}): RunEntry {
  return { stats: makeStats(), date: Date.now(), ascensionLevel: 0, ...overrides };
}

describe('RunHistoryService', () => {
  let service: RunHistoryService;
  let storage: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storage = jasmine.createSpyObj<StorageService>('StorageService', ['get', 'set', 'remove', 'clearAll']);
    storage.get.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [RunHistoryService, { provide: StorageService, useValue: storage }],
    });

    service = TestBed.inject(RunHistoryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getHistory()', () => {
    it('should return an empty array when nothing is stored', () => {
      expect(service.getHistory()).toEqual([]);
    });

    it('should return only valid entries, filtering out malformed ones', () => {
      const good = makeEntry();
      const bad = { garbage: true };
      storage.get.and.returnValue([good, bad] as unknown[]);
      const result = service.getHistory();
      expect(result.length).toBe(1);
      expect(result[0]).toEqual(good);
    });

    it('should return an empty array when stored value is not an array', () => {
      storage.get.and.returnValue({ notAnArray: true } as unknown as unknown[]);
      expect(service.getHistory()).toEqual([]);
    });

    it('should filter entries with non-finite stats fields', () => {
      const validEntry = makeEntry();
      const badStats = { level: NaN, shards: 0, time: 60 };
      const badEntry = { stats: badStats, date: Date.now(), ascensionLevel: 0 };
      storage.get.and.returnValue([validEntry, badEntry] as unknown[]);
      expect(service.getHistory().length).toBe(1);
    });

    it('should filter entries missing the stats field entirely', () => {
      const noStats = { date: Date.now(), ascensionLevel: 0 };
      storage.get.and.returnValue([noStats] as unknown[]);
      expect(service.getHistory()).toEqual([]);
    });
  });

  describe('saveRun()', () => {
    it('should prepend the new run so most recent is first', () => {
      const first = makeEntry({ stats: makeStats({ kills: 1 }) });
      storage.get.and.returnValue([first]);

      service.saveRun(makeStats({ kills: 99 }), 1);

      const call = storage.set.calls.mostRecent();
      const saved = call.args[1] as RunEntry[];
      expect(saved[0].stats.kills).toBe(99);
      expect(saved[1].stats.kills).toBe(1);
    });

    it('should cap history at 10 entries', () => {
      // Pre-populate storage with 10 entries
      const existing: RunEntry[] = Array.from({ length: 10 }, (_, i) => makeEntry({ stats: makeStats({ kills: i }) }));
      storage.get.and.returnValue(existing);

      service.saveRun(makeStats({ kills: 999 }), 0);

      const saved = storage.set.calls.mostRecent().args[1] as RunEntry[];
      expect(saved.length).toBe(10);
      expect(saved[0].stats.kills).toBe(999);
    });

    it('should include the ascensionLevel in the saved entry', () => {
      storage.get.and.returnValue([]);
      service.saveRun(makeStats(), 5);
      const saved = storage.set.calls.mostRecent().args[1] as RunEntry[];
      expect(saved[0].ascensionLevel).toBe(5);
    });

    it('should attach a timestamp to the saved entry', () => {
      const before = Date.now();
      storage.get.and.returnValue([]);
      service.saveRun(makeStats(), 0);
      const after = Date.now();
      const saved = storage.set.calls.mostRecent().args[1] as RunEntry[];
      expect(saved[0].date).toBeGreaterThanOrEqual(before);
      expect(saved[0].date).toBeLessThanOrEqual(after);
    });
  });

  describe('getBestRun()', () => {
    it('should return null when history is empty', () => {
      expect(service.getBestRun()).toBeNull();
    });

    it('should return the run with the highest kill count', () => {
      const low = makeEntry({ stats: makeStats({ kills: 10 }) });
      const high = makeEntry({ stats: makeStats({ kills: 200 }) });
      const mid = makeEntry({ stats: makeStats({ kills: 50 }) });
      storage.get.and.returnValue([low, high, mid]);
      const best = service.getBestRun();
      expect(best?.stats.kills).toBe(200);
    });

    it('should handle entries with undefined kills (treat as 0)', () => {
      const noKills = makeEntry({ stats: { level: 5, shards: 100, time: 300 } });
      const withKills = makeEntry({ stats: makeStats({ kills: 5 }) });
      storage.get.and.returnValue([noKills, withKills]);
      const best = service.getBestRun();
      expect(best?.stats.kills).toBe(5);
    });
  });

  describe('getPersonalBests()', () => {
    it('should return zeros when history is empty', () => {
      const bests: PersonalBests = service.getPersonalBests();
      expect(bests.bestKills).toBe(0);
      expect(bests.bestLevel).toBe(0);
      expect(bests.bestTime).toBe(0);
      expect(bests.bestCombo).toBe(0);
    });

    it('should return correct personal bests across multiple runs', () => {
      const entries: RunEntry[] = [
        makeEntry({ stats: makeStats({ kills: 50, level: 10, time: 120, maxKillStreak: 7 }) }),
        makeEntry({ stats: makeStats({ kills: 100, level: 5, time: 300, maxKillStreak: 15 }) }),
        makeEntry({ stats: makeStats({ kills: 20, level: 25, time: 60, maxKillStreak: 2 }) }),
      ];
      storage.get.and.returnValue(entries);

      const bests = service.getPersonalBests();
      expect(bests.bestKills).toBe(100);
      expect(bests.bestLevel).toBe(25);
      expect(bests.bestTime).toBe(300);
      expect(bests.bestCombo).toBe(15);
    });

    it('should handle missing optional stats fields gracefully', () => {
      const entry = makeEntry({ stats: { level: 3, shards: 50, time: 90 } });
      storage.get.and.returnValue([entry]);
      const bests = service.getPersonalBests();
      expect(bests.bestKills).toBe(0);
      expect(bests.bestCombo).toBe(0);
    });
  });
});
