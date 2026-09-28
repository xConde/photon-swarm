/**
 * Common interfaces used throughout the game
 * These provide type safety for frequently used object shapes
 */

// Branded types for type-safe IDs
export type EnemyId = number & { readonly __brand: unique symbol };
export type ProjectileId = number & { readonly __brand: unique symbol };
export type ShardId = number & { readonly __brand: unique symbol };
export type TerritoryId = number & { readonly __brand: unique symbol };

// Runtime conversion helpers used at ECS/rendering boundaries.
export const createEnemyId = (id: number): EnemyId => id as EnemyId;
export const createShardId = (id: number): ShardId => id as ShardId;

// Common coordinate interfaces
export interface Point {
  x: number;
  y: number;
}

/** A point used as a direction or velocity vector. */
export type Vector = Point;

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rectangle extends Point, Size {}

export interface Circle extends Point {
  radius: number;
}

// Color interfaces
export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface ColorString {
  value: string; // hex, rgb, rgba, etc.
}

// Timing interfaces
export interface Timing {
  startTime: number;
  duration: number;
  currentTime?: number;
}

export interface FrameTiming {
  frameTime: number;
  deltaTime: number;
  fps: number;
}

// Canvas render info
export interface CanvasRenderInfo {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  scale: number;
}

// Collision result
export interface CollisionResult {
  hasCollision: boolean;
  distance: number;
  normal?: Vector;
  penetration?: number;
}

// Input state
export interface InputState {
  mouseX: number;
  mouseY: number;
  mousePressed: boolean;
  keys: Record<string, boolean>;
}

// Range for numeric values
export interface Range {
  min: number;
  max: number;
}

// Weighted selection
export interface WeightedItem<T> {
  item: T;
  weight: number;
}

// Animation frame
export interface AnimationFrame {
  id: number;
  timestamp: number;
  active: boolean;
}

// Common rarity enum
export const enum Rarity {
  Common = 'common',
  Rare = 'rare',
  Epic = 'epic',
  Legendary = 'legendary',
}

// Common alert states
export const enum AlertState {
  Passive = 'passive',
  Suspicious = 'suspicious',
  Alert = 'alert',
  Aggressive = 'aggressive',
}

// Common directions
export const enum Direction {
  North = 'north',
  South = 'south',
  East = 'east',
  West = 'west',
  NorthEast = 'northeast',
  NorthWest = 'northwest',
  SouthEast = 'southeast',
  SouthWest = 'southwest',
}
