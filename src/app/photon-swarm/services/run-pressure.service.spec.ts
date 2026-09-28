import { TestBed } from '@angular/core/testing';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { RunPressureService } from './run-pressure.service';

describe('RunPressureService', () => {
  let service: RunPressureService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RunPressureService,
        { provide: DebugLogBridgeService, useValue: jasmine.createSpyObj('DebugLogBridgeService', ['log']) },
      ],
    });
    service = TestBed.inject(RunPressureService);
  });

  it('starts neutral and composes anomaly pressure multiplicatively', () => {
    service.apply({ enemyHealth: 1.5, waveSize: 0.8 }, 'first');
    service.apply({ enemyHealth: 1.2, enemyDamage: 1.25 }, 'second');

    expect(service.getModifiers().enemyHealth).toBeCloseTo(1.8);
    expect(service.getModifiers().enemyDamage).toBeCloseTo(1.25);
    expect(service.getModifiers().waveSize).toBeCloseTo(0.8);
    expect(service.getModifiers().spawnTempo).toBe(1);
  });

  it('rejects an invalid multi-field change before mutating any pressure', () => {
    expect(() => service.apply({ enemyHealth: 1.5, enemySpeed: 0 }, 'invalid')).toThrowError();
    expect(service.getModifiers().enemyHealth).toBe(1);
    expect(service.getModifiers().enemySpeed).toBe(1);
  });

  it('captures, restores, and resets the run-scoped state', () => {
    service.apply({ eliteFrequency: 1.5 }, 'iron');
    const snapshot = service.captureUpgradeTransaction();
    service.apply({ spawnTempo: 1.3 }, 'moon');

    service.restoreUpgradeTransaction(snapshot);
    expect(service.getModifiers().eliteFrequency).toBeCloseTo(1.5);
    expect(service.getModifiers().spawnTempo).toBe(1);

    service.reset();
    expect(service.getModifiers().eliteFrequency).toBe(1);
  });
});
