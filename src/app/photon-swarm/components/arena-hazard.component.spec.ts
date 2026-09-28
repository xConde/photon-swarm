import { ArenaHazardComponent } from './arena-hazard.component';

describe('ArenaHazardComponent', () => {
  describe('no-arg construction', () => {
    it('constructs without arguments without throwing', () => {
      expect(() => new ArenaHazardComponent()).not.toThrow();
    });

    it('applies default radius 150', () => {
      expect(new ArenaHazardComponent().radius).toBe(150);
    });

    it('applies default damage 16', () => {
      expect(new ArenaHazardComponent().damage).toBe(16);
    });

    it('applies default archetype "standard"', () => {
      expect(new ArenaHazardComponent().archetype).toBe('standard');
    });

    it('applies default telegraphMs 900', () => {
      expect(new ArenaHazardComponent().telegraphMs).toBe(900);
    });

    it('applies default lingerMs 250', () => {
      expect(new ArenaHazardComponent().lingerMs).toBe(250);
    });

    it('starts with detonated false', () => {
      expect(new ArenaHazardComponent().detonated).toBeFalse();
    });

    it('starts with lastTelegraphPulseAt 0', () => {
      expect(new ArenaHazardComponent().lastTelegraphPulseAt).toBe(0);
    });

    it('sets spawnedAt close to Date.now()', () => {
      const before = Date.now();
      const comp = new ArenaHazardComponent();
      const after = Date.now();
      expect(comp.spawnedAt).toBeGreaterThanOrEqual(before);
      expect(comp.spawnedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('custom arg construction', () => {
    it('accepts custom radius, damage, archetype, spawnedAt, telegraphMs, lingerMs', () => {
      const spawnedAt = Date.now() - 500;
      const comp = new ArenaHazardComponent(180, 22, 'pyroclast', spawnedAt, 800, 300);
      expect(comp.radius).toBe(180);
      expect(comp.damage).toBe(22);
      expect(comp.archetype).toBe('pyroclast');
      expect(comp.spawnedAt).toBe(spawnedAt);
      expect(comp.telegraphMs).toBe(800);
      expect(comp.lingerMs).toBe(300);
    });

    it('accepts swarm_king archetype', () => {
      const comp = new ArenaHazardComponent(130, 12, 'swarm_king');
      expect(comp.archetype).toBe('swarm_king');
    });
  });

  describe('isDetonationMoment', () => {
    it('returns false just before telegraphMs elapses', () => {
      const spawnedAt = 1000;
      const telegraphMs = 900;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, telegraphMs);
      // now = spawnedAt + telegraphMs - 1 → not yet
      expect(comp.isDetonationMoment(spawnedAt + telegraphMs - 1)).toBeFalse();
    });

    it('returns true exactly at telegraphMs', () => {
      const spawnedAt = 1000;
      const telegraphMs = 900;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, telegraphMs);
      expect(comp.isDetonationMoment(spawnedAt + telegraphMs)).toBeTrue();
    });

    it('returns true after telegraphMs has elapsed', () => {
      const spawnedAt = 1000;
      const telegraphMs = 900;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, telegraphMs);
      expect(comp.isDetonationMoment(spawnedAt + telegraphMs + 100)).toBeTrue();
    });

    it('returns false when detonated is already true (prevents re-damage)', () => {
      const spawnedAt = 1000;
      const telegraphMs = 900;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, telegraphMs);
      comp.detonated = true;
      expect(comp.isDetonationMoment(spawnedAt + telegraphMs + 500)).toBeFalse();
    });
  });

  describe('isExpired', () => {
    it('returns false before telegraphMs + lingerMs', () => {
      const spawnedAt = 1000;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, 900, 250);
      // total = 1150 → before is 1149
      expect(comp.isExpired(spawnedAt + 900 + 250 - 1)).toBeFalse();
    });

    it('returns true exactly at telegraphMs + lingerMs', () => {
      const spawnedAt = 1000;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, 900, 250);
      expect(comp.isExpired(spawnedAt + 900 + 250)).toBeTrue();
    });

    it('returns true after the full expiry window', () => {
      const spawnedAt = 1000;
      const comp = new ArenaHazardComponent(150, 16, 'standard', spawnedAt, 900, 250);
      expect(comp.isExpired(spawnedAt + 900 + 250 + 500)).toBeTrue();
    });
  });

  describe('shouldPulseTelegraph / markTelegraphPulsed (red-team Finding 1)', () => {
    const spawnedAt = 1000;
    const telegraphMs = 900;
    const cadence = 300;

    function comp(): ArenaHazardComponent {
      return new ArenaHazardComponent(150, 16, 'standard', spawnedAt, telegraphMs, 250);
    }

    it('fires the first pulse immediately while in the telegraph window', () => {
      expect(comp().shouldPulseTelegraph(spawnedAt, cadence)).toBeTrue();
    });

    it('does not re-pulse before the cadence has elapsed', () => {
      const c = comp();
      c.markTelegraphPulsed(spawnedAt);
      expect(c.shouldPulseTelegraph(spawnedAt + cadence - 1, cadence)).toBeFalse();
    });

    it('re-pulses once the cadence has elapsed (still in telegraph window)', () => {
      const c = comp();
      c.markTelegraphPulsed(spawnedAt);
      expect(c.shouldPulseTelegraph(spawnedAt + cadence, cadence)).toBeTrue();
    });

    it('stops pulsing once the telegraph window closes (at detonation time)', () => {
      const c = comp();
      c.markTelegraphPulsed(spawnedAt + 600);
      // now == spawnedAt + telegraphMs → detonation moment, window closed
      expect(c.shouldPulseTelegraph(spawnedAt + telegraphMs, cadence)).toBeFalse();
    });

    it('markTelegraphPulsed records the pulse time', () => {
      const c = comp();
      c.markTelegraphPulsed(spawnedAt + 123);
      expect(c.lastTelegraphPulseAt).toBe(spawnedAt + 123);
    });
  });
});
