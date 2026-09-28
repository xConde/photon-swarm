import { Injectable } from '@angular/core';

import { ENCOUNTER_DIRECTOR_CONFIG, SPAWN_CONFIG, WORLD_CONFIG } from '@photon/config/game-constants';
import { EncounterFormation } from '../../models/encounter.model';
import { EnemyType } from '../../models/enemy.model';
import { PlayerService } from '../../player/player.service';
import { RandomService } from '../../utils/random.service';
import { ZoneStateService } from '../world';

/** Owns ambient clustering and authored formation geometry for enemy spawns. */
@Injectable({ providedIn: 'root' })
export class SpawnPositionService {
  private worldBounds = { width: WORLD_CONFIG.BOUNDS.WIDTH, height: WORLD_CONFIG.BOUNDS.HEIGHT };
  private lastSpawnPosition: { x: number; y: number } | null = null;
  private spawnsSinceClusterReset = 0;
  private lastClusterResetTime = Date.now();

  constructor(
    private readonly random: RandomService,
    private readonly playerService: PlayerService,
    private readonly zoneState: ZoneStateService
  ) {}

  setWorldBounds(width: number, height: number): void {
    this.worldBounds = { width, height };
  }

  reset(): void {
    this.lastSpawnPosition = null;
    this.spawnsSinceClusterReset = 0;
    this.lastClusterResetTime = Date.now();
  }

  getEncounterPosition(options: {
    formation: EncounterFormation;
    index: number;
    total: number;
    anchorAngle: number;
    enemyType: EnemyType;
    blackoutActive: boolean;
  }): { x: number; y: number } {
    if (options.formation === 'boundary') return this.getZoneBoundaryPosition(options.blackoutActive);

    const player = this.getPlayerPosition();
    const count = Math.max(1, options.total);
    const spreadIndex = options.index - (count - 1) / 2;
    let angle: number;

    switch (options.formation) {
      case 'pincer': {
        const side = options.index % 2 === 0 ? 1 : -1;
        angle =
          options.anchorAngle +
          side *
            (Math.PI / 2 +
              Math.floor(options.index / 2) * ENCOUNTER_DIRECTOR_CONFIG.FORMATION.PINCER_ANGLE_STEP_RADIANS);
        break;
      }
      case 'front':
        angle = options.anchorAngle + spreadIndex * ENCOUNTER_DIRECTOR_CONFIG.FORMATION.FRONT_ANGLE_STEP_RADIANS;
        break;
      case 'flank':
        angle =
          options.anchorAngle +
          Math.PI / 2 +
          spreadIndex * ENCOUNTER_DIRECTOR_CONFIG.FORMATION.FLANK_ANGLE_STEP_RADIANS;
        break;
      default:
        angle = options.anchorAngle + (options.index / count) * Math.PI * 2;
        break;
    }

    const baseDistance = options.enemyType === EnemyType.Boss ? 1000 : options.blackoutActive ? 500 : 760;
    const distance = baseDistance + (this.random.random() - 0.5) * 100;
    const minSafeDistance = options.enemyType === EnemyType.Boss ? 800 : options.blackoutActive ? 150 : 500;
    const primary = this.clampToWorld(
      player.x + Math.cos(angle) * distance,
      player.y + Math.sin(angle) * distance,
      100
    );
    if (this.distanceBetween(player, primary) >= minSafeDistance) return primary;

    // At a world edge, clamping an outward-facing formation can collapse it onto the
    // player. Preserve the authored distance by mirroring that slot inward instead.
    const mirrored = this.clampToWorld(
      player.x - Math.cos(angle) * distance,
      player.y - Math.sin(angle) * distance,
      100
    );
    if (this.distanceBetween(player, mirrored) >= minSafeDistance) return mirrored;

    const centerAngle = Math.atan2(this.worldBounds.height / 2 - player.y, this.worldBounds.width / 2 - player.x);
    return this.clampToWorld(
      player.x + Math.cos(centerAngle) * distance,
      player.y + Math.sin(centerAngle) * distance,
      100
    );
  }

  getZoneBoundaryPosition(blackoutActive = false): { x: number; y: number } {
    const currentZone = this.zoneState.getCurrentZone();
    if (!currentZone) return this.getSpawnPosition(undefined, blackoutActive);

    const { bounds } = currentZone;
    const margin = 80;
    const edge = Math.floor(this.random.random() * 4);
    let x: number;
    let y: number;

    switch (edge) {
      case 0:
        x = bounds.x + margin + this.random.random() * (bounds.width - margin * 2);
        y = bounds.y + margin;
        break;
      case 1:
        x = bounds.x + bounds.width - margin;
        y = bounds.y + margin + this.random.random() * (bounds.height - margin * 2);
        break;
      case 2:
        x = bounds.x + margin + this.random.random() * (bounds.width - margin * 2);
        y = bounds.y + bounds.height - margin;
        break;
      default:
        x = bounds.x + margin;
        y = bounds.y + margin + this.random.random() * (bounds.height - margin * 2);
        break;
    }

    return this.clampToWorld(x, y, 50);
  }

  getSpawnPosition(enemyType?: EnemyType, blackoutActive = false): { x: number; y: number } {
    this.maybeResetClusterPosition();
    const player = this.getPlayerPosition();
    const isBoss = enemyType === EnemyType.Boss;
    const baseMinDistance = isBoss ? 800 : blackoutActive ? 150 : 400;
    const baseMaxDistance = isBoss ? 1200 : blackoutActive ? 600 : 800;
    const distanceVariance = 0.2;
    const minDistance = baseMinDistance * (0.8 + this.random.random() * distanceVariance * 2);
    const maxDistance = baseMaxDistance * (0.8 + this.random.random() * distanceVariance * 2);
    const useCluster = this.random.random() < SPAWN_CONFIG.CLUSTER.CHANCE && this.lastSpawnPosition !== null;
    let spawnX: number;
    let spawnY: number;

    if (useCluster && this.lastSpawnPosition) {
      const clusterDistance =
        SPAWN_CONFIG.CLUSTER.MIN_DISTANCE +
        this.random.random() * (SPAWN_CONFIG.CLUSTER.MAX_DISTANCE - SPAWN_CONFIG.CLUSTER.MIN_DISTANCE);
      const clusterAngle = this.random.random() * Math.PI * 2;
      spawnX = this.lastSpawnPosition.x + Math.cos(clusterAngle) * clusterDistance;
      spawnY = this.lastSpawnPosition.y + Math.sin(clusterAngle) * clusterDistance;
    } else {
      const angle = this.random.random() * Math.PI * 2 + (this.random.random() - 0.5) * (Math.PI / 6);
      const distance = minDistance + this.random.random() * (maxDistance - minDistance);
      spawnX = player.x + Math.cos(angle) * distance;
      spawnY = player.y + Math.sin(angle) * distance;
    }

    let position = this.clampToWorld(spawnX, spawnY, 100);
    const minSafeDistance = blackoutActive ? 150 : 500;
    const maxSafeDistance = 1400;
    position = this.constrainDistanceFromPlayer(position, player, minSafeDistance, maxSafeDistance);

    this.lastSpawnPosition = position;
    this.spawnsSinceClusterReset++;
    return position;
  }

  getPlayerPosition(): { x: number; y: number } {
    const position = this.playerService.getPosition();
    return position ?? { x: this.worldBounds.width / 2, y: this.worldBounds.height / 2 };
  }

  private maybeResetClusterPosition(): void {
    const now = Date.now();
    if (
      this.spawnsSinceClusterReset >= SPAWN_CONFIG.CLUSTER.RESET_AFTER_SPAWNS ||
      now - this.lastClusterResetTime >= SPAWN_CONFIG.CLUSTER.RESET_AFTER_MS
    ) {
      this.reset();
    }
  }

  private clampToWorld(x: number, y: number, margin: number): { x: number; y: number } {
    return {
      x: Math.max(margin, Math.min(this.worldBounds.width - margin, x)),
      y: Math.max(margin, Math.min(this.worldBounds.height - margin, y)),
    };
  }

  private distanceBetween(first: { x: number; y: number }, second: { x: number; y: number }): number {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private constrainDistanceFromPlayer(
    position: { x: number; y: number },
    player: { x: number; y: number },
    minDistance: number,
    maxDistance: number
  ): { x: number; y: number } {
    const dx = position.x - player.x;
    const dy = position.y - player.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance >= minDistance && distance <= maxDistance) return position;

    if (distance > maxDistance) {
      const scale = maxDistance / distance;
      return this.clampToWorld(player.x + dx * scale, player.y + dy * scale, 100);
    }

    if (distance > 0) {
      const scale = minDistance / distance;
      const extended = this.clampToWorld(player.x + dx * scale, player.y + dy * scale, 100);
      if (this.distanceBetween(player, extended) >= minDistance) return extended;
    }

    // A zero-length or outward-clamped vector has no usable direction. Move
    // toward the world center, which is guaranteed to be the safe side of the
    // nearest boundary in the normal game world.
    const centerAngle = Math.atan2(this.worldBounds.height / 2 - player.y, this.worldBounds.width / 2 - player.x);
    return this.clampToWorld(
      player.x + Math.cos(centerAngle) * minDistance,
      player.y + Math.sin(centerAngle) * minDistance,
      100
    );
  }
}
