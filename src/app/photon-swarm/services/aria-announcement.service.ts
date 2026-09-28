import { Injectable, signal } from '@angular/core';
import { GameStats, RunEndReason } from '../core/models/game-state.model';

/**
 * Single-channel screen-reader announcement service for Photon Swarm's
 * run-state events. The canvas is opaque to assistive tech, so high-signal
 * events (level-up, death, zone transitions, boss spawn) are mirrored into
 * a polite aria-live region rendered by `photon-swarm.component.html`.
 *
 * Why a service instead of inline component state: multiple subscriptions
 * (progression / game state / spawn system) need to push announcements
 * into the same channel, and the SR-replay semantics (clearing the live
 * region before re-asserting identical text) deserve a single home.
 *
 * Why a signal: the live-region template binding is a plain `{{ expr }}`
 * interpolation, so Angular's reactivity picks the value up without an
 * explicit subscription.
 */
@Injectable({ providedIn: 'root' })
export class AriaAnnouncementService {
  private readonly _message = signal('');

  /**
   * Monotonic token incremented on every announce / clear so the
   * deferred microtask in `announce()` can detect that a newer
   * announcement (or a clear) has superseded it. Without this guard
   * `announce('foo'); clear()` loses the clear: the foo microtask
   * runs after the synchronous '' write and restores 'foo'. Same
   * pattern used in QuoteWeave race protection.
   */
  private pendingToken = 0;

  /** Public read-only handle for templates and tests. */
  readonly message = this._message.asReadonly();

  /**
   * Push an announcement into the live region. If the same text is
   * announced twice in a row, screen-readers treat it as a no-op — so
   * we briefly write an empty string before the new value to force a
   * re-announcement.
   */
  announce(text: string): void {
    const myToken = ++this.pendingToken;
    if (!text) {
      this._message.set('');
      return;
    }
    if (this._message() === text) {
      this._message.set('');
    }
    // Microtask so the empty value flushes before the new one lands;
    // synchronous would coalesce into a single render pass and SRs would
    // never see the in-between empty state. The token guard makes the
    // deferred write a no-op if anything else has happened in the
    // meantime (Finding A1 — clear-was-silently-overridden bug).
    queueMicrotask(() => {
      if (this.pendingToken !== myToken) return;
      this._message.set(text);
    });
  }

  /** Clear the live region. Used between runs / on reset. */
  clear(): void {
    this.pendingToken++; // Invalidate any in-flight microtasks
    this._message.set('');
  }

  /**
   * Convenience formatter + announce for a player level-up event.
   * Mirrors the gold-flash visual ceremony in photon-swarm.component for
   * SR users.
   */
  announceLevelUp(newLevel: number): void {
    this.announce(`Level up. Now at level ${newLevel}.`);
  }

  /**
   * Convenience formatter + announce for a zone-boundary cross. Reads the
   * human zone name from the caller (the component is closer to
   * ZoneConfigService than the service should be).
   */
  announceZoneEntry(zoneName: string): void {
    if (!zoneName) return;
    this.announce(`Now entering ${zoneName}.`);
  }

  /**
   * Convenience formatter + announce for a run-end. Branches on
   * `stats.endReason` to match the end-screen variant added in the depth
   * campaign's Sprint 24 — death / victory / quit each get distinct copy.
   */
  announceRunEnd(stats: GameStats): void {
    this.announce(formatRunEndCopy(stats));
  }
}

/** Pure formatter exported separately so specs can pin the copy directly. */
export function formatRunEndCopy(stats: GameStats): string {
  const reason: RunEndReason = stats.endReason ?? 'death';
  const level = stats.level ?? 1;
  const kills = stats.kills ?? 0;
  if (reason === 'victory') {
    return `Run complete. You cleared the Deep Core at level ${level} with ${kills} kills.`;
  }
  if (reason === 'quit') {
    return `Run abandoned at level ${level} with ${kills} kills.`;
  }
  return `Ship destroyed. Run ended at level ${level} with ${kills} kills.`;
}
