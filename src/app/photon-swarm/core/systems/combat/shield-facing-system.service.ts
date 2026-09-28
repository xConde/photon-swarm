import { Injectable, NgZone } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { PositionComponent } from '@photon/components/position.component';
import { ShieldArcComponent } from '@photon/components/shield-arc.component';

/**
 * ShieldFacingSystemService — Updates the Sentinel's shield facing angle every frame.
 *
 * Each sentinel with a ShieldArcComponent will have its facingAngle smoothly rotated
 * to track the player position, using a lerp to prevent instant snapping.
 *
 * Registered in the combat section of SystemRegistryService, before CombatSystem.
 */
@Injectable({ providedIn: 'root' })
export class ShieldFacingSystemService implements System {
  /** Per-sentinel tracking — not actually needed for data, but kept for cleanup API consistency. */
  private readonly trackedEntities = new Set<number>();

  private static readonly LERP_FACTOR = 0.15;

  constructor(
    private entityManager: EntityManagerService,
    private playerService: PlayerService,
    private ngZone: NgZone
  ) {}

  update(_deltaTime: number): void {
    // All timer/frame work runs outside Angular's zone to avoid change-detection thrash
    this.ngZone.runOutsideAngular(() => {
      this.updateShields();
    });
  }

  private updateShields(): void {
    const entities = this.entityManager.getEntitiesWithComponents(ShieldArcComponent, PositionComponent);

    const playerPos = this.playerService.getPosition();
    if (!playerPos) return; // Guard against initialization race
    const playerX = playerPos.x;
    const playerY = playerPos.y;

    for (const entityId of entities) {
      const pos = this.entityManager.getComponent(entityId, PositionComponent);
      const shield = this.entityManager.getComponent(entityId, ShieldArcComponent);
      if (!pos || !shield) continue;

      this.trackedEntities.add(entityId);

      // Target angle: direction FROM entity TOWARD player
      const targetAngle = Math.atan2(playerY - pos.y, playerX - pos.x);

      // Lerp with shortest-path angle wrapping
      let diff = targetAngle - shield.facingAngle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      shield.facingAngle = shield.facingAngle + diff * ShieldFacingSystemService.LERP_FACTOR;
    }
  }

  /**
   * Called by DeathDetectionSystemService to remove tracking state for dead entities.
   */
  cleanupDeadEnemy(entityId: number): void {
    this.trackedEntities.delete(entityId);
  }
}
