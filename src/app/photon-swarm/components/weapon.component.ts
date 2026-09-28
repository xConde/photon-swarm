import { Component } from '../core/ecs/ecs.model';

export class WeaponComponent implements Component {
  public damage: number;
  public fireRate: number;
  public lastShotTime: number;
  public projectileSpeed: number;
  public projectileRadius: number;
  public projectileColor: string;
  public projectileLifetime: number;
  public burstCount: number;
  public burstDelay: number;
  public chargedShotChance: number;
  public readyToFire: boolean;
  public targetDirection?: { x: number; y: number };

  // Sniper/Ranged targeting telegraph system
  public isAiming: boolean; // True when charging up a shot
  public aimStartTime: number; // When aiming started
  public aimDuration: number; // How long to telegraph before firing (ms)

  constructor(...args: unknown[]) {
    this.damage = (args[0] as number) ?? 0;
    this.fireRate = (args[1] as number) ?? 0;
    this.lastShotTime = (args[2] as number) ?? 0;
    this.projectileSpeed = (args[3] as number) ?? 200;
    this.projectileRadius = (args[4] as number) ?? 5;
    this.projectileColor = (args[5] as string) ?? '#ff6b6b';
    this.projectileLifetime = (args[6] as number) ?? 3000;
    this.burstCount = (args[7] as number) ?? 1;
    this.burstDelay = (args[8] as number) ?? 100;
    this.chargedShotChance = (args[9] as number) ?? 0;
    this.readyToFire = false;
    this.targetDirection = undefined;

    // Targeting telegraph defaults
    this.isAiming = false;
    this.aimStartTime = 0;
    this.aimDuration = 500; // 500ms telegraph by default
  }
  canFire(currentTime: number): boolean {
    return currentTime - this.lastShotTime >= this.fireRate;
  }
  getCooldownProgress(currentTime: number): number {
    const elapsed = currentTime - this.lastShotTime;
    return Math.min(elapsed / this.fireRate, 1);
  }

  /**
   * Get aiming progress (0-1) for telegraph rendering
   */
  getAimProgress(currentTime: number): number {
    if (!this.isAiming) return 0;
    const elapsed = currentTime - this.aimStartTime;
    return Math.min(elapsed / this.aimDuration, 1);
  }

  /**
   * Check if aiming is complete and ready to fire
   */
  isAimComplete(currentTime: number): boolean {
    return this.isAiming && currentTime - this.aimStartTime >= this.aimDuration;
  }
}
