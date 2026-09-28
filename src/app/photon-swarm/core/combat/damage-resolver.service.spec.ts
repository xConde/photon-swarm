import { TestBed } from '@angular/core/testing';
import { DamageResolverService } from './damage-resolver.service';
import { HealthComponent, ShieldArcComponent } from '@photon/components';

describe('DamageResolverService', () => {
  let service: DamageResolverService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DamageResolverService);
  });

  function makeHealth(current: number, max = current, damageReduction = 0): HealthComponent {
    return new HealthComponent(current, max, damageReduction, false);
  }

  /**
   * Build a ShieldArcComponent facing the given angle with a given arc and reduction.
   * By default: 120-degree arc (2π/3), 80% reduction, facing 0 radians.
   */
  function makeShield(facingAngle = 0, arcAngle = (2 * Math.PI) / 3, damageReduction = 0.8): ShieldArcComponent {
    return new ShieldArcComponent(arcAngle, damageReduction, facingAngle, 0);
  }

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // ── Basic write behavior ──────────────────────────────────────────────────

  it('rawDamage only (no resistances) — reduces health by rawDamage, rounds 2dp', () => {
    const h = makeHealth(10);
    const result = service.applyDamageToEnemy({ health: h, rawDamage: 3.333, source: 'player' });
    expect(h.health).toBe(6.67);
    expect(result.appliedDamage).toBeCloseTo(3.333, 5);
    expect(result.blocked).toBe(false);
  });

  it('clamps health at 0 — never goes negative', () => {
    const h = makeHealth(5);
    const result = service.applyDamageToEnemy({ health: h, rawDamage: 20, source: 'player' });
    expect(h.health).toBe(0);
    expect(result.appliedDamage).toBe(20); // appliedDamage is pre-clamp
  });

  it('sets lastDamageSource to the passed source', () => {
    const h = makeHealth(50);
    service.applyDamageToEnemy({ health: h, rawDamage: 10, source: 'environmental' });
    expect(h.lastDamageSource).toBe('environmental');
  });

  it('returns the PRE-write health as previousHealth', () => {
    const h = makeHealth(10);
    const result = service.applyDamageToEnemy({ health: h, rawDamage: 3, source: 'player' });
    expect(result.previousHealth).toBe(10);
    expect(h.health).toBe(7);
  });

  it('rawDamage 0 — health unchanged, source still tagged, appliedDamage 0', () => {
    const h = makeHealth(42);
    const result = service.applyDamageToEnemy({ health: h, rawDamage: 0, source: 'npc' });
    expect(h.health).toBe(42);
    expect(h.lastDamageSource).toBe('npc');
    expect(result.previousHealth).toBe(42);
    expect(result.appliedDamage).toBe(0);
    expect(result.blocked).toBe(false);
  });

  it('negative rawDamage — treated as 0, health unchanged, source still tagged', () => {
    const h = makeHealth(42);
    const result = service.applyDamageToEnemy({ health: h, rawDamage: -5, source: 'player' });
    expect(h.health).toBe(42);
    expect(h.lastDamageSource).toBe('player');
    expect(result.appliedDamage).toBe(0);
    expect(result.blocked).toBe(false);
  });

  // ── damageReduction ───────────────────────────────────────────────────────

  it('damageReduction 0.5 — appliedDamage is rawDamage * 0.5', () => {
    const h = makeHealth(100);
    const result = service.applyDamageToEnemy({
      health: h,
      rawDamage: 20,
      source: 'player',
      damageReduction: 0.5,
    });
    expect(result.appliedDamage).toBeCloseTo(10, 5);
    expect(h.health).toBeCloseTo(90, 2);
  });

  it('damageReduction 0 — no reduction applied (same as omitting)', () => {
    const h = makeHealth(100);
    const r1 = service.applyDamageToEnemy({ health: h, rawDamage: 10, source: 'player', damageReduction: 0 });
    expect(r1.appliedDamage).toBeCloseTo(10, 5);
  });

  // ── Directional shield ────────────────────────────────────────────────────

  it('shield within arc (getBlockReduction 0.8) — appliedDamage reduced 80%, blocked true, lastBlockTime set', () => {
    const h = makeHealth(100);
    // Shield facing 0 (east), arc 2π/3 (120 deg). Attack source at angle 0 = squarely in arc.
    const shield = makeShield(0);
    const shieldInput = { component: shield, attackSourceAngle: 0 };

    const timeBefore = Date.now();
    const result = service.applyDamageToEnemy({ health: h, rawDamage: 50, source: 'player', shield: shieldInput });

    expect(result.blocked).toBe(true);
    expect(result.appliedDamage).toBeCloseTo(50 * 0.2, 5); // 80% reduced → 10
    expect(shield.lastBlockTime).toBeGreaterThanOrEqual(timeBefore);
  });

  it('shield outside arc (getBlockReduction 0) — no reduction, blocked false', () => {
    const h = makeHealth(100);
    // Shield facing 0 (east), arc 2π/3 (120 deg). Attack source at π (west) = behind shield.
    const shield = makeShield(0);
    const shieldInput = { component: shield, attackSourceAngle: Math.PI };

    const result = service.applyDamageToEnemy({ health: h, rawDamage: 50, source: 'player', shield: shieldInput });

    expect(result.blocked).toBe(false);
    expect(result.appliedDamage).toBeCloseTo(50, 5); // No reduction
  });

  it('null shield — treated as no shield', () => {
    const h = makeHealth(100);
    const result = service.applyDamageToEnemy({ health: h, rawDamage: 30, source: 'player', shield: null });
    expect(result.blocked).toBe(false);
    expect(result.appliedDamage).toBeCloseTo(30, 5);
  });

  // ── Combined damageReduction + shield ────────────────────────────────────

  it('damageReduction AND shield stack multiplicatively', () => {
    const h = makeHealth(100);
    // damageReduction 0.5 → dmg * 0.5, then shield 0.8 → dmg * 0.5 * 0.2 = dmg * 0.1
    const shield = makeShield(0);
    const shieldInput = { component: shield, attackSourceAngle: 0 };

    const result = service.applyDamageToEnemy({
      health: h,
      rawDamage: 100,
      source: 'player',
      damageReduction: 0.5,
      shield: shieldInput,
    });

    expect(result.appliedDamage).toBeCloseTo(10, 5); // 100 * 0.5 * 0.2
    expect(result.blocked).toBe(true);
  });
});
