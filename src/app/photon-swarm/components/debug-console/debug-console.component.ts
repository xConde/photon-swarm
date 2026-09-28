import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { PlayerService } from '../../core/player/player.service';
// import { GameRenderingService } from '../../core/engine/game-rendering.service';
import { EffectsSystemService } from '../../core/entities/effects-system.service';
import { TIMING_CONFIG } from '../../config/game-constants';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { BeamCollisionService } from '../../core/combat/beam-collision.service';
import { GameHealthData, GameHealthMonitorService } from '../../core/monitoring/game-health-monitor.service';
import { IdleMonitoringService } from '../../core/debug/idle-monitoring.service';
import { DebugLogBridgeService } from '../../core/debug/debug-log-bridge.service';
import { ExtendedPerformance } from '../../core/models/game-types.model';
import { EntityManagerService } from '../../core/ecs/entity-manager.service';
import { EnemyMovementSystemService } from '../../core/systems/enemy-ai/enemy-movement-system.service';
import { CollisionSystemService } from '../../core/systems/combat/collision-system.service';
import { FactionAISystemService } from '../../core/systems/enemy-ai/faction-ai-system.service';
import { IdleBehaviorSystemService } from '../../core/systems/enemy-ai/idle-behavior-system.service';
import { PerformanceMonitorService } from '../../core/utils/performance-monitor.service';
import { Enemy } from '../../core/models/enemy.model';
import { createEnemyId } from '../../core/models/common.model';

interface DebugMetadata {
  context?: string;
  data?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

interface DebugLog {
  timestamp: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success' | 'ai-alert';
  metadata?: DebugMetadata;
  sessionId: string;
  gameTime: number;
}

interface AIAnalysisEvidence {
  fps?: number;
  entityCount?: number;
  playerPosition?: { x: number; y: number };
  gameState?: string;
  [key: string]: unknown;
}

interface AIAnalysisReport {
  timestamp: string;
  category: 'performance' | 'gameplay' | 'visual' | 'state' | 'user-experience';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  evidence: AIAnalysisEvidence;
  recommendations: string[];
  sessionId: string;
  reproducible: boolean;
  confidence: number;
}

@Component({
  selector: 'app-debug-console',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.z-index]': '2147483647', // Maximum z-index value
    '[style.position]': '"fixed"',
    '[style.pointer-events]': '"auto"',
  },
  template: `
    <div
      class="rs-debug-interface"
      [class.minimized]="isMinimized"
      (click)="preventGameClick($event)"
      (mousedown)="preventGameClick($event)"
      (mouseup)="preventGameClick($event)"
    >
      <div class="rs-header">
        <div class="rs-title">Diagnostics</div>
        <div class="rs-tabs">
          <button class="rs-tab" [class.active]="activeTab === 'monitor'" (click)="setActiveTab('monitor')">📊</button>
          <button class="rs-tab" [class.active]="activeTab === 'alerts'" (click)="setActiveTab('alerts')">🚨</button>
          <button class="rs-tab" [class.active]="activeTab === 'performance'" (click)="setActiveTab('performance')">
            📈
          </button>
          <button class="rs-tab" [class.active]="activeTab === 'logs'" (click)="setActiveTab('logs')">📝</button>
        </div>
        <button class="rs-minimize" (click)="toggleMinimize()">{{ isMinimized ? '▲' : '▼' }}</button>
      </div>

      @if (!isMinimized) {
        <div class="rs-content">
          <!-- Monitor Tab -->
          @if (activeTab === 'monitor') {
            <div class="rs-panel">
              <div class="rs-grid">
                <div class="rs-slot" [class.recording]="isRecording">
                  <div class="rs-icon">🔴</div>
                  <div class="rs-label">{{ isRecording ? 'REC' : 'IDLE' }}</div>
                </div>
                <div class="rs-slot" [class]="'trust-' + trustLevel">
                  <div class="rs-icon">🎯</div>
                  <div class="rs-label">{{ trustLevel.toUpperCase() }}</div>
                </div>
                <div
                  class="rs-slot"
                  [class.warning]="currentMetrics.fps < 30"
                  [class.critical]="currentMetrics.fps < 15"
                >
                  <div class="rs-icon">⚡</div>
                  <div class="rs-value">{{ currentMetrics.fps }}</div>
                  <div class="rs-label">FPS</div>
                </div>
                <div class="rs-slot" [class.warning]="memoryUsage > 50" [class.critical]="memoryUsage > 100">
                  <div class="rs-icon">💾</div>
                  <div class="rs-value">{{ memoryUsage | number: '1.0-1' }}</div>
                  <div class="rs-label">MB</div>
                </div>

                <!-- Game State Indicator -->
                <div class="rs-slot" [class.active]="inputState.gameState !== 'idle'">
                  <div class="rs-icon">{{ getGameStateIcon() }}</div>
                  <div class="rs-label">{{ getGameStateLabel() }}</div>
                </div>

                @if (aiAlerts.length > 0) {
                  <div class="rs-slot clickable" (click)="setActiveTab('alerts')">
                    <div class="rs-icon">🚨</div>
                    <div class="rs-value">{{ aiAlerts.length }}</div>
                    <div class="rs-label">ISSUES</div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Alerts Tab -->
          @if (activeTab === 'alerts') {
            <div class="rs-panel">
              <div class="rs-alerts-header">
                <h3>Alerts ({{ aiAlerts.length }})</h3>
                @if (aiAlerts.length > 0) {
                  <button class="rs-clear-btn" (click)="clearAlerts()">CLEAR ALL</button>
                }
              </div>
              @if (aiAlerts.length > 0) {
                <div class="rs-alerts-container" #alertsContainer>
                  @for (alert of getRecentAlerts(); track trackAlert($index, alert)) {
                    <div class="rs-alert-card" [class]="'severity-' + alert.severity">
                      <div class="alert-header">
                        <span class="alert-severity" [class]="'severity-' + alert.severity">{{ alert.severity }}</span>
                        <span class="alert-time">{{ formatAlertTime(alert.timestamp) }}</span>
                      </div>
                      <div class="alert-title">{{ alert.title }}</div>
                      <div class="alert-desc">{{ alert.description }}</div>
                      <div class="alert-category">{{ alert.category }}</div>
                    </div>
                  }
                </div>
              } @else {
                <div class="rs-no-alerts">
                  <div class="rs-icon">✅</div>
                  <div>No alerts detected</div>
                </div>
              }
            </div>
          }

          <!-- Performance Tab -->
          @if (activeTab === 'performance') {
            <div class="rs-panel">
              <div class="rs-chart-container">
                <canvas #performanceChart class="rs-chart" width="280" height="120"></canvas>
              </div>
              <div class="rs-mini-stats">
                <div class="rs-stat">
                  <span class="rs-stat-label">AVG FPS:</span>
                  <span class="rs-stat-value">{{ getAverageFPS() | number: '1.0-0' }}</span>
                </div>
                <div class="rs-stat">
                  <span class="rs-stat-label">TREND:</span>
                  <span class="rs-stat-value">{{ getDebouncedPerformanceTrend() }}</span>
                </div>
              </div>
            </div>
          }

          <!-- Logs Tab -->
          @if (activeTab === 'logs') {
            <div class="rs-panel">
              <div class="rs-log-container">
                @for (log of getRecentLogs(); track trackLogItem($index, log)) {
                  <div class="rs-log-entry" [class]="'log-' + log.type">
                    <span class="rs-log-time">{{ formatLogTime(log.timestamp) }}</span>
                    <span class="rs-log-msg">{{ log.message }}</span>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        <div class="rs-actions">
          <button class="rs-action-btn" (click)="smartExport()">EXPORT</button>
          <button class="rs-action-btn" (click)="enhancedStressTest()">STRESS</button>
          <button class="rs-action-btn danger" (click)="clearAll()">CLEAR</button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .rs-debug-interface {
        position: absolute;
        top: -0.32rem;
        right: -0.28rem;
        width: 20rem;
        background: linear-gradient(145deg, #3e2723 0%, #2e1a17 100%);
        border: 0.125rem solid #8d6e63;
        border-radius: 0.5rem;
        font-family: 'Courier New', monospace;
        font-size: 0.6875rem;
        color: #ffeb3b;
        box-shadow: 0 0.25rem 0.9375rem rgba(0, 0, 0, 0.6);
        z-index: 999999 !important; /* FORCE above everything including game over screen */
        user-select: none;
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        pointer-events: auto;
      }

      .rs-debug-interface.minimized {
        height: 2.5rem;
        overflow: hidden;
      }

      .rs-header {
        background: linear-gradient(145deg, #5d4037 0%, #3e2723 100%);
        border-bottom: 0.0625rem solid #8d6e63;
        padding: 0.375rem 0.5rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .rs-title {
        font-weight: bold;
        color: #ffeb3b;
        font-size: 0.75rem;
      }

      .rs-tabs {
        display: flex;
        gap: 0.125rem;
      }

      .rs-tab {
        background: #4e342e;
        border: 0.0625rem solid #6d4c41;
        color: #bcaaa4;
        padding: 0.25rem 0.5rem;
        cursor: pointer;
        font-size: 0.875rem;
        border-radius: 0.1875rem;
        transition: all 0.2s;
      }

      .rs-tab:hover {
        background: #5d4037;
        color: #ffeb3b;
      }

      .rs-tab.active {
        background: #ff6f00;
        color: white;
        border-color: #e65100;
      }

      .rs-minimize {
        background: #6d4c41;
        border: 0.0625rem solid #8d6e63;
        color: #ffeb3b;
        padding: 0.125rem 0.375rem;
        cursor: pointer;
        border-radius: 0.1875rem;
        font-size: 0.625rem;
      }

      .rs-content {
        padding: 0.5rem;
        max-height: 25rem;
        overflow-y: auto;
      }

      .rs-panel {
        min-height: 12.5rem;
      }

      .rs-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 0.1875rem;
        padding: 0.25rem;
      }

      .rs-slot {
        background: linear-gradient(145deg, #4e342e 0%, #3e2723 100%);
        border: 0.0625rem solid #6d4c41;
        border-radius: 0.25rem;
        padding: 0.375rem 0.25rem;
        text-align: center;
        min-height: 3.125rem;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        transition: all 0.3s;
      }

      .rs-slot.clickable {
        cursor: pointer;
      }

      .rs-slot.clickable:hover {
        transform: translateY(-0.125rem);
        border-color: #ffeb3b;
      }

      .rs-slot.recording {
        background: linear-gradient(145deg, #c62828 0%, #8e0000 100%);
        animation: pulse 2s infinite;
      }

      .rs-slot.warning {
        border-color: #ff9800;
        background: linear-gradient(145deg, #ff6f00 0%, #e65100 100%);
      }

      .rs-slot.critical {
        border-color: #f44336;
        background: linear-gradient(145deg, #d32f2f 0%, #b71c1c 100%);
      }

      .rs-slot.active {
        background: #ffeb3b;
        color: #3e2723;
        font-weight: bold;
        border-color: #ffeb3b;
      }

      .rs-icon {
        font-size: 1rem;
        margin-bottom: 0.125rem;
      }

      .rs-value {
        font-size: 0.625rem;
        font-weight: bold;
        color: #ffeb3b;
      }

      .rs-label {
        font-size: 0.5rem;
        color: #bcaaa4;
        text-transform: uppercase;
      }

      .rs-alerts-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }

      .rs-alerts-container {
        max-height: 15rem;
        overflow-y: auto;
      }

      .rs-alert-card {
        background: rgba(20, 20, 20, 0.95);
        border: 0.0625rem solid #8d6e63;
        border-left: 0.25rem solid #ff6f00;
        border-radius: 0.25rem;
        padding: 0.75rem;
        margin-bottom: 0.5rem;
        color: #e0e0e0;
        transition: all 0.2s ease;
        cursor: pointer;
      }

      .rs-alert-card:hover {
        background: rgba(30, 30, 30, 0.95);
        border-color: #ffeb3b;
        transform: translateY(-1px);
      }

      .rs-alert-card.severity-low {
        border-left-color: #4caf50;
      }

      .rs-alert-card.severity-medium {
        border-left-color: #ff9800;
      }

      .rs-alert-card.severity-high {
        border-left-color: #ff5722;
      }

      .rs-alert-card.severity-critical {
        border-left-color: #f44336;
        background: rgba(30, 10, 10, 0.95);
        animation: criticalPulse 2s infinite;
      }

      @keyframes criticalPulse {
        0%,
        100% {
          border-left-color: #f44336;
        }
        50% {
          border-left-color: #ff8a80;
        }
      }

      .alert-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.6875rem;
        margin-bottom: 0.5rem;
      }

      .alert-severity {
        background: #3e2723;
        color: #ffeb3b;
        padding: 0.125rem 0.5rem;
        border-radius: 0.75rem;
        font-weight: bold;
        font-size: 0.5625rem;
        text-transform: uppercase;
      }

      .alert-severity.severity-critical {
        background: #f44336;
        color: white;
      }

      .alert-severity.severity-high {
        background: #ff5722;
        color: white;
      }

      .alert-severity.severity-medium {
        background: #ff9800;
        color: white;
      }

      .alert-severity.severity-low {
        background: #4caf50;
        color: white;
      }

      .alert-time {
        color: #bcaaa4;
        font-size: 0.5625rem;
      }

      .alert-title {
        font-weight: bold;
        margin-bottom: 0.375rem;
        color: #ffffff;
        font-size: 0.75rem;
      }

      .alert-desc {
        font-size: 0.6875rem;
        color: #d0d0d0;
        line-height: 1.3;
        margin-bottom: 0.25rem;
      }

      .alert-category {
        font-size: 0.5625rem;
        color: #8d6e63;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .rs-chart-container {
        background: #2e1a17;
        border: 0.0625rem solid #6d4c41;
        border-radius: 0.25rem;
        padding: 0.5rem;
        margin-bottom: 0.5rem;
      }

      .rs-chart {
        width: 100%;
        height: 7.5rem;
        background: #1a1a1a;
        border-radius: 0.125rem;
      }

      .rs-mini-stats {
        display: flex;
        justify-content: space-between;
        padding: 0.25rem;
      }

      .rs-stat-label {
        font-size: 0.5rem;
        color: #bcaaa4;
        display: block;
      }

      .rs-stat-value {
        font-size: 0.625rem;
        color: #ffeb3b;
        font-weight: bold;
      }

      .rs-log-container {
        background: #2e1a17;
        border: 0.0625rem solid #6d4c41;
        border-radius: 0.25rem;
        padding: 0.5rem;
        max-height: 12.5rem;
        overflow-y: auto;
      }

      .rs-log-entry {
        display: flex;
        gap: 0.5rem;
        padding: 0.125rem 0;
        border-bottom: 0.0625rem solid #3e2723;
        font-size: 0.5625rem;
        line-height: 1.4;
      }

      .rs-log-entry.log-info {
        color: #e0e0e0;
      }

      .rs-log-entry.log-warning {
        color: #ffb74d;
        background: rgba(255, 183, 77, 0.1);
      }

      .rs-log-entry.log-error {
        color: #ef5350;
        background: rgba(239, 83, 80, 0.1);
      }

      .rs-log-entry.log-success {
        color: #66bb6a;
        background: rgba(102, 187, 106, 0.1);
      }

      .rs-log-entry.log-ai-alert {
        color: #ff6f00;
        background: rgba(255, 111, 0, 0.1);
        font-weight: bold;
      }

      .rs-log-time {
        color: #bcaaa4;
        min-width: 3.75rem;
        font-family: 'Courier New', monospace;
      }

      .rs-log-msg {
        color: inherit;
        flex: 1;
      }

      .rs-actions {
        display: flex;
        gap: 0.25rem;
        padding: 0.5rem;
        border-top: 0.0625rem solid #6d4c41;
      }

      .rs-action-btn {
        flex: 1;
        background: #5d4037;
        border: 0.0625rem solid #8d6e63;
        color: #ffeb3b;
        padding: 0.25rem;
        cursor: pointer;
        border-radius: 0.1875rem;
        font-size: 0.5625rem;
      }

      .rs-action-btn:hover {
        background: #6d4c41;
      }

      .rs-action-btn.danger {
        background: #d32f2f;
        border-color: #f44336;
      }

      .rs-clear-btn {
        background: #d32f2f;
        border: 0.0625rem solid #f44336;
        color: white;
        padding: 0.125rem 0.5rem;
        cursor: pointer;
        border-radius: 0.1875rem;
        font-size: 0.5625rem;
      }

      .rs-no-alerts {
        text-align: center;
        padding: 2rem;
        color: #bcaaa4;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
    `,
  ],
})
export class DebugConsoleComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild('performanceChart', { static: false }) chartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('alertsContainer', { static: false }) alertsContainer!: ElementRef<HTMLDivElement>;

  // Core state
  isRecording = false;
  activeTab: 'monitor' | 'performance' | 'logs' | 'alerts' = 'monitor';
  isMinimized = false;
  trustLevel: 'low' | 'medium' | 'high' = 'low';

  // Metrics
  currentMetrics = {
    fps: 0,
    playerX: 0,
    playerY: 0,
    activeParticles: 0,
    level: 1,
    health: 100,
    maxHealth: 100,
  };
  memoryUsage = 0;
  gameHealthData: GameHealthData | null = null;

  // Health tracking
  private lastHealthValue: number = 100;
  private healthChangeHistory: Array<{
    timestamp: number;
    health: number;
    change: number;
    reason: string;
  }> = [];

  // Data collections
  debugLogs: DebugLog[] = [];
  aiAlerts: AIAnalysisReport[] = [];
  performanceHistory: number[] = [];

  // Session data
  sessionStartTime = Date.now();
  sessionId = this.generateSessionId();
  private lastLoggedAction = '';
  private lastActionLogTime = 0;

  // UI Debug data - removed to reduce debug export size
  // These were previously used for movement/UI tracking but are no longer exported
  // Can be re-enabled if needed for specific debugging scenarios

  // Intervals
  private updateInterval?: number;
  private analysisInterval?: number;
  private targetingInterval?: number;
  private combatInterval?: number;
  private chartCtx?: CanvasRenderingContext2D;

  // RAF / timeout handles
  private fpsRafHandle?: number;
  private chartRetryTimeout?: number;

  // Performance trending with debouncing
  private lastTrendUpdate = 0;
  private debouncedTrend = 'STABLE';
  private readonly TREND_DEBOUNCE_MS = 3000;

  // FPS tracking
  private frameCount = 0;
  private fpsStartTime = window.performance.now();
  private currentFPS = 60;

  // Private properties for state tracking
  private lastPlayerPos: { x: number; y: number } | null = null;
  private lastMovementCheck = 0;

  // Debug aggregation to prevent spam
  private debugAggregation: Map<string, { count: number; lastSeen: number; data?: unknown }> = new Map();

  // Enhanced state tracking
  private isPlayerMoving = false;
  private isPlayerInCombat = false;
  private isPlayerTargeting = false;
  private isPlayerDashing = false; // Add dash state tracking
  private lastBeamHitTime = 0;

  // Grace period after transitioning to idle — prevents false-positive "mystery idle damage"
  // alerts when pre-idle contact damage is detected on the first idle tick.
  private idleTransitionTime = 0;
  private readonly IDLE_GRACE_PERIOD_MS = 500;

  public inputState = {
    movement: false,
    combat: false,
    gameState: 'idle',
  };

  constructor(
    private player: PlayerService,
    private effectsSystem: EffectsSystemService,
    private gameEngine: GameEngineService,
    private beamCollision: BeamCollisionService,
    private cdr: ChangeDetectorRef,
    private gameHealthMonitor: GameHealthMonitorService,
    private idleMonitoring: IdleMonitoringService,
    private debugLogBridge: DebugLogBridgeService,
    private entityManager: EntityManagerService,
    private enemyMovementSystem: EnemyMovementSystemService,
    private collisionSystem: CollisionSystemService,
    private factionAISystem: FactionAISystemService,
    private idleBehaviorSystem: IdleBehaviorSystemService,
    private performanceMonitor: PerformanceMonitorService,
    private ngZone: NgZone,
    private destroyRef: DestroyRef
  ) {
    // REMOVED: Console.log interception to prevent dual interception with DebugLogBridgeService
    // All debug data should flow through the debug bridge service directly
  }

  ngOnInit(): void {
    this.startMonitoring();
    this.startFPSTracking();
    this.setupGameSystemListeners();
    this.setupHealthMonitoring();
    this.setupDebugLogBridge();

    // Start game health monitoring
    this.gameHealthMonitor.startMonitoring();

    // Start idle monitoring (only runs when debug console is active)
    this.idleMonitoring.startMonitoring();

    this.log('Debug console initialized', 'info');
  }

  ngOnDestroy(): void {
    this.stopMonitoring();

    // Cancel the FPS rAF loop
    if (this.fpsRafHandle !== undefined) {
      window.cancelAnimationFrame(this.fpsRafHandle);
      this.fpsRafHandle = undefined;
    }

    // Cancel the chart-setup retry timeout
    if (this.chartRetryTimeout !== undefined) {
      window.clearTimeout(this.chartRetryTimeout);
      this.chartRetryTimeout = undefined;
    }

    // Release aggregation memory
    this.debugAggregation.clear();

    // Stop game health monitoring
    this.gameHealthMonitor.stopMonitoring();

    // Stop idle monitoring
    this.idleMonitoring.stopMonitoring();

    // Clean up event listeners
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    if (this.keyupHandler) {
      window.removeEventListener('keyup', this.keyupHandler);
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.setupChart();
      if (this.performanceHistory.length === 0) {
        this.performanceHistory = [60, 59, 61, 58, 60];
      }
      this.updateChart();
    }, 200);
  }

  // Prevent game clicks when interacting with debug console
  preventGameClick(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
  }

  private startMonitoring(): void {
    this.isRecording = true;
    this.ngZone.runOutsideAngular(() => {
      this.updateInterval = window.setInterval(
        () => this.captureMetrics(),
        TIMING_CONFIG.DEBUG_CONSOLE.METRICS_UPDATE_INTERVAL_MS
      );
      this.analysisInterval = window.setInterval(
        () => this.runAIAnalysis(),
        TIMING_CONFIG.DEBUG_CONSOLE.AI_ANALYSIS_INTERVAL_MS
      );
    });
  }

  private stopMonitoring(): void {
    this.isRecording = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = undefined;
    }
    if (this.targetingInterval) {
      clearInterval(this.targetingInterval);
      this.targetingInterval = undefined;
    }
    if (this.combatInterval) {
      clearInterval(this.combatInterval);
      this.combatInterval = undefined;
    }
  }

  private captureMetrics(): void {
    try {
      const fps = this.calculateFPS();
      const playerPos = this.player.getPosition?.() || { x: 0, y: 0 };
      const particles = this.effectsSystem.getActiveParticles?.()?.length || 0;

      // Get health from game engine
      const currentHealth = this.gameEngine.getPlayerHealth();
      const maxHealth = this.gameEngine.getPlayerMaxHealth();

      this.captureUserInput();
      this.trackHealthChanges(currentHealth, maxHealth);

      this.currentMetrics = {
        fps: Math.round(fps),
        playerX: Math.round(playerPos.x),
        playerY: Math.round(playerPos.y),
        activeParticles: particles,
        level: 1,
        health: currentHealth,
        maxHealth: maxHealth,
      };

      this.memoryUsage = this.estimateMemoryUsage();
      this.performanceHistory.push(fps);

      if (this.performanceHistory.length > 30) {
        this.performanceHistory.shift();
      }

      // Only log performance every 30 samples (about every 5 seconds)
      if (this.performanceHistory.length % 30 === 0) {
        this.log(`Performance: ${fps.toFixed(1)} FPS, ${particles} particles, ${this.memoryUsage}MB memory`, 'info');
      }

      const positionChanged =
        Math.abs(playerPos.x - (this.lastPlayerPos?.x || 0)) > 150 ||
        Math.abs(playerPos.y - (this.lastPlayerPos?.y || 0)) > 150;
      if (positionChanged) {
        this.log(`Player moved to (${Math.round(playerPos.x)}, ${Math.round(playerPos.y)})`, 'info');
        this.lastPlayerPos = { x: playerPos.x, y: playerPos.y };
      }

      if (this.activeTab === 'performance') {
        this.updateChart();
      }

      if (this.performanceHistory.length % 4 === 0) {
        this.cdr.detectChanges();
      }
    } catch (err) {
      this.log(`Metrics capture error: ${String(err)}`, 'error');
    }
  }

  private setupGameSystemListeners(): void {
    // Listen to actual player movement keys
    this.setupMovementListener();

    // Listen to targeting state changes
    this.setupTargetingListener();

    // Listen to beam-enemy collisions for combat detection
    this.setupCombatListener();
  }

  private setupHealthMonitoring(): void {
    // Subscribe to game health monitoring data
    this.gameHealthMonitor
      .getHealthData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((healthData) => {
        this.gameHealthData = healthData;

        // Update memory usage from health data
        this.memoryUsage = healthData.memory.usage;

        // Update current metrics with performance data
        this.currentMetrics = {
          ...this.currentMetrics,
          fps: Math.round(healthData.performance.fps),
        };

        // Log critical health issues
        if (healthData.overall.status === 'critical') {
          this.log(
            `🚨 Game Health Critical: ${healthData.overall.issues.join(', ')}`,
            'error',
            this.convertToDebugMetadata(healthData)
          );
        } else if (healthData.overall.status === 'warning') {
          this.log(
            `⚠️ Game Health Warning: ${healthData.overall.issues.join(', ')}`,
            'warning',
            this.convertToDebugMetadata(healthData)
          );
        }

        // Trigger change detection for UI updates
        this.cdr.detectChanges();
      });
  }

  private setupDebugLogBridge(): void {
    // Subscribe to debug log bridge for damage/heal events
    this.debugLogBridge.debugLog$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((logEvent) => {
      this.log(logEvent.message, logEvent.type, logEvent.metadata as DebugMetadata);
    });

    // Subscribe to bug detection for auto-export
    this.idleMonitoring.bugDetected$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((bugData) => {
      this.log('🎯 IDLE HEALTH DRAIN BUG DETECTED! Auto-exporting debug data...', 'error', bugData);

      // Auto-export after a short delay to ensure all logs are captured
      setTimeout(() => {
        this.smartExport();
        this.log('Debug data auto-exported due to bug detection!', 'success');
      }, 1000);
    });
  }

  private setupMovementListener(): void {
    // Track both movement and dash keys for precise state detection
    const movementKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
    const dashKeys = ['shift', ' ']; // space and shift for dash

    // Track currently pressed keys
    const pressedKeys = new Set<string>();

    const keydownHandler = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();

      if (this.player.getGameActive()) {
        // Track movement keys for precise state detection
        if (movementKeys.includes(key)) {
          pressedKeys.add(key);
          const wasMoving = this.isPlayerMoving;
          this.isPlayerMoving = pressedKeys.size > 0;

          if (this.isPlayerMoving !== wasMoving) {
            this.updateGameState();
          }
        }

        // Handle dash keys - important for state differentiation
        if (dashKeys.includes(key)) {
          this.isPlayerDashing = true;
          this.updateGameState();

          // Dash state expires after short duration
          setTimeout(() => {
            this.isPlayerDashing = false;
            this.updateGameState();
          }, 300); // Dash effect lasts 300ms
        }
      }
    };

    const keyupHandler = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();

      if (movementKeys.includes(key)) {
        pressedKeys.delete(key);
        const wasMoving = this.isPlayerMoving;
        this.isPlayerMoving = pressedKeys.size > 0;

        if (this.isPlayerMoving !== wasMoving) {
          this.updateGameState();
        }
      }
    };

    // Add event listeners
    window.addEventListener('keydown', keydownHandler);
    window.addEventListener('keyup', keyupHandler);

    // Store for cleanup
    this.keydownHandler = keydownHandler;
    this.keyupHandler = keyupHandler;
  }

  private keydownHandler?: (e: KeyboardEvent) => void;
  private keyupHandler?: (e: KeyboardEvent) => void;

  private setupTargetingListener(): void {
    // Clear any existing interval to prevent leaks
    if (this.targetingInterval) {
      clearInterval(this.targetingInterval);
    }

    // Check targeting state every frame since it's managed by PlayerService
    this.ngZone.runOutsideAngular(() => {
      this.targetingInterval = window.setInterval(() => {
        if (!this.player.getGameActive()) return;

        const wasTargeting = this.isPlayerTargeting;
        this.isPlayerTargeting = this.player.isDirectionChangeActive();

        if (this.isPlayerTargeting !== wasTargeting) {
          if (this.isPlayerTargeting) {
            this.trackUserAction('Targeting Active');
          } else {
            this.trackUserAction('Targeting Stopped');
          }
          this.updateGameState();
        }
      }, 50); // Check every 50ms for responsiveness
    });
  }

  private setupCombatListener(): void {
    // Clear any existing interval to prevent leaks
    if (this.combatInterval) {
      clearInterval(this.combatInterval);
    }

    // Monitor beam-enemy collisions using the optimized BeamCollisionService
    this.ngZone.runOutsideAngular(() => {
      this.combatInterval = window.setInterval(() => {
        if (!this.player.getGameActive()) return;

        const wasInCombat = this.isPlayerInCombat;
        const now = Date.now();

        // Check if there are enemies in beam range using the optimized service
        const hasEnemiesInRange = this.checkEnemiesInBeamRangeOptimized();
        const hasRecentBeamHit = now - this.lastBeamHitTime < 1000; // 1 second timeout

        this.isPlayerInCombat = hasEnemiesInRange || hasRecentBeamHit;

        if (this.isPlayerInCombat !== wasInCombat) {
          if (this.isPlayerInCombat) {
            this.trackUserAction('Combat Engaged');
          } else {
            this.trackUserAction('Combat Ended');
          }
          this.updateGameState();
        }
      }, 100); // Check every 100ms for good responsiveness
    });
  }

  private checkEnemiesInBeamRangeOptimized(): boolean {
    try {
      const enemies = this.gameEngine.getEnemies();
      if (!enemies || enemies.length === 0) return false;

      const playerPos = this.player.getPosition();
      const playerAngle = this.player.getAngle();
      const beamLength = 800;
      const beamRadius = 15;

      // Create beam configuration
      const beamConfig = {
        startX: playerPos.x,
        startY: playerPos.y,
        endX: playerPos.x + Math.cos(playerAngle) * beamLength,
        endY: playerPos.y + Math.sin(playerAngle) * beamLength,
        radius: beamRadius,
      };

      // Convert LegacyEnemy[] to Enemy[] for beam collision service
      const convertedEnemies: Enemy[] = enemies.map((enemy) => ({
        id: enemy.id ? createEnemyId(typeof enemy.id === 'string' ? parseInt(enemy.id) : enemy.id) : createEnemyId(0),
        x: enemy.x,
        y: enemy.y,
        vx: enemy.vx,
        vy: enemy.vy,
        radius: enemy.radius,
        type: enemy.type,
        health: enemy.health,
        maxHealth: enemy.maxHealth,
      }));

      // Use the optimized service for collision detection
      const result = this.beamCollision.checkEnemiesInBeamRange(convertedEnemies, beamConfig, false);

      if (result.hasCollision) {
        this.lastBeamHitTime = Date.now(); // Update last hit time
      }

      return result.hasCollision;
    } catch {
      return false;
    }
  }

  private updateGameState(): void {
    let newGameState = 'idle';

    // Enhanced state priority: combat > targeting (while not moving) > traveling (movement OR dash) > idle
    if (this.isPlayerInCombat) {
      newGameState = 'combat';
    } else if (this.isPlayerTargeting && !this.isPlayerMoving && !this.isPlayerDashing) {
      newGameState = 'targeting';
    } else if (this.isPlayerMoving || this.isPlayerDashing) {
      // "no movement + dash = traveling" - dash counts as traveling even without movement
      newGameState = 'traveling';
    }

    const stateChanged = newGameState !== this.inputState.gameState;
    if (stateChanged) {
      // Log state transitions with more detail
      if (newGameState === 'idle' && this.inputState.gameState !== 'idle') {
        this.idleTransitionTime = Date.now();
        this.trackUserAction('Player Idle');
      } else if (newGameState === 'traveling') {
        if (this.isPlayerDashing && !this.isPlayerMoving) {
          this.trackUserAction('Player Traveling (Dash Only)');
        } else if (this.isPlayerMoving && this.isPlayerDashing) {
          this.trackUserAction('Player Traveling (Movement + Dash)');
        } else {
          this.trackUserAction('Player Traveling (Movement)');
        }
      } else if (newGameState === 'targeting') {
        if (this.isPlayerTargeting) {
          this.trackUserAction('Targeting Active');
        } else {
          this.trackUserAction('Targeting Stopped');
        }
      }
    }

    // Update state immediately
    this.inputState = {
      movement: this.isPlayerMoving || this.isPlayerDashing, // Include dash in movement state
      combat: this.isPlayerInCombat,
      gameState: newGameState,
    };

    // Force UI update when state changes
    if (stateChanged) {
      this.cdr.detectChanges();
    }
  }

  private captureUserInput(): void {
    try {
      const now = Date.now();
      const playerPos = this.player.getPosition?.() || { x: 0, y: 0 };

      // Track position changes for logging (movement state now handled by key tracking)
      if (this.lastPlayerPos && now - this.lastMovementCheck > 200) {
        const distance = Math.sqrt(
          Math.pow(playerPos.x - this.lastPlayerPos.x, 2) + Math.pow(playerPos.y - this.lastPlayerPos.y, 2)
        );

        // Log significant position changes for debugging
        if (distance > 150) {
          this.log(`Player moved to (${Math.round(playerPos.x)}, ${Math.round(playerPos.y)})`, 'info');
        }

        this.lastPlayerPos = { x: playerPos.x, y: playerPos.y };
        this.lastMovementCheck = now;
      }

      if (this.lastPlayerPos === null) {
        this.lastPlayerPos = { x: playerPos.x, y: playerPos.y };
      }
    } catch (error) {
      // Log error instead of silently swallowing
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Error tracking player movement', 'warning', {
          source: 'debug_console',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private trackUserAction(action: string): void {
    // Only log significant actions or state changes
    const significantActions = ['Dash', 'Discharge', 'Level Up', 'Enemy Killed', 'Item Collected'];
    const shouldLog =
      significantActions.some((a) => action.includes(a)) ||
      (action !== this.lastLoggedAction && Date.now() - this.lastActionLogTime > 1000);

    if (shouldLog) {
      this.log(`Action: ${action}`, 'info');
      this.lastLoggedAction = action;
      this.lastActionLogTime = Date.now();
    }
  }

  private trackHealthChanges(currentHealth: number, maxHealth: number): void {
    const now = Date.now();

    // Check if health changed
    if (currentHealth !== this.lastHealthValue) {
      const change = currentHealth - this.lastHealthValue;

      // CRITICAL FIX: Don't record phantom damage when already dead
      if (this.lastHealthValue <= 0 && currentHealth <= 0) {
        return;
      }

      // CRITICAL FIX: Don't record huge damage jumps that are likely tracking errors
      if (Math.abs(change) >= maxHealth && currentHealth <= 0) {
        // This is likely a phantom event - health jumped from max to 0
        this.log('Health tracking sync issue detected', 'warning', {
          lastHealth: this.lastHealthValue,
          currentHealth,
          change,
        });
        this.lastHealthValue = currentHealth;
        return;
      }

      const changeType = change > 0 ? 'HEALED' : 'DAMAGED';
      const reason = this.determineHealthChangeReason(change, currentHealth, maxHealth);

      // Log health change
      this.log(
        `Health ${changeType}: ${Math.abs(change).toFixed(1)} (${currentHealth.toFixed(1)}/${maxHealth})`,
        change > 0 ? 'success' : 'warning',
        { change, currentHealth, maxHealth, reason }
      );

      // Store in history
      this.healthChangeHistory.push({
        timestamp: now,
        health: currentHealth,
        change,
        reason,
      });

      // Keep only last 20 health changes
      if (this.healthChangeHistory.length > 20) {
        this.healthChangeHistory.shift();
      }

      // Alert on critical health
      if (currentHealth <= 25 && change < 0) {
        this.createAIAlert({
          category: 'gameplay',
          severity: 'high',
          title: 'Critical Health',
          description: `Health dropped to ${currentHealth.toFixed(1)}/${maxHealth} (${reason})`,
          evidence: { currentHealth, maxHealth, change, reason },
          recommendations: ['Find healing source', 'Avoid combat', 'Check for environmental damage'],
          reproducible: true,
          confidence: 1.0,
        });
      }

      // Special alert for health loss during idle — ONLY fires for truly unexplained damage.
      // "Idle" just means "not moving" — standing still surrounded by enemies is expected damage,
      // not mystery damage. Only flag when the source tracking actually failed AND no enemies
      // hit the player recently (enemy_contact is a known, legitimate source).
      const hasKnownDamageSource =
        reason.includes('enemy_contact') ||
        reason.includes('asteroid') ||
        reason.includes('burn') ||
        reason.includes('projectile');
      const withinIdleGracePeriod = Date.now() - this.idleTransitionTime < this.IDLE_GRACE_PERIOD_MS;
      if (change < 0 && this.inputState.gameState === 'idle' && !withinIdleGracePeriod && !hasKnownDamageSource) {
        this.createAIAlert({
          category: 'gameplay',
          severity: 'critical',
          title: '🚨 MYSTERY IDLE DAMAGE DETECTED',
          description: `Health dropped by ${Math.abs(change).toFixed(1)} while completely idle! This should NOT happen.`,
          evidence: {
            currentHealth,
            maxHealth,
            change,
            reason,
            gameState: this.inputState.gameState,
            movementActive: this.inputState.movement,
            combatActive: this.inputState.combat,
            playerPosition: this.player?.getPosition?.() || { x: 0, y: 0 },
          },
          recommendations: [
            'Check DAMAGE_TAKEN logs in console for exact source',
            'Verify no environmental damage zones at current position',
            'Check for beam backfire or upgrade effects',
            'Look for collision damage or stuck enemies',
          ],
          reproducible: true,
          confidence: 1.0,
        });
      }

      this.lastHealthValue = currentHealth;
    }
  }

  private determineHealthChangeReason(change: number, currentHealth: number, maxHealth: number): string {
    // const gameState = this.inputState.gameState; // Unused after fix

    if (change > 0) {
      // Healing
      if (currentHealth >= maxHealth) {
        return 'Full Health Restored';
      }
      return 'Health Regeneration';
    } else {
      // Damage
      // CRITICAL FIX: Don't categorize damage based on movement state
      // This was causing mystery idle damage when player stopped moving
      // All damage in this game comes from enemy contact or projectiles

      // Check if we have a recent damage source from collision system
      const recentDamageSource = this.getRecentDamageSource();
      if (recentDamageSource) {
        return `Enemy Damage (${recentDamageSource})`;
      }

      // Default to enemy damage since environmental damage is disabled
      return 'Enemy Damage (source tracking failed)';
    }
  }

  private lastDamageSource: string | null = null;
  private lastDamageTimestamp: number = 0;

  private getRecentDamageSource(): string | null {
    // Check if we have a damage source from the last 2 seconds
    if (this.lastDamageSource && Date.now() - this.lastDamageTimestamp < 2000) {
      return this.lastDamageSource;
    }
    return null;
  }

  // Call this from damage event handlers to track source
  public setDamageSource(source: string): void {
    this.lastDamageSource = source;
    this.lastDamageTimestamp = Date.now();
  }

  private runAIAnalysis(): void {
    if (this.performanceHistory.length < 5) return;

    try {
      this.analyzePerformance();
      this.updateTrustLevel();

      this.log(
        `System Status: Trust=${this.trustLevel}, Alerts=${this.aiAlerts.length}, Memory=${this.memoryUsage}MB`,
        'info'
      );

      if (this.memoryUsage > 150) {
        this.log(`High memory usage detected: ${this.memoryUsage}MB`, 'warning');
      }

      if (this.currentMetrics.activeParticles > 1000) {
        this.log(`High particle count: ${this.currentMetrics.activeParticles} active`, 'warning');
      }
    } catch (err) {
      this.log(`Diagnostic analysis error: ${String(err)}`, 'error');
    }
  }

  private analyzePerformance(): void {
    const avgFPS = this.getAverageFPS();
    const minFPS = Math.min(...this.performanceHistory.slice(-10));

    if (avgFPS < 25) {
      const recentPerfAlert = this.aiAlerts.find(
        (alert) => alert.category === 'performance' && Date.now() - new Date(alert.timestamp).getTime() < 30000
      );

      if (!recentPerfAlert) {
        this.createAIAlert({
          category: 'performance',
          severity: avgFPS < 15 ? 'critical' : 'high',
          title: 'Performance Issue',
          description: `FPS dropped to ${avgFPS.toFixed(1)} (min: ${minFPS.toFixed(1)})`,
          evidence: { avgFPS, minFPS },
          recommendations: ['Reduce particle effects', 'Check for performance bottlenecks'],
          reproducible: true,
          confidence: 0.9,
        });
      }
    }
  }

  private createAIAlert(alert: Omit<AIAnalysisReport, 'timestamp' | 'sessionId'>): void {
    const newAlert: AIAnalysisReport = {
      ...alert,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
    };

    this.aiAlerts.push(newAlert);
    this.log(`Diagnostic alert: ${alert.title}`, 'ai-alert');

    if (this.aiAlerts.length > 20) {
      this.aiAlerts = this.aiAlerts.slice(-20);
    }
  }

  private startFPSTracking(): void {
    const trackFPS = (): void => {
      this.frameCount++;
      const now = window.performance.now();
      const elapsed = now - this.fpsStartTime;

      if (elapsed >= 1000) {
        this.currentFPS = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.fpsStartTime = now;
      }

      if (this.isRecording) {
        this.ngZone.runOutsideAngular(() => {
          this.fpsRafHandle = window.requestAnimationFrame(trackFPS);
        });
      } else {
        this.fpsRafHandle = undefined;
      }
    };
    this.ngZone.runOutsideAngular(() => {
      this.fpsRafHandle = window.requestAnimationFrame(trackFPS);
    });
  }

  private calculateFPS(): number {
    return this.currentFPS;
  }

  private estimateMemoryUsage(): number {
    if (window.performance && (window.performance as ExtendedPerformance).memory) {
      const memory = (window.performance as ExtendedPerformance).memory;
      return Math.round((memory?.usedJSHeapSize || 0) / 1024 / 1024);
    }
    return 0;
  }

  private updateTrustLevel(): void {
    const avgFPS = this.getAverageFPS();
    const alertCount = this.aiAlerts.length;

    if (avgFPS > 50 && alertCount < 3) {
      this.trustLevel = 'high';
    } else if (avgFPS > 30 && alertCount < 10) {
      this.trustLevel = 'medium';
    } else {
      this.trustLevel = 'low';
    }
  }

  private setupChart(): void {
    if (!this.chartRef?.nativeElement) {
      this.chartRetryTimeout = window.setTimeout(
        () => this.setupChart(),
        TIMING_CONFIG.DEBUG_CONSOLE.CHART_SETUP_DELAY_MS
      );
      return;
    }
    this.chartRetryTimeout = undefined;

    const canvas = this.chartRef.nativeElement;
    canvas.width = 280;
    canvas.height = 120;

    this.chartCtx = canvas.getContext('2d') ?? undefined;
    if (this.chartCtx) {
      this.chartCtx.fillStyle = '#1a1a1a';
      this.chartCtx.fillRect(0, 0, 280, 120);
    }
  }

  private updateChart(): void {
    if (!this.chartCtx || this.performanceHistory.length < 2) return;

    const ctx = this.chartCtx;
    const width = 280;
    const height = 120;

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;

    const fpsLevels = [15, 30, 45, 60];
    fpsLevels.forEach((fps) => {
      const y = height - (fps / 60) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.fillText(`${fps}`, 5, y - 2);
    });

    for (let i = 0; i <= 4; i++) {
      const x = (width / 4) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (this.performanceHistory.length > 1) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.beginPath();

      const maxFPS = 60;
      const stepX = width / (this.performanceHistory.length - 1);

      this.performanceHistory.forEach((fps, index) => {
        const x = index * stepX;
        const y = height - Math.min(fps / maxFPS, 1) * height;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();

      ctx.fillStyle = '#00ff88';
      this.performanceHistory.forEach((fps, index) => {
        const x = index * stepX;
        const y = height - Math.min(fps / maxFPS, 1) * height;
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.fillStyle = '#ffeb3b';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${this.currentMetrics.fps} FPS`, width - 60, 15);

    ctx.fillStyle = '#ff6f00';
    ctx.font = '10px monospace';
    ctx.fillText(`Avg: ${this.getAverageFPS().toFixed(1)}`, width - 60, 30);
  }

  // Public methods
  setActiveTab(tab: 'monitor' | 'performance' | 'logs' | 'alerts'): void {
    this.activeTab = tab;
    this.cdr.detectChanges();

    if (tab === 'performance') {
      setTimeout(() => {
        this.setupChart();
        this.updateChart();
      }, 50);
    }

    if (tab === 'alerts' && this.alertsContainer) {
      setTimeout(() => {
        this.alertsContainer.nativeElement.scrollTop = this.alertsContainer.nativeElement.scrollHeight;
      }, 50);
    }
  }

  toggleMinimize(): void {
    this.isMinimized = !this.isMinimized;
    this.cdr.detectChanges();
  }

  clearAlerts(): void {
    this.aiAlerts = [];
    this.log('Alerts cleared', 'info');
    this.cdr.detectChanges();
  }

  clearAll(): void {
    this.debugLogs = [];
    this.aiAlerts = [];
    this.performanceHistory = [];
    this.log('All data cleared', 'info');
    this.cdr.detectChanges();
  }

  smartExport(): void {
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));

    const month = String(centralTime.getMonth() + 1).padStart(2, '0');
    const day = String(centralTime.getDate()).padStart(2, '0');
    const year = centralTime.getFullYear();
    const dateStr = `${month}${day}${year}`;

    const hours = centralTime.getHours();
    const minutes = String(centralTime.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = String(hours % 12 || 12).padStart(2, '0');
    const timeStr = `${displayHours}${minutes}${ampm}`;

    // Capture canvas screenshot for visual debugging
    let canvasSnapshot = null;
    try {
      const canvas = this.gameEngine.getCanvas();
      if (canvas) {
        // Capture as base64 data URL (compressed JPEG for smaller file size)
        canvasSnapshot = canvas.toDataURL('image/jpeg', 0.7);
      }
    } catch (err) {
      this.log('Failed to capture canvas snapshot', 'warning', { error: err });
    }

    // Remove sessionId from individual log entries - reduced to last 10
    const logsWithoutSessionId = this.debugLogs.slice(-10).map((log) => ({
      timestamp: log.timestamp,
      message: log.message,
      type: log.type,
      gameTime: log.gameTime,
    }));

    // Build diagnostic hints for the exported report
    const diagnosticHints = this.buildDiagnosticHints();

    const data = {
      diagnosticHints: {
        priority: diagnosticHints.priorityIssues,
        suggestedFiles: diagnosticHints.suggestedFiles,
      },
      session: {
        id: this.sessionId,
        timestamp: new Date().toISOString(),
        duration: Date.now() - this.sessionStartTime,
        trustLevel: this.trustLevel,
      },
      currentMetrics: this.currentMetrics,
      alerts: this.aiAlerts.slice(-5), // Reduced from 10 to 5
      recentLogs: logsWithoutSessionId,
      performance: {
        // Only keep summary stats, not full history array
        average: this.getAverageFPS(),
        trend: this.getDebouncedPerformanceTrend(),
        recent: this.performanceHistory.slice(-5), // Last 5 samples only
        spikes: this.getSpikeSummary(),
      },
      healthTracking: {
        currentHealth: this.currentMetrics.health,
        maxHealth: this.currentMetrics.maxHealth,
        healthPercentage: (this.currentMetrics.health / this.currentMetrics.maxHealth) * 100,
        damageHistory: this.debugLogBridge.getDamageHistory(),
        healHistory: this.debugLogBridge.getHealHistory(),
        suspiciousEvents: this.debugLogBridge.getSuspiciousEvents(),
        idleState: this.idleMonitoring.getIdleState(),
      },
      aggregatedData: this.getAggregatedDebugSummary(),
      visualSnapshot: canvasSnapshot, // Add canvas screenshot for visual debugging
    };

    // NEW: Enemy and memory diagnostics for Issue 0
    const enemyDiagnostics = this.enemyMovementSystem.getEnemyDiagnostics(this.entityManager);
    const exportData = {
      ...data,
      enemyDiagnostics,
      memoryDiagnostics: {
        trackingMapSizes: {
          collision: this.collisionSystem.getTrackingMapSizes(),
          factionAI: this.factionAISystem.getTrackingMapSizes(),
          idleBehavior: this.idleBehaviorSystem.getTrackingMapSizes(),
        },
        entityCount: enemyDiagnostics.totalEnemies,
      },
    };

    this.downloadFile(exportData, 'json', `debug-${dateStr}-${timeStr}.json`);
    this.log('Debug data exported', 'success');
  }

  enhancedStressTest(): void {
    this.log('Running stress test...', 'info');
    this.createAIAlert({
      category: 'performance',
      severity: 'medium',
      title: 'Stress Test Initiated',
      description: 'Performance monitoring during stress test',
      evidence: {},
      recommendations: ['Monitor FPS carefully'],
      reproducible: true,
      confidence: 1.0,
    });
  }

  private getSpikeSummary(): object | null {
    const summary = this.performanceMonitor.getSpikeSummary();
    const history = this.performanceMonitor.getSpikeHistory();
    return {
      ...summary,
      recent: history.slice(-10), // Last 10 spikes with system attribution
    };
  }

  getAverageFPS(): number {
    if (this.performanceHistory.length === 0) return 60;
    return this.performanceHistory.reduce((a, b) => a + b, 0) / this.performanceHistory.length;
  }

  getDebouncedPerformanceTrend(): string {
    const now = Date.now();
    if (now - this.lastTrendUpdate < this.TREND_DEBOUNCE_MS) {
      return this.debouncedTrend;
    }

    if (this.performanceHistory.length < 10) return 'STABLE';

    const recent = this.performanceHistory.slice(-10);
    const older = this.performanceHistory.slice(-20, -10);

    if (recent.length < 5 || older.length < 5) return 'STABLE';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const diff = recentAvg - olderAvg;

    let newTrend = 'STABLE';
    if (diff > 8) newTrend = 'IMPROVING';
    else if (diff < -8) newTrend = 'DECLINING';

    this.debouncedTrend = newTrend;
    this.lastTrendUpdate = now;
    return this.debouncedTrend;
  }

  getRecentAlerts(): AIAnalysisReport[] {
    return this.aiAlerts.slice(-10).reverse();
  }

  getRecentLogs(): DebugLog[] {
    return this.debugLogs.slice(-20).reverse();
  }

  formatLogTime(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return 'N/A';
    }
  }

  formatAlertTime(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return 'N/A';
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'N/A';
    }
  }

  trackLogItem(index: number, item: DebugLog): string {
    return `${item.timestamp}-${item.type}-${index}`;
  }

  trackAlert(index: number, item: AIAnalysisReport): string {
    return `${item.timestamp}-${item.severity}-${index}`;
  }

  getGameStateLabel(): string {
    switch (this.inputState.gameState) {
      case 'traveling':
        return 'TRAVELING';
      case 'combat':
        return 'COMBAT';
      case 'targeting':
        return 'TARGETING';
      default:
        return 'IDLE';
    }
  }

  getGameStateIcon(): string {
    switch (this.inputState.gameState) {
      case 'traveling':
        return '🚀';
      case 'combat':
        return '⚔️';
      case 'targeting':
        return '🎯';
      default:
        return '😴';
    }
  }

  private log(
    message: string,
    type: 'info' | 'warning' | 'error' | 'success' | 'ai-alert' = 'info',
    metadata?: DebugMetadata
  ): void {
    // Check if this is a repetitive message that should be aggregated
    const now = Date.now();
    const aggregationKey = `${type}:${message.substring(0, 50)}`; // Key based on type and first 50 chars

    const existingAgg = this.debugAggregation.get(aggregationKey);
    if (existingAgg) {
      const existing = existingAgg;
      existing.count++;
      existing.data = metadata;

      // Only log aggregated messages every 5 seconds to prevent spam
      if (now - existing.lastSeen < 5000) {
        return; // Skip logging, still within aggregation window
      }

      // Log aggregated message and reset counter
      this.logInternal(`${message} (×${existing.count})`, type, metadata);
      existing.count = 1;
      existing.lastSeen = now;
      return;
    }

    // New message, track it and log immediately
    this.debugAggregation.set(aggregationKey, { count: 1, lastSeen: now, data: metadata });
    this.logInternal(message, type, metadata);
  }

  private logInternal(
    message: string,
    type: 'info' | 'warning' | 'error' | 'success' | 'ai-alert' = 'info',
    metadata?: DebugMetadata
  ): void {
    const logEntry: DebugLog = {
      timestamp: new Date().toISOString(),
      message,
      type,
      metadata,
      sessionId: this.sessionId,
      gameTime: Date.now() - this.sessionStartTime,
    };

    this.debugLogs.push(logEntry);

    if (this.debugLogs.length > 100) {
      this.debugLogs = this.debugLogs.slice(-100);
    }
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  private getAggregatedDebugSummary(): Record<string, { count: number; lastSeen: string; mostRecentData?: unknown }> {
    const summary: Record<string, { count: number; lastSeen: string; mostRecentData?: unknown }> = {};

    for (const [key, data] of this.debugAggregation.entries()) {
      if (data.count > 1) {
        summary[key] = {
          count: data.count,
          lastSeen: new Date(data.lastSeen).toISOString(),
          mostRecentData: data.data,
        };
      }
    }

    return summary;
  }

  /**
   * Build diagnostic hints with priority issues and relevant source files
   */
  private buildDiagnosticHints(): { priorityIssues: string[]; suggestedFiles: string[] } {
    const priorityIssues: string[] = [];
    const suggestedFiles: string[] = [];
    const avgFPS = this.getAverageFPS();

    // Analyze FPS issues
    if (avgFPS < 30) {
      priorityIssues.push(`CRITICAL: Low FPS (${avgFPS.toFixed(0)}) - investigate rendering/system performance`);
      suggestedFiles.push('core/engine/game-rendering.service.ts');
      suggestedFiles.push('core/systems/territory/four-kings-territory.service.ts');
    } else if (avgFPS < 50) {
      priorityIssues.push(`WARNING: Suboptimal FPS (${avgFPS.toFixed(0)}) - check for performance bottlenecks`);
    }

    // Analyze health/damage issues
    const suspiciousEvents = this.debugLogBridge.getSuspiciousEvents();
    const suspiciousDamageCount = suspiciousEvents?.damage?.length || 0;
    if (suspiciousDamageCount > 0) {
      priorityIssues.push(`SUSPICIOUS: ${suspiciousDamageCount} unexplained damage events detected`);
      suggestedFiles.push('core/systems/combat/collision-system.service.ts');
      suggestedFiles.push('core/systems/combat/combat-system.service.ts');
    }

    // Analyze alerts
    const criticalAlerts = this.aiAlerts.filter((a) => a.severity === 'critical');
    if (criticalAlerts.length > 0) {
      priorityIssues.push(`ALERTS: ${criticalAlerts.length} critical alerts - ${criticalAlerts[0]?.title}`);
    }

    // Check for idle damage (major bug indicator)
    const idleDamageAlerts = this.aiAlerts.filter((a) => a.title.includes('IDLE DAMAGE'));
    if (idleDamageAlerts.length > 0) {
      priorityIssues.push('BUG: Mystery idle damage detected - player taking damage while not moving');
      suggestedFiles.push('core/debug/idle-monitoring.service.ts');
      suggestedFiles.push('components/debug-console/debug-console.component.ts');
    }

    // Add common files if no specific issues
    if (suggestedFiles.length === 0) {
      suggestedFiles.push('config/game-constants.ts');
    }

    // Deduplicate
    return {
      priorityIssues: [...new Set(priorityIssues)],
      suggestedFiles: [...new Set(suggestedFiles)],
    };
  }

  private downloadFile(data: unknown, _format: string, filename: string): void {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  }

  private convertToDebugMetadata(healthData: GameHealthData): DebugMetadata {
    return {
      context: 'game_health',
      data: healthData,
      overall: healthData.overall,
      performance: healthData.performance,
      memory: healthData.memory,
    };
  }
}
