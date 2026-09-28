import { Injectable, isDevMode } from '@angular/core';
import { CanvasInfo, ErrorContext } from '../models/game-types.model';
import { GameState } from '../models/game-state.model';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { Component, EntityManager } from '../ecs/ecs.model';

// Type for component constructors - uses unknown[] per ECS component rules
type ComponentConstructor<T extends Component> = new (...args: unknown[]) => T;

/**
 * Standardized error handling service for the game
 * Provides consistent error logging, reporting, and user notification
 */
@Injectable({
  providedIn: 'root',
})
export class ErrorHandlerService {
  private readonly isDevelopment = isDevMode();

  // Error throttling to prevent log spam
  private errorCounts = new Map<string, number>();
  private lastErrorReport = new Map<string, number>();
  private readonly ERROR_THROTTLE_MS = 1000; // Only log same error once per second
  private readonly ERROR_REPORT_INTERVAL = 30000; // Report error stats every 30 seconds
  private lastMetricsReport = 0;

  // Error metrics for monitoring
  private errorStats = {
    totalErrors: 0,
    throttledErrors: 0,
    errorsByContext: new Map<string, number>(),
    errorsByType: new Map<string, number>(),
  };

  constructor(private debugLog: DebugLogBridgeService) {
    // Initialize to current time so metrics don't report immediately on first error
    this.lastMetricsReport = Date.now();
  }

  /**
   * Check if we should log this error (throttling)
   */
  private shouldLogError(context: string): boolean {
    const now = Date.now();
    const lastReport = this.lastErrorReport.get(context) || 0;

    // Increment error count
    const count = (this.errorCounts.get(context) || 0) + 1;
    this.errorCounts.set(context, count);

    // Update stats
    this.errorStats.totalErrors++;
    this.errorStats.errorsByContext.set(context, count);

    // Check if we should log (first error or throttle period passed)
    if (count === 1 || now - lastReport > this.ERROR_THROTTLE_MS) {
      this.lastErrorReport.set(context, now);

      // Report metrics periodically
      if (now - this.lastMetricsReport > this.ERROR_REPORT_INTERVAL) {
        this.reportErrorMetrics();
        this.lastMetricsReport = now;
      }

      return true;
    }

    this.errorStats.throttledErrors++;
    return false;
  }

  /**
   * Report error metrics periodically
   */
  private reportErrorMetrics(): void {
    if (this.errorStats.totalErrors === 0) return;

    const topErrors = Array.from(this.errorStats.errorsByContext.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    this.debugLog.log('📊 Error Metrics (30s)', 'warning', {
      source: 'error_handler_metrics',
      totalErrors: this.errorStats.totalErrors,
      throttledErrors: this.errorStats.throttledErrors,
      uniqueContexts: this.errorStats.errorsByContext.size,
      topErrors: Object.fromEntries(topErrors),
      throttleRate: `${((this.errorStats.throttledErrors / this.errorStats.totalErrors) * 100).toFixed(1)}%`,
    });

    // Reset stats
    this.errorStats.totalErrors = 0;
    this.errorStats.throttledErrors = 0;
    this.errorStats.errorsByContext.clear();
    this.errorStats.errorsByType.clear();
  }

  /**
   * Handle and log game system errors
   */
  handleSystemError(error: Error, context: string, additionalData?: ErrorContext): void {
    // Check throttling
    if (!this.shouldLogError(context)) {
      return; // Skip logging if throttled
    }

    const errorReport = {
      message: error.message,
      // SECURITY: Don't include full stack trace in production
      stack: this.isDevelopment ? error.stack : undefined,
      context,
      timestamp: Date.now(),
      // SECURITY: Use pathname only to avoid capturing sensitive query params
      url: window.location.pathname,
      // SECURITY: Omit userAgent to reduce fingerprinting surface
      additionalData,
      errorCount: this.errorCounts.get(context) || 1,
    };

    // Log to debug bridge with error count
    this.debugLog.log(`System Error: ${context} (count: ${errorReport.errorCount})`, 'error', {
      source: 'error_handler',
      context,
      error: error.message,
      stack: this.isDevelopment ? error.stack : undefined,
      additionalData,
      timestamp: errorReport.timestamp,
      occurrences: errorReport.errorCount,
    });

    // In production, you might want to send to error reporting service
    // this.sendToErrorReporting(errorReport);
  }

  /**
   * Handle ECS component/system errors
   */
  handleECSError(error: Error, entityId?: number, componentType?: string): void {
    this.handleSystemError(error, 'ECS_SYSTEM', {
      entityId,
      componentType,
    });
  }

  /**
   * Handle rendering/canvas errors
   */
  handleRenderError(error: Error, renderContext?: string): void {
    this.handleSystemError(error, 'RENDERING', {
      renderContext,
      canvasInfo: this.getCanvasInfo(),
    });
  }

  /**
   * Handle game logic errors (collision, physics, etc.)
   */
  handleGameLogicError(error: Error, systemName: string, gameState?: Partial<GameState>): void {
    this.handleSystemError(error, 'GAME_LOGIC', {
      systemName,
      gameState,
    });
  }

  /**
   * Handle configuration/setup errors
   */
  handleConfigError(error: Error, configType: string): void {
    this.handleSystemError(error, 'CONFIGURATION', {
      configType,
    });
  }

  /**
   * Safely execute a function with error handling
   */
  safeExecute<T>(fn: () => T, context: string, fallbackValue?: T): T | undefined {
    try {
      return fn();
    } catch (error) {
      this.handleSystemError(error as Error, context);
      return fallbackValue;
    }
  }

  /**
   * Safely execute an async function with error handling
   */
  async safeExecuteAsync<T>(fn: () => Promise<T>, context: string, fallbackValue?: T): Promise<T | undefined> {
    try {
      return await fn();
    } catch (error) {
      this.handleSystemError(error as Error, context);
      return fallbackValue;
    }
  }

  /**
   * Safely get a component from an entity with error handling
   */
  safeGetComponent<T extends Component>(
    entityManager: EntityManager,
    entityId: number,
    componentType: ComponentConstructor<T>,
    context: string
  ): T | null {
    try {
      // First check if entity exists (defensive programming)
      if (!entityManager.hasEntity(entityId)) {
        return null;
      }

      // Check if component exists before getting
      if (!entityManager.hasComponent(entityId, componentType)) {
        return null;
      }

      return entityManager.getComponent(entityId, componentType) as T;
    } catch (error) {
      // Use context to provide better error messages
      this.handleSystemError(error as Error, `ECS_GET_COMPONENT_${context}`, {
        entityId,
        componentType: componentType.name || 'Unknown',
        context,
      });
      return null;
    }
  }

  /**
   * Safely check if entity has component with error handling
   */
  safeHasComponent<T extends Component>(
    entityManager: EntityManager,
    entityId: number,
    componentType: ComponentConstructor<T>,
    context: string
  ): boolean {
    try {
      // Defensive check first
      if (!entityManager.hasEntity(entityId)) {
        return false;
      }
      return entityManager.hasComponent(entityId, componentType);
    } catch (error) {
      // Use context to provide better error messages
      this.handleSystemError(error as Error, `ECS_HAS_COMPONENT_${context}`, {
        entityId,
        componentType: componentType.name || 'Unknown',
        context,
      });
      return false;
    }
  }

  /**
   * Safely add a component to an entity with error handling
   */
  safeAddComponent<T extends Component>(
    entityManager: EntityManager,
    entityId: number,
    component: T,
    context: string
  ): boolean {
    try {
      if (!entityManager.hasEntity(entityId)) {
        this.handleSystemError(new Error(`Entity ${entityId} does not exist`), `ECS_ADD_COMPONENT_${context}`, {
          entityId,
          componentType: component.constructor.name,
        });
        return false;
      }

      entityManager.addComponent(entityId, component);
      return true;
    } catch (error) {
      this.handleSystemError(error as Error, `ECS_ADD_COMPONENT_${context}`, {
        entityId,
        componentType: component.constructor.name,
        context,
      });
      return false;
    }
  }

  /**
   * Validate game state and throw descriptive errors
   */
  validateGameState(condition: boolean, message: string, context?: string): asserts condition {
    if (!condition) {
      const error = new Error(`Game State Validation Failed: ${message}`);
      if (context) {
        this.handleSystemError(error, context);
      }
      throw error;
    }
  }

  /**
   * Get canvas information for error reporting
   */
  private getCanvasInfo(): CanvasInfo {
    const canvases = document.querySelectorAll('canvas');

    return {
      count: canvases.length,
      visible: Array.from(canvases).filter((c) => c.offsetParent !== null).length,
      sizes: Array.from(canvases).map((c) => `${c.width}x${c.height}`),
      width: canvases[0]?.width,
      height: canvases[0]?.height,
      contextType: this.probeContextType(canvases[0]),
    };
  }

  /**
   * Probe a canvas's 2D context defensively. getContext() throws an
   * InvalidStateError on a canvas whose control has been transferred to an
   * OffscreenCanvas — an error reporter must never throw while gathering its
   * own diagnostics (that turns one error into two and loses the original), so
   * any failure here degrades quietly to 'unknown'.
   */
  private probeContextType(canvas: HTMLCanvasElement | undefined): string {
    if (!canvas) return 'unknown';
    try {
      return canvas.getContext('2d') ? '2d' : 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

/**
 * Custom error types for different game systems
 */
export class GameSystemError extends Error {
  constructor(
    message: string,
    public readonly system: string,
    public readonly additionalData?: ErrorContext
  ) {
    super(message);
    this.name = 'GameSystemError';
  }
}

export class ECSError extends GameSystemError {
  constructor(
    message: string,
    public readonly entityId?: number,
    public readonly componentType?: string
  ) {
    super(message, 'ECS', { entityId, componentType });
    this.name = 'ECSError';
  }
}

export class RenderError extends GameSystemError {
  constructor(
    message: string,
    public readonly renderContext?: string
  ) {
    super(message, 'RENDERING', { renderContext });
    this.name = 'RenderError';
  }
}
