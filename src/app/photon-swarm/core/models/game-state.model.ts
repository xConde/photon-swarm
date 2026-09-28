import { RunBuildEntry } from './upgrade.model';

export interface GameState {
  health: number;
  maxHealth: number;
  xp: number;
  level: number;
  shards: number;
  kills?: number;
  // Extended runtime fields (optional)
  killStreak?: number;
  maxKillStreak?: number;
  currentClass?: CharacterClass;
  currentStage?: number;
  resinCurrency?: number;
  persistentUpgrades?: Record<string, number>;
  ascensionLevel?: number;
  runSeed?: string;
  currentRunEvents?: number;
  encounterHistory?: string[];
}

/**
 * Why a run ended. `death` is the only path with non-trivial history; the
 * `victory` branch was declared on GameOverEvent but unreachable until
 * Phase 8 of the depth campaign. `quit` is reserved for an explicit
 * save-and-quit / give-up flow.
 */
export type RunEndReason = 'death' | 'victory' | 'quit';

export interface GameStats {
  level: number;
  shards: number;
  time: number;
  health?: number;
  maxHealth?: number;
  kills?: number;
  killStreak?: number;
  maxKillStreak?: number;
  difficulty?: string;
  zonesVisited?: number[];
  cachesOpened?: number;
  guardiansSlain?: number;
  /** How the run ended. Defaults to 'death' when not provided. */
  endReason?: RunEndReason;
  /** Upgrade, blessing, and curse choices captured before run teardown. */
  runBuild?: ReadonlyArray<RunBuildEntry>;
  zoneStats?: ReadonlyArray<{
    zoneId: number;
    zoneName: string;
    themeColor: string;
    timeSpentMs: number;
    guardiansSlain: number;
    cachesOpened: number;
    isCompleted: boolean;
  }>;
}

export interface SavedGame {
  playerName: string;
  level: number;
  shards: number;
  xp: number;
  health: number;
  maxHealth: number;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type stubs needed for legacy references after data-model cleanup
// ─────────────────────────────────────────────────────────────────────────────

// Basic enumeration of playable classes; extend as needed
export type CharacterClass = string;

export interface ClassAbility {
  id: string;
  name: string;
  cooldown?: number;
  description?: string;
  execute?: (...args: unknown[]) => void;
}

export interface StageModifier {
  id: string;
  name: string;
  description?: string;
  effects?: Record<string, number | boolean>;
}

export interface SurvivalStats {
  survivalTime: number;
  phase: 'early' | 'mid' | 'late' | 'desperate';
}

// Extended runtime fields used by the HUD and engine state emission
export interface ExtendedGameState extends GameState {
  killStreak?: number;
  maxKillStreak?: number;
  currentClass?: CharacterClass;
  currentStage?: number;
  resinCurrency?: number;
  persistentUpgrades?: Record<string, number>;
  ascensionLevel?: number;
  runSeed?: string;
  currentRunEvents?: number;
  encounterHistory?: string[];
}

export interface GameOverEvent {
  reason: RunEndReason;
  finalState: GameState;
  stats: GameStats;
  timestamp: number;
}
