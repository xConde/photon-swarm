import { inject, Injectable } from '@angular/core';
import { ThemeService } from '@services/theme.service';
import { getThemeColors, ThemeColorPalette } from '../config/game-constants';
import { applyColorblindOverrides } from '../config/colorblind-palette';
import { ColorblindMode, SettingsService } from '../core/utils/settings.service';

/**
 * Centralized accessor for the active rendering palette. Wraps
 * `getThemeColors(isDayMode)` with `applyColorblindOverrides(palette,
 * colorblindMode)` and memoizes the result keyed on (isDayMode, mode).
 *
 * Renderers used to compute the palette ad-hoc each frame and many
 * lived in different services with their own caches; this service is
 * the single source of truth so a settings flip propagates uniformly
 * and the per-frame allocation is paid once.
 */
@Injectable({ providedIn: 'root' })
export class PaletteService {
  private readonly themeService = inject(ThemeService);
  private readonly settingsService = inject(SettingsService);

  private cached: {
    isDayMode: boolean;
    mode: ColorblindMode;
    palette: ThemeColorPalette;
  } | null = null;

  /**
   * The full active palette with theme + colorblind substitution
   * applied. Read every frame in the rendering hot path; memoized so
   * 60fps reads don't allocate.
   */
  getPalette(): ThemeColorPalette {
    const isDayMode = this.themeService.isDayMode;
    const mode = this.settingsService.getSettings().colorblindMode;
    const cached = this.cached;
    if (cached && cached.isDayMode === isDayMode && cached.mode === mode) {
      return cached.palette;
    }
    const palette = applyColorblindOverrides(getThemeColors(isDayMode), mode);
    this.cached = { isDayMode, mode, palette };
    return palette;
  }

  /** Convenience accessor for the CANVAS sub-palette (most call sites). */
  getCanvas(): ThemeColorPalette['CANVAS'] {
    return this.getPalette().CANVAS;
  }

  /** Convenience accessor for the MINIMAP sub-palette. */
  getMinimap(): ThemeColorPalette['MINIMAP'] {
    return this.getPalette().MINIMAP;
  }
}
