import { Component } from '../core/ecs/ecs.model';
import { FACTION_IDENTITIES } from '../config/faction-identity.config';

/**
 * Faction Component - associates entities with one of the Four Kings
 */
export class FactionComponent implements Component {
  public kingId: number; // 1=Crimson, 2=Azure, 3=Verdant, 4=Shadow
  public kingName: string;
  public loyalty: number; // 0-1, how loyal this entity is to their faction
  public aggressionLevel: number; // Faction-specific aggression modifier
  public colors: FactionColors;
  public behaviors: FactionBehavior[];
  public hostileFactions: number[]; // Which factions this entity is hostile to

  constructor(...args: unknown[]) {
    this.kingId = (args[0] as number) ?? 0;
    this.kingName = (args[1] as string) ?? '';
    this.loyalty = (args[2] as number) ?? 1.0;
    this.aggressionLevel = (args[3] as number) ?? 1.0;
    this.colors = (args[4] as FactionColors) ?? { primary: '#ffffff', secondary: '#ffffff', glow: '#ffffff' };
    this.behaviors = (args[5] as FactionBehavior[]) ?? [];
    this.hostileFactions = (args[6] as number[]) ?? [];
  }

  /**
   * Check if this faction is hostile to another
   */
  isHostileTo(otherKingId: number): boolean {
    return this.hostileFactions.includes(otherKingId);
  }

  /**
   * Get faction-specific behavior modifier
   */
  getBehaviorModifier(behaviorType: string): number {
    const behavior = this.behaviors.find((b) => b.type === behaviorType);
    return behavior ? behavior.modifier : 1.0;
  }
}

/**
 * Faction color scheme
 */
export interface FactionColors {
  primary: string; // Main body color
  secondary: string; // Accent color
  glow: string; // Glow/effect color
}

/**
 * Faction-specific behavior modifier
 */
export interface FactionBehavior {
  type: 'speed' | 'damage' | 'health' | 'aggro_range' | 'formation' | 'special_ability';
  modifier: number; // Multiplier for this behavior
  description: string;
}

/**
 * Faction definitions for the Four Kings
 */
export const FACTION_DEFINITIONS = {
  CRIMSON_KING: {
    id: FACTION_IDENTITIES[1].id,
    name: FACTION_IDENTITIES[1].name,
    kingName: FACTION_IDENTITIES[1].kingName,
    colors: {
      primary: FACTION_IDENTITIES[1].dark.sprite.primary,
      secondary: FACTION_IDENTITIES[1].dark.sprite.secondary,
      glow: FACTION_IDENTITIES[1].dark.sprite.glow,
    },
    defaultBehaviors: [
      {
        type: 'damage' as const,
        modifier: 1.2, // +20% damage
        description: 'Crimson warriors strike with devastating force',
      },
      {
        type: 'aggro_range' as const,
        modifier: 1.5, // +50% aggro range
        description: 'Highly aggressive, engage from greater distances',
      },
      {
        type: 'speed' as const,
        modifier: 1.1, // +10% speed
        description: 'Rush tactics and berserker charges',
      },
    ],
    aggressionLevel: 1.4,
    hostileFactions: [2, 3, 4], // Hostile to all other factions
    description: 'Berserker warriors who value strength above all. Aggressive and brutal in combat.',
  },

  AZURE_KING: {
    id: FACTION_IDENTITIES[2].id,
    name: FACTION_IDENTITIES[2].name,
    kingName: FACTION_IDENTITIES[2].kingName,
    colors: {
      primary: FACTION_IDENTITIES[2].dark.sprite.primary,
      secondary: FACTION_IDENTITIES[2].dark.sprite.secondary,
      glow: FACTION_IDENTITIES[2].dark.sprite.glow,
    },
    defaultBehaviors: [
      {
        type: 'health' as const,
        modifier: 1.3, // +30% health
        description: 'Azure guardians are exceptionally resilient',
      },
      {
        type: 'formation' as const,
        modifier: 1.2, // Better formation fighting
        description: 'Fight in coordinated defensive formations',
      },
      {
        type: 'speed' as const,
        modifier: 0.9, // -10% speed
        description: 'Methodical and defensive approach',
      },
    ],
    aggressionLevel: 0.7,
    hostileFactions: [1, 4], // Only hostile to Crimson and Shadow
    description: 'Defensive protectors who prioritize survival and coordination over aggression.',
  },

  VERDANT_KING: {
    id: FACTION_IDENTITIES[3].id,
    name: FACTION_IDENTITIES[3].name,
    kingName: FACTION_IDENTITIES[3].kingName,
    colors: {
      primary: FACTION_IDENTITIES[3].dark.sprite.primary,
      secondary: FACTION_IDENTITIES[3].dark.sprite.secondary,
      glow: FACTION_IDENTITIES[3].dark.sprite.glow,
    },
    defaultBehaviors: [
      {
        type: 'special_ability' as const,
        modifier: 1.5, // Enhanced regeneration
        description: 'Verdant creatures can regenerate health over time',
      },
      {
        type: 'formation' as const,
        modifier: 0.7, // Weaker individual formation
        description: 'Rely on swarm tactics rather than formation',
      },
      {
        type: 'speed' as const,
        modifier: 1.15, // +15% speed
        description: 'Swift and organic movement patterns',
      },
    ],
    aggressionLevel: 1.0,
    hostileFactions: [1], // Only hostile to Crimson
    description: 'Nature-aligned entities that fight in swarms and can regenerate. Organic and adaptive.',
  },

  SHADOW_KING: {
    id: FACTION_IDENTITIES[4].id,
    name: FACTION_IDENTITIES[4].name,
    kingName: FACTION_IDENTITIES[4].kingName,
    colors: {
      primary: FACTION_IDENTITIES[4].dark.sprite.primary,
      secondary: FACTION_IDENTITIES[4].dark.sprite.secondary,
      glow: FACTION_IDENTITIES[4].dark.sprite.glow,
    },
    defaultBehaviors: [
      {
        type: 'special_ability' as const,
        modifier: 1.3, // Enhanced stealth/ambush
        description: 'Shadow operatives can briefly become invisible',
      },
      {
        type: 'speed' as const,
        modifier: 1.25, // +25% speed
        description: 'Lightning-fast hit-and-run tactics',
      },
      {
        type: 'health' as const,
        modifier: 0.8, // -20% health
        description: 'Glass cannons - fast but fragile',
      },
    ],
    aggressionLevel: 1.1,
    hostileFactions: [1, 2], // Hostile to Crimson and Azure
    description: 'Stealthy assassins who strike from the shadows. Fast but fragile.',
  },
} as const;

/**
 * Helper function to create a faction component for an entity
 */
export function createFactionComponent(kingId: number): FactionComponent | null {
  const factionData = Object.values(FACTION_DEFINITIONS).find((f) => f.id === kingId);
  if (!factionData) return null;

  return new FactionComponent(
    factionData.id,
    factionData.kingName,
    1.0, // Full loyalty
    factionData.aggressionLevel,
    factionData.colors,
    [...factionData.defaultBehaviors],
    [...factionData.hostileFactions]
  );
}
