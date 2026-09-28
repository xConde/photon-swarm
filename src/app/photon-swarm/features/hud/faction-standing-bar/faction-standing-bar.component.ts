import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FactionStanding,
  FactionStandingSystemService,
} from '../../../core/systems/gameplay/faction-standing-system.service';

/**
 * Compact strip of the four faction standings — surfaces the depth
 * campaign's faction system in the HUD. Without this the mechanic
 * worked but was invisible to the player (kills shifted standing,
 * territory effects fired, but nothing on screen told you any of it
 * was happening).
 *
 * Strategy: render the four chips in faction-id order, each showing
 * the king's name, a relationship dot, and the numeric standing. Hide
 * the strip entirely until at least one faction has drifted off zero
 * so it doesn't add noise to the first 30 seconds of a run.
 */
@Component({
  selector: 'app-faction-standing-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './faction-standing-bar.component.html',
  styleUrls: ['./faction-standing-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FactionStandingBarComponent {
  private readonly factionStandingSystem = inject(FactionStandingSystemService);

  /**
   * Live standings as a signal. `toSignal` with `initialValue: []`
   * keeps templates non-nullable and lets the OnPush change detection
   * track the read without a manual subscription.
   */
  readonly standings = toSignal(this.factionStandingSystem.standings$, { initialValue: [] as FactionStanding[] });

  /**
   * True once any faction has drifted off neutral. Hides the strip on
   * a fresh run so the HUD stays uncluttered until the mechanic is
   * actually engaged.
   */
  readonly hasAnyDrift = computed(() => this.standings().some((s) => s.standing !== 0));

  /** Stable track function for the @for loop. */
  trackByFactionId(_index: number, standing: FactionStanding): number {
    return standing.factionId;
  }

  /**
   * Returns the first word of the king's name so chips read cleanly without
   * truncation. "Crimson King" → "Crimson", "Azure King" → "Azure", etc.
   * Falls back to the full name if the name has no space (defensive).
   */
  shortLabel(name: string): string {
    const space = name.indexOf(' ');
    return space > 0 ? name.substring(0, space) : name;
  }

  /**
   * Standing meter geometry. Standing runs -100..+100; the meter is a diverging bar
   * anchored at centre that grows toward the sign (right = allied, left = hostile),
   * so magnitude AND direction read at a glance instead of from a raw number.
   */
  meterFraction(standing: number): number {
    return Math.min(50, Math.abs(standing) / 2);
  }

  meterOffset(standing: number): number {
    return standing >= 0 ? 50 : 50 - this.meterFraction(standing);
  }
}
