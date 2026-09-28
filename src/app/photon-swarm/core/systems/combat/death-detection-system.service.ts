import { Injectable } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameStateService } from '../../state/game-state.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { TerritoryMomentumSystemService, TerritoryStrengthSystemService } from '../territory';
import {
  BeamCollisionSystemService,
  BurnSystemService,
  CollisionSystemService,
  ComboSystemService,
  EmpPulseSystemService,
  ShieldFacingSystemService,
} from '../combat';
import { BuffManagementSystemService } from '../gameplay';
import { EnemyManagerService } from '../enemy-ai/enemy-manager.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { VisualFeedbackCoordinatorService } from '../../services/visual-feedback-coordinator.service';
import { DifficultyService } from '../../../services/difficulty.service';
import { FactionAISystemService } from '../enemy-ai/faction-ai-system.service';
import { IdleBehaviorSystemService } from '../enemy-ai/idle-behavior-system.service';
import { EnemyMovementSystemService } from '../enemy-ai/enemy-movement-system.service';
import { EnemyHealthRegenSystemService } from '../enemy-ai/enemy-health-regen-system.service';
import { NPCFactionBattleSystemService } from '../enemy-ai/npc-faction-battle-system.service';
import { NpcAbilitySystemService } from '../enemy-ai/npc-ability-system.service';
import { MinionTrackerService } from '../enemy-ai/minion-tracker.service';
import {
  DeathAnimationComponent,
  EnemyType,
  EnemyTypeComponent,
  FactionComponent,
  FloatingTextComponent,
  HealthComponent,
  MinionTagComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  SplitOnDeathComponent,
  TerritorialGuardianComponent,
  VelocityComponent,
} from '@photon/components';
import { TreasureCacheSystemService, ZoneConfigService, ZoneGateSystemService, ZoneStateService } from '../world';
import { ZoneId } from '../../models/zone.model';
import { GameStats } from '../../models/game-state.model';
import { ZONE_GATE_DEFINITIONS } from '@photon/config/constants/world/zone.config';

/** The terminal zone of a run. Killing a boss here ends the run as a victory. */
const FINAL_ZONE_ID: ZoneId = 4;
import { PoolType, PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { CameraShakeService } from '../../effects/camera-shake.service';
import { PostProcessingService } from '../../effects/post-processing.service';
import { SettingsService } from '../../utils/settings.service';
import { AudioService } from '../../audio/audio.service';
import { TimeScaleService } from '../../engine/time-scale.service';
import { AchievementService } from '../../../services/achievement.service';
import { DualChargingSystemService } from '../gameplay/dual-charging-system.service';
import { RenderingSystemService } from '../rendering/rendering-system.service';

/**
 * Death Detection System - Monitors health components for death conditions
 *
 * This system runs every frame to check if any entities (player or enemies)
 * have died (health <= 0) and triggers appropriate game events.
 *
 * CRITICAL FIX: This addresses the bug where player health reaches 0
 * but death is not detected, leaving the player in an impossible state.
 */
@Injectable({ providedIn: 'root' })
export class DeathDetectionSystemService implements System {
  /** Timeout threshold - if ECS health has been 0 for this long, force death */
  private static readonly DEATH_TIMEOUT_MS = 500;

  /** Timestamp when player ECS health first went to 0 (null if health > 0) */
  private playerZeroHealthTimestamp: number | null = null;

  /** Last timestamp the minion tracker was pruned (epoch ms). */
  private lastMinionPruneAt = 0;

  /** Minimum interval between minion-tracker prunes (catches ghost IDs from non-death despawn paths). */
  private static readonly MINION_PRUNE_INTERVAL_MS = 1000;

  constructor(
    private gameState: GameStateService,
    private entityFactory: EntityFactoryECSService,
    private effectFactory: EffectFactoryService,
    private debugLog: DebugLogBridgeService,
    private progressionSystem: ProgressionSystemService,
    private territoryStrengthSystem: TerritoryStrengthSystemService,
    private territoryMomentum: TerritoryMomentumSystemService,
    private collisionSystem: CollisionSystemService,
    private comboSystem: ComboSystemService,
    private errorHandler: ErrorHandlerService,
    private visualFeedback: VisualFeedbackCoordinatorService,
    private beamCollisionSystem: BeamCollisionSystemService,
    private factionAiSystem: FactionAISystemService,
    private idleBehaviorSystem: IdleBehaviorSystemService,
    private enemyMovementSystem: EnemyMovementSystemService,
    private enemyHealthRegenSystem: EnemyHealthRegenSystemService,
    private cameraShake: CameraShakeService,
    private postProcessing: PostProcessingService,
    private settings: SettingsService,
    private audio: AudioService,
    private timeScaleService: TimeScaleService,
    private achievementService: AchievementService,
    private difficultyService: DifficultyService,
    private dualChargingSystem: DualChargingSystemService,
    private npcFactionBattleSystem: NPCFactionBattleSystemService,
    private buffManagementSystem: BuffManagementSystemService,
    private enemyManagerService: EnemyManagerService,
    private burnSystem: BurnSystemService,
    private empPulseSystem: EmpPulseSystemService,
    private shieldFacingSystem: ShieldFacingSystemService,
    private npcAbilitySystem: NpcAbilitySystemService,
    private zoneGateSystem: ZoneGateSystemService,
    private zoneStateService: ZoneStateService,
    private treasureCacheSystem: TreasureCacheSystemService,
    private zoneConfigService: ZoneConfigService,
    private renderingSystem: RenderingSystemService,
    private minionTracker: MinionTrackerService
  ) {}

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    // Wrap critical death detection in error handling to prevent system crash
    this.errorHandler.safeExecute(() => {
      if (this.gameState.isRunEnded()) return;

      // Check player death
      this.checkPlayerDeath(entityManager);

      // Player death and final-boss victory are mutually exclusive terminal
      // outcomes. Never continue enemy processing after death ended the run.
      if (this.gameState.isRunEnded()) return;

      // Check enemy deaths (backup for beam collision system)
      this.checkEnemyDeaths(entityManager);

      // Sprint B5 (Finding 2): periodically prune the minion tracker so caps
      // don't deflate when minions despawn via non-death paths.
      const now = Date.now();
      if (now - this.lastMinionPruneAt >= DeathDetectionSystemService.MINION_PRUNE_INTERVAL_MS) {
        this.minionTracker.prune(entityManager);
        this.lastMinionPruneAt = now;
      }
    }, 'DEATH_DETECTION_UPDATE');
  }

  private checkPlayerDeath(entityManager: EntityManagerService): void {
    const playerEntities = entityManager.getEntitiesWithComponents(PlayerControlledComponent, HealthComponent);

    for (const playerId of playerEntities) {
      // Use safe component access to prevent crashes if entity was destroyed
      const health = this.errorHandler.safeGetComponent<HealthComponent>(
        entityManager,
        playerId,
        HealthComponent,
        'PLAYER_HEALTH_CHECK'
      );

      if (!health) continue; // Skip if component is missing

      // Trigger death at 0.01 health or below to account for floating point precision
      // SAFETY CHECK: Ensure health value is a valid number
      const gameStateHealth = this.gameState.getHealth();
      const gameStateMaxHealth = this.gameState.getMaxHealth();

      const ecsHealthIsZero = health && !isNaN(health.health) && health.health <= 0.01;

      // Track timeout for race condition fallback
      if (ecsHealthIsZero && !health.isDead) {
        if (this.playerZeroHealthTimestamp === null) {
          this.playerZeroHealthTimestamp = Date.now();
        }
      } else if (!ecsHealthIsZero) {
        // Reset timer if health recovered
        this.playerZeroHealthTimestamp = null;
      }

      // CRITICAL FIX: Trigger death if:
      // 1. BOTH ECS and GameState agree health is <= 0, OR
      // 2. ECS health has been 0 for too long (timeout fallback prevents stuck state)
      const bothAgree = ecsHealthIsZero && gameStateHealth <= 0.01;
      const timeoutTriggered =
        ecsHealthIsZero &&
        this.playerZeroHealthTimestamp !== null &&
        Date.now() - this.playerZeroHealthTimestamp > DeathDetectionSystemService.DEATH_TIMEOUT_MS;

      if (!health.isDead && (bothAgree || timeoutTriggered)) {
        if (timeoutTriggered && !bothAgree) {
          this.debugLog.log('⚠️ DEATH TIMEOUT: Forcing death due to ECS/GameState sync issue', 'warning', {
            source: 'death_detection_system',
            operation: 'death_timeout_trigger',
            playerId,
            ecsHealth: health.health,
            gameStateHealth: gameStateHealth,
            timeInZeroState: Date.now() - (this.playerZeroHealthTimestamp ?? 0),
          });
        }
        // Add immediate death trigger logging with actual values
        this.debugLog.log('💀 DEATH TRIGGER CONDITION MET', 'error', {
          source: 'death_detection_system',
          operation: 'death_trigger',
          playerId,
          ecsHealth: health.health,
          gameStateHealth: gameStateHealth,
          ecsMaxHealth: health.maxHealth,
          gameStateMaxHealth: gameStateMaxHealth,
          isDead: health.isDead,
          timestamp: Date.now(),
        });
        this.debugLog.log('ECS Player death detected - triggering game over', 'error', {
          source: 'death_detection_system',
          operation: 'player_death',
          playerId,
          finalHealth: health.health,
          maxHealth: health.maxHealth,
          isDead: health.isDead || false,
        });

        // Mark as dead to prevent multiple triggers
        health.isDead = true;

        // Track player death impact on faction momentum
        // Get the faction that killed the player from collision system
        if (this.collisionSystem && this.territoryMomentum) {
          const killerFactionId = this.collisionSystem.getLastPlayerDamageSource();
          if (killerFactionId) {
            this.territoryMomentum.recordPlayerDeath(killerFactionId);
            this.debugLog.log('Player death attributed to faction', 'info', {
              source: 'death_detection_system',
              operation: 'player_death_faction',
              killerFactionId,
            });
          }
        }

        // Log before triggering game over
        this.debugLog.log('🎮 Calling triggerGameOver', 'error', {
          source: 'death_detection_system',
          operation: 'trigger_game_over',
          playerId,
          method: 'gameState.triggerGameOver',
        });

        const stats = this.buildEndOfRunStats(health.health, health.maxHealth);
        this.gameState.triggerGameOver(stats);

        // Break after first dead player
        break;
      }
    }
  }

  private checkEnemyDeaths(entityManager: EntityManagerService): void {
    const enemies = entityManager.getEntitiesWithComponents(EnemyTypeComponent, HealthComponent, PositionComponent);

    let frameKillCount = 0;
    let bossKilledThisFrame = false;
    let bossDeathPosition: { x: number; y: number } | null = null;
    let frameMaxShake = 0;

    for (const enemyId of enemies) {
      // Use safe component access to prevent crashes during entity destruction
      const health = this.errorHandler.safeGetComponent<HealthComponent>(
        entityManager,
        enemyId,
        HealthComponent,
        'ENEMY_HEALTH_CHECK'
      );

      if (!health) continue; // Skip if component is missing

      if (health && health.health <= 0 && !health.isDead) {
        // Warn on unattributed deaths for debugging phantom kills
        if (health.lastDamageSource === 'unknown') {
          this.debugLog.log('⚠️ PHANTOM DEATH: Enemy died with unknown damage source', 'warning', {
            source: 'death_detection_system',
            operation: 'unattributed_death',
            enemyId,
          });
        }

        // Mark as dead to prevent multiple triggers
        health.isDead = true;

        // Notify gate system when a territorial guardian dies
        const guardian = this.errorHandler.safeGetComponent<TerritorialGuardianComponent>(
          entityManager,
          enemyId,
          TerritorialGuardianComponent,
          'GUARDIAN_DEATH_CHECK'
        );
        if (guardian) {
          this.zoneGateSystem.recordGuardianKill(guardian.zoneId as ZoneId);
          this.zoneStateService.recordGuardianSlain(guardian.zoneId as ZoneId);

          // Spawn distinctive floating text for guardian kills
          const guardianPos = entityManager.getComponent(enemyId, PositionComponent);
          if (guardianPos) {
            const guardianText = entityManager.createEntity();
            entityManager.addComponent(guardianText, new PositionComponent(guardianPos.x, guardianPos.y - 20));
            entityManager.addComponent(guardianText, new VelocityComponent(0, 0));
            entityManager.addComponent(
              guardianText,
              new FloatingTextComponent(
                'Guardian Slain!',
                '#ffd700', // Gold color
                18, // Larger font
                2200, // Longer duration
                window.performance.now(),
                0,
                0, // No offset
                0,
                -40, // Float upward
                0.55, // Fade start
                1.2 // Slightly scaled up
              )
            );

            // B5: Gate progress feedback — show "GATE PROGRESS: X/Y GUARDIANS"
            // when the gate is not yet unlocked (the recordGuardianKill call above
            // increments the count, so read back the new count).
            const gateDefForZone = ZONE_GATE_DEFINITIONS.find(
              (g) => g.fromZoneId === guardian.zoneId && g.unlockCondition === 'guardian_kill'
            );
            if (gateDefForZone) {
              const currentKills = this.zoneGateSystem.guardianKillCounts.get(guardian.zoneId) ?? 0;
              if (currentKills < gateDefForZone.unlockValue) {
                const progressText = entityManager.createEntity();
                entityManager.addComponent(progressText, new PositionComponent(guardianPos.x, guardianPos.y - 55));
                entityManager.addComponent(progressText, new VelocityComponent(0, 0));
                entityManager.addComponent(
                  progressText,
                  new FloatingTextComponent(
                    `GATE PROGRESS: ${currentKills}/${gateDefForZone.unlockValue} GUARDIANS`,
                    '#ffa500',
                    13,
                    2800,
                    window.performance.now(),
                    0,
                    0,
                    0,
                    -25,
                    0.6,
                    1.0
                  )
                );
              }
            }
          }
        }

        // Clean up tracking maps across all systems to prevent memory leaks
        this.beamCollisionSystem.cleanupDeadEnemy(enemyId);
        this.collisionSystem.cleanupDeadEnemy(enemyId);
        this.factionAiSystem.cleanupDeadEnemy(enemyId);
        this.idleBehaviorSystem.cleanupDeadEnemy(enemyId);
        this.enemyMovementSystem.cleanupDeadEnemy(enemyId);
        this.enemyHealthRegenSystem.cleanupDeadEnemy(enemyId);
        this.dualChargingSystem.cleanupDeadEnemy(enemyId);
        this.npcFactionBattleSystem.cleanupDeadEnemy(enemyId);
        this.buffManagementSystem.cleanupDeadEntity(enemyId);
        this.enemyManagerService.cleanupDeadEnemy(enemyId);
        this.burnSystem.cleanupDeadEnemy(enemyId);
        this.empPulseSystem.cleanupDeadEnemy(enemyId);
        this.shieldFacingSystem.cleanupDeadEnemy(enemyId);
        this.npcAbilitySystem.cleanupDeadEnemy(enemyId);
        this.renderingSystem.cleanupDeadEnemy(enemyId);

        // Free this entity's minion-summoner slot set (if it was a summoner)
        this.minionTracker.cleanupOwner(enemyId);

        // If this entity was itself a summoned minion, free its slot from the owner's cap
        const minionTag = this.errorHandler.safeGetComponent<MinionTagComponent>(
          entityManager,
          enemyId,
          MinionTagComponent,
          'MINION_TAG_CHECK'
        );
        if (minionTag) {
          this.minionTracker.recordMinionDeath(enemyId, minionTag.ownerId);
        }

        // CRITICAL FIX: Check if kill was already awarded to prevent duplicates
        if (health.killAwarded) {
          // Skip duplicate kill award - this is expected behavior to prevent XP duplication
          // No logging needed - this happens frequently and is working correctly
        } else {
          // Award kill to player (centralized kill tracking to avoid duplicates)
          this.gameState.incrementKills();
          health.killAwarded = true;

          // Track achievement progress
          this.achievementService.recordKill();
          this.achievementService.recordKillStreak(this.gameState.getKillStreak());

          // Register kill with combo system for multipliers and visual feedback
          const basePoints = 100; // Base points per kill
          this.comboSystem.registerKill(basePoints);

          // Track kills this frame for multi-kill slow-motion
          frameKillCount++;

          // Track combo multiplier for achievement
          const comboMultiplier = this.comboSystem.getCurrentMultiplier();
          if (comboMultiplier > 1) {
            this.achievementService.recordComboMultiplier(comboMultiplier);
          }
        }

        // Log enemy death (XP now handled by combat system only)
        const enemyType = this.errorHandler.safeGetComponent<EnemyTypeComponent>(
          entityManager,
          enemyId,
          EnemyTypeComponent,
          'ENEMY_TYPE_CHECK'
        );
        const faction = this.errorHandler.safeGetComponent<FactionComponent>(
          entityManager,
          enemyId,
          FactionComponent,
          'ENEMY_FACTION_CHECK'
        );

        const position = this.errorHandler.safeGetComponent<PositionComponent>(
          entityManager,
          enemyId,
          PositionComponent,
          'POSITION_CHECK'
        );

        // Environmental/NPC kills (asteroids, claw slam, faction battles) skip player rewards
        const isEnvironmentalKill = health.lastDamageSource === 'environmental' || health.lastDamageSource === 'npc';

        if (!isEnvironmentalKill) {
          const xpValue = this.getEnemyXPValue(enemyType?.type || 'basic');
          this.visualFeedback.showKill(enemyType?.type || 'basic', faction?.kingId || 1, xpValue);

          this.debugLog.log(`⚔️ Enemy killed: ${enemyType?.type || 'unknown'}`, 'info', {
            source: 'death_detection_system',
            operation: 'enemy_death',
            enemyType: enemyType?.type || 'unknown',
            currentLevel: this.progressionSystem.level,
            killStreak: this.gameState.getKillStreak(),
          });

          const factionForMomentum = this.errorHandler.safeGetComponent<FactionComponent>(
            entityManager,
            enemyId,
            FactionComponent,
            'FACTION_CHECK'
          );
          if (factionForMomentum && position && this.territoryMomentum) {
            this.territoryMomentum.recordPlayerKill(factionForMomentum.kingId, position.x, position.y);
          }

          // Drop shards for player kills only — value scales with enemy type
          if (position) {
            const shardDropChance = 0.7;
            const multiShardChance = 0.25;
            const eType = enemyType?.type || 'basic';
            const shardValue =
              PROGRESSION_CONFIG.ENEMY_SHARD_VALUE[eType as keyof typeof PROGRESSION_CONFIG.ENEMY_SHARD_VALUE] ??
              PROGRESSION_CONFIG.ENEMY_SHARD_VALUE.basic;

            if (Math.random() < shardDropChance) {
              let shardCount = 1;
              if (Math.random() < multiShardChance) {
                shardCount = Math.random() < 0.5 ? 2 : 3;
              }

              for (let i = 0; i < shardCount; i++) {
                const offsetX = (Math.random() - 0.5) * 20;
                const offsetY = (Math.random() - 0.5) * 20;
                this.entityFactory.createShard(position.x + offsetX, position.y + offsetY, shardValue);
              }
            }
          }
        }

        // Sprint B1: split-on-death for Swarm enemies (before pool return).
        const factionForSplit = this.errorHandler.safeGetComponent<FactionComponent>(
          entityManager,
          enemyId,
          FactionComponent,
          'SPLIT_FACTION_CHECK'
        );
        this.processSplitOnDeath(
          entityManager,
          enemyId,
          position,
          enemyType,
          factionForSplit?.kingId ?? 0,
          isEnvironmentalKill
        );

        // Territory weakening applies to all deaths
        if (position) {
          this.territoryStrengthSystem.weakenTilesFromKill(position.x, position.y);
        }

        if (isEnvironmentalKill) {
          if (position) {
            this.effectFactory.createEnemyExplosion({ x: position.x, y: position.y }, 0.8);
          }
          this.entityFactory.returnToPool(PoolType.ENEMY, enemyId);
        } else {
          const renderable = entityManager.getComponent(enemyId, RenderableComponent);
          if (renderable) {
            // 400ms (was 600): now that the renderer actually applies the fade opacity, a shorter
            // window keeps deaths snappy and avoids a pile of translucent corpses in busy fights.
            const deathAnimation = new DeathAnimationComponent(400, 'flash');
            deathAnimation.originalOpacity = renderable.opacity || 1.0;
            entityManager.addComponent(enemyId, deathAnimation);
          } else {
            this.entityFactory.returnToPool(PoolType.ENEMY, enemyId);
          }

          // Audio feedback for kills
          const killType = enemyType?.type ?? EnemyType.Basic;
          if (killType === EnemyType.Boss || enemyType?.isElite) {
            this.audio.playEliteDeath();
            if (killType === EnemyType.Boss) {
              bossKilledThisFrame = true;
              if (position) {
                bossDeathPosition = { x: position.x, y: position.y };
              }
            }
          } else {
            this.audio.playEnemyDeath();
          }

          // Screen shake — track strongest per-frame, apply once after loop
          if (this.settings.getSettings().screenShake) {
            const type = enemyType?.type ?? EnemyType.Basic;
            const shakeIntensity =
              type === EnemyType.Boss ? 12 : type === EnemyType.Tank ? 4 : enemyType?.isElite ? 6 : 2;
            frameMaxShake = Math.max(frameMaxShake, shakeIntensity);
          }

          // Chromatic aberration on high-value kills
          if (this.settings.getSettings().chromaticAberration) {
            if (enemyType?.type === EnemyType.Boss) {
              this.postProcessing.addChromaticAberration({
                intensity: 0.6,
                duration: 600,
                fadeOut: true,
              });
            } else if (enemyType?.isElite) {
              this.postProcessing.addChromaticAberration({
                intensity: 0.3,
                duration: 300,
                fadeOut: true,
              });
            }
          }
        }
      }
    }

    // Single screen shake per frame using the strongest intensity (prevents stacking)
    if (frameMaxShake > 0) {
      this.cameraShake.addShake({ intensity: frameMaxShake, duration: 80 });
    }

    // Slow-motion triggers for dramatic moments (boss kill takes priority)
    if (bossKilledThisFrame) {
      this.timeScaleService.applySlowMotion(0.2, 800);
    } else if (frameKillCount >= 3) {
      this.timeScaleService.applySlowMotion(0.4, 400);
    }

    // B2: Boss defeated ceremony — audio burst + floating text + bonus shards
    if (bossKilledThisFrame && bossDeathPosition) {
      this.audio.playBossBurst();

      // "BOSS DEFEATED" floating text at death position (gold, large, floats up)
      const defeatText = entityManager.createEntity();
      entityManager.addComponent(defeatText, new PositionComponent(bossDeathPosition.x, bossDeathPosition.y - 30));
      entityManager.addComponent(defeatText, new VelocityComponent(0, 0));
      entityManager.addComponent(
        defeatText,
        new FloatingTextComponent(
          'BOSS DEFEATED',
          '#ffd700',
          22,
          2500,
          window.performance.now(),
          0,
          0,
          0,
          -50,
          0.5,
          1.3
        )
      );

      // +25 bonus shards dropped near the boss
      const BONUS_SHARDS = 25;
      const shardEntities = 5;
      for (let i = 0; i < shardEntities; i++) {
        const angle = (Math.PI * 2 * i) / shardEntities;
        const dist = 40 + Math.random() * 60;
        this.entityFactory.createShard(
          bossDeathPosition.x + Math.cos(angle) * dist,
          bossDeathPosition.y + Math.sin(angle) * dist,
          Math.floor(BONUS_SHARDS / shardEntities)
        );
      }

      // "+25 BONUS" floating text stacked above the defeat text
      const bonusText = entityManager.createEntity();
      entityManager.addComponent(bonusText, new PositionComponent(bossDeathPosition.x, bossDeathPosition.y - 60));
      entityManager.addComponent(bonusText, new VelocityComponent(0, 0));
      entityManager.addComponent(
        bonusText,
        new FloatingTextComponent('+25 BONUS', '#66ffcc', 16, 2000, window.performance.now(), 0, 0, 0, -35, 0.55, 1.1)
      );
    }

    // Phase 8 — Run completion arc. Killing a boss inside the final zone
    // (Zone 4 / Deep Core, ZoneId 4) ends the run as a victory rather than
    // letting the player drift endlessly. Built on the existing
    // bossKilledThisFrame signal so it costs nothing in the per-enemy loop.
    if (bossKilledThisFrame && this.zoneStateService.getCurrentZoneId() === FINAL_ZONE_ID) {
      const stats = this.buildEndOfRunStats(this.gameState.getHealth(), this.gameState.getMaxHealth());
      this.gameState.triggerGameOver(stats, 'victory');
    }
  }

  /**
   * Sprint B1 — Swarm split-on-death.
   *
   * Called for every enemy death before the entity is returned to pool.
   * If the enemy carries a SplitOnDeathComponent and `canSplit()` is true,
   * `childCount` children of the same EnemyType are spawned at jittered
   * positions around the death point with scaled HP.
   *
   * Environmental kills are intentionally excluded so asteroids / claw slam /
   * NPC-faction battles don't produce free spawn farms.
   */
  private processSplitOnDeath(
    entityManager: EntityManagerService,
    parentId: number,
    position: PositionComponent | null,
    enemyType: EnemyTypeComponent | null,
    factionId: number,
    isEnvironmentalKill: boolean
  ): void {
    if (isEnvironmentalKill || !position || !enemyType) return;

    const split = this.errorHandler.safeGetComponent<SplitOnDeathComponent>(
      entityManager,
      parentId,
      SplitOnDeathComponent,
      'SPLIT_ON_DEATH_CHECK'
    );
    if (!split || !split.canSplit()) return;

    const childGen = split.spawnChildGeneration();
    for (let i = 0; i < split.childCount; i++) {
      const angle = (Math.PI * 2 * i) / split.childCount + Math.random() * 0.4;
      const r = split.jitterRadius * (0.6 + Math.random() * 0.6);
      const cx = position.x + Math.cos(angle) * r;
      const cy = position.y + Math.sin(angle) * r;

      const childId = this.entityFactory.createEnemy(cx, cy, enemyType.type, 'common', false, factionId);

      // Tag generation on the child's freshly-attached SplitOnDeathComponent
      // so it cannot split further past maxGenerations.
      const childSplit = entityManager.getComponent(childId, SplitOnDeathComponent);
      if (childSplit) {
        childSplit.generation = childGen;
      }

      // Reduce child HP per healthScale
      const childHealth = entityManager.getComponent(childId, HealthComponent);
      if (childHealth) {
        const scaled = Math.max(1, Math.floor(childHealth.maxHealth * split.childHealthScale));
        childHealth.maxHealth = scaled;
        childHealth.health = scaled;
      }
    }

    this.debugLog.log('Enemy split on death', 'info', {
      source: 'death_detection_system',
      operation: 'split_on_death',
      parentId,
      enemyType: enemyType.type,
      childCount: split.childCount,
      generation: split.generation,
    });
  }

  /**
   * Build the GameStats payload that drives the end-screen. Shared by the
   * player-death and Zone-4 boss-clear (victory) paths so both branches
   * carry identical zone/cache/guardian telemetry.
   */
  private buildEndOfRunStats(currentHealth: number, currentMaxHealth: number): GameStats {
    // Flush pending zone time so stats are accurate even if the player was
    // stationary just before the run ended.
    this.zoneStateService.flushTimeAccumulator();

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
    return {
      level: this.progressionSystem.level,
      shards: this.gameState.getShards(),
      kills: this.gameState.getKills(),
      time: Math.floor((window.performance.now() - this.gameState.getStartTime()) / 1000),
      health: currentHealth,
      maxHealth: currentMaxHealth,
      killStreak: this.gameState.getKillStreak(),
      maxKillStreak: this.gameState.getMaxKillStreak(),
      difficulty: this.difficultyService.getDifficulty(),
      zonesVisited: visitedZones,
      cachesOpened: this.treasureCacheSystem.openedCacheIds.size,
      guardiansSlain: this.zoneGateSystem.getTotalGuardianKills(),
      zoneStats,
    };
  }

  private getEnemyXPValue(enemyType: string): number {
    const configXp = PROGRESSION_CONFIG.ENEMY_XP[enemyType as keyof typeof PROGRESSION_CONFIG.ENEMY_XP];
    return configXp ?? PROGRESSION_CONFIG.ENEMY_XP.basic;
  }
}
