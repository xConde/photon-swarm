import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { StorageService } from './storage.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

export type AchievementCategory = 'combat' | 'progression' | 'streaks' | 'survival';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  unlocked: boolean;
  progress: number;
  threshold: number;
  unlockedAt?: number;
}

interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  threshold: number;
}

interface PersistedAchievementData {
  unlockedIds: Record<string, number>; // id -> timestamp
  totalShards: number;
  totalRuns: number;
}

const STORAGE_KEY = 'achievements';

const ACHIEVEMENT_DEFINITIONS: ReadonlyArray<AchievementDefinition> = [
  // Combat
  { id: 'first_blood', name: 'First Blood', description: 'Get your first kill', category: 'combat', threshold: 1 },
  {
    id: 'centurion',
    name: 'Centurion',
    description: 'Kill 100 enemies in a single run',
    category: 'combat',
    threshold: 100,
  },
  {
    id: 'untouchable',
    name: 'Untouchable',
    description: 'Reach level 5 without taking damage',
    category: 'combat',
    threshold: 5,
  },
  {
    id: 'overkill',
    name: 'Overkill',
    description: 'Deal 500+ damage in a single hit',
    category: 'combat',
    threshold: 500,
  },

  // Progression
  {
    id: 'rank_10',
    name: 'Rising Star',
    description: 'Reach level 10 in a single run',
    category: 'progression',
    threshold: 10,
  },
  { id: 'rank_25', name: 'Veteran', description: 'Reach level 25', category: 'progression', threshold: 25 },
  { id: 'rank_50', name: 'Legend', description: 'Reach level 50', category: 'progression', threshold: 50 },
  {
    id: 'shard_hoarder',
    name: 'Shard Hoarder',
    description: 'Collect 10,000 total shards across all runs',
    category: 'progression',
    threshold: 10000,
  },

  // Streaks
  { id: 'rampage', name: 'Rampage', description: 'Get a 30-kill streak', category: 'streaks', threshold: 30 },
  {
    id: 'combo_master',
    name: 'Combo Master',
    description: 'Reach x3.0 combo multiplier',
    category: 'streaks',
    threshold: 3.0,
  },
  {
    id: 'chain_lightning',
    name: 'Chain Lightning',
    description: 'Kill 5 enemies within 2 seconds',
    category: 'streaks',
    threshold: 5,
  },

  // Survival
  {
    id: 'survivor_5',
    name: 'Survivor',
    description: 'Survive 5 minutes in a single run',
    category: 'survival',
    threshold: 300,
  },
  { id: 'survivor_15', name: 'Endurance', description: 'Survive 15 minutes', category: 'survival', threshold: 900 },
  { id: 'dedicated', name: 'Dedicated', description: 'Complete 10 runs', category: 'survival', threshold: 10 },
  { id: 'persistent', name: 'Persistent', description: 'Complete 25 runs', category: 'survival', threshold: 25 },
] as const;

@Injectable({
  providedIn: 'root',
})
export class AchievementService {
  private readonly achievements: Map<string, Achievement> = new Map();

  // Per-run state (reset each run)
  private runKills = 0;
  private runDamageTaken = false;
  private runMaxLevel = 1;
  private recentKillTimestamps: number[] = [];

  // Cumulative state (persisted)
  private totalShards = 0;
  private totalRuns = 0;

  // Event emitter for newly unlocked achievements
  private readonly _achievementUnlocked$ = new Subject<Achievement>();
  public readonly achievementUnlocked$ = this._achievementUnlocked$.asObservable();

  constructor(
    private storage: StorageService,
    private debugLog: DebugLogBridgeService
  ) {
    this.initializeAchievements();
    this.loadFromStorage();
  }

  // === Public API ===

  getAll(): Achievement[] {
    return Array.from(this.achievements.values());
  }

  isUnlocked(id: string): boolean {
    return this.achievements.get(id)?.unlocked ?? false;
  }

  getProgress(id: string): { current: number; threshold: number } {
    const achievement = this.achievements.get(id);
    if (!achievement) {
      return { current: 0, threshold: 0 };
    }
    return { current: achievement.progress, threshold: achievement.threshold };
  }

  getUnlockedCount(): number {
    let count = 0;
    for (const a of this.achievements.values()) {
      if (a.unlocked) count++;
    }
    return count;
  }

  getTotalCount(): number {
    return this.achievements.size;
  }

  // === Update methods (called from game systems) ===

  recordKill(): void {
    this.runKills++;

    // first_blood
    this.updateProgress('first_blood', this.runKills);

    // centurion
    this.updateProgress('centurion', this.runKills);

    // Track for chain_lightning
    const now = Date.now();
    this.recentKillTimestamps.push(now);
    // Remove timestamps older than 2 seconds
    const cutoff = now - 2000;
    this.recentKillTimestamps = this.recentKillTimestamps.filter((t) => t >= cutoff);
    this.updateProgress('chain_lightning', this.recentKillTimestamps.length);
  }

  recordDamageDealt(amount: number): void {
    // overkill — check if single hit exceeds threshold
    if (amount >= 500) {
      this.updateProgress('overkill', amount);
    }
  }

  recordDamageTaken(): void {
    this.runDamageTaken = true;
  }

  recordLevelUp(level: number): void {
    this.runMaxLevel = Math.max(this.runMaxLevel, level);

    // Check untouchable (reach level 5 without damage)
    if (!this.runDamageTaken && level >= 5) {
      this.updateProgress('untouchable', level);
    }

    // Rank achievements
    this.updateProgress('rank_10', level);
    this.updateProgress('rank_25', level);
    this.updateProgress('rank_50', level);
  }

  recordShardsCollected(amount: number): void {
    if (amount <= 0) return;
    this.totalShards += amount;
    this.updateProgress('shard_hoarder', this.totalShards);
    this.persist();
  }

  recordKillStreak(streak: number): void {
    this.updateProgress('rampage', streak);
  }

  recordComboMultiplier(multiplier: number): void {
    this.updateProgress('combo_master', multiplier);
  }

  recordMultiKill(count: number, _windowMs: number): void {
    this.updateProgress('chain_lightning', count);
  }

  recordTimeSurvived(seconds: number): void {
    this.updateProgress('survivor_5', seconds);
    this.updateProgress('survivor_15', seconds);
  }

  recordRunComplete(): void {
    this.totalRuns++;
    this.updateProgress('dedicated', this.totalRuns);
    this.updateProgress('persistent', this.totalRuns);
    this.persist();
  }

  resetRunState(): void {
    this.runKills = 0;
    this.runDamageTaken = false;
    this.runMaxLevel = 1;
    this.recentKillTimestamps = [];
  }

  // === Private helpers ===

  private initializeAchievements(): void {
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      this.achievements.set(def.id, {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        unlocked: false,
        progress: 0,
        threshold: def.threshold,
      });
    }
  }

  private loadFromStorage(): void {
    const data = this.storage.get<PersistedAchievementData>(STORAGE_KEY);
    if (!data) return;

    // Validate stored data structure
    if (typeof data !== 'object' || !data.unlockedIds || typeof data.unlockedIds !== 'object') {
      this.debugLog.log('Achievement data corrupted, resetting', 'warning', {
        source: 'achievement_service',
        operation: 'load_validation_failed',
      });
      this.storage.remove(STORAGE_KEY);
      return;
    }

    // Restore cumulative counters
    this.totalShards = typeof data.totalShards === 'number' && Number.isFinite(data.totalShards) ? data.totalShards : 0;
    this.totalRuns = typeof data.totalRuns === 'number' && Number.isFinite(data.totalRuns) ? data.totalRuns : 0;

    // Restore unlocked state
    for (const [id, timestamp] of Object.entries(data.unlockedIds)) {
      const achievement = this.achievements.get(id);
      if (achievement && typeof timestamp === 'number') {
        achievement.unlocked = true;
        achievement.progress = achievement.threshold;
        achievement.unlockedAt = timestamp;
      }
    }

    // Restore cumulative progress for non-unlocked achievements
    const shardAchievement = this.achievements.get('shard_hoarder');
    if (shardAchievement && !shardAchievement.unlocked) {
      shardAchievement.progress = this.totalShards;
    }
    const dedicatedAchievement = this.achievements.get('dedicated');
    if (dedicatedAchievement && !dedicatedAchievement.unlocked) {
      dedicatedAchievement.progress = this.totalRuns;
    }
    const persistentAchievement = this.achievements.get('persistent');
    if (persistentAchievement && !persistentAchievement.unlocked) {
      persistentAchievement.progress = this.totalRuns;
    }

    this.debugLog.log('Achievements loaded from storage', 'info', {
      source: 'achievement_service',
      operation: 'load',
      unlockedCount: this.getUnlockedCount(),
      totalRuns: this.totalRuns,
      totalShards: this.totalShards,
    });
  }

  private persist(): void {
    const unlockedIds: Record<string, number> = {};
    for (const achievement of this.achievements.values()) {
      if (achievement.unlocked && achievement.unlockedAt) {
        unlockedIds[achievement.id] = achievement.unlockedAt;
      }
    }

    const data: PersistedAchievementData = {
      unlockedIds,
      totalShards: this.totalShards,
      totalRuns: this.totalRuns,
    };

    this.storage.set(STORAGE_KEY, data);
  }

  private updateProgress(id: string, value: number): void {
    const achievement = this.achievements.get(id);
    if (!achievement || achievement.unlocked) return;

    achievement.progress = Math.max(achievement.progress, value);

    if (achievement.progress >= achievement.threshold) {
      achievement.unlocked = true;
      achievement.unlockedAt = Date.now();
      this._achievementUnlocked$.next({ ...achievement });
      this.persist();

      this.debugLog.log(`Achievement unlocked: ${achievement.name}`, 'success', {
        source: 'achievement_service',
        operation: 'unlock',
        achievementId: achievement.id,
        category: achievement.category,
      });
    }
  }
}
