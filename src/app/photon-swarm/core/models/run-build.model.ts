export type BeamCoreId = 'lance' | 'prism' | 'arc';
export type RunRouteZoneId = 2 | 3;

export type BeamMutationId =
  | 'lance_needlepoint'
  | 'lance_hunters_pivot'
  | 'lance_sunpiercer'
  | 'lance_pursuit_array'
  | 'prism_thermal_bloom'
  | 'prism_convergence'
  | 'prism_corona_engine'
  | 'prism_harmonic_bore'
  | 'arc_relay_web'
  | 'arc_storm_anchor'
  | 'arc_ion_tempest'
  | 'arc_return_stroke';

export type BuildTag = 'beam' | 'kinetic' | 'thermal' | 'void' | 'aegis' | 'mobility' | 'shard' | 'discharge';

export interface BeamCoreProfile {
  readonly id: BeamCoreId;
  readonly name: string;
  readonly designation: string;
  readonly description: string;
  readonly signature: string;
  readonly tradeoff: string;
  readonly tags: readonly BuildTag[];
  readonly damageMultiplier: number;
  readonly lengthMultiplier: number;
  readonly widthMultiplier: number;
  readonly rotationMultiplier: number;
  readonly angleOffsets: readonly number[];
  readonly rayOverlapDamageBonus: number;
  readonly chainTargets: number;
  readonly chainRange: number;
  readonly chainDamageMultiplier: number;
}

export interface RunBuildTransactionSnapshot {
  readonly beamCoreId: BeamCoreId | null;
  readonly beamMutationIds: readonly BeamMutationId[];
}

export interface RunRouteTransactionSnapshot {
  readonly selectedZoneId: RunRouteZoneId | null;
}

/** Multipliers owned by irreversible sector anomalies for the current run. */
export interface RunPressureModifiers {
  enemyHealth: number;
  enemyDamage: number;
  enemySpeed: number;
  spawnTempo: number;
  waveSize: number;
  eliteFrequency: number;
}

export type RunPressureChange = Partial<RunPressureModifiers>;

export interface RunPressureTransactionSnapshot {
  readonly modifiers: RunPressureModifiers;
}
