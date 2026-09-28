import { TestBed } from '@angular/core/testing';
import { BUFF_CONSTANTS, BuffDefinition, BuffManagementSystemService } from '../gameplay';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { BuffComponent } from '@photon/components/buff.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

describe('BuffManagementSystemService — multiplicative stacking behavior', () => {
  let service: BuffManagementSystemService;
  let entityManager: EntityManagerService;
  let testEntity: number;

  beforeEach(() => {
    const debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [
        BuffManagementSystemService,
        EntityManagerService,
        { provide: DebugLogBridgeService, useValue: debugSpy },
      ],
    });

    service = TestBed.inject(BuffManagementSystemService);
    entityManager = TestBed.inject(EntityManagerService);

    // Create test entity with BuffComponent pre-attached
    testEntity = entityManager.createEntity();
    entityManager.addComponent(testEntity, new BuffComponent());

    // Stable time for tests that don't care about expiry
    spyOn(window.performance, 'now').and.returnValue(0);
  });

  afterEach(() => {
    entityManager.clear();
  });

  // Helper: read the entity's BuffComponent
  function buffComp(): BuffComponent {
    const comp = entityManager.getComponent(testEntity, BuffComponent);
    if (!comp) throw new Error('BuffComponent missing on testEntity');
    return comp;
  }

  // ---------------------------------------------------------------------------
  // 1. Multiplicative damage stacking — two different damage buff IDs
  // ---------------------------------------------------------------------------
  describe('multiplicative damage stacking (different buff IDs)', () => {
    it('should multiply damageMultiplier when damage_boost (1.5x) and damage_boost_2x (2.0x) are both active', () => {
      // damage_boost: 1.5x, damage_boost_2x: 2.0x → product = 3.0
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      const expected = 1.5 * 2.0; // 3.0
      expect(buffComp().damageMultiplier).toBeCloseTo(expected, 5);
    });

    it('damageMultiplier should equal 1.5 when only damage_boost is active', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(1.5, 5);
    });

    it('damageMultiplier should equal 2.0 when only damage_boost_2x is active', () => {
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(2.0, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Exponential stacking — Math.pow(multiplier, stacks) for stackable buffs
  // ---------------------------------------------------------------------------
  describe('exponential stacking with stackable buffs (speed_boost maxStacks: 3)', () => {
    it('should use Math.pow(1.3, 1) at 1 stack', () => {
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      expect(buffComp().speedMultiplier).toBeCloseTo(Math.pow(1.3, 1), 5);
    });

    it('should use Math.pow(1.3, 2) at 2 stacks', () => {
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      expect(buffComp().speedMultiplier).toBeCloseTo(Math.pow(1.3, 2), 5);
    });

    it('should use Math.pow(1.3, 3) at 3 stacks (max)', () => {
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      expect(buffComp().speedMultiplier).toBeCloseTo(Math.pow(1.3, 3), 5);
    });

    it('second application should increment stacks and return true', () => {
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      const stacked = service.applyBuff(testEntity, 'speed_boost', entityManager);

      expect(stacked).toBe(true);
      const activeBuff = service.getEntityBuffs(testEntity).find((b) => b.buffId === 'speed_boost');
      expect(activeBuff?.stacks).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Max stack limit enforcement
  // ---------------------------------------------------------------------------
  describe('max stack limit enforcement', () => {
    it('stack count should not exceed maxStacks after excess applications (speed_boost maxStacks: 3)', () => {
      // At max stacks the service refreshes duration instead of stacking further,
      // so the stack count is capped at maxStacks.
      for (let i = 0; i < 10; i++) {
        service.applyBuff(testEntity, 'speed_boost', entityManager);
      }

      const activeBuff = service.getEntityBuffs(testEntity).find((b) => b.buffId === 'speed_boost');
      expect(activeBuff?.stacks).toBeLessThanOrEqual(3);
    });

    it('speedMultiplier should not grow beyond Math.pow(1.3, maxStacks) after excess applications', () => {
      for (let i = 0; i < 10; i++) {
        service.applyBuff(testEntity, 'speed_boost', entityManager);
      }

      const maxExpected = Math.pow(1.3, 3);
      expect(buffComp().speedMultiplier).toBeCloseTo(maxExpected, 5);
    });

    it('stack count for shield (maxStacks: 2) should not exceed 2 after excess applications', () => {
      // At max stacks the service refreshes the buff duration, not rejects.
      // Stacks must remain at 2, the cap.
      for (let i = 0; i < 5; i++) {
        service.applyBuff(testEntity, 'shield', entityManager);
      }

      const activeBuff = service.getEntityBuffs(testEntity).find((b) => b.buffId === 'shield');
      expect(activeBuff?.stacks).toBe(2);
    });

    it('damageReduction from shield should not grow past 0.6 (0.3 × 2 stacks) after excess applications', () => {
      for (let i = 0; i < 5; i++) {
        service.applyBuff(testEntity, 'shield', entityManager);
      }

      // 0.3 * 2 stacks = 0.6; the stacks cap prevents further growth
      expect(buffComp().damageReduction).toBeCloseTo(0.6, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Mixed additive + multiplicative — multipliers and criticalChance combine correctly
  // ---------------------------------------------------------------------------
  describe('mixed additive + multiplicative buffs on same entity', () => {
    it('should combine damageMultiplier multiplicatively and criticalChance additively', () => {
      // damage_boost: damageMultiplier 1.5 (multiplicative)
      // critical_surge: criticalChance 0.25 (additive), criticalMultiplier 2.0 (multiplicative)
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'critical_surge', entityManager);

      const comp = buffComp();
      expect(comp.damageMultiplier).toBeCloseTo(1.5, 5);
      expect(comp.criticalChance).toBeCloseTo(0.25, 5);
      expect(comp.criticalMultiplier).toBeCloseTo(2.0, 5);
    });

    it('criticalChance should not affect damageMultiplier', () => {
      service.applyBuff(testEntity, 'critical_surge', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
    });

    it('damageMultiplier buff should not affect criticalChance', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      expect(buffComp().criticalChance).toBeCloseTo(0, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Additive cap enforcement — criticalChance capped at MAX_CRITICAL_CHANCE (1.0)
  // ---------------------------------------------------------------------------
  describe('additive cap enforcement — criticalChance', () => {
    it('should cap criticalChance at BUFF_CONSTANTS.MAX_CRITICAL_CHANCE (1.0)', () => {
      // critical_surge gives 0.25 per application; 5 stacks would be 1.25 if uncapped
      // Register a stackable version for this test
      const stackableCritDef: BuffDefinition = {
        id: 'crit_stack_test',
        name: 'Crit Stack Test',
        description: 'High criticalChance for cap testing',
        duration: 60000,
        stackable: true,
        maxStacks: 10,
        category: 'offensive',
        priority: 100,
        effects: { criticalChance: 0.4 },
      };
      service.registerBuff(stackableCritDef);

      // Apply 3 stacks: 0.4 * 3 = 1.2, must be capped to 1.0
      service.applyBuff(testEntity, 'crit_stack_test', entityManager);
      service.applyBuff(testEntity, 'crit_stack_test', entityManager);
      service.applyBuff(testEntity, 'crit_stack_test', entityManager);

      expect(buffComp().criticalChance).toBeCloseTo(BUFF_CONSTANTS.MAX_CRITICAL_CHANCE, 5);
      expect(buffComp().criticalChance).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_CRITICAL_CHANCE);
    });

    it('criticalChance should never exceed 1.0 regardless of how many stackable crit buffs are applied', () => {
      const overflowCritDef: BuffDefinition = {
        id: 'overflow_crit',
        name: 'Overflow Crit',
        description: 'Very large crit chance',
        duration: 60000,
        stackable: true,
        maxStacks: 20,
        category: 'offensive',
        priority: 100,
        effects: { criticalChance: 0.9 },
      };
      service.registerBuff(overflowCritDef);

      for (let i = 0; i < 5; i++) {
        service.applyBuff(testEntity, 'overflow_crit', entityManager);
      }

      expect(buffComp().criticalChance).not.toBeGreaterThan(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Damage reduction cap — capped at MAX_DAMAGE_REDUCTION (0.9)
  // ---------------------------------------------------------------------------
  describe('damage reduction cap enforcement', () => {
    it('should cap damageReduction at BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION (0.9)', () => {
      // shield gives 0.3 per stack, maxStacks: 2 → 0.6 total (under cap)
      // We need a custom stackable buff that exceeds 0.9
      const heavyShieldDef: BuffDefinition = {
        id: 'heavy_shield',
        name: 'Heavy Shield',
        description: '60% damage reduction, stackable',
        duration: 60000,
        stackable: true,
        maxStacks: 5,
        category: 'defensive',
        priority: 130,
        effects: { damageReduction: 0.6 },
      };
      service.registerBuff(heavyShieldDef);

      // 2 stacks: 0.6 * 2 = 1.2, must be capped at 0.9
      service.applyBuff(testEntity, 'heavy_shield', entityManager);
      service.applyBuff(testEntity, 'heavy_shield', entityManager);

      expect(buffComp().damageReduction).toBeCloseTo(BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION, 5);
      expect(buffComp().damageReduction).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION);
    });

    it('damageReduction from shield (0.3 per stack, maxStacks 2) reaches 0.6 and stays below cap', () => {
      service.applyBuff(testEntity, 'shield', entityManager);
      service.applyBuff(testEntity, 'shield', entityManager);

      // 0.3 * 2 stacks = 0.6, well below 0.9 cap
      expect(buffComp().damageReduction).toBeCloseTo(0.6, 5);
      expect(buffComp().damageReduction).toBeLessThan(BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION);
    });

    it('damageReduction should never exceed 0.9 regardless of stacks', () => {
      const absorbDef: BuffDefinition = {
        id: 'absorb_all',
        name: 'Absorb All',
        description: 'Near-full reduction, stackable',
        duration: 60000,
        stackable: true,
        maxStacks: 10,
        category: 'defensive',
        priority: 150,
        effects: { damageReduction: 0.95 },
      };
      service.registerBuff(absorbDef);

      for (let i = 0; i < 5; i++) {
        service.applyBuff(testEntity, 'absorb_all', entityManager);
      }

      expect(buffComp().damageReduction).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Multiple different damage buffs on same entity — composite multiplier
  // ---------------------------------------------------------------------------
  describe('multiple different damage buffs — composite multiplier', () => {
    it('should combine damage_boost (1.5), damage_boost_2x (2.0), damage_boost_3x (3.0) multiplicatively', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      const expected = 1.5 * 2.0 * 3.0; // 9.0
      expect(buffComp().damageMultiplier).toBeCloseTo(expected, 5);
    });

    it('adding damage_boost_3x to an already double-boosted entity multiplies correctly', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      const afterTwo = buffComp().damageMultiplier; // 1.5 * 2.0 = 3.0
      expect(afterTwo).toBeCloseTo(3.0, 5);

      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(afterTwo * 3.0, 5); // 9.0
    });

    it('hasBuff should reflect all three damage buffs as active', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost_2x')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost_3x')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Buff removal resets multiplier
  // ---------------------------------------------------------------------------
  describe('buff removal resets multiplier', () => {
    it('removing the only damage buff should restore damageMultiplier to 1.0', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      expect(buffComp().damageMultiplier).toBeCloseTo(1.5, 5);

      service.removeBuff(testEntity, 'damage_boost', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
    });

    it('removing one of two damage buffs should leave the remaining buff active', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      service.removeBuff(testEntity, 'damage_boost', entityManager);

      // Only damage_boost_2x (2.0) remains
      expect(buffComp().damageMultiplier).toBeCloseTo(2.0, 5);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
      expect(service.hasBuff(testEntity, 'damage_boost_2x')).toBe(true);
    });

    it('removing the last buff should return damageMultiplier exactly to 1.0, not near-1.0', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.removeBuff(testEntity, 'damage_boost', entityManager);
      service.removeBuff(testEntity, 'damage_boost_2x', entityManager);

      expect(buffComp().damageMultiplier).toBe(1.0);
    });

    it('removing a speed buff from max stacks should drop speedMultiplier below max', () => {
      // Fill speed_boost to max (3 stacks)
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      const atMax = buffComp().speedMultiplier;
      expect(atMax).toBeCloseTo(Math.pow(1.3, 3), 5);

      // removeBuff removes the entire buff entry (all stacks)
      service.removeBuff(testEntity, 'speed_boost', entityManager);

      expect(buffComp().speedMultiplier).toBeCloseTo(1.0, 5);
    });

    it('removeAllBuffs should reset all multipliers to base values', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'shield', entityManager);
      service.applyBuff(testEntity, 'critical_surge', entityManager);

      service.removeAllBuffs(testEntity, entityManager);

      const comp = buffComp();
      expect(comp.damageMultiplier).toBe(1.0);
      expect(comp.speedMultiplier).toBe(1.0);
      expect(comp.damageReduction).toBe(0);
      expect(comp.criticalChance).toBe(0);
      expect(comp.criticalMultiplier).toBe(1.0);
    });

    it('hasBuff should return false for removed buff', () => {
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.removeBuff(testEntity, 'damage_boost', entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
    });

    it('removeBuff on an entity with no buffs should return false without throwing', () => {
      const result = service.removeBuff(testEntity, 'damage_boost', entityManager);

      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Bonus: base state assertions — ensure clean entity starts at neutral values
  // ---------------------------------------------------------------------------
  describe('base state — fresh entity has neutral multipliers', () => {
    it('BuffComponent defaults should be at neutral (1.0 / 0) with no buffs applied', () => {
      const comp = buffComp();
      expect(comp.damageMultiplier).toBe(1.0);
      expect(comp.damageReduction).toBe(0);
      expect(comp.criticalChance).toBe(0);
      expect(comp.criticalMultiplier).toBe(1.0);
      expect(comp.speedMultiplier).toBe(1.0);
      expect(comp.fireRateMultiplier).toBe(1.0);
      expect(comp.healingMultiplier).toBe(1.0);
      expect(comp.experienceMultiplier).toBe(1.0);
    });
  });
});
