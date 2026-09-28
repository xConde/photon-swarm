import { PositionComponent } from './position.component';
import { VelocityComponent } from './velocity.component';
import { AccelerationComponent } from './acceleration.component';
import { KnockbackComponent } from './knockback.component';
import { CollisionBoxComponent } from './collision-box.component';
import { HealthComponent } from './health.component';
import { DamageComponent } from './damage.component';
import { WeaponComponent } from './weapon.component';
import { ProjectileComponent } from './projectile.component';
import { BeamComponent } from './beam.component';
import { ChargedProjectileComponent } from './charged-projectile.component';
import { AbilityComponent, AbilityType } from './ability.component';

// ---------------------------------------------------------------------------
// PositionComponent
// ---------------------------------------------------------------------------
describe('PositionComponent', () => {
  it('should set x and y from args', () => {
    const c = new PositionComponent(10, 20);
    expect(c.x).toBe(10);
    expect(c.y).toBe(20);
  });

  it('should default x and y to 0 when no args', () => {
    const c = new PositionComponent();
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it('should accept negative coordinates', () => {
    const c = new PositionComponent(-50, -100);
    expect(c.x).toBe(-50);
    expect(c.y).toBe(-100);
  });

  it('should accept 0 for both axes', () => {
    const c = new PositionComponent(0, 0);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it('should accept Infinity values', () => {
    const c = new PositionComponent(Infinity, -Infinity);
    expect(c.x).toBe(Infinity);
    expect(c.y).toBe(-Infinity);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [7, 14];
    const c = new PositionComponent(...args);
    expect(c.x).toBe(7);
    expect(c.y).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// VelocityComponent
// ---------------------------------------------------------------------------
describe('VelocityComponent', () => {
  it('should set vx and vy from args', () => {
    const c = new VelocityComponent(3, -4);
    expect(c.vx).toBe(3);
    expect(c.vy).toBe(-4);
  });

  it('should default vx and vy to 0 when no args', () => {
    const c = new VelocityComponent();
    expect(c.vx).toBe(0);
    expect(c.vy).toBe(0);
  });

  it('should accept 0 velocity', () => {
    const c = new VelocityComponent(0, 0);
    expect(c.vx).toBe(0);
    expect(c.vy).toBe(0);
  });

  it('should accept large values', () => {
    const c = new VelocityComponent(9999, 9999);
    expect(c.vx).toBe(9999);
    expect(c.vy).toBe(9999);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [1.5, 2.5];
    const c = new VelocityComponent(...args);
    expect(c.vx).toBe(1.5);
    expect(c.vy).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// AccelerationComponent
// ---------------------------------------------------------------------------
describe('AccelerationComponent', () => {
  it('should set all fields from args', () => {
    const c = new AccelerationComponent(100, 200, 0.2, 0.3);
    expect(c.currentSpeed).toBe(100);
    expect(c.targetSpeed).toBe(200);
    expect(c.accelerationRate).toBe(0.2);
    expect(c.decelerationRate).toBe(0.3);
  });

  it('should use defaults when no args provided', () => {
    const c = new AccelerationComponent();
    expect(c.currentSpeed).toBe(0);
    expect(c.targetSpeed).toBe(0);
    expect(c.accelerationRate).toBe(0.1);
    expect(c.decelerationRate).toBe(0.15);
  });

  it('should lerp currentSpeed toward a higher target', () => {
    const c = new AccelerationComponent(0, 100, 1, 1);
    c.lerp(100, 1 / 60);
    expect(c.currentSpeed).toBeGreaterThan(0);
    expect(c.currentSpeed).toBeLessThanOrEqual(100);
  });

  it('should lerp currentSpeed toward a lower target', () => {
    const c = new AccelerationComponent(100, 0, 1, 1);
    c.lerp(0, 1 / 60);
    expect(c.currentSpeed).toBeLessThan(100);
    expect(c.currentSpeed).toBeGreaterThanOrEqual(0);
  });

  it('should snap to target when within 0.01 tolerance', () => {
    const c = new AccelerationComponent(99.995, 100, 1, 1);
    c.lerp(100, 1 / 60);
    expect(c.currentSpeed).toBe(100);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [50, 150, 0.05, 0.08];
    const c = new AccelerationComponent(...args);
    expect(c.currentSpeed).toBe(50);
    expect(c.targetSpeed).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// KnockbackComponent
// ---------------------------------------------------------------------------
describe('KnockbackComponent', () => {
  it('should set all fields from args', () => {
    const c = new KnockbackComponent(5, -3, 500);
    expect(c.knockbackVelocityX).toBe(5);
    expect(c.knockbackVelocityY).toBe(-3);
    expect(c.knockbackTimer).toBe(500);
    expect(c.maxKnockbackTime).toBe(500);
    expect(c.isActive).toBeTrue();
  });

  it('should default to 0 velocity, 300ms duration, and active when no args', () => {
    const c = new KnockbackComponent();
    expect(c.knockbackVelocityX).toBe(0);
    expect(c.knockbackVelocityY).toBe(0);
    expect(c.knockbackTimer).toBe(300);
    expect(c.maxKnockbackTime).toBe(300);
    expect(c.isActive).toBeTrue();
  });

  it('should be inactive when duration is 0', () => {
    const c = new KnockbackComponent(10, 10, 0);
    expect(c.isActive).toBeFalse();
  });

  it('update() should decrement timer and return true while active', () => {
    const c = new KnockbackComponent(10, 5, 300);
    const stillActive = c.update(100);
    expect(stillActive).toBeTrue();
    expect(c.knockbackTimer).toBe(200);
  });

  it('update() should deactivate when timer reaches 0', () => {
    const c = new KnockbackComponent(10, 5, 100);
    const stillActive = c.update(200);
    expect(stillActive).toBeFalse();
    expect(c.isActive).toBeFalse();
    expect(c.knockbackVelocityX).toBe(0);
    expect(c.knockbackVelocityY).toBe(0);
  });

  it('update() should return false immediately when inactive', () => {
    const c = new KnockbackComponent(10, 5, 0);
    const result = c.update(50);
    expect(result).toBeFalse();
  });

  it('getCurrentVelocity() should return 0 when inactive', () => {
    const c = new KnockbackComponent(10, 5, 0);
    const vel = c.getCurrentVelocity();
    expect(vel.vx).toBe(0);
    expect(vel.vy).toBe(0);
  });

  it('getCurrentVelocity() should return decayed velocity proportional to remaining time', () => {
    const c = new KnockbackComponent(10, 0, 300);
    // At full timer the decay factor = (1 - progress)^2 = (1 - 0)^2 = 1
    const vel = c.getCurrentVelocity();
    expect(vel.vx).toBeCloseTo(10);
    expect(vel.vy).toBeCloseTo(0);
  });

  it('addKnockback() should accumulate velocity and reactivate', () => {
    const c = new KnockbackComponent(5, 5, 100);
    c.update(200); // expire
    expect(c.isActive).toBeFalse();
    c.addKnockback(10, 0, 300);
    expect(c.isActive).toBeTrue();
    expect(c.knockbackVelocityX).toBe(10); // was cleared to 0, then += 10
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [2, 4, 400];
    const c = new KnockbackComponent(...args);
    expect(c.maxKnockbackTime).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// CollisionBoxComponent
// ---------------------------------------------------------------------------
describe('CollisionBoxComponent', () => {
  it('should set all fields from args', () => {
    const c = new CollisionBoxComponent(15, 'player', ['enemy', 'projectile']);
    expect(c.radius).toBe(15);
    expect(c.collisionGroup).toBe('player');
    expect(c.collidesWith).toEqual(['enemy', 'projectile']);
  });

  it('should default to 0 radius, enemy group, and all collision when no args', () => {
    const c = new CollisionBoxComponent();
    expect(c.radius).toBe(0);
    expect(c.collisionGroup).toBe('enemy');
    expect(c.collidesWith).toEqual(['all']);
  });

  it('should accept all valid collision groups', () => {
    const groups = ['player', 'enemy', 'projectile', 'shard', 'asteroid'] as const;
    for (const group of groups) {
      const c = new CollisionBoxComponent(10, group, []);
      expect(c.collisionGroup).toBe(group);
    }
  });

  it('should accept 0 radius', () => {
    const c = new CollisionBoxComponent(0, 'asteroid', []);
    expect(c.radius).toBe(0);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [20, 'shard', ['player']];
    const c = new CollisionBoxComponent(...args);
    expect(c.radius).toBe(20);
    expect(c.collisionGroup).toBe('shard');
  });
});

// ---------------------------------------------------------------------------
// HealthComponent
// ---------------------------------------------------------------------------
describe('HealthComponent', () => {
  it('should set all fields from args', () => {
    const c = new HealthComponent(80, 120, 0.1, false);
    expect(c.health).toBe(80);
    expect(c.maxHealth).toBe(120);
    expect(c.damageReduction).toBe(0.1);
    expect(c.isDead).toBeFalse();
  });

  it('should default to 100 health and 100 maxHealth when no args', () => {
    const c = new HealthComponent();
    expect(c.health).toBe(100);
    expect(c.maxHealth).toBe(100);
    expect(c.damageReduction).toBe(0);
    expect(c.isDead).toBeFalse();
  });

  it('should initialize bookkeeping flags to false', () => {
    const c = new HealthComponent();
    expect(c.xpAwarded).toBeFalse();
    expect(c.killAwarded).toBeFalse();
    expect(c.deathProcessed).toBeFalse();
  });

  it('should initialize lastDamageSource to unknown', () => {
    const c = new HealthComponent();
    expect(c.lastDamageSource).toBe('unknown');
  });

  it('should accept isDead = true', () => {
    const c = new HealthComponent(0, 100, 0, true);
    expect(c.isDead).toBeTrue();
  });

  it('should not default to 0 health (guard against instant death)', () => {
    const c = new HealthComponent();
    expect(c.health).toBeGreaterThan(0);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [50, 200, 0.2, false];
    const c = new HealthComponent(...args);
    expect(c.health).toBe(50);
    expect(c.maxHealth).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DamageComponent
// ---------------------------------------------------------------------------
describe('DamageComponent', () => {
  it('should set all fields from args', () => {
    const c = new DamageComponent(25, 'projectile', true, 0.3, 2.5, 5, 3000, 500, 0.1, 10);
    expect(c.contactDamage).toBe(25);
    expect(c.damageType).toBe('projectile');
    expect(c.canCrit).toBeTrue();
    expect(c.criticalChance).toBe(0.3);
    expect(c.criticalMultiplier).toBe(2.5);
    expect(c.burnDamage).toBe(5);
    expect(c.burnDuration).toBe(3000);
    expect(c.burnTickTimer).toBe(500);
    expect(c.recoilPercent).toBe(0.1);
    expect(c.environmentalDamage).toBe(10);
  });

  it('should use defaults when no args provided', () => {
    const c = new DamageComponent();
    expect(c.contactDamage).toBe(0);
    expect(c.damageType).toBe('contact');
    expect(c.canCrit).toBeFalse();
    expect(c.criticalChance).toBe(0);
    expect(c.criticalMultiplier).toBe(2);
    expect(c.burnDamage).toBe(0);
    expect(c.burnDuration).toBe(0);
    expect(c.burnTickTimer).toBe(0);
    expect(c.recoilPercent).toBe(0);
    expect(c.environmentalDamage).toBe(0);
  });

  it('critChance alias should read criticalChance', () => {
    const c = new DamageComponent(0, 'contact', false, 0.25);
    expect(c.critChance).toBe(0.25);
  });

  it('critChance alias should write criticalChance', () => {
    const c = new DamageComponent();
    c.critChance = 0.5;
    expect(c.criticalChance).toBe(0.5);
  });

  it('critMultiplier alias should read and write criticalMultiplier', () => {
    const c = new DamageComponent();
    c.critMultiplier = 3;
    expect(c.criticalMultiplier).toBe(3);
    expect(c.critMultiplier).toBe(3);
  });

  it('should accept all valid damage types', () => {
    const types = ['contact', 'beam', 'projectile', 'burn', 'discharge'] as const;
    for (const type of types) {
      const c = new DamageComponent(0, type);
      expect(c.damageType).toBe(type);
    }
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [15, 'beam'];
    const c = new DamageComponent(...args);
    expect(c.contactDamage).toBe(15);
    expect(c.damageType).toBe('beam');
  });
});

// ---------------------------------------------------------------------------
// WeaponComponent
// ---------------------------------------------------------------------------
describe('WeaponComponent', () => {
  it('should set all constructor args', () => {
    const c = new WeaponComponent(10, 500, 1000, 300, 8, '#ff0000', 2000, 3, 50, 0.2);
    expect(c.damage).toBe(10);
    expect(c.fireRate).toBe(500);
    expect(c.lastShotTime).toBe(1000);
    expect(c.projectileSpeed).toBe(300);
    expect(c.projectileRadius).toBe(8);
    expect(c.projectileColor).toBe('#ff0000');
    expect(c.projectileLifetime).toBe(2000);
    expect(c.burstCount).toBe(3);
    expect(c.burstDelay).toBe(50);
    expect(c.chargedShotChance).toBe(0.2);
  });

  it('should use defaults when no args provided', () => {
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
  });

  it('should initialize readyToFire to false', () => {
    const c = new WeaponComponent();
    expect(c.readyToFire).toBeFalse();
  });

  it('should initialize targeting state to defaults', () => {
    const c = new WeaponComponent();
    expect(c.isAiming).toBeFalse();
    expect(c.aimStartTime).toBe(0);
    expect(c.aimDuration).toBe(500);
    expect(c.targetDirection).toBeUndefined();
  });

  it('canFire() should return true when enough time has elapsed', () => {
    const c = new WeaponComponent(10, 500, 0);
    expect(c.canFire(500)).toBeTrue();
    expect(c.canFire(1000)).toBeTrue();
  });

  it('canFire() should return false when cooldown has not elapsed', () => {
    const c = new WeaponComponent(10, 500, 0);
    expect(c.canFire(100)).toBeFalse();
  });

  it('getCooldownProgress() should return 0 to 1 clamped', () => {
    const c = new WeaponComponent(10, 500, 0);
    expect(c.getCooldownProgress(250)).toBeCloseTo(0.5);
    expect(c.getCooldownProgress(1000)).toBe(1);
    expect(c.getCooldownProgress(0)).toBe(0);
  });

  it('getAimProgress() should return 0 when not aiming', () => {
    const c = new WeaponComponent();
    expect(c.getAimProgress(1000)).toBe(0);
  });

  it('getAimProgress() should return progress while aiming', () => {
    const c = new WeaponComponent();
    c.isAiming = true;
    c.aimStartTime = 0;
    expect(c.getAimProgress(250)).toBeCloseTo(0.5);
    expect(c.getAimProgress(1000)).toBe(1);
  });

  it('isAimComplete() should be false when not aiming', () => {
    const c = new WeaponComponent();
    expect(c.isAimComplete(1000)).toBeFalse();
  });

  it('isAimComplete() should be true when aim duration has elapsed', () => {
    const c = new WeaponComponent();
    c.isAiming = true;
    c.aimStartTime = 0;
    expect(c.isAimComplete(500)).toBeTrue();
    expect(c.isAimComplete(499)).toBeFalse();
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [20, 300];
    const c = new WeaponComponent(...args);
    expect(c.damage).toBe(20);
    expect(c.fireRate).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// ProjectileComponent
// ---------------------------------------------------------------------------
describe('ProjectileComponent', () => {
  it('should set all fields from args', () => {
    const c = new ProjectileComponent(30, 2000, 5000, 3, true, true, true, true);
    expect(c.damage).toBe(30);
    expect(c.lifetime).toBe(2000);
    expect(c.spawnTime).toBe(5000);
    expect(c.health).toBe(3);
    expect(c.penetrating).toBeTrue();
    expect(c.homing).toBeTrue();
    expect(c.isCritical).toBeTrue();
    expect(c.isPlayerOwned).toBeTrue();
  });

  it('should use defaults when no args provided', () => {
    const c = new ProjectileComponent();
    expect(c.damage).toBe(0);
    expect(c.lifetime).toBe(0);
    expect(c.spawnTime).toBe(0);
    expect(c.health).toBe(1);
    expect(c.penetrating).toBeFalse();
    expect(c.homing).toBeFalse();
    expect(c.isCritical).toBeFalse();
    expect(c.isPlayerOwned).toBeFalse();
  });

  it('isExpired() should return true when lifetime has passed', () => {
    const c = new ProjectileComponent(10, 1000, 0);
    expect(c.isExpired(1001)).toBeTrue();
    expect(c.isExpired(1000)).toBeFalse();
    expect(c.isExpired(500)).toBeFalse();
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [15, 3000, 100];
    const c = new ProjectileComponent(...args);
    expect(c.damage).toBe(15);
    expect(c.lifetime).toBe(3000);
    expect(c.spawnTime).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// BeamComponent
// ---------------------------------------------------------------------------
describe('BeamComponent', () => {
  it('should set all fields from args', () => {
    const c = new BeamComponent(1.57, 0.5, 20, 400, 10, true, true, 1000, 2000, '#ff0000');
    expect(c.angle).toBeCloseTo(1.57);
    expect(c.rotationSpeed).toBe(0.5);
    expect(c.damage).toBe(20);
    expect(c.length).toBe(400);
    expect(c.width).toBe(10);
    expect(c.isDouble).toBeTrue();
    expect(c.activeTargeting).toBeTrue();
    expect(c.targetingStartTime).toBe(1000);
    expect(c.targetingDuration).toBe(2000);
    expect(c.baseColor).toBe('#ff0000');
  });

  it('should use defaults when no args provided', () => {
    const c = new BeamComponent();
    expect(c.angle).toBe(0);
    expect(c.rotationSpeed).toBe(0);
    expect(c.damage).toBe(0);
    expect(c.length).toBe(200);
    expect(c.width).toBe(6);
    expect(c.isDouble).toBeFalse();
    expect(c.activeTargeting).toBeFalse();
    expect(c.targetingStartTime).toBeUndefined();
    expect(c.targetingDuration).toBe(1000);
    expect(c.baseColor).toBe('#00ffff');
  });

  it('getCurrentColor() should return baseColor', () => {
    const c = new BeamComponent(0, 0, 0, 200, 6, false, false, undefined, 1000, '#aabbcc');
    expect(c.getCurrentColor()).toBe('#aabbcc');
  });

  it('getThicknessMultiplier() should return 1', () => {
    const c = new BeamComponent();
    expect(c.getThicknessMultiplier()).toBe(1);
  });

  it('getGlowIntensity() should return 0.3', () => {
    const c = new BeamComponent();
    expect(c.getGlowIntensity()).toBeCloseTo(0.3);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [0, 1, 10];
    const c = new BeamComponent(...args);
    expect(c.damage).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// ChargedProjectileComponent
// ---------------------------------------------------------------------------
describe('ChargedProjectileComponent', () => {
  it('should set all fields from args', () => {
    const c = new ChargedProjectileComponent(0.8, 2.0, '#ff00ff', false, 0.5, 10, 5, 3);
    expect(c.chargeLevel).toBe(0.8);
    expect(c.baseDamageMultiplier).toBe(2.0);
    expect(c.chargedColor).toBe('#ff00ff');
    expect(c.chargeThreshold).toBe(0.5);
    expect(c.pulseFrequency).toBe(10);
    expect(c.trailLength).toBe(5);
    expect(c.sparkIntensity).toBe(3);
  });

  it('should use defaults when no args provided', () => {
    const c = new ChargedProjectileComponent();
    expect(c.chargeLevel).toBe(0);
    expect(c.baseDamageMultiplier).toBe(1.5);
    expect(c.chargedColor).toBe('#00ffff');
    expect(c.isCharged).toBeFalse();
    expect(c.chargeThreshold).toBe(0.5);
    expect(c.pulseFrequency).toBe(8);
    expect(c.trailLength).toBe(3);
    expect(c.sparkIntensity).toBe(2);
  });

  it('should auto-set isCharged based on chargeLevel vs chargeThreshold', () => {
    const charged = new ChargedProjectileComponent(0.9, 1.5, '#00ffff', false, 0.5);
    expect(charged.isCharged).toBeTrue();

    const notCharged = new ChargedProjectileComponent(0.3, 1.5, '#00ffff', false, 0.5);
    expect(notCharged.isCharged).toBeFalse();
  });

  it('updateChargedState() should update isCharged field', () => {
    const c = new ChargedProjectileComponent();
    c.chargeLevel = 0.8;
    c.updateChargedState();
    expect(c.isCharged).toBeTrue();

    c.chargeLevel = 0.1;
    c.updateChargedState();
    expect(c.isCharged).toBeFalse();
  });

  it('getDamageMultiplier() should return 1.0 when not charged', () => {
    const c = new ChargedProjectileComponent(0, 1.5, '#00ffff', false, 0.5);
    expect(c.getDamageMultiplier()).toBe(1.0);
  });

  it('getDamageMultiplier() should scale between 1.0 and baseDamageMultiplier when charged', () => {
    const c = new ChargedProjectileComponent(1.0, 2.0, '#00ffff', false, 0.5);
    expect(c.isCharged).toBeTrue();
    const multiplier = c.getDamageMultiplier();
    expect(multiplier).toBeGreaterThan(1.0);
    expect(multiplier).toBeLessThanOrEqual(2.0);
  });

  it('getCurrentColor() should return a string', () => {
    const c = new ChargedProjectileComponent(1.0, 1.5, '#00ffff', false, 0.5);
    expect(typeof c.getCurrentColor()).toBe('string');
  });

  it('shouldEmitTrail() should return true only when charged and chargeLevel > 0.7', () => {
    const high = new ChargedProjectileComponent(0.9, 1.5, '#00ffff', false, 0.5);
    expect(high.shouldEmitTrail()).toBeTrue();

    const low = new ChargedProjectileComponent(0.6, 1.5, '#00ffff', false, 0.5);
    expect(low.shouldEmitTrail()).toBeFalse();
  });

  it('getTrailData() should return null when trail should not emit', () => {
    const c = new ChargedProjectileComponent(0.3, 1.5, '#00ffff', false, 0.5);
    expect(c.getTrailData()).toBeNull();
  });

  it('getTrailData() should return trail data when trail should emit', () => {
    const c = new ChargedProjectileComponent(0.9, 1.5, '#00ffff', false, 0.5);
    const trail = c.getTrailData();
    expect(trail).not.toBeNull();
    expect(trail!.length).toBe(c.trailLength);
    expect(trail!.intensity).toBeGreaterThan(0);
  });

  it('getSizeMultiplier() should return 1.0 when not charged', () => {
    const c = new ChargedProjectileComponent(0, 1.5, '#00ffff', false, 0.5);
    expect(c.getSizeMultiplier()).toBe(1.0);
  });

  it('getSizeMultiplier() should be > 1.0 when charged', () => {
    const c = new ChargedProjectileComponent(1.0, 1.5, '#00ffff', false, 0.5);
    expect(c.getSizeMultiplier()).toBeGreaterThan(1.0);
    expect(c.getSizeMultiplier()).toBeLessThanOrEqual(1.2);
  });

  it('getPulseGlow() should return 0 when not charged', () => {
    const c = new ChargedProjectileComponent(0.2, 1.5, '#00ffff', false, 0.5);
    expect(c.getPulseGlow(1000)).toBe(0);
  });

  it('getPulseGlow() should return positive value when charged', () => {
    const c = new ChargedProjectileComponent(1.0, 1.5, '#00ffff', false, 0.5);
    expect(c.getPulseGlow(0)).toBeGreaterThanOrEqual(0);
  });

  it('should work when called with unknown[] args', () => {
    const args: unknown[] = [0.7, 2.0];
    const c = new ChargedProjectileComponent(...args);
    expect(c.chargeLevel).toBe(0.7);
    expect(c.baseDamageMultiplier).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// AbilityComponent
// ---------------------------------------------------------------------------
describe('AbilityComponent', () => {
  it('should initialize with empty abilities and index 0', () => {
    const c = new AbilityComponent();
    expect(c.abilities).toEqual([]);
    expect(c.currentAbilityIndex).toBe(0);
    expect(c.nextAbilityTime).toBe(0);
  });

  it('should have readonly name = AbilityComponent', () => {
    const c = new AbilityComponent();
    expect(c.name).toBe('AbilityComponent');
  });

  it('should work when called with unknown[] args (ignores args)', () => {
    const args: unknown[] = [1, 2, 'anything'];
    const c = new AbilityComponent(...args);
    expect(c.abilities).toEqual([]);
  });

  it('canUseAbility() should return false when no abilities registered', () => {
    const c = new AbilityComponent();
    expect(c.canUseAbility(AbilityType.BURST_FIRE, 1000)).toBeFalse();
  });

  it('canUseAbility() should return true when cooldown has elapsed', () => {
    const c = new AbilityComponent();
    c.abilities.push({ type: AbilityType.POISON_CLOUD, cooldownMs: 500, lastUsedTime: 0 });
    expect(c.canUseAbility(AbilityType.POISON_CLOUD, 500)).toBeTrue();
  });

  it('canUseAbility() should return false when still on cooldown', () => {
    const c = new AbilityComponent();
    c.abilities.push({ type: AbilityType.POISON_CLOUD, cooldownMs: 1000, lastUsedTime: 0 });
    expect(c.canUseAbility(AbilityType.POISON_CLOUD, 500)).toBeFalse();
  });

  it('useAbility() should update lastUsedTime and return true on success', () => {
    const c = new AbilityComponent();
    c.abilities.push({ type: AbilityType.ENRAGE, cooldownMs: 500, lastUsedTime: 0 });
    const result = c.useAbility(AbilityType.ENRAGE, 600);
    expect(result).toBeTrue();
    expect(c.abilities[0].lastUsedTime).toBe(600);
  });

  it('useAbility() should return false when ability is on cooldown', () => {
    const c = new AbilityComponent();
    c.abilities.push({ type: AbilityType.ENRAGE, cooldownMs: 1000, lastUsedTime: 0 });
    expect(c.useAbility(AbilityType.ENRAGE, 500)).toBeFalse();
  });

  it('useAbility() should set isActive and activeUntil when duration is present', () => {
    const c = new AbilityComponent();
    c.abilities.push({ type: AbilityType.SHIELD_GENERATION, cooldownMs: 0, lastUsedTime: 0, duration: 2000 });
    c.useAbility(AbilityType.SHIELD_GENERATION, 1000);
    expect(c.abilities[0].isActive).toBeTrue();
    expect(c.abilities[0].activeUntil).toBe(3000);
  });

  it('getNextAbility() should return null when no abilities', () => {
    const c = new AbilityComponent();
    expect(c.getNextAbility()).toBeNull();
  });

  it('getNextAbility() should rotate through abilities', () => {
    const c = new AbilityComponent();
    c.abilities.push(
      { type: AbilityType.BURST_FIRE, cooldownMs: 500, lastUsedTime: 0 },
      { type: AbilityType.ENRAGE, cooldownMs: 500, lastUsedTime: 0 }
    );
    const first = c.getNextAbility();
    const second = c.getNextAbility();
    const third = c.getNextAbility(); // wraps around
    expect(first!.type).toBe(AbilityType.BURST_FIRE);
    expect(second!.type).toBe(AbilityType.ENRAGE);
    expect(third!.type).toBe(AbilityType.BURST_FIRE);
  });

  it('hasActiveAbility() should return false when not active', () => {
    const c = new AbilityComponent();
    c.abilities.push({ type: AbilityType.AREA_BUFF, cooldownMs: 0, lastUsedTime: 0, isActive: false });
    expect(c.hasActiveAbility(AbilityType.AREA_BUFF, 1000)).toBeFalse();
  });

  it('hasActiveAbility() should return true within active window', () => {
    const c = new AbilityComponent();
    c.abilities.push({
      type: AbilityType.AREA_BUFF,
      cooldownMs: 0,
      lastUsedTime: 0,
      isActive: true,
      activeUntil: 2000,
    });
    expect(c.hasActiveAbility(AbilityType.AREA_BUFF, 1000)).toBeTrue();
  });

  it('hasActiveAbility() should deactivate and return false after activeUntil', () => {
    const c = new AbilityComponent();
    c.abilities.push({
      type: AbilityType.AREA_BUFF,
      cooldownMs: 0,
      lastUsedTime: 0,
      isActive: true,
      activeUntil: 1000,
    });
    const result = c.hasActiveAbility(AbilityType.AREA_BUFF, 1000);
    expect(result).toBeFalse();
    expect(c.abilities[0].isActive).toBeFalse();
  });
});
