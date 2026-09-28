import { TreasureCacheDefinition, TreasureLootTable } from '../../../core/models/zone.model';

export interface TreasureConfigType {
  readonly LOOT_TABLES: Record<string, TreasureLootTable>;
  readonly CACHE_DEFINITIONS: readonly TreasureCacheDefinition[];
}

export const TREASURE_CONFIG: TreasureConfigType = {
  LOOT_TABLES: {
    nebula_common: { shardReward: { min: 50, max: 100 }, xpBonus: 200, powerupType: null },
    nebula_rare: { shardReward: { min: 100, max: 200 }, xpBonus: 400, powerupType: 'speed' },
    nebula_elite: { shardReward: { min: 150, max: 250 }, xpBonus: 500, powerupType: 'health' },
    asteroid_common: { shardReward: { min: 80, max: 160 }, xpBonus: 350, powerupType: null },
    asteroid_rare: { shardReward: { min: 150, max: 300 }, xpBonus: 600, powerupType: 'damage_multiplier' },
    asteroid_elite: { shardReward: { min: 200, max: 400 }, xpBonus: 800, powerupType: 'health' },
    void_common: { shardReward: { min: 120, max: 240 }, xpBonus: 500, powerupType: null },
    void_rare: { shardReward: { min: 200, max: 400 }, xpBonus: 700, powerupType: 'speed' },
    void_elite: { shardReward: { min: 300, max: 500 }, xpBonus: 1000, powerupType: 'damage_multiplier' },
    core_common: { shardReward: { min: 200, max: 400 }, xpBonus: 800, powerupType: 'health' },
    core_rare: { shardReward: { min: 350, max: 600 }, xpBonus: 1200, powerupType: 'damage_multiplier' },
    core_elite: { shardReward: { min: 500, max: 800 }, xpBonus: 1500, powerupType: 'health' },
    core_legendary: { shardReward: { min: 700, max: 1000 }, xpBonus: 2000, powerupType: 'damage_multiplier' },
  },

  // 3 caches in Zone 1, 3 in Zone 2, 3 in Zone 3, 4 in Zone 4
  // Positions spread across each zone's bounds, with buffer from edges
  CACHE_DEFINITIONS: [
    // Zone 1 - Nebula Expanse (bounds: 0,0 → 7000,5500)
    { cacheId: 1, zoneId: 1, x: 2000, y: 1500, lootTableKey: 'nebula_common', guardianId: 1 },
    { cacheId: 2, zoneId: 1, x: 5000, y: 3500, lootTableKey: 'nebula_rare', guardianId: 2 },
    { cacheId: 13, zoneId: 1, x: 3500, y: 4800, lootTableKey: 'nebula_elite', guardianId: 13 },

    // Zone 2 - Asteroid Belt (bounds: 7000,0 → 12000,5500)
    { cacheId: 3, zoneId: 2, x: 8500, y: 1200, lootTableKey: 'asteroid_common', guardianId: 3 },
    { cacheId: 4, zoneId: 2, x: 10500, y: 3000, lootTableKey: 'asteroid_rare', guardianId: 4 },
    { cacheId: 5, zoneId: 2, x: 9000, y: 4500, lootTableKey: 'asteroid_elite', guardianId: 5 },

    // Zone 3 - Void Rift (bounds: 0,5500 → 7000,9000)
    { cacheId: 6, zoneId: 3, x: 1500, y: 6500, lootTableKey: 'void_common', guardianId: 6 },
    { cacheId: 7, zoneId: 3, x: 4000, y: 7500, lootTableKey: 'void_rare', guardianId: 7 },
    { cacheId: 8, zoneId: 3, x: 5500, y: 8200, lootTableKey: 'void_elite', guardianId: 8 },

    // Zone 4 - Deep Core (bounds: 7000,5500 → 12000,9000)
    { cacheId: 9, zoneId: 4, x: 8000, y: 6200, lootTableKey: 'core_common', guardianId: 9 },
    { cacheId: 10, zoneId: 4, x: 10000, y: 7000, lootTableKey: 'core_rare', guardianId: 10 },
    { cacheId: 11, zoneId: 4, x: 11000, y: 8000, lootTableKey: 'core_elite', guardianId: 11 },
    { cacheId: 12, zoneId: 4, x: 9500, y: 8500, lootTableKey: 'core_legendary', guardianId: 12 },
  ],
} as const;
