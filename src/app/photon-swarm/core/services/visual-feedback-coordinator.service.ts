import { Injectable } from '@angular/core';
import { KillFeedComponent } from '../../features/kill-feed/kill-feed.component';
import { UpgradeNotificationsComponent } from '../../features/upgrade-notifications/upgrade-notifications.component';

/**
 * Visual Feedback Coordinator Service
 * Coordinates between game systems and visual feedback components
 * Note: Damage numbers are handled by the existing ECS FloatingTextSystem
 */
@Injectable({
  providedIn: 'root',
})
export class VisualFeedbackCoordinatorService {
  private killFeed?: KillFeedComponent;
  private upgradeNotifications?: UpgradeNotificationsComponent;

  /**
   * Register visual feedback components
   */
  registerComponents(killFeed?: KillFeedComponent, upgradeNotifications?: UpgradeNotificationsComponent): void {
    this.killFeed = killFeed;
    this.upgradeNotifications = upgradeNotifications;
  }

  /**
   * Show kill in kill feed
   */
  showKill(enemyType: string, factionId: number, xp: number): void {
    if (this.killFeed) {
      this.killFeed.addKill(enemyType, factionId, xp);
    }
  }

  /**
   * Show upgrade notification
   */
  showUpgrade(name: string, description: string, type: string, tier?: string): void {
    if (this.upgradeNotifications) {
      this.upgradeNotifications.showUpgrade(name, description, type, tier);
    }
  }

  /**
   * Clear all components
   */
  clear(): void {
    this.killFeed = undefined;
    this.upgradeNotifications = undefined;
  }
}
