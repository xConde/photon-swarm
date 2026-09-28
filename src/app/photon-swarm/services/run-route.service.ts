import { Injectable } from '@angular/core';
import type { RunRouteTransactionSnapshot, RunRouteZoneId } from '../core/models/run-build.model';
import type { ZoneId } from '../core/models/zone.model';
import { FactionStandingSystemService } from '../core/systems/gameplay/faction-standing-system.service';
import { ZoneStateService } from '../core/systems/world/zone-state.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

const BRANCH_ZONE_IDS: readonly RunRouteZoneId[] = [2, 3];

/** Owns the one meaningful world-route commitment made after Zone 1. */
@Injectable({ providedIn: 'root' })
export class RunRouteService {
  private selectedZoneId: RunRouteZoneId | null = null;

  constructor(
    private readonly zoneState: ZoneStateService,
    private readonly factionStanding: FactionStandingSystemService,
    private readonly debugLog: DebugLogBridgeService
  ) {}

  getSelectedZoneId(): RunRouteZoneId | null {
    return this.selectedZoneId;
  }

  chooseRoute(zoneId: RunRouteZoneId, factionId: number, grantAlliance: boolean): void {
    if (this.selectedZoneId !== null && this.selectedZoneId !== zoneId) {
      throw new Error(`Run route through Zone ${this.selectedZoneId} is already committed`);
    }

    // Treat a duplicate delivery as an idempotent retry. The route card is
    // single-pick, but this boundary also serves checkpoint reconstruction and
    // must not turn a repeated UI/event delivery into farmable faction standing.
    if (this.selectedZoneId === zoneId) return;

    this.selectedZoneId = zoneId;
    this.syncBranchLocks();
    if (grantAlliance) this.factionStanding.adjustStanding(factionId, 60);
    this.debugLog.log(`Route committed through Zone ${zoneId}`, 'success', {
      source: 'run_route_service',
      operation: 'route_committed',
      zoneId,
      factionId,
      allianceGranted: grantAlliance,
    });
  }

  canUseGate(fromZoneId: ZoneId, toZoneId: ZoneId): boolean {
    if (fromZoneId === 1 && (toZoneId === 2 || toZoneId === 3)) {
      return this.selectedZoneId === toZoneId;
    }
    if (toZoneId === 4 && (fromZoneId === 2 || fromZoneId === 3)) {
      return this.selectedZoneId === fromZoneId;
    }
    return true;
  }

  captureUpgradeTransaction(): RunRouteTransactionSnapshot {
    return { selectedZoneId: this.selectedZoneId };
  }

  restoreUpgradeTransaction(snapshot: RunRouteTransactionSnapshot): void {
    this.selectedZoneId = snapshot.selectedZoneId;
    this.syncBranchLocks();
  }

  reset(): void {
    this.selectedZoneId = null;
    this.syncBranchLocks();
  }

  private syncBranchLocks(): void {
    for (const zoneId of BRANCH_ZONE_IDS) {
      if (zoneId === this.selectedZoneId) this.zoneState.unlockZone(zoneId);
      else this.zoneState.lockZone(zoneId);
    }
  }
}
