import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { ZONE_Z_INDEX } from './zone-z-index.constants';

import { ZoneAnnouncementComponent } from './zone-announcement/zone-announcement.component';
import { ZoneCompleteComponent } from './zone-announcement/zone-complete.component';
import { ZoneLockedWarningComponent } from './zone-announcement/zone-locked-warning.component';
import { CacheDiscoveredComponent } from './zone-announcement/cache-discovered.component';
import { ZoneProgressComponent } from './hud/zone-progress/zone-progress.component';
import { ZoneGateTooltipComponent } from './hud/zone-gate-tooltip/zone-gate-tooltip.component';

import { ZoneStateService } from '../core/systems/world/zone-state.service';
import { ZoneConfigService } from '../core/systems/world/zone-config.service';

/**
 * Drift guard for the zone UI z-index hierarchy.
 *
 * The 6 zone UI components bind their host z-index via `@HostBinding('style.zIndex')`
 * to a value imported from `zone-z-index.constants.ts`. Because the binding reads
 * the constant by reference, drift is impossible without an explicit code change to
 * either the component or the constants file.
 *
 * This spec asserts:
 *   1. The constants file holds the expected numeric values (catches accidental
 *      edits to the constants file).
 *   2. Tier ordering invariants hold (HUD < overlay, severity within overlay,
 *      everything below wave-announcement and modal tiers).
 *   3. Each of the 6 components is importable from the expected path (catches
 *      file moves and accidental deletions).
 */
describe('ZONE_Z_INDEX constants', () => {
  describe('HUD tier — must match xp-bar/charge-bar level ($z-content + 5 = 15)', () => {
    it('ZONE_PROGRESS = 15', () => {
      expect(ZONE_Z_INDEX.ZONE_PROGRESS).toBe(15);
    });

    it('ZONE_GATE_TOOLTIP = 15', () => {
      expect(ZONE_Z_INDEX.ZONE_GATE_TOOLTIP).toBe(15);
    });
  });

  describe('Overlay tier — above pause overlay ($z-overlay = 100), below wave-announcement (600)', () => {
    it('ZONE_ANNOUNCEMENT = 110', () => {
      expect(ZONE_Z_INDEX.ZONE_ANNOUNCEMENT).toBe(110);
    });

    it('CACHE_DISCOVERED = 110 (matches zone-announcement tier)', () => {
      expect(ZONE_Z_INDEX.CACHE_DISCOVERED).toBe(110);
    });

    it('ZONE_LOCKED_WARNING = 115 (above zone-announcement)', () => {
      expect(ZONE_Z_INDEX.ZONE_LOCKED_WARNING).toBe(115);
    });

    it('ZONE_COMPLETE = 120 (highest zone tier — above warnings)', () => {
      expect(ZONE_Z_INDEX.ZONE_COMPLETE).toBe(120);
    });
  });

  describe('Tier ordering invariants', () => {
    it('HUD tier values are below overlay tier values', () => {
      const hudTier = [ZONE_Z_INDEX.ZONE_PROGRESS, ZONE_Z_INDEX.ZONE_GATE_TOOLTIP];
      const overlayTier = [
        ZONE_Z_INDEX.ZONE_ANNOUNCEMENT,
        ZONE_Z_INDEX.CACHE_DISCOVERED,
        ZONE_Z_INDEX.ZONE_LOCKED_WARNING,
        ZONE_Z_INDEX.ZONE_COMPLETE,
      ];
      const maxHud = Math.max(...hudTier);
      const minOverlay = Math.min(...overlayTier);
      expect(maxHud).toBeLessThan(minOverlay);
    });

    it('within overlay tier, severity increases (zone-complete is highest)', () => {
      expect(ZONE_Z_INDEX.ZONE_COMPLETE).toBeGreaterThan(ZONE_Z_INDEX.ZONE_LOCKED_WARNING);
      expect(ZONE_Z_INDEX.ZONE_LOCKED_WARNING).toBeGreaterThan(ZONE_Z_INDEX.ZONE_ANNOUNCEMENT);
    });

    it('all zone z-indexes are below the wave-announcement tier (600)', () => {
      const WAVE_ANNOUNCEMENT_Z_INDEX = 600;
      for (const value of Object.values(ZONE_Z_INDEX)) {
        expect(value).toBeLessThan(WAVE_ANNOUNCEMENT_Z_INDEX);
      }
    });

    it('all zone z-indexes are below modal tier ($z-modal = 1000)', () => {
      const Z_MODAL = 1000;
      for (const value of Object.values(ZONE_Z_INDEX)) {
        expect(value).toBeLessThan(Z_MODAL);
      }
    });
  });

  describe('component class import sanity (catches file moves and renames)', () => {
    it('all 6 zone UI components are importable', () => {
      expect(ZoneAnnouncementComponent.name).toMatch(/^_?ZoneAnnouncementComponent$/);
      expect(ZoneCompleteComponent.name).toMatch(/^_?ZoneCompleteComponent$/);
      expect(ZoneLockedWarningComponent.name).toMatch(/^_?ZoneLockedWarningComponent$/);
      expect(CacheDiscoveredComponent.name).toMatch(/^_?CacheDiscoveredComponent$/);
      expect(ZoneProgressComponent.name).toMatch(/^_?ZoneProgressComponent$/);
      expect(ZoneGateTooltipComponent.name).toMatch(/^_?ZoneGateTooltipComponent$/);
    });
  });

  // ---------------------------------------------------------------------------
  // True runtime drift guard: instantiate one zone component via TestBed and
  // assert the host element's computed z-index matches the constant.
  //
  // This is the strongest possible drift guard — if anyone removes the
  // @HostBinding field, replaces it with a literal, or imports the wrong
  // constant, this test fails. The other 5 components use the structurally
  // identical pattern, so verifying one is sufficient as a smoke test for
  // the @HostBinding approach.
  //
  // Picked ZoneLockedWarningComponent because it has the smallest DI surface
  // (only ZoneStateService and ZoneConfigService).
  // ---------------------------------------------------------------------------
  describe('@HostBinding runtime drift guard', () => {
    it('ZoneLockedWarningComponent host element z-index matches ZONE_Z_INDEX.ZONE_LOCKED_WARNING', () => {
      const lockedZoneEntered$ = new Subject<{ zoneId: 1 | 2 | 3 | 4 }>();
      const zoneStateSpy = jasmine.createSpyObj<ZoneStateService>('ZoneStateService', ['getZoneState'], {
        lockedZoneEntered$: lockedZoneEntered$.asObservable(),
      });
      const zoneConfigSpy = jasmine.createSpyObj<ZoneConfigService>('ZoneConfigService', ['getZoneById']);

      TestBed.configureTestingModule({
        imports: [ZoneLockedWarningComponent],
        providers: [
          { provide: ZoneStateService, useValue: zoneStateSpy },
          { provide: ZoneConfigService, useValue: zoneConfigSpy },
        ],
      });

      const fixture = TestBed.createComponent(ZoneLockedWarningComponent);
      fixture.detectChanges();

      // The @HostBinding('style.zIndex') sets the style.zIndex CSS property on the
      // host element. Read it back via the native element and assert equality.
      const host = fixture.nativeElement as HTMLElement;
      expect(host.style.zIndex).toBe(String(ZONE_Z_INDEX.ZONE_LOCKED_WARNING));

      // Sanity: also verify the component instance field holds the constant
      expect(fixture.componentInstance.zIndex).toBe(ZONE_Z_INDEX.ZONE_LOCKED_WARNING);
    });
  });
});
