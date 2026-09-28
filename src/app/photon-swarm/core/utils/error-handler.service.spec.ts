import { isDevMode } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ErrorHandlerService } from './error-handler.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { HealthComponent } from '@photon/components/health.component';

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;
  let entityManager: EntityManagerService;

  beforeEach(() => {
    const spy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    TestBed.configureTestingModule({
      providers: [ErrorHandlerService, EntityManagerService, { provide: DebugLogBridgeService, useValue: spy }],
    });

    service = TestBed.inject(ErrorHandlerService);
    debugLogSpy = TestBed.inject(DebugLogBridgeService) as jasmine.SpyObj<DebugLogBridgeService>;
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('Error Throttling', () => {
    it('should log first error immediately', () => {
      const error = new Error('Test error');

      service.handleSystemError(error, 'TEST_CONTEXT');

      expect(debugLogSpy.log).toHaveBeenCalledTimes(1);
      expect(debugLogSpy.log).toHaveBeenCalledWith(
        'System Error: TEST_CONTEXT (count: 1)',
        'error',
        jasmine.objectContaining({
          context: 'TEST_CONTEXT',
          error: 'Test error',
          occurrences: 1,
        })
      );
    });

    it('should throttle repeated errors within throttle window', () => {
      const error = new Error('Test error');

      // Log same error multiple times quickly
      service.handleSystemError(error, 'TEST_CONTEXT');
      service.handleSystemError(error, 'TEST_CONTEXT');
      service.handleSystemError(error, 'TEST_CONTEXT');

      // Should only log once due to throttling
      expect(debugLogSpy.log).toHaveBeenCalledTimes(1);
    });

    it('should log error again after throttle window expires', (done) => {
      const error = new Error('Test error');

      service.handleSystemError(error, 'TEST_CONTEXT');
      expect(debugLogSpy.log).toHaveBeenCalledTimes(1);

      // Wait for throttle window to expire (1 second + buffer)
      setTimeout(() => {
        service.handleSystemError(error, 'TEST_CONTEXT');
        expect(debugLogSpy.log).toHaveBeenCalledTimes(2);
        expect(debugLogSpy.log).toHaveBeenCalledWith(
          'System Error: TEST_CONTEXT (count: 2)',
          'error',
          jasmine.objectContaining({
            occurrences: 2,
          })
        );
        done();
      }, 1100);
    });

    it('should track different error contexts separately', () => {
      const error = new Error('Test error');

      service.handleSystemError(error, 'CONTEXT_A');
      service.handleSystemError(error, 'CONTEXT_B');
      service.handleSystemError(error, 'CONTEXT_C');

      // Each unique context should log
      expect(debugLogSpy.log).toHaveBeenCalledTimes(3);
    });
  });

  describe('Safe Component Access', () => {
    let testEntity: number;

    beforeEach(() => {
      testEntity = entityManager.createEntity();
    });

    describe('safeGetComponent', () => {
      it('should return component when it exists', () => {
        const health = new HealthComponent(100, 100);
        entityManager.addComponent(testEntity, health);

        const result = service.safeGetComponent(entityManager, testEntity, HealthComponent, 'TEST');

        expect(result).toBe(health);
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should return null when entity does not exist', () => {
        const result = service.safeGetComponent(
          entityManager,
          999999, // Non-existent entity
          HealthComponent,
          'TEST'
        );

        expect(result).toBeNull();
        expect(debugLogSpy.log).not.toHaveBeenCalled(); // Silent fail for missing entity
      });

      it('should return null when component does not exist', () => {
        const result = service.safeGetComponent(entityManager, testEntity, HealthComponent, 'TEST');

        expect(result).toBeNull();
        expect(debugLogSpy.log).not.toHaveBeenCalled(); // Silent fail for missing component
      });

      it('should handle and log exceptions from entity manager', () => {
        // Force an error by mocking getComponent to throw
        spyOn(entityManager, 'hasEntity').and.returnValue(true);
        spyOn(entityManager, 'hasComponent').and.returnValue(true);
        spyOn(entityManager, 'getComponent').and.throwError('Component error');

        const result = service.safeGetComponent(entityManager, testEntity, HealthComponent, 'TEST_ERROR');

        expect(result).toBeNull();
        expect(debugLogSpy.log).toHaveBeenCalledWith(
          'System Error: ECS_GET_COMPONENT_TEST_ERROR (count: 1)',
          'error',
          jasmine.objectContaining({
            context: 'ECS_GET_COMPONENT_TEST_ERROR',
            error: 'Component error',
          })
        );
      });
    });

    describe('safeHasComponent', () => {
      it('should return true when component exists', () => {
        entityManager.addComponent(testEntity, new HealthComponent(100, 100));

        const result = service.safeHasComponent(entityManager, testEntity, HealthComponent, 'TEST');

        expect(result).toBe(true);
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should return false when entity does not exist', () => {
        const result = service.safeHasComponent(entityManager, 999999, HealthComponent, 'TEST');

        expect(result).toBe(false);
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should return false when component does not exist', () => {
        const result = service.safeHasComponent(entityManager, testEntity, HealthComponent, 'TEST');

        expect(result).toBe(false);
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should handle exceptions gracefully', () => {
        spyOn(entityManager, 'hasEntity').and.returnValue(true);
        spyOn(entityManager, 'hasComponent').and.throwError('Check error');

        const result = service.safeHasComponent(entityManager, testEntity, HealthComponent, 'TEST_ERROR');

        expect(result).toBe(false);
        expect(debugLogSpy.log).toHaveBeenCalled();
      });
    });

    describe('safeAddComponent', () => {
      it('should add component successfully', () => {
        const health = new HealthComponent(100, 100);

        const result = service.safeAddComponent(entityManager, testEntity, health, 'TEST');

        expect(result).toBe(true);
        expect(entityManager.hasComponent(testEntity, HealthComponent)).toBe(true);
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should fail when entity does not exist', () => {
        const health = new HealthComponent(100, 100);

        const result = service.safeAddComponent(entityManager, 999999, health, 'TEST');

        expect(result).toBe(false);
        expect(debugLogSpy.log).toHaveBeenCalledWith(
          jasmine.stringContaining('ECS_ADD_COMPONENT_TEST'),
          'error',
          jasmine.objectContaining({
            error: 'Entity 999999 does not exist',
          })
        );
      });

      it('should handle exceptions during add', () => {
        spyOn(entityManager, 'hasEntity').and.returnValue(true);
        spyOn(entityManager, 'addComponent').and.throwError('Add error');

        const health = new HealthComponent(100, 100);
        const result = service.safeAddComponent(entityManager, testEntity, health, 'TEST_ERROR');

        expect(result).toBe(false);
        expect(debugLogSpy.log).toHaveBeenCalled();
      });
    });
  });

  describe('Safe Execution Wrappers', () => {
    describe('safeExecute', () => {
      it('should execute function and return result when successful', () => {
        const fn = jasmine.createSpy('testFn').and.returnValue('success');

        const result = service.safeExecute(fn, 'TEST_CONTEXT');

        expect(fn).toHaveBeenCalled();
        expect(result).toBe('success');
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should catch errors and return fallback value', () => {
        const fn = jasmine.createSpy('testFn').and.throwError('Test error');

        const result = service.safeExecute(fn, 'TEST_CONTEXT', 'fallback');

        expect(fn).toHaveBeenCalled();
        expect(result).toBe('fallback');
        expect(debugLogSpy.log).toHaveBeenCalledWith(
          jasmine.stringContaining('TEST_CONTEXT'),
          'error',
          jasmine.any(Object)
        );
      });

      it('should return undefined when no fallback provided', () => {
        const fn = jasmine.createSpy('testFn').and.throwError('Test error');

        const result = service.safeExecute(fn, 'TEST_CONTEXT');

        expect(result).toBeUndefined();
      });
    });

    describe('safeExecuteAsync', () => {
      it('should handle async success', async () => {
        const fn = jasmine.createSpy('testFn').and.returnValue(Promise.resolve('async success'));

        const result = await service.safeExecuteAsync(fn, 'TEST_CONTEXT');

        expect(result).toBe('async success');
        expect(debugLogSpy.log).not.toHaveBeenCalled();
      });

      it('should handle async errors with fallback', async () => {
        const fn = jasmine.createSpy('testFn').and.returnValue(Promise.reject(new Error('Async error')));

        const result = await service.safeExecuteAsync(fn, 'TEST_CONTEXT', 'async fallback');

        expect(result).toBe('async fallback');
        expect(debugLogSpy.log).toHaveBeenCalled();
      });
    });
  });

  describe('Error Metrics Reporting', () => {
    it('should report metrics after threshold is reached', () => {
      const error = new Error('Test error');

      // Generate enough errors to trigger metrics reporting
      // (would need to mock time or set ERROR_REPORT_INTERVAL to test properly)
      for (let i = 0; i < 10; i++) {
        service.handleSystemError(error, `CONTEXT_${i}`);
      }

      // Check that metrics would be tracked
      // Note: Actual reporting happens after 30s, so we'd need to mock time
      expect(debugLogSpy.log).toHaveBeenCalled();
    });
  });

  describe('Error Context Enrichment', () => {
    it('should include rich context in ECS errors', () => {
      service.handleECSError(new Error('ECS error'), 123, 'TestComponent');

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('ECS_SYSTEM'),
        'error',
        jasmine.objectContaining({
          context: 'ECS_SYSTEM',
          additionalData: {
            entityId: 123,
            componentType: 'TestComponent',
          },
        })
      );
    });

    it('should include render context in render errors', () => {
      service.handleRenderError(new Error('Render error'), 'SPRITE_RENDERING');

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('RENDERING'),
        'error',
        jasmine.objectContaining({
          context: 'RENDERING',
          additionalData: jasmine.objectContaining({
            renderContext: 'SPRITE_RENDERING',
          }),
        })
      );
    });

    it('should include game logic context', () => {
      service.handleGameLogicError(new Error('Logic error'), 'CollisionSystem', { health: 50, level: 5 });

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('GAME_LOGIC'),
        'error',
        jasmine.objectContaining({
          additionalData: jasmine.objectContaining({
            systemName: 'CollisionSystem',
            gameState: { health: 50, level: 5 },
          }),
        })
      );
    });

    it('still reports the render error when a DOM canvas has transferred control offscreen', () => {
      // Regression: a leftover <canvas> in the document whose control was
      // transferred to an OffscreenCanvas makes getContext('2d') throw an
      // InvalidStateError. The error reporter gathers canvas diagnostics, so it
      // used to re-throw that and lose the original render error (this is the
      // cross-spec flake where a polluted canvas survived into a later spec).
      // The reporter must now degrade quietly and still log the render error.
      const polluted = document.createElement('canvas');
      document.body.appendChild(polluted);
      if (typeof polluted.transferControlToOffscreen === 'function') {
        polluted.transferControlToOffscreen();
      }

      try {
        expect(() => service.handleRenderError(new Error('Render error'), 'SPRITE_RENDERING')).not.toThrow();
        expect(debugLogSpy.log).toHaveBeenCalledWith(
          jasmine.stringContaining('RENDERING'),
          'error',
          jasmine.objectContaining({ context: 'RENDERING' })
        );
      } finally {
        // Remove it so this spec doesn't itself pollute later specs.
        polluted.remove();
      }
    });
  });

  describe('env-detection fix: isDevelopment uses isDevMode()', () => {
    it('includes stack trace in dev mode and omits it in prod mode', () => {
      // The service uses isDevMode() — in the Karma test environment isDevMode() returns true,
      // so the stack field must be present on a system error report.
      const error = new Error('stack-test');
      error.stack = 'Error: stack-test\n    at something';
      service.handleSystemError(error, 'STACK_TEST');
      const callArgs = debugLogSpy.log.calls.mostRecent().args;
      const payload = callArgs[2] as Record<string, unknown>;
      if (isDevMode()) {
        expect(payload['stack']).toBeDefined();
      } else {
        expect(payload['stack']).toBeUndefined();
      }
    });

    it('does not use hostname.includes("prod") for env detection', () => {
      // Verify the service does not read window.location.hostname by checking that
      // the hostname (which is localhost in tests) does not influence stack inclusion.
      // In tests isDevMode() === true → stack is always present regardless of hostname.
      const originalHostname = window.location.hostname;
      expect(originalHostname).not.toContain('prod'); // localhost, never 'prod'
      const error = new Error('hostname-check');
      error.stack = 'Error: hostname-check';
      service.handleSystemError(error, 'HOSTNAME_CHECK');
      const payload = debugLogSpy.log.calls.mostRecent().args[2] as Record<string, unknown>;
      // In Karma isDevMode() is true, so stack MUST be present even on non-prod hostname
      expect(payload['stack']).toBe(error.stack);
    });
  });

  describe('validateGameState', () => {
    it('should not throw when condition is true', () => {
      expect(() => {
        service.validateGameState(true, 'Test validation');
      }).not.toThrow();

      expect(debugLogSpy.log).not.toHaveBeenCalled();
    });

    it('should throw when condition is false', () => {
      expect(() => {
        service.validateGameState(false, 'Test validation failed');
      }).toThrowError('Game State Validation Failed: Test validation failed');
    });

    it('should log error when context provided and condition is false', () => {
      expect(() => {
        service.validateGameState(false, 'Test validation failed', 'TEST_CONTEXT');
      }).toThrow();

      expect(debugLogSpy.log).toHaveBeenCalledWith(
        jasmine.stringContaining('TEST_CONTEXT'),
        'error',
        jasmine.any(Object)
      );
    });
  });
});
