/**
 * Central export for all ECS components
 */

// Core components
export * from './position.component';
export * from './velocity.component';
export * from './acceleration.component';
export * from './health.component';
export * from './health-bar-display.component';
export * from './collision-box.component';
export * from './renderable.component';

// Entity type components
export * from './player-controlled.component';
export * from './ai-controlled.component';
export * from './enemy-type.component';
export * from './projectile.component';
export * from './shard.component';
export * from './asteroid.component';
export * from './falling-asteroid.component';
export * from './discharge-effect.component';

// Combat components
export * from './damage.component';
export * from './weapon.component';
export * from './beam.component';
export * from './discharge.component';
export * from './burn-effect.component';
export * from './buff.component';
export * from './ability.component';
export * from './invincibility.component';

// Special mechanics
export * from './spawner.component';
export * from './faction.component';
export * from './charging.component';
export * from './dual-charging.component';
export * from './charged-projectile.component';
export * from './source-tag.component';
export * from './knockback.component';
export * from './death-animation.component';
export * from './floating-text.component';
export * from './hit-flash.component';
export * from './powerup.component';

// Zone mechanics
export * from './zone-gate.component';
export * from './zone-treasure-cache.component';

// Boss mechanics
export * from './boss-phase.component';

// Disruptor mechanics
export * from './emp-pulse.component';

// Sentinel mechanics
export * from './shield-arc.component';
export * from './heal-aura.component';

// Swarm split mechanics
export * from './split-on-death.component';

// Minion mechanics
export * from './minion-tag.component';

// Teleport mechanics
export * from './teleport-effect.component';

// Arena hazard mechanics (boss shockwave telegraph)
export * from './arena-hazard.component';

// Territorial guardian mechanics
export { TerritorialGuardianComponent } from './territorial-guardian.component';

// UI components
export { AimingProjectionComponent } from '../core/systems/combat';
