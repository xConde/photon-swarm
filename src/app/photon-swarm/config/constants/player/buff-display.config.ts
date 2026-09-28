/**
 * Buff display configuration — single source of truth for buff names and colors.
 * Used by HUD and any future UI that needs to render buff information.
 */

export const BUFF_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  damage_boost: 'DMG +',
  damage_boost_2x: 'DMG ++',
  damage_boost_3x: 'FURY',
  critical_surge: 'CRIT',
  rapid_fire: 'FIRE RATE',
  shield: 'SHIELD',
  regeneration: 'REGEN',
  speed_boost: 'SPEED',
  experience_boost: 'XP +',
  slow: 'SLOWED',
  weakness: 'WEAK',
};

export const BUFF_COLORS: Readonly<Record<string, string>> = {
  damage_boost: '#ff4444',
  damage_boost_2x: '#ff6600',
  damage_boost_3x: '#ff0000',
  critical_surge: '#ffaa00',
  rapid_fire: '#ffff44',
  shield: '#44ff88',
  regeneration: '#00ff88',
  speed_boost: '#44aaff',
  experience_boost: '#aa44ff',
  slow: '#8888aa',
  weakness: '#aa8888',
};
