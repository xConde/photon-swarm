import { Component } from '../core/ecs/ecs.model';

export class BeamComponent implements Component {
  public angle: number;
  public rotationSpeed: number;
  public damage: number;
  public length: number;
  public width: number;
  public isDouble: boolean;
  public activeTargeting: boolean;
  public targetingStartTime?: number;
  public targetingDuration: number;
  public baseColor: string;

  constructor(...args: unknown[]) {
    this.angle = (args[0] as number) ?? 0;
    this.rotationSpeed = (args[1] as number) ?? 0;
    this.damage = (args[2] as number) ?? 0;
    this.length = (args[3] as number) ?? 200;
    this.width = (args[4] as number) ?? 6;
    this.isDouble = (args[5] as boolean) ?? false;
    this.activeTargeting = (args[6] as boolean) ?? false;
    this.targetingStartTime = args[7] as number | undefined;
    this.targetingDuration = (args[8] as number) ?? 1000;
    this.baseColor = (args[9] as string) ?? '#00ffff';
  }

  getCurrentColor(): string {
    return this.baseColor;
  }

  getThicknessMultiplier(): number {
    return 1;
  }

  getGlowIntensity(): number {
    return 0.3;
  }
}
