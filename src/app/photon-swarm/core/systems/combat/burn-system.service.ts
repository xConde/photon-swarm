import { inject, Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { isGuardianImmune } from '../../combat/guardian-immunity.helper';
import { BurnEffectComponent, HealthComponent, PositionComponent, RenderableComponent } from '@photon/components';
import { UPGRADE_EFFECTS } from '@photon/config/game-constants';
import { SettingsService } from '../../utils/settings.service';
import { DamageResolverService } from '../../combat/damage-resolver.service';

export interface BurnUpgradeTransactionSnapshot {
  spreadEnabled: boolean;
  spreadChance: number;
}

/**
 * Burn System - Processes burn damage over time
 *
 * This system handles entities with BurnEffectComponent,
 * applying damage over time and managing burn visual effects.
 * Supports burn spread: burning enemies can ignite nearby enemies.
 */
@Injectable({
  providedIn: 'root',
})
export class BurnSystemService implements System {
  private readonly settings = inject(SettingsService);
  private readonly BURN_TICK_INTERVAL = 250; // Damage every 250ms
  private spreadEnabled = false;
  private spreadChance = UPGRADE_EFFECTS.BURN_SPREAD.CHANCE_PER_TICK;
  private lastBurnNumberTime = new Map<number, number>();
  private accumulatedBurnDamage = new Map<number, number>();

  constructor(
    private debugLog: DebugLogBridgeService,
    private effectFactory: EffectFactoryService,
    private damageResolver: DamageResolverService
  ) {}

  /**
   * Enable burn spread mechanic (called via GameEngine upgrade path)
   */
  enableBurnSpread(): void {
    this.spreadEnabled = true;
  }

  /**
   * Set the per-tick spread chance (0-1)
   */
  setBurnSpreadChance(chance: number): void {
    this.spreadChance = Math.max(0, Math.min(1, chance));
  }

  captureUpgradeTransaction(): BurnUpgradeTransactionSnapshot {
    return {
      spreadEnabled: this.spreadEnabled,
      spreadChance: this.spreadChance,
    };
  }

  restoreUpgradeTransaction(snapshot: BurnUpgradeTransactionSnapshot): void {
    this.spreadEnabled = snapshot.spreadEnabled;
    this.spreadChance = snapshot.spreadChance;
  }

  /**
   * Check if burn spread is currently enabled
   */
  isBurnSpreadEnabled(): boolean {
    return this.spreadEnabled;
  }

  /**
   * Clean up tracking Maps for a dead entity.
   * Called by death-detection to prevent leaks when entities die from non-burn damage while burning.
   */
  cleanupDeadEnemy(entityId: number): void {
    this.lastBurnNumberTime.delete(entityId);
    this.accumulatedBurnDamage.delete(entityId);
  }

  /**
   * Reset burn system state (called on game restart/death)
   */
  reset(): void {
    this.spreadEnabled = false;
    this.spreadChance = UPGRADE_EFFECTS.BURN_SPREAD.CHANCE_PER_TICK;
    this.lastBurnNumberTime.clear();
    this.accumulatedBurnDamage.clear();
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = Date.now();

    // Get all entities with burn effects
    const burningEntities = entityManager.getEntitiesWithComponents(BurnEffectComponent);

    for (const entityId of burningEntities) {
      const burnEffect = entityManager.getComponent(entityId, BurnEffectComponent);
      const health = entityManager.getComponent(entityId, HealthComponent);

      if (!burnEffect || !health) continue;

      // Check if burn has expired
      if (burnEffect.isExpired(currentTime)) {
        // Remove burn effect
        entityManager.removeComponent(entityId, BurnEffectComponent);

        // Remove burn visual by resetting glow
        const renderable = entityManager.getComponent(entityId, RenderableComponent);
        if (renderable && renderable.glowIntensity > 0) {
          renderable.glowIntensity = 0;
        }

        // Clean up throttle maps for this entity
        this.lastBurnNumberTime.delete(entityId);
        this.accumulatedBurnDamage.delete(entityId);

        continue;
      }

      // Check if it's time for next damage tick
      if (currentTime - burnEffect.lastBurnTick >= this.BURN_TICK_INTERVAL) {
        // Skip burn damage tick if enemy is not yet combat-ready (spawning)
        const spawnRenderable = entityManager.getComponent(entityId, RenderableComponent);
        if (spawnRenderable && !spawnRenderable.isCombatReady(currentTime)) {
          continue;
        }

        burnEffect.lastBurnTick = currentTime;

        // Apply burn damage — armor-piercing DoT: no damageReduction or shield.
        // Only the write is centralized (clamp + round + source tag).
        const damage = burnEffect.burnDamage;
        this.damageResolver.applyDamageToEnemy({ health, rawDamage: damage, source: 'player' });

        // Get position for damage numbers and burn spread
        const position = entityManager.getComponent(entityId, PositionComponent);

        // Accumulate burn damage for throttled display (1500ms per entity to reduce visual clutter)
        if (position && damage > 0) {
          const accBurn = (this.accumulatedBurnDamage.get(entityId) || 0) + damage;
          this.accumulatedBurnDamage.set(entityId, accBurn);

          const lastTime = this.lastBurnNumberTime.get(entityId) || 0;
          if (currentTime - lastTime >= 1500 && accBurn >= 1) {
            if (this.settings.getSettings().showDamageNumbers) {
              this.effectFactory.createDamageNumber(
                { x: position.x, y: position.y - 20 },
                Math.round(accBurn),
                false // Orange color is hardcoded in effect factory for burn damage
              );
            }
            this.accumulatedBurnDamage.set(entityId, 0);
            this.lastBurnNumberTime.set(entityId, currentTime);
          }
        }

        // Update burn visual using glow intensity
        const renderable = entityManager.getComponent(entityId, RenderableComponent);
        if (renderable) {
          // Use glow to indicate burn effect
          renderable.glowIntensity = Math.min(burnEffect.burnVisualIntensity, 1.0);
        }

        // Attempt burn spread to nearby enemies
        if (this.spreadEnabled && burnEffect.canSpread && position) {
          this.attemptBurnSpread(entityId, burnEffect, position, entityManager);
        }

        // Check if entity died from burn
        if (health.health <= 0 && !health.isDead) {
          health.isDead = true;
          // Clean up throttle maps for dead entity
          this.lastBurnNumberTime.delete(entityId);
          this.accumulatedBurnDamage.delete(entityId);

          this.debugLog.log('🔥💀 Entity died from burn damage', 'info', {
            source: 'burn_system',
            entityId,
          });
        }
      }
    }
  }

  /**
   * Attempt to spread burn to a nearby enemy.
   * Spread burns have reduced damage/duration and do NOT spread further (canSpread=false)
   * to prevent exponential chain reactions.
   */
  private attemptBurnSpread(
    sourceEntityId: number,
    sourceBurn: BurnEffectComponent,
    sourcePosition: PositionComponent,
    entityManager: EntityManager
  ): void {
    if (Math.random() >= this.spreadChance) return;

    const spreadConfig = UPGRADE_EFFECTS.BURN_SPREAD;
    const radiusSq = spreadConfig.RADIUS * spreadConfig.RADIUS;

    // Find nearby entities with health but no burn
    const healthEntities = entityManager.getEntitiesWithComponents(HealthComponent);
    let spreadCount = 0;

    for (const targetId of healthEntities) {
      if (targetId === sourceEntityId) continue;
      if (spreadCount >= spreadConfig.MAX_SPREAD_TARGETS) break;

      if (isGuardianImmune(targetId, entityManager)) continue;

      // Skip if already burning
      if (entityManager.hasComponent(targetId, BurnEffectComponent)) continue;

      const targetPos = entityManager.getComponent(targetId, PositionComponent);
      if (!targetPos) continue;

      const targetHealth = entityManager.getComponent(targetId, HealthComponent);
      if (!targetHealth || targetHealth.isDead) continue;

      // Distance check (squared to avoid sqrt)
      const dx = targetPos.x - sourcePosition.x;
      const dy = targetPos.y - sourcePosition.y;
      const distSq = dx * dx + dy * dy;

      if (distSq > radiusSq) continue;

      // Apply spread burn with reduced values — canSpread=false prevents chain reactions
      const spreadDamage = sourceBurn.burnDamage * spreadConfig.DAMAGE_MODIFIER;
      const spreadDuration = sourceBurn.burnDuration * spreadConfig.DURATION_MODIFIER;

      entityManager.addComponent(
        targetId,
        new BurnEffectComponent(spreadDamage, spreadDuration, Date.now(), 0, 0.7, false)
      );

      spreadCount++;
    }
  }
}
