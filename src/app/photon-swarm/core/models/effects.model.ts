// === CORE EFFECT TYPES ===

import { Color, Vector } from './common.model';

// Re-export for backward compatibility
export type Vector2D = Vector;
export { Color };

export interface EffectKeyframe<T> {
  time: number;
  value: T;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bounce' | 'elastic';
}

export interface AnimationProperty<T> {
  keyframes: EffectKeyframe<T>[];
  currentValue: T;
}

// === PARTICLE SYSTEM ===

export interface ParticleData {
  // Transform
  position: Vector2D;
  velocity: Vector2D;
  acceleration: Vector2D;

  // Visual
  size: number;
  rotation: number;
  color: Color;
  opacity: number;
  blendMode: BlendMode;
  glowIntensity: number;

  // Type and layer
  type: ParticleType;
  layer: number;

  // Lifecycle
  age: number;
  maxAge: number;
  isAlive: boolean;

  // Physics
  mass: number;
  drag: number;
  gravity: Vector2D;

  // Animation properties
  sizeOverTime?: AnimationProperty<number>;
  colorOverTime?: AnimationProperty<Color>;
  opacityOverTime?: AnimationProperty<number>;

  /**
   * PERF: Pre-built CSS color string (e.g. "rgba(255,0,0,1)").
   * Set at initializeParticle() time and updated only when the interpolated Color
   * value actually changes — avoids per-frame template-literal allocations.
   */
  cssColor: string;
  /**
   * PERF: Pre-built CSS color string for the outer glow halo (40% alpha).
   * Rebuilt in tandem with cssColor whenever the color changes.
   */
  cssColorGlow: string;
  /** Last Color snapshot used to build cssColor — used to detect change. */
  cssColorSnapshot: Color;

  // Metadata
  id: string;
  metadata?: Record<string, unknown>;
}

export enum ParticleType {
  // Basic shapes
  CIRCLE = 'circle',
  SQUARE = 'square',

  // Combat effects
  SHARD_PICKUP = 'shard_pickup',
  ENEMY_DEATH = 'enemy_death',
  PROJECTILE_IMPACT = 'projectile_impact',
  BEAM_HIT = 'beam_hit',
  DISCHARGE_BURST = 'discharge_burst',

  // Environmental
  SPARK = 'spark',
  SMOKE = 'smoke',
  GLOW = 'glow',
  TRAIL = 'trail',

  // UI effects
  DAMAGE_NUMBER = 'damage_number',
  LEVEL_UP = 'level_up',
  NOTIFICATION = 'notification',

  // Special
  CUSTOM = 'custom',
}

// === EFFECT EMITTERS ===

export interface EmitterConfig {
  // Emission
  emissionRate: number; // particles per second
  burstCount?: number; // particles per burst
  duration: number; // emitter lifetime (-1 for infinite)

  // Spawn properties
  spawnPosition: Vector2D;
  spawnRadius: number;
  spawnAngle: number;
  spawnAngleVariation: number;

  // Particle properties
  particleType: ParticleType;
  particleLifetime: number;
  particleLifetimeVariation: number;

  // Initial velocity
  initialSpeed: number;
  initialSpeedVariation: number;
  initialDirection: Vector2D;

  // Visual properties
  startSize: number;
  endSize: number;
  startColor: Color;
  endColor: Color;
  startOpacity: number;
  endOpacity: number;

  // Physics
  gravity: Vector2D;
  drag: number;

  // Rendering
  blendMode: BlendMode;
  layer: number;
  texture?: string;
}

export enum BlendMode {
  NORMAL = 'normal',
  ADDITIVE = 'additive',
  MULTIPLY = 'multiply',
  SCREEN = 'screen',
  OVERLAY = 'overlay',
}

// === EFFECT SYSTEM ===

export interface EffectInstance {
  id: string;
  type: EffectType;
  position: Vector2D;
  startTime: number;
  createdAt: number; // wall-clock ms for max lifetime enforcement
  duration: number;
  isActive: boolean;
  emitters: ParticleEmitter[];
  metadata?: Record<string, unknown>;
}

export enum EffectType {
  // Combat
  ENEMY_EXPLOSION = 'enemy_explosion',
  SHARD_COLLECTION = 'shard_collection',
  BEAM_IMPACT = 'beam_impact',
  DISCHARGE_WAVE = 'discharge_wave',
  CRITICAL_HIT = 'critical_hit',

  // Environmental
  ASTEROID_BREAK = 'asteroid_break',
  TERRITORY_CHANGE = 'territory_change',
  WARP_EFFECT = 'warp_effect',

  // UI
  LEVEL_UP_BURST = 'level_up_burst',
  DAMAGE_POPUP = 'damage_popup',
  HEAL_EFFECT = 'heal_effect',

  // Passive
  PLAYER_AURA = 'player_aura',
  SHIELD_GLOW = 'shield_glow',
  BEAM_TRAIL = 'beam_trail',

  // Special
  CUSTOM = 'custom',
}

// === EFFECT PRESETS ===

export interface EffectPreset {
  name: string;
  type: EffectType;
  emitterConfigs: EmitterConfig[];
  duration: number;
  description: string;
}

// === PARTICLE EMITTER ===

export interface ParticleEmitter {
  id: string;
  config: EmitterConfig;
  particles: ParticleData[];
  createdAt: number; // wall-clock ms for max lifetime enforcement
  lastEmissionTime: number;
  totalEmitted: number;
  isActive: boolean;
  position: Vector2D;
  parentEffect?: EffectInstance;
}

// === EFFECT MANAGER INTERFACES ===

export interface EffectSystemConfig {
  maxParticles: number;
  maxEmitters: number;
  maxEffects: number; // Add missing property
  poolSize: number;
  cullingDistance: number;
  updateFrequency: number;
  renderLayers: number;
  performanceMode: boolean; // Add missing property
}

export interface EffectPerformanceStats {
  activeParticles: number;
  activeEmitters: number;
  activeEffects: number;
  poolUtilization: number;
  renderTime: number;
  updateTime: number;
  memoryUsage: number;
}

// === EXISTING EFFECT MODELS (for compatibility) ===

export interface DischargeEffect {
  x: number;
  y: number;
  radius: number;
  startTime: number;
  duration: number;
  color: string;
  // Properties needed by discharge system
  currentRadius: number;
  maxRadius: number;
}

export interface PickupEffect {
  x: number;
  y: number;
  startTime: number;
  duration: number;
  value: number;
}

export interface DeathEffect {
  x: number;
  y: number;
  startTime: number;
  duration: number;
  particles: number;
}

// === UTILITY TYPES ===

export type EffectCallback = (effect: EffectInstance) => void;
export type ParticleUpdateFunction = (particle: ParticleData, deltaTime: number) => void;
export type EffectFactory = (
  type: EffectType,
  position: Vector2D,
  metadata?: Record<string, unknown>
) => EffectInstance;
