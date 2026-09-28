import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { isGuardianImmune } from '../../combat/guardian-immunity.helper';
import {
  CollisionBoxComponent,
  EnemyTypeComponent,
  FloatingTextComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
} from '@photon/components';
import { AsteroidState, FallingAsteroidComponent } from '@photon/components/falling-asteroid.component';
import { BuffManagementSystemService } from '../gameplay';
import { GameStateService } from '../../state/game-state.service';
import { SettingsService } from '../../utils/settings.service';
import { BuffSystemService } from '../../progression/buff-system.service';
import { AudioService } from '../../audio/audio.service';
import { MathUtilsService } from '../../utils/math-utils.service';

@Injectable({ providedIn: 'root' })
export class FallingAsteroidSystemService implements System {
  private readonly WARNING_DURATION = 2000; // 2 seconds warning
  private readonly FALL_DURATION = 1500; // 1.5 seconds to fall
  private readonly IMPACT_DURATION = 500; // 0.5 seconds impact effect
  private readonly MIN_SPAWN_INTERVAL = 25000; // 25 seconds minimum between spawns
  private readonly MAX_SPAWN_INTERVAL = 45000; // 45 seconds maximum

  private nextSpawnTime = 0;
  private playerEntity: number | null = null;

  constructor(
    private buffSystem: BuffManagementSystemService,
    private gameState: GameStateService,
    private settingsService: SettingsService,
    private buffSystemService: BuffSystemService,
    private audio: AudioService
  ) {}

  reset(): void {
    this.playerEntity = null;
    this.nextSpawnTime = 0;
  }

  init(_entityManager: EntityManager): void {
    this.playerEntity = null;
    // Schedule first asteroid
    this.nextSpawnTime = Date.now() + 10000; // First one after 10 seconds

    if (window.debugLogBridge) {
      window.debugLogBridge.log('📦 Data Core Drop System initialized', 'info', {
        source: 'falling_asteroid_system',
        firstSpawnIn: '10s',
      });
    }
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    const currentTime = Date.now();

    // Find player entity if not cached
    if (this.playerEntity === null) {
      const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent);
      if (players.length > 0) {
        this.playerEntity = players[0];
      }
    }

    // Check if it's time to spawn a new asteroid
    if (currentTime >= this.nextSpawnTime && this.playerEntity !== null) {
      this.spawnFallingAsteroid(entityManager);
      this.scheduleNextSpawn();
    }

    // Update all falling asteroids
    const asteroids = entityManager.getEntitiesWithComponents(FallingAsteroidComponent);
    for (const asteroidId of asteroids) {
      this.updateAsteroid(asteroidId, entityManager, currentTime);
    }
  }

  private spawnFallingAsteroid(entityManager: EntityManager): void {
    if (!this.playerEntity) return;
    const playerPos = entityManager.getComponent(this.playerEntity, PositionComponent);
    if (!playerPos) return;

    // Spawn near player but not directly on them
    const angle = Math.random() * Math.PI * 2;
    const distance = 200 + Math.random() * 300; // 200-500 units away
    const targetX = playerPos.x + Math.cos(angle) * distance;
    const targetY = playerPos.y + Math.sin(angle) * distance;

    // Determine random reward type (expanded with crit and XP boosts)
    const rewardTypes: Array<'speed' | 'damage' | 'shield' | 'regen' | 'crit' | 'xp_boost'> = [
      'speed',
      'damage',
      'shield',
      'regen',
      'crit',
      'xp_boost',
    ];
    const rewardType = rewardTypes[Math.floor(Math.random() * rewardTypes.length)];

    // 10% chance for MEGA data core (double stats, double reward duration)
    const isMega = Math.random() < 0.1;

    // Create asteroid entity
    const asteroid = entityManager.createEntity();

    // MEGA variants have double stats and duration
    const sizeMult = isMega ? 1.5 : 1;
    const healthMult = isMega ? 2 : 1;
    const durationMult = isMega ? 2 : 1;

    // Add falling asteroid component
    const fallingComp = new FallingAsteroidComponent(
      AsteroidState.WARNING,
      Date.now(),
      0,
      0,
      targetX,
      targetY,
      1000,
      150, // Impact radius
      isMega ? 60 : 40, // Impact damage (MEGA hits harder)
      Math.round(40 * sizeMult), // Size
      Math.round(80 * healthMult), // Health
      Math.round(80 * healthMult), // Max health
      rewardType,
      10000 * durationMult, // MEGA gives 20 second boost instead of 10
      rewardType === 'shield' ? 0.5 : 1.5, // Shield reduces damage by 50%, others boost by 50%
      isMega // New flag to track MEGA status
    );
    entityManager.addComponent(asteroid, fallingComp);

    // Position starts at target (for shadow)
    entityManager.addComponent(asteroid, new PositionComponent(targetX, targetY));

    // No velocity during warning phase
    entityManager.addComponent(asteroid, new VelocityComponent(0, 0));

    // Renderable for warning shadow - MEGA uses gold, regular uses cyan
    const warningColor = isMega ? '#ffaa00' : '#00ffff';
    entityManager.addComponent(asteroid, new RenderableComponent(warningColor, 'world', true, isMega ? 0.5 : 0.3, 0));

    if (window.debugLogBridge) {
      const logMsg = isMega ? '⭐ MEGA Data Core incoming!' : '⚡ Data Core incoming!';
      window.debugLogBridge.log(logMsg, isMega ? 'success' : 'warning', {
        source: 'falling_asteroid_system',
        targetX: targetX.toFixed(0),
        targetY: targetY.toFixed(0),
        rewardType,
        distanceFromPlayer: distance.toFixed(0),
        isMega,
      });
    }
  }

  private updateAsteroid(asteroidId: number, entityManager: EntityManager, currentTime: number): void {
    const asteroid = entityManager.getComponent(asteroidId, FallingAsteroidComponent);
    const position = entityManager.getComponent(asteroidId, PositionComponent);
    const renderable = entityManager.getComponent(asteroidId, RenderableComponent);

    if (!asteroid || !position || !renderable) return;

    switch (asteroid.state) {
      case AsteroidState.WARNING: {
        // Show warning shadow that pulses
        const warningElapsed = currentTime - asteroid.warningStartTime;
        const pulseIntensity = Math.sin(warningElapsed * 0.01) * 0.2 + 0.4;
        renderable.opacity = pulseIntensity;

        // Draw warning circle at impact radius
        renderable.glowIntensity = 0.5;

        if (warningElapsed >= this.WARNING_DURATION) {
          // Start falling
          asteroid.state = AsteroidState.FALLING;
          asteroid.fallStartTime = currentTime;

          // Position asteroid high above
          position.x = asteroid.targetX;
          position.y = asteroid.targetY - asteroid.fallHeight;

          // Change visual to actual asteroid
          renderable.color = '#8B7355'; // Brown asteroid color
          renderable.opacity = 1;
          renderable.glowIntensity = 0.2;
        }
        break;
      }

      case AsteroidState.FALLING: {
        const fallElapsed = currentTime - asteroid.fallStartTime;
        const fallProgress = Math.min(fallElapsed / this.FALL_DURATION, 1);

        // Exponential fall (starts slow, accelerates)
        const fallDistance = asteroid.fallHeight * (fallProgress * fallProgress);
        position.y = asteroid.targetY - asteroid.fallHeight + fallDistance;

        // Grow shadow as it approaches
        if (fallProgress > 0.5) {
          renderable.glowIntensity = (fallProgress - 0.5) * 2;
        }

        if (fallProgress >= 1) {
          // Impact!
          asteroid.state = AsteroidState.IMPACT;
          asteroid.impactTime = currentTime;
          position.y = asteroid.targetY;

          // Deal area damage
          this.dealImpactDamage(asteroidId, asteroid, entityManager);

          // Screen shake on impact — respects settings toggle (Polish 1)
          const settings = this.settingsService.getSettings();
          if (settings.screenShake && window.cameraShake) {
            if (asteroid.isMega) {
              window.cameraShake.addShake({ intensity: 18, duration: 500, fadeOut: true });
            } else {
              window.cameraShake.addShake({ intensity: 10, duration: 300, fadeOut: true });
            }
          }

          if (window.debugLogBridge) {
            window.debugLogBridge.log('💥 Asteroid impact!', 'warning', {
              source: 'falling_asteroid_system',
              x: position.x.toFixed(0),
              y: position.y.toFixed(0),
              impactRadius: asteroid.impactRadius,
              isMega: asteroid.isMega,
            });
          }
        }
        break;
      }

      case AsteroidState.IMPACT: {
        const impactElapsed = currentTime - asteroid.impactTime;

        // Show impact shockwave effect
        renderable.glowIntensity = Math.max(0, 1 - impactElapsed / this.IMPACT_DURATION);

        // IMMEDIATELY make it destructible on impact (no delay)
        if (!entityManager.hasComponent(asteroidId, HealthComponent)) {
          // Add health component right away
          entityManager.addComponent(asteroidId, new HealthComponent(asteroid.health, asteroid.maxHealth));

          // Add collision box for beam/projectile collision
          entityManager.addComponent(
            asteroidId,
            new CollisionBoxComponent(
              asteroid.size * 2, // radius
              'asteroid', // group
              ['projectile'] // collides with projectiles
            )
          );
        }

        if (impactElapsed >= this.IMPACT_DURATION) {
          // Transition to landed state
          asteroid.state = AsteroidState.LANDED;

          // Update appearance to landed
          renderable.color = '#004080'; // Dark blue data core
          renderable.opacity = 1;
          renderable.glowIntensity = 0.2; // Slight glow to show it's interactive
        }
        break;
      }

      case AsteroidState.LANDED: {
        // Check if destroyed (health depleted)
        const health = entityManager.getComponent(asteroidId, HealthComponent);
        if (health && health.health <= 0) {
          // Mark as destroyed FIRST to prevent rendering
          asteroid.state = AsteroidState.DESTROYED;

          // Grant reward
          this.grantReward(asteroidId, asteroid, entityManager);

          // Then immediately destroy the entity
          entityManager.destroyEntity(asteroidId);
          return; // Stop processing this entity
        }
        break;
      }

      case AsteroidState.DESTROYED: {
        // Entity should already be destroyed, but ensure it's gone
        if (entityManager.hasEntity(asteroidId)) {
          entityManager.destroyEntity(asteroidId);
        }
        break;
      }
    }
  }

  private dealImpactDamage(asteroidId: number, asteroid: FallingAsteroidComponent, entityManager: EntityManager): void {
    const asteroidPos = entityManager.getComponent(asteroidId, PositionComponent);
    if (!asteroidPos) return;

    // Deal damage to player if in range
    if (this.playerEntity) {
      const playerPos = entityManager.getComponent(this.playerEntity, PositionComponent);
      if (playerPos) {
        const distance = MathUtilsService.distance(asteroidPos.x, asteroidPos.y, playerPos.x, playerPos.y);

        if (distance <= asteroid.impactRadius) {
          const damageFalloff = 1 - distance / asteroid.impactRadius;
          const damage = Math.floor(asteroid.impactDamage * damageFalloff);

          if (damage > 0) {
            this.gameState.takeDamage(damage, 'asteroid_impact');

            if (window.debugLogBridge) {
              window.debugLogBridge.log('Player hit by asteroid impact!', 'error', {
                source: 'falling_asteroid_system',
                damage,
                distance: distance.toFixed(0),
                impactRadius: asteroid.impactRadius,
              });
            }
          }
        }
      }
    }

    // Instant-kill NPCs in impact radius (guardians are immune — zone progression entities)
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, HealthComponent, PositionComponent);
    let enemiesKilled = 0;

    for (const enemyId of enemies) {
      if (isGuardianImmune(enemyId, entityManager)) continue;

      const enemyPos = entityManager.getComponent(enemyId, PositionComponent);
      const health = entityManager.getComponent(enemyId, HealthComponent);
      if (!enemyPos || !health || health.isDead) continue;

      const distance = MathUtilsService.distance(asteroidPos.x, asteroidPos.y, enemyPos.x, enemyPos.y);

      if (distance <= asteroid.impactRadius) {
        health.lastDamageSource = 'environmental';
        health.health = 0;
        enemiesKilled++;
      }
    }

    if (enemiesKilled > 0 && window.debugLogBridge) {
      window.debugLogBridge.log('Asteroid killed NPCs!', 'info', {
        source: 'falling_asteroid_system',
        enemiesKilled,
        impactRadius: asteroid.impactRadius,
      });
    }
  }

  private grantReward(asteroidId: number, asteroid: FallingAsteroidComponent, entityManager: EntityManager): void {
    if (!this.playerEntity) return;

    let buffId = '';
    let buffDescription = '';
    let buffColor = '#00ff00';

    switch (asteroid.rewardType) {
      case 'speed':
        // Use the built-in speed_boost buff
        buffId = 'speed_boost';
        buffDescription = '+SPEED';
        buffColor = '#00ffff';
        break;

      case 'damage':
        // Use the built-in damage_boost buff
        buffId = 'damage_boost';
        buffDescription = '+DAMAGE';
        buffColor = '#ff0066';
        break;

      case 'shield':
        // Use the built-in shield buff
        buffId = 'shield';
        buffDescription = '+SHIELD';
        buffColor = '#0099ff';
        break;

      case 'regen':
        // Use the built-in regeneration buff
        buffId = 'regeneration';
        buffDescription = '+REGEN';
        buffColor = '#ff00ff';
        break;

      case 'crit':
        // Critical hit chance boost (uses pre-registered critical_surge)
        buffId = 'critical_surge';
        buffDescription = '+CRIT';
        buffColor = '#ffaa00';
        break;

      case 'xp_boost':
        // XP gain boost (uses pre-registered experience_boost)
        buffId = 'experience_boost';
        buffDescription = '+XP';
        buffColor = '#aa44ff';
        break;
    }

    // MEGA prefix for mega data cores
    if (asteroid.isMega) {
      buffDescription = 'MEGA ' + buffDescription;
    }

    // Apply the buff using the pre-registered buff ID
    if (buffId) {
      const success = this.buffSystem.applyBuff(this.playerEntity, buffId, entityManager);

      // Play powerup collect sound
      this.audio.playPowerupCollect();

      if (success) {
        // Bridge to BuffSystemService for gameplay effects — only when ECS buff succeeded
        if (asteroid.rewardType === 'speed') {
          const mult = asteroid.isMega ? 1.5 : 1.3;
          this.buffSystemService.applyBuff('asteroid_speed', 'movementSpeed', mult, asteroid.rewardDuration);
        } else if (asteroid.rewardType === 'xp_boost') {
          const mult = asteroid.isMega ? 3.0 : 2.0;
          this.buffSystemService.applyBuff('asteroid_xp', 'experienceGain', mult, asteroid.rewardDuration);
        }

        // Get player position for visual feedback
        const playerPos = entityManager.getComponent(this.playerEntity, PositionComponent);
        if (playerPos) {
          // Create subtle floating text notification
          const notificationEntity = entityManager.createEntity();
          entityManager.addComponent(notificationEntity, new PositionComponent(playerPos.x, playerPos.y));
          entityManager.addComponent(
            notificationEntity,
            new FloatingTextComponent(
              buffDescription,
              buffColor,
              16, // slightly bigger for clarity
              1200, // shorter duration (1.2 seconds)
              window.performance.now(), // Use performance.now() to match cleanup system
              0, // offsetX
              -40, // offsetY (above player but below streak)
              0, // velocityX
              -30, // velocityY (float upward faster)
              0.4, // fadeStart (fade very early)
              1 // normal scale
            )
          );

          // Create subtle collection particles - just a few
          const particleCount = 6;
          for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const speed = 100 + Math.random() * 50;
            const lifetime = 600 + Math.random() * 200;

            // Create particle entity
            const particleEntity = entityManager.createEntity();
            entityManager.addComponent(particleEntity, new PositionComponent(playerPos.x, playerPos.y));
            entityManager.addComponent(
              particleEntity,
              new VelocityComponent(Math.cos(angle) * speed, Math.sin(angle) * speed)
            );

            // Add as small dot particle
            entityManager.addComponent(
              particleEntity,
              new FloatingTextComponent(
                '·', // small dot
                buffColor,
                8, // small size
                lifetime,
                window.performance.now(), // Use performance.now() to match cleanup system
                0,
                0,
                0,
                0,
                0.4, // fade early
                1
              )
            );
          }

          // Add subtle feedback effects if screen shake is enabled
          const settings = this.settingsService.getSettings();
          if (settings.screenShake && window.cameraShake) {
            // Very subtle shake - just a tiny bump
            window.cameraShake.addShake({ intensity: 2, duration: 100 });
          }

          // Create a subtle expanding ring at collection point
          const asteroidPos = entityManager.getComponent(asteroidId, PositionComponent);
          if (asteroidPos) {
            // Create expanding ring effect where asteroid was
            const ringEntity = entityManager.createEntity();
            entityManager.addComponent(ringEntity, new PositionComponent(asteroidPos.x, asteroidPos.y));
            entityManager.addComponent(
              ringEntity,
              new FloatingTextComponent(
                'o',
                buffColor,
                20,
                500, // quick fade
                window.performance.now(), // Use performance.now() to match cleanup system
                0,
                0,
                0,
                0,
                0.2, // fade very early
                3 // scale up as it fades
              )
            );
          }
        }

        if (window.debugLogBridge) {
          window.debugLogBridge.log('Asteroid destroyed! Reward granted', 'success', {
            source: 'falling_asteroid_system',
            buffId,
            rewardType: asteroid.rewardType,
            description: buffDescription,
            duration: `${asteroid.rewardDuration / 1000}s`,
          });
        }
      }
    }
  }

  private scheduleNextSpawn(): void {
    const interval = this.MIN_SPAWN_INTERVAL + Math.random() * (this.MAX_SPAWN_INTERVAL - this.MIN_SPAWN_INTERVAL);
    this.nextSpawnTime = Date.now() + interval;
  }

  destroy(): void {
    // Cleanup if needed
  }
}
