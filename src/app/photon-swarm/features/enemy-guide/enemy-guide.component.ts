import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { EnemyInfo, EnemyType } from '../../core/models/enemy.model';
import { ENEMY_DEFINITIONS, EnemyGuideEntry } from './enemy-definitions';
import { EnemySpriteGeneratorService } from '../../core/rendering/enemy-sprite-generator.service';
import { ControlsDisplayComponent } from '@photon/components/controls-display/controls-display.component';
import { PaletteService } from '../../services/palette.service';

/** Threat tier shown as a colour-coded meter — derived, never stored on the data. */
export interface ThreatTier {
  label: 'Low' | 'Medium' | 'High' | 'Boss';
  cls: string;
  /** Filled segments on the threat meter (1–4). */
  level: 1 | 2 | 3 | 4;
}

@Component({
  selector: 'app-enemy-guide',
  standalone: true,
  imports: [ControlsDisplayComponent],
  templateUrl: './enemy-guide.component.html',
  styleUrls: ['./enemy-guide.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnemyGuideComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() playerLevel = 1;
  @Output() close = new EventEmitter<void>();

  public unlocked: EnemyGuideEntry[] = [];
  @ViewChildren('enemyCanvas') canvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  private readonly spriteGen = inject(EnemySpriteGeneratorService);
  private readonly palette = inject(PaletteService);

  // A fixed, representative frame so animated sprites (boss, shooters) render a stable pose
  // in the static guide instead of a live-but-frozen-at-load one. The guide always uses
  // faction 1 — the roster is faction-agnostic; faction only re-tints the same silhouette.
  private static readonly GUIDE_FRAME_TIME = 1500;
  private static readonly GUIDE_FACTION_ID = 1;

  // Focus management (mirrors upgrade-modal pattern)
  private previouslyFocusedElement: HTMLElement | null = null;
  private tabTrapHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    // Filter BEFORE the first render so the @for (and its canvases) actually exist by the time
    // ngAfterViewInit draws the sprites. Assigning in ngAfterViewInit left the list empty under
    // OnPush (the view had already rendered an empty `unlocked` with no change-detection bump).
    this.unlocked = ENEMY_DEFINITIONS.filter((e) => e.minLevel <= this.playerLevel);
  }

  /**
   * Threat tier for the colour-coded chip. Durability (HP) sets the base rank, but ranged,
   * disruptive, shielded and swarm enemies punch above their HP, so they bump up a tier.
   */
  threatTier(e: EnemyInfo): ThreatTier {
    if (e.type === EnemyType.Boss || e.health >= 100) return { label: 'Boss', cls: 'threat-boss', level: 4 };
    const punchesAbove =
      e.type === EnemyType.Spitter ||
      e.type === EnemyType.Sniper ||
      e.type === EnemyType.Disruptor ||
      e.type === EnemyType.Sentinel ||
      e.type === EnemyType.Swarm;
    let rank = e.health >= 40 ? 2 : e.health >= 8 ? 1 : 0;
    if (punchesAbove && rank < 2) rank++;
    if (rank >= 2) return { label: 'High', cls: 'threat-high', level: 3 };
    return rank === 1
      ? { label: 'Medium', cls: 'threat-med', level: 2 }
      : { label: 'Low', cls: 'threat-low', level: 1 };
  }

  ngAfterViewInit(): void {
    // Render icons for each (the list is already populated from ngOnInit)
    this.canvases.forEach((canvasRef, idx) => {
      const info = this.unlocked[idx];
      if (info) this.drawIcon(canvasRef.nativeElement, info);
    });

    // Save element to restore focus to when guide closes
    this.previouslyFocusedElement = document.activeElement as HTMLElement;

    // Focus the dialog so SR announces dialog role and label immediately
    const modalWindow = this.elementRef.nativeElement.querySelector<HTMLElement>('.modal-window');
    if (modalWindow) {
      modalWindow.setAttribute('tabindex', '-1');
      modalWindow.focus();
    }

    // Tab focus trap — keeps keyboard navigation inside the enemy guide dialog
    this.tabTrapHandler = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const focusable = this.elementRef.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', this.tabTrapHandler);
  }

  ngOnDestroy(): void {
    if (this.tabTrapHandler) {
      document.removeEventListener('keydown', this.tabTrapHandler);
      this.tabTrapHandler = null;
    }
    if (this.previouslyFocusedElement?.isConnected && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }

  private drawIcon(canvas: HTMLCanvasElement, info: EnemyGuideEntry): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Draw the SAME sprite the game uses (not a flat blob) so the guide actually teaches what
    // each enemy looks like. getSprite generates on demand and reuses the live cache.
    const sprite = this.spriteGen.getSprite(
      info.type,
      EnemyGuideComponent.GUIDE_FACTION_ID,
      EnemyGuideComponent.GUIDE_FRAME_TIME,
      false,
      null,
      false
    );

    if (sprite && sprite.width > 0 && sprite.height > 0) {
      // Contain the sprite in the icon box, centred, preserving aspect.
      const pad = 6;
      const scale = Math.min((width - pad * 2) / sprite.width, (height - pad * 2) / sprite.height);
      const dw = sprite.width * scale;
      const dh = sprite.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sprite, (width - dw) / 2, (height - dh) / 2, dw, dh);
      return;
    }

    // Defensive fallback if sprite generation is unavailable. Resolve the theme
    // token from the canvas so the guide never carries a separate fixed palette.
    const r = Math.min(width, height) * 0.4;
    const cssAccent = getComputedStyle(canvas).getPropertyValue('--game-accent').trim();
    ctx.fillStyle = cssAccent || this.palette.getCanvas().ACCENT_CYAN;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
    ctx.fill();
  }

  onBackdropClick(): void {
    this.close.emit();
  }
}
