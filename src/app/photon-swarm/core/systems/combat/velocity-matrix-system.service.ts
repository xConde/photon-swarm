import { Injectable } from '@angular/core';
import { Subscription } from 'rxjs';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { CombatEvent, CombatSystemService } from '../combat';
import { BuffComponent, PlayerControlledComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Velocity Matrix System - Creates a feedback loop between speed and damage
 *
 * This system implements the Velocity Matrix upgrade which creates synergy between:
 * - Kills boost movement speed temporarily (5% per kill, stacks up to 50%)
 * - Movement boosts damage (based on current velocity)
 *
 * Creates an aggressive playstyle where constant movement and killing maintains both bonuses.
 */
@Injectable({ providedIn: 'root' })
export class VelocityMatrixSystemService implements System {
  // Configuration
  private readonly MAX_SPEED_STACKS = 10; // Max 50% speed bonus
  private readonly SPEED_BONUS_PER_KILL = 0.05; // 5% speed per kill
  private readonly SPEED_BONUS_DURATION = 3000; // 3 seconds per stack
  private readonly DAMAGE_PER_VELOCITY = 0.001; // 0.1% damage per 10 units/s of speed
  private readonly MAX_DAMAGE_BONUS = 1.0; // Max 100% damage bonus from speed

  // State tracking
  private speedStacks: Array<{ expiresAt: number }> = [];
  private currentSpeedBonus = 0;
  private currentDamageBonus = 0;
  private velocityHistory: number[] = [];
  private readonly VELOCITY_HISTORY_SIZE = 10; // Smooth over 10 frames

  // Cache entity manager for player ID lookup
  private cachedEntityManager?: EntityManagerService;
  private cachedPlayerId = 0;

  // Logging control
  private lastLogTime = 0;
  private readonly LOG_INTERVAL = 2000; // Log every 2 seconds max

  // Subscription management
  private combatSubscription?: Subscription;

  constructor(
    private playerUpgrades: PlayerUpgradesService,
    private combatSystem: CombatSystemService,
    private debugLog: DebugLogBridgeService
  ) {
    // Initialize combat subscription
    this.initCombatSubscription();
  }

  /**
   * Initialize combat event subscription
   * Called from constructor and after reset to ensure subscriptions remain active
   */
  private initCombatSubscription(): void {
    // Subscribe to kill events to trigger speed bonuses
    this.combatSubscription = this.combatSystem.combat$.subscribe((event: CombatEvent) => {
      if (event.isKill && event.attackerId === this.getPlayerId()) {
        this.onPlayerKill();
      }
    });
  }

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    // Cache entity manager for player ID lookup
    this.cachedEntityManager = entityManager;

    // Check if Velocity Matrix is active
    if (!this.playerUpgrades.hasVelocityMatrix()) {
      return;
    }

    // Find the player entity
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    if (playerEntities.length === 0) {
      return;
    }

    const playerId = playerEntities[0];
    this.cachedPlayerId = playerId; // Cache for combat event handler

    // Update speed bonus from kills
    this.updateSpeedBonus(playerId, entityManager);

    // Update damage bonus from movement
    this.updateDamageBonus(playerId, entityManager);

    // Log status periodically
    this.logStatus();
  }

  /**
   * Called when player gets a kill
   */
  private onPlayerKill(): void {
    if (!this.playerUpgrades.hasVelocityMatrix()) {
      return;
    }

    // Add a new speed stack
    const expiresAt = Date.now() + this.SPEED_BONUS_DURATION;
    this.speedStacks.push({ expiresAt });

    // Cap at maximum stacks
    if (this.speedStacks.length > this.MAX_SPEED_STACKS) {
      this.speedStacks.shift(); // Remove oldest
    }

    // Log kill bonus
    if (Math.random() < 0.3) {
      // 30% chance to log
      this.debugLog.log(`⚡ Velocity Matrix: Kill → +${(this.SPEED_BONUS_PER_KILL * 100).toFixed(0)}% speed`, 'info', {
        source: 'velocity_matrix_system',
        operation: 'kill_bonus',
        stacks: this.speedStacks.length,
        totalSpeedBonus: `${(this.speedStacks.length * this.SPEED_BONUS_PER_KILL * 100).toFixed(0)}%`,
        duration: `${this.SPEED_BONUS_DURATION / 1000}s`,
      });
    }
  }

  /**
   * Update speed bonus based on active kill stacks
   */
  private updateSpeedBonus(playerId: number, entityManager: EntityManagerService): void {
    const now = Date.now();

    // Remove expired stacks
    this.speedStacks = this.speedStacks.filter((stack) => stack.expiresAt > now);

    // Calculate total speed bonus
    const newSpeedBonus = this.speedStacks.length * this.SPEED_BONUS_PER_KILL;

    // Apply speed bonus to player's velocity component if changed
    if (Math.abs(newSpeedBonus - this.currentSpeedBonus) > 0.01) {
      const velocity = entityManager.getComponent(playerId, VelocityComponent);
      if (velocity) {
        // Adjust speed multiplier
        const multiplier = 1 + newSpeedBonus;

        // Get or create buff component
        let buff = entityManager.getComponent(playerId, BuffComponent);
        if (!buff) {
          buff = new BuffComponent();
          entityManager.addComponent(playerId, buff);
        }

        // Update speed multiplier in buff
        buff.speedMultiplier = multiplier;

        // Add velocity matrix buff flag
        if (!buff.hasBuff('velocity_matrix')) {
          buff.addBuff('velocity_matrix');
        }

        this.currentSpeedBonus = newSpeedBonus;
      }
    }
  }

  /**
   * Update damage bonus based on current movement speed
   */
  private updateDamageBonus(playerId: number, entityManager: EntityManagerService): void {
    const position = entityManager.getComponent(playerId, PositionComponent);
    const velocity = entityManager.getComponent(playerId, VelocityComponent);

    if (!position || !velocity) {
      return;
    }

    // Calculate actual velocity magnitude
    const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);

    // Add to velocity history for smoothing
    this.velocityHistory.push(speed);
    if (this.velocityHistory.length > this.VELOCITY_HISTORY_SIZE) {
      this.velocityHistory.shift();
    }

    // Calculate average velocity
    const avgSpeed = this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length;

    // Calculate damage bonus based on speed
    const damageBonus = Math.min(avgSpeed * this.DAMAGE_PER_VELOCITY, this.MAX_DAMAGE_BONUS);

    // Apply damage bonus if changed significantly
    if (Math.abs(damageBonus - this.currentDamageBonus) > 0.01) {
      // Get or create buff component
      let buff = entityManager.getComponent(playerId, BuffComponent);
      if (!buff) {
        buff = new BuffComponent();
        entityManager.addComponent(playerId, buff);
      }

      // Stack with other damage multipliers (multiplicative)
      const baseMultiplier = buff.damageMultiplier / (1 + this.currentDamageBonus); // Remove old bonus
      buff.damageMultiplier = baseMultiplier * (1 + damageBonus); // Apply new bonus

      this.currentDamageBonus = damageBonus;

      // Log significant changes
      if (Math.abs(damageBonus - this.currentDamageBonus) > 0.1) {
        if (Math.random() < 0.2) {
          // 20% chance
          this.debugLog.log(`🌀 Velocity Matrix: Speed → +${(damageBonus * 100).toFixed(0)}% damage`, 'info', {
            source: 'velocity_matrix_system',
            operation: 'speed_to_damage',
            currentSpeed: avgSpeed.toFixed(0),
            damageBonus: `${(damageBonus * 100).toFixed(0)}%`,
          });
        }
      }
    }
  }

  /**
   * Log current velocity matrix status
   */
  private logStatus(): void {
    const now = Date.now();
    if (now - this.lastLogTime < this.LOG_INTERVAL) {
      return;
    }

    if (this.speedStacks.length > 0 || this.currentDamageBonus > 0.1) {
      this.debugLog.log(`🌀 Velocity Matrix Status`, 'info', {
        source: 'velocity_matrix_system',
        operation: 'status',
        speedStacks: this.speedStacks.length,
        speedBonus: `${(this.currentSpeedBonus * 100).toFixed(0)}%`,
        damageBonus: `${(this.currentDamageBonus * 100).toFixed(0)}%`,
        synergy: 'active',
      });
      this.lastLogTime = now;
    }
  }

  /**
   * Get current bonuses for UI display
   */
  getCurrentBonuses(): { speedBonus: number; damageBonus: number; stacks: number } {
    return {
      speedBonus: this.currentSpeedBonus,
      damageBonus: this.currentDamageBonus,
      stacks: this.speedStacks.length,
    };
  }

  /**
   * Get player entity ID (helper method)
   */
  private getPlayerId(): number {
    // First try cached ID
    if (this.cachedPlayerId !== 0) {
      return this.cachedPlayerId;
    }

    // Fallback to searching via entity manager
    if (this.cachedEntityManager) {
      const playerEntities = this.cachedEntityManager.getEntitiesWithComponents(PlayerControlledComponent);
      if (playerEntities.length > 0) {
        this.cachedPlayerId = playerEntities[0];
        return this.cachedPlayerId;
      }
    }

    return 0;
  }

  /**
   * Reset all bonuses (called on death/respawn)
   */
  reset(): void {
    // Unsubscribe from combat events to prevent memory leak
    if (this.combatSubscription) {
      this.combatSubscription.unsubscribe();
      this.combatSubscription = undefined;
    }

    this.speedStacks = [];
    this.currentSpeedBonus = 0;
    this.currentDamageBonus = 0;
    this.velocityHistory = [];
    this.cachedPlayerId = 0;
    this.cachedEntityManager = undefined;

    // Re-subscribe to combat events after reset
    this.initCombatSubscription();
  }
}
