import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

describe('StorageService', () => {
  let service: StorageService;
  let debugLog: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    debugLog = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [StorageService, { provide: DebugLogBridgeService, useValue: debugLog }],
    });

    service = TestBed.inject(StorageService);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('set()', () => {
    it('should write a value to localStorage with the photon-swarm: prefix', () => {
      expect(service.set('test-key', { score: 42 })).toBeTrue();
      const raw = localStorage.getItem('photon-swarm:test-key');
      expect(raw).toBe('{"score":42}');
    });

    it('should serialise primitive values', () => {
      service.set('num', 99);
      expect(localStorage.getItem('photon-swarm:num')).toBe('99');
    });

    it('should serialise arrays', () => {
      service.set('arr', [1, 2, 3]);
      expect(localStorage.getItem('photon-swarm:arr')).toBe('[1,2,3]');
    });

    it('should log an error and not throw when localStorage throws', () => {
      spyOn(localStorage, 'setItem').and.throwError('QuotaExceededError');
      expect(service.set('key', 'value')).toBeFalse();
      expect(debugLog.log).toHaveBeenCalledWith(
        'Storage Error: Failed to store data',
        'error',
        jasmine.objectContaining({ operation: 'set' })
      );
    });

    it('should overwrite a previously stored value', () => {
      service.set('x', 1);
      service.set('x', 2);
      expect(localStorage.getItem('photon-swarm:x')).toBe('2');
    });
  });

  describe('get()', () => {
    it('should return null when key does not exist', () => {
      expect(service.get('missing')).toBeNull();
    });

    it('should retrieve a stored object', () => {
      localStorage.setItem('photon-swarm:obj', '{"a":1}');
      expect(service.get<{ a: number }>('obj')).toEqual({ a: 1 });
    });

    it('should return null and log an error when stored value is invalid JSON', () => {
      localStorage.setItem('photon-swarm:bad', 'not-json{{{');
      const result = service.get('bad');
      expect(result).toBeNull();
      expect(debugLog.log).toHaveBeenCalledWith(
        'Storage Error: Failed to retrieve data',
        'error',
        jasmine.objectContaining({ operation: 'get' })
      );
    });

    it('should not mix up keys — different keys return different values', () => {
      service.set('a', 'alpha');
      service.set('b', 'beta');
      expect(service.get('a')).toBe('alpha');
      expect(service.get('b')).toBe('beta');
    });

    it('should return null and log error when localStorage.getItem throws', () => {
      spyOn(localStorage, 'getItem').and.throwError('SecurityError');
      expect(service.get('k')).toBeNull();
      expect(debugLog.log).toHaveBeenCalledWith(
        'Storage Error: Failed to retrieve data',
        'error',
        jasmine.objectContaining({ operation: 'get' })
      );
    });
  });

  describe('remove()', () => {
    it('should delete the stored key', () => {
      service.set('del-me', true);
      service.remove('del-me');
      expect(localStorage.getItem('photon-swarm:del-me')).toBeNull();
    });

    it('should not throw when removing a key that does not exist', () => {
      expect(() => service.remove('ghost')).not.toThrow();
    });

    it('should log an error when localStorage.removeItem throws', () => {
      spyOn(localStorage, 'removeItem').and.throwError('SecurityError');
      expect(() => service.remove('k')).not.toThrow();
      expect(debugLog.log).toHaveBeenCalledWith(
        'Storage Error: Failed to remove data',
        'error',
        jasmine.objectContaining({ operation: 'remove' })
      );
    });
  });

  describe('clearAll()', () => {
    it('should remove only photon-swarm: prefixed keys', () => {
      service.set('run', 1);
      service.set('diff', 'hard');
      localStorage.setItem('other-app:key', 'untouched');

      service.clearAll();

      expect(localStorage.getItem('photon-swarm:run')).toBeNull();
      expect(localStorage.getItem('photon-swarm:diff')).toBeNull();
      expect(localStorage.getItem('other-app:key')).toBe('untouched');
    });

    it('should not throw when localStorage is empty', () => {
      expect(() => service.clearAll()).not.toThrow();
    });

    it('should log an error and not throw when Object.keys throws', () => {
      spyOn(Object, 'keys').and.throwError('SecurityError');
      expect(() => service.clearAll()).not.toThrow();
      expect(debugLog.log).toHaveBeenCalledWith(
        'Storage Error: Failed to clear data',
        'error',
        jasmine.objectContaining({ operation: 'clearAll' })
      );
    });

    it('should leave localStorage empty when only photon-swarm keys were present', () => {
      service.set('a', 1);
      service.set('b', 2);
      service.clearAll();
      expect(localStorage.length).toBe(0);
    });
  });
});
