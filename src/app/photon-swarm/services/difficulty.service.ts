import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';
import { AscensionService } from './ascension.service';
import {
  DifficultyMode,
  DifficultyModifiers,
  HEAT_DEFINITIONS,
  HeatLevel,
  isDifficultyMode,
} from '../config/heat.config';

export type { DifficultyMode, DifficultyModifiers } from '../config/heat.config';

const STORAGE_KEY = 'difficulty';

@Injectable({ providedIn: 'root' })
export class DifficultyService {
  private currentMode: DifficultyMode = 'normal';

  constructor(
    private storage: StorageService,
    private ascension: AscensionService
  ) {
    this.loadFromStorage();
  }

  setDifficulty(mode: DifficultyMode): void {
    this.currentMode = this.isUnlocked(mode) ? mode : 'normal';
    this.storage.set<DifficultyMode>(STORAGE_KEY, this.currentMode);
  }

  getDifficulty(): DifficultyMode {
    return this.currentMode;
  }

  getModifiers(): DifficultyModifiers {
    return HEAT_DEFINITIONS[this.currentMode].modifiers;
  }

  getHeatLevel(mode: DifficultyMode = this.currentMode): HeatLevel {
    return HEAT_DEFINITIONS[mode].heatLevel;
  }

  isUnlocked(mode: DifficultyMode): boolean {
    return HEAT_DEFINITIONS[mode].requiredMastery <= this.ascension.getAscensionLevel();
  }

  getUnlockRequirement(mode: DifficultyMode): string {
    const requiredMastery = HEAT_DEFINITIONS[mode].requiredMastery;
    return requiredMastery === 0 ? 'Available' : `Requires Mastery ${requiredMastery}`;
  }

  private loadFromStorage(): void {
    const saved = this.storage.get<unknown>(STORAGE_KEY);
    if (isDifficultyMode(saved) && this.isUnlocked(saved)) {
      this.currentMode = saved;
    }
  }
}
