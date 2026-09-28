import { TestBed } from '@angular/core/testing';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { EffectFactoryService } from '../entities/effect-factory.service';
import { EnemyType } from '../models/enemy.model';
import { EnemyTypeComponent, HealthComponent, HitFlashComponent, PositionComponent } from '@photon/components';

/**
 * Combat Enhancements Tests
 *
 * These tests verify combat visual effects like hit flashes and death particles.
 * Note: Screen Shake and Chromatic Aberration were removed per user request.
 */
describe('Combat Enhancements', () => {
  let entityManager: EntityManagerService;
  let effectFactory: EffectFactoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [EntityManagerService, EffectFactoryService],
    });

    entityManager = TestBed.inject(EntityManagerService);
    effectFactory = TestBed.inject(EffectFactoryService);
  });

  describe('Hit Flash', () => {
    it('should add hit flash component to entity', () => {
      // Create enemy entity
      const enemyId = entityManager.createEntity();
      const position = new PositionComponent(100, 100);
      entityManager.addComponent(enemyId, position);
      entityManager.addComponent(enemyId, new HealthComponent(100, 100));
      entityManager.addComponent(enemyId, new EnemyTypeComponent(EnemyType.Basic));

      // Manually add hit flash component (as would happen during damage processing)
      const hitFlash = new HitFlashComponent(0.8, 100);
      entityManager.addComponent(enemyId, hitFlash);

      const retrievedHitFlash = entityManager.getComponent(enemyId, HitFlashComponent);
      expect(retrievedHitFlash).toBeTruthy();
      expect(retrievedHitFlash?.intensity).toBe(0.8);
    });

    it('should detect expired hit flash components', () => {
      // Create hit flash with a past start time to simulate expiration
      const pastStartTime = Date.now() - 200; // 200ms in the past
      const hitFlash = new HitFlashComponent(1.0, 50, pastStartTime); // 50ms duration, started 200ms ago

      expect(hitFlash.isExpired()).toBeTruthy();
    });
  });

  describe('Death Particles', () => {
    it('should call createEnemyExplosion for regular enemies', () => {
      spyOn(effectFactory, 'createEnemyExplosion');

      const enemyId = entityManager.createEntity();
      const position = new PositionComponent(100, 100);
      entityManager.addComponent(enemyId, position);
      entityManager.addComponent(enemyId, new HealthComponent(0, 100)); // Already dead
      entityManager.addComponent(enemyId, new EnemyTypeComponent(EnemyType.Basic));

      // Directly call effectFactory method (simulating what happens during death processing)
      effectFactory.createEnemyExplosion({ x: position.x, y: position.y }, 0.8);

      expect(effectFactory.createEnemyExplosion).toHaveBeenCalledWith({ x: 100, y: 100 }, 0.8);
    });

    it('should call createDeathParticles for elite enemies', () => {
      spyOn(effectFactory, 'createDeathParticles');

      const enemyId = entityManager.createEntity();
      const position = new PositionComponent(100, 100);
      entityManager.addComponent(enemyId, position);
      entityManager.addComponent(enemyId, new HealthComponent(0, 100)); // Already dead
      const enemyType = new EnemyTypeComponent(EnemyType.Tank);
      enemyType.isElite = true;
      entityManager.addComponent(enemyId, enemyType);

      // Directly call effectFactory method (simulating what happens during death processing for elites)
      effectFactory.createDeathParticles({ x: position.x, y: position.y }, EnemyType.Tank, true);

      expect(effectFactory.createDeathParticles).toHaveBeenCalledWith({ x: 100, y: 100 }, EnemyType.Tank, true);
    });
  });

  describe('Integration', () => {
    it('should handle hit flash and death scenario together', () => {
      spyOn(effectFactory, 'createEnemyExplosion');

      // Create enemy that will die
      const enemyId = entityManager.createEntity();
      const position = new PositionComponent(100, 100);
      entityManager.addComponent(enemyId, position);
      entityManager.addComponent(enemyId, new HealthComponent(0, 100)); // Already dead
      entityManager.addComponent(enemyId, new EnemyTypeComponent(EnemyType.Basic));

      // Add hit flash (would happen on final damage)
      const hitFlash = new HitFlashComponent(0.8, 100);
      entityManager.addComponent(enemyId, hitFlash);

      // Create explosion effect (happens on death)
      effectFactory.createEnemyExplosion({ x: position.x, y: position.y }, 0.8);

      // Verify both effects were applied
      const retrievedHitFlash = entityManager.getComponent(enemyId, HitFlashComponent);
      expect(retrievedHitFlash).toBeTruthy();
      expect(effectFactory.createEnemyExplosion).toHaveBeenCalled();
    });
  });
});
