import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { isGuardianImmune } from '../../combat/guardian-immunity.helper';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { SettingsService } from '../../utils/settings.service';
import {
  EnemyTypeComponent,
  FloatingTextComponent,
  HealthBarDisplayComponent,
  HealthComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';

/**
 * Enemy Health Regeneration System
 *
 * Tracks enemy health changes and creates green healing numbers
 * when enemies regenerate health (from buffs, territory effects, etc.)
 * Also extends health bar visibility when healing occurs.
 */
@Injectable({
  providedIn: 'root',
})
export class EnemyHealthRegenSystemService implements System {
  // Track last known health for each enemy
  private lastHealthMap = new Map<number, number>();

  // Track when we last showed a heal number for each enemy
  private lastHealNumberTime = new Map<number, number>();
  private readonly HEAL_NUMBER_COOLDOWN = 500; // Show at most every 500ms per enemy

  // Accumulate healing for smooth display
  private accumulatedHealing = new Map<number, number>();
  // Reusable Set for cleanup validity checks (avoids per-call allocation)
  private reusableCleanupSet = new Set<number>();

  // Safety flag to disable system if corruption detected
  private systemDisabled = false;
  private corruptionDetected = 0;

  constructor(
    private entityManagerService: EntityManagerService,
    private debugLog: DebugLogBridgeService,
    private settings: SettingsService
  ) {}

  update(_deltaTime: number, entityManager: EntityManager): void {
    // Safety check - disable system if too much corruption detected
    if (this.systemDisabled) {
      return;
    }

    // Get all enemies with health
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, HealthComponent);

    const currentTime = Date.now();

    for (const enemyId of enemies) {
      const health = entityManager.getComponent(enemyId, HealthComponent);
      if (!health) continue;

      // Guardians skip regen tracking — the post-createEnemy health multiplier
      // would otherwise register as a phantom heal on the first tick.
      if (isGuardianImmune(enemyId, entityManager)) {
        this.lastHealthMap.set(enemyId, health.health);
        continue;
      }

      // Validate health values to prevent corruption
      if (
        !isFinite(health.health) ||
        !isFinite(health.maxHealth) ||
        health.health < 0 ||
        health.maxHealth <= 0 ||
        health.health > 15000 ||
        health.maxHealth > 15000
      ) {
        // Skip corrupted health values and clean up tracking
        this.lastHealthMap.delete(enemyId);
        this.lastHealNumberTime.delete(enemyId);
        this.accumulatedHealing.delete(enemyId);

        // Track corruption and disable system if too many errors
        this.corruptionDetected++;
        if (this.corruptionDetected > 5) {
          this.systemDisabled = true;
          this.debugLog.log('❌ Enemy health regen system DISABLED due to corruption', 'error', {
            source: 'enemy_health_regen',
            corruptionCount: this.corruptionDetected,
            enemyId: enemyId,
            health: health.health,
            maxHealth: health.maxHealth,
          });
        }
        continue;
      }

      // Get last known health
      const lastHealth = this.lastHealthMap.get(enemyId);

      // Suppress healing detection during spawn — silently update tracking
      const regenRenderable = entityManager.getComponent(enemyId, RenderableComponent);
      if (regenRenderable && !regenRenderable.isCombatReady(currentTime)) {
        this.lastHealthMap.set(enemyId, health.health);
        continue;
      }

      if (lastHealth !== undefined && isFinite(lastHealth)) {
        const healthDiff = health.health - lastHealth;

        // Check if enemy healed (positive diff) - cap at reasonable amount
        if (healthDiff > 0.01 && healthDiff < health.maxHealth) {
          // Small threshold to avoid floating point issues
          // Accumulate healing
          const currentAccumulated = this.accumulatedHealing.get(enemyId) || 0;
          this.accumulatedHealing.set(enemyId, currentAccumulated + healthDiff);

          // Update health bar display to show it longer
          let healthBarDisplay = entityManager.getComponent(enemyId, HealthBarDisplayComponent);
          if (!healthBarDisplay) {
            healthBarDisplay = new HealthBarDisplayComponent();
            entityManager.addComponent(enemyId, healthBarDisplay);
          }
          healthBarDisplay.markHealing(healthDiff);

          // Create green healing number (throttled)
          const lastNumberTime = this.lastHealNumberTime.get(enemyId) || 0;
          if (
            currentTime - lastNumberTime > this.HEAL_NUMBER_COOLDOWN &&
            this.settings.getSettings().showDamageNumbers
          ) {
            const totalHealing = this.accumulatedHealing.get(enemyId) || 0;

            // Only show if significant healing (cap at reasonable amount)
            if (totalHealing >= 1 && totalHealing <= 100) {
              const position = entityManager.getComponent(enemyId, PositionComponent);
              if (position) {
                // Create green healing number (cap display at max health)
                const displayAmount = Math.min(Math.round(totalHealing), health.maxHealth);
                this.createHealingNumber({ x: position.x, y: position.y - 30 }, displayAmount);

                // Reset accumulator
                this.accumulatedHealing.set(enemyId, 0);
                this.lastHealNumberTime.set(enemyId, currentTime);
              }
            }
          }
        }
      }

      // Update last known health - only if it's a valid value
      if (isFinite(health.health) && health.health >= 0 && health.health <= health.maxHealth) {
        this.lastHealthMap.set(enemyId, health.health);
      }
    }

    // Clean up map for destroyed entities
    if (this.lastHealthMap.size > enemies.length * 1.5) {
      this.reusableCleanupSet.clear();
      for (const e of enemies) this.reusableCleanupSet.add(e);
      const validEntities = this.reusableCleanupSet;
      for (const [entityId] of this.lastHealthMap) {
        if (!validEntities.has(entityId)) {
          this.lastHealthMap.delete(entityId);
          this.lastHealNumberTime.delete(entityId);
          this.accumulatedHealing.delete(entityId);
        }
      }
    }
  }

  /**
   * Create a green healing number effect
   */
  private createHealingNumber(position: { x: number; y: number }, amount: number): void {
    // Create a floating text entity for healing numbers
    const entity = this.entityManagerService.createEntity();

    // Add position
    this.entityManagerService.addComponent(entity, new PositionComponent(position.x, position.y));

    // Add upward velocity for floating effect
    this.entityManagerService.addComponent(
      entity,
      new VelocityComponent(
        (Math.random() - 0.5) * 10, // Slight horizontal spread
        -40 // Float upward slower than damage numbers
      )
    );

    // Add floating text component with green color for healing
    const text = `+${Math.round(amount)}`;
    const textColor = '#00ff88'; // Bright green for healing
    const fontSize = 18;

    this.entityManagerService.addComponent(
      entity,
      new FloatingTextComponent(
        text,
        textColor,
        fontSize,
        1200 // Duration in ms (slightly longer than damage numbers)
      )
    );
  }

  /**
   * Clear health regen tracking for a dead enemy.
   * Called on death so pooled entity IDs don't carry stale health snapshots.
   */
  cleanupDeadEnemy(entityId: number): void {
    this.lastHealthMap.delete(entityId);
    this.lastHealNumberTime.delete(entityId);
    this.accumulatedHealing.delete(entityId);
  }

  /**
   * Pre-seed health tracking for a newly created (or recycled) enemy.
   * Prevents the first-frame delta from being treated as a heal.
   */
  initializeTracking(entityId: number, initialHealth: number): void {
    this.lastHealthMap.set(entityId, initialHealth);
    this.accumulatedHealing.set(entityId, 0);
  }

  /**
   * Reset the system (for new game or level)
   */
  reset(): void {
    this.lastHealthMap.clear();
    this.lastHealNumberTime.clear();
    this.accumulatedHealing.clear();
    this.systemDisabled = false;
    this.corruptionDetected = 0;

    this.debugLog.log('🔄 Enemy health regen system reset', 'info', {
      source: 'enemy_health_regen',
    });
  }
}
