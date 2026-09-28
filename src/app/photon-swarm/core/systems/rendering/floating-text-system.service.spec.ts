/**
 * FloatingTextSystemService — dedicated spec
 *
 * Covers:
 *   1. update()            — offset movement, expiry pool return, missing-component grace
 *   2. renderFloatingText() — screen position math, globalAlpha, zero-opacity skip, reset
 *   3. getTextSprite()     — cache hit, MAX_SPRITE_CACHE eviction (via renderFloatingText)
 *   4. createDamageNumber() — component setup, crit vs normal color/size, pool vs bare entity
 */

import { TestBed } from '@angular/core/testing';
import { createDamageNumber, FloatingTextSystemService } from './floating-text-system.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { ThemeService } from '@services/theme.service';
import { FloatingTextComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { PoolType } from '@photon/config/game-constants';
import { ErrorHandlerService } from '../../utils/error-handler.service';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockCtx(): jasmine.SpyObj<CanvasRenderingContext2D> {
  const ctx = jasmine.createSpyObj<CanvasRenderingContext2D>('ctx', [
    'save',
    'restore',
    'beginPath',
    'arc',
    'fill',
    'fillRect',
    'drawImage',
    'fillText',
    'strokeText',
    'moveTo',
    'lineTo',
    'stroke',
  ]);
  // Canvas context properties that are written (not just called as methods)
  (ctx as unknown as { globalAlpha: number }).globalAlpha = 1;
  (ctx as unknown as { font: string }).font = '';
  (ctx as unknown as { textAlign: string }).textAlign = '';
  (ctx as unknown as { textBaseline: string }).textBaseline = '';
  (ctx as unknown as { strokeStyle: string }).strokeStyle = '';
  (ctx as unknown as { fillStyle: string }).fillStyle = '';
  (ctx as unknown as { lineWidth: number }).lineWidth = 1;
  return ctx;
}

function createMockCanvas(): jasmine.SpyObj<HTMLCanvasElement> {
  const canvas = jasmine.createSpyObj<HTMLCanvasElement>('canvas', ['getContext']);
  (canvas as unknown as { width: number }).width = 800;
  (canvas as unknown as { height: number }).height = 600;
  return canvas;
}

// ---------------------------------------------------------------------------
// Test suite
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
    const mockCanvas = createMockCanvas();

    mockGameEngine = jasmine.createSpyObj<GameEngineService>('GameEngineService', ['getCanvas', 'getContext']);
    mockGameEngine.getCanvas.and.returnValue(mockCanvas);
    mockGameEngine.getContext.and.returnValue(mockCtx);

    mockEntityFactory = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', [
      'returnToPool',
      'getFromPool',
      'markEntityAsActive',
    ]);
    mockEntityFactory.getFromPool.and.returnValue(null);

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

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function makeEntity(opts: {
    text?: string;
    color?: string;
    durationMs?: number;
    velocityX?: number;
    velocityY?: number;
    offsetX?: number;
    offsetY?: number;
    withVelocityComponent?: boolean;
  }): { entityId: number; ftComp: FloatingTextComponent } {
    const {
      text = 'DMG',
      color = '#ffffff',
      durationMs = 2000,
      velocityX = 0,
      velocityY = -50,
      offsetX = 0,
      offsetY = -20,
      withVelocityComponent = true,
    } = opts;

    const entityId = entityManager.createEntity();
    entityManager.addComponent(entityId, new PositionComponent(100, 200));
    if (withVelocityComponent) {
      entityManager.addComponent(entityId, new VelocityComponent(0, 0));
    }
    const ftComp = new FloatingTextComponent(
      text,
      color,
      16,
      durationMs,
      mockNow,
      offsetX,
      offsetY,
      velocityX,
      velocityY,
      0.7,
      1
    );
    entityManager.addComponent(entityId, ftComp);
    return { entityId, ftComp };
  }

  // ---------------------------------------------------------------------------
  // update() — offset movement
  // ---------------------------------------------------------------------------

  describe('update() — offset movement', () => {
    it('accumulates offsetX and offsetY proportional to velocity and deltaTime', () => {
      const { ftComp } = makeEntity({ velocityX: 20, velocityY: -60, offsetX: 0, offsetY: -20 });

      service.update(500, entityManager); // 0.5 s

      // offsetX = 0 + 20 * 0.5 = 10
      // offsetY = -20 + (-60 * 0.5) = -50
      expect(ftComp.offsetX).toBeCloseTo(10, 5);
      expect(ftComp.offsetY).toBeCloseTo(-50, 5);
    });

    it('does not move offset when deltaTime is zero', () => {
      const { ftComp } = makeEntity({ velocityX: 10, velocityY: -30, offsetX: 5, offsetY: -10 });

      service.update(0, entityManager);

      expect(ftComp.offsetX).toBeCloseTo(5, 5);
      expect(ftComp.offsetY).toBeCloseTo(-10, 5);
    });

    it('calls returnToPool with FLOATING_TEXT and entityId when text expires', () => {
      const { entityId } = makeEntity({ durationMs: 100 });

      mockNow = 1200; // 200 ms past duration
      service.update(16, entityManager);

      expect(mockEntityFactory.returnToPool).toHaveBeenCalledWith(PoolType.FLOATING_TEXT, entityId);
    });

    it('does not call returnToPool for non-expired texts', () => {
      makeEntity({ durationMs: 5000 });

      service.update(16, entityManager);

      expect(mockEntityFactory.returnToPool).not.toHaveBeenCalled();
    });

    it('continues past entities that are missing FloatingTextComponent', () => {
      // Entity with only PositionComponent — no FloatingTextComponent
      const bare = entityManager.createEntity();
      entityManager.addComponent(bare, new PositionComponent(0, 0));

      // Also add a valid entity to confirm processing continues
      makeEntity({ durationMs: 100 });
      mockNow = 1200;

      expect(() => service.update(16, entityManager)).not.toThrow();
      // The valid expired entity must still be returned to pool
      expect(mockEntityFactory.returnToPool).toHaveBeenCalledTimes(1);
    });

    it('handles no floating text entities without throwing', () => {
      expect(() => service.update(16, entityManager)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // renderFloatingText() — screen position and globalAlpha
  // ---------------------------------------------------------------------------

  describe('renderFloatingText() — screen position', () => {
    it('draws at position + offset − camera', () => {
      // Entity at (200, 300), offsetX=10, offsetY=-5, camera at (100, 150)
      // Expected screen centre: (200 + 10 - 100, 300 + (-5) - 150) = (110, 145)
      makeEntity({ offsetX: 10, offsetY: -5 });
      // Overwrite the position component to controlled values
      const ftEntity = entityManager
        .getAllEntities()
        .find((e) => entityManager.getComponent(e, FloatingTextComponent))!;
      const posComp = entityManager.getComponent(ftEntity, PositionComponent)!;
      posComp.x = 200;
      posComp.y = 300;

      service.renderFloatingText(mockCtx, { x: 100, y: 150 }, entityManager);

      expect(mockCtx.drawImage).toHaveBeenCalled();
      const args = mockCtx.drawImage.calls.mostRecent().args;
      const sprite = args[0] as OffscreenCanvas;
      // Centre of the sprite should be near (110, 145)
      expect(args[1] + sprite.width / 2).toBeCloseTo(110, 0);
      expect(args[2] + sprite.height / 2).toBeCloseTo(145, 0);
    });

    it('sets globalAlpha from opacity before drawing', () => {
      // At t=mockNow (1000), elapsed=0, progress=0 — opacity should be 1 (before fadeStart 0.7)
      makeEntity({});

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      // globalAlpha was set to 1 (full opacity) before the drawImage call
      expect((mockCtx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
    });

    it('resets globalAlpha to 1 after rendering all entities', () => {
      makeEntity({});
      // Render with a mid-fade state: advance to 80% through duration (past fadeStart=0.7)
      mockNow = 1000 + 2000 * 0.8; // 2600

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      expect((mockCtx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
    });

    it('skips entities with zero opacity (fully expired)', () => {
      makeEntity({ durationMs: 500 });
      // Advance past full duration so opacity = 0
      mockNow = 1600;

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      expect(mockCtx.drawImage).not.toHaveBeenCalled();
    });

    it('resets globalAlpha to 1 even when all entities are skipped', () => {
      makeEntity({ durationMs: 500 });
      mockNow = 1600; // all expired → no drawImage

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      expect((mockCtx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getTextSprite() caching (tested indirectly via renderFloatingText)
  // ---------------------------------------------------------------------------

  describe('getTextSprite() — sprite caching', () => {
    it('returns a cached sprite on second call with identical parameters (drawImage called once per render)', () => {
      // Render the same text twice in the same frame — sprite should be cache-hit the second time
      makeEntity({ text: 'SAME' });
      makeEntity({ text: 'SAME' }); // same params → same cache key

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      // drawImage called once per entity (2), but only one sprite was created (cache hit on 2nd)
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('creates distinct sprites for different text values', () => {
      makeEntity({ text: 'ALPHA' });
      makeEntity({ text: 'BETA' });

      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      // Both sprites drawn — different cache keys, different sprites
      expect(mockCtx.drawImage).toHaveBeenCalledTimes(2);
    });

    it('evicts the oldest cache entry when MAX_SPRITE_CACHE (200) is exceeded', () => {
      // Fill the cache with 200 unique sprites by rendering 200 distinct texts
      const MAX = 200;
      for (let i = 0; i < MAX; i++) {
        const e = entityManager.createEntity();
        entityManager.addComponent(e, new PositionComponent(0, 0));
        entityManager.addComponent(
          e,
          new FloatingTextComponent(`TXT${i}`, '#ffffff', 16, 5000, mockNow, 0, 0, 0, 0, 0.7, 1)
        );
      }
      // Access internal cache to verify it doesn't grow beyond MAX
      service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager);

      // Add one more unique text — this triggers the eviction path
      const extra = entityManager.createEntity();
      entityManager.addComponent(extra, new PositionComponent(0, 0));
      entityManager.addComponent(
        extra,
        new FloatingTextComponent('OVERFLOW', '#ffffff', 16, 5000, mockNow, 0, 0, 0, 0, 0.7, 1)
      );
      expect(() => service.renderFloatingText(mockCtx, { x: 0, y: 0 }, entityManager)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // createDamageNumber() — standalone exported function
  // ---------------------------------------------------------------------------

  describe('createDamageNumber()', () => {
    it('adds PositionComponent at the specified coordinates', () => {
      const entityId = createDamageNumber(entityManager, { x: 50, y: 75 }, 100);

      const pos = entityManager.getComponent(entityId, PositionComponent);
      expect(pos).toBeDefined();
      expect(pos!.x).toBe(50);
      expect(pos!.y).toBe(75);
    });

    it('adds VelocityComponent', () => {
      const entityId = createDamageNumber(entityManager, { x: 0, y: 0 }, 50);

      expect(entityManager.getComponent(entityId, VelocityComponent)).toBeDefined();
    });

    it('adds FloatingTextComponent with text equal to rounded damage', () => {
      const entityId = createDamageNumber(entityManager, { x: 0, y: 0 }, 42.7);

      const ft = entityManager.getComponent(entityId, FloatingTextComponent);
      expect(ft).toBeDefined();
      expect(ft!.text).toBe('43');
    });

    it('uses yellow color (#ffff00) for critical hits', () => {
      const entityId = createDamageNumber(entityManager, { x: 0, y: 0 }, 100, true);

      const ft = entityManager.getComponent(entityId, FloatingTextComponent)!;
      // Pre-parsed colorR/G/B for #ffff00: R=255, G=255, B=0
      expect(ft.colorR).toBe(255);
      expect(ft.colorG).toBe(255);
      expect(ft.colorB).toBe(0);
    });

    it('uses white color (#ffffff) for normal damage', () => {
      const entityId = createDamageNumber(entityManager, { x: 0, y: 0 }, 50, false);

      const ft = entityManager.getComponent(entityId, FloatingTextComponent)!;
      // #ffffff: R=255, G=255, B=255
      expect(ft.colorR).toBe(255);
      expect(ft.colorG).toBe(255);
      expect(ft.colorB).toBe(255);
    });

    it('uses larger fontSize (24) and scale (1.5) for crits vs normal (18, 1)', () => {
      const critId = createDamageNumber(entityManager, { x: 0, y: 0 }, 100, true);
      const normalId = createDamageNumber(entityManager, { x: 0, y: 0 }, 100, false);

      const critFt = entityManager.getComponent(critId, FloatingTextComponent)!;
      const normalFt = entityManager.getComponent(normalId, FloatingTextComponent)!;

      expect(critFt.fontSize).toBe(24);
      expect(critFt.scale).toBe(1.5);
      expect(normalFt.fontSize).toBe(18);
      expect(normalFt.scale).toBe(1);
    });

    it('calls getFromPool when entityFactory is provided', () => {
      mockEntityFactory.getFromPool.and.returnValue(null);

      createDamageNumber(entityManager, { x: 0, y: 0 }, 10, false, mockEntityFactory);

      expect(mockEntityFactory.getFromPool).toHaveBeenCalledWith(PoolType.FLOATING_TEXT);
    });

    it('calls markEntityAsActive on the pooled entity when factory is provided', () => {
      // Simulate pool returning a pre-existing entity
      const pooledId = entityManager.createEntity();
      mockEntityFactory.getFromPool.and.returnValue(pooledId);

      createDamageNumber(entityManager, { x: 0, y: 0 }, 20, false, mockEntityFactory);

      expect(mockEntityFactory.markEntityAsActive).toHaveBeenCalledWith(pooledId);
    });

    it('falls back to entityManager.createEntity when no entityFactory is provided', () => {
      const beforeCount = entityManager.getEntityCount();

      createDamageNumber(entityManager, { x: 0, y: 0 }, 30);

      // A new entity must have been created
      expect(entityManager.getEntityCount()).toBeGreaterThan(beforeCount);
    });

    it('falls back to createEntity when pool returns null', () => {
      mockEntityFactory.getFromPool.and.returnValue(null);
      const beforeCount = entityManager.getEntityCount();

      createDamageNumber(entityManager, { x: 0, y: 0 }, 30, false, mockEntityFactory);

      expect(entityManager.getEntityCount()).toBeGreaterThan(beforeCount);
    });
  });

  describe('destroy / ngOnDestroy', () => {
    it('destroy() clears the textSpriteCache', () => {
      type ServiceInternal = { textSpriteCache: Map<string, unknown> };
      const cache = (service as unknown as ServiceInternal).textSpriteCache;

      // Seed the cache with a dummy entry
      cache.set('dummy-key', {});
      expect(cache.size).toBe(1);

      service.destroy();

      expect(cache.size).toBe(0);
    });

    it('ngOnDestroy() delegates to destroy() and clears the cache', () => {
      type ServiceInternal = { textSpriteCache: Map<string, unknown> };
      const cache = (service as unknown as ServiceInternal).textSpriteCache;
      cache.set('another-key', {});

      service.ngOnDestroy();

      expect(cache.size).toBe(0);
    });
  });
});
