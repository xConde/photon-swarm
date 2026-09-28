import { Injectable } from '@angular/core';
import { EngineSystem } from '../utils/system';
import { Enemy, EnemyType } from '../models/enemy.model';
import { RandomService } from '../utils/random.service';
import { BuffSystemService } from '../progression/buff-system.service';
import { PlayerUpgradesService } from '../player/player-upgrades.service';

export interface DamageCalculation {
  baseDamage: number;
  finalDamage: number;
  isCritical: boolean;
  criticalMultiplier: number;
  damageModifiers: DamageModifier[];
  damageType: DamageType;
  // OSRS-style combat results
  accuracyRollResult: AccuracyRollResult;
  isHit: boolean;
  maxHit: number;
}

export interface AccuracyRollResult {
  attackerAccuracyRoll: number;
  defenderDefenseRoll: number;
  attackBonus: number;
  defenseBonus: number;
  isSuccessful: boolean;
  hitChance: number; // For debugging/UI display
}

export interface DamageModifier {
  name: string;
  value: number;
  multiplier: boolean;
  source: string;
}

export type DamageType = 'beam' | 'kamikaze' | 'projectile' | 'burn' | 'recoil' | 'environmental';

// OSRS-style combat stats
export type CombatStyle = 'slash' | 'stab' | 'crush' | 'magic' | 'ranged';

export interface CombatStats {
  // Attack stats (affect accuracy)
  attackLevel: number;
  slashAttackBonus: number;
  stabAttackBonus: number;
  crushAttackBonus: number;
  magicAttackBonus: number;
  rangedAttackBonus: number;

  // Defense stats (reduce incoming accuracy)
  defenseLevel: number;
  slashDefenseBonus: number;
  stabDefenseBonus: number;
  crushDefenseBonus: number;
  magicDefenseBonus: number;
  rangedDefenseBonus: number;

  // Strength stats (affect max hit)
  strengthLevel: number;
  strengthBonus: number;
  magicDamageBonus: number;
  rangedStrengthBonus: number;
}

export interface EnemyDamageProperties {
  baseDamage: number;
  damageMultiplier: number;
  criticalChance: number;
  criticalMultiplier: number;
  damageType: DamageType;

  // OSRS-style combat properties
  combatStats: CombatStats;
  preferredCombatStyle: CombatStyle;
  armorTier: ArmorTier;
  weaknesses: CombatStyle[]; // Styles this enemy is weak to
  resistances: CombatStyle[]; // Styles this enemy resists
}

export type ArmorTier = 'none' | 'light' | 'medium' | 'heavy' | 'magical' | 'divine';

@EngineSystem()
@Injectable({ providedIn: 'root' })
export class DamageCalculationService {
  // Player combat stats (updated by equipment system)
  private playerStats: CombatStats = {
    attackLevel: 1,
    defenseLevel: 1,
    strengthLevel: 1,
    slashAttackBonus: 0,
    stabAttackBonus: 0,
    crushAttackBonus: 0,
    magicAttackBonus: 5,
    rangedAttackBonus: 0,
    slashDefenseBonus: 0,
    stabDefenseBonus: 0,
    crushDefenseBonus: 0,
    magicDefenseBonus: 0,
    rangedDefenseBonus: 0,
    strengthBonus: 0,
    magicDamageBonus: 0,
    rangedStrengthBonus: 0,
  };

  constructor(
    private random: RandomService,
    private buffs: BuffSystemService,
    private playerUpgrades: PlayerUpgradesService
  ) {}

  // === PLAYER STATS MANAGEMENT ===

  /**
   * Update player combat stats (called by equipment system)
   */
  updatePlayerCombatStats(newStats: CombatStats): void {
    this.playerStats = { ...newStats };
    if (window.debugLogBridge) {
      window.debugLogBridge.log('Player combat stats updated', 'info', {
        source: 'damage_calculation_service',
        operation: 'update_stats',
        stats: this.playerStats,
      });
    }
  }

  /**
   * Get current player combat stats
   */
  getCurrentPlayerStats(): CombatStats {
    return { ...this.playerStats };
  }

  // === OSRS-STYLE TWO-ROLL COMBAT ===

  calculateOSRSStyleDamage(
    attacker: CombatStats,
    defender: CombatStats,
    combatStyle: CombatStyle,
    weaponMaxHit: number
  ): DamageCalculation {
    // Step 1: Accuracy Roll
    const accuracyResult = this.performAccuracyRoll(attacker, defender, combatStyle);

    const modifiers: DamageModifier[] = [];

    // If accuracy roll fails, deal 0 damage
    if (!accuracyResult.isSuccessful) {
      return {
        baseDamage: 0,
        finalDamage: 0,
        isCritical: false,
        criticalMultiplier: 1,
        damageModifiers: modifiers,
        damageType: this.combatStyleToDamageType(combatStyle),
        accuracyRollResult: accuracyResult,
        isHit: false,
        maxHit: weaponMaxHit,
      };
    }

    // Step 2: Damage Roll (only if accuracy succeeds)
    const maxHit = this.calculateMaxHit(attacker, combatStyle, weaponMaxHit);
    const rolledDamage = Math.floor(this.random.random() * maxHit) + 1; // 1 to maxHit

    modifiers.push({
      name: 'Base Damage Roll',
      value: rolledDamage,
      multiplier: false,
      source: 'weapon',
    });

    // Check for critical hit (separate from OSRS, but fits our game)
    const criticalChance = this.getCriticalHitChance();
    const isCritical = this.random.random() < criticalChance;
    let finalDamage = rolledDamage;

    const critMultiplier = this.getCriticalHitMultiplier();
    if (isCritical) {
      finalDamage *= critMultiplier;
      modifiers.push({
        name: 'Critical Hit',
        value: critMultiplier,
        multiplier: true,
        source: 'combat',
      });
    }

    return {
      baseDamage: rolledDamage,
      finalDamage: Math.floor(finalDamage),
      isCritical,
      criticalMultiplier: isCritical ? critMultiplier : 1,
      damageModifiers: modifiers,
      damageType: this.combatStyleToDamageType(combatStyle),
      accuracyRollResult: accuracyResult,
      isHit: true,
      maxHit,
    };
  }

  private performAccuracyRoll(
    attacker: CombatStats,
    defender: CombatStats,
    combatStyle: CombatStyle
  ): AccuracyRollResult {
    // Get relevant bonuses based on combat style
    const attackBonus = this.getAttackBonus(attacker, combatStyle);
    const defenseBonus = this.getDefenseBonus(defender, combatStyle);

    // Calculate effective levels (OSRS formula)
    const effectiveAttackLevel = attacker.attackLevel + 8;
    const effectiveDefenseLevel = defender.defenseLevel + 8;

    // Calculate max accuracy rolls (OSRS formula)
    const maxAttackRoll = effectiveAttackLevel * (attackBonus + 64);
    const maxDefenseRoll = effectiveDefenseLevel * (defenseBonus + 64);

    // Perform the rolls
    const attackerRoll = Math.floor(this.random.random() * (maxAttackRoll + 1));
    const defenderRoll = Math.floor(this.random.random() * (maxDefenseRoll + 1));

    // Calculate hit chance for display purposes
    const hitChance = this.calculateHitChance(maxAttackRoll, maxDefenseRoll);

    return {
      attackerAccuracyRoll: attackerRoll,
      defenderDefenseRoll: defenderRoll,
      attackBonus,
      defenseBonus,
      isSuccessful: attackerRoll > defenderRoll,
      hitChance,
    };
  }

  private calculateMaxHit(attacker: CombatStats, combatStyle: CombatStyle, weaponMaxHit: number): number {
    let strengthBonus = 0;

    switch (combatStyle) {
      case 'slash':
      case 'stab':
      case 'crush':
        strengthBonus = attacker.strengthBonus;
        break;
      case 'magic':
        strengthBonus = attacker.magicDamageBonus;
        break;
      case 'ranged':
        strengthBonus = attacker.rangedStrengthBonus;
        break;
    }

    // OSRS max hit formula (simplified)
    const effectiveStrength = attacker.strengthLevel + strengthBonus + 8;
    const maxHit = Math.floor(0.5 + (effectiveStrength * (strengthBonus + 64)) / 640);

    return Math.max(weaponMaxHit, maxHit);
  }

  private calculateHitChance(maxAttackRoll: number, maxDefenseRoll: number): number {
    if (maxAttackRoll <= maxDefenseRoll) {
      return maxAttackRoll / (2 * maxDefenseRoll);
    } else {
      return 1 - maxDefenseRoll / (2 * maxAttackRoll);
    }
  }

  private getAttackBonus(stats: CombatStats, style: CombatStyle): number {
    switch (style) {
      case 'slash':
        return stats.slashAttackBonus;
      case 'stab':
        return stats.stabAttackBonus;
      case 'crush':
        return stats.crushAttackBonus;
      case 'magic':
        return stats.magicAttackBonus;
      case 'ranged':
        return stats.rangedAttackBonus;
      default:
        return 0;
    }
  }

  private getDefenseBonus(stats: CombatStats, style: CombatStyle): number {
    switch (style) {
      case 'slash':
        return stats.slashDefenseBonus;
      case 'stab':
        return stats.stabDefenseBonus;
      case 'crush':
        return stats.crushDefenseBonus;
      case 'magic':
        return stats.magicDefenseBonus;
      case 'ranged':
        return stats.rangedDefenseBonus;
      default:
        return 0;
    }
  }

  private combatStyleToDamageType(style: CombatStyle): DamageType {
    switch (style) {
      case 'magic':
        return 'beam'; // Our beam attacks are like magic
      case 'ranged':
        return 'projectile';
      default:
        return 'projectile'; // Melee styles default to projectile for our game
    }
  }

  // === LEGACY BEAM DAMAGE (for backwards compatibility) ===

  calculateBeamDamage(enemy: Enemy, baseBeamDamage: number): DamageCalculation {
    const modifiers: DamageModifier[] = [];

    // Base damage
    let finalDamage = baseBeamDamage;
    modifiers.push({
      name: 'Base Beam Damage',
      value: baseBeamDamage,
      multiplier: false,
      source: 'weapon',
    });

    // Enemy damage multiplier
    const enemyMultiplier = enemy.damageMultiplier ?? 1;
    if (enemyMultiplier !== 1) {
      finalDamage *= enemyMultiplier;
      modifiers.push({
        name: 'Enemy Multiplier',
        value: enemyMultiplier,
        multiplier: true,
        source: 'enemy',
      });
    }

    // Player beam damage multiplier
    const playerBeamMultiplier = this.buffs.beamDamageMultiplier;
    if (playerBeamMultiplier !== 1) {
      finalDamage *= playerBeamMultiplier;
      modifiers.push({
        name: 'Player Beam Multiplier',
        value: playerBeamMultiplier,
        multiplier: true,
        source: 'player',
      });
    }

    // Critical hit calculation
    const criticalChance = this.getCriticalHitChance();
    const isCritical = this.random.random() < criticalChance;
    const criticalMultiplier = isCritical ? this.getCriticalHitMultiplier() : 1;

    if (isCritical) {
      finalDamage *= criticalMultiplier;
      modifiers.push({
        name: 'Critical Hit',
        value: criticalMultiplier,
        multiplier: true,
        source: 'combat',
      });
    }

    return {
      baseDamage: baseBeamDamage,
      finalDamage: Math.floor(finalDamage),
      isCritical,
      criticalMultiplier,
      damageModifiers: modifiers,
      damageType: 'beam',
      accuracyRollResult: {
        attackerAccuracyRoll: 0,
        defenderDefenseRoll: 0,
        attackBonus: 0,
        defenseBonus: 0,
        isSuccessful: true, // Legacy always hits
        hitChance: 1.0,
      },
      isHit: true,
      maxHit: Math.floor(finalDamage),
    };
  }

  // === KAMIKAZE DAMAGE CALCULATIONS ===

  calculateKamikazeDamage(enemy: Enemy): DamageCalculation {
    const baseHealth = enemy.health ?? 0;
    const kamikazeRatio = 0.5; // 50% of remaining health
    const baseDamage = Math.floor(baseHealth * kamikazeRatio);

    const modifiers: DamageModifier[] = [];
    modifiers.push({
      name: 'Kamikaze Damage',
      value: baseDamage,
      multiplier: false,
      source: 'enemy',
    });

    // Apply damage taken multiplier
    const damageTakenMultiplier = this.buffs.damageTakenMultiplier;
    const finalDamage = baseDamage * damageTakenMultiplier;

    if (damageTakenMultiplier !== 1) {
      modifiers.push({
        name: 'Damage Taken Multiplier',
        value: damageTakenMultiplier,
        multiplier: true,
        source: 'player',
      });
    }

    return {
      baseDamage,
      finalDamage: Math.floor(finalDamage),
      isCritical: false,
      criticalMultiplier: 1,
      damageModifiers: modifiers,
      damageType: 'kamikaze',
      accuracyRollResult: {
        attackerAccuracyRoll: 0,
        defenderDefenseRoll: 0,
        attackBonus: 0,
        defenseBonus: 0,
        isSuccessful: true, // Kamikaze always hits
        hitChance: 1.0,
      },
      isHit: true,
      maxHit: Math.floor(finalDamage),
    };
  }

  // === PROJECTILE DAMAGE CALCULATIONS ===

  calculateProjectileDamage(projectile: { damage: number }): DamageCalculation {
    const baseDamage = projectile.damage;
    const modifiers: DamageModifier[] = [];

    modifiers.push({
      name: 'Projectile Damage',
      value: baseDamage,
      multiplier: false,
      source: 'projectile',
    });

    // Apply damage taken multiplier
    const damageTakenMultiplier = this.buffs.damageTakenMultiplier;
    const finalDamage = baseDamage * damageTakenMultiplier;

    if (damageTakenMultiplier !== 1) {
      modifiers.push({
        name: 'Damage Taken Multiplier',
        value: damageTakenMultiplier,
        multiplier: true,
        source: 'player',
      });
    }

    return {
      baseDamage,
      finalDamage: Math.floor(finalDamage),
      isCritical: false,
      criticalMultiplier: 1,
      damageModifiers: modifiers,
      damageType: 'projectile',
      accuracyRollResult: {
        attackerAccuracyRoll: 0,
        defenderDefenseRoll: 0,
        attackBonus: 0,
        defenseBonus: 0,
        isSuccessful: true, // Projectiles always hit for now
        hitChance: 1.0,
      },
      isHit: true,
      maxHit: Math.floor(finalDamage),
    };
  }

  // === BURN DAMAGE CALCULATIONS ===

  calculateBurnDamage(_enemy: Enemy, baseBurnDamage: number): DamageCalculation {
    const modifiers: DamageModifier[] = [];

    modifiers.push({
      name: 'Base Burn Damage',
      value: baseBurnDamage,
      multiplier: false,
      source: 'burn',
    });

    // Burn damage multiplier
    const burnDamageMultiplier = this.buffs.burnDamageMultiplier;
    const finalDamage = baseBurnDamage * burnDamageMultiplier;

    if (burnDamageMultiplier !== 1) {
      modifiers.push({
        name: 'Burn Damage Multiplier',
        value: burnDamageMultiplier,
        multiplier: true,
        source: 'player',
      });
    }

    return {
      baseDamage: baseBurnDamage,
      finalDamage: Math.floor(finalDamage),
      isCritical: false,
      criticalMultiplier: 1,
      damageModifiers: modifiers,
      damageType: 'burn',
      accuracyRollResult: {
        attackerAccuracyRoll: 0,
        defenderDefenseRoll: 0,
        attackBonus: 0,
        defenseBonus: 0,
        isSuccessful: true, // DoT always hits
        hitChance: 1.0,
      },
      isHit: true,
      maxHit: Math.floor(finalDamage),
    };
  }

  // === RECOIL DAMAGE CALCULATIONS ===

  calculateRecoilDamage(enemy: Enemy, recoilMultiplier: number): DamageCalculation {
    const baseHealth = enemy.health ?? 1;
    const baseDamage = Math.floor(baseHealth * recoilMultiplier);

    const modifiers: DamageModifier[] = [];
    modifiers.push({
      name: 'Recoil Damage',
      value: baseDamage,
      multiplier: false,
      source: 'recoil',
    });

    return {
      baseDamage,
      finalDamage: baseDamage,
      isCritical: false,
      criticalMultiplier: 1,
      damageModifiers: modifiers,
      damageType: 'recoil',
      accuracyRollResult: {
        attackerAccuracyRoll: 0,
        defenderDefenseRoll: 0,
        attackBonus: 0,
        defenseBonus: 0,
        isSuccessful: true, // Recoil always hits
        hitChance: 1.0,
      },
      isHit: true,
      maxHit: baseDamage,
    };
  }

  // === ENEMY DAMAGE PROPERTIES (OSRS-STYLE) ===

  getEnemyDamageProperties(enemyType: EnemyType): EnemyDamageProperties {
    const properties: Record<EnemyType, EnemyDamageProperties> = {
      basic: {
        baseDamage: 3,
        damageMultiplier: 1,
        criticalChance: 0.05,
        criticalMultiplier: 1.5,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 10,
          defenseLevel: 10,
          strengthLevel: 10,
          slashAttackBonus: 5,
          stabAttackBonus: 5,
          crushAttackBonus: 5,
          magicAttackBonus: 0,
          rangedAttackBonus: 10,
          slashDefenseBonus: 5,
          stabDefenseBonus: 5,
          crushDefenseBonus: 5,
          magicDefenseBonus: 0,
          rangedDefenseBonus: 5,
          strengthBonus: 5,
          magicDamageBonus: 0,
          rangedStrengthBonus: 5,
        },
        preferredCombatStyle: 'ranged',
        armorTier: 'light',
        weaknesses: ['magic'],
        resistances: ['ranged'],
      },
      spitter: {
        baseDamage: 4,
        damageMultiplier: 1.1,
        criticalChance: 0.08,
        criticalMultiplier: 1.6,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 15,
          defenseLevel: 8,
          strengthLevel: 12,
          slashAttackBonus: 0,
          stabAttackBonus: 0,
          crushAttackBonus: 0,
          magicAttackBonus: 20,
          rangedAttackBonus: 15,
          slashDefenseBonus: 2,
          stabDefenseBonus: 2,
          crushDefenseBonus: 2,
          magicDefenseBonus: 10,
          rangedDefenseBonus: 8,
          strengthBonus: 0,
          magicDamageBonus: 15,
          rangedStrengthBonus: 10,
        },
        preferredCombatStyle: 'magic',
        armorTier: 'none',
        weaknesses: ['slash', 'stab', 'crush'],
        resistances: ['magic'],
      },
      tank: {
        baseDamage: 12,
        damageMultiplier: 1.5,
        criticalChance: 0.1,
        criticalMultiplier: 1.8,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 25,
          defenseLevel: 35,
          strengthLevel: 30,
          slashAttackBonus: 25,
          stabAttackBonus: 20,
          crushAttackBonus: 30,
          magicAttackBonus: 5,
          rangedAttackBonus: 10,
          slashDefenseBonus: 40,
          stabDefenseBonus: 35,
          crushDefenseBonus: 45,
          magicDefenseBonus: 10,
          rangedDefenseBonus: 20,
          strengthBonus: 25,
          magicDamageBonus: 5,
          rangedStrengthBonus: 10,
        },
        preferredCombatStyle: 'crush',
        armorTier: 'heavy',
        weaknesses: ['magic'],
        resistances: ['slash', 'stab', 'crush'],
      },
      swarm: {
        baseDamage: 2,
        damageMultiplier: 0.8,
        criticalChance: 0.03,
        criticalMultiplier: 1.3,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 8,
          defenseLevel: 5,
          strengthLevel: 6,
          slashAttackBonus: 8,
          stabAttackBonus: 12,
          crushAttackBonus: 4,
          magicAttackBonus: 0,
          rangedAttackBonus: 8,
          slashDefenseBonus: 2,
          stabDefenseBonus: 1,
          crushDefenseBonus: 3,
          magicDefenseBonus: 0,
          rangedDefenseBonus: 2,
          strengthBonus: 4,
          magicDamageBonus: 0,
          rangedStrengthBonus: 4,
        },
        preferredCombatStyle: 'stab',
        armorTier: 'none',
        weaknesses: ['crush', 'magic'],
        resistances: [],
      },
      thug: {
        baseDamage: 5,
        damageMultiplier: 1,
        criticalChance: 0.05,
        criticalMultiplier: 1.5,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 20,
          defenseLevel: 15,
          strengthLevel: 18,
          slashAttackBonus: 15,
          stabAttackBonus: 12,
          crushAttackBonus: 18,
          magicAttackBonus: 0,
          rangedAttackBonus: 12,
          slashDefenseBonus: 10,
          stabDefenseBonus: 8,
          crushDefenseBonus: 12,
          magicDefenseBonus: 5,
          rangedDefenseBonus: 10,
          strengthBonus: 15,
          magicDamageBonus: 0,
          rangedStrengthBonus: 8,
        },
        preferredCombatStyle: 'slash',
        armorTier: 'medium',
        weaknesses: ['stab', 'magic'],
        resistances: ['slash'],
      },
      sniper: {
        baseDamage: 8,
        damageMultiplier: 1.2,
        criticalChance: 0.15,
        criticalMultiplier: 2.0,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 30,
          defenseLevel: 12,
          strengthLevel: 25,
          slashAttackBonus: 5,
          stabAttackBonus: 8,
          crushAttackBonus: 5,
          magicAttackBonus: 15,
          rangedAttackBonus: 45,
          slashDefenseBonus: 8,
          stabDefenseBonus: 6,
          crushDefenseBonus: 8,
          magicDefenseBonus: 15,
          rangedDefenseBonus: 25,
          strengthBonus: 8,
          magicDamageBonus: 12,
          rangedStrengthBonus: 35,
        },
        preferredCombatStyle: 'ranged',
        armorTier: 'light',
        weaknesses: ['slash', 'stab', 'crush'],
        resistances: ['ranged', 'magic'],
      },
      boss: {
        baseDamage: 25,
        damageMultiplier: 2.0,
        criticalChance: 0.2,
        criticalMultiplier: 2.5,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 50,
          defenseLevel: 45,
          strengthLevel: 55,
          slashAttackBonus: 40,
          stabAttackBonus: 35,
          crushAttackBonus: 45,
          magicAttackBonus: 60,
          rangedAttackBonus: 50,
          slashDefenseBonus: 50,
          stabDefenseBonus: 45,
          crushDefenseBonus: 55,
          magicDefenseBonus: 40,
          rangedDefenseBonus: 45,
          strengthBonus: 45,
          magicDamageBonus: 50,
          rangedStrengthBonus: 40,
        },
        preferredCombatStyle: 'magic',
        armorTier: 'divine',
        weaknesses: [], // No weaknesses
        resistances: ['slash', 'stab', 'crush', 'magic', 'ranged'], // Resists everything
      },
      disruptor: {
        baseDamage: 3,
        damageMultiplier: 0.8,
        criticalChance: 0.05,
        criticalMultiplier: 1.5,
        damageType: 'projectile',
        combatStats: {
          attackLevel: 15,
          defenseLevel: 12,
          strengthLevel: 10,
          slashAttackBonus: 0,
          stabAttackBonus: 5,
          crushAttackBonus: 5,
          magicAttackBonus: 25, // Primarily a magical disruptor
          rangedAttackBonus: 5,
          slashDefenseBonus: 5,
          stabDefenseBonus: 5,
          crushDefenseBonus: 5,
          magicDefenseBonus: 20,
          rangedDefenseBonus: 8,
          strengthBonus: 0,
          magicDamageBonus: 15,
          rangedStrengthBonus: 0,
        },
        preferredCombatStyle: 'magic',
        armorTier: 'light',
        weaknesses: ['slash', 'crush'], // Physical attacks bypass its EMP field
        resistances: ['magic', 'ranged'],
      },
      sentinel: {
        baseDamage: 8,
        damageMultiplier: 1.0,
        criticalChance: 0.05,
        criticalMultiplier: 1.5,
        damageType: 'kamikaze', // Contact melee attacker (closest DamageType for physical contact)
        combatStats: {
          attackLevel: 22,
          defenseLevel: 25,
          strengthLevel: 20,
          slashAttackBonus: 10,
          stabAttackBonus: 5,
          crushAttackBonus: 15,
          magicAttackBonus: 0,
          rangedAttackBonus: 0,
          slashDefenseBonus: 20,
          stabDefenseBonus: 20,
          crushDefenseBonus: 15,
          magicDefenseBonus: 5,
          rangedDefenseBonus: 10,
          strengthBonus: 12,
          magicDamageBonus: 0,
          rangedStrengthBonus: 0,
        },
        preferredCombatStyle: 'crush',
        armorTier: 'heavy', // Shield carrier — armored but magic vulnerable
        weaknesses: ['magic'], // Shield can't block magic; flank required for physical
        resistances: ['slash', 'ranged'], // Frontal shield effective against physical
      },
    };

    return properties[enemyType] || properties['basic'];
  }

  // === ARMOR TIER SYSTEM ===

  getArmorTierProperties(tier: ArmorTier): { defenseBonus: number; magicPenalty: number; description: string } {
    const tiers = {
      none: { defenseBonus: 0, magicPenalty: 0, description: 'No armor protection' },
      light: { defenseBonus: 10, magicPenalty: 5, description: 'Light protection, mobility focused' },
      medium: { defenseBonus: 25, magicPenalty: 15, description: 'Balanced protection and mobility' },
      heavy: { defenseBonus: 50, magicPenalty: 30, description: 'Heavy protection, magic vulnerable' },
      magical: { defenseBonus: 5, magicPenalty: -20, description: 'Magic resistance, physical vulnerability' },
      divine: { defenseBonus: 100, magicPenalty: 0, description: 'Ultimate protection' },
    };

    return tiers[tier] || tiers['none'];
  }

  // === UTILITY METHODS ===

  private getCriticalHitChance(): number {
    // Get crit chance from player upgrades (set by shop purchases and abilities)
    // No base crit - only from upgrades, capped at 100%
    return Math.min(this.playerUpgrades.getCriticalHitChance(), 1.0);
  }

  private getCriticalHitMultiplier(): number {
    // Get crit multiplier from player upgrades (default 1.5x from PlayerUpgradesService)
    return this.playerUpgrades.getCriticalHitMultiplier();
  }

  // === DAMAGE TYPE EFFECTIVENESS (updated for OSRS styles) ===

  getCombatStyleEffectiveness(attackStyle: CombatStyle, enemyType: EnemyType): number {
    const enemy = this.getEnemyDamageProperties(enemyType);

    // Check for weaknesses (2x effectiveness)
    if (enemy.weaknesses.includes(attackStyle)) {
      return 2.0;
    }

    // Check for resistances (0.5x effectiveness)
    if (enemy.resistances.includes(attackStyle)) {
      return 0.5;
    }

    // Normal effectiveness
    return 1.0;
  }

  getDamageTypeEffectiveness(damageType: DamageType, enemyType: EnemyType): number {
    const effectivenessMatrix: Record<DamageType, Record<EnemyType, number>> = {
      beam: {
        basic: 1.0,
        spitter: 1.1,
        tank: 0.8,
        swarm: 1.3,
        thug: 1.0,
        sniper: 1.2,
        boss: 0.6,
        disruptor: 1.2, // Beam disrupts its EMP field — effective
        sentinel: 0.9, // Frontal shield softens beam; flanking fully effective
      },
      projectile: {
        basic: 1.0,
        spitter: 1.0,
        tank: 1.0,
        swarm: 1.0,
        thug: 1.0,
        sniper: 0.8,
        boss: 0.7,
        disruptor: 0.9,
        sentinel: 1.0,
      },
      burn: {
        basic: 1.0,
        spitter: 1.2,
        tank: 1.2,
        swarm: 1.5,
        thug: 1.0,
        sniper: 1.5,
        boss: 0.9,
        disruptor: 1.3, // Electrical components conduct heat
        sentinel: 1.1, // Armor heats up
      },
      kamikaze: {
        basic: 1.0,
        spitter: 1.0,
        tank: 1.0,
        swarm: 1.0,
        thug: 1.0,
        sniper: 1.0,
        boss: 1.0,
        disruptor: 1.0,
        sentinel: 1.0,
      },
      recoil: {
        basic: 1.0,
        spitter: 1.0,
        tank: 1.0,
        swarm: 1.0,
        thug: 1.0,
        sniper: 1.0,
        boss: 1.0,
        disruptor: 1.0,
        sentinel: 1.0,
      },
      environmental: {
        basic: 1.0,
        spitter: 1.0,
        tank: 1.0,
        swarm: 1.0,
        thug: 1.0,
        sniper: 1.0,
        boss: 1.0,
        disruptor: 1.0,
        sentinel: 1.0,
      },
    };

    return effectivenessMatrix[damageType]?.[enemyType] ?? 1.0;
  }

  // === DAMAGE LOGGING ===

  logDamageCalculation(calculation: DamageCalculation, target: string): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log(`Damage calculation for ${target}`, 'info', {
        source: 'damage_calculation_service',
        target,
        base: calculation.baseDamage,
        final: calculation.finalDamage,
        critical: calculation.isCritical,
        hit: calculation.isHit,
        hitChance: calculation.accuracyRollResult.hitChance,
        maxHit: calculation.maxHit,
        modifiers: calculation.damageModifiers.map((m) => `${m.name}: ${m.multiplier ? 'x' : '+'}${m.value}`),
      });
    }
  }
}
