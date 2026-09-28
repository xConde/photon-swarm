/**
 * Campaign E — Sprint E3: Combat-resolution centralization.
 *
 * This service is the single source of truth for enemy-damage resolution.
 * It owns target resistances (damageReduction + directional Sentinel shield),
 * the clamp/round write, and source-tag attribution.
 *
 * All four player-damage paths route through here. The centralization is
 * BEHAVIOR-PRESERVING — each path keeps its original resistance profile (the
 * weapon-vs-defense triangle), this service just owns the clamp/round/write:
 *  - beam-collision-system.service.ts  — beam DPS: blocked by the Sentinel
 *      directional shield; does NOT apply flat damageReduction
 *  - collision-system.service.ts       — projectile hits: apply flat
 *      damageReduction; bypass the Sentinel shield
 *  - collision-system.service.ts       — dash hits: apply flat damageReduction;
 *      bypass the Sentinel shield
 *  - burn-system.service.ts            — burn DoT (armor-piercing; only write centralized)
 *
 * Paths intentionally NOT routed here (different semantics):
 *  - npc-ability-system / npc-faction-battle-system — NPC-vs-NPC damage
 *  - environment-system claw-slam — insta-kill (no resistance applies)
 *
 * SOURCE modifiers (crit, buff, ascension) are the caller's responsibility
 * and must already be baked into rawDamage before calling this service.
 */
import { Injectable } from '@angular/core';
import { DamageSource, HealthComponent, ShieldArcComponent } from '@photon/components';

/** Directional-shield input for the resolver (Sentinel frontal block). */
export interface ShieldBlockInput {
  component: ShieldArcComponent;
  /** Radians: angle from the TARGET toward the attack source. */
  attackSourceAngle: number;
}

export interface EnemyDamageRequest {
  health: HealthComponent;
  /** Outgoing damage with all SOURCE modifiers already applied (crit/buff/ascension/etc.). */
  rawDamage: number;
  source: DamageSource;
  /** Target flat damage reduction [0..1]. Omit/undefined to skip (e.g. armor-piercing DoT). */
  damageReduction?: number;
  /** Directional shield. Omit/null to skip. */
  shield?: ShieldBlockInput | null;
}

export interface EnemyDamageResult {
  /** Health BEFORE the write — callers use it to keep showing damage numbers on killing blows. */
  previousHealth: number;
  /** Damage actually applied after target resistances. */
  appliedDamage: number;
  /** True if the directional shield blocked some damage. */
  blocked: boolean;
}

@Injectable({ providedIn: 'root' })
export class DamageResolverService {
  /**
   * Canonical enemy-damage resolution: apply TARGET resistances (damageReduction,
   * then directional shield), clamp to >=0, round to 2dp, write health, and tag
   * the damage source for death attribution. SOURCE modifiers (crit/buff/ascension)
   * are the caller's responsibility and must already be in rawDamage.
   *
   * This is the single funnel for the player's direct-attack damage to enemies
   * (beam, projectile, dash) plus burn DoT. NPC-vs-NPC and the claw-slam insta-kill
   * keep their own paths (different semantics).
   */
  applyDamageToEnemy(req: EnemyDamageRequest): EnemyDamageResult {
    let dmg = Number.isFinite(req.rawDamage) && req.rawDamage > 0 ? req.rawDamage : 0;

    if (req.damageReduction && req.damageReduction > 0) {
      dmg *= 1 - req.damageReduction;
    }

    let blocked = false;
    if (req.shield) {
      const reduction = ShieldArcComponent.getBlockReduction(req.shield.component, req.shield.attackSourceAngle);
      if (reduction > 0) {
        dmg *= 1 - reduction;
        req.shield.component.lastBlockTime = Date.now();
        blocked = true;
      }
    }

    const previousHealth = req.health.health;
    req.health.health = Math.round(Math.max(0, req.health.health - dmg) * 100) / 100;
    req.health.lastDamageSource = req.source;
    return { previousHealth, appliedDamage: dmg, blocked };
  }
}
