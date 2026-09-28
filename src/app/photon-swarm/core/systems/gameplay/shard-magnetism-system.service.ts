import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { PlayerService } from '../../player/player.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PoolType } from '@photon/config/game-constants';

import { PlayerControlledComponent, PositionComponent, ShardComponent, VelocityComponent } from '@photon/components';

/**
 * Shard Magnetism System - Attracts nearby shards to the player
 *
 * This system implements the shard magnetism upgrade effect,
 * pulling shards toward the player when they get close enough.
 * Also handles shard lifetime — uncollected shards despawn after SHARD_LIFETIME_MS.
 */
@Injectable({
  providedIn: 'root',
})
export class ShardMagnetismSystemService implements System {
  private readonly BASE_MAGNETISM_RANGE = 150; // Increased base range for better UX
  private readonly MAGNETISM_FORCE = 300; // Pull force strength
  private readonly MIN_DISTANCE = 10; // Minimum distance before collection
  private readonly ACCELERATION_CURVE = 2.0; // Exponential acceleration as shard gets closer
  private readonly MAX_SPEED = 500; // Maximum shard velocity toward player
  private readonly SHARD_LIFETIME_MS = 20_000; // Shards despawn after 20 seconds

  constructor(
    private playerService: PlayerService,
    private entityFactory: EntityFactoryECSService
  ) {}

  update(deltaTime: number, entityManager: EntityManager): void {
    if (!Number.isFinite(deltaTime) || deltaTime <= 0) return;
    deltaTime = Math.min(deltaTime, 100); // Cap at ~10fps equivalent

    // Magnetism is now always active with base range
    // Upgrades increase the range further

    // Get player entity
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);

    if (playerEntities.length === 0) return;

    const playerEntity = playerEntities[0];
    const playerPos = entityManager.getComponent(playerEntity, PositionComponent);
    if (!playerPos) return;

    // Calculate effective magnetism range
    const magnetismBonus = this.playerService.getShardMagnetismBonus();
    const effectiveRange = this.BASE_MAGNETISM_RANGE + magnetismBonus;

    // Convert deltaTime to seconds for velocity calculations
    const deltaSeconds = deltaTime / 1000;

    // Get all shards
    const shards = entityManager.getEntitiesWithComponents(ShardComponent, PositionComponent, VelocityComponent);
    const now = Date.now();
    const expiredShards: number[] = [];

    for (const shardEntity of shards) {
      const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
      const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
      const shardComponent = entityManager.getComponent(shardEntity, ShardComponent);

      if (!shardPos || !shardVel || !shardComponent) continue;

      // Skip pooled/inactive entities
      if (!this.entityFactory.isEntityActive(shardEntity)) continue;

      // Lifetime check — despawn old uncollected shards
      // Guard: spawnTime=0 means uninitialized (default constructor) — skip lifetime check
      const age = shardComponent.spawnTime ? now - shardComponent.spawnTime : 0;
      if (age >= this.SHARD_LIFETIME_MS) {
        expiredShards.push(shardEntity);
        continue;
      }

      // Update shard position based on velocity FIRST
      shardPos.x += shardVel.vx * deltaSeconds;
      shardPos.y += shardVel.vy * deltaSeconds;

      // Calculate distance to player
      const dx = playerPos.x - shardPos.x;
      const dy = playerPos.y - shardPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if within magnetism range
      if (distance <= effectiveRange && distance > this.MIN_DISTANCE) {
        // Calculate normalized distance (0 = at player, 1 = at edge of range)
        const normalizedDistance = distance / effectiveRange;

        // Apply exponential curve for acceleration (faster when closer)
        const accelerationFactor = Math.pow(1 - normalizedDistance, this.ACCELERATION_CURVE);

        // Calculate pull force with smooth acceleration
        const pullStrength = this.MAGNETISM_FORCE * accelerationFactor;

        // Normalize direction vector
        const dirX = dx / distance;
        const dirY = dy / distance;

        // Calculate target velocity
        const targetVx = dirX * pullStrength;
        const targetVy = dirY * pullStrength;

        // Smooth interpolation (lerp) for natural movement (frame-rate independent)
        // At 60fps: 1 - exp(-9 * 0.0167) ≈ 0.14, matching original 0.15 behavior
        const lerpFactor = 1 - Math.exp(-9 * deltaSeconds);
        shardVel.vx = shardVel.vx * (1 - lerpFactor) + targetVx * lerpFactor;
        shardVel.vy = shardVel.vy * (1 - lerpFactor) + targetVy * lerpFactor;

        // Clamp to max speed
        const currentSpeed = Math.sqrt(shardVel.vx * shardVel.vx + shardVel.vy * shardVel.vy);
        if (currentSpeed > this.MAX_SPEED) {
          const speedScale = this.MAX_SPEED / currentSpeed;
          shardVel.vx *= speedScale;
          shardVel.vy *= speedScale;
        }

        // Mark shard as being attracted for visual effects
        shardComponent.isBeingAttracted = true;
        shardComponent.attractionDistance = normalizedDistance;
      } else {
        // Clear attraction flag if out of range
        shardComponent.isBeingAttracted = false;
      }
    }

    // Return expired shards to pool (outside iteration)
    for (const entityId of expiredShards) {
      this.entityFactory.returnToPool(PoolType.SHARD, entityId);
    }
  }
}
