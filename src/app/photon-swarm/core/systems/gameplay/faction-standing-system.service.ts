import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { FactionSnapshot } from '../../models/save-game.model';
import { FACTION_DEFINITIONS } from '@photon/components/faction.component';
import { FourKingsTerritoryService } from '../territory/four-kings-territory.service';

export interface TerritoryEffects {
  damageMultiplier: number;
  defenseMultiplier: number;
  speedMultiplier: number;
}

// Interface the UI component is expecting
export interface FactionStanding {
  factionId: number;
  name: string;
  factionName: string;
  color: string;
  relationship: 'allied' | 'neutral' | 'hostile';
  standing: number;
}

/** Tuning constants for standing-on-kill economics. */
export const FACTION_STANDING_CONFIG = {
  /** How much standing drops when the player kills one of a faction's units. */
  KILL_STANDING_DELTA: -2,
  /** Floor — below this the standing won't degrade further. */
  STANDING_FLOOR: -100,
  /** Ceiling — above this the standing won't grow further. */
  STANDING_CEILING: 100,
  /** Standing at/above this counts the player as allied with the faction. */
  ALLIED_THRESHOLD: 50,
  /** Standing at/below this counts the player as hostile with the faction. */
  HOSTILE_THRESHOLD: -50,
  /**
   * Territory-effect ranges. At max allied (standing = +100) the player
   * gets +15% damage / +15% defense / +5% speed inside the faction's
   * territory; at max hostile (-100) those flip to -15% / -15% / -5%.
   * Linearly interpolated in between.
   */
  TERRITORY_DAMAGE_RANGE: 0.15,
  TERRITORY_DEFENSE_RANGE: 0.15,
  TERRITORY_SPEED_RANGE: 0.05,
} as const;

/**
 * Canonical faction roster, derived directly from FACTION_DEFINITIONS so the
 * standing system, sprite generator, AI behavior tables, and HUD all draw
 * from one source of truth. Adding a fifth king in faction.component.ts
 * propagates here automatically — no parallel edits required.
 */
interface FactionDefinitionShape {
  id: number;
  name: string;
  kingName: string;
  colors: { primary: string };
}

const FACTION_ROSTER: ReadonlyArray<{ id: number; name: string; color: string }> = (
  Object.values(FACTION_DEFINITIONS) as FactionDefinitionShape[]
)
  .map((def) => ({
    id: def.id,
    // Use the short kingName ("Crimson King") rather than the long faction
    // title ("Crimson Legion") to keep HUD lines tight; falls back to the
    // long name if a definition is ever missing kingName.
    name: def.kingName ?? def.name,
    color: def.colors.primary,
  }))
  .sort((a, b) => a.id - b.id);

function relationshipFor(standing: number): FactionStanding['relationship'] {
  if (standing >= FACTION_STANDING_CONFIG.ALLIED_THRESHOLD) return 'allied';
  if (standing <= FACTION_STANDING_CONFIG.HOSTILE_THRESHOLD) return 'hostile';
  return 'neutral';
}

function defaultStandings(): FactionStanding[] {
  return FACTION_ROSTER.map((f) => ({
    factionId: f.id,
    name: f.name,
    factionName: f.name,
    color: f.color,
    standing: 0,
    relationship: 'neutral',
  }));
}

@Injectable({
  providedIn: 'root',
})
export class FactionStandingSystemService {
  private standings = new BehaviorSubject<FactionStanding[]>(defaultStandings());
  public standings$ = this.standings.asObservable();

  constructor(private fourKingsTerritory: FourKingsTerritoryService) {}

  /**
   * Compute the player's combat multipliers at (x, y) based on which
   * faction owns that tile and how the player stands with them. Neutral
   * tiles (factionId === 0) or invalid coordinates return the identity
   * multiplier — historical behavior preserved.
   *
   * Multipliers are linearly interpolated between the
   * `TERRITORY_{X}_RANGE` tuning constants. Allied territory boosts the
   * player; hostile territory penalizes them.
   */
  public getTerritoryEffects(x: number, y: number): TerritoryEffects {
    const tile = this.fourKingsTerritory.getTileAtWorld(x, y);
    // FourKings tiles use `kingId` (1-4); faction-standing uses `factionId`
    // (1-4). They are the same enum — id 1 = Crimson, etc. The two model
    // files are a known duplication tracked as Phase 7 Finding 18.
    if (!tile || tile.kingId <= 0) {
      return { damageMultiplier: 1, defenseMultiplier: 1, speedMultiplier: 1 };
    }

    const standing = this.getStanding(tile.kingId);
    const t = Math.max(-1, Math.min(1, standing / Math.max(FACTION_STANDING_CONFIG.STANDING_CEILING, 1)));

    return {
      damageMultiplier: 1 + t * FACTION_STANDING_CONFIG.TERRITORY_DAMAGE_RANGE,
      defenseMultiplier: 1 + t * FACTION_STANDING_CONFIG.TERRITORY_DEFENSE_RANGE,
      speedMultiplier: 1 + t * FACTION_STANDING_CONFIG.TERRITORY_SPEED_RANGE,
    };
  }

  /**
   * Called when the player kills an enemy belonging to `factionId`. Drops
   * standing with that faction by `KILL_STANDING_DELTA`, clamped to the
   * floor, and re-derives the relationship band.
   *
   * `x`/`y` are accepted for future territory-aware variants (e.g. extra
   * standing loss for kills inside the faction's home territory) and are
   * currently ignored.
   */
  public processKill(_x: number, _y: number, factionId: number): void {
    if (factionId <= 0) return; // Neutral / non-faction kills don't shift standing
    const current = this.standings.getValue();
    let touched = false;
    const next = current.map((s) => {
      if (s.factionId !== factionId) return s;
      touched = true;
      const standing = Math.max(
        FACTION_STANDING_CONFIG.STANDING_FLOOR,
        Math.min(FACTION_STANDING_CONFIG.STANDING_CEILING, s.standing + FACTION_STANDING_CONFIG.KILL_STANDING_DELTA)
      );
      return { ...s, standing, relationship: relationshipFor(standing) };
    });
    if (touched) {
      this.standings.next(next);
    }
  }

  /** Convenience reader for systems that just need the numeric standing. */
  public getStanding(factionId: number): number {
    return this.standings.getValue().find((s) => s.factionId === factionId)?.standing ?? 0;
  }

  public adjustStanding(factionId: number, delta: number): void {
    if (factionId <= 0 || !Number.isFinite(delta) || delta === 0) return;
    const current = this.standings.getValue();
    let touched = false;
    const next = current.map((entry) => {
      if (entry.factionId !== factionId) return entry;
      touched = true;
      const standing = Math.max(
        FACTION_STANDING_CONFIG.STANDING_FLOOR,
        Math.min(FACTION_STANDING_CONFIG.STANDING_CEILING, entry.standing + delta)
      );
      return { ...entry, standing, relationship: relationshipFor(standing) };
    });
    if (touched) this.standings.next(next);
  }

  public reset(): void {
    this.standings.next(defaultStandings());
  }

  public serialize(): FactionSnapshot[] {
    return this.standings.getValue().map((standing) => ({
      factionId: standing.factionId,
      standing: standing.standing,
    }));
  }

  public deserialize(data: FactionSnapshot[] | null | undefined): void {
    if (!data || !Array.isArray(data)) return;
    // Start from the canonical roster so deserialized data inherits names/colors
    // and any missing factions stay at the default zero standing.
    const roster = defaultStandings();
    const byId = new Map(roster.map((s) => [s.factionId, s] as const));
    for (const snapshot of data) {
      if (
        !snapshot ||
        !Number.isInteger(snapshot.factionId) ||
        snapshot.factionId < 1 ||
        snapshot.factionId > 4 ||
        !Number.isFinite(snapshot.standing)
      ) {
        continue;
      }
      const existing = byId.get(snapshot.factionId);
      if (!existing) continue; // Ignore unknown faction ids from older saves
      const standing = Math.max(
        FACTION_STANDING_CONFIG.STANDING_FLOOR,
        Math.min(FACTION_STANDING_CONFIG.STANDING_CEILING, snapshot.standing)
      );
      byId.set(snapshot.factionId, {
        ...existing,
        standing,
        relationship: relationshipFor(standing),
      });
    }
    this.standings.next(Array.from(byId.values()));
  }
}
