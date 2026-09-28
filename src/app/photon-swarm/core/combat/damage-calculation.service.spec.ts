import { TestBed } from '@angular/core/testing';
import { CombatStats, DamageCalculationService } from './damage-calculation.service';
import { RandomService } from '../utils/random.service';
import { BuffSystemService } from '../progression/buff-system.service';
import { PlayerUpgradesService } from '../player/player-upgrades.service';
import { EnemyType } from '../models/enemy.model';

describe('DamageCalculationService', () => {
  let service: DamageCalculationService;
  let randomServiceSpy: jasmine.SpyObj<RandomService>;
  let buffSystemServiceSpy: jasmine.SpyObj<BuffSystemService>;
  let playerUpgradesSpy: jasmine.SpyObj<PlayerUpgradesService>;

  const DEFAULT_STATS: CombatStats = {
    attackLevel: 10,
    defenseLevel: 10,
    strengthLevel: 10,
    slashAttackBonus: 5,
    stabAttackBonus: 5,
    crushAttackBonus: 5,
    magicAttackBonus: 5,
    rangedAttackBonus: 5,
    slashDefenseBonus: 5,
    stabDefenseBonus: 5,
    crushDefenseBonus: 5,
    magicDefenseBonus: 5,
    rangedDefenseBonus: 5,
    strengthBonus: 5,
    magicDamageBonus: 5,
    rangedStrengthBonus: 5,
  };

  beforeEach(() => {
    const randomSpy = jasmine.createSpyObj('RandomService', ['random', 'randomInt']);
    const buffSpy = jasmine.createSpyObj('BuffSystemService', [], {
      beamDamageMultiplier: 1.0,
      dischargeDamageMultiplier: 1.0,
      damageTakenMultiplier: 1.0,
      burnDamageMultiplier: 1.0,
    });
    const upgradesSpy = jasmine.createSpyObj('PlayerUpgradesService', [
      'getCriticalHitChance',
      'getCriticalHitMultiplier',
    ]);
    upgradesSpy.getCriticalHitChance.and.returnValue(0);
    upgradesSpy.getCriticalHitMultiplier.and.returnValue(1.5);

    TestBed.configureTestingModule({
      providers: [
        DamageCalculationService,
        { provide: RandomService, useValue: randomSpy },
        { provide: BuffSystemService, useValue: buffSpy },
        { provide: PlayerUpgradesService, useValue: upgradesSpy },
      ],
    });

    service = TestBed.inject(DamageCalculationService);
    randomServiceSpy = TestBed.inject(RandomService) as jasmine.SpyObj<RandomService>;
    buffSystemServiceSpy = TestBed.inject(BuffSystemService) as jasmine.SpyObj<BuffSystemService>;
    playerUpgradesSpy = TestBed.inject(PlayerUpgradesService) as jasmine.SpyObj<PlayerUpgradesService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // === BEAM DAMAGE TESTS ===

  describe('calculateBeamDamage', () => {
    it('should apply base beam damage without modifiers', () => {
      randomServiceSpy.random.and.returnValue(0.99); // No crit
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      expect(result.baseDamage).toBe(10);
      expect(result.finalDamage).toBe(10);
      expect(result.isHit).toBeTrue();
      expect(result.damageType).toBe('beam');
      expect(result.isCritical).toBeFalse();
    });

    it('should apply enemy damage multiplier', () => {
      randomServiceSpy.random.and.returnValue(0.99);
      const enemy = { health: 50, maxHealth: 100, damageMultiplier: 2 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      expect(result.finalDamage).toBe(20);
      expect(result.damageModifiers.some((m) => m.name === 'Enemy Multiplier')).toBeTrue();
    });

    it('should apply beam damage buff multiplier', () => {
      randomServiceSpy.random.and.returnValue(0.99);
      Object.defineProperty(buffSystemServiceSpy, 'beamDamageMultiplier', { get: () => 1.5 });
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      expect(result.finalDamage).toBe(15);
    });

    it('should apply critical hits when random rolls below crit chance', () => {
      playerUpgradesSpy.getCriticalHitChance.and.returnValue(0.5);
      playerUpgradesSpy.getCriticalHitMultiplier.and.returnValue(2.0);
      randomServiceSpy.random.and.returnValue(0.3); // Below 0.5 crit chance = crit
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      expect(result.isCritical).toBeTrue();
      expect(result.criticalMultiplier).toBe(2.0);
      expect(result.finalDamage).toBe(20);
    });

    it('should not apply critical hits when random rolls above crit chance', () => {
      playerUpgradesSpy.getCriticalHitChance.and.returnValue(0.1);
      randomServiceSpy.random.and.returnValue(0.5); // Above 0.1 crit chance = no crit
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      expect(result.isCritical).toBeFalse();
      expect(result.criticalMultiplier).toBe(1);
    });

    it('should combine enemy multiplier, buff, and crit', () => {
      playerUpgradesSpy.getCriticalHitChance.and.returnValue(1.0); // Always crit
      playerUpgradesSpy.getCriticalHitMultiplier.and.returnValue(1.5);
      randomServiceSpy.random.and.returnValue(0.1);
      Object.defineProperty(buffSystemServiceSpy, 'beamDamageMultiplier', { get: () => 2.0 });
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1.5 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      // 10 * 1.5 (enemy) * 2.0 (buff) * 1.5 (crit) = 45
      expect(result.finalDamage).toBe(45);
    });

    it('should always report isHit as true for legacy beam damage', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1 } as never;
      const result = service.calculateBeamDamage(enemy, 5);

      expect(result.isHit).toBeTrue();
      expect(result.accuracyRollResult.isSuccessful).toBeTrue();
      expect(result.accuracyRollResult.hitChance).toBe(1.0);
    });
  });

  // === KAMIKAZE DAMAGE TESTS ===

  describe('calculateKamikazeDamage', () => {
    it('should deal 50% of enemy remaining health', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      const enemy = { health: 80, maxHealth: 100 } as never;
      const result = service.calculateKamikazeDamage(enemy);

      expect(result.baseDamage).toBe(40); // 80 * 0.5
      expect(result.finalDamage).toBe(40);
      expect(result.damageType).toBe('kamikaze');
    });

    it('should apply damage taken multiplier', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      Object.defineProperty(buffSystemServiceSpy, 'damageTakenMultiplier', { get: () => 1.5 });
      const enemy = { health: 100, maxHealth: 100 } as never;
      const result = service.calculateKamikazeDamage(enemy);

      // 100 * 0.5 * 1.5 = 75
      expect(result.finalDamage).toBe(75);
    });

    it('should handle zero health enemies', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      const enemy = { health: 0, maxHealth: 100 } as never;
      const result = service.calculateKamikazeDamage(enemy);

      expect(result.baseDamage).toBe(0);
      expect(result.finalDamage).toBe(0);
    });
  });

  // === PROJECTILE DAMAGE TESTS ===

  describe('calculateProjectileDamage', () => {
    it('should apply projectile damage without modifiers', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      const projectile = { damage: 15 };
      const result = service.calculateProjectileDamage(projectile);

      expect(result.baseDamage).toBe(15);
      expect(result.finalDamage).toBe(15);
      expect(result.damageType).toBe('projectile');
    });

    it('should apply damage taken multiplier to projectiles', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      Object.defineProperty(buffSystemServiceSpy, 'damageTakenMultiplier', { get: () => 0.5 });
      const projectile = { damage: 20 };
      const result = service.calculateProjectileDamage(projectile);

      expect(result.finalDamage).toBe(10); // 20 * 0.5
    });
  });

  // === BURN DAMAGE TESTS ===

  describe('calculateBurnDamage', () => {
    it('should apply base burn damage', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      const enemy = { health: 100, maxHealth: 100 } as never;
      const result = service.calculateBurnDamage(enemy, 5);

      expect(result.baseDamage).toBe(5);
      expect(result.finalDamage).toBe(5);
      expect(result.damageType).toBe('burn');
    });

    it('should apply burn damage multiplier buff', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      Object.defineProperty(buffSystemServiceSpy, 'burnDamageMultiplier', { get: () => 2.0 });
      const enemy = { health: 100, maxHealth: 100 } as never;
      const result = service.calculateBurnDamage(enemy, 8);

      expect(result.finalDamage).toBe(16); // 8 * 2.0
    });

    it('should always hit (DoT)', () => {
      randomServiceSpy.random.and.returnValue(0.5);
      const enemy = { health: 100, maxHealth: 100 } as never;
      const result = service.calculateBurnDamage(enemy, 5);

      expect(result.isHit).toBeTrue();
      expect(result.accuracyRollResult.hitChance).toBe(1.0);
    });
  });

  // === RECOIL DAMAGE TESTS ===

  describe('calculateRecoilDamage', () => {
    it('should deal percentage of enemy health as recoil', () => {
      const enemy = { health: 200, maxHealth: 200 } as never;
      const result = service.calculateRecoilDamage(enemy, 0.1);

      expect(result.baseDamage).toBe(20); // 200 * 0.1
      expect(result.finalDamage).toBe(20);
      expect(result.damageType).toBe('recoil');
    });

    it('should handle small recoil multipliers', () => {
      const enemy = { health: 50, maxHealth: 100 } as never;
      const result = service.calculateRecoilDamage(enemy, 0.05);

      expect(result.baseDamage).toBe(2); // floor(50 * 0.05)
    });
  });

  // === OSRS-STYLE COMBAT TESTS ===

  describe('calculateOSRSStyleDamage', () => {
    it('should miss when defender roll is higher', () => {
      // First random call: attacker roll (low = miss)
      // Second random call: defender roll (high = block)
      randomServiceSpy.random.and.returnValues(0.01, 0.99, 0.5);
      const attacker: CombatStats = { ...DEFAULT_STATS, attackLevel: 1 };
      const defender: CombatStats = { ...DEFAULT_STATS, defenseLevel: 50 };

      const result = service.calculateOSRSStyleDamage(attacker, defender, 'slash', 10);

      expect(result.isHit).toBeFalse();
      expect(result.finalDamage).toBe(0);
    });

    it('should hit when attacker roll is higher', () => {
      // High attacker roll, low defender roll, then damage roll, then crit check
      randomServiceSpy.random.and.returnValues(0.99, 0.01, 0.5, 0.99);
      const attacker: CombatStats = { ...DEFAULT_STATS, attackLevel: 50 };
      const defender: CombatStats = { ...DEFAULT_STATS, defenseLevel: 1 };

      const result = service.calculateOSRSStyleDamage(attacker, defender, 'slash', 10);

      expect(result.isHit).toBeTrue();
      expect(result.finalDamage).toBeGreaterThan(0);
    });

    it('should apply critical hits to OSRS damage', () => {
      playerUpgradesSpy.getCriticalHitChance.and.returnValue(1.0);
      playerUpgradesSpy.getCriticalHitMultiplier.and.returnValue(2.0);
      // Guarantee hit: high attacker roll, low defender roll
      // Then damage roll, then crit roll
      randomServiceSpy.random.and.returnValues(0.99, 0.01, 0.5, 0.1);
      const attacker: CombatStats = { ...DEFAULT_STATS, attackLevel: 50 };
      const defender: CombatStats = { ...DEFAULT_STATS, defenseLevel: 1 };

      const result = service.calculateOSRSStyleDamage(attacker, defender, 'magic', 20);

      expect(result.isCritical).toBeTrue();
      expect(result.criticalMultiplier).toBe(2.0);
    });
  });

  // === PLAYER STATS MANAGEMENT ===

  describe('updatePlayerCombatStats', () => {
    it('should update and return player stats', () => {
      const newStats: CombatStats = { ...DEFAULT_STATS, attackLevel: 99 };
      service.updatePlayerCombatStats(newStats);

      const current = service.getCurrentPlayerStats();
      expect(current.attackLevel).toBe(99);
    });

    it('should return a copy of stats (not reference)', () => {
      service.updatePlayerCombatStats(DEFAULT_STATS);
      const stats1 = service.getCurrentPlayerStats();
      const stats2 = service.getCurrentPlayerStats();
      expect(stats1).toEqual(stats2);
      expect(stats1).not.toBe(stats2);
    });
  });

  // === ENEMY DAMAGE PROPERTIES ===

  describe('getEnemyDamageProperties', () => {
    it('should return properties for basic enemy type', () => {
      const props = service.getEnemyDamageProperties(EnemyType.Basic);
      expect(props.baseDamage).toBe(3);
      expect(props.damageMultiplier).toBe(1);
      expect(props.armorTier).toBe('light');
    });

    it('should return properties for tank enemy type', () => {
      const props = service.getEnemyDamageProperties(EnemyType.Tank);
      expect(props.baseDamage).toBe(12);
      expect(props.damageMultiplier).toBe(1.5);
      expect(props.armorTier).toBe('heavy');
    });

    it('should return properties for boss enemy type', () => {
      const props = service.getEnemyDamageProperties(EnemyType.Boss);
      expect(props.baseDamage).toBe(25);
      expect(props.armorTier).toBe('divine');
      expect(props.weaknesses.length).toBe(0);
    });

    it('should default to basic for unknown enemy type', () => {
      const props = service.getEnemyDamageProperties('unknown' as unknown as EnemyType);
      expect(props.baseDamage).toBe(3);
    });
  });

  // === DAMAGE TYPE EFFECTIVENESS ===

  describe('getDamageTypeEffectiveness', () => {
    it('should return 1.0 for neutral matchups', () => {
      expect(service.getDamageTypeEffectiveness('beam', EnemyType.Basic)).toBe(1.0);
    });

    it('should return higher effectiveness for beam vs swarm', () => {
      expect(service.getDamageTypeEffectiveness('beam', EnemyType.Swarm)).toBe(1.3);
    });

    it('should return lower effectiveness for beam vs boss', () => {
      expect(service.getDamageTypeEffectiveness('beam', EnemyType.Boss)).toBe(0.6);
    });

    it('should return 1.0 for burn vs basic', () => {
      expect(service.getDamageTypeEffectiveness('burn', EnemyType.Basic)).toBe(1.0);
    });

    it('should return higher burn effectiveness vs sniper', () => {
      expect(service.getDamageTypeEffectiveness('burn', EnemyType.Sniper)).toBe(1.5);
    });
  });

  // === COMBAT STYLE EFFECTIVENESS ===

  describe('getCombatStyleEffectiveness', () => {
    it('should return 2.0 for weakness matchups', () => {
      // Basic is weak to magic
      expect(service.getCombatStyleEffectiveness('magic', EnemyType.Basic)).toBe(2.0);
    });

    it('should return 0.5 for resistance matchups', () => {
      // Basic resists ranged
      expect(service.getCombatStyleEffectiveness('ranged', EnemyType.Basic)).toBe(0.5);
    });

    it('should return 1.0 for neutral matchups', () => {
      expect(service.getCombatStyleEffectiveness('slash', EnemyType.Basic)).toBe(1.0);
    });
  });

  // === ARMOR TIER PROPERTIES ===

  describe('getArmorTierProperties', () => {
    it('should return zero bonuses for no armor', () => {
      const props = service.getArmorTierProperties('none');
      expect(props.defenseBonus).toBe(0);
      expect(props.magicPenalty).toBe(0);
    });

    it('should return high defense for heavy armor', () => {
      const props = service.getArmorTierProperties('heavy');
      expect(props.defenseBonus).toBe(50);
      expect(props.magicPenalty).toBe(30);
    });

    it('should return magic resistance for magical armor', () => {
      const props = service.getArmorTierProperties('magical');
      expect(props.magicPenalty).toBe(-20); // Negative = magic resistant
    });

    it('should return max defense for divine armor', () => {
      const props = service.getArmorTierProperties('divine');
      expect(props.defenseBonus).toBe(100);
    });
  });

  // === DAMAGE MODIFIERS TRACKING ===

  describe('damage modifiers', () => {
    it('should track all applied modifiers in beam damage', () => {
      playerUpgradesSpy.getCriticalHitChance.and.returnValue(1.0);
      playerUpgradesSpy.getCriticalHitMultiplier.and.returnValue(2.0);
      randomServiceSpy.random.and.returnValue(0.1);
      Object.defineProperty(buffSystemServiceSpy, 'beamDamageMultiplier', { get: () => 1.5 });
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 2.0 } as never;

      const result = service.calculateBeamDamage(enemy, 10);

      // Base Beam Damage + Enemy Multiplier + Player Beam Multiplier + Critical Hit
      expect(result.damageModifiers.length).toBe(4);
      expect(result.damageModifiers[0].name).toBe('Base Beam Damage');
      expect(result.damageModifiers[1].name).toBe('Enemy Multiplier');
      expect(result.damageModifiers[2].name).toBe('Player Beam Multiplier');
      expect(result.damageModifiers[3].name).toBe('Critical Hit');
    });

    it('should floor final damage to integers', () => {
      randomServiceSpy.random.and.returnValue(0.99);
      Object.defineProperty(buffSystemServiceSpy, 'beamDamageMultiplier', { get: () => 1.33 });
      const enemy = { health: 100, maxHealth: 100, damageMultiplier: 1 } as never;
      const result = service.calculateBeamDamage(enemy, 10);

      expect(result.finalDamage).toBe(Math.floor(10 * 1.33));
      expect(Number.isInteger(result.finalDamage)).toBeTrue();
    });
  });
});
