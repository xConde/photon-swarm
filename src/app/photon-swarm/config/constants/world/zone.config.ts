/**
 * Zone Configuration
 *
 * Defines the 4 static zone regions overlaid on the 12,000x9,000 world.
 * Zones drive enemy composition, difficulty scaling, treasure placement,
 * and progression gating. They are independent of the dynamic Four Kings
 * territory system which continues as visual flavor underneath.
 *
 * Layout:
 *   Zone 1 (Nebula Expanse) occupies the top-left quadrant and is the
 *   largest zone — it contains the player spawn point at (6000, 4500).
 *   Zones 2-4 surround it at increasing difficulty.
 *
 *   ┌───────────────────┬──────────┐
 *   │                   │  Zone 2  │
 *   │      Zone 1       │ Asteroid │  y=0
 *   │  (Nebula Expanse) │   Belt   │
 *   │    spawn: ★       │          │
 *   ├───────────────────┼──────────┤  y=5500
 *   │     Zone 3        │  Zone 4  │
 *   │   (Void Rift)     │(Deep Core│
 *   └───────────────────┴──────────┘  y=9000
 *   x=0               x=7000    x=12000
 */
import { GuardianDefinition, ZoneDefinition, ZoneGateDefinition, ZoneId } from '../../../core/models/zone.model';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ZoneConfigType {
  /** All zone definitions indexed by ZoneId */
  readonly ZONES: readonly ZoneDefinition[];
  /** Default zone for the player at spawn (must contain (6000, 4500)) */
  readonly SPAWN_ZONE_ID: ZoneId;
}

// =============================================================================
// ZONE DEFINITIONS
// =============================================================================

// =============================================================================
// GUARDIAN DEFINITIONS
// =============================================================================

/**
 * One guardian per treasure cache (13 total).
 * Guardians are stationary elites that aggro on proximity and leash back home.
 */
export const GUARDIAN_DEFINITIONS: readonly GuardianDefinition[] = [
  // Zone 1 - Nebula Expanse (easiest guardians)
  {
    guardianId: 1,
    zoneId: 1,
    homeX: 2000,
    homeY: 1500,
    leashRadius: 600,
    aggroRadius: 350,
    enemyType: 'tank',
    rankTier: 1,
    guardedCacheId: 1,
    respawnDelayMs: 45000,
    healthMultiplier: 5.0,
    damageMultiplier: 2.5,
  },
  {
    guardianId: 2,
    zoneId: 1,
    homeX: 5000,
    homeY: 3500,
    leashRadius: 700,
    aggroRadius: 400,
    enemyType: 'thug',
    rankTier: 2,
    guardedCacheId: 2,
    respawnDelayMs: 60000,
    healthMultiplier: 5.5,
    damageMultiplier: 2.8,
  },
  {
    guardianId: 13,
    zoneId: 1,
    homeX: 3500,
    homeY: 4800,
    leashRadius: 750,
    aggroRadius: 400,
    enemyType: 'sentinel',
    rankTier: 2,
    guardedCacheId: 13,
    respawnDelayMs: 55000,
    healthMultiplier: 6.0,
    damageMultiplier: 3.0,
  },

  // Zone 2 - Asteroid Belt
  {
    guardianId: 3,
    zoneId: 2,
    homeX: 8500,
    homeY: 1200,
    leashRadius: 600,
    aggroRadius: 350,
    enemyType: 'tank',
    rankTier: 1,
    guardedCacheId: 3,
    respawnDelayMs: 50000,
    healthMultiplier: 6.0,
    damageMultiplier: 3.0,
  },
  {
    guardianId: 4,
    zoneId: 2,
    homeX: 10500,
    homeY: 3000,
    leashRadius: 700,
    aggroRadius: 400,
    enemyType: 'thug',
    rankTier: 2,
    guardedCacheId: 4,
    respawnDelayMs: 60000,
    healthMultiplier: 6.5,
    damageMultiplier: 3.2,
  },
  {
    guardianId: 5,
    zoneId: 2,
    homeX: 9000,
    homeY: 4500,
    leashRadius: 800,
    aggroRadius: 450,
    enemyType: 'sentinel',
    rankTier: 2,
    guardedCacheId: 5,
    respawnDelayMs: 75000,
    healthMultiplier: 7.0,
    damageMultiplier: 3.5,
  },

  // Zone 3 - Void Rift
  {
    guardianId: 6,
    zoneId: 3,
    homeX: 1500,
    homeY: 6500,
    leashRadius: 650,
    aggroRadius: 400,
    enemyType: 'sniper',
    rankTier: 2,
    guardedCacheId: 6,
    respawnDelayMs: 55000,
    healthMultiplier: 7.5,
    damageMultiplier: 3.5,
  },
  {
    guardianId: 7,
    zoneId: 3,
    homeX: 4000,
    homeY: 7500,
    leashRadius: 700,
    aggroRadius: 400,
    enemyType: 'disruptor',
    rankTier: 2,
    guardedCacheId: 7,
    respawnDelayMs: 65000,
    healthMultiplier: 8.0,
    damageMultiplier: 3.8,
  },
  {
    guardianId: 8,
    zoneId: 3,
    homeX: 5500,
    homeY: 8200,
    leashRadius: 800,
    aggroRadius: 450,
    enemyType: 'sniper',
    rankTier: 3,
    guardedCacheId: 8,
    respawnDelayMs: 90000,
    healthMultiplier: 8.5,
    damageMultiplier: 4.0,
  },

  // Zone 4 - Deep Core (hardest)
  {
    guardianId: 9,
    zoneId: 4,
    homeX: 8000,
    homeY: 6200,
    leashRadius: 700,
    aggroRadius: 450,
    enemyType: 'sentinel',
    rankTier: 2,
    guardedCacheId: 9,
    respawnDelayMs: 60000,
    healthMultiplier: 9.0,
    damageMultiplier: 4.0,
  },
  {
    guardianId: 10,
    zoneId: 4,
    homeX: 10000,
    homeY: 7000,
    leashRadius: 750,
    aggroRadius: 450,
    enemyType: 'thug',
    rankTier: 3,
    guardedCacheId: 10,
    respawnDelayMs: 75000,
    healthMultiplier: 9.5,
    damageMultiplier: 4.5,
  },
  {
    guardianId: 11,
    zoneId: 4,
    homeX: 11000,
    homeY: 8000,
    leashRadius: 800,
    aggroRadius: 500,
    enemyType: 'sentinel',
    rankTier: 3,
    guardedCacheId: 11,
    respawnDelayMs: 90000,
    healthMultiplier: 10.0,
    damageMultiplier: 5.0,
  },
  {
    guardianId: 12,
    zoneId: 4,
    homeX: 9500,
    homeY: 8500,
    leashRadius: 900,
    aggroRadius: 500,
    enemyType: 'tank',
    rankTier: 3,
    guardedCacheId: 12,
    respawnDelayMs: 120000,
    healthMultiplier: 12.0,
    damageMultiplier: 5.5,
  },
];

// =============================================================================
// ZONE GATE DEFINITIONS
// =============================================================================

/**
 * Gates are placed at zone boundaries. Each gate has an unlock condition that
 * must be satisfied before the player can pass through to the next zone.
 *
 * Gate layout mirrors the world boundary diagram above:
 *   Gate 1: Zone 1 → Zone 2  (x=7000 boundary, midway through shared y range)
 *   Gate 2: Zone 1 → Zone 3  (y=5500 boundary, midway through shared x range)
 *   Gate 3: Zone 2 → Zone 4  (y=5500 boundary in the right half)
 *   Gate 4: Zone 3 → Zone 4  (x=7000 boundary in the bottom half)
 */
export const ZONE_GATE_DEFINITIONS: readonly ZoneGateDefinition[] = [
  // Gate from Zone 1 → Zone 2 (at x=7000 boundary, midway through shared y range)
  { gateId: 1, fromZoneId: 1, toZoneId: 2, x: 7000, y: 2750, unlockCondition: 'treasure_clear', unlockValue: 2 },
  // Gate from Zone 1 → Zone 3 (at y=5500 boundary, midway through shared x range)
  { gateId: 2, fromZoneId: 1, toZoneId: 3, x: 3500, y: 5500, unlockCondition: 'wave', unlockValue: 8 },
  // Gate from Zone 2 → Zone 4 (at y=5500 boundary in the right half)
  { gateId: 3, fromZoneId: 2, toZoneId: 4, x: 9500, y: 5500, unlockCondition: 'guardian_kill', unlockValue: 3 },
  // Gate from Zone 3 → Zone 4 (at x=7000 boundary in the bottom half)
  { gateId: 4, fromZoneId: 3, toZoneId: 4, x: 7000, y: 7250, unlockCondition: 'treasure_clear', unlockValue: 2 },
];

// =============================================================================
// ZONE COMPLETION REWARDS
// =============================================================================

export interface ZoneCompletionReward {
  readonly shards: number;
  readonly xpBonus: number;
  readonly label: string;
}

export const ZONE_COMPLETION_REWARDS: Record<number, ZoneCompletionReward> = {
  1: { shards: 100, xpBonus: 500, label: '+100 Shards, +500 XP' },
  2: { shards: 200, xpBonus: 1000, label: '+200 Shards, +1000 XP' },
  3: { shards: 300, xpBonus: 1500, label: '+300 Shards, +1500 XP' },
  4: { shards: 500, xpBonus: 2500, label: '+500 Shards, +2500 XP' },
};

export const ZONE_CONFIG: ZoneConfigType = {
  SPAWN_ZONE_ID: 1,

  ZONES: [
    {
      id: 1,
      name: 'Nebula Expanse',
      subtitle: 'The calm before the storm',
      bounds: { x: 0, y: 0, width: 7000, height: 5500 },
      difficultyMultiplier: 1.0,
      enemyCompositionProfile: 'nebula_expanse',
      primaryKingId: 1, // Crimson
      themeColor: '#e74c3c',
      accentColor: '#ff6b6b',
    },
    {
      id: 2,
      name: 'Asteroid Belt',
      subtitle: 'Brace for impact',
      bounds: { x: 7000, y: 0, width: 5000, height: 5500 },
      difficultyMultiplier: 1.3,
      enemyCompositionProfile: 'asteroid_belt',
      primaryKingId: 2, // Azure
      themeColor: '#3498db',
      accentColor: '#74b9ff',
    },
    {
      id: 3,
      name: 'Void Rift',
      subtitle: 'Eyes in the dark',
      bounds: { x: 0, y: 5500, width: 7000, height: 3500 },
      difficultyMultiplier: 1.7,
      enemyCompositionProfile: 'void_rift',
      primaryKingId: 3, // Verdant
      themeColor: '#27ae60',
      accentColor: '#58d68d',
    },
    {
      id: 4,
      name: 'Deep Core',
      subtitle: 'Slay a boss here to complete the run',
      bounds: { x: 7000, y: 5500, width: 5000, height: 3500 },
      difficultyMultiplier: 2.2,
      enemyCompositionProfile: 'deep_core',
      primaryKingId: 4, // Shadow
      themeColor: '#8e44ad',
      accentColor: '#bb8fce',
    },
  ],
} as const;
