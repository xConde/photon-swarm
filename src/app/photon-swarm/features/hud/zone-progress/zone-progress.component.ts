import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  HostBinding,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TreasureCacheSystemService, ZoneConfigService, ZoneStateService } from '../../../core/systems/world';
import { GUARDIAN_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { ZoneId } from '../../../core/models/zone.model';
import { ZONE_Z_INDEX } from '../../zone-z-index.constants';

@Component({
  selector: 'app-zone-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section
        class="zone-progress"
        [style.--zone-color]="zoneColor()"
        [attr.aria-label]="'Current sector: ' + zoneName() + ', ' + threatLabel() + ' threat'"
      >
        <div class="zone-heading">
          <span class="zone-eyebrow">
            <span class="zone-eyebrow-full">Current sector</span>
            <span class="zone-eyebrow-compact">Sector</span>
          </span>
          <span class="zone-threat">{{ threatLabel() }}</span>
        </div>
        <h2 class="zone-name">{{ zoneName() }}</h2>

        <div class="clearance-row">
          <span>Zone clearance</span>
          <strong>{{ clearanceDone() }} / {{ clearanceTotal() }}</strong>
        </div>
        <div class="clearance-track" aria-hidden="true">
          <span [style.width.%]="clearancePct()"></span>
        </div>

        <div class="zone-breakdown">
          <span>Caches {{ cachesOpened() }}/{{ cachesTotal() }}</span>
          @if (guardiansTotal() > 0) {
            <span>Guardians {{ guardiansSlain() }}/{{ guardiansTotal() }}</span>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        top: calc(22px + clamp(120px, 18vw, 180px) + 8px);
        right: 8px;
        width: 176px;
        max-width: calc(100vw - 16px);
        pointer-events: none;
      }

      .zone-progress {
        box-sizing: border-box;
        padding: 8px 9px 9px;
        background: var(--game-bg-overlay);
        backdrop-filter: blur(var(--game-blur-panel, 6px));
        border: 1px solid color-mix(in srgb, var(--zone-color) 42%, transparent);
        border-top: 2px solid color-mix(in srgb, var(--zone-color) 78%, transparent);
        border-radius: 4px;
        color: var(--game-text-primary);
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace;
      }

      .zone-heading,
      .clearance-row,
      .zone-breakdown {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .zone-heading {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.12em;
        line-height: 1;
        text-transform: uppercase;
      }

      .zone-eyebrow {
        color: var(--game-text-muted);
      }

      .zone-eyebrow-compact {
        display: none;
      }

      .zone-threat {
        color: var(--zone-color);
      }

      .zone-name {
        margin: 5px 0 8px;
        overflow: hidden;
        color: var(--zone-color);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.055em;
        line-height: 1.2;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .clearance-row {
        color: var(--game-text-muted);
        font-size: 10px;
        text-transform: uppercase;
      }

      .clearance-row strong {
        color: var(--game-text-primary);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }

      .clearance-track {
        height: 4px;
        margin-top: 4px;
        overflow: hidden;
        border-radius: 2px;
        background: color-mix(in srgb, var(--game-text-primary) 12%, transparent);
      }

      .clearance-track span {
        display: block;
        height: 100%;
        background: var(--zone-color);
        transition: width 0.35s ease-out;
      }

      .zone-breakdown {
        margin-top: 7px;
        color: var(--game-text-muted);
        font-size: 9px;
        letter-spacing: 0.025em;
        text-transform: uppercase;
      }

      @media (max-width: 768px) {
        :host {
          top: calc(
            22px + var(--game-minimap-size-tablet-sm, clamp(84px, 13vw, 104px)) + var(--game-mobile-hud-gap, 6px)
          );
          right: 6px;
          width: var(--game-mobile-sector-width-tablet, 148px);
        }

        .zone-progress {
          min-height: var(--game-mobile-hud-row-height, 64px);
          padding: 6px 7px 7px;
        }

        .zone-heading {
          font-size: 8px;
          letter-spacing: 0.08em;
        }

        .zone-eyebrow-full {
          display: none;
        }

        .zone-eyebrow-compact {
          display: inline;
        }

        .zone-name {
          margin-block: 4px 6px;
          font-size: 11px;
        }

        .zone-breakdown {
          display: none;
        }
      }

      @media (max-width: 480px) {
        :host {
          top: calc(
            22px + var(--game-minimap-size-phone, clamp(80px, 21.5vw, 120px)) + var(--game-mobile-hud-gap, 6px)
          );
          width: var(--game-mobile-sector-width-phone, 140px);
        }
      }
    `,
  ],
})
export class ZoneProgressComponent {
  @HostBinding('style.zIndex') readonly zIndex = ZONE_Z_INDEX.ZONE_PROGRESS;

  private readonly zoneStateService = inject(ZoneStateService);
  private readonly zoneConfigService = inject(ZoneConfigService);
  private readonly treasureCacheSystem = inject(TreasureCacheSystemService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly guardiansPerZone = new Map<ZoneId, number>();

  readonly zoneName = signal('');
  readonly zoneColor = signal('var(--game-accent)');
  readonly zoneDifficulty = signal<number | null>(null);
  readonly cacheProgress = signal<{ total: number; opened: number }>({ total: 0, opened: 0 });
  readonly visible = signal(false);
  readonly currentZoneId = signal<ZoneId | null>(null);
  readonly guardiansSlain = signal(0);
  readonly guardiansTotal = signal(0);

  readonly cachesOpened = computed(() => this.cacheProgress().opened);
  readonly cachesTotal = computed(() => this.cacheProgress().total);
  readonly clearanceDone = computed(() => this.cachesOpened() + this.guardiansSlain());
  readonly clearanceTotal = computed(() => this.cachesTotal() + this.guardiansTotal());
  readonly clearancePct = computed(() => {
    const total = this.clearanceTotal();
    return total > 0 ? (this.clearanceDone() / total) * 100 : 0;
  });
  readonly threatLabel = computed(() => {
    const difficulty = this.zoneDifficulty() ?? 1;
    if (difficulty <= 1.05) return 'Standard';
    if (difficulty <= 1.25) return 'Elevated';
    if (difficulty <= 1.5) return 'Severe';
    return 'Extreme';
  });

  constructor() {
    for (const definition of GUARDIAN_DEFINITIONS) {
      const zoneId = definition.zoneId;
      this.guardiansPerZone.set(zoneId, (this.guardiansPerZone.get(zoneId) ?? 0) + 1);
    }

    this.zoneStateService.zoneChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event.to === null || !this.loadZone(event.to)) {
        this.currentZoneId.set(null);
        this.visible.set(false);
        this.zoneDifficulty.set(null);
      }
      this.cdr.detectChanges();
    });

    this.treasureCacheSystem.cacheOpened$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (this.zoneStateService.getCurrentZoneId() === event.zoneId) {
        this.refreshCacheProgress(event.zoneId);
        this.cdr.detectChanges();
      }
    });

    this.zoneStateService.guardianSlain$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (this.zoneStateService.getCurrentZoneId() === event.zoneId) {
        this.refreshGuardianCounts(event.zoneId);
        this.cdr.detectChanges();
      }
    });
  }

  refresh(): void {
    const zoneId = this.zoneStateService.getCurrentZoneId();
    if (zoneId === null || !this.loadZone(zoneId)) {
      this.currentZoneId.set(null);
      this.visible.set(false);
    }
    this.cdr.detectChanges();
  }

  private loadZone(zoneId: ZoneId): boolean {
    const zone = this.zoneConfigService.getZoneById(zoneId);
    if (zone === null) return false;

    this.currentZoneId.set(zoneId);
    this.zoneName.set(zone.name);
    this.zoneColor.set(zone.themeColor);
    this.zoneDifficulty.set(zone.difficultyMultiplier);
    this.refreshCacheProgress(zoneId);
    this.refreshGuardianCounts(zoneId);
    this.visible.set(true);
    return true;
  }

  private refreshCacheProgress(zoneId: ZoneId): void {
    this.cacheProgress.set({
      total: this.treasureCacheSystem.getTotalCacheCount(zoneId),
      opened: this.treasureCacheSystem.getOpenedCacheCount(zoneId),
    });
  }

  private refreshGuardianCounts(zoneId: ZoneId): void {
    this.guardiansTotal.set(this.guardiansPerZone.get(zoneId) ?? 0);
    this.guardiansSlain.set(this.zoneStateService.getZoneState(zoneId)?.guardiansSlain ?? 0);
  }
}
