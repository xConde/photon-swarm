import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { RandomService } from '../../utils/random.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { EnemyManagerService } from './enemy-manager.service';
import { PlayerService } from '../../player/player.service';
import { CurseService } from '../../../services/curse.service';
import { FactionSpawnWeightsService } from './faction-spawn-weights.service';
import { BorderConflictSystemService, FourKingsTerritoryService, TerritoryMomentumSystemService } from '../territory';
import { AdaptiveDifficultySystemService } from '../gameplay/adaptive-difficulty-system.service';
import { ZoneStateService } from '../world';
import {
  ENCOUNTER_DIRECTOR_CONFIG,
  ENEMY_UNLOCK_WAVES,
  FACTION_COLORS,
  FACTION_CONFIG,
  SPAWN_CONFIG,
  WORLD_CONFIG,
  ZONE_COMPOSITION_PROFILES,
} from '@photon/config/game-constants';
import { DifficultyService } from '../../../services/difficulty.service';
import { RunPressureService } from '../../../services/run-pressure.service';
import {
  AIControlledComponent,
  BehaviorPattern,
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  SpawnerComponent,
  WeaponComponent,
} from '@photon/components';
import { EnemyType } from '../../models/enemy.model';
import { EncounterPlan, WaveType } from '../../models/encounter.model';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { MinimapRendererService } from '../../../features/map/minimap-renderer.service';
import { EncounterPlannerService } from './encounter-planner.service';
import { EncounterObjectiveService } from './encounter-objective.service';
import { SpawnPositionService } from './spawn-position.service';

type Rarity = 'common' | 'rare' | 'legendary';

interface SpawnConfig {
  baseSpawnRate: number;
  spawnRateIncrease: number;
  maxSpawnRate: number;
  eliteChance: number;
  rarityWeights: {
    common: number;
    rare: number;
    legendary: number;
  };
  enemyWeights: {
    [key in EnemyType]: number;
  };
}

/**
 * ECS System responsible for spawning enemies in the game world
 */
/**
 * Active wave state
 * TUNED: Added waveId for tracking overlapping waves
 */
interface ActiveWave {
  waveId: number;
  type: WaveType;
  plan?: EncounterPlan;
  totalEnemies: number;
  spawnedEnemies: number;
  spawnInterval: number;
  lastSpawnTime: number;
  startTime: number;
  anchorAngle: number;
  spawningComplete: boolean;
  /** For faction_invasion waves: the invaded faction ID (1-4) */
  invasionFactionId?: number;
}

@Injectable({ providedIn: 'root' })
export class SpawnSystemService implements System {
  private spawnTimer = 0;
  private currentSpawnRate = 0;
  private worldBounds = { width: WORLD_CONFIG.BOUNDS.WIDTH, height: WORLD_CONFIG.BOUNDS.HEIGHT };

  // Wave system state - supports overlapping waves
  private waveTimer = 0;
  private currentWaveNumber = 0;
  private activeWaves: ActiveWave[] = []; // Changed from single wave to array
  private lastWaveStartTime = 0; // Track when last wave started for overlap timing
  /** Reused buffer for completed-wave IDs — cleared at the top of each updateWaveSystem call */
  private readonly completedWaveIdsBuffer: number[] = [];

  // Observable for other systems to react to spawns
  public readonly enemySpawned$ = new Subject<{
    entity: number;
    type: EnemyType;
    position: { x: number; y: number };
  }>();

  // Observable for wave events (for UI notifications)
  public readonly waveStarted$ = new Subject<{
    waveNumber: number;
    waveType: WaveType;
    enemyCount: number;
    factionName?: string; // For faction_invasion waves
    encounterTitle: string;
    objective: string;
  }>();

  // Observables for special wave event lifecycle
  public readonly waveEventStarted$ = new Subject<{ event: WaveType; duration: number }>();
  public readonly waveEventEnded$ = new Subject<{ event: WaveType; success: boolean }>();

  // Active event state
  private activeEvent: WaveType | null = null;

  // Observable for incoming wave warnings (emits ~3s before wave starts)
  public readonly waveWarning$ = new Subject<{ waveNumber: number }>();
  private waveWarningEmitted = false;

  // Observable for enemy type unlock announcements
  public readonly newThreatUnlocked$ = new Subject<{ type: string; waveNumber: number }>();

  // One-time sector alert messages (e.g. wave 8 gate activation notice)
  public readonly sectorAlert$ = new Subject<{ message: string }>();

  // Track which enemy types have been unlocked to fire announce only once
  private unlockedTypes = new Set<string>(['basic', 'spitter']); // Always unlocked

  /** Public getter for current wave number (for external systems and tests) */
  public get waveNumber(): number {
    return this.currentWaveNumber;
  }

  private readonly config: SpawnConfig = {
    baseSpawnRate: SPAWN_CONFIG.TIMING.BASE_SPAWN_RATE_MS,
    spawnRateIncrease: SPAWN_CONFIG.TIMING.RATE_INCREASE_PER_LEVEL_MS,
    maxSpawnRate: SPAWN_CONFIG.TIMING.MIN_SPAWN_RATE_MS,
    eliteChance: SPAWN_CONFIG.RARITY.ELITE_CHANCE,
    rarityWeights: {
      common: SPAWN_CONFIG.RARITY.WEIGHTS.COMMON,
      rare: SPAWN_CONFIG.RARITY.WEIGHTS.RARE,
      legendary: SPAWN_CONFIG.RARITY.WEIGHTS.LEGENDARY,
    },
    enemyWeights: {
      basic: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.basic,
      spitter: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.spitter,
      tank: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.tank,
      swarm: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.swarm,
      thug: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.thug,
      sniper: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sniper,
      boss: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.boss,
      disruptor: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.disruptor,
      sentinel: SPAWN_CONFIG.ENEMY_TYPE_WEIGHTS.sentinel,
    },
  };

  constructor(
    private entityFactory: EntityFactoryECSService,
    private random: RandomService,
    private progression: ProgressionSystemService,
    private enemyManager: EnemyManagerService,
    private playerService: PlayerService,
    private curseService: CurseService,
    private zoneState: ZoneStateService,
    private encounterPlanner: EncounterPlannerService,
    public readonly encounterObjectives: EncounterObjectiveService,
    private spawnPositions: SpawnPositionService,
    private factionSpawnWeights?: FactionSpawnWeightsService, // Optional for backward compatibility
    private fourKingsTerritory?: FourKingsTerritoryService, // Optional to get faction from territory
    private borderConflictSystem?: BorderConflictSystemService, // Optional for conflict zone spawning
    private territoryMomentum?: TerritoryMomentumSystemService, // Optional for momentum-based modifiers
    private adaptiveDifficulty?: AdaptiveDifficultySystemService, // Optional for adaptive difficulty
    private effectFactory?: EffectFactoryService, // Optional for spawn visual effects
    private difficultyService?: DifficultyService, // Difficulty mode modifiers
    private postProcessing?: PostProcessingService, // Optional for wave event visual effects
    private minimapRenderer?: MinimapRendererService, // Optional for blackout minimap dimming
    private runPressure?: RunPressureService
  ) {}

  init(entityManager?: EntityManager): void {
    // Reset spawn timer and update rate based on current level
    this.spawnTimer = 0;
    this.waveTimer = SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS - ENCOUNTER_DIRECTOR_CONFIG.OPENING.FIRST_WAVE_DELAY_MS;
    this.updateSpawnRate();

    // Schedule initial enemy spawn shortly after game starts
    // This gives time for player and systems to initialize properly
    if (entityManager) {
      this.scheduleInitialSpawn(entityManager);
    }
  }

  /** Re-arm the opening contact after GameEngine clears the ECS world for a new run. */
  initializeRun(entityManager: EntityManager): void {
    this.scheduleInitialSpawn(entityManager);
  }

  /**
   * Schedule initial enemies to spawn after a brief delay
   * This ensures player position and territory system are initialized
   */
  private scheduleInitialSpawn(entityManager: EntityManager): void {
    // Set a flag to spawn initial enemies on first update
    // This is safer than spawning immediately in init
    this.shouldSpawnInitial = true;
    this.initialSpawnEntityManager = entityManager;
  }

  private shouldSpawnInitial = false;
  private initialSpawnEntityManager?: EntityManager;

  /**
   * Spawn a few initial enemies when the game starts
   * This prevents the empty world feeling at the beginning
   */
  private spawnInitialEnemies(): void {
    if (!this.initialSpawnEntityManager) return;

    const initialEnemyCount = ENCOUNTER_DIRECTOR_CONFIG.OPENING.INITIAL_ENEMIES.length;
    const playerPos = this.playerService.getPosition();

    // Safety check - don't spawn if player position isn't ready
    if (!playerPos || (playerPos.x === 0 && playerPos.y === 0)) {
      return;
    }

    for (let i = 0; i < initialEnemyCount; i++) {
      // Spawn enemies at different angles around the player
      const angle = (i / initialEnemyCount) * Math.PI * 2;
      const distance = ENCOUNTER_DIRECTOR_CONFIG.OPENING.INITIAL_DISTANCES[i];

      const spawnX = playerPos.x + Math.cos(angle) * distance;
      const spawnY = playerPos.y + Math.sin(angle) * distance;

      // Clamp to world bounds with margin
      const x = Math.max(200, Math.min(this.worldBounds.width - 200, spawnX));
      const y = Math.max(200, Math.min(this.worldBounds.height - 200, spawnY));

      // Get faction from territory if available
      let factionId = 1; // Default faction
      if (this.fourKingsTerritory) {
        const territory = this.fourKingsTerritory.getTerritoryAtPosition(x, y);
        if (territory && territory.kingId) {
          factionId = territory.kingId;
        }
      }

      // Vary enemy types for initial spawn
      const types = ENCOUNTER_DIRECTOR_CONFIG.OPENING.INITIAL_ENEMIES;
      const entity = this.entityFactory.createEnemy(x, y, types[i], 'common', false, factionId);
      this.softenOpeningEnemy(this.initialSpawnEntityManager, entity);

      // Emit spawn event
      this.enemySpawned$.next({
        entity,
        type: types[i],
        position: { x, y },
      });

      // Opening roster contains readable single-hull threats, so each gets a portal cue.
      if (this.effectFactory) {
        const dxE = x - playerPos.x;
        const dyE = y - playerPos.y;
        if (dxE * dxE + dyE * dyE < 1200 * 1200) {
          this.effectFactory.createEnemySpawn({ x, y }, types[i], factionId);
        }
      }
    }

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🎮 Initial enemies spawned', 'info', {
        source: 'spawn_system',
        count: initialEnemyCount,
        playerPos: { x: playerPos.x.toFixed(0), y: playerPos.y.toFixed(0) },
        worldBounds: this.worldBounds,
      });
    }

    // Clear the flag and reference
    this.shouldSpawnInitial = false;
    this.initialSpawnEntityManager = undefined;
  }

  update(deltaTime: number, entityManager: EntityManager): void {
    // Spawn initial enemies on first update if scheduled
    if (this.shouldSpawnInitial) {
      this.spawnInitialEnemies();
    }

    // Update adaptive difficulty if available
    if (this.adaptiveDifficulty) {
      this.adaptiveDifficulty.update(deltaTime);
    }

    // Apply curse difficulty multiplier to deltaTime to speed up spawning
    const curseDifficulty = this.curseService.getDifficultyMultiplier();

    // Apply adaptive difficulty multiplier if available
    const adaptiveMultiplier = this.adaptiveDifficulty?.getSpawnRateMultiplier() ?? 1.0;

    // Combine multipliers
    const runSpawnTempo = this.runPressure?.getModifiers().spawnTempo ?? 1;
    const modifiedDeltaTime = deltaTime * curseDifficulty * adaptiveMultiplier * runSpawnTempo;

    // Check if we can spawn based on performance limits
    const canSpawn = this.enemyManager.canSpawnEnemy();

    // Wave system update (if enabled)
    if (SPAWN_CONFIG.WAVES.ENABLED) {
      this.updateWaveSystem(modifiedDeltaTime, entityManager);
    }

    // Update main spawn timer with modified delta (continuous spawning between waves)
    this.spawnTimer += modifiedDeltaTime;

    // Send spawn timer to debug bridge (throttled to once per second)
    if (
      window.debugLogBridge &&
      Math.floor(this.spawnTimer / 1000) !== Math.floor((this.spawnTimer - deltaTime) / 1000)
    ) {
      window.debugLogBridge.log('⏰ Spawn Timer', 'info', {
        timer: this.spawnTimer.toFixed(0),
        rate: this.currentSpawnRate,
        progress: `${((this.spawnTimer / this.currentSpawnRate) * 100).toFixed(0)}%`,
        nextSpawnIn: (this.currentSpawnRate - this.spawnTimer).toFixed(0),
        canSpawn,
        currentEnemies: this.enemyManager.getEnemyCount(),
        curseDifficulty: curseDifficulty.toFixed(2),
        waveNumber: this.currentWaveNumber,
        activeWaves: this.activeWaves.length,
        activeWaveTypes: this.activeWaves.map((w) => w.type).join(', ') || 'none',
      });
    }

    const reinforcementRate = Math.max(this.currentSpawnRate, ENCOUNTER_DIRECTOR_CONFIG.OPENING.REINFORCEMENT_RATE_MS);
    const spawnVariance = reinforcementRate * ENCOUNTER_DIRECTOR_CONFIG.OPENING.REINFORCEMENT_RATE_VARIANCE;
    const adjustedSpawnRate = reinforcementRate + (this.random.random() - 0.5) * 2 * spawnVariance;

    // Ambient reinforcements only prevent a cleared arena from feeling empty.
    // Authored encounters own the pressure curve once the first wave begins.
    if (
      this.currentWaveNumber >= ENCOUNTER_DIRECTOR_CONFIG.OPENING.REINFORCEMENT_MIN_WAVE &&
      this.spawnTimer >= adjustedSpawnRate &&
      this.activeWaves.length === 0 &&
      this.enemyManager.getEnemyCount() < ENCOUNTER_DIRECTOR_CONFIG.OPENING.REINFORCEMENT_ENEMY_FLOOR
    ) {
      if (canSpawn) {
        this.spawnTimer = 0;
        this.spawnEnemy(entityManager);
      } else {
        this.spawnTimer = adjustedSpawnRate;
      }
    }

    // Update spawner components (for enemies that spawn other enemies)
    this.updateSpawners(deltaTime, entityManager);
  }

  /**
   * Update wave system - handles wave timing and spawning
   * TUNED: Supports overlapping waves for VS-like pressure moments
   */
  private updateWaveSystem(deltaTime: number, entityManager: EntityManager): void {
    const currentTime = window.performance.now();
    let openingEncounterResolved = false;

    // Process all active waves (supports overlapping)
    this.completedWaveIdsBuffer.length = 0;

    for (const wave of this.activeWaves) {
      // Check if it's time to spawn the next enemy in this wave
      if (currentTime - wave.lastSpawnTime >= wave.spawnInterval && wave.spawnedEnemies < wave.totalEnemies) {
        // Re-check spawn capacity per wave to prevent exceeding MAX_ENEMIES with concurrent waves
        if (this.enemyManager.canSpawnEnemy()) {
          this.spawnWaveEnemy(entityManager, wave);
          wave.spawnedEnemies++;
          wave.lastSpawnTime = currentTime;
          if (wave.spawnedEnemies >= wave.totalEnemies && !wave.spawningComplete) {
            wave.spawningComplete = true;
            this.encounterObjectives.markSpawningComplete(wave.waveId, currentTime);
          }
        }
      }

      if (!wave.plan && wave.spawnedEnemies >= wave.totalEnemies) {
        this.completedWaveIdsBuffer.push(wave.waveId);
      }
    }

    const resolutions = this.encounterObjectives.update(currentTime, entityManager);
    for (const resolution of resolutions) {
      this.completedWaveIdsBuffer.push(resolution.waveNumber);
      openingEncounterResolved ||= resolution.waveNumber < ENCOUNTER_DIRECTOR_CONFIG.OPENING.OVERLAP_MIN_WAVE;
      this.endEncounterEffects(resolution.type);
      if (this.isSpecialEvent(resolution.type)) {
        this.waveEventEnded$.next({ event: resolution.type, success: resolution.success });
      }
      if (window.debugLogBridge) {
        window.debugLogBridge.log('🏁 Encounter resolved', resolution.success ? 'success' : 'warning', {
          source: 'spawn_system',
          waveNumber: resolution.waveNumber,
          waveType: resolution.type,
          success: resolution.success,
        });
      }
    }

    if (this.completedWaveIdsBuffer.length > 0) {
      this.activeWaves = this.activeWaves.filter((w) => !this.completedWaveIdsBuffer.includes(w.waveId));
    }

    // Check if we can start a new wave
    this.waveTimer += deltaTime;
    if (openingEncounterResolved) {
      // The onboarding timer must measure recovery from the clear, not from the
      // prior wave's start. Otherwise a deliberate clear immediately chains
      // into the next directive after banking the entire interval in combat.
      this.waveTimer = Math.max(
        0,
        SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS - ENCOUNTER_DIRECTOR_CONFIG.OPENING.RECOVERY_AFTER_CLEAR_MS
      );
      this.waveWarningEmitted = false;
    }

    // Determine if we can start a new wave based on overlap settings
    const canStartNewWave = this.canStartNewWave(currentTime);

    // Emit wave warning before wave starts (configurable timing)
    const warningThreshold = SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS - SPAWN_CONFIG.WAVES.WAVE_WARNING_MS;
    if (this.waveTimer >= warningThreshold && !this.waveWarningEmitted && canStartNewWave) {
      this.waveWarningEmitted = true;
      this.waveWarning$.next({ waveNumber: this.currentWaveNumber + 1 });
    }

    if (this.waveTimer >= SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS && canStartNewWave) {
      this.waveTimer = 0;
      this.waveWarningEmitted = false;
      this.startNewWave(entityManager);
    }
  }

  /**
   * Check if a new wave can be started based on overlap settings
   */
  private canStartNewWave(currentTime: number): boolean {
    if (this.currentWaveNumber < ENCOUNTER_DIRECTOR_CONFIG.OPENING.OVERLAP_MIN_WAVE && this.activeWaves.length > 0) {
      return false;
    }

    // If overlap is disabled, only allow when no active waves
    if (!SPAWN_CONFIG.WAVES.ALLOW_OVERLAP) {
      return this.activeWaves.length === 0;
    }

    // Check max concurrent waves limit
    if (this.activeWaves.length >= SPAWN_CONFIG.WAVES.MAX_CONCURRENT_WAVES) {
      return false;
    }

    // Check minimum overlap interval (prevent wave spam)
    if (currentTime - this.lastWaveStartTime < SPAWN_CONFIG.WAVES.MIN_OVERLAP_INTERVAL_MS) {
      return false;
    }

    return true;
  }

  /**
   * Start a new wave of enemies
   * TUNED: Supports overlapping waves - adds to array instead of replacing
   */
  private startNewWave(_entityManager: EntityManager): void {
    this.currentWaveNumber++;
    const level = this.progression.level;
    const currentTime = window.performance.now();

    // Check for newly unlocked enemy types and emit announcements
    for (const [type, unlockWave] of Object.entries(ENEMY_UNLOCK_WAVES)) {
      if (unlockWave === this.currentWaveNumber && !this.unlockedTypes.has(type)) {
        this.unlockedTypes.add(type);
        this.newThreatUnlocked$.next({ type, waveNumber: this.currentWaveNumber });
        if (window.debugLogBridge) {
          window.debugLogBridge.log('🔓 New Enemy Type Unlocked', 'info', {
            source: 'spawn_system',
            type,
            waveNumber: this.currentWaveNumber,
          });
        }
      }
    }

    // B8: Wave 8 one-time sector alert — zone gates become reachable
    if (this.currentWaveNumber === 8) {
      this.sectorAlert$.next({ message: 'SECTOR ALERT: ZONE GATES ACTIVE' });
    }

    const currentZone = this.zoneState.getCurrentZone();
    const plan = this.encounterPlanner.createPlan({
      waveNumber: this.currentWaveNumber,
      playerLevel: level,
      zoneId: currentZone?.id ?? null,
    });
    const spawnInterval = plan.spawnDurationMs / plan.totalEnemies;

    const newWave: ActiveWave = {
      waveId: this.currentWaveNumber,
      type: plan.type,
      plan,
      totalEnemies: plan.totalEnemies,
      spawnedEnemies: 0,
      spawnInterval,
      lastSpawnTime: currentTime,
      startTime: currentTime,
      anchorAngle: this.random.random() * Math.PI * 2,
      spawningComplete: false,
      invasionFactionId: plan.invasionFactionId,
    };

    this.activeWaves.push(newWave);
    this.encounterObjectives.begin(plan, currentTime);
    this.lastWaveStartTime = currentTime;

    if (this.isSpecialEvent(plan.type)) {
      this.activeEvent = plan.type;
      this.waveEventStarted$.next({ event: plan.type, duration: plan.timeLimitMs });

      if (plan.type === 'boss_rush' && this.postProcessing) {
        this.postProcessing.addScreenFlash({ color: { r: 220, g: 20, b: 60 }, opacity: 0.5, duration: 800 });
        this.postProcessing.addChromaticAberration({ intensity: 0.4, duration: 3000, fadeOut: true });
      } else if (plan.type === 'faction_invasion' && this.postProcessing) {
        const fCol = FACTION_COLORS[plan.invasionFactionId as keyof typeof FACTION_COLORS];
        if (fCol) {
          const hex = fCol.primary;
          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          this.postProcessing.addScreenFlash({ color: { r, g, b }, opacity: 0.35, duration: 600 });
        }
      } else if (plan.type === 'blackout') {
        if (this.minimapRenderer) {
          this.minimapRenderer.blackoutActive = true;
        }
        if (this.postProcessing) {
          this.postProcessing.setVignetteState('blackout');
        }
      } else if (plan.type === 'guardian_surge' && this.postProcessing) {
        this.postProcessing.addScreenFlash({ color: { r: 255, g: 140, b: 0 }, opacity: 0.35, duration: 600 });
      } else if (plan.type === 'salvage_hunt' && this.postProcessing) {
        this.postProcessing.addScreenFlash({
          color: { r: 44, g: 224, b: 183 },
          opacity: ENCOUNTER_DIRECTOR_CONFIG.PRESENTATION.SALVAGE_FLASH_OPACITY,
          duration: ENCOUNTER_DIRECTOR_CONFIG.PRESENTATION.SALVAGE_FLASH_DURATION_MS,
        });
      }
    }

    this.waveStarted$.next({
      waveNumber: this.currentWaveNumber,
      waveType: plan.type,
      enemyCount: plan.totalEnemies,
      factionName: plan.factionName,
      encounterTitle: plan.title,
      objective: plan.brief,
    });

    if (window.debugLogBridge) {
      window.debugLogBridge.log('🌊 Wave Started', 'info', {
        source: 'spawn_system',
        waveNumber: this.currentWaveNumber,
        waveType: plan.type,
        encounter: plan.archetypeId,
        enemyCount: plan.totalEnemies,
        spawnInterval: spawnInterval.toFixed(0),
        level,
        activeWaves: this.activeWaves.length,
        overlapping: this.activeWaves.length > 1,
      });
    }
  }

  /**
   * Whether blackout event is currently active (used for spawn distance reduction)
   */
  private get isBlackoutActive(): boolean {
    return this.activeEvent === 'blackout' || this.activeWaves.some((wave) => wave.type === 'blackout');
  }

  private isSpecialEvent(type: WaveType): boolean {
    return (
      type === 'boss_rush' ||
      type === 'faction_invasion' ||
      type === 'blackout' ||
      type === 'guardian_surge' ||
      type === 'salvage_hunt'
    );
  }

  private endEncounterEffects(type: WaveType): void {
    if (type === 'blackout') {
      if (this.minimapRenderer) this.minimapRenderer.blackoutActive = false;
      if (this.postProcessing) this.postProcessing.setVignetteState('none');
    }
    if (this.activeEvent === type) this.activeEvent = null;
  }

  /**
   * Spawn a single enemy as part of a wave
   */
  private spawnWaveEnemy(_entityManager: EntityManager, wave: ActiveWave): void {
    const bossAlive = this.hasBossAlive(_entityManager);
    const plan = wave.plan ?? this.createFallbackPlan(wave);
    let type = this.encounterPlanner.chooseEnemy(plan, wave.spawnedEnemies);
    if (wave.type !== 'boss_rush' && type === EnemyType.Boss && bossAlive) {
      type = EnemyType.Tank;
    }
    let position = this.getEncounterSpawnPosition(wave, plan, type);

    // A2: If spawning a boss and the player is in Zone 4, clamp the spawn position
    // into Zone 4's bounds so the player doesn't have to leave to fight it.
    const isBossWave = wave.type === 'boss' || wave.type === 'boss_rush';
    if (isBossWave) {
      const currentZone = this.zoneState.getCurrentZone();
      if (currentZone && currentZone.id === 4) {
        const { bounds } = currentZone;
        const margin = 200;
        position = {
          x: Math.max(bounds.x + margin, Math.min(bounds.x + bounds.width - margin, position.x)),
          y: Math.max(bounds.y + margin, Math.min(bounds.y + bounds.height - margin, position.y)),
        };
      }
    }

    let isElite = type !== EnemyType.Boss && this.random.random() < plan.eliteChance;
    let isChampion = false;
    let rarity: Rarity = type === EnemyType.Boss ? 'legendary' : this.selectRarity();
    if (wave.type === 'guardian_surge') {
      isElite = false;
      rarity = 'rare';
    }
    if (wave.type === 'salvage_hunt' && wave.spawnedEnemies === 0) {
      isElite = false;
      isChampion = true;
      rarity = 'legendary';
    }

    // Champion check: config-driven chance to become champion (replaces an elite slot)
    // Champions don't spawn during boss/boss_rush/guardian_surge waves
    if (
      this.currentWaveNumber >= SPAWN_CONFIG.RARITY.CHAMPION_MIN_WAVE &&
      wave.type !== 'boss' &&
      wave.type !== 'boss_rush' &&
      wave.type !== 'guardian_surge' &&
      type !== EnemyType.Boss &&
      !isChampion &&
      this.random.random() < plan.championChance
    ) {
      isChampion = true;
      isElite = false;
      rarity = 'legendary';
    }

    // Get faction ID from territory (or use the invasion faction if applicable)
    let factionId = 0;
    if (wave.invasionFactionId !== undefined) {
      // Faction invasion: all enemies belong to the chosen faction
      factionId = wave.invasionFactionId;
    } else if (this.fourKingsTerritory && this.fourKingsTerritory.getIsInitialized()) {
      const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(position.x, position.y);
      if (
        territoryInfo &&
        territoryInfo.kingId >= FACTION_CONFIG.MIN_FACTION_ID &&
        territoryInfo.kingId <= FACTION_CONFIG.MAX_FACTION_ID
      ) {
        factionId = territoryInfo.kingId;
      }
    }

    const enemy = this.entityFactory.createEnemy(position.x, position.y, type, rarity, isElite, factionId, isChampion);
    if (wave.waveId <= ENCOUNTER_DIRECTOR_CONFIG.OPENING.FORCED_NORMAL_WAVES) {
      this.softenOpeningEnemy(_entityManager, enemy);
    }
    this.encounterObjectives.registerSpawn(wave.waveId, enemy);

    // Guardian surge: apply 1.5x health multiplier and territorial guardian behavior
    if (wave.type === 'guardian_surge') {
      const health = _entityManager.getComponent(enemy, HealthComponent);
      if (health) {
        health.maxHealth = Math.round(health.maxHealth * 1.5);
        health.health = health.maxHealth;
      }
      const ai = _entityManager.getComponent(enemy, AIControlledComponent);
      if (ai) {
        ai.behaviorPattern = BehaviorPattern.TerritorialGuardian;
        ai.originalBehaviorPattern = BehaviorPattern.TerritorialGuardian;
      }
    }

    // Emit spawn event
    this.enemySpawned$.next({
      entity: enemy,
      type,
      position,
    });

    // Show portal spawn effect for non-swarm enemies within visible range
    if (type !== EnemyType.Swarm && this.effectFactory) {
      const playerPosW = this.spawnPositions.getPlayerPosition();
      const dxW = position.x - playerPosW.x;
      const dyW = position.y - playerPosW.y;
      if (dxW * dxW + dyW * dyW < 1200 * 1200) {
        this.effectFactory.createEnemySpawn(position, type, factionId);
      }
    }

    this.updateSpawnRate();
  }

  destroy(): void {
    this.enemySpawned$.complete();
    this.waveStarted$.complete();
    this.waveWarning$.complete();
    this.newThreatUnlocked$.complete();
    this.waveEventStarted$.complete();
    this.waveEventEnded$.complete();
    this.sectorAlert$.complete();
  }

  /**
   * Reset spawn system state for game restart (without destroying observables)
   */
  reset(): void {
    this.spawnTimer = 0;
    this.waveTimer = SPAWN_CONFIG.WAVES.WAVE_INTERVAL_MS - ENCOUNTER_DIRECTOR_CONFIG.OPENING.FIRST_WAVE_DELAY_MS;
    this.currentWaveNumber = 0;
    this.activeWaves = [];
    this.waveWarningEmitted = false;
    this.lastWaveStartTime = 0;
    this.shouldSpawnInitial = false;
    this.initialSpawnEntityManager = undefined;
    this.unlockedTypes = new Set<string>(['basic', 'spitter']);
    // Reset event state and restore any active effects
    if (this.activeEvent === 'blackout') {
      if (this.minimapRenderer) this.minimapRenderer.blackoutActive = false;
      if (this.postProcessing) this.postProcessing.setVignetteState('none');
    }
    this.activeEvent = null;
    this.encounterPlanner.reset();
    this.encounterObjectives.reset();
    this.spawnPositions.reset();
    this.updateSpawnRate();
  }

  /**
   * Set world bounds for spawn positioning
   */
  setWorldBounds(width: number, height: number): void {
    this.worldBounds = { width, height };
    this.spawnPositions.setWorldBounds(width, height);
  }

  /** Converts an authored formation into a deterministic position around the player. */
  private getEncounterSpawnPosition(
    wave: ActiveWave,
    plan: EncounterPlan,
    enemyType: EnemyType
  ): { x: number; y: number } {
    return this.spawnPositions.getEncounterPosition({
      formation: plan.formation,
      index: wave.spawnedEnemies,
      total: wave.totalEnemies,
      anchorAngle: wave.anchorAngle ?? 0,
      enemyType,
      blackoutActive: this.isBlackoutActive,
    });
  }

  /** Gives the player one readable directive before standard damage pressure begins. */
  private softenOpeningEnemy(entityManager: EntityManager, entity: number): void {
    const damage = entityManager.getComponent(entity, DamageComponent);
    if (damage && damage.contactDamage > 0) {
      damage.contactDamage = Math.max(
        1,
        Math.round(damage.contactDamage * ENCOUNTER_DIRECTOR_CONFIG.OPENING.DAMAGE_MULTIPLIER)
      );
    }
    const weapon = entityManager.getComponent(entity, WeaponComponent);
    if (weapon && weapon.damage > 0) {
      weapon.damage = Math.max(1, Math.round(weapon.damage * ENCOUNTER_DIRECTOR_CONFIG.OPENING.DAMAGE_MULTIPLIER));
    }
  }

  /** Compatibility seam for debug tools that construct an ActiveWave directly. */
  private createFallbackPlan(wave: ActiveWave): EncounterPlan {
    const rosters: Record<WaveType, readonly EnemyType[]> = {
      normal: [EnemyType.Basic, EnemyType.Spitter],
      swarm: [EnemyType.Swarm, EnemyType.Basic, EnemyType.Swarm, EnemyType.Spitter],
      elite: [EnemyType.Tank, EnemyType.Thug, EnemyType.Sniper, EnemyType.Spitter],
      boss: [EnemyType.Boss],
      boss_rush: [EnemyType.Boss],
      faction_invasion: [EnemyType.Thug, EnemyType.Tank, EnemyType.Spitter, EnemyType.Basic],
      blackout: [EnemyType.Sniper, EnemyType.Disruptor, EnemyType.Thug, EnemyType.Sentinel],
      guardian_surge: [EnemyType.Tank, EnemyType.Thug, EnemyType.Sentinel],
      salvage_hunt: [EnemyType.Tank, EnemyType.Thug, EnemyType.Spitter, EnemyType.Basic],
    };
    return {
      waveNumber: wave.waveId,
      type: wave.type,
      archetypeId: wave.type,
      title: wave.type,
      brief: '',
      formation: wave.type === 'guardian_surge' ? 'boundary' : 'ring',
      roster: rosters[wave.type],
      totalEnemies: wave.totalEnemies,
      spawnDurationMs: wave.spawnInterval * wave.totalEnemies,
      eliteChance: wave.type === 'elite' ? 0.5 : wave.type === 'blackout' ? 0.4 : this.config.eliteChance,
      championChance: SPAWN_CONFIG.RARITY.CHAMPION_CHANCE,
      objective: wave.type === 'blackout' ? 'survive' : 'eliminate',
      timeLimitMs: 0,
      reward: { shards: 0, xp: 0 },
      invasionFactionId: wave.invasionFactionId,
    };
  }

  /**
   * Spawn a new enemy at a random edge position
   */
  private spawnEnemy(_entityManager: EntityManager): void {
    // Get spawn position first
    const position = this.getSpawnPosition();

    // Check if this position is in a conflict zone
    let spawnCount = 1;
    let shouldMixFactions = false;

    if (this.borderConflictSystem) {
      const spawnMultiplier = this.borderConflictSystem.getSpawnMultiplier(position.x, position.y);
      // Use multiplier to potentially spawn multiple enemies
      if (spawnMultiplier > 1 && this.random.random() < spawnMultiplier - 1) {
        spawnCount = Math.min(3, Math.floor(spawnMultiplier)); // Cap at 3 enemies per spawn
      }
      shouldMixFactions = this.borderConflictSystem.shouldSpawnMixedFactions(position.x, position.y);
    }

    // Then select enemy type based on that position's faction
    let type = this.selectEnemyType(position);
    // Boss spawn cap: only one boss alive at a time
    if (type === EnemyType.Boss && this.hasBossAlive(_entityManager)) {
      type = EnemyType.Tank;
    }
    let rarity = this.selectRarity();
    let isElite = this.random.random() < this.config.eliteChance;

    // Get faction ID from the territory where enemy spawns
    let factionId = 0; // Default to neutral
    const conflictingFactions: number[] = [];

    if (this.fourKingsTerritory && this.fourKingsTerritory.getIsInitialized()) {
      const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(position.x, position.y);
      // Validate faction ID is within valid range
      if (
        territoryInfo &&
        territoryInfo.kingId >= FACTION_CONFIG.MIN_FACTION_ID &&
        territoryInfo.kingId <= FACTION_CONFIG.MAX_FACTION_ID
      ) {
        factionId = territoryInfo.kingId;

        // Apply momentum-based spawn modifiers
        if (this.territoryMomentum) {
          const momentumSpawnMultiplier = this.territoryMomentum.getSpawnMultiplier(factionId);
          // Adjust spawn count based on momentum (losing factions spawn more)
          if (momentumSpawnMultiplier > 1.0 && this.random.random() < 0.5) {
            spawnCount = Math.min(spawnCount + 1, 3); // Add one more enemy for losing factions
          }
        }
      }
    }

    // Get conflicting factions if in a conflict zone
    if (shouldMixFactions && this.borderConflictSystem) {
      const factions = this.borderConflictSystem.getConflictingFactions(position.x, position.y);
      if (factions.length > 0) {
        conflictingFactions.push(...factions);
      }
    }

    // Champion check: config-driven chance to become champion (replaces an elite slot)
    let isChampion = false;
    if (
      this.currentWaveNumber >= SPAWN_CONFIG.RARITY.CHAMPION_MIN_WAVE &&
      type !== EnemyType.Boss &&
      this.random.random() < SPAWN_CONFIG.RARITY.CHAMPION_CHANCE
    ) {
      isChampion = true;
      isElite = false;
      rarity = 'legendary';
    }

    // Send spawn attempt to debug bridge if available
    if (window.debugLogBridge) {
      window.debugLogBridge.log('👾 Enemy Spawn', 'info', {
        success: true,
        entity: 'creating',
        type: type,
        rarity: rarity,
        isElite: isElite,
        isChampion: isChampion,
        factionId: factionId,
        position: [position.x.toFixed(0), position.y.toFixed(0)],
        worldBounds: `${this.worldBounds.width}x${this.worldBounds.height}`,
        spawnRate: this.currentSpawnRate,
        spawnCount: spawnCount,
        conflictZone: shouldMixFactions,
      });
    }

    // Spawn enemies based on count (conflict zones can spawn multiple)
    for (let i = 0; i < spawnCount; i++) {
      // For mixed faction spawning in conflict zones
      let spawnFactionId = factionId;

      if (shouldMixFactions && conflictingFactions.length > 1 && i > 0) {
        // Alternate between conflicting factions for additional spawns
        spawnFactionId = conflictingFactions[i % conflictingFactions.length];
      }

      // Offset position slightly for multiple spawns
      const offsetX = i > 0 ? position.x + (this.random.random() - 0.5) * 100 : position.x;
      const offsetY = i > 0 ? position.y + (this.random.random() - 0.5) * 100 : position.y;

      const enemy = this.entityFactory.createEnemy(
        offsetX,
        offsetY,
        type,
        rarity,
        isElite && i === 0, // Only first enemy can be elite
        spawnFactionId,
        isChampion && i === 0 // Only first enemy can be champion
      );
      // Note: enemyStrengthMultiplier is applied internally by entity factory based on faction momentum

      // Send entity creation confirmation to debug bridge if available
      if (window.debugLogBridge && i === 0) {
        // Only log once for first enemy
        window.debugLogBridge.log('✅ Enemy Created', 'info', {
          entity: enemy,
          components: 'complete',
          spawnIndex: i,
          totalSpawns: spawnCount,
        });
      }

      // Emit spawn event for each enemy
      this.enemySpawned$.next({
        entity: enemy,
        type,
        position: { x: offsetX, y: offsetY },
      });

      // Show portal spawn effect for non-swarm enemies within visible range
      if (type !== EnemyType.Swarm && this.effectFactory) {
        const playerPosC = this.spawnPositions.getPlayerPosition();
        const dxC = offsetX - playerPosC.x;
        const dyC = offsetY - playerPosC.y;
        if (dxC * dxC + dyC * dyC < 1200 * 1200) {
          this.effectFactory.createEnemySpawn({ x: offsetX, y: offsetY }, type, spawnFactionId);
        }
      }
    }

    this.updateSpawnRate();
  }

  /**
   * Update entities with SpawnerComponent
   */
  private updateSpawners(_deltaTime: number, entityManager: EntityManager): void {
    const spawners = entityManager.getEntitiesWithComponents(SpawnerComponent, PositionComponent);

    for (const spawnerEntity of spawners) {
      const spawner = entityManager.getComponent(spawnerEntity, SpawnerComponent);
      const position = entityManager.getComponent(spawnerEntity, PositionComponent);

      if (!spawner || !position) continue;

      // Check if can spawn
      const currentTime = Date.now();
      if (spawner.canSpawn(currentTime)) {
        spawner.lastSpawnTime = currentTime;
        spawner.spawnCount++;

        // Spawn a new entity near the spawner
        const offset = this.random.randomPointInCircle(position.x, position.y, 50);
        this.createSpawnedEntity(spawner.spawnType, offset.x, offset.y, entityManager);
      }
    }
  }

  /**
   * Create entity based on spawner type
   */
  private createSpawnedEntity(type: string, x: number, y: number, _entityManager: EntityManager): number {
    // Get faction ID from spawn location
    let factionId = 0;
    if (this.fourKingsTerritory && this.fourKingsTerritory.getIsInitialized()) {
      const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(x, y);
      // Validate faction ID is within valid range
      if (
        territoryInfo &&
        territoryInfo.kingId >= FACTION_CONFIG.MIN_FACTION_ID &&
        territoryInfo.kingId <= FACTION_CONFIG.MAX_FACTION_ID
      ) {
        factionId = territoryInfo.kingId;
      }
    }

    switch (type) {
      case 'swarm':
        // Swarm spawners create smaller swarm enemies
        return this.entityFactory.createEnemy(x, y, EnemyType.Basic, 'common', false, factionId);
      default:
        // Default to basic enemy
        return this.entityFactory.createEnemy(x, y, EnemyType.Basic, 'common', false, factionId);
    }
  }

  private getSpawnPosition(enemyType?: EnemyType): { x: number; y: number } {
    return this.spawnPositions.getSpawnPosition(enemyType, this.isBlackoutActive);
  }

  /**
   * Check if a boss enemy is already alive in the world
   * Prevents multiple bosses from spawning simultaneously
   */
  private hasBossAlive(entityManager: EntityManager): boolean {
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent);
    for (const enemyId of enemies) {
      if (!this.entityFactory.isEntityActive(enemyId)) continue;
      const et = entityManager.getComponent(enemyId, EnemyTypeComponent);
      if (et && et.type === EnemyType.Boss) return true;
    }
    return false;
  }

  /**
   * Select enemy type based on weights, player level, and faction influence
   *
   * CRITICAL: ALL enemy types spawn in ALL territories!
   * Factions only provide slight weight modifications.
   */
  private selectEnemyType(spawnPosition?: { x: number; y: number }): EnemyType {
    const level = this.progression.level;

    // If we have faction spawn weights service, use it
    // Otherwise fall back to basic weights
    let weights: { [key in EnemyType]: number };

    if (this.factionSpawnWeights && spawnPosition) {
      // Use faction-aware weights that ensure ALL types spawn
      weights = this.factionSpawnWeights.getSpawnWeights(spawnPosition.x, spawnPosition.y, level);
    } else {
      // Base layer: config weights, optionally overridden by zone composition profile
      const currentZone = this.zoneState.getCurrentZone();
      const zoneProfile = currentZone ? ZONE_COMPOSITION_PROFILES[currentZone.enemyCompositionProfile] : undefined;

      if (zoneProfile) {
        // Zone composition overrides base weights — fill missing types with 0
        weights = { ...this.config.enemyWeights };
        for (const key of Object.keys(weights)) {
          weights[key as EnemyType] = zoneProfile.weights[key] ?? 0;
        }
      } else {
        // Fallback to config weights
        weights = { ...this.config.enemyWeights };
      }

      // Basic level adjustments applied on top of whichever weight set was chosen
      if (level < 5) {
        weights['basic'] *= 2;
        weights['boss'] = 0;
        weights['sniper'] *= 0.5; // Reduce but don't eliminate
      } else if (level < 10) {
        weights['tank'] *= 1.5;
        weights['spitter'] *= 1.5;
        weights['boss'] = 0;
      } else {
        weights['thug'] *= 2;
        weights['sniper'] *= 2;
        // Boss is always 0 in weights — spawns only via scheduled boss waves
        weights['boss'] = 0;
      }
    }

    // Boss always has weight 0 in ambient selection — spawns only via scheduled boss waves
    weights[EnemyType.Boss] = 0;

    // Filter out enemy types not yet unlocked for current wave
    const currentWave = this.currentWaveNumber;
    for (const key of Object.keys(weights)) {
      const unlockWave = ENEMY_UNLOCK_WAVES[key];
      if (unlockWave !== undefined && currentWave < unlockWave) {
        weights[key as EnemyType] = 0;
      }
    }

    return this.random.weightedChoice(
      Object.entries(weights).map(([type, weight]) => ({
        value: type as EnemyType,
        weight,
      }))
    );
  }

  /**
   * Select rarity based on weights
   */
  private selectRarity(): Rarity {
    const roll = this.random.random();

    if (roll < this.config.rarityWeights.legendary) {
      return 'legendary';
    } else if (roll < this.config.rarityWeights.legendary + this.config.rarityWeights.rare) {
      return 'rare';
    } else {
      return 'common';
    }
  }

  /**
   * Update spawn rate based on player level - FIXED to scale properly
   */
  private updateSpawnRate(): void {
    const level = this.progression.level;

    // Proper difficulty scaling using config values
    const BASE_RATE = this.config.baseSpawnRate;
    const MIN_RATE = this.config.maxSpawnRate; // Note: maxSpawnRate is the minimum time between spawns
    const LEVEL_FACTOR = 0.95; // 5% faster per level

    // Exponential decay for smooth scaling
    const rate = BASE_RATE * Math.pow(LEVEL_FACTOR, level - 1);

    // Apply difficulty spawn rate multiplier (higher = faster spawns, so divide)
    const difficultySpawnMultiplier = this.difficultyService?.getModifiers().spawnRateMultiplier ?? 1.0;
    const adjustedRate = rate / difficultySpawnMultiplier;

    this.currentSpawnRate = Math.max(MIN_RATE, adjustedRate);
  }

  /**
   * Force spawn enemies for testing or events
   */
  forceSpawn(count: number, type?: EnemyType): void {
    // Implementation for forced spawning (useful for testing or special events)
    for (let i = 0; i < count; i++) {
      const position = this.getSpawnPosition(type); // Get position first
      const enemyType = type || this.selectEnemyType(position); // Then select type based on faction
      const rarity = this.selectRarity();

      // Get faction ID from territory
      let factionId = 0;
      if (this.fourKingsTerritory && this.fourKingsTerritory.getIsInitialized()) {
        const territoryInfo = this.fourKingsTerritory.getTerritoryAtPosition(position.x, position.y);
        // Validate faction ID is within valid range
        if (
          territoryInfo &&
          territoryInfo.kingId >= FACTION_CONFIG.MIN_FACTION_ID &&
          territoryInfo.kingId <= FACTION_CONFIG.MAX_FACTION_ID
        ) {
          factionId = territoryInfo.kingId;
        }
      }

      this.entityFactory.createEnemy(position.x, position.y, enemyType, rarity, false, factionId);
    }
  }
}
