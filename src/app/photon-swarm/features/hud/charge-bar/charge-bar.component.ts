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
import { UIQuerySystemService } from '../../../core/systems/gameplay';

/**
 * ChargeBarComponent — full-width, 5px bottom-edge bar showing discharge ability readiness.
 *
 * THREE-STATE model:
 *   empty    (0%)    — just used discharge, 8s cooldown starts
 *   filling  (0→100%) — cooldown recovering over 8 seconds
 *   ready    (100%)  — discharge available, bar is full and subtle
 *
 * FOURTH transient state (while holding right-click to charge the discharge):
 *   charging (0→100%) — bar shows build-up level while player holds right-click
 *
 * Data source: stats.dischargeCooldownPercent / stats.isChargingDischarge /
 * stats.dischargeChargeLevel from UIQuerySystemService, sourced directly from
 * PlayerService discharge state — no inference or guesswork.
 *
 * INVERTED opacity: when ready (>=95%), bar fades to subtle (opacity 0.3).
 * While cooldown is in progress, bar is fully visible — urgency cue.
 *
 * PERFORMANCE: Polls UIQuerySystemService.getPlayerStats() on a 100ms interval outside
 * Angular zone. RAF-driven lerp for smooth fill animation.
 *
 * Sprint 4 visual effects retained: full-charge pulse, discharge drain flash, overcharge shimmer.
 */
@Component({
  selector: 'app-charge-bar',
  standalone: true,
  imports: [],
  templateUrl: './charge-bar.component.html',
  styleUrls: ['./charge-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChargeBarComponent implements OnInit, OnDestroy {
  private readonly uiQuery = inject(UIQuerySystemService);
  private readonly ngZone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  // Displayed (animated) charge 0–100 — starts full (player is ready to fire initially)
  displayedCharge = 100;

  // True while player is holding right-click to charge the discharge ability
  isHoldingCharge = false;

  // Target charge for lerp (0–100)
  private targetCharge = 100;

  // Which charge bucket is active — drives color switching via data-charge-type attribute.
  // For the discharge bar: 'charging' while holding right-click, 'cooldown' otherwise.
  activeChargeType: 'charging' | 'cooldown' = 'cooldown';

  // True when bar is charged (>=95%) — bar becomes subtle, no distraction
  isFullCharge = true;

  // Sprint 4: full-charge ready pulse — fires once when isFullCharge flips true
  chargeFullPulse = false;

  // Sprint 4: fire drain flash — fires on fire event detection
  fireDrain = false;

  private animationFrame: number | null = null;
  private pollInterval: number | null = null;
  private initialized = false;

  // Timeout handles for cleanup
  private chargeFullPulseTimeout: number | null = null;
  private fireDrainTimeout: number | null = null;

  private readonly LERP_SPEED = 0.15; // Slightly faster for responsive cooldown feel
  private readonly SNAP_THRESHOLD = 1.0; // percent
  private readonly FULL_CHARGE_THRESHOLD = 95; // percent

  ngOnInit(): void {
    // Self-sufficient polling — no dependency on HUD calling startPolling()
    this.ngZone.runOutsideAngular(() => {
      this.pollInterval = window.setInterval(() => {
        this.pollChargeState();
      }, 100);
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
    if (this.chargeFullPulseTimeout !== null) {
      window.clearTimeout(this.chargeFullPulseTimeout);
      this.chargeFullPulseTimeout = null;
    }
    if (this.fireDrainTimeout !== null) {
      window.clearTimeout(this.fireDrainTimeout);
      this.fireDrainTimeout = null;
    }
  }

  private pollChargeState(): void {
    const stats = this.uiQuery.getPlayerStats();
    if (!stats) return;

    // Track holding state for template
    const wasHolding = this.isHoldingCharge;
    this.isHoldingCharge = stats.isChargingDischarge;

    // Bar shows READINESS, not charge level.
    // While holding right-click: stay at 100% — the ability hasn't been used yet.
    // After release (cooldown starts): show cooldown recovery 0→100%.
    const newTarget = stats.isChargingDischarge ? 100 : stats.dischargeCooldownPercent;

    const newChargeType: 'charging' | 'cooldown' = stats.isChargingDischarge ? 'charging' : 'cooldown';

    if (!this.initialized) {
      this.displayedCharge = 100; // Start full (discharge available at game start)
      this.targetCharge = newTarget;
      this.activeChargeType = newChargeType;
      this.isFullCharge = newTarget >= this.FULL_CHARGE_THRESHOLD;
      this.initialized = true;
      this.startAnimation();
      return;
    }

    const newIsFullCharge = newTarget >= this.FULL_CHARGE_THRESHOLD;
    const fullChargeChanged = newIsFullCharge !== this.isFullCharge;
    const chargeTypeChanged = newChargeType !== this.activeChargeType;

    // Detect discharge-used event: target drops significantly from previous.
    // Only detect on release transition (wasHolding → not holding) to prevent false triggers.
    const dischargeUsed = !stats.isChargingDischarge && wasHolding && newTarget < 50;

    // Sprint 4: drain flash when discharge is used
    if (dischargeUsed && !this.fireDrain) {
      this.fireDrain = true;
      if (this.fireDrainTimeout !== null) window.clearTimeout(this.fireDrainTimeout);
      this.fireDrainTimeout = window.setTimeout(() => {
        this.fireDrain = false;
        this.fireDrainTimeout = null;
        this.ngZone.run(() => this.cdr.detectChanges());
      }, 200);
      this.ngZone.run(() => this.cdr.detectChanges());
    }

    // Sprint 4: full-charge pulse on rising edge (discharge ready)
    const fullChargePulseTriggered = fullChargeChanged && newIsFullCharge;

    this.targetCharge = newTarget;
    this.activeChargeType = newChargeType;
    this.isFullCharge = newIsFullCharge;

    let needsZoneRun = chargeTypeChanged || fullChargeChanged;

    if (fullChargePulseTriggered && !this.chargeFullPulse) {
      this.chargeFullPulse = true;
      needsZoneRun = true;
      if (this.chargeFullPulseTimeout !== null) window.clearTimeout(this.chargeFullPulseTimeout);
      this.chargeFullPulseTimeout = window.setTimeout(() => {
        this.chargeFullPulse = false;
        this.chargeFullPulseTimeout = null;
        this.ngZone.run(() => this.cdr.detectChanges());
      }, 400);
    }

    if (needsZoneRun) {
      this.ngZone.run(() => this.cdr.detectChanges());
    }

    this.startAnimation();
  }

  private startAnimation(): void {
    if (this.animationFrame === null) {
      this.animationFrame = window.requestAnimationFrame(() => this.animate());
    }
  }

  private animate(): void {
    const diff = this.targetCharge - this.displayedCharge;

    if (Math.abs(diff) < this.SNAP_THRESHOLD) {
      this.displayedCharge = this.targetCharge;
      this.animationFrame = null;
      // CRITICAL: OnPush — detectChanges() for RAF updates outside zone
      this.cdr.detectChanges();
      return;
    }

    this.displayedCharge += diff * this.LERP_SPEED;
    this.cdr.detectChanges();

    this.animationFrame = window.requestAnimationFrame(() => this.animate());
  }
}
