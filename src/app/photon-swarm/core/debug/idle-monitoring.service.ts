import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { PlayerService } from '../player/player.service';
import { GameStateService } from '../state/game-state.service';

interface BugData {
  idleTime: number;
  previousHealth: number;
  currentHealth: number;
  healthDiff: number;
  isDamage: boolean;
  isHeal: boolean;
  suspicious: boolean;
  timestamp: number;
  message?: string;
  stackTrace?: string[];
  [key: string]: unknown; // Add index signature for compatibility
}

/**
 * Idle Monitoring Service
 *
 * Monitors player state during idle periods to detect when the mysterious
 * health drain issue occurs. Tracks player movement, input, and health changes.
 */
@Injectable({
  providedIn: 'root',
})
export class IdleMonitoringService implements OnDestroy {
  private isPlayerIdle = false;
  private lastMovementTime = Date.now();
  private lastHealthCheck = 100;
  private lastPlayerPosition = { x: 0, y: 0 };
  private idleStartTime = 0;
  private monitoringInterval?: number;
  private positionSubscriptions: Subscription[] = [];

  private readonly IDLE_THRESHOLD_MS = 2000; // 2 seconds without movement = idle
  private readonly MONITORING_INTERVAL_MS = 1000; // Check every 1000ms — debug tool only, not gameplay-critical

  // Event emitters
  private bugDetectedSubject = new Subject<BugData>();
  public bugDetected$ = this.bugDetectedSubject.asObservable();

  constructor(
    private ngZone: NgZone,
    private player: PlayerService,
    private gameState: GameStateService
  ) {
    // Do NOT auto-start - let caller control when monitoring begins
  }

  /**
   * Start monitoring player idle state and health changes
   */
  startMonitoring(): void {
    // Clear any existing subscriptions to prevent leaks
    this.clearSubscriptions();

    // Subscribe to player position changes
    this.positionSubscriptions.push(
      this.player.x$.subscribe((x) => this.onPlayerMove(x, 'x')),
      this.player.y$.subscribe((y) => this.onPlayerMove(y, 'y'))
    );

    // Start periodic monitoring
    this.ngZone.runOutsideAngular(() => {
      this.monitoringInterval = window.setInterval(() => {
        this.checkIdleState();
        this.monitorHealthDuringIdle();
      }, this.MONITORING_INTERVAL_MS);
    });

    // Silent start - no console output
  }

  /**
   * Handle player movement detection
   */
  private onPlayerMove(value: number, axis: 'x' | 'y'): void {
    const currentPos = { x: this.player.x$.value, y: this.player.y$.value };
    const positionChanged =
      Math.abs(currentPos.x - this.lastPlayerPosition.x) > 0.1 ||
      Math.abs(currentPos.y - this.lastPlayerPosition.y) > 0.1;

    if (positionChanged) {
      const wasIdle = this.isPlayerIdle;
      this.lastMovementTime = Date.now();
      this.lastPlayerPosition = { ...currentPos };

      if (wasIdle) {
        const idleDuration = Date.now() - this.idleStartTime;
        // Log to debug bridge
        if (window.debugLogBridge) {
          window.debugLogBridge.log(`Player movement detected after ${idleDuration}ms idle`, 'info', {
            axis,
            value,
            position: currentPos,
            wasIdle,
            idleDuration,
          });
        }

        this.isPlayerIdle = false;
        this.idleStartTime = 0;
      }
    }
  }

  /**
   * Check if player is currently idle
   */
  private checkIdleState(): void {
    const now = Date.now();
    const timeSinceMovement = now - this.lastMovementTime;
    const shouldBeIdle = timeSinceMovement >= this.IDLE_THRESHOLD_MS;

    if (shouldBeIdle && !this.isPlayerIdle) {
      // Player just became idle
      this.isPlayerIdle = true;
      this.idleStartTime = now;
      this.lastHealthCheck = this.gameState.getHealth();

      // Log to debug bridge
      if (window.debugLogBridge) {
        window.debugLogBridge.log(
          `Player idle started at position (${this.lastPlayerPosition.x.toFixed(0)}, ${this.lastPlayerPosition.y.toFixed(0)})`,
          'info',
          { position: this.lastPlayerPosition, health: this.lastHealthCheck, timeSinceMovement }
        );
      }
    } else if (!shouldBeIdle && this.isPlayerIdle) {
      // Player stopped being idle
      this.isPlayerIdle = false;
      const idleDuration = now - this.idleStartTime;

      // Log to debug bridge
      if (window.debugLogBridge) {
        window.debugLogBridge.log(`Player idle ended after ${idleDuration}ms`, 'info', { idleDuration });
      }

      this.idleStartTime = 0;
    }
  }

  /**
   * Monitor health changes specifically during idle periods
   */
  private monitorHealthDuringIdle(): void {
    if (!this.isPlayerIdle) {
      return;
    }

    const currentHealth = this.gameState.getHealth();
    const healthChanged = Math.abs(currentHealth - this.lastHealthCheck) > 0.1;

    if (healthChanged) {
      const healthDiff = currentHealth - this.lastHealthCheck;
      const idleDuration = Date.now() - this.idleStartTime;

      const healthChangeData = {
        type: 'IDLE_HEALTH_CHANGE',
        healthBefore: this.lastHealthCheck,
        healthAfter: currentHealth,
        healthDiff,
        isHeal: healthDiff > 0,
        isDamage: healthDiff < 0,
        idleDuration,
        playerPosition: this.lastPlayerPosition,
        suspicious: Math.abs(healthDiff) > 10, // Changes > 10 are suspicious during idle
        timestamp: Date.now(),
      };

      if (healthChangeData.suspicious) {
        // Log to debug bridge instead of console
        if (window.debugLogBridge) {
          window.debugLogBridge.log(
            `🚨 SUSPICIOUS IDLE HEALTH CHANGE: ${healthDiff > 0 ? '+' : ''}${healthDiff.toFixed(1)} health`,
            'error',
            healthChangeData
          );
        }

        // If health dropped to around 10, this is our target bug!
        if (healthChangeData.isDamage && currentHealth >= 8 && currentHealth <= 12) {
          const bugData: BugData = {
            idleTime: idleDuration,
            previousHealth: this.lastHealthCheck,
            currentHealth: currentHealth,
            healthDiff: healthDiff,
            isDamage: healthDiff < 0,
            isHeal: healthDiff > 0,
            suspicious: true,
            timestamp: Date.now(),
            message: 'This is the idle health drain to ~10 HP that we are investigating!',
            stackTrace: new Error().stack?.split('\n').slice(1, 8),
          };
          // Log to debug bridge instead of console
          if (window.debugLogBridge) {
            window.debugLogBridge.log('🎯 TARGET BUG DETECTED: Idle health drain to ~10 HP!', 'error', bugData);
          }

          // Emit event for auto-export
          this.bugDetectedSubject.next(bugData);
        }

        // If health jumped back up to near 100, this is the restoration
        if (healthChangeData.isHeal && currentHealth >= 95 && this.lastHealthCheck < 20) {
          // Log to debug bridge instead of console
          const restorationData = {
            ...healthChangeData,
            message: 'This is the mysterious health restoration back to 100!',
            stackTrace: new Error().stack?.split('\n').slice(1, 8),
          };
          if (window.debugLogBridge) {
            window.debugLogBridge.log(
              '🎯 TARGET RESTORATION DETECTED: Health jumped back to 100!',
              'error',
              restorationData
            );
          }
        }
      } else {
        // Log to debug bridge
        if (window.debugLogBridge) {
          window.debugLogBridge.log(
            `Idle health change: ${healthDiff > 0 ? '+' : ''}${healthDiff.toFixed(1)}`,
            'info',
            healthChangeData
          );
        }
      }

      this.lastHealthCheck = currentHealth;
    }
  }

  /**
   * Get current idle state
   */
  getIdleState(): {
    isIdle: boolean;
    idleDuration: number;
    timeSinceMovement: number;
    currentHealth: number;
  } {
    const now = Date.now();
    return {
      isIdle: this.isPlayerIdle,
      idleDuration: this.isPlayerIdle ? now - this.idleStartTime : 0,
      timeSinceMovement: now - this.lastMovementTime,
      currentHealth: this.gameState.getHealth(),
    };
  }

  /**
   * Force check for idle state (useful for testing)
   */
  forceIdleCheck(): void {
    this.checkIdleState();
    this.monitorHealthDuringIdle();
  }

  /**
   * Angular lifecycle hook - cleanup on service destruction
   */
  ngOnDestroy(): void {
    this.destroy();
  }

  /**
   * Stop monitoring and cleanup subscriptions
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.clearSubscriptions();
  }

  /**
   * Stop monitoring (cleanup)
   */
  destroy(): void {
    this.stopMonitoring();
    this.bugDetectedSubject.complete();
  }

  private clearSubscriptions(): void {
    this.positionSubscriptions.forEach((sub) => sub.unsubscribe());
    this.positionSubscriptions = [];
  }
}
