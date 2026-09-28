import { Injectable } from '@angular/core';
import { System } from '../../ecs/ecs.model';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { PlayerService } from '../../player/player.service';
import { GameStateService } from '../../state/game-state.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { HealthComponent, PlayerControlledComponent, PositionComponent } from '@photon/components';

/**
 * Player Creation System - Ensures player entity exists in ECS
 *
 * This system runs early in the update cycle to ensure the player
 * entity is created before other systems need it.
 */
@Injectable({ providedIn: 'root' })
export class PlayerCreationSystemService implements System {
  private playerCreated = false;
  private playerEntityId: number | null = null;

  constructor(
    private playerService: PlayerService,
    private gameState: GameStateService,
    private entityFactory: EntityFactoryECSService
  ) {}

  init(_entityManager: EntityManagerService): void {
    this.reset();
  }

  reset(): void {
    this.playerCreated = false;
    this.playerEntityId = null;
  }

  update(_deltaTime: number, entityManager: EntityManagerService): void {
    if (!this.playerCreated) {
      this.ensurePlayerExists(entityManager);
    }
  }

  private ensurePlayerExists(entityManager: EntityManagerService): void {
    // Check if player already exists
    const playerEntities = entityManager.getEntitiesWithComponents(
      PlayerControlledComponent,
      PositionComponent,
      HealthComponent
    );

    if (playerEntities.length > 0) {
      this.playerCreated = true;
      this.playerEntityId = playerEntities[0];

      // Player already exists, no need to create
      return;
    }

    // CRITICAL FIX: Reset GameState health BEFORE creating player entity
    // This prevents the health sync at 1.5s from setting player to 0 health
    this.gameState.setHealth(100, 'player_spawn_fix');

    // Create player entity
    let x = this.playerService.x$.value;
    let y = this.playerService.y$.value;

    // CRITICAL FIX: Never spawn at (0,0) - that's world corner with no protection
    // If PlayerService hasn't initialized yet, use safe center position
    if (x === 0 && y === 0) {
      x = 6000; // Center of 12000 width world
      y = 4500; // Center of 9000 height world
      // Also update PlayerService to match
      this.playerService.x$.next(x);
      this.playerService.y$.next(y);
    }

    this.playerEntityId = this.entityFactory.createPlayer(x, y);
    this.playerCreated = true;

    // Player entity created successfully
  }

  getPlayerEntityId(): number | null {
    return this.playerEntityId;
  }
}
