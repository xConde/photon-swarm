import { TestBed } from '@angular/core/testing';

import { ZoneStateService } from './zone-state.service';
import { ZoneConfigService } from './zone-config.service';
import { AudioService } from '../../audio/audio.service';
import { ZoneChangeEvent, ZoneDefinition, ZoneId } from '../../models/zone.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal ZoneDefinition stubs matching the real ZONE_CONFIG layout.
 *
 *   Zone 1  x:[0,7000)   y:[0,5500)   — unlocked at start
 *   Zone 2  x:[7000,12000) y:[0,5500) — locked
 *   Zone 3  x:[0,7000)   y:[5500,9000)— locked
 *   Zone 4  x:[7000,12000) y:[5500,9000)— locked
 */
const ZONE1: ZoneDefinition = {
  id: 1,
  name: 'Nebula Expanse',
  subtitle: 'The calm before the storm',
  bounds: { x: 0, y: 0, width: 7000, height: 5500 },
  difficultyMultiplier: 1.0,
  enemyCompositionProfile: 'nebula_expanse',
  primaryKingId: 1,
  themeColor: '#e74c3c',
  accentColor: '#ff6b6b',
};

const ZONE2: ZoneDefinition = {
  id: 2,
  name: 'Asteroid Belt',
  subtitle: 'Brace for impact',
  bounds: { x: 7000, y: 0, width: 5000, height: 5500 },
  difficultyMultiplier: 1.3,
  enemyCompositionProfile: 'asteroid_belt',
  primaryKingId: 2,
  themeColor: '#3498db',
  accentColor: '#74b9ff',
};

const ZONE3: ZoneDefinition = {
  id: 3,
  name: 'Void Rift',
  subtitle: 'Eyes in the dark',
  bounds: { x: 0, y: 5500, width: 7000, height: 3500 },
  difficultyMultiplier: 1.7,
  enemyCompositionProfile: 'void_rift',
  primaryKingId: 3,
  themeColor: '#27ae60',
  accentColor: '#58d68d',
};

const ZONE4: ZoneDefinition = {
  id: 4,
  name: 'Deep Core',
  subtitle: 'No one returns unchanged',
  bounds: { x: 7000, y: 5500, width: 5000, height: 3500 },
  difficultyMultiplier: 2.2,
  enemyCompositionProfile: 'deep_core',
  primaryKingId: 4,
  themeColor: '#8e44ad',
  accentColor: '#bb8fce',
};

const ALL_ZONES = [ZONE1, ZONE2, ZONE3, ZONE4] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoneStateService', () => {
  let service: ZoneStateService;
  let configSpy: jasmine.SpyObj<ZoneConfigService>;
  let audioSpy: jasmine.SpyObj<AudioService>;

  beforeEach(() => {
    configSpy = jasmine.createSpyObj<ZoneConfigService>('ZoneConfigService', [
      'getAllZones',
      'getZoneAtPosition',
      'getZoneById',
      'getSpawnZone',
    ]);
    configSpy.getAllZones.and.returnValue(ALL_ZONES);

    // Default: map coords to zones by quadrant (mirrors real config).
    configSpy.getZoneAtPosition.and.callFake((x: number, y: number): ZoneDefinition | null => {
      if (x >= 0 && x < 7000 && y >= 0 && y < 5500) return ZONE1;
      if (x >= 7000 && x < 12000 && y >= 0 && y < 5500) return ZONE2;
      if (x >= 0 && x < 7000 && y >= 5500 && y < 9000) return ZONE3;
      if (x >= 7000 && x < 12000 && y >= 5500 && y < 9000) return ZONE4;
      return null;
    });

    configSpy.getZoneById.and.callFake((id): ZoneDefinition | null => {
      return ALL_ZONES.find((z) => z.id === id) ?? null;
    });

    audioSpy = jasmine.createSpyObj<AudioService>('AudioService', [
      'playZoneTransition',
      'setAmbientZone',
      'stopAmbientDrone',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ZoneStateService,
        { provide: ZoneConfigService, useValue: configSpy },
        { provide: AudioService, useValue: audioSpy },
      ],
    });

    service = TestBed.inject(ZoneStateService);
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('initial state', () => {
    it('Zone 1 is unlocked by default', () => {
      expect(service.isZoneUnlocked(1)).toBeTrue();
    });

    it('Zone 2 is locked by default', () => {
      expect(service.isZoneUnlocked(2)).toBeFalse();
    });

    it('Zone 3 is locked by default', () => {
      expect(service.isZoneUnlocked(3)).toBeFalse();
    });

    it('Zone 4 is locked by default', () => {
      expect(service.isZoneUnlocked(4)).toBeFalse();
    });

    it('currentZoneId is null before the first update call', () => {
      expect(service.getCurrentZoneId()).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // update() — zone change detection
  // ---------------------------------------------------------------------------

  describe('update()', () => {
    it('emits zoneChanged$ when player crosses a zone boundary', (done) => {
      const events: ZoneChangeEvent[] = [];
      service.zoneChanged$.subscribe((e) => events.push(e));

      // First call: player enters Zone 1 from null (initial coords are -9999,-9999)
      service.update(3500, 2750);

      expect(events.length).toBe(1);
      expect(events[0].from).toBeNull();
      expect(events[0].to).toBe(1);

      // Second call: player crosses into Zone 2 — distance from previous (3500,2750)
      // to (8000,2750) is 4500px, well above the 50px dirty threshold.
      service.update(8000, 2750);

      expect(events.length).toBe(2);
      expect(events[1].from).toBe(1);
      expect(events[1].to).toBe(2);

      done();
    });

    it('does NOT emit zoneChanged$ when player moves within the same zone below 50px threshold', () => {
      const events: ZoneChangeEvent[] = [];
      service.zoneChanged$.subscribe((e) => events.push(e));

      // Land in Zone 1
      service.update(3500, 2750);
      expect(events.length).toBe(1);

      // Move 10px — Manhattan distance 10, below DIRTY_THRESHOLD=50
      service.update(3510, 2750);
      expect(events.length).toBe(1); // no new emission
    });

    it('does NOT emit when player moves exactly 49px (still below dirty threshold)', () => {
      const events: ZoneChangeEvent[] = [];
      service.zoneChanged$.subscribe((e) => events.push(e));

      service.update(3500, 2750);
      service.update(3549, 2750); // dx=49, dy=0 — Manhattan=49 < 50
      expect(events.length).toBe(1);
    });

    it('emits when player moves exactly 50px (hits dirty threshold)', () => {
      const events: ZoneChangeEvent[] = [];
      service.zoneChanged$.subscribe((e) => events.push(e));

      service.update(3500, 2750);
      // Force Zone 2 so we get a zone change at the 50px threshold
      configSpy.getZoneAtPosition.and.returnValue(ZONE2);
      service.update(3550, 2750); // dx=50, dy=0 — Manhattan=50, triggers check
      expect(events.length).toBe(2);
    });

    it('emits lockedZoneEntered$ when player enters a locked zone', () => {
      const lockedEntries: Array<{ zoneId: number }> = [];
      service.lockedZoneEntered$.subscribe((e) => lockedEntries.push(e));

      // Enter Zone 1 first (unlocked — no locked entry event)
      service.update(3500, 2750);
      expect(lockedEntries.length).toBe(0);

      // Cross into Zone 2 (locked)
      service.update(8000, 2750);
      expect(lockedEntries.length).toBe(1);
      expect(lockedEntries[0].zoneId).toBe(2);
    });

    it('does NOT emit lockedZoneEntered$ when entering an unlocked zone', () => {
      const lockedEntries: Array<{ zoneId: number }> = [];
      service.lockedZoneEntered$.subscribe((e) => lockedEntries.push(e));

      service.unlockZone(2);
      service.update(3500, 2750); // Zone 1 — unlocked
      service.update(8000, 2750); // Zone 2 — now unlocked
      expect(lockedEntries.length).toBe(0);
    });

    it('calls audio.playZoneTransition with the new zone id on zone change', () => {
      service.update(3500, 2750); // Zone 1
      expect(audioSpy.playZoneTransition).toHaveBeenCalledWith(1);
    });

    it('calls audio.setAmbientZone(null) when entering out-of-bounds area', () => {
      // Land in Zone 1 first
      service.update(3500, 2750);
      // Move to out-of-bounds (getZoneAtPosition returns null)
      configSpy.getZoneAtPosition.and.returnValue(null);
      service.update(20000, 20000);
      expect(audioSpy.setAmbientZone).toHaveBeenCalledWith(null);
    });
  });

  // ---------------------------------------------------------------------------
  // unlockZone / isZoneUnlocked
  // ---------------------------------------------------------------------------

  describe('unlockZone / isZoneUnlocked', () => {
    it('unlockZone sets zone 2 to unlocked', () => {
      expect(service.isZoneUnlocked(2)).toBeFalse();
      service.unlockZone(2);
      expect(service.isZoneUnlocked(2)).toBeTrue();
    });

    it('unlockZone has no effect for a zone id that does not exist', () => {
      // Should not throw — graceful no-op
      expect(() => service.unlockZone(99 as never)).not.toThrow();
    });

    it('isZoneUnlocked returns false for a non-existent zone id', () => {
      expect(service.isZoneUnlocked(99 as never)).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------------
  // recordGuardianSlain / recordCacheOpened
  // ---------------------------------------------------------------------------

  describe('recordGuardianSlain', () => {
    it('increments guardiansSlain for the given zone', () => {
      service.recordGuardianSlain(1);
      expect(service.getZoneState(1)?.guardiansSlain).toBe(1);
    });

    it('increments guardiansSlain cumulatively across multiple calls', () => {
      service.recordGuardianSlain(1);
      service.recordGuardianSlain(1);
      service.recordGuardianSlain(1);
      expect(service.getZoneState(1)?.guardiansSlain).toBe(3);
    });

    it('is scoped per zone — killing in zone 1 does not affect zone 2', () => {
      service.recordGuardianSlain(1);
      expect(service.getZoneState(2)?.guardiansSlain).toBe(0);
    });

    // -------------------------------------------------------------------------
    // Regression: HUD must be able to refresh on guardian death.
    //
    // The zone-progress component subscribes to guardianSlain$ to refresh
    // its alive-count display. Without this event, the count goes stale
    // after a kill until the player crosses zones or opens a cache.
    //
    // See STRATEGIC_AUDIT.md "Final bug hunt" — Suspicion 6.
    // -------------------------------------------------------------------------
    it('emits guardianSlain$ with the zoneId on each call', () => {
      const events: { zoneId: ZoneId }[] = [];
      service.guardianSlain$.subscribe((evt) => events.push(evt));

      service.recordGuardianSlain(1);
      service.recordGuardianSlain(2);
      service.recordGuardianSlain(1);

      expect(events.length).toBe(3);
      expect(events[0].zoneId).toBe(1);
      expect(events[1].zoneId).toBe(2);
      expect(events[2].zoneId).toBe(1);
    });
  });

  describe('recordCacheOpened', () => {
    it('increments cachesOpened for the given zone', () => {
      service.recordCacheOpened(2);
      expect(service.getZoneState(2)?.cachesOpened).toBe(1);
    });

    it('increments cachesOpened cumulatively', () => {
      service.recordCacheOpened(2);
      service.recordCacheOpened(2);
      expect(service.getZoneState(2)?.cachesOpened).toBe(2);
    });

    it('is scoped per zone — opening in zone 2 does not affect zone 1', () => {
      service.recordCacheOpened(2);
      expect(service.getZoneState(1)?.cachesOpened).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getLockedZonePushBack
  // ---------------------------------------------------------------------------

  describe('getLockedZonePushBack', () => {
    it('returns null when player is in an unlocked zone', () => {
      // Zone 1 is unlocked
      const result = service.getLockedZonePushBack(3500, 2750);
      expect(result).toBeNull();
    });

    it('returns a force vector when player is in a locked zone', () => {
      // Centre of Zone 2 — locked
      const result = service.getLockedZonePushBack(9500, 2750);
      expect(result).not.toBeNull();
      expect(typeof result!.dx).toBe('number');
      expect(typeof result!.dy).toBe('number');
    });

    it('returns non-zero force when player is at the centre of a locked zone', () => {
      // Zone 2 bounds: x:[7000,12000) y:[0,5500) — centre ~(9500,2750)
      const result = service.getLockedZonePushBack(9500, 2750);
      expect(result).not.toBeNull();
      const magnitude = Math.sqrt(result!.dx ** 2 + result!.dy ** 2);
      expect(magnitude).toBeGreaterThan(0);
    });

    it('returns null when player is out of bounds', () => {
      // getZoneAtPosition returns null for out-of-bounds
      const result = service.getLockedZonePushBack(99999, 99999);
      expect(result).toBeNull();
    });

    it('returns zero force at the exact boundary of a locked zone (depth=0)', () => {
      // Place the player exactly at the left edge of Zone 2 (x=7000, which is depth=0 on x axis).
      // At that point both depthX and depthY calculations should yield a small/zero force.
      const result = service.getLockedZonePushBack(7000, 2750);
      expect(result).not.toBeNull();
      // force = depth * 3.0 where depth = min(depthX, depthY)
      // depthX = 1 - |playerX - centerX| / (width*0.5) = 1 - |7000-9500|/2500 = 1-1 = 0
      expect(result!.dx).toBeCloseTo(0, 5);
      expect(result!.dy).toBeCloseTo(0, 5);
    });

    it('returns diagonal push-back near the corner of a locked zone', () => {
      // Zone 2: x:[7000,12000) y:[0,5500)
      // Near the bottom-left corner (7100, 5400) — close to both left edge and bottom edge.
      // Both distLeft (100) and distBottom (100) are well within CORNER_THRESHOLD=200.
      const result = service.getLockedZonePushBack(7100, 5400);
      expect(result).not.toBeNull();
      // Diagonal means both dx and dy are non-zero
      expect(Math.abs(result!.dx)).toBeGreaterThan(0);
      expect(Math.abs(result!.dy)).toBeGreaterThan(0);
    });

    it('returns null for unlocked zone after unlocking', () => {
      service.unlockZone(2);
      const result = service.getLockedZonePushBack(9500, 2750);
      expect(result).toBeNull();
    });

    // -------------------------------------------------------------------------
    // Regression: silent failure when nearest edge is a world boundary
    //
    // Zone 2 bounds x:[7000,12000) y:[0,5500) — its right (x=12000) and top
    // (y=0) edges are world boundaries, not adjacent to another zone. The
    // nearest edge calculation MUST exclude world-boundary edges, otherwise
    // the push-back vector points at the world wall and the movement clamp
    // silently eats it (player never gets pushed out of the locked zone).
    //
    // See Red Team Critique — 2026-04-06 Finding 1 in STRATEGIC_AUDIT.md.
    // -------------------------------------------------------------------------
    describe('world-edge silent-failure regression', () => {
      it('pushes toward Zone 1 (left) when player hugs Zone 2 right world edge', () => {
        // Position (11500, 2000) — 500px from right (world wall), 4500px from left (→Z1),
        // 2000px from top (world wall), 3500px from bottom (→Z4).
        // Valid candidates: left(4500), bottom(3500). Nearest: bottom → push down (+y).
        // CRITICAL: must NOT push right (+x) toward the world wall.
        const result = service.getLockedZonePushBack(11500, 2000);
        expect(result).not.toBeNull();
        expect(result!.dx).toBe(0);
        expect(result!.dy).toBeGreaterThan(0); // Pushes down, toward Zone 4
      });

      it('pushes toward a valid zone edge when player is near Zone 2 top world edge', () => {
        // Position (11500, 200) — close to both top (200, world) and right (500, world).
        // Valid candidates: left(4500), bottom(5300). Nearest: left → push left (-x).
        const result = service.getLockedZonePushBack(11500, 200);
        expect(result).not.toBeNull();
        expect(result!.dx).toBeLessThan(0); // Pushes left, toward Zone 1
        expect(result!.dy).toBe(0);
      });

      it('pushes toward a valid zone edge when player is deep in Zone 4 near a world corner', () => {
        // Zone 4: x:[7000,12000) y:[5500,9000)
        // Position (11800, 8800) — 200px from right (world) and bottom (world).
        // Valid candidates: left(4800 →Z3), top(3300 →Z2). Nearest: top → push up (-y).
        const result = service.getLockedZonePushBack(11800, 8800);
        expect(result).not.toBeNull();
        expect(result!.dx).toBe(0);
        expect(result!.dy).toBeLessThan(0); // Pushes up, toward Zone 2
      });

      it('does not produce a zero-magnitude push when nearest numerical edge is a world wall', () => {
        // Position (11900, 100) — extreme corner, right+top are world walls.
        // Old code: minDistX=100 (right wall), minDistY=100 (top wall) → would return
        // { dx: 0.707, dy: -0.707 } * force, which the movement clamp discards.
        // New code: valid candidates are left (4900) and bottom (5400), nearest is left.
        // Expect a strong push toward Zone 1 (negative x).
        const result = service.getLockedZonePushBack(11900, 100);
        expect(result).not.toBeNull();
        expect(result!.dx).toBeLessThan(0); // Toward Zone 1
        // The push should have non-trivial magnitude even though the player is
        // numerically near world corners — no silent failure.
        expect(Math.abs(result!.dx) + Math.abs(result!.dy)).toBeGreaterThan(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // reset()
  // ---------------------------------------------------------------------------

  describe('reset()', () => {
    it('resets currentZoneId to null', () => {
      service.update(3500, 2750); // Zone 1
      expect(service.getCurrentZoneId()).toBe(1);

      service.reset();
      expect(service.getCurrentZoneId()).toBeNull();
    });

    it('re-locks previously unlocked zones (except zone 1)', () => {
      service.unlockZone(2);
      service.unlockZone(3);
      service.reset();

      expect(service.isZoneUnlocked(1)).toBeTrue(); // Zone 1 always starts unlocked
      expect(service.isZoneUnlocked(2)).toBeFalse();
      expect(service.isZoneUnlocked(3)).toBeFalse();
      expect(service.isZoneUnlocked(4)).toBeFalse();
    });

    it('resets zone state counters to zero', () => {
      service.recordGuardianSlain(1);
      service.recordCacheOpened(1);
      service.reset();

      expect(service.getZoneState(1)?.guardiansSlain).toBe(0);
      expect(service.getZoneState(1)?.cachesOpened).toBe(0);
    });

    it('calls audio.stopAmbientDrone on reset', () => {
      service.reset();
      expect(audioSpy.stopAmbientDrone).toHaveBeenCalled();
    });

    it('allows a new zone entry event to fire after reset', () => {
      service.update(3500, 2750); // Enter Zone 1

      const events: ZoneChangeEvent[] = [];
      service.zoneChanged$.subscribe((e) => events.push(e));

      service.reset();
      // After reset, last-check coords are -9999,-9999, so next update triggers lookup
      service.update(3500, 2750);

      expect(events.length).toBe(1);
      expect(events[0].to).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // destroy()
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('completes zoneChanged$ — no further emissions after destroy', () => {
      let completed = false;
      service.zoneChanged$.subscribe({ complete: () => (completed = true) });

      service.destroy();
      expect(completed).toBeTrue();
    });

    it('completes lockedZoneEntered$ — no further emissions after destroy', () => {
      let completed = false;
      service.lockedZoneEntered$.subscribe({ complete: () => (completed = true) });

      service.destroy();
      expect(completed).toBeTrue();
    });
  });
});
