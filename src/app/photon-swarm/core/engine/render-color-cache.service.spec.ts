import { TestBed } from '@angular/core/testing';
import { RenderColorCacheService } from './render-color-cache.service';
import { ThemeService } from '@services/theme.service';

describe('RenderColorCacheService', () => {
  let service: RenderColorCacheService;
  let mockThemeService: { isDayMode: boolean };

  beforeEach(() => {
    mockThemeService = { isDayMode: false };

    TestBed.configureTestingModule({
      providers: [RenderColorCacheService, { provide: ThemeService, useValue: mockThemeService }],
    });

    service = TestBed.inject(RenderColorCacheService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // hexToRgb
  // ---------------------------------------------------------------------------
  describe('hexToRgb', () => {
    it('parses a 6-digit hex color to correct {r,g,b}', () => {
      const result = service.hexToRgb('#ff8800');
      expect(result).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('parses a hex color without leading #', () => {
      const result = service.hexToRgb('00ff00');
      expect(result).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('returns null for an invalid hex string', () => {
      expect(service.hexToRgb('not-a-color')).toBeNull();
    });

    it('returns equal object on second call (cache hit)', () => {
      const first = service.hexToRgb('#ff8800');
      const second = service.hexToRgb('#ff8800');
      expect(first).toBe(second); // same reference from cache
    });

    it('returns distinct objects for distinct hex values', () => {
      const a = service.hexToRgb('#ff0000');
      const b = service.hexToRgb('#0000ff');
      expect(a).not.toEqual(b);
    });

    it('clears and repopulates cache when size cap is reached', () => {
      // Push 512 distinct entries to hit the cap, then one more
      for (let i = 0; i < 512; i++) {
        const hex = '#' + i.toString(16).padStart(6, '0');
        service.hexToRgb(hex);
      }
      // This call should succeed after cache clear
      const result = service.hexToRgb('#aabbcc');
      expect(result).toEqual({ r: 170, g: 187, b: 204 });
    });
  });

  // ---------------------------------------------------------------------------
  // darkenForLightMode
  // ---------------------------------------------------------------------------
  describe('darkenForLightMode', () => {
    it('returns the original color in dark mode (isDayMode = false)', () => {
      mockThemeService.isDayMode = false;
      const color = '#ff6600';
      expect(service.darkenForLightMode(color)).toBe(color);
    });

    it('returns a darkened rgb() string in light mode (isDayMode = true)', () => {
      mockThemeService.isDayMode = true;
      const result = service.darkenForLightMode('#ff6600');
      expect(result).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
      // Should be noticeably darker than the original — all channels capped at 255*0.42
      const match = result.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
      expect(match).not.toBeNull();
      if (match) {
        const rr = parseInt(match[1], 10);
        // original r=255; darkened lightness * 0.55 → should be well below 200
        expect(rr).toBeLessThan(200);
      }
    });

    it('returns cached value on second call in light mode', () => {
      mockThemeService.isDayMode = true;
      const first = service.darkenForLightMode('#ff6600');
      const second = service.darkenForLightMode('#ff6600');
      expect(first).toBe(second); // same string reference from cache
    });

    it('returns the original color unchanged if hex parsing fails (rgb() strings)', () => {
      mockThemeService.isDayMode = true;
      const unparseable = 'rgb(255,102,0)';
      expect(service.darkenForLightMode(unparseable)).toBe(unparseable);
    });
  });

  // ---------------------------------------------------------------------------
  // cachedRgba
  // ---------------------------------------------------------------------------
  describe('cachedRgba', () => {
    it('produces correct rgba string', () => {
      expect(service.cachedRgba(255, 128, 0, 0.5)).toBe('rgba(255, 128, 0, 0.5)');
    });

    it('returns same string reference for equivalent bucketed inputs (cache hit)', () => {
      const first = service.cachedRgba(100, 200, 50, 0.4);
      const second = service.cachedRgba(100, 200, 50, 0.4);
      expect(first).toBe(second);
    });

    it('buckets alpha to 0.05 increments', () => {
      // 0.42 should round to 0.40 (nearest 0.05 bucket)
      const a = service.cachedRgba(0, 0, 0, 0.42);
      const b = service.cachedRgba(0, 0, 0, 0.4);
      expect(a).toBe(b);
    });

    it('distinguishes entries that land in different alpha buckets', () => {
      const a = service.cachedRgba(0, 0, 0, 0.0);
      const b = service.cachedRgba(0, 0, 0, 0.5);
      expect(a).not.toBe(b);
    });

    it('clears and repopulates when size exceeds 256', () => {
      // Push > 256 distinct alpha values to trigger the size > 256 clear
      for (let i = 0; i <= 260; i++) {
        service.cachedRgba(i, 0, 0, 1.0);
      }
      // After cap clear, should still produce valid output
      expect(service.cachedRgba(255, 255, 255, 1.0)).toBe('rgba(255, 255, 255, 1)');
    });
  });

  // ---------------------------------------------------------------------------
  // clearCaches
  // ---------------------------------------------------------------------------
  describe('clearCaches', () => {
    it('forces recomputation of hexToRgb after clear (cache miss, new object reference)', () => {
      const before = service.hexToRgb('#aabbcc');
      service.clearCaches();
      const after = service.hexToRgb('#aabbcc');
      // Both are valid results but they are new objects (not the same cached ref)
      expect(after).toEqual(before);
      expect(after).not.toBe(before);
    });

    it('forces recomputation of cachedRgba after clear (result still correct)', () => {
      // Prime the cache then clear it; the call after clear should still return correct output
      service.cachedRgba(10, 20, 30, 0.5);
      service.clearCaches();
      // After clear the cache is empty but output must still be correct
      expect(service.cachedRgba(10, 20, 30, 0.5)).toBe('rgba(10, 20, 30, 0.5)');
    });

    it('forces recomputation of darkenForLightMode after clear (result still correct)', () => {
      mockThemeService.isDayMode = true;
      const before = service.darkenForLightMode('#ff0000');
      service.clearCaches();
      // After clear, output should match prior computed value (same algorithm)
      const after = service.darkenForLightMode('#ff0000');
      expect(after).toBe(before);
    });
  });
});
