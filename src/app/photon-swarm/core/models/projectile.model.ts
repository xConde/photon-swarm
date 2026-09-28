export interface TrailData {
  points: Array<{ x: number; y: number; timestamp: number }>;
  opacity: number;
  color: string;
  width: number;
}

import { ProjectileId, ShardId } from './common.model';

// Base projectile data
export interface ProjectileBase {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  speed: number;
  color: string;
  lifetime: number;
  spawnTime: number;
  health: number;
  hitTime?: number;
  id?: ProjectileId;
}

// Enhanced charged projectile properties
export interface ChargedProjectileData {
  isCharged?: boolean;
  chargeLevel?: number;
  glowIntensity?: number;
  shouldEmitTrail?: boolean;
  trailData?: TrailData;
}

export interface Projectile extends ProjectileBase, ChargedProjectileData {}

export const enum ShardType {
  Normal = 'normal',
  Special = 'special',
  Boss = 'boss',
  Event = 'event',
}

export interface ShardBase {
  id?: ShardId;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  radius: number;
  spawnTime?: number;
  value?: number;
  color?: string;
  glowPhase?: number;
}

export interface Shard extends ShardBase {
  type?: ShardType;
  metadata?: ShardMetadata;
  isBeingAttracted?: boolean;
  attractionDistance?: number;
}

export interface ShardMetadata {
  source?: string;
  multiplier?: number;
  effectDuration?: number;
  specialProperties?: Record<string, unknown>;
}
