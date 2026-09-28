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
import { ZoneConfigService, ZoneStateService } from '../../core/systems/world';
import { ZONE_Z_INDEX } from '../zone-z-index.constants';

/**
 * Zone locked warning toast — shown when the player crosses a locked boundary.
 *
 * Slot system:
 *   slot-secondary-center (38%) — below zone-entry/complete (30%), above cache row (55%).
 *
 * Z-index: ZONE_Z_INDEX.ZONE_LOCKED_WARNING (115).
 */
@Component({
  selector: 'app-zone-locked-warning',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="zone-locked-warning" [class.fading]="fading()">
        <div class="warning-icon">⚠</div>
        <div class="warning-text">Zone Locked</div>
        <div class="warning-hint" [style.color]="zoneColor()">{{ zoneName() }}</div>
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

      // Slot secondary-center — 38%, below the primary entry/complete slot (30%).
      .zone-locked-warning {
        position: absolute;
        top: 38%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
      }

      .zone-locked-warning.fading {
        opacity: 0;
      }

      // Warning icon — danger colour, no glow at rest.
      .warning-icon {
        font-size: ds.$text-display;
        color: var(--game-danger, #ff3366);
        margin-bottom: ds.$spacing-micro;
        line-height: ds.$leading-none;
      }

      // "Zone Locked" label — mixed case per canonical header pattern.
      .warning-text {
        font-family: ds.$font-mono;
        font-size: ds.$text-large;
        font-weight: ds.$weight-bold;
        color: var(--game-danger, #ff3366);
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }

      // Zone name hint — zone theme colour via [style.color], muted opacity.
      .warning-hint {
        font-family: ds.$font-mono;
        font-size: ds.$text-small;
        margin-top: ds.$spacing-micro;
        letter-spacing: 0.1em;
        opacity: 0.7;
      }

      // Day mode — var(--game-danger) resolves to $light-danger automatically.
      :host-context(.day-mode) {
        .warning-text,
        .warning-icon {
          color: var(--game-danger, #dc143c);
        }
      }
    `,
  ],
})
export class ZoneLockedWarningComponent {
  /** Single source of truth for the host z-index — see zone-z-index.constants.ts */
  @HostBinding('style.zIndex') readonly zIndex = ZONE_Z_INDEX.ZONE_LOCKED_WARNING;

  private readonly zoneStateService = inject(ZoneStateService);
  private readonly zoneConfigService = inject(ZoneConfigService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly visible = signal(false);
  readonly fading = signal(false);
  readonly zoneName = signal('');
  readonly zoneColor = signal('');

  private fadeTimerId: ReturnType<typeof setTimeout> | null = null;
  private hideTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.zoneStateService.lockedZoneEntered$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ zoneId }) => {
      const zone = this.zoneConfigService.getZoneById(zoneId);
      if (zone === null) {
        return;
      }

      this.clearTimers();

      this.zoneName.set(zone.name);
      this.zoneColor.set(zone.themeColor);
      this.visible.set(true);
      this.fading.set(false);
      this.cdr.detectChanges();

      this.fadeTimerId = setTimeout(() => {
        this.fading.set(true);
        this.cdr.detectChanges();
      }, 1800);

      this.hideTimerId = setTimeout(() => {
        this.visible.set(false);
        this.fading.set(false);
        this.cdr.detectChanges();
      }, 2100);
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
