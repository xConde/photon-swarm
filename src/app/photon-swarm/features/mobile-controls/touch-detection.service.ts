import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, fromEvent, merge, Observable, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';

import { JOYSTICK_BREAKPOINTS } from './mobile-controls.types';

export interface DeviceInfo {
  hasTouchSupport: boolean;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  orientation: 'portrait' | 'landscape';
  screenWidth: number;
  screenHeight: number;
  showVirtualControls: boolean;
}

@Injectable({ providedIn: 'root' })
export class TouchDetectionService implements OnDestroy {
  private readonly deviceInfo$ = new BehaviorSubject<DeviceInfo>(this.buildDeviceInfo());
  private readonly resizeSubscription: Subscription;

  constructor() {
    this.resizeSubscription = merge(fromEvent(window, 'resize'), fromEvent(window, 'orientationchange'))
      .pipe(debounceTime(100))
      .subscribe(() => {
        this.deviceInfo$.next(this.buildDeviceInfo());
      });
  }

  ngOnDestroy(): void {
    this.resizeSubscription.unsubscribe();
  }

  getDeviceInfo(): Observable<DeviceInfo> {
    return this.deviceInfo$
      .asObservable()
      .pipe(
        distinctUntilChanged(
          (prev, curr) =>
            prev.hasTouchSupport === curr.hasTouchSupport &&
            prev.deviceType === curr.deviceType &&
            prev.orientation === curr.orientation &&
            prev.screenWidth === curr.screenWidth &&
            prev.screenHeight === curr.screenHeight &&
            prev.showVirtualControls === curr.showVirtualControls
        )
      );
  }

  getDeviceInfoSnapshot(): DeviceInfo {
    return this.deviceInfo$.getValue();
  }

  getShowVirtualControls(): Observable<boolean> {
    return this.getDeviceInfo().pipe(
      map((info) => info.showVirtualControls),
      distinctUntilChanged()
    );
  }

  private buildDeviceInfo(): DeviceInfo {
    const hasTouchSupport = this.detectTouchSupport();
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const orientation: 'portrait' | 'landscape' = screenHeight > screenWidth ? 'portrait' : 'landscape';
    const deviceType = this.detectDeviceType(screenWidth);
    const showVirtualControls = hasTouchSupport && deviceType !== 'desktop';

    return {
      hasTouchSupport,
      deviceType,
      orientation,
      screenWidth,
      screenHeight,
      showVirtualControls,
    };
  }

  private detectTouchSupport(): boolean {
    return (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      (window.matchMedia?.('(pointer: coarse)').matches ?? false)
    );
  }

  private detectDeviceType(screenWidth: number): 'mobile' | 'tablet' | 'desktop' {
    if (screenWidth <= JOYSTICK_BREAKPOINTS.MOBILE) {
      return 'mobile';
    }

    if (screenWidth <= JOYSTICK_BREAKPOINTS.TABLET_LARGE) {
      return 'tablet';
    }

    return 'desktop';
  }
}
