import { TerritorialGuardianComponent } from './territorial-guardian.component';
import { ZoneGateComponent } from './zone-gate.component';
import { ZoneTreasureCacheComponent } from './zone-treasure-cache.component';

/**
 * Bundled spec for the three ECS components that managed the zone/world layer
 * but had no test coverage at all before Phase 9 of the depth campaign.
 * Pins the constructor contract (`...args: unknown[]` required by the ECS factory) and
 * the default-args behavior so the existing entity-factory call sites that
 * pass partial args still get sensible defaults.
 */
describe('TerritorialGuardianComponent', () => {
  it('defaults home position to origin, radii to 800/400, and rank to tier 1', () => {
    const c = new TerritorialGuardianComponent();
    expect(c.homeX).toBe(0);
    expect(c.homeY).toBe(0);
    expect(c.leashRadius).toBe(800);
    expect(c.aggroRadius).toBe(400);
    expect(c.rankTier).toBe(1);
  });

  it('flags isLeashed/isAggroed false at spawn and sets aggro target to -1 sentinel', () => {
    const c = new TerritorialGuardianComponent();
    expect(c.isLeashed).toBeFalse();
    expect(c.isAggroed).toBeFalse();
    expect(c.aggroTargetEntityId).toBe(-1);
    expect(c.lastAggroTime).toBe(0);
  });

  it('uses performance.now() for spawnTime so renderers can compare without conversion', () => {
    const before = window.performance.now();
    const c = new TerritorialGuardianComponent();
    const after = window.performance.now();
    expect(c.spawnTime).toBeGreaterThanOrEqual(before);
    expect(c.spawnTime).toBeLessThanOrEqual(after);
  });

  it('accepts explicit args[0]-[7] for home, radii, treasure id, zone, rank, and spawnTime', () => {
    const c = new TerritorialGuardianComponent(100, 200, 500, 250, 7, 3, 2, 1234.5);
    expect(c.homeX).toBe(100);
    expect(c.homeY).toBe(200);
    expect(c.leashRadius).toBe(500);
    expect(c.aggroRadius).toBe(250);
    expect(c.guardedTreasureCacheId).toBe(7);
    expect(c.zoneId).toBe(3);
    expect(c.rankTier).toBe(2);
    expect(c.spawnTime).toBe(1234.5);
  });
});

describe('ZoneGateComponent', () => {
  it('defaults a gate from zone 1 to zone 2 at origin with radius 150 locked', () => {
    const c = new ZoneGateComponent();
    expect(c.gateId).toBe(0);
    expect(c.fromZoneId).toBe(1);
    expect(c.toZoneId).toBe(2);
    expect(c.worldX).toBe(0);
    expect(c.worldY).toBe(0);
    expect(c.radius).toBe(150);
    expect(c.isUnlocked).toBeFalse();
  });

  it("defaults unlockCondition to 'wave' with unlockValue 1", () => {
    const c = new ZoneGateComponent();
    expect(c.unlockCondition).toBe('wave');
    expect(c.unlockValue).toBe(1);
    expect(c.lastTriggerTime).toBe(0);
  });

  it('accepts explicit args[0]-[8] for id, zones, position, radius, unlock state and condition', () => {
    const c = new ZoneGateComponent(2, 3, 4, 100, 200, 250, true, 'guardian_kill', 5);
    expect(c.gateId).toBe(2);
    expect(c.fromZoneId).toBe(3);
    expect(c.toZoneId).toBe(4);
    expect(c.worldX).toBe(100);
    expect(c.worldY).toBe(200);
    expect(c.radius).toBe(250);
    expect(c.isUnlocked).toBeTrue();
    expect(c.unlockCondition).toBe('guardian_kill');
    expect(c.unlockValue).toBe(5);
  });

  it('supports each of the three documented unlock conditions', () => {
    (['wave', 'guardian_kill', 'treasure_clear'] as const).forEach((condition) => {
      const c = new ZoneGateComponent(0, 1, 2, 0, 0, 150, false, condition);
      expect(c.unlockCondition).withContext(condition).toBe(condition);
    });
  });
});

describe('ZoneTreasureCacheComponent', () => {
  it('defaults to closed, zone 1, default loot table, no guardian assigned', () => {
    const c = new ZoneTreasureCacheComponent();
    expect(c.cacheId).toBe(0);
    expect(c.zoneId).toBe(1);
    expect(c.isOpen).toBeFalse();
    expect(c.lootTableKey).toBe('default');
    expect(c.guardianEntityId).toBeNull();
    expect(c.discoveryTime).toBe(0);
    expect(c.openTime).toBe(0);
  });

  it('accepts explicit args[0]-[3] for cache id, zone, loot key, and guardian entity', () => {
    const c = new ZoneTreasureCacheComponent(42, 3, 'epic_loot', 99);
    expect(c.cacheId).toBe(42);
    expect(c.zoneId).toBe(3);
    expect(c.lootTableKey).toBe('epic_loot');
    expect(c.guardianEntityId).toBe(99);
  });

  it('allows guardian id of null when the cache is unguarded', () => {
    const c = new ZoneTreasureCacheComponent(1, 1, 'default', null);
    expect(c.guardianEntityId).toBeNull();
  });
});
