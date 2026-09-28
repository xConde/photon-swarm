import { TestBed } from '@angular/core/testing';
import type { UpgradeOption } from '../core/models/upgrade.model';
import { RunRewardQueueService } from './run-reward-queue.service';
import { UpgradeService } from './upgrade.service';

describe('RunRewardQueueService', () => {
  let service: RunRewardQueueService;
  let upgrades: jasmine.SpyObj<UpgradeService>;

  const card = (id: string): UpgradeOption => ({
    id,
    name: id,
    description: id,
    effect: () => undefined,
    type: 'upgrade',
    rarity: 'rare',
  });

  beforeEach(() => {
    upgrades = jasmine.createSpyObj('UpgradeService', [
      'getActiveBeamCoreId',
      'getOwnedAnomalyCount',
      'getRunRouteOptions',
      'drawAnomalies',
      'drawRelics',
    ]);
    upgrades.getActiveBeamCoreId.and.returnValue(null);
    upgrades.getOwnedAnomalyCount.and.returnValue(0);
    upgrades.getRunRouteOptions.and.returnValue([card('route')]);
    upgrades.drawAnomalies.and.returnValue([card('anomaly')]);
    upgrades.drawRelics.and.returnValue([card('relic')]);

    TestBed.configureTestingModule({
      providers: [RunRewardQueueService, { provide: UpgradeService, useValue: upgrades }],
    });
    service = TestBed.inject(RunRewardQueueService);
  });

  it('queues exactly one opening core choice while the beam is unbound', () => {
    expect(service.queueOpeningCoreChoice()).toBeTrue();
    expect(service.queueOpeningCoreChoice()).toBeFalse();
    expect(service.takeNextOffer()?.kind).toBe('upgrade');
  });

  it('does not queue an opening choice for a restored run with a beam core', () => {
    upgrades.getActiveBeamCoreId.and.returnValue('arc');

    expect(service.queueOpeningCoreChoice()).toBeFalse();
    expect(service.hasPendingReward()).toBeFalse();
  });

  it('orders a Zone 1 route before its relic', () => {
    service.queueZoneCompletion(1);

    expect(service.takeNextOffer()?.kind).toBe('route');
    service.completeActiveOffer();
    expect(service.takeNextOffer()?.kind).toBe('relic');
  });

  it('orders an anomaly before relic and level-up rewards', () => {
    service.queueLevelUp();
    service.queueZoneCompletion(2);
    service.queueZoneEntry(2);

    expect(service.takeNextOffer()?.kind).toBe('anomaly');
    service.completeActiveOffer();
    expect(service.takeNextOffer()?.kind).toBe('relic');
    service.completeActiveOffer();
    expect(service.takeNextOffer()?.kind).toBe('upgrade');
  });

  it('never grants a second relic for a duplicate zone-complete signal', () => {
    service.queueZoneCompletion(2);
    expect(service.takeNextOffer()?.kind).toBe('relic');
    service.completeActiveOffer();

    service.queueZoneCompletion(2);

    expect(service.hasPendingReward()).toBeFalse();
  });

  it('drains an exhausted pool and proceeds to the next reward', () => {
    upgrades.getRunRouteOptions.and.returnValue([]);
    service.queueZoneCompletion(1);

    expect(service.takeNextOffer()?.kind).toBe('relic');
  });

  it('reset clears pending and claimed state for the next run', () => {
    service.queueZoneCompletion(2);
    service.reset();

    expect(service.hasPendingReward()).toBeFalse();
    service.queueZoneCompletion(2);
    expect(service.takeNextOffer()?.kind).toBe('relic');
  });
});
