import { EnemyType } from '../../models/enemy.model';
import { RandomService } from '../../utils/random.service';
import { EncounterPlannerService } from './encounter-planner.service';
import { RunPressureService } from '../../../services/run-pressure.service';

describe('EncounterPlannerService', () => {
  let rolls: number[];
  let random: jasmine.SpyObj<RandomService>;
  let service: EncounterPlannerService;

  beforeEach(() => {
    rolls = [];
    random = jasmine.createSpyObj<RandomService>('RandomService', ['random']);
    random.random.and.callFake(() => rolls.shift() ?? 0.5);
    service = new EncounterPlannerService(random);
  });

  it('authors a three-target single-silhouette opening regardless of an advanced player level', () => {
    rolls.push(0.5, 0.1);

    const plan = service.createPlan({ waveNumber: 1, playerLevel: 20, zoneId: 1 });

    expect(plan.title).toBe('Scout Screen');
    expect(plan.totalEnemies).toBe(3);
    expect(plan.spawnDurationMs).toBe(6000);
    expect(plan.formation).toBe('front');
    expect(plan.roster).toEqual([EnemyType.Basic]);
  });

  it('keeps the first directive normal even when its roll would select a swarm', () => {
    rolls.push(0.25, 0.5);

    const plan = service.createPlan({ waveNumber: 1, playerLevel: 10, zoneId: 1 });

    expect(plan.type).toBe('normal');
    expect(plan.totalEnemies).toBe(3);
  });

  it('uses the zone to unlock a distinct crossfire composition', () => {
    rolls.push(0.5, 0.99);

    const plan = service.createPlan({ waveNumber: 13, playerLevel: 8, zoneId: 3 });

    expect(plan.title).toBe('Crossfire');
    expect(plan.formation).toBe('pincer');
    expect(plan.roster).toContain(EnemyType.Sniper);
  });

  it('turns the rare late roll into a timed salvage opportunity', () => {
    rolls.push(0.95);

    const plan = service.createPlan({ waveNumber: 6, playerLevel: 4, zoneId: 1 });

    expect(plan.type).toBe('salvage_hunt');
    expect(plan.timeLimitMs).toBe(18000);
    expect(plan.reward.shards).toBe(55);
  });

  it('keeps scheduled events authoritative and assigns one invading faction', () => {
    rolls.push(0.1, 0.25);

    const plan = service.createPlan({ waveNumber: 10, playerLevel: 7, zoneId: 2 });

    expect(plan.type).toBe('faction_invasion');
    expect(plan.invasionFactionId).toBe(2);
    expect(plan.factionName).toBeTruthy();
    expect(plan.timeLimitMs).toBe(30000);
  });

  it('filters silhouettes that have not reached their introduction wave', () => {
    rolls.push(0.2);

    const plan = service.createPlan({ waveNumber: 2, playerLevel: 1, zoneId: 1 });

    expect(plan.roster).not.toContain(EnemyType.Swarm);
    expect(plan.roster).not.toContain(EnemyType.Tank);
  });

  it('turns sector pressure into a materially different formation', () => {
    const pressure = jasmine.createSpyObj<RunPressureService>('RunPressureService', ['getModifiers']);
    pressure.getModifiers.and.returnValue({
      enemyHealth: 1,
      enemyDamage: 1,
      enemySpeed: 1,
      spawnTempo: 1,
      waveSize: 1.5,
      eliteFrequency: 2,
    });
    service = new EncounterPlannerService(random, pressure);
    rolls.push(0.5, 0.1);

    const plan = service.createPlan({ waveNumber: 8, playerLevel: 5, zoneId: 2 });

    expect(plan.totalEnemies).toBeGreaterThan(8);
    expect(plan.eliteChance).toBeCloseTo(0.2);
  });
});
