import { TestBed } from '@angular/core/testing';
import { BuffEvent, BuffManagementSystemService } from '../gameplay';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { BuffComponent } from '@photon/components/buff.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

/**
 * Focused tests for buff expiry and conflict resolution.
 *
 * The service uses window.performance.now() for all time tracking — both
 * startTime (set on applyBuff) and currentTime (read on update). Tests
 * control the clock by spying on window.performance.now and returning
 * explicit values so apply-time and expiry-check-time are deterministic.
 */
describe('BuffManagementSystemService — Expiry & Conflict Resolution', () => {
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

    // Start the clock at 0 for all tests. Individual tests override as needed.
    performanceSpy = spyOn(window.performance, 'now').and.returnValue(0);

    testEntity = entityManager.createEntity();
  });

  afterEach(() => {
    entityManager.clear();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Set the clock to a specific value for the duration of a call. */
  function setTime(ms: number): void {
    performanceSpy.and.returnValue(ms);
  }

  // ---------------------------------------------------------------------------
  // 1. Buff expiry resets multiplier
  // ---------------------------------------------------------------------------

  describe('Buff expiry', () => {
    it('removes a timed buff and resets damageMultiplier after expiry', () => {
      // Apply damage_boost (duration 10000 ms, multiplier 1.5) at t=0
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp).toBeTruthy();
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.5);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);

      // Advance past expiry (10001 ms > 10000 ms duration)
      setTime(10001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.0);
    });

    it('does not remove a buff that has not yet expired', () => {
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      // Only 5000 ms elapsed — half the 10000 ms duration
      setTime(5000);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.5);
    });

    it('removes buff exactly at the duration boundary', () => {
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      // Elapsed === duration triggers expiry (elapsed >= duration)
      setTime(10000);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
    });

    it('clears active buff name from BuffComponent.activeBuffs on expiry', () => {
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp!.hasBuff('damage_boost')).toBe(true);

      setTime(10001);
      service.update(16, entityManager);

      expect(buffComp!.hasBuff('damage_boost')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Multiple buffs with different durations
  // ---------------------------------------------------------------------------

  describe('Multiple buff expiry at different times', () => {
    it('expires only the shorter-lived buff when time crosses its threshold', () => {
      // slow: 5000 ms, damage_boost: 10000 ms
      setTime(0);
      service.applyBuff(testEntity, 'slow', entityManager);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      expect(service.hasBuff(testEntity, 'slow')).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);

      // Advance past slow's expiry but not damage_boost's
      setTime(5001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'slow')).toBe(false);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
    });

    it('expires both buffs once time passes both durations', () => {
      setTime(0);
      service.applyBuff(testEntity, 'slow', entityManager);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      setTime(10001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'slow')).toBe(false);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
    });

    it('preserves BuffComponent multipliers for the surviving buff after partial expiry', () => {
      setTime(0);
      service.applyBuff(testEntity, 'slow', entityManager); // speedMultiplier: 0.5
      service.applyBuff(testEntity, 'damage_boost', entityManager); // damageMultiplier: 1.5

      setTime(5001);
      service.update(16, entityManager);

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      // slow is gone — speed should reset to 1.0
      expect(buffComp!.speedMultiplier).toBeCloseTo(1.0);
      // damage_boost still active
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.5);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Permanent buff never expires
  // ---------------------------------------------------------------------------

  describe('Permanent buff (duration -1)', () => {
    it('never expires regardless of elapsed time', () => {
      // Register a custom permanent buff (duration -1 → isPermanent = true)
      service.registerBuff({
        id: 'perm_damage',
        name: 'Permanent Damage',
        description: 'Never expires',
        duration: -1,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 100,
        effects: { damageMultiplier: 2.0 },
      });

      setTime(0);
      service.applyBuff(testEntity, 'perm_damage', entityManager);

      // Simulate one year of milliseconds
      setTime(365 * 24 * 60 * 60 * 1000);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'perm_damage')).toBe(true);
      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp!.damageMultiplier).toBeCloseTo(2.0);
    });

    it('marks the ActiveBuff as isPermanent', () => {
      service.registerBuff({
        id: 'perm_speed',
        name: 'Permanent Speed',
        description: 'Never expires',
        duration: -1,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 100,
        effects: { speedMultiplier: 1.5 },
      });

      setTime(0);
      service.applyBuff(testEntity, 'perm_speed', entityManager);

      const buffs = service.getEntityBuffs(testEntity);
      expect(buffs.length).toBe(1);
      expect(buffs[0].isPermanent).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Conflict: higher priority blocks lower
  // ---------------------------------------------------------------------------

  describe('Conflict resolution — higher priority blocks lower', () => {
    it('rejects weakness when damage_boost is already active', () => {
      // damage_boost (priority 100) conflicts with weakness (priority 60)
      // Conflict rule is pre-registered in initializeBuiltInBuffs()
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      const applied = service.applyBuff(testEntity, 'weakness', entityManager);

      expect(applied).toBe(false);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
      expect(service.hasBuff(testEntity, 'weakness')).toBe(false);
    });

    it('rejects slow when speed_boost is already active', () => {
      // speed_boost (priority 100) conflicts with slow (priority 50)
      setTime(0);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      const applied = service.applyBuff(testEntity, 'slow', entityManager);

      expect(applied).toBe(false);
      expect(service.hasBuff(testEntity, 'speed_boost')).toBe(true);
      expect(service.hasBuff(testEntity, 'slow')).toBe(false);
    });

    it('blocks a custom low-priority buff when a higher-priority conflicting buff is active', () => {
      service.registerBuff({
        id: 'hp_buff_a',
        name: 'A',
        description: '',
        duration: 5000,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 150,
        effects: { damageMultiplier: 2.0 },
      });
      service.registerBuff({
        id: 'lp_buff_b',
        name: 'B',
        description: '',
        duration: 5000,
        stackable: false,
        maxStacks: 1,
        category: 'offensive',
        priority: 50,
        effects: { damageMultiplier: 0.5 },
      });
      service.addConflictRule('hp_buff_a', 'lp_buff_b');

      setTime(0);
      service.applyBuff(testEntity, 'hp_buff_a', entityManager);
      const applied = service.applyBuff(testEntity, 'lp_buff_b', entityManager);

      expect(applied).toBe(false);
      expect(service.hasBuff(testEntity, 'hp_buff_a')).toBe(true);
      expect(service.hasBuff(testEntity, 'lp_buff_b')).toBe(false);
    });

    it('does not modify BuffComponent multipliers when a buff is blocked', () => {
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      const multiplierBeforeBlock = buffComp!.damageMultiplier;

      service.applyBuff(testEntity, 'weakness', entityManager);

      // weakness was blocked — multiplier must remain at damage_boost value
      expect(buffComp!.damageMultiplier).toBeCloseTo(multiplierBeforeBlock);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Conflict: lower priority removed by higher
  // ---------------------------------------------------------------------------

  describe('Conflict resolution — lower priority removed by higher', () => {
    it('removes weakness when damage_boost is applied after', () => {
      setTime(0);
      service.applyBuff(testEntity, 'weakness', entityManager);
      expect(service.hasBuff(testEntity, 'weakness')).toBe(true);

      service.applyBuff(testEntity, 'damage_boost', entityManager);

      expect(service.hasBuff(testEntity, 'weakness')).toBe(false);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
    });

    it('removes slow when speed_boost is applied after', () => {
      setTime(0);
      service.applyBuff(testEntity, 'slow', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      expect(service.hasBuff(testEntity, 'slow')).toBe(false);
      expect(service.hasBuff(testEntity, 'speed_boost')).toBe(true);
    });

    it('recalculates BuffComponent multipliers after removing the evicted buff', () => {
      // weakness sets damageMultiplier to 0.7; damage_boost should override to 1.5
      setTime(0);
      service.applyBuff(testEntity, 'weakness', entityManager);

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp!.damageMultiplier).toBeCloseTo(0.7);

      service.applyBuff(testEntity, 'damage_boost', entityManager);

      // weakness is gone, damage_boost active
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.5);
    });

    it('removes a custom low-priority buff when a conflicting high-priority buff arrives', () => {
      service.registerBuff({
        id: 'weak_debuff',
        name: 'Weak Debuff',
        description: '',
        duration: 5000,
        stackable: false,
        maxStacks: 1,
        category: 'debuff',
        priority: 30,
        effects: { speedMultiplier: 0.5 },
      });
      service.registerBuff({
        id: 'strong_buff',
        name: 'Strong Buff',
        description: '',
        duration: 5000,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 200,
        effects: { speedMultiplier: 2.0 },
      });
      service.addConflictRule('strong_buff', 'weak_debuff');

      setTime(0);
      service.applyBuff(testEntity, 'weak_debuff', entityManager);
      service.applyBuff(testEntity, 'strong_buff', entityManager);

      expect(service.hasBuff(testEntity, 'weak_debuff')).toBe(false);
      expect(service.hasBuff(testEntity, 'strong_buff')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Buff expiry during active stacks
  // ---------------------------------------------------------------------------

  describe('Buff expiry with stacks', () => {
    it('removes all stacks of a stackable buff on expiry', () => {
      // shield: stackable, maxStacks 2, damageReduction 0.3
      setTime(0);
      service.applyBuff(testEntity, 'shield', entityManager);
      service.applyBuff(testEntity, 'shield', entityManager); // second stack

      const buffs = service.getEntityBuffs(testEntity);
      expect(buffs.length).toBe(1);
      expect(buffs[0].stacks).toBe(2);

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      // 0.3 * 2 stacks = 0.6 damage reduction
      expect(buffComp!.damageReduction).toBeCloseTo(0.6);

      // shield duration is 12000 ms
      setTime(12001);
      service.update(16, entityManager);

      expect(service.hasBuff(testEntity, 'shield')).toBe(false);
      expect(buffComp!.damageReduction).toBeCloseTo(0);
    });

    it('retains remaining stacks count correctly before expiry', () => {
      // speed_boost: stackable, maxStacks 3
      setTime(0);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);
      service.applyBuff(testEntity, 'speed_boost', entityManager);

      const buffs = service.getEntityBuffs(testEntity);
      expect(buffs[0].stacks).toBe(3);

      // Time has not expired yet
      setTime(9999);
      service.update(16, entityManager);

      const buffsAfter = service.getEntityBuffs(testEntity);
      expect(buffsAfter.length).toBe(1);
      expect(buffsAfter[0].stacks).toBe(3);
    });

    it('resets all stacked multipliers to base on expiry', () => {
      setTime(0);
      service.applyBuff(testEntity, 'speed_boost', entityManager); // 1.3^1
      service.applyBuff(testEntity, 'speed_boost', entityManager); // 1.3^2

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      // multiplicative stacking: 1.3^2 ≈ 1.69
      expect(buffComp!.speedMultiplier).toBeCloseTo(1.3 * 1.3);

      // speed_boost duration is 10000 ms
      setTime(10001);
      service.update(16, entityManager);

      expect(buffComp!.speedMultiplier).toBeCloseTo(1.0);
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Rapid apply / remove cycles
  // ---------------------------------------------------------------------------

  describe('Rapid apply/remove cycles', () => {
    it('leaves no residual state after repeated apply/remove of the same buff', () => {
      setTime(0);

      for (let i = 0; i < 20; i++) {
        service.applyBuff(testEntity, 'damage_boost', entityManager);
        service.removeBuff(testEntity, 'damage_boost', entityManager);
      }

      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.0);
    });

    it('allows re-applying a buff after it was manually removed', () => {
      setTime(0);
      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.removeBuff(testEntity, 'damage_boost', entityManager);

      const applied = service.applyBuff(testEntity, 'damage_boost', entityManager);
      expect(applied).toBe(true);
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(true);
    });

    it('keeps usage counters consistent after rapid apply/remove', () => {
      setTime(0);

      for (let i = 0; i < 5; i++) {
        service.applyBuff(testEntity, 'rapid_fire', entityManager);
        service.removeBuff(testEntity, 'rapid_fire', entityManager);
      }

      // Finally apply once and check usage = 1
      service.applyBuff(testEntity, 'rapid_fire', entityManager);
      const stats = service.getDebugStats();
      expect(stats.buffsInUse['rapid_fire']).toBe(1);
    });

    it('handles alternating buffs on the same entity without corruption', () => {
      setTime(0);

      for (let i = 0; i < 10; i++) {
        service.applyBuff(testEntity, 'damage_boost', entityManager);
        service.removeBuff(testEntity, 'damage_boost', entityManager);
        service.applyBuff(testEntity, 'shield', entityManager);
        service.removeBuff(testEntity, 'shield', entityManager);
      }

      const buffComp = entityManager.getComponent(testEntity, BuffComponent);
      expect(buffComp!.damageMultiplier).toBeCloseTo(1.0);
      expect(buffComp!.damageReduction).toBeCloseTo(0);
      expect(service.getEntityBuffs(testEntity).length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Buff event callbacks
  // ---------------------------------------------------------------------------

  describe('Buff event callbacks', () => {
    it('fires the "applied" event with the correct buffId when a buff is applied', () => {
      setTime(0);
      const events: BuffEvent[] = [];
      service.onBuffEvent('applied', (e) => events.push(e));

      service.applyBuff(testEntity, 'damage_boost', entityManager);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('applied');
      expect(events[0].buffId).toBe('damage_boost');
      expect(events[0].entity).toBe(testEntity);
    });

    it('fires the "expired" event when a buff expires during update()', () => {
      setTime(0);
      const expiredEvents: BuffEvent[] = [];
      service.onBuffEvent('expired', (e) => expiredEvents.push(e));

      service.applyBuff(testEntity, 'damage_boost', entityManager);

      setTime(10001);
      service.update(16, entityManager);

      expect(expiredEvents.length).toBe(1);
      expect(expiredEvents[0].type).toBe('expired');
      expect(expiredEvents[0].buffId).toBe('damage_boost');
      expect(expiredEvents[0].entity).toBe(testEntity);
    });

    it('fires the "removed" event when a buff is manually removed', () => {
      setTime(0);
      const removedEvents: BuffEvent[] = [];
      service.onBuffEvent('removed', (e) => removedEvents.push(e));

      service.applyBuff(testEntity, 'damage_boost', entityManager);
      service.removeBuff(testEntity, 'damage_boost', entityManager);

      expect(removedEvents.length).toBe(1);
      expect(removedEvents[0].type).toBe('removed');
      expect(removedEvents[0].buffId).toBe('damage_boost');
    });

    it('fires the "stacked" event when a stackable buff gains a stack', () => {
      setTime(0);
      const stackedEvents: BuffEvent[] = [];
      service.onBuffEvent('stacked', (e) => stackedEvents.push(e));

      service.applyBuff(testEntity, 'shield', entityManager); // first apply — 'applied'
      service.applyBuff(testEntity, 'shield', entityManager); // second apply — 'stacked'

      expect(stackedEvents.length).toBe(1);
      expect(stackedEvents[0].buffId).toBe('shield');
    });

    it('does not fire an expired event when a permanent buff is active', () => {
      service.registerBuff({
        id: 'perm_test',
        name: 'Permanent Test',
        description: '',
        duration: -1,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 100,
        effects: {},
      });

      setTime(0);
      const expiredEvents: BuffEvent[] = [];
      service.onBuffEvent('expired', (e) => expiredEvents.push(e));

      service.applyBuff(testEntity, 'perm_test', entityManager);

      setTime(999_999_999);
      service.update(16, entityManager);

      expect(expiredEvents.length).toBe(0);
    });

    it('returns an unsubscribe function that stops further callbacks', () => {
      setTime(0);
      const events: BuffEvent[] = [];
      const unsubscribe = service.onBuffEvent('applied', (e) => events.push(e));

      service.applyBuff(testEntity, 'damage_boost', entityManager);
      expect(events.length).toBe(1);

      unsubscribe();

      // Apply to a second entity — no new event should fire
      const entity2 = entityManager.createEntity();
      service.applyBuff(entity2, 'shield', entityManager);
      expect(events.length).toBe(1); // still 1 — not called again
    });

    it('fires applied and expired events in correct sequence during a full buff lifecycle', () => {
      setTime(0);
      const sequence: string[] = [];
      service.onBuffEvent('applied', () => sequence.push('applied'));
      service.onBuffEvent('expired', () => sequence.push('expired'));

      service.applyBuff(testEntity, 'rapid_fire', entityManager);

      // rapid_fire duration: 8000 ms
      setTime(8001);
      service.update(16, entityManager);

      expect(sequence).toEqual(['applied', 'expired']);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. onExpire callback on buff definition
  // ---------------------------------------------------------------------------

  describe('onExpire callback in BuffDefinition', () => {
    it('calls onExpire when a buff expires via update()', () => {
      let expireCalled = false;
      let expireEntity = -1;

      service.registerBuff({
        id: 'callback_buff',
        name: 'Callback Buff',
        description: '',
        duration: 3000,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 100,
        effects: {},
        onExpire: (entity) => {
          expireCalled = true;
          expireEntity = entity;
        },
      });

      setTime(0);
      service.applyBuff(testEntity, 'callback_buff', entityManager);

      setTime(3001);
      service.update(16, entityManager);

      expect(expireCalled).toBe(true);
      expect(expireEntity).toBe(testEntity);
    });

    it('does not call onExpire when a permanent buff is active', () => {
      let expireCalled = false;

      service.registerBuff({
        id: 'perm_callback',
        name: 'Permanent Callback',
        description: '',
        duration: -1,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 100,
        effects: {},
        onExpire: () => {
          expireCalled = true;
        },
      });

      setTime(0);
      service.applyBuff(testEntity, 'perm_callback', entityManager);

      setTime(999_999_999);
      service.update(16, entityManager);

      expect(expireCalled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Edge cases
  // ---------------------------------------------------------------------------

  describe('Edge cases', () => {
    it('hasBuff returns false for an entity with no buffs', () => {
      expect(service.hasBuff(testEntity, 'damage_boost')).toBe(false);
    });

    it('getEntityBuffs returns an empty array for an entity with no buffs', () => {
      expect(service.getEntityBuffs(testEntity)).toEqual([]);
    });

    it('getBuffRemainingTime returns 0 for an unknown entity', () => {
      expect(service.getBuffRemainingTime(999, 'damage_boost')).toBe(0);
    });

    it('getBuffRemainingTime returns -1 for a permanent buff', () => {
      service.registerBuff({
        id: 'perm_remain',
        name: 'Permanent',
        description: '',
        duration: -1,
        stackable: false,
        maxStacks: 1,
        category: 'utility',
        priority: 100,
        effects: {},
      });

      setTime(0);
      service.applyBuff(testEntity, 'perm_remain', entityManager);

      // getBuffRemainingTime checks performance.now() at the moment of the call
      setTime(5000);
      const remaining = service.getBuffRemainingTime(testEntity, 'perm_remain');
      expect(remaining).toBe(-1);
    });

    it('update() on an entity with zero buffs does not throw', () => {
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('applying an unregistered buff returns false without throwing', () => {
      const result = service.applyBuff(testEntity, 'nonexistent_buff_xyz', entityManager);
      expect(result).toBe(false);
    });

    it('removeBuff on a non-active buff returns false without throwing', () => {
      const result = service.removeBuff(testEntity, 'damage_boost', entityManager);
      expect(result).toBe(false);
    });

    it('BuffComponent is created automatically if entity lacks one when buff is applied', () => {
      const bareEntity = entityManager.createEntity();
      // Do NOT manually add BuffComponent
      service.applyBuff(bareEntity, 'shield', entityManager);

      const buffComp = entityManager.getComponent(bareEntity, BuffComponent);
      expect(buffComp).toBeTruthy();
      expect(buffComp!.hasBuff('shield')).toBe(true);
    });
  });
});
