import { Component } from '../core/ecs/ecs.model';

export class ZoneGateComponent implements Component {
  public gateId: number;
  public fromZoneId: number;
  public toZoneId: number;
  public worldX: number;
  public worldY: number;
  public radius: number;
  public isUnlocked: boolean;
  public unlockCondition: 'wave' | 'guardian_kill' | 'treasure_clear';
  public unlockValue: number;
  public lastTriggerTime: number;

  constructor(...args: unknown[]) {
    this.gateId = (args[0] as number) ?? 0;
    this.fromZoneId = (args[1] as number) ?? 1;
    this.toZoneId = (args[2] as number) ?? 2;
    this.worldX = (args[3] as number) ?? 0;
    this.worldY = (args[4] as number) ?? 0;
    this.radius = (args[5] as number) ?? 150;
    this.isUnlocked = (args[6] as boolean) ?? false;
    this.unlockCondition = (args[7] as 'wave' | 'guardian_kill' | 'treasure_clear') ?? 'wave';
    this.unlockValue = (args[8] as number) ?? 1;
    this.lastTriggerTime = 0;
  }
}
