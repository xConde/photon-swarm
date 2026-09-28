import { Injectable, signal, WritableSignal } from '@angular/core';
import { HoveredItem } from '../models/game-types.model';
import { TIMING_CONFIG } from '@photon/config/game-constants';

export interface Notification {
  text: string;
  startTime: number;
  color: string;
}

/**
 * Kill streak tier thresholds and colors
 */
const KILL_STREAK_TIERS = {
  LEGENDARY: { threshold: 50, color: '#ff00ff' },
  EPIC: { threshold: 25, color: '#ff00ff' },
  RAMPAGE: { threshold: 15, color: '#ff4400' },
  MULTI_KILL: { threshold: 10, color: '#ffaa00' },
  STREAK: { threshold: 5, color: '#00ff00' },
  DOUBLE_KILL: { threshold: 3, color: '#ffffff' },
} as const;

/**
 * Manages UI state including minimap, tooltips, notifications, and visual feedback
 * Uses Angular Signals for reactive state management
 */
@Injectable({
  providedIn: 'root',
})
export class UIStateService {
  // Minimap state (Signals for reactive UI updates)
  private miniMapEnabledSignal: WritableSignal<boolean> = signal(true);
  /**
   * Reactive signal for minimap enabled state
   * Subscribe to this for automatic UI updates when minimap is toggled
   */
  public readonly miniMapEnabled = this.miniMapEnabledSignal.asReadonly();

  private miniMapPositionSignal: WritableSignal<'top-right' | 'bottom-left'> = signal('top-right');
  /**
   * Reactive signal for minimap position
   */
  public readonly miniMapPosition = this.miniMapPositionSignal.asReadonly();

  private miniMapScaleSignal: WritableSignal<number> = signal(0.25); // Increased from 0.18 to 0.25 (25%) for better visibility
  /**
   * Reactive signal for minimap scale
   */
  public readonly miniMapScale = this.miniMapScaleSignal.asReadonly();

  private fullMapEnabledSignal: WritableSignal<boolean> = signal(false);
  /**
   * Reactive signal for full map enabled state
   */
  public readonly fullMapEnabled = this.fullMapEnabledSignal.asReadonly();

  // Tooltip state (Signals for reactive tooltips)
  private hoveredItemSignal: WritableSignal<HoveredItem | null> = signal(null);
  /**
   * Reactive signal for currently hovered item
   */
  public readonly hoveredItem = this.hoveredItemSignal.asReadonly();

  private tooltipTextSignal: WritableSignal<string> = signal('');
  /**
   * Reactive signal for tooltip text content
   */
  public readonly tooltipText = this.tooltipTextSignal.asReadonly();

  private tooltipXSignal: WritableSignal<number> = signal(0);
  /**
   * Reactive signal for tooltip X position
   */
  public readonly tooltipX = this.tooltipXSignal.asReadonly();

  private tooltipYSignal: WritableSignal<number> = signal(0);
  /**
   * Reactive signal for tooltip Y position
   */
  public readonly tooltipY = this.tooltipYSignal.asReadonly();

  private proximityRangeSignal: WritableSignal<number> = signal(80);
  /**
   * Reactive signal for proximity detection range
   */
  public readonly proximityRange = this.proximityRangeSignal.asReadonly();

  // Notifications (Signals for reactive notification list)
  private notificationsSignal: WritableSignal<Notification[]> = signal([]);
  /**
   * Reactive signal for active notifications
   */
  public readonly notifications = this.notificationsSignal.asReadonly();

  private readonly NOTIFICATION_DURATION = TIMING_CONFIG.HUD.NOTIFICATION_TIMEOUT_MS;

  // Visual feedback (Signal for reactive damage flash)
  private damageFlashIntensitySignal: WritableSignal<number> = signal(0);
  /**
   * Reactive signal for damage flash intensity (0-1)
   */
  public readonly damageFlashIntensity = this.damageFlashIntensitySignal.asReadonly();

  // Boss phase transition flash (white/gold — distinct from red damage flash)
  private bossPhaseFlashIntensitySignal: WritableSignal<number> = signal(0);
  /** Reactive signal for boss phase-break flash intensity (0-1). */
  public readonly bossPhaseFlashIntensity = this.bossPhaseFlashIntensitySignal.asReadonly();

  constructor() {
    // Send initialization data to debug bridge if available
    if (window.debugLogBridge) {
      window.debugLogBridge.log('UI Service Initialized', 'info', {
        source: 'ui_service_init',
        minimap: {
          enabled: this.miniMapEnabled(),
          position: this.miniMapPosition(),
          scale: this.miniMapScale(),
        },
        fullMap: { enabled: this.fullMapEnabled() },
        initialized: true,
      });
    }
  }

  /**
   * Reset UI state to defaults
   * Resets all signals to their initial values
   */
  public reset(): void {
    this.miniMapEnabledSignal.set(true);
    this.miniMapPositionSignal.set('top-right');
    this.miniMapScaleSignal.set(0.25); // Match initialization value
    this.fullMapEnabledSignal.set(false);
    this.hoveredItemSignal.set(null);
    this.tooltipTextSignal.set('');
    this.tooltipXSignal.set(0);
    this.tooltipYSignal.set(0);
    this.proximityRangeSignal.set(80);
    this.notificationsSignal.set([]);
    this.damageFlashIntensitySignal.set(0);
    this.bossPhaseFlashIntensitySignal.set(0);

    // Send reset data to debug bridge if available
    if (window.debugLogBridge) {
      window.debugLogBridge.log('UI Service Reset', 'info', {
        source: 'ui_service_reset',
        minimap: {
          enabled: this.miniMapEnabled(),
          position: this.miniMapPosition(),
          scale: this.miniMapScale(),
        },
        action: 'reset_to_defaults',
      });
    }
  }

  // === MINIMAP ===

  /**
   * Toggles minimap enabled state
   * @param enabled Optional explicit state to set (undefined = toggle)
   */
  public toggleMinimap(enabled?: boolean): void {
    const oldState = this.miniMapEnabled();
    if (enabled !== undefined) {
      this.miniMapEnabledSignal.set(enabled);
    } else {
      this.miniMapEnabledSignal.update((current) => !current);
    }

    // Send minimap toggle to debug bridge if available
    if (oldState !== this.miniMapEnabled() && window.debugLogBridge) {
      window.debugLogBridge.log('Minimap Toggle', 'info', {
        source: 'minimap_toggle',
        from: oldState,
        to: this.miniMapEnabled(),
        position: this.miniMapPosition(),
        scale: this.miniMapScale(),
      });
    }
  }

  /**
   * Sets the minimap position on screen
   * @param position New minimap position
   */
  public setMinimapPosition(position: 'top-right' | 'bottom-left'): void {
    this.miniMapPositionSignal.set(position);
  }

  /**
   * Toggles the full map or synchronizes it to an explicit state.
   * @param enabled Optional explicit state to set (undefined = toggle)
   */
  public toggleFullMap(enabled?: boolean): void {
    const oldState = this.fullMapEnabled();
    if (enabled !== undefined) {
      this.fullMapEnabledSignal.set(enabled);
    } else {
      this.fullMapEnabledSignal.update((current) => !current);
    }

    // Send full map toggle to debug bridge if available
    if (oldState !== this.fullMapEnabled() && window.debugLogBridge) {
      window.debugLogBridge.log('Full Map Toggle', 'info', {
        source: 'fullmap_toggle',
        from: oldState,
        to: this.fullMapEnabled(),
        trigger: enabled === undefined ? 'toggle' : 'explicit_state',
      });
    }
  }

  // === TOOLTIPS ===

  /**
   * Sets tooltip content and position
   * @param text Tooltip text to display
   * @param x X coordinate for tooltip
   * @param y Y coordinate for tooltip
   * @param item Optional hovered item data
   */
  public setTooltip(text: string, x: number, y: number, item?: HoveredItem): void {
    this.tooltipTextSignal.set(text);
    this.tooltipXSignal.set(x);
    this.tooltipYSignal.set(y);
    this.hoveredItemSignal.set(item ?? null);
  }

  /**
   * Clears tooltip and hovered item state
   */
  public clearTooltip(): void {
    this.tooltipTextSignal.set('');
    this.hoveredItemSignal.set(null);
  }

  // === NOTIFICATIONS ===

  /**
   * Adds a notification to the notification list
   * Automatically limits to 2 most recent notifications
   * @param text Notification text
   * @param startTime Timestamp when notification started
   * @param color Notification color
   */
  public addNotification(text: string, startTime: number, color: string): void {
    if (text && text.trim()) {
      this.notificationsSignal.update((current) => {
        const updated = [...current, { text, startTime, color }];
        // Keep only last 2 notifications to reduce clutter
        return updated.slice(-2);
      });
    }
  }

  /**
   * Updates notifications by removing expired ones
   * @param currentTime Current timestamp for expiry calculation
   */
  public updateNotifications(currentTime: number): void {
    // Clean up expired notifications
    this.notificationsSignal.update((current) =>
      current.filter((n) => currentTime - n.startTime < this.NOTIFICATION_DURATION)
    );
  }

  // === VISUAL FEEDBACK ===

  /**
   * Triggers a damage flash effect
   * @param intensity Flash intensity (0-1)
   */
  public triggerDamageFlash(intensity: number): void {
    this.damageFlashIntensitySignal.set(Math.min(1.0, intensity));
  }

  /**
   * Updates damage flash intensity (fade out effect)
   * Call this on each frame to smoothly fade the flash
   */
  public updateDamageFlash(): void {
    // Faster fade out for more responsive feedback
    this.damageFlashIntensitySignal.update((current) => Math.max(0, current - 0.08));
  }

  /**
   * Triggers a brief white/gold screen flash when a boss transitions to a new phase.
   * Distinct from the red damage flash — signals a boss escalation event.
   */
  public triggerBossPhaseFlash(): void {
    this.bossPhaseFlashIntensitySignal.set(0.45);
  }

  /**
   * Fades out the boss phase flash each frame.
   * Call from the render loop alongside updateDamageFlash().
   */
  public updateBossPhaseFlash(): void {
    this.bossPhaseFlashIntensitySignal.update((current) => Math.max(0, current - 0.04));
  }

  // === KILL STREAK MESSAGES ===

  /**
   * Gets a display message for the current kill streak
   * Returns tiered messages based on streak count
   * @param killStreak Current kill streak count
   * @returns Formatted kill streak message (empty string if < 3)
   */
  public getKillStreakMessage(killStreak: number): string {
    if (killStreak >= KILL_STREAK_TIERS.LEGENDARY.threshold) return `LEGENDARY STREAK ${killStreak}!`;
    if (killStreak >= KILL_STREAK_TIERS.EPIC.threshold) return `EPIC STREAK ${killStreak}!`;
    if (killStreak >= KILL_STREAK_TIERS.RAMPAGE.threshold) return `RAMPAGE ${killStreak}!`;
    if (killStreak >= KILL_STREAK_TIERS.MULTI_KILL.threshold) return `MULTI-KILL ${killStreak}!`;
    if (killStreak >= KILL_STREAK_TIERS.STREAK.threshold) return `KILL STREAK ${killStreak}!`;
    if (killStreak >= KILL_STREAK_TIERS.DOUBLE_KILL.threshold) return `DOUBLE KILL ${killStreak}`;
    return '';
  }

  /**
   * Gets the color for kill streak UI based on streak tier
   * @param killStreak Current kill streak count
   * @returns Hex color code for the streak tier
   */
  public getKillStreakColor(killStreak: number): string {
    if (killStreak >= KILL_STREAK_TIERS.EPIC.threshold) return KILL_STREAK_TIERS.EPIC.color; // Magenta for legendary/epic
    if (killStreak >= KILL_STREAK_TIERS.RAMPAGE.threshold) return KILL_STREAK_TIERS.RAMPAGE.color; // Orange for rampage
    if (killStreak >= KILL_STREAK_TIERS.MULTI_KILL.threshold) return KILL_STREAK_TIERS.MULTI_KILL.color; // Yellow for multi-kill
    if (killStreak >= KILL_STREAK_TIERS.STREAK.threshold) return KILL_STREAK_TIERS.STREAK.color; // Green for streak
    return KILL_STREAK_TIERS.DOUBLE_KILL.color; // White for normal
  }
}
