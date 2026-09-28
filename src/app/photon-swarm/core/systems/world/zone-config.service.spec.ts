import { TestBed } from '@angular/core/testing';

import { ZoneConfigService } from './zone-config.service';
import { ZoneDefinition } from '../../models/zone.model';

/**
 * Zone layout (world: 12000 x 9000):
 *
 *   Zone 1 — Nebula Expanse  x:[0,7000)   y:[0,5500)
 *   Zone 2 — Asteroid Belt   x:[7000,12000) y:[0,5500)
 *   Zone 3 — Void Rift       x:[0,7000)   y:[5500,9000)
 *   Zone 4 — Deep Core       x:[7000,12000) y:[5500,9000)
 */
describe('ZoneConfigService', () => {
  let service: ZoneConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ZoneConfigService] });
    service = TestBed.inject(ZoneConfigService);
  });

  // ---------------------------------------------------------------------------
  // getZoneAtPosition — quadrant coverage
  // ---------------------------------------------------------------------------

  describe('getZoneAtPosition', () => {
    it('returns Zone 1 for a position in the top-left quadrant', () => {
      const zone = service.getZoneAtPosition(3500, 2750);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(1);
    });

    it('returns Zone 2 for a position in the top-right quadrant', () => {
      const zone = service.getZoneAtPosition(9500, 2750);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(2);
    });

    it('returns Zone 3 for a position in the bottom-left quadrant', () => {
      const zone = service.getZoneAtPosition(3500, 7000);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(3);
    });

    it('returns Zone 4 for a position in the bottom-right quadrant', () => {
      const zone = service.getZoneAtPosition(9500, 7000);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(4);
    });

    // -------------------------------------------------------------------------
    // Boundary edge cases — bounds check is [inclusive, exclusive)
    // -------------------------------------------------------------------------

    it('returns Zone 1 for x=6999 (just inside Zone 1 right edge)', () => {
      const zone = service.getZoneAtPosition(6999, 2750);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(1);
    });

    it('returns Zone 2 for x=7000 (exactly on the Zone 1/2 boundary)', () => {
      const zone = service.getZoneAtPosition(7000, 2750);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(2);
    });

    it('returns Zone 1 for y=5499 (just inside Zone 1 bottom edge)', () => {
      const zone = service.getZoneAtPosition(3500, 5499);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(1);
    });

    it('returns Zone 3 for y=5500 (exactly on the Zone 1/3 boundary)', () => {
      const zone = service.getZoneAtPosition(3500, 5500);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(3);
    });

    // -------------------------------------------------------------------------
    // Out-of-bounds
    // -------------------------------------------------------------------------

    it('returns null for x < 0', () => {
      expect(service.getZoneAtPosition(-1, 2750)).toBeNull();
    });

    it('returns null for y < 0', () => {
      expect(service.getZoneAtPosition(3500, -1)).toBeNull();
    });

    it('returns null for x >= world width (12000)', () => {
      expect(service.getZoneAtPosition(12000, 2750)).toBeNull();
    });

    it('returns null for y >= world height (9000)', () => {
      expect(service.getZoneAtPosition(3500, 9000)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getZoneById
  // ---------------------------------------------------------------------------

  describe('getZoneById', () => {
    it('returns Zone 1 definition for id=1', () => {
      const zone = service.getZoneById(1);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(1);
    });

    it('returns Zone 2 definition for id=2', () => {
      const zone = service.getZoneById(2);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(2);
    });

    it('returns Zone 3 definition for id=3', () => {
      const zone = service.getZoneById(3);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(3);
    });

    it('returns Zone 4 definition for id=4', () => {
      const zone = service.getZoneById(4);
      expect(zone).not.toBeNull();
      expect(zone!.id).toBe(4);
    });

    it('returns null for an invalid id', () => {
      // Cast to bypass TS — simulates a runtime bad value
      expect(service.getZoneById(99 as never)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // getSpawnZone
  // ---------------------------------------------------------------------------

  describe('getSpawnZone', () => {
    it('returns Zone 1 (Nebula Expanse)', () => {
      const zone = service.getSpawnZone();
      expect(zone).not.toBeNull();
      expect(zone.id).toBe(1);
    });

    it('spawn zone bounds contain the player start position (6000, 4500)', () => {
      const zone = service.getSpawnZone();
      const { bounds } = zone;
      expect(6000).toBeGreaterThanOrEqual(bounds.x);
      expect(6000).toBeLessThan(bounds.x + bounds.width);
      expect(4500).toBeGreaterThanOrEqual(bounds.y);
      expect(4500).toBeLessThan(bounds.y + bounds.height);
    });
  });

  // ---------------------------------------------------------------------------
  // A3: Zone 4 subtitle states the win condition
  // ---------------------------------------------------------------------------

  describe('Zone 4 subtitle', () => {
    it('Zone 4 subtitle contains the run-completion goal for the player', () => {
      const zone4 = service.getZoneById(4);
      expect(zone4).not.toBeNull();
      expect(zone4!.subtitle.toLowerCase()).toContain('boss');
      expect(zone4!.subtitle.toLowerCase()).toContain('complete');
    });

    it('Zone 4 subtitle is "Slay a boss here to complete the run"', () => {
      const zone4 = service.getZoneById(4);
      expect(zone4!.subtitle).toBe('Slay a boss here to complete the run');
    });
  });

  // ---------------------------------------------------------------------------
  // Zone coverage — all 4 zones cover the full world with no gaps or overlaps
  // ---------------------------------------------------------------------------

  describe('zone coverage', () => {
    it('returns 4 zones from getAllZones()', () => {
      expect(service.getAllZones().length).toBe(4);
    });

    it('all zones have non-overlapping, non-zero bounds', () => {
      const zones = service.getAllZones();
      let pairsTested = 0;
      for (let i = 0; i < zones.length; i++) {
        for (let j = i + 1; j < zones.length; j++) {
          const a = zones[i].bounds;
          const b = zones[j].bounds;
          // Two AABB overlap iff they DO NOT separate on either axis
          const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
          const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlapsX && overlapsY)
            .withContext(`Zone ${zones[i].id} and Zone ${zones[j].id} should not overlap`)
            .toBeFalse();
          pairsTested++;
        }
      }
      expect(pairsTested).toBe(6); // C(4,2)
    });

    it('combined bounds cover the full 12000 x 9000 world', () => {
      const zones: readonly ZoneDefinition[] = service.getAllZones();
      let totalArea = 0;
      for (const zone of zones) {
        totalArea += zone.bounds.width * zone.bounds.height;
      }
      expect(totalArea).toBe(12000 * 9000);
    });

    it('spot-checks every quadrant has a distinct zone id', () => {
      const ids = new Set([
        service.getZoneAtPosition(3500, 2750)?.id,
        service.getZoneAtPosition(9500, 2750)?.id,
        service.getZoneAtPosition(3500, 7000)?.id,
        service.getZoneAtPosition(9500, 7000)?.id,
      ]);
      expect(ids.size).toBe(4);
    });
  });
});
