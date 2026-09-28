import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { StorageService } from '../../services/storage.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';

/** Actions that can be rebound by the player. */
export type BindableAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'dash'
  | 'parry'
  | 'flightMode'
  | 'mapToggle';

/** Human-readable labels for each bindable action. */
export const ACTION_LABELS: Record<BindableAction, string> = {
  moveUp: 'Move Up',
  moveDown: 'Move Down',
  moveLeft: 'Move Left',
  moveRight: 'Move Right',
  dash: 'Dash',
  parry: 'Parry',
  flightMode: 'Combat Modifier', // Legacy key name — toggles auto-beam or Focus Fire
  mapToggle: 'Map Toggle',
};

/** Serialisable key-bindings map stored in localStorage. */
export type KeyBindingsMap = Record<BindableAction, string>;

const DEFAULT_BINDINGS: KeyBindingsMap = {
  moveUp: 'w',
  moveDown: 's',
  moveLeft: 'a',
  moveRight: 'd',
  dash: ' ',
  parry: 'e',
  flightMode: 'shift',
  mapToggle: 'm',
};

/** Result of attempting to set a key binding. */
export interface SetKeyResult {
  success: boolean;
  conflictAction?: BindableAction;
}

@Injectable({
  providedIn: 'root',
})
export class KeyBindingService {
  private readonly STORAGE_KEY = 'key-bindings';

  private bindings: KeyBindingsMap;
  private bindingsSubject: BehaviorSubject<KeyBindingsMap>;
  public bindings$;

  constructor(
    private storage: StorageService,
    private debugLog: DebugLogBridgeService
  ) {
    this.bindings = this.loadBindings();
    this.bindingsSubject = new BehaviorSubject<KeyBindingsMap>(this.bindings);
    this.bindings$ = this.bindingsSubject.asObservable();
  }

  /** Get the key bound to a given action (always lowercase). */
  getKey(action: BindableAction): string {
    return this.bindings[action];
  }

  /** Get a snapshot of all current bindings. */
  getBindings(): KeyBindingsMap {
    return { ...this.bindings };
  }

  /**
   * Set the key for an action.
   * Returns `{ success: false, conflictAction }` if another action already uses that key.
   */
  setKey(action: BindableAction, key: string): SetKeyResult {
    const normalised = key.toLowerCase();

    // Check for conflicts with other actions
    const conflict = this.getConflict(normalised, action);
    if (conflict) {
      return { success: false, conflictAction: conflict };
    }

    this.bindings[action] = normalised;
    this.persist();
    this.bindingsSubject.next({ ...this.bindings });
    return { success: true };
  }

  /** Reset all bindings to defaults. */
  resetDefaults(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
    this.persist();
    this.bindingsSubject.next({ ...this.bindings });
  }

  // --- Query helpers used by ControlUtils / GameControlsService ---

  /** Check if a key matches any movement binding (or arrow keys, which are always active). */
  isMovementKey(key: string): boolean {
    const k = key.toLowerCase();
    // Arrow keys are always valid movement keys regardless of bindings
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      return true;
    }
    return (
      k === this.bindings.moveUp ||
      k === this.bindings.moveDown ||
      k === this.bindings.moveLeft ||
      k === this.bindings.moveRight
    );
  }

  isDashKey(key: string): boolean {
    return key.toLowerCase() === this.bindings.dash;
  }

  isFlightModeKey(key: string): boolean {
    return key.toLowerCase() === this.bindings.flightMode;
  }

  isParryKey(key: string): boolean {
    return key.toLowerCase() === this.bindings.parry;
  }

  isMapKey(key: string): boolean {
    return key.toLowerCase() === this.bindings.mapToggle;
  }

  /** Returns all keys currently bound to movement (WASD bindings + arrow keys). */
  getMovementKeys(): readonly string[] {
    return [
      this.bindings.moveUp,
      this.bindings.moveDown,
      this.bindings.moveLeft,
      this.bindings.moveRight,
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
    ];
  }

  /** Returns a display-friendly name for a key code. */
  static getKeyDisplayName(key: string): string {
    const displayMap: Record<string, string> = {
      ' ': 'SPACE',
      shift: 'SHIFT',
      escape: 'ESC',
      arrowup: 'UP',
      arrowdown: 'DOWN',
      arrowleft: 'LEFT',
      arrowright: 'RIGHT',
      enter: 'ENTER',
      tab: 'TAB',
      backspace: 'BKSP',
      control: 'CTRL',
      alt: 'ALT',
      meta: 'META',
    };
    return displayMap[key.toLowerCase()] ?? key.toUpperCase();
  }

  // --- Private helpers ---

  private getConflict(key: string, excludeAction: BindableAction): BindableAction | undefined {
    const actions = Object.keys(this.bindings) as BindableAction[];
    return actions.find((a) => a !== excludeAction && this.bindings[a] === key);
  }

  /**
   * Allowlist pattern for legal KeyboardEvent.key values (compared lowercase).
   * Matches:
   *   - Single printable characters: a–z, 0–9, space (' '), common punctuation
   *   - Named keys: space, enter, tab, escape, shift, control, alt, meta,
   *     arrowup/down/left/right, backspace, delete, home, end, pageup/pagedown, f1–f12
   */
  private static readonly VALID_KEY_RE =
    /^[a-z0-9 `~!@#$%^&*()_+\-=[\]{}\\|;':",.<>/?]$|^(space|enter|tab|escape|shift|control|alt|meta|arrowup|arrowdown|arrowleft|arrowright|backspace|delete|home|end|pageup|pagedown|f([1-9]|1[0-2]))$/;

  private isValidKey(value: string): boolean {
    return KeyBindingService.VALID_KEY_RE.test(value.toLowerCase());
  }

  private loadBindings(): KeyBindingsMap {
    try {
      const saved = this.storage.get<Partial<KeyBindingsMap>>(this.STORAGE_KEY);
      if (saved && typeof saved === 'object') {
        // Validate each entry: must be a known action with a non-empty string value
        // that matches a legal KeyboardEvent.key name to guard against localStorage injection.
        const validated: Partial<KeyBindingsMap> = {};
        const validActions = Object.keys(DEFAULT_BINDINGS) as BindableAction[];
        for (const action of validActions) {
          const value = saved[action];
          if (typeof value === 'string' && value.length > 0 && this.isValidKey(value)) {
            validated[action] = value;
          } else if (typeof value === 'string' && value.length > 0) {
            if (window.debugLogBridge) {
              window.debugLogBridge.log(`Invalid key binding for "${action}", falling back to default`, 'warning', {
                source: 'key_binding_service',
                operation: 'load',
                action,
                value,
              });
            }
          }
        }
        // Merge with defaults so new actions added later get their default key
        return { ...DEFAULT_BINDINGS, ...validated };
      }
    } catch (err) {
      if (window.debugLogBridge) {
        window.debugLogBridge.log('Failed to load key bindings, using defaults', 'error', {
          source: 'key_binding_service',
          operation: 'load',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ...DEFAULT_BINDINGS };
  }

  private persist(): void {
    try {
      this.storage.set(this.STORAGE_KEY, this.bindings);
    } catch (err) {
      this.debugLog.log('Failed to save key bindings', 'error', {
        source: 'key_binding_service',
        operation: 'persist',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
