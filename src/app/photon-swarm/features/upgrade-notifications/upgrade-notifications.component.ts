import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { animate, style, transition, trigger } from '@angular/animations';
import { AchievementService } from '../../services/achievement.service';
import { SpawnSystemService } from '../../core/systems/enemy-ai';

interface UpgradeNotification {
  id: number;
  title: string;
  description: string;
  icon: string;
  rarity: 'common' | 'rare' | 'epic';
  timestamp: number;
}

interface AchievementNotification {
  id: number;
  name: string;
  description: string;
  timestamp: number;
}

interface UpgradeData {
  name?: string;
  description?: string;
  type?: string;
  tier?: string;
  cost?: number;
}

@Component({
  selector: 'app-upgrade-notifications',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Upgrade notifications — canonical TOAST pattern: translateY+opacity, 1px left-border in tier color -->
    <div class="notifications-container" [class.wave-active]="waveAnnouncementActive()">
      @for (notification of activeNotifications(); track notification.id) {
        <div
          class="upgrade-notification"
          [class]="'rarity-' + notification.rarity"
          [@toastEnter]
          role="status"
          [attr.aria-label]="notification.title + ': ' + notification.description"
        >
          <div class="notification-content">
            <div class="notification-text">
              <div class="notification-title">
                <span class="rarity-pip" aria-hidden="true"></span>
                {{ notification.title }}
              </div>
              <div class="notification-description">{{ notification.description }}</div>
            </div>
          </div>
        </div>
      }
    </div>

    <!-- Achievement notifications — minimal monospace text overlay -->
    <div class="achievements-container" [class.wave-active]="waveAnnouncementActive()">
      @for (achievement of activeAchievements(); track achievement.id) {
        <div class="achievement-overlay" [@achievementFade] role="status">
          <div class="achievement-accent-line" aria-hidden="true"></div>
          <div class="achievement-name">[ {{ achievement.name }} ]</div>
          <div class="achievement-description">{{ achievement.description }}</div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      /* Design-system tokens consumed via CSS custom properties */
      :host {
        position: absolute;
        top: 55px;
        left: 50%;
        transform: translateX(-50%);
        /* $z-hud-toast = 550 */
        z-index: 550;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
      }

      /* ─── Upgrade notifications — canonical TOAST ─── */

      .notifications-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: center;
        margin-top: 0;
        transition: margin-top 200ms ease-out;
      }

      /* Push upgrade toasts clear of the wave-announcement banner (~48px top + ~80px tall) */
      .notifications-container.wave-active {
        margin-top: 80px;
      }

      .upgrade-notification {
        position: relative;
        background: var(--game-bg-overlay, rgba(0, 20, 40, 0.9));
        border: 1px solid var(--game-panel-border, rgba(0, 255, 255, 0.3));
        /* 1px LEFT border carries the rarity tier color */
        border-left-width: 3px;
        border-radius: 4px; /* $radius-small */
        padding: 8px 14px;
        min-width: 260px;
        max-width: 360px;
        backdrop-filter: blur(var(--game-blur-panel, 6px));
        overflow: hidden;
      }

      .notification-content {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .notification-text {
        flex: 1;
        min-width: 0;
      }

      .notification-title {
        margin: 0;
        font-size: 12px; /* $text-small */
        font-weight: 600; /* $weight-semibold */
        text-transform: uppercase;
        letter-spacing: 0.1em;
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace; /* ds.$font-mono */
        color: var(--game-text-primary);
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .notification-description {
        margin: 3px 0 0 0;
        font-size: 11px; /* $text-micro */
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace; /* ds.$font-mono */
        color: var(--game-text-secondary);
      }

      /* Rarity pip — non-color secondary signal for colorblind safety */
      .rarity-pip {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
        flex-shrink: 0;
      }

      /* Rarity colors via tier tokens — left border carries the hue */
      .rarity-common {
        border-left-color: var(--game-tier-common, #33ccff);
        color: var(--game-tier-common, #33ccff);
      }

      .rarity-rare {
        border-left-color: var(--game-tier-rare, #3399ff);
        color: var(--game-tier-rare, #3399ff);
      }

      .rarity-epic {
        border-left-color: var(--game-tier-epic, #a855f7);
        color: var(--game-tier-epic, #a855f7);
      }

      :host-context(.day-mode) .rarity-common {
        border-left-color: #0e7ab5;
        color: #0e7ab5;
      }

      :host-context(.day-mode) .rarity-rare {
        border-left-color: #1e5b99;
        color: #1e5b99;
      }

      :host-context(.day-mode) .rarity-epic {
        border-left-color: #7c3aed;
        color: #7c3aed;
      }

      /* ─── Achievement notifications (text overlay) ─── */

      .achievements-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        transition: margin-top 200ms ease-out;
      }

      .achievements-container.wave-active {
        margin-top: 40px;
      }

      .achievement-overlay {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        text-align: center;
      }

      .achievement-accent-line {
        width: 32px;
        height: 1px;
        background: var(--game-accent);
        margin-bottom: 2px;
      }

      .achievement-name {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace; /* ds.$font-mono */
        font-size: 12px; /* $text-small */
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--game-accent);
      }

      .achievement-description {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Courier New', monospace; /* ds.$font-mono */
        font-size: 11px; /* $text-micro */
        letter-spacing: 0.06em;
        color: var(--game-text-secondary);
      }

      /* Day mode — token-based surfaces handle theming automatically via CSS vars.
         No explicit overrides needed: --game-bg-overlay, --game-panel-border,
         --game-accent, --game-tier-* all flip in .day-mode. */
    `,
  ],
  animations: [
    trigger('toastEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-8px)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(-4px)' }))]),
    ]),
    trigger('achievementFade', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(8px)' }),
        animate('200ms ease-out', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(-4px)' }))]),
    ]),
  ],
})
export class UpgradeNotificationsComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  readonly activeNotifications = signal<UpgradeNotification[]>([]);
  readonly activeAchievements = signal<AchievementNotification[]>([]);
  readonly waveAnnouncementActive = signal(false);
  private nextId = 0;
  private waveAnnouncementTimer?: ReturnType<typeof setTimeout>;
  private readonly NOTIFICATION_LIFETIME = 4000; // 4 seconds
  private readonly ACHIEVEMENT_LIFETIME = 3900; // ~4s hold (400ms enter + ~3s + 500ms exit)

  private readonly UPGRADE_ICONS: Record<string, string> = {
    damage: '⚔️',
    speed: '💨',
    health: '❤️',
    shield: '🛡️',
    fire_rate: '🔫',
    projectile: '💥',
    beam: '⚡',
    xp: '⭐',
    critical: '🎯',
    default: '✨',
  };

  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);

  constructor(
    private achievementService: AchievementService,
    private spawnSystem: SpawnSystemService
  ) {}

  ngOnInit(): void {
    // Level-up notifications suppressed — the upgrade modal already displays the new level.

    // Subscribe to achievement unlock events
    this.achievementService.achievementUnlocked$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((achievement) => {
      this.showAchievementNotification(achievement.name, achievement.description);
    });

    // Track wave announcement / new-threat banners to avoid overlap
    this.spawnSystem.waveStarted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.setWaveActive(2000); // Wave text shows for ~1.5s + 300ms fade
    });
    this.spawnSystem.newThreatUnlocked$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.setWaveActive(3000); // New threat shows for ~2.5s + 300ms fade
    });

    // Clean up old notifications periodically
    interval(500)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.cleanupOldNotifications();
      });
  }

  // Public method to show upgrade notifications from external sources
  public showUpgrade(name: string, description: string, type: string, tier?: string): void {
    this.showUpgradeNotification({ name, description, type, tier });
  }

  ngOnDestroy(): void {
    if (this.waveAnnouncementTimer) clearTimeout(this.waveAnnouncementTimer);
  }

  private setWaveActive(durationMs: number): void {
    this.waveAnnouncementActive.set(true);
    this.cdr.detectChanges();
    if (this.waveAnnouncementTimer) clearTimeout(this.waveAnnouncementTimer);
    this.ngZone.runOutsideAngular(() => {
      this.waveAnnouncementTimer = setTimeout(() => {
        this.waveAnnouncementActive.set(false);
        this.cdr.detectChanges();
      }, durationMs);
    });
  }

  private showUpgradeNotification(upgrade: UpgradeData): void {
    const upgradeType = upgrade.type ?? 'default';
    const icon = this.UPGRADE_ICONS[upgradeType] ?? this.UPGRADE_ICONS['default'];

    const notification: UpgradeNotification = {
      id: this.nextId++,
      title: upgrade.name || 'Power Up!',
      description: upgrade.description || 'Your abilities have been enhanced',
      icon,
      rarity: this.determineRarity(upgrade),
      timestamp: Date.now(),
    };

    this.activeNotifications.update((arr) => [...arr, notification]);
  }

  private showAchievementNotification(name: string, description: string): void {
    const notification: AchievementNotification = {
      id: this.nextId++,
      name,
      description,
      timestamp: Date.now(),
    };

    this.activeAchievements.update((arr) => [...arr, notification]);
  }

  private determineRarity(upgrade: UpgradeData): 'common' | 'rare' | 'epic' {
    const cost = upgrade.cost ?? 0;
    if (upgrade.tier === 'epic' || upgrade.tier === 'legendary' || cost > 50) return 'epic';
    if (upgrade.tier === 'rare' || cost > 20) return 'rare';
    return 'common';
  }

  private cleanupOldNotifications(): void {
    const now = Date.now();
    this.activeNotifications.update((arr) =>
      arr.filter((notification) => now - notification.timestamp < this.NOTIFICATION_LIFETIME)
    );
    this.activeAchievements.update((arr) =>
      arr.filter((notification) => now - notification.timestamp < this.ACHIEVEMENT_LIFETIME)
    );
  }
}
