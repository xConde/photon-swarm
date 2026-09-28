import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AudioService } from '../../audio/audio.service';

export interface ComboState {
  count: number;
  multiplier: number;
  timeRemaining: number;
  isActive: boolean;
  totalScore: number;
}

interface ComboTier {
  threshold: number;
  name: string;
  multiplier: number;
  color: string;
}

/**
 * ComboSystemService
 *
 * Tracks kill combos and provides score multipliers for successive kills.
 * Adds excitement and rewards skilled play with visual feedback.
 */
@Injectable({
  providedIn: 'root',
})
export class ComboSystemService {
  private comboState$ = new BehaviorSubject<ComboState>({
    count: 0,
    multiplier: 1,
    timeRemaining: 0,
    isActive: false,
    totalScore: 0,
  });

  // Combo configuration
  private readonly COMBO_WINDOW = 3000; // 3 seconds to continue combo
  private readonly COMBO_DECAY_RATE = 100; // ms per frame
  private lastKillTime = 0;
  private decayInterval?: number;

  // Combo thresholds and rewards
  private readonly COMBO_TIERS: ComboTier[] = [
    { threshold: 3, name: 'TRIPLE KILL', multiplier: 1.5, color: '#00ff00' },
    { threshold: 5, name: 'RAMPAGE', multiplier: 2.0, color: '#ffff00' },
    { threshold: 10, name: 'KILLING SPREE', multiplier: 3.0, color: '#ff8800' },
    { threshold: 15, name: 'DOMINATING', multiplier: 4.0, color: '#ff4400' },
    { threshold: 20, name: 'UNSTOPPABLE', multiplier: 5.0, color: '#ff0000' },
    { threshold: 30, name: 'GODLIKE', multiplier: 7.5, color: '#ff00ff' },
    { threshold: 50, name: 'LEGENDARY', multiplier: 10.0, color: '#ffffff' },
  ];

  constructor(
    private ngZone: NgZone,
    private audio: AudioService
  ) {
    // Decay timer is started on-demand when combo becomes active
  }

  /**
   * Register a kill and update combo state
   */
  registerKill(basePoints: number = 100): number {
    const now = Date.now();
    const timeSinceLastKill = now - this.lastKillTime;

    // Check if this continues the combo or starts a new one
    if (timeSinceLastKill < this.COMBO_WINDOW && this.comboState$.value.count > 0) {
      // Continue combo
      this.incrementCombo();
    } else {
      // Start new combo
      this.startNewCombo();
    }

    this.lastKillTime = now;

    // Calculate score with multiplier
    const state = this.comboState$.value;
    const points = Math.floor(basePoints * state.multiplier);

    // Update total score
    this.updateState({
      totalScore: state.totalScore + points,
      timeRemaining: this.COMBO_WINDOW,
    });

    // Check for tier announcement
    this.checkComboTier();

    return points;
  }

  /**
   * Get current combo state
   */
  getComboState(): Observable<ComboState> {
    return this.comboState$.asObservable();
  }

  /**
   * Get current multiplier
   */
  getCurrentMultiplier(): number {
    return this.comboState$.value.multiplier;
  }

  /**
   * Get current combo count
   */
  getCurrentCombo(): number {
    return this.comboState$.value.count;
  }

  /**
   * Get combo tier info for current count
   */
  getCurrentTier(): { name: string; color: string } | null {
    const count = this.comboState$.value.count;

    // Find the highest tier we've reached
    for (let i = this.COMBO_TIERS.length - 1; i >= 0; i--) {
      if (count >= this.COMBO_TIERS[i].threshold) {
        return {
          name: this.COMBO_TIERS[i].name,
          color: this.COMBO_TIERS[i].color,
        };
      }
    }

    return null;
  }

  /**
   * Reset combo system
   */
  reset(): void {
    this.updateState({
      count: 0,
      multiplier: 1,
      timeRemaining: 0,
      isActive: false,
      totalScore: 0,
    });
    this.lastKillTime = 0;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = undefined;
    }
    this.comboState$.complete();
  }

  private incrementCombo(): void {
    const state = this.comboState$.value;
    const newCount = state.count + 1;

    // Calculate new multiplier based on combo count
    let newMultiplier = 1;
    for (const tier of this.COMBO_TIERS) {
      if (newCount >= tier.threshold) {
        newMultiplier = tier.multiplier;
      }
    }

    this.updateState({
      count: newCount,
      multiplier: newMultiplier,
      isActive: true,
    });

    // Start decay timer if not already running
    if (!this.decayInterval) {
      this.startDecayTimer();
    }
  }

  private startNewCombo(): void {
    this.updateState({
      count: 1,
      multiplier: 1,
      timeRemaining: this.COMBO_WINDOW,
      isActive: true,
    });

    // Start decay timer if not already running
    if (!this.decayInterval) {
      this.startDecayTimer();
    }
  }

  private checkComboTier(): void {
    const count = this.comboState$.value.count;

    // Check if we just hit a new tier
    for (const tier of this.COMBO_TIERS) {
      if (count === tier.threshold) {
        this.announceComboTier(tier);
        break;
      }
    }
  }

  private announceComboTier(tier: ComboTier): void {
    // Audio feedback for reaching new combo tier
    const tierIndex = this.COMBO_TIERS.indexOf(tier);
    this.audio.playComboTier(tierIndex + 1);
  }

  private startDecayTimer(): void {
    // Clear any existing interval to prevent leaks
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
    }

    // Update combo timer every 100ms
    this.ngZone.runOutsideAngular(() => {
      this.decayInterval = window.setInterval(() => {
        const state = this.comboState$.value;

        if (state.isActive && state.timeRemaining > 0) {
          const newTime = Math.max(0, state.timeRemaining - this.COMBO_DECAY_RATE);

          if (newTime === 0) {
            // Combo expired - stop the timer
            this.stopDecayTimer();
            this.updateState({
              count: 0,
              multiplier: 1,
              timeRemaining: 0,
              isActive: false,
            });
          } else {
            this.updateState({
              timeRemaining: newTime,
            });
          }
        }
      }, this.COMBO_DECAY_RATE);
    });
  }

  private stopDecayTimer(): void {
    if (this.decayInterval) {
      clearInterval(this.decayInterval);
      this.decayInterval = undefined;
    }
  }

  private updateState(partial: Partial<ComboState>): void {
    this.comboState$.next({
      ...this.comboState$.value,
      ...partial,
    });
  }
}
