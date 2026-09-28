import { TestBed } from '@angular/core/testing';
import { NpcAbilitySystemService } from './npc-ability-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { Component, ComponentType, EntityManager } from '../../ecs/ecs.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { GameStateService } from '../../state/game-state.service';
import {
  AbilityComponent,
  AbilityType,
  BossPhaseComponent,
  DamageComponent,
  EnemyTypeComponent,
  FactionComponent,
  HealthComponent,
  InvincibilityComponent,
  MinionTagComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  TeleportEffectComponent,
  VelocityComponent,
  WeaponComponent,
} from '@photon/components';
import { NPC_ABILITY_CONFIG } from '@photon/config/game-constants';
import { ComponentFactory } from '../../factories/component-factory';
import { MinionTrackerService } from './minion-tracker.service';

interface TimedEffect {
  type: string;
  entityId: number;
  expiresAt: number;
  onExpire: () => void;
}

interface NpcAbilitySystemServiceTestAccess {
  timedEffects: TimedEffect[];
  addTimedEffect(type: string, entityId: number, durationMs: number, onExpire: () => void): void;
  processTimedEffects(currentTime: number): void;
  executeAreaBuff(position: PositionComponent, entityManager: EntityManager): void;
  executeShieldGeneration(entityId: number, entityManager: EntityManager): void;
  executeTentacleGrab(position: PositionComponent, playerPos: PositionComponent, entityManager: EntityManager): void;
  executeEnrage(entityId: number, entityManager: EntityManager): void;
  executeClawSlam(executingEntityId: number, position: PositionComponent, entityManager: EntityManager): void;
  executeSummonMinions(ownerId: number, position: PositionComponent, entityManager: EntityManager): void;
  executeTeleportBlink(entityId: number, playerPos: PositionComponent, entityManager: EntityManager): void;
  transitionBossPhase(
    entityId: number,
    bossPhase: BossPhaseComponent,
    abilityComp: AbilityComponent,
    entityManager: EntityManager,
    currentTime: number,
    newPhase: number
  ): void;
}

function isComponentType(componentType: unknown, componentClass: unknown): boolean {
  if (componentType === componentClass) return true;
  if (typeof componentType !== 'function' || typeof componentClass !== 'function') return false;
  return componentType.name === componentClass.name;
}

describe('NpcAbilitySystemService', () => {
  let service: NpcAbilitySystemService;
  let serviceTest: NpcAbilitySystemServiceTestAccess;
  let entityManager: jasmine.SpyObj<EntityManagerService>;
  let effectFactory: jasmine.SpyObj<EffectFactoryService>;
  let minionTrackerSpy: jasmine.SpyObj<MinionTrackerService>;
  let entityFactorySpy: jasmine.SpyObj<EntityFactoryECSService>;

  beforeEach(() => {
    const entityManagerSpy = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'hasComponent',
      'addComponent',
      'createEntity',
    ]);
    // Guardians are skipped in claw-slam loops — default: no entity is a guardian
    entityManagerSpy.hasComponent.and.returnValue(false);
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    entityFactorySpy = jasmine.createSpyObj('EntityFactoryECSService', [
      'createPoisonCloud',
      'createEnemyProjectile',
      'createEnemy',
      'createArenaHazard',
    ]);
    entityFactorySpy.createEnemy.and.returnValue(500);
    entityFactorySpy.createArenaHazard.and.returnValue(999);

    minionTrackerSpy = jasmine.createSpyObj('MinionTrackerService', [
      'getAliveCount',
      'recordSpawn',
      'recordMinionDeath',
      'cleanupOwner',
      'reset',
    ]);
    minionTrackerSpy.getAliveCount.and.returnValue(0);
    const effectFactorySpy = jasmine.createSpyObj('EffectFactoryService', [
      'createBuffEffect',
      'createHealEffect',
      'createShieldEffect',
      'createGrabEffect',
      'createBurstEffect',
      'createShellEffect',
      'createChargeEffect',
      'createSlamEffect',
      'createEnrageEffect',
      'createLureEffect',
      'createPredictionEffect',
      'createAbilityEffect',
      'createHealEffectSimple',
      'createPhaseTransitionEffect',
    ]);
    const gameStateSpy = jasmine.createSpyObj('GameStateService', ['takeDamage']);

    TestBed.configureTestingModule({
      providers: [
        NpcAbilitySystemService,
        { provide: EntityManagerService, useValue: entityManagerSpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: EffectFactoryService, useValue: effectFactorySpy },
        { provide: GameStateService, useValue: gameStateSpy },
        { provide: MinionTrackerService, useValue: minionTrackerSpy },
      ],
    });

    service = TestBed.inject(NpcAbilitySystemService);
    serviceTest = service as unknown as NpcAbilitySystemServiceTestAccess;
    entityManager = TestBed.inject(EntityManagerService) as jasmine.SpyObj<EntityManagerService>;
    effectFactory = TestBed.inject(EffectFactoryService) as jasmine.SpyObj<EffectFactoryService>;
  });

  describe('initialization', () => {
    it('should create the service', () => {
      expect(service).toBeTruthy();
    });

    it('should initialize with empty timed effects', () => {
      expect(serviceTest.timedEffects).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should empty timedEffects so stale buff closures do not fire on recycled entity IDs', () => {
      // Push a fake timed effect (simulating a buff left over from a previous run)
      serviceTest.addTimedEffect('enrage_buff', 42, 10000, () => {
        // intentionally empty — we just need an entry in the array
      });
      expect(serviceTest.timedEffects.length).toBe(1);

      service.reset();

      expect(serviceTest.timedEffects.length).toBe(0);
    });

    it('should reset lastAbilityCheck so throttle fires immediately on next update', () => {
      // Drive lastAbilityCheck to a non-zero value via a real update
      entityManager.getEntitiesWithComponents.and.returnValue([]);
      service.update(16, entityManager);

      // Now reset — lastAbilityCheck should return to 0
      service.reset();

      // Cast to access private field for assertion
      const svc = service as unknown as { lastAbilityCheck: number };
      expect(svc.lastAbilityCheck).toBe(0);
    });

    it('destroy() delegates to reset() and clears timedEffects', () => {
      serviceTest.addTimedEffect('iron_skin', 7, 4000, () => {
        /* no-op */
      });
      expect(serviceTest.timedEffects.length).toBe(1);

      service.destroy();

      expect(serviceTest.timedEffects.length).toBe(0);
    });
  });

  describe('update', () => {
    it('should throttle ability checks based on config interval', () => {
      const currentTime = Date.now();
      entityManager.getEntitiesWithComponents.and.returnValue([]);

      // First call should process
      service.update(16, entityManager);
      expect(entityManager.getEntitiesWithComponents).toHaveBeenCalledTimes(2); // ability and player entities

      // Immediate second call should be throttled
      entityManager.getEntitiesWithComponents.calls.reset();
      service.update(16, entityManager);
      expect(entityManager.getEntitiesWithComponents).not.toHaveBeenCalled();

      // After interval, should process again
      spyOn(Date, 'now').and.returnValue(currentTime + NPC_ABILITY_CONFIG.ABILITY_CHECK_INTERVAL_MS + 1);
      service.update(16, entityManager);
      expect(entityManager.getEntitiesWithComponents).toHaveBeenCalled();
    });

    it('should process timed effects before checking abilities', () => {
      const processSpy = spyOn(serviceTest, 'processTimedEffects');
      entityManager.getEntitiesWithComponents.and.returnValue([]);

      service.update(16, entityManager);

      expect(processSpy).toHaveBeenCalled();
    });
  });

  describe('processTimedEffects', () => {
    it('should execute and remove expired effects', () => {
      const onExpire1 = jasmine.createSpy('onExpire1');
      const onExpire2 = jasmine.createSpy('onExpire2');

      serviceTest.addTimedEffect('test1', 1, 100, onExpire1);
      serviceTest.addTimedEffect('test2', 2, 200, onExpire2);

      serviceTest.processTimedEffects(Date.now() + 50);
      expect(onExpire1).not.toHaveBeenCalled();
      expect(onExpire2).not.toHaveBeenCalled();
      expect(serviceTest.timedEffects.length).toBe(2);

      serviceTest.processTimedEffects(Date.now() + 150);
      expect(onExpire1).toHaveBeenCalled();
      expect(onExpire2).not.toHaveBeenCalled();
      expect(serviceTest.timedEffects.length).toBe(1);

      serviceTest.processTimedEffects(Date.now() + 250);
      expect(onExpire2).toHaveBeenCalled();
      expect(serviceTest.timedEffects.length).toBe(0);
    });
  });

  describe('ability execution', () => {
    let mockEntity: number;
    let mockPosition: PositionComponent;
    let mockAbilityComp: AbilityComponent;
    let mockPlayerPos: PositionComponent;

    beforeEach(() => {
      mockEntity = 1;
      mockPosition = new PositionComponent(100, 100);
      mockPlayerPos = new PositionComponent(150, 150);
      mockAbilityComp = ComponentFactory.createAbilityComponent([
        {
          type: AbilityType.AREA_BUFF,
          cooldownMs: 5000,
          lastUsedTime: 0,
          damage: 10,
        },
      ]);

      entityManager.getEntitiesWithComponents.and.returnValue([mockEntity]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(entityId: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, AbilityComponent)) return mockAbilityComp as unknown as T;
          if (isComponentType(componentType, PositionComponent)) {
            return (entityId === mockEntity ? mockPosition : mockPlayerPos) as unknown as T;
          }
          return undefined;
        }
      );
    });

    it('should telegraph ability before executing', () => {
      const currentTime = Date.now();
      spyOn(Date, 'now').and.returnValue(currentTime);

      // Set up ability ready to use
      mockAbilityComp.abilities[0].lastUsedTime = currentTime - 10000;
      mockAbilityComp.nextAbilityTime = currentTime - 1;

      service.update(16, entityManager);

      // Should create telegraph effect
      expect(effectFactory.createAbilityEffect).toHaveBeenCalledWith(mockPosition, AbilityType.AREA_BUFF);

      expect(serviceTest.timedEffects.length).toBe(1);
      expect(serviceTest.timedEffects[0].type).toBe('ability_execute');
    });
  });

  describe('executeAreaBuff', () => {
    it('should buff all enemies within range', () => {
      const enemy1 = 1;
      const enemy2 = 2;
      const enemy3 = 3;
      const position = new PositionComponent(100, 100);

      // Setup enemies at different distances
      const enemy1Pos = new PositionComponent(150, 100); // 50 units away
      const enemy2Pos = new PositionComponent(200, 100); // 100 units away
      const enemy3Pos = new PositionComponent(500, 100); // 400 units away (out of range)

      const damage1 = new DamageComponent(10, 'contact');
      const damage2 = new DamageComponent(20, 'contact');
      const damage3 = new DamageComponent(30, 'contact');

      entityManager.getEntitiesWithComponents.and.returnValue([enemy1, enemy2, enemy3]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(entityId: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, PositionComponent)) {
            if (entityId === enemy1) return enemy1Pos as unknown as T;
            if (entityId === enemy2) return enemy2Pos as unknown as T;
            if (entityId === enemy3) return enemy3Pos as unknown as T;
          }
          if (isComponentType(componentType, DamageComponent)) {
            if (entityId === enemy1) return damage1 as unknown as T;
            if (entityId === enemy2) return damage2 as unknown as T;
            if (entityId === enemy3) return damage3 as unknown as T;
          }
          return undefined;
        }
      );

      serviceTest.executeAreaBuff(position, entityManager);

      expect(damage1.contactDamage).toBe(10 * NPC_ABILITY_CONFIG.AREA_BUFF.DAMAGE_MULTIPLIER);
      expect(damage2.contactDamage).toBe(20 * NPC_ABILITY_CONFIG.AREA_BUFF.DAMAGE_MULTIPLIER);
      expect(damage3.contactDamage).toBe(30);

      expect(effectFactory.createBuffEffect).toHaveBeenCalledTimes(2);

      expect(serviceTest.timedEffects.length).toBe(2);
    });

    it('should not stack buffs when applied multiple times', () => {
      const enemy1 = 1;
      const position = new PositionComponent(100, 100);
      const enemy1Pos = new PositionComponent(150, 100);
      const damage1 = new DamageComponent(10, 'contact');

      entityManager.getEntitiesWithComponents.and.returnValue([enemy1]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(_entityId: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, PositionComponent)) return enemy1Pos as unknown as T;
          if (isComponentType(componentType, DamageComponent)) return damage1 as unknown as T;
          return undefined;
        }
      );

      serviceTest.executeAreaBuff(position, entityManager);
      const firstBuffedDamage = damage1.contactDamage;
      expect(firstBuffedDamage).toBe(10 * NPC_ABILITY_CONFIG.AREA_BUFF.DAMAGE_MULTIPLIER);
      expect(serviceTest.timedEffects.length).toBe(1);

      serviceTest.executeAreaBuff(position, entityManager);
      expect(damage1.contactDamage).toBe(firstBuffedDamage);
      expect(serviceTest.timedEffects.length).toBe(1);
      expect(effectFactory.createBuffEffect).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeShieldGeneration', () => {
    it('should add invincibility component if not present', () => {
      const entityId = 1;
      entityManager.getComponent.and.returnValue(undefined);

      serviceTest.executeShieldGeneration(entityId, entityManager);

      expect(entityManager.addComponent).toHaveBeenCalled();
      const invincibilityArg = entityManager.addComponent.calls.mostRecent().args[1] as InvincibilityComponent;
      expect(invincibilityArg).toBeInstanceOf(InvincibilityComponent);
      expect(invincibilityArg.duration).toBe(NPC_ABILITY_CONFIG.SHIELD.DURATION_MS);
    });

    it('should reset existing invincibility component', () => {
      const entityId = 1;
      const existingInvincibility = new InvincibilityComponent();
      existingInvincibility.duration = 100;
      existingInvincibility.startTime = window.performance.now() - 1000;

      entityManager.getComponent.and.returnValue(existingInvincibility);

      serviceTest.executeShieldGeneration(entityId, entityManager);

      expect(entityManager.addComponent).not.toHaveBeenCalled();
      expect(existingInvincibility.duration).toBe(NPC_ABILITY_CONFIG.SHIELD.DURATION_MS);
      expect(existingInvincibility.startTime).toBeGreaterThan(window.performance.now() - 100);
    });
  });

  describe('executeTentacleGrab', () => {
    it('should slow player velocity when in range', () => {
      const playerId = 1;
      const position = new PositionComponent(100, 100);
      const playerPos = new PositionComponent(150, 100); // 50 units away (in range)
      const velocity = new VelocityComponent();
      velocity.vx = 100;
      velocity.vy = 50;

      entityManager.getEntitiesWithComponents.and.returnValue([playerId]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(_entityId: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, VelocityComponent)) return velocity as unknown as T;
          return undefined;
        }
      );

      serviceTest.executeTentacleGrab(position, playerPos, entityManager);

      expect(velocity.vx).toBe(100 * NPC_ABILITY_CONFIG.TENTACLE_GRAB.SLOW_FACTOR);
      expect(velocity.vy).toBe(50 * NPC_ABILITY_CONFIG.TENTACLE_GRAB.SLOW_FACTOR);

      expect(effectFactory.createGrabEffect).toHaveBeenCalledWith(position, playerPos);

      expect(serviceTest.timedEffects.length).toBe(1);
      expect(serviceTest.timedEffects[0].type).toBe('tentacle_grab_restore');
    });

    it('should not affect player when out of range', () => {
      const playerId = 1;
      const position = new PositionComponent(100, 100);
      const playerPos = new PositionComponent(400, 100); // 300 units away (out of range)
      const velocity = new VelocityComponent();
      velocity.vx = 100;
      velocity.vy = 50;

      entityManager.getEntitiesWithComponents.and.returnValue([playerId]);
      entityManager.getComponent.and.returnValue(velocity);

      serviceTest.executeTentacleGrab(position, playerPos, entityManager);

      expect(velocity.vx).toBe(100);
      expect(velocity.vy).toBe(50);

      expect(effectFactory.createGrabEffect).not.toHaveBeenCalled();
      expect(serviceTest.timedEffects.length).toBe(0);
    });
  });

  describe('executeEnrage', () => {
    it('should only trigger when health is below threshold', () => {
      const entityId = 1;
      const health = new HealthComponent();
      health.health = 20;
      health.maxHealth = 100; // 20% health
      const velocity = new VelocityComponent();
      velocity.vx = 10;
      velocity.vy = 10;
      const damage = new DamageComponent(10, 'contact');

      entityManager.getComponent.and.callFake(
        <T extends Component>(_id: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, HealthComponent)) return health as unknown as T;
          if (isComponentType(componentType, VelocityComponent)) return velocity as unknown as T;
          if (isComponentType(componentType, DamageComponent)) return damage as unknown as T;
          return undefined;
        }
      );

      serviceTest.executeEnrage(entityId, entityManager);

      expect(velocity.vx).toBe(10 * NPC_ABILITY_CONFIG.ENRAGE.SPEED_MULTIPLIER);
      expect(velocity.vy).toBe(10 * NPC_ABILITY_CONFIG.ENRAGE.SPEED_MULTIPLIER);
      expect(damage.contactDamage).toBe(10 * NPC_ABILITY_CONFIG.ENRAGE.DAMAGE_MULTIPLIER);

      expect(serviceTest.timedEffects.length).toBe(1);
    });

    it('should not trigger when health is above threshold', () => {
      const entityId = 1;
      const health = new HealthComponent();
      health.health = 50;
      health.maxHealth = 100; // 50% health (above threshold)
      const velocity = new VelocityComponent();
      velocity.vx = 10;
      velocity.vy = 10;

      entityManager.getComponent.and.callFake(
        <T extends Component>(_id: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, HealthComponent)) return health as unknown as T;
          if (isComponentType(componentType, VelocityComponent)) return velocity as unknown as T;
          return undefined;
        }
      );

      serviceTest.executeEnrage(entityId, entityManager);

      expect(velocity.vx).toBe(10);
      expect(velocity.vy).toBe(10);

      expect(serviceTest.timedEffects.length).toBe(0);
    });

    it('should not stack enrage buffs when already active', () => {
      const entityId = 1;
      const health = new HealthComponent();
      health.health = 20;
      health.maxHealth = 100; // 20% health
      const velocity = new VelocityComponent();
      velocity.vx = 10;
      velocity.vy = 10;
      const damage = new DamageComponent(10, 'contact');

      entityManager.getComponent.and.callFake(
        <T extends Component>(_id: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, HealthComponent)) return health as unknown as T;
          if (isComponentType(componentType, VelocityComponent)) return velocity as unknown as T;
          if (isComponentType(componentType, DamageComponent)) return damage as unknown as T;
          return undefined;
        }
      );

      serviceTest.executeEnrage(entityId, entityManager);
      const firstSpeed = velocity.vx;
      const firstDamage = damage.contactDamage;
      expect(serviceTest.timedEffects.length).toBe(1);

      serviceTest.executeEnrage(entityId, entityManager);
      expect(velocity.vx).toBe(firstSpeed);
      expect(damage.contactDamage).toBe(firstDamage);
      expect(serviceTest.timedEffects.length).toBe(1);
    });
  });

  describe('integration', () => {
    it('should handle multiple abilities from same entity', () => {
      const entityId = 1;
      const position = new PositionComponent(100, 100);
      const abilities = [
        {
          type: AbilityType.AREA_BUFF,
          cooldownMs: 1000,
          lastUsedTime: 0,
          damage: 10,
        },
        {
          type: AbilityType.AREA_HEAL,
          cooldownMs: 1000,
          lastUsedTime: 0,
          damage: 0,
        },
      ];
      const abilityComp = ComponentFactory.createAbilityComponent(abilities);

      entityManager.getEntitiesWithComponents
        .withArgs(AbilityComponent, PositionComponent)
        .and.returnValue([entityId])
        .withArgs(PlayerControlledComponent)
        .and.returnValue([])
        .withArgs(EnemyTypeComponent, PositionComponent, HealthComponent)
        .and.returnValue([])
        .withArgs(EnemyTypeComponent, PositionComponent)
        .and.returnValue([]);

      entityManager.getComponent.and.callFake(
        <T extends Component>(_id: number, componentType: ComponentType<T>): T | undefined => {
          if (isComponentType(componentType, AbilityComponent)) return abilityComp as unknown as T;
          if (isComponentType(componentType, PositionComponent)) return position as unknown as T;
          return undefined;
        }
      );

      const startTime = Date.now();
      const dateNowSpy = spyOn(Date, 'now');

      // First update - executes AREA_BUFF ability
      dateNowSpy.and.returnValue(startTime);
      service.update(16, entityManager);
      expect(serviceTest.timedEffects.length).toBe(1); // Telegraph for AREA_BUFF

      // Advance 5 seconds - next ability should be executable
      // nextAbilityTime was set to currentTime + 3000 + random*2000 (3000-5000ms away)
      // After 5000ms, the previous telegraph expired and new one is created
      dateNowSpy.and.returnValue(startTime + 5000);
      service.update(16, entityManager);
      expect(serviceTest.timedEffects.length).toBe(1); // Old telegraph expired, new one added
    });
  });

  describe('executeClawSlam', () => {
    it('should instant-kill NPCs in range and mark as environmental', () => {
      const executingEntityId = 1;
      const targetEnemy = 2;
      const position = new PositionComponent(100, 100);
      const targetPos = new PositionComponent(120, 100);
      const targetHealth = new HealthComponent(100, 100);

      entityManager.getEntitiesWithComponents.and.returnValue([executingEntityId, targetEnemy]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, componentType: ComponentType<T>): T | undefined => {
          if (id === targetEnemy) {
            if (isComponentType(componentType, PositionComponent)) return targetPos as unknown as T;
            if (isComponentType(componentType, HealthComponent)) return targetHealth as unknown as T;
          }
          return undefined;
        }
      );

      serviceTest.executeClawSlam(executingEntityId, position, entityManager);

      expect(targetHealth.health).toBe(0);
      expect(targetHealth.lastDamageSource).toBe('environmental');
    });

    it('should not kill NPCs outside range', () => {
      const executingEntityId = 1;
      const targetEnemy = 2;
      const position = new PositionComponent(100, 100);
      const targetPos = new PositionComponent(500, 500);
      const targetHealth = new HealthComponent(100, 100);

      entityManager.getEntitiesWithComponents.and.returnValue([executingEntityId, targetEnemy]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, componentType: ComponentType<T>): T | undefined => {
          if (id === targetEnemy) {
            if (isComponentType(componentType, PositionComponent)) return targetPos as unknown as T;
            if (isComponentType(componentType, HealthComponent)) return targetHealth as unknown as T;
          }
          return undefined;
        }
      );

      serviceTest.executeClawSlam(executingEntityId, position, entityManager);

      expect(targetHealth.health).toBe(100);
    });

    it('should not kill the executing entity', () => {
      const executingEntityId = 1;
      const position = new PositionComponent(100, 100);
      const executingHealth = new HealthComponent(100, 100);

      entityManager.getEntitiesWithComponents.and.returnValue([executingEntityId]);
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, componentType: ComponentType<T>): T | undefined => {
          if (id === executingEntityId) {
            if (isComponentType(componentType, PositionComponent)) return position as unknown as T;
            if (isComponentType(componentType, HealthComponent)) return executingHealth as unknown as T;
          }
          return undefined;
        }
      );

      serviceTest.executeClawSlam(executingEntityId, position, entityManager);

      expect(executingHealth.health).toBe(100);
    });
  });

  describe('executeSummonMinions', () => {
    const OWNER_ID = 10;

    function setupOwnerFaction(factionId: number): void {
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, componentType: ComponentType<T>): T | undefined => {
          if (id === OWNER_ID && isComponentType(componentType, FactionComponent)) {
            return new FactionComponent(factionId) as unknown as T;
          }
          return undefined;
        }
      );
    }

    it('should spawn SPAWN_COUNT minions when slots are fully available', () => {
      minionTrackerSpy.getAliveCount.and.returnValue(0);
      setupOwnerFaction(1);
      const position = new PositionComponent(200, 200);

      serviceTest.executeSummonMinions(OWNER_ID, position, entityManager);

      expect(entityFactorySpy.createEnemy).toHaveBeenCalledTimes(NPC_ABILITY_CONFIG.SUMMON_MINIONS.SPAWN_COUNT);
    });

    it('should spawn only remaining slots when partially capped', () => {
      // 2 alive, max 3 → only 1 slot remaining; SPAWN_COUNT=2 but cap at 1
      minionTrackerSpy.getAliveCount.and.returnValue(2);
      setupOwnerFaction(1);
      const position = new PositionComponent(200, 200);

      serviceTest.executeSummonMinions(OWNER_ID, position, entityManager);

      expect(entityFactorySpy.createEnemy).toHaveBeenCalledTimes(1);
    });

    it('should spawn 0 and not call createEnemy when fully capped', () => {
      minionTrackerSpy.getAliveCount.and.returnValue(NPC_ABILITY_CONFIG.SUMMON_MINIONS.MAX_ALIVE);
      setupOwnerFaction(1);
      const position = new PositionComponent(200, 200);

      serviceTest.executeSummonMinions(OWNER_ID, position, entityManager);

      expect(entityFactorySpy.createEnemy).not.toHaveBeenCalled();
    });

    it('should add MinionTagComponent to each spawned minion with ownerId', () => {
      minionTrackerSpy.getAliveCount.and.returnValue(0);
      setupOwnerFaction(1);
      const position = new PositionComponent(200, 200);

      serviceTest.executeSummonMinions(OWNER_ID, position, entityManager);

      const addComponentCalls = entityManager.addComponent.calls.allArgs();
      const minionTagCalls = addComponentCalls.filter(([, comp]) => comp instanceof MinionTagComponent);
      expect(minionTagCalls.length).toBe(NPC_ABILITY_CONFIG.SUMMON_MINIONS.SPAWN_COUNT);
      minionTagCalls.forEach(([, comp]) => {
        expect((comp as MinionTagComponent).ownerId).toBe(OWNER_ID);
      });
    });

    it('should call minionTracker.recordSpawn once per spawned minion', () => {
      minionTrackerSpy.getAliveCount.and.returnValue(0);
      setupOwnerFaction(1);
      const position = new PositionComponent(200, 200);

      serviceTest.executeSummonMinions(OWNER_ID, position, entityManager);

      expect(minionTrackerSpy.recordSpawn).toHaveBeenCalledTimes(NPC_ABILITY_CONFIG.SUMMON_MINIONS.SPAWN_COUNT);
      minionTrackerSpy.recordSpawn.calls.allArgs().forEach(([ownerId]) => {
        expect(ownerId).toBe(OWNER_ID);
      });
    });

    it('should pass owner factionId to createEnemy', () => {
      const factionId = 3;
      minionTrackerSpy.getAliveCount.and.returnValue(0);
      setupOwnerFaction(factionId);
      const position = new PositionComponent(200, 200);

      serviceTest.executeSummonMinions(OWNER_ID, position, entityManager);

      entityFactorySpy.createEnemy.calls.allArgs().forEach((args) => {
        // args: [x, y, type, rarity, isElite, factionId]
        expect(args[5]).toBe(factionId);
      });
    });
  });

  describe('executeTeleportBlink', () => {
    const ENTITY_ID = 99;
    const PLAYER_X = 400;
    const PLAYER_Y = 300;

    function buildBlink(
      hasRenderable: boolean,
      hasInvincibility: boolean
    ): { playerPos: PositionComponent; renderable: RenderableComponent; invincibility: InvincibilityComponent } {
      const playerPos = new PositionComponent(PLAYER_X, PLAYER_Y);
      const renderable = new RenderableComponent('enemy');
      renderable.opacity = 1.0;
      const invincibility = new InvincibilityComponent();

      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, RenderableComponent))
            return hasRenderable ? (renderable as unknown as T) : undefined;
          if (isComponentType(type, InvincibilityComponent))
            return hasInvincibility ? (invincibility as unknown as T) : undefined;
          return undefined;
        }
      );

      return { playerPos, renderable, invincibility };
    }

    it('attaches TeleportEffectComponent with targetX/Y within [180, 320] of player', () => {
      const { playerPos } = buildBlink(false, false);

      serviceTest.executeTeleportBlink(ENTITY_ID, playerPos, entityManager);

      const addCalls = entityManager.addComponent.calls.allArgs();
      const tpCall = addCalls.find(([, comp]) => comp instanceof TeleportEffectComponent);
      expect(tpCall).toBeDefined();

      const tp = tpCall![1] as TeleportEffectComponent;
      const dx = tp.targetX - PLAYER_X;
      const dy = tp.targetY - PLAYER_Y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeGreaterThanOrEqual(180 - 1); // small float tolerance
      expect(dist).toBeLessThanOrEqual(320 + 1);
    });

    it('sets RenderableComponent opacity to 0 (invisible during blink)', () => {
      const { playerPos, renderable } = buildBlink(true, false);

      serviceTest.executeTeleportBlink(ENTITY_ID, playerPos, entityManager);

      expect(renderable.opacity).toBe(0);
    });

    it('attaches InvincibilityComponent when none exists', () => {
      const { playerPos } = buildBlink(false, false);

      serviceTest.executeTeleportBlink(ENTITY_ID, playerPos, entityManager);

      const addCalls = entityManager.addComponent.calls.allArgs();
      const invCall = addCalls.find(([, comp]) => comp instanceof InvincibilityComponent);
      expect(invCall).toBeDefined();
    });

    it('resets existing InvincibilityComponent instead of attaching a new one', () => {
      const { playerPos } = buildBlink(false, true);

      const addCallsBefore = entityManager.addComponent.calls.count();
      serviceTest.executeTeleportBlink(ENTITY_ID, playerPos, entityManager);

      // addComponent should NOT have been called with an InvincibilityComponent
      const addCalls = entityManager.addComponent.calls.allArgs();
      const invAdded = addCalls.slice(addCallsBefore).find(([, comp]) => comp instanceof InvincibilityComponent);
      expect(invAdded).toBeUndefined();
    });

    // ── Campaign E — Sprint E1: world-bounds clamp (Finding 4) ──────────────

    it('clamps targetX to [0, WORLD_WIDTH] when player is near the right edge', () => {
      // Player near the right-world edge: x=11900, distance=320 → unclamped x could be 12220
      const edgePlayerPos = new PositionComponent(11900, 4500);
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, RenderableComponent)) return undefined;
          if (isComponentType(type, InvincibilityComponent)) return undefined;
          return undefined;
        }
      );

      // Run 50 times to exercise multiple random angles
      for (let i = 0; i < 50; i++) {
        entityManager.addComponent.calls.reset();
        serviceTest.executeTeleportBlink(ENTITY_ID, edgePlayerPos, entityManager);

        const tpCall = entityManager.addComponent.calls
          .allArgs()
          .find(([, comp]) => comp instanceof TeleportEffectComponent);
        expect(tpCall).toBeDefined();
        const tp = tpCall![1] as TeleportEffectComponent;
        expect(tp.targetX).toBeGreaterThanOrEqual(0);
        expect(tp.targetX).toBeLessThanOrEqual(12000);
      }
    });

    it('clamps targetY to [0, WORLD_HEIGHT] when player is near the bottom edge', () => {
      // Player near the bottom edge: y=8900, distance=320 → unclamped y could be 9220
      const edgePlayerPos = new PositionComponent(6000, 8900);
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, RenderableComponent)) return undefined;
          if (isComponentType(type, InvincibilityComponent)) return undefined;
          return undefined;
        }
      );

      for (let i = 0; i < 50; i++) {
        entityManager.addComponent.calls.reset();
        serviceTest.executeTeleportBlink(ENTITY_ID, edgePlayerPos, entityManager);

        const tpCall = entityManager.addComponent.calls
          .allArgs()
          .find(([, comp]) => comp instanceof TeleportEffectComponent);
        expect(tpCall).toBeDefined();
        const tp = tpCall![1] as TeleportEffectComponent;
        expect(tp.targetY).toBeGreaterThanOrEqual(0);
        expect(tp.targetY).toBeLessThanOrEqual(9000);
      }
    });

    it('clamps both axes when player is in the top-left corner', () => {
      // Player at (50, 50) with distance up to 320 → many angles produce negative coords
      const cornerPlayerPos = new PositionComponent(50, 50);
      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== ENTITY_ID) return undefined;
          if (isComponentType(type, RenderableComponent)) return undefined;
          if (isComponentType(type, InvincibilityComponent)) return undefined;
          return undefined;
        }
      );

      for (let i = 0; i < 50; i++) {
        entityManager.addComponent.calls.reset();
        serviceTest.executeTeleportBlink(ENTITY_ID, cornerPlayerPos, entityManager);

        const tpCall = entityManager.addComponent.calls
          .allArgs()
          .find(([, comp]) => comp instanceof TeleportEffectComponent);
        expect(tpCall).toBeDefined();
        const tp = tpCall![1] as TeleportEffectComponent;
        expect(tp.targetX).toBeGreaterThanOrEqual(0);
        expect(tp.targetX).toBeLessThanOrEqual(12000);
        expect(tp.targetY).toBeGreaterThanOrEqual(0);
        expect(tp.targetY).toBeLessThanOrEqual(9000);
      }
    });
  });

  // ── Campaign C — arena hazard on phase transition ─────────────────────────

  describe('transitionBossPhase spawns arena hazard', () => {
    const BOSS_ID = 10;
    const BOSS_X = 400;
    const BOSS_Y = 350;

    function buildBoss(archetype: 'standard' | 'swarm_king' | 'pyroclast' = 'standard'): {
      bossPhase: BossPhaseComponent;
      abilityComp: AbilityComponent;
      pos: PositionComponent;
    } {
      const bossPhase = new BossPhaseComponent(1, 4, [0.75, 0.5, 0.25], archetype);
      bossPhase.baseFireRate = 500;
      const abilityComp = new AbilityComponent();
      const pos = new PositionComponent(BOSS_X, BOSS_Y);

      entityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== BOSS_ID) return undefined;
          if (isComponentType(type, PositionComponent)) return pos as unknown as T;
          if (isComponentType(type, WeaponComponent)) return undefined;
          return undefined;
        }
      );

      return { bossPhase, abilityComp, pos };
    }

    it('calls entityFactory.createArenaHazard with the boss position and archetype on phase transition', () => {
      const { bossPhase, abilityComp } = buildBoss('standard');

      serviceTest.transitionBossPhase(BOSS_ID, bossPhase, abilityComp, entityManager, Date.now(), 2);

      expect(entityFactorySpy.createArenaHazard).toHaveBeenCalledOnceWith(BOSS_X, BOSS_Y, 'standard');
    });

    it('passes the correct archetype to createArenaHazard for pyroclast', () => {
      const { bossPhase, abilityComp } = buildBoss('pyroclast');

      serviceTest.transitionBossPhase(BOSS_ID, bossPhase, abilityComp, entityManager, Date.now(), 2);

      expect(entityFactorySpy.createArenaHazard).toHaveBeenCalledOnceWith(BOSS_X, BOSS_Y, 'pyroclast');
    });

    it('passes the correct archetype to createArenaHazard for swarm_king', () => {
      const { bossPhase, abilityComp } = buildBoss('swarm_king');

      serviceTest.transitionBossPhase(BOSS_ID, bossPhase, abilityComp, entityManager, Date.now(), 2);

      expect(entityFactorySpy.createArenaHazard).toHaveBeenCalledOnceWith(BOSS_X, BOSS_Y, 'swarm_king');
    });
  });
});
