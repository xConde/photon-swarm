import { Injectable } from '@angular/core';

import {
  ENCOUNTER_DIRECTOR_CONFIG,
  EncounterArchetypeConfig,
  ENEMY_UNLOCK_WAVES,
  FACTION_COLORS,
  SPAWN_CONFIG,
  WAVE_EVENTS,
} from '@photon/config/game-constants';
import { EncounterPlan, EncounterReward, WaveType } from '../../models/encounter.model';
import { EnemyType } from '../../models/enemy.model';
import { ZoneId } from '../../models/zone.model';
import { RandomService } from '../../utils/random.service';
import { RunPressureService } from '../../../services/run-pressure.service';

/** Input kept intentionally small so encounter planning stays independent of ECS state. */
export interface EncounterPlanRequest {
  readonly waveNumber: number;
  readonly playerLevel: number;
  readonly zoneId: ZoneId | null;
}

/**
 * Turns run context into an immutable encounter plan.
 *
 * This service owns pacing/composition decisions only. SpawnSystemService owns
 * entity creation and faction/world integration, while EncounterObjectiveService
 * owns completion and rewards. Keeping those boundaries separate makes balance
 * changes testable without instantiating the full ECS graph.
 */
@Injectable({ providedIn: 'root' })
export class EncounterPlannerService {
  private lastArchetypeId: string | null = null;
  private lastRandomEventWave = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly random: RandomService,
    private readonly runPressure?: RunPressureService
  ) {}

  createPlan(request: EncounterPlanRequest): EncounterPlan {
    const waveType = this.selectWaveType(request);
    const archetype = waveType === 'normal' ? this.selectArchetype(request) : null;
    const baseSize = this.getBaseWaveSize(request);

    let totalEnemies = baseSize;
    let title = archetype?.title ?? 'Contact Front';
    let brief = archetype?.brief ?? 'Break the formation and keep moving.';
    let formation = archetype?.formation ?? ('ring' as const);
    let roster = archetype?.roster ?? [EnemyType.Basic, EnemyType.Spitter];
    let spawnDurationMs =
      request.waveNumber === 1
        ? ENCOUNTER_DIRECTOR_CONFIG.OPENING.FIRST_WAVE_SPAWN_DURATION_MS
        : SPAWN_CONFIG.WAVES.WAVE_SPAWN_DURATION_MS;
    let eliteChance = SPAWN_CONFIG.RARITY.ELITE_CHANCE;
    let championChance = SPAWN_CONFIG.RARITY.CHAMPION_CHANCE;
    let objective: EncounterPlan['objective'] = 'eliminate';
    let timeLimitMs = 0;
    let reward = this.standardReward(request.waveNumber);
    let invasionFactionId: number | undefined;
    let factionName: string | undefined;

    switch (waveType) {
      case 'swarm':
        title = 'Swarm Spiral';
        brief = 'Thin the fast hulls before the ring closes.';
        formation = 'ring';
        roster = [EnemyType.Swarm, EnemyType.Basic, EnemyType.Swarm, EnemyType.Spitter];
        totalEnemies = Math.ceil(baseSize * ENCOUNTER_DIRECTOR_CONFIG.SCALING.SWARM_SIZE_MULTIPLIER);
        break;
      case 'elite':
        title = 'Elite Spearhead';
        brief = 'Priority hulls are advancing behind a hardened screen.';
        formation = 'front';
        roster = [EnemyType.Tank, EnemyType.Thug, EnemyType.Sniper, EnemyType.Spitter];
        totalEnemies = Math.max(
          ENCOUNTER_DIRECTOR_CONFIG.SCALING.ELITE_MIN_SIZE,
          Math.ceil(baseSize * ENCOUNTER_DIRECTOR_CONFIG.SCALING.ELITE_SIZE_MULTIPLIER)
        );
        eliteChance = ENCOUNTER_DIRECTOR_CONFIG.SCALING.ELITE_CHANCE;
        reward = { shards: reward.shards + 8, xp: reward.xp + 20 };
        break;
      case 'boss':
        title = 'Apex Contact';
        brief = 'Read the phase change, survive the shockwave, finish the target.';
        formation = 'front';
        roster = [EnemyType.Boss];
        totalEnemies = request.waveNumber >= 35 ? 3 : 2;
        spawnDurationMs = 6000;
        eliteChance = 0;
        championChance = 0;
        reward = { shards: 35, xp: 90 };
        break;
      case 'boss_rush':
        title = 'Boss Rush';
        brief = 'Multiple apex signatures. Destroy them before the window closes.';
        formation = 'pincer';
        roster = [EnemyType.Boss];
        totalEnemies = request.waveNumber >= 35 ? 3 : 2;
        spawnDurationMs = 6000;
        eliteChance = 0;
        championChance = 0;
        timeLimitMs = 24000;
        reward = { shards: 70, xp: 180 };
        break;
      case 'faction_invasion': {
        invasionFactionId = Math.floor(this.random.random() * 4) + 1;
        const factionColor = FACTION_COLORS[invasionFactionId as keyof typeof FACTION_COLORS];
        factionName = factionColor?.name ?? `FACTION ${invasionFactionId}`;
        title = `${factionName} Invasion`;
        brief = 'Break the invading column before it establishes a beachhead.';
        formation = 'front';
        roster = [EnemyType.Thug, EnemyType.Tank, EnemyType.Spitter, EnemyType.Basic];
        totalEnemies = Math.ceil(baseSize * ENCOUNTER_DIRECTOR_CONFIG.SCALING.INVASION_SIZE_MULTIPLIER);
        eliteChance = ENCOUNTER_DIRECTOR_CONFIG.SCALING.INVASION_ELITE_CHANCE;
        timeLimitMs = 30000;
        reward = { shards: 45, xp: 100 };
        break;
      }
      case 'blackout':
        title = 'Blackout';
        brief = 'Sensors are blind. Survive until the array reboots.';
        formation = 'flank';
        roster = [EnemyType.Sniper, EnemyType.Disruptor, EnemyType.Thug, EnemyType.Sentinel];
        totalEnemies = Math.ceil(baseSize * ENCOUNTER_DIRECTOR_CONFIG.SCALING.BLACKOUT_SIZE_MULTIPLIER);
        eliteChance = ENCOUNTER_DIRECTOR_CONFIG.SCALING.BLACKOUT_ELITE_CHANCE;
        objective = 'survive';
        timeLimitMs = 20000;
        reward = { shards: 35, xp: 85 };
        break;
      case 'guardian_surge':
        title = 'Guardian Surge';
        brief = 'Hardened sentries are converging from the sector boundary.';
        formation = 'boundary';
        roster = [EnemyType.Tank, EnemyType.Thug, EnemyType.Sentinel];
        totalEnemies = 4 + Math.floor(this.random.random() * 3);
        spawnDurationMs = 2000;
        eliteChance = 0;
        championChance = 0;
        timeLimitMs = 18000;
        reward = { shards: 40, xp: 95 };
        break;
      case 'salvage_hunt':
        title = 'Salvage Hunt';
        brief = 'A relay carrier is exposed. Eliminate its escort before it escapes.';
        formation = 'pincer';
        roster = [EnemyType.Tank, EnemyType.Thug, EnemyType.Spitter, EnemyType.Basic];
        totalEnemies = Math.min(
          7,
          Math.max(5, Math.ceil(baseSize * ENCOUNTER_DIRECTOR_CONFIG.SCALING.SALVAGE_SIZE_MULTIPLIER))
        );
        spawnDurationMs = 3000;
        eliteChance = ENCOUNTER_DIRECTOR_CONFIG.SCALING.SALVAGE_ELITE_CHANCE;
        championChance = 0;
        timeLimitMs = 18000;
        reward = { shards: 55, xp: 110 };
        break;
      default:
        break;
    }

    const authoredRoster = request.waveNumber === 1 ? ENCOUNTER_DIRECTOR_CONFIG.OPENING.FIRST_WAVE_ROSTER : roster;
    const unlockedRoster = this.filterUnlockedRoster(authoredRoster, request.waveNumber);

    const pressure = this.runPressure?.getModifiers();
    const pressuredEnemyCount = Math.ceil(totalEnemies * (pressure?.waveSize ?? 1));
    const pressuredEliteChance = Math.min(0.9, eliteChance * (pressure?.eliteFrequency ?? 1));

    return {
      waveNumber: request.waveNumber,
      type: waveType,
      archetypeId: archetype?.id ?? waveType,
      title,
      brief,
      formation,
      roster: unlockedRoster,
      totalEnemies: Math.max(1, Math.min(pressuredEnemyCount, SPAWN_CONFIG.WAVES.MAX_WAVE_SIZE)),
      spawnDurationMs,
      eliteChance: pressuredEliteChance,
      championChance,
      objective,
      timeLimitMs,
      reward,
      invasionFactionId,
      factionName,
    };
  }

  chooseEnemy(plan: EncounterPlan, spawnIndex: number): EnemyType {
    if (plan.roster.length === 0) return EnemyType.Basic;
    // Cycle through a shuffled-feeling authored roster. The wave number offset
    // keeps repeated archetypes from opening with the same silhouette every time.
    return plan.roster[(spawnIndex + plan.waveNumber) % plan.roster.length];
  }

  reset(): void {
    this.lastArchetypeId = null;
    this.lastRandomEventWave = Number.NEGATIVE_INFINITY;
  }

  private selectWaveType(request: EncounterPlanRequest): WaveType {
    // Preserve one deterministic roll per wave. Scheduled events and bosses still
    // consume it, keeping the seeded run sequence stable across all branches.
    const roll = this.random.random();
    const scheduledEvent = WAVE_EVENTS.find((event) => event.wave === request.waveNumber);
    if (scheduledEvent) return scheduledEvent.event;

    if (request.waveNumber === 15 || (request.waveNumber > 15 && (request.waveNumber - 15) % 10 === 0)) {
      return 'boss';
    }

    if (request.waveNumber <= ENCOUNTER_DIRECTOR_CONFIG.OPENING.FORCED_NORMAL_WAVES) return 'normal';

    const randomEventReady =
      request.waveNumber >= ENCOUNTER_DIRECTOR_CONFIG.RANDOM_EVENT.MIN_WAVE &&
      request.waveNumber - this.lastRandomEventWave >= ENCOUNTER_DIRECTOR_CONFIG.RANDOM_EVENT.MIN_WAVES_BETWEEN;
    if (randomEventReady && roll >= ENCOUNTER_DIRECTOR_CONFIG.RANDOM_EVENT.SALVAGE_HUNT_ROLL_MIN) {
      this.lastRandomEventWave = request.waveNumber;
      return 'salvage_hunt';
    }

    if (request.playerLevel >= SPAWN_CONFIG.WAVES.ELITE_WAVE_MIN_LEVEL && roll < SPAWN_CONFIG.WAVES.ELITE_WAVE_CHANCE) {
      return 'elite';
    }
    if (
      roll >= SPAWN_CONFIG.WAVES.ELITE_WAVE_CHANCE &&
      roll < SPAWN_CONFIG.WAVES.ELITE_WAVE_CHANCE + SPAWN_CONFIG.WAVES.SWARM_WAVE_CHANCE
    ) {
      return 'swarm';
    }
    return 'normal';
  }

  private selectArchetype(request: EncounterPlanRequest): EncounterArchetypeConfig {
    const eligible = ENCOUNTER_DIRECTOR_CONFIG.ARCHETYPES.filter((candidate) => {
      if (request.waveNumber < candidate.minWave) return false;
      return !candidate.zones || (request.zoneId !== null && candidate.zones.includes(request.zoneId));
    });
    const pool = eligible.length > 0 ? eligible : [ENCOUNTER_DIRECTOR_CONFIG.ARCHETYPES[0]];
    const weightedPool = pool.map((candidate) => ({
      value: candidate,
      weight:
        candidate.id === this.lastArchetypeId && pool.length > 1
          ? candidate.weight * ENCOUNTER_DIRECTOR_CONFIG.SCALING.REPEATED_ARCHETYPE_WEIGHT_MULTIPLIER
          : candidate.weight,
    }));
    const totalWeight = weightedPool.reduce((sum, candidate) => sum + candidate.weight, 0);
    let weightedRoll = this.random.random() * totalWeight;
    let selected = weightedPool[weightedPool.length - 1].value;
    for (const candidate of weightedPool) {
      weightedRoll -= candidate.weight;
      if (weightedRoll <= 0) {
        selected = candidate.value;
        break;
      }
    }
    this.lastArchetypeId = selected.id;
    return selected;
  }

  private getBaseWaveSize(request: EncounterPlanRequest): number {
    const earlySize = ENCOUNTER_DIRECTOR_CONFIG.EARLY_WAVE_SIZES[request.waveNumber - 1];
    if (earlySize !== undefined) return earlySize;
    return Math.min(
      SPAWN_CONFIG.WAVES.MAX_WAVE_SIZE,
      ENCOUNTER_DIRECTOR_CONFIG.SCALING.POST_EARLY_BASE_SIZE +
        Math.floor(request.playerLevel * ENCOUNTER_DIRECTOR_CONFIG.SCALING.PLAYER_LEVEL_MULTIPLIER) +
        Math.floor(request.waveNumber / ENCOUNTER_DIRECTOR_CONFIG.SCALING.WAVES_PER_SIZE_STEP)
    );
  }

  private filterUnlockedRoster(roster: readonly EnemyType[], waveNumber: number): readonly EnemyType[] {
    const unlocked = roster.filter((type) => waveNumber >= (ENEMY_UNLOCK_WAVES[type] ?? 1));
    return unlocked.length > 0 ? unlocked : [EnemyType.Basic, EnemyType.Spitter];
  }

  private standardReward(waveNumber: number): EncounterReward {
    return {
      shards: 4 + Math.floor(waveNumber / 5),
      xp: 10 + Math.floor(waveNumber / 3) * 2,
    };
  }
}
