import { AlertState, EnemyId, Point, Rarity, TerritoryId, Vector } from './common.model';
export { Rarity, AlertState } from './common.model';

// Base interfaces for composition
export interface EntityBase {
  id?: EnemyId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export interface HealthData {
  health: number;
  maxHealth: number;
  baseMaxHealth?: number;
}

export interface CombatData {
  damageMultiplier?: number;
  damageReduction?: number;
  baseDamage?: number;
}

export interface RarityData {
  rarity?: Rarity;
  shardMultiplier?: number;
  baseShardValue?: number;
  isElite?: boolean;
}

export interface WeaponData {
  lastShotTime?: number;
  shotCooldown?: number;
  firingChargedShot?: boolean;
  specialAttackCooldown?: number;
  lastSpecialAttack?: number;
  lastDischargeTime?: number;
}

export interface MovementData {
  speed?: number;
  lastMovementChange?: number;
  movementSeed?: number;
  movementConsistency?: number;
  wanderDirection?: Vector;
  wanderTarget?: Point;
  lastWanderChange?: number;
  lastFlockUpdate?: number;
}

export interface BehaviorData {
  behaviorPattern?: 'idle' | 'direct' | 'flank' | 'orbit' | 'retreat' | 'wander' | 'grouping' | 'sentinel';
  preferredBehavior?: 'direct' | 'flank' | 'orbit' | 'retreat';
  forcedBehavior?: boolean;
  alertState?: AlertState;
  idleStartTime?: number;
  idleDuration?: number;
  lastPlayerInteraction?: number;
}

/** Sentinel shield arc data cached from ShieldArcComponent for the render pipeline. */
export interface ShieldArcRenderData {
  /** Current facing angle toward player (radians). */
  facingAngle: number;
  /** Half-arc angle (arcAngle / 2) in radians. */
  halfArc: number;
  /** Timestamp of last blocked hit — drives shield flash effect. */
  lastBlockTime: number;
}

export interface EffectData {
  burning?: boolean;
  burnStartTime?: number;
  burnDuration?: number;
  burnEndTime?: number;
  burnDamage?: number;
  burnVisualIntensity?: number;
  lastBurnTick?: number;
}

export interface FocusData {
  isFocusing?: boolean;
  focusStartTime?: number;
  focusDirection?: Vector;
  pulsePhase?: number;
}

export interface DashData {
  lastDashTime?: number;
  isDashing?: boolean;
  dashTelegraphing?: boolean;
  dashDirection?: Vector;
  dashStartTime?: number;
}

export interface UpgradeData {
  upgradeStage?: number;
  isUpgrading?: boolean;
  upgradeProgress?: number;
  upgradeStartTime?: number;
  upgradeInterval?: number;
}

export interface EliteData {
  eliteStatus?: boolean;
  isChampion?: boolean;
  miniBossType?: string;
}

export interface RankData {
  rankLevel?: number;
  rankPoints?: number;
  isDancing?: boolean;
  danceTargetId?: EnemyId;
  danceStartTime?: number;
  danceStage?: 'bounce' | 'spin';
  danceComplete?: boolean;
  spinAngle?: number;
  spinSpeed?: number;
}

export interface MiscData {
  color?: string;
  isSplit?: boolean;
  territoryId?: TerritoryId | null;
}

/** Boss phase data cached from BossPhaseComponent for the render pipeline. */
export interface BossPhaseRenderData {
  /** Current phase (1-indexed). */
  currentPhase: number;
  /** Total phases. */
  maxPhases: number;
  /** Health percentage thresholds that mark phase boundaries (descending, e.g. [0.75, 0.5, 0.25]). */
  phaseThresholds: number[];
  /** True while the boss is mid-transition (brief invincibility window). */
  phaseTransitioning: boolean;
  /**
   * Named archetype — drives the visual tint applied at draw time. Without
   * this, the three archetypes looked identical, which made the "named bosses"
   * promise feel hollow during review.
   */
  archetype: 'standard' | 'swarm_king' | 'pyroclast';
}

// Visual effect cache data populated during rendering pipeline
// These are pre-computed from ECS components in RenderingSystemService.getEnemies()
// to eliminate per-frame component lookups in the render loop
export interface VisualEffectCacheData {
  isKnockedBack?: boolean;
  hitFlashIntensity?: number;
  factionId?: number;
  isInNpcCombat?: boolean;
  /** Populated for boss entities — drives the boss health bar and phase indicator. */
  bossPhaseData?: BossPhaseRenderData;
  /** Populated for sentinel entities — drives the shield arc overlay. */
  shieldArcData?: ShieldArcRenderData;
}

// Main Enemy interface composed from smaller interfaces
export interface Enemy
  extends
    EntityBase,
    HealthData,
    CombatData,
    RarityData,
    WeaponData,
    MovementData,
    BehaviorData,
    EffectData,
    FocusData,
    DashData,
    UpgradeData,
    EliteData,
    RankData,
    MiscData,
    VisualEffectCacheData {
  type: EnemyType;
}

export const enum EnemyType {
  Basic = 'basic',
  Spitter = 'spitter',
  Tank = 'tank',
  Swarm = 'swarm',
  Thug = 'thug',
  Sniper = 'sniper',
  Boss = 'boss',
  Disruptor = 'disruptor',
  Sentinel = 'sentinel',
}

export interface EnemyInfo {
  type: EnemyType;
  name: string;
  minLevel: number;
  health: number;
  speed: string;
  xpValue: number;
  description: string;
}
