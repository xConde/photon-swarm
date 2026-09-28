/**
 * Enemy Domain - Barrel Export
 *
 * Re-exports all enemy-related configurations and types.
 */

// Export configurations
export { ENEMY_STATS } from './enemy-stats.config';
export { ENEMY_UNLOCK_WAVES, SPAWN_CONFIG, WAVE_EVENTS } from './spawn.config';
export { ENCOUNTER_DIRECTOR_CONFIG, type EncounterArchetypeConfig } from './encounter.config';
export { AI_BEHAVIOR_CONFIG, ENEMY_SEPARATION_CONFIG, IDLE_BEHAVIOR_CONFIG } from './ai-behavior.config';

// Export type definitions
export { type EnemyStats, type EnemyStatsCollection } from './enemy-stats.config';
export {
  type SpawnTiming,
  type SpawnLimits,
  type ClusterConfig,
  type RarityConfig,
  type EnemyTypeWeights,
  type WaveEvent,
} from './spawn.config';
export { type AIBehaviorConfig, type EnemySeparationConfig, type IdleBehaviorConfig } from './ai-behavior.config';
export * from './zone-composition.config';
