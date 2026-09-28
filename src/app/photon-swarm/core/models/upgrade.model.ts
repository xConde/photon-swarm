import type { GameEngineService } from '../engine/game-engine.service';
import type { BeamCoreId, BuildTag } from './run-build.model';

/* ---------------------------------------------------------------------- */
/*  Shared Types                                                          */
/* ---------------------------------------------------------------------- */
export type UpgradeType = 'upgrade' | 'curse' | 'blessing' | 'cosmetic';
export type UpgradeRarity = 'core' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'curse' | 'blessing';
export type CurseSeverity = 'low' | 'medium' | 'high';
export type UpgradeEffectPhase = 'acquire' | 'restore';
export type UpgradeCategory = 'beam-core' | 'mutation' | 'relic' | 'route' | 'standard' | 'anomaly';

/**
 * A single selectable power‑up card in the Upgrade modal.
 * `effect` receives the running engine, stack ordinal, and whether this is a
 * live acquisition or checkpoint reconstruction. Restore effects must not
 * repeat one-shot rewards such as instant healing.
 */
export interface UpgradeOption {
  id: string; // MUST be unique.
  name: string;
  description: string;
  effect: (game: GameEngineService, count: number, phase?: UpgradeEffectPhase) => void;
  type: UpgradeType;
  rarity: UpgradeRarity;
  icon?: string; // Phosphor icon name for Core tier (e.g., 'ph-lightning')
  hiddenEffect?: string; // Short flavour text shown AFTER pick.
  hiddenDescription?: string; // Optional tooltip.
  cost?: number; // (future shop use)
  severity?: CurseSeverity; // Only for type==='curse'.
  prerequisites?: string[]; // Require ANY of these IDs already owned.
  requiresAll?: string[]; // Every listed ID must already be owned.
  category?: UpgradeCategory;
  buildTags?: BuildTag[];
  requiresTags?: BuildTag[];
  compatibleCores?: BeamCoreId[];
  exclusiveGroup?: string;
  designation?: string;
  signature?: string;
  tradeoff?: string;
}

/** Immutable snapshot of one card in the completed run's build. */
export interface RunBuildEntry {
  id: string;
  name: string;
  type: UpgradeType;
  rarity: UpgradeRarity;
  stacks: number;
  severity?: CurseSeverity;
}

export interface ArtifactEffects {
  statModifiers?: Record<string, number>;
  onActivate?: () => void;
  onUpdate?: (deltaTime: number) => void;
}

export interface Artifact {
  id: string;
  name: string;
  description: string;
  effect?: (game: GameEngineService) => void;
  rarity?: UpgradeRarity;
  icon?: string;
  effects: ArtifactEffects;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface Trait {
  id: string;
  name: string;
  description: string;
  effect?: (game: GameEngineService) => void;
  unlocked?: boolean;
  [key: string]: unknown;
}
