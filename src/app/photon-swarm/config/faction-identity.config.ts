/**
 * Canonical faction identity — the single source of truth for every
 * faction's name, king name, and colors across the whole game.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Faction identity used to be redeclared in seven places that had drifted
 * apart: `FACTION_COLORS`/`FACTION_COLORS_LIGHT` and `FOUR_KINGS_CONFIG.KINGS`
 * (game-constants), `FACTION_BRAND_COLORS` (faction-brand.config),
 * `FACTION_DEFINITIONS` (faction.component), `TERRITORY_FACTIONS`
 * (territory-tile.model), plus literal tables inside `features/map/`.
 * Faction 4 had ended up with four different names ("Golden Horde",
 * "Shadow faction", "Shadow King", "Shadow Syndicate", "Shadow Dominion")
 * across two unrelated hue families (gold and purple) — gold enemy sprites
 * and a gold "GOLDEN HORDE INVASION" banner next to a purple kill-feed
 * pulse and a purple map legend.
 *
 * Every one of those tables is now derived from this file. Add a faction or
 * change a color here and it propagates everywhere; there is nowhere else to
 * edit.
 *
 * TWO PALETTES, ON PURPOSE
 * ------------------------
 * Factions legitimately render on two very different surfaces, so each
 * faction declares two palettes rather than one compromise color:
 *
 *  - `sprite` — saturated neon, drawn on the near-black combat canvas
 *    (enemy hulls, spawn portals, aggro glow, invasion banner).
 *  - `territory` — desaturated, drawn as large low-opacity fills on the
 *    map and minimap, where neon would vibrate and bury the labels.
 *
 * This split already existed implicitly (`#ff0044` sprite vs `#e74c3c`
 * territory for faction 1); it is now declared instead of duplicated.
 *
 * COLOR CHOICES ARE ACCESSIBILITY-CONSTRAINED
 * -------------------------------------------
 * The palette was checked with CIEDE2000 under Machado (2009) CVD
 * simulation at severity 1.0 for protanopia, deuteranopia and tritanopia.
 * Two results drove the values below and should not be "tidied" away:
 *
 *  1. Faction 4 is purple, not gold. Gold sat at dE 9.9 from faction 3's
 *     green under protanopia — the worst pair in the old palette. Purple
 *     raises the palette's worst faction-4 pair to dE 16.3.
 *  2. Faction 4's purple is deliberately the muted `#8e44ad`, NOT a neon
 *     violet matching the other sprite primaries' saturation. Neon violets
 *     collapse onto faction 2's azure under deuteranopia: `#b026ff` scores
 *     dE 7.1, `#a855f7` scores 4.3, `#cc44ff` scores 0.5 — indistinguishable.
 *     `#8e44ad` is the most saturated purple that stays separable from azure.
 *  3. The LIGHT palette was checked the same way, not assumed to follow. Its
 *     faction-4 value `#6b2e8e` scores a worst pair of dE 19.4 (vs faction 2
 *     azure under deuteranopia), against dE 10.7 for the gold `#ca8a04` it
 *     replaces (vs faction 1 crimson under deuteranopia). Tailwind purple-600
 *     `#9333ea` was rejected at 11.7 despite matching the light palette's
 *     600-family convention — convention lost to separability.
 *
 * Pre-existing and out of scope, recorded so it is not mistaken for a
 * regression introduced here: faction 2 vs faction 3 collide under tritanopia
 * (light dE 5.3, territory-light dE 7.7) and faction 1 vs faction 3 under
 * deuteranopia (territory-dark dE 8.3). Neither involves faction 4.
 *
 * Re-run the check before changing any value here.
 *
 * NOT YET COVERED: `config/colorblind-palette.ts` remaps only the CANVAS and
 * MINIMAP slots, so enabling the Colorblind Palette setting currently does
 * nothing for faction identification. Wiring faction slots into that override
 * map is a follow-up; the shape here is ready for it.
 */

/** A faction's colors on the combat canvas — saturated, near-black backdrop. */
export interface FactionSpritePalette {
  readonly primary: string;
  readonly secondary: string;
  readonly glow: string;
  readonly outline: string;
}

/** A faction's colors on the map/minimap — desaturated, large area fills. */
export interface FactionTerritoryPalette {
  readonly color: string;
  readonly baseColor: string;
  readonly glowColor: string;
}

/**
 * Five shades used to texture territory tiles, ordered brightest-to-darkest
 * intent: [primary, deep, bright, dark, weathered].
 *
 * `TerritoryColorService` indexes into this by tile strength, border state and
 * tile age, so the ramp needs more steps than the 3-slot `territory` palette
 * above and its middle/dark steps are hand-tuned rather than derived — the dark
 * ramps carry deliberate corrections (e.g. faction 1's fourth step was moved off
 * a brown-casting red). Do not "simplify" these into computed shades of
 * `territory.color`; that would undo the tuning.
 */
export type FactionTerritoryRamp = readonly [string, string, string, string, string];

export interface FactionThemeColors {
  readonly sprite: FactionSpritePalette;
  readonly territory: FactionTerritoryPalette;
  readonly territoryRamp: FactionTerritoryRamp;
}

export interface FactionIdentity {
  readonly id: number;
  /** Faction name shown in UI: wave banners, kill feed, standing bar. */
  readonly name: string;
  /** The faction's ruling king, shown in territory and standing UI. */
  readonly kingName: string;
  readonly dark: FactionThemeColors;
  readonly light: FactionThemeColors;
}

/**
 * Faction identity is keyed by numeric id everywhere in the codebase
 * (object keys, `kings[id - 1]` indexing, `switch (factionId)` arms).
 * 0 is Neutral/unaligned and has no king.
 */
export type FactionId = 0 | 1 | 2 | 3 | 4;

export const FACTION_IDENTITIES: Readonly<Record<FactionId, FactionIdentity>> = {
  0: {
    id: 0,
    name: 'Neutral',
    kingName: 'Unaligned',
    dark: {
      sprite: { primary: '#999999', secondary: '#777777', glow: '#bbbbbb', outline: '#333333' },
      territory: { color: '#999999', baseColor: '#777777', glowColor: '#bbbbbb' },
      // Neutral holds no territory, so TerritoryColorService never reads this ramp
      // (it falls back to its own default for ids outside 1-4). Declared to keep
      // the shape uniform across factions.
      territoryRamp: ['#999999', '#777777', '#bbbbbb', '#555555', '#333333'],
    },
    light: {
      sprite: { primary: '#94a3b8', secondary: '#64748b', glow: '#cbd5e1', outline: '#475569' },
      territory: { color: '#94a3b8', baseColor: '#64748b', glowColor: '#cbd5e1' },
      territoryRamp: ['#94a3b8', '#64748b', '#cbd5e1', '#475569', '#334155'],
    },
  },
  1: {
    id: 1,
    name: 'Crimson Legion',
    kingName: 'Crimson King',
    dark: {
      sprite: { primary: '#ff0044', secondary: '#ff3366', glow: '#ff66aa', outline: '#880022' },
      territory: { color: '#e74c3c', baseColor: '#c0392b', glowColor: '#ff6b6b' },
      // Steps 4-5 are hand-corrected: #6b1f1f replaced a brown-casting #a93226,
      // and #3a0f0f replaced #8b1a1a for weathered/road tiles.
      territoryRamp: ['#e74c3c', '#c0392b', '#dc3545', '#6b1f1f', '#3a0f0f'],
    },
    light: {
      sprite: { primary: '#dc2626', secondary: '#b91c1c', glow: '#f87171', outline: '#7f1d1d' },
      territory: { color: '#b52020', baseColor: '#8f1919', glowColor: '#e06666' },
      // Red-600/700/500/800/900.
      territoryRamp: ['#dc2626', '#b91c1c', '#ef4444', '#991b1b', '#7f1d1d'],
    },
  },
  2: {
    // "Azure Protectorate" also existed, in faction.component only. Three of
    // the four old sources said "Azure Order", so that name wins.
    id: 2,
    name: 'Azure Order',
    kingName: 'Azure King',
    dark: {
      sprite: { primary: '#0099ff', secondary: '#33aaff', glow: '#66ccff', outline: '#004488' },
      territory: { color: '#3498db', baseColor: '#2980b9', glowColor: '#74b9ff' },
      territoryRamp: ['#3498db', '#2980b9', '#5dade2', '#1f618d', '#1a365d'],
    },
    light: {
      sprite: { primary: '#0891b2', secondary: '#0e7490', glow: '#22d3ee', outline: '#164e63' },
      territory: { color: '#1a6fa3', baseColor: '#155a85', glowColor: '#5aa3d0' },
      // Cyan-600/700/500/800/900.
      territoryRamp: ['#0891b2', '#0e7490', '#06b6d4', '#155e75', '#164e63'],
    },
  },
  3: {
    // "Verdant Collective" also existed, in territory-tile.model only.
    // "Verdant Swarm" is used everywhere else, so that name wins.
    id: 3,
    name: 'Verdant Swarm',
    kingName: 'Verdant King',
    dark: {
      sprite: { primary: '#00ff88', secondary: '#33ffaa', glow: '#66ffcc', outline: '#008844' },
      territory: { color: '#27ae60', baseColor: '#2ecc71', glowColor: '#58d68d' },
      territoryRamp: ['#27ae60', '#2ecc71', '#58d68d', '#1e8449', '#1a4d35'],
    },
    light: {
      sprite: { primary: '#059669', secondary: '#047857', glow: '#34d399', outline: '#064e3b' },
      territory: { color: '#1a7a40', baseColor: '#146032', glowColor: '#52b07a' },
      // Emerald-600/700/500/800/900.
      territoryRamp: ['#059669', '#047857', '#10b981', '#065f46', '#064e3b'],
    },
  },
  4: {
    // Was gold ("Golden Horde") on the sprite lineage and purple ("Shadow
    // King") on the territory lineage. Resolved to Shadow + purple: three of
    // the four old sources named it Shadow, its signature ability is
    // invisibility, and gold collided with the `--game-warning` /
    // rare-loot / shard semantics as well as with faction 3 under protanopia.
    id: 4,
    name: 'Shadow Syndicate',
    kingName: 'Shadow King',
    dark: {
      sprite: { primary: '#8e44ad', secondary: '#9b59b6', glow: '#bb8fce', outline: '#4a1a5c' },
      territory: { color: '#8e44ad', baseColor: '#9b59b6', glowColor: '#bb8fce' },
      // Steps 4-5 are the pre-existing hand-tuned territory shades. This faction's
      // dark ramp was already purple before the gold/purple reconciliation, so it
      // is preserved verbatim rather than recomputed from the sprite outline.
      territoryRamp: ['#8e44ad', '#9b59b6', '#bb8fce', '#6c3483', '#3d1a4d'],
    },
    light: {
      sprite: { primary: '#6b2e8e', secondary: '#58256f', glow: '#b980d0', outline: '#3a1849' },
      territory: { color: '#6b2e8e', baseColor: '#58256f', glowColor: '#b980d0' },
      // The only ramp with no predecessor to preserve: the light ramp was a gold
      // Yellow-600 family before this faction resolved to purple.
      territoryRamp: ['#6b2e8e', '#58256f', '#b980d0', '#3a1849', '#2a1136'],
    },
  },
} as const;

/** Every faction id including Neutral, in ascending order. */
export const ALL_FACTION_IDS: readonly FactionId[] = [0, 1, 2, 3, 4];

/** The four warring factions, excluding Neutral. Order matches `kings[id - 1]`. */
export const KING_FACTION_IDS: readonly FactionId[] = [1, 2, 3, 4];

function identityFor(factionId: number): FactionIdentity {
  return FACTION_IDENTITIES[factionId as FactionId] ?? FACTION_IDENTITIES[0];
}

/** Theme-resolved colors for a faction. Unknown ids fall back to Neutral. */
export function getFactionTheme(factionId: number, isDayMode: boolean): FactionThemeColors {
  const identity = identityFor(factionId);
  return isDayMode ? identity.light : identity.dark;
}

/** Display name for a faction. Unknown ids fall back to Neutral. */
export function getFactionName(factionId: number): string {
  return identityFor(factionId).name;
}

/** King name for a faction. Unknown ids fall back to Neutral's "Unaligned". */
export function getFactionKingName(factionId: number): string {
  return identityFor(factionId).kingName;
}
