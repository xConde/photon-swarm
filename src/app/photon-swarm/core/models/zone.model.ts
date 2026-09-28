/**
 * Zone System Models
 *
 * Defines the static zone overlay for map progression.
 * Zones are fixed spatial regions independent of the dynamic Four Kings territory system.
 */

// =============================================================================
// CORE TYPES
// =============================================================================

/** Zone identifiers — 4 fixed zones */
export type ZoneId = 1 | 2 | 3 | 4;

/** Axis-aligned bounding rectangle in world space */
export interface ZoneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// =============================================================================
// ZONE DEFINITION (static config)
// =============================================================================

/** Static zone definition — immutable after config load */
export interface ZoneDefinition {
  readonly id: ZoneId;
  readonly name: string;
  readonly subtitle: string;
  readonly bounds: ZoneBounds;
  /** Multiplier applied to enemy health and damage spawned in this zone */
  readonly difficultyMultiplier: number;
  /** Key into ZoneCompositionProfile for enemy type weights */
  readonly enemyCompositionProfile: string;
  /** Which Four Kings faction visually dominates this zone */
  readonly primaryKingId: number;
  /** Primary zone color (hex) for UI, minimap, gates */
  readonly themeColor: string;
  /** Secondary color for treasure caches and accents */
  readonly accentColor: string;
}

// =============================================================================
// ZONE STATE (runtime)
// =============================================================================

/** Runtime state for a zone — tracks unlock and completion */
export interface ZoneState {
  readonly zoneId: ZoneId;
  isUnlocked: boolean;
  isCompleted: boolean;
  /** Timestamp when the player first entered this zone (0 = never) */
  firstEntryTime: number;
  /** Total time accumulated in this zone across all visits (ms) */
  timeSpentMs: number;
  /** Number of treasure caches opened in this zone */
  cachesOpened: number;
  /** Number of guardians killed in this zone */
  guardiansSlain: number;
}

// =============================================================================
// ZONE POI (point of interest)
// =============================================================================

export type POIType = 'treasure_cache' | 'guardian' | 'zone_gate';

/** Point of interest for minimap/map rendering */
export interface ZonePOI {
  readonly type: POIType;
  readonly x: number;
  readonly y: number;
  readonly zoneId: ZoneId;
  /** Entity ID in the ECS, if this POI maps to a live entity */
  readonly entityId: number | null;
  /** Visual state for rendering */
  readonly state: 'active' | 'inactive' | 'locked' | 'open';
}

// =============================================================================
// ZONE GATE
// =============================================================================

export type GateUnlockCondition = 'wave' | 'guardian_kill' | 'treasure_clear';

export interface ZoneGateDefinition {
  readonly gateId: number;
  readonly fromZoneId: ZoneId;
  readonly toZoneId: ZoneId;
  /** World-space position of the gate */
  readonly x: number;
  readonly y: number;
  readonly unlockCondition: GateUnlockCondition;
  /** Value to compare against (wave number, kill count, cache count) */
  readonly unlockValue: number;
}

// =============================================================================
// GUARDIAN
// =============================================================================

export interface GuardianDefinition {
  readonly guardianId: number;
  readonly zoneId: ZoneId;
  /** Home position — center of patrol area */
  readonly homeX: number;
  readonly homeY: number;
  /** Max distance from home before leashing back */
  readonly leashRadius: number;
  /** Distance at which guardian aggros on player */
  readonly aggroRadius: number;
  /** Base enemy type used for this guardian */
  readonly enemyType: string;
  /** Difficulty tier: 1 = normal, 2 = elite, 3 = boss-tier */
  readonly rankTier: 1 | 2 | 3;
  /** ID of the treasure cache this guardian protects */
  readonly guardedCacheId: number;
  /** Time in ms before guardian respawns after death */
  readonly respawnDelayMs: number;
  /** Multiplier on base enemy health */
  readonly healthMultiplier: number;
  /** Multiplier on base enemy damage */
  readonly damageMultiplier: number;
}

// =============================================================================
// TREASURE CACHE
// =============================================================================

export interface TreasureLootTable {
  readonly shardReward: { readonly min: number; readonly max: number };
  readonly xpBonus: number;
  /** Powerup type to drop, or null for no powerup */
  readonly powerupType: string | null;
}

export interface TreasureCacheDefinition {
  readonly cacheId: number;
  readonly zoneId: ZoneId;
  readonly x: number;
  readonly y: number;
  readonly lootTableKey: string;
  /** Guardian ID protecting this cache (0 = unguarded) */
  readonly guardianId: number;
}

// =============================================================================
// ZONE CHANGE EVENT
// =============================================================================

export interface ZoneChangeEvent {
  readonly from: ZoneId | null;
  readonly to: ZoneId | null;
}
