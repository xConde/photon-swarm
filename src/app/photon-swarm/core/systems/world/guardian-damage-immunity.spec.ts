/**
 * Guardian Damage Immunity — Regression spec
 *
 * Motivation: guardians were being one-shot by the NPC elite thug CLAW_SLAM ability
 * (and by other non-player damage sources) because the immunity guard was missing.
 * This spec pins each of the 5 immunity checks so they can never regress silently.
 *
 * Strategy: mock-based focused tests. Each describe block wires up a minimal
 * EntityManager spy with 2 entities (guardian ID=100, regular enemy ID=200),
 * calls the relevant public method, and asserts the guardian's health/components
 * are unchanged while the regular enemy was affected.
 */

import { TestBed } from '@angular/core/testing';
import { Component, ComponentType, EntityManager } from '../../ecs/ecs.model';
import { NpcAbilitySystemService } from '../enemy-ai/npc-ability-system.service';
import { FallingAsteroidSystemService } from '../gameplay/falling-asteroid-system.service';
import { BurnSystemService } from '../combat/burn-system.service';
import { NPCFactionBattleSystemService } from '../enemy-ai/npc-faction-battle-system.service';
import { EnemyHealthRegenSystemService } from '../enemy-ai/enemy-health-regen-system.service';
import { BorderConflictSystemService, FourKingsTerritoryService, TerritoryStrengthSystemService } from '../territory';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { GameStateService } from '../../state/game-state.service';
import { SettingsService } from '../../utils/settings.service';
import { BuffManagementSystemService } from '../gameplay/buff-management-system.service';
import { BuffSystemService } from '../../progression/buff-system.service';
import { AudioService } from '../../audio/audio.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { ThemeService } from '@services/theme.service';
import {
  AIControlledComponent,
  BurnEffectComponent,
  EnemyTypeComponent,
  FactionComponent,
  HealthBarDisplayComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  TerritorialGuardianComponent,
} from '@photon/components';
import { AsteroidState, FallingAsteroidComponent } from '@photon/components/falling-asteroid.component';

// ---------------------------------------------------------------------------
// Shared helper — same pattern used by npc-faction-battle-system.service.spec.ts
// ---------------------------------------------------------------------------
function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  return (
    componentType === componentClass ||
    (typeof componentType === 'function' &&
      typeof componentClass === 'function' &&
      (componentType as { name: string }).name === (componentClass as { name: string }).name)
  );
}

// ---------------------------------------------------------------------------
// Entity ID constants
// ---------------------------------------------------------------------------
const GUARDIAN_ID = 100;
const REGULAR_ENEMY_ID = 200;
const CLAW_SLAM_ATTACKER_ID = 300;

// ---------------------------------------------------------------------------
// describe block
// ---------------------------------------------------------------------------
describe('Guardian damage immunity', () => {
  // -------------------------------------------------------------------------
  // 1. NpcAbilitySystemService — claw slam
  // -------------------------------------------------------------------------
  describe('NpcAbilitySystemService — claw slam immunity', () => {
    let service: NpcAbilitySystemService;
    let mockEntityManager: jasmine.SpyObj<EntityManager>;

    beforeEach(() => {
      const mockDebugLog = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);
      const mockEntityFactory = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', [
        'isEntityActive',
      ]);
      const mockEffectFactory = jasmine.createSpyObj<EffectFactoryService>('EffectFactoryService', [
        'createAbilityEffect',
        'createSlamEffect',
        'createNpcDamageNumber',
        'createDamageNumber',
      ]);
      const mockGameState = jasmine.createSpyObj<GameStateService>('GameStateService', ['takeDamage']);

      mockEntityManager = jasmine.createSpyObj<EntityManager>('EntityManager', [
        'getEntitiesWithComponents',
        'getComponent',
        'hasComponent',
        'addComponent',
        'removeComponent',
        'hasEntity',
        'createEntity',
        'destroyEntity',
        'getComponents',
      ]);

      TestBed.configureTestingModule({
        providers: [
          NpcAbilitySystemService,
          { provide: DebugLogBridgeService, useValue: mockDebugLog },
          { provide: EntityFactoryECSService, useValue: mockEntityFactory },
          { provide: EffectFactoryService, useValue: mockEffectFactory },
          { provide: GameStateService, useValue: mockGameState },
        ],
      });

      service = TestBed.inject(NpcAbilitySystemService);
    });

    it('should NOT set health to 0 on a guardian when claw slam fires', () => {
      // Invoke executeClawSlam directly (private) — same pattern used in npc-faction-battle spec
      // for updateNPCTargeting. This bypasses the 500ms telegraph delay and tests only the
      // immunity guard that was missing in the original production bug.
      const attackerPos = new PositionComponent(0, 0);

      // Guardian and regular enemy both within CLAW_SLAM range (150 units)
      const guardianHealth = new HealthComponent(500, 500);
      const guardianPos = new PositionComponent(50, 0);
      const regularHealth = new HealthComponent(100, 100);
      const regularPos = new PositionComponent(60, 0);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, PlayerControlledComponent))) return [];
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [GUARDIAN_ID, REGULAR_ENEMY_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === GUARDIAN_ID) {
            if (isComponentType(type, PositionComponent)) return guardianPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return guardianHealth as unknown as T;
          }
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, PositionComponent)) return regularPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return regularHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return entity === GUARDIAN_ID;
        return false;
      });

      // Call executeClawSlam directly — tests the immunity guard in isolation
      service['executeClawSlam'](CLAW_SLAM_ATTACKER_ID, attackerPos, mockEntityManager);

      // Guardian must be unharmed
      expect(guardianHealth.health).toBe(500);
    });

    it('should kill the regular enemy that is in claw slam range', () => {
      // Same direct invocation — confirms the non-guardian path still deals damage
      const attackerPos = new PositionComponent(0, 0);
      const regularHealth = new HealthComponent(100, 100);
      const regularPos = new PositionComponent(60, 0);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, PlayerControlledComponent))) return [];
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [REGULAR_ENEMY_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, PositionComponent)) return regularPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return regularHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((_entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return false; // no guardian
        return false;
      });

      service['executeClawSlam'](CLAW_SLAM_ATTACKER_ID, attackerPos, mockEntityManager);

      // Regular enemy IS killed
      expect(regularHealth.health).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. FallingAsteroidSystemService — asteroid impact radius
  // -------------------------------------------------------------------------
  describe('FallingAsteroidSystemService — impact radius immunity', () => {
    let service: FallingAsteroidSystemService;
    let mockEntityManager: jasmine.SpyObj<EntityManager>;

    beforeEach(() => {
      const mockBuffMgmt = jasmine.createSpyObj<BuffManagementSystemService>('BuffManagementSystemService', [
        'applyBuff',
      ]);
      const mockGameState = jasmine.createSpyObj<GameStateService>('GameStateService', ['takeDamage']);
      const mockSettings = jasmine.createSpyObj<SettingsService>('SettingsService', ['getSettings']);
      const mockBuffSystem = jasmine.createSpyObj<BuffSystemService>('BuffSystemService', ['applyBuff']);
      const mockAudio = jasmine.createSpyObj<AudioService>('AudioService', ['playPowerupCollect']);

      mockSettings.getSettings.and.returnValue({
        volume: 0,
        screenShake: false,
        showDamageNumbers: false,
        chromaticAberration: false,
        lowHealthVignette: false,
        colorblindMode: 'none',
        sensitivity: 100,
      });

      mockEntityManager = jasmine.createSpyObj<EntityManager>('EntityManager', [
        'getEntitiesWithComponents',
        'getComponent',
        'hasComponent',
        'addComponent',
        'removeComponent',
        'hasEntity',
        'createEntity',
        'destroyEntity',
        'getComponents',
      ]);

      TestBed.configureTestingModule({
        providers: [
          FallingAsteroidSystemService,
          { provide: BuffManagementSystemService, useValue: mockBuffMgmt },
          { provide: GameStateService, useValue: mockGameState },
          { provide: SettingsService, useValue: mockSettings },
          { provide: BuffSystemService, useValue: mockBuffSystem },
          { provide: AudioService, useValue: mockAudio },
        ],
      });

      service = TestBed.inject(FallingAsteroidSystemService);
    });

    afterEach(() => {
      service.destroy?.();
    });

    it('should NOT zero out guardian health on asteroid impact', () => {
      // Build an asteroid component already at FALLING phase, progress=1 (about to impact)
      // We call dealImpactDamage directly via the private method path using a FALLING→IMPACT
      // transition.  Easiest: call the private dealImpactDamage directly.
      const asteroidPos = new PositionComponent(0, 0);

      // Both entities well within the 150-unit default impact radius
      const guardianHealth = new HealthComponent(500, 500);
      const guardianPos = new PositionComponent(30, 0);

      const regularHealth = new HealthComponent(100, 100);
      const regularPos = new PositionComponent(40, 0);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === 999) {
            // asteroid entity
            if (isComponentType(type, PositionComponent)) return asteroidPos as unknown as T;
          }
          if (entity === GUARDIAN_ID) {
            if (isComponentType(type, PositionComponent)) return guardianPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return guardianHealth as unknown as T;
          }
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, PositionComponent)) return regularPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return regularHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [GUARDIAN_ID, REGULAR_ENEMY_ID];
        }
        if (components.some((c) => isComponentType(c, PlayerControlledComponent))) {
          return [];
        }
        return [];
      });

      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return entity === GUARDIAN_ID;
        return false;
      });

      // Build a minimal FallingAsteroidComponent for dealImpactDamage
      const asteroidComp = new FallingAsteroidComponent(
        AsteroidState.IMPACT,
        Date.now(),
        Date.now(),
        Date.now(),
        0,
        0,
        1000,
        150, // impactRadius — both entities are inside this
        40,
        40,
        80,
        80,
        'speed',
        10000,
        1.5,
        false
      );

      // Invoke the private method directly
      service['playerEntity'] = null; // ensure no player damage path
      service['dealImpactDamage'](999, asteroidComp, mockEntityManager);

      // Guardian health unchanged
      expect(guardianHealth.health).toBe(500);
      // Regular enemy zeroed out
      expect(regularHealth.health).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3. BurnSystemService — burn spread
  // -------------------------------------------------------------------------
  describe('BurnSystemService — burn spread immunity', () => {
    let service: BurnSystemService;
    let mockEntityManager: jasmine.SpyObj<EntityManager>;

    beforeEach(() => {
      const mockDebugLog = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);
      const mockEffectFactory = jasmine.createSpyObj<EffectFactoryService>('EffectFactoryService', [
        'createDamageNumber',
      ]);
      const mockSettings = jasmine.createSpyObj<SettingsService>('SettingsService', ['getSettings']);

      mockSettings.getSettings.and.returnValue({
        volume: 0,
        screenShake: false,
        showDamageNumbers: false,
        chromaticAberration: false,
        lowHealthVignette: false,
        colorblindMode: 'none',
        sensitivity: 100,
      });

      mockEntityManager = jasmine.createSpyObj<EntityManager>('EntityManager', [
        'getEntitiesWithComponents',
        'getComponent',
        'hasComponent',
        'addComponent',
        'removeComponent',
        'hasEntity',
        'createEntity',
        'destroyEntity',
        'getComponents',
      ]);

      TestBed.configureTestingModule({
        providers: [
          BurnSystemService,
          { provide: DebugLogBridgeService, useValue: mockDebugLog },
          { provide: EffectFactoryService, useValue: mockEffectFactory },
          { provide: SettingsService, useValue: mockSettings },
        ],
      });

      service = TestBed.inject(BurnSystemService);
    });

    afterEach(() => {
      service.reset();
    });

    it('should NOT call addComponent(BurnEffectComponent) on a guardian during burn spread', () => {
      service.enableBurnSpread();
      // Force spread to always trigger
      service.setBurnSpreadChance(1.0);

      // Source entity (REGULAR_ENEMY_ID) has a burn that can spread
      const now = Date.now();
      const sourceBurn = new BurnEffectComponent(5, 999999, now, now - 500, 1.0, true);
      const sourceHealth = new HealthComponent(100, 100);
      const sourcePos = new PositionComponent(0, 0);

      // Guardian is close enough to be a spread candidate
      const guardianHealth = new HealthComponent(500, 500);
      const guardianPos = new PositionComponent(10, 0);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, BurnEffectComponent))) {
          return [REGULAR_ENEMY_ID]; // only the source is burning
        }
        if (components.some((c) => isComponentType(c, HealthComponent))) {
          return [REGULAR_ENEMY_ID, GUARDIAN_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, BurnEffectComponent)) return sourceBurn as unknown as T;
            if (isComponentType(type, HealthComponent)) return sourceHealth as unknown as T;
            if (isComponentType(type, PositionComponent)) return sourcePos as unknown as T;
            if (isComponentType(type, RenderableComponent)) return undefined; // no renderable → skips combat-ready check
          }
          if (entity === GUARDIAN_ID) {
            if (isComponentType(type, HealthComponent)) return guardianHealth as unknown as T;
            if (isComponentType(type, PositionComponent)) return guardianPos as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return entity === GUARDIAN_ID;
        if (isComponentType(type, BurnEffectComponent)) return false; // neither is burning yet except source
        return false;
      });

      service.update(16, mockEntityManager);

      // addComponent should never have been called with the guardian ID
      const addCalls = mockEntityManager.addComponent.calls.all();
      const guardianWasTargeted = addCalls.some(
        (call) => call.args[0] === GUARDIAN_ID && isComponentType(call.args[1], BurnEffectComponent)
      );
      expect(guardianWasTargeted).toBeFalse();
    });

    it('should still add BurnEffectComponent to a non-guardian target during spread', () => {
      service.enableBurnSpread();
      service.setBurnSpreadChance(1.0);

      const now = Date.now();
      const sourceBurn = new BurnEffectComponent(5, 999999, now, now - 500, 1.0, true);
      const sourceHealth = new HealthComponent(100, 100);
      const sourcePos = new PositionComponent(0, 0);

      const otherEnemyHealth = new HealthComponent(100, 100);
      const otherEnemyPos = new PositionComponent(10, 0);
      const OTHER_ENEMY_ID = 500;

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, BurnEffectComponent))) {
          return [REGULAR_ENEMY_ID];
        }
        if (components.some((c) => isComponentType(c, HealthComponent))) {
          return [REGULAR_ENEMY_ID, OTHER_ENEMY_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, BurnEffectComponent)) return sourceBurn as unknown as T;
            if (isComponentType(type, HealthComponent)) return sourceHealth as unknown as T;
            if (isComponentType(type, PositionComponent)) return sourcePos as unknown as T;
          }
          if (entity === OTHER_ENEMY_ID) {
            if (isComponentType(type, HealthComponent)) return otherEnemyHealth as unknown as T;
            if (isComponentType(type, PositionComponent)) return otherEnemyPos as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((_entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return false; // no guardian here
        if (isComponentType(type, BurnEffectComponent)) return false;
        return false;
      });

      service.update(16, mockEntityManager);

      const addCalls = mockEntityManager.addComponent.calls.all();
      const otherEnemyWasBurned = addCalls.some(
        (call) => call.args[0] === OTHER_ENEMY_ID && call.args[1] instanceof BurnEffectComponent
      );
      expect(otherEnemyWasBurned).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // 4. NPCFactionBattleSystemService — target acquisition
  // -------------------------------------------------------------------------
  describe('NPCFactionBattleSystemService — guardian not targeted', () => {
    let service: NPCFactionBattleSystemService;
    let mockEntityManager: jasmine.SpyObj<EntityManager>;

    beforeEach(() => {
      const mockFourKings = jasmine.createSpyObj<FourKingsTerritoryService>('FourKingsTerritoryService', [
        'getTerritoryAtPosition',
        'worldToGrid',
      ]);
      const mockBorderConflict = jasmine.createSpyObj<BorderConflictSystemService>('BorderConflictSystemService', [
        'isInConflictZone',
        'getConflictingFactions',
        'getSpawnMultiplier',
        'boostConflictIntensity',
      ]);
      const mockTerritoryStrength = jasmine.createSpyObj<TerritoryStrengthSystemService>(
        'TerritoryStrengthSystemService',
        ['weakenTilesFromKill']
      );
      const mockEntityFactory = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', [
        'isEntityActive',
      ]);
      const mockDebugLog = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);
      const mockEffectFactory = jasmine.createSpyObj<EffectFactoryService>('EffectFactoryService', [
        'createNpcDamageNumber',
        'createNpcClashSparks',
        'createNpcDeathEffect',
      ]);
      const mockTheme = jasmine.createSpyObj<ThemeService>('ThemeService', [], { isDayMode: false });

      mockEntityManager = jasmine.createSpyObj<EntityManager>('EntityManager', [
        'getEntitiesWithComponents',
        'getComponent',
        'hasComponent',
        'addComponent',
        'removeComponent',
        'hasEntity',
        'createEntity',
        'destroyEntity',
        'getComponents',
      ]);

      TestBed.configureTestingModule({
        providers: [
          NPCFactionBattleSystemService,
          { provide: FourKingsTerritoryService, useValue: mockFourKings },
          { provide: BorderConflictSystemService, useValue: mockBorderConflict },
          { provide: TerritoryStrengthSystemService, useValue: mockTerritoryStrength },
          { provide: EntityFactoryECSService, useValue: mockEntityFactory },
          { provide: DebugLogBridgeService, useValue: mockDebugLog },
          { provide: EffectFactoryService, useValue: mockEffectFactory },
          { provide: ThemeService, useValue: mockTheme },
        ],
      });

      service = TestBed.inject(NPCFactionBattleSystemService);

      mockFourKings.getTerritoryAtPosition.and.returnValue(null);
      mockBorderConflict.isInConflictZone.and.returnValue(false);
      mockBorderConflict.getConflictingFactions.and.returnValue([]);
      mockEntityFactory.isEntityActive.and.returnValue(true);
    });

    afterEach(() => {
      service.destroy();
    });

    it('should never select a guardian as a faction battle target', () => {
      // NPC with faction 1 looking for targets
      const npcFaction = new FactionComponent(1);
      const npcPos = new PositionComponent(0, 0);
      const npcAI = new AIControlledComponent();

      // Guardian has faction 2 (enemy faction) but must be immune
      const guardianFaction = new FactionComponent(2);
      const guardianPos = new PositionComponent(50, 0); // within TARGET_ACQUISITION_RANGE
      const guardianHealth = new HealthComponent(500, 500);

      // Regular enemy has faction 2 — this one can be targeted
      const regularFaction = new FactionComponent(2);
      const regularPos = new PositionComponent(60, 0);
      const regularHealth = new HealthComponent(100, 100);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, FactionComponent)) &&
          components.some((c) => isComponentType(c, AIControlledComponent))
        ) {
          return [CLAW_SLAM_ATTACKER_ID]; // attacker NPC
        }
        if (
          components.some((c) => isComponentType(c, PositionComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [GUARDIAN_ID, REGULAR_ENEMY_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === CLAW_SLAM_ATTACKER_ID) {
            if (isComponentType(type, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(type, PositionComponent)) return npcPos as unknown as T;
            if (isComponentType(type, AIControlledComponent)) return npcAI as unknown as T;
          }
          if (entity === GUARDIAN_ID) {
            if (isComponentType(type, FactionComponent)) return guardianFaction as unknown as T;
            if (isComponentType(type, PositionComponent)) return guardianPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return guardianHealth as unknown as T;
          }
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, FactionComponent)) return regularFaction as unknown as T;
            if (isComponentType(type, PositionComponent)) return regularPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return regularHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return entity === GUARDIAN_ID;
        if (isComponentType(type, PlayerControlledComponent)) return false;
        return false;
      });

      // Call private method directly (same pattern as existing spec)
      service['updateNPCTargeting'](mockEntityManager, Date.now());

      const target = service.getTarget(CLAW_SLAM_ATTACKER_ID);

      // Guardian must never be selected as a target
      if (target) {
        expect(target.entityId).not.toBe(GUARDIAN_ID);
      }
      // The regular enemy may be selected (not asserting that here — just guardian must be excluded)
      expect(true).toBeTrue(); // spec passes if we reach this point without throwing
    });

    it('should select the regular enemy faction NPC as target when guardian is the only other option', () => {
      const npcFaction = new FactionComponent(1);
      const npcPos = new PositionComponent(0, 0);
      const npcAI = new AIControlledComponent();

      const guardianFaction = new FactionComponent(2);
      const guardianPos = new PositionComponent(50, 0);
      const guardianHealth = new HealthComponent(500, 500);

      const regularFaction = new FactionComponent(2);
      const regularPos = new PositionComponent(60, 0);
      const regularHealth = new HealthComponent(100, 100);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, FactionComponent))
        ) {
          return [CLAW_SLAM_ATTACKER_ID];
        }
        if (
          components.some((c) => isComponentType(c, PositionComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [GUARDIAN_ID, REGULAR_ENEMY_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === CLAW_SLAM_ATTACKER_ID) {
            if (isComponentType(type, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(type, PositionComponent)) return npcPos as unknown as T;
            if (isComponentType(type, AIControlledComponent)) return npcAI as unknown as T;
          }
          if (entity === GUARDIAN_ID) {
            if (isComponentType(type, FactionComponent)) return guardianFaction as unknown as T;
            if (isComponentType(type, PositionComponent)) return guardianPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return guardianHealth as unknown as T;
          }
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, FactionComponent)) return regularFaction as unknown as T;
            if (isComponentType(type, PositionComponent)) return regularPos as unknown as T;
            if (isComponentType(type, HealthComponent)) return regularHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return entity === GUARDIAN_ID;
        if (isComponentType(type, PlayerControlledComponent)) return false;
        return false;
      });

      service['updateNPCTargeting'](mockEntityManager, Date.now());

      const target = service.getTarget(CLAW_SLAM_ATTACKER_ID);
      expect(target).toBeDefined();
      expect(target?.entityId).toBe(REGULAR_ENEMY_ID);
    });
  });

  // -------------------------------------------------------------------------
  // 5. EnemyHealthRegenSystemService — guardian skipped, no HealthBarDisplay added
  // -------------------------------------------------------------------------
  describe('EnemyHealthRegenSystemService — guardian skipped in heal detection', () => {
    let service: EnemyHealthRegenSystemService;
    let mockEntityManager: jasmine.SpyObj<EntityManager>;

    beforeEach(() => {
      const mockEntityManagerService = jasmine.createSpyObj<EntityManagerService>('EntityManagerService', [
        'createEntity',
        'addComponent',
        'getComponent',
        'hasComponent',
        'hasEntity',
        'destroyEntity',
        'removeComponent',
        'getEntitiesWithComponents',
        'getComponents',
      ]);
      const mockDebugLog = jasmine.createSpyObj<DebugLogBridgeService>('DebugLogBridgeService', ['log']);
      const mockSettings = jasmine.createSpyObj<SettingsService>('SettingsService', ['getSettings']);

      mockSettings.getSettings.and.returnValue({
        volume: 0,
        screenShake: false,
        showDamageNumbers: false,
        chromaticAberration: false,
        lowHealthVignette: false,
        colorblindMode: 'none',
        sensitivity: 100,
      });

      mockEntityManager = jasmine.createSpyObj<EntityManager>('EntityManager', [
        'getEntitiesWithComponents',
        'getComponent',
        'hasComponent',
        'addComponent',
        'removeComponent',
        'hasEntity',
        'createEntity',
        'destroyEntity',
        'getComponents',
      ]);

      TestBed.configureTestingModule({
        providers: [
          EnemyHealthRegenSystemService,
          { provide: EntityManagerService, useValue: mockEntityManagerService },
          { provide: DebugLogBridgeService, useValue: mockDebugLog },
          { provide: SettingsService, useValue: mockSettings },
        ],
      });

      service = TestBed.inject(EnemyHealthRegenSystemService);
    });

    it('should NOT add HealthBarDisplayComponent to a guardian even when health diff is positive', () => {
      // Simulate a scenario where the guardian appears to have "healed" (max health boosted post-spawn)
      const guardianHealth = new HealthComponent(500, 500);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [GUARDIAN_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === GUARDIAN_ID && isComponentType(type, HealthComponent)) {
            return guardianHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return entity === GUARDIAN_ID;
        return false;
      });

      // First tick: seeds last health
      service.update(16, mockEntityManager);

      // Simulate a phantom heal by bumping guardian health upward
      guardianHealth.health = 600;
      guardianHealth.maxHealth = 600;

      // Second tick: should detect the diff but must NOT add HealthBarDisplayComponent
      service.update(16, mockEntityManager);

      const addCalls = mockEntityManager.addComponent.calls.all();
      const healthBarAdded = addCalls.some(
        (call) => call.args[0] === GUARDIAN_ID && call.args[1] instanceof HealthBarDisplayComponent
      );
      expect(healthBarAdded).toBeFalse();
    });

    it('should update lastHealthMap for guardian without triggering heal display', () => {
      const guardianHealth = new HealthComponent(500, 500);

      mockEntityManager.getEntitiesWithComponents.and.returnValue([GUARDIAN_ID]);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === GUARDIAN_ID && isComponentType(type, HealthComponent)) {
            return guardianHealth as unknown as T;
          }
          return undefined;
        }
      );
      mockEntityManager.hasComponent.and.callFake((entity: number, type: unknown): boolean => {
        return isComponentType(type, TerritorialGuardianComponent) && entity === GUARDIAN_ID;
      });

      service.update(16, mockEntityManager);

      // lastHealthMap should be set to initial value (500) without any visual side effects
      expect(service['lastHealthMap'].get(GUARDIAN_ID)).toBe(500);
      expect(mockEntityManager.addComponent).not.toHaveBeenCalled();
    });

    it('should still add HealthBarDisplayComponent for a non-guardian enemy that heals', () => {
      const regularHealth = new HealthComponent(100, 100);
      const regularPos = new PositionComponent(0, 0);
      const regularRenderable = new RenderableComponent('#ff0000', 'world', true, 1, 0);
      // Mark as combat ready by setting spawnTime far in the past
      regularRenderable['spawnTime'] = 0;

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (
          components.some((c) => isComponentType(c, EnemyTypeComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [REGULAR_ENEMY_ID];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, type: ComponentType<T>): T | undefined => {
          if (entity === REGULAR_ENEMY_ID) {
            if (isComponentType(type, HealthComponent)) return regularHealth as unknown as T;
            if (isComponentType(type, PositionComponent)) return regularPos as unknown as T;
            if (isComponentType(type, RenderableComponent)) return regularRenderable as unknown as T;
            if (isComponentType(type, HealthBarDisplayComponent)) return undefined;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((_entity: number, type: unknown): boolean => {
        if (isComponentType(type, TerritorialGuardianComponent)) return false;
        return false;
      });

      // First tick to seed health tracking
      service.update(16, mockEntityManager);

      // Enemy heals by 5 HP
      regularHealth.health = 105;

      // Second tick — should detect heal and add HealthBarDisplayComponent
      service.update(16, mockEntityManager);

      const addCalls = mockEntityManager.addComponent.calls.all();
      const healthBarAdded = addCalls.some(
        (call) => call.args[0] === REGULAR_ENEMY_ID && call.args[1] instanceof HealthBarDisplayComponent
      );
      expect(healthBarAdded).toBeTrue();
    });
  });
});
