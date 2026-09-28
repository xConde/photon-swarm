export interface JoystickVector {
  x: number;
  y: number;
}

export type JoystickType = 'movement' | 'aim';

export type JoystickPosition = 'left' | 'right';

export interface JoystickConfig {
  type: JoystickType;
  position: JoystickPosition;
  maxDistance?: number;
  sensitivity?: number;
}

export interface JoystickEvent {
  type: JoystickType;
  vector: JoystickVector;
  active: boolean;
}

export interface ActionButtonEvent {
  action: 'dash' | 'parry' | 'toggleShooting' | 'map' | 'pause' | 'discharge' | 'focusFire';
  pressed: boolean;
}

export const JOYSTICK_BREAKPOINTS = {
  MOBILE: 480,
  TABLET_SMALL: 768,
  TABLET: 1024,
  TABLET_LARGE: 1366,
} as const;

export const JOYSTICK_SIZES = {
  // Portrait: slightly smaller base for less occlusion; maxDistance preserved for usability
  MOBILE_PORTRAIT: { base: 100, stick: 42, maxDistance: 32 },
  MOBILE_LANDSCAPE: { base: 90, stick: 38, maxDistance: 26 },
  TABLET: { base: 130, stick: 54, maxDistance: 38 },
} as const;
