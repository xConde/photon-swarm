import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { EntityManager, System } from '../../ecs/ecs.model';
import { ZoneStateService } from './zone-state.service';
import { PlayerService } from '../../player/player.service';
import { SpawnSystemService } from '../enemy-ai/spawn-system.service';
import { AudioService } from '../../audio/audio.service';
import { PositionComponent, ZoneGateComponent } from '@photon/components';
import { ZoneGateDefinition, ZoneId } from '../../models/zone.model';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ZONE_GATE_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { RunRouteService } from '../../../services/run-route.service';

export interface GateProximityEvent {
  gateId: number;
  fromZoneId: ZoneId;
  toZoneId: ZoneId;
  condition: string;
  unlockValue: number;
  currentProgress: number;
}

/**
 * ZoneGateSystemService
 *
 * ECS System that checks player proximity to zone gates and evaluates
 * unlock conditions each tick.
 *
 * Runs every 6 frames to avoid per-frame spatial queries.
 * Emits zoneUnlocked$ when a gate transitions to unlocked state.
 * Emits gateProximity$ with tooltip data when the player enters/exits a gate's
 * proximity radius, and null when the player moves away.
 */
@Injectable({ providedIn: 'root' })
export class ZoneGateSystemService implements System {
  _entityManager!: EntityManager;

  // PERF: frame-skip — update runs every 6 frames, not every frame.
  private frameCounter = 0;

  private readonly _zoneUnlocked$ = new Subject<{ zoneId: ZoneId }>();
  public readonly zoneUnlocked$ = this._zoneUnlocked$.asObservable();

  private readonly _gateProximity$ = new Subject<GateProximityEvent | null>();
  public readonly gateProximity$ = this._gateProximity$.asObservable();

  private lastProximityGateId: number | null = null;

  /** Guardian kill counts keyed by zoneId */
  readonly guardianKillCounts = new Map<number, number>();

  // PERF: squared distances — avoids Math.sqrt() in per-frame proximity checks.
  private readonly PROXIMITY_SQ = 300 * 300;
  private readonly TRIGGER_SQ = 150 * 150;

  constructor(
    private readonly zoneStateService: ZoneStateService,
    private readonly playerService: PlayerService,
    private readonly spawnSystem: SpawnSystemService,
    private readonly audio: AudioService,
    private readonly entityFactory: EntityFactoryECSService,
    private readonly runRoute: RunRouteService
  ) {}

  init(entityManager: EntityManager): void {
    this._entityManager = entityManager;
  }

  update(_deltaTime: number, entityManager: EntityManager): void {
    this.frameCounter++;
    if (this.frameCounter % 6 !== 0) {
      return;
    }

    const playerX = this.playerService.x$.value;
    const playerY = this.playerService.y$.value;

    const gateEntities = entityManager.getEntitiesWithComponents(ZoneGateComponent, PositionComponent);

    let nearestLockedGateId: number | null = null;
    let nearestDistSq = Infinity;

    for (const entity of gateEntities) {
      const gate = entityManager.getComponent(entity, ZoneGateComponent);
      const pos = entityManager.getComponent(entity, PositionComponent);
      if (!gate || !pos) {
        continue;
      }

      const dx = playerX - pos.x;
      const dy = playerY - pos.y;
      const distSq = dx * dx + dy * dy;

      if (gate.isUnlocked) {
        continue;
      }

      const routeAllowsGate = this.runRoute.canUseGate(gate.fromZoneId as ZoneId, gate.toZoneId as ZoneId);
      if (!routeAllowsGate) continue;

      // Evaluate unlock when player steps into the gate radius
      if (distSq <= this.TRIGGER_SQ) {
        const isChosenBranchEntrance = gate.fromZoneId === 1 && (gate.toZoneId === 2 || gate.toZoneId === 3);
        if (isChosenBranchEntrance || this.evaluateCondition(gate, entityManager)) {
          this.unlockGate(gate);
        }
      }

      // Track nearest locked gate in proximity range for tooltip
      if (distSq <= this.PROXIMITY_SQ && distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestLockedGateId = gate.gateId;

        const event: GateProximityEvent = {
          gateId: gate.gateId,
          fromZoneId: gate.fromZoneId as ZoneId,
          toZoneId: gate.toZoneId as ZoneId,
          condition: gate.unlockCondition,
          unlockValue: gate.unlockValue,
          currentProgress: this.getCurrentProgress(gate),
        };

        if (this.lastProximityGateId !== gate.gateId) {
          this._gateProximity$.next(event);
        }
      }
    }

    // Player left all gate proximity zones
    if (nearestLockedGateId === null && this.lastProximityGateId !== null) {
      this._gateProximity$.next(null);
    }

    this.lastProximityGateId = nearestLockedGateId;
  }

  evaluateCondition(gate: ZoneGateComponent, _entityManager: EntityManager): boolean {
    switch (gate.unlockCondition) {
      case 'wave':
        return this.spawnSystem.waveNumber >= gate.unlockValue;

      case 'treasure_clear': {
        const state = this.zoneStateService.getZoneState(gate.fromZoneId as ZoneId);
        return (state?.cachesOpened ?? 0) >= gate.unlockValue;
      }

      case 'guardian_kill':
        return (this.guardianKillCounts.get(gate.fromZoneId) ?? 0) >= gate.unlockValue;

      default:
        return false;
    }
  }

  getCurrentProgress(gate: ZoneGateComponent): number {
    switch (gate.unlockCondition) {
      case 'wave':
        return this.spawnSystem.waveNumber;

      case 'treasure_clear': {
        const state = this.zoneStateService.getZoneState(gate.fromZoneId as ZoneId);
        return state?.cachesOpened ?? 0;
      }

      case 'guardian_kill':
        return this.guardianKillCounts.get(gate.fromZoneId) ?? 0;

      default:
        return 0;
    }
  }

  /**
   * Returns the unlock progress fraction [0, 1] for a gate definition.
   * Used by the minimap renderer to pulse the gate icon when >= 80% complete.
   */
  getGateProgressFraction(gateDef: ZoneGateDefinition): number {
    switch (gateDef.unlockCondition) {
      case 'wave':
        return Math.min(1, this.spawnSystem.waveNumber / gateDef.unlockValue);
      case 'treasure_clear': {
        const state = this.zoneStateService.getZoneState(gateDef.fromZoneId);
        return Math.min(1, (state?.cachesOpened ?? 0) / gateDef.unlockValue);
      }
      case 'guardian_kill':
        return Math.min(1, (this.guardianKillCounts.get(gateDef.fromZoneId) ?? 0) / gateDef.unlockValue);
      default:
        return 0;
    }
  }

  recordGuardianKill(zoneId: ZoneId): void {
    const current = this.guardianKillCounts.get(zoneId) ?? 0;
    this.guardianKillCounts.set(zoneId, current + 1);
  }

  /** Spawn the configured gate entities after an ECS store reset. */
  spawnAllGates(): void {
    for (const definition of ZONE_GATE_DEFINITIONS) {
      this.entityFactory.createZoneGate(
        definition.gateId,
        definition.fromZoneId,
        definition.toZoneId,
        definition.x,
        definition.y,
        definition.unlockCondition,
        definition.unlockValue
      );
    }
  }

  /** Total guardian kills across all zones. Used by end-screen stats. */
  getTotalGuardianKills(): number {
    let total = 0;
    for (const count of this.guardianKillCounts.values()) {
      total += count;
    }
    return total;
  }

  unlockGate(gate: ZoneGateComponent): void {
    gate.isUnlocked = true;
    gate.lastTriggerTime = Date.now();
    this.zoneStateService.unlockZone(gate.toZoneId as ZoneId);
    this._zoneUnlocked$.next({ zoneId: gate.toZoneId as ZoneId });
    this._gateProximity$.next(null);
    this.audio.playGateUnlock();
  }

  destroy(): void {
    this._zoneUnlocked$.complete();
    this._gateProximity$.complete();
  }

  reset(): void {
    this.guardianKillCounts.clear();
    this.lastProximityGateId = null;
    this.frameCounter = 0;
  }
}
