import { Component } from '../core/ecs/ecs.model';

/**
 * Buff component - tracks temporary stat modifiers and effects
 */
export class BuffComponent implements Component {
  public damageMultiplier: number;
  public damageReduction: number;
  public criticalChance: number;
  public criticalMultiplier: number;
  public speedMultiplier: number;
  public fireRateMultiplier: number;
  public healingMultiplier: number;
  public experienceMultiplier: number;
  public activeBuffs: Set<string>;

  constructor(...args: unknown[]) {
    this.damageMultiplier = (args[0] as number) ?? 1.0;
    this.damageReduction = (args[1] as number) ?? 0;
    this.criticalChance = (args[2] as number) ?? 0;
    this.criticalMultiplier = (args[3] as number) ?? 1.0;
    this.speedMultiplier = (args[4] as number) ?? 1.0;
    this.fireRateMultiplier = (args[5] as number) ?? 1.0;
    this.healingMultiplier = (args[6] as number) ?? 1.0;
    this.experienceMultiplier = (args[7] as number) ?? 1.0;
    this.activeBuffs = (args[8] as Set<string>) ?? new Set();
  }

  /**
   * Add a buff by name
   */
  addBuff(buffName: string): void {
    this.activeBuffs.add(buffName);
  }

  /**
   * Remove a buff by name
   */
  removeBuff(buffName: string): void {
    this.activeBuffs.delete(buffName);
  }

  /**
   * Check if a specific buff is active
   */
  hasBuff(buffName: string): boolean {
    return this.activeBuffs.has(buffName);
  }

  /**
   * Get all active buff names
   */
  getActiveBuffs(): string[] {
    return Array.from(this.activeBuffs);
  }

  /**
   * Clear all buffs and reset multipliers
   */
  clearBuffs(): void {
    this.activeBuffs.clear();
    this.damageMultiplier = 1.0;
    this.damageReduction = 0;
    this.criticalChance = 0;
    this.criticalMultiplier = 1.0;
    this.speedMultiplier = 1.0;
    this.fireRateMultiplier = 1.0;
    this.healingMultiplier = 1.0;
    this.experienceMultiplier = 1.0;
  }

  /**
   * Clean up internal data structures on entity destruction
   */
  destroy(): void {
    this.activeBuffs.clear();
  }
}
