import { TestBed } from '@angular/core/testing';
import { CombatEvent, CombatSystemService, IntensityService } from '../combat';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { DamageCalculationService } from '../../combat/damage-calculation.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import {
  BeamComponent,
  BuffComponent,
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  WeaponComponent,
} from '@photon/components';
import { take } from 'rxjs';

describe('CombatSystemService', () => {
  let service: CombatSystemService;
  let entityManager: EntityManagerService;
  let damageCalculation: jasmine.SpyObj<DamageCalculationService>;

  beforeEach(() => {
    const damageCalculationSpy = jasmine.createSpyObj('DamageCalculationService', [
      'calculateBeamDamage',
      'calculateProjectileDamage',
      'calculateBurnDamage',
      'calculateKamikazeDamage',
      'calculateRecoilDamage',
    ]);

    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
      'createDamageNumber',
      'createEnemyExplosion',
    ]);
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['addXp', 'level', 'xp']);
    const intensitySpy = jasmine.createSpyObj('IntensityService', ['getXpMultiplier']);

    // Set up default return values
    progressionSpy.level = 1;
    progressionSpy.xp = 0;
    intensitySpy.getXpMultiplier.and.returnValue(1.0); // Default: no bonus

    TestBed.configureTestingModule({
      providers: [
        CombatSystemService,
        EntityManagerService,
        { provide: DamageCalculationService, useValue: damageCalculationSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: IntensityService, useValue: intensitySpy },
      ],
    });

    service = TestBed.inject(CombatSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    damageCalculation = TestBed.inject(DamageCalculationService) as jasmine.SpyObj<DamageCalculationService>;

    // Setup default spy behavior
    const defaultCalculation = {
      baseDamage: 25,
      finalDamage: 50,
      isCritical: false,
      criticalMultiplier: 1.0,
      damageModifiers: [],
      damageType: 'beam' as const,
      accuracyRollResult: {
        attackerAccuracyRoll: 100,
        defenderDefenseRoll: 50,
        attackBonus: 25,
        defenseBonus: 10,
        isSuccessful: true,
        hitChance: 0.75,
      },
      isHit: true,
      maxHit: 50,
    };

    damageCalculation.calculateBeamDamage.and.returnValue(defaultCalculation);
    damageCalculation.calculateProjectileDamage.and.returnValue({ ...defaultCalculation, damageType: 'projectile' });
    damageCalculation.calculateBurnDamage.and.returnValue({ ...defaultCalculation, damageType: 'burn' });
    damageCalculation.calculateKamikazeDamage.and.returnValue({ ...defaultCalculation, damageType: 'kamikaze' });
    damageCalculation.calculateRecoilDamage.and.returnValue({ ...defaultCalculation, damageType: 'recoil' });
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('initialization', () => {
    it('should initialize combat system', () => {
      service.init();

      const stats = service.getCombatStats();
      expect(stats.resolutions).toBe(0);
      expect(stats.criticalHits).toBe(0);
      expect(stats.totalDamage).toBe(0);
      expect(stats.criticalRate).toBe(0);
    });

    it('should reset statistics on initialization', () => {
      // Perform some combat first
      const attacker = createPlayerEntity(entityManager);
      const defender = createEnemyEntity(entityManager);

      service.resolveCombat(attacker, defender, 'beam', entityManager);

      // Verify stats exist
      expect(service.getCombatStats().resolutions).toBeGreaterThan(0);

      // Re-initialize
      service.init();

      // Verify stats reset
      const stats = service.getCombatStats();
      expect(stats.resolutions).toBe(0);
    });
  });

  describe('beam combat resolution', () => {
    it('should resolve beam combat between player and enemy', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      let combatEvent: CombatEvent | null = null;
      service.combat$.pipe(take(1)).subscribe((event) => {
        combatEvent = event;
      });

      const result = service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(result).not.toBeNull();
      expect(result!.damageType).toBe('beam');
      expect(result!.damage).toBeGreaterThan(0);
      expect(combatEvent).not.toBeNull();
      expect(combatEvent!.attackerId).toBe(player);
      expect(combatEvent!.defenderId).toBe(enemy);
    });

    it('should apply beam damage to enemy health', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);
      const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      const initialHealth = enemyHealth.health;

      service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(enemyHealth.health).toBeLessThan(initialHealth);
    });

    it('should calculate critical hits for beam attacks', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Add high critical chance to ensure critical hit
      const damageComponent = new DamageComponent(10, 'beam');
      damageComponent.criticalChance = 1.0; // 100% critical chance
      damageComponent.criticalMultiplier = 3.0;
      entityManager.addComponent(player, damageComponent);

      const result = service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(result!.isCritical).toBeTruthy();
      expect(result!.damage).toBeGreaterThan(25); // Base 25 * 3.0 multiplier
    });

    it('should use advanced damage calculation when enabled', () => {
      service.init();
      service.updateConfig({ enableAdvancedDamage: true });

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(damageCalculation.calculateBeamDamage).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'basic',
        }),
        jasmine.any(Number)
      );
    });
  });

  describe('projectile combat resolution', () => {
    it('should resolve projectile combat', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      const result = service.resolveCombat(player, enemy, 'projectile', entityManager);

      expect(result).not.toBeNull();
      expect(result!.damageType).toBe('projectile');
      expect(result!.damage).toBeGreaterThan(0);
    });

    it('should use weapon damage for projectile attacks', () => {
      service.init();
      service.updateConfig({ enableAdvancedDamage: false }); // Disable advanced to test manual calculation

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Modify weapon damage
      const weapon = entityManager.getComponent(player, WeaponComponent)!;
      weapon.damage = 100;

      const result = service.resolveCombat(player, enemy, 'projectile', entityManager);

      expect(result!.damage).toBeGreaterThan(50); // Should be significant damage
    });
  });

  describe('PR #117 combat balance', () => {
    it('should apply correct projectile damage (46) to enemy health', () => {
      service.init();
      service.updateConfig({ enableAdvancedDamage: false });

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Set weapon damage to the new balance value (46)
      const weapon = entityManager.getComponent(player, WeaponComponent)!;
      weapon.damage = 46;

      const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      const initialHealth = enemyHealth.health;

      const result = service.resolveCombat(player, enemy, 'projectile', entityManager);

      expect(result).not.toBeNull();
      expect(result!.damageType).toBe('projectile');
      // With no buffs, no crits, and no advanced damage, projectile damage = floor(46) = 46
      expect(result!.damage).toBe(46);
      expect(enemyHealth.health).toBe(initialHealth - 46);
    });

    it('should calculate beam DPS correctly at new values', () => {
      service.init();
      service.updateConfig({ enableAdvancedDamage: false });

      const player = createPlayerEntity(entityManager);

      // Create enemy with enough HP to survive beam hits (140 and 196)
      const enemy = createHighHealthEnemyEntity(entityManager, 500);

      // Set beam damage to the new moving DPS value (140)
      const beam = entityManager.getComponent(player, BeamComponent)!;
      beam.damage = 140;

      const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      const initialHealth = enemyHealth.health;

      const result = service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(result).not.toBeNull();
      expect(result!.damageType).toBe('beam');
      // With no buffs, no crits, and no advanced damage, beam damage = floor(140) = 140
      expect(result!.damage).toBe(140);
      expect(enemyHealth.health).toBe(initialHealth - 140);

      // Now test stationary DPS (196)
      const enemy2 = createHighHealthEnemyEntity(entityManager, 500);
      beam.damage = 196;

      const enemy2Health = entityManager.getComponent(enemy2, HealthComponent)!;
      const initialHealth2 = enemy2Health.health;

      const result2 = service.resolveCombat(player, enemy2, 'beam', entityManager);

      expect(result2).not.toBeNull();
      expect(result2!.damage).toBe(196);
      expect(enemy2Health.health).toBe(initialHealth2 - 196);
    });
  });

  describe('kamikaze combat resolution', () => {
    it('should calculate kamikaze damage as percentage of defender health', () => {
      service.init();

      const enemy = createEnemyEntity(entityManager);
      const player = createPlayerEntity(entityManager);
      const playerHealth = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = playerHealth.health;

      const result = service.resolveCombat(enemy, player, 'kamikaze', entityManager);

      // Kamikaze damage should be 50% of player's health
      const expectedDamage = Math.floor(initialHealth * 0.5);
      expect(result!.damage).toBe(expectedDamage);
      expect(playerHealth.health).toBe(initialHealth - expectedDamage);
    });
  });

  describe('damage reduction', () => {
    it('should apply health component damage reduction', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Give player 50% damage reduction
      const playerHealth = entityManager.getComponent(player, HealthComponent)!;
      playerHealth.damageReduction = 0.5;
      const initialHealth = playerHealth.health;

      const result = service.resolveCombat(enemy, player, 'kamikaze', entityManager);

      // Damage should be reduced by 50%
      const expectedDamage = Math.floor(initialHealth * 0.5 * 0.5); // Kamikaze * reduction
      expect(result!.damage).toBe(expectedDamage);
    });

    it('should apply buff-based damage reduction', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Add buff with damage reduction
      const buffComponent = new BuffComponent();
      buffComponent.damageReduction = 0.3; // 30% reduction
      entityManager.addComponent(player, buffComponent);

      const playerHealth = entityManager.getComponent(player, HealthComponent)!;
      const initialHealth = playerHealth.health;

      const result = service.resolveCombat(enemy, player, 'kamikaze', entityManager);

      // Damage should be reduced by 30%
      const baseDamage = Math.floor(initialHealth * 0.5);
      const expectedDamage = Math.floor(baseDamage * 0.7);
      expect(result!.damage).toBe(expectedDamage);
    });

    it('should ensure minimum 1 damage', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Give player 99% damage reduction
      const playerHealth = entityManager.getComponent(player, HealthComponent)!;
      playerHealth.damageReduction = 0.99;

      const result = service.resolveCombat(enemy, player, 'beam', entityManager);

      expect(result!.damage).toBeGreaterThanOrEqual(1);
    });
  });

  describe('damage multipliers', () => {
    it('should apply attacker buff damage multipliers', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Add damage multiplier buff to player
      const buffComponent = new BuffComponent();
      buffComponent.damageMultiplier = 2.0;
      entityManager.addComponent(player, buffComponent);

      const result = service.resolveCombat(player, enemy, 'beam', entityManager);

      // Should deal more damage due to multiplier
      expect(result!.damage).toBeGreaterThan(25); // Base 25 * 2.0
    });

    it('should apply enemy-specific damage multipliers', () => {
      service.init();
      service.updateConfig({ enableAdvancedDamage: false }); // Disable advanced to test manual calculation

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Modify enemy damage multiplier
      const enemyType = entityManager.getComponent(enemy, EnemyTypeComponent)!;
      enemyType.damageMultiplier = 0.5; // Takes half damage

      // const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      // const initialHealth = enemyHealth.health;

      const result = service.resolveCombat(player, enemy, 'beam', entityManager);

      // Damage should be reduced due to enemy multiplier
      expect(result!.damage).toBeLessThan(25); // Less than base damage
    });
  });

  describe('death handling', () => {
    it('should mark entities for death when health reaches zero', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Set enemy to low health
      const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      enemyHealth.health = 1;

      const result = service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(result!.isKill).toBeTruthy();
      expect(enemyHealth.health).toBe(0);
      expect(enemyHealth.isDead).toBeTruthy();
    });

    it('should process deaths during update cycle', () => {
      service.init();

      const effectFactory = TestBed.inject(EffectFactoryService) as jasmine.SpyObj<EffectFactoryService>;
      const enemy = createEnemyEntity(entityManager);
      const enemyPosition = entityManager.getComponent(enemy, PositionComponent)!;
      const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      service.update(16, entityManager);

      // processDeaths should detect the dead entity and trigger explosion for basic enemy
      expect(effectFactory.createEnemyExplosion).toHaveBeenCalledOnceWith(
        { x: enemyPosition.x, y: enemyPosition.y },
        1.0
      );
      // isDead flag remains set after processing (entity removal is handled externally)
      expect(enemyHealth.isDead).toBeTrue();
    });
  });

  describe('damage over time', () => {
    it('should process burn damage over time', () => {
      service.init();

      const enemy = createEnemyEntity(entityManager);
      const enemyHealth = entityManager.getComponent(enemy, HealthComponent)!;
      const initialHealth = enemyHealth.health;

      // Add burn effect
      const damageComponent = new DamageComponent(10, 'burn');
      damageComponent.burnDuration = 2000; // 2 seconds
      damageComponent.burnDamage = 10;
      damageComponent.burnTickTimer = 0; // Immediate tick
      entityManager.addComponent(enemy, damageComponent);

      let burnEvent: CombatEvent | null = null;
      service.combat$.pipe(take(1)).subscribe((event) => {
        burnEvent = event;
      });

      service.update(16, entityManager);

      expect(enemyHealth.health).toBeLessThan(initialHealth);
      expect(burnEvent).not.toBeNull();
      expect(burnEvent!.damageType).toBe('burn');
    });

    it('should remove burn effect when duration expires', () => {
      service.init();

      const enemy = createEnemyEntity(entityManager);

      // Add burn effect with short duration
      const damageComponent = new DamageComponent(10, 'burn');
      damageComponent.burnDuration = 10; // Very short duration
      damageComponent.burnDamage = 5;
      entityManager.addComponent(enemy, damageComponent);

      // Update long enough to expire burn
      service.update(50, entityManager);

      expect(damageComponent.burnDuration).toBe(0);
      expect(damageComponent.burnTickTimer).toBe(0);
    });
  });

  describe('combat events', () => {
    it('should emit combat events with correct data', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      let combatEvent: CombatEvent | null = null;
      service.combat$.pipe(take(1)).subscribe((event) => {
        combatEvent = event;
      });

      service.resolveCombat(player, enemy, 'beam', entityManager);

      expect(combatEvent).not.toBeNull();
      expect(combatEvent!.attackerId).toBe(player);
      expect(combatEvent!.defenderId).toBe(enemy);
      expect(combatEvent!.damageType).toBe('beam');
      expect(combatEvent!.damage).toBeGreaterThan(0);
      expect(combatEvent!.position.x).toBeCloseTo(110); // Midpoint between 100 and 120
      expect(combatEvent!.position.y).toBeCloseTo(110); // Midpoint between 100 and 120
      expect(combatEvent!.timestamp).toBeGreaterThan(0);
    });
  });

  describe('statistics', () => {
    it('should track combat statistics', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Perform multiple combats
      service.resolveCombat(player, enemy, 'beam', entityManager);
      service.resolveCombat(player, enemy, 'projectile', entityManager);

      const stats = service.getCombatStats();
      expect(stats.resolutions).toBe(2);
      expect(stats.totalDamage).toBeGreaterThan(0);
    });

    it('should calculate critical hit rate', () => {
      service.init();

      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      // Add guaranteed critical chance
      const damageComponent = new DamageComponent(10, 'beam');
      damageComponent.criticalChance = 1.0;
      entityManager.addComponent(player, damageComponent);

      service.resolveCombat(player, enemy, 'beam', entityManager);

      const stats = service.getCombatStats();
      expect(stats.criticalRate).toBe(1.0); // 100% critical rate
    });
  });

  describe('configuration', () => {
    it('should allow configuration updates', () => {
      const newConfig = {
        baseCriticalChance: 0.15,
        baseCriticalMultiplier: 2.5,
        enableAdvancedDamage: false,
      };

      service.updateConfig(newConfig);

      // Verify configuration is applied by checking behavior
      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      service.resolveCombat(player, enemy, 'beam', entityManager);

      // Advanced damage should not be used
      expect(damageCalculation.calculateBeamDamage).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should complete observable on destroy', () => {
      let completed = false;
      service.combat$.subscribe({
        complete: () => {
          completed = true;
        },
      });

      service.destroy();

      expect(completed).toBeTruthy();
    });

    it('should reset statistics on destroy', () => {
      const player = createPlayerEntity(entityManager);
      const enemy = createEnemyEntity(entityManager);

      service.resolveCombat(player, enemy, 'beam', entityManager);

      // Verify stats exist
      expect(service.getCombatStats().resolutions).toBeGreaterThan(0);

      service.destroy();

      // Verify stats reset
      const stats = service.getCombatStats();
      expect(stats.resolutions).toBe(0);
    });
  });
});

// Helper functions for creating test entities
function createPlayerEntity(entityManager: EntityManagerService): number {
  const player = entityManager.createEntity();
  entityManager.addComponent(player, new PositionComponent(100, 100));
  entityManager.addComponent(player, new HealthComponent(100, 100));
  entityManager.addComponent(player, new PlayerControlledComponent());
  entityManager.addComponent(player, new WeaponComponent(20, 300));
  entityManager.addComponent(player, new BeamComponent(0, 1, 25));
  return player;
}

function createEnemyEntity(entityManager: EntityManagerService): number {
  const enemy = entityManager.createEntity();
  entityManager.addComponent(enemy, new PositionComponent(120, 120));
  entityManager.addComponent(enemy, new HealthComponent(50, 50));
  entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
  entityManager.addComponent(enemy, new DamageComponent(15, 'contact'));
  return enemy;
}

function createHighHealthEnemyEntity(entityManager: EntityManagerService, hp: number): number {
  const enemy = entityManager.createEntity();
  entityManager.addComponent(enemy, new PositionComponent(120, 120));
  entityManager.addComponent(enemy, new HealthComponent(hp, hp));
  entityManager.addComponent(enemy, new EnemyTypeComponent('basic'));
  entityManager.addComponent(enemy, new DamageComponent(15, 'contact'));
  return enemy;
}
