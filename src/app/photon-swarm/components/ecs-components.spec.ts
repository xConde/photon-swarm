/**
 * Consolidated ECS component spec
 *
 * Validates the `constructor(...args: unknown[])` pattern required by ECS
 * ComponentType<T>. None of these are Angular components — TestBed is not used.
 *
 * Each describe block covers:
 *   1. Default construction (no args) → all fields get project-defined defaults
 *   2. Parameterised construction    → fields set correctly via args[]
 *   3. Public methods (where present)
 *   4. Edge cases (zero / negative / null args)
 */

import { AccelerationComponent } from './acceleration.component';
import { AIControlledComponent, BehaviorPattern } from './ai-controlled.component';
import { AsteroidComponent } from './asteroid.component';
import { BeamComponent } from './beam.component';
import { BossPhaseComponent } from './boss-phase.component';
import { BuffComponent } from './buff.component';
import { BurnEffectComponent } from './burn-effect.component';
import { ChargedProjectileComponent } from './charged-projectile.component';
import { ChargingComponent } from './charging.component';
import { CollisionBoxComponent } from './collision-box.component';
import { DamageComponent } from './damage.component';
import { DischargeComponent } from './discharge.component';
import { DischargeEffectComponent } from './discharge-effect.component';
import { EnemyTypeComponent } from './enemy-type.component';
import { FactionComponent } from './faction.component';
import { AsteroidState, FallingAsteroidComponent } from './falling-asteroid.component';
import { FloatingTextComponent } from './floating-text.component';
import { HealthBarDisplayComponent } from './health-bar-display.component';
import { HealthComponent } from './health.component';
import { HitFlashComponent } from './hit-flash.component';
import { InvincibilityComponent } from './invincibility.component';
import { KnockbackComponent } from './knockback.component';
import { PlayerControlledComponent } from './player-controlled.component';
import { PositionComponent } from './position.component';
import { ActivePowerupComponent, PowerupComponent } from './powerup.component';
import { ProjectileComponent } from './projectile.component';
import { RenderableComponent } from './renderable.component';
import { ShardComponent } from './shard.component';
import { SourceTagComponent } from './source-tag.component';
import { SpawnerComponent } from './spawner.component';
import { VelocityComponent } from './velocity.component';
import { WeaponComponent } from './weapon.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spread an unknown[] into a constructor the same way the ECS does at runtime. */
function spreadConstruct<T>(Ctor: new (...args: unknown[]) => T, args: unknown[]): T {
  return new Ctor(...args);
}

// ---------------------------------------------------------------------------
// PositionComponent
// ---------------------------------------------------------------------------

describe('PositionComponent', () => {
  describe('default construction', () => {
    it('should set x and y to 0', () => {
      const c = new PositionComponent();
      expect(c.x).toBe(0);
      expect(c.y).toBe(0);
    });
  });

  describe('parameterised construction', () => {
    it('should set x and y from args', () => {
      const c = new PositionComponent(10, 20);
      expect(c.x).toBe(10);
      expect(c.y).toBe(20);
    });

    it('should handle negative coordinates', () => {
      const c = new PositionComponent(-5, -15);
      expect(c.x).toBe(-5);
      expect(c.y).toBe(-15);
    });
  });

  describe('ECS pattern', () => {
    it('should work when spread from unknown[]', () => {
      const args: unknown[] = [100, 200];
      const c = spreadConstruct(PositionComponent, args);
      expect(c.x).toBe(100);
      expect(c.y).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// VelocityComponent
// ---------------------------------------------------------------------------

describe('VelocityComponent', () => {
  describe('default construction', () => {
    it('should set vx and vy to 0', () => {
      const c = new VelocityComponent();
      expect(c.vx).toBe(0);
      expect(c.vy).toBe(0);
    });
  });

  describe('parameterised construction', () => {
    it('should set vx and vy from args', () => {
      const c = new VelocityComponent(3, -7);
      expect(c.vx).toBe(3);
      expect(c.vy).toBe(-7);
    });
  });

  describe('ECS pattern', () => {
    it('should work when spread from unknown[]', () => {
      const args: unknown[] = [1.5, 2.5];
      const c = spreadConstruct(VelocityComponent, args);
      expect(c.vx).toBe(1.5);
      expect(c.vy).toBe(2.5);
    });
  });
});

// ---------------------------------------------------------------------------
// AccelerationComponent
// ---------------------------------------------------------------------------

describe('AccelerationComponent', () => {
  describe('default construction', () => {
    it('should use project-defined defaults', () => {
      const c = new AccelerationComponent();
      expect(c.currentSpeed).toBe(0);
      expect(c.targetSpeed).toBe(0);
      expect(c.accelerationRate).toBe(0.1);
      expect(c.decelerationRate).toBe(0.15);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all four args', () => {
      const c = new AccelerationComponent(5, 10, 0.2, 0.3);
      expect(c.currentSpeed).toBe(5);
      expect(c.targetSpeed).toBe(10);
      expect(c.accelerationRate).toBe(0.2);
      expect(c.decelerationRate).toBe(0.3);
    });
  });

  describe('lerp()', () => {
    it('should move currentSpeed toward target on acceleration', () => {
      const c = new AccelerationComponent(0, 10, 1.0, 0.5);
      c.lerp(10, 1 / 60); // one frame at 60fps
      expect(c.currentSpeed).toBeGreaterThan(0);
      expect(c.currentSpeed).toBeLessThanOrEqual(10);
    });

    it('should snap to target when within 0.01 tolerance', () => {
      const c = new AccelerationComponent(9.995, 10, 1.0, 0.5);
      c.lerp(10, 1 / 60);
      expect(c.currentSpeed).toBe(10);
    });

    it('should decelerate when above target', () => {
      const c = new AccelerationComponent(10, 0, 0.2, 1.0);
      c.lerp(0, 1 / 60);
      expect(c.currentSpeed).toBeLessThan(10);
    });
  });
});

// ---------------------------------------------------------------------------
// HealthComponent
// ---------------------------------------------------------------------------

describe('HealthComponent', () => {
  describe('default construction', () => {
    it('should use 100 HP defaults to prevent instant death', () => {
      const c = new HealthComponent();
      expect(c.health).toBe(100);
      expect(c.maxHealth).toBe(100);
      expect(c.damageReduction).toBe(0);
      expect(c.isDead).toBe(false);
    });

    it('should initialise tracking flags to false/unknown', () => {
      const c = new HealthComponent();
      expect(c.xpAwarded).toBe(false);
      expect(c.killAwarded).toBe(false);
      expect(c.deathProcessed).toBe(false);
      expect(c.lastDamageSource).toBe('unknown');
    });
  });

  describe('parameterised construction', () => {
    it('should accept health, maxHealth, damageReduction, isDead', () => {
      const c = new HealthComponent(50, 200, 10, true);
      expect(c.health).toBe(50);
      expect(c.maxHealth).toBe(200);
      expect(c.damageReduction).toBe(10);
      expect(c.isDead).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle zero health', () => {
      const c = new HealthComponent(0, 100);
      expect(c.health).toBe(0);
    });

    it('should always initialise xpAwarded to false regardless of args', () => {
      const c = new HealthComponent(100, 100, 0, false);
      expect(c.xpAwarded).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ShardComponent
// ---------------------------------------------------------------------------

describe('ShardComponent', () => {
  describe('default construction', () => {
    it('should default all numeric fields to 0 and booleans to false', () => {
      const c = new ShardComponent();
      expect(c.value).toBe(0);
      expect(c.spawnTime).toBe(0);
      expect(c.glowPhase).toBe(0);
      expect(c.isBeingAttracted).toBe(false);
      expect(c.attractionDistance).toBe(0);
    });
  });

  describe('parameterised construction', () => {
    it('should set all five fields from args', () => {
      const c = new ShardComponent(5, 1000, 0.5, true, 100);
      expect(c.value).toBe(5);
      expect(c.spawnTime).toBe(1000);
      expect(c.glowPhase).toBe(0.5);
      expect(c.isBeingAttracted).toBe(true);
      expect(c.attractionDistance).toBe(100);
    });
  });
});

// ---------------------------------------------------------------------------
// ProjectileComponent
// ---------------------------------------------------------------------------

describe('ProjectileComponent', () => {
  describe('default construction', () => {
    it('should default to safe values', () => {
      const c = new ProjectileComponent();
      expect(c.damage).toBe(0);
      expect(c.lifetime).toBe(0);
      expect(c.spawnTime).toBe(0);
      expect(c.health).toBe(1);
      expect(c.penetrating).toBe(false);
      expect(c.homing).toBe(false);
      expect(c.isCritical).toBe(false);
      expect(c.isPlayerOwned).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should set all eight fields from args', () => {
      const c = new ProjectileComponent(10, 2000, 500, 3, true, true, true, true);
      expect(c.damage).toBe(10);
      expect(c.lifetime).toBe(2000);
      expect(c.spawnTime).toBe(500);
      expect(c.health).toBe(3);
      expect(c.penetrating).toBe(true);
      expect(c.homing).toBe(true);
      expect(c.isCritical).toBe(true);
      expect(c.isPlayerOwned).toBe(true);
    });
  });

  describe('isExpired()', () => {
    it('should return false before lifetime elapses', () => {
      const c = new ProjectileComponent(0, 1000, 0);
      expect(c.isExpired(500)).toBe(false);
    });

    it('should return true after lifetime elapses', () => {
      const c = new ProjectileComponent(0, 1000, 0);
      expect(c.isExpired(1001)).toBe(true);
    });

    it('should return false at exactly lifetime boundary', () => {
      const c = new ProjectileComponent(0, 1000, 0);
      expect(c.isExpired(1000)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// AsteroidComponent
// ---------------------------------------------------------------------------

describe('AsteroidComponent', () => {
  describe('default construction', () => {
    it('should use game-appropriate defaults', () => {
      const c = new AsteroidComponent();
      expect(c.size).toBe(30);
      expect(c.health).toBe(100);
      expect(c.rotationSpeed).toBe(0.5);
      expect(c.damage).toBe(20);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all four fields', () => {
      const c = new AsteroidComponent(60, 200, 1.0, 40);
      expect(c.size).toBe(60);
      expect(c.health).toBe(200);
      expect(c.rotationSpeed).toBe(1.0);
      expect(c.damage).toBe(40);
    });
  });

  describe('static type property', () => {
    it('should expose a type string', () => {
      expect(AsteroidComponent.type).toBe('AsteroidComponent');
    });
  });
});

// ---------------------------------------------------------------------------
// CollisionBoxComponent
// ---------------------------------------------------------------------------

describe('CollisionBoxComponent', () => {
  describe('default construction', () => {
    it('should default radius to 0, group to enemy, collidesWith to all', () => {
      const c = new CollisionBoxComponent();
      expect(c.radius).toBe(0);
      expect(c.collisionGroup).toBe('enemy');
      expect(c.collidesWith).toEqual(['all']);
    });
  });

  describe('parameterised construction', () => {
    it('should accept radius, group and collidesWith array', () => {
      const c = new CollisionBoxComponent(15, 'player', ['enemy', 'asteroid']);
      expect(c.radius).toBe(15);
      expect(c.collisionGroup).toBe('player');
      expect(c.collidesWith).toEqual(['enemy', 'asteroid']);
    });

    it('should accept all valid collision groups', () => {
      const groups: Array<'player' | 'enemy' | 'projectile' | 'shard' | 'asteroid'> = [
        'player',
        'enemy',
        'projectile',
        'shard',
        'asteroid',
      ];
      for (const group of groups) {
        const c = new CollisionBoxComponent(10, group);
        expect(c.collisionGroup).toBe(group);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// FloatingTextComponent
// ---------------------------------------------------------------------------

describe('FloatingTextComponent', () => {
  let mockNow: number;

  beforeEach(() => {
    mockNow = 5000;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);
  });

  describe('default construction', () => {
    it('should use safe display defaults', () => {
      const c = new FloatingTextComponent();
      expect(c.text).toBe('');
      expect(c.color).toBe('#ffffff');
      expect(c.fontSize).toBe(16);
      expect(c.duration).toBe(1000);
      expect(c.offsetX).toBe(0);
      expect(c.offsetY).toBe(-20);
      expect(c.velocityX).toBe(0);
      expect(c.velocityY).toBe(-50);
      expect(c.fadeStart).toBe(0.7);
      expect(c.scale).toBe(1);
    });

    it('should pre-parse white color to RGB', () => {
      const c = new FloatingTextComponent();
      expect(c.colorR).toBe(255);
      expect(c.colorG).toBe(255);
      expect(c.colorB).toBe(255);
    });
  });

  describe('parameterised construction', () => {
    it('should set text, color and fontSize', () => {
      const c = new FloatingTextComponent('-50', '#ff0000', 20);
      expect(c.text).toBe('-50');
      expect(c.color).toBe('#ff0000');
      expect(c.fontSize).toBe(20);
    });

    it('should parse short hex color (#fff)', () => {
      const c = new FloatingTextComponent('', '#0f0');
      expect(c.colorR).toBe(0);
      expect(c.colorG).toBe(255);
      expect(c.colorB).toBe(0);
    });

    it('should parse rgb() color string', () => {
      const c = new FloatingTextComponent('', 'rgb(10, 20, 30)');
      expect(c.colorR).toBe(10);
      expect(c.colorG).toBe(20);
      expect(c.colorB).toBe(30);
    });

    it('should parse rgba() color string', () => {
      const c = new FloatingTextComponent('', 'rgba(100, 150, 200, 0.5)');
      expect(c.colorR).toBe(100);
      expect(c.colorG).toBe(150);
      expect(c.colorB).toBe(200);
    });

    it('should fall back to white for unrecognised color', () => {
      const c = new FloatingTextComponent('', 'notacolor');
      expect(c.colorR).toBe(255);
      expect(c.colorG).toBe(255);
      expect(c.colorB).toBe(255);
    });
  });

  describe('getOpacity()', () => {
    it('should return 1 before fade starts', () => {
      const c = new FloatingTextComponent('', '#fff', 16, 1000, mockNow);
      expect(c.getOpacity(mockNow + 500)).toBe(1); // 50% elapsed < 70% fadeStart
    });

    it('should return 0 after duration', () => {
      const c = new FloatingTextComponent('', '#fff', 16, 1000, mockNow);
      expect(c.getOpacity(mockNow + 1000)).toBe(0);
    });

    it('should return value between 0 and 1 during fade window', () => {
      const c = new FloatingTextComponent('', '#fff', 16, 1000, mockNow);
      const opacity = c.getOpacity(mockNow + 850);
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
    });
  });

  describe('isExpired()', () => {
    it('should return false before duration', () => {
      const c = new FloatingTextComponent('', '#fff', 16, 1000, mockNow);
      expect(c.isExpired(mockNow + 999)).toBe(false);
    });

    it('should return true at or past duration', () => {
      const c = new FloatingTextComponent('', '#fff', 16, 1000, mockNow);
      expect(c.isExpired(mockNow + 1000)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// ChargingComponent
// ---------------------------------------------------------------------------

describe('ChargingComponent', () => {
  describe('default construction', () => {
    it('should create with ECS-compatible constructor', () => {
      const c = new ChargingComponent();
      expect(c).toBeTruthy();
    });

    it('should accept any unknown[] args without throwing', () => {
      const args: unknown[] = [1, 2, 3];
      expect(() => spreadConstruct(ChargingComponent, args)).not.toThrow();
    });
  });

  describe('getCurrentChargeLevel()', () => {
    it('should start at 0 charge', () => {
      const c = new ChargingComponent();
      expect(c.getCurrentChargeLevel()).toBe(0);
    });
  });

  describe('serialize()', () => {
    it('should return a serialised state object with expected keys', () => {
      const c = new ChargingComponent();
      const state = c.serialize();
      expect(typeof state.chargeLevel).toBe('number');
      expect(typeof state.lastFireTime).toBe('number');
      expect(typeof state.lastMovementTime).toBe('number');
      expect(typeof state.isCurrentlyMoving).toBe('boolean');
    });
  });

  describe('ChargingComponent.deserialize()', () => {
    it('should restore charge level within valid range', () => {
      const restored = ChargingComponent.deserialize({ chargeLevel: 0.8 });
      expect(restored.getCurrentChargeLevel()).toBe(0.8);
    });

    it('should clamp charge level to [0, 1]', () => {
      const tooHigh = ChargingComponent.deserialize({ chargeLevel: 5 });
      expect(tooHigh.getCurrentChargeLevel()).toBe(1);

      const tooLow = ChargingComponent.deserialize({ chargeLevel: -1 });
      expect(tooLow.getCurrentChargeLevel()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// BuffComponent
// ---------------------------------------------------------------------------

describe('BuffComponent', () => {
  describe('default construction', () => {
    it('should default multipliers to neutral (1.0)', () => {
      const c = new BuffComponent();
      expect(c.damageMultiplier).toBe(1.0);
      expect(c.criticalMultiplier).toBe(1.0);
      expect(c.speedMultiplier).toBe(1.0);
      expect(c.fireRateMultiplier).toBe(1.0);
      expect(c.healingMultiplier).toBe(1.0);
      expect(c.experienceMultiplier).toBe(1.0);
    });

    it('should default chance/reduction fields to 0', () => {
      const c = new BuffComponent();
      expect(c.damageReduction).toBe(0);
      expect(c.criticalChance).toBe(0);
    });

    it('should create an empty activeBuffs set', () => {
      const c = new BuffComponent();
      expect(c.activeBuffs.size).toBe(0);
    });
  });

  describe('addBuff / hasBuff / removeBuff', () => {
    it('should add, detect, and remove a buff by name', () => {
      const c = new BuffComponent();
      c.addBuff('fire');
      expect(c.hasBuff('fire')).toBe(true);
      c.removeBuff('fire');
      expect(c.hasBuff('fire')).toBe(false);
    });
  });

  describe('getActiveBuffs()', () => {
    it('should return array of active buff names', () => {
      const c = new BuffComponent();
      c.addBuff('ice');
      c.addBuff('shock');
      expect(c.getActiveBuffs()).toContain('ice');
      expect(c.getActiveBuffs()).toContain('shock');
    });
  });

  describe('clearBuffs()', () => {
    it('should reset all multipliers and empty the set', () => {
      const c = new BuffComponent(2.0, 0.5, 0.3, 3.0, 1.5, 2.0, 1.2, 1.8, new Set(['x']));
      c.clearBuffs();
      expect(c.damageMultiplier).toBe(1.0);
      expect(c.activeBuffs.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// KnockbackComponent
// ---------------------------------------------------------------------------

describe('KnockbackComponent', () => {
  describe('default construction', () => {
    it('should default velocities to 0 and duration to 300ms', () => {
      const c = new KnockbackComponent();
      expect(c.knockbackVelocityX).toBe(0);
      expect(c.knockbackVelocityY).toBe(0);
      expect(c.knockbackTimer).toBe(300);
      expect(c.maxKnockbackTime).toBe(300);
      expect(c.isActive).toBe(true);
    });
  });

  describe('parameterised construction', () => {
    it('should accept vx, vy, and duration', () => {
      const c = new KnockbackComponent(100, -50, 500);
      expect(c.knockbackVelocityX).toBe(100);
      expect(c.knockbackVelocityY).toBe(-50);
      expect(c.knockbackTimer).toBe(500);
      expect(c.isActive).toBe(true);
    });

    it('should be inactive when duration is 0', () => {
      const c = new KnockbackComponent(0, 0, 0);
      expect(c.isActive).toBe(false);
    });
  });

  describe('update()', () => {
    it('should decrease timer and remain active', () => {
      const c = new KnockbackComponent(10, 0, 300);
      const active = c.update(100);
      expect(active).toBe(true);
      expect(c.knockbackTimer).toBe(200);
    });

    it('should deactivate and zero velocities when timer expires', () => {
      const c = new KnockbackComponent(10, 0, 100);
      const active = c.update(100);
      expect(active).toBe(false);
      expect(c.isActive).toBe(false);
      expect(c.knockbackVelocityX).toBe(0);
    });
  });

  describe('getCurrentVelocity()', () => {
    it('should return zeros when inactive', () => {
      const c = new KnockbackComponent(0, 0, 0);
      expect(c.getCurrentVelocity()).toEqual({ vx: 0, vy: 0 });
    });

    it('should return decayed velocity when active', () => {
      const c = new KnockbackComponent(100, 0, 300);
      const vel = c.getCurrentVelocity();
      expect(vel.vx).toBeGreaterThan(0);
      expect(vel.vx).toBeLessThanOrEqual(100);
    });
  });

  describe('addKnockback()', () => {
    it('should accumulate velocities and extend timer', () => {
      const c = new KnockbackComponent(10, 0, 100);
      c.addKnockback(20, 5, 200);
      expect(c.knockbackVelocityX).toBe(30);
      expect(c.knockbackVelocityY).toBe(5);
      expect(c.knockbackTimer).toBe(200);
    });
  });
});

// ---------------------------------------------------------------------------
// HitFlashComponent
// ---------------------------------------------------------------------------

describe('HitFlashComponent', () => {
  describe('default construction', () => {
    it('should default intensity=1, duration=100, color=#ffffff', () => {
      const c = new HitFlashComponent();
      expect(c.intensity).toBe(1.0);
      expect(c.duration).toBe(100);
      expect(c.color).toBe('#ffffff');
    });
  });

  describe('parameterised construction', () => {
    it('should accept intensity, duration, startTime, color', () => {
      const c = new HitFlashComponent(0.5, 200, 1000, '#ff0000');
      expect(c.intensity).toBe(0.5);
      expect(c.duration).toBe(200);
      expect(c.startTime).toBe(1000);
      expect(c.color).toBe('#ff0000');
    });
  });

  describe('isExpired()', () => {
    it('should use Date.now() internally — verify after immediate construction', () => {
      // Create with an explicit startTime far in the past
      const c = new HitFlashComponent(1.0, 100, 0);
      // 100ms duration from t=0, current Date.now() >> 100ms
      expect(c.isExpired()).toBe(true);
    });

    it('should not be expired right after construction with current time', () => {
      const start = Date.now();
      const c = new HitFlashComponent(1.0, 10000, start);
      expect(c.isExpired()).toBe(false);
    });
  });

  describe('getCurrentIntensity()', () => {
    it('should return 0 when expired', () => {
      const c = new HitFlashComponent(1.0, 100, 0);
      expect(c.getCurrentIntensity()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// InvincibilityComponent
// ---------------------------------------------------------------------------

describe('InvincibilityComponent', () => {
  let mockNow: number;

  beforeEach(() => {
    mockNow = 10000;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);
  });

  describe('default construction', () => {
    it('should initialise with duration=1000 and startTime via performance.now()', () => {
      const c = new InvincibilityComponent();
      expect(c.duration).toBe(1000);
      expect(c.startTime).toBe(10000);
    });
  });

  describe('ECS pattern', () => {
    it('should ignore unknown[] args', () => {
      const args: unknown[] = ['anything', 42];
      expect(() => spreadConstruct(InvincibilityComponent, args)).not.toThrow();
    });
  });

  describe('isActive()', () => {
    it('should return true within duration window', () => {
      const c = new InvincibilityComponent();
      // mockNow is still 10000 — same as startTime, within 1000ms duration
      expect(c.isActive()).toBe(true);
    });

    it('should return false after duration expires', () => {
      const c = new InvincibilityComponent();
      mockNow = 11001; // past startTime + duration
      expect(c.isActive()).toBe(false);
    });
  });

  describe('getRemainingTime()', () => {
    it('should return positive value within window', () => {
      const c = new InvincibilityComponent();
      expect(c.getRemainingTime()).toBeGreaterThan(0);
    });

    it('should return 0 after expiry', () => {
      const c = new InvincibilityComponent();
      mockNow = 12000;
      expect(c.getRemainingTime()).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// BurnEffectComponent
// ---------------------------------------------------------------------------

describe('BurnEffectComponent', () => {
  describe('default construction', () => {
    it('should default damage to 0, duration to 500, canSpread to false', () => {
      const c = new BurnEffectComponent();
      expect(c.burnDamage).toBe(0);
      expect(c.burnDuration).toBe(500);
      expect(c.burnVisualIntensity).toBe(1);
      expect(c.canSpread).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all six fields', () => {
      const c = new BurnEffectComponent(15, 2000, 1000, 500, 0.5, true);
      expect(c.burnDamage).toBe(15);
      expect(c.burnDuration).toBe(2000);
      expect(c.burnStartTime).toBe(1000);
      expect(c.lastBurnTick).toBe(500);
      expect(c.burnVisualIntensity).toBe(0.5);
      expect(c.canSpread).toBe(true);
    });
  });

  describe('isExpired()', () => {
    it('should return false before duration', () => {
      const c = new BurnEffectComponent(0, 1000, 0);
      expect(c.isExpired(999)).toBe(false);
    });

    it('should return true after duration', () => {
      const c = new BurnEffectComponent(0, 1000, 0);
      expect(c.isExpired(1001)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// DischargeComponent
// ---------------------------------------------------------------------------

describe('DischargeComponent', () => {
  describe('default construction', () => {
    it('should use game-balanced defaults', () => {
      const c = new DischargeComponent();
      expect(c.radius).toBe(200);
      expect(c.damage).toBe(50);
      expect(c.cooldown).toBe(5000);
      expect(c.lastUseTime).toBe(0);
      expect(c.maxCharges).toBe(1);
      expect(c.currentCharges).toBe(1);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all six args via type narrowing', () => {
      const c = new DischargeComponent(300, 100, 3000, 1000, 2, 2);
      expect(c.radius).toBe(300);
      expect(c.damage).toBe(100);
      expect(c.cooldown).toBe(3000);
      expect(c.lastUseTime).toBe(1000);
      expect(c.maxCharges).toBe(2);
      expect(c.currentCharges).toBe(2);
    });
  });

  describe('canDischarge()', () => {
    it('should return true when charges are available', () => {
      const c = new DischargeComponent(200, 50, 5000, 0, 1, 1);
      expect(c.canDischarge(100)).toBe(true);
    });

    it('should return true when cooldown has elapsed', () => {
      const c = new DischargeComponent(200, 50, 5000, 0, 1, 0);
      expect(c.canDischarge(5001)).toBe(true);
    });

    it('should return false when no charges and within cooldown', () => {
      const c = new DischargeComponent(200, 50, 5000, 1000, 1, 0);
      expect(c.canDischarge(2000)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// DischargeEffectComponent
// ---------------------------------------------------------------------------

describe('DischargeEffectComponent', () => {
  describe('default construction', () => {
    it('should start small and expand', () => {
      const c = new DischargeEffectComponent();
      expect(c.radius).toBe(5);
      expect(c.maxRadius).toBe(50);
      expect(c.expansionRate).toBe(150);
      expect(c.duration).toBe(0.3);
      expect(c.elapsed).toBe(0);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all five args', () => {
      const c = new DischargeEffectComponent(10, 100, 200, 0.5, 0.1);
      expect(c.radius).toBe(10);
      expect(c.maxRadius).toBe(100);
      expect(c.expansionRate).toBe(200);
      expect(c.duration).toBe(0.5);
      expect(c.elapsed).toBe(0.1);
    });
  });

  describe('update()', () => {
    it('should expand radius over time', () => {
      const c = new DischargeEffectComponent(5, 50, 150, 0.3, 0);
      c.update(100); // 100ms
      expect(c.radius).toBeGreaterThan(5);
    });

    it('should not exceed maxRadius', () => {
      const c = new DischargeEffectComponent(5, 50, 1000000, 0.3, 0);
      c.update(100);
      expect(c.radius).toBeLessThanOrEqual(50);
    });
  });

  describe('isExpired()', () => {
    it('should return false before duration', () => {
      const c = new DischargeEffectComponent(5, 50, 150, 0.3, 0);
      expect(c.isExpired()).toBe(false);
    });

    it('should return true when elapsed >= duration', () => {
      const c = new DischargeEffectComponent(5, 50, 150, 0.3, 0.3);
      expect(c.isExpired()).toBe(true);
    });
  });

  describe('clone()', () => {
    it('should produce an independent copy', () => {
      const c = new DischargeEffectComponent(10, 100, 200, 0.5, 0.1);
      const copy = c.clone();
      expect(copy.radius).toBe(c.radius);
      expect(copy).not.toBe(c);
    });
  });
});

// ---------------------------------------------------------------------------
// PowerupComponent
// ---------------------------------------------------------------------------

describe('PowerupComponent', () => {
  describe('default construction', () => {
    it('should initialise with damage_multiplier type and default values', () => {
      const c = new PowerupComponent();
      expect(c.type).toBe('damage_multiplier');
      expect(c.value).toBe(1);
      expect(c.duration).toBe(5000);
      expect(c.isActive).toBe(true);
    });
  });

  describe('ECS pattern', () => {
    it('should accept and ignore unknown args', () => {
      const args: unknown[] = ['ignored', 99];
      expect(() => spreadConstruct(PowerupComponent, args)).not.toThrow();
    });
  });

  describe('configure()', () => {
    it('should update type, value, duration and respawnTime', () => {
      const c = new PowerupComponent();
      c.configure('health', 50, 10000, 30000);
      expect(c.type).toBe('health');
      expect(c.value).toBe(50);
      expect(c.visualEffect.color).toBe('#00ff00');
    });

    it('should set non-health visualEffect color to #ff0000', () => {
      const c = new PowerupComponent();
      c.configure('speed', 1.5, 5000, 10000);
      expect(c.visualEffect.color).toBe('#ff0000');
    });
  });
});

// ---------------------------------------------------------------------------
// ActivePowerupComponent
// ---------------------------------------------------------------------------

describe('ActivePowerupComponent', () => {
  let mockNow: number;

  beforeEach(() => {
    mockNow = 0;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);
  });

  describe('default construction', () => {
    it('should start with empty activePowerups array', () => {
      const c = new ActivePowerupComponent();
      expect(c.activePowerups).toEqual([]);
    });
  });

  describe('addPowerup() / hasPowerup()', () => {
    it('should add and detect a powerup', () => {
      const c = new ActivePowerupComponent();
      c.addPowerup('speed', 1.5, 5000);
      expect(c.hasPowerup('speed')).toBe(true);
    });
  });

  describe('getDamageMultiplier()', () => {
    it('should return 1 with no active damage multiplier', () => {
      const c = new ActivePowerupComponent();
      expect(c.getDamageMultiplier()).toBe(1);
    });

    it('should multiply damage multipliers together', () => {
      const c = new ActivePowerupComponent();
      mockNow = 0;
      c.addPowerup('damage_multiplier', 2, 5000);
      c.addPowerup('damage_multiplier', 1.5, 5000);
      expect(c.getDamageMultiplier()).toBe(3);
    });
  });

  describe('getTimeRemaining()', () => {
    it('should return 0 for non-existent powerup', () => {
      const c = new ActivePowerupComponent();
      expect(c.getTimeRemaining('shield')).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// WeaponComponent
// ---------------------------------------------------------------------------

describe('WeaponComponent', () => {
  describe('default construction', () => {
    it('should default damage and fireRate to 0', () => {
      const c = new WeaponComponent();
      expect(c.damage).toBe(0);
      expect(c.fireRate).toBe(0);
      expect(c.lastShotTime).toBe(0);
      expect(c.projectileSpeed).toBe(200);
      expect(c.projectileRadius).toBe(5);
      expect(c.projectileColor).toBe('#ff6b6b');
      expect(c.projectileLifetime).toBe(3000);
      expect(c.burstCount).toBe(1);
      expect(c.burstDelay).toBe(100);
      expect(c.chargedShotChance).toBe(0);
      expect(c.readyToFire).toBe(false);
      expect(c.isAiming).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should accept damage and fireRate as first two args', () => {
      const c = new WeaponComponent(25, 500);
      expect(c.damage).toBe(25);
      expect(c.fireRate).toBe(500);
    });
  });

  describe('canFire()', () => {
    it('should return true when fireRate has elapsed', () => {
      const c = new WeaponComponent(10, 500, 0);
      expect(c.canFire(501)).toBe(true);
    });

    it('should return false within cooldown', () => {
      const c = new WeaponComponent(10, 500, 1000);
      expect(c.canFire(1200)).toBe(false);
    });
  });

  describe('getCooldownProgress()', () => {
    it('should return 0 immediately after shot', () => {
      const c = new WeaponComponent(10, 1000, 500);
      expect(c.getCooldownProgress(500)).toBe(0);
    });

    it('should return 1 when cooldown complete', () => {
      const c = new WeaponComponent(10, 1000, 0);
      expect(c.getCooldownProgress(1000)).toBe(1);
    });
  });

  describe('getAimProgress()', () => {
    it('should return 0 when not aiming', () => {
      const c = new WeaponComponent();
      expect(c.getAimProgress(1000)).toBe(0);
    });
  });

  describe('isAimComplete()', () => {
    it('should return false when not aiming', () => {
      const c = new WeaponComponent();
      expect(c.isAimComplete(1000)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// SpawnerComponent
// ---------------------------------------------------------------------------

describe('SpawnerComponent', () => {
  describe('default construction', () => {
    it('should default spawnType to empty string, maxSpawns to -1', () => {
      const c = new SpawnerComponent();
      expect(c.spawnType).toBe('');
      expect(c.spawnRate).toBe(1000);
      expect(c.lastSpawnTime).toBe(0);
      expect(c.maxSpawns).toBe(-1);
      expect(c.spawnCount).toBe(0);
      expect(c.spawnOnDeath).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all six fields', () => {
      const c = new SpawnerComponent('asteroid', 2000, 500, 5, 3, true);
      expect(c.spawnType).toBe('asteroid');
      expect(c.spawnRate).toBe(2000);
      expect(c.lastSpawnTime).toBe(500);
      expect(c.maxSpawns).toBe(5);
      expect(c.spawnCount).toBe(3);
      expect(c.spawnOnDeath).toBe(true);
    });
  });

  describe('canSpawn()', () => {
    it('should return true when rate elapsed and unlimited', () => {
      const c = new SpawnerComponent('x', 1000, 0, -1, 0, false);
      expect(c.canSpawn(1001)).toBe(true);
    });

    it('should return false when maxSpawns reached', () => {
      const c = new SpawnerComponent('x', 1000, 0, 5, 5, false);
      expect(c.canSpawn(9999)).toBe(false);
    });

    it('should return false within spawnRate cooldown', () => {
      const c = new SpawnerComponent('x', 1000, 500, -1, 0, false);
      expect(c.canSpawn(1000)).toBe(false);
    });
  });
});

// FactionComponent
// ---------------------------------------------------------------------------

describe('FactionComponent', () => {
  describe('default construction', () => {
    it('should default kingId to 0 and loyalty to 1.0', () => {
      const c = new FactionComponent();
      expect(c.kingId).toBe(0);
      expect(c.kingName).toBe('');
      expect(c.loyalty).toBe(1.0);
      expect(c.aggressionLevel).toBe(1.0);
      expect(c.behaviors).toEqual([]);
      expect(c.hostileFactions).toEqual([]);
    });
  });

  describe('parameterised construction', () => {
    it('should accept kingId, kingName, loyalty and aggressionLevel', () => {
      const c = new FactionComponent(1, 'Crimson', 0.8, 1.4);
      expect(c.kingId).toBe(1);
      expect(c.kingName).toBe('Crimson');
      expect(c.loyalty).toBe(0.8);
      expect(c.aggressionLevel).toBe(1.4);
    });
  });

  describe('isHostileTo()', () => {
    it('should return false with empty hostileFactions', () => {
      const c = new FactionComponent(1, 'Crimson', 1.0, 1.0, undefined, undefined, []);
      expect(c.isHostileTo(2)).toBe(false);
    });

    it('should return true for faction in hostileFactions list', () => {
      const c = new FactionComponent(1, 'Crimson', 1.0, 1.0, undefined, undefined, [2, 3]);
      expect(c.isHostileTo(2)).toBe(true);
      expect(c.isHostileTo(4)).toBe(false);
    });
  });

  describe('getBehaviorModifier()', () => {
    it('should return 1.0 for unknown behavior type', () => {
      const c = new FactionComponent();
      expect(c.getBehaviorModifier('speed')).toBe(1.0);
    });
  });
});

// ---------------------------------------------------------------------------
// EnemyTypeComponent
// ---------------------------------------------------------------------------

describe('EnemyTypeComponent', () => {
  describe('default construction', () => {
    it('should default to Basic/Common/Passive with no elite status', () => {
      const c = new EnemyTypeComponent();
      expect(c.type).toBe('basic');
      expect(c.rarity).toBe('common');
      expect(c.alertState).toBe('passive');
      expect(c.isElite).toBe(false);
      expect(c.rankLevel).toBe(0);
      expect(c.shardMultiplier).toBe(1);
      expect(c.damageMultiplier).toBe(1);
    });
  });

  describe('parameterised construction', () => {
    it('should accept type, rarity, alertState, isElite, rankLevel', () => {
      const c = new EnemyTypeComponent('boss', 'legendary', 'aggressive', true, 3, 5, 2);
      expect(c.type).toBe('boss');
      expect(c.rarity).toBe('legendary');
      expect(c.alertState).toBe('aggressive');
      expect(c.isElite).toBe(true);
      expect(c.rankLevel).toBe(3);
      expect(c.shardMultiplier).toBe(5);
      expect(c.damageMultiplier).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// BossPhaseComponent
// ---------------------------------------------------------------------------

describe('BossPhaseComponent', () => {
  describe('default construction', () => {
    it('should start at phase 1 of 4 with standard thresholds', () => {
      const c = new BossPhaseComponent();
      expect(c.currentPhase).toBe(1);
      expect(c.maxPhases).toBe(4);
      expect(c.phaseThresholds).toEqual([0.75, 0.5, 0.25]);
      expect(c.phaseTransitioning).toBe(false);
      expect(c.cooldownMultiplier).toBe(1.0);
      expect(c.speedMultiplier).toBe(1.0);
    });
  });

  describe('parameterised construction', () => {
    it('should accept currentPhase, maxPhases and custom thresholds', () => {
      const c = new BossPhaseComponent(2, 3, [0.6, 0.3]);
      expect(c.currentPhase).toBe(2);
      expect(c.maxPhases).toBe(3);
      expect(c.phaseThresholds).toEqual([0.6, 0.3]);
    });
  });
});

// ---------------------------------------------------------------------------
// RenderableComponent
// ---------------------------------------------------------------------------

describe('RenderableComponent', () => {
  describe('construction', () => {
    it('should accept color as first arg with world layer defaults', () => {
      const c = new RenderableComponent('#00ff00');
      expect(c.color).toBe('#00ff00');
      expect(c.renderLayer).toBe('world');
      expect(c.visible).toBe(true);
      expect(c.opacity).toBe(1);
      expect(c.glowIntensity).toBe(0);
    });

    it('should accept all five args', () => {
      const c = new RenderableComponent('#ff0000', 'effects', false, 0.5, 0.8);
      expect(c.color).toBe('#ff0000');
      expect(c.renderLayer).toBe('effects');
      expect(c.visible).toBe(false);
      expect(c.opacity).toBe(0.5);
      expect(c.glowIntensity).toBe(0.8);
    });

    it('color should be undefined when no args passed (not defaulted by component)', () => {
      const c = new RenderableComponent();
      // color has no ?? default — it is assigned as-is from args[0]
      expect(c.color).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// SourceTagComponent
// ---------------------------------------------------------------------------

describe('SourceTagComponent', () => {
  describe('default construction', () => {
    it('should default source to neutral with no shooterId or isReflected', () => {
      const c = new SourceTagComponent();
      expect(c.source).toBe('neutral');
      expect(c.shooterId).toBeUndefined();
      expect(c.isReflected).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should accept source, shooterId and isReflected', () => {
      const c = new SourceTagComponent('player', 42, true);
      expect(c.source).toBe('player');
      expect(c.shooterId).toBe(42);
      expect(c.isReflected).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// AIControlledComponent
// ---------------------------------------------------------------------------

describe('AIControlledComponent', () => {
  describe('default construction', () => {
    it('should default to Direct behavior and 300 detection range', () => {
      const c = new AIControlledComponent();
      expect(c.behaviorPattern).toBe(BehaviorPattern.Direct);
      expect(c.originalBehaviorPattern).toBe(BehaviorPattern.Direct);
      expect(c.detectionRange).toBe(300);
      expect(c.aiVisualState).toBe('idle');
      expect(c.isCharging).toBe(false);
      expect(c.isDancing).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should accept behaviorPattern and detectionRange', () => {
      const c = new AIControlledComponent(BehaviorPattern.Orbit, undefined, 500);
      expect(c.behaviorPattern).toBe(BehaviorPattern.Orbit);
      expect(c.detectionRange).toBe(500);
    });
  });
});

// ---------------------------------------------------------------------------
// DamageComponent
// ---------------------------------------------------------------------------

describe('DamageComponent', () => {
  describe('default construction', () => {
    it('should default to zero contact damage with contact type', () => {
      const c = new DamageComponent();
      expect(c.contactDamage).toBe(0);
      expect(c.damageType).toBe('contact');
      expect(c.canCrit).toBe(false);
      expect(c.criticalChance).toBe(0);
      expect(c.criticalMultiplier).toBe(2);
      expect(c.burnDamage).toBe(0);
      expect(c.burnDuration).toBe(0);
      expect(c.recoilPercent).toBe(0);
    });
  });

  describe('parameterised construction', () => {
    it('should set all numeric damage fields', () => {
      const c = new DamageComponent(30, 'projectile', true, 0.15, 3, 5, 1000, 100, 0.1, 10);
      expect(c.contactDamage).toBe(30);
      expect(c.damageType).toBe('projectile');
      expect(c.canCrit).toBe(true);
      expect(c.criticalChance).toBe(0.15);
      expect(c.criticalMultiplier).toBe(3);
    });
  });

  describe('legacy aliases', () => {
    it('critChance getter/setter mirrors criticalChance', () => {
      const c = new DamageComponent();
      c.critChance = 0.2;
      expect(c.criticalChance).toBe(0.2);
      expect(c.critChance).toBe(0.2);
    });

    it('critMultiplier getter/setter mirrors criticalMultiplier', () => {
      const c = new DamageComponent();
      c.critMultiplier = 4;
      expect(c.criticalMultiplier).toBe(4);
      expect(c.critMultiplier).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------
// BeamComponent
// ---------------------------------------------------------------------------

describe('BeamComponent', () => {
  describe('default construction', () => {
    it('should default to zero angle/speed/damage with cyan color', () => {
      const c = new BeamComponent();
      expect(c.angle).toBe(0);
      expect(c.rotationSpeed).toBe(0);
      expect(c.damage).toBe(0);
      expect(c.length).toBe(200);
      expect(c.width).toBe(6);
      expect(c.isDouble).toBe(false);
      expect(c.activeTargeting).toBe(false);
      expect(c.targetingDuration).toBe(1000);
      expect(c.baseColor).toBe('#00ffff');
    });
  });

  describe('parameterised construction', () => {
    it('should accept angle, rotationSpeed, damage, length, width', () => {
      const c = new BeamComponent(1.57, 0.5, 50, 400, 10);
      expect(c.angle).toBeCloseTo(1.57);
      expect(c.rotationSpeed).toBe(0.5);
      expect(c.damage).toBe(50);
      expect(c.length).toBe(400);
      expect(c.width).toBe(10);
    });
  });

  describe('getCurrentColor()', () => {
    it('should return baseColor', () => {
      const c = new BeamComponent(0, 0, 0, 200, 6, false, false, undefined, 1000, '#ff00ff');
      expect(c.getCurrentColor()).toBe('#ff00ff');
    });
  });

  describe('getThicknessMultiplier() / getGlowIntensity()', () => {
    it('should return fixed values', () => {
      const c = new BeamComponent();
      expect(c.getThicknessMultiplier()).toBe(1);
      expect(c.getGlowIntensity()).toBe(0.3);
    });
  });
});

// ---------------------------------------------------------------------------
// ChargedProjectileComponent
// ---------------------------------------------------------------------------

describe('ChargedProjectileComponent', () => {
  describe('default construction', () => {
    it('should default to uncharged state', () => {
      const c = new ChargedProjectileComponent();
      expect(c.chargeLevel).toBe(0);
      expect(c.isCharged).toBe(false);
      expect(c.chargeThreshold).toBe(0.5);
      expect(c.baseDamageMultiplier).toBe(1.5);
    });
  });

  describe('parameterised construction', () => {
    it('should set isCharged=true when chargeLevel >= threshold', () => {
      const c = new ChargedProjectileComponent(0.6);
      expect(c.isCharged).toBe(true);
    });

    it('should keep isCharged=false below threshold', () => {
      const c = new ChargedProjectileComponent(0.3);
      expect(c.isCharged).toBe(false);
    });
  });

  describe('getDamageMultiplier()', () => {
    it('should return 1.0 when not charged', () => {
      const c = new ChargedProjectileComponent(0);
      expect(c.getDamageMultiplier()).toBe(1.0);
    });

    it('should scale above 1.0 when charged', () => {
      const c = new ChargedProjectileComponent(1.0);
      expect(c.getDamageMultiplier()).toBeGreaterThan(1.0);
    });
  });

  describe('getSizeMultiplier()', () => {
    it('should return 1.0 when uncharged', () => {
      const c = new ChargedProjectileComponent(0);
      expect(c.getSizeMultiplier()).toBe(1.0);
    });

    it('should be larger at max charge (capped at 1.2)', () => {
      const c = new ChargedProjectileComponent(1.0);
      expect(c.getSizeMultiplier()).toBeCloseTo(1.2, 5);
    });
  });

  describe('shouldEmitTrail()', () => {
    it('should return false for low charge', () => {
      const c = new ChargedProjectileComponent(0.5);
      expect(c.shouldEmitTrail()).toBe(false);
    });

    it('should return true for charge > 0.7 when charged', () => {
      const c = new ChargedProjectileComponent(0.8);
      expect(c.shouldEmitTrail()).toBe(true);
    });
  });

  describe('getTrailData()', () => {
    it('should return null for uncharged projectile', () => {
      const c = new ChargedProjectileComponent(0);
      expect(c.getTrailData()).toBeNull();
    });

    it('should return trail data object when trail should emit', () => {
      const c = new ChargedProjectileComponent(0.9);
      const data = c.getTrailData();
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// FallingAsteroidComponent
// ---------------------------------------------------------------------------

describe('FallingAsteroidComponent', () => {
  describe('default construction', () => {
    it('should start in WARNING state with standard defaults', () => {
      const c = new FallingAsteroidComponent();
      expect(c.state).toBe(AsteroidState.WARNING);
      expect(c.fallHeight).toBe(1000);
      expect(c.impactRadius).toBe(150);
      expect(c.impactDamage).toBe(50);
      expect(c.size).toBe(40);
      expect(c.health).toBe(100);
      expect(c.maxHealth).toBe(100);
      expect(c.rewardType).toBe('speed');
      expect(c.rewardDuration).toBe(10000);
      expect(c.rewardPower).toBe(1.5);
      expect(c.isMega).toBe(false);
    });
  });

  describe('parameterised construction', () => {
    it('should accept state, targets, health and reward fields', () => {
      const c = new FallingAsteroidComponent(
        AsteroidState.FALLING,
        1000,
        2000,
        3000,
        400,
        300,
        800,
        200,
        75,
        50,
        150,
        150,
        'damage',
        5000,
        2.0,
        true
      );
      expect(c.state).toBe(AsteroidState.FALLING);
      expect(c.targetX).toBe(400);
      expect(c.targetY).toBe(300);
      expect(c.isMega).toBe(true);
      expect(c.rewardType).toBe('damage');
    });
  });

  describe('clone()', () => {
    it('should produce an independent copy with equal values', () => {
      const c = new FallingAsteroidComponent(AsteroidState.LANDED, 0, 0, 0, 100, 200);
      const copy = c.clone();
      expect(copy.state).toBe(c.state);
      expect(copy.targetX).toBe(c.targetX);
      expect(copy).not.toBe(c);
    });
  });
});

// ---------------------------------------------------------------------------
// HealthBarDisplayComponent
// ---------------------------------------------------------------------------

describe('HealthBarDisplayComponent', () => {
  describe('default construction', () => {
    it('should set displayUntil to approximately now + 5000ms', () => {
      const before = Date.now();
      const c = new HealthBarDisplayComponent();
      const after = Date.now();
      expect(c.displayUntil).toBeGreaterThanOrEqual(before + 5000);
      expect(c.displayUntil).toBeLessThanOrEqual(after + 5000);
      expect(c.lastHealthPercent).toBe(1.0);
      expect(c.isHealing).toBe(false);
    });
  });

  describe('parameterised construction (type narrowing)', () => {
    it('should use provided timestamp when arg is a number', () => {
      const ts = 9999999;
      const c = new HealthBarDisplayComponent(ts);
      expect(c.displayUntil).toBe(ts);
    });
  });

  describe('shouldDisplay()', () => {
    it('should return true when displayUntil is in the future', () => {
      const c = new HealthBarDisplayComponent(Date.now() + 10000);
      expect(c.shouldDisplay()).toBe(true);
    });

    it('should return false when displayUntil is in the past', () => {
      const c = new HealthBarDisplayComponent(Date.now() - 1);
      expect(c.shouldDisplay()).toBe(false);
    });
  });

  describe('extendDisplay()', () => {
    it('should push displayUntil ~5000ms into the future', () => {
      const c = new HealthBarDisplayComponent(0);
      c.extendDisplay();
      expect(c.displayUntil).toBeGreaterThan(Date.now() + 4000);
    });
  });

  describe('markHealing()', () => {
    it('should set isHealing and lastHealAmount', () => {
      const c = new HealthBarDisplayComponent(Date.now() + 10000);
      c.markHealing(25);
      expect(c.isHealing).toBe(true);
      expect(c.lastHealAmount).toBe(25);
    });
  });
});

// ---------------------------------------------------------------------------
// PlayerControlledComponent
// ---------------------------------------------------------------------------

describe('PlayerControlledComponent', () => {
  describe('default construction', () => {
    it('should default to angle=0, beamActive=true and Pilot class', () => {
      const c = new PlayerControlledComponent();
      expect(c.angle).toBe(0);
      expect(c.beamActive).toBe(true);
      expect(c.isDashing).toBe(false);
      expect(c.isInvincible).toBe(false);
      expect(c.dashCooldown).toBe(2000);
      expect(c.speedMultiplier).toBe(1);
      expect(c.className).toBe('Pilot');
      expect(c.ascensionLevel).toBe(0);
    });
  });

  describe('parameterised construction', () => {
    it('should accept all ten positional args', () => {
      const c = new PlayerControlledComponent(1.5, false, true, true, 9999, 1000, 3000, 1.5, 'Ace', 5);
      expect(c.angle).toBe(1.5);
      expect(c.beamActive).toBe(false);
      expect(c.isDashing).toBe(true);
      expect(c.isInvincible).toBe(true);
      expect(c.invincibilityEndTime).toBe(9999);
      expect(c.lastDashTime).toBe(1000);
      expect(c.dashCooldown).toBe(3000);
      expect(c.speedMultiplier).toBe(1.5);
      expect(c.className).toBe('Ace');
      expect(c.ascensionLevel).toBe(5);
    });
  });
});
