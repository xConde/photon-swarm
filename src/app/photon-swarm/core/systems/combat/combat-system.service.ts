import { inject, Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { Subject } from 'rxjs';
import { Enemy, EnemyType, Rarity } from '../../models/enemy.model';
import { createEnemyId } from '../../models/common.model';
import {
  BeamComponent,
  BuffComponent,
  DamageComponent,
  EnemyTypeComponent,
  FactionComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  ShieldArcComponent,
  WeaponComponent,
} from '@photon/components';
import { DamageCalculationService } from '../../combat/damage-calculation.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { PerformanceMonitorService } from '../../utils/performance-monitor.service';
import { MONITORING_CONFIG, PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { SettingsService } from '../../utils/settings.service';
import { XPEventSource, XPEventTrackerService, XPMultiplier } from '../../progression/xp-event-tracker.service';
import { FactionStandingSystemService } from '../gameplay';
import { DifficultyService } from '../../../services/difficulty.service';
import { IntensityService } from './intensity.service';
import { CameraShakeService } from '../../effects/camera-shake.service';
import { PostProcessingService } from '../../effects/post-processing.service';

// Base interface for entities involved in combat calculations
interface CombatEntity {
  id: number;
  health: HealthComponent;
  damage?: DamageComponent;
  weapon?: WeaponComponent;
  beam?: BeamComponent;
  position: PositionComponent;
  buff?: BuffComponent;
  enemyType?: EnemyTypeComponent;
  playerControlled?: PlayerControlledComponent;
  shieldArc?: ShieldArcComponent;
}

// Extended data returned by getEntityCombatData with runtime metadata
interface CombatEntityData extends CombatEntity {
  entityId: number;
  isPlayer: boolean;
}

/**
 * Combat event data
 */
export interface CombatEvent {
  attackerId: number;
  defenderId: number;
  damage: number;
  damageType: 'beam' | 'projectile' | 'kamikaze' | 'burn' | 'recoil' | 'environmental';
  isCritical: boolean;
  isKill: boolean;
  position: { x: number; y: number };
  timestamp: number;
}

/**
 * Combat resolution configuration
 */
interface CombatConfig {
  baseCriticalChance: number;
  baseCriticalMultiplier: number;
  enableAdvancedDamage: boolean;
  kamikazeDamagePercent: number;
}

/**
 * ECS CombatSystem - handles damage resolution and combat mechanics
 *
 * Features:
 * - Integration with existing DamageCalculationService
 * - Component-based damage modifiers and buffs
 * - Critical hit mechanics
 * - Combat event notifications
 * - Death handling and cleanup
 *
 * This system works with CollisionSystem events to resolve combat outcomes
 */
@Injectable({
  providedIn: 'root',
})
export class CombatSystemService implements System {
  private readonly settings = inject(SettingsService);

  private config: CombatConfig = {
    baseCriticalChance: 0, // No base crit - only from player upgrades
    baseCriticalMultiplier: 2.0,
    enableAdvancedDamage: true, // Use OSRS-style damage calculation
    kamikazeDamagePercent: 0.5, // 50% of enemy health as kamikaze damage
  };

  // Event streams
  private combatSubject = new Subject<CombatEvent>();
  public combat$ = this.combatSubject.asObservable();

  // Performance tracking
  private combatResolutions = 0;
  private criticalHits = 0;
  private totalDamageDealt = 0;

  // Damage number performance metrics
  private damageNumbersCreated = 0;
  private damageNumbersThisSecond = 0;
  private lastDamageNumberReset = Date.now();
  private peakDamageNumbersPerSecond = 0;
  private readonly DAMAGE_NUMBER_THROTTLE_THRESHOLD = 15; // Max 15 per second before throttling
  private readonly DAMAGE_NUMBER_METRICS_INTERVAL = 30000; // Report every 30 seconds

  constructor(
    private damageCalculation: DamageCalculationService,
    private effectFactory: EffectFactoryService,
    private debugLog: DebugLogBridgeService,
    private progressionSystem: ProgressionSystemService,
    private xpTracker: XPEventTrackerService,
    private performanceMonitor: PerformanceMonitorService,
    private factionStandingSystem: FactionStandingSystemService,
    private difficultyService: DifficultyService,
    private intensityService: IntensityService,
    private cameraShake: CameraShakeService,
    private postProcessing: PostProcessingService
  ) {}

  /**
   * Initialize the combat system
   */
  init(): void {
    this.resetStatistics();
  }

  /**
   * Main system update - processes pending combat resolutions
   */
  update(deltaTime: number, entityManager: EntityManager): void {
    // Start performance timer (only in development)
    const timer = MONITORING_CONFIG.ENABLED ? this.performanceMonitor.startSystemTimer('CombatSystem') : null;

    // Process entities that need death cleanup
    this.processDeaths(entityManager);

    // Process damage over time effects
    this.processDamageOverTime(deltaTime, entityManager);

    // Stop performance timer with combat resolution count
    if (timer) {
      timer.end(this.combatResolutions);
    }
  }

  /**
   * Resolve combat between two entities based on damage type
   */
  resolveCombat(
    attackerId: number,
    defenderId: number,
    damageType: CombatEvent['damageType'],
    entityManager: EntityManager,
    basePosition?: { x: number; y: number }
  ): CombatEvent | null {
    const attacker = this.getEntityCombatData(attackerId, entityManager);
    const defender = this.getEntityCombatData(defenderId, entityManager);

    if (!attacker || !defender) {
      this.debugLog.log(`CombatSystem: Invalid combat entities ${attackerId} vs ${defenderId}`, 'warning', {
        source: 'combat_system',
        attackerId,
        defenderId,
      });
      return null;
    }

    // Calculate position for combat event
    const position = basePosition || this.calculateCombatPosition(attackerId, defenderId, entityManager);

    // Calculate damage based on type
    let damage = 0;
    let isCritical = false;

    switch (damageType) {
      case 'beam':
        ({ damage, isCritical } = this.calculateBeamDamage(attacker, defender, entityManager));
        break;
      case 'projectile':
        ({ damage, isCritical } = this.calculateProjectileDamage(attacker, defender, entityManager));
        break;
      case 'kamikaze':
        damage = this.calculateKamikazeDamage(defender);
        break;
      case 'burn':
        damage = this.calculateBurnDamage(attacker, defender);
        break;
      case 'recoil':
        damage = this.calculateRecoilDamage(attacker, defender);
        break;
      case 'environmental':
        damage = this.calculateEnvironmentalDamage(attacker);
        break;
    }

    // Calculate attack angle (direction FROM attacker TO defender, used for shield checks)
    const attackAngle = Math.atan2(
      defender.position.y - attacker.position.y,
      defender.position.x - attacker.position.x
    );

    // Apply damage reduction
    const finalDamage = this.applyDamageReduction(damage, defender, attackAngle);

    // Apply damage to defender
    const defenderHealth = entityManager.getComponent(defenderId, HealthComponent);
    if (defenderHealth) {
      const previousHealth = defenderHealth.health;
      defenderHealth.health = Math.max(0, defenderHealth.health - finalDamage);
      // Tag damage source for death attribution
      defenderHealth.lastDamageSource = damageType === 'environmental' ? 'environmental' : 'player';

      // Create damage number feedback for ALL hits (not just elite enemies)
      if (this.settings.getSettings().showDamageNumbers) {
        const defenderPosition = entityManager.getComponent(defenderId, PositionComponent);
        if (defenderPosition && finalDamage > 0) {
          // Check if we should throttle damage numbers in extreme scenarios
          const shouldCreateDamageNumber = this.shouldCreateDamageNumber();

          if (shouldCreateDamageNumber) {
            // Use the isCritical flag from damage calculation, not a heuristic
            this.effectFactory.createDamageNumber(
              { x: defenderPosition.x, y: defenderPosition.y - 20 },
              Math.round(finalDamage),
              isCritical
            );
            this.trackDamageNumberCreation();
          }
        }
      }

      // Check for kill
      const isKill = defenderHealth.health === 0 && previousHealth > 0;

      // Mark entity for death processing if killed
      if (isKill) {
        this.markForDeath(defenderId, entityManager);
      }

      // Update statistics
      this.combatResolutions++;
      this.totalDamageDealt += finalDamage;
      if (isCritical) this.criticalHits++;

      // Create combat event
      const combatEvent: CombatEvent = {
        attackerId,
        defenderId,
        damage: finalDamage,
        damageType,
        isCritical,
        isKill,
        position,
        timestamp: Date.now(),
      };

      this.combatSubject.next(combatEvent);
      return combatEvent;
    }

    return null;
  }

  /**
   * Get entity combat-relevant data
   */
  private getEntityCombatData(entityId: number, entityManager: EntityManager): CombatEntityData | null {
    const health = entityManager.getComponent(entityId, HealthComponent);
    const damage = entityManager.getComponent(entityId, DamageComponent);
    const weapon = entityManager.getComponent(entityId, WeaponComponent);
    const beam = entityManager.getComponent(entityId, BeamComponent);
    const position = entityManager.getComponent(entityId, PositionComponent);
    const isPlayer = entityManager.hasComponent(entityId, PlayerControlledComponent);
    const enemyType = entityManager.getComponent(entityId, EnemyTypeComponent);
    const buff = entityManager.getComponent(entityId, BuffComponent);

    if (!health || !position) return null;

    return {
      id: entityId,
      entityId,
      health,
      damage,
      weapon,
      beam,
      position,
      isPlayer,
      enemyType,
      buff,
      playerControlled: isPlayer ? entityManager.getComponent(entityId, PlayerControlledComponent) : undefined,
      shieldArc: entityManager.getComponent(entityId, ShieldArcComponent) ?? undefined,
    };
  }

  /**
   * Calculate beam damage using existing damage calculation service
   */
  private calculateBeamDamage(
    attacker: CombatEntity,
    defender: CombatEntity,
    _entityManager: EntityManager
  ): { damage: number; isCritical: boolean } {
    if (!attacker.beam) {
      return { damage: 0, isCritical: false };
    }

    const baseDamage = attacker.beam.damage;
    const criticalChance = this.getCriticalChance(attacker);
    let isCritical = Math.random() < criticalChance;

    let damage = baseDamage;

    // Apply damage multipliers from buffs and enemy type
    damage = this.applyDamageMultipliers(damage, attacker, defender);

    // Apply critical hit
    if (isCritical) {
      const criticalMultiplier = this.getCriticalMultiplier(attacker);
      damage *= criticalMultiplier;
    }

    // Use advanced damage calculation if enabled
    if (this.config.enableAdvancedDamage && defender.enemyType) {
      const enemy = this.createEnemyFromComponents(defender);
      const calculation = this.damageCalculation.calculateBeamDamage(enemy, damage);
      damage = calculation.finalDamage;
      // Update critical status from calculation
      if (calculation.isCritical) {
        isCritical = calculation.isCritical;
      }
    }

    return { damage: Math.floor(damage), isCritical };
  }

  /**
   * Calculate projectile damage
   */
  private calculateProjectileDamage(
    attacker: CombatEntity,
    defender: CombatEntity,
    _entityManager: EntityManager
  ): { damage: number; isCritical: boolean } {
    if (!attacker.weapon) {
      return { damage: 0, isCritical: false };
    }

    const baseDamage = attacker.weapon.damage;
    const criticalChance = this.getCriticalChance(attacker);
    let isCritical = Math.random() < criticalChance;

    let damage = baseDamage;

    // Apply damage multipliers
    damage = this.applyDamageMultipliers(damage, attacker, defender);

    // Apply critical hit
    if (isCritical) {
      const criticalMultiplier = this.getCriticalMultiplier(attacker);
      damage *= criticalMultiplier;
    }

    // Use advanced damage calculation if enabled
    if (this.config.enableAdvancedDamage && defender.enemyType) {
      const projectile = { damage: damage };
      const calculation = this.damageCalculation.calculateProjectileDamage(projectile);
      damage = calculation.finalDamage;
      // Update critical status from calculation
      if (calculation.isCritical) {
        isCritical = calculation.isCritical;
      }
    }

    return { damage: Math.floor(damage), isCritical };
  }

  /**
   * Calculate kamikaze damage (percentage of enemy health)
   */
  private calculateKamikazeDamage(defender: CombatEntity): number {
    return Math.floor(defender.health.health * this.config.kamikazeDamagePercent);
  }

  /**
   * Calculate burn damage over time
   */
  private calculateBurnDamage(attacker: CombatEntity, defender: CombatEntity): number {
    // Base burn damage from attacker's damage component
    const baseBurnDamage = attacker.damage?.burnDamage || 5;

    // Apply enemy-specific burn multipliers if available
    let damage = baseBurnDamage;
    if (defender.enemyType && this.config.enableAdvancedDamage) {
      const enemy = this.createEnemyFromComponents(defender);
      const calculation = this.damageCalculation.calculateBurnDamage(enemy, damage);
      damage = calculation.finalDamage;
    }

    return Math.floor(damage);
  }

  /**
   * Calculate recoil damage
   */
  private calculateRecoilDamage(attacker: CombatEntity, defender: CombatEntity): number {
    // Recoil damage as percentage of defender's max health
    const recoilPercent = attacker.damage?.recoilPercent || 0.1;
    return Math.floor(defender.health.maxHealth * recoilPercent);
  }

  /**
   * Calculate environmental damage
   */
  private calculateEnvironmentalDamage(attacker: CombatEntity): number {
    // Environmental damage from attacker's damage component
    return attacker.damage?.environmentalDamage || 10;
  }

  /**
   * Apply damage multipliers from buffs, equipment, and enemy types
   */
  private applyDamageMultipliers(baseDamage: number, attacker: CombatEntity, defender: CombatEntity): number {
    let damage = baseDamage;

    // Apply attacker buffs (damage bonuses)
    if (attacker.buff) {
      damage *= attacker.buff.damageMultiplier;
    }

    // Apply enemy-specific damage multipliers
    if (defender.enemyType) {
      damage *= defender.enemyType.damageMultiplier || 1.0;
    }

    return damage;
  }

  /**
   * Apply damage reduction from armor, buffs, and directional shields.
   *
   * @param attackAngle - angle FROM attacker TO defender (radians). Used for directional shields.
   *                      When undefined, directional shield check is skipped.
   */
  private applyDamageReduction(damage: number, defender: CombatEntity, attackAngle?: number): number {
    let finalDamage = damage;

    // Apply health component damage reduction
    if (defender.health.damageReduction > 0) {
      finalDamage *= 1 - defender.health.damageReduction;
    }

    // Apply buff-based damage reduction
    if (defender.buff && defender.buff.damageReduction > 0) {
      finalDamage *= 1 - defender.buff.damageReduction;
    }

    // Directional shield reduction (Sentinel frontal shield)
    if (defender.shieldArc && attackAngle !== undefined) {
      // attackAngle is FROM attacker TO defender, so +π gives FROM defender TO attacker (source direction)
      const sourceAngle = attackAngle + Math.PI;
      const shieldReduction = ShieldArcComponent.getBlockReduction(defender.shieldArc, sourceAngle);
      if (shieldReduction > 0) {
        finalDamage *= 1 - shieldReduction;
        // Record the block time for visual flash feedback
        defender.shieldArc.lastBlockTime = Date.now();
      }
    }

    return Math.max(1, Math.floor(finalDamage)); // Minimum 1 damage
  }

  /**
   * Get critical hit chance for an entity
   */
  private getCriticalChance(attacker: CombatEntity): number {
    let criticalChance = this.config.baseCriticalChance;

    // Add weapon critical chance
    if (attacker.weapon && attacker.weapon.chargedShotChance) {
      criticalChance += attacker.weapon.chargedShotChance;
    }

    // Add damage component critical chance
    if (attacker.damage && attacker.damage.criticalChance) {
      criticalChance += attacker.damage.criticalChance;
    }

    // Add buff critical chance
    if (attacker.buff && attacker.buff.criticalChance) {
      criticalChance += attacker.buff.criticalChance;
    }

    return Math.min(criticalChance, 1.0); // Cap at 100%
  }

  /**
   * Get critical hit multiplier for an entity
   */
  private getCriticalMultiplier(attacker: CombatEntity): number {
    let multiplier = this.config.baseCriticalMultiplier;

    // Add damage component critical multiplier
    if (attacker.damage && attacker.damage.criticalMultiplier) {
      multiplier = attacker.damage.criticalMultiplier;
    }

    // Add buff critical multiplier
    if (attacker.buff && attacker.buff.criticalMultiplier) {
      multiplier *= attacker.buff.criticalMultiplier;
    }

    return multiplier;
  }

  /**
   * Calculate combat position (midpoint between entities)
   */
  private calculateCombatPosition(
    attackerId: number,
    defenderId: number,
    entityManager: EntityManager
  ): { x: number; y: number } {
    const attackerPos = entityManager.getComponent(attackerId, PositionComponent);
    const defenderPos = entityManager.getComponent(defenderId, PositionComponent);

    if (attackerPos && defenderPos) {
      return {
        x: (attackerPos.x + defenderPos.x) / 2,
        y: (attackerPos.y + defenderPos.y) / 2,
      };
    }

    return { x: 0, y: 0 };
  }

  /**
   * Mark entity for death processing
   */
  private markForDeath(entityId: number, entityManager: EntityManager): void {
    // Add a temporary component to mark for death cleanup
    // This will be processed in the next update cycle
    const health = entityManager.getComponent(entityId, HealthComponent);
    if (health) {
      health.isDead = true;
    }
  }

  /**
   * Process entities marked for death
   */
  private processDeaths(entityManager: EntityManager): void {
    const deadEntities = entityManager.getEntitiesWithComponents(HealthComponent).filter((entityId) => {
      const health = entityManager.getComponent(entityId, HealthComponent);
      return health && health.isDead;
    });

    // Debug log if we have dead entities
    if (deadEntities.length > 0) {
      this.debugLog.log('🔍 Processing deaths', 'info', {
        source: 'combat_system',
        operation: 'process_deaths',
        deadEntityCount: deadEntities.length,
        entities: deadEntities,
      });
    }

    for (const entityId of deadEntities) {
      // Idempotency: processDeaths runs every frame and `isDead` stays true until the entity is
      // pooled, so without this guard the death explosion, faction-standing update and XP award
      // re-fire every frame for the same kill (the "XP already awarded" spam + stacked death FX
      // that feed the effect churn). Spawn the death FX / rewards exactly once per death.
      const deathHealth = entityManager.getComponent(entityId, HealthComponent);
      if (deathHealth?.combatDeathProcessed) continue;
      if (deathHealth) deathHealth.combatDeathProcessed = true;

      // Get position for death effect
      const position = entityManager.getComponent(entityId, PositionComponent);
      const enemyType = entityManager.getComponent(entityId, EnemyTypeComponent);

      if (position && enemyType) {
        // Debug enemy death
        this.debugLog.log('💀 Enemy Killed', 'success', {
          source: 'combat_system',
          operation: 'enemy_death',
          entityId,
          enemyType: enemyType.type,
          isElite: enemyType.isElite,
          position: { x: position.x, y: position.y },
        });

        // Award XP and score to player if they killed an enemy
        this.awardKillRewards(entityId, enemyType, entityManager);

        // Get enemy faction for standing calculation
        const enemyFaction = entityManager.getComponent(entityId, FactionComponent);
        const enemyFactionId = enemyFaction?.kingId || 0;

        // Update faction standing based on kill location and enemy faction
        this.factionStandingSystem.processKill(position.x, position.y, enemyFactionId);

        // Create death explosion effect — scaled to enemy difficulty tier
        const isBoss = enemyType.type === EnemyType.Boss;
        const isElite = enemyType.isElite;

        if (isBoss) {
          // Boss: maximum spectacle
          this.effectFactory.createDeathParticles({ x: position.x, y: position.y }, enemyType.type, true, 2.5);
          this.cameraShake.addShake({ intensity: 12, duration: 300, frequency: 10, fadeOut: true });
          this.postProcessing.addScreenFlash({ color: { r: 255, g: 200, b: 0 }, opacity: 0.15, duration: 250 });
        } else if (isElite) {
          // Elite: enhanced spectacle
          this.effectFactory.createDeathParticles({ x: position.x, y: position.y }, enemyType.type, true, 1.5);
          this.cameraShake.addShake({ intensity: 5, duration: 150, frequency: 12, fadeOut: true });
        } else {
          // Regular: satisfying pop (unchanged)
          this.effectFactory.createEnemyExplosion({ x: position.x, y: position.y }, 1.0);
        }

        // Only create damage numbers for elite enemies to reduce visual clutter
        if (enemyType.isElite && this.settings.getSettings().showDamageNumbers) {
          const health = entityManager.getComponent(entityId, HealthComponent);
          if (health) {
            this.effectFactory.createDamageNumber({ x: position.x, y: position.y - 20 }, health.maxHealth, false);
          }
        }
      }
    }
  }

  /**
   * Process damage over time effects
   */
  private processDamageOverTime(deltaTime: number, entityManager: EntityManager): void {
    // Find entities with burn effects or other DoT
    const burnEntities = entityManager
      .getEntitiesWithComponents(HealthComponent, DamageComponent)
      .filter((entityId) => {
        const damage = entityManager.getComponent(entityId, DamageComponent);
        return damage && damage.burnDuration > 0;
      });

    for (const entityId of burnEntities) {
      const damage = entityManager.getComponent(entityId, DamageComponent);
      const health = entityManager.getComponent(entityId, HealthComponent);
      if (!damage || !health) continue;

      // Process burn damage
      if (damage.burnDuration > 0) {
        damage.burnDuration -= deltaTime;

        // Apply burn damage per second — skip if enemy not yet combat-ready
        if (damage.burnTickTimer <= 0) {
          const combatRenderable = entityManager.getComponent(entityId, RenderableComponent);
          if (combatRenderable && !combatRenderable.isCombatReady(window.performance.now())) {
            damage.burnTickTimer = 1000;
            continue;
          }
          const burnDamage = damage.burnDamage || 5;
          health.health = Math.round(Math.max(0, health.health - burnDamage) * 100) / 100;
          health.lastDamageSource = 'player';

          // Emit burn damage event
          const combatEvent: CombatEvent = {
            attackerId: entityId, // Self-inflicted for burn
            defenderId: entityId,
            damage: burnDamage,
            damageType: 'burn',
            isCritical: false,
            isKill: health.health === 0,
            position: { x: 0, y: 0 }, // Position not relevant for DoT
            timestamp: Date.now(),
          };

          this.combatSubject.next(combatEvent);

          // Reset burn tick timer (1 second intervals)
          damage.burnTickTimer = 1000;
        } else {
          damage.burnTickTimer -= deltaTime;
        }

        // Remove burn effect when duration expires
        if (damage.burnDuration <= 0) {
          damage.burnDuration = 0;
          damage.burnTickTimer = 0;
        }
      }
    }
  }

  /**
   * Update combat configuration
   */
  updateConfig(config: Partial<CombatConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Award kill rewards to player
   */
  private awardKillRewards(killedEntityId: number, enemyType: EnemyTypeComponent, entityManager: EntityManager): void {
    // Find player entity
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    if (playerEntities.length === 0) return;

    const playerId = playerEntities[0];
    const playerComp = entityManager.getComponent(playerId, PlayerControlledComponent);
    if (!playerComp) return;

    // CRITICAL FIX: Check if XP was already awarded to prevent duplicates
    const health = entityManager.getComponent(killedEntityId, HealthComponent);
    if (health && health.xpAwarded) {
      this.debugLog.log('⚠️ XP already awarded for this entity, skipping', 'warning', {
        source: 'combat_system',
        operation: 'xp_duplicate_prevention',
        entityId: killedEntityId,
        enemyType: enemyType.type,
      });
      return;
    }

    // Mark XP as awarded to prevent duplicates
    if (health) {
      health.xpAwarded = true;
    }

    // Get killed entity position for tracking
    const killedPosition = entityManager.getComponent(killedEntityId, PositionComponent);
    const position = killedPosition ? { x: killedPosition.x, y: killedPosition.y } : undefined;

    // Calculate base XP based on enemy type using PROGRESSION_CONFIG
    const enemyXpConfig = PROGRESSION_CONFIG.ENEMY_XP[enemyType.type as keyof typeof PROGRESSION_CONFIG.ENEMY_XP];
    const baseXp = enemyXpConfig ?? PROGRESSION_CONFIG.ENEMY_XP.basic;

    // Validate XP value
    if (baseXp <= 0) {
      this.debugLog.log(`⚠️ Invalid XP value for enemy type: ${enemyType.type}`, 'warning', {
        source: 'combat_system',
        operation: 'xp_validation',
        enemyType: enemyType.type,
        baseXp,
        defaulting: PROGRESSION_CONFIG.ENEMY_XP.basic,
      });
    }

    // Build multipliers array for tracking
    const multipliers: XPMultiplier[] = [];
    let totalMultiplier = 1.0;

    // Elite enemy multiplier
    if (enemyType.isElite) {
      multipliers.push({
        source: 'elite_enemy',
        value: PROGRESSION_CONFIG.ELITE_MULTIPLIER,
        description: 'Elite Enemy',
      });
      totalMultiplier *= PROGRESSION_CONFIG.ELITE_MULTIPLIER;
    }

    // Rarity multipliers
    if (enemyType.rarity === Rarity.Rare) {
      multipliers.push({
        source: 'rare_enemy',
        value: PROGRESSION_CONFIG.RARE_MULTIPLIER,
        description: 'Rare Enemy',
      });
      totalMultiplier *= PROGRESSION_CONFIG.RARE_MULTIPLIER;
    } else if (enemyType.rarity === Rarity.Legendary) {
      multipliers.push({
        source: 'legendary_enemy',
        value: PROGRESSION_CONFIG.LEGENDARY_MULTIPLIER,
        description: 'Legendary Enemy',
      });
      totalMultiplier *= PROGRESSION_CONFIG.LEGENDARY_MULTIPLIER;
    }

    // Check for upgrade-based XP range bonuses (pickup radius affects XP collection)
    // This would come from an upgrade system - for now we'll add a placeholder
    const xpRangeUpgrade = this.getXPRangeUpgradeMultiplier(playerId, entityManager);
    if (xpRangeUpgrade > 1) {
      multipliers.push({
        source: 'xp_range_upgrade',
        value: xpRangeUpgrade,
        description: 'XP Collection Range Bonus',
      });
      totalMultiplier *= xpRangeUpgrade;
    }

    // Intensity-based XP bonus — rewards sustained high-performance play
    const intensityXpMultiplier = this.intensityService.getXpMultiplier();
    if (intensityXpMultiplier > 1) {
      multipliers.push({
        source: 'intensity_bonus',
        value: intensityXpMultiplier,
        description: `Intensity Bonus (${((intensityXpMultiplier - 1) * 100).toFixed(0)}%)`,
      });
      totalMultiplier *= intensityXpMultiplier;
    }

    // Calculate final XP (including difficulty modifier)
    const difficultyXpMultiplier = this.difficultyService.getModifiers().xpMultiplier;
    const finalXp = Math.floor(baseXp * totalMultiplier * difficultyXpMultiplier);

    // Track the XP event
    const xpSource = enemyType.isElite
      ? XPEventSource.ELITE_KILL
      : enemyType.type === EnemyType.Boss
        ? XPEventSource.BOSS_KILL
        : XPEventSource.ENEMY_KILL;

    // Capture level before awarding XP to avoid race condition
    const levelBefore = this.progressionSystem.level;

    // Award the XP first
    this.progressionSystem.addXp(finalXp);

    // Capture level after to detect changes
    const levelAfter = this.progressionSystem.level;

    // Track XP event with accurate level tracking
    this.xpTracker.trackXPEvent(xpSource, baseXp, multipliers, {
      enemyType: enemyType.type,
      enemyId: killedEntityId,
      position,
      levelBefore,
      levelAfter: levelAfter !== levelBefore ? levelAfter : undefined,
      buffIds: [], // Will be populated when buff integration is complete
    });

    // Debug XP award
    this.debugLog.log('🎯 XP Awarded', 'success', {
      source: 'xp_system',
      operation: 'kill_reward',
      enemyType: enemyType.type,
      enemyId: killedEntityId,
      isElite: enemyType.isElite,
      baseXp,
      finalXp,
      totalMultiplier,
      multipliers: multipliers.map((m) => ({ source: m.source, value: m.value })),
      levelBefore,
      levelAfter,
      currentTotalXp: this.progressionSystem.xp,
      position,
    });

    // Calculate and log score reward
    const scoreReward = Math.floor(finalXp * 10); // Score is 10x XP
    this.debugLog.log(`Score reward: ${scoreReward}`, 'info', {
      source: 'combat_system',
      operation: 'score_reward',
      scoreReward,
    });

    // NOTE: kills and killStreak are handled by Death Detection System to avoid duplicates
    // Level ups are handled automatically by ProgressionSystemService
  }

  /**
   * Get XP range upgrade multiplier based on player upgrades
   * Returns multiplier > 1 if player is close enough to benefit from XP range upgrades
   */
  private getXPRangeUpgradeMultiplier(_playerId: number, _entityManager: EntityManager): number {
    return 1.0;
  }

  /**
   * Get combat system statistics
   */
  getCombatStats(): { resolutions: number; criticalHits: number; totalDamage: number; criticalRate: number } {
    return {
      resolutions: this.combatResolutions,
      criticalHits: this.criticalHits,
      totalDamage: this.totalDamageDealt,
      criticalRate: this.combatResolutions > 0 ? this.criticalHits / this.combatResolutions : 0,
    };
  }

  /**
   * Reset statistics
   */
  private resetStatistics(): void {
    this.combatResolutions = 0;
    this.criticalHits = 0;
    this.totalDamageDealt = 0;
    this.damageNumbersCreated = 0;
    this.damageNumbersThisSecond = 0;
    this.peakDamageNumbersPerSecond = 0;
  }

  /**
   * Check if we should create a damage number (with throttling for extreme scenarios)
   */
  private shouldCreateDamageNumber(): boolean {
    const currentTime = Date.now();

    // Reset counter every second
    if (currentTime - this.lastDamageNumberReset >= 1000) {
      // Track peak for metrics
      if (this.damageNumbersThisSecond > this.peakDamageNumbersPerSecond) {
        this.peakDamageNumbersPerSecond = this.damageNumbersThisSecond;
      }

      this.damageNumbersThisSecond = 0;
      this.lastDamageNumberReset = currentTime;
    }

    // Throttle if we're creating too many per second (performance protection)
    if (this.damageNumbersThisSecond >= this.DAMAGE_NUMBER_THROTTLE_THRESHOLD) {
      // Skip every other damage number when throttling
      return Math.random() < 0.5;
    }

    return true;
  }

  /**
   * Track damage number creation for performance metrics
   */
  private trackDamageNumberCreation(): void {
    this.damageNumbersCreated++;
    this.damageNumbersThisSecond++;

    // Report metrics periodically
    if (this.damageNumbersCreated % 100 === 0) {
      const currentTime = Date.now();
      if (currentTime - this.lastDamageNumberReset >= this.DAMAGE_NUMBER_METRICS_INTERVAL) {
        this.debugLog.log('📊 Damage Number Performance Metrics', 'info', {
          source: 'combat_system',
          totalCreated: this.damageNumbersCreated,
          peakPerSecond: this.peakDamageNumbersPerSecond,
          averagePerSecond: Math.round(this.damageNumbersCreated / (this.DAMAGE_NUMBER_METRICS_INTERVAL / 1000)),
          throttleThreshold: this.DAMAGE_NUMBER_THROTTLE_THRESHOLD,
        });
      }
    }
  }

  /**
   * Convert entity components to Enemy model for DamageCalculationService
   */
  private createEnemyFromComponents(entityData: CombatEntity): Enemy {
    return {
      id: createEnemyId(entityData.id || 0),
      x: entityData.position?.x || 0,
      y: entityData.position?.y || 0,
      vx: 0,
      vy: 0,
      radius: 20,
      type: entityData.enemyType?.type || EnemyType.Basic,
      health: entityData.health.health,
      maxHealth: entityData.health.maxHealth,
      damageMultiplier: entityData.enemyType?.damageMultiplier || 1.0,
    };
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    this.combatSubject.complete();
    this.resetStatistics();
  }
}
