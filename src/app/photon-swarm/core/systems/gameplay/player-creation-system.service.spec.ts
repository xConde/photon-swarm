import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { PlayerService } from '../../player/player.service';
import { GameStateService } from '../../state/game-state.service';
import { PlayerCreationSystemService } from './player-creation-system.service';

describe('PlayerCreationSystemService', () => {
  let service: PlayerCreationSystemService;
  let entityManager: jasmine.SpyObj<EntityManagerService>;
  let player: jasmine.SpyObj<PlayerService>;
  let gameState: jasmine.SpyObj<GameStateService>;
  let entityFactory: jasmine.SpyObj<EntityFactoryECSService>;

  beforeEach(() => {
    player = jasmine.createSpyObj<PlayerService>('PlayerService', ['activateSpawnProtection'], {
      x$: new BehaviorSubject(0),
      y$: new BehaviorSubject(0),
    });
    gameState = jasmine.createSpyObj<GameStateService>('GameStateService', ['setHealth']);
    entityFactory = jasmine.createSpyObj<EntityFactoryECSService>('EntityFactoryECSService', ['createPlayer']);
    entityManager = jasmine.createSpyObj<EntityManagerService>('EntityManagerService', ['getEntitiesWithComponents']);
    entityManager.getEntitiesWithComponents.and.returnValue([]);
    entityFactory.createPlayer.and.returnValue(42);

    TestBed.configureTestingModule({
      providers: [
        PlayerCreationSystemService,
        { provide: PlayerService, useValue: player },
        { provide: GameStateService, useValue: gameState },
        { provide: EntityFactoryECSService, useValue: entityFactory },
      ],
    });

    service = TestBed.inject(PlayerCreationSystemService);
    service.init(entityManager);
  });

  it('delegates spawn protection to the entity factory exactly once', () => {
    service.update(0, entityManager);

    expect(gameState.setHealth).toHaveBeenCalledWith(100, 'player_spawn_fix');
    expect(entityFactory.createPlayer).toHaveBeenCalledOnceWith(6000, 4500);
    expect(player.activateSpawnProtection).not.toHaveBeenCalled();
    expect(service.getPlayerEntityId()).toBe(42);
  });

  it('creates a new player after a reusable run reset', () => {
    service.update(0, entityManager);
    service.reset();
    entityFactory.createPlayer.calls.reset();

    service.update(0, entityManager);

    expect(entityFactory.createPlayer).toHaveBeenCalledOnceWith(6000, 4500);
    expect(service.getPlayerEntityId()).toBe(42);
  });
});
