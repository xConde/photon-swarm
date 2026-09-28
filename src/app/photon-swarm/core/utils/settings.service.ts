// src/app/sections/pages/projects/lazy-projects/photon-swarm/core/settings.service.ts
import { Injectable } from '@angular/core';
import { EngineSystem } from './system';
import { BehaviorSubject } from 'rxjs';
import { StorageService } from '../../services/storage.service';

/**
 * Colorblind palette modes. `'none'` keeps the canonical theme palette;
 * the three named modes remap red/green/blue collisions so the
 * danger/success/special colors stay distinguishable for the most
 * common types of color vision deficiency.
 *
 * Render-path mapping lives in [render layer — Sprint A5]. This service
 * just persists the user's choice.
 */
export type ColorblindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export const COLORBLIND_MODES: readonly ColorblindMode[] = [
  'none',
  'protanopia',
  'deuteranopia',
  'tritanopia',
] as const;

export function isColorblindMode(value: unknown): value is ColorblindMode {
  return typeof value === 'string' && COLORBLIND_MODES.some((mode) => mode === value);
}

export interface GameSettings {
  // Audio
  volume: number; // Master volume 0-100
  muted?: boolean; // Optional for compatibility with pre-audio saves and test fixtures

  // Visual - things we actually control
  screenShake: boolean; // On/off - camera shake on kills
  showDamageNumbers: boolean; // We already have this working
  chromaticAberration: boolean; // On/off - screen distortion on hit
  lowHealthVignette: boolean; // On/off - red warning at low HP

  /**
   * Active colorblind palette remap. Defaults to 'none' so existing
   * saves load unchanged; the render layer reads this to substitute
   * danger/success/special colors in Sprint A5.
   */
  colorblindMode: ColorblindMode;

  // Controls
  sensitivity: number; // Mouse sensitivity 50-200
  // Invert the aim joystick's vertical axis (touch). Optional so pre-existing saves
  // and the many test mocks built before this setting remain valid; getDefaultSettings
  // provides the concrete default and the merge fills it in for real settings.
  invertAimY?: boolean;
}

@EngineSystem()
@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly SETTINGS_KEY = 'photon-swarm-settings';
  private settingsSubject = new BehaviorSubject<GameSettings>(this.getDefaultSettings());

  public settings$ = this.settingsSubject.asObservable();

  constructor(private storage: StorageService) {
    this.loadSettings();
  }

  private getDefaultSettings(): GameSettings {
    return {
      volume: 70,
      muted: false,
      screenShake: true, // Camera shake on
      showDamageNumbers: true, // Show damage numbers
      chromaticAberration: true, // Screen distortion on hit
      lowHealthVignette: true, // Red warning at low HP
      colorblindMode: 'none', // Canonical palette by default
      sensitivity: 100, // Mouse sensitivity (50-200 range)
      invertAimY: false, // Standard (non-inverted) aim by default
    };
  }

  private loadSettings(): void {
    try {
      const savedSettings = this.storage.get<unknown>(this.SETTINGS_KEY);
      const defaults = this.getDefaultSettings();
      const normalizedSettings = this.normalizeSettings(savedSettings, defaults);
      this.settingsSubject.next(normalizedSettings);
      // Migrate older, partial, or malformed saves once. Returning players with a
      // complete save avoid a redundant localStorage write on every boot.
      if (!this.matchesSettings(savedSettings, normalizedSettings)) {
        this.saveSettings(normalizedSettings);
      }
    } catch (err) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to load settings, using defaults', 'error', {
          source: 'settings_service',
          operation: 'load_settings',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.settingsSubject.next(this.getDefaultSettings());
    }
  }

  getSettings(): GameSettings {
    return this.settingsSubject.value;
  }

  /**
   * Returns a specific setting value by key. Added for backwards-compatibility with older tests.
   */
  getSetting<K extends keyof GameSettings>(key: K): GameSettings[K] {
    return this.settingsSubject.value[key];
  }

  updateSettings(settings: Partial<GameSettings>): void {
    const current = this.settingsSubject.value;
    const updatedSettings = this.normalizeSettings({ ...current, ...settings }, current);
    this.settingsSubject.next(updatedSettings);
    try {
      this.saveSettings(updatedSettings);
    } catch (err) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to update settings', 'error', {
          source: 'settings_service',
          operation: 'update_settings',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  saveSettings(settings: GameSettings): void {
    try {
      this.storage.set(this.SETTINGS_KEY, settings);
    } catch (err) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to save settings', 'error', {
          source: 'settings_service',
          operation: 'save_settings',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  resetToDefaults(): void {
    const defaultSettings = this.getDefaultSettings();
    this.settingsSubject.next(defaultSettings);
    try {
      this.saveSettings(defaultSettings);
    } catch (err) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to reset settings to defaults', 'error', {
          source: 'settings_service',
          operation: 'reset_to_defaults',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private normalizeSettings(candidate: unknown, fallback: GameSettings): GameSettings {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ...fallback };
    }

    const record = candidate as Record<string, unknown>;
    return {
      volume: this.normalizedNumber(record['volume'], fallback.volume, 0, 100),
      muted: this.normalizedBoolean(record['muted'], fallback.muted ?? false),
      screenShake: this.normalizedBoolean(record['screenShake'], fallback.screenShake),
      showDamageNumbers: this.normalizedBoolean(record['showDamageNumbers'], fallback.showDamageNumbers),
      chromaticAberration: this.normalizedBoolean(record['chromaticAberration'], fallback.chromaticAberration),
      lowHealthVignette: this.normalizedBoolean(record['lowHealthVignette'], fallback.lowHealthVignette),
      colorblindMode: isColorblindMode(record['colorblindMode']) ? record['colorblindMode'] : fallback.colorblindMode,
      sensitivity: this.normalizedNumber(record['sensitivity'], fallback.sensitivity, 50, 200),
      invertAimY: this.normalizedBoolean(record['invertAimY'], fallback.invertAimY ?? false),
    };
  }

  private normalizedNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  private normalizedBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }

  private matchesSettings(candidate: unknown, settings: GameSettings): boolean {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    return (Object.keys(settings) as (keyof GameSettings)[]).every((key) => record[key] === settings[key]);
  }
}
