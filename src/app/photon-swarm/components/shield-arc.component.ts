import { Component } from '../core/ecs/ecs.model';

/**
 * ShieldArcComponent - Frontal arc damage reduction for the Sentinel enemy.
 *
 * The shield blocks 80% of incoming damage from within a 120-degree frontal arc.
 * facingAngle tracks toward the player and is updated each frame by ShieldFacingSystemService.
 */
export class ShieldArcComponent implements Component {
  public arcAngle: number; // 120 degrees = 2π/3 radians
  public damageReduction: number; // 0.8 = 80%
  public facingAngle: number; // radians, toward player
  public lastBlockTime: number; // timestamp of last blocked hit (for shield flash)

  constructor(...args: unknown[]) {
    this.arcAngle = (args[0] as number) ?? (2 * Math.PI) / 3; // 120 degrees in radians
    this.damageReduction = (args[1] as number) ?? 0.8;
    this.facingAngle = (args[2] as number) ?? 0;
    this.lastBlockTime = (args[3] as number) ?? 0;
  }

  /**
   * Check if an attack from the given source angle is within the shield's frontal arc.
   * @param shield - The shield component
   * @param attackSourceAngle - Direction FROM defender TO attacker (radians).
   *                            This is the "source" of the incoming attack.
   * @returns The damage reduction to apply (0 if not blocked, shield.damageReduction if blocked)
   */
  static getBlockReduction(shield: ShieldArcComponent, attackSourceAngle: number): number {
    let diff = attackSourceAngle - shield.facingAngle;
    // Normalize to [-π, π]
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) <= shield.arcAngle / 2) {
      return shield.damageReduction;
    }
    return 0;
  }
}
