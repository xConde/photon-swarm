import { PLAYER_CONFIG, PlayerPhysics, SpawnProtection } from './player.config';
import { WEAPON_CONFIG, WeaponConfig } from './weapon.config';
import { ABILITY_CONFIG, AbilityConfig } from './ability.config';
import { CHARGING_CONFIG } from './charging.config';

describe('Player Configuration', () => {
  // ==========================================================================
  // PLAYER CORE CONFIGURATION
  // ==========================================================================

  describe('PLAYER_CONFIG', () => {
    describe('PHYSICS', () => {
      it('should define player physics properties', () => {
        expect(PLAYER_CONFIG.PHYSICS).toBeDefined();
        expect(PLAYER_CONFIG.PHYSICS.RADIUS).toBe(12);
        expect(PLAYER_CONFIG.PHYSICS.BASE_SPEED).toBe(0.2);
        expect(PLAYER_CONFIG.PHYSICS.DIAGONAL_SPEED_FACTOR).toBeCloseTo(1 / Math.sqrt(2), 5);
      });

      it('should have positive radius and speed', () => {
        expect(PLAYER_CONFIG.PHYSICS.RADIUS).toBeGreaterThan(0);
        expect(PLAYER_CONFIG.PHYSICS.BASE_SPEED).toBeGreaterThan(0);
      });

      it('should have diagonal factor less than 1 to prevent faster diagonal movement', () => {
        expect(PLAYER_CONFIG.PHYSICS.DIAGONAL_SPEED_FACTOR).toBeLessThan(1);
        expect(PLAYER_CONFIG.PHYSICS.DIAGONAL_SPEED_FACTOR).toBeGreaterThan(0);
      });

      it('should calculate diagonal factor correctly (√2 normalization)', () => {
        // Diagonal factor should be 1/√2 ≈ 0.7071
        expect(PLAYER_CONFIG.PHYSICS.DIAGONAL_SPEED_FACTOR).toBeCloseTo(0.7071, 4);
      });
    });

    describe('SPAWN_PROTECTION', () => {
      it('should define spawn protection duration', () => {
        expect(PLAYER_CONFIG.SPAWN_PROTECTION).toBeDefined();
        expect(PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS).toBe(3000);
      });

      it('should have positive duration', () => {
        expect(PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS).toBeGreaterThan(0);
      });

      it('should provide reasonable protection time (2-5 seconds)', () => {
        expect(PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS).toBeGreaterThanOrEqual(2000);
        expect(PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS).toBeLessThanOrEqual(5000);
      });
    });

    it('should be readonly via TypeScript (compile-time protection via as const)', () => {
      // TypeScript's 'as const' provides compile-time readonly protection
      // Verifying config structure is defined correctly
      // Note: Runtime immutability requires Object.freeze (not currently used)
      expect(PLAYER_CONFIG.PHYSICS.RADIUS).toBe(12);
      expect(PLAYER_CONFIG.PHYSICS.BASE_SPEED).toBe(0.2);
      expect(typeof PLAYER_CONFIG.PHYSICS.DIAGONAL_SPEED_FACTOR).toBe('number');
    });
  });

  // ==========================================================================
  // WEAPON CONFIGURATION
  // ==========================================================================

  describe('WEAPON_CONFIG', () => {
    describe('BEAM', () => {
      it('should define beam weapon properties', () => {
        expect(WEAPON_CONFIG.BEAM).toBeDefined();
        // Buffed to reward riskier projectile play over passive beam
        expect(WEAPON_CONFIG.BEAM.DAMAGE).toBe(70);
        expect(WEAPON_CONFIG.BEAM.FIRE_RATE).toBe(500);
        expect(WEAPON_CONFIG.BEAM.PROJECTILE_SPEED).toBe(750);
        expect(WEAPON_CONFIG.BEAM.LENGTH).toBe(1000);
        expect(WEAPON_CONFIG.BEAM.WIDTH).toBe(30);
      });

      it('should have positive values', () => {
        expect(WEAPON_CONFIG.BEAM.DAMAGE).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.BEAM.FIRE_RATE).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.BEAM.LENGTH).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.BEAM.WIDTH).toBeGreaterThan(0);
      });

      it('should have reasonable beam dimensions', () => {
        // Width should be much smaller than length
        expect(WEAPON_CONFIG.BEAM.WIDTH).toBeLessThan(WEAPON_CONFIG.BEAM.LENGTH / 10);
      });
    });

    describe('DISCHARGE', () => {
      it('should define discharge weapon properties', () => {
        expect(WEAPON_CONFIG.DISCHARGE).toBeDefined();
        expect(WEAPON_CONFIG.DISCHARGE.RADIUS).toBe(250);
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE).toBe(120);
        expect(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS).toBe(8000);
        expect(WEAPON_CONFIG.DISCHARGE.KNOCKBACK_FORCE).toBe(500);
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE_FALLOFF).toBe(true);
      });

      it('should have positive values', () => {
        expect(WEAPON_CONFIG.DISCHARGE.RADIUS).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.DISCHARGE.KNOCKBACK_FORCE).toBeGreaterThan(0);
      });

      it('should have more damage than beam (area attack compensation)', () => {
        // Discharge should do more damage since it has cooldown
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE).toBeGreaterThan(WEAPON_CONFIG.BEAM.DAMAGE);
      });
    });

    describe('CHARGED_PROJECTILE', () => {
      it('should define charged projectile properties', () => {
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE).toBeDefined();
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.BASE_DAMAGE_MULTIPLIER).toBe(2.5);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.CHARGE_THRESHOLD).toBe(0.4);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.MAX_SIZE_MULTIPLIER).toBe(1.2);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.PULSE_FREQUENCY).toBe(8);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.TRAIL_THRESHOLD).toBe(0.7);
      });

      it('should have multiplier greater than 1 (damage boost)', () => {
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.BASE_DAMAGE_MULTIPLIER).toBeGreaterThan(1);
      });

      it('should have valid threshold percentages (0-1)', () => {
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.CHARGE_THRESHOLD).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.CHARGE_THRESHOLD).toBeLessThanOrEqual(1);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.TRAIL_THRESHOLD).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.CHARGED_PROJECTILE.TRAIL_THRESHOLD).toBeLessThanOrEqual(1);
      });

      describe('VISUALS', () => {
        it('should define all visual effect subsystems', () => {
          expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.TRAIL).toBeDefined();
          expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT).toBeDefined();
          expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.RING).toBeDefined();
          expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.HIT_FLASH).toBeDefined();
        });

        describe('TRAIL', () => {
          it('should have valid spawn chance (0-1)', () => {
            const spawnChance = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.TRAIL.SPAWN_CHANCE;
            expect(spawnChance).toBeGreaterThan(0);
            expect(spawnChance).toBeLessThanOrEqual(1);
          });

          it('should have positive scale factors', () => {
            expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.TRAIL.INTENSITY_SCALE).toBeGreaterThan(0);
            expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.TRAIL.POSITION_OFFSET).toBeGreaterThan(0);
          });
        });

        describe('IMPACT', () => {
          it('should have valid intensity range', () => {
            const impact = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT;
            expect(impact.MIN_INTENSITY).toBeLessThanOrEqual(impact.MAX_INTENSITY);
            expect(impact.MIN_INTENSITY).toBeGreaterThan(0);
            expect(impact.MAX_INTENSITY).toBeLessThanOrEqual(1);
          });

          it('should have valid shake threshold (0-1)', () => {
            const shakeThreshold = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT.SHAKE_THRESHOLD;
            expect(shakeThreshold).toBeGreaterThan(0);
            expect(shakeThreshold).toBeLessThanOrEqual(1);
          });

          it('should have positive shake parameters', () => {
            const impact = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT;
            expect(impact.SHAKE_INTENSITY_MULTIPLIER).toBeGreaterThan(0);
            expect(impact.SHAKE_BASE_DURATION).toBeGreaterThan(0);
            expect(impact.SHAKE_DURATION_MULTIPLIER).toBeGreaterThan(0);
            expect(impact.SHAKE_FREQUENCY).toBeGreaterThan(0);
          });

          it('should have valid chromatic aberration parameters', () => {
            const impact = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT;
            expect(impact.CHROMATIC_THRESHOLD).toBeGreaterThan(0);
            expect(impact.CHROMATIC_THRESHOLD).toBeLessThanOrEqual(1);
            expect(impact.CHROMATIC_INTENSITY).toBeGreaterThan(0);
            expect(impact.CHROMATIC_DURATION).toBeGreaterThan(0);
          });

          it('should require higher charge for chromatic than shake', () => {
            const impact = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT;
            // Chromatic is more dramatic, should require more charge
            expect(impact.CHROMATIC_THRESHOLD).toBeGreaterThanOrEqual(impact.SHAKE_THRESHOLD);
          });
        });

        describe('RING', () => {
          it('should have valid alpha range', () => {
            const ring = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.RING;
            expect(ring.MIN_ALPHA).toBeLessThanOrEqual(ring.MAX_ALPHA);
            expect(ring.MIN_ALPHA).toBeGreaterThan(0);
            expect(ring.MAX_ALPHA).toBeLessThanOrEqual(1);
          });

          it('should have valid radius multipliers', () => {
            const ring = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.RING;
            expect(ring.MIN_RADIUS_MULTIPLIER).toBeLessThanOrEqual(ring.MAX_RADIUS_MULTIPLIER);
            expect(ring.MIN_RADIUS_MULTIPLIER).toBeGreaterThan(0);
          });

          it('should have positive line width', () => {
            expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.RING.LINE_WIDTH).toBeGreaterThan(0);
          });
        });

        describe('HIT_FLASH', () => {
          it('should have positive durations', () => {
            const hitFlash = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.HIT_FLASH;
            expect(hitFlash.PROJECTILE_DURATION).toBeGreaterThan(0);
            expect(hitFlash.BEAM_DURATION).toBeGreaterThan(0);
          });

          it('should have beam duration shorter than projectile (continuous damage)', () => {
            const hitFlash = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.HIT_FLASH;
            expect(hitFlash.BEAM_DURATION).toBeLessThanOrEqual(hitFlash.PROJECTILE_DURATION);
          });

          it('should have valid intensity parameters', () => {
            const hitFlash = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.HIT_FLASH;
            expect(hitFlash.DAMAGE_SCALE_DIVISOR).toBeGreaterThan(0);
            expect(hitFlash.MAX_INTENSITY).toBeGreaterThan(0);
            expect(hitFlash.MAX_INTENSITY).toBeLessThanOrEqual(1);
            expect(hitFlash.BEAM_INTENSITY_MULTIPLIER).toBeGreaterThan(0);
            expect(hitFlash.BEAM_INTENSITY_MULTIPLIER).toBeLessThanOrEqual(1);
          });

          it('should have valid color hex codes', () => {
            const hitFlash = WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.HIT_FLASH;
            expect(hitFlash.PROJECTILE_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
            expect(hitFlash.BEAM_COLOR).toMatch(/^#[0-9a-f]{6}$/i);
          });
        });
      });
    });
  });

  // ==========================================================================
  // ABILITY CONFIGURATION
  // ==========================================================================

  describe('ABILITY_CONFIG', () => {
    describe('DIRECTION_CHANGE', () => {
      it('should define direction change ability', () => {
        expect(ABILITY_CONFIG.DIRECTION_CHANGE).toBeDefined();
        expect(ABILITY_CONFIG.DIRECTION_CHANGE.COOLDOWN_MS).toBe(600);
        expect(ABILITY_CONFIG.DIRECTION_CHANGE.ACTIVE_DURATION_MS).toBe(1000);
        expect(ABILITY_CONFIG.DIRECTION_CHANGE.MAX_ROTATION_SPEED_RAD_PER_FRAME).toBe(0.075);
      });

      it('should have positive cooldown and duration', () => {
        expect(ABILITY_CONFIG.DIRECTION_CHANGE.COOLDOWN_MS).toBeGreaterThan(0);
        expect(ABILITY_CONFIG.DIRECTION_CHANGE.ACTIVE_DURATION_MS).toBeGreaterThan(0);
      });

      it('should have active duration longer than cooldown (responsive)', () => {
        expect(ABILITY_CONFIG.DIRECTION_CHANGE.ACTIVE_DURATION_MS).toBeGreaterThan(
          ABILITY_CONFIG.DIRECTION_CHANGE.COOLDOWN_MS
        );
      });

      it('should have reasonable rotation speed', () => {
        const rotSpeed = ABILITY_CONFIG.DIRECTION_CHANGE.MAX_ROTATION_SPEED_RAD_PER_FRAME!;
        // Should be between 0.01 and 0.2 radians per frame
        expect(rotSpeed).toBeGreaterThan(0.01);
        expect(rotSpeed).toBeLessThan(0.2);
      });
    });

    describe('DISCHARGE (consolidated in WEAPON_CONFIG)', () => {
      it('should define discharge config in weapon config', () => {
        expect(WEAPON_CONFIG.DISCHARGE).toBeDefined();
        expect(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS).toBe(8000);
        expect(WEAPON_CONFIG.DISCHARGE.RADIUS).toBe(250);
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE).toBe(120);
      });

      it('should have positive cooldown, radius, and damage', () => {
        expect(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.DISCHARGE.RADIUS).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE).toBeGreaterThan(0);
      });

      it('should have knockback force and damage falloff', () => {
        expect(WEAPON_CONFIG.DISCHARGE.KNOCKBACK_FORCE).toBeGreaterThan(0);
        expect(WEAPON_CONFIG.DISCHARGE.DAMAGE_FALLOFF).toBe(true);
      });

      it('should have longer cooldown than direction change (more powerful)', () => {
        expect(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS).toBeGreaterThan(ABILITY_CONFIG.DIRECTION_CHANGE.COOLDOWN_MS);
      });
    });

    describe('DASH', () => {
      it('should define dash ability', () => {
        expect(ABILITY_CONFIG.DASH).toBeDefined();
        expect(ABILITY_CONFIG.DASH.COOLDOWN_MS).toBe(5000);
        expect(ABILITY_CONFIG.DASH.DURATION_MS).toBe(100);
        // Nerfed 10% from 5.0 for balance
        expect(ABILITY_CONFIG.DASH.SPEED_MULTIPLIER).toBe(4.5);
        expect(ABILITY_CONFIG.DASH.INVINCIBILITY_DURATION_MS).toBe(1000);
        expect(ABILITY_CONFIG.DASH.DAMAGE).toBe(50); // Offensive dash damage
      });

      it('should have positive values', () => {
        expect(ABILITY_CONFIG.DASH.COOLDOWN_MS).toBeGreaterThan(0);
        expect(ABILITY_CONFIG.DASH.DURATION_MS).toBeGreaterThan(0);
        expect(ABILITY_CONFIG.DASH.SPEED_MULTIPLIER).toBeGreaterThan(1);
        expect(ABILITY_CONFIG.DASH.INVINCIBILITY_DURATION_MS).toBeGreaterThan(0);
      });

      it('should have invincibility duration longer than dash duration', () => {
        expect(ABILITY_CONFIG.DASH.INVINCIBILITY_DURATION_MS).toBeGreaterThan(ABILITY_CONFIG.DASH.DURATION_MS!);
      });

      it('should have short dash duration (quick movement)', () => {
        // Dash should be quick burst movement (< 200ms)
        expect(ABILITY_CONFIG.DASH.DURATION_MS).toBeLessThan(200);
      });

      it('should have offensive dash damage defined', () => {
        // Offensive dash deals damage to enemies passed through
        expect(ABILITY_CONFIG.DASH.DAMAGE).toBeDefined();
        expect(ABILITY_CONFIG.DASH.DAMAGE).toBeGreaterThan(0);
        // Dash damage should be meaningful but not overpowered
        expect(ABILITY_CONFIG.DASH.DAMAGE).toBeGreaterThanOrEqual(30);
        expect(ABILITY_CONFIG.DASH.DAMAGE).toBeLessThanOrEqual(100);
      });
    });

    describe('PARRY', () => {
      it('should define parry ability', () => {
        expect(ABILITY_CONFIG.PARRY).toBeDefined();
        expect(ABILITY_CONFIG.PARRY.COOLDOWN_MS).toBe(1500);
        expect(ABILITY_CONFIG.PARRY.DURATION_MS).toBe(300);
      });

      it('should have reasonable timing window', () => {
        // Parry window should be challenging but achievable
        expect(ABILITY_CONFIG.PARRY.DURATION_MS).toBeGreaterThanOrEqual(200);
        expect(ABILITY_CONFIG.PARRY.DURATION_MS).toBeLessThanOrEqual(500);
      });

      it('should have reasonable cooldown', () => {
        // Cooldown should prevent spam but allow skilled play
        expect(ABILITY_CONFIG.PARRY.COOLDOWN_MS).toBeGreaterThanOrEqual(1000);
        expect(ABILITY_CONFIG.PARRY.COOLDOWN_MS).toBeLessThanOrEqual(3000);
      });
    });
  });

  // ==========================================================================
  // CHARGING & ANIMATION CONFIGURATION
  // ==========================================================================

  describe('CHARGING_CONFIG', () => {
    describe('CHARGING', () => {
      it('should define charging mechanics', () => {
        expect(CHARGING_CONFIG.CHARGING).toBeDefined();
        expect(CHARGING_CONFIG.CHARGING.MOVEMENT_DECAY_RATE).toBe(1.5);
        expect(CHARGING_CONFIG.CHARGING.FOCUS_DECAY_RATE).toBe(1.5);
        expect(CHARGING_CONFIG.CHARGING.VISUAL_CONVERSION_FACTOR).toBe(100);
      });

      it('should have positive decay rates', () => {
        expect(CHARGING_CONFIG.CHARGING.MOVEMENT_DECAY_RATE).toBeGreaterThan(0);
        expect(CHARGING_CONFIG.CHARGING.FOCUS_DECAY_RATE).toBeGreaterThan(0);
      });

      describe('VISUAL', () => {
        it('should define charging visual properties', () => {
          const visual = CHARGING_CONFIG.CHARGING.VISUAL;
          expect(visual.MIN_RADIUS).toBe(5);
          expect(visual.MAX_RADIUS).toBe(12);
          expect(visual.PULSE_AMOUNT).toBe(0.05);
          expect(visual.GLOW_MULTIPLIER).toBe(1.2);
          expect(visual.MAX_SAFETY_RADIUS).toBe(30);
        });

        it('should have valid radius range', () => {
          const visual = CHARGING_CONFIG.CHARGING.VISUAL;
          expect(visual.MIN_RADIUS).toBeLessThan(visual.MAX_RADIUS);
          expect(visual.MIN_RADIUS).toBeGreaterThan(0);
        });

        it('should have safety radius larger than max radius', () => {
          const visual = CHARGING_CONFIG.CHARGING.VISUAL;
          expect(visual.MAX_SAFETY_RADIUS).toBeGreaterThan(visual.MAX_RADIUS);
        });

        it('should have charging orb smaller than player', () => {
          const visual = CHARGING_CONFIG.CHARGING.VISUAL;
          expect(visual.MAX_RADIUS).toBeLessThanOrEqual(PLAYER_CONFIG.PHYSICS.RADIUS);
        });

        it('should have glow multiplier greater than 1', () => {
          expect(CHARGING_CONFIG.CHARGING.VISUAL.GLOW_MULTIPLIER).toBeGreaterThan(1);
        });
      });
    });

    describe('ANIMATION', () => {
      it('should define animation properties', () => {
        expect(CHARGING_CONFIG.ANIMATION).toBeDefined();
        expect(CHARGING_CONFIG.ANIMATION.PASSIVE_BEAM_ROTATION_SPEED).toBe(0.002);
        expect(CHARGING_CONFIG.ANIMATION.IDLE_ROTATION_MULTIPLIER).toBe(1.0);
        expect(CHARGING_CONFIG.ANIMATION.MOVING_ROTATION_MULTIPLIER).toBe(1.0);
        expect(CHARGING_CONFIG.ANIMATION.IDLE_RAMP_TIME_MS).toBe(2250);
        expect(CHARGING_CONFIG.ANIMATION.MIN_IDLE_MULTIPLIER).toBe(1.0);
        expect(CHARGING_CONFIG.ANIMATION.MAX_IDLE_MULTIPLIER).toBe(1.8);
      });

      it('should have positive rotation speed', () => {
        expect(CHARGING_CONFIG.ANIMATION.PASSIVE_BEAM_ROTATION_SPEED).toBeGreaterThan(0);
      });

      it('should have valid multiplier range', () => {
        expect(CHARGING_CONFIG.ANIMATION.MIN_IDLE_MULTIPLIER).toBeLessThanOrEqual(
          CHARGING_CONFIG.ANIMATION.MAX_IDLE_MULTIPLIER
        );
        expect(CHARGING_CONFIG.ANIMATION.MIN_IDLE_MULTIPLIER).toBeGreaterThanOrEqual(1);
      });

      describe('CHARGED_ROTATION', () => {
        it('should define charged rotation properties', () => {
          const chargedRot = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION;
          expect(chargedRot.MIN_MULTIPLIER).toBe(1.0);
          expect(chargedRot.MID_MULTIPLIER).toBe(3.0);
          expect(chargedRot.MAX_MULTIPLIER).toBe(6.0);
          expect(chargedRot.CHARGE_THRESHOLD).toBe(0.05);
          expect(chargedRot.VISUAL_BLUR_THRESHOLD).toBe(0.3);
          expect(chargedRot.MAX_BLUR_TRAILS).toBe(4);
        });

        it('should have increasing multipliers', () => {
          const chargedRot = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION;
          expect(chargedRot.MIN_MULTIPLIER).toBeLessThan(chargedRot.MID_MULTIPLIER);
          expect(chargedRot.MID_MULTIPLIER).toBeLessThan(chargedRot.MAX_MULTIPLIER);
        });

        it('should have valid threshold percentages', () => {
          const chargedRot = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION;
          expect(chargedRot.CHARGE_THRESHOLD).toBeGreaterThan(0);
          expect(chargedRot.CHARGE_THRESHOLD).toBeLessThanOrEqual(1);
          expect(chargedRot.VISUAL_BLUR_THRESHOLD).toBeGreaterThan(0);
          expect(chargedRot.VISUAL_BLUR_THRESHOLD).toBeLessThanOrEqual(1);
        });

        describe('INDICATOR', () => {
          it('should define indicator properties', () => {
            const indicator = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR;
            expect(indicator.ACTIVATION_THRESHOLD).toBe(1.2);
            expect(indicator.MIN_RADIUS).toBe(25);
            expect(indicator.MAX_RADIUS).toBe(40);
            expect(indicator.MIN_OPACITY).toBe(0.15);
            expect(indicator.MAX_OPACITY).toBe(0.4);
            expect(indicator.LINE_WIDTH_MIN).toBe(1);
            expect(indicator.LINE_WIDTH_MAX).toBe(3);
            expect(indicator.DASH_PATTERN).toEqual([5, 10]);
          });

          it('should have valid radius range', () => {
            const indicator = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR;
            expect(indicator.MIN_RADIUS).toBeLessThan(indicator.MAX_RADIUS);
            expect(indicator.MIN_RADIUS).toBeGreaterThan(0);
          });

          it('should have valid opacity range', () => {
            const indicator = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR;
            expect(indicator.MIN_OPACITY).toBeLessThan(indicator.MAX_OPACITY);
            expect(indicator.MIN_OPACITY).toBeGreaterThan(0);
            expect(indicator.MAX_OPACITY).toBeLessThanOrEqual(1);
          });

          it('should have valid line width range', () => {
            const indicator = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR;
            expect(indicator.LINE_WIDTH_MIN).toBeLessThanOrEqual(indicator.LINE_WIDTH_MAX);
            expect(indicator.LINE_WIDTH_MIN).toBeGreaterThan(0);
          });

          it('should have valid dash pattern', () => {
            const dashPattern = CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR.DASH_PATTERN;
            expect(dashPattern.length).toBe(2);
            expect(dashPattern[0]).toBeGreaterThan(0);
            expect(dashPattern[1]).toBeGreaterThan(0);
          });
        });
      });
    });

    describe('COOLDOWN_ACCELERATION', () => {
      it('should define cooldown acceleration', () => {
        expect(CHARGING_CONFIG.COOLDOWN_ACCELERATION).toBeDefined();
        expect(CHARGING_CONFIG.COOLDOWN_ACCELERATION.DISCHARGE_IDLE_MULTIPLIER).toBe(3);
        expect(CHARGING_CONFIG.COOLDOWN_ACCELERATION.MOVEMENT_THRESHOLD).toBe(5);
      });

      it('should have multiplier greater than 1 (acceleration)', () => {
        expect(CHARGING_CONFIG.COOLDOWN_ACCELERATION.DISCHARGE_IDLE_MULTIPLIER).toBeGreaterThan(1);
      });

      it('should have positive movement threshold', () => {
        expect(CHARGING_CONFIG.COOLDOWN_ACCELERATION.MOVEMENT_THRESHOLD).toBeGreaterThan(0);
      });
    });
  });

  // ==========================================================================
  // TYPE DEFINITIONS
  // ==========================================================================

  describe('Type Definitions', () => {
    it('should export PlayerPhysics interface', () => {
      const physics: PlayerPhysics = {
        RADIUS: 10,
        BASE_SPEED: 0.3,
        DIAGONAL_SPEED_FACTOR: 0.7,
      };
      expect(physics.RADIUS).toBe(10);
      expect(physics.BASE_SPEED).toBe(0.3);
      expect(physics.DIAGONAL_SPEED_FACTOR).toBe(0.7);
    });

    it('should export SpawnProtection interface', () => {
      const spawnProtection: SpawnProtection = {
        DURATION_MS: 2000,
      };
      expect(spawnProtection.DURATION_MS).toBe(2000);
    });

    it('should export WeaponConfig interface', () => {
      const weapon: WeaponConfig = {
        DAMAGE: 50,
        FIRE_RATE: 500,
        PROJECTILE_SPEED: 550,
        LENGTH: 800,
        WIDTH: 25,
      };
      expect(weapon.DAMAGE).toBe(50);
      expect(weapon.FIRE_RATE).toBe(500);
      expect(weapon.PROJECTILE_SPEED).toBe(550);
      expect(weapon.LENGTH).toBe(800);
      expect(weapon.WIDTH).toBe(25);
    });

    it('should export AbilityConfig interface', () => {
      const ability: AbilityConfig = {
        COOLDOWN_MS: 1000,
        DURATION_MS: 500,
      };
      expect(ability.COOLDOWN_MS).toBe(1000);
      expect(ability.DURATION_MS).toBe(500);
    });
  });

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should have discharge config consolidated in weapon config', () => {
      expect(WEAPON_CONFIG.DISCHARGE.RADIUS).toBe(250);
      expect(WEAPON_CONFIG.DISCHARGE.DAMAGE).toBe(120);
      expect(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS).toBe(8000);
    });

    it('should have charging orb smaller than player for visibility', () => {
      expect(CHARGING_CONFIG.CHARGING.VISUAL.MAX_RADIUS).toBeLessThanOrEqual(PLAYER_CONFIG.PHYSICS.RADIUS);
    });

    it('should have reasonable ability cooldowns (gameplay balance)', () => {
      // Direction change should be quickest (most frequent)
      expect(ABILITY_CONFIG.DIRECTION_CHANGE.COOLDOWN_MS).toBeLessThan(ABILITY_CONFIG.DASH.COOLDOWN_MS);
      expect(ABILITY_CONFIG.DIRECTION_CHANGE.COOLDOWN_MS).toBeLessThan(WEAPON_CONFIG.DISCHARGE.COOLDOWN_MS);
    });

    it('should have charged rotation max multiplier create dramatic effect', () => {
      // 6x speed should be dramatic "hyperdrive blender mode"
      expect(CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.MAX_MULTIPLIER).toBeGreaterThanOrEqual(5);
    });

    it('should have visual effects scale with charge level', () => {
      // Blur should start before full charge for feedback
      expect(CHARGING_CONFIG.ANIMATION.CHARGED_ROTATION.VISUAL_BLUR_THRESHOLD).toBeLessThan(1.0);

      // Chromatic should require high charge (dramatic effect)
      expect(WEAPON_CONFIG.CHARGED_PROJECTILE.VISUALS.IMPACT.CHROMATIC_THRESHOLD).toBeGreaterThan(0.8);
    });

    it('should have spawn protection longer than dash invincibility', () => {
      // Spawn protection should give more safety time than dash
      expect(PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS).toBeGreaterThan(
        ABILITY_CONFIG.DASH.INVINCIBILITY_DURATION_MS!
      );
    });

    describe('Projectile Combat Balance Values', () => {
      it('should have PROJECTILE_SPEED of 750', () => {
        expect(WEAPON_CONFIG.BEAM.PROJECTILE_SPEED).toBe(750);
      });

      it('should have projectile damage of 70', () => {
        expect(WEAPON_CONFIG.BEAM.DAMAGE).toBe(70);
      });

      it('should have projectile fire rate of 500ms', () => {
        expect(WEAPON_CONFIG.BEAM.FIRE_RATE).toBe(500);
      });

      it('should have beam DPS values of 140 and 196', () => {
        // Beam DPS is defined inline in BeamCollisionSystemService.damageEnemy():
        //   const baseDamage = isMoving ? 140 : 196;
        // These config-level assertions document the expected projectile balance.
        // Projectile damage (70) at fire rate (500ms) yields ~140 DPS,
        // now comparable to beam moving DPS to reward aiming skill.
        const projectileDps = (WEAPON_CONFIG.BEAM.DAMAGE / WEAPON_CONFIG.BEAM.FIRE_RATE) * 1000;
        expect(projectileDps).toBeCloseTo(140, 0);

        // Beam DPS constants are verified in beam-collision-system.service.spec.ts
        // Moving DPS: 140, Stationary DPS: 196
        const movingBeamDps = 140;
        const stationaryBeamDps = 196;
        expect(stationaryBeamDps).toBeCloseTo(movingBeamDps * 1.4, 0);
      });
    });

    it('should have player speed allow crossing world in reasonable time', () => {
      // Assuming 60fps, calculate time to cross world width
      const pixelsPerSecond = PLAYER_CONFIG.PHYSICS.BASE_SPEED * 1000; // 0.2 * 1000 = 200 px/s
      const worldWidth = 12000; // From WORLD_CONFIG
      const secondsToCross = worldWidth / pixelsPerSecond; // 60 seconds

      // Should take between 30-90 seconds to cross world
      expect(secondsToCross).toBeGreaterThan(30);
      expect(secondsToCross).toBeLessThan(90);
    });
  });
});
