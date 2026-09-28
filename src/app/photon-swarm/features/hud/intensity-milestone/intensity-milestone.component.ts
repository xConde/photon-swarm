import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IntensityMilestone, IntensityService, IntensityTier } from '../../../core/systems/combat';
import { PostProcessingService } from '../../../core/effects/post-processing.service';
import { CameraShakeService } from '../../../core/effects/camera-shake.service';

@Component({
  selector: 'app-intensity-milestone',
  standalone: true,
  imports: [],
  template: `
    @if (visible) {
      <div class="milestone-container" [attr.data-tier]="currentTier">
        <div class="milestone-text">{{ milestoneText }}</div>
      </div>
    }
  `,
  styleUrls: ['./intensity-milestone.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntensityMilestoneComponent implements OnInit, OnDestroy {
  private readonly intensity = inject(IntensityService);
  private readonly postProcessing = inject(PostProcessingService);
  private readonly cameraShake = inject(CameraShakeService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly ngZone = inject(NgZone);

  visible = false;
  milestoneText = '';
  currentTier: IntensityTier = 'idle';

  private hideTimeout: number | null = null;

  private readonly MILESTONE_TEXT: Record<IntensityTier, string> = {
    idle: '',
    rising: 'RISING',
    surging: 'SURGING',
    critical: 'CRITICAL MASS · +50% XP',
  };

  private readonly DISPLAY_DURATION = 1500; // 1.5 seconds

  ngOnInit(): void {
    this.intensity
      .getMilestones()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((milestone) => {
        this.showMilestone(milestone);
      });
  }

  ngOnDestroy(): void {
    if (this.hideTimeout !== null) {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private showMilestone(milestone: IntensityMilestone): void {
    // Clear any existing display
    if (this.hideTimeout !== null) {
      window.clearTimeout(this.hideTimeout);
    }

    this.ngZone.run(() => {
      this.currentTier = milestone.tier;
      this.milestoneText = this.MILESTONE_TEXT[milestone.tier];
      this.visible = true;
      this.cdr.detectChanges();

      // Trigger screen effects based on tier
      this.triggerScreenEffects(milestone.tier);

      this.hideTimeout = window.setTimeout(() => {
        this.visible = false;
        this.hideTimeout = null;
        this.cdr.detectChanges();
      }, this.DISPLAY_DURATION);
    });
  }

  private triggerScreenEffects(tier: IntensityTier): void {
    switch (tier) {
      case 'rising':
        this.postProcessing.addScreenFlash({
          color: { r: 0, g: 255, b: 255 },
          opacity: 0.08,
          duration: 200,
        });
        break;
      case 'surging':
        this.postProcessing.addScreenFlash({
          color: { r: 255, g: 200, b: 0 },
          opacity: 0.12,
          duration: 250,
        });
        this.postProcessing.addChromaticAberration({
          intensity: 0.2,
          duration: 200,
          fadeOut: true,
        });
        break;
      case 'critical':
        this.postProcessing.addScreenFlash({
          color: { r: 255, g: 100, b: 255 },
          opacity: 0.15,
          duration: 300,
        });
        this.postProcessing.addChromaticAberration({
          intensity: 0.35,
          duration: 300,
          fadeOut: true,
        });
        this.cameraShake.addShake({
          intensity: 4,
          duration: 200,
          frequency: 15,
          fadeOut: true,
        });
        break;
    }
  }
}
