import { Component } from '../core/ecs/ecs.model';

/**
 * PowerupComponent - Marks an entity as a collectible powerup
 */
export class PowerupComponent implements Component {
  public type: 'damage_multiplier' | 'shield' | 'speed' | 'health' | 'rapid_fire' | 'experience' = 'damage_multiplier';
  public value: number = 1; // Multiplier or amount
  public duration: number = 5000; // Duration in milliseconds (0 = permanent)
  public respawnTime: number = 10000; // Time until respawn after collection (ms)
  public collectedAt: number = 0; // Timestamp when collected
  public isActive: boolean = true; // Is this powerup available for collection
  public visualEffect: {
    color: string;
    pulseSpeed: number;
    particleEffect?: string;
  } = { color: '#ff0000', pulseSpeed: 1 };

  constructor(..._args: unknown[]) {
    // ECS-compatible constructor
  }

  // Helper method to configure the powerup
  configure(
    type: 'damage_multiplier' | 'shield' | 'speed' | 'health' | 'rapid_fire' | 'experience',
    value: number,
    duration: number,
    respawnTime: number
  ): PowerupComponent {
    this.type = type;
    this.value = value;
    this.duration = duration;
    this.respawnTime = respawnTime;
    this.visualEffect.color = type === 'health' ? '#00ff00' : '#ff0000';
    return this;
  }
}

/**
 * ActivePowerupComponent - Tracks active powerups on an entity
 */
export class ActivePowerupComponent implements Component {
  public activePowerups: Array<{
    type: string;
    value: number;
    startTime: number;
    duration: number;
    endTime: number;
  }> = [];

  constructor(..._args: unknown[]) {
    // ECS-compatible constructor
  }

  addPowerup(type: string, value: number, duration: number): void {
    const startTime = window.performance.now();
    this.activePowerups.push({
      type,
      value,
      startTime,
      duration,
      endTime: startTime + duration,
    });
  }

  removeExpiredPowerups(): void {
    const now = window.performance.now();
    this.activePowerups = this.activePowerups.filter((p) => p.endTime > now);
  }

  getDamageMultiplier(): number {
    this.removeExpiredPowerups();
    let multiplier = 1;
    for (const powerup of this.activePowerups) {
      if (powerup.type === 'damage_multiplier') {
        multiplier *= powerup.value;
      }
    }
    return multiplier;
  }

  hasPowerup(type: string): boolean {
    this.removeExpiredPowerups();
    return this.activePowerups.some((p) => p.type === type);
  }

  getTimeRemaining(type: string): number {
    this.removeExpiredPowerups();
    const powerup = this.activePowerups.find((p) => p.type === type);
    if (!powerup) return 0;
    return Math.max(0, powerup.endTime - window.performance.now());
  }
}
