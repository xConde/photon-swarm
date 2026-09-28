import { TestBed } from '@angular/core/testing';
import { BuffSystemService } from './buff-system.service';

describe('BuffSystemService', () => {
  let service: BuffSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(BuffSystemService);
    // Mock engine with empty methods
    const mockEngine = {
      update: () => undefined,
      init: () => undefined,
    };
    service.attachEngine(mockEngine as never);
  });

  it('should apply and expire timed buffs', () => {
    // Start fake timer at 0ms
    spyOn(Date, 'now').and.returnValues(0, 60);

    service.applyBuff('test', 'beamDamage', 2, 50);
    expect(service.beamDamageMultiplier).toBe(2);

    // Second call to window.performance.now() inside update() returns 60ms
    service.update();
    expect(service.beamDamageMultiplier).toBe(1);
  });

  it('reset should clear all multipliers', () => {
    service.applyBuff('speed', 'movementSpeed', 1.5, Infinity);
    expect(service.movementSpeedMultiplier).toBe(1.5);
    service.reset();
    expect(service.movementSpeedMultiplier).toBe(1);
  });

  it('restores active buffs and multipliers after a failed upgrade transaction', () => {
    spyOn(Date, 'now').and.returnValue(100);
    service.applyBuff('existing', 'beamDamage', 2, Infinity);
    const snapshot = service.captureUpgradeTransaction();

    service.applyBuff('vulnerability_curse', 'damageTaken', 1.5, Infinity);
    service.removeBuffById('existing');
    service.restoreUpgradeTransaction(snapshot);

    expect(service.beamDamageMultiplier).toBe(2);
    expect(service.damageTakenMultiplier).toBe(1);
    expect(service.removeBuffById('existing')).toBeTrue();
  });

  describe('removeBuffById', () => {
    it('should remove a buff and revert its multiplier', () => {
      spyOn(Date, 'now').and.returnValue(0);

      service.applyBuff('damage-boost', 'beamDamage', 2.5, Infinity);
      expect(service.beamDamageMultiplier).toBe(2.5);

      const removed = service.removeBuffById('damage-boost');
      expect(removed).toBe(true);
      expect(service.beamDamageMultiplier).toBe(1);
    });

    it('should return false for nonexistent buff', () => {
      const removed = service.removeBuffById('nonexistent-buff-id');
      expect(removed).toBe(false);
    });

    it('should not affect other active buffs', () => {
      spyOn(Date, 'now').and.returnValue(0);

      service.applyBuff('damage-boost', 'beamDamage', 2, Infinity);
      service.applyBuff('speed-boost', 'movementSpeed', 1.5, Infinity);

      expect(service.beamDamageMultiplier).toBe(2);
      expect(service.movementSpeedMultiplier).toBe(1.5);

      service.removeBuffById('damage-boost');

      expect(service.beamDamageMultiplier).toBe(1);
      expect(service.movementSpeedMultiplier).toBe(1.5);
    });

    it('should handle Infinity duration buffs (permanent curses)', () => {
      spyOn(Date, 'now').and.returnValue(0);

      service.applyBuff('permanent-curse', 'damageTaken', 2, Infinity);
      expect(service.damageTakenMultiplier).toBe(2);

      const removed = service.removeBuffById('permanent-curse');
      expect(removed).toBe(true);
      expect(service.damageTakenMultiplier).toBe(1);
    });
  });

  describe('setBaseMultiplier', () => {
    it('should directly set a multiplier value', () => {
      service.setBaseMultiplier('beamDamage', 2.5);
      expect(service.beamDamageMultiplier).toBe(2.5);
    });

    it('should override existing buff stacking', () => {
      spyOn(Date, 'now').and.returnValue(0);

      service.applyBuff('boost-1', 'beamDamage', 2, Infinity);
      service.applyBuff('boost-2', 'beamDamage', 1.5, Infinity);
      expect(service.beamDamageMultiplier).toBe(3);

      service.setBaseMultiplier('beamDamage', 5);
      expect(service.beamDamageMultiplier).toBe(5);
    });
  });
});
