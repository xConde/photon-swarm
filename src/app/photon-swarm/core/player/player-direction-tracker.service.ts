// Extracted from PlayerService (Campaign D — god-service decomp). Tracks the player's
// most-recent movement and click directions for aim-assist / re-aim logic.
// Pure state holder — no injected deps.

import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PlayerDirectionTrackerService {
  private lastMovementDirection = { x: 1, y: 0 }; // Default facing right
  private lastClickDirection = { x: 1, y: 0 }; // Default facing right
  private lastDirectionSource: 'movement' | 'click' | 'none' = 'none';
  private lastDirectionUpdateTime = 0;

  /**
   * Record a movement direction input. Normalizes the input vector.
   */
  recordMovementDirection(inputX: number, inputY: number): void {
    const length = Math.sqrt(inputX * inputX + inputY * inputY);
    if (length > 0) {
      this.lastMovementDirection.x = inputX / length;
      this.lastMovementDirection.y = inputY / length;
      this.lastDirectionSource = 'movement';
      this.lastDirectionUpdateTime = window.performance.now();
    }
  }

  /**
   * Record a click/aim direction input. Normalizes the delta vector.
   */
  recordClickDirection(deltaX: number, deltaY: number): void {
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (length > 0) {
      this.lastClickDirection.x = deltaX / length;
      this.lastClickDirection.y = deltaY / length;
      this.lastDirectionSource = 'click';
      this.lastDirectionUpdateTime = window.performance.now();
    }
  }

  /**
   * Get the last known direction for projectile firing.
   * Prioritizes most recent input between movement and click.
   */
  getLastDirection(): { x: number; y: number; source: 'movement' | 'click' | 'none' } {
    return {
      x: this.lastDirectionSource === 'movement' ? this.lastMovementDirection.x : this.lastClickDirection.x,
      y: this.lastDirectionSource === 'movement' ? this.lastMovementDirection.y : this.lastClickDirection.y,
      source: this.lastDirectionSource,
    };
  }

  /**
   * Get specific movement direction (for systems that need to distinguish).
   */
  getLastMovementDirection(): { x: number; y: number } {
    return { ...this.lastMovementDirection };
  }

  /**
   * Get specific click direction (for systems that need to distinguish).
   */
  getLastClickDirection(): { x: number; y: number } {
    return { ...this.lastClickDirection };
  }

  /**
   * Check how recent the last direction input was.
   */
  getTimeSinceLastDirection(): number {
    return window.performance.now() - this.lastDirectionUpdateTime;
  }

  /**
   * Reset tracked directions to initial values (called on player death/respawn).
   */
  reset(): void {
    this.lastMovementDirection = { x: 1, y: 0 };
    this.lastClickDirection = { x: 1, y: 0 };
    this.lastDirectionSource = 'none';
    this.lastDirectionUpdateTime = 0;
  }
}
