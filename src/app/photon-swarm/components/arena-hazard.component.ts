import { Component } from '../core/ecs/ecs.model';
import { BossArchetype } from './boss-phase.component';

/**
 * ArenaHazardComponent — Tracks the state of a telegraphed boss shockwave zone.
 *
 * Lifecycle:
 *   1. Spawned at the boss position on every phase transition.
 *   2. ArenaHazardSystem re-pulses the EMP ring VFX on a cadence (shouldPulseTelegraph)
 *      so the danger circle stays visible for the whole telegraph window.
 *   3. After telegraphMs the zone detonates once (detonated guard prevents re-hit).
 *   4. After telegraphMs + lingerMs the entity self-destructs via isExpired().
 *
 * All timing is self-contained (spawnedAt = Date.now() at construction) so the
 * component needs no external clock injection and the system only needs Date.now().
 */
export class ArenaHazardComponent implements Component {
  /** Hazard circle radius in pixels. */
  public radius: number;

  /** Damage applied once at detonation. */
  public damage: number;

  /** Archetype that spawned this hazard (for telemetry/debug). */
  public archetype: BossArchetype;

  /** Wall-clock ms at construction — anchors all timing math. */
  public spawnedAt: number;

  /** How long the telegraph lasts before detonation (ms). */
  public telegraphMs: number;

  /** How long the entity lingers after detonation before being destroyed (ms). */
  public lingerMs: number;

  /** True once damage has been applied — prevents re-damage on subsequent frames. */
  public detonated: boolean;

  /** Wall-clock ms of the last telegraph ring pulse — drives the re-pulse cadence. */
  public lastTelegraphPulseAt: number;

  constructor(...args: unknown[]) {
    // ECS contract: constructor MUST stay `(...args: unknown[])` — typed params
    // break ComponentType<T>. The ECS factory requires this signature.
    // args[0]=radius, args[1]=damage, args[2]=archetype,
    // args[3]=spawnedAt, args[4]=telegraphMs, args[5]=lingerMs
    this.radius = (args[0] as number) ?? 150;
    this.damage = (args[1] as number) ?? 16;
    this.archetype = (args[2] as BossArchetype) ?? 'standard';
    this.spawnedAt = (args[3] as number) ?? Date.now();
    this.telegraphMs = (args[4] as number) ?? 900;
    this.lingerMs = (args[5] as number) ?? 250;
    this.detonated = false;
    this.lastTelegraphPulseAt = 0;
  }

  /**
   * Red-team Finding 1 fix — the ring VFX is only ~300ms but the telegraph
   * window is 800–1000ms, so a one-shot ring leaves the danger zone invisible
   * at the moment damage lands. Re-pulse the ring on a cadence for the whole
   * telegraph window so the zone reads as "charging → BOOM".
   *
   * True while still in the telegraph window (before detonation) AND at least
   * `cadenceMs` has elapsed since the last pulse.
   */
  shouldPulseTelegraph(now: number, cadenceMs: number): boolean {
    const inTelegraphWindow = now < this.spawnedAt + this.telegraphMs;
    // The first pulse fires immediately because lastTelegraphPulseAt starts at 0
    // (now - 0 is always >= cadenceMs); subsequent pulses gate on the cadence.
    const cadenceElapsed = now - this.lastTelegraphPulseAt >= cadenceMs;
    return inTelegraphWindow && cadenceElapsed;
  }

  /** Record that a telegraph ring just fired at `now`. */
  markTelegraphPulsed(now: number): void {
    this.lastTelegraphPulseAt = now;
  }

  /**
   * True on the first frame after telegraphMs has elapsed AND the hazard has
   * not yet detonated. The system sets detonated=true immediately on handling
   * this frame so subsequent calls return false.
   */
  isDetonationMoment(now: number): boolean {
    return !this.detonated && now >= this.spawnedAt + this.telegraphMs;
  }

  /**
   * True once the full linger window has passed — the system should destroy
   * the entity at this point.
   */
  isExpired(now: number): boolean {
    return now >= this.spawnedAt + this.telegraphMs + this.lingerMs;
  }
}
