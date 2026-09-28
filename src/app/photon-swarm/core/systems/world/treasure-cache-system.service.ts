import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { EntityManager, System } from '../../ecs/ecs.model';
import { TREASURE_CONFIG } from '@photon/config/game-constants';
import {
  FloatingTextComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
  ZoneTreasureCacheComponent,
} from '@photon/components';
import { TreasureCacheDefinition, ZoneId } from '../../models/zone.model';
import { GUARDIAN_DEFINITIONS, ZONE_COMPLETION_REWARDS, ZONE_CONFIG } from '@photon/config/constants/world/zone.config';
import { ZoneStateService } from './zone-state.service';
import { PlayerService } from '../../player/player.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { AudioService } from '../../audio/audio.service';
import { GuardianSpawnerSystemService } from './guardian-spawner-system.service';
import { BuffMultipliers, BuffSystemService } from '../../progression/buff-system.service';
import { GameStateService } from '../../state/game-state.service';
import { PostProcessingService } from '../../effects/post-processing.service';

/**
 * TreasureCacheSystemService
 *
 * Manages treasure cache entities in the world. Responsible for spawning cache
 * entities from config, tracking open state, and emitting completion events.
 * Handles player proximity checks and loot distribution (Sprint 18).
 */
@Injectable({ providedIn: 'root' })
export class TreasureCacheSystemService implements System {
  _entityManager!: EntityManager;

  readonly openedCacheIds = new Set<number>();

  private readonly _cacheOpened$ = new Subject<{
    cacheId: number;
    zoneId: ZoneId;
    lootTableKey: string;
  }>();
  public readonly cacheOpened$ = this._cacheOpened$.asObservable();

  private readonly _zoneCompleted$ = new Subject<{ zoneId: ZoneId }>();
  public readonly zoneCompleted$ = this._zoneCompleted$.asObservable();

  private readonly discoveredCacheIds = new Set<number>();
  private readonly _cacheDiscovered$ = new Subject<{ cacheId: number; zoneId: ZoneId }>();
  public readonly cacheDiscovered$ = this._cacheDiscovered$.asObservable();

  /** cacheId → entityId */
  private cacheEntityMap = new Map<number, number>();

  /**
   * PERF: pre-cached — static map from cacheId → guardianId built once at construction time.
   * Replaces the per-update full entity scan in isGuardianDead().
   */
  private readonly cacheIdToGuardianId = new Map<number, number>();

  /**
   * PERF: pre-cached — static map from cacheId → zoneId built once at construction time.
   * Replaces the per-call .find() in getOpenedCacheCount(), making each lookup O(1).
   */
  private readonly cacheIdToZoneId = new Map<number, ZoneId>();

  /**
   * PERF: pre-cached — total cache count per zone built once at construction time.
   * Replaces the per-call .filter() in checkZoneCompletion(), making each lookup O(1).
   */
  private readonly totalCachesPerZone = new Map<ZoneId, number>();

  private initialized = false;
  private frameCounter = 0;

  /** Cache powerup → engine buff stat mapping */
  private static readonly POWERUP_BUFF_MAP: Partial<
    Record<string, { stat: keyof BuffMultipliers; id: string; multiplier: number; durationMs: number }>
  > = {
    speed: { stat: 'movementSpeed', id: 'cache_speed', multiplier: 1.3, durationMs: 15000 },
    damage_multiplier: { stat: 'beamDamage', id: 'cache_damage', multiplier: 1.5, durationMs: 12000 },
  };

  /** Instant heal percentage for health powerups (0-1) */
  private static readonly HEALTH_HEAL_PERCENT = 0.25;

  constructor(
    private readonly zoneState: ZoneStateService,
    private readonly playerService: PlayerService,
    private readonly progressionSystem: ProgressionSystemService,
    private readonly entityFactory: EntityFactoryECSService,
    private readonly audio: AudioService,
    private readonly guardianSpawner: GuardianSpawnerSystemService,
    private readonly buffSystem: BuffSystemService,
    private readonly gameState: GameStateService,
    private readonly postProcessing: PostProcessingService
  ) {
    // Build cacheId → guardianId lookup from static config (no per-frame allocation needed).
    for (const def of GUARDIAN_DEFINITIONS) {
      this.cacheIdToGuardianId.set(def.guardedCacheId, def.guardianId);
    }
    // Build cacheId → zoneId lookup from static config for O(1) getOpenedCacheCount().
    // Also build totalCachesPerZone for O(1) checkZoneCompletion().
    for (const def of TREASURE_CONFIG.CACHE_DEFINITIONS) {
      this.cacheIdToZoneId.set(def.cacheId, def.zoneId);
      const zId = def.zoneId;
      this.totalCachesPerZone.set(zId, (this.totalCachesPerZone.get(zId) ?? 0) + 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(entityManager: EntityManager): void {
    this._entityManager = entityManager;
    // Spawning happens explicitly via spawnAllCaches() — not here.
  }

  /** Spawn all cache entities from config. Safe to call once after init(). */
  spawnAllCaches(entityManager: EntityManager): void {
    if (this.initialized) {
      return;
    }
    for (const def of TREASURE_CONFIG.CACHE_DEFINITIONS) {
      this.spawnCache(entityManager, def);
    }
    this.initialized = true;
  }

  private spawnCache(entityManager: EntityManager, def: TreasureCacheDefinition): void {
    const entityId = entityManager.createEntity();

    entityManager.addComponent(entityId, new PositionComponent(def.x, def.y));
    entityManager.addComponent(entityId, new RenderableComponent('#f5c842', 'world', true, 1, 0.6));
    // guardianEntityId starts null — wired later when guardians are spawned
    entityManager.addComponent(
      entityId,
      new ZoneTreasureCacheComponent(def.cacheId, def.zoneId, def.lootTableKey, null)
    );

    this.cacheEntityMap.set(def.cacheId, entityId);
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    if (!this.initialized) return;

    // Throttle: only check every 10 frames
    this.frameCounter = (this.frameCounter + 1) % 10;
    if (this.frameCounter !== 0) return;

    const playerX = this.playerService.x$.value;
    const playerY = this.playerService.y$.value;

    for (const [cacheId, entityId] of this.cacheEntityMap) {
      if (this.openedCacheIds.has(cacheId)) continue;

      const pos = entityManager.getComponent(entityId, PositionComponent);
      const cache = entityManager.getComponent(entityId, ZoneTreasureCacheComponent);
      if (!pos || !cache || cache.isOpen) continue;

      // Squared distance check
      const dx = playerX - pos.x;
      const dy = playerY - pos.y;
      const distSq = dx * dx + dy * dy;

      // 200px discovery radius — first proximity notification
      if (distSq <= 40000 && !this.discoveredCacheIds.has(cacheId)) {
        // 200^2
        this.discoveredCacheIds.add(cacheId);
        cache.discoveryTime = Date.now();
        this._cacheDiscovered$.next({ cacheId, zoneId: cache.zoneId as ZoneId });
      }

      if (distSq > 6400) continue; // 80^2

      // Check if guardian is dead
      if (!this.isGuardianDead(cache.cacheId, entityManager)) continue;

      // Open the cache and distribute loot
      this.openCache(cacheId);
      this.distributeLoot(cache, pos.x, pos.y);
    }
  }

  /**
   * Returns true if the guardian protecting this cache is dead (or there is none).
   *
   * PERF: O(1) — uses pre-cached cacheId → guardianId map + GuardianSpawnerSystemService
   * instead of a full entity scan via getEntitiesWithComponents().
   */
  private isGuardianDead(cacheId: number, _entityManager: EntityManager): boolean {
    const guardianId = this.cacheIdToGuardianId.get(cacheId);
    if (guardianId === undefined) {
      // No guardian assigned to this cache — cache is immediately openable.
      return true;
    }
    // PERF: pre-cached — delegates to GuardianSpawnerSystemService which tracks liveness
    // via a Map<guardianId, entityId> + hasEntity() check. No full entity scan.
    return !this.guardianSpawner.isGuardianAlive(guardianId);
  }

  /**
   * Spawns shard collectibles around the cache position and awards XP.
   * Also spawns floating text notifications for shards and XP gained.
   */
  private distributeLoot(cache: ZoneTreasureCacheComponent, x: number, y: number): void {
    const lootTable = TREASURE_CONFIG.LOOT_TABLES[cache.lootTableKey];
    if (!lootTable) return;

    // Determine total shard value
    const shardCount =
      Math.floor(Math.random() * (lootTable.shardReward.max - lootTable.shardReward.min + 1)) +
      lootTable.shardReward.min;

    // Spawn 3–5 shard entities spread in a ring around the cache
    const shardEntities = Math.min(5, Math.max(3, Math.floor(shardCount / 30)));
    const shardValueEach = Math.floor(shardCount / shardEntities);

    for (let i = 0; i < shardEntities; i++) {
      const angle = (i / shardEntities) * Math.PI * 2;
      const dist = 40 + Math.random() * 60;
      const sx = x + Math.cos(angle) * dist;
      const sy = y + Math.sin(angle) * dist;
      this.entityFactory.createShard(sx, sy, shardValueEach);
    }

    // Floating text: shard reward — uses zone accent color, offset Y -30
    const zoneAccentColor = this.getZoneAccentColor(cache.zoneId);
    this.spawnFloatingText(`+${shardCount} Shards`, zoneAccentColor, 16, 1800, x, y - 30);

    // Award XP bonus
    if (lootTable.xpBonus > 0) {
      this.progressionSystem.addXp(lootTable.xpBonus);

      // Floating text: XP reward — gold color, offset Y -60 (stacked above shard text)
      this.spawnFloatingText(`+${lootTable.xpBonus} XP`, '#ffd700', 14, 1800, x, y - 60);
    }

    // Grant powerup buff if loot table specifies one
    if (lootTable.powerupType) {
      this.grantPowerup(lootTable.powerupType, x, y);
    }
  }

  /**
   * Applies the powerup effect from a cache loot table.
   * Speed and damage_multiplier grant timed buffs via BuffSystemService.
   * Health grants an instant heal (25% of max HP).
   */
  private grantPowerup(powerupType: string, x: number, y: number): void {
    const buffDef = TreasureCacheSystemService.POWERUP_BUFF_MAP[powerupType];

    if (buffDef) {
      this.buffSystem.applyBuff(buffDef.id, buffDef.stat, buffDef.multiplier, buffDef.durationMs);
      const label = powerupType === 'speed' ? 'Speed Boost' : 'Damage Boost';
      this.spawnFloatingText(`${label} ${buffDef.multiplier}x`, '#66ffcc', 13, 2000, x, y - 90);
    } else if (powerupType === 'health') {
      const maxHp = this.gameState.getMaxHealth();
      const healAmount = Math.round(maxHp * TreasureCacheSystemService.HEALTH_HEAL_PERCENT);
      this.gameState.heal(healAmount, 'treasure_cache');
      this.spawnFloatingText(`+${healAmount} HP`, '#66ff66', 13, 2000, x, y - 90);
    }
  }

  /**
   * Creates a floating text entity at the given world position.
   */
  private spawnFloatingText(
    text: string,
    color: string,
    fontSize: number,
    duration: number,
    x: number,
    y: number
  ): void {
    const entity = this._entityManager.createEntity();
    this._entityManager.addComponent(entity, new PositionComponent(x, y));
    this._entityManager.addComponent(entity, new VelocityComponent(0, 0));
    this._entityManager.addComponent(
      entity,
      new FloatingTextComponent(
        text,
        color,
        fontSize,
        duration,
        window.performance.now(),
        0, // offsetX
        0, // offsetY — position is already adjusted by caller
        0, // velocityX
        -35, // velocityY: float upward
        0.6, // fadeStart
        1.0 // scale
      )
    );
  }

  /**
   * Returns the accent color for a given zone, falling back to gold if not found.
   */
  private getZoneAccentColor(zoneId: number): string {
    const zone = ZONE_CONFIG.ZONES.find((z) => z.id === zoneId);
    return zone ? zone.accentColor : '#f5c842';
  }

  // ---------------------------------------------------------------------------
  // Cache operations
  // ---------------------------------------------------------------------------

  openCache(cacheId: number): void {
    if (this.openedCacheIds.has(cacheId)) {
      return;
    }

    this.openedCacheIds.add(cacheId);

    const entityId = this.cacheEntityMap.get(cacheId);
    if (entityId !== undefined) {
      const cacheComp = this._entityManager.getComponent(entityId, ZoneTreasureCacheComponent);
      if (cacheComp) {
        cacheComp.isOpen = true;
        cacheComp.openTime = Date.now();
      }
    }

    const def = TREASURE_CONFIG.CACHE_DEFINITIONS.find((d) => d.cacheId === cacheId);
    if (!def) {
      return;
    }

    const zoneId = def.zoneId;
    this.zoneState.recordCacheOpened(zoneId);

    this.audio.playTreasureOpen();

    this._cacheOpened$.next({ cacheId, zoneId, lootTableKey: def.lootTableKey });

    this.checkZoneCompletion(zoneId);
  }

  isCacheOpen(cacheId: number): boolean {
    return this.openedCacheIds.has(cacheId);
  }

  getOpenedCacheCount(zoneId: ZoneId): number {
    let count = 0;
    for (const cacheId of this.openedCacheIds) {
      if (this.cacheIdToZoneId.get(cacheId) === zoneId) {
        count++;
      }
    }
    return count;
  }

  getTotalCacheCount(zoneId: ZoneId): number {
    return this.totalCachesPerZone.get(zoneId) ?? 0;
  }

  private checkZoneCompletion(zoneId: ZoneId): void {
    const totalInZone = this.totalCachesPerZone.get(zoneId) ?? 0;

    if (this.getOpenedCacheCount(zoneId) >= totalInZone) {
      const reward = ZONE_COMPLETION_REWARDS[zoneId];
      if (reward) {
        this.progressionSystem.addXp(reward.xpBonus);

        // Spawn shard collectibles near the player so they can actually collect them
        const px = this.playerService.x$.value;
        const py = this.playerService.y$.value;
        const shardEntities = Math.min(5, Math.max(3, Math.floor(reward.shards / 30)));
        const shardValueEach = Math.floor(reward.shards / shardEntities);
        for (let i = 0; i < shardEntities; i++) {
          const angle = (i / shardEntities) * Math.PI * 2;
          const dist = 60 + Math.random() * 80;
          this.entityFactory.createShard(px + Math.cos(angle) * dist, py + Math.sin(angle) * dist, shardValueEach);
        }
      }

      // B6: Zone complete feedback — ascending resolve audio + gold flash
      this.audio.playZoneComplete();
      this.postProcessing.addScreenFlash({ color: { r: 255, g: 215, b: 0 }, opacity: 0.25, duration: 500 });

      this._zoneCompleted$.next({ zoneId });
      this.zoneState.markZoneCompleted(zoneId);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this._cacheOpened$.complete();
    this._zoneCompleted$.complete();
    this._cacheDiscovered$.complete();
  }

  reset(): void {
    this.openedCacheIds.clear();
    this.cacheEntityMap.clear();
    this.discoveredCacheIds.clear();
    this.initialized = false;
    this.frameCounter = 0;
  }
}
