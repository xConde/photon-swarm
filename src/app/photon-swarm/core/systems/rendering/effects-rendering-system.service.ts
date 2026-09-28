import { Injectable } from '@angular/core';
import { EntityManager, System } from '../../ecs/ecs.model';
import { EffectsSystemService } from '../../entities/effects-system.service';

/**
 * Advances particle effects before the main rendering system draws them.
 *
 * Rendering has a single owner: GameRenderingService. Keeping this system update-only
 * prevents a full particle pass from being drawn immediately before the main renderer
 * clears the canvas.
 */
@Injectable({
  providedIn: 'root',
})
export class EffectsRenderingSystemService implements System {
  constructor(private effectsSystem: EffectsSystemService) {}

  /**
   * Initialize the effects rendering system
   */
  init(_entityManager: EntityManager): void {
    // Canvas will be set by rendering system
  }

  /**
   * Advance all active effects. GameRenderingService draws the resulting particles.
   */
  update(deltaTime: number, _entityManager: EntityManager): void {
    this.effectsSystem.update(deltaTime);
  }

  /**
   * Get effect system statistics
   */
  getEffectStats(): {
    activeParticles: number;
    activeEmitters: number;
    activeEffects: number;
  } {
    const stats = this.effectsSystem.getPerformanceStats();
    return {
      activeParticles: stats.activeParticles,
      activeEmitters: stats.activeEmitters,
      activeEffects: stats.activeEffects,
    };
  }

  reset(): void {
    this.effectsSystem.reset();
  }

  /**
   * Cleanup when system is destroyed
   */
  destroy(): void {
    this.reset();
  }
}
