import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { GameStateService } from '../../state/game-state.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { HealthComponent, PlayerControlledComponent } from '@photon/components';

/**
 * Health Sync System - Keeps ECS HealthComponent in sync with GameStateService
 *
 * CLEAN ARCHITECTURE:
 * - GameStateService is the authoritative source for health
 * - ECS HealthComponent is just a view/cache for rendering
 * - This system ensures ECS always reflects GameState
 * - One-way sync: GameState → ECS Component
 */
@Injectable({
  providedIn: 'root',
})
export class HealthSyncSystemService implements System {
  private syncErrorCount = 0;
  private readonly MAX_SYNC_ERRORS = 10;

  constructor(
    private gameState: GameStateService,
    private debugLog: DebugLogBridgeService
  ) {}

  update(_deltaTime: number, entityManager: EntityManager): void {
    // Find player entity
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    if (playerEntities.length === 0) return;

    const playerId = playerEntities[0];
    const healthComp = entityManager.getComponent(playerId, HealthComponent);
    if (!healthComp) return;

    // Get authoritative values from GameState
    const correctHealth = this.gameState.getHealth();
    const correctMaxHealth = this.gameState.getMaxHealth();

    // CRITICAL FIX: Skip sync when player is dead to prevent spurious damage logs
    // This prevents the sync system from trying to "correct" health values after death
    if (correctHealth <= 0 && healthComp.health <= 0) {
      // Both are zero/dead - no sync needed
      return;
    }

    // Sync ECS component to match GameState (one-way sync)
    let needsSync = false;
    const healthDiff = Math.abs(healthComp.health - correctHealth);
    const maxHealthDiff = Math.abs(healthComp.maxHealth - correctMaxHealth);

    if (healthDiff > 0.01) {
      // Only update if there's a meaningful difference
      healthComp.health = correctHealth;
      needsSync = true;
    }

    if (maxHealthDiff > 0.01) {
      healthComp.maxHealth = correctMaxHealth;
      needsSync = true;
    }

    // Log sync operations (throttled to prevent spam)
    // Only log if it's a significant sync (not tiny floating point differences)
    if (needsSync && this.syncErrorCount < this.MAX_SYNC_ERRORS && healthDiff > 1) {
      this.debugLog.log('📊 Health sync: ECS updated from GameState', 'info', {
        source: 'health_sync_system',
        operation: 'sync',
        gameStateHealth: correctHealth.toFixed(2),
        ecsHealthBefore: (healthComp.health - healthDiff).toFixed(2),
        ecsHealthAfter: correctHealth.toFixed(2),
        difference: healthDiff.toFixed(2),
        syncCount: ++this.syncErrorCount,
      });
    }
  }

  /**
   * Reset sync error counter
   * Called when starting a new game or respawning
   */
  reset(): void {
    this.syncErrorCount = 0;
    this.debugLog.log('🔄 Health sync system reset', 'info', {
      source: 'health_sync_system',
    });
  }
}
