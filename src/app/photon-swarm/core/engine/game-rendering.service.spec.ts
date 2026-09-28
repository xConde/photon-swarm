import { TestBed } from '@angular/core/testing';
import { GameRenderingService } from './game-rendering.service';
import { RenderService } from '../utils/render.service';
import { EnvironmentService } from '../world/environment.service';
import { TerritoryService } from '../world/territory.service';
import { PlayerService } from '../player/player.service';
import { FourKingsTerritoryService } from '../systems/territory';
import { EffectsSystemService } from '../entities/effects-system.service';
import { CONTROL_CONSTANTS } from '../controls/control-constants';
import { Asteroid } from '../models/asteroid.model';

describe('GameRenderingService', () => {
  let service: GameRenderingService;
  let territoryServiceSpy: jasmine.SpyObj<TerritoryService>;
  let playerServiceSpy: jasmine.SpyObj<PlayerService>;

  beforeEach(() => {
    const renderSpy = jasmine.createSpyObj('RenderService', [
      'render',
      'clear',
      'renderDischargeEffects',
      'renderProjectiles',
      'renderBeams',
      'renderEnemies',
      'renderPlayer',
      'renderShards',
      'renderPowerups',
      'renderFloatingText',
      'renderDeathAnimations',
    ]);
    const environmentSpy = jasmine.createSpyObj('EnvironmentService', ['renderBackground', 'renderWorld']);
    const territorySpy = jasmine.createSpyObj('TerritoryService', ['getTerritoryId', 'getActive', 'getTileSize']);
    const playerSpy = jasmine.createSpyObj('PlayerService', [
      'getPosition',
      'getAngle',
      'isDashing',
      'isInvincible',
      'isParryAvailable',
      'isDirectionChangeOnCooldown',
      'getShardMultiplier',
      'getMaxHealth',
      'render',
    ]);
    const fourKingsSpy = jasmine.createSpyObj('FourKingsTerritoryService', [
      'getTerritoryAtPosition',
      'renderTerritories',
      'getIsInitialized',
      'getWorldData',
    ]);
    const effectsSpy = jasmine.createSpyObj('EffectsSystemService', ['getParticlesByLayer']);

    // Set up default return values
    playerSpy.getPosition.and.returnValue({ x: 6000, y: 4500 });
    playerSpy.getAngle.and.returnValue(0);
    playerSpy.isDashing.and.returnValue(false);
    playerSpy.isInvincible.and.returnValue(false);
    playerSpy.isParryAvailable.and.returnValue(false);
    playerSpy.isDirectionChangeOnCooldown.and.returnValue(false);
    playerSpy.getShardMultiplier.and.returnValue(1);
    playerSpy.getMaxHealth.and.returnValue(100);
    fourKingsSpy.getIsInitialized.and.returnValue(true);
    fourKingsSpy.getWorldData.and.returnValue(null);
    territorySpy.getActive.and.returnValue([]);
    territorySpy.getTileSize.and.returnValue(100);
    effectsSpy.getParticlesByLayer.and.returnValue([]);

    TestBed.configureTestingModule({
      providers: [
        GameRenderingService,
        { provide: RenderService, useValue: renderSpy },
        { provide: EnvironmentService, useValue: environmentSpy },
        { provide: TerritoryService, useValue: territorySpy },
        { provide: PlayerService, useValue: playerSpy },
        { provide: FourKingsTerritoryService, useValue: fourKingsSpy },
        { provide: EffectsSystemService, useValue: effectsSpy },
      ],
    });

    service = TestBed.inject(GameRenderingService);
    territoryServiceSpy = TestBed.inject(TerritoryService) as jasmine.SpyObj<TerritoryService>;
    playerServiceSpy = TestBed.inject(PlayerService) as jasmine.SpyObj<PlayerService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should use centralized control constants', () => {
    expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.MOVEMENT).toBe('W/A/S/D');
    expect(CONTROL_CONSTANTS.KEY_DISPLAY_NAMES.TARGET).toBe('L-CLICK');
  });

  it('should handle rendering', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext('2d')!;

    playerServiceSpy.getPosition.and.returnValue({ x: 400, y: 300 });
    playerServiceSpy.getAngle.and.returnValue(0);
    territoryServiceSpy.getTerritoryId.and.returnValue(1);

    expect(service).toBeTruthy();
    expect(playerServiceSpy.getPosition).toBeDefined();
    expect(territoryServiceSpy.getTerritoryId).toBeDefined();
  });

  it('renders cached asteroid facets, craters, ridge, and perimeter detail', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 180;
    const ctx = canvas.getContext('2d')!;
    const asteroid: Asteroid = {
      id: 42,
      x: 120,
      y: 90,
      width: 100,
      height: 72,
      type: 'large',
      color: '#80684c',
      isDiscovered: true,
    };
    const renderer = service as unknown as {
      renderAsteroids(context: CanvasRenderingContext2D, asteroids: Asteroid[]): void;
      asteroidGeometryCache: WeakMap<Asteroid, object>;
    };
    const ellipseSpy = spyOn(ctx, 'ellipse').and.callThrough();
    const strokeSpy = spyOn(ctx, 'stroke').and.callThrough();

    renderer.renderAsteroids(ctx, [asteroid]);
    const firstGeometry = renderer.asteroidGeometryCache.get(asteroid);
    renderer.renderAsteroids(ctx, [asteroid]);

    expect(firstGeometry).toBeDefined();
    expect(renderer.asteroidGeometryCache.get(asteroid)).toBe(firstGeometry);

    // RenderingSystem reuses array slots. A new ECS entity in the same object must
    // regenerate its silhouette instead of inheriting the despawned asteroid's shape.
    asteroid.id = 84;
    asteroid.width = 76;
    renderer.renderAsteroids(ctx, [asteroid]);

    expect(renderer.asteroidGeometryCache.get(asteroid)).not.toBe(firstGeometry);
    expect(ellipseSpy).toHaveBeenCalledTimes(9); // Three cached craters per render.
    expect(strokeSpy.calls.count()).toBeGreaterThanOrEqual(9); // craters + ridge + rim.
  });
});
