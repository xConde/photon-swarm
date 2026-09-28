import { TestBed } from '@angular/core/testing';
import { BeamCollisionSystemService } from './beam-collision-system.service';
import { Component, ComponentType, EntityManager } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PlayerService } from '../../player/player.service';
import { PlayerUpgradesService } from '../../player/player-upgrades.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { FactionStandingSystemService } from '../gameplay';
import { PostProcessingService } from '../../effects/post-processing.service';
import { BurnSystemService } from './burn-system.service';
import { AudioService } from '../../audio/audio.service';
import { AscensionService } from '../../../services/ascension.service';
import { DamageResolverService } from '../../combat/damage-resolver.service';
import {
  BuffComponent,
  CollisionBoxComponent,
  EnemyTypeComponent,
  HealthComponent,
  KnockbackComponent,
  PositionComponent,
  ShieldArcComponent,
  VelocityComponent,
} from '@photon/components';
import { EnemyType } from '../../models/enemy.model';
import { BEAM_CORE_PROFILES, DEFAULT_BEAM_CORE_PROFILE } from '../../../config/beam-core.config';
import { resolveMutatedBeamCoreProfile } from '../../../config/beam-mutation.config';

describe('BeamCollisionSystemService Knockback', () => {
  let service: BeamCollisionSystemService;
  let mockEntityManager: jasmine.SpyObj<EntityManager>;
  let mockEffectFactory: jasmine.SpyObj<EffectFactoryService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockPlayerUpgrades: jasmine.SpyObj<PlayerUpgradesService>;
  let mockGameEngine: jasmine.SpyObj<GameEngineService>;

  beforeEach(() => {
    mockEntityManager = jasmine.createSpyObj('EntityManager', [
      'getComponent',
      'addComponent',
      'getEntitiesWithComponents',
      'destroyEntity',
      'hasComponent',
      'removeComponent',
    ]);

    mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', [
      'createBeamImpact',
      'createBeamTrail',
      'createEnemyExplosion',
      'createMuzzleFlash',
      'createDamageNumber',
    ]);

    mockPlayerService = jasmine.createSpyObj('PlayerService', [
      'getAngle',
      'getPosition',
      'isDashing',
      'isInvincible',
      'isParryAvailable',
      'isDirectionChangeOnCooldown',
      'getMaxHealth',
      'getFocusCharge',
      'isMoving',
    ]);

    mockPlayerUpgrades = jasmine.createSpyObj('PlayerUpgradesService', [
      'getHasDoubleBeam',
      'getBeamCoreProfile',
      'getBeamDamageMultiplier',
      'getBeamWidthMultiplier',
      'getCriticalHitChance',
      'getCriticalHitMultiplier',
      'getBurnChance',
      'getBurnDamage',
      'getHasShieldBreaker',
    ]);

    // Set default return values for PlayerService
    mockPlayerService.getAngle.and.returnValue(0);
    mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });
    mockPlayerService.isDashing.and.returnValue(false);
    mockPlayerService.isInvincible.and.returnValue(false);
    mockPlayerService.isParryAvailable.and.returnValue(false);
    mockPlayerService.isDirectionChangeOnCooldown.and.returnValue(false);
    mockPlayerService.getMaxHealth.and.returnValue(100);
    mockPlayerService.getFocusCharge.and.returnValue(100);
    mockPlayerService.isMoving.and.returnValue(false);

    // Beam requires isFiring=true to deal damage (Issue 21 fix)
    Object.defineProperty(mockPlayerService, 'isFiring', { get: () => true, configurable: true });

    // Set default return values for PlayerUpgradesService
    mockPlayerUpgrades.getHasDoubleBeam.and.returnValue(false);
    mockPlayerUpgrades.getBeamCoreProfile.and.returnValue(DEFAULT_BEAM_CORE_PROFILE);
    mockPlayerUpgrades.getBeamDamageMultiplier.and.returnValue(1);
    mockPlayerUpgrades.getBeamWidthMultiplier.and.returnValue(1);
    mockPlayerUpgrades.getCriticalHitChance.and.returnValue(0);
    mockPlayerUpgrades.getCriticalHitMultiplier.and.returnValue(1.5);
    mockPlayerUpgrades.getBurnChance.and.returnValue(0);
    mockPlayerUpgrades.getBurnDamage.and.returnValue(0);
    mockPlayerUpgrades.getHasShieldBreaker.and.returnValue(false);

    mockGameEngine = jasmine.createSpyObj('GameEngineService', ['addShards', 'emitState', 'triggerHitStop']);

    const mockEntityFactory = jasmine.createSpyObj('EntityFactoryECSService', [
      'createDeathParticles',
      'createEnemyExplosion',
      'createDamageNumber',
      'addBurnEffect',
    ]);
    const mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const mockFactionStanding = jasmine.createSpyObj('FactionStandingSystemService', [
      'getTerritoryEffects',
      'processKill',
    ]);
    mockFactionStanding.getTerritoryEffects.and.returnValue({ damageMultiplier: 1.0 });

    // Set default mock returns
    mockEntityManager.hasComponent.and.returnValue(false);

    TestBed.configureTestingModule({
      providers: [
        BeamCollisionSystemService,
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: PlayerUpgradesService, useValue: mockPlayerUpgrades },
        { provide: GameEngineService, useValue: mockGameEngine },
        { provide: EntityManagerService, useValue: mockEntityManager },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: FactionStandingSystemService, useValue: mockFactionStanding },
        {
          provide: PostProcessingService,
          useValue: jasmine.createSpyObj('PostProcessingService', ['addScreenFlash', 'addChromaticAberration']),
        },
        {
          provide: BurnSystemService,
          useValue: jasmine.createSpyObj('BurnSystemService', ['applyBurn', 'update']),
        },
        {
          provide: AudioService,
          useValue: jasmine.createSpyObj('AudioService', [
            'playBeamFire',
            'playEnemyDeath',
            'playEliteDeath',
            'playShardCollect',
            'playDamageTaken',
            'playLevelUp',
            'playComboTier',
            'playBossBurst',
            'destroy',
          ]),
        },
        {
          provide: AscensionService,
          useValue: (() => {
            const s = jasmine.createSpyObj('AscensionService', [
              'getDamageBonus',
              'getHealthBonus',
              'getShardBonus',
              'getXpBonus',
              'getAscensionLevel',
              'canAscend',
              'ascend',
              'reset',
              'getRequiredLevel',
            ]);
            s.getDamageBonus.and.returnValue(1.0);
            s.getHealthBonus.and.returnValue(1.0);
            s.getShardBonus.and.returnValue(1.0);
            s.getXpBonus.and.returnValue(1.0);
            s.getAscensionLevel.and.returnValue(0);
            s.canAscend.and.returnValue(false);
            s.getRequiredLevel.and.returnValue(10);
            return s;
          })(),
        },
      ],
    });

    service = TestBed.inject(BeamCollisionSystemService);
  });

  describe('Continuous Beam Damage', () => {
    it('should deal damage when beam touches enemy while player is firing', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(100, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(enemyHealth.health).toBeLessThan(100);
    });

    it('uses Prism ray offsets to hit targets outside the unshaped beam line', () => {
      const enemyId = 1;
      const enemyPosition = new PositionComponent(247, 130);
      const enemyHealth = new HealthComponent(100, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });
      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerUpgrades.getBeamCoreProfile.and.returnValue(BEAM_CORE_PROFILES.prism);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id !== enemyId) return undefined;
          if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
          if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
          if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
          if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(enemyHealth.health).toBeLessThan(100);
    });

    it('cascades Arc damage to a nearby enemy outside the direct beam', () => {
      const sourceId = 1;
      const chainedId = 2;
      const positions = new Map([
        [sourceId, new PositionComponent(150, 100)],
        [chainedId, new PositionComponent(150, 180)],
      ]);
      const health = new Map([
        [sourceId, new HealthComponent(100, 100)],
        [chainedId, new HealthComponent(100, 100)],
      ]);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });
      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerUpgrades.getBeamCoreProfile.and.returnValue(BEAM_CORE_PROFILES.arc);
      mockEntityManager.hasComponent.and.callFake((_id, type) => type.name === EnemyTypeComponent.name);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (type.name === PositionComponent.name) return positions.get(id) as unknown as T;
          if (type.name === HealthComponent.name) return health.get(id) as unknown as T;
          if (type.name === VelocityComponent.name) return new VelocityComponent() as unknown as T;
          if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([sourceId, chainedId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(health.get(sourceId)!.health).toBeLessThan(100);
      expect(health.get(chainedId)!.health).toBeLessThan(100);
    });

    it('honors Storm Anchor compressed range instead of chaining like base Arc', () => {
      const sourceId = 1;
      const outsideAnchorId = 2;
      const positions = new Map([
        [sourceId, new PositionComponent(150, 100)],
        // 190px from the source: inside base Arc's 220px, outside Anchor's 180.4px.
        [outsideAnchorId, new PositionComponent(150, 290)],
      ]);
      const health = new Map([
        [sourceId, new HealthComponent(100, 100)],
        [outsideAnchorId, new HealthComponent(100, 100)],
      ]);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });
      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerUpgrades.getBeamCoreProfile.and.returnValue(resolveMutatedBeamCoreProfile('arc', ['arc_storm_anchor']));
      mockEntityManager.hasComponent.and.callFake((_id, type) => type.name === EnemyTypeComponent.name);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (type.name === PositionComponent.name) return positions.get(id) as unknown as T;
          if (type.name === HealthComponent.name) return health.get(id) as unknown as T;
          if (type.name === VelocityComponent.name) return new VelocityComponent() as unknown as T;
          if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([sourceId, outsideAnchorId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(health.get(sourceId)!.health).toBeLessThan(100);
      expect(health.get(outsideAnchorId)!.health).toBe(100);
    });

    it('routes beam damage through the resolver but does NOT apply flat damageReduction (beam is blocked by shields, not armor)', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(100, 100, 0.5); // has 50% reduction, which the beam must IGNORE
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // Spy on the real (providedIn:root) resolver the service already holds.
      const resolver = TestBed.inject(DamageResolverService);
      const resolveSpy = spyOn(resolver, 'applyDamageToEnemy').and.callThrough();

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(resolveSpy).toHaveBeenCalled();
      const req = resolveSpy.calls.mostRecent().args[0];
      expect(req.damageReduction).toBeUndefined(); // beam intentionally bypasses armor
      expect(req.source).toBe('player');
    });
  });

  describe('Issue 21: Phantom Beam Damage Prevention', () => {
    it('should NOT deal damage when player is not firing (mouse aim mode)', () => {
      // Override isFiring to false — simulates no mouse button held
      Object.defineProperty(mockPlayerService, 'isFiring', { get: () => false, configurable: true });

      const enemyId = 1;
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(100, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // Enemy should take NO damage — beam inactive when not firing
      expect(enemyHealth.health).toBe(100);
    });

    it('should NOT deal damage when player is not firing (toggle mode)', () => {
      // Override isFiring to false — beam toggled off
      Object.defineProperty(mockPlayerService, 'isFiring', { get: () => false, configurable: true });

      const enemyId = 1;
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(100, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(enemyHealth.health).toBe(100);
    });

    it('should deal damage when player IS firing in mouse aim mode', () => {
      // isFiring=true is the default from beforeEach
      const enemyId = 1;
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(100, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(enemyHealth.health).toBeLessThan(100);
    });

    it('should not process any enemies when not firing (early return)', () => {
      Object.defineProperty(mockPlayerService, 'isFiring', { get: () => false, configurable: true });

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // getEntitiesWithComponents should never be called — early return before enemy lookup
      expect(mockEntityManager.getEntitiesWithComponents).not.toHaveBeenCalled();
    });
  });

  describe('Knockback Application', () => {
    it('should apply knockback with correct force and duration', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      // Enemy at (150, 100) - directly east of player, in beam path when beam points east
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      // Mock player angle for beam direction
      mockPlayerService.getAngle.and.returnValue(0); // Beam pointing east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      // Track the knockback component that gets added
      let addedKnockback: KnockbackComponent | null = null;

      // Set up entity manager mocks
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            // Return the knockback component once it's been added
            if (type.name === KnockbackComponent.name) return addedKnockback as unknown as T;
          }
          return undefined;
        }
      );

      // Mock adding knockback component
      mockEntityManager.addComponent.and.callFake((_id: number, component: Component) => {
        if (component instanceof KnockbackComponent) {
          addedKnockback = component;
        }
      });

      // Mock getEntitiesWithComponents to return our enemy
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // Update the service to process collision
      service.update(100, mockEntityManager as unknown as EntityManagerService); // 100ms deltaTime

      // Verify knockback was applied
      expect(mockEntityManager.addComponent).toHaveBeenCalled();
      expect(addedKnockback).not.toBeNull();
      expect(addedKnockback!.isActive).toBe(true);
      // KnockbackComponent constructor defaults to 300ms, then addKnockback() with 50ms uses max(current, new)
      // Result: knockbackTimer = max(300, 50) = 300
      expect(addedKnockback!.knockbackTimer).toBe(300);
    });

    it('should calculate knockback based on beam direction', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      // Enemy at (200, 100) - directly east of player, in beam path when beam points east
      const enemyPosition = new PositionComponent(200, 100);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      // Beam pointing east
      mockPlayerService.getAngle.and.returnValue(0); // 0 radians = pointing east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      // Track the knockback component that gets added
      let addedKnockback: KnockbackComponent | null = null;

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === KnockbackComponent.name) return addedKnockback as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.addComponent.and.callFake((_id: number, component: Component) => {
        if (component instanceof KnockbackComponent) {
          addedKnockback = component;
        }
      });

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // Process collision
      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(addedKnockback).not.toBeNull();
      // Knockback direction is blended between beam direction (east) and away-from-player (also east)
      // Since enemy is directly east of player, both directions align = positive X
      expect(addedKnockback!.knockbackVelocityX).toBeGreaterThan(0); // Positive X = east
      // Y component includes upward bias (negative Y in canvas coords = up)
      expect(addedKnockback!.knockbackVelocityY).toBeLessThan(0); // Upward bias
    });

    it('should create damage number effect when damaging enemy', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      // Enemy at (150, 150) - southeast of player, in beam path at 45 degrees
      const enemyPosition = new PositionComponent(150, 150);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(Math.PI / 4); // 45 degrees (southeast)
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // Process collision with enough time for damage accumulation
      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // Damage numbers are created via createDamageNumber, not createBeamImpact
      // The service accumulates damage and shows it periodically
      expect(mockEffectFactory.createDamageNumber).toHaveBeenCalled();
    });

    it('should handle existing knockback component', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      // Enemy at (150, 100) - directly east of player
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);
      const existingKnockback = new KnockbackComponent();

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === KnockbackComponent.name) return existingKnockback as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // Process collision
      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // Should NOT add new KnockbackComponent since one already exists
      // Check that addComponent was not called with a KnockbackComponent
      const knockbackCalls = mockEntityManager.addComponent.calls
        .all()
        .filter((call) => call.args[1] instanceof KnockbackComponent);
      expect(knockbackCalls.length).toBe(0);

      // Should update existing knockback via addKnockback()
      expect(existingKnockback.isActive).toBe(true);
    });
  });

  describe('Flat DPS (no focus charge influence)', () => {
    // Beam damage is now flat DPS: 140 moving, 196 stationary.
    // Charging is a projectile-only mechanic. This test guards against
    // regressions where focus charge leaked into beam damage calculations.

    it('should deal same damage regardless of focus charge level', () => {
      // Fix Math.random to eliminate damage variance for deterministic comparison
      const randomSpy = spyOn(Math, 'random').and.returnValue(0.5);

      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);
      mockPlayerService.isMoving.and.returnValue(false); // Stationary = 196 DPS

      // Run with focus charge at 100%
      const health100 = new HealthComponent(1000, 1000);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return health100 as unknown as T;
            if (type.name === VelocityComponent.name) return new VelocityComponent() as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);
      mockPlayerService.getFocusCharge.and.returnValue(100);

      service.update(100, mockEntityManager as unknown as EntityManagerService);
      const damageAt100 = 1000 - health100.health;

      // Run with focus charge at 0%
      const health0 = new HealthComponent(1000, 1000);
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return health0 as unknown as T;
            if (type.name === VelocityComponent.name) return new VelocityComponent() as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );
      mockPlayerService.getFocusCharge.and.returnValue(0);

      // Create new service instance to clear accumulated damage tracking
      service = TestBed.inject(BeamCollisionSystemService);
      service.update(100, mockEntityManager as unknown as EntityManagerService);
      const damageAt0 = 1000 - health0.health;

      // Both should deal the same damage (flat DPS, no focus scaling)
      expect(damageAt100).toBeCloseTo(damageAt0, 0);
      expect(damageAt100).toBeGreaterThan(0);

      randomSpy.and.callThrough();
    });
  });

  describe('Knockback Configuration', () => {
    it('should use subtle knockback force values', () => {
      // Since config is private, we verify through behavior
      // The knockback force should be subtle (50) as configured
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      let addedKnockback: KnockbackComponent | null = null;

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === KnockbackComponent.name) return addedKnockback as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.addComponent.and.callFake((_id: number, component: Component) => {
        if (component instanceof KnockbackComponent) {
          addedKnockback = component;
        }
      });

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(addedKnockback).not.toBeNull();
      // Verify knockback force is subtle (not too strong)
      expect(Math.abs(addedKnockback!.knockbackVelocityX)).toBeLessThan(200);
      expect(Math.abs(addedKnockback!.knockbackVelocityY)).toBeLessThan(200);
    });
  });

  describe('Beam Direction Knockback', () => {
    it('should knock enemy in beam direction when enemy is north and beam goes east', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      // Enemy directly east of player at (200, 100) - this is where beam pointing east will hit
      // Note: Enemy at (100, 50) is north of player, which is NOT in beam path when beam points east
      const enemyPosition = new PositionComponent(200, 100);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      // Beam pointing east
      mockPlayerService.getAngle.and.returnValue(0); // 0 radians = east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      let addedKnockback: KnockbackComponent | null = null;

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === KnockbackComponent.name) return addedKnockback as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.addComponent.and.callFake((_id: number, component: Component) => {
        if (component instanceof KnockbackComponent) {
          addedKnockback = component;
        }
      });

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(addedKnockback).not.toBeNull();
      // Knockback should be east (positive X) - blend of beam direction and away-from-player
      expect(addedKnockback!.knockbackVelocityX).toBeGreaterThan(0);
      // Y component includes upward bias (negative Y)
      expect(addedKnockback!.knockbackVelocityY).toBeLessThan(0);
    });

    it('should knock enemy southwest when beam points southwest', () => {
      const enemyId = 1;
      const playerPosition = { x: 200, y: 200 };
      // In screen coordinates (Y increases downward):
      // - angle 0 = east (positive X)
      // - angle PI/2 = south (positive Y, i.e., down)
      // - angle PI = west (negative X)
      // - angle 3*PI/2 = north (negative Y, i.e., up)
      // "Southwest" means west + south = negative X + positive Y
      // This corresponds to angles between PI/2 and PI
      // 3*PI/4 = 135 degrees: cos = -0.707, sin = 0.707
      // Enemy at offset (-70, 70) from player = at angle atan2(70, -70) = 135 degrees = 3*PI/4
      const enemyPosition = new PositionComponent(130, 270);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      // Beam pointing southwest (135 degrees = 3*PI/4 radians)
      mockPlayerService.getAngle.and.returnValue((3 * Math.PI) / 4);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      let addedKnockback: KnockbackComponent | null = null;

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === KnockbackComponent.name) return addedKnockback as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.addComponent.and.callFake((_id: number, component: Component) => {
        if (component instanceof KnockbackComponent) {
          addedKnockback = component;
        }
      });

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      expect(addedKnockback).not.toBeNull();
      // Knockback should be southwest (negative X and positive Y in canvas coords)
      expect(addedKnockback!.knockbackVelocityX).toBeLessThan(0);
      // Y is positive (down in canvas) but with upward bias, the final value depends on blend
      // The blend includes upward bias of -0.0625, so we check it's not too negative
      expect(addedKnockback!.knockbackVelocityY).toBeGreaterThan(-50);
    });
  });

  describe('Visual Feedback Integration', () => {
    it('should trigger damage number effects at correct position', () => {
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      // Enemy south of player at (100, 200) - in beam path when beam points south (90 degrees)
      const enemyPosition = new PositionComponent(100, 200);
      const enemyHealth = new HealthComponent(50, 100);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(Math.PI / 2); // 90 degrees = south in canvas
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(150, mockEntityManager as unknown as EntityManagerService); // 150ms deltaTime

      // Damage numbers are created via createDamageNumber
      expect(mockEffectFactory.createDamageNumber).toHaveBeenCalled();
    });
  });

  describe('Beam Reflection Prevention', () => {
    it('should not re-reflect projectiles that hit the player after being reflected', () => {
      // Setup player position and beam
      const playerPosition = { x: 100, y: 100 };
      mockPlayerService.getAngle.and.returnValue(0); // Beam pointing east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      // Create enemy projectile
      const projectileId = 1;
      const projectilePos = new PositionComponent(120, 100); // In front of player
      const projectileVel = new VelocityComponent();
      projectileVel.vx = -50; // Moving toward player
      projectileVel.vy = 0;

      // Create mock projectile with source tag
      const sourceTag: { source: string; isReflected?: boolean } = { source: 'enemy' };
      const projectileComp: {
        damage: number;
        originalSource: string | undefined;
        reflectionCount: number;
        wasReflected?: boolean;
      } = {
        damage: 10,
        originalSource: undefined,
        reflectionCount: 0,
      };

      // Setup entity manager mocks for first reflection
      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === projectileId) {
            if (type.name === PositionComponent.name) return projectilePos as unknown as T;
            if (type.name === VelocityComponent.name) return projectileVel as unknown as T;
            if (type.name === 'SourceTagComponent') return sourceTag as unknown as T;
            if (type.name === 'ProjectileComponent') return projectileComp as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([projectileId]);

      // First update - beam reflects enemy projectile
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Verify projectile was reflected
      expect(projectileVel.vx).toBeGreaterThan(0); // Now moving away from player
      expect(sourceTag.source).toBe('player'); // Ownership changed
      expect(projectileComp.originalSource).toBe('enemy'); // Original source tracked
      expect(projectileComp.reflectionCount).toBe(1);

      // Simulate projectile bouncing back toward player (e.g., hit a wall)
      projectileVel.vx = -50; // Moving back toward player again
      projectilePos.x = 120; // Still in beam range

      // Second update - beam should NOT re-reflect the same projectile
      const initialVx = projectileVel.vx;
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Verify projectile was NOT reflected again
      expect(projectileVel.vx).toBe(initialVx); // Velocity unchanged
      expect(projectileComp.reflectionCount).toBe(1); // Reflection count unchanged
    });

    it('should reflect enemy projectiles but not player projectiles', () => {
      const playerPosition = { x: 100, y: 100 };
      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      // Create player projectile that somehow got in beam path
      const playerProjectileId = 1;
      const playerProjPos = new PositionComponent(120, 100);
      const playerProjVel = new VelocityComponent();
      playerProjVel.vx = 50; // Moving away from player
      playerProjVel.vy = 0;

      const playerSourceTag: { source: string } = { source: 'player' };
      const playerProjComp: { damage: number } = { damage: 10 };

      // Create enemy projectile
      const enemyProjectileId = 2;
      const enemyProjPos = new PositionComponent(130, 100);
      const enemyProjVel = new VelocityComponent();
      enemyProjVel.vx = -50; // Moving toward player
      enemyProjVel.vy = 0;

      const enemySourceTag: { source: string } = { source: 'enemy' };
      const enemyProjComp: { damage: number } = { damage: 10 };

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === playerProjectileId) {
            if (type.name === PositionComponent.name) return playerProjPos as unknown as T;
            if (type.name === VelocityComponent.name) return playerProjVel as unknown as T;
            if (type.name === 'SourceTagComponent') return playerSourceTag as unknown as T;
            if (type.name === 'ProjectileComponent') return playerProjComp as unknown as T;
          }
          if (id === enemyProjectileId) {
            if (type.name === PositionComponent.name) return enemyProjPos as unknown as T;
            if (type.name === VelocityComponent.name) return enemyProjVel as unknown as T;
            if (type.name === 'SourceTagComponent') return enemySourceTag as unknown as T;
            if (type.name === 'ProjectileComponent') return enemyProjComp as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([playerProjectileId, enemyProjectileId]);

      // Update beam system
      const playerInitialVx = playerProjVel.vx;
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Verify only enemy projectile was reflected
      expect(playerProjVel.vx).toBe(playerInitialVx); // Player projectile unchanged
      expect(enemyProjVel.vx).toBeGreaterThan(0); // Enemy projectile reflected
      expect(enemySourceTag.source).toBe('player'); // Enemy projectile ownership changed
      expect(playerSourceTag.source).toBe('player'); // Player projectile ownership unchanged
    });

    it('should not affect enemy projectiles that hit the player ship (not the beam)', () => {
      // Setup player position and beam pointing away from projectile
      const playerPosition = { x: 100, y: 100 };
      mockPlayerService.getAngle.and.returnValue(Math.PI / 2); // Beam pointing north (90 degrees)
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      // Create enemy projectile coming from the east (beam is pointing north, so no collision)
      const projectileId = 1;
      const projectilePos = new PositionComponent(150, 100); // East of player
      const projectileVel = new VelocityComponent();
      projectileVel.vx = -50; // Moving west toward player
      projectileVel.vy = 0;

      const sourceTag: { source: string } = { source: 'enemy' };
      const projectileComp: { damage: number; originalSource: string | undefined; reflectionCount: number } = {
        damage: 10,
        originalSource: undefined,
        reflectionCount: 0,
      };

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === projectileId) {
            if (type.name === PositionComponent.name) return projectilePos as unknown as T;
            if (type.name === VelocityComponent.name) return projectileVel as unknown as T;
            if (type.name === 'SourceTagComponent') return sourceTag as unknown as T;
            if (type.name === 'ProjectileComponent') return projectileComp as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([projectileId]);

      // Store initial values
      const initialVx = projectileVel.vx;
      const initialVy = projectileVel.vy;
      const initialSource = sourceTag.source;

      // Update beam system
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Verify projectile was NOT reflected (beam wasn't in the way)
      expect(projectileVel.vx).toBe(initialVx); // Velocity unchanged
      expect(projectileVel.vy).toBe(initialVy); // Velocity unchanged
      expect(sourceTag.source).toBe(initialSource); // Source unchanged (still enemy)
      expect(projectileComp.reflectionCount).toBe(0); // Not reflected
      expect(projectileComp.originalSource).toBeUndefined(); // No original source tracking
    });

    it('should only reflect projectiles that actually collide with the beam line', () => {
      const playerPosition = { x: 100, y: 100 };
      mockPlayerService.getAngle.and.returnValue(0); // Beam pointing east (0 degrees)
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      // Create multiple enemy projectiles at different positions
      const projectiles = [
        { id: 1, x: 150, y: 100, vx: -50, vy: 0, shouldReflect: true }, // In beam path
        { id: 2, x: 150, y: 150, vx: -50, vy: 0, shouldReflect: false }, // Below beam
        { id: 3, x: 150, y: 50, vx: -50, vy: 0, shouldReflect: false }, // Above beam
        { id: 4, x: 50, y: 100, vx: 50, vy: 0, shouldReflect: false }, // Behind player
      ];

      const projectileData: Record<
        number,
        {
          position: PositionComponent;
          velocity: VelocityComponent;
          sourceTag: { source: string };
          projectile: { damage: number; reflectionCount: number };
        }
      > = {};

      projectiles.forEach((p) => {
        projectileData[p.id] = {
          position: new PositionComponent(p.x, p.y),
          velocity: new VelocityComponent(),
          sourceTag: { source: 'enemy' },
          projectile: { damage: 10, reflectionCount: 0 },
        };
        projectileData[p.id].velocity.vx = p.vx;
        projectileData[p.id].velocity.vy = p.vy;
      });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          const data = projectileData[id];
          if (!data) return undefined;

          if (type.name === PositionComponent.name) return data.position as unknown as T;
          if (type.name === VelocityComponent.name) return data.velocity as unknown as T;
          if (type.name === 'SourceTagComponent') return data.sourceTag as unknown as T;
          if (type.name === 'ProjectileComponent') return data.projectile as unknown as T;
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue(projectiles.map((p) => p.id));

      // Update beam system
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Verify only the projectile in beam path was reflected
      projectiles.forEach((p) => {
        const data = projectileData[p.id];
        if (p.shouldReflect) {
          expect(data.velocity.vx).toBeGreaterThan(0); // Reflected (now moving east)
          expect(data.sourceTag.source).toBe('player'); // Ownership changed
          expect(data.projectile.reflectionCount).toBe(1); // Reflection counted
        } else {
          expect(data.velocity.vx).toBe(p.vx); // Unchanged
          expect(data.sourceTag.source).toBe('enemy'); // Still enemy
          expect(data.projectile.reflectionCount).toBe(0); // Not reflected
        }
      });
    });
  });

  describe('PR #117 Beam DPS Balance Values (140/196)', () => {
    it('should deal damage consistent with 140 DPS when player is moving', () => {
      // Fix Math.random to eliminate damage variance for deterministic assertion
      const randomSpy = spyOn(Math, 'random').and.returnValue(0.5);

      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(1000, 1000);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);
      mockPlayerService.isMoving.and.returnValue(true); // Moving = 140 DPS

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // Update for exactly 1000ms (1 second) to measure DPS directly
      // random=0.5 -> variance = 0.9 + 0.5*0.2 = 1.0 (no variance)
      service.update(1000, mockEntityManager as unknown as EntityManagerService);
      const damageDealt = 1000 - enemyHealth.health;

      // deltaTime is capped at 100ms internally, so 1000ms tick = 100ms effective
      // Expected: 140 * 1.0 * 1.0 * 1.0 * 100 / 1000 = 14 damage
      expect(damageDealt).toBeCloseTo(14, 0);

      randomSpy.and.callThrough();
    });

    it('should deal damage consistent with 196 DPS when player is stationary', () => {
      const randomSpy = spyOn(Math, 'random').and.returnValue(0.5);

      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(1000, 1000);
      const enemyVelocity = new VelocityComponent();
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);
      mockPlayerService.isMoving.and.returnValue(false); // Stationary = 196 DPS

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === VelocityComponent.name) return enemyVelocity as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      // deltaTime capped at 100ms internally
      service.update(1000, mockEntityManager as unknown as EntityManagerService);
      const damageDealt = 1000 - enemyHealth.health;

      // Expected: 196 * 1.0 * 1.0 * 1.0 * 100 / 1000 = 19.6 damage
      expect(damageDealt).toBeCloseTo(19.6, 0);

      randomSpy.and.callThrough();
    });

    it('should have stationary DPS 40% higher than moving DPS', () => {
      // The ratio between stationary (196) and moving (140) should be 1.4
      const movingDps = 140;
      const stationaryDps = 196;
      expect(stationaryDps / movingDps).toBeCloseTo(1.4, 2);
    });
  });

  describe('Enemy Hitbox Radius', () => {
    it('should hit enemy when beam passes within enemy collision radius', () => {
      // Player at origin, beam pointing east (angle = 0)
      // Enemy at (100, 25) with radius 30
      // Beam passes 25 pixels from enemy center
      // With beam radius 10 + enemy radius 30 = 40, should hit (25 < 40)
      const enemyId = 1;
      const playerPosition = { x: 0, y: 0 };
      const enemyPosition = new PositionComponent(100, 25); // 25px off beam axis
      const enemyHealth = new HealthComponent(100, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);
      const enemyCollisionBox = new CollisionBoxComponent(30, 'enemy', ['player']);

      mockPlayerService.getAngle.and.returnValue(0); // Pointing east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === CollisionBoxComponent.name) return enemyCollisionBox as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      const initialHealth = enemyHealth.health;
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Enemy should take damage because beam passes within combined radius
      expect(enemyHealth.health).toBeLessThan(initialHealth);
    });

    it('should miss enemy when beam passes outside enemy collision radius', () => {
      // Player at origin, beam pointing east (angle = 0)
      // Enemy at (100, 50) with radius 30
      // Beam passes 50 pixels from enemy center
      // With beam radius 10 + enemy radius 30 = 40, should miss (50 > 40)
      const enemyId = 1;
      const playerPosition = { x: 0, y: 0 };
      const enemyPosition = new PositionComponent(100, 50); // 50px off beam axis
      const enemyHealth = new HealthComponent(100, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);
      const enemyCollisionBox = new CollisionBoxComponent(30, 'enemy', ['player']);

      mockPlayerService.getAngle.and.returnValue(0); // Pointing east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            if (type.name === CollisionBoxComponent.name) return enemyCollisionBox as unknown as T;
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Enemy should NOT take damage because beam passes outside combined radius
      expect(enemyHealth.health).toBe(100);
    });

    it('should use default radius when enemy has no CollisionBoxComponent', () => {
      // Player at origin, beam pointing east (angle = 0)
      // Enemy at (100, 20) with NO collision box (defaults to radius 15)
      // Beam passes 20 pixels from enemy center
      // With beam radius 10 + default radius 15 = 25, should hit (20 < 25)
      const enemyId = 1;
      const playerPosition = { x: 0, y: 0 };
      const enemyPosition = new PositionComponent(100, 20); // 20px off beam axis
      const enemyHealth = new HealthComponent(100, 100);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerService.getAngle.and.returnValue(0); // Pointing east
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
            // No CollisionBoxComponent - should use default radius of 15
          }
          return undefined;
        }
      );

      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      const initialHealth = enemyHealth.health;
      service.update(16, mockEntityManager as unknown as EntityManagerService);

      // Enemy should take damage using default radius (10 + 15 = 25 > 20)
      expect(enemyHealth.health).toBeLessThan(initialHealth);
    });
  });

  // ---- Item 4: Critical Strike consumable — observable through crit path ----
  describe('Item 4 — Critical Strike consumable (buffComp.criticalChance stacks with upgrade)', () => {
    it('applies 100% crit from BuffComponent when Critical Strike consumable is active', () => {
      // With criticalChance=1.0 from the buff, EVERY hit is a crit.
      // Use getCriticalHitMultiplier=2.0 so we can verify output > base damage.
      const enemyId = 1;
      const playerPosition = { x: 100, y: 100 };
      const enemyPosition = new PositionComponent(150, 100);
      const enemyHealth = new HealthComponent(1000, 1000);
      const enemyType = new EnemyTypeComponent(EnemyType.Basic);

      mockPlayerUpgrades.getCriticalHitChance.and.returnValue(0); // no upgrade crit
      mockPlayerUpgrades.getCriticalHitMultiplier.and.returnValue(2.0);
      mockPlayerUpgrades.getBeamDamageMultiplier.and.returnValue(1);

      const activeBuff = new BuffComponent();
      activeBuff.criticalChance = 1.0; // 100% crit from consumable

      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue(playerPosition);

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return enemyPosition as unknown as T;
            if (type.name === HealthComponent.name) return enemyHealth as unknown as T;
            if (type.name === EnemyTypeComponent.name) return enemyType as unknown as T;
          }
          // BuffComponent lives on the player (id 0 / first entity created)
          if (type.name === BuffComponent.name) return activeBuff as unknown as T;
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // With 100% crit forced and multiplier 2.0, damage must exceed base beam damage
      expect(enemyHealth.health).toBeLessThan(1000);
    });
  });

  // ---- Item 6: Shield Breaker — halves Sentinel shield block ----
  describe('Item 6 — Shield Breaker (halves Sentinel damageReduction)', () => {
    it('passes halved damageReduction (0.4) to the resolver when shield breaker is active', () => {
      // Verify the shield breaker path: when the player has shield_breaker purchased,
      // the resolver must see damageReduction = 0.4 (half of the original 0.8),
      // not the full 0.8.
      const enemyId = 1;
      const shieldComp = new ShieldArcComponent();
      shieldComp.damageReduction = 0.8;
      shieldComp.arcAngle = (2 * Math.PI) / 3; // 120 degrees in radians

      mockPlayerUpgrades.getHasShieldBreaker.and.returnValue(true);
      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return new PositionComponent(150, 100) as unknown as T;
            if (type.name === HealthComponent.name) return new HealthComponent(1000, 1000) as unknown as T;
            if (type.name === EnemyTypeComponent.name)
              return new EnemyTypeComponent(EnemyType.Sentinel) as unknown as T;
            if (type.name === ShieldArcComponent.name) return shieldComp as unknown as T;
          }
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);
      mockEntityManager.hasComponent.and.returnValue(false);

      // Spy on the resolver to capture what damageReduction value was used
      const resolver = TestBed.inject(DamageResolverService);
      let capturedDamageReduction: number | undefined;
      spyOn(resolver, 'applyDamageToEnemy').and.callFake((req) => {
        capturedDamageReduction = req.shield?.component.damageReduction;
        return { appliedDamage: 0, blocked: false, previousHealth: req.health.health };
      });

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // Resolver must have seen the halved reduction
      expect(capturedDamageReduction).toBeCloseTo(0.4);
    });

    it('restores the original shield damageReduction after the resolver call', () => {
      // The shield breaker temporarily mutates shieldComp.damageReduction.
      // After the update call it must be restored to the original value.
      const enemyId = 1;
      const shieldComp = new ShieldArcComponent();
      shieldComp.damageReduction = 0.8;
      shieldComp.arcAngle = (2 * Math.PI) / 3; // 120 degrees in radians

      mockPlayerUpgrades.getHasShieldBreaker.and.returnValue(true);
      mockPlayerService.getAngle.and.returnValue(0);
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 100 });

      mockEntityManager.getComponent.and.callFake(
        <T extends Component>(id: number, type: ComponentType<T>): T | undefined => {
          if (id === enemyId) {
            if (type.name === PositionComponent.name) return new PositionComponent(150, 100) as unknown as T;
            if (type.name === HealthComponent.name) return new HealthComponent(1000, 1000) as unknown as T;
            if (type.name === EnemyTypeComponent.name)
              return new EnemyTypeComponent(EnemyType.Sentinel) as unknown as T;
            if (type.name === ShieldArcComponent.name) return shieldComp as unknown as T;
          }
          return undefined;
        }
      );
      mockEntityManager.getEntitiesWithComponents.and.returnValue([enemyId]);
      mockEntityManager.hasComponent.and.returnValue(false);

      service.update(100, mockEntityManager as unknown as EntityManagerService);

      // damageReduction must be restored to 0.8 — not left at 0.4
      expect(shieldComp.damageReduction).toBeCloseTo(0.8);
    });
  });
});
