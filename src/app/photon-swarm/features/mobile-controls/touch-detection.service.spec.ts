import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { DeviceInfo, TouchDetectionService } from './touch-detection.service';
import { JOYSTICK_BREAKPOINTS } from './mobile-controls.types';

describe('TouchDetectionService', () => {
  let service: TouchDetectionService;

  /** Helper to create a fresh service instance after configuring window properties. */
  function createService(): void {
    TestBed.configureTestingModule({ providers: [TouchDetectionService] });
    service = TestBed.inject(TouchDetectionService);
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('initial device detection', () => {
    it('should create', () => {
      createService();
      expect(service).toBeTruthy();
    });

    it('should return an observable from getDeviceInfo', (done) => {
      createService();
      service.getDeviceInfo().subscribe((info) => {
        expect(info).toBeDefined();
        done();
      });
    });

    it('should return a snapshot from getDeviceInfoSnapshot', () => {
      createService();
      const snapshot = service.getDeviceInfoSnapshot();
      expect(snapshot).toBeDefined();
      expect(typeof snapshot.hasTouchSupport).toBe('boolean');
    });
  });

  describe('deviceType detection', () => {
    it('should detect mobile when screenWidth is at MOBILE breakpoint', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(JOYSTICK_BREAKPOINTS.MOBILE);
      spyOnProperty(window, 'innerHeight').and.returnValue(700);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.deviceType).toBe('mobile');
    });

    it('should detect mobile when screenWidth is below MOBILE breakpoint', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(320);
      spyOnProperty(window, 'innerHeight').and.returnValue(568);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.deviceType).toBe('mobile');
    });

    it('should detect tablet when screenWidth is between MOBILE and TABLET_LARGE', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(768);
      spyOnProperty(window, 'innerHeight').and.returnValue(1024);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.deviceType).toBe('tablet');
    });

    it('should detect desktop when screenWidth is above TABLET_LARGE breakpoint', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(JOYSTICK_BREAKPOINTS.TABLET_LARGE + 1);
      spyOnProperty(window, 'innerHeight').and.returnValue(900);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.deviceType).toBe('desktop');
    });
  });

  describe('orientation detection', () => {
    it('should detect portrait when height > width', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(375);
      spyOnProperty(window, 'innerHeight').and.returnValue(812);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.orientation).toBe('portrait');
    });

    it('should detect landscape when width >= height', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(812);
      spyOnProperty(window, 'innerHeight').and.returnValue(375);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.orientation).toBe('landscape');
    });
  });

  describe('showVirtualControls', () => {
    it('should be false when deviceType is desktop regardless of touch support', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(1920);
      spyOnProperty(window, 'innerHeight').and.returnValue(1080);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.showVirtualControls).toBe(false);
    });

    it('should reflect screenWidth and screenHeight in the snapshot', () => {
      spyOnProperty(window, 'innerWidth').and.returnValue(390);
      spyOnProperty(window, 'innerHeight').and.returnValue(844);
      createService();

      const info = service.getDeviceInfoSnapshot();
      expect(info.screenWidth).toBe(390);
      expect(info.screenHeight).toBe(844);
    });
  });

  describe('getShowVirtualControls', () => {
    it('should return an observable of boolean', (done) => {
      createService();
      service.getShowVirtualControls().subscribe((show) => {
        expect(typeof show).toBe('boolean');
        done();
      });
    });
  });

  describe('resize handling', () => {
    it('should debounce resize events and emit updated device info', fakeAsync(() => {
      // Use callFake with a counter so each call to innerWidth returns a different value,
      // ensuring the rebuilt DeviceInfo is distinct and passes distinctUntilChanged.
      let widthCallCount = 0;
      const widths = [375, 1440];
      spyOnProperty(window, 'innerWidth').and.callFake(() => widths[Math.min(widthCallCount++, widths.length - 1)]);
      spyOnProperty(window, 'innerHeight').and.returnValue(812);
      createService();

      const emissions: DeviceInfo[] = [];
      service.getDeviceInfo().subscribe((info) => emissions.push(info));

      const initialCount = emissions.length;

      // Multiple rapid resize events before debounce window
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));

      // Debounce has not fired yet
      expect(emissions.length).toBe(initialCount);

      // Settle the debounce
      tick(200);

      expect(emissions.length).toBeGreaterThan(initialCount);
    }));

    it('should handle orientationchange event', fakeAsync(() => {
      // Start portrait, simulate rotate to landscape so info changes
      let callCount = 0;
      const widths = [375, 812];
      const heights = [812, 375];
      spyOnProperty(window, 'innerWidth').and.callFake(() => widths[Math.min(callCount, widths.length - 1)]);
      spyOnProperty(window, 'innerHeight').and.callFake(() => {
        const h = heights[Math.min(callCount, heights.length - 1)];
        callCount++;
        return h;
      });
      createService();

      const emissions: DeviceInfo[] = [];
      service.getDeviceInfo().subscribe((info) => emissions.push(info));
      const initialCount = emissions.length;

      window.dispatchEvent(new Event('orientationchange'));
      tick(200);

      expect(emissions.length).toBeGreaterThan(initialCount);
    }));
  });

  describe('distinctUntilChanged', () => {
    it('should not emit duplicate device info when nothing changes', fakeAsync(() => {
      // Keep dimensions stable
      spyOnProperty(window, 'innerWidth').and.returnValue(375);
      spyOnProperty(window, 'innerHeight').and.returnValue(812);
      createService();

      const emissions: DeviceInfo[] = [];
      service.getDeviceInfo().subscribe((info) => emissions.push(info));
      const initialCount = emissions.length;

      // Fire resize but dimensions are unchanged — should filter duplicate
      window.dispatchEvent(new Event('resize'));
      tick(100);

      // The emission count should not have increased (same info)
      expect(emissions.length).toBe(initialCount);
    }));
  });

  describe('ngOnDestroy', () => {
    it('should unsubscribe from resize events without throwing', () => {
      createService();
      expect(() => service.ngOnDestroy()).not.toThrow();
    });

    it('should not emit after ngOnDestroy', fakeAsync(() => {
      createService();
      service.ngOnDestroy();

      const emissions: DeviceInfo[] = [];
      service.getDeviceInfo().subscribe((info) => emissions.push(info));
      const countAfterDestroy = emissions.length;

      window.dispatchEvent(new Event('resize'));
      tick(100);

      expect(emissions.length).toBe(countAfterDestroy);
    }));
  });
});
