import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Observable, Subject, Subscription } from 'rxjs';
import { PlayerService } from '../player/player.service';
import { WeaponType } from '../models/equipment.model';
import { CONTROL_CONSTANTS, ControlUtils } from './control-constants';
import { KeyBindingService } from './key-binding.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { AudioService } from '../audio/audio.service';

export interface ControlMapping {
  key: string;
  action: string;
  description?: string;
  cooldownKey?: string;
  category?: 'movement' | 'combat' | 'interface' | 'special';
}

export interface WeaponSpecification {
  type: WeaponType;
  name: string;
  damageMultiplier: number;
  description: string;
  beamLength: number;
  beamRadius: number;
  color?: string;
}

export interface PlayerActionState {
  isMoving: boolean;
  isDashing: boolean;
  isTargeting: boolean;
  isCombat: boolean;
  mapOpened: boolean;
  dashCooldownPercent: number;
  isFlightMode?: boolean;
  isParrying?: boolean;
  isChargingDischarge?: boolean;
}

export interface CooldownState {
  key: string;
  current: number;
  total: number;
  percent: number;
  isReady: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class GameControlsService implements OnDestroy {
  private get gameControls(): ControlMapping[] {
    const dn = KeyBindingService.getKeyDisplayName;
    const b = this.keyBindings.getBindings();
    return [
      {
        key: `${dn(b.moveUp)}/${dn(b.moveLeft)}/${dn(b.moveDown)}/${dn(b.moveRight)}`,
        action: CONTROL_CONSTANTS.ACTION_NAMES.MOVEMENT,
        category: 'movement',
      },
      {
        key: CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.TARGET,
        action: 'Toggle Shooting',
        cooldownKey: 'TARGET',
        category: 'combat',
      },
      {
        key: CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.DISCHARGE,
        action: CONTROL_CONSTANTS.ACTION_NAMES.DISCHARGE,
        cooldownKey: 'DISCHARGE',
        category: 'combat',
      },
      {
        key: dn(b.dash),
        action: CONTROL_CONSTANTS.ACTION_NAMES.DASH,
        cooldownKey: 'DASH',
        category: 'special',
      },
      {
        key: dn(b.parry),
        action: CONTROL_CONSTANTS.ACTION_NAMES.PARRY,
        cooldownKey: 'PARRY',
        category: 'combat',
      },
      {
        key: dn(b.flightMode),
        action: 'Auto-Beam / Focus Fire',
        category: 'combat',
      },
      { key: dn(b.mapToggle), action: CONTROL_CONSTANTS.ACTION_NAMES.MAP, category: 'interface' },
      {
        key: CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE,
        action: CONTROL_CONSTANTS.ACTION_NAMES.PAUSE,
        category: 'interface',
      },
    ];
  }

  private pauseControls: ControlMapping[] = [
    { key: CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE, action: 'Resume', category: 'interface' },
  ];

  private shopControls: ControlMapping[] = [
    { key: CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.PAUSE, action: 'Close Shop', category: 'interface' },
    { key: 'ENTER', action: 'Purchase', category: 'interface' },
  ];

  private weaponSpecs: WeaponSpecification[] = [
    {
      type: 'beam_cannon',
      name: 'Beam Cannon',
      damageMultiplier: 1.0,
      description: 'Standard beam weapon',
      beamLength: 800,
      beamRadius: 15,
    },
    {
      type: 'plasma_rifle',
      name: 'Plasma Rifle',
      damageMultiplier: 1.2,
      description: 'High-energy plasma beam',
      beamLength: 720,
      beamRadius: 20,
    },
    {
      type: 'void_launcher',
      name: 'Void Launcher',
      damageMultiplier: 1.5,
      description: 'Devastating void energy',
      beamLength: 880,
      beamRadius: 25,
    },
    {
      type: 'nova_projector',
      name: 'Nova Projector',
      damageMultiplier: 0.8,
      description: 'Rapid-fire energy bursts',
      beamLength: 640,
      beamRadius: 10,
    },
    {
      type: 'photon_array',
      name: 'Photon Array',
      damageMultiplier: 1.1,
      description: 'Multi-beam photon system',
      beamLength: 800,
      beamRadius: 15,
    },
  ];

  private actionState: PlayerActionState = {
    isMoving: false,
    isDashing: false,
    isTargeting: false,
    isCombat: false,
    mapOpened: false,
    dashCooldownPercent: 0,
    isFlightMode: false,
    isParrying: false,
    isChargingDischarge: false,
  };

  private actionStateSubject = new BehaviorSubject<PlayerActionState>(this.actionState);
  public actionState$ = this.actionStateSubject.asObservable();

  private cooldownSubject = new BehaviorSubject<Map<string, CooldownState>>(new Map());
  public cooldowns$ = this.cooldownSubject.asObservable();

  private updateInterval: Subscription | null = null;
  private bindingsSubscription: Subscription | null = null;
  private dashPressed = false;
  private dashCooldownActive = false;
  private dashCooldownStart = 0;
  private activeKeys = new Set<string>();
  private dashTimeout?: ReturnType<typeof setTimeout>;
  private dashCooldownTimeout?: ReturnType<typeof setTimeout>;

  // MEMORY LEAK FIX: Store bound functions for proper cleanup
  private boundHandleKeyDown = this.handleKeyDown.bind(this);
  private boundHandleKeyUp = this.handleKeyUp.bind(this);

  // Event emitter for map toggle
  private mapToggleSubject = new Subject<void>();
  public mapToggle$ = this.mapToggleSubject.asObservable();

  constructor(
    private playerService: PlayerService,
    private debugLog: DebugLogBridgeService,
    private keyBindings: KeyBindingService,
    private audio: AudioService
  ) {
    this.debugLog.log('🎮 GameControlsService CONSTRUCTOR', 'success', {
      source: 'controls',
      operation: 'constructor',
      timestamp: Date.now(),
    });
    this.startKeyboardListening();
    this.startCooldownTracking();

    // Clear active keys when bindings change to prevent stuck movement
    this.bindingsSubscription = this.keyBindings.bindings$.subscribe(() => {
      this.activeKeys.clear();
    });
  }

  private startKeyboardListening(): void {
    this.debugLog.log('🎮 GameControlsService startKeyboardListening', 'success', {
      source: 'controls',
      operation: 'start_listening',
      hasDocument: !!document,
      boundHandleKeyDown: !!this.boundHandleKeyDown,
      timestamp: Date.now(),
    });
    // Use window instead of document to ensure we get events
    // And use capture phase (third parameter true) to get events first
    window.addEventListener('keydown', this.boundHandleKeyDown, true);
    window.addEventListener('keyup', this.boundHandleKeyUp, true);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const key = ControlUtils.normalizeKey(event.key);

    // Special case: Map key works even when game is not active (for testing/debugging)
    if (this.keyBindings.isMapKey(key)) {
      const gameActive = this.playerService.getGameActive();
      this.debugLog.log('🗺️ Map key pressed', 'warning', {
        source: 'controls',
        operation: 'map_key_check',
        key: key,
        gameActive: gameActive,
        timestamp: Date.now(),
      });

      // Allow map toggle even if game not active for now
      this.mapToggleSubject.next();

      this.debugLog.log('🗺️ Map toggle requested', 'info', {
        source: 'controls',
        operation: 'map_toggle',
        gameActive: gameActive,
        timestamp: Date.now(),
      });

      // If game not active, return after handling map
      if (!gameActive) return;
    }

    // All other keys require game to be active
    if (!this.playerService.getGameActive()) return;

    // Debug log key press
    this.debugLog.log('⌨️ Key Down', 'info', {
      source: 'controls',
      operation: 'keydown',
      key: key,
      isMovementKey: this.keyBindings.isMovementKey(key),
      isDashKey: this.keyBindings.isDashKey(key),
      timestamp: Date.now(),
    });

    // Track movement keys for active state
    if (this.keyBindings.isMovementKey(key)) {
      this.activeKeys.add(key);
      // Pass key to PlayerService for movement processing
      this.playerService.setKey(key, true);
    }

    // Handle dash
    if (this.keyBindings.isDashKey(key) && !this.dashPressed && !this.dashCooldownActive) {
      this.dashPressed = true;
      this.dashCooldownActive = true;
      this.dashCooldownStart = Date.now();
      this.updatePlayerActionState({ isDashing: true });
      this.updateCooldowns();

      this.dashTimeout = setTimeout(() => {
        this.updatePlayerActionState({ isDashing: false });
        this.dashPressed = false;
      }, 300);

      this.dashCooldownTimeout = setTimeout(() => {
        this.dashCooldownActive = false;
        this.updateCooldowns();
      }, this.playerService.getDashCooldown());
    }

    // SHIFT — combat modifier (context-dependent)
    // Beam mode: toggle auto-beam / manual aim
    // Shooting mode: toggle Focus Fire (precision auto-target)
    if (this.keyBindings.isFlightModeKey(key)) {
      if (this.playerService.getIsShiftFiring()) {
        // In shooting mode: toggle Focus Fire
        const nowActive = !this.playerService.getIsFocusFiring();
        this.playerService.setFocusFire(nowActive);
        if (nowActive) {
          this.audio.playFocusFireEngage();
        } else {
          this.audio.playFocusFireDisengage();
        }
      } else {
        // In beam mode: toggle auto-beam
        this.playerService.toggleAutoBeam();
      }
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    const key = ControlUtils.normalizeKey(event.key);

    // Debug log key release
    this.debugLog.log('⌨️ Key Up', 'info', {
      source: 'controls',
      operation: 'keyup',
      key: key,
      isMovementKey: this.keyBindings.isMovementKey(key),
      timestamp: Date.now(),
    });

    // Track movement keys for active state
    if (this.keyBindings.isMovementKey(key)) {
      this.activeKeys.delete(key);
      // Pass key release to PlayerService
      this.playerService.setKey(key, false);
    }

    // SHIFT keyup — no action needed (Focus Fire is now toggle, not hold)
  }

  private startCooldownTracking(): void {
    this.updateCooldowns();

    this.updateInterval = interval(50).subscribe(() => {
      this.updateCooldowns();
      this.updatePlayerActionState();
    });
  }

  private updateCooldowns(): void {
    const cooldowns = new Map<string, CooldownState>();

    // L-CLICK targeting logic - only show cooldown, not hold duration
    const isTargetingCooldown = this.playerService.isDirectionChangeOnCooldown();

    cooldowns.set('TARGET', {
      key: 'TARGET',
      current: isTargetingCooldown ? 100 : 0,
      total: 100,
      percent: isTargetingCooldown ? 100 : 0,
      isReady: !isTargetingCooldown,
    });

    // R-CLICK discharge logic
    const dischargePercent = this.playerService.getDischargePercent();
    cooldowns.set('DISCHARGE', {
      key: 'DISCHARGE',
      current: dischargePercent,
      total: 100,
      percent: dischargePercent,
      isReady: this.playerService.isDischargeAvailable(),
    });

    // DASH logic with actual PlayerService cooldown
    let dashRemain = 0;
    if (this.dashCooldownActive) {
      const elapsed = Date.now() - this.dashCooldownStart;
      const dashCooldownMs = this.playerService.getDashCooldown();
      const pctElapsed = Math.min(100, (elapsed / dashCooldownMs) * 100);
      dashRemain = 100 - pctElapsed;
    }

    cooldowns.set('DASH', {
      key: 'DASH',
      current: this.dashCooldownActive ? dashRemain : 0,
      total: 100,
      percent: dashRemain,
      isReady: !this.dashCooldownActive,
    });

    // PARRY cooldown logic
    const isParryReady = this.playerService.isParryAvailable();
    cooldowns.set('PARRY', {
      key: 'PARRY',
      current: isParryReady ? 0 : 100,
      total: 100,
      percent: isParryReady ? 0 : 100,
      isReady: isParryReady,
    });

    this.cooldownSubject.next(cooldowns);
  }

  private updatePlayerActionState(updates?: Partial<PlayerActionState>): void {
    if (updates) {
      this.actionState = { ...this.actionState, ...updates };
    }

    // Update real-time active states
    this.actionState.isMoving = this.isPlayerCurrentlyMoving();
    this.actionState.isTargeting = this.playerService.isDirectionChangeActive();
    this.actionState.mapOpened = this.isMapOpened();
    this.actionState.isFlightMode = this.playerService.getIsFocusFiring(); // Legacy field name — tracks Focus Fire state
    this.actionState.isParrying = this.playerService.isParrying();
    this.actionState.isChargingDischarge = this.playerService.isChargingDischarge();

    const cooldowns = this.cooldownSubject.value;
    this.actionState.dashCooldownPercent = cooldowns.get('DASH')?.percent || 0;

    this.actionStateSubject.next(this.actionState);
  }

  private isMapOpened(): boolean {
    return this.activeKeys.has(this.keyBindings.getKey('mapToggle'));
  }

  private isPlayerCurrentlyMoving(): boolean {
    // Check if any movement keys are currently pressed using key binding service
    return this.keyBindings.getMovementKeys().some((key) => this.activeKeys.has(key));
  }

  public getControlsForState(state: 'game' | 'pause' | 'shop'): ControlMapping[] {
    switch (state) {
      case 'pause':
        return this.pauseControls;
      case 'shop':
        return this.shopControls;
      default:
        return this.gameControls;
    }
  }

  public getWeaponSpecifications(): WeaponSpecification[] {
    return this.weaponSpecs;
  }

  public getWeaponSpec(type: WeaponType): WeaponSpecification | undefined {
    return this.weaponSpecs.find((spec) => spec.type === type);
  }

  public getPlayerActionState(): Observable<PlayerActionState> {
    return this.actionState$;
  }

  public getCooldowns(): Observable<Map<string, CooldownState>> {
    return this.cooldowns$;
  }

  private resetTimers(): void {
    if (this.dashTimeout) {
      clearTimeout(this.dashTimeout);
      this.dashTimeout = undefined;
    }
    if (this.dashCooldownTimeout) {
      clearTimeout(this.dashCooldownTimeout);
      this.dashCooldownTimeout = undefined;
    }
  }

  ngOnDestroy(): void {
    this.resetTimers();
    if (this.updateInterval) {
      this.updateInterval.unsubscribe();
    }
    if (this.bindingsSubscription) {
      this.bindingsSubscription.unsubscribe();
    }
    // Remove from window with capture flag matching addEventListener
    window.removeEventListener('keydown', this.boundHandleKeyDown, true);
    window.removeEventListener('keyup', this.boundHandleKeyUp, true);
  }
}
