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
import { ZoneConfigService, ZoneGateSystemService, ZoneStateService } from '../../core/systems/world';
import { ZONE_Z_INDEX } from '../zone-z-index.constants';

/**
 * Zone entry banner — "ZONE NAME / subtitle" centered on canvas.
 *
 * Slot system (shared across zone-announcement/* components):
 *   slot-primary-center (30%): zone entry + zone complete — only one fires at a time
 *   slot-secondary-center (38%): zone-locked warning
 *   slot-tertiary-center (55%): cache-discovered (compact inline row)
 *
 * Z-index: ZONE_Z_INDEX.ZONE_ANNOUNCEMENT (110), below wave-announcement (600).
 */
@Component({
  selector: 'app-zone-announcement',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="zone-announcement" [class.fading]="fading()">
        <div class="zone-name" [style.color]="zoneColor()">{{ zoneName() }}</div>
        <div class="zone-subtitle">{{ zoneSubtitle() }}</div>
      </div>
    }
    @if (unlockVisible()) {
      <div class="zone-unlock" [class.fading]="unlockFading()" [style.color]="unlockColor()">
        {{ unlockText() }}
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

      // Slot primary-center — zone entry banner at 30% from top.
      .zone-announcement {
        position: absolute;
        top: 30%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
      }

      .zone-announcement.fading {
        opacity: 0;
      }

      // Zone name: display-size text, zone theme colour passed via [style.color].
      // Text-shadow uses the canonical --game-text-glow token (none in day mode).
      .zone-name {
        font-family: ds.$font-mono;
        font-size: ds.$text-display;
        font-weight: ds.$weight-bold;
        text-transform: uppercase;
        letter-spacing: 0.3em;
        text-shadow: var(--game-text-glow);
      }

      // Subtitle: secondary muted text, no glow.
      .zone-subtitle {
        font-family: ds.$font-mono;
        font-size: ds.$text-base;
        color: var(--game-text-secondary);
        margin-top: ds.$spacing-tight;
        letter-spacing: 0.15em;
      }

      // Zone unlock banner — slot below zone entry (38%), uses zone theme color inline.
      .zone-unlock {
        position: absolute;
        top: 38%;
        left: 50%;
        transform: translateX(-50%);
        text-align: center;
        font-family: ds.$font-mono;
        font-size: ds.$text-base;
        font-weight: ds.$weight-bold;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        text-shadow: var(--game-text-glow);
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
      }

      .zone-unlock.fading {
        opacity: 0;
      }

      // Day mode — theme tokens update automatically; no hardcoded overrides needed.
      :host-context(.day-mode) {
        .zone-subtitle {
          color: var(--game-text-secondary);
        }
      }
    `,
  ],
})
export class ZoneAnnouncementComponent {
  /** Single source of truth for the host z-index — see zone-z-index.constants.ts */
  @HostBinding('style.zIndex') readonly zIndex = ZONE_Z_INDEX.ZONE_ANNOUNCEMENT;

  private readonly zoneStateService = inject(ZoneStateService);
  private readonly zoneConfigService = inject(ZoneConfigService);
  private readonly zoneGateSystem = inject(ZoneGateSystemService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly visible = signal(false);
  readonly fading = signal(false);
  readonly zoneName = signal('');
  readonly zoneSubtitle = signal('');
  readonly zoneColor = signal('');

  // Zone unlock banner — "[ZONE NAME] UNLOCKED", 2s, zone theme color
  readonly unlockVisible = signal(false);
  readonly unlockFading = signal(false);
  readonly unlockText = signal('');
  readonly unlockColor = signal('');

  private fadeTimerId: ReturnType<typeof setTimeout> | null = null;
  private hideTimerId: ReturnType<typeof setTimeout> | null = null;
  private unlockFadeTimerId: ReturnType<typeof setTimeout> | null = null;
  private unlockHideTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.zoneStateService.zoneChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event.to === null) {
        return;
      }

      const zone = this.zoneConfigService.getZoneById(event.to);
      if (zone === null) {
        return;
      }

      // Cancel any pending timers from a previous announcement
      this.clearTimers();

      this.zoneName.set(zone.name);
      this.zoneSubtitle.set(zone.subtitle);
      this.zoneColor.set(zone.themeColor);
      this.visible.set(true);
      this.fading.set(false);
      this.cdr.detectChanges();

      this.fadeTimerId = setTimeout(() => {
        this.fading.set(true);
        this.cdr.detectChanges();
      }, 2500);

      this.hideTimerId = setTimeout(() => {
        this.visible.set(false);
        this.fading.set(false);
        this.cdr.detectChanges();
      }, 2800);
    });

    // B4: Zone unlock visual — show "[ZONE NAME] UNLOCKED" for 2s
    this.zoneGateSystem.zoneUnlocked$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ zoneId }) => {
      const zone = this.zoneConfigService.getZoneById(zoneId);
      if (!zone) return;

      this.clearUnlockTimers();

      this.unlockText.set(`${zone.name} UNLOCKED`);
      this.unlockColor.set(zone.themeColor);
      this.unlockFading.set(false);
      this.unlockVisible.set(true);
      this.cdr.detectChanges();

      this.unlockFadeTimerId = setTimeout(() => {
        this.unlockFading.set(true);
        this.cdr.detectChanges();
      }, 2000);

      this.unlockHideTimerId = setTimeout(() => {
        this.unlockVisible.set(false);
        this.unlockFading.set(false);
        this.cdr.detectChanges();
      }, 2300);
    });

    this.destroyRef.onDestroy(() => {
      this.clearTimers();
      this.clearUnlockTimers();
    });
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

  private clearUnlockTimers(): void {
    if (this.unlockFadeTimerId !== null) {
      clearTimeout(this.unlockFadeTimerId);
      this.unlockFadeTimerId = null;
    }
    if (this.unlockHideTimerId !== null) {
      clearTimeout(this.unlockHideTimerId);
      this.unlockHideTimerId = null;
    }
  }
}
