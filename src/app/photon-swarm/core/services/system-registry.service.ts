import { inject, Injectable } from '@angular/core';

import { GameEngineService } from '../engine/game-engine.service';
import { PlayerService } from '../player/player.service';

// ECS Systems - Territory
import {
  BorderConflictSystemService,
  FourKingsTerritoryService,
  TerritoryExpansionSystemService,
  TerritoryStrengthSystemService,
  TerritoryVisualFeedbackService,
} from '../systems/territory';

// ECS Systems - World
import { GuardianSpawnerSystemService, TreasureCacheSystemService, ZoneGateSystemService } from '../systems/world';

// ECS Systems - Combat
import {
  AimingSystemService,
  BeamCollisionSystemService,
  BurnSystemService,
  ChargedProjectileSystemService,
  CollisionSystemService,
  CombatSystemService,
  DeathAnimationSystemService,
  DeathDetectionSystemService,
  EmpPulseSystemService,
  HealthSyncSystemService,
  ProjectileSystemService,
  ShieldFacingSystemService,
  WeaponFiringSystemService,
} from '../systems/combat';

// ECS Systems - Enemy AI
import {
  AIBehaviorSystemService,
  ArenaHazardSystemService,
  EnemyHealthRegenSystemService,
  EnemyMovementSystemService,
  FactionAISystemService,
  HealAuraSystemService,
  IdleBehaviorSystemService,
  NpcAbilitySystemService,
  NPCFactionBattleSystemService,
  SpawnSystemService,
  TeleportSystemService,
} from '../systems/enemy-ai';

// ECS Systems - Gameplay
import {
  AdaptiveDifficultySystemService,
  BuffManagementSystemService,
  DischargeSystemService,
  DualChargingSystemService,
  EnvironmentSystemService,
  FactionStandingSystemService,
  FallingAsteroidSystemService,
  PlayerCreationSystemService,
  ShardMagnetismSystemService,
} from '../systems/gameplay';

// ECS Systems - Rendering
import {
  EffectsRenderingSystemService,
  FloatingTextSystemService,
  RenderingSystemService,
  StarfieldSystemService,
} from '../systems/rendering';

/**
 * SystemRegistryService — Owns all ECS system instances and handles their
 * registration with the game engine.
 *
 * Extracted from PhotonSwarmComponent to decouple game-logic wiring from the
 * view layer. The component now injects this single service instead of 42+
 * individual ECS system services.
 */
@Injectable({ providedIn: 'root' })
export class SystemRegistryService {
  // ── Exposed systems (component needs direct access) ────────

  /** Used by component onMouseDown → setTargetPosition() */
  get aimingSystem(): AimingSystemService {
    return this._aimingSystem;
  }

  /** Used by component resizeCanvas → setCanvasDimensions() */
  get fourKingsTerritorySystem(): FourKingsTerritoryService {
    return this._fourKingsTerritorySystem;
  }

  constructor(
    // ── Player & Charging ────────────────────────────────────
    private _playerCreationSystem: PlayerCreationSystemService,
    private _dualChargingSystem: DualChargingSystemService,
    private _aimingSystem: AimingSystemService,

    // ── Combat & Projectiles ─────────────────────────────────
    private _weaponFiringSystem: WeaponFiringSystemService,
    private _dischargeSystem: DischargeSystemService,
    private _projectileSystem: ProjectileSystemService,
    private _chargedProjectileSystem: ChargedProjectileSystemService,
    private _beamCollisionSystem: BeamCollisionSystemService,
    private _collisionSystem: CollisionSystemService,
    private _shardMagnetismSystem: ShardMagnetismSystemService,
    private _buffManagementSystem: BuffManagementSystemService,
    private _npcAbilitySystem: NpcAbilitySystemService,
    private _fallingAsteroidSystem: FallingAsteroidSystemService,
    private _combatSystem: CombatSystemService,
    private _burnSystem: BurnSystemService,
    private _empPulseSystem: EmpPulseSystemService,
    private _arenaHazardSystem: ArenaHazardSystemService,
    private _shieldFacingSystem: ShieldFacingSystemService,

    // ── Death & Health ───────────────────────────────────────
    private _deathDetectionSystem: DeathDetectionSystemService,
    private _deathAnimationSystem: DeathAnimationSystemService,
    private _floatingTextSystem: FloatingTextSystemService,
    private _healthSyncSystem: HealthSyncSystemService,
    private _enemyHealthRegenSystem: EnemyHealthRegenSystemService,
    private _healAuraSystem: HealAuraSystemService,
    private _teleportSystem: TeleportSystemService,

    // ── Territory & Faction ──────────────────────────────────
    private _fourKingsTerritorySystem: FourKingsTerritoryService,
    private _territoryStrengthRuntime: TerritoryStrengthSystemService,
    private _territoryExpansionRuntime: TerritoryExpansionSystemService,
    private _borderConflictRuntime: BorderConflictSystemService,
    private _factionAISystem: FactionAISystemService,
    private _npcFactionBattleSystem: NPCFactionBattleSystemService,
    private _factionStandingSystem: FactionStandingSystemService,

    // ── AI & Movement ────────────────────────────────────────
    private _aiBehaviorSystem: AIBehaviorSystemService,
    private _idleBehaviorSystem: IdleBehaviorSystemService,
    private _enemyMovementSystem: EnemyMovementSystemService,

    // ── World & Environment ──────────────────────────────────
    private _environmentSystem: EnvironmentSystemService,
    private _spawnSystem: SpawnSystemService,
    private _zoneGateSystem: ZoneGateSystemService,
    private _guardianSpawnerSystem: GuardianSpawnerSystemService,
    private _treasureCacheSystem: TreasureCacheSystemService,

    // ── Rendering ────────────────────────────────────────────
    private _starfieldSystem: StarfieldSystemService,
    private _effectsRenderingSystem: EffectsRenderingSystemService,
    private _renderingSystem: RenderingSystemService,

    // ── Difficulty ───────────────────────────────────────────
    private _adaptiveDifficulty: AdaptiveDifficultySystemService
  ) {
    // Force DI instantiation of visual feedback, which self-wires to the reusable
    // territory-strength event stream. Timer-owning services are retained above
    // so their session lifecycle can be controlled explicitly.
    inject(TerritoryVisualFeedbackService);
  }

  /**
   * Register all ECS systems with the game engine in execution order.
   *
   * Also wires circular-dependency setters:
   * - `player.setFactionStandingSystem()`
   * - `engine.setFactionStandingSystem()`
   *
   * Also exposes `adaptiveDifficultyService` on `window` for debugging.
   */
  registerSystems(engine: GameEngineService, player: PlayerService): void {
    // Wire circular dependencies via setters (must happen before system execution)
    player.setFactionStandingSystem(this._factionStandingSystem);
    engine.setFactionStandingSystem(this._factionStandingSystem);

    // Protect world spawning as well as the engine update list if registration is
    // requested twice during one component mount. A deactivated engine has an empty
    // registry, so route re-entry still performs the full setup below.
    if (engine.hasSystemInstance(this._playerCreationSystem)) return;

    this._territoryStrengthRuntime.activateSession();
    this._territoryExpansionRuntime.activateSession();
    this._borderConflictRuntime.activateSession();

    // Expose adaptive difficulty globally for debugging
    window.adaptiveDifficultyService = this._adaptiveDifficulty;

    // Register systems in execution order — order is CRITICAL for correct game behavior
    engine.registerSystemInstances(
      this._playerCreationSystem, // CRITICAL: Create player entity first
      this._dualChargingSystem, // Dual charging system for movement/focus charges
      this._aimingSystem, // Aiming projection and trajectory visualization

      // Core Combat Systems
      this._weaponFiringSystem, // Weapon cooldowns and projectile spawning
      this._dischargeSystem, // Discharge ability damage and effects
      this._projectileSystem, // Projectile movement and lifecycle
      this._chargedProjectileSystem, // Charged projectile visual effects
      this._beamCollisionSystem, // Player beam collision with enemies
      this._collisionSystem, // Collision detection with spatial partitioning
      this._shardMagnetismSystem, // Shard magnetism pulls shards to player
      this._buffManagementSystem, // Buff and debuff management for all entities
      this._npcAbilitySystem, // NPC special abilities and AI-driven skill usage
      this._fallingAsteroidSystem, // Falling asteroids that can be destroyed for buffs
      this._combatSystem, // Damage resolution and combat mechanics
      this._burnSystem, // Process burn damage over time
      this._empPulseSystem, // Disruptor EMP pulse — slow player, drain beam charge
      this._arenaHazardSystem, // Boss shockwave telegraph — damage inside zone at detonation
      this._shieldFacingSystem, // Sentinel shield facing — rotate arc toward player
      this._deathDetectionSystem, // Monitor health for death triggers
      this._deathAnimationSystem, // Process death animations and entity cleanup
      this._floatingTextSystem, // Floating damage numbers and text effects
      this._healthSyncSystem, // Ensure ECS and GameState health are synced
      this._enemyHealthRegenSystem, // Track enemy healing and show green numbers
      this._healAuraSystem, // Sentinel passive heal aura — pulses every 1.5s for nearby allies
      this._teleportSystem, // NPC teleport blink — resolves in-flight blink after 250ms

      // World Systems (run after combat foundation)
      this._fourKingsTerritorySystem, // Four Kings dynamic territory background
      this._factionAISystem, // Faction-based enemy behaviors
      this._npcFactionBattleSystem, // NPC-to-NPC combat based on factions
      this._aiBehaviorSystem, // AI decision making and target selection
      this._idleBehaviorSystem, // Idle behaviors: dancing, wandering, patrolling, socializing
      this._enemyMovementSystem, // Enemy movement and AI behavior patterns
      this._environmentSystem, // Environmental hazards, boundaries, world effects
      this._spawnSystem, // Enemy spawning based on world state
      this._zoneGateSystem, // Zone gate proximity checks and unlock evaluation
      this._treasureCacheSystem, // Cache proximity checks, loot distribution, zone completion
      this._guardianSpawnerSystem, // Guardian lifecycle: spawn, death detection, respawn

      // Rendering Systems (always last)
      this._starfieldSystem, // Starfield background rendering
      this._effectsRenderingSystem, // Render particle effects
      this._renderingSystem // Render all entities and effects to canvas
    );

    // Spawn world entities after all systems are registered and initialized
    const entityManager = engine.getEntityManager();

    // Spawn treasure caches from config
    this._treasureCacheSystem.spawnAllCaches(entityManager);

    // Spawn territorial guardians at their home positions
    this._guardianSpawnerSystem.spawnAllGuardians();

    this._zoneGateSystem.spawnAllGates();
  }

  /**
   * Configure world bounds on systems that need spatial awareness.
   * Called once after engine initialization when world dimensions are known.
   */
  configureWorldBounds(engine: GameEngineService): void {
    const worldWidth = engine.getWorldWidth();
    const worldHeight = engine.getWorldHeight();

    // Combat systems
    this._projectileSystem.setWorldBounds(0, worldWidth, 0, worldHeight);
    this._collisionSystem.setWorldBounds(worldWidth, worldHeight);

    // World systems
    this._environmentSystem.setWorldBounds(worldWidth, worldHeight);
    this._spawnSystem.setWorldBounds(worldWidth, worldHeight);
  }

  /** Stop auxiliary territory timers/subscriptions owned outside the ECS list. */
  deactivateSession(): void {
    this._borderConflictRuntime.deactivateSession();
    this._territoryExpansionRuntime.deactivateSession();
    this._territoryStrengthRuntime.deactivateSession();
  }

  /** Restart auxiliary territory state after Four Kings has generated a run world. */
  resetRunState(): void {
    this.deactivateSession();
    this._territoryStrengthRuntime.activateSession();
    this._territoryExpansionRuntime.activateSession();
    this._borderConflictRuntime.activateSession();
  }
}
