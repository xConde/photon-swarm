import { TestBed } from '@angular/core/testing';
import { TimeScaleService } from './time-scale.service';

describe('TimeScaleService', () => {
  let service: TimeScaleService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TimeScaleService);
    jasmine.clock().install();
  });

  afterEach(() => {
    service.reset();
    jasmine.clock().uninstall();
  });

  it('should initialize with time scale of 1.0', () => {
    expect(service.getTimeScale()).toBe(1.0);
  });

  it('should report isSlowMotion() false at normal time scale', () => {
    expect(service.isSlowMotion()).toBeFalse();
  });

  it('should apply slow motion and report correct scale', () => {
    service.applySlowMotion(0.5, 1000);
    expect(service.getTimeScale()).toBe(0.5);
    expect(service.isSlowMotion()).toBeTrue();
  });

  it('should clamp scale to minimum of 0.1', () => {
    service.applySlowMotion(0.0, 1000);
    expect(service.getTimeScale()).toBe(0.1);
  });

  it('should clamp scale to maximum of 1.0', () => {
    service.applySlowMotion(2.0, 1000);
    // A value >= 1.0 won't trigger slow motion (isSlowMotion is false), so it stays 1.0
    expect(service.getTimeScale()).toBe(1.0);
    expect(service.isSlowMotion()).toBeFalse();
  });

  it('should restore time scale to 1.0 after duration elapses', () => {
    service.applySlowMotion(0.3, 500);
    expect(service.getTimeScale()).toBe(0.3);
    jasmine.clock().tick(500);
    expect(service.getTimeScale()).toBe(1.0);
    expect(service.isSlowMotion()).toBeFalse();
  });

  it('should replace shallow slow-motion with a deeper one', () => {
    service.applySlowMotion(0.5, 2000);
    expect(service.getTimeScale()).toBe(0.5);

    // Deeper slow-motion (lower scale) should replace the shallow one
    service.applySlowMotion(0.2, 1000);
    expect(service.getTimeScale()).toBe(0.2);
  });

  it('should ignore a shallower slow-motion request when already in deeper slow-motion', () => {
    service.applySlowMotion(0.2, 2000);
    // 0.5 is shallower than current 0.2 — should be ignored
    service.applySlowMotion(0.5, 500);
    expect(service.getTimeScale()).toBe(0.2);
  });

  it('should reset to normal time scale immediately', () => {
    service.applySlowMotion(0.3, 5000);
    expect(service.isSlowMotion()).toBeTrue();
    service.reset();
    expect(service.getTimeScale()).toBe(1.0);
    expect(service.isSlowMotion()).toBeFalse();
  });

  it('should cancel pending restore timer on reset so it does not fire later', () => {
    service.applySlowMotion(0.3, 500);
    service.reset();
    // Timer should be cancelled; ticking past duration should not change anything
    jasmine.clock().tick(1000);
    expect(service.getTimeScale()).toBe(1.0);
  });

  it('should replace the pending restore timer when a new slow-motion is applied', () => {
    service.applySlowMotion(0.5, 500);
    // Apply a deeper one that overrides it
    service.applySlowMotion(0.2, 1000);

    // Old timer at 500ms should have been cancelled
    jasmine.clock().tick(500);
    expect(service.getTimeScale()).toBe(0.2);

    // New timer fires at the 1000ms mark
    jasmine.clock().tick(500);
    expect(service.getTimeScale()).toBe(1.0);
  });

  it('should apply slow motion when not currently in slow-motion even if new scale equals 1.0', () => {
    // scale of 1.0 gets clamped to 1.0; since timeScale is already 1.0 the condition
    // "clamped >= timeScale && timeScale < 1.0" is false, so it proceeds
    service.applySlowMotion(1.0, 500);
    // 1.0 is not < 1.0 so isSlowMotion is false and timeScale stays at 1.0
    expect(service.getTimeScale()).toBe(1.0);
    expect(service.isSlowMotion()).toBeFalse();
  });
});
