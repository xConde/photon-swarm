import type { ColorblindMode } from '../core/utils/settings.service';
import type { ThemeColorPalette } from './game-constants';

/**
 * Per-mode substitution map. The keys identify semantic color slots in
 * `ThemeColorPalette.CANVAS` and `ThemeColorPalette.MINIMAP`; the values
 * are the colorblind-safe replacements.
 *
 * Values here are *illustrative* — they're principled substitutions
 * grounded in standard CVD palette guidance (push reds toward orange
 * for protanopia, greens toward teal for deuteranopia, blues toward
 * magenta for tritanopia), but final tuning needs real colorblind
 * playtesting before this ships to a wide audience.
 *
 * Adding a new key here is the only edit required to extend coverage;
 * `applyColorblindOverrides` walks the map at runtime and patches each
 * matching field. Missing keys fall through unchanged.
 */
export const COLORBLIND_CANVAS_OVERRIDES: Readonly<Record<ColorblindMode, Partial<ThemeColorPalette['CANVAS']>>> = {
  none: {},
  // Red-blind: shift red/danger signals into orange so they're still
  // distinguishable from green/blue without relying on hue.
  protanopia: {
    HEALTH_LOW: '#ff8c1a',
    DAMAGE_CRITICAL: '#ffaa00',
    HAZARD: '#ff8c1a',
    HAZARD_GLOW: '#ffaa55',
    ACCENT_ORANGE: '#ffd000',
  },
  // Green-blind: shift greens toward teal/blue so health-high and
  // success cues stay separable from yellow/orange ramps.
  deuteranopia: {
    HEALTH_HIGH: '#22d3ee',
    SHARD_HIGH: '#22d3ee',
    SHARD_MED: '#0891b2',
    ACCENT_CYAN: '#22d3ee',
  },
  // Blue-yellow blindness: shift blues toward magenta so player/beam
  // accents don't collide with yellow score/streak cues.
  tritanopia: {
    BEAM: '#cc66ff',
    BEAM_GLOW: '#dd99ff',
    PLAYER_COLOR: '#ff66dd',
    ACCENT_BLUE: '#cc66ff',
  },
} as const;

export const COLORBLIND_MINIMAP_OVERRIDES: Readonly<Record<ColorblindMode, Partial<ThemeColorPalette['MINIMAP']>>> = {
  none: {},
  protanopia: {
    ENEMY: '#ff8c1a',
    ENEMY_PULSE: '#ffaa55',
    DANGER: '#ff8c1a',
  },
  deuteranopia: {
    ALLY: '#22d3ee',
    SAFE: '#22d3ee',
  },
  tritanopia: {
    PLAYER: '#ff66dd',
    PLAYER_GLOW: '#dd99ff',
  },
} as const;

/**
 * Returns a palette identical to `palette` for `'none'`, or a new palette
 * with the per-mode substitutions applied for the three CVD modes.
 * Pure / referentially transparent — render code can memoize on
 * `(palette, mode)` without worrying about hidden state.
 */
export function applyColorblindOverrides(palette: ThemeColorPalette, mode: ColorblindMode): ThemeColorPalette {
  if (mode === 'none') return palette;
  const canvasOverrides = COLORBLIND_CANVAS_OVERRIDES[mode];
  const minimapOverrides = COLORBLIND_MINIMAP_OVERRIDES[mode];
  return {
    ...palette,
    CANVAS: { ...palette.CANVAS, ...canvasOverrides },
    MINIMAP: { ...palette.MINIMAP, ...minimapOverrides },
  };
}
