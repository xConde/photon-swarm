import { Component } from '../core/ecs/ecs.model';

/**
 * Renderable component - visual representation data
 */
export class RenderableComponent implements Component {
  public color: string;
  public renderLayer: 'background' | 'world' | 'effects' | 'ui';
  public visible: boolean;
  public opacity: number;
  public glowIntensity: number;

  /** Timestamp when entity was created — drives the VISUAL spawn animation (scale + fade) */
  public spawnTime: number;

  /** Timestamp when entity last entered the viewport — drives COMBAT readiness delay */
  public lastViewportEntryTime: number;

  /** Whether the entity is currently in the viewport */
  public wasInViewport: boolean;

  /** Duration of visual spawn animation in ms — keep short to avoid ghost appearance */
  private static readonly SPAWN_ANIM_MS = 250;

  constructor(...args: unknown[]) {
    this.color = args[0] as string;
    this.renderLayer = (args[1] as 'background' | 'world' | 'effects' | 'ui') ?? 'world';
    this.visible = (args[2] as boolean) ?? true;
    this.opacity = (args[3] as number) ?? 1;
    this.glowIntensity = (args[4] as number) ?? 0;
    const now = window.performance.now();
    this.spawnTime = now;
    this.lastViewportEntryTime = now;
    this.wasInViewport = false;
  }

  /** Call when entity enters the viewport. Tracks entry time for combat readiness. */
  markViewportEntry(currentTime: number): void {
    if (!this.wasInViewport) {
      this.lastViewportEntryTime = currentTime;
      this.wasInViewport = true;
    }
  }

  /** Call when entity leaves the viewport */
  markViewportExit(): void {
    this.wasInViewport = false;
  }

  /**
   * VISUAL spawn animation progress: 0→1 over 300ms from ENTITY CREATION only.
   * Used by the renderer for scale-up + fade-in + glow ring.
   * Only plays once — never replays on viewport re-entry.
   */
  getSpawnProgress(currentTime: number): number {
    const elapsed = Math.max(0, currentTime - this.spawnTime);
    return elapsed >= RenderableComponent.SPAWN_ANIM_MS ? 1 : elapsed / RenderableComponent.SPAWN_ANIM_MS;
  }

  /**
   * COMBAT readiness: can this enemy act (fire, take damage, deal contact damage)?
   * Based solely on spawn animation completion (300ms after entity creation).
   * Viewport tracking is separate — used only for visual purposes by the renderer.
   */
  isCombatReady(currentTime: number): boolean {
    return this.getSpawnProgress(currentTime) >= 1;
  }
}
