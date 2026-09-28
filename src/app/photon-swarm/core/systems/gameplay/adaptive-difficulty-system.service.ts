import { Injectable, OnDestroy } from '@angular/core';
import { GameStateService } from '../../state/game-state.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Adaptive Difficulty System
 *
 * Dynamically adjusts game difficulty based on player performance to maintain
 * optimal challenge and engagement. Prevents both frustration from being too hard
 * and boredom from being too easy.
 *
 * Features:
 * - Tracks player performance metrics
 * - Adjusts enemy spawn rates and difficulty
 * - Provides smooth difficulty transitions
 * - Prevents death spirals and easy mode farming
 */
@Injectable({
  providedIn: 'root',
})
export class AdaptiveDifficultySystemService implements OnDestroy {
  // Performance tracking
  private performanceHistory: number[] = [];
  private readonly HISTORY_SIZE = 30; // Track last 30 seconds
  private lastUpdateTime = 0;
  private readonly UPDATE_INTERVAL = 1000; // Update every second

  // Timeout tracking for cleanup
  private decayTimers: number[] = [];

  // Performance metrics
  private recentDeaths = 0;
  private recentKills = 0;
  private damageDealtRate = 0;
  private damageTakenRate = 0;
  private healthStability = 100; // 0-100, how stable player health is

  // Difficulty adjustment
  private currentDifficultyMultiplier = 1.0;
  private targetDifficultyMultiplier = 1.0;
  private readonly MIN_DIFFICULTY = 0.5;
  private readonly MAX_DIFFICULTY = 2.0;
  private readonly DIFFICULTY_CHANGE_RATE = 0.01; // Per update

  // Performance scoring thresholds
  private readonly PERFORMANCE_EXCELLENT = 80;
  private readonly PERFORMANCE_GOOD = 60;
  private readonly PERFORMANCE_POOR = 40;
  private readonly PERFORMANCE_CRITICAL = 20;

  // Death spiral prevention
  private deathSpiralDetected = false;
  private lastDeathTime = 0;
  private consecutiveDeaths = 0;
  private readonly DEATH_SPIRAL_THRESHOLD = 3; // Deaths within 30 seconds
  private readonly DEATH_SPIRAL_WINDOW = 30000; // 30 seconds

  // Easy mode detection
  private easyModeDetected = false;
  private consecutiveFullHealth = 0;
  private readonly EASY_MODE_THRESHOLD = 10; // Seconds at full health

  constructor(
    private gameState: GameStateService,
    private debugLog: DebugLogBridgeService
  ) {}

  /**
   * Update adaptive difficulty system
   */
  update(_deltaTime: number): void {
    const currentTime = Date.now();

    // Throttle updates
    if (currentTime - this.lastUpdateTime < this.UPDATE_INTERVAL) {
      return;
    }

    this.lastUpdateTime = currentTime;

    // Calculate current performance score
    const performanceScore = this.calculatePerformanceScore();

    // Update performance history
    this.performanceHistory.push(performanceScore);
    if (this.performanceHistory.length > this.HISTORY_SIZE) {
      this.performanceHistory.shift();
    }

    // Detect special conditions
    this.detectDeathSpiral();
    this.detectEasyMode();

    // Adjust target difficulty based on performance
    this.adjustTargetDifficulty(performanceScore);

    // Smoothly transition current difficulty toward target
    this.smoothDifficultyTransition();
  }

  /**
   * Calculate player performance score (0-100)
   */
  private calculatePerformanceScore(): number {
    const health = this.gameState.getHealth();
    const maxHealth = this.gameState.getMaxHealth();
    const healthPercent = (health / maxHealth) * 100;

    // Base score on health percentage
    let score = healthPercent * 0.4; // 40% weight on current health

    // Factor in kill/death ratio (30% weight)
    const kdr = this.recentDeaths > 0 ? this.recentKills / this.recentDeaths : this.recentKills;
    score += Math.min(30, kdr * 10); // Cap at 30 points

    // Factor in damage dealt vs taken (20% weight)
    const damageRatio = this.damageTakenRate > 0 ? this.damageDealtRate / this.damageTakenRate : this.damageDealtRate;
    score += Math.min(20, damageRatio * 5); // Cap at 20 points

    // Factor in health stability (10% weight)
    score += (this.healthStability / 100) * 10;

    // Apply death spiral penalty
    if (this.deathSpiralDetected) {
      score *= 0.5; // Halve score during death spiral
    }

    // Apply easy mode bonus
    if (this.easyModeDetected) {
      score = Math.min(100, score * 1.2); // 20% bonus, capped at 100
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Detect if player is in a death spiral
   */
  private detectDeathSpiral(): void {
    const currentTime = Date.now();

    // Check if player recently died
    if (this.gameState.getHealth() <= 0) {
      if (currentTime - this.lastDeathTime < this.DEATH_SPIRAL_WINDOW) {
        this.consecutiveDeaths++;
      } else {
        this.consecutiveDeaths = 1;
      }
      this.lastDeathTime = currentTime;
    }

    // Update death spiral status
    const wasInDeathSpiral = this.deathSpiralDetected;
    this.deathSpiralDetected = this.consecutiveDeaths >= this.DEATH_SPIRAL_THRESHOLD;

    // Log state change
    if (this.deathSpiralDetected && !wasInDeathSpiral) {
      this.debugLog.log('⚠️ Death Spiral Detected - Reducing Difficulty', 'warning', {
        source: 'adaptive_difficulty',
        consecutiveDeaths: this.consecutiveDeaths,
        timeWindow: this.DEATH_SPIRAL_WINDOW,
      });
    } else if (!this.deathSpiralDetected && wasInDeathSpiral) {
      this.debugLog.log('✅ Death Spiral Resolved', 'info', {
        source: 'adaptive_difficulty',
      });
    }

    // Reset counter if enough time has passed
    if (currentTime - this.lastDeathTime > this.DEATH_SPIRAL_WINDOW) {
      this.consecutiveDeaths = 0;
    }
  }

  /**
   * Detect if game is too easy for player
   */
  private detectEasyMode(): void {
    const health = this.gameState.getHealth();
    const maxHealth = this.gameState.getMaxHealth();

    // Check if at full health
    if (health >= maxHealth * 0.95) {
      this.consecutiveFullHealth++;
    } else {
      this.consecutiveFullHealth = 0;
    }

    // Update easy mode status
    const wasInEasyMode = this.easyModeDetected;
    this.easyModeDetected = this.consecutiveFullHealth >= this.EASY_MODE_THRESHOLD;

    // Log state change
    if (this.easyModeDetected && !wasInEasyMode) {
      this.debugLog.log('🎮 Easy Mode Detected - Increasing Difficulty', 'info', {
        source: 'adaptive_difficulty',
        secondsAtFullHealth: this.consecutiveFullHealth,
      });
    } else if (!this.easyModeDetected && wasInEasyMode) {
      this.debugLog.log('⚔️ Challenge Restored', 'info', {
        source: 'adaptive_difficulty',
      });
    }
  }

  /**
   * Adjust target difficulty based on performance
   */
  private adjustTargetDifficulty(performanceScore: number): void {
    let targetChange = 0;

    if (performanceScore >= this.PERFORMANCE_EXCELLENT) {
      // Player doing excellent - increase difficulty
      targetChange = 0.1;
    } else if (performanceScore >= this.PERFORMANCE_GOOD) {
      // Player doing good - slight increase
      targetChange = 0.05;
    } else if (performanceScore <= this.PERFORMANCE_CRITICAL) {
      // Player struggling badly - significant decrease
      targetChange = -0.15;
    } else if (performanceScore <= this.PERFORMANCE_POOR) {
      // Player struggling - decrease difficulty
      targetChange = -0.1;
    }

    // Apply death spiral emergency reduction
    if (this.deathSpiralDetected) {
      targetChange = Math.min(targetChange, -0.2);
    }

    // Apply easy mode increase
    if (this.easyModeDetected) {
      targetChange = Math.max(targetChange, 0.15);
    }

    // Update target with clamping
    this.targetDifficultyMultiplier = Math.max(
      this.MIN_DIFFICULTY,
      Math.min(this.MAX_DIFFICULTY, this.targetDifficultyMultiplier + targetChange)
    );
  }

  /**
   * Smoothly transition current difficulty toward target
   */
  private smoothDifficultyTransition(): void {
    const diff = this.targetDifficultyMultiplier - this.currentDifficultyMultiplier;

    // Apply smooth transition
    if (Math.abs(diff) > 0.001) {
      const change = Math.sign(diff) * Math.min(Math.abs(diff), this.DIFFICULTY_CHANGE_RATE);
      this.currentDifficultyMultiplier += change;
    }
  }

  /**
   * Get current difficulty multiplier for enemy spawning
   */
  getSpawnRateMultiplier(): number {
    // In death spiral, reduce spawn rate significantly
    if (this.deathSpiralDetected) {
      return this.currentDifficultyMultiplier * 0.7;
    }

    // In easy mode, increase spawn rate
    if (this.easyModeDetected) {
      return this.currentDifficultyMultiplier * 1.2;
    }

    return this.currentDifficultyMultiplier;
  }

  /**
   * Get current difficulty multiplier for enemy health
   */
  getEnemyHealthMultiplier(): number {
    return this.currentDifficultyMultiplier;
  }

  /**
   * Get current difficulty multiplier for enemy damage
   */
  getEnemyDamageMultiplier(): number {
    // Damage scales less aggressively than spawn rate
    return 1.0 + (this.currentDifficultyMultiplier - 1.0) * 0.5;
  }

  /**
   * Record player death for tracking
   */
  recordPlayerDeath(): void {
    this.recentDeaths++;

    // Decay old deaths over time (track timer for cleanup)
    const timerId = window.setTimeout(() => {
      this.recentDeaths = Math.max(0, this.recentDeaths - 1);
      this.removeTimer(timerId);
    }, 30000);
    this.decayTimers.push(timerId);
  }

  /**
   * Record enemy kill for tracking
   */
  recordEnemyKill(): void {
    this.recentKills++;

    // Decay old kills over time (track timer for cleanup)
    const timerId = window.setTimeout(() => {
      this.recentKills = Math.max(0, this.recentKills - 1);
      this.removeTimer(timerId);
    }, 30000);
    this.decayTimers.push(timerId);
  }

  /**
   * Remove completed timer from tracking array
   */
  private removeTimer(timerId: number): void {
    const index = this.decayTimers.indexOf(timerId);
    if (index !== -1) {
      this.decayTimers.splice(index, 1);
    }
  }

  /**
   * Update damage tracking
   */
  updateDamageRates(damageDealt: number, damageTaken: number): void {
    // Use exponential moving average for smooth tracking
    const alpha = 0.1;
    this.damageDealtRate = this.damageDealtRate * (1 - alpha) + damageDealt * alpha;
    this.damageTakenRate = this.damageTakenRate * (1 - alpha) + damageTaken * alpha;
  }

  /**
   * Reset adaptive difficulty system
   */
  reset(): void {
    // Clear all pending timers
    this.clearAllTimers();

    this.performanceHistory = [];
    this.recentDeaths = 0;
    this.recentKills = 0;
    this.damageDealtRate = 0;
    this.damageTakenRate = 0;
    this.healthStability = 100;
    this.currentDifficultyMultiplier = 1.0;
    this.targetDifficultyMultiplier = 1.0;
    this.deathSpiralDetected = false;
    this.consecutiveDeaths = 0;
    this.easyModeDetected = false;
    this.consecutiveFullHealth = 0;

    this.debugLog.log('🔄 Adaptive Difficulty Reset', 'info', {
      source: 'adaptive_difficulty',
    });
  }

  /**
   * Clear all pending decay timers
   */
  private clearAllTimers(): void {
    for (const timerId of this.decayTimers) {
      window.clearTimeout(timerId);
    }
    this.decayTimers = [];
  }

  /**
   * Angular lifecycle hook
   */
  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clearAllTimers();
    this.performanceHistory = [];
  }

  /**
   * Get current difficulty state for debugging
   */
  getDebugState(): Record<string, unknown> {
    return {
      currentDifficulty: this.currentDifficultyMultiplier.toFixed(2),
      targetDifficulty: this.targetDifficultyMultiplier.toFixed(2),
      performanceHistory: this.performanceHistory.slice(-5).map((p) => p.toFixed(1)),
      deathSpiral: this.deathSpiralDetected,
      easyMode: this.easyModeDetected,
      recentKills: this.recentKills,
      recentDeaths: this.recentDeaths,
    };
  }
}
