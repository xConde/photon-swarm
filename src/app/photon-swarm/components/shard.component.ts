import { Component } from '../core/ecs/ecs.model';

/**
 * Shard component - marks entity as a collectible shard
 */
export class ShardComponent implements Component {
  public value: number;
  public spawnTime: number;
  public glowPhase: number;
  public isBeingAttracted: boolean;
  public attractionDistance: number;

  constructor(...args: unknown[]) {
    this.value = (args[0] as number) ?? 0;
    this.spawnTime = (args[1] as number) ?? 0;
    this.glowPhase = (args[2] as number) ?? 0;
    this.isBeingAttracted = (args[3] as boolean) ?? false;
    this.attractionDistance = (args[4] as number) ?? 0;
  }
}
