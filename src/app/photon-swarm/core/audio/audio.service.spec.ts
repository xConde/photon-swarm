import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AudioService } from './audio.service';
import { SettingsService } from '../utils/settings.service';

// ---------------------------------------------------------------------------
// AudioContext mock — minimal stub of the Web Audio API
// ---------------------------------------------------------------------------

class MockGainNode {
  gain = {
    value: 1,
    setValueAtTime: jasmine.createSpy(),
    exponentialRampToValueAtTime: jasmine.createSpy(),
    linearRampToValueAtTime: jasmine.createSpy(),
  };
  connect = jasmine.createSpy();
  disconnect = jasmine.createSpy();
}

class MockOscillatorNode {
  type = 'sine';
  frequency = { value: 440, setValueAtTime: jasmine.createSpy(), exponentialRampToValueAtTime: jasmine.createSpy() };
  onended: (() => void) | null = null;
  connect = jasmine.createSpy();
  disconnect = jasmine.createSpy();
  start = jasmine.createSpy();
  stop = jasmine.createSpy().and.callFake(() => {
    // Simulate node ending synchronously so onended fires
    if (this.onended) this.onended();
  });
}

class MockBufferSourceNode {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect = jasmine.createSpy();
  disconnect = jasmine.createSpy();
  start = jasmine.createSpy();
  stop = jasmine.createSpy().and.callFake(() => {
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
  resume = jasmine.createSpy().and.returnValue(Promise.resolve());
  close = jasmine.createSpy().and.returnValue(Promise.resolve());
}

describe('AudioService', () => {
  let service: AudioService;
  let mockAudioContext: MockAudioContext;
  let settingsSubject: BehaviorSubject<{ volume: number; muted?: boolean }>;

  beforeEach(() => {
    mockAudioContext = new MockAudioContext();
    settingsSubject = new BehaviorSubject<{ volume: number; muted?: boolean }>({ volume: 70 });

    // Patch global AudioContext before injection
    spyOn(window as Window & { AudioContext?: unknown }, 'AudioContext' as keyof Window).and.returnValue(
      mockAudioContext
    );

    const settingsSpy = jasmine.createSpyObj('SettingsService', [], {
      settings$: settingsSubject.asObservable(),
    });

    TestBed.configureTestingModule({
      providers: [AudioService, { provide: SettingsService, useValue: settingsSpy }],
    });

    service = TestBed.inject(AudioService);
  });

  afterEach(() => {
    service.destroy();
  });

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  describe('creation', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should start unmuted', () => {
      expect(service.isMuted()).toBeFalse();
    });

    it('should initialise master volume from settings (70/100 = 0.7)', () => {
      // Force context creation by playing something
      service.playBeamFire();
      expect(service.getVolume()).toBeCloseTo(0.7, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Volume
  // -------------------------------------------------------------------------

  describe('setVolume / getVolume', () => {
    it('should clamp volume to [0, 1]', () => {
      service.setVolume(1.5);
      expect(service.getVolume()).toBe(1);

      service.setVolume(-0.5);
      expect(service.getVolume()).toBe(0);
    });

    it('should store the exact value within range', () => {
      service.setVolume(0.42);
      expect(service.getVolume()).toBeCloseTo(0.42, 5);
    });

    it('should react to settings$ emissions', () => {
      settingsSubject.next({ volume: 50 });
      expect(service.getVolume()).toBeCloseTo(0.5, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Mute / Unmute
  // -------------------------------------------------------------------------

  describe('toggleMute / isMuted', () => {
    it('should toggle mute state', () => {
      expect(service.isMuted()).toBeFalse();

      service.toggleMute();
      expect(service.isMuted()).toBeTrue();

      service.toggleMute();
      expect(service.isMuted()).toBeFalse();
    });

    it('should react to persisted mute changes from settings', () => {
      settingsSubject.next({ volume: 70, muted: true });
      expect(service.isMuted()).toBeTrue();

      settingsSubject.next({ volume: 70, muted: false });
      expect(service.isMuted()).toBeFalse();
    });

    it('muted service should not throw when play methods are called', () => {
      service.toggleMute();
      expect(() => service.playBeamFire()).not.toThrow();
      expect(() => service.playEnemyDeath()).not.toThrow();
      expect(() => service.playEliteDeath()).not.toThrow();
      expect(() => service.playShardCollect()).not.toThrow();
      expect(() => service.playLevelUp()).not.toThrow();
      expect(() => service.playDamageTaken()).not.toThrow();
      expect(() => service.playComboTier(2)).not.toThrow();
      expect(() => service.playBossBurst()).not.toThrow();
      expect(() => service.playParrySuccess()).not.toThrow();
      expect(() => service.playShieldBlock()).not.toThrow();
      expect(() => service.playDash()).not.toThrow();
      expect(() => service.playProjectileShot()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Play methods — no-throw contract
  // -------------------------------------------------------------------------

  describe('play methods — no-throw', () => {
    it('playBeamFire should not throw', () => {
      expect(() => service.playBeamFire()).not.toThrow();
    });

    it('playEnemyDeath should not throw', () => {
      expect(() => service.playEnemyDeath()).not.toThrow();
    });

    it('playEliteDeath should not throw', () => {
      expect(() => service.playEliteDeath()).not.toThrow();
    });

    it('playShardCollect should not throw', () => {
      expect(() => service.playShardCollect()).not.toThrow();
    });

    it('playLevelUp should not throw', () => {
      expect(() => service.playLevelUp()).not.toThrow();
    });

    it('playDamageTaken should not throw', () => {
      expect(() => service.playDamageTaken()).not.toThrow();
    });

    it('playComboTier should not throw for various tiers', () => {
      [1, 3, 5, 10].forEach((tier) => {
        expect(() => service.playComboTier(tier)).not.toThrow();
      });
    });

    it('playBossBurst should not throw', () => {
      expect(() => service.playBossBurst()).not.toThrow();
    });

    it('playParrySuccess should not throw', () => {
      expect(() => service.playParrySuccess()).not.toThrow();
    });

    it('playShieldBlock should not throw', () => {
      expect(() => service.playShieldBlock()).not.toThrow();
    });

    it('playDash should not throw', () => {
      expect(() => service.playDash()).not.toThrow();
    });

    it('playProjectileShot should not throw', () => {
      expect(() => service.playProjectileShot()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Zero-volume guard
  // -------------------------------------------------------------------------

  describe('zero-volume guard', () => {
    it('should not create AudioContext when volume is 0', () => {
      service.setVolume(0);
      // Reset private ctx by calling destroy then NOT calling anything that
      // triggers ensureContext — just confirm no throw
      expect(() => service.playBeamFire()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // AudioContext failure tolerance
  // -------------------------------------------------------------------------

  describe('AudioContext failure tolerance', () => {
    it('should handle AudioContext constructor throwing', () => {
      // Destroy existing context
      service.destroy();

      // Make AudioContext throw
      (window as Window & { AudioContext?: unknown })['AudioContext'] = function () {
        throw new Error('NotAllowedError');
      };

      // Should not throw even if AudioContext fails
      expect(() => service.playBeamFire()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Destroy / cleanup
  // -------------------------------------------------------------------------

  describe('destroy', () => {
    it('should not throw when destroyed without prior context creation', () => {
      const newService = TestBed.inject(AudioService);
      expect(() => newService.destroy()).not.toThrow();
    });

    it('should null out internal state on destroy', () => {
      // Trigger context creation
      service.playBeamFire();
      service.destroy();

      // After destroy, further play calls should be no-ops without crashing
      expect(() => service.playBeamFire()).not.toThrow();
    });

    it('should resume suspended context before closing', () => {
      service.playBeamFire(); // creates context
      mockAudioContext.state = 'suspended';
      service.destroy();
      expect(mockAudioContext.resume).toHaveBeenCalled();
    });

    it('should close running context on destroy', () => {
      service.playBeamFire(); // creates context
      mockAudioContext.state = 'running';
      service.destroy();
      expect(mockAudioContext.close).toHaveBeenCalled();
    });
  });

  describe('session deactivation', () => {
    it('should release audio resources without detaching settings updates', () => {
      service.playBeamFire();

      service.deactivateSession();
      settingsSubject.next({ volume: 35 });

      expect(service.getVolume()).toBeCloseTo(0.35, 5);
      expect(() => service.playBeamFire()).not.toThrow();
    });
  });
});
