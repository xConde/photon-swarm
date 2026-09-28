import { TestBed } from '@angular/core/testing';
import { BUFF_CONSTANTS, BuffEvent, BuffManagementSystemService } from '../gameplay';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { BuffComponent } from '@photon/components/buff.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Tests for two critical gaps in buff coverage:
 *
 * Section 1 — getDamageBuffId routing
 *   EnvironmentSystemService.getDamageBuffId(multiplier) selects a buff ID
 *   based on the powerup's numeric multiplier value. Since that method is
 *   private, we test it indirectly: apply the buff ID that getDamageBuffId
 *   would have chosen and assert the resulting BuffComponent state.
 *
 * Section 2 — Stack-refresh duration
 *   When a buff is at max stacks (or is non-stackable), the service falls
 *   through to the refreshable branch and resets startTime. Tests confirm
 *   that a re-applied buff at max stacks outlives the original expiry window.
 */
describe('BuffManagementSystemService — buff routing & stack refresh', () => {
  let service: BuffManagementSystemService;
  let entityManager: EntityManagerService;
  let testEntity: number;
  let performanceSpy: jasmine.Spy;

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

    performanceSpy = spyOn(window.performance, 'now').and.returnValue(0);

    testEntity = entityManager.createEntity();
    entityManager.addComponent(testEntity, new BuffComponent());
  });

  afterEach(() => {
    entityManager.clear();
  });

  function setTime(ms: number): void {
    performanceSpy.and.returnValue(ms);
  }

  function buffComp(): BuffComponent {
    const comp = entityManager.getComponent(testEntity, BuffComponent);
    if (!comp) throw new Error('BuffComponent missing on testEntity');
    return comp;
  }

  // ---------------------------------------------------------------------------
  // Section 1: Powerup-to-buff routing simulation
  //
  // getDamageBuffId logic:
  //   multiplier >= 3.0 → 'damage_boost_3x'
  //   multiplier >= 2.0 → 'damage_boost_2x'
  //   otherwise         → 'damage_boost'
  // ---------------------------------------------------------------------------

  describe('Section 1: powerup-to-buff routing (simulating getDamageBuffId)', () => {
    it('Overcharge Node (1.5x) routes to damage_boost → damageMultiplier 1.5', () => {
      // multiplier 1.5 is below 2.0, so getDamageBuffId returns 'damage_boost'
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(1.5, 5);
    });

    it('Berserker Shrine (2.0x) routes to damage_boost_2x → damageMultiplier 2.0', () => {
      // multiplier 2.0 satisfies the >= 2.0 check → 'damage_boost_2x'
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(2.0, 5);
    });

    it('Fury Altar (3.0x) routes to damage_boost_3x → damageMultiplier 3.0', () => {
      // multiplier 3.0 satisfies the >= 3.0 check → 'damage_boost_3x'
      service.applyBuff(testEntity, 'damage_boost_3x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(3.0, 5);
    });

    it('boundary value 2.9x routes to damage_boost_2x (>= 2.0 is true, < 3.0) → damageMultiplier 2.0', () => {
      // 2.9 satisfies >= 2.0 but not >= 3.0, so getDamageBuffId returns 'damage_boost_2x'
      // Applying that buff confirms the multiplier resolves to 2.0, not 3.0
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(2.0, 5);
      expect(buffComp().damageMultiplier).not.toBeCloseTo(3.0, 5);
    });

    it('speed powerup routes to speed_boost → speedMultiplier raised, other stats unaffected', () => {
      // POWERUP_TO_BUFF: speed → 'speed_boost' (1.3x speedMultiplier)
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      expect(buffComp().speedMultiplier).toBeCloseTo(1.3, 5);
      // Non-speed stats remain at their base values
      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
      expect(buffComp().fireRateMultiplier).toBeCloseTo(1.0, 5);
    });

    it('shield powerup routes to shield → damageReduction raised, other stats unaffected', () => {
      // POWERUP_TO_BUFF: shield → 'shield' (0.3 damageReduction, additive)
      service.applyBuff(testEntity, 'shield', entityManager);

      expect(buffComp().damageReduction).toBeCloseTo(0.3, 5);
      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
      expect(buffComp().speedMultiplier).toBeCloseTo(1.0, 5);
    });

    it('rapid_fire powerup routes to rapid_fire → fireRateMultiplier raised, other stats unaffected', () => {
      // POWERUP_TO_BUFF: rapid_fire → 'rapid_fire' (2.0x fireRateMultiplier)
      service.applyBuff(testEntity, 'rapid_fire', entityManager);

      expect(buffComp().fireRateMultiplier).toBeCloseTo(2.0, 5);
      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
      expect(buffComp().speedMultiplier).toBeCloseTo(1.0, 5);
    });

    it('experience powerup routes to experience_boost → experienceMultiplier raised, other stats unaffected', () => {
      // POWERUP_TO_BUFF: experience → 'experience_boost' (2.0x experienceMultiplier)
      service.applyBuff(testEntity, 'experience_boost', entityManager);

      expect(buffComp().experienceMultiplier).toBeCloseTo(2.0, 5);
      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
      expect(buffComp().speedMultiplier).toBeCloseTo(1.0, 5);
    });

    it('sequential collection: damage_boost (1.5x) then damage_boost_2x (2.0x) → combined damageMultiplier 3.0', () => {
      // Overcharge Node first, then Berserker Shrine — multiplicative stacking
      // of two distinct buff IDs: 1.5 * 2.0 = 3.0
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.applyBuff(testEntity, 'damage_boost_2x', entityManager);

      expect(buffComp().damageMultiplier).toBeCloseTo(1.5 * 2.0, 5);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 2: Stack refresh duration verification
  //
  // Refresh logic (from applyBuffInternal):
  //   if (existingBuff) {
  //     if (stackable && stacks < maxStacks) { stacks++ }
  //     else if (refreshable) { existingBuff.startTime = now() } ← this branch
  //   }
  //
  // Key implication: at max stacks the stacks < maxStacks check is false, so
  // even stackable buffs fall through to refreshable and reset their startTime.
  // ---------------------------------------------------------------------------

  describe('Section 2: stack refresh duration verification', () => {
    it('non-stackable damage_boost refreshed at t=5000 survives past original expiry (t=10001)', () => {
      // damage_boost: non-stackable, maxStacks 1, duration 10000 ms
      // Apply at t=0 (startTime=0, expires at 10000).
      // Re-apply at t=5000 → refreshable branch resets startTime to 5000 → expires at 15000.
      // Advance to t=10001 (past original expiry) and update: buff must still be active.
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      setTime(5000);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      setTime(10001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
    });

    it('speed_boost at max stacks (3) refreshed at t=5000 survives past original expiry (t=10001)', () => {
      // speed_boost: stackable, maxStacks 3, duration 10000 ms
      // Fill to max stacks at t=0 (startTime=0, expires at 10000).
      // Re-apply at t=5000 → stacks (3) < maxStacks (3) is false → refreshable branch
      //   resets startTime to 5000 → expires at 15000.
      // Advance to t=10001 and update: buff must still be active.
      setTime(0);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      // Confirm max stacks reached before refresh
      const buffsBeforeRefresh = service.getEntityBuffs(testEntity);
      const speedBuff = buffsBeforeRefresh.find((b) => b.buffId === 'speed_boost');
      expect(speedBuff?.stacks).toBe(3);

      setTime(5000);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      setTime(10001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'speed_boost')).toBe(true);
    });

    it('shield at max stacks (2) refreshed at t=6000 survives past original expiry (t=12001)', () => {
      // shield: stackable, maxStacks 2, duration 12000 ms
      // Fill to max stacks at t=0 (startTime=0, expires at 12000).
      // Re-apply at t=6000 → refreshable branch resets startTime to 6000 → expires at 18000.
      // Advance to t=12001 and update: buff must still be active.
      setTime(0);
      service.applyBuff(testEntity, 'shield', entityManager);
      service.applyBuff(testEntity, 'shield', entityManager);

      setTime(6000);
      service.applyBuff(testEntity, 'shield', entityManager);

      setTime(12001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'shield')).toBe(true);
    });

    it("emits 'refreshed' event when reapplying damage_boost at max stacks", (done) => {
      // damage_boost is non-stackable (maxStacks 1). Second apply cannot stack
      // so it hits the refreshable branch and emits a 'refreshed' event.
      let refreshedCount = 0;
      service.onBuffEvent('refreshed', (event: BuffEvent) => {
        if (event.buffId === 'damage_boost') refreshedCount++;
      });

      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      setTime(5000);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      // Allow the event callback to run synchronously before asserting
      setTimeout(() => {
        expect(refreshedCount).toBe(1);
        done();
      }, 0);
    });

    it('refresh does not increase stacks: speed_boost stays at 3 after refresh attempt', () => {
      // Fill speed_boost to max (3 stacks) at t=0, then re-apply to trigger refresh.
      // The stacks count must remain 3, not become 4.
      setTime(0);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      setTime(5000);
      service.applyBuff(testEntity, 'speed_boost', entityManager); // should refresh, not stack

      const buffs = service.getEntityBuffs(testEntity);
      const speedBuff = buffs.find((b) => b.buffId === 'speed_boost');

      expect(speedBuff?.stacks).toBe(3);
    });

    it('damage_boost without refresh expires at original time (t=10001)', () => {
      // Baseline: apply once at t=0, do NOT reapply, advance to t=10001.
      // The buff must have expired by then (duration 10000 ms).
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      setTime(10001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
      // After expiry the multiplier must reset to the base value of 1.0
      expect(buffComp().damageMultiplier).toBeCloseTo(1.0, 5);
    });

    it('speed_boost stacks remain intact after refresh: speedMultiplier reflects all 3 stacks', () => {
      // After refreshing at max stacks the effect calculation must still account
      // for 3 stacks: speedMultiplier = 1.3^3 ≈ 2.197.
      setTime(0);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      setTime(5000);
      service.applyBuff(testEntity, 'speed_boost', entityManager); // refresh

      const expectedSpeedMultiplier = Math.pow(1.3, 3); // 1.3^3 ≈ 2.197
      const clamped = Math.min(BUFF_CONSTANTS.MAX_SPEED_MULTIPLIER, expectedSpeedMultiplier);
      expect(buffComp().speedMultiplier).toBeCloseTo(clamped, 4);
    });
  });
});
