import { BOSS_ARCHETYPE_TINTS, BossPhaseComponent } from './boss-phase.component';

describe('BossPhaseComponent', () => {
  describe('default construction', () => {
    it('defaults to the standard archetype when no args are passed', () => {
      const c = new BossPhaseComponent();
      expect(c.archetype).toBe('standard');
      expect(c.currentPhase).toBe(1);
      expect(c.maxPhases).toBe(4);
      expect(c.phaseThresholds).toEqual([0.75, 0.5, 0.25]);
    });

    it('initializes runtime multipliers and capture fields to no-op values', () => {
      const c = new BossPhaseComponent();
      expect(c.lastPhaseTransition).toBe(0);
      expect(c.phaseTransitioning).toBe(false);
      expect(c.cooldownMultiplier).toBe(1);
      expect(c.speedMultiplier).toBe(1);
      expect(c.baseSpeed).toBe(0);
      expect(c.baseCooldowns).toEqual([]);
      expect(c.baseFireRate).toBe(0);
    });
  });

  describe('explicit args', () => {
    it('honors currentPhase / maxPhases / phaseThresholds when passed', () => {
      const c = new BossPhaseComponent(2, 3, [0.6, 0.3]);
      expect(c.currentPhase).toBe(2);
      expect(c.maxPhases).toBe(3);
      expect(c.phaseThresholds).toEqual([0.6, 0.3]);
    });
  });

  describe('named archetypes (Phase 5)', () => {
    it('swarm_king picks three phases with later, harder gates', () => {
      const c = new BossPhaseComponent(undefined, undefined, undefined, 'swarm_king');
      expect(c.archetype).toBe('swarm_king');
      expect(c.maxPhases).toBe(3);
      expect(c.phaseThresholds).toEqual([0.6, 0.3]);
    });

    it('pyroclast keeps four phases but front-loads the transitions', () => {
      const c = new BossPhaseComponent(undefined, undefined, undefined, 'pyroclast');
      expect(c.archetype).toBe('pyroclast');
      expect(c.maxPhases).toBe(4);
      expect(c.phaseThresholds).toEqual([0.85, 0.65, 0.4]);
    });

    it('standard archetype is identical to the default-args construction', () => {
      const named = new BossPhaseComponent(undefined, undefined, undefined, 'standard');
      const defaulted = new BossPhaseComponent();
      expect(named.maxPhases).toBe(defaulted.maxPhases);
      expect(named.phaseThresholds).toEqual(defaulted.phaseThresholds);
    });

    it('falls back to standard when handed an unknown archetype string', () => {
      const c = new BossPhaseComponent(undefined, undefined, undefined, 'banana');
      expect(c.archetype).toBe('standard');
      expect(c.maxPhases).toBe(4);
    });

    it('falls back to standard when handed a non-string archetype', () => {
      const c = new BossPhaseComponent(undefined, undefined, undefined, 42);
      expect(c.archetype).toBe('standard');
    });

    it('every archetype caps maxPhases at <= 4 — npc-ability-system only defines multipliers for phases 1-4', () => {
      const archetypes = ['standard', 'swarm_king', 'pyroclast'] as const;
      archetypes.forEach((a) => {
        const c = new BossPhaseComponent(undefined, undefined, undefined, a);
        expect(c.maxPhases).withContext(a).toBeLessThanOrEqual(4);
      });
    });

    it('explicit maxPhases/phaseThresholds override the archetype defaults', () => {
      const c = new BossPhaseComponent(1, 2, [0.5], 'pyroclast');
      // Archetype still recorded for telemetry…
      expect(c.archetype).toBe('pyroclast');
      // …but explicit values win.
      expect(c.maxPhases).toBe(2);
      expect(c.phaseThresholds).toEqual([0.5]);
    });

    it('clamps an explicit maxPhases above 4 down to 4 (npc-ability-system only supports phases 1-4)', () => {
      const c = new BossPhaseComponent(1, 6, [0.9, 0.7, 0.5, 0.3, 0.1], 'standard');
      // Without the clamp, phase 5+ would silently fall back to phase-1
      // multipliers (1.0× cooldown, 1.0× speed) — actually weaker than
      // phase 4. The thresholds are honored as-is so the spec captures
      // contributors' intent, but the engine never reads past phase 4.
      expect(c.maxPhases).toBe(4);
    });
  });

  describe('phaseThresholds invariant', () => {
    it('every archetype produces strictly descending thresholds so the phase-target search lands on the right phase', () => {
      const archetypes = ['standard', 'swarm_king', 'pyroclast'] as const;
      archetypes.forEach((a) => {
        const c = new BossPhaseComponent(undefined, undefined, undefined, a);
        for (let i = 1; i < c.phaseThresholds.length; i++) {
          expect(c.phaseThresholds[i])
            .withContext(`${a} threshold[${i}] < threshold[${i - 1}]`)
            .toBeLessThan(c.phaseThresholds[i - 1]);
        }
      });
    });
  });

  describe('archetype identity tables (Honesty Fix #2)', () => {
    const archetypes = ['standard', 'swarm_king', 'pyroclast'] as const;

    it('exposes a tint entry for every archetype so the draw layer never sees undefined', () => {
      archetypes.forEach((a) => {
        expect(a in BOSS_ARCHETYPE_TINTS)
          .withContext(`tint for ${a}`)
          .toBeTrue();
      });
    });

    it("standard's tint is null so the canonical sprite renders untouched", () => {
      expect(BOSS_ARCHETYPE_TINTS.standard).toBeNull();
    });

    it('swarm king + pyroclast tints are rgba strings (parseable by ctx.fillStyle)', () => {
      expect(BOSS_ARCHETYPE_TINTS.swarm_king).toMatch(/^rgba\(/);
      expect(BOSS_ARCHETYPE_TINTS.pyroclast).toMatch(/^rgba\(/);
    });
  });
});
