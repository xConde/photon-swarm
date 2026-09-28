import { EnemyType } from './enemy.model';
import { CurseSeverity } from './upgrade.model';

// Snapshot of an active curse for mid-run saves
export interface CurseSnapshot {
  id: string;
  name: string;
  description: string;
  hiddenEffect?: string;
  severity: CurseSeverity;
}

// Snapshot of a single enemy that is persisted between sessions
export interface EnemySnapshot {
  id: string;
  type: EnemyType;
  rarity?: 'common' | 'rare' | 'legendary';
  isElite?: boolean;
  isChampion?: boolean;
  factionId?: number;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  vx?: number;
  vy?: number;
  behaviorPattern?: string;
}

// Snapshot of player state
export interface PlayerSnapshot {
  name: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  shards: number;
  xp: number;
  level: number;
  ascensionLevel?: number;
  currentClass?: string;
  unlockedTraits?: string[];
  persistentUpgrades?: Record<string, number>; // Cosmetics, unlocks (always persist)
  currentRunUpgrades?: Record<string, number>; // Upgrades for this run only (cleared on death)
  currentRunCurses?: CurseSnapshot[]; // Active curses for this run (cleared on death)
}

// Faction standing snapshot
export interface FactionSnapshot {
  factionId: number;
  standing: number;
}

// Game progression and meta state
export interface GameMetaSnapshot {
  survivalTime: number;
  survivalPhase: string;
  currentStage: number;
  stageProgress: number;
  unlockedStages: number[];
  kills: number;
  maxKillStreak: number;
  resinCurrency: number;
  gameStartTime: number;
  factionStandings?: FactionSnapshot[]; // Optional for backwards compatibility
}

// Root payload persisted by SaveGameAdapter
export interface SaveGameData {
  version: number;
  seed: string;
  worldHash?: string; // Hash of the generated world for integrity checking
  timestamp: number;
  player: PlayerSnapshot;
  enemies: EnemySnapshot[];
  meta?: GameMetaSnapshot;
}

// Lightweight checkpoint saved on level-up, pause, and tab background
export interface RunCheckpoint {
  version: number;
  timestamp: number;
  health: number;
  maxHealth: number;
  level: number;
  xp: number;
  shards: number;
  kills: number;
  upgrades: Record<string, number>;
  timePlayed: number; // seconds elapsed so far
  playerName: string;
  /** Optional: serialized faction standings — absent in older checkpoints (backwards-compatible). */
  factionStandings?: FactionSnapshot[];
}
