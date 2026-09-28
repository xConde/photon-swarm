import { GameEngineService } from '../engine/game-engine.service';

/**
 * Type for dynamic properties that can be added to GameEngineService.
 * Note: Most upgrade state is now stored in PlayerUpgradesService.
 * This is only used for world generation properties.
 */
export type DynamicGameEngineProperties = {
  // World generation
  currentWorldSeed?: string;
};

/**
 * Safe accessor for dynamic game engine properties
 */
export function getEngineProperty<K extends keyof DynamicGameEngineProperties>(
  engine: GameEngineService,
  key: K
): DynamicGameEngineProperties[K] {
  return (engine as unknown as DynamicGameEngineProperties)[key];
}
