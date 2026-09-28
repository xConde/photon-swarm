import { SpawnMargins, WORLD_CONFIG, WorldBounds } from './world.config';
import { ENVIRONMENT_CONFIG } from './environment.config';

describe('World Configuration', () => {
  describe('WORLD_CONFIG', () => {
    it('should define world bounds', () => {
      expect(WORLD_CONFIG.BOUNDS).toBeDefined();
      expect(WORLD_CONFIG.BOUNDS.WIDTH).toBe(12000);
      expect(WORLD_CONFIG.BOUNDS.HEIGHT).toBe(9000);
    });

    it('should have positive dimensions', () => {
      expect(WORLD_CONFIG.BOUNDS.WIDTH).toBeGreaterThan(0);
      expect(WORLD_CONFIG.BOUNDS.HEIGHT).toBeGreaterThan(0);
    });

    it('should define spawn margins', () => {
      expect(WORLD_CONFIG.SPAWN_MARGINS).toBeDefined();
      expect(WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN).toBe(50);
      expect(WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN).toBe(200);
      expect(WORLD_CONFIG.SPAWN_MARGINS.ASTEROID_SPAWN_OFFSET).toBe(50);
    });

    it('should have logical margin relationships', () => {
      // Cleanup margin should be larger than boundary damage margin
      expect(WORLD_CONFIG.SPAWN_MARGINS.CLEANUP_MARGIN).toBeGreaterThan(
        WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN
      );
    });

    it('should be typed as readonly', () => {
      // TypeScript's readonly only enforces immutability at compile time, not runtime
      // The readonly typing is verified by the @ts-expect-error directive below
      // which proves that TypeScript would reject direct assignment without the override

      // Verify the expected values are set correctly
      expect(WORLD_CONFIG.BOUNDS.WIDTH).toBe(12000);
      expect(WORLD_CONFIG.BOUNDS.HEIGHT).toBe(9000);

      // Compile-time check: TypeScript enforces readonly on WORLD_CONFIG
      // This function is never called, but its existence proves readonly is enforced
      // If WORLD_CONFIG were not readonly, the @ts-expect-error would cause a compile error
      const _verifyReadonlyEnforcement = (): void => {
        // @ts-expect-error - Cannot assign to 'WIDTH' because it is a read-only property
        WORLD_CONFIG.BOUNDS.WIDTH = 1;
      };
      expect(_verifyReadonlyEnforcement).toBeDefined();
    });
  });

  describe('ENVIRONMENT_CONFIG', () => {
    describe('HAZARD_ZONES', () => {
      it('should define hazard zone properties', () => {
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.DEFAULT_COUNT).toBe(3);
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS).toBe(200);
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.DAMAGE_PER_SECOND).toBe(2.5);
      });

      it('should have positive damage and radius', () => {
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS).toBeGreaterThan(0);
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.DAMAGE_PER_SECOND).toBeGreaterThan(0);
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.DEFAULT_COUNT).toBeGreaterThan(0);
      });

      it('should have reasonable damage values', () => {
        // Should not instantly kill player (assuming ~100 health)
        // At 2.5 DPS, takes 40 seconds to kill
        expect(ENVIRONMENT_CONFIG.HAZARD_ZONES.DAMAGE_PER_SECOND).toBeLessThan(10);
      });
    });

    describe('VOID_STORM', () => {
      it('should define void storm properties', () => {
        expect(ENVIRONMENT_CONFIG.VOID_STORM.INTERVAL_MS).toBe(120000); // 2 minutes
        expect(ENVIRONMENT_CONFIG.VOID_STORM.DURATION_MS).toBe(8000); // 8 seconds
        expect(ENVIRONMENT_CONFIG.VOID_STORM.DAMAGE_PER_SECOND).toBe(5);
      });

      it('should have interval longer than duration', () => {
        expect(ENVIRONMENT_CONFIG.VOID_STORM.INTERVAL_MS).toBeGreaterThan(ENVIRONMENT_CONFIG.VOID_STORM.DURATION_MS);
      });

      it('should have more damage than hazard zones', () => {
        // Void storm should be more dangerous than static hazard zones
        expect(ENVIRONMENT_CONFIG.VOID_STORM.DAMAGE_PER_SECOND).toBeGreaterThan(
          ENVIRONMENT_CONFIG.HAZARD_ZONES.DAMAGE_PER_SECOND
        );
      });
    });

    describe('WORLD_BOUNDARY', () => {
      it('should define boundary damage', () => {
        expect(ENVIRONMENT_CONFIG.WORLD_BOUNDARY.DAMAGE_PER_SECOND).toBe(20);
      });

      it('should have highest damage (force players back)', () => {
        // Boundary should be most dangerous to keep players in bounds
        expect(ENVIRONMENT_CONFIG.WORLD_BOUNDARY.DAMAGE_PER_SECOND).toBeGreaterThan(
          ENVIRONMENT_CONFIG.VOID_STORM.DAMAGE_PER_SECOND
        );
        expect(ENVIRONMENT_CONFIG.WORLD_BOUNDARY.DAMAGE_PER_SECOND).toBeGreaterThan(
          ENVIRONMENT_CONFIG.HAZARD_ZONES.DAMAGE_PER_SECOND
        );
      });
    });

    describe('ASTEROID', () => {
      it('should define asteroid properties', () => {
        expect(ENVIRONMENT_CONFIG.ASTEROID.SPAWN_RATE_PER_SECOND).toBe(0.5);
        expect(ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MIN).toBe(20);
        expect(ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MAX).toBe(60);
        expect(ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MIN).toBe(50);
        expect(ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MAX).toBe(150);
        expect(ENVIRONMENT_CONFIG.ASTEROID.DAMAGE).toBe(15);
      });

      it('should have valid size ranges', () => {
        expect(ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MIN).toBeGreaterThan(0);
        expect(ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MAX).toBeGreaterThan(ENVIRONMENT_CONFIG.ASTEROID.SIZE_RANGE.MIN);
      });

      it('should have valid speed ranges', () => {
        expect(ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MIN).toBeGreaterThan(0);
        expect(ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MAX).toBeGreaterThan(
          ENVIRONMENT_CONFIG.ASTEROID.SPEED_RANGE.MIN
        );
      });

      it('should have positive damage', () => {
        expect(ENVIRONMENT_CONFIG.ASTEROID.DAMAGE).toBeGreaterThan(0);
      });
    });
  });

  describe('Type Definitions', () => {
    it('should export WorldBounds interface', () => {
      const bounds: WorldBounds = {
        WIDTH: 1000,
        HEIGHT: 800,
      };
      expect(bounds.WIDTH).toBe(1000);
      expect(bounds.HEIGHT).toBe(800);
    });

    it('should export SpawnMargins interface', () => {
      const margins: SpawnMargins = {
        BOUNDARY_DAMAGE_MARGIN: 10,
        CLEANUP_MARGIN: 20,
        ASTEROID_SPAWN_OFFSET: 5,
      };
      expect(margins.BOUNDARY_DAMAGE_MARGIN).toBe(10);
      expect(margins.CLEANUP_MARGIN).toBe(20);
      expect(margins.ASTEROID_SPAWN_OFFSET).toBe(5);
    });
  });

  describe('Integration Tests', () => {
    it('should have world bounds larger than hazard zones', () => {
      const worldArea = WORLD_CONFIG.BOUNDS.WIDTH * WORLD_CONFIG.BOUNDS.HEIGHT;
      const hazardArea = Math.PI * Math.pow(ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS, 2);
      const totalHazardArea = hazardArea * ENVIRONMENT_CONFIG.HAZARD_ZONES.DEFAULT_COUNT;

      // Hazards should not cover more than 10% of world
      expect(totalHazardArea / worldArea).toBeLessThan(0.1);
    });
  });
});
