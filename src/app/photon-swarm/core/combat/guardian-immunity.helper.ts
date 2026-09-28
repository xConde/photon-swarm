import { EntityManager } from '../ecs/ecs.model';
import { TerritorialGuardianComponent } from '@photon/components';

/**
 * Single source of truth for guardian damage immunity.
 *
 * Guardians are zone progression entities, not generic combatants — any damage
 * system that iterates over "all enemies" (AOE, DoT, instant-kill) must call
 * this helper to filter them out. Used by npc-ability-system, burn-system,
 * falling-asteroid-system, npc-faction-battle-system, and enemy-health-regen-system.
 */
export function isGuardianImmune(entityId: number, entityManager: EntityManager): boolean {
  return entityManager.hasComponent(entityId, TerritorialGuardianComponent);
}
