import { TestBed } from '@angular/core/testing';
import { FrameSkipManagerService } from './frame-skip-manager.service';

describe('FrameSkipManagerService', () => {
  let service: FrameSkipManagerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FrameSkipManagerService],
    });
    service = TestBed.inject(FrameSkipManagerService);
  });

  describe('shouldRun', () => {
    it('should return true for unconfigured systems', () => {
      expect(service.shouldRun('unknown-system')).toBe(true);
    });

    it('should respect skip rates for configured systems', () => {
      // Set a skip rate of 4 (run every 4th frame)
      service.setSkipRate('test-system', 4);

      // Should run on frames 0, 4, 8, etc. (counter starts at 0)
      expect(service.shouldRun('test-system')).toBe(true); // Frame 0: 0 % 4 === 0
      expect(service.shouldRun('test-system')).toBe(false); // Frame 1: 1 % 4 !== 0
      expect(service.shouldRun('test-system')).toBe(false); // Frame 2: 2 % 4 !== 0
      expect(service.shouldRun('test-system')).toBe(false); // Frame 3: 3 % 4 !== 0
      expect(service.shouldRun('test-system')).toBe(true); // Frame 4: 4 % 4 === 0
      expect(service.shouldRun('test-system')).toBe(false); // Frame 5: 5 % 4 !== 0
    });

    it('should run critical systems every frame', () => {
      // Collision should run every frame
      for (let i = 0; i < 10; i++) {
        expect(service.shouldRun('collision')).toBe(true);
      }
    });

    it('should skip frames for low priority systems', () => {
      // Minimap should only run occasionally
      let runCount = 0;
      for (let i = 0; i < 16; i++) {
        if (service.shouldRun('minimap')) {
          runCount++;
        }
      }
      // Should run less frequently
      expect(runCount).toBeLessThan(8);
    });

    // FIX: Test for newly registered AI behavior system
    it('should have ai-behavior system registered at MEDIUM priority', () => {
      const rate = service.getSkipRate('ai-behavior');
      expect(rate).toBe(4); // MEDIUM priority = every 4 frames
    });

    // FIX: Test for newly registered idle-behavior system
    it('should have idle-behavior system registered at MEDIUM priority', () => {
      const rate = service.getSkipRate('idle-behavior');
      expect(rate).toBe(4); // MEDIUM priority = every 4 frames
    });

    // FIX: Test that AI systems skip frames appropriately
    it('should skip frames for ai-behavior system (MEDIUM priority)', () => {
      let runCount = 0;
      for (let i = 0; i < 16; i++) {
        if (service.shouldRun('ai-behavior')) {
          runCount++;
        }
      }
      // MEDIUM = every 4 frames, so 16 frames should run 4 times
      expect(runCount).toBe(4);
    });
  });

  describe('adjustForPerformance', () => {
    it('should increase skip rates when performance is poor', () => {
      const originalRate = service.getSkipRate('enemy-movement');

      // Simulate 20 FPS (33% of target)
      service.adjustForPerformance(20, 60);

      const newRate = service.getSkipRate('enemy-movement');
      expect(newRate).toBeGreaterThan(originalRate);
    });

    it('should restore normal rates when performance is good', () => {
      // First degrade performance
      service.adjustForPerformance(20, 60);

      // Then restore good performance
      service.adjustForPerformance(58, 60);

      // Should be back to normal rate
      const rate = service.getSkipRate('enemy-movement');
      expect(rate).toBe(2); // Default HIGH priority rate
    });

    it('should never set skip rate below 1', () => {
      service.adjustForPerformance(120, 60); // 200% performance

      const rate = service.getSkipRate('collision');
      expect(rate).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getStats', () => {
    it('should return statistics for all systems', () => {
      const stats = service.getStats();

      expect(stats.length).toBeGreaterThan(0);

      // Check that stats are sorted by rate
      for (let i = 1; i < stats.length; i++) {
        expect(stats[i].rate).toBeGreaterThanOrEqual(stats[i - 1].rate);
      }

      // Verify FPS calculation
      const collisionStat = stats.find((s) => s.system === 'collision');
      expect(collisionStat).toBeDefined();
      expect(collisionStat!.fps).toBe(60); // Should run at 60 FPS

      const minimapStat = stats.find((s) => s.system === 'minimap');
      expect(minimapStat).toBeDefined();
      expect(minimapStat!.fps).toBeLessThan(10); // Should run less frequently
    });
  });

  describe('reset', () => {
    it('should reset all counters and rates', () => {
      // Modify some rates
      service.setSkipRate('test-system', 10);
      service.adjustForPerformance(20, 60);

      // Run some frames
      for (let i = 0; i < 100; i++) {
        service.shouldRun('collision');
      }

      // Reset
      service.reset();

      // Should be back to defaults
      expect(service.getSkipRate('collision')).toBe(1);
      expect(service.getSkipRate('test-system')).toBe(1); // Unknown system default
    });
  });
});
