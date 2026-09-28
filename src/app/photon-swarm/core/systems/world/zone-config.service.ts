import { Injectable } from '@angular/core';

import { ZONE_CONFIG } from '@photon/config/game-constants';
import { ZoneDefinition, ZoneId } from '../../models/zone.model';

/**
 * ZoneConfigService
 *
 * Provides efficient spatial zone lookups against the 4 static zone
 * definitions. All lookups are O(1) — a pre-computed Map handles ID-based
 * access, and the 4-zone bounds loop is effectively constant time.
 */
@Injectable({ providedIn: 'root' })
export class ZoneConfigService {
  private readonly zones: readonly ZoneDefinition[] = ZONE_CONFIG.ZONES;
  private readonly zoneById: ReadonlyMap<ZoneId, ZoneDefinition>;

  constructor() {
    const map = new Map<ZoneId, ZoneDefinition>();
    for (const zone of this.zones) {
      map.set(zone.id, zone);
    }
    this.zoneById = map;
  }

  /**
   * Return the zone whose axis-aligned bounds contain (x, y).
   * Iterates all 4 zones; returns the first match or null.
   * No Math.sqrt — pure bounds arithmetic.
   */
  getZoneAtPosition(x: number, y: number): ZoneDefinition | null {
    for (const zone of this.zones) {
      const { bounds } = zone;
      if (x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height) {
        return zone;
      }
    }
    return null;
  }

  /** Return the zone with the given ID, or null if not found. */
  getZoneById(id: ZoneId): ZoneDefinition | null {
    return this.zoneById.get(id) ?? null;
  }

  /** Return all zone definitions as a readonly array. */
  getAllZones(): readonly ZoneDefinition[] {
    return this.zones;
  }

  /**
   * Return the player spawn zone (Zone 1 — Nebula Expanse).
   * Guaranteed non-null: ZONE_CONFIG.SPAWN_ZONE_ID is always present.
   */
  getSpawnZone(): ZoneDefinition {
    const zone = this.zoneById.get(ZONE_CONFIG.SPAWN_ZONE_ID);
    if (!zone) {
      throw new Error(`ZoneConfigService: spawn zone ${ZONE_CONFIG.SPAWN_ZONE_ID} not found in ZONE_CONFIG`);
    }
    return zone;
  }
}
