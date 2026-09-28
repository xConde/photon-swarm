/**
 * Zone Enemy Composition Profiles
 *
 * Per-zone weight overrides for enemy type selection.
 * These sit between base weights (spawn.config.ts) and wave event overrides
 * in the priority stack:
 *
 *   wave event overrides > zone composition > base SPAWN_CONFIG weights
 *
 * Keys must match ZoneDefinition.enemyCompositionProfile values set in zone-config.service.ts.
 * Weights are relative — they replace the full set of base weights for that zone.
 */

export interface ZoneCompositionProfile {
  readonly weights: Partial<Record<string, number>>;
}

export const ZONE_COMPOSITION_PROFILES: Record<string, ZoneCompositionProfile> = {
  nebula_expanse: {
    // Standard mix — starting zone, emphasis on basic/swarm/spitter
    weights: { basic: 30, spitter: 20, swarm: 18, tank: 12, thug: 8, sniper: 6, disruptor: 4, sentinel: 2 },
  },
  asteroid_belt: {
    // Physical zone — heavy tank/thug, less ranged
    weights: { basic: 15, spitter: 10, swarm: 10, tank: 25, thug: 22, sniper: 5, disruptor: 8, sentinel: 5 },
  },
  void_rift: {
    // Range denial — disruptor/sniper heavy, fewer melee
    weights: { basic: 12, spitter: 18, swarm: 8, tank: 8, thug: 8, sniper: 20, disruptor: 18, sentinel: 8 },
  },
  deep_core: {
    // Hardest — sentinel/thug heavy, everything dangerous
    weights: { basic: 8, spitter: 12, swarm: 10, tank: 15, thug: 18, sniper: 10, disruptor: 12, sentinel: 15 },
  },
};
