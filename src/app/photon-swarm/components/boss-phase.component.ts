import { Component } from '../core/ecs/ecs.model';

/**
 * Named boss variants. Each archetype maps to a distinct phase-transition
 * curve while reusing the shared cooldown/speed multiplier system in
 * npc-ability-system (which only defines multipliers for phases 1-4 —
 * archetypes must cap at maxPhases <= 4 or risk falling back to phase-1
 * multipliers on the over-cap phase).
 */
export type BossArchetype = 'standard' | 'swarm_king' | 'pyroclast';

interface ArchetypeProfile {
  readonly maxPhases: number;
  readonly phaseThresholds: readonly number[];
}

const ARCHETYPE_PROFILES: Readonly<Record<BossArchetype, ArchetypeProfile>> = {
  // Standard — even quarters. Matches the original baseline.
  standard: { maxPhases: 4, phaseThresholds: [0.75, 0.5, 0.25] },
  // Swarm King — fewer, bigger phase gates. Long "enraged" phase 3 once
  // it hits 30% HP. Feels like a marathon late-game boss.
  swarm_king: { maxPhases: 3, phaseThresholds: [0.6, 0.3] },
  // Pyroclast — fast first escalation, then sustained pressure. Drops
  // into berserk early but the player gets more transitions to react to.
  pyroclast: { maxPhases: 4, phaseThresholds: [0.85, 0.65, 0.4] },
};

/**
 * Per-archetype tint applied as a translucent overlay over the boss sprite.
 * Without this the three archetypes looked identical at the draw level and
 * the "named bosses" promise read as marketing. Each tint is paired with
 * the archetype's flavor — standard keeps the canonical hue, swarm king
 * reads green like its faction-spawn role, pyroclast reads molten red.
 */
export const BOSS_ARCHETYPE_TINTS: Readonly<Record<BossArchetype, string | null>> = {
  standard: null, // No overlay — preserves the faction-derived hue
  swarm_king: 'rgba(60, 200, 110, 0.32)', // Verdant overlay
  pyroclast: 'rgba(255, 110, 30, 0.34)', // Molten overlay
};

/**
 * Boss Phase Component - Tracks boss fight phase transitions based on health thresholds.
 *
 * Phases modify boss behavior (cooldowns, speed, aggression) via multipliers
 * applied at update time, keeping base stats intact for the existing system.
 *
 * Generic enough to reuse for mini-bosses by varying maxPhases and thresholds,
 * or by passing a named archetype.
 */
export class BossPhaseComponent implements Component {
  /** Current phase (1-indexed). Phase 1 = full health, higher = more desperate. */
  public currentPhase: number;

  /** Total number of phases this boss has. */
  public maxPhases: number;

  /** Health percentage thresholds that trigger phase transitions (descending). */
  public phaseThresholds: number[];

  /** Named archetype the component was constructed from (for telemetry + debug). */
  public archetype: BossArchetype;

  /** Timestamp of the last phase transition (Date.now()). */
  public lastPhaseTransition: number;

  /** True while the boss is mid-transition (brief invincibility window). */
  public phaseTransitioning: boolean;

  /** Cooldown multiplier for the current phase (1.0 = normal, lower = faster). */
  public cooldownMultiplier: number;

  /** Speed multiplier for the current phase (1.0 = normal, higher = faster). */
  public speedMultiplier: number;

  /** Base speed captured at creation for multiplier calculations. */
  public baseSpeed: number;

  /** Original ability cooldowns captured at creation, keyed by ability index. */
  public baseCooldowns: number[];

  /** Base weapon fire rate captured at creation for phase multiplier calculations. */
  public baseFireRate: number;

  constructor(...args: unknown[]) {
    // ECS contract: constructor MUST stay `(...args: unknown[])` — typed
    // params would break ComponentType<T>. The ECS factory requires this signature.
    // args[0]=currentPhase, args[1]=maxPhases, args[2]=phaseThresholds, args[3]=archetype.
    // When args[3] is a known archetype, it supplies defaults for [1] and [2]
    // unless those were passed explicitly.
    const requestedArchetype = args[3];
    this.archetype =
      typeof requestedArchetype === 'string' && requestedArchetype in ARCHETYPE_PROFILES
        ? (requestedArchetype as BossArchetype)
        : 'standard';
    const profile = ARCHETYPE_PROFILES[this.archetype];

    this.currentPhase = (args[0] as number) ?? 1;
    // Clamp explicit maxPhases to <=4 — npc-ability-system.setPhaseMultipliers
    // only defines multipliers for phases 1-4, so phase 5+ silently falls
    // back to phase-1 multipliers (weaker than phase 4). Phase 10 hardening.
    const requestedMax = (args[1] as number) ?? profile.maxPhases;
    this.maxPhases = Math.min(requestedMax, 4);
    this.phaseThresholds = (args[2] as number[]) ?? [...profile.phaseThresholds];
    this.lastPhaseTransition = 0;
    this.phaseTransitioning = false;
    this.cooldownMultiplier = 1.0;
    this.speedMultiplier = 1.0;
    this.baseSpeed = 0;
    this.baseCooldowns = [];
    this.baseFireRate = 0;
  }
}
