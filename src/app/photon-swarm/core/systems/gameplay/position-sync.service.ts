import { Injectable, NgZone } from '@angular/core';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import {
  BeamComponent,
  CollisionBoxComponent,
  DischargeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  VelocityComponent,
  WeaponComponent,
} from '@photon/components';
import { MonitorPerformance } from '../../utils/performance-monitor.service';
import { PLAYER_CONFIG } from '@photon/config/game-constants';

/**
 * Position Synchronization Service
 *
 * Ensures consistency between legacy PlayerService positions and ECS PositionComponents
 * during the migration period. This service bridges the gap between the old and new systems.
 */
@Injectable({
  providedIn: 'root',
})
export class PositionSyncService {
  private lastSyncTime = 0;
  private readonly SYNC_INTERVAL_MS = 100; // Sync every 100ms (10 FPS) — legacy bridge, no need for 20/sec

  constructor(
    private entityManager: EntityManagerService,
    private playerService: PlayerService,
    private ngZone: NgZone
  ) {}

  /**
   * Synchronize player position between PlayerService and ECS
   */
  @MonitorPerformance('PositionSync.syncPlayerPosition')
  syncPlayerPosition(): void {
    const now = Date.now();

    // Throttle synchronization for performance
    if (now - this.lastSyncTime < this.SYNC_INTERVAL_MS) {
      return;
    }

    this.lastSyncTime = now;

    // Get player entity from ECS
    const playerEntities = this.entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (playerEntities.length === 0) {
      // No player entity exists in ECS, create one
      this.createPlayerEntityInECS();
      return;
    }

    const playerEntityId = playerEntities[0];
    const ecsPosition = this.entityManager.getComponent(playerEntityId, PositionComponent);

    if (!ecsPosition) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Player entity found but no position component', 'warning', {
          source: 'position_sync',
          playerEntityId,
        });
      }
      return;
    }

    // Get current position from PlayerService
    const serviceX = this.playerService.x$.value;
    const serviceY = this.playerService.y$.value;

    // Check if positions are out of sync
    const threshold = 1; // 1 pixel threshold
    const xDiff = Math.abs(ecsPosition.x - serviceX);
    const yDiff = Math.abs(ecsPosition.y - serviceY);

    if (xDiff > threshold || yDiff > threshold) {
      // Update ECS position to match PlayerService (PlayerService is authoritative during migration)
      ecsPosition.x = serviceX;
      ecsPosition.y = serviceY;
    }
  }

  /**
   * Create a complete player entity in ECS if it doesn't exist
   */
  private createPlayerEntityInECS(): void {
    const playerEntityId = this.entityManager.createEntity();

    // Get current PlayerService position
    const serviceX = this.playerService.x$.value;
    const serviceY = this.playerService.y$.value;

    // Add all required player components
    this.entityManager.addComponent(playerEntityId, new PlayerControlledComponent());
    this.entityManager.addComponent(playerEntityId, new PositionComponent(serviceX, serviceY));
    this.entityManager.addComponent(playerEntityId, new VelocityComponent(0, 0));
    this.entityManager.addComponent(playerEntityId, new HealthComponent(100, 100));
    this.entityManager.addComponent(playerEntityId, new CollisionBoxComponent(15, 'player'));
    // RenderableComponent removed - not used by any rendering system

    // Add beam weapon (also used for shift-fire projectiles)
    const beamWeapon = new WeaponComponent(
      PLAYER_CONFIG.WEAPONS.BEAM.DAMAGE,
      PLAYER_CONFIG.WEAPONS.BEAM.FIRE_RATE,
      0, // lastShotTime
      PLAYER_CONFIG.WEAPONS.BEAM.PROJECTILE_SPEED
    );
    this.entityManager.addComponent(playerEntityId, beamWeapon);

    const beam = new BeamComponent(
      0, // angle
      0, // rotationSpeed
      PLAYER_CONFIG.WEAPONS.BEAM.DAMAGE,
      PLAYER_CONFIG.WEAPONS.BEAM.LENGTH
    );
    this.entityManager.addComponent(playerEntityId, beam);

    const discharge = new DischargeComponent(
      PLAYER_CONFIG.WEAPONS.DISCHARGE.RADIUS,
      PLAYER_CONFIG.WEAPONS.DISCHARGE.DAMAGE,
      PLAYER_CONFIG.WEAPONS.DISCHARGE.COOLDOWN_MS
    );
    this.entityManager.addComponent(playerEntityId, discharge);

    // Add debug log to track player entity creation
    if (window.debugLogBridge) {
      window.debugLogBridge.log(
        `✅ ECS Player Entity Created: ID=${playerEntityId}, Health=100/100, Position=(${serviceX.toFixed(1)}, ${serviceY.toFixed(1)})`,
        'success',
        {
          entityId: playerEntityId,
          initialHealth: 100,
          maxHealth: 100,
          position: { x: serviceX, y: serviceY },
          timestamp: Date.now(),
        }
      );
    }
  }

  /**
   * Get current player position from ECS (if available)
   */
  getPlayerPositionFromECS(): { x: number; y: number } | null {
    const playerEntities = this.entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (playerEntities.length === 0) {
      return null;
    }

    const playerEntityId = playerEntities[0];
    const position = this.entityManager.getComponent(playerEntityId, PositionComponent);

    return position ? { x: position.x, y: position.y } : null;
  }

  /**
   * Get current player position from PlayerService
   */
  getPlayerPositionFromService(): { x: number; y: number } {
    return {
      x: this.playerService.x$.value,
      y: this.playerService.y$.value,
    };
  }

  /**
   * Get position comparison data for debugging
   */
  getPositionComparison(): {
    servicePosition: { x: number; y: number };
    ecsPosition: { x: number; y: number } | null;
    inSync: boolean;
    difference: { x: number; y: number } | null;
  } {
    const servicePos = this.getPlayerPositionFromService();
    const ecsPos = this.getPlayerPositionFromECS();

    if (!ecsPos) {
      return {
        servicePosition: servicePos,
        ecsPosition: null,
        inSync: false,
        difference: null,
      };
    }

    const diff = {
      x: Math.abs(servicePos.x - ecsPos.x),
      y: Math.abs(servicePos.y - ecsPos.y),
    };

    const threshold = 1;
    const inSync = diff.x <= threshold && diff.y <= threshold;

    return {
      servicePosition: servicePos,
      ecsPosition: ecsPos,
      inSync,
      difference: diff,
    };
  }

  /**
   * Force synchronization of all entity positions
   */
  forceSyncAllPositions(): void {
    // Sync player position
    this.syncPlayerPosition();

    // Note: Additional entity syncing could be added here if needed
  }

  private syncInterval: number | null = null;

  /**
   * Enable automatic position synchronization
   */
  startAutoSync(): void {
    // Prevent duplicate intervals
    if (this.syncInterval !== null) {
      return;
    }

    // Store interval reference for cleanup — outside Angular zone to avoid CD on every tick
    this.ngZone.runOutsideAngular(() => {
      this.syncInterval = window.setInterval(() => {
        this.syncPlayerPosition();
      }, this.SYNC_INTERVAL_MS);
    });
  }

  /**
   * Stop automatic position synchronization
   */
  stopAutoSync(): void {
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}
