import { TestBed } from '@angular/core/testing';
import { AscensionService } from './ascension.service';
import { StorageService } from './storage.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';

describe('AscensionService', () => {
  let service: AscensionService;
  let storageSpy: jasmine.SpyObj<StorageService>;
  let debugSpy: jasmine.SpyObj<DebugLogBridgeService>;

  const MAX = PROGRESSION_CONFIG.ASCENSION_BONUSES.MAX_ASCENSION_LEVEL; // 3
  const BASE_REQ = PROGRESSION_CONFIG.ASCENSION_REQUIREMENTS.BASE_LEVEL_REQUIRED; // 10
  const LVL_PER = PROGRESSION_CONFIG.ASCENSION_REQUIREMENTS.LEVEL_PER_ASCENSION; // 2

  function createService(storedValue: unknown = null): AscensionService {
    storageSpy.get.and.returnValue(storedValue);
    return TestBed.inject(AscensionService);
  }

  beforeEach(() => {
    storageSpy = jasmine.createSpyObj('StorageService', ['get', 'set']);
    debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    storageSpy.get.and.returnValue(null);

    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storageSpy },
        { provide: DebugLogBridgeService, useValue: debugSpy },
      ],
    });
  });

  // ── Initial load from storage ──────────────────────────────────────

  describe('loadFromStorage', () => {
    it('should default to 0 when storage returns null', () => {
      service = createService(null);
      expect(service.getAscensionLevel()).toBe(0);
    });

    it('should load a valid stored number', () => {
      service = createService(2);
      expect(service.getAscensionLevel()).toBe(2);
    });

    it('should clamp stored value to MAX_ASCENSION_LEVEL', () => {
      service = createService(999);
      expect(service.getAscensionLevel()).toBe(MAX);
    });

    it('should clamp negative stored value to 0', () => {
      service = createService(-3);
      expect(service.getAscensionLevel()).toBe(0);
    });

    it('should floor fractional stored value', () => {
      service = createService(3.9);
      expect(service.getAscensionLevel()).toBe(3);
    });

    it('should default to 0 for non-number types (string)', () => {
      service = createService('hello');
      expect(service.getAscensionLevel()).toBe(0);
    });

    it('should default to 0 for non-number types (boolean)', () => {
      service = createService(true);
      expect(service.getAscensionLevel()).toBe(0);
    });

    it('should default to 0 for NaN', () => {
      service = createService(NaN);
      expect(service.getAscensionLevel()).toBe(0);
    });

    it('should default to 0 for Infinity', () => {
      service = createService(Infinity);
      expect(service.getAscensionLevel()).toBe(0);
    });
  });

  // ── canAscend ──────────────────────────────────────────────────────

  describe('canAscend', () => {
    it('should return false when current level is below required', () => {
      service = createService(0);
      expect(service.canAscend(BASE_REQ - 1)).toBeFalse();
    });

    it('should return true when current level equals required', () => {
      service = createService(0);
      expect(service.canAscend(BASE_REQ)).toBeTrue();
    });

    it('should return true when current level exceeds required', () => {
      service = createService(0);
      expect(service.canAscend(BASE_REQ + 5)).toBeTrue();
    });

    it('should account for higher ascension level requirement', () => {
      service = createService(2);
      const required = BASE_REQ + 2 * LVL_PER; // 14
      expect(service.canAscend(required - 1)).toBeFalse();
      expect(service.canAscend(required)).toBeTrue();
    });

    it('should return false at max ascension level regardless of current level', () => {
      service = createService(MAX);
      expect(service.canAscend(9999)).toBeFalse();
    });
  });

  // ── ascend ─────────────────────────────────────────────────────────

  describe('ascend', () => {
    it('should increment ascension level by 1', () => {
      service = createService(0);
      const result = service.ascend();
      expect(result).toBe(1);
      expect(service.getAscensionLevel()).toBe(1);
    });

    it('should persist the new level to storage', () => {
      service = createService(0);
      service.ascend();
      expect(storageSpy.set).toHaveBeenCalledWith('ascension-level', 1);
    });

    it('should not exceed MAX_ASCENSION_LEVEL', () => {
      service = createService(MAX);
      const result = service.ascend();
      expect(result).toBe(MAX);
      expect(service.getAscensionLevel()).toBe(MAX);
    });

    it('should log the ascension via debug bridge', () => {
      service = createService(2);
      service.ascend();
      expect(debugSpy.log).toHaveBeenCalledWith(
        'Ascension 2 -> 3',
        'success',
        jasmine.objectContaining({ previousLevel: 2, newLevel: 3 })
      );
    });

    it('should increment multiple times correctly', () => {
      service = createService(0);
      service.ascend();
      service.ascend();
      service.ascend();
      expect(service.getAscensionLevel()).toBe(3);
    });
  });

  // ── Mastery unlocks / legacy neutral multipliers ───────────────────

  describe('bonus getters', () => {
    it('should return 1.0 for all bonuses at level 0', () => {
      service = createService(0);
      expect(service.getDamageBonus()).toBe(1);
      expect(service.getHealthBonus()).toBe(1);
      expect(service.getShardBonus()).toBe(1);
      expect(service.getXpBonus()).toBe(1);
    });

    it('should keep damage neutral after mastery', () => {
      service = createService(3);
      expect(service.getDamageBonus()).toBe(1);
    });

    it('should keep health neutral after mastery', () => {
      service = createService(2);
      expect(service.getHealthBonus()).toBe(1);
    });

    it('should keep shards neutral after mastery', () => {
      service = createService(2);
      expect(service.getShardBonus()).toBe(1);
    });

    it('should keep XP neutral after mastery', () => {
      service = createService(3);
      expect(service.getXpBonus()).toBe(1);
    });

    it('should calculate max-level bonuses correctly', () => {
      service = createService(MAX);
      expect(service.getDamageBonus()).toBe(1);
      expect(service.getHealthBonus()).toBe(1);
      expect(service.getShardBonus()).toBe(1);
      expect(service.getXpBonus()).toBe(1);
    });
  });

  describe('mastery unlocks', () => {
    it('unlocks Heat 1 at mastery 1 and Heat 2 at mastery 3', () => {
      expect(createService(0).getMaxHeatLevel()).toBe(0);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: StorageService, useValue: storageSpy },
          { provide: DebugLogBridgeService, useValue: debugSpy },
        ],
      });
      expect(createService(1).getMaxHeatLevel()).toBe(1);
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: StorageService, useValue: storageSpy },
          { provide: DebugLogBridgeService, useValue: debugSpy },
        ],
      });
      expect(createService(3).getMaxHeatLevel()).toBe(2);
    });

    it('unlocks a second refit reroll at mastery 2', () => {
      service = createService(2);
      expect(service.getRerollCharges()).toBe(2);
      expect(service.getUnlockForLevel(2)).toContain('reroll');
    });
  });

  // ── getRequiredLevel ───────────────────────────────────────────────

  describe('getRequiredLevel', () => {
    it('should return BASE_LEVEL_REQUIRED at ascension 0', () => {
      service = createService(0);
      expect(service.getRequiredLevel()).toBe(BASE_REQ);
    });

    it('should scale with ascension level', () => {
      service = createService(2);
      expect(service.getRequiredLevel()).toBe(BASE_REQ + 2 * LVL_PER);
    });

    it('should return correct value at max ascension', () => {
      service = createService(MAX);
      expect(service.getRequiredLevel()).toBe(BASE_REQ + MAX * LVL_PER);
    });
  });

  // ── reset ──────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset ascension level to 0', () => {
      service = createService(10);
      service.reset();
      expect(service.getAscensionLevel()).toBe(0);
    });

    it('should persist 0 to storage', () => {
      service = createService(5);
      storageSpy.set.calls.reset();
      service.reset();
      expect(storageSpy.set).toHaveBeenCalledWith('ascension-level', 0);
    });

    it('should return correct bonuses after reset', () => {
      service = createService(10);
      service.reset();
      expect(service.getDamageBonus()).toBe(1);
      expect(service.getHealthBonus()).toBe(1);
    });
  });
});
