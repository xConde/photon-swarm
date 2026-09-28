import { TestBed } from '@angular/core/testing';
import { SeededRandomService } from './seeded-random.service';

describe('SeededRandomService', () => {
  let service: SeededRandomService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SeededRandomService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should produce deterministic results with same seed', () => {
    const testSeed = 'test-seed-123';

    // Generate sequence with first instance
    service.setSeed(testSeed);
    const sequence1 = [];
    for (let i = 0; i < 10; i++) {
      sequence1.push(service.random());
    }

    // Generate sequence with same seed
    service.setSeed(testSeed);
    const sequence2 = [];
    for (let i = 0; i < 10; i++) {
      sequence2.push(service.random());
    }

    // Should be identical
    expect(sequence1).toEqual(sequence2);
  });

  it('should produce different results with different seeds', () => {
    service.setSeed('seed1');
    const value1 = service.random();

    service.setSeed('seed2');
    const value2 = service.random();

    expect(value1).not.toEqual(value2);
  });

  it('should generate values between 0 and 1', () => {
    service.setSeed('test');

    for (let i = 0; i < 100; i++) {
      const value = service.random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('should fork correctly', () => {
    service.setSeed('main-seed');
    const mainValue = service.random();

    const forked = service.fork('branch');
    const forkedValue = forked.random();

    // Should be different sequences
    expect(mainValue).not.toEqual(forkedValue);

    // But forked sequence should be deterministic
    const forked2 = service.fork('branch');
    const forkedValue2 = forked2.random();
    expect(forkedValue).toEqual(forkedValue2);
  });

  it('should generate world seeds correctly', () => {
    const seed = SeededRandomService.generateWorldSeed(1234567890, 4, '1.0');
    expect(seed).toBe('1234567890-k4-v1.0');
  });

  it('should parse world seeds correctly', () => {
    const seed = '1234567890-k4-v1.0';
    const parsed = SeededRandomService.parseWorldSeed(seed);

    expect(parsed).toEqual({
      timestamp: 1234567890,
      kingCount: 4,
      version: '1.0',
    });
  });

  it('should return null for invalid seed format', () => {
    const parsed = SeededRandomService.parseWorldSeed('invalid-seed');
    expect(parsed).toBeNull();
  });
});
