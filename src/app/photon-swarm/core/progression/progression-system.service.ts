import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { EngineSystem } from '../utils/system';
import { EngineApi } from '../utils/engine-api';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { AscensionService } from '../../services/ascension.service';
import { AudioService } from '../audio/audio.service';
import { AchievementService } from '../../services/achievement.service';
import { BuffSystemService } from './buff-system.service';

/**
 * Handles player-centric long-term progression – XP, level, ascension, and meta upgrades.
 * Stateless consumers (UI, Engine façade) subscribe to the public signals instead of probing
 * mutable fields directly.
 */
@EngineSystem()
@Injectable({ providedIn: 'root' })
export class ProgressionSystemService {
  constructor(
    private debugLog: DebugLogBridgeService,
    private audio: AudioService,
    private ascensionService: AscensionService,
    private achievementService: AchievementService,
    private buffSystem: BuffSystemService
  ) {}
  // ──────────────────────────────────────────────────────────────────────────
  // Internal state (kept private – access only through getters/setters)
  private _xp = 0;
  private _level = 1;

  // Observable signals
  private readonly _levelUp$ = new Subject<number>();
  public readonly levelUp$: Observable<number> = this._levelUp$.asObservable();

  // ──────────────────────────────────────────────────────────────────────────
  // XP & Level helpers ------------------------------------------------------

  /**
   * Adds experience points to the player's progression
   * Automatically handles level ups when XP threshold is reached
   * Ignores XP gains when at max level
   * @param amount Amount of XP to add (negative values ignored)
   */
  addXp(amount: number): void {
    if (amount <= 0) return;

    // Check if at max level
    if (this._level >= PROGRESSION_CONFIG.MAX_LEVEL) {
      // Log max level reached
      this.debugLog.log(`🏆 MAX LEVEL - XP gain ignored`, 'warning', {
        source: 'progression_system',
        operation: 'xp_gain_blocked',
        amount,
        currentLevel: this._level,
        maxLevel: PROGRESSION_CONFIG.MAX_LEVEL,
        prestigeEnabled: PROGRESSION_CONFIG.PRESTIGE_ENABLED,
      });

      return;
    }

    const previousLevel = this._level;
    const previousXp = this._xp;
    // Level scaling: per-kill XP (ENEMY_XP) is flat, but the requirement compounds at
    // 1.12^(L-1). Scale gains by 1.12^((L-1) * XP_LEVEL_SCALE) so kills-per-level grows gently
    // instead of exploding — fixes the late-level grind where the bar crawled near the top.
    // Applied at this single seam so every XP source (kills, caches, guardians) scales uniformly.
    const levelScale = Math.pow(
      PROGRESSION_CONFIG.XP_MULTIPLIER,
      (this._level - 1) * PROGRESSION_CONFIG.XP_LEVEL_SCALE
    );
    const boostedAmount = Math.floor(
      amount * this.ascensionService.getXpBonus() * this.buffSystem.experienceGainMultiplier * levelScale
    );
    this._xp += boostedAmount;

    // Log XP gain — show the applied (boosted) amount and the raw base for diagnostics.
    this.debugLog.log(`⚡ XP Gained: +${boostedAmount} (base ${amount})`, 'info', {
      source: 'progression_system',
      operation: 'xp_gain',
      amount,
      boostedAmount,
      xpBefore: previousXp,
      xpAfter: this._xp,
      currentLevel: this._level,
      xpForNext: this.getXpForNextLevel(),
    });

    // FIX: Process ALL level ups properly to prevent XP accumulation
    let levelUps = 0;
    const MAX_LEVEL_UPS = 10; // Safety limit to prevent infinite loops

    while (
      this._xp >= this.getXpForNextLevel() &&
      levelUps < MAX_LEVEL_UPS &&
      this._level < PROGRESSION_CONFIG.MAX_LEVEL
    ) {
      const xpRequired = this.getXpForNextLevel();
      this._xp -= xpRequired;
      this._level++;
      levelUps++;

      // Log level up to debug system instead of console
      this.debugLog.log(
        `LEVEL UP TRIGGERED: Level ${this._level}, XP: ${this._xp}/${this.getXpForNextLevel()}`,
        'warning',
        {
          source: 'progression_system',
          level: this._level,
          currentXp: this._xp,
          nextLevelXp: this.getXpForNextLevel(),
        }
      );
      this._levelUp$.next(this._level);
      this.audio.playLevelUp();
      this.achievementService.recordLevelUp(this._level);

      // Log level up event
      this.debugLog.log(`🎉 LEVEL UP! ${previousLevel} → ${this._level}`, 'success', {
        source: 'progression_system',
        operation: 'level_up',
        previousLevel,
        newLevel: this._level,
        remainingXp: this._xp,
        nextLevelXp: this.getXpForNextLevel(),
        isMaxLevel: this._level >= PROGRESSION_CONFIG.MAX_LEVEL,
      });
    }

    // At MAX_LEVEL there are no further levels to spend XP on, so any residual is unusable.
    // Clear it to prevent unbounded accumulation/overflow and so the bar reads as fully maxed
    // (matches the max-level convention: gains are ignored once capped).
    if (this._level >= PROGRESSION_CONFIG.MAX_LEVEL) {
      this._xp = 0;
    }
  }

  /**
   * Gets the current player level (1-based)
   * @returns Current level (minimum 1)
   */
  get level(): number {
    return this._level;
  }

  /**
   * Gets the current experience points
   * @returns Current XP accumulated
   */
  get xp(): number {
    return this._xp;
  }

  /**
   * Gets the current ascension level (meta progression)
   * @returns Ascension level (0 = no ascensions)
   */
  get ascensionLevel(): number {
    return this.ascensionService.getAscensionLevel();
  }

  /**
   * Sets the player level (clamped to minimum 1)
   * Note: Does NOT reset XP to prevent level up bugs
   * @param val New level value
   */
  set level(val: number) {
    this._level = Math.max(1, val);
    // DO NOT RESET XP! This was causing the level up bug
    // this._xp = 0; // REMOVED - this was wiping XP on level change
  }

  /**
   * Sets the experience points (clamped to minimum 0)
   * @param val New XP value
   */
  set xp(val: number) {
    this._xp = Math.max(0, val);
  }

  /**
   * Sets experience points directly (uses xp setter)
   * @param val New XP value
   */
  setXp(val: number): void {
    this.xp = val;
  }

  /**
   * Sets level directly (uses level setter)
   * @param val New level value
   */
  setLevel(val: number): void {
    this.level = val;
  }

  /**
   * Calculates XP required to reach the next level
   * Uses exponential progression curve for balanced gameplay
   * Formula: XP_BASE * XP_MULTIPLIER^(level-1)
   * Examples: Level 1→2: 100 XP, Level 10: ~5000 XP, Level 20: ~20000 XP
   * @returns XP needed for next level (MAX_SAFE_INTEGER at max level)
   */
  getXpForNextLevel(): number {
    // At max level, return a large number to prevent overflow
    if (this._level >= PROGRESSION_CONFIG.MAX_LEVEL) {
      return Number.MAX_SAFE_INTEGER;
    }

    // Balanced progression to prevent excessive upgrades
    // Level 1→2: 100 XP (~10 basic enemies)
    // Level 2→3: 150 XP (~15 basic enemies)
    // Level 3→4: 225 XP (~23 basic enemies)
    // Level 10: ~5000 XP
    // Level 20: ~20000 XP
    // Level 50: ~6.5 million XP (theoretical max)
    // Base formula: 100 * 1.5^(level-1)
    // This gives a smoother progression curve that requires meaningful gameplay
    const xpRequired = PROGRESSION_CONFIG.XP_BASE * Math.pow(PROGRESSION_CONFIG.XP_MULTIPLIER, this._level - 1);

    // Prevent overflow at very high levels
    if (xpRequired > Number.MAX_SAFE_INTEGER / 2) {
      return Math.floor(Number.MAX_SAFE_INTEGER / 2);
    }

    return Math.floor(xpRequired);
  }

  /**
   * Resets run-bound progression to initial state
   * Resets XP to 0 and level to 1
   * Does NOT reset ascension level or meta progression
   * Call this when starting a new game run
   */
  reset(): void {
    const previousLevel = this._level;
    const previousXp = this._xp;

    this._xp = 0;
    this._level = 1;

    this.debugLog.log('🔄 Progression Reset', 'warning', {
      source: 'progression_system',
      operation: 'reset',
      previousLevel,
      previousXp,
      ascensionLevel: this.ascensionLevel,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Ascension & meta progression -------------------------------------------

  /**
   * Increases the ascension level by 1 (meta progression)
   * Ascension levels persist across runs and provide permanent bonuses
   */
  increaseAscensionLevel(): void {
    const previousAscension = this.ascensionLevel;
    const newLevel = this.ascensionService.ascend();

    this.debugLog.log(`⭐ ASCENSION LEVEL UP! ${previousAscension} → ${newLevel}`, 'success', {
      source: 'progression_system',
      operation: 'ascension_increase',
      previousLevel: previousAscension,
      newLevel,
    });
  }

  /**
   * Sets the game engine reference (EngineSystem lifecycle method)
   * Currently not used by this service
   * @param _engine Game engine instance
   */
  setGameEngine(_engine: EngineApi): void {}
}
