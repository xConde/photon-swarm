import { inject, Injectable, Injector, signal, WritableSignal } from '@angular/core';
import { Observable, Subject, Subscription } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { GameState, GameStats, RunEndReason } from '../models/game-state.model';
import { RunCheckpoint } from '../models/save-game.model';
import { StorageService } from '../../services/storage.service';
import { PlayerService } from '../player/player.service';
import { PlayerUpgradesService } from '../player/player-upgrades.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { UpgradeService } from '../../services/upgrade.service';
import { CurseService } from '../../services/curse.service';
import { WORLD_CONFIG } from '@photon/config/game-constants';
import { AudioService } from '../audio/audio.service';
import { PostProcessingService } from '../effects/post-processing.service';
import { AchievementService } from '../../services/achievement.service';
import { DifficultyService } from '../../services/difficulty.service';
import { SaveGameAdapter } from './save-game.adapter';
import { FactionStandingSystemService } from '../systems/gameplay/faction-standing-system.service';
// Zone services resolved lazily via Injector to break circular DI
// (GameStateService → TreasureCacheSystem → GameStateService).
import { ZoneStateService } from '../systems/world/zone-state.service';
import { ZoneGateSystemService } from '../systems/world/zone-gate-system.service';
import { TreasureCacheSystemService } from '../systems/world/treasure-cache-system.service';
import { ZoneConfigService } from '../systems/world/zone-config.service';

/**
 * Level-based healing configuration
 */
const LEVEL_HEALING = {
  THRESHOLDS: {
    LOW: 5, // Level 1-5
    MID: 10, // Level 6-10
    HIGH: 20, // Level 11-20
  },
  HEAL_PERCENT: {
    LOW: 0.1, // 10% heal
    MID: 0.15, // 15% heal
    HIGH: 0.2, // 20% heal
    MAX: 0.25, // 25% heal
  },
} as const;

/**
 * Manages core game state including health, shards, kills, and game events
 */
@Injectable({
  providedIn: 'root',
})
export class GameStateService {
  // Lazy-injected zone services — resolved on first use to break circular DI
  // (GameStateService → TreasureCacheSystem → GameStateService).
  private readonly injector = inject(Injector);
  private _zoneStateService?: ZoneStateService;
  private _zoneGateSystem?: ZoneGateSystemService;
  private _treasureCacheSystem?: TreasureCacheSystemService;
  private _zoneConfigService?: ZoneConfigService;

  private get zoneStateService(): ZoneStateService {
    return (this._zoneStateService ??= this.injector.get(ZoneStateService));
  }
  private get zoneGateSystem(): ZoneGateSystemService {
    return (this._zoneGateSystem ??= this.injector.get(ZoneGateSystemService));
  }
  private get treasureCacheSystem(): TreasureCacheSystemService {
    return (this._treasureCacheSystem ??= this.injector.get(TreasureCacheSystemService));
  }
  private get zoneConfigService(): ZoneConfigService {
    return (this._zoneConfigService ??= this.injector.get(ZoneConfigService));
  }

  // Core game state - CRITICAL: health must start at 100 to prevent instant death
  private health = 100;
  private shards = 0;
  private kills = 0;
  private playerName = '';
  private runEnded = false;

  // Health precision helper - round to 2 decimal places
  // Also guards against NaN/Infinity — returns 0 (dead state) if invalid
  private roundHealth(value: number): number {
    const rounded = Math.round(value * 100) / 100;
    return Number.isFinite(rounded) ? rounded : 0;
  }

  // Kill tracking
  private killStreak = 0;
  private maxKillStreak = 0;
  private lastKillTime = 0;
  private readonly KILL_STREAK_TIMEOUT = 5000;

  // Player action tracking
  private playerActionCount = 0;
  private lastEliteSpawnTime = 0;
  private luckMultiplier = 1.0;

  // Game state
  private paused = true;
  private startTime = 0;
  private lastTime = 0;

  // Storage keys
  private readonly NAME_KEY = 'player-name';

  // Signal-based state (modern Angular 17+ pattern)
  private stateSignal: WritableSignal<GameState | null> = signal(null);
  /**
   * Readonly signal for game state - modern reactive pattern
   * Use this for new components instead of state$ observable
   */
  public readonly state = this.stateSignal.asReadonly();

  /**
   * Compatibility shim — interop the readonly signal back into an
   * Observable for the remaining test specs that consume RxJS
   * operators on the state stream. Sprint A8d retired the legacy
   * stateSubject + the @deprecated handwritten state$ getter; new
   * code should always read the signal directly.
   *
   * @deprecated Use the `state` signal in new code.
   */
  public readonly state$: Observable<GameState | null> = toObservable(this.stateSignal);

  // Event streams (Subjects are appropriate for events, not state)
  private levelUpRequestSubject = new Subject<void>();
  /**
   * Observable that emits when player should be shown upgrade options
   */
  public levelUpRequest$ = this.levelUpRequestSubject.asObservable();

  private gameOverSubject = new Subject<GameStats>();
  /**
   * Observable that emits when game over occurs with final stats
   */
  public gameOver$ = this.gameOverSubject.asObservable();

  // Subscription to progression system
  private levelUpSubscription?: Subscription;

  constructor(
    private storage: StorageService,
    private player: PlayerService,
    private playerUpgrades: PlayerUpgradesService,
    private debugLog: DebugLogBridgeService,
    private progressionSystem: ProgressionSystemService,
    private upgradeService: UpgradeService,
    private curseService: CurseService,
    private audio: AudioService,
    private postProcessing: PostProcessingService,
    private achievementService: AchievementService,
    private saveAdapter: SaveGameAdapter,
    private difficultyService: DifficultyService,
    private factionStandingSystem: FactionStandingSystemService
  ) {
    // CRITICAL FIX: Ensure health is never 0 on initialization
    if (this.health <= 0) {
      this.health = 100;
      this.debugLog.log('⚠️ GameStateService health was 0, fixed to 100', 'warning', {
        source: 'game_state_constructor',
        operation: 'health_fix',
      });
    }

    // CRITICAL DEBUG: Log initial health state
    this.debugLog.log('🏥 GameStateService initialized', 'info', {
      source: 'game_state_constructor',
      initialHealth: this.health,
      playerMaxHealth: this.player.getMaxHealth(),
      progressionLevel: this.progressionSystem.level,
    });

    this.initializeLevelUpSubscription();

    // Start with a subtle dark vignette during normal gameplay
    this.postProcessing.setVignetteState('normal');
  }

  private initializeLevelUpSubscription(): void {
    // Clean up any existing subscription first
    if (this.levelUpSubscription) {
      this.levelUpSubscription.unsubscribe();
    }

    // Subscribe to level up events from progression system
    this.levelUpSubscription = this.progressionSystem.levelUp$.subscribe((newLevel) => {
      this.debugLog.log(`🎆 Level up detected! Level ${newLevel}`, 'success', {
        source: 'game_state_service',
        operation: 'level_up_event',
        newLevel,
      });

      // Gold screen flash on level-up
      this.postProcessing.addScreenFlash(PostProcessingService.FLASH_PRESETS.LEVEL_UP);

      // Scale healing with level - less at early levels to prevent immortality loop
      const currentHealth = this.health;
      const maxHealth = this.player.getMaxHealth();
      let healPercent: number = LEVEL_HEALING.HEAL_PERCENT.LOW; // 10% base

      if (newLevel > LEVEL_HEALING.THRESHOLDS.HIGH) {
        healPercent = LEVEL_HEALING.HEAL_PERCENT.MAX;
      } else if (newLevel > LEVEL_HEALING.THRESHOLDS.MID) {
        healPercent = LEVEL_HEALING.HEAL_PERCENT.HIGH;
      } else if (newLevel > LEVEL_HEALING.THRESHOLDS.LOW) {
        healPercent = LEVEL_HEALING.HEAL_PERCENT.MID;
      }

      const healAmount = Math.floor(maxHealth * healPercent);
      const actualHeal = Math.min(healAmount, maxHealth - currentHealth); // Don't exceed max

      if (actualHeal > 0) {
        this.heal(actualHeal, 'level_up_bonus');

        this.debugLog.log(
          `💚 Level ${newLevel} health bonus: +${actualHeal} HP (${(healPercent * 100).toFixed(0)}%)`,
          'success',
          {
            source: 'game_state_service',
            operation: 'level_up_heal',
            level: newLevel,
            healPercent: healPercent,
            requestedHeal: healAmount,
            actualHeal,
            healthBefore: currentHealth,
            healthAfter: this.health,
            maxHealth: maxHealth,
          }
        );
      } else {
        this.debugLog.log(`💚 Level up: Already at max health`, 'info', {
          source: 'game_state_service',
          operation: 'level_up_heal_skipped',
          currentHealth,
          maxHealth,
        });
      }

      // Show upgrade modal every 2 levels at all levels (2, 4, 6, 8, 10, 12, …)
      const shouldShowUpgrade = newLevel % 2 === 0;

      // Auto-save checkpoint on level-up
      this.saveRunCheckpoint();

      if (shouldShowUpgrade) {
        this.debugLog.log(`📦 Showing upgrade modal for level ${newLevel}`, 'info', {
          source: 'game_state_service',
          operation: 'upgrade_modal_trigger',
          newLevel,
        });
        this.levelUpRequestSubject.next();
      } else {
        this.debugLog.log(`⏭️ Skipping upgrade modal for level ${newLevel}`, 'info', {
          source: 'game_state_service',
          operation: 'upgrade_modal_skip',
          newLevel,
          nextUpgradeLevel: newLevel + (2 - (newLevel % 2)),
        });
      }
    });
  }

  private updateVignetteFromHealth(): void {
    const maxHealth = this.player.getMaxHealth();
    const healthPercent = maxHealth > 0 ? this.health / maxHealth : 1;
    this.postProcessing.setVignetteState(healthPercent < 0.3 ? 'danger' : 'normal');
  }

  // === PLAYER NAME ===

  /**
   * Generates a random Pilot-<id> callsign — the same fallback setPlayerName()
   * and getPlayerName() fall back to when no name is available. Pure: no
   * storage write, no mutation of this.playerName. Exposed (via
   * GameEngineService.generatePilotName()) so callers that need the fallback
   * name to exist BEFORE the player's actual name is committed — e.g. the
   * intro screen showing it in the mission briefing right after a blank
   * submit — can generate it without duplicating this literal.
   */
  public generatePilotName(): string {
    return 'Pilot‑' + Math.floor(Math.random() * 1e6);
  }

  /**
   * Sets the player's name and persists to storage
   * Generates a random pilot name if empty string provided
   * @param name The player name to set (generates random name if empty)
   */
  public setPlayerName(name: string): void {
    const previousName = this.playerName;
    // If empty name provided, generate a pilot name
    if (!name?.trim()) {
      this.playerName = this.generatePilotName();
    } else {
      this.playerName = name.trim();
    }
    this.storage.set(this.NAME_KEY, this.playerName);

    // Debug logging to track name changes
    if (this.debugLog) {
      this.debugLog.log(`👤 Player name changed`, 'info', {
        source: 'game_state_service',
        previousName,
        newName: this.playerName,
        providedName: name,
        savedToStorage: true,
      });
    }
  }

  /**
   * Retrieves the player's name from memory or storage
   * Generates a random pilot name if no name is stored
   * @returns The player's name
   */
  public getPlayerName(): string {
    if (!this.playerName?.trim()) {
      const saved = this.storage.get<string>(this.NAME_KEY);
      if (saved?.trim()) {
        this.playerName = saved;
      } else {
        // Generate a new pilot name if nothing saved
        this.playerName = this.generatePilotName();
        // Save the generated name
        this.storage.set(this.NAME_KEY, this.playerName);
      }

      // Debug logging to track name retrieval
      if (this.debugLog) {
        this.debugLog.log(`👤 Player name retrieved`, 'info', {
          source: 'game_state_service',
          savedName: saved,
          finalName: this.playerName,
          wasEmpty: !saved?.trim(),
          generated: !saved?.trim(),
        });
      }
    }
    return this.playerName;
  }

  // === HEALTH ===

  /**
   * Gets the player's current health value
   * @returns Current health (0 to maxHealth)
   */
  public getHealth(): number {
    return this.health;
  }

  /**
   * Gets the player's maximum health value
   * Delegates to PlayerService which handles max health upgrades
   * @returns Maximum health (defaults to 100 if not initialized)
   */
  public getMaxHealth(): number {
    // Delegate to player service which handles max health upgrades
    const maxHealth = this.player.getMaxHealth();
    return maxHealth > 0 ? maxHealth : 100;
  }

  /**
   * Sets the player's health to a specific value
   * Blocks health changes when player is dead (except from spawn sources)
   * Clamps value to valid range [0, maxHealth]
   * @param value The new health value to set
   * @param source The source of the health change (for debugging)
   */
  public setHealth(value: number, source: string = 'unknown'): void {
    if (!Number.isFinite(value)) return;

    const healthBefore = this.health;

    // CRITICAL FIX: Block health changes when player is dead (except setting to 0)
    // Spawn and transactional rollback sources may deliberately restore a live player.
    const canRestoreDeadPlayer =
      source === 'player_spawn_fix' || source === 'spawn_sync' || source === 'upgrade_transaction_rollback';
    if (healthBefore <= 0 && value > 0 && !canRestoreDeadPlayer) {
      this.debugLog.log('⚠️ Attempted to set health > 0 on dead player blocked', 'warning', {
        source: 'game_state_service',
        operation: 'setHealth_blocked',
        healthBefore,
        attemptedValue: value,
        setSource: source,
      });
      return;
    }

    const maxHealth = this.player.getMaxHealth();

    // CRITICAL FIX: Ensure maxHealth is valid, default to 100 if not initialized
    const safeMaxHealth = maxHealth > 0 ? maxHealth : 100;
    this.health = this.roundHealth(Math.max(0, Math.min(value, safeMaxHealth)));
    this.emitState();
    this.updateVignetteFromHealth();

    // Skip logging if source is enemy_contact - collision system already logs it
    if (source === 'enemy_contact') {
      return;
    }

    // CRITICAL FIX: Skip logging damage from health_sync_system when player is dead
    // This prevents spurious damage logs after death
    if (source === 'health_sync_system' && healthBefore <= 0 && this.health <= 0) {
      return;
    }

    // Flag suspicious setHealth calls (dramatic changes)
    // Spawn/sync sources are never suspicious — they're expected initialization
    const isSpawnSource = source === 'player_spawn_fix' || source === 'spawn_sync';
    const healthDiff = Math.abs(this.health - healthBefore);
    const isSuspiciousSet = !isSpawnSource && (healthDiff > 50 || (healthBefore < 20 && this.health >= 95));

    // Send to debug bridge without expensive stack trace
    // Only log meaningful changes (skip tiny floating point differences)
    if (healthDiff > 0.1) {
      const setHealthData = {
        type: 'HEALTH_SET',
        valueBefore: healthBefore,
        valueAfter: this.health,
        requestedValue: value,
        source,
        amount: Math.abs(this.health - healthBefore), // Calculate actual amount changed
        timestamp: Date.now(),
      };

      const isHeal = this.health > healthBefore;
      if (isHeal) {
        this.debugLog.logHeal(setHealthData, isSuspiciousSet);
      } else {
        this.debugLog.logDamage(setHealthData, isSuspiciousSet);
      }
    }
  }

  /**
   * Heals the player by the specified amount
   * Blocks healing when player is dead
   * Applies Emergency Protocols buff multiplier if health is below 30%
   * Clamps result to maxHealth
   * @param amount The amount of health to restore
   * @param source The source of the healing (for debugging)
   */
  public heal(amount: number, source: string = 'unknown'): void {
    if (!Number.isFinite(amount)) return;
    if (amount <= 0) return;

    // CRITICAL FIX: Prevent healing when player is dead
    if (this.health <= 0) {
      this.debugLog.log('⚠️ Attempted heal on dead player blocked', 'warning', {
        source: 'game_state_service',
        operation: 'heal_blocked',
        healthBefore: this.health,
        amount,
        healSource: source,
      });
      return;
    }

    const healthBefore = this.health;
    const maxHealth = this.player.getMaxHealth();

    // CRITICAL FIX: Ensure maxHealth is valid, default to 100 if not initialized
    const safeMaxHealth = maxHealth > 0 ? maxHealth : 100;

    // Check for Emergency Protocols buff
    let finalAmount = amount;
    const healthPercent = this.health / safeMaxHealth;

    // If health is below 30%, check for Emergency Protocols buff
    if (healthPercent < 0.3 && this.playerUpgrades.hasEmergencyProtocols()) {
      // Apply emergency healing multiplier
      const emergencyMultiplier = this.playerUpgrades.getEmergencyHealingMultiplier();
      finalAmount = amount * emergencyMultiplier;

      // Log emergency healing activation (rare enough to log)
      if (Math.random() < 0.5) {
        // 50% chance to log
        this.debugLog.log('🚨 Emergency Protocols activated', 'info', {
          source: 'game_state_heal',
          operation: 'emergency_healing',
          healthPercent: (healthPercent * 100).toFixed(1),
          baseAmount: amount,
          multiplier: emergencyMultiplier,
          finalAmount,
        });
      }
    }

    this.health = this.roundHealth(Math.min(safeMaxHealth, this.health + finalAmount));
    this.emitState();
    this.updateVignetteFromHealth();

    // Flag suspicious healing (large amounts or full restoration after low health)
    const isSuspiciousHeal = amount > 50 || (healthBefore < 20 && this.health >= 95);

    // Additional check for the logging anomaly
    const healthAfter = this.health;
    if (healthAfter < healthBefore) {
      // This should never happen in a heal operation!
      this.debugLog.log('🚨 CRITICAL: Heal resulted in health decrease!', 'error', {
        source: 'game_state_heal',
        operation: 'heal_validation',
        healAmount: amount,
        healSource: source,
        healthBefore,
        healthAfter,
        maxHealth: this.player.getMaxHealth(),
        // FIXED: Removed expensive stack trace from production code
      });
    }

    // Send to debug bridge without expensive stack trace
    const healData = {
      type: 'HEAL_APPLIED',
      amount,
      source,
      healthBefore,
      healthAfter,
      timestamp: Date.now(),
    };

    this.debugLog.logHeal(healData, isSuspiciousHeal);
  }

  /**
   * Applies damage to the player
   * Blocks damage to already dead players
   * Triggers game over if health reaches 0
   * Notifies player service for damage-related debounces (e.g., focus charge)
   * @param amount The amount of damage to apply
   * @param source The source of the damage (for debugging)
   */
  public takeDamage(amount: number, source: string = 'unknown'): void {
    if (!Number.isFinite(amount)) return;
    // CRITICAL FIX: Ignore zero or negative damage to prevent false death triggers
    if (amount <= 0) return;

    const healthBefore = this.health;

    // CRITICAL FIX: Prevent damage to already dead player
    if (healthBefore <= 0) {
      this.debugLog.log('⚠️ Attempted damage to dead player blocked', 'warning', {
        source: 'game_state_service',
        operation: 'takeDamage_blocked',
        healthBefore,
        amount,
        damageSource: source,
      });
      return;
    }

    // Check if this is suspicious damage (high percentage or excessive amount)
    const damagePercentage = (amount / healthBefore) * 100;
    const healthAfter = Math.max(0, healthBefore - amount);
    // FIXED: Removed false positive trigger for health 8-12 range
    // This was flagging normal end-game damage as suspicious
    const isSuspicious = damagePercentage >= 90 || amount > 50;

    // Apply damage
    this.health = this.roundHealth(healthAfter);
    this.emitState();
    this.audio.playDamageTaken();
    this.updateVignetteFromHealth();

    // Track damage taken for achievements (untouchable)
    this.achievementService.recordDamageTaken();

    // Notify player service about damage taken (for focus charge debounce)
    if (amount > 0 && this.player && this.player.onDamageTaken) {
      this.player.onDamageTaken(amount);
    }

    // Send to debug bridge without expensive stack trace
    const damageData = {
      type: 'DAMAGE_TAKEN',
      amount: amount, // Ensure the amount is explicitly passed
      source,
      healthBefore,
      healthAfter,
      damagePercentage: damagePercentage.toFixed(1),
      suspicious: isSuspicious,
      timestamp: Date.now(),
    };

    this.debugLog.logDamage(damageData, isSuspicious);

    // Check for player death (use small epsilon for floating point safety)
    // CRITICAL: Only trigger game over if health is ACTUALLY at or below 0
    // Do NOT trigger on false positives
    if (this.health <= 0.01) {
      // Double-check health value before triggering game over
      const actualHealth = this.getHealth();
      if (actualHealth > 0.01) {
        this.debugLog.log('⚠️ FALSE DEATH TRIGGER PREVENTED', 'error', {
          source: 'game_state_service',
          operation: 'false_death_prevented',
          storedHealth: this.health,
          actualHealth: actualHealth,
          damageSource: source,
          damageAmount: amount,
        });
        // Correct the health value
        this.health = actualHealth;
        return;
      }

      this.debugLog.log('Player death detected - triggering game over', 'error', {
        source: 'game_state_service',
        operation: 'death_detection',
        finalHealth: this.health,
        actualHealth: actualHealth,
        damageSource: source,
        damageAmount: amount,
      });

      // Notify adaptive difficulty system if available
      const globalWindow = window as Window & { adaptiveDifficultyService?: { recordPlayerDeath: () => void } };
      if (globalWindow.adaptiveDifficultyService) {
        globalWindow.adaptiveDifficultyService.recordPlayerDeath();
      }

      // Flush pending zone time so stats are accurate even if player was stationary
      this.zoneStateService.flushTimeAccumulator();

      // Trigger game over
      // FIX: Use performance.now() since startTime is set with performance.now()
      const visitedZones = this.zoneStateService.getVisitedZoneIds();
      const zoneStats = visitedZones.map((zoneId) => {
        const state = this.zoneStateService.getZoneState(zoneId);
        const config = this.zoneConfigService.getZoneById(zoneId);
        return {
          zoneId,
          zoneName: config?.name ?? `Zone ${zoneId}`,
          themeColor: config?.themeColor ?? '#ffffff',
          timeSpentMs: state?.timeSpentMs ?? 0,
          guardiansSlain: state?.guardiansSlain ?? 0,
          cachesOpened: state?.cachesOpened ?? 0,
          isCompleted: state?.isCompleted ?? false,
        };
      });
      this.triggerGameOver({
        level: this.progressionSystem.level,
        shards: this.shards,
        kills: this.kills,
        time: Math.floor((window.performance.now() - this.startTime) / 1000),
        health: this.health,
        maxHealth: this.player.getMaxHealth(),
        killStreak: this.killStreak,
        maxKillStreak: this.maxKillStreak,
        difficulty: this.difficultyService.getDifficulty(),
        zonesVisited: visitedZones,
        cachesOpened: this.treasureCacheSystem.openedCacheIds.size,
        guardiansSlain: this.zoneGateSystem.getTotalGuardianKills(),
        zoneStats,
      });
    }
  }

  /**
   * Clamps the player's current health to not exceed maxHealth
   * Called after max health changes from upgrades
   */
  public clampCurrentHealth(): void {
    const maxHealth = this.player.getMaxHealth();
    // CRITICAL FIX: Ensure maxHealth is valid, default to 100 if not initialized
    const safeMaxHealth = maxHealth > 0 ? maxHealth : 100;
    this.health = this.roundHealth(Math.min(this.health, safeMaxHealth));
  }

  // === WORLD BOUNDS ===

  /**
   * Gets the world boundaries for the game area
   * @returns Object containing width and height of the game world
   */
  public getWorldBounds(): { width: number; height: number } {
    return {
      width: WORLD_CONFIG.BOUNDS.WIDTH,
      height: WORLD_CONFIG.BOUNDS.HEIGHT,
    };
  }

  // === SHARDS ===

  /**
   * Gets the player's current shard count (currency)
   * @returns Number of shards owned by player
   */
  public getShards(): number {
    return this.shards;
  }

  /**
   * Adds shards to the player's balance
   * Floors the amount to prevent fractional shards
   * @param amount Number of shards to add
   */
  public addShards(amount: number): void {
    if (!Number.isFinite(amount)) return;
    const flooredAmount = Math.floor(amount);
    this.shards += flooredAmount;
    this.shards = Math.max(0, this.shards);
    this.emitState();

    // Track cumulative shards for achievements
    if (flooredAmount > 0) {
      this.achievementService.recordShardsCollected(flooredAmount);
    }
  }

  /**
   * Attempts to spend shards on a purchase
   * @param cost Number of shards required
   * @returns true if purchase succeeded, false if insufficient shards
   */
  public spendShards(cost: number): boolean {
    if (!Number.isFinite(cost) || !Number.isInteger(cost) || cost <= 0) return false;
    if (this.shards >= cost) {
      this.shards -= cost;
      this.emitState();
      return true;
    }
    return false;
  }

  /** Return currency after a failed transaction without counting it as collection. */
  public refundShards(amount: number): void {
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) return;
    this.shards += amount;
    this.emitState();
  }

  // === KILLS ===

  /**
   * Gets the total number of enemies killed this run
   * @returns Total kill count
   */
  public getKills(): number {
    return this.kills;
  }

  /**
   * Increments the kill counter and updates kill streak
   * Notifies adaptive difficulty system of enemy kill
   */
  public incrementKills(): void {
    this.kills++;
    this.updateKillStreak();
    this.emitState();

    // Notify adaptive difficulty system if available
    const globalWindow = window as Window & { adaptiveDifficultyService?: { recordEnemyKill: () => void } };
    if (globalWindow.adaptiveDifficultyService) {
      globalWindow.adaptiveDifficultyService.recordEnemyKill();
    }
  }

  private updateKillStreak(): void {
    const currentTime = Date.now();

    if (currentTime - this.lastKillTime < this.KILL_STREAK_TIMEOUT) {
      this.killStreak++;
    } else {
      this.killStreak = 1;
    }

    this.lastKillTime = currentTime;
    this.maxKillStreak = Math.max(this.maxKillStreak, this.killStreak);
  }

  /**
   * Gets the current kill streak count
   * Kill streaks reset after 5 seconds without a kill
   * @returns Current consecutive kill count
   */
  public getKillStreak(): number {
    return this.killStreak;
  }

  /**
   * Gets the maximum kill streak achieved this run
   * @returns Highest consecutive kill count reached
   */
  public getMaxKillStreak(): number {
    return this.maxKillStreak;
  }

  // === GAME STATE ===

  /**
   * Checks if the game is currently paused
   * @returns true if game is paused, false if running
   */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * Sets the game's paused state
   * Updates lastTime when unpausing to prevent delta time spikes
   * @param value true to pause, false to unpause
   */
  public setPaused(value: boolean): void {
    this.paused = value;
    if (!this.paused) {
      this.lastTime = Date.now();
    }
  }

  /**
   * Gets the timestamp when the game started
   * @returns Game start time in milliseconds since epoch
   */
  public getStartTime(): number {
    return this.startTime;
  }

  /**
   * Sets the game start time
   * @param time Start time in milliseconds since epoch
   */
  public setStartTime(time: number): void {
    this.startTime = time;
  }

  /** Restore counters and elapsed time from a validated full-run save. */
  public restoreSavedRunMetrics(kills: number, maxKillStreak: number, survivalTimeMs: number): void {
    this.kills = Math.max(0, Math.floor(Number.isFinite(kills) ? kills : 0));
    this.killStreak = 0;
    this.maxKillStreak = Math.max(0, Math.floor(Number.isFinite(maxKillStreak) ? maxKillStreak : 0));
    const elapsedMs = Math.max(0, Number.isFinite(survivalTimeMs) ? survivalTimeMs : 0);
    const now = window.performance.now();
    this.startTime = now - elapsedMs;
    this.lastTime = now;
    this.emitState();
  }

  /**
   * Gets the timestamp of the last game loop update
   * @returns Last update time in milliseconds since epoch
   */
  public getLastTime(): number {
    return this.lastTime;
  }

  /**
   * Sets the last game loop update time
   * @param time Update time in milliseconds since epoch
   */
  public setLastTime(time: number): void {
    this.lastTime = time;
  }

  // === PLAYER ACTIONS ===

  /**
   * Increments the player action counter
   * Used for adaptive difficulty and elite enemy spawning
   */
  public trackPlayerAction(): void {
    this.playerActionCount++;
  }

  /**
   * Gets the total number of player actions performed
   * @returns Player action count
   */
  public getPlayerActionCount(): number {
    return this.playerActionCount;
  }

  /**
   * Resets the player action counter to zero
   * Called when action-based events trigger (e.g., elite spawn)
   */
  public resetPlayerActionCount(): void {
    this.playerActionCount = 0;
  }

  /**
   * Gets the timestamp of the last elite enemy spawn
   * @returns Last elite spawn time in milliseconds since epoch
   */
  public getLastEliteSpawnTime(): number {
    return this.lastEliteSpawnTime;
  }

  /**
   * Sets the timestamp of the last elite enemy spawn
   * @param time Elite spawn time in milliseconds since epoch
   */
  public setLastEliteSpawnTime(time: number): void {
    this.lastEliteSpawnTime = time;
  }

  /**
   * Gets the current luck multiplier for loot drops
   * @returns Luck multiplier (1.0 = normal, >1.0 = increased luck)
   */
  public getLuckMultiplier(): number {
    return this.luckMultiplier;
  }

  /**
   * Sets the luck multiplier for loot drops
   * @param value Luck multiplier to set
   */
  public setLuckMultiplier(value: number): void {
    this.luckMultiplier = value;
  }

  // === EVENTS ===

  /**
   * Requests the upgrade modal to be shown
   * Emits to levelUpRequest$ observable
   */
  public requestLevelUp(): void {
    this.levelUpRequestSubject.next();
  }

  /**
   * Triggers game over state with final statistics. Resets upgrades and
   * curses for roguelike gameplay and emits the final stats (with an
   * embedded `endReason`) via the gameOver$ observable. Callers should
   * pass `'victory'` when the run ended on a triumphant Zone 4 clear and
   * `'quit'` for an explicit save-and-quit; default is `'death'` so the
   * existing death-detection callers don't need to change.
   * @param stats Final game statistics to display
   * @param reason How the run ended — drives end-screen branching
   */
  public triggerGameOver(stats: GameStats, reason: RunEndReason = 'death'): boolean {
    if (this.runEnded) {
      this.debugLog.log('Ignored duplicate run termination', 'warning', {
        source: 'game_state_service',
        operation: 'duplicate_game_over_ignored',
        attemptedReason: reason,
      });
      return false;
    }
    this.runEnded = true;

    const statsWithReason: GameStats = {
      ...stats,
      endReason: reason,
      runBuild: this.upgradeService.getRunBuildSummary(),
    };

    this.debugLog.log('🎮 GameStateService.triggerGameOver called', reason === 'victory' ? 'success' : 'error', {
      source: 'game_state_service',
      operation: 'trigger_game_over',
      reason,
      stats: statsWithReason,
      hasSubscribers: this.gameOverSubject.observers?.length > 0,
    });

    // Record run completion for achievements
    const survivalTime = Math.floor((window.performance.now() - this.startTime) / 1000);
    this.achievementService.recordTimeSurvived(survivalTime);
    this.achievementService.recordRunComplete();

    // Clear run checkpoint — the run is over, regardless of how it ended.
    this.saveAdapter.clearCheckpoint();

    // Reset upgrades and curses for roguelike gameplay
    // Upgrades are only for the current run
    this.upgradeService.resetAllUpgrades();
    this.curseService.resetAllCurses();

    this.debugLog.log('♾️ Roguelike reset: All upgrades and curses cleared', 'info', {
      source: 'game_state_service',
      operation: 'roguelike_reset',
      reason,
    });

    this.gameOverSubject.next(statsWithReason);
    return true;
  }

  public isRunEnded(): boolean {
    return this.runEnded;
  }

  // === STATE EMISSION ===

  /**
   * Emits the current game state to both signal and observable subscribers
   * Updates both modern signal-based and legacy observable-based state
   * @param additionalData Optional additional state properties to merge
   */
  public emitState(additionalData?: Partial<GameState>): void {
    const maxHealth = this.player.getMaxHealth();
    const baseState: GameState = {
      health: this.health, // Already rounded
      maxHealth: maxHealth > 0 ? maxHealth : 100, // CRITICAL FIX: Ensure valid maxHealth
      xp: this.progressionSystem.xp, // REAL XP from progression system
      level: this.progressionSystem.level, // REAL LEVEL from progression system
      shards: this.shards,
      kills: this.kills,
      killStreak: this.killStreak,
      maxKillStreak: this.maxKillStreak,
    };

    const newState = { ...baseState, ...additionalData };

    // Signal-only since Sprint A8d. The legacy stateSubject + state$
    // observable were retired once HUD / Shop / PhotonSwarmComponent
    // migrated to effect() over `state` signal.
    this.stateSignal.set(newState);
  }

  // === RESET ===

  /**
   * Resets all game state to initial values for a new game
   * Resets health to 100, clears kills, shards, streaks, and timers
   * Re-initializes level up subscription to prevent stale references
   * Emits updated state to all subscribers
   */
  public reset(): void {
    // CRITICAL FIX: Log reset to debug health issues
    this.debugLog.log('🔄 GameStateService.reset() called', 'info', {
      source: 'game_state_reset',
      healthBefore: this.health,
      playerMaxHealth: this.player.getMaxHealth(),
    });

    // Spawn at the ascension-scaled max so meta HP bonuses are honored on run start,
    // not just as a ceiling that healing has to climb toward. Falls back to 100 if
    // the player service hands back a non-positive number — otherwise a broken init
    // order would spawn the player dead.
    const maxFromPlayer = this.player.getMaxHealth();
    const safeMax = Number.isFinite(maxFromPlayer) && maxFromPlayer > 0 ? maxFromPlayer : 100;
    this.health = this.roundHealth(safeMax);
    this.shards = 0;
    this.kills = 0;
    this.killStreak = 0;
    this.maxKillStreak = 0;
    this.lastKillTime = 0;
    this.playerActionCount = 0;
    this.lastEliteSpawnTime = 0;
    this.luckMultiplier = 1.0;
    this.runEnded = false;
    // DO NOT set paused = true here - let calling code manage pause state
    this.startTime = 0;
    this.lastTime = 0;

    // Reset per-run achievement tracking
    this.achievementService.resetRunState();

    // Re-initialize the level up subscription to prevent stale references
    this.initializeLevelUpSubscription();

    this.postProcessing.setVignetteState('normal');
    this.postProcessing.clear();

    this.emitState();

    // CRITICAL FIX: Verify health was set correctly
    this.debugLog.log('✅ GameStateService.reset() complete', 'info', {
      source: 'game_state_reset',
      healthAfter: this.health,
      emittedMaxHealth: this.player.getMaxHealth() > 0 ? this.player.getMaxHealth() : 100,
    });
  }

  // === RUN CHECKPOINT ===

  /**
   * Saves a lightweight run checkpoint to localStorage.
   * Called on level-up, pause, and tab backgrounding.
   */
  public saveRunCheckpoint(): boolean {
    if (this.health <= 0) return false; // Don't checkpoint a dead run

    const timePlayed = this.startTime > 0 ? Math.floor((window.performance.now() - this.startTime) / 1000) : 0;

    const checkpoint: RunCheckpoint = {
      version: 1,
      timestamp: Date.now(),
      health: this.health,
      maxHealth: this.player.getMaxHealth(),
      level: this.progressionSystem.level,
      xp: this.progressionSystem.xp,
      shards: this.shards,
      kills: this.kills,
      upgrades: this.upgradeService.getUpgradesForSave(),
      timePlayed,
      playerName: this.getPlayerName(),
      // Guarded: partial test mocks of the faction system omit serialize(); a missing
      // method degrades to no faction data rather than crashing the (best-effort)
      // checkpoint. The real runtime service always implements it.
      factionStandings:
        typeof this.factionStandingSystem.serialize === 'function' ? this.factionStandingSystem.serialize() : [],
    };

    return this.saveAdapter.saveCheckpoint(checkpoint);
  }

  /**
   * Restores game state from a run checkpoint.
   * Returns true if restoration succeeded.
   */
  public restoreFromCheckpoint(checkpoint: RunCheckpoint): boolean {
    try {
      // Restore health — max health is NOT set here because the upgrade effect
      // loop in resumeFromCheckpoint() re-applies all upgrades (including shield),
      // which is the single source of truth for max health calculation.
      this.health = this.roundHealth(Math.min(checkpoint.health, checkpoint.maxHealth));

      // Restore progression
      this.progressionSystem.setLevel(checkpoint.level);
      this.progressionSystem.setXp(checkpoint.xp);

      // Restore economy
      this.shards = checkpoint.shards;
      this.kills = checkpoint.kills;

      // Restore player name
      this.setPlayerName(checkpoint.playerName);

      // Restore upgrades via UpgradeService
      this.upgradeService.loadUpgradesFromSave(checkpoint.upgrades);

      // Restore faction standings — optional field; absent in older checkpoints so
      // deserialize(undefined) is a safe no-op that leaves standings at defaults.
      if (typeof this.factionStandingSystem.deserialize === 'function') {
        this.factionStandingSystem.deserialize(checkpoint.factionStandings);
      }

      // Adjust start time to account for previously played time
      this.startTime = window.performance.now() - checkpoint.timePlayed * 1000;

      this.emitState();

      this.debugLog.log('Checkpoint restored', 'success', {
        source: 'game_state_service',
        operation: 'restoreFromCheckpoint',
        level: checkpoint.level,
        health: this.health,
        shards: this.shards,
        kills: this.kills,
        upgradeCount: Object.keys(checkpoint.upgrades).length,
        factionStandingsRestored: checkpoint.factionStandings?.length ?? 0,
      });

      return true;
    } catch (error) {
      this.debugLog.log('Failed to restore checkpoint', 'error', {
        source: 'game_state_service',
        operation: 'restoreFromCheckpoint',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  // === UPDATE LOOP ===

  /**
   * Update game state on each game loop tick
   * Health regeneration is disabled here (handled by TerritorySystem via ECS)
   * Skips all updates when player is dead
   * @param _deltaTime Time elapsed since last update in milliseconds (unused)
   */
  public update(_deltaTime: number): void {
    // CRITICAL FIX: Don't process updates when player is dead
    if (this.health <= 0) {
      return;
    }

    // Health regeneration DISABLED - now handled by TerritorySystem
    // which directly modifies ECS HealthComponent and syncs back to GameState
    // This prevents the dual-source health regeneration sync issue

    // Other update logic can go here if needed
  }

  /**
   * Cleanup method to unsubscribe from observables
   * Should be called when the service is being destroyed
   * Prevents memory leaks from active subscriptions
   */
  public destroy(): void {
    if (this.levelUpSubscription) {
      this.levelUpSubscription.unsubscribe();
      this.levelUpSubscription = undefined;
    }
  }
}
