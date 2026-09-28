import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { BeamCollisionSystemService, CombatSystemService, IntensityService } from '../systems/combat';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { GameEngineService } from '../engine/game-engine.service';
import { EntityFactoryECSService } from '../entities/entity-factory-ecs.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { PlayerService } from '../player/player.service';
import { EffectFactoryService } from '../entities/effect-factory.service';
import { FactionStandingSystemService } from '../systems/gameplay';
import { DamageCalculationService } from '../combat/damage-calculation.service';
import { XPEventTrackerService } from '../progression/xp-event-tracker.service';
import { PerformanceMonitorService } from '../utils/performance-monitor.service';
import { EnemyTypeComponent, HealthComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';
import { EnemyType } from '../models/enemy.model';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';

describe('Beam Kill XP Integration', () => {
  let entityManager: EntityManagerService;
  let beamCollisionSystem: BeamCollisionSystemService;
  let combatSystem: CombatSystemService;
  let progressionSystem: ProgressionSystemService;

  beforeEach(() => {
    const debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const intensitySpy = jasmine.createSpyObj('IntensityService', [
      'getXpMultiplier',
      'getState',
      'getCurrentState',
      'getMilestones',
      'start',
      'stop',
      'reset',
      'registerKill',
      'applyDamagePenalty',
    ]);
    intensitySpy.getXpMultiplier.and.returnValue(1.0);
    const gameEngineSpy = jasmine.createSpyObj('GameEngineService', ['triggerHitStop']);
    const entityFactorySpy = jasmine.createSpyObj('EntityFactoryECSService', [
      'createDeathParticles',
      'createEnemyExplosion',
      'createDamageNumber',
      'addBurnEffect',
    ]);
    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
      'createBeamImpact',
      'createMuzzleFlash',
      'createDamageNumber',
      'createDeathParticles',
      'createEnemyExplosion',
    ]);
    const factionStandingSpy = jasmine.createSpyObj('FactionStandingSystemService', [
      'getTerritoryEffects',
      'processKill',
    ]);
    factionStandingSpy.getTerritoryEffects.and.returnValue({ damageMultiplier: 1.0 });

    const damageCalcSpy = jasmine.createSpyObj('DamageCalculationService', ['calculateDamage']);
    const xpTrackerSpy = jasmine.createSpyObj('XPEventTrackerService', ['trackXPEvent', 'getRecentEvents']);
    xpTrackerSpy.getRecentEvents.and.returnValue([]);
    const perfMonitorSpy = jasmine.createSpyObj('PerformanceMonitorService', [
      'startMeasure',
      'endMeasure',
      'startSystemTimer',
      'endSystemTimer',
    ]);
    perfMonitorSpy.startSystemTimer.and.returnValue({ end: jasmine.createSpy('end').and.returnValue(0) });

    // Create PlayerService spy with all required methods
    const playerSpy = jasmine.createSpyObj('PlayerService', [
      'getPosition',
      'getAngle',
      'getHasDoubleBeam',
      'getBeamWidthMultiplier',
      'getFocusCharge',
      'isMoving',
      'getBeamDamageMultiplier',
      'getCriticalHitChance',
      'getCriticalHitMultiplier',
      'getBurnChance',
      'getBurnDamage',
      'isParryAvailable',
    ]);

    // Configure PlayerService mock with reasonable defaults
    playerSpy.getPosition.and.returnValue({ x: 0, y: 0 });
    playerSpy.getAngle.and.returnValue(0); // Pointing right (toward enemies at x=50)
    playerSpy.getHasDoubleBeam.and.returnValue(false);
    playerSpy.getBeamWidthMultiplier.and.returnValue(1.0);
    playerSpy.getFocusCharge.and.returnValue(100); // Full focus for max damage
    playerSpy.isMoving.and.returnValue(false); // Stationary for higher damage
    playerSpy.getBeamDamageMultiplier.and.returnValue(1.0);
    playerSpy.getCriticalHitChance.and.returnValue(0);
    playerSpy.getCriticalHitMultiplier.and.returnValue(1.5);
    playerSpy.getBurnChance.and.returnValue(0);
    playerSpy.getBurnDamage.and.returnValue(0);
    playerSpy.isParryAvailable.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        BeamCollisionSystemService,
        CombatSystemService,
        ProgressionSystemService,
        { provide: DebugLogBridgeService, useValue: debugSpy },
        { provide: GameEngineService, useValue: gameEngineSpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: FactionStandingSystemService, useValue: factionStandingSpy },
        { provide: DamageCalculationService, useValue: damageCalcSpy },
        { provide: XPEventTrackerService, useValue: xpTrackerSpy },
        { provide: PerformanceMonitorService, useValue: perfMonitorSpy },
        { provide: IntensityService, useValue: intensitySpy },
      ],
    });

    entityManager = TestBed.inject(EntityManagerService);
    beamCollisionSystem = TestBed.inject(BeamCollisionSystemService);
    combatSystem = TestBed.inject(CombatSystemService);
    progressionSystem = TestBed.inject(ProgressionSystemService);

    // Create player entity - required for XP award system
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));
  });

  describe('Beam Kill → XP Award Flow', () => {
    it('should award XP when beam kills a basic enemy', () => {
      // Create enemy entity with required components
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      const enemyPosition = new PositionComponent(50, 0);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic, false, 1.0);

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, enemyPosition);
      entityManager.addComponent(enemyId, enemyType);

      // Record initial XP
      const initialXp = progressionSystem.xp;

      // Simulate enemy being killed (normally done by beam collision)
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      // Process deaths through combat system - this awards XP
      combatSystem.update(16, entityManager);

      // Verify XP was awarded
      const expectedXp = PROGRESSION_CONFIG.ENEMY_XP.basic;
      expect(progressionSystem.xp).toBe(initialXp + expectedXp);
    });

    it('should award XP for tank enemy type', () => {
      // Create tank enemy entity (non-elite, to test enemy type XP scaling)
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      const enemyPosition = new PositionComponent(50, 0);
      const enemyType = new EnemyTypeComponent(EnemyType.Tank);

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, enemyPosition);
      entityManager.addComponent(enemyId, enemyType);

      // Record initial XP
      const initialXp = progressionSystem.xp;

      // Simulate enemy being killed
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      // Process deaths through combat system
      combatSystem.update(16, entityManager);

      // Verify tank XP was awarded (tank = 30 XP)
      const expectedXp = PROGRESSION_CONFIG.ENEMY_XP.tank;
      expect(progressionSystem.xp).toBe(initialXp + expectedXp);
    });

    it('should not award XP twice for the same enemy', () => {
      // Create enemy entity
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      const enemyPosition = new PositionComponent(50, 0);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic, false, 1.0);

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, enemyPosition);
      entityManager.addComponent(enemyId, enemyType);

      // Simulate enemy being killed
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      // Process death once
      combatSystem.update(16, entityManager);
      const xpAfterFirstProcess = progressionSystem.xp;

      // Try to process death again (entity should be removed or marked)
      combatSystem.update(16, entityManager);
      const xpAfterSecondProcess = progressionSystem.xp;

      // Verify XP was only awarded once
      expect(xpAfterSecondProcess).toBe(xpAfterFirstProcess);
    });

    it('should handle multiple kills in succession', () => {
      // Create multiple enemies
      const enemyIds: number[] = [];
      const enemyHealths: HealthComponent[] = [];

      for (let i = 0; i < 3; i++) {
        const enemyId = entityManager.createEntity();
        const enemyHealth = new HealthComponent(5, 5);
        const enemyPosition = new PositionComponent(30 + i * 20, 0);
        const enemyType = new EnemyTypeComponent(EnemyType.Basic, false, 1.0);

        entityManager.addComponent(enemyId, enemyHealth);
        entityManager.addComponent(enemyId, enemyPosition);
        entityManager.addComponent(enemyId, enemyType);

        enemyIds.push(enemyId);
        enemyHealths.push(enemyHealth);
      }

      // Record initial XP
      const initialXp = progressionSystem.xp;

      // Kill all enemies
      for (const health of enemyHealths) {
        health.health = 0;
        health.isDead = true;
      }

      // Process deaths
      combatSystem.update(16, entityManager);

      // Verify XP was awarded for all kills
      const expectedXp = PROGRESSION_CONFIG.ENEMY_XP.basic * 3;
      expect(progressionSystem.xp).toBe(initialXp + expectedXp);
    });

    it('should trigger level up when kills provide enough XP', () => {
      // Reset progression to level 1
      progressionSystem.reset();
      expect(progressionSystem.level).toBe(1);
      expect(progressionSystem.xp).toBe(0);

      // Subscribe to level up events
      let levelUpTriggered = false;
      let newLevel = 0;
      progressionSystem.levelUp$.subscribe((level) => {
        levelUpTriggered = true;
        newLevel = level;
      });

      // Create enough enemies to trigger level up (level 1→2 requires 100 XP)
      const xpNeeded = progressionSystem.getXpForNextLevel();
      const enemiesNeeded = Math.ceil(xpNeeded / PROGRESSION_CONFIG.ENEMY_XP.basic);

      for (let i = 0; i < enemiesNeeded; i++) {
        const enemyId = entityManager.createEntity();
        const enemyHealth = new HealthComponent(1, 1);
        const enemyPosition = new PositionComponent(50, i * 10);
        const enemyType = new EnemyTypeComponent(EnemyType.Basic, false, 1.0);

        entityManager.addComponent(enemyId, enemyHealth);
        entityManager.addComponent(enemyId, enemyPosition);
        entityManager.addComponent(enemyId, enemyType);

        // Kill enemy
        enemyHealth.health = 0;
        enemyHealth.isDead = true;
      }

      // Process all deaths
      combatSystem.update(16, entityManager);

      // Verify level up occurred
      expect(levelUpTriggered).toBe(true);
      expect(newLevel).toBe(2);
      expect(progressionSystem.level).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should award XP for all enemy deaths (design decision)', () => {
      // All deaths award XP regardless of source (current design decision)
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic, false, 1.0);
      const enemyPosition = new PositionComponent(100, 100);

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, enemyType);
      entityManager.addComponent(enemyId, enemyPosition);

      const initialXp = progressionSystem.xp;

      // Kill enemy directly
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      // Process death
      combatSystem.update(16, entityManager);

      // XP IS awarded for all deaths (design decision)
      expect(progressionSystem.xp).toBe(initialXp + PROGRESSION_CONFIG.ENEMY_XP.basic);
    });

    it('should handle beam collision system gracefully', () => {
      // Verify graceful handling when no enemies exist
      expect(() => {
        beamCollisionSystem.update(16, entityManager);
      }).not.toThrow();
    });
  });
});
