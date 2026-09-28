import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EmpPulseComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';
import { DualChargingComponent } from '@photon/components/dual-charging.component';
import { PlayerService } from '../../player/player.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';

/**
 * EmpPulseSystemService — Processes Disruptor EMP pulse mechanics.
 *
 * Each enemy with EmpPulseComponent fires a pulse every `cooldown` ms.
 * On player hit within `radius`: applies slow, drains beam charge, spawns VFX.
 *
 * Map cleanup is wired through DeathDetectionSystem via cleanupDeadEnemy().
 */
@Injectable({ providedIn: 'root' })
export class EmpPulseSystemService implements System {
  // Tracks last evaluated pulse time per entity (mirrors EmpPulseComponent.lastPulseTime but
  // is held here to avoid dirtying the component on every frame tick).
  private pulseTimers = new Map<number, number>();

  constructor(
    private playerService: PlayerService,
    private effectFactory: EffectFactoryService
  ) {}

  init(_entityManager: EntityManagerService): void {
    // Nothing to initialise
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    const now = Date.now();

    // Find player entity position once per frame
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
    if (playerEntities.length === 0) return;

    const playerEntityId = playerEntities[0];
    const playerPos = entityManager.getComponent(playerEntityId, PositionComponent);
    if (!playerPos) return;

    // Process all entities with an EmpPulseComponent
    const pulsers = entityManager.getEntitiesWithComponents(EmpPulseComponent, PositionComponent);

    for (const entityId of pulsers) {
      const emp = entityManager.getComponent(entityId, EmpPulseComponent);
      const pos = entityManager.getComponent(entityId, PositionComponent);
      if (!emp || !pos) continue;

      // Check cooldown using the component's own lastPulseTime
      if (now - emp.lastPulseTime < emp.cooldown) continue;

      // Cooldown elapsed — fire the pulse
      emp.lastPulseTime = now;
      this.pulseTimers.set(entityId, now);

      // Distance check
      const dx = playerPos.x - pos.x;
      const dy = playerPos.y - pos.y;
      const distSq = dx * dx + dy * dy;
      const radiusSq = emp.radius * emp.radius;

      if (window.debugLogBridge) {
        window.debugLogBridge.log('EMP Pulse fired', 'info', {
          source: 'emp_pulse_system',
          entityId,
          pulsePos: { x: pos.x, y: pos.y },
          playerPos: { x: playerPos.x, y: playerPos.y },
          distSq,
          radiusSq,
          playerHit: distSq <= radiusSq,
        });
      }

      // Create expanding ring VFX regardless of player hit
      this.spawnEmpRingEffect(pos.x, pos.y, emp.radius);

      if (distSq > radiusSq) continue;

      // Player is in range — apply slow
      this.playerService.applySlow(emp.slowFactor, emp.slowDuration);

      // Drain beam charge from the player's DualChargingComponent.
      // consumeFocusCharge drains from the focus bucket (stationary charge).
      // Movement charge is drained by consuming the same proportion from focus
      // (DualChargingComponent carries over between states, so this effectively
      // drains the shared charging resource pool).
      const dualCharging = entityManager.getComponent(playerEntityId, DualChargingComponent);
      if (dualCharging) {
        // Drain both charge types by emp.chargeDrain (0-1 fraction)
        dualCharging.consumeFocusCharge(emp.chargeDrain);
      }

      if (window.debugLogBridge) {
        window.debugLogBridge.log('EMP Pulse HIT player', 'warning', {
          source: 'emp_pulse_system',
          entityId,
          slowFactor: emp.slowFactor,
          slowDuration: emp.slowDuration,
          chargeDrain: emp.chargeDrain,
        });
      }
    }
  }

  /**
   * Spawn an expanding ring VFX at (x, y) with the given radius.
   * Uses particle burst in a ring pattern — NO per-frame gradient, NO shadowBlur.
   */
  private spawnEmpRingEffect(x: number, y: number, radius: number): void {
    // Use the discharge wave as a close analogue (expanding ring shape).
    // The discharge wave expands from 0 → radius over 300ms.
    // We pass a purple-tinted effect via the existing VFX pipeline.
    // The factory creates an entity tracked by the ECS — no allocation in hot path here.
    this.effectFactory.createEmpPulseEffect({ x, y }, radius);
  }

  /**
   * Remove tracking for a dead enemy. Called by DeathDetectionSystem.
   */
  cleanupDeadEnemy(entityId: number): void {
    this.pulseTimers.delete(entityId);
  }
}
