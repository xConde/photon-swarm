import { Injectable } from '@angular/core';
import { EntityManagerService } from '../../ecs/entity-manager.service';

/**
 * MinionTrackerService — tracks per-owner alive minion counts for SUMMON_MINIONS cap enforcement.
 * Slot accounting:
 *   - recordSpawn: adds a minion slot to the owner's set
 *   - recordMinionDeath: frees the slot when a tagged minion dies
 *   - cleanupOwner: drops the owner's entire slot set (e.g. on summoner death)
 *     NOTE: cleanupOwner does NOT destroy the minions — they persist ownerless after
 *     the summoner dies. Only the cap-counting slots are freed.
 */
@Injectable({ providedIn: 'root' })
export class MinionTrackerService {
  private readonly aliveMinions = new Map<number, Set<number>>();

  /**
   * Record that ownerId spawned a minion with minionId.
   */
  recordSpawn(ownerId: number, minionId: number): void {
    let set = this.aliveMinions.get(ownerId);
    if (!set) {
      set = new Set<number>();
      this.aliveMinions.set(ownerId, set);
    }
    set.add(minionId);
  }

  /**
   * Record that a minion died. Removes its slot from the owner's set.
   * Cleans up the map entry when the owner's set becomes empty.
   */
  recordMinionDeath(minionId: number, ownerId: number): void {
    const set = this.aliveMinions.get(ownerId);
    if (!set) return;
    set.delete(minionId);
    if (set.size === 0) {
      this.aliveMinions.delete(ownerId);
    }
  }

  /**
   * Returns how many minions are currently tracked as alive for this owner.
   */
  getAliveCount(ownerId: number): number {
    return this.aliveMinions.get(ownerId)?.size ?? 0;
  }

  /**
   * Drop the owner's entire slot set (called when the summoner dies).
   * Minions that were counted here are now ownerless but still alive in the ECS —
   * they won't count against any future cap because the entry is gone.
   */
  cleanupOwner(ownerId: number): void {
    this.aliveMinions.delete(ownerId);
  }

  /**
   * Sweep ghost IDs whose entities no longer exist in the ECS. Catches minions
   * that despawned via non-death paths (zone transitions, end-of-run cleanup,
   * direct pool reclaim) that bypass `recordMinionDeath`. Without this, owner
   * caps deflate over a long run and Tanks eventually can't summon.
   */
  prune(entityManager: EntityManagerService): void {
    for (const [ownerId, set] of this.aliveMinions) {
      for (const minionId of set) {
        if (!entityManager.hasEntity(minionId)) {
          set.delete(minionId);
        }
      }
      if (set.size === 0) {
        this.aliveMinions.delete(ownerId);
      }
    }
  }

  /**
   * Clear all tracked minion data. Used in tests to prevent state leakage.
   */
  reset(): void {
    this.aliveMinions.clear();
  }
}
