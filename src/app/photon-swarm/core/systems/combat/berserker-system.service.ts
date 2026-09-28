import { Injectable } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameStateService } from '../../state/game-state.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { BuffComponent, PlayerControlledComponent } from '@photon/components';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Berserker System - Dynamically adjusts damage based on current health
 *
 * This system updates the damage multiplier in real-time for players with
 * the Berserker Protocol upgrade active. Damage scales inversely with health:
 * - At 100% health: No bonus (1.0x damage)
 * - At 50% health: 50% of max bonus
 * - At 1% health: ~100% of max bonus (up to 2.0x damage)
 */
@Injectable({ providedIn: 'root' })
export class BerserkerSystemService implements System {
  private lastHealthPercent = 1.0;
  private lastLogTime = 0;
  private LOG_INTERVAL_MS = 5000; // Log every 5 seconds max

  constructor(
    private gameState: GameStateService,
    private playerUpgrades: PlayerUpgradesService,
    private debugLog: DebugLogBridgeService
  ) {}

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    // Check if berserker protocol is active
    if (!this.playerUpgrades.hasBerserkerProtocol()) {
      return;
    }

    // Find the player entity
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    if (playerEntities.length === 0) {
      return;
    }

    const playerId = playerEntities[0];

    // Get or create buff component
    let buff = entityManager.getComponent(playerId, BuffComponent);
    if (!buff) {
      // Create buff component if it doesn't exist
      buff = new BuffComponent();
      entityManager.addComponent(playerId, buff);
    }

    // Calculate damage multiplier based on health
    const currentHealth = this.gameState.getHealth();
    const maxHealth = this.gameState.getMaxHealth();
    if (maxHealth <= 0) return;
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));

    // Get berserker configuration
    const maxBonus = this.playerUpgrades.getBerserkerMaxBonus();

    // Calculate damage bonus (inverse of health)
    // At full health: 0% bonus
    // At 0 health: maxBonus
    const bonusMultiplier = (1 - healthPercent) * maxBonus;
    const newDamageMultiplier = 1.0 + bonusMultiplier;

    // Update buff component if damage changed significantly
    const oldMultiplier = buff.damageMultiplier;
    if (Math.abs(newDamageMultiplier - oldMultiplier) > 0.01) {
      buff.damageMultiplier = newDamageMultiplier;

      // Add berserker buff flag
      if (!buff.hasBuff('berserker_protocol')) {
        buff.addBuff('berserker_protocol');
      }

      // Log significant changes or periodically
      const now = Date.now();
      const healthChanged = Math.abs(healthPercent - this.lastHealthPercent) > 0.1;
      const timeElapsed = now - this.lastLogTime > this.LOG_INTERVAL_MS;

      if (healthChanged || timeElapsed) {
        if (Math.random() < 0.2) {
          // 20% chance to log
          this.debugLog.log(
            `💀 Berserker: ${(healthPercent * 100).toFixed(0)}% HP → ${(bonusMultiplier * 100).toFixed(0)}% damage bonus`,
            'info',
            {
              source: 'berserker_system',
              operation: 'damage_update',
              healthPercent: (healthPercent * 100).toFixed(1),
              damageBonus: (bonusMultiplier * 100).toFixed(1),
              totalMultiplier: newDamageMultiplier.toFixed(2),
            }
          );
        }

        this.lastHealthPercent = healthPercent;
        this.lastLogTime = now;
      }
    }
  }

  /**
   * Get current berserker damage bonus for UI display
   */
  getCurrentBonus(): number {
    if (!this.playerUpgrades.hasBerserkerProtocol()) {
      return 0;
    }

    const currentHealth = this.gameState.getHealth();
    const maxHealth = this.gameState.getMaxHealth();
    if (maxHealth <= 0) return 0;
    const healthPercent = Math.max(0, Math.min(1, currentHealth / maxHealth));
    const maxBonus = this.playerUpgrades.getBerserkerMaxBonus();

    return (1 - healthPercent) * maxBonus;
  }

  /**
   * Reset system state (called on death/respawn)
   */
  reset(): void {
    // Berserker system doesn't maintain state between runs
    // But we add this for consistency and future expansion
  }
}
