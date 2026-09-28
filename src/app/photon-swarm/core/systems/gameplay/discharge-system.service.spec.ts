import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { DischargeSystemService } from './discharge-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { EffectFactoryService } from '../../entities/effect-factory.service';
import { DebugLogBridgeService } from '../../debug/debug-log-bridge.service';
import { SettingsService } from '../../utils/settings.service';
import {
  DischargeComponent,
  EnemyTypeComponent,
  HealthComponent,
  PlayerControlledComponent,
  PositionComponent,
  VelocityComponent,
} from '@photon/components';
import { DischargeEvent } from '../../models/player.model';

describe('DischargeSystemService', () => {
  let service: DischargeSystemService;
  let mockEntityManager: jasmine.SpyObj<EntityManagerService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockEffectFactory: jasmine.SpyObj<EffectFactoryService>;
  let mockDebugLog: jasmine.SpyObj<DebugLogBridgeService>;
  let mockSettings: jasmine.SpyObj<SettingsService>;
  let dischargeSubject: Subject<DischargeEvent>;

  // Entity IDs
  const PLAYER_ID = 1;
  const ENEMY_NEAR_ID = 10;
  const ENEMY_FAR_ID = 11;
  const ENEMY_EDGE_ID = 12;

  // Component storage keyed by entityId then component type
  const componentStore = new Map<number, Map<unknown, unknown>>();

  function setComponent<T>(entityId: number, type: unknown, comp: T): void {
    if (!componentStore.has(entityId)) {
      componentStore.set(entityId, new Map());
    }
    componentStore.get(entityId)!.set(type, comp);
  }

  function setupPlayerEntity(x: number, y: number): void {
    setComponent(PLAYER_ID, PlayerControlledComponent, new PlayerControlledComponent());
    setComponent(PLAYER_ID, PositionComponent, new PositionComponent(x, y));
    setComponent(PLAYER_ID, DischargeComponent, new DischargeComponent());
  }

  function setupEnemyEntity(entityId: number, x: number, y: number, health: number, type: string = 'basic'): void {
    setComponent(entityId, PositionComponent, new PositionComponent(x, y));
    setComponent(entityId, HealthComponent, new HealthComponent(health));
    setComponent(entityId, EnemyTypeComponent, new EnemyTypeComponent(type));
  }

  beforeEach(() => {
    componentStore.clear();

    dischargeSubject = new Subject<DischargeEvent>();

    mockPlayerService = jasmine.createSpyObj('PlayerService', ['getDischargeRadiusMultiplier'], {
      discharge$: dischargeSubject.asObservable(),
    });
    mockPlayerService.getDischargeRadiusMultiplier.and.returnValue(1.0);

    mockEffectFactory = jasmine.createSpyObj('EffectFactoryService', [
      'createDischargeWave',
      'createDamageNumber',
      'createBeamImpact',
      'createDeathParticles',
    ]);

    mockDebugLog = jasmine.createSpyObj('DebugLogBridgeService', ['log']);

    mockSettings = jasmine.createSpyObj('SettingsService', ['getSettings']);
    mockSettings.getSettings.and.returnValue({
      showDamageNumbers: true,
      volume: 100,
      screenShake: false,
      sensitivity: 100,
      chromaticAberration: true,
      lowHealthVignette: true,
      colorblindMode: 'none',
    });

    mockEntityManager = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'addComponent',
    ]);

    // Wire up getEntitiesWithComponents

    mockEntityManager.getEntitiesWithComponents.and.callFake((...types: any[]) => {
      const result: number[] = [];
      for (const [entityId, comps] of componentStore.entries()) {
        if (types.every((t: unknown) => comps.has(t))) {
          result.push(entityId);
        }
      }
      return result;
    });

    // Wire up getComponent

    mockEntityManager.getComponent.and.callFake((entityId: number, type: any): any => {
      return componentStore.get(entityId)?.get(type);
    });

    TestBed.configureTestingModule({
      providers: [
        DischargeSystemService,
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: EffectFactoryService, useValue: mockEffectFactory },
        { provide: DebugLogBridgeService, useValue: mockDebugLog },
        { provide: SettingsService, useValue: mockSettings },
      ],
    });

    service = TestBed.inject(DischargeSystemService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should subscribe to player discharge events', () => {
    // Verify the service processes events emitted on discharge$
    setupPlayerEntity(100, 100);

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    expect(mockEffectFactory.createDischargeWave).toHaveBeenCalled();
  });

  it('should not process when no trigger received', () => {
    setupPlayerEntity(100, 100);

    service.update(16, mockEntityManager);

    expect(mockEffectFactory.createDischargeWave).not.toHaveBeenCalled();
  });

  it('should create visual effect on discharge', () => {
    setupPlayerEntity(200, 300);

    dischargeSubject.next({ x: 200, y: 300, radius: 250, chargeLevel: 0.5 });
    service.update(16, mockEntityManager);

    expect(mockEffectFactory.createDischargeWave).toHaveBeenCalledWith(
      jasmine.objectContaining({ x: 200, y: 300 }),
      jasmine.any(Number)
    );
  });

  it('should damage enemies within radius', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 120, 100, 500); // 20px away

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    const enemyHealth = componentStore.get(ENEMY_NEAR_ID)!.get(HealthComponent) as HealthComponent;
    expect(enemyHealth.health).toBeLessThan(500);
  });

  it('should not damage enemies outside radius', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_FAR_ID, 1000, 1000, 500); // ~1273px away, well outside radius

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    const enemyHealth = componentStore.get(ENEMY_FAR_ID)!.get(HealthComponent) as HealthComponent;
    expect(enemyHealth.health).toBe(500);
  });

  it('should scale damage by charge level', () => {
    // Full charge
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 100, 100, 1000); // Same position = 0 distance

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    const healthAfterFull = (componentStore.get(ENEMY_NEAR_ID)!.get(HealthComponent) as HealthComponent).health;
    const fullChargeDamage = 1000 - healthAfterFull;

    // Reset for zero charge test
    componentStore.clear();
    service.ngOnDestroy();

    // Re-create service with fresh subscription
    dischargeSubject = new Subject<DischargeEvent>();
    (Object.getOwnPropertyDescriptor(mockPlayerService, 'discharge$')!.get as jasmine.Spy).and.returnValue(
      dischargeSubject.asObservable()
    );
    service = TestBed.inject(DischargeSystemService);

    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 100, 100, 1000);

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 0.0 });
    service.update(16, mockEntityManager);

    const healthAfterZero = (componentStore.get(ENEMY_NEAR_ID)!.get(HealthComponent) as HealthComponent).health;
    const zeroChargeDamage = 1000 - healthAfterZero;

    // Full charge (1.5x multiplier) should do more damage than zero charge (0.5x multiplier)
    expect(fullChargeDamage).toBeGreaterThan(zeroChargeDamage);
  });

  it('should apply damage falloff based on distance', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 100, 100, 1000); // Distance 0 (center)
    setupEnemyEntity(ENEMY_EDGE_ID, 340, 100, 1000); // Distance 240 (near edge of 250 radius)

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    const centerHealth = (componentStore.get(ENEMY_NEAR_ID)!.get(HealthComponent) as HealthComponent).health;
    const edgeHealth = (componentStore.get(ENEMY_EDGE_ID)!.get(HealthComponent) as HealthComponent).health;

    const centerDamage = 1000 - centerHealth;
    const edgeDamage = 1000 - edgeHealth;

    // Center enemy should take more damage than edge enemy due to falloff
    expect(centerDamage).toBeGreaterThan(edgeDamage);
  });

  it('should apply knockback away from player', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 200, 100, 500); // 100px to the right
    // Give the enemy a velocity component
    const velocity = new VelocityComponent(0, 0);
    setComponent(ENEMY_NEAR_ID, VelocityComponent, velocity);

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    // Enemy is to the right of player, so knockback should push further right (positive vx)
    expect(velocity.vx).toBeGreaterThan(0);
    // Vertical knockback should be near zero (enemy is directly to the right)
    expect(Math.abs(velocity.vy)).toBeLessThan(1);
  });

  it('should create damage numbers for hit enemies (not critical)', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 120, 100, 500);

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    expect(mockEffectFactory.createDamageNumber).toHaveBeenCalledWith(
      jasmine.any(Object),
      jasmine.any(Number),
      false // isCritical must be false
    );
  });

  it('should prevent spam (1-second cooldown between triggers)', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 120, 100, 500);

    // First discharge
    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    expect(mockEffectFactory.createDischargeWave).toHaveBeenCalledTimes(1);

    // Second discharge immediately — should be blocked by 1-second spam prevention
    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    // Still only 1 call — second was ignored
    expect(mockEffectFactory.createDischargeWave).toHaveBeenCalledTimes(1);
  });

  it('should clean up subscription on destroy', () => {
    setupPlayerEntity(100, 100);

    service.ngOnDestroy();

    // After destroy, emitting should NOT trigger discharge
    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    expect(mockEffectFactory.createDischargeWave).not.toHaveBeenCalled();
  });

  it('should cap radius to 400px maximum', () => {
    // Set a very high radius multiplier to exceed the 400px cap
    mockPlayerService.getDischargeRadiusMultiplier.and.returnValue(5.0);

    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 120, 100, 500);

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    // The capped radius passed to createDischargeWave should not exceed 400
    const callArgs = mockEffectFactory.createDischargeWave.calls.mostRecent().args;
    const passedRadius = callArgs[1] as number;
    expect(passedRadius).toBeLessThanOrEqual(400);
  });

  it('should skip enemies with zero or negative health', () => {
    setupPlayerEntity(100, 100);
    setupEnemyEntity(ENEMY_NEAR_ID, 120, 100, 0); // Already dead

    dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
    service.update(16, mockEntityManager);

    // Visual effect is created, but no damage numbers for dead enemies
    expect(mockEffectFactory.createDischargeWave).toHaveBeenCalled();
    expect(mockEffectFactory.createDamageNumber).not.toHaveBeenCalled();
  });

  describe('cameraShakeTimeout cleanup', () => {
    it('should fire camera shake after 400ms when screenShake is enabled', fakeAsync(() => {
      mockSettings.getSettings.and.returnValue({
        showDamageNumbers: false,
        volume: 100,
        screenShake: true,
        sensitivity: 100,
        chromaticAberration: true,
        lowHealthVignette: true,
        colorblindMode: 'none',
      });

      const addShakeSpy = jasmine.createSpy('addShake');
      (window as { cameraShake?: { addShake: jasmine.Spy } }).cameraShake = { addShake: addShakeSpy };

      setupPlayerEntity(100, 100);
      dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
      service.update(16, mockEntityManager);

      // Timer should not have fired yet
      tick(200);
      expect(addShakeSpy).not.toHaveBeenCalled();

      // Timer fires at 400ms
      tick(200);
      expect(addShakeSpy).toHaveBeenCalledWith({ intensity: 10, duration: 200 });

      delete (window as { cameraShake?: unknown }).cameraShake;
    }));

    it('should cancel camera shake timer on ngOnDestroy', fakeAsync(() => {
      mockSettings.getSettings.and.returnValue({
        showDamageNumbers: false,
        volume: 100,
        screenShake: true,
        sensitivity: 100,
        chromaticAberration: true,
        lowHealthVignette: true,
        colorblindMode: 'none',
      });

      let shakeCallCount = 0;
      (window as { cameraShake?: { addShake: () => void } }).cameraShake = {
        addShake: () => {
          shakeCallCount++;
        },
      };

      setupPlayerEntity(100, 100);
      dischargeSubject.next({ x: 100, y: 100, radius: 250, chargeLevel: 1.0 });
      service.update(16, mockEntityManager);

      // Destroy before 400ms timer fires
      service.ngOnDestroy();

      tick(500);

      // Shake must NOT fire after destroy
      expect(shakeCallCount).toBe(0);

      delete (window as { cameraShake?: unknown }).cameraShake;
    }));

    it('should not throw on ngOnDestroy when no timer is pending', () => {
      expect(() => service.ngOnDestroy()).not.toThrow();
    });
  });
});
