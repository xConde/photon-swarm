import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { interval, Subscription, timer } from 'rxjs';
import { GameEngineService } from '../../core/engine/game-engine.service';
import { SaveGameAdapter } from '../../core/state/save-game.adapter';
import { DifficultyMode, DifficultyService } from '../../services/difficulty.service';
import { getHeatOptions } from '../../config/heat.config';
import { ControlIconName, getControlIcon } from '../../utils/control-icons';

// ──────────────────────────────────────────────────────────
// Module-level configuration & helpers (kept out of class for strict mode)
// ──────────────────────────────────────────────────────────
export const MAX_ACTIVE_ASTEROIDS = 4;
export const ASTEROID_BASE_MIN = 12; // s
export const ASTEROID_BASE_MAX = 24; // s

/** Random helper in range [min,max). */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const BASE_TYPING_SPEED_MS = 65;

interface StarBase {
  top: string;
  left: string;
  delay: string;
  duration: string;
}

/** Decorative star/asteroid definition */
export type Star = StarBase & {
  /** Grey asteroid instead of cyan star */
  isAsteroid?: boolean;
  /** Movement axis for asteroids */
  direction?: 'h' | 'v';
  /** Classification for rendering */
  kind?: 'star' | 'asteroid' | 'flash' | 'debris' | 'saucer';
  /** Optional movement delta for debris pieces (CSS var) */
  dx?: string;
  dy?: string;
  /** CSS size variable */
  size?: string;
  /** CSS opacity variable */
  opacity?: number;
};

@Component({
  selector: 'app-intro-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './intro-screen.component.html',
  styleUrls: ['./intro-screen.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntroScreenComponent implements OnInit, OnDestroy {
  @Output() startGame = new EventEmitter<string>();
  @Output() continueGame = new EventEmitter<void>();
  @Output() resumeRun = new EventEmitter<void>();

  /**
   * Pre-sanitized control-button SVG icons (same set as the in-game touch controls) so the
   * controls tutorial teaches the EXACT icons the player will see. Built once for OnPush.
   */
  private readonly sanitizer = inject(DomSanitizer);
  readonly controlIcons: Record<ControlIconName, SafeHtml> = {
    'weapon-beam': this.icon('weapon-beam'),
    'weapon-shot': this.icon('weapon-shot'),
    dash: this.icon('dash'),
    parry: this.icon('parry'),
    burst: this.icon('burst'),
    focus: this.icon('focus'),
    'auto-beam': this.icon('auto-beam'),
    map: this.icon('map'),
  };

  playerName = '';
  currentStep = 0;
  /**
   * Gates the stepper-step slide transitions. false on first paint so the non-active steps
   * SNAP to their off-screen .next/.previous positions instead of animating there (which
   * read as a panel "flying off the screen" at load). Flipped true one tick after first
   * paint in ngOnInit so genuine step navigation still animates.
   */
  stepTransitionsEnabled = false;
  tutorialStep = 0;
  isReturningPlayer = false;
  cursorBlinking = false;
  typingComplete = false;
  displayedWelcomeText = '';
  fullWelcomeText = '';
  instructionPhase: 'initial' | 'typing' | 'controls' | 'completed' | 'difficulty' = 'initial';
  hasSavedGame = false;
  hasRunCheckpoint = false;
  checkpointLevel = 0;

  activeKeys: Record<string, boolean> = {};
  activeMouseButtons: Record<string, boolean> = {};

  /** Which key set is in the foreground on the movement step */
  activeKeySet: 'wasd' | 'arrows' = 'wasd';
  private keySetSwitchTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly KEY_SET_DEBOUNCE_MS = 150;
  private animationTimers: ReturnType<typeof setTimeout>[] = [];

  private typingSubscription: Subscription | null = null;
  private tutorialTimer: Subscription | null = null;

  private instructionText = `The swarm descends. Your photon ship is all that stands between order and oblivion. Master your beam, shatter the void, and reclaim the stars.`;
  displayedInstructionText = '';
  instructionComplete = false;

  private lastKeyActivityTime = 0;
  private readonly ACTIVITY_GRACE_PERIOD = 600;

  stars: Star[] = [];
  private asteroidTimerSub?: Subscription;
  private starShuffleSub?: Subscription;
  private shootingStarSub?: Subscription;
  private saucerTimerSub?: Subscription;
  private impactTimerSub?: Subscription;

  /** collect dynamically created timer subscriptions for clean-up */
  private disposableSubs = new Set<Subscription>();

  selectedDifficulty: DifficultyMode = 'normal';

  readonly difficultyOptions = getHeatOptions();

  /** Bound handler stored so the same reference is used for removeEventListener. */
  private readonly _onVisualViewportResize = (): void => {
    this._syncVisualViewportHeight();
  };

  constructor(
    private gameEngine: GameEngineService,
    private saveAdapter: SaveGameAdapter,
    private cdr: ChangeDetectorRef,
    private difficultyService: DifficultyService,
    private elRef: ElementRef<HTMLElement>
  ) {
    this.selectedDifficulty = this.difficultyService.getDifficulty();
  }

  /** Trust a control-icon SVG string for [innerHTML] binding (icons are static, app-authored). */
  private icon(name: ControlIconName): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(getControlIcon(name));
  }

  /**
   * Write the current visual-viewport height as --intro-vh on the host element.
   * This pins the intro screen to the visible area so that the iOS soft keyboard
   * opening (which shrinks window.visualViewport.height) does not cause the host
   * to overflow its container and trigger rubber-band scrolling.
   */
  private _syncVisualViewportHeight(): void {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    this.elRef.nativeElement.style.setProperty('--intro-vh', `${window.visualViewport.height}px`);
  }

  ngOnInit(): void {
    // Pin layout to visual viewport so the iOS soft-keyboard doesn't cause
    // rubber-band bounce when the keyboard opens and shrinks the visible area.
    if (typeof window !== 'undefined' && window.visualViewport) {
      this._syncVisualViewportHeight();
      window.visualViewport.addEventListener('resize', this._onVisualViewportResize);
    }

    this.checkReturningPlayer();
    this.checkSavedGame();
    this.checkRunCheckpoint();
    this.generateStarField();

    // Spawn asteroids slightly more frequently (every 4s) and allow up to 4
    this.asteroidTimerSub = interval(4000).subscribe(() => {
      const activeCount = this.stars.filter((s) => s.isAsteroid).length;
      if (activeCount < MAX_ACTIVE_ASTEROIDS) {
        this.spawnAsteroid();
      }
    });

    // Random background impact every 25-45 s
    this.scheduleNextImpact();

    // Shuffle a few stars every 10 seconds after 5 blinks (~10s)
    this.starShuffleSub = interval(10000).subscribe(() => this.shuffleStars());

    // Rare shooting star every 30s
    this.shootingStarSub = interval(30000).subscribe(() => this.spawnShootingStar());

    // Saucer visitor every 60s
    this.saucerTimerSub = interval(60000).subscribe(() => this.spawnSaucer());

    // Enable the stepper slide transitions one tick AFTER the first paint, so the steps
    // settle into position silently on load (no panel flying off-screen) while later step
    // navigation still animates.
    this.animationTimers.push(
      setTimeout(() => {
        this.stepTransitionsEnabled = true;
        this.cdr.markForCheck();
      }, 50)
    );
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._onVisualViewportResize);
    }
    this.cleanupSubscriptions();
    this.asteroidTimerSub?.unsubscribe();
    this.starShuffleSub?.unsubscribe();
    this.shootingStarSub?.unsubscribe();
    this.saucerTimerSub?.unsubscribe();
    this.impactTimerSub?.unsubscribe();
    if (this.keySetSwitchTimeout) clearTimeout(this.keySetSwitchTimeout);
    this.animationTimers.forEach((t) => clearTimeout(t));
  }

  private trackTimeout(fn: () => void, ms: number): void {
    this.animationTimers.push(setTimeout(fn, ms));
  }

  private cleanupSubscriptions(): void {
    this.typingSubscription?.unsubscribe();
    this.tutorialTimer?.unsubscribe();
    this.disposableSubs.forEach((s) => s.unsubscribe());
    this.disposableSubs.clear();
  }

  private checkReturningPlayer(): void {
    const savedName = this.saveAdapter.loadPlayerName();
    if (savedName) {
      this.playerName = savedName;
      this.isReturningPlayer = true;
      this.fullWelcomeText = `Welcome back, ${this.playerName}`;
      this.trackTimeout(() => {
        this.startWelcomeAnimation();
        this.cdr.markForCheck();
      }, 300);
    }
  }

  private checkSavedGame(): void {
    this.hasSavedGame = this.saveAdapter.hasSave();
  }

  private checkRunCheckpoint(): void {
    const checkpoint = this.saveAdapter.loadCheckpoint();
    if (checkpoint) {
      this.hasRunCheckpoint = true;
      this.checkpointLevel = checkpoint.level;
      // Pre-fill player name from checkpoint if not already set
      if (!this.playerName && checkpoint.playerName) {
        this.playerName = checkpoint.playerName;
      }
    }
  }

  onResumeRun(): void {
    this.resumeRun.emit();
  }

  onNewGame(): void {
    this.saveAdapter.clearCheckpoint();
    this.hasRunCheckpoint = false;
    this.instructionPhase = 'difficulty';
    this.cdr.markForCheck();
  }

  onLaunchNewGame(): void {
    const name = this.playerName.trim();
    this.saveAdapter.savePlayerName(name);
    this.gameEngine.setPlayerName(name);
    this.startGame.emit(name);
  }

  backFromDifficulty(): void {
    this.instructionPhase = 'controls';
    this.startTutorialAutoRotation();
    this.cdr.markForCheck();
  }

  private startWelcomeAnimation(): void {
    let idx = 0;
    this.displayedWelcomeText = '';
    this.typingComplete = false;
    this.cleanupSubscriptions();
    const type = (): void => {
      if (idx < this.fullWelcomeText.length) {
        this.displayedWelcomeText += this.fullWelcomeText[idx++];
        let delay = BASE_TYPING_SPEED_MS * (0.85 + Math.random() * 0.3);
        const ch = this.fullWelcomeText[idx - 1];
        if (ch === ',') delay += 150;
        if (ch === '.') delay += 250;
        this.typingSubscription = timer(delay).subscribe(() => {
          type();
          this.cdr.markForCheck();
        });
      } else {
        this.trackTimeout(() => {
          this.typingComplete = true;
          this.cursorBlinking = true;
          this.cdr.markForCheck();
        }, 300);
      }
    };
    type();
  }

  /**
   * "Not You?" — abandon the recognized identity and switch to fresh name entry.
   * The inline handler used to only null playerName in memory, so a reload
   * re-ran checkReturningPlayer() and resurrected "Welcome back, <old name>".
   * Clear the persisted name too (save/checkpoint are intentionally untouched —
   * they're a single device-global slot, not per-name), reset the welcome
   * typing state, and focus the freshly-shown input.
   */
  onNotYou(): void {
    this.saveAdapter.clearPlayerName();
    this.isReturningPlayer = false;
    this.playerName = '';
    // Only stop the welcome typing (already complete here). Do NOT call the
    // broad cleanupSubscriptions() — it would also clear the shared starfield
    // disposable timers (asteroid/impact removal), stranding decorative
    // elements and killing the ambient impact scheduler.
    this.typingSubscription?.unsubscribe();
    this.displayedWelcomeText = '';
    this.fullWelcomeText = '';
    this.typingComplete = false;
    this.cursorBlinking = false;
    this.cdr.markForCheck();
    // autofocus doesn't re-fire on the @if swap — focus the input next tick.
    this.trackTimeout(() => {
      document.getElementById('playerName')?.focus();
    }, 0);
  }

  skipWelcomeAnimation(): void {
    if (!this.typingComplete) {
      this.cleanupSubscriptions();
      this.displayedWelcomeText = this.fullWelcomeText;
      this.typingComplete = true;
      this.cursorBlinking = true;
    }
  }

  getStepClasses(step: number): Record<string, boolean> {
    return {
      active: this.currentStep === step,
      previous: this.currentStep > step,
      next: this.currentStep < step,
    };
  }

  nextStep(): void {
    if (this.currentStep === 0 && this.playerName.trim()) {
      this.saveAdapter.savePlayerName(this.playerName.trim());
    }
    if (this.currentStep < 1) {
      this.currentStep++;
      this.cdr.markForCheck();
      if (this.currentStep === 1) {
        this.instructionPhase = 'typing';
        this.cdr.markForCheck();
        this.trackTimeout(() => {
          this.startInstructionAnimation();
          this.cdr.markForCheck();
        }, 200);
      }
    }
  }

  private startInstructionAnimation(): void {
    let idx = 0;
    this.displayedInstructionText = '';
    this.instructionComplete = false;
    this.cleanupSubscriptions();
    const type = (): void => {
      if (idx < this.instructionText.length) {
        this.displayedInstructionText += this.instructionText[idx++];
        let delay = BASE_TYPING_SPEED_MS * 0.7 * (0.85 + Math.random() * 0.3);
        const ch = this.instructionText[idx - 1];
        if (ch === ',') delay += 100;
        if (ch === '.') delay += 150;
        this.typingSubscription = timer(delay).subscribe(() => {
          type();
          this.cdr.markForCheck();
        });
      } else {
        this.trackTimeout(() => {
          this.instructionComplete = true;
          this.cdr.markForCheck();
          this.trackTimeout(() => {
            this.tutorialStep = 0;
            this.instructionPhase = 'controls';
            this.startTutorialAutoRotation();
            this.cdr.markForCheck();
          }, 300);
        }, 200);
      }
    };
    type();
  }

  skipInstructionAnimation(): void {
    // Only skip if animation has actually started (displayedInstructionText is non-empty)
    if (this.instructionPhase === 'typing' && !this.instructionComplete && this.displayedInstructionText.length > 0) {
      this.cleanupSubscriptions();
      this.displayedInstructionText = this.instructionText;
      this.instructionComplete = true;
      this.trackTimeout(() => {
        this.tutorialStep = 0;
        this.instructionPhase = 'controls';
        this.startTutorialAutoRotation();
        this.cdr.markForCheck();
      }, 300);
    }
  }

  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.instructionPhase = 'initial';
      this.cleanupSubscriptions();
    }
  }

  /**
   * Continue is always enabled, even with an empty name field. A blank name is
   * generated right here — GameEngineService.generatePilotName(), the same
   * fallback GameStateService.setPlayerName() uses internally — so the mission
   * briefing on the next step has a real callsign to greet instead of
   * rendering nothing. From this point on the generated name is treated
   * exactly like a typed one; save/launch/persistence downstream is unchanged.
   */
  onSubmit(): void {
    if (!this.playerName.trim()) {
      this.playerName = this.gameEngine.generatePilotName();
    }
    this.nextStep();
  }

  selectDifficulty(mode: DifficultyMode): void {
    this.difficultyService.setDifficulty(mode);
    this.selectedDifficulty = this.difficultyService.getDifficulty();
  }

  isDifficultyUnlocked(mode: DifficultyMode): boolean {
    return this.difficultyService.isUnlocked(mode);
  }

  getDifficultyRequirement(mode: DifficultyMode): string {
    return this.difficultyService.getUnlockRequirement(mode);
  }

  onPlayGame(): void {
    const name = this.playerName.trim();
    this.saveAdapter.savePlayerName(name);
    this.gameEngine.setPlayerName(name);
    this.startGame.emit(name);
  }

  onContinueGame(): void {
    this.gameEngine.setPlayerName(this.playerName);
    this.continueGame.emit();
  }

  startTutorialAutoRotation(): void {
    this.cleanupSubscriptions();
    this.tutorialTimer = interval(this.ACTIVITY_GRACE_PERIOD * 6).subscribe(() => {
      if (Date.now() - this.lastKeyActivityTime > this.ACTIVITY_GRACE_PERIOD) {
        this.nextTutorialStep();
        this.cdr.markForCheck();
      }
    });
  }

  nextTutorialStep(): void {
    this.tutorialStep = (this.tutorialStep + 1) % 3;
  }

  prevTutorialStep(): void {
    this.tutorialStep = (this.tutorialStep + 3 - 1) % 3;
  }

  setTutorialStep(step: number): void {
    this.tutorialStep = step;
    this.lastKeyActivityTime = Date.now();
    this.startTutorialAutoRotation();
  }

  pauseTutorialRotation(): void {
    this.tutorialTimer?.unsubscribe();
  }

  resumeTutorialRotation(): void {
    this.startTutorialAutoRotation();
  }

  @HostListener('window:click', ['$event'])
  onClick(event: Event): void {
    const t = event.target as HTMLElement;
    if (
      t.tagName === 'BUTTON' ||
      t.tagName === 'INPUT' ||
      t.closest('button') ||
      t.closest('.action-buttons') ||
      t.closest('.step-dot') ||
      t.closest('.tutorial-arrow') ||
      t.closest('.key')
    )
      return;

    if (this.currentStep === 0 && !this.typingComplete) {
      this.skipWelcomeAnimation();
    } else if (this.currentStep === 1 && this.instructionPhase === 'typing' && !this.instructionComplete) {
      this.skipInstructionAnimation();
    }
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: Event): void {
    if (this.currentStep !== 1 || this.instructionPhase !== 'controls') return;
    if (!(event instanceof KeyboardEvent)) return;
    event.preventDefault();

    const key = event.key.toLowerCase();
    const mapKey = (k: string): boolean => (this.activeKeys[k] = true);

    // movement pair map
    const movementPairs: Record<string, string> = {
      w: 'arrowup',
      arrowup: 'w',
      a: 'arrowleft',
      arrowleft: 'a',
      s: 'arrowdown',
      arrowdown: 's',
      d: 'arrowright',
      arrowright: 'd',
    };

    // collect all keys we light up this tick
    const toClear: string[] = [];

    switch (this.tutorialStep) {
      case 0:
        if (movementPairs[key]) {
          mapKey(key);
          mapKey(movementPairs[key]);
          toClear.push(key, movementPairs[key]);

          // Promote the pressed key's set to foreground (debounced)
          const pressedSet = ['w', 'a', 's', 'd'].includes(key) ? 'wasd' : 'arrows';
          if (pressedSet !== this.activeKeySet && !this.keySetSwitchTimeout) {
            this.keySetSwitchTimeout = setTimeout(() => {
              this.activeKeySet = pressedSet;
              this.keySetSwitchTimeout = null;
              this.cdr.markForCheck();
            }, this.KEY_SET_DEBOUNCE_MS);
          }
        }
        break;
      case 1:
        if (key === 'shift') {
          mapKey('shift');
          toClear.push('shift');
        } else if (key === ' ') {
          mapKey('space');
          toClear.push('space');
        } else if (key === 'e') {
          mapKey('e');
          toClear.push('e');
        }
        break;
      case 2:
        if (key === 'escape' || key === 'm') {
          const primary = key === 'escape' ? 'escape' : 'm';
          mapKey(primary);
          toClear.push(primary);
        }
        break;
    }

    if (toClear.length) {
      this.pauseTutorialRotation();
      this.lastKeyActivityTime = Date.now();
      this.cdr.markForCheck();
      this.trackTimeout(() => {
        toClear.forEach((k) => (this.activeKeys[k] = false));
        this.resumeTutorialRotation();
        this.cdr.markForCheck();
      }, this.ACTIVITY_GRACE_PERIOD);
    }
  }

  @HostListener('window:mousedown', ['$event'])
  onMouseDown(event: Event): void {
    if (this.currentStep !== 1 || this.instructionPhase !== 'controls' || this.tutorialStep !== 1) return;
    if (!(event instanceof MouseEvent)) return;
    const btn = event.button === 0 ? 'left' : event.button === 2 ? 'right' : null;
    if (btn) {
      this.activeMouseButtons[btn] = true;
      this.pauseTutorialRotation();
      this.lastKeyActivityTime = Date.now();
      this.cdr.markForCheck();
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onMouseUp(event: Event): void {
    if (!(event instanceof MouseEvent)) return;
    const btn = event.button === 0 ? 'left' : event.button === 2 ? 'right' : null;
    if (btn) {
      this.activeMouseButtons[btn] = false;
      this.resumeTutorialRotation();
      this.cdr.markForCheck();
    }
  }

  isKeyHighlighted(key: string): boolean {
    return !!this.activeKeys[key.toLowerCase()];
  }

  isMouseButtonHighlighted(button: string): boolean {
    return !!this.activeMouseButtons[button];
  }

  @HostListener('window:resize')
  onResize(): void {
    this.generateStarField();
  }

  private generateStarField(): void {
    const dim = Math.max(window.innerWidth, window.innerHeight);
    let count = Math.round(8 * 1.15);
    if (dim >= 768) count = Math.round(12 * 1.15);
    if (dim >= 1024) count = Math.round(16 * 1.15);
    if (dim >= 1440) count = Math.round(20 * 1.15);

    this.stars = Array.from({ length: count }, () => this.createStar());
  }

  private createStar(): Star {
    const base = 0.15 + Math.random() * 0.15;
    const opacity = 0.4 + Math.random() * 0.3;
    return {
      top: `${Math.random() * 100}%`,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 5}s`,
      duration: `${4 + Math.random() * 4}s`,
      size: `${base}rem`,
      opacity,
      kind: 'star',
    };
  }

  private shuffleStars(): void {
    const starIndices = this.stars
      .map((s, idx) => ({ s, idx }))
      .filter((o) => !o.s.isAsteroid)
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.ceil(this.stars.length * 0.3));
    starIndices.forEach((o) => (this.stars[o.idx] = this.createStar()));
  }

  private spawnAsteroid(): void {
    // purely spawn plain asteroids now
    this.spawnPlain();
  }

  /** Spawn a wandering asteroid that travels across a single axis */
  private spawnPlain(): void {
    // Choose a random starting edge and random angle (not straight h/v)
    const startEdge = Math.random();
    let top: number;
    let left: number;
    if (startEdge < 0.25) {
      // left edge
      left = 0;
      top = Math.random() * 100;
    } else if (startEdge < 0.5) {
      // right edge
      left = 100;
      top = Math.random() * 100;
    } else if (startEdge < 0.75) {
      // top edge
      top = 0;
      left = Math.random() * 100;
    } else {
      // bottom edge
      top = 100;
      left = Math.random() * 100;
    }

    const angle = randRange(-30, 30) + (startEdge < 0.5 ? 0 : 180); // bias toward screen centre-ish
    const dist = 150; // vw/h approximated travel
    const dx = `${Math.cos((angle * Math.PI) / 180) * dist}vw`;
    const dy = `${Math.sin((angle * Math.PI) / 180) * dist}vh`;

    const duration = randRange(ASTEROID_BASE_MIN, ASTEROID_BASE_MAX);
    const asteroid: Star = {
      top: `${top}%`,
      left: `${left}%`,
      delay: '0s',
      duration: `${duration}s`,
      isAsteroid: true,
      kind: 'asteroid',
      dx,
      dy,
    };
    this.stars.push(asteroid);

    const expireSub = timer(duration * 1000).subscribe(() => {
      const idx = this.stars.indexOf(asteroid);
      if (idx !== -1) this.stars.splice(idx, 1);
      this.disposableSubs.delete(expireSub);
    });
    this.disposableSubs.add(expireSub);
  }

  /** Fun saucer visitor every minute */
  private spawnSaucer(): void {
    const top = `${randRange(20, 80)}%`;
    const left = '-10%';
    const duration = 12; // seconds
    const saucer: Star = {
      top,
      left,
      delay: '0s',
      duration: `${duration}s`,
      kind: 'saucer',
    };
    this.stars.push(saucer);

    const cleanSub = timer(duration * 1000).subscribe(() => {
      const idx = this.stars.indexOf(saucer);
      if (idx !== -1) this.stars.splice(idx, 1);
      this.disposableSubs.delete(cleanSub);
    });
    this.disposableSubs.add(cleanSub);
  }

  /** Schedules next random impact */
  private scheduleNextImpact(): void {
    const delay = randRange(25, 45) * 1000;
    this.impactTimerSub = timer(delay).subscribe(() => {
      this.spawnRandomImpact();
      this.scheduleNextImpact();
    });
    this.disposableSubs.add(this.impactTimerSub);
  }

  private spawnRandomImpact(): void {
    const x = randRange(20, 80);
    const y = randRange(20, 80);

    const flash: Star = { top: `${y}%`, left: `${x}%`, delay: '0s', duration: '0.4s', kind: 'flash' };
    const pieces: Star[] = Array.from({ length: 4 }).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 15 + Math.random() * 20;
      return {
        top: `${y}%`,
        left: `${x}%`,
        delay: '0s',
        duration: '1s',
        kind: 'debris',
        dx: `${Math.cos(angle) * dist}vw`,
        dy: `${Math.sin(angle) * dist}vh`,
        size: '0.12rem',
        opacity: 0.8,
      };
    });
    this.stars.push(flash, ...pieces);

    const cleanSub = timer(1500).subscribe(() => {
      [flash, ...pieces].forEach((p) => {
        const idx = this.stars.indexOf(p);
        if (idx !== -1) this.stars.splice(idx, 1);
      });
      this.disposableSubs.delete(cleanSub);
    });
    this.disposableSubs.add(cleanSub);
  }

  private spawnShootingStar(): void {
    const shootingStar: Star = {
      top: `${Math.random() * 80 + 10}%`,
      left: '100%',
      delay: '0s',
      duration: '2s',
      size: '0.2rem',
      opacity: 0.9,
      direction: 'h', // CSS will use this for the shooting animation
      kind: 'star',
    };

    this.stars.push(shootingStar);

    // Remove it shortly after its animation completes (2 s + small buffer)
    const cleanupSub = timer(2500).subscribe(() => {
      const idx = this.stars.indexOf(shootingStar);
      if (idx !== -1) this.stars.splice(idx, 1);
      this.disposableSubs.delete(cleanupSub);
    });
    this.disposableSubs.add(cleanupSub);
  }
}
