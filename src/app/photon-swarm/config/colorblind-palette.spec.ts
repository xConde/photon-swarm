import {
  applyColorblindOverrides,
  COLORBLIND_CANVAS_OVERRIDES,
  COLORBLIND_MINIMAP_OVERRIDES,
} from './colorblind-palette';
import { getThemeColors } from './game-constants';
import { COLORBLIND_MODES } from '../core/utils/settings.service';

describe('applyColorblindOverrides', () => {
  const dark = getThemeColors(false);
  const light = getThemeColors(true);

  it("returns the original palette unchanged for mode 'none'", () => {
    expect(applyColorblindOverrides(dark, 'none')).toBe(dark);
    expect(applyColorblindOverrides(light, 'none')).toBe(light);
  });

  it('returns a new object (not a mutation) for the three CVD modes', () => {
    const out = applyColorblindOverrides(dark, 'protanopia');
    expect(out).not.toBe(dark);
    expect(out.CANVAS).not.toBe(dark.CANVAS);
    expect(out.MINIMAP).not.toBe(dark.MINIMAP);
  });

  it('preserves keys that have no override for the active mode', () => {
    const out = applyColorblindOverrides(dark, 'protanopia');
    // PLAYER_COLOR is overridden in tritanopia only; should pass through here
    expect(out.CANVAS.PLAYER_COLOR).toBe(dark.CANVAS.PLAYER_COLOR);
  });

  it('preserves non-canvas/minimap sections wholesale (TEXT, UI, GAME, BACKGROUND)', () => {
    const out = applyColorblindOverrides(dark, 'tritanopia');
    expect(out.TEXT).toBe(dark.TEXT);
    expect(out.UI).toBe(dark.UI);
    expect(out.GAME).toBe(dark.GAME);
    expect(out.BACKGROUND).toBe(dark.BACKGROUND);
  });

  describe('protanopia (red-blind)', () => {
    it('shifts HEALTH_LOW and HAZARD off pure red so they remain distinguishable', () => {
      const out = applyColorblindOverrides(dark, 'protanopia');
      expect(out.CANVAS.HEALTH_LOW).not.toBe(dark.CANVAS.HEALTH_LOW);
      expect(out.CANVAS.HAZARD).not.toBe(dark.CANVAS.HAZARD);
      expect(out.CANVAS.HEALTH_LOW).toBe(COLORBLIND_CANVAS_OVERRIDES.protanopia.HEALTH_LOW!);
    });

    it('shifts minimap ENEMY/DANGER to the same orange ramp so the radar stays readable', () => {
      const out = applyColorblindOverrides(dark, 'protanopia');
      expect(out.MINIMAP.ENEMY).toBe(COLORBLIND_MINIMAP_OVERRIDES.protanopia.ENEMY!);
      expect(out.MINIMAP.DANGER).toBe(COLORBLIND_MINIMAP_OVERRIDES.protanopia.DANGER!);
    });
  });

  describe('deuteranopia (green-blind)', () => {
    it('shifts HEALTH_HIGH off pure green toward teal', () => {
      const out = applyColorblindOverrides(dark, 'deuteranopia');
      expect(out.CANVAS.HEALTH_HIGH).toBe(COLORBLIND_CANVAS_OVERRIDES.deuteranopia.HEALTH_HIGH!);
    });

    it('shifts minimap ALLY/SAFE to teal so green-coded friendly cues remain readable', () => {
      const out = applyColorblindOverrides(dark, 'deuteranopia');
      expect(out.MINIMAP.ALLY).toBe(COLORBLIND_MINIMAP_OVERRIDES.deuteranopia.ALLY!);
      expect(out.MINIMAP.SAFE).toBe(COLORBLIND_MINIMAP_OVERRIDES.deuteranopia.SAFE!);
    });
  });

  describe('tritanopia (blue-yellow blindness)', () => {
    it('shifts BEAM and PLAYER_COLOR off pure blue toward magenta', () => {
      const out = applyColorblindOverrides(dark, 'tritanopia');
      expect(out.CANVAS.BEAM).toBe(COLORBLIND_CANVAS_OVERRIDES.tritanopia.BEAM!);
      expect(out.CANVAS.PLAYER_COLOR).toBe(COLORBLIND_CANVAS_OVERRIDES.tritanopia.PLAYER_COLOR!);
    });
  });

  describe('palette integrity', () => {
    it('all overrides map to valid hex color strings', () => {
      const hexRegex = /^#[0-9a-fA-F]{3,8}$/;
      COLORBLIND_MODES.filter((m) => m !== 'none').forEach((mode) => {
        Object.entries(COLORBLIND_CANVAS_OVERRIDES[mode]).forEach(([key, value]) => {
          expect(value).withContext(`canvas.${mode}.${key}`).toMatch(hexRegex);
        });
        Object.entries(COLORBLIND_MINIMAP_OVERRIDES[mode]).forEach(([key, value]) => {
          expect(value).withContext(`minimap.${mode}.${key}`).toMatch(hexRegex);
        });
      });
    });

    it('every override key actually exists in the canonical ThemeColorPalette', () => {
      const dark = getThemeColors(false);
      COLORBLIND_MODES.filter((m) => m !== 'none').forEach((mode) => {
        Object.keys(COLORBLIND_CANVAS_OVERRIDES[mode]).forEach((key) => {
          expect(key in dark.CANVAS)
            .withContext(`canvas.${mode}.${key}`)
            .toBeTrue();
        });
        Object.keys(COLORBLIND_MINIMAP_OVERRIDES[mode]).forEach((key) => {
          expect(key in dark.MINIMAP)
            .withContext(`minimap.${mode}.${key}`)
            .toBeTrue();
        });
      });
    });

    it('idempotent — applying the same mode twice yields equal palettes', () => {
      const once = applyColorblindOverrides(dark, 'deuteranopia');
      const twice = applyColorblindOverrides(once, 'deuteranopia');
      expect(twice.CANVAS).toEqual(once.CANVAS);
      expect(twice.MINIMAP).toEqual(once.MINIMAP);
    });
  });
});
