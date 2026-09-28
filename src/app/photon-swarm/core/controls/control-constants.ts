/**
 * Centralized control constants for the Photon Swarm game
 * This eliminates duplication across intro-screen, player.service, debug-console, game-controls, etc.
 */

export const CONTROL_CONSTANTS = {
  // Movement keys (both WASD and Arrow keys)
  MOVEMENT_KEYS: ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'] as const,

  // Dash key (Space only)
  DASH_KEY: ' ' as const,

  // Combat modifier (Shift) — beam mode: toggle auto-beam | shooting mode: toggle Focus Fire
  // Legacy name "FLIGHT_MODE" kept for backward compat with key-binding serialization
  FLIGHT_MODE_KEY: 'shift' as const,

  // Parry key (E) - reflect enemy projectiles with timing
  PARRY_KEY: 'e' as const,

  // Interface keys
  PAUSE_KEY: 'escape',
  MAP_KEY: 'm',

  // Mouse buttons
  TARGET_BUTTON: 0, // Left click
  DISCHARGE_BUTTON: 2, // Right click

  // Key display names for UI
  KEY_DISPLAY_NAMES: {
    MOVEMENT: 'W/A/S/D',
    TARGET: 'L-CLICK',
    DISCHARGE: 'R-CLICK',
    DASH: 'SPACE',
    FLIGHT_MODE: 'SHIFT',
    PARRY: 'E',
    MAP: 'M',
    PAUSE: 'ESC',
  } as const,

  // Action names for consistency
  ACTION_NAMES: {
    MOVEMENT: 'Movement',
    TARGET: 'Target',
    DISCHARGE: 'Discharge',
    DASH: 'Dash',
    FLIGHT_MODE: 'Modifier',
    PARRY: 'Parry',
    MAP: 'Open Map',
    PAUSE: 'Pause',
  } as const,
} as const;

// Type-safe helper functions
export const ControlUtils = {
  isMovementKey: (key: string): boolean => {
    return (CONTROL_CONSTANTS.MOVEMENT_KEYS as readonly string[]).includes(key.toLowerCase());
  },

  isDashKey: (key: string): boolean => {
    return key.toLowerCase() === CONTROL_CONSTANTS.DASH_KEY;
  },

  isFlightModeKey: (key: string): boolean => {
    return key.toLowerCase() === CONTROL_CONSTANTS.FLIGHT_MODE_KEY;
  },

  isParryKey: (key: string): boolean => {
    return key.toLowerCase() === CONTROL_CONSTANTS.PARRY_KEY;
  },

  isPauseKey: (key: string): boolean => {
    return key.toLowerCase() === CONTROL_CONSTANTS.PAUSE_KEY;
  },

  isMapKey: (key: string): boolean => {
    return key.toLowerCase() === CONTROL_CONSTANTS.MAP_KEY;
  },

  normalizeKey: (key: string): string => {
    return key.toLowerCase();
  },
};

// Export types for type safety
export type MovementKey = (typeof CONTROL_CONSTANTS.MOVEMENT_KEYS)[number];
export type DashKey = typeof CONTROL_CONSTANTS.DASH_KEY;
export type FlightModeKey = typeof CONTROL_CONSTANTS.FLIGHT_MODE_KEY;
export type KeyDisplayName = keyof typeof CONTROL_CONSTANTS.KEY_DISPLAY_NAMES;
export type ActionName = keyof typeof CONTROL_CONSTANTS.ACTION_NAMES;
