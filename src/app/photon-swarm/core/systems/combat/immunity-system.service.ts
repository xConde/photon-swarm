import { Injectable } from '@angular/core';
import { EntityManagerService as EntityManager } from '../../ecs/entity-manager.service';
import { PlayerControlledComponent } from '@photon/components/player-controlled.component';
import { RenderableComponent } from '@photon/components/renderable.component';
import { EngineSystem } from '../../utils/system';

/**
 * Handles player immunity timing and visual feedback
 */
@EngineSystem()
@Injectable({
  providedIn: 'root',
})
export class ImmunitySystemService {
  private flashInterval = 100; // Flash every 100ms when invincible
  private lastFlashTime = 0;
  private flashState = true;

  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = Date.now();

    // Get all player-controlled entities
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);

    for (const entityId of playerEntities) {
      const playerComp = entityManager.getComponent(entityId, PlayerControlledComponent);

      if (playerComp && playerComp.isInvincible) {
        // Check if immunity has expired
        if (playerComp.invincibilityEndTime > 0 && currentTime >= playerComp.invincibilityEndTime) {
          playerComp.isInvincible = false;
          playerComp.invincibilityEndTime = 0;

          // Reset visual state
          const renderComp = entityManager.getComponent(entityId, RenderableComponent);
          if (renderComp) {
            renderComp.opacity = 1.0;
          }

          if (window.debugLogBridge) {
            window.debugLogBridge.log('🛡️ Player immunity expired', 'info', {
              source: 'immunity_system',
              operation: 'immunity_expired',
              entityId,
            });
          }
        } else {
          // Apply visual flashing effect
          this.applyInvincibilityVisuals(entityId, entityManager, currentTime);
        }
      }
    }
  }

  private applyInvincibilityVisuals(entityId: number, entityManager: EntityManager, currentTime: number): void {
    const renderComp = entityManager.getComponent(entityId, RenderableComponent);
    if (!renderComp) return;

    // Flash the player sprite
    if (currentTime - this.lastFlashTime >= this.flashInterval) {
      this.flashState = !this.flashState;
      this.lastFlashTime = currentTime;

      // Alternate between normal and semi-transparent
      renderComp.opacity = this.flashState ? 1.0 : 0.5;
    }
  }

  /**
   * Check if an entity is currently invincible
   */
  isEntityInvincible(entityId: number, entityManager: EntityManager): boolean {
    const playerComp = entityManager.getComponent(entityId, PlayerControlledComponent);
    if (!playerComp) return false;

    // Check both the flag and the expiry time
    if (playerComp.isInvincible) {
      const currentTime = Date.now();
      if (playerComp.invincibilityEndTime > 0 && currentTime >= playerComp.invincibilityEndTime) {
        // Immunity has expired, clean it up
        playerComp.isInvincible = false;
        playerComp.invincibilityEndTime = 0;
        return false;
      }
      return true;
    }

    return false;
  }
}
