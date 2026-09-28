import { Injectable, NgZone } from '@angular/core';
import { EngineSystem } from '../utils/system';

@EngineSystem()
@Injectable({ providedIn: 'root' })
export class LoopSystemService {
  private rafId = 0;
  private lastTime = 0;
  private running = false;
  private tickCb: (dt: number, now: number) => void = () => {};

  constructor(private ngZone: NgZone) {}

  /** Start the main loop; the callback receives (deltaMs, nowMs). */
  start(cb: (dt: number, now: number) => void): void {
    this.tickCb = cb;
    if (!this.running) {
      this.running = true;
      this.lastTime = window.performance.now();
      this.ngZone.runOutsideAngular(() => {
        this.rafId = window.requestAnimationFrame(this.frame);
      });
    }
  }

  /** Stops the RAF loop but keeps state so resume() will continue. */
  pause(): void {
    if (this.running) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }
  }

  resume(): void {
    if (!this.running) {
      this.running = true;
      this.lastTime = window.performance.now();
      this.ngZone.runOutsideAngular(() => {
        this.rafId = window.requestAnimationFrame(this.frame);
      });
    }
  }

  /** Stop the loop (alias for pause) */
  stop(): void {
    this.pause();
  }

  /** Fully stop and detach RAF callback */
  destroy(): void {
    this.pause();
    this.tickCb = () => {};
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    let dt = now - this.lastTime;

    // Clamp delta time to prevent huge jumps (e.g., when window loses focus)
    // Maximum delta time is 100ms (10 FPS minimum)
    if (dt > 100) {
      dt = 100;
    }

    // Skip frame if delta time is negative or zero (can happen with time adjustments)
    if (dt <= 0) {
      this.ngZone.runOutsideAngular(() => {
        this.rafId = window.requestAnimationFrame(this.frame);
      });
      return;
    }

    this.lastTime = now;
    this.tickCb(dt, now);
    if (this.running) {
      this.ngZone.runOutsideAngular(() => {
        this.rafId = window.requestAnimationFrame(this.frame);
      });
    }
  };
}
