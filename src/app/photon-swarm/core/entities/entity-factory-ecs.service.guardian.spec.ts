import { TestBed } from '@angular/core/testing';
import { EntityFactoryECSService } from './entity-factory-ecs.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { RandomService } from '../utils/random.service';
import { ObjectPoolService } from '../utils/object-pool.service';
import { ProgressionSystemService } from '../progression/progression-system.service';
import { PlayerService } from '../player/player.service';
import { ThemeService } from '@services/theme.service';
import { EnemyHealthRegenSystemService } from '../systems/enemy-ai/enemy-health-regen-system.service';
import { BehaviorPattern } from '@photon/components/ai-controlled.component';
import {
  AIControlledComponent,
  DamageComponent,
  EnemyTypeComponent,
  HealthComponent,
  PositionComponent,
  TerritorialGuardianComponent,
} from '@photon/components';
import { GUARDIAN_DEFINITIONS } from '@photon/config/constants/world/zone.config';
import { ENEMY_STATS } from '@photon/config/constants/enemy/enemy-stats.config';

describe('EntityFactoryECSService — createGuardian', () => {
  let service: EntityFactoryECSService;
  let entityManager: EntityManagerService;

  beforeEach(() => {
    const progressionSpy = jasmine.createSpyObj('ProgressionSystemService', ['getLevelModifier'], {
      level: 1, // level 1 → levelMultiplier = 1.0
    });
    const playerSpy = jasmine.createSpyObj('PlayerService', [
      'activateSpawnProtection',
      'deactivateInvincibility',
      'isParryAvailable',
    ]);
    playerSpy.isParryAvailable.and.returnValue(false);
    progressionSpy.getLevelModifier.and.returnValue(1);

    TestBed.configureTestingModule({
      providers: [
        EntityFactoryECSService,
        EntityManagerService,
        RandomService,
        ObjectPoolService,
        { provide: ProgressionSystemService, useValue: progressionSpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: ThemeService, useValue: { isDayMode: false } },
      ],
    });

    service = TestBed.inject(EntityFactoryECSService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  // ---------------------------------------------------------------------------
  // Test 1: required components
  // ---------------------------------------------------------------------------
  it('should attach all required components to a guardian entity', () => {
    const def = GUARDIAN_DEFINITIONS[0]; // Guardian 1 — tank, Zone 1
    const entityId = service.createGuardian(def);

    expect(entityManager.hasComponent(entityId, PositionComponent)).toBeTruthy();
    expect(entityManager.hasComponent(entityId, HealthComponent)).toBeTruthy();
    expect(entityManager.hasComponent(entityId, DamageComponent)).toBeTruthy();
    expect(entityManager.hasComponent(entityId, AIControlledComponent)).toBeTruthy();
    expect(entityManager.hasComponent(entityId, EnemyTypeComponent)).toBeTruthy();
    expect(entityManager.hasComponent(entityId, TerritorialGuardianComponent)).toBeTruthy();

    const ai = entityManager.getComponent(entityId, AIControlledComponent);
    expect(ai?.behaviorPattern).toBe(BehaviorPattern.TerritorialGuardian);
  });

  // ---------------------------------------------------------------------------
  // Test 2: TerritorialGuardianComponent fields match the definition
  // ---------------------------------------------------------------------------
  it('should set TerritorialGuardianComponent fields from the definition', () => {
    const def = GUARDIAN_DEFINITIONS[0]; // Guardian 1
    const entityId = service.createGuardian(def);

    const guardian = entityManager.getComponent(entityId, TerritorialGuardianComponent);
    expect(guardian).toBeTruthy();
    expect(guardian!.homeX).toBe(def.homeX);
    expect(guardian!.homeY).toBe(def.homeY);
    expect(guardian!.leashRadius).toBe(def.leashRadius);
    expect(guardian!.aggroRadius).toBe(def.aggroRadius);
    expect(guardian!.guardedTreasureCacheId).toBe(def.guardedCacheId);
    expect(guardian!.zoneId).toBe(def.zoneId);
    expect(guardian!.rankTier).toBe(def.rankTier);
  });

  // ---------------------------------------------------------------------------
  // Test 3: Guardian 1 (tank, Zone 1, healthMult 5.0) has ~1200 HP at level 1
  //
  // Math at level 1, normal difficulty, player in no zone (zoneMultiplier = 1.0):
  //   combinedMultiplier = zoneMult(1.0) * champion(1) * elite(2) * rarity_rare(1.5) * level(1.0) * momentum(1.0) = 3.0
  //   baseEnemy HP = 80 (ENEMY_STATS.tank.HEALTH) × 3.0 × diffMod(1.0) = 240
  //   guardian HP  = Math.round(240 × 5.0) = 1200
  // ---------------------------------------------------------------------------
  it('should give Guardian 1 (tank, healthMult 5.0) exactly 1200 HP at level 1', () => {
    const def = GUARDIAN_DEFINITIONS[0]; // Guardian 1
    expect(def.guardianId).toBe(1);
    expect(def.enemyType).toBe('tank');
    expect(def.healthMultiplier).toBe(5.0);

    const entityId = service.createGuardian(def);
    const health = entityManager.getComponent(entityId, HealthComponent);

    // base tank = 80, combinedMult = 3.0, healthMult = 5.0
    const expectedHP = Math.round(ENEMY_STATS.tank.HEALTH * 3.0 * def.healthMultiplier);
    expect(health?.maxHealth).toBe(expectedHP);
    expect(health?.health).toBe(expectedHP);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Guardian 12 (tank, Zone 4, healthMult 12.0) — zoneMult is player-position-based
  //
  // NOTE: ZoneStateService.getCurrentZone() returns the PLAYER'S current zone, not
  // the guardian's spawn zone. In this test environment the player position is not
  // set, so getCurrentZone() returns null → zoneMultiplier = 1.0.
  //
  // Math: 80 × (1.0 × 1 × 2 × 1.5 × 1.0 × 1.0) × 12 = 80 × 3 × 12 = 2880
  // This documents current behavior. To test Zone 4 difficulty scaling you would
  // need to prime ZoneStateService with the player's zone before calling createGuardian.
  // ---------------------------------------------------------------------------
  it('should give Guardian 12 (tank, healthMult 12.0) 2880 HP with zoneMultiplier = 1.0 in test env', () => {
    const def = GUARDIAN_DEFINITIONS.find((d) => d.guardianId === 12)!;
    expect(def).toBeTruthy();
    expect(def.enemyType).toBe('tank');
    expect(def.healthMultiplier).toBe(12.0);

    const entityId = service.createGuardian(def);
    const health = entityManager.getComponent(entityId, HealthComponent);

    // zone player is in = null → zoneMultiplier = 1.0 (not Zone 4's 2.2)
    const expectedHP = Math.round(ENEMY_STATS.tank.HEALTH * 3.0 * def.healthMultiplier);
    // 80 * 3 * 12 = 2880 — within the 15 000 cap
    expect(health?.maxHealth).toBe(expectedHP);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Damage multiplier is applied on top of base damage
  //
  // Math: tank base damage = 20, combinedMult = 3.0 → createEnemy damage = 60
  //       Guardian 1 damageMult = 2.5 → 60 × 2.5 = 150
  // ---------------------------------------------------------------------------
  it('should apply the guardian damage multiplier on top of base enemy damage', () => {
    const def = GUARDIAN_DEFINITIONS[0]; // Guardian 1, damageMult = 2.5
    const entityId = service.createGuardian(def);
    const damage = entityManager.getComponent(entityId, DamageComponent);

    const expectedDamage = ENEMY_STATS.tank.DAMAGE * 3.0 * def.damageMultiplier; // 20 * 3.0 * 2.5 = 150
    expect(damage?.contactDamage).toBe(expectedDamage);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Position override — guardian spawns at homeX/homeY
  // ---------------------------------------------------------------------------
  it('should place the guardian at def.homeX, def.homeY after position override', () => {
    const def = GUARDIAN_DEFINITIONS[0]; // homeX=2000, homeY=1500
    const entityId = service.createGuardian(def);
    const pos = entityManager.getComponent(entityId, PositionComponent);

    expect(pos?.x).toBe(def.homeX);
    expect(pos?.y).toBe(def.homeY);
  });

  // ---------------------------------------------------------------------------
  // Test 7: Regen tracker re-seed — initializeTracking called with boosted HP (1200)
  //
  // createEnemy calls initializeTracking(entityId, 240) internally.
  // createGuardian MUST then call initializeTracking(entityId, 1200) so the regen
  // system does not treat the HP boost as a heal event.
  // ---------------------------------------------------------------------------
  it('should re-seed regen tracking with the boosted health value after applying healthMultiplier', () => {
    const def = GUARDIAN_DEFINITIONS[0]; // Guardian 1 → 1200 HP
    const regenSystem = TestBed.inject(EnemyHealthRegenSystemService);

    spyOn(regenSystem, 'initializeTracking').and.callThrough();

    const entityId = service.createGuardian(def);
    const health = entityManager.getComponent(entityId, HealthComponent);
    const boostedHP = health!.maxHealth; // 1200

    const calls = (regenSystem.initializeTracking as jasmine.Spy).calls.all();
    const callsForEntity = calls.filter((c) => c.args[0] === entityId);

    // Must have been called at least twice for this entity:
    //   1st call: from createEnemy (base HP = 240)
    //   2nd call: from createGuardian (boosted HP = 1200)
    expect(callsForEntity.length).toBeGreaterThanOrEqual(2);

    // The LAST call for this entity must use the boosted HP
    const lastCall = callsForEntity[callsForEntity.length - 1];
    expect(lastCall.args[0]).toBe(entityId);
    expect(lastCall.args[1]).toBe(boostedHP);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Multiple guardians get unique entity IDs and correct zone assignments
  // ---------------------------------------------------------------------------
  it('should create unique entity IDs for each guardian and attach correct zone data', () => {
    const def1 = GUARDIAN_DEFINITIONS[0]; // Guardian 1, zoneId=1
    const def2 = GUARDIAN_DEFINITIONS[1]; // Guardian 2, zoneId=1

    const entityId1 = service.createGuardian(def1);
    const entityId2 = service.createGuardian(def2);

    expect(entityId1).not.toBe(entityId2);

    const guardian1 = entityManager.getComponent(entityId1, TerritorialGuardianComponent);
    const guardian2 = entityManager.getComponent(entityId2, TerritorialGuardianComponent);

    expect(guardian1?.zoneId).toBe(def1.zoneId);
    expect(guardian2?.zoneId).toBe(def2.zoneId);
  });

  // ---------------------------------------------------------------------------
  // Test 9: Guardian 2 (thug, healthMult 5.5, damageMult 2.8)
  //
  // Math: thug base HP=75, DMG=25, combinedMult=3.0
  //   HP   = Math.round(75 × 3.0 × 5.5) = Math.round(1237.5) = 1238
  //   DMG  = 25 × 3.0 × 2.8 = 210
  // ---------------------------------------------------------------------------
  it('should give Guardian 2 (thug, healthMult 5.5) correct HP and damage', () => {
    const def = GUARDIAN_DEFINITIONS.find((d) => d.guardianId === 2)!;
    expect(def).toBeTruthy();
    expect(def.enemyType).toBe('thug');
    expect(def.healthMultiplier).toBe(5.5);
    expect(def.damageMultiplier).toBe(2.8);

    const entityId = service.createGuardian(def);
    const health = entityManager.getComponent(entityId, HealthComponent);
    const damage = entityManager.getComponent(entityId, DamageComponent);

    const expectedHP = Math.round(ENEMY_STATS.thug.HEALTH * 3.0 * def.healthMultiplier);
    // 75 * 3.0 * 5.5 = 1237.5 → Math.round → 1238
    expect(health?.maxHealth).toBe(expectedHP);

    const expectedDamage = ENEMY_STATS.thug.DAMAGE * 3.0 * def.damageMultiplier;
    // 25 * 3.0 * 2.8 = 210
    expect(damage?.contactDamage).toBe(expectedDamage);
  });

  // ---------------------------------------------------------------------------
  // Test 10: Guardian 13 (sentinel, Zone 1, healthMult 6.0, damageMult 3.0)
  //
  // Added for Zone 1 content parity — a sentinel variant alongside the tank and thug.
  //
  // Math: sentinel base HP=65, DMG=18, combinedMult=3.0
  //   HP   = Math.round(65 × 3.0 × 6.0) = 1170
  //   DMG  = 18 × 3.0 × 3.0 = 162
  // ---------------------------------------------------------------------------
  it('should give Guardian 13 (sentinel, healthMult 6.0) correct HP and damage', () => {
    const def = GUARDIAN_DEFINITIONS.find((d) => d.guardianId === 13)!;
    expect(def).toBeTruthy();
    expect(def.enemyType).toBe('sentinel');
    expect(def.zoneId).toBe(1);
    expect(def.healthMultiplier).toBe(6.0);
    expect(def.damageMultiplier).toBe(3.0);

    const entityId = service.createGuardian(def);
    const health = entityManager.getComponent(entityId, HealthComponent);
    const damage = entityManager.getComponent(entityId, DamageComponent);

    const expectedHP = Math.round(ENEMY_STATS.sentinel.HEALTH * 3.0 * def.healthMultiplier);
    // 65 * 3.0 * 6.0 = 1170
    expect(health?.maxHealth).toBe(expectedHP);

    const expectedDamage = ENEMY_STATS.sentinel.DAMAGE * 3.0 * def.damageMultiplier;
    // 18 * 3.0 * 3.0 = 162
    expect(damage?.contactDamage).toBe(expectedDamage);
  });
});
