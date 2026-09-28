import { Injectable, OnDestroy } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { Subscription } from 'rxjs';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { SettingsService } from '../../utils/settings.service';
import {
  DischargeComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';
import { PLAYER_CONFIG } from '@photon/config/game-constants';

/**
 * System that handles player discharge ability
 * Damages all enemies within radius and creates visual effect
 */
@Injectable({
  providedIn: 'root',
})
export class DischargeSystemService implements System, OnDestroy {
  private dischargeTriggered = false;
  private lastDischargeTime = 0;
  private dischargeSubscription: Subscription | null = null;
  private currentChargeLevel = 1.0; // Default to full charge for backwards compatibility
  private cameraShakeTimeout?: ReturnType<typeof setTimeout>;

  constructor(
    private playerService: PlayerService,
    private effectFactory: EffectFactoryService,
    private debugLog: DebugLogBridgeService,
    private settingsService: SettingsService
  ) {
    // Subscribe to discharge events from player service
    this.dischargeSubscription = this.playerService.discharge$.subscribe((event) => {
      this.triggerDischarge(event);
    });
  }

  ngOnDestroy(): void {
    // Clean up subscription to prevent memory leak
    if (this.dischargeSubscription) {
      this.dischargeSubscription.unsubscribe();
      this.dischargeSubscription = null;
    }
    if (this.cameraShakeTimeout) {
      clearTimeout(this.cameraShakeTimeout);
    }
  }

  private readonly DISCHARGE_ENABLED = true;

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    if (!this.DISCHARGE_ENABLED) return;

    // Check if discharge was triggered
    if (!this.dischargeTriggered) return;

    // Reset trigger
    this.dischargeTriggered = false;

    // Find player entity
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    if (playerEntities.length === 0) return;

    const playerEntity = playerEntities[0];
    const playerPos = entityManager.getComponent(playerEntity, PositionComponent);
    const dischargeComp = entityManager.getComponent(playerEntity, DischargeComponent);

    if (!playerPos || !dischargeComp) return;

    const baseRadius = PLAYER_CONFIG.WEAPONS.DISCHARGE.RADIUS || 250;
    const cappedRadius = Math.min(baseRadius * this.playerService.getDischargeRadiusMultiplier(), 400); // Max 400px radius

    // Create pink cyber bubble effect
    this.effectFactory.createDischargeWave({ x: playerPos.x, y: playerPos.y }, cappedRadius);

    // Add screen shake when bubble pops (delayed) - if enabled in settings
    const settings = this.settingsService.getSettings();
    if (settings.screenShake) {
      this.cameraShakeTimeout = setTimeout(() => {
        if (window.cameraShake) {
          window.cameraShake.addShake({ intensity: 10, duration: 200 }); // Strong but short shake on pop
        }
      }, 400); // Delay to sync with bubble pop animation
    }

    // Find all enemies within radius
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent, HealthComponent);

    let damageDealt = 0;
    let enemiesHit = 0;

    for (const enemyId of enemies) {
      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      const enemyHealth = entityManager.getComponent(enemyId, HealthComponent);

      if (!enemyPos || !enemyHealth || enemyHealth.health <= 0) continue;

      // Skip enemies not yet combat-ready (spawning or just entered viewport)
      const spawnRenderable = entityManager.getComponent(enemyId, RenderableComponent);
      if (spawnRenderable && !spawnRenderable.isCombatReady(window.performance.now())) continue;

      // Check distance
      const dx = enemyPos.x - playerPos.x;
      const dy = enemyPos.y - playerPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= cappedRadius) {
        // Calculate damage with charge level scaling
        // At 0% charge: 50% damage, at 100% charge: 150% damage
        const chargeMultiplier = 0.5 + this.currentChargeLevel; // 0.5 to 1.5
        const baseDamage =
          PLAYER_CONFIG.WEAPONS.DISCHARGE.DAMAGE * this.playerService.getDischargeRadiusMultiplier() * chargeMultiplier;
        let damage = baseDamage;

        // Apply damage falloff if enabled
        if (PLAYER_CONFIG.WEAPONS.DISCHARGE.DAMAGE_FALLOFF) {
          const falloffFactor = 1 - (distance / cappedRadius) * 0.5; // 50% falloff at edge
          damage = baseDamage * Math.max(0.5, falloffFactor); // Minimum 50% damage
        }

        enemyHealth.health = Math.max(0, enemyHealth.health - damage);
        enemyHealth.lastDamageSource = 'player';
        damageDealt += damage;
        enemiesHit++;

        // Apply knockback effect
        const knockbackForce = PLAYER_CONFIG.WEAPONS.DISCHARGE.KNOCKBACK_FORCE || 400;
        const knockbackFactor = 1 - (distance / cappedRadius) * 0.3; // Stronger knockback closer to center

        // Calculate knockback direction (away from player)
        const knockbackDirX = dx / Math.max(distance, 1);
        const knockbackDirY = dy / Math.max(distance, 1);

        // Apply knockback velocity
        let velocity = entityManager.getComponent(enemyId, VelocityComponent);
        if (!velocity) {
          velocity = new VelocityComponent(0, 0);
          entityManager.addComponent(enemyId, velocity);
        }

        velocity.vx += knockbackDirX * knockbackForce * knockbackFactor;
        velocity.vy += knockbackDirY * knockbackForce * knockbackFactor;

        // Damage number is consolidated below (one total instead of per-enemy spam)

        // Add impact particle effect for each enemy hit
        this.effectFactory.createBeamImpact({ x: enemyPos.x, y: enemyPos.y }, damage);

        // Don't destroy immediately - let death detection system handle it
        // This allows death animations to play properly
        if (enemyHealth.health <= 0) {
          const enemyType = entityManager.getComponent(enemyId, EnemyTypeComponent);
          this.effectFactory.createDeathParticles({ x: enemyPos.x, y: enemyPos.y }, enemyType?.type || 'basic', false);
          // Note: Entity destruction is handled by death-detection-system and death-animation-system
        }
      }
    }

    // Show ONE damage number for the discharge — average per enemy, not the giant total
    if (enemiesHit > 0 && damageDealt > 0 && this.settingsService.getSettings().showDamageNumbers) {
      const avgDamage = Math.round(damageDealt / enemiesHit);
      this.effectFactory.createDamageNumber(
        { x: playerPos.x, y: playerPos.y - 40 },
        avgDamage,
        enemiesHit >= 3 // Highlight as crit-style when hitting 3+ enemies
      );
    }

    // Log discharge result
    if (enemiesHit > 0) {
      this.debugLog.log(
        `⚡ Discharge hit ${enemiesHit} enemies for ${damageDealt.toFixed(0)} total damage`,
        'success',
        {
          source: 'discharge_system',
          enemiesHit,
          totalDamage: damageDealt,
          radius: cappedRadius,
        }
      );
    }
  }

  private triggerDischarge(event: { x: number; y: number; radius: number; chargeLevel?: number }): void {
    const now = Date.now();
    if (now - this.lastDischargeTime < 1000) return; // Prevent spam

    this.dischargeTriggered = true;
    this.lastDischargeTime = now;
    // Store charge level for damage scaling (default to 1.0 for instant discharge)
    this.currentChargeLevel = event.chargeLevel ?? 1.0;

    const chargePercent = (this.currentChargeLevel * 100).toFixed(0);
    this.debugLog.log(
      `⚡ Charged Discharge (${chargePercent}%) at (${event.x.toFixed(0)}, ${event.y.toFixed(0)}) radius ${event.radius.toFixed(0)}`,
      'info',
      {
        source: 'discharge_system',
        position: { x: event.x, y: event.y },
        radius: event.radius,
        chargeLevel: this.currentChargeLevel,
      }
    );
  }
}
