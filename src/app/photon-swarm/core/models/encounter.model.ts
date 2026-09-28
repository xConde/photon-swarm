import { EnemyType } from './enemy.model';

/** High-level wave categories surfaced to the HUD and audio/visual feedback. */
export type WaveType =
  | 'normal'
  | 'swarm'
  | 'elite'
  | 'boss'
  | 'boss_rush'
  | 'faction_invasion'
  | 'blackout'
  | 'guardian_surge'
  | 'salvage_hunt';

/** Authored spawn layouts. These shape an encounter without changing enemy AI. */
export type EncounterFormation = 'ring' | 'pincer' | 'front' | 'flank' | 'boundary';

export type EncounterObjectiveType = 'eliminate' | 'survive';

export interface EncounterReward {
  readonly shards: number;
  readonly xp: number;
}

/** Immutable plan produced once when a wave starts. */
export interface EncounterPlan {
  readonly waveNumber: number;
  readonly type: WaveType;
  readonly archetypeId: string;
  readonly title: string;
  readonly brief: string;
  readonly formation: EncounterFormation;
  readonly roster: readonly EnemyType[];
  readonly totalEnemies: number;
  readonly spawnDurationMs: number;
  readonly eliteChance: number;
  readonly championChance: number;
  readonly objective: EncounterObjectiveType;
  /** Zero means the objective has no deadline. */
  readonly timeLimitMs: number;
  readonly reward: EncounterReward;
  readonly invasionFactionId?: number;
  readonly factionName?: string;
}

export type EncounterStatus = 'active' | 'success' | 'failed';

/** Throttled, presentation-ready objective state. */
export interface EncounterProgress {
  readonly waveNumber: number;
  readonly type: WaveType;
  readonly title: string;
  readonly brief: string;
  readonly objective: EncounterObjectiveType;
  readonly current: number;
  readonly target: number;
  readonly remainingMs: number;
  readonly status: EncounterStatus;
  readonly reward: EncounterReward;
}

export interface EncounterResolution {
  readonly waveNumber: number;
  readonly type: WaveType;
  readonly title: string;
  readonly success: boolean;
  /** True only when this resolution actually committed its reward transaction. */
  readonly rewardGranted: boolean;
  readonly reward: EncounterReward;
}
