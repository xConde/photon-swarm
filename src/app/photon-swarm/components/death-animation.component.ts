import { Component } from '../core/ecs/ecs.model';

export class DeathAnimationComponent implements Component {
  public startTime: number;
  public duration: number;
  public animationType: 'fade' | 'shrink' | 'flash';
  public originalOpacity: number;
  public originalScale: number;
  public isAnimating: boolean;

  constructor(...args: unknown[]) {
    this.duration = (args[0] as number) ?? 500;
    this.animationType = (args[1] as 'fade' | 'shrink' | 'flash') ?? 'fade';
    this.startTime = window.performance.now();
    this.originalOpacity = 1.0;
    this.originalScale = 1.0;
    this.isAnimating = true;
  }

  getProgress(): number {
    const elapsed = window.performance.now() - this.startTime;
    return Math.min(elapsed / this.duration, 1.0);
  }

  isComplete(): boolean {
    return this.getProgress() >= 1.0;
  }

  getCurrentOpacity(): number {
    if (!this.isAnimating) return this.originalOpacity;

    const progress = this.getProgress();

    switch (this.animationType) {
      case 'fade':
        return this.originalOpacity * (1 - progress);
      case 'flash':
        if (progress < 0.2) {
          return Math.min(1.5, this.originalOpacity * (1 + progress * 2));
        } else {
          const fadeProgress = (progress - 0.2) / 0.8;
          return this.originalOpacity * (1 - fadeProgress);
        }
      case 'shrink':
        return this.originalOpacity * (1 - progress * 0.5);
      default:
        return this.originalOpacity * (1 - progress);
    }
  }

  getCurrentScale(): number {
    if (!this.isAnimating) return this.originalScale;

    const progress = this.getProgress();

    switch (this.animationType) {
      case 'shrink':
        return this.originalScale * (1 - progress);
      case 'flash':
        if (progress < 0.2) {
          return this.originalScale * (1 + progress * 0.2);
        } else {
          return this.originalScale;
        }
      default:
        return this.originalScale;
    }
  }
}
