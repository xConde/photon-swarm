/**
 * Photon Swarm Configuration - Public API
 *
 * This is the main entry point for all game constants and configurations.
 * Import from this file for the cleanest imports:
 *
 * @example
 * ```typescript
 * import { WORLD_CONFIG, PLAYER_CONFIG } from './config';
 * ```
 *
 * Or import from specific domains for better tree-shaking:
 *
 * @example
 * ```typescript
 * import { WORLD_CONFIG } from './config/constants/world';
 * ```
 */

// Re-export all constants from organized domains
export * from './constants/world';
export * from './constants/player';
export * from './constants/enemy';

// Re-export from game-constants.ts for backwards compatibility
export * from './game-constants';
export * from './beam-core.config';
export * from './beam-mutation.config';
export * from './upgrade-build-tags.config';
export * from './run-route.config';
export * from './run-relic.config';
export * from './run-anomaly.config';
export * from './hangar-module.config';
export * from './upgrade-catalog.config';
export * from './heat.config';
