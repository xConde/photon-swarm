import { Component } from '../core/ecs/ecs.model';

/**
 * PlayerControlled component - marks entity as player-controlled
 */
export class PlayerControlledComponent implements Component {
  public angle: number;
  public beamActive: boolean;
  public isDashing: boolean;
  public isInvincible: boolean;
  public invincibilityEndTime: number;
  public lastDashTime: number;
  public dashCooldown: number;
  public speedMultiplier: number;
  // Player metadata (actual stats are in GameStateService/ProgressionSystemService)
  public className: string;
  public ascensionLevel: number;

  constructor(...args: unknown[]) {
    this.angle = (args[0] as number) ?? 0;
    this.beamActive = (args[1] as boolean) ?? true;
    this.isDashing = (args[2] as boolean) ?? false;
    this.isInvincible = (args[3] as boolean) ?? false;
    this.invincibilityEndTime = (args[4] as number) ?? 0;
    this.lastDashTime = (args[5] as number) ?? 0;
    this.dashCooldown = (args[6] as number) ?? 2000;
    this.speedMultiplier = (args[7] as number) ?? 1;
    this.className = (args[8] as string) ?? 'Pilot';
    this.ascensionLevel = (args[9] as number) ?? 0;
  }
}
