import { CONTROL_CONSTANTS, ControlUtils } from './control-constants';

describe('CONTROL_CONSTANTS', () => {
  describe('MOVEMENT_KEYS', () => {
    it('should contain WASD keys', () => {
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('w');
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('a');
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('s');
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('d');
    });

    it('should contain arrow keys', () => {
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('arrowup');
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('arrowdown');
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('arrowleft');
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS).toContain('arrowright');
    });

    it('should have 8 movement keys total', () => {
      expect(CONTROL_CONSTANTS.MOVEMENT_KEYS.length).toBe(8);
    });
  });

  describe('DASH_KEY', () => {
    it('should be the space character', () => {
      expect(CONTROL_CONSTANTS.DASH_KEY).toBe(' ');
    });
  });

  describe('FLIGHT_MODE_KEY', () => {
    it('should be shift (lowercase)', () => {
      expect(CONTROL_CONSTANTS.FLIGHT_MODE_KEY).toBe('shift');
    });
  });

  describe('PARRY_KEY', () => {
    it('should be "e"', () => {
      expect(CONTROL_CONSTANTS.PARRY_KEY).toBe('e');
    });
  });

  describe('PAUSE_KEY', () => {
    it('should be "escape"', () => {
      expect(CONTROL_CONSTANTS.PAUSE_KEY).toBe('escape');
    });
  });

  describe('MAP_KEY', () => {
    it('should be "m"', () => {
      expect(CONTROL_CONSTANTS.MAP_KEY).toBe('m');
    });
  });

  describe('mouse buttons', () => {
    it('TARGET_BUTTON should be 0 (left click)', () => {
      expect(CONTROL_CONSTANTS.TARGET_BUTTON).toBe(0);
    });

    it('DISCHARGE_BUTTON should be 2 (right click)', () => {
      expect(CONTROL_CONSTANTS.DISCHARGE_BUTTON).toBe(2);
    });
  });

  describe('KEY_DISPLAY_NAMES', () => {
    it('should have reasonable display strings', () => {
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.MOVEMENT).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.TARGET).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.DISCHARGE).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.DASH).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.FLIGHT_MODE).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PARRY).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.MAP).toBeTruthy();
      expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE).toBeTruthy();
    });
  });

  describe('ACTION_NAMES', () => {
    it('should have non-empty action name strings', () => {
      Object.values(CONTROL_CONSTANTS.ACTION_NAMES).forEach((name) => {
        expect(name.trim().length).toBeGreaterThan(0);
      });
    });
  });
});

describe('ControlUtils', () => {
  describe('isMovementKey()', () => {
    it('should return true for WASD keys (any case)', () => {
      expect(ControlUtils.isMovementKey('W')).toBeTrue();
      expect(ControlUtils.isMovementKey('a')).toBeTrue();
      expect(ControlUtils.isMovementKey('S')).toBeTrue();
      expect(ControlUtils.isMovementKey('D')).toBeTrue();
    });

    it('should return true for arrow keys', () => {
      expect(ControlUtils.isMovementKey('ArrowUp')).toBeTrue();
      expect(ControlUtils.isMovementKey('ArrowDown')).toBeTrue();
      expect(ControlUtils.isMovementKey('ArrowLeft')).toBeTrue();
      expect(ControlUtils.isMovementKey('ArrowRight')).toBeTrue();
    });

    it('should return false for non-movement keys', () => {
      expect(ControlUtils.isMovementKey('e')).toBeFalse();
      expect(ControlUtils.isMovementKey('m')).toBeFalse();
      expect(ControlUtils.isMovementKey(' ')).toBeFalse();
      expect(ControlUtils.isMovementKey('escape')).toBeFalse();
    });
  });

  describe('isDashKey()', () => {
    it('should return true for space', () => {
      expect(ControlUtils.isDashKey(' ')).toBeTrue();
    });

    it('should return false for non-dash keys', () => {
      expect(ControlUtils.isDashKey('w')).toBeFalse();
      expect(ControlUtils.isDashKey('shift')).toBeFalse();
    });
  });

  describe('isFlightModeKey()', () => {
    it('should return true for Shift (any case)', () => {
      expect(ControlUtils.isFlightModeKey('Shift')).toBeTrue();
      expect(ControlUtils.isFlightModeKey('shift')).toBeTrue();
      expect(ControlUtils.isFlightModeKey('SHIFT')).toBeTrue();
    });

    it('should return false for other keys', () => {
      expect(ControlUtils.isFlightModeKey('e')).toBeFalse();
      expect(ControlUtils.isFlightModeKey('w')).toBeFalse();
    });
  });

  describe('isParryKey()', () => {
    it('should return true for "e" (any case)', () => {
      expect(ControlUtils.isParryKey('e')).toBeTrue();
      expect(ControlUtils.isParryKey('E')).toBeTrue();
    });

    it('should return false for other keys', () => {
      expect(ControlUtils.isParryKey('w')).toBeFalse();
    });
  });

  describe('isPauseKey()', () => {
    it('should return true for "escape" (any case)', () => {
      expect(ControlUtils.isPauseKey('Escape')).toBeTrue();
      expect(ControlUtils.isPauseKey('escape')).toBeTrue();
    });

    it('should return false for other keys', () => {
      expect(ControlUtils.isPauseKey('m')).toBeFalse();
    });
  });

  describe('isMapKey()', () => {
    it('should return true for "m" (any case)', () => {
      expect(ControlUtils.isMapKey('m')).toBeTrue();
      expect(ControlUtils.isMapKey('M')).toBeTrue();
    });

    it('should return false for other keys', () => {
      expect(ControlUtils.isMapKey('escape')).toBeFalse();
    });
  });

  describe('normalizeKey()', () => {
    it('should lowercase the input', () => {
      expect(ControlUtils.normalizeKey('ArrowUp')).toBe('arrowup');
      expect(ControlUtils.normalizeKey('SHIFT')).toBe('shift');
      expect(ControlUtils.normalizeKey('W')).toBe('w');
    });
  });
});
