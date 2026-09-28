/**
 * Player Domain - Barrel Export
 *
 * Re-exports the unified PLAYER_CONFIG and all type definitions.
 * Individual configs (WEAPON_CONFIG, ABILITY_CONFIG, CHARGING_CONFIG) are kept
 * internal to avoid duplication - they're all accessible via PLAYER_CONFIG.
 */

// Export unified config
export { PLAYER_CONFIG } from './player.config';

// Export type definitions (regular export so they're available everywhere)
export { PlayerPhysics, SpawnProtection } from './player.config';
export { WeaponConfig, DischargeWeaponConfig, ChargedProjectileConfig } from './weapon.config';
export { AbilityConfig, FOCUS_FIRE_CONFIG } from './ability.config';
export {
  ChargingConfig,
  AnimationConfig,
  CooldownAccelerationConfig,
  DischargeChargingConfig,
} from './charging.config';
