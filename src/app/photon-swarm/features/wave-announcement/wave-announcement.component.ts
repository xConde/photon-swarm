import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SpawnSystemService } from '../../core/systems/enemy-ai';
import { AudioService } from '../../core/audio/audio.service';
import { EncounterResolution, WaveType } from '../../core/models/encounter.model';

/**
 * Wave Announcement Component — minimal top-center text overlay.
 *
 * Shows "WAVE N" for normal waves, "WAVE N · SWARM", "WAVE N · ELITE",
 * or "WAVE N · BOSS" for special waves. Also shows a "NEW THREAT" banner
 * when a new enemy type unlocks at a wave milestone.
 *
 * Duration: 1.5s visible (2.5s for new threats), 300ms CSS opacity fade-out.
 *
 * Slot layout (2-slot system, never overlapping):
 *   --slot-primary: top 20px — wave number row
 *   --slot-secondary: top 48px — new-threat label + type (stacks below primary)
 */
@Component({
  selector: 'app-wave-announcement',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="wave-text" [class.fading]="fading()">
        <span class="wave-base">WAVE {{ waveNumber() }}</span>
        @if (waveType() === 'elite') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-elite">ELITE</span>
        } @else if (waveType() === 'swarm') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-swarm">SWARM</span>
        } @else if (waveType() === 'boss') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-boss">BOSS</span>
        } @else if (waveType() === 'boss_rush') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-boss-rush">BOSS RUSH</span>
        } @else if (waveType() === 'faction_invasion') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-faction-invasion">{{ factionName() }} INVASION</span>
        } @else if (waveType() === 'blackout') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-blackout">BLACKOUT</span>
        } @else if (waveType() === 'guardian_surge') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-guardian-surge">GUARDIAN SURGE</span>
        } @else if (waveType() === 'salvage_hunt') {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-salvage-hunt">SALVAGE HUNT</span>
        } @else if (encounterTitle()) {
          <span class="wave-separator"> · </span>
          <span class="wave-modifier wave-encounter">{{ encounterTitle() }}</span>
        }
      </div>
    }
    @if (isNewThreat()) {
      <div class="new-threat-text" [class.fading]="threatFading()">
        <span class="new-threat-label">NEW THREAT</span>
        <span class="threat-type">{{ threatType() }}</span>
      </div>
    }
    @if (isEventResolved()) {
      <div class="event-resolved-text" [class.fading]="eventResolvedFading()">
        {{ eventResolvedText() }}
      </div>
    }
  `,
  styles: [
    `
      @use '../../styles/design-system' as ds;

      // -----------------------------------------------------------------------
      // Slot layout — two fixed vertical positions so simultaneous toasts
      // can coexist without overlapping.
      //   --slot-primary:    20px — wave number row
      //   --slot-secondary:  48px — new-threat rows (label + type text)
      // -----------------------------------------------------------------------
      :host {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: ds.$z-hud-announcement;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
      }

      // -----------------------------------------------------------------------
      // Wave row — slot primary (top: 20px)
      // -----------------------------------------------------------------------
      .wave-text {
        position: absolute;
        top: 20px;
        left: 0;
        right: 0;
        text-align: center;
        font-family: ds.$font-mono;
        font-size: ds.$text-small;
        font-weight: ds.$weight-bold;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--game-text-primary, #ffffff);
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
      }

      .wave-text.fading {
        opacity: 0;
      }

      .wave-separator {
        color: var(--game-text-muted, rgba(255, 255, 255, 0.5));
      }

      // Wave modifier tokens — each uses the canonical game token
      .wave-elite {
        color: var(--game-wave-elite, #a855f7);
      }

      .wave-swarm {
        color: var(--game-wave-swarm, #fb923c);
      }

      .wave-boss {
        color: var(--game-danger, #ff3366);
        text-shadow: var(--game-text-glow, 0 0 10px currentColor);
      }

      .wave-boss-rush {
        color: var(--game-special, #ff44ff);
        text-shadow: var(--game-text-glow, 0 0 10px currentColor);
      }

      .wave-faction-invasion {
        color: var(--game-warning, #ffcc00);
        text-shadow: var(--game-text-glow, 0 0 10px currentColor);
      }

      .wave-blackout {
        color: var(--game-wave-elite, #a855f7);
      }

      .wave-guardian-surge {
        color: var(--game-ascension-gold, #f59e0b);
        text-shadow: var(--game-text-glow, 0 0 10px currentColor);
      }

      .wave-salvage-hunt,
      .wave-encounter {
        color: var(--game-primary, #24e8ff);
      }

      // -----------------------------------------------------------------------
      // New threat rows — slot secondary (top: 48px, below wave row)
      // -----------------------------------------------------------------------
      .new-threat-text {
        position: absolute;
        top: 48px;
        left: 0;
        right: 0;
        text-align: center;
        font-family: ds.$font-mono;
        font-weight: ds.$weight-bold;
        letter-spacing: 0.12em;
        display: flex;
        flex-direction: column;
        align-items: center;
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
      }

      .new-threat-text.fading {
        opacity: 0;
      }

      .new-threat-label {
        font-size: ds.$text-xs;
        color: var(--game-danger, #ff3366);
        text-shadow: var(--game-text-glow, 0 0 10px currentColor);
        letter-spacing: 0.2em;
      }

      .threat-type {
        /* Responsive — scales up on wider canvases for visual impact */
        font-size: clamp(1rem, 2vw, 2rem);
        text-transform: uppercase;
        letter-spacing: 0.2em;
        color: var(--game-danger, #ff3366);
        text-shadow: var(--game-text-glow, 0 0 10px currentColor);
      }

      // -----------------------------------------------------------------------
      // Event resolved banner — slot tertiary (top: 76px, below new-threat).
      // Muted style: no glow, subdued colour so it doesn't compete with
      // active wave announcements.
      // -----------------------------------------------------------------------
      .event-resolved-text {
        position: absolute;
        top: 76px;
        left: 0;
        right: 0;
        text-align: center;
        font-family: ds.$font-mono;
        font-size: ds.$text-xs;
        font-weight: ds.$weight-bold;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--game-text-muted, rgba(255, 255, 255, 0.45));
        opacity: 1;
        transition: opacity ds.$animation-standard ease-out;
      }

      .event-resolved-text.fading {
        opacity: 0;
      }

      // On narrow canvases the persistent HUD becomes a two-column tactical
      // rail beneath the minimap. Transient wave/threat copy starts below that
      // rail instead of crossing the vitals and radar at the top edge.
      @media (max-width: 768px) {
        .wave-text,
        .new-threat-text,
        .event-resolved-text {
          box-sizing: border-box;
          padding-inline: 8px;
        }

        .wave-text {
          top: calc(
            22px + var(--game-minimap-size-tablet-sm, #{ds.$minimap-size-tablet-sm}) +
              var(--game-mobile-hud-gap, #{ds.$mobile-hud-gap}) +
              var(--game-mobile-hud-row-height, #{ds.$mobile-hud-row-height}) + 8px
          );
          font-size: 10px;
        }

        .new-threat-text {
          top: calc(
            22px + var(--game-minimap-size-tablet-sm, #{ds.$minimap-size-tablet-sm}) +
              var(--game-mobile-hud-gap, #{ds.$mobile-hud-gap}) +
              var(--game-mobile-hud-row-height, #{ds.$mobile-hud-row-height}) + 28px
          );
        }

        .event-resolved-text {
          top: calc(
            22px + var(--game-minimap-size-tablet-sm, #{ds.$minimap-size-tablet-sm}) +
              var(--game-mobile-hud-gap, #{ds.$mobile-hud-gap}) +
              var(--game-mobile-hud-row-height, #{ds.$mobile-hud-row-height}) + 56px
          );
        }
      }

      @media (max-width: 480px) {
        .wave-text {
          top: calc(
            22px + var(--game-minimap-size-phone, #{ds.$minimap-size-phone}) +
              var(--game-mobile-hud-gap, #{ds.$mobile-hud-gap}) +
              var(--game-mobile-hud-row-height, #{ds.$mobile-hud-row-height}) + 8px
          );
        }

        .new-threat-text {
          top: calc(
            22px + var(--game-minimap-size-phone, #{ds.$minimap-size-phone}) +
              var(--game-mobile-hud-gap, #{ds.$mobile-hud-gap}) +
              var(--game-mobile-hud-row-height, #{ds.$mobile-hud-row-height}) + 28px
          );
        }

        .event-resolved-text {
          top: calc(
            22px + var(--game-minimap-size-phone, #{ds.$minimap-size-phone}) +
              var(--game-mobile-hud-gap, #{ds.$mobile-hud-gap}) +
              var(--game-mobile-hud-row-height, #{ds.$mobile-hud-row-height}) + 56px
          );
        }
      }

      // -----------------------------------------------------------------------
      // Day mode — glows are suppressed via --game-text-glow: none,
      // colour swaps handled automatically by var(--game-*) tokens.
      // Wave text lightens against the slate background.
      // -----------------------------------------------------------------------
      :host-context(.day-mode) {
        .wave-text {
          color: var(--game-text-primary);
          text-shadow: 0 1px 2px rgba(255, 255, 255, 0.4);
        }

        .wave-separator {
          color: var(--game-text-muted);
        }

        // Boss/boss-rush/faction carry text-shadow: var(--game-text-glow)
        // which resolves to 'none' in day-mode — no per-class override needed.
      }
    `,
  ],
})
export class WaveAnnouncementComponent implements OnInit, OnDestroy {
  readonly visible = signal(false);
  readonly fading = signal(false);
  readonly waveNumber = signal(0);
  readonly waveType = signal<WaveType>('normal');
  protected readonly encounterTitle = signal('');
  protected readonly factionName = signal('');

  protected readonly isNewThreat = signal(false);
  protected readonly threatFading = signal(false);
  protected readonly threatType = signal('');

  // Event-resolved banner (faction_invasion → "INVASION REPELLED", etc.)
  protected readonly isEventResolved = signal(false);
  protected readonly eventResolvedFading = signal(false);
  protected readonly eventResolvedText = signal('');

  private readonly destroyRef = inject(DestroyRef);
  private readonly spawnSystem = inject(SpawnSystemService);
  private readonly audio = inject(AudioService);

  private dismissTimeout: number | null = null;
  private fadeTimeout: number | null = null;
  private threatDismissTimeout: number | null = null;
  private threatFadeTimeout: number | null = null;
  private resolvedDismissTimeout: number | null = null;
  private resolvedFadeTimeout: number | null = null;

  /** FIFO queue for event-resolved messages. Max 2 queued; oldest is dropped on overflow. */
  private resolvedQueue: string[] = [];

  private readonly SHOW_MS = 1500;
  private readonly FADE_MS = 300;
  private readonly THREAT_SHOW_MS = 2500;
  private readonly RESOLVED_SHOW_MS = 1000;

  private static readonly EVENT_RESOLVED_LABELS: Record<string, string> = {
    faction_invasion: 'INVASION REPELLED',
    guardian_surge: 'SURGE CLEARED',
    blackout: 'BLACKOUT LIFTED',
    boss_rush: 'BOSS RUSH SURVIVED',
    salvage_hunt: 'SALVAGE SECURED',
  };

  private static readonly EVENT_FAILED_LABELS: Record<string, string> = {
    faction_invasion: 'INVASION ENTRENCHED',
    guardian_surge: 'SURGE OVERRAN SECTOR',
    blackout: 'BLACKOUT ENDURED',
    boss_rush: 'BOSS RUSH ESCAPED',
    salvage_hunt: 'SALVAGE LOST',
  };

  ngOnInit(): void {
    this.spawnSystem.waveStarted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      this.show(event.waveNumber, event.waveType, event.factionName, event.encounterTitle);
    });

    this.spawnSystem.newThreatUnlocked$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ type }) => {
      this.showNewThreat(type);
    });

    // B1: Wave warning audio cue (~3s before each wave)
    this.spawnSystem.waveWarning$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.audio.playWaveWarning();
    });

    // Every authored directive gets a completion beat. Reading the objective's
    // resolution stream also lets the banner state whether its promised reward
    // was actually committed, instead of inferring success from a wave event.
    this.spawnSystem.encounterObjectives.resolved$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((resolution) => this.showEventResolved(this.getResolutionLabel(resolution)));

    // B8: Sector alert (wave 8 gate activation notice)
    this.spawnSystem.sectorAlert$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(({ message }) => {
      this.showEventResolved(message);
    });
  }

  ngOnDestroy(): void {
    this.clearTimers();
    this.clearThreatTimers();
    this.clearResolvedTimers();
    this.resolvedQueue = [];
  }

  private show(waveNum: number, type: WaveType, faction?: string, encounterTitle?: string): void {
    this.clearTimers();

    this.waveNumber.set(waveNum);
    this.waveType.set(type);
    this.factionName.set(faction ?? '');
    this.encounterTitle.set(encounterTitle ?? '');
    this.fading.set(false);
    this.visible.set(true);

    this.dismissTimeout = window.setTimeout(() => {
      this.fading.set(true);
      this.fadeTimeout = window.setTimeout(() => {
        this.visible.set(false);
        this.fading.set(false);
      }, this.FADE_MS);
    }, this.SHOW_MS);
  }

  private showNewThreat(type: string): void {
    this.clearThreatTimers();

    const displayName = type ? type.charAt(0).toUpperCase() + type.slice(1) : type;
    this.threatType.set(displayName);
    this.threatFading.set(false);
    this.isNewThreat.set(true);

    this.threatDismissTimeout = window.setTimeout(() => {
      this.threatFading.set(true);
      this.threatFadeTimeout = window.setTimeout(() => {
        this.isNewThreat.set(false);
        this.threatFading.set(false);
      }, this.FADE_MS);
    }, this.THREAT_SHOW_MS);
  }

  private getResolutionLabel(resolution: EncounterResolution): string {
    const eventLabels = resolution.success
      ? WaveAnnouncementComponent.EVENT_RESOLVED_LABELS
      : WaveAnnouncementComponent.EVENT_FAILED_LABELS;
    const label = eventLabels[resolution.type] ?? `${resolution.title} ${resolution.success ? 'CLEARED' : 'FAILED'}`;
    const normalizedLabel = label.toUpperCase();
    if (!resolution.rewardGranted) return normalizedLabel;
    return `${normalizedLabel} · +${resolution.reward.shards} SHARDS · +${resolution.reward.xp} XP`;
  }

  private clearTimers(): void {
    if (this.dismissTimeout !== null) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }
    if (this.fadeTimeout !== null) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }
  }

  private clearThreatTimers(): void {
    if (this.threatDismissTimeout !== null) {
      clearTimeout(this.threatDismissTimeout);
      this.threatDismissTimeout = null;
    }
    if (this.threatFadeTimeout !== null) {
      clearTimeout(this.threatFadeTimeout);
      this.threatFadeTimeout = null;
    }
  }

  private showEventResolved(label: string): void {
    // If a resolved banner is already visible, queue the incoming message
    // (max 2 queued; drop the oldest on overflow so the queue never grows unbounded).
    if (this.isEventResolved()) {
      if (this.resolvedQueue.length >= 2) {
        this.resolvedQueue.shift(); // drop oldest overflow entry
      }
      this.resolvedQueue.push(label);
      return;
    }

    this.clearResolvedTimers();

    this.eventResolvedText.set(label);
    this.eventResolvedFading.set(false);
    this.isEventResolved.set(true);

    this.resolvedDismissTimeout = window.setTimeout(() => {
      this.eventResolvedFading.set(true);
      this.resolvedFadeTimeout = window.setTimeout(() => {
        this.isEventResolved.set(false);
        this.eventResolvedFading.set(false);
        // Drain the next queued message if one is waiting
        const next = this.resolvedQueue.shift();
        if (next !== undefined) {
          this.showEventResolved(next);
        }
      }, this.FADE_MS);
    }, this.RESOLVED_SHOW_MS);
  }

  private clearResolvedTimers(): void {
    if (this.resolvedDismissTimeout !== null) {
      clearTimeout(this.resolvedDismissTimeout);
      this.resolvedDismissTimeout = null;
    }
    if (this.resolvedFadeTimeout !== null) {
      clearTimeout(this.resolvedFadeTimeout);
      this.resolvedFadeTimeout = null;
    }
  }
}
