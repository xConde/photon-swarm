import { TestBed } from '@angular/core/testing';
import { BindableAction, KeyBindingService, KeyBindingsMap } from './key-binding.service';
import { StorageService } from '../../services/storage.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

describe('KeyBindingService', () => {
  let service: KeyBindingService;
  let storageSpy: jasmine.SpyObj<StorageService>;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;

  const DEFAULT_BINDINGS: KeyBindingsMap = {
    moveUp: 'w',
    moveDown: 's',
    moveLeft: 'a',
    moveRight: 'd',
    dash: ' ',
    parry: 'e',
    flightMode: 'shift',
    mapToggle: 'm',
  };

  function createService(savedValue: unknown): KeyBindingService {
    storageSpy.get.and.returnValue(savedValue as Partial<KeyBindingsMap>);
    TestBed.configureTestingModule({
      providers: [
        KeyBindingService,
        { provide: StorageService, useValue: storageSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });
    return TestBed.inject(KeyBindingService);
  }

  beforeEach(() => {
    storageSpy = jasmine.createSpyObj('StorageService', ['get', 'set', 'remove']);
    debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('loadBindings — valid key names are accepted', () => {
    it('should accept lowercase letter keys (a-z)', () => {
      const saved: Partial<KeyBindingsMap> = { moveUp: 'w', moveDown: 's', moveLeft: 'a', moveRight: 'd' };
      service = createService(saved);
      expect(service.getKey('moveUp')).toBe('w');
      expect(service.getKey('moveDown')).toBe('s');
      expect(service.getKey('moveLeft')).toBe('a');
      expect(service.getKey('moveRight')).toBe('d');
    });

    it('should accept digit keys (0-9)', () => {
      service = createService({ moveUp: '1', moveDown: '2' });
      expect(service.getKey('moveUp')).toBe('1');
      expect(service.getKey('moveDown')).toBe('2');
    });

    it('should accept space character as a valid key (spacebar)', () => {
      service = createService({ dash: ' ' });
      expect(service.getKey('dash')).toBe(' ');
    });

    it('should accept named keys in lowercase (shift, escape, enter)', () => {
      service = createService({ flightMode: 'shift', parry: 'escape', dash: 'enter' });
      expect(service.getKey('flightMode')).toBe('shift');
      expect(service.getKey('parry')).toBe('escape');
      expect(service.getKey('dash')).toBe('enter');
    });

    it('should accept arrow key named values', () => {
      service = createService({
        moveUp: 'arrowup',
        moveDown: 'arrowdown',
        moveLeft: 'arrowleft',
        moveRight: 'arrowright',
      });
      expect(service.getKey('moveUp')).toBe('arrowup');
      expect(service.getKey('moveDown')).toBe('arrowdown');
      expect(service.getKey('moveLeft')).toBe('arrowleft');
      expect(service.getKey('moveRight')).toBe('arrowright');
    });

    it('should accept function keys f1–f12', () => {
      service = createService({ dash: 'f1', parry: 'f12', mapToggle: 'f5' });
      expect(service.getKey('dash')).toBe('f1');
      expect(service.getKey('parry')).toBe('f12');
      expect(service.getKey('mapToggle')).toBe('f5');
    });

    it('should accept other named keys (backspace, delete, tab, home, end, pageup, pagedown)', () => {
      service = createService({
        moveUp: 'backspace',
        moveDown: 'delete',
        moveLeft: 'tab',
        moveRight: 'home',
        dash: 'end',
        parry: 'pageup',
        flightMode: 'pagedown',
      });
      expect(service.getKey('moveUp')).toBe('backspace');
      expect(service.getKey('moveDown')).toBe('delete');
      expect(service.getKey('moveLeft')).toBe('tab');
      expect(service.getKey('moveRight')).toBe('home');
      expect(service.getKey('dash')).toBe('end');
      expect(service.getKey('parry')).toBe('pageup');
      expect(service.getKey('flightMode')).toBe('pagedown');
    });

    it('should accept mixed-case named keys from KeyboardEvent.key (e.g. "Shift", "ArrowUp")', () => {
      // KeyboardEvent.key values may arrive in mixed case before being lowercased by setKey;
      // loadBindings should also tolerate them if they slip into storage.
      service = createService({ flightMode: 'Shift', moveUp: 'ArrowUp' });
      expect(service.getKey('flightMode')).toBe('Shift');
      expect(service.getKey('moveUp')).toBe('ArrowUp');
    });
  });

  describe('loadBindings — invalid/malicious strings fall back to defaults', () => {
    it('should reject and fall back to default for strings with script injection', () => {
      service = createService({ moveUp: '<script>alert(1)</script>' });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
    });

    it('should reject multi-character strings that are not named keys', () => {
      service = createService({ moveUp: 'ww', dash: 'spacebar' });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
      expect(service.getKey('dash')).toBe(DEFAULT_BINDINGS.dash);
    });

    it('should reject empty strings (fall back to default)', () => {
      service = createService({ moveUp: '' });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
    });

    it('should reject non-string values (numbers, booleans, objects)', () => {
      service = createService({ moveUp: 42, moveDown: true, moveLeft: { key: 'x' } });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
      expect(service.getKey('moveDown')).toBe(DEFAULT_BINDINGS.moveDown);
      expect(service.getKey('moveLeft')).toBe(DEFAULT_BINDINGS.moveLeft);
    });

    it('should reject strings with SQL injection patterns', () => {
      service = createService({ moveUp: "'; DROP TABLE bindings; --" });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
    });

    it('should reject strings with null bytes or control characters', () => {
      service = createService({ moveUp: '\x00', moveDown: '\n', moveLeft: '\t\t' });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
      expect(service.getKey('moveDown')).toBe(DEFAULT_BINDINGS.moveDown);
      expect(service.getKey('moveLeft')).toBe(DEFAULT_BINDINGS.moveLeft);
    });

    it('should reject invalid function key f0 and f13', () => {
      service = createService({ dash: 'f0', parry: 'f13' });
      expect(service.getKey('dash')).toBe(DEFAULT_BINDINGS.dash);
      expect(service.getKey('parry')).toBe(DEFAULT_BINDINGS.parry);
    });

    it('should reject long arbitrary strings', () => {
      service = createService({ moveUp: 'a'.repeat(100) });
      expect(service.getKey('moveUp')).toBe(DEFAULT_BINDINGS.moveUp);
    });
  });

  describe('loadBindings — empty or missing localStorage falls back to defaults', () => {
    it('should use all defaults when storage returns null', () => {
      service = createService(null);
      const bindings = service.getBindings();
      expect(bindings).toEqual(DEFAULT_BINDINGS);
    });

    it('should use all defaults when storage returns an empty object', () => {
      service = createService({});
      const bindings = service.getBindings();
      expect(bindings).toEqual(DEFAULT_BINDINGS);
    });

    it('should use defaults for missing actions when only some bindings are saved', () => {
      service = createService({ moveUp: 'i' });
      expect(service.getKey('moveUp')).toBe('i');
      expect(service.getKey('moveDown')).toBe(DEFAULT_BINDINGS.moveDown);
      expect(service.getKey('moveLeft')).toBe(DEFAULT_BINDINGS.moveLeft);
      expect(service.getKey('moveRight')).toBe(DEFAULT_BINDINGS.moveRight);
      expect(service.getKey('dash')).toBe(DEFAULT_BINDINGS.dash);
      expect(service.getKey('parry')).toBe(DEFAULT_BINDINGS.parry);
      expect(service.getKey('flightMode')).toBe(DEFAULT_BINDINGS.flightMode);
      expect(service.getKey('mapToggle')).toBe(DEFAULT_BINDINGS.mapToggle);
    });

    it('should use all defaults when storage returns a non-object primitive', () => {
      service = createService('corrupted-string');
      const bindings = service.getBindings();
      expect(bindings).toEqual(DEFAULT_BINDINGS);
    });

    it('should use all defaults when storage throws', () => {
      storageSpy.get.and.throwError('localStorage unavailable');
      TestBed.configureTestingModule({
        providers: [
          KeyBindingService,
          { provide: StorageService, useValue: storageSpy },
          { provide: DebugLogBridgeService, useValue: debugLogSpy },
        ],
      });
      service = TestBed.inject(KeyBindingService);
      const bindings = service.getBindings();
      expect(bindings).toEqual(DEFAULT_BINDINGS);
    });
  });

  describe('setKey', () => {
    beforeEach(() => {
      service = createService(null);
    });

    it('should update binding and persist', () => {
      const result = service.setKey('moveUp', 'i');
      expect(result.success).toBe(true);
      expect(service.getKey('moveUp')).toBe('i');
      expect(storageSpy.set).toHaveBeenCalled();
    });

    it('should return conflict when another action uses the same key', () => {
      const result = service.setKey('moveDown', 'w'); // 'w' is already moveUp
      expect(result.success).toBe(false);
      expect(result.conflictAction).toBe('moveUp' as BindableAction);
    });
  });

  describe('resetDefaults', () => {
    it('should restore all bindings to defaults', () => {
      service = createService(null);
      service.setKey('moveUp', 'i');
      service.resetDefaults();
      expect(service.getBindings()).toEqual(DEFAULT_BINDINGS);
    });
  });
});
