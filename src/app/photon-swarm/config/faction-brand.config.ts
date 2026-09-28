/**
 * Faction brand colors — a narrow projection of the canonical faction
 * identity for consumers that only need the map-legend territory hex per
 * faction, keyed by numeric faction id.
 *
 * Canonical source: `config/faction-identity.config.ts` (FACTION_IDENTITIES).
 * This file no longer declares its own values — it derives `dark`/`light`
 * from `FACTION_IDENTITIES[id].dark.territory.color` / `.light.territory.color`.
 *
 * SCSS consumers (map.component.scss) still cannot import TS, so they read
 * the `--game-faction-N` custom properties declared in
 * `styles/_design-system.scss` instead of a hand-copied literal. Those
 * tokens are a projection of FACTION_IDENTITIES too, and
 * `npm run check:faction-tokens` (scripts/check-faction-tokens.js) fails the
 * build if the SCSS tokens or a component stylesheet drift from this config.
 *
 * Usage: import { FACTION_BRAND_COLORS } from '../config/faction-brand.config';
 */
import { FACTION_IDENTITIES, KING_FACTION_IDS } from './faction-identity.config';

export const FACTION_BRAND_COLORS: Record<number, { dark: string; light: string }> = Object.fromEntries(
  KING_FACTION_IDS.map((id) => [
    id,
    {
      dark: FACTION_IDENTITIES[id].dark.territory.color,
      light: FACTION_IDENTITIES[id].light.territory.color,
    },
  ])
);
