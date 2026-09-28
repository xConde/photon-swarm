import { TestBed } from '@angular/core/testing';
import {
  FACTION_STANDING_CONFIG,
  FactionStanding,
  FactionStandingSystemService,
  TerritoryEffects,
} from './faction-standing-system.service';
import { FactionSnapshot } from '../../models/save-game.model';
import { FourKingsTerritoryService } from '../territory/four-kings-territory.service';
import { TerritoryTile } from '../../models/territory.model';

describe('FactionStandingSystemService', () => {
  let service: FactionStandingSystemService;
  let mockTerritory: jasmine.SpyObj<FourKingsTerritoryService>;

  /** Helper for stubbing a tile with just the faction-ownership field set. */
  function tileOwnedBy(kingId: number): TerritoryTile {
    return {
      x: 0,
      y: 0,
      kingId,
      strength: 100,
      age: 0,
      contested: false,
    };
  }

  beforeEach(() => {
    mockTerritory = jasmine.createSpyObj('FourKingsTerritoryService', ['getTileAtWorld']);
    mockTerritory.getTileAtWorld.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [FactionStandingSystemService, { provide: FourKingsTerritoryService, useValue: mockTerritory }],
    });
    service = TestBed.inject(FactionStandingSystemService);
  });

  describe('initialization', () => {
    it('seeds standings with the four canonical factions, all neutral at zero', (done) => {
      service.standings$.subscribe((standings) => {
        expect(standings.length).toBe(4);
        expect(standings.map((s) => s.factionId).sort()).toEqual([1, 2, 3, 4]);
        standings.forEach((s) => {
          expect(s.standing).withContext(s.name).toBe(0);
          expect(s.relationship).withContext(s.name).toBe('neutral');
        });
        done();
      });
    });

    it('derives names from FACTION_DEFINITIONS rather than hardcoding them', (done) => {
      service.standings$.subscribe((standings) => {
        const byId = new Map(standings.map((s) => [s.factionId, s.name]));
        // Matches kingName field in FACTION_DEFINITIONS — single source of truth.
        expect(byId.get(1)).toBe('Crimson King');
        expect(byId.get(2)).toBe('Azure King');
        expect(byId.get(3)).toBe('Verdant King');
        expect(byId.get(4)).toBe('Shadow King');
        done();
      });
    });

    it('exposes standings$ as an observable', () => {
      expect(service.standings$).toBeDefined();
      expect(typeof service.standings$.subscribe).toBe('function');
    });
  });

  describe('getTerritoryEffects', () => {
    it('returns identity multipliers when no tile is found (off the territory grid)', () => {
      mockTerritory.getTileAtWorld.and.returnValue(null);

      const effects: TerritoryEffects = service.getTerritoryEffects(100, 200);
      expect(effects.damageMultiplier).toBe(1);
      expect(effects.defenseMultiplier).toBe(1);
      expect(effects.speedMultiplier).toBe(1);
    });

    it('returns identity multipliers on neutral (factionId === 0) tiles', () => {
      mockTerritory.getTileAtWorld.and.returnValue(tileOwnedBy(0));

      const effects = service.getTerritoryEffects(100, 200);
      expect(effects.damageMultiplier).toBe(1);
      expect(effects.defenseMultiplier).toBe(1);
      expect(effects.speedMultiplier).toBe(1);
    });

    it('does not throw at origin or with negative coords', () => {
      expect(() => service.getTerritoryEffects(0, 0)).not.toThrow();
      expect(() => service.getTerritoryEffects(-500, -300)).not.toThrow();
    });

    it('boosts the player in allied territory (positive standing with the owner)', () => {
      service.processKill(0, 0, 1); // Drop standing with faction 1 first
      // Now manually push standing to max allied via deserialize
      service.deserialize([{ factionId: 1, standing: 100 }]);
      mockTerritory.getTileAtWorld.and.returnValue(tileOwnedBy(1));

      const effects = service.getTerritoryEffects(0, 0);
      expect(effects.damageMultiplier).toBeCloseTo(1 + FACTION_STANDING_CONFIG.TERRITORY_DAMAGE_RANGE, 3);
      expect(effects.defenseMultiplier).toBeCloseTo(1 + FACTION_STANDING_CONFIG.TERRITORY_DEFENSE_RANGE, 3);
      expect(effects.speedMultiplier).toBeCloseTo(1 + FACTION_STANDING_CONFIG.TERRITORY_SPEED_RANGE, 3);
    });

    it('penalizes the player in hostile territory (negative standing with the owner)', () => {
      service.deserialize([{ factionId: 2, standing: -100 }]);
      mockTerritory.getTileAtWorld.and.returnValue(tileOwnedBy(2));

      const effects = service.getTerritoryEffects(0, 0);
      expect(effects.damageMultiplier).toBeCloseTo(1 - FACTION_STANDING_CONFIG.TERRITORY_DAMAGE_RANGE, 3);
      expect(effects.defenseMultiplier).toBeCloseTo(1 - FACTION_STANDING_CONFIG.TERRITORY_DEFENSE_RANGE, 3);
      expect(effects.speedMultiplier).toBeCloseTo(1 - FACTION_STANDING_CONFIG.TERRITORY_SPEED_RANGE, 3);
    });

    it('interpolates linearly between the floor and the ceiling', () => {
      service.deserialize([{ factionId: 3, standing: 50 }]); // half-allied
      mockTerritory.getTileAtWorld.and.returnValue(tileOwnedBy(3));

      const effects = service.getTerritoryEffects(0, 0);
      // 50/100 = 0.5 multiplier ratio
      expect(effects.damageMultiplier).toBeCloseTo(1 + 0.5 * FACTION_STANDING_CONFIG.TERRITORY_DAMAGE_RANGE, 3);
    });

    it('returns identity on owned tiles when standing happens to be exactly zero', () => {
      mockTerritory.getTileAtWorld.and.returnValue(tileOwnedBy(4));

      const effects = service.getTerritoryEffects(0, 0);
      expect(effects.damageMultiplier).toBe(1);
      expect(effects.defenseMultiplier).toBe(1);
      expect(effects.speedMultiplier).toBe(1);
    });
  });

  describe('processKill', () => {
    it('drops standing with the killed enemy faction by KILL_STANDING_DELTA', () => {
      service.processKill(0, 0, 1);
      expect(service.getStanding(1)).toBe(FACTION_STANDING_CONFIG.KILL_STANDING_DELTA);
    });

    it('accumulates standing loss across multiple kills', () => {
      service.processKill(0, 0, 2);
      service.processKill(0, 0, 2);
      service.processKill(0, 0, 2);
      expect(service.getStanding(2)).toBe(FACTION_STANDING_CONFIG.KILL_STANDING_DELTA * 3);
    });

    it('clamps standing at the floor — extra kills past the floor are no-op', () => {
      // Push factor 3 deep into hostile territory
      const killsToFloor = Math.ceil(
        Math.abs(FACTION_STANDING_CONFIG.STANDING_FLOOR) / Math.abs(FACTION_STANDING_CONFIG.KILL_STANDING_DELTA)
      );
      for (let i = 0; i < killsToFloor + 10; i++) {
        service.processKill(0, 0, 3);
      }
      expect(service.getStanding(3)).toBe(FACTION_STANDING_CONFIG.STANDING_FLOOR);
    });

    it('flips the relationship to hostile once standing crosses the threshold', () => {
      const killsToHostile = Math.ceil(
        Math.abs(FACTION_STANDING_CONFIG.HOSTILE_THRESHOLD) / Math.abs(FACTION_STANDING_CONFIG.KILL_STANDING_DELTA)
      );
      for (let i = 0; i < killsToHostile; i++) {
        service.processKill(0, 0, 1);
      }
      const crimson = service.serialize().find((s) => s.factionId === 1);
      expect(crimson?.standing).toBeLessThanOrEqual(FACTION_STANDING_CONFIG.HOSTILE_THRESHOLD);
      // Now read relationship via the observable
      let relationship: FactionStanding['relationship'] | undefined;
      service.standings$.subscribe((s) => {
        relationship = s.find((f) => f.factionId === 1)?.relationship;
      });
      expect(relationship).toBe('hostile');
    });

    it('does not shift the standing of other factions', () => {
      service.processKill(0, 0, 1);
      expect(service.getStanding(2)).toBe(0);
      expect(service.getStanding(3)).toBe(0);
      expect(service.getStanding(4)).toBe(0);
    });

    it('ignores neutral/non-faction kills (factionId <= 0)', () => {
      service.processKill(0, 0, 0);
      service.processKill(0, 0, -1);
      const totalShift = service
        .serialize()
        .map((s) => s.standing)
        .reduce((acc, n) => acc + Math.abs(n), 0);
      expect(totalShift).toBe(0);
    });

    it('ignores kills tied to faction ids outside the canonical roster', () => {
      service.processKill(0, 0, 99);
      const totalShift = service
        .serialize()
        .map((s) => s.standing)
        .reduce((acc, n) => acc + Math.abs(n), 0);
      expect(totalShift).toBe(0);
    });

    it('emits a new standings array (does not mutate in place)', () => {
      const emitted: FactionStanding[][] = [];
      service.standings$.subscribe((s) => emitted.push(s));

      service.processKill(0, 0, 1);

      // BehaviorSubject: initial emission + post-kill emission
      expect(emitted.length).toBe(2);
      expect(emitted[0]).not.toBe(emitted[1]);
    });
  });

  describe('getStanding', () => {
    it('returns 0 for unknown faction ids', () => {
      expect(service.getStanding(99)).toBe(0);
    });

    it('returns 0 for every known faction at init', () => {
      [1, 2, 3, 4].forEach((id) => expect(service.getStanding(id)).withContext(`faction ${id}`).toBe(0));
    });
  });

  describe('reset', () => {
    it('restores standings to the default 4-faction-at-zero roster', () => {
      service.processKill(0, 0, 1);
      service.processKill(0, 0, 2);
      service.reset();

      const standings = service.serialize();
      expect(standings.length).toBe(4);
      standings.forEach((s) => expect(s.standing).withContext(`faction ${s.factionId}`).toBe(0));
    });

    it('emits the reset state via the observable', (done) => {
      service.processKill(0, 0, 1);
      service.reset();
      service.standings$.subscribe((standings) => {
        expect(standings.every((s) => s.standing === 0)).toBeTrue();
        done();
      });
    });
  });

  describe('serialize / deserialize round-trip', () => {
    it('serializes all four factions even when no kills have happened', () => {
      const snapshots = service.serialize();
      expect(snapshots.length).toBe(4);
    });

    it('round-trips a partial standing set without losing the rest of the roster', () => {
      const original: FactionSnapshot[] = [
        { factionId: 1, standing: 80 },
        { factionId: 3, standing: -10 },
      ];
      service.deserialize(original);

      const round = service.serialize();
      const byId = new Map(round.map((s) => [s.factionId, s.standing]));
      expect(byId.get(1)).toBe(80);
      expect(byId.get(2)).toBe(0); // not in snapshot, default preserved
      expect(byId.get(3)).toBe(-10);
      expect(byId.get(4)).toBe(0);
    });

    it('drops unknown faction ids from older saves rather than polluting the roster', () => {
      service.deserialize([{ factionId: 99, standing: 50 }]);
      const round = service.serialize();
      expect(round.find((s) => s.factionId === 99)).toBeUndefined();
      expect(round.length).toBe(4);
    });

    it('clamps deserialized standings to the configured floor/ceiling', () => {
      service.deserialize([
        { factionId: 1, standing: 9999 },
        { factionId: 2, standing: -9999 },
      ]);
      expect(service.getStanding(1)).toBe(FACTION_STANDING_CONFIG.STANDING_CEILING);
      expect(service.getStanding(2)).toBe(FACTION_STANDING_CONFIG.STANDING_FLOOR);
    });

    it('ignores malformed snapshots instead of introducing non-finite standings', () => {
      const malformed: FactionSnapshot[] = [
        { factionId: 1, standing: Number.NaN },
        { factionId: 2, standing: Number.POSITIVE_INFINITY },
        { factionId: 3.5, standing: 20 },
      ];

      service.deserialize(malformed);

      expect(service.serialize().every((snapshot) => Number.isFinite(snapshot.standing))).toBeTrue();
      expect(service.serialize().every((snapshot) => snapshot.standing === 0)).toBeTrue();
    });

    it('treats null/undefined as no-op (preserves current state)', () => {
      service.processKill(0, 0, 1); // give it some non-default state
      const before = service.serialize();

      service.deserialize(null);
      service.deserialize(undefined);

      expect(service.serialize()).toEqual(before);
    });

    it('treats an empty array as a clean roster reset (matches "fresh save" semantics)', () => {
      service.processKill(0, 0, 1);
      service.deserialize([]);

      const after = service.serialize();
      expect(after.length).toBe(4);
      after.forEach((s) => expect(s.standing).toBe(0));
    });

    it('maps standing >= 50 to allied after deserialize', () => {
      service.deserialize([{ factionId: 1, standing: 75 }]);
      expect(service.serialize().find((s) => s.factionId === 1)?.standing).toBe(75);
      let relationship: FactionStanding['relationship'] | undefined;
      service.standings$.subscribe((s) => {
        relationship = s.find((f) => f.factionId === 1)?.relationship;
      });
      expect(relationship).toBe('allied');
    });

    it('maps standing <= -50 to hostile after deserialize', () => {
      service.deserialize([{ factionId: 2, standing: -60 }]);
      let relationship: FactionStanding['relationship'] | undefined;
      service.standings$.subscribe((s) => {
        relationship = s.find((f) => f.factionId === 2)?.relationship;
      });
      expect(relationship).toBe('hostile');
    });

    it('maps standing in (-50, 50) to neutral after deserialize', () => {
      service.deserialize([{ factionId: 3, standing: 10 }]);
      let relationship: FactionStanding['relationship'] | undefined;
      service.standings$.subscribe((s) => {
        relationship = s.find((f) => f.factionId === 3)?.relationship;
      });
      expect(relationship).toBe('neutral');
    });
  });
});
