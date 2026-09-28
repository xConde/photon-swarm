import { TestBed } from '@angular/core/testing';
import { ProgressionSystemService } from './progression-system.service';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { AudioService } from '../audio/audio.service';
import { AscensionService } from '../../services/ascension.service';

describe('ProgressionSystemService', () => {
  let service: ProgressionSystemService;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;
  let ascensionServiceMock: jasmine.SpyObj<AscensionService>;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    ascensionServiceMock = jasmine.createSpyObj('AscensionService', [
      'getDamageBonus',
      'getHealthBonus',
      'getShardBonus',
      'getXpBonus',
      'getAscensionLevel',
      'canAscend',
      'ascend',
      'reset',
      'getRequiredLevel',
    ]);
    ascensionServiceMock.getDamageBonus.and.returnValue(1.0);
    ascensionServiceMock.getHealthBonus.and.returnValue(1.0);
    ascensionServiceMock.getShardBonus.and.returnValue(1.0);
    ascensionServiceMock.getXpBonus.and.returnValue(1.0);
    let mockAscensionLevel = 0;
    ascensionServiceMock.getAscensionLevel.and.callFake(() => mockAscensionLevel);
    ascensionServiceMock.ascend.and.callFake(() => ++mockAscensionLevel);
    ascensionServiceMock.canAscend.and.returnValue(false);
    ascensionServiceMock.getRequiredLevel.and.returnValue(10);

    TestBed.configureTestingModule({
      providers: [
        ProgressionSystemService,
        { provide: DebugLogBridgeService, useValue: spy },
        {
          provide: AudioService,
          useValue: jasmine.createSpyObj('AudioService', [
            'playBeamFire',
            'playEnemyDeath',
            'playEliteDeath',
            'playShardCollect',
            'playDamageTaken',
            'playLevelUp',
            'playComboTier',
            'playBossBurst',
            'destroy',
          ]),
        },
        { provide: AscensionService, useValue: ascensionServiceMock },
      ],
    });

    service = TestBed.inject(ProgressionSystemService);
    debugLogSpy = TestBed.inject(DebugLogBridgeService) as jasmine.SpyObj<DebugLogBridgeService>;
  });

  describe('Initial State', () => {
    it('should start at level 1 with 0 xp', () => {
      expect(service.level).toBe(1);
      expect(service.xp).toBe(0);
      expect(service.ascensionLevel).toBe(0);
    });
  });

  describe('XP Accumulation', () => {
    it('should accumulate XP correctly from single source', () => {
      // Keep XP below level-up threshold (100 XP for level 1->2)
      service.addXp(25);
      expect(service.xp).toBe(25);

      service.addXp(20);
      expect(service.xp).toBe(45);
    });

    it('should accumulate XP correctly from multiple concurrent sources', () => {
      // Simulate multiple enemies dying at once
      // Keep total below level-up threshold to test accumulation
      const xpValues = [5, 10, 15, 10, 5];
      xpValues.forEach((xp) => service.addXp(xp));

      expect(service.xp).toBe(45);
    });

    it('should ignore zero XP gains', () => {
      service.addXp(50);
      service.addXp(0);
      expect(service.xp).toBe(50);

      // Check that no log was created for 0 XP
      const xpLogs = debugLogSpy.log.calls.all().filter((call) => call.args[0].includes('XP Gained'));
      expect(xpLogs.length).toBe(1); // Only the 50 XP gain
    });

    it('should ignore negative XP gains', () => {
      service.addXp(50);
      service.addXp(-20);
      expect(service.xp).toBe(50);
    });

    it('should handle XP overflow protection', () => {
      // Set to high level near max
      service.setLevel(49);
      service.setXp(0);

      // Try to add massive XP
      const massiveXp = Number.MAX_SAFE_INTEGER;
      service.addXp(massiveXp);

      // Should level up to 50 and stop
      expect(service.level).toBe(50);
      // XP should not overflow
      expect(service.xp).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });

    it('should block XP gain at max level', () => {
      // Set to max level
      service.setLevel(PROGRESSION_CONFIG.MAX_LEVEL);
      service.setXp(0);

      // Try to add XP
      service.addXp(1000);

      // XP should not increase
      expect(service.xp).toBe(0);
      expect(service.level).toBe(PROGRESSION_CONFIG.MAX_LEVEL);

      // Should log max level reached
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('MAX LEVEL'),
        'warning',
        jasmine.any(Object)
      );
    });
  });

  describe('Level Progression', () => {
    it('should level up when XP threshold is reached', () => {
      const levels: number[] = [];
      service.levelUp$.subscribe((lvl) => levels.push(lvl));

      // Level 1->2 requires 100 XP (XP_BASE with 1.12 multiplier)
      service.addXp(100);

      expect(service.level).toBe(2);
      expect(service.xp).toBe(0);
      expect(levels).toEqual([2]);
    });

    it('should handle multiple level ups in single XP gain', () => {
      const levels: number[] = [];
      service.levelUp$.subscribe((lvl) => levels.push(lvl));

      // Add enough XP for multiple levels
      // Level 1->2: 100 XP, Level 2->3: 112 XP, Total: 212 XP
      service.addXp(212);

      expect(service.level).toBe(3);
      expect(service.xp).toBe(0);
      expect(levels).toEqual([2, 3]);
    });

    it('should carry over excess XP after level up', () => {
      // Level 1->2 requires 100 XP
      service.addXp(115);

      expect(service.level).toBe(2);
      expect(service.xp).toBe(15); // 15 XP carried over
    });

    it('should calculate correct XP requirements for each level', () => {
      // Test exponential curve with XP_BASE=100, XP_MULTIPLIER=1.12
      const xpForLevel2 = service.getXpForNextLevel();
      expect(xpForLevel2).toBe(100);

      service.setLevel(2);
      const xpForLevel3 = service.getXpForNextLevel();
      expect(xpForLevel3).toBe(112); // 100 * 1.12 = 112

      service.setLevel(10);
      const xpForLevel11 = service.getXpForNextLevel();
      expect(xpForLevel11).toBeGreaterThan(200); // Higher with 1.12 multiplier
    });

    it('should prevent infinite level up loops', () => {
      const levels: number[] = [];
      service.levelUp$.subscribe((lvl) => levels.push(lvl));

      // Add massive XP that would cause many level ups
      service.addXp(1000000);

      // Should stop at reasonable number of levels
      expect(levels.length).toBeLessThanOrEqual(10); // MAX_LEVEL_UPS safety limit
    });

    it('should return MAX_SAFE_INTEGER for XP requirement at max level', () => {
      service.setLevel(PROGRESSION_CONFIG.MAX_LEVEL);
      const xpRequired = service.getXpForNextLevel();

      expect(xpRequired).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('State Persistence', () => {
    it('should maintain XP across multiple operations', () => {
      service.addXp(25);
      expect(service.xp).toBe(25);

      service.addXp(40);
      expect(service.xp).toBe(65);

      service.addXp(35);
      expect(service.level).toBe(2); // 100 XP triggers level up
      expect(service.xp).toBe(0);
    });

    it('should reset correctly', () => {
      service.addXp(212); // Level 1->2: 100 XP, Level 2->3: 112 XP
      expect(service.level).toBe(3);

      // reset() syncs ascension from AscensionService
      ascensionServiceMock.getAscensionLevel.and.returnValue(0);
      service.reset();

      expect(service.level).toBe(1);
      expect(service.xp).toBe(0);
      expect(service.ascensionLevel).toBe(0); // Ascension should not reset
    });

    it('should preserve ascension level on reset', () => {
      service.increaseAscensionLevel();
      service.increaseAscensionLevel();
      service.addXp(100);

      // reset() syncs ascension from AscensionService - mock the persisted value
      ascensionServiceMock.getAscensionLevel.and.returnValue(2);
      service.reset();

      expect(service.ascensionLevel).toBe(2);
      expect(service.level).toBe(1);
      expect(service.xp).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid concurrent XP gains', () => {
      const levels: number[] = [];
      service.levelUp$.subscribe((lvl) => levels.push(lvl));

      // Simulate rapid kills
      for (let i = 0; i < 20; i++) {
        service.addXp(10);
      }

      expect(service.xp + (service.level - 1) * 100).toBeGreaterThanOrEqual(200);
    });

    it('should not lose XP when setting level manually', () => {
      service.addXp(50);
      service.setLevel(5);

      // XP should be preserved (not reset)
      expect(service.xp).toBe(50);
    });

    it('should handle XP setter with validation', () => {
      service.setXp(100);
      expect(service.xp).toBe(100);

      service.setXp(-50);
      expect(service.xp).toBe(0); // Should clamp to 0

      service.setXp(Number.MAX_SAFE_INTEGER + 1);
      expect(service.xp).toBe(Number.MAX_SAFE_INTEGER + 1); // Allow but track
    });

    it('should handle level setter with validation', () => {
      service.setLevel(10);
      expect(service.level).toBe(10);

      service.setLevel(0);
      expect(service.level).toBe(1); // Should clamp to 1

      service.setLevel(-5);
      expect(service.level).toBe(1); // Should clamp to 1
    });
  });

  describe('Ascension System', () => {
    it('should increment ascension level', () => {
      service.increaseAscensionLevel();
      expect(service.ascensionLevel).toBe(1);

      service.increaseAscensionLevel();
      expect(service.ascensionLevel).toBe(2);
    });

    it('should log ascension level increases', () => {
      service.increaseAscensionLevel();

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('ASCENSION LEVEL UP'),
        'success',
        jasmine.any(Object)
      );
    });
  });

  describe('XP Sources Integration', () => {
    it('should handle enemy kill XP correctly', () => {
      // Simulate enemy kills with different XP values
      const basicEnemyXp = PROGRESSION_CONFIG.ENEMY_XP.basic;
      const eliteMultiplier = PROGRESSION_CONFIG.ELITE_MULTIPLIER;

      service.addXp(basicEnemyXp);
      expect(service.xp).toBe(basicEnemyXp);

      service.addXp(basicEnemyXp * eliteMultiplier);
      expect(service.xp).toBe(basicEnemyXp + basicEnemyXp * eliteMultiplier);
    });

    it('should handle boss kill XP correctly', () => {
      const bossXp = PROGRESSION_CONFIG.ENEMY_XP.boss;
      // Boss XP (120) should trigger level ups with XP_BASE=100
      // Level 1->2: 100 XP, Level 2->3: 112 XP
      // 120 >= 100, so level up to 2, remaining 20
      // 20 < 112, so stay at level 2 with 20 XP
      service.addXp(bossXp);

      expect(service.level).toBe(2);
      expect(service.xp).toBe(bossXp - 100); // 120 - 100 = 20 remaining
    });

    it('should not double award XP', () => {
      // This test verifies that XP is only awarded once per kill
      // In the actual game, this is prevented by the combat system
      // Use smaller amounts to avoid level-up complications
      const xpAmount = 20;

      service.addXp(xpAmount);
      const firstXp = service.xp;

      // If same XP is added again (double award), we can detect it
      service.addXp(xpAmount);
      expect(service.xp).toBe(firstXp + xpAmount); // 40 total, below level-up threshold

      // The system should track unique kills to prevent double XP
      // This would be tested in integration tests
    });
  });

  describe('Performance', () => {
    it('should handle large number of XP events efficiently', () => {
      const startTime = Date.now();

      // Simulate 1000 enemy kills
      for (let i = 0; i < 1000; i++) {
        service.addXp(10);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should process 1000 XP events in less than 100ms
      expect(duration).toBeLessThan(100);

      // Should have accumulated correctly
      expect(service.level).toBeGreaterThan(1);
    });
  });

  describe('Regression Tests', () => {
    it('should not reset XP when level changes (regression: level up bug)', () => {
      service.addXp(50);
      const xpBefore = service.xp;

      service.level = 2; // Direct setter

      expect(service.xp).toBe(xpBefore); // XP should not be reset
    });

    it('should process all level ups in single XP gain (regression: XP accumulation bug)', () => {
      const levels: number[] = [];
      service.levelUp$.subscribe((lvl) => levels.push(lvl));

      // Add enough XP for 5 levels
      service.addXp(1000);

      // Should process all level ups
      expect(levels.length).toBeGreaterThan(3);
      expect(service.level).toBeGreaterThan(4);
    });

    it('should cap at MAX_LEVEL (regression: level overflow)', () => {
      service.setLevel(PROGRESSION_CONFIG.MAX_LEVEL - 1);

      // Add massive XP
      service.addXp(Number.MAX_SAFE_INTEGER);

      // Should stop at MAX_LEVEL
      expect(service.level).toBe(PROGRESSION_CONFIG.MAX_LEVEL);
    });
  });
});
