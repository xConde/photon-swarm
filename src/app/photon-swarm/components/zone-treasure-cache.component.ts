import { Component } from '../core/ecs/ecs.model';

export class ZoneTreasureCacheComponent implements Component {
  public cacheId: number;
  public zoneId: number;
  public isOpen: boolean;
  public lootTableKey: string;
  public guardianEntityId: number | null;
  public discoveryTime: number;
  public openTime: number;

  constructor(...args: unknown[]) {
    this.cacheId = (args[0] as number) ?? 0;
    this.zoneId = (args[1] as number) ?? 1;
    this.isOpen = false;
    this.lootTableKey = (args[2] as string) ?? 'default';
    this.guardianEntityId = (args[3] as number | null) ?? null;
    this.discoveryTime = 0;
    this.openTime = 0;
  }
}
