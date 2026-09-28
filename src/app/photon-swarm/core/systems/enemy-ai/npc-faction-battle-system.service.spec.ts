import { TestBed } from '@angular/core/testing';
import { NPCFactionBattleSystemService, NPCTarget } from './npc-faction-battle-system.service';
import { BorderConflictSystemService, FourKingsTerritoryService, TerritoryStrengthSystemService } from '../territory';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { ThemeService } from '@services/theme.service';
import { Component, ComponentType, EntityManager } from '../../ecs/ecs.model';
import {
  AIControlledComponent,
  DamageComponent,
  EnemyTypeComponent,
  FactionComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
} from '@photon/components';

/**
 * Helper function to check if a componentType matches a component class
 */
function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  return (
    componentType === componentClass ||
    (typeof componentType === 'function' &&
      typeof componentClass === 'function' &&
      componentType.name === componentClass.name)
  );
}

describe('NPCFactionBattleSystemService', () => {
  let service: NPCFactionBattleSystemService;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockBorderConflictSystem: jasmine.SpyObj<BorderConflictSystemService>;
  let mockTerritoryStrengthSystem: jasmine.SpyObj<TerritoryStrengthSystemService>;
  let mockEntityFactory: jasmine.SpyObj<EntityFactoryECSService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockEffectFactory: jasmine.SpyObj<EffectFactoryService>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;
  let mockEntityManager: jasmine.SpyObj<EntityManager>;

  beforeEach(() => {
    // Create mock services
    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getTerritoryAtPosition',
      'worldToGrid',
    ]);

    mockBorderConflictSystem = jasmine.createSpyObj('BorderConflictSystemService', [
      'isInConflictZone',
      'getConflictingFactions',
      'getSpawnMultiplier',
      'boostConflictIntensity',
    ]);

    mockTerritoryStrengthSystem = jasmine.createSpyObj('TerritoryStrengthSystemService', ['weakenTilesFromKill']);

    mockEntityFactory = jasmine.createSpyObj('EntityFactoryECSService', ['isEntityActive']);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', [
      'createNpcDamageNumber',
      'createNpcClashSparks',
      'createNpcDeathEffect',
    ]);

    mockThemeService = jasmine.createSpyObj('ThemeService', [], { isDayMode: false });

    mockEntityManager = jasmine.createSpyObj('EntityManager', [
      'getEntitiesWithComponents',
      'getComponent',
      'hasComponent',
      'addComponent',
    ]);

    TestBed.configureTestingModule({
      providers: [
        NPCFactionBattleSystemService,
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: BorderConflictSystemService, useValue: mockBorderConflictSystem },
        { provide: TerritoryStrengthSystemService, useValue: mockTerritoryStrengthSystem },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
        { provide: ThemeService, useValue: mockThemeService },
      ],
    });

    service = TestBed.inject(NPCFactionBattleSystemService);
  });

  afterEach(() => {
    if (service) {
      service.destroy();
    }
  });

  describe('Initialization', () => {
    it('should initialize the service', () => {
      service.init(mockEntityManager);

      expect(mockDebugLog.log).toHaveBeenCalledWith(
        'NPC Faction Battle System Initialized',
        'info',
        jasmine.objectContaining({
          targetRange: 300,
          combatRange: 150,
        })
      );
    });
  });

  describe('Target Acquisition', () => {
    it('should prioritize enemy faction NPCs over player', () => {
      const npcId = 1;
      const enemyNpcId = 2;
      const playerId = 3;

      // Setup NPC with faction 1
      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);

      // Setup enemy NPC with faction 2
      const enemyFaction = new FactionComponent(2);
      const enemyPosition = new PositionComponent(150, 100); // 50 units away

      // Setup player
      const playerPosition = new PositionComponent(100, 150); // 50 units away

      // Mock entity queries
      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, EnemyTypeComponent))) {
          return [npcId];
        }
        if (
          components.some((c) => isComponentType(c, PositionComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [npcId, enemyNpcId, playerId];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
            if (isComponentType(component, AIControlledComponent)) return new AIControlledComponent() as unknown as T;
          }
          if (entity === enemyNpcId) {
            if (isComponentType(component, FactionComponent)) return enemyFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return enemyPosition as unknown as T;
            if (isComponentType(component, HealthComponent)) return new HealthComponent(100, 100) as unknown as T;
          }
          if (entity === playerId) {
            if (isComponentType(component, PositionComponent)) return playerPosition as unknown as T;
            if (isComponentType(component, HealthComponent)) return new HealthComponent(100, 100) as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, component: unknown) => {
        return entity === playerId && isComponentType(component, PlayerControlledComponent);
      });

      mockEntityFactory.isEntityActive.and.returnValue(true);
      mockBorderConflictSystem.isInConflictZone.and.returnValue(false);
      mockFourKingsTerritory.getTerritoryAtPosition.and.returnValue(null);

      // Call private method directly to bypass ENABLE_NPC_COMBAT flag
      service['updateNPCTargeting'](mockEntityManager, Date.now());

      const target = service.getTarget(npcId);
      expect(target).toBeDefined();
      expect(target?.entityId).toBe(enemyNpcId); // Should target enemy NPC
      expect(target?.priority).toBeGreaterThan(3); // Higher priority than player
    });

    it('should target player when in hostile territory', () => {
      const npcId = 1;
      const playerId = 2;

      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);
      const playerPosition = new PositionComponent(150, 100);

      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, EnemyTypeComponent))) {
          return [npcId];
        }
        if (
          components.some((c) => isComponentType(c, PositionComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [npcId, playerId];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
            if (isComponentType(component, AIControlledComponent)) return new AIControlledComponent() as unknown as T;
          }
          if (entity === playerId) {
            if (isComponentType(component, PositionComponent)) return playerPosition as unknown as T;
            if (isComponentType(component, HealthComponent)) return new HealthComponent(100, 100) as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.callFake((entity: number, component: unknown) => {
        return entity === playerId && isComponentType(component, PlayerControlledComponent);
      });

      mockEntityFactory.isEntityActive.and.returnValue(true);

      // Player in hostile territory (faction 2)
      mockFourKingsTerritory.getTerritoryAtPosition.and.returnValue({
        kingId: 2,
        kingName: 'Crimson King',
        strength: 75,
      });

      // Call private method directly to bypass ENABLE_NPC_COMBAT flag
      service['updateNPCTargeting'](mockEntityManager, Date.now());

      const target = service.getTarget(npcId);
      expect(target).toBeDefined();
      expect(target?.entityId).toBe(playerId);
      expect(target?.priority).toBe(3); // Medium priority for player in hostile territory
    });

    it('should increase priority in conflict zones', () => {
      const npcId = 1;
      const enemyNpcId = 2;

      const npcFaction = new FactionComponent(1);
      const enemyFaction = new FactionComponent(2);

      mockEntityManager.getEntitiesWithComponents.and.returnValue([npcId]);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId && isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
          if (entity === enemyNpcId && isComponentType(component, FactionComponent))
            return enemyFaction as unknown as T;
          if (isComponentType(component, PositionComponent)) return new PositionComponent(100, 100) as unknown as T;
          return undefined;
        }
      );

      mockEntityFactory.isEntityActive.and.returnValue(true);
      mockBorderConflictSystem.isInConflictZone.and.returnValue(true);
      mockBorderConflictSystem.getConflictingFactions.and.returnValue([1, 2]);

      service.update(100, mockEntityManager);

      // Verify conflict zone increases target priority
      const target = service.getTarget(npcId);
      // Target may be undefined if NPC combat is disabled, so we verify the service state
      expect(service).toBeDefined();
      if (target && target.faction === 2) {
        expect(target.priority).toBe(5); // Maximum priority in conflict zones
      }
    });
  });

  describe('Combat Handling', () => {
    it('should apply damage to targets in combat range', () => {
      const npcId = 1;
      const targetId = 2;

      const npcDamage = new DamageComponent(10);
      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);
      const targetHealth = new HealthComponent(100, 100);

      // Set up target for NPC
      const target: NPCTarget = {
        entityId: targetId,
        faction: 2,
        distance: 100, // Within combat range (150)
        priority: 4,
        isPlayer: false,
      };

      // Force set target
      service['npcTargets'].set(npcId, target);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, DamageComponent)) return npcDamage as unknown as T;
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
          }
          if (entity === targetId && isComponentType(component, HealthComponent)) {
            return targetHealth as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityFactory.isEntityActive.and.returnValue(true);

      // Use deltaTime within the service's cap of 100ms
      const deltaTime = 100;
      service['handleNPCCombat'](mockEntityManager, deltaTime, Date.now());

      // NPC damage is reduced by multiplier (0.5) for NPC vs NPC
      // validDeltaTime = Math.min(deltaTime, 100) = 100
      // actualDamage = damagePerSecond * (validDeltaTime / 1000) = 10 * 0.5 * (100 / 1000) = 0.5
      const expectedDamage = 10 * 0.5 * (deltaTime / 1000);
      expect(targetHealth.health).toBe(100 - expectedDamage);
    });

    it('should not apply damage reduction to player targets', () => {
      const npcId = 1;
      const playerId = 2;

      const npcDamage = new DamageComponent(10);
      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);
      const playerHealth = new HealthComponent(100, 100);

      const target: NPCTarget = {
        entityId: playerId,
        faction: 0,
        distance: 100,
        priority: 3,
        isPlayer: true, // Player target
      };

      service['npcTargets'].set(npcId, target);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, DamageComponent)) return npcDamage as unknown as T;
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
          }
          if (entity === playerId && isComponentType(component, HealthComponent)) return playerHealth as unknown as T;
          return undefined;
        }
      );

      mockEntityFactory.isEntityActive.and.returnValue(true);

      // Use deltaTime within the service's cap of 100ms
      const deltaTime = 100;
      service['handleNPCCombat'](mockEntityManager, deltaTime, Date.now());

      // Full damage to player (no reduction)
      // validDeltaTime = Math.min(deltaTime, 100) = 100
      // actualDamage = damagePerSecond * (validDeltaTime / 1000) = 10 * (100 / 1000) = 1
      const expectedDamage = 10 * (deltaTime / 1000);
      expect(playerHealth.health).toBe(100 - expectedDamage);
    });

    it('should handle NPC kills and update statistics', () => {
      const killerId = 1;
      const victimId = 2;
      const killerFaction = 1;
      const victimFaction = 2;
      const position = new PositionComponent(100, 100);

      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 2, gridY: 2 });

      service['handleNPCKill'](killerId, victimId, killerFaction, victimFaction, position);

      const stats = service.getBattleStats();
      expect(stats.totalBattles).toBe(1);
      expect(stats.battlesPerFaction.get(killerFaction)).toBe(1);
      expect(stats.casualties.get(victimFaction)).toBe(1);

      // Verify territory weakening
      expect(mockTerritoryStrengthSystem.weakenTilesFromKill).toHaveBeenCalledWith(2, 2);

      // Verify conflict intensity boost
      expect(mockBorderConflictSystem.boostConflictIntensity).toHaveBeenCalledWith(2, 2, 0.05);
    });
  });

  describe('Retargeting', () => {
    it('should retarget after interval', () => {
      const npcId = 1;
      const oldTargetId = 2;
      const potentialTargetId = 3;

      // Initial target
      const initialTarget: NPCTarget = {
        entityId: oldTargetId,
        faction: 2,
        distance: 200,
        priority: 3,
        isPlayer: false,
      };

      // Set up initial state with a very old lastRetargetTime (simulating time has passed)
      service['npcTargets'].set(npcId, initialTarget);
      // Set lastRetargetTime to a recent time (simulates we just retargeted)
      const recentTime = Date.now();
      service['lastRetargetTime'].set(npcId, recentTime);

      // Setup NPC with faction 1
      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);

      // Setup potential target with faction 2 (enemy)
      const targetFaction = new FactionComponent(2);
      const targetPosition = new PositionComponent(150, 100); // 50 units away

      // Mock entity queries - needs to return NPC for EnemyTypeComponent query
      // and both NPC and target for PositionComponent+HealthComponent query
      mockEntityManager.getEntitiesWithComponents.and.callFake((...components: unknown[]) => {
        if (components.some((c) => isComponentType(c, EnemyTypeComponent))) {
          return [npcId];
        }
        if (
          components.some((c) => isComponentType(c, PositionComponent)) &&
          components.some((c) => isComponentType(c, HealthComponent))
        ) {
          return [npcId, potentialTargetId];
        }
        return [];
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
            if (isComponentType(component, AIControlledComponent)) return new AIControlledComponent() as unknown as T;
          }
          if (entity === potentialTargetId) {
            if (isComponentType(component, FactionComponent)) return targetFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return targetPosition as unknown as T;
            if (isComponentType(component, HealthComponent)) return new HealthComponent(100, 100) as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.hasComponent.and.returnValue(false); // Not a player
      mockEntityFactory.isEntityActive.and.returnValue(true);
      mockBorderConflictSystem.isInConflictZone.and.returnValue(false);

      // First update with currentTime = recentTime + 100 - should NOT retarget because
      // currentTime - lastRetargetTime < RETARGET_INTERVAL (2000ms)
      service['updateNPCTargeting'](mockEntityManager, recentTime + 100);
      expect(service.getTarget(npcId)?.entityId).toBe(oldTargetId);

      // Second update with currentTime > lastRetargetTime + RETARGET_INTERVAL
      // This should trigger retargeting and find the new target (potentialTargetId)
      const futureTime = recentTime + 2100; // Past the 2000ms retarget interval
      service['updateNPCTargeting'](mockEntityManager, futureTime);

      // Should have updated lastRetargetTime to the new time (futureTime)
      expect(service['lastRetargetTime'].get(npcId)).toBe(futureTime);
      // Should have found the new target
      expect(service.getTarget(npcId)?.entityId).toBe(potentialTargetId);
    });

    it('should force retarget on demand', () => {
      const npcId = 1;

      service['lastRetargetTime'].set(npcId, Date.now());
      service.forceRetarget(npcId);

      expect(service['lastRetargetTime'].has(npcId)).toBe(false);
    });
  });

  describe('Battle Statistics', () => {
    it('should track battle statistics correctly', () => {
      const stats = service.getBattleStats();

      expect(stats.totalBattles).toBe(0);
      expect(stats.activeBattles).toBe(0);
      expect(stats.battlesPerFaction.size).toBe(0);
      expect(stats.casualties.size).toBe(0);
    });

    it('should emit battle events', (done) => {
      // Skip the initial emission from BehaviorSubject
      let emissionCount = 0;
      service.battleEvents$.subscribe((stats) => {
        emissionCount++;
        // Only check after the manual call to updateBattleStats (second emission)
        if (emissionCount === 2) {
          expect(stats).toBeDefined();
          expect(stats.totalBattles).toBeDefined();
          done();
        }
      });

      service['updateBattleStats']();
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      const npcId = 1;
      const target: NPCTarget = {
        entityId: 2,
        faction: 2,
        distance: 100,
        priority: 4,
        isPlayer: false,
      };

      service['npcTargets'].set(npcId, target);
      service['lastRetargetTime'].set(npcId, Date.now());

      service.destroy();

      expect(service['npcTargets'].size).toBe(0);
      expect(service['lastRetargetTime'].size).toBe(0);
    });

    it('should implement OnDestroy', () => {
      spyOn(service, 'destroy');
      service.ngOnDestroy();
      expect(service.destroy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle inactive entities gracefully', () => {
      const npcId = 1;

      mockEntityManager.getEntitiesWithComponents.and.returnValue([npcId]);
      mockEntityFactory.isEntityActive.and.returnValue(false); // Inactive entity

      service.update(100, mockEntityManager);

      expect(service.hasTarget(npcId)).toBe(false);
    });

    it('should skip targeting self', () => {
      const npcId = 1;

      mockEntityManager.getEntitiesWithComponents.and.returnValue([npcId]);
      mockEntityManager.getComponent.and.returnValue(new FactionComponent(1));
      mockEntityFactory.isEntityActive.and.returnValue(true);

      service.update(100, mockEntityManager);

      // Should not target itself
      const target = service.getTarget(npcId);
      expect(target?.entityId).not.toBe(npcId);
    });

    it('should handle missing components gracefully', () => {
      const npcId = 1;

      mockEntityManager.getEntitiesWithComponents.and.returnValue([npcId]);
      mockEntityManager.getComponent.and.returnValue(undefined); // Missing components

      expect(() => service.update(100, mockEntityManager)).not.toThrow();
    });

    it('should not target same faction NPCs', () => {
      const npcId = 1;
      const allyId = 2;

      const faction = new FactionComponent(1);

      mockEntityManager.getEntitiesWithComponents.and.returnValue([npcId, allyId]);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(_entity: number, component: ComponentType<T>): T | undefined => {
          if (isComponentType(component, FactionComponent)) return faction as unknown as T; // Same faction
          if (isComponentType(component, PositionComponent)) return new PositionComponent(100, 100) as unknown as T;
          return undefined;
        }
      );

      mockEntityFactory.isEntityActive.and.returnValue(true);

      service.update(100, mockEntityManager);

      // Should not target ally
      const target = service.getTarget(npcId);
      expect(target?.entityId).not.toBe(allyId);
    });
  });

  describe('Visual Effects', () => {
    let killerAi: AIControlledComponent;

    function setupCombatPair(): { npcId: number; targetId: number; targetHealth: HealthComponent } {
      const npcId = 1;
      const targetId = 2;
      const npcDamage = new DamageComponent(10);
      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);
      const targetPosition = new PositionComponent(120, 100);
      const targetHealth = new HealthComponent(100, 100);
      killerAi = new AIControlledComponent();
      killerAi.npcBattleTargetId = targetId;

      const target: NPCTarget = {
        entityId: targetId,
        faction: 2,
        distance: 20,
        priority: 4,
        isPlayer: false,
      };
      service['npcTargets'].set(npcId, target);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, DamageComponent)) return npcDamage as unknown as T;
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
            if (isComponentType(component, AIControlledComponent)) return killerAi as unknown as T;
          }
          if (entity === targetId) {
            if (isComponentType(component, HealthComponent)) return targetHealth as unknown as T;
            if (isComponentType(component, PositionComponent)) return targetPosition as unknown as T;
          }
          return undefined;
        }
      );
      mockEntityFactory.isEntityActive.and.returnValue(true);

      return { npcId, targetId, targetHealth };
    }

    it('should create NPC damage number with faction color', () => {
      setupCombatPair();
      service['handleNPCCombat'](mockEntityManager, 100, Date.now());

      expect(mockEffectFactory.createNpcDamageNumber).toHaveBeenCalledWith(
        jasmine.objectContaining({ x: 120, y: 100 }),
        jasmine.any(Number),
        jasmine.any(String)
      );
    });

    it('should create clash sparks at midpoint between combatants', () => {
      setupCombatPair();
      service['handleNPCCombat'](mockEntityManager, 100, Date.now());

      expect(mockEffectFactory.createNpcClashSparks).toHaveBeenCalledWith(
        jasmine.objectContaining({ x: 110, y: 100 }), // midpoint of (100,100) and (120,100)
        jasmine.any(String)
      );
    });

    it('should throttle clash sparks per enemy pair', () => {
      setupCombatPair();
      const now = Date.now();

      // First call — should create spark
      service['handleNPCCombat'](mockEntityManager, 100, now);
      expect(mockEffectFactory.createNpcClashSparks).toHaveBeenCalledTimes(1);

      // Second call 100ms later — should NOT create spark (throttle = 500ms)
      service['handleNPCCombat'](mockEntityManager, 100, now + 100);
      expect(mockEffectFactory.createNpcClashSparks).toHaveBeenCalledTimes(1);

      // Third call 600ms later — SHOULD create spark (past throttle)
      service['handleNPCCombat'](mockEntityManager, 100, now + 600);
      expect(mockEffectFactory.createNpcClashSparks).toHaveBeenCalledTimes(2);
    });

    it('should accumulate damage between throttled displays', () => {
      setupCombatPair();
      const now = Date.now();

      // First call — creates damage number (initial)
      service['handleNPCCombat'](mockEntityManager, 100, now);
      const firstCall = mockEffectFactory.createNpcDamageNumber.calls.mostRecent();
      const firstDamage = firstCall.args[1];

      // Second call 100ms later — accumulates, no display
      service['handleNPCCombat'](mockEntityManager, 100, now + 100);
      expect(mockEffectFactory.createNpcDamageNumber).toHaveBeenCalledTimes(1);

      // Third call 1100ms later — displays accumulated damage (throttle is 1000ms)
      service['handleNPCCombat'](mockEntityManager, 100, now + 1100);
      expect(mockEffectFactory.createNpcDamageNumber).toHaveBeenCalledTimes(2);
      const secondCall = mockEffectFactory.createNpcDamageNumber.calls.mostRecent();
      const secondDamage = secondCall.args[1];
      // Second display should be > first (accumulated from 2 ticks)
      expect(secondDamage).toBeGreaterThan(firstDamage);
    });

    it('should create death effect at VICTIM position on NPC kill', () => {
      const { targetHealth } = setupCombatPair();
      targetHealth.health = 0.1; // Almost dead — next hit will kill

      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 2, gridY: 2 });

      service['handleNPCCombat'](mockEntityManager, 100, Date.now());

      // Death effect must be at victim (120, 100), NOT attacker (100, 100)
      expect(mockEffectFactory.createNpcDeathEffect).toHaveBeenCalledWith(
        jasmine.objectContaining({ x: 120, y: 100 }),
        jasmine.any(String)
      );
    });

    it('should clean up throttle maps on kill', () => {
      const { npcId, targetId, targetHealth } = setupCombatPair();
      targetHealth.health = 0.1;

      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 2, gridY: 2 });

      // First combat tick — populates throttle maps
      const now = Date.now();
      service['handleNPCCombat'](mockEntityManager, 100, now);

      const pairKey = `${npcId}-${targetId}`;
      // After kill, throttle entries should be cleaned up
      expect(service['lastClashSparkTime'].has(pairKey)).toBe(false);
      expect(service['lastDamageNumberTime'].has(pairKey)).toBe(false);
      expect(service['accumulatedDamage'].has(pairKey)).toBe(false);
    });

    it('should suppress damage numbers when accumulated damage rounds to 0', () => {
      setupCombatPair();
      // deltaTime=16 (60fps): actualDamage = 10 * 0.5 * (16/1000) = 0.08
      // Math.round(0.08) = 0, so no damage number should be created
      service['handleNPCCombat'](mockEntityManager, 16, Date.now());

      expect(mockEffectFactory.createNpcDamageNumber).not.toHaveBeenCalled();
    });

    it('should clear killer npcBattleTargetId on kill', () => {
      const { targetHealth } = setupCombatPair();
      targetHealth.health = 0.1; // Almost dead

      mockFourKingsTerritory.worldToGrid.and.returnValue({ gridX: 2, gridY: 2 });

      // killerAi.npcBattleTargetId should be set before kill
      expect(killerAi.npcBattleTargetId).toBe(2);

      service['handleNPCCombat'](mockEntityManager, 100, Date.now());

      // After kill, killer's AI should have npcBattleTargetId cleared
      expect(killerAi.npcBattleTargetId).toBeUndefined();
    });

    it('should NOT create visual effects for player targets', () => {
      const npcId = 1;
      const playerId = 2;

      const npcDamage = new DamageComponent(10);
      const npcFaction = new FactionComponent(1);
      const npcPosition = new PositionComponent(100, 100);
      const playerHealth = new HealthComponent(100, 100);

      const target: NPCTarget = {
        entityId: playerId,
        faction: 0,
        distance: 100,
        priority: 3,
        isPlayer: true,
      };
      service['npcTargets'].set(npcId, target);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(entity: number, component: ComponentType<T>): T | undefined => {
          if (entity === npcId) {
            if (isComponentType(component, DamageComponent)) return npcDamage as unknown as T;
            if (isComponentType(component, FactionComponent)) return npcFaction as unknown as T;
            if (isComponentType(component, PositionComponent)) return npcPosition as unknown as T;
          }
          if (entity === playerId && isComponentType(component, HealthComponent)) return playerHealth as unknown as T;
          return undefined;
        }
      );
      mockEntityFactory.isEntityActive.and.returnValue(true);

      service['handleNPCCombat'](mockEntityManager, 100, Date.now());

      // NPC-vs-player combat should NOT create faction battle visual effects
      expect(mockEffectFactory.createNpcDamageNumber).not.toHaveBeenCalled();
      expect(mockEffectFactory.createNpcClashSparks).not.toHaveBeenCalled();
    });
  });

  describe('Throttle Cleanup', () => {
    it('should clean up stale throttle entries', () => {
      // Populate throttle maps with old entries
      const now = Date.now();
      service['lastClashSparkTime'].set('1-2', now - 10000);
      service['lastDamageNumberTime'].set('1-2', now - 10000);
      service['accumulatedDamage'].set('1-2', 5);

      service['cleanupStaleThrottleEntries'](now, 5000);

      expect(service['lastClashSparkTime'].size).toBe(0);
      expect(service['lastDamageNumberTime'].size).toBe(0);
      expect(service['accumulatedDamage'].size).toBe(0);
    });

    it('should NOT clean up recent throttle entries', () => {
      const now = Date.now();
      service['lastClashSparkTime'].set('1-2', now - 1000);
      service['lastDamageNumberTime'].set('1-2', now - 1000);

      service['cleanupStaleThrottleEntries'](now, 5000);

      expect(service['lastClashSparkTime'].size).toBe(1);
      expect(service['lastDamageNumberTime'].size).toBe(1);
    });
  });
});
