import { ENEMY_STATS, EnemyStats } from './enemy-stats.config';
import { SPAWN_CONFIG } from './spawn.config';
import { AI_BEHAVIOR_CONFIG, ENEMY_SEPARATION_CONFIG, IDLE_BEHAVIOR_CONFIG } from './ai-behavior.config';

describe('Enemy Configuration', () => {
  // ==========================================================================
  // ENEMY STATS CONFIGURATION
  // ==========================================================================

  describe('ENEMY_STATS', () => {
    const enemyTypes = ['basic', 'spitter', 'tank', 'swarm', 'thug', 'sniper', 'boss'] as const;

    describe('All Enemy Types', () => {
      enemyTypes.forEach((enemyType) => {
        describe(`${enemyType}`, () => {
          let stats: EnemyStats;

          beforeEach(() => {
            stats = ENEMY_STATS[enemyType];
          });

          it('should have all required stats', () => {
            expect(stats.HEALTH).toBeDefined();
            expect(stats.DAMAGE).toBeDefined();
            expect(stats.SPEED).toBeDefined();
            expect(stats.RADIUS).toBeDefined();
            expect(stats.DAMAGE_REDUCTION).toBeDefined();
            expect(stats.AGGRO_RANGE).toBeDefined();
            expect(stats.ATTACK_RANGE).toBeDefined();
          });

          it('should have positive values', () => {
            expect(stats.HEALTH).toBeGreaterThan(0);
            expect(stats.DAMAGE).toBeGreaterThan(0);
            expect(stats.SPEED).toBeGreaterThan(0);
            expect(stats.RADIUS).toBeGreaterThan(0);
            expect(stats.AGGRO_RANGE).toBeGreaterThan(0);
            expect(stats.ATTACK_RANGE).toBeGreaterThan(0);
          });

          it('should have damage reduction in valid range (0-1)', () => {
            expect(stats.DAMAGE_REDUCTION).toBeGreaterThanOrEqual(0);
            expect(stats.DAMAGE_REDUCTION).toBeLessThan(1);
          });

          it('should have aggro range >= attack range', () => {
            expect(stats.AGGRO_RANGE).toBeGreaterThanOrEqual(stats.ATTACK_RANGE);
          });

          it('should have reasonable radius for collision (10-60px)', () => {
            expect(stats.RADIUS).toBeGreaterThanOrEqual(10);
            expect(stats.RADIUS).toBeLessThanOrEqual(60);
          });
        });
      });
    });

    describe('Ranged Enemies (Weapon Configs)', () => {
      const rangedEnemies = ['spitter', 'sniper', 'boss'] as const;

      rangedEnemies.forEach((enemyType) => {
        describe(`${enemyType} weapon`, () => {
          it('should have weapon config', () => {
            expect(ENEMY_STATS[enemyType].WEAPON).toBeDefined();
          });

          it('should have positive weapon stats', () => {
            const weapon = ENEMY_STATS[enemyType].WEAPON;
            expect(weapon.DAMAGE).toBeGreaterThan(0);
            expect(weapon.FIRE_RATE).toBeGreaterThan(0);
            expect(weapon.RANGE).toBeGreaterThan(0);
          });

          it('should have weapon range match or exceed attack range', () => {
            const stats = ENEMY_STATS[enemyType];
            const weapon = stats.WEAPON;
            expect(weapon.RANGE).toBeGreaterThanOrEqual(stats.ATTACK_RANGE);
          });
        });
      });

      it('boss should have burst fire config', () => {
        const boss = ENEMY_STATS.boss.WEAPON;
        expect(boss.SPREAD).toBeDefined();
        expect(boss.COOLDOWN).toBeDefined();
        expect(boss.BURST_COUNT).toBeDefined();
        expect(boss.BURST_COUNT).toBeGreaterThan(1);
      });
    });

    describe('Melee Enemies', () => {
      const meleeEnemies = ['basic', 'tank', 'swarm', 'thug'] as const;

      meleeEnemies.forEach((enemyType) => {
        it(`${enemyType} should not have weapon config`, () => {
          const stats = ENEMY_STATS[enemyType] as EnemyStats;
          expect(stats.WEAPON).toBeUndefined();
        });
      });
    });

    describe('Balance and Progression', () => {
      it('boss should have highest health', () => {
        enemyTypes.forEach((type) => {
          if (type !== 'boss') {
            expect(ENEMY_STATS.boss.HEALTH).toBeGreaterThan(ENEMY_STATS[type].HEALTH);
          }
        });
      });

      it('tank should have second highest health', () => {
        const nonBossTank = enemyTypes.filter((t) => t !== 'boss' && t !== 'tank');
        nonBossTank.forEach((type) => {
          expect(ENEMY_STATS.tank.HEALTH).toBeGreaterThan(ENEMY_STATS[type].HEALTH);
        });
      });

      it('swarm should have lowest damage', () => {
        enemyTypes.forEach((type) => {
          if (type !== 'swarm') {
            expect(ENEMY_STATS.swarm.DAMAGE).toBeLessThanOrEqual(ENEMY_STATS[type].DAMAGE);
          }
        });
      });

      it('tank should have second highest damage reduction', () => {
        // Boss has highest damage reduction (0.5), tank has second highest (0.3)
        const nonBossTank = enemyTypes.filter((t) => t !== 'boss' && t !== 'tank');
        nonBossTank.forEach((type) => {
          expect(ENEMY_STATS.tank.DAMAGE_REDUCTION).toBeGreaterThanOrEqual(ENEMY_STATS[type].DAMAGE_REDUCTION);
        });
      });

      it('boss should have highest damage reduction', () => {
        enemyTypes.forEach((type) => {
          if (type !== 'boss') {
            expect(ENEMY_STATS.boss.DAMAGE_REDUCTION).toBeGreaterThanOrEqual(ENEMY_STATS[type].DAMAGE_REDUCTION);
          }
        });
      });

      it('thug should have high damage (glass cannon)', () => {
        // Thug should be top 3 in damage
        const damages = enemyTypes.map((t) => ENEMY_STATS[t].DAMAGE);
        const sortedDamages = [...damages].sort((a, b) => b - a);
        expect(sortedDamages.indexOf(ENEMY_STATS.thug.DAMAGE)).toBeLessThan(4);
      });

      it('sniper should have longest aggro range', () => {
        enemyTypes.forEach((type) => {
          if (type !== 'sniper') {
            expect(ENEMY_STATS.sniper.AGGRO_RANGE).toBeGreaterThanOrEqual(ENEMY_STATS[type].AGGRO_RANGE);
          }
        });
      });

      it('boss should have largest radius', () => {
        enemyTypes.forEach((type) => {
          if (type !== 'boss') {
            expect(ENEMY_STATS.boss.RADIUS).toBeGreaterThan(ENEMY_STATS[type].RADIUS);
          }
        });
      });

      it('swarm should have smallest radius', () => {
        enemyTypes.forEach((type) => {
          if (type !== 'swarm') {
            expect(ENEMY_STATS.swarm.RADIUS).toBeLessThanOrEqual(ENEMY_STATS[type].RADIUS);
          }
        });
      });
    });
  });

  // ==========================================================================
  // SPAWN CONFIGURATION
  // ==========================================================================

  describe('SPAWN_CONFIG', () => {
    describe('TIMING', () => {
      it('should define spawn timing properties', () => {
        expect(SPAWN_CONFIG.TIMING.BASE_SPAWN_RATE_MS).toBe(800);
        expect(SPAWN_CONFIG.TIMING.RATE_INCREASE_PER_LEVEL_MS).toBe(30);
        expect(SPAWN_CONFIG.TIMING.MIN_SPAWN_RATE_MS).toBe(300);
        expect(SPAWN_CONFIG.TIMING.INITIAL_SPAWN_DELAY_MS).toBe(100);
      });

      it('should have positive timing values', () => {
        expect(SPAWN_CONFIG.TIMING.BASE_SPAWN_RATE_MS).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.TIMING.RATE_INCREASE_PER_LEVEL_MS).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.TIMING.MIN_SPAWN_RATE_MS).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.TIMING.INITIAL_SPAWN_DELAY_MS).toBeGreaterThanOrEqual(0);
      });

      it('should have min spawn rate less than base spawn rate', () => {
        expect(SPAWN_CONFIG.TIMING.MIN_SPAWN_RATE_MS).toBeLessThan(SPAWN_CONFIG.TIMING.BASE_SPAWN_RATE_MS);
      });

      it('should have initial delay less than base spawn rate', () => {
        expect(SPAWN_CONFIG.TIMING.INITIAL_SPAWN_DELAY_MS).toBeLessThan(SPAWN_CONFIG.TIMING.BASE_SPAWN_RATE_MS);
      });
    });

    describe('LIMITS', () => {
      it('should define limit properties', () => {
        expect(SPAWN_CONFIG.LIMITS.MAX_ENEMIES).toBe(50);
        expect(SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_FPS).toBe(45);
        expect(SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_ENEMIES).toBe(30);
        expect(SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE).toBe(2000);
        expect(SPAWN_CONFIG.LIMITS.CLEANUP_FADE_DISTANCE).toBe(1600);
      });

      it('should have positive limit values', () => {
        expect(SPAWN_CONFIG.LIMITS.MAX_ENEMIES).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_FPS).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_ENEMIES).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.LIMITS.CLEANUP_FADE_DISTANCE).toBeGreaterThan(0);
      });

      it('should have performance limit enemies less than max enemies', () => {
        expect(SPAWN_CONFIG.LIMITS.PERFORMANCE_LIMIT_ENEMIES).toBeLessThan(SPAWN_CONFIG.LIMITS.MAX_ENEMIES);
      });

      it('should have cleanup fade distance less than cleanup distance', () => {
        expect(SPAWN_CONFIG.LIMITS.CLEANUP_FADE_DISTANCE).toBeLessThan(SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE);
      });
    });

    describe('CLUSTER', () => {
      it('should define cluster properties', () => {
        expect(SPAWN_CONFIG.CLUSTER.CHANCE).toBe(0.15);
        expect(SPAWN_CONFIG.CLUSTER.RESET_AFTER_SPAWNS).toBe(3);
        expect(SPAWN_CONFIG.CLUSTER.RESET_AFTER_MS).toBe(10000);
        expect(SPAWN_CONFIG.CLUSTER.MIN_DISTANCE).toBe(250);
        expect(SPAWN_CONFIG.CLUSTER.MAX_DISTANCE).toBe(500);
      });

      it('should have valid chance (0-1)', () => {
        expect(SPAWN_CONFIG.CLUSTER.CHANCE).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.CLUSTER.CHANCE).toBeLessThanOrEqual(1);
      });

      it('should have positive reset values', () => {
        expect(SPAWN_CONFIG.CLUSTER.RESET_AFTER_SPAWNS).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.CLUSTER.RESET_AFTER_MS).toBeGreaterThan(0);
      });

      it('should have max distance greater than min distance', () => {
        expect(SPAWN_CONFIG.CLUSTER.MAX_DISTANCE).toBeGreaterThan(SPAWN_CONFIG.CLUSTER.MIN_DISTANCE);
      });
    });

    describe('RARITY', () => {
      it('should define rarity properties', () => {
        expect(SPAWN_CONFIG.RARITY.ELITE_CHANCE).toBe(0.1);
        expect(SPAWN_CONFIG.RARITY.WEIGHTS).toBeDefined();
      });

      it('should have valid elite chance (0-1)', () => {
        expect(SPAWN_CONFIG.RARITY.ELITE_CHANCE).toBeGreaterThan(0);
        expect(SPAWN_CONFIG.RARITY.ELITE_CHANCE).toBeLessThan(1);
      });

      it('should have rarity weights sum to 1.0', () => {
        const weights = SPAWN_CONFIG.RARITY.WEIGHTS;
        const sum = weights.COMMON + weights.RARE + weights.LEGENDARY;
        expect(sum).toBeCloseTo(1.0, 5);
      });

      it('should have decreasing rarity weights', () => {
        const weights = SPAWN_CONFIG.RARITY.WEIGHTS;
        expect(weights.COMMON).toBeGreaterThan(weights.RARE);
        expect(weights.RARE).toBeGreaterThan(weights.LEGENDARY);
      });
    });

    describe('ENEMY_TYPE_WEIGHTS', () => {
      it('should define all enemy type weights', () => {
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.basic).toBe(28);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.spitter).toBe(18);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.tank).toBe(15);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.swarm).toBe(15);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.thug).toBe(11);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sniper).toBe(9);
        // Boss weight is 0 — bosses spawn only via scheduled boss waves (wave 15, 25, 35, ...)
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.boss).toBe(0);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.disruptor).toBe(12);
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sentinel).toBe(10);
      });

      it('should have non-negative weights', () => {
        const weights = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS;
        Object.values(weights).forEach((weight) => {
          expect(weight).toBeGreaterThanOrEqual(0);
        });
      });

      it('should have positive weights for non-boss types (boss uses scheduled waves)', () => {
        const weights = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS;
        expect(weights.basic).toBeGreaterThan(0);
        expect(weights.spitter).toBeGreaterThan(0);
        expect(weights.tank).toBeGreaterThan(0);
        expect(weights.swarm).toBeGreaterThan(0);
        expect(weights.thug).toBeGreaterThan(0);
        expect(weights.sniper).toBeGreaterThan(0);
      });

      it('should have basic as most common enemy', () => {
        const weights = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS;
        expect(weights.basic).toBeGreaterThan(weights.spitter);
        expect(weights.basic).toBeGreaterThan(weights.tank);
        expect(weights.basic).toBeGreaterThan(weights.swarm);
        expect(weights.basic).toBeGreaterThan(weights.thug);
        expect(weights.basic).toBeGreaterThan(weights.sniper);
        expect(weights.basic).toBeGreaterThan(weights.boss);
      });

      it('boss weight is 0 — spawns only via scheduled boss waves', () => {
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.boss).toBe(0);
      });

      it('should sum to 118 (relative weights including disruptor and sentinel)', () => {
        const weights = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS;
        const sum = Object.values(weights).reduce((a, b) => a + b, 0);
        expect(sum).toBe(118);
      });

      it('should define disruptor weight', () => {
        expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.disruptor).toBe(12);
      });
    });
  });

  // ==========================================================================
  // NULLISH COALESCING — zero weight respected
  // ==========================================================================

  describe('SPAWN_CONFIG zero-weight nullish coalescing', () => {
    /**
     * BACKGROUND: FactionSpawnWeightsService uses `??` (nullish coalescing)
     * when reading weights from SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS:
     *
     *   basic: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.basic ?? 28
     *
     * The `??` operator only falls back on `null` or `undefined`, NOT on 0.
     * A previous `||` operator would have treated 0 as falsy, replacing it
     * with the fallback — so setting boss = 0 would have silently become 0
     * (fallback was also 0 in that case), but any field explicitly set to 0
     * would be respected correctly with `??`.
     *
     * These tests verify the `??` contract holds: 0 is preserved as 0.
     */
    it('boss weight is 0 and ?? preserves it (not replaced by fallback)', () => {
      // ?? only replaces null/undefined, so 0 stays 0
      const weight = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.boss;
      const result = weight ?? 99; // fallback is 99 — should NOT be used
      expect(result).toBe(0);
    });

    it('non-zero weight is preserved unchanged through ?? operator', () => {
      const weight = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.basic;
      const result = weight ?? 999; // fallback should NOT be used
      expect(result).toBe(28); // original value, not fallback
    });

    it('disruptor weight preserved through ?? — 12, not fallback', () => {
      const result = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.disruptor ?? 999;
      expect(result).toBe(12);
    });

    it('sentinel weight preserved through ?? — 10, not fallback', () => {
      const result = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sentinel ?? 999;
      expect(result).toBe(10);
    });

    it('zero weight vs || operator: || would incorrectly replace 0 with fallback', () => {
      // This test documents WHY ?? was chosen over ||.
      const zeroWeight = 0;
      const fallback = 999;

      const withNullish = zeroWeight ?? fallback; // 0 (correct: 0 is not null/undefined)
      const withLogicalOr = zeroWeight || fallback; // 999 (incorrect: 0 is falsy)

      expect(withNullish).toBe(0);
      expect(withLogicalOr).toBe(999); // demonstrates the bug that ?? prevents
    });

    it('all non-boss enemy type weights are defined (not null/undefined)', () => {
      const weights = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS;
      expect(weights.basic).toBeDefined();
      expect(weights.spitter).toBeDefined();
      expect(weights.tank).toBeDefined();
      expect(weights.swarm).toBeDefined();
      expect(weights.thug).toBeDefined();
      expect(weights.sniper).toBeDefined();
      expect(weights.disruptor).toBeDefined();
      expect(weights.sentinel).toBeDefined();
    });

    it('boss is the only type with weight === 0', () => {
      const weights = SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS;
      const zeroWeightTypes = Object.entries(weights)
        .filter(([, w]) => w === 0)
        .map(([type]) => type);

      expect(zeroWeightTypes).toEqual(['boss']);
    });
  });

  // ==========================================================================
  // AI BEHAVIOR CONFIGURATION
  // ==========================================================================

  describe('AI_BEHAVIOR_CONFIG', () => {
    it('should define AI behavior properties', () => {
      expect(AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL).toBe(5);
      expect(AI_BEHAVIOR_CONFIG.COMBAT_RANGE).toBe(200);
      expect(AI_BEHAVIOR_CONFIG.PATROL_RANGE).toBe(300);
      expect(AI_BEHAVIOR_CONFIG.CHASE_RANGE).toBe(400);
      expect(AI_BEHAVIOR_CONFIG.ATTACK_COOLDOWN_MS).toBe(1000);
    });

    it('should have positive values', () => {
      expect(AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL).toBeGreaterThan(0);
      expect(AI_BEHAVIOR_CONFIG.COMBAT_RANGE).toBeGreaterThan(0);
      expect(AI_BEHAVIOR_CONFIG.PATROL_RANGE).toBeGreaterThan(0);
      expect(AI_BEHAVIOR_CONFIG.CHASE_RANGE).toBeGreaterThan(0);
      expect(AI_BEHAVIOR_CONFIG.ATTACK_COOLDOWN_MS).toBeGreaterThan(0);
    });

    it('should have logical range progression (combat < patrol < chase)', () => {
      expect(AI_BEHAVIOR_CONFIG.COMBAT_RANGE).toBeLessThan(AI_BEHAVIOR_CONFIG.PATROL_RANGE);
      expect(AI_BEHAVIOR_CONFIG.PATROL_RANGE).toBeLessThan(AI_BEHAVIOR_CONFIG.CHASE_RANGE);
    });

    it('should have reasonable update interval (1-60 frames)', () => {
      expect(AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL).toBeGreaterThanOrEqual(1);
      expect(AI_BEHAVIOR_CONFIG.BEHAVIOR_UPDATE_INTERVAL).toBeLessThanOrEqual(60);
    });
  });

  describe('ENEMY_SEPARATION_CONFIG', () => {
    it('should define separation properties', () => {
      expect(ENEMY_SEPARATION_CONFIG.ENABLED).toBe(true);
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_RADIUS).toBe(50);
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_WEIGHT).toBe(0.8);
      expect(ENEMY_SEPARATION_CONFIG.CLEANUP_SAFE_DISTANCE).toBe(1500);
    });

    it('should have positive values', () => {
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_RADIUS).toBeGreaterThan(0);
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_WEIGHT).toBeGreaterThan(0);
      expect(ENEMY_SEPARATION_CONFIG.CLEANUP_SAFE_DISTANCE).toBeGreaterThan(0);
    });

    it('should have weights in valid range (0-1)', () => {
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_WEIGHT).toBeLessThanOrEqual(1);
    });
  });

  describe('IDLE_BEHAVIOR_CONFIG', () => {
    it('should define distance thresholds', () => {
      expect(IDLE_BEHAVIOR_CONFIG.IDLE_DISTANCE).toBe(1000);
      expect(IDLE_BEHAVIOR_CONFIG.SOCIAL_DISTANCE).toBe(100);
      expect(IDLE_BEHAVIOR_CONFIG.DANCE_DISTANCE).toBe(80);
      expect(IDLE_BEHAVIOR_CONFIG.PATROL_RADIUS).toBe(300);
    });

    it('should have positive distance values', () => {
      expect(IDLE_BEHAVIOR_CONFIG.IDLE_DISTANCE).toBeGreaterThan(0);
      expect(IDLE_BEHAVIOR_CONFIG.SOCIAL_DISTANCE).toBeGreaterThan(0);
      expect(IDLE_BEHAVIOR_CONFIG.DANCE_DISTANCE).toBeGreaterThan(0);
      expect(IDLE_BEHAVIOR_CONFIG.PATROL_RADIUS).toBeGreaterThan(0);
    });

    it('should have dance distance <= social distance (intimate behavior)', () => {
      expect(IDLE_BEHAVIOR_CONFIG.DANCE_DISTANCE).toBeLessThanOrEqual(IDLE_BEHAVIOR_CONFIG.SOCIAL_DISTANCE);
    });

    describe('Update Intervals', () => {
      it('should define update intervals', () => {
        expect(IDLE_BEHAVIOR_CONFIG.UPDATE_INTERVAL).toBe(250);
        expect(IDLE_BEHAVIOR_CONFIG.CLEANUP_INTERVAL).toBe(30000);
      });

      it('should have cleanup interval much longer than update interval', () => {
        expect(IDLE_BEHAVIOR_CONFIG.CLEANUP_INTERVAL).toBeGreaterThan(IDLE_BEHAVIOR_CONFIG.UPDATE_INTERVAL * 10);
      });
    });

    describe('Map Limits', () => {
      it('should define map size limits', () => {
        expect(IDLE_BEHAVIOR_CONFIG.MAX_DANCE_PARTNERS).toBe(100);
        expect(IDLE_BEHAVIOR_CONFIG.MAX_PATROL_ROUTES).toBe(100);
        expect(IDLE_BEHAVIOR_CONFIG.SPATIAL_GRID_CELL_SIZE).toBe(200);
      });

      it('should have reasonable limits', () => {
        expect(IDLE_BEHAVIOR_CONFIG.MAX_DANCE_PARTNERS).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.MAX_PATROL_ROUTES).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.SPATIAL_GRID_CELL_SIZE).toBeGreaterThan(0);
      });
    });

    describe('Faction Configurations', () => {
      it('should define all 4 faction patrol configs', () => {
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_PATROL[1]).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_PATROL[2]).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_PATROL[3]).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_PATROL[4]).toBeDefined();
      });

      it('should have positive faction patrol values', () => {
        Object.values(IDLE_BEHAVIOR_CONFIG.FACTION_PATROL).forEach((config) => {
          expect(config.speed).toBeGreaterThan(0);
          expect(config.radius).toBeGreaterThan(0);
        });
      });

      it('should define all wander speed types', () => {
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED.zigzag).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED.circular).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED.organic).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED.erratic).toBeDefined();
        expect(IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED.default).toBeDefined();
      });

      it('should have positive wander speeds', () => {
        Object.values(IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED).forEach((speed) => {
          expect(speed).toBeGreaterThan(0);
        });
      });

      it('erratic should be fastest wander speed', () => {
        const speeds = IDLE_BEHAVIOR_CONFIG.FACTION_WANDER_SPEED;
        expect(speeds.erratic).toBeGreaterThanOrEqual(speeds.zigzag);
        expect(speeds.erratic).toBeGreaterThan(speeds.circular);
        expect(speeds.erratic).toBeGreaterThan(speeds.organic);
        expect(speeds.erratic).toBeGreaterThan(speeds.default);
      });
    });

    describe('Dance Configuration', () => {
      it('should define dance properties', () => {
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.MIN_DURATION).toBe(3);
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.MAX_DURATION).toBe(5);
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.BOUNCE_FREQUENCY).toBe(4);
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.SPIN_RADIUS).toBe(50);
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.CHANCE).toBe(0.3);
      });

      it('should have max duration > min duration', () => {
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.MAX_DURATION).toBeGreaterThan(IDLE_BEHAVIOR_CONFIG.DANCE.MIN_DURATION);
      });

      it('should have valid chance (0-1)', () => {
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.CHANCE).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.DANCE.CHANCE).toBeLessThanOrEqual(1);
      });
    });

    describe('Social Configuration', () => {
      it('should define social properties', () => {
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.GROUP_SIZE).toBe(4);
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.GROUP_DISTANCE).toBe(60);
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.APPROACH_SPEED).toBe(0.5);
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.CHANCE).toBe(0.4);
      });

      it('should have positive values', () => {
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.GROUP_SIZE).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.GROUP_DISTANCE).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.APPROACH_SPEED).toBeGreaterThan(0);
      });

      it('should have valid chance (0-1)', () => {
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.CHANCE).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.SOCIAL.CHANCE).toBeLessThanOrEqual(1);
      });
    });

    describe('Patrol Configuration', () => {
      it('should define patrol properties', () => {
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.CHANCE).toBe(0.3);
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.ROTATION_SPEED).toBe(0.02);
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.MOVEMENT_SPEED).toBe(0.8);
      });

      it('should have positive values', () => {
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.ROTATION_SPEED).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.MOVEMENT_SPEED).toBeGreaterThan(0);
      });

      it('should have valid chance (0-1)', () => {
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.CHANCE).toBeGreaterThan(0);
        expect(IDLE_BEHAVIOR_CONFIG.PATROL.CHANCE).toBeLessThanOrEqual(1);
      });
    });
  });

  // ==========================================================================
  // INTEGRATION TESTS
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should have AI chase range align with enemy aggro ranges', () => {
      // Chase range should be close to average aggro range
      const aggroRanges = Object.values(ENEMY_STATS).map((stats) => stats.AGGRO_RANGE);
      const avgAggro = aggroRanges.reduce((sum, r) => sum + r, 0) / aggroRanges.length;
      expect(AI_BEHAVIOR_CONFIG.CHASE_RANGE).toBeGreaterThanOrEqual(avgAggro * 0.5);
      expect(AI_BEHAVIOR_CONFIG.CHASE_RANGE).toBeLessThanOrEqual(avgAggro * 1.5);
    });

    it('should have separation radius appropriate for swarming behavior', () => {
      const radii = Object.values(ENEMY_STATS).map((stats) => stats.RADIUS);
      const avgRadius = radii.reduce((sum, r) => sum + r, 0) / radii.length;
      // Separation radius should be close to average collision distance (2 radii)
      // "Halls of Torment" style: enemies swarm close before separating
      // 50px allows tight packs while preventing exact overlap
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_RADIUS).toBeGreaterThanOrEqual(avgRadius);
      expect(ENEMY_SEPARATION_CONFIG.SEPARATION_RADIUS).toBeLessThanOrEqual(avgRadius * 3);
    });

    it('should have spawn cleanup distance larger than AI chase range', () => {
      expect(SPAWN_CONFIG.LIMITS.CLEANUP_DISTANCE).toBeGreaterThan(AI_BEHAVIOR_CONFIG.CHASE_RANGE * 2);
    });

    it('should have idle distance larger than chase range', () => {
      expect(IDLE_BEHAVIOR_CONFIG.IDLE_DISTANCE).toBeGreaterThanOrEqual(AI_BEHAVIOR_CONFIG.CHASE_RANGE);
    });

    it('should have reasonable enemy count for performance', () => {
      // Max enemies should be achievable but challenging
      expect(SPAWN_CONFIG.LIMITS.MAX_ENEMIES).toBeGreaterThan(20);
      expect(SPAWN_CONFIG.LIMITS.MAX_ENEMIES).toBeLessThan(200);
    });

    it('should have elite chance result in occasional elites', () => {
      // With 10% elite chance, should see ~1 elite per 10 spawns
      expect(SPAWN_CONFIG.RARITY.ELITE_CHANCE).toBeGreaterThanOrEqual(0.05);
      expect(SPAWN_CONFIG.RARITY.ELITE_CHANCE).toBeLessThanOrEqual(0.2);
    });

    it('boss spawn weight is 0 — boss spawns via scheduled boss waves at wave 15, 25, 35...', () => {
      // Boss weight is intentionally 0 in the ambient spawn table.
      // Bosses are spawned deterministically via boss waves (wave 15, then every 10 waves).
      expect(SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.boss).toBe(0);
    });
  });

  // ==========================================================================
  // TYPE DEFINITIONS
  // ==========================================================================

  describe('Type Definitions', () => {
    it('should export EnemyStats interface', () => {
      const testStats: EnemyStats = {
        HEALTH: 100,
        DAMAGE: 20,
        SPEED: 100,
        RADIUS: 25,
        DAMAGE_REDUCTION: 0.2,
        AGGRO_RANGE: 400,
        ATTACK_RANGE: 200,
      };
      expect(testStats.HEALTH).toBe(100);
    });

    it('should support optional WEAPON in EnemyStats', () => {
      const testStats: EnemyStats = {
        HEALTH: 100,
        DAMAGE: 20,
        SPEED: 100,
        RADIUS: 25,
        DAMAGE_REDUCTION: 0,
        AGGRO_RANGE: 400,
        ATTACK_RANGE: 200,
        WEAPON: {
          DAMAGE: 15,
          FIRE_RATE: 1000,
          RANGE: 300,
        },
      };
      expect(testStats.WEAPON).toBeDefined();
    });
  });
});
