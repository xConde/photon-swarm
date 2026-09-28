import { Injectable } from '@angular/core';

import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PlayerService } from '../../player/player.service';
import { ZoneStateService } from './zone-state.service';
import { GUARDIAN_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { HealthComponent } from '@photon/components';

/**
 * GuardianSpawnerSystemService
 *
 * Manages the lifecycle of world-boss guardian entities. On init, spawns all
 * 12 guardians at their home positions. Each tick (throttled to 2-second
 * intervals) it checks liveness and re-queues respawns when a guardian dies.
 *
 * Respawns are proximity-gated: a guardian will not respawn while the player
 * is within 3000px of its home, preventing invisible pop-ins during combat.
 */
@Injectable({ providedIn: 'root' })
export class GuardianSpawnerSystemService implements System {
  _entityManager!: EntityManager;

  /** Accumulated seconds since last liveness check.
   * PERF: accumulator pattern — no setInterval, throttled to 2s via deltaTime accumulation. */
  private updateAccumulator = 0;
  private readonly UPDATE_INTERVAL = 2.0;

  /** guardianId → live entityId. PERF: pre-cached — O(1) liveness lookup, no entity scan. */
  private activeGuardians = new Map<number, number>();

  /** guardianId → timestamp after which respawn is allowed */
  private respawnTimers = new Map<number, number>();

  private initialized = false;

  // PERF: squared distance — proximity check uses dx*dx+dy*dy, no Math.sqrt().
  private readonly RESPAWN_PROXIMITY_THRESHOLD_SQ = 3000 * 3000;

  constructor(
    private readonly entityFactory: EntityFactoryECSService,
    private readonly playerService: PlayerService,
    private readonly zoneStateService: ZoneStateService
  ) {}

  // ---------------------------------------------------------------------------
  // System lifecycle
  // ---------------------------------------------------------------------------

  init(entityManager: EntityManager): void {
    this._entityManager = entityManager;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Spawn guardians for all currently unlocked zones. Safe to call once. */
  spawnAllGuardians(): void {
    if (this.initialized) {
      return;
    }
    for (const def of GUARDIAN_DEFINITIONS) {
      // Validate aggro/leash invariant — prevents oscillating behavior if config is wrong
      if (def.aggroRadius >= def.leashRadius) {
        if (window.debugLogBridge) {
          window.debugLogBridge.log(
            `⚠️ Guardian ${def.guardianId}: aggroRadius (${def.aggroRadius}) >= leashRadius (${def.leashRadius})`,
            'warning',
            { source: 'guardian_spawner', guardianId: def.guardianId }
          );
        }
      }
      // Only spawn guardians in unlocked zones at init
      if (this.zoneStateService.isZoneUnlocked(def.zoneId)) {
        const entityId = this.entityFactory.createGuardian(def);
        this.activeGuardians.set(def.guardianId, entityId);
      }
    }
    this.initialized = true;
  }

  /** Returns true if the guardian is alive and its entity still exists. */
  isGuardianAlive(guardianId: number): boolean {
    const entityId = this.activeGuardians.get(guardianId);
    if (entityId === undefined) {
      return false;
    }
    return this.isEntityAlive(entityId);
  }

  /** Returns the live entity ID for the given guardian, or undefined if dead/unspawned. */
  getActiveGuardianEntityId(guardianId: number): number | undefined {
    const entityId = this.activeGuardians.get(guardianId);
    if (entityId === undefined) {
      return undefined;
    }
    return this.isEntityAlive(entityId) ? entityId : undefined;
  }

  // ---------------------------------------------------------------------------
  // ECS update
  // ---------------------------------------------------------------------------

  update(deltaTime: number, _entityManager: EntityManager): void {
    this.updateAccumulator += deltaTime;
    if (this.updateAccumulator < this.UPDATE_INTERVAL) {
      return;
    }
    this.updateAccumulator = 0;

    let spawnsThisTick = 0;
    const MAX_SPAWNS_PER_TICK = 2;

    const now = Date.now();
    const playerX = this.playerService.x$.value;
    const playerY = this.playerService.y$.value;

    // Check liveness of all active guardians
    for (const def of GUARDIAN_DEFINITIONS) {
      const entityId = this.activeGuardians.get(def.guardianId);
      if (entityId !== undefined && !this.isEntityAlive(entityId)) {
        // Guardian just died — start respawn timer
        this.activeGuardians.delete(def.guardianId);
        this.respawnTimers.set(def.guardianId, now + def.respawnDelayMs);
      }
    }

    // Process respawn queue
    for (const def of GUARDIAN_DEFINITIONS) {
      const readyAt = this.respawnTimers.get(def.guardianId);
      if (readyAt === undefined || now < readyAt) {
        continue;
      }

      // Skip respawn if player is too close to avoid pop-ins during combat
      const dx = playerX - def.homeX;
      const dy = playerY - def.homeY;
      const distSq = dx * dx + dy * dy;
      if (distSq < this.RESPAWN_PROXIMITY_THRESHOLD_SQ) {
        this.respawnTimers.set(def.guardianId, now + 5000);
        continue;
      }

      // Defer remaining spawns to next tick to prevent frame-level entity spikes
      if (spawnsThisTick >= MAX_SPAWNS_PER_TICK) {
        break;
      }

      // Clear timer and spawn
      this.respawnTimers.delete(def.guardianId);
      const newEntityId = this.entityFactory.createGuardian(def);
      this.activeGuardians.set(def.guardianId, newEntityId);
      spawnsThisTick++;
    }

    // Lazy-spawn guardians for newly unlocked zones
    for (const def of GUARDIAN_DEFINITIONS) {
      if (spawnsThisTick >= MAX_SPAWNS_PER_TICK) {
        break;
      }
      if (this.activeGuardians.has(def.guardianId) || this.respawnTimers.has(def.guardianId)) {
        continue;
      }
      // Guardian not tracked — check if its zone is now unlocked
      if (this.zoneStateService.isZoneUnlocked(def.zoneId)) {
        const newEntityId = this.entityFactory.createGuardian(def);
        this.activeGuardians.set(def.guardianId, newEntityId);
        spawnsThisTick++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.activeGuardians.clear();
    this.respawnTimers.clear();
  }

  reset(): void {
    this.activeGuardians.clear();
    this.respawnTimers.clear();
    this.initialized = false;
    this.updateAccumulator = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private isEntityAlive(entityId: number): boolean {
    if (!this._entityManager.hasEntity(entityId)) {
      return false;
    }
    const health = this._entityManager.getComponent(entityId, HealthComponent);
    if (!health) {
      return false;
    }
    return health.health > 0;
  }
}
