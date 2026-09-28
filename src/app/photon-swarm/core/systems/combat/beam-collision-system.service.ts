import { Injectable } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { FactionStandingSystemService } from '../gameplay';
import { BurnSystemService } from './burn-system.service';
import { SettingsService } from '../../utils/settings.service';
import { DamageResolverService } from '../../combat/damage-resolver.service';
import {
  AsteroidState,
  BuffComponent,
  CollisionBoxComponent,
  EnemyTypeComponent,
  FallingAsteroidComponent,
  HealthBarDisplayComponent,
  HealthComponent,
  HitFlashComponent,
  KnockbackComponent,
  PlayerControlledComponent,
  PositionComponent,
  ProjectileComponent,
  RenderableComponent,
  ShieldArcComponent,
  SourceTagComponent,
  VelocityComponent,
} from '@photon/components';
import { BEAM_COLLISION_CONFIG, BEAM_REFLECTION, PLAYER_CONFIG } from '@photon/config/game-constants';
import { AudioService } from '../../audio/audio.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { AscensionService } from '../../../services/ascension.service';
import { AchievementService } from '../../../services/achievement.service';
import { MathUtilsService } from '../../utils/math-utils.service';
import { DEFAULT_BEAM_CORE_PROFILE } from '../../../config/beam-core.config';
import type { BeamCoreProfile } from '../../models/run-build.model';

const HIT_FLASH_CONFIG = PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.VISUALS.HIT_FLASH;
const ARC_TRAIL_COLOR = Object.freeze({ r: 120, g: 235, b: 255, a: 0.7 });

/**
 * System that handles collisions between player beam and enemies
 */
@Injectable({
  providedIn: 'root',
})
export class BeamCollisionSystemService implements System {
  private readonly KNOCKBACK_CONFIG = BEAM_COLLISION_CONFIG.KNOCKBACK;
  private readonly EFFECT_COOLDOWN_MS = 100;
  private readonly CLEANUP_INTERVAL_FRAMES = 60;
  // Throttle for shield block sound — beam fires every frame, one sound per 150ms is enough
  private lastShieldBlockSoundTime = 0;

  private playerPosition: { x: number; y: number } | null = null;
  private playerEntity: number | null = null;
  private updateCount = 0;

  // Scratch buffer for the combined enemy+asteroid target list — reused each frame.
  // Consumed immediately within update(); no reference is retained after the loop.
  private readonly _allTargetsBuffer: number[] = [];
  private readonly _directHitTargets = new Set<number>();
  private lastArcVisualTime = 0;

  // Track last effect/damage number time for each enemy to prevent spam
  private lastEffectTime = new Map<number, number>();
  private lastDamageNumberTime = new Map<number, number>();
  // Track accumulated damage for each enemy since last damage number
  private accumulatedDamage = new Map<number, number>();
  // Track if any damage in accumulation period was a critical hit
  private accumulatedCrit = new Map<number, boolean>();

  constructor(
    private playerService: PlayerService,
    private playerUpgrades: PlayerUpgradesService,
    private gameEngine: GameEngineService,
    private effectFactory: EffectFactoryService,
    private entityFactory: EntityFactoryECSService,
    private debugLog: DebugLogBridgeService,
    private factionStandingSystem: FactionStandingSystemService,
    private burnSystem: BurnSystemService,
    private audio: AudioService,
    private postProcessing: PostProcessingService,
    private ascensionService: AscensionService,
    private settings: SettingsService,
    private achievementService: AchievementService,
    private damageResolver: DamageResolverService
  ) {}

  update(deltaTime: number, entityManager: EntityManagerService): void {
    try {
      this.updateCount++;

      // Beam only active when player is firing (holding mouse button)
      if (!this.playerService.isFiring) {
        return;
      }

      const playerPos = this.playerService.getPosition();
      if (!playerPos) {
        return;
      }

      // Cache player position for knockback calculations (defensive copy)
      this.playerPosition = { x: playerPos.x, y: playerPos.y };

      const playerAngle = this.playerService.getAngle();
      const hasDoubleBeam = this.playerUpgrades.getHasDoubleBeam();
      const coreProfile = this.playerUpgrades.getBeamCoreProfile?.() ?? DEFAULT_BEAM_CORE_PROFILE;
      const beamLength = BEAM_COLLISION_CONFIG.BEAM.LENGTH * coreProfile.lengthMultiplier;

      // Find player entity if not cached
      if (!this.playerEntity) {
        const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
        this.playerEntity = playerEntities.length > 0 ? playerEntities[0] : null;
      }

      // Get all potential targets (enemies and landed asteroids)
      const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, PositionComponent, HealthComponent);
      const asteroids = entityManager.getEntitiesWithComponents(
        FallingAsteroidComponent,
        PositionComponent,
        HealthComponent
      );

      // Debug logging removed - was creating object allocations every frame

      // Combine into single target list (reuse scratch buffer to avoid per-frame spread allocation)
      const allTargets = this._allTargetsBuffer;
      allTargets.length = 0;
      for (const enemyId of enemies) {
        allTargets.push(enemyId);
      }

      // Add only landed asteroids
      for (const asteroidId of asteroids) {
        const asteroidComp = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
        if (asteroidComp && asteroidComp.state === AsteroidState.LANDED) {
          allTargets.push(asteroidId);
        }
      }

      this._directHitTargets.clear();
      let arcSourceId: number | null = null;
      let arcSourceDistanceSquared = Number.POSITIVE_INFINITY;

      for (const enemyId of allTargets) {
        const position = entityManager.getComponent(enemyId, PositionComponent);
        const health = entityManager.getComponent(enemyId, HealthComponent);

        if (!position || !health) {
          continue;
        }

        if (health.health <= 0) {
          continue;
        }

        // Skip enemies not yet combat-ready — beam passes through them entirely
        const spawnRenderable = entityManager.getComponent(enemyId, RenderableComponent);
        if (spawnRenderable && !spawnRenderable.isCombatReady(window.performance.now())) {
          continue;
        }

        // Get enemy's collision radius (default to 15 if no collision box)
        const collisionBox = entityManager.getComponent(enemyId, CollisionBoxComponent);
        const enemyRadius = collisionBox?.radius ?? 15;

        let rayHits = 0;
        for (const offset of coreProfile.angleOffsets) {
          if (
            this.checkBeamCollision(
              playerPos.x,
              playerPos.y,
              playerAngle + offset,
              position.x,
              position.y,
              beamLength,
              enemyRadius,
              coreProfile.widthMultiplier
            )
          ) {
            rayHits++;
          }
        }

        // Check second beam if player has double beam upgrade
        if (hasDoubleBeam) {
          for (const offset of coreProfile.angleOffsets) {
            if (
              this.checkBeamCollision(
                playerPos.x,
                playerPos.y,
                playerAngle + Math.PI + offset,
                position.x,
                position.y,
                beamLength,
                enemyRadius,
                coreProfile.widthMultiplier
              )
            ) {
              rayHits++;
            }
          }
        }

        if (rayHits > 0) {
          this.audio.playBeamFire();
          this._directHitTargets.add(enemyId);
          const overlapMultiplier = 1 + (rayHits - 1) * coreProfile.rayOverlapDamageBonus;
          this.damageEnemy(
            enemyId,
            health,
            deltaTime,
            position,
            entityManager,
            coreProfile.damageMultiplier * overlapMultiplier
          );
          if (coreProfile.chainTargets > 0 && entityManager.hasComponent(enemyId, EnemyTypeComponent)) {
            const dx = position.x - playerPos.x;
            const dy = position.y - playerPos.y;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared < arcSourceDistanceSquared) {
              arcSourceDistanceSquared = distanceSquared;
              arcSourceId = enemyId;
            }
          }
        }
      }

      if (arcSourceId !== null) {
        this.applyArcChain(arcSourceId, coreProfile, deltaTime, entityManager, allTargets);
      }

      // Check for projectile reflections
      this.checkProjectileReflections(entityManager, playerPos, playerAngle, beamLength);

      // Periodically clean up tracking Maps for destroyed entities
      if (this.updateCount % this.CLEANUP_INTERVAL_FRAMES === 0) {
        this.cleanupStaleEntries(entityManager);
      }
    } catch (error) {
      // Log errors in beam system
      this.debugLog.log('Beam system error', 'error', {
        source: 'beam_collision_error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check for and reflect enemy projectiles that collide with the beam
   */
  private checkProjectileReflections(
    entityManager: EntityManagerService,
    playerPos: { x: number; y: number },
    beamAngle: number,
    beamLength: number
  ): void {
    const projectiles = entityManager.getEntitiesWithComponents(
      ProjectileComponent,
      PositionComponent,
      VelocityComponent,
      SourceTagComponent
    );

    for (const projectileId of projectiles) {
      const sourceTag = entityManager.getComponent(projectileId, SourceTagComponent);
      const projectile = entityManager.getComponent(projectileId, ProjectileComponent);

      // Only reflect enemy projectiles, not player projectiles that might have bounced back
      if (!sourceTag || sourceTag.source !== 'enemy') {
        continue;
      }

      // Check if this projectile was already reflected by the beam
      const wasReflected = (projectile as { wasReflected?: boolean }).wasReflected;
      if (wasReflected) {
        continue; // Don't reflect already-reflected projectiles
      }

      // Check reflection limit to prevent infinite bounces
      const reflectionCount = (projectile as { reflectionCount?: number }).reflectionCount || 0;
      if (reflectionCount >= BEAM_REFLECTION.MAX_REFLECTIONS) {
        continue;
      }

      const position = entityManager.getComponent(projectileId, PositionComponent);
      const velocity = entityManager.getComponent(projectileId, VelocityComponent);

      if (!position || !velocity) {
        continue;
      }

      // Check if projectile collides with beam
      const beamHit = this.checkBeamCollision(playerPos.x, playerPos.y, beamAngle, position.x, position.y, beamLength);

      if (beamHit) {
        // Reflect the projectile back
        velocity.vx = -velocity.vx * BEAM_REFLECTION.SPEED_MULTIPLIER;
        velocity.vy = -velocity.vy * BEAM_REFLECTION.SPEED_MULTIPLIER;

        // Store original source to prevent re-reflection
        if (!(projectile as { originalSource?: string }).originalSource) {
          (projectile as { originalSource?: string }).originalSource = sourceTag.source; // Store actual original source
        }

        // Mark as reflected to prevent re-reflection
        (projectile as { wasReflected?: boolean }).wasReflected = true;

        // Change ownership to player so it damages enemies
        sourceTag.source = 'player';

        // Mark as reflected projectile for special handling
        sourceTag.isReflected = true;

        // Track reflection count
        (projectile as { reflectionCount?: number }).reflectionCount = reflectionCount + 1;

        // Create enhanced visual feedback for reflection
        // This helps players understand the beam is actively deflecting threats
        this.effectFactory.createBeamImpact({ x: position.x, y: position.y });

        // Add "shield" or "deflection" particle burst to show successful reflection
        const reflectAngle = Math.atan2(velocity.vy, velocity.vx);

        // Create a satisfying "ping" effect when projectile bounces off beam
        this.effectFactory.createMuzzleFlash(
          { x: position.x, y: position.y },
          { x: Math.cos(reflectAngle), y: Math.sin(reflectAngle) },
          'beam_reflect'
        );

        // Additional sparkle/shield effect to reinforce the deflection mechanic
        // This makes it feel like the beam is a protective barrier
        for (let i = 0; i < BEAM_REFLECTION.REFLECTION_SPARK_COUNT; i++) {
          const sparkAngle = reflectAngle + (Math.random() - 0.5) * Math.PI * BEAM_REFLECTION.REFLECTION_SPARK_SPREAD;
          const sparkSpeed = BEAM_REFLECTION.REFLECTION_SPARK_SPEED;
          this.effectFactory.createMuzzleFlash(
            { x: position.x + Math.random() * 10 - 5, y: position.y + Math.random() * 10 - 5 },
            { x: Math.cos(sparkAngle) * sparkSpeed, y: Math.sin(sparkAngle) * sparkSpeed },
            'beam_spark'
          );
        }

        // Apply visual changes to the reflected projectile
        const renderable = entityManager.getComponent(projectileId, RenderableComponent);
        if (renderable) {
          // Give reflected projectiles a distinct blue-ish tint
          const reflectColor = BEAM_REFLECTION.REFLECTION_COLOR;
          renderable.color = `rgba(${reflectColor.r}, ${reflectColor.g}, ${reflectColor.b}, ${reflectColor.a})`;
          renderable.glowIntensity = BEAM_REFLECTION.REFLECTION_GLOW_INTENSITY;
        }
      }
    }
  }

  private checkBeamCollision(
    beamX: number,
    beamY: number,
    beamAngle: number,
    targetX: number,
    targetY: number,
    beamLength: number,
    targetRadius: number = 0,
    coreWidthMultiplier: number = 1
  ): boolean {
    // Calculate beam end point
    const beamEndX = beamX + Math.cos(beamAngle) * beamLength;
    const beamEndY = beamY + Math.sin(beamAngle) * beamLength;

    // Calculate distance from point to line segment
    const distance = this.pointToLineDistance(targetX, targetY, beamX, beamY, beamEndX, beamEndY);

    // Check if within beam width + target radius (beam hits if it touches the target's hitbox)
    const beamRadius = BEAM_COLLISION_CONFIG.BEAM.EFFECTIVE_WIDTH / 2;
    const widthMultiplier = this.playerUpgrades.getBeamWidthMultiplier();
    const effectiveBeamRadius = beamRadius * widthMultiplier * coreWidthMultiplier;
    const totalHitRadius = effectiveBeamRadius + targetRadius;

    return distance <= totalHitRadius;
  }

  private pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    // Vector from line start to point
    const A = px - x1;
    const B = py - y1;

    // Vector along the line
    const C = x2 - x1;
    const D = y2 - y1;

    // Calculate dot product and line segment length squared
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    // Handle degenerate case where line start and end are the same
    if (lenSq === 0) {
      return MathUtilsService.distance(x1, y1, px, py);
    }

    // Calculate parameter t that represents position along line segment
    const param = Math.max(0, Math.min(1, dot / lenSq));

    // Find the closest point on the line segment
    const closestX = x1 + param * C;
    const closestY = y1 + param * D;

    return MathUtilsService.distance(closestX, closestY, px, py);
  }

  private damageEnemy(
    enemyId: number,
    health: HealthComponent,
    deltaTime: number,
    position: PositionComponent,
    entityManager: EntityManagerService,
    coreDamageMultiplier: number = 1
  ): void {
    // Get current state for damage calculation
    const isMoving = this.playerService.isMoving();

    // Beam damage model - consistent DPS based on movement state only
    // No charging mechanics - charging is projectile-only
    // Nerfed ~44% total to reward riskier projectile play (projectiles can be reflected, require aiming)
    const baseDamage = isMoving ? 140 : 196; // Moving: 140 DPS, Stationary: 196 DPS
    const damageMultiplier = this.playerUpgrades.getBeamDamageMultiplier();

    // Get player buff damage multiplier
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
    const playerEntityForBuff = playerEntities[0];
    const buffComp = playerEntityForBuff ? entityManager.getComponent(playerEntityForBuff, BuffComponent) : undefined;
    const buffDamageMultiplier = buffComp?.damageMultiplier ?? 1.0;

    // Apply territory damage multiplier
    let territoryDamageMultiplier = 1.0;
    if (this.factionStandingSystem) {
      const territoryEffects = this.factionStandingSystem.getTerritoryEffects(position.x, position.y);
      territoryDamageMultiplier = territoryEffects.damageMultiplier;
    }

    // Convert deltaTime from ms to seconds for DPS calculation
    // Cap at 100ms (10fps) to prevent damage spikes after lag
    const validDeltaTime = deltaTime > 0 ? Math.min(deltaTime, 100) : 16;
    // Add ±10% variance so accumulated damage numbers don't repeat identically
    const damageVariance = 0.9 + Math.random() * 0.2;
    let damage =
      (baseDamage *
        damageMultiplier *
        buffDamageMultiplier *
        territoryDamageMultiplier *
        this.ascensionService.getDamageBonus() *
        damageVariance *
        coreDamageMultiplier *
        validDeltaTime) /
      1000;

    // Ensure minimum damage
    if (damage < 0.1) {
      damage = 0.1; // Increased minimum damage
    }

    // Apply critical hit chance — includes both permanent upgrades (PlayerUpgradesService)
    // and timed consumable buffs (BuffComponent.criticalChance set by BuffManagementSystem).
    const critChance = this.playerUpgrades.getCriticalHitChance() + (buffComp?.criticalChance ?? 0);
    const isCriticalHit = critChance > 0 && Math.random() < Math.min(critChance, 1.0);
    if (isCriticalHit) {
      damage *= this.playerUpgrades.getCriticalHitMultiplier();
      // Track that this accumulation period includes a crit
      this.accumulatedCrit.set(enemyId, true);
      // White screen flash on critical hit
      this.postProcessing.addScreenFlash(PostProcessingService.FLASH_PRESETS.CRITICAL_HIT);
    }

    // Apply burn chance
    const burnChance = this.playerUpgrades.getBurnChance();
    if (burnChance > 0 && Math.random() < burnChance) {
      const burnDamage = this.playerUpgrades.getBurnDamage();
      const burnDuration = 3000;

      // Only add burn to enemies, not asteroids
      const asteroid = entityManager.getComponent(enemyId, FallingAsteroidComponent);
      if (!asteroid) {
        this.entityFactory.addBurnEffect(enemyId, burnDamage, burnDuration, this.burnSystem.isBurnSpreadEnabled());
      }
    }

    // Route through resolver, which owns the clamp/round/source-tag write.
    // Behavior-preserving: the beam applies ONLY the Sentinel directional shield
    // (its original resistance) — it intentionally does NOT apply flat
    // damageReduction. The original combat design is a weapon-vs-defense triangle:
    // the beam is blocked by Sentinel shields, projectiles bypass them.
    const beamShield = entityManager.getComponent(enemyId, ShieldArcComponent);
    let beamShieldInput: { component: ShieldArcComponent; attackSourceAngle: number } | null = null;
    let shieldReductionToRestore: number | null = null;
    if (beamShield) {
      const attackSourceAngle = Math.atan2(
        (this.playerPosition?.y ?? 0) - position.y,
        (this.playerPosition?.x ?? 0) - position.x
      );
      // Shield Breaker: halve the block reduction (80% → 40%) so the beam deals
      // meaningful damage through the shield while preserving the block mechanic.
      // Mutate temporarily, restore immediately after the resolver call.
      if (this.playerUpgrades.getHasShieldBreaker() && beamShield.damageReduction > 0) {
        shieldReductionToRestore = beamShield.damageReduction;
        beamShield.damageReduction = shieldReductionToRestore * 0.5;
      }
      beamShieldInput = { component: beamShield, attackSourceAngle };
    }
    const beamResult = this.damageResolver.applyDamageToEnemy({
      health,
      rawDamage: damage,
      source: 'player',
      shield: beamShieldInput,
    });
    // Restore original shield reduction after resolver has run
    if (beamShield && shieldReductionToRestore !== null) {
      beamShield.damageReduction = shieldReductionToRestore;
    }
    damage = beamResult.appliedDamage;

    // Shield block feedback — audio + spark at shield arc edge. The beam blocks every
    // frame while held on a shield, so BOTH the sound and the spark live behind the
    // 150ms throttle (an unthrottled spark would spawn ~60 effect emitters/sec).
    if (beamResult.blocked) {
      const nowMs = Date.now();
      if (nowMs - this.lastShieldBlockSoundTime >= 150) {
        this.lastShieldBlockSoundTime = nowMs;
        this.audio.playShieldBlock();
        // Approximate shield arc edge: enemy position + (enemy→player direction) × ~1.5 × enemy radius
        const collisionBox = entityManager.getComponent(enemyId, CollisionBoxComponent);
        const enemyRadius = collisionBox?.radius ?? 15;
        const dx = (this.playerPosition?.x ?? position.x) - position.x;
        const dy = (this.playerPosition?.y ?? position.y) - position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const sparkPos = {
          x: position.x + (dx / dist) * enemyRadius * 1.5,
          y: position.y + (dy / dist) * enemyRadius * 1.5,
        };
        this.effectFactory.createBeamImpact(sparkPos, 8);
      }
    }

    // Track damage dealt for achievement (overkill)
    if (damage > 0) {
      this.achievementService.recordDamageDealt(damage);
    }

    // Add hit flash effect when enemy takes damage from beam
    if (damage > 0 && health.health > 0) {
      // For beam damage, only add flash if not already flashing to prevent strobe effect
      const existingFlash = entityManager.getComponent(enemyId, HitFlashComponent);
      if (!existingFlash || existingFlash.isExpired()) {
        // Remove expired flash if any
        if (existingFlash) {
          entityManager.removeComponent(enemyId, HitFlashComponent);
        }

        // Add new hit flash with lower intensity for continuous beam damage
        const flashIntensity = Math.min(
          HIT_FLASH_CONFIG.MAX_INTENSITY * HIT_FLASH_CONFIG.BEAM_INTENSITY_MULTIPLIER,
          damage / HIT_FLASH_CONFIG.DAMAGE_SCALE_DIVISOR
        );
        entityManager.addComponent(
          enemyId,
          new HitFlashComponent(flashIntensity, HIT_FLASH_CONFIG.BEAM_DURATION, Date.now(), HIT_FLASH_CONFIG.BEAM_COLOR)
        );
      }

      // Update health bar display component to extend visibility
      let healthBarDisplay = entityManager.getComponent(enemyId, HealthBarDisplayComponent);
      if (!healthBarDisplay) {
        healthBarDisplay = new HealthBarDisplayComponent();
        healthBarDisplay.lastHealthPercent = 1.0;
        entityManager.addComponent(enemyId, healthBarDisplay);
      }
      healthBarDisplay.extendDisplay();
    }

    // Handle high damage hit stop
    const damagePercent = (damage / health.maxHealth) * 100;
    if (damagePercent > 50) {
      const currentTime = Date.now();
      const lastEffectTime = this.lastEffectTime.get(enemyId) || 0;
      if (currentTime - lastEffectTime >= this.EFFECT_COOLDOWN_MS) {
        this.gameEngine.triggerHitStop(10);
        this.lastEffectTime.set(enemyId, currentTime);
      }
    }

    // Apply knockback
    const velocity = entityManager.getComponent(enemyId, VelocityComponent);
    if (!velocity) {
      return;
    }

    if (velocity && this.playerPosition) {
      const dx = position.x - this.playerPosition.x;
      const dy = position.y - this.playerPosition.y;
      const distanceSquared = dx * dx + dy * dy;

      if (distanceSquared > 0) {
        const distance = Math.sqrt(distanceSquared);

        // Calculate knockback direction
        const playerAngle = this.playerService.getAngle();
        const beamDirectionX = Math.cos(playerAngle);
        const beamDirectionY = Math.sin(playerAngle);

        // Direction away from player
        const awayFromPlayerX = dx / distance;
        const awayFromPlayerY = dy / distance;

        // Check if beam would push enemy toward player
        const beamToPlayerDot = beamDirectionX * (-dx / distance) + beamDirectionY * (-dy / distance);
        const isBeamPushingTowardPlayer = beamToPlayerDot > 0;

        // Calculate knockback strength
        const movementMultiplier = isMoving ? 0.75 : 0.25;
        const damageMultiplier = Math.min(
          damage * this.KNOCKBACK_CONFIG.DAMAGE_SCALING * 0.5,
          this.KNOCKBACK_CONFIG.MAX_DAMAGE_MULTIPLIER * 0.5
        );
        const distanceModifier = Math.max(
          this.KNOCKBACK_CONFIG.MIN_DISTANCE_MODIFIER,
          Math.min(
            this.KNOCKBACK_CONFIG.MAX_DISTANCE_MODIFIER * 1.5,
            this.KNOCKBACK_CONFIG.DISTANCE_THRESHOLD / Math.max(distance, 10)
          )
        );

        const knockbackStrength =
          this.KNOCKBACK_CONFIG.BASE_FORCE * damageMultiplier * distanceModifier * movementMultiplier;

        // Determine final knockback direction
        let finalKnockbackX: number;
        let finalKnockbackY: number;

        if (isBeamPushingTowardPlayer) {
          finalKnockbackX = awayFromPlayerX;
          finalKnockbackY = awayFromPlayerY;
        } else {
          const blendFactor = isMoving ? 0.7 : 0.3;
          finalKnockbackX = awayFromPlayerX * (1 - blendFactor) + beamDirectionX * blendFactor;
          finalKnockbackY = awayFromPlayerY * (1 - blendFactor) + beamDirectionY * blendFactor;

          // Normalize
          const blendedLength = Math.sqrt(finalKnockbackX * finalKnockbackX + finalKnockbackY * finalKnockbackY);
          if (blendedLength > 0) {
            finalKnockbackX /= blendedLength;
            finalKnockbackY /= blendedLength;
          }
        }

        // Sentinel frontal shield suppresses knockback
        const sentinelShield = entityManager.getComponent(enemyId, ShieldArcComponent);
        let knockbackBlocked = false;
        if (sentinelShield && this.playerPosition) {
          const kbSourceAngle = Math.atan2(this.playerPosition.y - position.y, this.playerPosition.x - position.x);
          let kbShieldDiff = kbSourceAngle - sentinelShield.facingAngle;
          while (kbShieldDiff > Math.PI) kbShieldDiff -= 2 * Math.PI;
          while (kbShieldDiff < -Math.PI) kbShieldDiff += 2 * Math.PI;
          if (Math.abs(kbShieldDiff) <= sentinelShield.arcAngle / 2) {
            knockbackBlocked = true;
          }
        }

        if (!knockbackBlocked) {
          // Apply knockback
          const knockbackVx = finalKnockbackX * knockbackStrength;
          const knockbackVy =
            finalKnockbackY * knockbackStrength - Math.abs(knockbackStrength) * this.KNOCKBACK_CONFIG.UPWARD_BIAS;

          let knockbackComp = entityManager.getComponent(enemyId, KnockbackComponent);
          if (!knockbackComp) {
            knockbackComp = new KnockbackComponent();
            entityManager.addComponent(enemyId, knockbackComp);
          }

          const knockbackDuration = isMoving ? 75 : 50;
          knockbackComp.addKnockback(knockbackVx * 0.5, knockbackVy * 0.5, knockbackDuration);
        }
      }
    }

    // Accumulate damage for this enemy
    const currentAccumulated = this.accumulatedDamage.get(enemyId) || 0;
    this.accumulatedDamage.set(enemyId, currentAccumulated + damage);

    // Check if enemy died this frame
    const isDying = health.health <= 0;

    // Create damage numbers (throttled) showing accumulated damage
    const now = Date.now();
    const lastNumberTime = this.lastDamageNumberTime.get(enemyId) || 0;
    const totalDamage = this.accumulatedDamage.get(enemyId) || 0;

    // Beam damage number display — accumulate and show infrequently.
    // The beam is continuous DPS, so showing numbers every ~75ms (old behavior)
    // created 15+ floating numbers per second per enemy. Instead, accumulate
    // for 600ms and show one larger number. This matches player expectation:
    // beam = steady stream, numbers = periodic chunky feedback.
    const timeSinceLastNumber = now - lastNumberTime;
    const shouldShowNumber = (timeSinceLastNumber >= 600 && totalDamage >= 5) || isDying;

    if (shouldShowNumber) {
      // Only create floating damage numbers when the setting is enabled
      if (this.settings.getSettings().showDamageNumbers) {
        // Cap displayed damage to meaningful damage (remove overkill)
        let displayDamage = totalDamage;
        if (isDying) {
          // health.health is negative (overkill), so adding it removes the excess
          // totalDamage + health.health = damage that was actually meaningful
          displayDamage = Math.max(1, totalDamage + health.health);
        }
        const roundedDamage = Math.max(1, Math.round(displayDamage));

        // Use actual crit status from accumulated tracking
        const isCritical = this.accumulatedCrit.get(enemyId) || false;

        // Only reset accumulator if the number was actually created.
        // Spatial density or per-frame throttle may suppress it — in that case
        // keep accumulating so the damage isn't silently eaten.
        const created = this.effectFactory.createDamageNumber(position, roundedDamage, isCritical);
        if (created !== null) {
          this.lastDamageNumberTime.set(enemyId, now);
          this.accumulatedDamage.set(enemyId, 0);
          this.accumulatedCrit.delete(enemyId);
        }
        // If suppressed: accumulator keeps growing, next 600ms check will retry
        // with a larger (and more satisfying) combined number
      } else {
        // Damage numbers disabled in settings — reset to prevent unbounded growth
        this.lastDamageNumberTime.set(enemyId, now);
        this.accumulatedDamage.set(enemyId, 0);
        this.accumulatedCrit.delete(enemyId);
      }
    }

    // Death handling is deliberately omitted here.
    // DeathDetectionSystem runs later in the same frame and handles the full
    // cleanup cascade: 14 tracking-map cleanups, kill credit, shard drops,
    // death animation, audio, screen shake, and entity pooling.
    // Previously this block set isDead=true + added DeathAnimationComponent,
    // which caused DeathDetectionSystem to skip the entity (line 243 guard:
    // !health.isDead) — leaving tracking maps uncleaned and kills unawarded.
    if (isDying) {
      // Clear accumulated beam-specific tracking (safe to do early)
      this.accumulatedDamage.delete(enemyId);
      this.lastDamageNumberTime.delete(enemyId);
      this.lastEffectTime.delete(enemyId);
    }
  }

  private applyArcChain(
    sourceId: number,
    coreProfile: BeamCoreProfile,
    deltaTime: number,
    entityManager: EntityManagerService,
    candidates: readonly number[]
  ): void {
    let currentSourceId = sourceId;
    const chainedTargets = this._directHitTargets;
    const chainRangeSquared = coreProfile.chainRange * coreProfile.chainRange;
    const now = window.performance.now();
    const shouldRenderArc = now - this.lastArcVisualTime >= 90;

    for (let jump = 0; jump < coreProfile.chainTargets; jump++) {
      const sourcePosition = entityManager.getComponent(currentSourceId, PositionComponent);
      if (!sourcePosition) break;

      let nextTargetId: number | null = null;
      let nextDistanceSquared = chainRangeSquared;
      for (const candidateId of candidates) {
        if (chainedTargets.has(candidateId) || !entityManager.hasComponent(candidateId, EnemyTypeComponent)) continue;
        const position = entityManager.getComponent(candidateId, PositionComponent);
        const health = entityManager.getComponent(candidateId, HealthComponent);
        if (!position || !health || health.health <= 0 || health.isDead) continue;
        const dx = position.x - sourcePosition.x;
        const dy = position.y - sourcePosition.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < nextDistanceSquared) {
          nextDistanceSquared = distanceSquared;
          nextTargetId = candidateId;
        }
      }

      if (nextTargetId === null) break;
      const nextPosition = entityManager.getComponent(nextTargetId, PositionComponent);
      const nextHealth = entityManager.getComponent(nextTargetId, HealthComponent);
      if (!nextPosition || !nextHealth) break;

      chainedTargets.add(nextTargetId);
      this.damageEnemy(
        nextTargetId,
        nextHealth,
        deltaTime,
        nextPosition,
        entityManager,
        coreProfile.damageMultiplier * coreProfile.chainDamageMultiplier
      );
      if (shouldRenderArc) {
        this.effectFactory.createBeamTrail(sourcePosition, nextPosition, ARC_TRAIL_COLOR);
      }
      currentSourceId = nextTargetId;
    }

    if (shouldRenderArc) this.lastArcVisualTime = now;
  }

  /**
   * Periodically remove tracking entries for entities that no longer exist.
   * Catches leaks from entities destroyed through paths that skip cleanupDeadEnemy.
   */
  private cleanupStaleEntries(entityManager: EntityManagerService): void {
    for (const entityId of this.lastEffectTime.keys()) {
      if (!entityManager.hasEntity(entityId)) {
        this.lastEffectTime.delete(entityId);
      }
    }
    for (const entityId of this.lastDamageNumberTime.keys()) {
      if (!entityManager.hasEntity(entityId)) {
        this.lastDamageNumberTime.delete(entityId);
      }
    }
    for (const entityId of this.accumulatedDamage.keys()) {
      if (!entityManager.hasEntity(entityId)) {
        this.accumulatedDamage.delete(entityId);
      }
    }
    for (const entityId of this.accumulatedCrit.keys()) {
      if (!entityManager.hasEntity(entityId)) {
        this.accumulatedCrit.delete(entityId);
      }
    }
  }

  /**
   * Reset tracking state for game restart — clears all per-entity Maps.
   */
  reset(): void {
    this.lastEffectTime.clear();
    this.lastDamageNumberTime.clear();
    this.accumulatedDamage.clear();
    this.accumulatedCrit.clear();
    this.playerPosition = null;
    this.playerEntity = null;
    this.updateCount = 0;
  }

  /**
   * Clean up tracking maps for a dead enemy
   * Called by death-detection-system to prevent memory leaks when enemies die through other paths
   */
  public cleanupDeadEnemy(entityId: number): void {
    this.lastEffectTime.delete(entityId);
    this.lastDamageNumberTime.delete(entityId);
    this.accumulatedDamage.delete(entityId);
    this.accumulatedCrit.delete(entityId);
  }
}
