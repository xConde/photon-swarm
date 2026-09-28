import { MinionTagComponent } from './minion-tag.component';

describe('MinionTagComponent', () => {
  describe('default construction (no args)', () => {
    it('should create with default values', () => {
      const comp = new MinionTagComponent();
      expect(comp.ownerId).toBe(0);
      expect(comp.spawnedAt).toBeGreaterThan(0);
    });

    it('should be stable (repeated no-arg constructions do not throw)', () => {
      expect(() => new MinionTagComponent()).not.toThrow();
      expect(() => new MinionTagComponent()).not.toThrow();
    });
  });

  describe('custom args', () => {
    it('should set ownerId from first arg', () => {
      const comp = new MinionTagComponent(42);
      expect(comp.ownerId).toBe(42);
    });

    it('should set spawnedAt from second arg', () => {
      const ts = 1234567890;
      const comp = new MinionTagComponent(7, ts);
      expect(comp.ownerId).toBe(7);
      expect(comp.spawnedAt).toBe(ts);
    });
  });

  describe('component contract', () => {
    it('should have correct component name', () => {
      const comp = new MinionTagComponent();
      expect(comp.name).toBe('MinionTagComponent');
    });

    it('should accept unknown[] constructor args (ECS contract)', () => {
      const args: unknown[] = [99, 111111];
      const comp = new MinionTagComponent(...args);
      expect(comp.ownerId).toBe(99);
      expect(comp.spawnedAt).toBe(111111);
    });
  });
});
