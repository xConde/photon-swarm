import { TestBed } from '@angular/core/testing';
import { EnvironmentSystemService } from './environment-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { RandomService } from '../../utils/random.service';
import { GameStateService } from '../../state/game-state.service';
import { BuffManagementSystemService } from './buff-management-system.service';
import { VisualFeedbackCoordinatorService } from '../../services/visual-feedback-coordinator.service';
import { BuffSystemService } from '../../progression/buff-system.service';
import { AudioService } from '../../audio/audio.service';
import {
  ActivePowerupComponent,
  BuffComponent,
  HealthComponent,
  PositionComponent,
  PowerupComponent,
  RenderableComponent,
} from '@photon/components';
import { ENVIRONMENT_CONFIG } from '@photon/config/game-constants';

// Powerup zone radius from game-constants (200px)
const HAZARD_ZONE_RADIUS = ENVIRONMENT_CONFIG.HAZARD_ZONES.RADIUS;

describe('EnvironmentSystemService — powerup collection', () => {
  let service: EnvironmentSystemService;
  let entityManager: EntityManagerService;
  let entityFactory: EntityFactoryECSService;
  let randomService: jasmine.SpyObj<RandomService>;
  let buffManagementSpy: jasmine.SpyObj<BuffManagementSystemService>;
  let buffSystemSpy: jasmine.SpyObj<BuffSystemService>;
  let audioSpy: jasmine.SpyObj<AudioService>;
  let visualFeedbackSpy: jasmine.SpyObj<VisualFeedbackCoordinatorService>;

  beforeEach(() => {
    const randomSpy = jasmine.createSpyObj('RandomService', ['random']);
    const gameSpy = jasmine.createSpyObj('GameStateService', ['takeDamage', 'getHealth']);
    buffManagementSpy = jasmine.createSpyObj('BuffManagementSystemService', ['applyBuff']);
    visualFeedbackSpy = jasmine.createSpyObj('VisualFeedbackCoordinatorService', ['showUpgrade']);
    buffSystemSpy = jasmine.createSpyObj('BuffSystemService', ['applyBuff']);
    audioSpy = jasmine.createSpyObj('AudioService', ['playPowerupCollect']);

    gameSpy.getHealth.and.returnValue(100);
    // BuffManagementSystemService.applyBuff returns boolean — succeed by default
    buffManagementSpy.applyBuff.and.returnValue(true);

    TestBed.configureTestingModule({
      providers: [
        EnvironmentSystemService,
        EntityManagerService,
        EntityFactoryECSService,
        { provide: RandomService, useValue: randomSpy },
        { provide: GameStateService, useValue: gameSpy },
        { provide: BuffManagementSystemService, useValue: buffManagementSpy },
        { provide: VisualFeedbackCoordinatorService, useValue: visualFeedbackSpy },
        { provide: BuffSystemService, useValue: buffSystemSpy },
        { provide: AudioService, useValue: audioSpy },
      ],
    });

    service = TestBed.inject(EnvironmentSystemService);
    entityManager = TestBed.inject(EntityManagerService);
    entityFactory = TestBed.inject(EntityFactoryECSService);
    randomService = TestBed.inject(RandomService) as jasmine.SpyObj<RandomService>;

    randomService.random.and.returnValue(0.5);
  });

  afterEach(() => {
    entityManager.clear();
  });

  // ---------------------------------------------------------------------------
  // Helper: manually inject a powerup zone entity into the service's hazardZones
  // array so tests don't depend on init() placement randomness.
  // ---------------------------------------------------------------------------
  function createManualPowerupZone(
    x: number,
    y: number,
    type: 'damage_multiplier' | 'shield' | 'speed' | 'health' | 'rapid_fire' | 'experience' = 'damage_multiplier',
    value = 2.0,
    duration = 8000,
    respawnTime = 15000
  ): number {
    const zone = entityManager.createEntity();
    entityManager.addComponent(zone, new PositionComponent(x, y));
    const renderable = new RenderableComponent('#ff4444', 'world');
    renderable.opacity = 0.8;
    entityManager.addComponent(zone, renderable);
    const powerupComp = new PowerupComponent().configure(type, value, duration, respawnTime);
    entityManager.addComponent(zone, powerupComp);

    // Push directly into private hazardZones array
    service['hazardZones'].push(zone);
    return zone;
  }

  // ---------------------------------------------------------------------------
  // Helper: create a player at the given coordinates.
  // EntityFactoryECSService.createPlayer() attaches PlayerControlledComponent,
  // PositionComponent, HealthComponent, etc.
  // ---------------------------------------------------------------------------
  function createPlayer(x: number, y: number): number {
    return entityFactory.createPlayer(x, y);
  }

  // ---------------------------------------------------------------------------
  // Section 1: Powerup collection basics
  // ---------------------------------------------------------------------------

  describe('Section 1: collection basics', () => {
    it('1.1 — player in range collects powerup: isActive becomes false, collectedAt set, ActivePowerup added', () => {
      const zone = createManualPowerupZone(100, 100);
      const player = createPlayer(100, 100); // exactly on top — within radius

      service.update(16, entityManager);

      const powerup = entityManager.getComponent(zone, PowerupComponent)!;
      expect(powerup.isActive).toBe(false);
      expect(powerup.collectedAt).toBeGreaterThan(0);

      const activePowerups = entityManager.getComponent(player, ActivePowerupComponent)!;
      expect(activePowerups).toBeTruthy();
      expect(activePowerups.activePowerups.length).toBe(1);
      expect(activePowerups.activePowerups[0].type).toBe('damage_multiplier');
    });

    it('1.2 — player outside range does NOT collect powerup', () => {
      const zone = createManualPowerupZone(100, 100);
      // Place player well beyond HAZARD_ZONE_RADIUS (200px)
      const player = createPlayer(100 + HAZARD_ZONE_RADIUS + 50, 100);

      service.update(16, entityManager);

      const powerup = entityManager.getComponent(zone, PowerupComponent)!;
      expect(powerup.isActive).toBe(true);

      // ActivePowerupComponent may be created but must have no entries
      const activePowerups = entityManager.getComponent(player, ActivePowerupComponent);
      if (activePowerups) {
        expect(activePowerups.activePowerups.length).toBe(0);
      }
    });

    it('1.3 — inactive powerup is not collected even when player is in range', () => {
      const zone = createManualPowerupZone(100, 100);
      const powerup = entityManager.getComponent(zone, PowerupComponent)!;

      // Pre-collect: set inactive with a collectedAt far in the past but NOT past respawnTime
      powerup.isActive = false;
      powerup.collectedAt = Date.now() - 1000; // only 1s ago, respawnTime is 15s

      const player = createPlayer(100, 100);

      service.update(16, entityManager);

      // Should still be inactive — respawn hasn't triggered yet
      expect(powerup.isActive).toBe(false);

      const activePowerups = entityManager.getComponent(player, ActivePowerupComponent);
      if (activePowerups) {
        expect(activePowerups.activePowerups.length).toBe(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Section 2: Health pack edge cases
  // ---------------------------------------------------------------------------

  describe('Section 2: health pack edge cases', () => {
    it('2.1 — health pack at full HP is skipped', () => {
      const zone = createManualPowerupZone(100, 100, 'health', 0.5, 0, 120000);
      const player = createPlayer(100, 100);

      // Ensure player is at full health
      const health = entityManager.getComponent(player, HealthComponent)!;
      health.health = health.maxHealth;

      service.update(16, entityManager);

      const powerup = entityManager.getComponent(zone, PowerupComponent)!;
      // Must NOT be collected — player already full
      expect(powerup.isActive).toBe(true);
    });

    it('2.2 — health pack at partial HP is collected and restores health', () => {
      const zone = createManualPowerupZone(100, 100, 'health', 0.5, 0, 120000);
      const player = createPlayer(100, 100);

      const health = entityManager.getComponent(player, HealthComponent)!;
      const maxHealth = health.maxHealth;
      health.health = maxHealth * 0.4; // 40% HP — clearly not full

      service.update(16, entityManager);

      const powerup = entityManager.getComponent(zone, PowerupComponent)!;
      expect(powerup.isActive).toBe(false);
      // Health should have increased from the heal (50% of maxHealth added)
      expect(health.health).toBeGreaterThan(maxHealth * 0.4);
    });

    it('2.3 — health pack heal is clamped to maxHealth', () => {
      createManualPowerupZone(100, 100, 'health', 0.5, 0, 120000);
      const player = createPlayer(100, 100);

      const health = entityManager.getComponent(player, HealthComponent)!;
      const maxHealth = health.maxHealth;
      // Start at 80% — adding 50% would overflow
      health.health = maxHealth * 0.8;

      service.update(16, entityManager);

      expect(health.health).toBeLessThanOrEqual(maxHealth);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 3: Powerup respawn cycle
  // ---------------------------------------------------------------------------

  describe('Section 3: respawn cycle', () => {
    it('3.1 — powerup respawns after cooldown', () => {
      const zone = createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      const powerup = entityManager.getComponent(zone, PowerupComponent)!;

      // Simulate already-collected state with collectedAt far enough in the past
      powerup.isActive = false;
      powerup.collectedAt = Date.now() - 20000; // 20s ago > 15s respawnTime

      // Player away so no immediate re-collection
      createPlayer(9999, 9999);

      service.update(16, entityManager);

      expect(powerup.isActive).toBe(true);
    });

    it('3.2 — powerup does NOT respawn before cooldown elapses', () => {
      const zone = createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      const powerup = entityManager.getComponent(zone, PowerupComponent)!;

      powerup.isActive = false;
      powerup.collectedAt = Date.now() - 5000; // only 5s ago < 15s respawnTime

      createPlayer(9999, 9999);

      service.update(16, entityManager);

      expect(powerup.isActive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 4: Buff registration on collection
  // ---------------------------------------------------------------------------

  describe('Section 4: buff registration on collection', () => {
    it('4.1 — damage powerup 2.0x calls buffSystem.applyBuff with "damage_boost_2x"', () => {
      createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(buffManagementSpy.applyBuff).toHaveBeenCalledWith(jasmine.any(Number), 'damage_boost_2x', entityManager);
    });

    it('4.2 — damage powerup 3.0x calls buffSystem.applyBuff with "damage_boost_3x"', () => {
      createManualPowerupZone(100, 100, 'damage_multiplier', 3.0, 5000, 20000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(buffManagementSpy.applyBuff).toHaveBeenCalledWith(jasmine.any(Number), 'damage_boost_3x', entityManager);
    });

    it('4.3 — damage powerup 1.5x calls buffSystem.applyBuff with "damage_boost" (fallback)', () => {
      createManualPowerupZone(100, 100, 'damage_multiplier', 1.5, 10000, 12000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(buffManagementSpy.applyBuff).toHaveBeenCalledWith(jasmine.any(Number), 'damage_boost', entityManager);
    });

    it('4.4 — speed powerup calls buffSystemService.applyBuff with "movementSpeed" stat', () => {
      // buffManagementSpy.applyBuff must return true so the engine bridge fires
      buffManagementSpy.applyBuff.and.returnValue(true);

      createManualPowerupZone(100, 100, 'speed', 1.3, 10000, 15000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(buffSystemSpy.applyBuff).toHaveBeenCalledWith('powerup_speed', 'movementSpeed', 1.3, 10000);
    });

    it('4.5 — experience powerup calls buffSystemService.applyBuff with "experienceGain" stat', () => {
      buffManagementSpy.applyBuff.and.returnValue(true);

      createManualPowerupZone(100, 100, 'experience', 2.0, 15000, 25000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(buffSystemSpy.applyBuff).toHaveBeenCalledWith('powerup_xp', 'experienceGain', 2.0, 15000);
    });

    it('4.6 — engine buff bridge does NOT fire when buffManagementSpy.applyBuff returns false', () => {
      buffManagementSpy.applyBuff.and.returnValue(false);

      createManualPowerupZone(100, 100, 'speed', 1.3, 10000, 15000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(buffSystemSpy.applyBuff).not.toHaveBeenCalled();
    });

    it('4.7 — shield powerup does NOT call buffSystemService.applyBuff (no engine bridge mapping)', () => {
      buffManagementSpy.applyBuff.and.returnValue(true);

      createManualPowerupZone(100, 100, 'shield', 0.7, 12000, 18000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      // shield has no POWERUP_TO_ENGINE_BUFF entry — engine bridge should be silent
      expect(buffSystemSpy.applyBuff).not.toHaveBeenCalled();
    });

    it('4.8 — audio plays on every successful collection', () => {
      createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(audioSpy.playPowerupCollect).toHaveBeenCalled();
    });

    it('4.9 — visualFeedback.showUpgrade is called on non-health collection', () => {
      createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      createPlayer(100, 100);

      service.update(16, entityManager);

      expect(visualFeedbackSpy.showUpgrade).toHaveBeenCalled();
    });

    it('4.10 — visualFeedback.showUpgrade is called with "Health Pack" label on health collection', () => {
      const zone = createManualPowerupZone(100, 100, 'health', 0.5, 0, 120000);
      const player = createPlayer(100, 100);

      const health = entityManager.getComponent(player, HealthComponent)!;
      health.health = health.maxHealth * 0.5; // partial HP so it collects

      service.update(16, entityManager);

      expect(visualFeedbackSpy.showUpgrade).toHaveBeenCalledWith(
        'Health Pack',
        jasmine.any(String),
        'health',
        jasmine.any(String)
      );

      // Suppress unused-variable lint warning
      void zone;
    });
  });

  // ---------------------------------------------------------------------------
  // Section 5: Active powerup expiry
  // ---------------------------------------------------------------------------

  describe('Section 5: active powerup expiry', () => {
    it('5.1 — expired powerup is removed by removeExpiredPowerups()', () => {
      const player = createPlayer(100, 100);
      const activePowerups = new ActivePowerupComponent();
      entityManager.addComponent(player, activePowerups);

      const startTime = window.performance.now();
      // Add a powerup that already ended 1 second ago
      activePowerups.activePowerups.push({
        type: 'damage_multiplier',
        value: 2.0,
        startTime: startTime - 10000,
        duration: 8000,
        endTime: startTime - 2000, // ended 2s ago
      });

      activePowerups.removeExpiredPowerups();

      expect(activePowerups.activePowerups.length).toBe(0);
    });

    it('5.2 — non-expired powerup survives removeExpiredPowerups()', () => {
      const player = createPlayer(100, 100);
      const activePowerups = new ActivePowerupComponent();
      entityManager.addComponent(player, activePowerups);

      const startTime = window.performance.now();
      activePowerups.activePowerups.push({
        type: 'damage_multiplier',
        value: 2.0,
        startTime,
        duration: 8000,
        endTime: startTime + 5000, // still active for 5s
      });

      activePowerups.removeExpiredPowerups();

      expect(activePowerups.activePowerups.length).toBe(1);
    });

    it('5.3 — getDamageMultiplier returns 1.0 after all damage powerups expire', () => {
      const player = createPlayer(100, 100);
      const activePowerups = new ActivePowerupComponent();
      entityManager.addComponent(player, activePowerups);

      const now = window.performance.now();
      // Two expired damage powerups
      activePowerups.activePowerups.push(
        {
          type: 'damage_multiplier',
          value: 2.0,
          startTime: now - 10000,
          duration: 5000,
          endTime: now - 5000,
        },
        {
          type: 'damage_multiplier',
          value: 1.5,
          startTime: now - 8000,
          duration: 3000,
          endTime: now - 5000,
        }
      );

      const multiplier = activePowerups.getDamageMultiplier();

      expect(multiplier).toBe(1.0);
      expect(activePowerups.activePowerups.length).toBe(0);
    });

    it('5.4 — getDamageMultiplier stacks multiple active damage powerups', () => {
      const player = createPlayer(100, 100);
      const activePowerups = new ActivePowerupComponent();
      entityManager.addComponent(player, activePowerups);

      const now = window.performance.now();
      activePowerups.activePowerups.push(
        {
          type: 'damage_multiplier',
          value: 2.0,
          startTime: now,
          duration: 8000,
          endTime: now + 8000,
        },
        {
          type: 'damage_multiplier',
          value: 1.5,
          startTime: now,
          duration: 10000,
          endTime: now + 10000,
        }
      );

      const multiplier = activePowerups.getDamageMultiplier();

      expect(multiplier).toBeCloseTo(3.0, 5);
    });

    it('5.5 — _updateActivePowerups cleans expired powerups from player entity', () => {
      const player = createPlayer(100, 100);
      const activePowerups = new ActivePowerupComponent();
      entityManager.addComponent(player, activePowerups);

      const now = window.performance.now();
      activePowerups.activePowerups.push({
        type: 'damage_multiplier',
        value: 2.0,
        startTime: now - 10000,
        duration: 5000,
        endTime: now - 5000,
      });

      expect(activePowerups.activePowerups.length).toBe(1);

      // _updateActivePowerups runs on every update tick
      service.update(16, entityManager);

      expect(activePowerups.activePowerups.length).toBe(0);
    });

    it('5.6 — hasPowerup returns false after powerup expires', () => {
      const activePowerups = new ActivePowerupComponent();
      const now = window.performance.now();

      activePowerups.activePowerups.push({
        type: 'shield',
        value: 0.7,
        startTime: now - 15000,
        duration: 12000,
        endTime: now - 3000,
      });

      expect(activePowerups.hasPowerup('shield')).toBe(false);
    });

    it('5.7 — getTimeRemaining returns 0 for expired powerup', () => {
      const activePowerups = new ActivePowerupComponent();
      const now = window.performance.now();

      activePowerups.activePowerups.push({
        type: 'speed',
        value: 1.3,
        startTime: now - 15000,
        duration: 10000,
        endTime: now - 5000,
      });

      expect(activePowerups.getTimeRemaining('speed')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 6: Collection does not fire for inactive zone — renderable test
  // ---------------------------------------------------------------------------

  describe('Section 6: renderable opacity after collection', () => {
    it('6.1 — renderable opacity drops to 0.1 when powerup is collected', () => {
      const zone = createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      const renderable = entityManager.getComponent(zone, RenderableComponent)!;
      expect(renderable.opacity).toBe(0.8); // pre-collection

      createPlayer(100, 100);
      service.update(16, entityManager);

      expect(renderable.opacity).toBeCloseTo(0.1, 5);
    });

    it('6.2 — renderable opacity restores to 0.8 after respawn', () => {
      const zone = createManualPowerupZone(100, 100, 'damage_multiplier', 2.0, 8000, 15000);
      const renderable = entityManager.getComponent(zone, RenderableComponent)!;
      const powerup = entityManager.getComponent(zone, PowerupComponent)!;

      // Simulate already-collected state past respawn time
      powerup.isActive = false;
      powerup.collectedAt = Date.now() - 20000; // well past 15s respawnTime
      renderable.opacity = 0.1;

      createPlayer(9999, 9999); // player far away to prevent immediate re-collect
      service.update(16, entityManager);

      expect(renderable.opacity).toBeCloseTo(0.8, 5);
      expect(powerup.isActive).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Section 7: ActivePowerupComponent is auto-created when absent
  // ---------------------------------------------------------------------------

  describe('Section 7: ActivePowerupComponent auto-creation', () => {
    it('7.1 — player without ActivePowerupComponent gets one after collecting a powerup', () => {
      createManualPowerupZone(100, 100, 'rapid_fire', 2.0, 8000, 20000);
      const player = createPlayer(100, 100);

      // Verify it doesn't exist yet (factory may or may not add it)
      entityManager.removeComponent?.(player, ActivePowerupComponent);

      // If removeComponent is not available on service, fall back to checking post-update
      service.update(16, entityManager);

      const activePowerups = entityManager.getComponent(player, ActivePowerupComponent);
      expect(activePowerups).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // Section 8: Buff component heal multiplier is respected for health packs
  // ---------------------------------------------------------------------------

  describe('Section 8: buff-modified health restore', () => {
    it('8.1 — heal amount is multiplied by BuffComponent.healingMultiplier when present', () => {
      const zone = createManualPowerupZone(100, 100, 'health', 0.5, 0, 120000);
      const player = createPlayer(100, 100);

      const health = entityManager.getComponent(player, HealthComponent)!;
      const maxHealth = health.maxHealth;
      health.health = 0; // empty — guaranteed to heal

      // Add buff component with 2x healing
      const buffComp = new BuffComponent();
      buffComp.healingMultiplier = 2.0;
      entityManager.addComponent(player, buffComp);

      service.update(16, entityManager);

      // 50% value * 2.0 healingMultiplier = 100% of maxHealth
      const expectedHeal = maxHealth * 0.5 * 2.0;
      expect(health.health).toBeCloseTo(Math.min(maxHealth, expectedHeal), 1);

      // Suppress unused-variable lint warning
      void zone;
    });
  });
});
