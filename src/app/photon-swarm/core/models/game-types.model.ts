/**
 * Consolidated game types to eliminate 'any' usage throughout the codebase
 * This file contains all the type definitions that were previously using 'any'
 */

// Timeout and interval types
export type TimeoutId = ReturnType<typeof setTimeout> | null;
export type IntervalId = ReturnType<typeof setInterval> | null;

// Event handler types
export interface GameStartEvent {
  timestamp: number;
  source?: 'user' | 'system' | 'restart';
}

// Performance API types
export interface PerformanceMemory {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

// Extend the Performance interface
export type ExtendedPerformance = Performance & PerformanceMemory;

// Import types for collision handlers
export type { Enemy, EnemyType } from './enemy.model';
export type { Projectile } from './projectile.model';
export type { GameState } from './game-state.model';

// Import EnemyType for the interface definitions below
import { EnemyType } from './enemy.model';

// Error handling types
export interface ErrorContext {
  [key: string]: unknown;
  system?: string;
  component?: string;
  entity?: number;
  entityId?: number;
  timestamp?: number;
  metadata?: Record<string, unknown>;
  renderContext?: string;
  canvasInfo?: CanvasInfo;
  systemName?: string;
  gameState?: Partial<GameState>;
  configType?: string;
}

// Canvas information type
export interface CanvasInfo {
  count: number;
  visible: number;
  sizes: string[];
  width?: number;
  height?: number;
  contextType?: string;
}

// Component constructor type
export type ComponentConstructor<T extends Component> = new (...args: unknown[]) => T;

// Import Component type for above
import { Component } from '../ecs/ecs.model';
import { GameState } from './game-state.model';

// Hover and interaction types
export const enum HoveredItemType {
  Enemy = 'enemy',
  Shard = 'shard',
  Asteroid = 'asteroid',
  ExplorationPoint = 'exploration-point',
}

export interface HoveredItem {
  x: number;
  y: number;
  type: HoveredItemType;
  id: string;
  data?: Record<string, unknown>;
}

// Enemy properties and traits
export interface EnemyProperties {
  radius: number;
  health: number;
  color: string;
  speed: number;
  shards: number;
  shardMultiplier?: number;
  baseDamage?: number;
  shotCooldown?: number;
  focusTime?: number;
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileDamage?: number;
  projectileColor?: string;
  projectileLifetime?: number;
  projectileHealth?: number;
  detectionRange?: number;
  burstCount?: number;
  burstDelay?: number;
  chargedShotChance?: number;
  chargedProjectileDamage?: number;
  chargedProjectileRadius?: number;
  chargedProjectileColor?: string;
  normalProjectileColor?: string;
  dashCooldown?: number;
  dashSpeed?: number;
  dashDuration?: number;
  dashTelegraphTime?: number;
  dashRange?: number;
  abilityRange?: number;
  abilityDamage?: number;
}

// Trait and artifact definitions
export interface TraitDefinition {
  id: string;
  name: string;
  description: string;
  cost: number;
  effects: TraitEffect[];
  prerequisites?: string[];
  maxLevel?: number;
}

export const enum TraitEffectType {
  Stat = 'stat',
  Ability = 'ability',
  Passive = 'passive',
}

export const enum Operation {
  Add = 'add',
  Multiply = 'multiply',
  Set = 'set',
}

export interface TraitEffect {
  type: TraitEffectType;
  target: string;
  value: number;
  operation: Operation;
}

// Event system types
export const enum GameEventType {
  Blessing = 'blessing',
  Curse = 'curse',
  Neutral = 'neutral',
}

export interface GameEvent {
  id: string;
  name: string;
  description: string;
  type: GameEventType;
  effects: EventEffect[];
  duration?: number;
  chance?: number;
}

export const enum EventEffectType {
  Health = 'health',
  Shards = 'shards',
  Damage = 'damage',
  Speed = 'speed',
  Spawn = 'spawn',
  Territory = 'territory',
}

export const enum EventTarget {
  Player = 'player',
  Enemies = 'enemies',
  World = 'world',
}

export interface EventEffect {
  type: EventEffectType;
  value: number;
  operation: Operation;
  target?: EventTarget;
}

// Projectile spawn properties
export interface ProjectileSpawnProps {
  speed: number;
  radius: number;
  damage: number;
  color: string;
  lifetime: number;
  health: number;
  isCharged?: boolean;
  spreadAngle?: number;
  burstCount?: number;
  burstDelay?: number;
}

// Stat modifier operations
export interface StatModifierOperation {
  op: 'add' | 'mul';
  target: keyof StatModifierTargets;
  value: number;
}

export interface StatModifierTargets {
  health: number;
  maxHealth: number;
  speed: number;
  damage: number;
  shards: number;
  burnChance: number;
  burnDamage: number;
  effectChance: number;
  criticalHitChance: number;
  beamBackfireChance: number;
  enemySpawnMultiplier: number;
  enemyDamageMultiplier: number;
  burnSpreadChance: number;
  healthRegenAmount: number;
  healthRegenInterval: number;
  magnetismRangeBonus: number;
  beamSpeedBonus: number;
  dashCooldownReduction: number;
  dashDistanceBonus: number;
  shardAutoCollectRange: number;
  recoilDamageMultiplier: number;
  burnDuration: number;
  damageReductionFactor: number;
  luckMultiplier: number;
  killStreak: number;
  maxKillStreak: number;
  traitTokens: number;
  resinCurrency: number;
  ascensionLevel: number;
  level: number;
  xp: number;
  survivalTime: number;
  currentStage: number;
  stageProgress: number;
  artifactSlots: number;
}

// Territory and world interaction types
export interface TerritoryInteraction {
  id: number;
  type: 'dance' | 'roam' | 'skirmish';
  participants: string[];
  startTime: number;
  duration: number;
  target?: { x: number; y: number };
}

export interface RoamTarget {
  x: number;
  y: number;
  nextChange: number;
}

// Character class and ability types
export interface ClassAbilityDefinition {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  duration?: number;
  effects: ClassAbilityEffect[];
  keyBinding?: string;
}

export interface ClassAbilityEffect {
  type: 'boost' | 'shield' | 'damage' | 'movement' | 'heal';
  value: number;
  target: 'self' | 'enemies' | 'area';
  radius?: number;
}

// Stage and progression types
export interface StageModifierDefinition {
  id: string;
  name: string;
  description: string;
  effects: StageEffect[];
  duration?: number;
  stackable?: boolean;
}

export interface StageEffect {
  type: 'enemy' | 'territory' | 'player' | 'world';
  modifier: string;
  value: number;
  operation: 'add' | 'multiply' | 'set';
}

// Survival and run types
export interface SurvivalPhase {
  phase: 'early' | 'mid' | 'late' | 'desperate';
  startTime: number;
  duration: number;
  modifiers: SurvivalModifier[];
}

export interface SurvivalModifier {
  type: 'spawn_rate' | 'enemy_health' | 'enemy_damage' | 'player_health' | 'shard_multiplier';
  value: number;
  operation: 'add' | 'multiply';
}

// Artifact and upgrade types
export interface ArtifactDefinition {
  id: string;
  name: string;
  description: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  effects: ArtifactEffect[];
  maxLevel?: number;
  pool?: string;
}

export interface ArtifactEffect {
  type: 'stat' | 'ability' | 'passive' | 'trigger';
  target: string;
  value: number;
  operation: 'add' | 'multiply' | 'set';
  condition?: string;
}

// Persistent upgrade types
export interface PersistentUpgradeDefinition {
  id: string;
  name: string;
  description: string;
  cost: number;
  maxLevel: number;
  effects: PersistentUpgradeEffect[];
  costScaling?: 'linear' | 'exponential' | 'flat';
}

export interface PersistentUpgradeEffect {
  type: 'stat' | 'ability' | 'passive';
  target: string;
  value: number;
  operation: 'add' | 'multiply' | 'set';
  scaling?: 'linear' | 'exponential';
}

// Legacy compatibility interfaces for game engine
export interface LegacyPlayer {
  getMaxHealth: () => number;
  increaseMaxHealth: (amount: number) => void;
  getHealthRegenRate: () => number;
  setHealthRegeneration: (rate: number) => void;
}

export interface LegacyEnemy {
  id?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  type: EnemyType;
  health: number;
  maxHealth: number;
}

export interface LegacyProjectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
}
