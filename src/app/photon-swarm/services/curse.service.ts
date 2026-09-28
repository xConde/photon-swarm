import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { CurseSeverity } from '../core/models/upgrade.model';
import { CurseSnapshot } from '../core/models/save-game.model';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

export interface Curse {
  id: string;
  name: string;
  description: string;
  hiddenEffect?: string;
  severity: CurseSeverity;
  active: boolean;
}

export interface CurseUpgradeTransactionSnapshot {
  curses: Curse[];
  counts: Record<CurseSeverity, number>;
}

@Injectable({
  providedIn: 'root',
})
export class CurseService {
  private curses: Curse[] = [];
  private cursesSubject = new BehaviorSubject<Curse[]>([]);
  public curses$ = this.cursesSubject.asObservable();

  private curseRemovedSubject = new Subject<string>();
  public curseRemoved$ = this.curseRemovedSubject.asObservable();

  private curseCounts: Record<CurseSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };

  constructor(private debugLog: DebugLogBridgeService) {
    // Curses are intentionally not loaded from storage; they are session-based.
  }

  addCurse(curse: Curse): boolean {
    if (this.curses.some((c) => c.id === curse.id)) {
      this.debugLog.log(`Curse with id ${curse.id} already exists. Not adding duplicate.`, 'warning');
      return false;
    }

    if (!curse.severity || !Object.prototype.hasOwnProperty.call(this.curseCounts, curse.severity)) {
      this.debugLog.log(`Invalid severity '${curse.severity}' for curse '${curse.id}'. Cannot add curse.`, 'error');
      return false;
    }

    this.curses.push({ ...curse, active: true }); // Ensure curse is marked active
    this.curseCounts[curse.severity]++;
    this.cursesSubject.next([...this.curses]);
    return true;
  }

  captureUpgradeTransaction(): CurseUpgradeTransactionSnapshot {
    return {
      curses: this.curses.map((curse) => ({ ...curse })),
      counts: { ...this.curseCounts },
    };
  }

  restoreUpgradeTransaction(snapshot: CurseUpgradeTransactionSnapshot): void {
    this.curses = snapshot.curses.map((curse) => ({ ...curse }));
    this.curseCounts = { ...snapshot.counts };
    this.cursesSubject.next([...this.curses]);
  }

  removeCurse(curseId: string): void {
    const curseIndex = this.curses.findIndex((c) => c.id === curseId);

    if (curseIndex !== -1) {
      const removedCurse = this.curses[curseIndex];
      if (Object.prototype.hasOwnProperty.call(this.curseCounts, removedCurse.severity)) {
        this.curseCounts[removedCurse.severity]--;
      } else {
        this.debugLog.log(
          `Removed curse '${curseId}' had unexpected severity '${removedCurse.severity}'. Counts may be inaccurate.`,
          'warning'
        );
      }

      this.curses.splice(curseIndex, 1);
      this.cursesSubject.next([...this.curses]);

      // Emit curse removal event for buff system cleanup
      this.curseRemovedSubject.next(removedCurse.id);
    }
  }

  getAllCurses(): Curse[] {
    return [...this.curses];
  }

  hasCurse(curseId: string): boolean {
    return this.curses.some((c) => c.id === curseId);
  }

  getCurseCount(): number {
    return this.curses.length;
  }

  getSeverityCounts(): { low: number; medium: number; high: number } {
    return { ...this.curseCounts };
  }

  getCursesBySeverity(severity: CurseSeverity): Curse[] {
    if (!Object.prototype.hasOwnProperty.call(this.curseCounts, severity)) {
      this.debugLog.log(`Invalid severity '${severity}' requested.`, 'warning');
      return [];
    }
    return this.curses.filter((curse) => curse.severity === severity);
  }

  hasCurseSeverity(severity: CurseSeverity): boolean {
    if (!Object.prototype.hasOwnProperty.call(this.curseCounts, severity)) {
      return false;
    }
    return this.curseCounts[severity] > 0;
  }

  getDifficultyMultiplier(): number {
    let multiplier = 1.0;
    multiplier += (this.curseCounts.low || 0) * 0.05;
    multiplier += (this.curseCounts.medium || 0) * 0.15;
    multiplier += (this.curseCounts.high || 0) * 0.25;
    return multiplier;
  }

  resetAllCurses(): void {
    this.curses = [];
    this.resetCurseCounts();
    this.cursesSubject.next([]);
  }

  /**
   * Get curses for mid-run save (NOT for persistence between deaths)
   * Returns full curse snapshots so they can be properly restored
   */
  getCursesForSave(): CurseSnapshot[] {
    return this.curses.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      hiddenEffect: c.hiddenEffect,
      severity: c.severity,
    }));
  }

  /**
   * Load curses from a mid-run save (NOT from death)
   * Accepts full curse snapshots and restores them
   */
  loadCursesFromSave(savedCurses: CurseSnapshot[]): void {
    // Clear current curses
    this.resetAllCurses();

    if (savedCurses && savedCurses.length > 0) {
      // Restore each curse from the snapshot
      for (const snapshot of savedCurses) {
        this.addCurse({
          id: snapshot.id,
          name: snapshot.name,
          description: snapshot.description,
          hiddenEffect: snapshot.hiddenEffect,
          severity: snapshot.severity,
          active: true,
        });
      }

      this.debugLog.log('💾 Restored curses from save game', 'info', {
        source: 'curse_service',
        operation: 'load_from_save',
        curseCount: savedCurses.length,
        curseIds: savedCurses.map((c) => c.id),
      });
    }
  }

  private resetCurseCounts(): void {
    this.curseCounts = {
      low: 0,
      medium: 0,
      high: 0,
    };
  }
}
