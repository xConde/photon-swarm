import { Injectable } from '@angular/core';
import type { UpgradeOption } from '../core/models/upgrade.model';
import type { ZoneId } from '../core/models/zone.model';
import { UpgradeService } from './upgrade.service';

export type RunRewardKind = 'upgrade' | 'route' | 'anomaly' | 'relic';

export interface RunRewardOffer {
  readonly kind: RunRewardKind;
  readonly options: UpgradeOption[];
}

/** Owns mandatory reward ordering without owning modal timing or presentation. */
@Injectable({ providedIn: 'root' })
export class RunRewardQueueService {
  private pendingUpgradeChoices = 0;
  private pendingRouteChoice = false;
  private readonly pendingAnomalyZoneIds: ZoneId[] = [];
  private readonly pendingRelicZoneIds: ZoneId[] = [];
  private readonly rewardedRelicZoneIds = new Set<ZoneId>();
  private activeRewardKind: RunRewardKind | null = null;

  constructor(private readonly upgrades: UpgradeService) {}

  queueLevelUp(): void {
    this.pendingUpgradeChoices++;
  }

  /** Returns true only when a new mandatory opening choice was queued. */
  queueOpeningCoreChoice(): boolean {
    if (this.upgrades.getActiveBeamCoreId() !== null || this.pendingUpgradeChoices > 0) return false;
    this.pendingUpgradeChoices = 1;
    return true;
  }

  queueZoneCompletion(zoneId: ZoneId): void {
    if (zoneId === 1) this.pendingRouteChoice = true;
    if (!this.rewardedRelicZoneIds.has(zoneId) && !this.pendingRelicZoneIds.includes(zoneId)) {
      this.pendingRelicZoneIds.push(zoneId);
    }
  }

  queueZoneEntry(zoneId: ZoneId): boolean {
    const anomalyIndex = zoneId === 2 || zoneId === 3 ? 1 : zoneId === 4 ? 2 : 0;
    const committedOrPending = this.upgrades.getOwnedAnomalyCount() + this.pendingAnomalyZoneIds.length;
    if (anomalyIndex <= committedOrPending || this.pendingAnomalyZoneIds.includes(zoneId)) return false;
    this.pendingAnomalyZoneIds.push(zoneId);
    return true;
  }

  hasPendingReward(): boolean {
    return (
      this.pendingRouteChoice ||
      this.pendingAnomalyZoneIds.length > 0 ||
      this.pendingRelicZoneIds.length > 0 ||
      this.pendingUpgradeChoices > 0
    );
  }

  /**
   * Claims the next offer in narrative priority order. Exhausted reward pools
   * are drained here so the host cannot get stuck recursively reopening.
   */
  takeNextOffer(): RunRewardOffer | null {
    if (this.activeRewardKind !== null) return null;

    while (this.hasPendingReward()) {
      if (this.pendingRouteChoice) {
        const options = this.upgrades.getRunRouteOptions();
        if (options.length === 0) {
          this.pendingRouteChoice = false;
          continue;
        }
        return this.activate('route', options);
      }
      if (this.pendingAnomalyZoneIds.length > 0) {
        const options = this.upgrades.drawAnomalies(3);
        if (options.length === 0) {
          this.pendingAnomalyZoneIds.shift();
          continue;
        }
        return this.activate('anomaly', options);
      }
      if (this.pendingRelicZoneIds.length > 0) {
        const options = this.upgrades.drawRelics(3);
        if (options.length === 0) {
          const exhaustedZoneId = this.pendingRelicZoneIds.shift();
          if (exhaustedZoneId !== undefined) this.rewardedRelicZoneIds.add(exhaustedZoneId);
          continue;
        }
        return this.activate('relic', options);
      }
      return this.activate('upgrade', []);
    }
    return null;
  }

  completeActiveOffer(): void {
    switch (this.activeRewardKind) {
      case 'upgrade':
        this.pendingUpgradeChoices = Math.max(0, this.pendingUpgradeChoices - 1);
        break;
      case 'route':
        this.pendingRouteChoice = false;
        break;
      case 'anomaly':
        this.pendingAnomalyZoneIds.shift();
        break;
      case 'relic': {
        const zoneId = this.pendingRelicZoneIds.shift();
        if (zoneId !== undefined) this.rewardedRelicZoneIds.add(zoneId);
        break;
      }
    }
    this.activeRewardKind = null;
  }

  reset(): void {
    this.pendingUpgradeChoices = 0;
    this.pendingRouteChoice = false;
    this.pendingAnomalyZoneIds.length = 0;
    this.pendingRelicZoneIds.length = 0;
    this.rewardedRelicZoneIds.clear();
    this.activeRewardKind = null;
  }

  private activate(kind: RunRewardKind, options: UpgradeOption[]): RunRewardOffer {
    this.activeRewardKind = kind;
    return { kind, options };
  }
}
