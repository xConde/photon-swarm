import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { ZoneChangeEvent, ZoneDefinition, ZoneId, ZoneState } from '../../models/zone.model';
import { ZoneConfigService } from './zone-config.service';
import { AudioService } from '../../audio/audio.service';

/**
 * ZoneStateService
 *
 * Tracks the player's current zone at runtime and emits zone change events.
 * Uses a dirty-flag optimization: if the player moves less than DIRTY_THRESHOLD
 * pixels (Manhattan distance) since the last check, the spatial lookup is skipped.
 *
 * Zone 1 starts unlocked; zones 2–4 start locked and must be explicitly unlocked.
 */
@Injectable({ providedIn: 'root' })
export class ZoneStateService {
  private currentZoneId: ZoneId | null = null;

  // Force first check by placing last-check coords far off-screen.
  private lastCheckX = -9999;
  private lastCheckY = -9999;

  /** Timestamp of the last time-accumulation tick (0 = not yet started) */
  private lastTimeUpdateMs = 0;

  /** Skip zone lookup if player moved less than this many pixels (Manhattan).
   * PERF: dirty-flag — spatial lookup skipped when player hasn't moved significantly. */
  private readonly DIRTY_THRESHOLD = 50;

  /** Runtime state per zone — mutated in place, never replaced */
  private readonly zoneStates = new Map<ZoneId, ZoneState>();

  private readonly _zoneChanged$ = new Subject<ZoneChangeEvent>();
  public readonly zoneChanged$ = this._zoneChanged$.asObservable();

  private readonly _lockedZoneEntered$ = new Subject<{ zoneId: ZoneId }>();
  public readonly lockedZoneEntered$ = this._lockedZoneEntered$.asObservable();

  /** Emits whenever recordGuardianSlain() is called — drives HUD count refresh. */
  private readonly _guardianSlain$ = new Subject<{ zoneId: ZoneId }>();
  public readonly guardianSlain$ = this._guardianSlain$.asObservable();

  constructor(
    private readonly zoneConfig: ZoneConfigService,
    private readonly audio: AudioService
  ) {
    this.initZoneStates();
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  private initZoneStates(): void {
    const allZones = this.zoneConfig.getAllZones();
    for (const zone of allZones) {
      this.zoneStates.set(zone.id, {
        zoneId: zone.id,
        isUnlocked: zone.id === 1, // Only Zone 1 starts unlocked
        isCompleted: false,
        firstEntryTime: 0,
        timeSpentMs: 0,
        cachesOpened: 0,
        guardiansSlain: 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Game loop integration
  // ---------------------------------------------------------------------------

  /**
   * Called every game loop tick with the player's world position.
   * Skips the zone lookup when the player hasn't moved significantly.
   */
  update(playerX: number, playerY: number): void {
    const dx = playerX - this.lastCheckX;
    const dy = playerY - this.lastCheckY;
    if (Math.abs(dx) + Math.abs(dy) < this.DIRTY_THRESHOLD) {
      return;
    }

    this.lastCheckX = playerX;
    this.lastCheckY = playerY;

    // Accumulate time spent in the current zone between dirty checks
    const now = Date.now();
    if (this.currentZoneId !== null && this.lastTimeUpdateMs > 0) {
      const delta = now - this.lastTimeUpdateMs;
      const timeState = this.zoneStates.get(this.currentZoneId);
      if (timeState) {
        timeState.timeSpentMs += delta;
      }
    }
    this.lastTimeUpdateMs = now;

    const zone = this.zoneConfig.getZoneAtPosition(playerX, playerY);
    const newZoneId = zone?.id ?? null;

    if (newZoneId !== this.currentZoneId) {
      const previousZoneId = this.currentZoneId;
      this.currentZoneId = newZoneId;

      // Record first-entry timestamp
      if (newZoneId !== null) {
        const state = this.zoneStates.get(newZoneId);
        if (state && state.firstEntryTime === 0) {
          state.firstEntryTime = Date.now();
        }
      }

      if (newZoneId !== null) {
        this.audio.playZoneTransition(newZoneId);
        this.audio.setAmbientZone(newZoneId);
      } else {
        this.audio.setAmbientZone(null);
      }

      this._zoneChanged$.next({ from: previousZoneId, to: newZoneId });

      if (newZoneId !== null && !this.zoneStates.get(newZoneId)?.isUnlocked) {
        this._lockedZoneEntered$.next({ zoneId: newZoneId });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Zone boundary enforcement
  // ---------------------------------------------------------------------------

  /**
   * Returns a push-back force vector if the player is near a locked zone boundary.
   * The force increases as the player gets deeper into the locked zone, creating
   * a "rubber band" effect that makes crossing feel heavy but not impossible.
   */
  getLockedZonePushBack(playerX: number, playerY: number): { dx: number; dy: number } | null {
    const zone = this.zoneConfig.getZoneAtPosition(playerX, playerY);
    if (!zone) return null;

    const state = this.zoneStates.get(zone.id);
    if (!state || state.isUnlocked) return null;

    // Player is in a locked zone — compute push-back toward a neighboring zone
    const { bounds } = zone;
    const centerX = bounds.x + bounds.width * 0.5;
    const centerY = bounds.y + bounds.height * 0.5;

    // How deep into the zone? (0 at boundary, 1 at center) — drives force magnitude
    const depthX = Math.max(0, 1 - Math.abs(playerX - centerX) / (bounds.width * 0.5));
    const depthY = Math.max(0, 1 - Math.abs(playerY - centerY) / (bounds.height * 0.5));
    const depth = Math.min(depthX, depthY);

    // Push-back force scales with depth: gentle at edge, strong at center
    const force = depth * 3.0;

    // Collect only the edges that lead to another zone — world-boundary edges are
    // dead ends and pushing toward them does nothing (the movement system clamps
    // the player at the world edge, silently eating the push vector).
    //
    // For each edge, sample a point 1px outside and check if zoneConfig finds a
    // DIFFERENT zone there. If yes, the edge is a valid push direction.
    const midX = centerX;
    const midY = centerY;
    const candidates: Array<{ axisX: number; axisY: number; dist: number }> = [];

    // Left edge (x = bounds.x)
    if (this.zoneConfig.getZoneAtPosition(bounds.x - 1, midY) !== null) {
      candidates.push({ axisX: -1, axisY: 0, dist: playerX - bounds.x });
    }
    // Right edge (x = bounds.x + bounds.width)
    if (this.zoneConfig.getZoneAtPosition(bounds.x + bounds.width, midY) !== null) {
      candidates.push({ axisX: 1, axisY: 0, dist: bounds.x + bounds.width - playerX });
    }
    // Top edge (y = bounds.y)
    if (this.zoneConfig.getZoneAtPosition(midX, bounds.y - 1) !== null) {
      candidates.push({ axisX: 0, axisY: -1, dist: playerY - bounds.y });
    }
    // Bottom edge (y = bounds.y + bounds.height)
    if (this.zoneConfig.getZoneAtPosition(midX, bounds.y + bounds.height) !== null) {
      candidates.push({ axisX: 0, axisY: 1, dist: bounds.y + bounds.height - playerY });
    }

    // No adjacent zones (shouldn't happen in the 4-zone layout but guard anyway)
    if (candidates.length === 0) return null;

    // Sort by distance and pick the nearest valid edge.
    // Corner case: if the second-nearest is within CORNER_THRESHOLD, blend the
    // two into a diagonal push. In the 4-zone layout the two valid edges always
    // sit on perpendicular axes, so the blend produces a clean 0.707 diagonal.
    candidates.sort((a, b) => a.dist - b.dist);
    const nearest = candidates[0];
    const second = candidates[1];
    const CORNER_THRESHOLD = 200;

    let pushDx = nearest.axisX;
    let pushDy = nearest.axisY;
    if (second && second.dist - nearest.dist < CORNER_THRESHOLD) {
      pushDx = (nearest.axisX + second.axisX) * 0.707;
      pushDy = (nearest.axisY + second.axisY) * 0.707;
    }

    return { dx: pushDx * force, dy: pushDy * force };
  }

  // ---------------------------------------------------------------------------
  // Zone queries
  // ---------------------------------------------------------------------------

  getCurrentZoneId(): ZoneId | null {
    return this.currentZoneId;
  }

  getCurrentZone(): ZoneDefinition | null {
    if (this.currentZoneId === null) {
      return null;
    }
    return this.zoneConfig.getZoneById(this.currentZoneId);
  }

  // ---------------------------------------------------------------------------
  // Zone unlock management
  // ---------------------------------------------------------------------------

  unlockZone(zoneId: ZoneId): void {
    const state = this.zoneStates.get(zoneId);
    if (state) {
      state.isUnlocked = true;
    }
  }

  lockZone(zoneId: ZoneId): void {
    if (zoneId === 1) return;
    const state = this.zoneStates.get(zoneId);
    if (state) state.isUnlocked = false;
  }

  isZoneUnlocked(zoneId: ZoneId): boolean {
    return this.zoneStates.get(zoneId)?.isUnlocked ?? false;
  }

  // ---------------------------------------------------------------------------
  // Zone state accessors
  // ---------------------------------------------------------------------------

  getZoneState(zoneId: ZoneId): ZoneState | undefined {
    return this.zoneStates.get(zoneId);
  }

  recordCacheOpened(zoneId: ZoneId): void {
    const state = this.zoneStates.get(zoneId);
    if (state) {
      state.cachesOpened++;
    }
  }

  recordGuardianSlain(zoneId: ZoneId): void {
    const state = this.zoneStates.get(zoneId);
    if (state) {
      state.guardiansSlain++;
    }
    this._guardianSlain$.next({ zoneId });
  }

  markZoneCompleted(zoneId: ZoneId): void {
    const state = this.zoneStates.get(zoneId);
    if (state) {
      state.isCompleted = true;
    }
  }

  /**
   * Flush pending time into the current zone's accumulator.
   * Must be called before reading timeSpentMs for end-screen stats,
   * because the dirty-flag optimization in update() may leave a gap
   * between the last 50px movement and the moment stats are collected.
   */
  flushTimeAccumulator(): void {
    if (this.currentZoneId !== null && this.lastTimeUpdateMs > 0) {
      const now = Date.now();
      const delta = now - this.lastTimeUpdateMs;
      const state = this.zoneStates.get(this.currentZoneId);
      if (state) {
        state.timeSpentMs += delta;
      }
      this.lastTimeUpdateMs = now;
    }
  }

  /** Returns the IDs of all zones the player entered at least once this run. */
  getVisitedZoneIds(): ZoneId[] {
    const visited: ZoneId[] = [];
    for (const [zoneId, state] of this.zoneStates) {
      if (state.firstEntryTime > 0) {
        visited.push(zoneId);
      }
    }
    return visited;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Complete all subjects — call when the game component is destroyed. */
  destroy(): void {
    this._zoneChanged$.complete();
    this._lockedZoneEntered$.complete();
    this._guardianSlain$.complete();
  }

  /** Reset all zone states and current zone — call on game restart. */
  reset(): void {
    this.audio.stopAmbientDrone();
    this.currentZoneId = null;
    this.lastCheckX = -9999;
    this.lastCheckY = -9999;
    this.lastTimeUpdateMs = 0;
    this.zoneStates.clear();
    this.initZoneStates();
  }
}
