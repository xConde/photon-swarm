import { TestBed } from '@angular/core/testing';
import { ImmunitySystemService } from './immunity-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { PlayerControlledComponent, RenderableComponent } from '@photon/components';

describe('ImmunitySystemService', () => {
  let service: ImmunitySystemService;
  let entityManager: EntityManagerService;
  let mockTime: number;

  beforeEach(() => {
    mockTime = 1000;

    TestBed.configureTestingModule({
      providers: [
        ImmunitySystemService,
        EntityManagerService,
        ErrorHandlerService,
        { provide: DebugLogBridgeService, useValue: jasmine.createSpyObj('DebugLogBridgeService', ['log']) },
      ],
    });

    service = TestBed.inject(ImmunitySystemService);
    entityManager = TestBed.inject(EntityManagerService);

    spyOn(Date, 'now').and.callFake(() => mockTime);
  });

  afterEach(() => {
    entityManager.clear();
  });

  function createPlayerEntity(isInvincible = false, invincibilityEndTime = 0): number {
    const entity = entityManager.createEntity();
    const player = new PlayerControlledComponent(0, true, false, isInvincible, invincibilityEndTime);
    entityManager.addComponent(entity, player);
    return entity;
  }

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should default flashState to true', () => {
      expect(service['flashState']).toBe(true);
    });

    it('should default flashInterval to 100ms', () => {
      expect(service['flashInterval']).toBe(100);
    });
  });

  describe('update — no player entities', () => {
    it('should not throw when no player entities exist', () => {
      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  describe('update — player not invincible', () => {
    it('should not change opacity for a non-invincible player', () => {
      const entity = createPlayerEntity(false);
      const render = new RenderableComponent('#fff', 'world', true, 1.0);
      entityManager.addComponent(entity, render);

      service.update(16, entityManager);

      expect(render.opacity).toBe(1.0);
    });
  });

  describe('update — immunity expiration', () => {
    it('should expire immunity when invincibilityEndTime has passed', () => {
      const endTime = 500;
      mockTime = 1000; // current time is past endTime
      const entity = createPlayerEntity(true, endTime);
      const render = new RenderableComponent('#fff', 'world', true, 0.5);
      entityManager.addComponent(entity, render);

      service.update(16, entityManager);

      const playerComp = entityManager.getComponent(entity, PlayerControlledComponent);
      expect(playerComp?.isInvincible).toBe(false);
      expect(playerComp?.invincibilityEndTime).toBe(0);
    });

    it('should reset opacity to 1.0 when immunity expires', () => {
      const endTime = 500;
      mockTime = 1000;
      const entity = createPlayerEntity(true, endTime);
      const render = new RenderableComponent('#fff', 'world', true, 0.5);
      entityManager.addComponent(entity, render);

      service.update(16, entityManager);

      expect(render.opacity).toBe(1.0);
    });

    it('should keep immunity active when endTime has not passed', () => {
      const endTime = 2000;
      mockTime = 1000; // still before endTime
      const entity = createPlayerEntity(true, endTime);
      entityManager.addComponent(entity, new RenderableComponent('#fff', 'world', true, 1.0));

      service.update(16, entityManager);

      const playerComp = entityManager.getComponent(entity, PlayerControlledComponent);
      expect(playerComp?.isInvincible).toBe(true);
    });
  });

  describe('update — visual flashing during immunity', () => {
    it('should toggle flash state after flash interval elapses', () => {
      const endTime = 5000;
      mockTime = 1000;
      service['lastFlashTime'] = 800; // 200ms ago, above flashInterval of 100ms
      service['flashState'] = true;

      const entity = createPlayerEntity(true, endTime);
      const render = new RenderableComponent('#fff', 'world', true, 1.0);
      entityManager.addComponent(entity, render);

      service.update(16, entityManager);

      // flashState should have toggled from true → false
      expect(service['flashState']).toBe(false);
      expect(render.opacity).toBe(0.5); // semi-transparent when flashState is false
    });

    it('should not toggle flash state when flash interval has not elapsed', () => {
      const endTime = 5000;
      mockTime = 1000;
      service['lastFlashTime'] = 950; // only 50ms ago, below 100ms interval
      service['flashState'] = true;

      const entity = createPlayerEntity(true, endTime);
      const render = new RenderableComponent('#fff', 'world', true, 1.0);
      entityManager.addComponent(entity, render);

      service.update(16, entityManager);

      expect(service['flashState']).toBe(true); // unchanged
    });

    it('should update lastFlashTime when toggling', () => {
      const endTime = 5000;
      mockTime = 1000;
      service['lastFlashTime'] = 800;

      const entity = createPlayerEntity(true, endTime);
      entityManager.addComponent(entity, new RenderableComponent('#fff', 'world', true, 1.0));

      service.update(16, entityManager);

      expect(service['lastFlashTime']).toBe(1000);
    });

    it('should not modify opacity when no RenderableComponent exists', () => {
      const endTime = 5000;
      mockTime = 1000;
      service['lastFlashTime'] = 800;

      createPlayerEntity(true, endTime); // no render component added

      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  describe('isEntityInvincible', () => {
    it('should return false when entity has no PlayerControlledComponent', () => {
      const entity = entityManager.createEntity();
      expect(service.isEntityInvincible(entity, entityManager)).toBe(false);
    });

    it('should return false when player is not invincible', () => {
      const entity = createPlayerEntity(false);
      expect(service.isEntityInvincible(entity, entityManager)).toBe(false);
    });

    it('should return true when player is invincible and time has not expired', () => {
      mockTime = 1000;
      const entity = createPlayerEntity(true, 2000);
      expect(service.isEntityInvincible(entity, entityManager)).toBe(true);
    });

    it('should return false and clean up when immunity has expired', () => {
      mockTime = 3000;
      const entity = createPlayerEntity(true, 2000); // end time in past

      const result = service.isEntityInvincible(entity, entityManager);

      expect(result).toBe(false);

      const playerComp = entityManager.getComponent(entity, PlayerControlledComponent);
      expect(playerComp?.isInvincible).toBe(false);
      expect(playerComp?.invincibilityEndTime).toBe(0);
    });

    it('should handle zero invincibilityEndTime while isInvincible is true (permanent immunity)', () => {
      mockTime = 1000;
      // invincibilityEndTime === 0 means the branch `if (playerComp.invincibilityEndTime > 0)`
      // is skipped, so isInvincible returns true without checking time
      const entity = createPlayerEntity(true, 0);
      expect(service.isEntityInvincible(entity, entityManager)).toBe(true);
    });
  });
});
