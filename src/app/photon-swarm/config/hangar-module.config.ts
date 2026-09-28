export type HangarModuleId =
  | 'max_health'
  | 'faster_reload'
  | 'speed_boost'
  | 'magnetism_range'
  | 'discharge_radius'
  | 'beam_width'
  | 'health_regen'
  | 'critical_hits'
  | 'double_points'
  | 'shield_generator';

export type HangarModuleRole = 'survival' | 'mobility' | 'weapon' | 'economy';

export interface HangarModuleDefinition {
  readonly id: HangarModuleId;
  readonly name: string;
  readonly role: HangarModuleRole;
  readonly description: string;
  readonly effectLabel: string;
  readonly cost: number;
}

/**
 * Permanent progression unlocks these modules, but a deployment can mount only
 * one. This preserves long-term collection without letting meta progression
 * flatten the choices made inside a run.
 */
export const HANGAR_MODULES: readonly HangarModuleDefinition[] = [
  {
    id: 'max_health',
    name: 'Aegis Plating',
    role: 'survival',
    description: 'A compact layer of sacrificial hull plating.',
    effectLabel: '+20 maximum hull',
    cost: 200,
  },
  {
    id: 'faster_reload',
    name: 'Discharge Accelerator',
    role: 'weapon',
    description: 'A dedicated feed for the ship-mounted nova system.',
    effectLabel: '15% faster nova recharge',
    cost: 275,
  },
  {
    id: 'speed_boost',
    name: 'Vector Thrusters',
    role: 'mobility',
    description: 'Overclocked lateral thrusters for tighter positioning.',
    effectLabel: '+12% movement speed',
    cost: 225,
  },
  {
    id: 'magnetism_range',
    name: 'Gravimetric Scoop',
    role: 'economy',
    description: 'A collection array tuned to loose photon shards.',
    effectLabel: 'Unlock magnetism · +60 range',
    cost: 300,
  },
  {
    id: 'discharge_radius',
    name: 'Nova Baffles',
    role: 'weapon',
    description: 'Reinforced emitters widen the defensive discharge.',
    effectLabel: '+30% nova radius',
    cost: 450,
  },
  {
    id: 'beam_width',
    name: 'Broadband Lens',
    role: 'weapon',
    description: 'Trades beam focus for a more forgiving contact line.',
    effectLabel: '+20% beam width',
    cost: 375,
  },
  {
    id: 'health_regen',
    name: 'Nanite Cradle',
    role: 'survival',
    description: 'Slow autonomous repairs between dangerous exchanges.',
    effectLabel: 'Repair 8 hull per second',
    cost: 600,
  },
  {
    id: 'critical_hits',
    name: 'Overcharge Relay',
    role: 'weapon',
    description: 'Occasionally routes a volatile pulse through the beam.',
    effectLabel: '15% chance to deal double damage',
    cost: 900,
  },
  {
    id: 'double_points',
    name: 'Shard Condenser',
    role: 'economy',
    description: 'Compacts unstable shard fragments during retrieval.',
    effectLabel: 'Double collected shard value',
    cost: 550,
  },
  {
    id: 'shield_generator',
    name: 'Emergency Barrier',
    role: 'survival',
    description: 'A single-use barrier that rebuilds itself after impact.',
    effectLabel: 'Absorb one hit · 30s recharge',
    cost: 400,
  },
] as const;

export const HANGAR_STORAGE_KEYS = {
  loadout: 'photon-swarm-hangar-loadout',
  unlocks: 'photon-swarm-upgrades',
  active: 'photon-swarm-active-module',
} as const;

/** Runtime tuning kept beside the module copy to prevent UI/effect drift. */
export const HANGAR_MODULE_TUNING = {
  maxHealth: 20,
  novaRechargeReduction: 0.15,
  movementSpeed: 0.12,
  magnetRange: 60,
  dischargeRadius: 0.3,
  beamWidth: 0.2,
  healthRegenPerSecond: 8,
  criticalHitChance: 0.15,
  criticalHitMultiplier: 2,
  shardMultiplier: 2,
  barrierLevel: 1,
} as const;

export function isHangarModuleId(value: unknown): value is HangarModuleId {
  return typeof value === 'string' && HANGAR_MODULES.some((module) => module.id === value);
}
