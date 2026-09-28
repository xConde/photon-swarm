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
import { TreasureCacheSystemService, ZoneConfigService } from '../../core/systems/world';
import { ZONE_COMPLETION_REWARDS } from '@photon/config/constants/world/zone.config';
import { ZONE_Z_INDEX } from '../zone-z-index.constants';

/**
 * Zone clear celebration banner.
 *
 * Occupies slot-primary-center (30%) — the same vertical slot as zone-announcement.
 * Only one fires at a time (zone-complete triggers on clear, not on entry).
 *
 * Z-index: ZONE_Z_INDEX.ZONE_COMPLETE (120), highest zone tier.
 */
@Component({
  selector: 'app-zone-complete',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="zone-complete" [class.fading]="fading()">
        <div class="title">Zone Cleared</div>
        <div class="zone-name" [style.color]="zoneColor()">{{ zoneName() }}</div>
        <div class="reward">{{ rewardText() }}</div>
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

      // Slot primary-center — same vertical anchor as zone-announcement (30%).
      .zone-complete {
        position: absolute;
        top: 30%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        opacity: 1;
        transition: opacity ds.$animation-slow ease-out;
      }

      .zone-complete.fading {
        opacity: 0;
      }

      // "Zone Cleared" label — ascension-gold, mixed case per canonical header pattern.
      .title {
        font-family: ds.$font-mono;
        font-size: ds.$text-base;
        font-weight: ds.$weight-semibold;
        color: var(--game-ascension-gold, #f59e0b);
        text-transform: uppercase;
        letter-spacing: ds.$tracking-wider;
        margin-bottom: ds.$spacing-micro;
      }

      // Zone name: display text, zone theme colour via [style.color].
      .zone-name {
        font-family: ds.$font-mono;
        font-size: ds.$text-display;
        font-weight: ds.$weight-bold;
        text-transform: uppercase;
        letter-spacing: 0.3em;
        text-shadow: var(--game-text-glow);
        margin-bottom: ds.$spacing-tight;
      }

      // Reward text: gold accent, small.
      .reward {
        font-family: ds.$font-mono;
        font-size: ds.$text-small;
        color: var(--game-ascension-gold, #f59e0b);
        letter-spacing: 0.1em;
      }

      // Day mode — tokens handle colour; text-glow is suppressed automatically.
      :host-context(.day-mode) {
        .title,
        .reward {
          color: var(--game-ascension-gold, #b8860b);
        }
      }
    `,
  ],
})
export class ZoneCompleteComponent {
  /** Single source of truth for the host z-index — see zone-z-index.constants.ts */
  @HostBinding('style.zIndex') readonly zIndex = ZONE_Z_INDEX.ZONE_COMPLETE;

  private readonly treasureCacheSystem = inject(TreasureCacheSystemService);
  private readonly zoneConfigService = inject(ZoneConfigService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly visible = signal(false);
  readonly fading = signal(false);
  readonly zoneName = signal('');
  readonly zoneColor = signal('');
  readonly rewardText = signal('');

  private fadeTimerId: ReturnType<typeof setTimeout> | null = null;
  private hideTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.treasureCacheSystem.zoneCompleted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ zoneId }) => {
      const zone = this.zoneConfigService.getZoneById(zoneId);
      if (zone === null) {
        return;
      }

      // Cancel any pending timers from a previous celebration
      this.clearTimers();

      const reward = ZONE_COMPLETION_REWARDS[zoneId];
      const text = reward ? reward.label : '';

      this.zoneName.set(zone.name);
      this.zoneColor.set(zone.accentColor);
      this.rewardText.set(text);
      this.visible.set(true);
      this.fading.set(false);
      this.cdr.detectChanges();

      this.fadeTimerId = setTimeout(() => {
        this.fading.set(true);
        this.cdr.detectChanges();
      }, 3600);

      this.hideTimerId = setTimeout(() => {
        this.visible.set(false);
        this.fading.set(false);
        this.cdr.detectChanges();
      }, 4000);
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
