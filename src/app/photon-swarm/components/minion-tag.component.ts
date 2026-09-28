import { Component } from '../core/ecs/ecs.model';

/**
 * MinionTagComponent — tags an entity as "summoned by ownerId".
 * Used by MinionTrackerService to free the owner's cap slot on minion death.
 */
export class MinionTagComponent implements Component {
  public readonly name = 'MinionTagComponent';
  public ownerId: number;
  public spawnedAt: number;

  constructor(...args: unknown[]) {
    this.ownerId = (args[0] as number) ?? 0;
    this.spawnedAt = (args[1] as number) ?? Date.now();
  }
}
