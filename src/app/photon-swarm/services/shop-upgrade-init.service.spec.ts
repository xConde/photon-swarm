import { TestBed } from '@angular/core/testing';
import { GameEngineService } from '../core/engine/game-engine.service';
import { PlayerService } from '../core/player/player.service';
import { HangarLoadoutService, HangarLoadoutSnapshot } from './hangar-loadout.service';
import { ShopUpgradeInitService } from './shop-upgrade-init.service';

describe('ShopUpgradeInitService', () => {
  let service: ShopUpgradeInitService;
  let hangarSpy: jasmine.SpyObj<HangarLoadoutService>;
  let gameEngineSpy: jasmine.SpyObj<GameEngineService>;
  let playerSpy: jasmine.SpyObj<PlayerService>;

  function setHangar(active: unknown, unlocks: Record<string, number>): void {
    const activeModuleId = typeof active === 'string' ? active : null;
    hangarSpy.getSnapshot.and.returnValue({
      version: 1,
      unlocks: {},
      activeModuleId,
    } as HangarLoadoutSnapshot);
    hangarSpy.isUnlocked.and.callFake((id) => (unlocks[id] ?? 0) > 0);
  }

  beforeEach(() => {
    hangarSpy = jasmine.createSpyObj('HangarLoadoutService', ['getSnapshot', 'isUnlocked']);
    gameEngineSpy = jasmine.createSpyObj('GameEngineService', [
      'increaseMaxHealth',
      'unlockShardMagnetism',
      'enhanceShardMagnetism',
      'applyEmergencyBarrierLevel',
    ]);
    playerSpy = jasmine.createSpyObj('PlayerService', [
      'reduceDischargeTime',
      'increaseSpeed',
      'increaseDischargeRadius',
      'increaseBeamWidth',
      'setHealthRegeneration',
      'setCriticalHitChance',
      'setCriticalHitMultiplier',
      'setShardMultiplier',
    ]);

    TestBed.configureTestingModule({
      providers: [ShopUpgradeInitService, { provide: HangarLoadoutService, useValue: hangarSpy }],
    });
    service = TestBed.inject(ShopUpgradeInitService);
  });

  it('does not apply a module when none is mounted', () => {
    setHangar(null, { max_health: 3, speed_boost: 2 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(gameEngineSpy.increaseMaxHealth).not.toHaveBeenCalled();
    expect(playerSpy.increaseSpeed).not.toHaveBeenCalled();
  });

  it('applies only the mounted module instead of stacking every legacy unlock', () => {
    setHangar('speed_boost', { max_health: 3, speed_boost: 2, double_points: 1 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(playerSpy.increaseSpeed).toHaveBeenCalledOnceWith(0.12);
    expect(gameEngineSpy.increaseMaxHealth).not.toHaveBeenCalled();
    expect(playerSpy.setShardMultiplier).not.toHaveBeenCalled();
  });

  it('requires the mounted module to be unlocked', () => {
    setHangar('critical_hits', { critical_hits: 0 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(playerSpy.setCriticalHitChance).not.toHaveBeenCalled();
  });

  it('mounts the compound magnetism effect', () => {
    setHangar('magnetism_range', { magnetism_range: 1 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(gameEngineSpy.unlockShardMagnetism).toHaveBeenCalledTimes(1);
    expect(gameEngineSpy.enhanceShardMagnetism).toHaveBeenCalledOnceWith(60);
  });

  it('mounts the compound critical-hit effect', () => {
    setHangar('critical_hits', { critical_hits: 1 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(playerSpy.setCriticalHitChance).toHaveBeenCalledOnceWith(0.15);
    expect(playerSpy.setCriticalHitMultiplier).toHaveBeenCalledOnceWith(2);
  });

  it('is idempotent within one deployment', () => {
    setHangar('max_health', { max_health: 1 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);
    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(gameEngineSpy.increaseMaxHealth).toHaveBeenCalledOnceWith(20);
  });

  it('re-applies exactly once after a deployment reset', () => {
    setHangar('shield_generator', { shield_generator: 1 });

    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);
    service.resetSession();
    service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy);

    expect(gameEngineSpy.applyEmergencyBarrierLevel).toHaveBeenCalledTimes(2);
    expect(gameEngineSpy.applyEmergencyBarrierLevel).toHaveBeenCalledWith(1);
  });

  it('ignores unknown persisted module IDs', () => {
    setHangar('future_module', { future_module: 1 });

    expect(() => service.applyPersistedShopUpgrades(gameEngineSpy, playerSpy)).not.toThrow();
  });
});
