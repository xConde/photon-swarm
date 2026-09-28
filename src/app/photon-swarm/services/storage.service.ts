import { Injectable } from '@angular/core';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';

@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly PREFIX = 'photon-swarm:';

  constructor(private debugLog: DebugLogBridgeService) {}

  /**
   * Store a value in localStorage with proper prefixing
   */
  set<T>(key: string, value: T): boolean {
    try {
      const serialized = JSON.stringify(value);
      window.localStorage.setItem(`${this.PREFIX}${key}`, serialized);
      return true;
    } catch (error) {
      this.debugLog.log('Storage Error: Failed to store data', 'error', {
        source: 'storage_service',
        operation: 'set',
        key: `${this.PREFIX}${key}`,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Retrieve a value from localStorage
   */
  get<T>(key: string): T | null {
    try {
      const serialized = window.localStorage.getItem(`${this.PREFIX}${key}`);
      if (serialized === null) {
        return null;
      }
      return JSON.parse(serialized) as T;
    } catch (error) {
      this.debugLog.log('Storage Error: Failed to retrieve data', 'error', {
        source: 'storage_service',
        operation: 'get',
        key: `${this.PREFIX}${key}`,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Remove a value from localStorage
   */
  remove(key: string): void {
    try {
      window.localStorage.removeItem(`${this.PREFIX}${key}`);
    } catch (error) {
      this.debugLog.log('Storage Error: Failed to remove data', 'error', {
        source: 'storage_service',
        operation: 'remove',
        key: `${this.PREFIX}${key}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clear all game-related localStorage entries
   */
  clearAll(): void {
    try {
      // Get all keys from localStorage
      const keys = Object.keys(localStorage);

      // Filter and remove only our app's keys
      keys.forEach((key) => {
        if (key.startsWith(this.PREFIX)) {
          window.localStorage.removeItem(key);
        }
      });
    } catch (error) {
      this.debugLog.log('Storage Error: Failed to clear data', 'error', {
        source: 'storage_service',
        operation: 'clearAll',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
