import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MapComponent } from './map.component';
import { FourKingsTerritoryService } from '../../core/systems/territory';
import { PlayerService } from '../../core/player/player.service';
import { EntityManagerService } from '../../core/ecs/entity-manager.service';
import { MapRendererService } from './map-renderer.service';
import { MinimapRendererService } from './minimap-renderer.service';
import { CommonModule } from '@angular/common';
import { ThemeService } from '@services/theme.service';
import { EntityFactoryECSService } from '../../core/entities/entity-factory-ecs.service';

describe('MapComponent', () => {
  let component: MapComponent;
  let fixture: ComponentFixture<MapComponent>;
  let mockFourKingsTerritory: jasmine.SpyObj<FourKingsTerritoryService>;
  let mockPlayerService: jasmine.SpyObj<PlayerService>;
  let mockEntityManager: jasmine.SpyObj<EntityManagerService>;
  let mockMapRenderer: jasmine.SpyObj<MapRendererService>;
  let mockMinimapRenderer: jasmine.SpyObj<MinimapRendererService>;
  let mockThemeService: jasmine.SpyObj<ThemeService>;

  beforeEach(async () => {
    // Create mocks
    mockFourKingsTerritory = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getTerritoryAtPosition',
      'getIsInitialized',
      'getWorldData',
      'getTerritoryGeneration',
    ]);
    mockPlayerService = jasmine.createSpyObj('PlayerService', [
      'getPosition',
      'isDashing',
      'isInvincible',
      'isParryAvailable',
      'isDirectionChangeOnCooldown',
      'getMaxHealth',
    ]);

    // Set default return values
    mockFourKingsTerritory.getIsInitialized.and.returnValue(true);
    mockFourKingsTerritory.getWorldData.and.returnValue(null);
    mockFourKingsTerritory.getTerritoryGeneration.and.returnValue(0);
    mockPlayerService.getPosition.and.returnValue({ x: 6000, y: 4500 });
    mockPlayerService.isDashing.and.returnValue(false);
    mockPlayerService.isInvincible.and.returnValue(false);
    mockPlayerService.isParryAvailable.and.returnValue(false);
    mockPlayerService.isDirectionChangeOnCooldown.and.returnValue(false);
    mockPlayerService.getMaxHealth.and.returnValue(100);
    mockEntityManager = jasmine.createSpyObj('EntityManagerService', [
      'getEntitiesWithComponents',
      'getComponent',
      'hasComponent',
    ]);
    mockEntityManager.getEntitiesWithComponents.and.returnValue([]);
    mockMapRenderer = jasmine.createSpyObj('MapRendererService', ['renderFullMap']);
    mockMinimapRenderer = jasmine.createSpyObj('MinimapRendererService', ['renderMinimap', 'destroy']);
    mockThemeService = jasmine.createSpyObj('ThemeService', [], { isDayMode: false });

    const mockEntityFactory = jasmine.createSpyObj('EntityFactoryECSService', ['isEntityActive']);
    mockEntityFactory.isEntityActive.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [CommonModule, MapComponent],
      providers: [
        { provide: FourKingsTerritoryService, useValue: mockFourKingsTerritory },
        { provide: PlayerService, useValue: mockPlayerService },
        { provide: EntityManagerService, useValue: mockEntityManager },
        { provide: EntityFactoryECSService, useValue: mockEntityFactory },
        { provide: MapRendererService, useValue: mockMapRenderer },
        { provide: MinimapRendererService, useValue: mockMinimapRenderer },
        { provide: ThemeService, useValue: mockThemeService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MapComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initialization', () => {
    it('should start render loop on afterViewInit', () => {
      interface MapComponentWithPrivates {
        startRenderLoop: () => void;
      }
      const startRenderSpy = spyOn(component as unknown as MapComponentWithPrivates, 'startRenderLoop');
      component.ngAfterViewInit();
      expect(startRenderSpy).toHaveBeenCalled();
    });

    it('should setup keyboard shortcuts on afterViewInit', () => {
      interface MapComponentWithPrivates {
        setupKeyboardShortcuts: () => void;
      }
      const setupKeysSpy = spyOn(component as unknown as MapComponentWithPrivates, 'setupKeyboardShortcuts');
      component.ngAfterViewInit();
      expect(setupKeysSpy).toHaveBeenCalled();
    });

    it('should mark as dirty when map becomes visible', () => {
      interface MapComponentWithPrivates {
        isDirty: boolean;
      }
      // Reset dirty state first (component initializes with isDirty = true)
      (component as unknown as MapComponentWithPrivates).isDirty = false;
      component.isVisible = false;
      component.ngOnChanges();
      expect((component as unknown as MapComponentWithPrivates).isDirty).toBeFalsy();

      component.isVisible = true;
      component.ngOnChanges();
      expect((component as unknown as MapComponentWithPrivates).isDirty).toBeTruthy();
    });
  });

  describe('Canvas Initialization', () => {
    it('should initialize map canvas when ViewChild is set', () => {
      interface MapComponentWithPrivates {
        mapCanvas: HTMLCanvasElement | undefined;
        mapCtx: CanvasRenderingContext2D | undefined;
        isDirty: boolean;
      }
      const mockCanvas = document.createElement('canvas');
      const mockContext = {} as CanvasRenderingContext2D;
      spyOn(mockCanvas, 'getContext').and.returnValue(mockContext);

      const mockElementRef = { nativeElement: mockCanvas };
      component.mapCanvasRef = mockElementRef;

      expect((component as unknown as MapComponentWithPrivates).mapCanvas).toBe(mockCanvas);
      expect((component as unknown as MapComponentWithPrivates).mapCtx).toBe(mockContext);
      expect((component as unknown as MapComponentWithPrivates).isDirty).toBeTruthy();
    });

    it('should set canvas dimensions on initialization', () => {
      const mockCanvas = document.createElement('canvas');
      const mockContext = {} as CanvasRenderingContext2D;
      spyOn(mockCanvas, 'getContext').and.returnValue(mockContext);

      const mockElementRef = { nativeElement: mockCanvas };
      component.mapCanvasRef = mockElementRef;

      expect(mockCanvas.width).toBe(480);
      expect(mockCanvas.height).toBe(400);
    });

    it('should initialize minimap canvas when ViewChild is set', () => {
      interface MapComponentWithPrivates {
        minimapCanvas: HTMLCanvasElement | undefined;
        minimapCtx: CanvasRenderingContext2D | undefined;
      }
      const mockCanvas = document.createElement('canvas');
      const mockContext = { imageSmoothingEnabled: true } as CanvasRenderingContext2D;
      spyOn(mockCanvas, 'getContext').and.returnValue(mockContext);

      const mockElementRef = { nativeElement: mockCanvas };
      component.minimapCanvasRef = mockElementRef;

      expect((component as unknown as MapComponentWithPrivates).minimapCanvas).toBe(mockCanvas);
      expect((component as unknown as MapComponentWithPrivates).minimapCtx).toBe(mockContext);
      expect(mockContext.imageSmoothingEnabled).toBeFalsy();
      expect(mockCanvas.width).toBe(200);
      expect(mockCanvas.height).toBe(200);
    });
  });

  describe('Render Loop', () => {
    beforeEach(() => {
      spyOn(window, 'setInterval').and.returnValue(1 as unknown as ReturnType<typeof window.setInterval>);
      spyOn(window.performance, 'now').and.returnValue(600);
    });

    it('should update entity caches periodically', () => {
      interface MapComponentWithPrivates {
        updateEntityCaches: (playerPos: { x: number; y: number }) => void;
        startRenderLoop: () => void;
        lastEntityUpdateTime: number;
      }
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 200 });
      mockEntityManager.getEntitiesWithComponents.and.returnValue([]);

      const updateCachesSpy = spyOn(component as unknown as MapComponentWithPrivates, 'updateEntityCaches');
      (component as unknown as MapComponentWithPrivates).lastEntityUpdateTime = 0;

      const startMethod = (component as unknown as MapComponentWithPrivates).startRenderLoop;
      startMethod.call(component);

      expect(updateCachesSpy).toHaveBeenCalled();
    });

    it('should render minimap when not hidden', () => {
      interface MapComponentWithPrivates {
        minimapCtx: CanvasRenderingContext2D | undefined;
        renderMinimap: () => void;
        startRenderLoop: () => void;
      }
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 200 });
      mockEntityManager.getEntitiesWithComponents.and.returnValue([]);

      const mockCtx = {} as CanvasRenderingContext2D;
      (component as unknown as MapComponentWithPrivates).minimapCtx = mockCtx;
      component.hideForModal = false;

      const renderMinimapSpy = spyOn(component as unknown as MapComponentWithPrivates, 'renderMinimap');

      const startMethod = (component as unknown as MapComponentWithPrivates).startRenderLoop;
      startMethod.call(component);

      expect(renderMinimapSpy).toHaveBeenCalled();
    });

    it('should not render minimap when hidden by modal', () => {
      interface MapComponentWithPrivates {
        minimapCtx: CanvasRenderingContext2D | undefined;
        renderMinimap: () => void;
        startRenderLoop: () => void;
      }
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 200 });

      const mockCtx = {} as CanvasRenderingContext2D;
      (component as unknown as MapComponentWithPrivates).minimapCtx = mockCtx;
      component.hideForModal = true;

      const renderMinimapSpy = spyOn(component as unknown as MapComponentWithPrivates, 'renderMinimap');

      const startMethod = (component as unknown as MapComponentWithPrivates).startRenderLoop;
      startMethod.call(component);

      expect(renderMinimapSpy).not.toHaveBeenCalled();
    });

    it('should render full map only when dirty and visible', () => {
      interface MapComponentWithPrivates {
        mapCtx: CanvasRenderingContext2D | undefined;
        mapCanvas: HTMLCanvasElement | undefined;
        isDirty: boolean;
        renderFullMap: () => void;
        startRenderLoop: () => void;
      }
      mockPlayerService.getPosition.and.returnValue({ x: 100, y: 200 });

      const mockCtx = {} as CanvasRenderingContext2D;
      const mockCanvas = document.createElement('canvas');
      const componentWithPrivates = component as unknown as MapComponentWithPrivates;
      componentWithPrivates.mapCtx = mockCtx;
      componentWithPrivates.mapCanvas = mockCanvas;
      componentWithPrivates.isDirty = true;
      fixture.componentRef.setInput('isVisible', true);
      fixture.componentRef.setInput('hideForModal', false);

      const renderFullMapSpy = spyOn(componentWithPrivates, 'renderFullMap');

      const startMethod = componentWithPrivates.startRenderLoop;
      startMethod.call(component);

      expect(renderFullMapSpy).toHaveBeenCalled();
      expect(componentWithPrivates.isDirty).toBeFalsy();
    });
  });

  describe('Territory Data', () => {
    it('should get territory data for current position', () => {
      interface MapComponentWithPrivates {
        getTerritoryData: (x: number, y: number, radius: number) => Array<{ kingId: number }>;
      }
      mockFourKingsTerritory.getTerritoryAtPosition.and.returnValue({
        kingId: 2,
        kingName: 'Azure',
        strength: 1.0,
      });

      const method = (component as unknown as MapComponentWithPrivates).getTerritoryData;
      const result = method.call(component, 1000, 1000, 1000);

      expect(mockFourKingsTerritory.getTerritoryAtPosition).toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle territories at different positions', () => {
      interface MapComponentWithPrivates {
        getTerritoryData: (x: number, y: number, radius: number) => Array<{ kingId: number }>;
      }
      mockFourKingsTerritory.getTerritoryAtPosition.and.returnValue({
        kingId: 1,
        kingName: 'Crimson',
        strength: 1.0,
      });

      const method = (component as unknown as MapComponentWithPrivates).getTerritoryData;
      const result = method.call(component, 0, 0, 500);

      expect(mockFourKingsTerritory.getTerritoryAtPosition).toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].kingId).toBe(1);
    });
  });

  describe('Entity Caching', () => {
    it('should update enemy cache from ECS', () => {
      interface MapComponentWithPrivates {
        updateEntityCaches: (playerPos: { x: number; y: number }) => void;
        nearbyEnemies: Array<{ x: number; y: number; type: string; threat: string; health: number }>;
      }
      const mockEnemy = 1;
      // Mock getEntitiesWithComponents to return enemies for enemy query, empty for powerups/shards
      let callCount = 0;
      mockEntityManager.getEntitiesWithComponents.and.callFake(() => {
        callCount++;
        // First call is for enemies (EnemyTypeComponent + PositionComponent)
        if (callCount === 1) return [mockEnemy];
        // Subsequent calls (powerups, shards) return empty
        return [];
      });
      // Use component class name strings for matching
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake(
        (_entity: number, componentType: { name: string }) => {
          if (componentType.name === 'PositionComponent') {
            return { x: 100, y: 200 };
          }
          if (componentType.name === 'EnemyTypeComponent') {
            return { type: 'basic' };
          }
          if (componentType.name === 'HealthComponent') {
            return { health: 50 };
          }
          return undefined;
        }
      );

      const updateMethod = (component as unknown as MapComponentWithPrivates).updateEntityCaches;
      updateMethod.call(component, { x: 0, y: 0 });

      expect((component as unknown as MapComponentWithPrivates).nearbyEnemies.length).toBe(1);
      expect((component as unknown as MapComponentWithPrivates).nearbyEnemies[0]).toEqual({
        x: 100,
        y: 200,
        type: 'basic',
        threat: 'normal',
        health: 0.5,
      });
    });

    it('should identify elite enemies', () => {
      interface MapComponentWithPrivates {
        updateEntityCaches: (playerPos: { x: number; y: number }) => void;
        nearbyEnemies: Array<{ threat: string }>;
      }
      const mockEnemy = 1;
      // Mock getEntitiesWithComponents to return enemies for enemy query, empty for powerups/shards
      let callCount = 0;
      mockEntityManager.getEntitiesWithComponents.and.callFake(() => {
        callCount++;
        // First call is for enemies (EnemyTypeComponent + PositionComponent)
        if (callCount === 1) return [mockEnemy];
        // Subsequent calls (powerups, shards) return empty
        return [];
      });
      // Use component class name strings for matching
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake(
        (_entity: number, componentType: { name: string }) => {
          if (componentType.name === 'PositionComponent') {
            return { x: 100, y: 200 };
          }
          if (componentType.name === 'EnemyTypeComponent') {
            return { type: 'Elite_Warrior' };
          }
          return undefined;
        }
      );

      const updateMethod = (component as unknown as MapComponentWithPrivates).updateEntityCaches;
      updateMethod.call(component, { x: 0, y: 0 });

      expect((component as unknown as MapComponentWithPrivates).nearbyEnemies[0].threat).toBe('elite');
    });

    it('should identify boss enemies', () => {
      interface MapComponentWithPrivates {
        updateEntityCaches: (playerPos: { x: number; y: number }) => void;
        nearbyEnemies: Array<{ threat: string }>;
      }
      const mockEnemy = 1;
      // Mock getEntitiesWithComponents to return enemies for enemy query, empty for powerups/shards
      let callCount = 0;
      mockEntityManager.getEntitiesWithComponents.and.callFake(() => {
        callCount++;
        // First call is for enemies (EnemyTypeComponent + PositionComponent)
        if (callCount === 1) return [mockEnemy];
        // Subsequent calls (powerups, shards) return empty
        return [];
      });
      // Use component class name strings for matching
      (mockEntityManager.getComponent as jasmine.Spy).and.callFake(
        (_entity: number, componentType: { name: string }) => {
          if (componentType.name === 'PositionComponent') {
            return { x: 100, y: 200 };
          }
          if (componentType.name === 'EnemyTypeComponent') {
            return { type: 'Shadow_King' };
          }
          return undefined;
        }
      );

      const updateMethod = (component as unknown as MapComponentWithPrivates).updateEntityCaches;
      updateMethod.call(component, { x: 0, y: 0 });

      expect((component as unknown as MapComponentWithPrivates).nearbyEnemies[0].threat).toBe('boss');
    });
  });

  describe('Cleanup', () => {
    it('should clear the map render interval on destroy', () => {
      interface MapComponentWithPrivates {
        renderIntervalId: number | undefined;
      }
      spyOn(window, 'clearInterval');
      (component as unknown as MapComponentWithPrivates).renderIntervalId = 123;

      component.ngOnDestroy();

      expect(window.clearInterval).toHaveBeenCalledWith(123);
    });

    it('should call minimapRenderer.destroy() on destroy to cancel the cacheOpened$ subscription', () => {
      // MinimapRendererService is component-scoped (provided on MapComponent), so the
      // component holds the REAL instance, not the module-level mock. Spy on that.
      const renderer = fixture.debugElement.injector.get(MinimapRendererService);
      const destroySpy = spyOn(renderer, 'destroy');
      component.ngOnDestroy();

      expect(destroySpy).toHaveBeenCalled();
    });

    it('should cleanup event listeners on destroy', () => {
      interface MapComponentWithPrivates {
        keyHandler: () => void;
        wheelHandler: () => void;
      }
      const mockHandler = jasmine.createSpy('handler');
      const componentWithPrivates = component as unknown as MapComponentWithPrivates;
      componentWithPrivates.keyHandler = mockHandler;
      componentWithPrivates.wheelHandler = mockHandler;

      spyOn(window, 'removeEventListener');

      component.ngOnDestroy();

      expect(window.removeEventListener).toHaveBeenCalledWith('keydown', mockHandler);
      expect(window.removeEventListener).toHaveBeenCalledWith('wheel', mockHandler);
    });
  });

  describe('Map Controls', () => {
    it('should emit close event when closeMap is called', () => {
      spyOn(component.close, 'emit');

      component.closeMap();

      expect(component.close.emit).toHaveBeenCalled();
    });

    it('should handle zoom level changes', () => {
      interface MapComponentWithPrivates {
        MAP_CONFIG: { viewRadius: number };
        MINIMAP_CONFIG: { viewRadius: number };
      }
      component.zoomLevel = 1.5;

      expect((component as unknown as MapComponentWithPrivates).MAP_CONFIG.viewRadius).toBeCloseTo(2500 / 1.5);
      expect((component as unknown as MapComponentWithPrivates).MINIMAP_CONFIG.viewRadius).toBeCloseTo(800 / 1.5);
    });
  });

  describe('Dialog semantics (a11y)', () => {
    beforeEach(() => {
      // Prevent a real persistent scheduler during detectChanges.
      spyOn(window, 'setInterval').and.returnValue(1 as unknown as ReturnType<typeof window.setInterval>);
    });

    it('exposes dialog role, aria-modal, and aria-labelledby on the map-modal container', () => {
      fixture.componentRef.setInput('isVisible', true);
      fixture.componentRef.setInput('hideForModal', false);
      fixture.detectChanges();

      const dialog: HTMLElement = fixture.nativeElement.querySelector('.map-modal');
      expect(dialog).toBeTruthy();
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('map-heading');

      const heading: HTMLElement = fixture.nativeElement.querySelector('#map-heading');
      expect(heading).toBeTruthy();
      expect(heading.tagName).toBe('H2');
    });

    it('does not render the dialog when not visible', () => {
      fixture.componentRef.setInput('isVisible', false);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.map-modal')).toBeNull();
    });
  });

  describe('Escape-to-close', () => {
    it('emits close when Escape is pressed while the map is open', () => {
      fixture.componentRef.setInput('isVisible', true);
      fixture.componentRef.setInput('hideForModal', false);
      spyOn(component.close, 'emit');

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(component.close.emit).toHaveBeenCalled();
    });

    it('ignores Escape when the map is not visible', () => {
      component.isVisible = false;
      spyOn(component.close, 'emit');

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(component.close.emit).not.toHaveBeenCalled();
    });

    it('ignores Escape when hidden for another modal', () => {
      component.isVisible = true;
      component.hideForModal = true;
      spyOn(component.close, 'emit');

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(component.close.emit).not.toHaveBeenCalled();
    });

    it('ignores non-Escape keys', () => {
      fixture.componentRef.setInput('isVisible', true);
      fixture.componentRef.setInput('hideForModal', false);
      spyOn(component.close, 'emit');

      component.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(component.close.emit).not.toHaveBeenCalled();
    });
  });

  describe('Dialog focus management', () => {
    it('focuses the map dialog and keeps Tab inside its control-free surface', async () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      component.isVisible = true;
      component.hideForModal = false;
      fixture.detectChanges();
      await Promise.resolve();

      const dialog = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.map-modal');
      expect(document.activeElement).toBe(dialog);

      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(dialog);

      trigger.remove();
    });

    it('restores focus to the map trigger when the dialog closes', async () => {
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();

      component.isVisible = true;
      component.hideForModal = false;
      fixture.detectChanges();
      await Promise.resolve();

      fixture.componentRef.setInput('isVisible', false);
      fixture.detectChanges();

      expect(document.activeElement).toBe(trigger);

      trigger.remove();
    });
  });
});
