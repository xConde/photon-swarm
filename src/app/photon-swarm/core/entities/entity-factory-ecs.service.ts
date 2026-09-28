import { Injectable, OnDestroy } from '@angular/core';
import { ComponentFactory } from '../factories/component-factory';
import { EntityManagerService } from '../ecs/entity-manager.service';
import type { Component, ComponentType, Entity } from '../ecs/ecs.model';
import {
  ARENA_HAZARD,
  ENEMY_STATS,
  PLAYER_CONFIG,
  POOL_CONFIG,
  PoolType,
  PROGRESSION_CONFIG,
} from '@photon/config/game-constants';
import { ThemeService } from '@services/theme.service';
import { PaletteService } from '../../services/palette.service';
import {
  Ability,
  AbilityComponent,
  AbilityType,
  AccelerationComponent,
  ActivePowerupComponent,
  AIControlledComponent,
  ArenaHazardComponent,
  AsteroidComponent,
  BeamComponent,
  BossArchetype,
  BossPhaseComponent,
  BuffComponent,
  BurnEffectComponent,
  ChargedProjectileComponent,
  ChargingComponent,
  CollisionBoxComponent,
  createFactionComponent,
  DamageComponent,
  DeathAnimationComponent,
  DischargeComponent,
  DischargeEffectComponent,
  DualChargingComponent,
  EmpPulseComponent,
  EnemyTypeComponent,
  FactionComponent,
  FallingAsteroidComponent,
  FloatingTextComponent,
  HealAuraComponent,
  HealthBarDisplayComponent,
  HealthComponent,
  HitFlashComponent,
  InvincibilityComponent,
  KnockbackComponent,
  MinionTagComponent,
  PlayerControlledComponent,
  PositionComponent,
  PowerupComponent,
  ProjectileComponent,
  RenderableComponent,
  ShardComponent,
  ShieldArcComponent,
  SourceTagComponent,
  SpawnerComponent,
  SplitOnDeathComponent,
  TeleportEffectComponent,
  TerritorialGuardianComponent,
  VelocityComponent,
  WeaponComponent,
  ZoneGateComponent,
} from '@photon/components';
import { EnemyRarity } from '@photon/components/enemy-type.component';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import { ObjectPool, ObjectPoolService } from '../utils/object-pool.service';
import { AlertState, EnemyType } from '../models/enemy.model';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { PlayerService } from '../player/player.service';
import { PooledEntityTracker } from './pooled-entity-state';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { DifficultyService } from '../../services/difficulty.service';
import { RunPressureService } from '../../services/run-pressure.service';
import { EffectsSystemService } from './effects-system.service';
import { EnemyHealthRegenSystemService } from '../systems/enemy-ai/enemy-health-regen-system.service';
import { ZoneStateService } from '../systems/world';
import { GuardianDefinition } from '../models/zone.model';

type Rarity = 'common' | 'rare' | 'legendary';

interface EnemyConfig {
  velocity: { x: number; y: number };
  health: number;
  damageReduction?: number;
  radius: number;
  color: string;
  behavior: BehaviorPattern;
  aiParams: { aggroRange: number; attackRange?: number; preferredDistance?: number };
  damage: number;
  weapon?: { fireCooldown: number; projectileSpeed: number; projectileDamage: number } | WeaponComponent;
  damageMultiplier?: number;
  speed?: number;
  shape?: string;
}

/**
 * ECS-based entity factory service that creates entities using the component system
 */
@Injectable({ providedIn: 'root' })
export class EntityFactoryECSService implements OnDestroy {
  private entityPools: Partial<Record<PoolType, ObjectPool<number>>> = {};

  private pooledEntityTracker = new PooledEntityTracker();

  // Maps entity IDs to effect IDs so associated effects can be destroyed when the entity is pooled
  private entityEffectsMap = new Map<number, string[]>();

  private cloudCleanupTimers = new Set<ReturnType<typeof setTimeout>>();

  /**
   * Rotation index across the three boss archetypes — incremented on every
   * Boss-type spawn so consecutive boss waves feel distinct without needing
   * the spawn-system to know anything about archetypes. Stays private so
   * tests reset it via service reconstruction.
   */
  private bossSpawnCount = 0;
  private static readonly BOSS_ARCHETYPE_ROTATION = ['standard', 'swarm_king', 'pyroclast'] as const;

  /**
   * Get entity from pool if available, otherwise return null
   */
  public getFromPool(poolType: PoolType): number | null {
    return this.entityPools[poolType]?.get() ?? null;
  }

  /**
   * Mark an entity as active in the pooled entity tracker
   */
  public markEntityAsActive(entityId: number): void {
    this.pooledEntityTracker.markAsActive(entityId);
  }

  constructor(
    private entityManager: EntityManagerService,
    private objectPool: ObjectPoolService,
    private progressionSystem: ProgressionSystemService,
    private playerService: PlayerService,
    private debugLog: DebugLogBridgeService,
    private themeService: ThemeService,
    private difficultyService: DifficultyService,
    private effectsSystem: EffectsSystemService,
    private enemyHealthRegenSystem: EnemyHealthRegenSystemService,
    private zoneStateService: ZoneStateService,
    private paletteService: PaletteService,
    private runPressure: RunPressureService
  ) {
    // Create entity ID pools
    this.entityPools[PoolType.PROJECTILE] = this.objectPool.createPool(
      'entity-projectiles',
      () => this.entityManager.createEntity(),
      (id) => this.removeAllComponentsFromEntity(id),
      POOL_CONFIG.MAX_SIZES.PROJECTILE
    );

    this.entityPools[PoolType.ENEMY] = this.objectPool.createPool(
      'entity-enemies',
      () => this.entityManager.createEntity(),
      (id) => this.removeAllComponentsFromEntity(id),
      POOL_CONFIG.MAX_SIZES.ENEMY
    );

    this.entityPools[PoolType.CHARGED_PROJECTILE] = this.objectPool.createPool(
      'entity-charged-projectiles',
      () => this.entityManager.createEntity(),
      (id) => this.removeAllComponentsFromEntity(id),
      POOL_CONFIG.MAX_SIZES.CHARGED_PROJECTILE
    );

    this.entityPools[PoolType.SHARD] = this.objectPool.createPool(
      'entity-shards',
      () => this.entityManager.createEntity(),
      (id) => this.removeAllComponentsFromEntity(id),
      POOL_CONFIG.MAX_SIZES.SHARD
    );

    this.entityPools[PoolType.FLOATING_TEXT] = this.objectPool.createPool(
      'entity-floating-text',
      () => this.entityManager.createEntity(),
      (id) => this.removeAllComponentsFromEntity(id),
      POOL_CONFIG.MAX_SIZES.FLOATING_TEXT
    );
  }

  /**
   * Creates a player entity with all necessary components
   */
  createPlayer(x: number, y: number): Entity {
    const player = this.entityManager.createEntity();

    this.entityManager.addComponent(player, new PositionComponent(x, y));
    this.entityManager.addComponent(player, new VelocityComponent(0, 0));
    this.entityManager.addComponent(player, new HealthComponent(100, 100));
    this.entityManager.addComponent(player, new CollisionBoxComponent(15, 'player'));
    this.entityManager.addComponent(
      player,
      new RenderableComponent(this.paletteService.getCanvas().PLAYER_COLOR, 'world')
    );
    this.entityManager.addComponent(player, new BuffComponent()); // Enable buff/debuff system for player
    // Add spawn protection with proper timestamp
    const playerComponent = new PlayerControlledComponent();
    playerComponent.isInvincible = true; // Start with spawn protection
    const spawnProtectionMs = PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS;
    playerComponent.invincibilityEndTime = Date.now() + spawnProtectionMs;
    this.entityManager.addComponent(player, playerComponent);

    // Log spawn protection for debugging
    this.debugLog.log('🛡️ Spawn protection activated', 'info', {
      source: 'entity_factory',
      operation: 'create_player',
      spawnPosition: { x, y },
      protectionDurationMs: spawnProtectionMs,
      invincibilityEndTime: playerComponent.invincibilityEndTime,
    });

    // Entity creation is the single owner for both ECS and PlayerService
    // protection so their timers start together from the same config value.
    try {
      this.playerService.activateSpawnProtection();
    } catch (error) {
      // PlayerService might not be ready yet on first game start
      if (window.debugLogBridge) {
        window.debugLogBridge.log('PlayerService not ready for spawn protection', 'info', {
          source: 'entity_factory',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Add beam weapon (also used for shift-fire projectiles)
    const beamWeapon = new WeaponComponent(
      PLAYER_CONFIG.WEAPONS.BEAM.DAMAGE,
      PLAYER_CONFIG.WEAPONS.BEAM.FIRE_RATE,
      0, // lastShotTime
      PLAYER_CONFIG.WEAPONS.BEAM.PROJECTILE_SPEED
    );
    this.entityManager.addComponent(player, beamWeapon);

    // Create beam with theme-aware colors (determined at game build time)
    const themeColors = this.paletteService.getCanvas();
    const beamBaseColor = themeColors.BEAM;
    // Charging colors: focus (melee) and movement
    const beam = new BeamComponent(
      0, // angle
      0, // rotation speed
      PLAYER_CONFIG.WEAPONS.BEAM.DAMAGE,
      PLAYER_CONFIG.WEAPONS.BEAM.LENGTH,
      PLAYER_CONFIG.WEAPONS.BEAM.WIDTH,
      false, // isDouble
      false, // activeTargeting
      undefined, // targetingStartTime
      1000, // targetingDuration
      beamBaseColor // theme-aware base color
    );
    this.entityManager.addComponent(player, beam);

    // Add discharge ability
    this.entityManager.addComponent(
      player,
      new DischargeComponent(
        PLAYER_CONFIG.WEAPONS.DISCHARGE.RADIUS,
        PLAYER_CONFIG.WEAPONS.DISCHARGE.DAMAGE,
        PLAYER_CONFIG.WEAPONS.DISCHARGE.COOLDOWN_MS
      )
    );

    // Add dual charging component for proper movement/focus charging
    this.entityManager.addComponent(player, new DualChargingComponent());

    return player;
  }

  /**
   * Creates an enemy entity based on type and modifiers
   */
  createEnemy(
    x: number,
    y: number,
    type: EnemyType,
    rarity: Rarity = 'common',
    isElite: boolean = false,
    factionId: number = 0,
    isChampion: boolean = false
  ): Entity {
    const enemy = this.entityPools[PoolType.ENEMY]?.get() ?? this.entityManager.createEntity();

    // Mark as active if it was pooled
    this.pooledEntityTracker.markAsActive(enemy);

    // Base components all enemies have
    this.entityManager.addComponent(enemy, new PositionComponent(x, y));

    // Type-specific configuration with faction momentum
    const config = this.getEnemyConfig(type, rarity, isElite, x, y, factionId, isChampion);

    this.entityManager.addComponent(enemy, new VelocityComponent(config.velocity.x, config.velocity.y));

    this.entityManager.addComponent(enemy, new AccelerationComponent(0, 1.0, 0.08, 0.12));

    this.entityManager.addComponent(enemy, new HealthComponent(config.health, config.health, config.damageReduction));

    // Pre-seed health regen tracking so the first delta on a recycled entity is never treated as a heal
    this.enemyHealthRegenSystem.initializeTracking(enemy, config.health);

    this.entityManager.addComponent(enemy, new CollisionBoxComponent(config.radius, 'enemy'));

    this.entityManager.addComponent(enemy, new RenderableComponent(config.color, 'world'));

    this.entityManager.addComponent(enemy, new BuffComponent()); // Enable buff/debuff system for enemies

    this.entityManager.addComponent(
      enemy,
      new EnemyTypeComponent(type, rarity as EnemyRarity, AlertState.Passive, isElite, 0, 1, 1, isChampion)
    );

    const enemyTypeComp = this.entityManager.getComponent(enemy, EnemyTypeComponent);
    if (enemyTypeComp) {
      const currentZone = this.zoneStateService.getCurrentZone();
      enemyTypeComp.zoneId = currentZone?.id ?? null;
    }

    this.entityManager.addComponent(
      enemy,
      new AIControlledComponent(config.behavior, undefined, config.aiParams.aggroRange)
    );

    // FIXED: config.damage is already multiplied by all modifiers in getEnemyConfig
    // Don't multiply again!
    this.entityManager.addComponent(
      enemy,
      new DamageComponent(
        config.damage, // Already includes all multipliers
        'contact'
      )
    );

    // Add weapon for ranged enemies
    if ('weapon' in config && config.weapon) {
      this.entityManager.addComponent(enemy, config.weapon);
    }

    // Swarm multiplication (#216) DISABLED pending redesign. Swarm enemies are
    // themselves spawned by the SpawnerComponent below, so giving every swarm a
    // 5s '3-minion' spawner compounded exponentially to the 50-enemy cap, and
    // split-on-death added 2 more per kill that died instantly in the beam (the
    // "wall of jellyfish" + ghost-on-death that degraded the game). Re-introduce
    // later with a non-recursive minion type and a hard per-owner cap.
    // if (type === EnemyType.Swarm) {
    //   this.entityManager.addComponent(enemy, new SpawnerComponent('swarm', 5000, Date.now(), 3));
    //   this.entityManager.addComponent(enemy, new SplitOnDeathComponent());
    // }

    // Add EMP pulse component for disruptor enemies
    if (type === EnemyType.Disruptor) {
      this.entityManager.addComponent(enemy, new EmpPulseComponent());
    }

    // Add shield arc component for sentinel enemies
    if (type === EnemyType.Sentinel) {
      this.entityManager.addComponent(enemy, new ShieldArcComponent());
      // Sprint B3: Sentinels project a passive heal aura on a 1.5s tick.
      this.entityManager.addComponent(enemy, new HealAuraComponent());
    }

    // Base (non-elite) Spitters get a slow BURST_FIRE volley to telegraph their role.
    // 12000ms cooldown (vs 5000ms for elites) makes it rare enough to feel special.
    if (!isChampion && !isElite && type === EnemyType.Spitter) {
      const baseSpitterAbilityComp = ComponentFactory.createAbilityComponent([
        { type: AbilityType.BURST_FIRE, cooldownMs: 12000, lastUsedTime: 0 },
      ]);
      this.entityManager.addComponent(enemy, baseSpitterAbilityComp);
    }

    // Add abilities for bosses, champions, and special enemies
    if (isChampion) {
      const abilities = this.getChampionAbilities(type);
      const abilityComp = ComponentFactory.createAbilityComponent(abilities);
      this.entityManager.addComponent(enemy, abilityComp);
    } else if (type === EnemyType.Boss || isElite || type === EnemyType.Disruptor) {
      let abilities: Ability[];

      if (type === EnemyType.Boss) {
        // Select archetype BEFORE abilities so the loadout can branch on it.
        // Rotate: Wave 1 = standard, Wave 2 = swarm_king, Wave 3 = pyroclast, …
        const archetype: BossArchetype =
          EntityFactoryECSService.BOSS_ARCHETYPE_ROTATION[
            this.bossSpawnCount % EntityFactoryECSService.BOSS_ARCHETYPE_ROTATION.length
          ];
        this.bossSpawnCount++;

        abilities = this.getBossAbilities(archetype);

        if (abilities.length > 0) {
          const abilityComp = ComponentFactory.createAbilityComponent(abilities);
          this.entityManager.addComponent(enemy, abilityComp);

          const bossPhase = new BossPhaseComponent(undefined, undefined, undefined, archetype);
          // Capture base speed from config for multiplier calculations
          bossPhase.baseSpeed = config.speed ?? ENEMY_STATS.boss.SPEED;
          // Capture base cooldowns from abilities
          bossPhase.baseCooldowns = abilities.map((a) => a.cooldownMs);
          // Capture base weapon fire rate for phase multiplier calculations
          const weapon = this.entityManager.getComponent(enemy, WeaponComponent);
          if (weapon) {
            bossPhase.baseFireRate = weapon.fireRate;
          }
          this.entityManager.addComponent(enemy, bossPhase);
        }
      } else {
        // Elite / Disruptor — route through the existing generic helper
        abilities = this.getAbilitiesForEnemyType(type, isElite);
        if (abilities.length > 0) {
          const abilityComp = ComponentFactory.createAbilityComponent(abilities);
          this.entityManager.addComponent(enemy, abilityComp);
        }
      }
    }

    // Add faction component if faction ID provided
    if (factionId > 0) {
      const factionComponent = createFactionComponent(factionId);
      if (factionComponent) {
        this.entityManager.addComponent(enemy, factionComponent);
      } else {
        // Debug log when faction creation fails
        if (window.debugLogBridge) {
          window.debugLogBridge.log('⚠️ Faction Creation Failed', 'warning', {
            source: 'entity_factory',
            entity: enemy,
            factionId: factionId,
            type: type,
          });
        }
      }
    }

    return enemy;
  }

  /**
   * Creates a guardian entity from a GuardianDefinition.
   *
   * Builds on top of createEnemy() and layers in:
   * - TerritorialGuardianComponent (home position, leash, aggro, cache link)
   * - BehaviorPattern.TerritorialGuardian override on AIControlledComponent
   * - Position snapped to the guardian's home coordinates
   * - Health and damage multiplied by the definition's multipliers
   */
  createGuardian(def: GuardianDefinition): number {
    const enemyType = def.enemyType as EnemyType;
    const entityId = this.createEnemy(def.homeX, def.homeY, enemyType, 'rare', true);

    // Override position to exact home coordinates
    const pos = this.entityManager.getComponent(entityId, PositionComponent);
    if (pos) {
      pos.x = def.homeX;
      pos.y = def.homeY;
    }

    // Apply health multiplier and re-seed regen tracking so the boost isn't read as a heal
    const health = this.entityManager.getComponent(entityId, HealthComponent);
    if (health) {
      health.maxHealth = Math.round(health.maxHealth * def.healthMultiplier);
      health.health = health.maxHealth;
      this.enemyHealthRegenSystem.initializeTracking(entityId, health.health);
    }

    // Apply damage multiplier
    const damage = this.entityManager.getComponent(entityId, DamageComponent);
    if (damage) {
      damage.contactDamage = damage.contactDamage * def.damageMultiplier;
    }

    // Override AI behavior to territorial guardian pattern
    const ai = this.entityManager.getComponent(entityId, AIControlledComponent);
    if (ai) {
      ai.behaviorPattern = BehaviorPattern.TerritorialGuardian;
      ai.originalBehaviorPattern = BehaviorPattern.TerritorialGuardian;
    }

    // Attach territorial guardian state
    this.entityManager.addComponent(
      entityId,
      new TerritorialGuardianComponent(
        def.homeX,
        def.homeY,
        def.leashRadius,
        def.aggroRadius,
        def.guardedCacheId,
        def.zoneId,
        def.rankTier
      )
    );

    return entityId;
  }

  /**
   * Creates an enemy projectile entity
   */
  createEnemyProjectile(x: number, y: number, vx: number, vy: number, damage: number, _sourceEntityId: number): Entity {
    return this.createProjectile(x, y, vx, vy, damage, 'enemy', this.paletteService.getCanvas().ENEMY_PROJECTILE);
  }

  /**
   * Creates a poison cloud area effect entity
   */
  createPoisonCloud(x: number, y: number): Entity {
    const cloud = this.entityManager.createEntity();

    this.entityManager.addComponent(cloud, new PositionComponent(x, y));
    this.entityManager.addComponent(cloud, new CollisionBoxComponent(50, 'hazard'));
    this.entityManager.addComponent(
      cloud,
      new RenderableComponent(this.paletteService.getCanvas().POISON_CLOUD, 'effects', 0.5)
    );
    this.entityManager.addComponent(cloud, new DamageComponent(2, 'poison')); // 2 damage per tick

    // Auto-destroy after 5 seconds
    const cloudTimer = setTimeout(() => {
      this.cloudCleanupTimers.delete(cloudTimer);
      if (this.entityManager.hasEntity(cloud)) {
        this.entityManager.destroyEntity(cloud);
      }
    }, 5000);
    this.cloudCleanupTimers.add(cloudTimer);

    return cloud;
  }

  /**
   * Creates a projectile entity
   */
  createProjectile(
    x: number,
    y: number,
    vx: number,
    vy: number,
    damage: number,
    source: 'player' | 'enemy',
    color: string = '#ffff00'
  ): Entity {
    const projectile = this.entityPools[PoolType.PROJECTILE]?.get() ?? this.entityManager.createEntity();

    // Mark as active if it was pooled
    this.pooledEntityTracker.markAsActive(projectile);

    this.entityManager.addComponent(projectile, new PositionComponent(x, y));
    this.entityManager.addComponent(projectile, new VelocityComponent(vx, vy));
    this.entityManager.addComponent(projectile, new CollisionBoxComponent(4, 'projectile'));
    this.entityManager.addComponent(projectile, new RenderableComponent(color, 'effects'));
    this.entityManager.addComponent(
      projectile,
      new ProjectileComponent(
        damage,
        2500, // Increased from 2000ms for slightly more range
        window.performance.now(), // FIX: Use performance.now() consistently with projectile-system
        1, // health
        false, // penetrating
        false, // homing - disabled by default
        false // isCritical
      )
    );
    this.entityManager.addComponent(projectile, new DamageComponent(damage, 'projectile'));

    // Add source tag - ensure clean state (no reflected flag)
    const sourceTag = new SourceTagComponent(source);
    sourceTag.isReflected = false; // Explicitly clear reflection state for pooled entities
    this.entityManager.addComponent(projectile, sourceTag);

    return projectile;
  }

  /**
   * Creates a charged projectile entity with all effects applied upfront
   */
  createChargedProjectile(
    x: number,
    y: number,
    vx: number,
    vy: number,
    damage: number,
    chargeLevel: number,
    source: 'player' | 'enemy',
    color?: string
  ): Entity {
    // Use theme-aware default color if not specified
    const projectileColor = color ?? this.paletteService.getCanvas().ACCENT_CYAN;
    // Create base projectile from pool
    const projectile = this.entityPools[PoolType.CHARGED_PROJECTILE]?.get() ?? this.entityManager.createEntity();

    // Mark as active if it was pooled
    this.pooledEntityTracker.markAsActive(projectile);

    // Apply charged scaling to damage
    const chargedDamage = damage * (1 + chargeLevel * PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.BASE_DAMAGE_MULTIPLIER);

    // Size scaling: Start at base size and grow based on charge
    // At 0% charge: baseRadius * 0.8 (smaller than normal)
    // At 100% charge: baseRadius * 1.2 (20% larger than normal)
    const baseRadius = 4;
    const minSizeMultiplier = 0.8;
    const maxSizeMultiplier = PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.MAX_SIZE_MULTIPLIER;
    const sizeMultiplier = minSizeMultiplier + (maxSizeMultiplier - minSizeMultiplier) * chargeLevel;
    const chargedRadius = baseRadius * sizeMultiplier;

    // Position and velocity components
    this.entityManager.addComponent(projectile, new PositionComponent(x, y));
    this.entityManager.addComponent(projectile, new VelocityComponent(vx, vy));

    // Scaled collision box
    this.entityManager.addComponent(projectile, new CollisionBoxComponent(chargedRadius, 'projectile'));

    // Enhanced visual rendering
    const renderable = new RenderableComponent(projectileColor, 'effects');
    renderable.glowIntensity = 1 + chargeLevel * 2; // More glow with charge
    renderable.renderLayer = 'effects'; // Ensure it renders on effects layer
    this.entityManager.addComponent(projectile, renderable);

    // Projectile component with enhanced damage
    this.entityManager.addComponent(
      projectile,
      new ProjectileComponent(
        chargedDamage,
        2500, // Increased from 2000ms for slightly more range
        window.performance.now(), // FIX: Use performance.now() consistently with projectile-system
        1, // health
        false, // penetrating
        false, // homing - disabled for player projectiles
        false // isCritical
      )
    );

    // Damage component
    this.entityManager.addComponent(projectile, new DamageComponent(chargedDamage, 'projectile'));

    // Add charged projectile component for special effects
    if (chargeLevel >= PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.CHARGE_THRESHOLD) {
      this.entityManager.addComponent(
        projectile,
        new ChargedProjectileComponent(
          chargeLevel,
          PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.BASE_DAMAGE_MULTIPLIER,
          projectileColor,
          true // is charged
        )
      );
    }

    // Add source tag - ensure clean state (no reflected flag)
    const sourceTag = new SourceTagComponent(source);
    sourceTag.isReflected = false; // Explicitly clear reflection state for pooled entities
    this.entityManager.addComponent(projectile, sourceTag);

    return projectile;
  }

  /**
   * Creates a shard (collectible XP orb) entity
   * TUNED: Colors distinct from charging orbs, visible in both light/dark modes
   */
  createShard(x: number, y: number, value: number = 1): Entity {
    const shard = this.entityPools[PoolType.SHARD]?.get() ?? this.entityManager.createEntity();

    // Mark as active if it was pooled
    this.pooledEntityTracker.markAsActive(shard);

    this.entityManager.addComponent(shard, new PositionComponent(x, y));
    this.entityManager.addComponent(shard, new VelocityComponent(0, 0));
    // Shard appearance based on value — sized for clear pickup feedback
    const radius = Math.min(5 + value * 0.6, 10); // 5-10 radius for clear visibility
    this.entityManager.addComponent(shard, new CollisionBoxComponent(radius, 'shard'));

    // XP orb colors - distinct from charging (purple/pink) and enemies
    // Theme-aware colors that work in both light and dark modes
    const canvasColors = this.paletteService.getCanvas();
    const color = value > 5 ? canvasColors.SHARD_HIGH : value > 2 ? canvasColors.SHARD_MED : canvasColors.SHARD_LOW;
    // High value: Green tones - rare, exciting
    // Medium value: Gold/bronze tones - rewarding feel
    // Low value: Blue/cyan tones - distinct from charging effects

    this.entityManager.addComponent(shard, new RenderableComponent(color, 'world'));

    this.entityManager.addComponent(shard, new ShardComponent(value, Date.now(), Math.random() * Math.PI * 2));

    return shard;
  }

  /**
   * Adds a burn effect to an existing entity
   */
  addBurnEffect(entity: Entity, damage: number, duration: number, canSpread = false): void {
    if (!this.entityManager.hasComponent(entity, BurnEffectComponent)) {
      this.entityManager.addComponent(entity, new BurnEffectComponent(damage, duration, Date.now(), 0, 1, canSpread));
    }
  }

  /**
   * Returns the ability loadout for a specific boss archetype.
   * Each archetype has a distinct set of abilities so back-to-back bosses
   * play meaningfully differently.
   *
   *   standard  — canonical Void Tyrant kit (area buff + heal + shield + grab)
   *   swarm_king — summoner / support (minions + hive mind + heal + grab)
   *   pyroclast  — aggressive bruiser (ember cloud + damage buff + charge + shield)
   */
  private getBossAbilities(archetype: BossArchetype): Ability[] {
    switch (archetype) {
      // `standard` doubles as the default so an unmapped future archetype
      // falls back to the canonical loadout instead of returning undefined
      // and crashing on abilities.map() (red-team Finding 2 — the union has
      // no exhaustiveness check so that would otherwise ship silently).
      default:
      case 'standard':
        return [
          {
            type: AbilityType.AREA_BUFF,
            cooldownMs: 8000,
            lastUsedTime: 0,
            range: 300,
            duration: 5000,
            strength: 1.2,
          },
          {
            type: AbilityType.AREA_HEAL,
            cooldownMs: 12000,
            lastUsedTime: 0,
            range: 250,
            strength: 0.1,
          },
          {
            type: AbilityType.SHIELD_GENERATION,
            cooldownMs: 15000,
            lastUsedTime: 0,
            duration: 2000,
          },
          {
            type: AbilityType.TENTACLE_GRAB,
            cooldownMs: 6000,
            lastUsedTime: 0,
            range: 150,
            duration: 2000,
          },
        ];

      case 'swarm_king':
        return [
          {
            type: AbilityType.SUMMON_MINIONS,
            cooldownMs: 8000,
            lastUsedTime: 0,
            range: 80,
          },
          {
            type: AbilityType.HIVE_MIND,
            cooldownMs: 12000,
            lastUsedTime: 0,
            range: 250,
            duration: 5000,
            strength: 0.3,
          },
          {
            type: AbilityType.AREA_HEAL,
            cooldownMs: 11000,
            lastUsedTime: 0,
            range: 280,
            strength: 0.1,
          },
          {
            type: AbilityType.TENTACLE_GRAB,
            cooldownMs: 7000,
            lastUsedTime: 0,
            range: 150,
            duration: 2000,
          },
        ];

      case 'pyroclast':
        return [
          {
            type: AbilityType.POISON_CLOUD,
            cooldownMs: 9000,
            lastUsedTime: 0,
            range: 200,
          },
          {
            type: AbilityType.AREA_BUFF,
            cooldownMs: 8000,
            lastUsedTime: 0,
            range: 300,
            duration: 5000,
            strength: 1.3,
          },
          {
            type: AbilityType.CHARGE_ATTACK,
            cooldownMs: 7000,
            lastUsedTime: 0,
            range: 250,
            damage: 25,
          },
          {
            type: AbilityType.SHIELD_GENERATION,
            cooldownMs: 15000,
            lastUsedTime: 0,
            duration: 1500,
          },
        ];
    }
  }

  /**
   * Get abilities for enemy types
   */
  private getAbilitiesForEnemyType(type: EnemyType, isElite: boolean): Ability[] {
    const abilities: Ability[] = [];

    // Disruptor (Static Wraith) always gets TELEPORT_BLINK — hit-and-run EMP pulser.
    // This branch fires regardless of isElite, placed before the Boss/isElite block.
    if (type === EnemyType.Disruptor) {
      abilities.push({
        type: AbilityType.TELEPORT_BLINK,
        cooldownMs: 5000,
        lastUsedTime: 0,
        range: 320,
      });
      return abilities;
    }

    if (isElite) {
      // Elite enemies get one or two abilities based on their type
      switch (type) {
        case EnemyType.Spitter:
          abilities.push({
            type: AbilityType.BURST_FIRE,
            cooldownMs: 5000,
            lastUsedTime: 0,
          });
          break;
        case EnemyType.Tank:
          abilities.push({
            type: AbilityType.SHELL_RETREAT,
            cooldownMs: 8000,
            lastUsedTime: 0,
            duration: 1500,
          });
          abilities.push({
            type: AbilityType.SUMMON_MINIONS,
            cooldownMs: 7000,
            lastUsedTime: 0,
            range: 60,
          });
          break;
        case EnemyType.Thug:
          abilities.push({
            type: AbilityType.CLAW_SLAM,
            cooldownMs: 6000,
            lastUsedTime: 0,
            range: 200,
            damage: 20,
          });
          abilities.push({
            type: AbilityType.ENRAGE,
            cooldownMs: 30000, // Only when low health
            lastUsedTime: 0,
            duration: 10000,
          });
          break;
        case EnemyType.Sniper:
          abilities.push({
            type: AbilityType.LURE_STUN,
            cooldownMs: 7000,
            lastUsedTime: 0,
            duration: 1000,
            range: 300,
          });
          abilities.push({
            type: AbilityType.TELEPORT_BLINK,
            cooldownMs: 5000,
            lastUsedTime: 0,
            range: 320,
          });
          break;
      }
    }

    return abilities;
  }

  /**
   * Get champion abilities — always exactly 2, type-specific
   */
  private getChampionAbilities(type: EnemyType): Ability[] {
    switch (type) {
      case EnemyType.Basic:
        return [
          {
            type: AbilityType.RALLY_CRY,
            cooldownMs: 15000,
            lastUsedTime: 0,
            range: 200,
            duration: 5000,
            strength: 0.3,
          },
          { type: AbilityType.ENRAGE, cooldownMs: 30000, lastUsedTime: 0, duration: 10000 },
        ];
      case EnemyType.Spitter:
        return [
          { type: AbilityType.VOLLEY, cooldownMs: 8000, lastUsedTime: 0, range: 400, damage: 12 },
          { type: AbilityType.ACID_POOL, cooldownMs: 12000, lastUsedTime: 0, range: 200, damage: 3, duration: 3000 },
        ];
      case EnemyType.Tank:
        return [
          { type: AbilityType.EARTHQUAKE, cooldownMs: 10000, lastUsedTime: 0, range: 100, duration: 1000 },
          { type: AbilityType.IRON_SKIN, cooldownMs: 15000, lastUsedTime: 0, duration: 4000, strength: 0.5 },
        ];
      case EnemyType.Swarm:
        return [
          { type: AbilityType.HIVE_MIND, cooldownMs: 20000, lastUsedTime: 0 },
          {
            type: AbilityType.FRENZY_AURA,
            cooldownMs: 12000,
            lastUsedTime: 0,
            range: 200,
            duration: 5000,
            strength: 0.4,
          },
        ];
      case EnemyType.Thug:
        return [
          { type: AbilityType.GROUND_SLAM, cooldownMs: 8000, lastUsedTime: 0, range: 150 },
          { type: AbilityType.BLOOD_RAGE, cooldownMs: 15000, lastUsedTime: 0, duration: 8000, strength: 0.2 },
        ];
      case EnemyType.Sniper:
        return [
          { type: AbilityType.PIERCING_SHOT, cooldownMs: 10000, lastUsedTime: 0, range: 600, damage: 50 },
          { type: AbilityType.CLOAKING, cooldownMs: 20000, lastUsedTime: 0, duration: 3000 },
        ];
      default:
        return [
          { type: AbilityType.ENRAGE, cooldownMs: 30000, lastUsedTime: 0, duration: 10000 },
          { type: AbilityType.CHARGE_ATTACK, cooldownMs: 8000, lastUsedTime: 0, range: 200 },
        ];
    }
  }

  /**
   * Helper method to get enemy configuration based on type
   */
  private getEnemyConfig(
    type: EnemyType,
    rarity: Rarity,
    isElite: boolean,
    x: number = 0,
    y: number = 0,
    _factionId: number = 0,
    isChampion: boolean = false
  ): EnemyConfig {
    // BALANCE: Champion supersedes elite for multiplier — champion is 3x, elite is 2x
    const championMultiplier = isChampion ? PROGRESSION_CONFIG.CHAMPION_MULTIPLIER : 1;
    const eliteMultiplier = !isChampion && isElite ? 2 : 1;
    const rarityMultiplier = rarity === 'rare' ? 1.5 : rarity === 'legendary' ? 2 : 1;

    // BALANCE: Scale with player level for difficulty progression (8% per level)
    const playerLevel = this.progressionSystem.level;
    const levelMultiplier = 1 + (playerLevel - 1) * 0.08; // 8% per level for better late-game scaling

    // ZONE: Scale base stats by zone difficulty (1.0 / 1.3 / 1.7 / 2.2). Applied before
    // rarity/elite/champion so those multipliers stack on top of the zone baseline.
    const currentZone = this.zoneStateService.getCurrentZone();
    const zoneMultiplier = currentZone?.difficultyMultiplier ?? 1.0;

    // Get momentum multiplier based on faction (default to 1.0 if no momentum system)
    const momentumMultiplier = 1.0; // Territory momentum is handled elsewhere, not here

    // Use neutral color - actual faction colors are handled by sprite rendering
    // The RenderableComponent color is only used for fallback/legacy rendering
    const factionColor = this.themeService.isDayMode ? '#696969' : '#999999'; // Theme-aware neutral

    const baseConfigs = {
      [EnemyType.Basic]: {
        health: ENEMY_STATS.basic.HEALTH,
        damage: ENEMY_STATS.basic.DAMAGE,
        speed: ENEMY_STATS.basic.SPEED,
        radius: ENEMY_STATS.basic.RADIUS,
        color: factionColor,
        shape: 'circle' as const,
        behavior: BehaviorPattern.Direct,
        damageReduction: ENEMY_STATS.basic.DAMAGE_REDUCTION,
      },
      [EnemyType.Spitter]: {
        health: ENEMY_STATS.spitter.HEALTH,
        damage: ENEMY_STATS.spitter.DAMAGE,
        speed: ENEMY_STATS.spitter.SPEED,
        radius: ENEMY_STATS.spitter.RADIUS,
        color: factionColor,
        shape: 'circle' as const,
        behavior: BehaviorPattern.Ranged,
        damageReduction: ENEMY_STATS.spitter.DAMAGE_REDUCTION,
        weapon: new WeaponComponent(
          ENEMY_STATS.spitter.WEAPON.DAMAGE,
          ENEMY_STATS.spitter.WEAPON.FIRE_RATE,
          0,
          ENEMY_STATS.spitter.WEAPON.RANGE
        ),
      },
      [EnemyType.Tank]: {
        health: ENEMY_STATS.tank.HEALTH,
        damage: ENEMY_STATS.tank.DAMAGE,
        speed: ENEMY_STATS.tank.SPEED,
        radius: ENEMY_STATS.tank.RADIUS,
        color: factionColor,
        shape: 'hexagon' as const,
        behavior: BehaviorPattern.Charger,
        damageReduction: ENEMY_STATS.tank.DAMAGE_REDUCTION,
      },
      [EnemyType.Swarm]: {
        health: ENEMY_STATS.swarm.HEALTH,
        damage: ENEMY_STATS.swarm.DAMAGE,
        speed: ENEMY_STATS.swarm.SPEED,
        radius: ENEMY_STATS.swarm.RADIUS,
        color: factionColor,
        shape: 'circle' as const,
        behavior: BehaviorPattern.Swarm,
        damageReduction: ENEMY_STATS.swarm.DAMAGE_REDUCTION,
      },
      [EnemyType.Thug]: {
        health: ENEMY_STATS.thug.HEALTH,
        damage: ENEMY_STATS.thug.DAMAGE,
        speed: ENEMY_STATS.thug.SPEED,
        radius: ENEMY_STATS.thug.RADIUS,
        color: factionColor,
        shape: 'circle' as const,
        behavior: BehaviorPattern.Aggressive,
        damageReduction: ENEMY_STATS.thug.DAMAGE_REDUCTION,
      },
      [EnemyType.Sniper]: {
        health: ENEMY_STATS.sniper.HEALTH,
        damage: ENEMY_STATS.sniper.DAMAGE,
        speed: ENEMY_STATS.sniper.SPEED,
        radius: ENEMY_STATS.sniper.RADIUS,
        color: factionColor,
        shape: 'circle' as const,
        behavior: BehaviorPattern.Sniper,
        damageReduction: ENEMY_STATS.sniper.DAMAGE_REDUCTION,
        weapon: new WeaponComponent(
          ENEMY_STATS.sniper.WEAPON.DAMAGE,
          ENEMY_STATS.sniper.WEAPON.FIRE_RATE,
          0,
          ENEMY_STATS.sniper.WEAPON.RANGE
        ),
      },
      [EnemyType.Boss]: {
        health: ENEMY_STATS.boss.HEALTH,
        damage: ENEMY_STATS.boss.DAMAGE,
        speed: ENEMY_STATS.boss.SPEED,
        radius: ENEMY_STATS.boss.RADIUS,
        color: factionColor,
        shape: 'hexagon' as const,
        behavior: BehaviorPattern.Boss,
        damageReduction: ENEMY_STATS.boss.DAMAGE_REDUCTION,
        weapon: new WeaponComponent(
          ENEMY_STATS.boss.WEAPON.DAMAGE,
          ENEMY_STATS.boss.WEAPON.FIRE_RATE,
          0,
          ENEMY_STATS.boss.WEAPON.RANGE,
          ENEMY_STATS.boss.WEAPON.SPREAD,
          this.paletteService.getCanvas().EFFECT_COLOR,
          ENEMY_STATS.boss.WEAPON.COOLDOWN,
          ENEMY_STATS.boss.WEAPON.BURST_COUNT
        ),
      },
      [EnemyType.Disruptor]: {
        health: ENEMY_STATS.disruptor.HEALTH,
        damage: ENEMY_STATS.disruptor.DAMAGE,
        speed: ENEMY_STATS.disruptor.SPEED,
        radius: ENEMY_STATS.disruptor.RADIUS,
        color: factionColor,
        shape: 'circle' as const,
        behavior: BehaviorPattern.Disruptor,
        damageReduction: ENEMY_STATS.disruptor.DAMAGE_REDUCTION,
      },
      [EnemyType.Sentinel]: {
        health: ENEMY_STATS.sentinel.HEALTH,
        damage: ENEMY_STATS.sentinel.DAMAGE,
        speed: ENEMY_STATS.sentinel.SPEED,
        radius: ENEMY_STATS.sentinel.RADIUS,
        color: factionColor,
        shape: 'hexagon' as const, // Bulky/angular appearance
        behavior: BehaviorPattern.Sentinel,
        damageReduction: ENEMY_STATS.sentinel.DAMAGE_REDUCTION,
      },
    };

    const config = baseConfigs[type];

    // Apply all modifiers including zone difficulty, level scaling, and momentum.
    // Zone multiplier is innermost (applied to base stats first); rarity/elite/champion scale on top.
    // FIX: Validate multipliers before applying to prevent health corruption
    const combinedMultiplier =
      zoneMultiplier * championMultiplier * eliteMultiplier * rarityMultiplier * levelMultiplier * momentumMultiplier;
    const validMultiplier = isFinite(combinedMultiplier) && combinedMultiplier > 0 && combinedMultiplier <= 30;

    if (!validMultiplier && window.debugLogBridge) {
      window.debugLogBridge.log('Invalid enemy multiplier - using base stats', 'warning', {
        source: 'entity_factory',
        combinedMultiplier,
        zoneMultiplier,
        championMultiplier,
        eliteMultiplier,
        rarityMultiplier,
        levelMultiplier,
        momentumMultiplier,
      });
    }

    // Apply difficulty modifiers
    const diffMods = this.difficultyService.getModifiers();
    const runMods = this.runPressure.getModifiers();

    // FIX: Calculate modified stats with validation and caps to prevent overflow
    const modifiedHealth = validMultiplier
      ? Math.min(config.health * combinedMultiplier * diffMods.enemyHealthMultiplier * runMods.enemyHealth, 15000) // Cap at 15000 to accommodate high-tier guardians
      : config.health;
    const modifiedDamage = validMultiplier
      ? Math.min(config.damage * combinedMultiplier * diffMods.enemyDamageMultiplier * runMods.enemyDamage, 500) // Cap at 500 to prevent overflow
      : config.damage;

    // Calculate initial velocity towards center (from spawn position)
    const centerX = 6000; // World center for 12000 width
    const centerY = 4500; // World center for 9000 height
    const angle = Math.atan2(centerY - y, centerX - x);
    const speed = config.speed * diffMods.enemySpeedMultiplier * runMods.enemySpeed;

    return {
      ...config,
      health: modifiedHealth,
      damage: modifiedDamage,
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
      },
      damageMultiplier: validMultiplier ? combinedMultiplier : 1,
      aiParams: {
        // Use ENEMY_STATS AGGRO_RANGE instead of hardcoded values
        aggroRange: ENEMY_STATS[type]?.AGGRO_RANGE ?? 600,
        attackRange: 'weapon' in config && config.weapon ? 500 : 50,
        preferredDistance: type === EnemyType.Sniper ? 600 : type === EnemyType.Spitter ? 300 : 0,
      },
    };
  }

  /**
   * Register an effect ID as belonging to an entity.
   * When the entity is returned to the pool, all registered effects are destroyed.
   */
  public registerEntityEffect(entityId: number, effectId: string): void {
    const existing = this.entityEffectsMap.get(entityId);
    if (existing) {
      existing.push(effectId);
    } else {
      this.entityEffectsMap.set(entityId, [effectId]);
    }
  }

  /**
   * Destroy all effects associated with an entity and remove the mapping.
   */
  private destroyEntityEffects(entityId: number): void {
    const effectIds = this.entityEffectsMap.get(entityId);
    if (!effectIds) return;
    for (const effectId of effectIds) {
      try {
        this.effectsSystem.destroyEffect(effectId);
      } catch {
        // Effect cleanup must never prevent entity pool return
      }
    }
    this.entityEffectsMap.delete(entityId);
  }

  /**
   * Return an entity to the pool for reuse
   */
  returnToPool(type: PoolType, entityId: number): void {
    // Destroy associated effects before pooling to prevent infinite-duration leaks
    this.destroyEntityEffects(entityId);

    // Defensive check - don't pool already pooled entities
    if (this.pooledEntityTracker.isPooled(entityId)) {
      this.debugLog.log(`⚠️ Entity ${entityId} is already pooled!`, 'warning', {
        source: 'entity_factory',
        entityId,
        poolType: type,
      });
      return;
    }

    // Don't pool entities that don't exist
    if (!this.entityManager.hasEntity(entityId)) {
      return;
    }

    // Validate entity has expected component before pooling
    const hasExpectedComponent = this.validateEntityType(entityId, type);
    if (!hasExpectedComponent) {
      this.debugLog.log(`⚠️ Entity ${entityId} missing expected component for pool type ${type}`, 'warning', {
        source: 'entity_factory',
        entityId,
        poolType: type,
      });
    }

    // Remove all components first
    this.removeAllComponentsFromEntity(entityId);

    // Release to pool first
    const pool = this.entityPools[type];
    if (pool) {
      // Check if pool is full
      const poolStats = pool.getStats();
      if (poolStats.poolSize >= this.getMaxPoolSize(type)) {
        // Pool is full, just destroy the entity
        this.entityManager.destroyEntity(entityId);
        this.debugLog.log(`🗑️ Pool ${type} is full, destroying entity ${entityId}`, 'info', {
          source: 'entity_factory',
          entityId,
          poolType: type,
          poolSize: poolStats.poolSize,
          maxSize: this.getMaxPoolSize(type),
        });
        return;
      }

      pool.release(entityId);
      // Mark as pooled AFTER successful release
      this.pooledEntityTracker.markAsPooled(entityId, type);
    } else {
      // No pool available, destroy entity
      this.entityManager.destroyEntity(entityId);
    }
  }

  /**
   * Helper to remove all components from an entity without destroying it
   */
  private removeAllComponentsFromEntity(entityId: number): void {
    // Try to get components directly from entity manager for efficiency
    const entityComponents = this.entityManager.getComponents(entityId);
    if (entityComponents) {
      // Call destroy() on components that implement it before removing
      entityComponents.forEach((component) => {
        if (component && typeof (component as { destroy?: () => void }).destroy === 'function') {
          (component as { destroy: () => void }).destroy();
        }
      });
      // More efficient: iterate through actual components
      entityComponents.forEach((_, componentType) => {
        this.entityManager.removeComponent(entityId, componentType);
      });
    } else {
      // Fallback: check all known component types. Annotate explicitly so TS
      // sees a uniform ComponentType<Component> instead of the union of each
      // constructor type — otherwise hasComponent/removeComponent (which take
      // a single ComponentType<T>) reject the iteration variable.
      const componentTypes: ComponentType<Component>[] = [
        PositionComponent,
        VelocityComponent,
        AccelerationComponent,
        HealthComponent,
        CollisionBoxComponent,
        RenderableComponent,
        PlayerControlledComponent,
        AIControlledComponent,
        ProjectileComponent,
        ShardComponent,
        BurnEffectComponent,
        BuffComponent,
        SpawnerComponent,
        DamageComponent,
        ChargingComponent,
        BeamComponent,
        DischargeComponent,
        DischargeEffectComponent,
        ChargedProjectileComponent,
        SourceTagComponent,
        WeaponComponent,
        EnemyTypeComponent,
        // Sprint B5 (red-team Finding 1): new Campaign B/C components must
        // also be cleared on pool reclaim to prevent stale-state bleed-through
        // when an entity ID is reused as a different EnemyType.
        SplitOnDeathComponent,
        MinionTagComponent,
        HealAuraComponent,
        TeleportEffectComponent,
        // Campaign C (PR #217 review): ArenaHazardComponent rounds out the set.
        // Hazards are standalone non-pooled entities today, so this is
        // defense-in-depth/consistency rather than a live leak — but it closes
        // the gap if an entity ever carries the component through pool reclaim.
        ArenaHazardComponent,
        FactionComponent,
        AbilityComponent,
        BossPhaseComponent,
        FloatingTextComponent,
        ActivePowerupComponent,
        AsteroidComponent,
        DeathAnimationComponent,
        FallingAsteroidComponent,
        HealthBarDisplayComponent,
        HitFlashComponent,
        InvincibilityComponent,
        KnockbackComponent,
        PowerupComponent,
        DualChargingComponent,
      ];

      // Remove each component
      componentTypes.forEach((componentType) => {
        if (this.entityManager.hasComponent(entityId, componentType)) {
          this.entityManager.removeComponent(entityId, componentType);
        }
      });
    }
  }

  /**
   * Check if an entity is valid for processing (exists and not pooled)
   */
  isEntityActive(entityId: number): boolean {
    return this.entityManager.hasEntity(entityId) && !this.pooledEntityTracker.isPooled(entityId);
  }

  /**
   * Validate entity has the expected component for its pool type
   */
  private validateEntityType(entityId: number, poolType: PoolType): boolean {
    switch (poolType) {
      case PoolType.ENEMY:
        return this.entityManager.hasComponent(entityId, EnemyTypeComponent);
      case PoolType.PROJECTILE:
        return this.entityManager.hasComponent(entityId, ProjectileComponent);
      case PoolType.CHARGED_PROJECTILE:
        return this.entityManager.hasComponent(entityId, ChargedProjectileComponent);
      case PoolType.SHARD:
        return this.entityManager.hasComponent(entityId, ShardComponent);
      case PoolType.FLOATING_TEXT:
        return this.entityManager.hasComponent(entityId, FloatingTextComponent);
      case PoolType.EFFECT:
        return true; // Effects might have various components
      default:
        return false;
    }
  }

  /**
   * Get max pool size for a pool type
   */
  private getMaxPoolSize(poolType: PoolType): number {
    switch (poolType) {
      case PoolType.ENEMY:
        return POOL_CONFIG.MAX_SIZES.ENEMY;
      case PoolType.PROJECTILE:
        return POOL_CONFIG.MAX_SIZES.PROJECTILE;
      case PoolType.CHARGED_PROJECTILE:
        return POOL_CONFIG.MAX_SIZES.CHARGED_PROJECTILE;
      case PoolType.SHARD:
        return POOL_CONFIG.MAX_SIZES.SHARD;
      case PoolType.FLOATING_TEXT:
        return POOL_CONFIG.MAX_SIZES.FLOATING_TEXT;
      case PoolType.EFFECT:
        return POOL_CONFIG.MAX_SIZES.EFFECT;
      default:
        return 100;
    }
  }

  /**
   * Get pool statistics for monitoring
   */
  getPoolStats(): {
    projectile: { active: number; pooled: number; maxSize: number; hitRate: number };
    enemy: { active: number; pooled: number; maxSize: number; hitRate: number };
    effect: { active: number; pooled: number; maxSize: number; hitRate: number };
    chargedProjectile: { active: number; pooled: number; maxSize: number; hitRate: number };
    shard: { active: number; pooled: number; maxSize: number; hitRate: number };
    floatingText: { active: number; pooled: number; maxSize: number; hitRate: number };
    totalPooled: number;
    overallHitRate: number;
  } {
    const stats: Record<string, { active: number; pooled: number; maxSize: number; hitRate: number }> = {};
    let totalHits = 0;
    let totalRequests = 0;

    // Helper to get stats for each pool type
    const poolTypes = [
      PoolType.PROJECTILE,
      PoolType.ENEMY,
      PoolType.EFFECT,
      PoolType.CHARGED_PROJECTILE,
      PoolType.SHARD,
      PoolType.FLOATING_TEXT,
    ];

    for (const poolType of poolTypes) {
      const pool = this.entityPools[poolType];
      const poolStats = pool?.getStats() ?? { poolSize: 0, maxSize: 0, utilization: 0 };
      // Pooled = entities currently in pooled state (from tracker)
      const pooledCount = this.pooledEntityTracker.getPooledEntitiesByType(poolType).length;
      // Active = 0, we don't track active entities separately (would need Map of active per type)
      const activeCount = 0;
      // Since we don't have hit/miss tracking in the pool, estimate based on utilization
      const hitRate = poolStats.utilization * 100;

      totalHits += poolStats.utilization * 100;
      totalRequests += 100; // Each pool contributes 100 to the total for averaging

      stats[poolType] = {
        active: activeCount,
        pooled: pooledCount,
        maxSize: this.getMaxPoolSize(poolType),
        hitRate: Math.round(hitRate * 10) / 10, // Round to 1 decimal
      };
    }

    return {
      projectile: stats[PoolType.PROJECTILE] || {
        active: 0,
        pooled: 0,
        maxSize: POOL_CONFIG.MAX_SIZES.PROJECTILE,
        hitRate: 0,
      },
      enemy: stats[PoolType.ENEMY] || { active: 0, pooled: 0, maxSize: POOL_CONFIG.MAX_SIZES.ENEMY, hitRate: 0 },
      effect: stats[PoolType.EFFECT] || { active: 0, pooled: 0, maxSize: POOL_CONFIG.MAX_SIZES.EFFECT, hitRate: 0 },
      chargedProjectile: stats[PoolType.CHARGED_PROJECTILE] || {
        active: 0,
        pooled: 0,
        maxSize: POOL_CONFIG.MAX_SIZES.CHARGED_PROJECTILE,
        hitRate: 0,
      },
      shard: stats[PoolType.SHARD] || { active: 0, pooled: 0, maxSize: POOL_CONFIG.MAX_SIZES.SHARD, hitRate: 0 },
      floatingText: stats[PoolType.FLOATING_TEXT] || {
        active: 0,
        pooled: 0,
        maxSize: POOL_CONFIG.MAX_SIZES.FLOATING_TEXT,
        hitRate: 0,
      },
      totalPooled: this.pooledEntityTracker.getPooledEntityCount(),
      overallHitRate: totalRequests > 0 ? Math.round((totalHits / totalRequests) * 1000) / 10 : 0,
    };
  }

  /**
   * Clear all pending poison cloud timers. Call this on game-over or restart
   * to prevent timers from firing against a reset entity manager.
   */
  clearCloudTimers(): void {
    this.cloudCleanupTimers.forEach((t) => clearTimeout(t));
    this.cloudCleanupTimers.clear();
  }

  /**
   * Drop every numeric entity ID retained outside EntityManager before its
   * store is cleared and ID allocation restarts at 1.
   */
  resetSession(): void {
    this.clearCloudTimers();

    for (const entityId of Array.from(this.entityEffectsMap.keys())) {
      this.destroyEntityEffects(entityId);
    }

    for (const pool of Object.values(this.entityPools)) {
      pool?.clear();
    }

    this.pooledEntityTracker.clear();
    this.entityEffectsMap.clear();
    this.bossSpawnCount = 0;
  }

  /**
   * Creates a zone gate entity with position, renderable, and gate components.
   *
   * @param gateId        Unique gate identifier
   * @param fromZoneId    Zone the gate leads from
   * @param toZoneId      Zone the gate leads to
   * @param x             World-space X position
   * @param y             World-space Y position
   * @param condition     Unlock condition type
   * @param unlockValue   Threshold value required to unlock
   * @returns Entity ID
   */
  createZoneGate(
    gateId: number,
    fromZoneId: number,
    toZoneId: number,
    x: number,
    y: number,
    condition: 'wave' | 'guardian_kill' | 'treasure_clear',
    unlockValue: number
  ): number {
    const entity = this.entityManager.createEntity();

    this.entityManager.addComponent(entity, new PositionComponent(x, y));
    this.entityManager.addComponent(entity, new RenderableComponent('#44aaff', 'world', true, 0.8));
    this.entityManager.addComponent(
      entity,
      new ZoneGateComponent(gateId, fromZoneId, toZoneId, x, y, 150, false, condition, unlockValue)
    );

    return entity;
  }

  /**
   * Spawn a telegraphed arena-hazard entity at (x, y) for the given boss archetype.
   *
   * The entity is plain (not pooled) and is destroyed by ArenaHazardSystemService
   * once isExpired() returns true. Radius, damage, and telegraph duration are
   * tuned per-archetype from ARENA_HAZARD config.
   */
  createArenaHazard(x: number, y: number, archetype: BossArchetype): number {
    const entity = this.entityManager.createEntity();
    this.entityManager.addComponent(entity, new PositionComponent(x, y));

    // Select per-archetype tuning; fall back to STANDARD for unknown archetypes.
    const archetypeKey = archetype.toUpperCase() as keyof typeof ARENA_HAZARD;
    const tuning =
      archetypeKey in ARENA_HAZARD && typeof (ARENA_HAZARD as Record<string, unknown>)[archetypeKey] === 'object'
        ? (ARENA_HAZARD[archetypeKey] as { RADIUS: number; DAMAGE: number; TELEGRAPH_MS: number })
        : ARENA_HAZARD.STANDARD;

    this.entityManager.addComponent(
      entity,
      new ArenaHazardComponent(
        tuning.RADIUS,
        tuning.DAMAGE,
        archetype,
        Date.now(),
        tuning.TELEGRAPH_MS,
        ARENA_HAZARD.LINGER_MS
      )
    );

    return entity;
  }

  ngOnDestroy(): void {
    this.resetSession();
  }
}
