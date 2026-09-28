import { TestBed } from '@angular/core/testing';
import { ShardMagnetismSystemService } from './shard-magnetism-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { PlayerControlledComponent, PositionComponent, ShardComponent, VelocityComponent } from '@photon/components';

describe('ShardMagnetismSystemService', () => {
  let service: ShardMagnetismSystemService;
  let entityManager: EntityManagerService;
  let playerService: jasmine.SpyObj<PlayerService>;
  let entityFactory: jasmine.SpyObj<EntityFactoryECSService>;

  let playerEntity: number;
  let shardEntity: number;

  beforeEach(() => {
    const playerServiceSpy = jasmine.createSpyObj('PlayerService', [
      'getHasShardMagnetism',
      'getShardMagnetismBonus',
      'isDashing',
      'isInvincible',
      'isParryAvailable',
      'isDirectionChangeOnCooldown',
      'getShardMultiplier',
      'getMaxHealth',
      'getPosition',
    ]);
    const entityFactorySpy = jasmine.createSpyObj('EntityFactoryECSService', ['isEntityActive', 'returnToPool']);
    const debugLogSpy = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    // Set default return values
    playerServiceSpy.getHasShardMagnetism.and.returnValue(false);
    playerServiceSpy.getShardMagnetismBonus.and.returnValue(0);
    playerServiceSpy.isDashing.and.returnValue(false);
    playerServiceSpy.isInvincible.and.returnValue(false);
    playerServiceSpy.isParryAvailable.and.returnValue(false);
    playerServiceSpy.isDirectionChangeOnCooldown.and.returnValue(false);
    playerServiceSpy.getShardMultiplier.and.returnValue(1);
    playerServiceSpy.getMaxHealth.and.returnValue(100);
    playerServiceSpy.getPosition.and.returnValue({ x: 500, y: 500 });
    entityFactorySpy.isEntityActive.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        ShardMagnetismSystemService,
        EntityManagerService,
        { provide: PlayerService, useValue: playerServiceSpy },
        { provide: EntityFactoryECSService, useValue: entityFactorySpy },
        { provide: DebugLogBridgeService, useValue: debugLogSpy },
      ],
    });

    service = TestBed.inject(ShardMagnetismSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    playerService = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
    entityFactory = TestBed.inject(EntityFactoryECSService) as jasmine.SpyObj<EntityFactoryECSService>;

    // Create player entity
    playerEntity = entityManager.createEntity();
    entityManager.addComponent(playerEntity, new PlayerControlledComponent());
    entityManager.addComponent(playerEntity, new PositionComponent(500, 500));

    // Create shard entity
    shardEntity = entityManager.createEntity();
    entityManager.addComponent(shardEntity, new ShardComponent(1, Date.now()));
    entityManager.addComponent(shardEntity, new PositionComponent(600, 500)); // 100 units away
    entityManager.addComponent(shardEntity, new VelocityComponent(0, 0));
  });

  afterEach(() => {
    entityManager.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should attract shards within base magnetism range', () => {
    // Setup - magnetism is now always active
    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act
    service.update(16, entityManager);

    // Assert - shard velocity should be towards player
    const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
    expect(shardVel).toBeTruthy();
    expect(shardVel!.vx).toBeLessThan(0); // Moving left toward player
    expect(Math.abs(shardVel!.vy)).toBeLessThan(1); // Minimal Y movement
  });

  it('should not attract shards outside magnetism range', () => {
    // Setup - move shard far away
    const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
    shardPos!.x = 800; // 300 units away (outside base range of 150)
    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act
    service.update(16, entityManager);

    // Assert - shard velocity should remain zero
    const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
    expect(shardVel!.vx).toBe(0);
    expect(shardVel!.vy).toBe(0);
  });

  it('should increase attraction range with magnetism bonus', () => {
    // Setup - shard at edge of extended range
    const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
    shardPos!.x = 700; // 200 units away
    playerService.getShardMagnetismBonus.and.returnValue(100); // +100 range

    // Act
    service.update(16, entityManager);

    // Assert - shard should be attracted with extended range
    const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
    expect(shardVel!.vx).toBeLessThan(0); // Moving toward player
  });

  it('should apply exponential acceleration as shard gets closer', () => {
    // Setup two shards at different distances
    const nearShardEntity = entityManager.createEntity();
    entityManager.addComponent(nearShardEntity, new ShardComponent(1, Date.now()));
    entityManager.addComponent(nearShardEntity, new PositionComponent(530, 500)); // 30 units away
    entityManager.addComponent(nearShardEntity, new VelocityComponent(0, 0));

    const farShardEntity = shardEntity; // 100 units away
    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act
    service.update(16, entityManager);

    // Assert - near shard should have higher velocity
    const nearVel = entityManager.getComponent(nearShardEntity, VelocityComponent);
    const farVel = entityManager.getComponent(farShardEntity, VelocityComponent);

    expect(Math.abs(nearVel!.vx)).toBeGreaterThan(Math.abs(farVel!.vx));
  });

  it('should mark shards as being attracted for visual effects', () => {
    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act
    service.update(16, entityManager);

    // Assert - shard should be marked as being attracted
    const shardComponent = entityManager.getComponent(shardEntity, ShardComponent);
    interface ShardWithAttraction {
      isBeingAttracted: boolean;
      attractionDistance: number;
    }
    expect((shardComponent as unknown as ShardWithAttraction).isBeingAttracted).toBe(true);
    expect((shardComponent as unknown as ShardWithAttraction).attractionDistance).toBeGreaterThan(0);
    expect((shardComponent as unknown as ShardWithAttraction).attractionDistance).toBeLessThanOrEqual(1);
  });

  it('should clear attraction flag when shard moves out of range', () => {
    playerService.getShardMagnetismBonus.and.returnValue(0);

    interface ShardWithAttraction {
      isBeingAttracted: boolean;
    }

    // First update - shard is in range
    service.update(16, entityManager);
    let shardComponent = entityManager.getComponent(shardEntity, ShardComponent);
    expect((shardComponent as unknown as ShardWithAttraction).isBeingAttracted).toBe(true);

    // Move shard out of range
    const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
    shardPos!.x = 800; // Far away

    // Second update - shard is out of range
    service.update(16, entityManager);
    shardComponent = entityManager.getComponent(shardEntity, ShardComponent);
    expect((shardComponent as unknown as ShardWithAttraction).isBeingAttracted).toBe(false);
  });

  it('should apply smooth lerp interpolation for natural movement', () => {
    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Set initial velocity
    const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
    shardVel!.vx = 50; // Initial rightward velocity

    // Act - first update
    service.update(16, entityManager);

    // Assert - velocity should smoothly transition, not jump immediately
    const newVx = shardVel!.vx;
    expect(newVx).toBeLessThan(50); // Moving toward player (left)
    expect(newVx).toBeGreaterThan(-100); // But not at full speed immediately
  });

  it('should clamp maximum shard velocity', () => {
    // Setup - shard very close for maximum force
    const shardPos = entityManager.getComponent(shardEntity, PositionComponent);
    shardPos!.x = 511; // Only 11 units away (just above MIN_DISTANCE)
    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act
    service.update(16, entityManager);

    // Assert - velocity should be clamped to MAX_SPEED
    const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
    const speed = Math.sqrt(shardVel!.vx * shardVel!.vx + shardVel!.vy * shardVel!.vy);
    expect(speed).toBeLessThanOrEqual(500); // MAX_SPEED from the service
  });

  it('should handle multiple shards simultaneously', () => {
    // Create additional shards
    const shard2 = entityManager.createEntity();
    entityManager.addComponent(shard2, new ShardComponent(2, Date.now()));
    entityManager.addComponent(shard2, new PositionComponent(450, 550)); // Different position
    entityManager.addComponent(shard2, new VelocityComponent(0, 0));

    const shard3 = entityManager.createEntity();
    entityManager.addComponent(shard3, new ShardComponent(3, Date.now()));
    entityManager.addComponent(shard3, new PositionComponent(550, 450)); // Different position
    entityManager.addComponent(shard3, new VelocityComponent(0, 0));

    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act
    service.update(16, entityManager);

    // Assert - all shards should be attracted
    const vel1 = entityManager.getComponent(shardEntity, VelocityComponent);
    const vel2 = entityManager.getComponent(shard2, VelocityComponent);
    const vel3 = entityManager.getComponent(shard3, VelocityComponent);

    expect(vel1!.vx).not.toBe(0);
    expect(vel2!.vx).not.toBe(0);
    expect(vel3!.vx).not.toBe(0);
  });

  it('should not process shards without required components', () => {
    // Create invalid shard without velocity
    const badShard = entityManager.createEntity();
    entityManager.addComponent(badShard, new ShardComponent(1, Date.now()));
    entityManager.addComponent(badShard, new PositionComponent(600, 500));
    // Missing VelocityComponent

    playerService.getShardMagnetismBonus.and.returnValue(0);

    // Act - should not throw
    expect(() => service.update(16, entityManager)).not.toThrow();
  });

  it('should skip inactive/pooled entities', () => {
    entityFactory.isEntityActive.and.returnValue(false);
    playerService.getShardMagnetismBonus.and.returnValue(0);

    service.update(16, entityManager);

    // Shard velocity should remain unchanged — the entity was skipped
    const shardVel = entityManager.getComponent(shardEntity, VelocityComponent);
    expect(shardVel!.vx).toBe(0);
    expect(shardVel!.vy).toBe(0);
  });

  it('should despawn shards that exceed SHARD_LIFETIME_MS', () => {
    // Create a shard with a spawnTime 25 seconds ago (exceeds 20s lifetime)
    const oldSpawnTime = Date.now() - 25_000;
    const oldShard = entityManager.createEntity();
    entityManager.addComponent(oldShard, new ShardComponent(1, oldSpawnTime));
    entityManager.addComponent(oldShard, new PositionComponent(600, 500));
    entityManager.addComponent(oldShard, new VelocityComponent(0, 0));

    playerService.getShardMagnetismBonus.and.returnValue(0);

    service.update(16, entityManager);

    // The expired shard should be returned to pool
    expect(entityFactory.returnToPool).toHaveBeenCalledWith(jasmine.anything(), oldShard);
  });

  it('should not despawn shards with spawnTime=0 (default/uninitialized)', () => {
    // spawnTime=0 is the ShardComponent default — treat as "just spawned", not epoch
    const zeroTimeShard = entityManager.createEntity();
    entityManager.addComponent(zeroTimeShard, new ShardComponent(1, 0));
    entityManager.addComponent(zeroTimeShard, new PositionComponent(600, 500));
    entityManager.addComponent(zeroTimeShard, new VelocityComponent(0, 0));

    playerService.getShardMagnetismBonus.and.returnValue(0);

    service.update(16, entityManager);

    // Should NOT be despawned — spawnTime=0 means uninitialized, not 1970
    expect(entityFactory.returnToPool).not.toHaveBeenCalledWith(jasmine.anything(), zeroTimeShard);
  });

  it('should not despawn shards within lifetime', () => {
    // Default shard was just created (Date.now()), well within 20s
    playerService.getShardMagnetismBonus.and.returnValue(0);

    service.update(16, entityManager);

    // returnToPool should not have been called for the active shard
    expect(entityFactory.returnToPool).not.toHaveBeenCalledWith(jasmine.anything(), shardEntity);
  });

  it('should not attract expired shards during the frame they despawn', () => {
    // Create an expired shard near the player
    const oldSpawnTime = Date.now() - 25_000;
    const oldShard = entityManager.createEntity();
    entityManager.addComponent(oldShard, new ShardComponent(1, oldSpawnTime));
    entityManager.addComponent(oldShard, new PositionComponent(530, 500)); // Close to player
    entityManager.addComponent(oldShard, new VelocityComponent(0, 0));

    playerService.getShardMagnetismBonus.and.returnValue(0);

    service.update(16, entityManager);

    // Expired shard's velocity should remain zero (skipped via continue)
    const oldVel = entityManager.getComponent(oldShard, VelocityComponent);
    expect(oldVel!.vx).toBe(0);
    expect(oldVel!.vy).toBe(0);
  });
});
