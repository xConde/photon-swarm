import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import { GameStats } from '../core/models/game-state.model';

const STORAGE_KEY = 'run-history';
const MAX_RUNS = 10;

export interface RunEntry {
  stats: GameStats;
  date: number;
  ascensionLevel: number;
}

export interface PersonalBests {
  bestKills: number;
  bestLevel: number;
  bestTime: number;
  bestCombo: number;
}

/**
 * Tracks run history and personal bests across game sessions.
 * Stores up to 10 most recent runs in localStorage.
 */
@Injectable({ providedIn: 'root' })
export class RunHistoryService {
  constructor(private storage: StorageService) {}

  /**
   * Saves a completed run to history, prepending it and trimming to MAX_RUNS.
   */
  saveRun(stats: GameStats, ascensionLevel: number): void {
    const history = this.getHistory();
    const entry: RunEntry = {
      stats,
      date: Date.now(),
      ascensionLevel,
    };
    history.unshift(entry);
    if (history.length > MAX_RUNS) {
      history.length = MAX_RUNS;
    }
    this.storage.set(STORAGE_KEY, history);
  }

  /**
   * Returns all stored runs, most recent first.
   */
  getHistory(): RunEntry[] {
    const raw = this.storage.get<unknown[]>(STORAGE_KEY) ?? [];
    return Array.isArray(raw) ? raw.filter((e) => this.isValidRunEntry(e)) : [];
  }

  private isValidRunEntry(entry: unknown): entry is RunEntry {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Record<string, unknown>;
    if (typeof e['date'] !== 'number' || !Number.isFinite(e['date'])) return false;
    if (typeof e['ascensionLevel'] !== 'number' || !Number.isFinite(e['ascensionLevel'])) return false;
    const stats = e['stats'];
    if (!stats || typeof stats !== 'object') return false;
    const s = stats as Record<string, unknown>;
    return (
      typeof s['level'] === 'number' &&
      Number.isFinite(s['level']) &&
      typeof s['shards'] === 'number' &&
      Number.isFinite(s['shards']) &&
      typeof s['time'] === 'number' &&
      Number.isFinite(s['time'])
    );
  }

  /**
   * Returns the run with the highest kill count, or null if no runs exist.
   */
  getBestRun(): RunEntry | null {
    const history = this.getHistory();
    if (history.length === 0) {
      return null;
    }
    return history.reduce((best, entry) => ((entry.stats.kills ?? 0) > (best.stats.kills ?? 0) ? entry : best));
  }

  /**
   * Scans all stored runs and returns the personal best for each tracked metric.
   */
  getPersonalBests(): PersonalBests {
    const history = this.getHistory();
    const bests: PersonalBests = {
      bestKills: 0,
      bestLevel: 0,
      bestTime: 0,
      bestCombo: 0,
    };

    for (const entry of history) {
      const s = entry.stats;
      bests.bestKills = Math.max(bests.bestKills, s.kills ?? 0);
      bests.bestLevel = Math.max(bests.bestLevel, s.level);
      bests.bestTime = Math.max(bests.bestTime, s.time);
      bests.bestCombo = Math.max(bests.bestCombo, s.maxKillStreak ?? 0);
    }

    return bests;
  }
}
