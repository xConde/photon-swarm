import { TestBed } from '@angular/core/testing';
import { EffectsSystemService } from './effects-system.service';
import { CONTROL_CONSTANTS } from '../controls/control-constants';

describe('EffectsSystemService', () => {
  let service: EffectsSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EffectsSystemService],
    });

    service = TestBed.inject(EffectsSystemService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should use centralized control constants', () => {
    expect(CONTROL_CONSTANTS.ACTION_NAMES.TARGET).toBe('Target');
  });

  // FIX: Tests for damageNumberMap memory leak prevention
  describe('damageNumberMap cleanup', () => {
    /**
     * Interface to access private members for testing
     */
    interface ServiceInternals {
      damageNumberMap: Map<string, number>;
      activeParticles: Array<{ id: string; isAlive: boolean }>;
      lastDamageMapCleanup: number;
      DAMAGE_MAP_CLEANUP_INTERVAL_MS: number;
      MAX_DAMAGE_MAP_SIZE: number;
      cleanupDamageNumberMap: () => void;
    }

    it('should have cleanup configuration', () => {
      const internals = service as unknown as ServiceInternals;

      // Verify cleanup constants are defined
      expect(internals.DAMAGE_MAP_CLEANUP_INTERVAL_MS).toBe(2000);
      expect(internals.MAX_DAMAGE_MAP_SIZE).toBe(200);
    });

    it('should clean up orphaned entries when map exceeds max size', () => {
      const internals = service as unknown as ServiceInternals;

      // Add orphaned entries (no corresponding active particles)
      for (let i = 0; i < 600; i++) {
        internals.damageNumberMap.set(`orphan-${i}`, i * 10);
      }

      expect(internals.damageNumberMap.size).toBe(600);

      // Run cleanup
      internals.cleanupDamageNumberMap();

      // All entries should be removed since there are no active particles
      expect(internals.damageNumberMap.size).toBe(0);
    });

    it('should preserve entries for active particles during cleanup', () => {
      const internals = service as unknown as ServiceInternals;

      // Add an active particle
      const activeParticle = { id: 'active-1', isAlive: true };
      internals.activeParticles.push(activeParticle as never);

      // Add entries - one matching active particle, others orphaned
      internals.damageNumberMap.set('active-1', 100);
      internals.damageNumberMap.set('orphan-1', 50);
      internals.damageNumberMap.set('orphan-2', 75);

      // Force cleanup by exceeding max size threshold
      for (let i = 0; i < 500; i++) {
        internals.damageNumberMap.set(`padding-${i}`, i);
      }

      // Run cleanup
      internals.cleanupDamageNumberMap();

      // Active particle entry should be preserved
      expect(internals.damageNumberMap.has('active-1')).toBe(true);
      expect(internals.damageNumberMap.get('active-1')).toBe(100);

      // Orphaned entries should be removed
      expect(internals.damageNumberMap.has('orphan-1')).toBe(false);
      expect(internals.damageNumberMap.has('orphan-2')).toBe(false);
    });

    it('should only cleanup when interval has passed', () => {
      const internals = service as unknown as ServiceInternals;

      // Set last cleanup to now
      internals.lastDamageMapCleanup = window.performance.now();

      // Add a few orphaned entries (below max size threshold)
      internals.damageNumberMap.set('orphan-1', 100);
      internals.damageNumberMap.set('orphan-2', 200);

      // Run cleanup - should NOT clean because interval hasn't passed
      internals.cleanupDamageNumberMap();

      // Entries should still exist (cleanup skipped)
      expect(internals.damageNumberMap.size).toBe(2);
    });

    it('should cleanup when interval has passed', () => {
      const internals = service as unknown as ServiceInternals;

      // Set last cleanup to 10 seconds ago (past the 5-second interval)
      internals.lastDamageMapCleanup = window.performance.now() - 10000;

      // Add orphaned entries
      internals.damageNumberMap.set('orphan-1', 100);
      internals.damageNumberMap.set('orphan-2', 200);

      // Run cleanup - should clean because interval has passed
      internals.cleanupDamageNumberMap();

      // Entries should be removed
      expect(internals.damageNumberMap.size).toBe(0);
    });

    it('should update lastDamageMapCleanup after cleanup runs', () => {
      const internals = service as unknown as ServiceInternals;

      // Set last cleanup to long ago (before the 5 second interval)
      internals.lastDamageMapCleanup = window.performance.now() - 10000;

      const beforeCleanup = window.performance.now();

      // Run cleanup
      internals.cleanupDamageNumberMap();

      const afterCleanup = window.performance.now();

      // lastDamageMapCleanup should be updated to approximately now
      expect(internals.lastDamageMapCleanup).toBeGreaterThanOrEqual(beforeCleanup);
      expect(internals.lastDamageMapCleanup).toBeLessThanOrEqual(afterCleanup);
    });
  });
});
