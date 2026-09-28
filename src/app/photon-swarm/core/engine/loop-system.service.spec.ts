import { discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { LoopSystemService } from './loop-system.service';

describe('LoopSystemService', () => {
  let service: LoopSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [LoopSystemService] });
    service = TestBed.inject(LoopSystemService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  it('should invoke callback each frame and pause/resume', fakeAsync(() => {
    const calls: number[] = [];
    // Track fake time for performance.now()
    let fakeTime = 0;
    let frameCount = 0;

    // Mock performance.now to use fake time that advances with tick()
    spyOn(window.performance, 'now').and.callFake(() => fakeTime);

    spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
      frameCount++;
      if (frameCount > 20) {
        return 0; // stop scheduling further frames
      }
      // Schedule callback after 16ms, advancing fakeTime to simulate real RAF behavior
      return window.setTimeout(() => {
        fakeTime += 16;
        cb(fakeTime);
      }, 16);
    });
    spyOn(window, 'cancelAnimationFrame').and.callFake((id) => clearTimeout(id));

    service.start((dt) => calls.push(dt));

    // advance virtual time 50 ms (should get ~3 frames at 16ms each)
    tick(50);
    expect(calls.length).toBeGreaterThan(0);

    service.pause();
    const afterPause = calls.length;
    tick(50);
    expect(calls.length).toBe(afterPause); // no new frames while paused

    service.resume();
    tick(50);
    expect(calls.length).toBeGreaterThan(afterPause);

    // Stop the loop to avoid leftover timers
    service.pause();

    // Flush any remaining queued callbacks/timers
    discardPeriodicTasks();
  }));

  it('does not queue another frame when the tick stops the loop', () => {
    let frameCallback: FrameRequestCallback | undefined;
    const requestFrame = spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 1;
    });
    spyOn(window, 'cancelAnimationFrame');
    spyOn(window.performance, 'now').and.returnValue(0);

    service.start(() => service.stop());
    expect(requestFrame).toHaveBeenCalledTimes(1);

    frameCallback?.(16);

    expect(requestFrame).toHaveBeenCalledTimes(1);
  });
});
