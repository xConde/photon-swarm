import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { GateProximityEvent, ZoneGateSystemService } from './zone-gate-system.service';
import { ZoneStateService } from './zone-state.service';
import { PlayerService } from '../../player/player.service';
import { SpawnSystemService } from '../enemy-ai/spawn-system.service';
import { AudioService } from '../../audio/audio.service';
import { ZoneGateComponent } from '@photon/components';
import { ZoneGateDefinition, ZoneId, ZoneState } from '../../models/zone.model';
import { EntityManager } from '../../ecs/ecs.model';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ZONE_GATE_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { RunRouteService } from '../../../services/run-route.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a ZoneGateComponent using a plain object cast — avoids the awkward
 * ...args: unknown[] constructor while keeping structural compatibility.
 *
 * Constructor arg order (from zone-gate.component.ts):
 *   args[0] = gateId, args[1] = fromZoneId, args[2] = toZoneId,
 *   args[3] = worldX,  args[4] = worldY,    args[5] = radius,
 *   args[6] = isUnlocked, args[7] = unlockCondition, args[8] = unlockValue
 */
function makeGate(overrides: Partial<ZoneGateComponent> = {}): ZoneGateComponent {
  return {
    gateId: 1,
    fromZoneId: 1,
    toZoneId: 2,
    worldX: 7000,
    worldY: 2750,
    radius: 150,
    isUnlocked: false,
    unlockCondition: 'wave',
    unlockValue: 8,
    lastTriggerTime: 0,
    ...overrides,
  };
}

function makeGateDef(overrides: Partial<ZoneGateDefinition> = {}): ZoneGateDefinition {
  return {
    gateId: 1,
    fromZoneId: 1,
    toZoneId: 2,
    x: 7000,
    y: 2750,
    unlockCondition: 'wave',
    unlockValue: 8,
    ...overrides,
  };
}

function makeZoneState(overrides: Partial<ZoneState> = {}): ZoneState {
  return {
    zoneId: 1,
    isUnlocked: true,
    isCompleted: false,
    guardiansSlain: 0,
    cachesOpened: 0,
    ...overrides,
  } as ZoneState;
}

/** A minimal EntityManager stub — only needs to exist for method signatures. */
const fakeEntityManager = {} as EntityManager;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoneGateSystemService', () => {
  let service: ZoneGateSystemService;
  let zoneStateSpy: jasmine.SpyObj<ZoneStateService>;
  let playerSpy: jasmine.SpyObj<PlayerService>;
  let spawnSpy: jasmine.SpyObj<SpawnSystemService>;
  let audioSpy: jasmine.SpyObj<AudioService>;
  let entityFactorySpy: jasmine.SpyObj<EntityFactoryECSService>;
  let runRouteSpy: jasmine.SpyObj<RunRouteService>;

  let currentWave: number;

  beforeEach(() => {
    currentWave = 0;

    zoneStateSpy = jasmine.createSpyObj<ZoneStateService>('ZoneStateService', [
      'getZoneState',
      'unlockZone',
      'isZoneUnlocked',
    ]);
    zoneStateSpy.getZoneState.and.returnValue(makeZoneState());

    playerSpy = jasmine.createSpyObj<PlayerService>('PlayerService', [], {
      x$: new BehaviorSubject<number>(6000),
      y$: new BehaviorSubject<number>(4500),
    });

    // SpawnSystemService has a waveNumber getter — use a plain object so we
    // avoid the "non-empty array required" restriction of createSpyObj with [].
    spawnSpy = Object.defineProperty({} as jasmine.SpyObj<SpawnSystemService>, 'waveNumber', {
      get: () => currentWave,
      configurable: true,
    });

    audioSpy = jasmine.createSpyObj<AudioService>('AudioService', ['playGateUnlock']);
    entityFactorySpy = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', ['createZoneGate']);
    runRouteSpy = jasmine.createSpyObj<RunRouteService>('RunRouteService', ['canUseGate']);
    runRouteSpy.canUseGate.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        ZoneGateSystemService,
        { provide: ZoneStateService, useValue: zoneStateSpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: SpawnSystemService, useValue: spawnSpy },
        { provide: AudioService, useValue: audioSpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: RunRouteService, useValue: runRouteSpy },
      ],
    });

    service = TestBed.inject(ZoneGateSystemService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('spawns every configured gate after an entity-store reset', () => {
    service.spawnAllGates();

    expect(entityFactorySpy.createZoneGate).toHaveBeenCalledTimes(ZONE_GATE_DEFINITIONS.length);
  });

  describe('route commitment', () => {
    function makeUpdateManager(gate: ZoneGateComponent): EntityManager {
      const position = { x: gate.worldX, y: gate.worldY };
      return {
        getEntitiesWithComponents: () => [1],
        getComponent: (_entity: number, componentType: unknown) =>
          componentType === ZoneGateComponent ? gate : position,
      } as unknown as EntityManager;
    }

    function runRouteTick(manager: EntityManager): void {
      for (let frame = 0; frame < 6; frame++) service.update(16, manager);
    }

    it('ignores a branch gate that the run did not choose', () => {
      const gate = makeGate({ fromZoneId: 1, toZoneId: 3, unlockValue: 99 });
      playerSpy.x$.next(gate.worldX);
      playerSpy.y$.next(gate.worldY);
      runRouteSpy.canUseGate.and.returnValue(false);

      runRouteTick(makeUpdateManager(gate));

      expect(gate.isUnlocked).toBeFalse();
      expect(zoneStateSpy.unlockZone).not.toHaveBeenCalled();
    });

    it('opens the chosen branch entrance on contact without the legacy wave condition', () => {
      const gate = makeGate({ fromZoneId: 1, toZoneId: 2, unlockCondition: 'wave', unlockValue: 99 });
      playerSpy.x$.next(gate.worldX);
      playerSpy.y$.next(gate.worldY);
      runRouteSpy.canUseGate.and.returnValue(true);

      runRouteTick(makeUpdateManager(gate));

      expect(gate.isUnlocked).toBeTrue();
      expect(zoneStateSpy.unlockZone).toHaveBeenCalledWith(2);
    });
  });

  // ---------------------------------------------------------------------------
  // evaluateCondition
  // ---------------------------------------------------------------------------

  describe('evaluateCondition', () => {
    it('wave condition returns true when waveNumber >= unlockValue', () => {
      currentWave = 10;
      const gate = makeGate({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeTrue();
    });

    it('wave condition returns true when waveNumber equals unlockValue exactly', () => {
      currentWave = 8;
      const gate = makeGate({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeTrue();
    });

    it('wave condition returns false when waveNumber < unlockValue', () => {
      currentWave = 7;
      const gate = makeGate({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeFalse();
    });

    it('treasure_clear condition returns true when cachesOpened >= unlockValue', () => {
      zoneStateSpy.getZoneState.and.returnValue(makeZoneState({ cachesOpened: 3 }));
      const gate = makeGate({ unlockCondition: 'treasure_clear', fromZoneId: 1, unlockValue: 2 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeTrue();
    });

    it('treasure_clear condition returns false when cachesOpened < unlockValue', () => {
      zoneStateSpy.getZoneState.and.returnValue(makeZoneState({ cachesOpened: 1 }));
      const gate = makeGate({ unlockCondition: 'treasure_clear', fromZoneId: 1, unlockValue: 2 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeFalse();
    });

    it('treasure_clear condition returns false when getZoneState returns undefined', () => {
      zoneStateSpy.getZoneState.and.returnValue(undefined);
      const gate = makeGate({ unlockCondition: 'treasure_clear', unlockValue: 1 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeFalse();
    });

    it('guardian_kill condition returns true when kill count >= unlockValue', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      const gate = makeGate({ unlockCondition: 'guardian_kill', fromZoneId: 1, unlockValue: 3 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeTrue();
    });

    it('guardian_kill condition returns false when kill count < unlockValue', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      const gate = makeGate({ unlockCondition: 'guardian_kill', fromZoneId: 1, unlockValue: 3 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeFalse();
    });

    it('guardian_kill reads from the FROM zone, not the TO zone', () => {
      // Kill 3 guardians in zone 2
      service.recordGuardianKill(2);
      service.recordGuardianKill(2);
      service.recordGuardianKill(2);
      // Gate goes 2→4, so fromZoneId=2
      const gate = makeGate({ unlockCondition: 'guardian_kill', fromZoneId: 2, toZoneId: 4, unlockValue: 3 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeTrue();
    });

    it('unknown condition returns false', () => {
      // Cast to bypass TypeScript — simulates a future or invalid condition value
      const gate = makeGate({ unlockCondition: 'unknown_condition' as never, unlockValue: 1 });
      expect(service.evaluateCondition(gate, fakeEntityManager)).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------------
  // getCurrentProgress
  // ---------------------------------------------------------------------------

  describe('getCurrentProgress', () => {
    it('wave condition returns current waveNumber', () => {
      currentWave = 5;
      const gate = makeGate({ unlockCondition: 'wave', unlockValue: 10 });
      expect(service.getCurrentProgress(gate)).toBe(5);
    });

    it('treasure_clear condition returns cachesOpened count', () => {
      zoneStateSpy.getZoneState.and.returnValue(makeZoneState({ cachesOpened: 4, zoneId: 1 as ZoneId }));
      const gate = makeGate({ unlockCondition: 'treasure_clear', fromZoneId: 1, unlockValue: 5 });
      expect(service.getCurrentProgress(gate)).toBe(4);
    });

    it('treasure_clear returns 0 when getZoneState returns undefined', () => {
      zoneStateSpy.getZoneState.and.returnValue(undefined);
      const gate = makeGate({ unlockCondition: 'treasure_clear', unlockValue: 3 });
      expect(service.getCurrentProgress(gate)).toBe(0);
    });

    it('guardian_kill condition returns kill count for fromZoneId', () => {
      service.recordGuardianKill(3);
      service.recordGuardianKill(3);
      const gate = makeGate({ unlockCondition: 'guardian_kill', fromZoneId: 3, unlockValue: 5 });
      expect(service.getCurrentProgress(gate)).toBe(2);
    });

    it('unknown condition returns 0', () => {
      const gate = makeGate({ unlockCondition: 'unknown_condition' as never, unlockValue: 1 });
      expect(service.getCurrentProgress(gate)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getGateProgressFraction
  // ---------------------------------------------------------------------------

  describe('getGateProgressFraction', () => {
    it('wave: returns 0 when waveNumber is 0', () => {
      currentWave = 0;
      const def = makeGateDef({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.getGateProgressFraction(def)).toBe(0);
    });

    it('wave: returns 0.5 at half the required waves', () => {
      currentWave = 4;
      const def = makeGateDef({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.getGateProgressFraction(def)).toBeCloseTo(0.5);
    });

    it('wave: returns 1.0 at exactly the required waves', () => {
      currentWave = 8;
      const def = makeGateDef({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.getGateProgressFraction(def)).toBe(1.0);
    });

    it('wave: clamps to 1.0 when waveNumber exceeds unlockValue', () => {
      currentWave = 15;
      const def = makeGateDef({ unlockCondition: 'wave', unlockValue: 8 });
      expect(service.getGateProgressFraction(def)).toBe(1.0);
    });

    it('treasure_clear: returns correct fraction based on cachesOpened', () => {
      zoneStateSpy.getZoneState.and.returnValue(makeZoneState({ cachesOpened: 2 }));
      const def = makeGateDef({ unlockCondition: 'treasure_clear', fromZoneId: 1 as ZoneId, unlockValue: 4 });
      expect(service.getGateProgressFraction(def)).toBeCloseTo(0.5);
    });

    it('treasure_clear: returns 1.0 when caches meets requirement', () => {
      zoneStateSpy.getZoneState.and.returnValue(makeZoneState({ cachesOpened: 4 }));
      const def = makeGateDef({ unlockCondition: 'treasure_clear', fromZoneId: 1 as ZoneId, unlockValue: 4 });
      expect(service.getGateProgressFraction(def)).toBe(1.0);
    });

    it('treasure_clear: clamps to 1.0 when cachesOpened exceeds unlockValue', () => {
      zoneStateSpy.getZoneState.and.returnValue(makeZoneState({ cachesOpened: 10 }));
      const def = makeGateDef({ unlockCondition: 'treasure_clear', fromZoneId: 1 as ZoneId, unlockValue: 4 });
      expect(service.getGateProgressFraction(def)).toBe(1.0);
    });

    it('treasure_clear: returns 0 when getZoneState returns undefined', () => {
      zoneStateSpy.getZoneState.and.returnValue(undefined);
      const def = makeGateDef({ unlockCondition: 'treasure_clear', fromZoneId: 1 as ZoneId, unlockValue: 4 });
      expect(service.getGateProgressFraction(def)).toBe(0);
    });

    it('guardian_kill: returns correct fraction based on kill count', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      const def = makeGateDef({ unlockCondition: 'guardian_kill', fromZoneId: 1 as ZoneId, unlockValue: 4 });
      expect(service.getGateProgressFraction(def)).toBeCloseTo(0.5);
    });

    it('guardian_kill: clamps to 1.0 when kill count exceeds unlockValue', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      const def = makeGateDef({ unlockCondition: 'guardian_kill', fromZoneId: 1 as ZoneId, unlockValue: 3 });
      expect(service.getGateProgressFraction(def)).toBe(1.0);
    });

    it('unknown condition returns 0', () => {
      const def = makeGateDef({ unlockCondition: 'unknown_condition' as never, unlockValue: 5 });
      expect(service.getGateProgressFraction(def)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // recordGuardianKill / getTotalGuardianKills
  // ---------------------------------------------------------------------------

  describe('recordGuardianKill', () => {
    it('first call sets count to 1', () => {
      service.recordGuardianKill(1);
      expect(service.guardianKillCounts.get(1)).toBe(1);
    });

    it('multiple calls cumulate', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      expect(service.guardianKillCounts.get(1)).toBe(3);
    });

    it('is scoped per zone — kills in zone 2 do not affect zone 3', () => {
      service.recordGuardianKill(2);
      service.recordGuardianKill(2);
      expect(service.guardianKillCounts.get(3) ?? 0).toBe(0);
    });

    it('getTotalGuardianKills returns sum across all zones', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(2);
      service.recordGuardianKill(3);
      service.recordGuardianKill(3);
      service.recordGuardianKill(3);
      expect(service.getTotalGuardianKills()).toBe(6);
    });

    it('getTotalGuardianKills returns 0 when no kills recorded', () => {
      expect(service.getTotalGuardianKills()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // unlockGate
  // ---------------------------------------------------------------------------

  describe('unlockGate', () => {
    it('sets gate.isUnlocked to true', () => {
      const gate = makeGate({ isUnlocked: false });
      service.unlockGate(gate);
      expect(gate.isUnlocked).toBeTrue();
    });

    it('sets gate.lastTriggerTime to approximately now', () => {
      const before = Date.now();
      const gate = makeGate({ lastTriggerTime: 0 });
      service.unlockGate(gate);
      const after = Date.now();
      expect(gate.lastTriggerTime).toBeGreaterThanOrEqual(before);
      expect(gate.lastTriggerTime).toBeLessThanOrEqual(after + 50);
    });

    it('calls zoneStateService.unlockZone with the gate toZoneId', () => {
      const gate = makeGate({ fromZoneId: 1, toZoneId: 2 });
      service.unlockGate(gate);
      expect(zoneStateSpy.unlockZone).toHaveBeenCalledWith(2 as ZoneId);
    });

    it('emits zoneUnlocked$ with the toZoneId', () => {
      const emitted: Array<{ zoneId: ZoneId }> = [];
      service.zoneUnlocked$.subscribe((e) => emitted.push(e));

      const gate = makeGate({ toZoneId: 3 });
      service.unlockGate(gate);

      expect(emitted.length).toBe(1);
      expect(emitted[0].zoneId).toBe(3 as ZoneId);
    });

    it('calls audio.playGateUnlock()', () => {
      const gate = makeGate();
      service.unlockGate(gate);
      expect(audioSpy.playGateUnlock).toHaveBeenCalled();
    });

    it('emits null on gateProximity$ to clear the tooltip', () => {
      const proximityEvents: Array<GateProximityEvent | null> = [];
      service.gateProximity$.subscribe((e) => proximityEvents.push(e));

      const gate = makeGate();
      service.unlockGate(gate);

      expect(proximityEvents).toContain(null);
    });
  });

  // ---------------------------------------------------------------------------
  // destroy()
  // ---------------------------------------------------------------------------

  describe('destroy()', () => {
    it('completes zoneUnlocked$ — subscriber receives complete callback', (done) => {
      service.zoneUnlocked$.subscribe({
        next: () => {},
        complete: () => {
          expect(true).toBeTrue();
          done();
        },
      });
      service.destroy();
    });

    it('completes gateProximity$ — subscriber receives complete callback', (done) => {
      service.gateProximity$.subscribe({
        next: () => {},
        complete: () => {
          expect(true).toBeTrue();
          done();
        },
      });
      service.destroy();
    });
  });

  // ---------------------------------------------------------------------------
  // reset()
  // ---------------------------------------------------------------------------

  describe('reset()', () => {
    it('clears guardianKillCounts', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(2);
      service.reset();
      expect(service.getTotalGuardianKills()).toBe(0);
    });

    it('getTotalGuardianKills returns 0 after reset', () => {
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.recordGuardianKill(1);
      service.reset();
      expect(service.getTotalGuardianKills()).toBe(0);
    });

    it('does not throw', () => {
      expect(() => service.reset()).not.toThrow();
    });

    it('allows kills to be recorded again after reset', () => {
      service.recordGuardianKill(1);
      service.reset();
      service.recordGuardianKill(1);
      expect(service.guardianKillCounts.get(1)).toBe(1);
    });
  });
});
