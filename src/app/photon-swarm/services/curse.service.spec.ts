import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Curse, CurseService } from './curse.service';
import { CurseSeverity } from '../core/models/upgrade.model';
import { skip, take } from 'rxjs/operators';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

// Type for accessing CurseService internals in tests
interface CurseServiceInternal {
  curses: Curse[];
  cursesSubject: BehaviorSubject<Curse[]>;
  curseCounts: Record<string, number>;
}

describe('CurseService', () => {
  let service: CurseService;
  let mockDebugLogBridge: jasmine.SpyObj<DebugLogBridgeService>;

  const createTestCurse = (id: string, severity: CurseSeverity): Curse => ({
    id,
    name: `Test Curse ${id}`,
    description: `Description for ${id}`,
    severity,
    active: true,
  });

  beforeEach(() => {
    // Create mock for injected DebugLogBridgeService
    mockDebugLogBridge = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [CurseService, { provide: DebugLogBridgeService, useValue: mockDebugLogBridge }],
    });

    service = TestBed.inject(CurseService);
  });

  afterEach(() => {
    // Clean up
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Curse Management', () => {
    it('should start with no curses', () => {
      expect(service.getAllCurses()).toEqual([]);
      expect(service.getCurseCount()).toBe(0);
    });

    it('should add a curse successfully', () => {
      const curse = createTestCurse('curse1', 'low');
      expect(service.addCurse(curse)).toBeTrue();

      expect(service.getAllCurses().length).toBe(1);
      expect(service.hasCurse('curse1')).toBe(true);
    });

    it('should emit curse changes via observable', (done) => {
      const curse = createTestCurse('curse1', 'medium');

      // Skip the initial empty state emission, then take the next one (after addCurse)
      service.curses$.pipe(skip(1), take(1)).subscribe((curses) => {
        expect(curses.length).toBe(1);
        expect(curses[0].id).toBe('curse1');
        done();
      });

      service.addCurse(curse);
    });

    it('should not add duplicate curses', () => {
      const curse = createTestCurse('curse1', 'low');
      service.addCurse(curse);
      expect(service.addCurse(curse)).toBeFalse();

      expect(service.getAllCurses().length).toBe(1);
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        'Curse with id curse1 already exists. Not adding duplicate.',
        'warning'
      );
    });

    it('restores the exact curse registry after a failed upgrade transaction', () => {
      service.addCurse(createTestCurse('existing', 'medium'));
      const snapshot = service.captureUpgradeTransaction();

      service.addCurse(createTestCurse('new-curse', 'high'));
      service.removeCurse('existing');
      service.restoreUpgradeTransaction(snapshot);

      expect(service.getAllCurses()).toEqual(snapshot.curses);
      expect(service.getSeverityCounts()).toEqual(snapshot.counts);
    });

    it('should reject curses with invalid severity', () => {
      const invalidCurse = {
        id: 'invalid',
        name: 'Invalid Curse',
        description: 'Test',
        severity: 'invalid' as CurseSeverity,
        active: true,
      };

      service.addCurse(invalidCurse);

      expect(service.getAllCurses().length).toBe(0);
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        "Invalid severity 'invalid' for curse 'invalid'. Cannot add curse.",
        'error'
      );
    });

    it('should reject curses with undefined severity', () => {
      const invalidCurse = {
        id: 'noseverity',
        name: 'No Severity',
        description: 'Test',
        severity: undefined as unknown as CurseSeverity,
        active: true,
      };

      service.addCurse(invalidCurse);

      expect(service.getAllCurses().length).toBe(0);
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        "Invalid severity 'undefined' for curse 'noseverity'. Cannot add curse.",
        'error'
      );
    });

    it('should mark curses as active when added', () => {
      const curse = {
        id: 'curse1',
        name: 'Test Curse',
        description: 'Test',
        severity: 'low' as CurseSeverity,
        active: false, // Should be overridden
      };

      service.addCurse(curse);
      const addedCurse = service.getAllCurses()[0];
      expect(addedCurse.active).toBe(true);
    });

    it('should remove curses by id', () => {
      const curse1 = createTestCurse('curse1', 'low');
      const curse2 = createTestCurse('curse2', 'medium');

      service.addCurse(curse1);
      service.addCurse(curse2);
      expect(service.getCurseCount()).toBe(2);

      service.removeCurse('curse1');
      expect(service.getCurseCount()).toBe(1);
      expect(service.hasCurse('curse1')).toBe(false);
      expect(service.hasCurse('curse2')).toBe(true);
    });

    it('should emit changes when removing curses', (done) => {
      const curse = createTestCurse('curse1', 'high');
      service.addCurse(curse);

      // Skip the current state (1 curse), then take the next emission (after removeCurse)
      service.curses$.pipe(skip(1), take(1)).subscribe((curses) => {
        expect(curses.length).toBe(0);
        done();
      });

      service.removeCurse('curse1');
    });

    it('should handle removing non-existent curse gracefully', () => {
      service.removeCurse('non-existent');
      expect(service.getCurseCount()).toBe(0);
      // Should not throw or log error
    });
  });

  describe('Severity Tracking', () => {
    it('should track curse counts by severity', () => {
      service.addCurse(createTestCurse('low1', 'low'));
      service.addCurse(createTestCurse('low2', 'low'));
      service.addCurse(createTestCurse('med1', 'medium'));
      service.addCurse(createTestCurse('high1', 'high'));

      const counts = service.getSeverityCounts();
      expect(counts.low).toBe(2);
      expect(counts.medium).toBe(1);
      expect(counts.high).toBe(1);
    });

    it('should update severity counts when removing curses', () => {
      service.addCurse(createTestCurse('low1', 'low'));
      service.addCurse(createTestCurse('low2', 'low'));

      service.removeCurse('low1');

      const counts = service.getSeverityCounts();
      expect(counts.low).toBe(1);
    });

    it('should handle removing curse with unexpected severity', () => {
      // Manually manipulate internal state to create edge case
      const curse = {
        id: 'weird',
        name: 'Weird Curse',
        description: 'Test',
        severity: 'weird' as unknown as CurseSeverity,
        active: true,
      };
      const serviceInternal = service as unknown as CurseServiceInternal;
      serviceInternal.curses.push(curse);
      serviceInternal.cursesSubject.next([curse]);

      service.removeCurse('weird');

      expect(mockDebugLogBridge.log).toHaveBeenCalledWith(
        "Removed curse 'weird' had unexpected severity 'weird'. Counts may be inaccurate.",
        'warning'
      );
    });

    it('should get curses by severity', () => {
      const low1 = createTestCurse('low1', 'low');
      const low2 = createTestCurse('low2', 'low');
      const med1 = createTestCurse('med1', 'medium');

      service.addCurse(low1);
      service.addCurse(low2);
      service.addCurse(med1);

      const lowCurses = service.getCursesBySeverity('low');
      expect(lowCurses.length).toBe(2);
      expect(lowCurses.map((c) => c.id)).toContain('low1');
      expect(lowCurses.map((c) => c.id)).toContain('low2');
    });

    it('should handle invalid severity in getCursesBySeverity', () => {
      const result = service.getCursesBySeverity('invalid' as CurseSeverity);
      expect(result).toEqual([]);
      expect(mockDebugLogBridge.log).toHaveBeenCalledWith("Invalid severity 'invalid' requested.", 'warning');
    });

    it('should check if has curses of specific severity', () => {
      expect(service.hasCurseSeverity('low')).toBe(false);

      service.addCurse(createTestCurse('low1', 'low'));
      expect(service.hasCurseSeverity('low')).toBe(true);
      expect(service.hasCurseSeverity('medium')).toBe(false);
    });

    it('should handle invalid severity in hasCurseSeverity', () => {
      const result = service.hasCurseSeverity('invalid' as CurseSeverity);
      expect(result).toBe(false);
    });
  });

  describe('Difficulty Calculation', () => {
    it('should calculate difficulty multiplier based on curses', () => {
      expect(service.getDifficultyMultiplier()).toBe(1.0);

      service.addCurse(createTestCurse('low1', 'low'));
      expect(service.getDifficultyMultiplier()).toBeCloseTo(1.05, 2);

      service.addCurse(createTestCurse('med1', 'medium'));
      expect(service.getDifficultyMultiplier()).toBeCloseTo(1.2, 2);

      service.addCurse(createTestCurse('high1', 'high'));
      expect(service.getDifficultyMultiplier()).toBeCloseTo(1.45, 2);
    });

    it('should handle multiple curses of same severity', () => {
      service.addCurse(createTestCurse('low1', 'low'));
      service.addCurse(createTestCurse('low2', 'low'));
      service.addCurse(createTestCurse('low3', 'low'));

      // 3 low curses = 3 * 0.05 = 0.15 + 1.0 = 1.15
      expect(service.getDifficultyMultiplier()).toBeCloseTo(1.15, 2);
    });

    it('should update difficulty when removing curses', () => {
      service.addCurse(createTestCurse('high1', 'high'));
      expect(service.getDifficultyMultiplier()).toBeCloseTo(1.25, 2);

      service.removeCurse('high1');
      expect(service.getDifficultyMultiplier()).toBe(1.0);
    });

    it('should handle undefined curse counts gracefully', () => {
      // Even with corrupted internal state, should not crash
      const serviceInternal = service as unknown as CurseServiceInternal;
      serviceInternal.curseCounts = { weird: 5 };
      expect(service.getDifficultyMultiplier()).toBe(1.0);
    });
  });

  describe('Hidden Effects', () => {
    it('should include hidden effects in curse data', () => {
      const curseWithHidden: Curse = {
        id: 'hidden1',
        name: 'Mysterious Curse',
        description: 'Something bad happens',
        hiddenEffect: 'Reduces luck by 50%',
        severity: 'medium',
        active: true,
      };

      service.addCurse(curseWithHidden);
      const retrieved = service.getAllCurses()[0];
      expect(retrieved.hiddenEffect).toBe('Reduces luck by 50%');
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all curses', () => {
      service.addCurse(createTestCurse('curse1', 'low'));
      service.addCurse(createTestCurse('curse2', 'medium'));
      service.addCurse(createTestCurse('curse3', 'high'));

      expect(service.getCurseCount()).toBe(3);

      service.resetAllCurses();

      expect(service.getCurseCount()).toBe(0);
      expect(service.getAllCurses()).toEqual([]);
      expect(service.getSeverityCounts()).toEqual({ low: 0, medium: 0, high: 0 });
    });

    it('should emit empty array after reset', (done) => {
      service.addCurse(createTestCurse('curse1', 'low'));

      // Reset first, then subscribe to get the empty state
      service.resetAllCurses();

      service.curses$.pipe(take(1)).subscribe((curses) => {
        expect(curses).toEqual([]);
        done();
      });
    });
  });

  describe('Observable Behavior', () => {
    it('should emit initial empty state', (done) => {
      service.curses$.pipe(take(1)).subscribe((curses) => {
        expect(curses).toEqual([]);
        done();
      });
    });

    it('should emit updates in order', (done) => {
      const emissions: Curse[][] = [];

      const subscription = service.curses$.subscribe((curses) => {
        emissions.push([...curses]);
      });

      service.addCurse(createTestCurse('curse1', 'low'));
      service.addCurse(createTestCurse('curse2', 'medium'));
      service.removeCurse('curse1');

      setTimeout(() => {
        expect(emissions.length).toBe(4); // Initial + 3 changes
        expect(emissions[0].length).toBe(0); // Initial
        expect(emissions[1].length).toBe(1); // After first add
        expect(emissions[2].length).toBe(2); // After second add
        expect(emissions[3].length).toBe(1); // After remove
        subscription.unsubscribe();
        done();
      }, 100);
    });
  });

  describe('Edge Cases', () => {
    it('should handle removing all curses individually', () => {
      const curses = [
        createTestCurse('curse1', 'low'),
        createTestCurse('curse2', 'medium'),
        createTestCurse('curse3', 'high'),
      ];

      curses.forEach((curse) => service.addCurse(curse));
      expect(service.getCurseCount()).toBe(3);

      curses.forEach((curse) => service.removeCurse(curse.id));
      expect(service.getCurseCount()).toBe(0);
      expect(service.getDifficultyMultiplier()).toBe(1.0);
    });

    it('should return defensive copies of arrays', () => {
      service.addCurse(createTestCurse('curse1', 'low'));

      const curses1 = service.getAllCurses();
      const curses2 = service.getAllCurses();

      expect(curses1).not.toBe(curses2); // Different array instances
      expect(curses1).toEqual(curses2); // Same content

      // Modifying returned array should not affect service
      curses1.push(createTestCurse('fake', 'high'));
      expect(service.getCurseCount()).toBe(1);
    });

    it('should return defensive copy of severity counts', () => {
      service.addCurse(createTestCurse('curse1', 'low'));

      const counts = service.getSeverityCounts();
      counts.low = 999;

      const actualCounts = service.getSeverityCounts();
      expect(actualCounts.low).toBe(1);
    });

    it('should handle missing debug log bridge', () => {
      window.debugLogBridge = undefined;

      // Should not throw
      expect(() => {
        service.addCurse(createTestCurse('curse1', 'low'));
        service.addCurse(createTestCurse('curse1', 'low')); // Duplicate
        service.addCurse({
          id: 'bad',
          name: 'Bad',
          description: 'Bad',
          severity: 'invalid' as unknown as CurseSeverity,
          active: true,
        });
      }).not.toThrow();
    });

    it('should maintain consistency between curse list and counts', () => {
      // Add several curses
      service.addCurse(createTestCurse('low1', 'low'));
      service.addCurse(createTestCurse('low2', 'low'));
      service.addCurse(createTestCurse('med1', 'medium'));
      service.addCurse(createTestCurse('high1', 'high'));

      // Verify consistency
      const curses = service.getAllCurses();
      const counts = service.getSeverityCounts();

      const actualCounts = { low: 0, medium: 0, high: 0 };
      curses.forEach((curse) => {
        actualCounts[curse.severity]++;
      });

      expect(counts).toEqual(actualCounts);
    });
  });

  describe('curseRemoved$ observable', () => {
    it('should emit curse ID when a curse is removed', (done) => {
      const curse = createTestCurse('curse1', 'medium');
      service.addCurse(curse);

      service.curseRemoved$.pipe(take(1)).subscribe((removedId) => {
        expect(removedId).toBe('curse1');
        done();
      });

      service.removeCurse('curse1');
    });

    it('should not emit when removing a nonexistent curse', (done) => {
      const spy = jasmine.createSpy('curseRemovedSpy');
      const subscription = service.curseRemoved$.subscribe(spy);

      service.removeCurse('nonexistent-curse');

      setTimeout(() => {
        expect(spy).not.toHaveBeenCalled();
        subscription.unsubscribe();
        done();
      }, 50);
    });

    it('should emit for each removal in sequence', (done) => {
      const curse1 = createTestCurse('curse1', 'low');
      const curse2 = createTestCurse('curse2', 'high');
      const emittedIds: string[] = [];

      service.addCurse(curse1);
      service.addCurse(curse2);

      const subscription = service.curseRemoved$.subscribe((removedId) => {
        emittedIds.push(removedId);
      });

      service.removeCurse('curse1');
      service.removeCurse('curse2');

      setTimeout(() => {
        expect(emittedIds).toEqual(['curse1', 'curse2']);
        subscription.unsubscribe();
        done();
      }, 50);
    });
  });
});
