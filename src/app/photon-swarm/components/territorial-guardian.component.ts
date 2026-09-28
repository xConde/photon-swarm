import { Component } from '../core/ecs/ecs.model';

/**
 * Marks an entity as a territorial guardian that patrols a home position
 * and guards a treasure cache. Leashes back when chasing too far.
 */
export class TerritorialGuardianComponent implements Component {
  /** Home patrol position X */
  public homeX: number;
  /** Home patrol position Y */
  public homeY: number;
  /** Max distance from home before returning */
  public leashRadius: number;
  /** Distance at which guardian aggros on player */
  public aggroRadius: number;
  /** Whether guardian is currently leashed (returning home) */
  public isLeashed: boolean;
  /** Whether guardian is actively chasing a target */
  public isAggroed: boolean;
  /** Entity ID of aggro target */
  public aggroTargetEntityId: number;
  /** ID of the treasure cache this guardian protects */
  public guardedTreasureCacheId: number;
  /** Zone this guardian belongs to */
  public zoneId: number;
  /** Difficulty tier: 1=normal, 2=elite, 3=boss-tier */
  public rankTier: 1 | 2 | 3;
  /** Timestamp of last aggro start (for audio cooldown) */
  public lastAggroTime: number;
  /** Timestamp when the guardian was created (for fade-in rendering) */
  public spawnTime: number;

  constructor(...args: unknown[]) {
    this.homeX = (args[0] as number) ?? 0;
    this.homeY = (args[1] as number) ?? 0;
    this.leashRadius = (args[2] as number) ?? 800;
    this.aggroRadius = (args[3] as number) ?? 400;
    this.isLeashed = false;
    this.isAggroed = false;
    this.aggroTargetEntityId = -1;
    this.guardedTreasureCacheId = (args[4] as number) ?? 0;
    this.zoneId = (args[5] as number) ?? 1;
    this.rankTier = (args[6] as 1 | 2 | 3) ?? 1;
    this.lastAggroTime = 0;
    // Use performance.now() to match RenderableComponent.spawnTime — both reference
    // the same monotonic timeline so renderers can compare them without conversion.
    this.spawnTime = (args[7] as number) ?? window.performance.now();
  }
}
