import { Injectable } from '@angular/core';
import { EngineSystem } from '../utils/system';
import { StorageService } from '../../services/storage.service';
import { RunCheckpoint, SaveGameData } from '../models/save-game.model';
import { EnemyType } from '../models/enemy.model';

/**
 * Thin wrapper around StorageService that owns the serialisation/deserialisation
 * contract for persisted runs.  This is deliberately framework-agnostic: the
 * payload returned by `load()` is pure POJO with rich typing.
 */
@EngineSystem()
@Injectable({ providedIn: 'root' })
export class SaveGameAdapter {
  private static readonly VERSION = 1;
  private readonly KEY = 'save-v2';
  private readonly NAME_KEY = 'player-name';
  private readonly CHECKPOINT_KEY = 'run-checkpoint';

  constructor(private storage: StorageService) {}

  /** Persist the provided payload to localStorage */
  save(data: SaveGameData): boolean {
    try {
      const normalized: SaveGameData = {
        ...data,
        version: SaveGameAdapter.VERSION,
        timestamp: Date.now(),
      };
      // Validate required fields before saving
      if (!this.isValidSaveData(normalized)) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Invalid save data provided, skipping save', 'warning', {
            source: 'save_game_adapter',
            operation: 'save',
          });
        }
        return false;
      }

      const persisted = this.storage.set<SaveGameData>(this.KEY, normalized);
      return persisted !== false;
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to save game state', 'error', {
          source: 'save_game_adapter',
          operation: 'save',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }

  /** Retrieve the last save-file or null if none exists */
  load(): SaveGameData | null {
    try {
      const data = this.storage.get<SaveGameData>(this.KEY);
      if (!data) return null;

      // Version check
      if (data.version !== SaveGameAdapter.VERSION) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log(
            `Save version mismatch: expected ${SaveGameAdapter.VERSION}, got ${data.version}`,
            'warning',
            {
              source: 'save_game_adapter',
              operation: 'load',
              expectedVersion: SaveGameAdapter.VERSION,
              actualVersion: data.version,
            }
          );
        }
        return null;
      }

      // Validate loaded data
      if (!this.isValidSaveData(data)) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Loaded save data is invalid, clearing corrupted save', 'warning', {
            source: 'save_game_adapter',
            operation: 'load',
            action: 'clearing_corrupted_save',
          });
        }
        this.clear();
        return null;
      }

      return data;
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to load game state', 'error', {
          source: 'save_game_adapter',
          operation: 'load',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  /** Clear persisted save data */
  clear(): void {
    try {
      this.storage.remove(this.KEY);
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to clear save data', 'error', {
          source: 'save_game_adapter',
          operation: 'clear',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Persist player name separately from save data */
  savePlayerName(name: string): void {
    try {
      this.storage.set<string>(this.NAME_KEY, name?.trim() || '');
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to save player name', 'error', {
          source: 'save_game_adapter',
          operation: 'savePlayerName',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Retrieve persisted player name or null if none exists */
  loadPlayerName(): string | null {
    try {
      return this.storage.get<string>(this.NAME_KEY);
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to load player name', 'error', {
          source: 'save_game_adapter',
          operation: 'loadPlayerName',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  /** Clear persisted player name */
  clearPlayerName(): void {
    try {
      this.storage.remove(this.NAME_KEY);
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to clear player name', 'error', {
          source: 'save_game_adapter',
          operation: 'clearPlayerName',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Check if a valid save exists */
  hasSave(): boolean {
    return this.load() !== null;
  }

  // === HELPER METHODS FOR GAME ENGINE ===

  public loadGameState(): boolean {
    const data = this.load();
    if (data) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('📁 Loading game state...', 'info', {
          source: 'save_game_adapter',
          operation: 'loadGameState',
        });
      }
      return true;
    }
    return false;
  }

  public clearGameState(): void {
    this.clear();
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🗑️ Cleared game state', 'info', {
        source: 'save_game_adapter',
        operation: 'clearGameState',
      });
    }
  }

  /** Get save timestamp or null if no save exists */
  getSaveTimestamp(): number | null {
    const data = this.load();
    return data?.timestamp ?? null;
  }

  // === RUN CHECKPOINT METHODS ===

  /** Save a lightweight run checkpoint to localStorage. */
  saveCheckpoint(checkpoint: RunCheckpoint): boolean {
    try {
      const normalized: RunCheckpoint = {
        ...checkpoint,
        version: SaveGameAdapter.VERSION,
        timestamp: Date.now(),
      };
      if (!this.isValidCheckpoint(normalized)) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Invalid checkpoint data provided, skipping save', 'warning', {
            source: 'save_game_adapter',
            operation: 'saveCheckpoint',
          });
        }
        return false;
      }

      if (!this.storage.set<RunCheckpoint>(this.CHECKPOINT_KEY, normalized)) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log('Failed to save checkpoint', 'error', {
            source: 'save_game_adapter',
            operation: 'saveCheckpoint',
            error: 'Storage rejected the write',
          });
        }
        return false;
      }

      if (window.debugLogBridge) {
        window.debugLogBridge.log('Checkpoint saved', 'info', {
          source: 'save_game_adapter',
          operation: 'saveCheckpoint',
          level: checkpoint.level,
          health: checkpoint.health,
          shards: checkpoint.shards,
        });
      }
      return true;
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to save checkpoint', 'error', {
          source: 'save_game_adapter',
          operation: 'saveCheckpoint',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return false;
    }
  }

  /** Load a run checkpoint or null if none exists */
  loadCheckpoint(): RunCheckpoint | null {
    try {
      const data = this.storage.get<RunCheckpoint>(this.CHECKPOINT_KEY);
      if (!data) return null;
      if (data.version !== SaveGameAdapter.VERSION) {
        this.clearCheckpoint();
        return null;
      }
      if (!this.isValidCheckpoint(data)) {
        this.clearCheckpoint();
        return null;
      }
      return data;
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to load checkpoint', 'error', {
          source: 'save_game_adapter',
          operation: 'loadCheckpoint',
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
  }

  /** Remove the run checkpoint */
  clearCheckpoint(): void {
    try {
      this.storage.remove(this.CHECKPOINT_KEY);
    } catch (error) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to clear checkpoint', 'error', {
          source: 'save_game_adapter',
          operation: 'clearCheckpoint',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /** Check if a valid run checkpoint exists */
  hasCheckpoint(): boolean {
    return this.loadCheckpoint() !== null;
  }

  /** Validate checkpoint data structure */
  private isValidCheckpoint(data: unknown): data is RunCheckpoint {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    return (
      this.isNonNegativeFinite(obj['health']) &&
      this.isPositiveFinite(obj['maxHealth']) &&
      obj['health'] <= obj['maxHealth'] &&
      this.isPositiveInteger(obj['level']) &&
      this.isNonNegativeFinite(obj['xp']) &&
      this.isNonNegativeInteger(obj['shards']) &&
      this.isNonNegativeInteger(obj['kills']) &&
      this.isNonNegativeFinite(obj['timePlayed']) &&
      this.isPositiveFinite(obj['timestamp']) &&
      typeof obj['playerName'] === 'string' &&
      obj['playerName'].trim().length > 0 &&
      this.isUpgradeRecord(obj['upgrades']) &&
      (obj['factionStandings'] === undefined || this.isFactionSnapshotArray(obj['factionStandings']))
    );
  }

  /** Validate save data structure */
  private isValidSaveData(data: unknown): data is SaveGameData {
    if (!data || typeof data !== 'object') return false;

    const obj = data as Record<string, unknown>; // Type assertion for property access

    // Check required fields
    if (
      !obj['player'] ||
      typeof obj['seed'] !== 'string' ||
      obj['seed'].trim().length === 0 ||
      !this.isPositiveFinite(obj['timestamp'])
    ) {
      return false;
    }

    if (obj['worldHash'] !== undefined && typeof obj['worldHash'] !== 'string') return false;

    // Validate player snapshot
    const player = obj['player'] as Record<string, unknown>;
    if (
      !player ||
      typeof player !== 'object' ||
      typeof player['name'] !== 'string' ||
      player['name'].trim().length === 0 ||
      !Number.isFinite(player['x']) ||
      !Number.isFinite(player['y']) ||
      !this.isNonNegativeFinite(player['health']) ||
      !this.isPositiveFinite(player['maxHealth']) ||
      player['health'] > player['maxHealth'] ||
      !this.isNonNegativeInteger(player['shards']) ||
      !this.isNonNegativeFinite(player['xp']) ||
      !this.isPositiveInteger(player['level']) ||
      (player['ascensionLevel'] !== undefined && !this.isNonNegativeInteger(player['ascensionLevel'])) ||
      (player['currentClass'] !== undefined && typeof player['currentClass'] !== 'string') ||
      (player['unlockedTraits'] !== undefined && !this.isStringArray(player['unlockedTraits'])) ||
      (player['persistentUpgrades'] !== undefined && !this.isUpgradeRecord(player['persistentUpgrades'])) ||
      (player['currentRunUpgrades'] !== undefined && !this.isUpgradeRecord(player['currentRunUpgrades'])) ||
      (player['currentRunCurses'] !== undefined && !this.isCurseSnapshotArray(player['currentRunCurses']))
    ) {
      return false;
    }

    // Validate enemies array
    if (!Array.isArray(obj['enemies'])) return false;

    for (const enemy of obj['enemies'] as unknown[]) {
      if (!enemy || typeof enemy !== 'object') return false;
      const enemyObj = enemy as Record<string, unknown>;
      if (
        typeof enemyObj['id'] !== 'string' ||
        enemyObj['id'].length === 0 ||
        !this.isEnemyType(enemyObj['type']) ||
        !Number.isFinite(enemyObj['x']) ||
        !Number.isFinite(enemyObj['y']) ||
        !this.isNonNegativeFinite(enemyObj['health']) ||
        !this.isPositiveFinite(enemyObj['maxHealth']) ||
        enemyObj['health'] > enemyObj['maxHealth'] ||
        (enemyObj['rarity'] !== undefined && !this.isEnemyRarity(enemyObj['rarity'])) ||
        (enemyObj['isElite'] !== undefined && typeof enemyObj['isElite'] !== 'boolean') ||
        (enemyObj['isChampion'] !== undefined && typeof enemyObj['isChampion'] !== 'boolean') ||
        (enemyObj['factionId'] !== undefined && !this.isFactionId(enemyObj['factionId'], true)) ||
        (enemyObj['vx'] !== undefined && !Number.isFinite(enemyObj['vx'])) ||
        (enemyObj['vy'] !== undefined && !Number.isFinite(enemyObj['vy'])) ||
        (enemyObj['behaviorPattern'] !== undefined && typeof enemyObj['behaviorPattern'] !== 'string')
      ) {
        return false;
      }
    }

    if (obj['meta'] !== undefined && !this.isGameMetaSnapshot(obj['meta'])) return false;

    return true;
  }

  private isEnemyType(value: unknown): value is EnemyType {
    return (
      value === EnemyType.Basic ||
      value === EnemyType.Spitter ||
      value === EnemyType.Tank ||
      value === EnemyType.Swarm ||
      value === EnemyType.Thug ||
      value === EnemyType.Sniper ||
      value === EnemyType.Boss ||
      value === EnemyType.Disruptor ||
      value === EnemyType.Sentinel
    );
  }

  private isEnemyRarity(value: unknown): value is 'common' | 'rare' | 'legendary' {
    return value === 'common' || value === 'rare' || value === 'legendary';
  }

  private isFactionId(value: unknown, allowNeutral = false): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= (allowNeutral ? 0 : 1) && value <= 4;
  }

  private isFactionSnapshotArray(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.every((snapshot) => {
      if (!snapshot || typeof snapshot !== 'object') return false;
      const obj = snapshot as Record<string, unknown>;
      return (
        this.isFactionId(obj['factionId']) && typeof obj['standing'] === 'number' && Number.isFinite(obj['standing'])
      );
    });
  }

  private isGameMetaSnapshot(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return (
      this.isNonNegativeFinite(obj['survivalTime']) &&
      typeof obj['survivalPhase'] === 'string' &&
      obj['survivalPhase'].trim().length > 0 &&
      this.isPositiveInteger(obj['currentStage']) &&
      this.isNonNegativeFinite(obj['stageProgress']) &&
      Array.isArray(obj['unlockedStages']) &&
      obj['unlockedStages'].every((stage) => this.isPositiveInteger(stage)) &&
      this.isNonNegativeInteger(obj['kills']) &&
      this.isNonNegativeInteger(obj['maxKillStreak']) &&
      this.isNonNegativeFinite(obj['resinCurrency']) &&
      this.isNonNegativeFinite(obj['gameStartTime']) &&
      (obj['factionStandings'] === undefined || this.isFactionSnapshotArray(obj['factionStandings']))
    );
  }

  private isStringArray(value: unknown): boolean {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }

  private isCurseSnapshotArray(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.every((curse) => {
      if (!curse || typeof curse !== 'object') return false;
      const obj = curse as Record<string, unknown>;
      return (
        typeof obj['id'] === 'string' &&
        obj['id'].length > 0 &&
        typeof obj['name'] === 'string' &&
        typeof obj['description'] === 'string' &&
        (obj['hiddenEffect'] === undefined || typeof obj['hiddenEffect'] === 'string') &&
        (obj['severity'] === 'low' || obj['severity'] === 'medium' || obj['severity'] === 'high')
      );
    });
  }

  private isNonNegativeFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  }

  private isPositiveFinite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  private isNonNegativeInteger(value: unknown): value is number {
    return this.isNonNegativeFinite(value) && Number.isInteger(value);
  }

  private isPositiveInteger(value: unknown): value is number {
    return this.isPositiveFinite(value) && Number.isInteger(value);
  }

  private isUpgradeRecord(value: unknown): value is Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every((count) => this.isNonNegativeInteger(count));
  }
}
