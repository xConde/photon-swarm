import { Injectable, OnDestroy } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { GameEngineService } from '../../engine/game-engine.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PoolType } from '@photon/config/game-constants';
import { FloatingTextComponent, PositionComponent, VelocityComponent } from '@photon/components';
import { ThemeService } from '@services/theme.service';
import { createSpriteCanvas, SpriteCanvas } from '../../utils/canvas-factory';

/**
 * System that handles floating text effects (damage numbers, etc)
 */
@Injectable({
  providedIn: 'root',
})
export class FloatingTextSystemService implements System, OnDestroy {
  // Pre-rendered text sprite cache: key = "text|fontSize|scale|r|g|b|isDayMode"
  private textSpriteCache = new Map<string, SpriteCanvas>();
  private static readonly MAX_SPRITE_CACHE = 200;
  // Shared measure canvas — reused across cache misses instead of allocating per call
  private measureCanvas = createSpriteCanvas(1, 1);
  private measureCtx = this.measureCanvas.getContext('2d') as CanvasRenderingContext2D | null;

  constructor(
    private gameEngine: GameEngineService,
    private entityFactory: EntityFactoryECSService,
    private themeService: ThemeService
  ) {}

  /**
   * Get or create a cached OffscreenCanvas sprite for a text string.
   * Renders text once with outline, then reuses the sprite via drawImage (10-50x faster).
   */
  private getTextSprite(
    text: string,
    fontSize: number,
    scale: number,
    colorR: number,
    colorG: number,
    colorB: number,
    isDayMode: boolean
  ): SpriteCanvas {
    const key = `${text}|${fontSize}|${scale}|${colorR}|${colorG}|${colorB}|${isDayMode ? 1 : 0}`;
    let sprite = this.textSpriteCache.get(key);
    if (sprite) return sprite;

    // Evict if cache is full
    if (this.textSpriteCache.size >= FloatingTextSystemService.MAX_SPRITE_CACHE) {
      // Delete oldest entry (first key in Map iteration order)
      const firstKey = this.textSpriteCache.keys().next().value;
      if (firstKey !== undefined) this.textSpriteCache.delete(firstKey);
    }

    // Measure text to size the canvas
    const font = `bold ${fontSize * scale}px Arial`;
    const lineWidth = isDayMode ? 4 : 3;
    const padding = lineWidth + 2;

    // Use the shared measure canvas to measure text width
    const measureCtx = this.measureCtx;
    if (!measureCtx) return createSpriteCanvas(1, 1);
    measureCtx.font = font;
    const metrics = measureCtx.measureText(text);
    const textWidth = Math.ceil(metrics.width) + padding * 2;
    const textHeight = Math.ceil(fontSize * scale) + padding * 2;

    // Create the sprite canvas
    sprite = createSpriteCanvas(textWidth, textHeight);
    const ctx = sprite.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return sprite;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const cx = textWidth / 2;
    const cy = textHeight / 2;

    // Draw outline
    ctx.strokeStyle = isDayMode ? 'rgba(51, 65, 85, 0.8)' : 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = lineWidth;
    ctx.strokeText(text, cx, cy);

    // Draw fill
    ctx.fillStyle = `rgb(${colorR}, ${colorG}, ${colorB})`;
    ctx.fillText(text, cx, cy);

    this.textSpriteCache.set(key, sprite);
    return sprite;
  }

  update(deltaTime: number, entityManager: EntityManagerService): void {
    const currentTime = window.performance.now();
    const ctx = this.gameEngine.getContext();
    if (!ctx) return;

    // Get all entities with floating text
    const floatingTextEntities = entityManager.getEntitiesWithComponents(FloatingTextComponent, PositionComponent);

    // Process each floating text
    const entitiesToRemove: number[] = [];

    for (const entityId of floatingTextEntities) {
      const floatingText = entityManager.getComponent(entityId, FloatingTextComponent);
      const position = entityManager.getComponent(entityId, PositionComponent);

      if (!floatingText || !position) continue;

      // Check if expired
      if (floatingText.isExpired(currentTime)) {
        entitiesToRemove.push(entityId);
        continue;
      }

      // Update position based on velocity
      const deltaSeconds = deltaTime / 1000;
      floatingText.offsetX += floatingText.velocityX * deltaSeconds;
      floatingText.offsetY += floatingText.velocityY * deltaSeconds;

      // Update the actual position
      const velocity = entityManager.getComponent(entityId, VelocityComponent);
      if (velocity) {
        velocity.vx = floatingText.velocityX;
        velocity.vy = floatingText.velocityY;
      }
    }

    // Remove expired texts
    for (const entityId of entitiesToRemove) {
      // Return to pool instead of destroying
      this.entityFactory.returnToPool(PoolType.FLOATING_TEXT, entityId);
    }
  }

  /**
   * Render floating text (should be called from rendering system)
   */
  renderFloatingText(
    ctx: CanvasRenderingContext2D,
    camera: { x: number; y: number },
    entityManager: EntityManagerService
  ): void {
    const currentTime = window.performance.now();

    // Get all entities with floating text
    const floatingTextEntities = entityManager.getEntitiesWithComponents(FloatingTextComponent, PositionComponent);

    const isDayMode = this.themeService.isDayMode;

    for (const entityId of floatingTextEntities) {
      const floatingText = entityManager.getComponent(entityId, FloatingTextComponent);
      const position = entityManager.getComponent(entityId, PositionComponent);

      if (!floatingText || !position) continue;

      // Calculate screen position
      const screenX = position.x + floatingText.offsetX - camera.x;
      const screenY = position.y + floatingText.offsetY - camera.y;

      // Get opacity
      const opacity = floatingText.getOpacity(currentTime);
      if (opacity <= 0) continue;

      // Get cached sprite (pre-rendered text with outline)
      const sprite = this.getTextSprite(
        floatingText.text,
        floatingText.fontSize,
        floatingText.scale,
        floatingText.colorR,
        floatingText.colorG,
        floatingText.colorB,
        isDayMode
      );

      // Draw sprite with opacity via globalAlpha (drawImage is 10-50x faster than fillText+strokeText)
      ctx.globalAlpha = opacity;
      ctx.drawImage(sprite, screenX - sprite.width / 2, screenY - sprite.height / 2);
    }

    ctx.globalAlpha = 1;
  }

  /** Release all pre-rendered text sprite canvases. Called on route navigation / game reset. */
  destroy(): void {
    this.textSpriteCache.clear();
  }

  ngOnDestroy(): void {
    this.destroy();
  }
}

/**
 * Create a damage number entity
 */
export function createDamageNumber(
  entityManager: EntityManagerService,
  position: { x: number; y: number },
  damage: number,
  isCritical: boolean = false,
  entityFactory?: EntityFactoryECSService
): number {
  // Use factory if provided, otherwise create new entity
  const entity = entityFactory
    ? (entityFactory.getFromPool(PoolType.FLOATING_TEXT) ?? entityManager.createEntity())
    : entityManager.createEntity();

  // Mark as active if using factory
  if (entityFactory && entity !== null) {
    entityFactory.markEntityAsActive(entity);
  }

  // Add position
  entityManager.addComponent(entity, new PositionComponent(position.x, position.y));

  // Add velocity for physics (optional)
  entityManager.addComponent(entity, new VelocityComponent(0, 0));

  // Create floating text
  const text = Math.round(damage).toString();
  const color = isCritical ? '#ffff00' : '#ffffff'; // Yellow for crits, white for normal
  const fontSize = isCritical ? 24 : 18;
  const scale = isCritical ? 1.5 : 1;

  // Add random horizontal offset for multiple hits
  const offsetX = (Math.random() - 0.5) * 30;
  const velocityX = (Math.random() - 0.5) * 20;

  entityManager.addComponent(
    entity,
    new FloatingTextComponent(
      text,
      color,
      fontSize,
      700, // 0.7 second duration — shorter to reduce on-screen number clutter
      window.performance.now(),
      offsetX,
      -20, // Start above entity
      velocityX,
      -80, // Float upward faster
      0.6, // Start fading at 60%
      scale
    )
  );

  return entity;
}
