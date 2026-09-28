import { Component } from '../core/ecs/ecs.model';

/**
 * Spawner component - marks entity as capable of spawning other entities
 */
export class SpawnerComponent implements Component {
  public spawnType: string;
  public spawnRate: number;
  public lastSpawnTime: number;
  public maxSpawns: number;
  public spawnCount: number;
  public spawnOnDeath: boolean;

  constructor(...args: unknown[]) {
    this.spawnType = (args[0] as string) ?? '';
    this.spawnRate = (args[1] as number) ?? 1000;
    this.lastSpawnTime = (args[2] as number) ?? 0;
    this.maxSpawns = (args[3] as number) ?? -1;
    this.spawnCount = (args[4] as number) ?? 0;
    this.spawnOnDeath = (args[5] as boolean) ?? false;
  }

  /**
   * Check if spawner can spawn based on rate and max spawns
   */
  canSpawn(currentTime: number): boolean {
    if (this.maxSpawns > 0 && this.spawnCount >= this.maxSpawns) {
      return false;
    }
    return currentTime - this.lastSpawnTime >= this.spawnRate;
  }
}
