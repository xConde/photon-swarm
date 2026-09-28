import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import {
  ArenaHazardComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
} from '@photon/components';
import { GameStateService } from '../../state/game-state.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ARENA_HAZARD } from '@photon/config/game-constants';

/**
 * ArenaHazardSystemService — Drives the telegraphed boss shockwave mechanic.
 *
 * Each ArenaHazardComponent entity goes through three phases:
 *   1. Telegraph — expanding ring VFX re-pulses on a cadence (shouldPulseTelegraph).
 *   2. Detonation — damage applied once to any in-radius, non-invincible player.
 *   3. Expiry — entity destroyed after the linger window.
 *
 * Player damage is routed through gameState.takeDamage() so death detection
 * triggers in the same frame. The ECS HealthComponent is then synced from
 * gameState.getHealth() — identical to the environment-system world-boundary
 * damage pattern.
 */
@Injectable({ providedIn: 'root' })
export class ArenaHazardSystemService implements System {
  constructor(
    private gameState: GameStateService,
    private effectFactory: EffectFactoryService,
    private debugLog: DebugLogBridgeService
  ) {}

  init(_entityManager: EntityManager): void {
    // Nothing to initialise — state is fully in the ArenaHazardComponent.
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    const now = Date.now();

    // Locate the player once per frame.
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
    const playerEntityId = playerEntities.length > 0 ? playerEntities[0] : null;
    const playerPos = playerEntityId !== null ? entityManager.getComponent(playerEntityId, PositionComponent) : null;
    const playerComp =
      playerEntityId !== null ? entityManager.getComponent(playerEntityId, PlayerControlledComponent) : null;
    const playerHealth = playerEntityId !== null ? entityManager.getComponent(playerEntityId, HealthComponent) : null;

    // Process all active hazards.
    const hazardEntities = entityManager.getEntitiesWithComponents(ArenaHazardComponent, PositionComponent);

    for (const entityId of hazardEntities) {
      const hazard = entityManager.getComponent(entityId, ArenaHazardComponent);
      const pos = entityManager.getComponent(entityId, PositionComponent);
      if (!hazard || !pos) continue;

      // Phase 1 — re-pulse the expanding-ring telegraph on a cadence for the
      // whole telegraph window. The ring VFX is only ~300ms, so a single fire
      // would leave the danger zone invisible at detonation time (red-team
      // Finding 1). Re-pulsing keeps the zone continuously visible.
      if (hazard.shouldPulseTelegraph(now, ARENA_HAZARD.PULSE_CADENCE_MS)) {
        this.effectFactory.createEmpPulseEffect({ x: pos.x, y: pos.y }, hazard.radius);
        hazard.markTelegraphPulsed(now);
      }

      // Phase 2 — detonation moment.
      if (hazard.isDetonationMoment(now)) {
        hazard.detonated = true;

        // Explosion VFX — reuse createEnemyExplosion; intensity scales with radius.
        this.effectFactory.createEnemyExplosion({ x: pos.x, y: pos.y }, hazard.radius / 100);

        // Damage the player if they are inside the radius and not invincible.
        if (playerPos && playerComp) {
          const dx = playerPos.x - pos.x;
          const dy = playerPos.y - pos.y;
          const distSq = dx * dx + dy * dy;
          const radiusSq = hazard.radius * hazard.radius;

          const isInvincible =
            playerComp.isInvincible && (playerComp.invincibilityEndTime === 0 || now < playerComp.invincibilityEndTime);

          if (distSq <= radiusSq && !isInvincible) {
            // Route through gameState.takeDamage for death detection.
            this.gameState.takeDamage(hazard.damage, 'arena_hazard');

            // Sync the ECS health component so HUD/rendering sees the update.
            if (playerHealth) {
              playerHealth.health = this.gameState.getHealth();
            }

            this.debugLog.log('Arena hazard detonation hit player', 'warning', {
              source: 'arena_hazard_system',
              entityId,
              archetype: hazard.archetype,
              damage: hazard.damage,
              playerPos: { x: playerPos.x, y: playerPos.y },
              hazardPos: { x: pos.x, y: pos.y },
              radius: hazard.radius,
            });
          }
        }
      }

      // Phase 3 — expiry: destroy the entity once the linger window closes.
      if (hazard.isExpired(now)) {
        entityManager.destroyEntity(entityId);
      }
    }
  }
}
