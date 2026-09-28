import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { CombatSystemService } from '../systems/combat';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { XPEventSource, XPEventTrackerService } from '../progression/xp-event-tracker.service';
import { PlayerService } from '../player/player.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { DamageCalculationService } from '../combat/damage-calculation.service';
import { EffectFactoryService } from '../entities/effect-factory.service';
import { PerformanceMonitorService } from '../utils/performance-monitor.service';
import { FactionStandingSystemService } from '../systems/gameplay';
import {
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  ProjectileComponent,
  WeaponComponent,
} from '@photon/components';
import { AlertState, EnemyType, Rarity } from '../models/enemy.model';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';

describe('XP Accumulation Integration Tests', () => {
  let entityManager: EntityManagerService;
  let combatSystem: CombatSystemService;
  let progressionSystem: ProgressionSystemService;
  let xpTracker: XPEventTrackerService;
  let debugLogSpy: jasmine.SpyObj<DebugLogBridgeService>;

  beforeEach(() => {
    const debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
      'createDeathParticles',
      'createEnemyExplosion',
      'createDamageNumber',
      'addBurnEffect',
    ]);
    const performanceMonitorSpy = jasmine.createSpyObj('PerformanceMonitorService', [
      'startMeasurement',
      'endMeasurement',
      'recordSample',
      'getMetrics',
      'startSystemTimer',
      'endSystemTimer',
    ]);
    const factionStandingSpy = jasmine.createSpyObj('FactionStandingSystemService', [
      'processKill',
      'getStanding',
      'recordKill',
      'getPlayerFactionId',
      'onEnemyKilled',
      'getTerritoryEffects',
    ]);
    factionStandingSpy.getTerritoryEffects.and.returnValue({
      damageMultiplier: 1.0,
      defenseMultiplier: 1.0,
      xpMultiplier: 1.0,
    });

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        CombatSystemService,
        ProgressionSystemService,
        XPEventTrackerService,
        DamageCalculationService,
        PlayerService,
        { provide: DebugLogBridgeService, useValue: debugSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: PerformanceMonitorService, useValue: performanceMonitorSpy },
        { provide: FactionStandingSystemService, useValue: factionStandingSpy },
      ],
    });

    entityManager = TestBed.inject(EntityManagerService);
    combatSystem = TestBed.inject(CombatSystemService);
    progressionSystem = TestBed.inject(ProgressionSystemService);
    xpTracker = TestBed.inject(XPEventTrackerService);
    debugLogSpy = TestBed.inject(DebugLogBridgeService) as jasmine.SpyObj<DebugLogBridgeService>;

    // Reset state between tests - services are providedIn: 'root' singletons
    entityManager.clear();
    progressionSystem.reset();
    xpTracker.clearEvents();
  });

  describe('Projectile Kill XP Awards', () => {
    it('should award XP when projectile kills a basic enemy', () => {
      // Setup: Create player entity
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));
      entityManager.addComponent(playerId, new WeaponComponent(10, 1.5, 300, 5));

      // Create projectile entity
      const projectileId = entityManager.createEntity();
      entityManager.addComponent(projectileId, new ProjectileComponent(playerId, 10));
      entityManager.addComponent(projectileId, new DamageComponent(10));
      entityManager.addComponent(projectileId, new PositionComponent(100, 0));

      // Create enemy entity
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      const enemyPosition = new PositionComponent(100, 0); // At projectile location
      const enemyType = new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false);

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, enemyPosition);
      entityManager.addComponent(enemyId, enemyType);

      // Record initial XP
      const initialXp = progressionSystem.xp;

      // Simulate projectile hit (combat resolution)
      combatSystem.resolveCombat(projectileId, enemyId, 'projectile', entityManager, { x: 100, y: 0 });

      // Mark enemy as dead and process
      enemyHealth.health = 0;
      enemyHealth.isDead = true;
      combatSystem.update(16, entityManager);

      // Verify XP was awarded
      const expectedXp = PROGRESSION_CONFIG.ENEMY_XP.basic;
      expect(progressionSystem.xp).toBe(initialXp + expectedXp);

      // Verify XP event was tracked
      const stats = xpTracker.getStatistics();
      expect(stats.totalEvents).toBe(1);
      expect(stats.totalXpGained).toBe(expectedXp);
    });

    it('should award bonus XP for elite enemy killed by projectile', () => {
      // Setup: Create player entity (minimal pattern from chain kills test)
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Create elite enemy entity - already dead
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(50, 50);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, new PositionComponent(100, 0));
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, true)
      );

      // Record initial XP
      const initialXp = progressionSystem.xp;

      // Process death
      combatSystem.update(16, entityManager);

      // Verify XP was awarded with elite multiplier (Basic = 12, Elite = 2x = 24)
      const baseXp = PROGRESSION_CONFIG.ENEMY_XP.basic;
      const expectedXp = Math.floor(baseXp * PROGRESSION_CONFIG.ELITE_MULTIPLIER);
      expect(progressionSystem.xp).toBe(initialXp + expectedXp);

      // Verify XP event was tracked as elite kill
      const events = xpTracker.getEventsBySource(XPEventSource.ELITE_KILL);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].finalAmount).toBe(expectedXp);
    });

    it('should award correct XP for Tank + Elite combination', () => {
      // Test that Tank + Elite correctly awards XP
      // Note: XP may trigger level ups, so we verify XP was tracked correctly,
      // not just the remaining XP value

      // Setup: Create player entity
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Create Tank Elite enemy entity - already dead
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(100, 100);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, new PositionComponent(100, 0));
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Tank, Rarity.Common, AlertState.Passive, true)
      );

      // Record initial state
      const initialLevel = progressionSystem.level;
      const initialXp = progressionSystem.xp;

      // Calculate expected XP
      const baseXp = PROGRESSION_CONFIG.ENEMY_XP.tank;
      const expectedXp = Math.floor(baseXp * PROGRESSION_CONFIG.ELITE_MULTIPLIER);

      // Spy on addXp to verify it was called with correct value
      const addXpSpy = spyOn(progressionSystem, 'addXp').and.callThrough();

      // Process death
      combatSystem.update(16, entityManager);

      // Verify addXp was called with the correct XP value (Tank 30 * Elite 2 = 60)
      expect(addXpSpy).toHaveBeenCalledWith(expectedXp);

      // Verify XP event was tracked as elite kill with correct amounts
      const events = xpTracker.getEventsBySource(XPEventSource.ELITE_KILL);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].finalAmount).toBe(expectedXp);
      expect(events[0].metadata.enemyType).toBe(EnemyType.Tank);

      // Verify progression occurred (XP increased)
      // Level 1 needs 100 XP to level up (PROGRESSION_CONFIG.XP_BASE = 100)
      // Tank Elite gives 60 XP (30 * 2), which is not enough to level up
      const finalLevel = progressionSystem.level;
      const finalXp = progressionSystem.xp;

      // XP should have increased by expectedXp (60)
      expect(finalXp).toBe(initialXp + expectedXp);
      // Level should remain the same since 60 XP < 100 XP threshold
      expect(finalLevel).toBe(initialLevel);
    });

    it('should handle chain kills from explosive projectiles', () => {
      // Setup player
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Create multiple enemies in explosion radius
      const enemyIds: number[] = [];
      for (let i = 0; i < 3; i++) {
        const enemyId = entityManager.createEntity();
        const enemyHealth = new HealthComponent(10, 10);
        enemyHealth.health = 0; // Killed by explosion
        enemyHealth.isDead = true;

        entityManager.addComponent(enemyId, enemyHealth);
        entityManager.addComponent(enemyId, new PositionComponent(100 + i * 10, 0));
        entityManager.addComponent(
          enemyId,
          new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
        );

        enemyIds.push(enemyId);
      }

      // Record initial XP
      const initialXp = progressionSystem.xp;

      // Process all deaths
      combatSystem.update(16, entityManager);

      // Verify XP for all kills
      const expectedXp = PROGRESSION_CONFIG.ENEMY_XP.basic * 3;
      expect(progressionSystem.xp).toBe(initialXp + expectedXp);

      // Verify all events tracked
      const stats = xpTracker.getStatistics();
      expect(stats.totalEvents).toBe(3);
    });
  });

  describe('XP Collection Range Upgrades', () => {
    it('should track XP events with position metadata', () => {
      // Setup player
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Create enemy at specific position
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      const enemyPosition = new PositionComponent(200, 150);
      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, enemyPosition);
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
      );

      // Process death
      combatSystem.update(16, entityManager);

      // Verify position was tracked
      const lastEvent = xpTracker.getStatistics().recentEvents[0];
      expect(lastEvent.metadata.position).toBeDefined();
      expect(lastEvent.metadata.position?.x).toBe(200);
      expect(lastEvent.metadata.position?.y).toBe(150);
    });

    it('should prepare for XP range upgrade system integration', () => {
      // This test documents the expected behavior for XP range upgrades
      // Currently returns 1.0 multiplier (no bonus) as placeholder

      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Create enemy outside normal range but within upgraded range
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, new PositionComponent(500, 0)); // Far away
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
      );

      // Process death
      const initialXp = progressionSystem.xp;
      combatSystem.update(16, entityManager);

      // Currently no range bonus implemented (returns 1.0)
      // When implemented, enemies within upgraded range would get bonus XP
      const baseXp = PROGRESSION_CONFIG.ENEMY_XP.basic;
      expect(progressionSystem.xp).toBe(initialXp + baseXp);

      // Future: Would check for 'xp_range_upgrade' multiplier in event
      const lastEvent = xpTracker.getStatistics().recentEvents[0];
      const hasRangeBonus = lastEvent.multipliers.some((m) => m.source === 'xp_range_upgrade');
      expect(hasRangeBonus).toBe(false); // Currently not implemented
    });
  });

  describe('XP Event Tracking and Statistics', () => {
    it('should track XP per minute accurately', (done) => {
      // Kill some enemies
      for (let i = 0; i < 5; i++) {
        const playerId = entityManager.createEntity();
        entityManager.addComponent(playerId, new PlayerControlledComponent());
        entityManager.addComponent(playerId, new PositionComponent(0, 0));

        const enemyId = entityManager.createEntity();
        const enemyHealth = new HealthComponent(10, 10);
        enemyHealth.health = 0;
        enemyHealth.isDead = true;

        entityManager.addComponent(enemyId, enemyHealth);
        entityManager.addComponent(enemyId, new PositionComponent(100, 0));
        entityManager.addComponent(
          enemyId,
          new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
        );

        combatSystem.update(16, entityManager);
      }

      // Check statistics
      const stats = xpTracker.getStatistics();
      expect(stats.totalEvents).toBe(5);
      expect(stats.totalXpGained).toBe(PROGRESSION_CONFIG.ENEMY_XP.basic * 5);
      expect(stats.averageXpPerEvent).toBe(PROGRESSION_CONFIG.ENEMY_XP.basic);

      // XP per minute should be calculated
      expect(stats.xpPerMinute).toBeGreaterThanOrEqual(0);

      done();
    });

    it('should track largest XP gain', () => {
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Kill regular enemy
      let enemyId = entityManager.createEntity();
      let enemyHealth = new HealthComponent(10, 10);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, new PositionComponent(100, 0));
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
      );
      combatSystem.update(16, entityManager);

      // Kill boss enemy (should be largest)
      enemyId = entityManager.createEntity();
      enemyHealth = new HealthComponent(100, 100);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, new PositionComponent(200, 0));
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Boss, Rarity.Common, AlertState.Passive, false)
      );
      combatSystem.update(16, entityManager);

      // Verify boss kill is tracked as largest
      const stats = xpTracker.getStatistics();
      expect(stats.largestXpGain).toBeDefined();
      expect(stats.largestXpGain?.source).toBe(XPEventSource.BOSS_KILL);
      expect(stats.largestXpGain?.finalAmount).toBeGreaterThan(PROGRESSION_CONFIG.ENEMY_XP.basic);
    });

    it('should provide detailed logging report', () => {
      // Setup some XP events
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Kill different enemy types
      const enemyTypes = [
        { type: EnemyType.Basic, isElite: false },
        { type: EnemyType.Tank, isElite: true },
        { type: EnemyType.Boss, isElite: false },
      ];

      for (const enemyConfig of enemyTypes) {
        const enemyId = entityManager.createEntity();
        const enemyHealth = new HealthComponent(10, 10);
        enemyHealth.health = 0;
        enemyHealth.isDead = true;

        entityManager.addComponent(enemyId, enemyHealth);
        entityManager.addComponent(enemyId, new PositionComponent(100, 0));
        entityManager.addComponent(
          enemyId,
          new EnemyTypeComponent(enemyConfig.type, Rarity.Common, AlertState.Passive, enemyConfig.isElite)
        );

        combatSystem.update(16, entityManager);
      }

      // Generate report
      xpTracker.logDetailedReport();

      // Verify debug log was called with report
      const reportCalls = debugLogSpy.log.calls.all().filter((call) => call.args[0].includes('XP Tracking Report'));
      expect(reportCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Level Up During Combat', () => {
    it('should track level changes in XP events', () => {
      const playerId = entityManager.createEntity();
      entityManager.addComponent(playerId, new PlayerControlledComponent());
      entityManager.addComponent(playerId, new PositionComponent(0, 0));

      // Reset progression
      progressionSystem.reset();

      // Give almost enough XP for level up
      const xpNeeded = progressionSystem.getXpForNextLevel();
      progressionSystem.addXp(xpNeeded - 5);

      // Kill enemy to trigger level up
      const enemyId = entityManager.createEntity();
      const enemyHealth = new HealthComponent(10, 10);
      enemyHealth.health = 0;
      enemyHealth.isDead = true;

      entityManager.addComponent(enemyId, enemyHealth);
      entityManager.addComponent(enemyId, new PositionComponent(100, 0));
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
      );

      // Process death (should level up)
      combatSystem.update(16, entityManager);

      // Verify level change was tracked
      const lastEvent = xpTracker.getStatistics().recentEvents[0];
      expect(lastEvent.metadata.levelBefore).toBe(1);
      expect(lastEvent.metadata.levelAfter).toBe(2);
    });
  });
});
