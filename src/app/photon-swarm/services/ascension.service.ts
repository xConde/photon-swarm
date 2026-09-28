import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import {
  getMasteryUnlockForLevel,
  getMaxHeatLevelForMastery,
  getRerollChargesForMastery,
  HeatLevel,
} from '../config/heat.config';

const STORAGE_KEY = 'ascension-level';

/**
 * Manages mastery meta-progression.
 * Mastery persists across runs and unlocks choices without flat power creep.
 */
@Injectable({ providedIn: 'root' })
export class AscensionService {
  private ascensionLevel = 0;

  constructor(
    private storage: StorageService,
    private debugLog: DebugLogBridgeService
  ) {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const stored = this.storage.get<number>(STORAGE_KEY);
    if (stored != null && typeof stored === 'number' && Number.isFinite(stored)) {
      this.ascensionLevel = Math.min(
        Math.max(0, Math.floor(stored)),
        PROGRESSION_CONFIG.ASCENSION_BONUSES.MAX_ASCENSION_LEVEL
      );
    } else {
      this.ascensionLevel = 0;
    }
  }

  private persist(): void {
    this.storage.set(STORAGE_KEY, this.ascensionLevel);
  }

  getAscensionLevel(): number {
    return this.ascensionLevel;
  }

  /** One baseline refit, with a second unlocked by Mastery 2. */
  getRerollCharges(): number {
    return getRerollChargesForMastery(this.ascensionLevel);
  }

  /** Heat is opt-in pressure: Mastery 1 unlocks Heat 1, Mastery 3 unlocks Heat 2. */
  getMaxHeatLevel(): HeatLevel {
    return getMaxHeatLevelForMastery(this.ascensionLevel);
  }

  getUnlockForLevel(level: number): string {
    return getMasteryUnlockForLevel(level);
  }

  /**
   * Whether the player can ascend given their current run level.
   */
  canAscend(currentLevel: number): boolean {
    if (this.ascensionLevel >= PROGRESSION_CONFIG.ASCENSION_BONUSES.MAX_ASCENSION_LEVEL) {
      return false;
    }
    return currentLevel >= this.getRequiredLevel();
  }

  /**
   * Performs an ascension: increments level, persists, and returns the new level.
   */
  ascend(): number {
    const prev = this.ascensionLevel;
    this.ascensionLevel = Math.min(this.ascensionLevel + 1, PROGRESSION_CONFIG.ASCENSION_BONUSES.MAX_ASCENSION_LEVEL);
    this.persist();

    this.debugLog.log(`Ascension ${prev} -> ${this.ascensionLevel}`, 'success', {
      source: 'ascension_service',
      operation: 'ascend',
      previousLevel: prev,
      newLevel: this.ascensionLevel,
    });

    return this.ascensionLevel;
  }

  /** @deprecated Mastery no longer grants permanent combat power. */
  getDamageBonus(): number {
    return 1;
  }

  /** @deprecated Mastery no longer grants permanent combat power. */
  getHealthBonus(): number {
    return 1;
  }

  /** @deprecated Mastery no longer grants permanent combat power. */
  getShardBonus(): number {
    return 1;
  }

  /** @deprecated Mastery no longer grants permanent combat power. */
  getXpBonus(): number {
    return 1;
  }

  /** The run level required for the next ascension. */
  getRequiredLevel(): number {
    const { BASE_LEVEL_REQUIRED, LEVEL_PER_ASCENSION } = PROGRESSION_CONFIG.ASCENSION_REQUIREMENTS;
    return BASE_LEVEL_REQUIRED + this.ascensionLevel * LEVEL_PER_ASCENSION;
  }

  /** Resets ascension progress (for testing or explicit "Reset All Progress"). */
  reset(): void {
    this.ascensionLevel = 0;
    this.persist();
  }
}
