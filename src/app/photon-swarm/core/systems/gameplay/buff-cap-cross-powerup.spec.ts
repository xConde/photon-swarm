import { TestBed } from '@angular/core/testing';
import { BUFF_CONSTANTS, BuffDefinition, BuffManagementSystemService } from '../gameplay';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { BuffComponent } from '@photon/components/buff.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

describe('BuffManagementSystemService — multiplier caps & cross-powerup interaction', () => {
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

    testEntity = entityManager.createEntity();
    entityManager.addComponent(testEntity, new BuffComponent());

    spyOn(window.performance, 'now').and.returnValue(0);
  });

  afterEach(() => {
    entityManager.clear();
  });

  function buffComp(): BuffComponent {
    const comp = entityManager.getComponent(testEntity, BuffComponent);
    if (!comp) throw new Error('BuffComponent missing on testEntity');
    return comp;
  }

  // ---------------------------------------------------------------------------
  // Section 1: Damage multiplier cap enforcement
  // ---------------------------------------------------------------------------

  describe('Section 1: Damage multiplier cap enforcement', () => {
    it('1a — all three damage buffs combined (1.5 * 2.0 * 3.0 = 9.0) should stay UNDER the cap', () => {
      // damage_boost (1.5) * damage_boost_2x (2.0) * damage_boost_3x (3.0) = 9.0
      // This must be strictly below MAX_DAMAGE_MULTIPLIER (10.0) — not clamped
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      const expected = 1.5 * 2.0 * 3.0; // 9.0
      expect(buffComp().damageMultiplier).toBeCloseTo(expected, 5);
      expect(buffComp().damageMultiplier).toBeLessThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
    });

    it('1b — custom high-damage buff that alone would exceed 10.0 should clamp to MAX_DAMAGE_MULTIPLIER', () => {
      // Register a single buff with a 15x multiplier — must be clamped to 10.0
      const overDef: BuffDefinition = {
        id: 'mega_damage',
        name: 'Mega Damage',
        description: 'Way over the cap',
        duration: 10000,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 100,
        effects: { damageMultiplier: 15.0 },
      };
      service.registerBuff(overDef);
      service.applyBuff(testEntity, 'mega_damage', entityManager);

      expect(buffComp().damageMultiplier).toBe(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
      expect(buffComp().damageMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
    });

    it('1c — stackable 2.5x buff: stack 2 (6.25) stays under cap, stack 3 (15.625) clamps to 10.0', () => {
      // Register a stackable 2.5x damage buff with maxStacks 5
      const stackDef: BuffDefinition = {
        id: 'stacking_damage',
        name: 'Stacking Damage',
        description: '2.5x per stack, stacks exponentially',
        duration: 60000,
        stackable: true,
        maxStacks: 5,
        category: 'offensive',
        priority: 100,
        effects: { damageMultiplier: 2.5 },
      };
      service.registerBuff(stackDef);

      // 1 stack: 2.5^1 = 2.5
      service.applyBuff(testEntity, 'stacking_damage', entityManager);
      expect(buffComp().damageMultiplier).toBeCloseTo(2.5, 5);

      // 2 stacks: 2.5^2 = 6.25 — under cap
      service.applyBuff(testEntity, 'stacking_damage', entityManager);
      expect(buffComp().damageMultiplier).toBeCloseTo(6.25, 5);
      expect(buffComp().damageMultiplier).toBeLessThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);

      // 3 stacks: 2.5^3 = 15.625 — must clamp to 10.0
      service.applyBuff(testEntity, 'stacking_damage', entityManager);
      expect(buffComp().damageMultiplier).toBe(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
      expect(buffComp().damageMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
    });

    it('1d — after a cap-triggering buff expires, remaining buffs recalculate correctly below cap', () => {
      // Apply all three built-in damage buffs first: total 1.5 * 2.0 * 3.0 = 9.0
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(9.0, 5);

      // Register a custom short-lived 2x buff that would push total to 18.0 → clamped to 10.0
      const shortDef: BuffDefinition = {
        id: 'short_boost',
        name: 'Short Boost',
        description: 'Short-lived extra damage',
        duration: 3000,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 100,
        effects: { damageMultiplier: 2.0 },
      };
      service.registerBuff(shortDef);
      service.applyBuff(testEntity, 'short_boost', entityManager);

      // With the cap in effect: 9.0 * 2.0 = 18.0 → clamped to 10.0
      expect(buffComp().damageMultiplier).toBe(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);

      // Advance time past short_boost duration (3000 ms) and trigger update
      (window.performance.now as jasmine.Spy).and.returnValue(3001);
      service.update(16, entityManager);

      // short_boost is gone — only the original three remain (9.0, under cap)
      expect(service.hasBuff(testEntity, 'short_boost')).toBe(false);
      expect(buffComp().damageMultiplier).toBeCloseTo(1.5 * 2.0 * 3.0, 5); // 9.0
      expect(buffComp().damageMultiplier).toBeLessThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 2: Fire rate multiplier cap
  // ---------------------------------------------------------------------------

  describe('Section 2: Fire rate multiplier cap enforcement', () => {
    it('2a — stackable 1.8x fire-rate buff: 3 stacks (1.8^3 = 5.832) should clamp to MAX_FIRE_RATE_MULTIPLIER (5.0)', () => {
      // Register a stackable fire rate buff that will exceed the cap at 3 stacks
      const frDef: BuffDefinition = {
        id: 'stacking_fire_rate',
        name: 'Stacking Fire Rate',
        description: '1.8x fire rate per stack, stacks exponentially',
        duration: 60000,
        stackable: true,
        maxStacks: 5,
        category: 'offensive',
        priority: 100,
        effects: { fireRateMultiplier: 1.8 },
      };
      service.registerBuff(frDef);

      // 1 stack: 1.8^1 = 1.8
      service.applyBuff(testEntity, 'stacking_fire_rate', entityManager);
      expect(buffComp().fireRateMultiplier).toBeCloseTo(Math.pow(1.8, 1), 5);

      // 2 stacks: 1.8^2 = 3.24 — under cap
      service.applyBuff(testEntity, 'stacking_fire_rate', entityManager);
      expect(buffComp().fireRateMultiplier).toBeCloseTo(Math.pow(1.8, 2), 5);
      expect(buffComp().fireRateMultiplier).toBeLessThan(BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER);

      // 3 stacks: 1.8^3 = 5.832 — must clamp to 5.0
      service.applyBuff(testEntity, 'stacking_fire_rate', entityManager);
      expect(buffComp().fireRateMultiplier).toBe(BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER);
      expect(buffComp().fireRateMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER);
    });

    it('2b — fire rate multiplier never exceeds cap regardless of stacks applied', () => {
      const extremeFrDef: BuffDefinition = {
        id: 'extreme_fire_rate',
        name: 'Extreme Fire Rate',
        description: 'Very high fire rate multiplier',
        duration: 60000,
        stackable: true,
        maxStacks: 10,
        category: 'offensive',
        priority: 100,
        effects: { fireRateMultiplier: 3.0 },
      };
      service.registerBuff(extremeFrDef);

      for (let i = 0; i < 5; i++) {
        service.applyBuff(testEntity, 'extreme_fire_rate', entityManager);
      }

      expect(buffComp().fireRateMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 3: Cross-powerup zone interaction
  // ---------------------------------------------------------------------------

  describe('Section 3: Cross-powerup zone interaction (multiple zone collections)', () => {
    it('3a — Berserker zone (damage_boost_2x) + Overcharge zone (damage_boost) = 2.0 * 1.5 = 3.0x composite', () => {
      // Simulates collecting the Berserker powerup zone followed by Overcharge zone
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager); // Berserker: 2.0x
      service.applyBuff(testEntity, 'damage_boost', entityManager); // Overcharge: 1.5x

      const expected = 2.0 * 1.5; // 3.0
      expect(buffComp().damageMultiplier).toBeCloseTo(expected, 5);

      // Verify both zone buffs are active
      expect(service.hasBuff(testEntity, 'damage_boost_2x')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
    });

    it('3b — Fury zone (damage_boost_3x) + Velocity zone (speed_boost) affect independent stats correctly', () => {
      // Simulates collecting Fury and Velocity zones simultaneously
      // These are different stat categories and must not interfere with each other
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager); // Fury: 3.0x damage
      service.applyBuff(testEntity, 'speed_boost', entityManager); // Velocity: 1.3x speed

      expect(buffComp().damageMultiplier).toBeCloseTo(3.0, 5);
      expect(buffComp().speedMultiplier).toBeCloseTo(1.3, 5);

      // The damage buff should not affect speed and vice versa
      expect(buffComp().speedMultiplier).not.toBeCloseTo(3.0, 1);
      expect(buffComp().damageMultiplier).not.toBeCloseTo(1.3, 1);
    });

    it('3c — all three damage zones + shield zone + speed zone: verify all composite stats', () => {
      // Simulates collecting all powerup zones in a single run
      // damage_boost (1.5) * damage_boost_2x (2.0) * damage_boost_3x (3.0) = 9.0
      // shield: 0.3 damage reduction
      // speed_boost: 1.3x speed
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);
      service.applyBuff(testEntity, 'shield', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      const comp = buffComp();

      // Damage: 1.5 * 2.0 * 3.0 = 9.0 (under cap of 10.0)
      expect(comp.damageMultiplier).toBeCloseTo(9.0, 5);
      expect(comp.damageMultiplier).toBeLessThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);

      // Shield: additive 0.3 reduction at 1 stack
      expect(comp.damageReduction).toBeCloseTo(0.3, 5);

      // Speed: 1.3^1 = 1.3 at 1 stack
      expect(comp.speedMultiplier).toBeCloseTo(1.3, 5);

      // All five zones must be registered as active
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost_2x')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost_3x')).toBe(true);
      expect(service.hasBuff(testEntity, 'shield')).toBe(true);
      expect(service.hasBuff(testEntity, 'speed_boost')).toBe(true);
    });

    it('3d — damage zones + fire rate zone + experience zone: all caps respected simultaneously', () => {
      // Simulates collecting zones across all major buff categories at once
      // Damage: 1.5 * 2.0 * 3.0 = 9.0 (under cap)
      // Fire rate: 2.0 (under MAX_FIRE_RATE_MULTIPLIER of 5.0)
      // Experience: 2.0 (under MAX_EXPERIENCE_MULTIPLIER of 10.0)
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);
      service.applyBuff(testEntity, 'rapid_fire', entityManager);
      service.applyBuff(testEntity, 'experience_boost', entityManager);

      const comp = buffComp();

      // All multipliers must be at or below their respective caps
      expect(comp.damageMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
      expect(comp.fireRateMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER);
      expect(comp.experienceMultiplier).not.toBeGreaterThan(BUFF_CONSTANTS.MAX_EXPERIENCE_MULTIPLIER);

      // Verify exact composite values (all below their caps)
      expect(comp.damageMultiplier).toBeCloseTo(1.5 * 2.0 * 3.0, 5); // 9.0
      expect(comp.fireRateMultiplier).toBeCloseTo(2.0, 5);
      expect(comp.experienceMultiplier).toBeCloseTo(2.0, 5);

      // Unrelated stats must remain at neutral base values
      expect(comp.speedMultiplier).toBe(1.0);
      expect(comp.damageReduction).toBe(0);
      expect(comp.criticalChance).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 4: Cap interaction with buff expiry
  // ---------------------------------------------------------------------------

  describe('Section 4: Cap interaction with expiry recalculation', () => {
    it('4a — adding a 4th damage buff on top of 9.0 clamps to 10.0; after it expires, recalculates to 9.0', () => {
      // Step 1: apply three built-in damage buffs, total = 9.0 (under cap)
      (window.performance.now as jasmine.Spy).and.returnValue(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(9.0, 5);

      // Step 2: register a custom 2x buff with a short 2-second duration and apply it
      // 9.0 * 2.0 = 18.0 → must clamp to MAX_DAMAGE_MULTIPLIER (10.0)
      const burstDef: BuffDefinition = {
        id: 'burst_damage',
        name: 'Burst Damage',
        description: 'Short 2x damage burst',
        duration: 2000,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 100,
        effects: { damageMultiplier: 2.0 },
      };
      service.registerBuff(burstDef);
      service.applyBuff(testEntity, 'burst_damage', entityManager);

      // While burst is active, cap should be hit
      expect(buffComp().damageMultiplier).toBe(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);
      expect(service.hasBuff(testEntity, 'burst_damage')).toBe(true);

      // Step 3: advance time past burst_damage duration (2000 ms) and trigger update
      (window.performance.now as jasmine.Spy).and.returnValue(2001);
      service.update(16, entityManager);

      // burst_damage has expired — only the original three buffs remain
      expect(service.hasBuff(testEntity, 'burst_damage')).toBe(false);

      // Recalculation from the three remaining buffs: 1.5 * 2.0 * 3.0 = 9.0 (below cap)
      expect(buffComp().damageMultiplier).toBeCloseTo(9.0, 5);
      expect(buffComp().damageMultiplier).toBeLessThan(BUFF_CONSTANTS.MAX_DAMAGE_MULTIPLIER);

      // The three long-lived buffs must still be active (they outlast burst_damage)
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost_2x')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost_3x')).toBe(true);
    });

    it('4b — fire rate buff expiry restores base value after cap was active', () => {
      // Stack rapid_fire-equivalent to reach the cap, confirm cap, then let it expire
      const cappedFrDef: BuffDefinition = {
        id: 'capped_fire_rate',
        name: 'Capped Fire Rate',
        description: 'High fire rate that exceeds cap at 2 stacks',
        duration: 4000,
        stackable: true,
        maxStacks: 5,
        category: 'offensive',
        priority: 100,
        effects: { fireRateMultiplier: 3.0 }, // 3.0^2 = 9.0 → clamped to 5.0
      };

      (window.performance.now as jasmine.Spy).and.returnValue(0);
      service.registerBuff(cappedFrDef);
      service.applyBuff(testEntity, 'capped_fire_rate', entityManager);
      service.applyBuff(testEntity, 'capped_fire_rate', entityManager); // 3.0^2 = 9.0 → clamped

      expect(buffComp().fireRateMultiplier).toBe(BUFF_CONSTANTS.MAX_FIRE_RATE_MULTIPLIER);

      // Advance past expiry
      (window.performance.now as jasmine.Spy).and.returnValue(4001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'capped_fire_rate')).toBe(false);
      // All fire rate buffs gone — should reset to neutral 1.0
      expect(buffComp().fireRateMultiplier).toBeCloseTo(1.0, 5);
    });

    it('4c — multi-category zone buffs expire independently without corrupting other categories', () => {
      // Apply a short damage buff and a longer speed buff simultaneously
      const shortDamageDef: BuffDefinition = {
        id: 'short_damage_zone',
        name: 'Short Damage Zone',
        description: 'Expires at 1500ms',
        duration: 1500,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 100,
        effects: { damageMultiplier: 2.0 },
      };

      (window.performance.now as jasmine.Spy).and.returnValue(0);
      service.registerBuff(shortDamageDef);
      service.applyBuff(testEntity, 'short_damage_zone', entityManager); // expires at 1500ms
      service.applyBuff(testEntity, 'speed_boost', entityManager); // expires at 10000ms

      // Both active initially
      expect(buffComp().damageMultiplier).toBeCloseTo(2.0, 5);
      expect(buffComp().speedMultiplier).toBeCloseTo(1.3, 5);

      // Advance past short_damage_zone but NOT past speed_boost
      (window.performance.now as jasmine.Spy).and.returnValue(1501);
      service.update(16, entityManager);

      // Damage buff expired — damage resets to 1.0; speed buff still active — speed stays 1.3
      expect(service.hasBuff(testEntity, 'short_damage_zone')).toBe(false);
      expect(service.hasBuff(testEntity, 'speed_boost')).toBe(true);
      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
      expect(buffComp().speedMultiplier).toBeCloseTo(1.3, 5);
    });
  });
});
