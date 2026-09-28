import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  input,
  OnInit,
  Output,
} from '@angular/core';
import { GameStats } from '../../core/models/game-state.model';
import { AscensionService } from '../../services/ascension.service';
import { PersonalBests, RunHistoryService } from '../../services/run-history.service';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';

/**
 * End Screen Component - Displays game over statistics and restart option
 * Shows player performance metrics when the game ends.
 * When ascension is available, offers an Ascend button alongside restart.
 */
@Component({
  selector: 'app-end-screen',
  standalone: true,
  imports: [],
  templateUrl: './end-screen.component.html',
  styleUrls: ['./end-screen.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EndScreenComponent implements OnInit {
  private readonly ascensionService = inject(AscensionService);
  private readonly runHistoryService = inject(RunHistoryService);
  private previousBests: PersonalBests | null = null;
  private hasAscended = false;

  readonly stats = input.required<GameStats>();
  @Output() restart = new EventEmitter<void>();
  @Output() ascend = new EventEmitter<void>();

  /**
   * Computed signal that formats game time from seconds to MM:SS format
   */
  readonly formattedTime = computed(() => {
    return this.formatTime(this.stats().time);
  });

  readonly canAscend = computed(() => {
    return PROGRESSION_CONFIG.PRESTIGE_ENABLED && this.ascensionService.canAscend(this.stats().level);
  });

  readonly ascensionLevel = computed(() => {
    return this.ascensionService.getAscensionLevel();
  });

  /** True when the run ended on a Zone-4 boss clear rather than death/quit. */
  readonly isVictory = computed(() => this.stats().endReason === 'victory');

  /** Headline copy that varies with how the run ended. */
  readonly endHeadline = computed(() => {
    switch (this.stats().endReason) {
      case 'victory':
        return 'Run Complete';
      case 'quit':
        return 'Run Abandoned';
      default:
        return 'Game Over';
    }
  });

  /** Tagline beneath the headline — keeps the death copy intact, adds victory + quit. */
  readonly endTagline = computed(() => {
    switch (this.stats().endReason) {
      case 'victory':
        return 'You broke the Deep Core. The swarm holds, for now.';
      case 'quit':
        return 'You disengaged from the swarm. Your cosmetics are yours to keep.';
      default:
        return "Your ship's energy signature fades into the void. Your cosmetics carry over.";
    }
  });

  readonly heatLevel = computed(() => {
    const mode = this.stats().difficulty;
    return mode === 'extreme' ? 2 : mode === 'hard' ? 1 : 0;
  });

  readonly currentMasteryUnlocks = computed(() => [
    `Heat ${this.ascensionService.getMaxHeatLevel()} available`,
    `${this.ascensionService.getRerollCharges()} refit reroll${this.ascensionService.getRerollCharges() === 1 ? '' : 's'}`,
  ]);

  readonly nextMasteryUnlock = computed(() =>
    this.ascensionService.getUnlockForLevel(this.ascensionService.getAscensionLevel() + 1)
  );

  readonly personalBests = computed(() => {
    return this.runHistoryService.getPersonalBests();
  });

  /**
   * Checks which personal bests were set by this run.
   * Compares against bests captured *before* saving the current run.
   */
  readonly newRecords = computed(() => {
    const prev = this.previousBests;
    if (!prev) {
      return { kills: false, level: false, time: false, combo: false };
    }
    const s = this.stats();
    const isFirstRun = prev.bestKills === 0 && prev.bestLevel === 0 && prev.bestTime === 0 && prev.bestCombo === 0;
    return {
      kills: isFirstRun || (s.kills ?? 0) > prev.bestKills,
      level: isFirstRun || s.level > prev.bestLevel,
      time: isFirstRun || s.time > prev.bestTime,
      combo: isFirstRun || (s.maxKillStreak ?? 0) > prev.bestCombo,
    };
  });

  ngOnInit(): void {
    // Capture previous bests *before* saving, so we can detect new records
    this.previousBests = this.runHistoryService.getPersonalBests();
    this.runHistoryService.saveRun(this.stats(), this.ascensionService.getAscensionLevel());
  }

  /**
   * Formats time from seconds to MM:SS format
   * @param timeSeconds Time in seconds (from game-state.service)
   * @returns Formatted time string in MM:SS format
   */
  formatTime(timeSeconds: number): string {
    // FIX: Input is already in seconds from game-state.service.ts
    // Previously divided by 1000 twice, causing times under 16 min to show as 0:00
    const minutes = Math.floor(timeSeconds / 60);
    const remainingSeconds = Math.floor(timeSeconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  }

  /**
   * Formats milliseconds into a human-readable duration string
   * @param ms Duration in milliseconds
   * @returns Formatted string like "2m 34s" or "45s"
   */
  formatZoneTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  /**
   * Calculates the player's remaining health as a percentage
   * @returns Health percentage (0-100)
   */
  calculateHealthPercentage(): number {
    const stats = this.stats();

    // Add additional checks to handle edge cases
    if (!stats) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('No stats provided to end screen', 'error', {
          source: 'end_screen_component',
          context: 'health_percentage_calculation',
        });
      }
      return 0;
    }

    if (!stats.maxHealth || stats.maxHealth <= 0) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Invalid maxHealth in stats', 'warning', {
          source: 'end_screen_component',
          maxHealth: stats.maxHealth,
          context: 'health_percentage_calculation',
        });
      }
      return 0;
    }

    const currentHealth = stats.health ?? 0;

    const percentage = (currentHealth / stats.maxHealth) * 100;
    return Math.max(0, Math.min(100, percentage));
  }

  /**
   * Emits restart event to parent component when player clicks restart
   */
  onRestart(): void {
    this.restart.emit();
  }

  /**
   * Performs ascension and emits ascend event to parent
   */
  onAscend(): void {
    if (this.hasAscended) return;
    this.hasAscended = true;
    this.ascensionService.ascend();
    this.ascend.emit();
  }
}
