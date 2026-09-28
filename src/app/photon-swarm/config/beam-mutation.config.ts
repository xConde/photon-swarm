import type { UpgradeOption } from '../core/models/upgrade.model';
import type { BeamCoreId, BeamCoreProfile, BeamMutationId, BuildTag } from '../core/models/run-build.model';
import { getBeamCoreProfile } from './beam-core.config';

interface BeamMutationTuning {
  readonly id: BeamMutationId;
  readonly coreId: BeamCoreId;
  readonly damageMultiplier?: number;
  readonly lengthMultiplier?: number;
  readonly widthMultiplier?: number;
  readonly rotationMultiplier?: number;
  readonly angleOffsets?: readonly number[];
  readonly rayOverlapDamageBonus?: number;
  readonly chainTargetsBonus?: number;
  readonly chainRangeMultiplier?: number;
  readonly chainDamageMultiplier?: number;
}

const TIGHT_TRIDENT_OFFSETS = Object.freeze([-0.055, 0, 0.055]);
const FIVE_RAY_OFFSETS = Object.freeze([-0.36, -0.18, 0, 0.18, 0.36]);
const SEVEN_RAY_OFFSETS = Object.freeze([-0.48, -0.32, -0.16, 0, 0.16, 0.32, 0.48]);
const CONVERGED_PRISM_OFFSETS = Object.freeze([-0.105, 0, 0.105]);

export const BEAM_MUTATION_TUNINGS: Readonly<Record<BeamMutationId, BeamMutationTuning>> = {
  lance_needlepoint: {
    id: 'lance_needlepoint',
    coreId: 'lance',
    damageMultiplier: 1.18,
    lengthMultiplier: 1.2,
    widthMultiplier: 0.74,
    rotationMultiplier: 0.9,
  },
  lance_hunters_pivot: {
    id: 'lance_hunters_pivot',
    coreId: 'lance',
    widthMultiplier: 1.45,
    rotationMultiplier: 1.48,
  },
  lance_sunpiercer: {
    id: 'lance_sunpiercer',
    coreId: 'lance',
    damageMultiplier: 1.42,
    lengthMultiplier: 1.3,
    widthMultiplier: 0.72,
    rotationMultiplier: 0.82,
  },
  lance_pursuit_array: {
    id: 'lance_pursuit_array',
    coreId: 'lance',
    damageMultiplier: 0.7,
    angleOffsets: TIGHT_TRIDENT_OFFSETS,
  },
  prism_thermal_bloom: {
    id: 'prism_thermal_bloom',
    coreId: 'prism',
    damageMultiplier: 0.78,
    angleOffsets: FIVE_RAY_OFFSETS,
  },
  prism_convergence: {
    id: 'prism_convergence',
    coreId: 'prism',
    damageMultiplier: 1.32,
    lengthMultiplier: 1.12,
    angleOffsets: CONVERGED_PRISM_OFFSETS,
    rayOverlapDamageBonus: 0.35,
  },
  prism_corona_engine: {
    id: 'prism_corona_engine',
    coreId: 'prism',
    damageMultiplier: 0.7,
    angleOffsets: SEVEN_RAY_OFFSETS,
  },
  prism_harmonic_bore: {
    id: 'prism_harmonic_bore',
    coreId: 'prism',
    damageMultiplier: 1.38,
    lengthMultiplier: 1.18,
    widthMultiplier: 0.78,
    rayOverlapDamageBonus: 0.55,
  },
  arc_relay_web: {
    id: 'arc_relay_web',
    coreId: 'arc',
    chainTargetsBonus: 2,
    chainRangeMultiplier: 1.25,
    chainDamageMultiplier: 1.08,
  },
  arc_storm_anchor: {
    id: 'arc_storm_anchor',
    coreId: 'arc',
    damageMultiplier: 1.18,
    widthMultiplier: 1.22,
    chainDamageMultiplier: 1.42,
    chainRangeMultiplier: 0.82,
  },
  arc_ion_tempest: {
    id: 'arc_ion_tempest',
    coreId: 'arc',
    chainTargetsBonus: 3,
    chainRangeMultiplier: 1.35,
    chainDamageMultiplier: 1.2,
  },
  arc_return_stroke: {
    id: 'arc_return_stroke',
    coreId: 'arc',
    damageMultiplier: 1.24,
    widthMultiplier: 1.28,
    chainDamageMultiplier: 1.55,
  },
};

interface MutationCardDefinition {
  readonly id: BeamMutationId;
  readonly name: string;
  readonly description: string;
  readonly signature: string;
  readonly tradeoff: string;
  readonly coreId: BeamCoreId;
  readonly rarity: 'uncommon' | 'rare' | 'epic' | 'legendary';
  readonly branch: string;
  readonly requiresAll: readonly string[];
  readonly requiresTags?: readonly BuildTag[];
  readonly buildTags: readonly BuildTag[];
}

const MUTATION_CARDS: readonly MutationCardDefinition[] = [
  {
    id: 'lance_needlepoint',
    name: 'Needlepoint Rails',
    description: 'Draw the Lance into a thinner, longer line with eighteen percent more output.',
    signature: 'Extreme reach and precision',
    tradeoff: 'Turns even more deliberately',
    coreId: 'lance',
    rarity: 'uncommon',
    branch: 'lance-form',
    requiresAll: ['beam_core_lance'],
    buildTags: ['beam', 'kinetic'],
  },
  {
    id: 'lance_hunters_pivot',
    name: "Hunter's Pivot",
    description: 'Mount the Lance on a fast gimbal, widening its cut and recovering its tracking speed.',
    signature: 'Responsive heavy beam',
    tradeoff: 'Forfeits Needlepoint range',
    coreId: 'lance',
    rarity: 'uncommon',
    branch: 'lance-form',
    requiresAll: ['beam_core_lance'],
    buildTags: ['beam', 'mobility'],
  },
  {
    id: 'lance_sunpiercer',
    name: 'Sunpiercer',
    description: 'Feed thermal pressure through Needlepoint rails for a devastating horizon-length cut.',
    signature: 'Maximum single-line damage',
    tradeoff: 'Narrow arc and slow correction',
    coreId: 'lance',
    rarity: 'legendary',
    branch: 'lance-apex',
    requiresAll: ['lance_needlepoint'],
    requiresTags: ['thermal'],
    buildTags: ['beam', 'kinetic', 'thermal'],
  },
  {
    id: 'lance_pursuit_array',
    name: 'Pursuit Array',
    description: 'Split the stabilized Lance into three tight cutting lines that track as one weapon.',
    signature: 'Tight three-line pursuit pattern',
    tradeoff: 'Reduced damage per line',
    coreId: 'lance',
    rarity: 'epic',
    branch: 'lance-apex',
    requiresAll: ['lance_hunters_pivot'],
    requiresTags: ['mobility'],
    buildTags: ['beam', 'kinetic', 'mobility'],
  },
  {
    id: 'prism_thermal_bloom',
    name: 'Thermal Bloom',
    description: 'Open the Prism into a five-ray fan and seed every ray with ignition potential.',
    signature: 'Five-ray area control',
    tradeoff: 'Lower damage per ray',
    coreId: 'prism',
    rarity: 'uncommon',
    branch: 'prism-form',
    requiresAll: ['beam_core_prism'],
    buildTags: ['beam', 'thermal'],
  },
  {
    id: 'prism_convergence',
    name: 'Convergence Lens',
    description: 'Collapse the Prism fan into a close three-line bore with higher focused output.',
    signature: 'Dense overlapping rays',
    tradeoff: 'Much narrower coverage',
    coreId: 'prism',
    rarity: 'uncommon',
    branch: 'prism-form',
    requiresAll: ['beam_core_prism'],
    buildTags: ['beam', 'kinetic'],
  },
  {
    id: 'prism_corona_engine',
    name: 'Corona Engine',
    description: 'Recycle captured shards through Thermal Bloom to unfold a seven-ray solar fan.',
    signature: 'Seven-ray screen control',
    tradeoff: 'Lowest damage per ray',
    coreId: 'prism',
    rarity: 'legendary',
    branch: 'prism-apex',
    requiresAll: ['prism_thermal_bloom'],
    requiresTags: ['shard'],
    buildTags: ['beam', 'thermal', 'shard'],
  },
  {
    id: 'prism_harmonic_bore',
    name: 'Harmonic Bore',
    description: 'Phase-lock the converged rays so their overlap chews through the same target.',
    signature: 'Focused triple-hit pressure',
    tradeoff: 'Smallest Prism firing arc',
    coreId: 'prism',
    rarity: 'epic',
    branch: 'prism-apex',
    requiresAll: ['prism_convergence'],
    requiresTags: ['kinetic'],
    buildTags: ['beam', 'kinetic'],
  },
  {
    id: 'arc_relay_web',
    name: 'Relay Web',
    description: 'Let each Arc search farther and carry the cascade through two additional hulls.',
    signature: 'Long multi-target cascades',
    tradeoff: 'Modest damage per jump',
    coreId: 'arc',
    rarity: 'uncommon',
    branch: 'arc-form',
    requiresAll: ['beam_core_arc'],
    buildTags: ['beam', 'discharge'],
  },
  {
    id: 'arc_storm_anchor',
    name: 'Storm Anchor',
    description: 'Compress the cascade into a shorter, heavier chain that punishes clustered enemies.',
    signature: 'High-damage close cascade',
    tradeoff: 'Reduced jump range',
    coreId: 'arc',
    rarity: 'uncommon',
    branch: 'arc-form',
    requiresAll: ['beam_core_arc'],
    buildTags: ['beam', 'discharge', 'kinetic'],
  },
  {
    id: 'arc_ion_tempest',
    name: 'Ion Tempest',
    description: 'Superheat the Relay Web until it hunts across entire enemy formations.',
    signature: 'Seven-target thermal cascade',
    tradeoff: 'Depends on enemy density',
    coreId: 'arc',
    rarity: 'legendary',
    branch: 'arc-apex',
    requiresAll: ['arc_relay_web'],
    requiresTags: ['thermal'],
    buildTags: ['beam', 'discharge', 'thermal'],
  },
  {
    id: 'arc_return_stroke',
    name: 'Return Stroke',
    description: 'Ground Storm Anchor through defensive systems, hardening every close-range jump.',
    signature: 'Brutal armored cascade',
    tradeoff: 'Short-range commitment',
    coreId: 'arc',
    rarity: 'epic',
    branch: 'arc-apex',
    requiresAll: ['arc_storm_anchor'],
    requiresTags: ['aegis'],
    buildTags: ['beam', 'discharge', 'aegis'],
  },
] as const;

export const BEAM_MUTATION_OPTIONS: readonly UpgradeOption[] = MUTATION_CARDS.map((card) => ({
  id: card.id,
  name: card.name,
  description: card.description,
  signature: card.signature,
  tradeoff: card.tradeoff,
  effect: (game) => game.evolveBeamCore(card.id),
  type: 'upgrade',
  rarity: card.rarity,
  category: 'mutation',
  compatibleCores: [card.coreId],
  exclusiveGroup: card.branch,
  requiresAll: [...card.requiresAll],
  ...(card.requiresTags ? { requiresTags: [...card.requiresTags] } : {}),
  buildTags: [...card.buildTags],
}));

/** Resolve once when a mutation changes; render/combat loops reuse the cached object. */
export function resolveMutatedBeamCoreProfile(
  coreId: BeamCoreId | null,
  mutationIds: readonly BeamMutationId[]
): BeamCoreProfile {
  const base = getBeamCoreProfile(coreId);
  if (coreId === null || mutationIds.length === 0) return base;

  let damageMultiplier = base.damageMultiplier;
  let lengthMultiplier = base.lengthMultiplier;
  let widthMultiplier = base.widthMultiplier;
  let rotationMultiplier = base.rotationMultiplier;
  let angleOffsets = base.angleOffsets;
  let rayOverlapDamageBonus = base.rayOverlapDamageBonus;
  let chainTargets = base.chainTargets;
  let chainRange = base.chainRange;
  let chainDamageMultiplier = base.chainDamageMultiplier;

  for (const mutationId of mutationIds) {
    const tuning = BEAM_MUTATION_TUNINGS[mutationId];
    if (tuning.coreId !== coreId) continue;
    damageMultiplier *= tuning.damageMultiplier ?? 1;
    lengthMultiplier *= tuning.lengthMultiplier ?? 1;
    widthMultiplier *= tuning.widthMultiplier ?? 1;
    rotationMultiplier *= tuning.rotationMultiplier ?? 1;
    angleOffsets = tuning.angleOffsets ?? angleOffsets;
    rayOverlapDamageBonus += tuning.rayOverlapDamageBonus ?? 0;
    chainTargets += tuning.chainTargetsBonus ?? 0;
    chainRange *= tuning.chainRangeMultiplier ?? 1;
    chainDamageMultiplier *= tuning.chainDamageMultiplier ?? 1;
  }

  return {
    ...base,
    damageMultiplier,
    lengthMultiplier,
    widthMultiplier,
    rotationMultiplier,
    angleOffsets,
    rayOverlapDamageBonus,
    chainTargets,
    chainRange,
    chainDamageMultiplier,
  };
}
