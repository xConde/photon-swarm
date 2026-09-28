import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  input,
  NgZone,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { PROGRESSION_CONFIG } from '@photon/config/game-constants';
import { ProgressionSystemService } from '../../../core/progression/progression-system.service';

@Component({
  selector: 'app-xp-bar',
  standalone: true,
  imports: [],
  templateUrl: './xp-bar.component.html',
  styleUrls: ['./xp-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class XpBarComponent implements OnInit, OnDestroy {
  private readonly progression = inject(ProgressionSystemService);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly upgradeModalOpen = input(false);

  displayedProgress = 0;
  private targetProgress = 0;
  currentLevel = 1;
  levelUpFlash = false;
  xpGainPulse = false;

  // Level-up hold: stays at 100% from level detection through modal dismiss
  private holdingForLevelUp = false;
  private wasModalOpen = false;

  private animationFrame: number | null = null;
  private pollInterval: number | null = null;
  private levelUpFlashTimeout: number | null = null;
  private xpGainPulseTimeout: number | null = null;
  private initialized = false;

  private readonly LERP_SPEED = 0.2;
  private readonly SNAP_THRESHOLD = 0.5;
  private readonly XP_GAIN_THRESHOLD = 2;

  get levelTier(): 'early' | 'mid' | 'late' | 'max' {
    if (this.currentLevel <= 10) return 'early';
    if (this.currentLevel <= 25) return 'mid';
    if (this.currentLevel <= 40) return 'late';
    return 'max';
  }

  ngOnInit(): void {
    this.ngZone.runOutsideAngular(() => {
      this.pollInterval = window.setInterval(() => this.pollXpState(), 100);
    });
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.pollInterval !== null) {
      window.clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.levelUpFlashTimeout !== null) {
      window.clearTimeout(this.levelUpFlashTimeout);
      this.levelUpFlashTimeout = null;
    }
    if (this.xpGainPulseTimeout !== null) {
      window.clearTimeout(this.xpGainPulseTimeout);
      this.xpGainPulseTimeout = null;
    }
  }

  private pollXpState(): void {
    const level = this.progression.level;
    const xp = this.progression.xp;
    const isMaxLevel = level >= PROGRESSION_CONFIG.MAX_LEVEL;
    const xpRequired = this.progression.getXpForNextLevel();
    const actualProgress = isMaxLevel ? 100 : xpRequired > 0 ? Math.min(100, (xp / xpRequired) * 100) : 0;
    const modalOpen = this.upgradeModalOpen();

    if (!this.initialized) {
      this.displayedProgress = actualProgress;
      this.targetProgress = actualProgress;
      this.currentLevel = level;
      this.initialized = true;
      this.ngZone.run(() => this.cdr.detectChanges());
      return;
    }

    // Game restart detected (level decreased): clear hold state unconditionally
    if (level < this.currentLevel) {
      this.holdingForLevelUp = false;
      this.wasModalOpen = false;
      this.displayedProgress = 0;
      this.targetProgress = actualProgress;
      this.currentLevel = level;
      this.startAnimation();
      return;
    }

    // Level-up detected: enter hold mode at 100%
    if (level > this.currentLevel) {
      this.holdingForLevelUp = true;
      this.wasModalOpen = false;
      this.triggerLevelUpFlash();
    }
    this.currentLevel = level;

    // While holding for level-up: show 100%, wait for modal open→close cycle
    if (this.holdingForLevelUp) {
      this.targetProgress = 100;

      // Release when the upgrade modal has been opened AND then closed
      if (this.wasModalOpen && !modalOpen) {
        this.holdingForLevelUp = false;
        this.displayedProgress = 0;
        this.targetProgress = actualProgress;
      }
      this.wasModalOpen = this.wasModalOpen || modalOpen;
      this.startAnimation();
      return;
    }

    // Normal XP gain
    const xpGain = actualProgress - this.targetProgress;
    if (xpGain > this.XP_GAIN_THRESHOLD) {
      this.triggerXpGainPulse();
    }
    this.targetProgress = actualProgress;
    this.startAnimation();
  }

  private startAnimation(): void {
    if (this.animationFrame === null) {
      this.animationFrame = window.requestAnimationFrame(() => this.animate());
    }
  }

  private triggerLevelUpFlash(): void {
    this.ngZone.run(() => {
      if (this.levelUpFlashTimeout !== null) {
        window.clearTimeout(this.levelUpFlashTimeout);
        this.levelUpFlash = false;
      }
      this.levelUpFlash = true;
      this.cdr.detectChanges();
      this.levelUpFlashTimeout = window.setTimeout(() => {
        this.levelUpFlash = false;
        this.levelUpFlashTimeout = null;
        this.cdr.detectChanges();
      }, 200);
    });
  }

  private triggerXpGainPulse(): void {
    this.ngZone.run(() => {
      if (this.xpGainPulseTimeout !== null) {
        window.clearTimeout(this.xpGainPulseTimeout);
        this.xpGainPulse = false;
      }
      this.xpGainPulse = true;
      this.cdr.detectChanges();
      this.xpGainPulseTimeout = window.setTimeout(() => {
        this.xpGainPulse = false;
        this.xpGainPulseTimeout = null;
        this.cdr.detectChanges();
      }, 300);
    });
  }

  private animate(): void {
    const diff = this.targetProgress - this.displayedProgress;
    if (Math.abs(diff) < this.SNAP_THRESHOLD) {
      this.displayedProgress = this.targetProgress;
      this.animationFrame = null;
      this.cdr.detectChanges();
      return;
    }
    this.displayedProgress += diff * this.LERP_SPEED;
    this.cdr.detectChanges();
    this.animationFrame = window.requestAnimationFrame(() => this.animate());
  }
}
