import { ArmorTier, CombatStats, CombatStyle } from '../combat/damage-calculation.service';
import { Enemy } from './enemy.model';

// === EQUIPMENT TYPES ===
export type EquipmentSlot = 'weapon' | 'armor' | 'shield' | 'accessory' | 'core';
export type WeaponType = 'beam_cannon' | 'plasma_rifle' | 'void_launcher' | 'nova_projector' | 'photon_array';
export type EquipmentRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'divine';

// === CORE EQUIPMENT INTERFACE ===
export interface Equipment {
  id: string;
  name: string;
  description: string;
  slot: EquipmentSlot;
  rarity: EquipmentRarity;
  level: number;
  maxLevel: number;

  // Visual properties
  icon?: string;
  color?: string;
  glowEffect?: boolean;

  // OSRS-style combat stats
  combatStats: Partial<CombatStats>;

  // Equipment-specific properties
  weaponType?: WeaponType;
  armorTier?: ArmorTier;

  // Special abilities and effects
  passiveEffects: PassiveEffect[];
  activeAbility?: ActiveAbility;

  // Acquisition and upgrade info
  source: EquipmentSource;
  upgradeCost: UpgradeCost[];

  // Requirements
  requirements?: EquipmentRequirement[];
}

// === PASSIVE EFFECTS ===
export interface PassiveEffect {
  id: string;
  name: string;
  description: string;
  type: PassiveEffectType;
  value: number;
  trigger?: EffectTrigger;
  cooldown?: number;
  chance?: number; // For chance-based effects
}

export type PassiveEffectType =
  | 'stat_bonus'
  | 'damage_bonus'
  | 'resist_bonus'
  | 'special_trigger'
  | 'on_hit_effect'
  | 'on_kill_effect'
  | 'defensive_effect';

export type EffectTrigger = 'on_hit' | 'on_kill' | 'on_crit' | 'on_dodge' | 'when_low_health' | 'continuous';

// === ACTIVE ABILITIES ===
export interface ActiveAbility {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  energyCost?: number;
  charges?: number;
  effect: (context: CombatContext) => AbilityResult;
}

export interface CombatContext {
  playerStats: CombatStats;
  nearbyEnemies: Enemy[]; // Enemy array
  currentHealth: number;
  maxHealth: number;
  position: { x: number; y: number };
}

export interface AbilityResult {
  damage?: number;
  healing?: number;
  statusEffects?: StatusEffect[];
  visualEffects?: VisualEffect[];
  soundEffect?: string;
}

export interface StatusEffect {
  type: 'burn' | 'slow' | 'stun' | 'shield' | 'boost';
  duration: number;
  strength: number;
}

export interface VisualEffect {
  type: 'explosion' | 'beam' | 'aura' | 'particles';
  position: { x: number; y: number };
  radius?: number;
  color?: string;
  duration?: number;
}

// === EQUIPMENT SOURCES ===
export type EquipmentSource =
  | 'boss_drop'
  | 'shop_purchase'
  | 'upgrade_choice'
  | 'territory_reward'
  | 'achievement_unlock'
  | 'craft_combine';

export interface UpgradeCost {
  level: number;
  shardCost: number;
  materialsRequired?: CraftingMaterial[];
}

export interface CraftingMaterial {
  id: string;
  name: string;
  quantity: number;
}

export interface EquipmentRequirement {
  type: 'level' | 'stat' | 'achievement' | 'other_equipment';
  value: number | string;
  description: string;
}

// === EQUIPMENT SETS ===
export interface EquipmentSet {
  id: string;
  name: string;
  description: string;
  pieces: string[]; // Equipment IDs that belong to this set
  setBonuses: SetBonus[];
}

export interface SetBonus {
  piecesRequired: number;
  name: string;
  description: string;
  combatStats?: Partial<CombatStats>;
  passiveEffects?: PassiveEffect[];
  activeAbility?: ActiveAbility;
}

// === LOADOUT SYSTEM ===
export interface PlayerLoadout {
  id: string;
  name: string;
  equipment: Record<EquipmentSlot, Equipment | null>;
  totalStats: CombatStats;
  activeSets: EquipmentSet[];
  powerLevel: number; // Calculated equipment score
}

// === EQUIPMENT ENHANCEMENT ===
export interface EnhancementGem {
  id: string;
  name: string;
  type: EnhancementType;
  rarity: EquipmentRarity;
  statBonus: Partial<CombatStats>;
  specialEffect?: PassiveEffect;
}

export type EnhancementType = 'attack_gem' | 'defense_gem' | 'utility_gem' | 'mastery_gem';

// === WEAPON DEFINITIONS ===
export interface WeaponDefinition extends Equipment {
  slot: 'weapon';
  weaponType: WeaponType;
  baseDamage: number;
  baseAccuracy: number;
  attackSpeed: number;
  range: number;
  preferredCombatStyle: CombatStyle;
  specialMechanics?: WeaponMechanic[];
}

export interface WeaponMechanic {
  type: 'penetration' | 'spread' | 'homing' | 'chain' | 'explosive';
  value: number;
  description: string;
}

// === ARMOR DEFINITIONS ===
export interface ArmorDefinition extends Equipment {
  slot: 'armor';
  armorTier: ArmorTier;
  baseDefense: number;
  magicResistance: number;
  mobilityPenalty: number;
  specialProperties?: ArmorProperty[];
}

export interface ArmorProperty {
  type: 'adaptive' | 'reactive' | 'energy_shield' | 'stealth' | 'regeneration';
  value: number;
  description: string;
}

// === EQUIPMENT COMPARISON ===
export interface EquipmentComparison {
  current: Equipment | null;
  new: Equipment;
  statChanges: StatChange[];
  overallRating: 'upgrade' | 'downgrade' | 'sidegrade';
  recommendations: string[];
}

export interface StatChange {
  stat: keyof CombatStats;
  currentValue: number;
  newValue: number;
  change: number;
  isImprovement: boolean;
}

// === EQUIPMENT EVENTS ===
export interface EquipmentEvent {
  type: 'equipped' | 'unequipped' | 'upgraded' | 'enhanced' | 'broken';
  equipment: Equipment;
  timestamp: number;
  context?: Record<string, unknown>;
}

// === EQUIPMENT PRESET TEMPLATES ===
export interface EquipmentPreset {
  id: string;
  name: string;
  description: string;
  recommendedFor: string[];
  equipment: Partial<Record<EquipmentSlot, string>>; // Equipment IDs
  playstyle: PlaystyleType;
}

export type PlaystyleType = 'glass_cannon' | 'tank' | 'balanced' | 'support' | 'mobility' | 'crit_specialist';

// === DYNAMIC EQUIPMENT GENERATION ===
export interface EquipmentGenerator {
  generateRandomEquipment(slot: EquipmentSlot, level: number, rarity: EquipmentRarity, seed?: string): Equipment;

  generateBossReward(bossType: string, playerLevel: number, seed?: string): Equipment[];

  generateUpgradeChoices(currentEquipment: Equipment, count: number): Equipment[];
}

// === EQUIPMENT VALIDATION ===
export interface EquipmentValidator {
  validateLoadout(loadout: PlayerLoadout): ValidationResult;
  checkCompatibility(equipment1: Equipment, equipment2: Equipment): boolean;
  calculatePowerLevel(loadout: PlayerLoadout): number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}
