import { Component } from '../core/ecs/ecs.model';

/**
 * Damage component - used for collision damage and contact damage
 */
export class DamageComponent implements Component {
  public contactDamage: number;
  public damageType: 'contact' | 'beam' | 'projectile' | 'burn' | 'discharge';
  public canCrit: boolean;
  public criticalChance: number;
  public criticalMultiplier: number;
  public burnDamage: number;
  public burnDuration: number;
  public burnTickTimer: number;
  public recoilPercent: number;
  public environmentalDamage: number;

  constructor(...args: unknown[]) {
    this.contactDamage = (args[0] as number) ?? 0;
    this.damageType = (args[1] as 'contact' | 'beam' | 'projectile' | 'burn' | 'discharge') ?? 'contact';
    this.canCrit = (args[2] as boolean) ?? false;
    this.criticalChance = (args[3] as number) ?? 0;
    this.criticalMultiplier = (args[4] as number) ?? 2;
    this.burnDamage = (args[5] as number) ?? 0;
    this.burnDuration = (args[6] as number) ?? 0;
    this.burnTickTimer = (args[7] as number) ?? 0;
    this.recoilPercent = (args[8] as number) ?? 0;
    this.environmentalDamage = (args[9] as number) ?? 0;
  }

  // Legacy property aliases for compatibility
  get critChance(): number {
    return this.criticalChance;
  }
  set critChance(value: number) {
    this.criticalChance = value;
  }

  get critMultiplier(): number {
    return this.criticalMultiplier;
  }
  set critMultiplier(value: number) {
    this.criticalMultiplier = value;
  }
}
