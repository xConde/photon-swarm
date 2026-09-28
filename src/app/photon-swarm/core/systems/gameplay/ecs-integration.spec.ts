import { TestBed } from '@angular/core/testing';
import { GameEngineService } from '../../engine/game-engine.service';
import { EntityManagerService } from '../../ecs/entity-manager.service';
import { SpawnSystemService } from '../enemy-ai';
import { EnvironmentSystemService } from './environment-system.service';
import { EntityFactoryECSService } from '../../entities/entity-factory-ecs.service';
import { RandomService } from '../../utils/random.service';
import { ProgressionSystemService } from '../../progression/progression-system.service';
import { PowerupComponent } from '@photon/components';

/** Integration coverage for reusable ECS systems across consecutive runs. */
describe('ECS run lifecycle integration', () => {
  let gameEngine: GameEngineService;
  let entityManager: EntityManagerService;
  let spawnSystem: SpawnSystemService;
  let environmentSystem: EnvironmentSystemService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        GameEngineService,
        EntityManagerService,
        EntityFactoryECSService,
        RandomService,
        ProgressionSystemService,
        SpawnSystemService,
        EnvironmentSystemService,
      ],
    });

    gameEngine = TestBed.inject(GameEngineService);
    entityManager = TestBed.inject(EntityManagerService);
    spawnSystem = TestBed.inject(SpawnSystemService);
    environmentSystem = TestBed.inject(EnvironmentSystemService);

    const canvas = document.createElement('canvas');
    gameEngine.registerSystemInstances(environmentSystem, spawnSystem);
    gameEngine.initialize(canvas);

    const worldWidth = gameEngine.getWorldWidth();
    const worldHeight = gameEngine.getWorldHeight();
    environmentSystem.setWorldBounds(worldWidth, worldHeight);
    spawnSystem.setWorldBounds(worldWidth, worldHeight);
  });

  afterEach(() => {
    gameEngine.deactivateSession();
    entityManager.clear();
  });

  it('registers and initializes the live world systems', () => {
    const systems = gameEngine.getSystems();

    expect(systems).toContain(environmentSystem);
    expect(systems).toContain(spawnSystem);
    expect(systems.filter((system) => system === environmentSystem).length).toBe(1);
    expect(systems.filter((system) => system === spawnSystem).length).toBe(1);
    expect(environmentSystem.getEnvironmentStatus().hazardZoneCount).toBe(4);
  });

  it('reconstructs exactly one environment set after every world clear', () => {
    gameEngine.reset();
    const firstRunPowerups = entityManager.getEntitiesWithComponents(PowerupComponent);

    expect(firstRunPowerups.length).toBe(4);
    expect(environmentSystem.getEnvironmentStatus().hazardZoneCount).toBe(4);

    gameEngine.reset();
    const secondRunPowerups = entityManager.getEntitiesWithComponents(PowerupComponent);

    expect(secondRunPowerups.length).toBe(4);
    expect(environmentSystem.getEnvironmentStatus().hazardZoneCount).toBe(4);
  });

  it('keeps environment and spawning updates usable after reset', () => {
    gameEngine.reset();

    expect(() => environmentSystem.update(16, entityManager)).not.toThrow();
    expect(() => spawnSystem.update(16, entityManager)).not.toThrow();
  });
});
