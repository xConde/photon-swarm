import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import {
  EnemyTypeComponent,
  FactionComponent,
  HealAuraComponent,
  HealthComponent,
  PositionComponent,
} from '@photon/components';

/**
 * HealAuraSystemService
 *
 * Runs on every ECS tick. Entities that carry a HealAuraComponent pulse every
 * intervalMs, healing nearby same-faction allies for healPercent of their
 * maxHealth within radius pixels.
 *
 * Wired to the Sentinel (Aegis Bulwark) — shield walls sustain themselves
 * while the bulwark lives. The aura stops automatically when the host dies
 * because dead hosts are filtered before the pulse gate.
 *
 * Campaign B — Sprint B3.
 *
 * NOTE (Campaign E gate, 2026-05-29): Sprint E1 had switched the ally lookup
 * to SpatialPartitioningService.queryRadius for an O(K*N)→O(K*localN) win, but
 * the software-factory verification pass found that SpatialPartitioningService
 * is never POPULATED in the game loop (the engine only calls clear()), so
 * queryRadius always returned [] and the aura silently healed nobody. The unit
 * tests passed only because they mocked the query. That change was reverted to
 * the full same-faction enemy scan below — correctness over a perf path that
 * isn't wired. Campaign B Finding 3 (O(K*N) heal-aura) is therefore RE-DEFERRED:
 * it can only be optimized once the engine actually feeds entities into a shared
 * spatial structure (see the AiBehaviorSystem.findNearbyAllies note in the audit,
 * which has the same latent empty-grid bug).
 */
@Injectable({ providedIn: 'root' })
export class HealAuraSystemService implements System {
  constructor(
    private effectFactory: EffectFactoryService,
    private debugLog: DebugLogBridgeService
  ) {}

  update(_deltaTime: number, entityManager: EntityManager): void {
    const now = Date.now();
    const hosts = entityManager.getEntitiesWithComponents(HealAuraComponent, PositionComponent, HealthComponent);

    for (const hostId of hosts) {
      const aura = entityManager.getComponent(hostId, HealAuraComponent);
      const hostPos = entityManager.getComponent(hostId, PositionComponent);
      const hostHealth = entityManager.getComponent(hostId, HealthComponent);
      if (!aura || !hostPos || !hostHealth) continue;
      if (hostHealth.isDead || hostHealth.health <= 0) continue;
      if (!aura.isReadyToPulse(now)) continue;

      aura.markPulsed(now);

      const hostFaction = entityManager.getComponent(hostId, FactionComponent);
      const hostFactionId = hostFaction?.kingId ?? 0;

      // Scan all enemies for same-faction allies in range. This is O(N) per
      // pulse (gated to every 1.5s per host), not a full-scan per frame. See
      // the class note: the spatial-grid optimization was reverted because the
      // grid is not populated in the engine.
      const allies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, HealthComponent, PositionComponent);

      let healed = 0;
      for (const allyId of allies) {
        if (allyId === hostId) continue;

        const allyHealth = entityManager.getComponent(allyId, HealthComponent);
        const allyPos = entityManager.getComponent(allyId, PositionComponent);
        if (!allyHealth || !allyPos) continue;
        if (allyHealth.isDead || allyHealth.health <= 0) continue;
        if (allyHealth.health >= allyHealth.maxHealth) continue;

        const allyFaction = entityManager.getComponent(allyId, FactionComponent);
        const allyFactionId = allyFaction?.kingId ?? 0;
        if (allyFactionId !== hostFactionId) continue;

        const dx = allyPos.x - hostPos.x;
        const dy = allyPos.y - hostPos.y;
        if (dx * dx + dy * dy > aura.radius * aura.radius) continue;

        const healAmount = allyHealth.maxHealth * aura.healPercent;
        allyHealth.health = Math.min(allyHealth.maxHealth, allyHealth.health + healAmount);
        this.effectFactory.createHealEffect(allyPos);
        healed++;
      }

      if (healed > 0) {
        if (window.debugLogBridge) {
          this.debugLog.log('Heal aura pulsed', 'info', {
            source: 'heal_aura_system',
            hostId,
            healed,
            radius: aura.radius,
          });
        }
      }
    }
  }
}
