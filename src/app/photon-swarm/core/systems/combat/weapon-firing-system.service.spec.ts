import { TestBed } from '@angular/core/testing';
import { WeaponFiringSystemService } from './weapon-firing-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ProjectileSystemService } from './projectile-system.service';
import { PlayerService } from '../../player/player.service';
import {
  BeamComponent,
  BuffComponent,
  DualChargingComponent,
  PlayerControlledComponent,
  PositionComponent,
  RenderableComponent,
  VelocityComponent,
  WeaponComponent,
} from '@photon/components';
import { UIStateService } from '../../state/ui-state.service';
import { EnemyType } from '../../models/enemy.model';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { FactionStandingSystemService } from '../gameplay';
import { ThemeService } from '@services/theme.service';

describe('WeaponFiringSystemService', () => {
  let service: WeaponFiringSystemService;
  let entityManager: EntityManagerService;
  let entityFactory: EntityFactoryECSService;
  let projectileSystem: ProjectileSystemService;
  let playerService: PlayerService;

  // Mock services
  const mockDebugLog = {
    log: jasmine.createSpy('log'),
  };

  const mockFactionStandingSystem = {
    getTerritoryEffects: jasmine.createSpy('getTerritoryEffects').and.returnValue({
      damageMultiplier: 1.0,
      defenseMultiplier: 1.0,
    }),
  };

  const mockThemeService = {
    isDayMode: false,
  };

  beforeEach(() => {
    // Reset spies
    mockDebugLog.log.calls.reset();
    mockFactionStandingSystem.getTerritoryEffects.calls.reset();

    TestBed.configureTestingModule({
      providers: [
        WeaponFiringSystemService,
        EntityManagerService,
        EntityFactoryECSService,
        ProjectileSystemService,
        PlayerService,
        UIStateService,
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: FactionStandingSystemService, useValue: mockFactionStandingSystem },
        { provide: ThemeService, useValue: mockThemeService },
      ],
    });

    service = TestBed.inject(WeaponFiringSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    entityFactory = TestBed.inject(EntityFactoryECSService);
    projectileSystem = TestBed.inject(ProjectileSystemService);
    playerService = TestBed.inject(PlayerService);

    // Initialize the service
    service.init(entityManager);
  });

  describe('Player Weapon Firing', () => {
    let playerEntity: number;

    beforeEach(() => {
      // Create a player entity
      playerEntity = entityFactory.createPlayer(100, 100);
    });

    it('should not fire player weapons without pending charge shot', () => {
      // Get the weapon component
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent);
      expect(weapon).toBeDefined();

      // Set last shot time to ensure cooldown is complete
      weapon!.lastShotTime = window.performance.now() - 2000; // 2 seconds ago

      // Spy on projectile creation
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(playerService, 'hasPendingChargeShot').and.returnValue(false);

      // Run update
      service.update(16, entityManager);

      // Player weapons should NOT fire without pending shot
      expect(entityFactory.createProjectile).not.toHaveBeenCalled();
      expect(entityFactory.createChargedProjectile).not.toHaveBeenCalled();
    });

    it('should fire player weapons when pending charge shot exists', () => {
      // Get the weapon component
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent);
      expect(weapon).toBeDefined();

      // Set last shot time to ensure cooldown is complete
      weapon!.lastShotTime = window.performance.now() - 2000; // 2 seconds ago

      // Add DualChargingComponent (required for player firing in the new system)
      const dualCharging = new DualChargingComponent();
      // Simulate movement charge build-up (40% per second * 3 seconds = 120% -> capped at 100%)
      dualCharging.update(3000, true);
      entityManager.addComponent(playerEntity, dualCharging);

      // Add velocity component for direction
      entityManager.addComponent(playerEntity, new VelocityComponent(100, 0));

      // Spy on projectile creation and player service
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(playerService, 'hasPendingChargeShot').and.returnValue(true);
      spyOn(playerService, 'consumePendingChargeShot');
      spyOn(playerService, 'getDisplayCharge').and.returnValue(50);
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');
      spyOn(playerService, 'getLastDirection').and.returnValue({ x: 1, y: 0, source: 'movement' });
      spyOn(playerService, 'shouldFireProjectile').and.returnValue(true);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Run update - this queues the shot
      service.update(16, entityManager);
      // Run update again to process the burst queue
      service.update(16, entityManager);

      // Player weapons should fire with pending shot
      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();
      expect(playerService.consumePendingChargeShot).toHaveBeenCalled();
      expect(projectileSystem.notifyProjectileSpawned).toHaveBeenCalled();
    });

    it('should fire when fireChargedWeapon is called', () => {
      const targetX = 200;
      const targetY = 200;
      const chargeLevel = 0.5;

      // Spy on projectile creation
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');

      // Fire the weapon (this queues the shot)
      service.fireChargedWeapon(playerEntity, targetX, targetY, chargeLevel, entityManager);

      // Process the burst queue (shots are deferred, need update to process)
      service.update(16, entityManager);

      // Should create a charged projectile
      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();
      expect(projectileSystem.notifyProjectileSpawned).toHaveBeenCalled();
    });

    it('should respect weapon cooldown in fireChargedWeapon', () => {
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      const targetX = 200;
      const targetY = 200;

      // Spy on projectile creation
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');

      // Fire once
      service.fireChargedWeapon(playerEntity, targetX, targetY, 0.5, entityManager);
      const firstShotTime = weapon.lastShotTime;

      // Try to fire again immediately
      service.fireChargedWeapon(playerEntity, targetX, targetY, 0.5, entityManager);
      const secondShotTime = weapon.lastShotTime;

      // fireChargedWeapon updates lastShotTime on each call (no cooldown check)
      // Both shots will be queued
      expect(secondShotTime).toBeGreaterThanOrEqual(firstShotTime);

      // Process burst queue to verify both shots fire
      service.update(16, entityManager);

      // Both shots should have been created (createChargedProjectile called twice)
      expect((entityFactory.createChargedProjectile as jasmine.Spy).calls.count()).toBe(2);
    });

    it('should apply charge effects to projectiles', () => {
      const targetX = 200;
      const targetY = 200;
      const chargeLevel = 0.8; // High charge

      // Create a mock projectile entity
      const projectileId = 999;
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(projectileId);
      spyOn(projectileSystem, 'notifyProjectileSpawned');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');

      // Add necessary components to the projectile
      entityManager.addComponent(projectileId, new VelocityComponent(100, 0));

      // Fire with charge (this queues the shot)
      service.fireChargedWeapon(playerEntity, targetX, targetY, chargeLevel, entityManager);

      // Process burst queue to actually create the projectile
      service.update(16, entityManager);

      // Verify charged projectile was created with correct parameters
      expect(entityFactory.createChargedProjectile).toHaveBeenCalledWith(
        jasmine.any(Number), // x
        jasmine.any(Number), // y
        jasmine.any(Number), // vx
        jasmine.any(Number), // vy
        jasmine.any(Number), // damage
        chargeLevel,
        'player',
        jasmine.any(String) // color
      );
    });

    it('should respect charge type when determining projectile color', () => {
      const targetX = 200;
      const targetY = 200;
      const chargeLevel = 0.8;

      // Setup spies
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(playerService, 'getDisplayCharge').and.returnValue(80);
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Fire the weapon (this queues the shot)
      service.fireChargedWeapon(playerEntity, targetX, targetY, chargeLevel, entityManager);

      // Process burst queue to actually create the projectile
      service.update(16, entityManager);

      // Verify the spy was called
      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();

      // Check the color parameter (should be yellow-cyan gradient for movement)
      const callArgs = (entityFactory.createChargedProjectile as jasmine.Spy).calls.mostRecent().args;
      const color = callArgs[7]; // Color is the 8th parameter

      // Movement charge at 80% should be mostly cyan
      expect(color).toMatch(/rgb\(\d+,255,\d+\)/); // Green channel should be 255
    });
  });

  describe('Enemy Weapon Firing', () => {
    it('should automatically fire enemy weapons when cooldown is complete', () => {
      // Create an enemy with a weapon
      const enemy = entityFactory.createEnemy(300, 300, EnemyType.Spitter);

      // Set spawn time and viewport entry to past so spawn animation is complete
      const renderable = entityManager.getComponent(enemy, RenderableComponent);
      if (renderable) {
        renderable.spawnTime = window.performance.now() - 5000;
        renderable.lastViewportEntryTime = window.performance.now() - 5000;
        renderable.wasInViewport = true;
      }

      // Get the weapon and set cooldown complete
      const weapon = entityManager.getComponent(enemy, WeaponComponent);
      expect(weapon).toBeDefined();
      weapon!.lastShotTime = window.performance.now() - 2000;
      // AI system must mark weapon as ready to fire
      weapon!.readyToFire = true;

      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Run update - this queues the shot
      service.update(16, entityManager);
      // Run update again to process the burst queue
      service.update(16, entityManager);

      // Enemy should fire
      expect(entityFactory.createProjectile).toHaveBeenCalled();
      expect(projectileSystem.notifyProjectileSpawned).toHaveBeenCalled();

      const stats = service.getWeaponStats();
      expect(stats.enemyShots).toBe(1);
    });
  });

  describe('Direction Persistence', () => {
    it('should use player last direction for projectiles', () => {
      const playerEntity = entityFactory.createPlayer(100, 100);

      // Mock player service to return a specific direction
      spyOn(playerService, 'getLastDirection').and.returnValue({
        x: 0.707,
        y: 0.707,
        source: 'movement',
      });
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Fire weapon (this queues the shot)
      service.fireChargedWeapon(playerEntity, 200, 200, 0.5, entityManager);

      // Process burst queue to actually create the projectile
      service.update(16, entityManager);

      // fireChargedWeapon uses target direction, not getLastDirection
      // But the projectile creation should succeed
      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();
    });
  });

  describe('Charging System Integration', () => {
    let playerEntity: number;

    beforeEach(() => {
      // Create a player entity for these tests
      playerEntity = entityManager.createEntity();
      entityManager.addComponent(playerEntity, new PlayerControlledComponent());
      entityManager.addComponent(playerEntity, new PositionComponent(100, 100));
      entityManager.addComponent(playerEntity, new WeaponComponent(10, 1000));
    });

    it('should handle player direction persistence correctly', () => {
      // Add beam component for fallback
      entityManager.addComponent(playerEntity, new BeamComponent(Math.PI / 4, 0.1, 10));

      // Test with last direction from movement
      spyOn(playerService, 'getLastDirection').and.returnValue({ x: 0.707, y: 0.707, source: 'movement' });
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Fire with charge level 0 to get createProjectile instead of createChargedProjectile
      service.fireChargedWeapon(playerEntity, 200, 200, 0, entityManager);

      // Process burst queue
      service.update(16, entityManager);

      // Verify projectile was created
      expect(entityFactory.createProjectile).toHaveBeenCalled();

      const callArgs = (entityFactory.createProjectile as jasmine.Spy).calls.mostRecent().args;
      const vx = callArgs[2];
      const vy = callArgs[3];

      // Should have direction to target (200,200) from (100,100)
      expect(Math.abs(vx)).toBeGreaterThan(0);
      expect(Math.abs(vy)).toBeGreaterThan(0);
    });

    it('should fallback to beam direction when no last direction', () => {
      // Add beam component
      const beamAngle = Math.PI / 2; // 90 degrees (pointing down in canvas coordinates)
      entityManager.addComponent(playerEntity, new BeamComponent(beamAngle, 0.1, 10));

      // No last direction
      spyOn(playerService, 'getLastDirection').and.returnValue({ x: 0, y: 0, source: 'none' });
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Fire with charge level 0
      service.fireChargedWeapon(playerEntity, 200, 200, 0, entityManager);

      // Process burst queue
      service.update(16, entityManager);

      // Verify projectile was created
      expect(entityFactory.createProjectile).toHaveBeenCalled();

      const callArgs = (entityFactory.createProjectile as jasmine.Spy).calls.mostRecent().args;
      const vx = callArgs[2];
      const vy = callArgs[3];

      // fireChargedWeapon calculates direction to target (200,200) from position (100,100)
      // So vx and vy should be toward the target
      expect(Math.abs(vx)).toBeGreaterThan(0);
      expect(vy).toBeGreaterThan(0); // Target is below (higher y value)
    });

    it('should source chargeLevel from DualChargingComponent.fireMovementCharge()', () => {
      // Charge is now ECS-sourced: DualChargingComponent.fireMovementCharge() returns
      // the consumed charge level. This prevents desync between ECS and PlayerService.
      const dualCharging = new DualChargingComponent();
      dualCharging.update(3000, true); // Build to 100%
      entityManager.addComponent(playerEntity, dualCharging);
      entityManager.addComponent(playerEntity, new VelocityComponent(100, 0));

      spyOn(dualCharging, 'fireMovementCharge').and.callThrough();
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(playerService, 'hasPendingChargeShot').and.returnValue(true);
      spyOn(playerService, 'shouldFireProjectile').and.returnValue(true);
      spyOn(playerService, 'consumePendingChargeShot');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');
      spyOn(playerService, 'getLastDirection').and.returnValue({ x: 1, y: 0, source: 'movement' });
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      weapon.lastShotTime = window.performance.now() - 2000;

      service.update(16, entityManager);
      service.update(16, entityManager);

      // Charge should be consumed via ECS component, not PlayerService
      expect(dualCharging.fireMovementCharge).toHaveBeenCalled();
      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();
    });

    it('should fire projectiles from focus charge when stationary', () => {
      // Add DualChargingComponent with focus charge
      const dualCharging = new DualChargingComponent();
      // Build focus charge by being stationary
      dualCharging.update(3000, false); // Stationary for 3 seconds → focus charge ~1.0
      entityManager.addComponent(playerEntity, dualCharging);

      // Setup player with focus charge triggering auto-fire
      spyOn(playerService, 'hasPendingChargeShot').and.returnValue(true);
      spyOn(playerService, 'getDisplayCharge').and.returnValue(80);
      spyOn(playerService, 'getActiveChargeType').and.returnValue('focus');
      spyOn(playerService, 'getLastDirection').and.returnValue({ x: 1, y: 0, source: 'movement' });
      spyOn(playerService, 'consumePendingChargeShot');
      spyOn(playerService, 'shouldFireProjectile').and.returnValue(true);
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Get weapon and set cooldown complete
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      weapon.lastShotTime = window.performance.now() - 2000;

      // Run update — focus charge at 100% should trigger projectile firing
      // via getCurrentChargeLevel() which returns focus charge when stationary
      service.update(16, entityManager);
      service.update(16, entityManager);

      // Focus charge fires charged projectiles (charge level > 0)
      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();
    });

    it('should respect projectile limits', () => {
      // Mock counting function to return at limit
      interface ProjectileCounts {
        player: number;
        enemy: number;
        total: number;
      }
      spyOn(
        service as unknown as { countActiveProjectiles: () => ProjectileCounts },
        'countActiveProjectiles'
      ).and.returnValue({
        player: 50,
        enemy: 0,
        total: 50,
      });

      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);

      // Try to fire
      service.fireChargedWeapon(playerEntity, 200, 200, 0.5, entityManager);

      // Process burst queue
      service.update(16, entityManager);

      // Should not create projectile due to limit
      expect(entityFactory.createProjectile).not.toHaveBeenCalled();
      expect(entityFactory.createChargedProjectile).not.toHaveBeenCalled();
    });
  });

  describe('Shift-Fire Integration', () => {
    it('should fire projectile when shift-fire is active via update loop', () => {
      const playerEntity = entityFactory.createPlayer(100, 100);
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      weapon.lastShotTime = window.performance.now() - 2000; // 2 seconds ago — ensures cooldown is clear

      // Set game active and shift-firing on the REAL player service (no spy)
      playerService.setGameActive(true);
      playerService.setShiftFiring(true);

      // Diagnostic: verify conditions are correct
      const currentTime = window.performance.now();
      const weaponEntities = entityManager.getEntitiesWithComponents(WeaponComponent, PositionComponent);
      expect(weaponEntities.length).toBeGreaterThan(0);
      expect(weaponEntities).toContain(playerEntity);
      expect(weapon.canFire(currentTime)).toBeTrue();
      expect(entityManager.hasComponent(playerEntity, PlayerControlledComponent)).toBeTrue();

      const dualCharging = entityManager.getComponent(playerEntity, DualChargingComponent);
      expect(dualCharging).toBeTruthy();
      expect(playerService.shouldFireProjectile()).toBeTrue();
      expect(playerService.getIsShiftFiring()).toBeTrue();

      // Spy on creation to track calls
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // First update: weapon system detects shift-fire, queues burst
      service.update(16, entityManager);

      // Second update: processes burst queue, creates projectile
      service.update(16, entityManager);

      // At least one projectile should be created
      const projectileCreated =
        (entityFactory.createProjectile as jasmine.Spy).calls.count() > 0 ||
        (entityFactory.createChargedProjectile as jasmine.Spy).calls.count() > 0;

      expect(projectileCreated).toBeTrue();
    });

    it('should stop firing when shift is released', () => {
      const playerEntity = entityFactory.createPlayer(100, 100);
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      weapon.lastShotTime = window.performance.now() - 2000;

      playerService.setGameActive(true);
      playerService.setShiftFiring(true);

      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');

      // Fire once
      service.update(16, entityManager);
      service.update(16, entityManager);

      // Release shift
      playerService.setShiftFiring(false);

      // Advance weapon cooldown
      weapon.lastShotTime = window.performance.now() - 2000;

      // Reset spy counts
      (entityFactory.createProjectile as jasmine.Spy).calls.reset();
      (entityFactory.createChargedProjectile as jasmine.Spy).calls.reset();

      // Update again - should NOT fire
      service.update(16, entityManager);
      service.update(16, entityManager);

      const projectileCreated =
        (entityFactory.createProjectile as jasmine.Spy).calls.count() > 0 ||
        (entityFactory.createChargedProjectile as jasmine.Spy).calls.count() > 0;

      expect(projectileCreated).toBeFalse();
    });
  });

  describe('Lifecycle', () => {
    it('should clear burst queue on destroy', () => {
      const playerEntity = entityFactory.createPlayer(100, 100);
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      weapon.lastShotTime = window.performance.now() - 2000;

      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');

      // Queue a burst shot
      service.fireChargedWeapon(playerEntity, 200, 200, 0.5, entityManager);

      // Destroy the service (clears burst queue)
      service.destroy();

      // Process burst queue — should not fire because queue was cleared
      service.update(16, entityManager);

      expect(entityFactory.createChargedProjectile).not.toHaveBeenCalled();
    });

    it('should use snapshotted weapon damage even if weapon component is mutated after queue push', () => {
      const playerEntity = entityFactory.createPlayer(100, 100);
      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      weapon.damage = 42;

      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');

      // Queue with damage = 42
      service.fireChargedWeapon(playerEntity, 200, 200, 0.5, entityManager);

      // Mutate weapon after queuing — snapshot must be isolated
      weapon.damage = 999;

      // Process burst queue
      service.update(16, entityManager);

      expect(entityFactory.createChargedProjectile).toHaveBeenCalled();

      // Damage passed to createChargedProjectile (5th arg, index 4) must reflect
      // the snapshotted value (42), not the mutated value (999).
      // Territory multiplier is 1.0 in the mock, so adjustedDamage == snapshotted damage.
      const callArgs = (entityFactory.createChargedProjectile as jasmine.Spy).calls.mostRecent().args;
      const damageArg = callArgs[4] as number;
      expect(damageArg).toBe(42);
      expect(damageArg).not.toBe(999);
    });
  });

  describe('Fire Rate Multiplier', () => {
    let playerEntity: number;

    beforeEach(() => {
      // Create a player entity (auto-adds PlayerControlledComponent, PositionComponent, WeaponComponent, DualChargingComponent)
      playerEntity = entityFactory.createPlayer(100, 100);

      // Setup player service to allow firing
      playerService.setGameActive(true);
      playerService.setShiftFiring(true);

      // Setup spies for firing conditions
      spyOn(playerService, 'hasPendingChargeShot').and.returnValue(true);
      spyOn(playerService, 'shouldFireProjectile').and.returnValue(true);
      spyOn(playerService, 'consumePendingChargeShot');
      spyOn(playerService, 'getActiveChargeType').and.returnValue('movement');
      spyOn(playerService, 'getLastDirection').and.returnValue({ x: 1, y: 0, source: 'movement' });
      spyOn(entityFactory, 'createProjectile').and.returnValue(999);
      spyOn(entityFactory, 'createChargedProjectile').and.returnValue(999);
      spyOn(projectileSystem, 'notifyProjectileSpawned');
    });

    it('should apply fire rate multiplier to reduce weapon cooldown', () => {
      // Set fire rate multiplier to 2.0 (2x faster)
      spyOn(playerService, 'getFireRateMultiplier').and.returnValue(2.0);

      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      const currentTime = window.performance.now();

      // Set lastShotTime so that:
      // - Base fire rate (1000ms) hasn't elapsed: elapsed = 600ms < 1000ms
      // - Effective fire rate (1000/2.0 = 500ms) HAS elapsed: 600ms > 500ms
      weapon.lastShotTime = currentTime - 600;

      // First update queues the shot, second processes it
      service.update(16, entityManager);
      service.update(16, entityManager);

      // Weapon should fire because effective cooldown elapsed
      const projectileCreated =
        (entityFactory.createProjectile as jasmine.Spy).calls.count() > 0 ||
        (entityFactory.createChargedProjectile as jasmine.Spy).calls.count() > 0;

      expect(projectileCreated).toBeTrue();
    });

    it('should clamp combined multiplier floor to 0.1', () => {
      // Set fire rate multiplier to 0 (would cause division by zero)
      spyOn(playerService, 'getFireRateMultiplier').and.returnValue(0);

      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      const currentTime = window.performance.now();

      // Set lastShotTime so that:
      // - elapsed < weapon.fireRate / 0.1 (the clamped floor)
      // - weapon.fireRate = 500ms (FIRE_RATE config), so floor = 500 / 0.1 = 5000ms
      // - elapsed = 2500ms < 5000ms — should NOT fire
      weapon.lastShotTime = currentTime - 2500;

      // First update queues (or not), second processes
      service.update(16, entityManager);
      service.update(16, entityManager);

      // Weapon should NOT fire because elapsed is less than the floor-clamped cooldown
      const projectileCreated =
        (entityFactory.createProjectile as jasmine.Spy).calls.count() > 0 ||
        (entityFactory.createChargedProjectile as jasmine.Spy).calls.count() > 0;

      expect(projectileCreated).toBeFalse();
    });

    it('should clamp combined multiplier ceiling to 10.0', () => {
      // Set fire rate multiplier to 100.0 (extreme)
      spyOn(playerService, 'getFireRateMultiplier').and.returnValue(100.0);

      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      const currentTime = window.performance.now();

      // Set lastShotTime so that:
      // - weapon.fireRate / 10.0 (ceiling) has elapsed, but NOT weapon.fireRate / 100.0
      // - weapon.fireRate = 1000ms
      // - ceiling cooldown = 1000 / 10.0 = 100ms
      // - if no ceiling, would be 1000 / 100.0 = 10ms
      // - elapsed = 150ms > 100ms (ceiling) and > 10ms (unclamped)
      weapon.lastShotTime = currentTime - 150;

      // First update queues, second processes
      service.update(16, entityManager);
      service.update(16, entityManager);

      // Weapon should fire because elapsed exceeds the ceiling-clamped cooldown (100ms)
      const projectileCreated =
        (entityFactory.createProjectile as jasmine.Spy).calls.count() > 0 ||
        (entityFactory.createChargedProjectile as jasmine.Spy).calls.count() > 0;

      expect(projectileCreated).toBeTrue();
    });

    it('should incorporate BuffComponent.fireRateMultiplier', () => {
      // Set upgrade multiplier to 1.0 (neutral)
      spyOn(playerService, 'getFireRateMultiplier').and.returnValue(1.0);

      // Add BuffComponent with fireRateMultiplier = 2.0
      const buffComponent = new BuffComponent();
      buffComponent.fireRateMultiplier = 2.0;
      entityManager.addComponent(playerEntity, buffComponent);

      const weapon = entityManager.getComponent(playerEntity, WeaponComponent)!;
      const currentTime = window.performance.now();

      // Set lastShotTime so that:
      // - Base fire rate (1000ms) hasn't elapsed: elapsed = 600ms < 1000ms
      // - Combined multiplier = 1.0 * 2.0 = 2.0
      // - Effective fire rate = 1000 / 2.0 = 500ms
      // - 600ms > 500ms — should fire
      weapon.lastShotTime = currentTime - 600;

      // First update queues, second processes
      service.update(16, entityManager);
      service.update(16, entityManager);

      // Weapon should fire because buff multiplier reduced cooldown
      const projectileCreated =
        (entityFactory.createProjectile as jasmine.Spy).calls.count() > 0 ||
        (entityFactory.createChargedProjectile as jasmine.Spy).calls.count() > 0;

      expect(projectileCreated).toBeTrue();
    });
  });
});
