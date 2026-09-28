import { TestBed } from '@angular/core/testing';
import { EffectFactoryService } from './effect-factory.service';
import { EffectsSystemService } from './effects-system.service';
import { EntityManagerService } from '../ecs/entity-manager.service';
import { ThemeService } from '@services/theme.service';
import { FloatingTextComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { getThemeColors } from '@photon/config/game-constants';

describe('EffectFactoryService', () => {
  let service: EffectFactoryService;
  let effectsSystem: jasmine.SpyObj<EffectsSystemService>;
  let entityManager: jasmine.SpyObj<EntityManagerService>;
  let themeService: { isDayMode: boolean };

  beforeEach(() => {
    effectsSystem = jasmine.createSpyObj('EffectsSystemService', [
      'createParticleEffect',
      'createEmitter',
      'createCustomEffect',
    ]);
    effectsSystem.createParticleEffect.and.returnValue('effect-id-1');
    effectsSystem.createEmitter.and.returnValue('emitter-id-1');
    effectsSystem.createCustomEffect.and.returnValue('custom-effect-id-1');

    entityManager = jasmine.createSpyObj('EntityManagerService', [
      'createEntity',
      'addComponent',
      'getEntitiesWithComponents',
    ]);
    entityManager.getEntitiesWithComponents.and.returnValue([]);
    let entityCounter = 0;
    entityManager.createEntity.and.callFake(() => ++entityCounter);

    themeService = { isDayMode: false };

    TestBed.configureTestingModule({
      providers: [
        EffectFactoryService,
        { provide: EffectsSystemService, useValue: effectsSystem },
        { provide: EntityManagerService, useValue: entityManager },
        { provide: ThemeService, useValue: themeService },
      ],
    });

    service = TestBed.inject(EffectFactoryService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createBeamTrail', () => {
    it('skips a zero-length Arc trail instead of emitting invalid particle vectors', () => {
      const result = service.createBeamTrail({ x: 40, y: 60 }, { x: 40, y: 60 });

      expect(result).toBeNull();
      expect(effectsSystem.createCustomEffect).not.toHaveBeenCalled();
    });

    it('creates a finite directional trail between distinct targets', () => {
      const result = service.createBeamTrail({ x: 10, y: 20 }, { x: 40, y: 60 });
      const emitter = effectsSystem.createCustomEffect.calls.mostRecent().args[1][0];

      expect(result).toBe('custom-effect-id-1');
      expect(emitter.initialDirection.x).toBeCloseTo(0.6);
      expect(emitter.initialDirection.y).toBeCloseTo(0.8);
      expect(Number.isFinite(emitter.initialSpeed)).toBeTrue();
    });
  });

  // ===== createShardCollection =====

  describe('createShardCollection', () => {
    it('should call createParticleEffect with scaled particle count for low value', () => {
      service.createShardCollection({ x: 100, y: 200 }, 1);

      const args = effectsSystem.createParticleEffect.calls.mostRecent().args;
      const particleCount = args[2] as number;
      // 6 + 1*3 = 9
      expect(particleCount).toBe(9);
    });

    it('should cap particle count at 24 for very high shard values', () => {
      service.createShardCollection({ x: 0, y: 0 }, 10);

      const args = effectsSystem.createParticleEffect.calls.mostRecent().args;
      const particleCount = args[2] as number;
      // 6 + 10*3 = 36, capped to 24
      expect(particleCount).toBe(24);
    });

    it('should scale radius with shard value', () => {
      service.createShardCollection({ x: 0, y: 0 }, 3);

      const args = effectsSystem.createParticleEffect.calls.mostRecent().args;
      const radius = args[3] as number;
      // 12 + 3*2 = 18
      expect(radius).toBe(18);
    });

    it('should cap radius at 25 for very high shard values', () => {
      service.createShardCollection({ x: 0, y: 0 }, 20);

      const args = effectsSystem.createParticleEffect.calls.mostRecent().args;
      const radius = args[3] as number;
      // 12 + 20*2 = 52, capped to 25
      expect(radius).toBe(25);
    });

    it('should scale duration with shard value', () => {
      service.createShardCollection({ x: 0, y: 0 }, 5);

      const args = effectsSystem.createParticleEffect.calls.mostRecent().args;
      const duration = args[4] as number;
      // 500 + min(5*30, 300) = 500 + 150 = 650
      expect(duration).toBe(650);
    });

    it('should cap duration bonus at 300ms for very high shard values', () => {
      service.createShardCollection({ x: 0, y: 0 }, 20);

      const args = effectsSystem.createParticleEffect.calls.mostRecent().args;
      const duration = args[4] as number;
      // 500 + min(20*30, 300) = 500 + 300 = 800
      expect(duration).toBe(800);
    });

    it('should return the effect id from effectsSystem', () => {
      effectsSystem.createParticleEffect.and.returnValue('shard-effect-abc');
      const result = service.createShardCollection({ x: 0, y: 0 }, 1);
      expect(result).toBe('shard-effect-abc');
    });
  });

  // ===== createShardPickupText =====

  describe('createShardPickupText', () => {
    it('should use SHARD_HIGH color for values > 5', () => {
      service.createShardPickupText({ x: 50, y: 50 }, 6);

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      expect(floatingTextCall).toBeDefined();
      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      const expectedColor = getThemeColors(false).CANVAS.SHARD_HIGH;
      expect(textComponent.color).toBe(expectedColor);
    });

    it('should use SHARD_MED color for values > 2 and <= 5', () => {
      service.createShardPickupText({ x: 50, y: 50 }, 3);

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      expect(floatingTextCall).toBeDefined();
      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      const expectedColor = getThemeColors(false).CANVAS.SHARD_MED;
      expect(textComponent.color).toBe(expectedColor);
    });

    it('should use SHARD_LOW color for values <= 2', () => {
      service.createShardPickupText({ x: 50, y: 50 }, 1);

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      expect(floatingTextCall).toBeDefined();
      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      const expectedColor = getThemeColors(false).CANVAS.SHARD_LOW;
      expect(textComponent.color).toBe(expectedColor);
    });

    it('should use font size 14 for high-value shards (> 5)', () => {
      service.createShardPickupText({ x: 0, y: 0 }, 6);

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.fontSize).toBe(14);
    });

    it('should use font size 12 for normal shards (<= 5)', () => {
      service.createShardPickupText({ x: 0, y: 0 }, 5);

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.fontSize).toBe(12);
    });

    it('should display "+N" text matching the shard value', () => {
      service.createShardPickupText({ x: 0, y: 0 }, 7);

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.text).toBe('+7');
    });

    it('should create a PositionComponent at the given position', () => {
      service.createShardPickupText({ x: 300, y: 400 }, 1);

      const posCall = entityManager.addComponent.calls.all().find((c) => c.args[1] instanceof PositionComponent);

      expect(posCall).toBeDefined();
      const posComponent = posCall!.args[1] as PositionComponent;
      expect(posComponent.x).toBe(300);
      expect(posComponent.y).toBe(400);
    });
  });

  // ===== createSynthesisBuffText =====

  describe('createSynthesisBuffText', () => {
    it('should use cyan (#00e5ff) for shard_speed buff', () => {
      service.createSynthesisBuffText({ x: 0, y: 0 }, 'shard_speed', 'speed boost');

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.color).toBe('#00e5ff');
    });

    it('should use orange (#ff6b35) for shard_damage buff', () => {
      service.createSynthesisBuffText({ x: 0, y: 0 }, 'shard_damage', 'damage surge');

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.color).toBe('#ff6b35');
    });

    it('should use gold (#ffd700) for shard_firerate buff', () => {
      service.createSynthesisBuffText({ x: 0, y: 0 }, 'shard_firerate', 'rapid fire');

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.color).toBe('#ffd700');
    });

    it('should use white (#ffffff) for unknown buff ids', () => {
      service.createSynthesisBuffText({ x: 0, y: 0 }, 'unknown_buff', 'mystery effect');

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.color).toBe('#ffffff');
    });

    it('should uppercase the description text', () => {
      service.createSynthesisBuffText({ x: 0, y: 0 }, 'shard_speed', 'speed boost');

      const floatingTextCall = entityManager.addComponent.calls
        .all()
        .find((c) => c.args[1] instanceof FloatingTextComponent);

      const textComponent = floatingTextCall!.args[1] as FloatingTextComponent;
      expect(textComponent.text).toBe('SPEED BOOST');
    });

    it('should add a VelocityComponent with upward motion', () => {
      service.createSynthesisBuffText({ x: 50, y: 50 }, 'shard_damage', 'hit');

      const velCall = entityManager.addComponent.calls.all().find((c) => c.args[1] instanceof VelocityComponent);

      expect(velCall).toBeDefined();
      const velComponent = velCall!.args[1] as VelocityComponent;
      expect(velComponent.vy).toBeLessThan(0);
    });
  });

  // ===== getSmartDamageNumberPosition (via createDamageNumber) =====

  describe('getSmartDamageNumberPosition (via createDamageNumber)', () => {
    beforeEach(() => {
      // Reset frame timer so per-frame cap doesn't interfere
      const internals = service as unknown as { lastDamageNumberFrame: number };
      internals.lastDamageNumberFrame = 0;
    });

    it('should return null when the per-frame cap (8) is exceeded', () => {
      const pos = { x: 0, y: 0 };

      // Exhaust the per-frame budget by simulating 8 calls in the same frame
      const frameSpy = spyOn(window.performance, 'now').and.returnValue(1000);

      // First call sets the frame; subsequent calls within same frame count toward cap
      for (let i = 0; i < 8; i++) {
        service.createDamageNumber(pos, 10);
      }

      // 9th call should be capped
      const result = service.createDamageNumber(pos, 10);
      expect(result).toBeNull();

      frameSpy.and.callThrough();
    });

    it('should offset stacked damage numbers using DAMAGE_NUMBER_DIRECTIONS', () => {
      const pos = { x: 100, y: 100 };

      service.createDamageNumber(pos, 5);

      const posCall = entityManager.addComponent.calls.all().find((c) => c.args[1] instanceof PositionComponent);

      expect(posCall).toBeDefined();
      const posComponent = posCall!.args[1] as PositionComponent;

      // First call: directional index 0 = { x: 0, y: -25 }
      // Final: x ≈ 100 + 0 ± 5, y ≈ 100 - 15 + (-25) ± 5
      // x should be near 100, y should be well above 100
      expect(posComponent.x).toBeCloseTo(100, -1);
      expect(posComponent.y).toBeLessThan(70);
    });

    it('should clean recentDamageNumbers entries older than 400ms', () => {
      const internals = service as unknown as {
        recentDamageNumbers: { x: number; y: number; time: number }[];
        lastDamageNumberFrame: number;
      };

      // Inject a stale entry (500ms ago)
      internals.recentDamageNumbers.push({ x: 100, y: 100, time: Date.now() - 500 });
      internals.lastDamageNumberFrame = 0;

      expect(internals.recentDamageNumbers.length).toBe(1);

      service.createDamageNumber({ x: 100, y: 100 }, 5);

      // The stale entry should have been pruned; only the new entry from this call remains
      expect(internals.recentDamageNumbers.length).toBe(1);
      expect(internals.recentDamageNumbers[0].time).toBeGreaterThan(Date.now() - 100);
    });

    it('should reset per-frame counter when a new frame begins (>16ms gap)', () => {
      let fakeTime = 1000;
      const frameSpy = spyOn(window.performance, 'now').and.callFake(() => fakeTime);

      // Fill the frame budget — spread positions to avoid spatial suppression
      for (let i = 0; i < 8; i++) {
        service.createDamageNumber({ x: i * 200, y: 0 }, 10);
      }
      // 9th in same frame → per-frame cap reached
      expect(service.createDamageNumber({ x: 2000, y: 0 }, 10)).toBeNull();

      // Advance to a new frame
      fakeTime = 1050;
      const result = service.createDamageNumber({ x: 3000, y: 0 }, 10);

      expect(result).not.toBeNull();

      frameSpy.and.callThrough();
    });
  });
});
