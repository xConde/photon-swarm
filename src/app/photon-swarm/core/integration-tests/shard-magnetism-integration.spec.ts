import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { BuffManagementSystemService, ShardMagnetismSystemService } from '../systems/gameplay';
import { CollisionSystemService, ProjectileSystemService } from '../systems/combat';
import { EntityFactoryECSService } from '../entities/entity-factory-ecs.service';
import { PlayerService } from '../player/player.service';
import { GameStateService } from '../state/game-state.service';
import { DebugLogBridgeService } from '../debug/debug-log-bridge.service';
import { Entity } from '../ecs/ecs.model';
import {
  CollisionBoxComponent,
  PlayerControlledComponent,
  PositionComponent,
  ShardComponent,
  VelocityComponent,
} from '@photon/components';
import { UpgradeService } from '../../services/upgrade.service';

describe('Shard Magnetism Integration Tests', () => {
  let entityManager: EntityManagerService;
  let shardMagnetismSystem: ShardMagnetismSystemService;
  let collisionSystem: CollisionSystemService;
  let entityFactory: EntityFactoryECSService;
  let playerService: PlayerService;
  let gameState: GameStateService;

  let playerEntity: Entity;
  let shardEntity: Entity;

  beforeEach(() => {
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log', 'warn', 'error']);

    TestBed.configureTestingModule({
      providers: [
        EntityManagerService,
        ShardMagnetismSystemService,
        CollisionSystemService,
        EntityFactoryECSService,
        PlayerService,
        GameStateService,
        UpgradeService,
        ProjectileSystemService,
        BuffManagementSystemService,
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });

    entityManager = TestBed.inject(EntityManagerService);
    shardMagnetismSystem = TestBed.inject(ShardMagnetismSystemService);
    collisionSystem = TestBed.inject(CollisionSystemService);
    entityFactory = TestBed.inject(EntityFactoryECSService);
    playerService = TestBed.inject(PlayerService);
    gameState = TestBed.inject(GameStateService);

    // Initialize collision system
    collisionSystem.init();

    // Create player entity
    playerEntity = entityManager.createEntity();
    entityManager.addComponent(playerEntity, new PlayerControlledComponent());
    entityManager.addComponent(playerEntity, new PositionComponent(500, 500));
    entityManager.addComponent(playerEntity, new CollisionBoxComponent(20, 'player'));
  });

  afterEach(() => {
    entityManager.clear();
  });

  describe('Shard Collection End-to-End', () => {
    it('should attract and collect shards within magnetism range', () => {
      // Create shard close to player for reliable collection
      // Player at (500, 500) with radius 20, shard will have radius ~5
      // Need to travel ~5 units to collide (30 - 25 combined radius = 5)
      shardEntity = entityFactory.createShard(530, 500, 5); // 30 units away, value 5

      // Initial state
      const initialShards = gameState.getShards();

      // Run magnetism system multiple times to simulate movement
      // With lerp 0.15, velocity builds slowly, so we need enough frames
      // for the shard to actually reach the player
      for (let i = 0; i < 100; i++) {
        shardMagnetismSystem.update(16, entityManager); // 16ms per frame

        // Update collision detection
        collisionSystem.update(16, entityManager);

        // Early exit if shard was collected
        if (gameState.getShards() > initialShards) {
          break;
        }
      }

      // Verify shard was collected
      const finalShards = gameState.getShards();
      expect(finalShards).toBeGreaterThan(initialShards);

      // Verify shard entity is removed or pooled
      const shardComponent = entityManager.getComponent(shardEntity, ShardComponent);
      const isPooled = !entityFactory.isEntityActive(shardEntity);
      expect(shardComponent == null || isPooled).toBeTruthy();
    });

    it('should not collect shards outside magnetism range', () => {
      // Create shard far from player
      shardEntity = entityFactory.createShard(900, 500, 5); // 400 units away, outside base range

      // Initial state
      const initialShards = gameState.getShards();

      // Run magnetism system
      shardMagnetismSystem.update(16, entityManager);
      collisionSystem.update(16, entityManager);

      // Verify shard was NOT collected
      const finalShards = gameState.getShards();
      expect(finalShards).toBe(initialShards);

      // Verify shard is still active
      expect(entityFactory.isEntityActive(shardEntity)).toBeTruthy();
    });

    it('should simulate realistic environment with multiple shards', () => {
      // Create multiple shards at various distances
      const shards: Entity[] = [];

      // Near shards (should be collected quickly)
      // Player at (500, 500) with radius 20
      shards.push(entityFactory.createShard(525, 500, 1)); // 25 units away
      shards.push(entityFactory.createShard(500, 525, 2)); // 25 units away
      shards.push(entityFactory.createShard(475, 500, 3)); // 25 units away

      // Medium distance shards (should be attracted and collected with enough time)
      shards.push(entityFactory.createShard(540, 500, 5)); // 40 units away
      shards.push(entityFactory.createShard(500, 540, 5)); // 40 units away

      // Far shards (outside magnetism range of 150, should not be affected)
      shards.push(entityFactory.createShard(800, 500, 10)); // 300 units away
      shards.push(entityFactory.createShard(500, 800, 10)); // 300 units away

      const initialShards = gameState.getShards();

      // Simulate enough gameplay time for shards to be collected
      // With lerp 0.15 and close placement, this should be sufficient
      for (let frame = 0; frame < 200; frame++) {
        shardMagnetismSystem.update(16.67, entityManager);
        collisionSystem.update(16.67, entityManager);
      }

      // Check that near and medium shards were collected
      const finalShards = gameState.getShards();
      const expectedMinimum = 1 + 2 + 3 + 5 + 5; // Near and medium shards
      expect(finalShards - initialShards).toBeGreaterThanOrEqual(expectedMinimum);

      // Verify far shards are still active (outside magnetism range)
      expect(entityFactory.isEntityActive(shards[5])).toBeTruthy();
      expect(entityFactory.isEntityActive(shards[6])).toBeTruthy();
    });

    it('should update shard position based on velocity', () => {
      // Create shard at specific position
      shardEntity = entityFactory.createShard(600, 500, 5);

      const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
      const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);

      expect(shardPos).toBeTruthy();
      expect(shardVel).toBeTruthy();

      // First update: velocity is set (position uses previous velocity which was 0)
      shardMagnetismSystem.update(16, entityManager);

      // Verify velocity was set toward player (x=500, so vx should be negative)
      expect(shardVel!.vx).toBeLessThan(0); // Moving left toward player

      // Record position after first update (position may have moved slightly)
      const positionAfterFirstUpdate = shardPos!.x;

      // Second update: now position uses the newly set velocity
      shardMagnetismSystem.update(16, entityManager);

      // Verify position changed based on the velocity (should move left toward player)
      expect(shardPos!.x).toBeLessThan(positionAfterFirstUpdate);
    });

    it('should handle attraction visual flags correctly', () => {
      // Create shard within range
      shardEntity = entityFactory.createShard(580, 500, 5); // 80 units away

      const shardComponent = entityManager.getComponent(shardEntity, ShardComponent);
      expect(shardComponent).toBeTruthy();

      // Run magnetism
      shardMagnetismSystem.update(16, entityManager);

      // Check attraction flags
      expect(shardComponent!.isBeingAttracted).toBe(true);
      expect(shardComponent!.attractionDistance).toBeGreaterThan(0);
      expect(shardComponent!.attractionDistance).toBeLessThanOrEqual(1);

      // Move shard out of range
      const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
      shardPos!.x = 900; // Far away

      // Run magnetism again
      shardMagnetismSystem.update(16, entityManager);

      // Check flags are cleared
      expect(shardComponent!.isBeingAttracted).toBe(false);
    });

    it('should apply exponential acceleration curve', () => {
      // Create two shards at different distances
      const nearShard = entityFactory.createShard(530, 500, 1); // 30 units away
      const farShard = entityFactory.createShard(600, 500, 1); // 100 units away

      // Run magnetism
      shardMagnetismSystem.update(16, entityManager);

      // Get velocities
      const nearVel = entityManager.getComponent(nearShard, VelocityComponent);
      const farVel = entityManager.getComponent(farShard, VelocityComponent);

      expect(nearVel).toBeTruthy();
      expect(farVel).toBeTruthy();

      // Near shard should have much higher velocity due to exponential curve
      const nearSpeed = Math.sqrt(nearVel!.vx * nearVel!.vx + nearVel!.vy * nearVel!.vy);
      const farSpeed = Math.sqrt(farVel!.vx * farVel!.vx + farVel!.vy * farVel!.vy);

      expect(nearSpeed).toBeGreaterThan(farSpeed * 1.5); // At least 50% faster
    });

    it('should respect maximum speed limit', () => {
      // Create shard very close to player for maximum force
      shardEntity = entityFactory.createShard(511, 500, 5); // Just 11 units away

      // Run magnetism multiple times
      for (let i = 0; i < 10; i++) {
        shardMagnetismSystem.update(16, entityManager);
      }

      // Check velocity is clamped
      const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
      expect(shardVel).toBeTruthy();

      const speed = Math.sqrt(shardVel!.vx * shardVel!.vx + shardVel!.vy * shardVel!.vy);
      expect(speed).toBeLessThanOrEqual(500); // MAX_SPEED from service
    });

    it('should apply smooth lerp interpolation', () => {
      shardEntity = entityFactory.createShard(600, 500, 5);

      // Set initial velocity
      const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
      shardVel!.vx = 100; // Moving right initially
      shardVel!.vy = 0;

      const velocities: number[] = [];
      const initialVelocity = shardVel!.vx;

      // Track velocity changes over multiple frames
      // With lerp factor 0.15, we need more iterations to change direction
      for (let i = 0; i < 30; i++) {
        shardMagnetismSystem.update(16, entityManager);
        velocities.push(shardVel!.vx);
      }

      // Verify smooth transition - no instant jumps (max change per frame should be bounded)
      for (let i = 1; i < velocities.length; i++) {
        const change = Math.abs(velocities[i] - velocities[i - 1]);
        expect(change).toBeLessThan(100); // No huge jumps
      }

      // Should be moving toward the player eventually (vx should become negative)
      // With lerp, after enough iterations, the velocity should have reversed direction
      expect(velocities[velocities.length - 1]).toBeLessThan(initialVelocity);
      expect(velocities[velocities.length - 1]).toBeLessThan(0);
    });

    it('should work with upgraded magnetism bonus', () => {
      // Simulate player having magnetism upgrade
      spyOn(playerService, 'getShardMagnetismBonus').and.returnValue(100); // +100 range

      // Create shard at extended range
      shardEntity = entityFactory.createShard(700, 500, 5); // 200 units away

      // Run magnetism
      shardMagnetismSystem.update(16, entityManager);

      // Verify shard is attracted with extended range
      const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
      expect(shardVel!.vx).toBeLessThan(0); // Moving toward player
    });
  });
});
