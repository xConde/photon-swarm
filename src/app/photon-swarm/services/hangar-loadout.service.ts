import { Injectable } from '@angular/core';
import { HANGAR_MODULES, HANGAR_STORAGE_KEYS, HangarModuleId, isHangarModuleId } from '../config/hangar-module.config';
import { StorageService } from './storage.service';

export interface HangarLoadoutSnapshot {
  readonly version: 1;
  readonly unlocks: Readonly<Partial<Record<HangarModuleId, boolean>>>;
  readonly activeModuleId: HangarModuleId | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Owns the one atomic persistent record for hangar unlocks and selection. */
@Injectable({ providedIn: 'root' })
export class HangarLoadoutService {
  private state: HangarLoadoutSnapshot;

  constructor(private readonly storage: StorageService) {
    this.state = this.load();
  }

  getSnapshot(): HangarLoadoutSnapshot {
    return { ...this.state, unlocks: { ...this.state.unlocks } };
  }

  isUnlocked(id: HangarModuleId): boolean {
    return this.state.unlocks[id] === true;
  }

  unlockAndEquip(id: HangarModuleId): boolean {
    const next: HangarLoadoutSnapshot = {
      version: 1,
      unlocks: { ...this.state.unlocks, [id]: true },
      activeModuleId: id,
    };
    return this.commit(next);
  }

  equip(id: HangarModuleId): boolean {
    if (!this.isUnlocked(id)) return false;
    return this.commit({ ...this.state, activeModuleId: id });
  }

  private commit(next: HangarLoadoutSnapshot): boolean {
    if (!this.storage.set(HANGAR_STORAGE_KEYS.loadout, next)) return false;
    this.state = next;
    return true;
  }

  private load(): HangarLoadoutSnapshot {
    const current = this.parseCurrent(this.storage.get<unknown>(HANGAR_STORAGE_KEYS.loadout));
    if (current) return current;

    const migrated = this.migrateLegacy();
    this.storage.set(HANGAR_STORAGE_KEYS.loadout, migrated);
    return migrated;
  }

  private parseCurrent(raw: unknown): HangarLoadoutSnapshot | null {
    if (!isRecord(raw) || raw['version'] !== 1 || !isRecord(raw['unlocks'])) return null;

    const unlocks: Partial<Record<HangarModuleId, boolean>> = {};
    for (const module of HANGAR_MODULES) {
      if (raw['unlocks'][module.id] === true) unlocks[module.id] = true;
    }
    const candidateActive = raw['activeModuleId'];
    const activeModuleId =
      isHangarModuleId(candidateActive) && unlocks[candidateActive] === true ? candidateActive : null;
    return { version: 1, unlocks, activeModuleId };
  }

  private migrateLegacy(): HangarLoadoutSnapshot {
    const rawUnlocks = this.storage.get<unknown>(HANGAR_STORAGE_KEYS.unlocks);
    const unlocks: Partial<Record<HangarModuleId, boolean>> = {};
    if (isRecord(rawUnlocks)) {
      for (const module of HANGAR_MODULES) {
        const legacyLevel = rawUnlocks[module.id];
        if (typeof legacyLevel === 'number' && Number.isFinite(legacyLevel) && legacyLevel > 0) {
          unlocks[module.id] = true;
        }
      }
    }

    const rawActive = this.storage.get<unknown>(HANGAR_STORAGE_KEYS.active);
    const activeModuleId = isHangarModuleId(rawActive) && unlocks[rawActive] === true ? rawActive : null;
    return { version: 1, unlocks, activeModuleId };
  }
}
