import { EncounterFormation } from '../../../core/models/encounter.model';
import { EnemyType } from '../../../core/models/enemy.model';
import { ZoneId } from '../../../core/models/zone.model';

export interface EncounterArchetypeConfig {
  readonly id: string;
  readonly title: string;
  readonly brief: string;
  readonly formation: EncounterFormation;
  readonly roster: readonly EnemyType[];
  readonly minWave: number;
  readonly zones?: readonly ZoneId[];
  readonly weight: number;
}

/**
 * Encounter-director tuning.
 *
 * The opening deliberately teaches one pressure source at a time. After that,
 * waves use authored role combinations instead of an undifferentiated weighted
 * bag. Ambient reinforcements only prevent an empty arena; they no longer keep
 * the world pinned at the enemy cap between waves.
 */
export const ENCOUNTER_DIRECTOR_CONFIG = {
  OPENING: {
    FIRST_WAVE_DELAY_MS: 6500,
    FIRST_WAVE_SPAWN_DURATION_MS: 6000,
    RECOVERY_AFTER_CLEAR_MS: 5000,
    FORCED_NORMAL_WAVES: 1,
    DAMAGE_MULTIPLIER: 0.4,
    INITIAL_ENEMIES: [EnemyType.Basic] as const,
    INITIAL_DISTANCES: [850] as const,
    FIRST_WAVE_ROSTER: [EnemyType.Basic] as const,
    REINFORCEMENT_MIN_WAVE: 1,
    REINFORCEMENT_ENEMY_FLOOR: 2,
    REINFORCEMENT_RATE_MS: 2200,
    REINFORCEMENT_RATE_VARIANCE: 0.15,
    OVERLAP_MIN_WAVE: 4,
  },
  EARLY_WAVE_SIZES: [3, 5, 7] as const,
  SCALING: {
    POST_EARLY_BASE_SIZE: 7,
    PLAYER_LEVEL_MULTIPLIER: 0.65,
    WAVES_PER_SIZE_STEP: 6,
    SWARM_SIZE_MULTIPLIER: 1.35,
    ELITE_SIZE_MULTIPLIER: 0.65,
    ELITE_MIN_SIZE: 4,
    ELITE_CHANCE: 0.55,
    INVASION_SIZE_MULTIPLIER: 1.55,
    INVASION_ELITE_CHANCE: 0.3,
    BLACKOUT_SIZE_MULTIPLIER: 1.2,
    BLACKOUT_ELITE_CHANCE: 0.35,
    SALVAGE_SIZE_MULTIPLIER: 0.7,
    SALVAGE_ELITE_CHANCE: 0.2,
    REPEATED_ARCHETYPE_WEIGHT_MULTIPLIER: 0.15,
  },
  FORMATION: {
    PINCER_ANGLE_STEP_RADIANS: 0.13,
    FRONT_ANGLE_STEP_RADIANS: 0.16,
    FLANK_ANGLE_STEP_RADIANS: 0.14,
  },
  PRESENTATION: {
    SALVAGE_FLASH_OPACITY: 0.25,
    SALVAGE_FLASH_DURATION_MS: 500,
  },
  RANDOM_EVENT: {
    MIN_WAVE: 6,
    MIN_WAVES_BETWEEN: 4,
    /** Uses the top end of the normal-wave roll so existing elite/swarm bands stay stable. */
    SALVAGE_HUNT_ROLL_MIN: 0.92,
  },
  OBJECTIVE_PROGRESS_EMIT_MS: 200,
  ARCHETYPES: [
    {
      id: 'scout_screen',
      title: 'Scout Screen',
      brief: 'Break the screen before the next formation arrives.',
      formation: 'front',
      roster: [EnemyType.Basic, EnemyType.Basic, EnemyType.Spitter],
      minWave: 1,
      weight: 5,
    },
    {
      id: 'hunt_pack',
      title: 'Hunt Pack',
      brief: 'Fast hulls close while spitters deny your escape lanes.',
      formation: 'pincer',
      roster: [EnemyType.Swarm, EnemyType.Basic, EnemyType.Spitter],
      minWave: 3,
      weight: 4,
    },
    {
      id: 'raiding_party',
      title: 'Raiding Party',
      brief: 'Glass cannons push behind a disposable screen.',
      formation: 'flank',
      roster: [EnemyType.Thug, EnemyType.Basic, EnemyType.Spitter],
      minWave: 8,
      weight: 3,
    },
    {
      id: 'breaker_line',
      title: 'Breaker Line',
      brief: 'Heavy hulls hold center while raiders collapse the sides.',
      formation: 'front',
      roster: [EnemyType.Tank, EnemyType.Thug, EnemyType.Spitter],
      minWave: 5,
      zones: [2, 4],
      weight: 5,
    },
    {
      id: 'crossfire',
      title: 'Crossfire',
      brief: 'Break one firing lane before the second can bracket you.',
      formation: 'pincer',
      roster: [EnemyType.Sniper, EnemyType.Spitter, EnemyType.Basic],
      minWave: 12,
      zones: [3, 4],
      weight: 5,
    },
    {
      id: 'null_field',
      title: 'Null Field',
      brief: 'Disruptors blunt your movement while the swarm closes.',
      formation: 'ring',
      roster: [EnemyType.Disruptor, EnemyType.Swarm, EnemyType.Spitter],
      minWave: 18,
      zones: [3, 4],
      weight: 4,
    },
    {
      id: 'royal_guard',
      title: 'Royal Guard',
      brief: 'Flank the sentinels or their line will keep repairing itself.',
      formation: 'front',
      roster: [EnemyType.Sentinel, EnemyType.Tank, EnemyType.Thug],
      minWave: 22,
      zones: [4],
      weight: 5,
    },
  ] as readonly EncounterArchetypeConfig[],
} as const;
