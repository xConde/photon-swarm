import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VirtualJoystickComponent } from './virtual-joystick.component';
import { DeviceInfo, TouchDetectionService } from './touch-detection.service';
import { JOYSTICK_SIZES, JoystickEvent } from './mobile-controls.types';
import { BehaviorSubject } from 'rxjs';

/** Creates a minimal Touch-like object for use in touch events. */
function makeTouch(id: number, x: number, y: number): Touch {
  return { identifier: id, clientX: x, clientY: y } as Touch;
}

/** Creates a TouchEvent with the given touches list. */
function makeTouchEvent(type: string, touches: Touch[], changedTouches: Touch[]): TouchEvent {
  return {
    type,
    touches: { length: touches.length, item: (i: number) => touches[i] } as unknown as TouchList,
    changedTouches: {
      length: changedTouches.length,
      item: (i: number) => changedTouches[i],
      0: changedTouches[0],
    } as unknown as TouchList,
    preventDefault: jasmine.createSpy('preventDefault'),
    stopPropagation: jasmine.createSpy('stopPropagation'),
  } as unknown as TouchEvent;
}

describe('VirtualJoystickComponent', () => {
  let component: VirtualJoystickComponent;
  let fixture: ComponentFixture<VirtualJoystickComponent>;
  let mockTouchDetection: jasmine.SpyObj<TouchDetectionService>;
  let deviceInfo$: BehaviorSubject<DeviceInfo>;

  const mobileDeviceInfo: DeviceInfo = {
    hasTouchSupport: true,
    deviceType: 'mobile',
    orientation: 'portrait',
    screenWidth: 375,
    screenHeight: 812,
    showVirtualControls: true,
  };

  const desktopDeviceInfo: DeviceInfo = {
    hasTouchSupport: false,
    deviceType: 'desktop',
    orientation: 'landscape',
    screenWidth: 1440,
    screenHeight: 900,
    showVirtualControls: false,
  };

  beforeEach(async () => {
    deviceInfo$ = new BehaviorSubject<DeviceInfo>({ ...mobileDeviceInfo });

    mockTouchDetection = jasmine.createSpyObj('TouchDetectionService', ['getDeviceInfo', 'getDeviceInfoSnapshot']);
    mockTouchDetection.getDeviceInfo.and.returnValue(deviceInfo$.asObservable());
    mockTouchDetection.getDeviceInfoSnapshot.and.returnValue({ ...mobileDeviceInfo });

    await TestBed.configureTestingModule({
      imports: [VirtualJoystickComponent],
      providers: [{ provide: TouchDetectionService, useValue: mockTouchDetection }],
    }).compileComponents();

    fixture = TestBed.createComponent(VirtualJoystickComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('ngAfterViewInit', () => {
    it('should subscribe to device info and set isVisible', () => {
      fixture.detectChanges();
      expect(component.isVisible).toBe(true);
    });

    it('should set isVisible to false when device info shows desktop', () => {
      deviceInfo$.next({ ...desktopDeviceInfo });
      fixture.detectChanges();
      expect(component.isVisible).toBe(false);
    });
  });

  describe('sizing', () => {
    it('should use MOBILE_PORTRAIT sizes for mobile portrait', () => {
      fixture.detectChanges();
      // Assert against the config (not magic numbers) so size tuning doesn't break the spec.
      expect(component.baseSize).toBe(JOYSTICK_SIZES.MOBILE_PORTRAIT.base);
      expect(component.stickSize).toBe(JOYSTICK_SIZES.MOBILE_PORTRAIT.stick);
    });

    it('should use MOBILE_LANDSCAPE sizes for mobile landscape', () => {
      const landscapeInfo: DeviceInfo = { ...mobileDeviceInfo, orientation: 'landscape' };
      deviceInfo$.next(landscapeInfo);
      fixture.detectChanges();
      expect(component.baseSize).toBe(JOYSTICK_SIZES.MOBILE_LANDSCAPE.base);
      expect(component.stickSize).toBe(JOYSTICK_SIZES.MOBILE_LANDSCAPE.stick);
    });

    it('should use TABLET sizes for tablet devices', () => {
      const tabletInfo: DeviceInfo = {
        ...mobileDeviceInfo,
        deviceType: 'tablet',
        screenWidth: 768,
        screenHeight: 1024,
      };
      deviceInfo$.next(tabletInfo);
      fixture.detectChanges();
      expect(component.baseSize).toBe(JOYSTICK_SIZES.TABLET.base);
      expect(component.stickSize).toBe(JOYSTICK_SIZES.TABLET.stick);
    });
  });

  describe('touch interactions', () => {
    let emittedEvents: JoystickEvent[];

    beforeEach(() => {
      emittedEvents = [];
      fixture.detectChanges();
      component.joystickChange.subscribe((e) => emittedEvents.push(e));

      // Stub getBoundingClientRect to return a centered 120x120 rect
      spyOn(component.joystickBase.nativeElement, 'getBoundingClientRect').and.returnValue({
        left: 40,
        top: 340,
        width: 120,
        height: 120,
        right: 160,
        bottom: 460,
      } as DOMRect);
    });

    it('should start inactive before any touch', () => {
      expect(component.isActive).toBe(false);
    });

    it('should become active on touchstart', () => {
      const touch = makeTouch(1, 100, 400);
      const event = makeTouchEvent('touchstart', [touch], [touch]);

      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(event);

      expect(component.isActive).toBe(true);
    });

    it('should emit a joystickChange event with active=true on touch move', () => {
      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      const moveTouch = makeTouch(1, 110, 410);
      const moveEvent = makeTouchEvent('touchmove', [moveTouch], [moveTouch]);
      (component as unknown as { onTouchMove(e: TouchEvent): void }).onTouchMove(moveEvent);

      const lastEvent = emittedEvents[emittedEvents.length - 1];
      expect(lastEvent).toBeDefined();
      expect(lastEvent.active).toBe(true);
      expect(lastEvent.type).toBe('movement');
    });

    it('should emit zero vector with active=false on touchend', () => {
      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      const endEvent = makeTouchEvent('touchend', [], [touch]);
      (component as unknown as { onTouchEnd(e: TouchEvent): void }).onTouchEnd(endEvent);

      const lastEvent = emittedEvents[emittedEvents.length - 1];
      expect(lastEvent.vector.x).toBe(0);
      expect(lastEvent.vector.y).toBe(0);
      expect(lastEvent.active).toBe(false);
    });

    it('should reset isActive and stickTransform on touchend', () => {
      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      const endEvent = makeTouchEvent('touchend', [], [touch]);
      (component as unknown as { onTouchEnd(e: TouchEvent): void }).onTouchEnd(endEvent);

      expect(component.isActive).toBe(false);
      expect(component.stickTransform).toBe('translate(-50%, -50%)');
    });

    // Regression: the iOS "stuck rotate mode" bug. When the active touch ends but is
    // absent from changedTouches (touchcancel / rapid multitouch), the stick must still
    // release — otherwise activeTouchId stays set, new grips are ignored, and the ship
    // is locked in slow-rotate.
    it('should release when the tracked touch is gone from both changedTouches and touches', () => {
      const touch = makeTouch(7, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);
      expect((component as unknown as { activeTouchId: number | null }).activeTouchId).toBe(7);

      // touchcancel with empty changedTouches AND empty active touches (our touch vanished)
      const cancelEvent = makeTouchEvent('touchcancel', [], []);
      (component as unknown as { onTouchEnd(e: TouchEvent): void }).onTouchEnd(cancelEvent);

      const lastEvent = emittedEvents[emittedEvents.length - 1];
      expect(lastEvent.active).toBe(false);
      expect(component.isActive).toBe(false);
      expect((component as unknown as { activeTouchId: number | null }).activeTouchId).toBeNull();
    });

    // The inverse guard: if a DIFFERENT finger lifts while ours is still pressed, we must
    // keep tracking our touch (no spurious release that would drop aim mid-gesture).
    it('should keep tracking when a different touch ends but ours is still active', () => {
      const ours = makeTouch(7, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [ours], [ours]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      const otherFinger = makeTouch(9, 300, 300);
      // touchend for finger 9; finger 7 (ours) remains in the active touches list
      const endEvent = makeTouchEvent('touchend', [ours], [otherFinger]);
      (component as unknown as { onTouchEnd(e: TouchEvent): void }).onTouchEnd(endEvent);

      expect((component as unknown as { activeTouchId: number | null }).activeTouchId).toBe(7);
      expect(component.isActive).toBe(true);
    });

    describe('output normalization', () => {
      it('should clamp output vector components to [-1, 1]', () => {
        const touch = makeTouch(1, 100, 400);
        const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
        (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

        // Move far outside the maxDistance — should be clamped
        const farTouch = makeTouch(1, 500, 800);
        const moveEvent = makeTouchEvent('touchmove', [farTouch], [farTouch]);
        (component as unknown as { onTouchMove(e: TouchEvent): void }).onTouchMove(moveEvent);

        const lastEvent = emittedEvents[emittedEvents.length - 1];
        expect(lastEvent.vector.x).toBeLessThanOrEqual(1);
        expect(lastEvent.vector.x).toBeGreaterThanOrEqual(-1);
        expect(lastEvent.vector.y).toBeLessThanOrEqual(1);
        expect(lastEvent.vector.y).toBeGreaterThanOrEqual(-1);
      });

      it('should emit center position (0,0) relative vector for touch exactly at center', () => {
        // Center of the mocked rect: left=40, width=120 → centerX=100; top=340, height=120 → centerY=400
        const touch = makeTouch(1, 100, 400);
        const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
        (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

        const moveEvent = makeTouchEvent('touchmove', [touch], [touch]);
        (component as unknown as { onTouchMove(e: TouchEvent): void }).onTouchMove(moveEvent);

        const lastEvent = emittedEvents[emittedEvents.length - 1];
        expect(lastEvent.vector.x).toBe(0);
        expect(lastEvent.vector.y).toBe(0);
      });
    });

    it('should ignore a second touch while one is already active', () => {
      const touch1 = makeTouch(1, 100, 400);
      const touch2 = makeTouch(2, 120, 420);

      const startEvent1 = makeTouchEvent('touchstart', [touch1], [touch1]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent1);

      const countBefore = emittedEvents.length;

      const startEvent2 = makeTouchEvent('touchstart', [touch1, touch2], [touch2]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent2);

      // No new emit from the second touch start
      expect(emittedEvents.length).toBe(countBefore);
    });
  });

  describe('ngOnDestroy cleanup', () => {
    it('should unsubscribe from device info on destroy', () => {
      fixture.detectChanges();
      fixture.destroy();
      // Emitting after destroy should not throw
      expect(() => deviceInfo$.next({ ...mobileDeviceInfo })).not.toThrow();
    });

    it('should emit zero vector when destroyed mid-touch', () => {
      fixture.detectChanges();

      const emittedEvents: JoystickEvent[] = [];
      component.joystickChange.subscribe((e) => emittedEvents.push(e));

      spyOn(component.joystickBase.nativeElement, 'getBoundingClientRect').and.returnValue({
        left: 40,
        top: 340,
        width: 120,
        height: 120,
        right: 160,
        bottom: 460,
      } as DOMRect);

      // Simulate active touch
      const touch = makeTouch(1, 110, 410);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      expect(component.isActive).toBe(true);

      fixture.destroy();

      const lastEvent = emittedEvents[emittedEvents.length - 1];
      expect(lastEvent).toBeDefined();
      expect(lastEvent.vector.x).toBe(0);
      expect(lastEvent.vector.y).toBe(0);
      expect(lastEvent.active).toBe(false);
    });

    it('should not emit zero vector on destroy when no active touch', () => {
      fixture.detectChanges();

      const emittedEvents: JoystickEvent[] = [];
      component.joystickChange.subscribe((e) => emittedEvents.push(e));

      expect(component.isActive).toBe(false);
      fixture.destroy();

      expect(emittedEvents.length).toBe(0);
    });
  });

  describe('inputs', () => {
    it('should default type to "movement"', () => {
      fixture.detectChanges();
      expect(component.type).toBe('movement');
    });

    it('should default position to "left"', () => {
      fixture.detectChanges();
      expect(component.position).toBe('left');
    });

    it('should default sensitivity to 1.0', () => {
      fixture.detectChanges();
      expect(component.sensitivity).toBe(1.0);
    });

    it('should accept "aim" type input', () => {
      component.type = 'aim';
      fixture.detectChanges();
      expect(component.type).toBe('aim');
    });
  });

  // ── stickPress — aim-joystick burst gesture ───────────────────────────────
  // Hold still within the dead zone for 250ms → emits { pressed: true } (charge starts).
  // Drag beyond dead zone before the timer fires → no stickPress emit (normal aim).
  // Release while charging → emits { pressed: false } (burst fires).

  describe('stickPress (aim joystick)', () => {
    beforeEach(() => {
      component.type = 'aim';
      fixture.detectChanges();

      spyOn(component.joystickBase.nativeElement, 'getBoundingClientRect').and.returnValue({
        left: 40,
        top: 340,
        width: 120,
        height: 120,
        right: 160,
        bottom: 460,
      } as DOMRect);
    });

    it('should emit stickPress { pressed: true } after holding still for 250ms within dead zone', (done) => {
      const stickEvents: { pressed: boolean }[] = [];
      component.stickPress.subscribe((e) => stickEvents.push(e));

      // Touch at center — zero displacement, well within dead zone.
      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      // Timer fires after 250ms
      setTimeout(() => {
        expect(stickEvents.length).toBe(1);
        expect(stickEvents[0]).toEqual({ pressed: true });
        expect(component.isCharging).toBe(true);
        done();
      }, 300);
    });

    it('should NOT emit stickPress when the touch drags beyond the dead zone before the timer fires', (done) => {
      const stickEvents: { pressed: boolean }[] = [];
      component.stickPress.subscribe((e) => stickEvents.push(e));

      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      // Immediately drag far past dead zone — should cancel the timer.
      const farTouch = makeTouch(1, 200, 400);
      const moveEvent = makeTouchEvent('touchmove', [farTouch], [farTouch]);
      (component as unknown as { onTouchMove(e: TouchEvent): void }).onTouchMove(moveEvent);

      setTimeout(() => {
        expect(stickEvents.length).toBe(0);
        expect(component.isCharging).toBe(false);
        done();
      }, 300);
    });

    it('should emit stickPress { pressed: false } on touchend when charging', (done) => {
      const stickEvents: { pressed: boolean }[] = [];
      component.stickPress.subscribe((e) => stickEvents.push(e));

      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      // Wait for charge to begin, then release.
      setTimeout(() => {
        expect(stickEvents.length).toBe(1); // pressed: true already emitted

        const endEvent = makeTouchEvent('touchend', [], [touch]);
        (component as unknown as { onTouchEnd(e: TouchEvent): void }).onTouchEnd(endEvent);

        expect(stickEvents.length).toBe(2);
        expect(stickEvents[1]).toEqual({ pressed: false });
        expect(component.isCharging).toBe(false);
        done();
      }, 300);
    });

    it('should NOT emit stickPress for a movement joystick (type=movement)', (done) => {
      component.type = 'movement';
      const stickEvents: { pressed: boolean }[] = [];
      component.stickPress.subscribe((e) => stickEvents.push(e));

      const touch = makeTouch(1, 100, 400);
      const startEvent = makeTouchEvent('touchstart', [touch], [touch]);
      (component as unknown as { onTouchStart(e: TouchEvent): void }).onTouchStart(startEvent);

      setTimeout(() => {
        expect(stickEvents.length).toBe(0);
        done();
      }, 300);
    });
  });
});
