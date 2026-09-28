import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { environment } from 'environments/environment';

interface DebugMetadata {
  [key: string]: unknown;
}

type DebugMetadataCompatible = DebugMetadata | DamageEvent | HealEvent;

// Log levels for filtering
export enum LogLevel {
  ERROR = 0,
  WARNING = 1,
  INFO = 2,
  DEBUG = 3,
}

export type LogType = 'info' | 'warning' | 'error' | 'success';

/**
 * Debug Log Bridge Service
 *
 * Bridges console.log calls from damage/heal tracking to the debug console component
 * This allows us to capture fast-moving logs in the exportable debug system
 *
 * PERFORMANCE OPTIMIZATION:
 * - Production builds automatically disable all debug logging (0 overhead)
 * - Development mode respects debugEnabled flag for optional logging
 * - Use setDebugEnabled(false) in dev to test production-like performance
 */
@Injectable({
  providedIn: 'root',
})
export class DebugLogBridgeService {
  private debugLogSubject = new Subject<{
    message: string;
    type: LogType;
    metadata?: DebugMetadataCompatible;
  }>();

  public debugLog$ = this.debugLogSubject.asObservable();

  // Special storage for damage/heal events
  private damageHistory: DamageEvent[] = [];
  private healHistory: HealEvent[] = [];
  private readonly MAX_HISTORY = 100;

  // Production mode flag - uses Angular environment for build-time optimization
  private readonly isProduction = environment.production;

  // Debug toggle for development - allows testing performance without debug logs
  private debugEnabled = !environment.production;

  // Log level filtering
  private currentLogLevel: LogLevel = LogLevel.INFO;
  private readonly logTypeToLevel: Record<LogType, LogLevel> = {
    error: LogLevel.ERROR,
    warning: LogLevel.WARNING,
    success: LogLevel.INFO,
    info: LogLevel.INFO,
  };

  constructor() {
    // Make available globally for damage tracking
    if (!this.isProduction) {
      window.debugLogBridge = this;
    }

    // Console interception removed - all logging should go through service methods
  }

  /**
   * Get damage history for export
   */
  getDamageHistory(): DamageEvent[] {
    return [...this.damageHistory];
  }

  /**
   * Get heal history for export
   */
  getHealHistory(): HealEvent[] {
    return [...this.healHistory];
  }

  /**
   * Get suspicious events only
   */
  getSuspiciousEvents(): {
    damage: DamageEvent[];
    heal: HealEvent[];
  } {
    return {
      damage: this.damageHistory.filter((e) => e.suspicious),
      heal: this.healHistory.filter((e) => e.suspicious),
    };
  }

  /**
   * Clear histories
   */
  clearHistories(): void {
    this.damageHistory = [];
    this.healHistory = [];
  }

  /**
   * Direct logging method for damage events (no console output)
   */
  logDamage(damageData: Partial<DamageEvent & { damageAmount?: number }>, isSuspicious: boolean): void {
    // Skip all logging if disabled or in production for performance
    if (this.isProduction || !this.debugEnabled) return;

    // Check log level filtering
    const logType: LogType = isSuspicious ? 'error' : 'warning';
    const messageLevel = this.logTypeToLevel[logType];
    if (messageLevel > this.currentLogLevel) return;
    // Preserve the actual amount - don't default to 0 if it's a valid number
    const actualAmount =
      damageData.amount !== undefined
        ? damageData.amount
        : damageData.damageAmount !== undefined
          ? damageData.damageAmount
          : 0;

    const damageEvent: DamageEvent = {
      timestamp: damageData.timestamp || Date.now(),
      amount: actualAmount,
      source: damageData.source || 'unknown',
      healthBefore: damageData.healthBefore || 0,
      healthAfter: damageData.healthAfter || 0,
      suspicious: isSuspicious || damageData.suspicious || false,
      stackTrace: damageData.stackTrace || [],
      label: isSuspicious ? 'SUSPICIOUS_DAMAGE' : 'DAMAGE_TAKEN',
    };

    // Add to history
    this.damageHistory.push(damageEvent);
    if (this.damageHistory.length > this.MAX_HISTORY) {
      this.damageHistory.shift();
    }

    // Send to debug console
    const message = `${damageEvent.label}: ${damageEvent.amount} damage from ${damageEvent.source} (${damageEvent.healthAfter}/${damageEvent.healthBefore})`;
    this.debugLogSubject.next({
      message,
      type: isSuspicious ? 'error' : 'warning',
      metadata: damageEvent as DebugMetadataCompatible,
    });
  }

  /**
   * Direct logging method for heal events (no console output)
   */
  logHeal(healData: Partial<HealEvent & { valueBefore?: number; valueAfter?: number }>, isSuspicious: boolean): void {
    // Skip all logging if disabled or in production for performance
    if (this.isProduction || !this.debugEnabled) return;

    // Check log level filtering
    const logType: LogType = isSuspicious ? 'error' : 'success';
    const messageLevel = this.logTypeToLevel[logType];
    if (messageLevel > this.currentLogLevel) return;
    // Preserve the actual amount - don't default to 0 if it's a valid number
    const actualHealAmount = healData.amount !== undefined ? healData.amount : 0;

    const healEvent: HealEvent = {
      timestamp: healData.timestamp || Date.now(),
      amount: actualHealAmount,
      source: healData.source || 'unknown',
      healthBefore: healData.healthBefore !== undefined ? healData.healthBefore : healData.valueBefore || 0,
      healthAfter: healData.healthAfter !== undefined ? healData.healthAfter : healData.valueAfter || 0,
      suspicious: isSuspicious || healData.suspicious || false,
      stackTrace: healData.stackTrace || [],
      label: isSuspicious ? 'SUSPICIOUS_HEAL' : 'HEAL_APPLIED',
    };

    // Add to history
    this.healHistory.push(healEvent);
    if (this.healHistory.length > this.MAX_HISTORY) {
      this.healHistory.shift();
    }

    // Send to debug console
    const message = `${healEvent.label}: ${healEvent.amount} healing from ${healEvent.source} (${healEvent.healthBefore} → ${healEvent.healthAfter})`;
    this.debugLogSubject.next({
      message,
      type: isSuspicious ? 'error' : 'success',
      metadata: healEvent as DebugMetadataCompatible,
    });
  }

  /**
   * Direct log method for general events
   */
  log(message: string, type: LogType = 'info', metadata?: DebugMetadataCompatible): void {
    // Skip all logging if disabled or in production for performance
    if (this.isProduction || !this.debugEnabled) return;

    // Check log level filtering
    const messageLevel = this.logTypeToLevel[type];
    if (messageLevel > this.currentLogLevel) return;

    this.debugLogSubject.next({ message, type, metadata });
  }

  /**
   * Enable or disable debug logging (development only)
   * @param enabled Whether to enable debug logging
   * @returns true if setting was changed, false if in production mode
   */
  setDebugEnabled(enabled: boolean): boolean {
    if (this.isProduction) return false;
    this.debugEnabled = enabled;
    return true;
  }

  /**
   * Check if debug logging is currently enabled
   */
  isDebugEnabled(): boolean {
    return !this.isProduction && this.debugEnabled;
  }

  /**
   * Set the current log level
   */
  setLogLevel(level: LogLevel): void {
    this.currentLogLevel = level;
  }

  /**
   * Get the current log level
   */
  getLogLevel(): LogLevel {
    return this.currentLogLevel;
  }

  /**
   * Export health event data for debugging
   */
  exportHealthEventData(): {
    exportTime: number;
    damageHistory: {
      total: number;
      suspicious: number;
      recent: DamageEvent[];
      allSuspicious: DamageEvent[];
    };
    healHistory: {
      total: number;
      suspicious: number;
      recent: HealEvent[];
      allSuspicious: HealEvent[];
    };
  } {
    const suspicious = this.getSuspiciousEvents();
    return {
      exportTime: Date.now(),
      damageHistory: {
        total: this.damageHistory.length,
        suspicious: suspicious.damage.length,
        recent: this.damageHistory.slice(-10),
        allSuspicious: suspicious.damage,
      },
      healHistory: {
        total: this.healHistory.length,
        suspicious: suspicious.heal.length,
        recent: this.healHistory.slice(-10),
        allSuspicious: suspicious.heal,
      },
    };
  }
}

// =============================================================================
// INTERFACES
// =============================================================================

export interface DamageEvent {
  timestamp: number;
  amount: number;
  source: string;
  healthBefore: number;
  healthAfter: number;
  suspicious: boolean;
  stackTrace: string[];
  label: string;
}

export interface HealEvent {
  timestamp: number;
  amount: number;
  source: string;
  healthBefore: number;
  healthAfter: number;
  suspicious: boolean;
  stackTrace: string[];
  label: string;
}
