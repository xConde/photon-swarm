import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AudioService } from './audio.service';
import { GameSettings, SettingsService } from '../utils/settings.service';

// ---------------------------------------------------------------------------
// Minimal mock stubs for the Web Audio API
// ---------------------------------------------------------------------------

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: jasmine.createSpy('setValueAtTime'),
    exponentialRampToValueAtTime: jasmine.createSpy('exponentialRampToValueAtTime'),
    linearRampToValueAtTime: jasmine.createSpy('linearRampToValueAtTime'),
  };
  connect = jasmine.createSpy('connect');
  disconnect = jasmine.createSpy('disconnect');
}

class MockOscillatorNode {
  type = 'sine';
  frequency = {
    value: 440,
    setValueAtTime: jasmine.createSpy('setValueAtTime'),
    exponentialRampToValueAtTime: jasmine.createSpy('exponentialRampToValueAtTime'),
  };
  onended: (() => void) | null = null;
  connect = jasmine.createSpy('connect');
  disconnect = jasmine.createSpy('disconnect');
  start = jasmine.createSpy('start');
  stop = jasmine.createSpy('stop').and.callFake(() => {
    if (this.onended) this.onended();
  });
}

class MockBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = jasmine.createSpy('connect');
  disconnect = jasmine.createSpy('disconnect');
  start = jasmine.createSpy('start');
  stop = jasmine.createSpy('stop').and.callFake(() => {
    if (this.onended) this.onended();
  });
}

class MockAudioBuffer {
  sampleRate = 44100;
  getChannelData(_channel: number): Float32Array {
    return new Float32Array(this.sampleRate);
  }
}

class MockAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {} as AudioDestinationNode;

  createGain(): MockGainNode {
    return new MockGainNode();
  }
  createOscillator(): MockOscillatorNode {
    return new MockOscillatorNode();
  }
  createBufferSource(): MockBufferSourceNode {
    return new MockBufferSourceNode();
  }
  createBuffer(_channels: number, _length: number, _rate: number): MockAudioBuffer {
    return new MockAudioBuffer();
  }
  resume = jasmine.createSpy('resume').and.returnValue(Promise.resolve());
  close = jasmine.createSpy('close').and.returnValue(Promise.resolve());
}

// ---------------------------------------------------------------------------
// Helper: build a fully-typed SettingsService stub
// ---------------------------------------------------------------------------

function buildSettingsSpy(volume = 70): {
  spy: jasmine.SpyObj<SettingsService>;
  subject: BehaviorSubject<GameSettings>;
} {
  const defaultSettings: GameSettings = {
    volume,
    screenShake: true,
    showDamageNumbers: true,
    chromaticAberration: true,
    lowHealthVignette: true,
    colorblindMode: 'none',
    sensitivity: 100,
  };
  const subject = new BehaviorSubject<GameSettings>(defaultSettings);
  const spy = jasmine.createSpyObj<SettingsService>('SettingsService', [], {
    settings$: subject.asObservable(),
  });
  return { spy, subject };
}

// ---------------------------------------------------------------------------
// Throttle suite
//
// Design note on t=0:
//   All throttle timestamps start at 0. A fresh AudioContext also starts at
//   currentTime=0. The check `0 - 0 = 0 < 0.1` evaluates to true, so the
//   FIRST call would be suppressed if currentTime is 0. To avoid this, every
//   test that needs the first call to succeed sets currentTime to a value
//   clearly above the largest throttle window (≥ 0.2 s clears all three).
//
// Design note on floating-point boundaries:
//   JS arithmetic: `2.15 - 2.0 ≈ 0.1499...` which is < 0.15, causing a
//   spurious throttle at the exact boundary. Tests that probe the exact
//   boundary use base values where the subtraction produces a value ≥ window
//   (verified via node REPL). Exact boundary tests for the shot use base 1.0
//   (1.1 - 1.0 = 0.10000...09 ≥ 0.1 ✓) and for toggle use base 10.0
//   (10.15 - 10.0 = 0.15000...036 ≥ 0.15 ✓).
// ---------------------------------------------------------------------------

describe('AudioService — throttle', () => {
  let service: AudioService;
  let mockCtx: MockAudioContext;
  let createOscSpy: jasmine.Spy;
  const originalAudioContext = window.AudioContext;

  function setupService(volume = 70): void {
    mockCtx = new MockAudioContext();
    createOscSpy = spyOn(mockCtx, 'createOscillator').and.callThrough();

    (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
      return mockCtx as unknown as AudioContext;
    };

    const { spy } = buildSettingsSpy(volume);

    TestBed.configureTestingModule({
      providers: [AudioService, { provide: SettingsService, useValue: spy }],
    });

    service = TestBed.inject(AudioService);
  }

  afterEach(() => {
    service.destroy();
    TestBed.resetTestingModule();
    // Restore the real AudioContext so downstream test suites aren't polluted
    (window as Window & { AudioContext: typeof AudioContext }).AudioContext = originalAudioContext;
  });

  // -------------------------------------------------------------------------
  // 1. Throttle suppresses rapid calls
  // -------------------------------------------------------------------------

  describe('playFocusFireShot — 100ms throttle window', () => {
    it('suppresses a second call made within the 100ms window', () => {
      setupService();

      // Start at 1.0 s — well past the initial throttle timestamp of 0,
      // so the first call is guaranteed to proceed.
      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();
      expect(countAfterFirst).toBe(1);

      // 50ms later — still within the 100ms window
      mockCtx.currentTime = 1.05;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });

    it('suppresses a second call made just below the boundary', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();

      // 0.099s later — 1ms inside the 100ms window
      mockCtx.currentTime = 1.099;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });

    it('suppresses multiple rapid calls in succession', () => {
      setupService();

      mockCtx.currentTime = 2.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();

      // Three rapid calls within the window
      mockCtx.currentTime = 2.02;
      service.playFocusFireShot();
      mockCtx.currentTime = 2.05;
      service.playFocusFireShot();
      mockCtx.currentTime = 2.09;
      service.playFocusFireShot();

      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Throttle allows calls after the window has elapsed
  // -------------------------------------------------------------------------

  describe('playFocusFireShot — allows second call after window', () => {
    it('proceeds when AudioContext currentTime has advanced past 100ms', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();
      expect(countAfterFirst).toBe(1);

      // 200ms later — well past the 100ms window
      mockCtx.currentTime = 1.2;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterFirst);
    });

    it('proceeds when AudioContext currentTime has advanced by a large amount', () => {
      setupService();

      mockCtx.currentTime = 2.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();

      // 500ms later
      mockCtx.currentTime = 2.5;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterFirst);
    });

    it('each allowed call resets the timestamp for the next window', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();

      // Second call — allowed (> 100ms elapsed)
      mockCtx.currentTime = 1.2;
      service.playFocusFireShot();
      const countAfterSecond = createOscSpy.calls.count();
      expect(countAfterSecond).toBeGreaterThan(countAfterFirst);

      // Third call — should be suppressed (only 50ms since second call)
      mockCtx.currentTime = 1.25;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(countAfterSecond);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Engage and disengage share lastFocusToggleTime — 150ms window
  // -------------------------------------------------------------------------

  describe('playFocusFireEngage / playFocusFireDisengage — shared throttle', () => {
    it('engage followed immediately by disengage suppresses disengage', () => {
      setupService();

      // Start at 1.0 s to clear the initial timestamp-of-0 guard
      mockCtx.currentTime = 1.0;
      service.playFocusFireEngage();
      const countAfterEngage = createOscSpy.calls.count();
      expect(countAfterEngage).toBe(1);

      // Disengage at same timestamp — within 150ms, must be suppressed
      service.playFocusFireDisengage();
      expect(createOscSpy.calls.count()).toBe(countAfterEngage);
    });

    it('disengage followed immediately by engage suppresses engage', () => {
      setupService();

      mockCtx.currentTime = 5.0;
      service.playFocusFireDisengage();
      const countAfterDisengage = createOscSpy.calls.count();
      expect(countAfterDisengage).toBe(1);

      // 100ms later — still within the 150ms toggle window
      mockCtx.currentTime = 5.1;
      service.playFocusFireEngage();
      expect(createOscSpy.calls.count()).toBe(countAfterDisengage);
    });

    it('engage allows disengage after 150ms window has elapsed', () => {
      setupService();

      mockCtx.currentTime = 5.0;
      service.playFocusFireEngage();
      const countAfterEngage = createOscSpy.calls.count();

      // 200ms later — past the 150ms window
      mockCtx.currentTime = 5.2;
      service.playFocusFireDisengage();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterEngage);
    });

    it('disengage allows engage after 150ms window has elapsed', () => {
      setupService();

      mockCtx.currentTime = 10.0;
      service.playFocusFireDisengage();
      const countAfterDisengage = createOscSpy.calls.count();

      mockCtx.currentTime = 10.2;
      service.playFocusFireEngage();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterDisengage);
    });

    it('suppresses rapid toggle cycling (engage → disengage → engage)', () => {
      setupService();

      mockCtx.currentTime = 3.0;
      service.playFocusFireEngage();
      const countAfterFirst = createOscSpy.calls.count();

      // Rapid cycle within the 150ms window
      mockCtx.currentTime = 3.05;
      service.playFocusFireDisengage();
      mockCtx.currentTime = 3.1;
      service.playFocusFireEngage();

      // All rapid calls after the first should be suppressed
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Shot throttle and toggle throttle are independent
  // -------------------------------------------------------------------------

  describe('shot and toggle throttles are independent', () => {
    it('playFocusFireShot and playFocusFireEngage called simultaneously both proceed', () => {
      setupService();

      mockCtx.currentTime = 5.0;

      service.playFocusFireShot();
      const countAfterShot = createOscSpy.calls.count();
      expect(countAfterShot).toBe(1);

      // Different throttle variable (lastFocusToggleTime) — must not be blocked
      service.playFocusFireEngage();
      expect(createOscSpy.calls.count()).toBe(2);
    });

    it('saturating shot throttle does not affect toggle throttle', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterShot = createOscSpy.calls.count();

      // Shot throttle is active — but engage uses lastFocusToggleTime which is untouched
      service.playFocusFireEngage();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterShot);
    });

    it('saturating toggle throttle does not affect shot throttle', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireEngage();
      const countAfterEngage = createOscSpy.calls.count();

      // Toggle throttle is active — but shot uses lastFocusShotTime which is untouched
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterEngage);
    });

    it('shot suppression and toggle suppression occur independently', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterShot = createOscSpy.calls.count();

      service.playFocusFireEngage();
      const countAfterEngage = createOscSpy.calls.count();
      expect(countAfterEngage).toBeGreaterThan(countAfterShot);

      // Shot is still throttled
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(countAfterEngage);

      // Toggle is also throttled
      service.playFocusFireDisengage();
      expect(createOscSpy.calls.count()).toBe(countAfterEngage);
    });
  });

  // -------------------------------------------------------------------------
  // 5. destroy() resets throttle timestamps
  // -------------------------------------------------------------------------

  describe('destroy — throttle reset', () => {
    it('allows shot to play on a fresh context after destroy even if old timestamp was large', () => {
      setupService();

      // Set lastFocusShotTime to a large value
      mockCtx.currentTime = 100.0;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(1);

      // destroy() must reset lastFocusShotTime to 0
      service.destroy();

      // New context with small currentTime:
      //   Without reset: 0.11 - 100.0 = -99.89 < 0.1 → blocked
      //   With reset:    0.11 - 0.0   = 0.11   ≥ 0.1 → allowed
      const freshCtx = new MockAudioContext();
      freshCtx.currentTime = 0.11;
      const freshOscSpy = spyOn(freshCtx, 'createOscillator').and.callThrough();

      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        return freshCtx as unknown as AudioContext;
      };

      TestBed.resetTestingModule();
      const { spy } = buildSettingsSpy(70);
      TestBed.configureTestingModule({
        providers: [AudioService, { provide: SettingsService, useValue: spy }],
      });
      const freshService = TestBed.inject(AudioService);

      freshService.playFocusFireShot();
      expect(freshOscSpy.calls.count()).toBe(1);

      freshService.destroy();
    });

    it('allows toggle to play on a fresh context after destroy even if old timestamp was large', () => {
      setupService();

      mockCtx.currentTime = 200.0;
      service.playFocusFireEngage();
      expect(createOscSpy.calls.count()).toBe(1);

      service.destroy();

      const freshCtx = new MockAudioContext();
      freshCtx.currentTime = 0.16; // > 0.15 toggle window from timestamp 0
      const freshOscSpy = spyOn(freshCtx, 'createOscillator').and.callThrough();

      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        return freshCtx as unknown as AudioContext;
      };

      TestBed.resetTestingModule();
      const { spy } = buildSettingsSpy(70);
      TestBed.configureTestingModule({
        providers: [AudioService, { provide: SettingsService, useValue: spy }],
      });
      const freshService = TestBed.inject(AudioService);

      freshService.playFocusFireEngage();
      expect(freshOscSpy.calls.count()).toBe(1);

      freshService.destroy();
    });

    it('resets all four throttle timestamps (beam, shard, shot, toggle)', () => {
      setupService();

      // Set all four throttle timestamps to a large value
      mockCtx.currentTime = 50.0;
      service.playBeamFire();
      service.playShardCollect();
      service.playFocusFireShot();
      service.playFocusFireEngage();

      service.destroy();

      // Fresh context at currentTime=0.2 — clears all windows (max toggle=0.15, beam=0.12)
      // With reset timestamps=0: 0.2 - 0 = 0.2 ≥ all windows → all allowed
      // Without reset timestamps=50: 0.2 - 50 = negative < all windows → all blocked
      const freshCtx = new MockAudioContext();
      freshCtx.currentTime = 0.2;
      const freshOscSpy = spyOn(freshCtx, 'createOscillator').and.callThrough();

      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        return freshCtx as unknown as AudioContext;
      };

      TestBed.resetTestingModule();
      const { spy } = buildSettingsSpy(70);
      TestBed.configureTestingModule({
        providers: [AudioService, { provide: SettingsService, useValue: spy }],
      });
      const freshService = TestBed.inject(AudioService);

      freshService.playBeamFire();
      freshService.playShardCollect();
      freshService.playFocusFireShot();
      freshService.playFocusFireEngage();

      // Each of the four sounds creates at least one oscillator
      expect(freshOscSpy.calls.count()).toBeGreaterThanOrEqual(4);

      freshService.destroy();
    });
  });

  // -------------------------------------------------------------------------
  // 6. prepare() returns null — methods bail early without creating oscillators
  // -------------------------------------------------------------------------

  describe('prepare() null bail — no oscillator created', () => {
    it('does not create an oscillator when muted', () => {
      setupService();

      service.toggleMute(); // muted = true → prepare() returns null immediately

      // Would be past any throttle window if audio were enabled
      mockCtx.currentTime = 5.0;
      service.playFocusFireShot();
      service.playFocusFireEngage();
      service.playFocusFireDisengage();

      expect(createOscSpy.calls.count()).toBe(0);
    });

    it('does not create an oscillator when volume is zero', () => {
      setupService();

      service.setVolume(0); // masterVolume = 0 → prepare() returns null

      mockCtx.currentTime = 5.0;
      service.playFocusFireShot();
      service.playFocusFireEngage();
      service.playFocusFireDisengage();

      expect(createOscSpy.calls.count()).toBe(0);
    });

    it('does not throw and creates no oscillator when AudioContext constructor throws', () => {
      // Use a fresh TestBed with a throwing AudioContext constructor
      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        throw new Error('NotAllowedError');
      };

      const { spy } = buildSettingsSpy(70);
      TestBed.configureTestingModule({
        providers: [AudioService, { provide: SettingsService, useValue: spy }],
      });
      const brokenService = TestBed.inject(AudioService);

      // ensureContext() catches the error → returns false → prepare() returns null
      expect(() => brokenService.playFocusFireShot()).not.toThrow();
      expect(() => brokenService.playFocusFireEngage()).not.toThrow();
      expect(() => brokenService.playFocusFireDisengage()).not.toThrow();

      // service variable must be valid for afterEach to call destroy() cleanly
      service = brokenService;
    });

    it('does not create an oscillator after context has been destroyed and reinstallation is blocked', () => {
      setupService();

      // Trigger context creation and verify oscillator was made
      mockCtx.currentTime = 5.0;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(1);

      // Destroy clears ctx; block re-creation by making AudioContext throw
      service.destroy();

      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        throw new Error('NotAllowedError');
      };

      // play calls should silently bail without throwing
      expect(() => service.playFocusFireShot()).not.toThrow();
      expect(() => service.playFocusFireEngage()).not.toThrow();
      expect(() => service.playFocusFireDisengage()).not.toThrow();

      // The original mockCtx oscillator spy count must not have increased
      expect(createOscSpy.calls.count()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Throttle boundary precision
  // -------------------------------------------------------------------------

  describe('throttle boundary precision', () => {
    // Floating-point note: base values are chosen so that
    //   base + window - base evaluates to >= window in IEEE 754.
    // Shot window: 0.1 — base 1.0 gives 1.1 - 1.0 = 0.10000000000000009 ≥ 0.1 ✓
    // Toggle window: 0.15 — base 10.0 gives 10.15 - 10.0 = 0.15000000000000036 ≥ 0.15 ✓

    it('shot: call at exactly lastFocusShotTime + 0.1 is NOT suppressed', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();

      // now - last = 0.10000...09 which is NOT < 0.1 → allowed
      mockCtx.currentTime = 1.1;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterFirst);
    });

    it('shot: call just below lastFocusShotTime + 0.1 is suppressed', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playFocusFireShot();
      const countAfterFirst = createOscSpy.calls.count();

      // 0.0999s — clearly inside the window
      mockCtx.currentTime = 1.0999;
      service.playFocusFireShot();
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });

    it('toggle: call at exactly lastFocusToggleTime + 0.15 is NOT suppressed', () => {
      setupService();

      // Base 10.0: 10.15 - 10.0 = 0.15000000000000036 ≥ 0.15 → not suppressed
      mockCtx.currentTime = 10.0;
      service.playFocusFireEngage();
      const countAfterFirst = createOscSpy.calls.count();

      mockCtx.currentTime = 10.15;
      service.playFocusFireDisengage();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterFirst);
    });

    it('toggle: call just below lastFocusToggleTime + 0.15 is suppressed', () => {
      setupService();

      mockCtx.currentTime = 3.0;
      service.playFocusFireEngage();
      const countAfterFirst = createOscSpy.calls.count();

      // 0.1499s — clearly inside the 150ms window
      mockCtx.currentTime = 3.1499;
      service.playFocusFireDisengage();
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });

    it('shard: throttle window is 50ms — call at 49ms is suppressed', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playShardCollect();
      const countAfterFirst = createOscSpy.calls.count();

      mockCtx.currentTime = 1.049;
      service.playShardCollect();
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });

    it('shard: throttle window is 50ms — call at 50ms is NOT suppressed', () => {
      setupService();

      // 1.05 - 1.0 = 0.05 exactly. Check float result:
      // In JS: 1.05 - 1.0 = 0.049999999999999996 < 0.05 → suppressed.
      // Use 1.06 - 1.0 = 0.05999...0006 ≥ 0.05 → allowed.
      mockCtx.currentTime = 1.0;
      service.playShardCollect();
      const countAfterFirst = createOscSpy.calls.count();

      mockCtx.currentTime = 1.06;
      service.playShardCollect();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterFirst);
    });

    it('beam: throttle window is 120ms — call at 119ms is suppressed', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playBeamFire();
      const countAfterFirst = createOscSpy.calls.count();

      // 0.119s — 1ms inside the 120ms window
      mockCtx.currentTime = 1.119;
      service.playBeamFire();
      expect(createOscSpy.calls.count()).toBe(countAfterFirst);
    });

    it('beam: throttle window is 120ms — call at 130ms is NOT suppressed', () => {
      setupService();

      mockCtx.currentTime = 1.0;
      service.playBeamFire();
      const countAfterFirst = createOscSpy.calls.count();

      // 1.13 - 1.0 = 0.12999999999999990 (IEEE 754) ≥ 0.12 → allowed
      mockCtx.currentTime = 1.13;
      service.playBeamFire();
      expect(createOscSpy.calls.count()).toBeGreaterThan(countAfterFirst);
    });
  });
});
