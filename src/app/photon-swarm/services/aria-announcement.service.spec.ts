import { TestBed } from '@angular/core/testing';
import { AriaAnnouncementService, formatRunEndCopy } from './aria-announcement.service';
import { GameStats } from '../core/models/game-state.model';

describe('AriaAnnouncementService', () => {
  let service: AriaAnnouncementService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AriaAnnouncementService] });
    service = TestBed.inject(AriaAnnouncementService);
  });

  /** Wait one microtask so queueMicrotask-driven writes flush. */
  function flushMicrotasks(): Promise<void> {
    return Promise.resolve();
  }

  it('starts with an empty message so SRs do not announce on mount', () => {
    expect(service.message()).toBe('');
  });

  it('writes the announced text to the message signal', async () => {
    service.announce('Level up. Now at level 3.');
    await flushMicrotasks();
    expect(service.message()).toBe('Level up. Now at level 3.');
  });

  it('exposes message as a readonly signal — no public mutator beyond announce/clear', () => {
    const sig = service.message as unknown as { set?: unknown; update?: unknown };
    expect(sig.set).toBeUndefined();
    expect(sig.update).toBeUndefined();
  });

  it('clears the live region when given an empty string', async () => {
    service.announce('Ship destroyed.');
    await flushMicrotasks();
    expect(service.message()).toBe('Ship destroyed.');

    service.announce('');
    expect(service.message()).toBe('');
  });

  it('clear() resets the live region synchronously', async () => {
    service.announce('Now entering Zone 2.');
    await flushMicrotasks();
    expect(service.message()).toBe('Now entering Zone 2.');

    service.clear();
    expect(service.message()).toBe('');
  });

  it('replaying the same text re-asserts it through an empty tick so SRs re-announce', async () => {
    service.announce('Level up.');
    await flushMicrotasks();
    expect(service.message()).toBe('Level up.');

    // Same text again — we expect an empty tick first, then re-assertion.
    service.announce('Level up.');
    expect(service.message()).toBe('');
    await flushMicrotasks();
    expect(service.message()).toBe('Level up.');
  });

  it('does not insert the empty tick when the new text differs from the current one', () => {
    service.announce('Now entering Zone 2.');
    expect(service.message()).toBe(''); // microtask not yet flushed

    // Next announce while microtask still pending: just overwrites.
    service.announce('Now entering Zone 3.');
    expect(service.message()).toBe('');
  });

  describe('announceLevelUp', () => {
    it('formats the level into the canonical level-up copy', async () => {
      service.announceLevelUp(5);
      await flushMicrotasks();
      expect(service.message()).toBe('Level up. Now at level 5.');
    });
  });

  describe('announceZoneEntry', () => {
    it('formats the named zone into the canonical entry copy', async () => {
      service.announceZoneEntry('Asteroid Belt');
      await flushMicrotasks();
      expect(service.message()).toBe('Now entering Asteroid Belt.');
    });

    it('is a no-op on empty zone names rather than announcing the awkward placeholder', () => {
      service.announceZoneEntry('');
      expect(service.message()).toBe('');
    });
  });

  describe('announceRunEnd + formatRunEndCopy', () => {
    const base: GameStats = { level: 12, shards: 800, time: 600, kills: 134 };

    it('death copy ends with "Ship destroyed" — matches the default end-screen', () => {
      const copy = formatRunEndCopy({ ...base, endReason: 'death' });
      expect(copy).toBe('Ship destroyed. Run ended at level 12 with 134 kills.');
    });

    it('victory copy ends with "Run complete" + Deep Core context', () => {
      const copy = formatRunEndCopy({ ...base, endReason: 'victory' });
      expect(copy).toBe('Run complete. You cleared the Deep Core at level 12 with 134 kills.');
    });

    it('quit copy ends with "Run abandoned"', () => {
      const copy = formatRunEndCopy({ ...base, endReason: 'quit' });
      expect(copy).toBe('Run abandoned at level 12 with 134 kills.');
    });

    it('defaults to death copy when endReason is omitted (legacy paths pre-Phase 8)', () => {
      const copy = formatRunEndCopy({ ...base, endReason: undefined });
      expect(copy.startsWith('Ship destroyed')).toBeTrue();
    });

    it('handles missing kills/level safely (no NaN in the live region)', () => {
      const copy = formatRunEndCopy({ level: 0, shards: 0, time: 0 });
      expect(copy).toContain('level 0');
      expect(copy).toContain('0 kills');
      expect(copy).not.toContain('NaN');
      expect(copy).not.toContain('undefined');
    });

    it('announceRunEnd pushes the formatted copy through the live channel', async () => {
      service.announceRunEnd({ ...base, endReason: 'victory' });
      await flushMicrotasks();
      expect(service.message()).toBe('Run complete. You cleared the Deep Core at level 12 with 134 kills.');
    });
  });

  describe('microtask race protection (Finding A1)', () => {
    it('clear() after a pending announce wins — the in-flight microtask is invalidated', async () => {
      service.announce('Ship destroyed.');
      // microtask still queued
      service.clear();
      expect(service.message()).toBe('');
      await flushMicrotasks();
      // Without the token guard the queued microtask would restore the
      // text here; with it, the clear sticks.
      expect(service.message()).toBe('');
    });

    it('a second announce supersedes the first — only the last text lands', async () => {
      service.announce('Level up. Now at level 3.');
      service.announce('Now entering Asteroid Belt.');
      await flushMicrotasks();
      expect(service.message()).toBe('Now entering Asteroid Belt.');
    });

    it('announce("") clear-form also invalidates any pending microtask', async () => {
      service.announce('Ship destroyed.');
      service.announce(''); // synonymous with clear()
      await flushMicrotasks();
      expect(service.message()).toBe('');
    });
  });
});
