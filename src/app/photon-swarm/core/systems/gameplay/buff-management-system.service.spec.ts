import { TestBed } from '@angular/core/testing';
import { BatchBuffResult, BUFF_CONSTANTS, BuffDefinition, BuffEvent, BuffManagementSystemService } from '../gameplay';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { BuffComponent } from '@photon/components/buff.component';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';

describe('BuffManagementSystemService - Improved Version Tests', () => {
  let service: BuffManagementSystemService;
  let entityManager: EntityManagerService;
  let debugLog: jasmine.SpyObj<DebugLogBridgeService>;
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
    debugLog = TestBed.inject(DebugLogBridgeService) as jasmine.SpyObj<DebugLogBridgeService>;

    // Create test entity
    testEntity = entityManager.createEntity();

    // Mock window.performance.now() for consistent testing
    let mockTime = 0;
    spyOn(window.performance, 'now').and.callFake(() => mockTime++);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('Improved Features', () => {
    describe('Buff ID Validation', () => {
      it('should reject invalid buff IDs', () => {
        const invalidBuff: BuffDefinition = {
          id: 'Invalid-Buff!', // Invalid characters
          name: 'Invalid',
          description: 'Should fail',
          duration: 5000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 100,
          effects: {},
        };

        service.registerBuff(invalidBuff);

        // Should log error
        expect(debugLog.log).toHaveBeenCalledWith(
          jasmine.stringContaining('Invalid buff ID format'),
          'error',
          jasmine.any(Object)
        );

        // Should not be registered
        const applied = service.applyBuff(testEntity, 'Invalid-Buff!', entityManager);
        expect(applied).toBe(false);
      });

      it('should accept valid buff IDs', () => {
        const validIds = ['damage_boost', 'shield2', 'super_speed', 'a', 'buff123'];

        validIds.forEach((id) => {
          service.registerBuff({
            id,
            name: id,
            description: 'Valid buff',
            duration: 1000,
            stackable: false,
            maxStacks: 1,
            category: 'utility',
            priority: 100,
            effects: {},
          });

          const applied = service.applyBuff(testEntity, id, entityManager);
          expect(applied).toBe(true);
        });
      });
    });

    describe('Priority-based Conflicts', () => {
      beforeEach(() => {
        // Create buffs with different priorities
        service.registerBuff({
          id: 'high_priority_buff',
          name: 'High Priority',
          description: 'Priority 200',
          duration: 5000,
          stackable: false,
          maxStacks: 1,
          category: 'offensive',
          priority: 200,
          effects: { damageMultiplier: 2.0 },
        });

        service.registerBuff({
          id: 'low_priority_buff',
          name: 'Low Priority',
          description: 'Priority 50',
          duration: 5000,
          stackable: false,
          maxStacks: 1,
          category: 'offensive',
          priority: 50,
          effects: { damageMultiplier: 1.5 },
        });

        // Add conflict between them
        service.addConflictRule('high_priority_buff', 'low_priority_buff');
      });

      it('should block lower priority buffs', () => {
        // Apply high priority first
        service.applyBuff(testEntity, 'high_priority_buff', entityManager);

        // Try to apply low priority
        const applied = service.applyBuff(testEntity, 'low_priority_buff', entityManager);

        expect(applied).toBe(false);
        expect(service.hasBuff(testEntity, 'high_priority_buff')).toBe(true);
        expect(service.hasBuff(testEntity, 'low_priority_buff')).toBe(false);
      });

      it('should replace lower priority buffs with higher', () => {
        // Apply low priority first
        service.applyBuff(testEntity, 'low_priority_buff', entityManager);

        // Apply high priority - should replace
        service.applyBuff(testEntity, 'high_priority_buff', entityManager);

        expect(service.hasBuff(testEntity, 'high_priority_buff')).toBe(true);
        expect(service.hasBuff(testEntity, 'low_priority_buff')).toBe(false);
      });

      it('should use default priority when not specified', () => {
        service.registerBuff({
          id: 'default_priority',
          name: 'Default',
          description: 'No priority set',
          duration: 1000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 0, // Using default priority
          effects: {},
        });

        service.applyBuff(testEntity, 'default_priority', entityManager);
        const buffs = service.getEntityBuffs(testEntity);

        // Buff should be applied with default priority
        expect(buffs.length).toBe(1);
      });
    });

    describe('Batch Operations', () => {
      it('should apply multiple buffs efficiently', () => {
        const buffIds = ['damage_boost', 'speed_boost', 'shield'];

        const results = service.applyMultipleBuffs(testEntity, buffIds, entityManager);

        // All should succeed
        expect(results.length).toBe(3);
        results.forEach((result) => {
          expect(result.success).toBe(true);
        });

        // All buffs should be active
        buffIds.forEach((id) => {
          expect(service.hasBuff(testEntity, id)).toBe(true);
        });

        // Effects should be combined correctly
        const buffComponent = entityManager.getComponent(testEntity, BuffComponent)!;
        expect(buffComponent.damageMultiplier).toBe(1.5);
        expect(buffComponent.speedMultiplier).toBe(1.3);
        expect(buffComponent.damageReduction).toBe(0.3);
      });

      it('should emit batch event', (done) => {
        service.onBuffEvent('batch_applied', (event: BuffEvent) => {
          expect(event.type).toBe('batch_applied');
          expect(event.buffId).toBe('multiple');

          const results = event.details?.['results'] as BatchBuffResult[];
          expect(results.length).toBe(3);
          done();
        });

        service.applyMultipleBuffs(testEntity, ['damage_boost', 'speed_boost', 'shield'], entityManager);
      });

      it('should handle mixed success/failure in batch', () => {
        const buffIds = ['damage_boost', 'invalid_buff', 'speed_boost'];

        const results = service.applyMultipleBuffs(testEntity, buffIds, entityManager);

        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(false);
        expect(results[1].reason).toBe('Unknown buff');
        expect(results[2].success).toBe(true);
      });

      it('should update effects only once for batch', () => {
        // Spy on updateBuffEffects to count calls

        const updateSpy = spyOn<any>(service, 'updateBuffEffects').and.callThrough();

        service.applyMultipleBuffs(testEntity, ['damage_boost', 'speed_boost', 'shield'], entityManager);

        // Should be called only once at the end
        expect(updateSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe('Memory Management', () => {
      it('should track buff usage', () => {
        // Apply buff to multiple entities
        const entity1 = entityManager.createEntity();
        const entity2 = entityManager.createEntity();

        service.applyBuff(entity1, 'damage_boost', entityManager);
        service.applyBuff(entity2, 'damage_boost', entityManager);

        const stats = service.getDebugStats();
        expect(stats.buffsInUse['damage_boost']).toBe(2);
      });

      it('should prevent unregistering buffs in use', () => {
        service.applyBuff(testEntity, 'damage_boost', entityManager);

        const unregistered = service.unregisterBuff('damage_boost');

        expect(unregistered).toBe(false);
        expect(debugLog.log).toHaveBeenCalledWith(
          jasmine.stringContaining('Cannot unregister buff in use'),
          'warning',
          jasmine.any(Object)
        );
      });

      it('should allow unregistering unused buffs', () => {
        // Register a custom buff
        service.registerBuff({
          id: 'unused_buff',
          name: 'Unused',
          description: 'Never applied',
          duration: 1000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 100,
          effects: {},
        });

        const unregistered = service.unregisterBuff('unused_buff');

        expect(unregistered).toBe(true);

        // Should not be applicable anymore
        const applied = service.applyBuff(testEntity, 'unused_buff', entityManager);
        expect(applied).toBe(false);
      });

      it('should update usage count when buffs expire', () => {
        service.applyBuff(testEntity, 'damage_boost', entityManager);

        let stats = service.getDebugStats();
        expect(stats.buffsInUse['damage_boost']).toBe(1);

        // Expire the buff
        (window.performance.now as jasmine.Spy).and.returnValue(11000);
        service.update(16, entityManager);

        stats = service.getDebugStats();
        expect(stats.buffsInUse['damage_boost']).toBeUndefined();
      });
    });

    describe('Optimized Effect Updates', () => {
      it('should only update changed effects', () => {
        // Apply initial buff
        service.applyBuff(testEntity, 'damage_boost', entityManager);

        const buffComponent = entityManager.getComponent(testEntity, BuffComponent)!;
        const initialSpeed = buffComponent.speedMultiplier;

        // Try to apply damage_boost again — it is now non-stackable (maxStacks: 1)
        // so the second apply is a no-op
        service.applyBuff(testEntity, 'damage_boost', entityManager);

        // Speed should not have been recalculated
        expect(buffComponent.speedMultiplier).toBe(initialSpeed);

        // Damage should remain at single-stack value (1.5) since stacking is disabled
        expect(buffComponent.damageMultiplier).toBe(1.5);
      });

      it('should handle effect-specific updates in batch', () => {
        // Create buffs affecting different stats
        service.registerBuff({
          id: 'damage_only',
          name: 'Damage Only',
          description: 'Only affects damage',
          duration: 5000,
          stackable: false,
          maxStacks: 1,
          category: 'offensive',
          priority: 100,
          effects: { damageMultiplier: 2.0 },
        });

        service.registerBuff({
          id: 'speed_only',
          name: 'Speed Only',
          description: 'Only affects speed',
          duration: 5000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 100,
          effects: { speedMultiplier: 2.0 },
        });

        // Apply in batch
        service.applyMultipleBuffs(testEntity, ['damage_only', 'speed_only'], entityManager);

        const buffComponent = entityManager.getComponent(testEntity, BuffComponent)!;
        expect(buffComponent.damageMultiplier).toBe(2.0);
        expect(buffComponent.speedMultiplier).toBe(2.0);
        // Other multipliers should remain at base
        expect(buffComponent.fireRateMultiplier).toBe(1.0);
      });
    });

    describe('Constants and Limits', () => {
      it('should respect maximum damage reduction', () => {
        // Create overpowered shield buff
        service.registerBuff({
          id: 'super_shield',
          name: 'Super Shield',
          description: '60% reduction per stack',
          duration: 5000,
          stackable: true,
          maxStacks: 3,
          category: 'defensive',
          priority: 100,
          effects: { damageReduction: 0.6 },
        });

        // Apply multiple times
        service.applyBuff(testEntity, 'super_shield', entityManager);
        service.applyBuff(testEntity, 'super_shield', entityManager);

        const buffComponent = entityManager.getComponent(testEntity, BuffComponent)!;
        expect(buffComponent.damageReduction).toBe(BUFF_CONSTANTS.MAX_DAMAGE_REDUCTION);
      });

      it('should clamp speed multipliers', () => {
        // Create extreme slow debuff
        service.registerBuff({
          id: 'extreme_slow',
          name: 'Extreme Slow',
          description: '95% slow',
          duration: 1000,
          stackable: false,
          maxStacks: 1,
          category: 'debuff',
          priority: 50,
          effects: { speedMultiplier: 0.05 },
        });

        service.applyBuff(testEntity, 'extreme_slow', entityManager);

        const buffComponent = entityManager.getComponent(testEntity, BuffComponent)!;
        expect(buffComponent.speedMultiplier).toBe(BUFF_CONSTANTS.MIN_SPEED_MULTIPLIER);
      });

      it('should respect critical chance cap', () => {
        // Create high crit buff
        service.registerBuff({
          id: 'mega_crit',
          name: 'Mega Crit',
          description: '150% crit chance',
          duration: 1000,
          stackable: false,
          maxStacks: 1,
          category: 'offensive',
          priority: 100,
          effects: { criticalChance: 1.5 },
        });

        service.applyBuff(testEntity, 'mega_crit', entityManager);

        const buffComponent = entityManager.getComponent(testEntity, BuffComponent)!;
        expect(buffComponent.criticalChance).toBe(BUFF_CONSTANTS.MAX_CRITICAL_CHANCE);
      });
    });

    describe('Enhanced Logging', () => {
      it('should use different log levels', () => {
        // Error log for invalid buff ID
        service.registerBuff({
          id: '!!!invalid',
          name: 'Bad',
          description: 'Invalid',
          duration: 1000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 100,
          effects: {},
        });

        expect(debugLog.log).toHaveBeenCalledWith(jasmine.any(String), 'error', jasmine.any(Object));

        // Warn log for unknown buff
        service.applyBuff(testEntity, 'nonexistent', entityManager);

        expect(debugLog.log).toHaveBeenCalledWith(jasmine.any(String), 'warning', jasmine.any(Object));

        // Info log for successful registration
        service.registerBuff({
          id: 'valid_buff',
          name: 'Valid',
          description: 'Valid',
          duration: 1000,
          stackable: false,
          maxStacks: 1,
          category: 'utility',
          priority: 100,
          effects: {},
        });

        expect(debugLog.log).toHaveBeenCalledWith(
          jasmine.stringContaining('Buff registered'),
          'info',
          jasmine.any(Object)
        );
      });

      it('should respect log frequency for common events', () => {
        // Mock random to control logging
        const randomSpy = spyOn(Math, 'random');

        // First call - log (random < 0.1)
        randomSpy.and.returnValue(0.05);
        service.applyBuff(testEntity, 'damage_boost', entityManager);

        const logCalls = debugLog.log.calls.count();

        // Second call - don't log (random >= 0.1)
        randomSpy.and.returnValue(0.5);
        service.applyBuff(entityManager.createEntity(), 'damage_boost', entityManager);

        // Should not have logged the second application
        expect(debugLog.log.calls.count()).toBe(logCalls);
      });
    });

    describe('Performance Tests', () => {
      it('should handle 100+ entities with multiple buffs at 60fps', () => {
        // Fix time at 0 to prevent buff expiration during test
        (window.performance.now as jasmine.Spy).and.returnValue(0);

        const entities: number[] = [];

        // Create 100 entities
        for (let i = 0; i < 100; i++) {
          entities.push(entityManager.createEntity());
        }

        // Apply multiple buffs to each entity
        for (const entity of entities) {
          service.applyMultipleBuffs(entity, ['damage_boost', 'speed_boost', 'shield'], entityManager);
        }

        // Run update loop (simulate 60fps)
        const frameTime = 16.67; // ~60fps
        for (let frame = 0; frame < 60; frame++) {
          service.update(frameTime, entityManager);
        }

        // Verify all entities still have buffs
        for (const entity of entities) {
          expect(service.hasBuff(entity, 'damage_boost')).toBe(true);
          expect(service.hasBuff(entity, 'speed_boost')).toBe(true);
          expect(service.hasBuff(entity, 'shield')).toBe(true);
        }

        // Check performance stats
        const stats = service.getDebugStats();
        expect(stats.totalBuffedEntities).toBe(100);
        expect(stats.totalActiveBuffs).toBe(300); // 3 buffs per entity
      });

      it('should efficiently handle buff expiration for many entities', () => {
        // Fix time at 0 during buff creation so all buffs have the same startTime
        (window.performance.now as jasmine.Spy).and.returnValue(0);

        // Create 50 entities with short-lived buffs
        const entities: number[] = [];
        for (let i = 0; i < 50; i++) {
          const entity = entityManager.createEntity();
          entities.push(entity);

          // Apply short duration buff
          service.registerBuff({
            id: `temp_buff_${i}`,
            name: `Temp ${i}`,
            description: 'Short lived',
            duration: 100, // 100ms
            stackable: false,
            maxStacks: 1,
            category: 'utility',
            priority: 100,
            effects: { speedMultiplier: 1.1 },
          });

          service.applyBuff(entity, `temp_buff_${i}`, entityManager);
        }

        // Fast forward time past buff duration (startTime=0, duration=100, currentTime=200 -> elapsed=200 >= 100)
        (window.performance.now as jasmine.Spy).and.returnValue(200);

        // Update should handle all expirations efficiently
        service.update(16, entityManager);

        // Verify all buffs expired
        for (let i = 0; i < 50; i++) {
          expect(service.hasBuff(entities[i], `temp_buff_${i}`)).toBe(false);
        }

        const stats = service.getDebugStats();
        expect(stats.totalBuffedEntities).toBe(0);
        expect(stats.totalActiveBuffs).toBe(0);
      });
    });
  });
});
