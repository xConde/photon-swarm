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

import { ZoneConfigService, ZoneGateSystemService } from '../../../core/systems/world';
import { ZONE_Z_INDEX } from '../../zone-z-index.constants';

@Component({
  selector: 'app-zone-gate-tooltip',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="gate-tooltip">
        <div class="destination" [style.color]="destinationColor()">{{ destinationName() }}</div>
        <div class="requirement">{{ requirementText() }}</div>
        <div class="progress-bar">
          <div
            class="progress-fill"
            [style.width.%]="progressPercent()"
            [style.background-color]="destinationColor()"
          ></div>
        </div>
        <div class="progress-text">{{ progressText() }}</div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        position: absolute;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        pointer-events: none;
      }

      .gate-tooltip {
        background: var(--game-bg-overlay, rgba(0, 20, 40, 0.9));
        border: 1px solid var(--game-panel-border, rgba(0, 255, 255, 0.3));
        border-radius: 8px; /* $radius-medium */
        padding: 10px 16px;
        text-align: center;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace; /* ds.$font-mono */
        min-width: 200px;
        backdrop-filter: blur(var(--game-blur-panel, 6px));
      }

      .destination {
        font-size: 14px; /* $text-base */
        font-weight: 600; /* $weight-semibold */
        text-transform: uppercase;
        letter-spacing: 0.15em;
        margin-bottom: 4px;
      }

      .requirement {
        font-size: 11px; /* $text-micro */
        color: var(--game-text-secondary, rgba(255, 255, 255, 0.7));
        margin-bottom: 6px;
      }

      .progress-bar {
        height: 4px;
        background: color-mix(in srgb, var(--game-panel-border, rgba(0, 255, 255, 0.3)) 50%, transparent);
        border-radius: 2px;
        overflow: hidden;
        margin-bottom: 4px;
      }

      .progress-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s ease;
      }

      .progress-text {
        font-size: 10px; /* $text-xs */
        color: var(--game-text-muted, rgba(255, 255, 255, 0.5));
      }
    `,
  ],
})
export class ZoneGateTooltipComponent {
  /** Single source of truth for the host z-index — see zone-z-index.constants.ts */
  @HostBinding('style.zIndex') readonly zIndex = ZONE_Z_INDEX.ZONE_GATE_TOOLTIP;

  private readonly zoneGateSystem = inject(ZoneGateSystemService);
  private readonly zoneConfigService = inject(ZoneConfigService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly visible = signal(false);
  readonly destinationName = signal('');
  readonly destinationColor = signal('#ffffff');
  readonly requirementText = signal('');
  readonly progressText = signal('');
  readonly progressPercent = signal(0);

  constructor() {
    this.zoneGateSystem.gateProximity$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event === null) {
        this.visible.set(false);
      } else {
        const destZone = this.zoneConfigService.getZoneById(event.toZoneId);
        this.destinationName.set(destZone?.name ?? `Zone ${event.toZoneId}`);
        this.destinationColor.set(destZone?.themeColor ?? '#ffffff');
        this.requirementText.set(this.formatRequirement(event.condition, event.unlockValue));
        this.progressText.set(this.formatProgress(event.condition, event.currentProgress, event.unlockValue));
        const percent = event.unlockValue > 0 ? Math.min(100, (event.currentProgress / event.unlockValue) * 100) : 100;
        this.progressPercent.set(percent);
        this.visible.set(true);
      }
      this.cdr.markForCheck();
    });
  }

  private formatRequirement(condition: string, value: number): string {
    switch (condition) {
      case 'wave':
        return `Reach Wave ${value}`;
      case 'treasure_clear':
        return `Clear ${value} Treasure ${value === 1 ? 'Cache' : 'Caches'}`;
      case 'guardian_kill':
        return `Slay ${value} ${value === 1 ? 'Guardian' : 'Guardians'}`;
      default:
        return '';
    }
  }

  private formatProgress(condition: string, current: number, total: number): string {
    switch (condition) {
      case 'wave':
        return `Wave ${current} / ${total}`;
      case 'treasure_clear':
        return `${current} / ${total} ${total === 1 ? 'Cache' : 'Caches'} Cleared`;
      case 'guardian_kill':
        return `${current} / ${total} ${total === 1 ? 'Guardian' : 'Guardians'} Slain`;
      default:
        return `${current} / ${total}`;
    }
  }
}
