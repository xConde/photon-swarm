import { Injectable } from '@angular/core';
import { SettingsService } from '../utils/settings.service';
import { Subscription } from 'rxjs';

interface AudioNodes {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

/**
 * Procedural Audio Service for Photon Swarm
 *
 * Synthesizes all game sounds using Web Audio API oscillators and gain envelopes.
 * No external audio files required. Creates AudioContext lazily on first play
 * call to comply with browser autoplay policies.
 */
@Injectable({ providedIn: 'root' })
export class AudioService {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private masterVolume = 0.22; // Gentled from 0.3 — settings sync overwrites this on first emission anyway

  // Ambient drone state
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private currentAmbientZone: number | null = null;
  // Zone frequencies chosen for deep-space sine drone:
  // Sine/triangle at these low fundamentals reads as rounded sub-bass, not buzzy.
  // Zone 4 raised slightly from 44→48Hz — 44Hz was on the edge of sub-bass rumble
  // that some speakers/headphones exaggerate harshly.
  private static readonly ZONE_DRONE_FREQ: Record<number, number> = {
    1: 65,
    2: 82,
    3: 55,
    4: 48,
  };
  // A continuous sine drone reads louder than its amplitude suggests; keep it low so the
  // backdrop feels like quiet deep space, not a constant hum. (Was 0.04 — too present.)
  private static readonly AMBIENT_VOLUME = 0.015;

  // Throttle timestamps (AudioContext time, in seconds)
  private lastBeamTime = 0;
  private lastShardTime = 0;
  private lastFocusShotTime = 0;
  private lastFocusToggleTime = 0;
  private lastGuardianAggroTime = 0;
  private lastShieldBlockTime = 0;

  private settingsSub: Subscription | null = null;
  private ambientFadeTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private settings: SettingsService) {
    this.settingsSub = this.settings.settings$.subscribe((s) => {
      this.setVolume(s.volume / 100);
      this.setMuted(s.muted ?? false);
    });
  }

  // -- Lifecycle --------------------------------------------------------------

  private ensureContext(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'closed') {
        this.ctx = null;
        this.masterGain = null;
        this.noiseBuffer = null;
      } else {
        return true;
      }
    }

    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      return true;
    } catch {
      return false;
    }
  }

  private resumeIfSuspended(): void {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => {
        /* swallow - browser policy */
      });
    }
  }

  destroy(): void {
    this.settingsSub?.unsubscribe();
    this.settingsSub = null;
    this.deactivateSession();
  }

  /** Release per-session Web Audio resources while keeping settings sync reusable. */
  deactivateSession(): void {
    if (this.ambientFadeTimeout !== null) {
      clearTimeout(this.ambientFadeTimeout);
      this.ambientFadeTimeout = null;
    }
    this.stopAmbientDrone();
    if (this.ctx && this.ctx.state !== 'closed') {
      const ctx = this.ctx;
      if (ctx.state === 'suspended') {
        ctx
          .resume()
          .then(() => ctx.close())
          .catch(() => {
            /* swallow */
          });
      } else {
        ctx.close().catch(() => {
          /* swallow */
        });
      }
    }
    this.ctx = null;
    this.masterGain = null;
    this.noiseBuffer = null;
    // Reset throttle timestamps so a fresh AudioContext (currentTime=0) isn't blocked
    this.lastBeamTime = 0;
    this.lastShardTime = 0;
    this.lastFocusShotTime = 0;
    this.lastFocusToggleTime = 0;
    this.lastGuardianAggroTime = 0;
    this.lastShieldBlockTime = 0;
    this.lastWaveWarningTime = 0;
  }

  // -- Controls ---------------------------------------------------------------

  setVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain && !this.muted) {
      this.masterGain.gain.value = this.masterVolume;
    }
  }

  getVolume(): number {
    return this.masterVolume;
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
    }
    if (this.muted) {
      this.stopAmbientDrone();
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  // -- Sound Effects ----------------------------------------------------------

  /**
   * Beam fire: short sine sweep 720Hz→380Hz, 55ms.
   * Throttled to 1 per 120ms (was 100ms) to reduce stacking on sustained fire.
   * Attack ramp (0→peak in 5ms) prevents click on rapid re-trigger.
   * Slight frequency reduction softens the high end without losing the "zap" feel.
   */
  playBeamFire(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastBeamTime < 0.12) return;
    this.lastBeamTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(720, now);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.055);
    // Short attack (5ms) prevents click; smooth exponential release
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.start(now);
    osc.stop(now + 0.065);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Enemy death: white noise burst + sine pop at 180Hz, 80ms decay.
   * Volume reduced (0.14 from 0.2 for tone; 0.09 from 0.12 for noise) so a burst of
   * simultaneous enemy deaths doesn't clip. Short 4ms attack on tone prevents click.
   */
  playEnemyDeath(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    this.playNoiseBurst(nodes, now, 0.08, 0.09);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.start(now);
    osc.stop(now + 0.09);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Elite death: two overlapping sines (140Hz + 280Hz), 200ms decay + noise burst.
   * Per-oscillator volume reduced to 0.13 (from 0.18) — two simultaneous sines sum
   * to ~0.26 peak; 0.13 each keeps the combined level comparable to enemy death.
   * Short 5ms attack prevents click on the heavy dual-sine hit.
   */
  playEliteDeath(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    this.playNoiseBurst(nodes, now, 0.15, 0.11);

    const freqs = [140, 280];
    for (const freq of freqs) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.13, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.start(now);
      osc.stop(now + 0.21);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    }
  }

  /**
   * Shard collect: quick blip 1000Hz→1350Hz, 35ms. Throttled to 1 per 50ms.
   * Frequencies pulled down slightly (1200→1000, 1600→1350) to reduce harsh highs.
   * Short 4ms attack ramp softens the onset click on rapid collection bursts.
   */
  playShardCollect(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastShardTime < 0.05) return;
    this.lastShardTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, now);
    osc.frequency.exponentialRampToValueAtTime(1350, now + 0.035);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.start(now);
    osc.stop(now + 0.045);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /** Powerup collect: rising shimmer — two sine sweeps (600→1000Hz, 900→1400Hz), 180ms with soft attack. */
  playPowerupCollect(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const sweeps = [
      { start: 600, end: 1000 },
      { start: 900, end: 1400 },
    ];

    for (const sweep of sweeps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(sweep.start, now);
      osc.frequency.exponentialRampToValueAtTime(sweep.end, now + 0.18);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.start(now);
      osc.stop(now + 0.19);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    }
  }

  /**
   * Focus Fire shot: deeper thump — 180Hz triangle descending to 110Hz, 70ms. Throttled 100ms.
   * Short 4ms attack ramp prevents click on rapid-fire single shots.
   * Volume slightly reduced (0.07 from 0.08) for headroom since it fires frequently.
   */
  playFocusFireShot(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastFocusShotTime < 0.1) return;
    this.lastFocusShotTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.07);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.start(now);
    osc.stop(now + 0.09);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /** Focus Fire engage: short descending tone (800→500Hz, 80ms) — signals precision lock. Throttled 150ms. */
  playFocusFireEngage(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastFocusToggleTime < 0.15) return;
    this.lastFocusToggleTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + 0.08);
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.start(now);
    osc.stop(now + 0.11);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /** Focus Fire disengage: short ascending tone (500→800Hz, 60ms). Shares toggle throttle. */
  playFocusFireDisengage(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastFocusToggleTime < 0.15) return;
    this.lastFocusToggleTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.06);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.start(now);
    osc.stop(now + 0.08);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /** Level up: rising arpeggio C5-E5-G5, each 150ms, 80ms apart. */
  playLevelUp(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const startTime = now + i * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

      osc.start(startTime);
      osc.stop(startTime + 0.16);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  /**
   * Damage taken: low rumble 75Hz square wave, 150ms + distortion feel.
   * Volume reduced to 0.16 (from 0.25) — square wave has heavy harmonic content so
   * it reads as loud at lower gain; 0.16 is still punchy without drowning beam audio.
   * Noise volume reduced to 0.08 (from 0.1) proportionally.
   * Short 6ms attack prevents the abrupt square-wave onset click.
   */
  playDamageTaken(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'square';
    osc.frequency.setValueAtTime(75, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.15);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.start(now);
    osc.stop(now + 0.16);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };

    this.playNoiseBurst(nodes, now, 0.06, 0.08);
  }

  /** Combo tier: pitch scales with tier. Base 400Hz + 100Hz per tier, 100ms. */
  playComboTier(tier: number): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const freq = 400 + 100 * tier;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.start(now);
    osc.stop(now + 0.11);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Boss burst: deep bass pulse at 55Hz sine, 200ms.
   * Volume reduced to 0.2 (from 0.3) — was the loudest event by far, easily clipping
   * when the boss fires rapidly. Short 8ms attack ramp replaces the instant onset.
   * Frequency slightly lowered (60→55Hz) for a rounder, deeper sub-bass feel.
   */
  playBossBurst(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(55, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.2);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.start(now);
    osc.stop(now + 0.21);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Zone transition: ascending 2-note chime, ~300ms total.
   * Base frequencies vary by zoneId so each zone sounds distinct.
   */
  playZoneTransition(zoneId: number): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    // Base pitch shifts up slightly per zone (pentatonic steps: 0, +2, +4, +7, +9 semitones)
    const semitoneOffsets = [0, 2, 4, 7, 9];
    const semitones = semitoneOffsets[(zoneId - 1) % semitoneOffsets.length] ?? 0;
    const ratio = Math.pow(2, semitones / 12);
    const note1 = 523.25 * ratio; // C5 * ratio
    const note2 = note1 * (5 / 4); // major third above

    const notes = [note1, note2];
    notes.forEach((freq, i) => {
      const startTime = now + i * 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.05, startTime + 0.12);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.14, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.start(startTime);
      osc.stop(startTime + 0.13);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  /**
   * Guardian aggro: low-frequency bass pulse at 50Hz triangle, 200ms. Throttled to 1 per 3s.
   * Volume reduced to 0.19 (from 0.28) to match bossB burst level.
   * Triangle type produces softer harmonics than square — appropriate for a warning growl.
   * Short 7ms attack prevents abrupt onset.
   */
  playGuardianAggro(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastGuardianAggroTime < 3) return;
    this.lastGuardianAggroTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(50, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.2);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.19, now + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.start(now);
    osc.stop(now + 0.21);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };

    this.playNoiseBurst(nodes, now, 0.08, 0.07);
  }

  /** Gate unlock: bright celebratory C major arpeggio C5-E5-G5-C6, 100ms apart, 150ms each. Louder than zone transition chime. */
  playGateUnlock(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const startTime = now + i * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

      osc.start(startTime);
      osc.stop(startTime + 0.16);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  /**
   * Parry success: two-tone ascending ping 800→1200 Hz sine, ~120ms.
   * Short attack prevents click; gain kept conservative so it reads as a clean
   * high-pitched "ting" above the impact noise rather than a loud blast.
   */
  playParrySuccess(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const freqs = [800, 1200];
    freqs.forEach((freq, i) => {
      const startTime = now + i * 0.04;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.start(startTime);
      osc.stop(startTime + 0.13);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  /**
   * Shield block: short metallic thud ~400 Hz sine, ~80ms, low gain.
   * Throttled globally to 1 per 150ms — beam ticks every frame so without
   * the throttle this would produce a continuous buzz on a blocked beam.
   */
  playShieldBlock(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastShieldBlockTime < 0.15) return;
    this.lastShieldBlockTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.start(now);
    osc.stop(now + 0.09);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Dash whoosh: triangle sweep 300→90 Hz, ~140ms.
   * Triangle type produces a softer harmonic that reads as a quick whoosh
   * rather than a buzz. Called once on dash activation, never per-frame.
   */
  playDash(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.14);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.start(now);
    osc.stop(now + 0.15);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Projectile shot: triangle sweep 250→180 Hz, ~55ms.
   * Distinct from beam fire (sine 720→380 Hz) — the descending triangle gives a
   * softer "pew" feel vs. the sharper beam zap. Low gain keeps it unobtrusive
   * since projectiles fire frequently.
   */
  playProjectileShot(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(250, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.055);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.055);

    osc.start(now);
    osc.stop(now + 0.065);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  /**
   * Wave warning: two-blip cue ~3s before wave arrival.
   * Low gain (0.08) so it reads as a background alert, not a combat sound.
   * Throttled to 1 per 3s — waveWarning$ only fires once per wave anyway,
   * but the guard prevents accidental stacking if subscriptions overlap.
   */
  private lastWaveWarningTime = 0;
  playWaveWarning(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;
    if (now - this.lastWaveWarningTime < 3) return;
    this.lastWaveWarningTime = now;

    // Two short descending blips 150ms apart — subtle "incoming" signal
    const blips = [600, 480];
    blips.forEach((freq, i) => {
      const t = now + i * 0.15;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.85, t + 0.07);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

      osc.start(t);
      osc.stop(t + 0.08);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  /**
   * Zone complete: short ascending resolve — 3 notes C5-E5-G5, 120ms apart, 100ms each.
   * Distinct from gate unlock (4-note arpeggio) but in the same celebratory register.
   */
  playZoneComplete(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const t = now + i * 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.03, t + 0.1);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      osc.start(t);
      osc.stop(t + 0.11);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  /** Treasure cache open: bright ascending 3-note chime, ~400ms. */
  playTreasureOpen(): void {
    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    // E5, G#5, B5 — a bright major arpeggio
    const notes = [659.25, 830.61, 987.77];
    notes.forEach((freq, i) => {
      const startTime = now + i * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(master);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.04, startTime + 0.1);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.linearRampToValueAtTime(0.18, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.start(startTime);
      osc.stop(startTime + 0.13);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  }

  // -- Ambient Drone ----------------------------------------------------------

  /**
   * Start or cross-fade to a zone ambient drone.
   * Pass null to fade out any active drone (e.g. player leaves all zones).
   */
  setAmbientZone(zoneId: number | null): void {
    if (this.muted || zoneId === this.currentAmbientZone) return;

    // Fade out existing drone
    if (this.ambientGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.ambientGain.gain.linearRampToValueAtTime(0.001, now + 0.5);
      const oldOsc = this.ambientOsc;
      const oldGain = this.ambientGain;
      if (this.ambientFadeTimeout !== null) {
        clearTimeout(this.ambientFadeTimeout);
      }
      this.ambientFadeTimeout = setTimeout(() => {
        this.ambientFadeTimeout = null;
        oldOsc?.stop();
        oldOsc?.disconnect();
        oldGain?.disconnect();
      }, 600);
      this.ambientOsc = null;
      this.ambientGain = null;
    }

    this.currentAmbientZone = zoneId;
    if (zoneId === null) return;

    const freq = AudioService.ZONE_DRONE_FREQ[zoneId];
    if (!freq) return;

    const nodes = this.prepare();
    if (!nodes) return;
    const { ctx, master } = nodes;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(master);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(AudioService.AMBIENT_VOLUME, now + 0.8);

    osc.start(now);
    this.ambientOsc = osc;
    this.ambientGain = gain;
  }

  /** Immediately stop and clean up the ambient drone. */
  stopAmbientDrone(): void {
    if (this.ambientOsc) {
      try {
        this.ambientOsc.stop();
      } catch {
        /* already stopped */
      }
      this.ambientOsc.disconnect();
      this.ambientOsc = null;
    }
    if (this.ambientGain) {
      this.ambientGain.disconnect();
      this.ambientGain = null;
    }
    this.currentAmbientZone = null;
  }

  // -- Helpers ----------------------------------------------------------------

  /** Ensures context is ready; returns audio nodes or null if audio cannot play. */
  private prepare(): AudioNodes | null {
    if (this.muted) return null;
    if (this.masterVolume <= 0) return null;
    if (!this.ensureContext()) return null;
    this.resumeIfSuspended();

    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return null;
    return { ctx: this.ctx, master: this.masterGain, noise: this.noiseBuffer };
  }

  /** Pre-generated white noise buffer (1 second, mono). */
  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, sampleRate, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleRate; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * Play a short noise burst from the pre-generated buffer.
   * Adds a 5ms linear attack ramp before peak volume to prevent the abrupt
   * onset click that occurs when noise samples start at full amplitude.
   */
  private playNoiseBurst(nodes: AudioNodes, startTime: number, duration: number, volume: number): void {
    const source = nodes.ctx.createBufferSource();
    const gain = nodes.ctx.createGain();
    source.buffer = nodes.noise;
    source.connect(gain);
    gain.connect(nodes.master);

    const attackTime = 0.005; // 5ms soft onset
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + attackTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.start(startTime);
    source.stop(startTime + duration + 0.01);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }
}
