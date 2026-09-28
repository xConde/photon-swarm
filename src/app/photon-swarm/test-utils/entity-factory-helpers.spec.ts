import { TestBed } from '@angular/core/testing';
import { EntityFactoryECSService } from '../core/entities/entity-factory-ecs.service';
import { EntityManagerService } from '../core/ecs/entity-manager.service';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { GameStateService } from '../core/state/game-state.service';
import { PooledEntityTracker } from '../core/entities/pooled-entity-state';
import {
  createChargedProjectileFromOptions,
  createEnemyFromOptions,
  createProjectileFromOptions,
} from './entity-factory-helpers';
import { EnemyType } from '../core/models/enemy.model';

describe('Entity Factory Helper Functions', () => {
  let entityFactory: EntityFactoryECSService;
  let entityManager: EntityManagerService;

  beforeEach(() => {
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);
    const gameStateSpy = jasmine.createSpyObj('GameStateService', ['addShard', 'addScore', 'getPlayerPosition']);

    TestBed.configureTestingModule({
      providers: [
        EntityFactoryECSService,
        EntityManagerService,
        PooledEntityTracker,
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
        { provide: GameStateService, useValue: gameStateSpy },
      ],
    });

    entityFactory = TestBed.inject(EntityFactoryECSService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  describe('createProjectileFromOptions', () => {
    it('should create projectile with default values', () => {
      const entityId = createProjectileFromOptions(entityFactory, {
        x: 100,
        y: 200,
      });

      expect(entityManager.hasEntity(entityId)).toBe(true);
    });

    it('should correctly convert angle and speed to velocity', () => {
      spyOn(entityFactory, 'createProjectile').and.callThrough();

      createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        angle: Math.PI / 2, // 90 degrees
        speed: 100,
      });

      expect(entityFactory.createProjectile).toHaveBeenCalled();
      const args = (entityFactory.createProjectile as jasmine.Spy).calls.mostRecent().args;
      expect(args[0]).toBe(0); // x
      expect(args[1]).toBe(0); // y
      expect(args[2]).toBeCloseTo(0, 0); // vx should be ~0
      expect(args[3]).toBeCloseTo(100, 0); // vy should be ~100
      expect(args[4]).toBe(5); // default damage
      expect(args[5]).toBe('player'); // default faction
    });

    it('should use provided damage and faction', () => {
      spyOn(entityFactory, 'createProjectile').and.callThrough();

      createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        damage: 15,
        faction: 'enemy',
      });

      expect(entityFactory.createProjectile).toHaveBeenCalledWith(0, 0, 100, 0, 15, 'enemy');
    });
  });

  describe('createEnemyFromOptions', () => {
    it('should create enemy with default values', () => {
      const entityId = createEnemyFromOptions(entityFactory, {
        x: 100,
        y: 200,
      });

      expect(entityManager.hasEntity(entityId)).toBe(true);
    });

    it('should handle enum key strings for type', () => {
      spyOn(entityFactory, 'createEnemy').and.callThrough();

      createEnemyFromOptions(entityFactory, {
        x: 0,
        y: 0,
        type: 'Tank',
      });

      expect(entityFactory.createEnemy).toHaveBeenCalledWith(0, 0, EnemyType.Tank, 'common', false);
    });

    it('should handle enum values for type', () => {
      spyOn(entityFactory, 'createEnemy').and.callThrough();

      createEnemyFromOptions(entityFactory, {
        x: 0,
        y: 0,
        type: EnemyType.Spitter,
      });

      expect(entityFactory.createEnemy).toHaveBeenCalledWith(0, 0, EnemyType.Spitter, 'common', false);
    });

    it('should handle elite and rarity options', () => {
      spyOn(entityFactory, 'createEnemy').and.callThrough();

      createEnemyFromOptions(entityFactory, {
        x: 0,
        y: 0,
        rarity: 'legendary',
        isElite: true,
      });

      expect(entityFactory.createEnemy).toHaveBeenCalledWith(0, 0, EnemyType.Basic, 'legendary', true);
    });
  });

  describe('createChargedProjectileFromOptions', () => {
    it('should create charged projectile with valid charge level', () => {
      const entityId = createChargedProjectileFromOptions(entityFactory, {
        x: 100,
        y: 200,
        chargeLevel: 0.5,
      });

      expect(entityManager.hasEntity(entityId)).toBe(true);
    });

    it('should throw error for invalid charge level', () => {
      expect(() => {
        createChargedProjectileFromOptions(entityFactory, {
          x: 0,
          y: 0,
          chargeLevel: 1.5, // Invalid - over 1
        });
      }).toThrowError('Invalid charge level: 1.5. Must be between 0 and 1.');

      expect(() => {
        createChargedProjectileFromOptions(entityFactory, {
          x: 0,
          y: 0,
          chargeLevel: -0.1, // Invalid - negative
        });
      }).toThrowError('Invalid charge level: -0.1. Must be between 0 and 1.');
    });

    it('should correctly convert angle and speed for charged projectiles', () => {
      spyOn(entityFactory, 'createChargedProjectile').and.callThrough();

      createChargedProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        angle: Math.PI, // 180 degrees
        speed: 200,
        chargeLevel: 0.8,
      });

      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();
      const args = (entityFactory.createChargedProjectile as jasmine.Spy).calls.mostRecent().args;
      expect(args[0]).toBe(0); // x
      expect(args[1]).toBe(0); // y
      expect(args[2]).toBeCloseTo(-200, 0); // vx should be ~-200
      expect(args[3]).toBeCloseTo(0, 0); // vy should be ~0
      expect(args[4]).toBe(20); // default damage
      expect(args[5]).toBe(0.8); // charge level
      expect(args[6]).toBe('player'); // faction
    });
  });

  describe('Edge cases', () => {
    it('should handle zero speed', () => {
      spyOn(entityFactory, 'createProjectile').and.callThrough();

      createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        speed: 0,
      });

      expect(entityFactory.createProjectile).toHaveBeenCalledWith(0, 0, 0, 0, 5, 'player');
    });

    it('should handle negative angles correctly', () => {
      spyOn(entityFactory, 'createProjectile').and.callThrough();

      createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        angle: -Math.PI / 2, // -90 degrees
        speed: 100,
      });

      expect(entityFactory.createProjectile).toHaveBeenCalled();
      const args = (entityFactory.createProjectile as jasmine.Spy).calls.mostRecent().args;
      expect(args[0]).toBe(0); // x
      expect(args[1]).toBe(0); // y
      expect(args[2]).toBeCloseTo(0, 0); // vx should be ~0
      expect(args[3]).toBeCloseTo(-100, 0); // vy should be ~-100
      expect(args[4]).toBe(5); // damage
      expect(args[5]).toBe('player'); // faction
    });

    it('should handle large angles (> 2π)', () => {
      spyOn(entityFactory, 'createProjectile').and.callThrough();

      const angle = 3 * Math.PI; // 540 degrees = 180 degrees
      createProjectileFromOptions(entityFactory, {
        x: 0,
        y: 0,
        angle,
        speed: 100,
      });

      expect(entityFactory.createProjectile).toHaveBeenCalled();
      const args = (entityFactory.createProjectile as jasmine.Spy).calls.mostRecent().args;
      expect(args[0]).toBe(0); // x
      expect(args[1]).toBe(0); // y
      expect(args[2]).toBeCloseTo(-100, 0); // vx should be ~-100 (cos(3π) = -1)
      expect(args[3]).toBeCloseTo(0, 0); // vy should be ~0
      expect(args[4]).toBe(5); // damage
      expect(args[5]).toBe('player'); // faction
    });
  });
});
