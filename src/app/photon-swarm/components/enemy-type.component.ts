import { Component } from '../core/ecs/ecs.model';
import { AlertState, EnemyType, Rarity } from '../core/models/enemy.model';

export type EnemyRarity = Rarity;
export { EnemyType, AlertState };

/**
 * EnemyType component - defines enemy type and behavior properties
 */
export class EnemyTypeComponent implements Component {
  public type: EnemyType;
  public rarity: EnemyRarity;
  public alertState: AlertState;
  public isElite: boolean;
  public rankLevel: number;
  public shardMultiplier: number;
  public damageMultiplier: number;
  public isChampion: boolean;
  public zoneId: number | null;

  constructor(...args: unknown[]) {
    this.type = (args[0] as EnemyType) ?? EnemyType.Basic;
    this.rarity = (args[1] as EnemyRarity) ?? Rarity.Common;
    this.alertState = (args[2] as AlertState) ?? AlertState.Passive;
    this.isElite = (args[3] as boolean) ?? false;
    this.rankLevel = (args[4] as number) ?? 0;
    this.shardMultiplier = (args[5] as number) ?? 1;
    this.damageMultiplier = (args[6] as number) ?? 1;
    this.isChampion = (args[7] as boolean) ?? false;
    this.zoneId = (args[8] as number | null) ?? null;
  }
}
