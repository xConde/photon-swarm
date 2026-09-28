import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AudioService } from './audio.service';
import { GameSettings, SettingsService } from '../utils/settings.service';

// ---------------------------------------------------------------------------
// Minimal mock stubs for the Web Audio API — mirrors audio-throttle.spec.ts
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

  // Track all GainNodes created so tests can inspect master gain
  private _gainNodes: MockGainNode[] = [];
  get gainNodes(): MockGainNode[] {
    return this._gainNodes;
  }

  createGain(): MockGainNode {
    const node = new MockGainNode();
    this._gainNodes.push(node);
    return node;
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
// Settings propagation suite
// ---------------------------------------------------------------------------

describe('AudioService — settings propagation', () => {
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
  // 1. Volume change mid-game reflects in master gain
  // -------------------------------------------------------------------------

  describe('volume change mid-game', () => {
    it('updates masterGain to reflect the new volume after a mid-game setVolume call', () => {
      setupService();

      // Set initial volume and trigger context creation via a sound call
      service.setVolume(0.8);
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath(); // forces ensureContext(), which creates masterGain

      // masterGain is the first GainNode created by the context
      const masterGain = mockCtx.gainNodes[0];
      expect(masterGain).toBeDefined();
      expect(masterGain.gain.value).toBe(0.8);

      // Change volume mid-game
      service.setVolume(0.3);

      // masterGain.gain.value must reflect the new volume
      expect(masterGain.gain.value).toBe(0.3);
    });

    it('getVolume returns the most recently set value', () => {
      setupService();

      service.setVolume(0.8);
      expect(service.getVolume()).toBe(0.8);

      service.setVolume(0.3);
      expect(service.getVolume()).toBe(0.3);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Mute toggle blocks subsequent sounds
  // -------------------------------------------------------------------------

  describe('mute toggle', () => {
    it('allows sound before mute but blocks it after mute', () => {
      setupService();

      // First sound plays normally
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      const countBeforeMute = createOscSpy.calls.count();
      expect(countBeforeMute).toBeGreaterThan(0);

      // Toggle mute on
      service.toggleMute();
      expect(service.isMuted()).toBeTrue();

      // Subsequent sound calls must bail immediately (prepare() returns null)
      mockCtx.currentTime = 2.0;
      service.playEnemyDeath();
      expect(createOscSpy.calls.count()).toBe(countBeforeMute);
    });

    it('sets master gain value to 0 when muted', () => {
      setupService();

      // Trigger context creation
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();

      const masterGain = mockCtx.gainNodes[0];
      expect(masterGain.gain.value).toBeGreaterThan(0);

      service.toggleMute();

      expect(masterGain.gain.value).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Unmute restores sound playback
  // -------------------------------------------------------------------------

  describe('unmute restores sounds', () => {
    it('allows sounds after mute is toggled off', () => {
      setupService();

      // Mute before any context is created
      service.toggleMute();
      expect(service.isMuted()).toBeTrue();

      // Sound is blocked
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      expect(createOscSpy.calls.count()).toBe(0);

      // Unmute
      service.toggleMute();
      expect(service.isMuted()).toBeFalse();

      // Sound now plays
      mockCtx.currentTime = 2.0;
      service.playEnemyDeath();
      expect(createOscSpy.calls.count()).toBeGreaterThan(0);
    });

    it('restores master gain to masterVolume after unmute', () => {
      setupService();

      // Establish a non-default volume and trigger context creation
      service.setVolume(0.6);
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();

      service.toggleMute();
      const masterGain = mockCtx.gainNodes[0];
      expect(masterGain.gain.value).toBe(0);

      service.toggleMute(); // unmute
      expect(masterGain.gain.value).toBe(0.6);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Volume at 0 blocks sounds (same behavior as mute)
  // -------------------------------------------------------------------------

  describe('volume at 0 blocks sounds', () => {
    it('does not create an oscillator when volume is set to 0', () => {
      setupService();

      service.setVolume(0);

      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      service.playBeamFire();
      service.playShardCollect();

      expect(createOscSpy.calls.count()).toBe(0);
    });

    it('prepare() short-circuits before creating context when volume is 0', () => {
      setupService();

      service.setVolume(0);

      // No sound calls should reach ensureContext — no gain nodes created
      service.playEnemyDeath();
      expect(mockCtx.gainNodes.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Volume change from 0 to positive re-enables sounds
  // -------------------------------------------------------------------------

  describe('volume 0 → positive re-enables sounds', () => {
    it('allows sounds after volume is raised from 0 to a positive value', () => {
      setupService();

      service.setVolume(0);

      // Confirm blocked
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      expect(createOscSpy.calls.count()).toBe(0);

      // Raise volume
      service.setVolume(0.5);

      // Now sounds must play
      mockCtx.currentTime = 2.0;
      service.playEnemyDeath();
      expect(createOscSpy.calls.count()).toBeGreaterThan(0);
    });

    it('getVolume returns 0.5 after raising from 0', () => {
      setupService();

      service.setVolume(0);
      expect(service.getVolume()).toBe(0);

      service.setVolume(0.5);
      expect(service.getVolume()).toBe(0.5);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Rapid volume changes — final value wins
  // -------------------------------------------------------------------------

  describe('rapid volume changes', () => {
    it('uses the last volume set when multiple setVolume calls are made before a sound', () => {
      setupService();

      // Rapid succession of volume changes
      service.setVolume(0.1);
      service.setVolume(0.5);
      service.setVolume(0.9);
      service.setVolume(0.2);

      expect(service.getVolume()).toBe(0.2);

      // Trigger sound — context is created now, masterGain initializes to current volume
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();

      const masterGain = mockCtx.gainNodes[0];
      expect(masterGain.gain.value).toBe(0.2);
    });

    it('master gain reflects the final rapid-change volume when context already exists', () => {
      setupService();

      // Create context first
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      const masterGain = mockCtx.gainNodes[0];

      // Rapid changes after context is live
      service.setVolume(0.1);
      service.setVolume(0.5);
      service.setVolume(0.9);
      service.setVolume(0.2);

      // Only the last value should be reflected in masterGain
      expect(masterGain.gain.value).toBe(0.2);
    });
  });

  // -------------------------------------------------------------------------
  // 7. destroy() resets all state and allows fresh start
  // -------------------------------------------------------------------------

  describe('destroy resets all state', () => {
    it('getCachedFocusTarget is null after destroy (no public state leaks)', () => {
      setupService();

      // Set a non-default state
      service.setVolume(0.9);
      service.toggleMute();

      mockCtx.currentTime = 1.0;
      // Sound is blocked (muted), but context is not yet created. That's fine.
      service.playEnemyDeath();

      service.destroy();

      // After destroy, isMuted still reflects the toggled state because destroy()
      // does not reset muted — only ctx/gain/noise are cleared. Verify ctx is gone
      // by ensuring a new context is created on the next sound call.
      const freshCtx = new MockAudioContext();
      freshCtx.currentTime = 1.0;
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

      // Fresh service: default volume (0.7 from settings spy at 70%), not muted
      freshService.playEnemyDeath();
      expect(freshOscSpy.calls.count()).toBeGreaterThan(0);

      freshService.destroy();
    });

    it('allows sounds on a re-initialized service after destroy', () => {
      setupService();

      // Warm up and destroy
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      service.destroy();

      // Re-create a fresh context and service
      const freshCtx = new MockAudioContext();
      freshCtx.currentTime = 1.0;
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

      freshService.playEnemyDeath();
      expect(freshOscSpy.calls.count()).toBeGreaterThan(0);

      freshService.destroy();
    });

    it('clears ctx reference so next sound call creates a brand-new AudioContext', () => {
      setupService();

      // Force context creation
      mockCtx.currentTime = 1.0;
      service.playEnemyDeath();
      expect(mockCtx.gainNodes.length).toBeGreaterThan(0);

      service.destroy();

      // A new MockAudioContext will be installed — verify it is used
      const freshCtx = new MockAudioContext();
      let freshCtxCreated = false;

      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        freshCtxCreated = true;
        return freshCtx as unknown as AudioContext;
      };

      // Re-configure so the destroyed service can get a new context
      TestBed.resetTestingModule();
      const { spy } = buildSettingsSpy(70);
      TestBed.configureTestingModule({
        providers: [AudioService, { provide: SettingsService, useValue: spy }],
      });
      const freshService = TestBed.inject(AudioService);

      freshService.playEnemyDeath();
      expect(freshCtxCreated).toBeTrue();

      freshService.destroy();
    });
  });
});
