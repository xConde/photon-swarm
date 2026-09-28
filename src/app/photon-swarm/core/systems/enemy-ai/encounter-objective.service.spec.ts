import { HealthComponent } from '@photon/components';
import { ErrorHandlerService } from '../../utils/error-handler.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { EncounterPlan } from '../../models/encounter.model';
import { EnemyType } from '../../models/enemy.model';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { GameStateService } from '../../state/game-state.service';
import { EncounterObjectiveService } from './encounter-objective.service';

function plan(overrides: Partial<EncounterPlan> = {}): EncounterPlan {
  return {
    waveNumber: 1,
    type: 'normal',
    archetypeId: 'test',
    title: 'Test Contact',
    brief: 'Clear the targets.',
    formation: 'front',
    roster: [EnemyType.Basic],
    totalEnemies: 2,
    spawnDurationMs: 1000,
    eliteChance: 0,
    championChance: 0,
    objective: 'eliminate',
    timeLimitMs: 0,
    reward: { shards: 7, xp: 13 },
    ...overrides,
  };
}

describe('EncounterObjectiveService', () => {
  let entityManager: EntityManagerService;
  let gameState: jasmine.SpyObj<GameStateService>;
  let progression: jasmine.SpyObj<ProgressionSystemService>;
  let service: EncounterObjectiveService;

  beforeEach(() => {
    const errorHandler = jasmine.createSpyObj<ErrorHandlerService>('ErrorHandlerService', ['handleECSError']);
    entityManager = new EntityManagerService(errorHandler);
    gameState = jasmine.createSpyObj<GameStateService>('GameStateService', ['addShards', 'getHealth', 'isRunEnded']);
    progression = jasmine.createSpyObj<ProgressionSystemService>('ProgressionSystemService', ['addXp']);
    gameState.getHealth.and.returnValue(100);
    gameState.isRunEnded.and.returnValue(false);
    service = new EncounterObjectiveService(gameState, progression);
  });

  it('resolves only after all registered targets are dead and spawning is complete', () => {
    const first = entityManager.createEntity();
    const second = entityManager.createEntity();
    entityManager.addComponent(first, new HealthComponent(100, 100));
    entityManager.addComponent(second, new HealthComponent(100, 100));
    service.begin(plan(), 1000);
    service.registerSpawn(1, first);
    service.registerSpawn(1, second);
    service.markSpawningComplete(1, 1200);

    expect(service.update(1500, entityManager)).toEqual([]);
    entityManager.destroyEntity(first);
    expect(service.update(1700, entityManager)).toEqual([]);
    entityManager.destroyEntity(second);

    const resolutions = service.update(1900, entityManager);
    expect(resolutions[0].success).toBeTrue();
    expect(resolutions[0].rewardGranted).toBeTrue();
    expect(gameState.addShards).toHaveBeenCalledOnceWith(7);
    expect(progression.addXp).toHaveBeenCalledOnceWith(13);
  });

  it('fails a timed elimination without paying its reward', () => {
    const target = entityManager.createEntity();
    entityManager.addComponent(target, new HealthComponent(100, 100));
    service.begin(plan({ timeLimitMs: 2000 }), 1000);
    service.registerSpawn(1, target);
    service.markSpawningComplete(1, 1000);

    const resolutions = service.update(3000, entityManager);

    expect(resolutions[0].success).toBeFalse();
    expect(resolutions[0].rewardGranted).toBeFalse();
    expect(gameState.addShards).not.toHaveBeenCalled();
    expect(progression.addXp).not.toHaveBeenCalled();
  });

  it('rewards a survival directive at its deadline even when targets remain', () => {
    service.begin(plan({ objective: 'survive', timeLimitMs: 2000 }), 1000);

    const resolutions = service.update(3000, entityManager);

    expect(resolutions[0].success).toBeTrue();
    expect(resolutions[0].rewardGranted).toBeTrue();
    expect(gameState.addShards).toHaveBeenCalledOnceWith(7);
  });

  it('starts a timed elimination deadline only after its roster finishes spawning', () => {
    const target = entityManager.createEntity();
    entityManager.addComponent(target, new HealthComponent(100, 100));
    service.begin(plan({ totalEnemies: 1, timeLimitMs: 2000 }), 1000);
    service.registerSpawn(1, target);

    expect(service.update(5000, entityManager)).toEqual([]);
    service.markSpawningComplete(1, 5000);
    expect(service.update(6999, entityManager)).toEqual([]);

    const resolutions = service.update(7000, entityManager);
    expect(resolutions[0].success).toBeFalse();
  });

  it('does not complete an elimination when only part of its roster was registered', () => {
    const target = entityManager.createEntity();
    entityManager.addComponent(target, new HealthComponent(1, 1));
    service.begin(plan({ totalEnemies: 2 }), 0);
    service.registerSpawn(1, target);
    service.markSpawningComplete(1, 100);
    entityManager.destroyEntity(target);

    expect(service.update(200, entityManager)).toEqual([]);
    expect(gameState.addShards).not.toHaveBeenCalled();
  });

  it('does not transact rewards after the run has ended', () => {
    gameState.isRunEnded.and.returnValue(true);
    const target = entityManager.createEntity();
    entityManager.addComponent(target, new HealthComponent(1, 1));
    service.begin(plan({ totalEnemies: 1 }), 0);
    service.registerSpawn(1, target);
    service.markSpawningComplete(1, 0);
    entityManager.destroyEntity(target);

    service.update(100, entityManager);

    expect(gameState.addShards).not.toHaveBeenCalled();
    expect(progression.addXp).not.toHaveBeenCalled();
  });

  it('does not transact rewards after lethal health before the terminal flag catches up', () => {
    gameState.getHealth.and.returnValue(0);
    const target = entityManager.createEntity();
    entityManager.addComponent(target, new HealthComponent(1, 1));
    service.begin(plan({ totalEnemies: 1 }), 0);
    service.registerSpawn(1, target);
    service.markSpawningComplete(1, 0);
    entityManager.destroyEntity(target);

    const resolutions = service.update(100, entityManager);

    expect(resolutions[0].success).toBeTrue();
    expect(resolutions[0].rewardGranted).toBeFalse();
    expect(gameState.addShards).not.toHaveBeenCalled();
    expect(progression.addXp).not.toHaveBeenCalled();
  });

  it('reset clears active presentation state without completing reusable streams', () => {
    let latestTitle = 'untouched';
    service.progress$.subscribe((progress) => (latestTitle = progress?.title ?? 'none'));
    service.begin(plan(), 0);

    service.reset();

    expect(latestTitle).toBe('none');
    expect(service.hasActiveObjectives()).toBeFalse();
  });

  it('reuses its resolution buffer instead of allocating on every game-loop update', () => {
    const firstUpdate = service.update(0, entityManager);
    const secondUpdate = service.update(16, entityManager);

    expect(secondUpdate).toBe(firstUpdate);
  });
});
