import { Component } from '../core/ecs/ecs.model';

/**
 * EmpPulseComponent — Drives the Disruptor's EMP pulse mechanic.
 *
 * Every `cooldown` ms the owning enemy fires a pulse of radius `radius`.
 * On hit the player is slowed by `slowFactor` (0-1) for `slowDuration` ms
 * and loses `chargeDrain` fraction of their current beam charge.
 *
 * CRITICAL: constructor uses (...args: unknown[]) pattern — required by ECS ComponentType<T>.
 */
export class EmpPulseComponent implements Component {
  public cooldown: number;
  public lastPulseTime: number;
  public radius: number;
  public slowFactor: number;
  public slowDuration: number;
  public chargeDrain: number;

  constructor(...args: unknown[]) {
    this.cooldown = (args[0] as number) ?? 6000;
    this.lastPulseTime = (args[1] as number) ?? 0;
    this.radius = (args[2] as number) ?? 120;
    this.slowFactor = (args[3] as number) ?? 0.4;
    this.slowDuration = (args[4] as number) ?? 2000;
    this.chargeDrain = (args[5] as number) ?? 0.3;
  }
}
