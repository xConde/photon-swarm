// src/app/sections/pages/projects/lazy-projects/photon-swarm/core/player.service.ts

import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { EngineSystem } from '../utils/system';
import { BehaviorSubject, Subject } from 'rxjs';
import { Cosmetic, CosmeticsService } from '../../services/cosmetics.service';
import {
  ARRAY_INDICES,
  BEAM_CONSTANTS,
  FACTION_CONFIG,
  PLAYER_CONFIG,
  RENDER_CONFIG,
  WORLD_CONFIG,
} from '@photon/config/game-constants';
import { isCoarseTouchDevice } from '../utils/touch-device.util';
import { MathUtilsService } from '../utils/math-utils.service';
import { DischargeEvent, PlayerGameEngine } from '../models/player.model';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { FactionStandingSystemService, TerritoryEffects } from '../systems/gameplay';
import { ThemeService } from '@services/theme.service';
import { PlayerUpgradesService } from './player-upgrades.service';
import { PlayerDirectionTrackerService } from './player-direction-tracker.service';
import { PlayerSlowDebuffHelper } from './player-slow-debuff.helper';
import { ZoneStateService } from '../systems/world/zone-state.service';
import { PaletteService } from '../../services/palette.service';
import { AudioService } from '../audio/audio.service';

@EngineSystem()
@Injectable({ providedIn: 'root' })
export class PlayerService implements OnDestroy {
  public x$ = new BehaviorSubject<number>(6000); // Center of 12000 width world
  public y$ = new BehaviorSubject<number>(4500); // Center of 9000 height world

  // New Subject to notify when cooldowns are reset
  private cooldownResetSubject = new Subject<void>();
  public cooldownReset$ = this.cooldownResetSubject.asObservable();

  private angle = 0;
  private keys: Record<string, boolean> = {};
  private isGameActive = false;

  // Direction change cooldown
  private directionChangeCooldown = false;
  private directionChangeActive = false;
  private directionChangeTimeout?: number;
  private directionChangeEndTimeout?: number;
  private DIRECTION_COOLDOWN: number = PLAYER_CONFIG.ABILITIES.DIRECTION_CHANGE.COOLDOWN_MS;
  private DIRECTION_ACTIVE_DURATION: number = PLAYER_CONFIG.ABILITIES.DIRECTION_CHANGE.ACTIVE_DURATION_MS || 1000;
  private MAX_ROTATION_SPEED = PLAYER_CONFIG.ABILITIES.DIRECTION_CHANGE.MAX_ROTATION_SPEED_RAD_PER_FRAME || 0.3;
  private targetAngle = 0; // The angle we're trying to rotate toward

  private _isFiring = true; // Beam ON by default

  // Cached beam damage multiplier (updated on upgrade, avoids per-frame lookup)
  private cachedBeamDamageMult = 1.0;
  // Cached beam width multiplier (updated on upgrade, avoids per-frame lookup)
  private cachedBeamWidthMult = 1.0;

  // Auto-beam mode: beam spins automatically instead of following cursor
  private isAutoBeam = false;
  private autoBeamSubject = new BehaviorSubject<boolean>(false);
  public autoBeam$ = this.autoBeamSubject.asObservable();

  // Shift-fire: pressing shift fires projectile balls
  private isShiftFiring = false;

  // Focus Fire: toggle Shift in shooting mode — auto-targets nearest enemy
  private isFocusFiring = false;
  private focusFireSubject = new BehaviorSubject<boolean>(false);
  public focusFire$ = this.focusFireSubject.asObservable();

  // Discharge
  private dischargeAvailable = true;
  private dischargeTimeout?: number;
  private DISCHARGE_COOLDOWN: number = PLAYER_CONFIG.WEAPONS.DISCHARGE.COOLDOWN_MS;
  private dischargeRemainingMs = 0;
  private dischargeSubject = new Subject<DischargeEvent>();
  public discharge$ = this.dischargeSubject.asObservable();

  // Charged Discharge state
  private isChargingDischargeState = false;
  private dischargeChargeLevel = 0;
  private dischargeChargeStartTime = 0;
  private readonly DISCHARGE_MAX_CHARGE_MS = PLAYER_CONFIG.DISCHARGE_CHARGING.MAX_CHARGE_DURATION_MS;

  // Dash
  private dashAvailable = true;
  private dashInProgress = false;
  private dashDirection: { x: number; y: number } | null = { x: 0, y: 0 };
  private dashTimeout?: number;
  private dashEndTimeout?: number;
  private dashCooldownEndTime = 0;
  private invincibilityTimeout?: number;
  private invincible = false;
  private readonly DASH_COOLDOWN = PLAYER_CONFIG.ABILITIES.DASH.COOLDOWN_MS;
  private dashDuration = PLAYER_CONFIG.ABILITIES.DASH.DURATION_MS;
  private dashSpeed = PLAYER_CONFIG.ABILITIES.DASH.SPEED_MULTIPLIER;

  // Parry mechanic
  private isParryActive = false;
  private parryStartTime = 0;
  private parryAvailable = true;
  private parryCooldownEndTime = 0;
  private parryCooldownTimeout?: number;
  private parryWindowTimeout?: number;
  private readonly PARRY_WINDOW_MS = PLAYER_CONFIG.ABILITIES.PARRY?.DURATION_MS || 300;
  private readonly PARRY_COOLDOWN_MS = PLAYER_CONFIG.ABILITIES.PARRY?.COOLDOWN_MS || 1500;
  private parrySuccessCount = 0;

  // Movement - territory speed is local (affects movement calculation in update())
  private territorySpeedMultiplier = 1.0; // Applied from faction territory effects

  // Territory effect caching for performance
  private cachedTerritoryEffects: TerritoryEffects | null = null;
  private lastTerritoryCheck = { x: 0, y: 0 };

  // Mouse world position for beam aiming (beam always follows cursor)
  private mouseWorldPosition: { x: number; y: number } | null = null;

  // Cosmetics animation
  private animationTime = 0;

  // Charge values (0-100 range) — synced from ECS via setDualCharges(), read-only display
  private movementCharge = 0;
  private focusCharge = 0;
  private timeSinceLastMovement = 0;
  // Fire cooldown readiness (0-100): 0 = just fired, 100 = ready to fire.
  // Synced from ECS DualChargingComponent via setFireCooldownPercent().
  private fireReadyPercent = 100;
  // Focus charging state tracking (managed by DualChargingSystemService)
  private isFocusCharging = false;
  private timeSinceLastDamage = 0;
  /** Local hit-confirmation envelope; separate from invincibility/dash state. */
  private lastDamageVisualTime = Number.NEGATIVE_INFINITY;
  /** World-space bearing from the ship toward the most recent damage source. */
  private lastDamageSourceAngle: number | null = null;
  private isCurrentlyMoving = false;
  private pendingChargeShot = false;

  private bladeSpeedBoost = 0;
  private currentRotationMultiplier = 1.0; // For visual effects based on rotation speed
  private gameJustStarted = true;

  /** True on coarse-touch devices (phones/tablets). Enables touch-specific aim behaviour. */
  private readonly isTouchDevice = isCoarseTouchDevice();
  /**
   * Timestamp of the last aim-stick input (setAimAngle / stopDirectionChange on touch).
   * Used to enforce the idle-spin grace window: after the player releases the aim stick,
   * idle auto-sweep stays suppressed for AIM_IDLE_SPIN_GRACE_MS before it resumes.
   */
  private lastAimInputTime = 0;

  /** Intensity level from IntensityService (0.0–1.0). Drives visual glow/trail effects. */
  public intensityLevel = 0;

  /** True when Berserker Protocol is active. Shifts ship halo from cyan → red. */
  public berserkerActive = false;

  // Need a reference to the engine service
  private gameEngine: PlayerGameEngine | null = null;

  private readonly PLAYER_RADIUS = PLAYER_CONFIG.PHYSICS.RADIUS;

  // PERFORMANCE: Pre-allocated dash arrays to avoid per-frame allocation in render
  private static readonly DASH_4_4: number[] = [4, 4];
  private static readonly EMPTY_DASH: number[] = [];
  private static readonly DAMAGE_FEEDBACK_DURATION_MS = 420;
  private static readonly DAMAGE_HULL_BLINK_DURATION_MS = 240;
  private static readonly ROTATION_INDICATOR_DASH: number[] = Array.from(
    PLAYER_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR.DASH_PATTERN
  );

  /** PERFORMANCE: Cache parsed RGB values for hex strings — avoids regex + object alloc every frame. */
  private readonly hexToRgbCache = new Map<string, { r: number; g: number; b: number } | null>();

  /**
   * PERFORMANCE: Offscreen canvas cache for all ship body variants.
   * Key = `shapeId|fillColor|isMoving|isDayMode`. Each variant is baked once into an
   * offscreen canvas; rotation is NOT baked (applied to main canvas before blit).
   * Default shape canvas size: 52×37 (origin 20,17 — 2 px margin on every edge).
   * Alternative shapes use a slightly larger 64×64 canvas to accommodate wider geometry.
   */
  private readonly _shipBodyCanvasMap = new Map<string, HTMLCanvasElement>();
  // Actual default-ship extents at scale=1.5: x ∈ [-18, 30], y ∈ [-15, 18].
  // Canvas is 52 × 37; origin at (20, 17) leaves 2 px margin on every edge.
  private static readonly _SHIP_CANVAS_W = 52;
  private static readonly _SHIP_CANVAS_H = 37;
  private static readonly _SHIP_ORIGIN_X = 20;
  private static readonly _SHIP_ORIGIN_Y = 17;
  // Alternative shapes use a square canvas (origin at centre).
  private static readonly _ALT_SHIP_CANVAS_W = 64;
  private static readonly _ALT_SHIP_CANVAS_H = 64;
  private static readonly _ALT_SHIP_ORIGIN = 32; // cx = cy = 32

  // PERFORMANCE: Pre-allocated phase offsets for sparkling-stars — allocated once.
  private static readonly _STAR_PHASES: ReadonlyArray<number> = [0, 1.26, 2.51, 3.77, 0.63];
  private static readonly _STAR_RADII: ReadonlyArray<number> = [22, 27, 20, 25, 18];

  // FactionStandingSystemService injected later to avoid circular dependency
  private factionStandingSystem: FactionStandingSystemService | null = null;

  constructor(
    private cosmetics: CosmeticsService,
    private debugLog: DebugLogBridgeService,
    private themeService: ThemeService,
    private playerUpgrades: PlayerUpgradesService,
    private directionTracker: PlayerDirectionTrackerService,
    private playerSlowDebuff: PlayerSlowDebuffHelper,
    private zoneStateService: ZoneStateService,
    private paletteService: PaletteService,
    private audio: AudioService,
    private ngZone: NgZone
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // Method to set the GameEngineService instance (for circular dependency)
  setGameEngine(engine: {
    getWorldWidth?: () => number;
    getWorldHeight?: () => number;
    movementSpeedMultiplier?: number;
  }): void {
    this.gameEngine = engine;

    // Send player service initialization to debug bridge
    this.debugLog.log('Player Service Initialized', 'info', {
      source: 'player_service_init',
      name: 'PlayerService',
      timestamp: Date.now(),
      phase: 'game_engine_connected',
      initial_position: { x: this.x$.value, y: this.y$.value },
    });
  }

  // Method to set the FactionStandingSystemService instance (for circular dependency)
  setFactionStandingSystem(factionSystem: FactionStandingSystemService): void {
    this.factionStandingSystem = factionSystem;
    this.debugLog.log('Faction System Connected', 'info', {
      source: 'player_service',
      phase: 'faction_system_connected',
    });
  }

  // API
  setGameActive(active: boolean): void {
    this.isGameActive = active;
    if (!active) {
      this.resetKeys();
    }
  }

  resetKeys(): void {
    this.keys = {};
  }

  setKey(key: string, pressed: boolean): void {
    const lowerKey = key.toLowerCase();
    this.keys[lowerKey] = pressed;

    // Debug key input
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(lowerKey)) {
      this.debugLog.log(`⌨️ Key ${pressed ? 'pressed' : 'released'}: ${lowerKey}`, 'info', {
        source: 'player_input',
        key: lowerKey,
        pressed,
        allKeys: Object.keys(this.keys).filter((k) => this.keys[k]),
      });
    }
  }

  reset(): void {
    this.clearTransientTimers();
    this.resetKeys();
    // Baked ship-body canvases are keyed by shape|color|motion|theme; clear per run so
    // cosmetic experimentation across many runs can't grow the cache unbounded (rebake
    // is a one-time cost per variant).
    this._shipBodyCanvasMap.clear();
    // Spawn at world center, not at edge
    this.x$.next(6000); // Center of 12000 width world
    this.y$.next(4500); // Center of 9000 height world
    this.angle = 0;

    // Reset movement and charging state
    this.isCurrentlyMoving = false;
    this.movementCharge = 0;
    this.focusCharge = 0;
    this.isFocusCharging = false;

    // Reset ALL upgrade multipliers on death/respawn via PlayerUpgradesService
    this.playerUpgrades.reset();
    this.directionTracker.reset();
    this.cachedBeamDamageMult = 1.0;
    this.cachedBeamWidthMult = 1.0;

    this.DISCHARGE_COOLDOWN = PLAYER_CONFIG.WEAPONS.DISCHARGE.COOLDOWN_MS;
    this.dischargeAvailable = true;
    this.dischargeRemainingMs = 0;
    this.isChargingDischargeState = false;
    this.dischargeChargeLevel = 0;
    this.dischargeChargeStartTime = 0;
    this.dashAvailable = true;
    this.dashInProgress = false;
    this.dashDirection = { x: 0, y: 0 };
    this.dashCooldownEndTime = 0;
    this.directionChangeCooldown = false;
    this.directionChangeActive = false;
    this.targetAngle = 0;
    this.playerSlowDebuff.reset();
    this.isParryActive = false;
    this.parryStartTime = 0;
    this.parryAvailable = true;
    this.parryCooldownEndTime = 0;
    this.parrySuccessCount = 0;

    // Beam ON by default, manual aim mode
    this._isFiring = true;
    this.isAutoBeam = false;
    this.autoBeamSubject.next(false);
    this.isShiftFiring = false;
    this.isFocusFiring = false;
    this.focusFireSubject.next(false);

    // Reset dual bucket charging system
    this.movementCharge = 0;
    this.focusCharge = 0;
    this.pendingChargeShot = false;
    this.bladeSpeedBoost = 0;
    this.timeSinceLastMovement = 0;
    this.timeSinceLastDamage = 0;
    this.lastDamageVisualTime = Number.NEGATIVE_INFINITY;
    this.lastDamageSourceAngle = null;
    this.gameJustStarted = true; // Reset the startup flag
    this.fireReadyPercent = 100;

    // Entity creation owns spawn protection. Reset must leave no stale
    // invincibility before the replacement PlayerControlled entity exists.
    this.invincible = false;

    // Notify subscribers that cooldowns have been reset
    this.cooldownResetSubject.next();
  }

  /** Restore a persisted position into the authoritative movement state. */
  restorePosition(x: number, y: number): void {
    const safeX = Number.isFinite(x)
      ? Math.max(0, Math.min(x, WORLD_CONFIG.BOUNDS.WIDTH))
      : WORLD_CONFIG.BOUNDS.WIDTH / 2;
    const safeY = Number.isFinite(y)
      ? Math.max(0, Math.min(y, WORLD_CONFIG.BOUNDS.HEIGHT))
      : WORLD_CONFIG.BOUNDS.HEIGHT / 2;
    this.x$.next(safeX);
    this.y$.next(safeY);
  }

  private clearTransientTimers(): void {
    window.clearTimeout(this.directionChangeTimeout);
    window.clearTimeout(this.directionChangeEndTimeout);
    window.clearTimeout(this.dischargeTimeout);
    window.clearTimeout(this.dashTimeout);
    window.clearTimeout(this.dashEndTimeout);
    window.clearTimeout(this.invincibilityTimeout);
    window.clearTimeout(this.parryWindowTimeout);
    window.clearTimeout(this.parryCooldownTimeout);

    this.directionChangeTimeout = undefined;
    this.directionChangeEndTimeout = undefined;
    this.dischargeTimeout = undefined;
    this.dashTimeout = undefined;
    this.dashEndTimeout = undefined;
    this.invincibilityTimeout = undefined;
    this.parryWindowTimeout = undefined;
    this.parryCooldownTimeout = undefined;
  }

  getGameActive(): boolean {
    return this.isGameActive;
  }

  getAngle(): number {
    return this.angle;
  }

  /**
   * Update mouse position in world coordinates for beam aiming.
   * Called continuously by the game component on mouse move.
   */
  updateMousePosition(worldX: number, worldY: number): void {
    this.mouseWorldPosition = { x: worldX, y: worldY };
  }

  /**
   * Returns the last known mouse position in world coordinates.
   * Used by keyboard handlers (e.g. SHIFT) that need cursor coordinates.
   */
  getMouseWorldPosition(): { x: number; y: number } | null {
    return this.mouseWorldPosition;
  }

  isActive(): boolean {
    return this.isGameActive;
  }

  getActiveKeys(): string[] {
    return Object.entries(this.keys)
      .filter(([_, pressed]) => pressed)
      .map(([key]) => key.toUpperCase());
  }

  isInvincible(): boolean {
    return this.invincible;
  }

  /**
   * Activate spawn protection when player entity is created
   * This ensures protection starts from entity creation, not from reset()
   */
  activateSpawnProtection(): void {
    this.invincible = true;
    window.clearTimeout(this.invincibilityTimeout);
    this.ngZone.runOutsideAngular(() => {
      this.invincibilityTimeout = window.setTimeout(() => {
        this.invincible = false;
        if (window.debugLogBridge) {
          window.debugLogBridge.log('🛡️ Spawn protection expired', 'info', {
            source: 'player_service',
            operation: 'spawn_protection_end',
          });
        }
      }, PLAYER_CONFIG.SPAWN_PROTECTION.DURATION_MS);
    });
  }

  /**
   * Activate invincibility for a specified duration
   */
  activateInvincibility(durationMs: number): void {
    this.invincible = true;
    window.clearTimeout(this.invincibilityTimeout);
    this.ngZone.runOutsideAngular(() => {
      this.invincibilityTimeout = window.setTimeout(() => {
        this.invincible = false;
      }, durationMs);
    });
  }

  /**
   * Deactivate invincibility (used when spawn protection expires)
   */
  deactivateInvincibility(): void {
    this.invincible = false;
    window.clearTimeout(this.invincibilityTimeout);
  }

  /**
   * Handle damage event — charge management is ECS-only (DualChargingComponent).
   * PlayerService just tracks timing for damage debounce.
   */
  onDamageTaken(damageAmount: number = 0): void {
    this.timeSinceLastDamage = 0;
    this.lastDamageVisualTime = window.performance.now();
    // GameState owns the damage event but does not always have a world-space
    // source. Clear stale direction until the originating system supplies one.
    this.lastDamageSourceAngle = null;

    this.debugLog.log('Player took damage', 'info', {
      source: 'player_damage',
      damageAmount,
    });
  }

  /**
   * Attach a world-space source to the damage event emitted moments earlier.
   * CollisionSystem calls this after GameState has committed damage, so visual
   * direction never becomes an authorization path for health changes.
   */
  setDamageFeedbackSource(sourceX: number, sourceY: number): void {
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) return;
    this.lastDamageSourceAngle = Math.atan2(sourceY - this.y$.value, sourceX - this.x$.value);
  }

  isDashAvailable(): boolean {
    return this.dashAvailable;
  }

  isDischargeAvailable(): boolean {
    return this.dischargeAvailable;
  }

  isDirectionChangeOnCooldown(): boolean {
    return this.directionChangeCooldown;
  }

  getSpeedMultiplier(): number {
    return this.playerUpgrades.getSpeedMultiplier();
  }

  // --- EMP Slow Debuff (Disruptor mechanic) ---

  /**
   * Apply a movement slow debuff.
   * Non-stacking: a second call refreshes duration rather than stacking the multiplier.
   * @param factor Fraction of speed to remove (0.4 = 40% slower → 0.6x speed)
   * @param durationMs How long the slow lasts in milliseconds
   */
  applySlow(factor: number, durationMs: number): void {
    this.playerSlowDebuff.applySlow(factor, durationMs);
  }

  /** True while a slow debuff is active. */
  isSlowed(): boolean {
    return this.playerSlowDebuff.isSlowed();
  }

  /** Remaining ms on the current slow, 0 if not slowed. */
  getSlowRemainingMs(): number {
    return this.playerSlowDebuff.getSlowRemainingMs();
  }

  // --- Max Health Methods - Delegating to PlayerUpgradesService ---
  getMaxHealth(): number {
    return this.playerUpgrades.getMaxHealth();
  }

  /** Directly sets the maximum health. */
  setMaxHealth(newMax: number): void {
    this.playerUpgrades.setMaxHealth(newMax);
    // Note: Clamping current health needs to happen in GameEngineService
    // when this is called.
  }

  /**
   * Increases max health by a flat amount.
   * Accepts negative numbers to decrease max health.
   */
  increaseMaxHealth(amount: number): void {
    this.playerUpgrades.increaseMaxHealth(amount);
    // Note: Healing/clamping current health is handled by GameEngineService after calling this.
  }
  // --- End Max Health Methods ---

  increaseSpeed(amount: number): void {
    this.playerUpgrades.increaseSpeed(amount);
  }

  reduceDischargeTime(reductionFraction: number): void {
    const safeReduction = Math.max(0, Math.min(0.9, reductionFraction));
    this.DISCHARGE_COOLDOWN = Math.max(1000, this.DISCHARGE_COOLDOWN * (1 - safeReduction));
    // Debug: Player upgrade - discharge cooldown

    if (!this.dischargeAvailable) {
      this.dischargeRemainingMs = Math.min(this.dischargeRemainingMs, this.DISCHARGE_COOLDOWN);
      this.cooldownResetSubject.next();
    }
  }

  getDischargeCooldown(): number {
    return this.DISCHARGE_COOLDOWN;
  }

  // --- Shop Upgrade Methods - Delegating to PlayerUpgradesService ---
  increaseDischargeRadius(multiplier: number): void {
    this.playerUpgrades.increaseDischargeRadius(multiplier);
  }

  increaseBeamWidth(multiplier: number): void {
    this.playerUpgrades.increaseBeamWidth(multiplier);
    this.cachedBeamWidthMult = this.playerUpgrades.getBeamWidthMultiplier();
  }

  setHealthRegeneration(healthPerSecond: number): void {
    this.playerUpgrades.setHealthRegeneration(healthPerSecond);
  }

  setCriticalHitChance(chance: number): void {
    this.playerUpgrades.setCriticalHitChance(chance);
  }

  setCriticalHitMultiplier(multiplier: number): void {
    this.playerUpgrades.setCriticalHitMultiplier(multiplier);
  }

  setShardMultiplier(multiplier: number): void {
    this.playerUpgrades.setShardMultiplier(multiplier);
  }

  // Getters for upgrade values - Delegating to PlayerUpgradesService
  getDischargeRadiusMultiplier(): number {
    return this.playerUpgrades.getDischargeRadiusMultiplier();
  }

  getBeamWidthMultiplier(): number {
    return this.playerUpgrades.getBeamWidthMultiplier();
  }

  getHealthRegenRate(): number {
    return this.playerUpgrades.getHealthRegenRate();
  }

  getCriticalHitChance(): number {
    return this.playerUpgrades.getCriticalHitChance();
  }

  getCriticalHitMultiplier(): number {
    return this.playerUpgrades.getCriticalHitMultiplier();
  }

  getShardMultiplier(): number {
    return this.playerUpgrades.getShardMultiplier();
  }

  // Protocol upgrade methods - Delegating to PlayerUpgradesService
  setEmergencyProtocols(enabled: boolean, multiplier: number = 1.5): void {
    this.playerUpgrades.setEmergencyProtocols(enabled, multiplier);
  }

  hasEmergencyProtocols(): boolean {
    return this.playerUpgrades.hasEmergencyProtocols();
  }

  getEmergencyHealingMultiplier(): number {
    return this.playerUpgrades.getEmergencyHealingMultiplier();
  }

  setBerserkerProtocol(enabled: boolean, maxBonus: number = 1.0): void {
    this.playerUpgrades.setBerserkerProtocol(enabled, maxBonus);
  }

  hasBerserkerProtocol(): boolean {
    return this.playerUpgrades.hasBerserkerProtocol();
  }

  getBerserkerMaxBonus(): number {
    return this.playerUpgrades.getBerserkerMaxBonus();
  }

  setVelocityMatrix(enabled: boolean, speedBonus: number = 0.05, damageBonus: number = 0.05): void {
    this.playerUpgrades.setVelocityMatrix(enabled, speedBonus, damageBonus);
  }

  hasVelocityMatrix(): boolean {
    return this.playerUpgrades.hasVelocityMatrix();
  }

  getVelocityMatrixBonuses(): { speedBonus: number; damageBonus: number } {
    return this.playerUpgrades.getVelocityMatrixBonuses();
  }

  setShardSynthesis(enabled: boolean, duration: number = 2000): void {
    this.playerUpgrades.setShardSynthesis(enabled, duration);
  }

  hasShardSynthesis(): boolean {
    return this.playerUpgrades.hasShardSynthesis();
  }

  getShardSynthesisDuration(): number {
    return this.playerUpgrades.getShardSynthesisDuration();
  }

  // Beam upgrades - Delegating to PlayerUpgradesService
  increaseBeamDamage(percentage: number): void {
    this.playerUpgrades.increaseBeamDamage(percentage);
    this.cachedBeamDamageMult = this.playerUpgrades.getBeamDamageMultiplier();
  }

  getBeamDamageMultiplier(): number {
    return this.playerUpgrades.getBeamDamageMultiplier();
  }

  increaseBeamRotationSpeed(percentage: number): void {
    this.playerUpgrades.increaseBeamRotationSpeed(percentage);
  }

  getBeamRotationMultiplier(): number {
    return (
      this.playerUpgrades.getBeamRotationMultiplier() * this.playerUpgrades.getBeamCoreProfile().rotationMultiplier
    );
  }

  // Dash cooldown - Delegating to PlayerUpgradesService
  increaseDashEfficiency(percentage: number): void {
    this.playerUpgrades.increaseDashEfficiency(percentage);
  }

  getDashCooldownReduction(): number {
    return this.playerUpgrades.getDashCooldownReduction();
  }

  getEffectiveDashCooldown(): number {
    return this.DASH_COOLDOWN * (1 - this.playerUpgrades.getDashCooldownReduction());
  }

  // Burn upgrades - Delegating to PlayerUpgradesService
  addBurnChance(percentage: number): void {
    this.playerUpgrades.addBurnChance(percentage);
  }

  getBurnChance(): number {
    return this.playerUpgrades.getBurnChance();
  }

  getBurnDamage(): number {
    return this.playerUpgrades.getBurnDamage();
  }

  increaseBurnDamage(percentage: number): void {
    this.playerUpgrades.increaseBurnDamage(percentage);
  }

  getBurnDamageMultiplier(): number {
    return this.playerUpgrades.getBurnDamageMultiplier();
  }

  // Misc upgrades - Delegating to PlayerUpgradesService
  addRecoilDamage(percentage: number): void {
    this.playerUpgrades.addRecoilDamage(percentage);
  }

  getRecoilDamage(): number {
    return this.playerUpgrades.getRecoilDamage();
  }

  enhanceShardMagnetism(amount: number): void {
    this.playerUpgrades.enhanceShardMagnetism(amount);
  }

  getShardMagnetismBonus(): number {
    return this.playerUpgrades.getShardMagnetismBonus();
  }

  increaseBeamSpeed(percentage: number): void {
    this.playerUpgrades.increaseBeamSpeed(percentage);
  }

  getBeamSpeedMultiplier(): number {
    return this.playerUpgrades.getBeamSpeedMultiplier();
  }

  // Effect chance - Delegating to PlayerUpgradesService
  increaseEffectChance(percentage: number): void {
    this.playerUpgrades.increaseEffectChance(percentage);
  }

  getEffectChanceBonus(): number {
    return this.playerUpgrades.getEffectChanceBonus();
  }

  // Targeting hold - Delegating to PlayerUpgradesService
  increaseTargetingHoldDuration(count: number): void {
    this.playerUpgrades.increaseTargetingHoldDuration(count);
  }

  getTargetingHoldBonus(): number {
    return this.playerUpgrades.getTargetingHoldBonus();
  }

  getHasDoubleBeam(): boolean {
    return this.playerUpgrades.getHasDoubleBeam();
  }

  // Fire rate - Delegating to PlayerUpgradesService
  increaseFireRate(percentage: number): void {
    this.playerUpgrades.increaseFireRate(percentage);
  }

  getFireRateMultiplier(): number {
    return this.playerUpgrades.getFireRateMultiplier();
  }

  // Unlock methods - Delegating to PlayerUpgradesService
  unlockShardMagnetism(): void {
    this.playerUpgrades.unlockShardMagnetism();
  }

  unlockDoubleBeam(): void {
    this.playerUpgrades.unlockDoubleBeam();
  }

  unlockDischarge(): void {
    this.playerUpgrades.unlockDischarge();
  }

  unlockVoidBeam(): void {
    this.playerUpgrades.unlockVoidBeam();
  }

  unlockShieldBreaker(): void {
    this.playerUpgrades.unlockShieldBreaker();
  }

  // Getters for unlock status - Delegating to PlayerUpgradesService
  getHasShardMagnetism(): boolean {
    return this.playerUpgrades.getHasShardMagnetism();
  }
  getHasDischarge(): boolean {
    return this.playerUpgrades.getHasDischarge();
  }
  getHasVoidBeam(): boolean {
    return this.playerUpgrades.getHasVoidBeam();
  }
  getHasShieldBreaker(): boolean {
    return this.playerUpgrades.getHasShieldBreaker();
  }

  get isFiring(): boolean {
    return this._isFiring;
  }

  setFiring(firing: boolean): void {
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🎯 FIRING DEBUG: setFiring called', 'info', {
        source: 'player_service',
        operation: 'setFiring',
        newValue: firing,
        oldValue: this._isFiring,
        changed: this._isFiring !== firing,
      });
    }
    this._isFiring = firing;

    // Verify the value was set correctly
    if (window.debugLogBridge) {
      window.debugLogBridge.log('🎯 FIRING DEBUG: setFiring complete', 'success', {
        source: 'player_service',
        operation: 'setFiring_verification',
        expectedValue: firing,
        actualValue: this._isFiring,
        success: this._isFiring === firing,
      });
    }
  }
  // --- Auto-Beam Mode ---
  toggleAutoBeam(): void {
    this.isAutoBeam = !this.isAutoBeam;
    this.autoBeamSubject.next(this.isAutoBeam);

    if (window.debugLogBridge) {
      window.debugLogBridge.log(this.isAutoBeam ? '🔄 AUTO-BEAM ON' : '🎯 MANUAL-BEAM ON', 'info', {
        source: 'player_service',
        mode: this.isAutoBeam ? 'AUTO' : 'MANUAL',
      });
    }
  }

  getIsAutoBeam(): boolean {
    return this.isAutoBeam;
  }

  // --- Shooting Mode (Shift toggle) ---
  // Beam and shooting are mutually exclusive:
  // Beam mode (default): beam on, no projectiles
  // Shooting mode: beam off, projectiles fire
  toggleShootingMode(): void {
    this.isShiftFiring = !this.isShiftFiring;

    if (this.isShiftFiring) {
      // Entering shooting mode: hide beam, disable auto-beam
      this._isFiring = false;
      if (this.isAutoBeam) {
        this.isAutoBeam = false;
        this.autoBeamSubject.next(false);
      }
    } else {
      // Exiting shooting mode: restore beam (manual aim, not auto-beam)
      this._isFiring = true;
      // Clear focus fire state when leaving shooting mode
      if (this.isFocusFiring) {
        this.isFocusFiring = false;
        this.focusFireSubject.next(false);
      }
    }

    this.debugLog.log(this.isShiftFiring ? '🔫 SHOOTING MODE ON' : '⚡ BEAM MODE ON', 'info', {
      source: 'player_service',
      mode: this.isShiftFiring ? 'SHOOTING' : 'BEAM',
      beamActive: this._isFiring,
    });
  }

  setShiftFiring(firing: boolean): void {
    this.isShiftFiring = firing;
    // Keep beam/shooting mutually exclusive
    this._isFiring = !firing;
  }

  getIsShiftFiring(): boolean {
    return this.isShiftFiring;
  }

  // --- Focus Fire (Shift toggle in shooting mode) ---
  setFocusFire(active: boolean): void {
    if (this.isFocusFiring === active) return;
    this.isFocusFiring = active;
    this.focusFireSubject.next(active);

    if (window.debugLogBridge) {
      window.debugLogBridge.log(active ? '🎯 FOCUS FIRE ON' : '🎯 FOCUS FIRE OFF', 'info', {
        source: 'player_service',
        mode: active ? 'FOCUS' : 'NORMAL',
      });
    }
  }

  getIsFocusFiring(): boolean {
    return this.isFocusFiring;
  }

  /** Focus Fire damage multiplier when active, 1.0 otherwise. */
  getFocusFireDamageMultiplier(): number {
    return this.isFocusFiring ? PLAYER_CONFIG.FOCUS_FIRE.DAMAGE_MULTIPLIER : 1.0;
  }

  /** Focus Fire fire-rate multiplier (< 1 = slower) when active, 1.0 otherwise. */
  getFocusFireRateMultiplier(): number {
    return this.isFocusFiring ? PLAYER_CONFIG.FOCUS_FIRE.FIRE_RATE_MULTIPLIER : 1.0;
  }

  // --- End Shop Upgrade Methods ---

  getDischargeRemaining(): number {
    return this.dischargeRemainingMs;
  }

  getDischargePercent(): number {
    return this.dischargeAvailable ? 0 : (this.dischargeRemainingMs / this.DISCHARGE_COOLDOWN) * 100;
  }

  getDashCooldown(): number {
    return this.DASH_COOLDOWN;
  }

  // Sets the direction change cooldown time
  setDirectionCooldown(cooldownMs: number): void {
    this.DIRECTION_COOLDOWN = cooldownMs;
    // Debug: Player upgrade - direction cooldown
  }

  // Main update loop
  update(deltaTime: number): void {
    if (!this.isGameActive || !this.gameEngine) return;

    this.animationTime += deltaTime / 1000;
    if (this.animationTime > 1000) this.animationTime = 0;

    // Health regeneration moved to GameStateService to avoid duplication
    // TerritoryEffectSystem and GameStateService handle all health changes

    // Update beam sweep animation
    if (this.beamSweepAnimation.active) {
      this.beamSweepAnimation.progress += deltaTime / this.beamSweepAnimation.duration;
      if (this.beamSweepAnimation.progress >= 1) {
        this.beamSweepAnimation.active = false;
      }
    }

    // In auto-beam mode, beam spins on its own (passive rotation handles this below).
    // In manual mode, beam follows cursor.
    if (!this.isAutoBeam && this.mouseWorldPosition) {
      const dx = this.mouseWorldPosition.x - this.x$.value;
      const dy = this.mouseWorldPosition.y - this.y$.value;
      const distSq = dx * dx + dy * dy;

      // Only update angle if mouse is far enough from player (prevents jitter when cursor is on player)
      if (distSq > 100) {
        // 10px minimum distance
        this.angle = Math.atan2(dy, dx);
      }
    } else if (this.directionChangeActive && this.targetAngle !== this.angle) {
      let diff = this.targetAngle - this.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rot = Math.min(Math.abs(diff), this.MAX_ROTATION_SPEED * this.getBeamRotationMultiplier());

      // Trigger sweep animation for significant angle changes
      if (Math.abs(diff) > 0.1 && !this.beamSweepAnimation.active) {
        this.beamSweepAnimation.active = true;
        this.beamSweepAnimation.startAngle = this.angle;
        this.beamSweepAnimation.targetAngle = this.targetAngle;
        this.beamSweepAnimation.progress = 0;
      }

      this.angle += rot * (diff > 0 ? 1 : -1);
      while (this.angle > Math.PI) this.angle -= Math.PI * 2;
      while (this.angle < -Math.PI) this.angle += Math.PI * 2;
    }

    // Get territory effects with caching for performance
    const distX = Math.abs(this.x$.value - this.lastTerritoryCheck.x);
    const distY = Math.abs(this.y$.value - this.lastTerritoryCheck.y);

    // Only recalculate if player moved significantly or cache is empty
    if (
      this.factionStandingSystem &&
      (distX > FACTION_CONFIG.CACHE_DISTANCE_THRESHOLD ||
        distY > FACTION_CONFIG.CACHE_DISTANCE_THRESHOLD ||
        !this.cachedTerritoryEffects)
    ) {
      this.cachedTerritoryEffects = this.factionStandingSystem.getTerritoryEffects(this.x$.value, this.y$.value);
      this.lastTerritoryCheck = { x: this.x$.value, y: this.y$.value };

      // Debug log when territory effects change
      if (Math.random() < FACTION_CONFIG.DEBUG_LOG_CHANCE) {
        this.debugLog.log('Territory Effects Updated', 'info', {
          source: 'player_service',
          position: { x: this.x$.value.toFixed(0), y: this.y$.value.toFixed(0) },
          effects: this.cachedTerritoryEffects,
          moved: { dx: distX.toFixed(0), dy: distY.toFixed(0) },
        });
      }
    }

    // Use cached effects or default to neutral if no faction system
    this.territorySpeedMultiplier = this.cachedTerritoryEffects?.speedMultiplier ?? 1.0;

    // Focus Fire slows movement (precision tradeoff) — upgradeable from 20% to 5% penalty
    const focusFireSpeedMult = this.isFocusFiring ? this.playerUpgrades.getFocusFireSpeedMultiplier() : 1.0;
    // EMP slow debuff (Disruptor mechanic) — auto-expires on check
    const empSlowMult = this.isSlowed() ? this.playerSlowDebuff.getCurrentMultiplier() : 1.0;
    const baseSpeed =
      PLAYER_CONFIG.PHYSICS.BASE_SPEED *
      this.playerUpgrades.getSpeedMultiplier() *
      this.territorySpeedMultiplier *
      1.0 *
      focusFireSpeedMult *
      empSlowMult *
      (this.gameEngine?.movementSpeedMultiplier ?? 1);

    let inputX = 0;
    let inputY = 0;
    if (this.keys['arrowup'] || this.keys['w']) inputY = -1;
    if (this.keys['arrowdown'] || this.keys['s']) inputY = 1;
    if (this.keys['arrowleft'] || this.keys['a']) inputX = -1;
    if (this.keys['arrowright'] || this.keys['d']) inputX = 1;

    let dx = inputX * baseSpeed * deltaTime;
    let dy = inputY * baseSpeed * deltaTime;

    if (inputX !== 0 || inputY !== 0) {
      this.directionTracker.recordMovementDirection(inputX, inputY);
    }

    if (dx !== 0 && dy !== 0) {
      const diagonalFactor = PLAYER_CONFIG.PHYSICS.DIAGONAL_SPEED_FACTOR;
      dx *= diagonalFactor;
      dy *= diagonalFactor;
    }

    if (this.dashInProgress && this.dashDirection) {
      const dashSpeed = this.dashSpeed || 0;
      dx += this.dashDirection.x * dashSpeed * baseSpeed * deltaTime;
      dy += this.dashDirection.y * dashSpeed * baseSpeed * deltaTime;
    }

    const worldWidth = this.gameEngine?.getWorldWidth?.() ?? WORLD_CONFIG.BOUNDS.WIDTH;
    const worldHeight = this.gameEngine?.getWorldHeight?.() ?? WORLD_CONFIG.BOUNDS.HEIGHT;
    const minX = this.PLAYER_RADIUS + WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN;
    const minY = this.PLAYER_RADIUS + WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN;
    const maxX = worldWidth - this.PLAYER_RADIUS - WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN;
    const maxY = worldHeight - this.PLAYER_RADIUS - WORLD_CONFIG.SPAWN_MARGINS.BOUNDARY_DAMAGE_MARGIN;

    if (this.x$.value < minX) {
      this.x$.next(minX);
    }
    if (this.y$.value < minY) {
      this.y$.next(minY);
    }
    if (this.x$.value > maxX) {
      this.x$.next(maxX);
    }
    if (this.y$.value > maxY) {
      this.y$.next(maxY);
    }

    const oldX = this.x$.value;
    const oldY = this.y$.value;
    const newX = Math.max(minX, Math.min(maxX, this.x$.value + dx));
    const newY = Math.max(minY, Math.min(maxY, this.y$.value + dy));

    this.x$.next(newX);
    this.y$.next(newY);

    // Soft push-back from locked zones
    const pushBack = this.zoneStateService.getLockedZonePushBack(newX, newY);
    if (pushBack) {
      const pushedX = Math.max(minX, Math.min(maxX, newX + pushBack.dx));
      const pushedY = Math.max(minY, Math.min(maxY, newY + pushBack.dy));
      this.x$.next(pushedX);
      this.y$.next(pushedY);
    }

    // DEBUG: Significant movement tracking
    const distance = MathUtilsService.distance(oldX, oldY, newX, newY);
    if (distance > PLAYER_CONFIG.COOLDOWN_ACCELERATION.MOVEMENT_THRESHOLD) {
      // Only log significant movements
      // Debug: Movement track
    }

    // CRITICAL: Use input state for movement detection, not actual movement deltas
    // This ensures charging works even when player is against boundaries/walls
    // Before: Used dx/dy which could be 0 when blocked, breaking charging
    // After: Uses inputX/inputY which represents actual player input intent
    const isMoving = inputX !== 0 || inputY !== 0;
    this.isCurrentlyMoving = isMoving; // Track movement state for charging system
    const deltaSeconds = deltaTime / 1000; // Convert to seconds

    // Debug movement detection
    if (Math.random() < 0.05) {
      // Log 5% of frames
      this.debugLog.log('🎮 Movement Debug', 'info', {
        source: 'player_movement',
        keys: {
          w: this.keys['w'] || false,
          a: this.keys['a'] || false,
          s: this.keys['s'] || false,
          d: this.keys['d'] || false,
          arrowUp: this.keys['arrowup'] || false,
          arrowDown: this.keys['arrowdown'] || false,
          arrowLeft: this.keys['arrowleft'] || false,
          arrowRight: this.keys['arrowright'] || false,
        },
        input: { x: inputX, y: inputY },
        isMoving: isMoving,
        isCurrentlyMoving: this.isCurrentlyMoving,
        position: { x: this.x$.value, y: this.y$.value },
        delta: { dx, dy },
      });
    }

    // Debug movement detection - validate the fix is working
    if (Math.random() < 0.02) {
      const movementDeltaWouldSayStationary = dx === 0 && dy === 0;
      const inputSaysMoving = inputX !== 0 || inputY !== 0;
      const fixWorking = inputSaysMoving && movementDeltaWouldSayStationary;

      this.debugLog.log('🚶 Movement Detection', 'info', {
        source: 'player_service',
        inputX,
        inputY,
        dx: dx.toFixed(3),
        dy: dy.toFixed(3),
        isMoving,
        fixApplied: fixWorking ? 'YES - Charging works at boundary!' : 'N/A',
        keys: {
          up: this.keys['arrowup'] || this.keys['w'],
          down: this.keys['arrowdown'] || this.keys['s'],
          left: this.keys['arrowleft'] || this.keys['a'],
          right: this.keys['arrowright'] || this.keys['d'],
        },
      });
    }

    // Charge state is managed entirely by DualChargingSystemService (ECS source of truth).
    // PlayerService receives charge values via setDualCharges() for HUD display only.

    if (isMoving) {
      this.gameJustStarted = false;

      if (this.isFocusCharging) {
        this.isFocusCharging = false;
      }

      this.bladeSpeedBoost = this.focusCharge / 100;
      this.timeSinceLastMovement = 0;
    } else if (!this.gameJustStarted) {
      this.timeSinceLastMovement += deltaSeconds;
      this.timeSinceLastDamage += deltaSeconds;

      this.bladeSpeedBoost = this.focusCharge / 100;
    } else {
      // Game just started - keep charges at 0 until first movement
      this.movementCharge = 0;
      this.focusCharge = 0;
      this.bladeSpeedBoost = 0;
      this.timeSinceLastMovement = 0;
      this.timeSinceLastDamage = 0;
    }

    /* -- Enhanced beam rotation with charge-based speed scaling -- */
    // Passive beam rotation: a BEAM-mode cosmetic (the spinning blade visual).
    // Touch: player-controlled aim wins — spin stays OFF while the stick is held (directionChangeActive)
    //   and for AIM_IDLE_SPIN_GRACE_MS after release, then resumes in BOTH weapon modes (idle sweep).
    // Desktop: cursor owns the angle — spin runs in beam mode only (shot mode holds the player's
    //   direction and must not override it with the cosmetic spin).
    const aimSpinGraceMs = PLAYER_CONFIG.TOUCH_AIM.AIM_IDLE_SPIN_GRACE_MS;
    const spinAllowed = this.isTouchDevice ? Date.now() - this.lastAimInputTime > aimSpinGraceMs : !this.isShiftFiring;
    if (!this.directionChangeActive && spinAllowed) {
      const baseRot = PLAYER_CONFIG.ANIMATION.PASSIVE_BEAM_ROTATION_SPEED * deltaTime;
      const chargedRotation = PLAYER_CONFIG.ANIMATION.CHARGED_ROTATION;

      if (isMoving) {
        // Normal rotation speed when moving
        this.angle += baseRot * PLAYER_CONFIG.ANIMATION.MOVING_ROTATION_MULTIPLIER;
      } else {
        // Enhanced rotation scaling based on focus charge (bladeSpeedBoost is 0-1)
        let speedMultiplier = chargedRotation.MIN_MULTIPLIER;

        if (this.bladeSpeedBoost >= chargedRotation.CHARGE_THRESHOLD) {
          // Smooth interpolation between min, mid, and max multipliers
          if (this.bladeSpeedBoost < 0.5) {
            // 10% to 50% charge: interpolate from MIN to MID
            const t =
              (this.bladeSpeedBoost - chargedRotation.CHARGE_THRESHOLD) / (0.5 - chargedRotation.CHARGE_THRESHOLD);
            speedMultiplier =
              chargedRotation.MIN_MULTIPLIER + (chargedRotation.MID_MULTIPLIER - chargedRotation.MIN_MULTIPLIER) * t;
          } else {
            // 50% to 100% charge: interpolate from MID to MAX
            const t = (this.bladeSpeedBoost - 0.5) / 0.5;
            speedMultiplier =
              chargedRotation.MID_MULTIPLIER + (chargedRotation.MAX_MULTIPLIER - chargedRotation.MID_MULTIPLIER) * t;
          }
        }

        this.angle += baseRot * speedMultiplier;

        // Store speed multiplier for visual effects
        this.currentRotationMultiplier = speedMultiplier;

        // Debug log high-speed rotation
        if (speedMultiplier >= chargedRotation.MID_MULTIPLIER && Math.random() < 0.02) {
          this.debugLog.log('🌪️ Beam Rotation Speed', 'success', {
            source: 'player_rotation',
            speedMultiplier: speedMultiplier.toFixed(2) + 'x',
            focusCharge: (this.bladeSpeedBoost * 100).toFixed(0) + '%',
            mode: this.getRotationSpeedLabel(),
            angle: ((this.angle * 180) / Math.PI).toFixed(0) + '°',
          });
        }
      }
    }

    /* ── discharge cooldown tick  (3× faster when idle) -------------- */
    if (!this.dischargeAvailable && this.dischargeRemainingMs > 0) {
      const tick = deltaTime * (isMoving ? 1 : PLAYER_CONFIG.COOLDOWN_ACCELERATION.DISCHARGE_IDLE_MULTIPLIER);
      this.dischargeRemainingMs = Math.max(0, this.dischargeRemainingMs - tick);
      if (this.dischargeRemainingMs === 0) {
        this.dischargeAvailable = true;
        this.cooldownResetSubject.next();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, _chargeLevel: number = 0): void {
    const x = this.x$.value,
      y = this.y$.value;
    const renderTime = window.performance.now();

    const shipColor = this.cosmetics.getActiveCosmetic('shipColor');
    const beamColor = this.cosmetics.getActiveCosmetic('beamColor');
    const shapeId = this.cosmetics.getActiveCosmeticId('shipShape');
    const accessory = this.cosmetics.getActiveCosmeticId('accessory');

    const damageFeedbackElapsed = renderTime - this.lastDamageVisualTime;
    const damageFeedbackActive =
      damageFeedbackElapsed >= 0 && damageFeedbackElapsed < PlayerService.DAMAGE_FEEDBACK_DURATION_MS;
    const damageBlinkDimmed =
      damageFeedbackElapsed >= 0 &&
      damageFeedbackElapsed < PlayerService.DAMAGE_HULL_BLINK_DURATION_MS &&
      Math.floor(damageFeedbackElapsed / 60) % 2 === 1;

    // Ship-local hit confirmation: an expanding ring plus a source-side bracket.
    // The full-screen flash remains peripheral context; this keeps the event legible
    // when the player is concentrating near the centre of a large display.
    if (damageFeedbackActive) {
      this.drawDamageFeedback(ctx, x, y, damageFeedbackElapsed);
    }

    // Damage and invincibility blink independently. The ship is ALWAYS drawn (the
    // player must never lose their position), and the beam stays at full alpha because
    // it remains live during i-frames.
    const invincibilityBlinkDimmed = this.invincible && Math.floor(renderTime / 80) % 2 === 1;
    const blinkDimmed = damageBlinkDimmed || invincibilityBlinkDimmed;

    // S4: Focus Fire aura — concentric orange ring rendered behind the ship
    if (this.isFocusFiring) {
      ctx.save();
      const pulseScale = 1.0 + Math.sin(renderTime * 0.006) * 0.08;
      const auraRadius = 22 * pulseScale;

      // Outer dashed ring
      ctx.strokeStyle = 'rgba(255, 140, 0, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash(PlayerService.DASH_4_4);
      ctx.beginPath();
      ctx.arc(x, y, auraRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Inner glow fill
      ctx.fillStyle = 'rgba(255, 140, 0, 0.08)';
      ctx.setLineDash(PlayerService.EMPTY_DASH);
      ctx.beginPath();
      ctx.arc(x, y, auraRadius * 0.7, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // Ship body, accessory, rotation indicator, and direction rings dim on the blink
    // off-phase during post-hit invincibility. The beam and the parry/charge rings
    // render at full alpha (beam = live weapon; rings = ability state).
    {
      if (blinkDimmed) ctx.globalAlpha = 0.35;

      // Draw ship
      this.drawShip(ctx, x, y, shapeId, shipColor);
      if (blinkDimmed) ctx.globalAlpha = 1;
      this.drawBeam(ctx, x, y, beamColor);
      if (blinkDimmed) ctx.globalAlpha = 0.35;
      this.drawAccessory(ctx, x, y, accessory);

      // Draw rotation speed indicator
      this.drawRotationSpeedIndicator(ctx, x, y);

      const showingChargingPreview = this.movementCharge > 0;

      if (!showingChargingPreview) {
        if (this.directionChangeCooldown) {
          ctx.fillStyle = RENDER_CONFIG.COLORS.PLAYER_FILL;
          ctx.beginPath();
          ctx.arc(x, y, 16, 0, Math.PI * 2);
          ctx.fill();
        } else if (this.directionChangeActive) {
          ctx.strokeStyle = RENDER_CONFIG.COLORS.PLAYER_STROKE;
          ctx.lineWidth = RENDER_CONFIG.LINE_WIDTHS.DEFAULT;
          ctx.beginPath();
          ctx.arc(x, y, 18, 0, Math.PI * 2);
          ctx.stroke();

          if (Math.abs(this.targetAngle - this.angle) > 0.01) {
            ctx.strokeStyle = RENDER_CONFIG.COLORS.TARGETING_LINE;
            ctx.lineWidth = RENDER_CONFIG.LINE_WIDTHS.DEFAULT;

            let startAngle = this.angle;
            let endAngle = this.targetAngle;

            while (startAngle < 0) startAngle += Math.PI * 2;
            while (endAngle < 0) endAngle += Math.PI * 2;

            if (Math.abs(endAngle - startAngle) > Math.PI) {
              if (endAngle > startAngle) {
                startAngle += Math.PI * 2;
              } else {
                endAngle += Math.PI * 2;
              }
            }

            ctx.beginPath();
            ctx.arc(x, y, 24, Math.min(startAngle, endAngle), Math.max(startAngle, endAngle));
            ctx.stroke();
          }
        }

        if (!this.dischargeAvailable) {
          ctx.strokeStyle = RENDER_CONFIG.COLORS.BEAM_TARGETING;
          ctx.lineWidth = RENDER_CONFIG.LINE_WIDTHS.DEFAULT;
          ctx.beginPath();
          ctx.arc(x, y, 18, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (blinkDimmed) ctx.globalAlpha = 1;
    }

    if (this.dashInProgress && this.dashDirection) {
      // Use theme-aware color for dash trail
      ctx.strokeStyle = this.themeService.isDayMode ? 'rgba(47, 79, 79, 0.7)' : 'rgba(0,255,255,0.7)';
      ctx.lineWidth = RENDER_CONFIG.LINE_WIDTHS.THICK;
      ctx.beginPath();
      const t = 40;
      ctx.moveTo(x - this.dashDirection.x * t, y - this.dashDirection.y * t);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (!this.dashAvailable) {
      // Use theme-aware color for dash cooldown indicator
      ctx.strokeStyle = this.themeService.isDayMode ? 'rgba(47, 79, 79, 0.4)' : 'rgba(0,255,255,0.4)';
      ctx.lineWidth = RENDER_CONFIG.LINE_WIDTHS.DEFAULT;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw parry activation glow (theme-aware shield effect)
    if (this.isParrying()) {
      const parryTime = window.performance.now() - this.parryStartTime;
      const pulseIntensity = 0.5 + 0.5 * Math.sin(parryTime * 0.02); // Pulsing effect

      // Use theme-aware parry color
      const parryColors = this.paletteService.getCanvas();
      const parryColor = parryColors.ACCENT_CYAN;

      ctx.save();
      // PERFORMANCE: Gradient-based glow instead of shadowBlur
      // Outer glow ring (faded)
      ctx.globalAlpha = 0.3 * pulseIntensity;
      ctx.strokeStyle = parryColor;
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(x, y, 35, 0, Math.PI * 2);
      ctx.stroke();

      // Main ring
      ctx.globalAlpha = 0.7 * pulseIntensity;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 35, 0, Math.PI * 2);
      ctx.stroke();

      // Inner glow ring
      ctx.globalAlpha = 0.4 * pulseIntensity;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Draw discharge charging indicator (theme-aware ring that fills as you charge)
    if (this.isChargingDischargeState) {
      const chargeProgress = this.getDischargeChargeLevel(); // Use getter for real-time calculation
      const chargeColors = this.paletteService.getCanvas();
      // Light mode: slate tones, Dark mode: magenta
      const ringColor = this.themeService.isDayMode ? chargeColors.TRAIL_FOCUS : '#ff00ff';
      const ringBgColor = this.themeService.isDayMode ? 'rgba(71, 85, 105, 0.25)' : 'rgba(255, 0, 255, 0.3)'; // Slate-600
      // Pre-computed glow colors (no string manipulation in render loop)
      const glowColor = this.themeService.isDayMode ? 'rgba(71, 85, 105, 0.35)' : 'rgba(255, 0, 255, 0.35)';

      ctx.save();
      // Background ring (dark)
      ctx.strokeStyle = ringBgColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.stroke();

      // PERFORMANCE: Gradient-based glow instead of shadowBlur
      // Outer glow (wider, faded)
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 8 + chargeProgress * 12;
      ctx.beginPath();
      ctx.arc(x, y, 40, -Math.PI / 2, -Math.PI / 2 + chargeProgress * Math.PI * 2);
      ctx.stroke();

      // Charging progress ring (theme-aware)
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Start from top (-PI/2), fill clockwise based on charge level
      ctx.arc(x, y, 40, -Math.PI / 2, -Math.PI / 2 + chargeProgress * Math.PI * 2);
      ctx.stroke();

      // Charge percentage text (theme-aware)
      if (chargeProgress > 0.1) {
        const chargeTextColor = this.paletteService.getCanvas().TRAIL_FOCUS;
        ctx.fillStyle = chargeTextColor;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.floor(chargeProgress * 100)}%`, x, y - 55);
      }
      ctx.restore();
    }
  }

  private drawDamageFeedback(ctx: CanvasRenderingContext2D, x: number, y: number, elapsedMs: number): void {
    const progress = Math.min(1, elapsedMs / PlayerService.DAMAGE_FEEDBACK_DURATION_MS);
    const fade = 1 - progress;
    const ringRadius = 25 + progress * 20;

    // Brief solid core makes the first frame unmistakable without a GPU blur pass.
    if (elapsedMs < 110) {
      ctx.globalAlpha = (1 - elapsedMs / 110) * 0.22;
      ctx.fillStyle = '#ff3158';
      ctx.beginPath();
      ctx.arc(x, y, 29, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = fade * 0.92;
    ctx.strokeStyle = '#ff3158';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    const sourceAngle = this.lastDamageSourceAngle;
    if (sourceAngle !== null) {
      // Source-side bracket: a short bright arc with an inward chevron. This conveys
      // both "you were hit" and where the pressure came from without another HUD panel.
      const bracketRadius = ringRadius + 4;
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#fff1f4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, bracketRadius, sourceAngle - 0.34, sourceAngle + 0.34);
      ctx.stroke();

      const cos = Math.cos(sourceAngle);
      const sin = Math.sin(sourceAngle);
      const tipX = x + cos * (bracketRadius - 7);
      const tipY = y + sin * (bracketRadius - 7);
      const wingX = x + cos * (bracketRadius + 2);
      const wingY = y + sin * (bracketRadius + 2);
      const tangentX = -sin * 6;
      const tangentY = cos * 6;
      ctx.beginPath();
      ctx.moveTo(wingX + tangentX, wingY + tangentY);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(wingX - tangentX, wingY - tangentY);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  // Input handlers
  private onKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();

    // IMPORTANT: Don't block the M key or other non-movement keys
    // Let them propagate to GameControlsService
    if (k === 'm') {
      // Don't handle map key here, let GameControlsService handle it
      return;
    }

    if (!this.isGameActive) return;

    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      if (e.target instanceof HTMLElement && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
      this.keys[k] = true;
    }

    if (
      k === ' ' &&
      e.target instanceof HTMLElement &&
      e.target.tagName !== 'INPUT' &&
      e.target.tagName !== 'TEXTAREA'
    ) {
      e.preventDefault();
      this.triggerDash();
    }

    // Parry key (E)
    if (
      k === 'e' &&
      e.target instanceof HTMLElement &&
      e.target.tagName !== 'INPUT' &&
      e.target.tagName !== 'TEXTAREA'
    ) {
      e.preventDefault();
      this.triggerParry();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (!this.isGameActive) return;

    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      if (e.target instanceof HTMLElement && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
      this.keys[k] = false;
    }
  };

  // Set beam aim angle directly (used by touch joystick)
  setAimAngle(angle: number): void {
    // NOTE: deliberately NOT gated by directionChangeCooldown. setAimAngle is the
    // touch AIM-joystick path only (the desktop mouse uses changeDirection(), which
    // keeps its 600ms cooldown). On touch, every stick release fires stopDirectionChange
    // → a 600ms cooldown that made re-gripping the aim stick dead for ~1s. Continuous
    // joystick aiming should not be rate-limited like the discrete mouse direction-flip.
    if (!this.isGameActive) {
      return;
    }

    // Record aim-stick activity timestamp for the idle-spin grace window.
    this.lastAimInputTime = Date.now();

    this.targetAngle = angle;

    // Always clear any mouse-originated auto-stop timeout to prevent mid-joystick cutoff
    window.clearTimeout(this.directionChangeEndTimeout);
    this.directionChangeEndTimeout = undefined;

    if (!this.directionChangeActive) {
      this.directionChangeActive = true;
    }
  }

  // Direction change
  changeDirection(mouseX: number, mouseY: number): boolean {
    if (this.directionChangeCooldown || !this.isGameActive) {
      return false; // On cooldown or game not active
    }

    const dx = mouseX - this.x$.value;
    const dy = mouseY - this.y$.value;
    this.targetAngle = Math.atan2(dy, dx);

    // Track click direction for projectile persistence
    this.directionTracker.recordClickDirection(dx, dy);

    if (!this.directionChangeActive) {
      this.directionChangeActive = true;

      // Clear any existing end timeout
      window.clearTimeout(this.directionChangeEndTimeout);

      // Set timeout for active duration
      this.ngZone.runOutsideAngular(() => {
        this.directionChangeEndTimeout = window.setTimeout(() => {
          this.stopDirectionChange();
        }, this.DIRECTION_ACTIVE_DURATION);
      });
    }
    return true;
  }

  stopDirectionChange(): void {
    if (this.directionChangeActive) {
      this.directionChangeActive = false;
      this.directionChangeCooldown = true;

      // Record the moment the aim stick was released so the grace window can be measured.
      this.lastAimInputTime = Date.now();

      // Clear the active duration timeout if it hasn't fired
      window.clearTimeout(this.directionChangeEndTimeout);
      this.directionChangeEndTimeout = undefined;

      // Set cooldown timeout
      window.clearTimeout(this.directionChangeTimeout);
      this.ngZone.runOutsideAngular(() => {
        this.directionChangeTimeout = window.setTimeout(() => {
          this.directionChangeCooldown = false;
          this.cooldownResetSubject.next(); // Notify cooldown reset
        }, this.DIRECTION_COOLDOWN);
      });

      this.cooldownResetSubject.next(); // Notify immediately that targeting stopped
    }
  }

  enableDoubleBeam(): void {
    this.playerUpgrades.unlockDoubleBeam();
  }

  isDirectionChangeActive(): boolean {
    return this.directionChangeActive;
  }

  /**
   * Get the current blade rotation speed multiplier for UI display
   */
  getBladeSpeedMultiplier(): number {
    if (this.directionChangeActive || this.bladeSpeedBoost === 0) {
      return PLAYER_CONFIG.ANIMATION.MOVING_ROTATION_MULTIPLIER;
    }

    return (
      PLAYER_CONFIG.ANIMATION.MIN_IDLE_MULTIPLIER +
      (PLAYER_CONFIG.ANIMATION.MAX_IDLE_MULTIPLIER - PLAYER_CONFIG.ANIMATION.MIN_IDLE_MULTIPLIER) * this.bladeSpeedBoost
    );
  }

  getBladeSpeedBoost(): number {
    return this.bladeSpeedBoost * 100;
  }

  /**
   * Get a descriptive label for the current rotation speed
   */
  getRotationSpeedLabel(): string {
    const chargedRotation = PLAYER_CONFIG.ANIMATION.CHARGED_ROTATION;
    if (this.currentRotationMultiplier >= chargedRotation.MAX_MULTIPLIER * 0.9) {
      return 'BLENDER MODE';
    } else if (this.currentRotationMultiplier >= chargedRotation.MID_MULTIPLIER) {
      return 'HIGH SPEED';
    } else if (this.currentRotationMultiplier > chargedRotation.MIN_MULTIPLIER) {
      return 'CHARGING';
    }
    return 'NORMAL';
  }

  isMoving(): boolean {
    return this.isCurrentlyMoving;
  }

  /**
   * Get player's current movement velocity in px/s for projectile momentum inheritance
   */
  getMovementVelocity(): { vx: number; vy: number } {
    if (!this.isCurrentlyMoving) {
      return { vx: 0, vy: 0 };
    }

    const baseSpeed = PLAYER_CONFIG.PHYSICS.BASE_SPEED * 1000;
    const speedMultiplier =
      this.playerUpgrades.getSpeedMultiplier() *
      (this.cachedTerritoryEffects?.speedMultiplier ?? 1.0) *
      1.0 *
      (this.isFocusFiring ? this.playerUpgrades.getFocusFireSpeedMultiplier() : 1.0) *
      (this.gameEngine?.movementSpeedMultiplier ?? 1);

    const speed = baseSpeed * speedMultiplier;
    const movDir = this.directionTracker.getLastMovementDirection();
    return {
      vx: movDir.x * speed,
      vy: movDir.y * speed,
    };
  }

  hasPendingChargeShot(): boolean {
    return this.pendingChargeShot;
  }

  consumePendingChargeShot(): void {
    this.pendingChargeShot = false;
    // Charge reset + cooldown handled by ECS (DualChargingComponent + WeaponComponent).
  }

  getTargetAngle(): number {
    return this.targetAngle;
  }

  // Discharge
  triggerDischarge(): boolean {
    if (!this.dischargeAvailable || !this.isGameActive) return false;

    // Cap discharge radius to prevent giant circles
    const dischargeRadius = PLAYER_CONFIG.WEAPONS.DISCHARGE.RADIUS || 200;
    const cappedRadius = Math.min(dischargeRadius * this.playerUpgrades.getDischargeRadiusMultiplier(), 300);
    this.dischargeSubject.next({
      x: this.x$.value,
      y: this.y$.value,
      radius: cappedRadius,
    });

    this.dischargeAvailable = false;
    this.dischargeRemainingMs = this.DISCHARGE_COOLDOWN; // start live timer
    return true;
  }

  // Charged Discharge Methods
  startChargingDischarge(): void {
    if (!this.dischargeAvailable || !this.isGameActive) return;
    this.isChargingDischargeState = true;
    this.dischargeChargeLevel = 0;
    this.dischargeChargeStartTime = window.performance.now();
  }

  releaseChargedDischarge(chargeLevel: number): void {
    if (!this.isChargingDischargeState || !this.dischargeAvailable || !this.isGameActive) {
      this.cancelChargingDischarge();
      return;
    }

    this.isChargingDischargeState = false;
    this.dischargeChargeLevel = chargeLevel;

    // Scale radius and damage based on charge level
    // At 0% charge: 50% of base radius
    // At 100% charge: 150% of base radius
    const baseRadius = PLAYER_CONFIG.WEAPONS.DISCHARGE.RADIUS || 200;
    const chargeMultiplier = 0.5 + chargeLevel; // 0.5 to 1.5
    const scaledRadius = Math.min(
      baseRadius * this.playerUpgrades.getDischargeRadiusMultiplier() * chargeMultiplier,
      400
    );

    this.dischargeSubject.next({
      x: this.x$.value,
      y: this.y$.value,
      radius: scaledRadius,
      chargeLevel: chargeLevel, // Pass charge level for damage scaling in discharge system
    });

    this.dischargeAvailable = false;
    this.dischargeRemainingMs = this.DISCHARGE_COOLDOWN;
  }

  cancelChargingDischarge(): void {
    this.isChargingDischargeState = false;
    this.dischargeChargeLevel = 0;
    this.dischargeChargeStartTime = 0;
  }

  isChargingDischarge(): boolean {
    return this.isChargingDischargeState;
  }

  getDischargeChargeLevel(): number {
    // Calculate real-time charge level during charging
    if (this.isChargingDischargeState && this.dischargeChargeStartTime > 0) {
      const elapsed = window.performance.now() - this.dischargeChargeStartTime;
      return Math.min(elapsed / this.DISCHARGE_MAX_CHARGE_MS, 1.0);
    }
    return this.dischargeChargeLevel;
  }

  // Dash
  triggerDash(): boolean {
    if (!this.dashAvailable || !this.isGameActive || this.dashInProgress) return false;

    let dx = 0,
      dy = 0;
    if (this.keys['arrowup'] || this.keys['w']) dy = -0.5;
    if (this.keys['arrowdown'] || this.keys['s']) dy = 0.5;
    if (this.keys['arrowleft'] || this.keys['a']) dx = -0.5;
    if (this.keys['arrowright'] || this.keys['d']) dx = 0.5;

    if (dx === 0 && dy === 0) {
      dx = Math.cos(this.angle);
      dy = Math.sin(this.angle);
    }

    const mag = Math.hypot(dx, dy);
    if (mag > 0) {
      dx /= mag;
      dy /= mag;
    }

    this.dashDirection = { x: dx, y: dy };
    this.dashInProgress = true;
    this.dashAvailable = false;
    this.audio.playDash();

    this.invincible = true;
    window.clearTimeout(this.invincibilityTimeout);
    this.ngZone.runOutsideAngular(() => {
      this.invincibilityTimeout = window.setTimeout(() => {
        this.invincible = false;
      }, PLAYER_CONFIG.ABILITIES.DASH.INVINCIBILITY_DURATION_MS);
    });

    this.ngZone.runOutsideAngular(() => {
      this.dashEndTimeout = window.setTimeout(() => {
        this.dashInProgress = false;
        this.dashEndTimeout = undefined;
      }, this.dashDuration);
    });

    window.clearTimeout(this.dashTimeout);
    const effectiveCooldown = this.getEffectiveDashCooldown();
    this.dashCooldownEndTime = window.performance.now() + effectiveCooldown;
    this.ngZone.runOutsideAngular(() => {
      this.dashTimeout = window.setTimeout(() => {
        this.dashAvailable = true;
      }, effectiveCooldown);
    });

    return true;
  }

  // Parry mechanic
  triggerParry(): boolean {
    if (!this.parryAvailable || !this.isGameActive || this.isParryActive) return false;

    this.isParryActive = true;
    this.parryStartTime = window.performance.now();
    this.parryAvailable = false;

    // End parry window after duration
    window.clearTimeout(this.parryWindowTimeout);
    this.ngZone.runOutsideAngular(() => {
      this.parryWindowTimeout = window.setTimeout(() => {
        this.endParry(false);
        this.parryWindowTimeout = undefined;
      }, this.PARRY_WINDOW_MS);
    });

    // Start cooldown
    this.parryCooldownEndTime = window.performance.now() + this.PARRY_COOLDOWN_MS;
    window.clearTimeout(this.parryCooldownTimeout);
    this.ngZone.runOutsideAngular(() => {
      this.parryCooldownTimeout = window.setTimeout(() => {
        this.parryAvailable = true;
      }, this.PARRY_COOLDOWN_MS);
    });

    this.debugLog.log('🛡️ Parry activated!', 'info', {
      source: 'parry_mechanic',
      windowMs: this.PARRY_WINDOW_MS,
      cooldownMs: this.PARRY_COOLDOWN_MS,
    });

    return true;
  }

  endParry(success: boolean): void {
    if (!this.isParryActive) return;

    this.isParryActive = false;
    if (success) {
      this.parrySuccessCount++;
      this.debugLog.log('⚔️ Parry SUCCESS! Projectile reflected!', 'success', {
        source: 'parry_mechanic',
        totalParries: this.parrySuccessCount,
      });
    }
  }

  isParrying(): boolean {
    // Check if still within parry window
    if (this.isParryActive) {
      const elapsed = window.performance.now() - this.parryStartTime;
      if (elapsed > this.PARRY_WINDOW_MS) {
        this.isParryActive = false;
        return false;
      }
      return true;
    }
    return false;
  }

  isParryAvailable(): boolean {
    return this.parryAvailable;
  }

  /**
   * Remaining parry cooldown as a fraction: 1 → cooldown just started, 0 → parry ready.
   * Drives the touch parry button's recovery ring.
   */
  getParryCooldownFraction(): number {
    if (this.parryAvailable) return 0;
    const remaining = this.parryCooldownEndTime - window.performance.now();
    return remaining <= 0 ? 0 : Math.min(1, remaining / this.PARRY_COOLDOWN_MS);
  }

  /**
   * Remaining dash cooldown as a fraction: 1 → cooldown just started, 0 → dash ready.
   * Mirrors getParryCooldownFraction(). Drives the desktop ability-row cooldown sweep.
   */
  getDashCooldownFraction(): number {
    if (this.dashAvailable) return 0;
    const remaining = this.dashCooldownEndTime - window.performance.now();
    return remaining <= 0 ? 0 : Math.min(1, remaining / this.getEffectiveDashCooldown());
  }

  getParrySuccessCount(): number {
    return this.parrySuccessCount;
  }

  private drawShip(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    _shapeId: string,
    colorCosmetic?: Cosmetic
  ): void {
    ctx.save(); // Save canvas state before drawing ship

    let fill = this.themeService.isDayMode ? '#2f4f4f' : 'white';
    const cols = colorCosmetic?.colors || [];
    if (cols.length === 1) {
      fill = cols[ARRAY_INDICES.COLOR_COMPONENTS.FIRST_COLOR];
    } else if (cols.length > 1) {
      const cCount = cols.length;
      const idx = Math.floor((this.animationTime * 2) % cCount);
      const nIdx = (idx + 1) % cCount;
      const prog = (this.animationTime * 2) % 1;
      const c1 = this.hexToRgb(cols[idx]);
      const c2 = this.hexToRgb(cols[nIdx]);
      if (!c1 || !c2) {
        fill = this.themeService.isDayMode ? '#2f4f4f' : '#ffffff';
      } else {
        const r = Math.floor(c1.r + (c2.r - c1.r) * prog);
        const g = Math.floor(c1.g + (c2.g - c1.g) * prog);
        const b = Math.floor(c1.b + (c2.b - c1.b) * prog);
        fill = `rgb(${r},${g},${b})`;
      }
    }
    // Intensity halo — concentric circles behind ship, visible when intensity > 0.1
    if (this.intensityLevel > 0.1) {
      const haloAlpha = this.intensityLevel * 0.25; // max 0.25 opacity
      const haloRadius = 25 + this.intensityLevel * 15; // 25-40px radius

      // Berserker active: red halo. Normal: theme-aware cyan/slate.
      const haloRgb = this.berserkerActive
        ? this.themeService.isDayMode
          ? '180, 20, 60'
          : '255, 50, 80'
        : this.themeService.isDayMode
          ? '47, 79, 79'
          : '0, 255, 255';
      const haloCoreRgb = this.berserkerActive
        ? this.themeService.isDayMode
          ? '220, 60, 90'
          : '255, 150, 170'
        : this.themeService.isDayMode
          ? '71, 100, 100'
          : '200, 255, 255';

      // Outer glow
      ctx.beginPath();
      ctx.arc(x, y, haloRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${haloRgb}, ${haloAlpha * 0.3})`;
      ctx.fill();

      // Inner glow
      ctx.beginPath();
      ctx.arc(x, y, haloRadius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${haloRgb}, ${haloAlpha * 0.6})`;
      ctx.fill();

      // Core glow
      ctx.beginPath();
      ctx.arc(x, y, haloRadius * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${haloCoreRgb}, ${haloAlpha})`;
      ctx.fill();
    }

    // Draw the ship hull — shape variant is forwarded to the cache-keyed renderer
    this.drawEnhancedSpaceship(ctx, x, y, fill, _shapeId);

    ctx.restore(); // Restore canvas state after drawing ship
  }

  private drawEnhancedSpaceship(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    fillColor: string,
    shapeId: string = ''
  ): void {
    const scale = 1.5;
    const direction = this.angle;
    const isMoving = this.isCurrentlyMoving;
    const isDayMode = this.themeService.isDayMode;

    // Normalise shapeId: empty / null / 'default-circle' all route to the default ship.
    const effectiveShape = shapeId && shapeId !== 'default-circle' && shapeId !== '' ? shapeId : 'default';

    // Offscreen body cache: key includes shapeId so each hull variant is baked once.
    // Rotation is NOT baked; the caller applies translate+rotate before blitting.
    const cacheKey = `${effectiveShape}|${fillColor}|${isMoving ? 1 : 0}|${isDayMode ? 1 : 0}`;
    let cachedCanvas = this._shipBodyCanvasMap.get(cacheKey);
    if (cachedCanvas === undefined) {
      const isDefaultShape = effectiveShape === 'default';
      const cw = isDefaultShape ? PlayerService._SHIP_CANVAS_W : PlayerService._ALT_SHIP_CANVAS_W;
      const ch = isDefaultShape ? PlayerService._SHIP_CANVAS_H : PlayerService._ALT_SHIP_CANVAS_H;

      const oc = document.createElement('canvas');
      oc.width = cw;
      oc.height = ch;
      const octx = oc.getContext('2d');
      if (octx !== null) {
        if (isDefaultShape) {
          this._bakeDefaultShip(octx, fillColor, isMoving, isDayMode, scale);
        } else {
          this._bakeAltShip(octx, effectiveShape, fillColor, isMoving, isDayMode, scale);
        }
      }
      if (this._shipBodyCanvasMap.size > 64) {
        this._shipBodyCanvasMap.clear();
      }
      this._shipBodyCanvasMap.set(cacheKey, oc);
      cachedCanvas = oc;
    }

    // Blit cached body + dynamic thrust trail
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(direction);

    if (cachedCanvas !== undefined) {
      const isDefaultShape = effectiveShape === 'default';
      if (isDefaultShape) {
        ctx.drawImage(cachedCanvas, -PlayerService._SHIP_ORIGIN_X, -PlayerService._SHIP_ORIGIN_Y);
      } else {
        ctx.drawImage(cachedCanvas, -PlayerService._ALT_SHIP_ORIGIN, -PlayerService._ALT_SHIP_ORIGIN);
      }
    }

    // Thrust trail: uses pulseFactor (Date.now()) + intensityLevel — both change
    // every frame, so drawn directly here rather than cached.
    if (isMoving) {
      const pulseTime = Date.now() * 0.003;
      const pulseFactor = 0.8 + 0.2 * Math.sin(pulseTime);

      // Advanced engine trail with particles
      const intensityBoost = 1 + this.intensityLevel * 0.8; // 1.0x at idle -> 1.8x at critical
      const trailLength = (20 + 10 * pulseFactor) * intensityBoost;

      // Intensity-boosted thrust opacity
      const thrustOpacity = Math.min(1, 0.6 * pulseFactor * (1 + this.intensityLevel * 0.5));
      const thrustMidOpacity = Math.min(1, 0.3 * pulseFactor * (1 + this.intensityLevel * 0.5));

      // Main thrust cone — all shapes share rear-exit thrusters at (-12*scale, +-5*scale)
      const thrustGradient = ctx.createLinearGradient(-12 * scale, 0, -12 * scale - trailLength, 0);
      thrustGradient.addColorStop(0, `rgba(0, 200, 255, ${thrustOpacity})`);
      thrustGradient.addColorStop(0.3, `rgba(0, 150, 255, ${thrustMidOpacity})`);
      thrustGradient.addColorStop(1, 'rgba(0, 100, 200, 0)');

      ctx.fillStyle = thrustGradient;

      // Right engine trail
      ctx.beginPath();
      ctx.moveTo(-12 * scale, 5 * scale + 2);
      ctx.lineTo(-12 * scale - trailLength, 5 * scale + 1);
      ctx.lineTo(-12 * scale - trailLength, 5 * scale - 1);
      ctx.lineTo(-12 * scale, 5 * scale - 2);
      ctx.closePath();
      ctx.fill();

      // Left engine trail
      ctx.beginPath();
      ctx.moveTo(-12 * scale, -5 * scale + 2);
      ctx.lineTo(-12 * scale - trailLength, -5 * scale + 1);
      ctx.lineTo(-12 * scale - trailLength, -5 * scale - 1);
      ctx.lineTo(-12 * scale, -5 * scale - 2);
      ctx.closePath();
      ctx.fill();

      // Particle effects — boosted by intensity
      const particleOpacity = Math.min(1, 0.8 * pulseFactor * (1 + this.intensityLevel * 0.4));
      ctx.fillStyle = `rgba(150, 200, 255, ${particleOpacity})`;
      for (let i = 0; i < 3; i++) {
        const offset = i * 5;
        const size = 1 - i * 0.3;
        ctx.beginPath();
        ctx.arc(-15 * scale - offset, 5 * scale, size, 0, Math.PI * 2);
        ctx.arc(-15 * scale - offset, -5 * scale, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /**
   * Render a static ship preview into the provided 2-D context.
   * Delegates to the same bake path used during gameplay (get-or-bake from
   * _shipBodyCanvasMap with isMoving=false), then scales + centres the baked
   * canvas to fill the target context's canvas.
   *
   * The caller is responsible for clearing the canvas before this call.
   */
  renderShipPreview(ctx: CanvasRenderingContext2D, shapeId: string, fillColor: string): void {
    const isDayMode = this.themeService.isDayMode;
    const isMoving = false;
    const effectiveShape = shapeId && shapeId !== 'default-circle' && shapeId !== '' ? shapeId : 'default';
    const cacheKey = `${effectiveShape}|${fillColor}|0|${isDayMode ? 1 : 0}`;

    if (!this._shipBodyCanvasMap.has(cacheKey)) {
      const isDefaultShape = effectiveShape === 'default';
      const cw = isDefaultShape ? PlayerService._SHIP_CANVAS_W : PlayerService._ALT_SHIP_CANVAS_W;
      const ch = isDefaultShape ? PlayerService._SHIP_CANVAS_H : PlayerService._ALT_SHIP_CANVAS_H;
      const oc = document.createElement('canvas');
      oc.width = cw;
      oc.height = ch;
      const octx = oc.getContext('2d');
      if (octx !== null) {
        if (isDefaultShape) {
          this._bakeDefaultShip(octx, fillColor, isMoving, isDayMode, 1.5);
        } else {
          this._bakeAltShip(octx, effectiveShape, fillColor, isMoving, isDayMode, 1.5);
        }
      }
      if (this._shipBodyCanvasMap.size > 64) {
        this._shipBodyCanvasMap.clear();
      }
      this._shipBodyCanvasMap.set(cacheKey, oc);
    }

    const baked = this._shipBodyCanvasMap.get(cacheKey);
    if (!baked) return;

    const dw = ctx.canvas.width;
    const dh = ctx.canvas.height;
    const scale = Math.min(dw / baked.width, dh / baked.height) * 0.85;
    const dx = (dw - baked.width * scale) / 2;
    const dy = (dh - baked.height * scale) / 2;
    ctx.drawImage(baked, dx, dy, baked.width * scale, baked.height * scale);
  }

  /** Bake the default spaceship body (byte-identical to the original single-canvas code). */
  private _bakeDefaultShip(
    oc: CanvasRenderingContext2D,
    fillColor: string,
    isMoving: boolean,
    isDayMode: boolean,
    scale: number
  ): void {
    const ox = PlayerService._SHIP_ORIGIN_X;
    const oy = PlayerService._SHIP_ORIGIN_Y;

    oc.clearRect(0, 0, PlayerService._SHIP_CANVAS_W, PlayerService._SHIP_CANVAS_H);
    oc.save();
    oc.translate(ox, oy);

    // PERFORMANCE: Drop shadow via offset dark shape instead of shadowBlur
    oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
    oc.beginPath();
    oc.moveTo(20 * scale, 2);
    oc.lineTo(10 * scale, 7 * scale);
    oc.lineTo(4 * scale, 9 * scale);
    oc.lineTo(0, 12 * scale);
    oc.lineTo(-6 * scale, 11 * scale);
    oc.lineTo(-8 * scale, 9 * scale);
    oc.lineTo(-10 * scale, 4 * scale);
    oc.lineTo(-10 * scale, 0);
    oc.lineTo(-8 * scale, -5 * scale);
    oc.lineTo(-6 * scale, -7 * scale);
    oc.lineTo(0, -8 * scale);
    oc.lineTo(4 * scale, -5 * scale);
    oc.lineTo(10 * scale, -3 * scale);
    oc.closePath();
    oc.fill();

    // Main hull
    const gradient = oc.createLinearGradient(-10 * scale, 0, 15 * scale, 0);
    gradient.addColorStop(0, 'rgba(40, 40, 40, 1)');
    gradient.addColorStop(0.5, fillColor);
    gradient.addColorStop(1, fillColor);

    oc.fillStyle = gradient;
    oc.beginPath();
    oc.moveTo(18 * scale, 0);
    oc.lineTo(8 * scale, 5 * scale);
    oc.lineTo(2 * scale, 7 * scale);
    oc.lineTo(-2 * scale, 10 * scale);
    oc.lineTo(-8 * scale, 9 * scale);
    oc.lineTo(-10 * scale, 7 * scale);
    oc.lineTo(-12 * scale, 2 * scale);
    oc.lineTo(-12 * scale, -2 * scale);
    oc.lineTo(-10 * scale, -7 * scale);
    oc.lineTo(-8 * scale, -9 * scale);
    oc.lineTo(-2 * scale, -10 * scale);
    oc.lineTo(2 * scale, -7 * scale);
    oc.lineTo(8 * scale, -5 * scale);
    oc.closePath();
    oc.fill();

    oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    oc.lineWidth = 0.5;
    oc.stroke();

    oc.strokeStyle = isDayMode ? 'rgba(71, 85, 105, 0.2)' : 'rgba(255, 255, 255, 0.2)';
    oc.beginPath();
    oc.moveTo(8 * scale, 5 * scale);
    oc.lineTo(-5 * scale, 6 * scale);
    oc.moveTo(8 * scale, -5 * scale);
    oc.lineTo(-5 * scale, -6 * scale);
    oc.stroke();

    const cockpitGradient = oc.createRadialGradient(6 * scale, 0, 0, 6 * scale, 0, 5 * scale);
    if (isDayMode) {
      cockpitGradient.addColorStop(0, 'rgba(8, 145, 178, 0.75)');
      cockpitGradient.addColorStop(0.5, 'rgba(71, 85, 105, 0.6)');
      cockpitGradient.addColorStop(1, 'rgba(51, 65, 85, 0.4)');
    } else {
      cockpitGradient.addColorStop(0, 'rgba(100, 255, 255, 0.8)');
      cockpitGradient.addColorStop(0.5, 'rgba(0, 200, 255, 0.6)');
      cockpitGradient.addColorStop(1, 'rgba(0, 100, 200, 0.4)');
    }
    oc.fillStyle = cockpitGradient;
    oc.beginPath();
    oc.moveTo(12 * scale, 0);
    oc.lineTo(6 * scale, 3 * scale);
    oc.lineTo(2 * scale, 2 * scale);
    oc.lineTo(2 * scale, -2 * scale);
    oc.lineTo(6 * scale, -3 * scale);
    oc.closePath();
    oc.fill();

    oc.strokeStyle = 'rgba(150, 150, 150, 0.6)';
    oc.lineWidth = 0.5;
    oc.stroke();

    oc.fillStyle = 'rgba(30, 30, 30, 1)';
    oc.beginPath();
    oc.arc(-10 * scale, 5 * scale, 3 * scale, 0, Math.PI * 2);
    oc.moveTo(-10 * scale - 3 * scale, -5 * scale);
    oc.arc(-10 * scale, -5 * scale, 3 * scale, 0, Math.PI * 2);
    oc.fill();

    const thrusterGradient = oc.createRadialGradient(-10 * scale, 5 * scale, 0, -10 * scale, 5 * scale, 3 * scale);
    thrusterGradient.addColorStop(0, isMoving ? 'rgba(0, 200, 255, 1)' : 'rgba(0, 100, 150, 0.5)');
    thrusterGradient.addColorStop(0.5, isMoving ? 'rgba(0, 150, 255, 0.8)' : 'rgba(0, 50, 100, 0.3)');
    thrusterGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

    oc.fillStyle = thrusterGradient;
    oc.beginPath();
    oc.arc(-10 * scale, 5 * scale, 2.5 * scale, 0, Math.PI * 2);
    oc.arc(-10 * scale, -5 * scale, 2.5 * scale, 0, Math.PI * 2);
    oc.fill();

    oc.restore();
  }

  /**
   * Bake an alternative ship hull onto an offscreen 64x64 canvas (origin at 32,32).
   * All shapes share cockpit-gradient + thruster language with the default ship.
   */
  private _bakeAltShip(
    oc: CanvasRenderingContext2D,
    shapeId: string,
    fillColor: string,
    isMoving: boolean,
    isDayMode: boolean,
    scale: number
  ): void {
    const cw = PlayerService._ALT_SHIP_CANVAS_W;
    const ch = PlayerService._ALT_SHIP_CANVAS_H;
    const ox = PlayerService._ALT_SHIP_ORIGIN;
    const oy = PlayerService._ALT_SHIP_ORIGIN;

    oc.clearRect(0, 0, cw, ch);
    oc.save();
    oc.translate(ox, oy);

    // Hull gradient — nose (+x) to tail (-x)
    const hullGrad = oc.createLinearGradient(-14 * scale, 0, 14 * scale, 0);
    hullGrad.addColorStop(0, 'rgba(40, 40, 40, 1)');
    hullGrad.addColorStop(0.4, fillColor);
    hullGrad.addColorStop(1, fillColor);

    // Theme-aware panel line colour
    const panelLine = isDayMode ? 'rgba(71, 85, 105, 0.25)' : 'rgba(255, 255, 255, 0.2)';

    // Cockpit gradient factory (reused across shapes)
    const makeCockpit = (): CanvasGradient => {
      const cg = oc.createRadialGradient(5 * scale, 0, 0, 5 * scale, 0, 4 * scale);
      if (isDayMode) {
        cg.addColorStop(0, 'rgba(8, 145, 178, 0.75)');
        cg.addColorStop(0.5, 'rgba(71, 85, 105, 0.6)');
        cg.addColorStop(1, 'rgba(51, 65, 85, 0.4)');
      } else {
        cg.addColorStop(0, 'rgba(100, 255, 255, 0.8)');
        cg.addColorStop(0.5, 'rgba(0, 200, 255, 0.6)');
        cg.addColorStop(1, 'rgba(0, 100, 200, 0.4)');
      }
      return cg;
    };

    // Thruster pair helper — draws housings + glow at y offset ty
    const drawThrusters = (ty: number): void => {
      oc.fillStyle = 'rgba(30, 30, 30, 1)';
      oc.beginPath();
      oc.arc(-11 * scale, ty, 2.5 * scale, 0, Math.PI * 2);
      oc.moveTo(-11 * scale - 2.5 * scale, -ty);
      oc.arc(-11 * scale, -ty, 2.5 * scale, 0, Math.PI * 2);
      oc.fill();

      const tg = oc.createRadialGradient(-11 * scale, ty, 0, -11 * scale, ty, 2.5 * scale);
      tg.addColorStop(0, isMoving ? 'rgba(0, 200, 255, 1)' : 'rgba(0, 100, 150, 0.5)');
      tg.addColorStop(0.5, isMoving ? 'rgba(0, 150, 255, 0.8)' : 'rgba(0, 50, 100, 0.3)');
      tg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      oc.fillStyle = tg;
      oc.beginPath();
      oc.arc(-11 * scale, ty, 2 * scale, 0, Math.PI * 2);
      oc.arc(-11 * scale, -ty, 2 * scale, 0, Math.PI * 2);
      oc.fill();
    };

    switch (shapeId) {
      // TRIANGLE: sleek dart fighter — narrow delta wings, spine to nose
      case 'triangle': {
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.beginPath();
        oc.moveTo(16 * scale + 1, 1);
        oc.lineTo(-12 * scale + 1, 11 * scale + 1);
        oc.lineTo(-12 * scale + 1, -11 * scale + 1);
        oc.closePath();
        oc.fill();
        // Hull
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.moveTo(16 * scale, 0);
        oc.lineTo(-10 * scale, 11 * scale);
        oc.lineTo(-12 * scale, 8 * scale);
        oc.lineTo(-12 * scale, 2 * scale);
        oc.lineTo(-12 * scale, -2 * scale);
        oc.lineTo(-12 * scale, -8 * scale);
        oc.lineTo(-10 * scale, -11 * scale);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Spine
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.moveTo(14 * scale, 0);
        oc.lineTo(-10 * scale, 0);
        oc.stroke();
        // Cockpit
        oc.fillStyle = makeCockpit();
        oc.beginPath();
        oc.moveTo(14 * scale, 0);
        oc.lineTo(6 * scale, 3 * scale);
        oc.lineTo(3 * scale, 2 * scale);
        oc.lineTo(3 * scale, -2 * scale);
        oc.lineTo(6 * scale, -3 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(5);
        break;
      }

      // HEXAGON: hex-plated cruiser — elongated hexagon with armour seams
      case 'hexagon': {
        const hw = 13 * scale;
        const hh = 9 * scale;
        const hexPts: [number, number][] = [
          [hw, 0],
          [hw * 0.5, hh],
          [-hw * 0.5, hh],
          [-hw, 0],
          [-hw * 0.5, -hh],
          [hw * 0.5, -hh],
        ];
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.beginPath();
        oc.moveTo(hexPts[0][0] + 1, hexPts[0][1] + 1);
        for (let i = 1; i < hexPts.length; i++) oc.lineTo(hexPts[i][0] + 1, hexPts[i][1] + 1);
        oc.closePath();
        oc.fill();
        // Hull
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.moveTo(hexPts[0][0], hexPts[0][1]);
        for (let i = 1; i < hexPts.length; i++) oc.lineTo(hexPts[i][0], hexPts[i][1]);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Armour seams
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.moveTo(hw * 0.5, hh);
        oc.lineTo(hw * 0.5, -hh);
        oc.moveTo(-hw * 0.4, hh * 0.6);
        oc.lineTo(-hw * 0.4, -hh * 0.6);
        oc.stroke();
        // Cockpit
        oc.fillStyle = makeCockpit();
        oc.beginPath();
        oc.moveTo(hw - 1, 0);
        oc.lineTo(hw * 0.6, 3 * scale);
        oc.lineTo(hw * 0.35, 2 * scale);
        oc.lineTo(hw * 0.35, -2 * scale);
        oc.lineTo(hw * 0.6, -3 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(5.5);
        break;
      }

      // STAR: five-spoke interceptor — pentagram hull with swept spokes
      case 'star': {
        const R = 13 * scale;
        const r = 6 * scale;
        const starPts: [number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const rad = i % 2 === 0 ? R : r;
          const a = (Math.PI * i) / 5 - Math.PI / 2 + Math.PI / 10;
          starPts.push([rad * Math.cos(a), rad * Math.sin(a)]);
        }
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.beginPath();
        oc.moveTo(starPts[0][0] + 1, starPts[0][1] + 1);
        for (let i = 1; i < starPts.length; i++) oc.lineTo(starPts[i][0] + 1, starPts[i][1] + 1);
        oc.closePath();
        oc.fill();
        // Hull
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.moveTo(starPts[0][0], starPts[0][1]);
        for (let i = 1; i < starPts.length; i++) oc.lineTo(starPts[i][0], starPts[i][1]);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Hub ring
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.arc(0, 0, r * 0.6, 0, Math.PI * 2);
        oc.stroke();
        // Cockpit at rightmost spoke
        oc.fillStyle = makeCockpit();
        const nosePt = starPts[0];
        oc.beginPath();
        oc.moveTo(nosePt[0], nosePt[1]);
        oc.lineTo(nosePt[0] - 5 * scale, nosePt[1] + 2.5 * scale);
        oc.lineTo(nosePt[0] - 7 * scale, nosePt[1]);
        oc.lineTo(nosePt[0] - 5 * scale, nosePt[1] - 2.5 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(4.5);
        break;
      }

      // DIAMOND: kite hull — rhombus with rear swept fins
      case 'diamond': {
        const dw = 14 * scale;
        const db = 10 * scale;
        const dh = 10 * scale;
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.beginPath();
        oc.moveTo(dw + 1, 1);
        oc.lineTo(2 * scale + 1, dh + 1);
        oc.lineTo(-db + 1, 2 * scale + 1);
        oc.lineTo(-db + 1, -2 * scale + 1);
        oc.lineTo(2 * scale + 1, -dh + 1);
        oc.closePath();
        oc.fill();
        // Hull
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.moveTo(dw, 0);
        oc.lineTo(2 * scale, dh);
        oc.lineTo(-db, 3 * scale);
        oc.lineTo(-db, -3 * scale);
        oc.lineTo(2 * scale, -dh);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Keel lines
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.moveTo(dw - 3, 0);
        oc.lineTo(-db + 2, 0);
        oc.moveTo(2 * scale, dh * 0.7);
        oc.lineTo(2 * scale, -dh * 0.7);
        oc.stroke();
        // Cockpit
        oc.fillStyle = makeCockpit();
        oc.beginPath();
        oc.moveTo(dw, 0);
        oc.lineTo(dw - 5 * scale, 3 * scale);
        oc.lineTo(dw - 8 * scale, 2 * scale);
        oc.lineTo(dw - 8 * scale, -2 * scale);
        oc.lineTo(dw - 5 * scale, -3 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(2.5);
        break;
      }

      // CRESCENT: curved-wing raider — concave moon hull
      case 'crescent': {
        const outerR = 14 * scale;
        const innerR = 10 * scale;
        const startA = -1.75;
        const endA = 1.75;
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.save();
        oc.translate(1, 1);
        oc.beginPath();
        oc.arc(0, 0, outerR, startA, endA);
        oc.arc(-4 * scale, 0, innerR, endA, startA, true);
        oc.closePath();
        oc.fill();
        oc.restore();
        // Hull
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.arc(0, 0, outerR, startA, endA);
        oc.arc(-4 * scale, 0, innerR, endA, startA, true);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Concave spine arc
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.arc(-2 * scale, 0, (outerR + innerR) / 2, startA * 0.6, endA * 0.6);
        oc.stroke();
        // Cockpit at outer arc tip
        oc.fillStyle = makeCockpit();
        oc.beginPath();
        oc.moveTo(outerR, 0);
        oc.lineTo(outerR - 5 * scale, 2.5 * scale);
        oc.lineTo(outerR - 7 * scale, 1.5 * scale);
        oc.lineTo(outerR - 7 * scale, -1.5 * scale);
        oc.lineTo(outerR - 5 * scale, -2.5 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(5.5);
        break;
      }

      // ARROW: swept-wing dart — arrowhead with deep rear cutout
      case 'arrow': {
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.beginPath();
        oc.moveTo(16 * scale + 1, 1);
        oc.lineTo(-2 * scale + 1, 12 * scale + 1);
        oc.lineTo(-5 * scale + 1, 8 * scale + 1);
        oc.lineTo(-12 * scale + 1, 4 * scale + 1);
        oc.lineTo(-12 * scale + 1, -4 * scale + 1);
        oc.lineTo(-5 * scale + 1, -8 * scale + 1);
        oc.lineTo(-2 * scale + 1, -12 * scale + 1);
        oc.closePath();
        oc.fill();
        // Hull
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.moveTo(16 * scale, 0);
        oc.lineTo(-2 * scale, 12 * scale);
        oc.lineTo(-5 * scale, 8 * scale);
        oc.lineTo(-12 * scale, 4 * scale);
        oc.lineTo(-12 * scale, -4 * scale);
        oc.lineTo(-5 * scale, -8 * scale);
        oc.lineTo(-2 * scale, -12 * scale);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Spine + sweep lines
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.moveTo(14 * scale, 0);
        oc.lineTo(-10 * scale, 0);
        oc.moveTo(-2 * scale, 10 * scale);
        oc.lineTo(-5 * scale, 0);
        oc.moveTo(-2 * scale, -10 * scale);
        oc.lineTo(-5 * scale, 0);
        oc.stroke();
        // Cockpit
        oc.fillStyle = makeCockpit();
        oc.beginPath();
        oc.moveTo(15 * scale, 0);
        oc.lineTo(7 * scale, 3 * scale);
        oc.lineTo(4 * scale, 2 * scale);
        oc.lineTo(4 * scale, -2 * scale);
        oc.lineTo(7 * scale, -3 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(3.5);
        break;
      }

      // SQUARE: boxy gunship — rectangular hull with armoured corners
      case 'square': {
        const sw = 12 * scale;
        const sh = 9 * scale;
        // Shadow
        oc.fillStyle = 'rgba(0, 0, 0, 0.3)';
        oc.beginPath();
        oc.rect(-sw + 1, -sh + 1, sw * 2, sh * 2);
        oc.fill();
        // Hull with chamfered corners
        oc.fillStyle = hullGrad;
        oc.beginPath();
        oc.moveTo(-sw + 2 * scale, -sh);
        oc.lineTo(sw, -sh + 2 * scale);
        oc.lineTo(sw, sh - 2 * scale);
        oc.lineTo(-sw + 2 * scale, sh);
        oc.lineTo(-sw, sh - 2 * scale);
        oc.lineTo(-sw, -sh + 2 * scale);
        oc.closePath();
        oc.fill();
        oc.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        oc.lineWidth = 0.5;
        oc.stroke();
        // Grid panel lines
        oc.strokeStyle = panelLine;
        oc.lineWidth = 0.75;
        oc.beginPath();
        oc.moveTo(-sw, 0);
        oc.lineTo(sw, 0);
        oc.moveTo(-sw * 0.3, -sh);
        oc.lineTo(-sw * 0.3, sh);
        oc.moveTo(sw * 0.5, -sh);
        oc.lineTo(sw * 0.5, sh);
        oc.stroke();
        // Sensor fins at nose
        oc.strokeStyle = isDayMode ? 'rgba(8, 145, 178, 0.5)' : 'rgba(0, 255, 255, 0.4)';
        oc.lineWidth = 1.5;
        oc.beginPath();
        oc.moveTo(sw - 1, -sh);
        oc.lineTo(sw + 3 * scale, -sh - 2 * scale);
        oc.moveTo(sw - 1, sh);
        oc.lineTo(sw + 3 * scale, sh + 2 * scale);
        oc.stroke();
        // Cockpit (wide bridge)
        oc.fillStyle = makeCockpit();
        oc.beginPath();
        oc.moveTo(sw, 0);
        oc.lineTo(sw - 2 * scale, 3.5 * scale);
        oc.lineTo(sw - 6 * scale, 3 * scale);
        oc.lineTo(sw - 6 * scale, -3 * scale);
        oc.lineTo(sw - 2 * scale, -3.5 * scale);
        oc.closePath();
        oc.fill();
        drawThrusters(5.5);
        break;
      }

      default:
        // Safety fallback — bake default hull on the alt canvas
        this._bakeDefaultShip(oc, fillColor, isMoving, isDayMode, scale);
        break;
    }

    oc.restore();
  }

  // Track beam sweep animation
  private beamSweepAnimation = {
    active: false,
    startAngle: 0,
    currentAngle: 0,
    targetAngle: 0,
    progress: 0,
    duration: 150, // milliseconds for sweep
  };

  private drawBeam(ctx: CanvasRenderingContext2D, x: number, y: number, beamColorCosmetic?: Cosmetic): void {
    // Only draw beam when firing is active (always-on by default)
    if (!this._isFiring) {
      return;
    }

    ctx.save(); // Save canvas state before drawing beam

    /* ---- base colour handling ---- */
    // Use theme-aware beam color (steel blue for light mode, cyan for dark mode)
    const canvasColors = this.paletteService.getCanvas();
    let baseStroke = canvasColors.BEAM;
    const cols = beamColorCosmetic?.colors || [];
    // Only override theme color if cosmetic is NOT the default cyan (allows theme-aware default beam)
    const isDefaultCyan = cols.length === 1 && (cols[0] === 'cyan' || cols[0] === '#00ffff');
    if (cols.length === 1 && !isDefaultCyan) baseStroke = cols[ARRAY_INDICES.COLOR_COMPONENTS.FIRST_COLOR];
    else if (cols.length > 1) {
      const cCount = cols.length;
      const idx = Math.floor((this.animationTime * 2) % cCount);
      const nIdx = (idx + 1) % cCount;
      const t = (this.animationTime * 2) % 1;
      const c1 = this.hexToRgb(cols[idx]);
      const c2 = this.hexToRgb(cols[nIdx]);
      if (!c1 || !c2) {
        baseStroke = this.themeService.isDayMode ? '#0891b2' : '#ffffff';
      } else {
        const r = Math.floor(c1.r + (c2.r - c1.r) * t);
        const g = Math.floor(c1.g + (c2.g - c1.g) * t);
        const b = Math.floor(c1.b + (c2.b - c1.b) * t);
        baseStroke = `rgb(${r},${g},${b})`;
      }
    }

    const stroke = baseStroke;
    // Scale glow intensity with beam damage multiplier (cached to avoid per-frame lookup)
    const damageMult = this.cachedBeamDamageMult;
    const glowIntensity = Math.min(0.3 + (damageMult - 1) * 0.15, 0.7);

    // Charging particles disabled - visual clutter reduction
    // Charge status is shown in the HUD bar

    // Beam drawing — constant visual regardless of charge/rotation speed
    const coreProfile = this.playerUpgrades.getBeamCoreProfile();
    const beamLength = BEAM_CONSTANTS.VISUAL_LENGTH * coreProfile.lengthMultiplier;
    const drawBlade = (angle: number, thick: number, glow: boolean, showSweepTrail: boolean): void => {
      const finalThickness = thick;

      // Draw sweep trail if animation is active
      if (showSweepTrail && this.beamSweepAnimation.active) {
        const sweepAngles = 5; // Number of trail segments
        for (let i = 0; i < sweepAngles; i++) {
          const trailProgress = Math.max(0, this.beamSweepAnimation.progress - i * 0.15);
          if (trailProgress <= 0) continue;

          const trailAngle =
            this.beamSweepAnimation.startAngle +
            (this.beamSweepAnimation.targetAngle - this.beamSweepAnimation.startAngle) * trailProgress;
          const trailOpacity = (1 - i / sweepAngles) * 0.3 * (1 - this.beamSweepAnimation.progress);

          // Theme-aware beam trail color
          const trailRgb = this.themeService.isDayMode ? '70, 130, 180' : '0, 255, 255';
          ctx.strokeStyle = `rgba(${trailRgb}, ${trailOpacity})`;
          ctx.lineWidth = finalThickness * (1 - i * 0.1);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + Math.cos(trailAngle) * beamLength, y + Math.sin(trailAngle) * beamLength);
          ctx.stroke();
        }
      }

      // Main beam — always uses base stroke color (no charge/speed color shift)
      ctx.strokeStyle = stroke;
      ctx.lineWidth = finalThickness;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(angle) * beamLength, y + Math.sin(angle) * beamLength);
      ctx.stroke();

      // Theme-aware fallback for glow colors: steel blue for light mode, cyan for dark mode
      const glowFallbackRgb = this.themeService.isDayMode ? { r: 70, g: 130, b: 180 } : { r: 0, g: 255, b: 255 };
      const rgb = this.hexToRgb(stroke) || glowFallbackRgb;

      // Upgrade glow (ALWAYS shows when damage is upgraded, regardless of targeting)
      if (damageMult > 1.0) {
        const outerAlpha = Math.min((damageMult - 1) * 0.12, 0.25);
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${outerAlpha})`;
        ctx.lineWidth = finalThickness * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * beamLength, y + Math.sin(angle) * beamLength);
        ctx.stroke();
      }

      // Targeting-mode glow effects (only when actively targeting)
      if (glow) {
        // Primary glow
        ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${glowIntensity})`;
        ctx.lineWidth = finalThickness * 1.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * beamLength, y + Math.sin(angle) * beamLength);
        ctx.stroke();

        // Pulsing effect at beam tip
        const pulseIntensity = 0.5 + 0.5 * Math.sin(this.animationTime * 10);
        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${pulseIntensity * 0.8})`;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * beamLength, y + Math.sin(angle) * beamLength, finalThickness * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const targeting = this.directionChangeActive;
    // Scale beam thickness with damage multiplier (capped at 1.5x) AND width upgrade multiplier
    const thickScale = Math.min(1 + (damageMult - 1) * 0.25, 1.5);
    const baseThick = targeting ? 6 : 4;
    const scaledThick = baseThick * thickScale * this.cachedBeamWidthMult * coreProfile.widthMultiplier;

    /* Core geometry preserves the same aim angle while changing the emitted shape. */
    for (const offset of coreProfile.angleOffsets) {
      drawBlade(this.angle + offset, scaledThick, targeting, offset === 0);
    }

    /* second blade for dual‑beam */
    if (this.getHasDoubleBeam()) {
      for (const offset of coreProfile.angleOffsets) {
        drawBlade(this.angle + Math.PI + offset, scaledThick, targeting, false);
      }
    }

    // REMOVED: Dotted targeting guide line (redundant with rotation arc indicator)
    // The rotation arc already shows the target direction clearly without visual clutter

    ctx.restore(); // Restore canvas state after drawing beam
  }

  private drawAccessory(ctx: CanvasRenderingContext2D, x: number, y: number, id: string): void {
    switch (id) {
      case 'santa-hat':
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.arcTo(-5, -20, 0, -15, 10);
        ctx.lineTo(8, -8);
        ctx.closePath();
        ctx.fill();
        // Use theme-aware color for shard highlights
        ctx.fillStyle = this.paletteService.getCanvas().STROKE_PRIMARY;
        ctx.beginPath();
        ctx.ellipse(-8, -5, 4, 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(7, -8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;

      case 'crown':
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.moveTo(-10, -8);
        ctx.lineTo(-8, -15);
        ctx.lineTo(-4, -10);
        ctx.lineTo(0, -18);
        ctx.lineTo(4, -10);
        ctx.lineTo(8, -15);
        ctx.lineTo(10, -8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(0, -13, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;

      case 'halo':
        {
          ctx.save();
          ctx.translate(x, y);
          ctx.strokeStyle = '#ffcc00';
          ctx.lineWidth = RENDER_CONFIG.LINE_WIDTHS.DEFAULT;
          ctx.beginPath();
          ctx.ellipse(0, -18, 8, 3, 0, 0, Math.PI * 2);
          ctx.stroke();
          const haloGrad = ctx.createRadialGradient(0, -18, 0, 0, -18, 10);
          haloGrad.addColorStop(0, 'rgba(255,255,0,0.5)');
          haloGrad.addColorStop(1, 'rgba(255,255,0,0)');
          ctx.fillStyle = haloGrad;
          ctx.beginPath();
          ctx.arc(0, -18, 10, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;

      // ── energy-shield ──────────────────────────────────────────────────────
      // Faint cyan shell + slow pulse. Alpha is computed from animationTime (no
      // gradient per frame — we use two concentric arc fills at stepped alpha).
      case 'energy-shield': {
        const shieldColor = this.themeService.isDayMode ? 'rgba(8,145,178,' : 'rgba(0,220,255,';
        // animationTime increments in update(); slow 0.4 Hz pulse
        const pulse = 0.55 + 0.35 * Math.sin(this.animationTime * Math.PI * 0.8);
        ctx.save();
        // Outer ring stroke
        ctx.strokeStyle = shieldColor + (0.55 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, Math.PI * 2);
        ctx.stroke();
        // Inner fill (very faint hex glow — two concentric fills, no gradient alloc)
        ctx.fillStyle = shieldColor + (0.06 * pulse).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 21, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shieldColor + (0.12 * pulse).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      // ── satellite-orbiter ──────────────────────────────────────────────────
      // Small drone dot orbiting the ship. One cheap trig call per frame is
      // acceptable for a SINGLE satellite (not per-entity).
      case 'satellite-orbiter': {
        const orbitRadius = 26;
        const orbitSpeed = 1.8; // radians per second
        const satAngle = this.animationTime * orbitSpeed;
        const satX = x + Math.cos(satAngle) * orbitRadius;
        const satY = y + Math.sin(satAngle) * orbitRadius;
        const satColor = this.themeService.isDayMode ? '#0891b2' : '#00e5ff';
        ctx.save();
        // Orbit ring (very faint dashed)
        ctx.strokeStyle = this.themeService.isDayMode ? 'rgba(8,145,178,0.18)' : 'rgba(0,229,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash(PlayerService.DASH_4_4);
        ctx.beginPath();
        ctx.arc(x, y, orbitRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash(PlayerService.EMPTY_DASH);
        // Satellite body
        ctx.fillStyle = satColor;
        ctx.beginPath();
        ctx.arc(satX, satY, 3, 0, Math.PI * 2);
        ctx.fill();
        // Solar panel stubs (two short lines perpendicular to orbit)
        const perpAngle = satAngle + Math.PI / 2;
        const px = Math.cos(perpAngle) * 5;
        const py = Math.sin(perpAngle) * 5;
        ctx.strokeStyle = satColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(satX - px, satY - py);
        ctx.lineTo(satX + px, satY + py);
        ctx.stroke();
        ctx.restore();
        break;
      }

      // ── trail-effect ───────────────────────────────────────────────────────
      // Lengthens and brightens the existing thrust trail when equipped.
      // Hook: we draw an extra wider trail cone before the ship body is drawn.
      // (drawAccessory is called AFTER drawShip in render(), so we draw behind
      //  by using globalAlpha without save — we must save/restore.)
      case 'trail-effect': {
        if (!this.isCurrentlyMoving) break;
        const trailAngle = this.angle + Math.PI; // opposite to nose
        const pulseT = Date.now() * 0.003;
        const pulse = 0.7 + 0.3 * Math.sin(pulseT);
        const len = 50 * pulse * (1 + this.intensityLevel * 0.5);
        const trailOpacity = 0.25 * pulse;
        const trailColorR = this.themeService.isDayMode ? 47 : 0;
        const trailColorG = this.themeService.isDayMode ? 130 : 200;
        const trailColorB = this.themeService.isDayMode ? 180 : 255;
        ctx.save();
        // Wide fan trail behind ship
        ctx.lineWidth = 12;
        ctx.strokeStyle = `rgba(${trailColorR},${trailColorG},${trailColorB},${trailOpacity})`;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(trailAngle) * len, y + Math.sin(trailAngle) * len);
        ctx.stroke();
        // Narrower bright core
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(${trailColorR},${trailColorG},${trailColorB},${trailOpacity * 1.6})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(trailAngle) * len * 0.6, y + Math.sin(trailAngle) * len * 0.6);
        ctx.stroke();
        ctx.restore();
        break;
      }

      // ── damage-aura ────────────────────────────────────────────────────────
      // Thin red pulsing ring (same pattern as energy-shield, red palette).
      case 'damage-aura': {
        const auraColor = this.themeService.isDayMode ? 'rgba(180,20,60,' : 'rgba(255,40,80,';
        const pulse = 0.5 + 0.5 * Math.sin(this.animationTime * Math.PI * 1.4);
        ctx.save();
        ctx.strokeStyle = auraColor + (0.7 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 24, 0, Math.PI * 2);
        ctx.stroke();
        // Outer faint ring
        ctx.strokeStyle = auraColor + (0.25 * pulse).toFixed(2) + ')';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, Math.PI * 2);
        ctx.stroke();
        // Inner fill flash
        ctx.fillStyle = auraColor + (0.05 * pulse).toFixed(2) + ')';
        ctx.beginPath();
        ctx.arc(x, y, 23, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }

      // ── sparkling-stars ────────────────────────────────────────────────────
      // 5 tiny twinkle points orbiting at varied radii/phases.
      // Phase offsets and radii are pre-allocated static arrays — no per-frame alloc.
      case 'sparkling-stars': {
        const starColor = this.themeService.isDayMode ? 'rgba(8,145,178,' : 'rgba(180,255,255,';
        ctx.save();
        const phases = PlayerService._STAR_PHASES;
        const radii = PlayerService._STAR_RADII;
        for (let i = 0; i < 5; i++) {
          const a = this.animationTime * 2.0 + phases[i];
          const r = radii[i];
          const sx = x + Math.cos(a) * r;
          const sy = y + Math.sin(a) * r;
          // Twinkle: alpha oscillates per-star using its phase offset
          const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(this.animationTime * 3.0 + phases[i]));
          ctx.fillStyle = starColor + twinkle.toFixed(2) + ')';
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
    }
  }

  /**
   * Draw rotation speed indicator ring
   * Shows a subtle dashed ring that grows and intensifies with rotation speed
   */
  private drawRotationSpeedIndicator(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const indicator = PLAYER_CONFIG.ANIMATION.CHARGED_ROTATION.INDICATOR;

    // Only show indicator when rotation is enhanced and not moving
    if (this.currentRotationMultiplier <= indicator.ACTIVATION_THRESHOLD || this.isCurrentlyMoving) {
      return;
    }

    // Calculate normalized speed ratio (0 to 1)
    const speedRatio =
      (this.currentRotationMultiplier - 1) / (PLAYER_CONFIG.ANIMATION.CHARGED_ROTATION.MAX_MULTIPLIER - 1);

    // Interpolate ring properties based on speed
    const ringRadius = indicator.MIN_RADIUS + speedRatio * (indicator.MAX_RADIUS - indicator.MIN_RADIUS);
    const ringOpacity = indicator.MIN_OPACITY + speedRatio * (indicator.MAX_OPACITY - indicator.MIN_OPACITY);
    const lineWidth = indicator.LINE_WIDTH_MIN + speedRatio * (indicator.LINE_WIDTH_MAX - indicator.LINE_WIDTH_MIN);

    // Draw the indicator ring
    ctx.save();
    ctx.strokeStyle = `rgba(255, 100, 255, ${ringOpacity})`; // Purple/magenta for focus charge
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(PlayerService.ROTATION_INDICATOR_DASH);
    ctx.beginPath();
    ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(PlayerService.EMPTY_DASH); // Reset dash pattern
    ctx.restore();
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const cached = this.hexToRgbCache.get(hex);
    if (cached !== undefined) {
      return cached;
    }
    const sh = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const expanded = hex.replace(sh, (_m: string, r: string, g: string, b: string) => r + r + g + g + b + b);
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expanded);
    const result = res
      ? {
          r: parseInt(res[ARRAY_INDICES.COLOR_COMPONENTS.RED], 16),
          g: parseInt(res[ARRAY_INDICES.COLOR_COMPONENTS.GREEN], 16),
          b: parseInt(res[ARRAY_INDICES.COLOR_COMPONENTS.BLUE], 16),
        }
      : null;
    this.hexToRgbCache.set(hex, result);
    return result;
  }

  resetDischargeCooldown(): void {
    this.dischargeAvailable = true;
    window.clearTimeout(this.dischargeTimeout);
    this.cooldownResetSubject.next();
  }

  resetDashCooldown(): void {
    this.dashAvailable = true;
    window.clearTimeout(this.dashTimeout);
    this.cooldownResetSubject.next();
  }

  resetDirectionChangeCooldown(): void {
    this.directionChangeCooldown = false;
    window.clearTimeout(this.directionChangeTimeout);
    this.cooldownResetSubject.next();
  }

  // Method to get the direction active duration
  getDirectionActiveDuration(): number {
    return this.DIRECTION_ACTIVE_DURATION;
  }

  // Method to set the direction active duration
  setDirectionActiveDuration(_duration: number): void {
    this.DIRECTION_ACTIVE_DURATION = _duration;
    this.cooldownResetSubject.next();
  }

  isDashing(): boolean {
    return this.dashInProgress;
  }

  getPosition(): { x: number; y: number } {
    return {
      x: this.x$.value,
      y: this.y$.value,
    };
  }

  getState(): {
    position: { x: number; y: number };
    angle: number;
    health: number;
    isGameActive: boolean;
    isDashing: boolean;
    isInvincible: boolean;
    speedMultiplier: number;
    cooldowns: {
      discharge: {
        available: boolean;
        remaining: number;
        cooldown: number;
      };
      dash: {
        available: boolean;
      };
      direction: {
        onCooldown: boolean;
        active: boolean;
      };
    };
  } {
    return {
      position: this.getPosition(),
      angle: this.angle,
      health: this.playerUpgrades.getMaxHealth(),
      isGameActive: this.isGameActive,
      isDashing: this.dashInProgress,
      isInvincible: this.invincible,
      speedMultiplier: this.playerUpgrades.getSpeedMultiplier(),
      cooldowns: {
        discharge: {
          available: this.dischargeAvailable,
          remaining: this.dischargeRemainingMs,
          cooldown: this.DISCHARGE_COOLDOWN,
        },
        dash: {
          available: this.dashAvailable,
        },
        direction: {
          onCooldown: this.directionChangeCooldown,
          active: this.directionChangeActive,
        },
      },
    };
  }

  // ============================================================================
  // DIRECTION PERSISTENCE METHODS — delegates to PlayerDirectionTrackerService
  // ============================================================================

  /**
   * Get the last known direction for projectile firing.
   * Prioritizes most recent input between movement and click.
   */
  getLastDirection(): { x: number; y: number; source: 'movement' | 'click' | 'none' } {
    return this.directionTracker.getLastDirection();
  }

  /**
   * Get specific movement direction (for systems that need to distinguish)
   */
  getLastMovementDirection(): { x: number; y: number } {
    return this.directionTracker.getLastMovementDirection();
  }

  /**
   * Get specific click direction (for systems that need to distinguish)
   */
  getLastClickDirection(): { x: number; y: number } {
    return this.directionTracker.getLastClickDirection();
  }

  /**
   * Check how recent the last direction input was
   */
  getTimeSinceLastDirection(): number {
    return this.directionTracker.getTimeSinceLastDirection();
  }

  /**
   * Get current movement charge percentage (0-100)
   */
  getMovementCharge(): number {
    return this.movementCharge; // Already 0-100 from setDualCharges
  }

  /**
   * Get current focus charge percentage (0-100)
   */
  getFocusCharge(): number {
    return this.focusCharge; // Already 0-100
  }

  /**
   * Set charge level from ECS ChargingComponent
   * This allows the ECS system to sync charge state with PlayerService
   * @param chargeLevel - Charge level from 0-1
   * @param isMoving - Whether the player is currently moving
   */
  /**
   * Set both charge values from the dual charging system (ECS source of truth).
   * PlayerService is a passive consumer — it stores these for HUD display only.
   * @param movementCharge - Movement charge (0-100)
   * @param focusCharge - Focus charge (0-100)
   * @param isMoving - Whether the player is currently moving
   */
  setDualCharges(movementCharge: number, focusCharge: number, isMoving: boolean): void {
    this.movementCharge = Math.max(0, Math.min(100, movementCharge));
    this.focusCharge = Math.max(0, Math.min(100, focusCharge));
    this.isFocusCharging = !isMoving && focusCharge < 100;
  }

  /**
   * Trigger auto-fire at 100% charge (movement or focus)
   * Fires if EITHER charge is at 100%
   */
  triggerMovementAutoFire(): boolean {
    // Set pending shot when EITHER charge is at 100%
    // Don't gate on weaponCooldownRemaining here - let shouldFireProjectile() and
    // WeaponComponent.canFire() handle cooldown gating. This prevents a race condition
    // where the ECS transition-based auto-fire check fires before the PlayerService
    // cooldown has fully decayed (floating-point frame timing), consuming the transition
    // without setting pendingChargeShot.
    if (this.movementCharge >= 100 || this.focusCharge >= 100) {
      this.pendingChargeShot = true;
      return true;
    }
    return false;
  }

  /**
   * Check if the weapon system should fire a projectile.
   * Cooldown is handled by WeaponComponent.canFire() in WeaponFiringSystemService.
   * Projectiles ONLY fire in shooting mode (isShiftFiring). Beam and shooting are
   * mutually exclusive — no projectiles when beam is active.
   */
  shouldFireProjectile(): boolean {
    return this.isShiftFiring;
  }

  /**
   * Get the active charge type for UI display
   * @returns 'focus' if focus charge is active (>= 1%), otherwise 'movement'
   */
  getActiveChargeType(): 'focus' | 'movement' {
    // If player is moving, immediately show movement charge
    if (this.isCurrentlyMoving && this.movementCharge > 0) {
      return 'movement';
    }
    // If stationary and has focus charge, show focus
    if (!this.isCurrentlyMoving && this.focusCharge >= 0.01) {
      return 'focus';
    }
    // Default based on which has more charge
    return this.focusCharge > this.movementCharge ? 'focus' : 'movement';
  }

  /**
   * Get the display charge percentage for UI
   * Uses priority system: focus when >= 1%, otherwise movement
   */
  getDisplayCharge(): number {
    const activeType = this.getActiveChargeType();
    return activeType === 'focus' ? this.getFocusCharge() : this.getMovementCharge();
  }

  /**
   * Sync fire cooldown readiness from ECS DualChargingComponent.
   * Called by DualChargingSystemService each frame.
   * @param percent - 0 = just fired (on cooldown), 100 = ready to fire
   */
  setFireCooldownPercent(percent: number): void {
    this.fireReadyPercent = Math.max(0, Math.min(100, percent));
  }

  /**
   * Returns fire cooldown as 0-100.
   * 0 = just fired (on cooldown), 100 = ready to fire.
   */
  getFireReadyPercent(): number {
    return this.fireReadyPercent;
  }

  ngOnDestroy(): void {
    // MEMORY LEAK FIX: Remove event listeners
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);

    this.clearTransientTimers();

    // Complete all subjects
    this.x$.complete();
    this.y$.complete();
    this.cooldownResetSubject.complete();
    this.dischargeSubject.complete();

    // Clear any references
    this.gameEngine = null;

    // Release baked OffscreenCanvas references so the GC can reclaim GPU texture memory
    this._shipBodyCanvasMap.clear();
  }
}
