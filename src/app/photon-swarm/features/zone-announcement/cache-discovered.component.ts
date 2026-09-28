import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostBinding,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TreasureCacheSystemService } from '../../core/systems/world/treasure-cache-system.service';
import { ZONE_Z_INDEX } from '../zone-z-index.constants';

/**
 * Cache discovered notification — compact inline row shown when the player
 * finds a treasure cache.
 *
 * Slot system:
 *   slot-tertiary-center (55%) — below locked warning (38%), bottom of canvas.
 *
 * Z-index: ZONE_Z_INDEX.CACHE_DISCOVERED (110).
 */
@Component({
  selector: 'app-cache-discovered',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="cache-discovered" [class.fading]="fading()">
        <div class="cache-icon">&#9674;</div>
        <div class="cache-label">Treasure Cache Found</div>
      </div>
    }
  `,
  styles: [
    `
      @use '../../styles/design-system' as ds;

      :host {
        pointer-events: none;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
      }

      // Slot tertiary-center — 55% from top, compact inline row.
      .cache-discovered {
        position: absolute;
        top: 55%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
        display: flex;
        align-items: center;
        gap: 0.4em;
        white-space: nowrap;
      }

      .cache-discovered.fading {
        opacity: 0;
      }

      // Diamond icon — ascension-gold colour, no glow at rest.
      .cache-icon {
        font-size: ds.$text-small;
        color: var(--game-ascension-gold, #f59e0b);
        line-height: ds.$leading-none;
      }

      // Label — ascension-gold, muted opacity, small mono text.
      .cache-label {
        font-family: ds.$font-mono;
        font-size: ds.$text-small;
        color: var(--game-ascension-gold, #f59e0b);
        opacity: 0.85;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      // Day mode — var(--game-ascension-gold) resolves to $light-ascension-gold.
      :host-context(.day-mode) {
        .cache-icon,
        .cache-label {
          color: var(--game-ascension-gold, #b8860b);
        }
      }
    `,
  ],
})
export class CacheDiscoveredComponent {
  /** Single source of truth for the host z-index — see zone-z-index.constants.ts */
  @HostBinding('style.zIndex') readonly zIndex = ZONE_Z_INDEX.CACHE_DISCOVERED;

  private readonly treasureCacheSystem = inject(TreasureCacheSystemService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly visible = signal(false);
  readonly fading = signal(false);

  private fadeTimerId: ReturnType<typeof setTimeout> | null = null;
  private hideTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.treasureCacheSystem.cacheDiscovered$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.clearTimers();

      this.visible.set(true);
      this.fading.set(false);
      this.cdr.detectChanges();

      // Fade starts at 1.2s, hidden at 1.5s total
      this.fadeTimerId = setTimeout(() => {
        this.fading.set(true);
        this.cdr.detectChanges();
      }, 1200);

      this.hideTimerId = setTimeout(() => {
        this.visible.set(false);
        this.fading.set(false);
        this.cdr.detectChanges();
      }, 1500);
    });

    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  private clearTimers(): void {
    if (this.fadeTimerId !== null) {
      clearTimeout(this.fadeTimerId);
      this.fadeTimerId = null;
    }
    if (this.hideTimerId !== null) {
      clearTimeout(this.hideTimerId);
      this.hideTimerId = null;
    }
  }
}
