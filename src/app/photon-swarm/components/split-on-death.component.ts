import { Component } from '../core/ecs/ecs.model';

/**
 * SplitOnDeathComponent — Drives the Swarm (Neon Minnow) split mechanic.
 *
 * When the owning enemy dies it spawns `childCount` smaller copies at jittered
 * positions around the death point.  Generation tracking prevents infinite
 * recursion: children whose `generation >= maxGenerations` receive NO
 * SplitOnDeathComponent, so they die without splitting.
 *
 * CRITICAL: constructor uses (...args: unknown[]) pattern — required by ECS ComponentType<T>.
 */
export class SplitOnDeathComponent implements Component {
  public childCount: number;
  public generation: number;
  public maxGenerations: number;
  public childHealthScale: number;
  public jitterRadius: number;

  constructor(...args: unknown[]) {
    this.childCount = (args[0] as number) ?? 2;
    this.generation = (args[1] as number) ?? 0;
    this.maxGenerations = (args[2] as number) ?? 1;
    this.childHealthScale = (args[3] as number) ?? 0.5;
    this.jitterRadius = (args[4] as number) ?? 28;
  }

  /** Returns the generation number that should be assigned to spawned children. */
  spawnChildGeneration(): number {
    return this.generation + 1;
  }

  /** True when this entity is still allowed to split on death. */
  canSplit(): boolean {
    return this.generation < this.maxGenerations;
  }
}
