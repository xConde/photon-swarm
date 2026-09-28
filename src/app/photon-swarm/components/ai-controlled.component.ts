import { Component } from '../core/ecs/ecs.model';
import { Vector } from '../core/models/common.model';

export const enum BehaviorPattern {
  Idle = 'idle',
  Direct = 'direct',
  Flank = 'flank',
  Orbit = 'orbit',
  Retreat = 'retreat',
  Wander = 'wander',
  Grouping = 'grouping',
  Ranged = 'ranged',
  Sniper = 'sniper',
  Charger = 'charger',
  Swarm = 'swarm',
  Aggressive = 'aggressive',
  Boss = 'boss',
  Disruptor = 'disruptor',
  Sentinel = 'sentinel',
  TerritorialGuardian = 'territorial_guardian',
}

// Discriminated union for different behavior types
export interface BaseBehavior {
  pattern: BehaviorPattern;
  detectionRange: number;
  targetEntityId?: number;
}

export interface IdleBehavior extends BaseBehavior {
  pattern: BehaviorPattern.Idle;
  idleDuration?: number;
}

export interface DirectBehavior extends BaseBehavior {
  pattern: BehaviorPattern.Direct;
  aggressionLevel?: number;
}

export interface FlankBehavior extends BaseBehavior {
  pattern: BehaviorPattern.Flank;
  flankRadius?: number;
}

export interface OrbitBehavior extends BaseBehavior {
  pattern: BehaviorPattern.Orbit;
  orbitRadius?: number;
  orbitSpeed?: number;
}

export interface WanderBehavior extends BaseBehavior {
  pattern: BehaviorPattern.Wander;
  wanderDirection?: Vector;
  wanderSpeed?: number;
}

export interface RangedBehavior extends BaseBehavior {
  pattern: BehaviorPattern.Ranged;
  preferredDistance?: number;
  retreatDistance?: number;
}

export type BehaviorUnion =
  | IdleBehavior
  | DirectBehavior
  | FlankBehavior
  | OrbitBehavior
  | WanderBehavior
  | RangedBehavior;

/**
 * AIControlled component - marks entity as AI-controlled with behavior
 */
export class AIControlledComponent implements Component {
  public behaviorPattern: BehaviorPattern;
  public originalBehaviorPattern: BehaviorPattern; // Stores the assigned behavior to restore after wandering
  public targetEntityId?: number;
  public detectionRange: number;
  public wanderDirection?: Vector;
  public lastMovementChange: number;
  public movementSeed: number;

  // NPC faction battle targeting (separate from general AI targeting)
  public npcBattleTargetId?: number; // Entity ID of current NPC battle target
  public targetPriority: number; // Target priority (0-5, higher = more important)
  public lastTargetUpdate: number; // Last time target was updated

  // Charger telegraph state
  public isCharging: boolean; // True during active charge phase
  public chargeStartTime: number; // When current charge started
  public chargeTargetDirection?: Vector; // Locked direction during charge

  // Thug low-health enrage — one-shot burst flag
  public enrageTriggered: boolean; // True once enrage has fired (never re-triggers)

  // Visual state for renderer behavior indicators
  public aiVisualState:
    | 'idle'
    | 'pursuing'
    | 'attacking'
    | 'retreating'
    | 'charging'
    | 'aiming'
    | 'orbiting'
    | 'swarming';

  // Dancing and idle behavior properties
  public isDancing?: boolean;
  public danceTargetId?: number;
  public danceStartTime?: number;
  public danceStage?: 'bounce' | 'spin';
  public danceComplete?: boolean;
  public spinAngle?: number;
  public spinSpeed?: number;

  constructor(...args: unknown[]) {
    this.behaviorPattern = (args[0] as BehaviorPattern) ?? BehaviorPattern.Direct;
    this.originalBehaviorPattern = this.behaviorPattern; // Store original behavior
    this.targetEntityId = args[1] as number | undefined;
    this.detectionRange = (args[2] as number) ?? 300;
    this.wanderDirection = args[3] as Vector | undefined;
    this.lastMovementChange = (args[4] as number) ?? 0;
    this.movementSeed = (args[5] as number) ?? Math.random();
    this.npcBattleTargetId = undefined;
    this.targetPriority = 0;
    this.lastTargetUpdate = 0;

    // Initialize visual state for renderer
    this.aiVisualState = 'idle';

    // Initialize charger telegraph state
    this.isCharging = false;
    this.chargeStartTime = 0;
    this.chargeTargetDirection = undefined;

    // Thug enrage one-shot flag
    this.enrageTriggered = false;

    // Initialize dancing properties
    this.isDancing = false;
    this.danceTargetId = undefined;
    this.danceStartTime = undefined;
    this.danceStage = undefined;
    this.danceComplete = false;
    this.spinAngle = 0;
    this.spinSpeed = 1;
  }
}
