import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import {
  InvincibilityComponent,
  PositionComponent,
  RenderableComponent,
  TeleportEffectComponent,
} from '@photon/components';

/**
 * TeleportSystemService
 *
 * Runs every ECS tick. For any entity carrying a TeleportEffectComponent,
 * it waits until the blink duration elapses then:
 *   1. Snaps the entity's position to (targetX, targetY)
 *   2. Restores RenderableComponent.opacity to originalOpacity
 *   3. Removes InvincibilityComponent (blink window is over)
 *   4. Removes TeleportEffectComponent (marks arrived = true to prevent re-entry)
 *
 * Ordering: registered AFTER NpcAbilitySystemService so that the ability
 * creates the component on one tick and this system resolves it on a
 * subsequent tick once the duration has elapsed.
 *
 * Campaign B — Sprint B4.
 */
@Injectable({ providedIn: 'root' })
export class TeleportSystemService implements System {
  constructor(
    private debugLog: DebugLogBridgeService,
    private effectFactory: EffectFactoryService
  ) {}

  update(_deltaTime: number, entityManager: EntityManager): void {
    const hosts = entityManager.getEntitiesWithComponents(TeleportEffectComponent, PositionComponent);

    for (const id of hosts) {
      const tp = entityManager.getComponent(id, TeleportEffectComponent);
      const pos = entityManager.getComponent(id, PositionComponent);
      if (!tp || !pos) continue;

      if (!tp.arrived && tp.isComplete()) {
        pos.x = tp.targetX;
        pos.y = tp.targetY;

        const renderable = entityManager.getComponent(id, RenderableComponent);
        if (renderable) renderable.opacity = tp.originalOpacity;

        entityManager.removeComponent(id, InvincibilityComponent);
        entityManager.removeComponent(id, TeleportEffectComponent);
        tp.arrived = true;

        // Arrival burst — beam impact at the landing position
        this.effectFactory.createBeamImpact({ x: tp.targetX, y: tp.targetY }, 15);

        this.debugLog.log('NPC teleport arrived', 'info', {
          source: 'teleport_system',
          entityId: id,
          x: pos.x,
          y: pos.y,
        });
      }
    }
  }
}
