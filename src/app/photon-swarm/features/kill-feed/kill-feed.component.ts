import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FACTION_BRAND_COLORS } from '../../config/faction-brand.config';

interface AbsorptionPulse {
  id: number;
  edge: 'top' | 'right' | 'bottom' | 'left';
  color: string;
  opacity: number;
  timestamp: number;
}

@Component({
  selector: 'app-absorption-feed',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="absorption-container">
      @for (pulse of activePulses(); track pulse.id) {
        <div
          class="absorption-pulse"
          [attr.data-edge]="pulse.edge"
          [style.--pulse-color]="pulse.color"
          [style.--pulse-opacity]="pulse.opacity"
        ></div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        /* $z-content = 10 — canvas-layer effect, NOT a toast; sits above the game canvas but below HUD/overlays */
        z-index: 15;
        overflow: hidden;
      }

      .absorption-container {
        position: relative;
        width: 100%;
        height: 100%;
      }

      .absorption-pulse {
        position: absolute;
        opacity: var(--pulse-opacity, 0.4);
        animation: pulse-fade 400ms ease-out forwards;
      }

      /* Restrained neon: gradient-based glow only, single 8px spread — no 15px bloat */
      [data-edge='top'] {
        top: 0;
        left: 10%;
        right: 10%;
        height: 3px;
        background: linear-gradient(to bottom, var(--pulse-color, cyan), transparent);
        box-shadow: 0 0 8px 2px var(--pulse-color, cyan);
      }

      [data-edge='bottom'] {
        bottom: 0;
        left: 10%;
        right: 10%;
        height: 3px;
        background: linear-gradient(to top, var(--pulse-color, cyan), transparent);
        box-shadow: 0 0 8px 2px var(--pulse-color, cyan);
      }

      [data-edge='left'] {
        left: 0;
        top: 10%;
        bottom: 10%;
        width: 3px;
        background: linear-gradient(to right, var(--pulse-color, cyan), transparent);
        box-shadow: 0 0 8px 2px var(--pulse-color, cyan);
      }

      [data-edge='right'] {
        right: 0;
        top: 10%;
        bottom: 10%;
        width: 3px;
        background: linear-gradient(to left, var(--pulse-color, cyan), transparent);
        box-shadow: 0 0 8px 2px var(--pulse-color, cyan);
      }

      @keyframes pulse-fade {
        0% {
          opacity: var(--pulse-opacity, 0.4);
          transform: scale(1);
        }
        100% {
          opacity: 0;
          transform: scale(1);
        }
      }

      /* Day mode: pulse is already gradient-based and readable — no override needed */
    `,
  ],
})
export class KillFeedComponent implements OnInit, OnDestroy {
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly pulses = signal<AbsorptionPulse[]>([]);
  readonly activePulses = this.pulses;
  private nextId = 0;
  private edgeIndex = 0;
  private cleanupInterval: number | null = null;
  private readonly MAX_PULSES = 6;
  private readonly PULSE_LIFETIME = 400;

  // Faction colors sourced from FACTION_BRAND_COLORS (config/faction-brand.config.ts).
  // Kill-feed pulses render on the dark game canvas, so dark values are used.
  private readonly FACTION_COLORS: Record<number, string> = Object.fromEntries(
    Object.entries(FACTION_BRAND_COLORS).map(([id, colors]) => [Number(id), colors.dark])
  );

  private readonly EDGES: ('top' | 'right' | 'bottom' | 'left')[] = ['right', 'top', 'left', 'bottom'];

  ngOnInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.cleanupInterval = window.setInterval(() => {
        const before = this.pulses().length;
        this.cleanupExpiredPulses();
        if (this.pulses().length !== before) {
          this.cdr.detectChanges();
        }
      }, 200);
    });
  }

  ngOnDestroy(): void {
    if (this.cleanupInterval !== null) {
      window.clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  public addKill(_enemyType: string, factionId: number, xp: number): void {
    const color = this.FACTION_COLORS[factionId] ?? '#44ffff';
    const opacity = Math.min(0.6, 0.2 + (xp / 50) * 0.4);
    const edge = this.EDGES[this.edgeIndex % 4];
    this.edgeIndex = (this.edgeIndex + 1) % 4;

    const pulse: AbsorptionPulse = {
      id: this.nextId++,
      edge,
      color,
      opacity,
      timestamp: Date.now(),
    };

    this.pulses.update((current) => {
      const updated = [...current, pulse];
      return updated.length > this.MAX_PULSES ? updated.slice(updated.length - this.MAX_PULSES) : updated;
    });
  }

  private cleanupExpiredPulses(): void {
    const now = Date.now();
    this.pulses.update((current) => current.filter((p) => now - p.timestamp < this.PULSE_LIFETIME));
  }
}
