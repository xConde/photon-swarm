import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { ComboSystemService } from './combo-system.service';
import { UIQuerySystemService } from '../gameplay';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { AchievementService } from '../../../services/achievement.service';

export type IntensityTier = 'idle' | 'rising' | 'surging' | 'critical';

export interface IntensityState {
  readonly intensity: number; // 0.0 to 1.0 — the core metric
  readonly tier: IntensityTier; // current tier label
  readonly peakIntensity: number; // highest intensity this run
  readonly isRising: boolean; // intensity is increasing
  readonly killStreak: number; // internal streak count (for achievement bridge)
  readonly maxKillStreak: number; // best streak this run
  readonly isRecovering: boolean; // true during recovery window after taking damage
}

export interface IntensityMilestone {
  readonly tier: IntensityTier;
  readonly intensity: number;
  readonly timestamp: number;
}

const DEFAULT_STATE: IntensityState = {
  intensity: 0,
  tier: 'idle',
  peakIntensity: 0,
  isRising: false,
  killStreak: 0,
  maxKillStreak: 0,
  isRecovering: false,
};

/**
 * IntensityService
 *
 * Sprint 6 — UI/UX overhaul: replaces discrete kill streak / combo counters
 * with a single continuous performance feel metric (0.0 → 1.0) that will drive
 * visual effects in later sprints.
 *
 * Intensity rises on kills (scaled by active combo multiplier) and decays
 * naturally over time. Taking damage applies a sharp penalty. Death resets.
 */
@Injectable({
  providedIn: 'root',
})
export class IntensityService {
  private readonly INTENSITY_CONFIG = {
    // Gain rates
    KILL_GAIN: 0.04, // +4% per kill at base
    COMBO_MULTIPLIER: 0.5, // combo multiplier scales gain (e.g., 3x combo = 1.5x intensity gain rate)
    MULTI_KILL_BONUS: 0.02, // extra +2% per kill when combo > 5

    // Decay rates (exponential: harder to sustain high intensity)
    NATURAL_DECAY_BASE: 0.008, // Minimum decay at low intensity (~0.01/s at 0.1 intensity)
    NATURAL_DECAY_SCALE: 0.025, // Additional decay scaled by current intensity (~0.033/s at 1.0)
    DEATH_RESET: true, // full reset on death

    // Damage penalty (scaled by hit size)
    DAMAGE_PENALTY_MIN: 0.05, // Minimum penalty for tiny hits
    DAMAGE_PENALTY_SCALE: 0.004, // Scale factor: penalty = min + scale * damageAmount
    DAMAGE_PENALTY_MAX: 0.3, // Cap at 30% for massive hits

    // Recovery momentum
    RECOVERY_WINDOW_MS: 2000, // 2 seconds of boosted kill gains after taking damage
    RECOVERY_KILL_BONUS: 0.5, // +50% intensity gain during recovery window

    // Tier thresholds
    TIER_RISING: 0.3, // 30% — visual effects start
    TIER_SURGING: 0.6, // 60% — effects intensify
    TIER_CRITICAL: 0.85, // 85% — max visual intensity

    // XP reward
    XP_MULTIPLIER_MAX: 0.5, // +50% XP at max intensity

    // Timing
    DECAY_INTERVAL_MS: 100, // decay tick rate
    HEALTH_POLL_MS: 200, // health polling rate
  } as const;

  // Internal mutable state
  private intensity = 0;
  private peakIntensity = 0;
  private previousTier: IntensityTier = 'idle';
  private killStreak = 0;
  private maxKillStreak = 0;
  private previousHealth = -1; // -1 = uninitialized
  private lastComboCount = 0;
  private decayInterval: number | null = null;
  private healthPollInterval: number | null = null;
  private isRunning = false;
  private comboSubscription: Subscription | null = null;
  private recoveryWindowEnd = 0; // timestamp when recovery window expires

  // State emission
  private readonly state$ = new BehaviorSubject<IntensityState>(DEFAULT_STATE);
  private readonly milestone$ = new Subject<IntensityMilestone>();

  constructor(
    private readonly ngZone: NgZone,
    private readonly comboSystem: ComboSystemService,
    private readonly uiQuery: UIQuerySystemService,
    private readonly debugLog: DebugLogBridgeService,
    private readonly achievements: AchievementService
  ) {}

  // === Public API ===

  /**
   * Observable of the full intensity state — subscribe for reactive updates.
   */
  getState(): Observable<IntensityState> {
    return this.state$.asObservable();
  }

  /**
   * Synchronous snapshot — use for polling consumers that need the current value
   * without subscribing.
   */
  getCurrentState(): IntensityState {
    return this.state$.value;
  }

  /**
   * Returns an XP multiplier based on current intensity.
   * Used by CombatSystemService to reward high-intensity play.
   * Range: 1.0 (idle) → 1.5 (critical).
   */
  getXpMultiplier(): number {
    return 1.0 + this.intensity * this.INTENSITY_CONFIG.XP_MULTIPLIER_MAX;
  }

  /**
   * Emits when a tier threshold is crossed (rising edge only).
   */
  getMilestones(): Observable<IntensityMilestone> {
    return this.milestone$.asObservable();
  }

  /**
   * Begins subscriptions, decay interval, and health polling.
   * Must be called when the game starts.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.debugLog.log('IntensityService: start()', 'info', {
      source: 'intensity_service',
      operation: 'start',
    });

    this.subscribeToCombo();
    this.startDecayInterval();
    this.startHealthPolling();
  }

  /**
   * Clears all intervals and unsubscribes.
   * Called when the game session ends.
   */
  stop(): void {
    this.isRunning = false;

    if (this.comboSubscription) {
      this.comboSubscription.unsubscribe();
      this.comboSubscription = null;
    }

    this.clearDecayInterval();
    this.clearHealthPollInterval();

    this.debugLog.log('IntensityService: stop()', 'info', {
      source: 'intensity_service',
      operation: 'stop',
      peakIntensity: this.peakIntensity,
      maxKillStreak: this.maxKillStreak,
    });
  }

  /**
   * Resets intensity to 0 and clears all run stats.
   * Called on new run start.
   */
  reset(): void {
    this.intensity = 0;
    this.peakIntensity = 0;
    this.previousTier = 'idle';
    this.killStreak = 0;
    this.maxKillStreak = 0;
    this.previousHealth = -1;
    this.lastComboCount = 0;
    this.recoveryWindowEnd = 0;

    this.emitState();

    this.debugLog.log('IntensityService: reset()', 'info', {
      source: 'intensity_service',
      operation: 'reset',
    });
  }

  /**
   * Called when an enemy dies. Increases intensity based on combo multiplier.
   * Can also be called directly by DeathDetectionSystemService in future sprints.
   */
  registerKill(): void {
    if (!this.isRunning) return;

    const comboMultiplier = this.comboSystem.getCurrentMultiplier();
    const effectiveMultiplier = 1 + (comboMultiplier - 1) * this.INTENSITY_CONFIG.COMBO_MULTIPLIER;

    let gain = this.INTENSITY_CONFIG.KILL_GAIN * effectiveMultiplier;
    if (this.comboSystem.getCurrentCombo() > 5) {
      gain += this.INTENSITY_CONFIG.MULTI_KILL_BONUS;
    }

    // Recovery momentum: kills during recovery window gain extra intensity
    if (this.isInRecoveryWindow()) {
      gain *= 1 + this.INTENSITY_CONFIG.RECOVERY_KILL_BONUS;
    }

    const intensityBefore = this.intensity;
    this.intensity = Math.min(1.0, this.intensity + gain);
    this.peakIntensity = Math.max(this.peakIntensity, this.intensity);

    // Kill streak tracking for achievement bridge
    this.killStreak++;
    this.maxKillStreak = Math.max(this.maxKillStreak, this.killStreak);
    this.achievements.recordKillStreak(this.killStreak);

    this.debugLog.log('IntensityService: kill registered', 'info', {
      source: 'intensity_service',
      operation: 'register_kill',
      intensityBefore: intensityBefore.toFixed(3),
      intensityAfter: this.intensity.toFixed(3),
      gain: gain.toFixed(3),
      comboMultiplier,
      killStreak: this.killStreak,
    });

    this.checkMilestones();
    this.emitState();
  }

  /**
   * Called when the player takes damage. Applies an intensity reduction scaled by damage amount.
   * Larger hits cause bigger penalties. Starts a recovery window for boosted kill gains.
   */
  applyDamagePenalty(damageAmount: number = 10): void {
    if (!this.isRunning) return;

    // Scale penalty by damage: small hits = small penalty, big hits = big penalty
    const scaledPenalty = Math.min(
      this.INTENSITY_CONFIG.DAMAGE_PENALTY_MAX,
      this.INTENSITY_CONFIG.DAMAGE_PENALTY_MIN + this.INTENSITY_CONFIG.DAMAGE_PENALTY_SCALE * damageAmount
    );

    const intensityBefore = this.intensity;
    this.intensity = Math.max(0, this.intensity - scaledPenalty);

    // Damage breaks the kill streak
    this.killStreak = 0;

    // Start recovery window — kills during this window gain bonus intensity
    this.startRecoveryWindow();

    this.debugLog.log('IntensityService: damage penalty applied', 'info', {
      source: 'intensity_service',
      operation: 'damage_penalty',
      intensityBefore: intensityBefore.toFixed(3),
      intensityAfter: this.intensity.toFixed(3),
      damageAmount,
      scaledPenalty: scaledPenalty.toFixed(3),
    });

    this.checkMilestones();
    this.emitState();
  }

  // === Private: subscriptions and intervals ===

  private subscribeToCombo(): void {
    this.comboSubscription = this.comboSystem.getComboState().subscribe((comboState) => {
      if (!this.isRunning) return;

      // Detect new kills: combo count increased since last observation
      if (comboState.count > this.lastComboCount) {
        // Each increment in combo count is one kill
        const newKills = comboState.count - this.lastComboCount;
        for (let i = 0; i < newKills; i++) {
          this.registerKill();
        }
      } else if (comboState.count === 0 && this.lastComboCount > 0) {
        // Combo expired — streak resets but don't apply damage penalty
        this.killStreak = 0;
        this.emitState();
      }

      this.lastComboCount = comboState.count;
    });
  }

  private startDecayInterval(): void {
    this.ngZone.runOutsideAngular(() => {
      this.decayInterval = window.setInterval(() => {
        this.tickDecay();
      }, this.INTENSITY_CONFIG.DECAY_INTERVAL_MS);
    });
  }

  private clearDecayInterval(): void {
    if (this.decayInterval !== null) {
      clearInterval(this.decayInterval);
      this.decayInterval = null;
    }
  }

  private startHealthPolling(): void {
    this.ngZone.runOutsideAngular(() => {
      this.healthPollInterval = window.setInterval(() => {
        this.pollHealth();
      }, this.INTENSITY_CONFIG.HEALTH_POLL_MS);
    });
  }

  private clearHealthPollInterval(): void {
    if (this.healthPollInterval !== null) {
      clearInterval(this.healthPollInterval);
      this.healthPollInterval = null;
    }
  }

  // === Private: recovery window ===

  private startRecoveryWindow(): void {
    this.recoveryWindowEnd = Date.now() + this.INTENSITY_CONFIG.RECOVERY_WINDOW_MS;
  }

  private isInRecoveryWindow(): boolean {
    return Date.now() < this.recoveryWindowEnd;
  }

  // === Private: core update logic ===

  private tickDecay(): void {
    if (!this.isRunning || this.intensity <= 0) return;

    // Exponential decay: harder to sustain high intensity
    // At 0.1 intensity: ~0.01/s decay (barely noticeable)
    // At 0.5 intensity: ~0.02/s decay (moderate)
    // At 1.0 intensity: ~0.033/s decay (aggressive)
    const decayRate =
      this.INTENSITY_CONFIG.NATURAL_DECAY_BASE + this.INTENSITY_CONFIG.NATURAL_DECAY_SCALE * this.intensity;
    const decayPerTick = (decayRate * this.INTENSITY_CONFIG.DECAY_INTERVAL_MS) / 1000;

    const intensityBefore = this.intensity;
    this.intensity = Math.max(0, this.intensity - decayPerTick);

    // Only emit if meaningful change occurred
    if (Math.abs(intensityBefore - this.intensity) > 0.0001) {
      this.checkMilestones();
      this.emitState();
    }
  }

  private pollHealth(): void {
    if (!this.isRunning) return;

    const stats = this.uiQuery.getPlayerStats();
    if (!stats) return;

    const currentHealth = stats.health;

    if (this.previousHealth === -1) {
      // First poll — initialize baseline without penalty
      this.previousHealth = currentHealth;
      return;
    }

    // Detect health drop
    if (currentHealth < this.previousHealth) {
      const drop = this.previousHealth - currentHealth;

      this.debugLog.log('IntensityService: health drop detected', 'info', {
        source: 'intensity_service',
        operation: 'health_poll',
        healthBefore: this.previousHealth,
        healthAfter: currentHealth,
        drop,
      });

      this.applyDamagePenalty(drop);

      // Check for death (health reached 0)
      if (currentHealth <= 0 && this.INTENSITY_CONFIG.DEATH_RESET) {
        this.debugLog.log('IntensityService: player death — resetting intensity', 'warning', {
          source: 'intensity_service',
          operation: 'death_reset',
          peakIntensity: this.peakIntensity,
        });
        this.intensity = 0;
        this.killStreak = 0;
        this.checkMilestones();
        this.emitState();
      }
    }

    this.previousHealth = currentHealth;
  }

  private checkMilestones(): void {
    const newTier = this.computeTier(this.intensity);
    if (newTier !== this.previousTier) {
      // Only emit milestone on rising edge (tier improved)
      const tierOrder: IntensityTier[] = ['idle', 'rising', 'surging', 'critical'];
      const prevIndex = tierOrder.indexOf(this.previousTier);
      const newIndex = tierOrder.indexOf(newTier);

      if (newIndex > prevIndex) {
        this.milestone$.next({
          tier: newTier,
          intensity: this.intensity,
          timestamp: Date.now(),
        });

        this.debugLog.log(`IntensityService: tier milestone — ${newTier}`, 'success', {
          source: 'intensity_service',
          operation: 'milestone',
          tier: newTier,
          intensity: this.intensity.toFixed(3),
        });
      }

      this.previousTier = newTier;
    }
  }

  private computeTier(intensity: number): IntensityTier {
    if (intensity >= this.INTENSITY_CONFIG.TIER_CRITICAL) return 'critical';
    if (intensity >= this.INTENSITY_CONFIG.TIER_SURGING) return 'surging';
    if (intensity >= this.INTENSITY_CONFIG.TIER_RISING) return 'rising';
    return 'idle';
  }

  private emitState(): void {
    const currentTier = this.computeTier(this.intensity);
    const previous = this.state$.value;

    this.state$.next({
      intensity: this.intensity,
      tier: currentTier,
      peakIntensity: this.peakIntensity,
      isRising: this.intensity > previous.intensity,
      killStreak: this.killStreak,
      maxKillStreak: this.maxKillStreak,
      isRecovering: this.isInRecoveryWindow(),
    });
  }
}
