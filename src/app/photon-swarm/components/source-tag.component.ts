import { Component } from '../core/ecs/ecs.model';

/**
 * Source tag component - tracks which entity created this entity
 */
export class SourceTagComponent implements Component {
  public source: 'player' | 'enemy' | 'neutral';
  public shooterId?: number;
  public isReflected?: boolean; // Track if projectile was reflected by beam

  constructor(...args: unknown[]) {
    this.source = (args[0] as 'player' | 'enemy' | 'neutral') ?? 'neutral';
    this.shooterId = args[1] as number | undefined;
    this.isReflected = (args[2] as boolean | undefined) ?? false;
  }
}
