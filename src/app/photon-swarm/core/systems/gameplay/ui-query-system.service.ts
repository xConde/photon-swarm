import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { GameStateService } from '../../state/game-state.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import {
  BuffComponent,
  ChargingComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  WeaponComponent,
} from '@photon/components';
import { BehaviorSubject } from 'rxjs';
import { PROGRESSION_CONFIG, TIMING_CONFIG } from '@photon/config/game-constants';

/**
 * UI Query Service - Provides ECS data to UI components
 *
 * This service acts as a bridge between the ECS world and UI components,
 * translating entity component data into UI-friendly formats.
 */
@Injectable({
  providedIn: 'root',
})
export class UIQuerySystemService implements OnDestroy {
  private playerStatsSubject = new BehaviorSubject<PlayerUIData | null>(null);
  public playerStats$ = this.playerStatsSubject.asObservable();

  private updateInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private ngZone: NgZone,
    private entityManager: EntityManagerService,
    private playerService: PlayerService,
    private gameStateService: GameStateService,
    private progressionSystem: ProgressionSystemService
  ) {}

  /**
   * Start polling for UI updates
   */
  startPolling(intervalMs: number = TIMING_CONFIG.UI_QUERY_SYSTEM.UPDATE_INTERVAL_MS): void {
    this.stopPolling();

    this.ngZone.runOutsideAngular(() => {
      this.updateInterval = setInterval(() => {
        this.updatePlayerStats();
      }, intervalMs);
    });

    // Initial update
    this.updatePlayerStats();
  }

  /**
   * Stop polling for updates
   */
  stopPolling(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Angular lifecycle hook - cleanup on destroy
   */
  ngOnDestroy(): void {
    this.stopPolling();
  }

  /**
   * Get current player stats synchronously
   */
  getPlayerStats(): PlayerUIData | null {
    const playerEntities = this.entityManager.getEntitiesWithComponents(
      PlayerControlledComponent,
      HealthComponent,
      PositionComponent
    );

    if (playerEntities.length === 0) {
      return null;
    }

    const playerId = playerEntities[0];
    const playerComp = this.entityManager.getComponent(playerId, PlayerControlledComponent);
    const healthComp = this.entityManager.getComponent(playerId, HealthComponent);
    const positionComp = this.entityManager.getComponent(playerId, PositionComponent);
    const weaponComp = this.entityManager.getComponent(playerId, WeaponComponent);
    const buffComp = this.entityManager.getComponent(playerId, BuffComponent);
    const chargingComp = this.entityManager.getComponent(playerId, ChargingComponent);

    if (!playerComp || !healthComp || !positionComp) {
      return null;
    }

    return {
      // Core stats
      health: healthComp.health,
      maxHealth: healthComp.maxHealth,
      healthPercentage: (healthComp.health / healthComp.maxHealth) * 100,

      // Experience and level (from ProgressionSystemService)
      level: this.progressionSystem.level,
      experience: this.progressionSystem.xp,
      experienceToNext: this.calculateExpToNext(this.progressionSystem.level),
      experiencePercentage: this.calculateExpPercentage(this.progressionSystem.xp, this.progressionSystem.level),

      // Combat stats (from GameStateService)
      kills: this.gameStateService.getKills(),
      killStreak: this.gameStateService.getKillStreak(),
      score: this.progressionSystem.xp + this.gameStateService.getKills() * 10, // Calculate score
      shards: this.gameStateService.getShards(),

      // Weapon info
      weaponType: 'beam', // Fixed weapon type for now
      weaponDamage: weaponComp?.damage || 10,

      // Buffs
      activeBuffs: buffComp?.getActiveBuffs() || [],

      // Position (for minimap)
      x: positionComp.x,
      y: positionComp.y,

      // Class info
      currentClass: playerComp.className || 'Pilot',
      ascensionLevel: playerComp.ascensionLevel || 0,

      // Dual bucket charging system (ECS-managed via DualChargingComponent)
      movementCharge: Math.round(this.playerService.getMovementCharge()),
      focusCharge: Math.round(this.playerService.getFocusCharge()),
      activeChargeType: this.playerService.getActiveChargeType(),
      displayCharge: Math.round(this.playerService.getDisplayCharge()),
      isCharging: this.playerService.getMovementCharge() > 0 || this.playerService.getFocusCharge() > 0,
      canFireMovement: this.playerService.getMovementCharge() >= 100 || this.playerService.getFocusCharge() >= 100,
      weaponCooldownPercent: 0, // Cooldown now managed by WeaponComponent (ECS)
      fireCooldownPercent: Math.round(this.playerService.getFireReadyPercent()),

      // Discharge ability (right-click) — use-once, 8s recharge
      dischargeCooldownPercent: this.playerService.isDischargeAvailable()
        ? 100
        : Math.max(
            0,
            Math.min(
              100,
              Math.round(
                (1 - this.playerService.getDischargeRemaining() / this.playerService.getDischargeCooldown()) * 100
              )
            )
          ),
      isChargingDischarge: this.playerService.isChargingDischarge(),
      dischargeChargeLevel: Math.round(this.playerService.getDischargeChargeLevel() * 100),

      // Legacy charging system (deprecated but kept for compatibility)
      chargeLevel: chargingComp?.getCurrentChargeLevel() || 0,
      chargePercentage: Math.round((chargingComp?.getCurrentChargeLevel() || 0) * 100),
      isMaintaining: false, // Deprecated

      // Blade speed boost system (visual feedback for focus charge)
      bladeSpeedBoost: Math.round(this.playerService.getBladeSpeedBoost()),
      isBladeSpeedBoosting: this.playerService.getBladeSpeedBoost() > 0,
    };
  }

  /**
   * Update player stats and emit to subscribers
   */
  private updatePlayerStats(): void {
    const stats = this.getPlayerStats();
    this.playerStatsSubject.next(stats);
  }

  /**
   * Calculate experience needed for next level
   */
  private calculateExpToNext(level: number): number {
    // Use progression config for XP curve
    return Math.floor(PROGRESSION_CONFIG.XP_BASE * Math.pow(PROGRESSION_CONFIG.XP_MULTIPLIER, level - 1));
  }

  /**
   * Calculate experience percentage to next level
   */
  private calculateExpPercentage(currentExp: number, level: number): number {
    const expForCurrentLevel = level > 1 ? this.calculateExpToNext(level - 1) : 0;
    const expForNextLevel = this.calculateExpToNext(level);
    const expIntoLevel = currentExp - expForCurrentLevel;
    const expNeeded = expForNextLevel - expForCurrentLevel;

    return Math.min(100, Math.max(0, (expIntoLevel / expNeeded) * 100));
  }

  /**
   * Get enemy statistics for UI
   */
  getEnemyStats(): EnemyUIData {
    const enemies = this.entityManager.getEntitiesWithComponents(HealthComponent);
    const aliveEnemies = enemies.filter((id) => {
      const health = this.entityManager.getComponent(id, HealthComponent);
      return health && health.health > 0 && !this.entityManager.hasComponent(id, PlayerControlledComponent);
    });

    // Count elite enemies
    const eliteCount = aliveEnemies.filter((id) => {
      const enemyType = this.entityManager.getComponent(id, EnemyTypeComponent);
      return enemyType && enemyType.isElite;
    }).length;

    // Count nearby enemies (within 500 units of player)
    let nearbyCount = 0;
    const playerEntities = this.entityManager.getEntitiesWithComponents(PlayerControlledComponent, PositionComponent);
    if (playerEntities.length > 0) {
      const playerPos = this.entityManager.getComponent(playerEntities[0], PositionComponent);
      if (playerPos) {
        nearbyCount = aliveEnemies.filter((id) => {
          const enemyPos = this.entityManager.getComponent(id, PositionComponent);
          if (!enemyPos) return false;

          const dx = enemyPos.x - playerPos.x;
          const dy = enemyPos.y - playerPos.y;
          const distanceSquared = dx * dx + dy * dy;
          return distanceSquared <= 500 * 500; // 500 units radius
        }).length;
      }
    }

    return {
      totalEnemies: aliveEnemies.length,
      eliteCount: eliteCount,
      nearbyCount: nearbyCount,
    };
  }
}

/**
 * Player data formatted for UI consumption
 */
export interface PlayerUIData {
  // Health
  health: number;
  maxHealth: number;
  healthPercentage: number;

  // Experience
  level: number;
  experience: number;
  experienceToNext: number;
  experiencePercentage: number;

  // Combat
  kills: number;
  killStreak: number;
  score: number;
  shards: number;

  // Equipment
  weaponType: string;
  weaponDamage: number;

  // Buffs
  activeBuffs: string[];

  // Position
  x: number;
  y: number;

  // Progression
  currentClass: string;
  ascensionLevel: number;

  // Dual bucket charging system
  movementCharge: number; // 0-100%
  focusCharge: number; // 0-100%
  activeChargeType: 'focus' | 'movement'; // Which charge is active for UI
  displayCharge: number; // 0-100% (the charge to show in UI)
  isCharging: boolean; // Is currently building any charge
  canFireMovement: boolean; // Can fire with movement charge
  weaponCooldownPercent: number; // 0-100% weapon cooldown
  fireCooldownPercent: number; // 0 = just fired (on cooldown), 100 = ready to fire

  // Discharge ability (right-click) — use-once, 8s recharge
  dischargeCooldownPercent: number; // 0 = just used, 100 = ready to use
  isChargingDischarge: boolean; // true while holding right-click to charge
  dischargeChargeLevel: number; // 0-100 charge level while holding right-click

  // Legacy charging system (deprecated)
  chargeLevel: number;
  chargePercentage: number;
  isMaintaining: boolean;

  // Blade speed boost system
  bladeSpeedBoost: number; // 0-100%
  isBladeSpeedBoosting: boolean; // True when stationary and building boost
}

/**
 * Enemy statistics for UI
 */
export interface EnemyUIData {
  totalEnemies: number;
  eliteCount: number;
  nearbyCount: number;
}
