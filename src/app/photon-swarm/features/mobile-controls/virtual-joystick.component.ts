import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  NgZone,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';

import { DeviceInfo, TouchDetectionService } from './touch-detection.service';
import { JOYSTICK_SIZES, JoystickEvent, JoystickPosition, JoystickType } from './mobile-controls.types';

/** How long (ms) a press-without-drag must be held before it enters 'charging' state. */
const STICK_PRESS_HOLD_MS = 250;

interface JoystickSizeConfig {
  readonly base: number;
  readonly stick: number;
  readonly maxDistance: number;
}

@Component({
  selector: 'app-virtual-joystick',
  standalone: true,
  imports: [],
  templateUrl: './virtual-joystick.component.html',
  styleUrls: ['./virtual-joystick.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VirtualJoystickComponent implements AfterViewInit, OnDestroy {
  @ViewChild('joystickBase') joystickBase!: ElementRef<HTMLDivElement>;
  @ViewChild('joystickStick') joystickStick!: ElementRef<HTMLDivElement>;

  @Input() type: JoystickType = 'movement';
  @Input() position: JoystickPosition = 'left';
  @Input() sensitivity = 1.0;

  @Output() joystickChange = new EventEmitter<JoystickEvent>();
  /**
   * Aim-joystick only (`type === 'aim'`). Emits `{ pressed: true }` after the touch has
   * been held still for STICK_PRESS_HOLD_MS without dragging beyond the dead zone
   * (enters 'charging' state). Emits `{ pressed: false }` on touchend/touchcancel when
   * the charging state is active (fires the burst).
   */
  @Output() stickPress = new EventEmitter<{ pressed: boolean }>();

  isActive = false;
  isVisible = false;
  /** True while the aim stick is in the 'charging' (burst) state. */
  isCharging = false;
  stickTransform = 'translate(-50%, -50%)';
  baseSize: number = JOYSTICK_SIZES.MOBILE_PORTRAIT.base;
  stickSize: number = JOYSTICK_SIZES.MOBILE_PORTRAIT.stick;

  private readonly touchDetection = inject(TouchDetectionService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  private activeTouchId: number | null = null;
  private maxDistance: number = JOYSTICK_SIZES.MOBILE_PORTRAIT.maxDistance;
  private deviceSubscription: Subscription | null = null;
  /** Cached bounding rect — read once on touchstart, cleared on touchend. */
  private cachedRect: DOMRect | null = null;
  /**
   * Pending timer for the aim stick press detection (aim joystick only).
   * Set on touchstart; fires after STICK_PRESS_HOLD_MS if displacement stayed within the
   * dead zone; cleared immediately if the touch drags beyond the dead zone or on touchend.
   */
  private stickPressTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True if the initial touch displacement stayed within the dead zone when the hold
   * timer first fires — prevents late drag from cancelling an already-entered charge.
   */
  private stickPressDragCancelled = false;

  private readonly boundTouchStart = (e: TouchEvent): void => this.onTouchStart(e);
  private readonly boundTouchMove = (e: TouchEvent): void => this.onTouchMove(e);
  private readonly boundTouchEnd = (e: TouchEvent): void => this.onTouchEnd(e);

  ngAfterViewInit(): void {
    this.deviceSubscription = this.touchDetection.getDeviceInfo().subscribe((info) => {
      this.updateSizing(info);
      this.isVisible = info.showVirtualControls;
      this.cdr.markForCheck();
    });

    this.ngZone.runOutsideAngular(() => {
      const el = this.joystickBase.nativeElement;
      const options: AddEventListenerOptions = { passive: true, capture: true };

      el.addEventListener('touchstart', this.boundTouchStart, options);
      el.addEventListener('touchmove', this.boundTouchMove, options);
      el.addEventListener('touchend', this.boundTouchEnd, options);
      el.addEventListener('touchcancel', this.boundTouchEnd, options);
    });
  }

  ngOnDestroy(): void {
    this.deviceSubscription?.unsubscribe();

    // Cancel any pending press timer to prevent post-destroy callbacks.
    if (this.stickPressTimer !== null) {
      clearTimeout(this.stickPressTimer);
      this.stickPressTimer = null;
    }

    // Emit zero vector if destroyed mid-touch to prevent stuck keys in PlayerService
    if (this.activeTouchId !== null) {
      this.joystickChange.emit({
        type: this.type,
        vector: { x: 0, y: 0 },
        active: false,
      });
      this.activeTouchId = null;
    }

    const el = this.joystickBase?.nativeElement;
    if (el) {
      const options: AddEventListenerOptions = { capture: true };
      el.removeEventListener('touchstart', this.boundTouchStart, options);
      el.removeEventListener('touchmove', this.boundTouchMove, options);
      el.removeEventListener('touchend', this.boundTouchEnd, options);
      el.removeEventListener('touchcancel', this.boundTouchEnd, options);
    }
  }

  private onTouchStart(event: TouchEvent): void {
    if (this.activeTouchId !== null) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    this.activeTouchId = touch.identifier;
    this.isActive = true;
    // Cache the bounding rect once per gesture so touchmove never forces a layout read.
    this.cachedRect = this.joystickBase.nativeElement.getBoundingClientRect();
    this.updateStickPosition(touch);

    // Aim joystick only: start the press-detect hold timer.
    // If the touch displacement stays within the dead zone for STICK_PRESS_HOLD_MS, enter
    // 'charging' state and emit stickPress({ pressed: true }).
    if (this.type === 'aim') {
      this.stickPressDragCancelled = false;
      this.stickPressTimer = setTimeout(() => {
        this.stickPressTimer = null;
        if (!this.stickPressDragCancelled) {
          this.isCharging = true;
          this.stickPress.emit({ pressed: true });
          this.ngZone.run(() => {
            this.cdr.markForCheck();
          });
        }
      }, STICK_PRESS_HOLD_MS);
    }

    this.ngZone.run(() => {
      this.cdr.markForCheck();
    });
  }

  private onTouchMove(event: TouchEvent): void {
    if (this.activeTouchId === null) {
      return;
    }

    const touch = this.findTouch(event.touches);
    if (!touch) {
      return;
    }

    this.updateStickPosition(touch);
  }

  private onTouchEnd(event: TouchEvent): void {
    if (this.activeTouchId === null) {
      return;
    }

    // Our tracked touch has ended if it appears in changedTouches OR is simply no longer
    // among the still-active touches. iOS can fire touchcancel (system gestures, or rapid
    // multitouch across both joysticks + the action buttons) with our touch ABSENT from
    // changedTouches. The old `if (!findTouch(changedTouches)) return` then left
    // activeTouchId stuck non-null — so onTouchStart refused new grips and PlayerService
    // stayed in directionChangeActive, locking the ship in slow-rotate ("won't exit rotate
    // mode / the stick isn't present"). Releasing whenever the touch is truly gone clears it.
    const endedInChanged = this.findTouch(event.changedTouches) !== null;
    const stillActive = this.findTouch(event.touches) !== null;
    if (!endedInChanged && stillActive) {
      // A different touch ended; ours is still pressed — keep tracking it.
      return;
    }

    // Aim joystick: clear the press timer and fire the burst if we were charging.
    if (this.type === 'aim') {
      if (this.stickPressTimer !== null) {
        clearTimeout(this.stickPressTimer);
        this.stickPressTimer = null;
      }
      if (this.isCharging) {
        this.isCharging = false;
        this.stickPress.emit({ pressed: false });
      }
      this.stickPressDragCancelled = false;
    }

    this.activeTouchId = null;
    this.isActive = false;
    this.cachedRect = null;
    this.stickTransform = 'translate(-50%, -50%)';

    this.joystickChange.emit({
      type: this.type,
      vector: { x: 0, y: 0 },
      active: false,
    });

    this.ngZone.run(() => {
      this.cdr.markForCheck();
    });
  }

  private updateStickPosition(touch: Touch): void {
    // Use the rect cached on touchstart; fall back to a live read only if somehow null.
    const rect = this.cachedRect ?? this.joystickBase.nativeElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let deltaX = touch.clientX - centerX;
    let deltaY = touch.clientY - centerY;

    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Aim joystick: if the displacement exceeds the dead zone before the press timer has
    // fired, cancel the timer — it's a normal aim gesture, not a burst press.
    if (this.type === 'aim' && this.stickPressTimer !== null && distance > this.maxDistance * 0.5) {
      clearTimeout(this.stickPressTimer);
      this.stickPressTimer = null;
      this.stickPressDragCancelled = true;
    }

    if (distance > this.maxDistance) {
      const scale = this.maxDistance / distance;
      deltaX *= scale;
      deltaY *= scale;
    }

    const normalizedX = (deltaX / this.maxDistance) * this.sensitivity;
    const normalizedY = (deltaY / this.maxDistance) * this.sensitivity;

    const clampedX = Math.max(-1, Math.min(1, normalizedX));
    const clampedY = Math.max(-1, Math.min(1, normalizedY));

    this.stickTransform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;

    this.joystickChange.emit({
      type: this.type,
      vector: { x: clampedX, y: clampedY },
      active: true,
    });

    this.ngZone.run(() => {
      this.cdr.markForCheck();
    });
  }

  private findTouch(touches: TouchList): Touch | null {
    for (let i = 0; i < touches.length; i++) {
      const touch = touches.item(i);
      if (touch && touch.identifier === this.activeTouchId) {
        return touch;
      }
    }
    return null;
  }

  private updateSizing(info: DeviceInfo): void {
    const sizeConfig: JoystickSizeConfig =
      info.deviceType === 'tablet'
        ? { ...JOYSTICK_SIZES.TABLET }
        : info.orientation === 'landscape'
          ? { ...JOYSTICK_SIZES.MOBILE_LANDSCAPE }
          : { ...JOYSTICK_SIZES.MOBILE_PORTRAIT };

    this.baseSize = sizeConfig.base;
    this.stickSize = sizeConfig.stick;
    this.maxDistance = sizeConfig.maxDistance;
  }
}
