import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { NPC_ABILITY_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { isGuardianImmune } from '../../combat/guardian-immunity.helper';
import { ComponentFactory } from '../../factories/component-factory';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { GameStateService } from '../../state/game-state.service';
import {
  AbilityComponent,
  AbilityType,
  BossPhaseComponent,
  DamageComponent,
  EnemyType,
  EnemyTypeComponent,
  FactionComponent,
  HealthComponent,
  InvincibilityComponent,
  MinionTagComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  TeleportEffectComponent,
  VelocityComponent,
  WeaponComponent,
} from '@photon/components';
import { MinionTrackerService } from './minion-tracker.service';

// Time-based effect interface
interface TimedEffect {
  type: string;
  entityId: number;
  endTime: number;
  onExpire: () => void;
  data?: unknown;
}

/**
 * NPC Ability System - Manages special abilities for NPCs
 *
 * Makes NPCs more than just health pools by giving them:
 * - Area buffs and heals
 * - Special attacks
 * - Defensive abilities
 * - Coordinated behaviors
 */
@Injectable({
  providedIn: 'root',
})
export class NpcAbilitySystemService implements System {
  // World dimensions — single-sourced from WORLD_CONFIG
  private readonly WORLD_WIDTH = WORLD_CONFIG.BOUNDS.WIDTH;
  private readonly WORLD_HEIGHT = WORLD_CONFIG.BOUNDS.HEIGHT;

  private lastAbilityCheck = 0;
  private timedEffects: TimedEffect[] = [];

  constructor(
    private debugLog: DebugLogBridgeService,
    private entityFactory: EntityFactoryECSService,
    private effectFactory: EffectFactoryService,
    private gameState: GameStateService,
    private minionTracker: MinionTrackerService
  ) {}

  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = Date.now();

    // Process timed effects first
    this.processTimedEffects(currentTime);

    // Throttle ability checks for performance
    if (currentTime - this.lastAbilityCheck < NPC_ABILITY_CONFIG.ABILITY_CHECK_INTERVAL_MS) {
      return;
    }
    this.lastAbilityCheck = currentTime;

    // Get all entities with abilities
    const abilityEntities = entityManager.getEntitiesWithComponents(AbilityComponent, PositionComponent);

    // Get player for targeting
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    const playerId = playerEntities.length > 0 ? playerEntities[0] : null;
    const playerPos = playerId ? entityManager.getComponent(playerId, PositionComponent) : null;

    for (const entityId of abilityEntities) {
      const abilityComp = entityManager.getComponent(entityId, AbilityComponent);
      const position = entityManager.getComponent(entityId, PositionComponent);

      if (!abilityComp || !position) continue;

      // Check boss phase transitions before processing abilities
      const bossPhase = entityManager.getComponent(entityId, BossPhaseComponent);
      if (bossPhase) {
        this.updateBossPhase(entityId, bossPhase, abilityComp, entityManager, currentTime);
      }

      // Check if it's time to use an ability
      if (currentTime >= abilityComp.nextAbilityTime) {
        const ability = abilityComp.getNextAbility();
        if (ability && abilityComp.canUseAbility(ability.type, currentTime)) {
          this.executeAbility(
            entityId,
            ability.type,
            position,
            playerPos || { x: 0, y: 0 },
            entityManager,
            currentTime
          );

          // Set next ability time, scaled by phase cooldown multiplier
          const baseCooldown = 3000 + Math.random() * 2000;
          const cooldownMultiplier = bossPhase?.cooldownMultiplier ?? 1.0;
          abilityComp.nextAbilityTime = currentTime + baseCooldown * cooldownMultiplier;
        }
      }
    }
  }

  /**
   * Process all timed effects and expire those that have ended
   */
  private processTimedEffects(currentTime: number): void {
    if (this.timedEffects.length === 0) return;
    // Process effects in reverse order so we can safely remove them
    for (let i = this.timedEffects.length - 1; i >= 0; i--) {
      const effect = this.timedEffects[i];
      if (currentTime >= effect.endTime) {
        // Execute expiration callback
        effect.onExpire();
        // Remove from list
        this.timedEffects.splice(i, 1);
      }
    }
  }

  /**
   * Add a timed effect to be processed later
   */
  private addTimedEffect(
    type: string,
    entityId: number,
    durationMs: number,
    onExpire: () => void,
    data?: unknown
  ): void {
    this.timedEffects.push({
      type,
      entityId,
      endTime: Date.now() + durationMs,
      onExpire,
      data,
    });
  }

  /**
   * Remove all pending timed effects for a dead entity.
   * Prevents closure callbacks from firing on recycled entity IDs
   * (e.g., restoring damageReduction or opacity on a different entity).
   */
  cleanupDeadEnemy(entityId: number): void {
    this.timedEffects = this.timedEffects.filter((effect) => effect.entityId !== entityId);
  }

  /**
   * Clear all per-run state so recycled entity IDs from a new run do not inherit
   * stale buff closures (enrage, iron-skin, blood-rage, etc.) from the previous run.
   */
  reset(): void {
    this.timedEffects = [];
    this.lastAbilityCheck = 0;
  }

  /**
   * System lifecycle hook — delegates to reset() so the engine's destroy pass
   * also clears timed-effect closures that would otherwise fire on stale entity IDs.
   */
  destroy(): void {
    this.reset();
  }

  /**
   * Check if an entity already has an active buff/effect of a given type
   */
  private hasActiveEffect(entityId: number, type: string): boolean {
    return this.timedEffects.some((effect) => effect.entityId === entityId && effect.type === type);
  }

  /**
   * Telegraph an upcoming ability to give players warning
   */
  private telegraphAbility(position: PositionComponent, abilityType: AbilityType): void {
    // Create a visual warning effect
    this.effectFactory.createAbilityEffect(position, abilityType);

    // Log for debugging
    this.debugLog.log('Ability Telegraph', 'info', {
      source: 'npc_ability_system',
      abilityType,
      position: { x: position.x, y: position.y },
    });
  }

  private executeAbility(
    entityId: number,
    abilityType: AbilityType,
    position: PositionComponent,
    playerPos: PositionComponent | null,
    entityManager: EntityManager,
    currentTime: number
  ): void {
    const abilityComp = entityManager.getComponent(entityId, AbilityComponent);
    if (!abilityComp || !abilityComp.useAbility(abilityType, currentTime)) {
      return;
    }

    // Telegraph ability before executing (gives player 0.5s warning)
    this.telegraphAbility(position, abilityType);

    // Add slight delay before ability fires for telegraph
    this.addTimedEffect(
      'ability_execute',
      entityId,
      500, // 0.5s telegraph time
      () => this.executeAbilityImmediate(entityId, abilityType, position, playerPos, entityManager)
    );
  }

  private executeAbilityImmediate(
    entityId: number,
    abilityType: AbilityType,
    position: PositionComponent,
    playerPos: PositionComponent | null,
    entityManager: EntityManager
  ): void {
    switch (abilityType) {
      case AbilityType.AREA_BUFF:
        this.executeAreaBuff(position, entityManager);
        break;

      case AbilityType.AREA_HEAL:
        this.executeAreaHeal(position, entityManager);
        break;

      case AbilityType.SHIELD_GENERATION:
        this.executeShieldGeneration(entityId, entityManager);
        break;

      case AbilityType.TENTACLE_GRAB:
        if (playerPos) {
          this.executeTentacleGrab(position, playerPos, entityManager);
        }
        break;

      case AbilityType.POISON_CLOUD:
        this.executePoisonCloud(position, entityManager);
        break;

      case AbilityType.BURST_FIRE:
        if (playerPos) {
          this.executeBurstFire(entityId, position, playerPos, entityManager);
        }
        break;

      case AbilityType.SHELL_RETREAT:
        this.executeShellRetreat(entityId, entityManager);
        break;

      case AbilityType.CHARGE_ATTACK:
        if (playerPos) {
          this.executeChargeAttack(entityId, position, playerPos, entityManager);
        }
        break;

      case AbilityType.CLAW_SLAM:
        this.executeClawSlam(entityId, position, entityManager);
        break;

      case AbilityType.ENRAGE:
        this.executeEnrage(entityId, entityManager);
        break;

      // Champion abilities
      case AbilityType.RALLY_CRY:
        this.executeRallyCry(entityId, position, entityManager);
        break;

      case AbilityType.VOLLEY:
        if (playerPos) {
          this.executeVolley(entityId, position, playerPos, entityManager);
        }
        break;

      case AbilityType.ACID_POOL:
        this.executeAcidPool(position);
        break;

      case AbilityType.EARTHQUAKE:
        this.executeEarthquake(entityId, position, entityManager);
        break;

      case AbilityType.IRON_SKIN:
        this.executeIronSkin(entityId, entityManager);
        break;

      case AbilityType.HIVE_MIND:
        this.executeHiveMind(entityId, position, entityManager);
        break;

      case AbilityType.FRENZY_AURA:
        this.executeFrenzyAura(entityId, position, entityManager);
        break;

      case AbilityType.GROUND_SLAM:
        this.executeGroundSlam(entityId, position, entityManager);
        break;

      case AbilityType.BLOOD_RAGE:
        this.executeBloodRage(entityId, entityManager);
        break;

      case AbilityType.PIERCING_SHOT:
        if (playerPos) {
          this.executePiercingShot(entityId, position, playerPos, entityManager);
        }
        break;

      case AbilityType.CLOAKING:
        this.executeCloaking(entityId, entityManager);
        break;

      case AbilityType.SUMMON_MINIONS:
        this.executeSummonMinions(entityId, position, entityManager);
        break;

      case AbilityType.TELEPORT_BLINK:
        if (playerPos) {
          this.executeTeleportBlink(entityId, playerPos, entityManager);
        }
        break;

      case AbilityType.LURE_STUN:
      case AbilityType.PREDICTION_SHOT:
        // Existing abilities with no dedicated handler — fall through silently
        break;

      default:
        if (window.debugLogBridge) {
          window.debugLogBridge.log(`Unknown ability type: ${String(abilityType)}`, 'warning');
        }
        break;
    }

    // Visual feedback for ability use
    this.effectFactory.createAbilityEffect(position, abilityType);

    this.debugLog.log('NPC Ability Used', 'info', {
      source: 'npc_ability_system',
      entityId,
      abilityType,
      position: { x: position.x, y: position.y },
    });
  }

  private executeAreaBuff(position: PositionComponent, entityManager: EntityManager): void {
    // Find all nearby NPCs
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);

    for (const enemyId of enemies) {
      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      if (!enemyPos) continue;

      const dxAb = enemyPos.x - position.x;
      const dyAb = enemyPos.y - position.y;
      const distSqAb = dxAb * dxAb + dyAb * dyAb;

      if (distSqAb <= NPC_ABILITY_CONFIG.AREA_BUFF.RADIUS * NPC_ABILITY_CONFIG.AREA_BUFF.RADIUS) {
        // Only apply damage buff if not already active
        if (!this.hasActiveEffect(enemyId, 'area_damage_buff')) {
          const damage = entityManager.getComponent(enemyId, DamageComponent);
          if (damage) {
            const originalDamage = damage.contactDamage;
            damage.contactDamage *= NPC_ABILITY_CONFIG.AREA_BUFF.DAMAGE_MULTIPLIER;

            // Add timed effect to reset damage
            this.addTimedEffect('area_damage_buff', enemyId, NPC_ABILITY_CONFIG.AREA_BUFF.DURATION_MS, () => {
              const currentDamage = entityManager.getComponent(enemyId, DamageComponent);
              if (currentDamage) {
                currentDamage.contactDamage = originalDamage;
              }
            });

            // Visual effect
            this.effectFactory.createBuffEffect(enemyPos, 'damage');
          }
        }
      }
    }
  }

  private executeAreaHeal(position: PositionComponent, entityManager: EntityManager): void {
    // Find all nearby NPCs
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, HealthComponent, PositionComponent);
    const currentTime = Date.now();

    for (const enemyId of enemies) {
      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      const health = entityManager.getComponent(enemyId, HealthComponent);
      if (!enemyPos || !health) continue;

      const dxAh = enemyPos.x - position.x;
      const dyAh = enemyPos.y - position.y;
      const distSqAh = dxAh * dxAh + dyAh * dyAh;

      if (distSqAh <= NPC_ABILITY_CONFIG.AREA_HEAL.RADIUS * NPC_ABILITY_CONFIG.AREA_HEAL.RADIUS) {
        const targetRenderable = entityManager.getComponent(enemyId, RenderableComponent);
        if (targetRenderable && !targetRenderable.isCombatReady(currentTime)) continue;

        // Heal 10% of max health
        const healAmount = health.maxHealth * NPC_ABILITY_CONFIG.AREA_HEAL.HEAL_PERCENTAGE;
        health.health = Math.min(health.maxHealth, health.health + healAmount);

        // Visual effect
        this.effectFactory.createHealEffect(enemyPos);
      }
    }
  }

  private executeShieldGeneration(entityId: number, entityManager: EntityManager): void {
    // Add invincibility using ComponentFactory
    let invincibility = entityManager.getComponent(entityId, InvincibilityComponent);
    if (!invincibility) {
      invincibility = ComponentFactory.createInvincibilityComponent(NPC_ABILITY_CONFIG.SHIELD.DURATION_MS);
      entityManager.addComponent(entityId, invincibility);
    } else {
      ComponentFactory.resetInvincibility(invincibility, NPC_ABILITY_CONFIG.SHIELD.DURATION_MS);
    }

    // Visual effect
    const position = entityManager.getComponent(entityId, PositionComponent);
    if (position) {
      this.effectFactory.createShieldEffect(position);
    }
  }

  private executeTentacleGrab(
    position: PositionComponent,
    playerPos: PositionComponent,
    entityManager: EntityManager
  ): void {
    const dxTg = playerPos.x - position.x;
    const dyTg = playerPos.y - position.y;
    const distSqTg = dxTg * dxTg + dyTg * dyTg;

    if (distSqTg <= NPC_ABILITY_CONFIG.TENTACLE_GRAB.RANGE * NPC_ABILITY_CONFIG.TENTACLE_GRAB.RANGE) {
      // Slow player movement for 2 seconds
      const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
      if (playerEntities.length > 0) {
        const playerId = playerEntities[0];
        const velocity = entityManager.getComponent(playerId, VelocityComponent);
        if (velocity) {
          const originalVx = velocity.vx;
          const originalVy = velocity.vy;
          velocity.vx *= NPC_ABILITY_CONFIG.TENTACLE_GRAB.SLOW_FACTOR;
          velocity.vy *= NPC_ABILITY_CONFIG.TENTACLE_GRAB.SLOW_FACTOR;

          // Add timed effect to restore velocity
          this.addTimedEffect('tentacle_grab_restore', playerId, NPC_ABILITY_CONFIG.TENTACLE_GRAB.DURATION_MS, () => {
            const vel = entityManager.getComponent(playerId, VelocityComponent);
            if (vel) {
              // Only restore if still slowed
              const currentSpeed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy);
              const slowedSpeed = Math.sqrt(
                (originalVx * NPC_ABILITY_CONFIG.TENTACLE_GRAB.SLOW_FACTOR) ** 2 +
                  (originalVy * NPC_ABILITY_CONFIG.TENTACLE_GRAB.SLOW_FACTOR) ** 2
              );
              if (currentSpeed <= slowedSpeed * 1.1) {
                vel.vx = originalVx;
                vel.vy = originalVy;
              }
            }
          });
        }

        // Visual effect - tentacle line
        this.effectFactory.createGrabEffect(position, playerPos);
      }
    }
  }

  private executePoisonCloud(position: PositionComponent, _entityManager: EntityManager): void {
    // Create a poison area effect entity
    this.entityFactory.createPoisonCloud(position.x, position.y);

    // The poison cloud entity will handle damage over time in collision system
    this.debugLog.log('Poison Cloud Created', 'info', {
      source: 'npc_ability_system',
      position: { x: position.x, y: position.y },
      duration: NPC_ABILITY_CONFIG.POISON_CLOUD.DURATION_MS,
    });
  }

  private executeBurstFire(
    entityId: number,
    position: PositionComponent,
    _playerPos: PositionComponent,
    _entityManager: EntityManager
  ): void {
    // Fire projectiles in all directions
    const projectileCount = NPC_ABILITY_CONFIG.BURST_FIRE.PROJECTILE_COUNT;
    for (let i = 0; i < projectileCount; i++) {
      const angle = (Math.PI * 2 * i) / projectileCount;
      const speed = NPC_ABILITY_CONFIG.BURST_FIRE.PROJECTILE_SPEED;

      this.entityFactory.createEnemyProjectile(
        position.x,
        position.y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        NPC_ABILITY_CONFIG.BURST_FIRE.PROJECTILE_DAMAGE,
        entityId
      );
    }

    // Visual effect
    this.effectFactory.createBurstEffect(position);
  }

  private executeShellRetreat(entityId: number, entityManager: EntityManager): void {
    const selfRenderable = entityManager.getComponent(entityId, RenderableComponent);
    if (selfRenderable && !selfRenderable.isCombatReady(Date.now())) return;

    // Add temporary invincibility using ComponentFactory
    let invincibility = entityManager.getComponent(entityId, InvincibilityComponent);
    if (!invincibility) {
      invincibility = ComponentFactory.createInvincibilityComponent(NPC_ABILITY_CONFIG.SHELL_RETREAT.INVINCIBILITY_MS);
      entityManager.addComponent(entityId, invincibility);
    } else {
      ComponentFactory.resetInvincibility(invincibility, NPC_ABILITY_CONFIG.SHELL_RETREAT.INVINCIBILITY_MS);
    }

    // Heal 5% of max health
    const health = entityManager.getComponent(entityId, HealthComponent);
    if (health) {
      const healAmount = health.maxHealth * NPC_ABILITY_CONFIG.SHELL_RETREAT.HEAL_PERCENTAGE;
      health.health = Math.min(health.maxHealth, health.health + healAmount);
    }

    // Stop movement temporarily
    const velocity = entityManager.getComponent(entityId, VelocityComponent);
    if (velocity) {
      velocity.vx = 0;
      velocity.vy = 0;
    }

    // Visual effect
    const position = entityManager.getComponent(entityId, PositionComponent);
    if (position) {
      this.effectFactory.createShellEffect(position);
    }
  }

  private executeChargeAttack(
    entityId: number,
    position: PositionComponent,
    playerPos: PositionComponent,
    entityManager: EntityManager
  ): void {
    // Calculate charge direction
    const dx = playerPos.x - position.x;
    const dy = playerPos.y - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 0) {
      // Set high velocity towards player
      const velocity = entityManager.getComponent(entityId, VelocityComponent);
      if (velocity) {
        const originalVx = velocity.vx;
        const originalVy = velocity.vy;
        const chargeSpeed = NPC_ABILITY_CONFIG.CHARGE_ATTACK.SPEED;
        velocity.vx = (dx / distance) * chargeSpeed;
        velocity.vy = (dy / distance) * chargeSpeed;

        // Add timed effect to reset velocity
        this.addTimedEffect('charge_velocity_reset', entityId, NPC_ABILITY_CONFIG.CHARGE_ATTACK.DURATION_MS, () => {
          const vel = entityManager.getComponent(entityId, VelocityComponent);
          if (vel) {
            vel.vx = originalVx;
            vel.vy = originalVy;
          }
        });
      }

      // Increase damage temporarily - only if not already buffed
      if (!this.hasActiveEffect(entityId, 'charge_damage_buff')) {
        const damage = entityManager.getComponent(entityId, DamageComponent);
        if (damage) {
          const originalDamage = damage.contactDamage;
          damage.contactDamage *= NPC_ABILITY_CONFIG.CHARGE_ATTACK.DAMAGE_MULTIPLIER;

          // Add timed effect to reset damage
          this.addTimedEffect('charge_damage_buff', entityId, NPC_ABILITY_CONFIG.CHARGE_ATTACK.RESET_DELAY_MS, () => {
            const dmg = entityManager.getComponent(entityId, DamageComponent);
            if (dmg) {
              dmg.contactDamage = originalDamage;
            }
          });
        }
      }

      // Visual effect
      this.effectFactory.createChargeEffect(position, playerPos);
    }
  }

  private executeClawSlam(executingEntityId: number, position: PositionComponent, entityManager: EntityManager): void {
    // Damage player if in range
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    for (const playerId of players) {
      const playerPos = entityManager.getComponent(playerId, PositionComponent);
      if (!playerPos) continue;

      const dxCs = playerPos.x - position.x;
      const dyCs = playerPos.y - position.y;
      const distance = Math.sqrt(dxCs * dxCs + dyCs * dyCs);

      if (distance <= NPC_ABILITY_CONFIG.CLAW_SLAM.RANGE) {
        // Apply damage through game state
        // More damage closer to center
        const damage = Math.max(10, NPC_ABILITY_CONFIG.CLAW_SLAM.DAMAGE - distance / 10);
        this.gameState.takeDamage(damage, 'claw_slam');

        // Knockback effect
        const velocity = entityManager.getComponent(playerId, VelocityComponent);
        if (velocity) {
          const knockbackForce = NPC_ABILITY_CONFIG.CLAW_SLAM.KNOCKBACK_FORCE;
          const dx = playerPos.x - position.x;
          const dy = playerPos.y - position.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;

          velocity.vx += (dx / dist) * knockbackForce;
          velocity.vy += (dy / dist) * knockbackForce;
        }
      }
    }

    // Instant-kill other NPCs in slam range (excluding self and guardians)
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, HealthComponent, PositionComponent);
    let enemiesKilled = 0;

    for (const enemyId of enemies) {
      if (enemyId === executingEntityId) continue; // Don't kill self
      if (isGuardianImmune(enemyId, entityManager)) continue;

      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      const health = entityManager.getComponent(enemyId, HealthComponent);
      if (!enemyPos || !health || health.isDead) continue;

      const dxCse = enemyPos.x - position.x;
      const dyCse = enemyPos.y - position.y;
      const distSqCse = dxCse * dxCse + dyCse * dyCse;

      if (distSqCse <= NPC_ABILITY_CONFIG.CLAW_SLAM.RANGE * NPC_ABILITY_CONFIG.CLAW_SLAM.RANGE) {
        health.lastDamageSource = 'environmental';
        health.health = 0;
        enemiesKilled++;
      }
    }

    if (enemiesKilled > 0) {
      this.debugLog.log('Claw slam killed NPCs!', 'info', {
        source: 'npc_ability_system',
        executingEntityId,
        enemiesKilled,
        range: NPC_ABILITY_CONFIG.CLAW_SLAM.RANGE,
      });
    }

    // Visual effect - ground shake
    this.effectFactory.createSlamEffect(position, NPC_ABILITY_CONFIG.CLAW_SLAM.RANGE);
  }

  private executeEnrage(entityId: number, entityManager: EntityManager): void {
    // Check if below health threshold
    const health = entityManager.getComponent(entityId, HealthComponent);
    if (!health || health.health / health.maxHealth > NPC_ABILITY_CONFIG.ENRAGE.HEALTH_THRESHOLD) {
      return;
    }

    // Only apply enrage buff if not already active
    if (this.hasActiveEffect(entityId, 'enrage_buff')) {
      return;
    }

    // Store original values
    const velocity = entityManager.getComponent(entityId, VelocityComponent);
    const damage = entityManager.getComponent(entityId, DamageComponent);

    let originalVx = 0;
    let originalVy = 0;
    let originalDamage = 0;

    // Increase speed
    if (velocity) {
      originalVx = velocity.vx;
      originalVy = velocity.vy;
      velocity.vx *= NPC_ABILITY_CONFIG.ENRAGE.SPEED_MULTIPLIER;
      velocity.vy *= NPC_ABILITY_CONFIG.ENRAGE.SPEED_MULTIPLIER;
    }

    // Increase damage
    if (damage) {
      originalDamage = damage.contactDamage;
      damage.contactDamage *= NPC_ABILITY_CONFIG.ENRAGE.DAMAGE_MULTIPLIER;
    }

    // Add timed effect to reset stats
    this.addTimedEffect('enrage_buff', entityId, NPC_ABILITY_CONFIG.ENRAGE.DURATION_MS, () => {
      const vel = entityManager.getComponent(entityId, VelocityComponent);
      const dmg = entityManager.getComponent(entityId, DamageComponent);

      if (vel) {
        vel.vx = originalVx;
        vel.vy = originalVy;
      }
      if (dmg) {
        dmg.contactDamage = originalDamage;
      }
    });

    // Visual effect - red aura
    const position = entityManager.getComponent(entityId, PositionComponent);
    if (position) {
      this.effectFactory.createEnrageEffect(position);
    }
  }

  private executeSummonMinions(ownerId: number, position: PositionComponent, entityManager: EntityManager): void {
    const cfg = NPC_ABILITY_CONFIG.SUMMON_MINIONS;
    const aliveCount = this.minionTracker.getAliveCount(ownerId);
    const slotsRemaining = Math.max(0, cfg.MAX_ALIVE - aliveCount);
    const toSpawn = Math.min(cfg.SPAWN_COUNT, slotsRemaining);
    if (toSpawn <= 0) return;

    // Inherit faction from owner so minions don't friendly-fire their summoner
    const ownerFaction = entityManager.getComponent(ownerId, FactionComponent);
    const factionId = ownerFaction?.kingId ?? 0;

    for (let i = 0; i < toSpawn; i++) {
      const angle = (Math.PI * 2 * i) / toSpawn + Math.random() * 0.3;
      const r = cfg.SPAWN_RADIUS * (0.6 + Math.random() * 0.6);
      const mx = position.x + Math.cos(angle) * r;
      const my = position.y + Math.sin(angle) * r;

      const minionId = this.entityFactory.createEnemy(mx, my, cfg.MINION_TYPE as EnemyType, 'common', false, factionId);

      entityManager.addComponent(minionId, new MinionTagComponent(ownerId));
      this.minionTracker.recordSpawn(ownerId, minionId);
    }

    this.debugLog.log('NPC summoned minions', 'info', {
      source: 'npc_ability_system',
      operation: 'summon_minions',
      ownerId,
      spawned: toSpawn,
      aliveBefore: aliveCount,
    });
  }

  // ========== BOSS PHASE SYSTEM ==========

  /**
   * Check and update boss phase based on current health percentage.
   * Phase transitions apply multipliers to cooldowns, speed, and weapon fire rate.
   * Multipliers are applied each frame relative to base values (not compounding).
   */
  private updateBossPhase(
    entityId: number,
    bossPhase: BossPhaseComponent,
    abilityComp: AbilityComponent,
    entityManager: EntityManager,
    currentTime: number
  ): void {
    // Skip if mid-transition
    if (bossPhase.phaseTransitioning) {
      return;
    }

    const health = entityManager.getComponent(entityId, HealthComponent);
    if (!health || health.isDead || health.health <= 0) return;

    const healthPercent = health.health / health.maxHealth;

    // Determine what phase the boss SHOULD be in based on health
    let targetPhase = 1;
    for (let i = 0; i < bossPhase.phaseThresholds.length; i++) {
      if (healthPercent <= bossPhase.phaseThresholds[i]) {
        targetPhase = i + 2; // thresholds[0] = 0.75 -> phase 2, etc.
      }
    }
    targetPhase = Math.min(targetPhase, bossPhase.maxPhases);

    // Transition if phase changed
    if (targetPhase > bossPhase.currentPhase) {
      this.transitionBossPhase(entityId, bossPhase, abilityComp, entityManager, currentTime, targetPhase);
    }

    // Apply speed multiplier every update (relative to base speed, not compounding)
    this.applyPhaseSpeedMultiplier(entityId, bossPhase, entityManager);
  }

  /**
   * Execute a boss phase transition with one-time effects and new multipliers.
   */
  private transitionBossPhase(
    entityId: number,
    bossPhase: BossPhaseComponent,
    abilityComp: AbilityComponent,
    entityManager: EntityManager,
    currentTime: number,
    newPhase: number
  ): void {
    const oldPhase = bossPhase.currentPhase;
    bossPhase.currentPhase = newPhase;
    bossPhase.lastPhaseTransition = currentTime;
    bossPhase.phaseTransitioning = true;

    // Set phase multipliers
    this.setPhaseMultipliers(bossPhase, newPhase);

    // Apply cooldown multiplier to ability cooldowns (relative to base)
    for (let i = 0; i < abilityComp.abilities.length; i++) {
      const baseCooldown = bossPhase.baseCooldowns[i];
      if (baseCooldown !== undefined) {
        abilityComp.abilities[i].cooldownMs = Math.round(baseCooldown * bossPhase.cooldownMultiplier);
      }
    }

    // Apply weapon fire rate multiplier if boss has a weapon
    const weapon = entityManager.getComponent(entityId, WeaponComponent);
    if (weapon) {
      const baseFireRate = bossPhase.baseFireRate > 0 ? bossPhase.baseFireRate : weapon.fireRate;
      weapon.fireRate = Math.round(baseFireRate * bossPhase.cooldownMultiplier);
    }

    // One-time transition effects
    const position = entityManager.getComponent(entityId, PositionComponent);

    // Brief invincibility during transition (phases 3 and 4)
    if (newPhase >= 3) {
      let invincibility = entityManager.getComponent(entityId, InvincibilityComponent);
      if (!invincibility) {
        invincibility = ComponentFactory.createInvincibilityComponent(500);
        entityManager.addComponent(entityId, invincibility);
      } else {
        ComponentFactory.resetInvincibility(invincibility, 500);
      }
    }

    // Visual burst
    if (position) {
      this.effectFactory.createPhaseTransitionEffect(position, newPhase);

      // Per-archetype mechanical differentiation (Honesty Fix #2). The
      // standard archetype keeps the canonical phase-flash only; swarm
      // king summons two swarmlings as reinforcements; pyroclast layers
      // a second fire burst on top so the molten flavor reads in motion.
      switch (bossPhase.archetype) {
        case 'swarm_king':
          this.spawnSwarmKingReinforcements(position);
          break;
        case 'pyroclast':
          // Layer a second, larger transition burst for the molten flavor.
          this.effectFactory.createPhaseTransitionEffect(position, newPhase + 1);
          break;
        case 'standard':
          // No extra side effect — the canonical baseline.
          break;
      }
    }

    // Campaign C — every phase transition emits a telegraphed arena shockwave
    // at the boss's position, archetype-tuned. The expanding-ring VFX is the
    // player's countdown to move out before it detonates.
    if (position) {
      this.entityFactory.createArenaHazard(position.x, position.y, bossPhase.archetype);
    }

    // End transition state after a short delay
    this.addTimedEffect('boss_phase_transition', entityId, 500, () => {
      bossPhase.phaseTransitioning = false;
    });

    this.debugLog.log('Boss Phase Transition', 'info', {
      source: 'npc_ability_system',
      entityId,
      oldPhase,
      newPhase,
      archetype: bossPhase.archetype,
      cooldownMultiplier: bossPhase.cooldownMultiplier,
      speedMultiplier: bossPhase.speedMultiplier,
    });
  }

  /**
   * Swarm King phase-transition side effect — spawn two Swarm minions in
   * a ring around the boss. Reuses the same EnemyType.Swarm pattern as
   * the champion HIVE_MIND ability so the reinforcements look and behave
   * consistently with existing swarm encounters.
   */
  private spawnSwarmKingReinforcements(position: PositionComponent): void {
    const minionCount = NPC_ABILITY_CONFIG.SUMMON_MINIONS.SPAWN_COUNT;
    const spreadRadius = NPC_ABILITY_CONFIG.SUMMON_MINIONS.SPAWN_RADIUS;
    for (let i = 0; i < minionCount; i++) {
      const angle = (Math.PI * 2 * i) / minionCount + Math.PI / 4; // Offset 45° so they don't sit directly on cardinal axes
      const offsetX = position.x + Math.cos(angle) * spreadRadius;
      const offsetY = position.y + Math.sin(angle) * spreadRadius;
      this.entityFactory.createEnemy(offsetX, offsetY, EnemyType.Swarm, 'common', false, 0, false);
    }
  }

  /**
   * Set cooldown and speed multipliers based on phase number.
   *
   * Phase 1: normal (1.0x cooldown, 1.0x speed)
   * Phase 2: aggressive (0.7x cooldown, 1.25x speed)
   * Phase 3: desperate (0.5x cooldown, 1.5x speed)
   * Phase 4: berserk (0.4x cooldown, 2.0x speed)
   */
  private setPhaseMultipliers(bossPhase: BossPhaseComponent, phase: number): void {
    switch (phase) {
      case 2:
        bossPhase.cooldownMultiplier = 0.7;
        bossPhase.speedMultiplier = 1.25;
        break;
      case 3:
        bossPhase.cooldownMultiplier = 0.5;
        bossPhase.speedMultiplier = 1.5;
        break;
      case 4:
        bossPhase.cooldownMultiplier = 0.4;
        bossPhase.speedMultiplier = 2.0;
        break;
      default:
        bossPhase.cooldownMultiplier = 1.0;
        bossPhase.speedMultiplier = 1.0;
        break;
    }
  }

  /**
   * Apply the phase speed multiplier to the boss velocity.
   * Uses baseSpeed to calculate target speed magnitude, then scales current direction.
   */
  private applyPhaseSpeedMultiplier(
    entityId: number,
    bossPhase: BossPhaseComponent,
    entityManager: EntityManager
  ): void {
    if (bossPhase.speedMultiplier <= 1.0 || bossPhase.baseSpeed === 0) return;

    const velocity = entityManager.getComponent(entityId, VelocityComponent);
    if (!velocity) return;

    const currentSpeed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
    if (currentSpeed < 0.1) return;

    const targetSpeed = bossPhase.baseSpeed * bossPhase.speedMultiplier;

    // Only boost speed if below target — don't override knockbacks or charges
    if (currentSpeed < targetSpeed) {
      velocity.vx = (velocity.vx / currentSpeed) * targetSpeed;
      velocity.vy = (velocity.vy / currentSpeed) * targetSpeed;
    }
  }

  // ========== CHAMPION ABILITIES ==========

  /**
   * RALLY_CRY — nearby allies gain 30% speed for 5s
   */
  private executeRallyCry(entityId: number, position: PositionComponent, entityManager: EntityManager): void {
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);
    const rallyRange = 200;
    const speedBoost = 1.3;

    for (const enemyId of enemies) {
      if (enemyId === entityId) continue;
      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      if (!enemyPos) continue;

      const dx = enemyPos.x - position.x;
      const dy = enemyPos.y - position.y;
      if (dx * dx + dy * dy > rallyRange * rallyRange) continue;

      if (this.hasActiveEffect(enemyId, 'rally_cry_speed')) continue;

      const velocity = entityManager.getComponent(enemyId, VelocityComponent);
      if (!velocity) continue;

      const origVx = velocity.vx;
      const origVy = velocity.vy;
      velocity.vx *= speedBoost;
      velocity.vy *= speedBoost;

      this.addTimedEffect('rally_cry_speed', enemyId, 5000, () => {
        const vel = entityManager.getComponent(enemyId, VelocityComponent);
        if (vel) {
          vel.vx = origVx;
          vel.vy = origVy;
        }
      });
    }

    this.debugLog.log('Champion Rally Cry', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * VOLLEY — 5 projectiles in a fan pattern (-30° to +30° relative to player)
   */
  private executeVolley(
    entityId: number,
    position: PositionComponent,
    playerPos: PositionComponent,
    _entityManager: EntityManager
  ): void {
    const dx = playerPos.x - position.x;
    const dy = playerPos.y - position.y;
    const baseAngle = Math.atan2(dy, dx);
    const projectileCount = 5;
    const spreadRad = Math.PI / 6; // 30 degrees total spread each side
    const speed = 220;

    for (let i = 0; i < projectileCount; i++) {
      const offset = (i / (projectileCount - 1)) * spreadRad * 2 - spreadRad;
      const angle = baseAngle + offset;
      this.entityFactory.createEnemyProjectile(
        position.x,
        position.y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        12,
        entityId
      );
    }

    this.debugLog.log('Champion Volley', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * ACID_POOL — DOT zone at position (delegates to poison cloud — same mechanic)
   */
  private executeAcidPool(position: PositionComponent): void {
    this.entityFactory.createPoisonCloud(position.x, position.y);
    this.debugLog.log('Champion Acid Pool', 'info', { source: 'npc_ability_system', position });
  }

  /**
   * EARTHQUAKE — AOE damage + knockback to player in 100px radius
   */
  private executeEarthquake(entityId: number, position: PositionComponent, entityManager: EntityManager): void {
    const quakeRange = 100;
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    for (const playerId of players) {
      const playerPos = entityManager.getComponent(playerId, PositionComponent);
      if (!playerPos) continue;

      const dx = playerPos.x - position.x;
      const dy = playerPos.y - position.y;
      if (dx * dx + dy * dy > quakeRange * quakeRange) continue;

      this.gameState.takeDamage(15, 'earthquake');

      // Knockback
      const velocity = entityManager.getComponent(playerId, VelocityComponent);
      if (velocity) {
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        velocity.vx += (dx / dist) * 300;
        velocity.vy += (dy / dist) * 300;
      }
    }

    this.effectFactory.createSlamEffect(position, quakeRange);
    this.debugLog.log('Champion Earthquake', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * IRON_SKIN — 50% damage reduction for 4s via invincibility (simplified)
   */
  private executeIronSkin(entityId: number, entityManager: EntityManager): void {
    if (this.hasActiveEffect(entityId, 'iron_skin')) return;

    const health = entityManager.getComponent(entityId, HealthComponent);
    if (!health) return;

    // Temporarily halve incoming damage by doubling max health floor
    const origDamageReduction = health.damageReduction ?? 0;
    health.damageReduction = Math.min(0.9, origDamageReduction + 0.5);

    this.addTimedEffect('iron_skin', entityId, 4000, () => {
      const h = entityManager.getComponent(entityId, HealthComponent);
      if (h) {
        h.damageReduction = origDamageReduction;
      }
    });

    const position = entityManager.getComponent(entityId, PositionComponent);
    if (position) {
      this.effectFactory.createShieldEffect(position);
    }
    this.debugLog.log('Champion Iron Skin', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * HIVE_MIND — spawns 3 swarm-type minions near the champion
   * Spawns immediately by creating projectile-like sub-entities through entityFactory
   */
  private executeHiveMind(entityId: number, position: PositionComponent, entityManager: EntityManager): void {
    const minionCount = 3;
    const spreadRadius = 40;
    for (let i = 0; i < minionCount; i++) {
      const angle = (Math.PI * 2 * i) / minionCount;
      const offsetX = position.x + Math.cos(angle) * spreadRadius;
      const offsetY = position.y + Math.sin(angle) * spreadRadius;
      this.entityFactory.createEnemy(offsetX, offsetY, EnemyType.Swarm, 'common', false, 0, false);
    }

    // Suppress unused entityManager warning — kept for interface consistency
    void entityManager;

    this.debugLog.log('Champion Hive Mind', 'info', { source: 'npc_ability_system', entityId, minionCount });
  }

  /**
   * FRENZY_AURA — nearby swarm allies +40% speed for 5s
   */
  private executeFrenzyAura(entityId: number, position: PositionComponent, entityManager: EntityManager): void {
    const auraRange = 200;
    const speedBoost = 1.4;
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent);

    for (const enemyId of enemies) {
      if (enemyId === entityId) continue;
      const enemyType = entityManager.getComponent(enemyId, EnemyTypeComponent);
      if (!enemyType || enemyType.type !== EnemyType.Swarm) continue;

      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      if (!enemyPos) continue;

      const dx = enemyPos.x - position.x;
      const dy = enemyPos.y - position.y;
      if (dx * dx + dy * dy > auraRange * auraRange) continue;

      if (this.hasActiveEffect(enemyId, 'frenzy_aura_speed')) continue;

      const velocity = entityManager.getComponent(enemyId, VelocityComponent);
      if (!velocity) continue;

      const origVx = velocity.vx;
      const origVy = velocity.vy;
      velocity.vx *= speedBoost;
      velocity.vy *= speedBoost;

      this.addTimedEffect('frenzy_aura_speed', enemyId, 5000, () => {
        const vel = entityManager.getComponent(enemyId, VelocityComponent);
        if (vel) {
          vel.vx = origVx;
          vel.vy = origVy;
        }
      });
    }

    this.debugLog.log('Champion Frenzy Aura', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * GROUND_SLAM — shockwave knockback to player in 150px radius
   */
  private executeGroundSlam(entityId: number, position: PositionComponent, entityManager: EntityManager): void {
    const slamRange = 150;
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    for (const playerId of players) {
      const playerPos = entityManager.getComponent(playerId, PositionComponent);
      if (!playerPos) continue;

      const dx = playerPos.x - position.x;
      const dy = playerPos.y - position.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > slamRange * slamRange) continue;

      const velocity = entityManager.getComponent(playerId, VelocityComponent);
      if (velocity) {
        const dist = Math.sqrt(distSq) || 1;
        const knockbackForce = 400;
        velocity.vx += (dx / dist) * knockbackForce;
        velocity.vy += (dy / dist) * knockbackForce;
      }
    }

    this.effectFactory.createSlamEffect(position, slamRange);
    this.debugLog.log('Champion Ground Slam', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * BLOOD_RAGE — heal 15% max health on use (simplified lifesteal)
   */
  private executeBloodRage(entityId: number, entityManager: EntityManager): void {
    if (this.hasActiveEffect(entityId, 'blood_rage')) return;

    const health = entityManager.getComponent(entityId, HealthComponent);
    if (!health) return;

    const healAmount = health.maxHealth * 0.15;
    health.health = Math.min(health.maxHealth, health.health + healAmount);

    // Mark as active to prevent re-triggering immediately
    this.addTimedEffect('blood_rage', entityId, 8000, () => {
      // No restore needed — heal is one-time
    });

    const position = entityManager.getComponent(entityId, PositionComponent);
    if (position) {
      this.effectFactory.createHealEffect(position);
    }
    this.debugLog.log('Champion Blood Rage', 'info', { source: 'npc_ability_system', entityId, heal: healAmount });
  }

  /**
   * PIERCING_SHOT — single high-damage projectile toward player
   */
  private executePiercingShot(
    entityId: number,
    position: PositionComponent,
    playerPos: PositionComponent,
    _entityManager: EntityManager
  ): void {
    const dx = playerPos.x - position.x;
    const dy = playerPos.y - position.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 350;

    this.entityFactory.createEnemyProjectile(
      position.x,
      position.y,
      (dx / dist) * speed,
      (dy / dist) * speed,
      50,
      entityId
    );

    this.debugLog.log('Champion Piercing Shot', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * CLOAKING — set renderable opacity to near-invisible for 3s
   */
  private executeCloaking(entityId: number, entityManager: EntityManager): void {
    if (this.hasActiveEffect(entityId, 'cloaking')) return;

    const renderable = entityManager.getComponent(entityId, RenderableComponent);
    if (!renderable) return;

    const origOpacity = renderable.opacity;
    renderable.opacity = 0.1;

    this.addTimedEffect('cloaking', entityId, 3000, () => {
      const r = entityManager.getComponent(entityId, RenderableComponent);
      if (r) {
        r.opacity = origOpacity;
      }
    });

    this.debugLog.log('Champion Cloaking', 'info', { source: 'npc_ability_system', entityId });
  }

  /**
   * TELEPORT_BLINK — entity vanishes for BLINK_DURATION_MS then reappears at a
   * random angle, 180–320 px from the player.  During the blink the host is
   * invisible (opacity = 0) and invincible so the player cannot tag it mid-jump.
   * TeleportSystemService completes the snap on the next eligible tick.
   *
   * Early-return if player position is unknown — we never blink to a random
   * wandering position.
   */
  private executeTeleportBlink(entityId: number, playerPos: PositionComponent, entityManager: EntityManager): void {
    const cfg = NPC_ABILITY_CONFIG.TELEPORT_BLINK;
    const angle = Math.random() * Math.PI * 2;
    const distance =
      cfg.MIN_DISTANCE_FROM_PLAYER + Math.random() * (cfg.MAX_DISTANCE_FROM_PLAYER - cfg.MIN_DISTANCE_FROM_PLAYER);
    // Clamp to world bounds so Snipers and Disruptors cannot blink into the void.
    // Pattern mirrors EnemyMovementSystemService (canonical source of truth).
    const targetX = Math.max(0, Math.min(this.WORLD_WIDTH, playerPos.x + Math.cos(angle) * distance));
    const targetY = Math.max(0, Math.min(this.WORLD_HEIGHT, playerPos.y + Math.sin(angle) * distance));

    // Hide and make invincible during blink
    const renderable = entityManager.getComponent(entityId, RenderableComponent);
    const originalOpacity = renderable?.opacity ?? 1.0;
    const departurePos = entityManager.getComponent(entityId, PositionComponent);
    if (renderable) renderable.opacity = 0;

    // Departure burst — blue shimmer at the entity's current position
    if (departurePos) {
      this.effectFactory.createAbilityEffect({ x: departurePos.x, y: departurePos.y }, AbilityType.SHIELD_GENERATION);
    }

    const inv = entityManager.getComponent(entityId, InvincibilityComponent);
    if (!inv) {
      entityManager.addComponent(entityId, ComponentFactory.createInvincibilityComponent(cfg.BLINK_DURATION_MS));
    } else {
      ComponentFactory.resetInvincibility(inv, cfg.BLINK_DURATION_MS);
    }

    const tp = new TeleportEffectComponent(targetX, targetY, Date.now(), cfg.BLINK_DURATION_MS, originalOpacity);
    entityManager.addComponent(entityId, tp);

    this.debugLog.log('NPC teleport blink initiated', 'info', {
      source: 'npc_ability_system',
      entityId,
      targetX,
      targetY,
      durationMs: cfg.BLINK_DURATION_MS,
    });
  }
}
