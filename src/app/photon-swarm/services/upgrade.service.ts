import { Injectable, OnDestroy } from '@angular/core';
import { GameEngineService } from '../core/engine/game-engine.service';
import type { RunBuildEntry, UpgradeOption } from '../core/models/upgrade.model';
import { DebugLogBridgeService } from '../core/debug/debug-log-bridge.service';
import { VisualFeedbackCoordinatorService } from '../core/services/visual-feedback-coordinator.service';
import { CameraShakeService } from '../core/effects/camera-shake.service';
import { PostProcessingService } from '../core/effects/post-processing.service';
import { Curse, CurseService } from './curse.service';
import { RandomService } from '../core/utils/random.service';
import { BEAM_CORE_IDS } from '../config/beam-core.config';
import { getConfiguredBuildTags } from '../config/upgrade-build-tags.config';
import type { BeamCoreId, BuildTag } from '../core/models/run-build.model';
import { UPGRADE_CATALOG } from '../config/upgrade-catalog.config';

/* ───── service ─────────────────────────────────────────────────────── */
@Injectable({ providedIn: 'root' })
export class UpgradeService implements OnDestroy {
  private readonly upgradeCounts: Record<string, number> = {};
  private readonly MAX_STACKS: Record<string, number> = {
    beam_core_lance: 1,
    beam_core_prism: 1,
    beam_core_arc: 1,
    // Core tier upgrades - high stack limits for steady progression
    core_speed: 10,
    core_power: 10,
    core_shield: 10,
    core_magnet: 10,
    // Beam rotation capped at 200% increase (5 stacks)
    beam_rotation: 5,
    double_beam: 1,
    discharge: 1,
    health_regen: 3,
    fire_rate_boost: 5,
    dash_efficiency: 2,
    kinetic_amplifier: 5,
    emergency_protocols: 3,
    beam_speed: 5,
    velocity_matrix: 3,
    surgical_precision: 3,
    burn_chance: 5,
    glass_cannon: 3,
    berserker_protocol: 1,
    shield_breaker: 5,
    // Burn spread: 3 stacks (15% → 25% → 35% chance per tick)
    burn_spread: 3,
    // Legendaries are single-pick capstones gated behind deep build commitment
    cataclysm_core: 1,
    pyriphlegethon: 1,
    aegis_prime: 1,
    mach_reactor: 1,
    beam_singularity: 1,
    starforge_nova: 1,
    // Blessings are single-pick risk-reward bonuses - stacking them defeats
    // the design intent (Solar Flare ×10 = +150% beam damage from one tier).
    astral_aegis: 1,
    quickening: 1,
    magnetars_touch: 1,
    verdant_ward: 1,
    solar_flare: 1,
    // Curses are single-pick by symmetry with blessings - stacking would
    // compound negatives (HP loss, vulnerability) into instant death.
    vulnerability: 1,
    aether_drain: 1,
    hollow_hull: 1,
    burning_marrow: 1,
    glass_veil: 1,
    sluggish_reactor: 1,
    phantom_echo: 1,
    // Default max stack limit for most upgrades
    default: 10,
  };

  constructor(
    private debugLog: DebugLogBridgeService,
    private visualFeedback: VisualFeedbackCoordinatorService,
    private cameraShake: CameraShakeService,
    private postProcessing: PostProcessingService,
    private curseService: CurseService,
    private random: RandomService
  ) {
    // Don't load upgrades on construction - roguelike games reset on death
    // Upgrades are only for the current run
  }

  // Keep the authored catalog immutable across service/test instances while
  // preserving the extension seam used by checkpoint-failure tests.
  public readonly upgradeOptions: UpgradeOption[] = [...UPGRADE_CATALOG];

  /* public ────────────┐ */
  resetCounts(): void {
    const previousCounts = { ...this.upgradeCounts };
    const totalUpgrades = Object.keys(previousCounts).length;

    Object.keys(this.upgradeCounts).forEach((k) => delete this.upgradeCounts[k]);

    // Log upgrade reset
    this.debugLog.log('🔄 Upgrade counts reset', 'warning', {
      source: 'upgrade_service',
      operation: 'reset_counts',
      previousCounts,
      totalUpgradesReset: totalUpgrades,
    });
  }
  getCount(id: string): number {
    return this.upgradeCounts[id] ?? 0;
  }
  incCount(id: string): number {
    this.upgradeCounts[id] = this.getCount(id) + 1;
    return this.upgradeCounts[id];
  }

  get selectable(): UpgradeOption[] {
    return this.upgradeOptions.filter(
      (u) =>
        u.type === 'upgrade' &&
        u.category !== 'relic' &&
        u.category !== 'route' &&
        u.category !== 'anomaly' &&
        this.prereqsMet(u) &&
        this.canStack(u.id) &&
        !this.conflictsWithOwnedCard(u)
    );
  }
  get curses(): UpgradeOption[] {
    return this.upgradeOptions.filter((u) => u.type === 'curse' || u.type === 'blessing');
  }

  getRandomUpgrades(count = 3, withCurses = false): UpgradeOption[] {
    return this.draw(count, withCurses);
  }

  getRunRouteOptions(): UpgradeOption[] {
    return this.shuffle(
      this.upgradeOptions.filter(
        (card) => card.category === 'route' && this.canStack(card.id) && !this.conflictsWithOwnedCard(card)
      )
    );
  }

  drawRelics(count = 3): UpgradeOption[] {
    const available = this.upgradeOptions.filter(
      (card) => card.category === 'relic' && this.canStack(card.id) && !this.conflictsWithOwnedCard(card)
    );
    if (available.length <= count) return this.shuffle(available);

    const activeTags = this.getActiveBuildTags();
    const matching = available.filter((card) => card.buildTags?.some((tag) => activeTags.has(tag)) ?? false);
    const picks: UpgradeOption[] = [];
    if (matching.length > 0) picks.push(this.shuffle(matching)[0]);

    for (const card of this.shuffle(available)) {
      if (picks.length >= count) break;
      if (!picks.some((pick) => pick.id === card.id)) picks.push(card);
    }
    return this.shuffle(picks);
  }

  drawAnomalies(count = 3): UpgradeOption[] {
    return this.shuffle(
      this.upgradeOptions.filter(
        (card) => card.category === 'anomaly' && this.canStack(card.id) && !this.conflictsWithOwnedCard(card)
      )
    ).slice(0, count);
  }

  getOwnedAnomalyCount(): number {
    return this.upgradeOptions.reduce(
      (total, card) => total + (card.category === 'anomaly' && this.getCount(card.id) > 0 ? 1 : 0),
      0
    );
  }

  /**
   * Pulls `count` random, unique cards from the weighted pool.
   * Blessings/curses are legacy explicit draws only. Normal level-up offers
   * remain build decisions; irreversible risk belongs to sector anomalies.
   */
  draw(count: number, withCurses = false): UpgradeOption[] {
    const unboundCores = this.upgradeOptions.filter(
      (card) => card.category === 'beam-core' && this.getCount(card.id) === 0
    );
    if (!this.getActiveBeamCoreId() && count >= BEAM_CORE_IDS.length && unboundCores.length === BEAM_CORE_IDS.length) {
      return this.shuffle(unboundCores);
    }

    const pool = this.weightedPool(withCurses);
    const picks: UpgradeOption[] = [];
    const attemptedPicks: string[] = [];

    // A three-card offer is a decision, not a slot machine: establish one
    // foundation, surface one reachable build evolution, then leave one true
    // wildcard. Smaller/nonstandard draws retain weighted behavior.
    if (count >= 3) {
      this.pickFromLane(
        pool,
        picks,
        attemptedPicks,
        this.selectable.filter((card) => card.rarity === 'core')
      );
      const evolutions = this.selectable.filter((card) => this.isReachableEvolution(card));
      const stackableCommitments = this.selectable.filter((card) => this.getCount(card.id) > 0);
      const specializationFallback = this.selectable.filter((card) => card.rarity === 'uncommon');
      this.pickFromLane(
        pool,
        picks,
        attemptedPicks,
        evolutions.length > 0
          ? evolutions
          : stackableCommitments.length > 0
            ? stackableCommitments
            : specializationFallback
      );
    }

    while (picks.length < count && pool.length) {
      const idx = Math.floor(this.random.random() * pool.length);
      const card = pool.splice(idx, 1)[0];
      attemptedPicks.push(card.id);

      if (!picks.find((p) => p.id === card.id) && this.prereqsMet(card) && this.canStack(card.id)) {
        picks.push(card);
      }
    }

    // Log card draw results
    this.debugLog.log(`🎲 Drew ${picks.length} upgrade options`, 'info', {
      source: 'upgrade_service',
      operation: 'draw_upgrades',
      requestedCount: count,
      drawnCount: picks.length,
      withCurses,
      drawnCards: picks.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        rarity: p.rarity,
        stacks: this.getCount(p.id),
      })),
      poolSize: pool.length + picks.length,
      attemptedPicks: attemptedPicks.length,
    });

    return this.shuffle(picks);
  }

  /** Apply a chosen card inside an engine-state transaction. */
  apply(card: UpgradeOption, engine: GameEngineService): boolean {
    const previousStacks = this.getCount(card.id);

    // Draw eligibility is not an authorization boundary. A stale modal, rapid
    // second selection, or direct caller must not bypass branch exclusivity or
    // install an evolution whose prerequisites are no longer valid.
    const prerequisitesMet = this.prereqsMet(card);
    const exclusiveConflict = this.conflictsWithOwnedCard(card);
    const invalidEvolution = card.category === 'mutation' && !prerequisitesMet;
    if (invalidEvolution || exclusiveConflict) {
      this.debugLog.log(`Rejected ineligible upgrade: ${card.name}`, 'warning', {
        source: 'upgrade_service',
        operation: 'ineligible_upgrade_rejected',
        upgradeId: card.id,
        prerequisitesMet,
        exclusiveConflict,
      });
      return false;
    }

    // Check stack limit before applying
    if (!this.canStack(card.id)) {
      this.debugLog.log(`⚠️ Max stacks reached for ${card.name}`, 'warning', {
        source: 'upgrade_service',
        operation: 'max_stacks_reached',
        upgradeId: card.id,
        currentStacks: previousStacks,
        maxStacks: this.getMaxStacks(card.id),
      });
      return false;
    }

    const stacks = previousStacks + 1;

    // Log upgrade application
    this.debugLog.log(
      `🎯 Applying ${card.type}: ${card.name}`,
      card.type === 'curse' || card.type === 'blessing' ? 'warning' : 'success',
      {
        source: 'upgrade_service',
        operation: 'apply_upgrade',
        upgradeId: card.id,
        upgradeName: card.name,
        upgradeType: card.type,
        rarity: card.rarity,
        previousStacks,
        newStacks: stacks,
        description: card.description,
        prerequisites: card.prerequisites || [],
        severity: card.severity || 'none',
      }
    );

    let snapshot: ReturnType<GameEngineService['captureUpgradeTransaction']>;
    try {
      snapshot = engine.captureUpgradeTransaction();
    } catch (error) {
      this.debugLog.log(`❌ Failed to apply upgrade: ${card.name}`, 'error', {
        source: 'upgrade_service',
        operation: 'upgrade_snapshot_failed',
        upgradeId: card.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    try {
      card.effect(engine, stacks, 'acquire');
      this.registerCurse(card);
      this.upgradeCounts[card.id] = stacks;
    } catch (error) {
      let rollbackError: unknown;
      try {
        engine.restoreUpgradeTransaction(snapshot);
      } catch (restoreError) {
        rollbackError = restoreError;
      }

      if (previousStacks === 0) {
        delete this.upgradeCounts[card.id];
      } else {
        this.upgradeCounts[card.id] = previousStacks;
      }

      this.debugLog.log(`❌ Failed to apply upgrade: ${card.name}`, 'error', {
        source: 'upgrade_service',
        operation: rollbackError ? 'upgrade_rollback_failed' : 'upgrade_rolled_back',
        upgradeId: card.id,
        error: error instanceof Error ? error.message : String(error),
        rollbackError:
          rollbackError instanceof Error
            ? rollbackError.message
            : rollbackError
              ? 'Rollback failed with an unknown error'
              : undefined,
      });
      return false;
    }

    // Gameplay state is committed before best-effort cosmetic feedback.
    this.showApplicationFeedback(card);

    this.debugLog.log(`✅ Successfully applied: ${card.name}`, 'info', {
      source: 'upgrade_service',
      operation: 'upgrade_applied',
      upgradeId: card.id,
      stacks,
      maxStacks: this.getMaxStacks(card.id),
      totalUpgrades: Object.keys(this.upgradeCounts).length,
    });

    return true;
  }
  /* ──────────────────┘ */

  /* helpers ─────────────────────────────────────────────────────────── */
  private showApplicationFeedback(card: UpgradeOption): void {
    try {
      this.visualFeedback.showUpgrade(card.name, card.description, card.type, card.rarity);
      this.cameraShake.addShake({ intensity: 5, duration: 150 });
      this.postProcessing.addChromaticAberration(PostProcessingService.PRESETS.MEDIUM_DAMAGE);
    } catch (error) {
      this.debugLog.log(`Upgrade feedback failed after committing ${card.name}`, 'warning', {
        source: 'upgrade_service',
        operation: 'upgrade_feedback_failed',
        upgradeId: card.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private registerCurse(card: UpgradeOption): void {
    if (card.type !== 'curse') return;

    const curse: Curse = {
      id: card.id,
      name: card.name,
      description: card.description,
      hiddenEffect: card.hiddenEffect,
      severity: card.severity ?? 'low',
      active: true,
    };
    if (!this.curseService.addCurse(curse)) {
      throw new Error(`Curse registration rejected for ${card.id}`);
    }
  }

  private prereqsMet(u: UpgradeOption): boolean {
    const anyPrerequisiteMet = !u.prerequisites?.length || u.prerequisites.some((id) => this.getCount(id) > 0);
    const allPrerequisitesMet = !u.requiresAll?.length || u.requiresAll.every((id) => this.getCount(id) > 0);
    const tagsMet = !u.requiresTags?.length || this.hasActiveBuildTags(u.requiresTags);
    const activeCore = this.getActiveBeamCoreId();
    const coreCompatible =
      !u.compatibleCores?.length || (activeCore !== null && u.compatibleCores.includes(activeCore));
    return anyPrerequisiteMet && allPrerequisitesMet && tagsMet && coreCompatible;
  }

  getActiveBuildTags(): ReadonlySet<BuildTag> {
    const tags = new Set<BuildTag>();
    for (const option of this.upgradeOptions) {
      if (this.getCount(option.id) <= 0) continue;
      for (const tag of option.buildTags ?? getConfiguredBuildTags(option.id)) tags.add(tag);
    }
    return tags;
  }

  private hasActiveBuildTags(requiredTags: readonly BuildTag[]): boolean {
    const activeTags = this.getActiveBuildTags();
    return requiredTags.every((tag) => activeTags.has(tag));
  }

  private isReachableEvolution(card: UpgradeOption): boolean {
    if (card.category === 'mutation') return true;
    if (card.prerequisites?.some((id) => this.getCount(id) > 0)) return true;
    return card.requiresAll?.some((id) => this.getCount(id) > 0) ?? false;
  }

  getActiveBeamCoreId(): BeamCoreId | null {
    for (const coreId of BEAM_CORE_IDS) {
      if (this.getCount(`beam_core_${coreId}`) > 0) return coreId;
    }
    return null;
  }

  private conflictsWithOwnedCard(card: UpgradeOption): boolean {
    if (!card.exclusiveGroup) return false;
    return this.upgradeOptions.some(
      (candidate) =>
        candidate.id !== card.id && candidate.exclusiveGroup === card.exclusiveGroup && this.getCount(candidate.id) > 0
    );
  }

  private weightedPool(withCurses: boolean): UpgradeOption[] {
    const add = (arr: UpgradeOption[], weight: number, dst: UpgradeOption[]): void =>
      Array.from({ length: weight }).forEach(() => dst.push(...arr));

    const pool: UpgradeOption[] = [];
    const up = this.selectable;
    const cur = withCurses ? this.curses : [];

    // CORE tier (~40%): Simple upgrades still appear often but don't dominate
    add(
      up.filter((u) => u.rarity === 'core'),
      8,
      pool
    );
    // UNCOMMON tier (~35%): Advanced upgrades appear frequently for build variety
    add(
      up.filter((u) => u.rarity === 'uncommon'),
      7,
      pool
    );
    // RARE tier (~15%): Powerful upgrades with prerequisites
    add(
      up.filter((u) => u.rarity === 'rare'),
      3,
      pool
    );
    // EPIC tier: Game-changing upgrades
    add(
      up.filter((u) => u.rarity === 'epic'),
      1,
      pool
    );
    // LEGENDARY tier: Build-defining upgrades
    add(
      up.filter((u) => u.rarity === 'legendary'),
      1,
      pool
    );
    // Curses should be rare and impactful
    add(cur, 1, pool);

    return pool;
  }

  private shuffle<T>(a: T[]): T[] {
    const res = [...a];
    for (let i = res.length - 1; i > 0; i--) {
      const j = (this.random.random() * (i + 1)) | 0;
      [res[i], res[j]] = [res[j], res[i]];
    }
    return res;
  }

  private pickFromLane(
    weightedPool: UpgradeOption[],
    picks: UpgradeOption[],
    attemptedPicks: string[],
    candidates: readonly UpgradeOption[]
  ): void {
    const available = candidates.filter((card) => !picks.some((pick) => pick.id === card.id));
    if (available.length === 0) return;
    const card = available[Math.floor(this.random.random() * available.length)];
    picks.push(card);
    attemptedPicks.push(card.id);
    for (let index = weightedPool.length - 1; index >= 0; index--) {
      if (weightedPool[index].id === card.id) weightedPool.splice(index, 1);
    }
  }

  public ngOnDestroy(): void {
    // Don't save upgrades - roguelike games reset on death
  }

  /**
   * Reset all upgrades (called on player death/new game)
   * This is essential for roguelike gameplay
   */
  public resetAllUpgrades(): void {
    // Clear all upgrade counts
    Object.keys(this.upgradeCounts).forEach((key) => delete this.upgradeCounts[key]);

    this.debugLog.log('🔄 All upgrades reset (roguelike death)', 'info', {
      source: 'upgrade_service',
      operation: 'reset_all_upgrades',
      reason: 'player_death_or_new_game',
    });
  }

  /**
   * Get max stack limit for an upgrade
   */
  private getMaxStacks(upgradeId: string): number {
    const category = this.upgradeOptions.find((option) => option.id === upgradeId)?.category;
    if (category === 'mutation' || category === 'relic' || category === 'route' || category === 'anomaly') return 1;
    return this.MAX_STACKS[upgradeId] ?? this.MAX_STACKS['default'];
  }

  /**
   * Check if upgrade can be stacked
   */
  public canStack(upgradeId: string): boolean {
    const currentCount = this.getCount(upgradeId);
    const maxStacks = this.getMaxStacks(upgradeId);
    return currentCount < maxStacks;
  }

  /**
   * Get current upgrade state (for UI display)
   */
  public getCurrentUpgrades(): Record<string, number> {
    return { ...this.upgradeCounts };
  }

  /** Snapshot the completed run before roguelike state is cleared. */
  public getRunBuildSummary(): ReadonlyArray<RunBuildEntry> {
    return this.upgradeOptions.flatMap((option) => {
      const stacks = this.getCount(option.id);
      if (stacks <= 0) return [];
      return [
        {
          id: option.id,
          name: option.name,
          type: option.type,
          rarity: option.rarity,
          stacks,
          ...(option.severity ? { severity: option.severity } : {}),
        },
      ];
    });
  }

  /** Reconstruct per-pick effects from a validated mid-run checkpoint. */
  public reapplySavedUpgradeEffects(engine: GameEngineService, savedUpgrades: Record<string, number>): boolean {
    let snapshot: ReturnType<GameEngineService['captureUpgradeTransaction']>;
    try {
      snapshot = engine.captureUpgradeTransaction();
    } catch (error) {
      this.debugLog.log('❌ Failed to capture checkpoint upgrade transaction', 'error', {
        source: 'upgrade_service',
        operation: 'restore_snapshot_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }

    for (const [id, rawCount] of Object.entries(savedUpgrades)) {
      const option = this.upgradeOptions.find((candidate) => candidate.id === id);
      if (!option) continue;

      const count = Math.max(0, Math.min(Math.floor(rawCount), this.getMaxStacks(id)));
      for (let stack = 1; stack <= count; stack++) {
        try {
          option.effect(engine, stack, 'restore');
          this.registerCurse(option);
        } catch (error) {
          let rollbackError: unknown;
          try {
            engine.restoreUpgradeTransaction(snapshot);
          } catch (restoreError) {
            rollbackError = restoreError;
          }

          this.debugLog.log(`❌ Failed to restore upgrade: ${option.name}`, 'error', {
            source: 'upgrade_service',
            operation: rollbackError ? 'restore_rollback_failed' : 'restore_effects_rolled_back',
            upgradeId: id,
            stack,
            error: error instanceof Error ? error.message : String(error),
            rollbackError:
              rollbackError instanceof Error
                ? rollbackError.message
                : rollbackError
                  ? 'Rollback failed with an unknown error'
                  : undefined,
          });
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Save current upgrades for mid-run save (NOT for persistence between deaths)
   * This is used when player saves and quits mid-run
   */
  public getUpgradesForSave(): Record<string, number> {
    return { ...this.upgradeCounts };
  }

  /**
   * Load upgrades from a mid-run save (NOT from death)
   * This is used when player continues a saved game
   */
  public loadUpgradesFromSave(savedUpgrades: Record<string, number>): void {
    // Clear current upgrades
    Object.keys(this.upgradeCounts).forEach((key) => delete this.upgradeCounts[key]);

    // Load saved upgrades with validation against max stacks
    if (savedUpgrades) {
      const knownIds = new Set(this.upgradeOptions.map((u) => u.id));
      let clampedCount = 0;
      let skippedCount = 0;

      for (const [id, rawCount] of Object.entries(savedUpgrades)) {
        // Silently ignore unknown upgrade IDs (corrupted or outdated save data)
        if (!knownIds.has(id)) {
          skippedCount++;
          continue;
        }

        // Clamp to max stacks and ensure non-negative integer
        const maxStacks = this.getMaxStacks(id);
        const sanitized = Math.max(0, Math.min(Math.floor(rawCount), maxStacks));
        if (sanitized !== rawCount) {
          clampedCount++;
        }
        if (sanitized > 0) {
          this.upgradeCounts[id] = sanitized;
        }
      }

      this.debugLog.log('💾 Loaded upgrades from save game', 'info', {
        source: 'upgrade_service',
        operation: 'load_from_save',
        upgradeCount: Object.keys(this.upgradeCounts).length,
        upgrades: Object.entries(this.upgradeCounts).map(([id, count]) => `${id}:${count}`),
        clampedCount,
        skippedCount,
      });
    }
  }
}
