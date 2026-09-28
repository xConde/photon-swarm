import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

import { HealthComponent } from '@photon/components';
import { ENCOUNTER_DIRECTOR_CONFIG } from '@photon/config/game-constants';
import { EntityManager } from '../../ecs/ecs.model';
import { EncounterPlan, EncounterProgress, EncounterResolution } from '../../models/encounter.model';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { GameStateService } from '../../state/game-state.service';

interface ActiveEncounterObjective {
  readonly plan: EncounterPlan;
  readonly startedAt: number;
  readonly entityIds: Set<number>;
  spawnedCount: number;
  spawningComplete: boolean;
  spawningCompletedAt: number | null;
}

/** Owns objective truth and the single reward transaction for authored encounters. */
@Injectable({ providedIn: 'root' })
export class EncounterObjectiveService {
  private readonly objectives = new Map<number, ActiveEncounterObjective>();
  private readonly resolutionBuffer: EncounterResolution[] = [];
  private readonly progressSubject = new BehaviorSubject<EncounterProgress | null>(null);
  private readonly resolutionSubject = new Subject<EncounterResolution>();
  private lastProgressEmitAt = Number.NEGATIVE_INFINITY;

  readonly progress$ = this.progressSubject.asObservable();
  readonly resolved$ = this.resolutionSubject.asObservable();

  constructor(
    private readonly gameState: GameStateService,
    private readonly progression: ProgressionSystemService
  ) {}

  begin(plan: EncounterPlan, startedAt: number): void {
    const safeStartedAt = Number.isFinite(startedAt) ? startedAt : 0;
    const objective: ActiveEncounterObjective = {
      plan,
      startedAt: safeStartedAt,
      entityIds: new Set<number>(),
      spawnedCount: 0,
      spawningComplete: false,
      spawningCompletedAt: null,
    };
    this.objectives.set(plan.waveNumber, objective);
    this.emitProgress(objective, safeStartedAt, 0, true);
  }

  registerSpawn(waveNumber: number, entityId: number): void {
    const objective = this.objectives.get(waveNumber);
    if (!objective || !Number.isInteger(entityId) || entityId < 0) return;
    objective.entityIds.add(entityId);
    objective.spawnedCount = Math.min(objective.plan.totalEnemies, objective.entityIds.size);
  }

  markSpawningComplete(waveNumber: number, completedAt: number): void {
    const objective = this.objectives.get(waveNumber);
    if (!objective) return;
    objective.spawningComplete = true;
    objective.spawningCompletedAt = Number.isFinite(completedAt) ? completedAt : objective.startedAt;
  }

  /** Returns resolutions so the spawn director can tear down wave effects. */
  update(now: number, entityManager: EntityManager): readonly EncounterResolution[] {
    this.resolutionBuffer.length = 0;
    if (this.objectives.size === 0) return this.resolutionBuffer;

    const safeNow = Number.isFinite(now) ? now : 0;
    let presentationObjective: ActiveEncounterObjective | null = null;
    let presentationAlive = 0;

    for (const objective of this.objectives.values()) {
      const alive = this.countAlive(objective, entityManager);
      const deadlineStartedAt = this.getDeadlineStartedAt(objective);
      const deadlineElapsed = deadlineStartedAt === null ? 0 : Math.max(0, safeNow - deadlineStartedAt);
      const deadlineReached =
        deadlineStartedAt !== null && objective.plan.timeLimitMs > 0 && deadlineElapsed >= objective.plan.timeLimitMs;
      const eliminated =
        objective.spawningComplete && objective.spawnedCount === objective.plan.totalEnemies && alive === 0;
      const success = objective.plan.objective === 'survive' ? deadlineReached : eliminated;
      const failed = objective.plan.objective === 'eliminate' && deadlineReached && !eliminated;

      if (success || failed) {
        const rewardGranted = success && !this.gameState.isRunEnded() && this.gameState.getHealth() > 0;
        const resolution: EncounterResolution = {
          waveNumber: objective.plan.waveNumber,
          type: objective.plan.type,
          title: objective.plan.title,
          success,
          rewardGranted,
          reward: objective.plan.reward,
        };
        if (rewardGranted) {
          this.gameState.addShards(objective.plan.reward.shards);
          this.progression.addXp(objective.plan.reward.xp);
        }
        this.resolutionBuffer.push(resolution);
        this.resolutionSubject.next(resolution);
        this.objectives.delete(objective.plan.waveNumber);
        continue;
      }

      if (!presentationObjective || objective.plan.waveNumber > presentationObjective.plan.waveNumber) {
        presentationObjective = objective;
        presentationAlive = alive;
      }
    }

    if (presentationObjective) {
      this.emitProgress(presentationObjective, safeNow, presentationAlive);
    } else if (this.resolutionBuffer.length > 0) {
      this.progressSubject.next(null);
    }

    return this.resolutionBuffer;
  }

  hasActiveObjectives(): boolean {
    return this.objectives.size > 0;
  }

  reset(): void {
    this.objectives.clear();
    this.resolutionBuffer.length = 0;
    this.lastProgressEmitAt = Number.NEGATIVE_INFINITY;
    this.progressSubject.next(null);
  }

  private countAlive(objective: ActiveEncounterObjective, entityManager: EntityManager): number {
    let alive = 0;
    for (const entityId of objective.entityIds) {
      if (!entityManager.hasEntity(entityId)) continue;
      const health = entityManager.getComponent(entityId, HealthComponent);
      if (health && health.health > 0 && !health.isDead) alive++;
    }
    return alive;
  }

  private getDeadlineStartedAt(objective: ActiveEncounterObjective): number | null {
    return objective.plan.objective === 'survive' ? objective.startedAt : objective.spawningCompletedAt;
  }

  private emitProgress(objective: ActiveEncounterObjective, now: number, alive: number, force = false): void {
    if (!force && now - this.lastProgressEmitAt < ENCOUNTER_DIRECTOR_CONFIG.OBJECTIVE_PROGRESS_EMIT_MS) return;
    this.lastProgressEmitAt = now;

    const deadlineStartedAt = this.getDeadlineStartedAt(objective);
    const elapsed = deadlineStartedAt === null ? 0 : Math.max(0, now - deadlineStartedAt);
    const remainingMs = objective.plan.timeLimitMs > 0 ? Math.max(0, objective.plan.timeLimitMs - elapsed) : 0;
    const current =
      objective.plan.objective === 'survive'
        ? Math.min(objective.plan.timeLimitMs, elapsed)
        : Math.max(0, objective.spawnedCount - alive);

    this.progressSubject.next({
      waveNumber: objective.plan.waveNumber,
      type: objective.plan.type,
      title: objective.plan.title,
      brief: objective.plan.brief,
      objective: objective.plan.objective,
      current,
      target: objective.plan.objective === 'survive' ? objective.plan.timeLimitMs : objective.plan.totalEnemies,
      remainingMs,
      status: 'active',
      reward: objective.plan.reward,
    });
  }
}
