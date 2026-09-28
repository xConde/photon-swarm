import { isCoarseTouchDevice } from './touch-device.util';

describe('isCoarseTouchDevice', () => {
  it('returns a boolean', () => {
    const result = isCoarseTouchDevice();
    expect(typeof result).toBe('boolean');
  });

  it('returns false in headless-Chrome test environment (no touch support, fine pointer)', () => {
    // ChromeHeadless has no touch capability and a fine primary pointer,
    // so isCoarseTouchDevice() must return false.
    expect(isCoarseTouchDevice()).toBe(false);
  });

  it('returns false when touch is present but pointer is fine (touchscreen laptop)', () => {
    const originalMatchMedia = window.matchMedia;
    const originalMaxTouchPoints = navigator.maxTouchPoints;

    // Simulate touchscreen laptop: has touch but fine primary pointer
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 5,
    });
    window.matchMedia = (query: string) => {
      if (query === '(pointer: coarse)') {
        return { matches: false } as MediaQueryList;
      }
      return originalMatchMedia(query);
    };

    expect(isCoarseTouchDevice()).toBe(false);

    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => originalMaxTouchPoints,
    });
    window.matchMedia = originalMatchMedia;
  });

  it('returns true when touch is present AND pointer is coarse (mobile phone)', () => {
    const originalMatchMedia = window.matchMedia;
    const originalMaxTouchPoints = navigator.maxTouchPoints;

    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 5,
    });
    window.matchMedia = (query: string) => {
      if (query === '(pointer: coarse)') {
        return { matches: true } as MediaQueryList;
      }
      return originalMatchMedia(query);
    };

    expect(isCoarseTouchDevice()).toBe(true);

    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => originalMaxTouchPoints,
    });
    window.matchMedia = originalMatchMedia;
  });
});
