import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ProjectileSystemService } from './projectile-system.service';
import { PlayerService } from '../../player/player.service';
import { UIStateService } from '../../state/ui-state.service';
import { FACTION_CONFIG, PLAYER_CONFIG } from '@photon/config/game-constants';
import { PaletteService } from '../../../services/palette.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { FactionStandingSystemService } from '../gameplay';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { CameraShakeService } from '../../effects/camera-shake.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { AudioService } from '../../audio/audio.service';
import { AimingSystemService } from './aiming-system.service';
import {
  BuffComponent,
  DualChargingComponent,
  EnemyTypeComponent,
  PlayerControlledComponent,
  PositionComponent,
  ProjectileComponent,
  RenderableComponent,
  SourceTagComponent,
  VelocityComponent,
  WeaponComponent,
} from '@photon/components';

@Injectable({
  providedIn: 'root',
})
export class WeaponFiringSystemService implements System {
  private firingStats = {
    projectilesSpawned: 0,
    playerShots: 0,
    enemyShots: 0,
  };

  // Snapshot of WeaponComponent properties captured at burst-queue push time.
  // Storing a snapshot instead of a live reference prevents mutated or destroyed
  // weapon components from affecting queued burst shots.
  private burstQueue: Array<{
    weaponEntityId: number;
    burstIndex: number;
    totalBursts: number;
    timeToFire: number;
    fireData: {
      position: { x: number; y: number };
      baseVx: number;
      baseVy: number;
      weaponSnapshot: {
        damage: number;
        projectileColor: string;
        chargedShotChance: number;
      };
      source: 'player' | 'enemy';
      chargeLevel: number;
    };
  }> = [];

  private readonly PROJECTILE_LIMITS = {
    PLAYER: 50,
    ENEMY: 100,
    TOTAL: 200,
  } as const;

  constructor(
    private entityFactory: EntityFactoryECSService,
    private projectileSystem: ProjectileSystemService,
    private playerService: PlayerService,
    private uiState: UIStateService,
    private debugLog: DebugLogBridgeService,
    private factionStandingSystem: FactionStandingSystemService,
    private effectFactory: EffectFactoryService,
    private cameraShake: CameraShakeService,
    private postProcessing: PostProcessingService,
    private audio: AudioService,
    private aimingSystem: AimingSystemService,
    private paletteService: PaletteService
  ) {}

  init(_entityManager: EntityManager): void {
    this.resetStatistics();
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = window.performance.now();

    // Process burst queue first
    this.processBurstQueue(currentTime, entityManager);

    const weaponEntities = entityManager.getEntitiesWithComponents(WeaponComponent, PositionComponent);

    for (const entityId of weaponEntities) {
      const weapon = entityManager.getComponent(entityId, WeaponComponent);
      const position = entityManager.getComponent(entityId, PositionComponent);

      if (!weapon || !position) continue;

      const isPlayer = entityManager.hasComponent(entityId, PlayerControlledComponent);
      const isEnemy = entityManager.hasComponent(entityId, EnemyTypeComponent);

      if (!isPlayer && !isEnemy) continue;

      // Apply fire rate multiplier for player (clamp to [0.1, 10] matching game-engine buff clamp)
      if (isPlayer) {
        const upgradeMultiplier = this.playerService.getFireRateMultiplier();
        const buffComponent = entityManager.getComponent(entityId, BuffComponent);
        const buffMultiplier = buffComponent?.fireRateMultiplier ?? 1.0;
        const focusFireRateMult = this.playerService.getFocusFireRateMultiplier();
        const combinedMultiplier = Math.max(
          0.1,
          Math.min(upgradeMultiplier * buffMultiplier * focusFireRateMult, 10.0)
        );
        const effectiveFireRate = weapon.fireRate / combinedMultiplier;
        if (currentTime - weapon.lastShotTime < effectiveFireRate) continue;
      } else {
        if (!weapon.canFire(currentTime)) continue;
      }

      if (isPlayer) {
        // Check DualChargingComponent for player firing
        const dualCharging = entityManager.getComponent(entityId, DualChargingComponent);
        if (!dualCharging) {
          continue;
        }

        // Projectiles only fire in shooting mode (Shift toggle).
        // Beam and shooting are mutually exclusive.
        const shouldFire = this.playerService.shouldFireProjectile();
        const isShiftFiring = this.playerService.getIsShiftFiring();

        // Debug: log shift-fire state periodically when active
        if (isShiftFiring && Math.random() < 0.1) {
          this.debugLog.log('🔫 Shift-fire check', 'info', {
            source: 'weapon_firing_system',
            shouldFire,
            isShiftFiring,
            canFire: weapon.canFire(currentTime),
            cooldownLeft: Math.max(0, weapon.fireRate - (currentTime - weapon.lastShotTime)),
          });
        }

        if (!shouldFire) {
          continue;
        }
      } else if (isEnemy) {
        // Block firing until enemy is combat-ready (spawn complete + in viewport long enough)
        const enemyRenderable = entityManager.getComponent(entityId, RenderableComponent);
        if (enemyRenderable && !enemyRenderable.isCombatReady(currentTime)) {
          continue;
        }
        // Check if AI has marked this weapon ready to fire
        if (!weapon.readyToFire) {
          continue;
        }
      }

      const velocity = entityManager.getComponent(entityId, VelocityComponent);

      let projectileVx = weapon.projectileSpeed;
      let projectileVy = 0;

      if (isPlayer) {
        let angle = this.playerService.getAngle();

        // Focus Fire auto-targets — read cached target from aiming system to avoid
        // redundant O(n) enemy scan (aiming system already recomputes every 3 frames)
        if (this.playerService.getIsFocusFiring()) {
          const nearest = this.aimingSystem.getCachedFocusTarget();
          if (nearest) {
            angle = Math.atan2(nearest.y - position.y, nearest.x - position.x);
          }
        }

        projectileVx = Math.cos(angle) * weapon.projectileSpeed;
        projectileVy = Math.sin(angle) * weapon.projectileSpeed;

        // Add player momentum to projectile
        const playerVelocity = this.playerService.getMovementVelocity();
        projectileVx += playerVelocity.vx;
        projectileVy += playerVelocity.vy;

        // Enforce minimum projectile speed after momentum inheritance
        // Prevents near-zero velocity when player moves opposite to fire direction
        const finalSpeed = Math.sqrt(projectileVx * projectileVx + projectileVy * projectileVy);
        const minSpeed = weapon.projectileSpeed * 0.5;
        if (finalSpeed < minSpeed) {
          if (finalSpeed > 0) {
            const scale = minSpeed / finalSpeed;
            projectileVx *= scale;
            projectileVy *= scale;
          } else {
            // Zero velocity fallback: fire in aimed direction at min speed
            projectileVx = Math.cos(angle) * minSpeed;
            projectileVy = Math.sin(angle) * minSpeed;
          }
        }
      } else {
        // For AI enemies, use the target direction set by AI system
        if (weapon.targetDirection) {
          projectileVx = weapon.targetDirection.x * weapon.projectileSpeed;
          projectileVy = weapon.targetDirection.y * weapon.projectileSpeed;
        } else {
          // Fallback to velocity direction
          if (velocity && (velocity.vx !== 0 || velocity.vy !== 0)) {
            const speed = Math.sqrt(velocity.vx * velocity.vx + velocity.vy * velocity.vy);
            if (speed > 0) {
              projectileVx = (velocity.vx / speed) * weapon.projectileSpeed;
              projectileVy = (velocity.vy / speed) * weapon.projectileSpeed;
            }
          }
        }
      }

      let chargeLevel = 0;
      if (isPlayer) {
        const dualCharging = entityManager.getComponent(entityId, DualChargingComponent);
        if (dualCharging) {
          // Fire and get the exact charge level consumed (0-1)
          // This ensures both movement and focus charges produce identical damage/visuals
          chargeLevel = dualCharging.fireMovementCharge();
        }
      }
      this.fireBurst(
        entityId,
        position,
        projectileVx,
        projectileVy,
        weapon,
        isPlayer ? 'player' : 'enemy',
        currentTime,
        entityManager,
        chargeLevel
      );

      weapon.lastShotTime = currentTime;

      // Clear AI firing flag after shooting
      if (isEnemy) {
        weapon.readyToFire = false;
      }
      this.firingStats.projectilesSpawned += weapon.burstCount;
      if (isPlayer) {
        this.firingStats.playerShots++;

        // Debug: log shift-fire projectile creation
        if (this.playerService.getIsShiftFiring()) {
          this.debugLog.log('🔫 Shift-fire PROJECTILE QUEUED', 'success', {
            source: 'weapon_firing_system',
            chargeLevel,
            totalPlayerShots: this.firingStats.playerShots,
          });
        }

        // Charge is already consumed by DualChargingComponent.fireMovementCharge() above.
        // Clear the pending shot flag and set PlayerService cooldown.
        if (this.playerService.hasPendingChargeShot()) {
          this.playerService.consumePendingChargeShot();
        }
      } else {
        this.firingStats.enemyShots++;
      }
    }
  }

  private fireBurst(
    entityId: number,
    position: PositionComponent,
    baseVx: number,
    baseVy: number,
    weapon: WeaponComponent,
    source: 'player' | 'enemy',
    _currentTime: number,
    entityManager: EntityManager,
    chargeLevel: number = 0
  ): void {
    const currentProjectiles = this.countActiveProjectiles(entityManager);
    if (currentProjectiles.total >= this.PROJECTILE_LIMITS.TOTAL) {
      return;
    }

    if (source === 'player' && currentProjectiles.player >= this.PROJECTILE_LIMITS.PLAYER) {
      this.uiState.addNotification('Projectile limit reached!', window.performance.now(), '#ff4444');

      // Log projectile limit reached
      this.debugLog.log('⚠️ Player projectile limit reached', 'warning', {
        source: 'weapon_firing_system',
        operation: 'projectile_limit',
        currentProjectiles: currentProjectiles.player,
        limit: this.PROJECTILE_LIMITS.PLAYER,
        totalProjectiles: currentProjectiles.total,
      });
      return;
    }
    if (source === 'enemy' && currentProjectiles.enemy >= this.PROJECTILE_LIMITS.ENEMY) {
      return;
    }

    // Snapshot mutable weapon properties at queue time so later mutations or
    // component destruction cannot affect queued burst shots.
    const weaponSnapshot = {
      damage: weapon.damage,
      projectileColor: weapon.projectileColor,
      chargedShotChance: weapon.chargedShotChance,
    };

    for (let i = 0; i < weapon.burstCount; i++) {
      this.burstQueue.push({
        weaponEntityId: entityId,
        burstIndex: i,
        totalBursts: weapon.burstCount,
        timeToFire: _currentTime + i * weapon.burstDelay,
        fireData: {
          position: { x: position.x, y: position.y },
          baseVx,
          baseVy,
          weaponSnapshot,
          source,
          chargeLevel,
        },
      });
    }
  }

  private processBurstQueue(currentTime: number, entityManager: EntityManager): void {
    // Process queued burst shots
    const shotsToFire = this.burstQueue.filter((shot) => shot.timeToFire <= currentTime);

    for (const shot of shotsToFire) {
      this.fireSingleProjectile(shot, entityManager);
    }

    // Remove fired shots from queue
    this.burstQueue = this.burstQueue.filter((shot) => shot.timeToFire > currentTime);
  }

  private fireSingleProjectile(
    shot: (typeof WeaponFiringSystemService.prototype.burstQueue)[0],
    entityManager: EntityManager
  ): void {
    const { burstIndex, totalBursts, fireData } = shot;
    const { position, baseVx, baseVy, weaponSnapshot, source, chargeLevel } = fireData;

    const isFocusFiring = source === 'player' && this.playerService.getIsFocusFiring();
    const BURST_SPREAD_ANGLE = isFocusFiring
      ? PLAYER_CONFIG.FOCUS_FIRE.SPREAD_ANGLE
      : PLAYER_CONFIG.FOCUS_FIRE.NORMAL_SPREAD_ANGLE;
    const SPAWN_DISTANCE = 25;

    const spreadAngle = (burstIndex - (totalBursts - 1) / 2) * BURST_SPREAD_ANGLE;
    const cos = Math.cos(spreadAngle);
    const sin = Math.sin(spreadAngle);

    const vx = baseVx * cos - baseVy * sin;
    const vy = baseVx * sin + baseVy * cos;

    const speed = Math.sqrt(vx * vx + vy * vy);
    let spawnOffsetX = 0;
    let spawnOffsetY = 0;

    if (speed > 0) {
      spawnOffsetX = (vx / speed) * SPAWN_DISTANCE;
      spawnOffsetY = (vy / speed) * SPAWN_DISTANCE;
    }

    let effectiveChargeLevel = 0;
    if (source === 'player') {
      effectiveChargeLevel = chargeLevel;
    }

    // S3: Focus Fire uses the lightweight basic projectile path (not charged) for
    //     performance. Visual distinction comes from amber color + larger radius,
    //     not from the expensive charged rendering pipeline (energy arcs, glow layers).
    // Only promote to charged if the player actually had real charge accumulated.

    // Use theme-aware fallback color for projectiles
    const themeProjectileColor = this.paletteService.getCanvas().ACCENT_CYAN;
    let projectileColor = weaponSnapshot.projectileColor || themeProjectileColor;
    const playerControlled = entityManager.getComponent(shot.weaponEntityId, PlayerControlledComponent);

    // S2: Focus Fire projectiles are amber/orange
    if (isFocusFiring) {
      projectileColor = PLAYER_CONFIG.FOCUS_FIRE.COLORS.PROJECTILE;
    } else if (playerControlled && effectiveChargeLevel > 0) {
      const chargeType = this.playerService.getActiveChargeType();

      if (chargeType === 'focus') {
        const intensity = effectiveChargeLevel;
        const r = Math.floor(255);
        const g = Math.floor(255 - (255 - 68) * intensity);
        const b = Math.floor(255);
        projectileColor = `rgb(${r},${g},${b})`;
      } else {
        const r = Math.floor(255 - 255 * effectiveChargeLevel);
        const g = 255;
        const b = Math.floor(255 * effectiveChargeLevel);
        projectileColor = `rgb(${r},${g},${b})`;
      }
    }

    // Apply territory damage multiplier for player projectiles
    let adjustedDamage = weaponSnapshot.damage;
    if (source === 'player' && this.factionStandingSystem) {
      const territoryEffects = this.factionStandingSystem.getTerritoryEffects(position.x, position.y);
      adjustedDamage = weaponSnapshot.damage * territoryEffects.damageMultiplier;

      // Debug log territory effects occasionally
      if (Math.random() < FACTION_CONFIG.DEBUG_LOG_CHANCE) {
        this.debugLog.log('Territory Damage Applied', 'info', {
          source: 'weapon_firing_system',
          position: { x: position.x.toFixed(0), y: position.y.toFixed(0) },
          baseDamage: weaponSnapshot.damage,
          adjustedDamage: adjustedDamage.toFixed(1),
          multiplier: territoryEffects.damageMultiplier,
        });
      }
    }

    const projectileId =
      effectiveChargeLevel > 0
        ? this.entityFactory.createChargedProjectile(
            position.x + spawnOffsetX,
            position.y + spawnOffsetY,
            vx,
            vy,
            adjustedDamage,
            effectiveChargeLevel,
            source,
            projectileColor
          )
        : this.entityFactory.createProjectile(
            position.x + spawnOffsetX,
            position.y + spawnOffsetY,
            vx,
            vy,
            adjustedDamage,
            source,
            projectileColor
          );

    this.projectileSystem.notifyProjectileSpawned(projectileId, {
      x: position.x + spawnOffsetX,
      y: position.y + spawnOffsetY,
    });

    // Muzzle flash at projectile spawn point (player only)
    if (source === 'player' && speed > 0) {
      this.effectFactory.createMuzzleFlash(
        { x: position.x + spawnOffsetX, y: position.y + spawnOffsetY },
        { x: vx / speed, y: vy / speed },
        effectiveChargeLevel > 0 ? 'charged' : 'default'
      );

      // S8: Play shot sound — Focus Fire uses a deeper resonant thump; regular projectile has its own pew
      if (isFocusFiring) {
        this.audio.playFocusFireShot();
      } else {
        this.audio.playProjectileShot();
      }
    }

    // Charged shot feedback — proportional to charge level (player only, fired once per shot)
    if (source === 'player' && effectiveChargeLevel >= 0.4) {
      const isHighCharge = effectiveChargeLevel >= 0.8;
      this.cameraShake.addShake({
        ...(isHighCharge ? CameraShakeService.PRESETS.MEDIUM_HIT : CameraShakeService.PRESETS.LIGHT_HIT),
        fadeOut: true,
      });

      if (isHighCharge) {
        this.postProcessing.addScreenFlash({
          color: { r: 0, g: 200, b: 255 },
          opacity: 0.06,
          duration: 100,
        });
      }
    }

    if (weaponSnapshot.chargedShotChance > 0 && Math.random() < weaponSnapshot.chargedShotChance) {
      const projectile = entityManager.getComponent(projectileId, ProjectileComponent);
      if (projectile) {
        projectile.damage *= 2;
      }

      const renderable = entityManager.getComponent(projectileId, RenderableComponent);
      if (renderable) {
        renderable.glowIntensity = 2;
      }
    }
  }

  forceFireWeapon(entityId: number, targetX: number, targetY: number, entityManager: EntityManager): void {
    const weapon = entityManager.getComponent(entityId, WeaponComponent);
    const position = entityManager.getComponent(entityId, PositionComponent);

    if (!weapon || !position) return;

    const dx = targetX - position.x;
    const dy = targetY - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return;

    const vx = (dx / distance) * weapon.projectileSpeed * 100;
    const vy = (dy / distance) * weapon.projectileSpeed * 100;

    const isPlayer = entityManager.hasComponent(entityId, PlayerControlledComponent);

    this.fireBurst(
      entityId,
      position,
      vx,
      vy,
      weapon,
      isPlayer ? 'player' : 'enemy',
      window.performance.now(),
      entityManager,
      0
    );

    weapon.lastShotTime = window.performance.now();

    // Log forced weapon fire
    this.debugLog.log('🎯 Force fired weapon', 'info', {
      source: 'weapon_firing_system',
      operation: 'force_fire',
      entityId,
      target: { x: targetX.toFixed(0), y: targetY.toFixed(0) },
      velocity: { x: vx.toFixed(2), y: vy.toFixed(2) },
      isPlayer,
    });
  }

  fireChargedWeapon(
    entityId: number,
    targetX: number,
    targetY: number,
    chargeLevel: number,
    entityManager: EntityManager
  ): void {
    const weapon = entityManager.getComponent(entityId, WeaponComponent);
    const position = entityManager.getComponent(entityId, PositionComponent);

    if (!weapon || !position) return;

    // Calculate direction to target
    const dx = targetX - position.x;
    const dy = targetY - position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) return;

    const vx = (dx / distance) * weapon.projectileSpeed * 100;
    const vy = (dy / distance) * weapon.projectileSpeed * 100;

    // Determine source
    const isPlayer = entityManager.hasComponent(entityId, PlayerControlledComponent);

    // Fire burst with charge effects
    this.fireBurst(
      entityId,
      position,
      vx,
      vy,
      weapon,
      isPlayer ? 'player' : 'enemy',
      window.performance.now(),
      entityManager,
      chargeLevel
    );

    weapon.lastShotTime = window.performance.now();

    // Log charged weapon fire
    this.debugLog.log(`⚡ Fired charged weapon (level ${chargeLevel})`, 'success', {
      source: 'weapon_firing_system',
      operation: 'fire_charged',
      entityId,
      chargeLevel,
      target: { x: targetX.toFixed(0), y: targetY.toFixed(0) },
      velocity: { x: vx.toFixed(2), y: vy.toFixed(2) },
      damage: weapon.damage,
      isPlayer,
    });
  }

  getWeaponStats(): {
    projectilesSpawned: number;
    playerShots: number;
    enemyShots: number;
  } {
    return { ...this.firingStats };
  }

  getChargedProjectileConfig(): {
    baseDamageMultiplier: number;
    chargeThreshold: number;
    maxSizeMultiplier: number;
    trailThreshold: number;
  } {
    return {
      baseDamageMultiplier: PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.BASE_DAMAGE_MULTIPLIER,
      chargeThreshold: PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.CHARGE_THRESHOLD,
      maxSizeMultiplier: PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.MAX_SIZE_MULTIPLIER,
      trailThreshold: PLAYER_CONFIG.WEAPONS.CHARGED_PROJECTILE.TRAIL_THRESHOLD,
    };
  }

  private countActiveProjectiles(entityManager: EntityManager): {
    player: number;
    enemy: number;
    total: number;
  } {
    const projectiles = entityManager.getEntitiesWithComponents(ProjectileComponent);
    let playerCount = 0;
    let enemyCount = 0;

    for (const id of projectiles) {
      const sourceTag = entityManager.getComponent(id, SourceTagComponent);
      if (sourceTag) {
        if (sourceTag.source === 'player') {
          playerCount++;
        } else if (sourceTag.source === 'enemy') {
          enemyCount++;
        }
      }
    }

    return {
      player: playerCount,
      enemy: enemyCount,
      total: playerCount + enemyCount,
    };
  }

  private resetStatistics(): void {
    this.firingStats = {
      projectilesSpawned: 0,
      playerShots: 0,
      enemyShots: 0,
    };
  }

  reset(): void {
    this.burstQueue = [];
    this.resetStatistics();
  }

  destroy(): void {
    this.reset();
  }
}
