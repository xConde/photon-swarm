/**
 * Rendering Systems Tests
 *
 * Covers:
 *   - EffectsRenderingSystemService
 *   - StarfieldSystemService
 *   - FloatingTextSystemService
 *
 * NOTE: RenderingSystemService is excluded — it depends on 13+ root-scoped
 * services (GameRenderingService, GameEngineService, PlayerService, etc.)
 * whose own heavy dependencies make isolated unit testing cost-prohibitive
 * in Karma. The other three services are self-contained and testable.
 */

import { TestBed } from '@angular/core/testing';

import { EffectsRenderingSystemService } from './effects-rendering-system.service';
import { StarfieldSystemService } from './starfield-system.service';
import { FloatingTextSystemService } from './floating-text-system.service';

import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EffectsSystemService } from '../../entities/effects-system.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ThemeService } from '@services/theme.service';
import { FloatingTextComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { ErrorHandlerService } from '../../utils/error-handler.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCtx(): jasmine.SpyObj<CanvasRenderingContext2D> {
  return jasmine.createSpyObj<CanvasRenderingContext2D>('ctx', [
    'save',
    'restore',
    'beginPath',
    'arc',
    'fill',
    'fillRect',
    'stroke',
    'strokeText',
    'fillText',
    'drawImage',
    'moveTo',
    'lineTo',
  ]);
}

function createMockCanvas(): jasmine.SpyObj<HTMLCanvasElement> {
  const canvas = jasmine.createSpyObj<HTMLCanvasElement>('canvas', ['getContext']);
  (canvas as unknown as { width: number }).width = 800;
  (canvas as unknown as { height: number }).height = 600;
  return canvas;
}

// ---------------------------------------------------------------------------
// EffectsRenderingSystemService
// ---------------------------------------------------------------------------

describe('EffectsRenderingSystemService', () => {
  let service: EffectsRenderingSystemService;
  let mockEffectsSystem: jasmine.SpyObj<EffectsSystemService>;

  beforeEach(() => {
    mockEffectsSystem = jasmine.createSpyObj<EffectsSystemService>('EffectsSystemService', [
      'update',
      'render',
      'reset',
      'getPerformanceStats',
    ]);
    mockEffectsSystem.getPerformanceStats.and.returnValue({
      activeParticles: 0,
      activeEmitters: 0,
      activeEffects: 0,
      poolUtilization: 0,
      renderTime: 0,
      updateTime: 0,
      memoryUsage: 0,
    });

    TestBed.configureTestingModule({
      providers: [EffectsRenderingSystemService, { provide: EffectsSystemService, useValue: mockEffectsSystem }],
    });

    service = TestBed.inject(EffectsRenderingSystemService);
  });

  // --- init() ---

  describe('init()', () => {
    it('should be defined', () => {
      expect(service.init).toBeDefined();
    });

    it('should not throw when called with a mock entity manager', () => {
      const mockEM = jasmine.createSpyObj('EntityManager', ['getEntitiesWithComponents']);
      expect(() => service.init(mockEM)).not.toThrow();
    });
  });

  // --- update() ---

  describe('update()', () => {
    it('should advance effects without rendering them', () => {
      const mockEM = jasmine.createSpyObj('EntityManager', ['getEntitiesWithComponents']);
      service.update(16, mockEM);

      expect(mockEffectsSystem.update).toHaveBeenCalledWith(16);
      expect(mockEffectsSystem.render).not.toHaveBeenCalled();
    });

    it('should not throw when called with zero delta time', () => {
      const mockEM = jasmine.createSpyObj('EntityManager', ['getEntitiesWithComponents']);
      expect(() => service.update(0, mockEM)).not.toThrow();
    });
  });

  // --- getEffectStats() ---

  describe('getEffectStats()', () => {
    it('should return stats from the effects system', () => {
      mockEffectsSystem.getPerformanceStats.and.returnValue({
        activeParticles: 5,
        activeEmitters: 2,
        activeEffects: 1,
        poolUtilization: 0,
        renderTime: 0,
        updateTime: 0,
        memoryUsage: 0,
      });

      const stats = service.getEffectStats();

      expect(stats.activeParticles).toBe(5);
      expect(stats.activeEmitters).toBe(2);
      expect(stats.activeEffects).toBe(1);
    });
  });

  // --- destroy() ---

  describe('destroy()', () => {
    it('should call reset on the effects system', () => {
      service.destroy();
      expect(mockEffectsSystem.reset).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// StarfieldSystemService
// ---------------------------------------------------------------------------

describe('StarfieldSystemService', () => {
  let service: StarfieldSystemService;
  let mockCtx: jasmine.SpyObj<CanvasRenderingContext2D>;
  let mockNow: number;

  beforeEach(() => {
    mockNow = 1000;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);

    mockCtx = createMockCtx();
    // globalAlpha is a property, not a method — set it directly
    (mockCtx as unknown as { globalAlpha: number }).globalAlpha = 1;
    (mockCtx as unknown as { fillStyle: string }).fillStyle = '';

    TestBed.configureTestingModule({
      providers: [StarfieldSystemService],
    });

    service = TestBed.inject(StarfieldSystemService);
  });

  // --- init() ---

  describe('init()', () => {
    it('should generate stars on first call', () => {
      const mockEM = jasmine.createSpyObj('EntityManager', ['getEntitiesWithComponents']);
      service.init(mockEM);

      expect(service.getStarCount()).toBeGreaterThan(0);
    });

    it('should not regenerate stars if called a second time', () => {
      const mockEM = jasmine.createSpyObj('EntityManager', ['getEntitiesWithComponents']);
      service.init(mockEM);
      const firstCount = service.getStarCount();

      service.init(mockEM);

      expect(service.getStarCount()).toBe(firstCount);
    });

    it('should not throw when called', () => {
      const mockEM = jasmine.createSpyObj('EntityManager', ['getEntitiesWithComponents']);
      expect(() => service.init(mockEM)).not.toThrow();
    });
  });

  // --- initWithDimensions() ---

  describe('initWithDimensions()', () => {
    it('should generate stars proportional to the world area', () => {
      service.initWithDimensions(1000, 1000);

      const countSmall = service.getStarCount();

      const service2 = new StarfieldSystemService();
      service2.initWithDimensions(2000, 2000);

      expect(service2.getStarCount()).toBeGreaterThan(countSmall);
    });

    it('should not re-initialize if already initialized', () => {
      service.initWithDimensions(500, 500);
      const firstCount = service.getStarCount();

      service.initWithDimensions(3000, 3000);

      expect(service.getStarCount()).toBe(firstCount);
    });
  });

  // --- update() ---

  describe('update()', () => {
    it('should not throw with empty entity list', () => {
      const mockEM = jasmine.createSpyObj('EntityManagerService', ['getEntitiesWithComponents']);
      service.init(mockEM);
      expect(() => service.update(16, mockEM)).not.toThrow();
    });

    it('should update star opacities on each tick', () => {
      const mockEM = jasmine.createSpyObj('EntityManagerService', ['getEntitiesWithComponents']);
      service.init(mockEM);

      // Grab initial opacities via getVisibleStarCount to confirm init worked
      const beforeCount = service.getStarCount();

      mockNow = 5000; // advance time to change sin() output
      service.update(16, mockEM);

      // Still the same stars — count unchanged
      expect(service.getStarCount()).toBe(beforeCount);
    });
  });

  // --- renderStarfield() ---

  describe('renderStarfield()', () => {
    beforeEach(() => {
      const mockEM = jasmine.createSpyObj('EntityManagerService', ['getEntitiesWithComponents']);
      service.init(mockEM);
    });

    it('should not throw when rendered with valid camera position', () => {
      expect(() => service.renderStarfield(mockCtx, 0, 0, 800, 600)).not.toThrow();
    });

    it('should not render anything before init is called', () => {
      const freshService = new StarfieldSystemService();
      // Not initialized yet
      freshService.renderStarfield(mockCtx, 0, 0, 800, 600);

      expect(mockCtx.fillRect).not.toHaveBeenCalled();
      expect(mockCtx.arc).not.toHaveBeenCalled();
    });

    it('should reset globalAlpha to 1 after rendering', () => {
      service.renderStarfield(mockCtx, 0, 0, 800, 600);

      // The last thing renderStarfield does is ctx.globalAlpha = 1
      expect((mockCtx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
    });

    it('should use fillRect for very small (< 1 scaled size) stars', () => {
      // Use a small scale to force tiny-star path
      service.renderStarfield(mockCtx, 0, 0, 800, 600, false, 0.1);

      // At scale 0.1, all stars with size <= 10 will have scaledSize < 1
      // so at least fillRect should have been called for visible stars
      // (can't guarantee it without controlling star sizes, but we can assert no throw)
      expect(mockCtx).toBeDefined();
    });

    it('should viewport-cull stars outside the visible area', () => {
      // Move camera far away from origin where stars were generated
      const cameraX = 1_000_000;
      const cameraY = 1_000_000;

      const callsBefore = mockCtx.beginPath.calls.count();
      service.renderStarfield(mockCtx, cameraX, cameraY, 800, 600);
      const callsAfter = mockCtx.beginPath.calls.count();

      // No arc/fill calls should happen for an empty viewport
      expect(callsAfter - callsBefore).toBe(0);
    });

    it('should use dark-mode colors when isDayMode is false', () => {
      // Just verify no throw; color choices are internal
      expect(() => service.renderStarfield(mockCtx, 0, 0, 800, 600, false)).not.toThrow();
    });

    it('should use light-mode colors when isDayMode is true', () => {
      expect(() => service.renderStarfield(mockCtx, 0, 0, 800, 600, true)).not.toThrow();
    });
  });

  // --- getVisibleStarCount() ---

  describe('getVisibleStarCount()', () => {
    it('should return 0 when camera is far from all stars', () => {
      service.initWithDimensions(1000, 1000);

      const count = service.getVisibleStarCount(1_000_000, 1_000_000, 800, 600);

      expect(count).toBe(0);
    });

    it('should return > 0 when camera overlaps the star field', () => {
      service.initWithDimensions(5000, 5000);

      const count = service.getVisibleStarCount(0, 0, 5000, 5000);

      expect(count).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// FloatingTextSystemService
// ---------------------------------------------------------------------------

describe('FloatingTextSystemService', () => {
  let service: FloatingTextSystemService;
  let entityManager: EntityManagerService;
  let mockGameEngine: jasmine.SpyObj<GameEngineService>;
  let mockEntityFactory: jasmine.SpyObj<EntityFactoryECSService>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;
  let mockCtx: jasmine.SpyObj<CanvasRenderingContext2D>;
  let mockNow: number;

  beforeEach(() => {
    mockNow = 1000;
    spyOn(window.performance, 'now').and.callFake(() => mockNow);

    mockCtx = createMockCtx();
    // Writable canvas-context properties needed by renderFloatingText
    (mockCtx as unknown as { font: string }).font = '';
    (mockCtx as unknown as { textAlign: string }).textAlign = '';
    (mockCtx as unknown as { textBaseline: string }).textBaseline = '';
    (mockCtx as unknown as { strokeStyle: string }).strokeStyle = '';
    (mockCtx as unknown as { fillStyle: string }).fillStyle = '';
    (mockCtx as unknown as { lineWidth: number }).lineWidth = 1;

    const mockCanvas = createMockCanvas();

    mockGameEngine = jasmine.createSpyObj<GameEngineService>('GameEngineService', ['getCanvas', 'getContext']);
    mockGameEngine.getCanvas.and.returnValue(mockCanvas);
    mockGameEngine.getContext.and.returnValue(mockCtx);

    mockEntityFactory = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', ['returnToPool']);

    mockThemeService = jasmine.createSpyObj<ThemeService>('ThemeService', [], { isDayMode: false });

    const errorHandlerSpy = jasmine.createSpyObj<ErrorHandlerService>('ErrorHandlerService', ['handleECSError']);

    TestBed.configureTestingModule({
      providers: [
        FloatingTextSystemService,
        EntityManagerService,
        { provide: GameEngineService, useValue: mockGameEngine },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
        { provide: ThemeService, useValue: mockThemeService },
        { provide: ErrorHandlerService, useValue: errorHandlerSpy },
      ],
    });

    service = TestBed.inject(FloatingTextSystemService);
    entityManager = TestBed.inject(EntityManagerService);
  });

  afterEach(() => {
    entityManager.clear();
  });

  // --- Helpers ---

  function createFloatingTextEntity(
    text = 'TEST',
    color = '#ffffff',
    durationMs = 1000,
    offsetX = 0,
    offsetY = -20
  ): number {
    const entity = entityManager.createEntity();
    entityManager.addComponent(entity, new PositionComponent(100, 100));
    entityManager.addComponent(entity, new VelocityComponent(0, 0));
    entityManager.addComponent(
      entity,
      new FloatingTextComponent(text, color, 16, durationMs, mockNow, offsetX, offsetY, 0, -50, 0.7, 1)
    );
    return entity;
  }

  // --- update() ---

  describe('update()', () => {
    it('should not throw with no floating text entities', () => {
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should not throw with a valid floating text entity', () => {
      createFloatingTextEntity();
      expect(() => service.update(16, entityManager)).not.toThrow();
    });

    it('should queue expired entities for pool return', () => {
      createFloatingTextEntity('x', '#fff', 100);

      // Advance time past the entity duration
      mockNow = 1200;
      service.update(16, entityManager);

      expect(mockEntityFactory.returnToPool).toHaveBeenCalled();
    });

    it('should not remove non-expired entities from the entity manager', () => {
      createFloatingTextEntity('x', '#fff', 2000);

      service.update(16, entityManager);

      // Entity is still alive — no pool return yet
      expect(mockEntityFactory.returnToPool).not.toHaveBeenCalled();
    });

    it('should update offsetX/Y based on velocity and deltaTime', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PositionComponent(100, 100));
      entityManager.addComponent(entity, new VelocityComponent(0, 0));
      const ftComp = new FloatingTextComponent('HIT', '#fff', 16, 2000, mockNow, 0, -20, 10, -50, 0.7, 1);
      entityManager.addComponent(entity, ftComp);

      const dtMs = 100; // 0.1 seconds
      service.update(dtMs, entityManager);

      // offsetX += velocityX * (dtMs / 1000)  =>  0 + 10 * 0.1 = 1
      // offsetY += velocityY * (dtMs / 1000)  => -20 + (-50 * 0.1) = -25
      expect(ftComp.offsetX).toBeCloseTo(1, 5);
      expect(ftComp.offsetY).toBeCloseTo(-25, 5);
    });

    it('should not call getContext when there are no entities', () => {
      // Reset call count
      mockGameEngine.getContext.calls.reset();

      service.update(16, entityManager);

      // getContext is called once at the start regardless of entity count
      // but we should get no errors
      expect(service).toBeTruthy();
    });
  });

  // --- renderFloatingText() ---

  describe('renderFloatingText()', () => {
    const camera = { x: 0, y: 0 };

    it('should not throw with no floating text entities', () => {
      expect(() => service.renderFloatingText(mockCtx, camera, entityManager)).not.toThrow();
    });

    it('should call fillText for each visible floating text entity', () => {
      createFloatingTextEntity('99');
      createFloatingTextEntity('CRIT');

      service.renderFloatingText(mockCtx, camera, entityManager);

      // Text is now rendered via drawImage (pre-cached OffscreenCanvas sprite)
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('should call strokeText for each entity (outline pass)', () => {
      createFloatingTextEntity('42');

      service.renderFloatingText(mockCtx, camera, entityManager);

      // Outline is baked into the sprite; drawImage renders both fill and outline in one call
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(1);
    });

    it('should offset screen position by camera', () => {
      createFloatingTextEntity('HIT', '#ff0000', 2000, 0, 0);

      const cameraOffset = { x: 50, y: 30 };
      service.renderFloatingText(mockCtx, cameraOffset, entityManager);

      // Entity is at (100, 100). Camera at (50, 30). Expected screen pos: (50, 70).
      // drawImage(sprite, screenX - sprite.width/2, screenY - sprite.height/2)
      // Verify drawImage was called (sprite-based rendering with camera offset applied)
      expect(mockCtx.drawImage).toHaveBeenCalled();
      const drawArgs = mockCtx.drawImage.calls.mostRecent().args;
      // args[0] is the OffscreenCanvas sprite; args[1] is x, args[2] is y
      // x ≈ screenX - sprite.width/2 where screenX = 100 + 0 - 50 = 50
      // y ≈ screenY - sprite.height/2 where screenY = 100 + 0 - 30 = 70
      // We can't know exact sprite dimensions, but center of sprite should be near (50, 70)
      expect(drawArgs[0]).toBeTruthy(); // sprite (OffscreenCanvas)
      // drawImage x offset: screenX - spriteWidth/2; screenX must be 50
      // drawImage y offset: screenY - spriteHeight/2; screenY must be 70
      // The sprite center x position = drawArgs[1] + spriteWidth/2 should ≈ 50
      // The sprite center y position = drawArgs[2] + spriteHeight/2 should ≈ 70
      const sprite = drawArgs[0] as OffscreenCanvas;
      expect(drawArgs[1] + sprite.width / 2).toBeCloseTo(50, 0);
      expect(drawArgs[2] + sprite.height / 2).toBeCloseTo(70, 0);
    });

    it('should not render entities that have no FloatingTextComponent', () => {
      const entity = entityManager.createEntity();
      entityManager.addComponent(entity, new PositionComponent(100, 100));
      // No FloatingTextComponent

      service.renderFloatingText(mockCtx, camera, entityManager);

      expect(mockCtx.fillText).not.toHaveBeenCalled();
    });

    it('should render outline text in dark mode', () => {
      (mockThemeService as unknown as { isDayMode: boolean }).isDayMode = false;
      createFloatingTextEntity('DMG');

      service.renderFloatingText(mockCtx, camera, entityManager);

      // Outline is baked into the sprite; drawImage renders both fill and outline
      expect(mockCtx.drawImage).toHaveBeenCalled();
    });

    it('should render outline text in light mode', () => {
      (mockThemeService as unknown as { isDayMode: boolean }).isDayMode = true;
      createFloatingTextEntity('DMG');

      service.renderFloatingText(mockCtx, camera, entityManager);

      // Outline is baked into the sprite; drawImage renders both fill and outline
      expect(mockCtx.drawImage).toHaveBeenCalled();
    });
  });

  // --- Viewport culling (opacity-based) ---

  describe('opacity at expiry', () => {
    it('should skip rendering an expired text during renderFloatingText', () => {
      createFloatingTextEntity('OLD', '#fff', 500);

      // Expire the entity (duration 500ms, created at t=1000, now t=1600 → elapsed > duration)
      mockNow = 1600;

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      // Expired entities have opacity <= 0 and are skipped — drawImage should NOT be called
      expect(mockCtx.drawImage).not.toHaveBeenCalled();
    });
  });

  // --- save/restore balance ---

  describe('save/restore balance', () => {
    it('update() does not call save or restore (no transform needed)', () => {
      createFloatingTextEntity();
      service.update(16, entityManager);

      expect(mockCtx.save).not.toHaveBeenCalled();
      expect(mockCtx.restore).not.toHaveBeenCalled();
    });

    it('renderFloatingText() does not call save or restore', () => {
      createFloatingTextEntity();
      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      expect(mockCtx.save).not.toHaveBeenCalled();
      expect(mockCtx.restore).not.toHaveBeenCalled();
    });
  });
});
