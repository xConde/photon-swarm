import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { IdleMonitoringService } from './idle-monitoring.service';
import { PlayerService } from '../player/player.service';
import { GameStateService } from '../state/game-state.service';

describe('IdleMonitoringService', () => {
  let service: IdleMonitoringService;
  let playerSpy: jasmine.SpyObj<PlayerService>;
  let gameStateSpy: jasmine.SpyObj<GameStateService>;
  let xSubject: BehaviorSubject<number>;
  let ySubject: BehaviorSubject<number>;

  let currentNow: number;

  beforeEach(() => {
    currentNow = 1000000; // Arbitrary fixed start time
    spyOn(Date, 'now').and.callFake(() => currentNow);

    xSubject = new BehaviorSubject<number>(0);
    ySubject = new BehaviorSubject<number>(0);

    playerSpy = jasmine.createSpyObj<PlayerService>('PlayerService', [], {
      x$: xSubject,
      y$: ySubject,
    });

    gameStateSpy = jasmine.createSpyObj<GameStateService>('GameStateService', ['getHealth']);
    gameStateSpy.getHealth.and.returnValue(100);

    delete window.debugLogBridge;

    jasmine.clock().install();

    TestBed.configureTestingModule({
      providers: [
        IdleMonitoringService,
        { provide: PlayerService, useValue: playerSpy },
        { provide: GameStateService, useValue: gameStateSpy },
      ],
    });

    service = TestBed.inject(IdleMonitoringService);
  });

  afterEach(() => {
    service.destroy();
    jasmine.clock().uninstall();
  });

  /** Advances the fake Date.now clock by ms milliseconds. */
  function advanceTime(ms: number): void {
    currentNow += ms;
  }

  // -----------------------------------------------------------------------
  // getIdleState() — initial state
  // -----------------------------------------------------------------------

  it('should not be idle immediately after creation', () => {
    expect(service.getIdleState().isIdle).toBeFalse();
  });

  it('getIdleState() returns current health from GameStateService', () => {
    gameStateSpy.getHealth.and.returnValue(75);
    expect(service.getIdleState().currentHealth).toBe(75);
  });

  it('getIdleState() returns idleDuration of 0 when not idle', () => {
    expect(service.getIdleState().idleDuration).toBe(0);
  });

  it('getIdleState() returns non-zero timeSinceMovement after time elapses', () => {
    advanceTime(500);
    expect(service.getIdleState().timeSinceMovement).toBeGreaterThanOrEqual(500);
  });

  // -----------------------------------------------------------------------
  // startMonitoring()
  // -----------------------------------------------------------------------

  it('startMonitoring() does not throw', () => {
    expect(() => service.startMonitoring()).not.toThrow();
    service.stopMonitoring();
  });

  it('startMonitoring() called twice clears prior subscriptions without throwing', () => {
    service.startMonitoring();
    expect(() => service.startMonitoring()).not.toThrow();
    service.stopMonitoring();
  });

  // -----------------------------------------------------------------------
  // Idle detection via forceIdleCheck()
  // -----------------------------------------------------------------------

  it('forceIdleCheck() marks player as idle after IDLE_THRESHOLD_MS has elapsed', () => {
    service.startMonitoring();
    // IDLE_THRESHOLD_MS = 2000
    advanceTime(2500);
    service.forceIdleCheck();
    expect(service.getIdleState().isIdle).toBeTrue();
    service.stopMonitoring();
  });

  it('forceIdleCheck() player is NOT idle before IDLE_THRESHOLD_MS elapses', () => {
    service.startMonitoring();
    advanceTime(1000); // under 2 s threshold
    service.forceIdleCheck();
    expect(service.getIdleState().isIdle).toBeFalse();
    service.stopMonitoring();
  });

  it('getIdleState() reports positive idleDuration once player is idle', () => {
    service.startMonitoring();
    advanceTime(2500);
    service.forceIdleCheck(); // becomes idle, records idleStartTime = currentNow
    advanceTime(300);
    const state = service.getIdleState();
    expect(state.isIdle).toBeTrue();
    expect(state.idleDuration).toBeGreaterThanOrEqual(300);
    service.stopMonitoring();
  });

  // -----------------------------------------------------------------------
  // Health monitoring during idle
  // -----------------------------------------------------------------------

  it('does not emit bugDetected$ when health is unchanged during idle', () => {
    service.startMonitoring();
    advanceTime(2500);
    service.forceIdleCheck(); // become idle

    let bugEmitted = false;
    service.bugDetected$.subscribe(() => {
      bugEmitted = true;
    });

    // Health stays at 100
    gameStateSpy.getHealth.and.returnValue(100);
    service.forceIdleCheck();

    expect(bugEmitted).toBeFalse();
    service.stopMonitoring();
  });

  it('emits bugDetected$ when health drains to ~10 HP during idle', () => {
    service.startMonitoring();
    advanceTime(2500);
    service.forceIdleCheck(); // become idle with lastHealthCheck = 100

    const bugs: unknown[] = [];
    service.bugDetected$.subscribe((bug) => bugs.push(bug));

    // Drain to 10 HP — diff = -90 (>10 so suspicious), and 10 is within [8,12]
    gameStateSpy.getHealth.and.returnValue(10);
    service.forceIdleCheck();

    expect(bugs.length).toBe(1);
    service.stopMonitoring();
  });

  it('does not emit bugDetected$ when health drops but stays above 12 HP', () => {
    service.startMonitoring();
    advanceTime(2500);
    service.forceIdleCheck(); // become idle

    const bugs: unknown[] = [];
    service.bugDetected$.subscribe((bug) => bugs.push(bug));

    // Drop to 50 — suspicious (diff>10) but not in the [8,12] target range
    gameStateSpy.getHealth.and.returnValue(50);
    service.forceIdleCheck();

    expect(bugs.length).toBe(0);
    service.stopMonitoring();
  });

  it('does not monitor health when player is not idle', () => {
    service.startMonitoring();
    // Do NOT advance time — player is not idle

    const bugs: unknown[] = [];
    service.bugDetected$.subscribe((bug) => bugs.push(bug));

    gameStateSpy.getHealth.and.returnValue(10);
    service.forceIdleCheck();

    expect(bugs.length).toBe(0);
    service.stopMonitoring();
  });

  // -----------------------------------------------------------------------
  // stopMonitoring() / destroy()
  // -----------------------------------------------------------------------

  it('stopMonitoring() clears the interval without throwing', () => {
    service.startMonitoring();
    expect(() => service.stopMonitoring()).not.toThrow();
  });

  it('stopMonitoring() can be called multiple times safely', () => {
    service.startMonitoring();
    service.stopMonitoring();
    expect(() => service.stopMonitoring()).not.toThrow();
  });

  it('destroy() completes bugDetected$ observable', () => {
    let completed = false;
    service.bugDetected$.subscribe({
      complete: () => {
        completed = true;
      },
    });
    service.destroy();
    expect(completed).toBeTrue();
  });

  it('ngOnDestroy() delegates to destroy()', () => {
    spyOn(service, 'destroy');
    service.ngOnDestroy();
    expect(service.destroy).toHaveBeenCalled();
  });
});
