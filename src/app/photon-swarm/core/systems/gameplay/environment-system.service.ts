import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Entity, EntityManager, System } from '../../ecs/ecs.model';
import { RandomService } from '../../utils/random.service';
import { ENVIRONMENT_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { GameStateService } from '../../state/game-state.service';
import { BuffManagementSystemService } from './buff-management-system.service';
import { VisualFeedbackCoordinatorService } from '../../services/visual-feedback-coordinator.service';
import { BuffSystemService } from '../../progression/buff-system.service';
import { AudioService } from '../../audio/audio.service';
import {
  ActivePowerupComponent,
  AIControlledComponent,
  AsteroidComponent,
  BuffComponent,
  CollisionBoxComponent,
  DamageComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  PowerupComponent,
  RenderableComponent,
  ShardComponent,
  VelocityComponent,
} from '@photon/components';

interface EnvironmentConfig {
  asteroidSpawnRate: number; // Asteroids per second
  asteroidMinSize: number;
  asteroidMaxSize: number;
  asteroidMinSpeed: number;
  asteroidMaxSpeed: number;
  asteroidDamage: number;

  hazardZoneCount: number;
  hazardZoneDamage: number; // Damage per second
  hazardZoneRadius: number;

  voidStormFrequency: number; // Seconds between storms
  voidStormDuration: number; // Storm duration in seconds
  voidStormDamage: number; // Damage per second during storm

  worldBoundaryDamage: number; // Damage per second outside bounds
}

interface EnvironmentEvent {
  type:
    | 'asteroid_spawned'
    | 'damage_field_created'
    | 'void_storm_started'
    | 'void_storm_ended'
    | 'shard_cache_spawned'
    | 'emp_pulse_started'
    | 'emp_pulse_ended';
  position?: { x: number; y: number };
  entity?: Entity;
  zoneInfo?: {
    name: string;
    damageType: string;
    description: string;
  };
}

/**
 * ECS System that manages environmental hazards and effects
 */
@Injectable({ providedIn: 'root' })
export class EnvironmentSystemService implements System {
  private worldBounds: { width: number; height: number } = {
    width: WORLD_CONFIG.BOUNDS.WIDTH,
    height: WORLD_CONFIG.BOUNDS.HEIGHT,
  };
  private asteroidSpawnTimer = 0;

  // Powerup zone types with visual themes
  private readonly POWERUP_ZONE_TYPES = [
    {
      name: 'Berserker Shrine',
      color: '#ff4444',
      glowColor: '#ff8888',
      powerupType: 'damage_multiplier' as const,
      multiplier: 2.0,
      duration: 8000, // 8 seconds
      description: 'Double damage for all weapons',
      respawnCooldown: 15000, // 15 seconds
    },
    {
      name: 'Overcharge Node',
      color: '#ff8800',
      glowColor: '#ffaa44',
      powerupType: 'damage_multiplier' as const,
      multiplier: 1.5,
      duration: 10000, // 10 seconds
      description: '50% damage boost',
      respawnCooldown: 12000, // 12 seconds
    },
    {
      name: 'Fury Altar',
      color: '#ff0088',
      glowColor: '#ff44aa',
      powerupType: 'damage_multiplier' as const,
      multiplier: 3.0,
      duration: 5000, // 5 seconds
      description: 'Triple damage but shorter duration',
      respawnCooldown: 20000, // 20 seconds
    },
    {
      name: 'Velocity Stream',
      color: '#44aaff',
      glowColor: '#88ccff',
      powerupType: 'speed' as const,
      multiplier: 1.3,
      duration: 10000, // 10 seconds
      description: '+30% movement speed',
      respawnCooldown: 15000, // 15 seconds
    },
    {
      name: 'Phase Shield',
      color: '#44ff88',
      glowColor: '#88ffaa',
      powerupType: 'shield' as const,
      multiplier: 0.7, // 30% damage reduction (multiplied as damageTaken)
      duration: 12000, // 12 seconds
      description: '30% damage reduction',
      respawnCooldown: 18000, // 18 seconds
    },
    {
      name: 'Overclock Core',
      color: '#ffff44',
      glowColor: '#ffff88',
      powerupType: 'rapid_fire' as const,
      multiplier: 2.0,
      duration: 8000, // 8 seconds
      description: 'Double fire rate',
      respawnCooldown: 20000, // 20 seconds
    },
    {
      name: 'Knowledge Nexus',
      color: '#aa44ff',
      glowColor: '#cc88ff',
      powerupType: 'experience' as const,
      multiplier: 2.0,
      duration: 15000, // 15 seconds
      description: 'Double XP gain',
      respawnCooldown: 25000, // 25 seconds
    },
  ];
  private voidStormTimer = 0;
  private voidStormActive = false;
  private voidStormTimeRemaining = 0;

  // Shard Cache event state
  private shardCacheTimer = 0;

  // EMP Pulse event state
  private empPulseTimer = 0;
  private empPulseActive = false;
  private empPulseTimeRemaining = 0;
  private empSlowedEntities = new Set<Entity>();

  // Local config for new environmental events
  private readonly shardCacheConfig = {
    minInterval: 45,
    maxInterval: 75,
    minShards: 8,
    maxShards: 15,
    minDistance: 300,
    maxDistance: 500,
    valueMultiplierMin: 3,
    valueMultiplierMax: 5,
  };

  private readonly empPulseConfig = {
    minInterval: 60,
    maxInterval: 90,
    duration: 4,
    slowFactor: 0.5,
  };

  private shardCacheNextInterval = 0;
  private empPulseNextInterval = 0;

  private hazardZones: Entity[] = [];

  // Observable for environment events
  public readonly environmentEvent$ = new Subject<EnvironmentEvent>();

  private readonly config: EnvironmentConfig = {
    asteroidSpawnRate: ENVIRONMENT_CONFIG.ASTEROID.SPAWN_RATE_PER_SECOND,
    asteroidMinSize: ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MIN,
    asteroidMaxSize: ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MAX,
    asteroidMinSpeed: ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MIN,
    asteroidMaxSpeed: ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MAX,
    asteroidDamage: ENVIRONMENT_CONFIG.ASTEROID.DAMAGE,

    hazardZoneCount: ENVIRONMENT_CONFIG.HAZARD_ZONES.DEFAULT_COUNT,
    hazardZoneDamage: ENVIRONMENT_CONFIG.HAZARD_ZONES.DAMAGE_PER_SECOND,
    hazardZoneRadius: ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS,

    voidStormFrequency: ENVIRONMENT_CONFIG.VOID_STORM.INTERVAL_MS / 1000, // Convert to seconds
    voidStormDuration: ENVIRONMENT_CONFIG.VOID_STORM.DURATION_MS / 1000, // Convert to seconds
    voidStormDamage: ENVIRONMENT_CONFIG.VOID_STORM.DAMAGE_PER_SECOND,

    worldBoundaryDamage: ENVIRONMENT_CONFIG.WORLD_BOUNDARY.DAMAGE_PER_SECOND,
  };

  // Maps ECS powerup types to buff IDs registered in BuffManagementSystemService
  private readonly POWERUP_TO_BUFF: Record<string, string> = {
    damage_multiplier: 'damage_boost',
    speed: 'speed_boost',
    shield: 'shield',
    rapid_fire: 'rapid_fire',
    experience: 'experience_boost',
  };

  private getDamageBuffId(multiplier: number): string {
    if (multiplier >= 3.0) return 'damage_boost_3x';
    if (multiplier >= 2.0) return 'damage_boost_2x';
    return 'damage_boost';
  }

  // Maps powerup types to BuffSystemService (the system that actually affects gameplay)
  private readonly POWERUP_TO_ENGINE_BUFF: Record<
    string,
    { stat: keyof import('../../progression/buff-system.service').BuffMultipliers; id: string }
  > = {
    speed: { stat: 'movementSpeed', id: 'powerup_speed' },
    experience: { stat: 'experienceGain', id: 'powerup_xp' },
  };

  constructor(
    private random: RandomService,
    private gameState: GameStateService,
    private buffSystem: BuffManagementSystemService,
    private visualFeedback: VisualFeedbackCoordinatorService,
    private buffSystemService: BuffSystemService,
    private audio: AudioService
  ) {}

  init(entityManager: EntityManager): void {
    this.reset();
    this.initializeRun(entityManager);
  }

  reset(): void {
    this.asteroidSpawnTimer = 0;
    this.voidStormTimer = 0;
    this.voidStormActive = false;
    this.voidStormTimeRemaining = 0;

    // Initialize shard cache timer with randomized interval
    this.shardCacheTimer = 0;
    this.shardCacheNextInterval = this._randomRange(
      this.shardCacheConfig.minInterval,
      this.shardCacheConfig.maxInterval
    );

    // Initialize EMP pulse timer with randomized interval
    this.empPulseTimer = 0;
    this.empPulseActive = false;
    this.empPulseTimeRemaining = 0;
    this.empSlowedEntities.clear();
    this.empPulseNextInterval = this._randomRange(this.empPulseConfig.minInterval, this.empPulseConfig.maxInterval);
    this.hazardZones.length = 0;
  }

  initializeRun(entityManager: EntityManager): void {
    // Create powerup zones instead of damage zones
    this._createPowerupZones(entityManager);

    // Create single health pack
    this._createHealthPack(entityManager);

    if (window.debugLogBridge) {
      // Calculate distance distribution
      const PLAYER_SPAWN_X = this.worldBounds.width / 2;
      const PLAYER_SPAWN_Y = this.worldBounds.height / 2;
      const distances = this.hazardZones.map((zone) => {
        const pos = entityManager.getComponent(zone, PositionComponent);
        if (!pos) return 0;
        const dx = pos.x - PLAYER_SPAWN_X;
        const dy = pos.y - PLAYER_SPAWN_Y;
        return Math.sqrt(dx * dx + dy * dy);
      });

      const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
      const minDistance = Math.min(...distances);
      const maxDistance = Math.max(...distances);

      window.debugLogBridge.log('⚡ Damage multiplier powerup zones created', 'success', {
        source: 'environment_system',
        powerupCount: this.hazardZones.length,
        types: this.POWERUP_ZONE_TYPES.map((t) => `${t.name} (${t.multiplier}x)`),
        distanceStats: {
          average: Math.round(avgDistance),
          min: Math.round(minDistance),
          max: Math.round(maxDistance),
          withinGameplayArea: distances.filter((d) => d <= 3500).length,
        },
        note: 'Strategic powerup placement for risk/reward gameplay',
      });
    }
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    // CRITICAL FIX: Clamp deltaTime to prevent massive damage spikes
    // deltaTime should be in milliseconds, max 100ms per frame
    const clampedDeltaTime = Math.min(deltaTime, 100);
    const deltaSeconds = clampedDeltaTime / 1000;

    // Update asteroid spawning
    this.updateAsteroidSpawning(deltaSeconds, entityManager);

    // Re-enabled with balanced mechanics
    this._updateVoidStorm(deltaSeconds, entityManager);

    // Check for powerup collection and manage respawns
    this._updatePowerupCollection(deltaSeconds, entityManager);

    // Update active powerup durations
    this._updateActivePowerups(deltaSeconds, entityManager);

    // Update asteroid movement
    this.updateAsteroids(deltaTime, entityManager);

    // Update shard cache event
    this._updateShardCache(deltaSeconds, entityManager);

    // Update EMP pulse event
    this._updateEmpPulse(deltaSeconds, entityManager);

    // Apply world boundary damage
    this.applyBoundaryDamage(deltaSeconds, entityManager);
  }

  destroy(): void {
    this.environmentEvent$.complete();
    this.hazardZones = [];
    this.empSlowedEntities.clear();
  }

  /**
   * Set world bounds for environmental effects
   */
  setWorldBounds(width: number, height: number): void {
    this.worldBounds = { width, height };
  }

  /**
   * Create powerup zones at strategic positions
   * Uses weighted distribution to place powerups in gameplay areas
   */
  private _createPowerupZones(entityManager: EntityManager): void {
    this.hazardZones = [];

    // Get player spawn position to avoid placing hazards near it
    const PLAYER_SPAWN_X = this.worldBounds.width / 2;
    const PLAYER_SPAWN_Y = this.worldBounds.height / 2;
    const MIN_DISTANCE_FROM_SPAWN = 800; // Reduced from 1000 for more relevant placement
    const MAX_DISTANCE_FROM_SPAWN = 3500; // Most hazards within this radius

    for (let i = 0; i < this.config.hazardZoneCount; i++) {
      let x = PLAYER_SPAWN_X;
      let y = PLAYER_SPAWN_Y;
      let attempts = 0;
      const MAX_ATTEMPTS = 50;

      // Use weighted distribution - 70% within preferred range, 30% further out
      const usePreferredRange = this.random.random() < 0.7;

      let positionValid = false;
      while (!positionValid && attempts < MAX_ATTEMPTS) {
        if (usePreferredRange) {
          // Place within gameplay area using polar coordinates
          const angle = this.random.random() * Math.PI * 2;
          const minDist = MIN_DISTANCE_FROM_SPAWN;
          const maxDist = Math.min(
            MAX_DISTANCE_FROM_SPAWN,
            Math.min(this.worldBounds.width, this.worldBounds.height) * 0.4
          );
          const distance = minDist + this.random.random() * (maxDist - minDist);

          x = PLAYER_SPAWN_X + Math.cos(angle) * distance;
          y = PLAYER_SPAWN_Y + Math.sin(angle) * distance;

          // Clamp to world bounds with margin
          x = Math.max(200, Math.min(this.worldBounds.width - 200, x));
          y = Math.max(200, Math.min(this.worldBounds.height - 200, y));
        } else {
          // Random placement for variety (original algorithm)
          x = this.random.random() * this.worldBounds.width;
          y = this.random.random() * this.worldBounds.height;
        }

        attempts++;

        const dx = x - PLAYER_SPAWN_X;
        const dy = y - PLAYER_SPAWN_Y;
        const distanceFromSpawn = Math.sqrt(dx * dx + dy * dy);

        positionValid = distanceFromSpawn >= MIN_DISTANCE_FROM_SPAWN;
      }

      // Choose a random powerup type
      const powerupType = this.POWERUP_ZONE_TYPES[Math.floor(this.random.random() * this.POWERUP_ZONE_TYPES.length)];

      const powerupZone = this.createPowerupZone(x, y, powerupType, entityManager);
      this.hazardZones.push(powerupZone);

      this.environmentEvent$.next({
        type: 'damage_field_created', // Keep event type for compatibility
        position: { x, y },
        entity: powerupZone,
        zoneInfo: {
          name: powerupType.name,
          damageType: 'powerup',
          description: powerupType.description,
        },
      });

      if (window.debugLogBridge) {
        const dx = x - PLAYER_SPAWN_X;
        const dy = y - PLAYER_SPAWN_Y;
        const distanceFromSpawn = Math.sqrt(dx * dx + dy * dy);

        window.debugLogBridge.log('⚡ Powerup Zone Created', 'success', {
          name: powerupType.name,
          multiplier: `${powerupType.multiplier}x`,
          duration: `${powerupType.duration / 1000}s`,
          respawn: `${powerupType.respawnCooldown / 1000}s`,
          position: [Math.round(x), Math.round(y)],
          distanceFromSpawn: Math.round(distanceFromSpawn),
          relevance: distanceFromSpawn <= MAX_DISTANCE_FROM_SPAWN ? 'gameplay-area' : 'exploration-area',
          description: powerupType.description,
        });
      }
    }
  }

  /**
   * Create a single powerup zone entity
   */
  private createPowerupZone(
    x: number,
    y: number,
    powerupType: {
      name: string;
      color: string;
      glowColor: string;
      powerupType: 'damage_multiplier' | 'shield' | 'speed' | 'health' | 'rapid_fire' | 'experience';
      multiplier: number;
      duration: number;
      description: string;
      respawnCooldown: number;
    },
    entityManager: EntityManager
  ): Entity {
    const powerupZone = entityManager.createEntity();

    entityManager.addComponent(powerupZone, new PositionComponent(x, y));

    // Visual component with pulsing effect
    const renderable = new RenderableComponent(
      powerupType.color,
      'world' // Render in world layer so it's visible
    );
    renderable.opacity = 0.8;
    entityManager.addComponent(powerupZone, renderable);

    // Add collision box for pickup detection
    entityManager.addComponent(
      powerupZone,
      new CollisionBoxComponent(
        this.config.hazardZoneRadius, // Use same radius as before
        'powerup'
      )
    );

    // Add powerup component
    const powerupComp = new PowerupComponent().configure(
      powerupType.powerupType,
      powerupType.multiplier,
      powerupType.duration,
      powerupType.respawnCooldown
    );
    powerupComp.visualEffect = {
      color: powerupType.glowColor,
      pulseSpeed: 2,
      particleEffect: 'sparkle',
    };
    entityManager.addComponent(powerupZone, powerupComp);

    return powerupZone;
  }

  /**
   * Update asteroid spawning
   */
  private updateAsteroidSpawning(deltaSeconds: number, entityManager: EntityManager): void {
    this.asteroidSpawnTimer += deltaSeconds;

    const spawnInterval = 1 / this.config.asteroidSpawnRate;
    if (this.asteroidSpawnTimer >= spawnInterval) {
      this.asteroidSpawnTimer = 0;
      this.spawnAsteroid(entityManager);
    }
  }

  /**
   * Spawn a new asteroid
   */
  private spawnAsteroid(entityManager: EntityManager): void {
    // Cap concurrent ambient asteroids so the field doesn't flood at 0.5/s
    const existing = entityManager.getEntitiesWithComponents(AsteroidComponent);
    if (existing.length >= ENVIRONMENT_CONFIG.ASTEROID.MAX_CONCURRENT) {
      return;
    }

    // Random edge spawn position
    const edge = Math.floor(this.random.random() * 4);
    let x: number, y: number;

    switch (edge) {
      case 0: // Top
        x = this.random.random() * this.worldBounds.width;
        y = -WORLD_CONFIG.SPAWN_MARGINS.ASTEROID_SPAWN_OFFSET;
        break;
      case 1: // Right
        x = this.worldBounds.width + WORLD_CONFIG.SPAWN_MARGINS.ASTEROID_SPAWN_OFFSET;
        y = this.random.random() * this.worldBounds.height;
        break;
      case 2: // Bottom
        x = this.random.random() * this.worldBounds.width;
        y = this.worldBounds.height + WORLD_CONFIG.SPAWN_MARGINS.ASTEROID_SPAWN_OFFSET;
        break;
      case 3: // Left
      default:
        x = -WORLD_CONFIG.SPAWN_MARGINS.ASTEROID_SPAWN_OFFSET;
        y = this.random.random() * this.worldBounds.height;
        break;
    }

    const asteroid = this.createAsteroid(x, y, entityManager);

    this.environmentEvent$.next({
      type: 'asteroid_spawned',
      position: { x, y },
      entity: asteroid,
    });
  }

  /**
   * Create an asteroid entity
   */
  private createAsteroid(x: number, y: number, entityManager: EntityManager): Entity {
    const asteroid = entityManager.createEntity();

    const size =
      this.random.random() * (this.config.asteroidMaxSize - this.config.asteroidMinSize) + this.config.asteroidMinSize;

    // Random velocity towards center with some variation
    const centerX = this.worldBounds.width / 2;
    const centerY = this.worldBounds.height / 2;
    const angle = Math.atan2(centerY - y, centerX - x) + ((this.random.random() - 0.5) * Math.PI) / 4; // ±22.5 degrees variation

    const speed =
      this.random.random() * (this.config.asteroidMaxSpeed - this.config.asteroidMinSpeed) +
      this.config.asteroidMinSpeed;

    entityManager.addComponent(asteroid, new PositionComponent(x, y));
    entityManager.addComponent(asteroid, new VelocityComponent(Math.cos(angle) * speed, Math.sin(angle) * speed));
    entityManager.addComponent(asteroid, new CollisionBoxComponent(size, 'asteroid'));
    entityManager.addComponent(asteroid, new RenderableComponent('#8b7355', 'world'));
    entityManager.addComponent(
      asteroid,
      new HealthComponent(
        size * 2, // Health based on size
        size * 2,
        0.5 // 50% damage reduction
      )
    );
    entityManager.addComponent(asteroid, new DamageComponent(this.config.asteroidDamage, 'contact'));

    // AsteroidComponent marks entity for the renderer (getAsteroids queries this component)
    const rotationSpeed = (this.random.random() - 0.5) * 2; // −1 to +1 rad/s
    entityManager.addComponent(
      asteroid,
      new AsteroidComponent(size, size * 2, rotationSpeed, this.config.asteroidDamage)
    );

    return asteroid;
  }

  /**
   * Update asteroid movement and cleanup
   */
  private updateAsteroids(deltaTime: number, entityManager: EntityManager): void {
    const asteroids = entityManager.getEntitiesWithComponents(PositionComponent, VelocityComponent);

    for (const asteroid of asteroids) {
      // Check if it's an asteroid by checking collision box collision group
      const collisionBox = entityManager.getComponent(asteroid, CollisionBoxComponent);
      if (!collisionBox || collisionBox.collisionGroup !== 'asteroid') {
        continue;
      }

      const position = entityManager.getComponent(asteroid, PositionComponent);
      const velocity = entityManager.getComponent(asteroid, VelocityComponent);

      if (!position || !velocity) continue;

      // Update position
      position.x += (velocity.vx * deltaTime) / 1000;
      position.y += (velocity.vy * deltaTime) / 1000;

      // Remove if far outside bounds
      if (
        position.x < -WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN ||
        position.x > this.worldBounds.width + WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN ||
        position.y < -WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN ||
        position.y > this.worldBounds.height + WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN
      ) {
        entityManager.destroyEntity(asteroid);
      }
    }
  }

  /**
   * Update void storm mechanics
   */
  private _updateVoidStorm(deltaSeconds: number, _entityManager: EntityManager): void {
    if (!this.voidStormActive) {
      this.voidStormTimer += deltaSeconds;

      if (this.voidStormTimer >= this.config.voidStormFrequency) {
        this.voidStormTimer = 0;
        this.voidStormActive = true;
        this.voidStormTimeRemaining = this.config.voidStormDuration;

        this.environmentEvent$.next({
          type: 'void_storm_started',
        });
      }
    } else {
      this.voidStormTimeRemaining -= deltaSeconds;

      if (this.voidStormTimeRemaining <= 0) {
        this.voidStormActive = false;

        this.environmentEvent$.next({
          type: 'void_storm_ended',
        });
      }
    }
  }

  /**
   * Check for powerup collection by player
   */
  private _updatePowerupCollection(_deltaSeconds: number, entityManager: EntityManager): void {
    // Get player entities
    const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    for (const player of players) {
      const playerPos = entityManager.getComponent(player, PositionComponent);
      if (!playerPos) continue;

      // Ensure player has ActivePowerupComponent
      let activePowerups = entityManager.getComponent(player, ActivePowerupComponent);
      if (!activePowerups) {
        activePowerups = new ActivePowerupComponent();
        entityManager.addComponent(player, activePowerups);
      }

      // Check each powerup zone
      for (const powerupZone of this.hazardZones) {
        const powerupPos = entityManager.getComponent(powerupZone, PositionComponent);
        const powerup = entityManager.getComponent(powerupZone, PowerupComponent);
        const renderable = entityManager.getComponent(powerupZone, RenderableComponent);

        if (!powerupPos || !powerup) continue;

        // Check if powerup is on cooldown
        if (!powerup.isActive) {
          // Check if respawn time has passed
          const now = Date.now();
          if (now - powerup.collectedAt >= powerup.respawnTime) {
            // Relocate the powerup to a new position
            this._relocatePowerup(powerupZone, powerupPos, entityManager);

            powerup.isActive = true;
            if (renderable) {
              renderable.opacity = 0.8; // Make visible again
            }

            if (window.debugLogBridge) {
              window.debugLogBridge.log('⚡ Powerup respawned at new location', 'info', {
                source: 'environment_system',
                newPosition: [Math.round(powerupPos.x), Math.round(powerupPos.y)],
                type: powerup.type,
              });
            }
          }
          continue;
        }

        // Check distance for collection
        const dx = playerPos.x - powerupPos.x;
        const dy = playerPos.y - powerupPos.y;
        const distSq = dx * dx + dy * dy;

        if (distSq <= this.config.hazardZoneRadius * this.config.hazardZoneRadius) {
          // Health zones: skip collection if already at full HP
          if (powerup.type === 'health') {
            const health = entityManager.getComponent(player, HealthComponent);
            if (!health || health.health >= health.maxHealth) continue;
          }

          // Collect the powerup!
          powerup.isActive = false;
          powerup.collectedAt = Date.now();

          // Make it invisible
          if (renderable) {
            renderable.opacity = 0.1; // Very faint to show it's collected
          }

          // Handle different powerup types
          if (powerup.type === 'health') {
            // Apply instant health restoration
            const health = entityManager.getComponent(player, HealthComponent);
            if (health) {
              const buffComp = entityManager.getComponent(player, BuffComponent);
              const healMultiplier = buffComp?.healingMultiplier ?? 1.0;
              const healAmount = health.maxHealth * powerup.value * healMultiplier;
              health.health = Math.min(health.maxHealth, health.health + healAmount);

              // Show pickup notification
              this.visualFeedback.showUpgrade(
                'Health Pack',
                `+${Math.round(powerup.value * 100)}% health restored`,
                'health',
                'rare'
              );

              if (window.debugLogBridge) {
                window.debugLogBridge.log('💚 HEALTH PACK COLLECTED!', 'success', {
                  source: 'environment_system',
                  healAmount,
                  newHealth: health.health,
                  maxHealth: health.maxHealth,
                  respawnIn: `${powerup.respawnTime / 1000}s`,
                });
              }
            }
          } else {
            // Add timed powerup to player
            activePowerups.addPowerup(powerup.type, powerup.value, powerup.duration);

            // Register buff with BuffManagementSystemService so the HUD can display it
            const buffId =
              powerup.type === 'damage_multiplier'
                ? this.getDamageBuffId(powerup.value)
                : this.POWERUP_TO_BUFF[powerup.type];
            let buffApplied = false;
            if (buffId) {
              buffApplied = this.buffSystem.applyBuff(player, buffId, entityManager);
            }

            // Bridge to BuffSystemService for gameplay effects (speed, xp) — only if ECS buff succeeded
            if (buffApplied) {
              const engineBuff = this.POWERUP_TO_ENGINE_BUFF[powerup.type];
              if (engineBuff) {
                this.buffSystemService.applyBuff(engineBuff.id, engineBuff.stat, powerup.value, powerup.duration);
              }
            }

            // Show pickup notification
            const zoneName = this.POWERUP_ZONE_TYPES.find(
              (z) => z.powerupType === powerup.type && z.multiplier === powerup.value
            );
            const notifName = zoneName?.name ?? this._powerupDisplayName(powerup.type);
            const notifDesc = `${powerup.value}x for ${powerup.duration / 1000}s`;
            this.visualFeedback.showUpgrade(notifName, notifDesc, powerup.type, 'rare');

            // Log collection
            if (window.debugLogBridge) {
              window.debugLogBridge.log('🎯 POWERUP COLLECTED!', 'success', {
                source: 'environment_system',
                type: powerup.type,
                multiplier: powerup.value,
                duration: `${powerup.duration / 1000}s`,
                respawnIn: `${powerup.respawnTime / 1000}s`,
                playerPos: [Math.round(playerPos.x), Math.round(playerPos.y)],
                powerupPos: [Math.round(powerupPos.x), Math.round(powerupPos.y)],
              });
            }
          }

          // Play powerup pickup sound
          this.audio.playPowerupCollect();

          // Emit event
          this.environmentEvent$.next({
            type: 'damage_field_created', // Reusing event type
            position: { x: powerupPos.x, y: powerupPos.y },
            entity: powerupZone,
          });
        }
      }
    }
  }

  /**
   * Update active powerups on entities
   */
  private _updateActivePowerups(_deltaSeconds: number, entityManager: EntityManager): void {
    // Get all entities with active powerups
    const entities = entityManager.getEntitiesWithComponents(ActivePowerupComponent);

    for (const entity of entities) {
      const activePowerups = entityManager.getComponent(entity, ActivePowerupComponent);
      if (!activePowerups) continue;

      // Remove expired powerups
      const beforeCount = activePowerups.activePowerups.length;
      activePowerups.removeExpiredPowerups();
      const afterCount = activePowerups.activePowerups.length;

      // Log expiration if any expired
      if (beforeCount > afterCount && window.debugLogBridge) {
        const isPlayer = entityManager.hasComponent(entity, PlayerControlledComponent);
        if (isPlayer) {
          window.debugLogBridge.log('⏰ Powerup expired', 'warning', {
            source: 'environment_system',
            expiredCount: beforeCount - afterCount,
            remainingCount: afterCount,
            currentMultiplier: activePowerups.getDamageMultiplier(),
          });
        }
      }
    }
  }

  /**
   * Apply damage to entities outside world boundaries
   */
  private applyBoundaryDamage(deltaSeconds: number, entityManager: EntityManager): void {
    const entities = entityManager.getEntitiesWithComponents(PositionComponent, HealthComponent);

    for (const entity of entities) {
      const position = entityManager.getComponent(entity, PositionComponent);
      const health = entityManager.getComponent(entity, HealthComponent);

      if (!position || !health) continue;

      let outsideBounds = false;

      if (
        position.x < -WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN ||
        position.x > this.worldBounds.width + WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN ||
        position.y < -WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN ||
        position.y > this.worldBounds.height + WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN
      ) {
        outsideBounds = true;
      }

      if (outsideBounds) {
        const damage = this.config.worldBoundaryDamage * (1 - health.damageReduction) * deltaSeconds;

        // Check if this is the player
        const isPlayer = entityManager.hasComponent(entity, PlayerControlledComponent);

        if (isPlayer) {
          // For player: use gameState.takeDamage for proper death detection
          this.gameState.takeDamage(damage, 'world_boundary');

          // Sync health back to ECS component for rendering/display
          health.health = this.gameState.getHealth();
        } else {
          // For non-players: apply damage directly
          health.health = Math.max(0, health.health - damage);
          health.lastDamageSource = 'environmental';
        }

        // Send boundary damage to debug bridge if available
        if (window.debugLogBridge) {
          window.debugLogBridge.log('🚫 World Boundary Damage', 'info', {
            source: 'world_boundary',
            entityId: entity,
            isPlayer,
            position: [position.x, position.y],
            worldBounds: [this.worldBounds.width, this.worldBounds.height],
            margin: WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN,
            damageAmount: damage,
            healthAfter: isPlayer ? this.gameState.getHealth() : health.health,
          });
        }
      }
    }
  }

  /**
   * Get current environment status
   */
  getEnvironmentStatus(): {
    voidStormActive: boolean;
    voidStormTimeRemaining: number;
    nextStormIn: number;
    hazardZoneCount: number;
  } {
    return {
      voidStormActive: this.voidStormActive,
      voidStormTimeRemaining: this.voidStormTimeRemaining,
      nextStormIn: this.voidStormActive ? 0 : this.config.voidStormFrequency - this.voidStormTimer,
      hazardZoneCount: this.hazardZones.length,
    };
  }

  /**
   * Force start a void storm (for testing or events)
   */
  forceVoidStorm(): void {
    if (!this.voidStormActive) {
      this.voidStormActive = true;
      this.voidStormTimeRemaining = this.config.voidStormDuration;
      this.voidStormTimer = 0;

      this.environmentEvent$.next({
        type: 'void_storm_started',
      });
    }
  }

  /**
   * Create a single health pack in the world
   */
  private _createHealthPack(entityManager: EntityManager): void {
    // Get a random position within gameplay area
    const position = this._getRandomGameplayPosition();

    const healthPack = entityManager.createEntity();

    entityManager.addComponent(healthPack, new PositionComponent(position.x, position.y));

    // Visual component - green health pack
    const renderable = new RenderableComponent('#00ff00', 'world');
    renderable.opacity = 0.9;
    entityManager.addComponent(healthPack, renderable);

    // Collision box for pickup
    entityManager.addComponent(
      healthPack,
      new CollisionBoxComponent(40, 'powerup') // Slightly smaller than damage powerups
    );

    // Configure as health powerup
    const powerupComp = new PowerupComponent().configure(
      'health',
      0.5, // 50% health restoration
      0, // Instant effect
      120000 // 120 second respawn
    );
    powerupComp.visualEffect = {
      color: '#00ff00',
      pulseSpeed: 1.5,
      particleEffect: 'heal',
    };
    entityManager.addComponent(healthPack, powerupComp);

    // Add to hazard zones array for rendering
    this.hazardZones.push(healthPack);

    if (window.debugLogBridge) {
      window.debugLogBridge.log('💚 Health pack created', 'success', {
        source: 'environment_system',
        position: [Math.round(position.x), Math.round(position.y)],
        healAmount: '50%',
        respawnCooldown: '120s',
      });
    }
  }

  /**
   * Relocate a powerup to a new random position
   */
  private _relocatePowerup(
    _powerupEntity: Entity,
    positionComp: PositionComponent,
    _entityManager: EntityManager
  ): void {
    const newPosition = this._getRandomGameplayPosition();
    positionComp.x = newPosition.x;
    positionComp.y = newPosition.y;
  }

  /**
   * Update shard cache event — spawns a burst of high-value shards near the player
   */
  private _updateShardCache(deltaSeconds: number, entityManager: EntityManager): void {
    this.shardCacheTimer += deltaSeconds;

    if (this.shardCacheTimer >= this.shardCacheNextInterval) {
      this.shardCacheTimer = 0;
      this.shardCacheNextInterval = this._randomRange(
        this.shardCacheConfig.minInterval,
        this.shardCacheConfig.maxInterval
      );

      // Find player position
      const players = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
      if (players.length === 0) return;

      const playerPos = entityManager.getComponent(players[0], PositionComponent);
      if (!playerPos) return;

      // Pick a random offset direction from the player
      const cacheAngle = this.random.random() * Math.PI * 2;
      const cacheDist = this._randomRange(this.shardCacheConfig.minDistance, this.shardCacheConfig.maxDistance);
      const cacheX = Math.max(0, Math.min(this.worldBounds.width, playerPos.x + Math.cos(cacheAngle) * cacheDist));
      const cacheY = Math.max(0, Math.min(this.worldBounds.height, playerPos.y + Math.sin(cacheAngle) * cacheDist));

      const shardCount = Math.floor(
        this._randomRange(this.shardCacheConfig.minShards, this.shardCacheConfig.maxShards + 1)
      );

      for (let i = 0; i < shardCount; i++) {
        // Scatter shards within a small cluster radius (~60px)
        const offsetAngle = this.random.random() * Math.PI * 2;
        const offsetDist = this.random.random() * 60;
        const shardX = cacheX + Math.cos(offsetAngle) * offsetDist;
        const shardY = cacheY + Math.sin(offsetAngle) * offsetDist;

        const value = Math.floor(
          this._randomRange(this.shardCacheConfig.valueMultiplierMin, this.shardCacheConfig.valueMultiplierMax + 1)
        );

        const shard = entityManager.createEntity();
        entityManager.addComponent(shard, new PositionComponent(shardX, shardY));
        entityManager.addComponent(shard, new VelocityComponent(0, 0));
        const radius = Math.min(5 + value * 0.6, 10);
        entityManager.addComponent(shard, new CollisionBoxComponent(radius, 'shard'));
        entityManager.addComponent(shard, new RenderableComponent('#ffd700', 'world'));
        entityManager.addComponent(shard, new ShardComponent(value, Date.now(), Math.random() * Math.PI * 2));
      }

      this.environmentEvent$.next({
        type: 'shard_cache_spawned',
        position: { x: cacheX, y: cacheY },
      });

      if (window.debugLogBridge) {
        window.debugLogBridge.log('Shard Cache spawned', 'success', {
          source: 'environment_system',
          shardCount,
          position: [Math.round(cacheX), Math.round(cacheY)],
          distanceFromPlayer: Math.round(cacheDist),
          nextIn: `${Math.round(this.shardCacheNextInterval)}s`,
        });
      }
    }
  }

  /**
   * Update EMP pulse event — periodically slows all enemies.
   *
   * Uses a continuous multiplier approach: each frame while the pulse is active,
   * enemy velocities (already set by the AI movement system) are scaled down.
   * When the pulse ends the slow simply stops being applied and enemies resume
   * normal speed on the next frame — no stale velocity restore needed.
   */
  private _updateEmpPulse(deltaSeconds: number, entityManager: EntityManager): void {
    if (!this.empPulseActive) {
      this.empPulseTimer += deltaSeconds;

      if (this.empPulseTimer >= this.empPulseNextInterval) {
        this.empPulseTimer = 0;
        this.empPulseActive = true;
        this.empPulseTimeRemaining = this.empPulseConfig.duration;
        this.empSlowedEntities.clear();

        // Seed the set with all current AI enemies
        const enemies = entityManager.getEntitiesWithComponents(AIControlledComponent, VelocityComponent);
        for (const enemy of enemies) {
          this.empSlowedEntities.add(enemy);
        }

        this.environmentEvent$.next({ type: 'emp_pulse_started' });

        if (window.debugLogBridge) {
          window.debugLogBridge.log('EMP Pulse activated', 'warning', {
            source: 'environment_system',
            enemiesSlowed: this.empSlowedEntities.size,
            duration: `${this.empPulseConfig.duration}s`,
            slowFactor: this.empPulseConfig.slowFactor,
          });
        }
      }
    } else {
      this.empPulseTimeRemaining -= deltaSeconds;

      if (this.empPulseTimeRemaining <= 0) {
        // Pulse expired — stop applying slow; AI resumes full speed next frame
        this.empPulseActive = false;
        this.empSlowedEntities.clear();
        this.empPulseNextInterval = this._randomRange(this.empPulseConfig.minInterval, this.empPulseConfig.maxInterval);

        this.environmentEvent$.next({ type: 'emp_pulse_ended' });

        if (window.debugLogBridge) {
          window.debugLogBridge.log('EMP Pulse ended', 'info', {
            source: 'environment_system',
            nextIn: `${Math.round(this.empPulseNextInterval)}s`,
          });
        }
      } else {
        // Pulse still active — apply slow to all tracked enemies each frame.
        // Also pick up any enemies spawned mid-pulse.
        const allEnemies = entityManager.getEntitiesWithComponents(AIControlledComponent, VelocityComponent);
        for (const enemy of allEnemies) {
          if (!this.empSlowedEntities.has(enemy)) {
            this.empSlowedEntities.add(enemy);
          }
        }

        for (const enemy of this.empSlowedEntities) {
          const velocity = entityManager.getComponent(enemy, VelocityComponent);
          if (!velocity) {
            this.empSlowedEntities.delete(enemy);
            continue;
          }
          velocity.vx *= this.empPulseConfig.slowFactor;
          velocity.vy *= this.empPulseConfig.slowFactor;
        }
      }
    }
  }

  /**
   * Generate a random number in [min, max) range using seeded random
   */
  private _randomRange(min: number, max: number): number {
    return min + this.random.random() * (max - min);
  }

  /**
   * Get a random position within the gameplay area
   */
  private _getRandomGameplayPosition(): { x: number; y: number } {
    const PLAYER_SPAWN_X = this.worldBounds.width / 2;
    const PLAYER_SPAWN_Y = this.worldBounds.height / 2;
    const MIN_DISTANCE = 500;
    const MAX_DISTANCE = 2500;

    // Use polar coordinates for even distribution
    const angle = this.random.random() * Math.PI * 2;
    const distance = MIN_DISTANCE + this.random.random() * (MAX_DISTANCE - MIN_DISTANCE);

    const x = PLAYER_SPAWN_X + Math.cos(angle) * distance;
    const y = PLAYER_SPAWN_Y + Math.sin(angle) * distance;

    // Clamp to world bounds
    return {
      x: Math.max(200, Math.min(this.worldBounds.width - 200, x)),
      y: Math.max(200, Math.min(this.worldBounds.height - 200, y)),
    };
  }

  /**
   * Fallback display name for powerup types not found in POWERUP_ZONE_TYPES
   */
  private _powerupDisplayName(type: string): string {
    const names: Record<string, string> = {
      damage_multiplier: 'Damage Boost',
      speed: 'Speed Boost',
      shield: 'Shield',
      health: 'Health Pack',
      rapid_fire: 'Overclock',
      experience: 'XP Boost',
    };
    return names[type] ?? 'Power Up';
  }
}
