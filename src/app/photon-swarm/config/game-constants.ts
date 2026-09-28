import { isDevMode } from '@angular/core';
import { ALL_FACTION_IDS, FACTION_IDENTITIES, FactionId, FactionSpritePalette } from './faction-identity.config';

/**
 * Centralized game configuration constants
 *
 * @deprecated This file is being migrated to a better organized structure.
 * Please import from './config' or specific domain files instead:
 *   - World configs: './config/constants/world' ✅
 *   - Player configs: './config/constants/player' ✅
 *   - Enemy configs: './config/constants/enemy' ✅
 *   - Rendering configs: './config/constants/rendering' (coming soon)
 *   - etc.
 *
 * This file will remain as a facade during the migration period to maintain
 * backwards compatibility. All exports here are re-exported from the new structure.
 */

// =============================================================================
// MIGRATED CONFIGS - Re-exported from new structure
// =============================================================================

// World domain (MIGRATED ✅)
export * from './constants/world';

// Player domain (MIGRATED ✅)
export * from './constants/player';

// Enemy domain (MIGRATED ✅)
export * from './constants/enemy';

// =============================================================================
// ENVIRONMENT
// =============================================================================

// Production flag - disables debug logging for performance
export const IS_PRODUCTION = !isDevMode();

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// Base interface for all upgrade effects
export interface UpgradeEffect {
  readonly BASE_INCREASE?: number;
  readonly INCREASE_PERCENT?: number;
  readonly INCREASE_AMOUNT?: number;
  readonly FIRST_UPGRADE_PERCENT?: number;
  readonly SUBSEQUENT_UPGRADE_PERCENT?: number;
  readonly CHANCE_PERCENT?: number;
  readonly DAMAGE_AMOUNT?: number;
  readonly BEAM_DAMAGE_INCREASE_PERCENT?: number;
  readonly MAX_HP_REDUCTION_PERCENT?: number;
  readonly SPREAD_CHANCE?: number;
  readonly SYNERGY_RECOIL_PERCENT?: number;
  readonly SYNERGY_BEAM_DAMAGE_PERCENT?: number;
  readonly BURN_DAMAGE_INCREASE_PERCENT?: number;
  readonly HEALTH_INCREASE_PERCENT?: number;
  readonly FIRE_RATE_INCREASE_PERCENT?: number;
  readonly DODGE_CHANCE_PERCENT?: number;
  readonly HP_LOSS_ON_DODGE?: number;
  readonly BACKFIRE_CHANCE_PERCENT?: number;
  readonly BACKFIRE_DAMAGE?: number;
  readonly SPEED_INCREASE_PERCENT?: number;
  readonly DASH_INCREASE_PERCENT?: number;
  readonly SURGE_CHANCE_PERCENT?: number;
  readonly ENEMY_DAMAGE_MULTIPLIER?: number;
  readonly CRITICAL_HIT_CHANCE_PERCENT?: number;
  readonly DAMAGE_TAKEN_INCREASE_PERCENT?: number;
  readonly ELITE_DAMAGE_MULTIPLIER_PERCENT?: number;
}

// Specific upgrade effect types with required properties
export interface UpgradeEffects {
  readonly SHARD_MAGNETISM: {
    readonly BASE_INCREASE: number;
    readonly UNLOCK_BONUS: number;
  };
  readonly MOVEMENT_SPEED: {
    readonly INCREASE_PERCENT: number;
  };
  readonly BEAM_DAMAGE: {
    readonly FIRST_UPGRADE_PERCENT: number;
    readonly SUBSEQUENT_UPGRADE_PERCENT: number;
  };
  readonly BEAM_ROTATION: {
    readonly FIRST_UPGRADE_PERCENT: number;
    readonly SUBSEQUENT_UPGRADE_PERCENT: number;
  };
  readonly BEAM_SPEED: {
    readonly INCREASE_PERCENT: number;
  };
  readonly BURN_CHANCE: {
    readonly INCREASE_PERCENT: number;
  };
  readonly GLASS_CANNON: {
    readonly BEAM_DAMAGE_INCREASE_PERCENT: number;
    readonly MAX_HP_REDUCTION_PERCENT: number;
  };
  readonly BURN_DAMAGE: {
    readonly FIRST_UPGRADE_PERCENT: number;
    readonly SUBSEQUENT_UPGRADE_PERCENT: number;
  };
  readonly VOID_BEAM: {
    readonly SYNERGY_BEAM_DAMAGE_PERCENT: number;
  };
  readonly VULNERABILITY_CURSE: {
    readonly DAMAGE_TAKEN_INCREASE_PERCENT: number;
    readonly FIRE_RATE_INCREASE_PERCENT: number;
  };
  readonly SHIELD_BREAKER: {
    readonly ELITE_DAMAGE_MULTIPLIER_PERCENT: number;
    readonly BEAM_DAMAGE_INCREASE_PERCENT: number;
  };
  readonly BURN_SPREAD: {
    readonly RADIUS: number;
    readonly CHANCE_PER_TICK: number;
    readonly DAMAGE_MODIFIER: number;
    readonly DURATION_MODIFIER: number;
    readonly MAX_SPREAD_TARGETS: number;
  };
}

export interface TimingConfig {
  readonly CURSE_EFFECTS: {
    readonly ENEMY_SPAWN_MULTIPLIER_DURATION_MS: number;
    readonly CURSE_ACTIVATION_INTERVAL_MS: number;
  };
  readonly DEBUG_CONSOLE: {
    readonly METRICS_UPDATE_INTERVAL_MS: number;
    readonly AI_ANALYSIS_INTERVAL_MS: number;
    readonly MOVEMENT_DETECTION_INTERVAL_MS: number;
    readonly STATE_UPDATE_INTERVAL_MS: number;
    readonly CHART_SETUP_DELAY_MS: number;
    readonly ALERT_CLEAR_DELAY_MS: number;
    readonly ANIMATION_DELAY_MS: number;
  };
  readonly COLLISION_IMMUNITY: {
    readonly DURATION_MS: number;
  };
  readonly ANIMATION: {
    readonly COSMETIC_CYCLE_DURATION_S: number;
  };
  readonly UI_QUERY_SYSTEM: {
    readonly UPDATE_INTERVAL_MS: number;
  };
  readonly HUD: {
    readonly NOTIFICATION_TIMEOUT_MS: number;
  };
  readonly INTRO_SCREEN: {
    readonly WELCOME_ANIMATION_DELAY_MS: number;
    readonly INSTRUCTION_DELAY_MS: number;
    readonly TYPEWRITER_DELAY_MS: number;
    readonly INSTRUCTION_ANIMATION_DELAY_MS: number;
    readonly SECTION_DELAY_MS: number;
    readonly RESET_DELAY_MS: number;
  };
  readonly CONTROLS: {
    readonly BEAM_STOP_DELAY_MS: number;
    readonly ACTION_RESET_DELAY_MS: number;
  };
  readonly LOOP_SYSTEM: {
    readonly FRAME_DELAY_MS: number;
  };
}

export interface RenderColors {
  readonly PLAYER_FILL: string;
  readonly PLAYER_STROKE: string;
  readonly TARGETING_LINE: string;
  readonly BEAM_TARGETING: string;
  readonly BEAM_ACTIVE: string;
  readonly BEAM_ROTATION_ARC: string;
  readonly ENEMY_DEFAULT: string;
  readonly PROJECTILE: string;
  readonly SHARD_TEXT: string;
  readonly ASTEROID: string;
  readonly HEALTH_BAR_BG: string;
  readonly HEALTH_BAR_HIGH: string;
  readonly HEALTH_BAR_MED: string;
  readonly HEALTH_BAR_LOW: string;
  readonly NOTIFICATION_OUTLINE: string;
  readonly MINIMAP_BG: string;
  readonly MINIMAP_BORDER: string;
  readonly DEBUG_TEXT: string;
  readonly DEBUG_BG: string;
}

// =============================================================================
// THEME COLORS - Light/Dark Mode Support
// Follows website theme system (Contact page patterns)
// =============================================================================

export interface ThemeColorPalette {
  readonly BACKGROUND: {
    readonly PRIMARY: string;
    readonly SECONDARY: string;
    readonly GRADIENT_START: string;
    readonly GRADIENT_MID: string;
    readonly GRADIENT_END: string;
  };
  readonly TEXT: {
    readonly PRIMARY: string;
    readonly SECONDARY: string;
    readonly MUTED: string;
  };
  readonly UI: {
    readonly PANEL_BG: string;
    readonly PANEL_BORDER: string;
    readonly BUTTON_BG: string;
    readonly BUTTON_BORDER: string;
    readonly OVERLAY: string;
  };
  readonly GAME: {
    readonly PLAYER_FILL: string;
    readonly PLAYER_STROKE: string;
    readonly TARGETING_LINE: string;
    readonly GRID_LINE: string;
    readonly MINIMAP_BG: string;
    readonly MINIMAP_BORDER: string;
    readonly HEALTH_BAR_BG: string;
  };
  // Minimap-specific colors for canvas rendering
  readonly MINIMAP: {
    readonly BACKGROUND: string;
    readonly BACKGROUND_COMBAT: string;
    readonly GRID: string;
    readonly RADAR: string;
    readonly PLAYER: string;
    readonly PLAYER_GLOW: string;
    readonly ENEMY: string;
    readonly ENEMY_PULSE: string;
    readonly ALLY: string;
    readonly OBJECTIVE: string;
    readonly DANGER: string;
    readonly SAFE: string;
    readonly FRAME: string;
    readonly FRAME_COMBAT: string;
    readonly FRAME_GLOW: string;
    readonly CORNER: string;
    readonly HUD_TEXT: string;
    readonly COMBAT_TEXT: string;
    readonly ITEM_COMMON: string;
    readonly ITEM_RARE: string;
    readonly ITEM_EPIC: string;
    readonly ITEM_LEGENDARY: string;
  };
  // Canvas-rendered game elements (damage numbers, health bars, effects)
  readonly CANVAS: {
    readonly DAMAGE_NORMAL: string;
    readonly DAMAGE_CRITICAL: string;
    readonly HEALTH_HIGH: string;
    readonly HEALTH_MED: string;
    readonly HEALTH_LOW: string;
    readonly SHARD_HIGH: string;
    readonly SHARD_MED: string;
    readonly SHARD_LOW: string;
    readonly PLAYER_COLOR: string;
    readonly ENEMY_PROJECTILE: string;
    readonly EFFECT_COLOR: string;
    readonly POISON_CLOUD: string;
    readonly STREAK_LEGENDARY: string;
    readonly STREAK_RAMPAGE: string;
    readonly STREAK_HIGH: string;
    readonly STREAK_NORMAL: string;
    readonly FPS_GOOD: string;
    readonly FPS_OK: string;
    readonly FPS_BAD: string;
    // Additional rendering colors
    readonly ACCENT_CYAN: string;
    readonly ACCENT_MAGENTA: string;
    readonly ACCENT_BLUE: string;
    readonly ACCENT_ORANGE: string;
    readonly STROKE_PRIMARY: string;
    readonly STROKE_SECONDARY: string;
    readonly GLOW_PRIMARY: string;
    readonly GLOW_SECONDARY: string;
    readonly TRAIL_MOVEMENT: string;
    readonly TRAIL_FOCUS: string;
    readonly TRAIL_DECAY: string;
    readonly BOUNDARY: string;
    readonly HAZARD: string;
    readonly HAZARD_GLOW: string;
    readonly ASTEROID: string;
    readonly ASTEROID_RIM: string;
    readonly ASTEROID_SHADOW: string;
    readonly ASTEROID_HIGHLIGHT: string;
    readonly ASTEROID_CRATER: string;
    readonly DISCHARGE: string;
    readonly BEAM: string;
    readonly BEAM_GLOW: string;
    readonly ACCENT_GOLD: string;
    readonly ACCENT_VIOLET: string;
  };
}

const THEME_COLORS: {
  readonly DARK: ThemeColorPalette;
  readonly LIGHT: ThemeColorPalette;
} = {
  DARK: {
    BACKGROUND: {
      PRIMARY: '#000000',
      SECONDARY: '#0a0a1a',
      GRADIENT_START: '#0f0f23',
      GRADIENT_MID: '#050510',
      GRADIENT_END: '#000000',
    },
    TEXT: {
      PRIMARY: '#ffffff',
      SECONDARY: 'rgba(255, 255, 255, 0.7)',
      MUTED: 'rgba(255, 255, 255, 0.5)',
    },
    UI: {
      PANEL_BG: 'rgba(0, 10, 20, 0.95)',
      PANEL_BORDER: 'rgba(0, 255, 255, 0.3)',
      BUTTON_BG: 'rgba(0, 40, 60, 0.6)',
      BUTTON_BORDER: 'rgba(0, 255, 255, 0.3)',
      OVERLAY: 'rgba(0, 0, 0, 0.7)',
    },
    GAME: {
      PLAYER_FILL: 'rgba(255, 255, 255, 0.3)',
      PLAYER_STROKE: 'rgba(255, 255, 255, 0.8)',
      TARGETING_LINE: 'rgba(255, 255, 255, 0.5)',
      GRID_LINE: 'rgba(0, 255, 255, 0.04)',
      MINIMAP_BG: 'rgba(0, 10, 20, 0.85)',
      MINIMAP_BORDER: '#0ff',
      HEALTH_BAR_BG: '#333',
    },
    // Cyberpunk neon aesthetic for dark mode minimap
    MINIMAP: {
      BACKGROUND: 'rgba(0, 10, 20, 0.85)',
      BACKGROUND_COMBAT: 'rgba(50, 0, 0, 0.3)',
      GRID: 'rgba(0, 100, 100, 0.08)',
      RADAR: 'rgba(0, 255, 255, 0.3)',
      PLAYER: '#00ff00',
      PLAYER_GLOW: 'rgba(0, 255, 0, 0.5)',
      ENEMY: '#ff0044',
      ENEMY_PULSE: 'rgba(255, 0, 0, 0.3)',
      ALLY: '#0088ff',
      OBJECTIVE: '#ffaa00',
      DANGER: '#ff0000',
      SAFE: '#00ff88',
      FRAME: 'rgba(0, 255, 255, 0.5)',
      FRAME_COMBAT: 'rgba(255, 0, 0, 0.6)',
      FRAME_GLOW: 'rgba(0, 255, 255, 0.1)',
      CORNER: 'rgba(0, 255, 255, 0.8)',
      HUD_TEXT: 'rgba(0, 255, 255, 0.6)',
      COMBAT_TEXT: 'rgba(255, 0, 0, 0.8)',
      ITEM_COMMON: 'rgba(200, 200, 200, 0.7)',
      ITEM_RARE: 'rgba(0, 100, 255, 0.8)',
      ITEM_EPIC: 'rgba(200, 0, 255, 0.9)',
      ITEM_LEGENDARY: 'rgba(255, 150, 0, 1.0)',
    },
    // Cyberpunk neon aesthetic for dark mode canvas elements
    CANVAS: {
      DAMAGE_NORMAL: '#ff6666',
      DAMAGE_CRITICAL: '#ffff00',
      HEALTH_HIGH: '#44ff44',
      HEALTH_MED: '#ffff44',
      HEALTH_LOW: '#ff4444',
      SHARD_HIGH: '#00ff88',
      SHARD_MED: '#ffd700',
      SHARD_LOW: '#00e5ff',
      PLAYER_COLOR: '#00ff00',
      ENEMY_PROJECTILE: '#ff6666',
      EFFECT_COLOR: '#ff6b6b',
      POISON_CLOUD: '#669944',
      STREAK_LEGENDARY: '#ff6600',
      STREAK_RAMPAGE: '#ffaa00',
      STREAK_HIGH: '#00ff00',
      STREAK_NORMAL: '#66ff66',
      FPS_GOOD: '#00ff00',
      FPS_OK: '#ffff00',
      FPS_BAD: '#ff0000',
      // Additional rendering colors
      ACCENT_CYAN: '#00ffff',
      ACCENT_MAGENTA: '#ff44ff',
      ACCENT_BLUE: '#0080ff',
      ACCENT_ORANGE: '#ff8800',
      STROKE_PRIMARY: '#ffffff',
      STROKE_SECONDARY: '#000000',
      GLOW_PRIMARY: '#00ffff',
      GLOW_SECONDARY: '#ff00ff',
      TRAIL_MOVEMENT: '#00ffff',
      TRAIL_FOCUS: '#ff44ff',
      TRAIL_DECAY: '#ff8000',
      BOUNDARY: '#444444',
      HAZARD: '#ff4444',
      HAZARD_GLOW: '#ff8888',
      ASTEROID: '#80684c',
      ASTEROID_RIM: '#c2a87c',
      ASTEROID_SHADOW: '#403228',
      ASTEROID_HIGHLIGHT: '#dfc59a',
      ASTEROID_CRATER: '#564431',
      DISCHARGE: '#ff00ff',
      BEAM: '#00ffff',
      BEAM_GLOW: '#00cccc',
      ACCENT_GOLD: '#ffaa00', // crit reward — neon gold
      ACCENT_VIOLET: '#aa44ff', // xp_boost reward — neon violet
    },
  },
  LIGHT: {
    // Precision & Density - Cool slate foundation
    BACKGROUND: {
      PRIMARY: '#f8fafc', // Slate-50 (cool white)
      SECONDARY: '#f1f5f9', // Slate-100
      GRADIENT_START: '#f8fafc', // Slate-50
      GRADIENT_MID: '#f1f5f9', // Slate-100
      GRADIENT_END: '#e2e8f0', // Slate-200
    },
    TEXT: {
      PRIMARY: '#334155', // Slate-700 (slightly darker for contrast)
      SECONDARY: 'rgba(51, 65, 85, 0.7)', // Slate-700
      MUTED: 'rgba(51, 65, 85, 0.5)', // Slate-700
    },
    UI: {
      PANEL_BG: 'rgba(248, 250, 252, 0.95)', // Slate-50
      PANEL_BORDER: 'rgba(71, 85, 105, 0.25)', // Slate-600
      BUTTON_BG: 'rgba(71, 85, 105, 0.08)', // Slate-600
      BUTTON_BORDER: 'rgba(71, 85, 105, 0.35)', // Slate-600
      OVERLAY: 'rgba(248, 250, 252, 0.85)', // Slate-50
    },
    GAME: {
      PLAYER_FILL: 'rgba(8, 145, 178, 0.35)', // Cyan-600
      PLAYER_STROKE: 'rgba(8, 145, 178, 0.9)', // Cyan-600
      TARGETING_LINE: 'rgba(71, 85, 105, 0.4)', // Slate-600
      GRID_LINE: 'rgba(71, 85, 105, 0.06)', // Slate-600
      MINIMAP_BG: 'rgba(71, 85, 105, 0.06)', // Slate-600
      MINIMAP_BORDER: '#64748b', // Slate-500
      HEALTH_BAR_BG: '#e2e8f0', // Slate-200
    },
    // Precision & Density - Cool slate minimap
    MINIMAP: {
      BACKGROUND: 'rgba(248, 250, 252, 0.85)', // Slate-50
      BACKGROUND_COMBAT: 'rgba(220, 38, 38, 0.12)', // Red-600 tint
      GRID: 'rgba(71, 85, 105, 0.12)', // Slate-600
      RADAR: 'rgba(71, 85, 105, 0.2)', // Slate-600 radar sweep
      PLAYER: '#0891b2', // Cyan-600 - matches Azure faction
      PLAYER_GLOW: 'rgba(8, 145, 178, 0.4)', // Cyan-600
      ENEMY: '#dc2626', // Red-600 - matches Crimson faction
      ENEMY_PULSE: 'rgba(220, 38, 38, 0.3)', // Red-600
      ALLY: '#0891b2', // Cyan-600
      OBJECTIVE: '#ca8a04', // Yellow-600 - matches Golden faction
      DANGER: '#dc2626', // Red-600
      SAFE: '#059669', // Emerald-600 - matches Verdant faction
      FRAME: 'rgba(71, 85, 105, 0.5)', // Slate-600
      FRAME_COMBAT: 'rgba(220, 38, 38, 0.6)', // Red-600
      FRAME_GLOW: 'rgba(71, 85, 105, 0.15)', // Slate-600
      CORNER: 'rgba(71, 85, 105, 0.6)', // Slate-600
      HUD_TEXT: 'rgba(51, 65, 85, 0.8)', // Slate-700
      COMBAT_TEXT: 'rgba(220, 38, 38, 1.0)', // Red-600
      ITEM_COMMON: 'rgba(148, 163, 184, 0.9)', // Slate-400
      ITEM_RARE: 'rgba(8, 145, 178, 0.9)', // Cyan-600
      ITEM_EPIC: 'rgba(147, 51, 234, 0.9)', // Violet-600
      ITEM_LEGENDARY: 'rgba(202, 138, 4, 1.0)', // Yellow-600
    },
    // Precision & Density - Cool colors for slate background
    CANVAS: {
      DAMAGE_NORMAL: '#dc2626', // Red-600 - Crimson faction
      DAMAGE_CRITICAL: '#ca8a04', // Yellow-600 - critical gold
      HEALTH_HIGH: '#059669', // Emerald-600 - Verdant faction
      HEALTH_MED: '#ca8a04', // Yellow-600 - Golden faction
      HEALTH_LOW: '#dc2626', // Red-600
      SHARD_HIGH: '#059669', // Emerald-600
      SHARD_MED: '#ca8a04', // Yellow-600
      SHARD_LOW: '#0891b2', // Cyan-600 - Azure faction
      PLAYER_COLOR: '#0891b2', // Cyan-600
      ENEMY_PROJECTILE: '#dc2626', // Red-600
      EFFECT_COLOR: '#dc2626', // Red-600
      POISON_CLOUD: '#059669', // Emerald-600
      STREAK_LEGENDARY: '#ca8a04', // Yellow-600
      STREAK_RAMPAGE: '#dc2626', // Red-600
      STREAK_HIGH: '#059669', // Emerald-600
      STREAK_NORMAL: '#0891b2', // Cyan-600
      FPS_GOOD: '#059669', // Emerald-600
      FPS_OK: '#ca8a04', // Yellow-600
      FPS_BAD: '#dc2626', // Red-600
      // Rendering colors - cool palette
      ACCENT_CYAN: '#0891b2', // Cyan-600
      ACCENT_MAGENTA: '#a855f7', // Violet-500 (cooler magenta)
      ACCENT_BLUE: '#0891b2', // Cyan-600
      ACCENT_ORANGE: '#ca8a04', // Yellow-600
      STROKE_PRIMARY: '#475569', // Slate-600
      STROKE_SECONDARY: '#64748b', // Slate-500
      GLOW_PRIMARY: '#0891b2', // Cyan-600
      GLOW_SECONDARY: '#a855f7', // Violet-500
      TRAIL_MOVEMENT: '#0891b2', // Cyan-600
      TRAIL_FOCUS: '#a855f7', // Violet-500 (cool focus)
      TRAIL_DECAY: '#ca8a04', // Yellow-600
      BOUNDARY: '#94a3b8', // Slate-400
      HAZARD: '#dc2626', // Red-600
      HAZARD_GLOW: '#f87171', // Red-400
      ASTEROID: '#94a3b8', // Slate-400
      ASTEROID_RIM: '#475569', // Slate-600
      ASTEROID_SHADOW: '#64748b', // Slate-500
      ASTEROID_HIGHLIGHT: '#e2e8f0', // Slate-200
      ASTEROID_CRATER: '#64748b', // Slate-500
      DISCHARGE: '#a855f7', // Violet-500
      BEAM: '#0891b2', // Cyan-600
      BEAM_GLOW: '#22d3ee', // Cyan-400
      ACCENT_GOLD: '#ca8a04', // Yellow-600 — crit reward (day mode)
      ACCENT_VIOLET: '#7c3aed', // Violet-600 — xp_boost reward (day mode)
    },
  },
} as const;

/**
 * Helper function to get theme colors based on current mode
 */
export function getThemeColors(isDayMode: boolean): ThemeColorPalette {
  return isDayMode ? THEME_COLORS.LIGHT : THEME_COLORS.DARK;
}

export interface LineWidths {
  readonly DEFAULT: number;
  readonly THICK: number;
  readonly THIN: number;
  readonly [key: string]: number;
}

export interface ArrayIndices {
  readonly DEBUG_ARGS: {
    readonly COMMAND: number;
    readonly DATA: number;
    readonly ADDITIONAL: number;
  };
  readonly COLOR_COMPONENTS: {
    readonly RED: number;
    readonly GREEN: number;
    readonly BLUE: number;
    readonly FIRST_COLOR: number;
  };
  readonly COORDINATES: {
    readonly X: number;
    readonly Y: number;
  };
  readonly POSITION: {
    readonly FROM_X: number;
    readonly FROM_Y: number;
    readonly TO_X: number;
    readonly TO_Y: number;
  };
}

// =============================================================================
// FOUR KINGS TERRITORY CONFIGURATION
// =============================================================================

/** Derives a FOUR_KINGS_CONFIG.KINGS entry from the canonical faction identity. */
function buildKingEntry(factionId: FactionId): {
  ID: number;
  NAME: string;
  COLOR: string;
  BASE_COLOR: string;
  GLOW_COLOR: string;
} {
  const identity = FACTION_IDENTITIES[factionId];
  return {
    ID: identity.id,
    NAME: identity.kingName,
    COLOR: identity.dark.territory.color,
    BASE_COLOR: identity.dark.territory.baseColor,
    GLOW_COLOR: identity.dark.territory.glowColor,
  };
}

export const FOUR_KINGS_CONFIG = {
  TILE_SIZE: 120,
  UPDATE_INTERVAL: 0.5, // seconds between territory updates
  TRANSITION_SPEED: 2.0, // visual transition speed
  VISUAL_OPACITY: 0.3, // Atmospheric tint (reduced from 0.5 — softened territory cross)
  GLOW_OPACITY: 0.1, // Increased from 0.03 to 0.1 for better visibility
  GRID_LINE_OPACITY: 0.1, // Increased from 0.05 to 0.1 - grid should be more visible
  // Keys (CRIMSON/AZURE/VERDANT/SHADOW) are read by name in four-kings-territory.service.ts.
  KINGS: {
    CRIMSON: buildKingEntry(1),
    AZURE: buildKingEntry(2),
    VERDANT: buildKingEntry(3),
    SHADOW: buildKingEntry(4),
  },
} as const;

// =============================================================================
// UPGRADE SYSTEM CONFIGURATION
// =============================================================================

export const UPGRADE_EFFECTS: UpgradeEffects = {
  SHARD_MAGNETISM: {
    BASE_INCREASE: 50, // Buffed from 10 - magnetism was too weak to notice
    UNLOCK_BONUS: 100, // Initial magnetism range when ability is unlocked
  },
  MOVEMENT_SPEED: {
    INCREASE_PERCENT: 20, // BUFFED 2.5x: 8% → 20% for Advanced tier
  },
  BEAM_DAMAGE: {
    FIRST_UPGRADE_PERCENT: 50, // BUFFED 2.5x: 20% → 50% for Advanced tier
    SUBSEQUENT_UPGRADE_PERCENT: 38, // BUFFED 2.5x: 15% → 38%
  },
  BEAM_ROTATION: {
    FIRST_UPGRADE_PERCENT: 38, // BUFFED 2.5x: 15% → 38%
    SUBSEQUENT_UPGRADE_PERCENT: 25, // BUFFED 2.5x: 10% → 25%
  },
  BEAM_SPEED: {
    INCREASE_PERCENT: 38, // BUFFED 2.5x: 15% → 38%
  },
  BURN_CHANCE: {
    INCREASE_PERCENT: 30, // BUFFED 2.5x: 12% → 30%
  },
  GLASS_CANNON: {
    // NERFED: Changed from +40% damage/-20% HP to +30% damage/-30% HP for better risk/reward
    BEAM_DAMAGE_INCREASE_PERCENT: 30,
    MAX_HP_REDUCTION_PERCENT: 30,
  },
  BURN_DAMAGE: {
    FIRST_UPGRADE_PERCENT: 100, // BUFFED 2.5x: 40% → 100%
    SUBSEQUENT_UPGRADE_PERCENT: 75, // BUFFED 2.5x: 30% → 75%
  },
  BURN_SPREAD: {
    RADIUS: 100, // Pixels — how far burn can spread to nearby enemies
    CHANCE_PER_TICK: 0.15, // 15% chance per burn tick (every 250ms)
    DAMAGE_MODIFIER: 0.7, // Spread burns deal 70% of original burn damage
    DURATION_MODIFIER: 0.8, // Spread burns last 80% of original duration
    MAX_SPREAD_TARGETS: 1, // Max targets per tick (prevents AOE explosion)
  },
  VOID_BEAM: {
    SYNERGY_BEAM_DAMAGE_PERCENT: 10,
  },
  VULNERABILITY_CURSE: {
    DAMAGE_TAKEN_INCREASE_PERCENT: 50,
    FIRE_RATE_INCREASE_PERCENT: 30,
  },
  SHIELD_BREAKER: {
    ELITE_DAMAGE_MULTIPLIER_PERCENT: 200,
    BEAM_DAMAGE_INCREASE_PERCENT: 10,
  },
};

// =============================================================================
// CORE TIER UPGRADE EFFECTS (Simple, impactful upgrades)
// =============================================================================

export const CORE_UPGRADE_EFFECTS = {
  SPEED: {
    INCREASE_PERCENT: 15, // +15% movement speed per stack (buffed from 12%)
  },
  POWER: {
    INCREASE_PERCENT: 20, // +20% beam damage per stack (buffed from 15%)
  },
  SHIELD: {
    INCREASE_AMOUNT: 35, // +35 max HP per stack (buffed from 25)
  },
  MAGNET: {
    INCREASE_RANGE: 80, // +80 shard collection range per stack (buffed from 60)
  },
} as const;

// Performance monitoring configuration
export const MONITORING_CONFIG = {
  ENABLED: !IS_PRODUCTION, // Only enable in dev
  WARNING_THRESHOLD_MS: 16, // 60 FPS threshold
  ERROR_THRESHOLD_MS: 33, // 30 FPS threshold
  LOG_INTERVAL_MS: 30000, // Log metrics every 30 seconds
};

// Beam reflection configuration - Enhanced deflection shield mechanics
export const BEAM_REFLECTION = {
  SPEED_MULTIPLIER: 1.5, // Reflected projectiles move 50% faster
  MAX_REFLECTIONS: 3, // Prevent infinite ping-pong
  VISUAL_EFFECTS_COUNT: 3, // Number of visual effects to spawn for shield impact

  // Enhanced visual feedback
  REFLECTION_SPARK_COUNT: 3, // Number of sparks on deflection
  REFLECTION_SPARK_SPREAD: 0.5, // Spread angle for spark particles (radians)
  REFLECTION_SPARK_SPEED: 0.5, // Speed multiplier for spark particles

  // Damage mechanics
  DAMAGE_MULTIPLIER: 1.2, // Reflected projectiles deal 20% more damage
  SHOW_REFLECTION_DAMAGE: false, // Don't show damage numbers for clarity

  // Visual distinction
  REFLECTION_COLOR: { r: 100, g: 200, b: 255, a: 0.8 }, // Blue-ish deflection color
  REFLECTION_GLOW_INTENSITY: 0.6, // Glow intensity for deflected projectiles
  REFLECTION_TRAIL_LENGTH: 0.8, // Trail effect for reflected projectiles

  // Audio feedback (for future implementation)
  REFLECTION_SOUND_VOLUME: 0.3, // Volume for deflection sound
  REFLECTION_PITCH_VARIATION: 0.2, // Pitch variation for multiple deflections
};

// =============================================================================
// TERRITORY GENERATION CONFIGURATION
// =============================================================================

export const TERRITORY_CONFIG = {
  // Balance algorithm constants
  NO_PROGRESS_ITERATION_LIMIT: 10, // Stop if no progress after this many iterations
  AGGRESSIVE_TRANSFER_MULTIPLIER: 2, // Multiply MAX_BORDER_TRANSFERS for aggressive pass
} as const;

// =============================================================================
// FACTION SYSTEM CONFIGURATION
// =============================================================================

export const FACTION_CONFIG = {
  // Standing thresholds
  ALLIED_THRESHOLD: 50, // Standing >= 50 = allied
  HOSTILE_THRESHOLD: -50, // Standing <= -50 = hostile

  // UI Configuration
  UI_UPDATE_INTERVAL_MS: 500, // How often faction display updates territory

  // Standing change amounts
  STANDING_CHANGES: {
    KILL_IN_HOSTILE_TERRITORY: 5, // Gain standing for killing in hostile territory
    KILL_IN_ALLIED_TERRITORY: -10, // Lose standing for killing in allied territory
    KILL_OWN_FACTION: 2, // Small gain for defending faction's territory
  },

  // Territory effect multipliers
  TERRITORY_EFFECTS: {
    ALLIED: {
      DAMAGE_MULTIPLIER: 1.2, // +20% damage output
      DEFENSE_MULTIPLIER: 0.8, // -20% damage taken (0.8x incoming damage)
      SPEED_MULTIPLIER: 1.1, // +10% movement speed
    },
    HOSTILE: {
      DAMAGE_MULTIPLIER: 0.9, // -10% damage output
      DEFENSE_MULTIPLIER: 1.2, // +20% damage taken (1.2x incoming damage)
      SPEED_MULTIPLIER: 0.95, // -5% movement speed
    },
    NEUTRAL: {
      DAMAGE_MULTIPLIER: 1.0, // No effect
      DEFENSE_MULTIPLIER: 1.0, // No effect
      SPEED_MULTIPLIER: 1.0, // No effect
    },
  },

  // Performance optimization
  CACHE_DURATION_MS: 500, // Cache territory effects for 500ms
  CACHE_DISTANCE_THRESHOLD: 50, // Recalculate if player moves more than 50 units

  // Valid faction IDs
  MIN_FACTION_ID: 1,
  MAX_FACTION_ID: 4,

  // Debug logging
  DEBUG_LOG_CHANCE: 0.01, // 1% chance to log territory effect applications
} as const;

// =============================================================================
// FACTION COLORS - derived from FACTION_IDENTITIES (config/faction-identity.config.ts)
// =============================================================================

interface FactionColorEntry extends FactionSpritePalette {
  readonly name: string;
}

/** Builds a { [factionId]: sprite palette + name } table for the given theme. */
function buildFactionColorTable(mode: 'dark' | 'light'): Readonly<Record<FactionId, FactionColorEntry>> {
  const entries = ALL_FACTION_IDS.map((id) => {
    const identity = FACTION_IDENTITIES[id];
    return [id, { ...identity[mode].sprite, name: identity.name }] as const;
  });
  return Object.fromEntries(entries) as Readonly<Record<FactionId, FactionColorEntry>>;
}

export const FACTION_COLORS: Readonly<Record<FactionId, FactionColorEntry>> = buildFactionColorTable('dark');

// FACTION COLORS - Light Mode (Precision & Density - Cool tones for slate background)
// =============================================================================

export const FACTION_COLORS_LIGHT: Readonly<Record<FactionId, FactionColorEntry>> = buildFactionColorTable('light');

/**
 * Get faction colors based on current theme
 * @param factionId - The faction ID (0-4)
 * @param isDayMode - Whether light mode is active
 */
export function getFactionColors(
  factionId: number,
  isDayMode: boolean
): { primary: string; secondary: string; glow: string; outline: string; name: string } {
  const colors = isDayMode ? FACTION_COLORS_LIGHT : FACTION_COLORS;
  return colors[factionId as FactionId] || colors[0];
}

// =============================================================================
// TERRITORY SYSTEM CONFIGURATION
// =============================================================================

export const TERRITORY_SYSTEM_CONFIG = {
  // Strength system
  STRENGTH: {
    BASE_TILE_STRENGTH: 100, // Strength of base tiles near faction spawns
    NORMAL_TILE_STRENGTH: 75, // Starting strength for normal tiles
    MIN_TILE_STRENGTH: 10, // Minimum strength a tile can have
    WEAK_THRESHOLD: 30, // Tiles below this are considered weak
    STRONG_THRESHOLD: 60, // Tiles above this can expand
    CAPTURED_STRENGTH: 50, // Strength of newly captured tiles

    // Weakening from kills
    KILL_IMPACT_RADIUS_PX: 100, // Radius in pixels for kill impact
    KILL_IMPACT_BASE: 10, // Base weakening amount
    KILL_IMPACT_MIN: 5, // Minimum weakening amount

    // Regeneration
    REGENERATION_INTERVAL_MS: 30000, // Regenerate every 30 seconds
    REGENERATION_AMOUNT: 1, // Amount to regenerate per interval

    // Base tile detection
    BASE_TILE_DISTANCE: 3, // Grid distance from spawn to be considered base
  },

  // Border conflict system
  CONFLICT: {
    UPDATE_INTERVAL_MS: 5500, // Check for conflicts every 5.5 seconds — offset to avoid simultaneous firing with expansion (10.3s) and regen (30s)
    MIN_INTENSITY_THRESHOLD: 0.2, // Minimum intensity to be active
    INTENSITY_DECAY_RATE: 0.95, // How fast intensity decays

    // Intensity calculation
    INTENSITY_BLEND_OLD: 0.7, // Weight of old intensity when smoothing
    INTENSITY_BLEND_NEW: 0.3, // Weight of new intensity when smoothing

    // Spawn modifiers
    SPAWN_MULTIPLIER_BASE: 1.5, // Base multiplier for conflict zones
    SPAWN_MULTIPLIER_SCALE: 1.5, // Additional multiplier based on intensity
    MIXED_FACTION_THRESHOLD: 0.3, // Intensity needed for mixed spawns

    // Debug
    CONFLICT_LOG_CHANCE: 0.1, // 10% chance to log conflict updates
  },

  // Expansion system
  EXPANSION: {
    CHECK_INTERVAL_MS: 10000, // Check for expansion every 10 seconds
    RECENT_HISTORY_MS: 60000, // Track recent expansions for 1 minute
  },

  // Visual feedback
  VISUAL: {
    MAX_ACTIVE_EFFECTS: 50, // Maximum simultaneous visual effects
    RIPPLE_DURATION_MS: 1000, // Duration of ripple effects
    FLASH_DURATION_MS: 500, // Duration of flash effects
    TEXT_DURATION_MS: 1500, // Duration of floating text

    // Effect sizes
    RIPPLE_MAX_RADIUS: 100, // Maximum ripple radius in pixels
    TEXT_RISE_SPEED: 50, // Pixels per second for floating text
  },

  // NPC faction battles
  NPC_BATTLES: {
    UPDATE_INTERVAL_MS: 100, // How often to update battle logic
    TARGET_ACQUISITION_RANGE: 300, // Range to detect enemies
    COMBAT_RANGE: 150, // Range to engage in combat
    RETARGET_INTERVAL_MS: 2000, // Re-evaluate targets every 2 seconds
    NPC_DAMAGE_MULTIPLIER: 0.5, // NPCs do 50% damage to each other
    COMBAT_LOG_CHANCE: 0.1, // 10% chance to log combat events
    KILL_TERRITORY_BOOST: 0.05, // Conflict intensity boost from NPC kills

    // Target priorities (higher = more important)
    TARGET_PRIORITY: {
      NONE: 0, // No valid target
      PLAYER_NEUTRAL: 1, // Player in neutral territory
      PLAYER_FRIENDLY: 2, // Player in NPC's territory
      PLAYER_HOSTILE: 3, // Player in hostile territory
      ENEMY_NPC: 4, // Enemy faction NPC
      ENEMY_NPC_CONFLICT: 5, // Enemy NPC in conflict zone
    },

    // Score weights for target selection
    TARGET_SCORE_WEIGHTS: {
      PRIORITY: 2.0, // Priority weight
      DISTANCE: 1.0, // Distance weight (inverted)
      HEALTH: 0.5, // Health weight (prefer wounded)
    },

    // Visual effects for NPC vs NPC combat
    VISUAL: {
      DAMAGE_NUMBER_FONT_SIZE: 11, // 70% of normal 16px
      DAMAGE_NUMBER_DURATION_MS: 800, // Shorter than player damage (1000ms)
      DAMAGE_NUMBER_FADE_START: 0.5, // Earlier fade = more transparent feel
      DAMAGE_NUMBER_VELOCITY_Y_MIN: -35, // Slower float than player damage
      DAMAGE_NUMBER_VELOCITY_Y_RANGE: 10, // Velocity randomization range
      CLASH_SPARK_COUNT_MIN: 3,
      CLASH_SPARK_COUNT_MAX: 5,
      CLASH_SPARK_LIFETIME_MS: 250,
      CLASH_SPARK_SPEED: 60,
      CLASH_SPARK_THROTTLE_MS: 500, // Max 1 spark per pair per 500ms
      DAMAGE_NUMBER_THROTTLE_MS: 1000, // Accumulate + batch display (NPC battles less critical)
      DEATH_PARTICLE_COUNT: 6,
      DEATH_PARTICLE_LIFETIME_MS: 500,
      AGGRO_GLOW_ALPHA_BASE: 0.06, // Base alpha for aggro glow
      AGGRO_GLOW_ALPHA_PULSE: 0.03, // Pulse amplitude
      AGGRO_GLOW_PULSE_SPEED: 0.004, // Radians per ms
      STALE_THROTTLE_CLEANUP_MS: 5000, // Clean stale throttle entries after 5s
      STALE_THROTTLE_CHECK_INTERVAL_MS: 10000, // Check for stale entries every 10s
    },
  },

  // Territory momentum system
  MOMENTUM: {
    UPDATE_INTERVAL_MS: 10000, // Check momentum every 10 seconds
    MOMENTUM_DECAY: 0.9, // Momentum decays by 10% per update
    MOMENTUM_GAIN: 0.15, // Gain per territory change

    // State thresholds
    WINNING_THRESHOLD: 0.3, // 30% more territory than average
    LOSING_THRESHOLD: -0.3, // 30% less territory than average
    DESPERATE_THRESHOLD: 0.15, // Less than 15% of total territory
    LAST_STAND_THRESHOLD: 0.05, // Less than 5% triggers last stand

    // Bonuses for winning factions
    MAX_EXPANSION_BONUS: 0.5, // 50% faster expansion
    MAX_STRENGTH_BONUS: 20, // +20 strength for new territories
    WINNING_SPAWN_REDUCTION: 0.8, // 20% fewer spawns when winning

    // Rally mechanics for losing factions
    LOSING_SPAWN_INCREASE: 1.2, // 20% more spawns when losing
    DESPERATE_SPAWN_INCREASE: 1.5, // 50% more spawns when desperate
    MAX_RALLY_MULTIPLIER: 2.0, // 2x enemy strength when desperate
    LAST_STAND_MULTIPLIER: 3.0, // 3x enemy strength in last stand

    // Player impact
    PLAYER_KILL_IMPACT: 0.05, // Momentum change from player kills
    PLAYER_DEATH_IMPACT: 0.02, // Momentum boost when killing player

    // Performance
    CACHE_UPDATE_THRESHOLD: 100, // Update cache every 100 territory changes
    MAX_HISTORY_LENGTH: 100, // Keep last 100 balance scores
  },
} as const;

// =============================================================================
// PROGRESSION CONFIGURATION
// =============================================================================

export const PROGRESSION_CONFIG = {
  // XP requirements for leveling
  // TUNED: Halls of Torment-inspired steady progression (~45-60s early, scaling to 2-3 min mid-game)
  XP_BASE: 100, // Base XP for level 1->2 (increased for slower early levels)
  XP_MULTIPLIER: 1.12, // Each level requires 1.12x more XP (gentler curve for steady feel)
  // XP GAINS scale with level by XP_MULTIPLIER^((level-1) * XP_LEVEL_SCALE) so kills-per-level
  // grows GENTLY instead of exploding. The requirement compounds at 1.12^(L-1) but base per-kill
  // XP is flat (ENEMY_XP), so without this late levels needed hundreds of kills each (the bar
  // crawling near the top — the "slow at 80-90%" report). 0 = off (flat awards, exponential
  // grind); 1 = kills-per-level held constant. 0.5 offsets HALF the curve, so kills/level rise
  // ~8 -> ~16 (L13) -> ~25 (L20) -> ~130 (L50) instead of ~8 -> ~32 -> ~72 -> ~2000.
  XP_LEVEL_SCALE: 0.5,
  MAX_LEVEL: 50, // Reasonable cap for game longevity
  PRESTIGE_ENABLED: true, // Ascension meta-progression system

  // Mastery expands run options instead of permanently outscaling enemies.
  // Legacy multiplier fields remain at zero for save/API compatibility.
  ASCENSION_BONUSES: {
    DAMAGE_PER_LEVEL: 0,
    MAX_HEALTH_PER_LEVEL: 0,
    SHARD_MULTIPLIER_PER_LEVEL: 0,
    XP_MULTIPLIER_PER_LEVEL: 0,
    MAX_ASCENSION_LEVEL: 3,
  },
  ASCENSION_REQUIREMENTS: {
    BASE_LEVEL_REQUIRED: 10, // Must reach level 10 to ascend
    LEVEL_PER_ASCENSION: 2, // Mastery milestones: level 10, 12, then 14
  },

  // Enemy XP values - tuned for satisfying progression
  ENEMY_XP: {
    basic: 12, // ~8 kills for level 1->2
    spitter: 18, // Ranged enemies worth slightly more
    tank: 30, // Tanky enemies are rewarding
    swarm: 12, // Same as basic - swarms should feel rewarding
    thug: 24, // Glass cannons are rewarding
    sniper: 35, // Dangerous enemies = high reward
    boss: 120, // Boss kills feel impactful
    disruptor: 25, // High-value target — disabling its pulse is a skill reward
    sentinel: 35, // Rewarding to flank and kill; equal to sniper as a flanking puzzle
  },

  // Shard drop values by enemy type — mirrors XP ratios at a smaller scale
  ENEMY_SHARD_VALUE: {
    basic: 1,
    spitter: 1,
    tank: 2,
    swarm: 1,
    thug: 2,
    sniper: 3,
    boss: 8,
    disruptor: 2,
    sentinel: 3, // Shield-bearing enemy; worth as much as a sniper
  },

  // XP multipliers
  ELITE_MULTIPLIER: 2, // Elite enemies give 2x XP
  CHAMPION_MULTIPLIER: 3.0, // 3x stats (between elite 2x and boss)
  RARE_MULTIPLIER: 1.5, // Rare enemies give 1.5x XP
  LEGENDARY_MULTIPLIER: 3, // Legendary enemies give 3x XP
} as const;

// =============================================================================
// CHARGING CONFIGURATION
// =============================================================================

export const FOCUS_CHARGING_CONFIG = {
  // Focus charge damage reduction
  FOCUS_DAMAGE_REDUCTION: {
    MAX_REDUCTION: 0.3, // Maximum 30% damage reduction
    SCALE_FACTOR: 0.3, // Reduction scales with focus charge
  },
  // Auto-fire behavior
  AUTO_FIRE_RESET_CHARGE: 0.5, // Reset to 50% after auto-fire for momentum (0-1 range)
} as const;

// =============================================================================
// DAMAGE CONFIGURATION
// =============================================================================

export const DAMAGE_CONFIG = {
  // Frame-based damage cap to prevent instant death from multiple collisions
  MAX_DAMAGE_PER_FRAME: 15,
  // Player damage immunity after taking damage (milliseconds)
  PLAYER_DAMAGE_IMMUNITY_MS: 1000,
  // Collision immunity duration between same entity pairs (milliseconds)
  COLLISION_IMMUNITY_DURATION_MS: 500,
  // Performance tracking
  DAMAGE_CAP_METRICS: {
    LOG_FREQUENCY: 0.01, // Log 1% of cap events
    TRACK_CAP_HITS: true,
    METRICS_LOG_INTERVAL_MS: 60000, // Log metrics every 60 seconds
  },
} as const;

// =============================================================================
// MEMORY MANAGEMENT CONFIGURATION
// =============================================================================

export const MEMORY_CONFIG = {
  COLLISION_IMMUNITY: {
    // How often to clean up expired collision immunity entries
    CLEANUP_INTERVAL_MS: 2000, // Reduced from 5000ms to 2000ms (2 seconds)
    // Maximum size before forcing cleanup
    MAX_MAP_SIZE: 500, // Reduced from 1000 to 500 entries
    // Buffer time to keep entries after expiry
    EXPIRY_BUFFER_MS: 1000,
  },
} as const;

// =============================================================================
// OBJECT POOL CONFIGURATION
// =============================================================================

/**
 * Pool type enum for type safety
 */
export enum PoolType {
  PROJECTILE = 'projectile',
  ENEMY = 'enemy',
  EFFECT = 'effect',
  CHARGED_PROJECTILE = 'chargedProjectile',
  SHARD = 'shard',
  FLOATING_TEXT = 'floatingText',
}

export const POOL_CONFIG = {
  // Maximum number of entities to keep in each pool.
  // Sized against real gameplay ceilings (SPAWN_CONFIG.LIMITS.MAX_ENEMIES = 50):
  //   PROJECTILE       ~75  = 50 enemies × 1 projectile/enemy + 25 player shots in-flight
  //   ENEMY            ~200 = MAX_ENEMIES (50) + large buffer for rapid respawn cycling
  //   CHARGED_PROJECTILE ~30 = player fires ~1 charged shot at a time, burst max ~10
  //   SHARD            ~150 = mass kills drop many shards; 2× headroom
  //   FLOATING_TEXT    ~200 = 40-110+ damage numbers per frame during heavy beam/burn combat
  //   EFFECT           ~150 = particle effects overflow during beam + burn combos
  MAX_SIZES: {
    PROJECTILE: 75, // ~50 enemy projectiles + 25 player shots in-flight
    ENEMY: 200, // MAX_ENEMIES (50) + large buffer for rapid respawn cycling
    CHARGED_PROJECTILE: 30, // Player burst max ~10; never more than ~30 in-flight
    SHARD: 150, // Mass kills drop many shards; 2× headroom over original
    FLOATING_TEXT: 200, // 40-110+ damage numbers per frame during heavy combat
    EFFECT: 150, // Particle effects overflow during beam + burn combos
  },
  // Pool initialization settings
  INITIAL_SIZE: 0, // Start with empty pools
  GROW_BY: 10, // Number of entities to create when pool is empty
  // Pool performance tracking
  TRACK_METRICS: true,
  METRICS_LOG_INTERVAL_MS: 30000, // Log pool stats every 30 seconds
} as const;

// =============================================================================
// TIMING CONFIGURATION
// =============================================================================

export const TIMING_CONFIG: TimingConfig = {
  CURSE_EFFECTS: {
    ENEMY_SPAWN_MULTIPLIER_DURATION_MS: 15000,
    CURSE_ACTIVATION_INTERVAL_MS: 60000,
  },
  DEBUG_CONSOLE: {
    METRICS_UPDATE_INTERVAL_MS: 1500,
    AI_ANALYSIS_INTERVAL_MS: 8000,
    MOVEMENT_DETECTION_INTERVAL_MS: 100,
    STATE_UPDATE_INTERVAL_MS: 50,
    CHART_SETUP_DELAY_MS: 100,
    ALERT_CLEAR_DELAY_MS: 200,
    ANIMATION_DELAY_MS: 200,
  },
  COLLISION_IMMUNITY: {
    DURATION_MS: 500,
  },
  ANIMATION: {
    COSMETIC_CYCLE_DURATION_S: 1000,
  },
  UI_QUERY_SYSTEM: {
    UPDATE_INTERVAL_MS: 250, // Reduced from 50ms — 4/sec is plenty for health/XP display
  },
  HUD: {
    NOTIFICATION_TIMEOUT_MS: 3000,
  },
  INTRO_SCREEN: {
    WELCOME_ANIMATION_DELAY_MS: 300,
    INSTRUCTION_DELAY_MS: 100,
    TYPEWRITER_DELAY_MS: 50,
    INSTRUCTION_ANIMATION_DELAY_MS: 50,
    SECTION_DELAY_MS: 1000,
    RESET_DELAY_MS: 200,
  },
  CONTROLS: {
    BEAM_STOP_DELAY_MS: 50,
    ACTION_RESET_DELAY_MS: 100,
  },
  LOOP_SYSTEM: {
    FRAME_DELAY_MS: 16,
  },
} as const;

// =============================================================================
// BEAM COLLISION CONFIGURATION
// =============================================================================

// Shared beam configuration for visual/collision consistency
export const BEAM_CONSTANTS = {
  VISUAL_LENGTH: 200, // Fixed beam length in pixels - MUST be same in visual and collision
} as const;

export const BEAM_COLLISION_CONFIG = {
  BEAM: {
    DAMAGE: 10,
    LENGTH: BEAM_CONSTANTS.VISUAL_LENGTH, // Must match visual length for accurate collision
    WIDTH: 30,
    EFFECTIVE_WIDTH: 20, // Reduced from 120 to prevent area damage effect
    FALLBACK_RADIUS: 150, // Increased fallback for better hit rate
    MIN_DAMAGE_PER_HIT: 0.5, // Minimum damage to prevent 0 from rounding
    CLOSE_RANGE_RADIUS: 100, // Close range detection radius
    CLOSE_RANGE_CONE_ANGLE: Math.PI / 4, // 45 degree cone for close range
  },
  KNOCKBACK: {
    BASE_FORCE: 50.0, // Reduced by 20% from 62.5
    MAX_DAMAGE_MULTIPLIER: 2.0, // Reduced by 20% from 2.5
    DAMAGE_SCALING: 10.0, // Reduced by 20% from 12.5
    MIN_DISTANCE_MODIFIER: 0.375,
    MAX_DISTANCE_MODIFIER: 1.25,
    DISTANCE_THRESHOLD: 100,
    UPWARD_BIAS: 0.0625,
    FRICTION: 0.85,
    DEBUG_LOG_RATE: 0.1,
    DURATION_MS: 100,
  },
  DEBUG: {
    SYSTEM_LOG_RATE: 0.001, // Reduced from 0.1 to 0.001 (99.9% reduction)
    HIT_LOG_RATE: 0.0001, // Reduced from 0.05 to 0.0001 (99.8% reduction)
    SUMMARY_LOG_RATE: 0.01, // Reduced from 1.0 to 0.01 (99% reduction)
    BEAM_STATE_LOG_CHANCE: 0.02, // 2% chance = ~1 log per second at 60fps
    HIT_LOG_CHANCE: 0.1, // 10% chance to log hits
    DAMAGE_CALC_LOG_CHANCE: 0.05, // 5% chance to log damage calculation
    DAMAGE_APPLIED_LOG_CHANCE: 0.05, // 5% chance to log damage applied
  },
} as const;

// =============================================================================
// RENDERING CONFIGURATION
// =============================================================================

export const RENDER_CONFIG: {
  readonly EFFECTS: Record<string, number>;
  readonly BEAM: Record<string, number>;
  readonly SHIP: Record<string, number>;
  readonly TARGETING: Record<string, number>;
  readonly LINE_WIDTHS: LineWidths;
  readonly HEALTH_BAR: Record<string, number>;
  readonly PROJECTILE: Record<string, number>;
  readonly SHARD: Record<string, number>;
  readonly DEBUG: Record<string, number>;
  readonly COLORS: RenderColors;
} = {
  EFFECTS: {
    DISCHARGE_LINE_WIDTH: 2,
    HIT_EFFECT_DURATION_MS: 150,
    HIT_EFFECT_RADIUS_MULTIPLIER: 1.3,
  },
  BEAM: {
    DEFAULT_THICKNESS: 4,
    TARGETING_THICKNESS: 6,
    GLOW_THICKNESS_MULTIPLIER: 1.7,
    RANGE: 200,
  },
  SHIP: {
    DEFAULT_SIZE: 15,
    STAR_POINTS: 5,
    STAR_OUTER_RADIUS: 12,
    STAR_INNER_RADIUS: 6,
  },
  TARGETING: {
    INDICATOR_RADIUS: 16,
    ACTIVE_INDICATOR_RADIUS: 18,
    ROTATION_ARC_RADIUS: 24,
  },
  LINE_WIDTHS: {
    DEFAULT: 2,
    THICK: 3,
    THIN: 1,
    MINIMAP_BORDER: 2,
    NOTIFICATION_OUTLINE: 2,
  },
  HEALTH_BAR: {
    HEIGHT: 4,
    OFFSET_Y: 8,
  },
  PROJECTILE: {
    DEFAULT_RADIUS: 5,
  },
  SHARD: {
    TEXT_OFFSET_Y: 6,
  },
  DEBUG: {
    OVERLAY_LINE_WIDTH: 3,
  },
  COLORS: {
    PLAYER_FILL: 'rgba(255,255,255,0.3)',
    PLAYER_STROKE: 'rgba(255,255,255,0.8)',
    TARGETING_LINE: 'rgba(255,255,255,0.5)',
    BEAM_TARGETING: 'rgba(255,0,255,0.5)',
    BEAM_ACTIVE: 'rgba(0,255,255,0.7)',
    BEAM_ROTATION_ARC: 'rgba(0,255,255,0.4)',
    ENEMY_DEFAULT: '#ff0000',
    PROJECTILE: '#00ffff',
    SHARD_TEXT: '#ffffff',
    ASTEROID: '#666',
    HEALTH_BAR_BG: '#333',
    HEALTH_BAR_HIGH: '#4f4',
    HEALTH_BAR_MED: '#ff4',
    HEALTH_BAR_LOW: '#f44',
    NOTIFICATION_OUTLINE: '#000000',
    MINIMAP_BG: 'rgba(0, 0, 0, 0.85)',
    MINIMAP_BORDER: '#0ff',
    DEBUG_TEXT: '#00ff00',
    DEBUG_BG: 'rgba(0, 0, 0, 0.7)',
  },
} as const;

// =============================================================================
// ARRAY INDEX CONSTANTS
// =============================================================================

export const ARRAY_INDICES: ArrayIndices = {
  DEBUG_ARGS: {
    COMMAND: 0,
    DATA: 1,
    ADDITIONAL: 2,
  },
  COLOR_COMPONENTS: {
    RED: 1,
    GREEN: 2,
    BLUE: 3,
    FIRST_COLOR: 0,
  },
  COORDINATES: {
    X: 0,
    Y: 1,
  },
  POSITION: {
    FROM_X: 0,
    FROM_Y: 1,
    TO_X: 2,
    TO_Y: 3,
  },
} as const;

// =============================================================================
// NPC ABILITY CONFIGURATION
// =============================================================================

export const NPC_ABILITY_CONFIG = {
  // Check interval for ability usage
  ABILITY_CHECK_INTERVAL_MS: 100,

  // Shield Generation
  SHIELD: {
    DURATION_MS: 2000,
    COOLDOWN_MS: 10000,
  },

  // Area Buff
  AREA_BUFF: {
    RADIUS: 300,
    DAMAGE_MULTIPLIER: 1.2,
    DURATION_MS: 5000,
    COOLDOWN_MS: 15000,
  },

  // Area Heal
  AREA_HEAL: {
    RADIUS: 250,
    HEAL_PERCENTAGE: 0.1, // 10% of max health
    COOLDOWN_MS: 12000,
  },

  // Tentacle Grab
  TENTACLE_GRAB: {
    RANGE: 200,
    SLOW_FACTOR: 0.3, // 70% slow
    DURATION_MS: 2000,
    COOLDOWN_MS: 8000,
  },

  // Poison Cloud
  POISON_CLOUD: {
    DAMAGE_PER_TICK: 2,
    RADIUS: 50,
    DURATION_MS: 5000,
    COOLDOWN_MS: 10000,
  },

  // Burst Fire
  BURST_FIRE: {
    PROJECTILE_COUNT: 8,
    PROJECTILE_SPEED: 200,
    PROJECTILE_DAMAGE: 10,
    COOLDOWN_MS: 8000,
  },

  // Shell Retreat
  SHELL_RETREAT: {
    HEAL_PERCENTAGE: 0.05, // 5% of max health
    INVINCIBILITY_MS: 1500,
    COOLDOWN_MS: 15000,
  },

  // Charge Attack
  CHARGE_ATTACK: {
    SPEED: 500,
    DURATION_MS: 500,
    DAMAGE_MULTIPLIER: 2,
    RESET_DELAY_MS: 500,
    COOLDOWN_MS: 10000,
  },

  // Claw Slam
  CLAW_SLAM: {
    RANGE: 150,
    DAMAGE: 30,
    KNOCKBACK_FORCE: 300,
    COOLDOWN_MS: 18000, // 18 seconds (reduced frequency for cleaner UX)
  },

  // Enrage
  ENRAGE: {
    HEALTH_THRESHOLD: 0.3, // Triggers at 30% health
    SPEED_MULTIPLIER: 1.5,
    DAMAGE_MULTIPLIER: 1.5,
    DURATION_MS: 10000,
    COOLDOWN_MS: 30000, // Can only enrage once per 30s
  },

  // Lure Stun
  LURE_STUN: {
    RANGE: 180,
    PULL_SPEED: 150,
    DURATION_MS: 1500,
    COOLDOWN_MS: 20000,
  },

  // Prediction Shot
  PREDICTION_SHOT: {
    PREDICTION_TIME: 0.5, // Predict 0.5s ahead
    PROJECTILE_COUNT: 3,
    PROJECTILE_SPEED: 300,
    PROJECTILE_DAMAGE: 15,
    COOLDOWN_MS: 6000,
  },

  // Summon Minions (Elite Tank / Void Hermit)
  SUMMON_MINIONS: {
    MAX_ALIVE: 3,
    SPAWN_COUNT: 2, // attempt to spawn 2 per fire, but cap at MAX_ALIVE
    SPAWN_RADIUS: 60, // px from owner
    MINION_TYPE: 'swarm' as const,
  },

  // Teleport Blink (Elite Sniper / Disruptor)
  TELEPORT_BLINK: {
    COOLDOWN_MS: 5000,
    MIN_DISTANCE_FROM_PLAYER: 180,
    MAX_DISTANCE_FROM_PLAYER: 320,
    BLINK_DURATION_MS: 250,
  },
} as const;

// =============================================================================
// ARENA HAZARD CONFIGURATION (boss shockwave telegraph)
// =============================================================================

export const ARENA_HAZARD = {
  /** How long the entity persists after detonation before being destroyed (ms). */
  LINGER_MS: 250,
  /** Telegraph ring re-pulse cadence (ms). Matches the ~300ms ring animation so
   *  the danger zone stays continuously visible across the full telegraph window
   *  (red-team Finding 1). */
  PULSE_CADENCE_MS: 300,
  /** Standard boss — moderate radius and damage, default timing. */
  STANDARD: { RADIUS: 150, DAMAGE: 16, TELEGRAPH_MS: 900 },
  /** Swarm King — smaller radius, lightest damage, longest telegraph (player-friendly). */
  SWARM_KING: { RADIUS: 130, DAMAGE: 12, TELEGRAPH_MS: 1000 },
  /** Pyroclast — largest radius, hardest damage, fastest countdown. */
  PYROCLAST: { RADIUS: 180, DAMAGE: 22, TELEGRAPH_MS: 800 },
} as const;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Convert percentage to decimal
 */
export const percentage = (value: number): number => value / 100;
