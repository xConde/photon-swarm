import { Component } from '../core/ecs/ecs.model';

export enum AsteroidState {
  WARNING = 'warning', // Showing shadow/warning on ground
  FALLING = 'falling', // Actively falling
  IMPACT = 'impact', // Just hit, dealing area damage
  LANDED = 'landed', // On ground, destructible
  DESTROYED = 'destroyed', // Destroyed, dropping rewards
}

/**
 * Falling Asteroid Component
 * Manages the lifecycle of asteroids that fall from above
 */
export type AsteroidRewardType = 'speed' | 'damage' | 'shield' | 'regen' | 'crit' | 'xp_boost';

export class FallingAsteroidComponent implements Component {
  public state: AsteroidState;
  public warningStartTime: number;
  public fallStartTime: number;
  public impactTime: number;
  public targetX: number;
  public targetY: number;
  public fallHeight: number;
  public impactRadius: number;
  public impactDamage: number;
  public size: number;
  public health: number;
  public maxHealth: number;
  public rewardType: AsteroidRewardType;
  public rewardDuration: number;
  public rewardPower: number;
  public isMega: boolean; // MEGA variants have better stats and rewards

  constructor(...args: unknown[]) {
    this.state = (args[0] as AsteroidState) ?? AsteroidState.WARNING;
    this.warningStartTime = (args[1] as number) ?? Date.now();
    this.fallStartTime = (args[2] as number) ?? 0;
    this.impactTime = (args[3] as number) ?? 0;
    this.targetX = (args[4] as number) ?? 0;
    this.targetY = (args[5] as number) ?? 0;
    this.fallHeight = (args[6] as number) ?? 1000;
    this.impactRadius = (args[7] as number) ?? 150; // Area of effect damage
    this.impactDamage = (args[8] as number) ?? 50;
    this.size = (args[9] as number) ?? 40;
    this.health = (args[10] as number) ?? 100;
    this.maxHealth = (args[11] as number) ?? 100;
    this.rewardType = (args[12] as AsteroidRewardType) ?? 'speed';
    this.rewardDuration = (args[13] as number) ?? 10000; // 10 seconds
    this.rewardPower = (args[14] as number) ?? 1.5; // 50% boost
    this.isMega = (args[15] as boolean) ?? false;
  }

  static readonly type = 'FallingAsteroidComponent';

  clone(): FallingAsteroidComponent {
    return new FallingAsteroidComponent(
      this.state,
      this.warningStartTime,
      this.fallStartTime,
      this.impactTime,
      this.targetX,
      this.targetY,
      this.fallHeight,
      this.impactRadius,
      this.impactDamage,
      this.size,
      this.health,
      this.maxHealth,
      this.rewardType,
      this.rewardDuration,
      this.rewardPower,
      this.isMega
    );
  }
}
