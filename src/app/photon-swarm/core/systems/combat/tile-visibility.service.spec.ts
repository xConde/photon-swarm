import { TestBed } from '@angular/core/testing';
import { TileVisibilityService } from '../combat/tile-visibility.service';
import { FOUR_KINGS_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';

describe('TileVisibilityService', () => {
  let service: TileVisibilityService;
  const TILE_SIZE = FOUR_KINGS_CONFIG.TILE_SIZE;
  const WORLD_WIDTH = WORLD_CONFIG.BOUNDS.WIDTH;
  const WORLD_HEIGHT = WORLD_CONFIG.BOUNDS.HEIGHT;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TileVisibilityService],
    });
    service = TestBed.inject(TileVisibilityService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  describe('calculatePreloadBounds', () => {
    // Service constants (from tile-visibility.service.ts)
    const MIN_RENDER_BUFFER = 15;
    const VELOCITY_BUFFER_FACTOR = 0.05;
    const DASH_BUFFER = 25;
    const PREDICTION_TIME = 1.5;

    it('should provide sufficient buffer for stationary player', () => {
      const position = { x: 6000, y: 4500 }; // Center of world
      const velocity = { x: 0, y: 0 };
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      const result = service.calculatePreloadBounds(position, velocity, canvasWidth, canvasHeight);

      // Buffer should be MIN_RENDER_BUFFER + DASH_BUFFER = 15 + 25 = 40
      const expectedBuffer = MIN_RENDER_BUFFER + DASH_BUFFER;
      expect(result.metrics.bufferTiles).toBe(expectedBuffer);

      // Radius should be screen half + buffer
      const screenTilesX = Math.ceil(canvasWidth / TILE_SIZE);
      const screenTilesY = Math.ceil(canvasHeight / TILE_SIZE);
      const expectedRadius = Math.max(
        Math.ceil(screenTilesX / 2) + expectedBuffer,
        Math.ceil(screenTilesY / 2) + expectedBuffer
      );
      expect(result.radius).toBe(expectedRadius);
    });

    it('should increase buffer based on velocity', () => {
      const position = { x: 6000, y: 4500 };
      const highVelocity = { x: 500, y: 0 }; // High speed movement
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      const resultHighSpeed = service.calculatePreloadBounds(position, highVelocity, canvasWidth, canvasHeight);
      const resultStationary = service.calculatePreloadBounds(position, { x: 0, y: 0 }, canvasWidth, canvasHeight);

      // High speed should have larger buffer
      expect(resultHighSpeed.radius).toBeGreaterThan(resultStationary.radius);
      expect(resultHighSpeed.metrics.bufferTiles).toBeGreaterThan(resultStationary.metrics.bufferTiles);

      // Velocity buffer should be speed * VELOCITY_BUFFER_FACTOR
      const speed = Math.sqrt(highVelocity.x ** 2 + highVelocity.y ** 2);
      const velocityBuffer = Math.ceil(speed * VELOCITY_BUFFER_FACTOR);
      const expectedBuffer = MIN_RENDER_BUFFER + velocityBuffer + DASH_BUFFER;
      expect(resultHighSpeed.metrics.bufferTiles).toBe(expectedBuffer);
    });

    it('should predict future position based on velocity', () => {
      const position = { x: 6000, y: 4500 };
      const velocity = { x: 100, y: 50 };
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      const result = service.calculatePreloadBounds(position, velocity, canvasWidth, canvasHeight);

      // Should predict PREDICTION_TIME (1.5) seconds ahead
      const expectedPredictedX = position.x + velocity.x * PREDICTION_TIME;
      const expectedPredictedY = position.y + velocity.y * PREDICTION_TIME;

      expect(result.metrics.predictedPosition.x).toBeCloseTo(expectedPredictedX, 1);
      expect(result.metrics.predictedPosition.y).toBeCloseTo(expectedPredictedY, 1);

      // Center tile should be based on predicted position
      const expectedCenterTileX = Math.floor(expectedPredictedX / TILE_SIZE);
      const expectedCenterTileY = Math.floor(expectedPredictedY / TILE_SIZE);

      expect(result.centerTile.x).toBe(expectedCenterTileX);
      expect(result.centerTile.y).toBe(expectedCenterTileY);
    });

    it('should handle dash ability with extra buffer', () => {
      const position = { x: 6000, y: 4500 };
      // Simulate max dash speed (base speed * 5)
      const dashVelocity = { x: 1000, y: 0 };
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      const result = service.calculatePreloadBounds(position, dashVelocity, canvasWidth, canvasHeight);

      // Buffer should include velocity component: MIN + ceil(1000 * 0.05) + DASH = 15 + 50 + 25 = 90
      const speed = Math.sqrt(dashVelocity.x ** 2 + dashVelocity.y ** 2);
      const velocityBuffer = Math.ceil(speed * VELOCITY_BUFFER_FACTOR);
      const expectedBuffer = MIN_RENDER_BUFFER + velocityBuffer + DASH_BUFFER;
      expect(result.metrics.bufferTiles).toBe(expectedBuffer);

      // Radius should be larger than stationary
      expect(result.radius).toBeGreaterThan(MIN_RENDER_BUFFER + DASH_BUFFER);
    });

    it('should clamp bounds to world limits', () => {
      // Test near world edge
      const position = { x: 100, y: 100 }; // Near top-left corner
      const velocity = { x: -100, y: -100 }; // Moving towards corner
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      const result = service.calculatePreloadBounds(position, velocity, canvasWidth, canvasHeight);

      // Bounds should be clamped
      expect(result.bounds.minX).toBe(0);
      expect(result.bounds.minY).toBe(0);
      expect(result.bounds.maxX).toBeLessThanOrEqual(Math.floor(WORLD_WIDTH / TILE_SIZE));
      expect(result.bounds.maxY).toBeLessThanOrEqual(Math.floor(WORLD_HEIGHT / TILE_SIZE));
    });
  });

  describe('validateVisibleTilesLoaded', () => {
    it('should detect missing tiles in visible area', () => {
      const position = { x: 6000, y: 4500 };
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      // Mock tile checker that reports some tiles as missing
      const tileChecker = (x: number, y: number): boolean => {
        // Simulate missing tiles at specific positions
        if (x === 50 && y === 37) return false;
        if (x === 51 && y === 37) return false;
        return true;
      };

      const result = service.validateVisibleTilesLoaded(position, canvasWidth, canvasHeight, tileChecker);

      expect(result.allLoaded).toBe(false);
      expect(result.missingTiles.length).toBe(2);
      expect(result.missingTiles.some((tile) => tile.x === 50 && tile.y === 37)).toBe(true);
      expect(result.missingTiles.some((tile) => tile.x === 51 && tile.y === 37)).toBe(true);
      expect(result.coverage).toBeLessThan(1);
    });

    it('should report full coverage when all tiles loaded', () => {
      const position = { x: 6000, y: 4500 };
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      // All tiles loaded
      const tileChecker = (): boolean => true;

      const result = service.validateVisibleTilesLoaded(position, canvasWidth, canvasHeight, tileChecker);

      expect(result.allLoaded).toBe(true);
      expect(result.missingTiles.length).toBe(0);
      expect(result.coverage).toBe(1);
    });
  });

  describe('Territory generation protection', () => {
    it('should ensure tiles are never visible during generation', () => {
      // Service constant
      const PREDICTION_TIME = 1.5;

      // This test verifies our buffer is large enough to prevent tile pop-in
      const maxPlayerSpeed = 1200; // Max speed with dash
      const position = { x: 6000, y: 4500 };
      const velocity = { x: maxPlayerSpeed, y: 0 };
      const canvasWidth = 1920;
      const canvasHeight = 1080;

      const result = service.calculatePreloadBounds(position, velocity, canvasWidth, canvasHeight);

      // Calculate distance player can travel in one frame
      const frameTime = 1 / 60; // 60 FPS
      const distancePerFrame = maxPlayerSpeed * frameTime;
      const tilesPerFrame = Math.ceil(distancePerFrame / TILE_SIZE);

      // Buffer should be larger than tiles traversed in a few frames to prevent pop-in
      // At 1200 speed, that's 20 pixels/frame = ~0.17 tiles/frame
      // Our buffer is much larger than needed per frame
      expect(result.metrics.bufferTiles).toBeGreaterThan(tilesPerFrame * 10); // 10 frames buffer

      // Verify prediction time gives us enough lead (1.5 seconds at PREDICTION_TIME)
      const predictedDistance = maxPlayerSpeed * PREDICTION_TIME;

      // The predicted position should be ahead based on PREDICTION_TIME
      const distanceAhead = Math.sqrt(
        (result.metrics.predictedPosition.x - position.x) ** 2 + (result.metrics.predictedPosition.y - position.y) ** 2
      );
      expect(distanceAhead).toBeCloseTo(predictedDistance, 0); // Within 1 unit
    });
  });
});
