import { Component } from '../core/ecs/ecs.model';

/**
 * Charged Projectile Component - marks projectiles as charged with enhanced properties
 */
export class ChargedProjectileComponent implements Component {
  public chargeLevel: number;
  public baseDamageMultiplier: number;
  public chargedColor: string;
  public isCharged: boolean;
  public chargeThreshold: number;
  public pulseFrequency: number;
  public trailLength: number;
  public sparkIntensity: number;

  constructor(...args: unknown[]) {
    this.chargeLevel = (args[0] as number) ?? 0; // 0-1, where 1 is fully charged
    this.baseDamageMultiplier = (args[1] as number) ?? 1.5; // Default 50% damage boost
    this.chargedColor = (args[2] as string) ?? '#00ffff'; // Bright cyan for charged projectiles
    this.isCharged = (args[3] as boolean) ?? false; // True if projectile qualifies as "charged"
    this.chargeThreshold = (args[4] as number) ?? 0.5; // Minimum charge level to be considered "charged"
    this.pulseFrequency = (args[5] as number) ?? 8; // Pulse animation frequency for charged projectiles
    this.trailLength = (args[6] as number) ?? 3; // Enhanced trail length for charged projectiles
    this.sparkIntensity = (args[7] as number) ?? 2; // Particle effect intensity

    // Auto-update charged state based on charge level
    this.updateChargedState();
  }

  /**
   * Update the charged state based on current charge level
   */
  updateChargedState(): void {
    this.isCharged = this.chargeLevel >= this.chargeThreshold;
  }

  /**
   * Get the damage multiplier based on charge level
   */
  getDamageMultiplier(): number {
    if (!this.isCharged) return 1.0;

    // Scale damage from 1.0 to baseDamageMultiplier based on charge level
    const chargeRatio = Math.min(this.chargeLevel / 1.0, 1.0);
    return 1.0 + (this.baseDamageMultiplier - 1.0) * chargeRatio;
  }

  /**
   * Get the current visual color based on charge state
   */
  getCurrentColor(): string {
    if (!this.isCharged) return this.chargedColor; // Use theme-aware color from constructor

    // Interpolate between charged color and bright white based on charge level
    // Parse the base color to RGB for interpolation
    const baseColor = this.chargedColor;
    const hex = baseColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) || 0;
    const g = parseInt(hex.substr(2, 2), 16) || 255;
    const b = parseInt(hex.substr(4, 2), 16) || 255;

    // Interpolate towards white based on charge level
    const intensity = this.chargeLevel;
    const finalR = Math.floor(r + (255 - r) * intensity * 0.3);
    const finalG = Math.floor(g + (255 - g) * intensity * 0.3);
    const finalB = Math.floor(b + (255 - b) * intensity * 0.3);

    return `rgba(${finalR}, ${finalG}, ${finalB}, 0.95)`;
  }

  /**
   * Get pulsing glow intensity for animation
   */
  getPulseGlow(currentTime: number): number {
    if (!this.isCharged) return 0;

    const pulse = Math.sin(currentTime * 0.01 * this.pulseFrequency) * 0.5 + 0.5;
    return this.chargeLevel * 2 * (0.5 + pulse * 0.5);
  }

  /**
   * Get enhanced size multiplier for charged projectiles
   */
  getSizeMultiplier(): number {
    if (!this.isCharged) return 1.0;

    // Charged projectiles are 20% larger at max charge (matching MAX_SIZE_MULTIPLIER config)
    // This prevents the giant white ball issue while still providing visual feedback
    return 1.0 + this.chargeLevel * 0.2;
  }

  /**
   * Check if projectile should emit particle trail
   */
  shouldEmitTrail(): boolean {
    return this.isCharged && this.chargeLevel > 0.7;
  }

  /**
   * Get trail particle data for rendering
   */
  getTrailData(): { length: number; intensity: number; color: string; frequency: number } | null {
    if (!this.shouldEmitTrail()) return null;

    return {
      length: this.trailLength,
      intensity: this.sparkIntensity * this.chargeLevel,
      color: this.getCurrentColor(),
      frequency: this.chargeLevel * 10, // More particles for higher charge
    };
  }
}
