import { TestBed } from '@angular/core/testing';
import { PlayerDirectionTrackerService } from './player-direction-tracker.service';

describe('PlayerDirectionTrackerService', () => {
  let service: PlayerDirectionTrackerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PlayerDirectionTrackerService],
    });
    service = TestBed.inject(PlayerDirectionTrackerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should default movement direction to facing right', () => {
      const dir = service.getLastMovementDirection();
      expect(dir.x).toBe(1);
      expect(dir.y).toBe(0);
    });

    it('should default click direction to facing right', () => {
      const dir = service.getLastClickDirection();
      expect(dir.x).toBe(1);
      expect(dir.y).toBe(0);
    });

    it('should default source to none', () => {
      expect(service.getLastDirection().source).toBe('none');
    });
  });

  describe('recordMovementDirection', () => {
    it('should normalize and store the movement direction', () => {
      service.recordMovementDirection(3, 4); // length 5
      const dir = service.getLastMovementDirection();
      expect(dir.x).toBeCloseTo(0.6, 5);
      expect(dir.y).toBeCloseTo(0.8, 5);
    });

    it('should set direction source to movement', () => {
      service.recordMovementDirection(1, 0);
      expect(service.getLastDirection().source).toBe('movement');
    });

    it('should not update when input is zero vector', () => {
      service.recordMovementDirection(1, 0); // set a known state
      service.recordMovementDirection(0, 0); // zero input — should be ignored
      const dir = service.getLastMovementDirection();
      expect(dir.x).toBe(1);
      expect(dir.y).toBe(0);
    });

    it('should update lastDirectionUpdateTime', () => {
      const before = performance.now();
      service.recordMovementDirection(1, 0);
      const elapsed = service.getTimeSinceLastDirection();
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(performance.now() - before + 100); // generous bound
    });
  });

  describe('recordClickDirection', () => {
    it('should normalize and store the click direction', () => {
      service.recordClickDirection(0, 5); // pure down
      const dir = service.getLastClickDirection();
      expect(dir.x).toBeCloseTo(0, 5);
      expect(dir.y).toBeCloseTo(1, 5);
    });

    it('should set direction source to click', () => {
      service.recordClickDirection(0, 1);
      expect(service.getLastDirection().source).toBe('click');
    });

    it('should not update when input is zero vector', () => {
      service.recordClickDirection(0, 1); // set a known state
      service.recordClickDirection(0, 0); // zero input — should be ignored
      const dir = service.getLastClickDirection();
      expect(dir.x).toBeCloseTo(0, 5);
      expect(dir.y).toBeCloseTo(1, 5);
    });
  });

  describe('getLastDirection', () => {
    it('should return movement direction when source is movement', () => {
      service.recordMovementDirection(1, 0);
      const result = service.getLastDirection();
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.source).toBe('movement');
    });

    it('should return click direction when source is click', () => {
      service.recordMovementDirection(1, 0); // set movement first
      service.recordClickDirection(0, 1); // click is more recent
      const result = service.getLastDirection();
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(1, 5);
      expect(result.source).toBe('click');
    });

    it('should reflect the most-recent source (movement after click)', () => {
      service.recordClickDirection(0, 1);
      service.recordMovementDirection(-1, 0);
      const result = service.getLastDirection();
      expect(result.x).toBeCloseTo(-1, 5);
      expect(result.source).toBe('movement');
    });
  });

  describe('getTimeSinceLastDirection', () => {
    it('should return a non-negative value after recording a direction', () => {
      service.recordMovementDirection(1, 0);
      expect(service.getTimeSinceLastDirection()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset', () => {
    it('should restore movement direction to default (facing right)', () => {
      service.recordMovementDirection(0, 1);
      service.reset();
      const dir = service.getLastMovementDirection();
      expect(dir.x).toBe(1);
      expect(dir.y).toBe(0);
    });

    it('should restore click direction to default (facing right)', () => {
      service.recordClickDirection(0, 1);
      service.reset();
      const dir = service.getLastClickDirection();
      expect(dir.x).toBe(1);
      expect(dir.y).toBe(0);
    });

    it('should restore source to none', () => {
      service.recordMovementDirection(1, 0);
      service.reset();
      expect(service.getLastDirection().source).toBe('none');
    });

    it('should reset the update timestamp to 0', () => {
      service.recordMovementDirection(1, 0);
      service.reset();
      // After reset, getTimeSinceLastDirection computes performance.now() - 0,
      // which equals approximately the current performance timestamp (large positive number).
      expect(service.getTimeSinceLastDirection()).toBeGreaterThan(0);
    });
  });
});
