import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import {
  DualChargeState,
  DualChargingComponent,
  PlayerControlledComponent,
  VelocityComponent,
} from '@photon/components';
import { PlayerService } from '../../player/player.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Dual Charging System - Manages the dual movement/focus charging mechanic
 *
 * This system properly implements the charging design:
 * - Movement charging: Accumulates while moving, fires projectiles
 * - Focus charging: Accumulates while stationary, enhances beam
 */
@Injectable({
  providedIn: 'root',
})
export class DualChargingSystemService implements System {
  private lastAutoFireCheck = new Map<number, boolean>();

  constructor(
    private playerService: PlayerService,
    private debugLog: DebugLogBridgeService
  ) {}

  init(_entityManager: EntityManager): void {
    // No initialization needed
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    // Get all entities with dual charging (don't require VelocityComponent)
    const chargingEntities = entityManager.getEntitiesWithComponents(DualChargingComponent);

    for (const entityId of chargingEntities) {
      this.updateEntityCharging(entityId, deltaTime, entityManager);
    }
  }

  private updateEntityCharging(entityId: number, deltaTime: number, entityManager: EntityManager): void {
    const dualCharging = entityManager.getComponent(entityId, DualChargingComponent);
    if (!dualCharging) return;

    // Determine movement state
    const isPlayer = entityManager.hasComponent(entityId, PlayerControlledComponent);
    let isMoving = false;

    if (isPlayer) {
      // For player, use PlayerService's authoritative movement state
      isMoving = this.playerService.isMoving();

      // Fallback: Also check velocity component as backup
      if (!isMoving) {
        const velocity = entityManager.getComponent(entityId, VelocityComponent);
        if (velocity) {
          const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
          isMoving = speed > 5;
        }
      }
    } else {
      // For other entities, check velocity
      const velocity = entityManager.getComponent(entityId, VelocityComponent);
      if (velocity) {
        const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
        isMoving = speed > 5;
      }
    }

    // Update charging state
    const chargeState = dualCharging.update(deltaTime, isMoving);

    // Sync with PlayerService for player entities
    if (isPlayer) {
      this.syncPlayerCharges(chargeState);
      this.checkAutoFire(entityId, chargeState);
    }
  }

  private syncPlayerCharges(chargeState: DualChargeState): void {
    // Convert 0-1 to 0-100 for PlayerService
    const movementPercent = chargeState.movementCharge * 100;
    const focusPercent = chargeState.focusCharge * 100;

    // Update PlayerService with proper charge values
    this.playerService.setDualCharges(movementPercent, focusPercent, chargeState.isMoving);

    // Sync fire cooldown readiness: 0ms remaining = 100%, FIRE_COOLDOWN_MS remaining = 0%
    const fireReadyPercent = (1 - chargeState.timeUntilFireReady / DualChargingComponent.FIRE_COOLDOWN_MS) * 100;
    this.playerService.setFireCooldownPercent(fireReadyPercent);
  }

  private checkAutoFire(entityId: number, chargeState: DualChargeState): void {
    const wasReadyLastFrame = this.lastAutoFireCheck.get(entityId) || false;
    const isReadyNow = chargeState.shouldAutoFire;

    // Trigger auto-fire on transition to 100% charge.
    // Only consume the transition if triggerMovementAutoFire() accepted it.
    // In beam mode, the trigger is suppressed (returns false), so we keep
    // wasReadyLastFrame=false — allowing auto-fire to re-trigger when the
    // player exits beam mode (e.g., toggles back to flight/projectile mode).
    if (!wasReadyLastFrame && isReadyNow) {
      const accepted = this.playerService.triggerMovementAutoFire();

      if (accepted) {
        this.debugLog.log('🔥 Movement Auto-Fire @ 100%', 'success', {
          source: 'dual_charging_system',
          movementCharge: chargeState.movementCharge,
          trigger: 'charge_complete',
        });
      }

      // Only mark transition as consumed if the trigger was accepted.
      // If suppressed (beam mode), keep wasReady=false so it re-fires on mode switch.
      this.lastAutoFireCheck.set(entityId, accepted ? isReadyNow : false);
      return;
    }

    this.lastAutoFireCheck.set(entityId, isReadyNow);
  }

  /**
   * Get the charge level for an entity
   */
  getChargeLevel(entityId: number, entityManager: EntityManager): number {
    const dualCharging = entityManager.getComponent(entityId, DualChargingComponent);
    return dualCharging?.getCurrentChargeLevel() ?? 0;
  }

  /**
   * Fire the movement charge for an entity
   */
  fireMovementCharge(entityId: number, entityManager: EntityManager): number {
    const dualCharging = entityManager.getComponent(entityId, DualChargingComponent);
    if (!dualCharging) return 0;

    return dualCharging.fireMovementCharge();
  }

  /**
   * Clean up tracking state for a single dead entity to prevent Map growth.
   */
  public cleanupDeadEnemy(entityId: number): void {
    this.lastAutoFireCheck.delete(entityId);
  }

  /**
   * Reset tracking state for game restart — clears per-entity Map.
   */
  reset(): void {
    this.lastAutoFireCheck.clear();
  }

  destroy(): void {
    this.lastAutoFireCheck.clear();
  }
}
