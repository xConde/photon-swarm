import { Injectable } from '@angular/core';
import type {
  RunPressureChange,
  RunPressureModifiers,
  RunPressureTransactionSnapshot,
} from '../core/models/run-build.model';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

const BASE_RUN_PRESSURE: Readonly<RunPressureModifiers> = Object.freeze({
  enemyHealth: 1,
  enemyDamage: 1,
  enemySpeed: 1,
  spawnTempo: 1,
  waveSize: 1,
  eliteFrequency: 1,
});

/**
 * Owns run-scoped world pressure selected through anomalies.
 *
 * It stays separate from DifficultyService: difficulty is a persistent player
 * preference, while these multipliers are authored consequences that reset on
 * death and are reconstructed from the run's chosen anomaly cards.
 */
@Injectable({ providedIn: 'root' })
export class RunPressureService {
  private modifiers: RunPressureModifiers = { ...BASE_RUN_PRESSURE };

  constructor(private readonly debugLog: DebugLogBridgeService) {}

  getModifiers(): Readonly<RunPressureModifiers> {
    return this.modifiers;
  }

  apply(change: RunPressureChange, sourceId: string): void {
    const keys = Object.keys(change) as (keyof RunPressureModifiers)[];

    // Validate the whole change before mutating any field. UpgradeService wraps
    // cards in a transaction, but this service is also a public engine boundary;
    // a malformed multi-field change must never leave partial pressure behind.
    for (const key of keys) {
      const factor = change[key];
      if (factor === undefined || !Number.isFinite(factor) || factor <= 0) {
        throw new Error(`Invalid run-pressure factor for ${key}`);
      }
    }

    for (const key of keys) {
      const factor = change[key];
      if (factor === undefined) continue;
      this.modifiers[key] *= factor;
    }

    this.debugLog.log(`Anomaly pressure applied: ${sourceId}`, 'warning', {
      source: 'run_pressure_service',
      operation: 'apply',
      anomalyId: sourceId,
      change,
      modifiers: { ...this.modifiers },
    });
  }

  captureUpgradeTransaction(): RunPressureTransactionSnapshot {
    return { modifiers: { ...this.modifiers } };
  }

  restoreUpgradeTransaction(snapshot: RunPressureTransactionSnapshot): void {
    this.modifiers = { ...snapshot.modifiers };
  }

  reset(): void {
    this.modifiers = { ...BASE_RUN_PRESSURE };
  }
}
