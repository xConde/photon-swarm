import { TestBed } from '@angular/core/testing';
import { PlayerUpgradesService } from './player-upgrades.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

describe('PlayerUpgradesService', () => {
  let service: PlayerUpgradesService;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [PlayerUpgradesService, { provide: DebugLogBridgeService, useValue: debugLogSpy }],
    });

    service = TestBed.inject(PlayerUpgradesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('Max Health', () => {
    it('should have default max health of 100', () => {
      expect(service.getMaxHealth()).toBe(100);
    });

    it('should set max health', () => {
      service.setMaxHealth(150);
      expect(service.getMaxHealth()).toBe(150);
    });

    it('should enforce minimum max health of 1', () => {
      service.setMaxHealth(-10);
      expect(service.getMaxHealth()).toBe(1);
    });

    it('should increase max health', () => {
      service.increaseMaxHealth(50);
      expect(service.getMaxHealth()).toBe(150);
    });

    it('should decrease max health with negative amount', () => {
      service.increaseMaxHealth(-30);
      expect(service.getMaxHealth()).toBe(70);
    });
  });

  describe('Speed Multiplier', () => {
    it('should have default speed multiplier of 1.0', () => {
      expect(service.getSpeedMultiplier()).toBe(1.0);
    });

    it('should increase speed multiplicatively', () => {
      service.increaseSpeed(0.2); // +20%
      expect(service.getSpeedMultiplier()).toBeCloseTo(1.2, 2);

      service.increaseSpeed(0.5); // +50%
      expect(service.getSpeedMultiplier()).toBeCloseTo(1.8, 2);
    });
  });

  describe('Beam Upgrades', () => {
    it('should have default beam damage multiplier of 1.0', () => {
      expect(service.getBeamDamageMultiplier()).toBe(1.0);
    });

    it('should increase beam damage', () => {
      service.increaseBeamDamage(0.25);
      expect(service.getBeamDamageMultiplier()).toBeCloseTo(1.25, 2);
    });

    it('should have default beam rotation multiplier of 1.0', () => {
      expect(service.getBeamRotationMultiplier()).toBe(1.0);
    });

    it('should increase beam rotation speed', () => {
      service.increaseBeamRotationSpeed(0.5);
      expect(service.getBeamRotationMultiplier()).toBeCloseTo(1.5, 2);
    });

    it('should have default beam width multiplier of 1.0', () => {
      expect(service.getBeamWidthMultiplier()).toBe(1.0);
    });

    it('should increase beam width', () => {
      service.increaseBeamWidth(0.3);
      expect(service.getBeamWidthMultiplier()).toBeCloseTo(1.3, 2);
    });

    it('should track double beam unlock', () => {
      expect(service.getHasDoubleBeam()).toBe(false);
      service.unlockDoubleBeam();
      expect(service.getHasDoubleBeam()).toBe(true);
    });
  });

  describe('Beam Core identity', () => {
    it('binds one core and exposes its distinct combat profile', () => {
      service.selectBeamCore('prism');

      expect(service.getBeamCoreId()).toBe('prism');
      expect(service.getBeamCoreProfile().angleOffsets.length).toBe(3);
      expect(service.getBeamCoreProfile().damageMultiplier).toBeLessThan(1);
    });

    it('rejects changing core identity during a run', () => {
      service.selectBeamCore('lance');

      expect(() => service.selectBeamCore('arc')).toThrowError(/already bound/);
      expect(service.getBeamCoreId()).toBe('lance');
    });

    it('evolves a core with visible geometry and restores it transactionally', () => {
      service.selectBeamCore('prism');
      const snapshot = service.captureUpgradeTransaction();

      service.evolveBeamCore('prism_thermal_bloom');
      expect(service.getBeamCoreProfile().angleOffsets.length).toBe(5);
      expect(service.getBeamMutationIds()).toEqual(['prism_thermal_bloom']);

      service.restoreUpgradeTransaction(snapshot);
      expect(service.getBeamCoreProfile().angleOffsets.length).toBe(3);
      expect(service.getBeamMutationIds()).toEqual([]);
    });

    it('rejects mutations from a different core', () => {
      service.selectBeamCore('arc');

      expect(() => service.evolveBeamCore('lance_needlepoint')).toThrowError(/incompatible/);
      expect(service.getBeamMutationIds()).toEqual([]);
    });

    it('resolves Storm Anchor into a shorter, heavier Arc profile', () => {
      service.selectBeamCore('arc');
      const base = service.getBeamCoreProfile();

      service.evolveBeamCore('arc_storm_anchor');
      const anchored = service.getBeamCoreProfile();

      expect(service.getBeamMutationIds()).toEqual(['arc_storm_anchor']);
      expect(anchored.chainTargets).toBe(base.chainTargets);
      expect(anchored.chainRange).toBeCloseTo(base.chainRange * 0.82, 6);
      expect(anchored.damageMultiplier).toBeCloseTo(base.damageMultiplier * 1.18, 6);
      expect(anchored.chainDamageMultiplier).toBeCloseTo(base.chainDamageMultiplier * 1.42, 6);
      expect(anchored.widthMultiplier).toBeCloseTo(base.widthMultiplier * 1.22, 6);
    });
  });

  describe('Critical Hit', () => {
    it('should have default critical hit chance of 0', () => {
      expect(service.getCriticalHitChance()).toBe(0);
    });

    it('should set critical hit chance clamped to 0-1', () => {
      service.setCriticalHitChance(0.5);
      expect(service.getCriticalHitChance()).toBe(0.5);

      service.setCriticalHitChance(1.5);
      expect(service.getCriticalHitChance()).toBe(1);

      service.setCriticalHitChance(-0.5);
      expect(service.getCriticalHitChance()).toBe(0);
    });

    it('should have default critical hit multiplier of 1.5', () => {
      expect(service.getCriticalHitMultiplier()).toBe(1.5);
    });

    it('should set critical hit multiplier', () => {
      service.setCriticalHitMultiplier(2.5);
      expect(service.getCriticalHitMultiplier()).toBe(2.5);
    });
  });

  describe('Burn Upgrades', () => {
    it('should have default burn chance of 0', () => {
      expect(service.getBurnChance()).toBe(0);
    });

    it('should add burn chance capped at 1', () => {
      service.addBurnChance(0.3);
      expect(service.getBurnChance()).toBeCloseTo(0.3, 2);

      service.addBurnChance(0.9); // Would exceed 1
      expect(service.getBurnChance()).toBe(1);
    });

    it('should calculate burn damage with multiplier', () => {
      expect(service.getBurnDamage()).toBe(5); // Base: 5

      service.increaseBurnDamage(1.0); // +100%
      expect(service.getBurnDamage()).toBe(10);
    });
  });

  describe('Dash Cooldown', () => {
    it('should have default dash cooldown reduction of 0', () => {
      expect(service.getDashCooldownReduction()).toBe(0);
    });

    it('should increase dash efficiency capped at 75%', () => {
      service.increaseDashEfficiency(0.3);
      expect(service.getDashCooldownReduction()).toBeCloseTo(0.3, 2);

      service.increaseDashEfficiency(0.6); // Would exceed 0.75
      expect(service.getDashCooldownReduction()).toBe(0.75);
    });
  });

  describe('Discharge Radius', () => {
    it('should have default discharge radius multiplier of 1.0', () => {
      expect(service.getDischargeRadiusMultiplier()).toBe(1.0);
    });

    it('should increase discharge radius capped at 3x', () => {
      service.increaseDischargeRadius(0.5);
      expect(service.getDischargeRadiusMultiplier()).toBeCloseTo(1.5, 2);

      service.increaseDischargeRadius(2.0); // Would exceed 3x
      expect(service.getDischargeRadiusMultiplier()).toBeLessThanOrEqual(3.0);
    });
  });

  describe('Protocol Upgrades', () => {
    describe('Emergency Protocols', () => {
      it('should be disabled by default', () => {
        expect(service.hasEmergencyProtocols()).toBe(false);
      });

      it('should enable with healing multiplier', () => {
        service.setEmergencyProtocols(true, 2.0);
        expect(service.hasEmergencyProtocols()).toBe(true);
        expect(service.getEmergencyHealingMultiplier()).toBe(2.0);
      });
    });

    describe('Berserker Protocol', () => {
      it('should be disabled by default', () => {
        expect(service.hasBerserkerProtocol()).toBe(false);
      });

      it('should enable with max bonus', () => {
        service.setBerserkerProtocol(true, 1.5);
        expect(service.hasBerserkerProtocol()).toBe(true);
        expect(service.getBerserkerMaxBonus()).toBe(1.5);
      });
    });

    describe('Velocity Matrix', () => {
      it('should be disabled by default', () => {
        expect(service.hasVelocityMatrix()).toBe(false);
      });

      it('should enable with bonuses', () => {
        service.setVelocityMatrix(true, 0.1, 0.15);
        expect(service.hasVelocityMatrix()).toBe(true);
        const bonuses = service.getVelocityMatrixBonuses();
        expect(bonuses.speedBonus).toBe(0.1);
        expect(bonuses.damageBonus).toBe(0.15);
      });
    });

    describe('Shard Synthesis', () => {
      it('should be disabled by default', () => {
        expect(service.hasShardSynthesis()).toBe(false);
      });

      it('should enable with duration', () => {
        service.setShardSynthesis(true, 3000);
        expect(service.hasShardSynthesis()).toBe(true);
        expect(service.getShardSynthesisDuration()).toBe(3000);
      });
    });
  });

  describe('Shard Magnetism', () => {
    it('should track shard magnetism unlock', () => {
      expect(service.getHasShardMagnetism()).toBe(false);
      service.unlockShardMagnetism();
      expect(service.getHasShardMagnetism()).toBe(true);
      expect(service.getShardMagnetismBonus()).toBe(100);
    });

    it('should enhance shard magnetism additively', () => {
      expect(service.getShardMagnetismBonus()).toBe(0);
      service.enhanceShardMagnetism(50);
      expect(service.getShardMagnetismBonus()).toBe(50);
      service.enhanceShardMagnetism(25);
      expect(service.getShardMagnetismBonus()).toBe(75);
    });
  });

  describe('Beam Speed', () => {
    it('should increase beam speed multiplicatively', () => {
      expect(service.getBeamSpeedMultiplier()).toBe(1.0);
      service.increaseBeamSpeed(0.5); // +50%
      expect(service.getBeamSpeedMultiplier()).toBeCloseTo(1.5, 2);
      service.increaseBeamSpeed(0.2); // +20%
      expect(service.getBeamSpeedMultiplier()).toBeCloseTo(1.8, 2);
    });
  });

  describe('Unlock Flags', () => {
    it('should track discharge unlock', () => {
      expect(service.getHasDischarge()).toBe(false);
      service.unlockDischarge();
      expect(service.getHasDischarge()).toBe(true);
    });

    it('should track void beam unlock', () => {
      expect(service.getHasVoidBeam()).toBe(false);
      service.unlockVoidBeam();
      expect(service.getHasVoidBeam()).toBe(true);
    });

    it('should track shield breaker unlock', () => {
      expect(service.getHasShieldBreaker()).toBe(false);
      service.unlockShieldBreaker();
      expect(service.getHasShieldBreaker()).toBe(true);
    });
  });

  describe('Reset', () => {
    it('should reset multipliers to defaults', () => {
      // Set various upgrades
      service.setMaxHealth(200);
      service.increaseSpeed(1.0);
      service.increaseBeamDamage(0.5);
      service.setCriticalHitChance(0.3);
      service.addBurnChance(0.4);
      service.setBerserkerProtocol(true, 2.0);

      // Reset
      service.reset();

      // Check defaults
      expect(service.getMaxHealth()).toBe(100);
      expect(service.getSpeedMultiplier()).toBe(1.0);
      expect(service.getBeamDamageMultiplier()).toBe(1.0);
      expect(service.getCriticalHitChance()).toBe(0);
      expect(service.getBurnChance()).toBe(0);
      expect(service.hasBerserkerProtocol()).toBe(false);
    });

    it('should preserve shop unlocks and clear run-card unlocks', () => {
      service.unlockShardMagnetism();
      service.unlockDischarge();
      service.unlockVoidBeam();
      service.unlockShieldBreaker();

      service.reset();

      expect(service.getHasShardMagnetism()).toBe(true);
      expect(service.getHasDischarge()).toBe(false);
      expect(service.getHasVoidBeam()).toBe(false);
      expect(service.getHasShieldBreaker()).toBe(false);
    });

    it('should preserve shard magnetism bonus after reset when unlocked', () => {
      service.unlockShardMagnetism();
      expect(service.getShardMagnetismBonus()).toBe(100);

      service.reset();

      // Bonus should persist because flag is permanent
      expect(service.getHasShardMagnetism()).toBe(true);
      expect(service.getShardMagnetismBonus()).toBe(100);
    });

    it('should reset critical hit multiplier to 1.5 (default)', () => {
      service.setCriticalHitMultiplier(3.0);
      expect(service.getCriticalHitMultiplier()).toBe(3.0);

      service.reset();

      expect(service.getCriticalHitMultiplier()).toBe(1.5);
    });

    it('should reset double beam (session upgrade, not permanent)', () => {
      // Double beam is a session upgrade, not a permanent unlock
      service.unlockDoubleBeam();
      expect(service.getHasDoubleBeam()).toBe(true);

      service.reset();

      // Double beam resets on death (like in original PlayerService)
      expect(service.getHasDoubleBeam()).toBe(false);
    });

    it('should reset beam core and its mutations between runs', () => {
      service.selectBeamCore('arc');
      service.evolveBeamCore('arc_relay_web');

      service.reset();

      expect(service.hasBeamCore()).toBeFalse();
      expect(service.getBeamMutationIds()).toEqual([]);
      expect(service.getBeamCoreProfile().designation).toBe('UNBOUND');
    });
  });

  describe('Upgrade transactions', () => {
    it('restores every mutable run-card domain to its captured state', () => {
      service.setMaxHealth(140);
      service.increaseSpeed(0.2);
      service.increaseBeamDamage(0.25);
      service.increaseBurnDamage(0.5);
      service.setEmergencyProtocols(true, 2);
      service.unlockDischarge();
      const snapshot = service.captureUpgradeTransaction();

      service.increaseMaxHealth(60);
      service.increaseSpeed(0.5);
      service.increaseBeamDamage(0.5);
      service.increaseBurnDamage(1);
      service.setEmergencyProtocols(true, 4);
      service.setVelocityMatrix(true, 0.5, 0.75);
      service.unlockDoubleBeam();
      service.unlockVoidBeam();
      service.unlockShieldBreaker();

      service.restoreUpgradeTransaction(snapshot);

      expect(service.captureUpgradeTransaction()).toEqual(snapshot);
    });
  });

  describe('Shard Multiplier', () => {
    it('should have default shard multiplier of 1.0', () => {
      expect(service.getShardMultiplier()).toBe(1.0);
    });

    it('should set shard multiplier', () => {
      service.setShardMultiplier(2.5);
      expect(service.getShardMultiplier()).toBe(2.5);
    });
  });

  describe('Health Regen', () => {
    it('should have default health regen rate of 0', () => {
      expect(service.getHealthRegenRate()).toBe(0);
    });

    it('should set health regen rate', () => {
      service.setHealthRegeneration(5);
      expect(service.getHealthRegenRate()).toBe(5);
    });
  });

  describe('Misc Upgrades', () => {
    it('should track recoil damage', () => {
      expect(service.getRecoilDamage()).toBe(0);
      service.addRecoilDamage(0.5); // 0.5 * 10 = 5
      expect(service.getRecoilDamage()).toBe(5);
    });

    it('should track effect chance bonus', () => {
      expect(service.getEffectChanceBonus()).toBe(0);
      service.increaseEffectChance(0.1);
      expect(service.getEffectChanceBonus()).toBe(0.1);
    });

    it('should track targeting hold bonus', () => {
      expect(service.getTargetingHoldBonus()).toBe(0);
      service.increaseTargetingHoldDuration(2); // 2 * 0.5 = 1 second
      expect(service.getTargetingHoldBonus()).toBe(1);
    });

    it('should track fire rate multiplier', () => {
      expect(service.getFireRateMultiplier()).toBe(1.0);
      service.increaseFireRate(0.25);
      expect(service.getFireRateMultiplier()).toBeCloseTo(1.25, 2);
    });
  });
});
