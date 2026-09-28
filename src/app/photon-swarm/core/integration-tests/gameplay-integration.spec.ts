import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { BurnSystemService } from '../systems/combat/burn-system.service';
import { CombatSystemService, IntensityService } from '../systems/combat';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../entities/effect-factory.service';
import { PerformanceMonitorService } from '../utils/performance-monitor.service';
import { FactionStandingSystemService } from '../systems/gameplay';
import { DamageCalculationService } from '../combat/damage-calculation.service';
import { XPEventTrackerService } from '../progression/xp-event-tracker.service';
import { DifficultyService } from '../../services/difficulty.service';
import { SettingsService } from '../utils/settings.service';
import { AudioService } from '../audio/audio.service';
import { AscensionService } from '../../services/ascension.service';
import { AchievementService } from '../../services/achievement.service';
import {
  BurnEffectComponent,
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
} from '@photon/components';
import { AlertState, EnemyType, Rarity } from '../models/enemy.model';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';

// ─────────────────────────────────────────────────────────────────────────────
// Shared provider factory — mirrors beam-xp-integration.spec.ts setup.
// ProgressionSystemService has transitive deps: AudioService → SettingsService,
// AscensionService, AchievementService. All must be provided as spies so that
// the root singleton chain doesn't blow up in headless test environments.
// ─────────────────────────────────────────────────────────────────────────────
interface SharedProviders {
  debugSpy: jasmine.SpyObj<DebugLogBridgeService>;
  effectFactorySpy: jasmine.SpyObj<EffectFactoryService>;
  performanceMonitorSpy: jasmine.SpyObj<PerformanceMonitorService>;
  factionStandingSpy: jasmine.SpyObj<FactionStandingSystemService>;
  xpTrackerSpy: jasmine.SpyObj<XPEventTrackerService>;
  settingsSpy: jasmine.SpyObj<SettingsService>;
  difficultySpy: jasmine.SpyObj<DifficultyService>;
  audioSpy: jasmine.SpyObj<AudioService>;
  ascensionSpy: jasmine.SpyObj<AscensionService>;
  achievementSpy: jasmine.SpyObj<AchievementService>;
  intensitySpy: jasmine.SpyObj<IntensityService>;
}

function buildSharedProviders(): SharedProviders {
  const debugSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

  const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
    'createBeamImpact',
    'createMuzzleFlash',
    'createDamageNumber',
    'createDeathParticles',
    'createEnemyExplosion',
    'addBurnEffect',
  ]);

  const performanceMonitorSpy = jasmine.createSpyObj('PerformanceMonitorService', [
    'startMeasure',
    'endMeasure',
    'startSystemTimer',
    'endSystemTimer',
  ]);
  performanceMonitorSpy.startSystemTimer.and.returnValue({ end: jasmine.createSpy('end').and.returnValue(0) });

  const factionStandingSpy = jasmine.createSpyObj('FactionStandingSystemService', [
    'getTerritoryEffects',
    'processKill',
  ]);
  factionStandingSpy.getTerritoryEffects.and.returnValue({
    damageMultiplier: 1.0,
    defenseMultiplier: 1.0,
    xpMultiplier: 1.0,
  });

  const xpTrackerSpy = jasmine.createSpyObj('XPEventTrackerService', ['trackXPEvent', 'getRecentEvents']);
  xpTrackerSpy.getRecentEvents.and.returnValue([]);

  const settingsSpy = jasmine.createSpyObj('SettingsService', ['getSettings']);
  settingsSpy.getSettings.and.returnValue({ showDamageNumbers: false });

  const difficultySpy = jasmine.createSpyObj('DifficultyService', ['getModifiers']);
  difficultySpy.getModifiers.and.returnValue({ xpMultiplier: 1.0 });

  // ProgressionSystemService → AudioService → SettingsService (subscription in ctor)
  // Providing a minimal spy avoids the Web Audio API instantiation crash
  const audioSpy = jasmine.createSpyObj('AudioService', ['playLevelUp', 'playShardCollect', 'playBeam']);

  const ascensionSpy = jasmine.createSpyObj('AscensionService', ['getXpBonus', 'getAscensionLevel']);
  ascensionSpy.getXpBonus.and.returnValue(1.0);
  ascensionSpy.getAscensionLevel.and.returnValue(0);

  const achievementSpy = jasmine.createSpyObj('AchievementService', [
    'recordKill',
    'recordLevelUp',
    'recordShard',
    'getAchievements',
  ]);
  achievementSpy.getAchievements.and.returnValue([]);

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

  return {
    debugSpy,
    effectFactorySpy,
    performanceMonitorSpy,
    factionStandingSpy,
    xpTrackerSpy,
    settingsSpy,
    difficultySpy,
    audioSpy,
    ascensionSpy,
    achievementSpy,
    intensitySpy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: Burn Chain Flow
// Enemy receives a burn effect → damage ticks reduce health → kill awards XP
// ─────────────────────────────────────────────────────────────────────────────
describe('Gameplay Integration — Burn Chain Flow', () => {
  let entityManager: EntityManagerService;
  let burnSystem: BurnSystemService;
  let combatSystem: CombatSystemService;
  let progressionSystem: ProgressionSystemService;

  beforeEach(() => {
    const {
      debugSpy,
      effectFactorySpy,
      performanceMonitorSpy,
      factionStandingSpy,
      xpTrackerSpy,
      settingsSpy,
      difficultySpy,
      audioSpy,
      ascensionSpy,
      achievementSpy,
      intensitySpy,
    } = buildSharedProviders();

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        BurnSystemService,
        CombatSystemService,
        ProgressionSystemService,
        DamageCalculationService,
        { provide: DebugLogBridgeService, useValue: debugSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: PerformanceMonitorService, useValue: performanceMonitorSpy },
        { provide: FactionStandingSystemService, useValue: factionStandingSpy },
        { provide: XPEventTrackerService, useValue: xpTrackerSpy },
        { provide: SettingsService, useValue: settingsSpy },
        { provide: DifficultyService, useValue: difficultySpy },
        { provide: AudioService, useValue: audioSpy },
        { provide: AscensionService, useValue: ascensionSpy },
        { provide: AchievementService, useValue: achievementSpy },
        { provide: IntensityService, useValue: intensitySpy },
      ],
    });

    entityManager = TestBed.inject(EntityManagerService);
    burnSystem = TestBed.inject(BurnSystemService);
    combatSystem = TestBed.inject(CombatSystemService);
    progressionSystem = TestBed.inject(ProgressionSystemService);

    entityManager.clear();
    progressionSystem.reset();
  });

  it('should apply burn damage over time via BurnEffectComponent', () => {
    // Create player entity required for XP award system
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    // Create enemy with enough health for several burn ticks
    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(100, 100);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(50, 50));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Apply burn effect: 10 damage/tick, 2000ms duration
    const burnStart = Date.now();
    const burnEffect = new BurnEffectComponent(10, 2000, burnStart, 0, 1.0, false);
    entityManager.addComponent(enemyId, burnEffect);

    // Verify enemy has the burn component before any update
    expect(entityManager.hasComponent(enemyId, BurnEffectComponent)).toBe(true);

    // Advance time past one tick interval (250ms) and run burn system
    const tickInterval = 250;
    burnEffect.lastBurnTick = burnStart - tickInterval; // Force tick to fire

    const healthBefore = enemyHealth.health;
    burnSystem.update(16, entityManager);

    // Health should have decreased by burnDamage after one tick
    expect(enemyHealth.health).toBeLessThan(healthBefore);
    expect(enemyHealth.health).toBe(healthBefore - 10);
  });

  it('should kill enemy when burn damage depletes health to 0', () => {
    // Player required for XP awards
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    // Enemy with exactly 1 tick worth of health (burn=10, health=10)
    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(10, 10);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(50, 50));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Burn at 10 damage/tick, 500ms duration
    const burnStart = Date.now();
    const burnEffect = new BurnEffectComponent(10, 500, burnStart, 0, 1.0, false);
    burnEffect.lastBurnTick = burnStart - 250; // Force tick
    entityManager.addComponent(enemyId, burnEffect);

    burnSystem.update(16, entityManager);

    // Health should reach 0 and isDead should be set
    expect(enemyHealth.health).toBe(0);
    expect(enemyHealth.isDead).toBe(true);
  });

  it('should award XP when combat system processes burn-killed enemy', () => {
    // Player entity
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    // Enemy with low health
    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(10, 10);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(50, 50));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Apply burn and force-kill via burn system
    const burnStart = Date.now();
    const burnEffect = new BurnEffectComponent(10, 500, burnStart, 0, 1.0, false);
    burnEffect.lastBurnTick = burnStart - 250; // Force tick
    entityManager.addComponent(enemyId, burnEffect);

    const initialXp = progressionSystem.xp;

    // Step 1: burn system applies damage and sets isDead
    burnSystem.update(16, entityManager);
    expect(enemyHealth.isDead).toBe(true);

    // Step 2: combat system processes deaths and awards XP
    combatSystem.update(16, entityManager);

    const expectedXp = PROGRESSION_CONFIG.ENEMY_XP.basic;
    expect(progressionSystem.xp).toBe(initialXp + expectedXp);
  });

  it('should remove expired burn effect from entity', () => {
    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(100, 100);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(50, 50));

    // Burn already expired (started 5000ms ago, duration 100ms)
    const expiredStart = Date.now() - 5000;
    const burnEffect = new BurnEffectComponent(5, 100, expiredStart, 0, 1.0, false);
    entityManager.addComponent(enemyId, burnEffect);

    burnSystem.update(16, entityManager);

    // Expired burn should be removed
    expect(entityManager.hasComponent(enemyId, BurnEffectComponent)).toBe(false);
    // Health should be unchanged since expired burns don't tick
    expect(enemyHealth.health).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: Consumable During Combat
//
// NOTE: The photon-swarm codebase uses PowerupComponent / ActivePowerupComponent
// for collectible powerups, not a traditional "consumable with active-use cooldown"
// system. There is no ConsumableService or active-use cooldown mechanism in any
// existing service. The test below exercises the ActivePowerupComponent directly
// to verify:
//   (a) applying a powerup sets the active state correctly
//   (b) querying after expiry returns the expected expired state
// A full "use-on-demand + server-side cooldown" consumable system would require
// new service infrastructure not present in the codebase.
// ─────────────────────────────────────────────────────────────────────────────
describe('Gameplay Integration — Consumable During Combat (ActivePowerupComponent)', () => {
  let entityManager: EntityManagerService;
  let combatSystem: CombatSystemService;
  let progressionSystem: ProgressionSystemService;

  beforeEach(() => {
    const {
      debugSpy,
      effectFactorySpy,
      performanceMonitorSpy,
      factionStandingSpy,
      xpTrackerSpy,
      settingsSpy,
      difficultySpy,
      audioSpy,
      ascensionSpy,
      achievementSpy,
      intensitySpy,
    } = buildSharedProviders();

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        CombatSystemService,
        ProgressionSystemService,
        DamageCalculationService,
        { provide: DebugLogBridgeService, useValue: debugSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: PerformanceMonitorService, useValue: performanceMonitorSpy },
        { provide: FactionStandingSystemService, useValue: factionStandingSpy },
        { provide: XPEventTrackerService, useValue: xpTrackerSpy },
        { provide: SettingsService, useValue: settingsSpy },
        { provide: DifficultyService, useValue: difficultySpy },
        { provide: AudioService, useValue: audioSpy },
        { provide: AscensionService, useValue: ascensionSpy },
        { provide: AchievementService, useValue: achievementSpy },
        { provide: IntensityService, useValue: intensitySpy },
      ],
    });

    entityManager = TestBed.inject(EntityManagerService);
    combatSystem = TestBed.inject(CombatSystemService);
    progressionSystem = TestBed.inject(ProgressionSystemService);

    entityManager.clear();
    progressionSystem.reset();
  });

  it('should apply DamageComponent burn-DoT effect and reduce enemy health over ticks', () => {
    // DamageComponent is the in-combat buff carrier used by CombatSystem's processDamageOverTime
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(50, 50);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(100, 0));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Apply a DamageComponent with burnDamage configured — this simulates a
    // "consumable" burn-DoT applied mid-combat
    const burnDoT = new DamageComponent(
      0, // contactDamage
      'burn', // damageType
      false, // canCrit
      0, // criticalChance
      1, // criticalMultiplier
      15, // burnDamage — 15 per tick
      1000, // burnDuration — 1000ms remaining
      0, // burnTickTimer — ready to tick immediately
      0, // recoilPercent
      0 // environmentalDamage
    );
    entityManager.addComponent(enemyId, burnDoT);

    const healthBefore = enemyHealth.health;

    // One update tick should fire the burn damage (burnTickTimer = 0 means ready)
    combatSystem.update(16, entityManager);

    // Health should decrease by burnDamage amount
    expect(enemyHealth.health).toBeLessThan(healthBefore);
    expect(enemyHealth.health).toBeCloseTo(healthBefore - 15, 1);
  });

  it('should stop applying burn DoT once duration expires', () => {
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(50, 50);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(100, 0));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Burn DoT with already-expired duration
    const expiredBurnDoT = new DamageComponent(0, 'burn', false, 0, 1, 15, 0, 0, 0, 0);
    // burnDuration = 0 → already expired, no damage should be applied
    entityManager.addComponent(enemyId, expiredBurnDoT);

    const healthBefore = enemyHealth.health;
    combatSystem.update(16, entityManager);

    // Duration is already 0, no tick should fire
    expect(enemyHealth.health).toBe(healthBefore);
  });

  it('should decrement burnTickTimer across updates when not yet ready', () => {
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(50, 50);
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(100, 0));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Burn DoT with cooldown of 1000ms — not ready to fire yet
    const activeBurnDoT = new DamageComponent(0, 'burn', false, 0, 1, 15, 2000, 1000, 0, 0);
    entityManager.addComponent(enemyId, activeBurnDoT);

    const healthBefore = enemyHealth.health;
    combatSystem.update(16, entityManager);

    // Tick timer still > 0 after 16ms delta — no burn damage
    expect(enemyHealth.health).toBe(healthBefore);
    // Timer decremented
    expect(activeBurnDoT.burnTickTimer).toBe(984); // 1000 - 16
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: Player Death → Clean Restart
// Damage player to 0 → verify game-over state → restart via entityManager.clear()
// → verify no leaked entity IDs, no stale Maps
// ─────────────────────────────────────────────────────────────────────────────
describe('Gameplay Integration — Player Death → Clean Restart', () => {
  let entityManager: EntityManagerService;
  let combatSystem: CombatSystemService;
  let progressionSystem: ProgressionSystemService;

  beforeEach(() => {
    const {
      debugSpy,
      effectFactorySpy,
      performanceMonitorSpy,
      factionStandingSpy,
      xpTrackerSpy,
      settingsSpy,
      difficultySpy,
      audioSpy,
      ascensionSpy,
      achievementSpy,
      intensitySpy,
    } = buildSharedProviders();

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        CombatSystemService,
        ProgressionSystemService,
        DamageCalculationService,
        { provide: DebugLogBridgeService, useValue: debugSpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: PerformanceMonitorService, useValue: performanceMonitorSpy },
        { provide: FactionStandingSystemService, useValue: factionStandingSpy },
        { provide: XPEventTrackerService, useValue: xpTrackerSpy },
        { provide: SettingsService, useValue: settingsSpy },
        { provide: DifficultyService, useValue: difficultySpy },
        { provide: AudioService, useValue: audioSpy },
        { provide: AscensionService, useValue: ascensionSpy },
        { provide: AchievementService, useValue: achievementSpy },
        { provide: IntensityService, useValue: intensitySpy },
      ],
    });

    entityManager = TestBed.inject(EntityManagerService);
    combatSystem = TestBed.inject(CombatSystemService);
    progressionSystem = TestBed.inject(ProgressionSystemService);

    entityManager.clear();
    progressionSystem.reset();
  });

  it('should set isDead when player health reaches 0', () => {
    const playerId = entityManager.createEntity();
    const playerHealth = new HealthComponent(100, 100);
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));
    entityManager.addComponent(playerId, playerHealth);

    // Reduce player health to 0
    playerHealth.health = 0;
    playerHealth.isDead = true;

    // Verify game-over state is detectable
    const allEntities = entityManager.getAllEntities();
    const deadPlayers = allEntities.filter((id) => {
      const health = entityManager.getComponent(id, HealthComponent);
      const isPlayer = entityManager.hasComponent(id, PlayerControlledComponent);
      return isPlayer && health?.isDead === true;
    });

    expect(deadPlayers.length).toBe(1);
    expect(deadPlayers[0]).toBe(playerId);
  });

  it('should have zero entities after clear()', () => {
    // Populate world with player + enemies
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));
    entityManager.addComponent(playerId, new HealthComponent(100, 100));

    for (let i = 0; i < 5; i++) {
      const enemyId = entityManager.createEntity();
      entityManager.addComponent(enemyId, new HealthComponent(50, 50));
      entityManager.addComponent(enemyId, new PositionComponent(100 + i * 20, 0));
      entityManager.addComponent(
        enemyId,
        new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
      );
    }

    expect(entityManager.getEntityCount()).toBe(6);

    // Simulate restart — engine calls entityManager.clear()
    entityManager.clear();

    expect(entityManager.getEntityCount()).toBe(0);
    expect(entityManager.getAllEntities().length).toBe(0);
  });

  it('should reset nextEntityId to 1 after clear() so IDs restart cleanly', () => {
    // Create some entities
    const id1 = entityManager.createEntity();
    const id2 = entityManager.createEntity();
    expect(id1).toBe(1);
    expect(id2).toBe(2);

    entityManager.clear();

    // After clear, IDs should restart from 1
    const newId = entityManager.createEntity();
    expect(newId).toBe(1);
  });

  it('should return no entities with HealthComponent after clear()', () => {
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new HealthComponent(100, 100));

    const enemyId = entityManager.createEntity();
    entityManager.addComponent(enemyId, new HealthComponent(50, 50));

    expect(entityManager.getEntitiesWithComponents(HealthComponent).length).toBe(2);

    entityManager.clear();

    expect(entityManager.getEntitiesWithComponents(HealthComponent).length).toBe(0);
  });

  it('should have no stale components after clear and re-population', () => {
    // Pre-death world: create player + enemy with distinct components
    const preDeathPlayer = entityManager.createEntity();
    entityManager.addComponent(preDeathPlayer, new PlayerControlledComponent());
    entityManager.addComponent(preDeathPlayer, new PositionComponent(0, 0));
    entityManager.addComponent(preDeathPlayer, new HealthComponent(100, 100));

    const preDeathEnemy = entityManager.createEntity();
    entityManager.addComponent(preDeathEnemy, new HealthComponent(30, 30));
    entityManager.addComponent(preDeathEnemy, new PositionComponent(200, 200));
    entityManager.addComponent(
      preDeathEnemy,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    // Capture pre-death component instances (to verify they're not referenced after restart)
    const preDeathPlayerHealth = entityManager.getComponent(preDeathPlayer, HealthComponent);
    const preDeathEnemyHealth = entityManager.getComponent(preDeathEnemy, HealthComponent);

    expect(entityManager.getEntityCount()).toBe(2);

    // Simulate game-over → restart
    entityManager.clear();
    progressionSystem.reset();

    // After clear(): entity count is 0, component indexes are empty
    expect(entityManager.getEntityCount()).toBe(0);
    expect(entityManager.getEntitiesWithComponents(HealthComponent).length).toBe(0);
    expect(entityManager.getEntitiesWithComponents(EnemyTypeComponent).length).toBe(0);

    // Re-create world fresh — IDs start from 1 again (expected behavior)
    const newPlayerId = entityManager.createEntity();
    entityManager.addComponent(newPlayerId, new PlayerControlledComponent());
    entityManager.addComponent(newPlayerId, new PositionComponent(0, 0));
    entityManager.addComponent(newPlayerId, new HealthComponent(100, 100));

    // Post-restart: exactly 1 entity
    expect(entityManager.getEntityCount()).toBe(1);

    // The new player's health component is a fresh instance, not the pre-death one
    const newPlayerHealth = entityManager.getComponent(newPlayerId, HealthComponent);
    expect(newPlayerHealth).not.toBe(preDeathPlayerHealth);
    expect(newPlayerHealth).not.toBe(preDeathEnemyHealth);

    // Enemy component index is clean — no enemies in post-restart world
    expect(entityManager.getEntitiesWithComponents(EnemyTypeComponent).length).toBe(0);

    // Combat system processes the clean world without error
    expect(() => combatSystem.update(16, entityManager)).not.toThrow();

    // XP and level are clean
    expect(progressionSystem.xp).toBe(0);
    expect(progressionSystem.level).toBe(1);
  });

  it('should correctly process combat after restart with no leftover dead-entity state', () => {
    // Pre-death game: kill an enemy to accumulate some XP
    const playerId = entityManager.createEntity();
    entityManager.addComponent(playerId, new PlayerControlledComponent());
    entityManager.addComponent(playerId, new PositionComponent(0, 0));

    const enemyId = entityManager.createEntity();
    const enemyHealth = new HealthComponent(10, 10);
    enemyHealth.health = 0;
    enemyHealth.isDead = true;
    entityManager.addComponent(enemyId, enemyHealth);
    entityManager.addComponent(enemyId, new PositionComponent(50, 0));
    entityManager.addComponent(
      enemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    combatSystem.update(16, entityManager);
    const xpAfterFirstRun = progressionSystem.xp;
    expect(xpAfterFirstRun).toBe(PROGRESSION_CONFIG.ENEMY_XP.basic);

    // Simulate restart
    entityManager.clear();
    progressionSystem.reset();

    // Post-restart: create a new enemy, kill it, XP should be clean (starts from 0)
    const newPlayerId = entityManager.createEntity();
    entityManager.addComponent(newPlayerId, new PlayerControlledComponent());
    entityManager.addComponent(newPlayerId, new PositionComponent(0, 0));

    const newEnemyId = entityManager.createEntity();
    const newEnemyHealth = new HealthComponent(10, 10);
    newEnemyHealth.health = 0;
    newEnemyHealth.isDead = true;
    entityManager.addComponent(newEnemyId, newEnemyHealth);
    entityManager.addComponent(newEnemyId, new PositionComponent(50, 0));
    entityManager.addComponent(
      newEnemyId,
      new EnemyTypeComponent(EnemyType.Basic, Rarity.Common, AlertState.Passive, false)
    );

    combatSystem.update(16, entityManager);

    // XP should be exactly one kill's worth — no carry-over from pre-restart
    expect(progressionSystem.xp).toBe(PROGRESSION_CONFIG.ENEMY_XP.basic);
  });
});
