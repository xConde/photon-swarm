import { TestBed } from '@angular/core/testing';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { FactionStandingSystemService } from '../core/systems/gameplay/faction-standing-system.service';
import { ZoneStateService } from '../core/systems/world/zone-state.service';
import { RunRouteService } from './run-route.service';

describe('RunRouteService', () => {
  let service: RunRouteService;
  let zoneState: jasmine.SpyObj<ZoneStateService>;
  let factionStanding: jasmine.SpyObj<FactionStandingSystemService>;

  beforeEach(() => {
    zoneState = jasmine.createSpyObj<ZoneStateService>('ZoneStateService', ['lockZone', 'unlockZone']);
    factionStanding = jasmine.createSpyObj<FactionStandingSystemService>('FactionStandingSystemService', [
      'adjustStanding',
    ]);

    TestBed.configureTestingModule({
      providers: [
        RunRouteService,
        { provide: ZoneStateService, useValue: zoneState },
        { provide: FactionStandingSystemService, useValue: factionStanding },
        { provide: DebugLogBridgeService, useValue: jasmine.createSpyObj('DebugLogBridgeService', ['log']) },
      ],
    });
    service = TestBed.inject(RunRouteService);
  });

  it('commits one branch, closes the other, and grants its alliance once', () => {
    service.chooseRoute(2, 1, true);

    expect(service.getSelectedZoneId()).toBe(2);
    expect(zoneState.unlockZone).toHaveBeenCalledWith(2);
    expect(zoneState.lockZone).toHaveBeenCalledWith(3);
    expect(factionStanding.adjustStanding).toHaveBeenCalledWith(1, 60);
    expect(service.canUseGate(1, 2)).toBeTrue();
    expect(service.canUseGate(1, 3)).toBeFalse();
    expect(service.canUseGate(2, 4)).toBeTrue();
    expect(service.canUseGate(3, 4)).toBeFalse();
  });

  it('rejects changing branches after commitment', () => {
    service.chooseRoute(3, 2, true);

    expect(() => service.chooseRoute(2, 1, true)).toThrowError(/already committed/);
  });

  it('treats a repeated commitment as an idempotent retry', () => {
    service.chooseRoute(2, 1, true);
    zoneState.unlockZone.calls.reset();
    zoneState.lockZone.calls.reset();

    service.chooseRoute(2, 1, true);

    expect(factionStanding.adjustStanding).toHaveBeenCalledOnceWith(1, 60);
    expect(zoneState.unlockZone).not.toHaveBeenCalled();
    expect(zoneState.lockZone).not.toHaveBeenCalled();
  });

  it('restores route locks without replaying the alliance grant', () => {
    service.restoreUpgradeTransaction({ selectedZoneId: 3 });

    expect(service.getSelectedZoneId()).toBe(3);
    expect(zoneState.lockZone).toHaveBeenCalledWith(2);
    expect(zoneState.unlockZone).toHaveBeenCalledWith(3);
    expect(factionStanding.adjustStanding).not.toHaveBeenCalled();
  });

  it('locks both branch sectors again when the run resets', () => {
    service.chooseRoute(2, 1, false);
    zoneState.lockZone.calls.reset();

    service.reset();

    expect(service.getSelectedZoneId()).toBeNull();
    expect(zoneState.lockZone).toHaveBeenCalledWith(2);
    expect(zoneState.lockZone).toHaveBeenCalledWith(3);
  });
});
