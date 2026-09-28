import { TestBed } from '@angular/core/testing';
import { TerritoryMomentumMetrics, TerritoryMomentumMetricsService } from '../territory';

describe('TerritoryMomentumMetricsService', () => {
  let service: TerritoryMomentumMetricsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TerritoryMomentumMetricsService],
    });
    service = TestBed.inject(TerritoryMomentumMetricsService);
  });

  describe('Update Recording', () => {
    it('should record update metrics', () => {
      service.recordUpdate(10.5, 0.85, 1, 4);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.performance.updateCount).toBe(1);
      expect(metrics.performance.lastUpdateMs).toBe('10.50');
      expect(metrics.balance.current).toBe('0.850');
      expect(metrics.balance.leader).toBe(1);
      expect(metrics.balance.loser).toBe(4);
    });

    it('should calculate average update time', () => {
      service.recordUpdate(10, 0.9, 1, 2);
      service.recordUpdate(20, 0.8, 2, 3);
      service.recordUpdate(15, 0.85, 1, 4);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.performance.avgUpdateMs).toBe('15.00');
      expect(metrics.performance.updateCount).toBe(3);
    });
  });

  describe('Cache Performance', () => {
    it('should track cache hits and misses', () => {
      service.recordCacheHit();
      service.recordCacheHit();
      service.recordCacheMiss();

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.performance.cacheHitRate).toBe('66.7%');
    });

    it('should handle zero cache operations', () => {
      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.performance.cacheHitRate).toBe('0.0%');
    });
  });

  describe('Player Impact Tracking', () => {
    it('should track player kills by faction', () => {
      service.recordPlayerKill(1);
      service.recordPlayerKill(1);
      service.recordPlayerKill(2);
      service.recordPlayerKill(3);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.player.totalKills).toBe(4);
      expect(metrics.player.killsByFaction).toEqual([2, 1, 1, 0]);
    });

    it('should track player deaths by faction', () => {
      service.recordPlayerDeath(2);
      service.recordPlayerDeath(4);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.player.totalDeaths).toBe(2);
    });

    it('should update player influence', () => {
      // Kills increase influence
      service.recordPlayerKill(1);
      service.recordPlayerKill(2);

      let metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(parseFloat(metrics.player.influence)).toBeGreaterThan(0);

      // Deaths decrease influence
      const previousInfluence = parseFloat(metrics.player.influence);
      service.recordPlayerDeath(3);

      metrics = service.getMetrics();
      expect(parseFloat(metrics.player.influence)).toBeLessThan(previousInfluence);
    });

    it('should cap player influence at maximum', () => {
      // Record many kills to reach max influence
      for (let i = 0; i < 1500; i++) {
        service.recordPlayerKill(1);
      }

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(parseFloat(metrics.player.influence)).toBeLessThanOrEqual(10);
    });

    it('should prevent influence from going negative', () => {
      // Record many deaths
      for (let i = 0; i < 100; i++) {
        service.recordPlayerDeath(1);
      }

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(parseFloat(metrics.player.influence)).toBeGreaterThanOrEqual(0);
    });

    it('should ignore invalid faction IDs', () => {
      service.recordPlayerKill(0);
      service.recordPlayerKill(5);
      service.recordPlayerKill(-1);

      service.recordPlayerDeath(0);
      service.recordPlayerDeath(5);
      service.recordPlayerDeath(-1);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.player.totalKills).toBe(0);
      expect(metrics.player.totalDeaths).toBe(0);
    });

    it('should prevent kill count overflow', () => {
      // Record max tracked kills for faction 1
      for (let i = 0; i < 1001; i++) {
        service.recordPlayerKill(1);
      }

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      // Should cap at MAX_TRACKED_KILLS (1000)
      expect(metrics.player.killsByFaction[0]).toBeLessThanOrEqual(1000);
    });
  });

  describe('Game Events', () => {
    it('should track comeback events', () => {
      service.recordComeback();
      service.recordComeback();

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.balance.comebacks).toBe(2);
    });

    it('should track last stand factions', () => {
      service.recordLastStand(2);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.balance.lastStandFactions).toBe(2);
    });
  });

  describe('Balance History', () => {
    it('should maintain circular buffer of balance scores', () => {
      for (let i = 0; i < 5; i++) {
        service.recordUpdate(10, 0.8 + i * 0.02, 1, 4);
      }

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.history.recentBalance.length).toBe(5);
      expect(metrics.history.samples).toBe(5);
    });

    it('should limit history to HISTORY_SIZE', () => {
      // Record more than HISTORY_SIZE updates
      for (let i = 0; i < 150; i++) {
        service.recordUpdate(10, Math.random(), 1, 4);
      }

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.history.samples).toBeLessThanOrEqual(100);
    });

    it('should return recent balance scores in correct order', () => {
      service.recordUpdate(10, 0.85, 1, 4);
      service.recordUpdate(10, 0.8, 1, 4);
      service.recordUpdate(10, 0.75, 1, 4);

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      // Most recent should be last
      expect(metrics.history.recentBalance[metrics.history.recentBalance.length - 1]).toBe(0.75);
    });
  });

  describe('Metrics Caching', () => {
    it('should cache metrics for TTL duration', () => {
      service.recordUpdate(10, 0.85, 1, 4);

      const metrics1 = service.getMetrics();
      const metrics2 = service.getMetrics();

      // Should be the same object (cached)
      expect(metrics1).toBe(metrics2);
    });

    it('should invalidate cache after updates', () => {
      service.recordUpdate(10, 0.85, 1, 4);
      const metrics1 = service.getMetrics();

      service.recordUpdate(15, 0.9, 2, 3);
      const metrics2 = service.getMetrics();

      // Should be different objects (cache invalidated)
      expect(metrics1).not.toBe(metrics2);
      expect(metrics2.balance.current).toBe('0.900');
    });

    it('should rebuild metrics after cache expiry', () => {
      // Manually test cache expiry by spying on Date.now
      let mockTime = 1000;
      spyOn(Date, 'now').and.callFake(() => mockTime);

      service.recordUpdate(10, 0.85, 1, 4);
      const metrics1 = service.getMetrics();

      // Advance time past cache TTL (1 second)
      mockTime += 1001;

      const metrics2 = service.getMetrics();

      // Should be different objects (cache expired and rebuilt)
      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe('Quick Stats', () => {
    it('should provide quick stats without object creation', () => {
      service.recordUpdate(10, 0.85, 1, 4);
      service.recordCacheHit();
      service.recordCacheHit();
      service.recordCacheMiss();

      const stats = service.getQuickStats();

      expect(stats.balance).toBe(0.85);
      expect(stats.cacheRate).toBeCloseTo(0.667, 2);
      expect(stats.avgTime).toBe(10);
    });

    it('should handle zero updates in quick stats', () => {
      const stats = service.getQuickStats();

      expect(stats.balance).toBe(1.0);
      expect(stats.cacheRate).toBe(0);
      expect(stats.avgTime).toBe(0);
    });
  });

  describe('Reset', () => {
    it('should reset all metrics', () => {
      // Add some data
      service.recordUpdate(10, 0.85, 1, 4);
      service.recordPlayerKill(1);
      service.recordPlayerDeath(2);
      service.recordComeback();
      service.recordCacheHit();

      // Reset
      service.reset();

      const metrics: TerritoryMomentumMetrics = service.getMetrics();

      expect(metrics.performance.updateCount).toBe(0);
      expect(metrics.balance.current).toBe('1.000');
      expect(metrics.player.totalKills).toBe(0);
      expect(metrics.player.totalDeaths).toBe(0);
      expect(metrics.balance.comebacks).toBe(0);
      expect(metrics.history.samples).toBe(0);
    });

    it('should clear cached metrics on reset', () => {
      service.recordUpdate(10, 0.85, 1, 4);
      const metrics1 = service.getMetrics();

      service.reset();
      const metrics2 = service.getMetrics();

      // Should be different objects
      expect(metrics1).not.toBe(metrics2);
      expect(metrics2['balance'].current).toBe('1.000');
    });
  });

  describe('Edge Cases', () => {
    it('should handle faction IDs at boundaries', () => {
      service.recordPlayerKill(1); // Valid
      service.recordPlayerKill(4); // Valid
      service.recordPlayerKill(0); // Invalid
      service.recordPlayerKill(5); // Invalid

      const metrics: TerritoryMomentumMetrics = service.getMetrics();
      expect(metrics.player.totalKills).toBe(2);
    });

    it('should handle NaN and Infinity in updates', () => {
      service.recordUpdate(NaN, 0.85, 1, 4);
      service.recordUpdate(Infinity, 0.85, 1, 4);
      service.recordUpdate(10, NaN, 1, 4);

      // Should not crash
      const metrics = service.getMetrics();
      expect(metrics).toBeDefined();
    });

    it('should handle rapid metric requests', async () => {
      // Simulate rapid metric requests
      const promises: Promise<TerritoryMomentumMetrics>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(Promise.resolve(service.getMetrics()));
      }

      const results = await Promise.all(promises);
      // All should return the same cached object
      const first = results[0];
      results.forEach((result) => {
        expect(result).toBe(first);
      });
    });
  });
});
