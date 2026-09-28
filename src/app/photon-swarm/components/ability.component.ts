import { Component } from '../core/ecs/ecs.model';

export enum AbilityType {
  // Boss Kraken abilities
  AREA_BUFF = 'area_buff',
  AREA_HEAL = 'area_heal',
  SHIELD_GENERATION = 'shield_generation',
  TENTACLE_GRAB = 'tentacle_grab',

  // Enemy abilities
  POISON_CLOUD = 'poison_cloud',
  BURST_FIRE = 'burst_fire',
  SHELL_RETREAT = 'shell_retreat',
  CHARGE_ATTACK = 'charge_attack',
  CLAW_SLAM = 'claw_slam',
  ENRAGE = 'enrage',
  LURE_STUN = 'lure_stun',
  PREDICTION_SHOT = 'prediction_shot',
  SUMMON_MINIONS = 'summon_minions',
  TELEPORT_BLINK = 'teleport_blink',

  // Champion abilities
  RALLY_CRY = 'rally_cry',
  VOLLEY = 'volley',
  ACID_POOL = 'acid_pool',
  EARTHQUAKE = 'earthquake',
  IRON_SKIN = 'iron_skin',
  HIVE_MIND = 'hive_mind',
  FRENZY_AURA = 'frenzy_aura',
  GROUND_SLAM = 'ground_slam',
  BLOOD_RAGE = 'blood_rage',
  PIERCING_SHOT = 'piercing_shot',
  CLOAKING = 'cloaking',
}

export interface Ability {
  type: AbilityType;
  cooldownMs: number;
  lastUsedTime: number;
  range?: number;
  damage?: number;
  duration?: number;
  strength?: number; // For buffs/heals
  isActive?: boolean;
  activeUntil?: number;
}

/**
 * Component for entities that can use special abilities
 */
export class AbilityComponent implements Component {
  public readonly name = 'AbilityComponent';
  public abilities: Ability[] = [];
  public currentAbilityIndex = 0;
  public nextAbilityTime = 0;

  constructor(..._args: unknown[]) {
    // Abilities should be set after construction
    // ECS-compatible constructor - accepts unknown args for ComponentType<T> compatibility
  }

  canUseAbility(abilityType: AbilityType, currentTime: number): boolean {
    const ability = this.abilities.find((a) => a.type === abilityType);
    if (!ability) return false;

    return currentTime >= ability.lastUsedTime + ability.cooldownMs;
  }

  useAbility(abilityType: AbilityType, currentTime: number): boolean {
    const ability = this.abilities.find((a) => a.type === abilityType);
    if (!ability || !this.canUseAbility(abilityType, currentTime)) {
      return false;
    }

    ability.lastUsedTime = currentTime;
    if (ability.duration) {
      ability.isActive = true;
      ability.activeUntil = currentTime + ability.duration;
    }

    return true;
  }

  getNextAbility(): Ability | null {
    if (this.abilities.length === 0) return null;

    // Rotate through abilities
    const ability = this.abilities[this.currentAbilityIndex];
    this.currentAbilityIndex = (this.currentAbilityIndex + 1) % this.abilities.length;

    return ability;
  }

  hasActiveAbility(abilityType: AbilityType, currentTime: number): boolean {
    const ability = this.abilities.find((a) => a.type === abilityType);
    if (!ability || !ability.isActive) return false;

    if (ability.activeUntil && currentTime >= ability.activeUntil) {
      ability.isActive = false;
      return false;
    }

    return true;
  }
}
