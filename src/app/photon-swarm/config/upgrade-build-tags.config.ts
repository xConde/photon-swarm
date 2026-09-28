import type { BuildTag } from '../core/models/run-build.model';

/**
 * Tags bridge the original upgrade catalog into the run-identity system.
 * Keeping the taxonomy here avoids polluting UpgradeService with metadata and
 * lets new evolutions ask for a play style instead of one hard-coded card.
 */
export const UPGRADE_BUILD_TAGS: Readonly<Record<string, readonly BuildTag[]>> = {
  core_speed: ['mobility'],
  core_power: ['beam', 'kinetic'],
  core_shield: ['aegis'],
  core_magnet: ['shard'],
  health_regen: ['aegis'],
  fire_rate_boost: ['kinetic'],
  dash_efficiency: ['mobility'],
  kinetic_amplifier: ['kinetic'],
  emergency_protocols: ['aegis'],
  beam_damage: ['beam'],
  beam_rotation: ['beam', 'mobility'],
  beam_speed: ['beam', 'kinetic'],
  velocity_matrix: ['kinetic', 'mobility'],
  surgical_precision: ['kinetic'],
  double_beam: ['beam'],
  burn_chance: ['thermal'],
  burn_damage: ['thermal'],
  burn_spread: ['thermal'],
  glass_cannon: ['void', 'kinetic'],
  berserker_protocol: ['void', 'kinetic'],
  discharge: ['discharge'],
  void_beam: ['void'],
  shield_breaker: ['kinetic'],
  cataclysm_core: ['discharge', 'thermal'],
  pyriphlegethon: ['thermal'],
  aegis_prime: ['aegis'],
  mach_reactor: ['kinetic', 'mobility'],
  beam_singularity: ['beam', 'void'],
  starforge_nova: ['beam', 'thermal'],
  astral_aegis: ['aegis'],
  quickening: ['mobility'],
  magnetars_touch: ['shard'],
  verdant_ward: ['aegis'],
  solar_flare: ['thermal', 'beam'],
};

export function getConfiguredBuildTags(upgradeId: string): readonly BuildTag[] {
  return UPGRADE_BUILD_TAGS[upgradeId] ?? [];
}
