export type DifficultyMode = 'normal' | 'hard' | 'extreme';
export type HeatLevel = 0 | 1 | 2;

export interface DifficultyModifiers {
  readonly enemyHealthMultiplier: number;
  readonly enemyDamageMultiplier: number;
  readonly enemySpeedMultiplier: number;
  readonly shardMultiplier: number;
  readonly xpMultiplier: number;
  readonly spawnRateMultiplier: number;
}

export interface HeatDefinition {
  readonly mode: DifficultyMode;
  readonly heatLevel: HeatLevel;
  readonly requiredMastery: number;
  readonly modifiers: DifficultyModifiers;
}

export interface HeatOption {
  readonly mode: DifficultyMode;
  readonly label: string;
  readonly description: string;
}

const SECOND_REFIT_MASTERY_LEVEL = 2;

/** Single source of truth for Heat unlocks, combat pressure, rewards, and UI copy. */
export const HEAT_DEFINITIONS: Readonly<Record<DifficultyMode, HeatDefinition>> = Object.freeze({
  normal: Object.freeze({
    mode: 'normal',
    heatLevel: 0,
    requiredMastery: 0,
    modifiers: Object.freeze({
      enemyHealthMultiplier: 1,
      enemyDamageMultiplier: 1,
      enemySpeedMultiplier: 1,
      shardMultiplier: 1,
      xpMultiplier: 1,
      spawnRateMultiplier: 1,
    }),
  }),
  hard: Object.freeze({
    mode: 'hard',
    heatLevel: 1,
    requiredMastery: 1,
    modifiers: Object.freeze({
      enemyHealthMultiplier: 1.3,
      enemyDamageMultiplier: 1.3,
      enemySpeedMultiplier: 1.1,
      shardMultiplier: 1.25,
      xpMultiplier: 1.25,
      spawnRateMultiplier: 1.15,
    }),
  }),
  extreme: Object.freeze({
    mode: 'extreme',
    heatLevel: 2,
    requiredMastery: 3,
    modifiers: Object.freeze({
      enemyHealthMultiplier: 1.6,
      enemyDamageMultiplier: 1.6,
      enemySpeedMultiplier: 1.2,
      shardMultiplier: 1.55,
      xpMultiplier: 1.55,
      spawnRateMultiplier: 1.3,
    }),
  }),
});

export const HEAT_MODES: readonly DifficultyMode[] = Object.freeze(['normal', 'hard', 'extreme']);

export function isDifficultyMode(value: unknown): value is DifficultyMode {
  return value === 'normal' || value === 'hard' || value === 'extreme';
}

export function getHeatOptions(): readonly HeatOption[] {
  return HEAT_MODES.map((mode) => {
    const definition = HEAT_DEFINITIONS[mode];
    return {
      mode,
      label: `HEAT ${definition.heatLevel}`,
      description: getHeatDescription(definition),
    };
  });
}

export function getMaxHeatLevelForMastery(masteryLevel: number): HeatLevel {
  if (masteryLevel >= HEAT_DEFINITIONS.extreme.requiredMastery) return 2;
  if (masteryLevel >= HEAT_DEFINITIONS.hard.requiredMastery) return 1;
  return 0;
}

export function getRerollChargesForMastery(masteryLevel: number): number {
  return masteryLevel >= SECOND_REFIT_MASTERY_LEVEL ? 2 : 1;
}

export function getMasteryUnlockForLevel(level: number): string {
  const heatUnlock = HEAT_MODES.map((mode) => HEAT_DEFINITIONS[mode]).find(
    (definition) => definition.heatLevel > 0 && definition.requiredMastery === level
  );
  if (heatUnlock) {
    return `${getHeatLabel(heatUnlock)}: stronger opposition and +${getRewardPercent(heatUnlock)}% rewards`;
  }
  if (level === SECOND_REFIT_MASTERY_LEVEL) return 'Second refit reroll each run';
  return 'Mastery record';
}

function getHeatLabel(definition: HeatDefinition): string {
  return `Heat ${definition.heatLevel}`;
}

function getHeatDescription(definition: HeatDefinition): string {
  if (definition.heatLevel === 0) return 'Baseline pressure and rewards';
  const enemyStrength = Math.round((definition.modifiers.enemyHealthMultiplier - 1) * 100);
  return `+${enemyStrength}% enemy strength · +${getRewardPercent(definition)}% rewards`;
}

function getRewardPercent(definition: HeatDefinition): number {
  return Math.round((definition.modifiers.shardMultiplier - 1) * 100);
}
